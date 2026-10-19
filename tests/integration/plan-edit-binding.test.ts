import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store } from '@agent-workflow/storage';
import { Engine, type OpenCodePort, type OpenCodeRunRequest, type OpenCodeRunResult } from '../../packages/engine/src/index.ts';
import { createRequestKey, type PlanGraph, type PlanNode } from '@agent-workflow/shared';

// Offline control-flow regression: structured result fixtures do not prove a model run.
function fixture() {
  const dataDir = mkdtempSync(join(tmpdir(), 'aw-plan-binding-'));
  const store = new Store({ dataDir });
  const calls: Array<{ request: OpenCodeRunRequest; resolve: (value: OpenCodeRunResult) => void }> = [];
  const port: OpenCodePort = { status: () => ({ state: 'ready' }) as ReturnType<OpenCodePort['status']>, ensureReady: async () => {}, findSessions: async () => [], abortSession: async () => {}, runSession: (request) => new Promise((resolve) => { calls.push({ request, resolve }); request.onSessionId?.(`session-${calls.length}`); }) };
  const engine = new Engine({ store, ports: { opencode: port, git: {} as never }, integration: { opencodeReady: () => true, gitlabConfigured: () => false } });
  engine.updateSettings({ ...engine.settings, execution: { ...engine.settings.execution, maxConcurrentNodes: 1 } });
  const project = store.projects.create({ name: 'binding', rootPath: dataDir, gitState: 'not_git' });
  const task = store.tasks.create({ projectId: project.id, title: 'binding', requirementText: 'offline', methodId: 'method.requirement-development', methodRevision: 'r12' });
  const role = structuredClone(engine.catalog.roles.find((role) => role.id === 'role.developer')!);
  const node = (id: string): PlanNode => Object.assign({ id, key: id, title: id, kind: 'implementation' as const, groupId: 'g', summary: '原始职责', inputs: [], outputs: [], acceptance: [], resources: { read: [], write: [] }, roleId: role.id }, { roleSnapshot: role });
  const graph: PlanGraph = { nodes: [node('a'), node('b'), node('c')], edges: [{ id: 'ac', from: 'a', to: 'c', kind: 'order' }], groups: [{ id: 'g', label: '实现', kind: 'implementation', refined: true, collapsible: false, collapsedByDefault: false }] };
  const plan = store.plans.create({ taskId: task.id, source: 'manual', graph, status: 'confirmed' });
  const workspace = store.workspaces.create({ taskId: task.id, kind: 'directory_copy', displayRoot: dataDir }); store.workspaces.update(workspace.id, { state: 'ready' });
  const execution = store.executions.create({ taskId: task.id, planRevisionId: plan.id, graph, autoAdvance: true });
  store.tasks.update(task.id, { stage: 'executing', currentPlanRevisionId: plan.id, workspaceId: workspace.id, executionId: execution.id });
  const finish = async (index: number) => { const call = calls[index]!; engine.executions.submitResult({ taskId: task.id, nodeId: call.request.metadata.nodeId!, attemptId: call.request.metadata.attemptId!, summary: 'offline fixture', verification: { state: 'passed' } }); call.resolve({ sessionId: `session-${index + 1}`, outcome: { idle: true, timedOut: false, assistantText: '', messages: [] } }); await new Promise<void>((resolve) => setImmediate(resolve)); };
  const begin = () => engine.plans.editBegin(task.id, { requestKey: createRequestKey(), planRevisionId: store.executions.get(execution.id)!.planRevisionId, confirmPause: true });
  return { dataDir, store, engine, task, execution, plan, calls, finish, begin };
}

