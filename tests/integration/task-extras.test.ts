import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createId,
  createRequestKey,
  nowIso,
  type PlanGraph,
  type PlanNode,
  type TaskTemplate,
} from '@agent-workflow/shared';
import { Store } from '@agent-workflow/storage';
import { TaskExtrasService } from '../../packages/engine/src/task-extras.ts';

/**
 * W3-5 backend core: frozen plan snapshots, audit timeline, B-07 snapshot review
 * read model and run-content grouping. The service is instantiated directly with
 * a real Store — no Engine/HTTP wiring yet.
 */

const TEMPLATE: TaskTemplate = {
  id: 'template.test-review',
  name: '测试评审模板',
  version: 2,
  lockedAfterCreate: true,
  steps: [
    { key: 'review.read-target', title: '读取目标代码', kind: 'design', group: '分析' },
    { key: 'review.write-tests', title: '编写用例', kind: 'implementation', group: '实现' },
    { key: 'review.run-tests', title: '运行测试', kind: 'test', group: '测试' },
    { key: 'review.summary', title: '汇总结果', kind: 'delivery', group: '交付' },
  ],
  parameters: [{ key: 'targetPath', label: '目标代码路径', required: true }],
};

function node(key: string, title: string, kind: PlanNode['kind'], groupId: string, options: { acceptance?: readonly string[]; outputs?: readonly string[]; writes?: readonly string[] } = {}): PlanNode {
  return {
    id: createId('pn'),
    key,
    title,
    kind,
    groupId,
    summary: `${title}（测试步骤）`,
    inputs: [],
    outputs: (options.outputs ?? []).map((name) => ({ name, kind: 'artifact' as const })),
    acceptance: options.acceptance ?? [],
    resources: { read: [], write: (options.writes ?? []).map((label) => ({ kind: 'file' as const, label, basis: 'declared' as const })) },
  };
}

function graphOf(nodes: readonly PlanNode[], groups: readonly { id: string; label: string }[]): PlanGraph {
  return {
    nodes,
    edges: nodes.slice(1).map((item, index) => ({ id: createId('pe'), from: nodes[index]!.id, to: item.id, kind: 'order' as const })),
    groups: groups.map((group) => ({ id: group.id, label: group.label, kind: 'implementation', refined: true, collapsible: true, collapsedByDefault: false })),
  };
}

interface SeedOptions {
  readonly fixedTemplate?: boolean;
  readonly withPlan?: boolean;
  readonly withExecution?: boolean;
  readonly withWorkspace?: boolean;
  readonly withDelivery?: boolean;
}

interface Seeded {
  readonly projectId: string;
  readonly taskId: string;
  readonly planId?: string;
  readonly graph: PlanGraph;
  readonly executionId?: string;
  readonly nodeIds: readonly string[];
}

