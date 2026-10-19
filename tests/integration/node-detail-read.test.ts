import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROUTES, type PlanGraph } from '@agent-workflow/shared';
import { createApplication } from '../../packages/server/src/index.ts';
import { captureArtifacts } from '../../packages/engine/src/artifacts.ts';

// Real local HTTP/SQLite/blob reads, offline; no model or remote-write evidence.
test('historical node detail binds immutable attempt definition and enforces every content permission after revocation', async () => {
  const root = mkdtempSync(join(tmpdir(), 'aw-node-read-'));
  const app = await createApplication({ dataDir: root, disableOpenCode: true, disableListen: true });
  try {
    const store = app.store;
    const project = store.projects.create({ name: 'node', rootPath: root, gitState: 'not_git' });
    const task = store.tasks.create({ projectId: project.id, title: 'read', requirementText: 'old requirement', methodId: 'method.requirement-development', methodRevision: 'r12' });
    const graph: PlanGraph = { nodes: [{ id: 'n', key: 'old-key', title: 'OLD DEFINITION', kind: 'implementation', groupId: 'g', summary: 'old summary', inputs: [], outputs: [], acceptance: ['old acceptance'], resources: { read: [], write: [] } }], edges: [], groups: [{ id: 'g', label: 'old group', kind: 'implementation', refined: true, collapsible: false, collapsedByDefault: false }] };
    const oldPlan = store.plans.create({ taskId: task.id, source: 'manual', graph, status: 'confirmed' });
    const execution = store.executions.create({ taskId: task.id, planRevisionId: oldPlan.id, graph, autoAdvance: false });
    const oldAttempt = store.executions.createAttempt({ executionId: execution.id, nodeId: 'n', ordinal: 1, definition: { planRevisionId: oldPlan.id, node: graph.nodes[0]! } });
    writeFileSync(join(root, 'report.md'), 'ARTIFACT SECRET');
    const [artifact] = captureArtifacts(root, root, oldAttempt.id, [{ path: 'report.md' }], () => true);
    store.executions.finishAttempt(oldAttempt.id, 'failed', { resultRevision: 'old-result', summary: 'RESULT SECRET', artifacts: [artifact!], errors: [], warnings: [] });
    store.executions.appendOutput({ attemptId: oldAttempt.id, seq: 1, fragment: { fragmentId: 'body', seq: 1, category: 'model_text', text: 'BODY SECRET' } });
    store.executions.appendOutput({ attemptId: oldAttempt.id, seq: 2, fragment: { fragmentId: 'tool', seq: 2, category: 'tool_activity', text: 'TOOL SECRET', toolCallRef: { callId: 'call', source: 'opencode', status: 'completed' }, toolEvidence: { name: 'read', input: 'TOOL INPUT SECRET', output: 'TOOL RESULT SECRET', redacted: false, truncated: false } } });
    const newGraph = structuredClone(graph); Object.assign(newGraph.nodes[0]!, { title: 'NEW DEFINITION', summary: 'new summary', acceptance: ['new acceptance'] });
    const newPlan = store.plans.create({ taskId: task.id, source: 'manual', graph: newGraph, status: 'confirmed' });
    const current = store.executions.createAttempt({ executionId: execution.id, nodeId: 'n', ordinal: 2, definition: { planRevisionId: newPlan.id, node: newGraph.nodes[0]! } });
    store.tasks.update(task.id, { currentPlanRevisionId: newPlan.id, executionId: execution.id });
    store.executions.updateNode(execution.id, 'n', { currentAttemptId: current.id, attemptCount: 2, status: 'running' });
    const get = (url: string) => app.app.inject({ method: 'GET', url });
    const historicalUrl = `${ROUTES.node(task.id, 'n')}?attemptId=${oldAttempt.id}`;
    for (const url of [historicalUrl, `/api/tasks/${task.id}/plan/nodes/n?attemptId=${oldAttempt.id}`]) {
      const response = await get(url); assert.equal(response.statusCode, 200, response.body);
      assert.equal(response.json().data.node.title, 'OLD DEFINITION');
      assert.equal(response.json().data.planRevisionId, oldPlan.id);
      assert.equal(response.json().data.currentAttempt.id, current.id);
      assert.equal(response.json().data.selectedAttempt.id, oldAttempt.id);
      assert.equal(response.json().data.execution.status, 'failed');
      assert.equal(response.json().data.actions.accept.allowed, false);
      assert.equal(response.json().data.output.fragments[0].text, 'BODY SECRET');
    }
    const artifactUrl = `${ROUTES.taskArtifact(task.id, oldAttempt.id, artifact!.id)}?revision=${artifact!.revision}&sha256=${artifact!.sha256}`;
    const toolUrl = ROUTES.nodeTool(task.id, 'n', oldAttempt.id, 'call');
    assert.equal((await get(artifactUrl)).json().data.preview, 'ARTIFACT SECRET');
    assert.equal((await get(toolUrl)).json().data.content, 'TOOL RESULT SECRET');
    const revoke = (readability: { output: string; tools: string; result: string }) => store.db.prepare('UPDATE attempts SET readability_json = ? WHERE id = ?').run(JSON.stringify(readability), oldAttempt.id);
    revoke({ output: 'ok', tools: 'forbidden', result: 'forbidden' });
    const detail = (await get(historicalUrl)).json().data;
    assert.equal(detail.attempts.find((a: { id: string }) => a.id === oldAttempt.id).result, undefined);
    assert.ok(!JSON.stringify(detail).includes('RESULT SECRET'));
    assert.ok(!JSON.stringify(detail.output).includes('TOOL SECRET'));
    assert.ok(!JSON.stringify(detail.output).includes('TOOL INPUT SECRET'));
    assert.equal((await get(toolUrl)).statusCode, 403);
    assert.equal((await get(artifactUrl)).statusCode, 403);
    assert.equal((await get(`${artifactUrl}&download=1`)).statusCode, 403);
    const list = (await get(ROUTES.nodeAttempts(task.id, 'n'))).json().data;
    assert.equal(list.attempts.find((a: { attemptId: string }) => a.attemptId === oldAttempt.id).reasonSummary, undefined);
    revoke({ output: 'forbidden', tools: 'ok', result: 'ok' });
    assert.deepEqual((await get(historicalUrl)).json().data.output.fragments, []);
    assert.equal((await get(`${ROUTES.nodeOutput(task.id, 'n')}?attemptId=${oldAttempt.id}`)).statusCode, 403);
    assert.equal((await get(toolUrl)).statusCode, 403, 'tool body cannot bypass output revocation');
    const other = store.tasks.create({ projectId: project.id, title: 'other', requirementText: '', methodId: 'method.requirement-development', methodRevision: 'r12' });
    assert.equal((await get(`${ROUTES.node(other.id, 'n')}?attemptId=${oldAttempt.id}`)).statusCode, 404);
    assert.equal((await get(`${ROUTES.node(task.id, 'other')}?attemptId=${oldAttempt.id}`)).statusCode, 404);
    assert.equal((await get(ROUTES.nodeAttempts(task.id, 'missing'))).statusCode, 404);
    const legacy = store.executions.createAttempt({ executionId: execution.id, nodeId: 'n', ordinal: 3 });
    assert.match((await get(`${ROUTES.node(task.id, 'n')}?attemptId=${legacy.id}`)).json().data.definitionUnavailableReason, /未保存/);
    store.executions.updateNode(execution.id, 'n', { currentAttemptId: null, status: 'pending' });
    const betweenAttempts = (await get(ROUTES.node(task.id, 'n'))).json().data;
    assert.equal(betweenAttempts.currentAttempt, undefined, 'an old attempt cannot masquerade as the next current attempt');
    assert.deepEqual(betweenAttempts.output.fragments, []);
  } finally { await app.close(); rmSync(root, { recursive: true, force: true }); }
});

