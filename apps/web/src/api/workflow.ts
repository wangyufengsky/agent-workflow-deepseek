import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useBootstrap } from './hooks.ts';
import {
  ROUTES,
  createRequestKey,
  type ActionAvailability,
  type AppEventEnvelope,
  type AttemptListResponse,
  type CommandResponse,
  type ConfirmPlanRequest,
  type CreateTaskRequest,
  type EditBeginRequest,
  type EditFinishRequest,
  type EditSaveRequest,
  type ExecutionCommandRequest,
  type ExecutionResponse,
  type NodeDetail,
  type OperationsByKeyResponse,
  type OperationReceipt,
  type OutputFragment,
  type PlanResponse,
  type PlanRevision,
  type PlanningApplyRequest,
  type PlanningPreviewRequest,
  type PlanningPreviewResponse,
  type PlanningRecordResponse,
  type PlanningRejectRequest,
  type PlanningResponse,
  type PlanningRound,
  type PlanningStartRequest,
  type PlanningStopRequest,
  type PrepareWorkspaceRequest,
  type RequirementInput,
  type RequirementResponse,
  type SaveAnswerRequest,
  type TaskDetailResponse,
  type TaskTemplate,
  type UseSkeletonRequest,
  type WorkflowMethod,
  type WorkspaceResponse,
} from '@agent-workflow/shared';
import { apiGet, apiPost, openEventStream, type EventStreamHandle } from './client.ts';

/* ------------------------------------------------------------------ */
/* Read models                                                         */
/* ------------------------------------------------------------------ */

/** The server returns `method: null` for a task whose method left the catalog. */
export type RequirementView = Omit<RequirementResponse, 'method'> & {
  readonly method: WorkflowMethod | null;
  readonly capabilities?: Record<string, ActionAvailability>;
};

/** `/api/tasks/:id/workspace` returns the workspace or `undefined` before confirmation. */
export interface WorkspaceViewResponse {
  readonly taskId: string;
  readonly workspace?: WorkspaceResponse['workspace'];
  readonly changesRevision?: string;
  readonly actions: Record<string, ActionAvailability>;
}

/** `/api/tasks/:id/execution` returns the execution or `undefined` before confirmation. */
export interface ExecutionViewResponse {
  readonly execution?: ExecutionResponse['execution'];
  readonly workspace?: ExecutionResponse['workspace'];
  readonly actions: Record<string, ActionAvailability>;
}

/** `/api/tasks/:id/planning/reconcile` returns the reconciled round. */
export interface ReconcileResponse {
  readonly round: PlanningRound;
}

/** `/api/tasks/:id/nodes/:nodeId/output` fragment page. */
export interface NodeOutputResponse {
  readonly taskId: string;
  readonly nodeId: string;
  readonly attemptId?: string;
  readonly fragments: readonly OutputFragment[];
  readonly terminal: boolean;
}

export async function fetchTaskDetail(taskId: string): Promise<TaskDetailResponse> {
  const response = await apiGet<TaskDetailResponse>(ROUTES.taskDetail(taskId));
  return response.data;
}

export async function fetchRequirementView(taskId: string): Promise<RequirementView> {
  const response = await apiGet<RequirementView>(ROUTES.requirement(taskId));
  return response.data;
}

export async function fetchPlanningRecord(
  taskId: string,
  query: { readonly roundId?: string; readonly afterSeq?: number; readonly limit?: number } = {},
): Promise<PlanningRecordResponse> {
  const params = new URLSearchParams();
  if (query.roundId !== undefined && query.roundId.length > 0) params.set('roundId', query.roundId);
  if (query.afterSeq !== undefined) params.set('afterSeq', String(query.afterSeq));
  if (query.limit !== undefined) params.set('limit', String(query.limit));
  const suffix = params.toString();
  const response = await apiGet<PlanningRecordResponse>(`${ROUTES.planningRecord(taskId)}${suffix.length === 0 ? '' : `?${suffix}`}`);
  return response.data;
}

