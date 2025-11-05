import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

type X25519Mock = {
	generateKeyPair: ReturnType<
		typeof vi.fn<() => { publicKey: Uint8Array; secretKey: Uint8Array }>
	>;
	sharedKey: ReturnType<typeof vi.fn<(secret: Uint8Array, pub: Uint8Array) => Uint8Array>>;
	__reset: () => void;
};

type Ed25519Mock = {
	utils: {
		randomPrivateKey: ReturnType<typeof vi.fn<() => Uint8Array>>;
	};
	etc: Record<string, unknown>;
	getPublicKey: ReturnType<typeof vi.fn<(priv: Uint8Array) => Promise<Uint8Array>>>;
	sign: ReturnType<typeof vi.fn<(msg: Uint8Array, priv: Uint8Array) => Promise<Uint8Array>>>;
	verify: ReturnType<typeof vi.fn<() => Promise<boolean>>>;
	__reset: () => void;
};

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

const x25519Stub = vi.hoisted(() => {
	let counter = 0;
	return {
		generateKeyPair: vi.fn(() => {
			const base = counter++;
			return {
				publicKey: new Uint8Array(32).fill(base + 1),
				secretKey: new Uint8Array(32).fill(base + 2),
			};
		}),
		sharedKey: vi.fn(() => new Uint8Array(32).fill(7)),
		__reset: () => {
			counter = 0;
		},
	} satisfies X25519Mock;
}) as X25519Mock;

const ed25519Stub = vi.hoisted(() => {
	let counter = 0;
	return {
		utils: {
			randomPrivateKey: vi.fn(() => new Uint8Array(32).fill(++counter)),
		},
		etc: {},
		getPublicKey: vi.fn(async (priv: Uint8Array) => Uint8Array.from(priv, (v) => v ^ 0xff)),
		sign: vi.fn(async (_msg: Uint8Array, priv: Uint8Array) => {
			const signature = new Uint8Array(64);
			signature.set(priv.slice(0, 32), 0);
			signature.set(priv.slice(0, 32), 32);
			return signature;
		}),
		verify: vi.fn(async () => true),
		__reset: () => {
			counter = 0;
		},
	} satisfies Ed25519Mock;
}) as Ed25519Mock;

vi.mock('@stablelib/x25519', () => x25519Stub);
vi.mock('@noble/ed25519', () => ed25519Stub);

const keytarStub = vi.hoisted(() => ({
	getPassword: vi.fn(async () => null),
	setPassword: vi.fn(async () => {}),
	deletePassword: vi.fn(async () => true),
})) as KeytarMock;

vi.mock('keytar', () => keytarStub);

const uuidStub = vi.hoisted(() => {
	let counter = 0;
	return {
		v4: vi.fn(() => `uuid-${++counter}`),
	};
}) as { v4: ReturnType<typeof vi.fn<() => string>> };

vi.mock('uuid', () => uuidStub);
const randomStub = vi.hoisted(() => ({
	randomBytes: vi.fn((length: number) => new Uint8Array(length).fill(4)),
}));

vi.mock('@stablelib/random', () => randomStub);

type KeyServiceModule = typeof import('../../src/crypto/KeyService.js');
type KeyStoreModule = typeof import('../../src/crypto/KeyStore.js');

let KeyService: KeyServiceModule['KeyService'];
let MemoryKeyStore: KeyStoreModule['MemoryKeyStore'];

beforeAll(async () => {
	({ KeyService } = await import('../../src/crypto/KeyService.js'));
	({ MemoryKeyStore } = await import('../../src/crypto/KeyStore.js'));
});

describe('KeyService', () => {
	let store: MemoryKeyStore;

	beforeEach(() => {
		store = new MemoryKeyStore();
		KeyService.initialize(store);
		x25519Stub.__reset();
		ed25519Stub.__reset();
	});

	it('creates device identities and persists private keys', async () => {
		const identity = await KeyService.createDeviceIdentity('CLI', 'linux');

		const signing = await store.getKey(`device:${identity.deviceId}:signingKey`);
		const encryption = await store.getKey(`device:${identity.deviceId}:encryptionKey`);

		expect(signing).not.toBeNull();
		expect(encryption).not.toBeNull();
		expect(Buffer.from(signing!).toString('base64')).toBe(identity.signingKey.privateKey);
		expect(Buffer.from(encryption!).toString('base64')).toBe(identity.encryptionKey.privateKey);
	});

	it('encrypts for a recipient using the ephemeral secret key for shared secret derivation', async () => {
		const identity = await KeyService.createDeviceIdentity('CLI', 'linux');
		const recipientPub = Buffer.from(new Uint8Array(32).fill(9)).toString('base64');
		const payload = new Uint8Array([1, 2, 3, 4]);

		x25519Stub.sharedKey.mockClear();

		const envelope = await KeyService.encryptForDevice(identity, recipientPub, payload);

		expect(x25519Stub.sharedKey).toHaveBeenCalledTimes(1);
		const [secretArg, pubArg] = x25519Stub.sharedKey.mock.calls[0];
		expect(Array.from(secretArg)).toEqual(new Array(32).fill(3));
		expect(Array.from(pubArg)).toEqual(new Array(32).fill(9));
		expect(envelope.fromEphemeralPublicKey).toBe(
			Buffer.from(new Uint8Array(32).fill(2)).toString('base64'),
		);
	});
});
