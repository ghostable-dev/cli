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

	/** Version of the environment KEK used during encryption (optional). */
	env_kek_version?: number;

	/** Fingerprint of the environment KEK used during encryption (optional). */
	env_kek_fingerprint?: string | null;
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

	/** Optional environment key metadata (fingerprint, envelope, recipients, etc.). */
	environment_key?: EnvironmentKeyResourceJson | null;

	/** Optional camel-cased variant returned by some APIs. */
	environmentKey?: EnvironmentKey | null;
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

export type EnvironmentKeyRecipientType = 'device' | 'deployment';

export type EnvironmentKeyEnvelopeRecipientJson = {
	type: EnvironmentKeyRecipientType;
	id: string;
	edek_b64: string;
	seen_at?: string | null;
};

export type EnvironmentKeyEnvelopeAttributesJson = {
	ciphertext_b64: string;
	nonce_b64: string;
	alg?: string | null;
	created_at?: string | null;
	updated_at?: string | null;
	revoked_at?: string | null;
	recipients?: EnvironmentKeyEnvelopeRecipientJson[] | null;
	from_ephemeral_public_key?: string | null;
};

export type EnvironmentKeyEnvelopeResourceJson = {
	id: string;
	type: string;
	attributes: EnvironmentKeyEnvelopeAttributesJson;
};

export type EnvironmentKeyResourceJson = {
	id: string;
	type: string;
	attributes: {
		version: number;
		fingerprint?: string | null;
		created_at?: string | null;
		rotated_at?: string | null;
		created_by_device_id?: string | null;
	};
	relationships?: {
		envelope?: {
			data: EnvironmentKeyEnvelopeResourceJson | null;
		};
	};
};

export type EnvironmentKeyRecipient = {
	type: EnvironmentKeyRecipientType;
	id: string;
	edekB64: string;
	seenAtIso: string | null;
};

export type EnvironmentKeyEnvelope = {
	id: string;
	ciphertextB64: string;
	nonceB64: string;
	alg: string | null;
	createdAtIso: string | null;
	updatedAtIso: string | null;
	revokedAtIso: string | null;
	recipients: EnvironmentKeyRecipient[];
	fromEphemeralPublicKey: string | null;
};

export type EnvironmentKey = {
	id: string | null;
	version: number;
	fingerprint: string;
	createdAtIso: string | null;
	rotatedAtIso: string | null;
	createdByDeviceId: string | null;
	envelope: EnvironmentKeyEnvelope | null;
};

export type EnvironmentKeyResponseJson = {
	data: EnvironmentKeyResourceJson | null;
};

export type EnvironmentKeyResponse = {
	data: EnvironmentKey | null;
};

export type EnvironmentKeyRecipientUploadJson = {
	type: EnvironmentKeyRecipientType;
	id: string;
	edek_b64: string;
};

export type EnvironmentKeyEnvelopeUploadJson = {
	ciphertext_b64: string;
	nonce_b64: string;
	alg?: string | null;
	recipients?: EnvironmentKeyRecipientUploadJson[] | null;
};

export type EnvironmentKeyRecipientUpload = {
	type: EnvironmentKeyRecipientType;
	id: string;
	edekB64: string;
};

export type EnvironmentKeyEnvelopeUpload = {
	ciphertextB64: string;
	nonceB64: string;
	alg?: string | null;
	recipients: EnvironmentKeyRecipientUpload[];
};

export type CreateEnvironmentKeyRequestJson = {
	fingerprint: string;
	version?: number;
	created_by_device_id?: string | null;
	rotated_at?: string | null;
	envelope: EnvironmentKeyEnvelopeUploadJson;
};

export type CreateEnvironmentKeyRequest = {
	fingerprint: string;
	version?: number;
	createdByDeviceId?: string | null;
	rotatedAtIso?: string | null;
	envelope: EnvironmentKeyEnvelopeUpload;
};

