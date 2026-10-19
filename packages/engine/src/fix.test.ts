import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  DiffPage,
  FileChange,
  FixCommitRequest,
  FixDiscardRequest,
  FixFileRevertRequest,
  FixMergeRequestRequest,
  FixPushRequest,
  FixRun,
  FixStartRequest,
  GitBranch,
  GitCommit,
  GitRepo,
  OperationReceipt,
  ReviewRun,
} from '@agent-workflow/shared';
import { DEFAULT_CATALOG, createId, createRequestKey, nowIso } from '@agent-workflow/shared';
import type { OpenCodeManagerStatus, OpenCodeSession, PromptOutcome } from '@agent-workflow/opencode';
import { Store } from '@agent-workflow/storage';
import { Engine } from './engine.ts';
import { FixService, type FixRemotePort, type FixWorkspacePort } from './fix.ts';
import type { GitPort, OpenCodePort, OpenCodeRunRequest, OpenCodeRunResult } from './ports.ts';
import { encodeFileId } from './workspace.ts';

/* ------------------------------------------------------------------ */
/* Fakes                                                               */
/* ------------------------------------------------------------------ */

const DEVELOPER_ROLE = DEFAULT_CATALOG.roles.find((role) => role.id === 'role.developer')!;
const TIP_SHA = 'a'.repeat(40);
const COMMIT_SHA = 'd'.repeat(40);

class FakeGit implements GitPort {
  branchList: readonly GitBranch[] = [];
  changeSets: Array<{ files: readonly FileChange[]; changesRevision: string }> = [];
  createdWorktrees: Array<{ taskId: string; branch: string; baseSha: string; worktreesRoot: string }> = [];
  removedWorktrees: Array<{ worktreePath: string; branch?: string; deleteBranch: boolean }> = [];
  commitCalls: Array<{ worktreePath: string; filePaths: readonly string[]; message: string; expectedHeadSha?: string; author: { name: string; email: string } }> = [];
  pushCalls: Array<{ localSha: string; remote: string; remoteRef: string }> = [];
  listCommitsCalls: Array<{ ref?: string; limit?: number }> = [];
  worktreeRoot = mkdtempSync(join(tmpdir(), 'aw-fix-wt-'));
  commitSha = COMMIT_SHA;

  async detect(): Promise<{ gitState: GitRepo['gitState']; defaultBranch?: string }> {
    return { gitState: 'git', defaultBranch: 'main' };
  }

  async status(): Promise<GitRepo['status'] | undefined> {
    return {
      head: { kind: 'branch', branch: 'main', sha: TIP_SHA },
      workingTree: { uncommitted: 0, staged: 0, untracked: 0 },
      isEmpty: false,
    };
  }

  async listCommits(input: { ref?: string; limit?: number }): Promise<{ commits: readonly GitCommit[]; nextCursor?: string }> {
    this.listCommitsCalls.push(input);
    return { commits: [] };
  }

  async commitShow(): Promise<GitCommit | undefined> {
    return undefined;
  }

  async diffFiles(): Promise<readonly FileChange[]> {
    return [];
  }

  async diffPage(): Promise<DiffPage> {
    return { fileId: 'file_x', ignoreWhitespace: false, hunks: [] };
  }

  async branches(): Promise<readonly GitBranch[]> {
    return this.branchList;
  }

  async createWorktree(input: { taskId: string; branch: string; baseSha: string; worktreesRoot: string }): Promise<{ path: string; handle: string; branch: string; headSha: string }> {
    this.createdWorktrees.push(input);
    return {
      path: join(this.worktreeRoot, input.taskId),
      handle: `wt_${input.taskId}`,
      branch: input.branch,
      headSha: input.baseSha,
    };
  }

  async removeWorktree(input: { worktreePath: string; branch?: string; deleteBranch: boolean }): Promise<void> {
    this.removedWorktrees.push(input);
  }

  async worktreeChangedFiles(): Promise<{ files: readonly FileChange[]; changesRevision: string }> {
    return this.changeSets.shift() ?? { files: [], changesRevision: 'empty' };
  }

  async commit(input: { worktreePath: string; filePaths: readonly string[]; message: string; expectedHeadSha?: string; author: { name: string; email: string } }): Promise<{ sha: string }> {
    this.commitCalls.push(input);
    return { sha: this.commitSha };
  }

  async push(input: { localSha: string; remote: string; remoteRef: string }): Promise<{ remoteRef: string; pushedSha: string; created: boolean }> {
    this.pushCalls.push(input);
    return { remoteRef: input.remoteRef, pushedSha: input.localSha, created: true };
  }
}

