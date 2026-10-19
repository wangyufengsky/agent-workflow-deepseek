import { assertDatabaseQueryAccess } from '@agent-workflow/database';
import { toolPolicyView } from './tool-policy.ts';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, realpathSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AttemptResult, Task } from '@agent-workflow/shared';
import { AppError, ErrorCode, nowIso } from '@agent-workflow/shared';
import { roleFileAllowed, roleCommandAllowed, roleCapability, type Engine } from '@agent-workflow/engine';
import type { Store } from '@agent-workflow/storage';
import { requireSessionScope } from './session-scope.ts';
import { envelope, mapError } from './http.ts';

export interface InternalDependencies {
  readonly engine: Engine;
  readonly store: Store;
  readonly token: string;
  readonly internalUrl: string;
}

const MAX_FILE_BYTES = 512 * 1024;
const MAX_EXEC_OUTPUT = 64 * 1024;

export function registerInternalRoutes(app: FastifyInstance, deps: InternalDependencies): void {
  const guard = (request: FastifyRequest): void => {
    const header = request.headers.authorization ?? '';
    if (header !== `Bearer ${deps.token}`) {
      throw new AppError(ErrorCode.UNAUTHORIZED, '内部 MCP 调用未授权');
    }
    authorizeSessionRequest(request, deps);
  };

  const handler = <T>(fn: (request: FastifyRequest) => Promise<T> | T) => async (request: FastifyRequest, reply: { status: (code: number) => unknown }) => {
    try {
      guard(request);
      return { data: await fn(request) };
    } catch (error) {
      const mapped = mapError(error);
      (reply as { status: (code: number) => { send: (body: unknown) => void } }).status(mapped.status).send({
        error: { ...mapped.body.error, at: nowIso() },
      });
      return undefined;
    }
  };

  app.get('/internal/mcp/context', handler(async (request) => {
    const query = request.query as { taskId?: string; nodeId?: string; attemptId?: string };
    if (query.taskId === undefined) throw new AppError(ErrorCode.VALIDATION_FAILED, '缺少 taskId');
    return buildContext(deps.engine, deps.store, query.taskId, query.nodeId);
  }));

  app.post('/internal/mcp/plan-submit', handler(async (request) => {
    const body = request.body as { taskId?: string; roundId?: string; candidate?: unknown };
    if (body.taskId === undefined || body.roundId === undefined) throw new AppError(ErrorCode.VALIDATION_FAILED, '缺少 taskId / roundId');
    const result = deps.engine.planning.submitCandidate({ taskId: body.taskId, roundId: body.roundId, candidate: body.candidate });
    if (!result.ok) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, '候选计划未通过结构检查，请按 problems 修正后重新提交', {
        details: { problems: result.problems, humanDecisions: result.humanDecisions, requiredQuestions: result.requiredQuestions, planRevisionId: result.planRevisionId },
      });
    }
    return result;
  }));

  app.post('/internal/mcp/question', handler(async (request) => {
    const body = request.body as { taskId?: string; roundId?: string; question?: string; required?: boolean; nodeKeys?: string[] };
    if (body.taskId === undefined || body.roundId === undefined || body.question === undefined) throw new AppError(ErrorCode.VALIDATION_FAILED, '缺少 taskId / roundId / question');
    deps.engine.planning.appendQuestion({
      taskId: body.taskId,
      roundId: body.roundId,
      question: body.question,
      required: body.required ?? false,
      nodeKeys: body.nodeKeys,
    });
    return { ok: true };
  }));

  app.post('/internal/mcp/result-submit', handler(async (request) => {
    const body = request.body as {
      taskId?: string;
      nodeId?: string;
      attemptId?: string;
      summary?: string;
      payload?: Record<string, unknown>;
      verification?: AttemptResult['verification'];
      artifacts?: readonly import('@agent-workflow/shared').ArtifactSubmission[];
    };
    if (body.taskId === undefined || body.nodeId === undefined || body.attemptId === undefined || body.summary === undefined) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, '缺少 taskId / nodeId / attemptId / summary');
    }
    return deps.engine.executions.submitResult({
      taskId: body.taskId,
      nodeId: body.nodeId,
      attemptId: body.attemptId,
      summary: body.summary,
      payload: body.payload,
      verification: body.verification,
      artifacts: body.artifacts,
    });
  }));

  app.get('/internal/mcp/git/status', handler(async (request) => {
    const projectId = (request.query as { projectId?: string }).projectId;
    if (projectId === undefined) throw new AppError(ErrorCode.VALIDATION_FAILED, '缺少 projectId');
    const project = requireProject(deps, projectId);
    return deps.engine.ports.git.status(project.rootPath);
  }));

  app.get('/internal/mcp/git/log', handler(async (request) => {
    const query = request.query as { projectId?: string; limit?: string; ref?: string };
    if (query.projectId === undefined) throw new AppError(ErrorCode.VALIDATION_FAILED, '缺少 projectId');
    const project = requireProject(deps, query.projectId);
    return deps.engine.ports.git.listCommits({ rootPath: project.rootPath, limit: Number(query.limit ?? 20), ref: query.ref });
  }));

  app.get('/internal/mcp/git/diff-files', handler(async (request) => {
    const query = request.query as { projectId?: string; baseSha?: string; headSha?: string };
    if (query.projectId === undefined) throw new AppError(ErrorCode.VALIDATION_FAILED, '缺少 projectId');
    const project = requireProject(deps, query.projectId);
    const status = await deps.engine.ports.git.status(project.rootPath);
    const headSha = query.headSha ?? status?.head.sha;
    const baseSha = query.baseSha ?? `${headSha ?? 'HEAD'}^`;
    return deps.engine.ports.git.diffFiles({ repoRoot: project.rootPath, baseSha, headSha });
  }));

  app.get('/internal/mcp/git/commit-show', handler(async (request) => {
    const query = request.query as { projectId?: string; sha?: string };
    if (query.projectId === undefined || query.sha === undefined) throw new AppError(ErrorCode.VALIDATION_FAILED, '缺少 projectId / sha');
    const project = requireProject(deps, query.projectId);
    return deps.engine.ports.git.commitShow(project.rootPath, query.sha);
  }));

  app.post('/internal/mcp/database/query', handler(async (request) => {
    const body = request.body as { taskId?: string; connectionId?: string; sql?: string; limit?: number };
    if (body.connectionId === undefined || body.sql === undefined) throw new AppError(ErrorCode.VALIDATION_FAILED, '缺少 connectionId / sql');
    if (body.taskId === undefined) throw new AppError(ErrorCode.FORBIDDEN, '数据库查询必须提供任务授权上下文');
    const task = requireTask(deps, body.taskId);
    const { request: dispatch } = requireSessionScope(request.headers['x-agent-workflow-scope']);
    const execution = task.executionId === undefined ? undefined : deps.store.executions.get(task.executionId);
    const plan = execution === undefined ? undefined : deps.store.plans.get(execution.planRevisionId);
    const node = plan?.graph.nodes.find((item) => item.id === dispatch.metadata.nodeId);
    const role = dispatch.rolePolicy;
    if (!node?.resources.read.some((resource) => resource.kind === 'database' && resource.id === body.connectionId)) throw new AppError(ErrorCode.FORBIDDEN, '当前步骤未声明此数据库连接');
    if (role === undefined || !roleCapability(role, 'database_read') || !role.resourcePermissions?.resources.some((resource) => resource.id === 'database_read')) {
      throw new AppError(ErrorCode.FORBIDDEN, '当前职业没有此数据库连接的读取授权');
    }
    const grant = dispatch.databaseAccess?.find((item) => item.connectionId === body.connectionId);
    const current = deps.engine.settings.database.connections.find((item) => item.id === body.connectionId);
    if (grant === undefined || current === undefined || current.enabled === false || !current.projectIds?.includes(task.projectId)) throw new AppError(ErrorCode.FORBIDDEN, '数据库连接未授权此项目，或授权已撤销');
    assertDatabaseQueryAccess(body.sql, grant);
    assertDatabaseQueryAccess(body.sql, { connectionId: current.id, projectIds: current.projectIds ?? [], schemas: current.schemas ?? [], tables: current.tables ?? [], defaultSchema: current.type === 'postgresql' ? 'public' : current.database });
    if (deps.engine.ports.database === undefined) throw new AppError(ErrorCode.DATABASE_NOT_CONFIGURED, '数据库模块未接通');
    return deps.engine.ports.database.query(body.connectionId, body.sql, body.limit, grant.connectionConfig);
  }));

  app.get('/internal/mcp/workspace/file', handler(async (request) => {
    const query = request.query as { taskId?: string; path?: string; offset?: string; limit?: string };
    if (query.taskId === undefined || query.path === undefined) throw new AppError(ErrorCode.VALIDATION_FAILED, '缺少 taskId / path');
    assertRoleResource(request, 'read', query.path ?? '.');
    const root = resolveReadRoot(deps, query.taskId);
    const absolute = safePath(root, query.path);
    if (!existsSync(absolute)) throw new AppError(ErrorCode.NOT_FOUND, `文件不存在：${query.path}`);
    const stat = statSync(absolute);
    if (!stat.isFile()) throw new AppError(ErrorCode.VALIDATION_FAILED, '不是文件');
    if (stat.size > MAX_FILE_BYTES) throw new AppError(ErrorCode.TRUNCATED, '文件超过 512KB，请改用读取片段', { details: { sizeBytes: stat.size } });
    const content = readFileSync(absolute, 'utf8');
    const lines = content.split('\n');
    const offset = Math.max(0, Number(query.offset ?? 0));
    const limit = Number(query.limit ?? 0);
    const selected = limit > 0 ? lines.slice(offset, offset + limit) : lines;
    return {
      path: query.path,
      sizeBytes: stat.size,
      sha: sha256(content),
      totalLines: lines.length,
      offset,
      lines: selected,
      truncated: limit > 0 && offset + limit < lines.length,
      readOnly: resolveReadRoot(deps, query.taskId) !== resolveWriteRootOptional(deps, query.taskId),
    };
  }));

  app.get('/internal/mcp/workspace/files', handler(async (request) => {
    const query = request.query as { taskId?: string; path?: string };
    if (query.taskId === undefined) throw new AppError(ErrorCode.VALIDATION_FAILED, '缺少 taskId');
    assertRoleResource(request, 'read', query.path ?? '.');
    const root = resolveReadRoot(deps, query.taskId);
    const base = query.path === undefined || query.path === '' ? root : safePath(root, query.path);
    if (!existsSync(base)) throw new AppError(ErrorCode.NOT_FOUND, '目录不存在');
    const entries: { path: string; kind: 'file' | 'directory'; sizeBytes?: number }[] = [];
    const walk = (directory: string, depth: number) => {
      if (entries.length >= 200 || depth > 4) return;
      for (const dirent of readdirSync(directory, { withFileTypes: true })) {
        if (dirent.name === '.git' || dirent.name === 'node_modules' || dirent.name === '.data') continue;
        const absolute = join(directory, dirent.name);
        const rel = relative(root, absolute).split(sep).join('/');
        if (dirent.isDirectory()) {
          entries.push({ path: rel, kind: 'directory' });
          walk(absolute, depth + 1);
        } else if (dirent.isFile()) {
          entries.push({ path: rel, kind: 'file', sizeBytes: statSync(absolute).size });
        }
        if (entries.length >= 200) return;
      }
    };
    walk(base, 0);
    return { root: relative(process.cwd(), root), entries, truncated: entries.length >= 200 };
  }));

  app.post('/internal/mcp/workspace/file-write', handler(async (request) => {
    const body = request.body as { taskId?: string; path?: string; content?: string; expectedSha?: string };
    if (body.taskId === undefined || body.path === undefined || body.content === undefined) throw new AppError(ErrorCode.VALIDATION_FAILED, '缺少 taskId / path / content');
    assertRoleResource(request, 'write', body.path);
    const root = resolveWriteRoot(deps, body.taskId);
    const absolute = safePath(root, body.path);
    if (Buffer.byteLength(body.content, 'utf8') > MAX_FILE_BYTES) throw new AppError(ErrorCode.VALIDATION_FAILED, '写入内容超过 512KB');
    if (existsSync(absolute) && body.expectedSha !== undefined) {
      const current = sha256(readFileSync(absolute, 'utf8'));
      if (current !== body.expectedSha) throw new AppError(ErrorCode.STALE_TARGET, '文件已被修改，请重新读取', { details: { currentSha: current } });
    }
    const temporary = `${absolute}.tmp-${process.pid}`;
    writeFileSync(temporary, body.content, 'utf8');
    renameSync(temporary, absolute);
    return { path: body.path, sizeBytes: Buffer.byteLength(body.content, 'utf8'), sha: sha256(body.content) };
  }));

  app.post('/internal/mcp/workspace/exec', handler(async (request) => {
    const body = request.body as { taskId?: string; command?: string; timeoutMs?: number };
    if (body.taskId === undefined || body.command === undefined) throw new AppError(ErrorCode.VALIDATION_FAILED, '缺少 taskId / command');
    assertRoleResource(request, 'command', body.command);
    const root = resolveWriteRoot(deps, body.taskId);
    const argv = tokenizeCommand(body.command);
    if (argv.length === 0) throw new AppError(ErrorCode.VALIDATION_FAILED, '命令为空');
    const allowed = allowedCommands(deps.engine);
    const normalized = allowed.map((prefix) => prefix.split(/\s+/).filter(Boolean));
    const matched = normalized.some((prefix) => prefix.length > 0 && prefix.every((token, index) => argv[index] === token));
    if (!matched) {
      throw new AppError(ErrorCode.COMMAND_NOT_ALLOWED, '命令不在允许列表内', { details: { allowed } });
    }
    if (body.timeoutMs !== undefined && (!Number.isInteger(body.timeoutMs) || body.timeoutMs < 1)) throw new AppError(ErrorCode.VALIDATION_FAILED, '命令超时必须是正整数毫秒');
    const task = deps.store.tasks.get(body.taskId);
    const frozen = task?.executionId === undefined ? undefined : deps.store.settings.getJson<{ verifyCommandTimeoutMs: number }>(`execution.settings.${task.executionId}`);
    const fix = deps.store.settings.getJson<{ verifyCommandTimeoutMs?: number }>(`fix.worktree.${body.taskId}`);
    const limit = frozen?.verifyCommandTimeoutMs ?? fix?.verifyCommandTimeoutMs ?? deps.engine.settings.execution.verifyCommandTimeoutMs;
    const result = await runCommand(argv, root, Math.min(body.timeoutMs ?? limit, limit));
    return result;
  }));
}

