import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';

const logOutputs = {
	info: [] as string[],
	warn: [] as string[],
	error: [] as string[],
	ok: [] as string[],
};

let manifestData: any = {};
let manifestEnvs: string[] = ['prod'];
let sessionData: any = { accessToken: 'session-token', organizationId: 'org-1' };
let envFilePath = '/workdir/.env.prod';
let localEnvVars: Record<string, string> = {};
let snapshots: Record<string, { rawValue: string }> = {};
let remoteBundle: any = { chain: ['prod'], secrets: [] };
const writeFileCalls: Array<{ path: string; content: string }> = [];
const copyFileCalls: Array<{ src: string; dest: string }> = [];
const resolveEnvFileMock = vi.fn(() => envFilePath);
const readEnvFileSafeMock = vi.fn(() => localEnvVars);
const readEnvFileSafeWithMetadataMock = vi.fn(() => ({ vars: localEnvVars, snapshots }));

const identity = {
	deviceId: 'device-123',
	signingKey: { alg: 'Ed25519', publicKey: 'sign-pub', privateKey: 'sign-priv' },
	encryptionKey: { alg: 'X25519', publicKey: 'enc-pub', privateKey: 'enc-priv' },
};

const buildSecretPayloadCalls: Array<Record<string, unknown>> = [];

const buildSecretPayloadMock = vi.fn(async (input: Record<string, unknown>) => {
	buildSecretPayloadCalls.push(input);
	return {
		name: input.name,
		env: input.env,
		ciphertext: `cipher-${input.name as string}`,
		nonce: 'nonce',
		alg: 'alg',
		aad: { org: input.org, project: input.project, env: input.env, name: input.name },
		claims: { hmac: 'hmac' },
		client_sig: 'sig',
		env_kek_version: input.envKekVersion,
		env_kek_fingerprint: input.envKekFingerprint,
	};
});

const requireIdentityMock = vi.fn(async () => identity);
const createDeviceServiceMock = vi.fn(async () => ({ requireIdentity: requireIdentityMock }));

const spinner = {
	text: '',
	start: vi.fn(() => spinner),
	succeed: vi.fn(() => spinner),
	fail: vi.fn(() => spinner),
};
const oraMock = vi.fn(() => spinner);

vi.mock('../src/support/logger.js', () => ({
	log: {
		info: vi.fn((msg: string) => logOutputs.info.push(msg)),
		warn: vi.fn((msg: string) => logOutputs.warn.push(msg)),
		error: vi.fn((msg: string) => logOutputs.error.push(msg)),
		ok: vi.fn((msg: string) => logOutputs.ok.push(msg)),
	},
}));

vi.mock('../src/support/Manifest.js', () => ({
	Manifest: {
		id: vi.fn(() => manifestData.id ?? 'project-id'),
		name: vi.fn(() => manifestData.name ?? 'Project'),
		environmentNames: vi.fn(() => manifestEnvs),
		data: vi.fn(() => manifestData),
	},
}));

vi.mock('../src/config/index.js', () => ({
	config: { apiBase: 'https://api.example.com' },
}));

vi.mock('../src/services/SessionService.js', () => ({
	SessionService: class {
		async load() {
			return sessionData;
		}
	},
}));

const client = {
	pull: vi.fn(async () => remoteBundle),
	push: vi.fn(),
	getEnvironmentKey: vi.fn(async () => null),
	createEnvironmentKey: vi.fn(),
	listDevices: vi.fn(async () => []),
	getEnvironments: vi.fn(async () => [{ id: 'env-prod', name: 'prod', type: 'production' }]),
	getProject: vi.fn(async () => ({
		organizationId: 'org-1',
	})),
};

vi.mock('@/ghostable', () => ({
	GhostableClient: {
		unauthenticated: vi.fn(() => ({
			withToken: vi.fn(() => client),
		})),
	},
	HttpError: class extends Error {
		status: number;
		body: string;

		constructor(status: number, body: string, message?: string) {
			super(message ?? `HTTP ${status}`);
			this.status = status;
			this.body = body;
		}
	},
}));

