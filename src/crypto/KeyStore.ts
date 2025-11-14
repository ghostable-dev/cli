import { KEYCHAIN_SERVICE_ENVIRONMENT } from '@/keychain';
import { toBase64, fromBase64 } from './utils.js';
import { KeyStore } from './types/KeyStore.js';

type KeytarLike = {
	getPassword(service: string, account: string): Promise<string | null>;
	setPassword(service: string, account: string, password: string): Promise<void>;
	deletePassword(service: string, account: string): Promise<boolean>;
};

type KeytarTarget = {
	service: string;
	account: string;
};

type KeytarTargetResolver = (name: string) => KeytarTarget;

function passThroughResolver(service: string): KeytarTargetResolver {
	if (!service) throw new TypeError('service must not be empty');
	return (name: string) => ({
		service,
		account: name,
	});
}

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
	private readonly resolve: KeytarTargetResolver;

	constructor(
		serviceOrResolver: string | KeytarTargetResolver = KEYCHAIN_SERVICE_ENVIRONMENT,
		keytarImpl?: KeytarLike,
	) {
		if (!serviceOrResolver) throw new TypeError('service must not be empty');
		if (!keytarImpl) throw new TypeError('keytar implementation must be provided');
		this.resolve =
			typeof serviceOrResolver === 'function'
				? serviceOrResolver
				: passThroughResolver(serviceOrResolver);
		this.keytar = keytarImpl;
	}

	private resolveTarget(name: string): KeytarTarget {
		const target = this.resolve(name);
		if (!target?.service) {
			throw new Error('Keytar service name resolver returned an invalid service.');
		}
		if (!target.account) {
			throw new Error('Keytar service name resolver returned an invalid account.');
		}
		return target;
	}

	async getKey(name: string): Promise<Uint8Array | null> {
		if (!name) throw new TypeError('name must not be empty');
		const { service, account } = this.resolveTarget(name);
		const value = await this.keytar.getPassword(service, account);
		return value ? fromBase64(value) : null;
	}

	async setKey(name: string, value: Uint8Array): Promise<void> {
		if (!name) throw new TypeError('name must not be empty');
		if (!(value instanceof Uint8Array)) throw new TypeError('value must be a Uint8Array');
		const { service, account } = this.resolveTarget(name);
		await this.keytar.setPassword(service, account, toBase64(value));
	}

	async deleteKey(name: string): Promise<void> {
		if (!name) throw new TypeError('name must not be empty');
		const { service, account } = this.resolveTarget(name);
		await this.keytar.deletePassword(service, account);
	}
}
