import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ExecutionView, PlanRevision, Task, TaskDelivery } from '@agent-workflow/shared';
import { deriveCanvasSituation } from './situation.ts';

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task_1',
    projectId: 'proj_1',
    title: '让项目配置更容易找到',
    stage: 'executing',
    lifecycle: 'active',
    attention: 'none',
    methodId: 'method_1',
    methodRevision: 'r1',
    requirement: { text: '', supplements: [], entries: [], revision: 1, updatedAt: '2026-10-20T00:00:00.000Z' },
    createdAt: '2026-10-20T00:00:00.000Z',
    updatedAt: '2026-10-20T00:00:00.000Z',
    ...overrides,
  };
}

function execution(overrides: Partial<ExecutionView> = {}): ExecutionView {
  return {
    id: 'exec_1',
    taskId: 'task_1',
    planRevisionId: 'plan_1',
    status: 'completed',
    autoAdvance: true,
    nodes: [],
    frontier: [],
    progress: { done: 5, total: 5, running: 0, failed: 0 },
    acceptance: { pending: [], rejected: [] },
    actions: {},
    ...overrides,
  };
}

function plan(): PlanRevision {
  return {
    id: 'plan_1',
    taskId: 'task_1',
    revisionNumber: 2,
    status: 'confirmed',
    source: 'initial',
    graph: { nodes: [], edges: [], groups: [] },
    createdAt: '2026-10-20T00:00:00.000Z',
  };
}

function delivery(overrides: Partial<TaskDelivery> = {}): TaskDelivery {
  return {
    id: 'del_1',
    taskId: 'task_1',
    revision: '1',
    projection: 'delivered',
    selectedFileIds: [],
    remaining: { unselected: 0, detail: '' },
    eligibility: { allowed: true },
    steps: [],
    lastUpdatedAt: '2026-10-20T00:00:00.000Z',
    actions: {},
    ...overrides,
  };
}

// P13-01: execution completed but nothing delivered must NEVER be a green task completion.
test('P13-01: completed execution without delivery stays a wait fact and never shows a green 任务已完成', () => {
  const situation = deriveCanvasSituation({ task: task(), plan: plan(), execution: execution() });
  assert.equal(situation.status.label, '执行已结束 · 等待交付');
  assert.equal(situation.status.tone, 'wait');
  assert.equal(situation.mode, 'wait');
  assert.equal(situation.facts.find((fact) => fact.key === 'execution')?.color, 'done');
  const deliveryFact = situation.facts.find((fact) => fact.key === 'delivery');
  assert.ok(deliveryFact !== undefined);
  assert.match(deliveryFact.text, /等待交付/);
  // The misleading labels are not reachable from a finished-but-undelivered execution.
  const labels = [situation.status.label, ...situation.facts.map((fact) => fact.text)].join(' ');
  assert.ok(!labels.includes('任务已完成'), '未交付的执行不得显示“任务已完成”');
  assert.ok(!labels.includes('已完成'), '除步骤验收措辞外不得出现绿色“已完成”任务文案');
  assert.equal(situation.primary?.label, '打开交付');
});

test('P13-01: only the delivered read model turns the canvas status green', () => {
  const completedTask = task({ lifecycle: 'completed' });
  const done = deriveCanvasSituation({ task: completedTask, plan: plan(), execution: execution(), delivery: delivery() });
  assert.equal(done.status.label, '任务已交付');
  assert.equal(done.status.tone, 'done');
  assert.equal(done.mode, 'ok');

  const deliveredActive = task({ lifecycle: 'active' });
  const delivered = deriveCanvasSituation({ task: deliveredActive, plan: plan(), execution: execution(), delivery: delivery() });
  assert.equal(delivered.status.tone, 'done');

  const awaiting = deriveCanvasSituation({ task: deliveredActive, plan: plan(), execution: execution(), delivery: delivery({ projection: 'awaiting_selection', projectionReason: '5 个文件变更' }) });
  assert.equal(awaiting.status.label, '执行已结束 · 等待交付');
  assert.equal(awaiting.status.tone, 'wait');
});

