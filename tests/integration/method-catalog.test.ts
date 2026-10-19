import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_CATALOG, createRequestKey } from '@agent-workflow/shared';
import { Store } from '@agent-workflow/storage';
import { MethodCatalogService, type MethodDraftInput, type MethodStepView } from '../../packages/engine/src/method-catalog.ts';

/**
 * W3-8a: workflow (method) catalog core — merged built-in/custom view, built-in
 * read-only, versioned create/save/copy/archive/validate/instantiate, requestKey
 * idempotency and legacy settings compatibility. The service is instantiated
 * directly (no Engine/HTTP wiring yet).
 */

function makeService(roleIds?: () => readonly string[]): { store: Store; service: MethodCatalogService; close: () => void } {
  const store = new Store({ dataDir: mkdtempSync(join(tmpdir(), 'aw-method-catalog-')) });
  const service = new MethodCatalogService(roleIds === undefined ? { store } : { store, roleIds });
  return { store, service, close: () => store.close() };
}

function step(key: string, title: string, kind: MethodStepView['kind'], group: string, extra: Partial<MethodStepView> = {}): MethodStepView {
  return { key, title, kind, group, ...extra };
}

function validDraft(overrides: Partial<MethodDraftInput> = {}): MethodDraftInput {
  return {
    name: '我的流程',
    description: '自定义流程说明',
    requiredSteps: [step('custom.clarify', '澄清需求', 'requirement', '需求'), step('custom.deliver', '交付', 'delivery', '交付')],
    refinableGroups: [],
    ...overrides,
  };
}

test('merged list exposes the built-in catalog as read-only and custom methods alongside it', () => {
  const { service, close } = makeService();
  try {
    const builtins = service.list({ source: 'builtin' });
    assert.equal(builtins.length, DEFAULT_CATALOG.methods.length);
    assert.ok(builtins.every((entry) => entry.source === 'builtin' && entry.archived === false));
    const requirement = service.get('method.requirement-development');
    assert.equal(requirement.source, 'builtin');
    assert.equal(requirement.version, 12);
    assert.equal(requirement.revision, 'r12');
    assert.ok(requirement.requiredSteps.some((item) => item.kind === 'delivery'));
    const instantiated = service.instantiate('method.requirement-development');
    assert.equal(instantiated.source, 'builtin');
    assert.equal(instantiated.frozen, true);

    // Built-in definitions cannot be edited or archived.
    assert.throws(
      () => service.save('method.requirement-development', { requestKey: createRequestKey(), method: validDraft(), expectedVersion: 12, confirmSave: true }),
      (error: unknown) => (error as { code?: string }).code === 'VALIDATION_FAILED',
    );
    assert.throws(
      () => service.archive('method.requirement-development', { requestKey: createRequestKey(), confirmArchive: true }),
      (error: unknown) => (error as { code?: string }).code === 'VALIDATION_FAILED',
    );
    assert.equal(service.list().length, DEFAULT_CATALOG.methods.length, 'no custom methods yet');
  } finally {
    close();
  }
});

test('create validates, persists with version 1, replays idempotently and instantiates a deep copy', () => {
  const { service, store, close } = makeService();
  try {
    const requestKey = createRequestKey();
    const draft = validDraft({ refinableGroups: ['需求'], planningStrategy: { id: 'planning.custom', version: 'v1', roleId: 'role.developer' } });
    const created = service.create({ requestKey, draft, confirmCreate: true });
    assert.equal(created.replayed, false);
    assert.equal(created.method.source, 'custom');
    assert.equal(created.method.version, 1);
    assert.equal(created.method.revision, 'r1');
    assert.match(created.method.id, /^method\.custom\./);
    assert.equal(created.method.stepCount, 2);
    assert.equal(created.method.planningStrategy?.roleId, 'role.developer');
    assert.deepEqual(created.method.refinableGroups, ['需求']);
    assert.deepEqual(store.settings.getJson('catalog.methods.custom') !== undefined, true);
    assert.equal(service.list({ source: 'custom' }).length, 1);
    assert.equal(service.get(created.method.id).name, '我的流程');

    // Same key + same body replays the stored result (no second definition).
    const replay = service.create({ requestKey, draft, confirmCreate: true });
    assert.equal(replay.replayed, true);
    assert.equal(replay.method.id, created.method.id);
    assert.equal(service.list({ source: 'custom' }).length, 1);
    // Same key + different body is rejected.
    assert.throws(
      () => service.create({ requestKey, draft: validDraft({ name: '另一个' }), confirmCreate: true }),
      (error: unknown) => (error as { code?: string }).code === 'REQUEST_KEY_REUSED',
    );
    // Missing confirm is rejected before any write.
    assert.throws(() => service.create({ requestKey: createRequestKey(), draft }), (error: unknown) => (error as { code?: string }).code === 'VALIDATION_FAILED');

    const instantiated = service.instantiate(created.method.id);
    assert.equal(instantiated.source, 'custom');
    assert.equal(instantiated.customVersion, 1);
    assert.equal(instantiated.method.id, created.method.id);
    assert.deepEqual(instantiated.method.requiredSteps, created.method.requiredSteps);
    // The instantiation is a deep copy; editing it never mutates the catalog.
    (instantiated.method.requiredSteps as MethodStepView[]).push(step('mutated.step', '脏', 'implementation', '实现'));
    assert.equal(service.get(created.method.id).requiredSteps.length, 2);
  } finally {
    close();
  }
});

