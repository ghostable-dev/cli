import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';

const selectMock = vi.hoisted(() => vi.fn());
const confirmMock = vi.hoisted(() => vi.fn());
const inputMock = vi.hoisted(() => vi.fn());

const requireProjectContextMock = vi.hoisted(() => vi.fn());
const requireAuthedClientMock = vi.hoisted(() => vi.fn());
const requireDeviceIdentityMock = vi.hoisted(() => vi.fn());
const reshareEnvironmentKeyMock = vi.hoisted(() => vi.fn());

const buildSecretPayloadMock = vi.hoisted(() => vi.fn());
const ensureEnvironmentKeyMock = vi.hoisted(() => vi.fn());
const environmentKeyServiceCreateMock = vi.hoisted(() => vi.fn());

const logInfoMock = vi.hoisted(() => vi.fn());
const logWarnMock = vi.hoisted(() => vi.fn());
const logErrorMock = vi.hoisted(() => vi.fn());
const logOkMock = vi.hoisted(() => vi.fn());
const logTextMock = vi.hoisted(() => vi.fn());

vi.mock('@inquirer/prompts', () => ({
	select: selectMock,
	confirm: confirmMock,
	input: inputMock,
}));

vi.mock('../../../src/support/prompts.js', () => ({
	promptWithCancel: async <T>(factory: () => Promise<T>) => factory(),
}));

vi.mock('../../../src/support/errors.js', () => ({
	toErrorMessage: (error: unknown) => (error instanceof Error ? error.message : String(error)),
}));

vi.mock('../../../src/support/logger.js', () => ({
	log: {
		info: logInfoMock,
		warn: logWarnMock,
		error: logErrorMock,
		ok: logOkMock,
		text: logTextMock,
	},
}));

vi.mock('../../../src/commands/deploy/token/common.js', () => ({
	requireProjectContext: requireProjectContextMock,
	requireAuthedClient: requireAuthedClientMock,
	requireDeviceIdentity: requireDeviceIdentityMock,
	reshareEnvironmentKey: reshareEnvironmentKeyMock,
}));

vi.mock('../../../src/environment/keys/EnvironmentKeyService.js', () => ({
	EnvironmentKeyService: {
		create: environmentKeyServiceCreateMock,
	},
}));

vi.mock('../../../src/support/secret-payload.js', () => ({
	buildSecretPayload: buildSecretPayloadMock,
}));

type RegisterEnvPromoteCommand =
	(typeof import('../../../src/commands/environment/promote.js'))['registerEnvPromoteCommand'];

let registerEnvPromoteCommand: RegisterEnvPromoteCommand;

beforeAll(async () => {
	({ registerEnvPromoteCommand } = await import('../../../src/commands/environment/promote.js'));
});

beforeEach(() => {
	vi.clearAllMocks();

	requireProjectContextMock.mockResolvedValue({
		projectId: 'proj_123',
		projectName: 'Primary Server',
	});

	requireDeviceIdentityMock.mockResolvedValue({
		deviceId: 'device_123',
		signingKey: {
			privateKey: Buffer.from('signing-private-key').toString('base64'),
		},
	});

	environmentKeyServiceCreateMock.mockResolvedValue({
		ensureEnvironmentKey: ensureEnvironmentKeyMock,
	});

	ensureEnvironmentKeyMock.mockResolvedValue({
		key: new Uint8Array([1, 2, 3, 4]),
		version: 5,
		fingerprint: 'fingerprint_123',
		created: false,
	});

	buildSecretPayloadMock.mockResolvedValue({
		name: 'APP_DEBUG',
		env: 'production',
		ciphertext: 'ciphertext',
		nonce: 'nonce',
		alg: 'xchacha20-poly1305',
		aad: {
			org: 'org_123',
			project: 'proj_123',
			env: 'production',
			name: 'APP_DEBUG',
		},
		claims: { hmac: 'hmac' },
		client_sig: 'signature',
	});
});

function createProgram(): Command {
	const program = new Command();
	registerEnvPromoteCommand(program);
	return program;
}

