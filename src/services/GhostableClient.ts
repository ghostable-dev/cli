import { HttpClient } from '../http/HttpClient.js';

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
import type { OneTimePrekey, SignedPrekey } from '@/crypto';

import type {
	ConsumeEnvelopeResponseJson,
	DeviceDeleteResponseJson,
	DeviceDocumentJson,
	DeviceEnvelopeJson,
	DevicePrekeyBundle,
	DevicePrekeyBundleJson,
	EnvironmentJson,
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
import { devicePrekeyBundleFromJSON, environmentKeysFromJSON } from '@/types';

type LoginResponse = { token?: string; two_factor?: boolean };
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
		const res = await this.http.post<EnvironmentJson>(`/projects/${p}/environments`, {
			name: input.name,
			type: input.type,
			base_id: input.baseId,
		});
		return Environment.fromJSON(res);
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
		return deviceId ? `/devices/${encodeURIComponent(deviceId)}` : '/devices';
	}

	async registerDevice(input: { publicKey: string; platform: string }): Promise<Device> {
		const json = await this.http.post<DeviceDocumentJson>(this.devicePath(), {
			public_key: input.publicKey,
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
