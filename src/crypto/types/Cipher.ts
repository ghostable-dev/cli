/** Single source of truth (runtime value). */
export const CIPHER_ALG = 'xchacha20-poly1305' as const;

/** Type derived from the constant (no duplication). */
export type CipherAlg = typeof CIPHER_ALG;

/**
 * Cryptographic integrity and validation information bound to an
 * environment secret during upload.
 *
 * - **hmac** — Base64-encoded HMAC of the plaintext, computed with the
 *   per-scope HMAC key. The server never sees the key; this value is
 *   used client-side for drift / equality detection and tamper checking.
 */
export type Claims = {
	/** Base64-encoded HMAC digest of the plaintext value. */
	hmac: string;
};

/**
 * Authenticated Associated Data (AAD) bound to an encryption operation.
 * This ensures that each ciphertext is uniquely tied to its organization,
 * project, environment, and variable name — preventing cross-context reuse.
 */
export type AAD = {
	/** Organization identifier this secret belongs to. */
	org: string;

	/** Project identifier under the organization. */
	project: string;

	/** Environment name (e.g., "production", "staging", "local"). */
	env: string;

	/** Variable key name (e.g., "APP_KEY"). */
	name: string;
};

/**
 * Standard cipher bundle produced during encryption.
 * Combines ciphertext, nonce, algorithm, and AAD metadata.
 */
export type CipherBundle = {
	/** Encryption algorithm used. */
	alg: CipherAlg;

	/** Base64-encoded nonce used for encryption. */
	nonce: string;

	/** Base64-encoded ciphertext produced by encryption. */
	ciphertext: string;

	/** Authenticated associated data (AAD) tied to this cipher. */
	aad: AAD;
};
