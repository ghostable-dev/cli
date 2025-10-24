import { HttpClient } from '../http/HttpClient.js';

import {
	Environment,
	EnvironmentSecretBundle,
	EnvironmentSuggestedName,
	EnvironmentType,
	Organization,
	Project,
} from '@/domain';
import type { EncryptedEnvelope, OneTimePrekey, SignedPrekey } from '@/crypto';

import type {
	EnvironmentJson,
	EnvironmentKeysResponse,
	EnvironmentKeysResponseJson,
	EnvironmentSecretBundleJson,
	EnvironmentSuggestedNameJson,
	EnvironmentTypeJson,
	DevicePrekeyBundle,
	DevicePrekeyBundleJson,
	EncryptedEnvelopeJson,
	SignedPrekeyJson,
	OrganizationJson,
	ProjectJson,
	SignedEnvironmentSecretBatchUploadRequest,
	SignedEnvironmentSecretUploadRequest,
} from '@/types';
import {
	devicePrekeyBundleFromJSON,
	encryptedEnvelopeFromJSON,
	encryptedEnvelopeToJSON,
	environmentKeysFromJSON,
	oneTimePrekeyToJSON,
	signedPrekeyFromJSON,
	signedPrekeyToJSON,
} from '@/types';

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

	async publishSignedPrekey(deviceId: string, prekey: SignedPrekey): Promise<SignedPrekey> {
		const d = encodeURIComponent(deviceId);
		const json = await this.http.post<SignedPrekeyJson>(
			`/devices/${d}/signed-prekey`,
			signedPrekeyToJSON(prekey),
		);
		return signedPrekeyFromJSON(json);
	}

	async publishOneTimePrekeys(deviceId: string, prekeys: OneTimePrekey[]): Promise<void> {
		const d = encodeURIComponent(deviceId);
		await this.http.post(`/devices/${d}/one-time-prekeys`, {
			one_time_prekeys: prekeys.map(oneTimePrekeyToJSON),
		});
	}

	async getDevicePrekeys(deviceId: string): Promise<DevicePrekeyBundle> {
		const d = encodeURIComponent(deviceId);
		const json = await this.http.get<DevicePrekeyBundleJson>(`/devices/${d}/prekeys`);
		return devicePrekeyBundleFromJSON(json);
	}

	async sendEnvelope(deviceId: string, envelope: EncryptedEnvelope): Promise<void> {
		const d = encodeURIComponent(deviceId);
		await this.http.post(`/devices/${d}/envelopes`, encryptedEnvelopeToJSON(envelope));
	}

	async getEnvelopes(
		deviceId: string,
		opts?: { limit?: number; since?: string },
	): Promise<EncryptedEnvelope[]> {
		const d = encodeURIComponent(deviceId);
		const qs = new URLSearchParams();
		if (opts?.limit !== undefined) qs.set('limit', String(opts.limit));
		if (opts?.since) qs.set('since', opts.since);
		const suffix = qs.toString() ? `?${qs.toString()}` : '';
		const res = await this.http.get<ListResp<EncryptedEnvelopeJson>>(
			`/devices/${d}/envelopes${suffix}`,
		);
		return (res.data ?? []).map(encryptedEnvelopeFromJSON);
	}
}
