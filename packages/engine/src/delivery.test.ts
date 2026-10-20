import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DeliveryMergeRequestRequest, DeliveryMergeRequestVerifyRequest, GitMergeRequest } from '@agent-workflow/shared';
import { AppError, DEFAULT_SETTINGS, ErrorCode, createRequestKey } from '@agent-workflow/shared';
import { Store } from '@agent-workflow/storage';
import { CommandService } from './operations.ts';
import { DeliveryService } from './delivery.ts';
import type { EngineContext } from './actions.ts';
import type { GitPort, RemotePort } from './ports.ts';
import type { WorkspaceService } from './workspace.ts';

/*
 * DEL-14：「已有原 MR 先核对再创建」。
 * 这些测试只使用真实 Store + 受控的 RemotePort 假件，断言：
 *  - 已有成功步骤 / 远端已有同源 → 目标 MR 时不得再 POST 创建；
 *  - 创建回执 UNKNOWN 只按原请求做只读核对，核对不到才允许新的创建请求；
 *  - 读不到远端 MR 列表时宁可不创建，避免重复副作用。
 */

function mergeRequest(overrides: Partial<GitMergeRequest> = {}): GitMergeRequest {
  return {
    iid: 58,
    title: '任务交付：退款单分页查询与导出',
    sourceBranch: 'refs/heads/task/T-2041',
    targetBranch: 'main',
    state: 'opened',
    hasConflicts: false,
    draft: false,
    author: { name: 'dev-zhang', email: 'dev@example.com', initials: 'DZ' },
    updatedAt: '2026-10-20T08:00:00.000Z',
    webUrl: 'https://gitlab.example.internal/shop/order-service/-/merge_requests/58',
    ...overrides,
  };
}

class FakeRemote implements RemotePort {
  mrs: GitMergeRequest[] = [];
  listCalls = 0;
  created = 0;
  failList = false;
  failCreate: Error | undefined;

  async listMergeRequests(): Promise<readonly GitMergeRequest[]> {
    this.listCalls += 1;
    if (this.failList) throw new AppError(ErrorCode.NETWORK_UNREACHABLE, 'remote timeout', { details: { reason: 'timeout' } });
    return [...this.mrs];
  }

  async createMergeRequest(): Promise<{ readonly iid: number; readonly webUrl: string }> {
    this.created += 1;
    if (this.failCreate !== undefined) throw this.failCreate;
    const mr = mergeRequest();
    this.mrs.push(mr);
    return { iid: mr.iid, webUrl: mr.webUrl };
  }

  async connection(): Promise<{ readonly provider: 'github' | 'gitlab'; readonly state: 'connected' | 'not_configured' | 'auth_failed' | 'unreachable' }> {
    return { provider: 'gitlab', state: 'connected' };
  }
}

class FakeGit {
  fetchCalls = 0;
  fetchError: Error | undefined;
  branchesResult: readonly { readonly name: string; readonly fullRef: string; readonly kind: 'local' | 'remote'; readonly tipSha: string }[] = [];

  async fetch(): Promise<{ readonly fetchedAt: string }> {
    this.fetchCalls += 1;
    if (this.fetchError !== undefined) throw this.fetchError;
    return { fetchedAt: '2026-10-20T02:00:00.000Z' };
  }

  async branches(): Promise<readonly { readonly name: string; readonly fullRef: string; readonly kind: 'local' | 'remote'; readonly tipSha: string }[] & { readonly checkedOutInUserWorktree?: undefined }[]> {
    return this.branchesResult as never;
  }
}

interface Fixture {
  readonly store: Store;
  readonly service: DeliveryService;
  readonly remote: FakeRemote;
  readonly taskId: string;
  readonly deliveryId: string;
  close(): void;
}

