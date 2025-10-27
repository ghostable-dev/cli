import type { AAD, CipherAlg, Claims } from '@/types';
import type { EncryptedEnvelope } from '@/crypto';
import type { EncryptedEnvelopeJson } from '@/types';
import { encryptedEnvelopeFromJSON, encryptedEnvelopeToJSON } from '@/types';

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

export type EnvironmentKeyEnvelopeJson = {
        id?: string;
        version?: string | null;
        alg?: string | null;
        device_id: string;
        ciphertext_b64: string;
        nonce_b64: string;
        from_ephemeral_public_key: string;
        to_device_public_key?: string | null;
        created_at?: string | null;
        expires_at?: string | null;
        meta?: Record<string, string>;
        aad_b64?: string | null;
        sender_kid?: string | null;
        signature_b64?: string | null;
};

export type EnvironmentKeyEnvelope = {
        deviceId: string;
        envelope: EncryptedEnvelope;
        expiresAtIso: string | null;
};

export type EnvironmentKeyJson = {
        version: number;
        fingerprint?: string | null;
        created_at?: string | null;
        rotated_at?: string | null;
        created_by_device_id?: string | null;
        envelopes: EnvironmentKeyEnvelopeJson[];
};

export type EnvironmentKey = {
        version: number;
        fingerprint: string;
        createdAtIso: string | null;
        rotatedAtIso: string | null;
        createdByDeviceId: string | null;
        envelopes: EnvironmentKeyEnvelope[];
};

export type EnvironmentKeyEnvelopeUploadJson = {
        device_id: string;
        ciphertext_b64: string;
        nonce_b64: string;
        from_ephemeral_public_key: string;
        to_device_public_key?: string | null;
        created_at?: string | null;
        expires_at?: string | null;
        meta?: Record<string, string>;
        aad_b64?: string | null;
        sender_kid?: string | null;
        signature_b64?: string | null;
        alg?: string | null;
        version?: string | null;
        id?: string | null;
};

export type EnvironmentKeyEnvelopeUpload = {
        deviceId: string;
        envelope: EncryptedEnvelope;
        expiresAtIso?: string | null;
};

export type CreateEnvironmentKeyRequestJson = {
        fingerprint: string;
        version?: number;
        created_by_device_id?: string | null;
        rotated_at?: string | null;
        envelopes: EnvironmentKeyEnvelopeUploadJson[];
};

export type CreateEnvironmentKeyRequest = {
        fingerprint: string;
        version?: number;
        createdByDeviceId?: string | null;
        rotatedAtIso?: string | null;
        envelopes: EnvironmentKeyEnvelopeUpload[];
};

export type EnvironmentKeyResponseJson = {
        data: EnvironmentKeyJson | null;
};

export type EnvironmentKeyResponse = {
        data: EnvironmentKey | null;
};

function toEncryptedEnvelopeJson(
        envelope: EnvironmentKeyEnvelopeJson,
): EncryptedEnvelopeJson {
        return {
                id: envelope.id ?? '',
                version: envelope.version ?? 'v1',
                alg: envelope.alg ?? undefined,
                to_device_public_key: envelope.to_device_public_key ?? '',
                from_ephemeral_public_key: envelope.from_ephemeral_public_key,
                nonce_b64: envelope.nonce_b64,
                ciphertext_b64: envelope.ciphertext_b64,
                created_at: envelope.created_at ?? new Date().toISOString(),
                expires_at: envelope.expires_at ?? undefined,
                meta: envelope.meta,
                aad_b64: envelope.aad_b64 ?? undefined,
                sender_kid: envelope.sender_kid ?? undefined,
                signature_b64: envelope.signature_b64 ?? undefined,
        };
}

export function environmentKeyEnvelopeFromJSON(
        json: EnvironmentKeyEnvelopeJson,
): EnvironmentKeyEnvelope {
        return {
                deviceId: json.device_id,
                envelope: encryptedEnvelopeFromJSON(toEncryptedEnvelopeJson(json)),
                expiresAtIso: json.expires_at ?? null,
        };
}

export function environmentKeyFromJSON(json: EnvironmentKeyJson): EnvironmentKey {
        return {
                version: json.version,
                fingerprint: json.fingerprint ?? '',
                createdAtIso: json.created_at ?? null,
                rotatedAtIso: json.rotated_at ?? null,
                createdByDeviceId: json.created_by_device_id ?? null,
                envelopes: (json.envelopes ?? []).map(environmentKeyEnvelopeFromJSON),
        };
}

export function environmentKeyResponseFromJSON(
        json: EnvironmentKeyResponseJson,
): EnvironmentKeyResponse {
        return {
                data: json.data ? environmentKeyFromJSON(json.data) : null,
        };
}

export function environmentKeyEnvelopeUploadToJSON(
        upload: EnvironmentKeyEnvelopeUpload,
): EnvironmentKeyEnvelopeUploadJson {
        const json = encryptedEnvelopeToJSON(upload.envelope);
        return {
                device_id: upload.deviceId,
                ciphertext_b64: json.ciphertext_b64,
                nonce_b64: json.nonce_b64,
                from_ephemeral_public_key: json.from_ephemeral_public_key,
                to_device_public_key: json.to_device_public_key,
                created_at: json.created_at,
                ...(upload.expiresAtIso !== undefined
                        ? { expires_at: upload.expiresAtIso }
                        : {}),
                ...(json.meta ? { meta: json.meta } : {}),
                ...(json.aad_b64 ? { aad_b64: json.aad_b64 } : {}),
                ...(json.sender_kid ? { sender_kid: json.sender_kid } : {}),
                ...(json.signature_b64 ? { signature_b64: json.signature_b64 } : {}),
                ...(json.alg ? { alg: json.alg } : {}),
                ...(json.version ? { version: json.version } : {}),
                ...(json.id ? { id: json.id } : {}),
        };
}

export function createEnvironmentKeyRequestToJSON(
        request: CreateEnvironmentKeyRequest,
): CreateEnvironmentKeyRequestJson {
        return {
                fingerprint: request.fingerprint,
                ...(request.version !== undefined ? { version: request.version } : {}),
                ...(request.createdByDeviceId
                        ? { created_by_device_id: request.createdByDeviceId }
                        : {}),
                ...(request.rotatedAtIso ? { rotated_at: request.rotatedAtIso } : {}),
                envelopes: request.envelopes.map(environmentKeyEnvelopeUploadToJSON),
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
