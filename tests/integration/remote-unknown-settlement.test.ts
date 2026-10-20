import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AppError, ErrorCode, createId, createRequestKey, nowIso } from '@agent-workflow/shared';
import { remoteOutcomeUnknownReason } from '../../packages/engine/src/delivery.ts';
import { createApplication, type RunningApplication } from '../../packages/server/src/index.ts';

/**
 * W2-12: remote writes that time out / lose the connection / return an
 * unparseable answer may already have happened remotely. They settle UNKNOWN
 * (receipt + delivery projection `unknown_receipt`), stay reconcilable by
 * requestKey and are never retried automatically; definite business rejections
 * (non-fast-forward, auth, conflict) stay failed.
 */

function createRepo(): string {
  const root = mkdtempSync(join(tmpdir(), 'aw-remote-unknown-'));
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: root });
  writeFileSync(join(root, 'README.md'), '# remote\n', 'utf8');
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'init'], { cwd: root });
  return root;
}

type GitPushInput = { repoRoot: string; localSha: string; remote: string; remoteRef: string };
type GitPushResult = { remoteRef: string; pushedSha: string; created: boolean };

function patchGitPush(app: RunningApplication, impl: (input: GitPushInput) => Promise<GitPushResult>): () => void {
  const ports = app.engine.ports as unknown as { git: { push: (input: GitPushInput) => Promise<GitPushResult> } };
  const original = ports.git.push;
  ports.git.push = impl;
  return () => {
    ports.git.push = original;
  };
}

function patchCreateMergeRequest(app: RunningApplication, impl: () => Promise<{ iid: number; webUrl: string }>): () => void {
  const ports = app.engine.ports as unknown as { remote?: { createMergeRequest: () => Promise<{ iid: number; webUrl: string }> } };
  assert.ok(ports.remote !== undefined, 'remote port is configured');
  const original = ports.remote.createMergeRequest;
  ports.remote.createMergeRequest = impl;
  return () => {
    ports.remote!.createMergeRequest = original;
  };
}

async function createDeliveryReadyTask(app: RunningApplication): Promise<string> {
  const project = await app.app.inject({ method: 'POST', url: '/api/projects', payload: { requestKey: createRequestKey(), name: 'Remote unknown', rootPath: createRepo() } });
  assert.equal(project.statusCode, 201, project.body);
  const projectId = project.json().data.resource.project.id as string;
  const task = await app.app.inject({
    method: 'POST',
    url: '/api/tasks',
    payload: { requestKey: createRequestKey(), projectId, title: '远端交付', requirementText: 'R1 推送交付', methodId: 'method.requirement-development' },
  });
  assert.equal(task.statusCode, 201, task.body);
  const taskId = task.json().data.resource.task.id as string;
  const skeleton = await app.app.inject({ method: 'POST', url: `/api/tasks/${taskId}/plan/skeleton`, payload: { requestKey: createRequestKey(), confirmUseSkeleton: true } });
  const plan = skeleton.json().data.resource.plan as { id: string; revisionNumber: number };
  const confirm = await app.app.inject({
    method: 'POST',
    url: `/api/tasks/${taskId}/plan/confirm`,
    payload: { requestKey: createRequestKey(), planRevisionId: plan.id, expectedRevisionNumber: plan.revisionNumber, confirmPlan: true },
  });
  assert.equal(confirm.statusCode, 200, confirm.body);
  const prepare = await app.app.inject({
    method: 'POST',
    url: `/api/tasks/${taskId}/workspace/prepare`,
    payload: { requestKey: createRequestKey(), expectedPlanRevisionNumber: plan.revisionNumber, expectedBaseRef: 'main', confirmPrepare: true },
  });
  assert.equal(prepare.statusCode, 200, prepare.body);
  const delivery = await app.app.inject({ method: 'GET', url: `/api/tasks/${taskId}/delivery` });
  assert.equal(delivery.statusCode, 200, delivery.body);
  return taskId;
}

interface PushReceiptBody {
  readonly error: { readonly code: string; readonly message: string; readonly details: Record<string, unknown> };
}

