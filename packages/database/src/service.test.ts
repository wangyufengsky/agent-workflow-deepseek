import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AppError, DatabaseConnectionState, ErrorCode, type DatabaseConnectionConfig, type DatabaseSettings } from '@agent-workflow/shared';
import { createDatabasePort } from './port.ts';
import { DatabaseService, type SecretResolver } from './service.ts';
import type { MySqlDriver, MySqlDriverFactory, MySqlDriverOptions } from './types.ts';

const SETTINGS: DatabaseSettings = { connections: [], queryTimeoutMs: 3000, rowLimit: 200, statementLimit: 50_000 };

function config(overrides: Partial<DatabaseConnectionConfig> = {}): DatabaseConnectionConfig {
  return {
    id: 'conn-1',
    name: '本地测试库',
    type: 'mysql',
    host: '127.0.0.1',
    port: 3306,
    database: 'demo',
    schemas: ['demo'],
    tables: [],
    user: 'app',
    passwordRef: 'db.conn-1.password',
    readOnly: true,
    ssl: false,
    ...overrides,
  };
}

class FakeSecrets implements SecretResolver {
  readonly values = new Map<string, string>();
  get(ref: string): string | undefined {
    return this.values.get(ref);
  }
}

interface FakeDriverState {
  options?: MySqlDriverOptions;
  creations: number;
  probeCalls: number;
  queryCalls: string[];
  closed: boolean;
}

function fakeFactory(handler: {
  probe?: (options: MySqlDriverOptions) => Promise<{ serverVersion: string; latencyMs: number }>;
  query?: (sql: string, options: MySqlDriverOptions) => Promise<{ columns: { name: string; type?: string }[]; rows: unknown[][] }>;
}): { factory: MySqlDriverFactory; state: FakeDriverState } {
  const state: FakeDriverState = { creations: 0, probeCalls: 0, queryCalls: [], closed: false };
  const factory: MySqlDriverFactory = (options) => {
    state.creations += 1;
    state.options = options;
    const driver: MySqlDriver = {
      async probe(timeoutMs) {
        state.probeCalls += 1;
        assert.equal(timeoutMs > 0, true);
        if (handler.probe !== undefined) return handler.probe(options);
        return { serverVersion: '8.0.36', latencyMs: 4 };
      },
      async query(sql) {
        state.queryCalls.push(sql);
        if (handler.query !== undefined) return handler.query(sql, options);
        return { columns: [{ name: 'id', type: 'INT' }], rows: [[1], [2]] };
      },
      async close() {
        state.closed = true;
      },
    };
    return driver;
  };
  return { factory, state };
}

function services(overrides: { factory?: MySqlDriverFactory; connections?: DatabaseConnectionConfig[]; secrets?: FakeSecrets } = {}) {
  const secrets = overrides.secrets ?? new FakeSecrets();
  secrets.values.set('db.conn-1.password', 'secret-value');
  const { factory, state } = fakeFactory({});
  const service = new DatabaseService({
    settings: { ...SETTINGS, connections: overrides.connections ?? [config()] },
    secrets,
    driverFactory: overrides.factory ?? factory,
  });
  return { service, state, secrets };
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof AppError, `expected AppError, got ${String(error)}`);
    return error.code;
  }
  assert.fail('expected the promise to reject');
}

