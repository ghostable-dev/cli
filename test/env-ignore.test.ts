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
let decryptedSecrets: Array<{
	entry: { name: string; meta?: { is_commented?: boolean } };
	value: string;
}> = [];
const sendEnvelopeCalls: Array<{ deviceId: string; envelope: any }> = [];
const writeFileCalls: Array<{ path: string; content: string }> = [];
const copyFileCalls: Array<{ src: string; dest: string }> = [];

const identity = {
	deviceId: 'device-123',
	signingKey: { alg: 'Ed25519', publicKey: 'sign-pub', privateKey: 'sign-priv' },
	encryptionKey: { alg: 'X25519', publicKey: 'enc-pub', privateKey: 'enc-priv' },
};

const encryptedEnvelope = {
	id: 'envelope-1',
	version: 'v1',
	alg: 'XChaCha20-Poly1305+HKDF-SHA256',
	toDevicePublicKey: identity.encryptionKey.publicKey,
	fromEphemeralPublicKey: 'ephemeral-pub',
	nonceB64: Buffer.from('nonce').toString('base64'),
	ciphertextB64: Buffer.from('ciphertext').toString('base64'),
	createdAtIso: new Date('2024-01-01T00:00:00.000Z').toISOString(),
	meta: {},
};

const encryptCalls: Array<{ plaintext: Uint8Array; meta?: Record<string, string> }> = [];

const envelopeEncryptMock = vi.fn(
	async (input: { plaintext: Uint8Array; meta?: Record<string, string> }) => {
		encryptCalls.push(input);
		return encryptedEnvelope;
	},
);

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
	uploadSecret: vi.fn(),
	push: vi.fn(),
	sendEnvelope: vi.fn(async (deviceId: string, envelope: any) => {
		sendEnvelopeCalls.push({ deviceId, envelope });
		return { id: 'envelope-1' };
	}),
};

vi.mock('../src/services/GhostableClient.js', () => ({
	GhostableClient: {
		unauthenticated: vi.fn(() => ({
			withToken: vi.fn(() => client),
		})),
	},
}));

vi.mock('../src/support/deploy-helpers.js', () => ({
	decryptBundle: vi.fn(async () => ({ secrets: decryptedSecrets, warnings: [] })),
}));

vi.mock('../src/support/env-files.js', () => ({
	readEnvFileSafe: vi.fn(() => localEnvVars),
	resolveEnvFile: vi.fn(() => envFilePath),
	readEnvFileSafeWithMetadata: vi.fn(() => ({ vars: localEnvVars, snapshots })),
}));

vi.mock('../src/support/workdir.js', () => ({
	resolveWorkDir: vi.fn(() => '/workdir'),
}));

vi.mock('../src/crypto.js', () => ({
	initSodium: vi.fn(async () => {}),
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
}));

vi.mock('../src/keys.js', () => ({
	loadOrCreateKeys: vi.fn(async () => ({
		masterSeedB64: 'b64:master',
		ed25519PrivB64: 'b64:priv',
	})),
}));

vi.mock('@inquirer/prompts', () => ({
	select: vi.fn(),
}));

vi.mock('../src/services/DeviceIdentityService.js', () => ({
	DeviceIdentityService: {
		create: createDeviceServiceMock,
	},
}));

