import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { GitCommit, OperationReceipt, ReviewRun } from '@agent-workflow/shared';
import { createApplication } from '../../packages/server/src/index.ts';

/**
 * Real-model review against the managed OpenCode runtime.
 *
 * Gated: only runs with AGENT_WORKFLOW_LIVE=1 and a configured `opencode-go`
 * model. The test never fakes a model result; without the environment it is
 * skipped so offline verification stays deterministic.
 */
const LIVE = process.env.AGENT_WORKFLOW_LIVE === '1' && process.env.AGENT_WORKFLOW_DISABLE_OPENCODE !== '1';

function createRepo(): { root: string; headSha: string } {
  const root = mkdtempSync(join(tmpdir(), 'aw-live-review-'));
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'live@example.com'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Live Test'], { cwd: root });
  writeFileSync(join(root, 'app.ts'), `export function readName(input: { name?: string }): string {\n  return input.name?.trim() ?? '';\n}\n`, 'utf8');
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'feat: read name'], { cwd: root });
  writeFileSync(
    join(root, 'app.ts'),
    `export function readName(input: { name?: string }): string {\n  // NOTE: introduced on purpose for the live review.\n  return input.name!.trim().toUpperCase();\n}\n\nexport function unchecked(input: string | null): number {\n  return input!.length;\n}\n`,
    'utf8',
  );
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'fix: uppercase name'], { cwd: root });
  const headSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root }).toString().trim();
  return { root, headSha };
}

test('live: AI review of a real commit reaches a settled authoritative state', { skip: !LIVE, timeout: 360_000 }, async (t: TestContext) => {
  const repo = createRepo();
  const dataDir = mkdtempSync(join(tmpdir(), 'aw-live-review-data-'));
  const app = await createApplication({ dataDir, port: 0, host: '127.0.0.1' });
  try {
    const requestKey = (): string => `req_${Math.random().toString(36).slice(2, 21)}`;
    const projectResponse = await app.app.inject({
      method: 'POST',
      url: '/api/projects',
      payload: { requestKey: requestKey(), name: 'Live Review', rootPath: repo.root },
    });
    assert.equal(projectResponse.statusCode, 201, projectResponse.body);
    const projectId = (projectResponse.json() as { data: { resource: { project: { id: string } } } }).data.resource.project.id;

    const commitResponse = await app.app.inject({ method: 'GET', url: `/api/git/repos/${projectId}/commits/${repo.headSha}` });
    assert.equal(commitResponse.statusCode, 200, commitResponse.body);
    const commit = (commitResponse.json() as { data: { commit: GitCommit } }).data.commit;
    const compare = commit.compareOptions[0];
    assert.ok(compare !== undefined, '根提交/普通提交都应给出对比基线');

    const start = await app.app.inject({
      method: 'POST',
      url: `/api/git/repos/${projectId}/reviews/start`,
      payload: {
        requestKey: requestKey(),
        projectId,
        sha: repo.headSha,
        compareId: compare.compareId,
        dimensions: ['correctness', 'quality'],
        context: 'diff_only',
        professionId: 'role.reviewer',
        professionRevision: 'r2',
      },
    });
    if (start.statusCode !== 200) {
      const code = (start.json() as { error?: { code?: string } }).error?.code;
      if (code === 'NOT_IMPLEMENTED' || code === 'NOT_FOUND') {
        t.skip('application 尚未注册 review/fix 插件路由，跳过真实模型测试');
        return;
      }
    }
    // A live run may also be rejected synchronously when the managed runtime is
    // not ready; that is an environment failure, not a model result.
    assert.equal(start.statusCode, 200, start.body);
    const started = start.json() as { data: { receipt: OperationReceipt; resource: { review: ReviewRun } } };
    assert.equal(started.data.receipt.status, 'accepted');
    const reviewRunId = started.data.resource.review.reviewRunId;

    let review: ReviewRun | undefined;
    for (let attempt = 0; attempt < 150; attempt += 1) {
      const read = await app.app.inject({ method: 'GET', url: `/api/git/repos/${projectId}/reviews/${reviewRunId}` });
      assert.equal(read.statusCode, 200, read.body);
      review = (read.json() as { data: { review: ReviewRun } }).data.review;
      if (review !== undefined && ['completed', 'failed', 'stopped', 'unknown'].includes(review.state)) break;
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 2_000));
    }
    assert.ok(review !== undefined, '审查记录应始终可读');
    assert.ok(['completed', 'failed', 'stopped', 'unknown'].includes(review.state), `审查未结算：${review.state}`);
    assert.notEqual(review.receipt.status, 'accepted', '回执必须结算');
    if (review.state === 'completed') {
      assert.ok(review.summary !== undefined, '完成的审查必须有服务汇总');
      for (const finding of review.findings) {
        if (finding.location !== undefined) {
          assert.ok(finding.location.path.length > 0);
          assert.ok(finding.location.startLine >= 1);
        }
      }
    } else {
      assert.fail(`真实模型审查未完成：state=${review.state} error=${review.receipt.error?.code ?? 'unknown'} ${review.receipt.error?.message ?? ''}`);
    }
  } finally {
    await app.close();
  }
});
