import { describe, expect, it, vi } from 'vitest';

import * as crypto from '@/crypto';
import { buildSecretPayload } from '@/support/secret-payload.js';
import { buildEncryptedVariableContextBody } from '@/support/variable-context.js';

describe('buildSecretPayload', () => {
	it('includes encrypted change notes in signed secret payloads', async () => {
		const keyMaterial = crypto.randomBytes(32);
		const signingPrivateKey = crypto.randomBytes(32);
		const changeNote = await buildEncryptedVariableContextBody({
			orgId: 'org_123',
			projectId: 'proj_123',
			environmentName: 'production',
			variableName: 'APP_KEY',
			scope: 'change_note',
			plaintext: 'Rotated after incident review.',
			keyMaterial,
			signingPrivateKey,
		});

		const payload = await buildSecretPayload({
			org: 'org_123',
			project: 'proj_123',
			env: 'production',
			name: 'APP_KEY',
			plaintext: 'super-secret',
			keyMaterial,
			edPriv: signingPrivateKey,
			ifVersion: 7,
			changeNote,
			envKekVersion: 3,
			envKekFingerprint: 'fingerprint-1',
			meta: {
				lineBytes: 22,
				isCommented: false,
			},
		});

		expect(payload.change_note?.aad.scope).toBe('change_note');
		expect(payload.change_note?.client_sig).toBe(changeNote.client_sig);
		expect(payload.client_sig).toBeTruthy();
	});

	it('signs the same unsigned payload shape that the HTTP client posts', async () => {
		const keyMaterial = crypto.randomBytes(32);
		const signingPrivateKey = crypto.randomBytes(32);
		const capturedMessages: string[] = [];

		const signatureSpy = vi
			.spyOn(crypto, 'edSign')
			.mockImplementation(async (_privateKey, bytes) => {
				capturedMessages.push(new TextDecoder().decode(bytes));
				return new Uint8Array(64).fill(7);
			});

		try {
			const changeNote = await buildEncryptedVariableContextBody({
				orgId: 'org_123',
				projectId: 'proj_123',
				environmentName: 'production',
				variableName: 'APP_KEY',
				scope: 'change_note',
				plaintext: 'Rotated after incident review.',
				keyMaterial,
				signingPrivateKey,
			});

			const payload = await buildSecretPayload({
				org: 'org_123',
				project: 'proj_123',
				env: 'production',
				name: 'APP_KEY',
				plaintext: 'super-secret',
				keyMaterial,
				edPriv: signingPrivateKey,
				ifVersion: 7,
				changeNote,
				envKekVersion: 3,
				envKekFingerprint: 'fingerprint-1',
				meta: {
					lineBytes: 22,
					isCommented: false,
				},
			});

			const unsignedPayload = {
				...payload,
			};
			delete (unsignedPayload as { client_sig?: string }).client_sig;

			expect(capturedMessages.length).toBeGreaterThanOrEqual(2);
			expect(capturedMessages.at(-1)).toBe(JSON.stringify(unsignedPayload));
		} finally {
			signatureSpy.mockRestore();
		}
	});
});
