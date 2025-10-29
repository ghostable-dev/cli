import chalk from 'chalk';
import { select } from '@inquirer/prompts';
import { Manifest } from './Manifest.js';
import { SessionService } from '../services/SessionService.js';
import { GhostableClient } from '../services/GhostableClient.js';
import { config } from '../config/index.js';

import { initSodium, deriveKeys, aeadDecrypt, scopeFromAAD, hmacSHA256 } from '../crypto.js';
import { deriveEnvKEK, deriveOrgKEK, deriveProjKEK } from '@/crypto';
import type { AAD } from '@/types';
import { loadOrCreateKeys } from '../keys.js';
import { toErrorMessage } from './errors.js';

import { EnvironmentSecret, EnvironmentSecretBundle } from '@/domain';

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

	const masterSeedB64 = await resolveMasterSeed(options?.masterSeedB64);
	const masterSeed = Buffer.from(masterSeedB64.replace(/^b64:/, ''), 'base64');

	const orgKeyCache = new Map<string, Uint8Array>();
	const projKeyCache = new Map<string, Uint8Array>();
	const envKeyCache = new Map<string, Uint8Array>();

	const resolveEnvKey = (aad: AAD | undefined): Uint8Array | null => {
		if (!aad) return null;
		const { org, project, env } = aad;
		if (!org || !project || !env) return null;

		const envScope = `${org}/${project}/${env}`;
		const cachedEnv = envKeyCache.get(envScope);
		if (cachedEnv) return cachedEnv;

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
		envKeyCache.set(envScope, envKey);
		return envKey;
	};

	const secrets: DecryptedSecret[] = [];
	const warnings: string[] = [];

	// reuse encoders
	const encoder = new TextEncoder();
	const decoder = new TextDecoder();

	for (const entry of bundle.secrets) {
		const envKey = resolveEnvKey(entry.aad);
		if (!envKey) {
			warnings.push(`Missing metadata to derive key for ${entry.name}; skipping`);
			continue;
		}

		const scope = scopeFromAAD(entry.aad);
		const { encKey, hmacKey } = deriveKeys(envKey, scope);

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

	return { secrets, warnings };
}

export function resolveDeployMasterSeed(): string {
	const envValue = process.env.GHOSTABLE_MASTER_SEED?.trim();

	if (!envValue) {
		throw new Error(
			chalk.red(
				'❌ Missing master seed. Set GHOSTABLE_MASTER_SEED when running this command.',
			),
		);
	}

	return normalizeSeed(envValue);
}

export type { ManifestContext, DecryptedSecret, DecryptionResult };

async function resolveMasterSeed(provided?: string): Promise<string> {
	if (provided && provided.trim()) {
		return normalizeSeed(provided.trim());
	}

	const { masterSeedB64 } = await loadOrCreateKeys();
	return normalizeSeed(masterSeedB64);
}

function normalizeSeed(seed: string): string {
	if (seed.startsWith('b64:') || seed.startsWith('base64:')) {
		return seed.replace(/^base64:/, 'b64:');
	}

	return `b64:${seed}`;
}