function fixture(options: { readonly git?: FakeGit } = {}): Fixture {
  const dataDir = mkdtempSync(join(tmpdir(), 'aw-delivery-'));
  const store = new Store({ dataDir });
  const project = store.projects.create({ name: '订单服务', rootPath: dataDir, gitState: 'git', defaultBranch: 'main' });
  const task = store.tasks.create({
    projectId: project.id,
    title: '退款单分页查询与导出',
    requirementText: 'R1 分页查询退款单',
    methodId: 'method.requirement-development',
    methodRevision: '1',
  });
  const workspace = store.workspaces.create({ taskId: task.id, kind: 'git_worktree', originalRootDisplay: dataDir, baseRef: 'main' });
  store.workspaces.update(workspace.id, { state: 'ready', branch: 'task/T-2041', baseSha: 'base-sha', displayRoot: dataDir });
  store.tasks.update(task.id, { workspaceId: workspace.id });
  const delivery = store.deliveries.create({ taskId: task.id, workspaceId: workspace.id, eligibility: { allowed: true } });
  store.tasks.update(task.id, { deliveryId: delivery.id });
  store.deliveries.update(delivery.id, {
    goal: 'create_merge_request',
    projection: 'awaiting_confirmation',
    steps: [{ step: 'push', state: 'succeeded', remoteRef: 'refs/heads/task/T-2041', pushedSha: 'pushed-sha' }],
  });
  const context: EngineContext = {
    store,
    settings: () => DEFAULT_SETTINGS,
    projects: () => [],
    opencodeReady: () => false,
    gitlabConfigured: () => true,
    planningBudgetConfigured: () => false,
  };
  const remote = new FakeRemote();
  const service = new DeliveryService(
    store,
    new CommandService(store),
    context,
    (options.git ?? {}) as unknown as GitPort,
    {} as unknown as WorkspaceService,
    remote,
  );
  return {
    store,
    service,
    remote,
    taskId: task.id,
    deliveryId: delivery.id,
    close() {
      store.close();
      rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

function createInput(overrides: Partial<DeliveryMergeRequestRequest> = {}): DeliveryMergeRequestRequest {
  return {
    requestKey: createRequestKey(),
    sourceRef: 'refs/heads/task/T-2041',
    pushedSha: 'pushed-sha',
    targetBranch: 'main',
    expectedTargetTip: 'target-tip',
    title: '任务交付：退款单分页查询与导出',
    description: '任务 T-2041 的交付合并请求。',
    confirmMergeRequest: true,
    ...overrides,
  };
}

function verifyInput(targetRequestKey: string): DeliveryMergeRequestVerifyRequest {
  return { requestKey: createRequestKey(), targetRequestKey, confirmVerify: true };
}

test('DEL-14: 已成功的合并请求步骤直接复用，不再 POST 第二个 MR', async () => {
  const fx = fixture();
  try {
    fx.store.deliveries.update(fx.deliveryId, {
      projection: 'delivered',
      steps: [
        { step: 'push', state: 'succeeded', remoteRef: 'refs/heads/task/T-2041', pushedSha: 'pushed-sha' },
        { step: 'mergeRequest', state: 'succeeded', mrIid: 58, mrWebUrl: 'https://gitlab.example.internal/mr/58' },
      ],
    });
    const response = await fx.service.createMergeRequest(fx.taskId, createInput());
    assert.equal(fx.remote.created, 0, '不得重复创建 MR');
    assert.equal(response.receipt.status, 'succeeded');
    assert.equal(response.resource?.delivery.steps.find((step) => step.step === 'mergeRequest')?.mrIid, 58);
  } finally {
    fx.close();
  }
});

test('DEL-14: 远端已有同源 → 目标打开 MR 时只显示原链接并按原 MR 结算', async () => {
  const fx = fixture();
  try {
    fx.remote.mrs = [mergeRequest()];
    const response = await fx.service.createMergeRequest(fx.taskId, createInput());
    assert.equal(fx.remote.created, 0, '核对到已有原 MR 后不得 POST');
    assert.equal(fx.remote.listCalls, 1);
    assert.equal(response.receipt.status, 'succeeded');
    const delivery = fx.store.deliveries.byTask(fx.taskId)!;
    assert.equal(delivery.projection, 'delivered');
    assert.equal(delivery.steps.find((step) => step.step === 'mergeRequest')?.mrIid, 58);
    assert.equal(fx.store.tasks.get(fx.taskId)?.lifecycle, 'completed');
  } finally {
    fx.close();
  }
});

test('DEL-14: 第二个 requestKey 不会重复创建已存在的 MR', async () => {
  const fx = fixture();
  try {
    const first = await fx.service.createMergeRequest(fx.taskId, createInput());
    assert.equal(first.receipt.status, 'succeeded');
    assert.equal(fx.remote.created, 1);
    const second = await fx.service.createMergeRequest(fx.taskId, createInput());
    assert.equal(second.receipt.status, 'succeeded');
    assert.equal(fx.remote.created, 1, '新 requestKey 也必须复用原 MR');
  } finally {
    fx.close();
  }
});

test('DEL-14: 创建回执 UNKNOWN 只按原请求核对远端，核对到原 MR 即结算且不重发', async () => {
  const fx = fixture();
  try {
    fx.remote.failCreate = new AppError(ErrorCode.NETWORK_UNREACHABLE, 'remote timeout', { details: { reason: 'timeout' } });
    const requestKey = createRequestKey();
    await assert.rejects(() => fx.service.createMergeRequest(fx.taskId, createInput({ requestKey })), (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.code, ErrorCode.RECEIPT_UNKNOWN);
      return true;
    });
    assert.equal(fx.store.operations.get(requestKey)?.status, 'unknown');
    assert.equal(fx.store.deliveries.byTask(fx.taskId)?.projection, 'unknown_receipt');

    // 远端确实已经发生：核对按原请求找到原 MR，结算交付且不重复 POST。
    fx.remote.failCreate = undefined;
    fx.remote.mrs = [mergeRequest()];
    fx.remote.created = 0;
    const verified = await fx.service.verifyMergeRequest(fx.taskId, verifyInput(requestKey));
    assert.equal(verified.resource?.found, true);
    assert.equal(fx.remote.created, 0, '核对不得 POST');
    assert.equal(verified.resource?.delivery.projection, 'delivered');
    assert.equal(verified.resource?.delivery.steps.find((step) => step.step === 'mergeRequest')?.mrIid, 58);
  } finally {
    fx.close();
  }
});

test('DEL-14: 核对不到同源 MR 时保持 UNKNOWN，不判“未创建”、不重复 POST', async () => {
  const fx = fixture();
  try {
    fx.remote.failCreate = new AppError(ErrorCode.NETWORK_UNREACHABLE, 'remote timeout', { details: { reason: 'timeout' } });
    const requestKey = createRequestKey();
    await assert.rejects(() => fx.service.createMergeRequest(fx.taskId, createInput({ requestKey })));
    fx.remote.failCreate = undefined;
    fx.remote.created = 0; // 第一次尝试已发出但结果未知，计数归零以证明核对与后续创建次数
    assert.equal(fx.remote.created, 0);

    const verified = await fx.service.verifyMergeRequest(fx.taskId, verifyInput(requestKey));
    assert.equal(verified.resource?.found, false);
    // 列表里没有 ≠ 原请求未创建：保持 UNKNOWN，不判失败。
    assert.equal(verified.resource?.delivery.projection, 'unknown_receipt');
    const step = verified.resource?.delivery.steps.find((item) => item.step === 'mergeRequest');
    assert.equal(step?.state, 'unknown', '缺省列表不能证明未创建，必须保持 unknown');
    assert.match(verified.resource?.note ?? '', /不会判定原请求未创建|请到 GitLab 核对/);

    // 原未知未收敛前不允许重复创建（不重复 POST 原请求）。
    await assert.rejects(() => fx.service.createMergeRequest(fx.taskId, createInput()), (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.code, ErrorCode.RECEIPT_UNKNOWN);
      return true;
    });
    assert.equal(fx.remote.created, 0, '不得重复创建');
  } finally {
    fx.close();
  }
});

test('P2 数据诚实: 已合并/已关闭的同源 MR 不被当成“未创建”，也不据此把任务置完成', async () => {
  const fx = fixture();
  try {
    fx.remote.failCreate = new AppError(ErrorCode.NETWORK_UNREACHABLE, 'remote timeout', { details: { reason: 'timeout' } });
    const requestKey = createRequestKey();
    await assert.rejects(() => fx.service.createMergeRequest(fx.taskId, createInput({ requestKey })));
    fx.remote.failCreate = undefined;
    fx.remote.created = 0;
    fx.remote.mrs = [mergeRequest({ state: 'merged' })];

    const verified = await fx.service.verifyMergeRequest(fx.taskId, verifyInput(requestKey));
    assert.equal(verified.resource?.found, true, '已合并的原 MR 必须被识别为已存在');
    assert.equal(fx.remote.created, 0, '核对不得 POST');
    assert.equal(verified.resource?.mergeRequest?.state, 'merged');
    const delivery = verified.resource?.delivery;
    assert.equal(delivery?.steps.find((step) => step.step === 'mergeRequest')?.mrIid, 58);
    assert.notEqual(delivery?.projection, 'delivered', '不得仅凭 MR 已合并把交付置为已完成');
    assert.notEqual(fx.store.tasks.get(fx.taskId)?.lifecycle, 'completed', '不得仅凭该只读事实把任务置完成');
    assert.match(verified.resource?.note ?? '', /已合并/);
    // 已有已合并原 MR 时不允许重复创建：返回原链接（成功结算）但绝不 POST 第二个。
    const again = await fx.service.createMergeRequest(fx.taskId, createInput());
    assert.equal(again.receipt.status, 'succeeded');
    assert.equal(fx.remote.created, 0, '不得创建第二个 MR');
  } finally {
    fx.close();
  }
});

test('P2 数据诚实: 已关闭的同源 MR 也被识别（不判未创建、不重复创建）', async () => {
  const fx = fixture();
  try {
    fx.remote.mrs = [mergeRequest({ state: 'closed', iid: 57 })];
    await assert.rejects(() => fx.service.createMergeRequest(fx.taskId, createInput()), (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.code, ErrorCode.DELIVERY_BLOCKED);
      assert.match(error.message, /已关闭/);
      return true;
    });
    assert.equal(fx.remote.created, 0, '已关闭原 MR 存在时不得重复创建');
  } finally {
    fx.close();
  }
});