function seed(store: Store, options: SeedOptions = {}): Seeded {
  const project = store.projects.create({ name: 'Extras', rootPath: '/tmp/extras', gitState: 'git', defaultBranch: 'main' });
  const groups = [{ id: 'group.analysis', label: '分析' }, { id: 'group.impl', label: '实现' }, { id: 'group.test', label: '测试' }, { id: 'group.delivery', label: '交付' }];
  const graph = graphOf(
    [
      node('review.read-target', '读取目标代码', 'design', 'group.analysis', { acceptance: ['已读取目标'], outputs: ['分析记录'], writes: ['docs/analysis.md'] }),
      node('review.write-tests', '编写用例', 'implementation', 'group.impl', { acceptance: ['用例可运行'], outputs: ['测试文件'], writes: ['test/a.test.ts'] }),
      node('review.run-tests', '运行测试', 'test', 'group.test', { outputs: ['测试结果'] }),
      node('review.summary', '汇总结果', 'delivery', 'group.delivery', { outputs: ['汇总报告'] }),
    ],
    groups,
  );
  const task = store.tasks.create({
    projectId: project.id,
    title: '快照评审任务',
    requirementText: 'R1 模板任务',
    methodId: 'method.unit-test-development',
    methodRevision: 'template-v7',
    ...(options.fixedTemplate === false
      ? {}
      : { fixedTemplate: { templateId: TEMPLATE.id, templateVersion: TEMPLATE.version, locked: true as const, parameters: { targetPath: 'src' } } }),
  });
  let planId: string | undefined;
  if (options.withPlan !== false && options.fixedTemplate === undefined) {
    const plan = store.plans.create({ taskId: task.id, source: 'template', graph, status: 'confirmed' });
    planId = plan.id;
    store.tasks.update(task.id, { currentPlanRevisionId: plan.id, stage: 'executing' });
  }
  let executionId: string | undefined;
  if (options.withExecution === true) {
    const plan = planId === undefined ? store.plans.create({ taskId: task.id, source: 'template', graph, status: 'confirmed' }) : store.plans.get(planId)!;
    planId = plan.id;
    store.tasks.update(task.id, { currentPlanRevisionId: plan.id, stage: 'executing' });
    const execution = store.executions.create({ taskId: task.id, planRevisionId: plan.id, graph, autoAdvance: false });
    executionId = execution.id;
    store.tasks.update(task.id, { executionId: execution.id });
    store.executions.update(execution.id, { status: 'running' });
    const [read, write, run, summary] = graph.nodes;
    store.executions.updateNode(execution.id, read!.id, { status: 'succeeded', attemptCount: 1 });
    store.executions.updateNode(execution.id, write!.id, { status: 'succeeded', attemptCount: 1 });
    store.executions.updateNode(execution.id, run!.id, { status: 'running', attemptCount: 1 });
    store.executions.updateNode(execution.id, summary!.id, { status: 'pending', attemptCount: 0 });
    const readAttempt = store.executions.createAttempt({ executionId: execution.id, nodeId: read!.id, ordinal: 1 });
    store.executions.finishAttempt(readAttempt.id, 'succeeded', { resultRevision: 'res1', summary: '已读取目标代码', artifacts: [], errors: [], warnings: [], verification: { state: 'passed', passed: 2, failed: 0, summary: '2 项通过' } });
    store.executions.updateNode(execution.id, read!.id, { currentAttemptId: readAttempt.id });
    store.executions.appendOutput({ attemptId: readAttempt.id, seq: 1, fragment: { fragmentId: 'f1', seq: 1, category: 'model_text', text: '读取完成', recordedAt: nowIso() } });
    const writeAttempt = store.executions.createAttempt({ executionId: execution.id, nodeId: write!.id, ordinal: 1 });
    store.executions.finishAttempt(writeAttempt.id, 'succeeded', { resultRevision: 'res2', summary: '已编写用例', artifacts: [], errors: [], warnings: [] });
    store.executions.updateNode(execution.id, write!.id, { currentAttemptId: writeAttempt.id });
  }
  if (options.withWorkspace === true) {
    const workspace = store.workspaces.create({ taskId: task.id, kind: 'git_worktree', originalRootDisplay: '/tmp/extras', baseRef: 'main' });
    store.workspaces.update(workspace.id, { state: 'ready', branch: 'task/extras', baseSha: 'b71e04c' });
    store.tasks.update(task.id, { workspaceId: workspace.id });
  }
  if (options.withDelivery === true) {
    const delivery = store.deliveries.create({ taskId: task.id, workspaceId: createId('ws'), changesRevision: 'rev1', eligibility: { allowed: true } });
    store.deliveries.update(delivery.id, {
      goal: 'create_merge_request',
      steps: [
        { step: 'commit', state: 'succeeded', requestKey: createRequestKey(), settledAt: nowIso(), commitSha: '9f3c2a7aa' },
        { step: 'push', state: 'succeeded', requestKey: createRequestKey(), settledAt: nowIso(), remoteRef: 'refs/heads/task/extras', pushedSha: '9f3c2a7bb' },
      ],
    });
    store.tasks.update(task.id, { deliveryId: delivery.id });
  }
  return { projectId: project.id, taskId: task.id, planId, graph, executionId, nodeIds: graph.nodes.map((item) => item.id) };
}

