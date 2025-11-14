import { Command } from 'commander';
import { configureOrganizationCurrentCommand } from './current.js';
import { configureOrganizationListCommand } from './list.js';
import { configureOrganizationSwitchCommand } from './switch.js';
import { configureOrganizationProjectsCommand } from './projects.js';

export function registerOrganizationCommands(program: Command) {
	const org = program
		.command('org')
		.aliases(['organization', 'organizations', 'orgs'])
		.description('Manage Ghostable organizations and related contexts');

	configureOrganizationListCommand(org);
	configureOrganizationCurrentCommand(org);
	configureOrganizationSwitchCommand(org);
	configureOrganizationProjectsCommand(org);
}
