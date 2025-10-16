import { HttpClient } from '../http/HttpClient.js';

import {
	Environment,
	EnvironmentSecretBundle,
	EnvironmentSuggestedName,
	EnvironmentType,
	Organization,
	Project,
} from '@/domain';

import type {
        EnvironmentJson,
        EnvironmentKeysResponse,
        EnvironmentKeysResponseJson,
        EnvironmentSecretBundleJson,
        EnvironmentSuggestedNameJson,
        EnvironmentTypeJson,
        OrganizationJson,
        ProjectJson,
        SignedEnvironmentSecretUploadRequest,
} from '@/types';
import { environmentKeysFromJSON } from '@/types';

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

        async getEnvironmentKeys(
                projectId: string,
                envName: string,
        ): Promise<EnvironmentKeysResponse> {
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
}
