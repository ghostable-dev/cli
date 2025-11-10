import { Command } from 'commander';

import { configureCreateCommand } from './create.js';
import { configureListCommand } from './list.js';
import { configureRevokeCommand } from './revoke.js';
import { configureRotateCommand } from './rotate.js';

export function configureDeployTokenCommands(deploy: Command) {
	const token = deploy
		.command('token')
		.description('Manage Ghostable deployment tokens for CI workflows');

	configureListCommand(token);
	configureCreateCommand(token);
	configureRotateCommand(token);
	configureRevokeCommand(token);

	const root = deploy.parent ?? null;
	if (root) {
		const legacy = root
			.command('deploy-token', { hidden: true })
			.description('Manage Ghostable deployment tokens for CI workflows');

		configureListCommand(legacy);
		configureCreateCommand(legacy);
		configureRotateCommand(legacy);
		configureRevokeCommand(legacy);
	}
}