function serviceFor(store: Store): TaskExtrasService {
  return new TaskExtrasService({ store, templates: () => [TEMPLATE], actor: () => '本地操作员' });
}

function newStore(label: string): Store {
  return new Store({ dataDir: mkdtempSync(join(tmpdir(), `aw-extras-${label}-`)) });
}

test('freezing a plan snapshot is idempotent, attributed locally and never mutates the execution', () => {
  const store = newStore('freeze');
  try {
    const seeded = seed(store, { withExecution: true, withWorkspace: true });
    const service = serviceFor(store);
    const executionBefore = store.executions.get(seeded.executionId!)!;
    const requestKey = createRequestKey();
    const frozen = service.freezePlan(seeded.taskId, { requestKey, note: '执行前冻结', actor: '王工' });
    assert.equal(frozen.replayed, false);
    assert.equal(frozen.snapshot.actor, '王工');
    assert.equal(frozen.snapshot.note, '执行前冻结');
    assert.equal(frozen.snapshot.planRevisionId, seeded.planId);
    assert.equal(frozen.snapshot.planRevisionNumber, 1);
    assert.equal(frozen.snapshot.planStatus, 'confirmed');
    assert.equal(frozen.snapshot.summary.nodes, 4);
    assert.equal(frozen.snapshot.summary.groups, 4);
    assert.deepEqual(frozen.snapshot.summary.groupLabels, ['分析', '实现', '测试', '交付']);
    assert.equal(frozen.snapshot.executionAtFreeze?.status, 'running');
    assert.equal(frozen.snapshot.template?.id, TEMPLATE.id);
    assert.match(frozen.snapshot.planHash, /^[0-9a-f]{64}$/);
    // Freezing writes settings only: the durable execution view is untouched.
    assert.deepEqual(store.executions.get(seeded.executionId!), executionBefore);

    // Same requestKey / same plan revision replay the stored snapshot.
    const replayByKey = service.freezePlan(seeded.taskId, { requestKey, note: '执行前冻结', actor: '王工' });
    assert.equal(replayByKey.replayed, true);
    assert.equal(replayByKey.snapshot.snapshotId, frozen.snapshot.snapshotId);
    const replayByPlan = service.freezePlan(seeded.taskId, { requestKey: createRequestKey() });
    assert.equal(replayByPlan.replayed, true);
    assert.equal(service.listPlanFreezes(seeded.taskId).length, 1, 'no duplicate freeze for the same plan revision');
    assert.equal(service.latestPlanFreeze(seeded.taskId)?.snapshotId, frozen.snapshot.snapshotId);

    // A new plan revision produces a new snapshot (newest first).
    const secondPlan = store.plans.create({ taskId: seeded.taskId, source: 'applied', graph: seeded.graph, status: 'unconfirmed' });
    store.tasks.update(seeded.taskId, { currentPlanRevisionId: secondPlan.id });
    const second = service.freezePlan(seeded.taskId, { planRevisionId: secondPlan.id });
    assert.equal(second.replayed, false);
    assert.notEqual(second.snapshot.snapshotId, frozen.snapshot.snapshotId);
    assert.equal(service.listPlanFreezes(seeded.taskId).length, 2);
    assert.equal(service.latestPlanFreeze(seeded.taskId)?.planRevisionId, secondPlan.id);
  } finally {
    store.close();
  }
});

