import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseService } from './service.ts';
import type { MySqlDriverOptions } from './types.ts';
import type { DatabaseConnectionConfig } from '@agent-workflow/shared';

test('a session retains its original connection and secret version while global configuration changes', async () => {
  const original: DatabaseConnectionConfig = { id: 'db', name: 'db', type: 'mysql', host: 'old-host', port: 3306, database: 'report', user: 'reader', readOnly: true, ssl: false, passwordRef: 'old-secret', schemas: ['report'], projectIds: ['project'], tables: ['report.orders'] };
  const acquired: MySqlDriverOptions[] = [];
  let closed = 0;
  const service = new DatabaseService({ settings: { connections: [{ ...original, host: 'new-host', passwordRef: 'new-secret' }], rowLimit: 5, queryTimeoutMs: 1000, statementLimit: 5000 }, secrets: { get: (ref) => ref === 'old-secret' ? 'old-password' : 'new-password' }, driverFactory: (options) => {
    acquired.push(options);
    return { probe: async () => ({ serverVersion: 'test seam', latencyMs: 0 }), query: async () => ({ columns: [], rows: [], sessionReadOnly: true }), close: async () => { closed += 1; } };
  } });
  try {
    await service.queryReadOnly('db', 'SELECT * FROM report.orders', { config: original });
    assert.equal(acquired[0]?.host, 'old-host');
    assert.equal(acquired[0]?.password, 'old-password');
    assert.equal(closed, 1, 'scoped pool is always closed after dispatch');
    await assert.rejects(service.queryReadOnly('db', 'SELECT * FROM private.orders', { config: original }));
    assert.equal(acquired.length, 1, 'a denied query never acquires a connection');
    await service.queryReadOnly('db', 'SELECT * FROM report.orders');
    assert.equal(acquired[1]?.host, 'new-host');
    assert.equal(acquired[1]?.password, 'new-password');
  } finally { await service.closeAll(); }
});
