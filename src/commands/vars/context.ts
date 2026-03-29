import { Command } from 'commander';
import { confirm, input, select } from '@inquirer/prompts';

import { config } from '../../config/index.js';
import { SessionService } from '../../services/SessionService.js';
import { EnvironmentVariableContextService } from '../../services/EnvironmentVariableContextService.js';
import { GhostableClient } from '@/ghostable';
import { Manifest } from '../../support/Manifest.js';
import { log } from '../../support/logger.js';
import { toErrorMessage } from '../../support/errors.js';
import { registerVarSubcommand } from './_shared.js';
import { resolveEnvironmentChoice } from '@/support/environment-select.js';
import { promptForMultilineInput, promptWithCancel } from '@/support/prompts.js';
import { formatHistoryActor } from '@/support/history.js';
import { formatDateTimeWithRelative, formatRelativeRecency } from '@/support/dates.js';

type VarContextOptions = {
	env?: string;
	key?: string;
	token?: string;
};

type ContextAction = 'edit-note' | 'add-comment' | 'delete-comment' | 'refresh' | 'done';

function renderIndentedBody(body: string): void {
	const normalized = body.trim().length > 0 ? body : '(empty)';
	for (const line of normalized.split('\n')) {
		log.text(`  ${line}`);
	}
}

