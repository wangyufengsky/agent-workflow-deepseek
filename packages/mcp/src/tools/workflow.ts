import { AppError, ErrorCode, isPlanningCandidatePayload, type PlanningCandidatePayload } from '@agent-workflow/shared';
import type { InternalMcpApi, ResultSubmitInput, VerificationInput } from '../api.ts';
import { defineTool, type ToolDefinition } from '../registry.ts';
import { arraySchema, booleanSchema, integerSchema, looseObjectSchema, objectSchema, stringSchema } from '../schema.ts';

export interface WorkflowToolDeps {
  readonly api: InternalMcpApi;
}

/** Problem shape returned to the model so it can correct and retry. */
export interface PlanSubmitProblem {
  readonly code: string;
  readonly message: string;
  readonly path?: string;
}

export type PlanSubmitValidation =
  | { readonly ok: true; readonly input: { readonly taskId: string; readonly roundId: string; readonly candidate: PlanningCandidatePayload } }
  | { readonly ok: false; readonly problems: readonly PlanSubmitProblem[] };

const VERIFICATION_STATES = new Set(['passed', 'failed', 'not_configured']);

/**
 * Lightweight local shape check. The authoritative V1–V8 validation still runs
 * in the engine behind `/internal/mcp/plan-submit`; this only catches malformed
 * tool arguments early and gives the model a fixable `problems` list.
 */
export function validatePlanSubmitArgs(args: Record<string, unknown>): PlanSubmitValidation {
  const problems: PlanSubmitProblem[] = [];
  const taskId = nonEmptyString(args.taskId);
  if (taskId === undefined) problems.push({ code: 'INVALID_TASK_ID', message: 'taskId 必须是非空字符串', path: 'taskId' });
  const roundId = nonEmptyString(args.roundId);
  if (roundId === undefined) problems.push({ code: 'INVALID_ROUND_ID', message: 'roundId 必须是非空字符串', path: 'roundId' });

  const candidate = args.candidate;
  if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) {
    problems.push({ code: 'INVALID_CANDIDATE', message: 'candidate 必须是对象', path: 'candidate' });
  } else if (!isPlanningCandidatePayload(candidate)) {
    problems.push({
      code: 'INVALID_CANDIDATE_SHAPE',
      message: 'candidate 必须包含 summary 字符串、groups/nodes/edges 数组',
      path: 'candidate',
    });
  } else {
    if (typeof candidate.summary !== 'string' || candidate.summary.trim().length === 0) {
      problems.push({ code: 'EMPTY_SUMMARY', message: 'candidate.summary 不能为空', path: 'candidate.summary' });
    }
    if (candidate.nodes.length === 0) {
      problems.push({ code: 'EMPTY_NODES', message: 'candidate.nodes 不能为空', path: 'candidate.nodes' });
    }
    const groupIds = new Set(candidate.groups.map((group) => group.id));
    candidate.nodes.forEach((node, index) => {
      if (nonEmptyString(node.key) === undefined) {
        problems.push({ code: 'INVALID_NODE_KEY', message: `nodes[${index}].key 必须是非空字符串`, path: `candidate.nodes[${index}].key` });
      }
      if (nonEmptyString(node.title) === undefined) {
        problems.push({ code: 'EMPTY_NODE_TITLE', message: `nodes[${index}].title 不能为空`, path: `candidate.nodes[${index}].title` });
      }
      if (nonEmptyString(node.groupId) === undefined || !groupIds.has(node.groupId)) {
        problems.push({
          code: 'UNKNOWN_GROUP',
          message: `nodes[${index}].groupId 未在 candidate.groups 中声明`,
          path: `candidate.nodes[${index}].groupId`,
        });
      }
    });
  }

  if (problems.length > 0 || taskId === undefined || roundId === undefined) {
    return { ok: false, problems };
  }
  return { ok: true, input: { taskId, roundId, candidate: candidate as PlanningCandidatePayload } };
}

export type ResultSubmitValidation =
  | { readonly ok: true; readonly input: ResultSubmitInput }
  | { readonly ok: false; readonly problems: readonly PlanSubmitProblem[] };

