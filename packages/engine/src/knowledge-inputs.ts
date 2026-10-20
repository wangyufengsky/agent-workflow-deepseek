import { createHash } from 'node:crypto';
import { AppError, ErrorCode, nowIso, type KnowledgePermissions, type KnowledgeSource, type KnowledgePermissionUpdate, type CommandResponse, type DatabaseQueryResult, type RoleDefinition, type ModelProfile } from '@agent-workflow/shared';
import type { Store } from '@agent-workflow/storage';
import type { EngineContext } from './actions.ts';
import type { CommandService } from './operations.ts';
import type { DatabasePort, PublicSearchPort } from './ports.ts';
import { listKnowledgeSources, readKnowledgeSource, classifyKnowledgeSourcePath } from '../../server/src/knowledge.ts';
export interface KnowledgeInputSnapshot {
  readonly documents: readonly { readonly path: string; readonly content: string; readonly sha256: string; readonly kind?: 'code' | 'document' | 'database' | 'web'; readonly databaseGrant?: { readonly schemas: readonly string[]; readonly tables: readonly string[] } }[];
  readonly selectedPaths: readonly string[];
  readonly truncatedPaths: readonly string[];
  readonly model: ModelProfile;
  readonly role?: RoleDefinition;
  readonly networkSearch: boolean;
  readonly frozenAt: string;
}
export class KnowledgeInputs {
  readonly store: Store; readonly commands: CommandService; readonly context: EngineContext; readonly database: DatabasePort | undefined; readonly publicSearch: PublicSearchPort | undefined;
  constructor(store: Store, commands: CommandService, context: EngineContext, database?: DatabasePort, publicSearch?: PublicSearchPort) { this.store = store; this.commands = commands; this.context = context; this.database = database; this.publicSearch = publicSearch; }
  permissions(projectId: string): KnowledgePermissions {
    if (this.store.projects.get(projectId) === undefined) throw new AppError(ErrorCode.NOT_FOUND, '项目不存在');
    const saved = this.store.settings.getJson<{ revision: number; originalRead: boolean; publicSearch: boolean }>(`knowledge.permissions.${projectId}`);
    return { projectId, revision: saved?.revision ?? 0, originalRead: saved?.originalRead ?? true, publicSearch: saved?.publicSearch ?? false,
      publicSearchAvailability: this.publicSearch === undefined ? { allowed: false, reasonCode: ErrorCode.CAPABILITY_UNAVAILABLE, reason: '公共检索服务未接通' } : { allowed: true } };
  }
  updatePermissions(projectId: string, input: KnowledgePermissionUpdate): CommandResponse<KnowledgePermissions> {
    const current = this.permissions(projectId);
    if (input === null || typeof input !== 'object' || typeof input.requestKey !== 'string' || !input.requestKey.startsWith('req_') || (input.originalRead === undefined && input.publicSearch === undefined)) throw new AppError(ErrorCode.VALIDATION_FAILED, '缺少许可变更或合法请求号');
    if ((input.originalRead !== undefined && typeof input.originalRead !== 'boolean') || (input.publicSearch !== undefined && typeof input.publicSearch !== 'boolean')) throw new AppError(ErrorCode.VALIDATION_FAILED, '许可开关必须为布尔值');
    const { record, replayed } = this.commands.begin({ requestKey: input.requestKey, operation: 'settings.update', target: { projectId }, body: { kind: 'knowledge.permissions', projectId, originalRead: input.originalRead, publicSearch: input.publicSearch } });
    if (replayed) return { receipt: this.commands.toReceipt(record), resource: current };
    if (input.publicSearch === true && !current.publicSearchAvailability.allowed) { const error = new AppError(ErrorCode.CAPABILITY_UNAVAILABLE, current.publicSearchAvailability.reason ?? '网络检索不可用'); this.commands.fail(input.requestKey, error); throw error; }
    this.store.settings.putJson(`knowledge.permissions.${projectId}`, { revision: current.revision + 1, originalRead: input.originalRead ?? current.originalRead, publicSearch: input.publicSearch ?? current.publicSearch });
    this.commands.settle(input.requestKey, { projectId });
    return { receipt: this.commands.toReceipt(this.commands.get(input.requestKey)!), resource: this.permissions(projectId) };
  }
  requireOriginal(projectId: string): void { if (!this.permissions(projectId).originalRead) throw new AppError(ErrorCode.REVOKED, '原资料读取许可已关闭'); }
  assertCurrent(projectId: string, snapshot: Pick<KnowledgeInputSnapshot, 'documents' | 'networkSearch'>): void {
    const permissions = this.permissions(projectId);
    if (snapshot.documents.some((document) => !document.path.startsWith('web:')) && !permissions.originalRead) throw new AppError(ErrorCode.REVOKED, '原资料读取许可已撤销，旧内容不再呈现');
    if (snapshot.networkSearch && !permissions.publicSearch) throw new AppError(ErrorCode.REVOKED, '网络公共检索许可已撤销');
    for (const document of snapshot.documents) if (document.path.startsWith('database:')) { const current = this.connection(projectId, document.path.slice('database:'.length)); const grant = document.databaseGrant; if (grant === undefined || grant.schemas.some((schema) => !current.schemas?.includes(schema)) || (current.tables?.length && (grant.tables.length === 0 || grant.tables.some((table) => !current.tables!.includes(table))))) throw new AppError(ErrorCode.REVOKED, '数据库来源许可已收紧，旧快照不再呈现'); }
  }
  connection(projectId: string, id: string) {
    const settings = this.context.settings();
    const policy = this.store.settings.getJson<{ global?: Record<string, boolean>; projects?: Record<string, Record<string, boolean>> }>('tools.access.policy');
    const enabled = policy?.projects?.[projectId]?.['database.query'] ?? policy?.global?.['database.query'] ?? true;
    const connection = settings.database.connections.find((item) => item.id === id);
    if (!enabled || !settings.opencode.toolsets.includes('database') || connection?.enabled === false || !connection?.projectIds?.includes(projectId) || !connection.schemas?.length || !['mysql', 'postgresql'].includes(connection.type)) throw new AppError(ErrorCode.FORBIDDEN, '数据库来源未获当前项目、schema 或工具许可');
    return connection;
  }
  inventory(projectId: string): readonly KnowledgeSource[] {
    const project = this.store.projects.get(projectId);
    if (project === undefined) throw new AppError(ErrorCode.NOT_FOUND, '项目不存在');
    const files = this.permissions(projectId).originalRead ? listKnowledgeSources(project.rootPath) : [];
    const databases = this.permissions(projectId).originalRead ? this.context.settings().database.connections.flatMap((connection) => {
      try { this.connection(projectId, connection.id); return [{ path: `database:${connection.id}`, kind: 'database' as const, label: connection.name, bytes: 0, modifiedAt: nowIso() }]; } catch { return []; }
    }) : [];
    return [...files, ...databases];
  }
  async read(projectId: string, path: string): Promise<{ path: string; content: string; bytes: number }> {
    this.requireOriginal(projectId);
    if (path.startsWith('/') || path.includes('\\') || path.split('/').includes('..')) throw new AppError(ErrorCode.PATH_ESCAPE, '来源路径越出项目目录');
    if (!this.inventory(projectId).some((source) => source.path === path)) throw new AppError(ErrorCode.FORBIDDEN, '来源不在当前可读清单');
    if (!path.startsWith('database:')) return readKnowledgeSource(this.store.projects.get(projectId)!.rootPath, path);
    if (this.database === undefined) throw new AppError(ErrorCode.CAPABILITY_UNAVAILABLE, '数据库只读驱动未接通');
    const id = path.slice('database:'.length); const connection = this.connection(projectId, id);
    const quote = (value: string) => connection.type === 'postgresql' ? `"${value.replaceAll('"', '""')}"` : `\`${value.replaceAll('`', '``')}\``;
    const literal = (value: string) => { if (/['\\\u0000-\u001f]/.test(value)) throw new AppError(ErrorCode.VALIDATION_FAILED, 'schema 名称不支持'); return `'${value}'`; };
    const tableFilter = !connection.tables?.length ? '' : ` AND (${connection.tables.map((value) => { const parts = value.split('.'); if (parts.length !== 2 || !connection.schemas!.includes(parts[0]!)) throw new AppError(ErrorCode.VALIDATION_FAILED, '数据库表授权格式不合法'); return `(table_schema = ${literal(parts[0]!)} AND table_name = ${literal(parts[1]!)})`; }).join(' OR ')})`;
    const tables = await this.database.query(id, `SELECT table_schema, table_name FROM information_schema.tables WHERE table_schema IN (${connection.schemas!.map(literal).join(',')})${tableFilter} ORDER BY table_schema, table_name`, 100, connection) as DatabaseQueryResult;
    this.connection(projectId, id); this.requireOriginal(projectId);
    const selected = tables.rows.filter((row) => typeof row[0] === 'string' && typeof row[1] === 'string' && connection.schemas!.includes(row[0]) && (!connection.tables?.length || connection.tables.includes(`${row[0]}.${row[1]}`))).slice(0, 8);
    const blocks: string[] = [`数据库来源 ${connection.name}；只读；最多 8 张获准表，每表最多 5 行样本。`];
    for (const row of selected) {
      const current = this.connection(projectId, id); this.requireOriginal(projectId);
      const schema = String(row[0]); const table = String(row[1]);
      if (!current.schemas?.includes(schema) || (current.tables?.length && !current.tables.includes(`${schema}.${table}`))) throw new AppError(ErrorCode.REVOKED, '数据库表许可已收紧');
      const result = await this.database.query(id, `SELECT * FROM ${quote(schema)}.${quote(table)}`, 5, connection) as DatabaseQueryResult;
      blocks.push(`${schema}.${table}\n${JSON.stringify(result.columns)}\n${JSON.stringify(result.rows)}`);
    }
    this.assertCurrent(projectId, { documents: [{ path, content: '', sha256: '', databaseGrant: { schemas: connection.schemas ?? [], tables: connection.tables ?? [] } }], networkSearch: false });
    const content = blocks.join('\n\n').slice(0, 48000);
    return { path, content, bytes: Buffer.byteLength(content) };
  }
  /**
   * Reads the selected inputs. `onDocument` is called after each real read so
   * callers can persist honest incremental progress (no synthetic delays).
   */
  async collect(projectId: string, paths: readonly string[], networkSearch: boolean, question: string, onDocument?: (document: KnowledgeInputSnapshot['documents'][number], readCount: number, total: number) => void) {
    const documents: KnowledgeInputSnapshot['documents'][number][] = []; const truncatedPaths: string[] = [];
    const limit = Math.min(6000, Math.floor(96000 / Math.max(paths.length, 1)));
    for (const path of paths) {
      const connection = path.startsWith('database:') ? this.connection(projectId, path.slice(9)) : undefined;
      const databaseGrant = connection === undefined ? undefined : { schemas: [...connection.schemas ?? []], tables: [...connection.tables ?? []] };
      const source = await this.read(projectId, path);
      if (source.content.length > limit) truncatedPaths.push(path);
      const content = source.content.slice(0, limit);
      if (content !== '') {
        const document = { path, content, sha256: createHash('sha256').update(content).digest('hex'), kind: classifyKnowledgeSourcePath(path), ...(databaseGrant === undefined ? {} : { databaseGrant }) };
        this.assertCurrent(projectId, { documents: [document], networkSearch: false });
        documents.push(document);
        onDocument?.(document, documents.length, paths.length);
      }
    }
    if (networkSearch) {
      const policy = this.permissions(projectId); if (!policy.publicSearch || this.publicSearch === undefined) throw new AppError(ErrorCode.FORBIDDEN, '网络公共检索未获独立许可');
      const results = await this.publicSearch.search(question);
      if (!this.permissions(projectId).publicSearch) throw new AppError(ErrorCode.REVOKED, '网络检索许可已撤销，迟到结果已丢弃');
      for (const result of results.slice(0, 5)) { const content = `${result.title}\n${result.url}\n${result.excerpt}`.slice(0, 6000); const document = { path: `web:${result.url}`, content, sha256: createHash('sha256').update(content).digest('hex'), kind: 'web' as const }; documents.push(document); onDocument?.(document, documents.length, paths.length); }
    }
    return { documents, truncatedPaths };
  }
}
