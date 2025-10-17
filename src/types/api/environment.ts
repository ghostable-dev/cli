import type { AAD, CipherAlg, Claims } from '@/types';

/**
 * Environment shape returned by Ghostable’s API.
 */
export type EnvironmentJson = {
	/** Unique identifier for the environment (UUID). */
	id: string;

	/** Display name of the environment. */
	name: string;

	/** Type identifier (e.g., "production", "development"). */
	type: string;

	/** Parent environment ID (UUID) or null. */
	base_id: string | null;

	/** ISO 8601 timestamps. */
	created_at: string;
	updated_at: string;
};

/**
 * Environment type shape returned by Ghostable’s API.
 */
export type EnvironmentTypeJson = {
	/** Enum value (e.g., "production", "staging", "development"). */
	value: string;

	/** Human-friendly label for display. */
	label: string;
};

/**
 * Suggested environment name shape.
 */
export type EnvironmentSuggestedNameJson = {
	/** Suggested, slug-formatted environment name. */
	name: string;
};

/**
 * Common fields for environment secrets (shared by upload and response).
 */
export type EnvironmentSecretCommon = {
	/** Environment layer this secret came from (e.g., "production"). */
	env: string;

	/** Variable key, e.g., "APP_KEY". */
	name: string;

	/** Base64-encoded ciphertext of the variable value. */
	ciphertext: string;

	/** Base64-encoded nonce used for encryption. */
	nonce: string;

	/** Encryption algorithm used. */
	alg: CipherAlg;

	/** Authenticated associated data (org/project/env/name). */
	aad: AAD;

	/** Optional claims (HMAC, validators, etc.) attached by the client. */
	claims?: Claims;
};

/**
 * Metadata for an environment secret.
 * Describes storage or presentation properties of an environment variable.
 */
export type EnvironmentSecretMetadata = {
	/** Number of bytes the variable's value occupies in its encoded form. */
	line_bytes?: number;

	/** Indicates if the variable is a Vapor-managed secret. */
	is_vapor_secret?: boolean;

	/** True if this variable is commented (disabled) in the .env output. */
	is_commented?: boolean;

	/** True if this variable overrides a value from a parent environment. */
	is_override?: boolean;
};

/**
 * Environment secret shape returned by Ghostable’s API.
 * Represents a single encrypted environment variable.
 */
export type EnvironmentSecretJson = EnvironmentSecretCommon & {
	/** Incremental version of this secret in the environment. */
	version?: number;

	/** Optional metadata describing how this variable should be rendered or merged. */
	meta?: EnvironmentSecretMetadata;
};

/**
 * Bundle of environment secrets merged across inheritance layers.
 */
export type EnvironmentSecretBundleJson = {
	/** Target environment name (e.g., "local"). */
	env: string;

	/** Chain of inherited environments (parent → child). */
	chain: string[];

	/** List of encrypted secrets across the chain. */
	secrets: EnvironmentSecretJson[];
};

/**
 * Lightweight metadata for a single environment variable (no values).
 * Returned by GET /projects/{projectId}/environments/{envName}/keys
 */
export type EnvironmentKeySummaryJson = {
	name: string;
	/** Opaque version identifier (number or string depending on backend). */
	version: number | string | null;
	/** ISO8601 timestamp or null if unknown. */
	updated_at: string | null;
	/** Email of the last updater (if available). */
	updated_by_email: string | null;
};

export type EnvironmentKeysResponseJson = {
	project_id: string;
	environment: string;
	count: number;
	data: EnvironmentKeySummaryJson[];
};

/** Camel-cased client shapes */
export type EnvironmentKeySummary = {
	name: string;
	version: number | string | null;
	updatedAt: string | null;
	updatedByEmail: string | null;
};

export type EnvironmentKeysResponse = {
	projectId: string;
	environment: string;
	count: number;
	data: EnvironmentKeySummary[];
};

/** JSON → TS mappers */
export function environmentKeysFromJSON(
	json: EnvironmentKeysResponseJson,
): EnvironmentKeysResponse {
	return {
		projectId: json.project_id,
		environment: json.environment,
		count: json.count,
		data: json.data.map(environmentKeySummaryFromJSON),
	};
}

export function environmentKeySummaryFromJSON(
	item: EnvironmentKeySummaryJson,
): EnvironmentKeySummary {
	return {
		name: item.name,
		version: item.version ?? null,
		updatedAt: item.updated_at ?? null,
		updatedByEmail: item.updated_by_email ?? null,
	};
}

/**
 * Validator claims attached by the client during upload.
 */
export type SecretUploadValidators = Record<string, unknown>;

/**
 * Unsigned upload request for a single environment secret.
 */
export type EnvironmentSecretUploadRequest = EnvironmentSecretCommon & {
	/** Optimistic concurrency guard. */
	if_version?: number;
};

/**
 * Signed upload request the CLI submits to the API.
 */
export type SignedEnvironmentSecretUploadRequest = EnvironmentSecretUploadRequest & {
	/** Ed25519 signature over the JSON body (excluding this field). */
	client_sig: string;
};

export type SignedEnvironmentSecretBatchUploadRequest = {
	secrets: SignedEnvironmentSecretUploadRequest[];
};
