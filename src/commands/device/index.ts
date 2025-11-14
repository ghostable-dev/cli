import { Command } from 'commander';
import { configureLinkCommand } from './link.js';
import { configureStatusCommand } from './status.js';
import { configureUnlinkCommand } from './unlink.js';

export function registerDeviceCommands(program: Command) {
	const device = program
		.command('device')
		.description('Manage Ghostable device identities and lifecycle actions');

	configureLinkCommand(device);
	configureStatusCommand(device);
	configureUnlinkCommand(device);
}

export { linkDeviceFlow } from './link.js';
