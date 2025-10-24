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
		expect(keytarStub.setPassword).toHaveBeenCalledWith('ghostable-cli', 'example', SAMPLE_B64);

		const value = await store.getKey('example');
		expect(value).toEqual(SAMPLE_KEY);
		expect(keytarStub.getPassword).toHaveBeenCalledWith('ghostable-cli', 'example');
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

	it('validates input arguments', async () => {
		const store = new KeytarKeyStore();
		await expect(store.getKey('')).rejects.toThrow(TypeError);
		await expect(store.setKey('', SAMPLE_KEY)).rejects.toThrow(TypeError);
		await expect(store.deleteKey('')).rejects.toThrow(TypeError);
	});
});
