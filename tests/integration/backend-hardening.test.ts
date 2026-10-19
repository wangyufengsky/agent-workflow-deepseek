import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createServer, type Server, type Socket } from 'node:net';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AppError,
  DEFAULT_SETTINGS,
  ErrorCode,
  nowIso,
  type FixRunStateValue,
} from '@agent-workflow/shared';
import { FixService, remoteOutcomeUnknownReason, type FixWorkspacePort, type GitPort, type OpenCodePort } from '@agent-workflow/engine';
import { createApplication, GitCliAdapter } from '../../packages/server/src/index.ts';

type App = Awaited<ReturnType<typeof createApplication>>;

function requestKey(prefix: string): string {
  return `req_${prefix}${Math.random().toString(36).slice(2, 21)}`;
}

function git(cwd: string, args: readonly string[]): string {
  return execFileSync('git', [...args], { cwd, encoding: 'utf8' }).trim();
}

function createRepo(): string {
  const root = mkdtempSync(join(tmpdir(), 'aw-hardening-repo-'));
  git(root, ['init', '-q', '-b', 'main']);
  git(root, ['config', 'user.email', 'test@example.com']);
  git(root, ['config', 'user.name', 'Test']);
  writeFileSync(join(root, 'README.md'), '# demo\n', 'utf8');
  git(root, ['add', '.']);
  git(root, ['commit', '-qm', 'init']);
  return root;
}

async function registerProject(app: App, repoRoot: string): Promise<string> {
  const project = await app.app.inject({ method: 'POST', url: '/api/projects', payload: { requestKey: requestKey('prj'), name: 'Hardening', rootPath: repoRoot } });
  assert.equal(project.statusCode, 201, project.body);
  return project.json().data.resource.project.id as string;
}

async function createTask(app: App, projectId: string): Promise<string> {
  const task = await app.app.inject({
    method: 'POST',
    url: '/api/tasks',
    payload: { requestKey: requestKey('task'), projectId, title: '加固测试', requirementText: 'R1 加固', methodId: 'method.requirement-development' },
  });
  assert.equal(task.statusCode, 201, task.body);
  return task.json().data.resource.task.id as string;
}

test('W3-12: diffPage works with and without an explicit headSha (no empty revision)', async () => {
  const repo = createRepo();
  const first = git(repo, ['rev-parse', 'HEAD']);
  writeFileSync(join(repo, 'file.txt'), 'one\n', 'utf8');
  git(repo, ['add', '.']);
  git(repo, ['commit', '-qm', 'add file']);
  const second = git(repo, ['rev-parse', 'HEAD']);
  const adapter = new GitCliAdapter(30_000, join(repo, '..', 'merge-tmp'));

  // No headSha -> working tree vs base (the call shape workspaces.diff uses).
  const workingTree = await adapter.diffPage({ repoRoot: repo, baseSha: first, path: 'file.txt' });
  assert.ok(workingTree.hunks.length > 0, 'working-tree diff must not be empty');
  assert.ok(workingTree.hunks.some((hunk) => hunk.lines.some((line) => line.kind === 'add' && line.text === 'one')));

  // Explicit headSha behaves the same for a committed change.
  const committed = await adapter.diffPage({ repoRoot: repo, baseSha: first, headSha: second, path: 'file.txt' });
  assert.equal(committed.hunks.length, workingTree.hunks.length);
  assert.equal(committed.headSha, second);

  // Uncommitted edits are included when headSha is omitted, but not when a head is pinned.
  writeFileSync(join(repo, 'file.txt'), 'one\ntwo\n', 'utf8');
  const uncommitted = await adapter.diffPage({ repoRoot: repo, baseSha: second, path: 'file.txt' });
  assert.ok(uncommitted.hunks.some((hunk) => hunk.lines.some((line) => line.kind === 'add' && line.text === 'two')));
  const pinned = await adapter.diffPage({ repoRoot: repo, baseSha: first, headSha: second, path: 'file.txt' });
  assert.ok(!pinned.hunks.some((hunk) => hunk.lines.some((line) => line.text === 'two')));
});

