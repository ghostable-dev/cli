import { Manifest } from './Manifest.js';

export const DEFAULT_IGNORES = [
        'GHOSTABLE_TOKEN',
        'APP_DEBUG',
        'LOCAL_DB_URL',
        'NODE_ENV',
];

export function getIgnoredKeys(): string[] {
        const manifest = Manifest.data();
        const fromManifest =
                manifest?.ghostable?.ignore && Array.isArray(manifest.ghostable.ignore)
                        ? (manifest.ghostable.ignore as string[])
                        : [];
        return Array.from(new Set([...DEFAULT_IGNORES, ...fromManifest]));
}

export function filterIgnoredKeys<T extends Record<string, any>>(
        obj: T,
        ignored: string[],
        only?: string[],
): T {
        const ignoreSet = new Set(ignored);
        const onlySet = new Set(only ?? []);
        return Object.fromEntries(
                Object.entries(obj).filter(([k]) => (onlySet.size > 0 ? onlySet.has(k) : !ignoreSet.has(k))),
        ) as T;
}
