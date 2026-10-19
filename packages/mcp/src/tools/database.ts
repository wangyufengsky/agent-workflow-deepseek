import { AppError, ErrorCode } from '@agent-workflow/shared';
import type { InternalMcpApi } from '../api.ts';
import { defineTool, type ToolDefinition } from '../registry.ts';
import { integerSchema, objectSchema, stringSchema } from '../schema.ts';
import { optionalString, requiredString } from './workflow.ts';

export interface DatabaseToolDeps {
  readonly api: InternalMcpApi;
}

export function createDatabaseTools(deps: DatabaseToolDeps): readonly ToolDefinition[] {
  const { api } = deps;
  return [
    defineTool({
      name: 'database.query',
      title: '执行只读 SQL',
      description:
        '对已配置的数据库连接执行一条只读 SQL（SELECT/SHOW/DESC/EXPLAIN/WITH）。服务端会做只读守卫、自动 LIMIT 与超时控制；写语句、多语句、注释会被拒绝并返回结构化错误。',
      inputSchema: objectSchema(
        {
          taskId: stringSchema('当前任务 id（执行步骤必须提供）', { minLength: 1 }),
          connectionId: stringSchema('数据库连接 id', { minLength: 1 }),
          sql: stringSchema('单条只读 SQL', { minLength: 1, maxLength: 50_000 }),
          limit: integerSchema('返回行数上限', { minimum: 1, maximum: 10_000 }),
        },
        ['connectionId', 'sql'],
      ),
      annotations: { readOnlyHint: true, openWorldHint: false },
      handler: async (args) => {
        const connectionId = requiredString(args.connectionId, 'connectionId');
        const sql = requiredString(args.sql, 'sql');
        const limit = optionalInteger(args.limit, 'limit');
        return api.databaseQuery({ ...(optionalString(args.taskId, 'taskId') === undefined ? {} : { taskId: optionalString(args.taskId, 'taskId') }), connectionId, sql, ...(limit === undefined ? {} : { limit }) });
      },
    }),
  ];
}

function optionalInteger(value: unknown, field: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, `${field} 必须是正整数`, { details: { field } });
  }
  return value;
}
