import { HttpClient } from "../http/HttpClient.js";
import { Organization } from "../entities/Organization.js";

type LoginResponse = { token?: string; two_factor?: boolean };
type ListResp<T> = { data: T[] };
type ProjectJson = { id: string | number; name: string; environments?: any[] };

export type ProjectionEntry = {
  env: string; // layer name (e.g., "production")
  name: string; // variable key
  ciphertext: string;
  nonce: string;
  alg: "xchacha20-poly1305";
  aad: Record<string, any>;
  claims: Record<string, any>; // includes hmac, validators, meta?
  version?: number;
  meta?: {
    line_bytes?: number;
    is_vapor_secret?: boolean;
    is_commented?: boolean;
    is_override?: boolean;
  };
};

export type ProjectionBundle = {
  env: string; // target env (e.g., "local")
  chain: string[]; // parent → ... → target
  secrets: ProjectionEntry[]; // encrypted entries across the chain
};

export class GhostableClient {
  constructor(private http: HttpClient) {}

  static unauthenticated(apiBase: string) {
    return new GhostableClient(new HttpClient(apiBase));
  }

  withToken(token: string) {
    return new GhostableClient(this.http.withBearer(token));
  }

  async login(email: string, password: string, code?: string): Promise<string> {
    const res = await this.http.post<LoginResponse>("/cli/login", {
      email,
      password,
      ...(code ? { code } : {}),
    });
    if (!res.token) throw new Error("Authentication failed");
    return res.token;
  }

  // List projects for an organization
  async projects(
    organizationId: string,
  ): Promise<Array<{ id: string; name: string; environments?: any[] }>> {
    const res = await this.http.get<ListResp<ProjectJson>>(
      `/organizations/${organizationId}/projects`,
    );
    return (res.data ?? []).map((p: ProjectJson) => ({
      id: String(p.id),
      name: p.name,
      environments: p.environments ?? [],
    }));
  }

  // Create a project in an organization
  async createProject(input: {
    organizationId: string;
    name: string;
  }): Promise<{ id: string; name: string; environments?: any }> {
    const res = await this.http.post<ProjectJson>(
      `/organizations/${input.organizationId}/projects`,
      { name: input.name },
    );
    return {
      id: String(res.id),
      name: res.name,
      environments: res.environments ?? [],
    };
  }

  async organizations(): Promise<Organization[]> {
    const res = await this.http.get<{ data: any[] }>("/organizations");
    return Array.isArray(res.data) ? res.data.map(Organization.fromJSON) : [];
  }

  async uploadSecret(
    projectId: string,
    envName: string,
    payload: any,
  ): Promise<{ id?: string; version?: number }> {
    const p = encodeURIComponent(projectId);
    const e = encodeURIComponent(envName);
    return this.http.post(`/projects/${p}/environments/${e}/secrets`, payload);
  }

  async pull(
    projectId: string,
    envName: string,
    opts?: {
      only?: string[];
      includeMeta?: boolean;
      includeVersions?: boolean;
    },
  ): Promise<ProjectionBundle> {
    const p = encodeURIComponent(projectId);
    const e = encodeURIComponent(envName);

    const qs = new URLSearchParams();
    if (opts?.includeMeta) qs.set("include_meta", "1");
    if (opts?.includeVersions) qs.set("include_versions", "1");
    if (opts?.only?.length) for (const k of opts.only) qs.append("only[]", k);

    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return this.http.get<ProjectionBundle>(
      `/projects/${p}/environments/${e}/pull${suffix}`,
    );
  }

  async deploy(opts?: {
    only?: string[];
    includeMeta?: boolean;
    includeVersions?: boolean;
  }): Promise<ProjectionBundle> {
    const qs = new URLSearchParams();
    if (opts?.includeMeta) qs.set("include_meta", "1");
    if (opts?.includeVersions) qs.set("include_versions", "1");
    if (opts?.only?.length) for (const k of opts.only) qs.append("only[]", k);

    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return this.http.get<ProjectionBundle>(`/ci/deploy`);
  }

  // Example projection fetch
  async projection(params: {
    org: string;
    project: string;
    env: string;
  }): Promise<any> {
    const q = new URLSearchParams(params as any).toString();
    return this.http.get(`/v1/projections?${q}`);
  }

  async getEnvironmentTypes(): Promise<
    Array<{ value: string; label: string }>
  > {
    const res = await this.http.get<{
      data: Array<{ value: string; label: string }>;
    }>("/environment-types");
    return Array.isArray(res.data) ? res.data : [];
  }

  async getEnvironments(
    projectId: string,
  ): Promise<Array<{ id: string; name: string }>> {
    const p = encodeURIComponent(projectId);
    const res = await this.http.get<{
      data: Array<{ id: string | number; name: string }>;
    }>(`/projects/${p}/environments`);
    return (res.data ?? []).map((e) => ({ id: String(e.id), name: e.name }));
  }

  async suggestEnvironmentNames(
    projectId: string,
    type: string,
  ): Promise<Array<{ name: string }>> {
    const p = encodeURIComponent(projectId);
    const res = await this.http.post<{ data: Array<{ name: string }> }>(
      `/projects/${p}/generate-suggested-environment-names`,
      { type },
    );
    return Array.isArray(res.data) ? res.data : [];
  }

  async createEnvironment(input: {
    projectId: string;
    name: string;
    type: string;
    baseId: string | null;
  }): Promise<{ id: string; name: string; type: string }> {
    const p = encodeURIComponent(input.projectId);
    return this.http.post<{ id: string; name: string; type: string }>(
      `/projects/${p}/environments`,
      { name: input.name, type: input.type, base_id: input.baseId },
    );
  }
}
