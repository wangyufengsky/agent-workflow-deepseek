/**
 * Static display metadata for the managed OpenCode toolset.
 *
 * Source of truth for names/annotations is `packages/mcp/src/tools/**`
 * (`MANAGED_TOOL_NAMES`). The web app cannot import server-side packages, so
 * this table mirrors them for the read-only tool directory. Nothing here is
 * runtime state: connectivity always comes from `/api/opencode/status`.
 */

export type ToolsetId = 'workflow' | 'git' | 'database' | 'workspace';

export interface ToolsetMeta {
  readonly id: ToolsetId;
  readonly label: string;
  readonly description: string;
}

export const MCP_TOOLSETS: readonly ToolsetMeta[] = [
  {
    id: 'workflow',
    label: '工作流',
    description: '读取任务上下文、提交规划候选、向用户提问、提交执行结果。',
  },
  {
    id: 'git',
    label: 'Git 只读',
    description: '读取仓库状态、提交历史、变更文件与单个提交详情；全部只读。',
  },
  {
    id: 'database',
    label: '数据库只读',
    description: '对已配置连接执行单条只读 SQL，由服务端做只读守卫、LIMIT 与超时控制。',
  },
  {
    id: 'workspace',
    label: '工作区',
    description: '在任务独立 workspace 内读取/列出/写入文件并执行白名单命令。',
  },
];

export const ToolAccess = {
  READ: 'read',
  WRITE: 'write',
  EXECUTE: 'execute',
} as const;
export type ToolAccessValue = (typeof ToolAccess)[keyof typeof ToolAccess];

export interface ManagedToolMeta {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly toolset: ToolsetId;
  readonly access: ToolAccessValue;
  /** Why the tool is risky or how the server constrains it; shown as a hint. */
  readonly constraint?: string;
}

export const MANAGED_MCP_TOOLS: readonly ManagedToolMeta[] = [
  {
    name: 'workflow.context.get',
    title: '读取任务上下文',
    description: '读取当前任务 / 规划 / 执行节点的上下文快照；执行节点可带 nodeId + attemptId。',
    toolset: 'workflow',
    access: ToolAccess.READ,
  },
  {
    name: 'workflow.plan.submit',
    title: '提交规划候选',
    description: '提交结构化规划候选（groups/nodes/edges），由服务端做权威校验；失败返回可修正的 problems。',
    toolset: 'workflow',
    access: ToolAccess.WRITE,
    constraint: '只接受规划职责的候选内容；校验失败不会写入计划。',
  },
  {
    name: 'workflow.question.ask',
    title: '向用户提问',
    description: '在规划或执行过程中向用户发起问题；required=true 时必须答复后才能继续。',
    toolset: 'workflow',
    access: ToolAccess.WRITE,
    constraint: '问题会进入待处理中心；不会自动代替用户回答。',
  },
  {
    name: 'workflow.result.submit',
    title: '提交执行结果',
    description: '提交节点执行结果（summary 必填，payload 透传，verification 描述验证结论）。',
    toolset: 'workflow',
    access: ToolAccess.WRITE,
    constraint: '结果由服务端记录为证据；验证失败不会被改写为成功。',
  },
  {
    name: 'git.repo.status',
    title: '读取 Git 仓库状态',
    description: '读取项目的当前分支、HEAD、上游差异与工作区脏文件计数。',
    toolset: 'git',
    access: ToolAccess.READ,
  },
  {
    name: 'git.log',
    title: '读取提交历史',
    description: '读取项目提交历史；可指定起始 revision 与返回条数。',
    toolset: 'git',
    access: ToolAccess.READ,
  },
  {
    name: 'git.diff.files',
    title: '读取变更文件列表',
    description: '读取两个 revision 之间的变更文件清单；缺省 base/head 由服务端决定。',
    toolset: 'git',
    access: ToolAccess.READ,
  },
  {
    name: 'git.commit.show',
    title: '读取提交详情',
    description: '读取单个提交的元数据、变更统计与 diff 摘要；不传 sha 时使用 HEAD。',
    toolset: 'git',
    access: ToolAccess.READ,
  },
  {
    name: 'database.query',
    title: '执行只读 SQL',
    description: '对已配置的数据库连接执行单条只读 SQL（SELECT/SHOW/DESC/EXPLAIN/WITH）。',
    toolset: 'database',
    access: ToolAccess.READ,
    constraint: '服务端强制只读守卫、自动 LIMIT 与超时；写语句、多语句与注释会被拒绝。',
  },
  {
    name: 'workspace.file.read',
    title: '读取 workspace 文件',
    description: '读取任务 workspace 内的文本文件；支持按行读取，超大文件需要片段读取。',
    toolset: 'workspace',
    access: ToolAccess.READ,
    constraint: '只能读取该任务 workspace 范围内、且未被策略禁止的路径。',
  },
  {
    name: 'workspace.file.list',
    title: '列出 workspace 目录',
    description: '递归列出任务 workspace 内某个目录的文件与子目录；条目过多会截断。',
    toolset: 'workspace',
    access: ToolAccess.READ,
    constraint: '只能列出该任务 workspace 范围内的目录。',
  },
  {
    name: 'workspace.file.write',
    title: '写入 workspace 文件',
    description: '写入任务 workspace 内的文件；可传 expectedSha 做乐观并发校验。',
    toolset: 'workspace',
    access: ToolAccess.WRITE,
    constraint: '路径越界、符号链接与超限内容会被拒绝；写入前会校验 expectedSha。',
  },
  {
    name: 'workspace.exec',
    title: '在 workspace 执行命令',
    description: '在任务 workspace 内执行白名单命令，命令不经过 shell。',
    toolset: 'workspace',
    access: ToolAccess.EXECUTE,
    constraint: '白名单之外、含 shell 重定向或管道的命令会被拒绝；超时与输出截断由服务端处理。',
  },
];

export function toolsOfToolset(toolset: ToolsetId): readonly ManagedToolMeta[] {
  return MANAGED_MCP_TOOLS.filter((tool) => tool.toolset === toolset);
}

export const TOOL_ACCESS_LABEL: Record<ToolAccessValue, string> = {
  read: '只读',
  write: '写入',
  execute: '执行命令',
};
