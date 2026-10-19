import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApplication } from '../../packages/server/src/index.ts';

function requestKey(prefix: string): string {
  return `req_${prefix}${Math.random().toString(36).slice(2, 21)}`;
}

test('database connections can be deleted without touching the database', async () => {
  const app = await createApplication({ dataDir: mkdtempSync(join(tmpdir(), 'aw-dbdel-')), disableOpenCode: true, disableListen: true });
  try {
    const created = await app.app.inject({
      method: 'POST',
      url: '/api/settings/databases',
      payload: { requestKey: requestKey('db'), connection: { name: 'Temp', type: 'mysql', host: '127.0.0.1', port: 3306, database: 'temp_db', schemas: ['temp_db'], user: 'temp', password: 'temp', ssl: false, readOnly: true } },
    });
    assert.equal(created.statusCode, 200, created.body);
    const connectionId = created.json().data.connection.id as string;
    assert.equal((await app.app.inject({ method: 'GET', url: '/api/settings/databases' })).json().data.connections.length, 1);
    const duplicate = await app.app.inject({
      method: 'POST',
      url: '/api/settings/databases',
      payload: { requestKey: requestKey('dup'), connection: { name: 'Temp duplicate', type: 'mysql', host: '127.0.0.1', port: 3306, database: 'temp_db', schemas: ['temp_db'], user: 'temp2', password: 'temp2', ssl: false, readOnly: true } },
    });
    assert.equal(duplicate.statusCode, 409, duplicate.body);
    assert.equal(duplicate.json().error.code, 'CONFLICT');
    const removed = await app.app.inject({ method: 'DELETE', url: `/api/settings/databases/${connectionId}` });
    assert.equal(removed.statusCode, 200, removed.body);
    assert.equal(removed.json().data.connections.length, 0);
    assert.equal((await app.app.inject({ method: 'GET', url: '/api/settings/databases' })).json().data.connections.length, 0);
    const missing = await app.app.inject({ method: 'DELETE', url: `/api/settings/databases/${connectionId}` });
    assert.equal(missing.statusCode, 404, missing.body);
  } finally {
    await app.close();
  }
});
