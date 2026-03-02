import type { GhostableClient } from '@/ghostable';

import { buildVersionMapFromKeySummaries, saveEnvironmentVersionState } from './version-state.js';

export async function refreshEnvironmentVersionState(opts: {
	client: GhostableClient;
	projectId: string;
	envName: string;
	source: 'pull' | 'push' | 'state-refresh';
}): Promise<{ filePath: string; count: number }> {
	const keys = await opts.client.getEnvironmentKeys(opts.projectId, opts.envName);
	const versions = buildVersionMapFromKeySummaries(keys.data);

	return saveEnvironmentVersionState({
		projectId: opts.projectId,
		envName: opts.envName,
		versions,
		source: opts.source,
	});
}
