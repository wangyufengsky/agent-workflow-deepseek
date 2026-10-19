import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import type {
  DiffPage,
  FileChange,
  GitBranch,
  GitCommit,
  GitRepo,
  OperationReceipt,
  ReviewRun,
} from '@agent-workflow/shared';
import { DEFAULT_CATALOG, createId, createRequestKey, nowIso } from '@agent-workflow/shared';
import type { OpenCodeManagerStatus, OpenCodeSession, PromptOutcome } from '@agent-workflow/opencode';
import { Store } from '@agent-workflow/storage';
import { Engine, encodeFileId, findingStatusRevision, type FixWorkspacePort } from '@agent-workflow/engine';
import type { GitPort, OpenCodePort, OpenCodeRunRequest, OpenCodeRunResult } from '@agent-workflow/engine';
import { registerErrorHandler } from '../../packages/server/src/http.ts';
import { registerReviewRoutes } from '../../packages/server/src/review-plugin.ts';

/* ------------------------------------------------------------------ */
/* Fakes                                                               */
/* ------------------------------------------------------------------ */

const TIP_SHA = 'a'.repeat(40);
const BASE_SHA = 'b'.repeat(40);
const COMMIT_SHA = 'c'.repeat(40);
const REVIEWER_ROLE = DEFAULT_CATALOG.roles.find((role) => role.id === 'role.reviewer')!;
const DEVELOPER_ROLE = DEFAULT_CATALOG.roles.find((role) => role.id === 'role.developer')!;

const CHANGED_FILE: FileChange = {
  fileId: encodeFileId('src/a.ts'),
  status: 'M',
  path: 'src/a.ts',
  binary: false,
  additions: 2,
  deletions: 1,
  sizeClass: 'normal',
  versionRef: 'v1',
};

class FakeGit implements GitPort {
  changes: readonly FileChange[] = [CHANGED_FILE];
  page: DiffPage = {
    fileId: CHANGED_FILE.fileId,
    ignoreWhitespace: false,
    hunks: [
      {
        hunkId: 'h1',
        header: '@@ -10,3 +10,4 @@',
        oldStart: 10,
        oldLines: 3,
        newStart: 10,
        newLines: 4,
        lines: [
          { kind: 'context', oldLine: 10, newLine: 10, anchorId: 'ctx:10', text: 'start' },
          { kind: 'add', newLine: 11, anchorId: 'new:11', text: 'added line' },
        ],
      },
    ],
  };
  commitCalls = 0;
  pushCalls = 0;
  removedWorktrees = 0;
  worktreeRoot = mkdtempSync(join(tmpdir(), 'aw-int-wt-'));

  async detect(): Promise<{ gitState: GitRepo['gitState']; defaultBranch?: string }> {
    return { gitState: 'git', defaultBranch: 'main' };
  }

  async status(): Promise<GitRepo['status'] | undefined> {
    return { head: { kind: 'branch', branch: 'main', sha: COMMIT_SHA }, workingTree: { uncommitted: 0, staged: 0, untracked: 0 }, isEmpty: false };
  }

  async listCommits(): Promise<{ commits: readonly GitCommit[] }> {
    return { commits: [] };
  }

  async commitShow(): Promise<GitCommit> {
    return {
      sha: COMMIT_SHA,
      parents: [BASE_SHA],
      subject: 'feat: demo',
      author: { name: 'Dev', email: 'dev@example.com', initials: 'D' },
      authoredAt: '2026-01-02T00:00:00.000Z',
      refs: [],
      body: '',
      committer: { name: 'Dev', email: 'dev@example.com', initials: 'D' },
      committedAt: '2026-01-02T00:00:00.000Z',
      containedIn: { branches: ['main'], truncated: false },
      stats: { files: 1, additions: 2, deletions: 1 },
      compareOptions: [{ compareId: 'parent:0', kind: 'parent', label: '对比父提交', baseSha: BASE_SHA }],
    };
  }

  async diffFiles(): Promise<readonly FileChange[]> {
    return this.changes;
  }

  async diffPage(): Promise<DiffPage> {
    return this.page;
  }

  async branches(): Promise<readonly GitBranch[]> {
    return [{ name: 'main', fullRef: 'refs/heads/main', kind: 'local', tipSha: TIP_SHA, isCurrent: true, checkedOutInUserWorktree: true, protected: false }];
  }

  async createWorktree(input: { taskId: string; branch: string; baseSha: string }): Promise<{ path: string; handle: string; branch: string; headSha: string }> {
    return { path: join(this.worktreeRoot, input.taskId), handle: `wt_${input.taskId}`, branch: input.branch, headSha: input.baseSha };
  }

