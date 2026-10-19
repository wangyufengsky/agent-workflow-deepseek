import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseService } from './service.ts';
import type { MySqlDriverOptions, MySqlProbeMeasurement } from './types.ts';
import type { DatabaseConnectionConfig, DatabaseDraftProbeRequest } from '@agent-workflow/shared';
const config: DatabaseConnectionConfig = { id: 'saved', name: 'saved', type: 'mysql', host: 'original-host', port: 3306, database: 'report', user: 'reader', ssl: false, readOnly: true, schemas: ['report'], tables: [], passwordRef: 'stored-secret' };
const settings = { connections: [config], rowLimit: 5, queryTimeoutMs: 1000, statementLimit: 5000 };
const draft = (patch: Partial<DatabaseDraftProbeRequest['connection']> = {}): DatabaseDraftProbeRequest['connection'] => ({ name: 'draft', type: 'mysql', host: 'draft-host', port: 3306, database: 'report', user: 'reader', ssl: false, readOnly: true, schemas: ['report'], tables: [], password: 'draft-secret', ...patch });

test('draft probe uses temporary form values, closes success/failure pools, redacts secrets and never changes saved configuration', async () => {
  const calls: MySqlDriverOptions[] = []; let closed = 0; let fail = false;
  const service = new DatabaseService({ settings, secrets: { get: () => 'saved-secret' }, driverFactory: (options) => {
    calls.push(options);
    return { probe: async () => { if (fail) throw new Error(`ECONNREFUSED ${options.password}`); return { serverVersion: 'offline-driver-fixture', latencyMs: 2, sessionReadOnly: true }; }, query: async () => ({ columns: [], rows: [] }), close: async () => { closed++; } };
  } });
  try {
    const before = structuredClone(service.list());
    const probe = await service.probeDraft(draft());
    assert.equal(probe.state, 'connected'); assert.equal(probe.sessionReadOnly, true);
    assert.equal(calls[0]?.host, 'draft-host'); assert.equal(calls[0]?.password, 'draft-secret');
    assert.equal(closed, 1); assert.deepEqual(service.list(), before); assert.deepEqual(service.settings, settings);
    fail = true;
    const failure = await service.probeDraft(draft());
    assert.notEqual(failure.state, 'connected'); assert.ok(!JSON.stringify(failure).includes('draft-secret')); assert.equal(closed, 2); assert.deepEqual(service.list(), before);
    fail = false;
    await service.probeDraft(draft({ id: config.id, host: config.host, password: '' }));
    assert.equal(calls[2]?.password, 'saved-secret', 'blank password may reuse only this same stored target');
    await assert.rejects(service.probeDraft(draft({ id: config.id, password: '' })), /重新输入密码/);
    assert.equal(calls.length, 3, 'stored credential never goes to an edited host');
    assert.equal((await service.probeDraft(draft({ type: 'opengauss' }))).state, 'unsupported');
    assert.equal(calls.length, 3, 'planned driver is not faked by the PostgreSQL or MySQL driver');
  } finally { await service.closeAll(); }
});

test('probe list reports actual session flags; changed definitions invalidate results and late probes cannot restore them', async () => {
  let resolve!: (value: MySqlProbeMeasurement) => void;
  let pending = false;
  const service = new DatabaseService({ settings, secrets: { get: () => 'saved-secret' }, driverFactory: () => ({ probe: async () => pending ? new Promise((done) => { resolve = done; }) : { serverVersion: 'offline-driver-fixture', latencyMs: 1, sessionReadOnly: true }, query: async () => ({ columns: [], rows: [] }), close: async () => {} }) });
  try {
    await service.probe('saved');
    assert.equal(service.list()[0]?.lastProbe?.readOnlyEnforced, true);
    assert.equal(service.list()[0]?.sessionReadOnly, 'enforced');
    await service.applySettings(settings);
    assert.equal(service.list()[0]?.sessionReadOnly, 'enforced', 'unchanged settings retain their exact probe');
    pending = true;
    const oldProbe = service.probe('saved');
    await new Promise<void>((done) => setImmediate(done));
    service.registerConnection({ ...config, host: 'new-target' });
    assert.equal(service.list()[0]?.state, 'not_configured');
    assert.equal(service.list()[0]?.lastProbe, undefined);
    assert.equal(service.list()[0]?.sessionReadOnly, 'unverified');
    resolve({ serverVersion: 'old-server', latencyMs: 1, sessionReadOnly: true }); await oldProbe;
    assert.equal(service.list()[0]?.lastProbe, undefined, 'late old-target probe is not applied to the new target');
  } finally { await service.closeAll(); }
});

test('missing or empty schema grants deny before connection acquisition; scoped metadata and EXPLAIN remain readable', async () => {
  let acquired = 0;
  const service = new DatabaseService({ settings: { ...settings, connections: [{ ...config, schemas: undefined }] }, secrets: { get: () => 'saved-secret' }, driverFactory: () => { acquired++; return { probe: async () => ({ serverVersion: 'offline', latencyMs: 0 }), query: async () => ({ columns: [], rows: [] }), close: async () => {} }; } });
  try {
    await assert.rejects(service.queryReadOnly('saved', 'SELECT 1'), /没有获准/); assert.equal(acquired, 0);
    service.registerConnection(config);
    await service.queryReadOnly('saved', 'SHOW TABLES');
    await service.queryReadOnly('saved', 'EXPLAIN SELECT * FROM report.orders');
    assert.equal(acquired, 1);
    await assert.rejects(service.queryReadOnly('saved', 'SHOW TABLES FROM private'), /不在授权/);
    assert.equal(acquired, 1);
  } finally { await service.closeAll(); }
});

test('a failed recheck replaces a prior read-only success and factory failures cannot echo the draft password', async () => {
  let fail = false;
  const service = new DatabaseService({ settings, secrets: { get: () => 'saved-secret' }, driverFactory: (options) => {
    if (options.connectionId === 'draft') throw new Error(`connection constructor failed ${options.password}`);
    return { probe: async () => { if (fail) throw Object.assign(new Error('auth failed'), { code: 'ER_ACCESS_DENIED_ERROR' }); return { serverVersion: 'offline', latencyMs: 1, sessionReadOnly: true }; }, query: async () => ({ columns: [], rows: [] }), close: async () => {} };
  } });
  try {
    await service.probe('saved'); fail = true;
    await assert.rejects(service.probe('saved'));
    assert.equal(service.list()[0]?.sessionReadOnly, 'unverified');
    assert.equal(service.list()[0]?.lastProbe?.state, 'auth_failed');
    assert.equal(service.list()[0]?.lastProbe?.readOnlyEnforced, undefined);
    const result = await service.probeDraft(draft());
    assert.ok(!JSON.stringify(result).includes('draft-secret'));
    assert.notEqual(result.state, 'connected');
  } finally { await service.closeAll(); }
});
