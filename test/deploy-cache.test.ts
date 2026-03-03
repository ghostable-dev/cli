import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { EnvironmentSecretBundle } from '@/entities';
import { HttpError } from '@/ghostable/http/errors.js';
import { fetchDeployBundleWithCache } from '@/support/deploy-cache.js';

describe('deploy cache', () => {
	const createdDirs: string[] = [];
	const previousWorkDir = process.env.GHOSTABLE_WORKDIR;

	afterEach(() => {
		for (const dir of createdDirs.splice(0)) {
			fs.rmSync(dir, { recursive: true, force: true });
		}

		if (previousWorkDir === undefined) {
			delete process.env.GHOSTABLE_WORKDIR;
		} else {
			process.env.GHOSTABLE_WORKDIR = previousWorkDir;
		}
	});

	it('writes cache on live fetch and falls back to stale cache on availability failures', async () => {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostable-deploy-cache-'));
		createdDirs.push(tempDir);
		process.env.GHOSTABLE_WORKDIR = tempDir;

		const bundle = EnvironmentSecretBundle.fromJSON({
			env: 'production',
			chain: ['production'],
			secrets: [],
		});
		const client = {
			deploy: async () => bundle,
		};

		const live = await fetchDeployBundleWithCache({
			client: client as never,
			token: 'ci-token-1',
			allowStaleCache: false,
		});

		expect(live.source).toBe('live');
		expect(fs.existsSync(live.cachePath)).toBe(true);

		const unavailableClient = {
			deploy: async () => {
				throw new HttpError(503, 'upstream unavailable');
			},
		};

		const stale = await fetchDeployBundleWithCache({
			client: unavailableClient as never,
			token: 'ci-token-1',
			allowStaleCache: true,
		});

		expect(stale.source).toBe('stale-cache');
		expect(stale.cacheAgeSeconds).toBeGreaterThanOrEqual(0);
		expect(stale.bundle.env).toBe('production');
	});

	it('rejects stale fallback when cache integrity is tampered', async () => {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostable-deploy-cache-'));
		createdDirs.push(tempDir);
		process.env.GHOSTABLE_WORKDIR = tempDir;

		const bundle = EnvironmentSecretBundle.fromJSON({
			env: 'production',
			chain: ['production'],
			secrets: [],
		});
		const client = {
			deploy: async () => bundle,
		};

		const live = await fetchDeployBundleWithCache({
			client: client as never,
			token: 'ci-token-2',
		});
		const parsed = JSON.parse(fs.readFileSync(live.cachePath, 'utf8')) as Record<
			string,
			unknown
		>;
		parsed['saved_at'] = new Date(Date.now() - 60_000).toISOString();
		fs.writeFileSync(live.cachePath, JSON.stringify(parsed, null, 2), 'utf8');

		const unavailableClient = {
			deploy: async () => {
				throw new HttpError(503, 'upstream unavailable');
			},
		};

		await expect(
			fetchDeployBundleWithCache({
				client: unavailableClient as never,
				token: 'ci-token-2',
				allowStaleCache: true,
			}),
		).rejects.toThrow('integrity');
	});
});