  async removeWorktree(): Promise<void> {
    this.removedWorktrees += 1;
  }

  async worktreeChangedFiles(): Promise<{ files: readonly FileChange[]; changesRevision: string }> {
    return { files: this.changes, changesRevision: 'rev_1' };
  }

  async commit(): Promise<{ sha: string }> {
    this.commitCalls += 1;
    return { sha: 'e'.repeat(40) };
  }

  async push(input: { localSha: string; remoteRef: string }): Promise<{ remoteRef: string; pushedSha: string; created: boolean }> {
    this.pushCalls += 1;
    return { remoteRef: input.remoteRef, pushedSha: input.localSha, created: true };
  }
}

class FakeOpenCode implements OpenCodePort {
  requests: OpenCodeRunRequest[] = [];
  outcome: PromptOutcome = { idle: true, timedOut: false, assistantText: '{}', messages: [] };

  status(): OpenCodeManagerStatus {
    return { state: 'ready' };
  }

  async ensureReady(): Promise<void> {
    return;
  }

  async runSession(request: OpenCodeRunRequest): Promise<OpenCodeRunResult> {
    this.requests.push(request);
    return { sessionId: 'session_1', outcome: this.outcome };
  }

  async abortSession(): Promise<void> {
    return;
  }

  async findSessions(): Promise<readonly OpenCodeSession[]> {
    return [];
  }
}

class FakeWorkspace implements FixWorkspacePort {
  calls = 0;
  async restoreFile(): Promise<void> {
    this.calls += 1;
  }
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function reviewReceipt(projectId: string): OperationReceipt {
  return {
    operation: 'review.start',
    requestKey: createRequestKey(),
    bodyHash: 'hash',
    contractVersion: '1',
    status: 'succeeded',
    target: { projectId, ref: COMMIT_SHA },
    acceptedAt: nowIso(),
    settledAt: nowIso(),
    auditId: createId('audit'),
  };
}

function seedReview(store: Store, projectId: string) {
  const review = store.reviews.create({
    projectId,
    executionId: createId('exec'),
    subject: { commitSha: COMMIT_SHA, compareBase: { compareId: 'parent:0', kind: 'parent', label: '对比父提交', baseSha: BASE_SHA } },
    dimensions: ['correctness'],
    context: 'diff_only',
    profession: { professionId: DEVELOPER_ROLE.id, revision: DEVELOPER_ROLE.revision, displayName: DEVELOPER_ROLE.name },
    state: 'completed',
    startedAt: nowIso(),
    endedAt: nowIso(),
    findings: [],
    receipt: reviewReceipt(projectId),
  });
  const findingId = createId('find');
  store.reviews.update({
    ...review,
    findings: [
      {
        findingId,
        reviewRunId: review.reviewRunId,
        ordinal: 1,
        severity: 'major',
        dimension: 'correctness',
        location: { path: 'src/a.ts', revision: COMMIT_SHA, baseRevision: BASE_SHA, startLine: 10, endLine: 11, side: 'new' },
        title: '空输入未处理',
        detail: '传入 null 时继续执行。',
        status: 'open',
      },
    ],
  });
  return { review: store.reviews.get(review.reviewRunId)!, findingId };
}

async function waitFor<T>(check: () => Promise<T | undefined> | T | undefined, label: string, timeoutMs = 3_000): Promise<T> {
  const started = Date.now();
  for (;;) {
    const value = await check();
    if (value !== undefined) return value;
    if (Date.now() - started > timeoutMs) throw new Error(`等待超时：${label}`);
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 10));
  }
}

/* ------------------------------------------------------------------ */
/* Tests                                                               */
/* ------------------------------------------------------------------ */