vi.mock('../src/services/EnvelopeService.js', () => ({
	EnvelopeService: {
		encrypt: envelopeEncryptMock,
	},
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

let registerEnvDiffCommand: typeof import('../src/commands/env-diff.js').registerEnvDiffCommand;
let registerEnvPushCommand: typeof import('../src/commands/env-push.js').registerEnvPushCommand;
let registerEnvPullCommand: typeof import('../src/commands/env-pull.js').registerEnvPullCommand;

beforeAll(async () => {
	({ registerEnvDiffCommand } = await import('../src/commands/env-diff.js'));
	({ registerEnvPushCommand } = await import('../src/commands/env-push.js'));
	({ registerEnvPullCommand } = await import('../src/commands/env-pull.js'));
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
	decryptedSecrets = [];
	writeFileCalls.splice(0, writeFileCalls.length);
	copyFileCalls.splice(0, copyFileCalls.length);
	logOutputs.info.length = 0;
	logOutputs.warn.length = 0;
	logOutputs.error.length = 0;
	logOutputs.ok.length = 0;
	client.pull.mockClear();
	client.uploadSecret.mockClear();
	client.push.mockClear();
	client.sendEnvelope.mockClear();
	sendEnvelopeCalls.splice(0, sendEnvelopeCalls.length);
	encryptCalls.splice(0, encryptCalls.length);
	envelopeEncryptMock.mockClear();
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
});

describe('env:diff ignore behaviour', () => {
	it('hides ignored keys and prints them with --show-ignored', async () => {
		localEnvVars = {
			FOO: 'local-value',
			GHOSTABLE_CI_TOKEN: 'local-token',
			CUSTOM_TOKEN: 'custom-local',
		};
		snapshots = Object.fromEntries(
			Object.entries(localEnvVars).map(([name, value]) => [name, { rawValue: value }]),
		);
		decryptedSecrets = [
			{ entry: { name: 'FOO', meta: {} }, value: 'remote-value' },
			{ entry: { name: 'BAR', meta: {} }, value: 'remote-bar' },
			{ entry: { name: 'CUSTOM_TOKEN', meta: {} }, value: 'remote-custom' },
			{
				entry: { name: 'GHOSTABLE_CI_TOKEN', meta: {} },
				value: 'remote-token',
			},
		];

		const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});

		const program = new Command();
		registerEnvDiffCommand(program);
		await program.parseAsync([
			'node',
			'test',
			'env:diff',
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
		decryptedSecrets = [];

		const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});

		const program = new Command();
		registerEnvDiffCommand(program);
		await program.parseAsync([
			'node',
			'test',
			'env:diff',
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
		localEnvVars = { GHOSTABLE_MASTER_SEED: 'seed' };
		snapshots = { GHOSTABLE_MASTER_SEED: { rawValue: 'seed' } };
		decryptedSecrets = [];

		const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});

		const program = new Command();
		registerEnvDiffCommand(program);
		await program.parseAsync([
			'node',
			'test',
			'env:diff',
			'--env',
			'prod',
			'--token',
			'api-token',
			'--show-ignored',
		]);

		expect(logOutputs.info).toContain('Ignored keys (1): GHOSTABLE_MASTER_SEED');
		const combinedOutput = consoleLog.mock.calls.flat().join(' ');
		expect(combinedOutput).not.toContain('GHOSTABLE_MASTER_SEED');

		consoleLog.mockRestore();
	});
});

describe('env:push ignore behaviour', () => {
	it('skips ignored keys when uploading', async () => {
		localEnvVars = {
			FOO: 'value',
			GHOSTABLE_MASTER_SEED: 'true',
			CUSTOM_TOKEN: 'custom',
		};
		snapshots = {
			FOO: { rawValue: 'value' },
			GHOSTABLE_MASTER_SEED: { rawValue: 'true' },
			CUSTOM_TOKEN: { rawValue: 'custom' },
		};

		const program = new Command();
		registerEnvPushCommand(program);
		await program.parseAsync(['node', 'test', 'env:push', '--env', 'prod', '--assume-yes']);

		expect(envelopeEncryptMock).toHaveBeenCalledTimes(1);
		const [[input]] = envelopeEncryptMock.mock.calls as Array<
			[{ plaintext: Uint8Array; meta?: Record<string, string> }]
		>;
		expect(input).toBeDefined();
		const plaintext = Buffer.from(input.plaintext).toString('utf8');
		expect(plaintext).toBe('FOO=value\n');
		expect(input.meta).toMatchObject({
			project_id: 'project-id',
			environment: 'prod',
			org_id: 'org-1',
			file_path: envFilePath,
		});

		expect(sendEnvelopeCalls).toHaveLength(1);
		expect(sendEnvelopeCalls[0]).toEqual({
			deviceId: identity.deviceId,
			envelope: encryptedEnvelope,
		});
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
			'env:push',
			'--env',
			'prod',
			'--assume-yes',
			'--sync',
		]);

		expect(envelopeEncryptMock).toHaveBeenCalledTimes(1);
		expect(sendEnvelopeCalls).toHaveLength(1);
	});
});

describe('env:pull ignore behaviour', () => {
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
					name: 'GHOSTABLE_MASTER_SEED',
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
			'env:pull',
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
		expect(content).not.toContain('GHOSTABLE_MASTER_SEED');
		expect(content).not.toContain('CUSTOM_TOKEN');
		expect(logOutputs.info).toContain(
			'Ignored keys (3): GHOSTABLE_CI_TOKEN, GHOSTABLE_MASTER_SEED, CUSTOM_TOKEN',
		);
	});
});

describe('env:pull file management', () => {
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
				'env:pull',
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
			'env:pull',
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
			'env:pull',
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
