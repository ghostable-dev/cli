import { DateTime } from 'luxon';

const DISPLAY_FORMAT = "MMMM d, yyyy 'at' h:mm:ss a ZZZZ";

function coerceToLocalDateTime(input: Date | string): DateTime | null {
	const dateTime =
		input instanceof Date
			? DateTime.fromJSDate(input)
			: DateTime.fromISO(input, { setZone: true });

	return dateTime.isValid ? dateTime.toLocal() : null;
}

/**
 * Formats a timestamp for user-facing output using the local timezone.
 */
export function formatDateTime(input: Date | string): string {
	const dateTime = coerceToLocalDateTime(input);
	return dateTime ? dateTime.toFormat(DISPLAY_FORMAT) : 'Invalid date';
}

/**
 * Formats a timestamp and appends a relative duration (e.g. "in 3 days").
 */
export function formatDateTimeWithRelative(input: Date | string): string {
	const dateTime = coerceToLocalDateTime(input);
	if (!dateTime) {
		return 'Invalid date';
	}

	const formatted = dateTime.toFormat(DISPLAY_FORMAT);
	const relative = dateTime.toRelative({ base: DateTime.local(), unit: 'days', round: true });

	return relative ? `${formatted} (${relative})` : formatted;
}
