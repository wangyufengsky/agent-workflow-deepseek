import { normalizeQuestionAnswer, questionChoices, type QuestionChoices } from '@agent-workflow/shared';
import type {
  CommandResponse,
  PlanningApplyRequest,
  PlanningPreview,
  PlanningPreviewRequest,
  PlanningRejectRequest,
  PlanningResponse,
  PlanningRound,
  PlanningStartRequest,
  PlanningStopRequest,
  PlanNode,
  PlanValidation,
  Project,
  CatalogSnapshot,
  SaveAnswerRequest,
  Task,
  WorkflowMethod,
} from '@agent-workflow/shared';
import {
  AppError,
  ErrorCode,
  PLANNING_CANDIDATE_SCOPE_KEY,
  PLANNING_GROUP_REFINED_KEY,
  PLANNING_ROUND_SCOPE_KEY,
  PlanningGroupState,
  PlanningStage,
  SCOPE_UNREFINED,
  SCOPE_VIOLATION,
  TaskAttention,
  TaskStage,
  canTransition,
  createId,
  findMethod,
  groupLeafNodes,
  isPlaceholderNode,
  mergeScopedCandidate,
  nowIso,
  planningStageMachine,
  unresolvedPlanScopes,
  validatePlanningCandidate,
  validateScopedCandidate,
  withRefinedGroup,
  DEFAULT_CATALOG,
  type PlanningCandidateScope,
  type PlanningGroupProposal,
  type PlanningGroupStateValue,
  type PlanningProposal,
  type PlanningRoundScope,
  type RefineScopePreview,
} from '@agent-workflow/shared';
import type { Store } from '@agent-workflow/storage';
import type { OpenCodePort, OpenCodeRunResult } from './ports.ts';
import type { CommandService } from './operations.ts';
import { readOnlyRecoveryError, type EngineContext } from './actions.ts';
import { buildPlanningPrompt, PLANNING_SYSTEM_PROMPT, PLANNING_OUTPUT_SCHEMA } from '@agent-workflow/opencode';
import type { SessionSink } from '@agent-workflow/opencode';
import { candidateToGraph, diffGraphs, graphStats, methodToGraph } from './graph.ts';
import type { TaskService } from './project-task.ts';

interface PreviewRecord {
  readonly preview: PlanningPreview;
  readonly taskId: string;
  readonly methodId: string;
  readonly inputRevision: number;
  readonly createdOrdinal: number;
}

/** A PE37 scope preview: read-only, no model dispatch until `start`. */
interface RefinePreviewRecord {
  readonly preview: RefineScopePreview;
  readonly taskId: string;
  readonly scope: PlanningRoundScope;
  readonly inputRevision: number;
  readonly createdOrdinal: number;
}

/** Scope can be attached to the normal planning.start input by the HTTP layer. */
export type ScopedPlanningStartInput = PlanningStartRequest & { readonly scope?: { readonly groupRef: string } };

export interface SubmitCandidateResult {
  readonly ok: boolean;
  readonly planRevisionId?: string;
  readonly problems: readonly unknown[];
  readonly humanDecisions: readonly unknown[];
  readonly requiredQuestions: readonly string[];
}

export class PlanningService {
  readonly #store: Store;
  readonly #commands: CommandService;
  readonly #context: EngineContext;
  readonly #opencode: OpenCodePort;
  readonly #tasks: () => TaskService;
  readonly #catalog: CatalogSnapshot;
  readonly #previews = new Map<string, PreviewRecord>();
  readonly #refinePreviews = new Map<string, RefinePreviewRecord>();
  readonly #activeSessions = new Map<string, string>();
  readonly #stopKeys = new Map<string, string>();
  readonly #startKeys = new Map<string, string>();

  constructor(store: Store, commands: CommandService, context: EngineContext, opencode: OpenCodePort, tasks: () => TaskService, catalog: CatalogSnapshot = DEFAULT_CATALOG) {
    this.#store = store;
    this.#commands = commands;
    this.#context = context;
    this.#opencode = opencode;
    this.#tasks = tasks;
    this.#catalog = catalog;
  }

