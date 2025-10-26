import { Command } from 'commander';
import ora from 'ora';
import { confirm } from '@inquirer/prompts';
import { log } from '../../support/logger.js';
import { DeviceIdentityService } from '../../services/DeviceIdentityService.js';
import { ensureDeviceService, getAuthedClient, type LinkedIdentity } from './common.js';

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

                        const spinner = ora('Revoking device…').start();
                        try {
                                await client.revokeDevice(identity.deviceId);
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
                                spinner.succeed('Device revoked and local keys cleared.');
                        } catch (error) {
                                spinner.fail('Failed to revoke device.');
                                log.error(error instanceof Error ? error.message : String(error));
                                process.exit(1);
                        }
                });
}
