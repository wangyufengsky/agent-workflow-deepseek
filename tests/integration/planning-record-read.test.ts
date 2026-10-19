import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_SETTINGS, type PlanningRecordResponse } from '@agent-workflow/shared';
import { createApplication } from '../../packages/server/src/application.ts';
import { planningRecordRows } from '../../apps/web/src/pages/requirement/planning-record-model.ts';

test('planning records paginate past 500, reject foreign rounds and report retained holes without replacing content', async () => {
  const app = await createApplication({ dataDir: mkdtempSync(join(tmpdir(), 'aw-planning-record-')), port: 0, disableOpenCode: true });
  try {
    const project = app.store.projects.create({ name: '记录范围', rootPath: '/tmp', gitState: 'not_git' });
    const createTask = (title: string) => app.store.tasks.create({ projectId: project.id, title, requirementText: '', methodId: 'method.requirement-development', methodRevision: 'r12' });
    const task = createTask('记录任务'); const other = createTask('其他任务');
    const round = app.store.planning.create({ taskId: task.id, ordinal: 1, inputRevision: 1,
      method: { id: task.methodId, revision: task.methodRevision, name: '需求开发' },
      strategy: { id: 'planning.requirement-development', version: 'v1' }, model: DEFAULT_SETTINGS.models[0]!,
      usage: { dispatches: { used: 1, maximum: 2 }, revisions: { used: 0, maximum: 1 }, budget: { known: 0, reserved: 0, unknown: 0, currency: 'CNY', limit: 10 } } });
    for (let i = 1; i <= 505; i++) app.store.planning.appendRecord(round.id, { fragmentId: `f${i}`, category: 'model_text', text: `记录 ${i}` });
    const url = `/api/tasks/${task.id}/planning/record?roundId=${round.id}`;
    const get = (url: string) => app.app.inject({ method: 'GET', url });
    const first = (await get(url)).json().data as PlanningRecordResponse;
    assert.equal(first.fragments.length, 500); assert.equal(first.hasMore, true); assert.equal(first.nextAfterSeq, 500); assert.equal(first.lastAvailableSeq, 505);
    const next = (await get(`${url}&afterSeq=500`)).json().data as PlanningRecordResponse;
    assert.equal(next.fragments.length, 5); assert.equal(next.fragments[0]?.text, '记录 501'); assert.equal(next.hasMore, false);
    assert.equal((await get(`/api/tasks/${other.id}/planning/record?roundId=${round.id}`)).statusCode, 404);
    for (const bad of ['&afterSeq=-1', '&afterSeq=NaN', '&afterSeq=1.5', '&limit=0', '&limit=1001']) assert.equal((await get(`${url}${bad}`)).statusCode, 400);
    app.store.db.prepare('DELETE FROM planning_records WHERE round_id = ? AND (seq <= 3 OR seq = 7)').run(round.id);
    app.store.planning.update(round.id, { recordFirstSeq: 4, recordLastSeq: 505, gaps: [{ fromSeq: 1, toSeq: 3, reason: 'NOT_RETAINED' }], status: 'completed' });
    const refreshed = (await get(url)).json().data as PlanningRecordResponse;
    assert.ok(refreshed.gaps.some((gap) => gap.fromSeq === 1 && gap.toSeq === 3 && gap.reason === 'NOT_RETAINED'));
    assert.ok(refreshed.gaps.some((gap) => gap.fromSeq === 7 && gap.toSeq === 7));
    assert.equal(refreshed.fragments[0]?.seq, 4);
    assert.equal(app.store.planning.get(round.id)?.recordSeq.first, 4);
    assert.equal(app.store.planning.get(round.id)?.recordSeq.gaps.length, 1, 'combined update keeps all record metadata');
    app.store.db.prepare('DELETE FROM planning_records WHERE round_id = ?').run(round.id);
    assert.equal(app.store.planning.appendRecord(round.id, { fragmentId: 'after-retention', category: 'service_event', text: '已清理后的新记录' }), 506, 'retention must never reuse an old sequence');
  } finally { await app.close(); }
});

test('planning reading deduplicates replayed seq and updates one tool card in place', () => {
  const tool = (seq: number, status: string): PlanningRecordResponse['fragments'][number] => ({ seq, fragmentId: `tool-${seq}`, category: 'tool_activity', toolCallRef: { callId: 'read-1', status, source: 'managed_mcp' }, text: `读取 ${status}` });
  const text = { seq: 2, fragmentId: 'text-2', category: 'model_text', text: '模型陈述' };
  const rows = planningRecordRows([tool(3, 'running'), text, tool(1, 'pending'), text, tool(4, 'completed')]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0]?.fragmentId, 'tool-1');
  assert.equal(rows[0]?.toolCallRef?.status, 'completed');
  assert.equal(rows[0]?.seq, 1);
  assert.equal(rows[0]?.lastSeq, 4);
  assert.equal(rows[1]?.text, '模型陈述');
});