test('DEL-14: 读不到远端已有 MR 列表时拒绝创建，避免重复副作用', async () => {
  const fx = fixture();
  try {
    fx.remote.failList = true;
    await assert.rejects(() => fx.service.createMergeRequest(fx.taskId, createInput()), (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.code, ErrorCode.CAPABILITY_UNAVAILABLE);
      return true;
    });
    assert.equal(fx.remote.created, 0, '无法核对时不得盲创建');
  } finally {
    fx.close();
  }
});

test('DEL-17: 推送回执 UNKNOWN 按远端分支比对核对，核对到即按已推送结算且不重发', async () => {
  const git = new FakeGit();
  git.branchesResult = [{ name: 'origin/task/T-2041', fullRef: 'refs/remotes/origin/task/T-2041', kind: 'remote', tipSha: 'commit-sha' }];
  const fx = fixture({ git });
  try {
    fx.store.deliveries.update(fx.deliveryId, {
      goal: 'create_merge_request',
      projection: 'unknown_receipt',
      projectionReason: '推送结果未明',
      steps: [
        { step: 'commit', state: 'succeeded', commitSha: 'commit-sha' },
        { step: 'push', state: 'unknown', requestKey: 'req_original_push' },
      ],
    });
    const verified = await fx.service.verifyPush(fx.taskId, { requestKey: createRequestKey(), targetRequestKey: 'req_original_push', confirmVerify: true });
    assert.equal(verified.resource?.found, true);
    assert.equal(git.fetchCalls, 1, '核对只 fetch 远端，不 push');
    assert.equal(verified.resource?.delivery.steps.find((step) => step.step === 'push')?.state, 'succeeded');
    assert.equal(verified.resource?.delivery.projection, 'awaiting_confirmation');
  } finally {
    fx.close();
  }
});

