import { DeviceIdentityService } from './DeviceIdentityService.js';

import { EnvironmentKeyService } from '@/environment/keys/EnvironmentKeyService.js';
import type { GhostableClient } from '@/ghostable';
import type {
	CurrentUser,
	VariableContextComment,
	VariableContextEncryptedBodyJson,
	VariableContextNote,
	VariableHistoryEntry,
} from '@/ghostable/types/index.js';
import {
	buildEncryptedVariableContextBody,
	decryptVariableContextBody,
	type VariableContextScope,
} from '@/support/variable-context.js';

export type VariableContextSnapshot = {
	note: (Omit<VariableContextNote, 'body'> & { body: string }) | null;
	comments: Array<Omit<VariableContextComment, 'body'> & { body: string }>;
	permissions: {
		editNote: boolean;
		comment: boolean;
		viewVersionChangeNotes: boolean;
	};
};

export class EnvironmentVariableContextService {
	constructor(
		private readonly client: GhostableClient,
		private readonly deviceIdentityService: DeviceIdentityService,
		private readonly environmentKeyService: EnvironmentKeyService,
	) {}

	static async create(client: GhostableClient): Promise<EnvironmentVariableContextService> {
		const [deviceIdentityService, environmentKeyService] = await Promise.all([
			DeviceIdentityService.create(),
			EnvironmentKeyService.create(),
		]);

		return new EnvironmentVariableContextService(
			client,
			deviceIdentityService,
			environmentKeyService,
		);
	}

	async fetchContext(opts: {
		projectId: string;
		envName: string;
		variable: string;
	}): Promise<VariableContextSnapshot> {
		const identity = await this.deviceIdentityService.requireIdentity();
		const { key } = await this.environmentKeyService.ensureEnvironmentKey({
			client: this.client,
			projectId: opts.projectId,
			envName: opts.envName,
			identity,
		});
		const envelope = await this.client.getVariableContext(
			opts.projectId,
			opts.envName,
			opts.variable,
		);

		return {
			note: envelope.note
				? {
						...envelope.note,
						body: decryptVariableContextBody(envelope.note.body, key),
					}
				: null,
			comments: envelope.comments
				.slice()
				.sort((left, right) => {
					const leftAt = left.createdAt ? Date.parse(left.createdAt) : 0;
					const rightAt = right.createdAt ? Date.parse(right.createdAt) : 0;
					return leftAt - rightAt;
				})
				.map((comment) => ({
					...comment,
					body: decryptVariableContextBody(comment.body, key),
				})),
			permissions: envelope.permissions,
		};
	}

	async updateNote(opts: {
		projectId: string;
		envName: string;
		orgId: string;
		variable: string;
		plaintext: string;
	}): Promise<void> {
		const context = await this.loadWriteContext(opts.projectId, opts.envName);
		const payload = await this.buildPayload({
			orgId: opts.orgId,
			projectId: opts.projectId,
			envName: opts.envName,
			variable: opts.variable,
			plaintext: opts.plaintext,
			scope: 'note',
			keyMaterial: context.keyMaterial,
			signingPrivateKey: context.signingPrivateKey,
		});

		await this.client.updateVariableNote(
			opts.projectId,
			opts.envName,
			opts.variable,
			context.deviceId,
			payload,
		);
	}

	async addComment(opts: {
		projectId: string;
		envName: string;
		orgId: string;
		variable: string;
		plaintext: string;
	}): Promise<void> {
		const context = await this.loadWriteContext(opts.projectId, opts.envName);
		const payload = await this.buildPayload({
			orgId: opts.orgId,
			projectId: opts.projectId,
			envName: opts.envName,
			variable: opts.variable,
			plaintext: opts.plaintext,
			scope: 'comment',
			keyMaterial: context.keyMaterial,
			signingPrivateKey: context.signingPrivateKey,
		});

		await this.client.createVariableComment(
			opts.projectId,
			opts.envName,
			opts.variable,
			context.deviceId,
			payload,
		);
	}

	async deleteComment(opts: {
		projectId: string;
		envName: string;
		variable: string;
		commentId: string;
	}): Promise<void> {
		const identity = await this.deviceIdentityService.requireIdentity();

		await this.client.deleteVariableComment(
			opts.projectId,
			opts.envName,
			opts.variable,
			opts.commentId,
			identity.deviceId,
		);
	}

	async decryptHistoryEntries(opts: {
		projectId: string;
		envName: string;
		entries: VariableHistoryEntry[];
	}): Promise<VariableHistoryEntry[]> {
		const identity = await this.deviceIdentityService.requireIdentity();
		const { key } = await this.environmentKeyService.ensureEnvironmentKey({
			client: this.client,
			projectId: opts.projectId,
			envName: opts.envName,
			identity,
		});

		return opts.entries.map((entry) => ({
			...entry,
			resolvedChangeReason: entry.changeNote
				? decryptVariableContextBody(entry.changeNote.body, key)
				: null,
		}));
	}

	async currentUser(): Promise<CurrentUser> {
		return this.client.currentUser();
	}

	private async loadWriteContext(
		projectId: string,
		envName: string,
	): Promise<{
		deviceId: string;
		signingPrivateKey: Uint8Array;
		keyMaterial: Uint8Array;
	}> {
		const identity = await this.deviceIdentityService.requireIdentity();
		const signingPrivateKey = new Uint8Array(
			Buffer.from(identity.signingKey.privateKey, 'base64'),
		);
		const keyInfo = await this.environmentKeyService.ensureEnvironmentKey({
			client: this.client,
			projectId,
			envName,
			identity,
		});

		if (keyInfo.created) {
			const environments = await this.client.getEnvironments(projectId);
			const environment = environments.find(
				(entry) => entry.name.toLowerCase() === envName.toLowerCase(),
			);

			if (!environment) {
				throw new Error(`Environment "${envName}" was not found for this project.`);
			}

			await this.environmentKeyService.publishKeyEnvelopes({
				client: this.client,
				projectId,
				envId: environment.id,
				envName,
				identity,
				key: keyInfo.key,
				version: keyInfo.version,
				fingerprint: keyInfo.fingerprint,
				created: true,
			});
		}

		return {
			deviceId: identity.deviceId,
			signingPrivateKey,
			keyMaterial: keyInfo.key,
		};
	}

	private async buildPayload(opts: {
		orgId: string;
		projectId: string;
		envName: string;
		variable: string;
		plaintext: string;
		scope: VariableContextScope;
		keyMaterial: Uint8Array;
		signingPrivateKey: Uint8Array;
	}): Promise<VariableContextEncryptedBodyJson> {
		return buildEncryptedVariableContextBody({
			orgId: opts.orgId,
			projectId: opts.projectId,
			environmentName: opts.envName,
			variableName: opts.variable,
			scope: opts.scope,
			plaintext: opts.plaintext,
			keyMaterial: opts.keyMaterial,
			signingPrivateKey: opts.signingPrivateKey,
		});
	}
}
