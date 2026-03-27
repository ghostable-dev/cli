import { Command } from 'commander';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { createGhostableMcpServer, normalizeMcpServeOptions } from '@/mcp/server.js';
import { GhostableCliMcpToolkit } from '@/mcp/toolkit.js';

type ServeCommandOptions = {
	project?: string;
	env?: string;
	readOnly?: boolean;
	secretAccess?: string;
};

function ensureMcpCommand(program: Command): Command {
	const existing = program.commands.find((command) => command.name() === 'mcp');
	if (existing) {
		return existing;
	}

	return program.command('mcp').description('Run Ghostable local MCP servers and tooling');
}

export function registerMcpServeCommand(program: Command) {
	const mcp = ensureMcpCommand(program);

	mcp.command('serve')
		.description('Expose Ghostable as a local stdio MCP server')
		.option('--project <PROJECT>', 'Project id, slug, or name to scope the MCP surface')
		.option('--env <ENV>', 'Environment id or name to scope the MCP surface')
		.option('--read-only', 'Keep the MCP surface read-only')
		.option('--no-read-only', 'Allow non-read-only tools when secret access permits')
		.option('--secret-access <MODE>', 'Secret access mode: off, masked, or full', 'off')
		.action(async (rawOptions: ServeCommandOptions) => {
			const options = normalizeMcpServeOptions(rawOptions);
			const toolkit = new GhostableCliMcpToolkit(options);
			const server = createGhostableMcpServer(toolkit, options);
			const transport = new StdioServerTransport();

			console.error(
				`Ghostable MCP server starting on stdio (readOnly=${String(options.readOnly)}, secretAccess=${options.secretAccess})`,
			);

			await server.connect(transport);
		});
}
