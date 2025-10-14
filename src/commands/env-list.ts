import { Command } from 'commander';
import { config } from '../config/index.js';
import { SessionService } from '../services/SessionService.js';
import { GhostableClient } from '../services/GhostableClient.js';
import { Manifest } from '../support/Manifest.js';
import { log } from '../support/logger.js';
import type { Environment } from '@/domain';

export function registerEnvListCommand(program: Command) {
	program
		.command('env:list')
		.alias('environments:list')
		.description('List the environments in the current project (from ghostable.yml).')
		.action(async () => {
			// 1) Ensure session
			const sessionSvc = new SessionService();
			const sess = await sessionSvc.load();
			if (!sess?.accessToken) {
				log.error('❌ Not authenticated. Run `ghostable login`.');
				process.exit(1);
			}

			// 2) Resolve project from manifest
			let projectId: string;
			let projectName: string;
			try {
				projectId = Manifest.id();
				projectName = Manifest.name();
			} catch {
				log.error('❌ No project selected. Run `ghostable init` first.');
				process.exit(1);
				return;
			}

			// 3) Fetch environments (domain objects)
			const client = GhostableClient.unauthenticated(config.apiBase).withToken(
				sess.accessToken,
			);
			let envs: Environment[] = [];
			try {
				envs = await client.getEnvironments(projectId);
				envs.sort((a, b) => a.name.localeCompare(b.name));
			} catch (err: unknown) {
				if (err instanceof Error) {
					log.error(`❌ Failed loading environments: ${err.message}`);
				} else {
					log.error(`❌ Failed loading environments: ${String(err)}`);
				}
				process.exit(1);
			}

			if (!envs.length) {
				log.warn(`No environments found for project ${projectName} (${projectId}).`);
				return;
			}

			// 4) Build display rows
			const rows = envs.map((e) => ({
				ID: e.id,
				Name: e.name,
				Type: e.type,
				Base: e.baseId ?? '',
			}));

			// 5) Print without index column: key by env name
			const keyed = Object.fromEntries(
				rows.map((r) => [r.Name || r.ID, { ID: r.ID, Type: r.Type, Base: r.Base }]),
			);
			console.table(keyed);
		});
}