class FakeOpenCode implements OpenCodePort {
  requests: OpenCodeRunRequest[] = [];
  aborted: string[] = [];
  outcome: PromptOutcome = { idle: true, timedOut: false, assistantText: '', messages: [] };
  hold = false;
  #release: ((outcome: PromptOutcome) => void) | undefined;
  #seq = 0;

  status(): OpenCodeManagerStatus {
    return { state: 'ready', version: '1.19.0' };
  }

  async ensureReady(): Promise<void> {
    return;
  }

  async runSession(request: OpenCodeRunRequest): Promise<OpenCodeRunResult> {
    this.requests.push(request);
    this.#seq += 1;
    const sessionId = `fix_session_${this.#seq}`;
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
    this.#release?.({ idle: false, timedOut: false, error: '会话已被中止', assistantText: '', messages: [] });
  }

  async findSessions(): Promise<readonly OpenCodeSession[]> {
    return [];
  }
}

class FakeWorkspace implements FixWorkspacePort {
  calls: Array<{ worktreePath: string; path: string; status: string; oldPath?: string }> = [];

  async restoreFile(input: { worktreePath: string; path: string; status: string; oldPath?: string }): Promise<void> {
    this.calls.push(input);
  }
}

class FakeRemote implements FixRemotePort {
  calls: Array<{ projectId: string; input: { sourceBranch: string; targetBranch: string; title: string; description: string } }> = [];

  async createMergeRequest(projectId: string, input: { sourceBranch: string; targetBranch: string; title: string; description: string }): Promise<{ iid: number; webUrl: string }> {
    this.calls.push({ projectId, input });
    return { iid: 7, webUrl: 'https://example.test/mr/7' };
  }
}

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

function file(path: string, status: FileChange['status'] = 'M'): FileChange {
  return {
    fileId: encodeFileId(path),
    status,
    path,
    binary: false,
    additions: 2,
    deletions: 1,
    sizeClass: 'normal',
    versionRef: `v_${path}`,
  };
}

function reviewReceipt(projectId: string): OperationReceipt {
  return {
    operation: 'review.start',
    requestKey: createRequestKey(),
    bodyHash: 'hash',
    contractVersion: '1',
    status: 'succeeded',
    target: { projectId, ref: TIP_SHA },
    acceptedAt: nowIso(),
    settledAt: nowIso(),
    auditId: createId('audit'),
  };
}

interface Harness {
  readonly store: Store;
  readonly git: FakeGit;
  readonly opencode: FakeOpenCode;
  readonly workspace: FakeWorkspace;
  readonly remote: FakeRemote;
  readonly service: FixService;
  readonly projectId: string;
  readonly review: ReviewRun;
  readonly findingIds: readonly string[];
}

function harness(): Harness {
  const dataDir = mkdtempSync(join(tmpdir(), 'aw-fix-test-'));
  const store = new Store({ dataDir });
  const project = store.projects.create({
    name: 'Demo',
    rootPath: mkdtempSync(join(tmpdir(), 'aw-fix-repo-')),
    gitState: 'git',
    defaultBranch: 'main',
    settings: { testCommand: 'npm test' },
  });
  const git = new FakeGit();
  git.branchList = [
    { name: 'main', fullRef: 'refs/heads/main', kind: 'local', tipSha: TIP_SHA, isCurrent: true, checkedOutInUserWorktree: true, protected: false },
  ];
  const opencode = new FakeOpenCode();
  const workspace = new FakeWorkspace();
  const remote = new FakeRemote();
  const engine = new Engine({
    store,
    ports: { git, opencode },
    integration: { opencodeReady: () => true, gitlabConfigured: () => true },
  });
  const service = new FixService({
    store,
    commands: engine.commands,
    context: engine.context,
    git,
    opencode,
    catalog: DEFAULT_CATALOG,
    workspace,
    remote,
    timeoutMs: 1_000,
  });

  const review = store.reviews.create({
    projectId: project.id,
    executionId: createId('exec'),
    subject: {
      commitSha: TIP_SHA,
      compareBase: { compareId: 'parent:0', kind: 'parent', label: '对比父提交', baseSha: 'b'.repeat(40) },
    },
    dimensions: ['correctness'],
    context: 'diff_only',
    profession: { professionId: DEVELOPER_ROLE.id, revision: DEVELOPER_ROLE.revision, displayName: DEVELOPER_ROLE.name },
    state: 'completed',
    startedAt: nowIso(),
    endedAt: nowIso(),
    findings: [],
    receipt: reviewReceipt(project.id),
  });
  const findingIds = [createId('find'), createId('find')];
  const findings = findingIds.map((findingId, index) => ({
    findingId,
    reviewRunId: review.reviewRunId,
    ordinal: index + 1,
    severity: 'major' as const,
    dimension: 'correctness' as const,
    location: {
      path: 'src/a.ts',
      revision: TIP_SHA,
      baseRevision: 'b'.repeat(40),
      startLine: 10 + index,
      endLine: 10 + index,
      side: 'new' as const,
    },
    title: `问题 ${index + 1}`,
    detail: `问题说明 ${index + 1}`,
    status: 'open' as const,
  }));
  store.reviews.update({ ...review, findings });
  return {
    store,
    git,
    opencode,
    workspace,
    remote,
    service,
    projectId: project.id,
    review: store.reviews.get(review.reviewRunId)!,
    findingIds,
  };
}

