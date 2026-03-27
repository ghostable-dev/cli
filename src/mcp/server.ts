import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod/v4';

import { EnvFileFormat } from '@/environment/files/env-format.js';

export type GhostableMcpSecretAccess = 'off' | 'masked' | 'full';

export type GhostableMcpServeOptions = {
	project?: string;
	env?: string;
	readOnly: boolean;
	secretAccess: GhostableMcpSecretAccess;
};

export type GhostableMcpToolkitProject = {
	id: string;
	name: string;
	slug: string;
	organizationId: string;
};

export type GhostableMcpToolkitEnvironment = {
	id: string;
	name: string;
	type: string;
	baseId: string | null;
};

export type GhostableMcpToolkitListProjectsResult = {
	organizationId: string | null;
	projectScope: string | null;
	projects: Array<GhostableMcpToolkitProject & { environmentNames: string[] }>;
};

export type GhostableMcpToolkitListEnvironmentsResult = {
	project: GhostableMcpToolkitProject;
	environments: GhostableMcpToolkitEnvironment[];
};

export type GhostableMcpToolkitEnvironmentHistoryResult = {
	project: GhostableMcpToolkitProject;
	environment: GhostableMcpToolkitEnvironment;
	summary: unknown;
	entries: unknown[];
};

export type GhostableMcpToolkitReshareResult = {
	organizationId: string;
	project: GhostableMcpToolkitProject | null;
	environment: GhostableMcpToolkitEnvironment | null;
	requests: unknown[];
	meta: unknown;
};

export type GhostableMcpToolkitValidateResult = {
	valid: boolean;
	project: GhostableMcpToolkitProject;
	environment: GhostableMcpToolkitEnvironment;
	filePath: string;
	schemaKeyCount: number;
	issues: Array<{ variable: string; message: string }>;
};

export type GhostableMcpToolkitDiffResult = {
	project: GhostableMcpToolkitProject;
	environment: GhostableMcpToolkitEnvironment;
	filePath: string;
	ignoredKeys: string[];
	added: Array<{
		name: string;
		localValue: string | null;
		remoteValue: string | null;
		localCommented: boolean | null;
		remoteCommented: boolean | null;
	}>;
	updated: Array<{
		name: string;
		localValue: string | null;
		remoteValue: string | null;
		localCommented: boolean | null;
		remoteCommented: boolean | null;
	}>;
	removed: Array<{
		name: string;
		localValue: string | null;
		remoteValue: string | null;
		localCommented: boolean | null;
		remoteCommented: boolean | null;
	}>;
};

export type GhostableMcpToolkitEnvironmentSummary = {
	project: GhostableMcpToolkitProject;
	environment: GhostableMcpToolkitEnvironment;
	chain: string[];
	decryptedSecretCount: number;
	commentedSecretCount: number;
	localFilePath: string;
	variableNames: string[];
};

export type GhostableMcpToolkitReadSecretResult = {
	project: GhostableMcpToolkitProject;
	environment: GhostableMcpToolkitEnvironment;
	name: string;
	value: string;
	commented: boolean;
	sourceEnvironment: string;
	secretAccess: GhostableMcpSecretAccess;
};

export interface GhostableMcpToolkit {
	listProjects(): Promise<GhostableMcpToolkitListProjectsResult>;
	listEnvironments(): Promise<GhostableMcpToolkitListEnvironmentsResult>;
	showEnvironmentHistory(limit: number): Promise<GhostableMcpToolkitEnvironmentHistoryResult>;
	showKeyReshareStatus(input: {
		status?: 'pending' | 'completed' | 'cancelled' | 'superseded';
		limit: number;
	}): Promise<GhostableMcpToolkitReshareResult>;
	validateLocalEnv(file?: string): Promise<GhostableMcpToolkitValidateResult>;
	diffLocalRemote(input: {
		file?: string;
		only?: string[];
		showIgnored?: boolean;
	}): Promise<GhostableMcpToolkitDiffResult>;
	pullEnvironmentSummary(input: {
		only?: string[];
	}): Promise<GhostableMcpToolkitEnvironmentSummary>;
	readSecret(
		name: string,
		secretAccess: GhostableMcpSecretAccess,
	): Promise<GhostableMcpToolkitReadSecretResult>;
	materializeEnvFile(format?: EnvFileFormat): Promise<{
		project: GhostableMcpToolkitProject;
		environment: GhostableMcpToolkitEnvironment;
		format: EnvFileFormat;
		content: string;
	}>;
}

export type GhostableMcpToolDefinition = {
	name: string;
	description: string;
	inputSchema: Record<string, z.ZodTypeAny>;
	enabled: (options: GhostableMcpServeOptions) => boolean;
	execute: (
		args: Record<string, unknown>,
		toolkit: GhostableMcpToolkit,
		options: GhostableMcpServeOptions,
	) => Promise<Record<string, unknown>>;
};

const ENV_FILE_FORMATS = [
	EnvFileFormat.ALPHABETICAL,
	EnvFileFormat.GROUPED,
	EnvFileFormat.GROUPED_COMMENTS,
] as const;

