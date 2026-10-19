import assert from 'node:assert/strict';
import { connect } from 'node:net';
import { describe, it } from 'node:test';
import { DatabaseConnectionState, type DatabaseConnectionConfig } from '@agent-workflow/shared';
import { DatabaseService } from './service.ts';

/**
 * Optional real-MySQL check. It must never fail on a machine without MySQL:
 * unreachable server or missing credentials produce a skip, not a failure.
 */
function canConnect(host: string, port: number, timeoutMs = 400): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const socket = connect({ host, port });
    let settled = false;
    const finish = (reachable: boolean): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(reachable);
    };
    socket.setTimeout(timeoutMs, () => finish(false));
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}

describe('real MySQL probe (optional)', () => {
  it('probes and queries a reachable local MySQL when credentials are provided', async (t) => {
    const host = process.env.AGENT_WORKFLOW_TEST_MYSQL_HOST ?? '127.0.0.1';
    const port = Number(process.env.AGENT_WORKFLOW_TEST_MYSQL_PORT ?? '3306');
    if (!(await canConnect(host, port))) {
      t.skip(`MySQL 不可达 ${host}:${port}，跳过真实探针`);
      return;
    }
    const user = process.env.AGENT_WORKFLOW_TEST_MYSQL_USER;
    const password = process.env.AGENT_WORKFLOW_TEST_MYSQL_PASSWORD;
    if (user === undefined || password === undefined) {
      t.skip('MySQL 可达但未提供 AGENT_WORKFLOW_TEST_MYSQL_USER/PASSWORD，跳过真实探针');
      return;
    }
    const config: DatabaseConnectionConfig = {
      id: 'live-mysql',
      name: 'live mysql',
      type: 'mysql',
      host,
      port,
      database: process.env.AGENT_WORKFLOW_TEST_MYSQL_DATABASE ?? '',
      user,
      passwordRef: 'live-mysql.password',
      readOnly: true,
      ssl: false,
    };
    const service = new DatabaseService({
      settings: { connections: [config], queryTimeoutMs: 5_000, rowLimit: 10, statementLimit: 5_000 },
      secrets: { get: (ref) => (ref === 'live-mysql.password' ? password : undefined) },
    });
    try {
      const probe = await service.probe('live-mysql');
      assert.equal(probe.state, DatabaseConnectionState.CONNECTED);
      assert.equal(typeof probe.serverVersion, 'string');
      assert.equal(probe.capabilities.query, true);
      const result = await service.queryReadOnly('live-mysql', 'SELECT 1 AS one');
      assert.equal(Number(result.rows[0]?.[0]), 1);
      assert.equal(result.columns[0]?.name, 'one');
    } finally {
      await service.closeAll();
    }
  });
});
