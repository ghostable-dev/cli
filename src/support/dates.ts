import { DateTime } from 'luxon';

const DISPLAY_FORMAT = "MMMM d, yyyy 'at' h:mm:ss a ZZZZ";
const RELATIVE_FALLBACK_FORMAT = 'LLL d, h:mma';

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

/**
 * Formats a timestamp as "x mins ago", "x hours ago", or an absolute date/time.
 * Designed for audit tables where only recent entries should show relative text.
 */
export function formatRelativeRecency(input: Date | string): string {
	const dateTime = coerceToLocalDateTime(input);
	if (!dateTime) {
		return 'Invalid date';
	}

	const now = DateTime.local();
	const minutesDiff = now.diff(dateTime, 'minutes').minutes;
	const absMinutes = Math.abs(minutesDiff);
	const isPast = minutesDiff >= 0;

	const formatRelative = (value: number, singular: string, plural: string): string => {
		const rounded = Math.max(1, Math.round(value));
		const label = rounded === 1 ? singular : plural;
		return isPast ? `${rounded} ${label} ago` : `in ${rounded} ${label}`;
	};

	if (absMinutes < 60) {
		return formatRelative(absMinutes, 'min', 'mins');
	}

	const absHours = Math.abs(now.diff(dateTime, 'hours').hours);
	if (absHours < 12) {
		return formatRelative(absHours, 'hour', 'hours');
	}

	const timezoneLabel = dateTime.offsetNameShort || dateTime.toFormat('ZZZZ');
	return `${dateTime.toFormat(RELATIVE_FALLBACK_FORMAT)} ${timezoneLabel}`.trim();
}
