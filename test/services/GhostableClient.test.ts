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

describe('GhostableClient.currentUser', () => {
	it('loads the authenticated user profile', async () => {
		const get = vi.fn(async () => ({
			data: {
				type: 'users',
				id: 'user-1',
				attributes: {
					name: 'Dana',
					email: 'dana@example.com',
					created_at: '2026-03-27T12:00:00Z',
					updated_at: '2026-03-27T12:05:00Z',
				},
			},
		}));
		const client = makeClientWithGet(get);

		const currentUser = await client.currentUser();

		expect(get).toHaveBeenCalledWith('/user');
		expect(currentUser.id).toBe('user-1');
		expect(currentUser.email).toBe('dana@example.com');
	});
});

describe('GhostableClient.getEnvironmentKeys', () => {
	it('requests key versions for optimistic locking support', async () => {
		const get = vi.fn(async () => ({
			project_id: 'proj',
			environment: 'prod',
			count: 0,
			data: [],
		}));
		const client = new GhostableClient(
			{ get } as unknown as HttpClient,
			{} as unknown as HttpClient,
		);

		await client.getEnvironmentKeys('proj id', 'Prod Env');

		expect(get).toHaveBeenCalledTimes(1);
		expect(get).toHaveBeenCalledWith(
			'/projects/proj%20id/environments/Prod%20Env/keys?include_versions=1',
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

describe('GhostableClient variable context', () => {
	it('loads context for a variable', async () => {
		const get = vi.fn(async () => ({
			data: {
				scope: 'variable_context',
				environment: { id: 'env-1', name: 'production', type: 'production' },
				variable: { id: 'secret-1', name: 'APP_KEY', latest_version: 7 },
				note: null,
				comments: [],
				permissions: {
					edit_note: true,
					comment: true,
					view_version_change_notes: true,
				},
			},
		}));
		const client = new GhostableClient(
			{ get } as unknown as HttpClient,
			{ get } as unknown as HttpClient,
		);

		const response = await client.getVariableContext('proj id', 'Prod Env', 'APP_KEY');

		expect(get).toHaveBeenCalledWith(
			'/projects/proj%20id/environments/Prod%20Env/variables/APP_KEY/context',
		);
		expect(response.variable.latestVersion).toBe(7);
		expect(response.permissions.editNote).toBe(true);
	});

	it('updates the encrypted note payload', async () => {
		const put = vi.fn(async () => ({
			status: 'updated',
			data: { note_id: 'note-1' },
		}));
		const client = new GhostableClient(
			{ put } as unknown as HttpClient,
			{ put } as unknown as HttpClient,
		);

		const response = await client.updateVariableNote(
			'proj_123',
			'production',
			'APP_KEY',
			'device_123',
			{
				ciphertext: 'b64:ciphertext',
				nonce: 'b64:nonce',
				alg: 'xchacha20-poly1305',
				aad: {
					env: 'production',
					org: 'org_123',
					project: 'proj_123',
					scope: 'note',
					variable: 'APP_KEY',
				},
				claims: { hmac: 'b64:hmac' },
				client_sig: 'signature',
			},
		);

		expect(put).toHaveBeenCalledWith(
			'/projects/proj_123/environments/production/variables/APP_KEY/context/note',
			expect.objectContaining({
				device_id: 'device_123',
				note: expect.objectContaining({
					client_sig: 'signature',
				}),
			}),
		);
		expect(response.noteId).toBe('note-1');
	});

	it('creates a comment and appends device_id to delete requests', async () => {
		const post = vi.fn(async () => ({
			status: 'created',
			data: { comment_id: 'comment-1' },
		}));
		const del = vi.fn(async () => ({
			status: 'deleted',
		}));
		const client = new GhostableClient(
			{ post, delete: del } as unknown as HttpClient,
			{ post, delete: del } as unknown as HttpClient,
		);

		const createResponse = await client.createVariableComment(
			'proj_123',
			'production',
			'APP_KEY',
			'device_123',
			{
				ciphertext: 'b64:ciphertext',
				nonce: 'b64:nonce',
				alg: 'xchacha20-poly1305',
				aad: {
					env: 'production',
					org: 'org_123',
					project: 'proj_123',
					scope: 'comment',
					variable: 'APP_KEY',
				},
				claims: { hmac: 'b64:hmac' },
				client_sig: 'signature',
			},
		);

		const deleteResponse = await client.deleteVariableComment(
			'proj_123',
			'production',
			'APP_KEY',
			'comment_123',
			'device_123',
		);

		expect(post).toHaveBeenCalledWith(
			'/projects/proj_123/environments/production/variables/APP_KEY/context/comments',
			expect.objectContaining({
				device_id: 'device_123',
			}),
		);
		expect(del).toHaveBeenCalledWith(
			'/projects/proj_123/environments/production/variables/APP_KEY/context/comments/comment_123?device_id=device_123',
		);
		expect(createResponse.commentId).toBe('comment-1');
		expect(deleteResponse.status).toBe('deleted');
	});
});

describe('GhostableClient variable promotion requests', () => {
	it('previews promotion effects for selected keys', async () => {
		const post = vi.fn(async () => ({
			data: {
				source_environment_id: 'env-source',
				source_environment_name: 'local',
				target_environment_id: 'env-target',
				target_environment_name: 'production',
				total_entries: 2,
				can_view_target_variables: true,
				creates_count: 1,
				updates_count: 1,
				overlap_count: 1,
				overlapping_keys: ['APP_KEY'],
			},
		}));

		const client = new GhostableClient(
			{ post } as unknown as HttpClient,
			{} as unknown as HttpClient,
		);

		const preview = await client.previewVariablePromotionRequest('proj_123', 'local', {
			target_environment_id: 'env-target',
			entries: [{ name: 'APP_KEY' }, { name: 'APP_DEBUG' }],
		});

		expect(post).toHaveBeenCalledWith(
			'/projects/proj_123/environments/local/promotion-requests/preview',
			expect.objectContaining({
				target_environment_id: 'env-target',
			}),
		);
		expect(preview.total_entries).toBe(2);
		expect(preview.updates_count).toBe(1);
	});

	it('creates requests with idempotency headers and returns the created resource', async () => {
		const post = vi.fn(async () => ({
			data: {
				type: 'environment-variable-promotion-requests',
				id: 'promo_123',
				attributes: {
					organization_id: 'org_123',
					project_id: 'proj_123',
					source_environment_id: 'env_source',
					target_environment_id: 'env_target',
					status: 'pending',
					include_values: false,
					entry_count: 1,
					entries: [{ name: 'APP_KEY' }],
				},
			},
			meta: { code: 'PROMOTION_REQUIRES_APPROVAL' },
		}));

		const client = new GhostableClient(
			{ post } as unknown as HttpClient,
			{} as unknown as HttpClient,
		);

		const response = await client.createVariablePromotionRequest(
			'proj_123',
			'local',
			{
				device_id: 'device_123',
				target_environment_id: 'env_target',
				include_values: false,
				entries: [
					{
						name: 'APP_KEY',
						payload: {
							env: 'production',
							name: 'APP_KEY',
							ciphertext: 'ciphertext',
							nonce: 'nonce',
							alg: 'xchacha20-poly1305',
							aad: {
								org: 'org_123',
								project: 'proj_123',
								env: 'production',
								name: 'APP_KEY',
							},
							claims: { hmac: 'hmac' },
							client_sig: 'sig',
						},
					},
				],
			},
			{ idempotencyKey: 'idem-001' },
		);

		expect(post).toHaveBeenCalledWith(
			'/projects/proj_123/environments/local/promotion-requests',
			expect.objectContaining({
				device_id: 'device_123',
			}),
			expect.objectContaining({
				'X-Idempotency-Key': 'idem-001',
			}),
		);
		expect(response.data.id).toBe('promo_123');
	});

	it('lists and retrieves request resources', async () => {
		const get = vi
			.fn()
			.mockResolvedValueOnce({
				data: [
					{
						type: 'environment-variable-promotion-requests',
						id: 'promo_1',
						attributes: {
							organization_id: 'org_123',
							project_id: 'proj_123',
							source_environment_id: 'env_source',
							target_environment_id: 'env_target',
							status: 'pending',
							include_values: true,
							entry_count: 1,
							entries: [{ name: 'APP_KEY', has_payload: true }],
						},
					},
				],
			})
			.mockResolvedValueOnce({
				data: {
					type: 'environment-variable-promotion-requests',
					id: 'promo_1',
					attributes: {
						organization_id: 'org_123',
						project_id: 'proj_123',
						source_environment_id: 'env_source',
						target_environment_id: 'env_target',
						status: 'pending',
						include_values: true,
						entry_count: 1,
						entries: [{ name: 'APP_KEY', has_payload: true }],
					},
				},
			});

		const client = new GhostableClient(
			{ get } as unknown as HttpClient,
			{} as unknown as HttpClient,
		);

		const list = await client.listVariablePromotionRequests('proj_123', 'local', {
			status: 'pending',
		});
		const one = await client.getVariablePromotionRequest('proj_123', 'local', 'promo_1');

		expect(get).toHaveBeenNthCalledWith(
			1,
			'/projects/proj_123/environments/local/promotion-requests?status=pending',
		);
		expect(get).toHaveBeenNthCalledWith(
			2,
			'/projects/proj_123/environments/local/promotion-requests/promo_1',
		);
		expect(list[0].id).toBe('promo_1');
		expect(one.id).toBe('promo_1');
	});

	it('approves, rejects, and cancels promotion requests', async () => {
		const post = vi
			.fn()
			.mockResolvedValueOnce({
				data: {
					type: 'environment-variable-promotion-requests',
					id: 'promo_approve',
					attributes: {
						organization_id: 'org_123',
						project_id: 'proj_123',
						source_environment_id: 'env_source',
						target_environment_id: 'env_target',
						status: 'approved',
						include_values: true,
						entry_count: 1,
						entries: [{ name: 'APP_KEY' }],
					},
				},
			})
			.mockResolvedValueOnce({
				data: {
					type: 'environment-variable-promotion-requests',
					id: 'promo_reject',
					attributes: {
						organization_id: 'org_123',
						project_id: 'proj_123',
						source_environment_id: 'env_source',
						target_environment_id: 'env_target',
						status: 'rejected',
						include_values: true,
						entry_count: 1,
						entries: [{ name: 'APP_KEY' }],
					},
				},
			})
			.mockResolvedValueOnce({
				data: {
					type: 'environment-variable-promotion-requests',
					id: 'promo_cancel',
					attributes: {
						organization_id: 'org_123',
						project_id: 'proj_123',
						source_environment_id: 'env_source',
						target_environment_id: 'env_target',
						status: 'cancelled',
						include_values: true,
						entry_count: 1,
						entries: [{ name: 'APP_KEY' }],
					},
				},
			});

		const client = new GhostableClient(
			{ post } as unknown as HttpClient,
			{} as unknown as HttpClient,
		);

		const approved = await client.approveVariablePromotionRequest(
			'proj_123',
			'local',
			'promo_approve',
			{
				device_id: 'device_123',
				entries: [],
			},
		);
		const rejected = await client.rejectVariablePromotionRequest(
			'proj_123',
			'local',
			'promo_reject',
			'Not approved.',
		);
		const cancelled = await client.cancelVariablePromotionRequest(
			'proj_123',
			'local',
			'promo_cancel',
			'No longer needed.',
		);

		expect(post).toHaveBeenNthCalledWith(
			1,
			'/projects/proj_123/environments/local/promotion-requests/promo_approve/approve',
			expect.objectContaining({
				device_id: 'device_123',
			}),
		);
		expect(post).toHaveBeenNthCalledWith(
			2,
			'/projects/proj_123/environments/local/promotion-requests/promo_reject/reject',
			expect.objectContaining({
				reason: 'Not approved.',
			}),
		);
		expect(post).toHaveBeenNthCalledWith(
			3,
			'/projects/proj_123/environments/local/promotion-requests/promo_cancel/cancel',
			expect.objectContaining({
				reason: 'No longer needed.',
			}),
		);
		expect(approved.id).toBe('promo_approve');
		expect(rejected.id).toBe('promo_reject');
		expect(cancelled.id).toBe('promo_cancel');
	});

	it('approves a request without override entries by sending an empty object body', async () => {
		const post = vi.fn(async () => ({
			data: {
				type: 'environment-variable-promotion-requests',
				id: 'promo_no_override',
				attributes: {
					organization_id: 'org_123',
					project_id: 'proj_123',
					source_environment_id: 'env_source',
					target_environment_id: 'env_target',
					status: 'approved',
					include_values: true,
					entry_count: 1,
					entries: [{ name: 'APP_URL' }],
				},
			},
		}));

		const client = new GhostableClient(
			{ post } as unknown as HttpClient,
			{} as unknown as HttpClient,
		);

		const approved = await client.approveVariablePromotionRequest(
			'proj_123',
			'local',
			'promo_no_override',
		);

		expect(post).toHaveBeenCalledWith(
			'/projects/proj_123/environments/local/promotion-requests/promo_no_override/approve',
			{},
		);
		expect(approved.id).toBe('promo_no_override');
	});
});
