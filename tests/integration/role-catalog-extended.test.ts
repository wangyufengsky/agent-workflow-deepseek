import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  RoleCapabilityCatalog,
  RoleCapabilityGroupMeta,
  type RoleCatalogEntry,
  type RoleRevisionSnapshot,
  type RoleValidateResponse,
} from '@agent-workflow/shared';
import { createApplication } from '../../packages/server/src/index.ts';

type App = Awaited<ReturnType<typeof createApplication>>;

function requestKey(prefix: string): string {
  return `req_${prefix}${Math.random().toString(36).slice(2, 21)}`;
}

async function listRoles(app: App): Promise<readonly RoleCatalogEntry[]> {
  const response = await app.app.inject({ method: 'GET', url: '/api/catalog/roles' });
  assert.equal(response.statusCode, 200, response.body);
  return response.json().data.roles as readonly RoleCatalogEntry[];
}

async function saveRole(app: App, payload: Record<string, unknown>): Promise<readonly RoleCatalogEntry[]> {
  const response = await app.app.inject({
    method: 'POST',
    url: '/api/catalog/roles',
    payload: { requestKey: requestKey('role-save'), confirmSave: true, responsibilities: ['检查注入风险'], ...payload },
  });
  assert.equal(response.statusCode, 200, response.body);
  return response.json().data.resource.roles as readonly RoleCatalogEntry[];
}

function findRole(roles: readonly RoleCatalogEntry[], id: string): RoleCatalogEntry {
  const role = roles.find((entry) => entry.id === id);
  assert.ok(role !== undefined, `role ${id} missing`);
  return role;
}

const ALL_CAPS_DISABLED = RoleCapabilityGroupMeta.map((group) => ({
  id: group.id,
  items: RoleCapabilityCatalog.filter((item) => item.group === group.id).map((item) => ({ id: item.id, enabled: false })),
}));

