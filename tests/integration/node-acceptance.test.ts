import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { NodeDetailResponse, PlanGraph } from '@agent-workflow/shared';
import { createApplication } from '../../packages/server/src/index.ts';
import { advanceTargets } from '../../apps/web/src/pages/task/advance.ts';

type App = Awaited<ReturnType<typeof createApplication>>;

test('task detail and manual advance use the actual human acceptance projection', async () => {
  const app = await createApplication({ dataDir: mkdtempSync(join(tmpdir(), 'aw-advance-accept-')), disableOpenCode: true, disableListen: true });
  try {
    const seeded = await seedTask(app, { statuses: ['succeeded', 'pending'] });
    const before = app.engine.tasks.detail(seeded.taskId);
    assert.ok(before.execution?.acceptance?.pending.includes(seeded.nodeIds[0]!));
    assert.equal(advanceTargets(before.plan!, before.execution!, seeded.nodeIds[0]).candidates.length, 0);
    const accepted = await app.app.inject({ method: 'POST', url: `/api/tasks/${seeded.taskId}/nodes/${seeded.nodeIds[0]}/accept`, payload: { requestKey: requestKey('manual-accept'), confirmAccept: true } });
    assert.equal(accepted.statusCode, 200, accepted.body);
    const after = app.engine.tasks.detail(seeded.taskId);
    assert.deepEqual(after.execution?.acceptance?.pending, []);
    assert.ok(advanceTargets(after.plan!, after.execution!, seeded.nodeIds[0]).candidates.length > 0);
    assert.equal(advanceTargets(after.plan!, { ...after.execution!, acceptance: undefined }, seeded.nodeIds[0]).candidates.length, 0, 'legacy missing verdict does not imply accepted');
  } finally { await app.close(); }
});

function requestKey(prefix: string): string {
  return `req_${prefix}${Math.random().toString(36).slice(2, 21)}`;
}

function createRepo(): string {
  const root = mkdtempSync(join(tmpdir(), 'aw-accept-repo-'));
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: root });
  writeFileSync(join(root, 'README.md'), '# accept\n', 'utf8');
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'init'], { cwd: root });
  return root;
}

interface Seeded {
  readonly projectId: string;
  readonly taskId: string;
  readonly plan: { readonly id: string; readonly graph: PlanGraph };
  readonly executionId: string;
  readonly nodeIds: readonly string[];
}

async function seedTask(app: App, options: { readonly statuses?: readonly ('succeeded' | 'running' | 'failed' | 'pending')[] } = {}): Promise<Seeded> {
  const project = await app.app.inject({ method: 'POST', url: '/api/projects', payload: { requestKey: requestKey('prj'), name: 'Node Accept', rootPath: createRepo() } });
  assert.equal(project.statusCode, 201, project.body);
  const projectId = project.json().data.resource.project.id as string;
  const task = await app.app.inject({
    method: 'POST',
    url: '/api/tasks',
    payload: { requestKey: requestKey('task'), projectId, title: '节点验收', requirementText: 'R1 节点验收', methodId: 'method.requirement-development' },
  });
  assert.equal(task.statusCode, 201, task.body);
  const taskId = task.json().data.resource.task.id as string;
  const skeleton = await app.app.inject({ method: 'POST', url: `/api/tasks/${taskId}/plan/skeleton`, payload: { requestKey: requestKey('skel'), confirmUseSkeleton: true } });
  assert.equal(skeleton.statusCode, 200, skeleton.body);
  const plan = skeleton.json().data.resource.plan as { id: string; graph: PlanGraph };
  const execution = app.store.executions.create({ taskId, planRevisionId: plan.id, graph: plan.graph, autoAdvance: false });
  app.store.tasks.update(taskId, { executionId: execution.id });
  app.store.executions.update(execution.id, { status: 'running' });
  const nodeIds = plan.graph.nodes.map((node) => node.id);
  const statuses = options.statuses ?? ['succeeded'];
  statuses.forEach((status, index) => {
    const nodeId = nodeIds[index];
    if (nodeId !== undefined) app.store.executions.updateNode(execution.id, nodeId, { status });
  });
  return { projectId, taskId, plan, executionId: execution.id, nodeIds };
}