export async function fetchPlan(taskId: string): Promise<PlanResponse> {
  const response = await apiGet<PlanResponse>(ROUTES.plan(taskId));
  return response.data;
}

/** Read any plan revision of a task (candidate revisions and checkpoint graphs included). */
export async function fetchPlanRevision(taskId: string, revisionId: string): Promise<PlanRevision> {
  const response = await apiGet<{ readonly plan: PlanRevision }>(ROUTES.planRevision(taskId, revisionId));
  return response.data.plan;
}

export async function fetchWorkspace(taskId: string): Promise<WorkspaceViewResponse> {
  const response = await apiGet<WorkspaceViewResponse>(ROUTES.workspace(taskId));
  return response.data;
}

export async function fetchExecution(taskId: string): Promise<ExecutionViewResponse> {
  const response = await apiGet<ExecutionViewResponse>(ROUTES.execution(taskId));
  return response.data;
}

export async function fetchNodeDetail(taskId: string, nodeId: string): Promise<NodeDetail> {
  const response = await apiGet<NodeDetail>(ROUTES.node(taskId, nodeId));
  return response.data;
}

export async function fetchNodeAttempts(taskId: string, nodeId: string): Promise<AttemptListResponse> {
  const response = await apiGet<AttemptListResponse>(ROUTES.nodeAttempts(taskId, nodeId));
  return response.data;
}

export async function fetchNodeOutput(
  taskId: string,
  nodeId: string,
  query: { readonly attemptId?: string; readonly afterSeq?: number } = {},
): Promise<NodeOutputResponse> {
  const params = new URLSearchParams();
  if (query.attemptId !== undefined) params.set('attemptId', query.attemptId);
  if (query.afterSeq !== undefined) params.set('afterSeq', String(query.afterSeq));
  const suffix = params.toString();
  const response = await apiGet<NodeOutputResponse>(`${ROUTES.nodeOutput(taskId, nodeId)}${suffix.length === 0 ? '' : `?${suffix}`}`);
  return response.data;
}

/** Read-only receipt reconcile. UNKNOWN receipts are never re-sent automatically. */
export async function fetchOperationByKey(requestKey: string): Promise<OperationsByKeyResponse> {
  const response = await apiGet<OperationsByKeyResponse>(ROUTES.operationsByKey(requestKey));
  return response.data;
}

/* ------------------------------------------------------------------ */
/* Commands                                                            */
/* ------------------------------------------------------------------ */

export async function createTask(input: {
  readonly projectId: string;
  readonly title: string;
  readonly requirementText: string;
  readonly methodId: string;
  readonly template?: { readonly templateId: string; readonly parameters: Record<string, string> };
}): Promise<CommandResponse<TaskDetailResponse>> {
  const body: CreateTaskRequest = { requestKey: createRequestKey(), ...input };
  const response = await apiPost<CommandResponse<TaskDetailResponse>>(ROUTES.tasks, body);
  return response.data;
}

export async function previewPlanning(taskId: string, input: PlanningPreviewRequest = {}): Promise<PlanningPreviewResponse> {
  const response = await apiPost<PlanningPreviewResponse>(ROUTES.planningPreview(taskId), input);
  return response.data;
}

export async function startPlanning(taskId: string, input: { previewId: string; sourceInputRevision: number }): Promise<CommandResponse<PlanningResponse>> {
  const body: PlanningStartRequest = {
    requestKey: createRequestKey(),
    previewId: input.previewId,
    confirmModelDispatch: true,
    sourceInputRevision: input.sourceInputRevision,
  };
  const response = await apiPost<CommandResponse<PlanningResponse>>(ROUTES.planningStart(taskId), body);
  return response.data;
}

export async function stopPlanning(taskId: string, roundId: string): Promise<CommandResponse<PlanningResponse>> {
  const body: PlanningStopRequest = { requestKey: createRequestKey(), roundId, confirmStop: true };
  const response = await apiPost<CommandResponse<PlanningResponse>>(ROUTES.planningStop(taskId), body);
  return response.data;
}

