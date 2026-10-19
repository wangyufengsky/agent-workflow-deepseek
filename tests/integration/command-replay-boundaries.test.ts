import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '@agent-workflow/storage';
import { createRequestKey, type OperationKindValue, type CommandResponse, type PlanGraph } from '@agent-workflow/shared';
import { stableHash } from '../../packages/engine/src/operations.ts';
import { Engine } from '../../packages/engine/src/index.ts';

function fixture() {
  const store = new Store({ dataDir: mkdtempSync(join(tmpdir(), 'aw-receipt-boundary-')) });
  let mutations = 0;
  let resolvePush: ((result: { pushedSha: string; remoteRef: string }) => void) | undefined;
  const git = { push: () => { mutations++; return new Promise<{ pushedSha: string; remoteRef: string }>((resolve) => { resolvePush = resolve; }); } };
  const engine = new Engine({ store, ports: { git: git as never, opencode: { status: () => ({ state: 'ready' }), findSessions: async () => [], ensureReady: async () => {} } as never }, integration: { opencodeReady: () => true, gitlabConfigured: () => false } });
  const project = store.projects.create({ name: 'receipt', rootPath: store.dataDir, gitState: 'git' });
  const task = store.tasks.create({ projectId: project.id, title: 'receipt', requirementText: 'offline', methodId: 'method.requirement-development', methodRevision: 'r12', fixedTemplate: { templateId: 'template.unit-test', templateVersion: 7, locked: true, parameters: {} } });
  const graph: PlanGraph = { nodes: [{ id: 'a', key: 'a', title: 'A', kind: 'implementation', groupId: 'g', summary: '', inputs: [], outputs: [], acceptance: [], resources: { read: [], write: [] } }], edges: [], groups: [{ id: 'g', label: '实现', kind: 'implementation', refined: true, collapsible: false, collapsedByDefault: false }] };
  const plan = store.plans.create({ taskId: task.id, source: 'manual', graph, status: 'confirmed' });
  const workspace = store.workspaces.create({ taskId: task.id, kind: 'git_worktree', displayRoot: store.dataDir }); store.workspaces.update(workspace.id, { state: 'ready' });
  const execution = store.executions.create({ taskId: task.id, planRevisionId: plan.id, graph, autoAdvance: false });
  const delivery = store.deliveries.create({ taskId: task.id, workspaceId: workspace.id, eligibility: { allowed: true } });
  store.tasks.update(task.id, { executionId: execution.id, workspaceId: workspace.id, currentPlanRevisionId: plan.id, deliveryId: delivery.id });
  return { store, engine, task, project, plan, workspace, execution, delivery, mutations: () => mutations, resolvePush: () => resolvePush?.({ pushedSha: 'abc', remoteRef: 'refs/heads/task' }), close: () => { engine.executions.shutdown(); store.close(); } };
}

