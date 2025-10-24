/**
 * Interface for securely storing and retrieving cryptographic keys.
 * Used to manage private keys (e.g., DeviceIdentity, SignedPrekey) and derived keys (e.g., KEKs, DEKs).
 * Implementations may use in-memory storage (for testing) or platform-specific keychains (for production).
 */
export interface KeyStore {
	/** Retrieves a key by name, returning null if not found. */
	getKey(name: string): Promise<Uint8Array | null>;

	/** Stores a key by name. */
	setKey(name: string, value: Uint8Array): Promise<void>;

	/** Deletes a key by name. */
	deleteKey(name: string): Promise<void>;
}
