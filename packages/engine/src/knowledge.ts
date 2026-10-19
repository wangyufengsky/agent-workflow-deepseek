import {
  AppError,
  ErrorCode,
  createId,
  nowIso,
  type CommandResponse,
  type KnowledgeAskRequest,
  type KnowledgeAskResponse,
  type KnowledgeRunProgress,
  type KnowledgeStopRequest,
  type KnowledgeHistoryEntry,
  type KnowledgeHistoryResponse,
  type KnowledgeStep,
  type KnowledgeToolActivity,
  type ModelProfile,
} from '@agent-workflow/shared';
import type { Store } from '@agent-workflow/storage';
import type { EngineContext } from './actions.ts';
import type { CommandService } from './operations.ts';
import type { OpenCodePort } from './ports.ts';
import type { OpenCodeMessage, OpenCodePart } from '@agent-workflow/opencode';
import { listKnowledgeSources, readKnowledgeSource } from '../../server/src/knowledge.ts';
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
}

/** Read-only document Q&A with durable command receipts and frozen source selection. */
export class KnowledgeService {
  readonly #store: Store;
  readonly #commands: CommandService;
  readonly #context: EngineContext;
  readonly #opencode: OpenCodePort;
  readonly #active = new Set<string>();

  constructor(options: KnowledgeServiceOptions) {
    this.#store = options.store;
    this.#commands = options.commands;
    this.#context = options.context;
    this.#opencode = options.opencode;
  }