test('every scoped write returns original succeeded/failed/accepted/unknown receipts before changed state guards', async () => {
  const f = fixture();
  type Case = { op: OperationKindValue; body: Record<string, unknown>; run: (requestKey: string) => CommandResponse<unknown> | Promise<CommandResponse<unknown>> };
  const taskId = f.task.id;
  const cases: Case[] = [
    ...(['start', 'retry', 'cancel'] as const).map((method): Case => ({ op: `execution.${method}`, body: { taskId, confirm: true }, run: (requestKey) => f.engine.executions[method](taskId, { requestKey, confirm: true }) })),
    ...(['pause', 'resume'] as const).map((method): Case => ({ op: `execution.${method}`, body: { taskId }, run: (requestKey) => f.engine.executions[method](taskId, { requestKey, confirm: true }) })),
    { op: 'execution.autoAdvance', body: { taskId, autoAdvance: true, confirmChange: true }, run: (requestKey) => f.engine.executions.setAutoAdvance(taskId, { requestKey, autoAdvance: true, confirmChange: true }) },
    { op: 'execution.advance', body: { taskId, nodeId: null, confirmAdvance: true }, run: (requestKey) => f.engine.executions.advance(taskId, { requestKey, confirmAdvance: true }) },
    { op: 'execution.skipNode', body: { taskId, nodeId: 'a', confirmSkip: true }, run: (requestKey) => f.engine.executions.skipNode(taskId, 'a', { requestKey, nodeId: 'a', confirmSkip: true }) },
    { op: 'plan.skeleton.use', body: { taskId, confirmUseSkeleton: true }, run: (requestKey) => f.engine.plans.useSkeleton(taskId, { requestKey, confirmUseSkeleton: true }) },
    { op: 'plan.template.use', body: { taskId, templateId: 'template.unit-test', templateVersion: 7, confirmUseTemplate: true }, run: (requestKey) => f.engine.plans.useTemplate(taskId, { requestKey, confirmUseTemplate: true }) },
    { op: 'plan.confirm', body: { taskId, planRevisionId: f.plan.id, expectedRevisionNumber: 1, confirmPlan: true }, run: (requestKey) => f.engine.plans.confirm(taskId, { requestKey, planRevisionId: f.plan.id, expectedRevisionNumber: 1, confirmPlan: true }) },
    { op: 'plan.edit.begin', body: { taskId, planRevisionId: f.plan.id, confirmPause: true }, run: (requestKey) => f.engine.plans.editBegin(taskId, { requestKey, planRevisionId: f.plan.id, confirmPause: true }) },
    { op: 'plan.edit.save', body: { taskId, editSessionId: 'old-session', changes: [], expectedPlanRevisionNumber: 1 }, run: (requestKey) => f.engine.plans.editSave(taskId, { requestKey, editSessionId: 'old-session', changes: [], expectedPlanRevisionNumber: 1 }) },
    { op: 'plan.edit.finish', body: { taskId, editSessionId: 'old-session', continueExecution: true }, run: (requestKey) => f.engine.plans.editFinish(taskId, { requestKey, editSessionId: 'old-session', continueExecution: true }) },
    { op: 'plan.edit.abandon', body: { taskId, editSessionId: 'old-session', confirmAbandon: true }, run: (requestKey) => f.engine.plans.abandonEdit(taskId, { requestKey, editSessionId: 'old-session', confirmAbandon: true }) },
    ...(['accept', 'reject'] as const).map((verdict): Case => ({ op: `node.${verdict}`, body: { taskId, nodeId: 'a', verdict: verdict === 'accept' ? 'accepted' : 'rejected', note: '原始意见' }, run: (requestKey) => verdict === 'accept' ? f.engine.plans.acceptNode(taskId, 'a', { requestKey, note: '原始意见', confirmAccept: true }) : f.engine.plans.rejectNode(taskId, 'a', { requestKey, note: '原始意见', confirmReject: true }) })),
    { op: 'task.workspace.prepare', body: { taskId, expectedPlanRevisionNumber: 1, baselineSelectionRef: 'original', confirmPrepare: true }, run: (requestKey) => f.engine.workspaces.prepare(taskId, { requestKey, expectedPlanRevisionNumber: 1, baselineSelectionRef: 'original', confirmPrepare: true }) },
    { op: 'task.workspace.cleanup.confirm', body: { taskId, previewRef: 'old-preview', workspaceRevision: 'old-revision', confirmCleanup: true }, run: (requestKey) => f.engine.workspaces.cleanupConfirm(taskId, { requestKey, previewRef: 'old-preview', workspaceRevision: 'old-revision', confirmCleanup: true }) },
    { op: 'task.delivery.select', body: { taskId, goal: 'local_commit', fileIds: [], changesRevision: 'old' }, run: (requestKey) => f.engine.deliveries.select(taskId, { requestKey, goal: 'local_commit', fileIds: [], changesRevision: 'old' }) },
    { op: 'task.delivery.commit', body: { taskId, fileIds: [], message: 'original', expectedChangesRevision: 'old', expectedBranchHead: 'base', confirmCommit: true }, run: (requestKey) => f.engine.deliveries.commit(taskId, { requestKey, fileIds: [], message: 'original', expectedChangesRevision: 'old', expectedBranchHead: 'base', confirmCommit: true }) },
    { op: 'task.delivery.push', body: { taskId, expectedLocalSha: 'abc', remoteBranchName: 'task', expectRemote: 'absent' as const, confirmPush: true }, run: (requestKey) => f.engine.deliveries.push(taskId, { requestKey, expectedLocalSha: 'abc', remoteBranchName: 'task', expectRemote: 'absent' as const, confirmPush: true }) },
    { op: 'task.delivery.mergeRequest.create', body: { taskId, sourceRef: 'task', pushedSha: 'abc', targetBranch: 'main', expectedTargetTip: 'base', title: 'MR', description: '', confirmMergeRequest: true }, run: (requestKey) => f.engine.deliveries.createMergeRequest(taskId, { requestKey, sourceRef: 'task', pushedSha: 'abc', targetBranch: 'main', expectedTargetTip: 'base', title: 'MR', description: '', confirmMergeRequest: true }) },
    { op: 'task.delivery.merge', body: { taskId, targetBranch: 'main', expectedTargetSha: 'base', sourceSha: 'abc', message: 'original', strategy: 'no_ff', confirmMerge: true }, run: (requestKey) => f.engine.deliveries.merge(taskId, { requestKey, targetBranch: 'main', expectedTargetSha: 'base', sourceSha: 'abc', message: 'original', strategy: 'no_ff', confirmMerge: true }) },
    { op: 'task.accept', body: { taskId, verdict: 'accepted', note: 'original' }, run: (requestKey) => f.engine.acceptances.decide(taskId, { requestKey, verdict: 'accepted', note: 'original', confirmDecide: true }) },
    { op: 'task.updateDraft', body: { taskId, title: 'original' }, run: (requestKey) => f.engine.tasks.updateDraft(taskId, { requestKey, title: 'original' }) },
  ];
  f.store.tasks.update(taskId, { readOnly: true, stage: 'executing' });
  f.store.plans.setStatus(f.plan.id, 'superseded');
  f.store.workspaces.update(f.workspace.id, { state: 'cleaned' });
  f.store.executions.update(f.execution.id, { status: 'completed' });
  try {
    for (const entry of cases) for (const status of ['succeeded', 'failed', 'accepted', 'unknown'] as const) {
      const requestKey = createRequestKey();
      f.engine.commands.begin({ requestKey, operation: entry.op, body: entry.body, target: { taskId } });
      if (status !== 'accepted') f.store.operations.settle(requestKey, status, { outcome: { original: true } });
      const before = f.store.operations.get(requestKey)!;
      const response = await entry.run(requestKey);
      assert.equal(response.receipt.status, status, `${entry.op}/${status}`);
      assert.equal(response.receipt.auditId, before.auditId);
      assert.deepEqual(f.store.operations.get(requestKey), before, 'replay never settles or reconciles');
    }
    assert.equal(f.mutations(), 0);
    assert.equal(f.store.plans.list(taskId).length, 1);
    assert.equal(f.store.executions.listAttempts(f.execution.id).length, 0);
  } finally { f.close(); }
});