describe('DatabaseService registration', () => {
  it('lists configured connections without exposing password references', () => {
    const { service } = services();
    const [connection] = service.list();
    assert.equal(connection?.id, 'conn-1');
    assert.equal(connection?.state, DatabaseConnectionState.NOT_CONFIGURED);
    assert.equal('passwordRef' in (connection as object), false);
    assert.equal(JSON.stringify(connection).includes('secret-value'), false);
  });

  it('rejects unknown connection ids with DATABASE_NOT_CONFIGURED', async () => {
    const { service } = services();
    assert.equal(await codeOf(service.probe('missing')), ErrorCode.DATABASE_NOT_CONFIGURED);
    assert.equal(await codeOf(service.queryReadOnly('missing', 'SELECT 1')), ErrorCode.DATABASE_NOT_CONFIGURED);
  });

  it('rejects a connection without a resolved secret as DATABASE_NOT_CONFIGURED', async () => {
    const { service, secrets } = services();
    secrets.values.clear();
    assert.equal(await codeOf(service.probe('conn-1')), ErrorCode.DATABASE_NOT_CONFIGURED);
  });

  it('rejects unsupported database types with CAPABILITY_UNAVAILABLE', async () => {
    const { service } = services({ connections: [config({ type: 'oracle', port: 1521 })] });
    assert.equal(await codeOf(service.probe('conn-1')), ErrorCode.CAPABILITY_UNAVAILABLE);
    const result = await service.tryProbe('conn-1');
    assert.equal(result.state, DatabaseConnectionState.UNSUPPORTED);
  });

  it('routes PostgreSQL connections to the pg driver factory', async () => {
    const secrets = new FakeSecrets();
    secrets.values.set('db.conn-1.password', 'secret-value');
    const { factory: mysqlFactory, state: mysqlState } = fakeFactory({});
    const { factory: pgFactory, state: pgState } = fakeFactory({});
    const service = new DatabaseService({
      settings: { ...SETTINGS, connections: [config({ type: 'postgresql', port: 5432 })] },
      secrets,
      driverFactory: mysqlFactory,
      postgresDriverFactory: pgFactory,
    });
    const probe = await service.probe('conn-1');
    assert.equal(probe.state, DatabaseConnectionState.CONNECTED);
    assert.equal(pgState.probeCalls, 1);
    assert.equal(mysqlState.creations, 0);
    const query = await service.queryReadOnly('conn-1', 'SELECT 1');
    assert.equal(query.columns.length, 1);
  });

  it('rejects malformed connection definitions', () => {
    const secrets = new FakeSecrets();
    assert.throws(
      () => new DatabaseService({ settings: { ...SETTINGS, connections: [config({ port: 0 })] }, secrets }),
      (error: unknown) => error instanceof AppError && error.code === ErrorCode.VALIDATION_FAILED,
    );
  });
});

describe('DatabaseService probe', () => {
  it('reports server version, latency and capabilities on success', async () => {
    const { service, state } = services();
    const result = await service.probe('conn-1');
    assert.equal(result.state, DatabaseConnectionState.CONNECTED);
    assert.equal(result.serverVersion, '8.0.36');
    assert.equal(typeof result.latencyMs, 'number');
    assert.deepEqual(result.capabilities, { query: true, explain: true, schemaRead: true });
    assert.equal(state.options?.password, 'secret-value');
    assert.equal(state.probeCalls, 1);
    assert.equal(service.get('conn-1').state, DatabaseConnectionState.CONNECTED);
  });

  it('maps auth failure, marks the connection and never leaks the password', async () => {
    const { factory } = fakeFactory({
      probe: async () => {
        throw { code: 'ER_ACCESS_DENIED_ERROR', message: "Access denied using password=secret-value" };
      },
    });
    const { service } = services({ factory });
    await assert.rejects(service.probe('conn-1'), (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.code, ErrorCode.DATABASE_AUTH_FAILED);
      assert.equal(JSON.stringify(error.toJSON()).includes('secret-value'), false);
      return true;
    });
    assert.equal(service.get('conn-1').state, DatabaseConnectionState.AUTH_FAILED);
  });

  it('maps refused connections to NETWORK_UNREACHABLE and tryProbe returns a state', async () => {
    const { factory } = fakeFactory({
      probe: async () => {
        throw Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:3306'), { code: 'ECONNREFUSED' });
      },
    });
    const { service } = services({ factory });
    assert.equal(await codeOf(service.probe('conn-1')), ErrorCode.NETWORK_UNREACHABLE);
    const result = await service.tryProbe('conn-1');
    assert.equal(result.state, DatabaseConnectionState.UNREACHABLE);
    assert.equal(result.capabilities.query, false);
    assert.equal(typeof result.message, 'string');
  });

  it('reuses one pooled driver across calls', async () => {
    const { service, state } = services();
    await service.probe('conn-1');
    await service.probe('conn-1');
    assert.equal(state.probeCalls, 2);
    assert.equal(state.creations, 1);
  });
});

