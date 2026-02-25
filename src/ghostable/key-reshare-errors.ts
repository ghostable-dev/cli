export type KeyReshareRequiredErrorMeta = {
	pendingRequestIds: string[];
	requiredKeyVersion: number | null;
	organizationId: string | null;
	projectId: string | null;
	environmentId: string | null;
	environmentName: string | null;
};

export class KeyReshareRequiredError extends Error {
	constructor(
		public readonly meta: KeyReshareRequiredErrorMeta,
		message = 'Environment key access requires key re-sharing.',
		public readonly status = 409,
	) {
		super(message);
		this.name = 'KeyReshareRequiredError';
	}

	get pendingRequestIds(): string[] {
		return this.meta.pendingRequestIds;
	}

	get requiredKeyVersion(): number | null {
		return this.meta.requiredKeyVersion;
	}

	get organizationId(): string | null {
		return this.meta.organizationId;
	}

	get projectId(): string | null {
		return this.meta.projectId;
	}

	get environmentId(): string | null {
		return this.meta.environmentId;
	}

	get environmentName(): string | null {
		return this.meta.environmentName;
	}
}
