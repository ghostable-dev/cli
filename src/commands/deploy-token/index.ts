import { Command } from 'commander';

import { configureCreateCommand } from './create.js';
import { configureListCommand } from './list.js';
import { configureRevokeCommand } from './revoke.js';
import { configureRotateCommand } from './rotate.js';

export function registerDeployTokenCommands(program: Command) {
	const deploy = program
		.command('deploy-token')
		.description('Manage deployment tokens used for CI/CD deployments.');

	configureListCommand(deploy);
	configureCreateCommand(deploy);
	configureRotateCommand(deploy);
	configureRevokeCommand(deploy);
}