describe('DatabaseService read-only query', () => {
  it('executes guarded SQL and maps columns/rows from the driver', async () => {
    const { service, state } = services();
    const result = await service.queryReadOnly('conn-1', 'SELECT id FROM users');
    assert.deepEqual(state.queryCalls, ['SELECT id FROM users LIMIT 201']);
    assert.deepEqual(result.columns, [{ name: 'id', type: 'INT' }]);
    assert.deepEqual(result.rows, [[1], [2]]);
    assert.equal(result.rowCount, 2);
    assert.equal(result.truncated, false);
    assert.equal(typeof result.durationMs, 'number');
    assert.equal(service.get('conn-1').state, DatabaseConnectionState.CONNECTED);
  });

  it('marks results truncated and slices rows to the limit', async () => {
    const { factory } = fakeFactory({
      query: async () => ({ columns: [{ name: 'n' }], rows: [[1], [2], [3], [4]] }),
    });
    const { service } = services({ factory });
    const result = await service.queryReadOnly('conn-1', 'SELECT n FROM nums', { limit: 3 });
    assert.equal(result.rowCount, 3);
    assert.deepEqual(result.rows, [[1], [2], [3]]);
    assert.equal(result.truncated, true);
  });

  it('rejects write SQL before acquiring a driver', async () => {
    const { service, state } = services();
    assert.equal(await codeOf(service.queryReadOnly('conn-1', 'DELETE FROM users')), ErrorCode.DATABASE_QUERY_BLOCKED);
    assert.deepEqual(state.queryCalls, []);
    assert.equal(service.get('conn-1').state, DatabaseConnectionState.NOT_CONFIGURED);
  });

  it('maps query auth failures and closes the driver', async () => {
    const { factory, state } = fakeFactory({
      query: async () => {
        throw { code: 'ER_ACCESS_DENIED_ERROR', message: "Access denied using password=secret-value" };
      },
    });
    const { service } = services({ factory });
    await assert.rejects(service.queryReadOnly('conn-1', 'SELECT 1'), (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.code, ErrorCode.DATABASE_AUTH_FAILED);
      assert.equal(JSON.stringify(error.toJSON()).includes('secret-value'), false);
      return true;
    });
    assert.equal(service.get('conn-1').state, DatabaseConnectionState.AUTH_FAILED);
    assert.equal(state.closed, true);
  });

  it('normalises BigInt, Date, Buffer and nested JSON values', async () => {
    const { factory } = fakeFactory({
      query: async () => ({
        columns: [{ name: 'id' }, { name: 'at' }, { name: 'blob' }, { name: 'doc' }],
        rows: [[10n, new Date('2026-01-02T03:04:05.000Z'), Buffer.from('hi'), { nested: [1n, undefined] }]],
      }),
    });
    const { service } = services({ factory });
    const result = await service.queryReadOnly('conn-1', 'SELECT 1');
    assert.deepEqual(result.rows, [['10', '2026-01-02T03:04:05.000Z', 'base64:aGk=', { nested: ['1', null] }]]);
  });

  it('validates options limits and timeouts', async () => {
    const { service } = services();
    assert.equal(await codeOf(service.queryReadOnly('conn-1', 'SELECT 1', { limit: 0 })), ErrorCode.VALIDATION_FAILED);
    assert.equal(await codeOf(service.queryReadOnly('conn-1', 'SELECT 1', { timeoutMs: 0 })), ErrorCode.VALIDATION_FAILED);
  });

  it('rebuilds the driver when the resolved password changes', async () => {
    const { service, secrets, state } = services();
    await service.queryReadOnly('conn-1', 'SELECT 1');
    secrets.values.set('db.conn-1.password', 'rotated-password');
    await service.queryReadOnly('conn-1', 'SELECT 1');
    assert.equal(state.creations, 2);
    assert.equal(state.options?.password, 'rotated-password');
  });

  it('applySettings closes removed pools', async () => {
    const { service, state } = services();
    await service.queryReadOnly('conn-1', 'SELECT 1');
    await service.applySettings({ ...SETTINGS, connections: [] });
    assert.equal(state.closed, true);
    assert.equal(service.list().length, 0);
    assert.equal(await codeOf(service.queryReadOnly('conn-1', 'SELECT 1')), ErrorCode.DATABASE_NOT_CONFIGURED);
  });
});

describe('DatabasePort adapter', () => {
  it('returns probe state instead of throwing and forwards read-only queries', async () => {
    const { service } = services();
    const port = createDatabasePort(service, { timeoutMs: 2000 });
    const probe = await port.probe('conn-1');
    assert.equal(probe.state, DatabaseConnectionState.CONNECTED);
    assert.equal(probe.serverVersion, '8.0.36');
    const result = (await port.query('conn-1', 'SELECT id FROM users', 5)) as { rowCount: number };
    assert.equal(result.rowCount, 2);

    const missing = await port.probe('missing');
    assert.equal(missing.state, DatabaseConnectionState.NOT_CONFIGURED);
    assert.equal(typeof missing.message, 'string');
    await assert.rejects(port.query('missing', 'SELECT 1'), (error: unknown) => error instanceof AppError && error.code === ErrorCode.DATABASE_NOT_CONFIGURED);
  });
});
