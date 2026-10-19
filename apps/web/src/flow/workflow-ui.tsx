import { useState, type ReactNode } from 'react';
import type { ActionAvailability, OperationReceipt } from '@agent-workflow/shared';
import { errorMessage, isApiClientError } from '../api/client.ts';
import { fetchOperationByKey, receiptFailedMessage, receiptIsUnknown } from '../api/workflow.ts';
import { Badge } from '../components/Badge.tsx';
import { Button, type ButtonProps } from '../components/Button.tsx';
import { Icon } from '../components/Icon.tsx';
import './workflow-ui.css';

export interface ServiceActionButtonProps extends Omit<ButtonProps, 'disabled' | 'disabledReason' | 'onClick'> {
  readonly action?: ActionAvailability;
  readonly busy?: boolean;
  /** Shown when the service did not send an action at all (e.g. older read model). */
  readonly fallbackReason?: string;
  readonly onRun: () => void | Promise<void>;
}

/**
 * Button bound to a server-computed `ActionAvailability`. It stays focusable
 * while disabled and carries the service reason (never an invented one).
 */
export function ServiceActionButton({ action, busy = false, fallbackReason, onRun, children, ...rest }: ServiceActionButtonProps) {
  const allowed = action?.allowed === true;
  const reason = busy ? '正在提交，等待服务回执…' : allowed ? undefined : (action?.reason ?? fallbackReason ?? '服务未提供此操作的原因');
  return (
    <Button {...rest} disabled={busy || !allowed} disabledReason={reason} aria-busy={busy || undefined} onClick={() => void onRun()}>
      {busy ? (
        <>
          <span className="spin" aria-hidden="true" />处理中…
        </>
      ) : (
        children
      )}
    </Button>
  );
}

/** Visible reason under a disabled action (not only a tooltip). */
export function ActionReasonLine({ action, fallback, block = false }: { readonly action?: ActionAvailability; readonly fallback?: string; readonly block?: boolean }) {
  if (action?.allowed === true) return null;
  const reason = action?.reason ?? fallback;
  if (reason === undefined || reason.length === 0) return null;
  return (
    <span className={block ? 'action-reason block' : 'action-reason'} role="note">
      <Icon name="lock" size="sm" />
      {reason}
    </span>
  );
}

export function CommandErrorNotice({ error, title }: { readonly error: unknown; readonly title?: string }) {
  if (error === null || error === undefined) return null;
  const code = isApiClientError(error) && error.code !== null ? error.code : undefined;
  return (
    <div className="banner danger" role="alert">
      <Icon name="alert" />
      <div className="grow">
        <b>{title ?? '操作未完成'}</b>
        <br />
        {errorMessage(error)}
        {code === undefined ? null : (
          <span className="mono" style={{ display: 'block', marginTop: 4, fontSize: 11.5, color: 'var(--muted)' }}>
            {code}
          </span>
        )}
      </div>
    </div>
  );
}

export interface ReceiptNoticeProps {
  readonly receipt?: OperationReceipt;
  readonly successMessage?: string;
}

/**
 * Command receipt banner: ACCEPTED / UNKNOWN stay visible. UNKNOWN is only
 * reconciled by the original request key — never re-sent.
 */
