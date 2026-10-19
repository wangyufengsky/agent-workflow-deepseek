import { execFile } from 'node:child_process';
import { existsSync, rmSync, statSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type {
  CommandResponse,
  FixCommitRequest,
  FixDiscardRequest,
  FixFileRevertRequest,
  FixMergeRequestRequest,
  FixPushRequest,
  FixResponse,
  FixStartRequest,
  ReviewFindingUpdateRequest,
  ReviewStartRequest,
} from '@agent-workflow/shared';
import { AppError, ErrorCode, createId } from '@agent-workflow/shared';
import { FixService, ReviewService, type FixWorkspacePort } from '@agent-workflow/engine';
import type { Engine } from '@agent-workflow/engine';
import type { Store } from '@agent-workflow/storage';
import { envelope } from './http.ts';

/**
 * Git AI review / fix HTTP surface.
 *
 * The plugin owns the two domain services so their in-memory stop/session
 * bookkeeping survives across requests. All paths, tokens and worktrees stay
 * server-side: the wire only carries service-issued ids.
 */
export interface ReviewRoutesDeps {
  readonly engine: Engine;
  readonly store: Store;
  /** Optional server-owned restore capability for `fix.file.revert`. */
  readonly workspace?: FixWorkspacePort;
}

const GIT_RESTORE_TIMEOUT_MS = 30_000;

export function registerReviewRoutes(app: FastifyInstance, deps: ReviewRoutesDeps): void {
  const { engine, store } = deps;
  const reviews = new ReviewService({
    store,
    commands: engine.commands,
    context: engine.context,
    git: engine.ports.git,
    opencode: engine.ports.opencode,
    catalog: engine.catalog,
  });
  const fixes = new FixService({
    store,
    commands: engine.commands,
    context: engine.context,
    git: engine.ports.git,
    opencode: engine.ports.opencode,
    catalog: engine.catalog,
    workspace: deps.workspace ?? createGitWorkspacePort(),
    remote: engine.ports.remote,
  });

  /* ---------------------------------------------------------------- */
  /* Reviews                                                           */
  /* ---------------------------------------------------------------- */

  app.post<{ Params: { projectId: string } }>('/api/git/repos/:projectId/reviews/start', async (request) => {
    const body = bodyOf<ReviewStartRequest>(request, { projectId: request.params.projectId });
    const result = await reviews.start(request.params.projectId, body);
    return envelope(result, requestId(request));
  });

  app.get<{ Params: { projectId: string } }>('/api/git/repos/:projectId/reviews', async (request) => {
    return envelope({ reviews: reviews.list(request.params.projectId) }, requestId(request));
  });

  app.get<{ Params: { projectId: string; reviewRunId: string } }>('/api/git/repos/:projectId/reviews/:reviewRunId', async (request) => {
    return envelope({ review: reviews.get(request.params.projectId, request.params.reviewRunId) }, requestId(request));
  });

  app.post<{ Params: { projectId: string; reviewRunId: string } }>('/api/git/repos/:projectId/reviews/:reviewRunId/stop', async (request) => {
    const body = bodyOf<{ requestKey: string }>(request, { projectId: request.params.projectId, reviewRunId: request.params.reviewRunId });
    const result = await reviews.stop(request.params.projectId, request.params.reviewRunId, { requestKey: body.requestKey });
    return envelope(result, requestId(request));
  });

  app.post<{ Params: { projectId: string; findingId: string } }>('/api/git/repos/:projectId/findings/:findingId', async (request) => {
    const body = bodyOf<ReviewFindingUpdateRequest>(request, { projectId: request.params.projectId, findingId: request.params.findingId });
    const result = await reviews.updateFinding(request.params.projectId, request.params.findingId, body);
    return envelope(result, requestId(request));
  });

  /* ---------------------------------------------------------------- */
  /* Fixes                                                             */
  /* ---------------------------------------------------------------- */

  app.post<{ Params: { projectId: string } }>('/api/git/repos/:projectId/fixes/start', async (request) => {
    const body = bodyOf<FixStartRequest>(request, { projectId: request.params.projectId });
    const result = await fixes.start(request.params.projectId, body);
    return fixEnvelope(result, request);
  });

  app.get<{ Params: { projectId: string } }>('/api/git/repos/:projectId/fixes', async (request) => {
    return envelope({ fixes: fixes.list(request.params.projectId) }, requestId(request));
  });

  app.get<{ Params: { projectId: string; fixRunId: string } }>('/api/git/repos/:projectId/fixes/:fixRunId', async (request) => {
    return envelope({ fix: fixes.get(request.params.projectId, request.params.fixRunId) }, requestId(request));
  });

  app.get<{
    Params: { projectId: string; fixRunId: string };
    Querystring: { path?: string; ignoreWhitespace?: string; cursor?: string };
  }>('/api/git/repos/:projectId/fixes/:fixRunId/diff', async (request) => {
    const path = request.query.path;
    if (path === undefined || path === '') throw new AppError(ErrorCode.VALIDATION_FAILED, '缺少 path');
    const diff = await fixes.diff(
      request.params.projectId,
      request.params.fixRunId,
      path,
      request.query.ignoreWhitespace === '1' || request.query.ignoreWhitespace === 'true',
      request.query.cursor,
    );
    return envelope({ diff }, requestId(request));
  });

  app.post<{ Params: { projectId: string; fixRunId: string } }>('/api/git/repos/:projectId/fixes/:fixRunId/stop', async (request) => {
    const body = bodyOf<{ requestKey: string }>(request, { projectId: request.params.projectId, fixRunId: request.params.fixRunId });
    const result = await fixes.stop(request.params.projectId, request.params.fixRunId, { requestKey: body.requestKey });
    return fixEnvelope(result, request);
  });

  app.post<{ Params: { projectId: string; fixRunId: string } }>('/api/git/repos/:projectId/fixes/:fixRunId/commit', async (request) => {
    const body = bodyOf<FixCommitRequest>(request, { projectId: request.params.projectId, fixRunId: request.params.fixRunId });
    const result = await fixes.commit(request.params.projectId, request.params.fixRunId, body);
    return fixEnvelope(result, request);
  });

  app.post<{ Params: { projectId: string; fixRunId: string } }>('/api/git/repos/:projectId/fixes/:fixRunId/push', async (request) => {
    const body = bodyOf<FixPushRequest>(request, { projectId: request.params.projectId, fixRunId: request.params.fixRunId });
    const result = await fixes.push(request.params.projectId, request.params.fixRunId, body);
    return fixEnvelope(result, request);
  });

  app.post<{ Params: { projectId: string; fixRunId: string } }>('/api/git/repos/:projectId/fixes/:fixRunId/merge-request', async (request) => {
    const body = bodyOf<FixMergeRequestRequest>(request, { projectId: request.params.projectId, fixRunId: request.params.fixRunId });
    const result = await fixes.createMergeRequest(request.params.projectId, request.params.fixRunId, body);
    return fixEnvelope(result, request);
  });

  app.post<{ Params: { projectId: string; fixRunId: string } }>('/api/git/repos/:projectId/fixes/:fixRunId/discard', async (request) => {
    const body = bodyOf<FixDiscardRequest>(request, { projectId: request.params.projectId, fixRunId: request.params.fixRunId });
    const result = await fixes.discard(request.params.projectId, request.params.fixRunId, body);
    return fixEnvelope(result, request);
  });

  app.post<{ Params: { projectId: string; fixRunId: string; fileId: string } }>(
    '/api/git/repos/:projectId/fixes/:fixRunId/files/:fileId/revert',
    async (request) => {
      const body = bodyOf<FixFileRevertRequest>(request, { projectId: request.params.projectId, fixRunId: request.params.fixRunId });
      const result = await fixes.revertFile(request.params.projectId, request.params.fixRunId, {
        ...body,
        fileId: request.params.fileId,
      });
      return fixEnvelope(result, request);
    },
  );
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function requestId(request: FastifyRequest): string {
  return String(request.id ?? createId('req'));
}

/**
 * Command envelope for fix writes: the contract is `{receipt, resource:{fix}}`,
 * and the fix resource is also flattened as `fix` for clients that read the
 * resource at the top level (the Web client explicitly tolerates both).
 */
function fixEnvelope(result: CommandResponse<FixResponse>, request: FastifyRequest) {
  return envelope({ ...result, fix: result.resource?.fix }, requestId(request));
}

interface ExpectedPathIds {
  readonly projectId?: string;
  readonly reviewRunId?: string;
  readonly fixRunId?: string;
  readonly findingId?: string;
}

function bodyOf<T>(request: FastifyRequest, expected: ExpectedPathIds = {}): T {
  const body = request.body;
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, '请求体必须是 JSON 对象');
  }
  const record = body as Record<string, unknown>;
  if (typeof record.requestKey !== 'string' || record.requestKey.trim() === '') {
    throw new AppError(ErrorCode.VALIDATION_FAILED, '缺少 requestKey');
  }
  for (const key of ['projectId', 'reviewRunId', 'fixRunId', 'findingId'] as const) {
    const expectedValue = expected[key];
    const value = record[key];
    if (expectedValue !== undefined && value !== undefined && value !== expectedValue) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, `${key} 与请求路径不一致`, { details: { path: expectedValue, body: value } });
    }
  }
  return body as T;
}

