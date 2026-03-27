import path from 'node:path';

import { config } from '@/config/index.js';
import { initSodium, deriveKeys, aeadDecrypt, scopeFromAAD } from '@/crypto';
import type { Environment, EnvironmentSecret, EnvironmentSecretBundle, Project } from '@/entities';
import { EnvFileFormat, renderEnvFile } from '@/environment/files/env-format.js';
import {
	readEnvFileSafe,
	readEnvFileSafeWithMetadata,
	resolveEnvFile,
} from '@/environment/files/env-files.js';
import { EnvironmentKeyService } from '@/environment/keys/EnvironmentKeyService.js';
import {
	loadMergedSchema,
	SchemaNotFoundError,
	validateVariables,
} from '@/environment/validation/schema.js';
import type { SchemaDefinition } from '@/environment/validation/schema.js';
import { GhostableClient } from '@/ghostable';
import { KeyReshareRequiredError } from '@/ghostable/key-reshare-errors.js';
import type { EnvironmentHistoryEntry } from '@/ghostable/types/history.js';
import type { ListEnvironmentKeyReshareRequestsOptions } from '@/ghostable/types/index.js';
import { getIgnoredKeys, filterIgnoredKeys } from '@/support/ignore.js';
import { Manifest } from '@/support/Manifest.js';
import { toErrorMessage } from '@/support/errors.js';
import { resolveWorkDir } from '@/support/workdir.js';
import { DeviceIdentityService } from '@/services/DeviceIdentityService.js';
import { SessionService } from '@/services/SessionService.js';

import type {
	GhostableMcpSecretAccess,
	GhostableMcpServeOptions,
	GhostableMcpToolkit,
	GhostableMcpToolkitDiffResult,
	GhostableMcpToolkitEnvironmentHistoryResult,
	GhostableMcpToolkitEnvironmentSummary,
	GhostableMcpToolkitListEnvironmentsResult,
	GhostableMcpToolkitListProjectsResult,
	GhostableMcpToolkitReadSecretResult,
	GhostableMcpToolkitReshareResult,
	GhostableMcpToolkitValidateResult,
} from './server.js';

type SessionContext = {
	accessToken: string;
	organizationId?: string;
	client: GhostableClient;
};

type ResolvedProjectScope = {
	project: Project;
	organizationId: string;
	client: GhostableClient;
};

type ResolvedEnvironmentScope = ResolvedProjectScope & {
	environment: Environment;
};

type MaterializedSecret = {
	value: string;
	commented: boolean;
	sourceEnvironment: string;
};

type MaterializedEnvironmentState = {
	project: Project;
	environment: Environment;
	chain: readonly string[];
	secrets: Record<string, MaterializedSecret>;
	commentedCount: number;
};

const textDecoder = new TextDecoder();

export class GhostableCliMcpToolkit implements GhostableMcpToolkit {
	constructor(private readonly options: GhostableMcpServeOptions) {}

	async listProjects(): Promise<GhostableMcpToolkitListProjectsResult> {
		const context = await this.requireSessionContext();
		const projects = await this.listScopedProjects(context);

		return {
			organizationId: context.organizationId ?? null,
			projectScope: this.options.project ?? Manifest.data()?.id ?? null,
			projects: projects.map((project) => ({
				id: project.id,
				name: project.name,
				slug: project.slug,
				organizationId: project.organizationId,
				environmentNames: project.environments.map((environment) => environment.name),
			})),
		};
	}

	async listEnvironments(): Promise<GhostableMcpToolkitListEnvironmentsResult> {
		const scope = await this.requireProjectScope();
		const environments = await scope.client.getEnvironments(scope.project.id);
		const filtered = this.filterEnvironments(environments);

		return {
			project: this.presentProject(scope.project),
			environments: filtered.map((environment) => this.presentEnvironment(environment)),
		};
	}

	async showEnvironmentHistory(
		limit: number,
	): Promise<GhostableMcpToolkitEnvironmentHistoryResult> {
		const scope = await this.requireEnvironmentScope();
		const history = await scope.client.getEnvironmentHistory(
			scope.project.id,
			scope.environment.name,
		);

		return {
			project: this.presentProject(scope.project),
			environment: this.presentEnvironment(scope.environment),
			summary: history.summary,
			entries: history.entries.slice(0, limit).map((entry: EnvironmentHistoryEntry) => ({
				id: entry.id,
				occurredAt: entry.occurredAt,
				operation: entry.operation,
				actor: entry.actor,
				variable: entry.variable,
				commented: entry.commented,
				kek: entry.kek,
			})),
		};
	}

