/**
 * Represents an ephemeral X25519 keypair uploaded to the server and consumed once.
 * The server stores only 'id' and 'publicKey' (plus consumption metadata).
 * The private key is local-only and deleted after consumption.
 * All binary fields are Base64-encoded (32 bytes for keys).
 */
export type OneTimePrekey = {
	// Unique identifier (UUID) for server indexing
	id: string;

	// X25519 public key (Base64)
	publicKey: string;

	// X25519 private key (Base64), local-only
	privateKey?: string;

	// Creation timestamp (ISO 8601)
	createdAtIso: string;

	// Timestamp (ISO 8601) when consumed, set by server
	consumedAtIso?: string;

	// Device or session ID that consumed the prekey, set by server
	consumedBy?: string;

	// Optional expiration timestamp (ISO 8601)
	expiresAtIso?: string;

	// Whether the prekey is revoked
	revoked?: boolean;

	// SHA-256 fingerprint (hex) derived from the public key
	fingerprint?: string;
};
