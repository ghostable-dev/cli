import { Command } from 'commander';
import fs from 'node:fs';
import path from 'node:path';
import { confirm } from '@inquirer/prompts';
import { x25519 } from '@noble/curves/ed25519.js';

import { log } from '@/support/logger.js';
import { resolveWorkDir } from '@/support/workdir.js';
import { promptWithCancel } from '@/support/prompts.js';

type BackupKeygenOptions = {
	outDir?: string;
	yes?: boolean;
};

function ensureBackupCommand(program: Command): Command {
	const existing = program.commands.find((cmd) => cmd.name() === 'backup');
	if (existing) return existing;
	return program.command('backup').description('Manage Ghostable backups');
}

function timestamp(): string {
	return new Date().toISOString().replace(/[:]/g, '-');
}

export function registerBackupKeygenCommand(program: Command) {
	const backup = ensureBackupCommand(program);

	backup
		.command('keygen')
		.description('Generate a local X25519 keypair for backup recovery')
		.option('--out-dir <PATH>', 'Directory to write key files', path.join('.ghostable', 'keys'))
		.option('--yes', 'Skip confirmation prompts')
		.action(async (opts: BackupKeygenOptions) => {
			const { secretKey, publicKey } = x25519.keygen();

			const privB64 = Buffer.from(secretKey).toString('base64');
			const pubB64 = Buffer.from(publicKey).toString('base64');

			const workDir = resolveWorkDir();
			const outDir = path.resolve(workDir, opts.outDir ?? path.join('.ghostable', 'keys'));

			if (!opts.yes) {
				const confirmed = await promptWithCancel(() =>
					confirm({
						message:
							'This will output a recovery private key. You are responsible for storing it securely. Continue?',
						default: false,
					}),
				);
				if (!confirmed) {
					log.info('Key generation cancelled.');
					return;
				}
			}

			const prefix = `backup-recovery-${timestamp()}`;
			const privPath = path.join(outDir, `${prefix}.priv.b64`);
			const pubPath = path.join(outDir, `${prefix}.pub.b64`);

			try {
				fs.mkdirSync(outDir, { recursive: true });
				fs.writeFileSync(privPath, `${privB64}\n`, { mode: 0o600 });
				fs.writeFileSync(pubPath, `${pubB64}\n`);
			} catch (error) {
				log.error(
					`❌ Failed to write keys to ${outDir}: ${
						(error as Error)?.message ?? String(error)
					}`,
				);
				process.exit(1);
			}

			log.line();
			log.info('🔑 Generated X25519 recovery keypair:');
			log.text(`Public key (base64, use with --recovery-key): ${pubB64}`);
			log.text(
				`Private key (base64, keep offline; use with --recovery-private-key): ${privB64}`,
			);
			log.line();
			log.ok(`Saved keys to ${outDir}`);
			log.warn(
				'Store the private key offline. Anyone with it can decrypt backups including it.',
			);
		});
}
