import type { EnvironmentJson } from '@/ghostable/types/environment.js';

/** Domain model for an Environment. Normalizes timestamps. */
export class Environment {
	constructor(
		public readonly id: string,
		public readonly name: string,
		public readonly type: string,
		public readonly createdAt?: Date,
		public readonly updatedAt?: Date,
	) {}

	static fromJSON(json: EnvironmentJson): Environment {
		return new Environment(
			json.id,
			json.name,
			json.type,
			json.created_at ? new Date(json.created_at) : undefined,
			json.updated_at ? new Date(json.updated_at) : undefined,
		);
	}

	/** User-facing label. */
	label(): string {
		return this.name;
	}
}
