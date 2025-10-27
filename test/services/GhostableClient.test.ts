import { beforeAll, describe, expect, it, vi } from 'vitest';

import type { HttpClient } from '../../src/http/HttpClient.js';
import type { EncryptedEnvelope } from '../../src/crypto/index.js';
import { encryptedEnvelopeToJSON } from '../../src/types/index.js';

vi.mock(
	'@/domain',
	() => ({
		Device: { fromResource: vi.fn(), fromJSON: vi.fn() },
		Environment: { fromJSON: vi.fn() },
		EnvironmentSecretBundle: { fromJSON: vi.fn() },
		EnvironmentSuggestedName: { fromJSON: vi.fn() },
		EnvironmentType: { fromJSON: vi.fn() },
		Organization: { fromJSON: vi.fn() },
		Project: { fromJSON: vi.fn() },
	}),
	{ virtual: true },
);

vi.mock('@/types', async () => {
	const actual = await vi.importActual<typeof import('../../src/types/index.js')>(
		'../../src/types/index.js',
	);
	return actual;
});

type GhostableClientCtor =
	(typeof import('../../src/services/GhostableClient.js'))['GhostableClient'];

let GhostableClient: GhostableClientCtor;

beforeAll(async () => {
	({ GhostableClient } = await import('../../src/services/GhostableClient.js'));
});

describe('GhostableClient.sendEnvelope', () => {
	const envelope: EncryptedEnvelope = {
		id: 'env-1',
		version: 'v1',
		alg: 'XChaCha20-Poly1305+HKDF-SHA256',
		toDevicePublicKey: 'recipient-key',
		fromEphemeralPublicKey: 'ephemeral-key',
		nonceB64: 'nonce',
		ciphertextB64: 'ciphertext',
		createdAtIso: '2024-01-01T00:00:00.000Z',
	};

	it('includes sender_device_id when explicitly provided', async () => {
		const post = vi.fn(async () => ({ id: '123' }));
		const client = new GhostableClient({ post } as unknown as HttpClient);

		await client.sendEnvelope('device-42', envelope, 'sender-99');

                expect(post).toHaveBeenCalledWith('/devices/device-42/envelopes', {
			envelope: encryptedEnvelopeToJSON(envelope),
			sender_device_id: 'sender-99',
		});
	});

	it('defaults sender_device_id to the device path identifier when omitted', async () => {
		const post = vi.fn(async () => ({ id: '456' }));
		const client = new GhostableClient({ post } as unknown as HttpClient);

		await client.sendEnvelope('device-7', envelope);

                expect(post).toHaveBeenCalledWith('/devices/device-7/envelopes', {
			envelope: encryptedEnvelopeToJSON(envelope),
			sender_device_id: 'device-7',
		});
	});
});
