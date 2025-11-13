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
	const order = buildDependencyAwareOrder(entries);
	const lines = renderEnvLines(entries, format, order);

	if (!lines.length) {
		return '\n';
	}

	return `${lines.join('\n')}\n`;
}

function renderEnvLines(
	entries: EnvRenderEntry[],
	format: EnvFileFormat,
	order: Map<string, number>,
): string[] {
	switch (format) {
		case EnvFileFormat.GROUPED:
			return renderGrouped(entries, order, false);
		case EnvFileFormat.GROUPED_COMMENTS:
			return renderGrouped(entries, order, true);
		case EnvFileFormat.ALPHABETICAL:
		default:
			return renderAlphabetically(entries, order);
	}
}

function renderAlphabetically(entries: EnvRenderEntry[], order: Map<string, number>): string[] {
	return [...entries]
		.sort((a, b) => compareWithDependencyOrder(a.key, b.key, order))
		.map((entry) => formatEnvLine(entry));
}

function renderGrouped(
	entries: EnvRenderEntry[],
	order: Map<string, number>,
	withComments: boolean,
): string[] {
	const groups = new Map<string, EnvRenderEntry[]>();

	for (const entry of entries) {
		const prefix = entry.key.split('_')[0]?.toUpperCase() || entry.key.toUpperCase();
		if (!groups.has(prefix)) {
			groups.set(prefix, []);
		}
		groups.get(prefix)!.push(entry);
	}

	const sortedGroups = Array.from(groups.entries())
		.map(([prefix, groupEntries]) => {
			const sortedEntries = [...groupEntries].sort((a, b) =>
				compareWithDependencyOrder(a.key, b.key, order),
			);
			const orderIndex = Math.min(
				...sortedEntries.map((entry) => order.get(entry.key) ?? Number.MAX_SAFE_INTEGER),
			);
			return { prefix, entries: sortedEntries, orderIndex };
		})
		.sort((a, b) => {
			if (a.orderIndex !== b.orderIndex) {
				return a.orderIndex - b.orderIndex;
			}
			return a.prefix.localeCompare(b.prefix);
		});
	const lines: string[] = [];

	for (const group of sortedGroups) {
		if (withComments) {
			lines.push(`# ${group.prefix}`);
		}

		for (const entry of group.entries) {
			lines.push(formatEnvLine(entry));
		}

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

function compareWithDependencyOrder(
	aKey: string,
	bKey: string,
	order: Map<string, number>,
): number {
	const orderA = order.get(aKey) ?? Number.MAX_SAFE_INTEGER;
	const orderB = order.get(bKey) ?? Number.MAX_SAFE_INTEGER;
	if (orderA !== orderB) {
		return orderA - orderB;
	}
	return aKey.localeCompare(bKey);
}

function buildDependencyAwareOrder(entries: EnvRenderEntry[]): Map<string, number> {
	const keySet = new Set(entries.map((entry) => entry.key));
	const fallbackOrder = new Map<string, number>();
	const graph = new Map<string, Set<string>>();
	const indegree = new Map<string, number>();

	entries.forEach((entry, index) => {
		fallbackOrder.set(entry.key, index);
		graph.set(entry.key, new Set());
		indegree.set(entry.key, 0);
	});

	for (const entry of entries) {
		const dependencies = detectDependencies(entry.value, entry.key, keySet);
		for (const dep of dependencies) {
			graph.get(dep)?.add(entry.key);
			indegree.set(entry.key, (indegree.get(entry.key) ?? 0) + 1);
		}
	}

	const compareKeys = (a: string, b: string) => a.localeCompare(b);
	const available = Array.from(indegree.entries())
		.filter(([, degree]) => degree === 0)
		.map(([key]) => key)
		.sort(compareKeys);
	const ordered = new Map<string, number>();

	const pushOrdered = (key: string) => {
		const orderIndex = ordered.size;
		ordered.set(key, orderIndex);
		for (const dependent of graph.get(key) ?? []) {
			const updated = (indegree.get(dependent) ?? 0) - 1;
			indegree.set(dependent, updated);
			if (updated === 0) {
				available.push(dependent);
				available.sort(compareKeys);
			}
		}
	};

	while (ordered.size < entries.length) {
		let nextKey = available.shift();
		if (!nextKey) {
			// Cycle detected: fall back to original order for remaining keys.
			const remaining = entries
				.map((entry) => entry.key)
				.filter((key) => !ordered.has(key))
				.sort((a, b) => {
					const idxA = fallbackOrder.get(a) ?? 0;
					const idxB = fallbackOrder.get(b) ?? 0;
					if (idxA !== idxB) return idxA - idxB;
					return a.localeCompare(b);
				});
			nextKey = remaining.shift();
		}
		if (!nextKey) break;
		pushOrdered(nextKey);
	}

	return ordered;
}

function detectDependencies(
	value: string,
	currentKey: string,
	candidates: Set<string>,
): Set<string> {
	const deps = new Set<string>();
	const regex = /\$\{([^}]+)\}/g;
	let match: RegExpExecArray | null;

	while ((match = regex.exec(value)) !== null) {
		const inner = match[1];
		const varMatch = inner.match(/^[A-Za-z_][A-Za-z0-9_]*/);
		if (!varMatch) continue;
		const variable = varMatch[0];
		if (variable === currentKey) continue;
		if (candidates.has(variable) && variable !== undefined) {
			deps.add(variable);
		}
	}
	return deps;
}
