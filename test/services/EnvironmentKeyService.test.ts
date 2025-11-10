import { XChaCha20Poly1305 } from '@stablelib/xchacha20poly1305';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DeviceIdentity } from '../../src/crypto/types/DeviceIdentity.js';
import type { EnvironmentKey } from '../../src/ghostable/types/environment.js';
import type { EncryptedEnvelope } from '../../src/crypto/index.js';
import { encryptedEnvelopeToJSON } from '../../src/ghostable/types/crypto.js';
import { KEYCHAIN_SERVICE_ENVIRONMENT } from '../../src/keychain/constants.js';

type GhostableClientCtor =
	(typeof import('../../src/ghostable/GhostableClient.js'))['GhostableClient'];

type EnvironmentKeyServiceCtor =
	(typeof import('../../src/environment/keys/EnvironmentKeyService.js'))['EnvironmentKeyService'];

const keytarMock = vi.hoisted(() => ({
	getPassword: vi.fn<[service: string, account: string], Promise<string | null>>(),
	setPassword: vi.fn<[service: string, account: string, password: string], Promise<void>>(),
}));

const loadKeytarMock = vi.hoisted(() => vi.fn(async () => keytarMock));

vi.mock('../../src/keychain/index.js', async () => {
	const actual = await vi.importActual<typeof import('../../src/keychain/index.js')>(
		'../../src/keychain/index.js',
	);
	return {
		...actual,
		loadKeytar: loadKeytarMock,
	};
});

const decryptOnThisDeviceMock = vi.hoisted(() =>
	vi.fn<(typeof import('../../src/crypto/index.js'))['KeyService']['decryptOnThisDevice']>(),
);

const randomBytesMock = vi.hoisted(() =>
	vi.fn<(typeof import('../../src/crypto/index.js'))['randomBytes']>((size = 32) =>
		new Uint8Array(size).fill(1),
	),
);

const edSignMock = vi.hoisted(() =>
	vi.fn<(typeof import('../../src/crypto/index.js'))['edSign']>(async () => new Uint8Array([1])),
);

vi.mock(
	'@/crypto',
	() => ({
		KeyService: {
			decryptOnThisDevice: decryptOnThisDeviceMock,
		},
		randomBytes: randomBytesMock,
		CIPHER_ALG: 'xchacha20-poly1305',
		edSign: edSignMock,
		b64: (bytes: Uint8Array) => Buffer.from(bytes).toString('base64'),
	}),
	{ virtual: true },
);

const encryptEnvelopeMock = vi.hoisted(() =>
	vi.fn<(typeof import('../../src/services/EnvelopeService.js'))['EnvelopeService']['encrypt']>(),
);

vi.mock('@/services/EnvelopeService.js', () => ({
	EnvelopeService: {
		encrypt: encryptEnvelopeMock,
	},
}));

let EnvironmentKeyService: EnvironmentKeyServiceCtor;

beforeAll(async () => {
	({ EnvironmentKeyService } = await import(
		'../../src/environment/keys/EnvironmentKeyService.js'
	));
});

beforeEach(() => {
	keytarMock.getPassword.mockReset();
	keytarMock.setPassword.mockReset();
	decryptOnThisDeviceMock.mockReset();
	randomBytesMock.mockClear();
	edSignMock.mockClear();
	encryptEnvelopeMock.mockClear();
	loadKeytarMock.mockClear();
});

