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
let decryptedSecrets: Array<{ entry: { name: string; meta?: { is_commented?: boolean } }; value: string }> = [];
const uploadPayloads: any[] = [];
const writeFileCalls: Array<{ path: string; content: string }> = [];

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
        uploadSecret: vi.fn(async (_projectId: string, _env: string, payload: any) => {
                uploadPayloads.push(payload);
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

vi.mock('../src/support/secret-payload.js', () => ({
        buildSecretPayload: vi.fn(async ({ name, plaintext }: { name: string; plaintext: string }) => ({
                name,
                plaintext,
        })),
}));

vi.mock('../src/crypto.js', () => ({
        initSodium: vi.fn(async () => {}),
        deriveKeys: vi.fn(() => ({ encKey: new Uint8Array(), hmacKey: new Uint8Array() })),
        aeadDecrypt: vi.fn((_encKey: Uint8Array, params: { ciphertext: string }) =>
                new TextEncoder().encode(params.ciphertext),
        ),
        scopeFromAAD: vi.fn(() => 'scope'),
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

class MockListr<TContext> {
        private readonly tasks: Array<{ title: string; task: (ctx: TContext, task: { title: string }) => Promise<void> | void }>;

        constructor(tasks: Array<{ title: string; task: (ctx: TContext, task: { title: string }) => Promise<void> | void }>) {
                this.tasks = tasks;
        }

        async run(): Promise<void> {
                for (const item of this.tasks) {
                        const task = { title: item.title };
                        await item.task({} as TContext, task);
                }
        }
}

vi.mock('listr2', () => ({
        Listr: MockListr,
}));

const existsSyncMock = vi.fn(() => true);
const writeFileSyncMock = vi.fn((path: string, content: string) => {
        writeFileCalls.push({ path, content });
});

vi.mock('node:fs', () => ({
        __esModule: true,
        default: {
                existsSync: existsSyncMock,
                writeFileSync: writeFileSyncMock,
        },
        existsSync: existsSyncMock,
        writeFileSync: writeFileSyncMock,
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
        uploadPayloads.splice(0, uploadPayloads.length);
        writeFileCalls.splice(0, writeFileCalls.length);
        logOutputs.info.length = 0;
        logOutputs.warn.length = 0;
        logOutputs.error.length = 0;
        logOutputs.ok.length = 0;
        client.pull.mockClear();
        client.uploadSecret.mockClear();
        existsSyncMock.mockClear();
        existsSyncMock.mockReturnValue(true);
        writeFileSyncMock.mockClear();
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
                        { entry: { name: 'GHOSTABLE_CI_TOKEN', meta: {} }, value: 'remote-token' },
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
                await program.parseAsync([
                        'node',
                        'test',
                        'env:push',
                        '--env',
                        'prod',
                        '--assume-yes',
                ]);

                const uploadedNames = uploadPayloads.map((payload) => payload.name);
                expect(uploadedNames).toEqual(['FOO']);
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
                expect(logOutputs.info).toContain('Ignored keys (3): GHOSTABLE_CI_TOKEN, GHOSTABLE_MASTER_SEED, CUSTOM_TOKEN');
        });
});
