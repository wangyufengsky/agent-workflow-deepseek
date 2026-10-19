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
  readonly taskId: string;
  readonly roundId: string;
  readonly taskTitle: string;
  readonly requirementText: string;
  readonly projectName: string;
  readonly projectRoot: string;
  readonly methodName: string;
  readonly methodRevision: string;
  readonly requiredSteps: readonly { readonly key: string; readonly title: string; readonly kind: string; readonly group: string; readonly requires?: readonly string[]; readonly summary?: string; readonly acceptance?: readonly string[] }[];
  readonly refinableGroups: readonly string[];
  readonly supplements: readonly string[];
  readonly previousRoundSummary?: string;
  readonly answers: readonly { readonly question: string; readonly answer: string }[];
  readonly limits: { readonly maxNodes: number; readonly maxEdges: number; readonly maxGroups: number; readonly maxDepth: number };
  readonly strategyVersion: string;
}

export const PLANNING_SYSTEM_PROMPT = `你是「需求分析师（规划职责）」，只负责把需求转成可确认的具体计划，不执行开发、不修改代码。
硬性规则：
1. 你只能通过 MCP 工具 workflow.plan.submit 提交候选计划（参数 taskId、roundId、candidate）。正文不得超过 200 字；禁止在正文输出完整计划或 JSON。
2. 只读需求与方法骨架；可以调用 workspace.file.list / workspace.file.read 查看项目结构（最多 2 次）。**不要读取 Git 历史、不要调用 git.* 工具**。
3. candidate 结构示例：
   {"summary":"一句话","groups":[{"id":"g1","label":"实现","kind":"implementation"}],
    "nodes":[{"key":"骨架步骤 key","title":"标题","kind":"implementation","groupId":"g1","summary":"做什么","inputs":[{"name":"上游","source":"upstream","fromKey":"上游 key"}],"outputs":[{"name":"产物","kind":"artifact"}],"acceptance":["可核对验收"],"resources":{"read":[{"kind":"file","label":"路径"}],"write":[{"kind":"file","label":"路径"}]},"roleId":"role.developer"}],
    "edges":[{"fromKey":"a","toKey":"b","kind":"order"}],
    "questions":[{"question":"必须由用户回答的问题","required":true,"nodeKeys":["a"]}],
    "assumptions":[{"statement":"假设","critical":false,"nodeKeys":["a"]}],
    "humanDecisions":[{"title":"需人工判断项","detail":"说明","nodeKeys":["a"]}]}
4. 必须保留方法骨架里每个必经步骤的 key（key 完全一致）；可在可细化分组内新增子步骤。
5. 提交成功后立即停止，不要再解释或重复输出。工具返回校验错误时，按 problems 修正后重新提交（最多 3 次）。`;

export function buildPlanningPrompt(input: PlanningPromptInput): string {
  const steps = input.requiredSteps.map((step) => `- ${step.key}（${step.title}，${step.kind}，分组：${step.group}）${step.requires === undefined ? '' : `；已配置前驱：${step.requires.length === 0 ? '无（可并行就绪）' : step.requires.join('、')}`}；职责：${step.summary ?? '按步骤目标细化'}；验收：${(step.acceptance ?? []).join('；')}`).join('\n');
  const supplements = input.supplements.length === 0 ? '（无）' : input.supplements.map((text, index) => `补充 ${index + 1}：${text}`).join('\n');
  const answers = input.answers.length === 0 ? '（无）' : input.answers.map((pair) => `Q: ${pair.question}\nA: ${pair.answer}`).join('\n\n');
  return `# 任务
任务 ID：${input.taskId}
规划轮次 ID：${input.roundId}
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
已配置的前驱关系必须保留（可插入中间步骤）。不得无依据把并行根重新串行；新增前驱需在edge.label解释原因，data依赖必须提供inputs.upstream/fromKey映射，resource依赖必须有重叠资源声明。仅为顺序偏好而改变已配置依赖时，必须在既有humanDecisions中说明改变原因与目标节点，供候选审阅；理由属于模型陈述，不是服务事实。

# 规模限制
最多 ${input.limits.maxNodes} 个步骤、${input.limits.maxEdges} 条依赖、${input.limits.maxGroups} 个分组、深度 ≤ ${input.limits.maxDepth}。

# 本轮要求
直接构造候选计划并调用一次 workflow.plan.submit（taskId="${input.taskId}"、roundId="${input.roundId}"、candidate=完整 JSON），不要先在正文写计划。最多用 1 次 workspace.file.list 查看项目结构；不要调用 git.*。提交成功后立即结束；如工具返回校验错误，按 problems 修正后重新提交（最多 3 次）。
${input.previousRoundSummary === undefined ? '' : `\n# 上一轮摘要\n${input.previousRoundSummary}\n`}`;
}

export function isPlanningCandidate(value: unknown): value is PlanningCandidatePayload {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<PlanningCandidatePayload>;
  return typeof candidate.summary === 'string' && Array.isArray(candidate.nodes) && Array.isArray(candidate.edges) && Array.isArray(candidate.groups);
}