export async function reconcilePlanning(taskId: string, roundId: string): Promise<ReconcileResponse> {
  const response = await apiPost<ReconcileResponse>(ROUTES.planningReconcile(taskId), { roundId });
  return response.data;
}

export async function applyPlanning(
  taskId: string,
  input: { roundId: string; candidatePlanRevisionId: string; acceptedDecisionIds: readonly string[]; expectedPlanRevisionNumber?: number },
): Promise<CommandResponse<PlanningResponse>> {
  const body: PlanningApplyRequest = {
    requestKey: createRequestKey(),
    roundId: input.roundId,
    candidatePlanRevisionId: input.candidatePlanRevisionId,
    acceptedDecisionIds: [...input.acceptedDecisionIds],
    confirmApply: true,
    expectedPlanRevisionNumber: input.expectedPlanRevisionNumber,
  };
  const response = await apiPost<CommandResponse<PlanningResponse>>(ROUTES.planningApply(taskId), body);
  return response.data;
}

export async function rejectPlanning(taskId: string, input: { roundId: string; reason: string }): Promise<CommandResponse<PlanningResponse>> {
  const body: PlanningRejectRequest = {
    requestKey: createRequestKey(),
    roundId: input.roundId,
    reason: input.reason,
    confirmReject: true,
  };
  const response = await apiPost<CommandResponse<PlanningResponse>>(ROUTES.planningReject(taskId), body);
  return response.data;
}

export async function savePlanningAnswers(
  taskId: string,
  input: { roundId: string; answers: readonly { questionId: string; answer: string }[] },
): Promise<CommandResponse<PlanningResponse>> {
  const body: SaveAnswerRequest = {
    requestKey: createRequestKey(),
    roundId: input.roundId,
    answers: [...input.answers],
  };
  const response = await apiPost<CommandResponse<PlanningResponse>>(ROUTES.planningAnswers(taskId), body);
  return response.data;
}

export async function applyPlanSkeleton(taskId: string): Promise<CommandResponse<PlanResponse>> {
  const body: UseSkeletonRequest = { requestKey: createRequestKey(), confirmUseSkeleton: true };
  const response = await apiPost<CommandResponse<PlanResponse>>(ROUTES.planSkeleton(taskId), body);
  return response.data;
}

export async function confirmPlan(taskId: string, planRevisionId: string, revisionNumber: number): Promise<CommandResponse<TaskDetailResponse>> {
  const body: ConfirmPlanRequest = {
    requestKey: createRequestKey(),
    planRevisionId,
    expectedRevisionNumber: revisionNumber,
    confirmPlan: true,
  };
  const response = await apiPost<CommandResponse<TaskDetailResponse>>(ROUTES.planConfirm(taskId), body);
  return response.data;
}

export async function beginPlanEdit(taskId: string, planRevisionId: string): Promise<CommandResponse<PlanResponse>> {
  const body: EditBeginRequest = { requestKey: createRequestKey(), planRevisionId, confirmPause: true };
  const response = await apiPost<CommandResponse<PlanResponse>>(ROUTES.planEditBegin(taskId), body);
  return response.data;
}

export async function savePlanEdit(
  taskId: string,
  input: {
    editSessionId: string;
    changes: readonly { nodeId: string; title?: string; prerequisites?: readonly string[]; acceptance?: readonly string[] }[];
    expectedPlanRevisionNumber: number;
  },
): Promise<CommandResponse<PlanResponse>> {
  const body: EditSaveRequest = {
    requestKey: createRequestKey(),
    editSessionId: input.editSessionId,
    changes: input.changes.map((change) => ({ ...change })),
    expectedPlanRevisionNumber: input.expectedPlanRevisionNumber,
  };
  const response = await apiPost<CommandResponse<PlanResponse>>(ROUTES.planEditSave(taskId), body);
  return response.data;
}