export function normalizeMcpServeOptions(input: {
	project?: string;
	env?: string;
	readOnly?: boolean;
	secretAccess?: string;
}): GhostableMcpServeOptions {
	const secretAccess = (input.secretAccess?.trim() || 'off') as GhostableMcpSecretAccess;

	if (!['off', 'masked', 'full'].includes(secretAccess)) {
		throw new Error('Invalid secret access mode. Use off, masked, or full.');
	}

	return {
		project: input.project?.trim() || undefined,
		env: input.env?.trim() || undefined,
		readOnly: input.readOnly ?? true,
		secretAccess,
	};
}

export function getEnabledToolDefinitions(
	options: GhostableMcpServeOptions,
): GhostableMcpToolDefinition[] {
	return ALL_TOOL_DEFINITIONS.filter((definition) => definition.enabled(options));
}

export function createGhostableMcpServer(
	toolkit: GhostableMcpToolkit,
	options: GhostableMcpServeOptions,
): McpServer {
	const server = new McpServer(
		{
			name: 'ghostable-cli',
			version: '2.5.2',
		},
		{
			capabilities: {
				logging: {},
			},
			instructions:
				'Use this local Ghostable MCP server for read-mostly environment workflows. It is scoped by the CLI launch flags and only exposes secret values when secret access is explicitly enabled.',
		},
	);

	for (const definition of getEnabledToolDefinitions(options)) {
		server.registerTool(
			definition.name,
			{
				description: definition.description,
				inputSchema: definition.inputSchema,
			},
			async (args) => {
				const structuredContent = await definition.execute(
					args as Record<string, unknown>,
					toolkit,
					options,
				);

				return {
					content: [
						{
							type: 'text' as const,
							text: JSON.stringify(structuredContent, null, 2),
						},
					],
					structuredContent,
				};
			},
		);
	}

	return server;
}

const ALL_TOOL_DEFINITIONS: GhostableMcpToolDefinition[] = [
	{
		name: 'list_projects',
		description:
			'List Ghostable projects available in the current CLI context, optionally narrowed by the launch scope.',
		inputSchema: {},
		enabled: () => true,
		execute: async (_args, toolkit) => toolkit.listProjects(),
	},
	{
		name: 'list_environments',
		description:
			'List environments for the scoped project. Requires a current project manifest or --project scope.',
		inputSchema: {},
		enabled: () => true,
		execute: async (_args, toolkit) => toolkit.listEnvironments(),
	},
	{
		name: 'show_environment_history',
		description:
			'Show recent environment history for the scoped environment, including key re-share lifecycle events.',
		inputSchema: {
			limit: z.number().int().min(1).max(60).optional(),
		},
		enabled: () => true,
		execute: async (args, toolkit) =>
			toolkit.showEnvironmentHistory((args.limit as number | undefined) ?? 20),
	},
	{
		name: 'show_key_reshare_status',
		description:
			'Show recent key re-share requests for the current organization and optional scoped project or environment.',
		inputSchema: {
			status: z.enum(['pending', 'completed', 'cancelled', 'superseded']).optional(),
			limit: z.number().int().min(1).max(100).optional(),
		},
		enabled: () => true,
		execute: async (args, toolkit) =>
			toolkit.showKeyReshareStatus({
				status: args.status as
					| 'pending'
					| 'completed'
					| 'cancelled'
					| 'superseded'
					| undefined,
				limit: (args.limit as number | undefined) ?? 20,
			}),
	},
	{
		name: 'validate_local_env',
		description:
			'Validate the local .env file for the scoped environment against the configured Ghostable schema.',
		inputSchema: {
			file: z.string().optional(),
		},
		enabled: () => true,
		execute: async (args, toolkit) => toolkit.validateLocalEnv(args.file as string | undefined),
	},
	{
		name: 'diff_local_remote',
		description:
			'Compare the local .env file against the remotely stored Ghostable environment after decrypting on this device.',
		inputSchema: {
			file: z.string().optional(),
			only: z.array(z.string()).optional(),
			showIgnored: z.boolean().optional(),
		},
		enabled: () => true,
		execute: async (args, toolkit) =>
			toolkit.diffLocalRemote({
				file: args.file as string | undefined,
				only: args.only as string[] | undefined,
				showIgnored: args.showIgnored as boolean | undefined,
			}),
	},
	{
		name: 'pull_environment_summary',
		description:
			'Return a metadata-only summary of the scoped remote environment after verifying this device can decrypt it.',
		inputSchema: {
			only: z.array(z.string()).optional(),
		},
		enabled: () => true,
		execute: async (args, toolkit) =>
			toolkit.pullEnvironmentSummary({
				only: args.only as string[] | undefined,
			}),
	},
	{
		name: 'read_secret',
		description:
			'Read one decrypted secret from the scoped environment. Value exposure is controlled by the CLI secret access mode.',
		inputSchema: {
			name: z.string().min(1),
		},
		enabled: (options) => !options.readOnly && options.secretAccess !== 'off',
		execute: async (args, toolkit, options) =>
			toolkit.readSecret(String(args.name), options.secretAccess),
	},
	{
		name: 'materialize_env_file',
		description:
			'Render the scoped remote environment as dotenv content without writing to disk. Requires full secret access and non-read-only mode.',
		inputSchema: {
			format: z.enum(ENV_FILE_FORMATS).optional(),
		},
		enabled: (options) => !options.readOnly && options.secretAccess === 'full',
		execute: async (args, toolkit) =>
			toolkit.materializeEnvFile(args.format as EnvFileFormat | undefined),
	},
];
