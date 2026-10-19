import { boundAttempt, readableAttempt, readableOutput } from './node-read.ts';
import { freezeRequirement, requirementLinks as sourceLinks, readRequirementSource } from './requirement-source.ts';
import { executionPolicy } from './execution-policy.ts';
import { snapshotPlanGraph } from './snapshot-review.ts';
import type {
  ActionAvailability,
  CommandResponse,
  ConfirmPlanRequest,
  EditBeginRequest,
  EditFinishRequest,
  EditSaveRequest,
  NodeAcceptRequest,
  NodeAcceptanceView,
  NodeDetailResponse,
  NodeRejectRequest,
  NodeStatusValue,
  ErrorCodeValue,
  NodeResponse,
  PlanEditAbandonRequest,
  PlanResponse,
  PlanRevision,
  TaskDetailResponse,
  UseSkeletonRequest,
  CatalogSnapshot,
  TaskTemplate,
  UseTemplateRequest,
} from '@agent-workflow/shared';
import { AppError, ErrorCode, NodeManualAcceptanceState, NodeStatus, Rationale, SCOPE_UNREFINED, TaskAttention, TaskStage, assertTransition, createId, executionMachine, nowIso, unresolvedPlanScopes } from '@agent-workflow/shared';
import {
  nodeAcceptanceKey,
  readNodeAcceptance,
  readOnlyRecoveryError,
  type EngineContext,
  type StoredNodeAcceptance,
} from './actions.ts';
import type { ExecutionService } from './execution.ts';
import type { CommandService } from './operations.ts';
import type { GitPort } from './ports.ts';
import type { Store } from '@agent-workflow/storage';
import { freezeGraphRoles } from './role-runtime.ts';
import { methodToGraph } from './graph.ts';
import type { TaskService } from './project-task.ts';

export class PlanService {
  readonly #store: Store;
  readonly #commands: CommandService;
  readonly #context: EngineContext;
  readonly #git: GitPort;
  readonly #tasks: () => TaskService;
  readonly #catalog: CatalogSnapshot;
  /** Lazy execution service link: node acceptance gates completion/downstream. */
  readonly #executions: () => ExecutionService;

  constructor(
    store: Store,
    commands: CommandService,
    context: EngineContext,
    git: GitPort,
    tasks: () => TaskService,
    catalog: CatalogSnapshot,
    executions: () => ExecutionService,
  ) {
    this.#store = store;
    this.#commands = commands;
    this.#context = context;
    this.#git = git;
    this.#tasks = tasks;
    this.#catalog = catalog;
    this.#executions = executions;
  }

