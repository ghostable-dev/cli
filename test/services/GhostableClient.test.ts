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

describe('GhostableClient.rollbackVariable', () => {
	it('sends rollback requests via the push client and normalizes the response', async () => {
		const apiPost = vi.fn();
		const pushPost = vi.fn(async () => ({
			status: 'rolled_back',
			data: {
				variable: {
					name: 'DB_PASSWORD',
					version: 8,
					rolled_back_to_version: 3,
				},
				previous_head_version: 7,
				snapshot_id: 'snap-123',
				updated_at: '2025-01-01T00:00:00Z',
				updated_by: 'dana@example.com',
			},
		}));
		const client = new GhostableClient(
			{ post: apiPost } as unknown as HttpClient,
			{ post: pushPost } as unknown as HttpClient,
		);

		const response = await client.rollbackVariable('proj id', 'Prod Env', 'DB_PASSWORD', {
			device_id: 'device-1',
			version_id: 'version-3',
			client_sig: 'sig',
		});

		expect(apiPost).not.toHaveBeenCalled();
		expect(pushPost).toHaveBeenCalledWith(
			'/projects/proj%20id/environments/Prod%20Env/variables/DB_PASSWORD/rollback',
			expect.objectContaining({
				device_id: 'device-1',
				version_id: 'version-3',
			}),
		);
		expect(response.status).toBe('rolled_back');
		expect(response.data.variable.rolledBackToVersion).toBe(3);
		expect(response.data.snapshotId).toBe('snap-123');
		expect(response.data.updatedBy?.label).toBe('dana@example.com');
	});
});
