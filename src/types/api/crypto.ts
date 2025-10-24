import type { EncryptedEnvelope, OneTimePrekey, SignedPrekey } from '@/crypto';

export type SignedPrekeyJson = {
	id: string;
	public_key: string;
	signature_from_signing_key: string;
	signer_kid?: string;
	created_at: string;
	expires_at?: string;
	revoked?: boolean;
};

export type OneTimePrekeyJson = {
	id: string;
	public_key: string;
	created_at: string;
	consumed_at?: string;
	consumed_by?: string;
	expires_at?: string;
	revoked?: boolean;
};

export type DevicePrekeyBundleJson = {
	signed_prekey: SignedPrekeyJson | null;
	one_time_prekeys: OneTimePrekeyJson[];
};

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
		signatureFromSigningKey: json.signature_from_signing_key,
		signerKid: json.signer_kid,
		createdAtIso: json.created_at,
		expiresAtIso: json.expires_at,
		revoked: json.revoked ?? false,
	};
}

export function signedPrekeyToJSON(prekey: SignedPrekey): SignedPrekeyJson {
	return {
		id: prekey.id,
		public_key: prekey.publicKey,
		signature_from_signing_key: prekey.signatureFromSigningKey,
		signer_kid: prekey.signerKid,
		created_at: prekey.createdAtIso,
		expires_at: prekey.expiresAtIso,
		revoked: prekey.revoked,
	};
}

export function oneTimePrekeyFromJSON(json: OneTimePrekeyJson): OneTimePrekey {
	return {
		id: json.id,
		publicKey: json.public_key,
		createdAtIso: json.created_at,
		consumedAtIso: json.consumed_at,
		consumedBy: json.consumed_by,
		expiresAtIso: json.expires_at,
		revoked: json.revoked,
	};
}

export function oneTimePrekeyToJSON(prekey: OneTimePrekey): OneTimePrekeyJson {
	return {
		id: prekey.id,
		public_key: prekey.publicKey,
		created_at: prekey.createdAtIso,
		consumed_at: prekey.consumedAtIso,
		consumed_by: prekey.consumedBy,
		expires_at: prekey.expiresAtIso,
		revoked: prekey.revoked,
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
