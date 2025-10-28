import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DeviceIdentity } from '../../src/crypto/types/DeviceIdentity.js';
import type { EnvironmentKey, EncryptedEnvelope } from '../../src/types/index.js';

type GhostableClientCtor =
        (typeof import('../../src/services/GhostableClient.js'))['GhostableClient'];

type EnvironmentKeyServiceCtor =
        (typeof import('../../src/services/EnvironmentKeyService.js'))['EnvironmentKeyService'];

const keytarMock = vi.hoisted(() => ({
        getPassword: vi.fn<[
                service: string,
                account: string,
        ], Promise<string | null>>(),
        setPassword: vi.fn<[
                service: string,
                account: string,
                password: string,
        ], Promise<void>>(),
}));

vi.mock('../../src/support/keyring.js', () => ({
        loadKeytar: vi.fn(async () => keytarMock),
}));

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
                expect(serviceName).toBe('ghostable-cli-env');
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

                const envelope: EncryptedEnvelope = {
                        id: 'env-1',
                        version: 'v1',
                        toDevicePublicKey: 'recipient',
                        fromEphemeralPublicKey: 'ephemeral',
                        nonceB64: 'nonce',
                        ciphertextB64: 'ciphertext',
                        createdAtIso: '2024-01-01T00:00:00.000Z',
                };

                const remote: EnvironmentKey = {
                        version: 3,
                        fingerprint: 'remote-fingerprint',
                        createdAtIso: null,
                        rotatedAtIso: null,
                        createdByDeviceId: 'device-999',
                        envelopes: [
                                {
                                        deviceId: identity.deviceId,
                                        envelope,
                                        expiresAtIso: null,
                                },
                        ],
                };

                client.getEnvironmentKey.mockResolvedValue(remote);
                decryptOnThisDeviceMock.mockResolvedValue(new Uint8Array([5, 6, 7]));

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
                expect(Buffer.from(result.key).toString('base64')).toBe(Buffer.from([5, 6, 7]).toString('base64'));

                expect(decryptOnThisDeviceMock).toHaveBeenCalledWith(envelope, identity.deviceId);

                expect(keytarMock.setPassword).toHaveBeenCalledTimes(1);
                const [, account, payload] = keytarMock.setPassword.mock.calls[0];
                expect(account).toBe('proj-9:staging');
                expect(JSON.parse(payload)).toEqual({
                        keyB64: Buffer.from([5, 6, 7]).toString('base64'),
                        version: 3,
                        fingerprint: 'remote-fingerprint',
                });
        });
});