test('P13-01: delivered with failed verification is a warn fact, not a plain success', () => {
  const situation = deriveCanvasSituation({ task: task(), plan: plan(), execution: execution(), delivery: delivery({ goal: 'apply_to_original', verificationOutcome: 'failed' }) });
  assert.equal(situation.status.label, '任务已交付');
  assert.equal(situation.status.tone, 'done');
  assert.equal(situation.secondary?.label, '交付 · 验证未通过');
  const deliveryFact = situation.facts.find((fact) => fact.key === 'delivery');
  assert.match(deliveryFact?.text ?? '', /验证未通过/);
});

test('P13-02: situation bar splits execution / delivery facts and surfaces pending acceptance', () => {
  const situation = deriveCanvasSituation({
    task: task({ attention: 'none' }),
    plan: plan(),
    execution: execution({ status: 'running', progress: { done: 2, total: 5, running: 2, failed: 0 }, nodes: [], acceptance: { pending: ['n4'], rejected: [] } }),
  });
  assert.deepEqual(situation.facts.map((fact) => fact.key), ['execution', 'delivery']);
  assert.equal(situation.status.label, '待人工验收');
  assert.equal(situation.primary?.label, '去验收');
  assert.equal(situation.facts[1]?.label, '交付');
  assert.match(situation.facts[1]?.text ?? '', /未到达/);
});

test('P13-02: paused execution keeps the paused word and offers resume only for a user pause', () => {
  const paused = deriveCanvasSituation({
    task: task(),
    plan: plan(),
    execution: execution({ status: 'paused', pause: { requestKey: 'rk-1' }, progress: { done: 1, total: 5, running: 0, failed: 0 } }),
  });
  assert.equal(paused.status.label, '已暂停');
  assert.equal(paused.primary?.label, '恢复任务');
  const systemPaused = deriveCanvasSituation({ task: task(), plan: plan(), execution: execution({ status: 'paused', pause: {} }) });
  assert.equal(systemPaused.status.label, '已暂停');
  assert.equal(systemPaused.primary, undefined);
});

test('P13-02: failed execution names the real failing step and reason from the service', () => {
  const situation = deriveCanvasSituation({
    task: task(),
    plan: plan(),
    execution: execution({ status: 'failed', progress: { done: 3, total: 5, running: 0, failed: 1 }, nodes: [{ nodeId: 'n4', status: 'failed', attemptCount: 3, error: { code: 'MODEL_ERROR', message: '3 个用例断言不通过' } }] }),
  });
  assert.equal(situation.status.label, '有步骤失败');
  assert.equal(situation.status.tone, 'fail');
  assert.match(situation.facts[0]?.text ?? '', /3 个用例断言不通过/);
  assert.equal(situation.primary?.kind, 'focus');
  assert.equal(situation.primary?.nodeId, 'n4');
});

test('P13-02: edit session adds the 计划 fact and suppresses the outer action', () => {
  const situation = deriveCanvasSituation({
    task: task(),
    plan: plan(),
    execution: execution({ status: 'paused', editSession: { id: 'edit_1', state: 'saved', requestKey: 'rk-2', autoAdvanceBeforeEdit: true, lockedNodeIds: [], localChanges: [] } }),
  });
  assert.deepEqual(situation.facts.map((fact) => fact.key), ['plan', 'execution', 'delivery']);
  assert.match(situation.facts[0]?.text ?? '', /等待重新确认/);
  assert.equal(situation.primary, undefined);
});

test('P13-04: runtime attention items surface as wait badge without inventing a stall state', () => {
  const situation = deriveCanvasSituation({
    task: task(),
    plan: plan(),
    execution: execution({ status: 'running', nodes: [], acceptance: { pending: [], rejected: [] } }),
    attentionItems: [{ kind: 'runtime_approval', title: '「补充接口说明」请求只读授权', detail: '写入 docs/api-reference.md' }],
  });
  assert.equal(situation.secondary?.label, '等待你处理');
  assert.equal(situation.primary?.label, '去待处理中心');
  assert.ok(!JSON.stringify(situation).includes('停滞'), '服务没有停滞事实时不得伪造停滞状态');
});
