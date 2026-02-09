import { Command } from 'commander';
import { registerEnvSubcommand } from './_shared.js';
import { Manifest } from '../../support/Manifest.js';
import { log } from '../../support/logger.js';
import { toErrorMessage } from '../../support/errors.js';
import { requireAuthedClient, requireProjectContext } from '../deploy/token/common.js';
import { reshareEnvironmentKeysForProject } from './reshare-support.js';

type ReshareOptions = {
	env: string[];
	all?: boolean;
};

export function registerEnvReshareCommand(program: Command) {
	registerEnvSubcommand(
		program,
		{
			subcommand: 'reshare',
		},
		(cmd) =>
			cmd
				.description(
					'Re-share environment keys with currently active devices and deployment tokens',
				)
				.option('--env <ENV>', 'Environment name (repeatable)', collectValues, [])
				.option('--all', 'Re-share keys for all environments in this project', false)
				.action(async (opts: ReshareOptions) => runEnvReshare(opts)),
	);
}

function collectValues(value: string, previous: string[]): string[] {
	return [...previous, value];
}

async function runEnvReshare(opts: ReshareOptions): Promise<void> {
	const context = await requireProjectContext();
	const client = await requireAuthedClient();

	let requestedEnvironments = opts.env ?? [];
	if (!opts.all && requestedEnvironments.length === 0) {
		try {
			requestedEnvironments = Manifest.environmentNames();
		} catch {
			requestedEnvironments = [];
		}
	}

	if (!opts.all && requestedEnvironments.length === 0) {
		log.error('❌ No environments selected. Pass --env <NAME> or use --all.');
		process.exit(1);
	}

	try {
		const outcomes = await reshareEnvironmentKeysForProject({
			client,
			projectId: context.projectId,
			requestedEnvironments,
			includeAll: Boolean(opts.all),
			stopOnFailure: false,
		});

		if (!outcomes.length) {
			log.warn('⚠️ No matching environments found to re-share.');
			return;
		}

		const reshared = outcomes.filter((outcome) => outcome.status === 'reshared');
		const skipped = outcomes.filter((outcome) => outcome.status === 'skipped');
		const failed = outcomes.filter((outcome) => outcome.status === 'failed');

		for (const outcome of reshared) {
			log.ok(`✅ Re-shared key for ${outcome.environment}.`);
		}
		for (const outcome of skipped) {
			log.warn(`⚠️ Skipped ${outcome.environment}: ${outcome.message ?? 'Not available'}`);
		}
		for (const outcome of failed) {
			log.warn(`⚠️ Failed ${outcome.environment}: ${outcome.message ?? 'Unknown error'}`);
		}

		if (failed.length > 0) {
			process.exit(1);
		}
	} catch (error) {
		log.error(`❌ Re-share failed: ${toErrorMessage(error)}`);
		process.exit(1);
	}
}
