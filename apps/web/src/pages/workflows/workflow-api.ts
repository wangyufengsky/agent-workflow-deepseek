import {
  ROUTES,
  type MethodCatalogDetail,
  type MethodCatalogEntry,
  type MethodStepDefinition,
  type MethodValidationCheck,
  type MethodValidationProblem,
  type MethodValidationResult,
  type TaskMethodSupportValue,
  type WorkflowMethod,
} from '@agent-workflow/shared';
import { ApiClientError, apiGet, apiPost, request } from '../../api/client.ts';

/**
 * W3-8b · 工作流（method catalog）HTTP 适配层。
 *
 * 后端 W3-8c（task-46）正在把 `MethodCatalogService` 接到 `/api/workflows*`；
 * 本文件按 task-46 的契约与 `packages/engine/src/method-catalog.ts` 的 DTO 形状实现，
 * 对返回包做容错解析：`data.method` / `data.resource.method` / 平铺 detail 都接受。
 * 接口未接通（404）时页面降级到 bootstrap 内置目录，不伪造写入能力。
 */

export type WorkflowStepView = MethodStepDefinition;

export interface WorkflowDraft {
  readonly name: string;
  readonly description: string;
  readonly support: TaskMethodSupportValue;
  readonly requiredSteps: readonly MethodStepDefinition[];
  readonly refinableGroups: readonly string[];
  readonly planningStrategy?: { readonly id: string; readonly version: string; readonly roleId: string };
}

export type WorkflowCatalogEntry = MethodCatalogEntry;
export type WorkflowCatalogDetail = MethodCatalogDetail;
export type WorkflowValidationProblem = MethodValidationProblem;
export type WorkflowValidationCheck = MethodValidationCheck;
export type WorkflowValidationResult = MethodValidationResult;

export type WorkflowMutation = {
  readonly method: WorkflowCatalogDetail;
  readonly requestKey?: string;
  readonly replayed?: boolean;
};

export type WorkflowSaveResult =
  | { readonly kind: 'ok'; readonly detail: WorkflowCatalogDetail }
  | { readonly kind: 'conflict'; readonly currentVersion: number; readonly message: string }
  | { readonly kind: 'failed'; readonly message: string };

export type WorkflowAvailability = 'ok' | 'unavailable' | 'error';

function recordOf(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : undefined;
}

function methodFromData(data: unknown): Record<string, unknown> | undefined {
  const root = recordOf(data);
  if (root === undefined) return undefined;
  const direct = recordOf(root.method);
  if (direct !== undefined) return direct;
  const resource = recordOf(root.resource);
  if (resource !== undefined) {
    const nested = recordOf(resource.method);
    if (nested !== undefined) return nested;
    if (typeof resource.id === 'string' && Array.isArray(resource.requiredSteps)) return resource;
  }
  if (typeof root.id === 'string' && Array.isArray(root.requiredSteps)) return root;
  return undefined;
}

function normalizeStep(raw: unknown): MethodStepDefinition | undefined {
  const step = recordOf(raw);
  if (step === undefined) return undefined;
  if (typeof step.key !== 'string' || typeof step.title !== 'string') return undefined;
  const kind = step.kind;
  const validKind = kind === 'requirement' || kind === 'design' || kind === 'implementation' || kind === 'test' || kind === 'verify' || kind === 'delivery' || kind === 'system';
  if (!validKind) return undefined;
  return {
    ...(typeof step.summary === 'string' ? { summary: step.summary } : {}),
    ...(Array.isArray(step.inputs) ? { inputs: step.inputs as MethodStepDefinition['inputs'] } : {}),
    ...(Array.isArray(step.outputs) ? { outputs: step.outputs as MethodStepDefinition['outputs'] } : {}),
    ...(Array.isArray(step.acceptance) ? { acceptance: step.acceptance.filter((x): x is string => typeof x === 'string') } : {}),
    ...(typeof step.position === 'object' && step.position !== null ? { position: step.position as { x: number; y: number } } : {}),
    key: step.key,
    title: step.title,
    kind,
    group: typeof step.group === 'string' && step.group !== '' ? step.group : '固定步骤',
    ...(step.optional === true ? { optional: true } : {}),
    ...(typeof step.roleId === 'string' && step.roleId !== '' ? { roleId: step.roleId } : {}),
    ...(Array.isArray(step.requires) ? { requires: step.requires.filter((item): item is string => typeof item === 'string') } : {}),
  };
}

