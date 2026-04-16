import { randomUUID } from 'node:crypto';

import { confirm, input, select } from '@inquirer/prompts';
import { Command } from 'commander';

import type { Environment } from '@/entities';
import type { EnvironmentSecret } from '@/entities';
import {
	GhostableClient,
	HttpError,
	KeyReshareRequiredError,
	type EnvironmentVariablePromotionRequestResourceJson,
	type EnvironmentVariablePromotionRequestEntryJson,
	type CreateEnvironmentVariablePromotionRequestJson,
	type CreateEnvironmentVariablePromotionRequestEntryJson,
	type EnvironmentVariablePromotionReviewOverrideEntryJson,
} from '@/ghostable';
import { aeadDecrypt, deriveKeys, initSodium, scopeFromAAD } from '@/crypto';
import { EnvironmentKeyService } from '@/environment/keys/EnvironmentKeyService.js';
import { buildSecretPayload } from '@/support/secret-payload.js';
import { buildPromotionPayloadSigningJSON } from '@/support/promotion-payload.js';
import { DeviceIdentityService } from '@/services/DeviceIdentityService.js';
import { promptWithCancel } from '@/support/prompts.js';
import { log } from '@/support/logger.js';
import { toErrorMessage } from '@/support/errors.js';
import { registerEnvSubcommand } from './_shared.js';
import {
	requireAuthedClient,
	requireProjectContext,
	requireDeviceIdentity,
	reshareEnvironmentKey,
} from '../deploy/token/common.js';

type PromoteCreateOptions = {
	sourceEnv?: string;
	targetEnv?: string;
	keys?: string[];
	includeValues?: boolean;
	idempotencyKey?: string;
	yes?: boolean;
};

type PromotePendingOptions = {
	json?: boolean;
};

type PromoteReviewOptions = {
	set?: string[];
};

type PromoteApproveOptions = {
	set?: string[];
};

type PromoteRejectOptions = {
	reason?: string;
};

type PromoteCancelOptions = {
	reason?: string;
};

type SourceVariableMetadata = {
	name: string;
	sourceIfVersion?: number;
	lineBytes?: number;
	isCommented?: boolean;
	value?: string;
	sourceValuePresent: boolean;
};

type PromotionRequestResolution = {
	sourceEnvironmentName: string;
	request: EnvironmentVariablePromotionRequestResourceJson;
};

const PROMOTION_TERMINAL_CODES = new Set(['PROMOTION_TERMINAL_STATE', 'PROMOTION_INVALID_STATE']);

function collectValues(value: string, previous: string[]): string[] {
	return [...previous, value];
}

function normalizeEnvironmentName(value?: string): string | null {
	const trimmed = value?.trim();
	return trimmed ? trimmed : null;
}

function parseIntegerLike(value: unknown): number | undefined {
	if (typeof value === 'number' && Number.isFinite(value)) {
		return Math.trunc(value);
	}

	if (typeof value === 'string' && value.trim().length > 0) {
		const parsed = Number.parseInt(value.trim(), 10);
		return Number.isFinite(parsed) ? parsed : undefined;
	}

	return undefined;
}

function parseSetOverrides(values: string[] = []): Map<string, string> {
	const result = new Map<string, string>();
	for (const raw of values) {
		const normalized = raw.trim();
		if (!normalized) continue;

		const equalsIndex = normalized.indexOf('=');
		if (equalsIndex <= 0) {
			throw new Error(`Invalid --set value "${raw}". Use KEY=VALUE.`);
		}

		const key = normalized.slice(0, equalsIndex).trim();
		const value = normalized.slice(equalsIndex + 1);
		if (!key) {
			throw new Error(`Invalid --set value "${raw}". Key is required.`);
		}

		result.set(key, value);
	}

	return result;
}

function formatEntryNames(entries: EnvironmentVariablePromotionRequestEntryJson[]): string {
	const names = entries
		.map((entry) => entry.name?.trim())
		.filter((name): name is string => Boolean(name && name.length > 0));
	if (!names.length) {
		return 'none';
	}

	const preview = names.slice(0, 4).join(', ');
	if (names.length <= 4) {
		return preview;
	}

	return `${preview}, +${names.length - 4} more`;
}

function parseHttpErrorBody(error: HttpError): Record<string, unknown> | null {
	const raw = error.body?.trim();
	if (!raw) {
		return null;
	}

	try {
		const parsed = JSON.parse(raw);
		return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
	} catch {
		return null;
	}
}

function extractServerErrorCode(error: unknown): string | null {
	if (!(error instanceof HttpError)) {
		return null;
	}

	const parsed = parseHttpErrorBody(error);
	if (!parsed) {
		return null;
	}

	const nested =
		parsed.error && typeof parsed.error === 'object'
			? (parsed.error as Record<string, unknown>)
			: null;
	const code = nested?.code;
	return typeof code === 'string' && code.trim().length > 0 ? code.trim() : null;
}

function keyReshareRecoveryIds(error: unknown): string[] {
	if (error instanceof KeyReshareRequiredError) {
		return error.pendingRequestIds;
	}

	if (!(error instanceof HttpError)) {
		return [];
	}

	const parsed = parseHttpErrorBody(error);
	if (!parsed) {
		return [];
	}

	const nested =
		parsed.error && typeof parsed.error === 'object'
			? (parsed.error as Record<string, unknown>)
			: null;
	const pendingRequestIds = nested?.pending_request_ids;
	if (!Array.isArray(pendingRequestIds)) {
		return [];
	}

	return pendingRequestIds
		.map((item) => (typeof item === 'string' ? item.trim() : ''))
		.filter((item) => item.length > 0);
}