function excerpt(value: string, max = 72): string {
	const normalized = value.replace(/\s+/g, ' ').trim();
	if (normalized.length <= max) {
		return normalized || '(empty)';
	}

	return `${normalized.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

function renderSnapshot(params: {
	projectName: string;
	envName: string;
	keyName: string;
	snapshot: Awaited<ReturnType<EnvironmentVariableContextService['fetchContext']>>;
}): void {
	const { projectName, envName, keyName, snapshot } = params;

	log.line();
	log.info(`📘 Variable context for ${projectName}/${envName}/${keyName}`);

	log.line();
	log.info('Note');
	if (!snapshot.note) {
		log.text('  No note has been added for this variable yet.');
	} else {
		renderIndentedBody(snapshot.note.body);

		const noteActor = formatHistoryActor(
			snapshot.note.lastUpdatedBy ?? snapshot.note.createdBy,
		);
		const noteTime = snapshot.note.updatedAt ?? snapshot.note.createdAt;
		if (noteTime) {
			log.text(`  Updated by ${noteActor} · ${formatDateTimeWithRelative(noteTime)}`);
		}
	}

	log.line();
	log.info('Comments');
	if (!snapshot.comments.length) {
		log.text('  No comments yet.');
	} else {
		snapshot.comments.forEach((comment, index) => {
			const actor = formatHistoryActor(comment.createdBy);
			const when = comment.createdAt
				? formatRelativeRecency(comment.createdAt)
				: 'Unknown time';
			log.text(`  ${index + 1}. ${actor} · ${when}`);
			renderIndentedBody(comment.body);
			log.line();
		});
	}
}

async function selectVariableName(
	client: GhostableClient,
	projectId: string,
	envName: string,
): Promise<string> {
	const response = await client.getEnvironmentKeys(projectId, envName);
	if (!response.data.length) {
		throw new Error(`No variables found for environment "${envName}".`);
	}

	return promptWithCancel(() =>
		select<string>({
			message: `Select a variable from ${envName}:`,
			choices: response.data.map((item) => ({
				name: item.version ? `${item.name} (v${item.version})` : item.name,
				value: item.name,
			})),
		}),
	);
}

async function promptAction(opts: {
	canEditNote: boolean;
	canComment: boolean;
	hasDeletableComments: boolean;
}): Promise<ContextAction> {
	return promptWithCancel(() =>
		select<ContextAction>({
			message: 'What would you like to do?',
			default: 'done',
			choices: [
				...(opts.canEditNote ? [{ name: 'Edit note', value: 'edit-note' as const }] : []),
				...(opts.canComment
					? [{ name: 'Add comment', value: 'add-comment' as const }]
					: []),
				...(opts.canComment && opts.hasDeletableComments
					? [{ name: 'Delete one of my comments', value: 'delete-comment' as const }]
					: []),
				{ name: 'Refresh', value: 'refresh' },
				{ name: 'Done', value: 'done' },
			],
		}),
	);
}

async function resolveCommentToDelete(opts: {
	comments: Awaited<ReturnType<EnvironmentVariableContextService['fetchContext']>>['comments'];
	currentUserId: string;
	currentUserEmail: string | null;
}): Promise<string | null> {
	const deletable = opts.comments.filter((comment) => {
		const actorId = comment.createdBy?.id ?? null;
		const actorEmail = comment.createdBy?.email ?? null;

		if (actorId && actorId === opts.currentUserId) {
			return true;
		}

		return Boolean(opts.currentUserEmail && actorEmail === opts.currentUserEmail);
	});

	if (!deletable.length) {
		return null;
	}

	return promptWithCancel(() =>
		select<string>({
			message: 'Select a comment to delete:',
			choices: deletable.map((comment) => ({
				name: `${formatRelativeRecency(comment.createdAt ?? new Date().toISOString())} · ${excerpt(comment.body)}`,
				value: comment.id,
				description: formatHistoryActor(comment.createdBy),
			})),
		}),
	);
}

async function resolveOrganizationId(
	client: GhostableClient,
	projectId: string,
	fallbackOrganizationId?: string,
): Promise<string> {
	if (fallbackOrganizationId?.trim()) {
		return fallbackOrganizationId.trim();
	}

	const project = await client.getProject(projectId);
	if (!project.organizationId) {
		throw new Error('Organization context is required for variable context changes.');
	}

	return project.organizationId;
}

export function registerVarContextCommand(program: Command): void {
	registerVarSubcommand(
		program,
		{
			subcommand: 'context',
		},
		(cmd) =>
			cmd
				.description('View and manage encrypted note/comment context for a single variable')
				.option('--env <ENV>', 'Environment name (prompted if omitted)')
				.option('--key <KEY>', 'Variable name (prompted if omitted)')
				.option('--token <TOKEN>', 'API token (or stored session / GHOSTABLE_TOKEN)')
				.action(async (opts: VarContextOptions) => {
					let projectId: string;
					let projectName: string;
					let envNames: string[];

					try {
						projectId = Manifest.id();
						projectName = Manifest.name();
						envNames = Manifest.environmentNames();
					} catch (error) {
						log.error(toErrorMessage(error));
						process.exit(1);
						return;
					}

					const envName = await resolveEnvironmentChoice(
						envNames,
						opts.env,
						'Select an environment to inspect:',
					);

					const session = await new SessionService().load();
					const token = opts.token?.trim() || process.env.GHOSTABLE_TOKEN?.trim() || '';
					const accessToken = token || session?.accessToken || '';
					if (!accessToken) {
						log.error('❌ Not authenticated. Run `ghostable login`.');
						process.exit(1);
						return;
					}

					const client = GhostableClient.unauthenticated(config.apiBase).withToken(
						accessToken,
					);

					let keyName = opts.key?.trim();
					if (!keyName) {
						try {
							keyName = await selectVariableName(client, projectId, envName);
						} catch (error) {
							log.error(`❌ Failed to load variables: ${toErrorMessage(error)}`);
							process.exit(1);
							return;
						}
					}

					let contextService: EnvironmentVariableContextService;
					try {
						contextService = await EnvironmentVariableContextService.create(client);
					} catch (error) {
						log.error(
							`❌ Failed to initialize variable context: ${toErrorMessage(error)}`,
						);
						process.exit(1);
						return;
					}

					let currentUserId: string | null = null;
					let currentUserEmail: string | null = null;
					try {
						const currentUser = await contextService.currentUser();
						currentUserId = currentUser.id;
						currentUserEmail = currentUser.email;
					} catch {
						currentUserId = null;
						currentUserEmail = null;
					}

					while (true) {
						let snapshot: Awaited<
							ReturnType<EnvironmentVariableContextService['fetchContext']>
						>;
						try {
							snapshot = await contextService.fetchContext({
								projectId,
								envName,
								variable: keyName!,
							});
						} catch (error) {
							log.error(
								`❌ Failed to load variable context: ${toErrorMessage(error)}`,
							);
							process.exit(1);
							return;
						}

						renderSnapshot({
							projectName,
							envName,
							keyName: keyName!,
							snapshot,
						});

						if (!process.stdin.isTTY || !process.stdout.isTTY) {
							return;
						}

						const hasDeletableComments = Boolean(
							currentUserId &&
							snapshot.comments.some((comment) => {
								if (comment.createdBy?.id === currentUserId) {
									return true;
								}

								return Boolean(
									currentUserEmail &&
									comment.createdBy?.email === currentUserEmail,
								);
							}),
						);

						const action = await promptAction({
							canEditNote: snapshot.permissions.editNote,
							canComment: snapshot.permissions.comment,
							hasDeletableComments,
						});

						if (action === 'done') {
							return;
						}

						if (action === 'refresh') {
							continue;
						}

						if (action === 'edit-note') {
							try {
								const nextBody = await promptForMultilineInput({
									message: 'Enter the variable note.',
									initialText: snapshot.note?.body ?? '',
								});

								if (nextBody === null) {
									log.warn('Note canceled.');
									continue;
								}

								if (!snapshot.note && nextBody.trim().length === 0) {
									log.warn('Note canceled.');
									continue;
								}

								if (snapshot.note?.body === nextBody) {
									log.warn('Note unchanged.');
									continue;
								}

								const orgId = await resolveOrganizationId(
									client,
									projectId,
									session?.organizationId,
								);

								await contextService.updateNote({
									projectId,
									envName,
									orgId,
									variable: keyName!,
									plaintext: nextBody,
								});
								log.ok(`✅ Updated note for ${keyName!}.`);
							} catch (error) {
								log.error(`❌ Failed to update note: ${toErrorMessage(error)}`);
							}

							continue;
						}

						if (action === 'add-comment') {
							try {
								const nextBody = (
									await promptWithCancel(() =>
										input({
											message: 'Add a comment',
											default: '',
										}),
									)
								).trim();

								if (!nextBody) {
									log.warn('Comment canceled.');
									continue;
								}

								const orgId = await resolveOrganizationId(
									client,
									projectId,
									session?.organizationId,
								);

								await contextService.addComment({
									projectId,
									envName,
									orgId,
									variable: keyName!,
									plaintext: nextBody,
								});
								log.ok(`✅ Added comment to ${keyName!}.`);
							} catch (error) {
								log.error(`❌ Failed to add comment: ${toErrorMessage(error)}`);
							}

							continue;
						}

						if (action === 'delete-comment') {
							if (!currentUserId) {
								log.warn(
									'Unable to determine the current user for comment deletion.',
								);
								continue;
							}

							try {
								const commentId = await resolveCommentToDelete({
									comments: snapshot.comments,
									currentUserId,
									currentUserEmail,
								});

								if (!commentId) {
									log.warn('No deletable comments were found.');
									continue;
								}

								const confirmed = await promptWithCancel(() =>
									confirm({
										message: 'Delete this comment?',
										default: false,
									}),
								);

								if (!confirmed) {
									log.warn('Deletion canceled.');
									continue;
								}

								await contextService.deleteComment({
									projectId,
									envName,
									variable: keyName!,
									commentId,
								});
								log.ok('✅ Comment deleted.');
							} catch (error) {
								log.error(`❌ Failed to delete comment: ${toErrorMessage(error)}`);
							}
						}
					}
				}),
	);
}
