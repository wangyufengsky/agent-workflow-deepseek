import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import type { FixRun, OperationReceipt, ReviewRun } from '@agent-workflow/shared';
import { DEFAULT_CATALOG, DEFAULT_SETTINGS, createId, createRequestKey, mergeSettings, nowIso } from '@agent-workflow/shared';
import type { OpenCodeManagerStatus, OpenCodeSession, PromptOutcome } from '@agent-workflow/opencode';
import { Store } from '@agent-workflow/storage';
import { Engine } from '@agent-workflow/engine';
import type { OpenCodePort, OpenCodeRunRequest, OpenCodeRunResult } from '@agent-workflow/engine';
import { GitCliAdapter } from '../../packages/server/src/index.ts';
import { registerErrorHandler } from '../../packages/server/src/http.ts';
import { registerReviewRoutes } from '../../packages/server/src/review-plugin.ts';

const DEVELOPER_ROLE = DEFAULT_CATALOG.roles.find((role) => role.id === 'role.developer')!;

function createRepo(): string {
  const root = mkdtempSync(join(tmpdir(), 'aw-fixgit-repo-'));
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: root });
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'src', 'a.ts'), 'export function read(input: string | null) { return input!.trim(); }\n', 'utf8');
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'init'], { cwd: root });
  return root;
}

/** Simulates the model writing files through workspace.file.write. */
class WritingOpenCode implements OpenCodePort {
  requests: OpenCodeRunRequest[] = [];
  readonly #write: (worktreePath: string) => void;
  readonly #outcome: PromptOutcome;

  constructor(write: (worktreePath: string) => void, outcome: PromptOutcome) {
    this.#write = write;
    this.#outcome = outcome;
  }

  status(): OpenCodeManagerStatus {
    return { state: 'ready' };
  }

  async ensureReady(): Promise<void> {
    return;
  }

  async runSession(request: OpenCodeRunRequest): Promise<OpenCodeRunResult> {
    this.requests.push(request);
    this.#write(request.cwd);
    return { sessionId: `session_${this.requests.length}`, outcome: this.#outcome };
  }

  async abortSession(): Promise<void> {
    return;
  }

  async findSessions(): Promise<readonly OpenCodeSession[]> {
    return [];
  }
}

function reviewReceipt(projectId: string, sha: string): OperationReceipt {
  return {
    operation: 'review.start',
    requestKey: createRequestKey(),
    bodyHash: 'hash',
    contractVersion: '1',
    status: 'succeeded',
    target: { projectId, ref: sha },
    acceptedAt: nowIso(),
    settledAt: nowIso(),
    auditId: createId('audit'),
  };
}

function seedReview(store: Store, projectId: string, sha: string): { review: ReviewRun; findingId: string } {
  const review = store.reviews.create({
    projectId,
    executionId: createId('exec'),
    subject: { commitSha: sha, compareBase: { compareId: 'parent:0', kind: 'parent', label: '对比父提交', baseSha: sha } },
    dimensions: ['correctness'],
    context: 'diff_only',
    profession: { professionId: DEVELOPER_ROLE.id, revision: DEVELOPER_ROLE.revision, displayName: DEVELOPER_ROLE.name },
    state: 'completed',
    startedAt: nowIso(),
    endedAt: nowIso(),
    findings: [],
    receipt: reviewReceipt(projectId, sha),
  });
  const findingId = createId('find');
  store.reviews.update({
    ...review,
    findings: [
      {
        findingId,
        reviewRunId: review.reviewRunId,
        ordinal: 1,
        severity: 'blocker',
        dimension: 'correctness',
        location: { path: 'src/a.ts', revision: sha, baseRevision: sha, startLine: 1, endLine: 1, side: 'new' },
        title: '未判空',
        detail: '传入 null 时会抛错。',
        status: 'open',
      },
    ],
  });
  return { review: store.reviews.get(review.reviewRunId)!, findingId };
}

async function waitFor<T>(check: () => Promise<T | undefined> | T | undefined, label: string, timeoutMs = 5_000): Promise<T> {
  const started = Date.now();
  for (;;) {
    const value = await check();
    if (value !== undefined) return value;
    if (Date.now() - started > timeoutMs) throw new Error(`等待超时：${label}`);
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 20));
  }
}