function isLikelyEnvironmentKeyAccessError(error: unknown): boolean {
	if (error instanceof KeyReshareRequiredError) {
		return true;
	}

	if (!(error instanceof HttpError)) {
		return false;
	}

	const code = extractServerErrorCode(error);
	if (code === 'ENV_KEY_RESHARE_REQUIRED') {
		return true;
	}

	const detail = error.body?.toLowerCase() ?? '';
	return detail.includes('invalid signature detected') && detail.includes('environment key');
}

async function listProjectPromotionRequests(opts: {
	client: GhostableClient;
	projectId: string;
	status?: 'pending' | 'approved' | 'rejected' | 'cancelled';
}): Promise<PromotionRequestResolution[]> {
	const environments = await opts.client.getEnvironments(opts.projectId);
	const deduped = new Map<string, PromotionRequestResolution>();

	for (const environment of environments) {
		try {
			const requests = await opts.client.listVariablePromotionRequests(
				opts.projectId,
				environment.name,
				opts.status ? { status: opts.status } : {},
			);

			for (const request of requests) {
				if (!request?.id || deduped.has(request.id)) {
					continue;
				}

				const sourceEnvironmentName =
					request.attributes.source_environment_name?.trim() || environment.name;

				deduped.set(request.id, {
					sourceEnvironmentName,
					request,
				});
			}
		} catch (error) {
			if (error instanceof HttpError && error.status === 403) {
				continue;
			}
			throw error;
		}
	}

	return Array.from(deduped.values()).sort((left, right) => {
		const leftAt = left.request.attributes.created_at ?? '';
		const rightAt = right.request.attributes.created_at ?? '';
		return rightAt.localeCompare(leftAt);
	});
}

async function findPromotionRequest(opts: {
	client: GhostableClient;
	projectId: string;
	requestId: string;
}): Promise<PromotionRequestResolution | null> {
	const pending = await listProjectPromotionRequests({
		client: opts.client,
		projectId: opts.projectId,
		status: 'pending',
	});
	const pendingMatch = pending.find((entry) => entry.request.id === opts.requestId);
	if (pendingMatch) {
		return pendingMatch;
	}

	const environments = await opts.client.getEnvironments(opts.projectId);
	for (const environment of environments) {
		try {
			const request = await opts.client.getVariablePromotionRequest(
				opts.projectId,
				environment.name,
				opts.requestId,
			);

			return {
				sourceEnvironmentName:
					request.attributes.source_environment_name?.trim() || environment.name,
				request,
			};
		} catch (error) {
			if (error instanceof HttpError && (error.status === 404 || error.status === 403)) {
				continue;
			}
			throw error;
		}
	}

	return null;
}

async function resolveEnvironmentChoice(
	environments: Environment[],
	options: {
		label: string;
		provided?: string;
		exclude?: Set<string>;
	},
): Promise<Environment> {
	const provided = normalizeEnvironmentName(options.provided);
	const normalizedExclude = new Set(
		Array.from(options.exclude ?? new Set<string>()).map((value) => value.toLowerCase()),
	);

	const selectable = environments.filter(
		(environment) => !normalizedExclude.has(environment.name.toLowerCase()),
	);

	if (!selectable.length) {
		throw new Error('No environments available for this selection.');
	}

	if (provided) {
		const match = selectable.find(
			(environment) =>
				environment.name.toLowerCase() === provided.toLowerCase() ||
				environment.id === provided,
		);
		if (!match) {
			throw new Error(`Environment "${provided}" was not found in this project.`);
		}
		return match;
	}

	const selectedId = await promptWithCancel(() =>
		select<string>({
			message: options.label,
			choices: selectable
				.slice()
				.sort((left, right) => left.name.localeCompare(right.name))
				.map((environment) => ({
					name: `${environment.name} (${environment.type})`,
					value: environment.id,
				})),
		}),
	);

	const selected = selectable.find((environment) => environment.id === selectedId);
	if (!selected) {
		throw new Error('Invalid environment selection.');
	}

	return selected;
}

function normalizeKeyInput(values: string[] = []): string[] {
	return values
		.flatMap((value) => value.split(','))
		.map((value) => value.trim())
		.filter((value) => value.length > 0);
}

