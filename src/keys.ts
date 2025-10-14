import keytar from 'keytar';
import { randomBytes, b64 } from './crypto.js';

const SERVICE = 'ghostable-cli'; // <— keep this in sync everywhere
const DEFAULT_PROFILE = 'default';

export type KeyBundle = {
	// master seed → derive ENC/HMAC per org/project/env via HKDF
	masterSeedB64: string; // "b64:..." or "base64:..." (we accept both)
	ed25519PrivB64: string; // "b64:..."
	ed25519PubB64: string; // "b64:..."
};

/** Accepts either "b64:..." or "base64:..." and returns bytes. */
function ub64Prefixed(s: string): Uint8Array {
	const clean = s.replace(/^b64:|^base64:/, '');
	return new Uint8Array(Buffer.from(clean, 'base64'));
}

/** Encode bytes to a "b64:..." prefixed string (canonical). */
function b64Prefixed(bytes: Uint8Array): string {
	return `b64:${b64(bytes)}`;
}

/** Persist a bundle to the OS keychain for a given profile. */
export async function saveKeys(bundle: KeyBundle, profile = DEFAULT_PROFILE): Promise<void> {
	await keytar.setPassword(SERVICE, profile, JSON.stringify(bundle));
}

/** Load the bundle for a profile, or create & persist a new one if missing. */
export async function loadOrCreateKeys(profile = DEFAULT_PROFILE): Promise<KeyBundle> {
	const existing = await keytar.getPassword(SERVICE, profile);
	if (existing) return JSON.parse(existing) as KeyBundle;

	// Generate a fresh bundle
	const masterSeed = randomBytes(32);
	const edSeed = randomBytes(32);
	const pub = await (await import('@noble/ed25519')).getPublicKey(edSeed);

	const bundle: KeyBundle = {
		masterSeedB64: b64Prefixed(masterSeed),
		ed25519PrivB64: b64Prefixed(edSeed),
		ed25519PubB64: b64Prefixed(pub),
	};
	await saveKeys(bundle, profile);
	return bundle;
}

/** Convenience getters (accept both "b64:" and "base64:" prefixes). */
export function getSeed(bundle: KeyBundle): Uint8Array {
	return ub64Prefixed(bundle.masterSeedB64);
}
export function getPriv(bundle: KeyBundle): Uint8Array {
	return ub64Prefixed(bundle.ed25519PrivB64);
}
export function getPub(bundle: KeyBundle): Uint8Array {
	return ub64Prefixed(bundle.ed25519PubB64);
}

/** Update only the master seed while preserving signing keys. */
export async function setMasterSeed(seedB64: string, profile = DEFAULT_PROFILE): Promise<void> {
	// Normalize to "b64:..." in storage
	const normalized =
		seedB64.startsWith('b64:') || seedB64.startsWith('base64:')
			? seedB64.replace(/^base64:/, 'b64:')
			: `b64:${seedB64}`;

	// Validate decodes to 32 bytes (warn only; caller can enforce stricter)
	const seedBytes = ub64Prefixed(normalized);
	if (seedBytes.length !== 32) {
		// You can throw instead if you prefer strict
		// throw new Error("Master seed must decode to 32 bytes.");
		// else: allow but continue
	}

	const bundle = await loadOrCreateKeys(profile);
	const updated: KeyBundle = { ...bundle, masterSeedB64: normalized };
	await saveKeys(updated, profile);
}
