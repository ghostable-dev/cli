import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';

const runEnvPushMock = vi.hoisted(() => vi.fn());

vi.mock('../src/commands/env-push.js', () => ({
        runEnvPush: runEnvPushMock,
}));

describe('env:sync command', () => {
        beforeEach(() => {
                runEnvPushMock.mockReset();
                runEnvPushMock.mockResolvedValue(undefined);
        });

        it('forces replace flag when delegating to env:push', async () => {
                const program = new Command();
                program.exitOverride();

                const { registerEnvSyncCommand } = await import('../src/commands/env-sync.js');
                registerEnvSyncCommand(program);

                await program.parseAsync(['env:sync', '--env', 'prod'], { from: 'user' });

                expect(runEnvPushMock).toHaveBeenCalledTimes(1);
                expect(runEnvPushMock).toHaveBeenCalledWith(
                        expect.objectContaining({ env: 'prod', replace: true }),
                );
        });
});
