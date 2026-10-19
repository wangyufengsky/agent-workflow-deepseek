import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { ROUTES } from '@agent-workflow/shared';
import { createApplication } from '../../packages/server/src/index.ts';

// Closed localhost port proves only offline failure control flow, never live DB compatibility.
test('HTTP draft probe never saves, schema/table defaults are explicit, and unsupported drivers have service reasons', async () => {
  const root = mkdtempSync(join(tmpdir(), 'aw-draft-db-http-'));
  const listener = createServer(); await new Promise<void>((resolve) => listener.listen(0, '127.0.0.1', resolve));
  const address = listener.address(); assert.ok(address && typeof address === 'object'); const port = address.port;
  await new Promise<void>((resolve) => listener.close(() => resolve()));
  const app = await createApplication({ dataDir: root, disableOpenCode: true, disableListen: true });
  try {
    const get = () => app.app.inject({ method: 'GET', url: ROUTES.databaseConnections });
    const list = (await get()).json().data;
    const supported = list.types.find((type: { id: string }) => type.id === 'mysql'); assert.equal(supported.available, true);
    for (const id of ['opengauss', 'gaussdb', 'sqlserver', 'oracle', 'dm', 'db2']) {
      const type = list.types.find((type: { id: string }) => type.id === id); assert.equal(type.available, false); assert.match(type.disabledReason, /未提供/);
    }
    const before = structuredClone(app.engine.publicSettings().database);
    const connection = { name: 'unsaved', type: 'mysql', host: '127.0.0.1', port, database: 'report', user: 'offline-reader', password: 'draft-fixture-secret', readOnly: true, ssl: false, schemas: ['report'], tables: [] };
    const response = await app.app.inject({ method: 'POST', url: ROUTES.databaseDraftProbe, payload: { connection } });
    assert.equal(response.statusCode, 200, response.body); assert.notEqual(response.json().data.probe.state, 'connected');
    assert.ok(!response.body.includes(connection.password)); assert.deepEqual(app.engine.publicSettings().database, before); assert.deepEqual((await get()).json().data.connections, list.connections);
    for (const patch of [{ schemas: [] }, { schemas: undefined }, { tables: ['secret.orders'] }, { tables: ['orders'] }, { tables: ['report.orders', 'report.orders'] }, { schemas: {} }]) {
      const input = { ...connection, ...patch };
      const draft = await app.app.inject({ method: 'POST', url: ROUTES.databaseDraftProbe, payload: { connection: input } });
      assert.equal(draft.statusCode, 400, draft.body);
      const save = await app.app.inject({ method: 'POST', url: ROUTES.databaseConnections, payload: { requestKey: `req_bad_scope_${Math.random().toString(36).slice(2)}`, connection: input } });
      assert.equal(save.statusCode, 400, save.body);
      assert.deepEqual(app.engine.publicSettings().database, before);
    }
    assert.equal((await app.app.inject({ method: 'POST', url: ROUTES.databaseDraftProbe, payload: {} })).statusCode, 400);
    const saved = await app.app.inject({ method: 'POST', url: ROUTES.databaseConnections, payload: { requestKey: 'req_save_explicit_scope', connection } });
    assert.equal(saved.statusCode, 200, saved.body);
    const record = saved.json().data.connection;
    const unsafeReuse = await app.app.inject({ method: 'POST', url: ROUTES.databaseConnections, payload: { requestKey: 'req_changed_target_no_password', connection: { ...connection, id: record.id, host: 'different-target', password: '' } } });
    assert.equal(unsafeReuse.statusCode, 400, unsafeReuse.body);
    const unsupported = await app.app.inject({ method: 'POST', url: ROUTES.databaseDraftProbe, payload: { connection: { ...connection, type: 'gaussdb' } } });
    assert.equal(unsupported.statusCode, 200); assert.equal(unsupported.json().data.probe.state, 'unsupported');
  } finally { await app.close(); rmSync(root, { recursive: true, force: true }); }
});
