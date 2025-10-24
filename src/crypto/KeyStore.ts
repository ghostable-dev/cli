import keytarModule from 'keytar';
import { toBase64, fromBase64 } from './utils';
import { KeyStore } from './types/KeyStore';

type KeytarLike = {
	getPassword(service: string, account: string): Promise<string | null>;
	setPassword(service: string, account: string, password: string): Promise<void>;
	deletePassword(service: string, account: string): Promise<boolean>;
};

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
 * Production-ready key store backed by the operating system keychain via `keytar`.
 * Stores binary values as Base64 strings to remain consistent with the rest of the codebase.
 */
export class KeytarKeyStore implements KeyStore {
	private readonly keytar: KeytarLike;

	constructor(
		private readonly service = 'ghostable-cli',
		keytarImpl: KeytarLike = keytarModule,
	) {
		if (!service) throw new TypeError('service must not be empty');
		this.keytar = keytarImpl;
	}

	async getKey(name: string): Promise<Uint8Array | null> {
		if (!name) throw new TypeError('name must not be empty');
		const value = await this.keytar.getPassword(this.service, name);
		return value ? fromBase64(value) : null;
	}

	async setKey(name: string, value: Uint8Array): Promise<void> {
		if (!name) throw new TypeError('name must not be empty');
		if (!(value instanceof Uint8Array)) throw new TypeError('value must be a Uint8Array');
		await this.keytar.setPassword(this.service, name, toBase64(value));
	}

	async deleteKey(name: string): Promise<void> {
		if (!name) throw new TypeError('name must not be empty');
		await this.keytar.deletePassword(this.service, name);
	}
}