async function nodeDetailOf(app: App, taskId: string, nodeId: string): Promise<NodeDetailResponse> {
  const response = await app.app.inject({ method: 'GET', url: `/api/tasks/${taskId}/nodes/${nodeId}` });
  assert.equal(response.statusCode, 200, response.body);
  return response.json().data as NodeDetailResponse;
}

test('W0-4: node accept records an audited verdict without rewriting the execution result', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'aw-accept-'));
  const app = await createApplication({ dataDir, disableOpenCode: true, disableListen: true });
  try {
    const seeded = await seedTask(app, { statuses: ['succeeded', 'running', 'failed'] });
    const target = seeded.nodeIds[0]!;
    const running = seeded.nodeIds[1]!;
    const failed = seeded.nodeIds[2]!;

    const pending = await nodeDetailOf(app, seeded.taskId, target);
    assert.equal(pending.acceptance?.state, 'pending');
    assert.equal(pending.actions.accept?.allowed, true);
    assert.equal(pending.actions.reject?.allowed, true);

    // Running/failed nodes carry no acceptance fact and deny both verdicts.
    const runningDetail = await nodeDetailOf(app, seeded.taskId, running);
    assert.equal(runningDetail.acceptance, undefined);
    assert.equal(runningDetail.actions.accept?.allowed, false);
    assert.match(String(runningDetail.actions.accept?.reason), /尚未成功完成/);
    const failedDetail = await nodeDetailOf(app, seeded.taskId, failed);
    assert.equal(failedDetail.acceptance, undefined);
    assert.equal(failedDetail.actions.reject?.allowed, false);
    assert.match(String(failedDetail.actions.reject?.reason), /重试或跳过/);

    // Missing requestKey / missing confirm are 400 before any domain read.
    const missingKey = await app.app.inject({ method: 'POST', url: `/api/tasks/${seeded.taskId}/nodes/${target}/accept`, payload: { confirmAccept: true } });
    assert.equal(missingKey.statusCode, 400, missingKey.body);
    assert.equal(missingKey.json().error.code, 'VALIDATION_FAILED');
    const noConfirm = await app.app.inject({ method: 'POST', url: `/api/tasks/${seeded.taskId}/nodes/${target}/accept`, payload: { requestKey: requestKey('accept-noconfirm') } });
    assert.equal(noConfirm.statusCode, 400, noConfirm.body);

    const acceptKey = requestKey('accept');
    const payload = { requestKey: acceptKey, confirmAccept: true, note: '结果与验收标准一致' };
    const accepted = await app.app.inject({ method: 'POST', url: `/api/tasks/${seeded.taskId}/nodes/${target}/accept`, payload });
    assert.equal(accepted.statusCode, 200, accepted.body);
    const acceptedData = accepted.json().data as {
      receipt: { requestKey: string; status: string; operation: string };
      resource: { node: NodeDetailResponse };
    };
    assert.equal(acceptedData.receipt.requestKey, acceptKey);
    assert.equal(acceptedData.receipt.status, 'succeeded');
    assert.equal(acceptedData.receipt.operation, 'node.accept');
    assert.equal(acceptedData.resource.node.acceptance?.state, 'accepted');
    assert.equal(acceptedData.resource.node.acceptance?.note, '结果与验收标准一致');
    assert.equal(acceptedData.resource.node.acceptance?.requestKey, acceptKey);
    assert.equal(typeof acceptedData.resource.node.acceptance?.verdictAt, 'string');
    // The verdict is an overlay: node status and execution status are untouched.
    assert.equal(acceptedData.resource.node.execution?.status, 'succeeded');
    assert.equal(app.store.executions.get(seeded.executionId)?.status, 'running');
    assert.deepEqual(app.store.executions.get(seeded.executionId)?.nodes.find((node) => node.nodeId === target)?.status, 'succeeded');

    const afterAccept = await nodeDetailOf(app, seeded.taskId, target);
    assert.equal(afterAccept.acceptance?.state, 'accepted');
    assert.equal(afterAccept.actions.accept?.allowed, false);
    assert.equal(afterAccept.actions.accept?.reasonCode, 'NODE_ACCEPTED');
    // A mistaken verdict can still be corrected to the opposite verdict.
    assert.equal(afterAccept.actions.reject?.allowed, true);

    // Same key + same body replays; same key + different body conflicts.
    const replay = await app.app.inject({ method: 'POST', url: `/api/tasks/${seeded.taskId}/nodes/${target}/accept`, payload });
    assert.equal(replay.statusCode, 200, replay.body);
    assert.equal(replay.json().data.receipt.requestKey, acceptKey);
    const conflict = await app.app.inject({ method: 'POST', url: `/api/tasks/${seeded.taskId}/nodes/${target}/accept`, payload: { ...payload, note: '不同的备注' } });
    assert.equal(conflict.statusCode, 409, conflict.body);
    assert.equal(conflict.json().error.code, 'REQUEST_KEY_REUSED');

    // Repeating the same verdict under a new key is rejected, not re-recorded.
    const duplicate = await app.app.inject({ method: 'POST', url: `/api/tasks/${seeded.taskId}/nodes/${target}/accept`, payload: { requestKey: requestKey('accept-again'), confirmAccept: true } });
    assert.equal(duplicate.statusCode, 400, duplicate.body);
    assert.equal(duplicate.json().error.code, 'VALIDATION_FAILED');
    assert.match(String(duplicate.json().error.message), /已验收通过/);

    // Reject requires a reason and flips the stored verdict.
    const rejectNoNote = await app.app.inject({ method: 'POST', url: `/api/tasks/${seeded.taskId}/nodes/${target}/reject`, payload: { requestKey: requestKey('reject-empty'), confirmReject: true, note: '   ' } });
    assert.equal(rejectNoNote.statusCode, 400, rejectNoNote.body);
    const rejectKey = requestKey('reject');
    const rejected = await app.app.inject({
      method: 'POST',
      url: `/api/tasks/${seeded.taskId}/nodes/${target}/reject`,
      payload: { requestKey: rejectKey, confirmReject: true, note: '导出列名与验收标准不一致，请修改后重新提交' },
    });
    assert.equal(rejected.statusCode, 200, rejected.body);
    const rejectedData = rejected.json().data as { receipt: { operation: string; status: string }; resource: { node: NodeDetailResponse } };
    assert.equal(rejectedData.receipt.operation, 'node.reject');
    assert.equal(rejectedData.receipt.status, 'succeeded');
    assert.equal(rejectedData.resource.node.acceptance?.state, 'rejected');
    assert.match(String(rejectedData.resource.node.acceptance?.note), /验收标准不一致/);
    const afterReject = await nodeDetailOf(app, seeded.taskId, target);
    assert.equal(afterReject.actions.reject?.allowed, false);
    assert.equal(afterReject.actions.reject?.reasonCode, 'NODE_REJECTED');
    assert.equal(afterReject.actions.accept?.allowed, true);
    // Still no execution rewrite after rejection.
    assert.equal(app.store.executions.get(seeded.executionId)?.nodes.find((node) => node.nodeId === target)?.status, 'succeeded');

    // Non-succeeded nodes cannot be decided; unknown ids are 404.
    const acceptRunning = await app.app.inject({ method: 'POST', url: `/api/tasks/${seeded.taskId}/nodes/${running}/accept`, payload: { requestKey: requestKey('accept-running'), confirmAccept: true } });
    assert.equal(acceptRunning.statusCode, 409, acceptRunning.body);
    assert.equal(acceptRunning.json().error.code, 'OPERATION_IN_PROGRESS');
    const rejectFailed = await app.app.inject({ method: 'POST', url: `/api/tasks/${seeded.taskId}/nodes/${failed}/reject`, payload: { requestKey: requestKey('reject-failed'), confirmReject: true, note: '失败' } });
    assert.equal(rejectFailed.statusCode, 409, rejectFailed.body);
    const unknownNode = await app.app.inject({ method: 'POST', url: `/api/tasks/${seeded.taskId}/nodes/node_missing/accept`, payload: { requestKey: requestKey('accept-node'), confirmAccept: true } });
    assert.equal(unknownNode.statusCode, 404, unknownNode.body);
    const unknownTask = await app.app.inject({ method: 'POST', url: '/api/tasks/task_missing/nodes/node_a/accept', payload: { requestKey: requestKey('accept-task'), confirmAccept: true } });
    assert.equal(unknownTask.statusCode, 404, unknownTask.body);
  } finally {
    await app.close();
  }
});

