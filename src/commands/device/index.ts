import { Command } from 'commander';
import { configureLinkCommand } from './link.js';
import { configureStatusCommand } from './status.js';
import { configureUnlinkCommand } from './unlink.js';

export function registerDeviceCommands(program: Command) {
	const device = program.command('device').description('Manage devices (link, status, unlink).');

	configureLinkCommand(device);
	configureStatusCommand(device);
	configureUnlinkCommand(device);
}

export { linkDeviceFlow } from './link.js';
