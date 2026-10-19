import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createId } from '@agent-workflow/shared';
import { createApplication } from '../../packages/server/src/index.ts';

function requestKey(prefix: string): string {
  return `req_${prefix}${Math.random().toString(36).slice(2, 21)}`;
}

function createRepo(): { root: string; parent: string; head: string } {
  const root = mkdtempSync(join(tmpdir(), 'aw-review-proj-'));
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: root });
  writeFileSync(join(root, 'app.ts'), 'export const value = 1;\n', 'utf8');
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'init'], { cwd: root });
  const parent = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root }).toString().trim();
  writeFileSync(join(root, 'app.ts'), 'export const value = 2;\n', 'utf8');
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'change'], { cwd: root });
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root }).toString().trim();
  return { root, parent, head };
}

test('Git read views project stored reviews onto commits, files and repo summary', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'aw-review-proj-data-'));
  const repo = createRepo();
  const app = await createApplication({ dataDir, disableOpenCode: true, disableListen: true });
  try {
    const project = await app.app.inject({ method: 'POST', url: '/api/projects', payload: { requestKey: requestKey('prj'), name: 'Review Projection', rootPath: repo.root } });
    const projectId = project.json().data.resource.project.id as string;
    const findingId = createId('finding');
    const created = app.store.reviews.create({
      projectId,
      executionId: createId('exec'),
      subject: { commitSha: repo.head, compareBase: { compareId: 'parent:0', kind: 'parent', label: '父提交', baseSha: repo.parent } },
      dimensions: ['correctness'],
      context: 'diff_only',
      profession: { professionId: 'role.reviewer', revision: 'r2', displayName: '代码审查员' },
      state: 'completed',
      findings: [],
      receipt: {
        operation: 'review.start',
        requestKey: requestKey('review'),
        bodyHash: 'seed',
        contractVersion: '1',
        status: 'succeeded',
        target: { projectId },
        acceptedAt: new Date().toISOString(),
        settledAt: new Date().toISOString(),
        auditId: createId('audit'),
      },
    });
    app.store.reviews.update({
      ...app.store.reviews.get(created.reviewRunId)!,
      findings: [
        {
          findingId,
          reviewRunId: created.reviewRunId,
          ordinal: 1,
          severity: 'major',
          dimension: 'correctness',
          location: { path: 'app.ts', revision: repo.head, baseRevision: repo.parent, startLine: 1, endLine: 1, side: 'new' },
          title: 'value changed',
          detail: 'check',
          status: 'open',
        },
      ],
    });

    const commits = await app.app.inject({ method: 'GET', url: `/api/git/repos/${projectId}/commits` });
    assert.equal(commits.statusCode, 200, commits.body);
    const head = commits.json().data.commits.find((commit: { sha: string }) => commit.sha === repo.head);
    assert.equal(head.review.reviewRunId, created.reviewRunId);
    assert.equal(head.review.openCount, 1);

    const files = await app.app.inject({ method: 'GET', url: `/api/git/repos/${projectId}/commits/${repo.head}/files` });
    assert.equal(files.statusCode, 200, files.body);
    const file = files.json().data.files.find((item: { path: string }) => item.path === 'app.ts');
    assert.ok(file !== undefined);
    assert.equal(files.json().data.reviewBadges[0].fileId, file.fileId);
    assert.equal(files.json().data.reviewBadges[0].findingCount, 1);

    const repos = await app.app.inject({ method: 'GET', url: '/api/git/repos' });
    assert.equal(repos.json().data.repos[0].summary.pendingFindingCount, 1);
  } finally {
    await app.close();
  }
});