export async function finishPlanEdit(
  taskId: string,
  input: { editSessionId: string; continueExecution: boolean },
): Promise<CommandResponse<PlanResponse>> {
  const body: EditFinishRequest = { requestKey: createRequestKey(), editSessionId: input.editSessionId, continueExecution: input.continueExecution };
  const response = await apiPost<CommandResponse<PlanResponse>>(ROUTES.planEditFinish(taskId), body);
  return response.data;
}

export async function prepareWorkspace(
  taskId: string,
  input: { expectedPlanRevisionNumber: number; expectedBaseRef?: string },
): Promise<CommandResponse<{ workspace?: WorkspaceResponse['workspace'] }>> {
  const body: PrepareWorkspaceRequest = {
    requestKey: createRequestKey(),
    expectedPlanRevisionNumber: input.expectedPlanRevisionNumber,
    expectedBaseRef: input.expectedBaseRef,
    confirmPrepare: true,
  };
  const response = await apiPost<CommandResponse<{ workspace?: WorkspaceResponse['workspace'] }>>(ROUTES.workspacePrepare(taskId), body);
  return response.data;
}

export async function startExecution(taskId: string, expectedStatus?: string): Promise<CommandResponse<ExecutionResponse>> {
  const body: ExecutionCommandRequest = { requestKey: createRequestKey(), expectedStatus, confirm: true };
  const response = await apiPost<CommandResponse<ExecutionResponse>>(ROUTES.executionStart(taskId), body);
  return response.data;
}

export async function pauseExecution(taskId: string, expectedStatus?: string): Promise<CommandResponse<ExecutionResponse>> {
  const body: ExecutionCommandRequest = { requestKey: createRequestKey(), expectedStatus };
  const response = await apiPost<CommandResponse<ExecutionResponse>>(ROUTES.executionPause(taskId), body);
  return response.data;
}

export async function resumeExecution(taskId: string, expectedStatus?: string): Promise<CommandResponse<ExecutionResponse>> {
  const body: ExecutionCommandRequest = { requestKey: createRequestKey(), expectedStatus };
  const response = await apiPost<CommandResponse<ExecutionResponse>>(ROUTES.executionResume(taskId), body);
  return response.data;
}

export async function retryExecution(taskId: string, expectedStatus?: string): Promise<CommandResponse<ExecutionResponse>> {
  const body: ExecutionCommandRequest = { requestKey: createRequestKey(), expectedStatus, confirm: true };
  const response = await apiPost<CommandResponse<ExecutionResponse>>(ROUTES.executionRetry(taskId), body);
  return response.data;
}

export async function cancelExecution(taskId: string, expectedStatus?: string): Promise<CommandResponse<ExecutionResponse>> {
  const body: ExecutionCommandRequest = { requestKey: createRequestKey(), expectedStatus, confirm: true };
  const response = await apiPost<CommandResponse<ExecutionResponse>>(ROUTES.executionCancel(taskId), body);
  return response.data;
}

/* ------------------------------------------------------------------ */
/* Receipt helpers                                                     */
/* ------------------------------------------------------------------ */

/** `accepted` receipts have not settled yet; the UI must keep watching instead of assuming success. */
export function receiptIsPending(receipt: CommandResponse<unknown>['receipt']): boolean {
  return receipt.status === 'accepted';
}

export function receiptIsUnknown(receipt: CommandResponse<unknown>['receipt']): boolean {
  return receipt.status === 'unknown';
}

export function receiptFailedMessage(receipt: CommandResponse<unknown>['receipt']): string | null {
  if (receipt.status !== 'failed') return null;
  return receipt.error?.message ?? '服务拒绝了这次操作，未显示具体原因。';
}

/** True when the task uses a fixed template, so every step-changing action is locked. */
export function fixedTemplateOf(detail: TaskDetailResponse | undefined): { readonly binding: NonNullable<TaskDetailResponse['task']['fixedTemplate']>; readonly reason: string } | undefined {
  const binding = detail?.task.fixedTemplate;
  if (binding === undefined) return undefined;
  return { binding, reason: FIXED_TEMPLATE_REASON };
}