test('freezing reports honest errors for unknown tasks and missing plans', () => {
  const store = newStore('freeze-errors');
  try {
    const service = serviceFor(store);
    assert.throws(() => service.freezePlan('task_missing'), (error: unknown) => (error as { code?: string }).code === 'NOT_FOUND');
    assert.throws(() => service.latestPlanFreeze('task_missing'), (error: unknown) => (error as { code?: string }).code === 'NOT_FOUND');
    const project = store.projects.create({ name: 'No plan', rootPath: '/tmp/no-plan', gitState: 'not_git' });
    const task = store.tasks.create({ projectId: project.id, title: '无计划', requirementText: 'R1', methodId: 'method.manual', methodRevision: 'r1' });
    assert.throws(() => service.freezePlan(task.id), (error: unknown) => (error as { code?: string }).code === 'NOT_FOUND');
    assert.deepEqual(service.listPlanFreezes(task.id), []);
    assert.equal(service.latestPlanFreeze(task.id), undefined);
  } finally {
    store.close();
  }
});

test('audit timeline merges events and the operation ledger, newest first, with pagination', () => {
  const store = newStore('audit');
  try {
    const seeded = seed(store, { withExecution: true });
    const projectId = seeded.projectId;
    const confirmKey = createRequestKey();
    store.operations.accept({ requestKey: confirmKey, operation: 'plan.confirm', bodyHash: 'h1', contractVersion: '1', target: { taskId: seeded.taskId } });
    store.operations.settle(confirmKey, 'succeeded', { outcome: { planRevisionId: seeded.planId } });
    store.events.publish('plan.changed', { taskId: seeded.taskId, planRevisionId: seeded.planId!, revisionNumber: 1, status: 'confirmed' });
    // operation.settled events are de-duplicated against the ledger entry.
    store.events.publish('operation.settled', { requestKey: confirmKey, operation: 'plan.confirm', status: 'succeeded', target: seeded.taskId });
    store.events.publish('execution.changed', { taskId: seeded.taskId, executionId: seeded.executionId!, status: 'running', revision: 1 });
    store.events.publish('task.changed', { taskId: seeded.taskId, projectId, stage: 'executing', revision: 2 });
    store.events.publish('task.delivery.updated', { taskId: seeded.taskId, deliveryId: 'dlv_x', revision: '1', projection: 'awaiting_selection' });
    const acceptKey = createRequestKey();
    store.operations.accept({ requestKey: acceptKey, operation: 'node.accept', bodyHash: 'h2', contractVersion: '1', target: { taskId: seeded.taskId, executionId: seeded.executionId, ref: seeded.nodeIds[0] } });
    store.operations.settle(acceptKey, 'succeeded');

    const service = serviceFor(store);
    const page = service.audit(seeded.taskId, { limit: 3 });
    assert.equal(page.taskId, seeded.taskId);
    assert.equal(page.total, 6, JSON.stringify(page.items.map((entry) => entry.action)));
    assert.equal(page.items.length, 3);
    assert.ok(page.nextCursor !== undefined);
    const secondPage = service.audit(seeded.taskId, { limit: 3, cursor: page.nextCursor });
    assert.equal(secondPage.items.length, 3);
    assert.equal(secondPage.nextCursor, undefined);
    const all = [...page.items, ...secondPage.items];
    const actions = all.map((entry) => entry.action);
    for (const expected of ['delivery.updated', 'task.changed', 'execution.changed', 'plan.changed', 'plan.confirm', 'node.accept']) {
      assert.ok(actions.includes(expected), `${expected} in ${JSON.stringify(actions)}`);
    }
    const planConfirmEntries = all.filter((entry) => entry.action === 'plan.confirm');
    assert.equal(planConfirmEntries.length, 1, 'ledger + operation.settled event are de-duplicated');
    assert.equal(planConfirmEntries[0]?.source, 'operation');
    assert.equal(planConfirmEntries[0]?.status, 'succeeded');
    assert.equal(planConfirmEntries[0]?.requestKey, confirmKey);

    const filtered = service.audit(seeded.taskId, { kinds: ['execution.'] });
    assert.equal(filtered.total, 1);
    assert.equal(filtered.items[0]?.action, 'execution.changed');
    assert.equal(filtered.items[0]?.refs.executionId, seeded.executionId);

    assert.throws(() => service.audit('task_missing'), (error: unknown) => (error as { code?: string }).code === 'NOT_FOUND');
    assert.throws(() => service.audit(seeded.taskId, { cursor: '-1' }), (error: unknown) => (error as { code?: string }).code === 'VALIDATION_FAILED');
    assert.throws(() => service.audit(seeded.taskId, { cursor: 'abc' }), (error: unknown) => (error as { code?: string }).code === 'VALIDATION_FAILED');
  } finally {
    store.close();
  }
});

