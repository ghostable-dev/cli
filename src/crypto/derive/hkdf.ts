import { hkdf } from '@noble/hashes/hkdf';
import { sha256 } from '@noble/hashes/sha256';
import { toBase64 } from '../utils.js';

const enc = new TextEncoder();

/** Converts a string to UTF-8 bytes for HKDF info or AAD. */
function toBytes(s: string): Uint8Array {
	return enc.encode(s);
}

/**
 * Derives a fixed-length key from input keying material using HKDF-SHA256.
 * - `root`: Secret input keying material (e.g., master seed or parent KEK).
 * - `info`: Context string or bytes for domain separation.
 * - `salt`: Optional; defaults to a 32-byte zero-filled salt per RFC 5869.
 * - `length`: Output key length in bytes (default 32).
 * Returns a Uint8Array of the requested length.
 * Throws if inputs are invalid.
 */
export function deriveHKDF(
	root: Uint8Array,
	info: string | Uint8Array,
	salt?: Uint8Array,
	length = 32,
): Uint8Array {
	if (!(root instanceof Uint8Array)) {
		throw new TypeError('root must be a Uint8Array');
	}
	if (typeof info === 'string' && info.length === 0) {
		throw new TypeError('info string must not be empty');
	}
	if (length <= 0 || length > 255 * 32) {
		throw new RangeError('length must be positive and less than 8160 bytes');
	}

	const rSalt = salt ?? new Uint8Array(32); // RFC 5869: zero-filled salt if not provided
	const infoBytes = info instanceof Uint8Array ? info : toBytes(info);
	return hkdf(sha256, root, rSalt, infoBytes, length);
}

/** Versioned KDF context for domain separation and future-proofing. */
const KDF_VERSION = 'ghostable:v1';

/** Derives an organization KEK from a master seed. */
export function deriveOrgKEK(masterSeed: Uint8Array, orgId: string): Uint8Array {
	if (!orgId) throw new TypeError('orgId must not be empty');
	return deriveHKDF(masterSeed, `${KDF_VERSION}:org:${orgId}:kek`);
}

/** Derives a project KEK from an organization KEK. */
export function deriveProjKEK(orgKEK: Uint8Array, projectId: string): Uint8Array {
	if (!projectId) throw new TypeError('projectId must not be empty');
	return deriveHKDF(orgKEK, `${KDF_VERSION}:proj:${projectId}:kek`);
}

/** Derives an environment KEK from a project KEK. */
export function deriveEnvKEK(projKEK: Uint8Array, envName: string): Uint8Array {
	if (!envName) throw new TypeError('envName must not be empty');
	return deriveHKDF(projKEK, `${KDF_VERSION}:env:${envName}:kek`);
}

/** Derives a variable DEK from an environment KEK. */
export function deriveVarDEK(envKEK: Uint8Array, varName: string, version = 1): Uint8Array {
	if (!varName) throw new TypeError('varName must not be empty');
	if (version < 1) throw new TypeError('version must be positive');
	return deriveHKDF(envKEK, `${KDF_VERSION}:var:${varName}:v${version}`);
}

/** Returns the organization KEK in Base64 for use in envelopes or storage. */
export function deriveOrgKEK_B64(masterSeed: Uint8Array, orgId: string): string {
	return toBase64(deriveOrgKEK(masterSeed, orgId));
}

/** Returns the project KEK in Base64 for use in envelopes or storage. */
export function deriveProjKEK_B64(orgKEK: Uint8Array, projectId: string): string {
	return toBase64(deriveProjKEK(orgKEK, projectId));
}

/** Returns the environment KEK in Base64 for use in envelopes or storage. */
export function deriveEnvKEK_B64(projKEK: Uint8Array, envName: string): string {
	return toBase64(deriveEnvKEK(projKEK, envName));
}

/** Returns the variable DEK in Base64 for use in envelopes or storage. */
export function deriveVarDEK_B64(envKEK: Uint8Array, varName: string, version = 1): string {
	return toBase64(deriveVarDEK(envKEK, varName, version));
}