vi.mock('../src/environment/files/env-files.js', () => ({
	readEnvFileSafe: readEnvFileSafeMock,
	resolveEnvFile: resolveEnvFileMock,
	readEnvFileSafeWithMetadata: readEnvFileSafeWithMetadataMock,
}));

vi.mock('../src/support/workdir.js', () => ({
	resolveWorkDir: vi.fn(() => '/workdir'),
}));

const initSodiumMock = vi.hoisted(() => vi.fn(async () => {}));

vi.mock('@/crypto', async () => {
	const actual =
		await vi.importActual<typeof import('../src/crypto/index.js')>('../src/crypto/index.js');
	return {
		...actual,
		initSodium: initSodiumMock,
		deriveKeys: vi.fn(() => ({ encKey: new Uint8Array(), hmacKey: new Uint8Array() })),
		aeadDecrypt: vi.fn((_encKey: Uint8Array, params: { ciphertext: string }) =>
			new TextEncoder().encode(params.ciphertext),
		),
		scopeFromAAD: vi.fn(() => 'scope'),
		aeadEncrypt: vi.fn(() => ({
			ciphertext: 'ciphertext',
			nonce: 'nonce',
			alg: 'alg',
			aad: { org: 'org', project: 'project', env: 'env', name: 'name' },
		})),
		edSign: vi.fn(async () => new Uint8Array()),
		hmacSHA256: vi.fn(() => 'hmac'),
		b64: vi.fn(() => 'encoded'),
	};
});

vi.mock('@inquirer/prompts', () => ({
	select: vi.fn(),
}));

vi.mock('../src/services/DeviceIdentityService.js', () => ({
	DeviceIdentityService: {
		create: createDeviceServiceMock,
	},
}));

const ensureEnvironmentKeyMock = vi.fn(async () => ({
	key: new Uint8Array([1, 2, 3, 4]),
	version: 1,
	fingerprint: 'fingerprint-1',
	created: false,
}));
const publishKeyEnvelopesMock = vi.fn(async () => {});
const createEnvironmentKeyServiceMock = vi.fn(async () => ({
	ensureEnvironmentKey: ensureEnvironmentKeyMock,
	publishKeyEnvelopes: publishKeyEnvelopesMock,
}));

vi.mock('../src/environment/keys/EnvironmentKeyService.js', () => ({
	EnvironmentKeyService: {
		create: createEnvironmentKeyServiceMock,
	},
}));

vi.mock('../src/support/secret-payload.js', () => ({
	buildSecretPayload: buildSecretPayloadMock,
}));

vi.mock('ora', () => ({
	__esModule: true,
	default: oraMock,
}));

const existsSyncMock = vi.fn(() => true);
const writeFileSyncMock = vi.fn((path: string, content: string) => {
	writeFileCalls.push({ path, content });
});
const copyFileSyncMock = vi.fn((src: string, dest: string) => {
	copyFileCalls.push({ src, dest });
});

vi.mock('node:fs', () => ({
	__esModule: true,
	default: {
		existsSync: existsSyncMock,
		writeFileSync: writeFileSyncMock,
		copyFileSync: copyFileSyncMock,
	},
	existsSync: existsSyncMock,
	writeFileSync: writeFileSyncMock,
	copyFileSync: copyFileSyncMock,
}));

vi.mock('../src/support/errors.js', () => ({
	toErrorMessage: (err: unknown) => String(err),
}));

let registerEnvDiffCommand: typeof import('../src/commands/environment/diff.js').registerEnvDiffCommand;
let registerEnvPushCommand: typeof import('../src/commands/environment/push.js').registerEnvPushCommand;
let registerEnvPullCommand: typeof import('../src/commands/environment/pull.js').registerEnvPullCommand;

