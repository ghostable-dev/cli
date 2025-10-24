/**
 * Represents a short-lived X25519 keypair whose public key is signed by the device's Ed25519 signing key.
 * All binary fields are Base64-encoded (32 bytes for public/private keys and signatures).
 * The private key is local-only and never sent to the server.
 */
export type SignedPrekey = {
	// Unique identifier (UUID) for server indexing
	id: string;

	// X25519 public key (Base64)
	publicKey: string;

	// X25519 private key (Base64), local-only
	privateKey?: string;

	// Ed25519 signature over the public key (Base64)
	signatureFromSigningKey: string;

	// SHA-256 thumbprint (hex) of the signing public key
	signerKid?: string;

	// Creation timestamp (ISO 8601)
	createdAtIso: string;

	// Optional expiration timestamp (ISO 8601) for rotation
	expiresAtIso?: string;

	// Whether the prekey is revoked
	revoked?: boolean;
};
