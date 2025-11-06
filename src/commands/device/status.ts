import { Command } from 'commander';
import ora from 'ora';
import boxen from 'boxen';
import chalk from 'chalk';
import { log } from '../../support/logger.js';
import { DeviceIdentityService } from '../../services/DeviceIdentityService.js';
import { ensureDeviceService, getAuthedClient } from './common.js';

export function configureStatusCommand(device: Command) {
	device
		.command('status')
		.description('Show local device identity details and remote status from Ghostable.')
		.action(async () => {
			const { client } = await getAuthedClient();
			let service: DeviceIdentityService;
			try {
				service = await ensureDeviceService();
			} catch (error) {
				log.error(error instanceof Error ? error.message : String(error));
				process.exit(1);
			}
			let identity: Awaited<ReturnType<DeviceIdentityService['loadIdentity']>>;
			try {
				identity = await service.requireIdentity();
			} catch (error) {
				log.error(error instanceof Error ? error.message : String(error));
				process.exit(1);
			}

			const spinner = ora('Fetching device status…').start();
			try {
				const deviceRecord = await client.getDevice(identity.deviceId);
				spinner.stop();

				const baseBoxOptions = {
					padding: { top: 1, bottom: 1, left: 2, right: 2 },
					margin: 1,
					borderColor: 'cyan' as const,
					borderStyle: 'round' as const,
				};

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
					`Created: ${deviceRecord.createdAt.toISOString()}`,
					`Last seen: ${deviceRecord.lastSeenAt?.toISOString() ?? 'n/a'}`,
					`Revoked at: ${deviceRecord.revokedAt?.toISOString() ?? 'n/a'}`,
				].join('\n');

				log.text(
					boxen(localDetails, {
						...baseBoxOptions,
						title: chalk.bold('Local Device Identity'),
						titleAlignment: 'center',
					}),
				);

				log.text(
					boxen(remoteDetails, {
						...baseBoxOptions,
						title: chalk.bold('Remote Status'),
						titleAlignment: 'center',
					}),
				);
			} catch (error) {
				spinner.fail('Unable to fetch device status.');
				log.error(error instanceof Error ? error.message : String(error));
				process.exit(1);
			}
		});
}