export function normalizeDetail(raw: unknown): WorkflowCatalogDetail | undefined {
  const method = recordOf(raw);
  if (method === undefined || typeof method.id !== 'string' || typeof method.name !== 'string') return undefined;
  const steps = Array.isArray(method.requiredSteps) ? method.requiredSteps.map(normalizeStep).filter((step): step is WorkflowStepView => step !== undefined) : [];
  const strategy = recordOf(method.planningStrategy);
  return {
    id: method.id,
    name: method.name,
    description: typeof method.description === 'string' ? method.description : '',
    source: method.source === 'builtin' ? 'builtin' : 'custom',
    support: method.support === 'skeleton_only' ? 'skeleton_only' : 'ai_planning',
    version: typeof method.version === 'number' && Number.isInteger(method.version) ? method.version : 1,
    revision: typeof method.revision === 'string' ? method.revision : `r${String(typeof method.version === 'number' ? method.version : 1)}`,
    stepCount: typeof method.stepCount === 'number' ? method.stepCount : steps.length,
    archived: method.archived === true,
    ...(typeof method.updatedAt === 'string' ? { updatedAt: method.updatedAt } : {}),
    ...(recordOf(method.copiedFrom) === undefined ? {} : { copiedFrom: { id: String((recordOf(method.copiedFrom) ?? {}).id ?? ''), version: Number((recordOf(method.copiedFrom) ?? {}).version ?? 0) } }),
    requiredSteps: steps,
    refinableGroups: Array.isArray(method.refinableGroups) ? method.refinableGroups.filter((item): item is string => typeof item === 'string') : [],
    ...(strategy === undefined
      ? {}
      : {
          planningStrategy: {
            id: String(strategy.id ?? ''),
            version: String(strategy.version ?? ''),
            roleId: String(strategy.roleId ?? ''),
          },
        }),
  };
}

function normalizeEntry(raw: unknown): WorkflowCatalogEntry | undefined {
  const item = recordOf(raw);
  if (item === undefined || typeof item.id !== 'string' || typeof item.name !== 'string') return undefined;
  return {
    id: item.id,
    name: item.name,
    description: typeof item.description === 'string' ? item.description : '',
    source: item.source === 'builtin' ? 'builtin' : 'custom',
    support: item.support === 'skeleton_only' ? 'skeleton_only' : 'ai_planning',
    version: typeof item.version === 'number' ? item.version : 1,
    revision: typeof item.revision === 'string' ? item.revision : `r${String(typeof item.version === 'number' ? item.version : 1)}`,
    stepCount: typeof item.stepCount === 'number' ? item.stepCount : 0,
    archived: item.archived === true,
    ...(typeof item.updatedAt === 'string' ? { updatedAt: item.updatedAt } : {}),
    ...(recordOf(item.copiedFrom) === undefined ? {} : { copiedFrom: { id: String((recordOf(item.copiedFrom) ?? {}).id ?? ''), version: Number((recordOf(item.copiedFrom) ?? {}).version ?? 0) } }),
  };
}

export async function fetchWorkflowList(query: { readonly includeArchived?: boolean; readonly source?: string; readonly q?: string } = {}): Promise<readonly WorkflowCatalogEntry[]> {
  const params = new URLSearchParams();
  if (query.includeArchived === true) params.set('includeArchived', '1');
  if (query.source !== undefined && query.source !== 'all') params.set('source', query.source);
  if (query.q !== undefined && query.q.trim() !== '') params.set('q', query.q.trim());
  const suffix = params.toString();
  const response = await apiGet<unknown>(`${ROUTES.workflows}${suffix === '' ? '' : `?${suffix}`}`);
  const data = recordOf(response.data);
  const raw = Array.isArray(response.data)
    ? response.data
    : Array.isArray(data?.items)
      ? data.items
      : Array.isArray(data?.methods)
        ? data.methods
        : Array.isArray(data?.workflows)
          ? data.workflows
          : [];
  return raw.map(normalizeEntry).filter((item): item is WorkflowCatalogEntry => item !== undefined);
}

export async function fetchWorkflowDetail(id: string): Promise<WorkflowCatalogDetail> {
  const response = await apiGet<unknown>(ROUTES.workflow(id));
  const detail = normalizeDetail(methodFromData(response.data));
  if (detail === undefined) throw new ApiClientError({ kind: 'protocol', message: '流程详情响应无法识别，请确认前后端版本一致。' });
  return detail;
}

function mutationFromResponse(data: unknown): WorkflowMutation | undefined {
  const root = recordOf(data);
  if (root === undefined) return undefined;
  const direct = normalizeDetail(methodFromData(root));
  const resource = recordOf(root.resource);
  const detail = direct ?? normalizeDetail(methodFromData(resource));
  if (detail === undefined) return undefined;
  return {
    method: detail,
    ...(typeof root.requestKey === 'string' ? { requestKey: root.requestKey } : {}),
    ...(root.replayed === true ? { replayed: true } : {}),
  };
}