function fixStart(projectId: string, reviewRunId: string, findingIds: readonly string[], overrides: Partial<FixStartRequest> = {}): FixStartRequest {
  return {
    requestKey: createRequestKey(),
    projectId,
    reviewRunId,
    findingIds: [...findingIds],
    baseBranch: 'main',
    expectedBaseTip: TIP_SHA,
    professionId: DEVELOPER_ROLE.id,
    professionRevision: DEVELOPER_ROLE.revision,
    ...overrides,
  };
}

function outcomesJson(findingIds: readonly string[], extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    summary: '修复了空输入判断',
    outcomes: findingIds.map((findingId, index) => ({
      findingId,
      outcome: index === 0 ? 'fixed' : 'partial',
      relocation: 'exact',
      reason: '已补充判空',
    })),
    verification: { state: 'passed', passed: 4, summary: '4 passed' },
    ...extra,
  });
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

function settledFix(store: Store, fixRunId: string): FixRun | undefined {
  const fix = store.fixes.get(fixRunId);
  if (fix === undefined) return undefined;
  return ['ready', 'no_changes', 'failed', 'stopped', 'unknown', 'discarded'].includes(fix.state) ? fix : undefined;
}

/* ------------------------------------------------------------------ */
/* Tests                                                               */
/* ------------------------------------------------------------------ */

