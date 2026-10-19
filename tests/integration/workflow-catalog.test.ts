import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { MethodCatalogDetail, MethodDraftDefinition, MethodValidationResult } from '@agent-workflow/shared';
import { createApplication } from '../../packages/server/src/index.ts';

type App = Awaited<ReturnType<typeof createApplication>>;

function requestKey(prefix: string): string {
  return `req_${prefix}${Math.random().toString(36).slice(2, 21)}`;
}

async function setup(): Promise<{ app: App; projectId: string }> {
  const app = await createApplication({ dataDir: mkdtempSync(join(tmpdir(), 'aw-methods-')), disableOpenCode: true, disableListen: true });
  const rootPath = mkdtempSync(join(tmpdir(), 'aw-methods-repo-'));
  const project = await app.app.inject({ method: 'POST', url: '/api/projects', payload: { requestKey: requestKey('prj'), name: 'Methods', rootPath } });
  assert.equal(project.statusCode, 201, project.body);
  return { app, projectId: project.json().data.resource.project.id as string };
}

async function builtinDetail(app: App, id = 'method.requirement-development'): Promise<MethodCatalogDetail> {
  const response = await app.app.inject({ method: 'GET', url: `/api/workflows/${id}` });
  assert.equal(response.statusCode, 200, response.body);
  return response.json().data.method as MethodCatalogDetail;
}

function draftFrom(detail: MethodCatalogDetail, name: string): MethodDraftDefinition {
  return {
    name,
    description: `${name}（测试自定义流程）`,
    support: detail.support,
    requiredSteps: detail.requiredSteps,
    refinableGroups: detail.refinableGroups,
    ...(detail.planningStrategy === undefined ? {} : { planningStrategy: detail.planningStrategy }),
  };
}

