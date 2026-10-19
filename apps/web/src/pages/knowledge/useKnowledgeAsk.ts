import { useRef, useState } from 'react';
import {
  ROUTES, createRequestKey,
  type CommandResponse, type KnowledgeAskRequest, type KnowledgeAskResponse,
  type OperationRecord, type OperationsByKeyResponse,
} from '@agent-workflow/shared';
import { apiGet, apiPost, errorMessage, isApiClientError } from '../../api/client.ts';

const STORAGE_KEY = 'agent-workflow.knowledge.pending';
interface PendingQuestion {
  readonly input: KnowledgeAskRequest;
  readonly status: 'accepted' | 'unknown';
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
  const [error, setError] = useState<string>();
  const active = useRef(pending);
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
  };

  const reconcile = async () => {
    const current = active.current;
    if (current === undefined) return;
    setChecking(true);
    try {
      const { data } = await apiGet<OperationsByKeyResponse>(ROUTES.operationsByKey(current.input.requestKey));
      const operation: OperationRecord = data.operation;
      if (operation.status === 'succeeded') {
        const result = await apiGet<KnowledgeAskResponse>(`${ROUTES.knowledgeResult(current.input.requestKey)}?projectId=${encodeURIComponent(current.input.projectId)}`);
        acceptResult(result.data);
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
      if (data.receipt.status === 'succeeded' && data.resource !== undefined) acceptResult(data.resource);
      else if (data.receipt.status === 'failed') {
        remember(undefined);
        setError(data.receipt.error?.message ?? '服务确认本次问答失败，输入已保留。');
      } else remember({ ...current, status: data.receipt.status === 'accepted' ? 'accepted' : 'unknown' });
    } catch (caught) {
      if (isApiClientError(caught) && caught.kind === 'http' && caught.status !== null && caught.status >= 400 && caught.status < 500) {
        remember(undefined);
        setError(errorMessage(caught));
      } else {
        remember({ ...current, status: 'unknown' });
        setError('未收到确定回执，结果待核对。原问题和请求号已保留，不会重复发送。');
      }
    } finally { setBusy(false); }
  };

  return { pending, busy, checking, error, ask, reconcile };
}
