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

function createRepo(): string {
  const root = mkdtempSync(join(tmpdir(), 'aw-insights-'));
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: root });
  writeFileSync(join(root, 'README.md'), '# insights\n', 'utf8');
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'init'], { cwd: root });
  return root;
}

test('insights aggregate real task/review counters from SQLite', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'aw-insights-data-'));
  const app = await createApplication({ dataDir, disableOpenCode: true, disableListen: true });
  try {
    const project = await app.app.inject({ method: 'POST', url: '/api/projects', payload: { requestKey: requestKey('prj'), name: 'Insights', rootPath: createRepo() } });
    const projectId = project.json().data.resource.project.id as string;
    for (const title of ['A', 'B']) {
      const created = await app.app.inject({ method: 'POST', url: '/api/tasks', payload: { requestKey: requestKey('task'), projectId, title, requirementText: 'R1', methodId: 'method.requirement-development' } });
      assert.equal(created.statusCode, 201, created.body);
    }
    const firstTask = app.store.tasks.list().find((task) => task.title === 'A');
    assert.ok(firstTask);
    const model = app.store.settings.getSettings()?.models?.at(0) ?? {
      id: 'opencode-go/deepseek-v4.1-flash',
      label: 'DeepSeek Flash',
      provider: 'opencode-go',
      model: 'deepseek-v4.1-flash',
      displayName: 'flash',
      roles: ['planner'],
      enabled: true,
      contextTokens: 131072,
      outputTokens: 65536,
      cost: { inputPerMTokens: 0.28, outputPerMTokens: 0.42, currency: 'USD' },
    };
    app.store.planning.create({
      taskId: firstTask.id,
      ordinal: 1,
      inputRevision: firstTask.requirement.revision,
      method: { id: 'method.requirement-development', name: '需求开发', revision: 'r1' },
      strategy: { id: 'single_pass', version: '1' },
      model,
      usage: {
        dispatches: { used: 0, maximum: 2 },
        revisions: { used: 0, maximum: 1 },
        budget: { known: 0.01, reserved: 0, unknown: 0, currency: 'USD' },
        tokens: { input: 100, output: 50, reasoning: 10, cache: 5, total: 165 },
      },
    });

    const empty = await app.app.inject({ method: 'GET', url: '/api/insights' });
    assert.equal(empty.statusCode, 200, empty.body);
    const emptyData = empty.json().data as { tasks: { total: number; active: number }; reviews: { openFindings: number } };
    assert.equal(emptyData.tasks.total, 2);
    assert.equal(emptyData.tasks.active, 2);
    assert.equal(emptyData.reviews.openFindings, 0);
    const planning = (empty.json().data as { planning: { costKnown: number; tokens: { total: number } } }).planning;
    assert.equal(planning.costKnown, 0.01);
    assert.equal(planning.tokens.total, 165);
    app.store.db.exec('PRAGMA foreign_keys = OFF');
    app.store.db.prepare("INSERT OR REPLACE INTO attempts (id, execution_id, node_id, ordinal, status, started_at, ended_at, result_json, readability_json, usage_json) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)")
      .run('attempt_test_usage', 'exec_test_usage', 'node_test', 1, 'failed', '2026-01-01T00:00:00.000Z', '2026-01-01T00:01:00.000Z', '{"output":"ok","tools":"ok","result":"not_submitted"}', '{"input":600,"output":300,"reasoning":0,"cache":0,"total":900}');
    app.store.db.exec('PRAGMA foreign_keys = ON');
    const withUsage = await app.app.inject({ method: 'GET', url: '/api/insights' });
    const executionTokens = (withUsage.json().data as { executions: { tokens: { total: number } } }).executions.tokens;
    assert.equal(executionTokens.total, 900);

    const taskUsage = await app.app.inject({ method: 'GET', url: '/api/insights/task-usage' });
    assert.equal(taskUsage.statusCode, 200, taskUsage.body);
    const usage = taskUsage.json().data.usage as { taskId: string; tokens: number }[];
    assert.equal(usage.length, 1);
    assert.equal(usage[0]!.taskId, firstTask.id);
    assert.equal(usage[0]!.tokens, 165);

    app.store.db.exec('PRAGMA foreign_keys = OFF');
    app.store.db.prepare("INSERT OR REPLACE INTO executions (id, task_id, plan_revision_id, status, auto_advance, progress_json, revision) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run('exec_quality_test', firstTask.id, 'plan_test', 'completed', 0, '{"done":0,"failed":0,"running":0,"total":0}', 1);
    app.store.db.exec('PRAGMA foreign_keys = ON');
    const review = app.store.reviews.create({
      projectId,
      executionId: 'exec_quality_test',
      subject: { commitSha: 'a'.repeat(40), compareBase: { compareId: 'parent:0', kind: 'parent', label: '父提交', baseSha: 'b'.repeat(40) } },
      dimensions: ['correctness'],
      context: 'diff_only',
      profession: { professionId: 'role.reviewer', revision: 'r2', displayName: '代码审查员' },
      state: 'completed',
      findings: [],
    });
    app.store.reviews.update({
      ...app.store.reviews.get(review.reviewRunId)!,
      findings: [{
        findingId: createId('finding'),
        reviewRunId: review.reviewRunId,
        ordinal: 1,
        severity: 'major',
        dimension: 'correctness',
        title: 'x',
        detail: 'y',
        status: 'open',
      }],
    });
    const filled = await app.app.inject({ method: 'GET', url: '/api/insights' });
    assert.equal(filled.statusCode, 200, filled.body);
    const data = filled.json().data as { reviews: { total: number; completed: number; openFindings: number } };
    assert.equal(data.reviews.total, 1);
    assert.equal(data.reviews.completed, 1);
    assert.equal(data.reviews.openFindings, 1);
    app.store.db.prepare('UPDATE reviews SET usage_json = ? WHERE id = ?').run('{"input":140,"output":100,"reasoning":0,"cache":0,"total":240}', review.reviewRunId);
    const withReviewUsage = await app.app.inject({ method: 'GET', url: '/api/insights' });
    const reviewTokens = (withReviewUsage.json().data as { reviews: { tokens: { total: number } } }).reviews.tokens;
    assert.equal(reviewTokens.total, 240);
    const taskQuality = await app.app.inject({ method: 'GET', url: '/api/insights/task-quality' });
    assert.equal(taskQuality.statusCode, 200, taskQuality.body);
    const qualityItems = taskQuality.json().data.items as { taskId: string; reviews: number; openFindings: number }[];
    assert.equal(qualityItems.length, 1);
    assert.equal(qualityItems[0]!.taskId, firstTask.id);
    assert.equal(qualityItems[0]!.reviews, 1);
    assert.equal(qualityItems[0]!.openFindings, 1);
  } finally {
    await app.close();
  }
});
