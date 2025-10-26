import { Command } from 'commander';
import ora from 'ora';
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

				log.info('Local device identity');
				log.info(`  ID: ${identity.deviceId}`);
				log.info(`  Name: ${identity.name ?? 'n/a'}`);
				log.info(`  Platform: ${identity.platform ?? 'n/a'}`);
				log.info(
					`  Signing fingerprint: ${DeviceIdentityService.fingerprint(identity.signingKey.publicKey)}`,
				);
				log.info(
					`  Encryption fingerprint: ${DeviceIdentityService.fingerprint(identity.encryptionKey.publicKey)}`,
				);

				log.info('Remote status');
				log.info(`  Platform: ${deviceRecord.platform}`);
				log.info(`  Status: ${deviceRecord.status}`);
				log.info(`  Created: ${deviceRecord.createdAt.toISOString()}`);
				log.info(`  Last seen: ${deviceRecord.lastSeenAt?.toISOString() ?? 'n/a'}`);
				log.info(`  Revoked at: ${deviceRecord.revokedAt?.toISOString() ?? 'n/a'}`);

				const signedPrekey = await service.loadSignedPrekey();
				if (signedPrekey) {
					log.info('Signed prekey');
					log.info(`  ID: ${signedPrekey.id}`);
					log.info(`  Fingerprint: ${signedPrekey.fingerprint ?? 'n/a'}`);
					log.info(`  Expires: ${signedPrekey.expiresAtIso ?? 'n/a'}`);
				}

				const oneTimePrekeys = await service.loadOneTimePrekeys();
				log.info(`One-time prekeys stored locally: ${oneTimePrekeys.length}`);
			} catch (error) {
				spinner.fail('Unable to fetch device status.');
				log.error(error instanceof Error ? error.message : String(error));
				process.exit(1);
			}
		});
}