/** Resolve the fixed template metadata from the bootstrap catalog. */
export function findTemplate(templates: readonly TaskTemplate[], templateId: string | undefined): TaskTemplate | undefined {
  if (templateId === undefined) return undefined;
  return templates.find((template) => template.id === templateId);
}

export const FIXED_TEMPLATE_REASON = '该任务使用固定模板，创建后不能修改步骤；要改要求，请新建模板任务。';

/* ------------------------------------------------------------------ */
/* Query keys and hooks                                                */
/* ------------------------------------------------------------------ */

export const workflowKeys = {
  all: (taskId: string) => ['workflow', taskId] as const,
  detail: (taskId: string) => ['workflow', taskId, 'detail'] as const,
  requirement: (taskId: string) => ['workflow', taskId, 'requirement'] as const,
  planningRecord: (taskId: string, roundId: string | undefined) => ['workflow', taskId, 'planning-record', roundId ?? 'current'] as const,
  recordAppend: (taskId: string, roundId: string, afterSeq: number) => ['workflow', taskId, 'planning-record-append', roundId, afterSeq] as const,
  plan: (taskId: string) => ['workflow', taskId, 'plan'] as const,
  planRevision: (taskId: string, revisionId: string) => ['workflow', taskId, 'plan-revision', revisionId] as const,
  workspace: (taskId: string) => ['workflow', taskId, 'workspace'] as const,
  execution: (taskId: string) => ['workflow', taskId, 'execution'] as const,
  node: (taskId: string, nodeId: string) => ['workflow', taskId, 'node', nodeId] as const,
  nodeAttempts: (taskId: string, nodeId: string) => ['workflow', taskId, 'node', nodeId, 'attempts'] as const,
  nodeOutput: (taskId: string, nodeId: string, attemptId: string | undefined) => ['workflow', taskId, 'node', nodeId, 'output', attemptId ?? 'current'] as const,
};

export type PollInterval = number | false;

export function useTaskDetail(taskId: string | undefined, refetchInterval: PollInterval = false) {
  return useQuery({
    queryKey: workflowKeys.detail(taskId ?? ''),
    queryFn: () => fetchTaskDetail(taskId!),
    enabled: taskId !== undefined && taskId.length > 0,
    refetchInterval,
    staleTime: 2_000,
  });
}

export function useRequirementView(taskId: string | undefined) {
  return useQuery({
    queryKey: workflowKeys.requirement(taskId ?? ''),
    queryFn: () => fetchRequirementView(taskId!),
    enabled: taskId !== undefined && taskId.length > 0,
    staleTime: 30_000,
  });
}

export function usePlanningRecord(taskId: string | undefined, roundId: string | undefined, refetchInterval: PollInterval = false) {
  return useQuery({
    queryKey: workflowKeys.planningRecord(taskId ?? '', roundId),
    queryFn: () => fetchPlanningRecord(taskId!, { roundId, limit: 500 }),
    enabled: taskId !== undefined && taskId.length > 0,
    refetchInterval,
    staleTime: 1_000,
  });
}

export function usePlanView(taskId: string | undefined) {
  return useQuery({
    queryKey: workflowKeys.plan(taskId ?? ''),
    queryFn: () => fetchPlan(taskId!),
    enabled: taskId !== undefined && taskId.length > 0,
    staleTime: 3_000,
  });
}

export function usePlanRevision(taskId: string | undefined, revisionId: string | undefined) {
  return useQuery({
    queryKey: workflowKeys.planRevision(taskId ?? '', revisionId ?? ''),
    queryFn: () => fetchPlanRevision(taskId!, revisionId!),
    enabled: taskId !== undefined && taskId.length > 0 && revisionId !== undefined && revisionId.length > 0,
    staleTime: 10_000,
  });
}

export function useWorkspaceView(taskId: string | undefined, refetchInterval: PollInterval = false) {
  return useQuery({
    queryKey: workflowKeys.workspace(taskId ?? ''),
    queryFn: () => fetchWorkspace(taskId!),
    enabled: taskId !== undefined && taskId.length > 0,
    refetchInterval,
    staleTime: 2_000,
  });
}