test('a concurrent accepted remote write calls its adapter once; unknown replay is a pure receipt read', async () => {
  const f = fixture();
  try {
    const input = { requestKey: createRequestKey(), expectedLocalSha: 'abc', remoteBranchName: 'task', expectRemote: 'absent' as const, confirmPush: true as const };
    const pending = f.engine.deliveries.push(f.task.id, input);
    assert.equal(f.mutations(), 1);
    const accepted = await f.engine.deliveries.push(f.task.id, input);
    assert.equal(accepted.receipt.status, 'accepted'); assert.equal(f.mutations(), 1);
    f.resolvePush(); assert.equal((await pending).receipt.status, 'succeeded');
    assert.equal((await f.engine.deliveries.push(f.task.id, input)).receipt.status, 'succeeded');
    assert.equal(f.mutations(), 1);
    f.store.operations.settle(input.requestKey, 'unknown');
    assert.equal((await f.engine.deliveries.push(f.task.id, input)).receipt.status, 'unknown');
    assert.equal(f.mutations(), 1);
    await assert.rejects(f.engine.deliveries.push(f.task.id, { ...input, remoteBranchName: 'changed' }), (error: { code?: string }) => error.code === 'REQUEST_KEY_REUSED');
    assert.equal(f.store.operations.get(input.requestKey)!.status, 'unknown');
  } finally { f.close(); }
});

