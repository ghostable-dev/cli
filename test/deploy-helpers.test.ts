import { describe, expect, it } from 'vitest';
import { sha256 } from '@noble/hashes/sha256';
import { XChaCha20Poly1305 } from '@stablelib/xchacha20poly1305';
import { hkdf } from '@noble/hashes/hkdf';
import { x25519 } from '@noble/curves/ed25519.js';
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';

import { decryptBundle } from '../src/support/deploy-helpers.js';
import { EnvironmentSecretBundle } from '../src/domain/EnvironmentSecretBundle.js';
import { encryptedEnvelopeToJSON } from '../src/ghostable/types/crypto.js';
import {
	KeyService,
	MemoryKeyStore,
	aeadEncrypt,
	deriveKeys,
	hmacSHA256,
	randomBytes,
	scopeFromAAD,
	DEPLOYMENT_ENVELOPE_HKDF_INFO,
} from '../src/crypto/index.js';

describe('decryptBundle', () => {
	it('decrypts secrets shared with deployment tokens using meta AAD', async () => {
		KeyService.initialize(new MemoryKeyStore());

		const sender = await KeyService.createDeviceIdentity('sender-device', 'device');
		const tokenIdentity = await KeyService.createDeviceIdentity(
			'deploy-token',
			'deployment-token',
		);

		const masterSeedB64 = tokenIdentity.encryptionKey.privateKey;

		const envKey = randomBytes(32);
		const fingerprint = Buffer.from(sha256(envKey)).toString('hex');

		const dek = randomBytes(32);
		const envNonce = randomBytes(24);
		const envCipher = new XChaCha20Poly1305(dek);
		const encryptedEnvKey = envCipher.seal(envNonce, envKey);

		const meta = {
			project_id: 'proj-123',
			environment: 'production',
			key_fingerprint: fingerprint,
		};

		const envelope = await KeyService.encryptForDevice(
			sender,
			tokenIdentity.encryptionKey.publicKey,
			dek,
			meta,
		);

		const sharedSecret = x25519.getSharedSecret(
			new Uint8Array(Buffer.from(masterSeedB64, 'base64')),
			new Uint8Array(Buffer.from(envelope.fromEphemeralPublicKey, 'base64')),
		);
		const hkdfInfo = new TextEncoder().encode(DEPLOYMENT_ENVELOPE_HKDF_INFO);
		const edekKey = hkdf(sha256, sharedSecret, undefined, hkdfInfo, 32);
		const metaBytes = Buffer.from(JSON.stringify(meta), 'utf8');
		const decryptedDek = xchacha20poly1305(
			edekKey,
			Buffer.from(envelope.nonceB64, 'base64'),
			metaBytes,
		).decrypt(Buffer.from(envelope.ciphertextB64, 'base64'));
		expect(Buffer.from(decryptedDek)).toEqual(Buffer.from(dek));

		const recoveredEnvKey = xchacha20poly1305(dek, envNonce).decrypt(encryptedEnvKey);
		expect(Buffer.from(recoveredEnvKey)).toEqual(Buffer.from(envKey));

		const edekPayloadB64 = Buffer.from(
			JSON.stringify(encryptedEnvelopeToJSON(envelope)),
			'utf8',
		).toString('base64');

		const aad = {
			org: 'org-1',
			project: 'proj-123',
			env: 'production',
			name: 'API_KEY',
		};
		const scope = scopeFromAAD(aad);
		const { encKey, hmacKey } = deriveKeys(envKey, scope);
		const plaintext = new TextEncoder().encode('super-secret');
		const cipher = aeadEncrypt(encKey, plaintext, aad);
		const hmac = hmacSHA256(hmacKey, plaintext);

		const bundle = EnvironmentSecretBundle.fromJSON({
			env: 'production',
			chain: ['production'],
			secrets: [
				{
					env: 'production',
					name: 'API_KEY',
					ciphertext: cipher.ciphertext,
					nonce: cipher.nonce,
					alg: cipher.alg,
					aad: cipher.aad,
					claims: { hmac, validators: {} },
					version: 1,
					env_kek_version: 1,
					env_kek_fingerprint: fingerprint,
				},
			],
			environment_key: {
				data: {
					type: 'environment-keys',
					id: 'env-key-id',
					attributes: {
						version: 1,
						fingerprint,
						created_at: null,
						rotated_at: null,
						created_by_device_id: sender.deviceId,
					},
					relationships: {
						envelope: {
							data: {
								type: 'encrypted-envelopes',
								id: envelope.id,
								attributes: {
									ciphertext_b64: Buffer.from(encryptedEnvKey).toString('base64'),
									nonce_b64: Buffer.from(envNonce).toString('base64'),
									alg: 'xchacha20-poly1305',
									created_at: null,
									updated_at: null,
									revoked_at: null,
									recipients: [
										{
											type: 'deployment',
											id: 'token-id',
											edek_b64: edekPayloadB64,
										},
									],
									from_ephemeral_public_key: envelope.fromEphemeralPublicKey,
								},
							},
						},
					},
				},
			},
		});
		expect(bundle.environmentKey?.envelope).toBeTruthy();
		expect(bundle.environmentKey?.envelope?.recipients).toHaveLength(1);

		const { secrets, warnings } = await decryptBundle(bundle, {
			masterSeedB64,
		});

		expect(warnings).toEqual([]);
		expect(secrets).toHaveLength(1);
		expect(secrets[0]?.value).toBe('super-secret');
	});
});
