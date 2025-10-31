import type { DeploymentToken } from '@/domain';

export type DeploymentTokenStatusJson = 'active' | 'revoked';

export type DeploymentTokenEnvironmentJson = {
	id: string;
	name: string;
};

export type DeploymentTokenJson = {
	id: string;
	name: string;
	status: DeploymentTokenStatusJson;
	public_key: string;
	fingerprint?: string | null;
	last_used_at?: string | null;
	created_at: string;
	updated_at?: string | null;
	revoked_at?: string | null;
	environment: DeploymentTokenEnvironmentJson;
};

export type DeploymentTokenListResponseJson = {
	data?: DeploymentTokenJson[];
};

export type CreateDeploymentTokenRequestJson = {
	name: string;
	environment_id: string;
	public_key: string;
};

export type RotateDeploymentTokenRequestJson = {
	public_key: string;
};

export type DeployTokenSecretJson = {
	token: string;
};

export type CreateDeploymentTokenResponseJson = {
	data: DeploymentTokenJson;
	meta?: {
		secret?: DeployTokenSecretJson;
	};
};

export type RotateDeploymentTokenResponseJson = {
	data: DeploymentTokenJson;
};

export type RevokeDeploymentTokenResponseJson = {
	data: DeploymentTokenJson;
};

export type DeploymentTokenWithSecret = {
	token: DeploymentToken;
	secret?: string;
};

export function deploymentTokenFromJSON(json: DeploymentTokenJson): DeploymentToken {
	return {
		id: json.id,
		name: json.name,
		status: json.status,
		publicKey: json.public_key,
		fingerprint: json.fingerprint ?? null,
		lastUsedAt: json.last_used_at ? new Date(json.last_used_at) : null,
		createdAt: new Date(json.created_at),
		updatedAt: json.updated_at ? new Date(json.updated_at) : null,
		revokedAt: json.revoked_at ? new Date(json.revoked_at) : null,
		environmentId: json.environment.id,
		environmentName: json.environment.name,
	};
}
