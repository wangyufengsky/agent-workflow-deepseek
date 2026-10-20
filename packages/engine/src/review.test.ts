import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  DiffPage,
  FileChange,
  GitBranch,
  GitCommit,
  GitCompareBase,
  GitRepo,
  ReviewFindingUpdateRequest,
  ReviewRun,
  ReviewStartRequest,
} from '@agent-workflow/shared';
import { DEFAULT_CATALOG, createRequestKey } from '@agent-workflow/shared';
import type { OpenCodeManagerStatus, OpenCodeSession, PromptOutcome } from '@agent-workflow/opencode';
import { Store } from '@agent-workflow/storage';
import { Engine } from './engine.ts';
import type { GitPort, OpenCodePort, OpenCodeRunRequest, OpenCodeRunResult } from './ports.ts';
import { ReviewService, extractJsonObject, findingStatusRevision } from './review.ts';
import { encodeFileId } from './workspace.ts';

/* ------------------------------------------------------------------ */
/* Fakes                                                               */
/* ------------------------------------------------------------------ */

const REVIEWER_ROLE = DEFAULT_CATALOG.roles.find((role) => role.id === 'role.reviewer')!;

class FakeGit implements GitPort {
  commits = new Map<string, GitCommit>();
  files: readonly FileChange[] = [];
  pages = new Map<string, DiffPage>();
  branchList: readonly GitBranch[] = [];
  diffPageCalls: string[] = [];

  async detect(): Promise<{ gitState: GitRepo['gitState']; defaultBranch?: string }> {
    return { gitState: 'git', defaultBranch: 'main' };
  }

  async status(): Promise<GitRepo['status'] | undefined> {
    return {
      head: { kind: 'branch', branch: 'main', sha: 'a'.repeat(40) },
      workingTree: { uncommitted: 0, staged: 0, untracked: 0 },
      isEmpty: false,
    };
  }

  async listCommits(): Promise<{ commits: readonly GitCommit[]; nextCursor?: string }> {
    return { commits: [...this.commits.values()] };
  }

  async commitShow(_rootPath: string, sha: string): Promise<GitCommit | undefined> {
    return this.commits.get(sha);
  }

  async diffFiles(): Promise<readonly FileChange[]> {
    return this.files;
  }

  async diffPage(input: { path: string }): Promise<DiffPage> {
    this.diffPageCalls.push(input.path);
    return this.pages.get(input.path) ?? { fileId: encodeFileId(input.path), ignoreWhitespace: false, hunks: [] };
  }

  async branches(): Promise<readonly GitBranch[]> {
    return this.branchList;
  }

  async createWorktree(): Promise<{ path: string; handle: string; branch: string; headSha: string }> {
    throw new Error('not used in review tests');
  }

  async removeWorktree(): Promise<void> {
    throw new Error('not used in review tests');
  }

  async worktreeChangedFiles(): Promise<{ files: readonly FileChange[]; changesRevision: string }> {
    throw new Error('not used in review tests');
  }

  async commit(): Promise<{ sha: string }> {
    throw new Error('not used in review tests');
  }

  async push(): Promise<{ remoteRef: string; pushedSha: string; created: boolean }> {
    throw new Error('not used in review tests');
  }
}

class FakeOpenCode implements OpenCodePort {
  requests: OpenCodeRunRequest[] = [];
  aborted: string[] = [];
  outcome: PromptOutcome = idleOutcome('');
  hold = false;
  #release: ((outcome: PromptOutcome) => void) | undefined;
  #sessionSeq = 0;

  status(): OpenCodeManagerStatus {
    return { state: 'ready', version: '1.19.0' };
  }

  async ensureReady(): Promise<void> {
    return;
  }

  async runSession(request: OpenCodeRunRequest): Promise<OpenCodeRunResult> {
    this.requests.push(request);
    this.#sessionSeq += 1;
    const sessionId = `session_${this.#sessionSeq}`;
    request.onSessionId?.(sessionId);
    if (this.hold) {
      return new Promise<OpenCodeRunResult>((resolvePromise) => {
        this.#release = (outcome) => {
          resolvePromise({ sessionId, outcome });
        };
      });
    }
    return { sessionId, outcome: this.outcome };
  }

  async abortSession(sessionId: string): Promise<void> {
    this.aborted.push(sessionId);
    this.#release?.(abortOutcome());
  }

  async findSessions(): Promise<readonly OpenCodeSession[]> {
    return [];
  }
}