  /**
   * Startup recovery for planning rounds a previous process left in flight.
   *
   * A round that was running/stopping can never be resumed in a new process, so
   * it becomes `unknown` (the existing `planning.reconcile` path and the
   * round-unknown actions stay available) and is *not* redispatched to the model.
   * A queued round never reached the model, so it is failed. Accepted
   * start/stop receipts of those rounds are settled so `GET /api/operations/:key`
   * is conclusive.
   *
   * Returns the affected task ids so the composition root can recompute attention.
   */
  recoverOnStartup(): readonly string[] {
    const affected: string[] = [];
    for (const task of this.#store.tasks.list()) {
      let recovered = false;
      for (const round of this.#store.planning.list(task.id)) {
        if (round.status !== 'running' && round.status !== 'stopping' && round.status !== 'queued') continue;
        recovered = true;
        const at = nowIso();
        if (round.status === 'queued') {
          const message = '进程重启，排队中的规划轮次未派发模型即中断；请重新预览并开始新一轮。';
          this.#store.planning.update(round.id, {
            status: 'failed',
            stage: 'failed',
            endedAt: at,
            lastActivity: message,
            failure: { code: 'INTERRUPTED', message },
          });
          this.#store.events.publish('planning.changed', { taskId: task.id, roundId: round.id, status: 'failed', stage: 'failed', revision: round.recordSeq.last });
          this.#settleRoundReceipts(task.id, false, new AppError(ErrorCode.INTERNAL_ERROR, message));
          continue;
        }
        const message = '进程重启，规划轮次已中断；本轮不会自动重新派发模型，请先核对原轮次记录。';
        // planning.stage has no UNKNOWN edge from needs_answer; keep that stage.
        const stage = canTransition(planningStageMachine, round.stage, PlanningStage.UNKNOWN) ? PlanningStage.UNKNOWN : round.stage;
        const stop = round.stop === undefined ? undefined : { ...round.stop, processState: 'unknown' as const, accountingState: 'unknown' as const };
        this.#store.planning.update(round.id, {
          status: 'unknown',
          stage,
          endedAt: at,
          lastActivity: message,
          ...(stop === undefined ? {} : { stop }),
        });
        this.#store.events.publish('planning.changed', { taskId: task.id, roundId: round.id, status: 'unknown', stage, revision: round.recordSeq.last });
        this.#settleRoundReceipts(task.id, true, new AppError(ErrorCode.INTERNAL_ERROR, message));
      }
      if (recovered) affected.push(task.id);
    }
    return affected;
  }

  #settleRoundReceipts(taskId: string, unknown: boolean, failure: AppError): void {
    for (const operation of this.#store.operations.listPending()) {
      if (operation.operation !== 'planning.start' && operation.operation !== 'planning.stop') continue;
      if (operation.target.taskId !== taskId) continue;
      const record = this.#commands.get(operation.requestKey);
      if (record === undefined || record.status !== 'accepted') continue;
      this.#commands.fail(operation.requestKey, failure, unknown);
    }
  }

  preview(taskId: string, request: PlanningPreviewRequest = {}): PlanningPreview {
    const task = this.#assertWritable(taskId, '生成规划预览');
    if (task.fixedTemplate !== undefined) {
      throw new AppError(ErrorCode.FIXED_TEMPLATE_LOCKED, '固定模板任务不能使用 AI 规划');
    }
    const method = this.#method(task);
    const project = this.#requireProject(task.projectId);
    const settings = this.#context.settings();
    const rounds = this.#store.planning.list(taskId);
    const ordinal = request.roundOrdinal ?? rounds.length + 1;
    const blockers: { code: string; message: string; goTo?: string }[] = [];

    if (method.support !== 'ai_planning') {
      blockers.push({ code: 'PLANNING_UNAVAILABLE', message: '该流程尚未配置 AI 规划；可使用骨架并手动调整' });
    }
    if (!this.#context.opencodeReady()) {
      blockers.push({ code: 'OPENCODE_NOT_READY', message: '受管 OpenCode 服务未就绪', goTo: '/settings' });
    }
    if (settings.planning.budgetLimit <= 0) {
      blockers.push({ code: 'BUDGET_NOT_CONFIGURED', message: '本轮预算上限未设置', goTo: '/settings' });
    }
    const rootAvailable = project.rootPath.trim() !== '';
    if (!rootAvailable) {
      blockers.push({ code: 'SOURCE_UNAVAILABLE', message: '项目路径不可用', goTo: '/settings' });
    }
    const previewId = `preview_${taskId}_${ordinal}_${task.requirement.revision}_${createId('p').split('_').at(-1)}`;
    const expiresAt = new Date(Date.now() + settings.planning.previewTtlMinutes * 60_000).toISOString();
    const model = this.#plannerModel();
    const preview: PlanningPreview = {
      previewId,
      taskId,
      roundOrdinal: ordinal,
      sourceInputRevision: task.requirement.revision,
      project: { id: project.id, name: project.name },
      sources: [
        { label: '需求原文', readable: true, detail: `${task.requirement.entries.length} 个条目` },
        { label: '补充需求', readable: true, detail: task.requirement.supplements.length === 0 ? '无' : `${task.requirement.supplements.length} 条` },
        { label: '项目资料', readable: true, detail: `项目根目录可读（只读）` },
      ],
      method: { name: method.name, revision: method.revision },
      strategy: { name: method.planningStrategy?.id ?? 'planning', version: method.planningStrategy?.version ?? 'v1' },
      model,
      dispatchLimit: { drafts: settings.planning.maxDrafts, revisions: settings.planning.maxRevisions, transportRetries: settings.planning.transportRetries },
      timeLimitMinutes: settings.planning.timeLimitMinutes,
      perDispatchLimitMinutes: settings.planning.perDispatchLimitMinutes,
      budget: { limit: settings.planning.budgetLimit, reserved: 0, currency: settings.planning.currency },
      graphLimits: {
        nodes: settings.planning.maxNodes,
        edges: settings.planning.maxEdges,
        groups: settings.planning.maxGroups,
        depth: settings.planning.maxDepth,
      },
      expiresAt,
      blockers,
      notes: [
        '确认后不改当前图；候选需要你审阅、应用、确认。',
        '本轮最多 2 次模型派发：初稿 1 + 修订 1；自动传输重试 0。',
        '离开页面不会停止规划。',
      ],
    };
    this.#previews.set(previewId, {
      preview,
      taskId,
      methodId: method.id,
      inputRevision: task.requirement.revision,
      createdOrdinal: ordinal,
    });
    return preview;
  }

  start(taskId: string, input: ScopedPlanningStartInput): CommandResponse<PlanningResponse> {
    const originalReceipt = this.#commands.replay({ requestKey: input.requestKey, operation: 'planning.start', body: { taskId, previewId: input.previewId, sourceInputRevision: input.sourceInputRevision, confirmModelDispatch: true, ...(input.scope === undefined ? {} : { scope: { groupRef: input.scope.groupRef } }) } }, () => this.planningResponse(taskId));
    if (originalReceipt !== undefined) return originalReceipt;
    const task = this.#assertWritable(taskId, '开始规划');
    const previewRecord = this.#previews.get(input.previewId);
    const refineRecord = this.#refinePreviews.get(input.previewId);
    if (previewRecord === undefined && refineRecord === undefined) {
      throw new AppError(ErrorCode.STALE_TARGET, '规划预览已失效，请重新预览');
    }
    if (input.scope !== undefined) {
      if (refineRecord === undefined) throw new AppError(ErrorCode.STALE_TARGET, '分组细化预览已失效，请重新预览');
      if (refineRecord.scope.groupRef !== input.scope.groupRef) {
        throw new AppError(ErrorCode.STALE_TARGET, '细分范围与预览不一致，请重新预览', { details: { previewGroupRef: refineRecord.scope.groupRef } });
      }
    } else if (refineRecord !== undefined && previewRecord === undefined) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, '该预览是分组细化预览，启动时必须携带 scope.groupRef', { details: { groupRef: refineRecord.scope.groupRef } });
    }
    const preview = refineRecord?.preview ?? previewRecord!.preview;
    if (Date.parse(preview.expiresAt) < Date.now()) {
      this.#previews.delete(input.previewId);
      this.#refinePreviews.delete(input.previewId);
      throw new AppError(ErrorCode.STALE_TARGET, '规划预览已过期，请重新预览');
    }
    const inputRevision = refineRecord?.inputRevision ?? previewRecord!.inputRevision;
    if (inputRevision !== input.sourceInputRevision) {
      throw new AppError(ErrorCode.STALE_TARGET, '需求输入已变化，请重新预览');
    }
    if (preview.blockers.length > 0) {
      throw new AppError(ErrorCode.PLANNING_UNAVAILABLE, preview.blockers[0]?.message ?? '配置不足，无法开始规划', {
        details: { blockers: preview.blockers },
      });
    }
    const scopeInfo = refineRecord?.scope;
    if (scopeInfo !== undefined) {
      const basePlan = this.#store.plans.get(scopeInfo.basePlanRevisionId);
      if (basePlan === undefined || task.currentPlanRevisionId !== basePlan.id) {
        throw new AppError(ErrorCode.STALE_TARGET, '总览草稿已变化，请重新预览分组细化', { details: { basePlanRevisionId: scopeInfo.basePlanRevisionId } });
      }
      const group = basePlan.graph.groups.find((item) => item.id === scopeInfo.groupRef);
      const placeholders = basePlan.graph.nodes.filter((node) => node.groupId === scopeInfo.groupRef && isPlaceholderNode(node));
      if (group === undefined || (group.refined !== false && placeholders.length === 0)) {
        throw new AppError(ErrorCode.VALIDATION_FAILED, '该分组已细化，无需继续规划', { details: { groupRef: scopeInfo.groupRef } });
      }
    }
    const { record, replayed } = this.#commands.begin({
      requestKey: input.requestKey,
      operation: 'planning.start',
      body: {
        taskId,
        previewId: input.previewId,
        sourceInputRevision: input.sourceInputRevision,
        confirmModelDispatch: true,
        ...(scopeInfo === undefined ? {} : { scope: { groupRef: scopeInfo.groupRef } }),
      },
      target: { taskId },
    });
    if (replayed) {
      return { receipt: this.#commands.toReceipt(record), resource: this.planningResponse(taskId) };
    }
    const method = this.#method(task);
    const rounds = this.#store.planning.list(taskId);
    const round = this.#store.planning.create({
      taskId,
      ordinal: rounds.length + 1,
      inputRevision: task.requirement.revision,
      method: { id: method.id, revision: method.revision, name: method.name },
      strategy: { id: method.planningStrategy?.id ?? 'planning', version: method.planningStrategy?.version ?? 'v1' },
      model: this.#plannerModel(),
      usage: {
        dispatches: { used: 0, maximum: this.#context.settings().planning.maxDrafts + this.#context.settings().planning.maxRevisions },
        revisions: { used: 0, maximum: this.#context.settings().planning.maxRevisions },
        budget: {
          known: 0,
          reserved: 0,
          unknown: 0,
          currency: this.#context.settings().planning.currency,
          limit: this.#context.settings().planning.budgetLimit,
        },
        tokens: { input: 0, output: 0, reasoning: 0, cache: 0, total: 0 },
      },
      previousRoundId: rounds[0]?.id,
    });
    this.#store.planning.update(round.id, {
      status: 'running',
      stage: 'preparing_input',
      startedAt: nowIso(),
      lastActivity: '开始准备输入',
      stageRuns: [{ stage: 'preparing_input', state: 'running', startedAt: nowIso() }],
    });
    this.#store.tasks.update(taskId, {
      stage: TaskStage.PLANNING,
      attention: TaskAttention.NONE,
      currentPlanningRoundId: round.id,
    });
    this.#store.events.publish('task.changed', { taskId, projectId: task.projectId, stage: TaskStage.PLANNING, revision: 1 });
    this.#store.events.publish('planning.changed', { taskId, roundId: round.id, status: 'running', stage: 'preparing_input', revision: 1 });
    if (scopeInfo !== undefined) this.#store.settings.putJson(`${PLANNING_ROUND_SCOPE_KEY}${round.id}`, scopeInfo);
    this.#startKeys.set(round.id, input.requestKey);
    this.#previews.delete(input.previewId);
    this.#refinePreviews.delete(input.previewId);
    void this.#runRound(taskId, round.id, method, scopeInfo).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : '规划执行失败';
      this.#failRound(round.id, input.requestKey, message);
    });
    return { receipt: this.#commands.toReceipt(this.#commands.get(input.requestKey)!), resource: this.planningResponse(taskId) };
  }

  async #runRound(taskId: string, roundId: string, method: WorkflowMethod, scope?: PlanningRoundScope): Promise<void> {
    const task = this.#requireTask(taskId);
    const project = this.#requireProject(task.projectId);
    const round = this.#requireRound(roundId);
    const settings = this.#context.settings();
    let seq = 0;
    const record = (input: Parameters<Store['planning']['appendRecord']>[1]) => {
      const fragmentId = input.fragmentId || createId('fragment');
      seq = this.#store.planning.appendRecord(roundId, { ...input, fragmentId });
      this.#store.journal.append(`planning-${roundId}`, {
        type: input.category,
        at: input.at ?? nowIso(),
        text: input.text,
        blockId: input.blockId,
        toolCall: input.toolCall,
      });
      this.#store.events.publish('planning.output.appended', {
        taskId,
        roundId,
        seq,
        fragmentId,
        category: input.category as 'model_text',
        text: input.text,
        blockId: input.blockId,
      });
    };
    record({ fragmentId: `${roundId}-start`, category: 'service_event', at: nowIso(), text: '服务事实：开始准备输入', metadata: { stage: 'preparing_input' } });
    this.#store.planning.update(roundId, {
      stage: 'generating',
      lastActivity: '生成候选',
      stageRuns: [
        { stage: 'preparing_input', state: 'completed', startedAt: round.startedAt, endedAt: nowIso() },
        { stage: 'generating', state: 'running', startedAt: nowIso() },
      ],
    });
    this.#store.events.publish('planning.changed', { taskId, roundId, status: 'running', stage: 'generating', revision: 2 });

    let bufferedText = '';
    let bufferedBlock = '';
    let flushTimer: NodeJS.Timeout | undefined;
    let totalChars = 0;
    let overflowed = false;
    let sessionId: string | undefined;
    const flushText = () => {
      if (flushTimer !== undefined) {
        clearTimeout(flushTimer);
        flushTimer = undefined;
      }
      if (bufferedText === '') return;
      record({ fragmentId: `${roundId}:text:${seq + 1}`, category: 'model_text', text: bufferedText, blockId: bufferedBlock, at: nowIso() });
      bufferedText = '';
    };
    const sink: SessionSink = {
      onTextDelta: (delta, info) => {
        totalChars += delta.length;
        bufferedText += delta;
        bufferedBlock = info.partId;
        this.#store.planning.update(roundId, { lastActivity: '模型输出中' });
        if (totalChars > 30_000 && !overflowed) {
          overflowed = true;
          record({ fragmentId: `${roundId}-overflow`, category: 'service_event', at: nowIso(), text: '服务事实：模型输出超过 30000 字上限，已请求停止' });
          if (sessionId !== undefined) void this.#opencode.abortSession(sessionId).catch(() => undefined);
        }
        if (bufferedText.length >= 800) flushText();
        else if (flushTimer === undefined) flushTimer = setTimeout(flushText, 700);
      },
      onTextEnded: () => {
        flushText();
      },
      onTool: (part, status) => {
        flushText();
        record({
          fragmentId: `${part.callID ?? createId('tool')}:${status}:${seq + 1}`,
          category: 'tool_activity',
          at: nowIso(),
          text: `${part.tool ?? '工具'} · ${status}`,
          toolCall: { callId: part.callID, tool: part.tool, status, source: 'managed_mcp' },
          metadata: { input: part.state?.input, outputExcerpt: part.state?.output?.slice(0, 500) },
        });
        this.#store.planning.update(roundId, { lastActivity: `工具 ${part.tool ?? ''} ${status}` });
      },
      onPermission: (permission) => {
        const denied = ['edit', 'bash', 'webfetch', 'websearch', 'external_directory'];
        return denied.includes(permission.permission) ? 'reject' : 'once';
      },
      onError: (message) => {
        record({ fragmentId: `${roundId}-error-${seq + 1}`, category: 'service_event', at: nowIso(), text: `服务事实：${message}` });
      },
    };

    const basePrompt = buildPlanningPrompt({
      taskId: task.id,
      roundId: round.id,
      taskTitle: task.title,
      requirementText: task.requirement.text,
      projectName: project.name,
      projectRoot: project.rootPath,
      methodName: method.name,
      methodRevision: method.revision,
      requiredSteps: method.requiredSteps.map((step) => ({ key: step.key, title: step.title, kind: step.kind, group: step.group, ...(step.qualityReview === undefined ? {} : { qualityReview: step.qualityReview }) })),
      refinableGroups: method.refinableGroups,
      supplements: task.requirement.supplements.map((supplement) => supplement.text),
      answers: round.questions.filter((question) => question.answer !== undefined).map((question) => ({ question: question.question, answer: question.answer! })),
      limits: {
        maxNodes: settings.planning.maxNodes,
        maxEdges: settings.planning.maxEdges,
        maxGroups: settings.planning.maxGroups,
        maxDepth: settings.planning.maxDepth,
      },
      strategyVersion: `${method.planningStrategy?.id ?? 'planning'} · ${method.planningStrategy?.version ?? 'v1'}`,
    });
    const prompt = scope === undefined ? basePrompt : `${basePrompt}

# 本轮范围（PE37 分组细化）
本轮只细化分组「${scope.groupTitle}」（groupRef=${scope.groupRef}）。
- 只提交该分组内的节点与该组内部依赖；不要提交其他分组的节点或分组，也不要新增组外步骤。
- 其他分组与当前草稿保持不变；跨组依赖按总览连线保留，如确需引用组外步骤，只能引用总览中已存在的组外节点键。
- 越界候选会被 SCOPE_VIOLATION 拒绝，不会写入计划。
`;

    let result: OpenCodeRunResult | undefined;
    try {
      result = await this.#opencode.runSession({
        kind: 'planning',
        metadata: { taskId, roundId, kind: 'planning' },
        cwd: project.rootPath,
        prompt,
        system: PLANNING_SYSTEM_PROMPT,
        model: round.model,
        permission: 'read_only',
        sink,
        timeoutMs: settings.planning.perDispatchLimitMinutes * 60_000,
        abortOnToolCall: ['plan.submit', 'plan_submit', 'plan-submit'],
        onSessionId: (id) => {
          sessionId = id;
          this.#activeSessions.set(roundId, id);
        },
      });
      flushText();
      if (sessionId !== undefined) this.#activeSessions.set(roundId, sessionId);
    } catch (error) {
      const message = error instanceof Error ? error.message : '无法连接受管 OpenCode 服务';
      record({ fragmentId: `${roundId}-dispatch-failed`, category: 'service_event', at: nowIso(), text: `服务事实：模型派发失败：${message}` });
      this.#failRound(roundId, this.#startKeys.get(roundId), message);
      return;
    }

    flushText();
    let latest = this.#requireRound(roundId);
    const stopRequested = latest.stop !== undefined;
    if (latest.candidate === undefined && !stopRequested) {
      const fallback = extractCandidateJson(result.outcome.assistantText);
      if (fallback !== undefined) {
        const submitted = this.submitCandidate({ taskId, roundId, candidate: fallback });
        record({
          fragmentId: `${roundId}-fallback-submit`,
          category: 'service_event',
          at: nowIso(),
          text: submitted.ok ? '服务事实：模型未调用提交工具，已从正文解析候选并校验' : '服务事实：从正文解析到候选，但校验未通过',
          metadata: { problems: submitted.problems.length },
        });
        latest = this.#requireRound(roundId);
      }
    }
    const candidateSubmitted = latest.candidate !== undefined;
    if (overflowed && !candidateSubmitted) {
      this.#failRound(roundId, this.#startKeys.get(roundId), '模型输出超过上限且未提交候选计划');
      return;
    }
    const cost = (result.outcome.messages ?? [])
      .filter((message) => message.info.role === 'assistant')
      .reduce((sum, message) => sum + (message.info.cost ?? 0), 0);
    const priorTokens = latest.usage.tokens ?? { input: 0, output: 0, reasoning: 0, cache: 0, total: 0 };
    const dispatchTokens = (result.outcome.messages ?? [])
      .filter((message) => message.info.role === 'assistant')
      .reduce((sum, message) => {
        const raw = message.info.tokens ?? {};
        const num = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);
        const cache = raw['cache'] !== null && typeof raw['cache'] === 'object' ? raw['cache'] as Record<string, unknown> : {};
        const input = num(raw['input']);
        const output = num(raw['output']);
        const reasoning = num(raw['reasoning']);
        const cacheRead = num(cache['read']);
        const cacheWrite = num(cache['write']);
        return {
          input: sum.input + input,
          output: sum.output + output,
          reasoning: sum.reasoning + reasoning,
          cache: sum.cache + cacheRead + cacheWrite,
          total: sum.total + input + output + reasoning + cacheRead + cacheWrite,
        };
      }, { input: 0, output: 0, reasoning: 0, cache: 0, total: 0 });
    const tokens = {
      input: priorTokens.input + dispatchTokens.input,
      output: priorTokens.output + dispatchTokens.output,
      reasoning: priorTokens.reasoning + dispatchTokens.reasoning,
      cache: priorTokens.cache + dispatchTokens.cache,
      total: priorTokens.total + dispatchTokens.total,
    };
    const usage = {
      ...latest.usage,
      dispatches: { ...latest.usage.dispatches, used: latest.usage.dispatches.used + 1 },
      tokens,
      budget: {
        ...latest.usage.budget,
        known: cost,
        unknown: cost === 0 ? latest.usage.budget.unknown + 1 : latest.usage.budget.unknown,
      },
    };

    if (stopRequested) {
      record({ fragmentId: `${roundId}-stopped`, category: 'service_event', at: nowIso(), text: '服务事实：已停止；用量已结账' });
      this.#store.planning.update(roundId, {
        status: 'stopped',
        stage: latest.candidate === undefined ? 'stopped' : latest.stage,
        endedAt: nowIso(),
        usage,
        lastActivity: '已停止',
        stop: { ...latest.stop!, processState: 'stopped', accountingState: 'closed', settledAt: nowIso() },
        stageRuns: latest.stageRuns.map((stageRun) => ({ ...stageRun, state: stageRun.state === 'running' ? 'completed' : stageRun.state, endedAt: stageRun.state === 'running' ? nowIso() : stageRun.endedAt })),
      });
      const stopKey = this.#stopKeys.get(roundId);
      if (stopKey !== undefined) this.#commands.settle(stopKey, { stopped: true });
      const startKey = this.#startKeys.get(roundId);
      if (startKey !== undefined) this.#commands.settle(startKey, { stopped: true });
      this.#publishRound(taskId, roundId, 'stopped');
      this.#refreshTask(taskId);
      return;
    }

    if (candidateSubmitted) {
      const validation = latest.candidate?.validation;
      const requiredQuestions = (latest.questions ?? []).filter((question) => question.required && question.answer === undefined);
      const stage = requiredQuestions.length > 0 ? 'needs_answer' : 'awaiting_review';
      const hasHard = validation?.structural.state === 'failed';
      record({
        fragmentId: `${roundId}-candidate`,
        category: 'service_event',
        at: nowIso(),
        text: hasHard ? '服务事实：候选已提交，但存在必须处理的问题' : requiredQuestions.length > 0 ? '服务事实：候选已提交，有必须答复的问题' : '服务事实：候选已提交，等待审阅',
      });
      this.#store.planning.update(roundId, {
        status: hasHard ? 'failed' : 'completed',
        stage: hasHard ? 'failed' : stage,
        endedAt: nowIso(),
        usage,
        lastActivity: hasHard ? '候选校验未通过' : requiredQuestions.length > 0 ? '需要你答复' : '等待审阅',
        failure: hasHard ? { code: 'VALIDATION_FAILED', message: '候选计划未通过结构检查' } : undefined,
        stageRuns: latest.stageRuns.map((stageRun) => ({ ...stageRun, state: 'completed', endedAt: stageRun.endedAt ?? nowIso() })),
      });
      const startKey = this.#startKeys.get(roundId);
      if (startKey !== undefined) {
        if (hasHard) this.#commands.fail(startKey, new AppError(ErrorCode.VALIDATION_FAILED, '候选计划未通过结构检查'));
        else this.#commands.settle(startKey, { roundId, planRevisionId: latest.candidate?.planRevisionId, stage });
      }
      this.#publishRound(taskId, roundId, hasHard ? 'failed' : 'completed');
      this.#refreshTask(taskId);
      return;
    }

    if (result.outcome.timedOut) {
      record({ fragmentId: `${roundId}-timeout`, category: 'service_event', at: nowIso(), text: '服务事实：本轮达到单次时限，已请求停止' });
      this.#store.planning.update(roundId, {
        status: 'unknown',
        stage: 'unknown',
        endedAt: nowIso(),
        usage,
        lastActivity: '达到时限，结果待核对',
        stop: { processState: 'unknown', accountingState: 'unknown', requestedAt: nowIso() },
      });
      const startKey = this.#startKeys.get(roundId);
      if (startKey !== undefined) this.#commands.fail(startKey, new AppError(ErrorCode.MODEL_BUDGET_EXCEEDED, '本轮达到时限，结果待核对'), true);
      this.#publishRound(taskId, roundId, 'unknown');
      this.#refreshTask(taskId);
      return;
    }

    const failureMessage = result.outcome.error ?? '模型未提交候选计划';
    record({ fragmentId: `${roundId}-no-candidate`, category: 'service_event', at: nowIso(), text: `服务事实：${failureMessage}` });
    this.#store.planning.update(roundId, {
      status: 'failed',
      stage: 'failed',
      endedAt: nowIso(),
      usage,
      lastActivity: failureMessage,
      failure: { code: 'PLANNING_UNAVAILABLE', message: failureMessage },
    });
    const startKey = this.#startKeys.get(roundId);
    if (startKey !== undefined) this.#commands.fail(startKey, new AppError(ErrorCode.PLANNING_UNAVAILABLE, failureMessage));
    this.#publishRound(taskId, roundId, 'failed');
    this.#refreshTask(taskId);
  }

  #failRound(roundId: string, requestKey: string | undefined, message: string): void {
    const round = this.#store.planning.get(roundId);
    if (round === undefined) return;
    this.#store.planning.update(roundId, {
      status: 'failed',
      stage: 'failed',
      endedAt: round.endedAt ?? nowIso(),
      lastActivity: message,
      failure: { code: 'INTERNAL_ERROR', message },
    });
    if (requestKey !== undefined) this.#commands.fail(requestKey, new AppError(ErrorCode.INTERNAL_ERROR, message));
    this.#publishRound(round.taskId, roundId, 'failed');
    this.#refreshTask(round.taskId);
  }

  /* ---------------------------------------------------------------- */
  /* PE37 · incremental group refinement                              */
  /* ---------------------------------------------------------------- */

  /**
   * Overview read model for the requirement canvas (design v5 S1): per-group
   * refinement state, leaf count, coverage and the scopes still blocking
   * confirm. Read-only; never calls the model.
   */
  proposal(taskId: string): PlanningProposal {
    const task = this.#requireTask(taskId);
    const settings = this.#context.settings();
    const plan = task.currentPlanRevisionId === undefined
      ? this.#store.plans.latest(taskId)
      : this.#store.plans.get(task.currentPlanRevisionId);
    if (plan === undefined) {
      return {
        taskId,
        groups: [],
        unresolvedScopes: [],
        limits: { maxNodes: settings.planning.maxNodes, maxGroups: settings.planning.maxGroups, maxDepth: settings.planning.maxDepth, currentNodes: 0, currentGroups: 0, projectedLeafCount: 0 },
      };
    }
    const refinedMap = this.#refinedMap(plan.id);
    const rounds = this.#store.planning.list(taskId);
    const active = rounds.find((round) => {
      if (!['queued', 'running', 'stopping', 'completed'].includes(round.status)) return false;
      const scope = this.#roundScope(round.id);
      if (scope === undefined) return false;
      return round.status !== 'completed' || round.applyStatus === 'not_applied';
    });
    const activeScope = active === undefined ? undefined : this.#roundScope(active.id);
    const groups: PlanningGroupProposal[] = plan.graph.groups.map((group) => {
      const placeholders = plan.graph.nodes.filter((node) => node.groupId === group.id && isPlaceholderNode(node));
      const leaves = groupLeafNodes(plan.graph, group.id);
      let state: PlanningGroupStateValue = group.refined === false || placeholders.length > 0 ? PlanningGroupState.UNREFINED : PlanningGroupState.REFINED;
      if (active !== undefined && activeScope !== undefined && activeScope.groupRef === group.id) {
        state = active.status === 'completed' && active.applyStatus === 'not_applied' ? PlanningGroupState.CANDIDATE : PlanningGroupState.PLANNING;
      }
      const coverage = this.#groupCoverage(plan, group.id);
      const refinedInRound = refinedMap[group.id] ?? (group.refined === true && state === PlanningGroupState.REFINED ? 1 : undefined);
      return {
        groupRef: group.id,
        title: group.label,
        coverage,
        state,
        ...(refinedInRound === undefined ? {} : { refinedInRound }),
        leafCount: leaves.length,
        placeholderNodeIds: placeholders.map((node) => node.id),
      };
    });
    const unresolvedScopes = groups.filter((group) => group.state !== PlanningGroupState.REFINED).map((group) => ({ groupRef: group.groupRef, title: group.title }));
    const currentNodes = plan.graph.nodes.filter((node) => !isPlaceholderNode(node)).length;
    return {
      taskId,
      planRevisionId: plan.id,
      revisionNumber: plan.revisionNumber,
      groups,
      unresolvedScopes,
      limits: {
        maxNodes: settings.planning.maxNodes,
        maxGroups: settings.planning.maxGroups,
        maxDepth: settings.planning.maxDepth,
        currentNodes,
        currentGroups: groups.length,
        projectedLeafCount: groups.reduce((sum, group) => sum + group.leafCount, 0),
      },
    };
  }

  /**
   * `refineScope.preview` (design v5 S2): read-only preview for one unrefined
   * group. Returns round/scope/limits/budget/expiresAt and never calls the model;
   * `start` consumes the returned previewRef.
   */
  refinePreview(taskId: string, groupRef: string): RefineScopePreview {
    const task = this.#assertWritable(taskId, '继续规划选区');
    if (task.fixedTemplate !== undefined) throw new AppError(ErrorCode.FIXED_TEMPLATE_LOCKED, '固定模板任务不能使用分组细化');
    const method = this.#method(task);
    const project = this.#requireProject(task.projectId);
    const settings = this.#context.settings();
    const plan = task.currentPlanRevisionId === undefined ? this.#store.plans.latest(taskId) : this.#store.plans.get(task.currentPlanRevisionId);
    if (plan === undefined) throw new AppError(ErrorCode.VALIDATION_FAILED, '当前没有可细化的计划草稿');
    if (plan.status === 'confirmed') throw new AppError(ErrorCode.VALIDATION_FAILED, '计划已确认，不能继续分组细化');
    const group = plan.graph.groups.find((item) => item.id === groupRef);
    if (group === undefined) throw new AppError(ErrorCode.NOT_FOUND, '分组不存在', { details: { groupRef } });
    const placeholders = plan.graph.nodes.filter((node) => node.groupId === groupRef && isPlaceholderNode(node));
    if (group.refined !== false && placeholders.length === 0) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, '该分组已细化，无需继续规划', { details: { groupRef } });
    }
    const activeRound = this.#store.planning.list(taskId).find((round) => ['queued', 'running', 'stopping'].includes(round.status));
    if (activeRound !== undefined) {
      throw new AppError(ErrorCode.OPERATION_IN_PROGRESS, '本轮规划仍在进行，先停止/等待结束再继续规划选区', { details: { roundId: activeRound.id, status: activeRound.status } });
    }
    const blockers: { code: string; message: string }[] = [];
    if (method.support !== 'ai_planning') blockers.push({ code: 'PLANNING_UNAVAILABLE', message: '该流程尚未配置 AI 规划' });
    if (!this.#context.opencodeReady()) blockers.push({ code: 'OPENCODE_NOT_READY', message: '受管 OpenCode 服务未就绪' });
    if (settings.planning.budgetLimit <= 0) blockers.push({ code: 'BUDGET_NOT_CONFIGURED', message: '本轮预算上限未设置' });
    if (project.rootPath.trim() === '') blockers.push({ code: 'SOURCE_UNAVAILABLE', message: '项目路径不可用' });
    const rounds = this.#store.planning.list(taskId);
    const ordinal = rounds.length + 1;
    const currentNodes = plan.graph.nodes.filter((node) => !isPlaceholderNode(node)).length;
    const previewRef = `refine_${taskId}_${groupRef}_${String(ordinal)}_${createId('rp').split('_').at(-1)}`;
    const scope: PlanningRoundScope = {
      groupRef,
      groupTitle: group.label,
      placeholderNodeIds: placeholders.map((node) => node.id),
      basePlanRevisionId: plan.id,
    };
    const preview: RefineScopePreview = {
      previewRef,
      taskId,
      groupRef,
      groupTitle: group.label,
      round: ordinal,
      scope: { groupRef, groupTitle: group.label, placeholderNodeIds: scope.placeholderNodeIds, basePlanRevisionId: plan.id },
      limits: {
        maxNodes: settings.planning.maxNodes,
        maxGroups: settings.planning.maxGroups,
        maxDepth: settings.planning.maxDepth,
        currentNodes,
        currentGroups: plan.graph.groups.length,
        projectedLeafCount: currentNodes,
      },
      budget: {
        dispatches: settings.planning.maxDrafts,
        revisions: settings.planning.maxRevisions,
        budgetLimit: settings.planning.budgetLimit,
        currency: settings.planning.currency,
        perDispatchLimitMinutes: settings.planning.perDispatchLimitMinutes,
        timeLimitMinutes: settings.planning.timeLimitMinutes,
      },
      expiresAt: new Date(Date.now() + settings.planning.previewTtlMinutes * 60_000).toISOString(),
      blockers,
      instructions: [
        `只细化分组「${group.label}」；其他分组与当前草稿不变。`,
        '跨组依赖按总览连线保留。',
        '本轮最多 2 次模型派发：初稿 1 + 修订 1；停止只停本轮。',
        '应用后计划修订 +1，不会执行。全部组细化后才能确认计划。',
      ],
    };
    this.#refinePreviews.set(previewRef, { preview, taskId, scope, inputRevision: task.requirement.revision, createdOrdinal: ordinal });
    return preview;
  }

  /** The persisted scope of a round (undefined for whole-plan rounds). */
  roundScope(roundId: string): PlanningRoundScope | undefined {
    return this.#roundScope(roundId);
  }

  /** The persisted scope of a candidate plan revision (undefined for whole-plan candidates). */
  candidateScope(planRevisionId: string): PlanningCandidateScope | undefined {
    return this.#candidateScope(planRevisionId);
  }

  #roundScope(roundId: string): PlanningRoundScope | undefined {
    return this.#store.settings.getJson<PlanningRoundScope>(`${PLANNING_ROUND_SCOPE_KEY}${roundId}`);
  }

  #candidateScope(planRevisionId: string): PlanningCandidateScope | undefined {
    return this.#store.settings.getJson<PlanningCandidateScope>(`${PLANNING_CANDIDATE_SCOPE_KEY}${planRevisionId}`);
  }

  #refinedMap(planRevisionId: string): Readonly<Record<string, number>> {
    return this.#store.settings.getJson<Record<string, number>>(`${PLANNING_GROUP_REFINED_KEY}${planRevisionId}`) ?? {};
  }

  #putRefinedMap(planRevisionId: string, map: Readonly<Record<string, number>>): void {
    this.#store.settings.putJson(`${PLANNING_GROUP_REFINED_KEY}${planRevisionId}`, map);
  }

  #groupCoverage(plan: import('@agent-workflow/shared').PlanRevision, groupRef: string): readonly string[] {
    const nodeIds = new Set(plan.graph.nodes.filter((node) => node.groupId === groupRef && !isPlaceholderNode(node)).map((node) => node.id));
    const fromValidation = (plan.validation?.requirementCoverage ?? [])
      .filter((coverage) => coverage.nodeIds.some((id) => nodeIds.has(id)))
      .map((coverage) => coverage.label);
    if (fromValidation.length > 0) return [...new Set(fromValidation)];
    const labels = plan.graph.nodes
      .filter((node) => nodeIds.has(node.id))
      .flatMap((node) => node.inputs.filter((input) => input.source === 'requirement').map((input) => input.name));
    return [...new Set(labels)];
  }

  /** Validate + merge one scoped candidate into the overview draft (design S3/S4). */
  #submitScopedCandidate(task: Task, round: PlanningRound, scope: PlanningRoundScope, candidate: import('@agent-workflow/shared').PlanningCandidatePayload): SubmitCandidateResult {
    const base = this.#store.plans.get(scope.basePlanRevisionId);
    if (base === undefined) {
      return { ok: false, problems: [{ code: 'SCOPE_BASE_MISSING', title: '总览草稿不存在', detail: `基准计划 ${scope.basePlanRevisionId} 不可读`, severity: 'hard' }], humanDecisions: [], requiredQuestions: [] };
    }
    if (task.currentPlanRevisionId !== base.id) {
      return { ok: false, problems: [{ code: 'STALE_SCOPE_BASE', title: '总览草稿已变化', detail: '请重新预览本轮分组细化', severity: 'hard' }], humanDecisions: [], requiredQuestions: [] };
    }
    const settings = this.#context.settings();
    const validationResult = validateScopedCandidate({
      candidate,
      baseGraph: base.graph,
      requiredSteps: this.#method(task).requiredSteps.filter(step => step.group === scope.groupTitle && step.qualityReview !== undefined),
      scope,
      limits: {
        maxNodes: settings.planning.maxNodes,
        maxEdges: settings.planning.maxEdges,
        maxGroups: settings.planning.maxGroups,
        maxDepth: settings.planning.maxDepth,
      },
    });
    if (validationResult.structural === 'failed') {
      return { ok: false, problems: validationResult.problems, humanDecisions: [], requiredQuestions: [] };
    }
    const graph = mergeScopedCandidate(base.graph, candidate, scope);
    const diff = diffGraphs(base.graph, graph);
    const humanItems: { id: string; title: string; detail: string; nodeKey?: string; accepted: boolean }[] = (candidate.humanDecisions ?? []).map((decision, index) => ({
      id: `hd-${index + 1}`,
      title: decision.title,
      detail: decision.detail,
      ...(decision.nodeKeys?.[0] === undefined ? {} : { nodeKey: decision.nodeKeys[0] }),
      accepted: false,
    }));
    for (const assumption of (candidate.assumptions ?? []).filter((item) => item.critical)) {
      humanItems.push({ id: `hd-${humanItems.length + 1}`, title: `确认关键假设：${assumption.statement}`, detail: '模型陈述 · 未确认', accepted: false });
    }
    const requiredQuestions = (candidate.questions ?? []).filter((question) => question.required).map((question) => question.question);
    const validation: PlanValidation = {
      structural: { state: 'passed', problems: [] },
      humanReview: { required: humanItems.length, accepted: 0, items: humanItems },
      basis: { state: 'complete', detail: `基于需求修订 ${task.requirement.revision}；只细化分组 ${scope.groupRef}` },
      readiness: { state: 'needs_preparation', detail: '应用该组候选后仍需细化其他未完成分组' },
      checks: validationResult.checks.map((check) => ({ ...check })),
      requirementCoverage: base.validation?.requirementCoverage ?? [],
    };
    if (round.candidate !== undefined) {
      const previous = this.#store.plans.get(round.candidate.planRevisionId);
      if (previous !== undefined) this.#store.plans.setStatus(previous.id, 'superseded');
    }
    const refinedMap = withRefinedGroup(this.#refinedMap(base.id), scope.groupRef, round.ordinal);
    const plan = this.#store.plans.create({
      taskId: task.id,
      source: 'applied',
      graph,
      status: 'draft',
      validation,
      diff,
      baseRevisionId: base.id,
    });
    this.#putRefinedMap(plan.id, refinedMap);
    this.#store.settings.putJson(`${PLANNING_CANDIDATE_SCOPE_KEY}${plan.id}`, { roundId: round.id, groupRef: scope.groupRef, basePlanRevisionId: base.id } satisfies PlanningCandidateScope);
    const questions = (candidate.questions ?? []).map((question, index) => ({
      id: `pq-${index + 1}`,
      question: question.question,
      required: question.required,
      ...questionChoices(question),
      affectedNodeIds: (question.nodeKeys ?? []).map((key) => graph.nodes.find((node) => node.key === key)?.id).filter((id): id is PlanNode['id'] => id !== undefined),
    }));
    const assumptions = (candidate.assumptions ?? []).map((assumption, index) => ({
      id: `pa-${index + 1}`,
      statement: assumption.statement,
      critical: assumption.critical,
      confirmed: false,
      affectedNodeIds: (assumption.nodeKeys ?? []).map((key) => graph.nodes.find((node) => node.key === key)?.id).filter((id): id is PlanNode['id'] => id !== undefined),
    }));
    const unresolved = unresolvedPlanScopes(graph);
    this.#store.planning.update(round.id, {
      candidate: {
        planRevisionId: plan.id,
        summary: candidate.summary,
        diff,
        validation,
        checkpoint: {
          id: createId('checkpoint'),
          roundId: round.id,
          planRevisionId: plan.id,
          coveredGroups: graph.groups.filter((group) => group.refined).map((group) => group.label),
          missingGroups: unresolved.map((item) => item.title),
          savedAt: nowIso(),
          executable: false,
        },
      },
      questions,
      assumptions,
      stage: requiredQuestions.length > 0 ? 'needs_answer' : 'awaiting_review',
      lastActivity: `分组「${scope.groupTitle}」候选已提交，其余 ${String(unresolved.length)} 个组仍未细化`,
    });
    const seq = this.#store.planning.appendRecord(round.id, {
      fragmentId: `${round.id}-scoped-candidate-${plan.id}`,
      category: 'service_event',
      at: nowIso(),
      text: `服务事实：分组「${scope.groupTitle}」候选已提交并通过作用域校验（组内 ${String(candidate.nodes.length)} 步；应用不改动其他分组）`,
      metadata: { planRevisionId: plan.id, groupRef: scope.groupRef, problems: 0 },
    });
    this.#store.events.publish('planning.output.appended', { taskId: task.id, roundId: round.id, seq, fragmentId: `${round.id}-scoped-candidate-${plan.id}`, category: 'service_event', text: '分组候选已提交' });
    this.#publishRound(task.id, round.id, 'running');
    return {
      ok: true,
      planRevisionId: plan.id,
      problems: [],
      humanDecisions: humanItems,
      requiredQuestions,
    };
  }

  /** Called by the internal MCP endpoint when the model submits a candidate. */
  submitCandidate(input: { taskId: string; roundId: string; candidate: unknown }): SubmitCandidateResult {
    const task = this.#requireTask(input.taskId);
    const round = this.#requireRound(input.roundId);
    if (round.taskId !== task.id) throw new AppError(ErrorCode.STALE_TARGET, '轮次与任务不匹配');
    if (round.status !== 'running') {
      return { ok: false, problems: [{ code: 'ROUND_SETTLED', title: '本轮已结算，不能再提交', detail: `当前状态：${round.status}`, severity: 'hard' }], humanDecisions: [], requiredQuestions: [] };
    }
    const method = this.#method(task);
    const candidate = input.candidate as import('@agent-workflow/shared').PlanningCandidatePayload;
    if (candidate === null || typeof candidate !== 'object' || !Array.isArray(candidate.nodes) || !Array.isArray(candidate.edges) || !Array.isArray(candidate.groups)) {
      return { ok: false, problems: [{ code: 'INVALID_CANDIDATE', title: '候选格式不合法', detail: '需要 summary/groups/nodes/edges', severity: 'hard' }], humanDecisions: [], requiredQuestions: [] };
    }
    if (candidate.questions !== undefined && !Array.isArray(candidate.questions as unknown)) throw new AppError(ErrorCode.VALIDATION_FAILED, 'questions必须是数组');
    for (const question of candidate.questions ?? []) questionChoices(question);
    const roundScope = this.#roundScope(round.id);
    if (roundScope !== undefined) return this.#submitScopedCandidate(task, round, roundScope, candidate);
    const settings = this.#context.settings();
    const validationResult = validatePlanningCandidate({
      candidate,
      requiredSteps: method.requiredSteps,
      refinableGroups: method.refinableGroups,
      limits: {
        maxNodes: settings.planning.maxNodes,
        maxEdges: settings.planning.maxEdges,
        maxGroups: settings.planning.maxGroups,
        maxDepth: settings.planning.maxDepth,
      },
    });
    const graph = candidateToGraph(candidate);
    const base = task.currentPlanRevisionId === undefined ? undefined : this.#store.plans.get(task.currentPlanRevisionId);
    const diff = diffGraphs(base?.graph, graph);
    const humanItems = validationResult.humanDecisions.map((decision) => ({ ...decision, accepted: false }));
    const requiredQuestions = (candidate.questions ?? []).filter((question) => question.required).map((question) => question.question);
    const validation: PlanValidation = {
      structural: { state: validationResult.structural, problems: validationResult.problems.map((problem) => ({ ...problem, severity: problem.severity })) },
      humanReview: { required: humanItems.length, accepted: 0, items: humanItems },
      basis: { state: 'complete', detail: `基于需求修订 ${task.requirement.revision}` },
      readiness: { state: validationResult.structural === 'failed' ? 'blocked' : 'needs_preparation', detail: validationResult.structural === 'failed' ? '结构检查未通过' : '确认计划后准备工作区' },
      checks: validationResult.checks.map((check) => ({ ...check })),
      requirementCoverage: validationResult.coverage.map((coverage) => ({
        requirementId: coverage.requirementId,
        label: coverage.label,
        covered: coverage.covered,
        nodeIds: graph.nodes.filter((node) => coverage.nodeKeys.includes(node.key)).map((node) => node.id),
      })),
    };
    if (round.candidate !== undefined) {
      // Replace the previous submission of the same round, keeping history in records.
      const previous = this.#store.plans.get(round.candidate.planRevisionId);
      if (previous !== undefined) this.#store.plans.setStatus(previous.id, 'superseded');
    }
    const plan = this.#store.plans.create({
      taskId: task.id,
      source: 'applied',
      graph,
      status: 'draft',
      validation,
      diff,
      baseRevisionId: base?.id,
    });
    const questions = (candidate.questions ?? []).map((question, index) => ({
      id: `pq-${index + 1}`,
      question: question.question,
      required: question.required,
      ...questionChoices(question),
      affectedNodeIds: (question.nodeKeys ?? []).map((key) => graph.nodes.find((node) => node.key === key)?.id).filter((id): id is PlanNode['id'] => id !== undefined),
    }));
    const assumptions = (candidate.assumptions ?? []).map((assumption, index) => ({
      id: `pa-${index + 1}`,
      statement: assumption.statement,
      critical: assumption.critical,
      confirmed: false,
      affectedNodeIds: (assumption.nodeKeys ?? []).map((key) => graph.nodes.find((node) => node.key === key)?.id).filter((id): id is PlanNode['id'] => id !== undefined),
    }));
    const stage = validationResult.structural === 'failed' ? 'failed' : requiredQuestions.length > 0 ? 'needs_answer' : 'awaiting_review';
    this.#store.planning.update(round.id, {
      candidate: {
        planRevisionId: plan.id,
        summary: candidate.summary,
        diff,
        validation,
        checkpoint: {
          id: createId('checkpoint'),
          roundId: round.id,
          planRevisionId: plan.id,
          coveredGroups: graph.groups.map((group) => group.label),
          missingGroups: [],
          savedAt: nowIso(),
          executable: false,
        },
      },
      questions,
      assumptions,
      stage: stage === 'failed' ? 'generating' : stage,
      lastActivity: stage === 'failed' ? '候选未通过检查，可修正后重新提交' : requiredQuestions.length > 0 ? '需要你答复' : '等待审阅',
    });
    const seq = this.#store.planning.appendRecord(round.id, {
      fragmentId: `${round.id}-candidate-${plan.id}`,
      category: 'service_event',
      at: nowIso(),
      text:
        validationResult.structural === 'failed'
          ? `服务事实：候选校验未通过（${validationResult.problems.length} 个问题）`
          : requiredQuestions.length > 0
            ? '服务事实：候选已提交，有必须答复的问题'
            : '服务事实：候选已提交，检查通过',
      metadata: { planRevisionId: plan.id, problems: validationResult.problems.length },
    });
    this.#store.events.publish('planning.output.appended', { taskId: task.id, roundId: round.id, seq, fragmentId: `${round.id}-candidate-${plan.id}`, category: 'service_event', text: '候选已提交' });
    this.#publishRound(task.id, round.id, 'running');
    return {
      ok: validationResult.structural === 'passed',
      planRevisionId: plan.id,
      problems: validationResult.problems,
      humanDecisions: humanItems,
      requiredQuestions,
    };
  }

  /** Append a model question (optional path; the candidate may already carry them). */
  appendQuestion(input: { taskId: string; roundId: string; question: string; required: boolean; nodeKeys?: readonly string[] } & QuestionChoices): void {
    const round = this.#requireRound(input.roundId);
    if (round.taskId !== input.taskId) throw new AppError(ErrorCode.STALE_TARGET, '问题轮次与任务不匹配');
    const choices = questionChoices(input);
    const questions = [
      ...round.questions,
      {
        id: createId('pq'),
        question: input.question,
        ...choices,
        required: input.required,
        affectedNodeIds: [],
        ...(input.nodeKeys === undefined ? {} : { nodeKeysHint: input.nodeKeys }),
      },
    ];
    this.#store.planning.update(round.id, { questions, stage: input.required ? 'needs_answer' : round.stage });
    this.#publishRound(input.taskId, round.id, round.status);
  }

  stop(taskId: string, input: PlanningStopRequest): CommandResponse<PlanningResponse> {
    const originalReceipt = this.#commands.replay({ requestKey: input.requestKey, operation: 'planning.stop', body: { taskId, roundId: input.roundId, confirmStop: true } }, () => this.planningResponse(taskId));
    if (originalReceipt !== undefined) return originalReceipt;
    const task = this.#assertWritable(taskId, '停止规划');
    const round = this.#requireRound(input.roundId);
    if (round.taskId !== task.id) throw new AppError(ErrorCode.STALE_TARGET, '轮次与任务不匹配');
    if (!['running', 'queued'].includes(round.status)) throw new AppError(ErrorCode.OPERATION_IN_PROGRESS, '当前轮次不在运行中');
    const { record, replayed } = this.#commands.begin({
      requestKey: input.requestKey,
      operation: 'planning.stop',
      body: { taskId, roundId: round.id, confirmStop: true },
      target: { taskId },
    });
    if (replayed) {
      return { receipt: this.#commands.toReceipt(record), resource: this.planningResponse(taskId) };
    }
    this.#stopKeys.set(round.id, input.requestKey);
    this.#store.planning.update(round.id, {
      status: 'stopping',
      stage: round.stage,
      stop: { requestKey: input.requestKey, requestedAt: nowIso(), processState: 'stopping', accountingState: 'open' },
      lastActivity: '停止请求已受理',
    });
    const sessionId = this.#activeSessions.get(round.id) ?? round.sessionId;
    if (sessionId !== undefined) {
      void this.#opencode.abortSession(sessionId).catch(() => undefined);
    }
    this.#publishRound(taskId, round.id, 'stopping');
    return { receipt: this.#commands.toReceipt(this.#commands.get(input.requestKey)!), resource: this.planningResponse(taskId) };
  }

  async reconcile(taskId: string, roundId: string): Promise<PlanningRound> {
    const round = this.#requireRound(roundId);
    this.#store.planning.update(roundId, { reconcile: { state: 'checking', checkedAt: nowIso() } });
    const sessions = await this.#opencode.findSessions({ taskId, roundId }).catch(() => []);
    const session = sessions[0];
    if (session !== undefined) {
      const updated = this.#store.planning.update(roundId, {
        sessionId: session.id,
        reconcile: { state: 'settled', checkedAt: nowIso(), detail: `找到原会话 ${session.id}；未发送新提示` },
      });
      this.#publishRound(taskId, roundId, updated?.status ?? round.status);
      return updated ?? round;
    }
    const updated = this.#store.planning.update(roundId, {
      reconcile: { state: 'still_unknown', checkedAt: nowIso(), detail: '未找到可核对的原会话；保持待核对，不重新派发' },
    });
    return updated ?? round;
  }

  apply(taskId: string, input: PlanningApplyRequest): CommandResponse<PlanningResponse> {
    const originalReceipt = this.#commands.replay({ requestKey: input.requestKey, operation: 'planning.apply', body: { taskId, roundId: input.roundId, candidatePlanRevisionId: input.candidatePlanRevisionId, acceptedDecisionIds: input.acceptedDecisionIds, confirmApply: true } }, () => this.planningResponse(taskId));
    if (originalReceipt !== undefined) return originalReceipt;
    const task = this.#assertWritable(taskId, '应用规划候选');
    const round = this.#requireRound(input.roundId);
    if (round.candidate === undefined) throw new AppError(ErrorCode.CANDIDATE_PENDING, '本轮没有可应用的候选');
    if (round.status !== 'completed') throw new AppError(ErrorCode.OPERATION_IN_PROGRESS, '候选已收到，正在核对本轮结束；可以先只读审阅，暂不能应用');
    const validation = round.candidate.validation;
    if (validation.structural.state !== 'passed') {
      throw new AppError(ErrorCode.VALIDATION_FAILED, '候选存在必须处理的问题，不能应用', { details: { problems: validation.structural.problems } });
    }
    const requiredQuestions = round.questions.filter((question) => question.required && question.answer === undefined);
    if (requiredQuestions.length > 0) {
      throw new AppError(ErrorCode.ANSWER_REQUIRED, '还有必须答复的问题未回答', { details: { questions: requiredQuestions.map((question) => question.question) } });
    }
    const pendingDecisions = validation.humanReview.items.filter((item) => !input.acceptedDecisionIds.includes(item.id));
    if (pendingDecisions.length > 0) {
      throw new AppError(ErrorCode.HUMAN_REVIEW_REQUIRED, `还有 ${pendingDecisions.length} 项需人工判断未核对`, {
        details: { decisions: pendingDecisions.map((item) => ({ id: item.id, title: item.title })) },
      });
    }
    const { record, replayed } = this.#commands.begin({
      requestKey: input.requestKey,
      operation: 'planning.apply',
      body: { taskId, roundId: round.id, candidatePlanRevisionId: input.candidatePlanRevisionId, acceptedDecisionIds: input.acceptedDecisionIds, confirmApply: true },
      target: { taskId },
    });
    if (replayed) {
      return { receipt: this.#commands.toReceipt(record), resource: this.planningResponse(taskId) };
    }
    const candidatePlan = this.#store.plans.get(round.candidate.planRevisionId);
    if (candidatePlan === undefined) throw new AppError(ErrorCode.NOT_FOUND, '候选计划不存在');
    const acceptedItems = validation.humanReview.items.map((item) => ({
      ...item,
      accepted: input.acceptedDecisionIds.includes(item.id),
      acceptedBy: 'user',
      acceptedAt: nowIso(),
    }));
    this.#store.plans.setValidation(candidatePlan.id, {
      ...validation,
      humanReview: { required: acceptedItems.length, accepted: acceptedItems.length, items: acceptedItems },
    });
    const applied = this.#store.plans.setStatus(candidatePlan.id, 'unconfirmed', {
      supersedeSiblingsForTaskId: taskId,
    });
    this.#store.planning.update(round.id, { applyStatus: 'applied' });
    // PE37 S4/S5: a scoped apply writes the merged draft revision +1 without
    // executing; the task only moves to CONFIRMING once every group is refined.
    const candidateScope = this.#candidateScope(candidatePlan.id);
    const unresolved = candidateScope === undefined ? [] : unresolvedPlanScopes(candidatePlan.graph);
    const nextStage = candidateScope === undefined || unresolved.length === 0 ? TaskStage.CONFIRMING : TaskStage.PLANNING;
    this.#store.tasks.update(taskId, {
      stage: nextStage,
      attention: TaskAttention.NONE,
      currentPlanRevisionId: candidatePlan.id,
    });
    this.#store.events.publish('plan.changed', { taskId, planRevisionId: candidatePlan.id, revisionNumber: candidatePlan.revisionNumber, status: 'unconfirmed' });
    this.#store.events.publish('task.changed', { taskId, projectId: task.projectId, stage: nextStage, revision: 1 });
    this.#commands.settle(input.requestKey, {
      planRevisionId: candidatePlan.id,
      planRevisionNumber: candidatePlan.revisionNumber,
      ...(candidateScope === undefined ? {} : { groupRef: candidateScope.groupRef, unresolvedScopes: unresolved.map((item) => item.groupRef) }),
    });
    this.#publishRound(taskId, round.id, 'completed');
    return { receipt: this.#commands.toReceipt(this.#commands.get(input.requestKey)!), resource: this.planningResponse(taskId, applied ?? candidatePlan) };
  }

  reject(taskId: string, input: PlanningRejectRequest): CommandResponse<PlanningResponse> {
    const originalReceipt = this.#commands.replay({ requestKey: input.requestKey, operation: 'planning.reject', body: { taskId, roundId: input.roundId, reason: input.reason, confirmReject: true } }, () => this.planningResponse(taskId));
    if (originalReceipt !== undefined) return originalReceipt;
    this.#assertWritable(taskId, '不采用规划候选');
    const round = this.#requireRound(input.roundId);
    if (round.candidate === undefined) throw new AppError(ErrorCode.CANDIDATE_PENDING, '本轮没有可审阅的候选');
    const { record, replayed } = this.#commands.begin({
      requestKey: input.requestKey,
      operation: 'planning.reject',
      body: { taskId, roundId: round.id, reason: input.reason, confirmReject: true },
      target: { taskId },
    });
    if (replayed) return { receipt: this.#commands.toReceipt(record), resource: this.planningResponse(taskId) };
    this.#store.planning.update(round.id, { applyStatus: 'rejected', lastActivity: `候选未采用：${input.reason}` });
    const seq = this.#store.planning.appendRecord(round.id, {
      fragmentId: `${round.id}-reject`,
      category: 'service_event',
      at: nowIso(),
      text: `服务事实：候选未采用（${input.reason}）；记录保留`,
    });
    this.#store.events.publish('planning.output.appended', { taskId, roundId: round.id, seq, fragmentId: `${round.id}-reject`, category: 'service_event', text: '候选未采用' });
    this.#commands.settle(input.requestKey, { rejected: true });
    this.#publishRound(taskId, round.id, round.status);
    return { receipt: this.#commands.toReceipt(this.#commands.get(input.requestKey)!), resource: this.planningResponse(taskId) };
  }

  saveAnswer(taskId: string, input: SaveAnswerRequest): CommandResponse<PlanningResponse> {
    const originalReceipt = this.#commands.replay({ requestKey: input.requestKey, operation: 'requirement.answer.save', body: { taskId, roundId: input.roundId, answers: input.answers } }, () => this.planningResponse(taskId));
    if (originalReceipt !== undefined) return originalReceipt;
    const task = this.#assertWritable(taskId, '保存规划答复');
    const round = this.#requireRound(input.roundId);
    if (round.taskId !== taskId) throw new AppError(ErrorCode.NOT_FOUND, '规划轮次不属于该任务');
    if (!Array.isArray(input.answers) || input.answers.length === 0 || new Set(input.answers.map((answer) => answer?.questionId)).size !== input.answers.length) throw new AppError(ErrorCode.VALIDATION_FAILED, '答复不能为空且问题不能重复');
    const normalized = input.answers.map((answer) => {
      const question = round.questions.find((item) => item.id === answer?.questionId);
      if (question === undefined) throw new AppError(ErrorCode.VALIDATION_FAILED, '答复的问题不在本轮规划中');
      return { questionId: question.id, ...normalizeQuestionAnswer(question, answer) };
    });
    const { record, replayed } = this.#commands.begin({
      requestKey: input.requestKey,
      operation: 'requirement.answer.save',
      body: { taskId, roundId: round.id, answers: input.answers },
      target: { taskId },
    });
    if (replayed) return { receipt: this.#commands.toReceipt(record), resource: this.planningResponse(taskId) };
    const questions = round.questions.map((question) => {
      const answer = normalized.find((item) => item.questionId === question.id);
      return answer === undefined ? question : { ...question, answer: answer.answer, values: answer.values, other: answer.other, answeredAt: nowIso(), answeredBy: 'user' };
    });
    const answeredText = normalized
      .map((answer) => {
        const question = round.questions.find((item) => item.id === answer.questionId);
        return `Q: ${question?.question ?? answer.questionId}\nA: ${answer.answer}`;
      })
      .join('\n\n');
    const requirement = {
      ...task.requirement,
      supplements: [
        ...task.requirement.supplements,
        { id: createId('sup'), revision: task.requirement.revision + 1, text: `已确认答复（规划轮次 ${round.ordinal}）：\n${answeredText}`, savedAt: nowIso() },
      ],
      revision: task.requirement.revision + 1,
      updatedAt: nowIso(),
    };
    this.#store.tasks.update(taskId, { requirement });
    this.#store.planning.update(round.id, { questions, lastActivity: '答复已保存，可预览新一轮' });
    this.#publishRound(taskId, round.id, round.status);
    this.#commands.settle(input.requestKey, { requirementRevision: requirement.revision });
    return { receipt: this.#commands.toReceipt(this.#commands.get(input.requestKey)!), resource: this.planningResponse(taskId) };
  }

  /**
   * Strict answer submission used by the Inbox interactions endpoint.
   *
   * Validates against the stored round before delegating to `saveAnswer` (which
   * owns the requirement revision, question answeredAt/By fields and the
   * requestKey receipt): every answer must reference a question of this round,
   * be non-empty, appear at most once, and leave no required question unanswered
   * after merging with answers already stored. Choice IDs are validated against
   * the frozen question; only server labels form the human-readable answer.
   */
  resolveAnswers(taskId: string, roundId: string, input: SaveAnswerRequest): CommandResponse<PlanningResponse> {
    const replay = this.#commands.replay({ requestKey: input.requestKey, operation: 'requirement.answer.save', body: { taskId, roundId: input.roundId, answers: input.answers } }, () => this.planningResponse(taskId));
    if (replay !== undefined) return replay;
    this.#requireTask(taskId);
    const round = this.#requireRound(roundId);
    if (round.taskId !== taskId) throw new AppError(ErrorCode.NOT_FOUND, '规划轮次不属于该任务');
    const answers = Array.isArray(input.answers) ? input.answers : [];
    if (answers.length === 0) throw new AppError(ErrorCode.VALIDATION_FAILED, '缺少答复');
    const seen = new Set<string>();
    for (const answer of answers) {
      if (answer === null || typeof answer !== 'object' || typeof answer.questionId !== 'string' || answer.questionId === '' || typeof answer.answer !== 'string') {
        throw new AppError(ErrorCode.VALIDATION_FAILED, '答复格式不合法');
      }
      const question = round.questions.find((item) => item.id === answer.questionId);
      if (question === undefined) {
        throw new AppError(ErrorCode.VALIDATION_FAILED, '答复的问题不在本轮规划中', { details: { questionId: answer.questionId } });
      }
      if (seen.has(answer.questionId)) {
        throw new AppError(ErrorCode.VALIDATION_FAILED, '同一问题只能提交一次答复', { details: { questionId: answer.questionId } });
      }
      if (answer.answer.trim() === '') {
        throw new AppError(ErrorCode.VALIDATION_FAILED, '答复不能为空', { details: { questionId: answer.questionId } });
      }
      seen.add(answer.questionId);
    }
    const answered = new Set(
      round.questions
        .filter((question) => typeof question.answer === 'string' && question.answer.trim() !== '')
        .map((question) => question.id),
    );
    for (const questionId of seen) answered.add(questionId);
    const unansweredQuestionIds = round.questions.filter((question) => question.required && !answered.has(question.id)).map((question) => question.id);
    if (unansweredQuestionIds.length > 0) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, '还有必须回答的问题未答复', { details: { unansweredQuestionIds } });
    }
    return this.saveAnswer(taskId, input);
  }

  record(taskId: string, roundId: string | undefined, afterSeq = 0, limit = 500) {
    this.#requireTask(taskId);
    if (!Number.isSafeInteger(afterSeq) || afterSeq < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, '记录游标必须是非负整数，每页数量为 1–1000');
    }
    const round = roundId === undefined ? this.#store.planning.latest(taskId) : this.#store.planning.get(roundId);
    if (roundId !== undefined && (round === undefined || round.taskId !== taskId)) throw new AppError(ErrorCode.NOT_FOUND, '任务中不存在此规划轮次');
    if (round === undefined) return { taskId, roundId: '', fragments: [], gaps: [], terminal: false, hasMore: false, lastAvailableSeq: 0 };
    const page = this.#store.planning.listRecords(round.id, afterSeq, limit + 1);
    const hasMore = page.length > limit;
    const rows = page.slice(0, limit);
    const gaps = [...round.recordSeq.gaps];
    let expected = afterSeq + 1;
    const addGap = (fromSeq: number, toSeq: number) => {
      if (fromSeq > toSeq || gaps.some((gap) => gap.fromSeq <= fromSeq && gap.toSeq >= toSeq)) return;
      gaps.push({ fromSeq, toSeq, reason: toSeq < round.recordSeq.first ? 'NOT_RETAINED' : 'CAPTURE_UNAVAILABLE' });
    };
    for (const row of rows) { addGap(expected, row.seq - 1); expected = row.seq + 1; }
    if (!hasMore) addGap(expected, round.recordSeq.last);
    return {
      taskId,
      roundId: round.id,
      fragments: rows.map((row) => ({
        seq: row.seq,
        fragmentId: row.fragmentId,
        category: row.category,
        at: row.at,
        text: row.text,
        blockId: row.blockId,
        toolCallRef: row.toolCall === undefined ? undefined : {
          callId: String(row.toolCall.callId ?? ''),
          status: String(row.toolCall.status ?? ''),
          source: String(row.toolCall.source ?? 'managed_mcp'),
        },
      })),
      nextAfterSeq: rows.at(-1)?.seq,
      gaps,
      hasMore,
      lastAvailableSeq: round.recordSeq.last,
      terminal: !['queued', 'running', 'stopping'].includes(round.status),
    };
  }

  planningResponse(taskId: string, explicitPlan?: unknown): PlanningResponse {
    const task = this.#requireTask(taskId);
    const rounds = this.#store.planning.list(taskId);
    const plan = explicitPlan ?? (task.currentPlanRevisionId === undefined ? undefined : this.#store.plans.get(task.currentPlanRevisionId));
    return {
      taskId,
      planning: {
        taskId,
        currentRoundId: rounds[0]?.id,
        rounds,
        actions: {
          startPlanning: this.#context.opencodeReady() ? { allowed: true } : { allowed: false, reasonCode: 'OPENCODE_NOT_READY', reason: '受管 OpenCode 服务未就绪' },
          stopPlanning: rounds[0] !== undefined && ['running', 'stopping'].includes(rounds[0].status) ? { allowed: true } : { allowed: false, reasonCode: 'OPERATION_IN_PROGRESS', reason: '当前没有进行中的规划' },
        },
      },
      plan: plan as PlanningResponse['plan'],
    };
  }

  #publishRound(taskId: string, roundId: string, status: string): void {
    const round = this.#store.planning.get(roundId);
    if (round === undefined) return;
    this.#store.events.publish('planning.changed', { taskId, roundId, status, stage: round.stage, revision: round.recordSeq.last });
    this.#tasks().recomputeAttention(taskId);
  }

  #refreshTask(taskId: string): void {
    this.#tasks().recomputeAttention(taskId);
    const task = this.#store.tasks.get(taskId);
    if (task !== undefined) {
      this.#store.events.publish('task.changed', { taskId, projectId: task.projectId, stage: task.stage, revision: 1 });
    }
  }

  /** Read-only recovery drafts may be read, never planned. */
  #assertWritable(taskId: string, action: string): Task {
    const task = this.#requireTask(taskId);
    if (task.readOnly === true) throw readOnlyRecoveryError(action);
    return task;
  }

  #requireTask(taskId: string): Task {
    const task = this.#store.tasks.get(taskId);
    if (task === undefined) throw new AppError(ErrorCode.NOT_FOUND, '任务不存在');
    return task;
  }

  #requireProject(projectId: string): Project {
    const project = this.#store.projects.get(projectId);
    if (project === undefined) throw new AppError(ErrorCode.NOT_FOUND, '项目不存在');
    return project;
  }

  #requireRound(roundId: string): PlanningRound {
    const round = this.#store.planning.get(roundId);
    if (round === undefined) throw new AppError(ErrorCode.NOT_FOUND, '规划轮次不存在');
    return round;
  }

  #method(task: Task): WorkflowMethod {
    const method = findMethod(this.#catalog, task.methodId);
    if (method === undefined) throw new AppError(ErrorCode.NOT_FOUND, '流程方法不存在');
    return method;
  }

  #plannerModel() {
    const models = this.#context.settings().models;
    return models.find((model) => model.enabled && model.roles.includes('planner')) ?? models.find((model) => model.enabled) ?? models[0]!;
  }
}

/** Last-resort: extract the first balanced JSON object from model text. */
function extractCandidateJson(text: string): unknown | undefined {
  const start = text.indexOf('{');
  if (start < 0) return undefined;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index++) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        try {
          const parsed = JSON.parse(text.slice(start, index + 1)) as Record<string, unknown>;
          if (Array.isArray(parsed.nodes) && Array.isArray(parsed.edges) && Array.isArray(parsed.groups)) return parsed;
        } catch {
          return undefined;
        }
        return undefined;
      }
    }
  }
  return undefined;
}
