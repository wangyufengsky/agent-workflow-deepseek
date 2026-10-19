import { KnowledgeInputs, type KnowledgeInputSnapshot } from './knowledge-inputs.ts';
import {
  AppError,
  ErrorCode,
  createId,
  nowIso,
  type CommandResponse,
  type KnowledgeAskRequest,
  type ActionAvailability,
  type KnowledgeAskResponse,
  type KnowledgeRunProgress,
  type KnowledgeStopRequest,
  type KnowledgeHistoryEntry,
  type KnowledgeHistoryResponse,
  type KnowledgeStep,
  type KnowledgeToolActivity,
  type ModelProfile,
  type RoleDefinition,
  type KnowledgeRoleEvidence,
} from '@agent-workflow/shared';
import type { Store } from '@agent-workflow/storage';
import type { EngineContext } from './actions.ts';
import type { CommandService } from './operations.ts';
import type { OpenCodePort, DatabasePort, PublicSearchPort } from './ports.ts';
import type { OpenCodeMessage, OpenCodePart } from '@agent-workflow/opencode';
import { listKnowledgeSources, readKnowledgeSource } from '../../server/src/knowledge.ts';
import { roleModel } from './role-runtime.ts';
import { partialKnowledgeAnswer } from './knowledge-stream.ts';
import { usageFromMessages } from './token-usage.ts';

const MAX_SOURCES = 200;
const MAX_DOC_CHARS = 6_000;
const MAX_CONTEXT_CHARS = 96_000;

export interface KnowledgeServiceOptions {
  readonly store: Store;
  readonly commands: CommandService;
  readonly context: EngineContext;
  readonly opencode: OpenCodePort;
  readonly database?: DatabasePort;
  readonly publicSearch?: PublicSearchPort;
  readonly roles?: () => readonly RoleDefinition[];
}

/** Read-only document Q&A with durable command receipts and frozen source selection. */
export class KnowledgeService {
  readonly #store: Store;
  readonly #commands: CommandService;
  readonly #context: EngineContext;
  readonly #opencode: OpenCodePort;
  readonly inputs: KnowledgeInputs;
  readonly #active = new Set<string>();
  readonly #roles: () => readonly RoleDefinition[];

  constructor(options: KnowledgeServiceOptions) {
    this.inputs = new KnowledgeInputs(options.store, options.commands, options.context, options.database, options.publicSearch);
    this.#store = options.store;
    this.#commands = options.commands;
    this.#context = options.context;
    this.#opencode = options.opencode;
    this.#roles = options.roles ?? (() => []);
  }

