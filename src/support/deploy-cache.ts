import fs from 'node:fs';
import path from 'node:path';
import { createHash, createHmac } from 'node:crypto';

import { config } from '@/config/index.js';
import { EnvironmentSecretBundle } from '@/entities';
import { HttpError } from '@/ghostable/http/errors.js';
import type { EnvironmentSecretBundleJson } from '@/ghostable/types/environment.js';
import type { GhostableClient } from '@/ghostable';
import { resolveWorkDir } from './workdir.js';

const DEPLOY_CACHE_SCHEMA = 'ghostable.deploy-cache.v1';
const DEPLOY_CACHE_TTL_SECONDS = 24 * 60 * 60;

type DeployBundleCacheDocument = {
	schema: string;
	saved_at: string;
	expires_at: string;
	cache_key: {
		api_base: string;
		token_fingerprint: string;
		only: string[];
	};
	bundle: EnvironmentSecretBundleJson;
	integrity: {
		alg: 'hmac-sha256';
		digest_b64: string;
	};
};

type DeployCacheScope = {
	apiBase: string;
	token: string;
	only: string[];
};

export type DeployCacheFetchResult = {
	bundle: EnvironmentSecretBundle;
	source: 'live' | 'stale-cache';
	cachePath: string;
	cacheAgeSeconds?: number;
	expiresAtIso?: string;
};

export type DeployCacheWarmResult = {
	cachePath: string;
	expiresAtIso: string;
	secretsCount: number;
};

type LoadDeployCacheResult = {
	bundle: EnvironmentSecretBundle;
	cachePath: string;
	cacheAgeSeconds: number;
	expiresAtIso: string;
};

type DeployCacheFetchOptions = {
	client: GhostableClient;
	token: string;
	only?: string[];
	allowStaleCache?: boolean;
	apiBase?: string;
};

type DeployCacheWarmOptions = {
	client: GhostableClient;
	token: string;
	only?: string[];
	apiBase?: string;
};

function normalizeOnly(only?: string[]): string[] {
	if (!only?.length) return [];
	return [...new Set(only.map((value) => value.trim()).filter(Boolean))].sort((a, b) =>
		a.localeCompare(b),
	);
}

function tokenFingerprint(token: string): string {
	return createHash('sha256').update(token, 'utf8').digest('hex');
}

function scopeHash(scope: DeployCacheScope): string {
	const key = stableStringify({
		api_base: scope.apiBase,
		token_fingerprint: tokenFingerprint(scope.token),
		only: scope.only,
	});
	return createHash('sha256').update(key, 'utf8').digest('hex');
}

function resolveCachePath(scope: DeployCacheScope): string {
	const workDir = resolveWorkDir();
	const fileName = `${scopeHash(scope)}.json`;
	return path.resolve(workDir, '.ghostable', 'deploy-cache', fileName);
}

function deriveIntegrityKey(token: string): Buffer {
	return createHash('sha256')
		.update('ghostable-deploy-cache:v1:', 'utf8')
		.update(token, 'utf8')
		.digest();
}

function integrityInput(doc: Omit<DeployBundleCacheDocument, 'integrity'>): string {
	return stableStringify(doc);
}

function computeIntegrityDigest(
	doc: Omit<DeployBundleCacheDocument, 'integrity'>,
	token: string,
): string {
	return createHmac('sha256', deriveIntegrityKey(token))
		.update(integrityInput(doc), 'utf8')
		.digest('base64');
}

function stableStringify(value: unknown): string {
	return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map(sortValue);
	}

	if (value && typeof value === 'object') {
		const record = value as Record<string, unknown>;
		return Object.keys(record)
			.sort((a, b) => a.localeCompare(b))
			.reduce<Record<string, unknown>>((carry, key) => {
				carry[key] = sortValue(record[key]);
				return carry;
			}, {});
	}

	return value;
}

function writeCacheDocument(
	scope: DeployCacheScope,
	bundle: EnvironmentSecretBundle,
): DeployCacheWarmResult {
	const now = new Date();
	const expiresAt = new Date(now.getTime() + DEPLOY_CACHE_TTL_SECONDS * 1000);
	const cachePath = resolveCachePath(scope);

	const plainBundle = JSON.parse(JSON.stringify(bundle)) as EnvironmentSecretBundleJson;
	const unsignedDoc: Omit<DeployBundleCacheDocument, 'integrity'> = {
		schema: DEPLOY_CACHE_SCHEMA,
		saved_at: now.toISOString(),
		expires_at: expiresAt.toISOString(),
		cache_key: {
			api_base: scope.apiBase,
			token_fingerprint: tokenFingerprint(scope.token),
			only: scope.only,
		},
		bundle: plainBundle,
	};
	const signedDoc: DeployBundleCacheDocument = {
		...unsignedDoc,
		integrity: {
			alg: 'hmac-sha256',
			digest_b64: computeIntegrityDigest(unsignedDoc, scope.token),
		},
	};

	fs.mkdirSync(path.dirname(cachePath), { recursive: true });
	fs.writeFileSync(cachePath, JSON.stringify(signedDoc, null, 2), 'utf8');

	return {
		cachePath,
		expiresAtIso: expiresAt.toISOString(),
		secretsCount: bundle.secrets.length,
	};
}