test('request identity includes operation and request selection fields; accepted task creation never duplicates a task', () => {
  const f = fixture();
  try {
    const requestKey = createRequestKey();
    f.engine.commands.begin({ requestKey, operation: 'execution.pause', body: { taskId: f.task.id }, target: { taskId: f.task.id } });
    assert.throws(() => f.engine.executions.resume(f.task.id, { requestKey, confirm: true }), (error: { code?: string }) => error.code === 'REQUEST_KEY_REUSED');
    assert.throws(() => f.engine.commands.begin({ requestKey, operation: 'execution.resume', body: { taskId: f.task.id }, target: { taskId: f.task.id } }), (error: { code?: string }) => error.code === 'REQUEST_KEY_REUSED');
    const create = { requestKey: createRequestKey(), projectId: f.project.id, title: 'new', requirementText: 'new', methodId: 'method.requirement-development' };
    f.engine.commands.begin({ requestKey: create.requestKey, operation: 'task.create', body: { projectId: create.projectId, title: create.title, requirementText: create.requirementText, methodId: create.methodId }, target: { projectId: create.projectId } });
    assert.equal(f.engine.tasks.create(create).receipt.status, 'accepted');
    assert.equal(f.store.tasks.list().length, 1);
  } finally { f.close(); }
});

test('expired planning previews and missing review/fix resources cannot invalidate or redispatch an original receipt', async () => {
  const f = fixture();
  const { ReviewService } = await import('../../packages/engine/src/review.ts');
  const { FixService } = await import('../../packages/engine/src/fix.ts');
  const options = { store: f.store, commands: f.engine.commands, context: f.engine.context, git: f.engine.ports.git, opencode: f.engine.ports.opencode, catalog: f.engine.catalog };
  const reviews = new ReviewService(options); const fixes = new FixService(options);
  f.store.tasks.update(f.task.id, { readOnly: true });
  f.engine.updateSettings({ ...f.engine.settings, models: f.engine.settings.models.map((model) => ({ ...model, enabled: false })) });
  type Case = { op: OperationKindValue; body: Record<string, unknown>; run: (requestKey: string) => CommandResponse<unknown> | Promise<CommandResponse<unknown>> };
  const taskId = f.task.id; const projectId = f.project.id; const fixRunId = 'fix_missing';
  const cases: Case[] = [
    { op: 'planning.start', body: { taskId, previewId: 'expired', sourceInputRevision: 1, confirmModelDispatch: true }, run: (requestKey) => f.engine.planning.start(taskId, { requestKey, previewId: 'expired', sourceInputRevision: 1, confirmModelDispatch: true }) },
    { op: 'planning.stop', body: { taskId, roundId: 'round_missing', confirmStop: true }, run: (requestKey) => f.engine.planning.stop(taskId, { requestKey, roundId: 'round_missing', confirmStop: true }) },
    { op: 'planning.apply', body: { taskId, roundId: 'round_missing', candidatePlanRevisionId: 'plan_missing', acceptedDecisionIds: [], confirmApply: true }, run: (requestKey) => f.engine.planning.apply(taskId, { requestKey, roundId: 'round_missing', candidatePlanRevisionId: 'plan_missing', acceptedDecisionIds: [], confirmApply: true }) },
    { op: 'planning.reject', body: { taskId, roundId: 'round_missing', reason: 'original', confirmReject: true }, run: (requestKey) => f.engine.planning.reject(taskId, { requestKey, roundId: 'round_missing', reason: 'original', confirmReject: true }) },
    { op: 'requirement.answer.save', body: { taskId, roundId: 'round_missing', answers: [] }, run: (requestKey) => f.engine.planning.saveAnswer(taskId, { requestKey, roundId: 'round_missing', answers: [] }) },
    { op: 'review.start', body: { projectId, sha: 'abc123', compareId: 'parent', dimensions: ['correctness'], context: 'diff_only', professionId: 'removed-role', professionRevision: 'old', model: 'removed-model' }, run: (requestKey) => reviews.start(projectId, { requestKey, projectId, sha: 'abc123', compareId: 'parent', dimensions: ['correctness'], context: 'diff_only', professionId: 'removed-role', professionRevision: 'old' }) },
    { op: 'review.stop', body: { projectId, reviewRunId: 'missing' }, run: (requestKey) => reviews.stop(projectId, 'missing', { requestKey }) },
    { op: 'review.finding.update', body: { projectId, findingId: 'missing', status: 'open', reason: 'original', expectedStatusRevision: 'old' }, run: (requestKey) => reviews.updateFinding(projectId, 'missing', { requestKey, projectId, findingId: 'missing', status: 'open', reason: 'original', expectedStatusRevision: 'old' }) },
    { op: 'fix.start', body: { projectId, reviewRunId: 'missing', findingIds: ['missing'], baseBranch: 'main', expectedBaseTip: 'abc1234', professionId: 'removed-role', professionRevision: 'old', model: 'removed-model' }, run: (requestKey) => fixes.start(projectId, { requestKey, projectId, reviewRunId: 'missing', findingIds: ['missing'], baseBranch: 'main', expectedBaseTip: 'abc1234', professionId: 'removed-role', professionRevision: 'old' }) },
    { op: 'fix.stop', body: { projectId, fixRunId }, run: (requestKey) => fixes.stop(projectId, fixRunId, { requestKey }) },
    { op: 'fix.file.revert', body: { projectId, fixRunId, fileId: 'file_missing', expectedFixRevision: 'old' }, run: (requestKey) => fixes.revertFile(projectId, fixRunId, { requestKey, projectId, fixRunId, fileId: 'file_missing', expectedFixRevision: 'old' }) },
    { op: 'fix.commit', body: { projectId, fixRunId, message: 'original', fileIds: [], expectedFixRevision: 'old', confirmVerifyFailed: false }, run: (requestKey) => fixes.commit(projectId, fixRunId, { requestKey, projectId, fixRunId, message: 'original', fileIds: [], expectedFixRevision: 'old' }) },
    { op: 'fix.merge', body: { projectId, fixRunId, expectedBaseTip: 'abc1234', message: 'original frozen default', strategy: 'no_ff', confirmMerge: true }, run: (requestKey) => fixes.merge(projectId, fixRunId, { requestKey, projectId, fixRunId, expectedBaseTip: 'abc1234', confirmMerge: true }) },
    { op: 'fix.push', body: { projectId, fixRunId, expectedLocalSha: 'abc1234' }, run: (requestKey) => fixes.push(projectId, fixRunId, { requestKey, projectId, fixRunId, expectedLocalSha: 'abc1234' }) },
    { op: 'fix.mergeRequest.create', body: { projectId, fixRunId, targetBranch: 'main', title: 'original', description: '' }, run: (requestKey) => fixes.createMergeRequest(projectId, fixRunId, { requestKey, projectId, fixRunId, targetBranch: 'main', title: 'original', description: '' }) },
    { op: 'fix.discard', body: { projectId, fixRunId, confirmDiscard: true }, run: (requestKey) => fixes.discard(projectId, fixRunId, { requestKey, projectId, fixRunId, confirmDiscard: true }) },
    { op: 'task.recovery.create', body: { parentTaskId: taskId, mode: 'from_failed_stage', note: '' }, run: (requestKey) => f.engine.recoveries.create(taskId, { requestKey, mode: 'from_failed_stage', confirmCreate: true }) },
  ];
  try {
    for (const entry of cases) for (const status of ['succeeded', 'accepted', 'unknown'] as const) {
      const requestKey = createRequestKey();
      f.engine.commands.begin({ requestKey, operation: entry.op, body: entry.body, target: { projectId, taskId } });
      if (status !== 'accepted') f.store.operations.settle(requestKey, status);
      const response = await entry.run(requestKey);
      assert.equal(response.receipt.status, status, `${entry.op}/${status}`);
      assert.equal(f.store.operations.get(requestKey)!.status, status);
    }
    assert.equal(f.store.tasks.list().length, 1, 'accepted recovery never copies a new task');
    assert.equal(f.store.planning.list(taskId).length, 0, 'expired preview replay never creates a new round');
    assert.equal(f.mutations(), 0);
  } finally { f.close(); }
});


