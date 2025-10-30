import { HttpClient } from '../http/HttpClient.js';
import { HttpError } from '../http/errors.js';

import {
	Device,
	DeviceEnvelope,
	Environment,
	EnvironmentSecretBundle,
	EnvironmentSuggestedName,
	EnvironmentType,
	Organization,
	Project,
} from '@/domain';
import type { DeviceStatus } from '@/domain';
import type { EncryptedEnvelope, OneTimePrekey, SignedPrekey } from '@/crypto';

import type {
	ConsumeEnvelopeResponseJson,
	CreateEnvironmentKeyRequest,
	DeviceDeleteResponseJson,
	DeviceDocumentJson,
	DeviceEnvelopeJson,
	DeviceResourceJson,
	DevicePrekeyBundle,
	DevicePrekeyBundleJson,
	EnvironmentJson,
	EnvironmentKey,
	EnvironmentKeyResponseJson,
	EnvironmentKeysResponse,
	EnvironmentKeysResponseJson,
	EnvironmentSecretBundleJson,
	EnvironmentSuggestedNameJson,
	EnvironmentTypeJson,
	OrganizationJson,
	PublishOneTimePrekeysResponseJson,
	PublishSignedPrekeyResponseJson,
	ProjectJson,
	QueueEnvelopeResponseJson,
	SignedEnvironmentSecretBatchUploadRequest,
	SignedEnvironmentSecretUploadRequest,
} from '@/types';
import {
	createEnvironmentKeyRequestToJSON,
	devicePrekeyBundleFromJSON,
	encryptedEnvelopeToJSON,
	environmentKeyResponseFromJSON,
	environmentKeysFromJSON,
} from '@/types';

type LoginResponse = { token?: string; two_factor?: boolean };
type BrowserLoginStartResponse = {
	ticket?: string;
	login_url?: string;
	poll_interval?: number;
	poll_url?: string;
	expires_at?: string;
};
type BrowserLoginPollResponse = {
	token?: string;
	status?: 'pending' | 'approved' | 'expired' | 'cancelled';
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
	status?: 'pending' | 'approved' | 'expired' | 'cancelled';
};
type ListResp<T> = { data?: T[] };

export class GhostableClient {
	constructor(private http: HttpClient) {}

	static unauthenticated(apiBase: string) {
		return new GhostableClient(new HttpClient(apiBase));
	}

	withToken(token: string) {
		return new GhostableClient(this.http.withBearer(token));
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
                if (!res.ticket || !res.login_url) {
                        throw new Error('Browser registration is not available.');
                }
                return {
                        ticket: res.ticket,
                        loginUrl: res.login_url,
                        pollIntervalSeconds: res.poll_interval,
                        pollUrl: res.poll_url,
                        expiresAt: res.expires_at,
                };
        }

