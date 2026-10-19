import type {
  CommandResponse,
  ConfirmPlanRequest,
  EditBeginRequest,
  EditFinishRequest,
  EditSaveRequest,
  NodeDetail,
  PlanResponse,
  PlanRevision,
  TaskDetailResponse,
  UseSkeletonRequest,
} from '@agent-workflow/shared';
import { AppError, ErrorCode, NodeStatus, TaskAttention, TaskStage, nowIso } from '@agent-workflow/shared';
import type { EngineContext } from './actions.ts';
import type { CommandService } from './operations.ts';
import type { GitPort } from './ports.ts';
import type { Store } from '@agent-workflow/storage';
import { methodToGraph } from './graph.ts';
import type { TaskService } from './project-task.ts';

export class PlanService {
  readonly #store: Store;
  readonly #commands: CommandService;
  readonly #context: EngineContext;
  readonly #git: GitPort;
  readonly #tasks: () => TaskService;

  constructor(store: Store, commands: CommandService, context: EngineContext, git: GitPort, tasks: () => TaskService) {
    this.#store = store;
    this.#commands = commands;
    this.#context = context;
    this.#git = git;
    this.#tasks = tasks;
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

  useSkeleton(taskId: string, input: UseSkeletonRequest): CommandResponse<PlanResponse> {
    const task = this.#requireTask(taskId);
    if (task.fixedTemplate !== undefined) throw new AppError(ErrorCode.FIXED_TEMPLATE_LOCKED, '固定模板任务使用模板步骤，不能使用方法骨架');
    const method = this.#method(task);
    const { record, replayed } = this.#commands.begin({
      requestKey: input.requestKey,
      operation: 'plan.skeleton.use',
      body: { taskId, confirmUseSkeleton: true },
      target: { taskId },
    });
    if (replayed && record.status !== 'accepted') return { receipt: this.#commands.toReceipt(record), resource: this.view(taskId) };
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
    const task = this.#requireTask(taskId);
    const plan = this.#store.plans.get(input.planRevisionId);
    if (plan === undefined || plan.taskId !== taskId) throw new AppError(ErrorCode.NOT_FOUND, '计划不存在');
    if (plan.status !== 'unconfirmed' && plan.status !== 'draft') {
      throw new AppError(ErrorCode.PLAN_REVISION_CONFLICT, '只有未确认的计划可以确认');
    }
    if (input.expectedRevisionNumber !== undefined && plan.revisionNumber !== input.expectedRevisionNumber) {
      throw new AppError(ErrorCode.STALE_TARGET, '计划已变化，请重新读取后确认', { details: { expected: input.expectedRevisionNumber, actual: plan.revisionNumber } });
    }
    if (plan.validation?.structural.state === 'failed') {
      throw new AppError(ErrorCode.VALIDATION_FAILED, '计划仍有必须处理的问题，不能确认');
    }
    const { record, replayed } = this.#commands.begin({
      requestKey: input.requestKey,
      operation: 'plan.confirm',
      body: { taskId, planRevisionId: plan.id, expectedRevisionNumber: input.expectedRevisionNumber, confirmPlan: true },
      target: { taskId },
    });
    if (replayed && record.status !== 'accepted') {
      return { receipt: this.#commands.toReceipt(record), resource: this.#tasks().detail(taskId) };
    }
    const settings = this.#context.settings();
    const project = this.#requireProject(task.projectId);
    this.#store.plans.setStatus(plan.id, 'confirmed', { confirmedBy: 'user', supersedeSiblingsForTaskId: taskId });
    const execution = this.#store.executions.byTask(taskId) ??
      this.#store.executions.create({
        taskId,
        planRevisionId: plan.id,
        graph: plan.graph,
        autoAdvance: settings.execution.autoAdvanceByDefault,
      });
    const workspace =
      this.#store.workspaces.byTask(taskId) ??
      this.#store.workspaces.create({
        taskId,
        kind: project.gitState === 'git' ? 'git_worktree' : 'directory_copy',
        originalRootDisplay: project.rootPath,
        baseRef: project.defaultBranch,
      });
    this.#store.tasks.update(taskId, {
      stage: TaskStage.PREPARING,
      attention: TaskAttention.NONE,
      currentPlanRevisionId: plan.id,
      executionId: execution.id,
      workspaceId: workspace.id,
    });
    this.#store.events.publish('plan.changed', { taskId, planRevisionId: plan.id, revisionNumber: plan.revisionNumber, status: 'confirmed' });
    this.#store.events.publish('task.changed', { taskId, projectId: task.projectId, stage: TaskStage.PREPARING, revision: 1 });
    this.#commands.settle(input.requestKey, { planRevisionId: plan.id, executionId: execution.id, workspaceId: workspace.id });
    this.#tasks().recomputeAttention(taskId);
    return { receipt: this.#commands.toReceipt(this.#commands.get(input.requestKey)!), resource: this.#tasks().detail(taskId) };
  }

  editBegin(taskId: string, input: EditBeginRequest): CommandResponse<PlanResponse> {
    const task = this.#requireTask(taskId);
    if (task.fixedTemplate !== undefined) throw new AppError(ErrorCode.FIXED_TEMPLATE_LOCKED, '该任务使用固定模板，创建后不能修改步骤；要改要求，请新建模板任务。');
    const execution = task.executionId === undefined ? undefined : this.#store.executions.get(task.executionId);
    if (execution === undefined) throw new AppError(ErrorCode.NOT_FOUND, '执行尚未创建');
    if (execution.status !== 'running' && execution.status !== 'paused') {
      throw new AppError(ErrorCode.OPERATION_IN_PROGRESS, '当前执行状态不能调整计划');
    }
    const { record, replayed } = this.#commands.begin({
      requestKey: input.requestKey,
      operation: 'plan.edit.begin',
      body: { taskId, planRevisionId: input.planRevisionId, confirmPause: true },
      target: { taskId },
    });
    if (replayed && record.status !== 'accepted') return { receipt: this.#commands.toReceipt(record), resource: this.view(taskId) };
    const locked = execution.nodes.filter((node) => node.status !== 'pending' && node.status !== 'ready').map((node) => node.nodeId);
    this.#store.executions.update(execution.id, {
      status: 'paused',
      editSession: {
        id: `edit_${execution.id}`,
        state: 'editing',
        requestKey: input.requestKey,
        autoAdvanceBeforeEdit: execution.autoAdvance,
        lockedNodeIds: locked,
        localChanges: [],
      },
      notice: { kind: 'paused', message: '已暂停新增领取；运行中的步骤按原快照继续' },
    });
    this.#commands.settle(input.requestKey, { editSessionId: `edit_${execution.id}` });
    this.#store.events.publish('execution.changed', { taskId, executionId: execution.id, status: 'paused', revision: 1 });
    return { receipt: this.#commands.toReceipt(this.#commands.get(input.requestKey)!), resource: this.view(taskId) };
  }

  editSave(taskId: string, input: EditSaveRequest): CommandResponse<PlanResponse> {
    const task = this.#requireTask(taskId);
    const execution = task.executionId === undefined ? undefined : this.#store.executions.get(task.executionId);
    if (execution?.editSession === undefined) throw new AppError(ErrorCode.OPERATION_IN_PROGRESS, '当前没有进行中的调整');
    const { record, replayed } = this.#commands.begin({
      requestKey: input.requestKey,
      operation: 'plan.edit.save',
      body: { taskId, editSessionId: input.editSessionId, changes: input.changes, expectedPlanRevisionNumber: input.expectedPlanRevisionNumber },
      target: { taskId },
    });
    if (replayed && record.status !== 'accepted') return { receipt: this.#commands.toReceipt(record), resource: this.view(taskId) };
    const plan = task.currentPlanRevisionId === undefined ? undefined : this.#store.plans.get(task.currentPlanRevisionId);
    if (plan === undefined) throw new AppError(ErrorCode.NOT_FOUND, '计划不存在');
    const locked = new Set(execution.editSession.lockedNodeIds);
    const changes = input.changes.filter((change) => !locked.has(change.nodeId));
    if (changes.length !== input.changes.length) {
      this.#store.executions.update(execution.id, {
        editSession: { ...execution.editSession, state: 'conflict', localChanges: input.changes },
        notice: { kind: 'race', message: '有步骤在暂停生效前已被领取；本地修改保留，请重新读取并比对' },
      });
      throw new AppError(ErrorCode.STALE_TARGET, '有步骤已被领取，修改被移出；本地草稿保留', { details: { lockedNodeIds: [...locked] } });
    }
    const graph = {
      ...plan.graph,
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
    const task = this.#requireTask(taskId);
    const execution = task.executionId === undefined ? undefined : this.#store.executions.get(task.executionId);
    if (execution?.editSession === undefined) throw new AppError(ErrorCode.OPERATION_IN_PROGRESS, '当前没有进行中的调整');
    const { record, replayed } = this.#commands.begin({
      requestKey: input.requestKey,
      operation: 'plan.edit.finish',
      body: { taskId, editSessionId: input.editSessionId, continueExecution: input.continueExecution },
      target: { taskId },
    });
    if (replayed && record.status !== 'accepted') return { receipt: this.#commands.toReceipt(record), resource: this.view(taskId) };
    const nextPlan = task.currentPlanRevisionId === undefined ? undefined : this.#store.plans.get(task.currentPlanRevisionId);
    if (nextPlan !== undefined && input.continueExecution) {
      this.#store.plans.setStatus(nextPlan.id, 'confirmed', { confirmedBy: 'user', supersedeSiblingsForTaskId: taskId });
    }
    this.#store.executions.update(execution.id, {
      status: input.continueExecution ? 'running' : 'paused',
      autoAdvance: execution.editSession.autoAdvanceBeforeEdit,
      editSession: { ...execution.editSession, state: 'finished' },
      notice: input.continueExecution ? undefined : { kind: 'paused', message: '调整已保存，执行保持暂停' },
    });
    this.#store.events.publish('execution.changed', { taskId, executionId: execution.id, status: input.continueExecution ? 'running' : 'paused', revision: 1 });
    this.#commands.settle(input.requestKey, { continued: input.continueExecution });
    return { receipt: this.#commands.toReceipt(this.#commands.get(input.requestKey)!), resource: this.view(taskId) };
  }

  nodeDetail(taskId: string, nodeId: string): NodeDetail {
    const task = this.#requireTask(taskId);
    const plan = task.currentPlanRevisionId === undefined ? this.#store.plans.latest(taskId) : this.#store.plans.get(task.currentPlanRevisionId);
    if (plan === undefined) throw new AppError(ErrorCode.NOT_FOUND, '当前没有计划');
    const node = plan.graph.nodes.find((item) => item.id === nodeId);
    if (node === undefined) throw new AppError(ErrorCode.NOT_FOUND, '步骤不存在');
    const group = plan.graph.groups.find((item) => item.id === node.groupId);
    const requirementLinks = node.inputs
      .filter((input) => input.source === 'requirement')
      .map((input) => ({ entryId: input.name, label: input.name, text: task.requirement.entries.find((entry) => entry.text.includes(input.name))?.text ?? input.name }));
    const dependencyReasons = plan.graph.edges
      .filter((edge) => edge.to === node.id)
      .map((edge) => ({ fromNodeId: edge.from, kind: edge.kind, reason: edge.kind === 'data' ? '数据依赖' : edge.kind === 'resource' ? '资源依赖' : '顺序依赖' }));
    const execution = task.executionId === undefined ? undefined : this.#store.executions.get(task.executionId);
    const attemptStates = execution === undefined ? [] : this.#store.executions.listAttempts(execution.id, node.id);
    const currentNode = execution?.nodes.find((item) => item.nodeId === node.id);
    const currentAttempt = attemptStates.find((attempt) => attempt.id === currentNode?.currentAttemptId) ?? attemptStates[0];
    const output = currentAttempt === undefined ? [] : this.#store.executions.listOutput(currentAttempt.id);
    return {
      taskId,
      nodeId,
      planRevisionId: plan.id,
      node,
      group,
      requirementLinks,
      dependencyReasons,
      execution: currentNode,
      currentAttempt,
      attempts: attemptStates,
      output: {
        fragments: output,
        nextSeq: output.at(-1)?.seq ?? 0,
        terminal: currentNode === undefined ? false : currentNode.status !== NodeStatus.RUNNING,
        capabilities: { modelText: 'ok', publicReasoningSummary: 'none_in_attempt', toolSources: ['managed_mcp'] },
      },
      actions: {
        accept: currentNode?.status === NodeStatus.SUCCEEDED ? { allowed: false, reason: '已完成' } : { allowed: false, reason: '执行未实现验收动作' },
      },
    };
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

  #method(task: ReturnType<Store['tasks']['get']> & object) {
    const { DEFAULT_CATALOG, findMethod } = requireCatalog();
    const method = findMethod(DEFAULT_CATALOG, task.methodId);
    if (method === undefined) throw new AppError(ErrorCode.NOT_FOUND, '流程方法不存在');
    return method;
  }
}

import * as sharedCatalog from '@agent-workflow/shared';
function requireCatalog(): typeof sharedCatalog {
  return sharedCatalog;
}