test('W3-8c: workflow catalog CRUD, receipts, versions, validation and archive', async () => {
  const { app, projectId } = await setup();
  try {
    const list = await app.app.inject({ method: 'GET', url: '/api/workflows' });
    assert.equal(list.statusCode, 200, list.body);
    const builtinItems = list.json().data.items as { id: string; source: string; archived: boolean; stepCount: number }[];
    assert.ok(builtinItems.length > 0);
    assert.ok(builtinItems.every((item) => item.source === 'builtin' && item.archived === false && item.stepCount > 0));
    const detail = await builtinDetail(app);
    assert.ok(detail.requiredSteps.length > 0);
    assert.ok(detail.requiredSteps.some((step) => step.kind === 'delivery' || step.kind === 'verify'));

    // Non-mutating validation: no requestKey required, structured problems.
    const badDraft = { ...draftFrom(detail, ''), requiredSteps: [] };
    const invalid = await app.app.inject({ method: 'POST', url: '/api/workflows/validate', payload: { draft: badDraft } });
    assert.equal(invalid.statusCode, 200, invalid.body);
    const invalidResult = invalid.json().data as MethodValidationResult;
    assert.equal(invalidResult.ok, false);
    assert.ok(invalidResult.problems.some((problem) => problem.code === 'NAME_INVALID'));
    assert.ok(invalidResult.problems.some((problem) => problem.code === 'STEPS_EMPTY'));
    assert.ok(invalidResult.problems.some((problem) => problem.code === 'DELIVERY_ACCEPTANCE_MISSING'));
    const validCheck = await app.app.inject({ method: 'POST', url: '/api/workflows/validate', payload: { draft: draftFrom(detail, '校验通过流程') } });
    assert.equal(validCheck.json().data.ok, true);

    // Missing requestKey on a mutation is rejected before the handler.
    const missingKey = await app.app.inject({
      method: 'POST',
      url: '/api/workflows',
      payload: { draft: draftFrom(detail, '无 requestKey'), confirmCreate: true },
    });
    assert.equal(missingKey.statusCode, 400, missingKey.body);

    const createKey = requestKey('method-create');
    const created = await app.app.inject({
      method: 'POST',
      url: '/api/workflows',
      payload: { requestKey: createKey, draft: draftFrom(detail, '我的发布流程'), confirmCreate: true },
    });
    assert.equal(created.statusCode, 200, created.body);
    assert.equal(created.json().data.receipt.status, 'succeeded');
    const custom = created.json().data.resource.method as MethodCatalogDetail;
    assert.equal(custom.source, 'custom');
    assert.equal(custom.version, 1);
    assert.equal(custom.revision, 'r1');
    assert.equal(custom.name, '我的发布流程');
    assert.equal(custom.copiedFrom, undefined);
    const createOperation = await app.app.inject({ method: 'GET', url: `/api/operations/${createKey}` });
    assert.equal(createOperation.json().data.operation.status, 'succeeded');
    assert.equal(createOperation.json().data.operation.operation, 'catalog.method.create');
    assert.equal(createOperation.json().data.operation.outcome.methodId, custom.id);

    // The custom method is visible in the catalog, bootstrap (start-task
    // directory), and can be used to create a task.
    const customList = await app.app.inject({ method: 'GET', url: '/api/workflows?source=custom&q=%E5%8F%91%E5%B8%83' });
    assert.equal(customList.statusCode, 200, customList.body);
    assert.deepEqual((customList.json().data.items as { id: string }[]).map((item) => item.id), [custom.id]);
    const bootstrap = await app.app.inject({ method: 'GET', url: '/api/bootstrap' });
    assert.ok((bootstrap.json().data.catalog.methods as { id: string }[]).some((method) => method.id === custom.id));
    const task = await app.app.inject({
      method: 'POST',
      url: '/api/tasks',
      payload: { requestKey: requestKey('task-custom'), projectId, title: '自定义流程任务', requirementText: 'R1 测试自定义流程', methodId: custom.id },
    });
    assert.equal(task.statusCode, 201, task.body);
    assert.equal(task.json().data.resource.task.methodId, custom.id);

    // Copying a built-in yields a custom v1 with copiedFrom; replay is idempotent.
    const copyKey = requestKey('method-copy');
    const copied = await app.app.inject({
      method: 'POST',
      url: '/api/workflows/method.requirement-development/copy',
      payload: { requestKey: copyKey, name: '需求开发副本', confirmCopy: true },
    });
    assert.equal(copied.statusCode, 200, copied.body);
    const copy = copied.json().data.resource.method as MethodCatalogDetail;
    assert.equal(copy.source, 'custom');
    assert.equal(copy.copiedFrom?.id, 'method.requirement-development');
    const copyReplay = await app.app.inject({
      method: 'POST',
      url: '/api/workflows/method.requirement-development/copy',
      payload: { requestKey: copyKey, name: '需求开发副本', confirmCopy: true },
    });
    assert.equal(copyReplay.statusCode, 200, copyReplay.body);
    assert.equal(copyReplay.json().data.receipt.status, 'succeeded');
    assert.equal((copyReplay.json().data.resource.method as MethodCatalogDetail).id, copy.id);

    // Save bumps the version; a stale expectedVersion carries currentVersion.
    const saveKey = requestKey('method-save');
    const saveDraft = { ...draftFrom(copy, '需求开发副本'), description: '第二次保存' };
    const saved = await app.app.inject({
      method: 'PATCH',
      url: `/api/workflows/${copy.id}`,
      payload: { requestKey: saveKey, method: saveDraft, expectedVersion: 1, confirmSave: true },
    });
    assert.equal(saved.statusCode, 200, saved.body);
    const savedMethod = saved.json().data.resource.method as MethodCatalogDetail;
    assert.equal(savedMethod.version, 2);
    assert.equal(savedMethod.revision, 'r2');
    assert.equal(savedMethod.description, '第二次保存');
    const stale = await app.app.inject({
      method: 'PATCH',
      url: `/api/workflows/${copy.id}`,
      payload: { requestKey: requestKey('method-stale'), method: saveDraft, expectedVersion: 1, confirmSave: true },
    });
    assert.equal(stale.statusCode, 409, stale.body);
    assert.equal(stale.json().error.code, 'CONFLICT');
    assert.equal(stale.json().error.details.currentVersion, 2);

    // Save-mode validation keeps delivery steps and rejects removing them.
    const noDelivery = {
      ...draftFrom(copy, savedMethod.name),
      requiredSteps: savedMethod.requiredSteps.filter((step) => step.kind !== 'delivery'),
    };
    const invalidSaveKey = requestKey('method-invalid-save');
    const invalidSave = await app.app.inject({
      method: 'PATCH',
      url: `/api/workflows/${copy.id}`,
      payload: { requestKey: invalidSaveKey, method: noDelivery, expectedVersion: 2, confirmSave: true },
    });
    assert.equal(invalidSave.statusCode, 400, invalidSave.body);
    assert.equal(invalidSave.json().error.code, 'VALIDATION_FAILED');
    assert.ok((invalidSave.json().error.details.problems as { code: string }[]).some((problem) => problem.code === 'DELIVERY_STEP_REMOVED'));
    const invalidOperation = await app.app.inject({ method: 'GET', url: `/api/operations/${invalidSaveKey}` });
    assert.equal(invalidOperation.json().data.operation.status, 'failed');

    // Built-ins are read-only (structured builtIn detail).
    const builtinSave = await app.app.inject({
      method: 'PATCH',
      url: '/api/workflows/method.requirement-development',
      payload: { requestKey: requestKey('builtin-save'), method: draftFrom(detail, '改内置'), expectedVersion: 1, confirmSave: true },
    });
    assert.equal(builtinSave.statusCode, 400, builtinSave.body);
    assert.equal(builtinSave.json().error.code, 'VALIDATION_FAILED');
    assert.equal(builtinSave.json().error.details.builtIn, true);
    const builtinArchive = await app.app.inject({
      method: 'DELETE',
      url: '/api/workflows/method.requirement-development',
      payload: { requestKey: requestKey('builtin-archive'), confirmArchive: true },
    });
    assert.equal(builtinArchive.statusCode, 400, builtinArchive.body);
    assert.equal(builtinArchive.json().error.details.builtIn, true);

    // Instantiate returns a frozen deep copy for both sources.
    const instantiateBuiltin = await app.app.inject({ method: 'POST', url: '/api/workflows/method.requirement-development/instantiate' });
    assert.equal(instantiateBuiltin.statusCode, 200, instantiateBuiltin.body);
    assert.equal(instantiateBuiltin.json().data.source, 'builtin');
    assert.equal(instantiateBuiltin.json().data.frozen, true);
    assert.equal(instantiateBuiltin.json().data.method.id, 'method.requirement-development');
    const instantiateCustom = await app.app.inject({ method: 'POST', url: `/api/workflows/${custom.id}/instantiate` });
    assert.equal(instantiateCustom.statusCode, 200, instantiateCustom.body);
    assert.equal(instantiateCustom.json().data.source, 'custom');
    assert.equal(instantiateCustom.json().data.customVersion, 1);
    assert.equal(instantiateCustom.json().data.method.id, custom.id);

    // Archive hides by default, includeArchived shows it, and it cannot be used.
    const archiveKey = requestKey('method-archive');
    const archived = await app.app.inject({
      method: 'DELETE',
      url: `/api/workflows/${custom.id}`,
      payload: { requestKey: archiveKey, confirmArchive: true },
    });
    assert.equal(archived.statusCode, 200, archived.body);
    const archivedMethod = archived.json().data.resource.method as MethodCatalogDetail;
    assert.equal(archivedMethod.archived, true);
    assert.equal(archivedMethod.version, 2);
    const hidden = await app.app.inject({ method: 'GET', url: '/api/workflows?source=custom' });
    assert.ok(!(hidden.json().data.items as { id: string }[]).some((item) => item.id === custom.id));
    const shown = await app.app.inject({ method: 'GET', url: '/api/workflows?source=custom&includeArchived=1' });
    assert.ok((shown.json().data.items as { id: string; archived: boolean }[]).some((item) => item.id === custom.id && item.archived));
    const instantiateArchived = await app.app.inject({ method: 'POST', url: `/api/workflows/${custom.id}/instantiate` });
    assert.equal(instantiateArchived.statusCode, 409, instantiateArchived.body);
    assert.equal(instantiateArchived.json().error.code, 'CONFLICT');
    assert.equal((await app.app.inject({ method: 'GET', url: '/api/workflows/method.missing' })).statusCode, 404);
  } finally {
    await app.close();
  }
});