function buildContext(engine: Engine, store: Store, taskId: string, nodeId?: string) {
  const task = store.tasks.get(taskId);
  if (task === undefined) throw new AppError(ErrorCode.NOT_FOUND, '任务不存在');
  const project = store.projects.get(task.projectId);
  if (project === undefined) throw new AppError(ErrorCode.NOT_FOUND, '项目不存在');
  const method = engine.catalog.methods.find((item) => item.id === task.methodId);
  const plan = task.currentPlanRevisionId === undefined ? store.plans.latest(taskId) : store.plans.get(task.currentPlanRevisionId);
  const round = task.currentPlanningRoundId === undefined ? store.planning.latest(taskId) : store.planning.get(task.currentPlanningRoundId);
  const workspace = task.workspaceId === undefined ? store.workspaces.byTask(taskId) : store.workspaces.get(task.workspaceId);
  const node = nodeId === undefined ? undefined : plan?.graph.nodes.find((item) => item.id === nodeId);
  const attempt = task.executionId === undefined
    ? undefined
    : store.executions.listAttempts(task.executionId, nodeId).find((item) => item.status === 'running');
  return {
    task: { id: task.id, title: task.title, stage: task.stage, lifecycle: task.lifecycle, attention: task.attention, methodId: task.methodId, fixedTemplate: task.fixedTemplate ?? null },
    requirement: task.requirement,
    project: { id: project.id, name: project.name, rootPath: project.rootPath, gitState: project.gitState, defaultBranch: project.defaultBranch },
    method: method === undefined ? null : {
      id: method.id,
      name: method.name,
      revision: method.revision,
      support: method.support,
      requiredSteps: method.requiredSteps,
      refinableGroups: method.refinableGroups,
      planningStrategy: method.planningStrategy,
    },
    round: round === undefined ? null : { id: round.id, ordinal: round.ordinal, status: round.status, stage: round.stage, inputRevision: round.inputRevision, questions: round.questions },
    plan: plan === undefined ? null : { id: plan.id, revisionNumber: plan.revisionNumber, status: plan.status, nodes: plan.graph.nodes, edges: plan.graph.edges, groups: plan.graph.groups },
    workspace: workspace === undefined ? null : { id: workspace.id, kind: workspace.kind, state: workspace.state, branch: workspace.branch, baseSha: workspace.baseSha, root: resolveReadRootByStore(store, task) },
    node: node ?? null,
    attempt: attempt === undefined ? null : { id: attempt.id, ordinal: attempt.ordinal, status: attempt.status },
  };
}

