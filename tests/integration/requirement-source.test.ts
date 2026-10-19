import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROUTES, type PlanGraph } from '@agent-workflow/shared';
import { createApplication } from '../../packages/server/src/index.ts';
import { freezeRequirement, requirementLinks } from '../../packages/engine/src/requirement-source.ts';

test('requirement source binds exact frozen entry and plan, preserves CRLF offsets and refuses guessed or cross-task sources', async () => {
  const root = mkdtempSync(join(tmpdir(), 'aw-source-'));
  const app = await createApplication({ dataDir: root, disableOpenCode: true, disableListen: true });
  try {
    const project = app.store.projects.create({ name: 'source', rootPath: root, gitState: 'not_git' });
    const text = '  第一条需求  \r\n\r\n  必须保留版本\n';
    const createTask = () => app.store.tasks.create({ projectId: project.id, title: 'source', requirementText: text, methodId: 'method.requirement-development', methodRevision: 'r12' });
    const task = createTask(); const other = createTask();
    const graph: PlanGraph = { nodes: [{ id: 'n1', key: 'n1', title: 'source', kind: 'implementation', groupId: 'g', summary: '', inputs: [{ name: 'R2', source: 'requirement' }], outputs: [], acceptance: [], resources: { read: [], write: [] } }], edges: [], groups: [{ id: 'g', label: 'g', kind: 'implementation', refined: true, collapsible: false, collapsedByDefault: false }] };
    const plan = app.store.plans.create({ taskId: task.id, source: 'manual', graph, status: 'confirmed' });
    assert.equal(requirementLinks(app.store, task, plan, graph.nodes[0]!)[0]?.sourceRef, undefined, 'legacy confirmed plan cannot pretend current requirement is its source');
    freezeRequirement(app.store, task, plan.id);
    const link = requirementLinks(app.store, task, plan, graph.nodes[0]!)[0]!;
    assert.ok(link.sourceRef);
    const ref = link.sourceRef;
    const suffix = `?revision=${ref.requirementRevision}&sha256=${ref.sha256}`;
    const url = ROUTES.nodeSource(task.id, 'n1', plan.id, 'R2') + suffix;
    const first = await app.app.inject({ method: 'GET', url });
    assert.equal(first.statusCode, 200, first.body);
    assert.equal(first.json().data.scope, 'full');
    assert.equal(first.json().data.content, text);
    assert.equal(text.slice(first.json().data.start, first.json().data.end), '必须保留版本');
    app.store.tasks.update(task.id, { requirement: { ...task.requirement, revision: 2, text: '替换后的需求', entries: [{ id: 'R2', kind: 'requirement', text: '替换后的需求' }] } });
    freezeRequirement(app.store, app.store.tasks.get(task.id)!, plan.id);
    assert.equal((await app.app.inject({ method: 'GET', url })).json().data.content, text, 'repeat freeze never overwrites original source');
    assert.equal((await app.app.inject({ method: 'GET', url: ROUTES.nodeSource(other.id, 'n1', plan.id, 'R2') + suffix })).statusCode, 404);
    assert.equal((await app.app.inject({ method: 'GET', url: ROUTES.nodeSource(task.id, 'n1', plan.id, 'R1') + suffix })).statusCode, 404);
    assert.equal((await app.app.inject({ method: 'GET', url: ROUTES.nodeSource(task.id, 'n1', plan.id, 'R2') + '?revision=2&sha256=wrong' })).json().error.code, 'STALE_TARGET');
    const badNode = { ...graph.nodes[0]!, inputs: [{ name: 'R2', source: 'requirement' as const, sourceEntryId: 'missing' }] };
    assert.equal(requirementLinks(app.store, task, plan, badNode)[0]?.sourceRef, undefined, 'explicit missing reference must not fall back to a different matching label');
    const guessed = { ...graph.nodes[0]!, inputs: [{ name: '第一条', source: 'requirement' as const }] };
    assert.equal(requirementLinks(app.store, task, plan, guessed)[0]?.sourceRef, undefined, 'substring is not source identity');
  } finally { await app.close(); rmSync(root, { recursive: true, force: true }); }
});
