import { XChaCha20Poly1305 } from '@stablelib/xchacha20poly1305';
import { x25519 } from '@noble/curves/ed25519.js';
import { sha256 } from '@noble/hashes/sha256';

import { EnvironmentSecretBundle } from '../../entities/environment/EnvironmentSecretBundle.js';
import { EnvironmentKeyService } from '@/environment/keys/EnvironmentKeyService.js';
import {
	DEPLOYMENT_ENVELOPE_HKDF_INFO,
	aeadDecrypt,
	deriveHKDF,
	deriveKeys,
	KeyService,
	scopeFromAAD,
} from '@/crypto';
import type { EncryptedEnvelope, AAD, DeviceIdentity } from '@/crypto';
import type { BackupEnvelope, BackupPayload } from '@/ghostable/types/backup.js';

type DecryptionSource = 'device' | 'recovery';

export type RestoreResult = {
	values: Record<string, { value: string; commented?: boolean }>;
	payload: BackupPayload;
	source: DecryptionSource;
};

function decodeRecipientEnvelope(edekB64?: string | null): EncryptedEnvelope {
	if (!edekB64 || typeof edekB64 !== 'string') {
		throw new Error('Backup recipient is missing its encrypted data key.');
	}

	const normalized = edekB64.startsWith('b64:') ? edekB64.slice(4) : edekB64;
	return EnvironmentKeyService.decodeRecipientEnvelope(normalized);
}

function requireBase64(field: string, value: unknown): string {
	if (!value || typeof value !== 'string') {
		throw new Error(`Backup envelope is missing required field: ${field}.`);
	}
	return value;
}

function decryptEnvelopeWithPrivateKey(
	envelope: EncryptedEnvelope,
	privateKey: Uint8Array,
): Uint8Array {
	const fromEphemeral = requireBase64(
		'recipient.from_ephemeral_public_key',
		envelope.fromEphemeralPublicKey,
	);
	const nonceB64 = requireBase64('recipient.nonce_b64', envelope.nonceB64);
	const ciphertextB64 = requireBase64('recipient.ciphertext_b64', envelope.ciphertextB64);

	const shared = x25519.scalarMult(
		privateKey,
		new Uint8Array(Buffer.from(fromEphemeral, 'base64')),
	);
	const key = deriveHKDF(shared, DEPLOYMENT_ENVELOPE_HKDF_INFO, undefined, 32);
	const cipher = new XChaCha20Poly1305(key);
	const nonce = new Uint8Array(Buffer.from(nonceB64, 'base64'));
	const ciphertext = new Uint8Array(Buffer.from(ciphertextB64, 'base64'));
	const aad = envelope.meta ? new TextEncoder().encode(JSON.stringify(envelope.meta)) : undefined;
	const plaintext = cipher.open(nonce, ciphertext, aad);
	if (!plaintext) {
		throw new Error('Failed to decrypt envelope.');
	}
	return plaintext;
}

async function tryDecryptWithDevice(
	envelope: EncryptedEnvelope,
	identity: DeviceIdentity,
): Promise<Uint8Array | null> {
	try {
		return await KeyService.decryptOnThisDevice(envelope, identity.deviceId);
	} catch {
		const privB64 = identity.encryptionKey?.privateKey;
		if (!privB64) return null;
		const priv = new Uint8Array(Buffer.from(privB64, 'base64'));
		return decryptEnvelopeWithPrivateKey(envelope, priv);
	}
}

async function resolveBdk(input: {
	recipients: BackupEnvelope['recipients'];
	identity?: DeviceIdentity | null;
	recoveryPrivateKey?: Uint8Array | null;
}): Promise<{ bdk: Uint8Array; source: DecryptionSource }> {
	const { recipients, identity, recoveryPrivateKey } = input;

	if (!recipients?.length) {
		throw new Error('Backup does not include any recipients.');
	}

	for (const recipient of recipients ?? []) {
		if (recipient.type === 'device' && identity && recipient.id === identity.deviceId) {
			const edek = decodeRecipientEnvelope(recipient.edekB64);
			const bdk = await tryDecryptWithDevice(edek, identity);
			if (bdk) return { bdk, source: 'device' };
		}

		if (recipient.type === 'recovery' && recoveryPrivateKey) {
			const edek = decodeRecipientEnvelope(recipient.edekB64);
			const bdk = decryptEnvelopeWithPrivateKey(edek, recoveryPrivateKey);
			return { bdk, source: 'recovery' };
		}
	}

	throw new Error('No matching private key found in backup recipients.');
}

