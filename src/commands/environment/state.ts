import { Command } from 'commander';
import { select } from '@inquirer/prompts';

import { config } from '@/config/index.js';
import { GhostableClient } from '@/ghostable';
import { refreshEnvironmentVersionState } from '@/environment/state/refresh.js';
import { SessionService } from '@/services/SessionService.js';
import { Manifest } from '@/support/Manifest.js';
import { toErrorMessage } from '@/support/errors.js';
import { log } from '@/support/logger.js';
import { promptWithCancel } from '@/support/prompts.js';
import { ensureEnvParent } from './_shared.js';

type StateRefreshOptions = {
	env?: string;
	token?: string;
};

export async function runEnvStateRefresh(opts: StateRefreshOptions): Promise<void> {
	let projectId: string;
	let envNames: string[];
	try {
		projectId = Manifest.id();
		envNames = Manifest.environmentNames();
	} catch (error) {
		log.error(toErrorMessage(error));
		process.exit(1);
		return;
	}

	if (!envNames.length) {
		log.error('❌ No environments defined in .ghostable/ghostable.yaml.');
		process.exit(1);
		return;
	}

	let envName = opts.env?.trim();
	if (!envName) {
		envName = await promptWithCancel(() =>
			select<string>({
				message: 'Which environment state should be refreshed?',
				choices: envNames.sort().map((name) => ({ name, value: name })),
			}),
		);
	}

	let token = opts.token?.trim() || process.env.GHOSTABLE_TOKEN?.trim() || '';
	if (!token) {
		const session = await new SessionService().load();
		token = session?.accessToken ?? '';
	}

	if (!token) {
		log.error('❌ No API token. Run `ghostable login` or pass --token.');
		process.exit(1);
		return;
	}

	const client = GhostableClient.unauthenticated(config.apiBase).withToken(token);

	try {
		const result = await refreshEnvironmentVersionState({
			client,
			projectId,
			envName,
			source: 'state-refresh',
		});
		log.ok(
			`✅ Refreshed ${result.count} key version(s) for ${projectId}:${envName} (${result.filePath}).`,
		);
		log.warn(
			'⚠️ This refreshed versions only. It does not update local .env values; run `ghostable env pull --env <env>` before pushing if you need value sync.',
		);
	} catch (error) {
		log.error(`❌ Failed to refresh environment state: ${toErrorMessage(error)}`);
		process.exit(1);
	}
}

export function registerEnvStateRefreshCommand(program: Command) {
	const envParent = ensureEnvParent(program);
	const stateParent = envParent
		.command('state')
		.description('Manage local environment version state')
		.action(async () => {
			await runEnvStateRefresh({});
		});

	stateParent
		.command('refresh')
		.description('Fetch latest remote key versions and cache them locally')
		.option('--env <ENV>', 'Environment name (if omitted, select from manifest)')
		.option('--token <TOKEN>', 'API token (or stored session / GHOSTABLE_TOKEN)')
		.action(async (opts: StateRefreshOptions) => {
			await runEnvStateRefresh(opts);
		});
}