async function resolveVariableKeys(opts: {
	allSourceKeys: string[];
	providedKeys?: string[];
}): Promise<string[]> {
	const normalizedProvidedKeys = normalizeKeyInput(opts.providedKeys);

	if (normalizedProvidedKeys.length > 0) {
		const available = new Set(opts.allSourceKeys);
		const missing = normalizedProvidedKeys.filter((key) => !available.has(key));
		if (missing.length > 0) {
			throw new Error(
				`The following keys are not available in the source environment: ${missing.join(', ')}`,
			);
		}

		return Array.from(new Set(normalizedProvidedKeys)).sort((left, right) =>
			left.localeCompare(right),
		);
	}

	const selected: string[] = [];
	const remaining = opts.allSourceKeys.slice();

	const firstSelection = await promptWithCancel(() =>
		select<string>({
			message: 'Select first variable key to promote',
			choices: remaining.map((name) => ({ name, value: name })),
		}),
	);
	selected.push(firstSelection);

	for (let index = remaining.length - 1; index >= 0; index -= 1) {
		if (remaining[index] === firstSelection) {
			remaining.splice(index, 1);
		}
	}

	while (remaining.length > 0) {
		const addAnother = await promptWithCancel(() =>
			confirm({
				message: 'Add another variable key?',
				default: false,
			}),
		);
		if (!addAnother) {
			break;
		}

		const nextSelection = await promptWithCancel(() =>
			select<string>({
				message: 'Select another variable key to promote',
				choices: remaining.map((name) => ({ name, value: name })),
			}),
		);
		selected.push(nextSelection);

		for (let index = remaining.length - 1; index >= 0; index -= 1) {
			if (remaining[index] === nextSelection) {
				remaining.splice(index, 1);
			}
		}
	}

	return Array.from(new Set(selected)).sort((left, right) => left.localeCompare(right));
}

async function resolveIncludeValues(opts: {
	explicit?: boolean;
	explicitlySet: boolean;
}): Promise<boolean> {
	if (opts.explicitlySet) {
		return Boolean(opts.explicit);
	}

	return promptWithCancel(() =>
		confirm({
			message: 'Include current values in the promotion request?',
			default: false,
		}),
	);
}

async function resolveOrganizationId(client: GhostableClient, projectId: string): Promise<string> {
	const project = await client.getProject(projectId);
	if (!project.organizationId?.trim()) {
		throw new Error('Organization context is required to build promotion payloads.');
	}

	return project.organizationId;
}

async function loadSourceVariableMetadata(opts: {
	client: GhostableClient;
	projectId: string;
	sourceEnvironmentName: string;
	selectedKeys: string[];
	includeValues: boolean;
	identityDeviceId: string;
}): Promise<Map<string, SourceVariableMetadata>> {
	const metadata = new Map<string, SourceVariableMetadata>();

	const summary = await opts.client.getEnvironmentKeys(
		opts.projectId,
		opts.sourceEnvironmentName,
	);
	for (const item of summary.data) {
		if (!opts.selectedKeys.includes(item.name)) {
			continue;
		}

		metadata.set(item.name, {
			name: item.name,
			sourceIfVersion: parseIntegerLike(item.version),
			sourceValuePresent: false,
		});
	}

	if (!opts.includeValues) {
		return metadata;
	}

	let bundle;
	try {
		bundle = await opts.client.pull(opts.projectId, opts.sourceEnvironmentName, {
			includeMeta: true,
			includeVersions: true,
			only: opts.selectedKeys,
			deviceId: opts.identityDeviceId,
		});
	} catch (error) {
		throw new Error(`Failed to load source variable values: ${toErrorMessage(error)}`);
	}

	await initSodium();

	const identityService = await DeviceIdentityService.create();
	const identity = await identityService.requireIdentity();
	const envKeyService = await EnvironmentKeyService.create();

	const envKeys = new Map<string, Uint8Array>();
	const involvedEnvironments = new Set<string>();
	for (const layer of bundle.chain) {
		involvedEnvironments.add(layer);
	}
	for (const secret of bundle.secrets) {
		involvedEnvironments.add(secret.env);
	}

	for (const environmentName of involvedEnvironments) {
		const keyInfo = await envKeyService.ensureEnvironmentKey({
			client: opts.client,
			projectId: opts.projectId,
			envName: environmentName,
			identity,
		});
		envKeys.set(environmentName, keyInfo.key);
	}

	const grouped = new Map<string, EnvironmentSecret[]>();
	for (const secret of bundle.secrets) {
		if (!grouped.has(secret.env)) {
			grouped.set(secret.env, []);
		}
		grouped.get(secret.env)!.push(secret);
	}

	for (const layer of bundle.chain) {
		for (const secret of grouped.get(layer) ?? []) {
			if (!opts.selectedKeys.includes(secret.name)) {
				continue;
			}

			const keyMaterial = envKeys.get(secret.env);
			if (!keyMaterial) {
				continue;
			}

			try {
				const scope = scopeFromAAD(secret.aad);
				const { encKey } = deriveKeys(keyMaterial, scope);
				const plaintext = aeadDecrypt(encKey, {
					alg: secret.alg,
					nonce: secret.nonce,
					ciphertext: secret.ciphertext,
					aad: secret.aad,
				});
				const value = new TextDecoder().decode(plaintext);

				const existing = metadata.get(secret.name) ?? {
					name: secret.name,
					sourceValuePresent: false,
				};

				metadata.set(secret.name, {
					...existing,
					value,
					lineBytes: secret.meta?.line_bytes ?? Buffer.byteLength(value, 'utf8'),
					isCommented: secret.meta?.is_commented ?? existing.isCommented,
					sourceIfVersion: secret.version ?? existing.sourceIfVersion,
					sourceValuePresent: true,
				});
			} catch {
				// Intentionally skip undecryptable values; missing values are handled by caller.
			}
		}
	}

	for (const key of opts.selectedKeys) {
		if (!metadata.has(key)) {
			metadata.set(key, {
				name: key,
				sourceValuePresent: false,
			});
		}
	}

	return metadata;
}