test('remote write classification separates undetermined outcomes from business failures', () => {
  assert.equal(remoteOutcomeUnknownReason(new AppError(ErrorCode.NETWORK_UNREACHABLE, 'timeout', { details: { reason: 'timeout' } })), 'timeout');
  assert.equal(remoteOutcomeUnknownReason(new AppError(ErrorCode.NETWORK_UNREACHABLE, 'network')), 'network_error');
  assert.equal(remoteOutcomeUnknownReason(new AppError(ErrorCode.UNSUPPORTED_FORMAT, 'non-JSON')), 'undetermined');
  assert.equal(remoteOutcomeUnknownReason(new AppError(ErrorCode.INTERNAL_ERROR, 'git push child killed')), 'undetermined');
  assert.equal(remoteOutcomeUnknownReason(new AppError(ErrorCode.PUSH_REJECTED_NON_FF, 'non-fast-forward')), undefined);
  assert.equal(remoteOutcomeUnknownReason(new AppError(ErrorCode.GITLAB_AUTH_FAILED, 'auth')), undefined);
  assert.equal(remoteOutcomeUnknownReason(new AppError(ErrorCode.CONFLICT, 'conflict')), undefined);
  assert.equal(remoteOutcomeUnknownReason(new Error('socket hang up')), 'undetermined');
  assert.equal(remoteOutcomeUnknownReason('not-an-error'), undefined);
});

test('a timed-out push settles UNKNOWN instead of failed and is reconcilable, while a rejection stays failed', async () => {
  const app = await createApplication({ dataDir: mkdtempSync(join(tmpdir(), 'aw-remote-push-')), disableOpenCode: true, disableListen: true });
  try {
    const taskId = await createDeliveryReadyTask(app);

    const timeoutKey = createRequestKey();
    const restoreTimeout = patchGitPush(app, async () => {
      throw new AppError(ErrorCode.NETWORK_UNREACHABLE, 'GitHub 推送请求超时', { details: { reason: 'timeout', host: 'github.com' } });
    });
    let timedOut: Awaited<ReturnType<RunningApplication['app']['inject']>>;
    try {
      timedOut = await app.app.inject({
        method: 'POST',
        url: `/api/tasks/${taskId}/delivery/push`,
        payload: { requestKey: timeoutKey, expectedLocalSha: 'a'.repeat(40), remoteBranchName: 'task/remote-unknown', confirmPush: true },
      });
    } finally {
      restoreTimeout();
    }
    assert.equal(timedOut.statusCode, 409, timedOut.body);
    const timeoutBody = timedOut.json() as PushReceiptBody;
    assert.equal(timeoutBody.error.code, 'RECEIPT_UNKNOWN');
    assert.match(timeoutBody.error.message, /结果未明/);
    assert.equal(timeoutBody.error.details.outcomeUnknown, true);
    assert.equal(timeoutBody.error.details.reason, 'timeout');
    assert.equal(timeoutBody.error.details.requestKey, timeoutKey);
    assert.equal(app.store.operations.get(timeoutKey)?.status, 'unknown', 'accepted receipt settled as UNKNOWN');
    const byKey = await app.app.inject({ method: 'GET', url: `/api/operations/${timeoutKey}` });
    assert.equal(byKey.statusCode, 200, byKey.body);
    assert.equal(byKey.json().data.operation.status, 'unknown');
    assert.equal(byKey.json().data.stillUnknown, true);
    const deliveryAfterUnknown = await app.app.inject({ method: 'GET', url: `/api/tasks/${taskId}/delivery` });
    const unknownProjection = deliveryAfterUnknown.json().data.delivery as { projection: string; steps: { step: string; state: string; error?: { code: string } }[] };
    assert.equal(unknownProjection.projection, 'unknown_receipt');
    assert.equal(unknownProjection.steps.find((step) => step.step === 'push')?.state, 'unknown');
    assert.equal(unknownProjection.steps.find((step) => step.step === 'push')?.error?.code, 'RECEIPT_UNKNOWN');

    // Replaying the same requestKey returns the settled UNKNOWN receipt and does
    // NOT perform the remote write again (no automatic retry).
    const replayKey = timeoutKey;
    let replayCalls = 0;
    const restoreReplay = patchGitPush(app, async () => {
      replayCalls += 1;
      throw new AppError(ErrorCode.NETWORK_UNREACHABLE, 'should not run');
    });
    let replay: Awaited<ReturnType<RunningApplication['app']['inject']>>;
    try {
      replay = await app.app.inject({
        method: 'POST',
        url: `/api/tasks/${taskId}/delivery/push`,
        payload: { requestKey: replayKey, expectedLocalSha: 'a'.repeat(40), remoteBranchName: 'task/remote-unknown', confirmPush: true },
      });
    } finally {
      restoreReplay();
    }
    assert.equal(replay.statusCode, 200, replay.body);
    assert.equal(replayCalls, 0, 'a reconciled/replayed UNKNOWN receipt never re-sends the write');
    assert.equal(replay.json().data.receipt.status, 'unknown');
    assert.equal(replay.json().data.receipt.outcome, undefined);

    // Network loss without a reason is classified as network_error.
    const networkKey = createRequestKey();
    const restoreNetwork = patchGitPush(app, async () => {
      throw new AppError(ErrorCode.NETWORK_UNREACHABLE, 'GitHub 网络不可达');
    });
    let networkFailed: Awaited<ReturnType<RunningApplication['app']['inject']>>;
    try {
      networkFailed = await app.app.inject({
        method: 'POST',
        url: `/api/tasks/${taskId}/delivery/push`,
        payload: { requestKey: networkKey, expectedLocalSha: 'a'.repeat(40), remoteBranchName: 'task/remote-unknown', confirmPush: true },
      });
    } finally {
      restoreNetwork();
    }
    assert.equal(networkFailed.statusCode, 409, networkFailed.body);
    assert.equal((networkFailed.json() as PushReceiptBody).error.details.reason, 'network_error');
    assert.equal(app.store.operations.get(networkKey)?.status, 'unknown');

    // The local git CLI reports a killed/timed-out child as INTERNAL_ERROR with no
    // machine-readable reason; a remote write there is undetermined too.
    const killedKey = createRequestKey();
    const restoreKilled = patchGitPush(app, async () => {
      throw new AppError(ErrorCode.INTERNAL_ERROR, 'Command failed: git push (killed)');
    });
    let killed: Awaited<ReturnType<RunningApplication['app']['inject']>>;
    try {
      killed = await app.app.inject({
        method: 'POST',
        url: `/api/tasks/${taskId}/delivery/push`,
        payload: { requestKey: killedKey, expectedLocalSha: 'a'.repeat(40), remoteBranchName: 'task/remote-unknown', confirmPush: true },
      });
    } finally {
      restoreKilled();
    }
    assert.equal(killed.statusCode, 409, killed.body);
    assert.equal((killed.json() as PushReceiptBody).error.details.reason, 'undetermined');
    assert.equal(app.store.operations.get(killedKey)?.status, 'unknown');

    // A definite rejection is a business failure: receipt failed, step failed, delivery blocked.
    const rejectedKey = createRequestKey();
    const restoreRejected = patchGitPush(app, async () => {
      throw new AppError(ErrorCode.PUSH_REJECTED_NON_FF, '远端已有新提交，推送被拒');
    });
    let rejected: Awaited<ReturnType<RunningApplication['app']['inject']>>;
    try {
      rejected = await app.app.inject({
        method: 'POST',
        url: `/api/tasks/${taskId}/delivery/push`,
        payload: { requestKey: rejectedKey, expectedLocalSha: 'a'.repeat(40), remoteBranchName: 'task/remote-unknown', confirmPush: true },
      });
    } finally {
      restoreRejected();
    }
    // PUSH_REJECTED_NON_FF already maps to the default 500 status; the contract
    // point is the code and the failed settlement, not a specific status.
    assert.equal(rejected.statusCode, 500, rejected.body);
    assert.equal((rejected.json() as PushReceiptBody).error.code, 'PUSH_REJECTED_NON_FF');
    assert.equal(app.store.operations.get(rejectedKey)?.status, 'failed', 'business failure is NOT unknown');
    const deliveryAfterRejected = await app.app.inject({ method: 'GET', url: `/api/tasks/${taskId}/delivery` });
    const rejectedProjection = deliveryAfterRejected.json().data.delivery as { projection: string; steps: { step: string; state: string }[] };
    assert.equal(rejectedProjection.projection, 'blocked');
    assert.equal(rejectedProjection.steps.find((step) => step.step === 'push')?.state, 'failed');
  } finally {
    await app.close();
  }
});