	async showKeyReshareStatus(
		input: Pick<ListEnvironmentKeyReshareRequestsOptions, 'status'> & { limit: number },
	): Promise<GhostableMcpToolkitReshareResult> {
		const context = await this.requireSessionContext();
		const projectScope = await this.resolveProjectScope(false, context);
		const environmentScope = await this.resolveEnvironmentScope(false, projectScope);
		const organizationId = projectScope?.organizationId ?? context.organizationId;

		if (!organizationId) {
			throw new Error(
				'Unable to resolve an organization. Run `ghostable org:switch`, work inside an initialized project, or pass --project.',
			);
		}

		const deviceId = await this.tryLoadDeviceId();
		const response = await context.client.listOrganizationKeyReshareRequests(organizationId, {
			projectId: projectScope?.project.id,
			environmentId: environmentScope?.environment.id,
			status: input.status,
			deviceId: deviceId ?? undefined,
			perPage: input.limit,
		});

		return {
			organizationId,
			project: projectScope ? this.presentProject(projectScope.project) : null,
			environment: environmentScope
				? this.presentEnvironment(environmentScope.environment)
				: null,
			requests: response.data,
			meta: response.meta ?? null,
		};
	}

	async validateLocalEnv(file?: string): Promise<GhostableMcpToolkitValidateResult> {
		const scope = await this.requireEnvironmentScope();
		const filePath = resolveEnvFile(scope.environment.name, file, false);
		const vars = readEnvFileSafe(filePath);

		let schema: SchemaDefinition;
		try {
			schema = loadMergedSchema(scope.environment.name);
		} catch (error) {
			if (error instanceof SchemaNotFoundError) {
				return {
					valid: false,
					project: this.presentProject(scope.project),
					environment: this.presentEnvironment(scope.environment),
					filePath,
					schemaKeyCount: 0,
					issues: [
						{
							variable: '*',
							message: error.message,
						},
					],
				};
			}

			throw error;
		}

		const issues = validateVariables(vars, schema);

		return {
			valid: issues.length === 0,
			project: this.presentProject(scope.project),
			environment: this.presentEnvironment(scope.environment),
			filePath,
			schemaKeyCount: Object.keys(schema).length,
			issues,
		};
	}

	async diffLocalRemote(input: {
		file?: string;
		only?: string[];
		showIgnored?: boolean;
	}): Promise<GhostableMcpToolkitDiffResult> {
		const remote = await this.materializeRemoteEnvironment(input.only);
		const filePath = resolveEnvFile(remote.environment.name, input.file, false);
		const localMetadata = readEnvFileSafeWithMetadata(filePath);
		const localMap: Record<string, { value: string; commented: boolean }> = {};

		for (const [key, snapshot] of Object.entries(localMetadata.snapshots)) {
			localMap[key] = {
				value: snapshot.value,
				commented: Boolean(snapshot.commented),
			};
		}

		for (const [key, value] of Object.entries(localMetadata.vars)) {
			if (!localMap[key]) {
				localMap[key] = {
					value,
					commented: false,
				};
			}
		}

		const remoteMap = Object.fromEntries(
			Object.entries(remote.secrets).map(([key, value]) => [
				key,
				{ value: value.value, commented: value.commented },
			]),
		);

		const ignored = getIgnoredKeys(remote.environment.name);
		const localFiltered = filterIgnoredKeys(localMap, ignored, input.only);
		const remoteFiltered = filterIgnoredKeys(remoteMap, ignored, input.only);
		const ignoredKeysUsed =
			input.only && input.only.length
				? []
				: ignored.filter((key) => key in localMap || key in remoteMap);

		const restrict = (keys: string[]) =>
			input.only && input.only.length
				? keys.filter((key) => input.only?.includes(key))
				: keys;

		const added = restrict(Object.keys(localFiltered))
			.filter((key) => !(key in remoteFiltered))
			.map((key) => ({
				name: key,
				localValue: localFiltered[key]?.value ?? '',
				remoteValue: null,
				localCommented: localFiltered[key]?.commented ?? false,
				remoteCommented: null,
			}));

		const updated = restrict(Object.keys(localFiltered))
			.filter((key) => key in remoteFiltered)
			.filter((key) => {
				const localValue = localFiltered[key]?.value ?? '';
				const remoteValue = remoteFiltered[key]?.value ?? '';
				const localCommented = localFiltered[key]?.commented ?? false;
				const remoteCommented = remoteFiltered[key]?.commented ?? false;

				return localValue !== remoteValue || localCommented !== remoteCommented;
			})
			.map((key) => ({
				name: key,
				localValue: localFiltered[key]?.value ?? '',
				remoteValue: remoteFiltered[key]?.value ?? '',
				localCommented: localFiltered[key]?.commented ?? false,
				remoteCommented: remoteFiltered[key]?.commented ?? false,
			}));

		const removed = restrict(Object.keys(remoteFiltered))
			.filter((key) => !(key in localFiltered))
			.map((key) => ({
				name: key,
				localValue: null,
				remoteValue: remoteFiltered[key]?.value ?? '',
				localCommented: null,
				remoteCommented: remoteFiltered[key]?.commented ?? false,
			}));

		return {
			project: this.presentProject(remote.project),
			environment: this.presentEnvironment(remote.environment),
			filePath,
			ignoredKeys: input.showIgnored ? ignoredKeysUsed : [],
			added,
			updated,
			removed,
		};
	}

