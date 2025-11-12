import { beforeAll, describe, expect, it, vi } from 'vitest';

import type { HttpClient } from '../../src/ghostable/http/HttpClient.js';

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

const makeClientWithPost = (post: ReturnType<typeof vi.fn>) =>
	new GhostableClient({ post } as unknown as HttpClient, { post } as unknown as HttpClient);

const makeClientWithGet = (get: ReturnType<typeof vi.fn>) =>
	new GhostableClient({ get } as unknown as HttpClient, {} as unknown as HttpClient);

describe('GhostableClient.startBrowserRegistration', () => {
	it('uses login_url when provided', async () => {
		const post = vi.fn(async () => ({
			ticket: 'ticket-1',
			login_url: 'https://ghostable.example/login',
			poll_interval: 10,
		}));
		const client = makeClientWithPost(post);

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
		const client = makeClientWithPost(post);

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
		const client = makeClientWithPost(post);

		await expect(client.startBrowserRegistration()).rejects.toThrow(
			'Browser registration is not available.',
		);
	});
});

describe('GhostableClient.push', () => {
	it('sends push payloads via the v2.2 client', async () => {
		const apiPost = vi.fn();
		const pushPost = vi.fn(async () => ({}));
		const client = new GhostableClient(
			{ post: apiPost } as unknown as HttpClient,
			{ post: pushPost } as unknown as HttpClient,
		);

		await client.push('proj', 'env', {
			device_id: 'device-1',
			secrets: [],
		} as unknown as Parameters<GhostableClientCtor['prototype']['push']>[2]);

		expect(apiPost).not.toHaveBeenCalled();
		expect(pushPost).toHaveBeenCalledWith(
			'/projects/proj/environments/env/push',
			expect.objectContaining({ device_id: 'device-1', secrets: [] }),
		);
	});
});

describe('GhostableClient.pull', () => {
	it('pipes device identity via query param and header', async () => {
		const get = vi.fn(async () => ({}));
		const client = makeClientWithGet(get);

		await client.pull('proj id', 'env/prod', { deviceId: 'device-1', includeMeta: false });

		expect(get).toHaveBeenCalledTimes(1);
		const call = get.mock.calls[0];
		expect(call).toBeDefined();
		if (!call) throw new Error('Expected pull to invoke HttpClient.get');
		const [path, headers] = call;
		expect(path).toContain('device_id=device-1');
		expect(headers).toMatchObject({ 'X-Device-ID': 'device-1' });
	});
});
