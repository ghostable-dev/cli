import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
	buildVersionMapFromKeySummaries,
	getEnvironmentVersionStatePath,
	loadEnvironmentVersionState,
	saveEnvironmentVersionState,
} from '../src/environment/state/version-state.js';
import {
	detectVersionConflicts,
	findUntrackedServerKeys,
} from '../src/environment/state/conflicts.js';

describe('environment version state', () => {
	const tempDirs: string[] = [];
	const previousWorkdir = process.env.GHOSTABLE_WORKDIR;

	afterEach(() => {
		for (const dir of tempDirs.splice(0, tempDirs.length)) {
			fs.rmSync(dir, { recursive: true, force: true });
		}

		if (previousWorkdir === undefined) {
			delete process.env.GHOSTABLE_WORKDIR;
		} else {
			process.env.GHOSTABLE_WORKDIR = previousWorkdir;
		}
	});

	it('saves and loads environment version state', () => {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostable-state-'));
		tempDirs.push(tempDir);
		process.env.GHOSTABLE_WORKDIR = tempDir;

		const saved = saveEnvironmentVersionState({
			projectId: 'proj-123',
			envName: 'production',
			source: 'state-refresh',
			versions: {
				Z_VAR: 2,
				A_VAR: 1,
			},
		});

		expect(saved.count).toBe(2);
		expect(fs.existsSync(saved.filePath)).toBe(true);
		expect(saved.filePath).toBe(getEnvironmentVersionStatePath('proj-123', 'production'));

		const loaded = loadEnvironmentVersionState('proj-123', 'production');
		expect(loaded).not.toBeNull();
		expect(loaded?.schema).toBe('ghostable.env-versions.v1');
		expect(loaded?.source).toBe('state-refresh');
		expect(loaded?.versions).toEqual({
			A_VAR: 1,
			Z_VAR: 2,
		});
	});

	it('normalizes version maps from key summaries', () => {
		const map = buildVersionMapFromKeySummaries([
			{ name: 'APP_KEY', version: 5, updatedAt: null, updatedByEmail: null },
			{ name: 'APP_ENV', version: '7', updatedAt: null, updatedByEmail: null },
			{ name: 'APP_URL', version: 'v1', updatedAt: null, updatedByEmail: null },
		]);

		expect(map).toEqual({
			APP_ENV: 7,
			APP_KEY: 5,
		});
	});
});

describe('version conflict helpers', () => {
	it('detects stale and deleted-key conflicts', () => {
		const conflicts = detectVersionConflicts(
			['APP_KEY', 'APP_ENV', 'CACHE_DRIVER'],
			{ APP_KEY: 3, APP_ENV: 1, CACHE_DRIVER: 2 },
			{ APP_KEY: 4, APP_ENV: 1 },
		);

		expect(conflicts).toEqual([
			{ key: 'APP_KEY', clientIfVersion: 3, serverVersion: 4 },
			{ key: 'CACHE_DRIVER', clientIfVersion: 2, serverVersion: null },
		]);
	});

	it('finds keys that are remote but missing local baseline versions', () => {
		const untracked = findUntrackedServerKeys(
			['APP_KEY', 'APP_ENV', 'CACHE_DRIVER'],
			{ APP_KEY: 3 },
			{ APP_KEY: 3, APP_ENV: 7, CACHE_DRIVER: 2 },
		);

		expect(untracked).toEqual(['APP_ENV', 'CACHE_DRIVER']);
	});
});
