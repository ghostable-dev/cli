import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

type FakeInterface = {
	setPrompt: ReturnType<typeof vi.fn>;
	prompt: ReturnType<typeof vi.fn>;
	close: ReturnType<typeof vi.fn>;
	on: ReturnType<typeof vi.fn>;
};

const readlineState = vi.hoisted(() => ({
	handlers: new Map<string, Array<(...args: unknown[]) => void>>(),
}));

const createInterfaceMock = vi.hoisted(() =>
	vi.fn((): FakeInterface => {
		readlineState.handlers.clear();

		return {
			setPrompt: vi.fn(),
			prompt: vi.fn(),
			close: vi.fn(() => {
				for (const handler of readlineState.handlers.get('close') ?? []) {
					handler();
				}
			}),
			on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
				const handlers = readlineState.handlers.get(event) ?? [];
				handlers.push(handler);
				readlineState.handlers.set(event, handlers);
			}),
		};
	}),
);

vi.mock('node:readline', () => ({
	default: {
		createInterface: createInterfaceMock,
	},
	createInterface: createInterfaceMock,
}));

const originalStdinIsTTY = process.stdin.isTTY;
const originalStdoutIsTTY = process.stdout.isTTY;

describe('promptForMultilineInput', () => {
	beforeEach(() => {
		readlineState.handlers.clear();
		Object.defineProperty(process.stdin, 'isTTY', {
			value: true,
			configurable: true,
		});
		Object.defineProperty(process.stdout, 'isTTY', {
			value: true,
			configurable: true,
		});
	});

	it('returns multiline input when the user saves explicitly', async () => {
		const { promptForMultilineInput } = await import('@/support/prompts.js');

		const promise = promptForMultilineInput({
			message: 'Enter note',
			initialText: 'Current value',
		});

		for (const handler of readlineState.handlers.get('line') ?? []) {
			handler('first line');
			handler('second line');
			handler('.save');
		}

		await expect(promise).resolves.toBe('first line\nsecond line');
	});

	it('returns null when the user cancels', async () => {
		const { promptForMultilineInput } = await import('@/support/prompts.js');

		const promise = promptForMultilineInput({
			message: 'Enter note',
		});

		for (const handler of readlineState.handlers.get('line') ?? []) {
			handler('.cancel');
		}

		await expect(promise).resolves.toBeNull();
	});
});

afterAll(() => {
	Object.defineProperty(process.stdin, 'isTTY', {
		value: originalStdinIsTTY,
		configurable: true,
	});
	Object.defineProperty(process.stdout, 'isTTY', {
		value: originalStdoutIsTTY,
		configurable: true,
	});
});
