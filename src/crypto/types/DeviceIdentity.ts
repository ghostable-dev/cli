/**
 * Represents the cryptographic key sets bound to a single device.
 * Each device (workstation, developer machine, CI runner) has a unique
 * DeviceIdentity, defining its role in Ghostable’s end-to-end encryption.
 * Private keys never leave the device. Public keys are shared for encryption.
 */
export type DeviceIdentity = {
	// Unique device identifier (UUID generated during linking)
	deviceId: string;

	// Optional human-readable label (e.g., "Joe's MacBook Pro")
	name?: string;

	// Optional platform info (e.g., "macos", "windows", "linux", "ci")
	platform?: string;

	// ISO timestamps for lifecycle tracking
	createdAtIso: string;
	lastSeenAtIso?: string;
	rotatedAtIso?: string;
	revokedAtIso?: string;

	// Increments on key rotation to track key versions
	version?: number;

	/**
	 * Used for digital signatures and attestation with Ed25519.
	 * Verifies actions like publishing prekeys or signing audit logs.
	 */
	signingKey: {
		alg: 'Ed25519';
		publicKey: string;
		privateKey: string;
	};

	/**
	 * Used for encryption and key exchange with X25519.
	 * Enables secure exchange of environment KEKs and envelopes.
	 * The private key is typically independent but may be derived from
	 * the signing key in specific cases (e.g., deterministic key generation).
	 */
	encryptionKey: {
		alg: 'X25519';
		publicKey: string;
		privateKey: string;
		derivedFromSigningKey?: boolean; // True if encryption key is derived from signing key
	};
};