test('W3-3: extended role fields are saved with resolved defaults, validated and published into history', async () => {
  const app = await createApplication({ dataDir: mkdtempSync(join(tmpdir(), 'aw-roles-ext-')), disableOpenCode: true, disableListen: true });
  try {
    const roles = await saveRole(app, {
      name: '安全审计员',
      purpose: '只做安全审查，不修改代码。',
      instructions: '先读项目公约，再按 OWASP 检查注入风险；所有结论附证据。',
      model: 'opencode-go/deepseek-v4.1-flash',
      maxRuntimeMinutes: 30,
      capabilityGroups: [
        { id: 'knowledge', items: [{ id: 'public_knowledge_search', enabled: false }, { id: 'document_write', enabled: true }] },
      ],
      resourcePermissions: {
        tools: [
          { kind: 'native', name: 'read_file' },
          { kind: 'assist', name: 'search_public_knowledge', source: 'opencode-workflow' },
          { kind: 'mcp', name: 'read_document', source: 'example.docs.mcp' },
        ],
        files: [
          { kind: 'read', path: 'docs/原始说明.md', workspace: 'example-workspace-01' },
          { kind: 'write', path: 'draft/结果.json' },
        ],
        commands: [{ argv: ['python3', '-c', 'print("保留 空格")', ''] }],
        resources: [{ id: 'document_read' }, { id: 'native_tools' }],
      },
      image: { id: 'avatar_audit', kind: 'initials', value: '审', label: '审计员形象' },
    });
    const draftEntry = roles.find((entry) => entry.name === '安全审计员')!;
    assert.ok(draftEntry !== undefined);
    assert.equal(draftEntry.status, 'draft');
    assert.equal(draftEntry.hasDraft, true);
    assert.equal(draftEntry.instructions, '先读项目公约，再按 OWASP 检查注入风险；所有结论附证据。');
    assert.equal(draftEntry.model, 'opencode-go/deepseek-v4.1-flash');
    assert.equal(draftEntry.maxRuntimeMinutes, 30);
    assert.equal(draftEntry.capabilityGroups!.length, 4);
    const knowledge = draftEntry.capabilityGroups!.find((group) => group.id === 'knowledge')!;
    assert.equal(knowledge.label, '知识与资料');
    assert.equal(knowledge.items.find((item) => item.id === 'document_write')?.enabled, true);
    assert.equal(knowledge.items.find((item) => item.id === 'public_knowledge_search')?.enabled, false);
    assert.equal(knowledge.items.find((item) => item.id === 'project_knowledge')?.enabled, true, 'unmentioned items keep defaults');
    assert.equal(draftEntry.capabilityGroups!.find((group) => group.id === 'data')?.items.find((item) => item.id === 'database_read')?.enabled, true);
    assert.deepEqual(draftEntry.resourcePermissions!.tools.map((tool) => [tool.kind, tool.name]), [
      ['native', 'read_file'],
      ['assist', 'search_public_knowledge'],
      ['mcp', 'read_document'],
    ]);
    assert.deepEqual(draftEntry.resourcePermissions!.commands[0]?.argv, ['python3', '-c', 'print("保留 空格")', '']);
    assert.deepEqual(draftEntry.resourcePermissions!.resources.map((resource) => [resource.id, resource.label]), [
      ['document_read', '文档读取'],
      ['native_tools', '原生工具'],
    ]);
    assert.equal(draftEntry.image?.id, 'avatar_audit');
    assert.equal(draftEntry.imageHistory?.length, 0);
    assert.equal(draftEntry.draft?.name, '安全审计员');
    assert.equal(draftEntry.draft?.instructions, '先读项目公约，再按 OWASP 检查注入风险；所有结论附证据。');
    assert.ok(draftEntry.publishChecks !== undefined);

    const validate = await app.app.inject({ method: 'POST', url: `/api/catalog/roles/${draftEntry.id}/validate`, payload: {} });
    assert.equal(validate.statusCode, 200, validate.body);
    const validateData = validate.json().data as RoleValidateResponse;
    assert.equal(validateData.hasDraft, true);
    assert.equal(validateData.canPublish, true);
    assert.equal(validateData.draftRevision, 'r1');
    assert.deepEqual(validateData.checks.map((check) => check.id), ['responsibilities', 'capabilities', 'resources', 'image']);
    assert.equal(validateData.checks.find((check) => check.id === 'image')?.state, 'ok');

    const publishKey = requestKey('role-publish');
    const publish = await app.app.inject({
      method: 'POST',
      url: `/api/catalog/roles/${draftEntry.id}/publish`,
      payload: { requestKey: publishKey, confirmPublish: true },
    });
    assert.equal(publish.statusCode, 200, publish.body);
    const publishedEntry = findRole(publish.json().data.resource.roles as readonly RoleCatalogEntry[], draftEntry.id);
    assert.equal(publishedEntry.status, 'published');
    assert.equal(publishedEntry.hasDraft, false);
    assert.equal(publishedEntry.revision, 'r1');
    assert.equal(publishedEntry.instructions, draftEntry.instructions);
    assert.deepEqual(publishedEntry.resourcePermissions!.commands[0]?.argv, ['python3', '-c', 'print("保留 空格")', '']);
    assert.equal(publishedEntry.image?.label, '审计员形象');
    assert.equal(publishedEntry.draft, undefined);
    assert.equal(publishedEntry.imageHistory?.length, 1);
    assert.equal(publishedEntry.imageHistory?.[0]?.revision, 'r1');
    assert.equal(publishedEntry.imageHistory?.[0]?.image?.id, 'avatar_audit');
    assert.equal((await app.app.inject({ method: 'GET', url: `/api/operations/${publishKey}` })).json().data.operation.status, 'succeeded');
    assert.ok(app.engine.catalog.roles.some((role) => role.id === draftEntry.id && (role.instructions ?? '').includes('OWASP')));

    const history = await app.app.inject({ method: 'GET', url: `/api/catalog/roles/${draftEntry.id}/history` });
    assert.equal(history.statusCode, 200, history.body);
    const snapshot = (history.json().data.history as readonly RoleRevisionSnapshot[])[0]!;
    assert.equal(snapshot.revision, 'r1');
    assert.equal(snapshot.instructions, draftEntry.instructions);
    assert.equal(snapshot.model, 'opencode-go/deepseek-v4.1-flash');
    assert.equal(snapshot.maxRuntimeMinutes, 30);
    assert.equal(snapshot.capabilityGroups?.length, 4);
    assert.equal(snapshot.image?.id, 'avatar_audit');

    // Second revision clears the image; history keeps the old binding.
    const nextDraft = await saveRole(app, {
      roleId: draftEntry.id,
      name: '安全审计员',
      purpose: '只做安全审查，不修改代码。',
      instructions: '更新指令：加入供应链检查。',
      image: null,
    });
    const next = findRole(nextDraft, draftEntry.id);
    assert.equal(next.hasDraft, true);
    assert.equal(next.image?.id, 'avatar_audit', 'top-level keeps the published image until publish');
    assert.equal(next.draft?.image, undefined);
    assert.equal(next.instructions, draftEntry.instructions, 'top-level stays the published content');
    const secondValidate = await app.app.inject({ method: 'POST', url: `/api/catalog/roles/${draftEntry.id}/validate`, payload: {} });
    assert.equal(secondValidate.statusCode, 200, secondValidate.body);
    const secondChecks = (secondValidate.json().data as RoleValidateResponse).checks;
    assert.equal(secondChecks.find((check) => check.id === 'image')?.state, 'warn');
    assert.equal(secondValidate.json().data.canPublish, true);
    const secondPublish = await app.app.inject({ method: 'POST', url: `/api/catalog/roles/${draftEntry.id}/publish`, payload: { requestKey: requestKey('role-publish-2'), confirmPublish: true } });
    assert.equal(secondPublish.statusCode, 200, secondPublish.body);
    const afterSecond = findRole(secondPublish.json().data.resource.roles as readonly RoleCatalogEntry[], draftEntry.id);
    assert.equal(afterSecond.revision, 'r2');
    assert.equal(afterSecond.image, undefined);
    assert.deepEqual(afterSecond.imageHistory?.map((entry) => [entry.revision, entry.image?.id]), [
      ['r2', undefined],
      ['r1', 'avatar_audit'],
    ]);
  } finally {
    await app.close();
  }
});

