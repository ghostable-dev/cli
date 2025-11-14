import { Command } from 'commander';
import ora from 'ora';
import boxen from 'boxen';
import chalk from 'chalk';
import { log } from '../../support/logger.js';
import { formatDateTime } from '../../support/dates.js';
import { DeviceIdentityService } from '../../services/DeviceIdentityService.js';
import type { GhostableClient } from '@/ghostable';
import type { DeviceIdentity } from '@/crypto';
import { ensureDeviceService, getAuthedClient } from './common.js';

type StatusContext = {
	service?: DeviceIdentityService;
	identity?: DeviceIdentity;
};

export async function showDeviceStatus(
	client: GhostableClient,
	context: StatusContext = {},
): Promise<void> {
	const service = context.service ?? (await ensureDeviceService());
	const identity = context.identity ?? (await service.requireIdentity());
	const spinner = ora('Fetching device status…').start();

	try {
		const deviceRecord = await client.getDevice(identity.deviceId);
		spinner.stop();

		const localDetails = [
			`ID: ${identity.deviceId}`,
			`Name: ${identity.name ?? 'n/a'}`,
			`Platform: ${identity.platform ?? 'n/a'}`,
			`Signing fingerprint: ${DeviceIdentityService.fingerprint(identity.signingKey.publicKey)}`,
			`Encryption fingerprint: ${DeviceIdentityService.fingerprint(identity.encryptionKey.publicKey)}`,
		].join('\n');

		const remoteDetails = [
			`Platform: ${deviceRecord.platform}`,
			`Status: ${deviceRecord.status}`,
			`Created: ${formatDateTime(deviceRecord.createdAt)}`,
			`Last seen: ${deviceRecord.lastSeenAt ? formatDateTime(deviceRecord.lastSeenAt) : 'n/a'}`,
			`Revoked at: ${deviceRecord.revokedAt ? formatDateTime(deviceRecord.revokedAt) : 'n/a'}`,
		].join('\n');

		const section = (title: string, details: string) => `${chalk.bold.cyan(title)}\n${details}`;
		const content = [
			section('Local Device Identity', localDetails),
			section('Remote Status', remoteDetails),
		].join('\n\n');

		log.text(
			boxen(content, {
				padding: { top: 1, bottom: 1, left: 2, right: 2 },
				margin: 1,
				borderColor: 'cyan',
				borderStyle: 'round',
			}),
		);
	} catch (error) {
		spinner.fail('Unable to fetch device status.');
		throw error;
	}
}

export function configureStatusCommand(device: Command) {
	device
		.command('status')
		.description('Show local device details and their Ghostable status')
		.action(async () => {
			const { client } = await getAuthedClient();
			try {
				await showDeviceStatus(client);
			} catch (error) {
				log.error(error instanceof Error ? error.message : String(error));
				process.exit(1);
			}
		});
}