beforeAll(async () => {
	({ registerEnvDiffCommand } = await import('../src/commands/environment/diff.js'));
	({ registerEnvPushCommand } = await import('../src/commands/environment/push.js'));
	({ registerEnvPullCommand } = await import('../src/commands/environment/pull.js'));
});

beforeEach(() => {
	manifestData = {
		id: 'project-id',
		name: 'Project',
		environments: {
			prod: { ignore: ['CUSTOM_TOKEN'] },
		},
	};
	manifestEnvs = ['prod'];
	sessionData = { accessToken: 'session-token', organizationId: 'org-1' };
	envFilePath = '/workdir/.env.prod';
	localEnvVars = {};
	snapshots = {};
	remoteBundle = { chain: ['prod'], secrets: [] };
	writeFileCalls.splice(0, writeFileCalls.length);
	copyFileCalls.splice(0, copyFileCalls.length);
	logOutputs.info.length = 0;
	logOutputs.warn.length = 0;
	logOutputs.error.length = 0;
	logOutputs.ok.length = 0;
	client.pull.mockClear();
	client.push.mockClear();
	client.getEnvironmentKey.mockClear();
	client.createEnvironmentKey.mockClear();
	client.listDevices.mockClear();
	client.getEnvironments.mockClear();
	buildSecretPayloadCalls.splice(0, buildSecretPayloadCalls.length);
	buildSecretPayloadMock.mockClear();
	ensureEnvironmentKeyMock.mockClear();
	publishKeyEnvelopesMock.mockClear();
	createEnvironmentKeyServiceMock.mockClear();
	createDeviceServiceMock.mockClear();
	requireIdentityMock.mockClear();
	spinner.start.mockClear();
	spinner.succeed.mockClear();
	spinner.fail.mockClear();
	spinner.text = '';
	oraMock.mockClear();
	existsSyncMock.mockClear();
	existsSyncMock.mockReturnValue(true);
	writeFileSyncMock.mockClear();
	copyFileSyncMock.mockClear();
	resolveEnvFileMock.mockClear();
	resolveEnvFileMock.mockImplementation(() => envFilePath);
	readEnvFileSafeMock.mockClear();
	readEnvFileSafeMock.mockImplementation(() => localEnvVars);
	readEnvFileSafeWithMetadataMock.mockClear();
	readEnvFileSafeWithMetadataMock.mockImplementation(() => ({ vars: localEnvVars, snapshots }));
});

