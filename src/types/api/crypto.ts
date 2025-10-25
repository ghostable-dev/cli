import type { EncryptedEnvelope, OneTimePrekey, SignedPrekey } from '@/crypto';
import type {
        DevicePrekeyBundleJson,
        DeviceSignedPrekeyJson,
        DeviceOneTimePrekeyJson,
} from './device.js';

export type SignedPrekeyJson = DeviceSignedPrekeyJson;

export type OneTimePrekeyJson = DeviceOneTimePrekeyJson;

export type DevicePrekeyBundle = {
	signedPrekey: SignedPrekey | null;
	oneTimePrekeys: OneTimePrekey[];
};

export type EncryptedEnvelopeJson = {
	id: string;
	version: string;
	alg?: string;
	to_device_public_key: string;
	from_ephemeral_public_key: string;
	nonce_b64: string;
	ciphertext_b64: string;
	created_at: string;
	expires_at?: string;
	meta?: Record<string, string>;
	aad_b64?: string;
	sender_kid?: string;
	signature_b64?: string;
};

export function signedPrekeyFromJSON(json: SignedPrekeyJson): SignedPrekey {
        return {
                id: json.id,
                publicKey: json.public_key,
                signatureFromSigningKey: json.signature,
                createdAtIso: json.created_at,
                expiresAtIso: json.expires_at ?? undefined,
                fingerprint: json.fingerprint,
                revoked: false,
        };
}

export function oneTimePrekeyFromJSON(json: OneTimePrekeyJson): OneTimePrekey {
        return {
                id: json.id,
                publicKey: json.public_key,
                createdAtIso: json.created_at,
                expiresAtIso: json.expires_at ?? undefined,
                fingerprint: json.fingerprint,
                consumedAtIso: undefined,
                consumedBy: undefined,
                revoked: false,
        };
}

export function devicePrekeyBundleFromJSON(json: DevicePrekeyBundleJson): DevicePrekeyBundle {
        return {
                signedPrekey: json.signed_prekey ? signedPrekeyFromJSON(json.signed_prekey) : null,
                oneTimePrekeys: json.one_time_prekeys.map(oneTimePrekeyFromJSON),
        };
}

export function encryptedEnvelopeFromJSON(json: EncryptedEnvelopeJson): EncryptedEnvelope {
	return {
		id: json.id,
		version: json.version,
		alg: json.alg,
		toDevicePublicKey: json.to_device_public_key,
		fromEphemeralPublicKey: json.from_ephemeral_public_key,
		nonceB64: json.nonce_b64,
		ciphertextB64: json.ciphertext_b64,
		createdAtIso: json.created_at,
		expiresAtIso: json.expires_at,
		meta: json.meta,
		aadB64: json.aad_b64,
		senderKid: json.sender_kid,
		signatureB64: json.signature_b64,
	};
}

export function encryptedEnvelopeToJSON(envelope: EncryptedEnvelope): EncryptedEnvelopeJson {
	return {
		id: envelope.id,
		version: envelope.version,
		alg: envelope.alg,
		to_device_public_key: envelope.toDevicePublicKey,
		from_ephemeral_public_key: envelope.fromEphemeralPublicKey,
		nonce_b64: envelope.nonceB64,
		ciphertext_b64: envelope.ciphertextB64,
		created_at: envelope.createdAtIso,
		expires_at: envelope.expiresAtIso,
		meta: envelope.meta,
		aad_b64: envelope.aadB64,
		sender_kid: envelope.senderKid,
		signature_b64: envelope.signatureB64,
	};
}
