import fs from 'node:fs/promises';
import path from 'node:path';
import { Command } from 'commander';
import ora from 'ora';
import { confirm } from '@inquirer/prompts';
import { log } from '../../support/logger.js';
import { DeviceIdentityService } from '../../services/DeviceIdentityService.js';
import { KeyService } from '@/crypto';
import {
        ensureDeviceService,
        getAuthedClient,
        type LinkedIdentity,
} from './common.js';
import { encryptedEnvelopeFromJSON, encryptedEnvelopeToJSON } from '@/types';

function encodeEnvelopeForTransport(envelope: ReturnType<typeof encryptedEnvelopeToJSON>): string {
        return Buffer.from(JSON.stringify(envelope), 'utf8').toString('base64');
}

function decodeEnvelope(ciphertext: string) {
        const raw = Buffer.from(ciphertext, 'base64').toString('utf8');
        return encryptedEnvelopeFromJSON(JSON.parse(raw));
}

export function configureEnvelopeCommands(device: Command) {
        const envelopes = device
                .command('envelopes')
                .description('Inspect and exchange encrypted device envelopes.');

        envelopes
                .command('pull')
                .description('Fetch and decrypt queued envelopes for this device.')
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

                        const spinner = ora('Fetching envelopes…').start();
                        try {
                                const envelopesList = await client.getEnvelopes(identity.deviceId);
                                spinner.stop();

                                if (!envelopesList.length) {
                                        log.ok('✅ No envelopes queued.');
                                        return;
                                }

                                for (const env of envelopesList) {
                                        const decoded = decodeEnvelope(env.ciphertext);
                                        const plaintext = await KeyService.decryptOnThisDevice(
                                                decoded,
                                                identity.deviceId,
                                        );
                                        const payload = Buffer.from(plaintext);
                                        const preview = payload.toString('utf8');
                                        log.info('Envelope:');
                                        log.info(`  ID: ${env.id}`);
                                        log.info(`  Created: ${env.createdAt.toISOString()}`);
                                        log.info(`  Algorithm: ${decoded.alg ?? 'n/a'}`);
                                        log.info(`  Meta: ${JSON.stringify(decoded.meta ?? {}, null, 2)}`);
                                        log.info('  Payload:');
                                        log.info(preview.trim() ? `    ${preview}` : `    (base64) ${payload.toString('base64')}`);
                                }
                        } catch (error) {
                                spinner.fail('Failed to pull envelopes.');
                                log.error(error instanceof Error ? error.message : String(error));
                                process.exit(1);
                        }
                });

        envelopes
                .command('ack')
                .description('Acknowledge and remove queued envelopes.')
                .option('-i, --id <id>', 'Only acknowledge a specific envelope ID')
                .action(async (opts: { id?: string }) => {
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

                        const spinner = ora('Fetching envelopes…').start();
                        try {
                                const envelopesList = await client.getEnvelopes(identity.deviceId);
                                spinner.stop();

                                const targets = opts.id
                                        ? envelopesList.filter((env) => env.id === opts.id)
                                        : envelopesList;

                                if (!targets.length) {
                                        log.warn('No envelopes to acknowledge.');
                                        return;
                                }

                                const proceed = opts.id
                                        ? true
                                        : await confirm({
                                                  message: `Acknowledge ${targets.length} envelopes?`,
                                                  default: true,
                                          });
                                if (!proceed) {
                                        log.warn('Acknowledgement aborted.');
                                        return;
                                }

                                const ackSpinner = ora('Acknowledging envelopes…').start();
                                for (const env of targets) {
                                        await client.consumeEnvelope(identity.deviceId, env.id);
                                }
                                ackSpinner.succeed('Envelopes acknowledged.');
                        } catch (error) {
                                spinner.fail('Failed to acknowledge envelopes.');
                                log.error(error instanceof Error ? error.message : String(error));
                                process.exit(1);
                        }
                });

        envelopes
                .command('send')
                .description('Encrypt a payload for another device and queue it via Ghostable.')
                .requiredOption('--to <deviceId>', 'Recipient device ID')
                .requiredOption('--file <path>', 'Path to payload file')
                .action(async (opts: { to: string; file: string }) => {
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

                        const spinner = ora('Preparing payload…').start();
                        try {
                                const target = await client.getDevice(opts.to);
                                const filePath = path.resolve(opts.file);
                                const payload = await fs.readFile(filePath);

                                spinner.text = 'Encrypting envelope…';
                                const envelope = await KeyService.encryptForDevice(
                                        identity,
                                        target.publicKey,
                                        new Uint8Array(payload),
                                        { filename: path.basename(filePath) },
                                );

                                const encoded = encodeEnvelopeForTransport(encryptedEnvelopeToJSON(envelope));
                                spinner.text = 'Queueing envelope with Ghostable…';
                                await client.queueEnvelope(opts.to, {
                                        ciphertext: encoded,
                                        senderDeviceId: identity.deviceId,
                                });

                                spinner.succeed('Envelope queued successfully.');
                        } catch (error) {
                                spinner.fail('Failed to send envelope.');
                                log.error(error instanceof Error ? error.message : String(error));
                                process.exit(1);
                        }
                });
}
