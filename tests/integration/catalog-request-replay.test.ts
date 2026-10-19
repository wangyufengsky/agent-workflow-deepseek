import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequestKey, type TaskTemplate } from '@agent-workflow/shared';
import { createApplication } from '../../packages/server/src/index.ts';

test('new-role save, publish, archive and template import/update/archive replay original keys after their states change', async () => {
  const app = await createApplication({ dataDir: mkdtempSync(join(tmpdir(), 'aw-catalog-replay-')), disableOpenCode: true, disableListen: true });
  try {
    const draft = { requestKey: createRequestKey(), name: '回执测试职业', purpose: '检查重复请求', responsibilities: ['校对结果'], confirmSave: true as const };
    const saved = app.engine.roleCatalog.save(draft);
    const roleId = saved.resource!.roles.find((role) => role.name === draft.name)!.id;
    assert.equal(app.engine.roleCatalog.save(draft).receipt.auditId, saved.receipt.auditId);
    assert.equal(app.engine.roleCatalog.list().roles.filter((role) => role.name === draft.name).length, 1);
    assert.throws(() => app.engine.roleCatalog.save({ ...draft, name: '不同请求' }), { code: 'REQUEST_KEY_REUSED' });
    const publish = { requestKey: createRequestKey(), confirmPublish: true as const };
    const published = app.engine.roleCatalog.publish(roleId, publish);
    assert.equal(app.engine.roleCatalog.publish(roleId, publish).receipt.auditId, published.receipt.auditId);
    const archive = { requestKey: createRequestKey(), confirmArchive: true as const };
    const archived = app.engine.roleCatalog.archive(roleId, archive);
    assert.equal(app.engine.roleCatalog.archive(roleId, archive).receipt.auditId, archived.receipt.auditId);
    assert.equal(app.engine.roleCatalog.save(draft).receipt.auditId, saved.receipt.auditId);
    assert.equal(app.engine.roleCatalog.list().roles.some((role) => role.id === roleId), false);

    const template: TaskTemplate = { id: 'template.custom.replay', name: '回执模板', version: 1, lockedAfterCreate: true, steps: [{ key: 'read', title: '读取', kind: 'implementation', group: '固定' }], parameters: [] };
    const imported = { requestKey: createRequestKey(), template, confirmImport: true as const };
    const first = app.engine.templates.import(imported);
    const updated = { requestKey: createRequestKey(), template: { ...template, version: 2 }, confirmUpdate: true as const };
    const second = app.engine.templates.update(template.id, updated);
    assert.equal(app.engine.templates.import(imported).receipt.auditId, first.receipt.auditId);
    assert.equal(app.engine.templates.update(template.id, updated).receipt.auditId, second.receipt.auditId);
    assert.throws(() => app.engine.templates.import({ ...imported, template: { ...template, name: '篡改内容' } }), { code: 'REQUEST_KEY_REUSED' });
    const deletion = { requestKey: createRequestKey(), confirmArchive: true };
    const removed = await app.app.inject({ method: 'DELETE', url: `/api/catalog/templates/${template.id}`, payload: deletion });
    assert.equal(removed.statusCode, 200, removed.body);
    const repeated = await app.app.inject({ method: 'DELETE', url: `/api/catalog/templates/${template.id}`, payload: deletion });
    assert.equal(repeated.statusCode, 200, repeated.body);
    assert.equal(repeated.json().data.receipt.auditId, removed.json().data.receipt.auditId);
    for (const status of ['accepted', 'unknown'] as const) {
      app.store.db.prepare('UPDATE operations SET status = ? WHERE request_key = ?').run(status, draft.requestKey);
      assert.equal(app.engine.roleCatalog.save(draft).receipt.status, status);
      app.store.db.prepare('UPDATE operations SET status = ? WHERE request_key = ?').run(status, imported.requestKey);
      assert.equal(app.engine.templates.import(imported).receipt.status, status);
      assert.equal(app.engine.templates.list().length, 0);
      assert.equal(app.engine.roleCatalog.list().roles.some((role) => role.id === roleId), false);
    }
  } finally { await app.close(); }
});

