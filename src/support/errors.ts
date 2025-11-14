import { HttpError } from '../ghostable/http/errors.js';

type ApiErrorPayload = {
	message?: unknown;
	detail?: unknown;
	error?: {
		code?: unknown;
		message?: unknown;
		detail?: unknown;
	} | null;
	errors?: Record<string, unknown>;
};

const toMessage = (value: unknown): string | undefined =>
	typeof value === 'string' && value.trim().length ? value.trim() : undefined;

const extractPrimaryDetail = (payload: ApiErrorPayload): string | undefined => {
	const nested =
		payload.error && typeof payload.error === 'object'
			? (payload.error as { detail?: unknown; message?: unknown })
			: undefined;
	return (
		toMessage(payload.detail) ??
		toMessage(payload.message) ??
		(nested ? (toMessage(nested.detail) ?? toMessage(nested.message)) : undefined)
	);
};

const formatAuthErrorMessage = (detail?: string): string => {
	const normalized = detail ?? 'Session expired or not authenticated.';
	return `Authentication failed (401): ${normalized} Run \`ghostable login\` to sign in again.`;
};

export function toErrorMessage(error: unknown): string {
	if (error instanceof HttpError) {
		const statusSuffix = error.status ? ` (${error.status})` : '';
		const trimmedBody = error.body?.trim() ?? '';
		let parsedBody: ApiErrorPayload | undefined;
		let primaryDetail: string | undefined;

		if (trimmedBody) {
			try {
				parsedBody = JSON.parse(trimmedBody) as ApiErrorPayload;
				primaryDetail = extractPrimaryDetail(parsedBody);
			} catch {
				// fall through to raw body handling
			}
		}

		if (error.status === 401) {
			const fallbackDetail =
				primaryDetail ?? (!parsedBody && trimmedBody ? trimmedBody : undefined);
			return formatAuthErrorMessage(fallbackDetail);
		}

		if (parsedBody) {
			const parts: string[] = [];

			if (primaryDetail) {
				parts.push(primaryDetail);
			}

			if (parsedBody.errors && typeof parsedBody.errors === 'object') {
				const fieldMessages: string[] = [];

				for (const [field, value] of Object.entries(parsedBody.errors)) {
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
					const hasMore = Object.keys(parsedBody.errors).length > fieldMessages.length;
					parts.push(`${fieldMessages.join(' | ')}${hasMore ? ' | …' : ''}`);
				}
			}

			if (parts.length) {
				return `${error.message}${statusSuffix}: ${parts.join(' | ')}`;
			}
		}

		if (trimmedBody) {
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