export function validateResultSubmitArgs(args: Record<string, unknown>): ResultSubmitValidation {
  const problems: PlanSubmitProblem[] = [];
  const taskId = nonEmptyString(args.taskId);
  const nodeId = nonEmptyString(args.nodeId);
  const attemptId = nonEmptyString(args.attemptId);
  const summary = nonEmptyString(args.summary);
  if (taskId === undefined) problems.push({ code: 'INVALID_TASK_ID', message: 'taskId 必须是非空字符串', path: 'taskId' });
  if (nodeId === undefined) problems.push({ code: 'INVALID_NODE_ID', message: 'nodeId 必须是非空字符串', path: 'nodeId' });
  if (attemptId === undefined) problems.push({ code: 'INVALID_ATTEMPT_ID', message: 'attemptId 必须是非空字符串', path: 'attemptId' });
  if (summary === undefined) problems.push({ code: 'EMPTY_SUMMARY', message: 'summary 不能为空', path: 'summary' });

  let payload: Record<string, unknown> | undefined;
  if (args.payload !== undefined) {
    if (typeof args.payload !== 'object' || args.payload === null || Array.isArray(args.payload)) {
      problems.push({ code: 'INVALID_PAYLOAD', message: 'payload 必须是对象', path: 'payload' });
    } else {
      payload = args.payload as Record<string, unknown>;
    }
  }

  let verification: VerificationInput | undefined;
  if (args.verification !== undefined) {
    if (typeof args.verification !== 'object' || args.verification === null || Array.isArray(args.verification)) {
      problems.push({ code: 'INVALID_VERIFICATION', message: 'verification 必须是对象', path: 'verification' });
    } else {
      const raw = args.verification as Record<string, unknown>;
      if (typeof raw.state !== 'string' || !VERIFICATION_STATES.has(raw.state)) {
        problems.push({
          code: 'INVALID_VERIFICATION_STATE',
          message: "verification.state 必须是 'passed' | 'failed' | 'not_configured'",
          path: 'verification.state',
        });
      }
      for (const field of ['passed', 'failed'] as const) {
        const value = raw[field];
        if (value !== undefined && (!Number.isInteger(value) || (value as number) < 0)) {
          problems.push({ code: 'INVALID_VERIFICATION_COUNT', message: `verification.${field} 必须是非负整数`, path: `verification.${field}` });
        }
      }
      if (raw.summary !== undefined && typeof raw.summary !== 'string') {
        problems.push({ code: 'INVALID_VERIFICATION_SUMMARY', message: 'verification.summary 必须是字符串', path: 'verification.summary' });
      }
      if (problems.length === 0) {
        verification = {
          state: raw.state as VerificationInput['state'],
          ...(raw.passed === undefined ? {} : { passed: raw.passed as number }),
          ...(raw.failed === undefined ? {} : { failed: raw.failed as number }),
          ...(raw.summary === undefined ? {} : { summary: raw.summary as string }),
        };
      }
    }
  }

  if (problems.length > 0 || taskId === undefined || nodeId === undefined || attemptId === undefined || summary === undefined) {
    return { ok: false, problems };
  }
  return {
    ok: true,
    input: {
      taskId,
      nodeId,
      attemptId,
      summary,
      ...(payload === undefined ? {} : { payload }),
      ...(verification === undefined ? {} : { verification }),
    },
  };
}

