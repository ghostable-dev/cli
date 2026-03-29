export type CurrentUserJson = {
	data?: {
		type?: string | null;
		id?: string | null;
		attributes?: {
			name?: string | null;
			email?: string | null;
			created_at?: string | null;
			updated_at?: string | null;
		} | null;
	} | null;
};

export type CurrentUser = {
	id: string;
	type: string | null;
	name: string | null;
	email: string | null;
	createdAt: string | null;
	updatedAt: string | null;
};

export function currentUserFromJSON(json: CurrentUserJson): CurrentUser {
	const data = json.data;
	const attributes = data?.attributes;

	if (!data?.id) {
		throw new Error('Malformed current user response.');
	}

	return {
		id: data.id,
		type: data.type ?? null,
		name: attributes?.name ?? null,
		email: attributes?.email ?? null,
		createdAt: attributes?.created_at ?? null,
		updatedAt: attributes?.updated_at ?? null,
	};
}