test('review/fix HTTP surface: start, read, findings, diff, commit, push, discard', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'aw-int-data-'));
  const store = new Store({ dataDir });
  const git = new FakeGit();
  const opencode = new FakeOpenCode();
  const workspace = new FakeWorkspace();
  const project = store.projects.create({ name: 'Demo', rootPath: mkdtempSync(join(tmpdir(), 'aw-int-repo-')), gitState: 'git', defaultBranch: 'main' });
  const seeded = seedReview(store, project.id);
  const engine = new Engine({ store, ports: { git, opencode }, integration: { opencodeReady: () => true, gitlabConfigured: () => true } });
  const app = Fastify({ logger: false });
  registerErrorHandler(app);
  registerReviewRoutes(app, { engine, store, workspace });
  try {
    /* ---- review start + read ---- */
    opencode.outcome = {
      idle: true,
      timedOut: false,
      messages: [],
      assistantText: JSON.stringify({
        summary: '一个边界问题',
        findings: [
          { severity: 'major', dimension: 'correctness', path: 'src/a.ts', startLine: 11, endLine: 11, side: 'new', title: '边界未处理', detail: '需判空' },
        ],
      }),
    };
    const start = await app.inject({
      method: 'POST',
      url: `/api/git/repos/${project.id}/reviews/start`,
      payload: {
        requestKey: createRequestKey(),
        projectId: project.id,
        sha: COMMIT_SHA,
        compareId: 'parent:0',
        dimensions: ['correctness'],
        context: 'diff_only',
        professionId: REVIEWER_ROLE.id,
        professionRevision: REVIEWER_ROLE.revision,
      },
    });
    assert.equal(start.statusCode, 200, start.body);
    const startedBody = start.json() as { data: { receipt: OperationReceipt; resource: { review: ReviewRun } } };
    assert.equal(startedBody.data.receipt.operation, 'review.start');
    assert.equal(startedBody.data.receipt.status, 'accepted');
    const reviewRunId = startedBody.data.resource.review.reviewRunId;

    const completed = await waitFor(() => {
      const review = store.reviews.get(reviewRunId);
      return review?.state === 'completed' ? review : undefined;
    }, 'review completed');
    assert.equal(completed.findings.length, 1);

    const read = await app.inject({ method: 'GET', url: `/api/git/repos/${project.id}/reviews/${reviewRunId}` });
    assert.equal(read.statusCode, 200, read.body);
    const readBody = read.json() as { data: { review: ReviewRun } };
    assert.equal(readBody.data.review.findings[0]?.title, '边界未处理');

    const list = await app.inject({ method: 'GET', url: `/api/git/repos/${project.id}/reviews` });
    assert.equal(list.statusCode, 200, list.body);
    assert.equal((list.json() as { data: { reviews: ReviewRun[] } }).data.reviews.length, 2);

    /* ---- finding update + stale CAS ---- */
    const finding = readBody.data.review.findings[0]!;
    const revision = findingStatusRevision(readBody.data.review);
    const findingUpdate = await app.inject({
      method: 'POST',
      url: `/api/git/repos/${project.id}/findings/${finding.findingId}`,
      payload: { requestKey: createRequestKey(), projectId: project.id, findingId: finding.findingId, status: 'accepted', expectedStatusRevision: revision },
    });
    assert.equal(findingUpdate.statusCode, 200, findingUpdate.body);
    assert.equal((findingUpdate.json() as { data: { receipt: OperationReceipt } }).data.receipt.status, 'succeeded');

    const stale = await app.inject({
      method: 'POST',
      url: `/api/git/repos/${project.id}/findings/${finding.findingId}`,
      payload: { requestKey: createRequestKey(), projectId: project.id, findingId: finding.findingId, status: 'dismissed', expectedStatusRevision: revision },
    });
    assert.equal(stale.statusCode, 409, stale.body);
    assert.equal((stale.json() as { error: { code: string } }).error.code, 'STALE_TARGET');

    /* ---- fix start + read + diff + commit + push + discard ---- */
    opencode.outcome = {
      idle: true,
      timedOut: false,
      messages: [],
      assistantText: JSON.stringify({
        summary: '补充判空',
        outcomes: [{ findingId: seeded.findingId, outcome: 'fixed', relocation: 'exact', reason: '已判空' }],
      }),
    };
    const fixStart = await app.inject({
      method: 'POST',
      url: `/api/git/repos/${project.id}/fixes/start`,
      payload: {
        requestKey: createRequestKey(),
        projectId: project.id,
        reviewRunId: seeded.review.reviewRunId,
        findingIds: [seeded.findingId],
        baseBranch: 'main',
        expectedBaseTip: TIP_SHA,
        professionId: DEVELOPER_ROLE.id,
        professionRevision: DEVELOPER_ROLE.revision,
      },
    });
    assert.equal(fixStart.statusCode, 200, fixStart.body);
    const fixStarted = fixStart.json() as { data: { receipt: OperationReceipt; resource: { fix: { fixRunId: string } } } };
    assert.equal(fixStarted.data.receipt.status, 'accepted');
    const fixRunId = fixStarted.data.resource.fix.fixRunId;

    const ready = await waitFor(() => {
      const fix = store.fixes.get(fixRunId);
      return fix?.state === 'ready' ? fix : undefined;
    }, 'fix ready');

    const readFix = await app.inject({ method: 'GET', url: `/api/git/repos/${project.id}/fixes/${fixRunId}` });
    assert.equal(readFix.statusCode, 200, readFix.body);

    const diff = await app.inject({ method: 'GET', url: `/api/git/repos/${project.id}/fixes/${fixRunId}/diff?path=src%2Fa.ts&ignoreWhitespace=0` });
    assert.equal(diff.statusCode, 200, diff.body);
    assert.equal((diff.json() as { data: { diff: DiffPage } }).data.diff.hunks.length, 1);

    const fileId = ready.changes!.files[0]!.fileId;
    const commit = await app.inject({
      method: 'POST',
      url: `/api/git/repos/${project.id}/fixes/${fixRunId}/commit`,
      payload: {
        requestKey: createRequestKey(),
        projectId: project.id,
        fixRunId,
        message: 'fix: 判空',
        fileIds: [fileId],
        expectedFixRevision: ready.fixRevision,
      },
    });
    assert.equal(commit.statusCode, 200, commit.body);
    assert.equal((commit.json() as { data: { receipt: OperationReceipt } }).data.receipt.status, 'succeeded');
    // The contract is {receipt, resource:{fix}}; the fix is also flattened for clients that read top level.
    const flatFix = (commit.json() as { data: { fix?: { fixRunId: string }; resource?: { fix: { fixRunId: string } } } }).data;
    assert.equal(flatFix.fix?.fixRunId, fixRunId);
    assert.equal(flatFix.resource?.fix.fixRunId, fixRunId);
    assert.equal(git.commitCalls, 1);

    const push = await app.inject({
      method: 'POST',
      url: `/api/git/repos/${project.id}/fixes/${fixRunId}/push`,
      payload: { requestKey: createRequestKey(), projectId: project.id, fixRunId, expectedLocalSha: 'e'.repeat(40) },
    });
    assert.equal(push.statusCode, 200, push.body);
    assert.equal(git.pushCalls, 1);

    const discard = await app.inject({
      method: 'POST',
      url: `/api/git/repos/${project.id}/fixes/${fixRunId}/discard`,
      payload: { requestKey: createRequestKey(), projectId: project.id, fixRunId, confirmDiscard: true },
    });
    assert.equal(discard.statusCode, 200, discard.body);
    assert.equal((discard.json() as { data: { resource: { fix: { state: string } } } }).data.resource.fix.state, 'discarded');
    assert.equal(git.removedWorktrees, 1);
  } finally {
    await app.close();
    store.close();
  }
});

