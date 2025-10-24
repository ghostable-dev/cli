/**
 * Represents an encrypted envelope delivered to a specific device.
 * All binary fields are Base64-encoded (standard, no prefix).
 * The recipient uses 'fromEphemeralPublicKey' and their X25519 private key to derive the AEAD key.
 * The 'nonceB64' is the AEAD nonce (24 bytes for XChaCha20-Poly1305).
 * The 'ciphertextB64' contains the AEAD output.
 * The 'meta' or 'aadB64' is authenticated but not encrypted (used as AEAD associated data).
 * An optional Ed25519 signature asserts sender identity.
 * The 'version' ensures forward compatibility for KDF/AEAD/format.
 */
export type EncryptedEnvelope = {
	// Unique identifier (UUID) for deduplication and replay detection
	id: string;

	// Version of the envelope format (e.g., "v1" for hkdf info "ghostable:envelope:v1")
	version: string;

	// Cryptographic algorithm (informational, e.g., "XChaCha20-Poly1305+HKDF-SHA256")
	alg?: string;

	// Recipient's X25519 public key (Base64), indexable server-side
	toDevicePublicKey: string;

	// Ephemeral X25519 public key (Base64), required for shared secret derivation
	fromEphemeralPublicKey: string;

	// AEAD nonce (Base64, 24 bytes for XChaCha20-Poly1305)
	nonceB64: string;

	// AEAD ciphertext (Base64)
	ciphertextB64: string;

	// Creation timestamp (ISO 8601)
	createdAtIso: string;

	// Optional expiration timestamp (ISO 8601)
	expiresAtIso?: string;

	// Optional JSON metadata, used as AEAD associated data
	meta?: Record<string, string>;

	// Optional binary AEAD associated data (Base64), used instead of or with meta
	aadB64?: string;

	// Optional SHA-256 thumbprint (hex) of sender's signing public key
	senderKid?: string;

	// Optional Ed25519 signature (Base64) over canonical envelope fields
	signatureB64?: string;
};