function resolveReadRootByStore(store: Store, task: Task): string {
  const workspace = task.workspaceId === undefined ? store.workspaces.byTask(task.id) : store.workspaces.get(task.workspaceId);
  if (workspace?.state === 'ready' && workspace.displayRoot !== undefined) return workspace.displayRoot;
  const project = store.projects.get(task.projectId);
  return project?.rootPath ?? process.cwd();
}

function resolveFixRoot(deps: InternalDependencies, rootRef: string): string | undefined {
  const saved = deps.store.settings.getJson<{ path?: string }>(`fix.worktree.${rootRef}`);
  if (saved === undefined || typeof saved.path !== 'string' || saved.path === '') return undefined;
  if (!existsSync(saved.path)) throw new AppError(ErrorCode.WORKSPACE_NOT_READY, '修复工作区已不存在');
  return saved.path;
}

function resolveReadRoot(deps: InternalDependencies, taskId: string): string {
  const fixRoot = resolveFixRoot(deps, taskId);
  if (fixRoot !== undefined) return fixRoot;
  const task = requireTask(deps, taskId);
  return resolveReadRootByStore(deps.store, task);
}

function resolveWriteRoot(deps: InternalDependencies, taskId: string): string {
  const fixRoot = resolveFixRoot(deps, taskId);
  if (fixRoot !== undefined) return fixRoot;
  const task = requireTask(deps, taskId);
  const workspace = task.workspaceId === undefined ? deps.store.workspaces.byTask(taskId) : deps.store.workspaces.get(task.workspaceId);
  if (workspace === undefined || workspace.state !== 'ready' || workspace.displayRoot === undefined) {
    throw new AppError(ErrorCode.WORKSPACE_NOT_READY, '任务工作区尚未准备完成，不能写入');
  }
  return workspace.displayRoot;
}

