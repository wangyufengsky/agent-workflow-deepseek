import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AppError, DatabaseConnectionState, ErrorCode } from '@agent-workflow/shared';
import { looksLikeTimeout, mapMySqlError, redactSecrets, stateFromErrorCode } from './errors.ts';

function mapped(error: unknown, phase: 'probe' | 'query' = 'query', secretValues: string[] = []) {
  const appError = mapMySqlError(error, { connectionId: 'conn-1', phase, secretValues });
  return appError;
}

describe('database error mapping', () => {
  it('maps access denied to DATABASE_AUTH_FAILED', () => {
    const error = mapped({ code: 'ER_ACCESS_DENIED_ERROR', errno: 1045, message: "Access denied for user 'app'@'localhost' (using password: YES)" }, 'probe');
    assert.equal(error.code, ErrorCode.DATABASE_AUTH_FAILED);
    assert.equal(error.details?.mysqlCode, 'ER_ACCESS_DENIED_ERROR');
  });

  it('maps connection refused and timeouts to NETWORK_UNREACHABLE', () => {
    for (const code of ['ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'ECONNRESET']) {
      assert.equal(mapped({ code, message: 'connect failed' }, 'probe').code, ErrorCode.NETWORK_UNREACHABLE, code);
    }
  });

  it('maps db access denied by phase', () => {
    const probe = mapped({ code: 'ER_DBACCESS_DENIED_ERROR', message: 'Access denied for user to database' }, 'probe');
    assert.equal(probe.code, ErrorCode.DATABASE_AUTH_FAILED);
    const query = mapped({ code: 'ER_DBACCESS_DENIED_ERROR', message: 'Access denied for user to database' }, 'query');
    assert.equal(query.code, ErrorCode.DATABASE_QUERY_BLOCKED);
  });

  it('maps syntax/unknown-table errors to VALIDATION_FAILED so the model can fix the SQL', () => {
    for (const code of ['ER_PARSE_ERROR', 'ER_NO_SUCH_TABLE', 'ER_BAD_FIELD_ERROR']) {
      const error = mapped({ code, sqlMessage: 'You have an error in your SQL syntax' });
      assert.equal(error.code, ErrorCode.VALIDATION_FAILED, code);
      assert.equal(error.details?.reason, 'invalid_sql');
    }
  });

  it('maps permission and lock errors to DATABASE_QUERY_BLOCKED', () => {
    assert.equal(mapped({ code: 'ER_TABLEACCESS_DENIED_ERROR', message: 'SELECT command denied' }).code, ErrorCode.DATABASE_QUERY_BLOCKED);
    assert.equal(mapped({ code: 'ER_LOCK_WAIT_TIMEOUT', message: 'Lock wait timeout exceeded' }).details?.reason, 'lock_conflict');
    assert.equal(mapped({ code: 'ER_QUERY_INTERRUPTED', message: 'Query execution was interrupted' }).details?.reason, 'query_timeout');
  });

  it('maps too many connections and unknown failures', () => {
    assert.equal(mapped({ code: 'ER_CON_COUNT_ERROR', message: 'Too many connections' }).code, ErrorCode.CAPABILITY_UNAVAILABLE);
    const unknown = mapped(new Error('socket hang up'));
    assert.equal(unknown.code, ErrorCode.INTERNAL_ERROR);
    assert.equal(unknown.details?.reason, 'driver_error');
  });

  it('passes AppError through untouched', () => {
    const original = new AppError(ErrorCode.DATABASE_QUERY_BLOCKED, 'blocked');
    assert.equal(mapped(original), original);
  });

  it('never includes a known password in the mapped message or details', () => {
    const password = 's3cr3t-Pa55word';
    const error = mapped({ code: 'ER_ACCESS_DENIED_ERROR', message: `Access denied for user with password=${password}` }, 'probe', [password]);
    assert.equal(error.message.includes(password), false);
    assert.equal(JSON.stringify(error.toJSON()).includes(password), false);
  });

  it('redacts connection URLs without leaking credentials', () => {
    const redacted = redactSecrets('connect mysql://app:hunter2@db.local:3306/prod failed');
    assert.equal(redacted.includes('hunter2'), false);
    assert.match(redacted, /mysql:\/\/\[redacted\]@db\.local/);
  });

  it('maps states for the UI', () => {
    assert.equal(stateFromErrorCode(ErrorCode.DATABASE_AUTH_FAILED), DatabaseConnectionState.AUTH_FAILED);
    assert.equal(stateFromErrorCode(ErrorCode.NETWORK_UNREACHABLE), DatabaseConnectionState.UNREACHABLE);
    assert.equal(stateFromErrorCode(ErrorCode.DATABASE_NOT_CONFIGURED), DatabaseConnectionState.NOT_CONFIGURED);
  });

  it('detects timeout-shaped driver errors', () => {
    assert.equal(looksLikeTimeout({ code: 'PROTOCOL_SEQUENCE_TIMEOUT' }), true);
    assert.equal(looksLikeTimeout({ message: 'Query timed out' }), true);
    assert.equal(looksLikeTimeout({ code: 'ER_BAD_FIELD_ERROR', message: 'Unknown column' }), false);
  });
});