	async pullEnvironmentSummary(input: {
		only?: string[];
	}): Promise<GhostableMcpToolkitEnvironmentSummary> {
		const remote = await this.materializeRemoteEnvironment(input.only);
		const localFilePath = resolveEnvFile(remote.environment.name, undefined, false);

		return {
			project: this.presentProject(remote.project),
			environment: this.presentEnvironment(remote.environment),
			chain: [...remote.chain],
			decryptedSecretCount: Object.keys(remote.secrets).length,
			commentedSecretCount: remote.commentedCount,
			localFilePath,
			variableNames: Object.keys(remote.secrets).sort((left, right) =>
				left.localeCompare(right),
			),
		};
	}

	async readSecret(
		name: string,
		secretAccess: GhostableMcpSecretAccess,
	): Promise<GhostableMcpToolkitReadSecretResult> {
		const remote = await this.materializeRemoteEnvironment([name]);
		const secret = remote.secrets[name];

		if (!secret) {
			throw new Error(`Secret "${name}" was not found in ${remote.environment.name}.`);
		}

		return {
			project: this.presentProject(remote.project),
			environment: this.presentEnvironment(remote.environment),
			name,
			value: secretAccess === 'masked' ? maskSecretValue(secret.value) : secret.value,
			commented: secret.commented,
			sourceEnvironment: secret.sourceEnvironment,
			secretAccess,
		};
	}

	async materializeEnvFile(format?: EnvFileFormat): Promise<{
		project: GhostableMcpToolkitEnvironmentSummary['project'];
		environment: GhostableMcpToolkitEnvironmentSummary['environment'];
		format: EnvFileFormat;
		content: string;
	}> {
		const remote = await this.materializeRemoteEnvironment();
		const selectedFormat = format ?? EnvFileFormat.ALPHABETICAL;
		const content = renderEnvFile(
			Object.entries(remote.secrets).map(([key, value]) => ({
				key,
				value: value.value,
				commented: value.commented,
			})),
			{ format: selectedFormat },
		);

		return {
			project: this.presentProject(remote.project),
			environment: this.presentEnvironment(remote.environment),
			format: selectedFormat,
			content,
		};
	}

	private async requireSessionContext(): Promise<SessionContext> {
		const session = await new SessionService().load();
		if (!session?.accessToken) {
			throw new Error('Not authenticated. Run `ghostable login`.');
		}

		return {
			accessToken: session.accessToken,
			organizationId: session.organizationId,
			client: GhostableClient.unauthenticated(config.apiBase).withToken(session.accessToken),
		};
	}