export async function createWorkflow(input: { readonly draft: WorkflowDraft; readonly requestKey: string }): Promise<WorkflowMutation> {
  const response = await apiPost<unknown>(ROUTES.workflows, { requestKey: input.requestKey, draft: input.draft, confirmCreate: true });
  const mutation = mutationFromResponse(response.data);
  if (mutation === undefined) throw new ApiClientError({ kind: 'protocol', message: '创建流程响应无法识别。' });
  return mutation;
}

export async function copyWorkflow(input: { readonly id: string; readonly name: string; readonly requestKey: string }): Promise<WorkflowMutation> {
  const response = await apiPost<unknown>(ROUTES.workflowCopy(input.id), {
    requestKey: input.requestKey,
    name: input.name,
    confirmCopy: true,
  });
  const mutation = mutationFromResponse(response.data);
  if (mutation === undefined) throw new ApiClientError({ kind: 'protocol', message: '复制流程响应无法识别。' });
  return mutation;
}

export async function archiveWorkflow(input: { readonly id: string; readonly requestKey: string }): Promise<WorkflowMutation | undefined> {
  const response = await request<unknown>(ROUTES.workflow(input.id), {
    method: 'DELETE',
    body: { requestKey: input.requestKey, confirmArchive: true },
  });
  return mutationFromResponse(response.data);
}

export async function saveWorkflow(input: {
  readonly id: string;
  readonly draft: WorkflowDraft;
  readonly expectedVersion: number;
  readonly requestKey: string;
}): Promise<WorkflowSaveResult> {
  try {
    const response = await request<unknown>(ROUTES.workflow(input.id), {
      method: 'PATCH',
      body: { requestKey: input.requestKey, method: input.draft, expectedVersion: input.expectedVersion, confirmSave: true },
    });
    const mutation = mutationFromResponse(response.data);
    if (mutation === undefined) return { kind: 'failed', message: '保存响应无法识别（未返回流程详情）。' };
    return { kind: 'ok', detail: mutation.method };
  } catch (error) {
    if (error instanceof ApiClientError && error.code === 'CONFLICT') {
      const details = error.details ?? {};
      const current = typeof details.currentVersion === 'number' ? details.currentVersion : undefined;
      return {
        kind: 'conflict',
        currentVersion: current ?? 0,
        message: error.message,
      };
    }
    if (error instanceof ApiClientError && error.code === 'VALIDATION_FAILED') {
      return { kind: 'failed', message: workflowErrorDetail(error) };
    }
    throw error;
  }
}

/** 服务校验失败时优先展示 details.problems 的具体原因。 */
export function workflowErrorDetail(error: unknown): string {
  if (error instanceof ApiClientError) {
    const problems = error.details?.problems;
    if (Array.isArray(problems)) {
      const messages = problems
        .map((item) => (typeof item === 'object' && item !== null && typeof (item as { message?: unknown }).message === 'string' ? (item as { message: string }).message : undefined))
        .filter((item): item is string => item !== undefined);
      if (messages.length > 0) return messages.join('；');
    }
    if (typeof error.details?.builtIn === 'boolean' && error.details.builtIn) {
      return '内置流程只读：请先复制一份到「我的流程」再修改。';
    }
    return error.message;
  }
  return error instanceof Error ? error.message : '未知错误';
}

export async function validateWorkflow(input: { readonly draft: WorkflowDraft; readonly id?: string }): Promise<WorkflowValidationResult> {
  const response = await apiPost<unknown>(ROUTES.workflowValidate, {
    ...(input.id === undefined ? {} : { id: input.id }),
    draft: input.draft,
  });
  const data = recordOf(response.data);
  const problems = Array.isArray(data?.problems) ? data.problems : [];
  const checks = Array.isArray(data?.checks) ? data.checks : [];
  return {
    ok: data?.ok === true,
    problems: problems.filter((item): item is WorkflowValidationProblem => recordOf(item) !== undefined && typeof (recordOf(item) ?? {}).message === 'string'),
    checks: checks.filter((item): item is WorkflowValidationCheck => recordOf(item) !== undefined && typeof (recordOf(item) ?? {}).id === 'string'),
  };
}

/** bootstrap fallback：接口未接通时用目录快照的内置流程（只读）。 */
export function builtinCatalogFromBootstrap(methods: readonly WorkflowMethod[]): readonly WorkflowCatalogDetail[] {
  return methods.map((method) => ({
    id: method.id,
    name: method.name,
    description: method.description,
    source: 'builtin',
    support: method.support,
    version: 1,
    revision: method.revision,
    stepCount: method.requiredSteps.length,
    archived: false,
    requiredSteps: method.requiredSteps,
    refinableGroups: method.refinableGroups,
    ...(method.planningStrategy === undefined ? {} : { planningStrategy: method.planningStrategy }),
  }));
}

export function isWorkflowUnavailable(error: unknown): boolean {
  return error instanceof ApiClientError && error.kind === 'http' && error.status === 404;
}
