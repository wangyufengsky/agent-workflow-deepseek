import type {
  ApiEnvelope,
  CommandResponse,
  CreateTaskRequest,
  InboxItem,
  ListTasksQuery,
  ProjectDetailResponse,
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
  TaskAttention,
  TaskLifecycle,
  TaskStage,
  createId,
  findMethod,
  nowIso,
} from '@agent-workflow/shared';
import type { Store } from '@agent-workflow/storage';
import { computeTaskActions, computeTaskAttention, planningView } from './actions.ts';
import type { CommandService } from './operations.ts';
import type { GitPort } from './ports.ts';
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

  list(): readonly ProjectSummary[] {
    return this.#store.projects.listSummaries();
  }

  get(projectId: string): ProjectSummary {
    const project = this.#store.projects.listSummaries().find((item) => item.id === projectId);
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
      const updated = this.#store.projects.update(projectId, {
        name: input.name,
        description: input.description,
        settings: input.settings === undefined ? undefined : { ...this.#store.projects.get(projectId)?.settings, ...input.settings },
      });
      if (updated === undefined) throw new AppError(ErrorCode.NOT_FOUND, '项目不存在');
      this.#commands.settle(input.requestKey, { projectId });
      return { receipt: this.#commands.toReceipt(this.#commands.get(input.requestKey)!), resource: this.detail(projectId) };
    } catch (error) {
      this.#commands.fail(input.requestKey, error as Error);
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

  constructor(store: Store, commands: CommandService, context: EngineContext, projects: ProjectService) {
    this.#store = store;
    this.#commands = commands;
    this.#context = context;
    this.#projects = projects;
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

  create(input: CreateTaskRequest): CommandResponse<TaskDetailResponse> {
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
      const method = findMethod(DEFAULT_CATALOG, input.methodId);
      if (method === undefined) throw new AppError(ErrorCode.VALIDATION_FAILED, '流程方法不存在');
      if (method.support === 'skeleton_only' && input.template === undefined) {
        // Skeleton-only methods are still accepted; the UI shows the AI-planning marker.
      }
      const fixedTemplate = input.template === undefined
        ? undefined
        : {
            templateId: input.template.templateId,
            templateVersion: DEFAULT_CATALOG.templates.find((template) => template.id === input.template!.templateId)?.version ?? 1,
            locked: true as const,
            parameters: input.template.parameters,
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
    const { record, replayed } = this.#commands.begin({
      requestKey: input.requestKey,
      operation: 'task.updateDraft',
      body: { taskId, title: input.title, requirementText: input.requirementText, supplementText: input.supplementText, expected: input.expected },
      target: { taskId },
    });
    if (replayed && record.status !== 'accepted') return { receipt: this.#commands.toReceipt(record), resource: this.detail(taskId) };
    try {
      const task = this.get(taskId);
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
    const planning = { ...planningView(taskId, rounds), actions: this.#planningActions(round) };
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
    });
    return {
      task,
      project,
      plan,
      planning,
      execution,
      workspace,
      delivery,
      capabilities,
    };
  }

  #planningActions(round: ReturnType<Store['planning']['get']>): Record<string, import('@agent-workflow/shared').ActionAvailability> {
    return {
      startPlanning: this.#context.opencodeReady()
        ? { allowed: true }
        : { allowed: false, reasonCode: 'OPENCODE_NOT_READY', reason: '受管 OpenCode 服务未就绪' },
      stopPlanning: round !== undefined && ['queued', 'running', 'stopping'].includes(round.status)
        ? { allowed: true }
        : { allowed: false, reasonCode: 'OPERATION_IN_PROGRESS', reason: '当前没有进行中的规划' },
    };
  }

  #summary(task: Task): TaskSummary {
    const project = this.#store.projects.get(task.projectId);
    const round = task.currentPlanningRoundId === undefined ? this.#store.planning.latest(task.id) : this.#store.planning.get(task.currentPlanningRoundId);
    const execution = task.executionId === undefined ? this.#store.executions.byTask(task.id) : this.#store.executions.get(task.executionId);
    const delivery = task.deliveryId === undefined ? this.#store.deliveries.byTask(task.id) : this.#store.deliveries.get(task.deliveryId);
    const method = findMethod(DEFAULT_CATALOG, task.methodId);
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
