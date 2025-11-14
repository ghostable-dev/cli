export function stripDelimiters(value: string | undefined): string | undefined {
	if (!value) return value;

	const trimmed = value.trim();

	if (trimmed.startsWith('<') && trimmed.endsWith('>')) {
		return trimmed.slice(1, -1).trim();
	}

	return trimmed;
}

export function parseNumber(argument: string | undefined): number | undefined {
	if (argument === undefined) return undefined;

	const cleaned = Number(stripDelimiters(argument));
	return Number.isFinite(cleaned) ? cleaned : undefined;
}

export function parseList(argument: string | undefined): string[] {
	const inner = stripDelimiters(argument);
	if (!inner) return [];

	return inner
		.split(',')
		.map((entry) => entry.trim())
		.filter(Boolean);
}

export function buildRegex(argument: string | undefined): RegExp | undefined {
	const inner = stripDelimiters(argument);
	if (!inner) return undefined;

	if (inner.startsWith('/') && inner.lastIndexOf('/') > 0) {
		const lastSlash = inner.lastIndexOf('/');
		const pattern = inner.slice(1, lastSlash);
		const flags = inner.slice(lastSlash + 1);
		try {
			return new RegExp(pattern, flags);
		} catch {
			return undefined;
		}
	}

	try {
		return new RegExp(inner);
	} catch {
		return undefined;
	}
}

export function isNumeric(value: string): boolean {
	if (!value.trim()) return false;
	return !Number.isNaN(Number(value));
}
