/** Explicit grants: no schema is never an implicit grant to all databases. */
export function databaseScopeIssues(input: { readonly schemas?: readonly string[]; readonly tables?: readonly string[] }): readonly string[] {
  const issues: string[] = [];
  const schemas = Array.isArray(input.schemas) ? input.schemas : [];
  const identifier = /^[\p{L}_][\p{L}\p{N}_$-]*$/u;
  if (!Array.isArray(input.schemas) || input.schemas.length === 0 || input.schemas.some((item) => typeof item !== 'string' || !identifier.test(item))) issues.push('至少明确授权一个有效 schema');
  if (Array.isArray(input.schemas) && new Set(input.schemas).size !== input.schemas.length) issues.push('schema 不能重复');
  if (input.tables !== undefined && (!Array.isArray(input.tables) || input.tables.some((item) => typeof item !== 'string' || item.split('.').length !== 2 || item.split('.').some((part) => !identifier.test(part)) || !schemas.includes(item.split('.')[0]!)))) issues.push('表必须使用已授权 schema.table 格式');
  if (Array.isArray(input.tables) && new Set(input.tables).size !== input.tables.length) issues.push('表不能重复');
  return issues;
}

/** A stored credential is scoped to its original connection target. */
export function sameDatabaseTarget(left: { readonly type: string; readonly host: string; readonly port: number; readonly database: string; readonly user: string; readonly ssl?: boolean }, right: { readonly type: string; readonly host: string; readonly port: number; readonly database: string; readonly user: string; readonly ssl?: boolean } | undefined): boolean {
  return right !== undefined && left.type === right.type && left.host === right.host && left.port === right.port && left.database === right.database && left.user === right.user && (left.ssl ?? false) === (right.ssl ?? false);
}