function resolveWriteRootOptional(deps: InternalDependencies, taskId: string): string {
  try {
    return resolveWriteRoot(deps, taskId);
  } catch {
    return '';
  }
}

function requireTask(deps: InternalDependencies, taskId: string): Task {
  const task = deps.store.tasks.get(taskId);
  if (task === undefined) throw new AppError(ErrorCode.NOT_FOUND, '任务不存在');
  return task;
}

function requireProject(deps: InternalDependencies, projectId: string) {
  const project = deps.store.projects.get(projectId);
  if (project === undefined) throw new AppError(ErrorCode.NOT_FOUND, '项目不存在');
  return project;
}

function safePath(root: string, path: string): string {
  if (isAbsolute(path) || path.includes('\0')) throw new AppError(ErrorCode.PATH_ESCAPE, '路径必须是相对路径');
  const realRoot = existsSync(root) ? realpathSync(root) : resolve(root);
  const normalized = resolve(realRoot, path);
  let ancestor = normalized;
  while (!existsSync(ancestor) && ancestor !== dirname(ancestor)) ancestor = dirname(ancestor);
  const realTarget = resolve(realpathSync(ancestor), relative(ancestor, normalized));
  if (realTarget !== realRoot && !realTarget.startsWith(`${realRoot}${sep}`)) {
    throw new AppError(ErrorCode.PATH_ESCAPE, '路径越出工作区', { details: { path } });
  }
  return realTarget;
}

