import { useCallback, useRef, useState } from 'react';
import { createRequestKey, type CommandResponse, type OperationReceipt } from '@agent-workflow/shared';
import { errorMessage, isApiClientError } from '../../api/client.ts';
import { fetchOperationByKey } from '../../api/workflow.ts';
import { Button } from '../../components/Button.tsx';
import { Icon } from '../../components/Icon.tsx';

/**
 * P11-02: once a write command's outcome is unknown (transport failure or an
 * UNKNOWN receipt), the original operation is locked. The only offered action
 * is reconciling the *original* request key — never re-sending, never minting a
 * new key. The lock survives dialog closes because it lives at page level.
 */
export interface PendingUnknown {
  readonly operation: string;
  readonly requestKey: string;
  readonly message: string;
}

export interface LookupResult {
  readonly status: string;
  readonly stillUnknown: boolean;
}

export interface ReceiptCommandState {
  readonly busy: boolean;
  readonly error: unknown;
  readonly receipt?: OperationReceipt;
  readonly pendingUnknown?: PendingUnknown;
}

export interface ReceiptCommandRunner {
  readonly state: ReceiptCommandState;
  readonly checking: boolean;
  readonly lookupResult?: LookupResult;
  /** Runs one mutating command; the runner owns the request key so it can be kept on UNKNOWN. */
  readonly run: <T>(operation: string, execute: (requestKey: string) => Promise<CommandResponse<T>>) => Promise<CommandResponse<T> | undefined>;
  /** Read-only by-key reconcile of the locked request key. */
  readonly lookup: () => Promise<void>;
  readonly reset: () => void;
  /** Called when a dialog-derived UNKNOWN must stay locked at page level. */
  readonly adopt: (pending: PendingUnknown) => void;
}

/** A transport-level failure means the write may have reached the service. */
function isUncertain(error: unknown): boolean {
  if (!isApiClientError(error)) return false;
  if (error.kind === 'unavailable' || error.kind === 'timeout') return true;
  return error.kind === 'http' && (error.status ?? 0) >= 500;
}

export function useReceiptCommand(): ReceiptCommandRunner {
  const [state, setState] = useState<ReceiptCommandState>({ busy: false, error: null });
  const [checking, setChecking] = useState(false);
  const [lookupResult, setLookupResult] = useState<LookupResult | undefined>(undefined);
  const pendingRef = useRef<PendingUnknown | undefined>(undefined);
  const busyRef = useRef(false);

  const run = useCallback(
    async <T,>(operation: string, execute: (requestKey: string) => Promise<CommandResponse<T>>): Promise<CommandResponse<T> | undefined> => {
      if (busyRef.current) return undefined;
      // UNKNOWN locks the command: only `lookup()` may touch the service now.
      if (pendingRef.current !== undefined) return undefined;
      busyRef.current = true;
      setState({ busy: true, error: null });
      const requestKey = createRequestKey();
      try {
        const response = await execute(requestKey);
        if (response.receipt.status === 'unknown') {
          pendingRef.current = { operation, requestKey, message: '服务返回未知回执；原始操作可能已经执行。' };
          setState({ busy: false, error: null, receipt: response.receipt, pendingUnknown: pendingRef.current });
        } else {
          setState({ busy: false, error: null, receipt: response.receipt });
        }
        return response;
      } catch (error) {
        if (isUncertain(error)) {
          pendingRef.current = { operation, requestKey, message: errorMessage(error) };
          setState({ busy: false, error: null, pendingUnknown: pendingRef.current });
        } else {
          setState({ busy: false, error });
        }
        return undefined;
      } finally {
        busyRef.current = false;
      }
    },
    [],
  );

  const lookup = useCallback(async (): Promise<void> => {
    const pending = pendingRef.current;
    if (pending === undefined) return;
    setChecking(true);
    try {
      const result = await fetchOperationByKey(pending.requestKey);
      setLookupResult({ status: result.operation.status, stillUnknown: result.stillUnknown });
      if (!result.stillUnknown) {
        pendingRef.current = undefined;
        setState((previous) => ({ ...previous, pendingUnknown: undefined }));
      }
    } catch (error) {
      setState((previous) => ({ ...previous, error }));
    } finally {
      setChecking(false);
    }
  }, []);

  const reset = useCallback((): void => {
    if (pendingRef.current !== undefined) return;
    setState({ busy: false, error: null });
    setLookupResult(undefined);
  }, []);

  const adopt = useCallback((pending: PendingUnknown): void => {
    if (pendingRef.current !== undefined) return;
    pendingRef.current = pending;
    setState({ busy: false, error: null, pendingUnknown: pending });
  }, []);

  return { state, checking, lookupResult, run, lookup, reset, adopt };
}

export function unknownLockReason(pending: PendingUnknown | undefined): string | undefined {
  if (pending === undefined) return undefined;
  return `上一次「${pending.operation}」结果待核对（请求号 ${pending.requestKey}）：只按原请求号核对，不能重新提交或换新请求号`;
}

export function UnknownLockBanner({
  pending,
  checking,
  lookupResult,
  onLookup,
}: {
  readonly pending: PendingUnknown | undefined;
  readonly checking: boolean;
  readonly lookupResult: LookupResult | undefined;
  readonly onLookup: () => void;
}) {
  if (pending === undefined) return null;
  return (
    <div className="banner unknown" role="alert">
      <Icon name="help" />
      <div className="grow">
        <b>「{pending.operation}」结果待核对：只按原请求号核对，不会重发，也不会换新请求号。</b>
        <span className="mono receipt-key">请求号 {pending.requestKey}</span>
        <br />
        {pending.message}
        {lookupResult === undefined ? null : (
          <span style={{ display: 'block', marginTop: 4 }}>
            核对结果：{lookupResult.status}
            {lookupResult.stillUnknown ? ' · 仍为未知，保持锁定' : ' · 已按服务回读，重新读取后再决定下一步'}
          </span>
        )}
      </div>
      <div className="actions">
        <Button variant="secondary" size="sm" icon="search" disabled={checking} disabledReason={checking ? '正在核对原请求号…' : undefined} onClick={onLookup}>
          {checking ? '正在核对…' : '按原请求号核对'}
        </Button>
      </div>
    </div>
  );
}
