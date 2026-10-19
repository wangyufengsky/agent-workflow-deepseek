import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createId, createRequestKey, nowIso } from '@agent-workflow/shared';
import { createApplication } from '../../packages/server/src/index.ts';

function createRepo(): string {
  const root = mkdtempSync(join(tmpdir(), 'aw-recovery-'));
  return root;
}

test('startup recovery marks interrupted reviews/fixes unknown and settles their receipts', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'aw-recovery-data-'));
  const repo = createRepo();
  const first = await createApplication({ dataDir, disableOpenCode: true, disableListen: true });
  try {
    const project = first.store.projects.create({
      name: 'Recovery',
      rootPath: repo,
      gitState: 'git',
      defaultBranch: 'main',
      settings: {},
    });
    const projectId = project.id;
    const reviewKey = createRequestKey();
    first.store.operations.accept({ requestKey: reviewKey, operation: 'review.start', bodyHash: 'h1', contractVersion: '1', target: { projectId } });
    first.store.reviews.create({
      projectId,
      executionId: createId('exec'),
      subject: { commitSha: 'a'.repeat(40), compareBase: { compareId: 'parent:0', kind: 'parent', label: '父提交', baseSha: 'b'.repeat(40) } },
      dimensions: ['correctness'],
      context: 'diff_only',
      profession: { professionId: 'role.reviewer', revision: 'r2', displayName: '代码审查员' },
      state: 'running',
      startedAt: nowIso(),
      findings: [],
      receipt: {
        operation: 'review.start',
        requestKey: reviewKey,
        bodyHash: 'h1',
        contractVersion: '1',
        status: 'accepted',
        target: { projectId },
        acceptedAt: nowIso(),
        auditId: createId('audit'),
      },
    });

    const fixKey = createRequestKey();
    first.store.operations.accept({ requestKey: fixKey, operation: 'fix.start', bodyHash: 'h2', contractVersion: '1', target: { projectId } });
    const fix = first.store.fixes.create({
      projectId,
      executionId: createId('exec'),
      reviewRunId: createId('review'),
      findingIds: [],
      base: { branch: 'main', tipSha: 'a'.repeat(40), reviewedSha: 'a'.repeat(40), commitsAfterReviewed: 0 },
      fixBranch: 'ai-fix/aaaaaaa-0101',
      worktreeId: 'wt_interrupted',
      profession: { professionId: 'role.developer', revision: 'r9', displayName: '开发工程师' },
      verifyCommand: null,
      state: 'editing',
      outcomes: [],
      steps: [],
      fixRevision: '1',
      actions: {},
    });
    first.store.settings.putJson(`fix.worktree.${fix.fixRunId}`, {
      path: join(dataDir, 'worktrees', fix.fixRunId),
      branch: fix.fixBranch,
      baseSha: 'a'.repeat(40),
      createdAt: nowIso(),
      startRequestKey: fixKey,
    });
  } finally {
    await first.close();
  }

  const second = await createApplication({ dataDir, disableOpenCode: true, disableListen: true });
  try {
    const projects = second.store.projects.list();
    assert.equal(projects.length, 1);
    const projectId = projects[0]!.id;
    const reviews = second.store.reviews.listByProject(projectId);
    assert.equal(reviews.length, 1);
    assert.equal(reviews[0]!.state, 'unknown');
    assert.equal(reviews[0]!.receipt.status, 'unknown');
    assert.equal(reviews[0]!.receipt.error?.code, 'INTERNAL_ERROR');
    assert.equal(second.store.operations.get(reviews[0]!.receipt.requestKey)?.status, 'unknown');

    const fixes = second.store.fixes.listByProject(projectId);
    assert.equal(fixes.length, 1);
    assert.equal(fixes[0]!.state, 'unknown');
    const mapping = second.store.settings.getJson<{ startRequestKey?: string }>(`fix.worktree.${fixes[0]!.fixRunId}`);
    assert.ok(mapping?.startRequestKey !== undefined);
    assert.equal(second.store.operations.get(mapping.startRequestKey!)?.status, 'unknown');
  } finally {
    await second.close();
  }
});