test('W3-3: publish is blocked when capabilities are all off; the failed receipt is auditable', async () => {
  const app = await createApplication({ dataDir: mkdtempSync(join(tmpdir(), 'aw-roles-block-')), disableOpenCode: true, disableListen: true });
  try {
    const roles = await saveRole(app, { name: '空能力角色', purpose: '用于验证发布检查。', capabilityGroups: ALL_CAPS_DISABLED });
    const role = roles.find((entry) => entry.name === '空能力角色')!;
    const validate = await app.app.inject({ method: 'POST', url: `/api/catalog/roles/${role.id}/validate`, payload: {} });
    assert.equal(validate.statusCode, 200, validate.body);
    const data = validate.json().data as RoleValidateResponse;
    assert.equal(data.canPublish, false);
    assert.equal(data.checks.find((check) => check.id === 'capabilities')?.state, 'error');
    assert.match(String(data.checks.find((check) => check.id === 'capabilities')?.detail), /至少启用一项能力/);
    assert.equal(data.checks.find((check) => check.id === 'image')?.state, 'warn');

    const key = requestKey('role-publish-blocked');
    const publish = await app.app.inject({ method: 'POST', url: `/api/catalog/roles/${role.id}/publish`, payload: { requestKey: key, confirmPublish: true } });
    assert.equal(publish.statusCode, 400, publish.body);
    assert.equal(publish.json().error.code, 'VALIDATION_FAILED');
    assert.equal(publish.json().error.details.canPublish, false);
    assert.ok(Array.isArray(publish.json().error.details.checks));
    const operation = await app.app.inject({ method: 'GET', url: `/api/operations/${key}` });
    assert.equal(operation.statusCode, 200, operation.body);
    assert.equal(operation.json().data.operation.status, 'failed');
    assert.equal(findRole(await listRoles(app), role.id).status, 'draft');
  } finally {
    await app.close();
  }
});

