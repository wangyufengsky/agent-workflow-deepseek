import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApplication } from '../../packages/server/src/index.ts';

function requestKey(prefix: string): string {
  return `req_${prefix}${Math.random().toString(36).slice(2, 21)}`;
}

test('PPT work drafts can be created, listed and deleted', async () => {
  const app = await createApplication({ dataDir: mkdtempSync(join(tmpdir(), 'aw-ppt-')), disableOpenCode: true, disableListen: true });
  try {
    const empty = await app.app.inject({ method: 'GET', url: '/api/ppt/works' });
    assert.equal(empty.statusCode, 200, empty.body);
    assert.equal(empty.json().data.works.length, 0);
    const created = await app.app.inject({
      method: 'POST',
      url: '/api/ppt/works',
      payload: { requestKey: requestKey('ppt'), title: '季度汇报', topic: '本季度交付与风险', confirmCreate: true },
    });
    assert.equal(created.statusCode, 200, created.body);
    const works = created.json().data.resource as { id: string; status: string; title: string }[];
    assert.equal(works.length, 1);
    assert.equal(works[0]!.status, 'draft');
    const id = works[0]!.id;
    const deleted = await app.app.inject({ method: 'DELETE', url: `/api/ppt/works/${id}` });
    assert.equal(deleted.statusCode, 200, deleted.body);
    assert.equal(deleted.json().data.resource.length, 0);
    const missing = await app.app.inject({ method: 'DELETE', url: `/api/ppt/works/${id}` });
    assert.equal(missing.statusCode, 404, missing.body);
  } finally {
    await app.close();
  }
});