test('W3-13: remoteOutcomeUnknownReason keeps business failures failed and undetermined ones unknown', () => {
  assert.equal(remoteOutcomeUnknownReason(new AppError(ErrorCode.NETWORK_UNREACHABLE, 'x', { details: { reason: 'timeout' } })), 'timeout');
  assert.equal(remoteOutcomeUnknownReason(new AppError(ErrorCode.NETWORK_UNREACHABLE, 'x')), 'network_error');
  assert.equal(remoteOutcomeUnknownReason(new AppError(ErrorCode.UNSUPPORTED_FORMAT, 'x')), 'undetermined');
  assert.equal(remoteOutcomeUnknownReason(new AppError(ErrorCode.INTERNAL_ERROR, 'Command failed: git push (killed)')), 'undetermined');
  assert.equal(remoteOutcomeUnknownReason(new Error('socket hang up')), 'undetermined');
  assert.equal(remoteOutcomeUnknownReason(new Error('command timed out')), 'undetermined');
  // Definite business rejections stay failures.
  assert.equal(remoteOutcomeUnknownReason(new AppError(ErrorCode.GITLAB_AUTH_FAILED, '401')), undefined);
  assert.equal(remoteOutcomeUnknownReason(new AppError(ErrorCode.NOT_A_GIT_REPO, 'not a repo')), undefined);
  assert.equal(remoteOutcomeUnknownReason(new AppError(ErrorCode.WORKSPACE_NAME_CONFLICT, 'exists')), undefined);
  assert.equal(remoteOutcomeUnknownReason(new Error('boom')), undefined);
});

test('W3-13: git fetch settles UNKNOWN on network/undetermined failures and failed on business errors', async () => {
  // 1) Connection refused -> NETWORK_UNREACHABLE -> command unknown + RECEIPT_UNKNOWN.
  {
    const repo = createRepo();
    git(repo, ['remote', 'add', 'origin', 'http://127.0.0.1:1/repo.git']);
    const app = await createApplication({ dataDir: mkdtempSync(join(tmpdir(), 'aw-fetch-unknown-')), disableOpenCode: true, disableListen: true });
    try {
      const projectId = await registerProject(app, repo);
      const key = requestKey('fetch-network');
      const response = await app.app.inject({ method: 'POST', url: `/api/git/repos/${projectId}/fetch`, payload: { requestKey: key, projectId } });
      assert.equal(response.statusCode, 409, response.body);
      assert.equal(response.json().error.code, 'RECEIPT_UNKNOWN');
      assert.equal(response.json().error.details.outcomeUnknown, true);
      assert.equal(response.json().error.details.requestKey, key);
      assert.equal(response.json().error.details.reason, 'network_error');
      const operation = await app.app.inject({ method: 'GET', url: `/api/operations/${key}` });
      assert.equal(operation.statusCode, 200, operation.body);
      assert.equal(operation.json().data.operation.status, 'unknown');
      assert.equal(operation.json().data.operation.operation, 'git.fetch');
    } finally {
      await app.close();
    }
  }

  // 2) Hanging HTTP endpoint + low CLI timeout -> git killed -> unknown(timeout).
  {
    const sockets = new Set<Socket>();
    const server: Server = createServer((socket) => {
      sockets.add(socket);
      socket.on('close', () => sockets.delete(socket));
      // Accept and never answer: the git CLI hits its timeout.
    });
    await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', () => resolveListen()));
    const address = server.address();
    assert.ok(address !== null && typeof address === 'object');
    const repo = createRepo();
    git(repo, ['remote', 'add', 'origin', `http://127.0.0.1:${address.port}/repo.git`]);
    const app = await createApplication({
      dataDir: mkdtempSync(join(tmpdir(), 'aw-fetch-timeout-')),
      disableOpenCode: true,
      disableListen: true,
      settings: { git: { ...DEFAULT_SETTINGS.git, commandTimeoutMs: 400 } },
    });
    try {
      const projectId = await registerProject(app, repo);
      const key = requestKey('fetch-timeout');
      const response = await app.app.inject({ method: 'POST', url: `/api/git/repos/${projectId}/fetch`, payload: { requestKey: key, projectId } });
      assert.equal(response.statusCode, 409, response.body);
      assert.equal(response.json().error.code, 'RECEIPT_UNKNOWN');
      assert.equal(response.json().error.details.reason, 'timeout');
      const operation = await app.app.inject({ method: 'GET', url: `/api/operations/${key}` });
      assert.equal(operation.json().data.operation.status, 'unknown');
    } finally {
      await app.close();
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
    }
  }

  // 3) Definite business failure (origin is not a git repository) stays failed.
  {
    const repo = createRepo();
    const notARepo = mkdtempSync(join(tmpdir(), 'aw-fetch-notrepo-'));
    git(repo, ['remote', 'add', 'origin', notARepo]);
    const app = await createApplication({ dataDir: mkdtempSync(join(tmpdir(), 'aw-fetch-failed-')), disableOpenCode: true, disableListen: true });
    try {
      const projectId = await registerProject(app, repo);
      const key = requestKey('fetch-failed');
      const response = await app.app.inject({ method: 'POST', url: `/api/git/repos/${projectId}/fetch`, payload: { requestKey: key, projectId } });
      assert.notEqual(response.statusCode, 409, response.body);
      assert.notEqual(response.json().error.code, 'RECEIPT_UNKNOWN');
      const operation = await app.app.inject({ method: 'GET', url: `/api/operations/${key}` });
      assert.equal(operation.json().data.operation.status, 'failed');
    } finally {
      await app.close();
    }
  }
});

