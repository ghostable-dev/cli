import { HttpClient } from './http/HttpClient.js';
import { HttpError } from './http/errors.js';

import {
	DeploymentProvider,
	DeploymentToken,
	Device,
	Environment,
	EnvironmentSecretBundle,
	EnvironmentSuggestedName,
	EnvironmentType,
	Organization,
	Project,
	type ProjectStackShape,
} from '@/entities';
import type { DeviceStatus } from '@/entities';

import type {
	SignedCreateEnvironmentKeyEnvelopeRequestJson,
	SignedCreateEnvironmentKeyRequestJson,
	DeviceDeleteResponseJson,
	DeviceDocumentJson,
	DeviceResourceJson,
	EnvironmentJson,
	EnvironmentKey,
	EnvironmentKeyResponseJson,
	EnvironmentKeysResponse,
	EnvironmentKeysResponseJson,
	EnvironmentSecretBundleJson,
	EnvironmentSuggestedNameJson,
	EnvironmentTypeJson,
	OrganizationJson,
	ProjectJson,
	SignedEnvironmentSecretBatchUploadRequest,
	CreateDeploymentTokenRequestJson,
	CreateDeploymentTokenResponseJson,
	DeploymentTokenListResponseJson,
	DeploymentTokenWithSecret,
	RevokeDeploymentTokenResponseJson,
	RotateDeploymentTokenRequestJson,
	RotateDeploymentTokenResponseJson,
	EnvironmentHistoryResponse,
	EnvironmentHistoryResponseJson,
	ProjectHistoryResponse,
	ProjectHistoryResponseJson,
	VariableHistoryResponse,
	VariableHistoryResponseJson,
	RollbackResultResponse,
	RollbackResultResponseJson,
	SignedRollbackVariableRequestJson,
} from './types/index.js';
import {
	environmentKeyResponseFromJSON,
	environmentKeysFromJSON,
	deploymentTokenFromJSON,
	variableHistoryFromJSON,
	environmentHistoryFromJSON,
	projectHistoryFromJSON,
	rollbackResultFromJSON,
} from './types/index.js';

type LoginResponse = { token?: string; two_factor?: boolean };
type BrowserLoginStartResponse = {
	ticket?: string;
	login_url?: string;
	register_url?: string;
	poll_interval?: number;
	poll_url?: string;
	expires_at?: string;
};
type BrowserLoginPollResponse = {
	token?: string;
	status?: 'pending' | 'approved' | 'expired' | 'cancelled' | 'verification_required';
};

export type BrowserLoginSession = {
	ticket: string;
	loginUrl: string;
	pollIntervalSeconds?: number;
	pollUrl?: string;
	expiresAt?: string;
};

export type BrowserLoginStatus = {
	token?: string;
	status?: 'pending' | 'approved' | 'expired' | 'cancelled' | 'verification_required';
};
type ListResp<T> = { data?: T[] };

export class GhostableClient {
	constructor(
		private http: HttpClient,
		private pushHttp: HttpClient,
	) {}

	static unauthenticated(apiBase: string) {
		const http = new HttpClient(apiBase);
		return new GhostableClient(http, http);
	}

	withToken(token: string) {
		return new GhostableClient(this.http.withBearer(token), this.pushHttp.withBearer(token));
	}

	async login(email: string, password: string, code?: string): Promise<string> {
		const res = await this.http.post<LoginResponse>('/cli/login', {
			email,
			password,
			...(code ? { code } : {}),
		});
		if (!res.token) throw new Error('Authentication failed');
		return res.token;
	}

	async startBrowserLogin(): Promise<BrowserLoginSession> {
		const res = await this.http.post<BrowserLoginStartResponse>('/cli/login/start', {});
		if (!res.ticket || !res.login_url) {
			throw new Error('Browser login is not available.');
		}
		return {
			ticket: res.ticket,
			loginUrl: res.login_url,
			pollIntervalSeconds: res.poll_interval,
			pollUrl: res.poll_url,
			expiresAt: res.expires_at,
		};
	}

	async pollBrowserLogin(ticket: string): Promise<BrowserLoginStatus> {
		const res = await this.http.post<BrowserLoginPollResponse>('/cli/login/poll', { ticket });
		return {
			token: res.token,
			status: res.status,
		};
	}

	async startBrowserRegistration(): Promise<BrowserLoginSession> {
		const res = await this.http.post<BrowserLoginStartResponse>('/cli/register/start', {});
		const loginUrl = res.login_url ?? res.register_url;
		if (!res.ticket || !loginUrl) {
			throw new Error('Browser registration is not available.');
		}
		return {
			ticket: res.ticket,
			loginUrl,
			pollIntervalSeconds: res.poll_interval,
			pollUrl: res.poll_url,
			expiresAt: res.expires_at,
		};
	}

