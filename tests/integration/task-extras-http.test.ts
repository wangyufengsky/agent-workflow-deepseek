import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_CATALOG, type PlanGraph } from '@agent-workflow/shared';
import { createApplication } from '../../packages/server/src/index.ts';

type App = Awaited<ReturnType<typeof createApplication>>;

function requestKey(prefix: string): string {
  return `req_${prefix}${Math.random().toString(36).slice(2, 21)}`;
}

function planGraph(): PlanGraph {
  return {
    nodes: [
      {
        id: 'n1',
        key: 'impl',
        title: '实现',
        kind: 'implementation',
        groupId: 'group.0',
        summary: '实现改动',
        inputs: [],
        outputs: [{ name: 'result.md', kind: 'artifact' }],
        acceptance: [],
        resources: { read: [], write: [] },
      },
    ],
    edges: [],
    groups: [{ id: 'group.0', label: '实现', kind: 'implementation', refined: true, collapsible: true, collapsedByDefault: false }],
  };
}

function seed(app: App, options: { readonly withPlan: boolean; readonly fixedTemplate?: boolean }): { projectId: string; taskId: string; planId?: string } {
  const project = app.store.projects.create({ name: 'Extras', rootPath: mkdtempSync(join(tmpdir(), 'aw-extras-repo-')), gitState: 'not_git' });
  const task = app.store.tasks.create({
    projectId: project.id,
    title: '任务画布扩展',
    requirementText: 'R1 完成扩展入口',
    methodId: 'method.requirement-development',
    methodRevision: 'r12',
    ...(options.fixedTemplate === true
      ? { fixedTemplate: { templateId: DEFAULT_CATALOG.templates[0]!.id, templateVersion: DEFAULT_CATALOG.templates[0]!.version, locked: true as const, parameters: {} } }
      : {}),
  });
  let planId: string | undefined;
  if (options.withPlan) {
    const plan = app.store.plans.create({ taskId: task.id, source: 'applied', graph: planGraph(), status: 'unconfirmed' });
    app.store.tasks.update(task.id, { currentPlanRevisionId: plan.id, stage: 'planning' });
    planId = plan.id;
  }
  return { projectId: project.id, taskId: task.id, planId };
}

test('W3-5b: plan freeze receipts, replay, freezes list and unknown-task 404', async () => {
  const app = await createApplication({ dataDir: mkdtempSync(join(tmpdir(), 'aw-extras-http-')), disableOpenCode: true, disableListen: true });
  try {
    const { taskId, planId } = seed(app, { withPlan: true });
    const key = requestKey('freeze');
    const freeze = await app.app.inject({
      method: 'POST',
      url: `/api/tasks/${taskId}/plan/freeze`,
      payload: { requestKey: key, confirmFreeze: true, note: '发布前冻结' },
    });
    assert.equal(freeze.statusCode, 200, freeze.body);
    assert.equal(freeze.json().data.receipt.status, 'succeeded');
    const frozen = freeze.json().data.resource.freeze as {
      snapshotId: string;
      planRevisionId: string;
      note: string;
      requestKey: string;
      actor: string;
      planHash: string;
      summary: { nodes: number; nodeKeys: string[] };
    };
    assert.equal(freeze.json().data.resource.replayed, false);
    assert.equal(frozen.planRevisionId, planId);
    assert.equal(frozen.note, '发布前冻结');
    assert.equal(frozen.requestKey, key);
    assert.ok(frozen.actor.length > 0);
    assert.ok(frozen.planHash.length > 0);
    assert.equal(frozen.summary.nodes, 1);
    assert.deepEqual(frozen.summary.nodeKeys, ['impl']);
    const operation = await app.app.inject({ method: 'GET', url: `/api/operations/${key}` });
    assert.equal(operation.json().data.operation.status, 'succeeded');
    assert.equal(operation.json().data.operation.operation, 'task.plan.freeze');
    assert.equal(operation.json().data.operation.outcome.snapshotId, frozen.snapshotId);

    const replay = await app.app.inject({
      method: 'POST',
      url: `/api/tasks/${taskId}/plan/freeze`,
      payload: { requestKey: key, confirmFreeze: true, note: '发布前冻结' },
    });
    assert.equal(replay.statusCode, 200, replay.body);
    assert.equal(replay.json().data.receipt.status, 'succeeded');
    assert.equal(replay.json().data.resource.replayed, true);
    assert.equal((replay.json().data.resource.freeze as { snapshotId: string }).snapshotId, frozen.snapshotId);

    const second = await app.app.inject({
      method: 'POST',
      url: `/api/tasks/${taskId}/plan/freeze`,
      payload: { requestKey: requestKey('freeze2'), confirmFreeze: true },
    });
    assert.equal(second.statusCode, 200, second.body);
    assert.equal(second.json().data.resource.replayed, true, 'same plan revision reuses the existing snapshot');

    const list = await app.app.inject({ method: 'GET', url: `/api/tasks/${taskId}/plan/freezes` });
    assert.equal(list.statusCode, 200, list.body);
    assert.equal((list.json().data.items as unknown[]).length, 1);
    assert.equal((list.json().data.latest as { snapshotId: string }).snapshotId, frozen.snapshotId);

    const missingConfirm = await app.app.inject({
      method: 'POST',
      url: `/api/tasks/${taskId}/plan/freeze`,
      payload: { requestKey: requestKey('freeze-noconfirm') },
    });
    assert.equal(missingConfirm.statusCode, 400, missingConfirm.body);
    const missingRequestKey = await app.app.inject({ method: 'POST', url: `/api/tasks/${taskId}/plan/freeze`, payload: { confirmFreeze: true } });
    assert.equal(missingRequestKey.statusCode, 400, missingRequestKey.body);
    const noPlan = seed(app, { withPlan: false });
    const noPlanKey = requestKey('freeze-noplan');
    const noPlanFreeze = await app.app.inject({
      method: 'POST',
      url: `/api/tasks/${noPlan.taskId}/plan/freeze`,
      payload: { requestKey: noPlanKey, confirmFreeze: true },
    });
    assert.equal(noPlanFreeze.statusCode, 404, noPlanFreeze.body);
    assert.equal((await app.app.inject({ method: 'GET', url: `/api/operations/${noPlanKey}` })).json().data.operation.status, 'failed');
    assert.equal((await app.app.inject({ method: 'POST', url: '/api/tasks/task_missing/plan/freeze', payload: { requestKey: requestKey('freeze-missing'), confirmFreeze: true } })).statusCode, 404);
    assert.equal((await app.app.inject({ method: 'GET', url: '/api/tasks/task_missing/plan/freezes' })).statusCode, 404);
  } finally {
    await app.close();
  }
});

