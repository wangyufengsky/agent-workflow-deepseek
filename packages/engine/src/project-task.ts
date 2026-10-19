import { freezeCodeReviewSnapshot } from './snapshot-review.ts';
import { readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import type {
  ApiEnvelope,
  CatalogSnapshot,
  CommandResponse,
  CreateTaskRequest,
  InboxItem,
  ListTasksQuery,
  ProjectCharterConfirmRequest,
  ProjectCharterGenerateRequest,
  ProjectCharterResponse,
  ProjectCharterStopRequest,
  ProjectCharterUpdateRequest,
  ProjectCharterVersion,
  ProjectCharterView,
  ProjectDetailResponse,
  ProjectSettings,
  ProjectSummary,
  Task,
  TaskDetailResponse,
  TaskSummary,
  UpdateDraftRequest,
  UpdateProjectRequest,
  CreateProjectRequest,
} from '@agent-workflow/shared';
import {
  AppError,
  DEFAULT_CATALOG,
  ErrorCode,
  PLANNING_ROUND_SCOPE_KEY,
  TaskAttention,
  TaskLifecycle,
  TaskStage,
  createId,
  findMethod,
  nowIso,
  unresolvedPlanScopes,
} from '@agent-workflow/shared';
import { executionPolicy as frozenExecutionPolicy } from './execution-policy.ts';
import type { Store } from '@agent-workflow/storage';
import { READ_ONLY_RECOVERY_REASON, computeTaskActions, computeTaskAttention, planningView, readNodeAcceptance, readOnlyRecoveryError } from './actions.ts';
import type { CommandService } from './operations.ts';
import type { OpenCodePort, GitPort } from './ports.ts';
import type { EngineContext } from './actions.ts';

export class ProjectService {
  readonly #store: Store;
  readonly #git: GitPort;
  readonly #commands: CommandService;
  readonly #context: EngineContext;

  constructor(store: Store, git: GitPort, commands: CommandService, context: EngineContext) {
    this.#store = store;
    this.#git = git;
    this.#commands = commands;
    this.#context = context;
  }

  list(includeArchived = false): readonly ProjectSummary[] {
    return this.#store.projects.listSummaries(includeArchived);
  }

  get(projectId: string): ProjectSummary {
    const project = this.#store.projects.listSummaries(true).find((item) => item.id === projectId);
    if (project === undefined) throw new AppError(ErrorCode.NOT_FOUND, '项目不存在');
    return project;
  }

  async register(input: CreateProjectRequest): Promise<CommandResponse<ProjectDetailResponse>> {
    const { record, replayed } = this.#commands.begin({
      requestKey: input.requestKey,
      operation: 'project.create',
      body: { name: input.name, rootPath: input.rootPath, description: input.description ?? '' },
      target: {},
    });
    if (replayed && record.status !== 'accepted') {
      return { receipt: this.#commands.toReceipt(record) };
    }
    try {
      const rootPath = input.rootPath.trim();
      if (rootPath === '') throw new AppError(ErrorCode.VALIDATION_FAILED, '项目路径不能为空');
      const existing = this.#store.projects.findByPath(rootPath);
      if (existing !== undefined) {
        this.#commands.settle(input.requestKey, { projectId: existing.id, existing: true });
        return { receipt: this.#commands.toReceipt(this.#commands.get(input.requestKey)!), resource: this.detail(existing.id) };
      }
      const detection = await this.#git.detect(rootPath);
      const project = this.#store.projects.create({
        name: input.name.trim() || rootPath.split('/').at(-1) || '未命名项目',
        description: input.description ?? '',
        rootPath,
        gitState: detection.gitState,
        defaultBranch: detection.defaultBranch,
        remoteDisplayUrl: detection.remoteDisplayUrl,
      });
      this.#store.repos.upsert({
        projectId: project.id,
        gitState: detection.gitState,
        displayRoot: rootPath,
        defaultBranch: detection.defaultBranch,
        remote: detection.remoteDisplayUrl === undefined ? undefined : { name: 'origin', displayUrl: detection.remoteDisplayUrl },
      });
      this.#store.events.publish('task.changed', { taskId: '', projectId: project.id, stage: 'draft', revision: 0 });
      this.#commands.settle(input.requestKey, { projectId: project.id });
      return { receipt: this.#commands.toReceipt(this.#commands.get(input.requestKey)!), resource: this.detail(project.id) };
    } catch (error) {
      this.#commands.fail(input.requestKey, error as Error);
      throw error;
    }
  }

  update(projectId: string, input: UpdateProjectRequest): CommandResponse<ProjectDetailResponse> {
    const { record, replayed } = this.#commands.begin({
      requestKey: input.requestKey,
      operation: 'project.update',
      body: { projectId, name: input.name, description: input.description, settings: input.settings },
      target: { projectId },
    });
    if (replayed && record.status !== 'accepted') return { receipt: this.#commands.toReceipt(record) };
    try {
      const currentSettings = this.#store.projects.get(projectId)?.settings;
      const updated = this.#store.projects.update(projectId, {
        name: input.name,
        description: input.description,
        ...(input.archived === undefined ? {} : { archived: input.archived }),
        settings: input.settings === undefined
          ? undefined
          : { ...currentSettings, ...normalizeProjectSettingsPatch(input.settings) },
      });
      if (updated === undefined) throw new AppError(ErrorCode.NOT_FOUND, '项目不存在');
      this.#commands.settle(input.requestKey, { projectId });
      return { receipt: this.#commands.toReceipt(this.#commands.get(input.requestKey)!), resource: this.detail(projectId) };
    } catch (error) {
      this.#commands.fail(input.requestKey, error as Error);
      throw error;
    }
  }

  async recheck(projectId: string, input: { requestKey: string }): Promise<CommandResponse<ProjectDetailResponse>> {
    const project = this.#store.projects.get(projectId);
    if (project === undefined) throw new AppError(ErrorCode.NOT_FOUND, '项目不存在');
    const { record, replayed } = this.#commands.begin({
      requestKey: input.requestKey,
      operation: 'project.recheck',
      body: { projectId },
      target: { projectId },
    });
    if (replayed && record.status !== 'accepted') return { receipt: this.#commands.toReceipt(record) };
    try {
      const detection = await this.#git.detect(project.rootPath);
      this.#store.repos.upsert({
        projectId,
        gitState: detection.gitState,
        displayRoot: project.rootPath,
        defaultBranch: detection.defaultBranch,
        remote: detection.remoteDisplayUrl === undefined ? undefined : { name: 'origin', displayUrl: detection.remoteDisplayUrl },
      });
      this.#store.projects.update(projectId, {
        gitState: detection.gitState,
        defaultBranch: detection.defaultBranch,
        remoteDisplayUrl: detection.remoteDisplayUrl,
      });
      this.#commands.settle(input.requestKey, { projectId, gitState: detection.gitState });
      return { receipt: this.#commands.toReceipt(this.#commands.get(input.requestKey)!), resource: this.detail(projectId) };
    } catch (error) {
      this.#commands.fail(input.requestKey, error instanceof Error ? error : new Error('重新检测失败'));
      throw error;
    }
  }

  detail(projectId: string): ProjectDetailResponse {
    const project = this.get(projectId);
    const repo = this.#store.repos.get(projectId);
    const tasks = this.#store.tasks.listByProject(projectId).map((task) => this.#toSummary(task));
    return {
      project,
      repos: repo,
      tasks,
    };
  }

  #toSummary(task: Task): TaskSummary {
    return {
      id: task.id,
      projectId: task.projectId,
      projectName: this.#store.projects.get(task.projectId)?.name ?? '未知项目',
      title: task.title,
      stage: task.stage,
      lifecycle: task.lifecycle,
      attention: task.attention,
      methodName: findMethod(DEFAULT_CATALOG, task.methodId)?.name ?? task.methodId,
      progress: { done: 0, total: 0, running: 0, failed: 0 },
      updatedAt: task.updatedAt,
    };
  }
}

