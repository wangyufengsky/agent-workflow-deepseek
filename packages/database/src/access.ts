import { AppError, ErrorCode, type DatabaseAccessGrant } from '@agent-workflow/shared';
import { prepareReadOnlyQuery } from './guard.ts';

const SAFE_FUNCTIONS = new Set(['COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'COALESCE', 'NULLIF', 'IFNULL', 'ROUND', 'ABS', 'LOWER', 'UPPER', 'LENGTH', 'CHAR_LENGTH', 'TRIM', 'SUBSTRING', 'CONCAT', 'CAST', 'CONVERT', 'DATE', 'DATE_FORMAT', 'EXTRACT', 'YEAR', 'MONTH', 'DAY', 'NOW', 'CURRENT_DATE', 'CURRENT_TIMESTAMP', 'DISTINCT', 'IN', 'EXISTS', 'OVER', 'AS', 'FROM', 'SELECT', 'FILTER', 'VALUES', 'NOT']);
const END_FROM = new Set(['WHERE', 'GROUP', 'ORDER', 'HAVING', 'LIMIT', 'UNION', 'EXCEPT', 'INTERSECT', 'WINDOW', 'QUALIFY']);
const IDENTIFIER = /^[\p{L}_][\p{L}\p{N}_$-]*$/u;
function denied(message: string): never { throw new AppError(ErrorCode.FORBIDDEN, message, { details: { reason: 'resource_scope_denied' } }); }

/** Conservative grammar: unsupported constructs are rejected rather than guessed. */
export function assertDatabaseQueryAccess(sql: string, grant: DatabaseAccessGrant): void {
  prepareReadOnlyQuery(sql, { limit: 1 });
  if (grant.schemas.length === 0) denied('此连接没有获准的 schema');
  const tokens = tokenize(sql);
  if (tokens[0]?.toUpperCase() === 'SHOW') { assertMetadataAccess(tokens, grant); return; }
  if (tokens[0]?.toUpperCase() === 'EXPLAIN' && !tokens.some((token) => token.toUpperCase() === 'SELECT')) denied('EXPLAIN 必须包含可核对表范围的 SELECT');
  if (tokens.some((token) => ['WITH', 'TABLE', 'ONLY', 'LATERAL'].includes(token.toUpperCase()))) denied('受限资源查询暂不接受 CTE；请使用显式表名的 SELECT');
  for (let i = 0; i < tokens.length - 1; i++) {
    const token = tokens[i]!;
    if (tokens[i + 1] === '(' && IDENTIFIER.test(token) && !SAFE_FUNCTIONS.has(token.toUpperCase())) denied(`函数或表函数 ${token} 不在只读范围内`);
  }
  const tableAt = (start: number): number => {
    if (tokens[start] === '(') return start;
    const first = tokens[start];
    if (first === undefined || !IDENTIFIER.test(first)) denied('无法确认查询中的表名');
    let schema = grant.defaultSchema;
    let table = first;
    let end = start;
    if (tokens[start + 1] === '.') {
      schema = first;
      table = tokens[start + 2] ?? '';
      end += 2;
      if (table === undefined || !IDENTIFIER.test(table) || tokens[end + 1] === '.') denied('只允许 schema.table 形式的表引用');
    }
    if (['&', ':'].includes(tokens[end + 1] ?? '')) denied('不支持编码或动态表引用');
    if (tokens[end + 1] === '(') denied('不允许从表函数读取受限资源');
    if (!grant.schemas.includes(schema)) denied(`schema ${schema} 不在授权范围内`);
    if (grant.tables.length > 0 && !grant.tables.includes(`${schema}.${table}`)) denied(`表 ${schema}.${table} 不在授权范围内`);
    return end;
  };
  let depth = 0;
  const fromDepths = new Set<number>();
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!.toUpperCase();
    if (token === '(') { depth += 1; continue; }
    if (token === ')') { fromDepths.delete(depth); depth -= 1; continue; }
    if (END_FROM.has(token)) fromDepths.delete(depth);
    if (token === 'FROM' || token === 'JOIN' || (i === 0 && (token === 'DESC' || token === 'DESCRIBE'))) {
      fromDepths.add(depth);
      i = tableAt(i + 1);
      if (tokens[i] === '(') depth += 1;
    } else if (token === ',' && fromDepths.has(depth)) i = tableAt(i + 1);
    else if (token === 'SHOW') denied('受限资源请使用显式 schema.table 查询，不允许无范围的 SHOW');
  }
}

/** MySQL metadata has its own closed grammar; never treat SHOW as a SELECT. */
function assertMetadataAccess(tokens: readonly string[], grant: DatabaseAccessGrant): void {
  let index = 1;
  const keyword = () => tokens[index]?.toUpperCase();
  const identifier = (): string => {
    const value = tokens[index++];
    if (value === undefined || !IDENTIFIER.test(value)) denied('元数据查询必须明确引用有效 schema 或表');
    return value;
  };
  const check = (schema: string, table?: string) => {
    if (!grant.schemas.includes(schema)) denied(`schema ${schema} 不在授权范围内`);
    if (table !== undefined && grant.tables.length > 0 && !grant.tables.includes(`${schema}.${table}`)) denied(`表 ${schema}.${table} 不在授权范围内`);
  };
  const full = keyword() === 'FULL';
  if (full) index++;
  const kind = keyword(); index++;
  if (full && !['TABLES', 'COLUMNS', 'FIELDS'].includes(kind ?? '')) denied('FULL 仅用于表或列元数据');
  if (kind === 'TABLES') {
    let schema = grant.defaultSchema;
    if (keyword() === 'FROM' || keyword() === 'IN') { index++; schema = identifier(); }
    check(schema);
    // SHOW TABLES would disclose names outside a table-level grant. Use an
    // explicit granted table's SHOW COLUMNS / INDEX instead.
    if (grant.tables.length > 0) denied('限定表授权不允许枚举其他表；请明确查询已授权表的列或索引');
  } else if (['COLUMNS', 'FIELDS', 'INDEX', 'INDEXES', 'KEYS'].includes(kind ?? '')) {
    if (keyword() !== 'FROM' && keyword() !== 'IN') denied('列或索引查询必须明确指定表');
    index++;
    let schema = grant.defaultSchema;
    let table = identifier();
    const qualified = tokens[index] === '.';
    if (tokens[index] === '.') { index++; schema = table; table = identifier(); }
    if (keyword() === 'FROM' || keyword() === 'IN') {
      index++; const explicitSchema = identifier();
      if (qualified && schema !== explicitSchema) denied('元数据查询的 schema 不一致');
      schema = explicitSchema;
    }
    check(schema, table);
  } else denied('仅提供已限定 schema 的 SHOW TABLES、COLUMNS/FIELDS、INDEX/INDEXES/KEYS');
  if (keyword() === 'LIKE') {
    if (!['TABLES', 'COLUMNS', 'FIELDS'].includes(kind ?? '')) denied('此元数据语法不支持 LIKE');
    index++; if (tokens[index++] !== '?') denied('LIKE 必须使用单个字符串字面量'); }
  if (index !== tokens.length) denied('不支持这个元数据语法；请使用限定 schema 的表、列或索引查询');
}

function tokenize(sql: string): string[] {
  const tokens: string[] = [];
  let index = 0;
  while (index < sql.length) {
    const char = sql[index]!;
    if (/\s/.test(char)) { index += 1; continue; }
    if (char === "'") {
      index += 1;
      while (index < sql.length) {
        if (sql[index] === '\\') { index += 2; continue; }
        if (sql[index] === "'") { if (sql[index + 1] === "'") { index += 2; continue; } index += 1; break; }
        index += 1;
      }
      tokens.push('?');
      continue;
    }
    if (char === '`' || char === '"') {
      const quote = char;
      let value = '';
      index += 1;
      while (index < sql.length) {
        if (sql[index] === quote) {
          if (sql[index + 1] === quote) { value += quote; index += 2; continue; }
          index += 1; break;
        }
        value += sql[index++];
      }
      tokens.push(value);
      continue;
    }
    const word = /^[\p{L}\p{N}_$-]+/u.exec(sql.slice(index));
    if (word !== null) { tokens.push(word[0]); index += word[0].length; continue; }
    tokens.push(char); index += 1;
  }
  return tokens;
}