async function buildPromotionCreateRequest(opts: {
	client: GhostableClient;
	projectId: string;
	sourceEnvironmentName: string;
	targetEnvironment: Environment;
	selectedKeys: string[];
	includeValues: boolean;
	identity: Awaited<ReturnType<typeof requireDeviceIdentity>>;
}): Promise<CreateEnvironmentVariablePromotionRequestJson> {
	const organizationId = await resolveOrganizationId(opts.client, opts.projectId);

	const envKeyService = await EnvironmentKeyService.create();
	const targetKeyInfo = await envKeyService.ensureEnvironmentKey({
		client: opts.client,
		projectId: opts.projectId,
		envName: opts.targetEnvironment.name,
		identity: opts.identity,
	});

	const signingPrivateKey = new Uint8Array(
		Buffer.from(opts.identity.signingKey.privateKey, 'base64'),
	);

	const sourceMetadata = await loadSourceVariableMetadata({
		client: opts.client,
		projectId: opts.projectId,
		sourceEnvironmentName: opts.sourceEnvironmentName,
		selectedKeys: opts.selectedKeys,
		includeValues: opts.includeValues,
		identityDeviceId: opts.identity.deviceId,
	});

	const missing = opts.includeValues
		? opts.selectedKeys.filter((key) => !sourceMetadata.get(key)?.sourceValuePresent)
		: [];
	if (missing.length > 0) {
		throw new Error(`Unable to decrypt current value for: ${missing.join(', ')}.`);
	}

	const entries: CreateEnvironmentVariablePromotionRequestEntryJson[] = [];
	for (const key of opts.selectedKeys) {
		const source = sourceMetadata.get(key) ?? {
			name: key,
			sourceValuePresent: false,
		};

		const plaintext = opts.includeValues ? (source.value ?? '') : '';
		const lineBytes = source.lineBytes ?? Buffer.byteLength(plaintext, 'utf8');

		const payload = await buildSecretPayload({
			org: organizationId,
			project: opts.projectId,
			env: opts.targetEnvironment.name,
			name: key,
			plaintext,
			keyMaterial: targetKeyInfo.key,
			edPriv: signingPrivateKey,
			envKekVersion: targetKeyInfo.version,
			envKekFingerprint: targetKeyInfo.fingerprint,
			meta: {
				lineBytes,
				isCommented: source.isCommented,
			},
		});

		entries.push({
			name: key,
			source_if_version: source.sourceIfVersion,
			line_bytes: lineBytes,
			is_commented: source.isCommented,
			source_value_present: source.sourceValuePresent,
			payload,
		});
	}

	return {
		device_id: opts.identity.deviceId,
		target_environment_id: opts.targetEnvironment.id,
		target_key_version: targetKeyInfo.version,
		include_values: opts.includeValues,
		entries,
	};
}

async function attemptKeyShareRecovery(opts: {
	client: GhostableClient;
	projectId: string;
	targetEnvironment: Environment;
	identity: Awaited<ReturnType<typeof requireDeviceIdentity>>;
	requestIds: string[];
}): Promise<void> {
	await reshareEnvironmentKey({
		client: opts.client,
		projectId: opts.projectId,
		envId: opts.targetEnvironment.id,
		envName: opts.targetEnvironment.name,
		identity: opts.identity,
		requestIds: opts.requestIds,
	});
}

async function runPromoteCreate(options: PromoteCreateOptions, command: Command): Promise<void> {
	const context = await requireProjectContext();
	const client = await requireAuthedClient();
	const identity = await requireDeviceIdentity();

	try {
		const environments = await client.getEnvironments(context.projectId);
		const sourceEnvironment = await resolveEnvironmentChoice(environments, {
			label: 'Select source environment',
			provided: options.sourceEnv,
		});
		const targetEnvironment = await resolveEnvironmentChoice(environments, {
			label: 'Select target environment',
			provided: options.targetEnv,
			exclude: new Set([sourceEnvironment.name]),
		});

		const sourceKeyResponse = await client.getEnvironmentKeys(
			context.projectId,
			sourceEnvironment.name,
		);
		const sourceKeys = sourceKeyResponse.data
			.map((item) => item.name)
			.filter((name, index, all) => all.indexOf(name) === index)
			.sort((left, right) => left.localeCompare(right));

		if (!sourceKeys.length) {
			throw new Error(`No variables found in "${sourceEnvironment.name}".`);
		}

		const selectedKeys = await resolveVariableKeys({
			allSourceKeys: sourceKeys,
			providedKeys: options.keys,
		});

		const includeValuesSource = command.getOptionValueSource?.('includeValues');
		const includeValues = await resolveIncludeValues({
			explicit: options.includeValues,
			explicitlySet: Boolean(includeValuesSource && includeValuesSource !== 'default'),
		});

		try {
			const preview = await client.previewVariablePromotionRequest(
				context.projectId,
				sourceEnvironment.name,
				{
					target_environment_id: targetEnvironment.id,
					entries: selectedKeys.map((name) => ({ name })),
				},
			);

			if (preview.can_view_target_variables) {
				log.info(
					`Preview: create ${preview.creates_count ?? 0}, update ${preview.updates_count ?? 0}, overlap ${preview.overlap_count ?? 0}.`,
				);
			} else {
				log.info(
					'Preview: overlap details are hidden by permissions on the target environment.',
				);
			}
		} catch (error) {
			log.warn(`⚠️ Could not load promotion preview: ${toErrorMessage(error)}`);
		}

		if (!options.yes) {
			const shouldSubmit = await promptWithCancel(() =>
				confirm({
					message: `Submit promotion request from ${sourceEnvironment.name} to ${targetEnvironment.name}?`,
					default: true,
				}),
			);
			if (!shouldSubmit) {
				log.warn('Promotion request canceled.');
				return;
			}
		}

		const request = await buildPromotionCreateRequest({
			client,
			projectId: context.projectId,
			sourceEnvironmentName: sourceEnvironment.name,
			targetEnvironment,
			selectedKeys,
			includeValues,
			identity,
		});

		const idempotencyKey = options.idempotencyKey?.trim() || randomUUID();

		try {
			const response = await client.createVariablePromotionRequest(
				context.projectId,
				sourceEnvironment.name,
				request,
				{ idempotencyKey },
			);
			const createdId = response.data?.id ?? 'unknown';
			log.ok(
				`✅ Created promotion request ${createdId} (${selectedKeys.length} key${selectedKeys.length === 1 ? '' : 's'}).`,
			);
			return;
		} catch (error) {
			if (!isLikelyEnvironmentKeyAccessError(error)) {
				throw error;
			}

			log.warn(
				'⚠️ Initial promotion submit failed with key/signature access error. Attempting one key-share recovery and retry.',
			);
			await attemptKeyShareRecovery({
				client,
				projectId: context.projectId,
				targetEnvironment,
				identity,
				requestIds: keyReshareRecoveryIds(error),
			});

			const retryResponse = await client.createVariablePromotionRequest(
				context.projectId,
				sourceEnvironment.name,
				request,
				{ idempotencyKey },
			);

			const createdId = retryResponse.data?.id ?? 'unknown';
			log.ok(
				`✅ Created promotion request ${createdId} (${selectedKeys.length} key${selectedKeys.length === 1 ? '' : 's'}).`,
			);
		}
	} catch (error) {
		log.error(`❌ Failed to create promotion request: ${toErrorMessage(error)}`);
		process.exit(1);
	}
}