test('save enforces expectedVersion, bumps version/revision and rejects stale edits', () => {
  const { service, close } = makeService();
  try {
    const created = service.create({ requestKey: createRequestKey(), draft: validDraft(), confirmCreate: true });
    const saved = service.save(created.method.id, {
      requestKey: createRequestKey(),
      method: validDraft({ name: '我的流程 v2', requiredSteps: [step('custom.clarify', '澄清需求', 'requirement', '需求'), step('custom.deliver', '交付与验收', 'delivery', '交付')] }),
      expectedVersion: 1,
      confirmSave: true,
    });
    assert.equal(saved.replayed, false);
    assert.equal(saved.method.version, 2);
    assert.equal(saved.method.revision, 'r2');
    assert.equal(saved.method.name, '我的流程 v2');
    assert.equal(service.get(created.method.id).version, 2);

    // Stale version: the editor gets the current version for "已被更新为版本 N".
    assert.throws(
      () => service.save(created.method.id, { requestKey: createRequestKey(), method: validDraft(), expectedVersion: 1, confirmSave: true }),
      (error: unknown) => {
        const candidate = error as { code?: string; details?: { currentVersion?: number } };
        assert.equal(candidate.code, 'CONFLICT');
        assert.equal(candidate.details?.currentVersion, 2);
        return true;
      },
    );
    // Version must be an integer and the edit must pass validation.
    assert.throws(() => service.save(created.method.id, { requestKey: createRequestKey(), method: validDraft(), expectedVersion: 2.5, confirmSave: true }), (error: unknown) => (error as { code?: string }).code === 'VALIDATION_FAILED');
    assert.throws(
      () => service.save(created.method.id, { requestKey: createRequestKey(), method: validDraft({ requiredSteps: [] }), expectedVersion: 2, confirmSave: true }),
      (error: unknown) => {
        const candidate = error as { code?: string; details?: { problems?: { code: string }[] } };
        assert.equal(candidate.code, 'VALIDATION_FAILED');
        assert.ok(candidate.details?.problems?.some((problem) => problem.code === 'STEPS_EMPTY'));
        return true;
      },
    );
  } finally {
    close();
  }
});

test('copy duplicates a built-in or custom definition into an editable custom method', () => {
  const { service, close } = makeService();
  try {
    const copied = service.copy('method.requirement-development', { requestKey: createRequestKey(), name: '我的需求开发', confirmCopy: true });
    assert.equal(copied.method.source, 'custom');
    assert.equal(copied.method.version, 1);
    assert.equal(copied.method.name, '我的需求开发');
    assert.deepEqual(copied.method.copiedFrom, { id: 'method.requirement-development', version: 12 });
    const builtin = service.get('method.requirement-development');
    assert.deepEqual(copied.method.requiredSteps, builtin.requiredSteps, 'steps are copied from the source revision');

    const defaultNamed = service.copy(copied.method.id, { requestKey: createRequestKey(), confirmCopy: true });
    assert.equal(defaultNamed.method.name, '我的需求开发 副本');
    assert.deepEqual(defaultNamed.method.copiedFrom, { id: copied.method.id, version: 1 });
    assert.throws(
      () => service.copy('method.requirement-development', { requestKey: createRequestKey(), name: 'x'.repeat(121), confirmCopy: true }),
      (error: unknown) => (error as { code?: string }).code === 'VALIDATION_FAILED',
    );
  } finally {
    close();
  }
});

