import { useEffect, useRef, useState } from 'react';
import {
  ROUTES, createRequestKey,
  type CommandResponse, type KnowledgeAskRequest, type KnowledgeAskResponse, type KnowledgeRunProgress,
  type OperationRecord, type OperationsByKeyResponse,
} from '@agent-workflow/shared';
import { apiGet, apiPost, errorMessage, isApiClientError } from '../../api/client.ts';

const STORAGE_KEY = 'agent-workflow.knowledge.pending';
interface PendingQuestion {
  readonly input: KnowledgeAskRequest;
  readonly status: 'accepted' | 'unknown';
}

/** Stop is a write command too: its receipt may be accepted/unknown/failed. */
export interface StopCommandState {
  readonly requestKey: string;
  readonly status: 'accepted' | 'unknown' | 'failed';
  readonly message?: string;
}

function restore(): PendingQuestion | undefined {
  try {
    const value = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? 'null') as PendingQuestion | null;
    return value?.input?.requestKey?.startsWith('req_') === true && typeof value.input.projectId === 'string'
      ? { input: value.input, status: 'unknown' }
      : undefined;
  } catch { return undefined; }
}

/** Pending writes survive navigation/reload. Reconciliation is GET-only. */
export function useKnowledgeAsk(onResult: (result: KnowledgeAskResponse) => void) {
  const [pending, setPending] = useState<PendingQuestion | undefined>(restore);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [progress, setProgress] = useState<KnowledgeRunProgress>();
  const [stopping, setStopping] = useState(false);
  const [stopState, setStopState] = useState<StopCommandState>();
  const [error, setError] = useState<string>();
  const active = useRef(pending);
  const activeKey = () => active.current?.input.requestKey;
  const resultHandler = useRef(onResult);
  resultHandler.current = onResult;

  const remember = (next: PendingQuestion | undefined) => {
    // Persist before dispatch: if persistence is unavailable, no write is sent.
    if (next === undefined) sessionStorage.removeItem(STORAGE_KEY);
    else sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    active.current = next;
    setPending(next);
  };

  const acceptResult = (result: KnowledgeAskResponse) => {
    resultHandler.current(result);
    remember(undefined);
    setError(undefined);
    setProgress(undefined);
  };

  const reconcile = async () => {
    const current = active.current;
    if (current === undefined) return;
    setChecking(true);
    try {
      const { data } = await apiGet<OperationsByKeyResponse>(ROUTES.operationsByKey(current.input.requestKey));
      if (activeKey() !== current.input.requestKey) return;
      const operation: OperationRecord = data.operation;
      if (operation.status === 'succeeded') {
        const result = await apiGet<KnowledgeAskResponse>(`${ROUTES.knowledgeResult(current.input.requestKey)}?projectId=${encodeURIComponent(current.input.projectId)}`);
        if (activeKey() === current.input.requestKey) acceptResult(result.data);
      } else if (operation.status === 'failed') {
        remember(undefined);
        setError(operation.error?.message ?? '服务确认本次问答失败，输入已保留。');
      } else {
        remember({ ...current, status: operation.status });
        setError(undefined);
      }
    } catch (caught) {
      // A missing/not-yet-visible receipt never proves the original write did
      // not arrive. Keep the key and the write lock.
      setError(`尚未核对到确定结果：${errorMessage(caught)}`);
    } finally { setChecking(false); }
  };

  useEffect(() => {
    if (pending === undefined) return;
    let disposed = false;
    let receiptRead = false;
    let timer: ReturnType<typeof setTimeout>;
    const key = pending.input.requestKey;
    const poll = async () => {
      try {
        const response = await apiGet<KnowledgeRunProgress>(`${ROUTES.knowledgeProgress(key)}?projectId=${encodeURIComponent(pending.input.projectId)}`);
        if (disposed || active.current?.input.requestKey !== key) return;
        setProgress(response.data);
        if (!receiptRead) { receiptRead = true; await reconcile(); }
        if (['completed', 'stopped', 'failed'].includes(response.data.status)) {
          await reconcile();
          return;
        }
      } catch { /* Keep the last confirmed snapshot and original write key. */ }
      if (!disposed) timer = setTimeout(() => { void poll(); }, 700);
    };
    void poll();
    return () => { disposed = true; clearTimeout(timer); };
  }, [pending?.input.requestKey]);

  const openRun = async (key: string, projectId: string) => {
    if (active.current !== undefined && active.current.input.requestKey !== key) {
      setError('当前还有未完成问答，请先核对当前操作后切换对话。');
      return;
    }
    try {
      const { data } = await apiGet<KnowledgeRunProgress>(`${ROUTES.knowledgeProgress(key)}?projectId=${encodeURIComponent(projectId)}`);
      if (['completed', 'stopped'].includes(data.status)) {
        const result = await apiGet<KnowledgeAskResponse>(`${ROUTES.knowledgeResult(key)}?projectId=${encodeURIComponent(projectId)}`);
        acceptResult(result.data);
      } else {
        remember({ input: { requestKey: key, projectId, question: data.question, conversationId: data.conversationId, sourcePaths: data.sources.selectedPaths }, status: data.status === 'unknown' ? 'unknown' : 'accepted' });
        setProgress(data);
      }
    } catch (caught) { setError(`读取原对话失败：${errorMessage(caught)}`); }
  };

  const stop = async () => {
    const current = active.current;
    if (current === undefined || stopping || progress?.stopRequestKey !== undefined) return;
    const stopKey = createRequestKey();
    setStopping(true);
    try {
      const { data } = await apiPost<CommandResponse>(ROUTES.knowledgeStop(current.input.requestKey), { requestKey: stopKey, projectId: current.input.projectId });
      if (data.receipt.status === 'succeeded') setStopState(undefined);
      else if (data.receipt.status === 'failed') {
        setStopState({ requestKey: stopKey, status: 'failed', message: data.receipt.error?.message ?? '服务确认停止失败；回答仍在继续或已结束，请重新读取状态。' });
      } else setStopState({ requestKey: stopKey, status: data.receipt.status === 'unknown' ? 'unknown' : 'accepted' });
    } catch (caught) {
      // Network uncertainty: keep the original stop request key and only reconcile.
      setStopState({ requestKey: stopKey, status: 'unknown', message: errorMessage(caught) });
    } finally { setStopping(false); }
  };

  /** GET-only reconciliation of the original stop request (never re-sends it). */
  const reconcileStop = async () => {
    const target = stopState ?? (progress?.stopRequestKey === undefined ? undefined : { requestKey: progress.stopRequestKey, status: 'accepted' as const });
    if (target === undefined) return;
    setStopping(true);
    try {
      const { data } = await apiGet<OperationsByKeyResponse>(ROUTES.operationsByKey(target.requestKey));
      if (data.operation.status === 'succeeded') {
        setStopState(undefined);
      } else if (data.operation.status === 'failed') {
        setStopState({ requestKey: target.requestKey, status: 'failed', message: data.operation.error?.message ?? '原停止请求失败。' });
      } else {
        setStopState({ requestKey: target.requestKey, status: data.operation.status === 'unknown' ? 'unknown' : 'accepted' });
      }
    } catch (caught) {
      setStopState({ requestKey: target.requestKey, status: 'unknown', message: `尚未核对到确定结果：${errorMessage(caught)}` });
    } finally { setStopping(false); }
  };

  const ask = async (input: Omit<KnowledgeAskRequest, 'requestKey'>) => {
    if (active.current !== undefined) return;
    const current: PendingQuestion = { input: { ...input, requestKey: createRequestKey() }, status: 'accepted' };
    try { remember(current); } catch {
      setError('无法保存本次请求号，问题尚未发送。请检查浏览器本地存储后重试。');
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      const { data } = await apiPost<CommandResponse<KnowledgeAskResponse>>(ROUTES.knowledgeAsk, current.input, { timeoutMs: 130_000 });
      if (activeKey() !== current.input.requestKey) return;
      if (data.receipt.status === 'succeeded' && data.resource !== undefined) acceptResult(data.resource);
      else if (data.receipt.status === 'failed') {
        remember(undefined);
        setError(data.receipt.error?.message ?? '服务确认本次问答失败，输入已保留。');
      } else remember({ ...current, status: data.receipt.status === 'accepted' ? 'accepted' : 'unknown' });
    } catch (caught) {
      if (activeKey() !== current.input.requestKey) return;
      if (isApiClientError(caught) && caught.kind === 'http' && caught.status !== null && caught.status >= 400 && caught.status < 500 && caught.code !== null && !/UNKNOWN|IN_PROGRESS/.test(caught.code)) {
        remember(undefined);
        setError(errorMessage(caught));
      } else {
        remember({ ...current, status: 'unknown' });
        setError('未收到确定回执，结果待核对。原问题和请求号已保留，不会重复发送。');
      }
    } finally { if (activeKey() === undefined || activeKey() === current.input.requestKey) setBusy(false); }
  };

  return { pending, busy, checking, error, progress, stopping, stop, stopState, reconcileStop, openRun, ask, reconcile };
}
