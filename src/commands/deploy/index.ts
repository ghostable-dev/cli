import type { Command } from 'commander';

import { configureDeployCloudCommand } from './cloud.js';
import { configureDeployForgeCommand } from './forge.js';
import { configureDeployVaporCommand } from './vapor.js';
import { configureDeployTokenCommands } from './token/index.js';

export function registerDeployCommands(program: Command) {
	const deploy = program
		.command('deploy')
		.description('Deploy Ghostable environment secrets (cloud, forge, vapor, token).');

	configureDeployCloudCommand(deploy);
	configureDeployForgeCommand(deploy);
	configureDeployVaporCommand(deploy);
	configureDeployTokenCommands(deploy);
}