function hasExplicitCreateInputs(options: PromoteCreateOptions, command: Command): boolean {
	const includeValuesSource = command.getOptionValueSource?.('includeValues');
	const includeValuesExplicit = Boolean(includeValuesSource) && includeValuesSource !== 'default';

	return (
		Boolean(normalizeEnvironmentName(options.sourceEnv)) ||
		Boolean(normalizeEnvironmentName(options.targetEnv)) ||
		normalizeKeyInput(options.keys).length > 0 ||
		Boolean(normalizeEnvironmentName(options.idempotencyKey)) ||
		Boolean(options.yes) ||
		includeValuesExplicit
	);
}

async function runPromoteEntry(options: PromoteCreateOptions, command: Command): Promise<void> {
	const isInteractive = Boolean(process.stdin.isTTY && process.stdout.isTTY);
	if (!isInteractive || hasExplicitCreateInputs(options, command)) {
		await runPromoteCreate(options, command);
		return;
	}

	const action = await promptWithCancel(() =>
		select<'create' | 'pending' | 'review'>({
			message: 'What do you want to do?',
			choices: [
				{
					name: 'Create promotion request',
					value: 'create',
				},
				{
					name: 'Review pending request',
					value: 'review',
				},
				{
					name: 'List pending requests',
					value: 'pending',
				},
			],
		}),
	);

	if (action === 'pending') {
		await runPromotePending({});
		return;
	}

	if (action === 'review') {
		await runPromoteReview(undefined, {});
		return;
	}

	await runPromoteCreate(options, command);
}

function logPromotionRequestSummary(entry: PromotionRequestResolution): void {
	const request = entry.request;
	const attrs = request.attributes;
	const sourceName = attrs.source_environment_name ?? entry.sourceEnvironmentName;
	const targetName = attrs.target_environment_name ?? attrs.target_environment_id;
	const createdAt = attrs.created_at ? ` | ${attrs.created_at}` : '';
	const includeValues = attrs.include_values ? 'values included' : 'values blank';

	log.text(
		`${request.id} | ${sourceName} -> ${targetName} | ${attrs.status} | ${attrs.entry_count} key(s) | ${includeValues}${createdAt}`,
	);
	log.text(`  Keys: ${formatEntryNames(attrs.entries)}`);
}

async function runPromotePending(options: PromotePendingOptions): Promise<void> {
	const context = await requireProjectContext();
	const client = await requireAuthedClient();

	try {
		const requests = await listProjectPromotionRequests({
			client,
			projectId: context.projectId,
			status: 'pending',
		});

		if (options.json) {
			process.stdout.write(`${JSON.stringify(requests, null, 2)}\n`);
			return;
		}

		if (!requests.length) {
			log.info('No pending variable promotion requests for this project.');
			return;
		}

		log.info(`Pending variable promotion requests (${requests.length}):`);
		for (const request of requests) {
			logPromotionRequestSummary(request);
		}
	} catch (error) {
		log.error(`❌ Failed to load pending promotion requests: ${toErrorMessage(error)}`);
		process.exit(1);
	}
}

