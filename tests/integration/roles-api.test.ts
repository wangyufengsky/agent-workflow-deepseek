import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApplication } from '../../packages/server/src/index.ts';

function requestKey(prefix: string): string {
  return `req_${prefix}${Math.random().toString(36).slice(2, 21)}`;
}

test('role catalog: draft, publish and archive; effective role revision reaches review resolution', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'aw-roles-'));
  const app = await createApplication({ dataDir, disableOpenCode: true, disableListen: true });
  try {
    const initial = await app.app.inject({ method: 'GET', url: '/api/catalog/roles' });
    assert.equal(initial.statusCode, 200, initial.body);
    const reviewer = initial.json().data.roles.find((role: { id: string }) => role.id === 'role.reviewer');
    assert.ok(reviewer !== undefined);
    const originalRevision = reviewer.revision as string;

    const save = await app.app.inject({
      method: 'POST',
      url: '/api/catalog/roles',
      payload: {
        requestKey: requestKey('save'),
        roleId: 'role.reviewer',
        name: '代码审查员（定制）',
        purpose: '只审查与需求相关的正确性与安全风险。',
        responsibilities: ['核对需求覆盖', '标注可复现的风险'],
        confirmSave: true,
      },
    });
    assert.equal(save.statusCode, 200, save.body);
    const draftRoles = save.json().data.resource.roles as { id: string; name: string; hasDraft: boolean }[];
    const draftReviewer = draftRoles.find((role) => role.id === 'role.reviewer')!;
    assert.equal(draftReviewer.hasDraft, true);
    assert.equal(draftReviewer.name, reviewer.name);
    assert.equal(app.engine.catalog.roles.find((role) => role.id === 'role.reviewer')?.name, reviewer.name);

    const publish = await app.app.inject({ method: 'POST', url: '/api/catalog/roles/role.reviewer/publish', payload: { requestKey: requestKey('pub'), confirmPublish: true } });
    assert.equal(publish.statusCode, 200, publish.body);
    const publishedReviewer = (publish.json().data.resource.roles as { id: string; name: string; revision: string; hasDraft: boolean }[]).find((role) => role.id === 'role.reviewer')!;
    assert.equal(publishedReviewer.name, '代码审查员（定制）');
    assert.equal(publishedReviewer.hasDraft, false);
    assert.equal(publishedReviewer.revision, 'r3');
    const history = await app.app.inject({ method: 'GET', url: '/api/catalog/roles/role.reviewer/history' });
    assert.equal(history.statusCode, 200, history.body);
    const entries = history.json().data.history as { revision: string; name: string }[];
    assert.equal(entries.length, 1);
    assert.equal(entries[0]!.revision, 'r3');
    assert.equal(entries[0]!.name, '代码审查员（定制）');
    assert.equal((await app.app.inject({ method: 'GET', url: '/api/catalog/roles/role.missing/history' })).statusCode, 404);
    assert.equal(app.engine.catalog.roles.find((role) => role.id === 'role.reviewer')?.name, '代码审查员（定制）');
    assert.notEqual(app.engine.catalog.roles.find((role) => role.id === 'role.reviewer')?.revision, originalRevision);

    const custom = await app.app.inject({
      method: 'POST',
      url: '/api/catalog/roles',
      payload: {
        requestKey: requestKey('custom'),
        name: '安全审计员',
        purpose: '只做安全审查。',
        responsibilities: ['检查注入风险'],
        confirmSave: true,
      },
    });
    assert.equal(custom.statusCode, 200, custom.body);
    const customDraft = (custom.json().data.resource.roles as { id: string; status: string; name: string }[]).find((role) => role.name === '安全审计员');
    assert.ok(customDraft !== undefined);
    assert.equal(customDraft.status, 'draft');
    const customPublish = await app.app.inject({ method: 'POST', url: `/api/catalog/roles/${customDraft.id}/publish`, payload: { requestKey: requestKey('cpub'), confirmPublish: true } });
    assert.equal(customPublish.statusCode, 200, customPublish.body);
    assert.ok(app.engine.catalog.roles.some((role) => role.id === customDraft.id && role.name === '安全审计员'));

    const archive = await app.app.inject({ method: 'POST', url: '/api/catalog/roles/role.reviewer/archive', payload: { requestKey: requestKey('arch'), confirmArchive: true } });
    assert.equal(archive.statusCode, 200, archive.body);
    assert.equal(app.engine.catalog.roles.find((role) => role.id === 'role.reviewer')?.name, reviewer.name);
    const customArchive = await app.app.inject({ method: 'POST', url: `/api/catalog/roles/${customDraft.id}/archive`, payload: { requestKey: requestKey('carch'), confirmArchive: true } });
    assert.equal(customArchive.statusCode, 200, customArchive.body);
    assert.equal(app.engine.catalog.roles.some((role) => role.id === customDraft.id), false);

    // Same requestKey replays the same draft result instead of duplicating.
    const key = requestKey('replay');
    const first = await app.app.inject({ method: 'POST', url: '/api/catalog/roles', payload: { requestKey: key, roleId: 'role.reviewer', name: '再次定制', purpose: '校验幂等', responsibilities: ['幂等'], confirmSave: true } });
    const replay = await app.app.inject({ method: 'POST', url: '/api/catalog/roles', payload: { requestKey: key, roleId: 'role.reviewer', name: '再次定制', purpose: '校验幂等', responsibilities: ['幂等'], confirmSave: true } });
    assert.equal(first.statusCode, 200);
    assert.equal(replay.statusCode, 200, replay.body);
    assert.equal(replay.json().data.receipt.status, 'succeeded');
    assert.ok(replay.json().data.resource.roles.some((role: { id: string }) => role.id === 'role.reviewer'));
  } finally {
    await app.close();
  }
});
