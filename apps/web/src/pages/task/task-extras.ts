import {
  ROUTES,
  createRequestKey,
  type CommandResponse,
  type SnapshotReviewModel,
  type TaskAuditPage,
  type TaskPlanFreezeRequest,
  type TaskPlanFreezeResponse,
  type TaskPlanFreezesResponse,
} from '@agent-workflow/shared';
import { apiGet, apiPost } from '../../api/client.ts';

/**
 * Task-canvas extras (W3-5b): frozen plan snapshots, audit timeline and the
 * B-07 snapshot review read model. All reads are side-effect free; only the
 * explicit freeze command writes a local snapshot and never changes the plan
 * or the execution.
 */

export async function fetchTaskFreezes(taskId: string): Promise<TaskPlanFreezesResponse> {
  const response = await apiGet<TaskPlanFreezesResponse>(ROUTES.taskPlanFreezes(taskId));
  return response.data;
}

export async function freezeTaskPlan(taskId: string, input: { readonly planRevisionId?: string; readonly note?: string }): Promise<CommandResponse<TaskPlanFreezeResponse>> {
  const body: TaskPlanFreezeRequest = {
    requestKey: createRequestKey(),
    confirmFreeze: true,
    ...(input.planRevisionId === undefined ? {} : { planRevisionId: input.planRevisionId }),
    ...(input.note === undefined || input.note.trim().length === 0 ? {} : { note: input.note.trim() }),
  };
  const response = await apiPost<CommandResponse<TaskPlanFreezeResponse>>(ROUTES.taskPlanFreeze(taskId), body);
  return response.data;
}

export interface TaskAuditQueryInput {
  readonly limit?: number;
  readonly cursor?: string;
  /** Action prefixes; the HTTP contract expects a comma-separated string. */
  readonly kinds?: readonly string[];
}

export async function fetchTaskAudit(taskId: string, query: TaskAuditQueryInput = {}): Promise<TaskAuditPage> {
  const params = new URLSearchParams();
  if (query.limit !== undefined) params.set('limit', String(query.limit));
  if (query.cursor !== undefined && query.cursor.length > 0) params.set('cursor', query.cursor);
  if (query.kinds !== undefined && query.kinds.length > 0) params.set('kinds', query.kinds.join(','));
  const suffix = params.toString();
  const response = await apiGet<TaskAuditPage>(`${ROUTES.taskAudit(taskId)}${suffix.length === 0 ? '' : `?${suffix}`}`);
  return response.data;
}

export async function fetchSnapshotReview(taskId: string, query: { readonly limit?: number; readonly cursor?: string } = {}): Promise<SnapshotReviewModel> {
  const params = new URLSearchParams();
  if (query.limit !== undefined) params.set('limit', String(query.limit));
  if (query.cursor !== undefined && query.cursor.length > 0) params.set('cursor', query.cursor);
  const suffix = params.toString();
  const response = await apiGet<SnapshotReviewModel>(`${ROUTES.taskSnapshotReview(taskId)}${suffix.length === 0 ? '' : `?${suffix}`}`);
  return response.data;
}
