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
	(typeof import('../../src/services/EnvironmentKeyService.js'))['EnvironmentKeyService'];

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

vi.mock(
	'@/crypto',
	() => ({
		KeyService: {
			decryptOnThisDevice: decryptOnThisDeviceMock,
		},
	}),
	{ virtual: true },
);

vi.mock('../../src/crypto.js', () => ({
	randomBytes: vi.fn(() => new Uint8Array([0x10, 0x20, 0x30, 0x40])),
}));

let EnvironmentKeyService: EnvironmentKeyServiceCtor;

beforeAll(async () => {
	({ EnvironmentKeyService } = await import('../../src/services/EnvironmentKeyService.js'));
});

beforeEach(() => {
	keytarMock.getPassword.mockReset();
	keytarMock.setPassword.mockReset();
	decryptOnThisDeviceMock.mockReset();
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