test('ordinary fixed templates never acquire snapshot-review applicability from execution facts', () => {
  const store = newStore('ordinary-template');
  try {
    const service = serviceFor(store);
    for (const options of [{ withExecution: true, withWorkspace: true, withDelivery: true }, { withPlan: false }, { fixedTemplate: false, withExecution: true }]) {
      const task = seed(store, options);
      const model = service.snapshotReview(task.taskId);
      assert.equal(model.applicable, false);
      assert.equal(model.readOnly, true);
      assert.equal(model.scope, undefined);
      assert.equal(model.progress, undefined);
      assert.equal(model.batches, undefined);
      assert.equal(model.partialReport.available, false);
      assert.match(model.reason ?? '', /snapshot/);
    }
  } finally { store.close(); }
});

test('run content aggregates plan nodes, latest attempts and outputs into honest category groups', () => {
  const store = newStore('run-content');
  try {
    const seeded = seed(store, { withExecution: true, withWorkspace: true, withDelivery: true });
    const service = serviceFor(store);
    const model = service.runContent(seeded.taskId);
    assert.equal(model.available, true);
    assert.equal(model.planRevisionId, seeded.planId);
    assert.equal(model.executionId, seeded.executionId);
    assert.equal(model.workspace?.state, 'ready');
    assert.equal(model.workspace?.baseSha, 'b71e04c');
    assert.equal(model.deliveryEvidence?.pushedSha, '9f3c2a7bb');
    assert.equal(model.deliveryEvidence?.commitSha, '9f3c2a7aa');
    assert.equal(model.totals.nodes, 4);
    assert.equal(model.totals.attempts, 2);
    assert.equal(model.totals.fragments, 1);
    const categories = model.groups.map((group) => group.category);
    assert.deepEqual(categories, ['documents', 'source', 'tests', 'other']);
    const documents = model.groups.find((group) => group.category === 'documents')!;
    const source = model.groups.find((group) => group.category === 'source')!;
    const tests = model.groups.find((group) => group.category === 'tests')!;
    assert.equal(documents.nodes[0]?.key, 'review.read-target');
    assert.equal(documents.nodes[0]?.latestAttempt?.verification?.state, 'passed');
    assert.equal(documents.nodes[0]?.latestAttempt?.fragmentCount, 1);
    assert.deepEqual(documents.nodes[0]?.outputs, ['分析记录']);
    assert.deepEqual(documents.nodes[0]?.writes, ['docs/analysis.md']);
    assert.equal(source.nodes[0]?.key, 'review.write-tests');
    assert.equal(source.nodes[0]?.latestAttempt?.verification, undefined, 'no invented verification');
    assert.equal(tests.nodes[0]?.status, 'running');
    assert.equal(tests.nodes[0]?.latestAttempt, undefined);

    const noPlan = seed(store, { fixedTemplate: false, withPlan: false });
    const empty = service.runContent(noPlan.taskId);
    assert.equal(empty.available, false);
    assert.deepEqual(empty.groups, []);
    assert.match(empty.note, /还没有确认计划/);
    assert.throws(() => service.runContent('task_missing'), (error: unknown) => (error as { code?: string }).code === 'NOT_FOUND');
  } finally {
    store.close();
  }
});
