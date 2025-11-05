import { beforeAll, describe, expect, it, vi } from 'vitest';

import type { HttpClient } from '../../src/ghostable/http/HttpClient.js';
import type { EncryptedEnvelope } from '../../src/crypto/index.js';
import { encryptedEnvelopeToJSON } from '../../src/ghostable/types/crypto.js';

vi.mock(
	'@/entities',
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

type GhostableClientCtor =
	(typeof import('../../src/ghostable/GhostableClient.js'))['GhostableClient'];

let GhostableClient: GhostableClientCtor;

beforeAll(async () => {
	({ GhostableClient } = await import('../../src/ghostable/GhostableClient.js'));
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

describe('GhostableClient.startBrowserRegistration', () => {
	it('uses login_url when provided', async () => {
		const post = vi.fn(async () => ({
			ticket: 'ticket-1',
			login_url: 'https://ghostable.example/login',
			poll_interval: 10,
		}));
		const client = new GhostableClient({ post } as unknown as HttpClient);

		await expect(client.startBrowserRegistration()).resolves.toEqual({
			ticket: 'ticket-1',
			loginUrl: 'https://ghostable.example/login',
			pollIntervalSeconds: 10,
			pollUrl: undefined,
			expiresAt: undefined,
		});

		expect(post).toHaveBeenCalledWith('/cli/register/start', {});
	});

	it('falls back to register_url when login_url is missing', async () => {
		const post = vi.fn(async () => ({
			ticket: 'ticket-2',
			register_url: 'https://ghostable.example/register',
			poll_url: 'https://ghostable.example/poll',
		}));
		const client = new GhostableClient({ post } as unknown as HttpClient);

		await expect(client.startBrowserRegistration()).resolves.toEqual({
			ticket: 'ticket-2',
			loginUrl: 'https://ghostable.example/register',
			pollIntervalSeconds: undefined,
			pollUrl: 'https://ghostable.example/poll',
			expiresAt: undefined,
		});

		expect(post).toHaveBeenCalledWith('/cli/register/start', {});
	});

	it('throws when no registration URL is provided', async () => {
		const post = vi.fn(async () => ({
			ticket: 'ticket-3',
		}));
		const client = new GhostableClient({ post } as unknown as HttpClient);

		await expect(client.startBrowserRegistration()).rejects.toThrow(
			'Browser registration is not available.',
		);
	});
});