test('canonical replay snapshots never persist arbitrary credential-bearing command bodies', () => {
  const f = fixture();
  try {
    const key = createRequestKey();
    f.engine.commands.begin({ requestKey: key, operation: 'settings.update', body: { password: 'dummy-not-a-real-secret' }, target: {} });
    assert.equal(f.store.settings.getJson(`operation.body.${key}`), undefined);
    const accepted = createRequestKey();
    f.engine.commands.begin({ requestKey: accepted, operation: 'task.accept', body: { taskId: 'task_removed', verdict: 'accepted', note: '' }, target: { taskId: 'task_removed' } });
    assert.equal(f.engine.acceptances.decide('task_removed', { requestKey: accepted, verdict: 'accepted', confirmDecide: true }).receipt.status, 'accepted');
    const key2 = createRequestKey();
    const task = f.engine.tasks.create({ requestKey: key2, projectId: f.project.id, title: 'created once', requirementText: 'original', methodId: 'method.requirement-development' });
    assert.equal(f.engine.tasks.create({ requestKey: key2, projectId: f.project.id, title: 'created once', requirementText: 'original', methodId: 'method.requirement-development' }).resource!.task.id, task.resource!.task.id, 'create replay resolves its original outcome task instead of losing resource');
  } finally { f.close(); }
});


