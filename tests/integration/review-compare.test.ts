import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createId } from '@agent-workflow/shared';
import { createApplication } from '../../packages/server/src/index.ts';

function finding(reviewRunId: string, ordinal: number, title: string, path: string, line: number) {
  return {
    findingId: createId('finding'),
    reviewRunId,
    ordinal,
    severity: 'major' as const,
    dimension: 'correctness' as const,
    title,
    detail: `${title} detail`,
    location: { path, revision: 'head', baseRevision: 'base', startLine: line, endLine: line, side: 'new' as const },
    status: 'open' as const,
  };
}

test('review comparison classifies resolved, introduced and persisting findings', async () => {
  const app = await createApplication({ dataDir: mkdtempSync(join(tmpdir(), 'aw-reviewcmp-')), disableOpenCode: true, disableListen: true });
  try {
    const projectId = 'prj_compare_test';
    const base = { projectId, executionId: 'exec_compare_test', subject: { commitSha: 'a'.repeat(40), compareBase: { compareId: 'parent:0', kind: 'parent' as const, label: '父提交', baseSha: 'b'.repeat(40) } }, dimensions: ['correctness' as const], context: 'diff_only' as const, profession: { professionId: 'role.reviewer', revision: 'r2', displayName: '审查员' }, state: 'completed' as const, findings: [] };
    app.store.db.exec('PRAGMA foreign_keys = OFF');
    const first = app.store.reviews.create({ ...base });
    const second = app.store.reviews.create({ ...base, subject: { ...base.subject, commitSha: 'c'.repeat(40) } });
    app.store.db.exec('PRAGMA foreign_keys = ON');
    app.store.reviews.update({ ...app.store.reviews.get(first.reviewRunId)!, findings: [finding(first.reviewRunId, 1, '问题A', 'src/a.ts', 10), finding(first.reviewRunId, 2, '问题B', 'src/b.ts', 20)] });
    app.store.reviews.update({ ...app.store.reviews.get(second.reviewRunId)!, findings: [finding(second.reviewRunId, 1, '问题A', 'src/a.ts', 10), finding(second.reviewRunId, 2, '问题C', 'src/c.ts', 30)] });

    const response = await app.app.inject({ method: 'GET', url: `/api/git/repos/${projectId}/reviews/${first.reviewRunId}/compare/${second.reviewRunId}` });
    assert.equal(response.statusCode, 200, response.body);
    const data = response.json().data as { resolved: { title: string }[]; introduced: { title: string }[]; persisting: { title: string }[] };
    assert.deepEqual(data.resolved.map((item) => item.title), ['问题B']);
    assert.deepEqual(data.introduced.map((item) => item.title), ['问题C']);
    assert.deepEqual(data.persisting.map((item) => item.title), ['问题A']);

    const missing = await app.app.inject({ method: 'GET', url: `/api/git/repos/${projectId}/reviews/review_missing/compare/${second.reviewRunId}` });
    assert.equal(missing.statusCode, 404, missing.body);
  } finally {
    await app.close();
  }
});