function idleOutcome(text: string): PromptOutcome {
  return { idle: true, timedOut: false, assistantText: text, messages: [] };
}

function abortOutcome(): PromptOutcome {
  return { idle: false, timedOut: false, error: '会话已被中止', assistantText: '', messages: [] };
}

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

const BASE_SHA = 'b'.repeat(40);
const COMMIT_SHA = 'a'.repeat(40);
const COMPARE: GitCompareBase = { compareId: 'parent:0', kind: 'parent', label: '对比父提交', baseSha: BASE_SHA };
const FILE: FileChange = {
  fileId: encodeFileId('src/a.ts'),
  status: 'M',
  path: 'src/a.ts',
  binary: false,
  additions: 3,
  deletions: 1,
  sizeClass: 'normal',
  versionRef: 'v1',
};

function commitFixture(): GitCommit {
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
    stats: { files: 1, additions: 3, deletions: 1 },
    compareOptions: [COMPARE],
  };
}

function pageFixture(): DiffPage {
  return {
    fileId: FILE.fileId,
    baseSha: BASE_SHA,
    headSha: COMMIT_SHA,
    ignoreWhitespace: false,
    hunks: [
      {
        hunkId: 'h1',
        header: '@@ -10,5 +10,6 @@',
        oldStart: 10,
        oldLines: 5,
        newStart: 10,
        newLines: 6,
        lines: [
          { kind: 'context', oldLine: 10, newLine: 10, anchorId: 'ctx:10', text: 'function demo(input) {' },
          { kind: 'add', newLine: 11, anchorId: 'new:11', text: '  if (input === null) {' },
          { kind: 'add', newLine: 12, anchorId: 'new:12', text: '    throw new Error("empty");' },
          { kind: 'add', newLine: 13, anchorId: 'new:13', text: '  }' },
        ],
      },
    ],
  };
}

function reviewStart(overrides: Partial<ReviewStartRequest> = {}): ReviewStartRequest {
  return {
    requestKey: createRequestKey(),
    projectId: '',
    sha: COMMIT_SHA,
    compareId: COMPARE.compareId,
    dimensions: ['correctness', 'security', 'quality'],
    context: 'diff_only',
    professionId: REVIEWER_ROLE.id,
    professionRevision: REVIEWER_ROLE.revision,
    ...overrides,
  };
}

interface Harness {
  readonly store: Store;
  readonly git: FakeGit;
  readonly opencode: FakeOpenCode;
  readonly service: ReviewService;
  readonly projectId: string;
  readonly dataDir: string;
}

