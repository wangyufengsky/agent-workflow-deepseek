import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertDatabaseQueryAccess } from './access.ts';
const grant = { connectionId: 'db', projectIds: ['project'], schemas: ['report'], tables: ['report.orders', 'report.customers'], defaultSchema: 'report' };
test('database schema and table boundaries accept qualified reads, aliases, joins, subqueries and constants', () => {
  for (const sql of ['SELECT 1', 'SELECT count(*) FROM report.orders', 'SELECT a.id FROM report.orders a JOIN report.customers b ON a.id=b.id', 'SELECT * FROM (SELECT * FROM report.orders) t', "SELECT 'FROM secret.hidden' FROM orders", 'SELECT * FROM report.orders a, report.customers b', 'SELECT * FROM "report"."orders"']) assert.doesNotThrow(() => assertDatabaseQueryAccess(sql, grant), sql);
});
test('database scope rejects cross schema/table, commas, nested reads, functions, CTE and unsupported syntax', () => {
  for (const sql of ['SELECT * FROM secret.orders', 'SELECT * FROM report.private', 'SELECT * FROM report.orders a, secret.hidden b', 'SELECT * FROM report.orders WHERE id IN (SELECT id FROM secret.hidden)', 'SELECT secret_reader()', 'SELECT * FROM ONLY secret.hidden', 'SELECT * FROM report.orders UNION TABLE secret.hidden', 'WITH hidden AS (SELECT * FROM secret.hidden) SELECT * FROM hidden', 'SHOW TABLES', 'SELECT pg_read_file(\'/secret\')', 'SELECT * FROM generate_series(1,2)', 'SELECT * FROM U&"secret".orders', 'SELECT * FROM "report""evil".orders']) assert.throws(() => assertDatabaseQueryAccess(sql, grant), sql);
  assert.throws(() => assertDatabaseQueryAccess('SELECT 1', { ...grant, schemas: [] }));
});

test('dialect-specific quoting cannot hide a second statement or terminate the read-only transaction', () => {
  assert.throws(() => assertDatabaseQueryAccess("SELECT $$'$$; COMMIT; DELETE FROM report.orders; SELECT $$'$$", grant));
  assert.throws(() => assertDatabaseQueryAccess("SELECT $tag$'$tag$; COMMIT; DELETE FROM report.orders; SELECT $tag$'$tag$", grant));
  assert.throws(() => assertDatabaseQueryAccess("SELECT '\\\\'; COMMIT; DELETE FROM report.orders", grant));
});
