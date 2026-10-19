import type { ReactNode } from 'react';
import { errorMessage, isApiClientError, isServiceUnavailable } from '../api/client.ts';
import { Button } from './Button.tsx';
import { Icon } from './Icon.tsx';

export interface ServiceNoticeProps {
  readonly error: unknown;
  readonly onRetry?: () => void;
  readonly title?: string;
  readonly compact?: boolean;
  readonly className?: string;
}

/**
 * Explicit connection / read failure state. The UI never substitutes sample
 * data for a missing service — it says「服务未连接」and offers retry.
 */
export function ServiceNotice({ error, onRetry, title, compact, className }: ServiceNoticeProps) {
  const unavailable = isServiceUnavailable(error);
  const heading = title ?? (unavailable ? '服务未连接' : '数据读取失败');
  const body = unavailable
    ? '无法连接本地服务（默认 127.0.0.1:5177）。请启动后端后重试；连接前不展示示例数据。'
    : errorMessage(error);
  const code = isApiClientError(error) ? error.code : null;
  const requestId = isApiClientError(error) ? error.requestId : null;

  return (
    <div className={['banner', unavailable ? 'danger' : 'warn', className ?? ''].filter(Boolean).join(' ')} role="alert">
      <Icon name="alert" />
      <div className="grow">
        <b>{heading}</b>
        {compact === true ? ` · ${body}` : null}
        {compact === true ? null : (
          <>
            <br />
            {body}
          </>
        )}
        {code === null ? null : (
          <span className="mono" style={{ display: 'block', marginTop: 4, fontSize: 11.5, color: 'var(--muted)' }}>
            {code}
            {requestId === null ? '' : ` · ${requestId}`}
          </span>
        )}
      </div>
      {onRetry === undefined ? null : (
        <div className="actions">
          <Button variant="secondary" size="sm" icon="refresh" onClick={onRetry}>
            重试
          </Button>
        </div>
      )}
    </div>
  );
}

export interface PendingBackendNoticeProps {
  readonly message: ReactNode;
  readonly className?: string;
}

/** Read-only placeholder for functionality whose backend is not connected yet. */
export function PendingBackendNotice({ message, className }: PendingBackendNoticeProps) {
  return (
    <div className={['banner', 'info', className ?? ''].filter(Boolean).join(' ')}>
      <Icon name="lock" />
      <div className="grow">{message}</div>
    </div>
  );
}
