import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import type { Command } from 'commander';

/**
 * Auto-loads all command modules in this folder (compiled to .js),
 * finds any exported function whose name starts with "register",
 * and calls it with (program).
 *
 * Convention:
 * Export function registerFooCommand(program: Command) { ... }
 * or export default (program: Command) => { ... }
 */
async function loadModule(file: string, program: Command) {
	const mod = await import(pathToFileURL(file).href);

	if (typeof mod.default === 'function') {
		mod.default(program);
		return;
	}

	for (const [name, value] of Object.entries(mod)) {
		if (typeof value === 'function' && /^register[A-Z]/.test(name)) {
			value(program);
		}
	}
}

async function walkModules(dir: string, program: Command) {
	const entries = fs
		.readdirSync(dir, { withFileTypes: true })
		.filter((entry) => !entry.name.startsWith('_'))
		.sort((a, b) => a.name.localeCompare(b.name));

	for (const entry of entries) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			await walkModules(full, program);
			continue;
		}

		if (
			entry.isFile() &&
			entry.name.endsWith('.js') &&
			!entry.name.endsWith('.d.ts') &&
			!entry.name.endsWith('.map')
		) {
			await loadModule(full, program);
		}
	}
}

export async function registerAllCommands(program: Command) {
	const here = fileURLToPath(new URL('.', import.meta.url)); // .../dist/commands/
	await walkModules(here, program);
}
