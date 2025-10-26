import { Command } from 'commander';
import ora from 'ora';
import { log } from '../../support/logger.js';
import { DeviceIdentityService } from '../../services/DeviceIdentityService.js';
import { KeyService } from '@/crypto';
import {
        DEFAULT_PREKEY_BATCH,
        ensureDeviceService,
        getAuthedClient,
        persistOneTimePrekeys,
        type LinkedIdentity,
} from './common.js';

export function configurePrekeysCommands(device: Command) {
        const prekeys = device
                .command('prekeys')
                .description('Manage signed and one-time prekeys for this device.');

        prekeys
                .command('rotate')
                .description('Rotate the signed prekey if it has expired.')
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

                        const spinner = ora('Checking signed prekey…').start();
                        try {
                                const current = await service.loadSignedPrekey();
                                const { active, rotated, retired } = await KeyService.rotateSignedPrekeyIfExpired(
                                        identity,
                                        current ?? undefined,
                                );

                                if (!rotated) {
                                        spinner.succeed('Signed prekey is still valid. No rotation needed.');
                                        return;
                                }

                                spinner.text = 'Publishing new signed prekey…';
                                const publish = await client.publishSignedPrekey(identity.deviceId, active);
                                const updated = { ...active, fingerprint: publish.fingerprint };
                                await service.saveSignedPrekey(updated);

                                if (retired) {
                                        await service.clearSignedPrekey(retired.id);
                                }

                                spinner.succeed('Signed prekey rotated successfully.');
                        } catch (error) {
                                spinner.fail('Signed prekey rotation failed.');
                                log.error(error instanceof Error ? error.message : String(error));
                                process.exit(1);
                        }
                });

        prekeys
                .command('top-up')
                .description('Generate and upload additional one-time prekeys.')
                .argument('[count]', 'Number of one-time prekeys to generate', `${DEFAULT_PREKEY_BATCH}`)
                .action(async (countArg: string) => {
                        const count = Number.parseInt(countArg, 10);
                        if (!Number.isFinite(count) || count <= 0) {
                                log.error('Count must be a positive integer.');
                                process.exit(1);
                        }

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

                        const spinner = ora(`Generating ${count} one-time prekeys…`).start();
                        try {
                                const prekeyBatch = await KeyService.createOneTimePrekeys(count);
                                spinner.text = 'Uploading one-time prekeys…';
                                await client.publishOneTimePrekeys(identity.deviceId, prekeyBatch);

                                spinner.text = 'Reconciling local key cache…';
                                const bundle = await client.getDevicePrekeys(identity.deviceId);
                                await persistOneTimePrekeys(service, bundle);

                                spinner.succeed('One-time prekeys topped up successfully.');
                        } catch (error) {
                                spinner.fail('Failed to top up one-time prekeys.');
                                log.error(error instanceof Error ? error.message : String(error));
                                process.exit(1);
                        }
                });
}