describe('env diff ignore behaviour', () => {
	it('warns and reports fallback when env-scoped file is missing', async () => {
		envFilePath = '/workdir/.env';

		const program = new Command();
		registerEnvDiffCommand(program);
		await program.parseAsync([
			'node',
			'test',
			'env',
			'diff',
			'--env',
			'prod',
			'--token',
			'api-token',
		]);

		expect(logOutputs.warn).toContain(
			'⚠️ ".env.prod" not found locally. Falling back to ".env".',
		);
		expect(logOutputs.info).toContain(
			'Comparing local ".env" to remote environment "prod" (fallback used).',
		);
	});

	it('supports --local override for custom env files', async () => {
		envFilePath = '/workdir/.env.local';

		const program = new Command();
		registerEnvDiffCommand(program);
		await program.parseAsync([
			'node',
			'test',
			'env',
			'diff',
			'--env',
			'prod',
			'--token',
			'api-token',
			'--local',
			'.env.local',
		]);

		expect(resolveEnvFileMock).toHaveBeenCalledWith('prod', '.env.local', false);
		expect(logOutputs.info).toContain(
			'Comparing local ".env.local" to remote environment "prod".',
		);
	});

	it('hides ignored keys and prints them with --show-ignored', async () => {
		localEnvVars = {
			FOO: 'local-value',
			GHOSTABLE_CI_TOKEN: 'local-token',
			CUSTOM_TOKEN: 'custom-local',
		};
		snapshots = Object.fromEntries(
			Object.entries(localEnvVars).map(([name, value]) => [name, { rawValue: value }]),
		);
		remoteBundle = {
			chain: ['prod'],
			secrets: [
				{
					env: 'prod',
					name: 'FOO',
					ciphertext: 'remote-value',
					nonce: 'nonce',
					alg: 'xchacha20',
					aad: {},
					meta: {},
				},
				{
					env: 'prod',
					name: 'BAR',
					ciphertext: 'remote-bar',
					nonce: 'nonce',
					alg: 'xchacha20',
					aad: {},
					meta: {},
				},
				{
					env: 'prod',
					name: 'CUSTOM_TOKEN',
					ciphertext: 'remote-custom',
					nonce: 'nonce',
					alg: 'xchacha20',
					aad: {},
					meta: {},
				},
				{
					env: 'prod',
					name: 'GHOSTABLE_CI_TOKEN',
					ciphertext: 'remote-token',
					nonce: 'nonce',
					alg: 'xchacha20',
					aad: {},
					meta: {},
				},
			],
		};

		const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});

		const program = new Command();
		registerEnvDiffCommand(program);
		await program.parseAsync([
			'node',
			'test',
			'env',
			'diff',
			'--env',
			'prod',
			'--token',
			'api-token',
			'--show-ignored',
		]);

		const combinedOutput = consoleLog.mock.calls.flat().join(' ');
		expect(combinedOutput).toContain('FOO');
		expect(combinedOutput).not.toContain('GHOSTABLE_CI_TOKEN');
		expect(combinedOutput).not.toContain('CUSTOM_TOKEN');
		expect(logOutputs.info).toContain('Ignored keys (2): GHOSTABLE_CI_TOKEN, CUSTOM_TOKEN');

		consoleLog.mockRestore();
	});

	it('--only overrides ignore list', async () => {
		localEnvVars = { GHOSTABLE_CI_TOKEN: 'only-token' };
		snapshots = { GHOSTABLE_CI_TOKEN: { rawValue: 'only-token' } };

		const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});

		const program = new Command();
		registerEnvDiffCommand(program);
		await program.parseAsync([
			'node',
			'test',
			'env',
			'diff',
			'--env',
			'prod',
			'--token',
			'api-token',
			'--only',
			'GHOSTABLE_CI_TOKEN',
			'--show-ignored',
		]);

		const combinedOutput = consoleLog.mock.calls.flat().join(' ');
		expect(combinedOutput).toContain('GHOSTABLE_CI_TOKEN');
		expect(logOutputs.info).toContain('Ignored keys (0): none');

		consoleLog.mockRestore();
	});

	it('uses default ignores when manifest omits environment ignore list', async () => {
		manifestData = {
			id: 'project-id',
			name: 'Project',
			environments: {
				prod: {},
			},
		};
		localEnvVars = { GHOSTABLE_DEPLOY_SEED: 'seed' };
		snapshots = { GHOSTABLE_DEPLOY_SEED: { rawValue: 'seed' } };

		const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});

		const program = new Command();
		registerEnvDiffCommand(program);
		await program.parseAsync([
			'node',
			'test',
			'env',
			'diff',
			'--env',
			'prod',
			'--token',
			'api-token',
			'--show-ignored',
		]);

		expect(logOutputs.info).toContain('Ignored keys (1): GHOSTABLE_DEPLOY_SEED');
		const combinedOutput = consoleLog.mock.calls.flat().join(' ');
		expect(combinedOutput).not.toContain('GHOSTABLE_DEPLOY_SEED');

		consoleLog.mockRestore();
	});
});