  view(taskId: string): PlanResponse {
    const task = this.#requireTask(taskId);
    const plan = task.currentPlanRevisionId === undefined ? this.#store.plans.latest(taskId) : this.#store.plans.get(task.currentPlanRevisionId);
    const history = this.#store.plans.list(taskId).map((item) => ({
      id: item.id,
      revisionNumber: item.revisionNumber,
      status: item.status,
      createdAt: item.createdAt,
      confirmedAt: item.confirmedAt,
    }));
    const execution = task.executionId === undefined ? this.#store.executions.byTask(taskId) : this.#store.executions.get(task.executionId);
    return {
      taskId,
      plan,
      planHistory: history,
      editSession: execution?.editSession,
      actions: {
        useSkeleton: { allowed: task.fixedTemplate === undefined },
        confirmPlan: plan !== undefined && (plan.status === 'unconfirmed' || plan.status === 'draft') ? { allowed: true } : { allowed: false, reasonCode: 'PLAN_NOT_CONFIRMED', reason: '当前没有未确认的计划' },
      },
    };
  }

  useTemplate(taskId: string, input: UseTemplateRequest): CommandResponse<PlanResponse> {
    const frozen = this.#commands.originalBody<{ templateId: string; templateVersion: number }>(input.requestKey);
    const frozenFixed = this.#store.tasks.get(taskId)?.fixedTemplate;
    const originalReceipt = this.#commands.replay({ requestKey: input.requestKey, operation: 'plan.template.use', body: { taskId, templateId: frozen?.templateId ?? frozenFixed?.templateId, templateVersion: frozen?.templateVersion ?? frozenFixed?.templateVersion, confirmUseTemplate: true } }, () => this.view(taskId));
    if (originalReceipt !== undefined) return originalReceipt;
    const task = this.#assertWritable(taskId, '按模板生成计划');
    const fixed = task.fixedTemplate;
    if (fixed === undefined) throw new AppError(ErrorCode.VALIDATION_FAILED, '这个任务不是固定模板任务');
    if (input?.confirmUseTemplate !== true) throw new AppError(ErrorCode.VALIDATION_FAILED, '按模板生成计划需要显式确认');
    return this.#useTemplatePlan(taskId, fixed.templateId, input);
  }

  #useTemplatePlan(taskId: string, templateId: string, input: UseTemplateRequest): CommandResponse<PlanResponse> {
    const task = this.#assertWritable(taskId, '按模板生成计划');
    const template = task.fixedTemplate?.contract ?? this.#template(templateId);
    const { record, replayed } = this.#commands.begin({
      requestKey: input.requestKey,
      operation: 'plan.template.use',
      body: { taskId, templateId, templateVersion: template.version, confirmUseTemplate: true },
      target: { taskId },
    });
    if (replayed) return { receipt: this.#commands.toReceipt(record), resource: this.view(taskId) };
    const base = task.currentPlanRevisionId === undefined ? this.#store.plans.latest(taskId) : this.#store.plans.get(task.currentPlanRevisionId);
    const method = this.#method(task);
    const templateGraph = methodToGraph({
      ...method,
      id: template.id,
      name: template.name,
      revision: `template-v${String(template.version)}`,
      requiredSteps: template.steps.map((step) => ({ ...step })),
      refinableGroups: [],
    });
    const graph = task.fixedTemplate?.snapshot === undefined ? templateGraph : snapshotPlanGraph(templateGraph, task.fixedTemplate.snapshot, template);
    const plan = this.#store.plans.create({ taskId, source: 'template', graph, status: 'unconfirmed', baseRevisionId: base?.id });
    this.#store.tasks.update(taskId, { stage: TaskStage.CONFIRMING, attention: TaskAttention.NONE, currentPlanRevisionId: plan.id });
    this.#store.events.publish('plan.changed', { taskId, planRevisionId: plan.id, revisionNumber: plan.revisionNumber, status: 'unconfirmed' });
    this.#store.events.publish('task.changed', { taskId, projectId: task.projectId, stage: TaskStage.CONFIRMING, revision: 1 });
    this.#commands.settle(input.requestKey, { planRevisionId: plan.id });
    this.#tasks().recomputeAttention(taskId);
    return { receipt: this.#commands.toReceipt(this.#commands.get(input.requestKey)!), resource: this.view(taskId) };
  }

  useSkeleton(taskId: string, input: UseSkeletonRequest): CommandResponse<PlanResponse> {
    const originalReceipt = this.#commands.replay({ requestKey: input.requestKey, operation: 'plan.skeleton.use', body: { taskId, confirmUseSkeleton: true } }, () => this.view(taskId));
    if (originalReceipt !== undefined) return originalReceipt;
    const task = this.#assertWritable(taskId, '生成计划骨架');
    if (task.fixedTemplate !== undefined) throw new AppError(ErrorCode.FIXED_TEMPLATE_LOCKED, '固定模板任务使用模板步骤，不能使用方法骨架');
    const method = this.#method(task);
    const { record, replayed } = this.#commands.begin({
      requestKey: input.requestKey,
      operation: 'plan.skeleton.use',
      body: { taskId, confirmUseSkeleton: true },
      target: { taskId },
    });
    if (replayed) return { receipt: this.#commands.toReceipt(record), resource: this.view(taskId) };
    const base = task.currentPlanRevisionId === undefined ? this.#store.plans.latest(taskId) : this.#store.plans.get(task.currentPlanRevisionId);
    const graph = methodToGraph(method);
    const plan = this.#store.plans.create({ taskId, source: 'skeleton', graph, status: 'unconfirmed', baseRevisionId: base?.id });
    this.#store.tasks.update(taskId, { stage: TaskStage.CONFIRMING, attention: TaskAttention.NONE, currentPlanRevisionId: plan.id });
    this.#store.events.publish('plan.changed', { taskId, planRevisionId: plan.id, revisionNumber: plan.revisionNumber, status: 'unconfirmed' });
    this.#store.events.publish('task.changed', { taskId, projectId: task.projectId, stage: TaskStage.CONFIRMING, revision: 1 });
    this.#commands.settle(input.requestKey, { planRevisionId: plan.id });
    this.#tasks().recomputeAttention(taskId);
    return { receipt: this.#commands.toReceipt(this.#commands.get(input.requestKey)!), resource: this.view(taskId) };
  }

  confirm(taskId: string, input: ConfirmPlanRequest): CommandResponse<TaskDetailResponse> {
    const originalReceipt = this.#commands.replay({ requestKey: input.requestKey, operation: 'plan.confirm', body: { taskId, planRevisionId: input.planRevisionId, expectedRevisionNumber: input.expectedRevisionNumber, confirmPlan: true } }, () => this.#tasks().detail(taskId));
    if (originalReceipt !== undefined) return originalReceipt;
    const task = this.#assertWritable(taskId, '确认计划');
    const plan = this.#store.plans.get(input.planRevisionId);
    if (plan === undefined || plan.taskId !== taskId) throw new AppError(ErrorCode.NOT_FOUND, '计划不存在');
    if (plan.status !== 'unconfirmed' && plan.status !== 'draft') {
      throw new AppError(ErrorCode.PLAN_REVISION_CONFLICT, '只有未确认的计划可以确认');
    }
    // PE37 S5: unrefined groups block confirmation (they must never execute first).
    const unresolved = unresolvedPlanScopes(plan.graph);
    if (unresolved.length > 0) {
      throw new AppError(ErrorCode.PLAN_REVISION_CONFLICT, `还有 ${String(unresolved.length)} 个组未细化，不能确认执行`, {
        details: { code: SCOPE_UNREFINED, groups: unresolved.map((item) => item.title), unresolvedScopes: unresolved.map((item) => item.groupRef) },
      });
    }
    if (input.expectedRevisionNumber !== undefined && plan.revisionNumber !== input.expectedRevisionNumber) {
      throw new AppError(ErrorCode.STALE_TARGET, '计划已变化，请重新读取后确认', { details: { expected: input.expectedRevisionNumber, actual: plan.revisionNumber } });
    }
    if (plan.validation?.structural.state === 'failed') {
      throw new AppError(ErrorCode.VALIDATION_FAILED, '计划仍有必须处理的问题，不能确认');
    }
    const confirmedGraph = freezeGraphRoles(plan.graph, this.#catalog.roles);
    const { record, replayed } = this.#commands.begin({
      requestKey: input.requestKey,
      operation: 'plan.confirm',
      body: { taskId, planRevisionId: plan.id, expectedRevisionNumber: input.expectedRevisionNumber, confirmPlan: true },
      target: { taskId },
    });
    if (replayed) {
      return { receipt: this.#commands.toReceipt(record), resource: this.#tasks().detail(taskId) };
    }
    const settings = this.#context.settings();
    const project = this.#requireProject(task.projectId);
    const priorExecution = this.#store.executions.byTask(taskId);
    if (priorExecution !== undefined) this.#executions().validatePlanBinding(priorExecution.id, { ...plan, graph: confirmedGraph });
    freezeRequirement(this.#store, task, plan.id);
    this.#store.plans.updateGraph(plan.id, confirmedGraph);
    this.#store.plans.setStatus(plan.id, 'confirmed', { confirmedBy: 'user', supersedeSiblingsForTaskId: taskId });
    const execution = priorExecution ??
      this.#store.executions.create({
        taskId,
        planRevisionId: plan.id,
        graph: plan.graph,
        autoAdvance: settings.execution.autoAdvanceByDefault,
      });
    if (priorExecution !== undefined) this.#executions().bindConfirmedPlan(execution.id, this.#store.plans.get(plan.id)!);
    executionPolicy(this.#store, execution.id, this.#store.settings.getJson<import('@agent-workflow/shared').ExecutionSettings>(`recovery.execution-settings.${taskId}`) ?? this.#store.settings.getJson<import('@agent-workflow/shared').ExecutionSettings>(`task.execution-settings.${taskId}`) ?? settings.execution);
    const workspace =
      this.#store.workspaces.byTask(taskId) ??
      this.#store.workspaces.create({
        taskId,
        kind: project.gitState === 'git' ? 'git_worktree' : 'directory_copy',
        originalRootDisplay: project.rootPath,
        baseRef: task.fixedTemplate?.snapshot?.targetSha ?? task.fixedTemplate?.scope?.targetSha ?? project.defaultBranch,
      });
    const stage = priorExecution?.editSession?.state === 'saved' || priorExecution?.startedAt !== undefined ? TaskStage.EXECUTING : TaskStage.PREPARING;
    this.#store.tasks.update(taskId, {
      stage,
      attention: TaskAttention.NONE,
      currentPlanRevisionId: plan.id,
      executionId: execution.id,
      workspaceId: workspace.id,
    });
    this.#store.events.publish('plan.changed', { taskId, planRevisionId: plan.id, revisionNumber: plan.revisionNumber, status: 'confirmed' });
    this.#store.events.publish('task.changed', { taskId, projectId: task.projectId, stage, revision: 1 });
    this.#commands.settle(input.requestKey, { planRevisionId: plan.id, executionId: execution.id, workspaceId: workspace.id });
    this.#tasks().recomputeAttention(taskId);
    return { receipt: this.#commands.toReceipt(this.#commands.get(input.requestKey)!), resource: this.#tasks().detail(taskId) };
  }

  editBegin(taskId: string, input: EditBeginRequest): CommandResponse<PlanResponse> {
    const originalReceipt = this.#commands.replay({ requestKey: input.requestKey, operation: 'plan.edit.begin', body: { taskId, planRevisionId: input.planRevisionId, confirmPause: true } }, () => this.view(taskId));
    if (originalReceipt !== undefined) return originalReceipt;
    const task = this.#assertWritable(taskId, '调整执行中的计划');
    if (task.fixedTemplate !== undefined) throw new AppError(ErrorCode.FIXED_TEMPLATE_LOCKED, '该任务使用固定模板，创建后不能修改步骤；要改要求，请新建模板任务。');
    const execution = task.executionId === undefined ? undefined : this.#store.executions.get(task.executionId);
    if (execution === undefined) throw new AppError(ErrorCode.NOT_FOUND, '执行尚未创建');
    const { record, replayed } = this.#commands.begin({
      requestKey: input.requestKey,
      operation: 'plan.edit.begin',
      body: { taskId, planRevisionId: input.planRevisionId, confirmPause: true },
      target: { taskId },
    });
    if (replayed) return { receipt: this.#commands.toReceipt(record), resource: this.view(taskId) };
    if (execution.status !== 'running' && execution.status !== 'paused') {
      throw new AppError(ErrorCode.OPERATION_IN_PROGRESS, '当前执行状态不能调整计划');
    }
    if (input.planRevisionId !== execution.planRevisionId || task.currentPlanRevisionId !== execution.planRevisionId) throw new AppError(ErrorCode.STALE_TARGET, '执行计划已变化，请重新读取');
    if (execution.editSession !== undefined && !['finished', 'abandoned'].includes(execution.editSession.state)) throw new AppError(ErrorCode.OPERATION_IN_PROGRESS, '已有进行中的计划调整');
    const editSessionId = createId('edit');
    const locked = execution.nodes.filter((node) => node.status !== 'pending' && node.status !== 'ready').map((node) => node.nodeId);
    const wasPausedBeforeEdit = execution.status === 'paused';
    this.#store.executions.update(execution.id, {
      status: 'paused',
      editSession: {
        id: editSessionId,
        state: 'editing',
        requestKey: input.requestKey,
        autoAdvanceBeforeEdit: execution.autoAdvance,
        wasPausedBeforeEdit,
        lockedNodeIds: locked,
        localChanges: [],
      },
      notice: {
        kind: 'paused',
        message: wasPausedBeforeEdit ? '任务原为暂停；调整期间保持暂停，结束调整后仍需单独恢复任务' : '已暂停新增领取；运行中的步骤按原快照继续',
      },
    });
    this.#commands.settle(input.requestKey, { editSessionId });
    this.#store.events.publish('execution.changed', { taskId, executionId: execution.id, status: 'paused', revision: 1 });
    return { receipt: this.#commands.toReceipt(this.#commands.get(input.requestKey)!), resource: this.view(taskId) };
  }

  editSave(taskId: string, input: EditSaveRequest): CommandResponse<PlanResponse> {
    const originalReceipt = this.#commands.replay({ requestKey: input.requestKey, operation: 'plan.edit.save', body: { taskId, editSessionId: input.editSessionId, changes: input.changes, expectedPlanRevisionNumber: input.expectedPlanRevisionNumber } }, () => this.view(taskId));
    if (originalReceipt !== undefined) return originalReceipt;
    const task = this.#assertWritable(taskId, '保存计划调整');
    const execution = task.executionId === undefined ? undefined : this.#store.executions.get(task.executionId);
    if (execution?.editSession === undefined) throw new AppError(ErrorCode.OPERATION_IN_PROGRESS, '当前没有进行中的调整');
    const { record, replayed } = this.#commands.begin({
      requestKey: input.requestKey,
      operation: 'plan.edit.save',
      body: { taskId, editSessionId: input.editSessionId, changes: input.changes, expectedPlanRevisionNumber: input.expectedPlanRevisionNumber },
      target: { taskId },
    });
    if (replayed) return { receipt: this.#commands.toReceipt(record), resource: this.view(taskId) };
    const plan = task.currentPlanRevisionId === undefined ? undefined : this.#store.plans.get(task.currentPlanRevisionId);
    if (plan === undefined) throw new AppError(ErrorCode.NOT_FOUND, '计划不存在');
    if (input.editSessionId !== execution.editSession.id || !['editing', 'conflict'].includes(execution.editSession.state)) throw new AppError(ErrorCode.STALE_TARGET, '调整会话已变化或不在编辑状态');
    if (plan.revisionNumber !== input.expectedPlanRevisionNumber) throw new AppError(ErrorCode.STALE_TARGET, '计划修订已变化，请重新读取并比对');
    const locked = new Set([...execution.editSession.lockedNodeIds, ...execution.nodes.filter((node) => node.attemptCount > 0 || !['pending', 'ready'].includes(node.status)).map((node) => node.nodeId)]);

    const changes = input.changes.filter((change) => !locked.has(change.nodeId));
    if (changes.length !== input.changes.length) {
      this.#store.executions.update(execution.id, {
        editSession: { ...execution.editSession, state: 'conflict', localChanges: input.changes },
        notice: { kind: 'race', message: '有步骤在暂停生效前已被领取；本地修改保留，请重新读取并比对' },
      });
      throw new AppError(ErrorCode.STALE_TARGET, '有步骤已被领取，修改被移出；本地草稿保留', { details: { lockedNodeIds: [...locked] } });
    }
    const nodeIds = new Set(plan.graph.nodes.map((node) => node.id));
    if (changes.some((change) => !nodeIds.has(change.nodeId))) throw new AppError(ErrorCode.STALE_TARGET, '修改引用的步骤不存在');
    const prerequisitesChanged = new Set(changes.filter((change) => change.prerequisites !== undefined).map((change) => change.nodeId));
    const nextEdges = plan.graph.edges.filter((edge) => !prerequisitesChanged.has(edge.to));
    for (const change of changes) {
      if (change.prerequisites === undefined) continue;
      const seen = new Set<string>();
      for (const prerequisite of change.prerequisites) {
        if (!nodeIds.has(prerequisite)) {
          throw new AppError(ErrorCode.VALIDATION_FAILED, '前置步骤不存在', { details: { nodeId: change.nodeId, prerequisite } });
        }
        if (prerequisite === change.nodeId) {
          throw new AppError(ErrorCode.VALIDATION_FAILED, '步骤不能依赖自身', { details: { nodeId: change.nodeId } });
        }
        if (seen.has(prerequisite)) continue;
        seen.add(prerequisite);
        nextEdges.push({ id: createId('edge'), from: prerequisite, to: change.nodeId, kind: 'order' });
      }
    }
    if (hasCycle(plan.graph.nodes.map((node) => node.id), nextEdges)) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, '依赖调整会形成环，未保存');
    }
    const graph = {
      ...plan.graph,
      edges: nextEdges,
      nodes: plan.graph.nodes.map((node) => {
        const change = changes.find((item) => item.nodeId === node.id);
        if (change === undefined) return node;
        return {
          ...node,
          title: change.title ?? node.title,
          acceptance: change.acceptance ?? node.acceptance,
        };
      }),
    };
    const base = this.#store.plans.get(plan.id);
    const next = this.#store.plans.create({
      taskId,
      source: 'edit',
      graph,
      status: 'unconfirmed',
      baseRevisionId: base?.id,
    });
    this.#store.plans.setStatus(plan.id, 'superseded');
    this.#store.executions.update(execution.id, {
      status: 'waiting_confirmation',
      editSession: { ...execution.editSession, state: 'saved', localChanges: changes },
      notice: { kind: 'plan_changed', message: '计划已变更，后续步骤等待重新确认' },
    });
    this.#store.tasks.update(taskId, { currentPlanRevisionId: next.id });
    this.#commands.settle(input.requestKey, { planRevisionId: next.id });
    this.#store.events.publish('plan.changed', { taskId, planRevisionId: next.id, revisionNumber: next.revisionNumber, status: 'unconfirmed' });
    this.#store.events.publish('execution.changed', { taskId, executionId: execution.id, status: 'waiting_confirmation', revision: 1 });
    return { receipt: this.#commands.toReceipt(this.#commands.get(input.requestKey)!), resource: this.view(taskId) };
  }

  editFinish(taskId: string, input: EditFinishRequest): CommandResponse<PlanResponse> {
    const originalReceipt = this.#commands.replay({ requestKey: input.requestKey, operation: 'plan.edit.finish', body: { taskId, editSessionId: input.editSessionId, continueExecution: input.continueExecution } }, () => this.view(taskId));
    if (originalReceipt !== undefined) return originalReceipt;
    const task = this.#assertWritable(taskId, '结束计划调整');
    const execution = task.executionId === undefined ? undefined : this.#store.executions.get(task.executionId);
    if (execution?.editSession === undefined) throw new AppError(ErrorCode.OPERATION_IN_PROGRESS, '当前没有进行中的调整');
    const nextPlan = task.currentPlanRevisionId === undefined ? undefined : this.#store.plans.get(task.currentPlanRevisionId);
    const { record, replayed } = this.#commands.begin({
      requestKey: input.requestKey,
      operation: 'plan.edit.finish',
      body: { taskId, editSessionId: input.editSessionId, continueExecution: input.continueExecution },
      target: { taskId },
    });
    if (replayed) return { receipt: this.#commands.toReceipt(record), resource: this.view(taskId) };
    if (input.editSessionId !== execution.editSession.id || !['editing', 'saved', 'conflict'].includes(execution.editSession.state)) throw new AppError(ErrorCode.STALE_TARGET, '调整会话已变化或已结束');
    if (nextPlan === undefined || nextPlan.status !== 'confirmed') throw new AppError(ErrorCode.PLAN_REVISION_CONFLICT, '调整后的计划需要单独重新确认，确认不会自动继续执行');
    this.#executions().bindConfirmedPlan(execution.id, nextPlan);
    // W2-15: a task that was already paused before the edit stays paused; only an
    // explicit resume (not "结束调整") may continue it.
    const keepPaused = input.continueExecution !== true || execution.editSession.wasPausedBeforeEdit === true;
    this.#store.executions.update(execution.id, {
      status: keepPaused ? 'paused' : 'running',
      autoAdvance: execution.editSession.autoAdvanceBeforeEdit,
      editSession: { ...execution.editSession, state: 'finished' },
      endedAt: null,
      pause: keepPaused ? execution.pause : null,
      notice: keepPaused
        ? { kind: 'paused', message: execution.editSession.wasPausedBeforeEdit === true ? '调整已结束；任务保持调整前的暂停状态，恢复任务需单独操作' : '调整已保存，执行保持暂停' }
        : null,
    });
    this.#store.events.publish('execution.changed', { taskId, executionId: execution.id, status: keepPaused ? 'paused' : 'running', revision: 1 });
    this.#commands.settle(input.requestKey, { continued: !keepPaused, ...(keepPaused ? { keptPaused: true } : {}) });
    return { receipt: this.#commands.toReceipt(this.#commands.get(input.requestKey)!), resource: this.view(taskId) };
  }

  /**
   * Give up an edit session (design v4 C04): discard the local draft and put the
   * execution back to its pre-edit auto-advance setting. Only sessions that have
   * not produced an unconfirmed plan revision can be abandoned — after
   * `editSave` the draft is a stored revision that must be reconfirmed or kept
   * paused instead, so the last confirmed plan stays authoritative here.
   */
  abandonEdit(taskId: string, input: PlanEditAbandonRequest): CommandResponse<PlanResponse> {
    const originalReceipt = this.#commands.replay({ requestKey: input.requestKey, operation: 'plan.edit.abandon', body: { taskId, editSessionId: input.editSessionId, confirmAbandon: true } }, () => this.view(taskId));
    if (originalReceipt !== undefined) return originalReceipt;
    const task = this.#assertWritable(taskId, '放弃计划调整');
    const execution = task.executionId === undefined ? undefined : this.#store.executions.get(task.executionId);
    if (execution?.editSession === undefined) throw new AppError(ErrorCode.OPERATION_IN_PROGRESS, '当前没有进行中的调整');
    if (input?.confirmAbandon !== true) throw new AppError(ErrorCode.VALIDATION_FAILED, '放弃调整需要显式确认');
    const session = execution.editSession;
    if (input.editSessionId !== session.id) {
      throw new AppError(ErrorCode.STALE_TARGET, '调整会话已变化，请重新读取计划', { details: { expected: session.id, actual: input.editSessionId } });
    }
    const { record, replayed } = this.#commands.begin({
      requestKey: input.requestKey,
      operation: 'plan.edit.abandon',
      body: { taskId, editSessionId: session.id, confirmAbandon: true },
      target: { taskId, executionId: execution.id },
    });
    // A replay of a settled abandon returns the original receipt even though the
    // session state has already moved on; only first-time calls fail the guard.
    if (replayed) return { receipt: this.#commands.toReceipt(record), resource: this.view(taskId) };
    const reject = (message: string, details: Record<string, unknown> = {}): never => {
      const error = new AppError(ErrorCode.OPERATION_IN_PROGRESS, message, { details });
      this.#commands.fail(input.requestKey, error);
      throw error;
    };
    if (session.state === 'finished' || session.state === 'abandoned') reject('这次调整已经结束', { editSessionState: session.state });
    if (session.state === 'saved') {
      reject('修改已保存为未确认计划；请重新确认或继续执行，不能放弃', { planRevisionId: task.currentPlanRevisionId });
    }
    // W2-15: restore the pause state captured at editBegin. A task the user had
    // paused stays paused (only an explicit resume continues it); a running task
    // becomes running again with its pre-edit auto-advance setting.
    const restorePaused = session.wasPausedBeforeEdit === true;
    if (!restorePaused && execution.status !== 'running') assertTransition(executionMachine, execution.status, 'running');
    this.#store.executions.update(execution.id, {
      status: restorePaused ? 'paused' : 'running',
      autoAdvance: session.autoAdvanceBeforeEdit,
      editSession: { ...session, state: 'abandoned', localChanges: [] },
      notice: {
        kind: 'paused',
        message: restorePaused ? '已放弃调整；任务保持调整前的暂停状态，恢复任务需单独操作' : '已放弃调整；恢复调整前的自动推进设置',
      },
    });
    this.#store.events.publish('execution.changed', { taskId, executionId: execution.id, status: restorePaused ? 'paused' : 'running', revision: 1 });
    this.#commands.settle(input.requestKey, {
      editSessionId: session.id,
      abandoned: true,
      autoAdvance: session.autoAdvanceBeforeEdit,
      restoredStatus: restorePaused ? 'paused' : 'running',
    });
    return { receipt: this.#commands.toReceipt(this.#commands.get(input.requestKey)!), resource: this.view(taskId) };
  }

  readSource(taskId: string, nodeId: string, planId: string, entryId: string, revision: number, sha256: string) {
    return readRequirementSource(this.#store, taskId, nodeId, planId, entryId, revision, sha256);
  }

  nodeDetail(taskId: string, nodeId: string, attemptId?: string): NodeDetailResponse {
    const task = this.#requireTask(taskId);
    const execution = task.executionId === undefined ? undefined : this.#store.executions.get(task.executionId);
    if (execution !== undefined && execution.taskId !== taskId) throw new AppError(ErrorCode.NOT_FOUND, '执行不属于该任务');
    const currentNode = execution?.nodes.find((item) => item.nodeId === nodeId);
    const selectedId = attemptId ?? currentNode?.currentAttemptId;
    const selected = selectedId === undefined ? undefined : boundAttempt(this.#store, taskId, selectedId, nodeId);
    if (selected?.definition !== undefined && selected.definition.node.id !== nodeId) throw new AppError(ErrorCode.STALE_TARGET, '步骤定义与尝试身份不一致');
    const selectedPlanId = selected?.definition?.planRevisionId;
    const plan = selectedPlanId !== undefined ? this.#store.plans.get(selectedPlanId) : task.currentPlanRevisionId === undefined ? this.#store.plans.latest(taskId) : this.#store.plans.get(task.currentPlanRevisionId);
    if (plan === undefined || plan.taskId !== taskId) throw new AppError(ErrorCode.NOT_FOUND, '当前没有计划');
    const node = selected?.definition?.node ?? plan.graph.nodes.find((item) => item.id === nodeId);
    if (node === undefined) throw new AppError(ErrorCode.NOT_FOUND, '步骤不存在');
    const group = plan.graph.groups.find((item) => item.id === node.groupId);
    const requirementLinks = sourceLinks(this.#store, task, plan, node);
    const dependencyReasons = plan.graph.edges
      .filter((edge) => edge.to === node.id)
      .map((edge) => ({ fromNodeId: edge.from, kind: edge.kind, reason: edge.kind === 'data' ? '数据依赖' : edge.kind === 'resource' ? '资源依赖' : '顺序依赖' }));
    const attemptStates = execution === undefined ? [] : this.#store.executions.listAttempts(execution.id, node.id).map(readableAttempt);
    const currentAttempt = attemptStates.find((attempt) => attempt.id === currentNode?.currentAttemptId);
    const outputAttempt = selected === undefined ? currentAttempt : readableAttempt(selected);
    const output = outputAttempt === undefined ? [] : readableOutput(outputAttempt, this.#store.executions.listOutput(outputAttempt.id, 0, 500));
    const acceptance = this.#acceptanceView(execution?.id, node.id, currentNode?.status);
    return {
      taskId,
      nodeId,
      ...(selected !== undefined && selected.definition === undefined ? { definitionUnavailableReason: '这次尝试未保存步骤定义；不能用当前计划代替' } : {}),
      planRevisionId: plan.id,
      node,
      group,
      requirementLinks,
      dependencyReasons,
      execution: selected === undefined || selected.id === currentAttempt?.id ? currentNode : { nodeId, status: selected.status, currentAttemptId: selected.id, attemptCount: selected.ordinal, startedAt: selected.startedAt, endedAt: selected.endedAt },
      currentAttempt,
      selectedAttempt: outputAttempt,
      attempts: attemptStates,
      output: {
        fragments: output,
        nextSeq: output.at(-1)?.seq ?? 0,
        terminal: outputAttempt === undefined ? false : outputAttempt.status !== NodeStatus.RUNNING,
        capabilities: { modelText: outputAttempt?.readability.output ?? 'ok', publicReasoningSummary: 'none_in_attempt', toolSources: ['managed_mcp'] },
      },
      ...(acceptance === undefined || (selected !== undefined && selected.id !== currentAttempt?.id) ? {} : { acceptance }),
      actions: {
        accept: selected !== undefined && selected.id !== currentAttempt?.id ? { allowed: false, reason: '历史尝试只读，不能更改验收结论' } : nodeAcceptanceAvailability(currentNode?.status, acceptance, NodeManualAcceptanceState.ACCEPTED),
        reject: selected !== undefined && selected.id !== currentAttempt?.id ? { allowed: false, reason: '历史尝试只读，不能更改验收结论' } : nodeAcceptanceAvailability(currentNode?.status, acceptance, NodeManualAcceptanceState.REJECTED),
      },
    };
  }

  /** Human verdict: the node already succeeded and the verdict is an audit fact on top. */
  acceptNode(taskId: string, nodeId: string, input: NodeAcceptRequest): CommandResponse<NodeResponse> {
    return this.#decideNodeAcceptance(taskId, nodeId, input, NodeManualAcceptanceState.ACCEPTED);
  }

  rejectNode(taskId: string, nodeId: string, input: NodeRejectRequest): CommandResponse<NodeResponse> {
    return this.#decideNodeAcceptance(taskId, nodeId, input, NodeManualAcceptanceState.REJECTED);
  }

  #decideNodeAcceptance(
    taskId: string,
    nodeId: string,
    input: NodeAcceptRequest | NodeRejectRequest,
    verdict: 'accepted' | 'rejected',
  ): CommandResponse<NodeResponse> {
    const normalizedNote = (typeof input.note === 'string' ? input.note.trim() : '').slice(0, 2_000);
    const originalReceipt = this.#commands.replay({ requestKey: input.requestKey, operation: verdict === NodeManualAcceptanceState.ACCEPTED ? 'node.accept' : 'node.reject', body: { taskId, nodeId, verdict, note: normalizedNote } }, () => ({ node: this.nodeDetail(taskId, nodeId) }));
    if (originalReceipt !== undefined) return originalReceipt;
    this.#requireTask(taskId);
    const confirmed = verdict === NodeManualAcceptanceState.ACCEPTED
      ? (input as NodeAcceptRequest).confirmAccept === true
      : (input as NodeRejectRequest).confirmReject === true;
    if (!confirmed) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, verdict === NodeManualAcceptanceState.ACCEPTED ? '验收通过需要显式确认' : '退回修改需要显式确认');
    }
    const rawNote = typeof input.note === 'string' ? input.note.trim() : '';
    if (verdict === NodeManualAcceptanceState.REJECTED && rawNote === '') {
      throw new AppError(ErrorCode.VALIDATION_FAILED, '退回修改必须填写原因');
    }
    const note = rawNote.slice(0, 2_000);
    const task = this.#requireTask(taskId);
    const execution = task.executionId === undefined ? undefined : this.#store.executions.get(task.executionId);
    if (execution === undefined) throw new AppError(ErrorCode.NOT_FOUND, '执行尚未创建');
    const nodeState = execution.nodes.find((item) => item.nodeId === nodeId);
    if (nodeState === undefined) throw new AppError(ErrorCode.NOT_FOUND, '步骤不存在', { details: { nodeId } });
    const { record, replayed } = this.#commands.begin({
      requestKey: input.requestKey,
      operation: verdict === NodeManualAcceptanceState.ACCEPTED ? 'node.accept' : 'node.reject',
      body: { taskId, nodeId, verdict, note },
      target: { taskId, executionId: execution.id, ref: nodeId },
    });
    // A settled replay answers from the stored receipt before the verdict guard:
    // the persisted verdict may have been replaced since the first call.
    if (replayed) {
      return { receipt: this.#commands.toReceipt(record), resource: { node: this.nodeDetail(taskId, nodeId) } };
    }
    const reject = (code: ErrorCodeValue, message: string, details: Record<string, unknown> = {}): never => {
      const error = new AppError(code, message, { details });
      this.#commands.fail(input.requestKey, error);
      throw error;
    };
    if (nodeState.status !== NodeStatus.SUCCEEDED) {
      reject(ErrorCode.OPERATION_IN_PROGRESS, `步骤当前状态为 ${nodeState.status}，只有已成功的步骤可以验收或退回`, { status: nodeState.status });
    }
    const existing = readNodeAcceptance(this.#store, execution.id, nodeId);
    if (existing?.state === verdict) {
      reject(
        ErrorCode.VALIDATION_FAILED,
        verdict === NodeManualAcceptanceState.ACCEPTED ? '该步骤已验收通过，无需重复验收' : '该步骤已退回修改，无需重复提交',
        { verdict: existing.state, verdictAt: existing.verdictAt },
      );
    }
    const stored: StoredNodeAcceptance = {
      nodeId,
      state: verdict,
      verdictAt: nowIso(),
      ...(note === '' ? {} : { note }),
      requestKey: input.requestKey,
    };
    this.#store.settings.putJson(nodeAcceptanceKey(execution.id, nodeId), stored);
    this.#store.events.publish('execution.changed', { taskId, executionId: execution.id, status: execution.status, revision: 1 });
    // W0-4b: a verdict can unblock completion/downstream release.
    this.#executions().reconcileAcceptance(taskId);
    this.#commands.settle(input.requestKey, { nodeId, verdict, ...(note === '' ? {} : { note }) });
    return { receipt: this.#commands.toReceipt(this.#commands.get(input.requestKey)!), resource: { node: this.nodeDetail(taskId, nodeId) } };
  }

  /** Only a succeeded node exposes the verdict; `pending` = completed, awaiting the human verdict. */
  #acceptanceView(executionId: string | undefined, nodeId: string, status: string | undefined): NodeAcceptanceView | undefined {
    if (status !== NodeStatus.SUCCEEDED) return undefined;
    const stored = readNodeAcceptance(this.#store, executionId, nodeId);
    return {
      nodeId,
      state: stored?.state ?? NodeManualAcceptanceState.PENDING,
      ...(stored === undefined
        ? {}
        : {
            verdictAt: stored.verdictAt,
            ...(stored.note === undefined ? {} : { note: stored.note }),
            requestKey: stored.requestKey,
          }),
    };
  }

  /** Read-only recovery drafts may be viewed, never planned/confirmed. */
  #assertWritable(taskId: string, action: string) {
    const task = this.#requireTask(taskId);
    if (task.readOnly === true) throw readOnlyRecoveryError(action);
    return task;
  }

  #requireTask(taskId: string) {
    const task = this.#store.tasks.get(taskId);
    if (task === undefined) throw new AppError(ErrorCode.NOT_FOUND, '任务不存在');
    return task;
  }

  #requireProject(projectId: string) {
    const project = this.#store.projects.get(projectId);
    if (project === undefined) throw new AppError(ErrorCode.NOT_FOUND, '项目不存在');
    return project;
  }

  #template(templateId: string): TaskTemplate {
    const template = this.#catalog.templates.find((item) => item.id === templateId);
    if (template === undefined) throw new AppError(ErrorCode.NOT_FOUND, '固定模板不存在');
    return template;
  }

  #method(task: ReturnType<Store['tasks']['get']> & object) {
    const method = this.#catalog.methods.find((item) => item.id === task.methodId);
    if (method === undefined) throw new AppError(ErrorCode.NOT_FOUND, '流程方法不存在');
    return method;
  }
}


