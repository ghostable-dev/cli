export type VersionConflict = {
	key: string;
	clientIfVersion: number | null;
	serverVersion: number | null;
};

export function detectVersionConflicts(
	keys: string[],
	localVersions: Record<string, number>,
	serverVersions: Record<string, number>,
): VersionConflict[] {
	const conflicts: VersionConflict[] = [];

	for (const key of keys) {
		const clientIfVersion = localVersions[key];
		if (clientIfVersion === undefined) {
			continue;
		}

		const serverVersion = serverVersions[key];
		if (serverVersion === undefined) {
			conflicts.push({
				key,
				clientIfVersion,
				serverVersion: null,
			});
			continue;
		}

		if (serverVersion !== clientIfVersion) {
			conflicts.push({
				key,
				clientIfVersion,
				serverVersion,
			});
		}
	}

	return conflicts;
}

export function findUntrackedServerKeys(
	keys: string[],
	localVersions: Record<string, number>,
	serverVersions: Record<string, number>,
): string[] {
	return keys.filter(
		(key) => serverVersions[key] !== undefined && localVersions[key] === undefined,
	);
}
