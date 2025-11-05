import * as ed25519 from '@noble/ed25519';
import * as x25519 from '@stablelib/x25519';
import { randomBytes } from '@stablelib/random';
import { XChaCha20Poly1305 } from '@stablelib/xchacha20poly1305';
import { sha256 } from '@noble/hashes/sha256';
import { v4 as uuid } from 'uuid';
import { toBase64, fromBase64 } from './utils.js';
import { deriveHKDF } from './derive/hkdf.js';
import { KeyStore } from './types/KeyStore.js';
import { DEPLOYMENT_ENVELOPE_HKDF_INFO } from '../constants/crypto.js';

import { DeviceIdentity } from './types/DeviceIdentity.js';
import { EncryptedEnvelope } from './types/EncryptedEnvelope.js';

export class KeyService {
	private static keyStore: KeyStore;

	/** Initializes the KeyService with a KeyStore implementation. */
	static initialize(keyStore: KeyStore) {
		this.keyStore = keyStore;
	}

	/** Generates a SHA-256 thumbprint (hex) of a public key. */
	private static thumbprint(publicKeyB64: string): string {
		const pub = fromBase64(publicKeyB64);
		const hash = sha256(pub);
		return Buffer.from(hash).toString('hex');
	}

	/** Generates the device’s long-term identity (Ed25519 for signing, X25519 for encryption). */
	public static async createDeviceIdentity(
		name?: string,
		platform?: string,
	): Promise<DeviceIdentity> {
		const signingPrivate = ed25519.utils.randomPrivateKey();
		const signingPublic = await ed25519.getPublicKey(signingPrivate);
		const encryptionKeypair = x25519.generateKeyPair();
		const deviceId = uuid();

		const identity: DeviceIdentity = {
			deviceId,
			name,
			platform,
			createdAtIso: new Date().toISOString(),
			version: 1,
			signingKey: {
				alg: 'Ed25519',
				publicKey: toBase64(signingPublic),
				privateKey: toBase64(signingPrivate),
			},
			encryptionKey: {
				alg: 'X25519',
				publicKey: toBase64(encryptionKeypair.publicKey),
				privateKey: toBase64(encryptionKeypair.secretKey),
			},
		};

		// Store private keys securely
		await this.keyStore.setKey(`device:${deviceId}:signingKey`, signingPrivate);
		await this.keyStore.setKey(`device:${deviceId}:encryptionKey`, encryptionKeypair.secretKey);
		return identity;
	}

	/** Encrypts data for a recipient device using XChaCha20-Poly1305. */
	public static async encryptForDevice(
		senderIdentity: DeviceIdentity,
		recipientPubB64: string,
		bytes: Uint8Array,
		meta?: Record<string, string>,
	): Promise<EncryptedEnvelope> {
		const ephemeralKeypair = x25519.generateKeyPair();
		const hasSenderKey = await this.keyStore.getKey(
			`device:${senderIdentity.deviceId}:encryptionKey`,
		);
		if (!hasSenderKey) throw new Error('Sender encryption key not found');
		const sharedSecret = this.deriveSharedSecret(
			ephemeralKeypair.secretKey,
			fromBase64(recipientPubB64),
		);
		const nonce = randomBytes(24);
		const cipher = new XChaCha20Poly1305(sharedSecret);
		const ciphertext = cipher.seal(
			nonce,
			bytes,
			meta ? Buffer.from(JSON.stringify(meta)) : undefined,
		);

		const envelope: EncryptedEnvelope = {
			id: uuid(),
			version: 'v1',
			alg: 'XChaCha20-Poly1305+HKDF-SHA256',
			toDevicePublicKey: recipientPubB64,
			fromEphemeralPublicKey: toBase64(ephemeralKeypair.publicKey),
			nonceB64: toBase64(nonce),
			ciphertextB64: toBase64(ciphertext),
			createdAtIso: new Date().toISOString(),
			meta,
			senderKid: this.thumbprint(senderIdentity.signingKey.publicKey),
		};

		// Sign the canonical fields of the envelope
		const privSign = await this.keyStore.getKey(`device:${senderIdentity.deviceId}:signingKey`);
		if (!privSign) throw new Error('Sender signing key not found');
		const canonical = [
			envelope.id,
			envelope.version,
			envelope.toDevicePublicKey,
			envelope.fromEphemeralPublicKey,
			envelope.nonceB64,
			envelope.ciphertextB64,
			envelope.createdAtIso,
			envelope.meta ? JSON.stringify(envelope.meta) : '',
		].join(':');
		envelope.signatureB64 = toBase64(await ed25519.sign(Buffer.from(canonical), privSign));

		return envelope;
	}

	/** Decrypts an envelope addressed to this device. */
	public static async decryptOnThisDevice(
		envelope: EncryptedEnvelope,
		deviceId: string,
	): Promise<Uint8Array> {
		const privKey = await this.keyStore.getKey(`device:${deviceId}:encryptionKey`);
		if (!privKey) throw new Error('Encryption key not found');
		const nonce = fromBase64(envelope.nonceB64);
		const ciphertext = fromBase64(envelope.ciphertextB64);
		const sharedSecret = this.deriveSharedSecret(
			privKey,
			fromBase64(envelope.fromEphemeralPublicKey),
		);
		const cipher = new XChaCha20Poly1305(sharedSecret);
		const plaintext = cipher.open(
			nonce,
			ciphertext,
			envelope.meta ? Buffer.from(JSON.stringify(envelope.meta)) : undefined,
		);
		if (!plaintext) {
			throw new Error('Decryption failed: invalid nonce, ciphertext, or associated data');
		}
		return plaintext;
	}

	/** Derives a shared secret using X25519 ECDH and HKDF-SHA256. */
	private static deriveSharedSecret(
		myPrivateKey: Uint8Array,
		theirPublicKey: Uint8Array,
	): Uint8Array {
		const shared = x25519.sharedKey(myPrivateKey, theirPublicKey);
		return deriveHKDF(shared, DEPLOYMENT_ENVELOPE_HKDF_INFO, undefined, 32);
	}

	/** Verifies the signature of an envelope using the sender’s public key. */
	public static async verifyEnvelopeSignature(
		envelope: EncryptedEnvelope,
		senderPublicKeyB64: string,
	): Promise<boolean> {
		if (!envelope.signatureB64) return false;
		const canonical = [
			envelope.id,
			envelope.version,
			envelope.toDevicePublicKey,
			envelope.fromEphemeralPublicKey,
			envelope.nonceB64,
			envelope.ciphertextB64,
			envelope.createdAtIso,
			envelope.meta ? JSON.stringify(envelope.meta) : '',
		].join(':');
		return ed25519.verify(
			fromBase64(envelope.signatureB64),
			Buffer.from(canonical),
			fromBase64(senderPublicKeyB64),
		);
	}
}
