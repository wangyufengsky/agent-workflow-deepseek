import { validQualityReviewContract } from '@agent-workflow/shared';
import { boundAttempt, readableAttempt, readableOutput } from './node-read.ts';
import { freezeRequirement, requirementLinks as sourceLinks, readRequirementSource } from './requirement-source.ts';
import { executionPolicy } from './execution-policy.ts';
import { snapshotPlanGraph } from './snapshot-review.ts';
import type {
  ActionAvailability,
  CommandResponse,
  ConfirmPlanRequest,
  EditAddedNode,
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
  PlanDraftEditChange,
  PlanDraftEditRequest,
  PlanDraftSerializePair,
  PlanEditAbandonRequest,
  PlanResponse,
  PlanRevision,
  PlanValidation,
  TaskDetailResponse,
  UseSkeletonRequest,
  CatalogSnapshot,
  TaskTemplate,
  UseTemplateRequest,
} from '@agent-workflow/shared';
import { AppError, ErrorCode, NodeKind, NodeManualAcceptanceState, NodeStatus, Rationale, SCOPE_UNREFINED, TaskAttention, TaskStage, assertTransition, createId, executionMachine, nowIso, planGraphToCandidatePayload, unresolvedPlanScopes, validatePlanningCandidate } from '@agent-workflow/shared';
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
import { diffGraphs, methodToGraph } from './graph.ts';
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
    const testCommand = this.#store.projects.get(task.projectId)?.settings.testCommand || this.#context.settings().git.defaultTestCommand;
    const evidenceGraph = template.sourceEvidenceVersion === 1 && task.fixedTemplate?.scope ? { ...templateGraph, nodes: templateGraph.nodes.map((node, index) => ({ ...node, sourceEvidence: { version: 1 as const, reportPatterns: this.#store.projects.get(task.projectId)?.settings.evidenceSources?.filter((source) => source.kind === 'junit').map((source) => source.path), stage: template.steps[index]?.sourceStage ?? 'prepare' as const, testCommand, filePaths: (task.fixedTemplate!.scope!.sourceFiles ?? []).map((file) => file.path) } })) } : templateGraph;
    const graph = task.fixedTemplate?.snapshot === undefined ? evidenceGraph : snapshotPlanGraph(templateGraph, task.fixedTemplate.snapshot, template);
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

  /**
   * P11-01 / PE31 / PE28: hand-edit the unconfirmed (or draft) plan revision in
   * the requirement canvas, before execution exists. The result is a new
   * `source: 'edit'` plan revision with a fresh diff and re-run deterministic
   * checks — no model call, no execution, and the previous revision is kept as
   * superseded history. `serialize` adopts “改为先后执行” for resource
   * conflicts: the added order edge is what lets the re-check accept it.
   */
  editDraft(taskId: string, input: PlanDraftEditRequest): CommandResponse<PlanResponse> {
    const changes: readonly PlanDraftEditChange[] = Array.isArray(input.changes) ? (input.changes as readonly PlanDraftEditChange[]) : [];
    const serialize: readonly PlanDraftSerializePair[] = Array.isArray(input.serialize) ? (input.serialize as readonly PlanDraftSerializePair[]) : [];
    const originalReceipt = this.#commands.replay(
      { requestKey: input.requestKey, operation: 'plan.edit.draft', body: { taskId, planRevisionId: input.planRevisionId, expectedRevisionNumber: input.expectedRevisionNumber, changes, serialize, confirmSave: true } },
      () => this.view(taskId),
    );
    if (originalReceipt !== undefined) return originalReceipt;
    const task = this.#assertWritable(taskId, '手改计划');
    if (input.confirmSave !== true) throw new AppError(ErrorCode.VALIDATION_FAILED, '保存手改计划需要显式确认');
    if (task.fixedTemplate !== undefined) throw new AppError(ErrorCode.FIXED_TEMPLATE_LOCKED, '该任务使用固定模板，创建后不能修改步骤；要改要求，请新建模板任务。');
    if (task.stage !== TaskStage.CONFIRMING && task.stage !== TaskStage.DRAFT) {
      throw new AppError(ErrorCode.OPERATION_IN_PROGRESS, '当前阶段不能手改计划；只有确认计划前的草稿可以手改');
    }
    const plan = this.#store.plans.get(input.planRevisionId);
    if (plan === undefined || plan.taskId !== taskId) throw new AppError(ErrorCode.NOT_FOUND, '计划不存在');
    if (task.currentPlanRevisionId !== plan.id) throw new AppError(ErrorCode.STALE_TARGET, '计划已变化，请重新读取后再修改');
    if (plan.revisionNumber !== input.expectedRevisionNumber) throw new AppError(ErrorCode.STALE_TARGET, '计划修订已变化，请重新读取并比对');
    if (plan.status !== 'unconfirmed' && plan.status !== 'draft') {
      throw new AppError(ErrorCode.PLAN_REVISION_CONFLICT, '只有未确认的计划可以手改');
    }
    if (changes.length === 0 && serialize.length === 0) throw new AppError(ErrorCode.VALIDATION_FAILED, '没有要保存的修改');

    const byId = new Map(plan.graph.nodes.map((node) => [node.id, node]));
    const roleIds = new Set(this.#catalog.roles.map((role) => role.id));
    for (const change of changes) {
      if (change === null || typeof change !== 'object' || typeof change.nodeId !== 'string') throw new AppError(ErrorCode.VALIDATION_FAILED, '修改项格式不合法');
      const node = byId.get(change.nodeId);
      if (node === undefined) throw new AppError(ErrorCode.STALE_TARGET, '修改引用的步骤不存在', { details: { nodeId: change.nodeId } });
      if (change.title !== undefined && change.title.trim() === '') throw new AppError(ErrorCode.VALIDATION_FAILED, '步骤名称不能为空', { details: { nodeId: change.nodeId } });
      if (change.roleId !== undefined && change.roleId !== null && !roleIds.has(change.roleId)) {
        throw new AppError(ErrorCode.VALIDATION_FAILED, '指定的职业不在当前角色目录中', { details: { nodeId: change.nodeId, roleId: change.roleId } });
      }
      if (change.acceptance !== undefined && change.acceptance.some((item) => typeof item !== 'string' || item.trim() === '')) {
        throw new AppError(ErrorCode.VALIDATION_FAILED, '验收条款不能为空', { details: { nodeId: change.nodeId } });
      }
    }
    for (const pair of serialize) {
      if (pair === null || typeof pair !== 'object' || !byId.has(pair.fromNodeId) || !byId.has(pair.toNodeId)) {
        throw new AppError(ErrorCode.VALIDATION_FAILED, '“改为先后执行”引用的步骤不存在');
      }
    }

    // Rebuild edges: explicit prerequisite edits replace the incoming order
    // edges of that node; serialize pairs add an order edge (no silent edge is
    // ever invented elsewhere).
    const prerequisiteChanges = new Set(changes.filter((change) => change.prerequisites !== undefined).map((change) => change.nodeId));
    const nextEdges = plan.graph.edges.filter((edge) => !prerequisiteChanges.has(edge.to)).map((edge) => ({ ...edge }));
    for (const change of changes) {
      if (change.prerequisites === undefined) continue;
      const seen = new Set<string>();
      for (const prerequisite of change.prerequisites) {
        const from = byId.get(prerequisite);
        if (from === undefined) throw new AppError(ErrorCode.VALIDATION_FAILED, '前置步骤不存在', { details: { nodeId: change.nodeId, prerequisite } });
        if (prerequisite === change.nodeId) throw new AppError(ErrorCode.VALIDATION_FAILED, '步骤不能依赖自身', { details: { nodeId: change.nodeId } });
        if (seen.has(prerequisite)) continue;
        seen.add(prerequisite);
        nextEdges.push({ id: createId('edge'), from: prerequisite, to: change.nodeId, kind: 'order', label: '手改前置' });
      }
    }
    for (const pair of serialize) {
      const existing = nextEdges.find((edge) => edge.from === pair.fromNodeId && edge.to === pair.toNodeId);
      if (existing !== undefined) continue;
      nextEdges.push({ id: createId('edge'), from: pair.fromNodeId, to: pair.toNodeId, kind: 'order', label: '改为先后执行（用户采纳）' });
    }
    if (hasCycle(plan.graph.nodes.map((node) => node.id), nextEdges)) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, '依赖调整会形成环，未保存');
    }

    const changedById = new Map(changes.map((change) => [change.nodeId, change]));
    const nextNodes = plan.graph.nodes.map((node) => {
      const change = changedById.get(node.id);
      if (change === undefined) return node;
      return {
        ...node,
        title: change.title ?? node.title,
        summary: change.summary ?? node.summary,
        acceptance: change.acceptance ?? node.acceptance,
        roleId: change.roleId === undefined ? node.roleId : change.roleId ?? undefined,
      };
    });
    const nextGraph = { nodes: nextNodes, edges: nextEdges, groups: plan.graph.groups };

    const method = this.#method(task);
    const settings = this.#context.settings();
    // Manual order changes are the user's own reviewed decisions (design
    // PE28/PE31): carry them as human decisions instead of new hard problems.
    const manualOrderKeys = new Set([
      ...changes.filter((change) => change.prerequisites !== undefined).map((change) => byId.get(change.nodeId)!.key),
      ...serialize.map((pair) => byId.get(pair.toNodeId)!.key),
    ]);
    const manualDecisions = [...manualOrderKeys].map((key) => ({
      title: `手工调整顺序：${nextGraph.nodes.find((node) => node.key === key)?.title ?? key}`,
      detail: '用户手改计划形成的新前置；已作为本次修改的依据',
      nodeKeys: [key],
    }));
    const payload = { ...planGraphToCandidatePayload(nextGraph), humanDecisions: manualDecisions };
    const validationResult = validatePlanningCandidate({
      candidate: payload,
      requiredSteps: method.requiredSteps,
      refinableGroups: method.refinableGroups,
      limits: { maxNodes: settings.planning.maxNodes, maxEdges: settings.planning.maxEdges, maxGroups: settings.planning.maxGroups, maxDepth: settings.planning.maxDepth },
      resourceOrderAware: true,
    });
    const priorItems = plan.validation?.humanReview.items ?? [];
    const carriedAccepted = new Map(priorItems.filter((item) => item.accepted).map((item) => [item.title, item]));
    const humanItems = validationResult.humanDecisions.map((decision) => {
      const carried = carriedAccepted.get(decision.title);
      return carried === undefined
        ? { ...decision, accepted: manualOrderKeys.size > 0 && decision.title.startsWith('手工调整顺序'), ...(manualOrderKeys.size > 0 && decision.title.startsWith('手工调整顺序') ? { acceptedBy: 'user', acceptedAt: nowIso() } : {}) }
        : { ...decision, accepted: true, acceptedBy: carried.acceptedBy ?? 'user', acceptedAt: carried.acceptedAt ?? nowIso() };
    });
    const validation: PlanValidation = {
      structural: { state: validationResult.structural, problems: validationResult.problems.map((problem) => ({ ...problem })) },
      humanReview: { required: humanItems.length, accepted: humanItems.filter((item) => item.accepted).length, items: humanItems },
      basis: { state: 'complete', detail: `手工编辑基于需求修订 ${String(task.requirement.revision)}；未调用模型` },
      readiness: { state: validationResult.structural === 'failed' ? 'blocked' : 'needs_preparation', detail: validationResult.structural === 'failed' ? '手改后有必须处理的问题，不能确认' : '确认计划后准备工作区' },
      checks: validationResult.checks.map((check) => ({ ...check })),
      requirementCoverage: validationResult.coverage.map((coverage) => ({
        requirementId: coverage.requirementId,
        label: coverage.label,
        covered: coverage.covered,
        nodeIds: nextGraph.nodes.filter((node) => coverage.nodeKeys.includes(node.key)).map((node) => node.id),
      })),
    };
    const diff = diffGraphs(plan.graph, nextGraph);
    const { record, replayed } = this.#commands.begin({
      requestKey: input.requestKey,
      operation: 'plan.edit.draft',
      body: { taskId, planRevisionId: plan.id, expectedRevisionNumber: input.expectedRevisionNumber, changes, serialize, confirmSave: true },
      target: { taskId },
    });
    if (replayed) return { receipt: this.#commands.toReceipt(record), resource: this.view(taskId) };
    const next = this.#store.plans.create({ taskId, source: 'edit', graph: nextGraph, status: 'unconfirmed', validation, diff, baseRevisionId: plan.id });
    this.#store.plans.setStatus(plan.id, 'superseded');
    this.#store.tasks.update(taskId, { currentPlanRevisionId: next.id, attention: TaskAttention.NONE });
    this.#store.events.publish('plan.changed', { taskId, planRevisionId: next.id, revisionNumber: next.revisionNumber, status: 'unconfirmed' });
    this.#store.events.publish('task.changed', { taskId, projectId: task.projectId, stage: task.stage, revision: 1 });
    this.#commands.settle(input.requestKey, { planRevisionId: next.id, planRevisionNumber: next.revisionNumber });
    this.#tasks().recomputeAttention(taskId);
    return { receipt: this.#commands.toReceipt(this.#commands.get(input.requestKey)!), resource: this.view(taskId) };
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
    // P13-06: node add/remove rides the same edit-save command and request identity.
    const editBody = {
      taskId,
      editSessionId: input.editSessionId,
      changes: input.changes,
      expectedPlanRevisionNumber: input.expectedPlanRevisionNumber,
      ...(input.addedNodes === undefined ? {} : { addedNodes: input.addedNodes }),
      ...(input.removedNodeIds === undefined ? {} : { removedNodeIds: input.removedNodeIds }),
    };
    const originalReceipt = this.#commands.replay({ requestKey: input.requestKey, operation: 'plan.edit.save', body: editBody }, () => this.view(taskId));
    if (originalReceipt !== undefined) return originalReceipt;
    const task = this.#assertWritable(taskId, '保存计划调整');
    const execution = task.executionId === undefined ? undefined : this.#store.executions.get(task.executionId);
    if (execution?.editSession === undefined) throw new AppError(ErrorCode.OPERATION_IN_PROGRESS, '当前没有进行中的调整');
    const { record, replayed } = this.#commands.begin({
      requestKey: input.requestKey,
      operation: 'plan.edit.save',
      body: editBody,
      target: { taskId },
    });
    if (replayed) return { receipt: this.#commands.toReceipt(record), resource: this.view(taskId) };
    const plan = task.currentPlanRevisionId === undefined ? undefined : this.#store.plans.get(task.currentPlanRevisionId);
    if (plan === undefined) throw new AppError(ErrorCode.NOT_FOUND, '计划不存在');
    if (input.editSessionId !== execution.editSession.id || !['editing', 'conflict'].includes(execution.editSession.state)) throw new AppError(ErrorCode.STALE_TARGET, '调整会话已变化或不在编辑状态');
    if (plan.revisionNumber !== input.expectedPlanRevisionNumber) throw new AppError(ErrorCode.STALE_TARGET, '计划修订已变化，请重新读取并比对');
    const locked = new Set([...execution.editSession.lockedNodeIds, ...execution.nodes.filter((node) => node.attemptCount > 0 || !['pending', 'ready'].includes(node.status)).map((node) => node.nodeId)]);
    if (input.addedNodes !== undefined && !Array.isArray(input.addedNodes)) throw new AppError(ErrorCode.VALIDATION_FAILED, '新增步骤必须是步骤集合');
    if (input.removedNodeIds !== undefined && !Array.isArray(input.removedNodeIds)) throw new AppError(ErrorCode.VALIDATION_FAILED, '移出步骤必须是步骤集合');
    const removedNodeIds = [...new Set(input.removedNodeIds ?? [])];
    const addedNodes: readonly EditAddedNode[] = [...(input.addedNodes ?? [])];
    if (removedNodeIds.length !== (input.removedNodeIds ?? []).length) throw new AppError(ErrorCode.VALIDATION_FAILED, '移出步骤不能重复');
    const removedSet = new Set(removedNodeIds);
    const lockedTouched = [...removedNodeIds, ...input.changes.map((change) => change.nodeId)].filter((nodeId) => locked.has(nodeId));
    if (lockedTouched.length > 0) {
      this.#store.executions.update(execution.id, {
        editSession: {
          ...execution.editSession,
          state: 'conflict',
          localChanges: [
            ...input.changes,
            ...removedNodeIds.map((nodeId) => ({ nodeId, removed: true })),
            ...addedNodes.map((node) => ({ nodeId: node.nodeId, title: node.title, prerequisites: node.prerequisites, added: true })),
          ],
        },
        notice: { kind: 'race', message: '有步骤在暂停生效前已被领取；本地修改保留，请重新读取并比对' },
      });
      throw new AppError(ErrorCode.STALE_TARGET, '有步骤已被领取，修改被移出；本地草稿保留', { details: { lockedNodeIds: [...locked] } });
    }
    const changes = input.changes.filter((change) => !locked.has(change.nodeId));
    for (const change of changes) if (change.qualityReview != null && !validQualityReviewContract(change.qualityReview, plan.graph.nodes.find(node => node.id === change.nodeId)?.kind ?? '')) throw new AppError(ErrorCode.VALIDATION_FAILED, '独立评审配置需要verify步骤与非空条款');
    const existingNodeIds = new Set(plan.graph.nodes.map((node) => node.id));
    if (removedNodeIds.some((nodeId) => !existingNodeIds.has(nodeId))) throw new AppError(ErrorCode.STALE_TARGET, '要移出的步骤不存在');
    if (removedNodeIds.some((nodeId) => plan.graph.edges.some((edge) => edge.from === nodeId && locked.has(edge.to)))) throw new AppError(ErrorCode.VALIDATION_FAILED, '有已锁定步骤依赖该步骤，不能移出');
    if (changes.some((change) => !existingNodeIds.has(change.nodeId))) throw new AppError(ErrorCode.STALE_TARGET, '修改引用的步骤不存在');
    const addedIds = new Set<string>();
    for (const added of addedNodes) {
      if (typeof added.nodeId !== 'string' || added.nodeId.trim().length === 0 || added.nodeId.length > 120) throw new AppError(ErrorCode.VALIDATION_FAILED, '新增步骤的标识不合法');
      if (existingNodeIds.has(added.nodeId) || addedIds.has(added.nodeId)) throw new AppError(ErrorCode.VALIDATION_FAILED, '新增步骤的标识已存在', { details: { nodeId: added.nodeId } });
      addedIds.add(added.nodeId);
      if (typeof added.title !== 'string' || added.title.trim().length === 0) throw new AppError(ErrorCode.VALIDATION_FAILED, '新增步骤需要名称');
      if (!Object.values(NodeKind).includes(added.kind)) throw new AppError(ErrorCode.VALIDATION_FAILED, '新增步骤的类型不合法');
      if (!Array.isArray(added.prerequisites)) throw new AppError(ErrorCode.VALIDATION_FAILED, '新增步骤需要前置步骤集合');
    }
    const nextNodeIds = new Set([...[...existingNodeIds].filter((nodeId) => !removedSet.has(nodeId)), ...addedIds]);
    const prerequisiteProblems = (nodeId: string, prerequisites: readonly string[]): void => {
      for (const prerequisite of prerequisites) {
        if (!nextNodeIds.has(prerequisite)) throw new AppError(ErrorCode.VALIDATION_FAILED, '前置步骤不存在', { details: { nodeId, prerequisite } });
        if (prerequisite === nodeId) throw new AppError(ErrorCode.VALIDATION_FAILED, '步骤不能依赖自身', { details: { nodeId } });
      }
    };
    const prerequisitesChanged = new Set(changes.filter((change) => change.prerequisites !== undefined).map((change) => change.nodeId));
    const nextEdges = plan.graph.edges.filter((edge) => !prerequisitesChanged.has(edge.to) && !removedSet.has(edge.from) && !removedSet.has(edge.to));
    for (const change of changes) {
      if (change.prerequisites === undefined) continue;
      prerequisiteProblems(change.nodeId, change.prerequisites);
      const seen = new Set<string>();
      for (const prerequisite of change.prerequisites) {
        if (seen.has(prerequisite)) continue;
        seen.add(prerequisite);
        nextEdges.push({ id: createId('edge'), from: prerequisite, to: change.nodeId, kind: 'order' });
      }
    }
    const groupFor = (added: NonNullable<EditSaveRequest['addedNodes']>[number]): string => {
      const fromPrerequisite = added.prerequisites.map((nodeId) => plan.graph.nodes.find((node) => node.id === nodeId)).find((node) => node !== undefined);
      return fromPrerequisite?.groupId ?? plan.graph.groups[0]?.id ?? 'edit';
    };
    const addedPlanNodes = addedNodes.map((added) => {
      prerequisiteProblems(added.nodeId, added.prerequisites);
      const seen = new Set<string>();
      for (const prerequisite of added.prerequisites) {
        if (seen.has(prerequisite)) continue;
        seen.add(prerequisite);
        nextEdges.push({ id: createId('edge'), from: prerequisite, to: added.nodeId, kind: 'order' });
      }
      return {
        id: added.nodeId,
        key: added.nodeId,
        title: added.title.trim().slice(0, 200),
        kind: added.kind,
        groupId: groupFor(added),
        summary: (added.summary ?? added.title).trim().slice(0, 2_000),
        inputs: [],
        outputs: [],
        acceptance: (added.acceptance ?? []).map((item) => item.trim()).filter((item) => item.length > 0),
        resources: { read: [], write: [] },
      } satisfies import('@agent-workflow/shared').PlanNode;
    });
    if (hasCycle([...nextNodeIds], nextEdges)) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, '依赖调整会形成环，未保存');
    }
    const graph = {
      ...plan.graph,
      edges: nextEdges,
      nodes: [
        ...plan.graph.nodes.filter((node) => !removedSet.has(node.id)).map((node) => {
          const change = changes.find((item) => item.nodeId === node.id);
          if (change === undefined) return node;
          return {
            ...node,
            title: change.title ?? node.title,
            acceptance: change.acceptance ?? node.acceptance,
            qualityReview: change.qualityReview === undefined ? node.qualityReview : change.qualityReview ?? undefined,
          };
        }),
        ...addedPlanNodes,
      ],
    };
    const localChanges = [
      ...changes.map((change) => ({
        nodeId: change.nodeId,
        ...(change.title === undefined ? {} : { title: change.title }),
        ...(change.prerequisites === undefined ? {} : { prerequisites: change.prerequisites }),
        ...(change.acceptance === undefined ? {} : { acceptance: change.acceptance }),
        ...(change.qualityReview === undefined ? {} : { qualityReview: change.qualityReview }),
      })),
      ...addedNodes.map((added) => ({ nodeId: added.nodeId, title: added.title, prerequisites: added.prerequisites, added: true })),
      ...removedNodeIds.map((nodeId) => ({ nodeId, removed: true })),
    ];
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
      editSession: { ...execution.editSession, state: 'saved', localChanges },
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
