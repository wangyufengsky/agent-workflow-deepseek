import { AppError, ErrorCode, nowIso, type ActionAvailability, type CommandResponse, type KnowledgeConversation, type KnowledgeConversationCommand, type KnowledgeHistoryEntry, type RuntimeInteraction } from '@agent-workflow/shared';
import type { Store } from '@agent-workflow/storage';
import { CommandService } from './operations.ts';
interface Metadata { readonly id: string; readonly projectId: string; readonly title: string; readonly revision: number; readonly createdAt: string; readonly updatedAt: string; readonly archivedAt?: string; readonly requestKeys: readonly string[] }
const indexKey = (projectId: string) => `knowledge.conversations.${projectId}`;
const metaKey = (id: string) => `knowledge.conversation.${id}`;
const allowed = (): ActionAvailability => ({ allowed: true });
const denied = (reason: string): ActionAvailability => ({ allowed: false, reasonCode: ErrorCode.OPERATION_IN_PROGRESS, reason });
const operationFor = { rename: 'knowledge.conversation.rename', archive: 'knowledge.conversation.archive', restore: 'knowledge.conversation.restore' } as const;

/** Names/archive are independent metadata; original messages and citations never change. */
export class KnowledgeConversationService {
  readonly #store: Store; readonly #commands: CommandService;
  readonly #history: (projectId: string) => readonly KnowledgeHistoryEntry[];
  readonly #askAvailability: () => ActionAvailability;
  constructor(store: Store, commands: CommandService, history: (projectId: string) => readonly KnowledgeHistoryEntry[], askAvailability: () => ActionAvailability) { this.#store = store; this.#commands = commands; this.#history = history; this.#askAvailability = askAvailability; }
  #metadata(projectId: string, id: string, entries: readonly KnowledgeHistoryEntry[]): Metadata {
    const saved = this.#store.settings.getJson<Metadata>(metaKey(id));
    if (saved !== undefined) { if (saved.projectId !== projectId) throw new AppError(ErrorCode.NOT_FOUND, '对话不存在'); return saved; }
    const messages = entries.filter((entry) => entry.conversationId === id).sort((a,b) => a.generatedAt.localeCompare(b.generatedAt));
    const first = messages[0]; if (!first) throw new AppError(ErrorCode.NOT_FOUND, '对话不存在');
    return { id, projectId, title: first.question.slice(0, 100), revision: 1, createdAt: first.generatedAt, updatedAt: messages.at(-1)!.generatedAt, requestKeys: messages.flatMap((entry) => entry.requestKey === undefined ? [] : [entry.requestKey]) };
  }
  #save(metadata: Metadata) { this.#store.settings.putJson(metaKey(metadata.id), metadata); const ids = this.#store.settings.getJson<string[]>(indexKey(metadata.projectId)) ?? []; if (!ids.includes(metadata.id)) this.#store.settings.putJson(indexKey(metadata.projectId), [...ids, metadata.id]); }
  register(projectId: string, id: string, question: string, requestKey: string): void {
    const now = nowIso(); const saved = this.#store.settings.getJson<Metadata>(metaKey(id));
    const legacy = saved === undefined ? this.#history(projectId) : [];
    const metadata = saved ?? (legacy.some((entry) => entry.conversationId === id) ? this.#metadata(projectId, id, legacy) : { id, projectId, title: question.slice(0, 100), revision: 1, createdAt: now, updatedAt: now, requestKeys: [] });
    if (metadata.projectId !== projectId) throw new AppError(ErrorCode.NOT_FOUND, '对话不存在');
    if (metadata.archivedAt !== undefined) throw new AppError(ErrorCode.FORBIDDEN, '对话已归档，请先恢复再继续追问');
    this.#save({ ...metadata, updatedAt: now, requestKeys: [...new Set([...metadata.requestKeys, requestKey])] });
  }
  requestKeys(projectId: string): readonly string[] { return (this.#store.settings.getJson<string[]>(indexKey(projectId)) ?? []).flatMap((id) => this.#store.settings.getJson<Metadata>(metaKey(id))?.requestKeys ?? []); }
  assertFollowUp(projectId: string, id: string): void { const metadata = this.#metadata(projectId, id, this.#history(projectId)); if (metadata.archivedAt !== undefined) throw new AppError(ErrorCode.FORBIDDEN, '对话已归档，请先恢复再继续追问'); }
  list(projectId: string, entries = this.#history(projectId)): readonly KnowledgeConversation[] {
    if (!this.#store.projects.get(projectId)) throw new AppError(ErrorCode.NOT_FOUND, '项目不存在');
    const ids = new Set([...(this.#store.settings.getJson<string[]>(indexKey(projectId)) ?? []), ...entries.map((entry) => entry.conversationId)]);
    return [...ids].map((id) => this.get(projectId, id, entries)).sort((a,b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  get(projectId: string, id: string, entries = this.#history(projectId)): KnowledgeConversation {
    if (!this.#store.projects.get(projectId)) throw new AppError(ErrorCode.NOT_FOUND, '项目不存在');
    const metadata = this.#metadata(projectId, id, entries);
    const messages = entries.filter((entry) => entry.conversationId === id).sort((a,b) => b.generatedAt.localeCompare(a.generatedAt));
    const latest = messages[0];
    const pending = (this.#store.settings.getJson<readonly RuntimeInteraction[]>('runtime.interactions') ?? []).filter((item) => item.binding.projectId === projectId && item.binding.conversationId === id && item.binding.knowledgeRequestKey === latest?.requestKey && item.kind === 'question' && item.state !== 'resolved' && ['researching','answering','needs_answer','unknown'].includes(latest?.runStatus ?? ''));
    const state = latest?.runStatus === 'unknown' ? 'unknown' : pending.some((item) => item.state === 'unknown') ? 'unknown' : pending.length > 0 ? 'needs_answer' : latest?.runStatus ?? (latest === undefined ? 'unknown' : 'completed');
    const running = ['researching','answering','stopping','unknown','needs_answer'].includes(state);
    const archived = metadata.archivedAt !== undefined;
    return { id, projectId, title: metadata.title, revision: metadata.revision, createdAt: metadata.createdAt, updatedAt: [metadata.updatedAt, latest?.generatedAt ?? ''].sort().at(-1)!, ...(metadata.archivedAt === undefined ? {} : { archivedAt: metadata.archivedAt }), state, messageCount: messages.length, latest, pendingInteractionIds: pending.map((item) => item.id), actions: { rename: allowed(), archive: archived ? denied('对话已归档') : running ? denied('先回答、停止或核对当前问答，再归档对话') : allowed(), restore: archived ? allowed() : denied('对话尚未归档'), followUp: archived ? denied('对话已归档，请先恢复') : running ? denied('当前问答尚未结束，请回答或核对原请求') : latest?.readability === 'forbidden' ? denied(latest.unavailableReason ?? '对话来源许可已撤回') : this.#askAvailability() } };
  }
  update(id: string, action: keyof typeof operationFor, input: KnowledgeConversationCommand): CommandResponse<KnowledgeConversation> {
    const operation = operationFor[action]; const body = { id, projectId: input.projectId, expectedRevision: input.expectedRevision, confirm: input.confirm, ...(action === 'rename' ? { title: input.title } : {}) };
    const replay = this.#commands.replay({ requestKey: input.requestKey, operation, body }, () => this.get(input.projectId, id)); if (replay !== undefined) return replay;
    const entries = this.#history(input.projectId); const current = this.get(input.projectId, id, entries);
    if (input.confirm !== true || !Number.isInteger(input.expectedRevision)) throw new AppError(ErrorCode.VALIDATION_FAILED, '对话操作需要确认当前版本');
    if (current.revision !== input.expectedRevision) throw new AppError(ErrorCode.STALE_TARGET, '对话元数据已变化，请重新读取');
    const availability = current.actions[action]; if (!availability.allowed) throw new AppError(ErrorCode.OPERATION_IN_PROGRESS, availability.reason ?? '当前不能修改对话');
    const title = action === 'rename' && typeof input.title === 'string' ? input.title.trim() : undefined;
    if (action === 'rename' && (title === undefined || title.length < 1 || title.length > 100)) throw new AppError(ErrorCode.VALIDATION_FAILED, '对话标题需要在1–100字之间');
    const { record, replayed } = this.#commands.begin({ requestKey: input.requestKey, operation, body, target: { projectId: input.projectId } }); if (replayed) return { receipt: this.#commands.toReceipt(record) };
    const prior = this.#metadata(input.projectId, id, entries); const timestamp = nowIso();
    const metadata: Metadata = { ...prior, revision: prior.revision + 1, updatedAt: timestamp, ...(action === 'rename' ? { title: title! } : { archivedAt: action === 'archive' ? timestamp : undefined }) };
    this.#store.transaction(() => { this.#save(metadata); this.#store.settings.putJson(`knowledge.conversation.applied.${input.requestKey}`, { id, projectId: input.projectId, revision: metadata.revision }); this.#commands.settle(input.requestKey, { conversationId: id, revision: metadata.revision }); });
    return { receipt: this.#commands.toReceipt(this.#commands.get(input.requestKey)!), resource: this.get(input.projectId, id) };
  }
  reconcileOperation(key: string): void {
    const operation = this.#commands.get(key); if (!operation || !Object.values(operationFor).some((value) => value === operation.operation) || !['accepted','unknown'].includes(operation.status)) return;
    const applied = this.#store.settings.getJson<{ id: string; projectId: string; revision: number }>(`knowledge.conversation.applied.${key}`);
    if (applied !== undefined && this.#store.settings.getJson<Metadata>(metaKey(applied.id))?.projectId === applied.projectId) this.#commands.settle(key, { conversationId: applied.id, revision: applied.revision });
    else this.#commands.fail(key, new AppError(ErrorCode.INTERNAL_ERROR, '元数据操作未提交；原请求已核对，不会自动重做'));
  }
}
