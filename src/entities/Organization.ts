import type { OrganizationJson } from '@/ghostable/types/organization.js';

/**
 * Domain model for an Organization.
 * Provides normalization and convenience methods.
 */
export class Organization {
	constructor(
		public readonly id: string,
		public readonly name: string,
		public readonly slug: string,
		public readonly createdAt: Date,
		public readonly updatedAt: Date,
	) {}

	static fromJSON(json: OrganizationJson): Organization {
		return new Organization(
			json.id,
			json.name,
			json.slug,
			new Date(json.created_at),
			new Date(json.updated_at),
		);
	}

	/** Returns the display label for this organization. */
	label(): string {
		return this.name;
	}
}
