import { AppError, ErrorCode } from '@agent-workflow/shared';

/**
 * Read-only SQL guard. The MCP/database surface is intentionally narrow: the
 * model may only run a single, side-effect free statement. The guard is
 * conservative on purpose — it rejects comments (including MySQL executable
 * `/*! ... *\/` comments), multi-statement input, DDL/DML keywords and clauses
 * that write files or variables (`SELECT ... INTO`, `LOAD_FILE`), then appends a
 * defensive LIMIT to statements where MySQL supports it.
 *
 * Anything rejected here throws `DATABASE_QUERY_BLOCKED`; malformed input
 * (empty, too long, bad limit) throws `VALIDATION_FAILED`.
 */

export type ReadOnlyStatementKind = 'select' | 'show' | 'describe' | 'explain' | 'with';

export interface ReadOnlyGuardOptions {
  /** Maximum number of rows the caller wants back. A +1 sentinel is appended. */
  readonly limit: number;
  /** Maximum accepted SQL length. Defaults to 50_000 characters. */
  readonly statementLimit?: number;
}

export interface PreparedReadOnlyQuery {
  /** Normalised SQL ready to execute; may include an injected LIMIT. */
  readonly sql: string;
  readonly statementKind: ReadOnlyStatementKind;
  readonly limit: number;
  /** True when the guard appended `LIMIT <limit + 1>` to detect truncation. */
  readonly injectedLimit: boolean;
  /** True when the caller already supplied a top-level LIMIT. */
  readonly hasLimit: boolean;
  readonly characters: number;
}

export const DEFAULT_STATEMENT_LIMIT = 50_000;
export const MAX_QUERY_LIMIT = 10_000;

const LEADING_KEYWORDS: ReadonlyMap<string, ReadOnlyStatementKind> = new Map([
  ['SELECT', 'select'],
  ['SHOW', 'show'],
  ['DESC', 'describe'],
  ['DESCRIBE', 'describe'],
  ['EXPLAIN', 'explain'],
  ['WITH', 'with'],
]);

/**
 * Tokens that may never appear outside of a string literal or quoted
 * identifier. Covers DML, DDL, account/procedure administration and the
 * file/variable write paths reachable from a SELECT.
 */
export const FORBIDDEN_KEYWORDS: ReadonlySet<string> = new Set([
  // DML
  'INSERT',
  'UPDATE',
  'DELETE',
  'REPLACE',
  'MERGE',
  'UPSERT',
  // DDL / admin
  'CREATE',
  'ALTER',
  'DROP',
  'TRUNCATE',
  'RENAME',
  'COMMENT',
  'GRANT',
  'REVOKE',
  'CALL',
  'DO',
  'EXEC',
  'EXECUTE',
  'PREPARE',
  'DEALLOCATE',
  'HANDLER',
  'INSTALL',
  'UNINSTALL',
  'SHUTDOWN',
  // sessions / transactions / locks
  'SET',
  'USE',
  'START',
  'COMMIT',
  'ROLLBACK',
  'SAVEPOINT',
  'RELEASE',
  'LOCK',
  'UNLOCK',
  'KILL',
  'FLUSH',
  'RESET',
  'PURGE',
  'CHANGE',
  // IO / variables
  'LOAD',
  'LOAD_FILE',
  'INTO',
  'OUTFILE',
  'DUMPFILE',
  // maintenance that writes
  'OPTIMIZE',
  'REPAIR',
  'ANALYZE',
  'CHECK',
  'CACHE',
  'RECOVER',
]);

/** MySQL treats `ANALYZE` as part of `EXPLAIN ANALYZE`; that form is allowed. */
const ALLOWED_ANALYZE_PREFIXES: ReadonlySet<string> = new Set(['EXPLAIN']);

export function assertQueryLimit(limit: unknown, maxLimit: number = MAX_QUERY_LIMIT): number {
  if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > maxLimit) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, `查询行数上限必须是 1–${maxLimit} 之间的整数`, {
      details: { field: 'limit', limit: typeof limit === 'number' ? limit : null, maxLimit },
    });
  }
  return limit;
}

/**
 * Validate `sql` and return the statement that may be executed. The returned
 * SQL is never a write and never contains a second statement.
 */