test('archive hides a custom method from the catalog and blocks new usage, keeping history readable', () => {
  const { service, close } = makeService();
  try {
    const created = service.create({ requestKey: createRequestKey(), draft: validDraft(), confirmCreate: true });
    const archived = service.archive(created.method.id, { requestKey: createRequestKey(), confirmArchive: true });
    assert.equal(archived.method.archived, true);
    assert.equal(archived.method.version, 2, 'archive is a versioned state change');
    assert.equal(service.list({ source: 'custom' }).length, 0, 'archived methods disappear from the default catalog');
    assert.equal(service.list({ source: 'custom', includeArchived: true }).length, 1);
    assert.equal(service.get(created.method.id).archived, true, 'history/detail stays readable');
    assert.throws(() => service.instantiate(created.method.id), (error: unknown) => (error as { code?: string }).code === 'CONFLICT');
    assert.throws(() => service.archive(created.method.id, { requestKey: createRequestKey(), confirmArchive: true }), (error: unknown) => (error as { code?: string }).code === 'CONFLICT');
    assert.throws(
      () => service.save(created.method.id, { requestKey: createRequestKey(), method: validDraft(), expectedVersion: 2, confirmSave: true }),
      (error: unknown) => (error as { code?: string }).code === 'CONFLICT',
    );
    assert.throws(() => service.instantiate('method.custom.missing'), (error: unknown) => (error as { code?: string }).code === 'NOT_FOUND');
  } finally {
    close();
  }
});

test('validation covers step shape, delivery retention, roles and dependency cycles', () => {
  const { service, close } = makeService(() => ['role.developer', 'role.requirement-analyst']);
  try {
    const empty = service.validate({ draft: validDraft({ requiredSteps: [] }) });
    assert.equal(empty.ok, false);
    assert.ok(empty.problems.some((problem) => problem.code === 'STEPS_EMPTY'));
    assert.ok(empty.problems.some((problem) => problem.code === 'DELIVERY_ACCEPTANCE_MISSING'));
    assert.equal(empty.checks.find((check) => check.id === 'M2')?.state, 'failed');

    const duplicates = service.validate({
      draft: validDraft({
        requiredSteps: [step('custom.a', 'A', 'implementation', '实现'), step('custom.a', 'B', 'delivery', '交付')],
      }),
    });
    assert.ok(duplicates.problems.some((problem) => problem.code === 'STEP_KEY_DUPLICATE'));

    const badFields = service.validate({
      draft: validDraft({
        requiredSteps: [
          { key: 'Bad Key', title: '', kind: 'implementation', group: '' },
          step('custom.delivery', '交付', 'delivery', '交付'),
        ],
      }),
    });
    for (const code of ['STEP_KEY_INVALID', 'STEP_TITLE_INVALID', 'STEP_GROUP_INVALID']) {
      assert.ok(badFields.problems.some((problem) => problem.code === code), code);
    }

    const unknownRole = service.validate({
      draft: validDraft({
        planningStrategy: { id: 'planning.custom', version: 'v1', roleId: 'role.missing' },
        requiredSteps: [step('custom.a', 'A', 'implementation', '实现', { roleId: 'role.missing' }), step('custom.deliver', '交付', 'delivery', '交付')],
      }),
    });
    assert.ok(unknownRole.problems.some((problem) => problem.code === 'PLANNING_ROLE_UNKNOWN'));
    assert.ok(unknownRole.problems.some((problem) => problem.code === 'STEP_ROLE_UNKNOWN'));

    const cycle = service.validate({
      draft: validDraft({
        requiredSteps: [
          step('custom.a', 'A', 'implementation', '实现', { requires: ['custom.b'] }),
          step('custom.b', 'B', 'implementation', '实现', { requires: ['custom.a'] }),
          step('custom.deliver', '交付', 'delivery', '交付'),
        ],
      }),
    });
    assert.equal(cycle.ok, false);
    assert.ok(cycle.problems.some((problem) => problem.code === 'METHOD_CYCLE'));
    const unknownDependency = service.validate({
      draft: validDraft({ requiredSteps: [step('custom.a', 'A', 'implementation', '实现', { requires: ['custom.missing'] }), step('custom.deliver', '交付', 'delivery', '交付')] }),
    });
    assert.ok(unknownDependency.problems.some((problem) => problem.code === 'STEP_DEPENDENCY_UNKNOWN'));

    const refinable = service.validate({ draft: validDraft({ refinableGroups: ['不存在'] }) });
    assert.ok(refinable.problems.some((problem) => problem.code === 'REFINABLE_GROUP_UNKNOWN'));

    const tooMany = service.validate({ draft: validDraft({ requiredSteps: Array.from({ length: 51 }, (_, index) => step(`custom.s${String(index)}`, `S${String(index)}`, 'implementation', '实现')).concat([step('custom.deliver', '交付', 'delivery', '交付')]) }) });
    assert.ok(tooMany.problems.some((problem) => problem.code === 'STEPS_TOO_MANY'));

    // Saving must keep the delivery/system step that the stored definition has.
    const created = service.create({ requestKey: createRequestKey(), draft: validDraft(), confirmCreate: true });
    const removedDelivery = service.validate({
      draft: validDraft({ requiredSteps: [step('custom.clarify', '澄清需求', 'requirement', '需求')] }),
      id: created.method.id,
    });
    assert.ok(removedDelivery.problems.some((problem) => problem.code === 'DELIVERY_STEP_REMOVED'));
    const valid = service.validate({ draft: validDraft({ requiredSteps: [step('custom.clarify', '澄清需求', 'requirement', '需求', { roleId: 'role.developer' }), step('custom.deliver', '交付', 'delivery', '交付')] }) });
    assert.equal(valid.ok, true, JSON.stringify(valid.problems));
    assert.equal(valid.checks.every((check) => check.state === 'passed'), true);
  } finally {
    close();
  }
});