test('W3-3: invalid capability/resource/command/image/model values are rejected with field details', async () => {
  const app = await createApplication({ dataDir: mkdtempSync(join(tmpdir(), 'aw-roles-invalid-')), disableOpenCode: true, disableListen: true });
  const base = { name: '非法角色', purpose: '验证校验。' };
  const attempt = async (payload: Record<string, unknown>): Promise<{ statusCode: number; body: { error?: { code: string; details?: Record<string, unknown> } } }> => {
    const response = await app.app.inject({ method: 'POST', url: '/api/catalog/roles', payload: { requestKey: requestKey('role-invalid'), confirmSave: true, responsibilities: ['职责'], ...base, ...payload } });
    return { statusCode: response.statusCode, body: response.json() as { error?: { code: string; details?: Record<string, unknown> } } };
  };
  try {
    const cases: readonly { readonly label: string; readonly payload: Record<string, unknown> }[] = [
      { label: 'unknown capability id', payload: { capabilityGroups: [{ id: 'knowledge', items: [{ id: 'not_a_capability', enabled: true }] }] } },
      { label: 'capability under wrong group', payload: { capabilityGroups: [{ id: 'data', items: [{ id: 'document_read', enabled: true }] }] } },
      { label: 'unknown capability group', payload: { capabilityGroups: [{ id: 'webs', items: [] }] } },
      { label: 'duplicate capability group', payload: { capabilityGroups: [{ id: 'knowledge', items: [] }, { id: 'knowledge', items: [] }] } },
      { label: 'unknown tool kind', payload: { resourcePermissions: { tools: [{ kind: 'shell', name: 'x' }] } } },
      { label: 'absolute file path', payload: { resourcePermissions: { files: [{ kind: 'read', path: '/etc/passwd' }] } } },
      { label: 'parent traversal file path', payload: { resourcePermissions: { files: [{ kind: 'write', path: '../secret.txt' }] } } },
      { label: 'empty command argv', payload: { resourcePermissions: { commands: [{ argv: [] }] } } },
      { label: 'too many command args', payload: { resourcePermissions: { commands: [{ argv: Array.from({ length: 33 }, (_, index) => `a${String(index)}`) }] } } },
      { label: 'non-string command arg', payload: { resourcePermissions: { commands: [{ argv: ['git', 42] }] } } },
      { label: 'unknown resource capability', payload: { resourcePermissions: { resources: [{ id: 'not_a_capability' }] } } },
      { label: 'invalid model', payload: { model: 'bad model!' } },
      { label: 'max runtime too small', payload: { maxRuntimeMinutes: 0 } },
      { label: 'max runtime too large', payload: { maxRuntimeMinutes: 1_441 } },
      { label: 'max runtime not integer', payload: { maxRuntimeMinutes: 1.5 } },
      { label: 'invalid image kind', payload: { image: { id: 'avatar_x', kind: 'svg', value: 'x' } } },
      { label: 'image value too long', payload: { image: { id: 'avatar_x', kind: 'initials', value: '一二三四五六七八九' } } },
    ];
    for (const entry of cases) {
      const result = await attempt(entry.payload);
      assert.equal(result.statusCode, 400, `${entry.label}: ${JSON.stringify(result.body)}`);
      assert.equal(result.body.error?.code, 'VALIDATION_FAILED', entry.label);
    }
    // A command argv may contain intentional empty arguments.
    const valid = await saveRole(app, { name: '空参数角色', purpose: '验证空参数保留。', resourcePermissions: { tools: [], files: [], commands: [{ argv: ['python3', '-c', 'print(1)', ''] }], resources: [] } });
    const entry = valid.find((role) => role.name === '空参数角色')!;
    assert.deepEqual(entry.resourcePermissions!.commands[0]?.argv.at(-1), '');
  } finally {
    await app.close();
  }
});

