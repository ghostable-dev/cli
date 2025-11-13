import path from 'node:path';
import { Command } from 'commander';
import { select, confirm } from '@inquirer/prompts';
import chalk from 'chalk';

import {
	initSodium,
	b64,
	edSign,
	deriveKeys,
	aeadDecrypt,
	scopeFromAAD,
	type DeviceIdentity,
} from '@/crypto';
import { config } from '../../config/index.js';
import { SessionService } from '../../services/SessionService.js';
import { DeviceIdentityService } from '../../services/DeviceIdentityService.js';
import { GhostableClient } from '@/ghostable';
import { Manifest } from '../../support/Manifest.js';
import { log } from '../../support/logger.js';
import { toErrorMessage } from '../../support/errors.js';
import { resolveEnvironmentChoice } from '@/support/environment-select.js';
import { promptWithCancel } from '@/support/prompts.js';
import { registerVarSubcommand } from './_shared.js';
import { formatHistoryActor } from '@/support/history.js';
import { formatRelativeRecency, formatDateTimeWithRelative } from '@/support/dates.js';
import { resolveEnvFile } from '@/environment/files/env-files.js';
import { upsertEnvValue } from '@/environment/files/env-upsert.js';
import { resolveWorkDir } from '@/support/workdir.js';
import { EnvironmentKeyService } from '@/environment/keys/EnvironmentKeyService.js';
import type { VariableHistoryEntry } from '@/ghostable/types/history.js';
import {
	rollbackVariableRequestToJSON,
	type SignedRollbackVariableRequestJson,
} from '@/ghostable/types/rollback.js';
import type { EnvironmentSecret } from '@/entities';

type VarRollbackOptions = {
	env?: string;
	key?: string;
	version?: string;
	token?: string;
	ifVersion?: string;
	yes?: boolean;
	file?: string;
	syncLocal?: boolean;
	skipLocalSync?: boolean;
};

type RollbackRequestBody = Omit<SignedRollbackVariableRequestJson, 'client_sig'>;

const encoder = new TextEncoder();

async function signRollbackRequest(
	body: RollbackRequestBody,
	signingKeyB64: string,
): Promise<SignedRollbackVariableRequestJson> {
	const bytes = encoder.encode(JSON.stringify(body));
	const priv = Buffer.from(signingKeyB64, 'base64');
	const sig = await edSign(priv, bytes);
	return {
		...body,
		client_sig: b64(sig),
	};
}

async function selectVariableName(
	client: GhostableClient,
	projectId: string,
	envName: string,
): Promise<string> {
	let response;
	try {
		response = await client.getEnvironmentKeys(projectId, envName);
	} catch (error) {
		log.error(`❌ Failed to load variables: ${toErrorMessage(error)}`);
		process.exit(1);
	}

	if (!response.data.length) {
		log.warn(`No variables found for environment "${envName}".`);
		process.exit(1);
	}

	const choices = response.data.map((item) => ({
		name: item.version ? `${item.name} (v${item.version})` : item.name,
		value: item.name,
	}));

	return promptWithCancel(() =>
		select<string>({
			message: `Select a variable from ${envName}:`,
			choices,
		}),
	);
}

function formatVersionChoice(entry: VariableHistoryEntry): string {
	const actor = formatHistoryActor(entry.actor);
	const when = formatRelativeRecency(entry.occurredAt);
	const size = entry.line?.display ? ` · ${entry.line.display}` : '';
	const source = entry.operation ? ` · ${entry.operation}` : '';
	return `v${entry.version}${source} · ${actor} · ${when}${size}`;
}

async function selectTargetVersion(entries: VariableHistoryEntry[]): Promise<VariableHistoryEntry> {
	const choices = entries.map((entry) => ({
		name: formatVersionChoice(entry),
		value: entry.version,
	}));

	const selected = await promptWithCancel(() =>
		select<number>({
			message: 'Select a version to roll back to:',
			choices,
		}),
	);

	const entry = entries.find((item) => item.version === selected);
	if (!entry) {
		throw new Error(`Selected version v${selected} was not found in history.`);
	}
	return entry;
}

function requireVersionEntry(
	entries: VariableHistoryEntry[],
	version: number,
): VariableHistoryEntry {
	const entry = entries.find((item) => item.version === version);
	if (!entry) {
		log.error(`❌ Version v${version} was not found in the variable history.`);
		process.exit(1);
	}
	return entry;
}

