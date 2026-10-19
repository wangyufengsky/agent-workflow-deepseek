import type { ProjectSettings } from '@agent-workflow/shared';
/** Output directories, not read permissions. Paths are already validated at project save. */
export function projectDocumentInstructions(settings: ProjectSettings | undefined): string {
  const paths = settings?.docPaths ?? [];
  return paths.length === 0
    ? '# 项目文档产出\n项目未配置文档目录：不生成项目设计文档或变更说明文件。代码与必要测试仍按当前步骤授权执行。AGENTS.md 公约由独立确认操作管理。'
    : `# 项目文档产出\n设计文档、变更说明只写入当前独立工作区的以下相对目录：${paths.join('、')}。如需生成文档，按步骤产出选择这些目录，保留已有文件并遵守节点写入授权；不得写回原项目目录。这些目录不授予额外读取或写入权限。`;
}