	async pollBrowserRegistration(ticket: string): Promise<BrowserLoginStatus> {
		const res = await this.http.post<BrowserLoginPollResponse>('/cli/register/poll', {
			ticket,
		});
		return {
			token: res.token,
			status: res.status,
		};
	}

	async organizations(): Promise<Organization[]> {
		const res = await this.http.get<{ data?: OrganizationJson[] }>('/organizations');
		return (res.data ?? []).map(Organization.fromJSON);
	}

	async projects(organizationId: string): Promise<Project[]> {
		const res = await this.http.get<ListResp<ProjectJson>>(
			`/organizations/${organizationId}/projects`,
		);
		return (res.data ?? []).map(Project.fromJSON);
	}

	async listDevices(projectId: string, envName: string): Promise<Device[]> {
		const p = encodeURIComponent(projectId);
		const e = encodeURIComponent(envName);
		const res = await this.http.get<{ data?: DeviceResourceJson[] }>(
			`/projects/${p}/environments/${e}/devices`,
		);
		return (res.data ?? []).map(Device.fromResource);
	}

	async createProject(input: {
		organizationId: string;
		name: string;
		description?: string;
		deploymentProvider: DeploymentProvider;
		stack?: ProjectStackShape;
	}): Promise<Project> {
		const payload: {
			name: string;
			description?: string;
			deployment_provider: DeploymentProvider;
			stack?: ProjectStackShape;
		} = {
			name: input.name,
			deployment_provider: input.deploymentProvider,
		};

		if (input.description) {
			payload.description = input.description;
		}

		if (input.stack) {
			const sanitizedStack: ProjectStackShape = {};
			for (const category of Object.keys(input.stack) as (keyof ProjectStackShape)[]) {
				const value = input.stack[category];
				if (value) {
					sanitizedStack[category] = value;
				}
			}
			if (Object.keys(sanitizedStack).length > 0) {
				payload.stack = sanitizedStack;
			}
		}

		const res = await this.http.post<{ data?: ProjectJson } | ProjectJson>(
			`/organizations/${input.organizationId}/projects`,
			payload,
		);

		const json: ProjectJson | undefined = 'data' in res ? res.data : (res as ProjectJson);

		if (!json) {
			throw new Error('Malformed create project response.');
		}

		return Project.fromJSON(json);
	}

	async getProject(projectId: string): Promise<Project> {
		const p = encodeURIComponent(projectId);
		const res = await this.http.get<ProjectJson>(`/projects/${p}`);
		return Project.fromJSON(res);
	}

	async getEnvironments(projectId: string): Promise<Environment[]> {
		const p = encodeURIComponent(projectId);
		const res = await this.http.get<{ data?: EnvironmentJson[] }>(
			`/projects/${p}/environments`,
		);
		return (res.data ?? []).map(Environment.fromJSON);
	}

	async getEnvironmentTypes(): Promise<EnvironmentType[]> {
		const res = await this.http.get<{ data?: EnvironmentTypeJson[] }>('/environment-types');
		return (res.data ?? []).map(EnvironmentType.fromJSON);
	}

	async suggestEnvironmentNames(
		projectId: string,
		type: string,
	): Promise<EnvironmentSuggestedName[]> {
		const p = encodeURIComponent(projectId);
		const res = await this.http.post<{ data?: EnvironmentSuggestedNameJson[] }>(
			`/projects/${p}/generate-suggested-environment-names`,
			{ type },
		);
		return (res.data ?? []).map(EnvironmentSuggestedName.fromJSON);
	}

	async createEnvironment(input: {
		projectId: string;
		name: string;
		type: string;
		baseId: string | null;
	}): Promise<Environment> {
		const p = encodeURIComponent(input.projectId);
		const res = await this.http.post<{ data: EnvironmentJson }>(`/projects/${p}/environments`, {
			name: input.name,
			type: input.type,
			base_id: input.baseId,
		});
		const json = res.data;
		return Environment.fromJSON(json);
	}

	async push(
		projectId: string,
		envName: string,
		payloads: SignedEnvironmentSecretBatchUploadRequest,
		opts?: { sync?: boolean },
	): Promise<void> {
		const p = encodeURIComponent(projectId);
		const e = encodeURIComponent(envName);
		const suffix = opts?.sync ? '?sync=1' : '';
		await this.pushHttp.post(`/projects/${p}/environments/${e}/push${suffix}`, payloads);
	}