async function resolvePromotionRequestForAction(opts: {
	client: GhostableClient;
	projectId: string;
	requestId?: string;
	promptMessage: string;
}): Promise<PromotionRequestResolution> {
	if (opts.requestId?.trim()) {
		const found = await findPromotionRequest({
			client: opts.client,
			projectId: opts.projectId,
			requestId: opts.requestId.trim(),
		});
		if (!found) {
			throw new Error(`Promotion request "${opts.requestId}" was not found in this project.`);
		}

		return found;
	}

	const pending = await listProjectPromotionRequests({
		client: opts.client,
		projectId: opts.projectId,
		status: 'pending',
	});
	if (!pending.length) {
		throw new Error('No pending promotion requests found.');
	}

	const selectedId = await promptWithCancel(() =>
		select<string>({
			message: opts.promptMessage,
			choices: pending.map((entry) => ({
				name: `${entry.request.id} | ${entry.request.attributes.source_environment_name ?? entry.sourceEnvironmentName} -> ${entry.request.attributes.target_environment_name ?? entry.request.attributes.target_environment_id} | ${entry.request.attributes.entry_count} key(s)`,
				value: entry.request.id,
			})),
		}),
	);

	const selected = pending.find((entry) => entry.request.id === selectedId);
	if (!selected) {
		throw new Error('Invalid promotion request selection.');
	}
	return selected;
}

function ensurePendingRequest(request: EnvironmentVariablePromotionRequestResourceJson): boolean {
	return request.attributes.status === 'pending';
}

async function resolveOverrideMap(
	request: EnvironmentVariablePromotionRequestResourceJson,
	setValues: string[] | undefined,
	interactiveFallback: boolean,
): Promise<Map<string, string>> {
	const overrides = parseSetOverrides(setValues ?? []);
	const entriesByName = new Map<string, EnvironmentVariablePromotionRequestEntryJson>(
		request.attributes.entries.map((entry) => [entry.name, entry] as const),
	);

	const unknownKeys = Array.from(overrides.keys()).filter((key) => !entriesByName.has(key));
	if (unknownKeys.length > 0) {
		throw new Error(`Override key(s) not found in request: ${unknownKeys.join(', ')}`);
	}

	if (request.attributes.include_values) {
		const missingPayloadKeys = request.attributes.entries
			.filter((entry) => {
				const hasPayload = Boolean(entry.payload || entry.has_payload);
				return !hasPayload || entry.source_value_present === false;
			})
			.map((entry) => entry.name);

		for (const key of missingPayloadKeys) {
			if (overrides.has(key)) {
				continue;
			}

			if (!interactiveFallback) {
				throw new Error(`Missing value for "${key}". Provide it with --set ${key}=VALUE.`);
			}

			const value = await promptWithCancel(() =>
				input({
					message: `Enter value for ${key}`,
				}),
			);

			overrides.set(key, value);
		}
	}

	return overrides;
}

async function buildApproveOverrideBody(opts: {
	client: GhostableClient;
	projectId: string;
	request: EnvironmentVariablePromotionRequestResourceJson;
	overrideValues: Map<string, string>;
	identity: Awaited<ReturnType<typeof requireDeviceIdentity>>;
}): Promise<{
	body?: { device_id?: string; entries?: EnvironmentVariablePromotionReviewOverrideEntryJson[] };
	targetEnvironment: Environment;
}> {
	const targetId = opts.request.attributes.target_environment_id;
	const environments = await opts.client.getEnvironments(opts.projectId);
	const targetEnvironment = environments.find((environment) => environment.id === targetId);
	if (!targetEnvironment) {
		throw new Error('Target environment for this request could not be resolved.');
	}

	if (!opts.overrideValues.size) {
		return {
			body: undefined,
			targetEnvironment,
		};
	}

	const organizationId = await resolveOrganizationId(opts.client, opts.projectId);
	const envKeyService = await EnvironmentKeyService.create();
	const targetKeyInfo = await envKeyService.ensureEnvironmentKey({
		client: opts.client,
		projectId: opts.projectId,
		envName: targetEnvironment.name,
		identity: opts.identity,
	});

	const signingPrivateKey = new Uint8Array(
		Buffer.from(opts.identity.signingKey.privateKey, 'base64'),
	);

	const entriesByName = new Map<string, EnvironmentVariablePromotionRequestEntryJson>(
		opts.request.attributes.entries.map((entry) => [entry.name, entry] as const),
	);

	const overrides: EnvironmentVariablePromotionReviewOverrideEntryJson[] = [];
	for (const [key, value] of opts.overrideValues.entries()) {
		const sourceEntry = entriesByName.get(key);
		if (!sourceEntry) {
			continue;
		}

		const lineBytes = sourceEntry.line_bytes ?? Buffer.byteLength(value, 'utf8');
		const payload = await buildSecretPayload({
			org: organizationId,
			project: opts.projectId,
			env: targetEnvironment.name,
			name: key,
			plaintext: value,
			keyMaterial: targetKeyInfo.key,
			edPriv: signingPrivateKey,
			envKekVersion: targetKeyInfo.version,
			envKekFingerprint: targetKeyInfo.fingerprint,
			meta: {
				lineBytes,
				isCommented: sourceEntry.is_commented ?? undefined,
			},
		});

		const payloadSigningJson = buildPromotionPayloadSigningJSON(payload);

		overrides.push({
			name: key,
			payload,
			payload_signing_json: payloadSigningJson,
		});
	}

	return {
		targetEnvironment,
		body: {
			device_id: opts.identity.deviceId,
			entries: overrides,
		},
	};
}

