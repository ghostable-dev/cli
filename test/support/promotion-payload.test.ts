import { describe, expect, it } from 'vitest';

import { buildPromotionPayloadSigningJSON } from '@/support/promotion-payload.js';

describe('buildPromotionPayloadSigningJSON', () => {
	it('omits client_sig from payload signing JSON', () => {
		const payload = {
			name: 'APP_URL',
			env: 'production',
			ciphertext: 'ciphertext',
			nonce: 'nonce',
			alg: 'xchacha20-poly1305',
			aad: {
				org: 'org_123',
				project: 'proj_123',
				env: 'production',
				name: 'APP_URL',
			},
			claims: { hmac: 'hmac' },
			if_version: 3,
			client_sig: 'signature',
		};

		const signingJSON = buildPromotionPayloadSigningJSON(payload);
		const parsed = JSON.parse(signingJSON) as Record<string, unknown>;

		expect(parsed.client_sig).toBeUndefined();
		expect(parsed.name).toBe('APP_URL');
		expect(parsed.if_version).toBe(3);
	});
});