export function prepareReadOnlyQuery(sql: unknown, options: ReadOnlyGuardOptions): PreparedReadOnlyQuery {
  const limit = assertQueryLimit(options.limit);

  if (typeof sql !== 'string' || sql.trim().length === 0) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, 'SQL 不能为空', { details: { field: 'sql' } });
  }
  if (sql.includes('\u0000')) {
    throw blocked('SQL 包含空字节', 'nul_byte');
  }
  const statementLimit = options.statementLimit ?? DEFAULT_STATEMENT_LIMIT;
  if (sql.length > statementLimit) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, `SQL 长度超过上限（${statementLimit} 字符）`, {
      details: { field: 'sql', length: sql.length, statementLimit },
    });
  }

  let trimmed = sql.trim();
  if (trimmed.endsWith(';')) trimmed = trimmed.slice(0, -1).trimEnd();
  if (trimmed.length === 0) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, 'SQL 不能为空', { details: { field: 'sql' } });
  }

  const scan = scanStatement(trimmed);
  if (scan.comment !== undefined) {
    throw blocked(`只读查询不允许 SQL 注释（${scan.comment}）`, 'comment_not_allowed');
  }
  if (scan.unterminated !== undefined) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, `SQL 字符串或标识符未闭合（${scan.unterminated}）`, {
      details: { field: 'sql' },
    });
  }
  if (scan.semicolons.length > 0) {
    throw blocked('只读查询只允许单条语句（不允许分号夹带）', 'multiple_statements');
  }

  const leading = scan.tokens[0];
  if (leading === undefined) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, 'SQL 不能为空', { details: { field: 'sql' } });
  }
  const statementKind = LEADING_KEYWORDS.get(leading.word);
  if (statementKind === undefined) {
    throw blocked(`只读查询只允许 SELECT / SHOW / DESC / DESCRIBE / EXPLAIN / WITH，收到 ${leading.word}`, 'leading_keyword_not_allowed');
  }

  for (const token of scan.tokens) {
    if (token.word === 'ANALYZE' && isExplainAnalyze(scan.tokens, token)) continue;
    if (FORBIDDEN_KEYWORDS.has(token.word)) {
      throw blocked(`只读查询不允许关键字 ${token.word}`, 'forbidden_keyword', { keyword: token.word });
    }
    if (token.word === 'FOR' && nextWord(scan.tokens, token.index) === 'SHARE') {
      throw blocked('只读查询不允许加锁读（FOR SHARE）', 'locking_read');
    }
  }

  let prepared = trimmed;
  let injectedLimit = false;
  const hasLimit = scan.tokens.some((token) => token.word === 'LIMIT' && token.depth === 0);
  if ((statementKind === 'select' || statementKind === 'with') && !hasLimit) {
    prepared = `${trimmed} LIMIT ${limit + 1}`;
    injectedLimit = true;
  } else if (hasLimit && (statementKind === 'select' || statementKind === 'with')) {
    // The caller supplied its own LIMIT; the service still caps rows client-side.
    prepared = trimmed;
  }

  return {
    sql: prepared,
    statementKind,
    limit,
    injectedLimit,
    hasLimit,
    characters: trimmed.length,
  };
}

interface ScannedToken {
  readonly word: string;
  readonly depth: number;
  readonly index: number;
}

interface ScanResult {
  readonly tokens: readonly ScannedToken[];
  readonly semicolons: readonly number[];
  readonly comment?: string;
  readonly unterminated?: string;
}

/** Extract keyword tokens, top-level semicolons and comment markers outside quotes. */
function scanStatement(sql: string): ScanResult {
  const tokens: ScannedToken[] = [];
  const semicolons: number[] = [];
  let comment: string | undefined;
  let unterminated: string | undefined;
  let depth = 0;
  let word = '';
  const flush = (): void => {
    if (word.length > 0) {
      tokens.push({ word: word.toUpperCase(), depth, index: tokens.length });
      word = '';
    }
  };

  let index = 0;
  let quote: '"' | "'" | '`' | undefined;
  while (index < sql.length && comment === undefined && unterminated === undefined) {
    const char = sql[index] ?? '';
    if (quote !== undefined) {
      if (quote === '`') {
        if (char === '`') {
          if (sql[index + 1] === '`') {
            index += 2;
            continue;
          }
          quote = undefined;
        }
        index += 1;
        continue;
      }
      if (char === '\\') {
        index += 2;
        continue;
      }
      if (char === quote) {
        if (sql[index + 1] === quote) {
          index += 2;
          continue;
        }
        quote = undefined;
      }
      index += 1;
      continue;
    }

    if (char === "'" || char === '"' || char === '`') {
      flush();
      quote = char;
      index += 1;
      continue;
    }
    if (char === '#') {
      flush();
      comment = '#';
      break;
    }
    if (char === '-' && sql[index + 1] === '-') {
      const after = sql[index + 2];
      // MySQL only treats `--` as a comment when followed by whitespace/control/EOF.
      if (after === undefined || /\s/.test(after)) {
        flush();
        comment = '--';
        break;
      }
      index += 1;
      continue;
    }
    if (char === '/' && sql[index + 1] === '*') {
      flush();
      comment = '/*';
      break;
    }
    if (char === ';') {
      flush();
      semicolons.push(index);
      index += 1;
      continue;
    }
    if (/\s/.test(char)) {
      flush();
      index += 1;
      continue;
    }
    if (isWordStart(char)) {
      word += char;
      index += 1;
      continue;
    }
    if (isWordPart(char)) {
      if (word.length > 0) word += char;
      index += 1;
      continue;
    }
    if (char === '(') {
      flush();
      depth += 1;
      index += 1;
      continue;
    }
    if (char === ')') {
      flush();
      depth = Math.max(0, depth - 1);
      index += 1;
      continue;
    }
    flush();
    index += 1;
  }
  if (quote !== undefined && unterminated === undefined) unterminated = quote;
  flush();
  return { tokens, semicolons, comment, unterminated };
}

function isWordStart(char: string): boolean {
  return (char >= 'A' && char <= 'Z') || (char >= 'a' && char <= 'z') || char === '_';
}

function isWordPart(char: string): boolean {
  return isWordStart(char) || (char >= '0' && char <= '9') || char === '$';
}

function nextWord(tokens: readonly ScannedToken[], index: number): string | undefined {
  return tokens[index + 1]?.word;
}

/** `EXPLAIN ANALYZE` (MySQL 8.0.18+) is read-only; `ANALYZE TABLE` never reaches here. */
function isExplainAnalyze(tokens: readonly ScannedToken[], token: ScannedToken): boolean {
  const previous = tokens[token.index - 1]?.word;
  return previous !== undefined && ALLOWED_ANALYZE_PREFIXES.has(previous);
}

function blocked(message: string, reason: string, extra: Record<string, unknown> = {}): AppError {
  return new AppError(ErrorCode.DATABASE_QUERY_BLOCKED, message, {
    details: { reason, ...extra },
  });
}
