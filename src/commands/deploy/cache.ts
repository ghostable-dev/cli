import { Command } from 'commander';
import ora from 'ora';

import { createGhostableClient, resolveToken } from '../../support/deploy-helpers.js';
import { warmDeployBundleCache } from '../../support/deploy-cache.js';
import { log } from '../../support/logger.js';
import { toErrorMessage } from '../../support/errors.js';

type DeployCacheWarmOptions = {
	token?: string;
	only?: string[];
};

function attachDeployCacheWarmCommand(command: Command): Command {
	return command
		.command('warm')
		.description('Fetch and cache the encrypted deploy bundle for this deployment token scope')
		.option('--token <TOKEN>', 'Ghostable CI token (or env GHOSTABLE_CI_TOKEN)')
		.option('--only <KEY...>', 'Limit cached scope to specific keys')
		.action(async (opts: DeployCacheWarmOptions) => {
			let token: string;
			try {
				token = await resolveToken(opts.token, { allowSession: false });
			} catch (error) {
				log.error(toErrorMessage(error));
				process.exit(1);
				return;
			}

			const client = createGhostableClient(token);
			const spin = ora('Fetching encrypted deploy bundle for cache warm-up…').start();

			try {
				const warmed = await warmDeployBundleCache({
					client,
					token,
					only: opts.only,
				});
				spin.succeed('Deploy bundle cached.');
				log.ok(`✅ Cached ${warmed.secretsCount} encrypted secrets.`);
				log.info(`Cache path: ${warmed.cachePath}`);
				log.info(`Expires at: ${warmed.expiresAtIso}`);
			} catch (error) {
				spin.fail('Deploy cache warm-up failed.');
				log.error(toErrorMessage(error));
				process.exit(1);
			}
		});
}

export function configureDeployCacheCommand(deploy: Command) {
	const cache = deploy
		.command('cache')
		.description('Manage encrypted deploy bundle cache entries');

	attachDeployCacheWarmCommand(cache);
}
