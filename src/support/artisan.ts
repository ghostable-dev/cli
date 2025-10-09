import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { resolveWorkDir } from './workdir.js';

/**
 * Wrapper around php artisan commands.
 * Handles detection, execution, and error output.
 */
export const artisan = {
	/**
	 * Returns true if both php and artisan are available.
	 */
	exists(): boolean {
		const php = spawnSync('php', ['-v'], { stdio: 'ignore' });
		if (php.status !== 0) return false;

		const artisanPath = path.join(resolveWorkDir(), 'artisan');
		return fs.existsSync(artisanPath);
	},

	/**
	 * Executes a php artisan command and returns stdout.
	 *
	 * @example artisan.run(["env:encrypt", "--key=base64:abc..."])
	 */
	run(args: string[], timeoutSeconds = 120): string {
		if (!artisan.exists()) {
			throw new Error('php or artisan CLI not found in this project.');
		}

		const result = spawnSync('php', ['artisan', ...args], {
			stdio: 'pipe',
			encoding: 'utf8',
			timeout: timeoutSeconds * 1000,
		});

		if (result.status !== 0) {
			const err =
				result.stderr?.toString().trim() || result.error?.message || 'unknown error';
			throw new Error(`Artisan command failed (${args.join(' ')}): ${err}`);
		}

		return result.stdout?.toString().trim() ?? '';
	},
};