test('W0-4: node verdicts persist across a restart and stay independent from task acceptance', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'aw-accept-persist-'));
  const first = await createApplication({ dataDir, disableOpenCode: true, disableListen: true });
  let taskId = '';
  let nodeId = '';
  try {
    const seeded = await seedTask(first, { statuses: ['succeeded'] });
    taskId = seeded.taskId;
    nodeId = seeded.nodeIds[0]!;
    const accepted = await first.app.inject({ method: 'POST', url: `/api/tasks/${taskId}/nodes/${nodeId}/accept`, payload: { requestKey: requestKey('accept'), confirmAccept: true, note: '保存前验收' } });
    assert.equal(accepted.statusCode, 200, accepted.body);

    // Task-level acceptance is a separate record and must still work.
    const taskAcceptance = await first.app.inject({
      method: 'POST',
      url: `/api/tasks/${taskId}/acceptance`,
      payload: { requestKey: requestKey('task-accept'), verdict: 'accepted', note: '任务级结论', confirmDecide: true },
    });
    assert.equal(taskAcceptance.statusCode, 200, taskAcceptance.body);
    assert.equal(taskAcceptance.json().data.resource.acceptance.verdict, 'accepted');
  } finally {
    await first.close();
  }

  const second = await createApplication({ dataDir, disableOpenCode: true, disableListen: true });
  try {
    const restored = await nodeDetailOf(second, taskId, nodeId);
    assert.equal(restored.acceptance?.state, 'accepted');
    assert.equal(restored.acceptance?.note, '保存前验收');
    const operations = await second.app.inject({ method: 'GET', url: `/api/operations/${restored.acceptance?.requestKey ?? 'missing'}` });
    assert.equal(operations.statusCode, 200, operations.body);
    assert.equal(operations.json().data.operation.operation, 'node.accept');
    assert.equal(operations.json().data.operation.status, 'succeeded');
  } finally {
    await second.close();
  }
});

