import * as ed25519 from '@noble/ed25519';
import * as x25519 from '@stablelib/x25519';
import { randomBytes } from '@stablelib/random';
import { XChaCha20Poly1305 } from '@stablelib/xchacha20poly1305';
import { sha256 } from '@noble/hashes/sha256';
import { v4 as uuid } from 'uuid';
import { toBase64, fromBase64 } from './utils.js';
import { deriveHKDF } from './derive/hkdf.js';
import { KeyStore } from './types/KeyStore.js';

import { DeviceIdentity } from './types/DeviceIdentity.js';
import { SignedPrekey } from './types/SignedPrekey.js';
import { OneTimePrekey } from './types/OneTimePrekey.js';
import { EncryptedEnvelope } from './types/EncryptedEnvelope.js';

export class KeyService {
	private static keyStore: KeyStore;
	private static readonly SIGNED_PREKEY_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

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

	/** Creates a signed prekey (X25519 keypair signed by device’s Ed25519 signing key). */
	public static async createSignedPrekey(identity: DeviceIdentity): Promise<SignedPrekey> {
		const keypair = x25519.generateKeyPair();
		const pubEnc = keypair.publicKey;
		const privSign = await this.keyStore.getKey(`device:${identity.deviceId}:signingKey`);
		if (!privSign) throw new Error('Signing key not found');
		const signature = await ed25519.sign(pubEnc, privSign);
		const id = uuid();
		const expiresAt = new Date(Date.now() + this.SIGNED_PREKEY_TTL_MS).toISOString();

		const prekey: SignedPrekey = {
			id,
			publicKey: toBase64(pubEnc),
			privateKey: toBase64(keypair.secretKey),
			signatureFromSigningKey: toBase64(signature),
			signerKid: this.thumbprint(identity.signingKey.publicKey),
			createdAtIso: new Date().toISOString(),
			expiresAtIso: expiresAt,
			revoked: false,
		};

		// Store private key
		await this.keyStore.setKey(`signedPrekey:${id}`, keypair.secretKey);
		return prekey;
	}

	/**
	 * Rotates the provided signed prekey when it has expired.
	 * Returns the active prekey along with metadata describing whether a rotation occurred.
	 */
	public static async rotateSignedPrekeyIfExpired(
		identity: DeviceIdentity,
		current: SignedPrekey | null | undefined,
		now: Date = new Date(),
	): Promise<{ active: SignedPrekey; rotated: boolean; retired?: SignedPrekey }> {
		if (!current) {
			const fresh = await this.createSignedPrekey(identity);
			return { active: fresh, rotated: true };
		}

		if (!current.expiresAtIso) {
			return { active: current, rotated: false };
		}

		const expiresAt = Date.parse(current.expiresAtIso);
		if (Number.isNaN(expiresAt) || now.getTime() < expiresAt) {
			return { active: current, rotated: false };
		}

		const retired: SignedPrekey = { ...current, revoked: true };
		const fresh = await this.createSignedPrekey(identity);
		return { active: fresh, rotated: true, retired };
	}

	/** Generates N one-time prekeys (X25519 keypairs) for single use. */
	public static async createOneTimePrekeys(count: number): Promise<OneTimePrekey[]> {
		if (count < 0) throw new TypeError('count must be non-negative');
		const keys: OneTimePrekey[] = [];
		for (let i = 0; i < count; i++) {
			const keypair = x25519.generateKeyPair();
			const id = uuid();
			const prekey: OneTimePrekey = {
				id,
				publicKey: toBase64(keypair.publicKey),
				privateKey: toBase64(keypair.secretKey),
				createdAtIso: new Date().toISOString(),
				revoked: false,
			};
			await this.keyStore.setKey(`oneTimePrekey:${id}`, keypair.secretKey);
			keys.push(prekey);
		}
		return keys;
	}

	/**
	 * Removes private key material for consumed one-time prekeys from secure storage.
	 * Returns a sanitized list that no longer exposes the private key values.
	 */
	public static async scrubConsumedOneTimePrekeys(
		prekeys: OneTimePrekey[],
	): Promise<OneTimePrekey[]> {
		const sanitized: OneTimePrekey[] = [];

		for (const prekey of prekeys) {
			if (prekey.consumedAtIso) {
				await this.keyStore.deleteKey(`oneTimePrekey:${prekey.id}`);

				// Build a sanitized copy without exposing the private key
				const rest = Object.fromEntries(
					Object.entries(prekey).filter(([key]) => key !== 'privateKey'),
				) as Omit<OneTimePrekey, 'privateKey'>;

				sanitized.push({ ...rest, privateKey: undefined });
			} else {
				sanitized.push(prekey);
			}
		}

		return sanitized;
	}

	/** Encrypts data for a recipient device using XChaCha20-Poly1305. */
	public static async encryptForDevice(
		senderIdentity: DeviceIdentity,
		recipientPubB64: string,
		bytes: Uint8Array,
		meta?: Record<string, string>,
	): Promise<EncryptedEnvelope> {
		const ephemeralKeypair = x25519.generateKeyPair();
		const privKey = await this.keyStore.getKey(
			`device:${senderIdentity.deviceId}:encryptionKey`,
		);
		if (!privKey) throw new Error('Sender encryption key not found');
		const sharedSecret = this.deriveSharedSecret(privKey, fromBase64(recipientPubB64));
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
		return deriveHKDF(shared, 'ghostable:v1:envelope', undefined, 32);
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