test('late submission and completion preserve revoked readability atomically and across a storage reopen', async () => {
  const root = mkdtempSync(join(tmpdir(), 'aw-node-revoked-settle-'));
  let app = await createApplication({ dataDir: root, disableOpenCode: true, disableListen: true });
  try {
    const project = app.store.projects.create({ name: 'revoked', rootPath: root, gitState: 'not_git' });
    const task = app.store.tasks.create({ projectId: project.id, title: 'revoked', requirementText: '', methodId: 'method.requirement-development', methodRevision: 'r12' });
    const graph: PlanGraph = { nodes: [{ id: 'n', key: 'n', title: 'n', kind: 'implementation', groupId: 'g', summary: '', inputs: [], outputs: [], acceptance: [], resources: { read: [], write: [] } }], edges: [], groups: [] };
    const plan = app.store.plans.create({ taskId: task.id, source: 'manual', graph, status: 'confirmed' });
    const execution = app.store.executions.create({ taskId: task.id, planRevisionId: plan.id, graph, autoAdvance: false });
    const attempt = app.store.executions.createAttempt({ executionId: execution.id, nodeId: 'n', ordinal: 1, definition: { planRevisionId: plan.id, node: graph.nodes[0]! } });
    const forbidden = { output: 'forbidden', tools: 'forbidden', result: 'forbidden' };
    app.store.db.prepare('UPDATE attempts SET readability_json = ? WHERE id = ?').run(JSON.stringify(forbidden), attempt.id);
    const result = { resultRevision: 'late', summary: 'late private result', artifacts: [], errors: [], warnings: [] };
    assert.equal(app.store.executions.saveSubmittedResult(attempt.id, result), true);
    assert.deepEqual(app.store.executions.getAttempt(attempt.id)?.readability, forbidden);
    app.store.executions.finishAttempt(attempt.id, 'succeeded');
    assert.deepEqual(app.store.executions.getAttempt(attempt.id)?.readability, forbidden);
    const notSubmitted = app.store.executions.createAttempt({ executionId: execution.id, nodeId: 'n', ordinal: 2 });
    app.store.db.prepare('UPDATE attempts SET readability_json = ? WHERE id = ?').run(JSON.stringify({ output: 'forbidden', tools: 'ok', result: 'not_submitted' }), notSubmitted.id);
    app.store.executions.finishAttempt(notSubmitted.id, 'failed', undefined, 'late failure');
    assert.deepEqual(app.store.executions.getAttempt(notSubmitted.id)?.readability, { output: 'forbidden', tools: 'ok', result: 'not_submitted', error: 'late failure' });
    await app.close();
    app = await createApplication({ dataDir: root, disableOpenCode: true, disableListen: true });
    assert.deepEqual(app.store.executions.getAttempt(attempt.id)?.readability, forbidden);
  } finally { await app.close(); rmSync(root, { recursive: true, force: true }); }
});
