import { AppError, ErrorCode } from '@agent-workflow/shared';
import type { InternalMcpApi } from '../api.ts';
import type { WorkspaceExec } from '../exec.ts';
import { defineTool, type ToolDefinition } from '../registry.ts';
import { integerSchema, objectSchema, stringSchema } from '../schema.ts';
import type { WorkspaceService } from '../workspace.ts';
import { optionalString, requiredString } from './workflow.ts';

export interface WorkspaceToolDeps {
  readonly api: InternalMcpApi;
  /** Optional local fallback, only used when the internal service is unreachable. */
  readonly workspace?: WorkspaceService | undefined;
  readonly exec?: WorkspaceExec | undefined;
}

/**
 * Workspace tools proxy to `/internal/mcp/workspace/*` by default because one
 * OpenCode process serves tasks that each live in their own worktree; only the
 * server knows which root belongs to a taskId. A local fallback is kept for
 * offline/development runs where `AGENT_WORKFLOW_WORKTREE` is set.
 */
export function createWorkspaceTools(deps: WorkspaceToolDeps): readonly ToolDefinition[] {
  const { api, workspace, exec } = deps;
  return [
    defineTool({
      name: 'workspace.file.read',
      title: '读取 workspace 文件',
      description:
        '读取任务 workspace 内的文本文件（需要 taskId，由服务端按任务解析 workspace）。offset 为行号、limit 为行数（0 或缺省表示全部）；返回 lines/sha/totalLines。超过 512KB 的文件请改用片段读取。',
      inputSchema: objectSchema(
        {
          taskId: stringSchema('任务 id（服务端据此解析 workspace）', { minLength: 1 }),
          path: stringSchema('workspace 内相对路径', { minLength: 1 }),
          artifactId: stringSchema('读取上游不可变产物的身份；同名源码不会替代该产物', { minLength: 1 }),
          offset: integerSchema('起始行号（0 起）', { minimum: 0 }),
          limit: integerSchema('最多读取行数（0 表示全部）', { minimum: 0, maximum: 10_000 }),
        },
        ['taskId', 'path'],
      ),
      annotations: { readOnlyHint: true, openWorldHint: false },
      handler: async (args) => {
        const taskId = requiredString(args.taskId, 'taskId');
        const path = requiredString(args.path, 'path');
        const offset = optionalInteger(args.offset, 'offset');
        const limit = optionalInteger(args.limit, 'limit');
        const artifactId = args.artifactId === undefined ? undefined : requiredString(args.artifactId, 'artifactId');
        const input = { taskId, path, ...(artifactId === undefined ? {} : { artifactId }), ...(offset === undefined ? {} : { offset }), ...(limit === undefined ? {} : { limit }) };
        try {
          return await api.readWorkspaceFile(input);
        } catch (error) {
          if (artifactId !== undefined || !canFallback(error, workspace !== undefined)) throw error;
          return localWorkspace(workspace).read(path, { ...(offset === undefined ? {} : { offset }), ...(limit === undefined ? {} : { limit }) });
        }
      },
    }),

    defineTool({
      name: 'workspace.file.list',
      title: '列出 workspace 目录',
      description: '递归列出任务 workspace 内某个目录的文件/子目录（需要 taskId）。返回扁平化的 path/kind 条目；条目过多时截断并标记 truncated。',
      inputSchema: objectSchema(
        {
          taskId: stringSchema('任务 id（服务端据此解析 workspace）', { minLength: 1 }),
          path: stringSchema('workspace 内相对目录，缺省为根目录'),
        },
        ['taskId'],
      ),
      annotations: { readOnlyHint: true, openWorldHint: false },
      handler: async (args) => {
        const taskId = requiredString(args.taskId, 'taskId');
        const path = optionalString(args.path, 'path');
        try {
          return await api.listWorkspaceFiles({ taskId, ...(path === undefined ? {} : { path }) });
        } catch (error) {
          if (!canFallback(error, workspace !== undefined)) throw error;
          return localWorkspace(workspace).list(path ?? '.');
        }
      },
    }),

    defineTool({
      name: 'workspace.file.write',
      title: '写入 workspace 文件',
      description:
        '写入任务 workspace 内的文件（需要 taskId；服务端决定是否允许写入）。可传 expectedSha 做乐观并发校验（不匹配返回 STALE_TARGET）；路径越界、符号链接与超限内容会被拒绝。',
      inputSchema: objectSchema(
        {
          taskId: stringSchema('任务 id（服务端据此解析 workspace）', { minLength: 1 }),
          path: stringSchema('workspace 内相对路径', { minLength: 1 }),
          content: stringSchema('文件内容', { maxLength: 512 * 1024 }),
          expectedSha: stringSchema('可选：期望的现有文件 sha256', { minLength: 16 }),
        },
        ['taskId', 'path', 'content'],
      ),
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
      handler: async (args) => {
        const taskId = requiredString(args.taskId, 'taskId');
        const path = requiredString(args.path, 'path');
        if (typeof args.content !== 'string') {
          throw new AppError(ErrorCode.VALIDATION_FAILED, 'content 必须是字符串', { details: { field: 'content' } });
        }
        const expectedSha = optionalString(args.expectedSha, 'expectedSha');
        try {
          return await api.writeWorkspaceFile({
            taskId,
            path,
            content: args.content,
            ...(expectedSha === undefined ? {} : { expectedSha }),
          });
        } catch (error) {
          if (!canFallback(error, workspace !== undefined)) throw error;
          return localWorkspace(workspace).write(path, args.content, expectedSha);
        }
      },
    }),

    defineTool({
      name: 'workspace.exec',
      title: '在 workspace 执行命令',
      description:
        '在任务workspace执行白名单命令，不经过shell。testReport可声明JUnit stdout或本次命令新生成的相对报告路径；受控测试命令必须与项目配置完全一致。只用返回的testRun.id引用真实服务报告，不能自报通过数。',
      inputSchema: objectSchema(
        {
          taskId: stringSchema('任务 id（服务端据此解析 workspace）', { minLength: 1 }),
          command: stringSchema('要执行的命令（不含 shell 重定向/管道）', { minLength: 1, maxLength: 16_384 }),
          testReport: objectSchema({ format: stringSchema('报告格式', { enum: ['junit'] }), path: stringSchema('可选：由本次命令新建/更新的JUnit文件相对路径；省略解析stdout', { minLength: 1 }) }, ['format']),
        },
        ['taskId', 'command'],
      ),
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
      handler: async (args) => {
        const taskId = requiredString(args.taskId, 'taskId');
        const command = requiredString(args.command, 'command');
        try {
          if (args.testReport !== undefined && (args.testReport === null || typeof args.testReport !== 'object' || (args.testReport as Record<string, unknown>).format !== 'junit')) throw new AppError(ErrorCode.VALIDATION_FAILED, 'testReport.format必须是junit');
          const report = args.testReport as { format: 'junit'; path?: unknown } | undefined;
          const path = report === undefined ? undefined : optionalString(report.path, 'testReport.path');
          return await api.execWorkspace({ taskId, command, ...(report === undefined ? {} : { testReport: { format: 'junit', ...(path === undefined ? {} : { path }) } }) });
        } catch (error) {
          if (args.testReport !== undefined || !canFallback(error, exec !== undefined)) throw error;
          return localExec(exec).run(command);
        }
      },
    }),
  ];
}

function canFallback(error: unknown, localConfigured: boolean): boolean {
  return localConfigured && error instanceof AppError && error.code === ErrorCode.MCP_NOT_AVAILABLE;
}

function localWorkspace(workspace: WorkspaceService | undefined): WorkspaceService {
  if (workspace === undefined) {
    throw new AppError(ErrorCode.NOT_CONFIGURED, '本地 workspace 回退未配置（AGENT_WORKFLOW_WORKTREE）', {
      details: { field: 'AGENT_WORKFLOW_WORKTREE' },
    });
  }
  return workspace;
}

function localExec(exec: WorkspaceExec | undefined): WorkspaceExec {
  if (exec === undefined) {
    throw new AppError(ErrorCode.NOT_CONFIGURED, '本地命令回退未配置（AGENT_WORKFLOW_WORKTREE）', {
      details: { field: 'AGENT_WORKFLOW_WORKTREE' },
    });
  }
  return exec;
}

function optionalInteger(value: unknown, field: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, `${field} 必须是非负整数`, { details: { field } });
  }
  return value;
}