test('legacy missing-selection hashes replay read-only; new selection hashes cannot be reused', async () => {
  const f = fixture();
  try {
    const requestKey = createRequestKey();
    const oldBody = { taskId: f.task.id, expectedPlanRevisionNumber: 1, confirmPrepare: true };
    f.store.operations.accept({ requestKey, operation: 'task.workspace.prepare', bodyHash: stableHash(oldBody), contractVersion: '1', target: { taskId: f.task.id } });
    f.store.operations.settle(requestKey, 'unknown');
    assert.equal((await f.engine.workspaces.prepare(f.task.id, { requestKey, expectedPlanRevisionNumber: 1, baselineSelectionRef: 'original', confirmPrepare: true })).receipt.status, 'unknown');
    assert.equal(f.store.operations.get(requestKey)!.bodyHash, stableHash(oldBody), 'legacy ledger is never rewritten');
    const fresh = createRequestKey();
    f.engine.commands.begin({ requestKey: fresh, operation: 'task.workspace.prepare', body: { ...oldBody, baselineSelectionRef: 'original' }, target: { taskId: f.task.id } });
    await assert.rejects(f.engine.workspaces.prepare(f.task.id, { requestKey: fresh, expectedPlanRevisionNumber: 1, baselineSelectionRef: 'changed', confirmPrepare: true }), (error: { code?: string }) => error.code === 'REQUEST_KEY_REUSED');
    assert.equal(f.mutations(), 0);
  } finally { f.close(); }
});