test('legacy settings JSON (raw methods or wrapped collections) is normalized and stays editable', () => {
  const { service, store, close } = makeService();
  try {
    store.settings.putJson('catalog.methods.custom', [
      {
        id: 'method.custom.legacy-flow',
        name: '旧版流程',
        revision: 'r3',
        requiredSteps: [
          { key: 'legacy.step', title: '手工步骤', kind: 'implementation', group: '实现' },
          { key: 'legacy.deliver', title: '交付', kind: 'delivery', group: '交付' },
        ],
      },
      {
        method: {
          id: 'method.custom.wrapped',
          name: '包裹流程',
          revision: 'r1',
          requiredSteps: [
            { key: 'wrapped.step', title: '步骤', kind: 'implementation', group: '实现' },
            { key: 'wrapped.deliver', title: '交付', kind: 'delivery', group: '交付' },
          ],
        },
        version: 2,
        archived: false,
      },
      { id: 'not-a-custom-method', name: '坏数据' },
      null,
    ]);
    const legacy = service.get('method.custom.legacy-flow');
    assert.equal(legacy.source, 'custom');
    assert.equal(legacy.version, 3, 'version derives from the legacy r3 revision');
    assert.equal(legacy.revision, 'r3');
    assert.equal(legacy.support, 'ai_planning');
    assert.equal(legacy.description, '');
    assert.equal(legacy.requiredSteps.length, 2);
    assert.equal(service.list({ source: 'custom', includeArchived: true }).length, 2, 'broken entries are skipped');
    const instantiated = service.instantiate('method.custom.legacy-flow');
    assert.equal(instantiated.customVersion, 3);
    assert.equal(instantiated.method.revision, 'r3');

    // Wrapped {method, version, archived} entries from a hypothetical earlier schema.
    const wrapped = service.get('method.custom.wrapped');
    assert.equal(wrapped.version, 2);
    assert.equal(wrapped.revision, 'r2');

    // A whole wrapped { methods: [...] } collection from an earlier schema.
    store.settings.putJson('catalog.methods.custom', {
      methods: [{ method: { id: 'method.custom.wrapper-root', name: '整包流程', revision: 'template-v7', requiredSteps: [{ key: 'root.step', title: '步骤', kind: 'implementation', group: '实现' }, { key: 'root.deliver', title: '交付', kind: 'delivery', group: '交付' }] }, version: 7, archived: false }],
    });
    assert.equal(service.get('method.custom.wrapper-root').version, 7);
    assert.equal(service.get('method.custom.wrapper-root').revision, 'r7', 'template-v7 style revisions normalize to a trailing version');

    // Restore the legacy record and prove it stays editable with the normal
    // version-conflict semantics.
    store.settings.putJson('catalog.methods.custom', [
      { id: 'method.custom.legacy-flow', name: '旧版流程', revision: 'r3', requiredSteps: [{ key: 'legacy.step', title: '手工步骤', kind: 'implementation', group: '实现' }, { key: 'legacy.deliver', title: '交付', kind: 'delivery', group: '交付' }] },
    ]);
    const saved = service.save('method.custom.legacy-flow', {
      requestKey: createRequestKey(),
      method: validDraft({ requiredSteps: [step('legacy.step', '手工步骤（改）', 'implementation', '实现'), step('legacy.deliver', '交付', 'delivery', '交付')] }),
      expectedVersion: 3,
      confirmSave: true,
    });
    assert.equal(saved.method.version, 4);
    assert.equal(saved.method.revision, 'r4');
  } finally {
    close();
  }
});
