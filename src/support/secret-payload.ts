import { aeadEncrypt, b64, deriveKeys, edSign, hmacSHA256 } from '../crypto.js';
import type {
	AAD,
	Claims,
	SecretUploadValidators,
	SignedEnvironmentSecretUploadRequest,
} from '@/types';

export async function buildSecretPayload(opts: {
	org: string;
	project: string;
	env: string;
	name: string;
	plaintext: string;
	keyMaterial: Uint8Array;
	edPriv: Uint8Array;
	validators?: SecretUploadValidators;
	ifVersion?: number;
	envKekVersion?: number;
	envKekFingerprint?: string;
}): Promise<SignedEnvironmentSecretUploadRequest> {
	const {
		org,
		project,
		env,
		name,
		plaintext,
		keyMaterial,
		edPriv,
		validators,
		ifVersion,
		envKekVersion,
		envKekFingerprint,
	} = opts;

	const { encKey, hmacKey } = deriveKeys(keyMaterial, `${org}/${project}/${env}`);

	const aad: AAD = { org, project, env, name };
	const pt = new TextEncoder().encode(plaintext);
	const bundle = aeadEncrypt(encKey, pt, aad);

	const hmac = hmacSHA256(hmacKey, pt);
	const claims: Claims = {
		hmac,
		validators: { non_empty: plaintext.length > 0, ...(validators ?? {}) },
	};

	const body = {
		name,
		env,
		ciphertext: bundle.ciphertext,
		nonce: bundle.nonce,
		alg: bundle.alg,
		aad: bundle.aad,
		claims,
		...(ifVersion !== undefined ? { if_version: ifVersion } : {}),
		...(envKekVersion !== undefined ? { env_kek_version: envKekVersion } : {}),
		...(envKekFingerprint ? { env_kek_fingerprint: envKekFingerprint } : {}),
	};

	const bytes = new TextEncoder().encode(JSON.stringify(body));
	const sig = await edSign(edPriv, bytes);

	return {
		...body,
		client_sig: `b64:${b64(sig)}`,
	};
}