        async pollBrowserRegistration(ticket: string): Promise<BrowserLoginStatus> {
                const res = await this.http.post<BrowserLoginPollResponse>('/cli/register/poll', { ticket });
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

	async createProject(input: { organizationId: string; name: string }): Promise<Project> {
		const res = await this.http.post<ProjectJson>(
			`/organizations/${input.organizationId}/projects`,
			{ name: input.name },
		);
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

	async uploadSecret(
		projectId: string,
		envName: string,
		payload: SignedEnvironmentSecretUploadRequest,
		opts?: { sync?: boolean },
	): Promise<{ id?: string; version?: number }> {
		const p = encodeURIComponent(projectId);
		const e = encodeURIComponent(envName);
		const suffix = opts?.sync ? '?sync=1' : '';
		return this.http.post(`/projects/${p}/environments/${e}/secrets${suffix}`, payload);
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
		await this.http.post(`/projects/${p}/environments/${e}/push${suffix}`, payloads);
	}

	async pull(
		projectId: string,
		envName: string,
		opts?: {
			only?: string[];
			includeMeta?: boolean;
			includeVersions?: boolean;
		},
	): Promise<EnvironmentSecretBundle> {
		const p = encodeURIComponent(projectId);
		const e = encodeURIComponent(envName);

		const qs = new URLSearchParams();
		if (opts?.includeMeta) qs.set('include_meta', '1');
		if (opts?.includeVersions) qs.set('include_versions', '1');
		if (opts?.only?.length) for (const k of opts.only) qs.append('only[]', k);

		const suffix = qs.toString() ? `?${qs.toString()}` : '';

		const json = await this.http.get<EnvironmentSecretBundleJson>(
			`/projects/${p}/environments/${e}/pull${suffix}`,
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
		request: CreateEnvironmentKeyRequest,
	): Promise<EnvironmentKey> {
		const p = encodeURIComponent(projectId);
		const e = encodeURIComponent(envName);
		const json = await this.http.post<EnvironmentKeyResponseJson>(
			`/projects/${p}/environments/${e}/key`,
			createEnvironmentKeyRequestToJSON(request),
		);
		const response = environmentKeyResponseFromJSON(json).data;
		if (!response) {
			throw new Error('Environment key creation failed');
		}
		return response;
	}

	async deploy(opts?: {
		only?: string[];
		includeMeta?: boolean;
		includeVersions?: boolean;
	}): Promise<EnvironmentSecretBundle> {
		const qs = new URLSearchParams();
		if (opts?.includeMeta) qs.set('include_meta', '1');
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
		name: string;
		platform: string;
	}): Promise<Device> {
		const json = await this.http.post<DeviceDocumentJson>(this.devicePath(), {
			public_key: input.publicKey,
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

	async publishSignedPrekey(
		deviceId: string,
		prekey: SignedPrekey,
	): Promise<{ fingerprint: string; updatedAt: Date }> {
		const json = await this.http.post<PublishSignedPrekeyResponseJson>(
			`${this.devicePath(deviceId)}/signed-prekey`,
			{
				public_key: prekey.publicKey,
				signature: prekey.signatureFromSigningKey,
				expires_at: prekey.expiresAtIso ?? null,
			},
		);
		return { fingerprint: json.fingerprint, updatedAt: new Date(json.updated_at) };
	}

	async publishOneTimePrekeys(deviceId: string, prekeys: OneTimePrekey[]): Promise<number> {
		if (!prekeys.length) throw new Error('At least one prekey is required');
		const json = await this.http.post<PublishOneTimePrekeysResponseJson>(
			`${this.devicePath(deviceId)}/one-time-prekeys`,
			{
				prekeys: prekeys.map((prekey) => ({
					id: prekey.id,
					public_key: prekey.publicKey,
					expires_at: prekey.expiresAtIso ?? null,
				})),
			},
		);
		return json.queued;
	}

	async getDevicePrekeys(deviceId: string): Promise<DevicePrekeyBundle> {
		const json = await this.http.get<DevicePrekeyBundleJson>(
			`${this.devicePath(deviceId)}/prekeys`,
		);
		return devicePrekeyBundleFromJSON(json);
	}

	async sendEnvelope(
		deviceId: string,
		envelope: EncryptedEnvelope,
		senderDeviceId?: string,
	): Promise<{ id: string }> {
		const json = await this.http.post<{ id: string }>(
			`${this.devicePath(deviceId)}/envelopes`,
			{
				envelope: encryptedEnvelopeToJSON(envelope),
				sender_device_id: senderDeviceId ?? deviceId,
			},
		);
		return { id: json.id };
	}

	async queueEnvelope(
		deviceId: string,
		payload: { ciphertext: string; senderDeviceId: string },
	): Promise<{ id: string; queued: boolean }> {
		const json = await this.http.post<QueueEnvelopeResponseJson>(
			`${this.devicePath(deviceId)}/envelopes`,
			{
				ciphertext: payload.ciphertext,
				sender_device_id: payload.senderDeviceId,
			},
		);
		return { id: json.id, queued: json.queued };
	}

	async getEnvelopes(deviceId: string): Promise<DeviceEnvelope[]> {
		const json = await this.http.get<DeviceEnvelopeJson[]>(
			`${this.devicePath(deviceId)}/envelopes`,
		);
		return json.map((item) => ({
			id: item.id,
			ciphertext: item.ciphertext,
			createdAt: new Date(item.created_at),
		}));
	}

	async consumeEnvelope(deviceId: string, envelopeId: string): Promise<boolean> {
		const json = await this.http.post<ConsumeEnvelopeResponseJson>(
			`${this.devicePath(deviceId)}/envelopes/${encodeURIComponent(envelopeId)}/consume`,
			{},
		);
		return json.success === true;
	}
}
