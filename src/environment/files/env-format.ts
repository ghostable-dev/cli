import type { EnvVarSnapshot } from './env-files.js';

export enum EnvFileFormat {
	ALPHABETICAL = 'alphabetical',
	GROUPED = 'grouped',
	GROUPED_COMMENTS = 'grouped:comments',
}

export type EnvRenderEntry = {
	key: string;
	value: string;
	commented?: boolean;
	snapshot?: EnvVarSnapshot;
};

export type EnvRenderOptions = {
	format?: EnvFileFormat;
};

export function renderEnvFile(entries: EnvRenderEntry[], options: EnvRenderOptions = {}): string {
	const format = options.format ?? EnvFileFormat.ALPHABETICAL;
	const lines = renderEnvLines(entries, format);

	if (!lines.length) {
		return '\n';
	}

	return `${lines.join('\n')}\n`;
}

function renderEnvLines(entries: EnvRenderEntry[], format: EnvFileFormat): string[] {
	switch (format) {
		case EnvFileFormat.GROUPED:
			return renderGrouped(entries, false);
		case EnvFileFormat.GROUPED_COMMENTS:
			return renderGrouped(entries, true);
		case EnvFileFormat.ALPHABETICAL:
		default:
			return renderAlphabetically(entries);
	}
}

function renderAlphabetically(entries: EnvRenderEntry[]): string[] {
	return [...entries]
		.sort((a, b) => a.key.localeCompare(b.key))
		.map((entry) => formatEnvLine(entry));
}

function renderGrouped(entries: EnvRenderEntry[], withComments: boolean): string[] {
	const groups = new Map<string, EnvRenderEntry[]>();

	for (const entry of entries) {
		const prefix = entry.key.split('_')[0]?.toUpperCase() || entry.key.toUpperCase();
		if (!groups.has(prefix)) {
			groups.set(prefix, []);
		}
		groups.get(prefix)!.push(entry);
	}

	const sortedPrefixes = Array.from(groups.keys()).sort((a, b) => a.localeCompare(b));
	const lines: string[] = [];

	for (const prefix of sortedPrefixes) {
		if (withComments) {
			lines.push(`# ${prefix}`);
		}

		const entriesForPrefix = groups.get(prefix)!;
		entriesForPrefix
			.sort((a, b) => a.key.localeCompare(b.key))
			.forEach((entry) => {
				lines.push(formatEnvLine(entry));
			});

		lines.push('');
	}

	while (lines.length && lines[lines.length - 1] === '') {
		lines.pop();
	}

	return lines;
}

function formatEnvLine(entry: EnvRenderEntry): string {
	const rawValue = pickRawValue(entry.value, entry.snapshot);
	const line = `${entry.key}=${rawValue}`;
	return entry.commented ? `# ${line}` : line;
}

function pickRawValue(value: string, snapshot?: EnvVarSnapshot): string {
	if (snapshot && snapshot.value === value) {
		return snapshot.rawValue;
	}

	return value.includes('\n') ? JSON.stringify(value) : value;
}