	private async resolveProjectScope(
		required: boolean,
		context?: SessionContext,
	): Promise<ResolvedProjectScope | null> {
		const sessionContext = context ?? (await this.requireSessionContext());
		const manifest = Manifest.data();
		const scopedProject = this.options.project?.trim() || manifest?.id || null;

		if (scopedProject) {
			try {
				const project = await sessionContext.client.getProject(scopedProject);
				return {
					project,
					organizationId: project.organizationId,
					client: sessionContext.client,
				};
			} catch {
				// fall back to organization-scoped project discovery
			}
		}

		const projects = await this.listScopedProjects(sessionContext);
		if (scopedProject) {
			const match = projects.find((project) => matchesProject(project, scopedProject));
			if (match) {
				return {
					project: match,
					organizationId: match.organizationId,
					client: sessionContext.client,
				};
			}

			throw new Error(`Unable to resolve project scope "${scopedProject}".`);
		}

		if (!required) {
			return null;
		}

		if (projects.length === 1) {
			const [project] = projects;
			return {
				project,
				organizationId: project.organizationId,
				client: sessionContext.client,
			};
		}

		throw new Error(
			'Unable to resolve a project. Work inside an initialized Ghostable project or pass --project.',
		);
	}

	private async requireProjectScope(context?: SessionContext): Promise<ResolvedProjectScope> {
		const resolved = await this.resolveProjectScope(true, context);
		if (!resolved) {
			throw new Error('A project scope is required.');
		}
		return resolved;
	}

	private async resolveEnvironmentScope(
		required: boolean,
		projectScope?: ResolvedProjectScope | null,
	): Promise<ResolvedEnvironmentScope | null> {
		const scope = projectScope ?? (await this.resolveProjectScope(required));
		if (!scope) {
			return null;
		}

		const environments = this.filterEnvironments(
			await scope.client.getEnvironments(scope.project.id),
		);
		const manifestNames = Object.keys(Manifest.data()?.environments ?? {});
		const manifestScopedEnv = manifestNames.length === 1 ? manifestNames[0] : null;
		const scopedEnvironment = this.options.env?.trim() || manifestScopedEnv || null;

		if (scopedEnvironment) {
			const match = environments.find((environment) =>
				matchesEnvironment(environment, scopedEnvironment),
			);
			if (!match) {
				throw new Error(`Unable to resolve environment scope "${scopedEnvironment}".`);
			}

			return {
				...scope,
				environment: match,
			};
		}

		if (!required) {
			return null;
		}

		if (environments.length === 1) {
			return {
				...scope,
				environment: environments[0],
			};
		}

		throw new Error(
			'Unable to resolve an environment. Work inside a manifest with one environment or pass --env.',
		);
	}

	private async requireEnvironmentScope(): Promise<ResolvedEnvironmentScope> {
		const resolved = await this.resolveEnvironmentScope(true);
		if (!resolved) {
			throw new Error('An environment scope is required.');
		}
		return resolved;
	}

	private async listScopedProjects(context: SessionContext): Promise<Project[]> {
		if (!context.organizationId) {
			const manifest = Manifest.data();
			if (manifest?.id) {
				const project = await context.client.getProject(manifest.id);
				return [project];
			}

			throw new Error('No organization selected. Run `ghostable org:switch`.');
		}

		const projects = await context.client.projects(context.organizationId);
		return projects.sort((left, right) => left.name.localeCompare(right.name));
	}

	private filterEnvironments(environments: Environment[]): Environment[] {
		const envScope = this.options.env?.trim();
		const filtered = envScope
			? environments.filter((environment) => matchesEnvironment(environment, envScope))
			: environments;

		return [...filtered].sort((left, right) => left.name.localeCompare(right.name));
	}

