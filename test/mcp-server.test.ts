import { describe, expect, it, vi } from 'vitest';

import {
	createGhostableMcpServer,
	getEnabledToolDefinitions,
	normalizeMcpServeOptions,
	type GhostableMcpToolkit,
} from '@/mcp/server.js';
import { maskSecretValue } from '@/mcp/toolkit.js';

describe('ghostable mcp options', () => {
	it('defaults to read-only mode with secret access disabled', () => {
		expect(normalizeMcpServeOptions({})).toEqual({
			project: undefined,
			env: undefined,
			readOnly: true,
			secretAccess: 'off',
		});
	});

	it('rejects invalid secret access modes', () => {
		expect(() => normalizeMcpServeOptions({ secretAccess: 'everything' })).toThrowError(
			'Invalid secret access mode',
		);
	});
});

describe('ghostable mcp tool registration', () => {
	it('hides sensitive tools by default', () => {
		const tools = getEnabledToolDefinitions(
			normalizeMcpServeOptions({
				readOnly: true,
				secretAccess: 'off',
			}),
		).map((tool) => tool.name);

		expect(tools).not.toContain('read_secret');
		expect(tools).not.toContain('materialize_env_file');
		expect(tools).toContain('list_projects');
		expect(tools).toContain('diff_local_remote');
	});

	it('enables read_secret in non-read-only masked mode but keeps file materialization hidden', () => {
		const tools = getEnabledToolDefinitions(
			normalizeMcpServeOptions({
				readOnly: false,
				secretAccess: 'masked',
			}),
		).map((tool) => tool.name);

		expect(tools).toContain('read_secret');
		expect(tools).not.toContain('materialize_env_file');
	});

	it('enables both sensitive tools in full access mode', () => {
		const tools = getEnabledToolDefinitions(
			normalizeMcpServeOptions({
				readOnly: false,
				secretAccess: 'full',
			}),
		).map((tool) => tool.name);

		expect(tools).toContain('read_secret');
		expect(tools).toContain('materialize_env_file');
	});
});

describe('ghostable mcp helpers', () => {
	it('masks secret values without leaking the middle of the string', () => {
		expect(maskSecretValue('abcd')).toBe('****');
		expect(maskSecretValue('super-secret-value')).toBe('su**************ue');
	});

	it('builds an mcp server with the expected default tool set', () => {
		const toolkit: GhostableMcpToolkit = {
			listProjects: vi.fn(async () => ({
				organizationId: 'org_123',
				projectScope: null,
				projects: [],
			})),
			listEnvironments: vi.fn(async () => ({
				project: {
					id: 'proj_123',
					name: 'Phoenix',
					slug: 'phoenix',
					organizationId: 'org_123',
				},
				environments: [],
			})),
			showEnvironmentHistory: vi.fn(async () => ({
				project: {
					id: 'proj_123',
					name: 'Phoenix',
					slug: 'phoenix',
					organizationId: 'org_123',
				},
				environment: {
					id: 'env_123',
					name: 'production',
					type: 'production',
					baseId: null,
				},
				summary: null,
				entries: [],
			})),
			showKeyReshareStatus: vi.fn(async () => ({
				organizationId: 'org_123',
				project: null,
				environment: null,
				requests: [],
				meta: null,
			})),
			validateLocalEnv: vi.fn(async () => ({
				valid: true,
				project: {
					id: 'proj_123',
					name: 'Phoenix',
					slug: 'phoenix',
					organizationId: 'org_123',
				},
				environment: {
					id: 'env_123',
					name: 'production',
					type: 'production',
					baseId: null,
				},
				filePath: '/tmp/.env.production',
				schemaKeyCount: 0,
				issues: [],
			})),
			diffLocalRemote: vi.fn(async () => ({
				project: {
					id: 'proj_123',
					name: 'Phoenix',
					slug: 'phoenix',
					organizationId: 'org_123',
				},
				environment: {
					id: 'env_123',
					name: 'production',
					type: 'production',
					baseId: null,
				},
				filePath: '/tmp/.env.production',
				ignoredKeys: [],
				added: [],
				updated: [],
				removed: [],
			})),
			pullEnvironmentSummary: vi.fn(async () => ({
				project: {
					id: 'proj_123',
					name: 'Phoenix',
					slug: 'phoenix',
					organizationId: 'org_123',
				},
				environment: {
					id: 'env_123',
					name: 'production',
					type: 'production',
					baseId: null,
				},
				chain: ['base', 'production'],
				decryptedSecretCount: 0,
				commentedSecretCount: 0,
				localFilePath: '/tmp/.env.production',
				variableNames: [],
			})),
			readSecret: vi.fn(async () => ({
				project: {
					id: 'proj_123',
					name: 'Phoenix',
					slug: 'phoenix',
					organizationId: 'org_123',
				},
				environment: {
					id: 'env_123',
					name: 'production',
					type: 'production',
					baseId: null,
				},
				name: 'API_KEY',
				value: 'masked',
				commented: false,
				sourceEnvironment: 'production',
				secretAccess: 'masked',
			})),
			materializeEnvFile: vi.fn(async () => ({
				project: {
					id: 'proj_123',
					name: 'Phoenix',
					slug: 'phoenix',
					organizationId: 'org_123',
				},
				environment: {
					id: 'env_123',
					name: 'production',
					type: 'production',
					baseId: null,
				},
				format: 'alphabetical',
				content: 'API_KEY=value\n',
			})),
		};

		const server = createGhostableMcpServer(
			toolkit,
			normalizeMcpServeOptions({
				readOnly: true,
				secretAccess: 'off',
			}),
		);

		expect(server).toBeDefined();
		expect(getEnabledToolDefinitions(normalizeMcpServeOptions({}))).toHaveLength(7);
	});
});