test('a timed-out merge request settles UNKNOWN without marking the task delivered', async () => {
  const app = await createApplication({ dataDir: mkdtempSync(join(tmpdir(), 'aw-remote-mr-')), disableOpenCode: true, disableListen: true });
  try {
    const project = await app.app.inject({ method: 'POST', url: '/api/projects', payload: { requestKey: createRequestKey(), name: 'MR unknown', rootPath: createRepo() } });
    const projectId = project.json().data.resource.project.id as string;
    const task = await app.app.inject({
      method: 'POST',
      url: '/api/tasks',
      payload: { requestKey: createRequestKey(), projectId, title: 'MR unknown', requirementText: 'R1', methodId: 'method.requirement-development' },
    });
    const taskId = task.json().data.resource.task.id as string;
    const delivery = app.store.deliveries.create({ taskId, workspaceId: createId('ws'), changesRevision: 'rev1', eligibility: { allowed: true } });
    app.store.deliveries.update(delivery.id, {
      goal: 'create_merge_request',
      steps: [{ step: 'commit', state: 'succeeded', requestKey: createRequestKey(), settledAt: nowIso(), commitSha: 'a'.repeat(40) }],
    });
    app.store.tasks.update(taskId, { deliveryId: delivery.id });

    const timeoutKey = createRequestKey();
    const restoreTimeout = patchCreateMergeRequest(app, async () => {
      throw new AppError(ErrorCode.NETWORK_UNREACHABLE, 'GitLab 请求超时', { details: { reason: 'timeout' } });
    });
    let timedOut: Awaited<ReturnType<RunningApplication['app']['inject']>>;
    try {
      timedOut = await app.app.inject({
        method: 'POST',
        url: `/api/tasks/${taskId}/delivery/merge-request`,
        payload: {
          requestKey: timeoutKey,
          sourceRef: 'task/remote-unknown',
          pushedSha: 'a'.repeat(40),
          targetBranch: 'main',
          expectedTargetTip: 'b'.repeat(40),
          title: 'Task delivery',
          description: 'Deliver',
          confirmMergeRequest: true,
        },
      });
    } finally {
      restoreTimeout();
    }
    assert.equal(timedOut.statusCode, 409, timedOut.body);
    assert.equal((timedOut.json() as PushReceiptBody).error.code, 'RECEIPT_UNKNOWN');
    assert.equal((timedOut.json() as PushReceiptBody).error.details.reason, 'timeout');
    assert.equal(app.store.operations.get(timeoutKey)?.status, 'unknown');
    const afterUnknown = app.store.deliveries.get(delivery.id)!;
    assert.equal(afterUnknown.projection, 'unknown_receipt');
    assert.equal(afterUnknown.steps.find((step) => step.step === 'mergeRequest')?.state, 'unknown');
    assert.equal(app.store.tasks.get(taskId)?.lifecycle, 'active', 'UNKNOWN must not mark the task delivered');

    // DEL-14: retrying while the original receipt is still UNKNOWN must NOT POST again.
    // The read-only lookup finding nothing is not proof that the MR was never created.
    let duplicatePostAttempts = 0;
    const restoreRetry = patchCreateMergeRequest(app, async () => {
      duplicatePostAttempts += 1;
      throw new AppError(ErrorCode.MR_ALREADY_EXISTS, '同名合并请求已存在');
    });
    let retried: Awaited<ReturnType<RunningApplication['app']['inject']>>;
    try {
      retried = await app.app.inject({
        method: 'POST',
        url: `/api/tasks/${taskId}/delivery/merge-request`,
        payload: { requestKey: createRequestKey(), sourceRef: 'task/remote-unknown', pushedSha: 'a'.repeat(40), targetBranch: 'main', expectedTargetTip: 'b'.repeat(40), title: 'Task delivery', description: 'Deliver', confirmMergeRequest: true },
      });
    } finally {
      restoreRetry();
    }
    assert.equal(retried.statusCode, 409, retried.body);
    assert.equal((retried.json() as PushReceiptBody).error.code, 'RECEIPT_UNKNOWN');
    assert.equal(duplicatePostAttempts, 0, 'must not re-POST while the original result is unknown');
    assert.equal(app.store.operations.get(timeoutKey)?.status, 'unknown', 'the original UNKNOWN stays reconcilable');

    // A definite remote rejection stays failed. Reset the unknown MR step first: this
    // exercises a fresh create attempt (no prior UNKNOWN) which is a distinct path.
    const unknownDelivery = app.store.deliveries.get(delivery.id)!;
    app.store.deliveries.update(delivery.id, {
      projection: 'awaiting_confirmation',
      steps: unknownDelivery.steps.filter((step) => step.step !== 'mergeRequest'),
    });
    const rejectKey = createRequestKey();
    const restoreReject = patchCreateMergeRequest(app, async () => {
      throw new AppError(ErrorCode.MR_ALREADY_EXISTS, '同名合并请求已存在');
    });
    let rejected: Awaited<ReturnType<RunningApplication['app']['inject']>>;
    try {
      rejected = await app.app.inject({
        method: 'POST',
        url: `/api/tasks/${taskId}/delivery/merge-request`,
        payload: { requestKey: rejectKey, sourceRef: 'task/remote-unknown', pushedSha: 'a'.repeat(40), targetBranch: 'main', expectedTargetTip: 'b'.repeat(40), title: 'Task delivery', description: 'Deliver', confirmMergeRequest: true },
      });
    } finally {
      restoreReject();
    }
    assert.equal(rejected.statusCode, 409, rejected.body);
    assert.equal((rejected.json() as PushReceiptBody).error.code, 'MR_ALREADY_EXISTS');
    assert.equal(app.store.operations.get(rejectKey)?.status, 'failed');
    const afterReject = app.store.deliveries.get(delivery.id)!;
    assert.equal(afterReject.projection, 'blocked');
    assert.equal(afterReject.steps.find((step) => step.step === 'mergeRequest')?.state, 'failed');
  } finally {
    await app.close();
  }
});