async function runApproveRequest(opts: {
	client: GhostableClient;
	projectId: string;
	requestResolution: PromotionRequestResolution;
	setValues?: string[];
	interactiveFallback: boolean;
}): Promise<void> {
	const identity = await requireDeviceIdentity();
	const request = opts.requestResolution.request;

	if (!ensurePendingRequest(request)) {
		log.warn(`Promotion request ${request.id} is already ${request.attributes.status}.`);
		return;
	}

	const overrideValues = await resolveOverrideMap(
		request,
		opts.setValues,
		opts.interactiveFallback,
	);
	const approveRequest = await buildApproveOverrideBody({
		client: opts.client,
		projectId: opts.projectId,
		request,
		overrideValues,
		identity,
	});

	try {
		await opts.client.approveVariablePromotionRequest(
			opts.projectId,
			opts.requestResolution.sourceEnvironmentName,
			request.id,
			approveRequest.body,
		);
		log.ok(`✅ Approved promotion request ${request.id}.`);
		return;
	} catch (error) {
		if (!isLikelyEnvironmentKeyAccessError(error)) {
			throw error;
		}

		log.warn(
			'⚠️ Approval failed with key/signature access error. Attempting one key-share recovery and retry.',
		);
		await attemptKeyShareRecovery({
			client: opts.client,
			projectId: opts.projectId,
			targetEnvironment: approveRequest.targetEnvironment,
			identity,
			requestIds: keyReshareRecoveryIds(error),
		});

		await opts.client.approveVariablePromotionRequest(
			opts.projectId,
			opts.requestResolution.sourceEnvironmentName,
			request.id,
			approveRequest.body,
		);
		log.ok(`✅ Approved promotion request ${request.id}.`);
	}
}

async function runRejectRequest(opts: {
	client: GhostableClient;
	projectId: string;
	requestResolution: PromotionRequestResolution;
	reason?: string;
}): Promise<void> {
	const request = opts.requestResolution.request;
	if (!ensurePendingRequest(request)) {
		log.warn(`Promotion request ${request.id} is already ${request.attributes.status}.`);
		return;
	}

	await opts.client.rejectVariablePromotionRequest(
		opts.projectId,
		opts.requestResolution.sourceEnvironmentName,
		request.id,
		opts.reason,
	);
	log.ok(`✅ Rejected promotion request ${request.id}.`);
}

async function runCancelRequest(opts: {
	client: GhostableClient;
	projectId: string;
	requestResolution: PromotionRequestResolution;
	reason?: string;
}): Promise<void> {
	const request = opts.requestResolution.request;
	if (!ensurePendingRequest(request)) {
		log.warn(`Promotion request ${request.id} is already ${request.attributes.status}.`);
		return;
	}

	await opts.client.cancelVariablePromotionRequest(
		opts.projectId,
		opts.requestResolution.sourceEnvironmentName,
		request.id,
		opts.reason,
	);
	log.ok(`✅ Canceled promotion request ${request.id}.`);
}

function showRequestDetail(requestResolution: PromotionRequestResolution): void {
	const request = requestResolution.request;
	const attrs = request.attributes;
	log.info(`Request: ${request.id}`);
	log.text(
		`Source -> Target: ${attrs.source_environment_name ?? requestResolution.sourceEnvironmentName} -> ${attrs.target_environment_name ?? attrs.target_environment_id}`,
	);
	log.text(`Status: ${attrs.status}`);
	log.text(`Include values: ${attrs.include_values ? 'yes' : 'no'}`);
	log.text(`Entries (${attrs.entry_count}): ${formatEntryNames(attrs.entries)}`);
}

async function runPromoteReview(
	requestId: string | undefined,
	options: PromoteReviewOptions,
): Promise<void> {
	const context = await requireProjectContext();
	const client = await requireAuthedClient();

	try {
		const requestResolution = await resolvePromotionRequestForAction({
			client,
			projectId: context.projectId,
			requestId,
			promptMessage: 'Select a promotion request to review',
		});

		showRequestDetail(requestResolution);

		const request = requestResolution.request;
		if (!ensurePendingRequest(request)) {
			log.warn(`Promotion request ${request.id} is already ${request.attributes.status}.`);
			return;
		}

		const decision = await promptWithCancel(() =>
			select<'approve' | 'reject' | 'cancel'>({
				message: 'Choose review decision',
				choices: [
					{ name: 'Approve', value: 'approve' },
					{ name: 'Reject', value: 'reject' },
					{ name: 'Cancel request', value: 'cancel' },
				],
			}),
		);

		if (decision === 'approve') {
			await runApproveRequest({
				client,
				projectId: context.projectId,
				requestResolution,
				setValues: options.set,
				interactiveFallback: true,
			});
			return;
		}

		const reason = await promptWithCancel(() =>
			input({
				message:
					decision === 'reject' ? 'Reject reason (optional)' : 'Cancel reason (optional)',
			}),
		);

		if (decision === 'reject') {
			await runRejectRequest({
				client,
				projectId: context.projectId,
				requestResolution,
				reason: reason.trim() || undefined,
			});
			return;
		}

		await runCancelRequest({
			client,
			projectId: context.projectId,
			requestResolution,
			reason: reason.trim() || undefined,
		});
	} catch (error) {
		const code = extractServerErrorCode(error);
		if (code && PROMOTION_TERMINAL_CODES.has(code)) {
			log.warn('⚠️ This promotion request has already been resolved.');
			return;
		}

		log.error(`❌ Failed to review promotion request: ${toErrorMessage(error)}`);
		process.exit(1);
	}
}