test('review/fix HTTP validation maps to shared error codes', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'aw-int-data-'));
  const store = new Store({ dataDir });
  const git = new FakeGit();
  const opencode = new FakeOpenCode();
  const project = store.projects.create({ name: 'Demo', rootPath: mkdtempSync(join(tmpdir(), 'aw-int-repo-')), gitState: 'git', defaultBranch: 'main' });
  const seeded = seedReview(store, project.id);
  const engine = new Engine({ store, ports: { git, opencode }, integration: { opencodeReady: () => true, gitlabConfigured: () => false } });
  const app = Fastify({ logger: false });
  registerErrorHandler(app);
  registerReviewRoutes(app, { engine, store, workspace: new FakeWorkspace() });
  try {
    const invalid = await app.inject({
      method: 'POST',
      url: `/api/git/repos/${project.id}/reviews/start`,
      payload: {
        requestKey: createRequestKey(),
        projectId: project.id,
        sha: COMMIT_SHA,
        compareId: 'parent:0',
        dimensions: ['nonsense'],
        context: 'diff_only',
        professionId: REVIEWER_ROLE.id,
        professionRevision: REVIEWER_ROLE.revision,
      },
    });
    assert.equal(invalid.statusCode, 400, invalid.body);
    assert.equal((invalid.json() as { error: { code: string } }).error.code, 'VALIDATION_FAILED');

    const missingKey = await app.inject({
      method: 'POST',
      url: `/api/git/repos/${project.id}/fixes/${'fix_missing'}/stop`,
      payload: { projectId: project.id },
    });
    assert.equal(missingKey.statusCode, 400, missingKey.body);

    const notFound = await app.inject({ method: 'GET', url: `/api/git/repos/${project.id}/reviews/review_missing` });
    assert.equal(notFound.statusCode, 404, notFound.body);
    assert.equal((notFound.json() as { error: { code: string } }).error.code, 'NOT_FOUND');

    const stopCompleted = await app.inject({
      method: 'POST',
      url: `/api/git/repos/${project.id}/reviews/${seeded.review.reviewRunId}/stop`,
      payload: { requestKey: createRequestKey(), projectId: project.id },
    });
    assert.equal(stopCompleted.statusCode, 400, stopCompleted.body);
    assert.equal((stopCompleted.json() as { error: { code: string } }).error.code, 'VALIDATION_FAILED');
  } finally {
    await app.close();
    store.close();
  }
});
