import { Command } from 'commander';
import ora from 'ora';
import { confirm } from '@inquirer/prompts';
import { log } from '../../support/logger.js';
import { DeviceIdentityService } from '../../services/DeviceIdentityService.js';
import { ensureDeviceService, getAuthedClient, type LinkedIdentity } from './common.js';
import { HttpError } from '../../http/errors.js';

async function clearLocalDeviceState(
	service: DeviceIdentityService,
	identity: LinkedIdentity,
): Promise<void> {
	await service.clearIdentity(identity.deviceId);

	const currentSigned = await service.loadSignedPrekey();
	if (currentSigned) {
		await service.clearSignedPrekey(currentSigned.id);
	}
	await service.clearSignedPrekey();

	const cachedPrekeys = await service.loadOneTimePrekeys();
	if (cachedPrekeys.length) {
		await service.dropOneTimePrekeys(cachedPrekeys.map((p) => p.id));
	}
	await service.saveOneTimePrekeys([]);
}

export function configureUnlinkCommand(device: Command) {
	device
		.command('unlink')
		.description('Revoke the current device and wipe local key material.')
		.action(async () => {
			const { client } = await getAuthedClient();
			let service: DeviceIdentityService;
			try {
				service = await ensureDeviceService();
			} catch (error) {
				log.error(error instanceof Error ? error.message : String(error));
				process.exit(1);
			}
			let identity: LinkedIdentity;
			try {
				identity = await service.requireIdentity();
			} catch (error) {
				log.error(error instanceof Error ? error.message : String(error));
				process.exit(1);
			}

			const proceed = await confirm({
				message: 'This will revoke the device and delete local keys. Continue?',
				default: false,
			});
			if (!proceed) {
				log.warn('Device unlink aborted.');
				return;
			}

			const revokeSpinner = ora('Revoking device…').start();
			let revokedRemotely = false;
			try {
				await client.revokeDevice(identity.deviceId);
				revokedRemotely = true;
				revokeSpinner.succeed('Device revoked.');
			} catch (error) {
				if (error instanceof HttpError && error.status === 404) {
					revokeSpinner.warn('Device not found on Ghostable.');
					const clearLocally = await confirm({
						message:
							'The device no longer exists on Ghostable. Clear it locally and delete local keys?',
						default: true,
					});
					if (!clearLocally) {
						log.warn('Device unlink aborted.');
						return;
					}
				} else {
					revokeSpinner.fail('Failed to revoke device.');
					log.error(error instanceof Error ? error.message : String(error));
					process.exit(1);
				}
			}

			const clearSpinner = ora('Clearing local keys…').start();
			try {
				await clearLocalDeviceState(service, identity);
				clearSpinner.succeed(
					revokedRemotely
						? 'Device revoked and local keys cleared.'
						: 'Local device keys cleared.',
				);
			} catch (error) {
				clearSpinner.fail('Failed to clear local keys.');
				log.error(error instanceof Error ? error.message : String(error));
				process.exit(1);
			}
		});
}