function ensureVersionId(entry: VariableHistoryEntry): string {
	if (entry.versionId) {
		return entry.versionId;
	}
	if (entry.variable?.versionId) {
		return entry.variable.versionId;
	}
	log.error(
		'❌ The API did not return a version identifier for the selected history entry. Please update the CLI.',
	);
	process.exit(1);
}

function parseIntegerOption(value: string | undefined, label: string): number | undefined {
	if (!value?.trim()) {
		return undefined;
	}
	const parsed = Number.parseInt(value.trim(), 10);
	if (!Number.isFinite(parsed) || parsed < 0) {
		log.error(`❌ Invalid ${label}: expected a positive integer.`);
		process.exit(1);
	}
	return parsed;
}

function assertConfirmCapability(opts: VarRollbackOptions) {
	if (!opts.yes && (!process.stdin.isTTY || !process.stdout.isTTY)) {
		log.error(
			'❌ This rollback requires confirmation in non-interactive mode. Re-run with --yes to proceed.',
		);
		process.exit(1);
	}
}

function logRollbackResult(
	projectName: string,
	envName: string,
	varName: string,
	result: Awaited<ReturnType<GhostableClient['rollbackVariable']>>,
) {
	const { variable, previousHeadVersion, snapshotId, updatedAtIso, updatedBy } = result.data;
	const scopeLabel = `${projectName}/${envName}/${varName}`;
	const headLabel = typeof variable.version === 'number' ? `v${variable.version}` : 'unknown';
	let message = `✅ Rolled ${chalk.bold(scopeLabel)} back to ${headLabel}.`;
	if (typeof previousHeadVersion === 'number' && previousHeadVersion !== variable.version) {
		message += ` Previous head was v${previousHeadVersion}.`;
	}
	log.ok(message);

	if (typeof variable.rolledBackToVersion === 'number') {
		log.info(`Restored snapshot from v${variable.rolledBackToVersion}.`);
	}

	if (snapshotId) {
		log.info(`Snapshot ID: ${snapshotId}`);
	}

	if (updatedBy?.label) {
		log.info(`Updated by ${updatedBy.label}`);
	}

	if (updatedAtIso) {
		log.info(`Updated at ${formatDateTimeWithRelative(updatedAtIso)}`);
	}
}

function formatEnvFileLabel(filePath: string): string {
	const rel = path.relative(resolveWorkDir(), filePath);
	return rel && rel !== '' ? rel : path.basename(filePath);
}

async function fetchRolledBackVariableValue(opts: {
	client: GhostableClient;
	projectId: string;
	envName: string;
	keyName: string;
	identity: DeviceIdentity;
}): Promise<{ value: string; commented: boolean } | null> {
	let bundle;
	try {
		bundle = await opts.client.pull(opts.projectId, opts.envName, {
			includeMeta: true,
			includeVersions: true,
			only: [opts.keyName],
			deviceId: opts.identity.deviceId,
		});
	} catch (error) {
		log.warn(
			`⚠️ Failed to download the rolled back value for ${opts.keyName}: ${toErrorMessage(error)}`,
		);
		return null;
	}

	if (!bundle.secrets.length) {
		log.warn(`⚠️ No data returned for ${opts.keyName}; local file was not updated.`);
		return null;
	}

	let envKeyService: EnvironmentKeyService;
	try {
		envKeyService = await EnvironmentKeyService.create();
	} catch (error) {
		log.warn(`⚠️ Failed to access environment keys: ${toErrorMessage(error)}`);
		return null;
	}

	const envKeys = new Map<string, Uint8Array>();
	const envs = new Set<string>();
	for (const layer of bundle.chain) {
		envs.add(layer);
	}
	for (const entry of bundle.secrets) {
		envs.add(entry.env);
	}

	for (const env of envs) {
		try {
			const { key } = await envKeyService.ensureEnvironmentKey({
				client: opts.client,
				projectId: opts.projectId,
				envName: env,
				identity: opts.identity,
			});
			envKeys.set(env, key);
		} catch (error) {
			log.warn(
				`⚠️ Missing decryption key for ${env}: ${toErrorMessage(error)}. Skipping its values.`,
			);
		}
	}

	const byEnv = new Map<string, EnvironmentSecret[]>();
	for (const entry of bundle.secrets) {
		if (!byEnv.has(entry.env)) byEnv.set(entry.env, []);
		byEnv.get(entry.env)!.push(entry);
	}

	const decoder = new TextDecoder();
	for (const layer of bundle.chain) {
		const entries = byEnv.get(layer) ?? [];
		for (const entry of entries) {
			if (!envKeys.has(entry.env)) continue;

			const scope = scopeFromAAD(entry.aad);
			const { encKey } = deriveKeys(envKeys.get(entry.env)!, scope);
			try {
				const plaintext = aeadDecrypt(encKey, {
					alg: entry.alg,
					nonce: entry.nonce,
					ciphertext: entry.ciphertext,
					aad: entry.aad,
				});
				const value = decoder.decode(plaintext);
				if (entry.name === opts.keyName) {
					return {
						value,
						commented: Boolean(entry.meta?.is_commented),
					};
				}
			} catch {
				log.warn(`⚠️ Could not decrypt ${entry.name}; skipping.`);
			}
		}
	}

	log.warn(
		`⚠️ The rolled back value for ${opts.keyName} could not be decrypted locally, so the .env file was left unchanged.`,
	);
	return null;
}