describe('EnvironmentKeyService.ensureEnvironmentKey', () => {
	const identity = { deviceId: 'device-123' } as DeviceIdentity;
	const client = {
		getEnvironmentKey: vi.fn<GhostableClientCtor['prototype']['getEnvironmentKey']>(),
	} as unknown as GhostableClientCtor['prototype'];

	beforeEach(() => {
		client.getEnvironmentKey.mockReset();
	});

	it('marks cached keys as newly created when the server has no KEK', async () => {
		const storedKey = {
			keyB64: Buffer.from([1, 2, 3, 4]).toString('base64'),
			version: 7,
			fingerprint: 'cached-fingerprint',
		};
		keytarMock.getPassword.mockResolvedValue(JSON.stringify(storedKey));
		keytarMock.setPassword.mockResolvedValue();
		client.getEnvironmentKey.mockResolvedValue(null);

		const service = await EnvironmentKeyService.create();
		const result = await service.ensureEnvironmentKey({
			client: client as unknown as GhostableClientCtor['prototype'],
			projectId: 'proj-1',
			envName: 'production',
			identity,
		});

		expect(result.created).toBe(true);
		expect(result.version).toBe(7);
		expect(result.fingerprint).toBe('cached-fingerprint');
		expect(Buffer.from(result.key).toString('base64')).toBe(storedKey.keyB64);
		expect(client.getEnvironmentKey).toHaveBeenCalledWith('proj-1', 'production');

		expect(keytarMock.setPassword).toHaveBeenCalledTimes(1);
		const [serviceName, account, payload] = keytarMock.setPassword.mock.calls[0];
		expect(serviceName).toBe(KEYCHAIN_SERVICE_ENVIRONMENT);
		expect(account).toBe('proj-1:production');
		expect(JSON.parse(payload)).toEqual(storedKey);
	});

	it('refreshes the local cache when the remote KEK changes', async () => {
		const cached = {
			keyB64: Buffer.from([9, 9, 9]).toString('base64'),
			version: 1,
			fingerprint: 'stale-fingerprint',
		};
		keytarMock.getPassword.mockResolvedValue(JSON.stringify(cached));
		keytarMock.setPassword.mockResolvedValue();

		const dek = Uint8Array.from({ length: 32 }, (_, index) => (index + 1) % 256);
		const nextKey = new Uint8Array([5, 6, 7]);
		const nonce = new Uint8Array(24).fill(1);
		const cipher = new XChaCha20Poly1305(dek);
		const ciphertext = cipher.seal(nonce, nextKey);

		const edekEnvelope: EncryptedEnvelope = {
			id: 'recipient-env',
			version: 'v1',
			alg: 'XChaCha20-Poly1305+HKDF-SHA256',
			toDevicePublicKey: 'recipient',
			fromEphemeralPublicKey: 'ephemeral',
			nonceB64: 'recipient-nonce',
			ciphertextB64: 'recipient-ciphertext',
			createdAtIso: '2024-01-01T00:00:00.000Z',
		};

		const remote: EnvironmentKey = {
			id: 'key-1',
			version: 3,
			fingerprint: 'remote-fingerprint',
			createdAtIso: null,
			rotatedAtIso: null,
			createdByDeviceId: 'device-999',
			envelope: {
				id: 'env-1',
				ciphertextB64: Buffer.from(ciphertext).toString('base64'),
				nonceB64: Buffer.from(nonce).toString('base64'),
				alg: 'xchacha20-poly1305',
				createdAtIso: '2024-01-02T00:00:00.000Z',
				updatedAtIso: null,
				revokedAtIso: null,
				recipients: [
					{
						type: 'device',
						id: identity.deviceId,
						edekB64: Buffer.from(
							JSON.stringify(encryptedEnvelopeToJSON(edekEnvelope)),
						).toString('base64'),
						seenAtIso: null,
					},
				],
			},
		};

		client.getEnvironmentKey.mockResolvedValue(remote);
		decryptOnThisDeviceMock.mockResolvedValue(dek);

		const service = await EnvironmentKeyService.create();
		const result = await service.ensureEnvironmentKey({
			client: client as unknown as GhostableClientCtor['prototype'],
			projectId: 'proj-9',
			envName: 'staging',
			identity,
		});

		expect(result.created).toBe(false);
		expect(result.version).toBe(3);
		expect(result.fingerprint).toBe('remote-fingerprint');
		expect(Buffer.from(result.key).toString('base64')).toBe(
			Buffer.from(nextKey).toString('base64'),
		);

		expect(decryptOnThisDeviceMock).toHaveBeenCalledTimes(1);
		const [edekArg, deviceIdArg] = decryptOnThisDeviceMock.mock.calls[0];
		expect(deviceIdArg).toBe(identity.deviceId);
		expect(edekArg).toEqual(edekEnvelope);

		expect(keytarMock.setPassword).toHaveBeenCalledTimes(1);
		const [, account, payload] = keytarMock.setPassword.mock.calls[0];
		expect(account).toBe('proj-9:staging');
		expect(JSON.parse(payload)).toEqual({
			keyB64: Buffer.from(nextKey).toString('base64'),
			version: 3,
			fingerprint: 'remote-fingerprint',
		});
	});
});