function seedFix(app: App, projectId: string, state: FixRunStateValue): string {
  const fix = app.store.fixes.create({
    projectId,
    executionId: 'exec_hardening',
    reviewRunId: 'review_hardening',
    findingIds: [],
    base: { branch: 'main', tipSha: 'a'.repeat(40), reviewedSha: 'a'.repeat(40), commitsAfterReviewed: 0 },
    fixBranch: 'fix/hardening',
    worktreeId: 'ws_hardening',
    profession: { professionId: 'role.developer', revision: 'r1', displayName: '开发' },
    verifyCommand: null,
    state,
    outcomes: [],
    steps: [{ step: 'commit', state: 'succeeded', requestKey: requestKey('fix-commit'), settledAt: nowIso(), commitSha: 'b'.repeat(40) }],
    fixRevision: 'rev_1',
    actions: {},
  });
  return fix.fixRunId;
}

function fixServiceWithPushError(app: App, pushError: Error): FixService {
  const gitPort = { push: async () => { throw pushError; } } as unknown as GitPort;
  const opencodePort = {} as unknown as OpenCodePort;
  const workspacePort: FixWorkspacePort = { restoreFile: async () => undefined };
  return new FixService({
    store: app.store,
    commands: app.engine.commands,
    context: app.engine.context,
    git: gitPort,
    opencode: opencodePort,
    workspace: workspacePort,
  });
}

test('W3-13: fix push classifies timeout/network/killed as unknown and auth as failed', async () => {
  const app = await createApplication({ dataDir: mkdtempSync(join(tmpdir(), 'aw-fix-push-')), disableOpenCode: true, disableListen: true });
  try {
    const projectId = await registerProject(app, createRepo());

    const cases: readonly { readonly pushError: AppError; readonly expected: 'unknown' | 'failed'; readonly reason?: string }[] = [
      { pushError: new AppError(ErrorCode.NETWORK_UNREACHABLE, 'timeout', { details: { reason: 'timeout' } }), expected: 'unknown', reason: 'timeout' },
      { pushError: new AppError(ErrorCode.NETWORK_UNREACHABLE, 'network down'), expected: 'unknown', reason: 'network_error' },
      { pushError: new AppError(ErrorCode.INTERNAL_ERROR, 'Command failed: git push (killed by timeout)'), expected: 'unknown', reason: 'undetermined' },
      { pushError: new AppError(ErrorCode.GITLAB_AUTH_FAILED, '401 unauthorized'), expected: 'failed' },
    ];
    for (const entry of cases) {
      const fixRunId = seedFix(app, projectId, 'ready');
      const service = fixServiceWithPushError(app, entry.pushError);
      const key = requestKey('fix-push');
      let thrown: AppError | undefined;
      await assert.rejects(
        () => service.push(projectId, fixRunId, { requestKey: key, expectedLocalSha: 'b'.repeat(40) } as never),
        (error: unknown) => {
          if (error instanceof AppError) thrown = error;
          return error instanceof AppError;
        },
      );
      const step = app.store.fixes.get(fixRunId)?.steps.find((item) => item.step === 'push');
      assert.equal(step?.state, entry.expected, `${entry.pushError.code} step`);
      const operation = await app.app.inject({ method: 'GET', url: `/api/operations/${key}` });
      assert.equal(operation.statusCode, 200, operation.body);
      assert.equal(operation.json().data.operation.status, entry.expected === 'unknown' ? 'unknown' : 'failed');
      if (entry.expected === 'unknown') {
        assert.equal(step?.error?.code, ErrorCode.RECEIPT_UNKNOWN);
        assert.equal(operation.json().data.operation.error?.code, ErrorCode.RECEIPT_UNKNOWN);
        assert.match(String(operation.json().data.operation.error?.message), /结果未明/);
      }
      if (entry.reason !== undefined) {
        // `OperationRecord.error` only persists code/message; the classified
        // reason is on the thrown AppError details (HTTP 409 envelope keeps it).
        assert.equal(thrown?.details?.reason, entry.reason);
      }
    }
  } finally {
    await app.close();
  }
});