async function syncLocalEnvFile(params: {
	client: GhostableClient;
	projectId: string;
	envName: string;
	keyName: string;
	identity: DeviceIdentity;
	filePath: string;
}): Promise<boolean> {
	const result = await fetchRolledBackVariableValue(params);
	if (!result) return false;

	try {
		upsertEnvValue(params.filePath, params.keyName, result.value, result.commented);
		return true;
	} catch (error) {
		log.warn(
			`⚠️ Failed to update ${formatEnvFileLabel(params.filePath)}: ${toErrorMessage(error)}`,
		);
		return false;
	}
}

export function registerVarRollbackCommand(program: Command) {
	registerVarSubcommand(program, { subcommand: 'rollback' }, (cmd) =>
		cmd
			.description('Roll back a single variable to a previous version')
			.option('--env <ENV>', 'Environment name (prompted if omitted)')
			.option('--key <KEY>', 'Variable name (prompted if omitted)')
			.option('--version <VERSION>', 'Version number to roll back to (prompted if omitted)')
			.option('--if-version <VERSION>', 'Override the optimistic locking head version')
			.option('--token <TOKEN>', 'API token (or stored session / GHOSTABLE_TOKEN)')
			.option(
				'--file <PATH>',
				'Path to .env file when syncing locally (default: .env.<env> or .env)',
			)
			.option(
				'--sync-local',
				'Update the local .env file after the rollback without prompting',
			)
			.option('--skip-local-sync', 'Do not prompt to sync the local .env file')
			.option('-y, --yes', 'Skip the confirmation prompt')
			.action(async (opts: VarRollbackOptions) => {
				let projectId: string;
				let projectName: string;
				let envNames: string[];

				try {
					projectId = Manifest.id();
					projectName = Manifest.name();
					envNames = Manifest.environmentNames();
				} catch (error) {
					log.error(toErrorMessage(error));
					process.exit(1);
					return;
				}

				const envName = (
					await resolveEnvironmentChoice(
						envNames,
						opts.env,
						'Select an environment to roll back:',
					)
				).trim();

				let token = opts.token?.trim() || process.env.GHOSTABLE_TOKEN?.trim() || '';
				const sessionService = new SessionService();
				if (!token) {
					const session = await sessionService.load();
					if (!session?.accessToken) {
						log.error(
							'❌ Not authenticated. Run `ghostable login`, set GHOSTABLE_TOKEN, or pass --token.',
						);
						process.exit(1);
						return;
					}
					token = session.accessToken;
				}

				const client = GhostableClient.unauthenticated(config.apiBase).withToken(token);

				let keyName = opts.key?.trim();
				if (!keyName) {
					keyName = await selectVariableName(client, projectId, envName);
				}

				let history;
				try {
					history = await client.getVariableHistory(projectId, envName, keyName!);
				} catch (error) {
					log.error(`❌ Failed to load history entries: ${toErrorMessage(error)}`);
					process.exit(1);
					return;
				}

				if (!history.entries.length) {
					log.warn('No history entries were returned for this variable.');
					process.exit(1);
				}

				const entriesWithIds = history.entries
					.filter((entry) => Boolean(entry.versionId || entry.variable?.versionId))
					.sort((a, b) => b.version - a.version);

				if (!entriesWithIds.length) {
					const missingSummaries = history.entries.slice(0, 5).map((entry) => {
						const versionLabel =
							typeof entry.version === 'number'
								? `v${entry.version}`
								: 'unknown version';
						const missingFields = [
							!entry.versionId && 'entry.versionId',
							!entry.variable?.versionId && 'variable.versionId',
						].filter(Boolean);
						const actor = formatHistoryActor(entry.actor);
						const when = entry.occurredAt ?? 'time unknown';
						const operation = entry.operation ?? 'operation unknown';
						const fieldLabel = missingFields.length
							? missingFields.join(' & ')
							: 'unspecified fields';
						return `${versionLabel} (missing ${fieldLabel}) · ${operation} · ${actor} · ${when}`;
					});
					log.error(
						'❌ The server did not return version identifiers for this variable. Please update the CLI.',
					);
					log.info(
						`Received ${history.entries.length} history entries without version identifiers. Sample: ${missingSummaries.join('; ')}${
							history.entries.length > missingSummaries.length ? ' …' : ''
						}`,
					);
					process.exit(1);
				}

				const targetVersionOverride = parseIntegerOption(opts.version, 'version');
				let targetEntry: VariableHistoryEntry;
				if (targetVersionOverride !== undefined) {
					targetEntry = requireVersionEntry(entriesWithIds, targetVersionOverride);
				} else {
					try {
						targetEntry = await selectTargetVersion(entriesWithIds);
					} catch (error) {
						log.error(toErrorMessage(error));
						process.exit(1);
						return;
					}
				}

				const versionId = ensureVersionId(targetEntry);
				const ifVersionOverride = parseIntegerOption(opts.ifVersion, 'if-version');
				const optimisticHead =
					ifVersionOverride ??
					(typeof history.variable.latestVersion === 'number'
						? history.variable.latestVersion
						: undefined);

				assertConfirmCapability(opts);
				if (!opts.yes) {
					const proceed = await promptWithCancel(() =>
						confirm({
							message: `Roll ${projectName}/${envName}/${keyName} back to v${targetEntry.version}?`,
							default: false,
						}),
					);
					if (!proceed) {
						log.warn('Rollback canceled.');
						return;
					}
				}

				await initSodium();

				let identityService: DeviceIdentityService;
				try {
					identityService = await DeviceIdentityService.create();
				} catch (error) {
					log.error(toErrorMessage(error));
					process.exit(1);
					return;
				}

				let identity;
				try {
					identity = await identityService.requireIdentity();
				} catch (error) {
					log.error(toErrorMessage(error));
					process.exit(1);
					return;
				}

				const requestBody = rollbackVariableRequestToJSON({
					versionId,
					ifVersion: optimisticHead,
				});

				const unsigned: RollbackRequestBody = {
					device_id: identity.deviceId,
					...requestBody,
				};

				let signedRequest: SignedRollbackVariableRequestJson;
				try {
					signedRequest = await signRollbackRequest(
						unsigned,
						identity.signingKey.privateKey,
					);
				} catch (error) {
					log.error(`❌ Failed to sign the rollback request: ${toErrorMessage(error)}`);
					process.exit(1);
					return;
				}

				let result;
				try {
					result = await client.rollbackVariable(
						projectId,
						envName,
						keyName!,
						signedRequest,
					);
				} catch (error) {
					log.error(`❌ Failed to roll back ${keyName}: ${toErrorMessage(error)}`);
					process.exit(1);
					return;
				}

				if (result.status !== 'rolled_back') {
					log.warn(`Unexpected rollback status: ${result.status}`);
				}

				logRollbackResult(projectName, envName, keyName!, result);

				const envFilePath = resolveEnvFile(envName, opts.file);
				const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY);
				const skipLocalPrompt = Boolean(opts.skipLocalSync || opts.yes || !interactive);
				let shouldSyncLocal = Boolean(opts.syncLocal);

				if (!shouldSyncLocal && !skipLocalPrompt) {
					const relPath = formatEnvFileLabel(envFilePath);
					shouldSyncLocal = await promptWithCancel(() =>
						confirm({
							message: `Update ${relPath} with the rolled back value?`,
							default: true,
						}),
					);
				}

				if (shouldSyncLocal) {
					const synced = await syncLocalEnvFile({
						client,
						projectId,
						envName,
						keyName: keyName!,
						identity,
						filePath: envFilePath,
					});
					if (synced) {
						const rel = formatEnvFileLabel(envFilePath);
						log.ok(`✅ Updated ${keyName} in ${rel}`);
					}
				}
			}),
	);
}
