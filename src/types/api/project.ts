import type { EnvironmentJson } from '@/types';

/**
 * Represents a project record returned by Ghostable’s API.
 */
export type ProjectJson = {
	/** Unique identifier for the project (UUID). */
	id: string;

	/** Display name of the project. */
	name: string;

	/** Slug used for URLs or friendly references. */
	slug: string;

	/** Owning organization ID (UUID). */
	organization_id: string;

	/** Deployment provider identifier (enum value as string). */
	deployment_provider: string;

	/** Environments, present only when relation is loaded. */
	environments?: EnvironmentJson[];

	/** ISO 8601 timestamps. */
	created_at: string;
	updated_at: string;
};
