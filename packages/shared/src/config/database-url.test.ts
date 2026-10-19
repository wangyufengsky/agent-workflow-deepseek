import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseJdbcDatabaseUrl } from './database-url.ts';

test('parses Spring JDBC URLs into host/port/database', () => {
  assert.deepEqual(parseJdbcDatabaseUrl('jdbc:mysql://127.0.0.1:3306/opencode_workflow_test?connectionTimeZone=UTC&forceConnectionTimeZoneToSession=true'), {
    type: 'mysql', host: '127.0.0.1', port: 3306, database: 'opencode_workflow_test',
  });
  assert.deepEqual(parseJdbcDatabaseUrl('jdbc:postgresql://db.internal:5433/app?sslmode=require'), {
    type: 'postgresql', host: 'db.internal', port: 5433, database: 'app',
  });
  assert.deepEqual(parseJdbcDatabaseUrl('jdbc:mariadb://localhost/report'), {
    type: 'mariadb', host: 'localhost', port: 3306, database: 'report',
  });
  assert.deepEqual(parseJdbcDatabaseUrl('url: ${WF_DB_URL:jdbc:mysql://127.0.0.1:3306/opencode_workflow_test?connectionTimeZone=UTC}'), {
    type: 'mysql', host: '127.0.0.1', port: 3306, database: 'opencode_workflow_test',
  });
});

test('rejects non-JDBC or incomplete URLs', () => {
  assert.equal(parseJdbcDatabaseUrl('https://example.com/db'), undefined);
  assert.equal(parseJdbcDatabaseUrl('jdbc:mysql://127.0.0.1:3306'), undefined);
  assert.equal(parseJdbcDatabaseUrl('127.0.0.1'), undefined);
  assert.equal(parseJdbcDatabaseUrl('jdbc:mysql://127.0.0.1:99999/db'), undefined);
});
