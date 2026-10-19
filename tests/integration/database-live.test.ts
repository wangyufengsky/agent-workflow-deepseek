import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApplication } from '../../packages/server/src/index.ts';

/**
 * Real MySQL integration against the local java-test project database.
 * Requires WF_DB_URL / WF_DB_USER / WF_DB_PASSWORD (see
 * opencode-workflow-java-test/src/main/resources/application.yml).
 */
const jdbc = process.env.WF_DB_URL ?? '';
const user = process.env.WF_DB_USER ?? '';
const password = process.env.WF_DB_PASSWORD ?? '';
const live = jdbc !== '' && user !== '' && password !== '';

test('live: mysql2 probe and read-only queries against java-test database', { skip: !live, timeout: 60000 }, async () => {
  const match = /jdbc:mysql:\/\/([^:/]+):(\d+)\/([^?]+)/.exec(jdbc);
  assert.ok(match, 'WF_DB_URL must be a jdbc:mysql URL');
  const [, host, port, database] = match;
  const app = await createApplication({ dataDir: mkdtempSync(join(tmpdir(), 'aw-db-live-')), disableOpenCode: true, disableListen: true });
  try {
    const key = () => `req_${Math.random().toString(36).slice(2, 18)}`;
    const upsert = await app.app.inject({
      method: 'POST',
      url: '/api/settings/databases',
      payload: { requestKey: key(), connection: { name: 'java-test', type: 'mysql', host, port: Number(port), database, user, password, ssl: false, readOnly: true } },
    });
    assert.equal(upsert.statusCode, 200, upsert.body);
    const id = upsert.json().data.connection.id;
    assert.ok(!upsert.body.includes(password), 'password must not be echoed');

    const probe = await app.app.inject({ method: 'POST', url: `/api/settings/databases/${id}/probe` });
    assert.equal(probe.statusCode, 200, probe.body);
    assert.equal(probe.json().data.probe.state, 'connected', probe.body);
    assert.ok(probe.json().data.probe.serverVersion.startsWith('9.'));

    const tables = await app.app.inject({ method: 'POST', url: `/api/settings/databases/${id}/query`, payload: { sql: 'SHOW TABLES', limit: 20, confirmReadOnly: true } });
    assert.equal(tables.statusCode, 200, tables.body);
    const tableNames = tables.json().data.result.rows.map((row: string[]) => row[0]);
    assert.ok(tableNames.some((name: string) => name.includes('project')));

    const count = await app.app.inject({ method: 'POST', url: `/api/settings/databases/${id}/query`, payload: { sql: 'SELECT COUNT(*) AS n FROM wf_test_project', limit: 10, confirmReadOnly: true } });
    assert.equal(count.statusCode, 200, count.body);
    assert.equal(count.json().data.result.rows.length, 1);

    const blocked = await app.app.inject({ method: 'POST', url: `/api/settings/databases/${id}/query`, payload: { sql: 'DELETE FROM wf_test_project', limit: 10, confirmReadOnly: true } });
    assert.equal(blocked.statusCode, 400);
    assert.equal(blocked.json().error.code, 'DATABASE_QUERY_BLOCKED');

    const injected = await app.app.inject({ method: 'POST', url: `/api/settings/databases/${id}/query`, payload: { sql: 'SELECT 1; DROP TABLE wf_test_project', limit: 10, confirmReadOnly: true } });
    assert.equal(injected.statusCode, 400);
    assert.ok(!injected.body.includes(password));
  } finally {
    await app.close();
  }
});