  askAvailability(): ActionAvailability {
    if (!this.#context.opencodeReady()) return { allowed: false, reasonCode: ErrorCode.OPENCODE_NOT_READY, reason: '运行环境尚未就绪，请先启动受管 OpenCode。' };
    try {
      const role = this.#roles().find((item) => item.id === 'role.reviewer');
      if (role === undefined) this.#model(); else roleModel(role, this.#context.settings().models);
      return { allowed: true };
    } catch (error) { return { allowed: false, reasonCode: ErrorCode.MODEL_NOT_CONFIGURED, reason: error instanceof Error ? error.message : '问答模型尚未配置' }; }
  }

  async ask(input: KnowledgeAskRequest): Promise<CommandResponse<KnowledgeAskResponse>> {
    if (input === null || typeof input !== 'object') throw new AppError(ErrorCode.VALIDATION_FAILED, '知识库请求体不合法');
    if (input.networkSearch !== undefined && typeof input.networkSearch !== 'boolean') throw new AppError(ErrorCode.VALIDATION_FAILED, '网络检索选择必须为布尔值');
    if (input.modelId !== undefined && (typeof input.modelId !== 'string' || input.modelId.length > 120)) throw new AppError(ErrorCode.VALIDATION_FAILED, '模型ID不合法');
    const question = typeof input.question === 'string' ? input.question.trim() : '';
    if (question.length < 2 || question.length > 2_000) throw new AppError(ErrorCode.VALIDATION_FAILED, '问题长度需要在 2–2000 字之间');
    const project = this.#store.projects.get(input.projectId);
    if (project === undefined) throw new AppError(ErrorCode.NOT_FOUND, '项目不存在');
    const requestedConversationId = typeof input.conversationId === 'string' && input.conversationId.trim() !== ''
      ? input.conversationId.trim().slice(0, 64)
      : undefined;
    if (input.sourcePaths !== undefined && (!Array.isArray(input.sourcePaths) || input.sourcePaths.length > MAX_SOURCES || input.sourcePaths.some((path) => typeof path !== 'string' || path.trim() === ''))) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, '请选择最多 200 份资料来源');
    }
    const sourcePaths = input.sourcePaths === undefined ? undefined : [...new Set(input.sourcePaths)].sort();
    // Hash only caller input. A generated conversation ID must not change the
    // identity of a replayed first question.
    const { record, replayed } = this.#commands.begin({
      requestKey: input.requestKey,
      operation: 'knowledge.ask',
      body: { projectId: input.projectId, question, conversationId: requestedConversationId, sourcePaths, continueFromRequestKey: input.continueFromRequestKey, modelId: input.modelId, networkSearch: input.networkSearch },
      target: { projectId: input.projectId },
    });
    if (replayed) {
      const resource = record.status === 'succeeded' ? this.result(input.requestKey, input.projectId) : undefined;
      return { receipt: this.#commands.toReceipt(record), ...(resource === undefined ? {} : { resource }) };
    }
    try {
      const previous = input.continueFromRequestKey === undefined ? undefined : this.result(input.continueFromRequestKey, input.projectId);
      if (previous !== undefined && (previous.status !== 'stopped' || previous.conversationId !== requestedConversationId)) {
        throw new AppError(ErrorCode.VALIDATION_FAILED, '只能继续当前对话中已确认停止的回答');
      }
      if (requestedConversationId !== undefined) {
        const owner = this.#store.settings.getJson<string>(`knowledge.project.${requestedConversationId}`);
        if (owner === undefined && !(this.#store.settings.getJson<KnowledgeHistoryEntry[]>(historyKey(input.projectId)) ?? []).some((entry) => entry.conversationId === requestedConversationId)) throw new AppError(ErrorCode.NOT_FOUND, '对话不存在，请新建对话');
        if (owner !== undefined && owner !== input.projectId) throw new AppError(ErrorCode.VALIDATION_FAILED, '已有会话不可更换项目');
        const outstandingKey = this.#store.settings.getJson<string>(`knowledge.pending.${requestedConversationId}`);
        const status = outstandingKey === undefined ? undefined : this.#commands.get(outstandingKey)?.status;
        if (status === 'accepted' || status === 'unknown') throw new AppError(ErrorCode.OPERATION_IN_PROGRESS, `当前对话还有未完成问答，请核对原请求 ${outstandingKey}`);
      }
      const frozenInput = input.continueFromRequestKey === undefined ? undefined : this.#store.settings.getJson<KnowledgeInputSnapshot>(`knowledge.input.${input.continueFromRequestKey}`);
      if (input.continueFromRequestKey !== undefined && frozenInput === undefined) throw new AppError(ErrorCode.NOT_RETAINED, '原回答未保留来源内容快照，无法安全继续；请新建问答');
      const role = frozenInput?.role ?? (requestedConversationId === undefined ? this.#roles().find((item) => item.id === 'role.reviewer') : this.#store.settings.getJson<RoleDefinition>(`knowledge.role.${requestedConversationId}`));
      const savedModel = requestedConversationId === undefined ? undefined : this.#store.settings.getJson<ModelProfile>(`knowledge.model.${requestedConversationId}`);
      if (savedModel !== undefined && input.modelId !== undefined && input.modelId !== savedModel.id) throw new AppError(ErrorCode.VALIDATION_FAILED, '已有会话不可更换模型，请新建对话');
      const requestedModel = input.modelId === undefined ? undefined : this.#context.settings().models.find((item) => item.id === input.modelId && item.enabled);
      if (input.modelId !== undefined && requestedModel === undefined && savedModel === undefined) throw new AppError(ErrorCode.MODEL_NOT_CONFIGURED, '所选模型不可用');
      const model = frozenInput?.model ?? savedModel ?? requestedModel ?? (role === undefined ? this.#model() : roleModel(role, this.#context.settings().models));
      if (this.#context.opencodeReady() !== true) throw new AppError(ErrorCode.OPENCODE_NOT_READY, '受管 OpenCode 未就绪，无法问答');
      const retrieveStartedAt = nowIso(); const retrieveStartedMs = Date.now();
      const selectedPaths = frozenInput?.selectedPaths ?? sourcePaths ?? this.inputs.inventory(input.projectId).map((source) => source.path);
      const networkSearch = frozenInput?.networkSearch ?? input.networkSearch ?? false;
      if (selectedPaths.length === 0 && !networkSearch) throw new AppError(ErrorCode.CAPABILITY_UNAVAILABLE, '请选择原资料或开启独立网络检索');
      const conversationId = requestedConversationId ?? createId('conversation');
      this.#store.settings.putJson(`knowledge.model.${conversationId}`, model);
      if (role !== undefined) this.#store.settings.putJson(`knowledge.role.${conversationId}`, role);
      this.#store.settings.putJson(`knowledge.project.${conversationId}`, input.projectId);
      this.#store.settings.putJson(`knowledge.pending.${conversationId}`, input.requestKey);
      const conversationVersion = (this.#store.settings.getJson<number>(`knowledge.version.${conversationId}`) ?? 0) + 1;
      this.#store.settings.putJson(`knowledge.version.${conversationId}`, conversationVersion);
      const roleEvidence: KnowledgeRoleEvidence = { executionRole: { id: 'knowledge.researcher', label: '知识研究员（只读）' },
        ...(role === undefined ? {} : { profession: { id: role.id, name: role.name, revision: role.revision }, ...(role.image === undefined ? {} : { appearance: structuredClone(role.image) }) }),
        conversationVersion, messageVersion: 1, requestKey: input.requestKey };
      this.#saveProgress({ requestKey: input.requestKey, projectId: input.projectId, question, conversationId, model: `${model.provider}/${model.model}`, status: 'researching', startedAt: nowIso(), updatedAt: nowIso(), answer: '', sources: { selectedPaths, readPaths: [], truncatedPaths: [], networkSearch }, roleEvidence });
      const runKeys = this.#store.settings.getJson<string[]>(`knowledge.runs.${input.projectId}`) ?? [];
      this.#store.settings.putJson(`knowledge.runs.${input.projectId}`, [input.requestKey, ...runKeys].slice(0, 200));
      this.#active.add(input.requestKey);
      const collected = frozenInput ?? await this.inputs.collect(input.projectId, selectedPaths, networkSearch, question);
      const retrievalProgress = this.progress(input.requestKey, input.projectId);
      if (retrievalProgress.status === 'stopped') return { receipt: this.#commands.toReceipt(this.#commands.get(input.requestKey)!), resource: this.result(input.requestKey, input.projectId) };
      const { documents, truncatedPaths } = collected;
      const snapshot: KnowledgeInputSnapshot = { documents, selectedPaths, truncatedPaths, model, ...(role === undefined ? {} : { role: structuredClone(role) }), networkSearch, frozenAt: frozenInput?.frozenAt ?? nowIso() };
      this.inputs.assertCurrent(input.projectId, snapshot);
      if (documents.length === 0) throw new AppError(ErrorCode.CAPABILITY_UNAVAILABLE, '所选资料或公共检索没有可读取的内容');
      this.#store.settings.putJson(`knowledge.input.${input.requestKey}`, snapshot);
      const retrieveEndedAt = nowIso();
      const steps: KnowledgeStep[] = [
        {
          id: 'step_retrieve',
          kind: 'retrieve',
          label: `读取 ${String(documents.length)} 份资料`,
          status: 'succeeded',
          startedAt: retrieveStartedAt,
          endedAt: retrieveEndedAt,
          durationMs: Math.max(0, Date.parse(retrieveEndedAt) - retrieveStartedMs),
          detail: documents.map((document) => document.path).join('、').slice(0, 500),
        },
      ];
      const sourceSnapshot = { frozenAt: snapshot.frozenAt, contentHashes: Object.fromEntries(documents.map((document) => [document.path, document.sha256])), networkSearch, selectedPaths, readPaths: documents.map((document) => document.path), truncatedPaths };
      this.#saveProgress({ requestKey: input.requestKey, projectId: input.projectId, question, conversationId,
        model: `${model.provider}/${model.model}`, status: 'researching', startedAt: retrieveStartedAt, updatedAt: nowIso(), answer: '', sources: sourceSnapshot, roleEvidence });
      let streamText = '';
      const recent = (this.#store.settings.getJson<KnowledgeHistoryEntry[]>(historyKey(input.projectId)) ?? [])
        .filter((entry) => { if (entry.conversationId !== conversationId) return false; const old = entry.requestKey === undefined ? undefined : this.#store.settings.getJson<KnowledgeInputSnapshot>(`knowledge.input.${entry.requestKey}`); try { if (old !== undefined) this.inputs.assertCurrent(input.projectId, old); return old !== undefined; } catch { return false; } })
        .slice(0, 3);
      const result = await this.#opencode.runSession({
        kind: 'review',
        metadata: { requestKey: input.requestKey, projectId: input.projectId, purpose: 'knowledge.ask' },
        cwd: project.rootPath,
        prompt: buildPrompt(question, documents, recent) + (previous === undefined ? '' : `\n继续完成上次停止的回答，返回包含已有内容的完整答案。已保留内容：\n${previous.answer}`),
        system: `${role?.instructions ?? role?.purpose ?? ''}\n${SYSTEM_PROMPT}`,
        ...(role === undefined ? {} : { rolePolicy: structuredClone(role) }),
        model,
        permission: 'read_only',
        toolPolicy: 'none',
        onSessionId: (sessionId) => {
          const progress = this.progress(input.requestKey, input.projectId);
          if (progress.stopRequestKey !== undefined) {
            // No prompt has been submitted yet; this is positive proof of no work.
            this.#finishStopped(progress);
            throw new AppError(ErrorCode.OPERATION_IN_PROGRESS, '问答在派发前已停止');
          }
          this.#saveProgress({ ...progress, sessionId });
        },
        sink: {
          onTextDelta: (delta) => {
            streamText += delta;
            const progress = this.progress(input.requestKey, input.projectId);
            if (!['researching', 'answering'].includes(progress.status)) return;
            try { this.inputs.assertCurrent(input.projectId, snapshot); } catch { this.#saveProgress({ ...progress, answer: '', status: 'failed', error: '资料许可已撤销，迟到内容已清空' }); return; }
            const answer = partialKnowledgeAnswer(streamText);
            this.#saveProgress({ ...progress, answer, status: answer === '' ? 'researching' : 'answering' });
          },
          onIdle: () => {
            const progress = this.progress(input.requestKey, input.projectId);
            if (progress.stopRequestKey !== undefined) this.#finishStopped(progress);
          },
        },
        timeoutMs: 120_000,
      });
      this.inputs.assertCurrent(input.projectId, snapshot);
      const progress = this.progress(input.requestKey, input.projectId);
      if (progress.status === 'completed') return { receipt: this.#commands.toReceipt(this.#commands.get(input.requestKey)!), resource: this.result(input.requestKey, input.projectId) };
      if (progress.status === 'stopped' || (progress.stopRequestKey !== undefined && result.outcome.idle)) {
        this.#finishStopped(progress);
        return { receipt: this.#commands.toReceipt(this.#commands.get(input.requestKey)!), resource: this.result(input.requestKey, input.projectId) };
      }
      if (progress.stopRequestKey !== undefined) throw new AppError(ErrorCode.OPERATION_IN_PROGRESS, '停止尚未确认，请核对原操作');
      if (result.outcome.timedOut) throw new AppError(ErrorCode.MODEL_BUDGET_EXCEEDED, '知识问答超时，请缩小问题范围后重试');
      if (result.outcome.error !== undefined && result.outcome.error !== '') {
        throw new AppError(ErrorCode.OPENCODE_PROVIDER_FAILED, `知识问答失败：${result.outcome.error}`);
      }
      // Real model timing comes from the assistant message itself; tool parts
      // are recorded only when the runtime actually emitted them. Nothing here
      // is a fixed template.
      const modelStep = modelStepFrom(result.outcome.messages);
      if (modelStep !== undefined) steps.push(modelStep);
      const toolSteps = toolStepsFrom(result.outcome.messages);
      const toolActivity = toolActivityFrom(result.outcome.messages);
      steps.push(...toolSteps);
      const validateStartedAt = nowIso();
      const parsed = extractJson(result.outcome.assistantText ?? '');
      if (parsed === undefined || typeof parsed.answer !== 'string') {
        throw new AppError(ErrorCode.VALIDATION_FAILED, '模型输出不是约定的 JSON（缺少 answer），未生成问答结果');
      }
      const citations = validateCitations(parsed.citations, documents);
      const validateEndedAt = nowIso();
      steps.push({
        id: 'step_validate',
        kind: 'validate',
        label: '引用校验',
        status: 'succeeded',
        startedAt: validateStartedAt,
        endedAt: validateEndedAt,
        durationMs: Math.max(0, Date.parse(validateEndedAt) - Date.parse(validateStartedAt)),
        detail: `接受 ${String(citations.length)} 条引用（模型给出 ${String(Array.isArray(parsed.citations) ? parsed.citations.length : 0)} 条）`,
      });
      const orderedSteps = [...steps].sort((a, b) => (a.startedAt < b.startedAt ? -1 : a.startedAt > b.startedAt ? 1 : 0));
      const response: KnowledgeAskResponse = {
        requestKey: input.requestKey,
        status: 'completed',
        roleEvidence,
        projectId: input.projectId,
        question,
        answer: parsed.answer.trim().slice(0, 8_000),
        citations,
        model: `${model.provider}/${model.model}`,
        generatedAt: nowIso(),
        conversationId,
        sources: sourceSnapshot,
        usage: usageFromMessages(result.outcome.messages),
        steps: orderedSteps,
        ...(toolActivity.length === 0 ? {} : { toolActivity }),
      };
      this.#complete(input.requestKey, response);
      return { receipt: this.#commands.toReceipt(this.#commands.get(input.requestKey)!), resource: this.result(input.requestKey, input.projectId) };
    } catch (error) {
      const settled = this.#commands.get(input.requestKey);
      if (settled?.status === 'succeeded') return { receipt: this.#commands.toReceipt(settled), resource: this.result(input.requestKey, input.projectId) };
      const progress = this.#store.settings.getJson<KnowledgeRunProgress>(progressKey(input.requestKey));
      if (progress?.status === 'stopped') return { receipt: this.#commands.toReceipt(this.#commands.get(input.requestKey)!), resource: this.result(input.requestKey, input.projectId) };
      const revoked = error instanceof AppError && error.code === ErrorCode.REVOKED;
      const unknown = progress?.stopRequestKey !== undefined || (error instanceof AppError && error.code === ErrorCode.MODEL_BUDGET_EXCEEDED);
      if (progress !== undefined) this.#saveProgress({ ...progress, ...(revoked ? { answer: '' } : {}), status: unknown ? 'unknown' : 'failed', error: error instanceof Error ? error.message : '知识问答失败' });
      this.#commands.fail(input.requestKey, error instanceof Error ? error : new Error('知识问答失败'), unknown);
      throw error;
    } finally { this.#active.delete(input.requestKey); }
  }

  progress(requestKey: string, projectId: string): KnowledgeRunProgress {
    let progress = this.#store.settings.getJson<KnowledgeRunProgress>(progressKey(requestKey));
    if (progress === undefined || progress.projectId !== projectId) throw new AppError(ErrorCode.NOT_FOUND, '问答进度不存在');
    if (!this.#active.has(requestKey) && ['researching', 'answering', 'stopping'].includes(progress.status)) {
      progress = { ...progress, status: 'unknown', error: '执行连接已中断，请核对原操作。' };
      this.#saveProgress(progress);
    }
    const input = this.#store.settings.getJson<KnowledgeInputSnapshot>(`knowledge.input.${requestKey}`);
    if (input !== undefined) { try { this.inputs.assertCurrent(projectId, input); } catch { return { ...progress, answer: '', error: '资料许可已撤销，内容已清空' }; } }
    return progress;
  }

  async stop(askKey: string, input: KnowledgeStopRequest): Promise<CommandResponse> {
    const progress = this.progress(askKey, input.projectId);
    const { record, replayed } = this.#commands.begin({ requestKey: input.requestKey, operation: 'knowledge.stop', body: { askKey, projectId: input.projectId }, target: { projectId: input.projectId } });
    if (replayed) return { receipt: this.#commands.toReceipt(record) };
    if (['completed', 'stopped', 'failed'].includes(progress.status)) {
      this.#commands.settle(input.requestKey, { askKey, alreadyTerminal: true });
    } else if (progress.stopRequestKey !== undefined) {
      this.#commands.fail(input.requestKey, new AppError(ErrorCode.OPERATION_IN_PROGRESS, `请核对原停止请求 ${progress.stopRequestKey}`));
    } else {
      const stopping = { ...progress, status: 'stopping' as const, stopRequestKey: input.requestKey };
      this.#saveProgress(stopping);
      if (progress.sessionId === undefined) this.#finishStopped(stopping);
      else {
        try {
          await Promise.race([this.#opencode.abortSession(progress.sessionId), new Promise<never>((_, reject) => {
            const timer = setTimeout(() => reject(new Error('停止确认超时')), 5000); timer.unref();
          })]);
          await this.reconcileOperation(input.requestKey);
        } catch (error) {
          if (this.#commands.get(input.requestKey)?.status !== 'succeeded') {
            this.#commands.fail(input.requestKey, error instanceof Error ? error : new Error('停止未确认'), true);
            this.#saveProgress({ ...stopping, status: 'unknown', error: '停止尚未确认，请核对原请求号。' });
          }
        }
      }
    }
    return { receipt: this.#commands.toReceipt(this.#commands.get(input.requestKey)!) };
  }

  async reconcileOperation(key: string): Promise<void> {
    const operation = this.#commands.get(key);
    if (operation === undefined || !['knowledge.ask', 'knowledge.stop'].includes(operation.operation) || !['accepted', 'unknown'].includes(operation.status)) return;
    const askKey = operation.operation === 'knowledge.ask' ? key : this.#store.settings.getJson<string>(`knowledge.stop-target.${key}`);
    if (askKey === undefined) return;
    let progress = this.#store.settings.getJson<KnowledgeRunProgress>(progressKey(askKey));
    if (progress === undefined) return;
    try {
      if (progress.sessionId === undefined) {
        if (this.#store.settings.getJson(`knowledge.input.${askKey}`) === undefined) return;
        const sessions = await this.#opencode.findSessions({ projectId: progress.projectId, purpose: 'knowledge.ask', requestKey: askKey });
        if (sessions.length !== 1) return;
        progress = { ...progress, sessionId: sessions[0]!.id };
        this.#saveProgress(progress);
      }
      const sessionId = progress.sessionId; if (sessionId === undefined) return;
      const status = await this.#opencode.inspectSession?.(sessionId);
      if (status !== 'idle') return;
      if (progress.stopRequestKey !== undefined) { this.#finishStopped(progress); return; }
      const input = this.#store.settings.getJson<KnowledgeInputSnapshot>(`knowledge.input.${askKey}`);
      if (input === undefined || this.#opencode.sessionMessages === undefined) return;
      this.inputs.assertCurrent(progress.projectId, input);
      const messages = await this.#opencode.sessionMessages(sessionId);
      const assistant = [...messages].reverse().find((message) => message.info.role === 'assistant');
      if (assistant?.info.time?.completed === undefined || assistant.info.error !== undefined) return;
      const text = assistant.parts.filter((part) => part.type === 'text').map((part) => part.text ?? '').join('');
      const parsed = extractJson(text);
      if (parsed === undefined || typeof parsed.answer !== 'string') return;
      this.inputs.assertCurrent(progress.projectId, input);
      this.#complete(askKey, { requestKey: askKey, projectId: progress.projectId, question: progress.question,
        answer: parsed.answer.trim().slice(0, 8000), citations: validateCitations(parsed.citations, input.documents),
        status: 'completed', model: progress.model, conversationId: progress.conversationId, generatedAt: nowIso(), sources: progress.sources,
        roleEvidence: progress.roleEvidence, usage: usageFromMessages(messages), steps: [...(modelStepFrom(messages) === undefined ? [] : [modelStepFrom(messages)!]), ...toolStepsFrom(messages)], toolActivity: toolActivityFrom(messages) });
    } catch { /* Missing remote proof or revoked sources cannot settle the original operation. */ }
  }

  async readSource(projectId: string, path: string, requestKey?: string) {
    if (requestKey !== undefined) {
      const operation = this.#commands.get(requestKey);
      if (operation?.target.projectId !== projectId || operation.operation !== 'knowledge.ask') throw new AppError(ErrorCode.NOT_FOUND, '问答来源不存在');
      const input = this.#store.settings.getJson<KnowledgeInputSnapshot>(`knowledge.input.${requestKey}`);
      if (input === undefined) throw new AppError(ErrorCode.NOT_RETAINED, '问答来源内容快照未保留');
      this.inputs.assertCurrent(projectId, input);
      const document = input.documents.find((item) => item.path === path);
      if (document === undefined) throw new AppError(ErrorCode.FORBIDDEN, '来源不在该轮冻结输入内');
      return { path, content: document.content, bytes: Buffer.byteLength(document.content), sha256: document.sha256 };
    }
    const source = await this.inputs.read(projectId, path);
    this.inputs.requireOriginal(projectId);
    return source;
  }

  #saveProgress(progress: KnowledgeRunProgress): void {
    this.#store.settings.putJson(progressKey(progress.requestKey), { ...progress, updatedAt: nowIso() });
    if (progress.stopRequestKey !== undefined) this.#store.settings.putJson(`knowledge.stop-target.${progress.stopRequestKey}`, progress.requestKey);
  }

  #finishStopped(progress: KnowledgeRunProgress): void {
    if (['completed', 'failed'].includes(progress.status)) return;
    this.#complete(progress.requestKey, { requestKey: progress.requestKey, status: 'stopped', projectId: progress.projectId,
      question: progress.question, answer: progress.answer, citations: [], model: progress.model,
      generatedAt: nowIso(), conversationId: progress.conversationId, sources: progress.sources, roleEvidence: progress.roleEvidence, continueAvailability: this.#store.settings.getJson(`knowledge.input.${progress.requestKey}`) === undefined ? { allowed: false, reasonCode: ErrorCode.NOT_RETAINED, reason: '来源读取尚未完成，没有可继续的冻结输入；请新建问答' } : { allowed: true } });
    if (progress.stopRequestKey !== undefined && this.#commands.get(progress.stopRequestKey)?.status !== 'succeeded') {
      this.#commands.settle(progress.stopRequestKey, { askKey: progress.requestKey, confirmedStopped: true });
    }
  }

  #complete(requestKey: string, response: KnowledgeAskResponse): void {
    if (this.#commands.get(requestKey)?.status === 'succeeded') return;
    const entry: KnowledgeHistoryEntry = { id: createId('knowledge'), ...response, runStatus: response.status === 'stopped' ? 'stopped' : 'completed' };
    const history = this.#store.settings.getJson<KnowledgeHistoryEntry[]>(historyKey(response.projectId)) ?? [];
    this.#store.settings.putJson(historyKey(response.projectId), [entry, ...history].slice(0, 30));
    this.#store.settings.putJson(resultKey(requestKey), response);
    const progress = this.#store.settings.getJson<KnowledgeRunProgress>(progressKey(requestKey));
    if (progress !== undefined) this.#saveProgress({ ...progress, answer: response.answer, status: response.status === 'stopped' ? 'stopped' : 'completed' });
    this.#commands.settle(requestKey, { historyId: entry.id, conversationId: response.conversationId });
  }

  result(requestKey: string, projectId: string): KnowledgeAskResponse {
    const operation = this.#commands.get(requestKey);
    if (operation?.operation !== 'knowledge.ask' || operation.target.projectId !== projectId) {
      throw new AppError(ErrorCode.NOT_FOUND, '问答操作不存在');
    }
    const result = this.#store.settings.getJson<KnowledgeAskResponse>(resultKey(requestKey));
    if (operation.status !== 'succeeded' || result === undefined) {
      throw new AppError(ErrorCode.CAPABILITY_UNAVAILABLE, '问答结果尚未就绪，请核对原操作');
    }
    const input = this.#store.settings.getJson<KnowledgeInputSnapshot>(`knowledge.input.${requestKey}`);
    if (input !== undefined) this.inputs.assertCurrent(projectId, input); else this.inputs.requireOriginal(projectId);
    return result;
  }

  history(projectId: string): KnowledgeHistoryResponse {
    if (this.#store.projects.get(projectId) === undefined) throw new AppError(ErrorCode.NOT_FOUND, '项目不存在');
    const completed = this.#store.settings.getJson<KnowledgeHistoryEntry[]>(historyKey(projectId)) ?? [];
    const keys = this.#store.settings.getJson<string[]>(`knowledge.runs.${projectId}`) ?? [];
    const pending: KnowledgeHistoryEntry[] = keys.flatMap((key) => {
      const progress = this.progress(key, projectId);
      if (['completed', 'stopped'].includes(progress.status)) return [];
      return [{ id: key, requestKey: key, projectId, conversationId: progress.conversationId, question: progress.question,
        answer: progress.answer, model: progress.model, generatedAt: progress.startedAt, sources: progress.sources,
        runStatus: progress.status, citations: [] }];
    });
    return { entries: [...pending, ...completed].map((entry) => { const input = entry.requestKey === undefined ? undefined : this.#store.settings.getJson<KnowledgeInputSnapshot>(`knowledge.input.${entry.requestKey}`); try { if (input !== undefined) this.inputs.assertCurrent(projectId, input); else this.inputs.requireOriginal(projectId); return entry; } catch { return { ...entry, answer: '', citations: [] }; } }).sort((a, b) => b.generatedAt.localeCompare(a.generatedAt)) };
  }

  #model(): ModelProfile {
    const models = this.#context.settings().models;
    const model = models.find((item) => item.enabled && item.roles.includes('reviewer')) ?? models.find((item) => item.enabled);
    if (model === undefined) throw new AppError(ErrorCode.MODEL_NOT_CONFIGURED, '没有启用的模型可用于知识问答');
    return model;
  }
}

function progressKey(requestKey: string): string { return `knowledge.progress.${requestKey}`; }

function resultKey(requestKey: string): string {
  return `knowledge.result.${requestKey}`;
}

/** Real assistant-message timing (undefined when the runtime did not report it). */
function modelStepFrom(messages: readonly OpenCodeMessage[]): KnowledgeStep | undefined {
  const assistant = [...messages].reverse().find((message) => message.info.role === 'assistant');
  if (assistant === undefined) return undefined;
  const created = assistant.info.time?.created;
  const completed = assistant.info.time?.completed;
  if (created === undefined) return undefined;
  const startedAt = new Date(created).toISOString();
  const endedAt = completed === undefined ? undefined : new Date(completed).toISOString();
  const durationMs = completed === undefined ? undefined : Math.max(0, completed - created);
  return {
    id: `step_model_${assistant.info.id}`,
    kind: 'model',
    label: '模型回答',
    status: completed === undefined ? 'unknown' : 'succeeded',
    startedAt,
    ...(endedAt === undefined ? {} : { endedAt }),
    ...(durationMs === undefined ? {} : { durationMs }),
  };
}

function toolParts(messages: readonly OpenCodeMessage[]): readonly OpenCodePart[] {
  return messages.flatMap((message) => message.parts).filter((part) => part.type === 'tool' && typeof part.tool === 'string');
}

function toolStatus(status: string | undefined): KnowledgeToolActivity['status'] {
  switch (status) {
    case 'completed':
    case 'succeeded':
      return 'succeeded';
    case 'error':
    case 'failed':
      return 'failed';
    case 'running':
      return 'running';
    case 'pending':
      return 'pending';
    default:
      return 'unknown';
  }
}

function toolActivityFrom(messages: readonly OpenCodeMessage[]): KnowledgeToolActivity[] {
  return toolParts(messages).map((part) => {
    const state = part.state;
    const started = typeof state?.time?.['start'] === 'number' ? new Date(state.time['start']).toISOString() : undefined;
    const ended = typeof state?.time?.['end'] === 'number' ? new Date(state.time['end']).toISOString() : undefined;
    const summary = state?.title ?? state?.output ?? state?.error;
    return {
      name: part.tool ?? 'unknown',
      status: toolStatus(state?.status),
      ...(summary === undefined || summary === '' ? {} : { summary: summary.slice(0, 300) }),
      ...(part.callID === undefined ? {} : { callId: part.callID }),
      ...(started === undefined ? {} : { startedAt: started }),
      ...(ended === undefined ? {} : { endedAt: ended }),
    };
  });
}

function toolStepsFrom(messages: readonly OpenCodeMessage[]): KnowledgeStep[] {
  return toolParts(messages).flatMap((part) => {
    const state = part.state;
    const started = typeof state?.time?.['start'] === 'number' ? new Date(state.time['start']).toISOString() : undefined;
    if (started === undefined) return [];
    const ended = typeof state?.time?.['end'] === 'number' ? new Date(state.time['end']).toISOString() : undefined;
    const summary = state?.title ?? state?.output ?? state?.error;
    return [{
      id: part.callID ?? `tool_${part.id ?? started}`,
      kind: 'tool' as const,
      label: part.tool ?? '工具调用',
      status: toolStatus(state?.status),
      startedAt: started,
      ...(ended === undefined ? {} : { endedAt: ended, durationMs: Math.max(0, Date.parse(ended) - Date.parse(started)) }),
      ...(summary === undefined || summary === '' ? {} : { detail: summary.slice(0, 300) }),
    }];
  });
}

const SYSTEM_PROMPT = `你是项目知识库的研究员。只依据本轮提供的代码、文档、获准数据库样本与公共检索摘要回答，不要编造这些输入之外的事实。公共检索摘要不等于已打开网页全文；不能用自由工具补读。
只输出一个 JSON 对象，不要 Markdown：
{"answer":"回答（可多句）","citations":[{"path":"文档相对路径","line":行号,"snippet":"该行原文"}]}
line 必须来自文档真实行号；answer 中引用的每个关键结论都要有 citation。文档不足时明确说“文档中没有足够依据”。`;

function buildPrompt(question: string, documents: readonly { path: string; content: string }[], recent: readonly KnowledgeHistoryEntry[]): string {
  const blocks = documents.map((document, index) => `--- 文档 ${index + 1}：${document.path}\n${document.content}`).join('\n\n');
  const context = recent.length === 0
    ? ''
    : `\n\n最近问答（仅作为上下文，不要用它们替代文档引用）：\n${recent.map((entry, index) => `Q${String(index + 1)}: ${entry.question.slice(0, 300)}\nA${String(index + 1)}: ${entry.answer.slice(0, 500)}`).join('\n')}`;
  return `问题：${question}${context}\n\n可用文档（只读，路径用于引用）：\n${blocks}`;
}

function extractJson(text: string): { answer?: unknown; citations?: unknown } | undefined {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return undefined;
  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
    return { answer: parsed.answer, citations: parsed.citations };
  } catch {
    return undefined;
  }
}

function validateCitations(raw: unknown, documents: readonly { path: string; content: string }[]): KnowledgeAskResponse['citations'] {
  if (!Array.isArray(raw)) return [];
  const byPath = new Map(documents.map((document) => [document.path, document.content.split(/\r?\n/)]));
  const citations: KnowledgeAskResponse['citations'][number][] = [];
  for (const entry of raw.slice(0, 12)) {
    if (entry === null || typeof entry !== 'object') continue;
    const record = entry as Record<string, unknown>;
    const path = typeof record.path === 'string' ? record.path : '';
    const line = typeof record.line === 'number' && Number.isInteger(record.line) ? record.line : 0;
    const total = byPath.get(path);
    if (total === undefined || line < 1 || line > total.length) continue;
    const snippet = (total[line - 1] ?? '').trim().slice(0, 300);
    citations.push({ path, line, ...(snippet === '' ? {} : { snippet }) });
  }
  return citations;
}


function historyKey(projectId: string): string {
  return `knowledge.history.${projectId}`;
}