test('project archived flag is part of identity; repeated charter confirmation cannot overwrite later user edits', async () => {
  const root = mkdtempSync(join(tmpdir(), 'aw-charter-receipt-'));
  const app = await createApplication({ dataDir: mkdtempSync(join(tmpdir(), 'aw-project-replay-')), disableOpenCode: true, disableListen: true });
  try {
    const project = app.store.projects.create({ name: 'Replay', rootPath: root, gitState: 'not_git' });
    const update = { requestKey: createRequestKey(), archived: true };
    const archived = app.engine.projects.update(project.id, update);
    assert.equal(app.engine.projects.update(project.id, update).receipt.auditId, archived.receipt.auditId);
    assert.throws(() => app.engine.projects.update(project.id, { ...update, archived: false }), { code: 'REQUEST_KEY_REUSED' });
    await app.engine.charters.update(project.id, { requestKey: createRequestKey(), content: '# 公约\n只读检查\n' });
    const confirm = { requestKey: createRequestKey(), confirmWrite: true as const };
    const original = await app.engine.charters.confirm(project.id, confirm);
    writeFileSync(join(root, 'AGENTS.md'), '# 用户后续编辑\n');
    for (const status of ['succeeded', 'accepted', 'unknown'] as const) {
      app.store.db.prepare('UPDATE operations SET status = ? WHERE request_key = ?').run(status, confirm.requestKey);
      const result = await app.engine.charters.confirm(project.id, confirm);
      assert.equal(result.receipt.auditId, original.receipt.auditId);
      assert.equal(result.receipt.status, status);
      assert.equal(readFileSync(join(root, 'AGENTS.md'), 'utf8'), '# 用户后续编辑\n');
    }
  } finally { await app.close(); }
});

test('HTTP accepted and unknown receipts never retry fetch, database deletion or global settings after state changes', async () => {
  const app = await createApplication({ dataDir: mkdtempSync(join(tmpdir(), 'aw-http-receipt-')), disableOpenCode: true, disableListen: true });
  try {
    const key = createRequestKey();
    const projectId = 'prj_removed';
    app.engine.commands.begin({ requestKey: key, operation: 'git.fetch', body: { projectId, remote: 'origin' }, target: { projectId } });
    const settingsKey = createRequestKey();
    const patch = { execution: { maxParallelNodes: 2 } };
    app.engine.commands.begin({ requestKey: settingsKey, operation: 'settings.update', body: { patch, confirmAcrossProjects: false }, target: {} });
    const deleteKey = createRequestKey();
    app.engine.commands.begin({ requestKey: deleteKey, operation: 'settings.update', body: { deletedConnectionId: 'db_removed' }, target: {} });
    const settingsBefore = app.engine.publicSettings();
    for (const status of ['accepted', 'unknown'] as const) {
      for (const requestKey of [key, settingsKey, deleteKey]) app.store.db.prepare('UPDATE operations SET status = ? WHERE request_key = ?').run(status, requestKey);
      const responses = [
        await app.app.inject({ method: 'POST', url: `/api/git/repos/${projectId}/fetch`, payload: { requestKey: key, remote: 'origin' } }),
        await app.app.inject({ method: 'PATCH', url: '/api/settings', payload: { requestKey: settingsKey, patch } }),
        await app.app.inject({ method: 'DELETE', url: '/api/settings/databases/db_removed', payload: { requestKey: deleteKey } }),
      ];
      for (const response of responses) {
        assert.equal(response.statusCode, 200, response.body);
        assert.equal(response.json().data.receipt.status, status);
      }
      assert.deepEqual(app.engine.publicSettings(), settingsBefore);
    }
  } finally { await app.close(); }
});