test('DEL-17: 核对确认远端没有该提交后才把原未知步结算为失败，允许新推送请求', async () => {
  const git = new FakeGit();
  const fx = fixture({ git });
  try {
    fx.store.deliveries.update(fx.deliveryId, {
      goal: 'push_branch',
      projection: 'unknown_receipt',
      steps: [
        { step: 'commit', state: 'succeeded', commitSha: 'commit-sha' },
        { step: 'push', state: 'unknown', requestKey: 'req_original_push' },
      ],
    });
    const verified = await fx.service.verifyPush(fx.taskId, { requestKey: createRequestKey(), targetRequestKey: 'req_original_push', confirmVerify: true });
    assert.equal(verified.resource?.found, false);
    assert.equal(verified.resource?.delivery.steps.find((step) => step.step === 'push')?.state, 'failed');
    assert.notEqual(verified.resource?.delivery.projection, 'unknown_receipt');
  } finally {
    fx.close();
  }
});

test('DEL-17: 远端读取失败时保持 UNKNOWN，不把未知判成失败', async () => {
  const git = new FakeGit();
  git.fetchError = new AppError(ErrorCode.NETWORK_UNREACHABLE, 'network down');
  const fx = fixture({ git });
  try {
    fx.store.deliveries.update(fx.deliveryId, {
      goal: 'push_branch',
      projection: 'unknown_receipt',
      steps: [
        { step: 'commit', state: 'succeeded', commitSha: 'commit-sha' },
        { step: 'push', state: 'unknown', requestKey: 'req_original_push' },
      ],
    });
    await assert.rejects(
      () => fx.service.verifyPush(fx.taskId, { requestKey: createRequestKey(), targetRequestKey: 'req_original_push', confirmVerify: true }),
      (error: unknown) => error instanceof AppError && error.code === ErrorCode.CAPABILITY_UNAVAILABLE,
    );
    assert.equal(fx.store.deliveries.byTask(fx.taskId)?.projection, 'unknown_receipt');
    assert.equal(fx.store.deliveries.byTask(fx.taskId)?.steps.find((step) => step.step === 'push')?.state, 'unknown');
  } finally {
    fx.close();
  }
});