test('fix start runs in an ai-fix worktree, records authoritative changes, and commits/pushes/MR step by step', async () => {
  const h = harness();
  try {
    h.git.changeSets = [{ files: [file('src/a.ts')], changesRevision: 'rev_1' }];
    h.opencode.outcome = { idle: true, timedOut: false, assistantText: outcomesJson(h.findingIds), messages: [] };

    const started = await h.service.start(h.projectId, fixStart(h.projectId, h.review.reviewRunId, h.findingIds));
    assert.equal(started.receipt.operation, 'fix.start');
    assert.equal(started.receipt.status, 'accepted');
    const fixRunId = started.resource!.fix.fixRunId;

    const ready = await waitFor(() => {
      const fix = h.store.fixes.get(fixRunId);
      return fix?.state === 'ready' ? fix : undefined;
    }, 'fix ready');
    assert.equal(ready.changes?.files.length, 1);
    assert.equal(ready.changes?.worktreeRevision, 'rev_1');
    assert.equal(ready.outcomes.length, 2);
    assert.equal(ready.outcomes[0]?.outcome, 'fixed');
    assert.equal(ready.outcomes[1]?.outcome, 'partial');
    assert.equal(ready.verification?.state, 'passed');
    assert.match(ready.verification?.summary ?? '', /^模型自报：/);
    assert.match(ready.commitDraft?.message ?? '', /^fix: 修复审查问题/);
    assert.equal(ready.base.commitsAfterReviewed, 0);
    assert.equal(ready.verifyCommand?.display, 'npm test');
    assert.match(ready.fixBranch, /^ai-fix\/[0-9a-f]{7}-\d{4}$/);
    assert.equal(h.git.createdWorktrees.length, 1);
    assert.equal(h.git.createdWorktrees[0]?.taskId, fixRunId);
    assert.equal(h.opencode.requests[0]?.permission, 'workspace_write');
    assert.match(h.opencode.requests[0]?.prompt ?? '', new RegExp(`taskId 参数：固定填写 ${fixRunId}`));
    const bind = h.store.settings.getJson<{ path: string; branch: string }>(`fix.worktree.${fixRunId}`);
    assert.ok(bind !== undefined);
    assert.equal(bind.branch, ready.fixBranch);

    const linked = h.store.reviews.get(h.review.reviewRunId)!;
    assert.equal(linked.findings[0]?.fix?.fixRunId, fixRunId);
    assert.equal(linked.findings[0]?.fix?.outcome, 'fixed');

    const fileId = ready.changes!.files[0]!.fileId;
    const commitInput: FixCommitRequest = {
      requestKey: createRequestKey(),
      projectId: h.projectId,
      fixRunId,
      message: 'fix: 空输入',
      fileIds: [fileId],
      expectedFixRevision: ready.fixRevision,
    };
    const committed = await h.service.commit(h.projectId, fixRunId, commitInput);
    assert.equal(committed.receipt.status, 'succeeded');
    assert.equal(h.git.commitCalls.length, 1);
    assert.deepEqual(h.git.commitCalls[0]?.filePaths, ['src/a.ts']);
    assert.equal(h.git.commitCalls[0]?.expectedHeadSha, TIP_SHA);
    const commitStep = committed.resource?.fix.steps.find((step) => step.step === 'commit');
    assert.equal(commitStep?.state, 'succeeded');
    assert.equal(commitStep?.commitSha, COMMIT_SHA);

    const pushInput: FixPushRequest = {
      requestKey: createRequestKey(),
      projectId: h.projectId,
      fixRunId,
      expectedLocalSha: COMMIT_SHA,
    };
    const pushed = await h.service.push(h.projectId, fixRunId, pushInput);
    assert.equal(pushed.receipt.status, 'succeeded');
    assert.equal(h.git.pushCalls.length, 1);
    assert.equal(h.git.pushCalls[0]?.remoteRef, `refs/heads/${ready.fixBranch}`);
    assert.equal(h.git.pushCalls[0]?.remote, 'origin');
    const pushStep = pushed.resource?.fix.steps.find((step) => step.step === 'push');
    assert.equal(pushStep?.state, 'succeeded');

    const mrInput: FixMergeRequestRequest = {
      requestKey: createRequestKey(),
      projectId: h.projectId,
      fixRunId,
      targetBranch: 'main',
      title: '修复：空输入',
      description: '由 AI 修复',
    };
    const mr = await h.service.createMergeRequest(h.projectId, fixRunId, mrInput);
    assert.equal(mr.receipt.status, 'succeeded');
    assert.equal(h.remote.calls.length, 1);
    assert.equal(h.remote.calls[0]?.input.sourceBranch, ready.fixBranch);
    const mrStep = mr.resource?.fix.steps.find((step) => step.step === 'mergeRequest');
    assert.equal(mrStep?.state, 'succeeded');
    assert.equal(mrStep?.mrIid, 7);

    const discardInput: FixDiscardRequest = {
      requestKey: createRequestKey(),
      projectId: h.projectId,
      fixRunId,
      confirmDiscard: true,
    };
    const discarded = await h.service.discard(h.projectId, fixRunId, discardInput);
    assert.equal(discarded.receipt.status, 'succeeded');
    assert.equal(discarded.resource?.fix.state, 'discarded');
    assert.equal(h.git.removedWorktrees.length, 1);
    assert.equal(h.git.removedWorktrees[0]?.deleteBranch, true);
    assert.equal(h.store.settings.getJson(`fix.worktree.${fixRunId}`), undefined);
  } finally {
    h.store.close();
  }
});

test('fix start rejects a stale base tip', async () => {
  const h = harness();
  try {
    await assert.rejects(
      h.service.start(h.projectId, fixStart(h.projectId, h.review.reviewRunId, h.findingIds, { expectedBaseTip: 'c'.repeat(40) })),
      (error: unknown) => (error as { code?: string }).code === 'STALE_TARGET',
    );
    assert.equal(h.git.createdWorktrees.length, 0);
  } finally {
    h.store.close();
  }
});

test('fix with no changes settles as no_changes and refuses commit', async () => {
  const h = harness();
  try {
    h.git.changeSets = [{ files: [], changesRevision: 'rev_0' }];
    h.opencode.outcome = { idle: true, timedOut: false, assistantText: outcomesJson(h.findingIds), messages: [] };
    const started = await h.service.start(h.projectId, fixStart(h.projectId, h.review.reviewRunId, h.findingIds));
    const fixRunId = started.resource!.fix.fixRunId;
    const fix = await waitFor(() => {
      const current = h.store.fixes.get(fixRunId);
      return current?.state === 'no_changes' ? current : undefined;
    }, 'no_changes');
    assert.equal(fix.changes?.files.length, 0);
    await assert.rejects(
      h.service.commit(h.projectId, fixRunId, {
        requestKey: createRequestKey(),
        projectId: h.projectId,
        fixRunId,
        message: 'fix',
        fileIds: [encodeFileId('src/a.ts')],
        expectedFixRevision: fix.fixRevision,
      }),
      (error: unknown) => (error as { code?: string }).code === 'FIX_NO_CHANGES',
    );
  } finally {
    h.store.close();
  }
});

