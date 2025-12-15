import { describe, expect, it, vi } from 'vitest';
import { XChaCha20Poly1305 } from '@stablelib/xchacha20poly1305';
import { x25519 } from '@noble/curves/ed25519.js';
import { sha256 } from '@noble/hashes/sha256';

import { performBackupRestore } from '@/commands/backup/restore-core.js';
import type { DeviceIdentity } from '@/crypto';
import {
	KeyService,
	aeadEncrypt,
	randomBytes,
	deriveHKDF,
	deriveKeys,
	scopeFromAAD,
} from '@/crypto';
import { backupEnvelopeFromJSON } from '@/ghostable/types/backup.js';
import { encryptedEnvelopeToJSON } from '@/ghostable/types/crypto.js';
import type { BackupEnvelopeJson, BackupPayloadJson } from '@/ghostable/types/backup.js';

function b64(bytes: Uint8Array): string {
	return Buffer.from(bytes).toString('base64');
}

function makeX25519Keypair() {
	const priv = randomBytes(32);
	const pub = x25519.scalarMultBase(priv);
	return { priv, pub };
}

function encryptEnvelopeForRecipient(plaintext: Uint8Array, recipientPubB64: string) {
	const recipientPub = new Uint8Array(Buffer.from(recipientPubB64, 'base64'));
	const ephPriv = randomBytes(32);
	const ephPub = x25519.scalarMultBase(ephPriv);
	const shared = x25519.scalarMult(ephPriv, recipientPub);
	const key = deriveHKDF(shared, 'ghostable:v1:envelope', undefined, 32);
	const nonce = randomBytes(24);
	const cipher = new XChaCha20Poly1305(key);
	const ciphertext = cipher.seal(nonce, plaintext);

	return {
		id: 'env-' + b64(randomBytes(4)),
		version: 'v1',
		alg: 'XChaCha20-Poly1305+HKDF-SHA256',
		toDevicePublicKey: recipientPubB64,
		fromEphemeralPublicKey: b64(ephPub),
		nonceB64: b64(nonce),
		ciphertextB64: b64(ciphertext),
		createdAtIso: new Date().toISOString(),
	};
}

function buildBackupEnvelope({ device }: { device: DeviceIdentity }) {
	const envKey = randomBytes(32);

	// Encrypt environment key with a DEK and envelope it to the device
	const dek = randomBytes(32);
	const envKeyNonce = randomBytes(24);
	const envKeyCipher = new XChaCha20Poly1305(dek);
	const envKeyCiphertext = envKeyCipher.seal(envKeyNonce, envKey);

	const edekEnvelope = encryptEnvelopeForRecipient(dek, device.encryptionKey.publicKey);
	const edekB64 = Buffer.from(JSON.stringify(encryptedEnvelopeToJSON(edekEnvelope))).toString(
		'base64',
	);

	const environmentKeyResource = {
		id: 'env-key-1',
		type: 'environment-keys',
		attributes: {
			version: 1,
			fingerprint: 'fp',
			created_at: null,
			rotated_at: null,
			created_by_device_id: device.deviceId,
		},
		relationships: {
			envelope: {
				data: {
					id: 'env-envelope',
					type: 'encrypted-envelopes',
					attributes: {
						ciphertext_b64: b64(envKeyCiphertext),
						nonce_b64: b64(envKeyNonce),
						alg: 'xchacha20-poly1305',
						recipients: [
							{
								type: 'device' as const,
								id: device.deviceId,
								edek_b64: edekB64,
							},
						],
					},
				},
			},
		},
	};

	// Encrypt a single secret using the environment key
	const scope = { org: 'org1', project: 'proj1', env: 'production', name: 'API_KEY' };
	const { encKey } = deriveKeys(envKey, scopeFromAAD(scope));
	const enc = aeadEncrypt(encKey, new TextEncoder().encode('super-secret'), scope);

	const payload: BackupPayloadJson = {
		version: 'payload.v1',
		meta: {
			backup_id: 'backup-1',
			project_id: 'proj1',
			environment_id: 'env1',
			environment: 'production',
			created_at: new Date().toISOString(),
		},
		bundle: {
			env: 'production',
			chain: ['production'],
			secrets: [
				{
					env: 'production',
					name: 'API_KEY',
					ciphertext: enc.ciphertext,
					nonce: enc.nonce,
					alg: enc.alg,
					aad: enc.aad,
				},
			],
			environment_key: {
				data: environmentKeyResource,
			},
		},
	};

	const payloadBytes = Buffer.from(JSON.stringify(payload));
	const bdk = randomBytes(32);
	const payloadNonce = randomBytes(24);
	const payloadCipher = new XChaCha20Poly1305(bdk);
	const aad = Buffer.from(
		JSON.stringify({ project_id: payload.meta.project_id, backup_id: payload.meta.backup_id }),
	);
	const payloadCiphertext = payloadCipher.seal(payloadNonce, payloadBytes, aad);

	const bdkEnvelope = encryptEnvelopeForRecipient(bdk, device.encryptionKey.publicKey);
	const bdkEdekB64 = Buffer.from(JSON.stringify(encryptedEnvelopeToJSON(bdkEnvelope))).toString(
		'base64',
	);

	const envelope: BackupEnvelopeJson = {
		version: 'backup.v1',
		backup_id: payload.meta.backup_id,
		created_at: payload.meta.created_at,
		project: { id: payload.meta.project_id, name: 'proj', slug: 'proj' },
		environment: { id: payload.meta.environment_id, name: payload.meta.environment },
		payload: {
			alg: 'xchacha20-poly1305',
			nonce_b64: b64(payloadNonce),
			ciphertext_b64: b64(payloadCiphertext),
			aad_b64: b64(aad),
		},
		recipients: [
			{
				type: 'device',
				id: device.deviceId,
				edek_b64: bdkEdekB64,
			},
		],
		integrity: {
			sha256_b64: Buffer.from(sha256(payloadBytes)).toString('base64'),
			payload_bytes: payloadBytes.length,
		},
	};

	return envelope;
}

describe('backup restore (core)', () => {
	it('restores a backup envelope offline using the device identity', async () => {
		vi.spyOn(KeyService, 'decryptOnThisDevice').mockRejectedValueOnce(
			new Error('keychain unavailable'),
		);

		const deviceKeys = makeX25519Keypair();
		const identity: DeviceIdentity = {
			deviceId: 'device-123',
			version: 1,
			createdAtIso: new Date().toISOString(),
			name: 'dev',
			platform: 'macos',
			signingKey: { alg: 'Ed25519', publicKey: 'pub', privateKey: 'priv' },
			encryptionKey: {
				alg: 'X25519',
				publicKey: b64(deviceKeys.pub),
				privateKey: b64(deviceKeys.priv),
			},
		};

		const envelope = buildBackupEnvelope({ device: identity });

		const result = await performBackupRestore({
			envelope: backupEnvelopeFromJSON(envelope),
			identity,
		});

		expect(result.source).toBe('device');
		expect(result.values.API_KEY.value).toBe('super-secret');
	});
});