async function resolveEnvironmentKey(input: {
	bundle: EnvironmentSecretBundle;
	identity?: DeviceIdentity | null;
	recoveryPrivateKey?: Uint8Array | null;
}): Promise<Uint8Array> {
	const envKey = input.bundle.environmentKey;
	if (!envKey?.envelope || !envKey.envelope.recipients?.length) {
		throw new Error('Backup does not include an environment key envelope.');
	}

	const envelope = envKey.envelope;
	const recipients = envelope.recipients ?? [];

	if (input.identity) {
		const match = recipients.find(
			(recipient) => recipient.type === 'device' && recipient.id === input.identity!.deviceId,
		);
		if (match) {
			const dekEnvelope = decodeRecipientEnvelope(match.edekB64);
			const dek = await tryDecryptWithDevice(dekEnvelope, input.identity);
			if (dek) return EnvironmentKeyService.decryptEnvironmentKeyCiphertext(envelope, dek);
		}
	}

	throw new Error('No matching private key found for the environment key envelope.');
}

export async function performBackupRestore(input: {
	envelope: BackupEnvelope;
	identity?: DeviceIdentity | null;
	recoveryPrivateKey?: Uint8Array | null;
}): Promise<RestoreResult> {
	const { bdk, source } = await resolveBdk({
		recipients: input.envelope.recipients,
		identity: input.identity,
		recoveryPrivateKey: input.recoveryPrivateKey,
	});

	let payloadBytes: Uint8Array | null = null;
	try {
		const nonceB64 = requireBase64('payload.nonce_b64', input.envelope.payload.nonceB64);
		const ciphertextB64 = requireBase64(
			'payload.ciphertext_b64',
			input.envelope.payload.ciphertextB64,
		);
		const aadB64 = requireBase64('payload.aad_b64', input.envelope.payload.aadB64);

		const cipher = new XChaCha20Poly1305(bdk);
		const nonce = new Uint8Array(Buffer.from(nonceB64, 'base64'));
		const ciphertext = new Uint8Array(Buffer.from(ciphertextB64, 'base64'));
		const aad = new Uint8Array(Buffer.from(aadB64, 'base64'));
		const plaintext = cipher.open(nonce, ciphertext, aad);
		if (!plaintext) throw new Error('Payload decryption failed.');
		payloadBytes = plaintext;
	} finally {
		bdk.fill(0);
	}

	if (input.envelope.integrity?.sha256B64) {
		const digest = Buffer.from(sha256(payloadBytes ?? new Uint8Array())).toString('base64');
		if (digest !== input.envelope.integrity.sha256B64) {
			throw new Error('Backup integrity check failed.');
		}
	}

	let payload: BackupPayload;
	try {
		payload = JSON.parse(Buffer.from(payloadBytes ?? []).toString('utf8')) as BackupPayload;
	} finally {
		if (payloadBytes) payloadBytes.fill(0);
	}

	if (payload.version !== 'payload.v1' || !payload.bundle) {
		throw new Error('Backup payload format is not supported.');
	}

	const bundle = EnvironmentSecretBundle.fromJSON(payload.bundle);
	const envKey = await resolveEnvironmentKey({
		bundle,
		identity: input.identity,
		recoveryPrivateKey: input.recoveryPrivateKey,
	});

	const values: Record<string, { value: string; commented?: boolean }> = {};
	for (const entry of bundle.secrets) {
		const scope: AAD = entry.aad;
		const { encKey } = deriveKeys(envKey, scopeFromAAD(scope));
		try {
			const plaintext = aeadDecrypt(encKey, {
				alg: entry.alg,
				nonce: entry.nonce,
				ciphertext: entry.ciphertext,
				aad: entry.aad,
			});
			const value = new TextDecoder().decode(plaintext);
			values[entry.name] = { value, commented: Boolean(entry.meta?.is_commented) };
		} catch {
			// skip entries we cannot decrypt
		}
	}

	envKey.fill(0);

	if (!Object.keys(values).length) {
		throw new Error('No secrets were decrypted from this backup.');
	}

	return { values, payload, source };
}