test('confirmed pending edits drive the real next dispatch while an active attempt retains its original definition', async () => {
  const f = fixture();
  f.engine.executions.start(f.task.id, { requestKey: createRequestKey(), confirm: true });
  assert.equal(f.calls[0]!.request.metadata.nodeId, 'a');
  const firstAttempt = f.calls[0]!.request.metadata.attemptId!;
  f.begin();
  const session = f.store.executions.get(f.execution.id)!.editSession!;
  f.engine.plans.editSave(f.task.id, { requestKey: createRequestKey(), editSessionId: session.id, expectedPlanRevisionNumber: 1, changes: [{ nodeId: 'b', prerequisites: ['c'] }, { nodeId: 'c', title: '调整后的 C', acceptance: ['新版验收条款'] }] });
  const next = f.store.plans.get(f.store.tasks.get(f.task.id)!.currentPlanRevisionId!)!;
  assert.throws(() => f.engine.plans.editFinish(f.task.id, { requestKey: createRequestKey(), editSessionId: session.id, continueExecution: true }), /单独重新确认/);
  assert.equal(f.calls.length, 1);
  assert.throws(() => f.engine.executions.resume(f.task.id, { requestKey: createRequestKey(), confirm: true }), /暂停的执行|调整尚未结束/);
  const workspaceId = f.store.tasks.get(f.task.id)!.workspaceId;
  const confirm = { requestKey: createRequestKey(), planRevisionId: next.id, expectedRevisionNumber: next.revisionNumber, confirmPlan: true as const };
  f.engine.plans.confirm(f.task.id, confirm);
  assert.equal(f.engine.plans.confirm(f.task.id, confirm).receipt.status, 'succeeded', 'confirmation key replays after the plan is already confirmed');
  assert.equal(f.store.executions.get(f.execution.id)!.planRevisionId, next.id);
  assert.equal(f.store.executions.get(f.execution.id)!.nodes.find((item) => item.nodeId === 'b')!.status, 'pending', 'old ready node is demoted because its new predecessor is incomplete');
  assert.equal(f.store.tasks.get(f.task.id)!.stage, 'executing');
  assert.equal(f.store.tasks.get(f.task.id)!.workspaceId, workspaceId);
  assert.equal(f.store.executions.get(f.execution.id)!.status, 'waiting_confirmation', 'confirmation itself does not resume');
  const finishKey = createRequestKey();
  f.engine.plans.editFinish(f.task.id, { requestKey: finishKey, editSessionId: session.id, continueExecution: true });
  f.engine.executions.kick(f.task.id);
  await f.finish(0);
  assert.equal(f.calls[1]!.request.metadata.nodeId, 'c', 'new graph dispatches c before b; original graph would dispatch b');
  assert.match(f.calls[1]!.request.prompt, /调整后的 C/);
  assert.match(f.calls[1]!.request.prompt, /新版验收条款/);
  assert.equal(f.store.executions.getAttempt(firstAttempt)!.definition!.planRevisionId, f.plan.id);
  assert.equal(f.store.executions.getAttempt(firstAttempt)!.definition!.node.title, 'a');
  assert.equal(f.store.executions.getAttempt(f.calls[1]!.request.metadata.attemptId!)!.definition!.planRevisionId, next.id);
  f.engine.plans.editFinish(f.task.id, { requestKey: finishKey, editSessionId: session.id, continueExecution: true });
  assert.equal(f.calls.length, 2, 'receipt replay cannot dispatch twice');
  await f.finish(1);
  assert.equal(f.calls.length, 2, 'new acceptance clause gates b until c is accepted');
  f.engine.plans.acceptNode(f.task.id, 'c', { requestKey: createRequestKey(), confirmAccept: true });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(f.calls[2]!.request.metadata.nodeId, 'b');
  await f.finish(2);
  f.engine.executions.shutdown(); f.store.close();
  const reopened = new Store({ dataDir: f.dataDir });
  assert.equal(reopened.executions.get(f.execution.id)!.planRevisionId, next.id);
  assert.equal(reopened.executions.getAttempt(firstAttempt)!.definition!.planRevisionId, f.plan.id);
  assert.equal(reopened.plans.get(f.plan.id)!.graph.nodes.find((node) => node.id === 'c')!.title, 'c', 'old plan remains immutable');
  reopened.close();
});

test('stale edit sessions and newly claimed nodes cannot overwrite another generation', async () => {
  const f = fixture(); f.store.executions.update(f.execution.id, { status: 'paused' }); f.begin();
  const first = f.store.executions.get(f.execution.id)!.editSession!;
  f.engine.plans.abandonEdit(f.task.id, { requestKey: createRequestKey(), editSessionId: first.id, confirmAbandon: true }); f.begin();
  const session = f.store.executions.get(f.execution.id)!.editSession!;
  assert.notEqual(first.id, session.id);
  assert.throws(() => f.engine.plans.editSave(f.task.id, { requestKey: createRequestKey(), editSessionId: first.id, expectedPlanRevisionNumber: 1, changes: [{ nodeId: 'b', title: '旧回调' }] }), /会话已变化/);
  f.store.executions.updateNode(f.execution.id, 'b', { status: 'running', attemptCount: 1 });
  assert.throws(() => f.engine.plans.editSave(f.task.id, { requestKey: createRequestKey(), editSessionId: session.id, expectedPlanRevisionNumber: 1, changes: [{ nodeId: 'b', title: '领取竞态' }] }), /已被领取/);
  assert.equal(f.store.plans.list(f.task.id).length, 1);
  f.engine.executions.shutdown(); f.store.close();
});


test('confirmation rejects attempted-node rewrites and UNKNOWN execution plan switches', () => {
  const f = fixture();
  const attempt = f.store.executions.createAttempt({ executionId: f.execution.id, nodeId: 'a', ordinal: 1 });
  f.store.executions.updateNode(f.execution.id, 'a', { status: 'succeeded', currentAttemptId: attempt.id, attemptCount: 1 });
  f.store.executions.finishAttempt(attempt.id, 'succeeded');
  const changed = f.store.plans.create({ taskId: f.task.id, source: 'edit', graph: { ...f.plan.graph, nodes: f.plan.graph.nodes.map((node) => node.id === 'a' ? { ...node, title: '改写历史' } : node) }, status: 'unconfirmed' });
  assert.throws(() => f.engine.plans.confirm(f.task.id, { requestKey: createRequestKey(), planRevisionId: changed.id, expectedRevisionNumber: changed.revisionNumber, confirmPlan: true }), /已领取或已尝试/);
  assert.equal(f.store.executions.get(f.execution.id)!.planRevisionId, f.plan.id);
  f.store.executions.update(f.execution.id, { status: 'unknown' });
  assert.throws(() => f.engine.executions.validatePlanBinding(f.execution.id, f.plan), /核对停稳/);
  f.engine.executions.shutdown(); f.store.close();
});