export function createWorkflowTools(deps: WorkflowToolDeps): readonly ToolDefinition[] {
  const { api } = deps;
  return [
    defineTool({
      name: 'workflow.context.get',
      title: '读取任务上下文',
      description:
        '读取当前任务/规划/执行节点的上下文快照。执行节点可用 nodeId + attemptId 获取该节点的专属上下文。',
      inputSchema: objectSchema(
        {
          taskId: stringSchema('任务 id', { minLength: 1 }),
          nodeId: stringSchema('可选：执行节点 id（执行节点上下文）', { minLength: 1 }),
          attemptId: stringSchema('可选：节点执行尝试 id', { minLength: 1 }),
        },
        ['taskId'],
      ),
      annotations: { readOnlyHint: true, openWorldHint: false },
      handler: async (args) => {
        const taskId = requiredString(args.taskId, 'taskId');
        const nodeId = optionalString(args.nodeId, 'nodeId');
        const attemptId = optionalString(args.attemptId, 'attemptId');
        return api.getContext({ taskId, ...(nodeId === undefined ? {} : { nodeId }), ...(attemptId === undefined ? {} : { attemptId }) });
      },
    }),

    defineTool({
      name: 'workflow.plan.submit',
      title: '提交规划候选',
      description:
        '提交结构化规划候选（groups/nodes/edges）。candidate 原样透传给服务端做权威校验；校验失败会返回 VALIDATION_FAILED + problems，请按 problems 修正后重试。',
      inputSchema: objectSchema(
        {
          taskId: stringSchema('任务 id', { minLength: 1 }),
          roundId: stringSchema('规划轮次 id', { minLength: 1 }),
          candidate: looseObjectSchema,
        },
        ['taskId', 'roundId', 'candidate'],
      ),
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      handler: async (args) => {
        const validation = validatePlanSubmitArgs(args);
        if (!validation.ok) {
          throw new AppError(ErrorCode.VALIDATION_FAILED, '规划候选参数不合法', { details: { problems: validation.problems } });
        }
        return api.submitPlan(validation.input);
      },
    }),

    defineTool({
      name: 'workflow.question.ask',
      title: '向用户提问',
      description: '在规划或执行过程中向用户发起问题；required=true 表示必须答复后才能继续。',
      inputSchema: objectSchema(
        {
          taskId: stringSchema('任务 id', { minLength: 1 }),
          roundId: stringSchema('规划轮次 id', { minLength: 1 }),
          question: stringSchema('问题内容', { minLength: 1 }),
          required: booleanSchema('是否必须答复'),
          nodeKeys: arraySchema('问题影响的规划节点 key 列表', stringSchema('节点 key', { minLength: 1 }), { maxItems: 100 }),
        },
        ['taskId', 'roundId', 'question', 'required'],
      ),
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      handler: async (args) => {
        const validation = validateQuestionArgs(args);
        if (!validation.ok) {
          throw new AppError(ErrorCode.VALIDATION_FAILED, '提问参数不合法', { details: { problems: validation.problems } });
        }
        return api.askQuestion(validation.input);
      },
    }),

    defineTool({
      name: 'workflow.result.submit',
      title: '提交执行结果',
      description:
        '提交节点执行结果（summary 必填，payload 原样透传，verification 描述验证结论）。成功返回 {ok:true}；失败按结构化错误码返回。',
      inputSchema: objectSchema(
        {
          taskId: stringSchema('任务 id', { minLength: 1 }),
          nodeId: stringSchema('执行节点 id', { minLength: 1 }),
          attemptId: stringSchema('节点执行尝试 id', { minLength: 1 }),
          summary: stringSchema('执行摘要', { minLength: 1 }),
          payload: looseObjectSchema,
          verification: objectSchema(
            {
              state: stringSchema('验证状态', { enum: ['passed', 'failed', 'not_configured'] }),
              passed: integerSchema('通过数', { minimum: 0 }),
              failed: integerSchema('失败数', { minimum: 0 }),
              summary: stringSchema('验证摘要'),
            },
            ['state'],
          ),
        },
        ['taskId', 'nodeId', 'attemptId', 'summary'],
      ),
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      handler: async (args) => {
        const validation = validateResultSubmitArgs(args);
        if (!validation.ok) {
          throw new AppError(ErrorCode.VALIDATION_FAILED, '执行结果参数不合法', { details: { problems: validation.problems } });
        }
        return api.submitResult(validation.input);
      },
    }),
  ];
}

interface QuestionInputLocal {
  readonly taskId: string;
  readonly roundId: string;
  readonly question: string;
  readonly required: boolean;
  readonly nodeKeys?: readonly string[];
}

type QuestionValidation =
  | { readonly ok: true; readonly input: QuestionInputLocal }
  | { readonly ok: false; readonly problems: readonly PlanSubmitProblem[] };

export function validateQuestionArgs(args: Record<string, unknown>): QuestionValidation {
  const problems: PlanSubmitProblem[] = [];
  const taskId = nonEmptyString(args.taskId);
  const roundId = nonEmptyString(args.roundId);
  const question = nonEmptyString(args.question);
  if (taskId === undefined) problems.push({ code: 'INVALID_TASK_ID', message: 'taskId 必须是非空字符串', path: 'taskId' });
  if (roundId === undefined) problems.push({ code: 'INVALID_ROUND_ID', message: 'roundId 必须是非空字符串', path: 'roundId' });
  if (question === undefined) problems.push({ code: 'EMPTY_QUESTION', message: 'question 不能为空', path: 'question' });
  if (typeof args.required !== 'boolean') problems.push({ code: 'INVALID_REQUIRED', message: 'required 必须是布尔值', path: 'required' });
  let nodeKeys: string[] | undefined;
  if (args.nodeKeys !== undefined) {
    if (!Array.isArray(args.nodeKeys)) {
      problems.push({ code: 'INVALID_NODE_KEYS', message: 'nodeKeys 必须是字符串数组', path: 'nodeKeys' });
    } else {
      nodeKeys = [];
      for (const [index, item] of args.nodeKeys.entries()) {
        if (typeof item !== 'string' || item.trim().length === 0) {
          problems.push({ code: 'INVALID_NODE_KEY', message: `nodeKeys[${index}] 必须是非空字符串`, path: `nodeKeys[${index}]` });
        } else {
          nodeKeys.push(item);
        }
      }
    }
  }
  if (problems.length > 0 || taskId === undefined || roundId === undefined || question === undefined || typeof args.required !== 'boolean') {
    return { ok: false, problems };
  }
  return {
    ok: true,
    input: { taskId, roundId, question, required: args.required, ...(nodeKeys === undefined ? {} : { nodeKeys }) },
  };
}

export function requiredString(value: unknown, field: string): string {
  const parsed = nonEmptyString(value);
  if (parsed === undefined) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, `${field} 必须是非空字符串`, { details: { field } });
  }
  return parsed;
}

export function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  return requiredString(value, field);
}

export function nonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : value;
}