	async pull(
		projectId: string,
		envName: string,
		opts?: {
			only?: string[];
			includeMeta?: boolean;
			includeVersions?: boolean;
			deviceId?: string;
		},
	): Promise<EnvironmentSecretBundle> {
		const p = encodeURIComponent(projectId);
		const e = encodeURIComponent(envName);

		const qs = new URLSearchParams();
		const includeMeta = opts?.includeMeta ?? true;
		if (includeMeta) qs.set('include_meta', '1');
		if (opts?.includeVersions) qs.set('include_versions', '1');
		if (opts?.only?.length) for (const k of opts.only) qs.append('only[]', k);
		if (opts?.deviceId) qs.set('device_id', opts.deviceId);

		const suffix = qs.toString() ? `?${qs.toString()}` : '';
		const headers: Record<string, string> = {};
		if (opts?.deviceId) headers['X-Device-ID'] = opts.deviceId;

		const json = await this.http.get<EnvironmentSecretBundleJson>(
			`/projects/${p}/environments/${e}/pull${suffix}`,
			headers,
		);

		return EnvironmentSecretBundle.fromJSON(json);
	}

	async getEnvironmentKeys(projectId: string, envName: string): Promise<EnvironmentKeysResponse> {
		const p = encodeURIComponent(projectId);
		const e = encodeURIComponent(envName);

		const json = await this.http.get<EnvironmentKeysResponseJson>(
			`/projects/${p}/environments/${e}/keys`,
		);

		return environmentKeysFromJSON(json);
	}

	async getVariableHistory(
		projectId: string,
		envName: string,
		variable: string,
	): Promise<VariableHistoryResponse> {
		const p = encodeURIComponent(projectId);
		const e = encodeURIComponent(envName);
		const v = encodeURIComponent(variable);
		const json = await this.pushHttp.get<VariableHistoryResponseJson>(
			`/projects/${p}/environments/${e}/variables/${v}/history`,
		);
		return variableHistoryFromJSON(json);
	}

	async rollbackVariable(
		projectId: string,
		envName: string,
		variable: string,
		request: SignedRollbackVariableRequestJson,
	): Promise<RollbackResultResponse> {
		const p = encodeURIComponent(projectId);
		const e = encodeURIComponent(envName);
		const v = encodeURIComponent(variable);
		const json = await this.pushHttp.post<RollbackResultResponseJson>(
			`/projects/${p}/environments/${e}/variables/${v}/rollback`,
			request,
		);
		return rollbackResultFromJSON(json);
	}

	async getEnvironmentHistory(
		projectId: string,
		envName: string,
	): Promise<EnvironmentHistoryResponse> {
		const p = encodeURIComponent(projectId);
		const e = encodeURIComponent(envName);
		const json = await this.pushHttp.get<EnvironmentHistoryResponseJson>(
			`/projects/${p}/environments/${e}/history`,
		);
		return environmentHistoryFromJSON(json);
	}

	async getProjectHistory(projectId: string): Promise<ProjectHistoryResponse> {
		const p = encodeURIComponent(projectId);
		const json = await this.pushHttp.get<ProjectHistoryResponseJson>(`/projects/${p}/audit`);
		return projectHistoryFromJSON(json);
	}

	async getEnvironmentKey(projectId: string, envName: string): Promise<EnvironmentKey | null> {
		const p = encodeURIComponent(projectId);
		const e = encodeURIComponent(envName);

		try {
			const json = await this.http.get<EnvironmentKeyResponseJson>(
				`/projects/${p}/environments/${e}/key`,
			);
			return environmentKeyResponseFromJSON(json).data;
		} catch (error) {
			if (error instanceof HttpError && error.status === 404) {
				return null;
			}
			throw error;
		}
	}

	async createEnvironmentKey(
		projectId: string,
		envName: string,
		payload: SignedCreateEnvironmentKeyRequestJson,
	): Promise<EnvironmentKey> {
		const p = encodeURIComponent(projectId);
		const e = encodeURIComponent(envName);
		const json = await this.http.post<EnvironmentKeyResponseJson>(
			`/projects/${p}/environments/${e}/key`,
			payload,
		);
		const response = environmentKeyResponseFromJSON(json).data;
		if (!response) {
			throw new Error('Environment key creation failed');
		}
		return response;
	}

	async createEnvironmentKeyEnvelope(
		projectId: string,
		envName: string,
		payload: SignedCreateEnvironmentKeyEnvelopeRequestJson,
	): Promise<void> {
		const p = encodeURIComponent(projectId);
		const e = encodeURIComponent(envName);
		await this.http.post<unknown>(`/projects/${p}/environments/${e}/key/envelopes`, payload);
	}

	private deployTokenPath(projectId: string, tokenId?: string): string {
		const p = encodeURIComponent(projectId);
		const suffix = tokenId ? `/${encodeURIComponent(tokenId)}` : '';
		return `/projects/${p}/deploy-tokens${suffix}`;
	}

