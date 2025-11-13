import fs from 'node:fs';
import path from 'node:path';

const ESCAPE_REGEX = /[.*+?^${}()|[\]\\]/g;

function escapeRegExp(value: string): string {
	return value.replace(ESCAPE_REGEX, '\\$&');
}

function lineForDotenv(name: string, value: string, commented = false): string {
	const safe = value.includes('\n') ? JSON.stringify(value) : value;
	return commented ? `# ${name}=${safe}` : `${name}=${safe}`;
}

export function upsertEnvValue(
	filePath: string,
	key: string,
	value: string,
	commented = false,
): void {
	const line = lineForDotenv(key, value, commented);
	let content = '';

	if (fs.existsSync(filePath)) {
		content = fs.readFileSync(filePath, 'utf8');
	}

	const pattern = new RegExp(`^\\s*#?\\s*${escapeRegExp(key)}\\s*=.*$`, 'm');
	if (pattern.test(content)) {
		content = content.replace(pattern, line);
	} else {
		const trimmed = content.replace(/\s*$/, '');
		content = trimmed ? `${trimmed}\n${line}\n` : `${line}\n`;
	}

	if (!content.endsWith('\n')) {
		content += '\n';
	}

	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, content, 'utf8');
}