describe('env push ignore behaviour', () => {
	it('skips ignored keys when uploading', async () => {
		localEnvVars = {
			FOO: 'value',
			GHOSTABLE_DEPLOY_SEED: 'true',
			CUSTOM_TOKEN: 'custom',
		};
		snapshots = {
			FOO: { rawValue: 'value' },
			GHOSTABLE_DEPLOY_SEED: { rawValue: 'true' },
			CUSTOM_TOKEN: { rawValue: 'custom' },
		};

		const program = new Command();
		registerEnvPushCommand(program);
		await program.parseAsync(['node', 'test', 'env', 'push', '--env', 'prod', '--assume-yes']);

		expect(ensureEnvironmentKeyMock).toHaveBeenCalledTimes(1);
		expect(publishKeyEnvelopesMock).not.toHaveBeenCalled();
		expect(buildSecretPayloadMock).toHaveBeenCalledTimes(1);

		const [call] = buildSecretPayloadMock.mock.calls;
		expect(call[0]).toMatchObject({
			name: 'FOO',
			plaintext: 'value',
			envKekVersion: 1,
			envKekFingerprint: 'fingerprint-1',
		});

		expect(client.push).toHaveBeenCalledTimes(1);
		const [args] = client.push.mock.calls;
		expect(args[0]).toBe('project-id');
		expect(args[1]).toBe('prod');
		expect(args[2]).toMatchObject({
			device_id: 'device-123',
			secrets: [
				expect.objectContaining({
					name: 'FOO',
					env: 'prod',
					ciphertext: 'cipher-FOO',
					env_kek_version: 1,
					env_kek_fingerprint: 'fingerprint-1',
				}),
			],
		});
		expect(args[3]).toEqual({ sync: false });
	});

	it('passes sync flag to upload when requested', async () => {
		localEnvVars = {
			FOO: 'value',
		};
		snapshots = {
			FOO: { rawValue: 'value' },
		};

		const program = new Command();
		registerEnvPushCommand(program);
		await program.parseAsync([
			'node',
			'test',
			'env',
			'push',
			'--env',
			'prod',
			'--assume-yes',
			'--sync',
		]);

		expect(buildSecretPayloadMock).toHaveBeenCalledTimes(1);
		expect(client.push).toHaveBeenCalledTimes(1);
		const [args] = client.push.mock.calls;
		expect(args[3]).toEqual({ sync: true });
	});
});

describe('env pull ignore behaviour', () => {
	it('omits ignored keys from written file and reports them', async () => {
		remoteBundle = {
			chain: ['prod'],
			secrets: [
				{
					env: 'prod',
					name: 'FOO',
					ciphertext: 'foo-value',
					nonce: 'nonce',
					alg: 'xchacha20',
					aad: {},
					meta: {},
				},
				{
					env: 'prod',
					name: 'GHOSTABLE_CI_TOKEN',
					ciphertext: 'token-value',
					nonce: 'nonce',
					alg: 'xchacha20',
					aad: {},
					meta: {},
				},
				{
					env: 'prod',
					name: 'CUSTOM_TOKEN',
					ciphertext: 'custom-value',
					nonce: 'nonce',
					alg: 'xchacha20',
					aad: {},
					meta: {},
				},
				{
					env: 'prod',
					name: 'GHOSTABLE_DEPLOY_SEED',
					ciphertext: 'seed',
					nonce: 'nonce',
					alg: 'xchacha20',
					aad: {},
					meta: {},
				},
			],
		};

		const program = new Command();
		registerEnvPullCommand(program);
		await program.parseAsync([
			'node',
			'test',
			'env',
			'pull',
			'--env',
			'prod',
			'--token',
			'api-token',
			'--show-ignored',
		]);

		expect(writeFileCalls).toHaveLength(1);
		const [{ content }] = writeFileCalls;
		expect(content).toContain('FOO=foo-value');
		expect(content).not.toContain('GHOSTABLE_CI_TOKEN');
		expect(content).not.toContain('GHOSTABLE_DEPLOY_SEED');
		expect(content).not.toContain('CUSTOM_TOKEN');
		expect(logOutputs.info).toContain(
			'Ignored keys (3): GHOSTABLE_CI_TOKEN, GHOSTABLE_DEPLOY_SEED, CUSTOM_TOKEN',
		);
	});
});

