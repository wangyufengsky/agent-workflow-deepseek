import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AppError, ErrorCode } from '@agent-workflow/shared';
import { FORBIDDEN_KEYWORDS, prepareReadOnlyQuery } from './guard.ts';

function prepared(sql: string, limit = 200) {
  return prepareReadOnlyQuery(sql, { limit });
}

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    assert.ok(error instanceof AppError, `expected AppError, got ${String(error)}`);
    return error.code;
  }
  assert.fail('expected the guard to throw');
}

describe('read-only guard: allowed statements', () => {
  it('accepts SELECT and appends a LIMIT sentinel', () => {
    const result = prepared('SELECT id, name FROM users');
    assert.equal(result.statementKind, 'select');
    assert.equal(result.sql, 'SELECT id, name FROM users LIMIT 201');
    assert.equal(result.injectedLimit, true);
    assert.equal(result.hasLimit, false);
  });

  it('accepts a WITH (CTE) query and appends LIMIT at the top level', () => {
    const result = prepared('WITH recent AS (SELECT id FROM users ORDER BY id DESC LIMIT 10) SELECT * FROM recent');
    assert.equal(result.statementKind, 'with');
    assert.equal(result.sql.endsWith('LIMIT 201'), true);
    assert.equal(result.injectedLimit, true);
  });

  it('keeps a caller-supplied LIMIT untouched', () => {
    const result = prepared('SELECT * FROM users LIMIT 5 OFFSET 10');
    assert.equal(result.sql, 'SELECT * FROM users LIMIT 5 OFFSET 10');
    assert.equal(result.injectedLimit, false);
    assert.equal(result.hasLimit, true);
  });

  it('does not append LIMIT to SHOW / DESC / EXPLAIN', () => {
    for (const sql of ['SHOW TABLES', 'DESC users', 'DESCRIBE users', 'EXPLAIN FORMAT=JSON SELECT * FROM users']) {
      const result = prepared(sql);
      assert.equal(result.injectedLimit, false, sql);
      assert.equal(result.sql, sql, sql);
    }
    assert.equal(prepared('SHOW TABLES').statementKind, 'show');
    assert.equal(prepared('DESC users').statementKind, 'describe');
    assert.equal(prepared('EXPLAIN SELECT 1').statementKind, 'explain');
  });

  it('allows EXPLAIN ANALYZE (read-only execution plan)', () => {
    const result = prepared('EXPLAIN ANALYZE SELECT * FROM users');
    assert.equal(result.statementKind, 'explain');
    assert.equal(result.sql, 'EXPLAIN ANALYZE SELECT * FROM users');
  });

  it('allows forbidden-looking words inside string literals and quoted identifiers', () => {
    const result = prepared("SELECT 'DROP TABLE users; DELETE FROM x -- not a comment' AS note, `update` FROM t WHERE label = 'insert'");
    assert.equal(result.statementKind, 'select');
    assert.equal(result.injectedLimit, true);
  });

  it('allows semicolons inside string literals', () => {
    const result = prepared("SELECT 'a;b;c' AS s");
    assert.equal(result.sql.endsWith('LIMIT 201'), true);
  });

  it('strips one trailing semicolon', () => {
    const result = prepared('SELECT 1;   ');
    assert.equal(result.sql, 'SELECT 1 LIMIT 201');
  });

  it('ignores LIMIT inside subqueries when deciding to inject', () => {
    const result = prepared('SELECT * FROM (SELECT id FROM users LIMIT 10) x');
    assert.equal(result.injectedLimit, true);
    assert.equal(result.sql, 'SELECT * FROM (SELECT id FROM users LIMIT 10) x LIMIT 201');
  });

  it('accepts numeric LIMIT syntax without injecting', () => {
    const result = prepared('SELECT * FROM users LIMIT 10, 20');
    assert.equal(result.hasLimit, true);
    assert.equal(result.injectedLimit, false);
  });
});

