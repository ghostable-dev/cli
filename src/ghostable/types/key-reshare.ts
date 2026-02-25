export type KeyReshareRequestStatus = 'pending' | 'completed' | 'cancelled' | 'superseded';

export type KeyReshareRequestRole = 'actor' | 'recipient';

type NamedResource = {
	id: string;
	attributes?: {
		name?: string | null;
		email?: string | null;
		platform?: string | null;
		status?: string | null;
	} | null;
};

export type EnvironmentKeyReshareRequestResourceJson = {
	type: 'environment-key-reshare-requests';
	id: string;
	attributes: {
		organization_id: string;
		project_id: string;
		environment_id: string;
		required_key_version: number;
		target_user_id: string;
		target_device_id: string;
		status: KeyReshareRequestStatus;
		trigger_source?: string | null;
		cancel_reason?: string | null;
		created_at?: string | null;
		resolved_at?: string | null;
		last_notified_at?: string | null;
	};
	relationships?: {
		project?: { data?: NamedResource | null };
		environment?: { data?: NamedResource | null };
		target_user?: { data?: NamedResource | null };
		target_device?: { data?: NamedResource | null };
		resolved_by_user?: { data?: NamedResource | null };
	};
};

export type EnvironmentKeyReshareRequestJson = {
	id: string;
	organizationId: string;
	projectId: string;
	environmentId: string;
	requiredKeyVersion: number;
	targetUserId: string;
	targetDeviceId: string;
	status: KeyReshareRequestStatus;
	triggerSource: string | null;
	cancelReason: string | null;
	createdAtIso: string | null;
	resolvedAtIso: string | null;
	lastNotifiedAtIso: string | null;
	projectName: string | null;
	environmentName: string | null;
	targetUserName: string | null;
	targetUserEmail: string | null;
	targetDeviceName: string | null;
	targetDevicePlatform: string | null;
	targetDeviceStatus: string | null;
	resolvedByUserName: string | null;
	resolvedByUserEmail: string | null;
};

export type EnvironmentKeyReshareRequestListResponseJson = {
	data?: EnvironmentKeyReshareRequestResourceJson[];
	meta?: {
		per_page?: number;
		next_page_url?: string | null;
		prev_page_url?: string | null;
		has_more?: boolean;
	};
};

export type EnvironmentKeyReshareRequestListResponse = {
	data: EnvironmentKeyReshareRequestJson[];
	meta: {
		perPage: number;
		nextPageUrl: string | null;
		prevPageUrl: string | null;
		hasMore: boolean;
	};
};

export type EnvironmentKeyReshareRequestResponseJson = {
	data: EnvironmentKeyReshareRequestResourceJson;
};

export type ListEnvironmentKeyReshareRequestsOptions = {
	role?: KeyReshareRequestRole;
	status?: KeyReshareRequestStatus;
	projectId?: string;
	environmentId?: string;
	deviceId?: string;
	page?: number;
	perPage?: number;
};

const getName = (resource?: NamedResource | null): string | null => {
	const value = resource?.attributes?.name;
	return typeof value === 'string' && value.length > 0 ? value : null;
};

const getEmail = (resource?: NamedResource | null): string | null => {
	const value = resource?.attributes?.email;
	return typeof value === 'string' && value.length > 0 ? value : null;
};

const getPlatform = (resource?: NamedResource | null): string | null => {
	const value = resource?.attributes?.platform;
	return typeof value === 'string' && value.length > 0 ? value : null;
};

const getStatus = (resource?: NamedResource | null): string | null => {
	const value = resource?.attributes?.status;
	return typeof value === 'string' && value.length > 0 ? value : null;
};

export function environmentKeyReshareRequestFromJSON(
	json: EnvironmentKeyReshareRequestResourceJson,
): EnvironmentKeyReshareRequestJson {
	const project = json.relationships?.project?.data ?? null;
	const environment = json.relationships?.environment?.data ?? null;
	const targetUser = json.relationships?.target_user?.data ?? null;
	const targetDevice = json.relationships?.target_device?.data ?? null;
	const resolvedByUser = json.relationships?.resolved_by_user?.data ?? null;

	return {
		id: json.id,
		organizationId: json.attributes.organization_id,
		projectId: json.attributes.project_id,
		environmentId: json.attributes.environment_id,
		requiredKeyVersion: json.attributes.required_key_version,
		targetUserId: json.attributes.target_user_id,
		targetDeviceId: json.attributes.target_device_id,
		status: json.attributes.status,
		triggerSource: json.attributes.trigger_source ?? null,
		cancelReason: json.attributes.cancel_reason ?? null,
		createdAtIso: json.attributes.created_at ?? null,
		resolvedAtIso: json.attributes.resolved_at ?? null,
		lastNotifiedAtIso: json.attributes.last_notified_at ?? null,
		projectName: getName(project),
		environmentName: getName(environment),
		targetUserName: getName(targetUser),
		targetUserEmail: getEmail(targetUser),
		targetDeviceName: getName(targetDevice),
		targetDevicePlatform: getPlatform(targetDevice),
		targetDeviceStatus: getStatus(targetDevice),
		resolvedByUserName: getName(resolvedByUser),
		resolvedByUserEmail: getEmail(resolvedByUser),
	};
}

export function environmentKeyReshareRequestListFromJSON(
	json: EnvironmentKeyReshareRequestListResponseJson,
): EnvironmentKeyReshareRequestListResponse {
	return {
		data: (json.data ?? []).map(environmentKeyReshareRequestFromJSON),
		meta: {
			perPage: json.meta?.per_page ?? 20,
			nextPageUrl: json.meta?.next_page_url ?? null,
			prevPageUrl: json.meta?.prev_page_url ?? null,
			hasMore: json.meta?.has_more ?? false,
		},
	};
}

export function environmentKeyReshareRequestResponseFromJSON(
	json: EnvironmentKeyReshareRequestResponseJson,
): EnvironmentKeyReshareRequestJson {
	return environmentKeyReshareRequestFromJSON(json.data);
}