describe('env pull file management', () => {
	it('merges remote keys into existing file and creates a backup', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2024-01-02T03:04:05.678Z'));

		try {
			localEnvVars = {
				KEEP: 'keep-value',
				UPDATE_ME: 'old',
			};
			snapshots = {
				KEEP: { rawValue: 'keep-value' },
				UPDATE_ME: { rawValue: 'old' },
			};
			remoteBundle = {
				chain: ['prod'],
				secrets: [
					{
						env: 'prod',
						name: 'UPDATE_ME',
						ciphertext: 'new',
						nonce: 'nonce',
						alg: 'xchacha20',
						aad: {},
						meta: {},
					},
					{
						env: 'prod',
						name: 'NEW_KEY',
						ciphertext: 'added',
						nonce: 'nonce',
						alg: 'xchacha20',
						aad: {},
						meta: {},
					},
				],
			};

			const program = new Command();
			registerEnvPullCommand(program);
			await program.parseAsync([
				'node',
				'test',
				'env',
				'pull',
				'--env',
				'prod',
				'--token',
				'api-token',
			]);

			expect(copyFileCalls).toHaveLength(1);
			expect(copyFileCalls[0]).toEqual({
				src: envFilePath,
				dest: '/workdir/.env.prod.bak-2024-01-02T03-04-05.678Z',
			});
			expect(existsSyncMock).toHaveBeenCalledWith(envFilePath);

			expect(writeFileCalls).toHaveLength(1);
			const [{ content }] = writeFileCalls;
			expect(content).toContain('KEEP=keep-value');
			expect(content).toContain('NEW_KEY=added');
			expect(content).toContain('UPDATE_ME=new');

			expect(logOutputs.info).toContain('CREATE 1 | UPDATE 1');
			expect(logOutputs.ok[0]).toContain('Updated /workdir/.env.prod');
		} finally {
			vi.useRealTimers();
		}
	});

	it('honours --replace and reports deletions', async () => {
		localEnvVars = {
			KEEP: 'keep-value',
			REMOVE_ME: 'bye',
		};
		snapshots = {
			KEEP: { rawValue: 'keep-value' },
			REMOVE_ME: { rawValue: 'bye' },
		};
		remoteBundle = {
			chain: ['prod'],
			secrets: [
				{
					env: 'prod',
					name: 'KEEP',
					ciphertext: 'keep-value',
					nonce: 'nonce',
					alg: 'xchacha20',
					aad: {},
					meta: {},
				},
			],
		};

		const program = new Command();
		registerEnvPullCommand(program);
		await program.parseAsync([
			'node',
			'test',
			'env',
			'pull',
			'--env',
			'prod',
			'--token',
			'api-token',
			'--replace',
		]);

		expect(writeFileCalls).toHaveLength(1);
		const [{ content }] = writeFileCalls;
		expect(content).toContain('KEEP=keep-value');
		expect(content).not.toContain('REMOVE_ME');
		expect(logOutputs.info).toContain('CREATE 0 | UPDATE 0 | DELETE 1');
	});

	it('skips backups when --no-backup is provided', async () => {
		localEnvVars = { EXISTING: 'one' };
		snapshots = { EXISTING: { rawValue: 'one' } };
		remoteBundle = {
			chain: ['prod'],
			secrets: [
				{
					env: 'prod',
					name: 'EXISTING',
					ciphertext: 'two',
					nonce: 'nonce',
					alg: 'xchacha20',
					aad: {},
					meta: {},
				},
			],
		};

		const program = new Command();
		registerEnvPullCommand(program);
		await program.parseAsync([
			'node',
			'test',
			'env',
			'pull',
			'--env',
			'prod',
			'--token',
			'api-token',
			'--no-backup',
		]);

		expect(copyFileCalls).toHaveLength(0);
		expect(writeFileCalls).toHaveLength(1);
	});
});