describe('read-only guard: rejected statements', () => {
  it('rejects DML', () => {
    for (const sql of ['INSERT INTO t VALUES (1)', 'UPDATE t SET a = 1', 'DELETE FROM t', 'REPLACE INTO t VALUES (1)', 'MERGE INTO t USING s ON 1=1']) {
      assert.equal(codeOf(() => prepared(sql)), ErrorCode.DATABASE_QUERY_BLOCKED, sql);
    }
  });

  it('rejects DDL and admin statements', () => {
    for (const sql of ['CREATE TABLE t (id INT)', 'ALTER TABLE t ADD c INT', 'DROP TABLE t', 'TRUNCATE TABLE t', 'GRANT ALL ON *.* TO x', 'CALL p()']) {
      assert.equal(codeOf(() => prepared(sql)), ErrorCode.DATABASE_QUERY_BLOCKED, sql);
    }
  });

  it('rejects a read statement that smuggles a write keyword', () => {
    for (const sql of [
      'SELECT * FROM t FOR UPDATE',
      'SELECT * FROM t FOR SHARE',
      'WITH x AS (SELECT 1) DELETE FROM t',
      'SELECT 1 UNION SELECT 2 INTO @x',
      'EXPLAIN DELETE FROM t',
    ]) {
      assert.equal(codeOf(() => prepared(sql)), ErrorCode.DATABASE_QUERY_BLOCKED, sql);
    }
  });

  it('rejects SELECT ... INTO and file reads/writes', () => {
    for (const sql of ["SELECT * FROM t INTO OUTFILE '/tmp/x'", "SELECT * FROM t INTO DUMPFILE '/tmp/x'", "SELECT LOAD_FILE('/etc/passwd')", "SELECT 'x' INTO @v"]) {
      assert.equal(codeOf(() => prepared(sql)), ErrorCode.DATABASE_QUERY_BLOCKED, sql);
    }
  });

  it('rejects multiple statements and semicolon smuggling', () => {
    for (const sql of ['SELECT 1; SELECT 2', 'SELECT 1;;', '; SELECT 1', 'SHOW TABLES; DROP TABLE t']) {
      assert.equal(codeOf(() => prepared(sql)), ErrorCode.DATABASE_QUERY_BLOCKED, sql);
    }
  });

  it('rejects all SQL comments, including executable MySQL comments', () => {
    for (const sql of ['SELECT 1 -- comment', 'SELECT 1 # comment', 'SELECT 1 /* comment */', 'SELECT 1 /*!50000 UNION SELECT 2 */']) {
      const code = codeOf(() => prepared(sql));
      assert.equal(code, ErrorCode.DATABASE_QUERY_BLOCKED, sql);
    }
  });

  it('does not treat arithmetic minus-minus as a comment', () => {
    const result = prepared('SELECT 1--1 AS v');
    assert.equal(result.statementKind, 'select');
  });

  it('rejects unclosed strings', () => {
    assert.equal(codeOf(() => prepared("SELECT 'abc")), ErrorCode.VALIDATION_FAILED);
  });

  it('rejects empty, non-string and NUL-containing SQL', () => {
    assert.equal(codeOf(() => prepareReadOnlyQuery('   ', { limit: 10 })), ErrorCode.VALIDATION_FAILED);
    assert.equal(codeOf(() => prepareReadOnlyQuery(42, { limit: 10 })), ErrorCode.VALIDATION_FAILED);
    assert.equal(codeOf(() => prepareReadOnlyQuery('SELECT 1\u0000', { limit: 10 })), ErrorCode.DATABASE_QUERY_BLOCKED);
  });

  it('rejects SQL longer than the statement limit', () => {
    const sql = `SELECT '${'x'.repeat(100)}'`;
    assert.equal(codeOf(() => prepareReadOnlyQuery(sql, { limit: 10, statementLimit: 20 })), ErrorCode.VALIDATION_FAILED);
  });

  it('rejects invalid limits', () => {
    for (const limit of [0, -1, 1.5, 100_000]) {
      assert.equal(codeOf(() => prepareReadOnlyQuery('SELECT 1', { limit })), ErrorCode.VALIDATION_FAILED, String(limit));
    }
  });
});

describe('read-only guard: static policy', () => {
  it('covers every write/admin keyword the design lists', () => {
    for (const keyword of ['insert', 'update', 'delete', 'drop', 'alter', 'create', 'truncate', 'grant', 'call', 'set', 'use', 'load', 'lock', 'kill', 'into', 'outfile', 'dumpfile']) {
      assert.equal(FORBIDDEN_KEYWORDS.has(keyword.toUpperCase()), true, keyword);
    }
  });
});