function outcomeText(findingId: string): string {
  return JSON.stringify({
    summary: '补充判空',
    outcomes: [{ findingId, outcome: 'fixed', relocation: 'exact', reason: '已判空' }],
  });
}

test('real Git: fix worktree isolation, revert via git restore, commit, and discard', async () => {
  const repoRoot = createRepo();
  const headSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot }).toString().trim();
  const dataDir = mkdtempSync(join(tmpdir(), 'aw-fixgit-data-'));
  const store = new Store({ dataDir });
  // Keep worktrees in a temp root so the test never touches the repository data dir.
  store.settings.saveSettings(mergeSettings(DEFAULT_SETTINGS, { git: { worktreeRoot: mkdtempSync(join(tmpdir(), 'aw-fixgit-wt-')) } }));
  const project = store.projects.create({
    name: 'Fix Git Demo',
    rootPath: repoRoot,
    gitState: 'git',
    defaultBranch: 'main',
    settings: { testCommand: 'npm test' },
  });
  const seeded = seedReview(store, project.id, headSha);

  const git = new GitCliAdapter(30_000, mkdtempSync(join(tmpdir(), 'aw-fixgit-merge-')));
  let mode: 'two' | 'one' = 'two';
  const opencode = new WritingOpenCode((worktreePath) => {
    mkdirSync(join(worktreePath, 'src'), { recursive: true });
    if (mode === 'two') writeFileSync(join(worktreePath, 'src', 'b.ts'), 'export const b = 2;\n', 'utf8');
    writeFileSync(join(worktreePath, 'src', 'a.ts'), 'export function read(input: string | null) {\n  if (input === null) return "";\n  return input.trim();\n}\n', 'utf8');
  }, { idle: true, timedOut: false, messages: [], assistantText: outcomeText(seeded.findingId) });

  const engine = new Engine({ store, ports: { git, opencode }, integration: { opencodeReady: () => true, gitlabConfigured: () => false } });
  const app = Fastify({ logger: false });
  registerErrorHandler(app);
  registerReviewRoutes(app, { engine, store });

  const projectHead = (): string => execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot }).toString().trim();
  const projectStatus = (): string => execFileSync('git', ['status', '--porcelain'], { cwd: repoRoot }).toString().trim();
  const startFix = async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/api/git/repos/${project.id}/fixes/start`,
      payload: {
        requestKey: createRequestKey(),
        projectId: project.id,
        reviewRunId: seeded.review.reviewRunId,
        findingIds: [seeded.findingId],
        baseBranch: 'main',
        expectedBaseTip: headSha,
        professionId: DEVELOPER_ROLE.id,
        professionRevision: DEVELOPER_ROLE.revision,
      },
    });
    assert.equal(response.statusCode, 200, response.body);
    return (response.json() as { data: { receipt: OperationReceipt; resource: { fix: FixRun } } }).data.resource.fix;
  };

  try {
    /* ---- first run: two files, revert both ---- */
    mode = 'two';
    const first = await startFix();
    const ready = await waitFor(() => {
      const fix = store.fixes.get(first.fixRunId);
      return fix?.state === 'ready' && fix.changes?.files.length === 2 ? fix : undefined;
    }, 'first fix ready');
    assert.match(ready.fixBranch, /^ai-fix\//);
    assert.ok(ready.changes!.files.some((file) => file.path === 'src/a.ts' && file.status === 'M'));
    assert.ok(ready.changes!.files.some((file) => file.path === 'src/b.ts' && file.status === 'A'));
    const bind = store.settings.getJson<{ path: string; branch: string }>(`fix.worktree.${ready.fixRunId}`);
    assert.ok(bind !== undefined, '修复 worktree 根必须持久化到 settings');
    assert.ok(existsSync(bind.path), '修复 worktree 必须真实存在');
    assert.equal(projectStatus(), '', '用户工作区不得有改动');
    assert.equal(projectHead(), headSha, '用户工作区 HEAD 不得移动');

    for (const path of ['src/a.ts', 'src/b.ts']) {
      const fix = store.fixes.get(ready.fixRunId)!;
      const file = fix.changes!.files.find((item) => item.path === path)!;
      const revert = await app.inject({
        method: 'POST',
        url: `/api/git/repos/${project.id}/fixes/${fix.fixRunId}/files/${encodeURIComponent(file.fileId)}/revert`,
        payload: { requestKey: createRequestKey(), projectId: project.id, fixRunId: fix.fixRunId, fileId: file.fileId, expectedFixRevision: fix.fixRevision },
      });
      assert.equal(revert.statusCode, 200, revert.body);
      assert.equal((revert.json() as { data: { receipt: OperationReceipt } }).data.receipt.status, 'succeeded');
    }
    const reverted = store.fixes.get(ready.fixRunId)!;
    assert.equal(reverted.state, 'no_changes');
    assert.equal(reverted.changes?.files.length, 0);
    assert.equal(execFileSync('git', ['status', '--porcelain'], { cwd: bind.path }).toString().trim(), '', '撤销后修复副本必须干净');
    assert.equal(projectStatus(), '');
    assert.equal(projectHead(), headSha);

    /* ---- second run: commit then discard ---- */
    mode = 'one';
    const second = await startFix();
    const readySecond = await waitFor(() => {
      const fix = store.fixes.get(second.fixRunId);
      return fix?.state === 'ready' ? fix : undefined;
    }, 'second fix ready');
    const secondBind = store.settings.getJson<{ path: string }>(`fix.worktree.${readySecond.fixRunId}`);
    assert.ok(secondBind !== undefined);
    assert.ok(existsSync(secondBind.path));
    const file = readySecond.changes!.files[0]!;
    const commit = await app.inject({
      method: 'POST',
      url: `/api/git/repos/${project.id}/fixes/${readySecond.fixRunId}/commit`,
      payload: {
        requestKey: createRequestKey(),
        projectId: project.id,
        fixRunId: readySecond.fixRunId,
        message: 'fix: 判空',
        fileIds: [file.fileId],
        expectedFixRevision: readySecond.fixRevision,
      },
    });
    assert.equal(commit.statusCode, 200, commit.body);
    const commitBody = commit.json() as { data: { receipt: OperationReceipt; resource: { fix: FixRun } } };
    assert.equal(commitBody.data.receipt.status, 'succeeded');
    const commitStep = commitBody.data.resource.fix.steps.find((step) => step.step === 'commit');
    assert.ok(commitStep?.commitSha !== undefined);
    assert.equal(
      execFileSync('git', ['log', '-1', '--format=%s'], { cwd: secondBind.path }).toString().trim(),
      'fix: 判空',
      '提交必须发生在修复 worktree',
    );
    assert.equal(projectHead(), headSha, '用户工作区 HEAD 不得移动');

    const discard = await app.inject({
      method: 'POST',
      url: `/api/git/repos/${project.id}/fixes/${readySecond.fixRunId}/discard`,
      payload: { requestKey: createRequestKey(), projectId: project.id, fixRunId: readySecond.fixRunId, confirmDiscard: true },
    });
    assert.equal(discard.statusCode, 200, discard.body);
    assert.equal((discard.json() as { data: { resource: { fix: FixRun } } }).data.resource.fix.state, 'discarded');
    assert.equal(existsSync(secondBind.path), false, '放弃后删除修复 worktree');
    assert.equal(store.settings.getJson(`fix.worktree.${readySecond.fixRunId}`), undefined);
    const branches = await git.branches(repoRoot);
    assert.equal(branches.some((branch) => branch.name === readySecond.fixBranch), false, '放弃后删除本地修复分支');
    assert.equal(projectHead(), headSha);
    assert.equal(projectStatus(), '');
  } finally {
    await app.close();
    store.close();
  }
});
