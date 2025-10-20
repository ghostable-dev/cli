import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

type SpawnResult = ReturnType<typeof spawnSync>;
type SpawnError = Error & { code?: string };

/**
 * Wrapper for interacting with the Laravel Vapor CLI.
 * Handles detection, execution, and error reporting.
 */
export const vapor = {
	/**
	 * Checks whether the `vapor` binary exists on PATH.
	 */
	exists(): boolean {
		const paths = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
		const extensions =
			process.platform === 'win32'
				? (process.env.PATHEXT?.split(';') ?? ['.exe', '.bat', '.cmd'])
				: [''];

		for (const base of paths) {
			for (const ext of extensions) {
				const candidate = path.join(base, 'vapor' + ext);
				try {
					fs.accessSync(candidate, fs.constants.X_OK);
					if (fs.statSync(candidate).isFile()) {
						return true;
					}
				} catch {
					continue;
				}
			}
		}

		return false;
	},

	/**
	 * Executes a Vapor CLI command and returns stdout.
	 * Throws if the process fails.
	 *
	 * @example vapor.run(["env:pull", "production"]);
	 */
	run(args: string[], timeoutSeconds = 120): string {
		if (!vapor.exists()) {
			throw new Error('Vapor CLI not found on PATH.');
		}

		const result = spawnSync('vapor', args, {
			stdio: 'pipe',
			encoding: 'utf8',
			timeout: timeoutSeconds * 1000,
		});

		if (result.status !== 0) {
			throw new Error(vapor._extractProcessError(result));
		}

		return result.stdout?.toString().trim() ?? '';
	},

	/**
	 * Executes a Vapor command safely, returning the SpawnResult.
	 * Useful when you need to handle non-zero statuses yourself.
	 */
	tryRun(args: string[], timeoutSeconds = 120): SpawnResult {
		return spawnSync('vapor', args, {
			stdio: 'pipe',
			encoding: 'utf8',
			timeout: timeoutSeconds * 1000,
		});
	},

	/**
	 * Throws if a Vapor process fails.
	 */
	ensureSuccess(result: SpawnResult, action: string): void {
		if (result.status === 0) return;
		const message = vapor._extractProcessError(result);
		throw new Error(`Failed to ${action} using vapor CLI: ${message}`);
	},

	/** Extracts a human-friendly error message from a SpawnResult. */
	_extractProcessError(result: SpawnResult): string {
		if (result.error) {
			const err = result.error as SpawnError;
			if (err.code === 'ETIMEDOUT') return 'process timed out';
			return err.message;
		}

		const stderr = result.stderr?.toString().trim();
		if (stderr) return stderr;

		const stdout = result.stdout?.toString().trim();
		if (stdout) return stdout;

		return 'unknown error';
	},
};