function readCacheDocument(scope: DeployCacheScope): LoadDeployCacheResult {
	const cachePath = resolveCachePath(scope);
	if (!fs.existsSync(cachePath)) {
		throw new Error('No deploy cache entry exists for this token/scope.');
	}

	let parsed: DeployBundleCacheDocument;
	try {
		const raw = fs.readFileSync(cachePath, 'utf8');
		parsed = JSON.parse(raw) as DeployBundleCacheDocument;
	} catch {
		throw new Error('Deploy cache entry is unreadable.');
	}

	if (parsed.schema !== DEPLOY_CACHE_SCHEMA) {
		throw new Error(`Unsupported deploy cache schema "${parsed.schema}".`);
	}

	const expectedFingerprint = tokenFingerprint(scope.token);
	if (parsed.cache_key.api_base !== scope.apiBase) {
		throw new Error('Deploy cache api base does not match current CLI config.');
	}
	if (parsed.cache_key.token_fingerprint !== expectedFingerprint) {
		throw new Error('Deploy cache token fingerprint does not match the current token.');
	}
	if (stableStringify(parsed.cache_key.only ?? []) !== stableStringify(scope.only)) {
		throw new Error('Deploy cache scope does not match requested keys.');
	}

	const unsignedDoc: Omit<DeployBundleCacheDocument, 'integrity'> = {
		schema: parsed.schema,
		saved_at: parsed.saved_at,
		expires_at: parsed.expires_at,
		cache_key: parsed.cache_key,
		bundle: parsed.bundle,
	};

	const expectedDigest = computeIntegrityDigest(unsignedDoc, scope.token);
	if (
		parsed.integrity?.alg !== 'hmac-sha256' ||
		parsed.integrity?.digest_b64 !== expectedDigest
	) {
		throw new Error('Deploy cache integrity verification failed.');
	}

	const savedAtMs = Date.parse(parsed.saved_at);
	const expiresAtMs = Date.parse(parsed.expires_at);
	if (!Number.isFinite(savedAtMs) || !Number.isFinite(expiresAtMs)) {
		throw new Error('Deploy cache timestamp metadata is invalid.');
	}

	const nowMs = Date.now();
	if (nowMs > expiresAtMs) {
		throw new Error('Deploy cache entry is expired.');
	}

	return {
		bundle: EnvironmentSecretBundle.fromJSON(parsed.bundle),
		cachePath,
		cacheAgeSeconds: Math.max(0, Math.floor((nowMs - savedAtMs) / 1000)),
		expiresAtIso: parsed.expires_at,
	};
}

function fallbackAllowed(error: unknown): boolean {
	if (!(error instanceof HttpError)) return true;

	if (error.status === 401 || error.status === 403) return false;

	if (error.status >= 400 && error.status < 500 && error.status !== 408 && error.status !== 429) {
		return false;
	}

	return true;
}

export function formatCacheAge(ageSeconds: number): string {
	if (ageSeconds < 60) return `${ageSeconds}s`;
	if (ageSeconds < 3600) return `${Math.floor(ageSeconds / 60)}m ${ageSeconds % 60}s`;
	const hours = Math.floor(ageSeconds / 3600);
	const mins = Math.floor((ageSeconds % 3600) / 60);
	return `${hours}h ${mins}m`;
}

export async function fetchDeployBundleWithCache(
	options: DeployCacheFetchOptions,
): Promise<DeployCacheFetchResult> {
	const scope: DeployCacheScope = {
		apiBase: options.apiBase ?? config.apiBase,
		token: options.token,
		only: normalizeOnly(options.only),
	};
	const allowStaleCache = Boolean(options.allowStaleCache);

	try {
		const bundle = await options.client.deploy({
			includeMeta: true,
			includeVersions: true,
			only: scope.only.length ? scope.only : undefined,
		});
		const warmed = writeCacheDocument(scope, bundle);

		return {
			bundle,
			source: 'live',
			cachePath: warmed.cachePath,
		};
	} catch (error) {
		if (!allowStaleCache || !fallbackAllowed(error)) {
			throw error;
		}

		return {
			...readCacheDocument(scope),
			source: 'stale-cache',
		};
	}
}

export async function warmDeployBundleCache(
	options: DeployCacheWarmOptions,
): Promise<DeployCacheWarmResult> {
	const scope: DeployCacheScope = {
		apiBase: options.apiBase ?? config.apiBase,
		token: options.token,
		only: normalizeOnly(options.only),
	};

	const bundle = await options.client.deploy({
		includeMeta: true,
		includeVersions: true,
		only: scope.only.length ? scope.only : undefined,
	});

	return writeCacheDocument(scope, bundle);
}