function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

function allowedCommands(engine: Engine): string[] {
  const configured = engine.settings.git.defaultTestCommand.trim();
  const env = (process.env.AGENT_WORKFLOW_ALLOWED_COMMANDS ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  return [...new Set([...env, ...(configured === '' ? [] : [configured])])];
}

function tokenizeCommand(command: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quote: '"' | "'" | undefined;
  let escaped = false;
  for (const char of command.trim()) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === '\\' && quote !== "'") {
      escaped = true;
      continue;
    }
    if (quote !== undefined) {
      if (char === quote) quote = undefined;
      else current += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current !== '') {
        tokens.push(current);
        current = '';
      }
      continue;
    }
    if (char === ';' || char === '|' || char === '&' || char === '`' || char === '$' || char === '<' || char === '>' || char === '\n') {
      throw new AppError(ErrorCode.COMMAND_NOT_ALLOWED, '命令包含不允许的 shell 操作符', { details: { char } });
    }
    current += char;
  }
  if (quote !== undefined) throw new AppError(ErrorCode.VALIDATION_FAILED, '命令引号未闭合');
  if (current !== '') tokens.push(current);
  return tokens;
}

function runCommand(argv: readonly string[], cwd: string, timeoutMs: number): Promise<{ command: string; exitCode: number; stdout: string; stderr: string; timedOut: boolean }> {
  const [file, ...args] = argv;
  return new Promise((resolvePromise) => {
    execFile(file ?? '', args, {
      cwd,
      timeout: timeoutMs,
      maxBuffer: MAX_EXEC_OUTPUT,
      shell: false,
      env: { PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin', HOME: process.env.HOME ?? '', LANG: process.env.LANG ?? 'en_US.UTF-8' },
    }, (error, stdout, stderr) => {
      const timedOut = error !== null && (error as { killed?: boolean }).killed === true;
      resolvePromise({
        command: argv.join(' '),
        exitCode: error === null ? 0 : typeof (error as { code?: unknown }).code === 'number' ? (error as { code: number }).code : 1,
        stdout: String(stdout ?? '').slice(0, MAX_EXEC_OUTPUT),
        stderr: String(stderr ?? '').slice(0, MAX_EXEC_OUTPUT),
        timedOut,
      });
    });
  });
}

/** Resolve authority from durable running attempts, never from model-supplied role ids. */
function assertRoleResource(request: FastifyRequest, kind: 'read' | 'write' | 'command', value: string): void {
  const { request: dispatch } = requireSessionScope(request.headers['x-agent-workflow-scope']);
  if (dispatch.kind !== 'execution') return; // Planning/fix use their bound directory and read-only/write policy.
  const role = dispatch.rolePolicy;
  if (role === undefined) throw new AppError(ErrorCode.FORBIDDEN, '历史计划缺少职业权限快照，请重新确认计划');
  const allowed = kind === 'command'
    ? roleCapability(role, 'native_tools') && roleCommandAllowed(role, tokenizeCommand(value))
    : roleCapability(role, kind === 'read' ? 'document_read' : 'document_write') && roleFileAllowed(role, value, kind);
  if (!allowed) throw new AppError(ErrorCode.FORBIDDEN, `职业 ${role.name} 未授权${kind}资源：${value}`);
}


const ROUTE_TO_TOOL: Readonly<Record<string, string>> = {
  '/internal/mcp/context': 'workflow.context.get',
  '/internal/mcp/plan-submit': 'workflow.plan.submit',
  '/internal/mcp/question': 'workflow.question.ask',
  '/internal/mcp/result-submit': 'workflow.result.submit',
  '/internal/mcp/git/status': 'git.repo.status',
  '/internal/mcp/git/log': 'git.log',
  '/internal/mcp/git/diff-files': 'git.diff.files',
  '/internal/mcp/git/commit-show': 'git.commit.show',
  '/internal/mcp/database/query': 'database.query',
  '/internal/mcp/workspace/file': 'workspace.file.read',
  '/internal/mcp/workspace/files': 'workspace.file.list',
  '/internal/mcp/workspace/file-write': 'workspace.file.write',
  '/internal/mcp/workspace/exec': 'workspace.exec',
};

function authorizeSessionRequest(request: FastifyRequest, deps: InternalDependencies): void {
  const { request: dispatch } = requireSessionScope(request.headers['x-agent-workflow-scope']);
  if ((dispatch as typeof dispatch & { toolPolicy?: 'none' }).toolPolicy === 'none') throw new AppError(ErrorCode.FORBIDDEN, '此会话只能使用已提供的资料，禁止调用工具');
  const values = { ...(request.query as Record<string, unknown> ?? {}), ...(request.body as Record<string, unknown> ?? {}) };
  const metadata = dispatch.metadata;
  const taskRef = metadata.taskId ?? metadata.fixRunId;
  const task = metadata.taskId === undefined ? undefined : deps.store.tasks.get(metadata.taskId);
  const projectId = metadata.projectId ?? task?.projectId;
  for (const [key, expected] of Object.entries({ taskId: taskRef, projectId, nodeId: metadata.nodeId, attemptId: metadata.attemptId, roundId: metadata.roundId })) {
    if (values[key] !== undefined && (expected === undefined || values[key] !== expected)) throw new AppError(ErrorCode.FORBIDDEN, `会话不能访问另一个 ${key}`);
  }
  const route = request.url.split('?')[0]!;
  const tool = ROUTE_TO_TOOL[route];
  if (dispatch.allowedTools !== undefined && !dispatch.allowedTools.includes(tool ?? '')) throw new AppError(ErrorCode.FORBIDDEN, '此会话的项目/来源/单工具策略禁止此工具');
  if (tool === undefined) throw new AppError(ErrorCode.FORBIDDEN, '会话未授权此工具');
  if (dispatch.allowedTools !== undefined && !toolPolicyView(deps.store, deps.engine, projectId).sources.flatMap((source) => source.tools).some((item) => item.name === tool && item.enabled)) throw new AppError(ErrorCode.FORBIDDEN, '工具许可已收紧或撤销');
  if (dispatch.kind === 'execution') {
    if (task?.executionId === undefined || task.executionId !== metadata.executionId) throw new AppError(ErrorCode.FORBIDDEN, '执行授权已失效');
    const execution = deps.store.executions.get(task.executionId);
    const node = execution?.nodes.find((item) => item.nodeId === metadata.nodeId);
    if (node?.status !== 'running' || node.currentAttemptId !== metadata.attemptId) throw new AppError(ErrorCode.FORBIDDEN, '步骤授权已失效');
    const protocolTool = ['workflow.context.get', 'workflow.result.submit'].includes(tool);
    const toolGranted = dispatch.rolePolicy?.resourcePermissions?.tools.some((item) => item.kind === 'mcp' && item.name === tool) === true;
    if (!protocolTool && (!toolGranted || !roleCapability(dispatch.rolePolicy, 'external_mcp'))) throw new AppError(ErrorCode.FORBIDDEN, '职业未授权此工具');
  } else if (route === '/internal/mcp/result-submit') {
    throw new AppError(ErrorCode.FORBIDDEN, '非执行会话不能提交步骤结果');
  }
  if (['/internal/mcp/plan-submit', '/internal/mcp/question'].includes(route) && dispatch.kind !== 'planning') throw new AppError(ErrorCode.FORBIDDEN, '非规划会话不能修改规划');
  if (dispatch.permission === 'read_only' && ['/internal/mcp/workspace/file-write', '/internal/mcp/workspace/exec'].includes(route)) throw new AppError(ErrorCode.FORBIDDEN, '只读会话不能写入或运行命令');
  if (route.startsWith('/internal/mcp/workspace/')) {
    if (taskRef === undefined || values.taskId !== taskRef) throw new AppError(ErrorCode.FORBIDDEN, '工作区缺少绑定的任务身份');
    if (resolve(resolveReadRoot(deps, taskRef)) !== resolve(dispatch.cwd)) throw new AppError(ErrorCode.FORBIDDEN, '工作区与会话绑定目录不同');
  }
}
