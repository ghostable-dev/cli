import type { DeploymentToken } from '@/domain';

export type DeploymentTokenStatusJson = 'active' | 'revoked';

export type DeploymentTokenEnvironmentJson = {
	id: string;
	name: string;
};

type DeploymentTokenAttributesJson = {
	name?: string;
	status?: DeploymentTokenStatusJson;
	public_key?: string;
	fingerprint?: string | null;
	last_used_at?: string | null;
	created_at?: string;
	updated_at?: string | null;
	revoked_at?: string | null;
	environment?: DeploymentTokenEnvironmentJson | null;
	environment_id?: string | null;
	environment_name?: string | null;
};

export type DeploymentTokenJson =
	| {
			id: string;
			attributes: DeploymentTokenAttributesJson;
	  }
	| ({ id: string } & DeploymentTokenAttributesJson);

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

export type CreateDeploymentTokenResponseJson = {
	data: DeploymentTokenJson;
	meta?: {
		secret?: string;
		api_token?: {
			plain_text: string;
			id: string;
			name: string;
			token_suffix: string;
			expires_at?: string | null;
		};
	};
};

export type RotateDeploymentTokenResponseJson = {
	data: DeploymentTokenJson;
};

export type RevokeDeploymentTokenResponseJson = {
	data: DeploymentTokenJson;
};

export type DeploymentApiTokenMeta = {
	plainText: string;
	id: string;
	name: string;
	tokenSuffix: string;
	expiresAt: Date | null;
};

export type DeploymentTokenWithSecret = {
	token: DeploymentToken;
	secret?: string;
	apiToken?: DeploymentApiTokenMeta;
};

export function deploymentTokenFromJSON(json: DeploymentTokenJson): DeploymentToken {
	const attrs: DeploymentTokenAttributesJson = 'attributes' in json ? json.attributes : json;

	const name = attrs.name ?? null;
	const status = attrs.status ?? null;
	const publicKey = attrs.public_key ?? null;
	const createdAtIso = attrs.created_at ?? null;

	if (!name) {
		throw new Error('Deployment token is missing name');
	}

	if (!status) {
		throw new Error('Deployment token is missing status');
	}

	if (!publicKey) {
		throw new Error('Deployment token is missing public_key');
	}

	if (!createdAtIso) {
		throw new Error('Deployment token is missing created_at');
	}

	const environmentId = attrs.environment?.id ?? attrs.environment_id ?? '';
	if (!environmentId) {
		throw new Error('Deployment token is missing environment identifier');
	}

	const environmentName = attrs.environment?.name ?? attrs.environment_name ?? environmentId;

	return {
		id: json.id,
		name,
		status,
		publicKey,
		fingerprint: attrs.fingerprint ?? null,
		lastUsedAt: attrs.last_used_at ? new Date(attrs.last_used_at) : null,
		createdAt: new Date(createdAtIso),
		updatedAt: attrs.updated_at ? new Date(attrs.updated_at) : null,
		revokedAt: attrs.revoked_at ? new Date(attrs.revoked_at) : null,
		environmentId,
		environmentName,
	};
}