  async ask(input: KnowledgeAskRequest): Promise<CommandResponse<KnowledgeAskResponse>> {
    if (input === null || typeof input !== 'object') throw new AppError(ErrorCode.VALIDATION_FAILED, '知识库请求体不合法');
    const question = typeof input.question === 'string' ? input.question.trim() : '';
    if (question.length < 2 || question.length > 2_000) throw new AppError(ErrorCode.VALIDATION_FAILED, '问题长度需要在 2–2000 字之间');
    const project = this.#store.projects.get(input.projectId);
    if (project === undefined) throw new AppError(ErrorCode.NOT_FOUND, '项目不存在');
    const requestedConversationId = typeof input.conversationId === 'string' && input.conversationId.trim() !== ''
      ? input.conversationId.trim().slice(0, 64)
      : undefined;
    if (input.sourcePaths !== undefined && (!Array.isArray(input.sourcePaths) || input.sourcePaths.length === 0 || input.sourcePaths.length > MAX_SOURCES || input.sourcePaths.some((path) => typeof path !== 'string' || path.trim() === ''))) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, '请选择 1–200 份资料来源');
    }
    const sourcePaths = input.sourcePaths === undefined ? undefined : [...new Set(input.sourcePaths)].sort();
    // Hash only caller input. A generated conversation ID must not change the
    // identity of a replayed first question.
    const { record, replayed } = this.#commands.begin({
      requestKey: input.requestKey,
      operation: 'knowledge.ask',
      body: { projectId: input.projectId, question, conversationId: requestedConversationId, sourcePaths, continueFromRequestKey: input.continueFromRequestKey },
      target: { projectId: input.projectId },
    });
    if (replayed) {
      const resource = this.#store.settings.getJson<KnowledgeAskResponse>(resultKey(input.requestKey));
      return { receipt: this.#commands.toReceipt(record), ...(resource === undefined ? {} : { resource }) };
    }
    try {
      const previous = input.continueFromRequestKey === undefined ? undefined : this.result(input.continueFromRequestKey, input.projectId);
      if (previous !== undefined && (previous.status !== 'stopped' || previous.conversationId !== requestedConversationId)) {
        throw new AppError(ErrorCode.VALIDATION_FAILED, '只能继续当前对话中已确认停止的回答');
      }
      if (requestedConversationId !== undefined) {
        const owner = this.#store.settings.getJson<string>(`knowledge.project.${requestedConversationId}`);
        if (owner !== undefined && owner !== input.projectId) throw new AppError(ErrorCode.VALIDATION_FAILED, '已有会话不可更换项目');
        const outstandingKey = this.#store.settings.getJson<string>(`knowledge.pending.${requestedConversationId}`);
        const status = outstandingKey === undefined ? undefined : this.#commands.get(outstandingKey)?.status;
        if (status === 'accepted' || status === 'unknown') throw new AppError(ErrorCode.OPERATION_IN_PROGRESS, `当前对话还有未完成问答，请核对原请求 ${outstandingKey}`);
      }
      const model = requestedConversationId === undefined ? this.#model()
        : this.#store.settings.getJson<ModelProfile>(`knowledge.model.${requestedConversationId}`) ?? this.#model();
      if (this.#context.opencodeReady() !== true) throw new AppError(ErrorCode.OPENCODE_NOT_READY, '受管 OpenCode 未就绪，无法问答');
      const retrieveStartedAt = nowIso();
      const retrieveStartedMs = Date.now();
      const inventory = listKnowledgeSources(project.rootPath);
      const available = new Set(inventory.map((source) => source.path));
      const selectedPaths = previous?.sources?.selectedPaths ?? sourcePaths ?? inventory.map((source) => source.path);
      if (selectedPaths.some((path) => !available.has(path))) {
        throw new AppError(ErrorCode.VALIDATION_FAILED, '所选资料已不可读取，请刷新资料来源后重新选择');
      }
      const sources = selectedPaths;
      if (sources.length === 0) throw new AppError(ErrorCode.CAPABILITY_UNAVAILABLE, '项目里没有可读的文档来源');
      const perDocumentLimit = Math.min(MAX_DOC_CHARS, Math.floor(MAX_CONTEXT_CHARS / sources.length));
      const truncatedPaths: string[] = [];
      const documents = sources.map((path) => {
        try {
          const { content } = readKnowledgeSource(project.rootPath, path);
          if (content.length > perDocumentLimit) truncatedPaths.push(path);
          return { path, content: content.slice(0, perDocumentLimit) };
        } catch {
          throw new AppError(ErrorCode.CAPABILITY_UNAVAILABLE, '所选资料读取失败，请刷新来源后重试', { details: { path } });
        }
      }).filter((document) => document.content !== '');
      if (documents.length === 0) throw new AppError(ErrorCode.CAPABILITY_UNAVAILABLE, '文档来源不可读');
      const retrieveEndedAt = nowIso();
      const steps: KnowledgeStep[] = [
        {
          id: 'step_retrieve',
          kind: 'retrieve',
          label: `读取 ${String(documents.length)} 份文档`,
          status: 'succeeded',
          startedAt: retrieveStartedAt,
          endedAt: retrieveEndedAt,
          durationMs: Math.max(0, Date.parse(retrieveEndedAt) - retrieveStartedMs),
          detail: documents.map((document) => document.path).join('、').slice(0, 500),
        },
      ];
      const conversationId = requestedConversationId ?? createId('conversation');
      this.#store.settings.putJson(`knowledge.model.${conversationId}`, model);
      this.#store.settings.putJson(`knowledge.project.${conversationId}`, input.projectId);
      this.#store.settings.putJson(`knowledge.pending.${conversationId}`, input.requestKey);
      const sourceSnapshot = { selectedPaths, readPaths: documents.map((document) => document.path), truncatedPaths };
      this.#saveProgress({ requestKey: input.requestKey, projectId: input.projectId, question, conversationId,
        model: `${model.provider}/${model.model}`, status: 'researching', startedAt: nowIso(), updatedAt: nowIso(), answer: '', sources: sourceSnapshot });
      const runKeys = this.#store.settings.getJson<string[]>(`knowledge.runs.${input.projectId}`) ?? [];
      this.#store.settings.putJson(`knowledge.runs.${input.projectId}`, [input.requestKey, ...runKeys].slice(0, 200));
      this.#active.add(input.requestKey);
      let streamText = '';
      const recent = (this.#store.settings.getJson<KnowledgeHistoryEntry[]>(historyKey(input.projectId)) ?? [])
        .filter((entry) => entry.conversationId === conversationId)
        .slice(0, 3);
      const result = await this.#opencode.runSession({
        kind: 'review',
        metadata: { projectId: input.projectId, purpose: 'knowledge.ask' },
        cwd: project.rootPath,
        prompt: buildPrompt(question, documents, recent) + (previous === undefined ? '' : `\n继续完成上次停止的回答，返回包含已有内容的完整答案。已保留内容：\n${previous.answer}`),
        system: SYSTEM_PROMPT,
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
      const progress = this.progress(input.requestKey, input.projectId);
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
        projectId: input.projectId,
        question,
        answer: parsed.answer.trim().slice(0, 8_000),
        citations,
        model: `${model.provider}/${model.model}`,
        generatedAt: nowIso(),
        conversationId,
        sources: { selectedPaths, readPaths: documents.map((document) => document.path), truncatedPaths },
        usage: usageFromMessages(result.outcome.messages),
        steps: orderedSteps,
        ...(toolActivity.length === 0 ? {} : { toolActivity }),
      };
      this.#complete(input.requestKey, response);
      return { receipt: this.#commands.toReceipt(this.#commands.get(input.requestKey)!), resource: response };
    } catch (error) {
      const progress = this.#store.settings.getJson<KnowledgeRunProgress>(progressKey(input.requestKey));
      if (progress?.status === 'stopped') return { receipt: this.#commands.toReceipt(this.#commands.get(input.requestKey)!), resource: this.result(input.requestKey, input.projectId) };
      const unknown = progress?.stopRequestKey !== undefined || (error instanceof AppError && error.code === ErrorCode.MODEL_BUDGET_EXCEEDED);
      if (progress !== undefined) this.#saveProgress({ ...progress, status: unknown ? 'unknown' : 'failed', error: error instanceof Error ? error.message : '知识问答失败' });
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
      if (progress.sessionId !== undefined) {
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
    const progress = this.#store.settings.getJson<KnowledgeRunProgress>(progressKey(askKey));
    if (progress?.sessionId === undefined || progress.stopRequestKey === undefined) return;
    try {
      const status = await this.#opencode.inspectSession?.(progress.sessionId);
      if (status === 'idle') this.#finishStopped(progress);
    } catch { /* Missing state cannot prove a stopped session. */ }
  }

  #saveProgress(progress: KnowledgeRunProgress): void {
    this.#store.settings.putJson(progressKey(progress.requestKey), { ...progress, updatedAt: nowIso() });
    if (progress.stopRequestKey !== undefined) this.#store.settings.putJson(`knowledge.stop-target.${progress.stopRequestKey}`, progress.requestKey);
  }

  #finishStopped(progress: KnowledgeRunProgress): void {
    if (['completed', 'failed'].includes(progress.status)) return;
    this.#complete(progress.requestKey, { requestKey: progress.requestKey, status: 'stopped', projectId: progress.projectId,
      question: progress.question, answer: progress.answer, citations: [], model: progress.model,
      generatedAt: nowIso(), conversationId: progress.conversationId, sources: progress.sources });
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
    return { entries: [...pending, ...completed].sort((a, b) => b.generatedAt.localeCompare(a.generatedAt)) };
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

const SYSTEM_PROMPT = `你是项目知识库的研究员。只依据用户提供的文档回答问题，不要编造文档之外的事实。
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
  const byPath = new Map(documents.map((document) => [document.path, document.content.split(/\r?\n/).length]));
  const citations: KnowledgeAskResponse['citations'][number][] = [];
  for (const entry of raw.slice(0, 12)) {
    if (entry === null || typeof entry !== 'object') continue;
    const record = entry as Record<string, unknown>;
    const path = typeof record.path === 'string' ? record.path : '';
    const line = typeof record.line === 'number' && Number.isInteger(record.line) ? record.line : 0;
    const total = byPath.get(path);
    if (total === undefined || line < 1 || line > total) continue;
    const snippet = typeof record.snippet === 'string' ? record.snippet.trim().slice(0, 300) : '';
    citations.push({ path, line, ...(snippet === '' ? {} : { snippet }) });
  }
  return citations;
}


function historyKey(projectId: string): string {
  return `knowledge.history.${projectId}`;
}