function harness(): Harness {
  const dataDir = mkdtempSync(join(tmpdir(), 'aw-review-test-'));
  const store = new Store({ dataDir });
  const project = store.projects.create({ name: 'Demo', rootPath: mkdtempSync(join(tmpdir(), 'aw-review-repo-')), gitState: 'git', defaultBranch: 'main' });
  const git = new FakeGit();
  git.commits.set(COMMIT_SHA, commitFixture());
  git.files = [FILE];
  git.pages.set(FILE.path, pageFixture());
  git.branchList = [
    { name: 'main', fullRef: 'refs/heads/main', kind: 'local', tipSha: COMMIT_SHA, isCurrent: true, checkedOutInUserWorktree: true, protected: false },
  ];
  const opencode = new FakeOpenCode();
  const engine = new Engine({
    store,
    ports: { git, opencode },
    integration: { opencodeReady: () => true, gitlabConfigured: () => false },
  });
  const service = new ReviewService({
    store,
    commands: engine.commands,
    context: engine.context,
    git,
    opencode,
    catalog: DEFAULT_CATALOG,
    timeoutMs: 1_000,
  });
  return { store, git, opencode, service, projectId: project.id, dataDir };
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

function terminal(store: Store, reviewRunId: string): ReviewRun | undefined {
  const review = store.reviews.get(reviewRunId);
  if (review === undefined) return undefined;
  return ['completed', 'failed', 'stopped', 'unknown'].includes(review.state) ? review : undefined;
}

/* ------------------------------------------------------------------ */
/* Tests                                                               */
/* ------------------------------------------------------------------ */

test('review start completes with validated findings and drops illegal ones', async () => {
  const h = harness();
  try {
    h.opencode.outcome = idleOutcome(
      JSON.stringify({
        summary: '发现 1 个问题',
        findings: [
          { severity: 'major', dimension: 'correctness', path: 'src/a.ts', startLine: 11, endLine: 12, side: 'new', title: '空输入未处理', detail: '传 null 会继续执行。', suggestion: '--- a/src/a.ts\n+++ b/src/a.ts\n@@ -11,1 +11,1 @@\n-  return input.length;\n+  return input === null ? 0 : input.length;' },
          { severity: 'major', dimension: 'correctness', path: 'src/other.ts', startLine: 1, endLine: 2, side: 'new', title: '越界文件', detail: '不在 diff 内。' },
          { severity: 'nonsense', dimension: 'correctness', path: 'src/a.ts', startLine: 11, endLine: 11, side: 'new', title: '非法严重度', detail: '应丢弃。' },
          { severity: 'suggestion', dimension: 'quality', title: '补充注释', detail: '可补充说明。' },
        ],
      }),
    );
    const input = reviewStart({ projectId: h.projectId });
    const response = await h.service.start(h.projectId, input);
    assert.equal(response.receipt.operation, 'review.start');
    assert.equal(response.receipt.status, 'accepted');
    const review = response.resource?.review;
    assert.ok(review !== undefined);
    assert.ok(['queued', 'running'].includes(review.state), review.state);

    const done = await waitFor(() => terminal(h.store, review.reviewRunId), 'review terminal');
    assert.equal(done.state, 'completed');
    assert.equal(done.findings.length, 2, JSON.stringify(done.findings));
    assert.equal(done.findings[0]?.severity, 'major');
    assert.deepEqual(done.findings[0]?.location, {
      path: 'src/a.ts',
      revision: COMMIT_SHA,
      baseRevision: BASE_SHA,
      startLine: 11,
      endLine: 12,
      side: 'new',
    });
    assert.equal(done.findings[0]?.status, 'open');
    assert.equal(done.findings[1]?.location, undefined);
    const suggestion = (done.findings[0] as unknown as { suggestion?: { format: string; patch: string; appliesTo: string } }).suggestion;
    assert.equal(suggestion?.format, 'unified_patch');
    assert.match(suggestion?.patch ?? '', /\+  return input === null/);
    assert.equal(suggestion?.appliesTo, COMMIT_SHA);
    assert.equal(done.summary?.countsBySeverity.major, 1);
    assert.equal(done.summary?.countsBySeverity.suggestion, 1);
    assert.equal(done.summary?.countsByDimension.correctness, 1);
    assert.match(done.summary?.text ?? '', /丢弃了 2 条/);
    assert.equal(done.receipt.status, 'succeeded');
    assert.equal(done.profession.displayName, REVIEWER_ROLE.name);

    const request = h.opencode.requests[0];
    assert.ok(request !== undefined);
    assert.equal(request.kind, 'review');
    assert.equal(request.permission, 'read_only');
    assert.equal(request.model.id, 'reviewer-go-flash');
    assert.match(request.prompt, /src\/a\.ts/);

    const events = h.store.events.replay(0, 500).filter((event) => event.type === 'review.changed');
    const lastPayload = events.at(-1)?.payload as { state?: string; reviewRunId?: string } | undefined;
    assert.equal(lastPayload?.state, 'completed');
    assert.equal(lastPayload?.reviewRunId, review.reviewRunId);

    // Replaying the same request key returns the same run and does not dispatch again.
    const replay = await h.service.start(h.projectId, input);
    assert.equal(replay.resource?.review.reviewRunId, review.reviewRunId);
    assert.equal(h.opencode.requests.length, 1);
  } finally {
    h.store.close();
  }
});

test('review finding status update uses the status revision for optimistic concurrency', async () => {
  const h = harness();
  try {
    h.opencode.outcome = idleOutcome(
      JSON.stringify({
        summary: 'ok',
        findings: [
          { severity: 'major', dimension: 'correctness', path: 'src/a.ts', startLine: 11, endLine: 11, side: 'new', title: '问题 A', detail: '说明 A' },
        ],
      }),
    );
    const created = await h.service.start(h.projectId, reviewStart({ projectId: h.projectId }));
    const review = await waitFor(() => terminal(h.store, created.resource!.review.reviewRunId), 'completed');
    const finding = review.findings[0]!;
    const revision = findingStatusRevision(review);

    const accepted: ReviewFindingUpdateRequest = {
      requestKey: createRequestKey(),
      projectId: h.projectId,
      findingId: finding.findingId,
      status: 'accepted',
      reason: '确认需要修复',
      expectedStatusRevision: revision,
    };
    const first = await h.service.updateFinding(h.projectId, finding.findingId, accepted);
    assert.equal(first.receipt.status, 'succeeded');
    const nextRevision = first.receipt.outcome?.statusRevision;
    assert.equal(typeof nextRevision, 'string');
    assert.notEqual(nextRevision, revision);

    const after = h.store.reviews.get(review.reviewRunId)!;
    assert.equal(after.findings[0]?.status, 'accepted');
    assert.equal(after.findings[0]?.statusReason, '确认需要修复');

    await assert.rejects(
      h.service.updateFinding(h.projectId, finding.findingId, { ...accepted, requestKey: createRequestKey(), status: 'dismissed' }),
      (error: unknown) => (error as { code?: string }).code === 'STALE_TARGET',
    );

    const noCas = await h.service.updateFinding(h.projectId, finding.findingId, {
      requestKey: createRequestKey(),
      projectId: h.projectId,
      findingId: finding.findingId,
      status: 'open',
    });
    assert.equal(noCas.receipt.status, 'succeeded');
    assert.equal(h.store.reviews.get(review.reviewRunId)?.findings[0]?.status, 'open');
  } finally {
    h.store.close();
  }
});

test('review stop requests stopping and settles as stopped after the session ends', async () => {
  const h = harness();
  try {
    h.opencode.hold = true;
    const started = await h.service.start(h.projectId, reviewStart({ projectId: h.projectId }));
    const reviewRunId = started.resource!.review.reviewRunId;
    await waitFor(() => (h.opencode.requests.length === 1 ? true : undefined), 'dispatch');

    const stop = await h.service.stop(h.projectId, reviewRunId, { requestKey: createRequestKey() });
    assert.equal(stop.receipt.operation, 'review.stop');
    assert.deepEqual(h.opencode.aborted, ['session_1']);

    const stopped = await waitFor(() => {
      const review = h.store.reviews.get(reviewRunId);
      return review?.state === 'stopped' ? review : undefined;
    }, 'stopped');
    assert.equal(stopped.stage, 'stopped');
    assert.equal(stopped.receipt.status, 'succeeded');
    assert.deepEqual(stopped.receipt.outcome, { stopped: true });
  } finally {
    h.store.close();
  }
});

test('review without model JSON fails explicitly instead of inventing findings', async () => {
  const h = harness();
  try {
    h.opencode.outcome = idleOutcome('我认为代码没什么问题。');
    const created = await h.service.start(h.projectId, reviewStart({ projectId: h.projectId }));
    const review = await waitFor(() => terminal(h.store, created.resource!.review.reviewRunId), 'failed');
    assert.equal(review.state, 'failed');
    assert.equal(review.findings.length, 0);
    assert.equal(review.receipt.status, 'failed');
    assert.equal(review.receipt.error?.code, 'VALIDATION_FAILED');
    // 失败保留失败前最后一个真实阶段（此处已进入汇总），供界面显示「停在哪个阶段」。
    assert.equal(review.stage, 'summarizing');
  } finally {
    h.store.close();
  }
});

test('review timeout settles as unknown and never reports success', async () => {
  const h = harness();
  try {
    h.opencode.outcome = { idle: false, timedOut: true, assistantText: '', messages: [] };
    const created = await h.service.start(h.projectId, reviewStart({ projectId: h.projectId }));
    const review = await waitFor(() => terminal(h.store, created.resource!.review.reviewRunId), 'unknown');
    assert.equal(review.state, 'unknown');
    assert.equal(review.receipt.status, 'unknown');
    assert.equal(review.findings.length, 0);
  } finally {
    h.store.close();
  }
});

test('review of an empty diff completes without calling the model', async () => {
  const h = harness();
  try {
    h.git.files = [];
    const created = await h.service.start(h.projectId, reviewStart({ projectId: h.projectId }));
    const review = await waitFor(() => terminal(h.store, created.resource!.review.reviewRunId), 'completed');
    assert.equal(review.state, 'completed');
    assert.equal(review.findings.length, 0);
    assert.equal(h.opencode.requests.length, 0);
    assert.match(review.summary?.text ?? '', /没有文本改动/);
  } finally {
    h.store.close();
  }
});

test('extractJsonObject tolerates fences but rejects prose without JSON', () => {
  assert.deepEqual(extractJsonObject('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(extractJsonObject('前缀 {"a":{"b":2}} 后缀'), { a: { b: 2 } });
  assert.equal(extractJsonObject('没有 JSON'), undefined);
  assert.equal(extractJsonObject('{ broken'), undefined);
});