export class TaskService {
  readonly #store: Store;
  readonly #commands: CommandService;
  readonly #context: EngineContext;
  readonly #projects: ProjectService;
  readonly #catalog: CatalogSnapshot;
  readonly #snapshotGit: GitPort | undefined;

  constructor(store: Store, commands: CommandService, context: EngineContext, projects: ProjectService, catalog: CatalogSnapshot, snapshotGit?: GitPort) {
    this.#store = store;
    this.#commands = commands;
    this.#context = context;
    this.#projects = projects;
    this.#catalog = catalog;
    this.#snapshotGit = snapshotGit;
  }

  listByTemplate(templateId: string): readonly TaskSummary[] {
    return this.#store.tasks
      .list()
      .filter((task) => task.fixedTemplate?.templateId === templateId)
      .map((task) => this.#summary(task));
  }

  list(query: ListTasksQuery = {}): readonly TaskSummary[] {
    let tasks = this.#store.tasks.list();
    if (query.projectId !== undefined) tasks = tasks.filter((task) => task.projectId === query.projectId);
    if (query.stage !== undefined) tasks = tasks.filter((task) => task.stage === query.stage);
    if (query.attention !== undefined) tasks = tasks.filter((task) => task.attention === query.attention);
    if (query.q !== undefined && query.q.trim() !== '') {
      const needle = query.q.trim().toLowerCase();
      tasks = tasks.filter((task) => task.title.toLowerCase().includes(needle));
    }
    const limit = Math.min(Math.max(query.limit ?? 50, 1), 200);
    return tasks.slice(0, limit).map((task) => this.#summary(task));
  }

  get(taskId: string): Task {
    const task = this.#store.tasks.get(taskId);
    if (task === undefined) throw new AppError(ErrorCode.NOT_FOUND, '任务不存在');
    return task;
  }

  async createForRequest(input: CreateTaskRequest): Promise<CommandResponse<TaskDetailResponse>> {
    const existing = this.#commands.get(input.requestKey);
    if (existing !== undefined && existing.status !== 'accepted') return this.create(input);
    const template = input.template === undefined ? undefined : this.#catalog.templates.find((item) => item.id === input.template!.templateId);
    if (template?.kind !== 'snapshot_review') return this.create(input);
    const project = this.#store.projects.get(input.projectId);
    if (project?.gitState !== 'git' || this.#snapshotGit?.snapshotInventory === undefined) throw new AppError(ErrorCode.CAPABILITY_UNAVAILABLE, '快照代码评审需要可读取固定源码版本的 Git 仓库');
    const parameters = input.template!.parameters;
    if (parameters === null || typeof parameters !== 'object' || Array.isArray(parameters) || Object.values(parameters).some((value) => typeof value !== 'string')) throw new AppError(ErrorCode.VALIDATION_FAILED, '快照模板参数必须是字符串配置');
    if (parameters.mode === 'incremental' && !parameters.baselineRef?.trim()) throw new AppError(ErrorCode.VALIDATION_FAILED, '增量审查必须填写源码基线');
    const snapshot = freezeCodeReviewSnapshot(await this.#snapshotGit.snapshotInventory({ repoRoot: project.rootPath, targetRef: parameters.targetRef?.trim() || 'HEAD', ...(parameters.mode === 'incremental' ? { baselineRef: parameters.baselineRef?.trim() || undefined } : {}) }), parameters);
    return this.create(input, snapshot);
  }

  create(input: CreateTaskRequest, snapshot?: import('@agent-workflow/shared').CodeReviewSnapshot): CommandResponse<TaskDetailResponse> {
    const { record, replayed } = this.#commands.begin({
      requestKey: input.requestKey,
      operation: input.template === undefined ? 'task.create' : 'template.task.create',
      body: { projectId: input.projectId, title: input.title, requirementText: input.requirementText, methodId: input.methodId, template: input.template },
      target: { projectId: input.projectId },
    });
    if (replayed && record.status !== 'accepted') {
      return { receipt: this.#commands.toReceipt(record), resource: record.target.taskId === undefined ? undefined : this.detail(record.target.taskId) };
    }
    try {
      const project = this.#store.projects.get(input.projectId);
      if (project === undefined) throw new AppError(ErrorCode.NOT_FOUND, '项目不存在');
      if (input.title.trim() === '') throw new AppError(ErrorCode.VALIDATION_FAILED, '任务标题不能为空');
      if (input.requirementText.trim() === '') throw new AppError(ErrorCode.VALIDATION_FAILED, '需求原文不能为空');
      const method = findMethod(this.#catalog, input.methodId);
      if (method === undefined) throw new AppError(ErrorCode.VALIDATION_FAILED, '流程方法不存在');
      if (method.support === 'skeleton_only' && input.template === undefined) {
        // Skeleton-only methods are still accepted; the UI shows the AI-planning marker.
      }
      const selectedTemplate = input.template === undefined ? undefined : this.#catalog.templates.find((template) => template.id === input.template!.templateId);
      if (input.template !== undefined && selectedTemplate === undefined) throw new AppError(ErrorCode.VALIDATION_FAILED, '任务模板不存在');
      if (selectedTemplate?.kind === 'snapshot_review' && snapshot === undefined) throw new AppError(ErrorCode.VALIDATION_FAILED, '快照模板需要先固定源码版本');
      const fixedTemplate = input.template === undefined
        ? undefined
        : {
            templateId: input.template.templateId,
            templateVersion: this.#catalog.templates.find((template) => template.id === input.template!.templateId)?.version ?? 1,
            locked: true as const,
            parameters: input.template.parameters,
            ...(snapshot === undefined ? {} : { snapshot }),
          };
      const task = this.#store.tasks.create({
        projectId: input.projectId,
        title: input.title.trim(),
        requirementText: input.requirementText,
        methodId: method.id,
        methodRevision: method.revision,
        stage: TaskStage.DRAFT,
        fixedTemplate,
      });
      this.#store.settings.putJson(`task.execution-settings.${task.id}`, structuredClone(this.#context.settings().execution));
      this.#store.events.publish('task.changed', { taskId: task.id, projectId: task.projectId, stage: task.stage, revision: 1 });
      this.#commands.settle(input.requestKey, { taskId: task.id });
      const refreshed = this.#commands.get(input.requestKey)!;
      return { receipt: this.#commands.toReceipt(refreshed), resource: this.detail(task.id) };
    } catch (error) {
      this.#commands.fail(input.requestKey, error as Error);
      throw error;
    }
  }

  updateDraft(taskId: string, input: UpdateDraftRequest): CommandResponse<TaskDetailResponse> {
    // A verify_only recovery draft is read-only: refuse at the service boundary
    // (not only in the UI projection) so every write entry point agrees.
    const task = this.get(taskId);
    if (task.readOnly === true) throw readOnlyRecoveryError('修改需求草稿');
    const { record, replayed } = this.#commands.begin({
      requestKey: input.requestKey,
      operation: 'task.updateDraft',
      body: { taskId, title: input.title, requirementText: input.requirementText, supplementText: input.supplementText, expected: input.expected },
      target: { taskId },
    });
    if (replayed && record.status !== 'accepted') return { receipt: this.#commands.toReceipt(record), resource: this.detail(taskId) };
    try {
      if (task.stage !== TaskStage.DRAFT) throw new AppError(ErrorCode.TASK_STAGE_CONFLICT, '只有在需求草稿阶段可以修改原文');
      let requirement = task.requirement;
      if (input.requirementText !== undefined) {
        requirement = { ...requirement, text: input.requirementText, revision: requirement.revision + 1, updatedAt: nowIso() };
      }
      if (input.supplementText !== undefined && input.supplementText.trim() !== '') {
        requirement = {
          ...requirement,
          supplements: [
            ...requirement.supplements,
            { id: createId('sup'), revision: requirement.revision + 1, text: input.supplementText, savedAt: nowIso() },
          ],
          revision: requirement.revision + 1,
          updatedAt: nowIso(),
        };
      }
      this.#store.tasks.update(taskId, {
        title: input.title?.trim() || task.title,
        requirement,
      });
      this.#commands.settle(input.requestKey, { taskId, requirementRevision: requirement.revision });
      return { receipt: this.#commands.toReceipt(this.#commands.get(input.requestKey)!), resource: this.detail(taskId) };
    } catch (error) {
      this.#commands.fail(input.requestKey, error as Error);
      throw error;
    }
  }

  detail(taskId: string): TaskDetailResponse {
    const task = this.get(taskId);
    const project = this.#store.projects.listSummaries().find((item) => item.id === task.projectId);
    if (project === undefined) throw new AppError(ErrorCode.NOT_FOUND, '项目不存在');
    const plan = task.currentPlanRevisionId === undefined ? this.#store.plans.latest(taskId) : this.#store.plans.get(task.currentPlanRevisionId);
    const rounds = this.#store.planning.list(taskId);
    const round = task.currentPlanningRoundId === undefined ? rounds[0] : rounds.find((item) => item.id === task.currentPlanningRoundId) ?? rounds[0];
    const planning = { ...planningView(taskId, rounds), actions: this.#planningActions(task, plan, round) };
    const execution = task.executionId === undefined ? this.#store.executions.byTask(taskId) : this.#store.executions.get(task.executionId);
    const workspace = task.workspaceId === undefined ? this.#store.workspaces.byTask(taskId) : this.#store.workspaces.get(task.workspaceId);
    const delivery = task.deliveryId === undefined ? this.#store.deliveries.byTask(taskId) : this.#store.deliveries.get(task.deliveryId);
    const capabilities = computeTaskActions({
      task,
      plan,
      round,
      execution,
      workspace,
      delivery,
      opencodeReady: this.#context.opencodeReady(),
      planningBudgetConfigured: this.#context.planningBudgetConfigured(),
      gitlabConfigured: this.#context.gitlabConfigured(),
      taskAttemptCount: execution === undefined ? 0 : this.#store.executions.listAttempts(execution.id).length,
      sessionErrorCount: execution === undefined ? 0 : this.#store.settings.getJson<number>(`execution.session-errors.${execution.id}`) ?? 0,
      executionPolicy: execution === undefined ? undefined : frozenExecutionPolicy(this.#store, execution.id, this.#context.settings().execution),
      retryRejectedNodeIds: execution === undefined ? [] : execution.nodes.filter((node) => readNodeAcceptance(this.#store, execution.id, node.nodeId)?.state === 'rejected').map((node) => node.nodeId),
    });
    return {
      task,
      project,
      ...(task.fixedTemplate?.snapshot === undefined ? {} : { templateProgress: { snapshot: task.fixedTemplate.snapshot } }),
      plan,
      planning,
      execution,
      workspace,
      delivery,
      capabilities,
    };
  }

  #planningActions(
    task: Task,
    plan: ReturnType<Store['plans']['get']>,
    round: ReturnType<Store['planning']['get']>,
  ): Record<string, import('@agent-workflow/shared').ActionAvailability> {
    if (task.readOnly === true) {
      const deniedAction = { allowed: false, reasonCode: 'RECOVERY_READ_ONLY', reason: READ_ONLY_RECOVERY_REASON };
      return {
        startPlanning: deniedAction,
        stopPlanning: deniedAction,
        continuePlanning: deniedAction,
        reconcile: deniedAction,
        previewNextRound: deniedAction,
      };
    }
    return {
      startPlanning: this.#context.opencodeReady()
        ? { allowed: true }
        : { allowed: false, reasonCode: 'OPENCODE_NOT_READY', reason: '受管 OpenCode 服务未就绪' },
      stopPlanning: round !== undefined && ['queued', 'running', 'stopping'].includes(round.status)
        ? { allowed: true }
        : { allowed: false, reasonCode: 'OPERATION_IN_PROGRESS', reason: '当前没有进行中的规划' },
      continuePlanning: this.#continuePlanningAvailability(task, plan, round),
    };
  }

  /**
   * PE37 S1/S2 entry point: "继续规划选区" is only meaningful while an overview
   * draft has unrefined groups and no scoped candidate is waiting for apply.
   */
  #continuePlanningAvailability(
    task: Task,
    plan: ReturnType<Store['plans']['get']>,
    round: ReturnType<Store['planning']['get']>,
  ): import('@agent-workflow/shared').ActionAvailability {
    if (task.fixedTemplate !== undefined) {
      return { allowed: false, reasonCode: 'FIXED_TEMPLATE_LOCKED', reason: '固定模板任务不能使用分组细化' };
    }
    if (plan === undefined) {
      return { allowed: false, reasonCode: 'PLAN_NOT_READY', reason: '还没有总览草稿，请先生成计划骨架' };
    }
    if (plan.status === 'confirmed') {
      return { allowed: false, reasonCode: 'PLAN_ALREADY_CONFIRMED', reason: '计划已确认，不能继续细化分组' };
    }
    if (round !== undefined && ['queued', 'running', 'stopping'].includes(round.status)) {
      return { allowed: false, reasonCode: 'OPERATION_IN_PROGRESS', reason: '本轮规划仍在进行，请先等待或停止' };
    }
    if (round !== undefined && round.status === 'completed' && round.applyStatus === 'not_applied' && round.candidate !== undefined) {
      return { allowed: false, reasonCode: 'OPERATION_IN_PROGRESS', reason: '候选计划待应用或不采用，处理后再继续分组细化' };
    }
    const unresolved = unresolvedPlanScopes(plan.graph);
    if (unresolved.length === 0) {
      return { allowed: false, reasonCode: 'PLAN_FULLY_REFINED', reason: '所有分组已细化，可以确认计划' };
    }
    const titles = unresolved.slice(0, 3).map((item) => item.title);
    return {
      allowed: true,
      reason: `还有 ${String(unresolved.length)} 个组未细化${titles.length === 0 ? '' : `：${titles.join('、')}`}`,
    };
  }

  #summary(task: Task): TaskSummary {
    const project = this.#store.projects.get(task.projectId);
    const round = task.currentPlanningRoundId === undefined ? this.#store.planning.latest(task.id) : this.#store.planning.get(task.currentPlanningRoundId);
    const execution = task.executionId === undefined ? this.#store.executions.byTask(task.id) : this.#store.executions.get(task.executionId);
    const delivery = task.deliveryId === undefined ? this.#store.deliveries.byTask(task.id) : this.#store.deliveries.get(task.deliveryId);
    const method = findMethod(this.#catalog, task.methodId);
    const progress = execution?.progress ?? { done: 0, total: this.#store.plans.get(task.currentPlanRevisionId ?? '')?.graph.nodes.length ?? 0, running: 0, failed: 0 };
    return {
      id: task.id,
      projectId: task.projectId,
      projectName: project?.name ?? '未知项目',
      title: task.title,
      stage: task.stage,
      lifecycle: task.lifecycle,
      attention: task.attention,
      methodName: method?.name ?? task.methodId,
      planning: round === undefined ? undefined : { status: round.status, stage: round.stage, lastActivity: round.lastActivity ?? '' },
      progress,
      deliveryProjection: delivery?.projection,
      updatedAt: task.updatedAt,
    };
  }

  recomputeAttention(taskId: string): Task {
    const task = this.get(taskId);
    const round = task.currentPlanningRoundId === undefined ? this.#store.planning.latest(taskId) : this.#store.planning.get(task.currentPlanningRoundId);
    const execution = task.executionId === undefined ? this.#store.executions.byTask(taskId) : this.#store.executions.get(task.executionId);
    const workspace = task.workspaceId === undefined ? this.#store.workspaces.byTask(taskId) : this.#store.workspaces.get(task.workspaceId);
    const delivery = task.deliveryId === undefined ? this.#store.deliveries.byTask(taskId) : this.#store.deliveries.get(task.deliveryId);
    const { attention } = computeTaskAttention({ task, round, execution, workspace, delivery });
    if (attention !== task.attention) {
      const updated = this.#store.tasks.update(taskId, { attention });
      this.#store.events.publish('task.changed', { taskId, projectId: task.projectId, stage: task.stage, revision: 1 });
      return updated ?? task;
    }
    return task;
  }
}

export class InboxService {
  readonly #store: Store;
  readonly #tasks: TaskService;

  constructor(store: Store, tasks: TaskService) {
    this.#store = store;
    this.#tasks = tasks;
  }

  list(limit = 30): readonly InboxItem[] {
    const items: InboxItem[] = [];
    for (const task of this.#store.tasks.list()) {
      if (task.lifecycle !== TaskLifecycle.ACTIVE) continue;
      const project = this.#store.projects.get(task.projectId);
      const round = task.currentPlanningRoundId === undefined ? this.#store.planning.latest(task.id) : this.#store.planning.get(task.currentPlanningRoundId);
      const delivery = task.deliveryId === undefined ? this.#store.deliveries.byTask(task.id) : this.#store.deliveries.get(task.deliveryId);
      const base = {
        projectId: task.projectId,
        taskId: task.id,
        taskTitle: task.title,
        projectName: project?.name ?? '未知项目',
        createdAt: task.updatedAt,
        returnTo: `/requirement/${task.id}`,
      };
      if (round?.stage === 'needs_answer') {
        items.push({ id: `inbox_${task.id}_answer`, kind: 'planning_answer', title: '有必须答复的规划问题', detail: round.questions.filter((question) => question.required).map((question) => question.question).join('；'), ...base });
      } else if (round?.stage === 'awaiting_review') {
        items.push({ id: `inbox_${task.id}_review`, kind: 'planning_review', title: '候选计划待审阅', detail: round.candidate?.summary ?? '候选已生成', ...base });
      } else if (round?.status === 'unknown' || round?.stage === 'unknown') {
        items.push({ id: `inbox_${task.id}_reconcile`, kind: 'planning_reconcile', title: '规划结果待核对', detail: '只按原请求号核对，不会重新生成', ...base });
      }
      if (delivery?.projection === 'awaiting_selection' || delivery?.projection === 'awaiting_confirmation') {
        items.push({
          id: `inbox_${task.id}_delivery`,
          kind: 'delivery_confirm',
          title: delivery.projection === 'awaiting_selection' ? '执行已结束，等待交付' : '交付步骤等待确认',
          detail: delivery.projectionReason ?? '查看变更并交付',
          ...base,
          returnTo: `/tasks/${task.id}`,
        });
      }
    }
    return items
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .slice(0, limit);
  }
}

/* ------------------------------------------------------------------ */
/* Project charter (AGENTS.md)                                         */
/* ------------------------------------------------------------------ */

const CHARTER_KEY_PREFIX = 'project.charter.';
const CHARTER_FILE = 'AGENTS.md';
const CHARTER_MAX_CONTENT = 64_000;
const CHARTER_VERSION_LIMIT = 10;

interface StoredCharterState {
  readonly status: 'draft' | 'writing' | 'written' | 'generating';
  readonly generation?: { readonly requestKey: string; readonly startedAt: string; readonly sessionId?: string; readonly stopRequestKey?: string };
  readonly draft?: { readonly version: number; readonly content: string; readonly source: 'manual' | 'model' | 'existing_file'; readonly savedAt: string };
  readonly written?: { readonly version: number; readonly path: string; readonly writtenAt: string };
  readonly versions: readonly ProjectCharterVersion[];
  readonly updatedAt: string;
}

/**
 * Project charter: read-only model generation, draft editing and separately
 * confirmed atomic writes. In-flight identity is persisted before dispatch.
 * Writes are atomic (temp + rename) and a crash between the persisted
 * `writing` state and completion surfaces as `status=unknown` on read instead of
 * being silently retried.
 */
export class CharterService {
  readonly #store: Store;
  readonly #commands: CommandService;
  readonly #opencode?: OpenCodePort;
  readonly #context?: EngineContext;
  readonly #active = new Map<string, { key: string; sessionId?: string; stopRequested: boolean; preventedDispatch?: boolean }>();

  constructor(store: Store, commands: CommandService, opencode?: OpenCodePort, context?: EngineContext) {
    this.#store = store;
    this.#commands = commands;
    this.#opencode = opencode;
    this.#context = context;
  }

  async view(projectId: string): Promise<ProjectCharterView> {
    const project = this.#requireProject(projectId);
    const state = this.#state(projectId);
    const current = await readCharterFile(project.rootPath);
    const needsReconcile = state?.status === 'writing' || (state?.status === 'generating' && !this.#active.has(projectId));
    const status: ProjectCharterView['status'] = state === undefined
      ? 'none'
      : needsReconcile
        ? 'unknown'
        : state.status;
    const model = this.#context?.settings().models.find((item) => item.enabled && item.roles.includes('planner'));
    const generateReason = needsReconcile || state?.status === 'generating'
      ? { allowed: false, reasonCode: 'CHARTER_STATE_UNKNOWN', reason: '原生成或写入尚未结束；请先核对原操作' }
      : this.#opencode === undefined || this.#context?.opencodeReady() !== true || model === undefined
        ? { allowed: false, reasonCode: 'CHARTER_GENERATION_UNAVAILABLE', reason: '运行环境或规划模型未就绪，请检查设置与运行环境' }
        : { allowed: true };
    return {
      projectId,
      status: status === 'draft' && state?.draft === undefined && state?.written === undefined ? 'none' : status,
      ...(state?.generation === undefined ? {} : { generation: state.generation }),
      ...(state?.draft === undefined ? {} : { draft: state.draft }),
      ...(state?.written === undefined ? {} : { written: { version: state.written.version, path: state.written.path, writtenAt: state.written.writtenAt } }),
      current: { path: CHARTER_FILE, ...current },
      versions: state?.versions ?? [],
      needsReconcile,
      capabilities: {
        generate: generateReason,
        edit: state?.status === 'generating' ? { allowed: false, reason: '生成尚未结束，请先停止并核对' } : { allowed: true },
        confirmWrite: needsReconcile || state?.status === 'generating'
          ? { allowed: false, reasonCode: 'CHARTER_STATE_UNKNOWN', reason: '上次写入状态未明；请先核对 AGENTS.md 或重新编辑草稿' }
          : state?.draft === undefined
            ? { allowed: false, reasonCode: 'NO_CHARTER_DRAFT', reason: '还没有可写入的公约草稿' }
            : { allowed: true },
      },
    };
  }

  async generate(projectId: string, input: ProjectCharterGenerateRequest): Promise<CommandResponse<ProjectCharterResponse>> {
    const project = this.#requireProject(projectId);
    if (input.confirmGenerate !== true) throw new AppError(ErrorCode.VALIDATION_FAILED, '生成公约需要确认模型调用');
    const { record, replayed } = this.#commands.begin({ requestKey: input.requestKey, operation: 'project.charter.generate', body: { projectId }, target: { projectId } });
    if (replayed) return { receipt: this.#commands.toReceipt(record), resource: { charter: await this.view(projectId) } };
    const before = this.#state(projectId);
    const model = this.#context?.settings().models.find((item) => item.enabled && item.roles.includes('planner'));
    const view = await this.view(projectId);
    if (!view.capabilities.generate.allowed || this.#opencode === undefined || model === undefined) {
      const error = new AppError(ErrorCode.CHARTER_GENERATION_UNAVAILABLE, view.capabilities.generate.reason ?? '规划模型未就绪', { details: { capability: 'generate' } });
      this.#commands.fail(input.requestKey, error); throw error;
    }
    // Register synchronously before yielding; another key cannot start a second generation.
    if (this.#state(projectId)?.updatedAt !== before?.updatedAt) { const error = new AppError(ErrorCode.STALE_TARGET, '公约在生成前已变化，请重新读取'); this.#commands.fail(input.requestKey, error); throw error; }
    if (this.#active.has(projectId)) { const error = new AppError(ErrorCode.OPERATION_IN_PROGRESS, '公约仍在生成'); this.#commands.fail(input.requestKey, error); throw error; }
    const active = { key: input.requestKey, stopRequested: false, preventedDispatch: false, sessionId: undefined as string | undefined };
    this.#store.settings.putJson(`charter.before.${input.requestKey}`, before ?? { status: 'draft', versions: [], updatedAt: nowIso() });
    this.#active.set(projectId, active);
    this.#save(projectId, { ...before, status: 'generating', versions: before?.versions ?? [], generation: { requestKey: input.requestKey, startedAt: nowIso() }, updatedAt: nowIso() });
    const opencode = this.#opencode;
    void (async () => {
      try {
        const existing = await readCharterFile(project.rootPath);
        if (active.stopRequested) {
          this.#finishStoppedGeneration(projectId, input.requestKey);
          return;
        }
        const result = await opencode.runSession({ kind: 'planning', metadata: { projectId, purpose: 'project.charter.generate', requestKey: input.requestKey }, cwd: project.rootPath,
          prompt: `根据项目实际目录与配置生成 AGENTS.md。只读项目，不修改任何文件、不执行命令、不联网。输出纯 Markdown 公约，不加代码围栏。涵盖实际目录结构、开发约定、测试命令与未知项；不要编造未读取的信息。当前公约：\n${existing.content ?? '无'}\n项目说明：${project.description ?? ''}`,
          model, permission: 'read_only', sink: {}, timeoutMs: 120_000,
          onSessionId: (sessionId) => {
            active.sessionId = sessionId;
            const current = this.#state(projectId);
            if (current?.generation?.requestKey !== input.requestKey) throw new AppError(ErrorCode.STALE_TARGET, '旧公约生成不能派发会话');
            this.#save(projectId, { ...current, generation: { ...current.generation, sessionId } });
            if (active.stopRequested) {
              active.preventedDispatch = true;
              throw new AppError(ErrorCode.OPERATION_IN_PROGRESS, '公约在派发前已停止');
            }
          },
        });
        if (this.#commands.get(input.requestKey)?.status === 'succeeded') return;
        if (active.stopRequested) {
          if (!result.outcome.idle) throw new AppError(ErrorCode.CHARTER_STATE_UNKNOWN, '公约停止尚未确认');
          this.#finishStoppedGeneration(projectId, input.requestKey);
          return;
        }
        if (result.outcome.timedOut) throw new AppError(ErrorCode.MODEL_BUDGET_EXCEEDED, '公约生成超时');
        if (result.outcome.error) throw new AppError(ErrorCode.OPENCODE_PROVIDER_FAILED, result.outcome.error);
        const content = normalizeCharterContent((result.outcome.assistantText ?? '').replace(/^```(?:markdown|md)?\s*\n|\n```\s*$/g, ''));
        const now = nowIso(); const version = nextCharterVersion(before);
        const draft = { version, content, source: 'model' as const, savedAt: now };
        this.#save(projectId, { status: 'draft', draft, ...(before?.written === undefined ? {} : { written: before.written }), versions: [{ version, status: 'draft' as const, source: 'model' as const, savedAt: now }, ...(before?.versions ?? [])].slice(0, CHARTER_VERSION_LIMIT), updatedAt: now });
        this.#commands.settle(input.requestKey, { projectId, version });
      } catch (error) {
        if (active.preventedDispatch) { this.#finishStoppedGeneration(projectId, input.requestKey); return; }
        if (this.#commands.get(input.requestKey)?.status === 'succeeded') return;
        // Timeout/abort failure may leave the provider alive: preserve original identity.
        const uncertain = active.stopRequested || (error instanceof AppError && error.code === ErrorCode.MODEL_BUDGET_EXCEEDED);
        if (!uncertain) this.#save(projectId, before ?? { status: 'draft', versions: [], updatedAt: nowIso() });
        this.#commands.fail(input.requestKey, error instanceof Error ? error : new Error('公约生成失败'), uncertain);
      } finally { if (this.#active.get(projectId) === active) this.#active.delete(projectId); }
    })();
    return { receipt: this.#commands.toReceipt(record), resource: { charter: await this.view(projectId) } };
  }

  async stop(projectId: string, input: ProjectCharterStopRequest): Promise<CommandResponse<ProjectCharterResponse>> {
    this.#requireProject(projectId);
    if (input.confirmStop !== true) throw new AppError(ErrorCode.VALIDATION_FAILED, '停止需要确认');
    const { record, replayed } = this.#commands.begin({ requestKey: input.requestKey, operation: 'project.charter.stop', body: { projectId }, target: { projectId } });
    if (replayed) return { receipt: this.#commands.toReceipt(record), resource: { charter: await this.view(projectId) } };
    const active = this.#active.get(projectId);
    if (active === undefined) { const error = new AppError(ErrorCode.CHARTER_STATE_UNKNOWN, '没有可观察的生成进程，只能核对原记录'); this.#commands.fail(input.requestKey, error); throw error; }
    const current = this.#state(projectId)!;
    if (current.generation?.stopRequestKey !== undefined) {
      this.#commands.fail(input.requestKey, new AppError(ErrorCode.OPERATION_IN_PROGRESS, '已有停止请求，请核对原请求号'));
      return { receipt: this.#commands.toReceipt(this.#commands.get(input.requestKey)!), resource: { charter: await this.view(projectId) } };
    }
    active.stopRequested = true;
    this.#save(projectId, { ...current, generation: { ...current.generation!, stopRequestKey: input.requestKey } });
    try {
      if (active.sessionId !== undefined) await this.#opencode!.abortSession(active.sessionId);
      // Abort acknowledgement alone never proves the run has settled.
      await this.reconcileOperation(input.requestKey);
    } catch (error) { this.#commands.fail(input.requestKey, error instanceof Error ? error : new Error('停止回执未知'), true); }
    return { receipt: this.#commands.toReceipt(this.#commands.get(input.requestKey)!), resource: { charter: await this.view(projectId) } };
  }

  async reconcileOperation(key: string): Promise<void> {
    const operation = this.#commands.get(key);
    if (operation === undefined || !['project.charter.stop', 'project.charter.generate'].includes(operation.operation) || !['accepted', 'unknown'].includes(operation.status)) return;
    const projectId = operation.target.projectId;
    if (projectId === undefined) return;
    const state = this.#state(projectId);
    if (state?.generation?.stopRequestKey === undefined || state.generation.sessionId === undefined) return;
    try {
      if (await this.#opencode?.inspectSession?.(state.generation.sessionId) === 'idle') this.#finishStoppedGeneration(projectId, state.generation.requestKey);
    } catch { /* A failed status read is not proof that generation stopped. */ }
  }

  #finishStoppedGeneration(projectId: string, key: string): void {
    const state = this.#state(projectId);
    if (state?.generation?.requestKey !== key) return;
    const before = this.#store.settings.getJson<StoredCharterState>(`charter.before.${key}`);
    this.#save(projectId, before ?? { status: 'draft', versions: [], updatedAt: nowIso() });
    this.#commands.settle(key, { stopped: true, draftPreserved: true });
    if (state.generation.stopRequestKey !== undefined) this.#commands.settle(state.generation.stopRequestKey, { confirmedStopped: true, generationRequestKey: key });
  }

  async update(projectId: string, input: ProjectCharterUpdateRequest): Promise<CommandResponse<ProjectCharterResponse>> {
    const project = this.#requireProject(projectId);
    if (this.#state(projectId)?.status === 'generating') throw new AppError(ErrorCode.OPERATION_IN_PROGRESS, '原生成尚未结束，不能覆盖草稿');
    const content = normalizeCharterContent(input.content);
    const { record, replayed } = this.#commands.begin({
      requestKey: input.requestKey,
      operation: 'project.charter.update',
      body: { projectId, content, expectedVersion: input.expectedVersion },
      target: { projectId },
    });
    if (replayed && record.status !== 'accepted') {
      return { receipt: this.#commands.toReceipt(record), resource: { charter: await this.view(projectId) } };
    }
    try {
      const state = this.#state(projectId);
      const latestVersion = state?.draft?.version ?? state?.written?.version ?? 0;
      if (input.expectedVersion !== undefined && input.expectedVersion !== latestVersion) {
        throw new AppError(ErrorCode.STALE_TARGET, '公约草稿已变化，请重新读取后再编辑', {
          details: { expected: input.expectedVersion, actual: latestVersion },
        });
      }
      const now = nowIso();
      const version = nextCharterVersion(state);
      const draft = { version, content, source: 'manual' as const, savedAt: now };
      const versions = [
        { version, status: 'draft' as const, source: 'manual' as const, savedAt: now },
        ...(state?.versions ?? []).filter((item) => item.version !== version),
      ].slice(0, CHARTER_VERSION_LIMIT);
      this.#save(projectId, { status: 'draft', draft, ...(state?.written === undefined ? {} : { written: state.written }), versions, updatedAt: now });
      this.#commands.settle(input.requestKey, { projectId, version });
      return { receipt: this.#commands.toReceipt(this.#commands.get(input.requestKey)!), resource: { charter: await this.view(project.id) } };
    } catch (error) {
      this.#commands.fail(input.requestKey, error instanceof Error ? error : new Error('保存公约草稿失败'));
      throw error;
    }
  }

  async confirm(projectId: string, input: ProjectCharterConfirmRequest): Promise<CommandResponse<ProjectCharterResponse>> {
    const project = this.#requireProject(projectId);
    if (input.confirmWrite !== true) throw new AppError(ErrorCode.VALIDATION_FAILED, '写入公约需要显式确认');
    const { record, replayed } = this.#commands.begin({
      requestKey: input.requestKey,
      operation: 'project.charter.confirm',
      body: { projectId, expectedVersion: input.expectedVersion },
      target: { projectId },
    });
    if (replayed && record.status !== 'accepted') {
      return { receipt: this.#commands.toReceipt(record), resource: { charter: await this.view(projectId) } };
    }
    const state = this.#state(projectId);
    try {
      if (state?.status === 'writing' || state?.status === 'generating') {
        throw new AppError(ErrorCode.CHARTER_STATE_UNKNOWN, '上次写入状态未明，请先核对 AGENTS.md 或重新编辑草稿', {
          details: { path: CHARTER_FILE, fallback: 'PATCH /api/projects/:id/charter' },
        });
      }
      if (state?.draft === undefined) throw new AppError(ErrorCode.VALIDATION_FAILED, '没有可写入的公约草稿');
      if (input.expectedVersion !== undefined && input.expectedVersion !== state.draft.version) {
        throw new AppError(ErrorCode.STALE_TARGET, '公约草稿已变化，请重新读取后再写入', {
          details: { expected: input.expectedVersion, actual: state.draft.version },
        });
      }
      const rootStat = await stat(project.rootPath).catch(() => undefined);
      if (rootStat === undefined || !rootStat.isDirectory()) {
        throw new AppError(ErrorCode.NOT_FOUND, '项目目录不存在或不可访问', { details: { rootPath: project.rootPath } });
      }
      const target = resolve(project.rootPath, CHARTER_FILE);
      if (!target.startsWith(project.rootPath.endsWith(sep) ? project.rootPath : `${project.rootPath}${sep}`)) {
        throw new AppError(ErrorCode.PATH_ESCAPE, '写入路径越出项目目录');
      }
      // Persist the intent first: if the process dies during the write, the
      // next read reports status=unknown instead of pretending success/failure.
      this.#save(projectId, { ...state, status: 'writing', updatedAt: nowIso() });
      const temp = resolve(project.rootPath, `.AGENTS.md.tmp-${String(process.pid)}-${String(Date.now())}`);
      try {
        await writeFile(temp, state.draft.content, { encoding: 'utf8', flag: 'wx' });
        await rename(temp, target);
      } catch (error) {
        await rm(temp, { force: true }).catch(() => undefined);
        this.#save(projectId, { ...state, status: 'draft', updatedAt: nowIso() });
        throw mapCharterWriteError(error);
      }
      const now = nowIso();
      const written = { version: state.draft.version, path: CHARTER_FILE, writtenAt: now };
      const versions = state.versions.map((item) => (item.version === state.draft!.version ? { ...item, status: 'written' as const, writtenAt: now, path: CHARTER_FILE } : item));
      this.#save(projectId, { status: 'written', written, versions, updatedAt: now });
      this.#commands.settle(input.requestKey, { projectId, version: written.version, path: CHARTER_FILE });
      return { receipt: this.#commands.toReceipt(this.#commands.get(input.requestKey)!), resource: { charter: await this.view(projectId) } };
    } catch (error) {
      this.#commands.fail(input.requestKey, error instanceof Error ? error : new Error('写入公约失败'));
      throw error;
    }
  }

  #requireProject(projectId: string) {
    const project = this.#store.projects.get(projectId);
    if (project === undefined) throw new AppError(ErrorCode.NOT_FOUND, '项目不存在');
    return project;
  }

  #state(projectId: string): StoredCharterState | undefined {
    return this.#store.settings.getJson<StoredCharterState>(CHARTER_KEY_PREFIX + projectId);
  }

  #save(projectId: string, state: StoredCharterState): void {
    this.#store.settings.putJson(CHARTER_KEY_PREFIX + projectId, state);
  }
}

function nextCharterVersion(state: StoredCharterState | undefined): number {
  const known = Math.max(
    0,
    state?.draft?.version ?? 0,
    state?.written?.version ?? 0,
    ...(state?.versions ?? []).map((item) => item.version),
  );
  return known + 1;
}

function normalizeCharterContent(value: unknown): string {
  if (typeof value !== 'string') throw new AppError(ErrorCode.VALIDATION_FAILED, '公约内容必须是字符串');
  if (value.trim() === '') throw new AppError(ErrorCode.VALIDATION_FAILED, '公约内容不能为空');
  if (value.length > CHARTER_MAX_CONTENT) throw new AppError(ErrorCode.VALIDATION_FAILED, `公约内容不能超过 ${String(CHARTER_MAX_CONTENT)} 字符`);
  return value;
}

async function readCharterFile(rootPath: string): Promise<{ exists: boolean; content?: string; readError?: string }> {
  try {
    return { exists: true, content: await readFile(resolve(rootPath, CHARTER_FILE), 'utf8') };
  } catch (error) {
    if ((error as { code?: string }).code === 'ENOENT') return { exists: false };
    return { exists: true, readError: error instanceof Error ? error.message : '读取项目公约失败' };
  }
}

function mapCharterWriteError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  const code = (error as { code?: string }).code;
  if (code === 'EACCES' || code === 'EPERM' || code === 'EROFS') {
    return new AppError(ErrorCode.FORBIDDEN, '没有写入项目文件的权限', { details: { path: CHARTER_FILE } });
  }
  if (code === 'ENOSPC') return new AppError(ErrorCode.INTERNAL_ERROR, '写入公约失败：磁盘空间不足');
  return new AppError(ErrorCode.INTERNAL_ERROR, `写入公约失败：${error instanceof Error ? error.message : '未知错误'}`, {
    details: { path: CHARTER_FILE },
  });
}

/* ------------------------------------------------------------------ */
/* Project settings validation                                         */
/* ------------------------------------------------------------------ */

type MutableProjectSettings = { -readonly [K in keyof ProjectSettings]?: ProjectSettings[K] };

function normalizeProjectSettingsPatch(settings: NonNullable<UpdateProjectRequest['settings']>): MutableProjectSettings {
  const patch: MutableProjectSettings = { ...settings };
  if (settings.docPaths !== undefined) patch.docPaths = normalizeDocPaths(settings.docPaths);
  if (settings.gitlab !== undefined) patch.gitlab = normalizeProjectGitlab(settings.gitlab);
  return patch;
}

function normalizeDocPaths(value: unknown): readonly string[] {
  if (!Array.isArray(value)) throw new AppError(ErrorCode.VALIDATION_FAILED, '文档路径必须是数组', { details: { field: 'docPaths' } });
  if (value.length > 20) throw new AppError(ErrorCode.VALIDATION_FAILED, '文档路径最多 20 条', { details: { field: 'docPaths' } });
  const seen = new Set<string>();
  return value.map((item, index) => {
    if (typeof item !== 'string') throw new AppError(ErrorCode.VALIDATION_FAILED, `文档路径 ${index + 1} 必须是字符串`);
    const path = item.trim();
    if (path === '' || path.length > 500) throw new AppError(ErrorCode.VALIDATION_FAILED, `文档路径 ${index + 1} 长度不合法`);
    if (path.startsWith('/') || path.includes('\\') || /(^|\/)\.\.(\/|$)/.test(path) || /[\u0000-\u001f\u007f]/.test(path)) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, `文档路径 ${index + 1} 必须是项目内相对路径`, { details: { path } });
    }
    if (seen.has(path)) throw new AppError(ErrorCode.VALIDATION_FAILED, '文档路径重复', { details: { path } });
    seen.add(path);
    return path;
  });
}

function normalizeProjectGitlab(value: NonNullable<NonNullable<UpdateProjectRequest['settings']>['gitlab']>): ProjectSettings['gitlab'] {
  if (value === null || typeof value !== 'object' || typeof value.inheritGlobal !== 'boolean') {
    throw new AppError(ErrorCode.VALIDATION_FAILED, '项目 GitLab 设置必须包含 inheritGlobal 布尔值', { details: { field: 'settings.gitlab' } });
  }
  const baseUrl = value.baseUrl === undefined ? undefined : value.baseUrl.trim();
  if (baseUrl !== undefined && !/^https?:\/\/[^\s]+$/i.test(baseUrl)) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, '项目 GitLab 地址必须是 http(s) URL', { details: { field: 'settings.gitlab.baseUrl' } });
  }
  const projectPath = value.projectPath === undefined ? undefined : value.projectPath.trim();
  if (projectPath !== undefined && !/^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)+$/.test(projectPath)) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, '项目 GitLab 路径需要是 group/repo 形式', { details: { field: 'settings.gitlab.projectPath' } });
  }
  if (value.inheritGlobal === false && (baseUrl === undefined || projectPath === undefined)) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, '不继承全局 GitLab 时需要提供地址与项目路径', { details: { field: 'settings.gitlab' } });
  }
  if (value.enabled !== undefined && typeof value.enabled !== 'boolean') {
    throw new AppError(ErrorCode.VALIDATION_FAILED, 'settings.gitlab.enabled 必须是布尔值');
  }
  return {
    inheritGlobal: value.inheritGlobal,
    ...(baseUrl === undefined ? {} : { baseUrl }),
    ...(projectPath === undefined ? {} : { projectPath }),
    ...(value.enabled === undefined ? {} : { enabled: value.enabled }),
  };
}

export function computeStageFrom(task: Task): Task['stage'] {
  if (task.stage !== TaskStage.DRAFT) return task.stage;
  return task.currentPlanRevisionId === undefined ? TaskStage.DRAFT : TaskStage.CONFIRMING;
}

export function asEnvelope<T>(data: T, requestId = createId('req')): ApiEnvelope<T> {
  return { data, meta: { requestId, at: nowIso() } };
}

export function attentionFromTask(task: Task): TaskAttentionValueLike {
  return task.attention;
}

type TaskAttentionValueLike = Task['attention'];