	async listDeployTokens(projectId: string, envName?: string): Promise<DeploymentToken[]> {
		const qs = envName ? `?environment=${encodeURIComponent(envName)}` : '';
		const res = await this.http.get<DeploymentTokenListResponseJson>(
			`${this.deployTokenPath(projectId)}${qs}`,
		);
		return (res.data ?? []).map(deploymentTokenFromJSON);
	}

	private parseDeploymentTokenMeta(
		meta?: CreateDeploymentTokenResponseJson['meta'],
	): Pick<DeploymentTokenWithSecret, 'secret' | 'apiToken'> {
		const secret = meta?.secret ?? meta?.api_token?.plain_text;
		const apiToken = meta?.api_token
			? {
					plainText: meta.api_token.plain_text,
					id: meta.api_token.id,
					name: meta.api_token.name,
					tokenSuffix: meta.api_token.token_suffix,
					expiresAt: meta.api_token.expires_at
						? new Date(meta.api_token.expires_at)
						: null,
				}
			: undefined;
		return { secret, apiToken };
	}

	async createDeployToken(
		projectId: string,
		input: { environmentId: string; name: string; publicKey: string },
	): Promise<DeploymentTokenWithSecret> {
		const res = await this.http.post<CreateDeploymentTokenResponseJson>(
			this.deployTokenPath(projectId),
			{
				name: input.name,
				environment_id: input.environmentId,
				public_key: input.publicKey,
			} satisfies CreateDeploymentTokenRequestJson,
		);
		const token = deploymentTokenFromJSON(res.data);
		const { secret, apiToken } = this.parseDeploymentTokenMeta(res.meta);
		return { token, secret, apiToken };
	}

	async rotateDeployToken(
		projectId: string,
		tokenId: string,
		input: { publicKey: string },
	): Promise<DeploymentTokenWithSecret> {
		const res = await this.http.post<RotateDeploymentTokenResponseJson>(
			`${this.deployTokenPath(projectId, tokenId)}/rotate`,
			{ public_key: input.publicKey } satisfies RotateDeploymentTokenRequestJson,
		);
		const token = deploymentTokenFromJSON(res.data);
		const { secret, apiToken } = this.parseDeploymentTokenMeta(res.meta);
		return { token, secret, apiToken };
	}

	async revokeDeployToken(projectId: string, tokenId: string): Promise<DeploymentToken> {
		const res = await this.http.post<RevokeDeploymentTokenResponseJson>(
			`${this.deployTokenPath(projectId, tokenId)}/revoke`,
			{},
		);
		return deploymentTokenFromJSON(res.data);
	}

	async deploy(opts?: {
		only?: string[];
		includeMeta?: boolean;
		includeVersions?: boolean;
	}): Promise<EnvironmentSecretBundle> {
		const qs = new URLSearchParams();
		const includeMeta = opts?.includeMeta ?? true;
		if (includeMeta) qs.set('include_meta', '1');
		if (opts?.includeVersions) qs.set('include_versions', '1');
		if (opts?.only?.length) for (const k of opts.only) qs.append('only[]', k);

		const suffix = qs.toString() ? `?${qs.toString()}` : '';

		const json = await this.http.get<EnvironmentSecretBundleJson>(`/ci/deploy${suffix}`);

		return EnvironmentSecretBundle.fromJSON(json);
	}

	private devicePath(deviceId?: string): string {
		const path = deviceId ? `/devices/${encodeURIComponent(deviceId)}` : '/devices';
		return path;
	}

	async registerDevice(input: {
		publicKey: string;
		publicSigningKey: string;
		name: string;
		platform: string;
	}): Promise<Device> {
		const json = await this.http.post<DeviceDocumentJson>(this.devicePath(), {
			public_key: input.publicKey,
			public_signing_key: input.publicSigningKey,
			name: input.name,
			platform: input.platform,
		});
		return Device.fromResource(json.data);
	}

	async getDevice(deviceId: string): Promise<Device> {
		const json = await this.http.get<DeviceDocumentJson>(this.devicePath(deviceId));
		return Device.fromResource(json.data);
	}

	async revokeDevice(
		deviceId: string,
	): Promise<{ status: DeviceStatus; revokedAt: Date | null; success: boolean }> {
		const json = await this.http.delete<DeviceDeleteResponseJson>(this.devicePath(deviceId));
		const attrs = json.data.attributes;
		return {
			status: attrs.status as DeviceStatus,
			revokedAt: attrs.revoked_at ? new Date(attrs.revoked_at) : null,
			success: json.meta?.success ?? false,
		};
	}
}
