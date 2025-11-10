import { HttpError } from '../ghostable/http/errors.js';

export function toErrorMessage(error: unknown): string {
	if (error instanceof HttpError) {
		const statusSuffix = error.status ? ` (${error.status})` : '';
		const trimmedBody = error.body?.trim() ?? '';

		if (trimmedBody) {
			try {
				const parsed = JSON.parse(trimmedBody) as {
					message?: unknown;
					errors?: Record<string, unknown>;
				};

				const parts: string[] = [];

				if (typeof parsed.message === 'string' && parsed.message.length) {
					parts.push(parsed.message);
				}

				if (parsed.errors && typeof parsed.errors === 'object') {
					const fieldMessages: string[] = [];

					for (const [field, value] of Object.entries(parsed.errors)) {
						if (typeof value === 'string' && value.trim().length) {
							fieldMessages.push(`${field}: ${value.trim()}`);
						} else if (Array.isArray(value)) {
							const first = value.find(
								(item): item is string =>
									typeof item === 'string' && item.trim().length > 0,
							);
							if (first) {
								fieldMessages.push(`${field}: ${first.trim()}`);
							}
						}

						if (fieldMessages.length >= 3) {
							break;
						}
					}

					if (fieldMessages.length) {
						const hasMore = Object.keys(parsed.errors).length > fieldMessages.length;
						parts.push(`${fieldMessages.join(' | ')}${hasMore ? ' | …' : ''}`);
					}
				}

				if (parts.length) {
					return `${error.message}${statusSuffix}: ${parts.join(' | ')}`;
				}
			} catch {
				// fall through to raw body handling
			}

			return `${error.message}${statusSuffix}: ${trimmedBody}`;
		}

		return `${error.message}${statusSuffix}`;
	}

	if (error instanceof Error) {
		return error.message;
	}

	if (typeof error === 'string') {
		return error;
	}

	try {
		return JSON.stringify(error);
	} catch {
		return String(error);
	}
}