async function runPromoteApprove(requestId: string, options: PromoteApproveOptions): Promise<void> {
	const context = await requireProjectContext();
	const client = await requireAuthedClient();

	try {
		const requestResolution = await resolvePromotionRequestForAction({
			client,
			projectId: context.projectId,
			requestId,
			promptMessage: 'Select a promotion request to approve',
		});

		await runApproveRequest({
			client,
			projectId: context.projectId,
			requestResolution,
			setValues: options.set,
			interactiveFallback: Boolean(process.stdin.isTTY && process.stdout.isTTY),
		});
	} catch (error) {
		const code = extractServerErrorCode(error);
		if (code && PROMOTION_TERMINAL_CODES.has(code)) {
			log.warn('⚠️ This promotion request has already been resolved.');
			return;
		}

		log.error(`❌ Failed to approve promotion request: ${toErrorMessage(error)}`);
		process.exit(1);
	}
}

async function runPromoteReject(requestId: string, options: PromoteRejectOptions): Promise<void> {
	const context = await requireProjectContext();
	const client = await requireAuthedClient();

	try {
		const requestResolution = await resolvePromotionRequestForAction({
			client,
			projectId: context.projectId,
			requestId,
			promptMessage: 'Select a promotion request to reject',
		});

		const reason =
			options.reason?.trim() ||
			(process.stdin.isTTY && process.stdout.isTTY
				? (
						await promptWithCancel(() => input({ message: 'Reject reason (optional)' }))
					).trim()
				: '');

		await runRejectRequest({
			client,
			projectId: context.projectId,
			requestResolution,
			reason: reason || undefined,
		});
	} catch (error) {
		const code = extractServerErrorCode(error);
		if (code && PROMOTION_TERMINAL_CODES.has(code)) {
			log.warn('⚠️ This promotion request has already been resolved.');
			return;
		}

		log.error(`❌ Failed to reject promotion request: ${toErrorMessage(error)}`);
		process.exit(1);
	}
}

async function runPromoteCancel(requestId: string, options: PromoteCancelOptions): Promise<void> {
	const context = await requireProjectContext();
	const client = await requireAuthedClient();

	try {
		const requestResolution = await resolvePromotionRequestForAction({
			client,
			projectId: context.projectId,
			requestId,
			promptMessage: 'Select a promotion request to cancel',
		});

		const reason =
			options.reason?.trim() ||
			(process.stdin.isTTY && process.stdout.isTTY
				? (
						await promptWithCancel(() => input({ message: 'Cancel reason (optional)' }))
					).trim()
				: '');

		await runCancelRequest({
			client,
			projectId: context.projectId,
			requestResolution,
			reason: reason || undefined,
		});
	} catch (error) {
		const code = extractServerErrorCode(error);
		if (code && PROMOTION_TERMINAL_CODES.has(code)) {
			log.warn('⚠️ This promotion request has already been resolved.');
			return;
		}

		log.error(`❌ Failed to cancel promotion request: ${toErrorMessage(error)}`);
		process.exit(1);
	}
}

export function registerEnvPromoteCommand(program: Command): void {
	registerEnvSubcommand(
		program,
		{
			subcommand: 'promote',
		},
		(cmd) => {
			const promote = cmd
				.description('Create and review variable promotion requests between environments')
				.option('--source-env <ENV>', 'Source environment name')
				.option('--target-env <ENV>', 'Target environment name')
				.option('--keys <KEY>', 'Variable key to include (repeatable)', collectValues, [])
				.option('--include-values', 'Include current values in the request')
				.option('--idempotency-key <KEY>', 'Idempotency key for create retries')
				.option('--yes', 'Skip confirmation prompts')
				.action(async (options: PromoteCreateOptions, command: Command) =>
					runPromoteEntry(options, command),
				);

			promote
				.command('pending')
				.description('List pending variable promotion requests for the current project')
				.option('--json', 'Print raw JSON output')
				.action(async (options: PromotePendingOptions) => runPromotePending(options));

			promote
				.command('review [requestId]')
				.description('Interactively review a variable promotion request')
				.option(
					'--set <KEY=VALUE>',
					'Override value while approving (repeatable)',
					collectValues,
					[],
				)
				.action(async (requestId: string | undefined, options: PromoteReviewOptions) =>
					runPromoteReview(requestId, options),
				);

			promote
				.command('approve <requestId>')
				.description('Approve a pending promotion request')
				.option(
					'--set <KEY=VALUE>',
					'Override value before approval (repeatable)',
					collectValues,
					[],
				)
				.action(async (requestId: string, options: PromoteApproveOptions) =>
					runPromoteApprove(requestId, options),
				);

			promote
				.command('reject <requestId>')
				.description('Reject a pending promotion request')
				.option('--reason <TEXT>', 'Rejection reason')
				.action(async (requestId: string, options: PromoteRejectOptions) =>
					runPromoteReject(requestId, options),
				);

			promote
				.command('cancel <requestId>')
				.description('Cancel a pending promotion request')
				.option('--reason <TEXT>', 'Cancellation reason')
				.action(async (requestId: string, options: PromoteCancelOptions) =>
					runPromoteCancel(requestId, options),
				);

			return promote;
		},
	);
}