describe('env promote command', () => {
	it('creates a promotion request through the guided flow with blank payload values by default', async () => {
		selectMock
			.mockResolvedValueOnce('env_local')
			.mockResolvedValueOnce('env_prod')
			.mockResolvedValueOnce('APP_DEBUG');
		confirmMock
			.mockResolvedValueOnce(false)
			.mockResolvedValueOnce(false)
			.mockResolvedValueOnce(true);

		const client = {
			getEnvironments: vi.fn(async () => [
				{ id: 'env_local', name: 'local', type: 'development' },
				{ id: 'env_prod', name: 'production', type: 'production' },
			]),
			getEnvironmentKeys: vi.fn(async () => ({
				data: [
					{ name: 'APP_DEBUG', version: 1 },
					{ name: 'APP_KEY', version: 3 },
				],
			})),
			previewVariablePromotionRequest: vi.fn(async () => ({
				source_environment_id: 'env_local',
				source_environment_name: 'local',
				target_environment_id: 'env_prod',
				target_environment_name: 'production',
				total_entries: 1,
				can_view_target_variables: true,
				creates_count: 0,
				updates_count: 1,
				overlap_count: 1,
			})),
			getProject: vi.fn(async () => ({
				id: 'proj_123',
				organizationId: 'org_123',
			})),
			createVariablePromotionRequest: vi.fn(async () => ({
				data: { id: 'promo_1' },
			})),
		};

		requireAuthedClientMock.mockResolvedValue(client);

		const program = createProgram();
		await program.parseAsync(['node', 'ghostable', 'env', 'promote']);

		expect(buildSecretPayloadMock).toHaveBeenCalledTimes(1);
		expect(buildSecretPayloadMock).toHaveBeenCalledWith(
			expect.objectContaining({
				name: 'APP_DEBUG',
				plaintext: '',
				env: 'production',
			}),
		);
		expect(client.createVariablePromotionRequest).toHaveBeenCalledTimes(1);
		const [, , payload, requestOptions] = client.createVariablePromotionRequest.mock.calls[0];
		expect(payload.include_values).toBe(false);
		expect(payload.entries).toHaveLength(1);
		expect(payload.entries[0]?.name).toBe('APP_DEBUG');
		expect(requestOptions.idempotencyKey).toMatch(
			/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
		);
	});

	it('lists pending promotion requests across environments in the current project', async () => {
		const client = {
			getEnvironments: vi.fn(async () => [
				{ id: 'env_local', name: 'local', type: 'development' },
				{ id: 'env_staging', name: 'staging', type: 'staging' },
			]),
			listVariablePromotionRequests: vi
				.fn()
				.mockImplementation(async (_projectId: string, envName: string) =>
					envName === 'local'
						? [
								{
									type: 'environment-variable-promotion-requests',
									id: 'promo_local',
									attributes: {
										source_environment_name: 'local',
										target_environment_name: 'production',
										status: 'pending',
										entry_count: 1,
										entries: [{ name: 'APP_URL' }],
										include_values: false,
										created_at: '2026-04-16T12:00:00Z',
									},
								},
							]
						: [
								{
									type: 'environment-variable-promotion-requests',
									id: 'promo_staging',
									attributes: {
										source_environment_name: 'staging',
										target_environment_name: 'production',
										status: 'pending',
										entry_count: 1,
										entries: [{ name: 'APP_DEBUG' }],
										include_values: true,
										created_at: '2026-04-16T12:01:00Z',
									},
								},
							],
				),
		};

		requireAuthedClientMock.mockResolvedValue(client);
		const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

		const program = createProgram();
		await program.parseAsync(['node', 'ghostable', 'env', 'promote', 'pending', '--json']);

		expect(client.listVariablePromotionRequests).toHaveBeenCalledWith('proj_123', 'local', {
			status: 'pending',
		});
		expect(client.listVariablePromotionRequests).toHaveBeenCalledWith('proj_123', 'staging', {
			status: 'pending',
		});
		expect(writeSpy).toHaveBeenCalled();

		writeSpy.mockRestore();
	});

	it('supports guided review with reject decision', async () => {
		selectMock.mockResolvedValueOnce('promo_1').mockResolvedValueOnce('reject');
		inputMock.mockResolvedValueOnce('Needs a better value');

		const request = {
			type: 'environment-variable-promotion-requests',
			id: 'promo_1',
			attributes: {
				source_environment_name: 'local',
				target_environment_name: 'production',
				target_environment_id: 'env_prod',
				status: 'pending',
				entry_count: 1,
				entries: [{ name: 'APP_URL' }],
				include_values: false,
			},
		};

		const client = {
			getEnvironments: vi.fn(async () => [
				{ id: 'env_local', name: 'local', type: 'development' },
				{ id: 'env_prod', name: 'production', type: 'production' },
			]),
			listVariablePromotionRequests: vi
				.fn()
				.mockResolvedValueOnce([request])
				.mockResolvedValueOnce([]),
			rejectVariablePromotionRequest: vi.fn(async () => request),
		};

		requireAuthedClientMock.mockResolvedValue(client);

		const program = createProgram();
		await program.parseAsync(['node', 'ghostable', 'env', 'promote', 'review']);

		expect(client.rejectVariablePromotionRequest).toHaveBeenCalledWith(
			'proj_123',
			'local',
			'promo_1',
			'Needs a better value',
		);
	});

	it('approves with --set overrides and submits signed override payloads', async () => {
		const promotionRequest = {
			type: 'environment-variable-promotion-requests',
			id: 'promo_override',
			attributes: {
				source_environment_name: 'local',
				target_environment_name: 'production',
				target_environment_id: 'env_prod',
				status: 'pending',
				entry_count: 1,
				include_values: true,
				entries: [
					{
						name: 'APP_URL',
						line_bytes: 10,
						is_commented: false,
						has_payload: false,
						source_value_present: false,
					},
				],
			},
		};

		buildSecretPayloadMock.mockResolvedValue({
			name: 'APP_URL',
			env: 'production',
			ciphertext: 'ciphertext',
			nonce: 'nonce',
			alg: 'xchacha20-poly1305',
			aad: {
				org: 'org_123',
				project: 'proj_123',
				env: 'production',
				name: 'APP_URL',
			},
			claims: { hmac: 'hmac' },
			client_sig: 'sig',
		});

		const client = {
			getEnvironments: vi.fn(async () => [
				{ id: 'env_local', name: 'local', type: 'development' },
				{ id: 'env_prod', name: 'production', type: 'production' },
			]),
			listVariablePromotionRequests: vi
				.fn()
				.mockResolvedValueOnce([promotionRequest])
				.mockResolvedValueOnce([]),
			getProject: vi.fn(async () => ({ id: 'proj_123', organizationId: 'org_123' })),
			approveVariablePromotionRequest: vi.fn(async () => ({
				...promotionRequest,
				attributes: {
					...promotionRequest.attributes,
					status: 'approved',
				},
			})),
		};

		requireAuthedClientMock.mockResolvedValue(client);

		const program = createProgram();
		await program.parseAsync([
			'node',
			'ghostable',
			'env',
			'promote',
			'approve',
			'promo_override',
			'--set',
			'APP_URL=https://example.com',
		]);

		expect(buildSecretPayloadMock).toHaveBeenCalledWith(
			expect.objectContaining({
				name: 'APP_URL',
				plaintext: 'https://example.com',
			}),
		);
		expect(client.approveVariablePromotionRequest).toHaveBeenCalledTimes(1);
		const approveCall = client.approveVariablePromotionRequest.mock.calls[0];
		expect(approveCall[0]).toBe('proj_123');
		expect(approveCall[1]).toBe('local');
		expect(approveCall[2]).toBe('promo_override');
		expect(approveCall[3]).toEqual(
			expect.objectContaining({
				device_id: 'device_123',
				entries: [
					expect.objectContaining({
						name: 'APP_URL',
						payload_signing_json: JSON.stringify({
							name: 'APP_URL',
							env: 'production',
							ciphertext: 'ciphertext',
							nonce: 'nonce',
							alg: 'xchacha20-poly1305',
							aad: {
								org: 'org_123',
								project: 'proj_123',
								env: 'production',
								name: 'APP_URL',
							},
							claims: { hmac: 'hmac' },
						}),
					}),
				],
			}),
		);
		expect(inputMock).not.toHaveBeenCalled();
	});
});
