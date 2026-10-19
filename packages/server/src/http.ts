import { isPlanningQuestionAnswered, isPlanningRoundUnknown, hasPendingPlanningQuestions, hasPendingPlanningReview } from '@agent-workflow/shared';
import { normalizeQuestionAnswer, questionChoices } from '@agent-workflow/shared';
import { readableOutput } from '@agent-workflow/engine';
import { registerRuntimeOperationRoutes } from './runtime-operations.ts';
import { registerRoleInsightRoutes } from './role-insights.ts';
import { DATABASE_TYPE_META, databaseScopeIssues, sameDatabaseTarget } from '@agent-workflow/shared';
import { createHash } from 'node:crypto';
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
  DatabaseDraftProbeRequest,
  PlanningPreviewRequest,
  PlanningRefinePreviewRequest,
  CommandRequest,
  CreateProjectRequest,
  CreateTaskRequest,
  ExecutionCommandRequest,
  ListTasksQuery,
  PrepareWorkspaceRequest,
  UpdateDraftRequest,
  ProjectCharterConfirmRequest,
  ProjectCharterGenerateRequest,
  ProjectCharterStopRequest,
  ProjectCharterUpdateRequest,
  UpdateProjectRequest,
  UpdateSettingsRequest,
  UseSkeletonRequest,
  ConfirmPlanRequest,
  EditBeginRequest,
  EditSaveRequest,
  EditFinishRequest,
  PlanEditAbandonRequest,
  TaskPlanFreezeRequest,
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
  TemplateArchiveRequest,
  MethodArchiveRequest,
  MethodCopyRequest,
  MethodCreateRequest,
  MethodSaveRequest,
  MethodValidateRequest,
  MethodCatalogDetail,
  NodeAcceptRequest,
  NodeRejectRequest,
  NodeStatusValue,
  InteractionCapabilitiesView,
  InteractionDetail,
  InteractionListResponse,
  InteractionQuestion,
  InteractionResolveAvailability,
  InteractionResolveRequest,
  InteractionResolveResult,
  InteractionStateValue,
  InteractionSummary,
  PlanningQuestion,
  PlanningRound,
} from '@agent-workflow/shared';
import {
  AppError,
  DatabaseConnectionState,
  ErrorCode,
  InteractionKind,
  InteractionState,
  MCP_TOOL_COUNTS_BY_TOOLSET,
  NODE_TERMINAL_STATUSES,
  NodeStatus,
  PlanningStage,
  TaskLifecycle,
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
import { remoteOutcomeUnknownReason } from '@agent-workflow/engine';
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
  'PATCH /api/projects/:id/charter',
  'POST /api/projects/:id/charter/generate',
  'POST /api/projects/:id/charter/confirm',
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
  'POST /api/tasks/:id/plan/freeze',
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
  'POST /api/tasks/:id/nodes/:nodeId/accept',
  'POST /api/tasks/:id/nodes/:nodeId/reject',
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
  'POST /api/workflows',
  'POST /api/workflows/:id/copy',
  'PATCH /api/workflows/:id',
  'DELETE /api/workflows/:id',
  'POST /api/catalog/roles',
  'POST /api/catalog/roles/:id/publish',
  'POST /api/catalog/roles/package/publish',
  'POST /api/catalog/roles/:id/archive',
  'POST /api/catalog/roles/:id/restore/:revision',
  'POST /api/settings/gitlab',
  'PATCH /api/settings',
  'POST /api/settings/databases',
  'POST /api/knowledge/ask',
  'PATCH /api/knowledge/projects/:id/permissions',
  'POST /api/knowledge/runs/:key/stop',
  'POST /api/interactions/:id/resolve',
  'POST /api/runtime-interactions/:id/resolve',
  'POST /api/opencode/start',
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
  registerRoleInsightRoutes(app, store, engine);
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

  // Project charter (AGENTS.md): read is free, writes carry requestKey receipts.
  app.get<{ Params: { id: string } }>('/api/projects/:id/charter', async (request) => {
    return envelope({ charter: await engine.charters.view(request.params.id) }, requestId(request));
  });
  app.patch<{ Params: { id: string } }>('/api/projects/:id/charter', async (request) => {
    const body = request.body as ProjectCharterUpdateRequest;
    return envelope(await engine.charters.update(request.params.id, body), requestId(request));
  });
  app.post<{ Params: { id: string } }>('/api/projects/:id/charter/generate', async (request) => {
    const body = request.body as ProjectCharterGenerateRequest;
    return envelope(await engine.charters.generate(request.params.id, body), requestId(request));
  });
  app.post<{ Params: { id: string } }>('/api/projects/:id/charter/stop', async (request) => envelope(await engine.charters.stop(request.params.id, request.body as ProjectCharterStopRequest), requestId(request)));
  app.post<{ Params: { id: string } }>('/api/projects/:id/charter/confirm', async (request) => {
    const body = request.body as ProjectCharterConfirmRequest;
    return envelope(await engine.charters.confirm(request.params.id, body), requestId(request));
  });

  app.get<{ Params: { id: string }; Querystring: { path: string } }>('/api/projects/:id/source-path', async (request) => envelope(await engine.projects.sourcePath(request.params.id, request.query.path), requestId(request)));

  // Tasks
  app.get('/api/tasks', async (request) => {
    const query = request.query as ListTasksQuery;
    return envelope({ items: engine.tasks.list(query) }, requestId(request));
  });
  app.post('/api/tasks', async (request, reply) => {
    const body = request.body as CreateTaskRequest;
    const result = await engine.tasks.createForRequest(body);
    reply.status(201);
    return envelope(result, requestId(request));
  });
  app.post<{ Params: { id: string } }>('/api/tasks/:id/archive', async (request) => envelope(engine.tasks.archive(request.params.id, request.body as import('@agent-workflow/shared').TaskArchiveRequest), requestId(request)));
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
  // PE37 S1/S2 read models: the proposal is read-only, refine-preview never
  // dispatches the model (it only returns a previewRef for the scoped start).
  app.get<{ Params: { id: string } }>('/api/tasks/:id/planning/proposal', async (request) => {
    return envelope({ proposal: engine.planning.proposal(request.params.id) }, requestId(request));
  });
  app.post<{ Params: { id: string } }>('/api/tasks/:id/planning/refine-preview', async (request) => {
    const body = (request.body ?? {}) as Partial<PlanningRefinePreviewRequest>;
    const groupRef = typeof body.groupRef === 'string' ? body.groupRef.trim() : '';
    if (groupRef === '') throw new AppError(ErrorCode.VALIDATION_FAILED, '需要 groupRef', { details: { field: 'groupRef' } });
    const preview = engine.planning.refinePreview(request.params.id, groupRef);
    return envelope({ preview, taskId: request.params.id }, requestId(request));
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

  // W3-5b task-canvas extras: freeze is the only mutating entry; everything else
  // is a read model (audit / B-07 snapshot review / run content).
  app.post<{ Params: { id: string } }>('/api/tasks/:id/plan/freeze', async (request) => {
    const body = request.body as TaskPlanFreezeRequest;
    if (body === null || typeof body !== 'object' || body.confirmFreeze !== true) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, '冻结计划需要 confirmFreeze=true 确认');
    }
    const taskId = request.params.id;
    const { record, replayed } = engine.commands.begin({
      requestKey: body.requestKey,
      operation: 'task.plan.freeze',
      body: { taskId, planRevisionId: body.planRevisionId ?? null, note: body.note ?? null },
      target: { taskId },
    });
    if (replayed) {
      const snapshot = engine.extras.listPlanFreezes(taskId).find((item) => item.requestKey === body.requestKey);
      return envelope(
        { receipt: engine.commands.toReceipt(record), ...(snapshot === undefined ? {} : { resource: { freeze: snapshot, replayed: true } }) },
        requestId(request),
      );
    }
    try {
      const result = engine.extras.freezePlan(taskId, {
        requestKey: body.requestKey,
        ...(body.planRevisionId === undefined ? {} : { planRevisionId: body.planRevisionId }),
        ...(body.note === undefined ? {} : { note: body.note }),
      });
      engine.commands.settle(body.requestKey, { snapshotId: result.snapshot.snapshotId, planRevisionId: result.snapshot.planRevisionId, replayed: result.replayed });
      return envelope(
        { receipt: engine.commands.toReceipt(engine.commands.get(body.requestKey)!), resource: { freeze: result.snapshot, replayed: result.replayed } },
        requestId(request),
      );
    } catch (error) {
      engine.commands.fail(body.requestKey, error instanceof Error ? error : new Error('冻结计划失败'));
      throw error;
    }
  });
  app.get<{ Params: { id: string } }>('/api/tasks/:id/plan/freezes', async (request) => {
    const items = engine.extras.listPlanFreezes(request.params.id);
    return envelope({ items, ...(items[0] === undefined ? {} : { latest: items[0] }) }, requestId(request));
  });
  app.get<{ Params: { id: string }; Querystring: { limit?: string; cursor?: string; kinds?: string } }>('/api/tasks/:id/audit', async (request) => {
    const limit = request.query.limit === undefined ? undefined : Number(request.query.limit);
    const kinds = request.query.kinds === undefined ? undefined : request.query.kinds.split(',').map((kind) => kind.trim()).filter((kind) => kind !== '');
    return envelope(
      engine.extras.audit(request.params.id, {
        ...(limit === undefined || Number.isNaN(limit) ? {} : { limit }),
        ...(request.query.cursor === undefined ? {} : { cursor: request.query.cursor }),
        ...(kinds === undefined || kinds.length === 0 ? {} : { kinds }),
      }),
      requestId(request),
    );
  });
  app.get<{ Params: { id: string } }>('/api/tasks/:id/snapshot-review/report', async (request) => envelope(engine.extras.readSnapshotReport(request.params.id), requestId(request)));
  app.get<{ Params: { id: string; reportId: string } }>('/api/tasks/:id/snapshot-review/report/:reportId/download', async (request) => envelope(engine.extras.downloadSnapshotReport(request.params.id, request.params.reportId), requestId(request)));
  app.get<{ Params: { id: string }; Querystring: { limit?: string; cursor?: string } }>('/api/tasks/:id/snapshot-review', async (request) => {
    const limit = request.query.limit === undefined ? undefined : Number(request.query.limit);
    return envelope(
      engine.extras.snapshotReview(request.params.id, {
        ...(limit === undefined || Number.isNaN(limit) ? {} : { limit }),
        ...(request.query.cursor === undefined ? {} : { cursor: request.query.cursor }),
      }),
      requestId(request),
    );
  });
  app.get<{ Params: { id: string }; Querystring: { inputId?: string; version?: string; sha256?: string } }>('/api/tasks/:id/run-content', async (request) => {
    return envelope(request.query.inputId === undefined ? engine.extras.runContent(request.params.id) : engine.extras.runContentInput(request.params.id, request.query.inputId, request.query.version ?? '', request.query.sha256 ?? ''), requestId(request));
  });
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
  app.get<{ Params: { id: string; nodeId: string }; Querystring: { attemptId?: string } }>('/api/tasks/:id/plan/nodes/:nodeId', async (request) => envelope(engine.plans.nodeDetail(request.params.id, request.params.nodeId, request.query.attemptId), requestId(request)));
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
  app.get<{ Params: { id: string; nodeId: string; planId: string; entryId: string }; Querystring: { revision?: string; sha256?: string } }>('/api/tasks/:id/nodes/:nodeId/sources/:planId/:entryId', async (request) => envelope(engine.plans.readSource(request.params.id, request.params.nodeId, request.params.planId, request.params.entryId, Number(request.query.revision), request.query.sha256 ?? ''), requestId(request)));

  app.get<{ Params: { id: string; nodeId: string; attemptId: string; callId: string }; Querystring: { part?: 'input' | 'output' | 'error'; cursor?: string } }>('/api/tasks/:id/nodes/:nodeId/attempts/:attemptId/tools/:callId', async (request) => envelope(engine.executions.readTool(request.params.id, request.params.nodeId, request.params.attemptId, request.params.callId, request.query.part ?? 'output', request.query.cursor), requestId(request)));

  app.get<{ Params: { id: string; attemptId: string; artifactId: string }; Querystring: { revision?: string; sha256?: string; download?: string; cursor?: string } }>('/api/tasks/:id/attempts/:attemptId/artifacts/:artifactId', async (request, reply) => {
    const { artifact, bytes } = engine.executions.readArtifact(request.params.id, request.params.attemptId, request.params.artifactId, request.query.revision ?? '', request.query.sha256 ?? '');
    reply.header('Cache-Control', 'no-store').header('X-Content-Type-Options', 'nosniff');
    if (request.query.download === '1') return reply.type('application/octet-stream').header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(artifact.name)}`).send(bytes);
    const text = artifact.mediaType.startsWith('text/') || artifact.mediaType === 'application/json';
    const offset = Number(request.query.cursor ?? 0);
    if (!Number.isSafeInteger(offset) || offset < 0) throw new AppError(ErrorCode.VALIDATION_FAILED, '读取位置无效');
    const content = text ? bytes.toString('utf8') : null;
    const end = Math.min(offset + 65536, content?.length ?? 0);
    return envelope({ artifact, preview: content === null ? null : content.slice(offset, end), truncated: content !== null && end < content.length, ...(content !== null && end < content.length ? { nextCursor: String(end) } : {}) }, requestId(request));
  });

  app.get<{ Params: { id: string; nodeId: string }; Querystring: { attemptId?: string } }>('/api/tasks/:id/nodes/:nodeId', async (request) => envelope(engine.plans.nodeDetail(request.params.id, request.params.nodeId, request.query.attemptId), requestId(request)));
  app.post<{ Params: { id: string; nodeId: string } }>('/api/tasks/:id/nodes/:nodeId/accept', async (request) =>
    envelope(engine.plans.acceptNode(request.params.id, request.params.nodeId, request.body as NodeAcceptRequest), requestId(request)));
  app.post<{ Params: { id: string; nodeId: string } }>('/api/tasks/:id/nodes/:nodeId/reject', async (request) =>
    envelope(engine.plans.rejectNode(request.params.id, request.params.nodeId, request.body as NodeRejectRequest), requestId(request)));
  app.get<{ Params: { id: string; nodeId: string } }>('/api/tasks/:id/nodes/:nodeId/attempts', async (request) => {
    const task = store.tasks.get(request.params.id);
    if (task === undefined) throw new AppError(ErrorCode.NOT_FOUND, '任务不存在');
    const plan = task.currentPlanRevisionId === undefined ? store.plans.latest(task.id) : store.plans.get(task.currentPlanRevisionId);
    const execution = engine.executions.get(request.params.id);
    if (execution === undefined && !plan?.graph.nodes.some((node) => node.id === request.params.nodeId)) throw new AppError(ErrorCode.NOT_FOUND, '步骤不存在');
    if (execution === undefined) return envelope({ taskId: request.params.id, nodeId: request.params.nodeId, attempts: [] }, requestId(request));
    if (!execution.nodes.some((node) => node.nodeId === request.params.nodeId)) throw new AppError(ErrorCode.NOT_FOUND, '步骤不存在');
    const attempts = store.executions.listAttempts(execution.id, request.params.nodeId).map((attempt) => ({
      attemptId: attempt.id,
      ordinal: attempt.ordinal,
      status: attempt.status,
      isCurrent: execution.nodes.find((node) => node.nodeId === request.params.nodeId)?.currentAttemptId === attempt.id,
      startedAt: attempt.startedAt,
      endedAt: attempt.endedAt,
      reasonSummary: attempt.readability.result === 'forbidden' ? undefined : attempt.result?.summary,
    }));
    return envelope({ taskId: request.params.id, nodeId: request.params.nodeId, attempts }, requestId(request));
  });
  app.get<{ Params: { id: string; nodeId: string }; Querystring: { attemptId?: string; afterSeq?: string } }>('/api/tasks/:id/nodes/:nodeId/output', async (request) => {
    const execution = engine.executions.get(request.params.id);
    const node = execution?.nodes.find((item) => item.nodeId === request.params.nodeId);
    const attemptId = request.query.attemptId ?? node?.currentAttemptId;
    const attempt = attemptId === undefined ? undefined : store.executions.getAttempt(attemptId);
    if (execution === undefined || node === undefined || (attemptId !== undefined && (attempt === undefined || attempt.executionId !== execution.id || attempt.nodeId !== node.nodeId))) throw new AppError(ErrorCode.NOT_FOUND, '该任务节点没有对应的执行尝试');
    if (attempt?.readability.output === 'forbidden') throw new AppError(ErrorCode.FORBIDDEN, '你没有查看这次尝试记录的权限');
    const afterSeq = Number(request.query.afterSeq ?? 0);
    if (!Number.isSafeInteger(afterSeq) || afterSeq < 0) throw new AppError(ErrorCode.VALIDATION_FAILED, '片段游标不合法');
    const page = attemptId === undefined ? [] : store.executions.listOutput(attemptId, afterSeq, 501);
    const fragments = attempt === undefined ? [] : readableOutput(attempt, page.slice(0, 500));
    const terminal = isTerminalOutputStatus(attempt?.status ?? node.status);
    return envelope({ taskId: request.params.id, nodeId: request.params.nodeId, attemptId, fragments, terminal, nextSeq: fragments.at(-1)?.seq ?? afterSeq, hasMore: page.length > 500 }, requestId(request));
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
    if (body.projectId !== undefined && body.projectId !== request.params.projectId) {
        throw new AppError(ErrorCode.VALIDATION_FAILED, 'projectId 与请求路径不一致', { details: { path: request.params.projectId, body: body.projectId } });
      }
    const remote = typeof body.remote === 'string' && body.remote.trim() !== '' ? body.remote.trim() : 'origin';
    const { record, replayed } = engine.commands.begin({
      requestKey: body.requestKey,
      operation: 'git.fetch',
      body: { projectId: request.params.projectId, remote },
      target: { projectId: request.params.projectId },
    });
    if (replayed) {
      const fetchedAt = typeof record.outcome?.fetchedAt === 'string' ? record.outcome.fetchedAt : undefined;
      return envelope({ receipt: engine.commands.toReceipt(record), resource: { fetchedAt, remote } }, requestId(request));
    }
    try {
      const project = requireProject(engine, request.params.projectId);

      const fetchImpl = engine.ports.git.fetch;
      if (fetchImpl === undefined) throw new AppError(ErrorCode.GIT_CAPABILITY_UNAVAILABLE, '当前 Git 适配不支持获取远端');
      const result = await fetchImpl.call(engine.ports.git, { repoRoot: project.rootPath, remote, prune: true });
      store.events.publish('git.repo.changed', { projectId: project.id });
      engine.commands.settle(body.requestKey, { fetchedAt: result.fetchedAt, remote });
      return envelope(
        { receipt: engine.commands.toReceipt(engine.commands.get(body.requestKey)!), resource: { fetchedAt: result.fetchedAt, remote } },
        requestId(request),
      );
    } catch (error) {
      const unknown = remoteOutcomeUnknownReason(error);
      if (unknown !== undefined) {
        const reasonLabel = unknown === 'timeout' ? '请求超时' : unknown === 'network_error' ? '网络连接失败' : '远端响应无法判定';
        const unknownError = new AppError(ErrorCode.RECEIPT_UNKNOWN, `获取远端更新结果未明（${reasonLabel}）；不会自动重发，请按 requestKey 核对后再操作。`, {
          httpStatus: 409,
          details: { requestKey: body.requestKey, operation: 'git.fetch', outcomeUnknown: true, reason: unknown },
        });
        engine.commands.fail(body.requestKey, unknownError, true);
        throw unknownError;
      }
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
  app.get('/api/templates/archive', async (request) => envelope(engine.templates.archiveView(), requestId(request)));
  app.get('/api/templates/archive/export', async (request, reply) => {
    const archive = engine.templates.archiveView();
    return envelope({ format: 'v1', templates: archive.templates, rules: archive.rules.map(({ health, ...rule }) => rule) }, requestId(request));
  });
  app.get<{ Params: { id: string } }>('/api/templates/archive/runs/:id/verify', async (request) => envelope(engine.templates.verifyArchiveRun(request.params.id), requestId(request)));
  app.get<{ Params: { id: string } }>('/api/templates/:id/tasks', async (request) => {
    return envelope({ tasks: engine.tasks.listByTemplate(request.params.id) }, requestId(request));
  });

  // Role catalog drafts / publishing (global config)
  app.get<{ Querystring: { projectId?: string } }>('/api/knowledge/sources', async (request) => {
    const projectId = request.query.projectId ?? '';
    if (projectId === '') throw new AppError(ErrorCode.VALIDATION_FAILED, '缺少 projectId');
    const project = engine.projects.get(projectId);
    return envelope({ projectId, sources: engine.knowledge.inputs.inventory(projectId), permissions: engine.knowledge.inputs.permissions(projectId), askAvailability: engine.knowledge.askAvailability() }, requestId(request));
  });
  app.get<{ Querystring: { projectId?: string; q?: string; limit?: string } }>('/api/knowledge/search', async (request) => {
    const projectId = request.query.projectId ?? '';
    if (projectId === '') throw new AppError(ErrorCode.VALIDATION_FAILED, '缺少 projectId');
    engine.knowledge.inputs.requireOriginal(projectId);
    const query = (request.query.q ?? '').trim();
    if (query.length < 2) throw new AppError(ErrorCode.VALIDATION_FAILED, '搜索词至少 2 个字符');
    const limit = Math.min(Math.max(Number(request.query.limit ?? 30), 1), 100);
    const project = engine.projects.get(projectId);
    return envelope({ projectId, query, matches: searchKnowledgeSources(project.rootPath, query, limit) }, requestId(request));
  });
  app.get<{ Querystring: { projectId?: string; path?: string; requestKey?: string } }>('/api/knowledge/source', async (request) => {
    const projectId = request.query.projectId ?? '';
    const path = request.query.path ?? '';
    if (projectId === '' || path === '') throw new AppError(ErrorCode.VALIDATION_FAILED, '缺少 projectId 或 path');
    const project = engine.projects.get(projectId);
    try {
      const source = await engine.knowledge.readSource(projectId, path, request.query.requestKey);
      return envelope({ projectId, ...source }, requestId(request));
    } catch (error) {
      if (error instanceof AppError) throw error;
      const message = error instanceof Error ? error.message : '读取失败';
      if (message === 'PATH_ESCAPE') throw new AppError(ErrorCode.PATH_ESCAPE, '来源路径越出项目目录');
      if (message === 'SOURCE_NOT_READABLE') throw new AppError(ErrorCode.VALIDATION_FAILED, '来源不是可读文本，或超过 512KB');
      if (message === 'SOURCE_NOT_TEXT') throw new AppError(ErrorCode.VALIDATION_FAILED, '来源包含二进制内容');
      throw new AppError(ErrorCode.INTERNAL_ERROR, '读取来源失败');
    }
  });
  app.get<{Params:{id:string}}>('/api/ppt/works/:id/assistant', async(request)=>envelope(engine.ppt.assistant.view(request.params.id),requestId(request)));
  app.post<{Params:{id:string}}>('/api/ppt/works/:id/assistant', async(request)=>envelope(await engine.ppt.assistant.ask(request.params.id,request.body as import('@agent-workflow/shared').PptAssistantRequest),requestId(request)));
  app.post<{Params:{id:string}}>('/api/ppt/works/:id/assistant/decide', async(request)=>envelope(engine.ppt.assistant.decide(request.params.id,request.body as import('@agent-workflow/shared').PptAssistantDecideRequest),requestId(request)));
  app.post<{ Params: { id: string } }>('/api/ppt/works/:id/stop', async (request) => envelope(await engine.ppt.stop(request.params.id, request.body as import('@agent-workflow/shared').PptWorkStopRequest), requestId(request)));
  app.get<{ Params: { id: string }; Querystring: { page?: string; direction?: string } }>('/api/ppt/works/:id/thumbnail', async (request, reply) => reply.header('content-type', 'image/svg+xml; charset=utf-8').header('cache-control', 'no-store').send(engine.ppt.thumbnail(request.params.id, Number(request.query.page ?? 0), request.query.direction)));
  app.get<{ Params: { id: string } }>('/api/ppt/works/:id/check', async (request) => envelope(engine.ppt.check(request.params.id), requestId(request)));
  const managePpt = (action: 'copy'|'archive'|'restore') => async (request: FastifyRequest<{Params:{id:string}}>) => envelope(engine.ppt.manage(request.params.id, action, request.body as import('@agent-workflow/shared').PptWorkManageRequest), requestId(request));
  app.post('/api/ppt/works/:id/copy', managePpt('copy'));
  app.post('/api/ppt/works/:id/archive', managePpt('archive'));
  app.post('/api/ppt/works/:id/restore', managePpt('restore'));
  app.get<{Params:{id:string};Querystring:{revision:string;includeNotes?:string}}>('/api/ppt/works/:id/document', async (request) => envelope(engine.ppt.document(request.params.id,Number(request.query.revision),request.query.includeNotes===undefined?undefined:request.query.includeNotes==='true'),requestId(request)));
  app.get('/api/ppt/works', async (request) => envelope(engine.ppt.list(), requestId(request)));
  app.post('/api/ppt/works', async (request) => {
    const body = request.body as PptWorkCreateRequest;
    return envelope(engine.ppt.create(body), requestId(request));
  });
  app.get<{ Params: { id: string }; Querystring: {revision?:string;includeNotes?:string} }>('/api/ppt/works/:id/pptx', async (request, reply) => {
    if(request.query.revision!==undefined)engine.ppt.document(request.params.id,Number(request.query.revision));
    const buffer = await engine.ppt.exportPptx(request.params.id,request.query.includeNotes===undefined?undefined:request.query.includeNotes==='true');
    return reply
      .header('x-content-sha256',createHash('sha256').update(buffer).digest('hex'))
      .header('content-type', 'application/vnd.openxmlformats-officedocument.presentationml.presentation')
      .header('content-disposition', `attachment; filename="${encodeURIComponent(engine.ppt.exportFilename(request.params.id))}"`)
      .send(buffer);
  });
  app.get<{ Params: { id: string } }>('/api/ppt/works/:id/export', async (request) => envelope(engine.ppt.exportMarkdown(request.params.id), requestId(request)));
  app.post<{ Params: { id: string } }>('/api/ppt/works/:id/attachments', async (request) => {
    const body = request.body as PptAttachmentRequest;
    return envelope(engine.ppt.attach(request.params.id, body), requestId(request));
  });
  app.delete<{ Params: { id: string; name: string } }>('/api/ppt/works/:id/attachments/:name', async (request) => envelope(engine.ppt.detach(request.params.id, decodeURIComponent(request.params.name), (request.body as { requestKey: string } | undefined)?.requestKey ?? ''), requestId(request)));
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
  app.delete<{ Params: { id: string } }>('/api/ppt/works/:id', async (request) => envelope(engine.ppt.delete(request.params.id, (request.body as { requestKey: string } | undefined)?.requestKey ?? ''), requestId(request)));
  app.get<{ Params: { id: string } }>('/api/knowledge/projects/:id/permissions', async (request) => envelope(engine.knowledge.inputs.permissions(request.params.id), requestId(request)));
  app.patch<{ Params: { id: string } }>('/api/knowledge/projects/:id/permissions', async (request) => envelope(engine.knowledge.inputs.updatePermissions(request.params.id, request.body as import('@agent-workflow/shared').KnowledgePermissionUpdate), requestId(request)));
  app.post('/api/knowledge/ask', async (request) => {
    const body = request.body as KnowledgeAskRequest;
    return envelope(await engine.knowledge.ask(body), requestId(request));
  });
  app.get<{ Params: { key: string }; Querystring: { projectId?: string } }>('/api/knowledge/runs/:key', async (request) => {
    return envelope(engine.knowledge.progress(request.params.key, request.query.projectId ?? ''), requestId(request));
  });
  app.post<{ Params: { key: string } }>('/api/knowledge/runs/:key/stop', async (request) => {
    return envelope(await engine.knowledge.stop(request.params.key, request.body as import('@agent-workflow/shared').KnowledgeStopRequest), requestId(request));
  });
  app.get<{ Params: { requestKey: string }; Querystring: { projectId?: string } }>('/api/knowledge/results/:requestKey', async (request) => {
    const projectId = request.query.projectId ?? '';
    if (projectId === '') throw new AppError(ErrorCode.VALIDATION_FAILED, '缺少 projectId');
    return envelope(engine.knowledge.result(request.params.requestKey, projectId), requestId(request));
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
  app.get('/api/insights/task-usage', async (request) => envelope({ usage: engine.insights.taskUsage(), tasks: engine.tasks.allSummaries() }, requestId(request)));
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
    // TemplateCatalogService.archive() has no command envelope, so the receipt
    // is registered here at the HTTP boundary (the template file itself is
    // owned by the catalog service and must not be duplicated in the route).
    const { record, replayed } = engine.commands.begin({
      requestKey: body.requestKey,
      operation: 'catalog.template.archive',
      body: { templateId: request.params.id },
      target: { ref: request.params.id },
    });
    if (replayed) {
      const templates = engine.templates.list();
      return envelope({ receipt: engine.commands.toReceipt(record), resource: { templates }, templates }, requestId(request));
    }
    try {
      const existing = engine.templates.list().find((template) => template.id === request.params.id);
      if (existing === undefined) throw new AppError(ErrorCode.NOT_FOUND, '自定义模板不存在');
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

  app.post('/api/catalog/roles/package/validate', async (request) => envelope(engine.roleCatalog.validatePackage((request.body as {source:string}).source),requestId(request)));
  app.post('/api/catalog/roles/package/publish', async (request) => envelope(engine.roleCatalog.publishPackage(request.body as import('@agent-workflow/shared').RolePackagePublishRequest),requestId(request)));
  app.get('/api/catalog/roles', async (request) => envelope(engine.roleCatalog.list(), requestId(request)));
  app.post<{ Params: { id: string; revision: string } }>('/api/catalog/roles/:id/restore/:revision', async (request) => {
    const body = request.body as RoleRestoreRequest;
    return envelope(engine.roleCatalog.restore(request.params.id, request.params.revision, body), requestId(request));
  });
  app.get<{ Params: { id: string } }>('/api/catalog/roles/:id/history', async (request) => envelope(engine.roleCatalog.history(request.params.id), requestId(request)));
  // Non-mutating publish checklist (no requestKey / no receipt by design).
  app.post<{ Params: { id: string } }>('/api/catalog/roles/:id/validate', async (request) => envelope(engine.roleCatalog.validate(request.params.id), requestId(request)));
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

  // Workflow (method) catalog: built-ins are read-only, custom methods are
  // versioned and every mutation carries a requestKey receipt.
  app.get<{ Querystring: { includeArchived?: string; source?: string; q?: string } }>('/api/workflows', async (request) => {
    const source = request.query.source === 'builtin' || request.query.source === 'custom' ? request.query.source : 'all';
    return envelope({
      items: engine.methods.list({
        includeArchived: request.query.includeArchived === '1',
        source,
        ...(request.query.q === undefined ? {} : { q: request.query.q }),
      }),
    }, requestId(request));
  });
  app.post('/api/workflows/validate', async (request) => {
    const body = (request.body ?? {}) as Partial<MethodValidateRequest>;
    if (body.draft === null || typeof body.draft !== 'object') throw new AppError(ErrorCode.VALIDATION_FAILED, '缺少 draft');
    return envelope(engine.methods.validate({ draft: body.draft, ...(typeof body.id === 'string' ? { id: body.id } : {}) }), requestId(request));
  });
  app.post<{ Params: { id: string } }>('/api/workflows/:id/instantiate', async (request) => {
    return envelope({ ...engine.methods.instantiate(request.params.id) }, requestId(request));
  });
  app.get<{ Params: { id: string } }>('/api/workflows/:id/versions', async (request) => {
    return envelope({ versions: engine.methods.versions(request.params.id) }, requestId(request));
  });
  app.get<{ Params: { id: string } }>('/api/workflows/:id', async (request) => {
    return envelope({ method: engine.methods.get(request.params.id) }, requestId(request));
  });

  /**
   * Wrap a MethodCatalogService mutation in a command receipt. The service has
   * its own request replay; this keeps `/api/operations/:key` truthful too.
   */
  const workflowMutation = (
    requestKey: string,
    operation: import('@agent-workflow/shared').OperationKindValue,
    body: unknown,
    target: Record<string, string>,
    action: () => { readonly method: MethodCatalogDetail },
  ): ReturnType<typeof envelope> => {
    const { record, replayed } = engine.commands.begin({ requestKey, operation, body, target });
    if (replayed) {
      const methodId = typeof record.outcome?.['methodId'] === 'string' ? record.outcome['methodId'] : undefined;
      return envelope(
        { receipt: engine.commands.toReceipt(record), ...(methodId === undefined ? {} : { resource: { method: engine.methods.get(methodId) } }) },
        requestKey,
      );
    }
    try {
      const result = action();
      engine.commands.settle(requestKey, { methodId: result.method.id, version: result.method.version });
      return envelope({ receipt: engine.commands.toReceipt(engine.commands.get(requestKey)!), resource: { method: engine.methods.get(result.method.id) } }, requestKey);
    } catch (error) {
      engine.commands.fail(requestKey, error instanceof Error ? error : new Error('流程操作失败'));
      throw error;
    }
  };

  app.post('/api/workflows', async (request) => {
    const body = request.body as MethodCreateRequest;
    if (body.draft === null || typeof body.draft !== 'object') throw new AppError(ErrorCode.VALIDATION_FAILED, '缺少 draft');
    return workflowMutation(body.requestKey, 'catalog.method.create', { draft: body.draft }, {}, () => engine.methods.create({ requestKey: body.requestKey, draft: body.draft, confirmCreate: body.confirmCreate }));
  });
  app.post<{ Params: { id: string } }>('/api/workflows/:id/copy', async (request) => {
    const body = request.body as MethodCopyRequest;
    return workflowMutation(body.requestKey, 'catalog.method.copy', { id: request.params.id, name: body.name ?? null }, { ref: request.params.id }, () => engine.methods.copy(request.params.id, { requestKey: body.requestKey, ...(body.name === undefined ? {} : { name: body.name }), confirmCopy: body.confirmCopy }));
  });
  app.patch<{ Params: { id: string } }>('/api/workflows/:id', async (request) => {
    const body = request.body as MethodSaveRequest;
    if (body.method === null || typeof body.method !== 'object') throw new AppError(ErrorCode.VALIDATION_FAILED, '缺少 method');
    return workflowMutation(body.requestKey, 'catalog.method.save', { id: request.params.id, method: body.method, expectedVersion: body.expectedVersion }, { ref: request.params.id }, () => engine.methods.save(request.params.id, { requestKey: body.requestKey, method: body.method, expectedVersion: body.expectedVersion, confirmSave: body.confirmSave }));
  });
  app.delete<{ Params: { id: string } }>('/api/workflows/:id', async (request) => {
    const body = commandBody<MethodArchiveRequest>(request);
    if (body.confirmArchive !== true) throw new AppError(ErrorCode.VALIDATION_FAILED, '归档流程需要 confirmArchive=true 确认');
    return workflowMutation(body.requestKey, 'catalog.method.archive', { id: request.params.id }, { ref: request.params.id }, () => engine.methods.archive(request.params.id, { requestKey: body.requestKey, confirmArchive: true }));
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
    await engine.runtimeInteractions.reconcileOperation(request.params.key);
    engine.tasks.reconcileCreate(request.params.key);
    engine.recoveries.reconcileOperation(request.params.key);
    await engine.executions.reconcileOperation(request.params.key);
    await engine.knowledge.reconcileOperation(request.params.key);
    await engine.charters.reconcileOperation(request.params.key);
    await engine.ppt.reconcileOperation(request.params.key);
    const operation = engine.commands.get(request.params.key);
    if (operation === undefined) throw new AppError(ErrorCode.NOT_FOUND, '操作记录不存在');
    return envelope({ operation, stillUnknown: operation.status === 'unknown' || operation.status === 'accepted' }, requestId(request));
  });

  app.get('/api/runtime-interactions', async (request) => envelope({ items: engine.runtimeInteractions.list().map((item) => engine.runtimeInteractions.view(item)) }, requestId(request)));
  app.get<{ Params: { id: string } }>('/api/runtime-interactions/:id', async (request) => envelope(engine.runtimeInteractions.view(engine.runtimeInteractions.get(request.params.id)), requestId(request)));
  app.post<{ Params: { id: string } }>('/api/runtime-interactions/:id/resolve', async (request) => envelope(await engine.runtimeInteractions.resolve(request.params.id, request.body as import('@agent-workflow/shared').RuntimeInteractionResolveRequest), requestId(request)));

  // Inbox interactions (待处理中心就地处理)
  app.get('/api/interactions', async (request) => envelope(listInboxInteractions(store), requestId(request)));
  app.get<{ Params: { id: string } }>('/api/interactions/:id', async (request) => {
    const parsed = parseInteractionId(request.params.id);
    if (parsed === undefined) throw new AppError(ErrorCode.NOT_FOUND, '互动事项不存在');
    const round = store.planning.get(parsed.roundId);
    if (round === undefined) throw new AppError(ErrorCode.NOT_FOUND, '互动事项不存在');
    return envelope(buildInteractionDetail(store, round, parsed.kind), requestId(request));
  });
  app.post<{ Params: { id: string } }>('/api/interactions/:id/resolve', async (request) => {
    const body = request.body as InteractionResolveRequest;
    const parsed = parseInteractionId(request.params.id);
    if (parsed === undefined) throw new AppError(ErrorCode.NOT_FOUND, '互动事项不存在');
    if (body?.confirmResolve !== true) throw new AppError(ErrorCode.VALIDATION_FAILED, '提交答复需要显式确认');
    const round = store.planning.get(parsed.roundId);
    if (round === undefined) throw new AppError(ErrorCode.NOT_FOUND, '互动事项不存在');
    const task = store.tasks.get(round.taskId);
    if (task === undefined) throw new AppError(ErrorCode.NOT_FOUND, '任务不存在');
    if (!Array.isArray(body.answers)) throw new AppError(ErrorCode.VALIDATION_FAILED, 'answers 必须是数组');
    const state = planningRoundInteractionState(round, parsed.kind);
    const availability = interactionResolveAvailability(parsed.kind, state);
    // A settled replay is answered from the stored receipt even though the round
    // (or its state) moved on; fresh submissions must satisfy availability.
    const existing = engine.commands.get(body.requestKey);
    if (!availability.allowed && existing === undefined) {
      throw new AppError(ErrorCode.OPERATION_IN_PROGRESS, availability.reason ?? '该互动事项当前不能提交', {
        details: { interactionId: request.params.id, state, reasonCode: availability.reasonCode },
      });
    }
    const answers = body.answers.map((answer, index) => {
      if (answer === null || typeof answer !== 'object' || typeof answer.questionId !== 'string' || answer.questionId === '') {
        throw new AppError(ErrorCode.VALIDATION_FAILED, '答复格式不合法', { details: { index } });
      }
      const question = round.questions.find((item) => item.id === answer.questionId);
      return { questionId: answer.questionId, ...(question?.options === undefined ? { answer: interactionAnswerText(answer) } : normalizeQuestionAnswer(question, answer)) };
    });
    const saved = engine.planning.resolveAnswers(round.taskId, round.id, { requestKey: body.requestKey, roundId: round.id, answers });
    const refreshedRound = store.planning.get(round.id) ?? round;
    const refreshedTask = store.tasks.get(round.taskId) ?? task;
    const result: InteractionResolveResult = {
      interaction: buildInteractionDetail(store, refreshedRound, parsed.kind),
      planning: saved.resource?.planning ?? engine.planning.planningResponse(round.taskId).planning,
      requirementRevision: refreshedTask.requirement.revision,
    };
    return envelope({ receipt: saved.receipt, resource: result }, requestId(request));
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
    // 设置保存是全局变更：登记操作并返回回执，失败/重放都能按 requestKey 核对。
    const { record, replayed } = engine.commands.begin({
      requestKey: body.requestKey,
      operation: 'settings.update',
      body: { patch: body.patch, confirmAcrossProjects: body.confirmAcrossProjects === true },
      target: {},
    });
    if (replayed) {
      const settingsNow = engine.publicSettings();
      const issuesNow = validateSettings(settingsNow);
      return envelope(
        { receipt: engine.commands.toReceipt(record), resource: { settings: settingsNow, issues: issuesNow, catalog: engine.catalog }, settings: settingsNow, issues: issuesNow, catalog: engine.catalog },
        requestId(request),
      );
    }
    try {
      const current = engine.publicSettings();
      const merged = mergeSettings(current, body.patch) as AppSettings;
      const issues = validateSettings(merged);
      if (issues.length > 0) throw new AppError(ErrorCode.VALIDATION_FAILED, '设置校验失败', { details: { issues } });
      if (databaseService !== undefined && JSON.stringify(current.database) !== JSON.stringify(merged.database)) await databaseService.applySettings(merged.database);
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
    return envelope({ connections: databaseService.list(), types: Object.entries(DATABASE_TYPE_META).map(([id, meta]) => ({ id, ...meta, available: meta.driver !== 'planned', ...(meta.driver === 'planned' ? { disabledReason: '此版本未提供对应驱动，不能测试或保存；历史连接仅可查看' } : {}) })) }, requestId(request));
  });
  app.post('/api/settings/databases/probe-draft', async (request) => {
    if (databaseService === undefined) throw new AppError(ErrorCode.NOT_CONFIGURED, '数据库模块未接通');
    const body = request.body as DatabaseDraftProbeRequest;
    return envelope({ probe: await databaseService.probeDraft(body?.connection) }, requestId(request));
  });
  app.post('/api/settings/databases', async (request) => {
    if (databaseService === undefined) throw new AppError(ErrorCode.NOT_CONFIGURED, '数据库模块未接通');
    const body = commandBody<DatabaseConnectionUpsertRequest>(request);
    const input = body.connection;
    if (input === null || typeof input !== 'object') throw new AppError(ErrorCode.VALIDATION_FAILED, '缺少 connection');
    // 连接登记属于设置变更（OPERATIONS 未单列连接 CRUD），用 settings.update 登记回执。
    const { record, replayed } = engine.commands.begin({
      requestKey: body.requestKey,
      operation: 'settings.update',
      body: { connection: { ...input, passwordHash: input.password === undefined ? undefined : createHash('sha256').update(input.password).digest('hex'), password: undefined } },
      target: {},
    });
    if (replayed) {
      const savedId = typeof record.outcome?.connectionId === 'string' ? record.outcome.connectionId : undefined;
      const connection = savedId === undefined ? undefined : databaseService.list().find((item) => item.id === savedId);
      return envelope(
        { receipt: engine.commands.toReceipt(record), resource: { connection }, ...(connection === undefined ? {} : { connection }) },
        requestId(request),
      );
    }
    try {
      const settings = engine.publicSettings();
      if (DATABASE_TYPE_META[input.type]?.driver === undefined || DATABASE_TYPE_META[input.type]?.driver === 'planned') throw new AppError(ErrorCode.CAPABILITY_UNAVAILABLE, '此类型没有已提供的驱动，不能新增或修改连接');
      if (input.readOnly === false) throw new AppError(ErrorCode.VALIDATION_FAILED, '数据库连接必须保持只读');
      if (input.projectIds !== undefined && (!Array.isArray(input.projectIds) || input.projectIds.some((id) => typeof id !== 'string'))) throw new AppError(ErrorCode.VALIDATION_FAILED, 'projectIds 必须是项目 id 列表');
      for (const projectId of input.projectIds ?? []) if (store.projects.get(projectId) === undefined) throw new AppError(ErrorCode.VALIDATION_FAILED, '授权项目不存在');
      const scopeIssues = databaseScopeIssues(input);
      if (scopeIssues.length > 0) throw new AppError(ErrorCode.VALIDATION_FAILED, scopeIssues.join('；'));
      if ((input.password === undefined || input.password === '') && !sameDatabaseTarget(input, settings.database.connections.find((item) => item.id === input.id))) throw new AppError(ErrorCode.VALIDATION_FAILED, '新增连接或修改连接目标后，请重新输入密码');
      const id = input.id ?? `db_${Math.random().toString(36).slice(2, 12)}`;
      const passwordRef = input.password === undefined || input.password === '' ? settings.database.connections.find((item) => item.id === id)?.passwordRef : `db:${id}:${body.requestKey}`;
      const config = {
        id,
        name: input.name,
        type: input.type,
        host: input.host,
        port: input.port,
        database: input.database,
        user: input.user,
        ...(passwordRef === undefined ? {} : { passwordRef }),
        readOnly: true,
        enabled: input.enabled ?? true,
        projectIds: input.projectIds ?? [],
        schemas: input.schemas ?? [],
        tables: input.tables ?? [],
        ssl: input.ssl ?? false,
      };
      const duplicate = settings.database.connections.find((item) => item.id !== id && item.host === config.host && item.port === config.port && item.database === config.database);
      if (duplicate !== undefined) {
        const conflict = new AppError(ErrorCode.CONFLICT, '同一主机/端口/数据库已经有连接配置', { details: { connectionId: duplicate.id, name: duplicate.name } });
          throw conflict;
      }
      if (input.password !== undefined && input.password !== '' && passwordRef !== undefined) store.secrets.put(passwordRef, input.password);
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
    if (replayed) {
      const connections = databaseService.list();
      return envelope({ receipt: engine.commands.toReceipt(record), resource: { connections }, connections }, requestId(request));
    }
    try {
      const settings = engine.publicSettings();
      if (!settings.database.connections.some((connection) => connection.id === request.params.id)) {
        throw new AppError(ErrorCode.NOT_FOUND, '数据库连接不存在');
      }
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
      body: { provider: body.provider, baseUrl: body.baseUrl, apiBaseUrl: body.apiBaseUrl, tokenHash: body.token === undefined ? undefined : createHash('sha256').update(body.token).digest('hex') },
      target: {},
    });
    if (replayed) {
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
          generation: status.startedAt === undefined ? undefined : createHash('sha256').update(`${status.startedAt}:${status.pid ?? ''}`).digest('hex').slice(0, 12),
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
  registerRuntimeOperationRoutes(app, store, engine, opencodeRef);

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

/* ------------------------------------------------------------------ */
/* Inbox interactions (real planning questions / candidate / unknown)  */
/* ------------------------------------------------------------------ */

const INTERACTION_ID_PATTERN = /^int_(planning|review|reconcile)_(.+)$/;

function interactionKindSegment(kind: 'planning_question' | 'planning_review' | 'planning_reconcile'): string {
  if (kind === InteractionKind.PLANNING_QUESTION) return 'planning';
  if (kind === InteractionKind.PLANNING_REVIEW) return 'review';
  return 'reconcile';
}

function buildInteractionId(kind: 'planning_question' | 'planning_review' | 'planning_reconcile', roundId: string): string {
  return `int_${interactionKindSegment(kind)}_${roundId}`;
}

function parseInteractionId(id: string): { readonly kind: 'planning_question' | 'planning_review' | 'planning_reconcile'; readonly roundId: string } | undefined {
  const match = INTERACTION_ID_PATTERN.exec(id);
  if (match === null) return undefined;
  const segment = match[1];
  const roundId = match[2];
  if (segment === undefined || roundId === undefined || roundId === '') return undefined;
  const kind = segment === 'planning'
    ? InteractionKind.PLANNING_QUESTION
    : segment === 'review'
      ? InteractionKind.PLANNING_REVIEW
      : InteractionKind.PLANNING_RECONCILE;
  return { kind, roundId };
}

/**
 * Planning items derive from saved rounds; runtime permissions/policy use the
 * independent persisted runtime-interaction bridge. Capability does not invent
 * pending requests when the runtime has not emitted one.
 */
function interactionCapabilities(): InteractionCapabilitiesView {
  return {
    planningQuestions: true,
    planningReview: true,
    permissions: true,
    policy: true,
    reason: '权限与策略来自原运行时事件；仅在冻结的只读授权上限内答复。',
  };
}

function questionAnswered(question: PlanningQuestion): boolean {
  return isPlanningQuestionAnswered(question);
}

function planningRoundIsUnknown(round: PlanningRound): boolean {
  return isPlanningRoundUnknown(round);
}

function planningRoundInteractionState(round: PlanningRound, kind: 'planning_question' | 'planning_review' | 'planning_reconcile'): InteractionStateValue {
  if (planningRoundIsUnknown(round)) return InteractionState.UNKNOWN;
  if (kind === InteractionKind.PLANNING_RECONCILE) return InteractionState.RESOLVED;
  if (kind === InteractionKind.PLANNING_QUESTION) {
    return hasPendingPlanningQuestions(round) ? InteractionState.OPEN : InteractionState.RESOLVED;
  }
  if (kind === InteractionKind.PLANNING_REVIEW) {
    return hasPendingPlanningReview(round) ? InteractionState.OPEN : InteractionState.RESOLVED;
  }
  return InteractionState.UNKNOWN;
}

/** One item per round, in priority order: unknown reconcile > questions > review. */
function primaryInteractionKind(round: PlanningRound): 'planning_question' | 'planning_review' | 'planning_reconcile' | undefined {
  if (planningRoundIsUnknown(round)) return InteractionKind.PLANNING_RECONCILE;
  if (planningRoundInteractionState(round, InteractionKind.PLANNING_QUESTION) === InteractionState.OPEN) return InteractionKind.PLANNING_QUESTION;
  if (planningRoundInteractionState(round, InteractionKind.PLANNING_REVIEW) === InteractionState.OPEN) return InteractionKind.PLANNING_REVIEW;
  return undefined;
}

function buildInteractionSummary(store: Store, round: PlanningRound, kind: 'planning_question' | 'planning_review' | 'planning_reconcile'): InteractionSummary | undefined {
  const task = store.tasks.get(round.taskId);
  if (task === undefined || task.lifecycle !== TaskLifecycle.ACTIVE) return undefined;
  const project = store.projects.get(task.projectId);
  const state = planningRoundInteractionState(round, kind);
  const unansweredRequired = round.questions.filter((question) => question.required && !questionAnswered(question));
  const title = kind === InteractionKind.PLANNING_QUESTION
    ? '有必须答复的规划问题'
    : kind === InteractionKind.PLANNING_REVIEW
      ? '候选计划待审阅'
      : '规划结果待核对';
  const summary = kind === InteractionKind.PLANNING_QUESTION
    ? (unansweredRequired.length > 0
        ? `${String(unansweredRequired.length)} 个必答问题：${unansweredRequired.map((question) => question.question).join('；')}`
        : '本轮必答问题已答复')
    : kind === InteractionKind.PLANNING_REVIEW
      ? round.candidate?.summary ?? '候选已生成'
      : '只按原请求号核对，不会重新生成';
  return {
    id: buildInteractionId(kind, round.id),
    kind,
    state,
    title,
    summary,
    taskId: task.id,
    taskTitle: task.title,
    projectId: task.projectId,
    projectName: project?.name ?? '未知项目',
    stepName: `规划轮次 ${String(round.ordinal)}`,
    roundId: round.id,
    roundOrdinal: round.ordinal,
    createdAt: round.startedAt ?? task.updatedAt,
    updatedAt: task.updatedAt,
    returnTo: `/requirement/${task.id}`,
  };
}

function buildInteractionQuestion(question: PlanningQuestion): InteractionQuestion {
  return {
    id: question.id,
    title: question.question,
    required: question.required,
    answered: questionAnswered(question),
    ...(questionAnswered(question) && question.answer !== undefined ? { answer: question.answer } : {}),
    ...(question.answeredAt === undefined ? {} : { answeredAt: question.answeredAt }),
    affectedNodeIds: [...question.affectedNodeIds],
    ...questionChoices(question),
    ...(question.values === undefined ? {} : { values: question.values }),
    ...(question.other === undefined ? {} : { other: question.other }),
    inputMode: question.options === undefined ? 'free_text' : question.multiple ? 'multi_select' : 'single_select',
  };
}

function interactionResolveAvailability(
  kind: 'planning_question' | 'planning_review' | 'planning_reconcile',
  state: InteractionStateValue,
): InteractionResolveAvailability {
  if (kind === InteractionKind.PLANNING_QUESTION) {
    if (state === InteractionState.OPEN) return { allowed: true, confirmField: 'confirmResolve' };
    if (state === InteractionState.UNKNOWN) {
      return {
        allowed: false,
        confirmField: 'confirmResolve',
        reasonCode: 'INTERACTION_UNKNOWN',
        reason: '规划轮次结果未明，只能按原请求号核对，不能在这里提交答复',
      };
    }
    return {
      allowed: false,
      confirmField: 'confirmResolve',
      reasonCode: 'INTERACTION_RESOLVED',
      reason: '本轮规划问题已答复；如需修改请到需求画布保存答复',
    };
  }
  if (kind === InteractionKind.PLANNING_REVIEW) {
    return {
      allowed: false,
      confirmField: 'confirmResolve',
      reasonCode: 'INTERACTION_READ_ONLY',
      reason: '候选计划审阅请在需求画布「应用候选 / 不采用」处理（服务提供 planning.apply / planning.reject）',
    };
  }
  return {
    allowed: false,
    confirmField: 'confirmResolve',
    reasonCode: 'INTERACTION_READ_ONLY',
    reason: '规划结果未明，只能按原请求号核对（GET /api/operations/:key），不会重新生成',
  };
}

function buildInteractionDetail(store: Store, round: PlanningRound, kind: 'planning_question' | 'planning_review' | 'planning_reconcile'): InteractionDetail {
  const summary = buildInteractionSummary(store, round, kind);
  if (summary === undefined) throw new AppError(ErrorCode.NOT_FOUND, '互动事项不存在');
  const task = store.tasks.get(summary.taskId);
  if (task === undefined) throw new AppError(ErrorCode.NOT_FOUND, '任务不存在');
  const questions = round.questions.map(buildInteractionQuestion);
  const nodeIds = [...new Set(round.questions.flatMap((question) => question.affectedNodeIds))];
  const candidate = round.candidate === undefined
    ? undefined
    : {
        planRevisionId: round.candidate.planRevisionId,
        summary: round.candidate.summary,
        validationState: round.candidate.validation.structural.state === 'failed' ? 'failed' as const : 'passed' as const,
        diffCount: round.candidate.diff.length,
      };
  const answeredAt = round.questions
    .map((question) => question.answeredAt)
    .filter((value): value is string => typeof value === 'string')
    .sort()
    .at(-1);
  return {
    ...summary,
    source: kind === InteractionKind.PLANNING_REVIEW && round.candidate !== undefined
      ? { type: 'planning_candidate', roundId: round.id, roundOrdinal: round.ordinal, planRevisionId: round.candidate.planRevisionId, ...(nodeIds.length === 0 ? {} : { nodeIds }) }
      : { type: 'planning_round', roundId: round.id, roundOrdinal: round.ordinal, ...(nodeIds.length === 0 ? {} : { nodeIds }) },
    questions,
    ...(candidate === undefined ? {} : { candidate }),
    degradation: {
      options: questions.some((question) => question.options !== undefined),
      multiSelect: questions.some((question) => question.multiple),
      recommendedValue: questions.some((question) => question.options?.some((option) => option.recommended)),
      reason: questions.every((question) => question.options === undefined) ? '本轮模型只提供单答案文本问题，未提供选项。规划业务问题需明确回答，不能以拒绝回答作为业务结论。' : '只展示本轮模型实际提交的选项；推荐答案需明确采用后再提交。',
    },
    resolve: interactionResolveAvailability(kind, summary.state),
    ...(summary.state === InteractionState.UNKNOWN
      ? {
          unknown: {
            message: kind === InteractionKind.PLANNING_RECONCILE
              ? '规划结果未明；只能按原请求号核对（GET /api/operations/:key），不会重新生成'
              : '规划轮次结果未明；先按原请求号核对',
          },
        }
      : {}),
    ...(summary.state === InteractionState.RESOLVED && answeredAt !== undefined ? { resolvedAt: answeredAt } : {}),
    requirementRevision: task.requirement.revision,
  };
}

function interactionAnswerText(answer: { readonly values?: readonly string[]; readonly other?: string }): string {
  const parts = Array.isArray(answer.values)
    ? answer.values.filter((value): value is string => typeof value === 'string' && value.trim() !== '').map((value) => value.trim())
    : [];
  if (typeof answer.other === 'string' && answer.other.trim() !== '') parts.push(answer.other.trim());
  return parts.join('；');
}

function listInboxInteractions(store: Store): InteractionListResponse {
  const items: InteractionSummary[] = [];
  for (const task of store.tasks.list()) {
    if (task.lifecycle !== TaskLifecycle.ACTIVE) continue;
    const round = task.currentPlanningRoundId === undefined ? store.planning.latest(task.id) : store.planning.get(task.currentPlanningRoundId);
    if (round === undefined) continue;
    const kind = primaryInteractionKind(round);
    if (kind === undefined) continue;
    const summary = buildInteractionSummary(store, round, kind);
    if (summary !== undefined) items.push(summary);
  }
  items.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
  return {
    items,
    counts: {
      open: items.filter((item) => item.state === InteractionState.OPEN).length,
      unknown: items.filter((item) => item.state === InteractionState.UNKNOWN).length,
    },
    capabilities: interactionCapabilities(),
  };
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
