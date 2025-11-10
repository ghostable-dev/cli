import chalk from 'chalk';
import { select } from '@inquirer/prompts';
import { Manifest } from './Manifest.js';
import { SessionService } from '../services/SessionService.js';
import { GhostableClient } from '@/ghostable';
import { config } from '../config/index.js';

import { sha256 } from '@noble/hashes/sha256';
import { hkdf } from '@noble/hashes/hkdf';
import { x25519 } from '@noble/curves/ed25519.js';
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';

import {
	initSodium,
	deriveKeys,
	aeadDecrypt,
	scopeFromAAD,
	hmacSHA256,
	deriveEnvKEK,
	deriveOrgKEK,
	deriveProjKEK,
	DEPLOYMENT_ENVELOPE_HKDF_INFO,
} from '@/crypto';
import type { AAD } from '@/crypto';
import { toErrorMessage } from './errors.js';

import { EnvironmentSecret, EnvironmentSecretBundle } from '@/entities';

type ManifestContext = {
	projectId: string;
	projectName: string;
	envName: string;
	envNames: string[];
};

type DecryptedSecret = {
	entry: EnvironmentSecret;
	value: string;
};

type DecryptionResult = {
	secrets: DecryptedSecret[];
	warnings: string[];
};

const SUPPORTED_DEPLOYMENT_ENVELOPE_ALGS = new Set([
	'xchacha20-poly1305',
	'xchacha20-poly1305+hkdf-sha256',
]);

export async function resolveManifestContext(requestedEnv?: string): Promise<ManifestContext> {
	let projectId: string;
	let projectName: string;
	let envNames: string[];

	try {
		projectId = Manifest.id();
		projectName = Manifest.name();
		envNames = Manifest.environmentNames();
	} catch (error) {
		const message = toErrorMessage(error) || 'Missing .ghostable/ghostable.yaml manifest';
		throw new Error(chalk.red(message));
	}

	if (!envNames.length) {
		throw new Error(chalk.red('❌ No environments defined in .ghostable/ghostable.yaml'));
	}

	let envName = requestedEnv?.trim();

	if (envName) {
		if (!envNames.includes(envName)) {
			throw new Error(
				chalk.red(
					`❌ Environment "${envName}" not found in .ghostable/ghostable.yaml. Available: ${envNames
						.slice()
						.sort()
						.join(', ')}`,
				),
			);
		}
	} else {
		envName = await select<string>({
			message: 'Which environment would you like to deploy?',
			choices: envNames
				.slice()
				.sort()
				.map((name) => ({ name, value: name })),
		});
	}

	return { projectId, projectName, envName, envNames };
}

type ResolveTokenOptions = {
	allowSession?: boolean;
};

export async function resolveToken(
	explicitToken?: string,
	options?: ResolveTokenOptions,
): Promise<string> {
	const allowSession = options?.allowSession ?? true;

	const token =
		explicitToken ||
		process.env.GHOSTABLE_CI_TOKEN ||
		(allowSession ? (await new SessionService().load())?.accessToken : undefined);

	if (!token) {
		throw new Error(
			chalk.red(
				'❌ No API token. Use --token or set GHOSTABLE_CI_TOKEN or run `ghostable login`.',
			),
		);
	}

	return token;
}

export function createGhostableClient(token: string, apiBase?: string): GhostableClient {
	return GhostableClient.unauthenticated(apiBase ?? config.apiBase).withToken(token);
}

/**
 * Decrypt an EnvironmentSecretBundle into plaintext values.
 * (child wins on merge is handled by the caller’s ordering/source)
 */
type DecryptOptions = {
	masterSeedB64?: string;
};

