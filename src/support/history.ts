import type { HistoryActor } from '@/ghostable/types/history.js';

export function formatHistoryActor(actor?: HistoryActor | null): string {
	if (!actor) {
		return 'Unknown actor';
	}

	const parts: string[] = [];
	if (actor.name) {
		parts.push(actor.name);
	}
	if (actor.email) {
		parts.push(`<${actor.email}>`);
	}
	if (parts.length) {
		return parts.join(' ');
	}
	if (actor.email) {
		return actor.email;
	}
	if (actor.id) {
		return actor.id;
	}
	return actor.type || 'Unknown actor';
}
