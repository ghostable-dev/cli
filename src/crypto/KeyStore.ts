import { toBase64, fromBase64 } from './utils';
import { KeyStore } from './types/KeyStore';

/**
 * In-memory key store for testing or development.
 * Stores keys in plain memory (insecure for production).
 * Keys are stored as Base64 strings internally for consistency with the codebase.
 */
export class MemoryKeyStore implements KeyStore {
	private map = new Map<string, string>();

	async getKey(name: string): Promise<Uint8Array | null> {
		if (!name) throw new TypeError('name must not be empty');
		const value = this.map.get(name);
		return value ? fromBase64(value) : null;
	}

	async setKey(name: string, value: Uint8Array): Promise<void> {
		if (!name) throw new TypeError('name must not be empty');
		if (!(value instanceof Uint8Array)) throw new TypeError('value must be a Uint8Array');
		this.map.set(name, toBase64(value));
	}

	async deleteKey(name: string): Promise<void> {
		if (!name) throw new TypeError('name must not be empty');
		this.map.delete(name);
	}
}

/**
 * Placeholder for a keychain-based key store using keytar (for macOS Keychain, Windows Credential Manager, Linux Secret Service).
 * To be implemented for production to securely store private keys and derived keys.
 */
/*
export class KeytarKeyStore implements KeyStore {
  private service = 'ghostable';

  async getKey(name: string): Promise<Uint8Array | null> {
    if (!name) throw new TypeError('name must not be empty');
    const value = await keytar.getPassword(this.service, name);
    return value ? fromBase64(value) : null;
  }

  async setKey(name: string, value: Uint8Array): Promise<void> {
    if (!name) throw new TypeError('name must not be empty');
    if (!(value instanceof Uint8Array)) throw new TypeError('value must be a Uint8Array');
    await keytar.setPassword(this.service, name, toBase64(value));
  }

  async deleteKey(name: string): Promise<void> {
    if (!name) throw new TypeError('name must not be empty');
    await keytar.deletePassword(this.service, name);
  }
}
*/