describe('EnvironmentKeyService.publishKeyEnvelopes', () => {
	const identity: DeviceIdentity = {
		deviceId: 'device-signer',
		createdAtIso: '2024-01-01T00:00:00.000Z',
		signingKey: {
			alg: 'Ed25519',
			publicKey: 'signer-public',
			privateKey: Buffer.from('signing-private-key').toString('base64'),
		},
		encryptionKey: {
			alg: 'X25519',
			publicKey: 'encrypt-public',
			privateKey: Buffer.from('encrypt-private-key').toString('base64'),
		},
	};

	const encryptedEnvelope: EncryptedEnvelope = {
		id: 'env-enc',
		version: 'v1',
		alg: 'XChaCha20-Poly1305+HKDF-SHA256',
		toDevicePublicKey: 'recipient-public',
		fromEphemeralPublicKey: 'ephemeral-public',
		nonceB64: 'nonce',
		ciphertextB64: 'ciphertext',
		createdAtIso: '2024-01-01T00:00:00.000Z',
	};

	beforeEach(() => {
		encryptEnvelopeMock.mockResolvedValue(encryptedEnvelope);
	});

	it('signs payloads when creating a new environment key', async () => {
		const listDevices = vi
			.fn<GhostableClientCtor['prototype']['listDevices']>()
			.mockResolvedValue([{ id: 'device-peer', publicKey: 'recipient-public' }]);
		const listDeployTokens = vi
			.fn<GhostableClientCtor['prototype']['listDeployTokens']>()
			.mockResolvedValue([]);
		const createEnvironmentKey = vi
			.fn<GhostableClientCtor['prototype']['createEnvironmentKey']>()
			.mockResolvedValue({
				id: 'env-key',
				version: 3,
				fingerprint: 'remote-fingerprint',
				createdAtIso: null,
				rotatedAtIso: null,
				createdByDeviceId: 'other-device',
				envelope: null,
			});
		const createEnvironmentKeyEnvelope =
			vi.fn<GhostableClientCtor['prototype']['createEnvironmentKeyEnvelope']>();
		const client = {
			listDevices,
			listDeployTokens,
			createEnvironmentKey,
			createEnvironmentKeyEnvelope,
		} as unknown as GhostableClientCtor['prototype'];

		edSignMock.mockResolvedValueOnce(new Uint8Array([0xde, 0xad]));
		keytarMock.setPassword.mockResolvedValue();

		const service = await EnvironmentKeyService.create();
		await service.publishKeyEnvelopes({
			client,
			projectId: 'proj-1',
			envId: 'env-1',
			envName: 'production',
			identity,
			key: new Uint8Array([9, 9, 9, 9]),
			version: 1,
			fingerprint: 'local-fingerprint',
			created: true,
		});

		expect(createEnvironmentKey).toHaveBeenCalledTimes(1);
		const [, , payload] = createEnvironmentKey.mock.calls[0];
		expect(payload.device_id).toBe(identity.deviceId);
		expect(payload.client_sig).toBe(Buffer.from([0xde, 0xad]).toString('base64'));
		expect(payload.fingerprint).toBe('local-fingerprint');
		expect(createEnvironmentKeyEnvelope).not.toHaveBeenCalled();
	});

	it('signs payloads when rotating an existing environment key', async () => {
		const listDevices = vi
			.fn<GhostableClientCtor['prototype']['listDevices']>()
			.mockResolvedValue([{ id: 'device-peer', publicKey: 'recipient-public' }]);
		const listDeployTokens = vi
			.fn<GhostableClientCtor['prototype']['listDeployTokens']>()
			.mockResolvedValue([]);
		const createEnvironmentKey =
			vi.fn<GhostableClientCtor['prototype']['createEnvironmentKey']>();
		const createEnvironmentKeyEnvelope = vi
			.fn<GhostableClientCtor['prototype']['createEnvironmentKeyEnvelope']>()
			.mockResolvedValue();
		const client = {
			listDevices,
			listDeployTokens,
			createEnvironmentKey,
			createEnvironmentKeyEnvelope,
		} as unknown as GhostableClientCtor['prototype'];

		edSignMock.mockResolvedValueOnce(new Uint8Array([0xca, 0xfe]));
		keytarMock.setPassword.mockResolvedValue();

		const service = await EnvironmentKeyService.create();
		await service.publishKeyEnvelopes({
			client,
			projectId: 'proj-2',
			envId: 'env-2',
			envName: 'staging',
			identity,
			key: new Uint8Array([7, 7, 7]),
			version: 5,
			fingerprint: 'local-fingerprint',
			created: false,
		});

		expect(createEnvironmentKey).not.toHaveBeenCalled();
		expect(createEnvironmentKeyEnvelope).toHaveBeenCalledTimes(1);
		const [, , payload] = createEnvironmentKeyEnvelope.mock.calls[0];
		expect(payload.device_id).toBe(identity.deviceId);
		expect(payload.client_sig).toBe(Buffer.from([0xca, 0xfe]).toString('base64'));
		expect(payload.fingerprint).toBe('local-fingerprint');
	});
});
