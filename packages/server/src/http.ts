import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type {
  ActionAvailability,
  ApiEnvelope,
  RecoveryCreateRequest,
  RoleSaveRequest,
  RolePublishRequest,
  RoleArchiveRequest,
  TemplateImportRequest,
  TemplateUpdateRequest,
  NodeSkipRequest,
  UseTemplateRequest,
  KnowledgeAskRequest,
  PptWorkCreateRequest,
  PptWorkGenerateRequest,
  PptWorkGenerateContentRequest,
  PptAttachmentRequest,
  TaskAcceptanceRequest,
  RoleRestoreRequest,
  PptWorkUpdateRequest,
  DatabaseConnectionUpsertRequest,
  PlanningPreviewRequest,
  CommandRequest,
  CreateProjectRequest,
  CreateTaskRequest,
  ExecutionCommandRequest,
  ListTasksQuery,
  PrepareWorkspaceRequest,
  UpdateDraftRequest,
  UpdateProjectRequest,
  UpdateSettingsRequest,
  UseSkeletonRequest,
  ConfirmPlanRequest,
  EditBeginRequest,
  EditSaveRequest,
  EditFinishRequest,
  PlanEditAbandonRequest,
  ExecutionAdvanceRequest,
  ExecutionAutoAdvanceRequest,
  PlanningStartRequest,
  PlanningStopRequest,
  PlanningApplyRequest,
  PlanningRejectRequest,
  SaveAnswerRequest,
  DeliverySelectRequest,
  DeliveryCommitRequest,
  DeliveryPushRequest,
  DeliveryMergeRequest,
  GitLabConnectionRequest,
  GitFetchRequest,
  OpenCodeRestartRequest,
  TemplateArchiveRequest,
  NodeStatusValue,
} from '@agent-workflow/shared';
import {
  AppError,
  DatabaseConnectionState,
  ErrorCode,
  MCP_TOOL_COUNTS_BY_TOOLSET,
  NODE_TERMINAL_STATUSES,
  NodeStatus,
  THEMES,
  THEME_ORDER,
  createId,
  mergeSettings,
  nowIso,
  validateSettings,
  type AppSettings,
} from '@agent-workflow/shared';
import type { Store } from '@agent-workflow/storage';
import type { DatabaseService } from '@agent-workflow/database';
import type { RemoteService } from './remote.ts';
import { fileIdFor } from './adapters/git-cli.ts';
import { detectOpenCodeBinaries } from './opencode-detect.ts';
import { readOpenCodeLogTail } from './opencode-logs.ts';
import { discoverSkills, readSkillSource } from './skills.ts';
import { listDirectories } from './fs-directories.ts';
import { listKnowledgeSources, readKnowledgeSource, searchKnowledgeSources } from './knowledge.ts';
import type { Engine } from '@agent-workflow/engine';
import type { OpenCodeAdapter } from './adapters/opencode.ts';
import type { RuntimePaths } from './runtime.ts';

export interface HttpDependencies {
  readonly engine: Engine;
  readonly store: Store;
  readonly opencodeRef: { current?: OpenCodeAdapter | undefined };
  readonly databaseService?: DatabaseService;
  readonly remoteService?: RemoteService;
  readonly gateway?: { stats(): { readonly enabled: boolean; readonly requests: number; readonly normalized: number; readonly lastRequestAt?: string; readonly lastError?: string } };
  readonly paths: RuntimePaths;
  readonly internalToken: string;
  readonly appVersion: string;
  readonly startedAt: string;
}

const REQUEST_ID = Symbol('requestId');

export function envelope<T>(data: T, requestId: string, revision?: string): ApiEnvelope<T> {
  return { data, meta: { requestId, at: nowIso(), ...(revision === undefined ? {} : { revision }) } };
}

export function mapError(error: unknown): { status: number; body: { error: { code: string; message: string; details?: Record<string, unknown>; retryable: boolean } } } {
  if (error instanceof AppError) {
    const status = error.httpStatus;
    return {
      status,
      body: {
        error: {
          code: error.code,
          message: error.message,
          details: error.details,
          retryable: status >= 500 || status === 409,
        },
      },
    };
  }
  const message = error instanceof Error ? error.message : '未知错误';
  return { status: 500, body: { error: { code: ErrorCode.INTERNAL_ERROR, message, retryable: true } } };
}

export function registerErrorHandler(app: FastifyInstance, log?: (error: unknown) => void): void {
  app.setErrorHandler((error, request, reply) => {
    const requestId = String((request as FastifyRequest & { id?: string }).id ?? createId('req'));
    const mapped = mapError(error);
    if (mapped.status >= 500) log?.(error);
    reply.status(mapped.status).send({
      error: { ...mapped.body.error, requestId, at: nowIso() },
    });
  });
  app.setNotFoundHandler((request, reply) => {
    reply.status(404).send(apiNotFoundBody(request.method, request.url, createId('req')));
  });
}

/**
 * JSON 404 body shared by the Fastify not-found handler and the SPA fallback.
 * The fallback must never answer an unknown `/api/*` GET with index.html, or a
 * missing endpoint would look like a 200 success to clients.
 */
function apiNotFoundBody(method: string, url: string, requestIdValue: string) {
  return {
    error: {
      code: ErrorCode.NOT_FOUND,
      message: `未知路由 ${method} ${url}`,
      requestId: requestIdValue,
      at: nowIso(),
      retryable: false,
    },
  };
}

/**
 * True when `candidate` resolves inside `root` (or equals it). A plain
 * `startsWith` check is not enough: `/srv/dist-evil/x` starts with `/srv/dist`
 * but escapes the served directory. Both sides are resolved to absolute paths
 * first so `..` segments are honored.
 */
export function isPathInside(root: string, candidate: string): boolean {
  const resolvedRoot = resolve(root);
  const resolvedCandidate = resolve(candidate);
  return resolvedCandidate === resolvedRoot || resolvedCandidate.startsWith(`${resolvedRoot}${sep}`);
}

/**
 * Route signatures (`METHOD <fastify pattern>`) whose JSON body is a
 * `CommandRequest`. These are validated before the handler runs so a missing
 * `requestKey` returns 400 VALIDATION_FAILED instead of reaching
 * `CommandService.begin` and surfacing as an internal 500.
 */
const COMMAND_ROUTE_SIGNATURES: ReadonlySet<string> = new Set([
  'POST /api/projects',
  'PATCH /api/projects/:id',
  'POST /api/projects/:id/recheck',
  'POST /api/tasks',
  'PATCH /api/tasks/:id',
  'POST /api/tasks/:id/planning/start',
  'POST /api/tasks/:id/planning/stop',
  'POST /api/tasks/:id/planning/apply',
  'POST /api/tasks/:id/planning/reject',
  'POST /api/tasks/:id/planning/answers',
  'POST /api/tasks/:id/plan/from-template',
  'POST /api/tasks/:id/plan/skeleton',
  'POST /api/tasks/:id/plan/confirm',
  'POST /api/tasks/:id/plan/edit/begin',
  'POST /api/tasks/:id/plan/edit/save',
  'POST /api/tasks/:id/plan/edit/finish',
  'POST /api/tasks/:id/plan/edit/abandon',
  'POST /api/tasks/:id/workspace/prepare',
  'POST /api/tasks/:id/workspace/cleanup/confirm',
  'POST /api/tasks/:id/execution/start',
  'POST /api/tasks/:id/execution/pause',
  'POST /api/tasks/:id/execution/resume',
  'POST /api/tasks/:id/execution/retry',
  'POST /api/tasks/:id/execution/auto-advance',
  'POST /api/tasks/:id/execution/advance',
  'POST /api/tasks/:id/execution/cancel',
  'POST /api/tasks/:id/execution/nodes/:nodeId/skip',
  'POST /api/tasks/:id/delivery/select',
  'POST /api/tasks/:id/delivery/commit',
  'POST /api/tasks/:id/delivery/push',
  'POST /api/tasks/:id/delivery/merge-request',
  'POST /api/tasks/:id/delivery/merge',
  'POST /api/tasks/:id/recovery',
  'POST /api/tasks/:id/acceptance',
  'POST /api/git/repos/:projectId/fetch',
  'POST /api/catalog/templates/import',
  'PATCH /api/catalog/templates/:id',
  'DELETE /api/catalog/templates/:id',
  'POST /api/catalog/roles',
  'POST /api/catalog/roles/:id/publish',
  'POST /api/catalog/roles/:id/archive',
  'POST /api/catalog/roles/:id/restore/:revision',
  'POST /api/settings/gitlab',
  'PATCH /api/settings',
  'POST /api/settings/databases',
  'POST /api/knowledge/ask',
  'POST /api/opencode/restart',
]);

