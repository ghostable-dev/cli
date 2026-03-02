import fs from 'node:fs';
import path from 'node:path';

import type { EnvironmentSecretBundle } from '@/entities';
import type { EnvironmentKeySummary } from '@/ghostable/types/environment.js';
import { resolveWorkDir } from '@/support/workdir.js';

export const ENV_VERSION_STATE_SCHEMA = 'ghostable.env-versions.v1';

export type EnvironmentVersionStateSource = 'pull' | 'push' | 'state-refresh';

export type EnvironmentVersionState = {
	schema: typeof ENV_VERSION_STATE_SCHEMA;
	projectId: string;
	environment: string;
	updatedAt: string;
	source: EnvironmentVersionStateSource;
	versions: Record<string, number>;
};

export function getEnvironmentVersionStatePath(projectId: string, envName: string): string {
	const projectSegment = encodeURIComponent(projectId.trim());
	const envSegment = encodeURIComponent(envName.trim());
	return path.resolve(
		resolveWorkDir(),
		'.ghostable',
		'state',
		projectSegment,
		`${envSegment}.versions.json`,
	);
}

function normalizeVersion(value: number | string | null | undefined): number | undefined {
	if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
		return Math.trunc(value);
	}

	if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
		return Number.parseInt(value.trim(), 10);
	}

	return undefined;
}

function normalizeVersions(input: unknown): Record<string, number> {
	if (!input || typeof input !== 'object') {
		return {};
	}

	const pairs = Object.entries(input as Record<string, unknown>)
		.map(
			([key, rawVersion]) =>
				[key, normalizeVersion(rawVersion as number | string | null | undefined)] as const,
		)
		.filter((entry): entry is readonly [string, number] => entry[1] !== undefined)
		.sort((a, b) => a[0].localeCompare(b[0]));

	return Object.fromEntries(pairs);
}

export function buildVersionMapFromBundle(bundle: EnvironmentSecretBundle): Record<string, number> {
	const versions: Record<string, number> = {};

	for (const secret of bundle.secrets) {
		const normalized = normalizeVersion(secret.version);
		if (normalized === undefined) {
			continue;
		}

		versions[secret.name] = normalized;
	}

	return normalizeVersions(versions);
}

export function buildVersionMapFromKeySummaries(
	summaries: EnvironmentKeySummary[],
): Record<string, number> {
	const versions: Record<string, number> = {};

	for (const summary of summaries) {
		const normalized = normalizeVersion(summary.version);
		if (normalized === undefined) {
			continue;
		}

		versions[summary.name] = normalized;
	}

	return normalizeVersions(versions);
}

export function loadEnvironmentVersionState(
	projectId: string,
	envName: string,
): EnvironmentVersionState | null {
	const filePath = getEnvironmentVersionStatePath(projectId, envName);
	if (!fs.existsSync(filePath)) {
		return null;
	}

	try {
		const raw = fs.readFileSync(filePath, 'utf8');
		const parsed = JSON.parse(raw) as Partial<EnvironmentVersionState> | null;
		if (!parsed || parsed.schema !== ENV_VERSION_STATE_SCHEMA) {
			return null;
		}

		return {
			schema: ENV_VERSION_STATE_SCHEMA,
			projectId: typeof parsed.projectId === 'string' ? parsed.projectId : projectId,
			environment: typeof parsed.environment === 'string' ? parsed.environment : envName,
			updatedAt:
				typeof parsed.updatedAt === 'string' && parsed.updatedAt.trim().length > 0
					? parsed.updatedAt
					: new Date(0).toISOString(),
			source:
				parsed.source === 'pull' ||
				parsed.source === 'push' ||
				parsed.source === 'state-refresh'
					? parsed.source
					: 'pull',
			versions: normalizeVersions(parsed.versions),
		};
	} catch {
		return null;
	}
}

export function saveEnvironmentVersionState(input: {
	projectId: string;
	envName: string;
	versions: Record<string, number>;
	source: EnvironmentVersionStateSource;
}): { filePath: string; count: number } {
	const filePath = getEnvironmentVersionStatePath(input.projectId, input.envName);
	fs.mkdirSync(path.dirname(filePath), { recursive: true });

	const versions = normalizeVersions(input.versions);
	const payload: EnvironmentVersionState = {
		schema: ENV_VERSION_STATE_SCHEMA,
		projectId: input.projectId,
		environment: input.envName,
		updatedAt: new Date().toISOString(),
		source: input.source,
		versions,
	};

	fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');

	return {
		filePath,
		count: Object.keys(versions).length,
	};
}
