import type { Command, CommandOptions } from 'commander';

const varParents = new WeakMap<Command, Command>();

/**
 * Ensure the shared `var`/`variable` parent command exists.
 * Uses a WeakMap so different Commander instances (e.g. tests) are isolated.
 */
export function ensureVarParent(program: Command): Command {
	let parent = varParents.get(program);
	if (!parent) {
		parent = program
			.command('var')
			.alias('variable')
			.description('Manage individual Ghostable environment variables (pull, push).');
		varParents.set(program, parent);
	}
	return parent;
}

type VarLegacy = {
	name: string;
	options?: CommandOptions;
};

type VarRegistration = {
	/**
	 * Name of the subcommand registered under `ghostable var <subcommand>`.
	 */
	subcommand: string;
	/**
	 * Optional legacy command names (e.g. `var:pull`) that should continue to work.
	 */
	legacy?: VarLegacy[];
};

/**
 * Helper to register a subcommand under the shared `var` parent and optionally expose
 * hidden legacy aliases on the root program for backwards compatibility.
 */
export function registerVarSubcommand(
	program: Command,
	{ subcommand, legacy }: VarRegistration,
	configure: (cmd: Command) => Command,
): void {
	const parent = ensureVarParent(program);
	configure(parent.command(subcommand));

	for (const legacyEntry of legacy ?? []) {
		const legacyCommand = program.command(legacyEntry.name, {
			...legacyEntry.options,
			hidden: true,
		});
		configure(legacyCommand);
	}
}
