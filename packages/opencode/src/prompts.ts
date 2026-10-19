import type { PlanningCandidatePayload } from '@agent-workflow/shared';

/** JSON schema handed to OpenCode so the model must return a structured candidate. */
export const PLANNING_OUTPUT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'groups', 'nodes', 'edges'],
  properties: {
    summary: { type: 'string' },
    groups: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'label', 'kind'],
        properties: {
          id: { type: 'string' },
          label: { type: 'string' },
          kind: { type: 'string', enum: ['requirement', 'design', 'implementation', 'test', 'delivery'] },
          refined: { type: 'boolean' },
        },
      },
    },
    nodes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['key', 'title', 'kind', 'groupId', 'summary'],
        properties: {
          key: { type: 'string' },
          title: { type: 'string' },
          kind: { type: 'string', enum: ['requirement', 'design', 'implementation', 'test', 'verify', 'delivery', 'system'] },
          groupId: { type: 'string' },
          summary: { type: 'string' },
          inputs: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['name', 'source'],
              properties: {
                name: { type: 'string' },
                source: { type: 'string', enum: ['requirement', 'upstream', 'artifact', 'manual'] },
                fromKey: { type: 'string' },
              },
            },
          },
          outputs: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['name', 'kind'],
              properties: { name: { type: 'string' }, kind: { type: 'string', enum: ['artifact', 'evidence', 'summary'] } },
            },
          },
          acceptance: { type: 'array', items: { type: 'string' } },
          resources: {
            type: 'object',
            additionalProperties: false,
            properties: {
              read: { type: 'array', items: { $ref: '#/$defs/resource' } },
              write: { type: 'array', items: { $ref: '#/$defs/resource' } },
            },
          },
          roleId: { type: 'string' },
          optional: { type: 'boolean' },
        },
      },
    },
    edges: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['fromKey', 'toKey', 'kind'],
        properties: {
          fromKey: { type: 'string' },
          toKey: { type: 'string' },
          kind: { type: 'string', enum: ['data', 'order', 'resource'] },
          label: { type: 'string' },
        },
      },
    },
    questions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['question', 'required'],
        properties: {
          question: { type: 'string' },
          required: { type: 'boolean' },
          nodeKeys: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    assumptions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['statement', 'critical'],
        properties: {
          statement: { type: 'string' },
          critical: { type: 'boolean' },
          nodeKeys: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    humanDecisions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'detail'],
        properties: {
          title: { type: 'string' },
          detail: { type: 'string' },
          nodeKeys: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  },
  $defs: {
    resource: {
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'label'],
      properties: {
        kind: { type: 'string', enum: ['file', 'directory', 'database', 'http', 'mcp'] },
        label: { type: 'string' },
      },
    },
  },
};

export interface PlanningPromptInput {
  readonly taskTitle: string;
  readonly requirementText: string;
  readonly projectName: string;
  readonly projectRoot: string;
  readonly methodName: string;
  readonly methodRevision: string;
  readonly requiredSteps: readonly { readonly key: string; readonly title: string; readonly kind: string; readonly group: string }[];
  readonly refinableGroups: readonly string[];
  readonly supplements: readonly string[];
  readonly previousRoundSummary?: string;
  readonly answers: readonly { readonly question: string; readonly answer: string }[];
  readonly limits: { readonly maxNodes: number; readonly maxEdges: number; readonly maxGroups: number; readonly maxDepth: number };
  readonly strategyVersion: string;
}

export const PLANNING_SYSTEM_PROMPT = `你是「需求分析师（规划职责）」，只负责把需求转成可确认的具体计划，不执行开发、不修改代码。
必须遵守：
1. 只读资料与需求；不得调用任何写入、命令或网络工具。
2. 输出必须是一个具体可执行的 DAG：每个步骤有明确标题、分组、输入、输出、验收条款与读写资源。
3. 不能编造需求；信息不足时在 questions 中提出必须由用户回答的问题（required=true），或写入 assumptions 并标记 critical。
4. 不要输出百分比、时间估计或“已完成”之类状态；你只提交候选计划。
5. 方法骨架的必经步骤必须保留；可按需求细化可细化分组。
6. 写资源冲突必须避免；无法避免时在 humanDecisions 中说明并建议改为先后执行。
7. 提交前使用 workflow.plan.submit 工具；工具返回校验错误时，根据错误码修正后重新提交。`;

export function buildPlanningPrompt(input: PlanningPromptInput): string {
  const steps = input.requiredSteps.map((step) => `- ${step.key}（${step.title}，${step.kind}，分组：${step.group}）`).join('\n');
  const supplements = input.supplements.length === 0 ? '（无）' : input.supplements.map((text, index) => `补充 ${index + 1}：${text}`).join('\n');
  const answers = input.answers.length === 0 ? '（无）' : input.answers.map((pair) => `Q: ${pair.question}\nA: ${pair.answer}`).join('\n\n');
  return `# 任务
${input.taskTitle}

# 项目
${input.projectName}（根目录：${input.projectRoot}）

# 需求原文
${input.requirementText}

# 补充需求
${supplements}

# 已确认答复
${answers}

# 流程方法
${input.methodName} · ${input.methodRevision}
必经步骤：
${steps}
可细化分组：${input.refinableGroups.join('、')}
规划策略：${input.strategyVersion}

# 规模限制
最多 ${input.limits.maxNodes} 个步骤、${input.limits.maxEdges} 条依赖、${input.limits.maxGroups} 个分组、深度 ≤ ${input.limits.maxDepth}。

# 本轮要求
生成完整候选计划（覆盖全部必经步骤），提交到 workflow.plan.submit。
${input.previousRoundSummary === undefined ? '' : `\n# 上一轮摘要\n${input.previousRoundSummary}\n`}`;
}

export function isPlanningCandidate(value: unknown): value is PlanningCandidatePayload {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<PlanningCandidatePayload>;
  return typeof candidate.summary === 'string' && Array.isArray(candidate.nodes) && Array.isArray(candidate.edges) && Array.isArray(candidate.groups);
}
