import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { aggregateTaskUsage, filterInsightsTasks, type InsightsTaskUsageResponse, createId } from '@agent-workflow/shared';
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
    assert.equal(usage.length, 2);
    assert.equal(usage.find((item) => item.taskId === firstTask.id)!.tokens, 165);
    assert.equal(usage.find((item) => item.taskId !== firstTask.id)!.tokens, undefined);

    app.store.db.exec('PRAGMA foreign_keys = OFF');
    app.store.db.prepare("INSERT OR REPLACE INTO executions (id, task_id, plan_revision_id, status, auto_advance, progress_json, revision) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run('exec_quality_test', firstTask.id, 'plan_test', 'completed', 0, '{"done":0,"failed":0,"running":0,"total":0}', 1);
    app.store.db.prepare("INSERT OR REPLACE INTO execution_nodes (execution_id, node_id, status, attempt_count) VALUES (?, ?, ?, ?)").run('exec_quality_test', 'node_pass', 'succeeded', 1);
    app.store.db.prepare("INSERT OR REPLACE INTO execution_nodes (execution_id, node_id, status, attempt_count) VALUES (?, ?, ?, ?)").run('exec_quality_test', 'node_fail', 'failed', 1);
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
    const acceptance = await app.app.inject({ method: 'GET', url: '/api/insights/task-acceptance' });
    assert.equal(acceptance.statusCode, 200, acceptance.body);
    const acceptanceItems = acceptance.json().data.items as { taskId: string; passed: number; failed: number; total: number }[];
    assert.equal(acceptanceItems.length, 1);
    assert.equal(acceptanceItems[0]!.taskId, firstTask.id);
    assert.equal(acceptanceItems[0]!.passed, 1);
    assert.equal(acceptanceItems[0]!.failed, 1);
    assert.equal(acceptanceItems[0]!.total, 2);
  } finally {
    await app.close();
  }
});

