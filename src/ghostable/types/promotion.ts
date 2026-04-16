import type { SignedEnvironmentSecretUploadRequest } from './environment.js';

export type EnvironmentVariablePromotionRequestStatus =
	| 'pending'
	| 'approved'
	| 'rejected'
	| 'cancelled';

export type EnvironmentVariablePromotionRequestEntryJson = {
	name: string;
	source_if_version?: number | null;
	line_bytes?: number | null;
	is_commented?: boolean | null;
	source_value_present?: boolean | null;
	has_payload?: boolean | null;
	payload?: SignedEnvironmentSecretUploadRequest | null;
	payload_signing_json?: string | null;
};

export type EnvironmentVariablePromotionRequestAttributesJson = {
	organization_id: string;
	project_id: string;
	source_environment_id: string;
	source_environment_name?: string | null;
	target_environment_id: string;
	target_environment_name?: string | null;
	status: EnvironmentVariablePromotionRequestStatus;
	include_values: boolean;
	target_key_version?: number | null;
	entry_count: number;
	entries: EnvironmentVariablePromotionRequestEntryJson[];
	created_at?: string | null;
	resolved_at?: string | null;
	rejected_reason?: string | null;
	cancel_reason?: string | null;
};

export type EnvironmentVariablePromotionRequestRelatedResourceJson = {
	type?: string;
	id: string;
	attributes?: {
		name?: string | null;
		email?: string | null;
	} | null;
};

export type EnvironmentVariablePromotionRequestRelationshipsJson = {
	requested_by_user?: {
		data?: EnvironmentVariablePromotionRequestRelatedResourceJson | null;
	} | null;
	resolved_by_user?: {
		data?: EnvironmentVariablePromotionRequestRelatedResourceJson | null;
	} | null;
};

export type EnvironmentVariablePromotionRequestResourceJson = {
	type: 'environment-variable-promotion-requests';
	id: string;
	attributes: EnvironmentVariablePromotionRequestAttributesJson;
	relationships?: EnvironmentVariablePromotionRequestRelationshipsJson | null;
};

export type EnvironmentVariablePromotionRequestResponseJson = {
	data: EnvironmentVariablePromotionRequestResourceJson;
	meta?: {
		code?: string | null;
	} | null;
};

export type EnvironmentVariablePromotionRequestListResponseJson = {
	data?: EnvironmentVariablePromotionRequestResourceJson[];
};

export type EnvironmentVariablePromotionPreviewEntryJson = {
	name: string;
};

export type PreviewEnvironmentVariablePromotionRequestJson = {
	target_environment_id: string;
	entries: EnvironmentVariablePromotionPreviewEntryJson[];
};

export type EnvironmentVariablePromotionPreviewDataJson = {
	source_environment_id: string;
	source_environment_name: string;
	target_environment_id: string;
	target_environment_name: string;
	total_entries: number;
	can_view_target_variables: boolean;
	overlap_count?: number;
	updates_count?: number;
	creates_count?: number;
	overlapping_keys?: string[];
};

export type EnvironmentVariablePromotionPreviewResponseJson = {
	data: EnvironmentVariablePromotionPreviewDataJson;
};

export type CreateEnvironmentVariablePromotionRequestEntryJson = {
	name: string;
	source_if_version?: number;
	line_bytes?: number;
	is_commented?: boolean;
	source_value_present?: boolean;
	payload: SignedEnvironmentSecretUploadRequest;
};

export type CreateEnvironmentVariablePromotionRequestJson = {
	device_id: string;
	target_environment_id: string;
	target_key_version?: number;
	include_values: boolean;
	entries: CreateEnvironmentVariablePromotionRequestEntryJson[];
};

export type EnvironmentVariablePromotionReviewOverrideEntryJson = {
	name: string;
	payload: SignedEnvironmentSecretUploadRequest;
	payload_signing_json?: string;
};

export type ApproveEnvironmentVariablePromotionRequestJson = {
	device_id?: string;
	entries?: EnvironmentVariablePromotionReviewOverrideEntryJson[];
};

export type RejectEnvironmentVariablePromotionRequestJson = {
	reason?: string;
};