function validateCommandBody(request: FastifyRequest): void {
  const body = request.body;
  const record = body !== null && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : undefined;
  const requestKey = record?.requestKey;
  if (typeof requestKey === 'string' && requestKey.trim() !== '') return;
  throw new AppError(ErrorCode.VALIDATION_FAILED, '缺少 requestKey', {
    details: { hint: '写操作必须在 JSON 请求体中携带 req_ 前缀的 requestKey' },
  });
}

/**
 * Typed command body reader. Routes in {@link COMMAND_ROUTE_SIGNATURES} are
 * already validated by the hook; this keeps handler-level types honest and
 * supports the legacy DELETE route where clients historically omitted a body.
 */
function commandBody<T extends CommandRequest>(request: FastifyRequest, options: { readonly generateRequestKey?: boolean } = {}): T {
  const body = request.body;
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    if (options.generateRequestKey === true) return { requestKey: createId('req') } as T;
    throw new AppError(ErrorCode.VALIDATION_FAILED, '请求体必须是 JSON 对象');
  }
  const record = body as Record<string, unknown>;
  if (typeof record.requestKey === 'string' && record.requestKey.trim() !== '') return body as T;
  if (options.generateRequestKey === true) return { ...record, requestKey: createId('req') } as T;
  throw new AppError(ErrorCode.VALIDATION_FAILED, '缺少 requestKey');
}

/**
 * Output streams are closed once the node/attempt can no longer append
 * fragments. `unknown` is included: after a process restart the attempt cannot
 * resume unless the user retries (which creates a new attempt).
 */
function isTerminalOutputStatus(status: NodeStatusValue | undefined): boolean {
  if (status === undefined) return false;
  return status === NodeStatus.UNKNOWN || NODE_TERMINAL_STATUSES.includes(status);
}

/** Tool count for the enabled toolsets (mirrors the managed MCP registry). */
function countEnabledMcpTools(toolsets: readonly string[]): number {
  let total = 0;
  for (const toolset of new Set(toolsets)) {
    const count = MCP_TOOL_COUNTS_BY_TOOLSET[toolset as keyof typeof MCP_TOOL_COUNTS_BY_TOOLSET];
    if (typeof count === 'number') total += count;
  }
  return total;
}

export function registerCors(app: FastifyInstance, allowedOrigins: readonly string[]): void {
  app.addHook('onRequest', async (request, reply) => {
    const origin = request.headers.origin;
    if (origin !== undefined && (allowedOrigins.includes(origin) || allowedOrigins.includes('*'))) {
      reply.header('access-control-allow-origin', origin);
      reply.header('access-control-allow-credentials', 'true');
      reply.header('access-control-allow-headers', 'content-type, x-request-id');
      reply.header('access-control-allow-methods', 'GET,POST,PATCH,DELETE,OPTIONS');
    }
    if (request.method === 'OPTIONS') {
      reply.status(204).send();
    }
  });
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.map': 'application/json',
};