/**
 * Server-owned restricted restore for a file in the fix worktree. The path must
 * come from the service changeset (the caller passes it in), never from the
 * renderer, and stays inside the worktree root.
 */
export function createGitWorkspacePort(): FixWorkspacePort {
  return {
    async restoreFile(input) {
      const root = resolve(input.worktreePath);
      const absolute = resolve(root, input.path);
      if (absolute === root || !absolute.startsWith(`${root}${sep}`)) {
        throw new AppError(ErrorCode.PATH_ESCAPE, '文件越出修复副本', { details: { path: input.path } });
      }
      await runGit(['restore', '--staged', '--', input.path], root).catch(() => undefined);
      if (input.status === 'A' || input.status === 'C' || input.status === 'R') {
        if (existsSync(absolute) && statSync(absolute).isFile()) rmSync(absolute, { force: true });
        await runGit(['clean', '-f', '--', input.path], root).catch(() => undefined);
        if (input.status === 'R' && input.oldPath !== undefined) {
          await runGit(['restore', '--source=HEAD', '--worktree', '--', input.oldPath], root);
        }
        return;
      }
      await runGit(['restore', '--source=HEAD', '--worktree', '--', input.path], root);
    },
  };
}

function runGit(args: readonly string[], cwd: string): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    execFile(
      'git',
      [...args],
      {
        cwd,
        timeout: GIT_RESTORE_TIMEOUT_MS,
        maxBuffer: 1024 * 1024,
        shell: false,
        env: {
          PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
          HOME: process.env.HOME ?? '',
          LANG: process.env.LANG ?? 'en_US.UTF-8',
          GIT_TERMINAL_PROMPT: '0',
        },
      },
      (error, _stdout, stderr) => {
        if (error === null) {
          resolvePromise();
          return;
        }
        const output = String(stderr ?? '').trim() || error.message;
        reject(new AppError(ErrorCode.READ_FAILED, `撤销文件失败：${output.slice(0, 500)}`));
      },
    );
  });
}
