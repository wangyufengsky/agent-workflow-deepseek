import { createHash } from 'node:crypto';
import { AppError, ErrorCode, nowIso, type RuntimeInteraction, type RuntimeInteractionBinding, type RuntimeInteractionResolveRequest, type RuntimeInteractionResolution } from '@agent-workflow/shared';
import type { InteractionConfirmation, PermissionRequest, QuestionRequest } from '@agent-workflow/opencode';
import type { Store } from '@agent-workflow/storage';
import type { OpenCodePort, OpenCodeRunRequest } from './ports.ts';
import { CommandService, stableHash } from './operations.ts';
const INDEX = 'runtime.interactions';
const operation = 'runtime.interaction.resolve' as const;

/** Persistent facts from the runtime; pending disappearance never proves a reply. */
export class RuntimeInteractionService {
  readonly #store: Store; readonly #commands: CommandService; readonly #port: OpenCodePort;
  readonly #sessionGrants = new Map<string, string>();
  readonly #live = new Set<string>();
  readonly #knowledgeReadable: ((projectId: string, requestKey: string) => void) | undefined;
  readonly #onChanged: ((taskId: string) => void) | undefined;
  constructor(store: Store, commands: CommandService, port: OpenCodePort, onChanged?: (taskId: string) => void, knowledgeReadable?: (projectId: string, requestKey: string) => void) { this.#store = store; this.#commands = commands; this.#port = port; this.#onChanged = onChanged; this.#knowledgeReadable = knowledgeReadable; }
  list(): readonly RuntimeInteraction[] { return this.#store.settings.getJson<readonly RuntimeInteraction[]>(INDEX) ?? []; }
  get(id: string): RuntimeInteraction { const item = this.list().find((item) => item.id === id); if (!item) throw new AppError(ErrorCode.NOT_FOUND, '运行时互动不存在'); return item; }
  view(item: RuntimeInteraction): RuntimeInteraction {
    const attempt = item.binding.attemptId === undefined ? undefined : this.#store.executions.getAttempt(item.binding.attemptId);
    if (attempt?.readability.output === 'forbidden') return { ...item, questions: [], patterns: [], permission: undefined, resolution: undefined, confirmation: undefined, reason: '原步骤内容读取权限已撤回', resolveAllowed: false, grantAllowed: false, unavailableReason: '原步骤内容读取权限已撤回' };
    if (item.binding.knowledgeRequestKey !== undefined) {
      try { if (this.#knowledgeReadable === undefined) throw new Error(); this.#knowledgeReadable(item.binding.projectId, item.binding.knowledgeRequestKey); }
      catch { return { ...item, questions: [], patterns: [], permission: undefined, resolution: undefined, confirmation: undefined, reason: '知识对话来源许可已撤回或原快照不可读', resolveAllowed: false, grantAllowed: false, unavailableReason: '知识对话来源许可已撤回或原快照不可读' }; }
    }
    const active = this.#active(item.binding);
    const resolveAllowed = item.state === 'open' && (item.hard || active);
    const grantAllowed = item.kind === 'permission' && this.#allowed(item);
    return { ...item, resolveAllowed, grantAllowed, ...(!resolveAllowed ? { unavailableReason: item.state === 'unknown' ? item.requestKey === undefined ? '尚未发送答复；原会话上下文已失效，请回到任务核对或停止原会话' : '原请求结果未知，只能核对原请求号' : item.state === 'resolved' ? '原请求已经处理' : '原会话或尝试已不再活动' } : item.kind === 'permission' && !grantAllowed ? { unavailableReason: '当前授权上限已收紧，只能拒绝原请求' } : {}) };
  }
  #put(item: RuntimeInteraction) { const all = this.list(); this.#store.settings.putJson(INDEX, [item, ...all.filter((entry) => entry.id !== item.id)]); this.#store.events.publish('inbox.changed', { taskId: item.binding.taskId, projectId: item.binding.projectId }); if (item.binding.taskId !== undefined) this.#onChanged?.(item.binding.taskId); }
  #active(binding: RuntimeInteractionBinding): boolean {
    if (!this.#live.has(binding.sessionId)) return false;
    if (binding.knowledgeRequestKey !== undefined && binding.conversationId !== undefined) {
      const progress = this.#store.settings.getJson<import('@agent-workflow/shared').KnowledgeRunProgress>(`knowledge.progress.${binding.knowledgeRequestKey}`);
      const operation = this.#commands.get(binding.knowledgeRequestKey);
      if (progress?.projectId !== binding.projectId || progress.conversationId !== binding.conversationId || progress.sessionId !== binding.sessionId || !['researching','answering'].includes(progress.status) || progress.stopRequestKey !== undefined || operation?.operation !== 'knowledge.ask' || operation.status !== 'accepted' || this.#store.settings.getJson(`knowledge.pending.${binding.conversationId}`) !== binding.knowledgeRequestKey) return false;
      try { if (!this.#knowledgeReadable) return false; this.#knowledgeReadable(binding.projectId, binding.knowledgeRequestKey); return true; } catch { return false; }
    }
    const task = binding.taskId === undefined ? undefined : this.#store.tasks.get(binding.taskId);
    if (!task || task.projectId !== binding.projectId || task.lifecycle !== 'active') return false;
    if (binding.attemptId !== undefined) {
      const attempt = this.#store.executions.getAttempt(binding.attemptId);
      const execution = binding.executionId === undefined ? undefined : this.#store.executions.get(binding.executionId);
      const node = execution?.nodes.find((node) => node.nodeId === binding.nodeId);
      return task.executionId === binding.executionId && attempt !== undefined && attempt.executionId === binding.executionId && attempt.nodeId === binding.nodeId && attempt.status === 'running' && execution !== undefined && execution.taskId === binding.taskId && execution.status === 'running' && node?.currentAttemptId === binding.attemptId && node.status === 'running';
    }
    if (binding.roundId !== undefined) { const round = this.#store.planning.get(binding.roundId); return round !== undefined && round.taskId === task.id && round.status === 'running' && (task.currentPlanningRoundId ?? this.#store.planning.latest(task.id)?.id) === binding.roundId; }
    return false; // Unbound/background sessions cannot gain permission through Inbox.
  }
  #permission(item: RuntimeInteraction): PermissionRequest { return { id: item.requestId, sessionID: item.binding.sessionId, permission: item.permission ?? 'unknown', patterns: item.patterns, protocol: item.protocol }; }
  #allowed(item: RuntimeInteraction): boolean { return !item.hard && this.#active(item.binding) && this.#port.runtimePermissionAllowed?.(item.binding.sessionId, this.#permission(item)) === true; }
  #grant(item: RuntimeInteraction): string { return stableHash({ session: item.binding.sessionId, permission: item.permission, patterns: [...item.patterns].sort() }); }
  wrap(request: OpenCodeRunRequest): OpenCodeRunRequest {
    let binding: RuntimeInteractionBinding | undefined;
    const original = request.sink;
    return { ...request, onSessionId: (sessionId) => {
      request.onSessionId?.(sessionId);
      const taskId = request.metadata.taskId;
      const task = taskId === undefined ? undefined : this.#store.tasks.get(taskId);
      if (task === undefined && request.metadata.purpose === 'knowledge.ask' && request.metadata.projectId !== undefined && request.metadata.requestKey !== undefined && request.metadata.conversationId !== undefined) { binding = { projectId: request.metadata.projectId, sessionId, knowledgeRequestKey: request.metadata.requestKey, conversationId: request.metadata.conversationId, kind: request.kind }; this.#live.add(sessionId); }
      if (task !== undefined) { binding = { taskId: task.id, projectId: task.projectId, sessionId, kind: request.kind, ...Object.fromEntries(['executionId','nodeId','attemptId','roundId'].flatMap((key) => request.metadata[key] === undefined ? [] : [[key, request.metadata[key]]])) }; this.#live.add(sessionId); }
    }, sink: { ...original,
      onPermission: async (permission) => {
        if (binding === undefined || permission.sessionID !== binding.sessionId) return 'reject';
        const hard = !this.#active(binding) || this.#port.runtimePermissionAllowed?.(binding.sessionId, permission) !== true;
        const item = this.#create(binding, permission.id, permission.protocol ?? 'legacy', hard ? 'policy' : 'permission', permission.permission, permission.patterns, [], hard);
        if (hard) { await this.#automaticReject(item); return 'defer'; }
        if (this.#sessionGrants.has(this.#grant(item))) { await this.#automaticOnce(item); }
        return 'defer';
      },
      onQuestion: (question) => {
        if (binding === undefined || question.sessionID !== binding.sessionId || !this.#active(binding)) { return this.#port.replyRuntimeQuestion?.(question.sessionID, question.id, undefined, question.protocol); }
        const questions = question.questions.map((value, index) => {
          if (typeof value.question !== 'string' || !Array.isArray(value.options) || value.options.some((option) => typeof option.label !== 'string' || typeof option.description !== 'string')) throw new AppError(ErrorCode.VALIDATION_FAILED, '运行时问题格式不合法');
          return { id: `q${index}`, title: value.question, ...(value.options.length === 0 ? {} : { options: value.options.map((option, ordinal) => ({ id: `o${ordinal}`, label: option.label, description: option.description })) }), multiple: value.multiple === true, allowOther: value.custom !== false };
        });
        this.#create(binding, question.id, question.protocol, 'question', undefined, [], questions, false, stableHash(question.questions));
      },
      onInteractionConfirmed: (confirmation) => { this.confirm(confirmation); original.onInteractionConfirmed?.(confirmation); },
      onInteractionReplyError: (permission, message) => { original.onInteractionReplyError?.(permission, message); },
    } };
  }
  closeUnansweredSession(sessionId: string): void {
    for (const item of this.list()) if (item.binding.sessionId === sessionId && item.kind === 'question' && item.requestKey === undefined && item.state !== 'resolved') this.#put({ ...item, state: 'resolved', reason: '原会话已确认结束；该问题未通过应用答复，不再等待用户输入', updatedAt: nowIso() });
  }
  sessionEnded(sessionId: string): void { this.#live.delete(sessionId); for (const [key, owner] of this.#sessionGrants) if (owner === sessionId) this.#sessionGrants.delete(key); for (const item of this.list()) if (item.binding.sessionId === sessionId && item.state === 'open' && !item.hard) this.#put({ ...item, state: 'unknown', reason: '原会话已结束，尚无明确答复确认；不能重新提交', updatedAt: nowIso() }); }
  #create(binding: RuntimeInteractionBinding, requestId: string, protocol: 'legacy' | 'v2', kind: RuntimeInteraction['kind'], permission: string | undefined, patterns: readonly string[], questions: RuntimeInteraction['questions'], hard: boolean, requestHash = stableHash({ permission, patterns })): RuntimeInteraction {
    const id = `runtime_${createHash('sha256').update(`${binding.sessionId}:${requestId}`).digest('hex').slice(0, 32)}`;
    const prior = this.list().find((item) => item.id === id);
    if (prior !== undefined) return prior;
    const task = binding.taskId === undefined ? undefined : this.#store.tasks.get(binding.taskId);
    const attempt = binding.attemptId === undefined ? undefined : this.#store.executions.getAttempt(binding.attemptId);
    const timestamp = nowIso();
    const item: RuntimeInteraction = { requestHash, id, requestId, protocol, kind, state: 'open', binding, ...(task === undefined ? {} : { taskTitle: task.title }), contextTitle: task?.title ?? `${this.#store.projects.get(binding.projectId)?.name ?? '项目'} · 知识对话`, stepName: attempt?.definition?.node.title ?? (binding.knowledgeRequestKey !== undefined ? '知识研究员' : binding.roundId === undefined ? '运行会话' : '规划会话'), permission, patterns: [...patterns], hard, questions, reason: hard ? '请求超出当前会话冻结的只读授权上限；已拒绝或正在核对拒绝结果，此处不能授权' : kind === 'question' ? '运行时正在等待你的回答，其他步骤可以继续' : '仅可在当前会话冻结的只读授权范围内答复', createdAt: timestamp, updatedAt: timestamp };
    this.#put(item); return item;
  }
  async #automaticReject(item: RuntimeInteraction) { await this.#automatic(item, 'reject'); }
  async #automaticOnce(item: RuntimeInteraction) { if (this.#allowed(item)) await this.#automatic(item, 'once'); }
  async #automatic(item: RuntimeInteraction, action: 'reject' | 'once') {
    if (item.state !== 'open' || this.get(item.id).requestKey !== undefined) return;
    const key = `req_auto_${item.id}`;
    const begun = this.#commands.begin({ requestKey: key, operation, body: { id: item.id, automatic: action }, target: { taskId: item.binding.taskId, projectId: item.binding.projectId } });
    if (begun.replayed) return;
    this.#put({ ...item, state: 'unknown', requestKey: key, resolution: { action }, updatedAt: nowIso() });
    try {
      if (!this.#port.replyRuntimePermission) throw new Error('运行时未提供权限答复接口');
      await this.#port.replyRuntimePermission(item.binding.sessionId, item.requestId, action, item.protocol);
      this.#commands.settle(key);
      this.#put({ ...this.get(item.id), state: item.hard ? 'open' : 'resolved', ...(item.hard ? { requestKey: undefined, resolution: undefined } : {}), confirmation: { action }, updatedAt: nowIso() });
    } catch (error) {
      const latest = this.get(item.id);
      if (this.#commands.get(key)?.status === 'succeeded') return;
      if (this.#matches(latest)) { this.#commands.settle(key); this.#put({ ...latest, state: item.hard ? 'open' : 'resolved', ...(item.hard ? { requestKey: undefined, resolution: undefined } : {}) }); return; }
      this.#commands.fail(key, error instanceof Error ? error : new Error(String(error)), true);
      this.#put({ ...latest, state: 'unknown', reason: '运行时答复结果未知；只能核对原请求，不会自动重发', updatedAt: nowIso() });
    }
  }
  #runtimeAnswers(item: RuntimeInteraction, input: RuntimeInteractionResolveRequest): readonly (readonly string[])[] | undefined {
    if (input.action === 'reject') return undefined;
    if (input.action !== 'answer' || !Array.isArray(input.answers) || input.answers.length !== item.questions.length || new Set(input.answers.map((answer) => answer.questionId)).size !== item.questions.length) throw new AppError(ErrorCode.VALIDATION_FAILED, '必须答复原请求中的每个问题');
    return item.questions.map((question) => {
      const answer = input.answers!.find((answer) => answer.questionId === question.id);
      if (!answer) throw new AppError(ErrorCode.VALIDATION_FAILED, '问题身份不匹配');
      if (answer.values !== undefined && (!Array.isArray(answer.values) || answer.values.some((value) => typeof value !== 'string'))) throw new AppError(ErrorCode.VALIDATION_FAILED, '答复选项必须是字符串数组');
      if (answer.other !== undefined && typeof answer.other !== 'string') throw new AppError(ErrorCode.VALIDATION_FAILED, '其他答复必须是文字');
      const values = answer.values ?? []; const other = answer.other?.trim() ?? '';
      if (new Set(values).size !== values.length || values.some((id) => !question.options?.some((option) => option.id === id)) || (other && question.allowOther === false)) throw new AppError(ErrorCode.VALIDATION_FAILED, '答复选项不属于此问题、重复或不允许其他答复');
      const labels = values.map((id) => question.options!.find((option) => option.id === id)!.label);
      if (other) labels.push(other);
      if (labels.length === 0 || (question.multiple !== true && labels.length > 1)) throw new AppError(ErrorCode.VALIDATION_FAILED, '请选择或填写有效答复（单选不能同时填写其他）');
      if (labels.join('\n').length > 16000) throw new AppError(ErrorCode.VALIDATION_FAILED, '答复不能超过16000字');
      return labels;
    });
  }
  async resolve(id: string, input: RuntimeInteractionResolveRequest) {
    if (input === null || typeof input !== 'object' || typeof input.requestKey !== 'string') throw new AppError(ErrorCode.VALIDATION_FAILED, '互动答复格式不合法');
    const body = { id, ...input, requestKey: undefined };
    const replay = this.#commands.replay({ requestKey: input.requestKey, operation, body });
    if (replay !== undefined) return replay;
    if (input.confirmResolve !== true) throw new AppError(ErrorCode.VALIDATION_FAILED, '需要显式确认');
    const item = this.get(id);
    if (this.view(item).resolveAllowed === false && item.state === 'open') throw new AppError(ErrorCode.FORBIDDEN, this.view(item).unavailableReason ?? '原请求当前不能答复');
    if (item.state !== 'open' || item.requestKey !== undefined) throw new AppError(ErrorCode.OPERATION_IN_PROGRESS, '原请求已处理或结果未知，请核对原请求号');
    if (item.hard && input.action !== 'ack') throw new AppError(ErrorCode.FORBIDDEN, '硬性策略只能知晓，不能授权');
    if (!item.hard && !this.#active(item.binding)) throw new AppError(ErrorCode.STALE_TARGET, '原会话或执行尝试已不再活动');
    if (item.kind === 'permission' && (!['once','session','reject'].includes(input.action) || (input.action !== 'reject' && !this.#allowed(item)))) throw new AppError(ErrorCode.FORBIDDEN, '请求不在冻结且当前仍有效的只读授权上限内');
    const answers = item.kind === 'question' ? this.#runtimeAnswers(item, input) : undefined;
    if (!item.hard) {
      if (!this.#port.runtimeRequests) throw new AppError(ErrorCode.OPENCODE_NOT_READY, '运行时未提供原请求核对');
      const pending = await this.#port.runtimeRequests(item.binding.sessionId, item.kind === 'question' ? 'question' : 'permission', item.protocol);
      const original = pending.find((request) => request.id === item.requestId && request.sessionID === item.binding.sessionId);
      if (original === undefined) throw new AppError(ErrorCode.STALE_TARGET, '运行时原请求已不可读，不能重发');
      const hash = item.kind === 'question' ? stableHash(original.questions) : stableHash({ permission: original.action ?? original.permission, patterns: original.resources ?? original.patterns });
      if (hash !== item.requestHash) throw new AppError(ErrorCode.STALE_TARGET, '运行时原请求内容变化，不能提交');
    }
    const racedReplay = this.#commands.replay({ requestKey: input.requestKey, operation, body });
    if (racedReplay !== undefined) return racedReplay;
    if (!item.hard && !this.#active(item.binding)) throw new AppError(ErrorCode.STALE_TARGET, '核对期间原会话已结束');
    if (item.kind === 'permission' && input.action !== 'reject' && !this.#allowed(item)) throw new AppError(ErrorCode.FORBIDDEN, '核对期间授权上限已收紧');
    // A second caller may have passed the read before the first reply returned.
    if (this.get(id).requestKey !== undefined) throw new AppError(ErrorCode.OPERATION_IN_PROGRESS, '原请求正在处理');
    const begun = this.#commands.begin({ requestKey: input.requestKey, operation, body, target: { taskId: item.binding.taskId, projectId: item.binding.projectId } });
    if (begun.replayed) return { receipt: this.#commands.toReceipt(begun.record) };
    const resolution: RuntimeInteractionResolution = { action: input.action, ...(input.answers === undefined ? {} : { answers: structuredClone(input.answers) }) };
    this.#put({ ...item, requestKey: input.requestKey, resolution, updatedAt: nowIso() });
    try {
      if (item.hard) { /* acknowledgement is local; it never grants a permission */ }
      else if (item.kind === 'question') { if (!this.#port.replyRuntimeQuestion) throw new Error('运行时未提供问题答复'); await this.#port.replyRuntimeQuestion(item.binding.sessionId, item.requestId, answers, item.protocol); }
      else { if (!this.#port.replyRuntimePermission) throw new Error('运行时未提供权限答复'); if (input.action !== 'reject' && !this.#allowed(item)) throw new AppError(ErrorCode.FORBIDDEN, '提交前授权上限已收紧'); await this.#port.replyRuntimePermission(item.binding.sessionId, item.requestId, input.action === 'reject' ? 'reject' : 'once', item.protocol); }
      if (input.action === 'session') this.#sessionGrants.set(this.#grant(item), item.binding.sessionId);
      this.#put({ ...this.get(id), state: 'resolved', updatedAt: nowIso() });
      return { receipt: this.#commands.toReceipt(this.#commands.settle(input.requestKey, { action: input.action, interactionId: id })), resource: this.view(this.get(id)) };
    } catch (error) {
      const latest = this.get(id);
      if (this.#matches(latest)) { this.#put({ ...latest, state: 'resolved', updatedAt: nowIso() }); return { receipt: this.#commands.toReceipt(this.#commands.settle(input.requestKey, { action: input.action, interactionId: id })), resource: this.view(this.get(id)) }; }
      this.#put({ ...latest, state: 'unknown', reason: '答复结果未知；请核对原请求号，不会自动重发', updatedAt: nowIso() });
      return { receipt: this.#commands.toReceipt(this.#commands.fail(input.requestKey, error instanceof Error ? error : new Error(String(error)), true)), resource: this.view(this.get(id)) };
    }
  }
  #canonicalAnswers(answers: RuntimeInteractionResolution['answers']) { return answers?.map((answer) => ({ questionId: answer.questionId, values: [...(answer.values ?? [])].sort(), other: answer.other?.trim() ?? '' })).sort((left, right) => left.questionId.localeCompare(right.questionId)); }
  #matches(item: RuntimeInteraction): boolean {
    if (!item.resolution || !item.confirmation) return false;
    const action = item.resolution.action === 'session' ? 'once' : item.resolution.action;
    return action === item.confirmation.action && (action !== 'answer' || stableHash(this.#canonicalAnswers(item.resolution.answers)) === stableHash(this.#canonicalAnswers(item.confirmation.answers)));
  }
  confirm(event: InteractionConfirmation) {
    const item = this.list().find((item) => item.binding.sessionId === event.sessionID && item.requestId === event.requestID && (item.kind === 'question') === (event.kind === 'question'));
    if (!item || item.state === 'resolved') return;
    const action = event.kind === 'permission' ? event.reply === 'reject' ? 'reject' : event.reply === 'once' ? 'once' : undefined : event.rejected ? 'reject' : 'answer';
    if (action === undefined) return;
    const confirmation: RuntimeInteractionResolution = { action, ...(action !== 'answer' ? {} : { answers: item.questions.map((question, index) => { const labels = event.answers?.[index] ?? []; const values = question.options?.filter((option) => labels.includes(option.label)).map((option) => option.id) ?? []; const other = labels.filter((label) => !question.options?.some((option) => option.label === label)).join('\n'); return { questionId: question.id, values, ...(other ? { other } : {}) }; }) }) };
    const updated = { ...item, confirmation, updatedAt: nowIso() };
    this.#put({ ...updated, ...(!item.resolution && !item.hard ? { state: 'resolved' as const, reason: '运行时已明确确认此请求的答复' } : {}) });
    if (this.#matches(updated) && updated.requestKey !== undefined) { if (updated.resolution?.action === 'session' && this.#allowed(updated)) this.#sessionGrants.set(this.#grant(updated), updated.binding.sessionId); this.#commands.settle(updated.requestKey); this.#put({ ...updated, state: updated.hard ? 'open' : 'resolved', ...(updated.hard ? { requestKey: undefined, resolution: undefined } : {}) }); }
  }
  recoverOnStartup(): void {
    for (const item of this.list()) {
      if (item.state === 'resolved') continue;
      if (item.requestKey !== undefined) {
        const receipt = this.#commands.get(item.requestKey);
        if (receipt?.status === 'accepted') this.#commands.fail(item.requestKey, new Error('服务重启，原运行时答复确认未完成'), true);
      }
      if (!item.hard || item.state === 'unknown') this.#put({ ...item, state: 'unknown', reason: '服务已重启，原会话上下文待核对；不会自动答复或重发', updatedAt: nowIso() });
    }
  }
  async reconcileOperation(key: string): Promise<void> {
    const record = this.#commands.get(key);
    if (record?.operation !== operation || !['accepted','unknown'].includes(record.status)) return;
    const item = this.list().find((item) => item.requestKey === key);
    if (!item) return;
    if (this.#matches(item)) { this.#commands.settle(key); this.#put({ ...item, state: item.hard && item.resolution?.action === 'reject' ? 'open' : 'resolved', ...(item.hard && item.resolution?.action === 'reject' ? { requestKey: undefined, resolution: undefined } : {}), updatedAt: nowIso() }); return; }
    // Read only. Presence may explain that the runtime still waits; absence is
    // not evidence of the decision and can never settle or resend the command.
    const pending = await this.#port.runtimeRequests?.(item.binding.sessionId, item.kind === 'question' ? 'question' : 'permission', item.protocol).catch(() => undefined);
    if (pending !== undefined && this.get(item.id).state === 'unknown') this.#put({ ...this.get(item.id), reason: pending.some((request) => request.id === item.requestId && request.sessionID === item.binding.sessionId) ? '只读核对：原运行时仍在等待此请求，答复结果未确认，不会重发' : '只读核对：待处理列表已无此请求，但这不能证明原答复成功，仍保持未知', updatedAt: nowIso() });
  }
}

/** Only requests belonging to the task's current immutable execution context count. */
export function runtimeTaskAttention(store: Store, task: import('@agent-workflow/shared').Task): 'waiting_user' | 'unknown' | undefined {
  const pending = (store.settings.getJson<readonly RuntimeInteraction[]>(INDEX) ?? []).filter((item) => {
    if (item.binding.taskId !== task.id || item.binding.projectId !== task.projectId || item.state === 'resolved' || (item.hard && item.state !== 'unknown')) return false;
    if (item.binding.executionId !== undefined) {
      const execution = store.executions.get(item.binding.executionId);
      return task.executionId === item.binding.executionId && execution?.nodes.some((node) => node.nodeId === item.binding.nodeId && node.currentAttemptId === item.binding.attemptId && (node.status === 'running' || node.status === 'unknown')) === true;
    }
    return item.binding.roundId !== undefined && task.currentPlanningRoundId === item.binding.roundId;
  });
  return pending.some((item) => item.state === 'unknown') ? 'unknown' : pending.length ? 'waiting_user' : undefined;
}