export function registerRoutes(app: FastifyInstance, deps: HttpDependencies): void {
  const { engine, store, opencodeRef, paths, databaseService, remoteService } = deps;
  const requestId = (request: FastifyRequest): string => String((request as FastifyRequest & { id?: string }).id ?? createId('req'));
  // Command envelopes are validated once, before any handler can reach domain
  // services. Hooks registered here also cover routes added by later plugins.
  app.addHook('preValidation', async (request) => {
    const routeUrl = request.routeOptions.url;
    if (routeUrl === undefined) return;
    if (!COMMAND_ROUTE_SIGNATURES.has(`${request.method} ${routeUrl}`)) return;
    validateCommandBody(request);
  });
  /** View `actions` reuse the task capability projection instead of a constant `{}`. */
  const viewActions = (taskId: string): Record<string, ActionAvailability> => engine.tasks.detail(taskId).capabilities;

  app.get<{ Querystring: { path?: string } }>('/api/fs/directories', async (request) => envelope(listDirectories(request.query.path), requestId(request)));
  app.get('/api/health', async (request) => ({
    status: 'ok',
    name: 'agent-workflow',
    version: deps.appVersion,
    node: process.version,
    platform: process.platform,
    startedAt: deps.startedAt,
    requestId: requestId(request),
  }));

  app.get('/api/bootstrap', async (request) => {
    const settings = engine.publicSettings();
    const projects = engine.projects.list();
    const tasks = engine.tasks.list({ limit: 100 });
    const opencodeStatus = opencodeRef.current?.status();
    const integration = {
      opencode: {
        status: opencodeStatus?.state ?? 'stopped',
        version: opencodeStatus?.version,
        port: opencodeStatus?.port,
      },
      git: remoteService === undefined
        ? {
            provider: settings.git.defaultProvider,
            github: { configured: false, authState: 'not_configured' },
            gitlab: { configured: false, authState: 'not_configured' },
          }
        : remoteService.integrationStatus(),
      database: {
        configured: settings.database.connections.length,
        // Real state: connections whose most recent probe is `connected`. A
        // connection that was never probed reports not_configured (not a fake
        // success); bootstrap stays cheap and never opens a database socket.
        connected: (databaseService?.list() ?? []).filter((connection) => connection.state === DatabaseConnectionState.CONNECTED).length,
      },
    };
    return envelope(
      {
        app: { name: 'Agent Workflow', version: deps.appVersion, nodeVersion: process.version, platform: process.platform, startedAt: deps.startedAt },
        settings,
        themes: THEME_ORDER.map((id) => THEMES[id]),
        catalog: engine.catalog,
        projects,
        tasks,
        inbox: engine.inbox.list(),
        integration,
        counts: {
          activeTasks: tasks.filter((task) => task.lifecycle === 'active').length,
          waitingUser: tasks.filter((task) => task.attention === 'waiting_user').length,
          openPlannings: tasks.filter((task) => task.planning !== undefined && task.planning.status === 'running').length,
        },
        data: { dataDir: paths.dataDir, dbPath: paths.dbPath, jsonlPath: paths.jsonlDir },
      },
      requestId(request),
    );
  });

  // Projects
  app.get<{ Querystring: { includeArchived?: string } }>('/api/projects', async (request) => envelope({ items: engine.projects.list(request.query.includeArchived === '1') }, requestId(request)));
  app.post('/api/projects', async (request, reply) => {
    const body = request.body as CreateProjectRequest;
    const result = await engine.projects.register(body);
    reply.status(201);
    return envelope(result, requestId(request));
  });
  app.get<{ Params: { id: string } }>('/api/projects/:id', async (request) => envelope(engine.projects.detail(request.params.id), requestId(request)));
  app.post<{ Params: { id: string } }>('/api/projects/:id/recheck', async (request) => {
    const body = request.body as { requestKey?: string };
    if (typeof body.requestKey !== 'string' || body.requestKey.length < 8) throw new AppError(ErrorCode.VALIDATION_FAILED, '缺少 requestKey');
    return envelope(await engine.projects.recheck(request.params.id, { requestKey: body.requestKey }), requestId(request));
  });
  app.patch<{ Params: { id: string } }>('/api/projects/:id', async (request) => {
    const body = request.body as UpdateProjectRequest;
    return envelope(engine.projects.update(request.params.id, body), requestId(request));
  });

  // Tasks
  app.get('/api/tasks', async (request) => {
    const query = request.query as ListTasksQuery;
    return envelope({ items: engine.tasks.list(query) }, requestId(request));
  });
  app.post('/api/tasks', async (request, reply) => {
    const body = request.body as CreateTaskRequest;
    const result = engine.tasks.create(body);
    reply.status(201);
    return envelope(result, requestId(request));
  });
  app.get<{ Params: { id: string } }>('/api/tasks/:id', async (request) => envelope(engine.tasks.detail(request.params.id), requestId(request)));
  app.get<{ Params: { id: string } }>('/api/tasks/:id/detail', async (request) => envelope(engine.tasks.detail(request.params.id), requestId(request)));
  app.patch<{ Params: { id: string } }>('/api/tasks/:id', async (request) => {
    const body = request.body as UpdateDraftRequest;
    return envelope(engine.tasks.updateDraft(request.params.id, body), requestId(request));
  });
  app.get<{ Params: { id: string } }>('/api/tasks/:id/requirement', async (request) => {
    const detail = engine.tasks.detail(request.params.id);
    return envelope(
      {
        taskId: request.params.id,
        requirement: detail.task.requirement,
        method: engine.catalog.methods.find((method) => method.id === detail.task.methodId) ?? null,
        capabilities: detail.capabilities,
      },
      requestId(request),
    );
  });

  // Planning
  app.get<{ Params: { id: string } }>('/api/tasks/:id/planning', async (request) => envelope(engine.planning.planningResponse(request.params.id), requestId(request)));
  app.post<{ Params: { id: string } }>('/api/tasks/:id/planning/preview', async (request) => {
    const body = (request.body ?? {}) as PlanningPreviewRequest;
    const preview = engine.planning.preview(request.params.id, body);
    return envelope({ preview, taskId: request.params.id, blockers: preview.blockers }, requestId(request));
  });
  app.post<{ Params: { id: string } }>('/api/tasks/:id/planning/start', async (request) => {
    const body = request.body as PlanningStartRequest;
    return envelope(engine.planning.start(request.params.id, body), requestId(request));
  });
  app.post<{ Params: { id: string } }>('/api/tasks/:id/planning/stop', async (request) => {
    const body = request.body as PlanningStopRequest;
    return envelope(engine.planning.stop(request.params.id, body), requestId(request));
  });
  app.post<{ Params: { id: string } }>('/api/tasks/:id/planning/reconcile', async (request) => {
    const body = request.body as { roundId: string };
    return envelope({ round: await engine.planning.reconcile(request.params.id, body.roundId) }, requestId(request));
  });
  app.post<{ Params: { id: string } }>('/api/tasks/:id/planning/apply', async (request) => {
    const body = request.body as PlanningApplyRequest;
    return envelope(engine.planning.apply(request.params.id, body), requestId(request));
  });
  app.post<{ Params: { id: string } }>('/api/tasks/:id/planning/reject', async (request) => {
    const body = request.body as PlanningRejectRequest;
    return envelope(engine.planning.reject(request.params.id, body), requestId(request));
  });
  app.post<{ Params: { id: string } }>('/api/tasks/:id/planning/answers', async (request) => {
    const body = request.body as SaveAnswerRequest;
    return envelope(engine.planning.saveAnswer(request.params.id, body), requestId(request));
  });
  app.get<{ Params: { id: string }; Querystring: { roundId?: string; afterSeq?: string; limit?: string } }>('/api/tasks/:id/planning/record', async (request) => {
    const query = request.query;
    return envelope(engine.planning.record(request.params.id, query.roundId, Number(query.afterSeq ?? 0), Number(query.limit ?? 500)), requestId(request));
  });

  // Plan
  app.get<{ Params: { id: string } }>('/api/tasks/:id/plan', async (request) => envelope(engine.plans.view(request.params.id), requestId(request)));
  app.post<{ Params: { id: string } }>('/api/tasks/:id/plan/from-template', async (request) => envelope(engine.plans.useTemplate(request.params.id, request.body as UseTemplateRequest), requestId(request)));
  app.post<{ Params: { id: string } }>('/api/tasks/:id/plan/skeleton', async (request) => envelope(engine.plans.useSkeleton(request.params.id, request.body as UseSkeletonRequest), requestId(request)));
  app.post<{ Params: { id: string } }>('/api/tasks/:id/plan/confirm', async (request) => envelope(engine.plans.confirm(request.params.id, request.body as ConfirmPlanRequest), requestId(request)));
  app.post<{ Params: { id: string } }>('/api/tasks/:id/plan/edit/begin', async (request) => envelope(engine.plans.editBegin(request.params.id, request.body as EditBeginRequest), requestId(request)));
  app.post<{ Params: { id: string } }>('/api/tasks/:id/plan/edit/save', async (request) => envelope(engine.plans.editSave(request.params.id, request.body as EditSaveRequest), requestId(request)));
  app.post<{ Params: { id: string } }>('/api/tasks/:id/plan/edit/finish', async (request) => {
    const result = engine.plans.editFinish(request.params.id, request.body as EditFinishRequest);
    // "继续执行" returns the execution to running; nudge the scheduler so the
    // next eligible steps are actually claimed (same semantics as resume).
    if ((request.body as EditFinishRequest).continueExecution === true) engine.executions.kick(request.params.id);
    return envelope(result, requestId(request));
  });
  app.post<{ Params: { id: string } }>('/api/tasks/:id/plan/edit/abandon', async (request) => {
    const result = engine.plans.abandonEdit(request.params.id, request.body as PlanEditAbandonRequest);
    // The execution is back to running with its pre-edit auto-advance setting;
    // release the next batch when auto-advance is on (off = wait for advance).
    engine.executions.kick(request.params.id);
    return envelope(result, requestId(request));
  });
  app.get<{ Params: { id: string; nodeId: string } }>('/api/tasks/:id/plan/nodes/:nodeId', async (request) => envelope(engine.plans.nodeDetail(request.params.id, request.params.nodeId), requestId(request)));
  app.get<{ Params: { id: string; revisionId: string } }>('/api/tasks/:id/plan/revisions/:revisionId', async (request) => {
    const plan = store.plans.get(request.params.revisionId);
    if (plan === undefined || plan.taskId !== request.params.id) throw new AppError(ErrorCode.NOT_FOUND, '计划修订不存在');
    return envelope({ plan }, requestId(request));
  });

  // Workspace
  app.get<{ Params: { id: string } }>('/api/tasks/:id/workspace', async (request) => {
    const workspace = engine.workspaces.get(request.params.id);
    return envelope({ taskId: request.params.id, workspace, actions: viewActions(request.params.id) }, requestId(request));
  });
  app.post<{ Params: { id: string } }>('/api/tasks/:id/workspace/prepare', async (request) => envelope(await engine.workspaces.prepare(request.params.id, request.body as PrepareWorkspaceRequest), requestId(request)));
  app.get<{ Params: { id: string } }>('/api/tasks/:id/changes', async (request) => envelope({ changes: await engine.workspaces.changes(request.params.id) }, requestId(request)));
  app.get<{ Params: { id: string; fileId: string } }>('/api/tasks/:id/changes/files/:fileId/diff', async (request) => envelope({ diff: await engine.workspaces.diff(request.params.id, request.params.fileId) }, requestId(request)));
  app.post<{ Params: { id: string } }>('/api/tasks/:id/workspace/cleanup/preview', async (request) => envelope({ preview: engine.workspaces.cleanupPreview(request.params.id) }, requestId(request)));
  app.post<{ Params: { id: string } }>('/api/tasks/:id/workspace/cleanup/confirm', async (request) => {
    const body = request.body as { requestKey: string; previewRef: string; workspaceRevision: string; confirmCleanup: true };
    return envelope(await engine.workspaces.cleanupConfirm(request.params.id, body), requestId(request));
  });

  // Execution
  app.get<{ Params: { id: string } }>('/api/tasks/:id/execution', async (request) => {
    const execution = engine.executions.get(request.params.id);
    const workspace = engine.workspaces.get(request.params.id);
    return envelope({ execution, workspace, actions: viewActions(request.params.id) }, requestId(request));
  });
  app.post<{ Params: { id: string } }>('/api/tasks/:id/execution/start', async (request) => envelope(engine.executions.start(request.params.id, request.body as ExecutionCommandRequest), requestId(request)));
  app.post<{ Params: { id: string } }>('/api/tasks/:id/execution/pause', async (request) => envelope(engine.executions.pause(request.params.id, request.body as ExecutionCommandRequest), requestId(request)));
  app.post<{ Params: { id: string } }>('/api/tasks/:id/execution/resume', async (request) => envelope(engine.executions.resume(request.params.id, request.body as ExecutionCommandRequest), requestId(request)));
  app.post<{ Params: { id: string } }>('/api/tasks/:id/execution/retry', async (request) => envelope(engine.executions.retry(request.params.id, request.body as ExecutionCommandRequest), requestId(request)));
  app.post<{ Params: { id: string } }>('/api/tasks/:id/execution/auto-advance', async (request) =>
    envelope(engine.executions.setAutoAdvance(request.params.id, request.body as ExecutionAutoAdvanceRequest), requestId(request)));
  app.post<{ Params: { id: string } }>('/api/tasks/:id/execution/advance', async (request) =>
    envelope(engine.executions.advance(request.params.id, request.body as ExecutionAdvanceRequest), requestId(request)));
  app.post<{ Params: { id: string; nodeId: string } }>('/api/tasks/:id/execution/nodes/:nodeId/skip', async (request) => {
    const body = request.body as NodeSkipRequest;
    return envelope(engine.executions.skipNode(request.params.id, request.params.nodeId, body), requestId(request));
  });
  app.post<{ Params: { id: string } }>('/api/tasks/:id/execution/cancel', async (request) => envelope(await engine.executions.cancel(request.params.id, request.body as ExecutionCommandRequest), requestId(request)));
  app.get<{ Params: { id: string; nodeId: string } }>('/api/tasks/:id/nodes/:nodeId', async (request) => envelope(engine.plans.nodeDetail(request.params.id, request.params.nodeId), requestId(request)));
  app.get<{ Params: { id: string; nodeId: string } }>('/api/tasks/:id/nodes/:nodeId/attempts', async (request) => {
    const execution = engine.executions.get(request.params.id);
    if (execution === undefined) return envelope({ taskId: request.params.id, nodeId: request.params.nodeId, attempts: [] }, requestId(request));
    const attempts = store.executions.listAttempts(execution.id, request.params.nodeId).map((attempt) => ({
      attemptId: attempt.id,
      ordinal: attempt.ordinal,
      status: attempt.status,
      isCurrent: execution.nodes.find((node) => node.nodeId === request.params.nodeId)?.currentAttemptId === attempt.id,
      startedAt: attempt.startedAt,
      endedAt: attempt.endedAt,
      reasonSummary: attempt.result?.summary,
    }));
    return envelope({ taskId: request.params.id, nodeId: request.params.nodeId, attempts }, requestId(request));
  });
  app.get<{ Params: { id: string; nodeId: string }; Querystring: { attemptId?: string; afterSeq?: string } }>('/api/tasks/:id/nodes/:nodeId/output', async (request) => {
    const execution = engine.executions.get(request.params.id);
    const node = execution?.nodes.find((item) => item.nodeId === request.params.nodeId);
    const attemptId = request.query.attemptId ?? node?.currentAttemptId;
    const fragments = attemptId === undefined ? [] : store.executions.listOutput(attemptId, Number(request.query.afterSeq ?? 0));
    // Terminal is the real node/attempt end state, not a constant: a running
    // attempt keeps streaming, a settled one never appends again.
    const attempt = attemptId === undefined ? undefined : store.executions.getAttempt(attemptId);
    const terminal = isTerminalOutputStatus(attempt?.status ?? node?.status);
    return envelope({ taskId: request.params.id, nodeId: request.params.nodeId, attemptId, fragments, terminal }, requestId(request));
  });

  // Delivery
  app.get<{ Params: { id: string } }>('/api/tasks/:id/delivery', async (request) => {
    const delivery = engine.deliveries.get(request.params.id);
    return envelope({ delivery, actions: viewActions(request.params.id) }, requestId(request));
  });
  app.post<{ Params: { id: string } }>('/api/tasks/:id/delivery/select', async (request) => envelope(await engine.deliveries.select(request.params.id, request.body as DeliverySelectRequest), requestId(request)));
  app.post<{ Params: { id: string } }>('/api/tasks/:id/delivery/commit', async (request) => envelope(await engine.deliveries.commit(request.params.id, request.body as DeliveryCommitRequest), requestId(request)));
  app.post<{ Params: { id: string } }>('/api/tasks/:id/delivery/push', async (request) => envelope(await engine.deliveries.push(request.params.id, request.body as DeliveryPushRequest), requestId(request)));
  app.post<{ Params: { id: string } }>('/api/tasks/:id/delivery/merge-request', async (request) => envelope(await engine.deliveries.createMergeRequest(request.params.id, request.body as { requestKey: string; sourceRef: string; pushedSha: string; targetBranch: string; expectedTargetTip: string; title: string; description: string; confirmMergeRequest: true }), requestId(request)));
  app.post<{ Params: { id: string } }>('/api/tasks/:id/delivery/merge', async (request) => envelope(await engine.deliveries.merge(request.params.id, request.body as DeliveryMergeRequest), requestId(request)));

  // Git read models (local Git CLI; remote providers are wired separately)
  app.get('/api/git/repos', async (request) => {
    const repos = [];
    for (const project of engine.projects.list()) {
      repos.push(await buildGitRepoView(engine, project.id, remoteService, store));
    }
    return envelope(
      {
        connection: remoteService === undefined
          ? { provider: engine.publicSettings().git.defaultProvider, state: 'not_configured', message: 'GitHub/GitLab 令牌尚未配置；本地 Git 读取可用' }
          : { ...(await remoteService.connection()), message: (await remoteService.connection()).message ?? '本地 Git 读取可用' },
        repos,
        capability: { allowed: true },
      },
      requestId(request),
    );
  });

  app.get<{ Params: { projectId: string } }>('/api/git/repos/:projectId', async (request) => {
    const repo = await buildGitRepoView(engine, request.params.projectId, remoteService, store);
    return envelope({ repo, projectId: request.params.projectId }, requestId(request));
  });

  app.get<{ Params: { projectId: string }; Querystring: { ref?: string; limit?: string; cursor?: string; author?: string; q?: string } }>('/api/git/repos/:projectId/commits', async (request) => {
    const project = requireProject(engine, request.params.projectId);
    const result = await engine.ports.git.listCommits({
      rootPath: project.rootPath,
      ref: request.query.ref,
      limit: Number(request.query.limit ?? 50),
      cursor: request.query.cursor,
      author: request.query.author,
      query: request.query.q,
    });
    const status = await engine.ports.git.status(project.rootPath).catch(() => undefined);
    const reviews = store.reviews.listByProject(request.params.projectId);
    const commits = result.commits.map((commit) => {
      const latest = reviews.find((review) => review.subject.commitSha === commit.sha);
      return latest === undefined
        ? commit
        : {
            ...commit,
            review: {
              reviewRunId: latest.reviewRunId,
              state: latest.state,
              openCount: latest.findings.filter((finding) => finding.status === 'open').length,
            },
          };
    });
    return envelope(
      { commits, nextCursor: result.nextCursor, resolvedTipSha: status?.head.sha, shallowBoundaryReached: status?.shallow !== undefined },
      requestId(request),
    );
  });

  app.get<{ Params: { projectId: string; sha: string } }>('/api/git/repos/:projectId/commits/:sha', async (request) => {
    const project = requireProject(engine, request.params.projectId);
    const commit = await engine.ports.git.commitShow(project.rootPath, request.params.sha);
    if (commit === undefined) throw new AppError(ErrorCode.REVISION_NOT_FOUND, '提交不存在');
    return envelope({ commit }, requestId(request));
  });

  app.get<{ Params: { projectId: string; sha: string } }>('/api/git/repos/:projectId/commits/:sha/reviews', async (request) => {
    const reviews = store.reviews.listByCommit(request.params.projectId, request.params.sha).map((review) => ({
      reviewRunId: review.reviewRunId,
      ordinal: review.ordinal,
      state: review.state,
      startedAt: review.startedAt,
      endedAt: review.endedAt,
      findings: review.findings.length,
    }));
    return envelope({ reviews }, requestId(request));
  });
  app.get<{ Params: { projectId: string; baseId: string; targetId: string } }>('/api/git/repos/:projectId/reviews/:baseId/compare/:targetId', async (request) => {
    const base = store.reviews.get(request.params.baseId);
    const target = store.reviews.get(request.params.targetId);
    if (base === undefined || target === undefined || base.projectId !== request.params.projectId || target.projectId !== request.params.projectId) {
      throw new AppError(ErrorCode.NOT_FOUND, '审查记录不存在');
    }
    const summarize = (review: typeof base) => review.findings.map((finding) => ({
      severity: finding.severity,
      dimension: finding.dimension,
      title: finding.title,
      ...(finding.location === undefined ? {} : { path: finding.location.path, line: finding.location.startLine }),
    }));
    const key = (finding: { dimension: string; title: string; path?: string; line?: number }) => `${finding.dimension}|${finding.path ?? ''}|${String(finding.line ?? '')}|${finding.title}`;
    const baseFindings = summarize(base);
    const targetFindings = summarize(target);
    const baseKeys = new Map(baseFindings.map((finding) => [key(finding), finding]));
    const targetKeys = new Map(targetFindings.map((finding) => [key(finding), finding]));
    return envelope({
      base: { reviewRunId: base.reviewRunId, commitSha: base.subject.commitSha },
      target: { reviewRunId: target.reviewRunId, commitSha: target.subject.commitSha },
      resolved: baseFindings.filter((finding) => !targetKeys.has(key(finding))),
      introduced: targetFindings.filter((finding) => !baseKeys.has(key(finding))),
      persisting: targetFindings.filter((finding) => baseKeys.has(key(finding))),
    }, requestId(request));
  });
  app.get<{ Params: { projectId: string; sha: string }; Querystring: { compareId?: string } }>('/api/git/repos/:projectId/commits/:sha/files', async (request) => {
    const project = requireProject(engine, request.params.projectId);
    const commit = await engine.ports.git.commitShow(project.rootPath, request.params.sha);
    if (commit === undefined) throw new AppError(ErrorCode.REVISION_NOT_FOUND, '提交不存在');
    const baseSha = resolveCompareBase(commit, request.query.compareId);
    const files = await engine.ports.git.diffFiles({ repoRoot: project.rootPath, baseSha, headSha: request.params.sha });
    const knownFiles = new Set(files.map((file) => file.fileId));
    const badges = new Map<string, number>();
    for (const review of store.reviews.listByCommit(request.params.projectId, request.params.sha)) {
      for (const finding of review.findings) {
        if (finding.location === undefined) continue;
        const fileId = fileIdFor(finding.location.path);
        if (!knownFiles.has(fileId)) continue;
        badges.set(fileId, (badges.get(fileId) ?? 0) + 1);
      }
    }
    return envelope(
      { files, truncated: false, reviewBadges: [...badges.entries()].map(([fileId, findingCount]) => ({ fileId, findingCount })) },
      requestId(request),
    );
  });

  app.get<{ Params: { projectId: string }; Querystring: { path?: string; baseSha?: string; headSha?: string; ignoreWhitespace?: string } }>('/api/git/repos/:projectId/diff', async (request) => {
    const project = requireProject(engine, request.params.projectId);
    if (request.query.path === undefined || request.query.baseSha === undefined) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, '缺少 path/baseSha');
    }
    const diff = await engine.ports.git.diffPage({
      repoRoot: project.rootPath,
      baseSha: request.query.baseSha,
      headSha: request.query.headSha,
      path: request.query.path,
      ignoreWhitespace: request.query.ignoreWhitespace === '1' || request.query.ignoreWhitespace === 'true',
    });
    return envelope({ diff }, requestId(request));
  });

  app.get<{ Params: { projectId: string } }>('/api/git/repos/:projectId/branches', async (request) => {
    const project = requireProject(engine, request.params.projectId);
    const branches = await engine.ports.git.branches(project.rootPath);
    return envelope({ branches }, requestId(request));
  });

  app.get<{ Params: { projectId: string }; Querystring: { state?: 'opened' | 'merged' | 'closed' | 'all' } }>('/api/git/repos/:projectId/merge-requests', async (request) => {
    requireProject(engine, request.params.projectId);
    if (remoteService === undefined) return envelope({ mergeRequests: [], nextCursor: undefined }, requestId(request));
    const mergeRequests = await remoteService.listMergeRequests(request.params.projectId, request.query.state ?? 'opened');
    return envelope({ mergeRequests, nextCursor: undefined }, requestId(request));
  });

  app.post<{ Params: { projectId: string } }>('/api/git/repos/:projectId/fetch', async (request) => {
    const body = commandBody<GitFetchRequest>(request);
    const project = requireProject(engine, request.params.projectId);
    if (body.projectId !== undefined && body.projectId !== project.id) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, 'projectId 与请求路径不一致', { details: { path: project.id, body: body.projectId } });
    }
    const fetchImpl = engine.ports.git.fetch;
    if (fetchImpl === undefined) throw new AppError(ErrorCode.GIT_CAPABILITY_UNAVAILABLE, '当前 Git 适配不支持获取远端');
    const remote = typeof body.remote === 'string' && body.remote.trim() !== '' ? body.remote.trim() : 'origin';
    const { record, replayed } = engine.commands.begin({
      requestKey: body.requestKey,
      operation: 'git.fetch',
      body: { projectId: project.id, remote },
      target: { projectId: project.id },
    });
    if (replayed && record.status !== 'accepted') {
      const fetchedAt = typeof record.outcome?.fetchedAt === 'string' ? record.outcome.fetchedAt : undefined;
      return envelope({ receipt: engine.commands.toReceipt(record), resource: { fetchedAt, remote } }, requestId(request));
    }
    try {
      const result = await fetchImpl.call(engine.ports.git, { repoRoot: project.rootPath, remote, prune: true });
      store.events.publish('git.repo.changed', { projectId: project.id });
      engine.commands.settle(body.requestKey, { fetchedAt: result.fetchedAt, remote });
      return envelope(
        { receipt: engine.commands.toReceipt(engine.commands.get(body.requestKey)!), resource: { fetchedAt: result.fetchedAt, remote } },
        requestId(request),
      );
    } catch (error) {
      engine.commands.fail(body.requestKey, error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  });

  // Tasks created from a fixed template (read-only history)
  app.get<{ Params: { id: string } }>('/api/templates/:id', async (request) => {
    const template = engine.catalog.templates.find((item) => item.id === request.params.id);
    if (template === undefined) throw new AppError(ErrorCode.NOT_FOUND, '模板不存在');
    return envelope({ template, taskCount: engine.tasks.listByTemplate(template.id).length }, requestId(request));
  });
  app.get<{ Params: { id: string } }>('/api/templates/:id/tasks', async (request) => {
    return envelope({ tasks: engine.tasks.listByTemplate(request.params.id) }, requestId(request));
  });

  // Role catalog drafts / publishing (global config)
  app.get<{ Querystring: { projectId?: string } }>('/api/knowledge/sources', async (request) => {
    const projectId = request.query.projectId ?? '';
    if (projectId === '') throw new AppError(ErrorCode.VALIDATION_FAILED, '缺少 projectId');
    const project = engine.projects.get(projectId);
    return envelope({ projectId, sources: listKnowledgeSources(project.rootPath) }, requestId(request));
  });
  app.get<{ Querystring: { projectId?: string; q?: string; limit?: string } }>('/api/knowledge/search', async (request) => {
    const projectId = request.query.projectId ?? '';
    if (projectId === '') throw new AppError(ErrorCode.VALIDATION_FAILED, '缺少 projectId');
    const query = (request.query.q ?? '').trim();
    if (query.length < 2) throw new AppError(ErrorCode.VALIDATION_FAILED, '搜索词至少 2 个字符');
    const limit = Math.min(Math.max(Number(request.query.limit ?? 30), 1), 100);
    const project = engine.projects.get(projectId);
    return envelope({ projectId, query, matches: searchKnowledgeSources(project.rootPath, query, limit) }, requestId(request));
  });
  app.get<{ Querystring: { projectId?: string; path?: string } }>('/api/knowledge/source', async (request) => {
    const projectId = request.query.projectId ?? '';
    const path = request.query.path ?? '';
    if (projectId === '' || path === '') throw new AppError(ErrorCode.VALIDATION_FAILED, '缺少 projectId 或 path');
    const project = engine.projects.get(projectId);
    try {
      const source = readKnowledgeSource(project.rootPath, path);
      return envelope({ projectId, ...source }, requestId(request));
    } catch (error) {
      const message = error instanceof Error ? error.message : '读取失败';
      if (message === 'PATH_ESCAPE') throw new AppError(ErrorCode.PATH_ESCAPE, '来源路径越出项目目录');
      if (message === 'SOURCE_NOT_READABLE') throw new AppError(ErrorCode.VALIDATION_FAILED, '来源不是可读文本，或超过 512KB');
      if (message === 'SOURCE_NOT_TEXT') throw new AppError(ErrorCode.VALIDATION_FAILED, '来源包含二进制内容');
      throw new AppError(ErrorCode.INTERNAL_ERROR, '读取来源失败');
    }
  });
  app.get('/api/ppt/works', async (request) => envelope(engine.ppt.list(), requestId(request)));
  app.post('/api/ppt/works', async (request) => {
    const body = request.body as PptWorkCreateRequest;
    return envelope(engine.ppt.create(body), requestId(request));
  });
  app.get<{ Params: { id: string } }>('/api/ppt/works/:id/pptx', async (request, reply) => {
    const buffer = await engine.ppt.exportPptx(request.params.id);
    return reply
      .header('content-type', 'application/vnd.openxmlformats-officedocument.presentationml.presentation')
      .header('content-disposition', `attachment; filename="${encodeURIComponent(request.params.id)}.pptx"`)
      .send(buffer);
  });
  app.get<{ Params: { id: string } }>('/api/ppt/works/:id/export', async (request) => envelope(engine.ppt.exportMarkdown(request.params.id), requestId(request)));
  app.post<{ Params: { id: string } }>('/api/ppt/works/:id/attachments', async (request) => {
    const body = request.body as PptAttachmentRequest;
    return envelope(engine.ppt.attach(request.params.id, body), requestId(request));
  });
  app.delete<{ Params: { id: string; name: string } }>('/api/ppt/works/:id/attachments/:name', async (request) => envelope(engine.ppt.detach(request.params.id, decodeURIComponent(request.params.name)), requestId(request)));
  app.post<{ Params: { id: string } }>('/api/ppt/works/:id/generate-slides', async (request) => {
    const body = request.body as PptWorkGenerateContentRequest;
    return envelope(await engine.ppt.generateSlides(request.params.id, body), requestId(request));
  });
  app.patch<{ Params: { id: string } }>('/api/ppt/works/:id', async (request) => {
    const body = request.body as PptWorkUpdateRequest;
    return envelope(engine.ppt.update(request.params.id, body), requestId(request));
  });
  app.post<{ Params: { id: string } }>('/api/ppt/works/:id/generate', async (request) => {
    const body = request.body as PptWorkGenerateRequest;
    return envelope(await engine.ppt.generate(request.params.id, body), requestId(request));
  });
  app.delete<{ Params: { id: string } }>('/api/ppt/works/:id', async (request) => envelope(engine.ppt.delete(request.params.id), requestId(request)));
  app.post('/api/knowledge/ask', async (request) => {
    const body = request.body as KnowledgeAskRequest;
    return envelope(await engine.knowledge.ask(body), requestId(request));
  });
  app.get<{ Querystring: { projectId?: string } }>('/api/knowledge/history', async (request) => {
    const projectId = request.query.projectId ?? '';
    if (projectId === '') throw new AppError(ErrorCode.VALIDATION_FAILED, '缺少 projectId');
    return envelope(engine.knowledge.history(projectId), requestId(request));
  });
  app.get<{ Params: { id: string } }>('/api/skills/:id/source', async (request) => {
    try {
      return envelope(readSkillSource(request.params.id), requestId(request));
    } catch (error) {
      if (error instanceof Error && error.message === 'SKILL_NOT_FOUND') throw new AppError(ErrorCode.NOT_FOUND, 'Skill 不存在');
      throw new AppError(ErrorCode.CAPABILITY_UNAVAILABLE, 'Skill 源文不可读');
    }
  });
  app.get('/api/skills', async (request) => envelope({ skills: discoverSkills() }, requestId(request)));
  app.get<{ Params: { id: string } }>('/api/tasks/:id/acceptance', async (request) => envelope(engine.acceptances.get(request.params.id), requestId(request)));
  app.post<{ Params: { id: string } }>('/api/tasks/:id/acceptance', async (request) => {
    const body = request.body as TaskAcceptanceRequest;
    return envelope(engine.acceptances.decide(request.params.id, body), requestId(request));
  });
  app.get('/api/insights/task-acceptance', async (request) => envelope({ items: engine.insights.taskAcceptance() }, requestId(request)));
  app.get('/api/insights/task-quality', async (request) => envelope({ items: engine.insights.taskQuality() }, requestId(request)));
  app.get('/api/insights/task-usage', async (request) => envelope({ usage: engine.insights.taskUsage() }, requestId(request)));
  app.get('/api/insights', async (request) => envelope(engine.insights.summary(), requestId(request)));

  app.post('/api/catalog/templates/import', async (request) => {
    const body = request.body as TemplateImportRequest;
    return envelope(engine.templates.import(body), requestId(request));
  });
  app.patch<{ Params: { id: string } }>('/api/catalog/templates/:id', async (request) => {
    const body = request.body as TemplateUpdateRequest;
    return envelope(engine.templates.update(request.params.id, body), requestId(request));
  });
  app.delete<{ Params: { id: string } }>('/api/catalog/templates/:id', async (request) => {
    const body = commandBody<TemplateArchiveRequest>(request);
    if (body.confirmArchive !== true) throw new AppError(ErrorCode.VALIDATION_FAILED, '归档模板需要 confirmArchive=true 确认');
    const existing = engine.templates.list().find((template) => template.id === request.params.id);
    if (existing === undefined) throw new AppError(ErrorCode.NOT_FOUND, '自定义模板不存在');
    // TemplateCatalogService.archive() has no command envelope, so the receipt
    // is registered here at the HTTP boundary (the template file itself is
    // owned by the catalog service and must not be duplicated in the route).
    const { record, replayed } = engine.commands.begin({
      requestKey: body.requestKey,
      operation: 'catalog.template.archive',
      body: { templateId: request.params.id },
      target: { ref: request.params.id },
    });
    if (replayed && record.status !== 'accepted') {
      const templates = engine.templates.list();
      return envelope({ receipt: engine.commands.toReceipt(record), resource: { templates }, templates }, requestId(request));
    }
    try {
      const templates = engine.templates.archive(request.params.id);
      engine.commands.settle(body.requestKey, { templateId: request.params.id, remaining: templates.length });
      return envelope(
        { receipt: engine.commands.toReceipt(engine.commands.get(body.requestKey)!), resource: { templates }, templates },
        requestId(request),
      );
    } catch (error) {
      engine.commands.fail(body.requestKey, error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  });

  app.get('/api/catalog/roles', async (request) => envelope(engine.roleCatalog.list(), requestId(request)));
  app.post<{ Params: { id: string; revision: string } }>('/api/catalog/roles/:id/restore/:revision', async (request) => {
    const body = request.body as RoleRestoreRequest;
    return envelope(engine.roleCatalog.restore(request.params.id, request.params.revision, body), requestId(request));
  });
  app.get<{ Params: { id: string } }>('/api/catalog/roles/:id/history', async (request) => envelope(engine.roleCatalog.history(request.params.id), requestId(request)));
  app.post('/api/catalog/roles', async (request) => {
    const body = request.body as RoleSaveRequest;
    return envelope(await engine.roleCatalog.save(body), requestId(request));
  });
  app.post<{ Params: { id: string } }>('/api/catalog/roles/:id/publish', async (request) => {
    const body = request.body as RolePublishRequest;
    return envelope(engine.roleCatalog.publish(request.params.id, body), requestId(request));
  });
  app.post<{ Params: { id: string } }>('/api/catalog/roles/:id/archive', async (request) => {
    const body = request.body as RoleArchiveRequest;
    return envelope(engine.roleCatalog.archive(request.params.id, body), requestId(request));
  });

  // Task recovery (derived draft only; the parent task is never mutated)
  app.post<{ Params: { id: string } }>('/api/tasks/:id/recovery', async (request) => {
    const body = request.body as RecoveryCreateRequest;
    return envelope(await engine.recoveries.create(request.params.id, body), requestId(request));
  });
  app.get<{ Params: { id: string } }>('/api/tasks/:id/recoveries', async (request) => {
    return envelope(engine.recoveries.list(request.params.id), requestId(request));
  });

  // Operations
  app.get<{ Params: { key: string } }>('/api/operations/:key', async (request) => {
    const operation = engine.commands.get(request.params.key);
    if (operation === undefined) throw new AppError(ErrorCode.NOT_FOUND, '操作记录不存在');
    return envelope({ operation, stillUnknown: operation.status === 'unknown' || operation.status === 'accepted' }, requestId(request));
  });

  // Settings
  app.get('/api/settings', async (request) => {
    const settings = engine.publicSettings();
    return envelope({ settings, issues: validateSettings(settings), catalog: engine.catalog }, requestId(request));
  });
  app.patch('/api/settings', async (request) => {
    const body = request.body as UpdateSettingsRequest;
    if (body.patch === null || typeof body.patch !== 'object' || Array.isArray(body.patch)) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, '缺少 patch');
    }
    const current = engine.publicSettings();
    const merged = mergeSettings(current, body.patch) as AppSettings;
    const issues = validateSettings(merged);
    if (issues.length > 0) throw new AppError(ErrorCode.VALIDATION_FAILED, '设置校验失败', { details: { issues } });
    // 设置保存是全局变更：登记操作并返回回执，失败/重放都能按 requestKey 核对。
    const { record, replayed } = engine.commands.begin({
      requestKey: body.requestKey,
      operation: 'settings.update',
      body: { patch: body.patch, confirmAcrossProjects: body.confirmAcrossProjects === true },
      target: {},
    });
    if (replayed && record.status !== 'accepted') {
      const settingsNow = engine.publicSettings();
      const issuesNow = validateSettings(settingsNow);
      return envelope(
        { receipt: engine.commands.toReceipt(record), resource: { settings: settingsNow, issues: issuesNow, catalog: engine.catalog }, settings: settingsNow, issues: issuesNow, catalog: engine.catalog },
        requestId(request),
      );
    }
    try {
      engine.updateSettings(merged);
      engine.commands.settle(body.requestKey, { applied: true });
      return envelope(
        { receipt: engine.commands.toReceipt(engine.commands.get(body.requestKey)!), resource: { settings: merged, issues, catalog: engine.catalog }, settings: merged, issues, catalog: engine.catalog },
        requestId(request),
      );
    } catch (error) {
      engine.commands.fail(body.requestKey, error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  });

  // Database connections (mysql2; read-only / probe)
  app.get('/api/settings/databases', async (request) => {
    if (databaseService === undefined) throw new AppError(ErrorCode.NOT_CONFIGURED, '数据库模块未接通');
    return envelope({ connections: databaseService.list() }, requestId(request));
  });
  app.post('/api/settings/databases', async (request) => {
    if (databaseService === undefined) throw new AppError(ErrorCode.NOT_CONFIGURED, '数据库模块未接通');
    const body = commandBody<DatabaseConnectionUpsertRequest>(request);
    const input = body.connection;
    if (input === null || typeof input !== 'object') throw new AppError(ErrorCode.VALIDATION_FAILED, '缺少 connection');
    const settings = engine.publicSettings();
    // 连接登记属于设置变更（OPERATIONS 未单列连接 CRUD），用 settings.update 登记回执。
    const { record, replayed } = engine.commands.begin({
      requestKey: body.requestKey,
      operation: 'settings.update',
      body: { connectionName: input.name, type: input.type, host: input.host, port: input.port, database: input.database, user: input.user },
      target: {},
    });
    if (replayed && record.status !== 'accepted') {
      const savedId = typeof record.outcome?.connectionId === 'string' ? record.outcome.connectionId : undefined;
      const connection = savedId === undefined ? undefined : databaseService.list().find((item) => item.id === savedId);
      return envelope(
        { receipt: engine.commands.toReceipt(record), resource: { connection }, ...(connection === undefined ? {} : { connection }) },
        requestId(request),
      );
    }
    const id = input.id ?? `db_${Math.random().toString(36).slice(2, 12)}`;
    const passwordRef = input.password === undefined ? undefined : `db:${id}`;
    const config = {
      id,
      name: input.name,
      type: input.type,
      host: input.host,
      port: input.port,
      database: input.database,
      user: input.user,
      ...(passwordRef === undefined ? {} : { passwordRef }),
      readOnly: input.readOnly ?? true,
      ssl: input.ssl ?? false,
    };
    const duplicate = settings.database.connections.find((item) => item.id !== id && item.host === config.host && item.port === config.port && item.database === config.database);
    if (duplicate !== undefined) {
      const conflict = new AppError(ErrorCode.CONFLICT, '同一主机/端口/数据库已经有连接配置', { details: { connectionId: duplicate.id, name: duplicate.name } });
      engine.commands.fail(body.requestKey, conflict);
      throw conflict;
    }
    try {
      if (input.password !== undefined && passwordRef !== undefined) store.secrets.put(passwordRef, input.password);
      databaseService.registerConnection(config);
      const connections = [...settings.database.connections.filter((item) => item.id !== id), config];
      engine.updateSettings({ ...settings, database: { ...settings.database, connections } });
      engine.commands.settle(body.requestKey, { connectionId: id });
      const connection = databaseService.get(id);
      return envelope(
        { receipt: engine.commands.toReceipt(engine.commands.get(body.requestKey)!), resource: { connection }, connection },
        requestId(request),
      );
    } catch (error) {
      engine.commands.fail(body.requestKey, error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  });
  app.delete<{ Params: { id: string } }>('/api/settings/databases/:id', async (request) => {
    if (databaseService === undefined) throw new AppError(ErrorCode.NOT_CONFIGURED, '数据库模块未接通');
    const settings = engine.publicSettings();
    if (!settings.database.connections.some((connection) => connection.id === request.params.id)) {
      throw new AppError(ErrorCode.NOT_FOUND, '数据库连接不存在');
    }
    // Legacy Web clients call DELETE without a request body; a server key is
    // generated for those so the change still gets an auditable receipt. New
    // callers should send `{ requestKey }` and it is echoed back.
    const body = commandBody<CommandRequest>(request, { generateRequestKey: true });
    const { record, replayed } = engine.commands.begin({
      requestKey: body.requestKey,
      operation: 'settings.update',
      body: { deletedConnectionId: request.params.id },
      target: {},
    });
    if (replayed && record.status !== 'accepted') {
      const connections = databaseService.list();
      return envelope({ receipt: engine.commands.toReceipt(record), resource: { connections }, connections }, requestId(request));
    }
    try {
      const next: AppSettings = {
        ...settings,
        database: {
          ...settings.database,
          connections: settings.database.connections.filter((connection) => connection.id !== request.params.id),
        },
      };
      engine.updateSettings(next);
      await databaseService.applySettings(next.database);
      store.events.publish('task.changed', { taskId: '', projectId: '', stage: 'draft', revision: 1 });
      engine.commands.settle(body.requestKey, { deletedConnectionId: request.params.id });
      const connections = databaseService.list();
      return envelope(
        { receipt: engine.commands.toReceipt(engine.commands.get(body.requestKey)!), resource: { connections }, connections },
        requestId(request),
      );
    } catch (error) {
      engine.commands.fail(body.requestKey, error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  });
  app.post<{ Params: { id: string } }>('/api/settings/databases/:id/probe', async (request) => {
    if (databaseService === undefined) throw new AppError(ErrorCode.NOT_CONFIGURED, '数据库模块未接通');
    return envelope({ probe: await databaseService.tryProbe(request.params.id) }, requestId(request));
  });
  app.post<{ Params: { id: string } }>('/api/settings/databases/:id/query', async (request) => {
    if (databaseService === undefined) throw new AppError(ErrorCode.NOT_CONFIGURED, '数据库模块未接通');
    const body = request.body as { sql?: string; limit?: number };
    if (body.sql === undefined) throw new AppError(ErrorCode.VALIDATION_FAILED, '缺少 sql');
    const result = await databaseService.queryReadOnly(request.params.id, body.sql, body.limit === undefined ? {} : { limit: body.limit });
    return envelope({ result }, requestId(request));
  });

  // Git provider connection (token stays server-side)
  app.get('/api/settings/git', async (request) => {
    if (remoteService === undefined) throw new AppError(ErrorCode.NOT_CONFIGURED, 'Git 远端模块未接通');
    return envelope(
      {
        connection: {
          github: remoteService.connectionState('github'),
          gitlab: remoteService.connectionState('gitlab'),
          defaultProvider: engine.publicSettings().git.defaultProvider,
        },
      },
      requestId(request),
    );
  });
  app.post('/api/settings/gitlab', async (request) => {
    if (remoteService === undefined) throw new AppError(ErrorCode.NOT_CONFIGURED, 'Git 远端模块未接通');
    const body = commandBody<GitLabConnectionRequest>(request);
    if (body.provider !== 'github' && body.provider !== 'gitlab') throw new AppError(ErrorCode.VALIDATION_FAILED, 'provider 必须是 github 或 gitlab');
    // 令牌只在本机凭据库变更；回执里不出现 token（bodyHash 只含 provider 与地址）。
    const { record, replayed } = engine.commands.begin({
      requestKey: body.requestKey,
      operation: 'secret.save',
      body: { provider: body.provider, baseUrl: body.baseUrl, apiBaseUrl: body.apiBaseUrl },
      target: {},
    });
    if (replayed && record.status !== 'accepted') {
      const connection = remoteService.connectionState(body.provider);
      const settings = remoteService.settings();
      return envelope({ receipt: engine.commands.toReceipt(record), resource: { connection, settings }, connection, settings }, requestId(request));
    }
    try {
      const state = await remoteService.saveConnection({ provider: body.provider, baseUrl: body.baseUrl, apiBaseUrl: body.apiBaseUrl, token: body.token });
      engine.updateSettings(remoteService.settings());
      store.events.publish('git.repo.changed', { projectId: '' });
      engine.commands.settle(body.requestKey, { provider: body.provider, state: state.state });
      const settings = remoteService.settings();
      return envelope(
        { receipt: engine.commands.toReceipt(engine.commands.get(body.requestKey)!), resource: { connection: state, settings }, connection: state, settings },
        requestId(request),
      );
    } catch (error) {
      engine.commands.fail(body.requestKey, error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  });
  app.post('/api/settings/gitlab/test', async (request) => {
    if (remoteService === undefined) throw new AppError(ErrorCode.NOT_CONFIGURED, 'Git 远端模块未接通');
    const body = (request.body ?? {}) as { provider?: 'github' | 'gitlab' };
    const provider = body.provider ?? engine.publicSettings().git.defaultProvider;
    // 验证请求只探测账户，不改配置、不登记操作：响应显式标注非变更语义。
    return envelope({ connection: await remoteService.testConnection(provider), mutating: false }, requestId(request));
  });

  // OpenCode
  app.get('/api/opencode/status', async (request) => {
    const opencode = opencodeRef.current;
    const status = opencode?.status() ?? { state: 'stopped' };
    const diagnostics = opencode === undefined ? undefined : await opencode.diagnostics().catch(() => undefined);
    const setting = engine.publicSettings();
    const planner = setting.models.find((model) => model.enabled && model.roles.includes('planner')) ?? setting.models[0];
    const mcpConnected = diagnostics === undefined ? false : Object.values(diagnostics.mcp).some((item) => item.status === 'connected');
    return envelope(
      {
        status: {
          state: status.state,
          managed: opencode !== undefined,
          enabled: setting.opencode.enabled,
          version: status.version,
          binaryPath: setting.opencode.binaryPath,
          host: status.host,
          port: status.port,
          pid: status.pid,
          model: planner === undefined ? '未配置' : `${planner.provider}/${planner.model}`,
          agent: setting.opencode.agent,
          mcp: {
            name: setting.opencode.mcpServerName,
            connected: mcpConnected,
            // Real count for the toolsets this service actually injects; it
            // follows `opencode.toolsets` instead of a fixed 13, and is 0 while
            // the MCP channel is not connected (nothing is usable then).
            tools: mcpConnected ? countEnabledMcpTools(setting.opencode.toolsets) : 0,
          },
          startedAt: status.startedAt,
          lastError: status.lastError,
          gateway: deps.gateway?.stats() ?? { enabled: false, requests: 0, normalized: 0 },
          sessions: diagnostics?.sessions ?? 0,
          totalSessions: diagnostics?.totalSessions ?? 0,
          maxSessions: setting.opencode.maxSessions,
        },
      },
      requestId(request),
    );
  });
  app.get<{ Querystring: { lines?: string } }>('/api/opencode/logs', async (request) => {
    const lines = Number(request.query.lines ?? 100);
    return envelope(readOpenCodeLogTail(paths.dataDir, Number.isFinite(lines) ? lines : 100), requestId(request));
  });
  app.get('/api/opencode/detect', async (request) => {
    return envelope(await detectOpenCodeBinaries(engine.publicSettings().opencode.binaryPath), requestId(request));
  });
  app.post('/api/opencode/restart', async (request) => {
    const body = commandBody<OpenCodeRestartRequest>(request);
    if (body.confirmRestart !== true) throw new AppError(ErrorCode.VALIDATION_FAILED, '重启 OpenCode 需要 confirmRestart=true 确认');
    const opencode = opencodeRef.current;
    if (opencode === undefined) throw new AppError(ErrorCode.NOT_CONFIGURED, 'OpenCode 服务未启用');
    const { record, replayed } = engine.commands.begin({
      requestKey: body.requestKey,
      operation: 'opencode.restart',
      body: { confirmRestart: true },
      target: {},
    });
    if (replayed && record.status !== 'accepted') {
      return envelope({ receipt: engine.commands.toReceipt(record), resource: { status: opencode.status() } }, requestId(request));
    }
    try {
      await opencode.stop();
      await opencode.ensureReady();
      engine.commands.settle(body.requestKey, { state: opencode.status().state });
      return envelope(
        { receipt: engine.commands.toReceipt(engine.commands.get(body.requestKey)!), resource: { status: opencode.status() } },
        requestId(request),
      );
    } catch (error) {
      const appError = error instanceof AppError ? error : new AppError(ErrorCode.OPENCODE_NOT_READY, error instanceof Error ? error.message : '重启 OpenCode 失败');
      engine.commands.fail(body.requestKey, appError);
      throw appError;
    }
  });

  // SSE events
  app.get<{ Querystring: { afterSeq?: string } }>('/api/events', async (request, reply) => {
    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    const write = (event: unknown) => {
      raw.write(`data: ${JSON.stringify(event)}\n\n`);
    };
    write({ type: 'ready', seq: store.events.lastSeq, at: nowIso(), payload: { serverStartedAt: deps.startedAt } });
    const afterSeq = Number(request.query.afterSeq ?? 0);
    for (const event of store.events.replay(afterSeq, 1000)) write(event);
    const unsubscribe = store.events.subscribe((event) => write(event));
    const heartbeat = setInterval(() => raw.write(': heartbeat\n\n'), 15000);
    const close = () => {
      clearInterval(heartbeat);
      unsubscribe();
      raw.end();
    };
    request.raw.on('close', close);
    request.raw.on('error', close);
  });

  // Static Web bundle (production/Electron). In development Vite serves the app.
  const webDist = process.env.AGENT_WORKFLOW_WEB_DIST ?? join(paths.repoRoot, 'apps', 'web', 'dist');
  const indexHtml = join(webDist, 'index.html');
  if (existsSync(indexHtml)) {
    const serveFile = (filePath: string, reply: FastifyReply) => {
      if (!isPathInside(webDist, filePath)) {
        reply.status(403).send({ error: { code: 'FORBIDDEN', message: '非法路径' } });
        return;
      }
      const safe = resolve(filePath);
      const type = MIME[extname(safe)] ?? 'application/octet-stream';
      reply.header('content-type', type).status(200).send(readFileSync(safe));
    };
    app.get('/assets/*', async (request, reply) => {
      const wildcard = (request.params as { '*': string })['*'];
      // Explicit traversal guard in addition to the resolved-root boundary check
      // in serveFile: `/assets/..%2f..%2fpackage.json` must never be served.
      if (wildcard.includes('..')) {
        reply.status(403).send({ error: { code: 'FORBIDDEN', message: '非法路径' } });
        return;
      }
      serveFile(join(webDist, 'assets', wildcard), reply);
    });
    app.get('/*', async (request, reply) => {
      const wildcard = (request.params as { '*': string })['*'];
      // SPA history fallback must never swallow the API namespace: an unknown
      // GET /api/* has to answer the same JSON 404 envelope as an unknown POST
      // (otherwise a missing endpoint looks like a successful HTML page).
      if (wildcard === 'api' || wildcard.startsWith('api/')) {
        reply.status(404).send(apiNotFoundBody('GET', request.url, createId('req')));
        return;
      }
      if (wildcard.includes('..')) {
        reply.status(400).send({ error: { code: 'FORBIDDEN', message: '非法路径' } });
        return;
      }
      const candidate = wildcard === '' ? indexHtml : join(webDist, wildcard);
      if (existsSync(candidate) && statSync(candidate).isFile()) {
        serveFile(candidate, reply);
        return;
      }
      reply.header('content-type', 'text/html; charset=utf-8').status(200).send(readFileSync(indexHtml));
    });
  } else {
    app.get('/', async (_request, reply) => {
      reply.status(200).send({ name: 'agent-workflow', hint: 'Web UI is served by Vite in development or apps/web/dist in production.' });
    });
  }
}

function requireProject(engine: Engine, projectId: string) {
  const project = engine.store.projects.get(projectId);
  if (project === undefined) throw new AppError(ErrorCode.NOT_FOUND, '项目不存在');
  return project;
}

async function buildGitRepoView(engine: Engine, projectId: string, remoteService?: RemoteService, storeOverride?: Store): Promise<Record<string, unknown>> {
  const project = requireProject(engine, projectId);
  const projectReviews = storeOverride?.reviews.listByProject(projectId) ?? [];
  const pendingFindingCount = projectReviews.reduce((count, review) => count + review.findings.filter((finding) => finding.status === 'open').length, 0);
  const detection = await engine.ports.git.detect(project.rootPath).catch(() => ({ gitState: 'path_unavailable' as const, detail: '无法读取项目路径' }));
  let status: Awaited<ReturnType<Engine['ports']['git']['status']>> | undefined;
  let lastCommit;
  if (detection.gitState === 'git') {
    status = await engine.ports.git.status(project.rootPath).catch(() => undefined);
    const log = await engine.ports.git.listCommits({ rootPath: project.rootPath, limit: 1 }).catch(() => ({ commits: [] }));
    lastCommit = log.commits[0];
  }
  return {
    projectId,
    projectName: project.name,
    gitState: detection.gitState,
    displayRoot: project.rootPath,
    defaultBranch: project.defaultBranch ?? ('defaultBranch' in detection ? detection.defaultBranch : undefined),
    remote: detection.gitState === 'git' && project.remoteDisplayUrl !== undefined ? { name: 'origin', displayUrl: project.remoteDisplayUrl } : undefined,
    gitStateDetail: 'detail' in detection ? detection.detail : undefined,
    status,
    summary: { lastCommit, openMrCount: null, pendingFindingCount: pendingFindingCount },
    gitlab: remoteService === undefined ? 'not_configured' : (await remoteService.connection(projectId)).state,
  };
}

const EMPTY_TREE_SHA = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

function resolveCompareBase(commit: { parents: readonly string[] }, compareId: string | undefined): string {
  if (compareId !== undefined && compareId.startsWith('parent:')) {
    const index = Number(compareId.slice('parent:'.length));
    const parent = commit.parents[index];
    if (parent !== undefined) return parent;
  }
  return commit.parents[0] ?? EMPTY_TREE_SHA;
}
