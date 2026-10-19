import { AppError, ErrorCode } from '@agent-workflow/shared';
import type { InternalMcpApi } from '../api.ts';
import { defineTool, type ToolDefinition } from '../registry.ts';
import { integerSchema, objectSchema, stringSchema } from '../schema.ts';
import { optionalString, requiredString } from './workflow.ts';

export interface GitToolDeps {
  readonly api: InternalMcpApi;
}

export function createGitTools(deps: GitToolDeps): readonly ToolDefinition[] {
  const { api } = deps;
  return [
    defineTool({
      name: 'git.repo.status',
      title: '读取 Git 仓库状态',
      description: '读取项目的当前分支、HEAD、上游差异与工作区脏文件计数（只读）。',
      inputSchema: objectSchema({ projectId: stringSchema('项目 id', { minLength: 1 }) }, ['projectId']),
      annotations: { readOnlyHint: true, openWorldHint: false },
      handler: async (args) => api.gitStatus({ projectId: requiredString(args.projectId, 'projectId') }),
    }),

    defineTool({
      name: 'git.log',
      title: '读取提交历史',
      description: '读取项目提交历史（只读）。ref 指定起始 revision，缺省由服务端决定。',
      inputSchema: objectSchema(
        {
          projectId: stringSchema('项目 id', { minLength: 1 }),
          limit: integerSchema('返回条数，默认 20', { minimum: 1, maximum: 200 }),
          ref: stringSchema('起始 revision/ref，缺省由服务端决定', { minLength: 1 }),
        },
        ['projectId'],
      ),
      annotations: { readOnlyHint: true, openWorldHint: false },
      handler: async (args) => {
        const projectId = requiredString(args.projectId, 'projectId');
        const limit = optionalInteger(args.limit, 'limit');
        const ref = optionalString(args.ref, 'ref');
        return api.gitLog({ projectId, ...(limit === undefined ? {} : { limit }), ...(ref === undefined ? {} : { ref }) });
      },
    }),

    defineTool({
      name: 'git.diff.files',
      title: '读取变更文件列表',
      description: '读取两个 revision 之间的变更文件清单（只读）。缺省 base/head 由服务端决定。',
      inputSchema: objectSchema(
        {
          projectId: stringSchema('项目 id', { minLength: 1 }),
          baseSha: stringSchema('可选：基线 revision', { minLength: 1 }),
          headSha: stringSchema('可选：目标 revision', { minLength: 1 }),
        },
        ['projectId'],
      ),
      annotations: { readOnlyHint: true, openWorldHint: false },
      handler: async (args) => {
        const projectId = requiredString(args.projectId, 'projectId');
        const baseSha = optionalString(args.baseSha, 'baseSha');
        const headSha = optionalString(args.headSha, 'headSha');
        return api.gitDiffFiles({ projectId, ...(baseSha === undefined ? {} : { baseSha }), ...(headSha === undefined ? {} : { headSha }) });
      },
    }),

    defineTool({
      name: 'git.commit.show',
      title: '读取提交详情',
      description: '读取单个提交的元数据、变更统计与 diff 摘要（只读）。不传 sha 时使用 HEAD。',
      inputSchema: objectSchema(
        {
          projectId: stringSchema('项目 id', { minLength: 1 }),
          sha: stringSchema('提交 sha，缺省 HEAD', { minLength: 1 }),
        },
        ['projectId'],
      ),
      annotations: { readOnlyHint: true, openWorldHint: false },
      handler: async (args) => {
        const projectId = requiredString(args.projectId, 'projectId');
        const sha = optionalString(args.sha, 'sha') ?? 'HEAD';
        return api.gitCommitShow({ projectId, sha });
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
