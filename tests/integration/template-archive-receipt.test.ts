import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequestKey, type OperationReceipt, type TemplateArchiveResponse } from '@agent-workflow/shared';
import { createApplication } from '../../packages/server/src/index.ts';
import { archiveReceipt } from '../../apps/web/src/pages/templates/archive-state.ts';

test('template archive accepts only the matching original receipt; missing directory never proves unknown succeeded', async () => {
  const app = await createApplication({ dataDir: mkdtempSync(join(tmpdir(), 'aw-template-receipt-')), disableOpenCode: true, disableListen: true });
  try {
    const template = { id: 'template.custom.archive-proof', name: 'Archive proof', version: 1, lockedAfterCreate: true as const, steps: [{ key: 'one', title: 'Step', kind: 'implementation' as const, group: 'fixed' }], parameters: [] };
    const imported = await app.app.inject({ method: 'POST', url: '/api/catalog/templates/import', payload: { requestKey: createRequestKey(), template, confirmImport: true } }); assert.equal(imported.statusCode, 200, imported.body);
    const key = createRequestKey(); const archived = await app.app.inject({ method: 'DELETE', url: `/api/catalog/templates/${template.id}`, payload: { requestKey: key, confirmArchive: true } }); assert.equal(archived.statusCode, 200, archived.body);
    const response = archived.json().data as TemplateArchiveResponse;
    const original = archiveReceipt(response.receipt, template.id, key)!; assert.equal(original.receiptStatus, 'succeeded'); assert.ok(original.auditId);
    assert.throws(() => archiveReceipt(undefined, template.id, key), /回执.*不匹配/);
    for (const changed of [{ requestKey: 'different' }, { operation: 'catalog.template.update' }, { target: { ref: 'other-template' } }, { auditId: '' }]) assert.throws(() => archiveReceipt({ ...response.receipt, ...changed }, template.id, key), /不匹配/);
    for (const status of ['accepted', 'unknown', 'failed'] as const) assert.equal(archiveReceipt({ ...response.receipt, status }, template.id, key), undefined);
    // Actual template is absent, but its deliberately unknown original operation remains unknown.
    app.store.db.prepare('UPDATE operations SET status=? WHERE request_key=?').run('unknown', key);
    assert.equal(app.engine.templates.list().some((item) => item.id === template.id), false);
    const checked = await app.app.inject({ method: 'GET', url: `/api/operations/${key}` }); assert.equal(checked.statusCode, 200, checked.body);
    assert.equal(archiveReceipt(checked.json().data.operation as OperationReceipt, template.id, key), undefined);
    const replay = await app.app.inject({ method: 'DELETE', url: `/api/catalog/templates/${template.id}`, payload: { requestKey: key, confirmArchive: true } }); assert.equal(replay.statusCode, 200); assert.equal(replay.json().data.receipt.status, 'unknown'); assert.equal(replay.json().data.receipt.auditId, original.auditId);
  } finally { await app.close(); }
});
