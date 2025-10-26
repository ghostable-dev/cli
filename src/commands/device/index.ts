import { Command } from 'commander';
import { configureLinkCommand } from './link.js';
import { configureStatusCommand } from './status.js';
import { configurePrekeysCommands } from './prekeys.js';
import { configureUnlinkCommand } from './unlink.js';
import { configureEnvelopeCommands } from './envelopes.js';

export function registerDeviceCommands(program: Command) {
	const device = program
		.command('device')
		.description('Manage Ghostable end-to-end encryption devices.');

	configureLinkCommand(device);
	configureStatusCommand(device);
	configurePrekeysCommands(device);
	configureUnlinkCommand(device);
	configureEnvelopeCommands(device);
}

export { linkDeviceFlow } from './link.js';