export function useExecutionView(taskId: string | undefined, refetchInterval: PollInterval = false) {
  return useQuery({
    queryKey: workflowKeys.execution(taskId ?? ''),
    queryFn: () => fetchExecution(taskId!),
    enabled: taskId !== undefined && taskId.length > 0,
    refetchInterval,
    staleTime: 2_000,
  });
}

export function useNodeDetail(taskId: string | undefined, nodeId: string | undefined) {
  return useQuery({
    queryKey: workflowKeys.node(taskId ?? '', nodeId ?? ''),
    queryFn: () => fetchNodeDetail(taskId!, nodeId!),
    enabled: taskId !== undefined && nodeId !== undefined && nodeId.length > 0,
    staleTime: 3_000,
  });
}

export function useNodeAttempts(taskId: string | undefined, nodeId: string | undefined) {
  return useQuery({
    queryKey: workflowKeys.nodeAttempts(taskId ?? '', nodeId ?? ''),
    queryFn: () => fetchNodeAttempts(taskId!, nodeId!),
    enabled: taskId !== undefined && nodeId !== undefined && nodeId.length > 0,
    staleTime: 3_000,
  });
}

export function useNodeOutput(
  taskId: string | undefined,
  nodeId: string | undefined,
  attemptId: string | undefined,
  refetchInterval: PollInterval = false,
) {
  return useQuery({
    queryKey: workflowKeys.nodeOutput(taskId ?? '', nodeId ?? '', attemptId),
    queryFn: () => fetchNodeOutput(taskId!, nodeId!, { attemptId }),
    enabled: taskId !== undefined && nodeId !== undefined && nodeId.length > 0,
    refetchInterval,
    staleTime: 800,
  });
}

/** Invalidate every workflow query of one task after a command or a stream event. */
export async function refreshWorkflow(client: QueryClient, taskId: string): Promise<void> {
  await client.invalidateQueries({ queryKey: workflowKeys.all(taskId) });
}

/* ------------------------------------------------------------------ */
/* SSE + polling fallback (only the current task view subscribes)      */
/* ------------------------------------------------------------------ */

export type WorkflowStreamTransport = 'sse' | 'polling';
export type WorkflowStreamConnection = 'connecting' | 'connected' | 'disconnected';

export interface WorkflowStreamStatus {
  readonly connection: WorkflowStreamConnection;
  readonly transport: WorkflowStreamTransport;
}

interface WorkflowEventOptions {
  readonly enabled?: boolean;
  readonly onEvent?: (event: AppEventEnvelope) => void;
}

function payloadTaskId(payload: unknown): string | undefined {
  if (typeof payload !== 'object' || payload === null) return undefined;
  const value = (payload as { taskId?: unknown }).taskId;
  return typeof value === 'string' ? value : undefined;
}

/**
 * Subscribes to `/api/events` for one task. Events are de-duplicated by `seq`;
 * handlers only receive events whose payload belongs to `taskId` (global events
 * without a taskId still pass through). When EventSource is unavailable the
 * caller must poll at 1.5s using the returned transport.
 */
export function useWorkflowEventStream(taskId: string | undefined, options: WorkflowEventOptions = {}): WorkflowStreamStatus {
  const [status, setStatus] = useState<WorkflowStreamStatus>({ connection: 'connecting', transport: 'sse' });
  const handlerRef = useRef(options.onEvent);
  handlerRef.current = options.onEvent;
  const enabled = options.enabled !== false;

  useEffect(() => {
    if (taskId === undefined || taskId.length === 0 || !enabled) return;
    if (typeof EventSource === 'undefined') {
      setStatus({ connection: 'connected', transport: 'polling' });
      return;
    }
    let lastSeq = 0;
    let handle: EventStreamHandle;
    try {
      handle = openEventStream({
        onEvent: (event) => {
          if (typeof event.seq === 'number') {
            if (event.seq <= lastSeq) return;
            lastSeq = event.seq;
          }
          const eventTaskId = payloadTaskId(event.payload);
          if (eventTaskId !== undefined && eventTaskId !== taskId) return;
          setStatus((previous) => (previous.connection === 'connected' && previous.transport === 'sse' ? previous : { connection: 'connected', transport: 'sse' }));
          handlerRef.current?.(event);
        },
        onError: () => {
          // EventSource reconnects by itself; until it does the page polls.
          setStatus((previous) => (previous.connection === 'disconnected' ? previous : { connection: 'disconnected', transport: 'sse' }));
        },
      });
    } catch {
      setStatus({ connection: 'connected', transport: 'polling' });
      return;
    }
    setStatus({ connection: 'connected', transport: 'sse' });
    return () => {
      handle.close();
    };
  }, [enabled, taskId]);

  return status;
}

