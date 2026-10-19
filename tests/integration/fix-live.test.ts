import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FixRun, ReviewRun } from '@agent-workflow/shared';
import { createId } from '@agent-workflow/shared';
import { createApplication } from '../../packages/server/src/index.ts';

/**
 * Live AI fix: a manually seeded review finding points at a real defect in a real
 * repository; the model edits the isolated ai-fix worktree through MCP tools.
 * Gated by AGENT_WORKFLOW_LIVE=1.
 */
const LIVE = process.env.AGENT_WORKFLOW_LIVE === '1';

function createRepo(): { root: string; head: string; parent: string } {
  const root = mkdtempSync(join(tmpdir(), 'aw-live-fix-'));
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'live@example.com'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Live Test'], { cwd: root });
  writeFileSync(join(root, 'app.ts'), `export function readName(input: { name?: string }): string {\n  return input.name?.trim() ?? '';\n}\n`, 'utf8');
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'feat: read name'], { cwd: root });
  const parent = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root }).toString().trim();
  writeFileSync(join(root, 'app.ts'), `export function readName(input: { name?: string }): string {\n  // BUG: non-null assertion crashes for missing names; do not uppercase either.\n  return input.name!.trim().toUpperCase();\n}\n`, 'utf8');
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'fix: uppercase name'], { cwd: root });
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root }).toString().trim();
  return { root, head, parent };
}

test('live: AI fix produces an isolated worktree change, commits it, then discards', { skip: !LIVE, timeout: 420_000 }, async () => {
  const repo = createRepo();
  const dataDir = mkdtempSync(join(tmpdir(), 'aw-live-fix-data-'));
  const app = await createApplication({ dataDir, port: 0, host: '127.0.0.1' });
  try {
    assert.ok(app.adapter);
    await app.adapter.ensureReady();
    const requestKey = (): string => `req_${Math.random().toString(36).slice(2, 21)}`;
    const project = await app.app.inject({ method: 'POST', url: '/api/projects', payload: { requestKey: requestKey(), name: 'Live Fix', rootPath: repo.root } });
    const projectId = project.json().data.resource.project.id as string;

    const findingId = createId('finding');
    const createdReview = app.store.reviews.create({
      projectId,
      executionId: createId('exec'),
      subject: { commitSha: repo.head, compareBase: { compareId: 'parent:0', kind: 'parent', label: '父提交', baseSha: repo.parent } },
      dimensions: ['correctness'],
      context: 'diff_only',
      profession: { professionId: 'role.reviewer', revision: 'r2', displayName: '代码审查员' },
      state: 'completed',
      startedAt: new Date().toISOString(),
      endedAt: new Date().toISOString(),
      findings: [],
      receipt: {
        operation: 'review.start',
        requestKey: requestKey(),
        bodyHash: 'seed',
        contractVersion: '1',
        status: 'succeeded',
        target: { projectId },
        acceptedAt: new Date().toISOString(),
        settledAt: new Date().toISOString(),
        auditId: createId('audit'),
      },
    });
    const reviewRunId = createdReview.reviewRunId;
    const review = app.store.reviews.get(reviewRunId)!;
    app.store.reviews.update({
      ...review,
      findings: [
        {
          findingId,
          reviewRunId,
          ordinal: 1,
          severity: 'critical',
          dimension: 'correctness',
          location: { path: 'app.ts', revision: repo.head, baseRevision: repo.parent, startLine: 3, endLine: 3, side: 'new' },
          title: 'readName 对缺失 name 使用非空断言',
          detail: 'input.name 可能为 undefined，非空断言会在运行时抛错；同时不应强制大写。',
          status: 'accepted',
        },
      ],
    });

    const start = await app.app.inject({
      method: 'POST',
      url: `/api/git/repos/${projectId}/fixes/start`,
      payload: {
        requestKey: requestKey(),
        projectId,
        reviewRunId,
        findingIds: [findingId],
        baseBranch: 'main',
        expectedBaseTip: repo.head,
        professionId: 'role.developer',
        professionRevision: 'r9',
      },
    });
    assert.equal(start.statusCode, 200, start.body);
    const started = start.json().data as { receipt: { status: string }; resource: { fix: FixRun } };
    const fixRunId = started.resource.fix.fixRunId;

    let fix: FixRun | undefined;
    for (let attempt = 0; attempt < 160; attempt += 1) {
      const read = await app.app.inject({ method: 'GET', url: `/api/git/repos/${projectId}/fixes/${fixRunId}` });
      assert.equal(read.statusCode, 200, read.body);
      fix = read.json().data.fix as FixRun;
      if (['ready', 'no_changes', 'failed', 'stopped', 'unknown'].includes(fix.state)) break;
      await new Promise((resolveWait) => setTimeout(resolveWait, 2000));
    }
    assert.ok(fix !== undefined);
    console.log('[live-fix] state:', fix.state, 'outcomes:', JSON.stringify(fix.outcomes), 'files:', JSON.stringify(fix.changes?.files?.map((file) => file.path)));
    assert.equal(fix.state, 'ready', `fix not ready: ${JSON.stringify(fix.steps)}`);
    assert.ok(fix.fixBranch.startsWith('ai-fix/'));
    assert.ok((fix.changes?.files.length ?? 0) > 0);
    assert.equal(fix.outcomes.every((outcome) => outcome.findingId === findingId), true);

    const commit = await app.app.inject({
      method: 'POST',
      url: `/api/git/repos/${projectId}/fixes/${fixRunId}/commit`,
      payload: { requestKey: requestKey(), projectId, fixRunId, message: 'fix: guard missing name', fileIds: fix.changes!.files.map((file) => file.fileId), expectedFixRevision: fix.fixRevision },
    });
    assert.equal(commit.statusCode, 200, commit.body);
    const afterCommit = commit.json().data.fix as FixRun;
    assert.ok(afterCommit.steps.some((step) => step.step === 'commit' && step.state === 'succeeded'));

    const discard = await app.app.inject({
      method: 'POST',
      url: `/api/git/repos/${projectId}/fixes/${fixRunId}/discard`,
      payload: { requestKey: requestKey(), projectId, fixRunId, confirmDiscard: true },
    });
    assert.equal(discard.statusCode, 200, discard.body);
    assert.equal(discard.json().data.fix.state, 'discarded');
    const saved = app.store.settings.getJson<{ path?: string }>(`fix.worktree.${fixRunId}`);
    assert.equal(saved, undefined);
    console.log('[live-fix] live fix PASS');
  } finally {
    await app.close();
  }
});