test('fix without strict JSON outcomes fails explicitly', async () => {
  const h = harness();
  try {
    h.git.changeSets = [{ files: [file('src/a.ts')], changesRevision: 'rev_1' }];
    h.opencode.outcome = { idle: true, timedOut: false, assistantText: '已经修好了', messages: [] };
    const started = await h.service.start(h.projectId, fixStart(h.projectId, h.review.reviewRunId, h.findingIds));
    const fix = await waitFor(() => {
      const current = h.store.fixes.get(started.resource!.fix.fixRunId);
      return current?.state === 'failed' ? current : undefined;
    }, 'failed');
    assert.equal(fix.outcomes.length, 0);
    assert.equal(fix.changes, undefined);
  } finally {
    h.store.close();
  }
});

test('fix file revert restores one file and recomputes the authoritative change set', async () => {
  const h = harness();
  try {
    h.git.changeSets = [
      { files: [file('src/a.ts'), file('src/b.ts')], changesRevision: 'rev_1' },
      { files: [file('src/b.ts')], changesRevision: 'rev_2' },
      { files: [], changesRevision: 'rev_3' },
    ];
    h.opencode.outcome = { idle: true, timedOut: false, assistantText: outcomesJson(h.findingIds), messages: [] };
    const started = await h.service.start(h.projectId, fixStart(h.projectId, h.review.reviewRunId, h.findingIds));
    const fixRunId = started.resource!.fix.fixRunId;
    const ready = await waitFor(() => {
      const fix = h.store.fixes.get(fixRunId);
      return fix?.state === 'ready' && fix.changes?.files.length === 2 ? fix : undefined;
    }, 'ready with 2 files');

    const revert: FixFileRevertRequest = {
      requestKey: createRequestKey(),
      projectId: h.projectId,
      fixRunId,
      fileId: ready.changes!.files[0]!.fileId,
      expectedFixRevision: ready.fixRevision,
    };
    const first = await h.service.revertFile(h.projectId, fixRunId, revert);
    assert.equal(first.receipt.status, 'succeeded');
    assert.equal(h.workspace.calls.length, 1);
    assert.equal(h.workspace.calls[0]?.path, 'src/a.ts');
    const afterFirst = first.resource!.fix;
    assert.equal(afterFirst.changes?.files.length, 1);
    assert.equal(afterFirst.state, 'ready');
    assert.notEqual(afterFirst.fixRevision, ready.fixRevision);

    const second = await h.service.revertFile(h.projectId, fixRunId, {
      requestKey: createRequestKey(),
      projectId: h.projectId,
      fixRunId,
      fileId: afterFirst.changes!.files[0]!.fileId,
      expectedFixRevision: afterFirst.fixRevision,
    });
    assert.equal(second.resource?.fix.state, 'no_changes');
  } finally {
    h.store.close();
  }
});

test('fix rejects a second active run on the same base branch', async () => {
  const h = harness();
  try {
    h.opencode.hold = true;
    const started = await h.service.start(h.projectId, fixStart(h.projectId, h.review.reviewRunId, [h.findingIds[0]!]));
    await waitFor(() => (h.opencode.requests.length === 1 ? true : undefined), 'dispatch');
    await assert.rejects(
      h.service.start(h.projectId, fixStart(h.projectId, h.review.reviewRunId, [h.findingIds[1]!])),
      (error: unknown) => (error as { code?: string }).code === 'OPERATION_IN_PROGRESS',
    );
    const fixRunId = started.resource!.fix.fixRunId;
    await h.service.stop(h.projectId, fixRunId, { requestKey: createRequestKey() });
    const stopped = await waitFor(() => {
      const fix = h.store.fixes.get(fixRunId);
      return fix?.state === 'stopped' ? fix : undefined;
    }, 'stopped');
    assert.equal(stopped.state, 'stopped');
    assert.deepEqual(h.opencode.aborted, ['fix_session_1']);
  } finally {
    h.store.close();
  }
});
