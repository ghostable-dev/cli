import type { EnvironmentJson } from '@/types';

/**
 * Domain model for an Environment.
 * Normalizes timestamps and optional baseId.
 */
export class Environment {
	constructor(
		public readonly id: string,
		public readonly name: string,
		public readonly type: string,
		public readonly baseId?: string,
		public readonly createdAt?: Date,
		public readonly updatedAt?: Date,
	) {}

	static fromJSON(json: EnvironmentJson): Environment {
		return new Environment(
			json.id,
			json.name,
			json.type,
			json.base_id ?? undefined,
			json.created_at ? new Date(json.created_at) : undefined,
			json.updated_at ? new Date(json.updated_at) : undefined,
		);
	}

	/** User-facing label. */
	label(): string {
		return this.name;
	}

	/** Returns true if this environment inherits from another. */
	hasBase(): boolean {
		return !!this.baseId;
	}
}