function environmentKeyRecipientFromJSON(
	json: EnvironmentKeyEnvelopeRecipientJson,
): EnvironmentKeyRecipient {
	return {
		type: json.type,
		id: json.id,
		edekB64: json.edek_b64,
		seenAtIso: json.seen_at ?? null,
	};
}

function environmentKeyEnvelopeFromJSON(
	resource: EnvironmentKeyEnvelopeResourceJson,
): EnvironmentKeyEnvelope {
	const attrs = resource.attributes;
	return {
		id: resource.id,
		ciphertextB64: attrs.ciphertext_b64,
		nonceB64: attrs.nonce_b64,
		alg: attrs.alg ?? null,
		createdAtIso: attrs.created_at ?? null,
		updatedAtIso: attrs.updated_at ?? null,
		revokedAtIso: attrs.revoked_at ?? null,
		recipients: (attrs.recipients ?? []).map(environmentKeyRecipientFromJSON),
		fromEphemeralPublicKey: attrs.from_ephemeral_public_key ?? null,
	};
}

export function environmentKeyFromJSON(resource: EnvironmentKeyResourceJson): EnvironmentKey {
	const attrs = resource.attributes;
	const envelopeResource = resource.relationships?.envelope?.data ?? null;
	return {
		id: resource.id ?? null,
		version: attrs.version,
		fingerprint: attrs.fingerprint ?? '',
		createdAtIso: attrs.created_at ?? null,
		rotatedAtIso: attrs.rotated_at ?? null,
		createdByDeviceId: attrs.created_by_device_id ?? null,
		envelope: envelopeResource ? environmentKeyEnvelopeFromJSON(envelopeResource) : null,
	};
}

export function environmentKeyResponseFromJSON(
	json: EnvironmentKeyResponseJson,
): EnvironmentKeyResponse {
	return {
		data: json.data ? environmentKeyFromJSON(json.data) : null,
	};
}

export function environmentKeyRecipientUploadToJSON(
	recipient: EnvironmentKeyRecipientUpload,
): EnvironmentKeyRecipientUploadJson {
	return {
		type: recipient.type,
		id: recipient.id,
		edek_b64: recipient.edekB64,
	};
}

export function environmentKeyEnvelopeUploadToJSON(
	envelope: EnvironmentKeyEnvelopeUpload,
): EnvironmentKeyEnvelopeUploadJson {
	return {
		ciphertext_b64: envelope.ciphertextB64,
		nonce_b64: envelope.nonceB64,
		...(envelope.alg ? { alg: envelope.alg } : {}),
		recipients: envelope.recipients.map(environmentKeyRecipientUploadToJSON),
	};
}

export function createEnvironmentKeyRequestToJSON(
	request: CreateEnvironmentKeyRequest,
): CreateEnvironmentKeyRequestJson {
	return {
		fingerprint: request.fingerprint,
		...(request.version !== undefined ? { version: request.version } : {}),
		...(request.createdByDeviceId ? { created_by_device_id: request.createdByDeviceId } : {}),
		...(request.rotatedAtIso ? { rotated_at: request.rotatedAtIso } : {}),
		envelope: environmentKeyEnvelopeUploadToJSON(request.envelope),
	};
}

export type CreateEnvironmentKeyEnvelopeRequestJson = {
	fingerprint: string;
	envelope: EnvironmentKeyEnvelopeUploadJson;
};

export type CreateEnvironmentKeyEnvelopeRequest = {
	fingerprint: string;
	envelope: EnvironmentKeyEnvelopeUpload;
};

export function createEnvironmentKeyEnvelopeRequestToJSON(
	request: CreateEnvironmentKeyEnvelopeRequest,
): CreateEnvironmentKeyEnvelopeRequestJson {
	return {
		fingerprint: request.fingerprint,
		envelope: environmentKeyEnvelopeUploadToJSON(request.envelope),
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