test('W2-4c: verify_only read-only tasks deny planning actions and draft writes', async () => {
  const app = await createApplication({ dataDir: mkdtempSync(join(tmpdir(), 'aw-readonly-')), disableOpenCode: true, disableListen: true });
  try {
    const projectId = await registerProject(app, createRepo());
    const readOnlyTaskId = await createTask(app, projectId);
    app.store.tasks.update(readOnlyTaskId, { readOnly: true });
    const revisionBefore = app.store.tasks.get(readOnlyTaskId)!.requirement.revision;

    const detail = await app.app.inject({ method: 'GET', url: `/api/tasks/${readOnlyTaskId}/detail` });
    assert.equal(detail.statusCode, 200, detail.body);
    const data = detail.json().data as {
      planning: { actions: Record<string, { allowed: boolean; reasonCode?: string; reason?: string }> };
      capabilities: Record<string, { allowed: boolean; reasonCode?: string; reason?: string }>;
    };
    for (const key of ['startPlanning', 'stopPlanning', 'reconcile', 'previewNextRound']) {
      assert.equal(data.planning.actions[key]?.allowed, false, `planning.actions.${key}`);
      assert.equal(data.planning.actions[key]?.reasonCode, 'RECOVERY_READ_ONLY', `planning.actions.${key}`);
    }
    assert.equal(data.capabilities.generatePlan?.allowed, false);
    assert.equal(data.capabilities.generatePlan?.reasonCode, 'RECOVERY_READ_ONLY');

    const writeKey = requestKey('readonly-update');
    const update = await app.app.inject({
      method: 'PATCH',
      url: `/api/tasks/${readOnlyTaskId}`,
      payload: { requestKey: writeKey, requirementText: '试图修改只读任务' },
    });
    assert.equal(update.statusCode, 403, update.body);
    assert.equal(update.json().error.code, 'FORBIDDEN');
    assert.equal(update.json().error.details.reason, 'RECOVERY_READ_ONLY');
    assert.equal(app.store.tasks.get(readOnlyTaskId)!.requirement.revision, revisionBefore);
    // The guard fires before CommandService.begin, so no orphan accepted receipt exists.
    const orphan = await app.app.inject({ method: 'GET', url: `/api/operations/${writeKey}` });
    assert.equal(orphan.statusCode, 404, orphan.body);

    // Ordinary tasks are unaffected.
    const normalTaskId = await createTask(app, projectId);
    const normalKey = requestKey('normal-update');
    const normalUpdate = await app.app.inject({
      method: 'PATCH',
      url: `/api/tasks/${normalTaskId}`,
      payload: { requestKey: normalKey, requirementText: '普通任务可以修改', supplementText: '补充说明' },
    });
    assert.equal(normalUpdate.statusCode, 200, normalUpdate.body);
    assert.equal(normalUpdate.json().data.receipt.status, 'succeeded');
    assert.equal(app.store.tasks.get(normalTaskId)!.requirement.revision, 3);
  } finally {
    await app.close();
  }
});
