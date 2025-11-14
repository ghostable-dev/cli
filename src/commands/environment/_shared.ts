import type { Command, CommandOptions } from 'commander';

const envParents = new WeakMap<Command, Command>();

/**
 * Ensure the shared `env`/`environment` parent command exists for the provided Commander program.
 * Uses a WeakMap cache so multiple Command instances (e.g. tests) can register independently.
 */
export function ensureEnvParent(program: Command): Command {
	let parent = envParents.get(program);
	if (!parent) {
		parent = program
			.command('env')
			.alias('environment')
			.description('Manage Ghostable environments and related workflows');
		envParents.set(program, parent);
	}
	return parent;
}

type EnvLegacy = {
	name: string;
	options?: CommandOptions;
};

type EnvRegistration = {
	/**
	 * Name of the subcommand registered under `ghostable env <name>`.
	 */
	subcommand: string;
	/**
	 * Optional legacy command names (e.g. `env:push`) that should continue to work.
	 */
	legacy?: EnvLegacy[];
};

/**
 * Helper to register a subcommand under the shared `env` parent and optionally attach
 * hidden legacy aliases on the root program for backwards compatibility.
 */
export function registerEnvSubcommand(
	program: Command,
	{ subcommand, legacy }: EnvRegistration,
	configure: (cmd: Command) => Command,
): void {
	const parent = ensureEnvParent(program);
	configure(parent.command(subcommand));

	for (const legacyEntry of legacy ?? []) {
		const legacyCommand = program.command(legacyEntry.name, {
			...legacyEntry.options,
			hidden: true,
		});
		configure(legacyCommand);
	}
}