export async function decryptBundle(
	bundle: EnvironmentSecretBundle,
	options?: DecryptOptions,
): Promise<DecryptionResult> {
	await initSodium();

	const masterSeedB64 = resolveMasterSeed(options?.masterSeedB64);
	const masterSeed = Buffer.from(masterSeedB64.replace(/^b64:/, ''), 'base64');
	const masterSeedBytes = new Uint8Array(masterSeed);

	const orgKeyCache = new Map<string, Uint8Array>();
	const projKeyCache = new Map<string, Uint8Array>();
	const envKeyCache = new Map<string, { key: Uint8Array; fingerprint: string }>();
	const envelopeAttemptedScopes = new Set<string>();
	const envelopeWarningKeys = new Set<string>();

	const secrets: DecryptedSecret[] = [];
	const warnings: string[] = [];

	const decodeBase64 = (value: string): Uint8Array => {
		const normalized = value.replace(/^b64:/, '');
		return new Uint8Array(Buffer.from(normalized, 'base64'));
	};

	const fingerprintOf = (key: Uint8Array): string => {
		const digest = sha256(key);
		return Buffer.from(digest).toString('hex');
	};

	const warnOnce = (key: string, message: string) => {
		if (envelopeWarningKeys.has(key)) return;
		envelopeWarningKeys.add(key);
		warnings.push(message);
	};

	const hkdfInfo = new TextEncoder().encode(DEPLOYMENT_ENVELOPE_HKDF_INFO);

	type DeploymentRecipientPayload = {
		ciphertext_b64: string;
		nonce_b64: string;
		alg?: string | null;
		aad_b64?: string | null;
		meta?: Record<string, string> | null;
	};

	const tryEnvKeyFromEnvelope = (
		aad: AAD | undefined,
	): { key: Uint8Array; fingerprint: string } | null => {
		if (!aad) return null;
		const { org, project, env } = aad;
		if (!org || !project || !env) return null;

		const envScope = `${org}/${project}/${env}`;
		const cachedEnv = envKeyCache.get(envScope);
		if (cachedEnv) return cachedEnv;

		if (envelopeAttemptedScopes.has(envScope)) return null;
		envelopeAttemptedScopes.add(envScope);

		const envelope = bundle.environmentKey?.envelope;
		if (!envelope) return null;

		const ephemeralB64 = envelope.fromEphemeralPublicKey;
		if (!ephemeralB64) {
			warnOnce(
				'missing-ephemeral',
				'Environment key envelope is missing the ephemeral public key required to decrypt with this deployment token.',
			);
			return null;
		}

		const recipient = envelope.recipients.find((item) => item.type === 'deployment');
		if (!recipient) {
			warnOnce(
				'missing-recipient',
				'Environment key is not yet shared with this deployment token. Re-share it to enable decryption.',
			);
			return null;
		}

		let payload: DeploymentRecipientPayload;
		try {
			const raw = Buffer.from(recipient.edekB64.replace(/^b64:/, ''), 'base64').toString(
				'utf8',
			);
			payload = JSON.parse(raw) as DeploymentRecipientPayload;
		} catch (error) {
			const reason = error instanceof Error ? error.message : String(error);
			warnOnce(
				'payload-decode',
				`Failed to decode deployment token envelope payload: ${reason}.`,
			);
			return null;
		}

		if (!payload?.ciphertext_b64 || !payload?.nonce_b64) {
			warnOnce(
				'payload-missing',
				'Deployment token envelope payload is missing ciphertext or nonce.',
			);
			return null;
		}

		const alg = (payload.alg ?? envelope.alg ?? '').toLowerCase();
		if (alg && !SUPPORTED_DEPLOYMENT_ENVELOPE_ALGS.has(alg)) {
			const originalAlg = payload.alg ?? envelope.alg ?? alg;
			warnOnce(
				'payload-alg',
				`Unsupported deployment token envelope algorithm "${originalAlg}".`,
			);
			return null;
		}

		let sharedSecret: Uint8Array;
		try {
			const pubKey = decodeBase64(ephemeralB64);
			sharedSecret = x25519.getSharedSecret(masterSeedBytes, pubKey);
		} catch {
			warnOnce(
				'shared-secret',
				'Failed to derive shared secret for deployment token envelope.',
			);
			return null;
		}

		let edekKey: Uint8Array;
		try {
			edekKey = hkdf(sha256, sharedSecret, undefined, hkdfInfo, 32);
		} catch {
			warnOnce('hkdf', 'Failed to derive deployment token EDEK key.');
			return null;
		}

		const nonce = decodeBase64(payload.nonce_b64);
		const ciphertext = decodeBase64(payload.ciphertext_b64);
		const envNonce = decodeBase64(envelope.nonceB64);
		const envCiphertext = decodeBase64(envelope.ciphertextB64);
		const metaBytes =
			payload.meta && Object.keys(payload.meta).length
				? new Uint8Array(Buffer.from(JSON.stringify(payload.meta), 'utf8'))
				: undefined;
		const aadBytes = payload.aad_b64 ? decodeBase64(payload.aad_b64) : metaBytes;

		let dek: Uint8Array;
		try {
			const cipher = xchacha20poly1305(edekKey, nonce, aadBytes);
			dek = cipher.decrypt(ciphertext);
		} catch {
			warnOnce(
				'decrypt',
				'Failed to decrypt environment key for deployment token; falling back to keychain derivation.',
			);
			return null;
		}

		try {
			const envCipher = xchacha20poly1305(dek, envNonce);
			const envKey = envCipher.decrypt(envCiphertext);
			const fingerprint = fingerprintOf(envKey);
			const cached = { key: envKey, fingerprint };
			envKeyCache.set(envScope, cached);
			return cached;
		} catch {
			warnOnce(
				'env-decrypt',
				'Failed to decrypt environment key payload for deployment token.',
			);
			return null;
		}
	};

	const resolveEnvKey = (
		aad: AAD | undefined,
	): { key: Uint8Array; fingerprint: string } | null => {
		if (!aad) return null;
		const { org, project, env } = aad;
		if (!org || !project || !env) return null;

		const envScope = `${org}/${project}/${env}`;
		const cachedEnv = envKeyCache.get(envScope);
		if (cachedEnv) return cachedEnv;

		const envelopeKey = tryEnvKeyFromEnvelope(aad);
		if (envelopeKey) return envelopeKey;

		let orgKey = orgKeyCache.get(org);
		if (!orgKey) {
			orgKey = deriveOrgKEK(masterSeed, org);
			orgKeyCache.set(org, orgKey);
		}

		const projScope = `${org}/${project}`;
		let projKey = projKeyCache.get(projScope);
		if (!projKey) {
			projKey = deriveProjKEK(orgKey, project);
			projKeyCache.set(projScope, projKey);
		}

		const envKey = deriveEnvKEK(projKey, env);
		const fingerprint = fingerprintOf(envKey);
		const cached = { key: envKey, fingerprint };
		envKeyCache.set(envScope, cached);
		return cached;
	};

	// reuse encoders
	const encoder = new TextEncoder();
	const decoder = new TextDecoder();

	for (const entry of bundle.secrets) {
		const envKey = resolveEnvKey(entry.aad);
		if (!envKey) {
			warnings.push(`Missing metadata to derive key for ${entry.name}; skipping`);
			continue;
		}

		if (entry.envKekFingerprint) {
			const expectedFingerprint = entry.envKekFingerprint.toLowerCase();
			if (expectedFingerprint !== envKey.fingerprint) {
				warnings.push(
					`Environment key mismatch for ${entry.name}; expected fingerprint ${expectedFingerprint}, got ${envKey.fingerprint}. ` +
						'Re-share the environment key with this deployment token.',
				);
				continue;
			}
		}

		const scope = scopeFromAAD(entry.aad);
		const { encKey, hmacKey } = deriveKeys(envKey.key, scope);

		try {
			const plaintext = aeadDecrypt(encKey, {
				alg: entry.alg,
				nonce: entry.nonce,
				ciphertext: entry.ciphertext,
				aad: entry.aad,
			});

			const value = decoder.decode(plaintext);

			if (entry.claims?.hmac) {
				const digest = hmacSHA256(hmacKey, encoder.encode(value));
				if (digest !== entry.claims.hmac) {
					warnings.push(`HMAC mismatch for ${entry.name}; skipping`);
					continue;
				}
			}

			secrets.push({ entry, value });
		} catch {
			warnings.push(`Could not decrypt ${entry.name}; skipping`);
		}
	}

	if (!secrets.length && bundle.secrets.length) {
		warnings.push(
			'No secrets could be decrypted with the provided master seed. Ensure the deployment token has access to the latest environment key (try `ghostable deploy token create --env <ENV>` or ask an administrator to re-share the key).',
		);
	}

	return { secrets, warnings };
}

export function resolveDeployMasterSeed(): string {
	const envValue = process.env.GHOSTABLE_DEPLOY_SEED?.trim();

	if (!envValue) {
		throw new Error(
			chalk.red(
				'❌ Missing master seed. Set GHOSTABLE_DEPLOY_SEED when running this command.',
			),
		);
	}

	return normalizeSeed(envValue);
}

export type { ManifestContext, DecryptedSecret, DecryptionResult };

function resolveMasterSeed(provided?: string): string {
	if (!provided?.trim()) {
		throw new Error(
			chalk.red(
				'❌ Missing master seed. Provide --master-seed or set GHOSTABLE_DEPLOY_SEED.',
			),
		);
	}

	return normalizeSeed(provided.trim());
}

function normalizeSeed(seed: string): string {
	if (seed.startsWith('b64:') || seed.startsWith('base64:')) {
		return seed.replace(/^base64:/, 'b64:');
	}

	return `b64:${seed}`;
}