export interface TaskLiveUpdates extends WorkflowStreamStatus {
  /** Poll interval to hand to task queries (1.5s only while SSE is unavailable). */
  readonly refetchInterval: PollInterval;
  readonly connected: boolean;
}

/** Stream + debounced invalidation for the current task view. */
export function useTaskLiveUpdates(taskId: string | undefined, options: { enabled?: boolean } = {}): TaskLiveUpdates {
  const client = useQueryClient();
  const bootstrap = useBootstrap();
  const pollIntervalMs = bootstrap.data?.settings.monitoring.pollIntervalMs ?? 1_500;
  const timerRef = useRef<number | null>(null);
  const stream = useWorkflowEventStream(taskId, {
    enabled: options.enabled,
    onEvent: () => {
      if (taskId === undefined) return;
      if (timerRef.current !== null) return;
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        void refreshWorkflow(client, taskId);
      }, 400);
    },
  });

  useEffect(
    () => () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    },
    [],
  );

  const polling = stream.transport === 'polling' || stream.connection === 'disconnected';
  return {
    ...stream,
    connected: stream.connection === 'connected',
    refetchInterval: polling ? pollIntervalMs : false,
  };
}

export interface WorkflowCommandState {
  readonly busy: boolean;
  readonly error: unknown;
  readonly receipt: OperationReceipt | undefined;
}

export interface WorkflowCommandRunner {
  readonly state: WorkflowCommandState;
  /** Runs one mutating command, keeps the receipt visible, then re-reads the task. */
  readonly run: <T,>(operation: () => Promise<CommandResponse<T>>) => Promise<CommandResponse<T> | undefined>;
  readonly reset: () => void;
}

const IDLE_COMMAND: WorkflowCommandState = { busy: false, error: undefined, receipt: undefined };

/**
 * One command at a time: busy state prevents double submit, the receipt stays
 * visible (so UNKNOWN can be reconciled by request key) and any success always
 * re-reads the authoritative task read models.
 */
export function useWorkflowCommand(taskId: string): WorkflowCommandRunner {
  const [state, setState] = useState<WorkflowCommandState>(IDLE_COMMAND);
  const refresh = useWorkflowRefresh(taskId);

  const run = useCallback(
    async <T,>(operation: () => Promise<CommandResponse<T>>): Promise<CommandResponse<T> | undefined> => {
      setState({ busy: true, error: undefined, receipt: undefined });
      try {
        const response = await operation();
        setState({ busy: false, error: undefined, receipt: response.receipt });
        await refresh();
        return response;
      } catch (error) {
        setState({ busy: false, error, receipt: undefined });
        // A rejected command can still have changed service state (e.g. an edit
        // save that hit a claim race). Re-read the authoritative models.
        await refresh();
        return undefined;
      }
    },
    [refresh],
  );

  const reset = useCallback(() => {
    setState(IDLE_COMMAND);
  }, []);

  return { state, run, reset };
}

/** Convenience wrapper used by dialogs: run a command then re-read the task. */
export function useWorkflowRefresh(taskId: string): () => Promise<void> {
  const client = useQueryClient();
  return () => refreshWorkflow(client, taskId);
}

export type { RequirementInput };
