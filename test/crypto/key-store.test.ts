import { beforeEach, describe, expect, it, vi } from 'vitest';

type KeytarMock = {
	getPassword: ReturnType<
		typeof vi.fn<(service: string, account: string) => Promise<string | null>>
	>;
	setPassword: ReturnType<
		typeof vi.fn<(service: string, account: string, password: string) => Promise<void>>
	>;
	deletePassword: ReturnType<
		typeof vi.fn<(service: string, account: string) => Promise<boolean>>
	>;
};

const keytarStub = vi.hoisted(() => ({
	getPassword: vi.fn<(service: string, account: string) => Promise<string | null>>(),
	setPassword: vi.fn<(service: string, account: string, password: string) => Promise<void>>(),
	deletePassword: vi.fn<(service: string, account: string) => Promise<boolean>>(),
})) as KeytarMock;

vi.mock('keytar', () => ({
	default: keytarStub,
}));

import { KeytarKeyStore, MemoryKeyStore } from '../../src/crypto/KeyStore.js';
import { KEYCHAIN_SERVICE_ENVIRONMENT } from '../../src/constants/keychain.js';

const SAMPLE_KEY = new Uint8Array([1, 2, 3, 4]);
const SAMPLE_B64 = 'AQIDBA==';

describe('MemoryKeyStore', () => {
	let store: MemoryKeyStore;

	beforeEach(() => {
		store = new MemoryKeyStore();
	});

	it('stores and retrieves values as Base64', async () => {
		await store.setKey('example', SAMPLE_KEY);
		expect(await store.getKey('example')).toEqual(SAMPLE_KEY);
	});

	it('deletes keys', async () => {
		await store.setKey('temp', SAMPLE_KEY);
		await store.deleteKey('temp');
		expect(await store.getKey('temp')).toBeNull();
	});

	it('validates input arguments', async () => {
		await expect(store.getKey('')).rejects.toThrow(TypeError);
		await expect(store.setKey('name', 'bad' as unknown as Uint8Array)).rejects.toThrow(
			TypeError,
		);
	});
});

describe('KeytarKeyStore', () => {
	beforeEach(() => {
		keytarStub.getPassword.mockReset();
		keytarStub.setPassword.mockReset();
		keytarStub.deletePassword.mockReset();
		keytarStub.setPassword.mockResolvedValue();
		keytarStub.getPassword.mockResolvedValue(null);
		keytarStub.deletePassword.mockResolvedValue(true);
	});

	it('uses the OS keychain to store and retrieve Base64 values', async () => {
		const store = new KeytarKeyStore();
		keytarStub.getPassword.mockResolvedValueOnce(SAMPLE_B64);

		await store.setKey('example', SAMPLE_KEY);
		expect(keytarStub.setPassword).toHaveBeenCalledWith(
			KEYCHAIN_SERVICE_ENVIRONMENT,
			'example',
			SAMPLE_B64,
		);

		const value = await store.getKey('example');
		expect(value).toEqual(SAMPLE_KEY);
		expect(keytarStub.getPassword).toHaveBeenCalledWith(
			KEYCHAIN_SERVICE_ENVIRONMENT,
			'example',
		);
	});

	it('supports custom service names', async () => {
		const store = new KeytarKeyStore('custom-service');
		await store.setKey('example', SAMPLE_KEY);
		expect(keytarStub.setPassword).toHaveBeenCalledWith(
			'custom-service',
			'example',
			SAMPLE_B64,
		);
	});

	it('supports dynamic service resolution per key', async () => {
		const resolver = vi.fn((name: string) => ({
			service: `svc-${name}`,
			account: 'data',
		}));
		const store = new KeytarKeyStore(resolver);
		await store.setKey('dynamic', SAMPLE_KEY);
		expect(resolver).toHaveBeenCalledWith('dynamic');
		expect(keytarStub.setPassword).toHaveBeenCalledWith('svc-dynamic', 'data', SAMPLE_B64);

		keytarStub.getPassword.mockResolvedValueOnce(SAMPLE_B64);
		const value = await store.getKey('dynamic');
		expect(value).toEqual(SAMPLE_KEY);
		expect(keytarStub.getPassword).toHaveBeenCalledWith('svc-dynamic', 'data');
	});

	it('validates input arguments', async () => {
		const store = new KeytarKeyStore();
		await expect(store.getKey('')).rejects.toThrow(TypeError);
		await expect(store.setKey('', SAMPLE_KEY)).rejects.toThrow(TypeError);
		await expect(store.deleteKey('')).rejects.toThrow(TypeError);
	});
});