test('insights joins all four run types, preserves missing versus zero and currency, and filters the complete archived task snapshot', async () => {
  const app = await createApplication({ dataDir: mkdtempSync(join(tmpdir(), 'aw-insights-scope-')), disableOpenCode: true, disableListen: true });
  try {
    const project = app.store.projects.create({ name: 'Same name', rootPath: mkdtempSync(join(tmpdir(), 'aw-insights-p1-')), gitState: 'not_git' });
    const otherProject = app.store.projects.create({ name: 'Same name', rootPath: mkdtempSync(join(tmpdir(), 'aw-insights-p2-')), gitState: 'not_git' });
    const tasks = Array.from({ length: 205 }, (_, index) => app.store.tasks.create({ projectId: index === 204 ? otherProject.id : project.id, title: `Task ${index}`, requirementText: 'Fixture', methodId: 'method.requirement-development', methodRevision: 'r1' }));
    const task = tasks[0]!; app.store.tasks.update(task.id, { lifecycle: 'completed' });
    app.store.settings.putJson(`task.archived.${tasks[204]!.id}`, '2026-01-01T00:00:00Z');
    const roundInput = { taskId: task.id, inputRevision: 1, method: { id: 'method.requirement-development', name: 'method', revision: 'r1' }, strategy: { id: 'single_pass', version: '1' }, model: app.engine.settings.models[0]! };
    for (const [index, currency] of ['USD', 'CNY'].entries()) app.store.planning.create({ ...roundInput, ordinal: index + 1, usage: { dispatches: { used: 1, maximum: 2 }, revisions: { used: 0, maximum: 1 }, budget: { known: currency === 'USD' ? 0.1 : 0.7, currency, reserved: 0, unknown: 0 }, tokens: { total: 0, input: 0, output: 0, cache: 0, reasoning: 0 } } });
    app.store.db.exec('PRAGMA foreign_keys=OFF');
    app.store.db.prepare('INSERT INTO executions(id,task_id,plan_revision_id,status,auto_advance,progress_json,revision) VALUES(?,?,?,?,?,?,?)').run('scope_exec', task.id, 'fixture_plan', 'completed', 0, '{}', 1);
    for (const [ordinal, usage] of [[1, '{"total":12}'], [2, null]] as const) app.store.db.prepare('INSERT INTO attempts(id,execution_id,node_id,ordinal,status,started_at,ended_at,usage_json) VALUES(?,?,?,?,?,?,?,?)').run(`scope_attempt_${ordinal}`, 'scope_exec', 'n', ordinal, 'succeeded', '2026-01-01T00:00:00Z', '2026-01-01T00:00:02Z', usage);
    app.store.db.exec('PRAGMA foreign_keys=ON');
    app.store.tasks.update(task.id, { executionId: 'scope_exec' });
    const review = app.store.reviews.create({ projectId: project.id, executionId: 'scope_exec', subject: { commitSha: 'a'.repeat(40), compareBase: { compareId: 'parent:0', kind: 'parent', label: 'parent', baseSha: 'b'.repeat(40) } }, dimensions: ['correctness'], context: 'diff_only', profession: { professionId: 'role.reviewer', revision: 'r1', displayName: 'review' }, state: 'completed', findings: [] });
    app.store.db.prepare('UPDATE reviews SET usage_json=? WHERE id=?').run('{"total":23}', review.reviewRunId);
    app.store.db.prepare('INSERT INTO fixes(id,project_id,execution_id,review_run_id,finding_ids_json,base_json,fix_branch,worktree_id,profession_json,state,fix_revision,usage_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run('scope_fix', project.id, 'scope_exec', review.reviewRunId, '[]', '{}', 'fixture', 'fixture', '{}', 'ready_to_commit', 'r1', '{"total":34}');
    app.store.acceptances.put({ taskId: task.id, verdict: 'accepted', decidedAt: new Date().toISOString() });
    const read = await app.app.inject({ method: 'GET', url: '/api/insights/task-usage' }); assert.equal(read.statusCode, 200, read.body);
    const data = read.json().data as InsightsTaskUsageResponse; assert.equal(data.tasks.length, 205); assert.equal(data.usage.length, 205);
    const measured = data.usage.find((item) => item.taskId === task.id)!;
    assert.equal(measured.tokens, 69); assert.equal(measured.knownRecords, 5); assert.equal(measured.unknownRecords, 1); assert.equal(measured.unknownCostRecords, 4); assert.equal(measured.durationMs, 4000); assert.equal(measured.unknownDurationRecords, 4); assert.equal(measured.retries, 1); assert.equal(measured.quality, 'passed');
    assert.deepEqual(measured.costs, [{ currency: 'CNY', amount: 0.7 }, { currency: 'USD', amount: 0.1 }]);
    assert.equal(data.usage.find((item) => item.taskId === tasks[1]!.id)!.tokens, undefined);
    const filters = { projectId: '', status: 'all', quality: 'all' as const, includeArchived: false, keyword: '' };
    assert.equal(filterInsightsTasks(data.tasks, data.usage, filters).length, 204);
    const archived = filterInsightsTasks(data.tasks, data.usage, { ...filters, projectId: otherProject.id, includeArchived: true }); assert.deepEqual(archived.map((item) => item.id), [tasks[204]!.id]);
    const passed = filterInsightsTasks(data.tasks, data.usage, { ...filters, quality: 'passed', status: 'completed' }); assert.deepEqual(passed.map((item) => item.id), [task.id]);
    const summary = aggregateTaskUsage(data.usage.filter((item) => passed.some((row) => row.id === item.taskId))); assert.equal(summary.tokens, 69); assert.deepEqual(summary.costs, measured.costs);
    assert.equal(aggregateTaskUsage(data.usage.filter((item) => item.taskId === tasks[1]!.id)).tokens, undefined);
    app.store.db.prepare('UPDATE planning_rounds SET usage_json=json_set(usage_json,\'$.tokens.total\',0) WHERE task_id=?').run(task.id);
    app.store.planning.create({ ...roundInput, taskId: tasks[2]!.id, ordinal: 1, usage: { dispatches: { used: 1, maximum: 2 }, revisions: { used: 0, maximum: 1 }, budget: { known: 0.25, currency: 'EUR', reserved: 0, unknown: 0 } } });
    const costOnly = app.engine.insights.taskUsage().find((item) => item.taskId === tasks[2]!.id)!; assert.equal(costOnly.tokens, undefined); assert.deepEqual(costOnly.costs, [{ currency: 'EUR', amount: 0.25 }]);
    const global = app.engine.insights.summary(); assert.equal(global.planning.costKnown, undefined); assert.equal(global.planning.currency, undefined); assert.equal(global.planning.costs.length, 3);
    // Keep old audit findings, but a fresh current review supersedes them for current quality.
    app.store.db.prepare('UPDATE reviews SET findings_json=? WHERE id=?').run('[{"status":"open"}]', review.reviewRunId);
    assert.equal(app.engine.insights.taskUsage().find((item) => item.taskId === task.id)!.quality, 'issues');
    const freshReview = app.store.reviews.create({ ...review, findings: [], state: 'completed' });
    assert.equal(app.engine.insights.taskUsage().find((item) => item.taskId === task.id)!.quality, 'passed');
    assert.equal(app.engine.insights.taskQuality().find((item) => item.taskId === task.id)!.openFindings, 1, 'historical audit findings remain');
    app.store.db.prepare('UPDATE reviews SET execution_id=? WHERE id=?').run('historical_exec', review.reviewRunId);
    app.store.db.prepare('INSERT INTO executions(id,task_id,plan_revision_id,status,auto_advance,progress_json,revision) VALUES(?,?,?,?,?,?,?)').run('historical_exec', task.id, 'fixture_plan', 'completed', 0, '{}', 1);
    assert.equal(app.engine.insights.taskUsage().find((item) => item.taskId === task.id)!.quality, 'passed', 'old execution open findings do not poison current quality');
    assert.equal(app.engine.insights.taskQuality().find((item) => item.taskId === task.id)!.openFindings, 1);
    app.store.db.prepare('UPDATE reviews SET state=? WHERE id=?').run('failed', freshReview.reviewRunId);
 assert.equal(app.engine.insights.taskUsage().find((item) => item.taskId === task.id)!.quality, 'pending_review');
  } finally { await app.close(); }
});