	private async materializeRemoteEnvironment(
		only?: string[],
	): Promise<MaterializedEnvironmentState> {
		const scope = await this.requireEnvironmentScope();

		let deviceService: DeviceIdentityService;
		try {
			deviceService = await DeviceIdentityService.create();
		} catch (error) {
			throw new Error(`Failed to access device identity: ${toErrorMessage(error)}`);
		}

		let identity;
		try {
			identity = await deviceService.requireIdentity();
		} catch (error) {
			throw new Error(`Failed to load device identity: ${toErrorMessage(error)}`);
		}

		let bundle: EnvironmentSecretBundle;
		try {
			bundle = await scope.client.pull(scope.project.id, scope.environment.name, {
				includeVersions: true,
				includeMeta: true,
				only,
				deviceId: identity.deviceId,
			});
		} catch (error) {
			throw normalizeMcpToolkitError(error);
		}

		await initSodium();

		let envKeyService: EnvironmentKeyService;
		try {
			envKeyService = await EnvironmentKeyService.create();
		} catch (error) {
			throw new Error(`Failed to access environment keys: ${toErrorMessage(error)}`);
		}

		const envKeys = new Map<string, Uint8Array>();
		const envNames = new Set<string>();
		for (const layer of bundle.chain) {
			envNames.add(layer);
		}
		for (const entry of bundle.secrets) {
			envNames.add(entry.env);
		}

		for (const envName of envNames) {
			try {
				const ensured = await envKeyService.ensureEnvironmentKey({
					client: scope.client,
					projectId: scope.project.id,
					envName,
					identity,
				});
				envKeys.set(envName, ensured.key);
			} catch (error) {
				throw normalizeMcpToolkitError(error);
			}
		}

		const byEnvironment = new Map<string, EnvironmentSecret[]>();
		for (const entry of bundle.secrets) {
			const entries = byEnvironment.get(entry.env) ?? [];
			entries.push(entry);
			byEnvironment.set(entry.env, entries);
		}

		const secrets: Record<string, MaterializedSecret> = {};
		let commentedCount = 0;

		for (const layer of bundle.chain) {
			const entries = byEnvironment.get(layer) ?? [];
			for (const entry of entries) {
				const keyMaterial = envKeys.get(entry.env);
				if (!keyMaterial) {
					throw new Error(`No environment key is available for ${entry.env}.`);
				}

				const { encKey } = deriveKeys(keyMaterial, scopeFromAAD(entry.aad));
				const plaintext = aeadDecrypt(encKey, {
					alg: entry.alg,
					nonce: entry.nonce,
					ciphertext: entry.ciphertext,
					aad: entry.aad,
				});
				const commented = Boolean(entry.meta?.is_commented);

				secrets[entry.name] = {
					value: textDecoder.decode(plaintext),
					commented,
					sourceEnvironment: entry.env,
				};

				if (commented) {
					commentedCount += 1;
				}
			}
		}

		return {
			project: scope.project,
			environment: scope.environment,
			chain: bundle.chain,
			secrets,
			commentedCount,
		};
	}

	private presentProject(project: Project) {
		return {
			id: project.id,
			name: project.name,
			slug: project.slug,
			organizationId: project.organizationId,
		};
	}

	private presentEnvironment(environment: Environment) {
		return {
			id: environment.id,
			name: environment.name,
			type: environment.type,
			baseId: environment.baseId ?? null,
		};
	}

	private async tryLoadDeviceId(): Promise<string | null> {
		try {
			const identity = await (await DeviceIdentityService.create()).loadIdentity();
			return identity?.deviceId ?? null;
		} catch {
			return null;
		}
	}
}

export function maskSecretValue(value: string): string {
	if (!value.length) {
		return value;
	}

	if (value.length <= 4) {
		return '*'.repeat(value.length);
	}

	return `${value.slice(0, 2)}${'*'.repeat(Math.max(4, value.length - 4))}${value.slice(-2)}`;
}

function matchesProject(project: Project, scope: string): boolean {
	const normalized = scope.trim().toLowerCase();
	return (
		project.id === scope ||
		project.name.trim().toLowerCase() === normalized ||
		project.slug.trim().toLowerCase() === normalized
	);
}

function matchesEnvironment(environment: Environment, scope: string): boolean {
	const normalized = scope.trim().toLowerCase();
	return environment.id === scope || environment.name.trim().toLowerCase() === normalized;
}

function normalizeMcpToolkitError(error: unknown): Error {
	if (error instanceof KeyReshareRequiredError) {
		const pending = error.pendingRequestIds.length
			? ` Pending requests: ${error.pendingRequestIds.join(', ')}.`
			: '';

		return new Error(
			`${error.message} Required key version: ${error.requiredKeyVersion ?? 'unknown'}.${pending}`.trim(),
		);
	}

	return new Error(toErrorMessage(error));
}