test('W0-4: node acceptance is 404/absent when the execution does not exist yet', async () => {
  const app = await createApplication({ dataDir: mkdtempSync(join(tmpdir(), 'aw-accept-noexec-')), disableOpenCode: true, disableListen: true });
  try {
    const project = await app.app.inject({ method: 'POST', url: '/api/projects', payload: { requestKey: requestKey('prj'), name: 'No Exec', rootPath: createRepo() } });
    const projectId = project.json().data.resource.project.id as string;
    const task = await app.app.inject({
      method: 'POST',
      url: '/api/tasks',
      payload: { requestKey: requestKey('task'), projectId, title: '未执行', requirementText: 'R1', methodId: 'method.requirement-development' },
    });
    const taskId = task.json().data.resource.task.id as string;
    const skeleton = await app.app.inject({ method: 'POST', url: `/api/tasks/${taskId}/plan/skeleton`, payload: { requestKey: requestKey('skel'), confirmUseSkeleton: true } });
    const nodeId = (skeleton.json().data.resource.plan as { graph: PlanGraph }).graph.nodes[0]!.id;
    const detail = await nodeDetailOf(app, taskId, nodeId);
    assert.equal(detail.acceptance, undefined);
    assert.equal(detail.actions.accept?.allowed, false);
    assert.equal(detail.actions.accept?.reasonCode, 'NODE_EXECUTION_MISSING');
    assert.match(String(detail.actions.accept?.reason), /尚未执行/);
    const accept = await app.app.inject({ method: 'POST', url: `/api/tasks/${taskId}/nodes/${nodeId}/accept`, payload: { requestKey: requestKey('accept-noexec'), confirmAccept: true } });
    assert.equal(accept.statusCode, 404, accept.body);
    assert.equal(accept.json().error.code, 'NOT_FOUND');
  } finally {
    await app.close();
  }
});
