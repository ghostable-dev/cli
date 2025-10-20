import { Manifest } from './Manifest.js';
import type { EnvEntry } from './Manifest.js';

export const DEFAULT_IGNORES = ['GHOSTABLE_CI_TOKEN', 'GHOSTABLE_MASTER_SEED'];

export function getIgnoredKeys(env?: string): string[] {
	const manifest = Manifest.data();

	let environmentSpecific: string[] = [];
	if (env && manifest?.environments && !Array.isArray(manifest.environments)) {
		const entry = manifest.environments[env] as EnvEntry;
		if (
			entry &&
			typeof entry === 'object' &&
			'ignore' in entry &&
			Array.isArray(entry.ignore)
		) {
			environmentSpecific = entry.ignore.filter(
				(value): value is string => typeof value === 'string',
			);
		}
	}

	return Array.from(new Set([...DEFAULT_IGNORES, ...environmentSpecific]));
}

export function filterIgnoredKeys<T extends Record<string, unknown>>(
	obj: T,
	ignored: string[],
	only?: string[],
): T {
	const ignoreSet = new Set(ignored);
	const onlySet = new Set(only ?? []);
	return Object.fromEntries(
		Object.entries(obj).filter(([k]) =>
			onlySet.size > 0 ? onlySet.has(k) : !ignoreSet.has(k),
		),
	) as T;
}