export function ReceiptNotice({ receipt, successMessage }: ReceiptNoticeProps) {
  const [checking, setChecking] = useState(false);
  const [checked, setChecked] = useState<{ status: string; stillUnknown: boolean } | null>(null);

  if (receipt === undefined) return null;
  if (receipt.status === 'succeeded') {
    if (successMessage === undefined) return null;
    return (
      <div className="banner ok" role="status">
        <Icon name="check" />
        <div className="grow">
          {successMessage}
          <span className="mono receipt-key">请求号 {receipt.requestKey}</span>
        </div>
      </div>
    );
  }
  if (receipt.status === 'failed') {
    return (
      <div className="banner danger" role="alert">
        <Icon name="alert" />
        <div className="grow">
          <b>操作失败</b>
          <br />
          {receiptFailedMessage(receipt) ?? '服务未返回失败原因'}
          {receipt.error === undefined ? null : (
            <span className="mono receipt-key">
              {receipt.error.code} · 请求号 {receipt.requestKey}
            </span>
          )}
        </div>
      </div>
    );
  }
  if (receiptIsUnknown(receipt)) {
    return (
      <div className="banner unknown" role="alert">
        <Icon name="help" />
        <div className="grow">
          <b>结果待核对</b> · 只按原请求号查询，不会重新生成，也不会换新请求号重发。
          <span className="mono receipt-key">请求号 {receipt.requestKey}</span>
          {checked === null ? null : (
            <span style={{ display: 'block', marginTop: 4 }}>
              核对结果：{checked.status}
              {checked.stillUnknown ? ' · 仍为未知，保持待核对' : ''}
            </span>
          )}
        </div>
        <div className="actions">
          <Button
            variant="secondary"
            size="sm"
            icon="refresh"
            disabled={checking}
            onClick={() => {
              setChecking(true);
              void fetchOperationByKey(receipt.requestKey)
                .then((result) => {
                  setChecked({ status: result.operation.status, stillUnknown: result.stillUnknown });
                })
                .finally(() => {
                  setChecking(false);
                });
            }}
          >
            {checking ? '正在核对…' : '按原请求号核对'}
          </Button>
        </div>
      </div>
    );
  }
  return (
    <div className="banner info" role="status">
      <Icon name="clock" />
      <div className="grow">
        请求已受理，等待服务回执。<span className="mono receipt-key">请求号 {receipt.requestKey}</span>
      </div>
    </div>
  );
}

/** Data connection banner. Disconnection != planning failure (design copy is fixed). */
export function ConnectionBanner({ connection, transport }: { readonly connection: 'connecting' | 'connected' | 'disconnected'; readonly transport: 'sse' | 'polling' }) {
  if (connection === 'disconnected') {
    return (
      <div className="banner warn" role="alert">
        <Icon name="alert" />
        <div className="grow">
          <b>本页与服务的数据连接已断开，正在重连……这不代表规划失败。</b>
          <br />
          已读内容保留；连接恢复前按钮是否可用以服务回执为准。当前每 1.5 秒只读重读本任务，不会重发命令。
        </div>
      </div>
    );
  }
  if (transport === 'polling') {
    return (
      <div className="banner info" role="status">
        <Icon name="refresh" />
        <div className="grow">实时事件连接不可用，正在每 1.5 秒只读重读当前任务；这不代表规划失败，也不会重发命令。</div>
      </div>
    );
  }
  return null;
}

export function FactPill({ label, value, tone }: { readonly label: string; readonly value: ReactNode; readonly tone?: 'neutral' | 'ok' | 'warn' | 'run' | 'wait' | 'unknown' | 'done' | 'fail' | 'idle' }) {
  return (
    <span className={`fact-pill tone-${tone ?? 'neutral'}`}>
      <span className="fact-key">{label}</span>
      {value}
    </span>
  );
}

export function FactsBar({ children }: { readonly children: ReactNode }) {
  return <div className="facts-bar">{children}</div>;
}

export function LockLine({ children }: { readonly children: ReactNode }) {
  return (
    <div className="lockline">
      <Icon name="lock" size="sm" />
      <span>{children}</span>
    </div>
  );
}

export function InlineBadge({ children, tone = 'neutral', icon }: { readonly children: ReactNode; readonly tone?: 'neutral' | 'accent' | 'ok' | 'warn' | 'wait' | 'unknown' | 'idle' | 'done' | 'run' | 'fail' | 'stall'; readonly icon?: 'check' | 'alert' | 'clock' | 'lock' | 'info' | 'help' | 'play' | 'x' | 'eye' }) {
  return (
    <Badge tone={tone} icon={icon}>
      {children}
    </Badge>
  );
}
