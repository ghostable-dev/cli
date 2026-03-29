import { describe, expect, it } from 'vitest';

import { randomBytes } from '@/crypto';
import {
	buildEncryptedVariableContextBody,
	decryptVariableContextBody,
	jsonStringForVariableContextBody,
} from '@/support/variable-context.js';

describe('variable context crypto helpers', () => {
	it('round-trips encrypted note payloads', async () => {
		const keyMaterial = randomBytes(32);
		const signingPrivateKey = randomBytes(32);

		const payload = await buildEncryptedVariableContextBody({
			orgId: 'org_123',
			projectId: 'proj_123',
			environmentName: 'production',
			variableName: 'APP_KEY',
			scope: 'note',
			plaintext: 'Document the rotation window.',
			keyMaterial,
			signingPrivateKey,
		});

		expect(payload.aad.scope).toBe('note');
		expect(payload.client_sig).toBeTruthy();
		expect(decryptVariableContextBody(payload, keyMaterial)).toBe(
			'Document the rotation window.',
		);
	});

	it('uses the expected signature payload ordering for change notes', async () => {
		const keyMaterial = randomBytes(32);
		const signingPrivateKey = randomBytes(32);

		const payload = await buildEncryptedVariableContextBody({
			orgId: 'org_123',
			projectId: 'proj_123',
			environmentName: 'production',
			variableName: 'APP_KEY',
			scope: 'change_note',
			plaintext: 'Rotated after the deploy token refresh.',
			keyMaterial,
			signingPrivateKey,
		});

		const signaturePayload = jsonStringForVariableContextBody(payload, false);

		expect(signaturePayload).toContain(
			'"aad":{"env":"production","org":"org_123","project":"proj_123","scope":"change_note","variable":"APP_KEY"}',
		);
		expect(signaturePayload).not.toContain('"client_sig"');
	});
});