test('W3-5b: audit paging/kinds, snapshot review empty/panel states and run content', async () => {
  const app = await createApplication({ dataDir: mkdtempSync(join(tmpdir(), 'aw-extras-read-')), disableOpenCode: true, disableListen: true });
  try {
    const { taskId } = seed(app, { withPlan: true });
    const fixed = seed(app, { withPlan: true, fixedTemplate: true });
    // Two freeze receipts so pagination has more than one audit entry.
    for (const key of [requestKey('audit1'), requestKey('audit2')]) {
      const response = await app.app.inject({ method: 'POST', url: `/api/tasks/${taskId}/plan/freeze`, payload: { requestKey: key, confirmFreeze: true } });
      assert.equal(response.statusCode, 200, response.body);
    }
    const firstPage = await app.app.inject({ method: 'GET', url: `/api/tasks/${taskId}/audit?limit=1` });
    assert.equal(firstPage.statusCode, 200, firstPage.body);
    const page = firstPage.json().data as { items: { id: string; action: string }[]; total: number; limit: number; cursor: string; nextCursor?: string; taskId: string };
    assert.equal(page.taskId, taskId);
    assert.equal(page.limit, 1);
    assert.equal(page.items.length, 1);
    assert.ok(page.total >= 2);
    assert.ok(page.nextCursor !== undefined);
    const secondPage = await app.app.inject({ method: 'GET', url: `/api/tasks/${taskId}/audit?limit=1&cursor=${encodeURIComponent(page.nextCursor!)}` });
    assert.equal(secondPage.statusCode, 200, secondPage.body);
    assert.notEqual((secondPage.json().data.items as { id: string }[])[0]?.id, page.items[0]?.id);
    const filtered = await app.app.inject({ method: 'GET', url: `/api/tasks/${taskId}/audit?kinds=${encodeURIComponent('task.plan.')}` });
    assert.equal(filtered.statusCode, 200, filtered.body);
    const filteredItems = filtered.json().data.items as { action: string; source: string; status?: string }[];
    assert.ok(filteredItems.length >= 1);
    assert.ok(filteredItems.every((item) => item.action.startsWith('task.plan.')));
    assert.ok(filteredItems.some((item) => item.source === 'operation' && item.status === 'succeeded'));

    const plainReview = await app.app.inject({ method: 'GET', url: `/api/tasks/${taskId}/snapshot-review` });
    assert.equal(plainReview.statusCode, 200, plainReview.body);
    assert.equal(plainReview.json().data.applicable, false);
    assert.equal(plainReview.json().data.readOnly, true);
    assert.match(String(plainReview.json().data.reason), /snapshot/);
    assert.equal(plainReview.json().data.partialReport.available, false);

    const fixedReview = await app.app.inject({ method: 'GET', url: `/api/tasks/${fixed.taskId}/snapshot-review?limit=2` });
    assert.equal(fixedReview.statusCode, 200, fixedReview.body);
    const fixedModel = fixedReview.json().data as { applicable: boolean; readOnly: boolean; batches: { total: number; items: unknown[]; limit: number }; progress: { available: boolean; totalBatches: number | null }; scope: { versionsFixed: boolean; mode: string } };
    assert.equal(fixedModel.applicable, false, 'ordinary unit-test template has no source snapshot domain');
    assert.equal(fixedModel.readOnly, true);

    const runContent = await app.app.inject({ method: 'GET', url: `/api/tasks/${taskId}/run-content` });
    assert.equal(runContent.statusCode, 200, runContent.body);
    const content = runContent.json().data as { taskId: string; available: boolean; groups: unknown[]; totals: { nodes: number } };
    assert.equal(content.taskId, taskId);
    assert.equal(content.available, true);
    assert.equal(content.totals.nodes, 1);
    assert.ok(Array.isArray(content.groups));

    for (const path of ['audit', 'snapshot-review', 'run-content']) {
      assert.equal((await app.app.inject({ method: 'GET', url: `/api/tasks/task_missing/${path}` })).statusCode, 404, path);
    }
  } finally {
    await app.close();
  }
});
