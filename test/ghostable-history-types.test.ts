import { describe, expect, it } from 'vitest';

import { environmentHistoryFromJSON, variableHistoryFromJSON } from '@/ghostable/types/history.js';

describe('history JSON parsers', () => {
	it('hydrates encrypted change notes and meta permissions for variable history', () => {
		const response = variableHistoryFromJSON({
			data: {
				scope: 'variable',
				environment: {
					id: 'env_123',
					name: 'production',
					type: 'production',
				},
				variable: {
					name: 'APP_KEY',
					latest_version: 7,
				},
				entries: [
					{
						version: 7,
						occurred_at: '2026-03-27T14:00:00Z',
						operation: 'updated',
						commented: false,
						version_id: 'version_123',
						change_note: {
							id: 'change_123',
							created_at: '2026-03-27T14:00:00Z',
							actor: {
								type: 'user',
								id: 'user_1',
								email: 'dana@example.com',
							},
							body: {
								ciphertext: 'b64:Y2hhbmdl',
								nonce: 'b64:bm9uY2U=',
								alg: 'xchacha20-poly1305',
								aad: {
									env: 'production',
									org: 'org_123',
									project: 'proj_123',
									scope: 'change_note',
									variable: 'APP_KEY',
								},
								claims: {
									hmac: 'b64:aG1hYw==',
								},
								client_sig: 'signature',
							},
						},
					},
				],
				meta: {
					limit: 15,
					truncated: false,
					permissions: {
						view_version_change_notes: true,
					},
				},
			},
		});

		expect(response.entries[0]?.changeNote?.id).toBe('change_123');
		expect(response.entries[0]?.changeNote?.body.aad.scope).toBe('change_note');
		expect(response.meta?.permissions.viewVersionChangeNotes).toBe(true);
	});

	it('preserves metadata-only descriptions for environment history entries', () => {
		const response = environmentHistoryFromJSON({
			data: {
				scope: 'environment',
				environment: {
					id: 'env_123',
					name: 'production',
					type: 'production',
				},
				entries: [
					{
						id: 'activity_123',
						occurred_at: '2026-03-27T15:00:00Z',
						operation: 'comment_added',
						commented: false,
						variable: {
							name: 'APP_KEY',
							version: 7,
						},
						description: 'Dana commented on APP_KEY in production.',
					},
				],
			},
		});

		expect(response.entries[0]?.description).toBe('Dana commented on APP_KEY in production.');
	});
});
