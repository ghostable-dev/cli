/**
 * Represents an organization record returned by Ghostable’s API.
 */
export type OrganizationJson = {
	/** Unique identifier for the organization (UUID). */
	id: string;

	/** Display name of the organization. */
	name: string;

	/** Slug used for URLs or friendly references. */
	slug: string;

	/** ISO 8601 timestamps. */
	created_at: string;
	updated_at: string;
};
