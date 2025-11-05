import { Command } from 'commander';

import { runEnvPush, type PushOptions } from './push.js';
import { registerEnvSubcommand } from './_shared.js';

export function registerEnvSyncCommand(program: Command) {
	registerEnvSubcommand(
		program,
		{
			subcommand: 'sync',
			legacy: [{ name: 'env:sync' }],
		},
		(cmd) =>
			cmd
				.description(
					'Encrypt and push a local .env file to Ghostable, pruning remote variables not present locally.',
				)
				.option('--file <PATH>', 'Path to .env file (default: .env.<env> or .env)')
				.option('--env <ENV>', 'Environment name (if omitted, select from manifest)')
				.option('-y, --assume-yes', 'Skip confirmation prompts', false)
				.action(async (opts: PushOptions) => {
					await runEnvPush({ ...opts, replace: true, sync: true, pruneServer: true });
				}),
	);
}