/**
 * Availability of the two human verdicts for one node. A verdict is available
 * whenever it would change the stored state, so a mistaken verdict can be
 * corrected (audit replacement) without re-running the node.
 */
function nodeAcceptanceAvailability(
  status: NodeStatusValue | undefined,
  acceptance: NodeAcceptanceView | undefined,
  verdict: 'accepted' | 'rejected',
): ActionAvailability {
  if (status === undefined) return { allowed: false, reasonCode: Rationale.NODE_EXECUTION_MISSING, reason: '步骤尚未执行' };
  if (status !== NodeStatus.SUCCEEDED) {
    if (status === NodeStatus.FAILED) return { allowed: false, reasonCode: Rationale.NODE_NOT_SUCCEEDED, reason: '步骤失败，不能验收；先重试或跳过' };
    if (status === NodeStatus.SKIPPED || status === NodeStatus.CANCELLED) return { allowed: false, reasonCode: Rationale.NODE_NOT_SUCCEEDED, reason: '步骤已跳过或取消，无需人工验收' };
    return { allowed: false, reasonCode: Rationale.NODE_NOT_SUCCEEDED, reason: '步骤尚未成功完成，不能验收' };
  }
  if (acceptance?.state === verdict) {
    return verdict === NodeManualAcceptanceState.ACCEPTED
      ? { allowed: false, reasonCode: Rationale.NODE_ACCEPTED, reason: '已验收通过' }
      : { allowed: false, reasonCode: Rationale.NODE_REJECTED, reason: '已退回修改' };
  }
  return { allowed: true };
}

function hasCycle(nodeIds: readonly string[], edges: readonly { readonly from: string; readonly to: string }[]): boolean {
  const adjacency = new Map<string, string[]>();
  for (const id of nodeIds) adjacency.set(id, []);
  for (const edge of edges) adjacency.get(edge.from)?.push(edge.to);
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): boolean => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    for (const next of adjacency.get(id) ?? []) if (visit(next)) return true;
    visiting.delete(id);
    visited.add(id);
    return false;
  };
  for (const id of nodeIds) if (visit(id)) return true;
  return false;
}