test('W3-3: old settings records and legacy history snapshots resolve defaults and stay restorable', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'aw-roles-legacy-'));
  const app = await createApplication({ dataDir, disableOpenCode: true, disableListen: true });
  try {
    app.store.settings.putJson('catalog.roles.state', {
      records: [
        {
          id: 'role.developer',
          name: '开发工程师（旧记录）',
          purpose: '旧格式记录，没有任何四页签字段。',
          responsibilities: ['读取任务上下文', '修改代码'],
          revision: 'r9',
          status: 'published',
          publishedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
    });
    app.store.settings.putJson('catalog.role.history.role.developer', [
      { revision: 'r9', name: '开发工程师（旧记录）', purpose: '旧格式记录。', responsibilities: ['读取任务上下文'], publishedAt: new Date().toISOString() },
    ]);
    const roles = await listRoles(app);
    const legacy = findRole(roles, 'role.developer');
    assert.equal(legacy.name, '开发工程师（旧记录）');
    assert.ok((legacy.instructions ?? '').length > 0, 'legacy role gets derived default instructions');
    assert.equal(legacy.capabilityGroups?.length, 4);
    assert.equal(legacy.capabilityGroups?.find((group) => group.id === 'knowledge')?.items.find((item) => item.id === 'document_write')?.enabled, false);
    assert.deepEqual(legacy.resourcePermissions, { tools: [], files: [], commands: [], resources: [] });
    assert.equal(legacy.publishChecks, undefined);
    assert.deepEqual(legacy.imageHistory?.map((entry) => [entry.revision, entry.image]), [['r9', undefined]]);

    const history = await app.app.inject({ method: 'GET', url: '/api/catalog/roles/role.developer/history' });
    assert.equal(history.statusCode, 200, history.body);
    const snapshot = (history.json().data.history as readonly RoleRevisionSnapshot[])[0]!;
    assert.equal(snapshot.revision, 'r9');
    assert.equal(snapshot.instructions, undefined);

    const restore = await app.app.inject({
      method: 'POST',
      url: '/api/catalog/roles/role.developer/restore/r9',
      payload: { requestKey: requestKey('role-restore'), confirmRestore: true },
    });
    assert.equal(restore.statusCode, 200, restore.body);
    const restored = findRole(restore.json().data.resource.roles as readonly RoleCatalogEntry[], 'role.developer');
    assert.equal(restored.hasDraft, true);
    assert.ok((restored.draft?.instructions ?? '').length > 0);
    assert.equal(restored.draft?.capabilityGroups?.length, 4);
    assert.deepEqual(restored.draft?.resourcePermissions, { tools: [], files: [], commands: [], resources: [] });

    // Saving after a legacy restore keeps the resolved defaults and can publish.
    const next = await saveRole(app, {
      roleId: 'role.developer',
      name: '开发工程师（旧记录）',
      purpose: '旧格式记录，没有任何四页签字段。',
      responsibilities: ['读取任务上下文', '修改代码'],
    });
    const draft = findRole(next, 'role.developer');
    assert.equal(draft.draft?.instructions, restored.draft?.instructions);
    assert.equal(draft.draft?.capabilityGroups?.length, 4);
    const publish = await app.app.inject({ method: 'POST', url: '/api/catalog/roles/role.developer/publish', payload: { requestKey: requestKey('legacy-publish'), confirmPublish: true } });
    assert.equal(publish.statusCode, 200, publish.body);
    const published = findRole(publish.json().data.resource.roles as readonly RoleCatalogEntry[], 'role.developer');
    assert.equal(published.hasDraft, false);
    assert.equal(published.revision, 'r10');
    assert.ok((published.instructions ?? '').length > 0);
    assert.equal(published.imageHistory?.length, 2);
  } finally {
    await app.close();
  }
});

test('W3-3: builtin override keeps published content at top-level and exposes the full draft separately', async () => {
  const app = await createApplication({ dataDir: mkdtempSync(join(tmpdir(), 'aw-roles-builtin-')), disableOpenCode: true, disableListen: true });
  try {
    const initial = findRole(await listRoles(app), 'role.reviewer');
    const roles = await saveRole(app, {
      roleId: 'role.reviewer',
      name: '代码审查员（定制）',
      purpose: '只审查与需求相关的正确性与安全风险。',
      responsibilities: ['核对需求覆盖', '标注可复现的风险'],
      instructions: '只读审查，按严重度输出。',
      capabilityGroups: [{ id: 'tools', items: [{ id: 'external_mcp', enabled: false }] }],
    });
    const overridden = findRole(roles, 'role.reviewer');
    assert.equal(overridden.hasDraft, true);
    assert.equal(overridden.name, initial.name, 'top-level name stays the published builtin name');
    assert.equal(overridden.draft?.name, '代码审查员（定制）');
    assert.equal(overridden.draft?.instructions, '只读审查，按严重度输出。');
    assert.equal(overridden.instructions, initial.instructions, 'top-level instructions stay published/default');
    assert.equal(overridden.draft?.capabilityGroups?.find((group) => group.id === 'tools')?.items.find((item) => item.id === 'external_mcp')?.enabled, false);
    assert.ok(overridden.publishChecks?.some((check) => check.id === 'capabilities' && (check.changes ?? []).some((change) => change.includes('外部 MCP'))));
    assert.equal((await listRoles(app)).find((role) => role.id === 'role.reviewer')?.draft?.name, '代码审查员（定制）');
  } finally {
    await app.close();
  }
});
