import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  DELIVERY_GOAL_LABEL,
  DELIVERY_PROJECTION_LABEL,
  FINDING_STATUS_LABEL,
  FIX_OUTCOME_LABEL,
  FIX_STATE_LABEL,
  REVIEW_STATE_LABEL,
  SEVERITY_LABEL,
  labelFor,
  type ActionAvailability,
  type DeliveryGoalValue,
  type DeliveryProjectionValue,
  type DimensionValue,
  type FindingStatusValue,
  type FixOutcomeValue,
  type FixRunStateValue,
  type GitConnectionStateValue,
  type GitPerson,
  type RepoGitStateValue,
  type ReviewRunStateValue,
  type SeverityValue,
  type ChangeStatusValue,
} from '@agent-workflow/shared';
import { errorMessage, isApiClientError } from '../../api/client.ts';
import { classifyGitFailure, failureKindDetail, failureKindLabel, type ReceiptView, type GitFailureKind } from '../../api/git.ts';
import { Badge, type BadgeTone } from '../../components/Badge.tsx';
import { Button } from '../../components/Button.tsx';
import { Icon, type IconName } from '../../components/Icon.tsx';
import { formatAbsoluteTime, formatRelativeTime } from '../../app/format.ts';

/* ------------------------------------------------------------------ */
/* 标签 / 色调                                                         */
/* ------------------------------------------------------------------ */

export const GIT_CONNECTION_LABEL: Record<GitConnectionStateValue, string> = {
  connected: '已连接',
  not_configured: '未配置',
  auth_failed: '认证失败',
  unreachable: '无法访问',
};

export const REPO_GIT_STATE_LABEL: Record<RepoGitStateValue, string> = {
  git: '受 Git 管理',
  not_git: '非 Git 项目',
  path_unavailable: '本机路径不可用',
  capability_unavailable: 'Git 能力未接入',
};

export const DIMENSION_LABEL: Record<DimensionValue, string> = {
  correctness: '缺陷',
  security: '安全',
  performance: '性能',
  quality: '质量',
  style: '规范',
  tests: '测试',
};

export const DIMENSION_ICON: Record<DimensionValue, IconName> = {
  correctness: 'tool',
  security: 'shield',
  performance: 'zap',
  quality: 'check',
  style: 'book',
  tests: 'target',
};

export const SEVERITY_ICON: Record<SeverityValue, IconName> = {
  blocker: 'alert',
  critical: 'alert',
  major: 'info',
  suggestion: 'sparkle',
};

export const SEVERITY_TONE: Record<SeverityValue, BadgeTone> = {
  blocker: 'danger',
  critical: 'stall',
  major: 'fail',
  suggestion: 'neutral',
};

export const CHANGE_STATUS_LABEL: Record<ChangeStatusValue, string> = {
  A: '新增',
  M: '修改',
  D: '删除',
  R: '重命名',
  C: '复制',
  T: '类型变更',
};

export const CHANGE_STATUS_TONE: Record<ChangeStatusValue, BadgeTone> = {
  A: 'ok',
  M: 'fail',
  D: 'danger',
  R: 'accent',
  C: 'accent',
  T: 'wait',
};

export const REVIEW_STAGE_LABEL: Record<string, string> = {
  reading_diff: '读取改动',
  analyzing: '分析',
  summarizing: '汇总',
  preparing_fix: '准备修复分支',
  editing: '修改代码',
  verifying: '校验',
  done: '完成',
};

export function reviewStateTone(state: ReviewRunStateValue): BadgeTone {
  switch (state) {
    case 'completed':
      return 'ok';
    case 'running':
    case 'stopping':
      return 'run';
    case 'failed':
      return 'danger';
    case 'unknown':
      return 'unknown';
    case 'queued':
      return 'wait';
    case 'stopped':
      return 'idle';
  }
}

export function fixStateTone(state: FixRunStateValue): BadgeTone {
  switch (state) {
    case 'ready':
      return 'ok';
    case 'preparing':
    case 'editing':
    case 'verifying':
      return 'run';
    case 'failed':
      return 'danger';
    case 'unknown':
      return 'unknown';
    case 'no_changes':
    case 'stopped':
    case 'stopping':
    case 'discarded':
      return 'idle';
  }
}

export function fixOutcomeTone(outcome: FixOutcomeValue): BadgeTone {
  switch (outcome) {
    case 'fixed':
      return 'ok';
    case 'partial':
      return 'fail';
    case 'not_fixed':
      return 'danger';
  }
}

export function findingStatusTone(status: FindingStatusValue): BadgeTone {
  switch (status) {
    case 'open':
      return 'wait';
    case 'accepted':
      return 'ok';
    case 'dismissed':
      return 'idle';
    case 'false_positive':
      return 'neutral';
  }
}

export function deliveryProjectionTone(projection: DeliveryProjectionValue): BadgeTone {
  switch (projection) {
    case 'delivered':
      return 'ok';
    case 'in_progress':
      return 'run';
    case 'unknown_receipt':
      return 'unknown';
    case 'blocked':
      return 'danger';
    case 'awaiting_selection':
    case 'awaiting_confirmation':
      return 'wait';
  }
}

export function deliveryStepStateTone(state: string): BadgeTone {
  switch (state) {
    case 'succeeded':
      return 'ok';
    case 'failed':
      return 'danger';
    case 'unknown':
      return 'unknown';
    case 'in_progress':
      return 'run';
    case 'ready':
      return 'accent';
    case 'blocked':
      return 'fail';
    default:
      return 'neutral';
  }
}

export const DELIVERY_STEP_STATE_LABEL: Record<string, string> = {
  not_started: '未开始',
  ready: '可执行',
  in_progress: '进行中',
  succeeded: '成功',
  failed: '失败',
  unknown: '待核对',
  blocked: '受阻',
};

export function deliveryGoalLabel(goal: DeliveryGoalValue | undefined): string {
  return goal === undefined ? '未选择目标' : labelFor(DELIVERY_GOAL_LABEL, goal);
}

export function projectionLabel(projection: DeliveryProjectionValue): string {
  return labelFor(DELIVERY_PROJECTION_LABEL, projection);
}

export function reviewLabel(state: ReviewRunStateValue): string {
  return labelFor(REVIEW_STATE_LABEL, state);
}

export function fixLabel(state: FixRunStateValue): string {
  return labelFor(FIX_STATE_LABEL, state);
}

export function severityLabel(severity: SeverityValue): string {
  return labelFor(SEVERITY_LABEL, severity);
}

export function fixOutcomeLabel(outcome: FixOutcomeValue): string {
  return labelFor(FIX_OUTCOME_LABEL, outcome);
}

export function findingStatusLabel(status: FindingStatusValue): string {
  return labelFor(FINDING_STATUS_LABEL, status);
}

export function connectionTone(state: GitConnectionStateValue): BadgeTone {
  switch (state) {
    case 'connected':
      return 'ok';
    case 'not_configured':
      return 'wait';
    case 'auth_failed':
      return 'danger';
    case 'unreachable':
      return 'fail';
  }
}

export function repoStateTone(state: RepoGitStateValue): BadgeTone {
  switch (state) {
    case 'git':
      return 'ok';
    case 'not_git':
      return 'idle';
    case 'path_unavailable':
      return 'danger';
    case 'capability_unavailable':
      return 'unknown';
  }
}

export const MR_STATE_LABEL: Record<'opened' | 'merged' | 'closed' | 'locked', string> = {
  opened: '打开',
  merged: '已合并',
  closed: '已关闭',
  locked: '锁定',
};

export function mrStateTone(state: 'opened' | 'merged' | 'closed' | 'locked'): BadgeTone {
  switch (state) {
    case 'opened':
      return 'run';
    case 'merged':
      return 'ok';
    case 'closed':
      return 'idle';
    case 'locked':
      return 'wait';
  }
}

/* ------------------------------------------------------------------ */
/* 格式化                                                              */
/* ------------------------------------------------------------------ */

export function shortSha(sha: string): string {
  return sha.slice(0, 7);
}

export function shortRef(ref: string): string {
  return ref.replace(/^refs\/heads\//, '').replace(/^refs\/remotes\//, '');
}

export function personLabel(person: GitPerson | undefined): string {
  if (person === undefined) return '未知作者';
  return person.name;
}

export function aheadBehind(ahead: number | undefined, behind: number | undefined): string {
  if (ahead === undefined || behind === undefined) return '与远端差异未知';
  if (ahead === 0 && behind === 0) return '与远端一致';
  return `领先 ${String(ahead)} · 落后 ${String(behind)}`;
}

export function formatTime(iso: string | undefined): string {
  return formatRelativeTime(iso);
}

export function formatAbsolute(iso: string | undefined): string {
  return formatAbsoluteTime(iso);
}

export function dateKey(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'unknown';
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${String(date.getFullYear())}-${month}-${day}`;
}

export function dateGroupLabel(key: string): string {
  if (key === 'unknown') return '时间未知';
  const today = dateKey(new Date().toISOString());
  const yesterday = dateKey(new Date(Date.now() - 86_400_000).toISOString());
  if (key === today) return '今天';
  if (key === yesterday) return '昨天';
  const [year, month, day] = key.split('-');
  return `${year ?? ''} 年 ${Number(month ?? 0)} 月 ${Number(day ?? 0)} 日`;
}

export function countDelta(additions: number | null, deletions: number | null): string {
  if (additions === null && deletions === null) return '行数未知';
  return `+${String(additions ?? 0)} / −${String(deletions ?? 0)}`;
}

/* ------------------------------------------------------------------ */
/* 复制                                                                */
/* ------------------------------------------------------------------ */

export function useCopyValue(): {
  copied: string | null;
  copy: (value: string, label?: string) => void;
  unsupported: boolean;
} {
  const [copied, setCopied] = useState<string | null>(null);
  const [unsupported, setUnsupported] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, []);

  const copy = useCallback((value: string, label?: string) => {
    const markCopied = () => {
      setCopied(label ?? value);
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(null), 1600);
    };
    if (typeof navigator !== 'undefined' && navigator.clipboard !== undefined) {
      void navigator.clipboard.writeText(value).then(markCopied, () => setUnsupported(true));
      return;
    }
    setUnsupported(true);
  }, []);

  return { copied, copy, unsupported };
}

export function ShaCopy({
  value,
  label,
  mono = true,
  truncate,
}: {
  readonly value: string;
  readonly label?: string;
  readonly mono?: boolean;
  readonly truncate?: number;
}) {
  const { copied, copy, unsupported } = useCopyValue();
  const text = truncate === undefined ? value : value.slice(0, truncate);
  return (
    <button
      type="button"
      className={['sha-copy', mono ? 'mono' : ''].filter(Boolean).join(' ')}
      title={unsupported ? '当前环境不支持剪贴板' : `复制 ${label ?? '此值'}`}
      onClick={() => {
        copy(value, label);
      }}
    >
      <span>{text}</span>
      <Icon name={copied === label ? 'check' : 'copy'} size="sm" />
      <span className="sr">{copied === label ? '已复制' : '复制'}</span>
    </button>
  );
}

export function CopyText({ value, label }: { readonly value: string; readonly label: string }) {
  const { copied, copy } = useCopyValue();
  return (
    <button type="button" className="copy-text" onClick={() => { copy(value, label); }} title={`复制${label}`}>
      <Icon name={copied === label ? 'check' : 'copy'} size="sm" />
      <span>{value}</span>
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* 状态提示                                                            */
/* ------------------------------------------------------------------ */

export interface FailureNoticeProps {
  readonly error: unknown;
  readonly onRetry?: () => void;
  readonly compact?: boolean;
  readonly title?: string;
  readonly className?: string;
}

/**
 * 失败提示。未接通 / 服务未连接 / 业务失败三种文案不同，均带服务消息与错误码；
 * 不把失败当成空数据，也不提供会重复副作用的重试（读失败才给「重新读取」）。
 */
export function FailureNotice({ error, onRetry, compact, title, className }: FailureNoticeProps) {
  const kind = classifyGitFailure(error);
  // 能力未接入用 unknown 中性样式（设计 g03：「不是错误，不出现红色错误样式」）。
  const tone = kind === 'failed' ? 'warn' : kind === 'capability_unavailable' ? 'unknown' : 'danger';
  const code = isApiClientError(error) ? error.code : null;
  const requestId = isApiClientError(error) ? error.requestId : null;
  const icon = kind === 'capability_unavailable' ? 'gitRepo' : kind === 'not_connected' ? 'lock' : 'alert';
  return (
    <div className={['banner', tone, className ?? ''].filter(Boolean).join(' ')} role="alert">
      <Icon name={icon} />
      <div className="grow">
        <b>{title ?? failureKindLabel(kind)}</b>
        {compact === true ? ` · ${failureKindDetail(kind)}` : null}
        {compact === true ? null : (
          <>
            <br />
            {failureKindDetail(kind)}
          </>
        )}
        <span className="failure-detail">
          {errorMessage(error)}
          {code === null ? '' : ` · ${code}`}
          {requestId === null ? '' : ` · ${requestId}`}
        </span>
      </div>
      {onRetry === undefined ? null : (
        <div className="actions">
          <Button variant="secondary" size="sm" icon="refresh" onClick={onRetry}>
            重新读取
          </Button>
        </div>
      )}
    </div>
  );
}

/** 未接通 / 未连接时的整块占位：说明 + 禁用一切写操作。 */
export function UnavailablePanel({
  error,
  onRetry,
  title,
  description,
  kindOverride,
}: {
  readonly error: unknown;
  readonly onRetry?: () => void;
  readonly title?: string;
  readonly description?: ReactNode;
  /** 已知的仓库状态可强制用对应样式（例如 Git 能力未接入 = unknown，不是错误）。 */
  readonly kindOverride?: GitFailureKind;
}) {
  const kind: GitFailureKind = kindOverride ?? classifyGitFailure(error);
  return (
    <div className={['unavailable-panel', kind === 'capability_unavailable' ? 'capability' : ''].filter(Boolean).join(' ')}>
      <span className="tile lg">
        <Icon name={kind === 'capability_unavailable' ? 'gitRepo' : kind === 'not_connected' ? 'lock' : 'alert'} size="lg" />
      </span>
      <h3>{title ?? failureKindLabel(kind)}</h3>
      <p>{description ?? failureKindDetail(kind)}</p>
      <p className="unavailable-detail">{errorMessage(error)}</p>
      {onRetry === undefined ? null : (
        <Button variant="secondary" icon="refresh" onClick={onRetry}>
          重新读取
        </Button>
      )}
    </div>
  );
}

/** 取禁用原因：服务给了就用服务的，没给时用调用方写明的前提。 */
export function actionReasonText(action: ActionAvailability | undefined, fallback: string): string {
  if (action === undefined) return fallback;
  return action.reason ?? action.reasonCode ?? fallback;
}

/** 可用性说明：不满足时按钮禁用并把服务原因写在旁边。 */
export function ActionReason({ action, className }: { readonly action: ActionAvailability | undefined; readonly className?: string }) {
  if (action === undefined || action.allowed) return null;
  return (
    <span className={['action-reason', className ?? ''].filter(Boolean).join(' ')}>
      <Icon name="lock" size="sm" />
      {action.reason ?? action.reasonCode ?? '服务未说明原因'}
    </span>
  );
}

/** 回执条：accepted / succeeded / failed / unknown 分开显示；只有 UNKNOWN 给「核对原操作」。 */
export function ReceiptBanner({
  receipt,
  onVerify,
  verifying,
  onDismiss,
}: {
  readonly receipt: ReceiptView;
  readonly onVerify?: (requestKey: string) => void;
  readonly verifying?: boolean;
  readonly onDismiss?: () => void;
}) {
  const unknown = receipt.status === 'unknown';
  const accepted = receipt.status === 'accepted';
  const succeeded = receipt.status === 'succeeded';
  const tone = unknown ? 'unknown' : accepted ? 'info' : succeeded ? 'ok' : 'danger';
  return (
    <div className={['banner', tone, 'receipt-banner'].join(' ')} role={unknown || !succeeded ? 'alert' : 'status'}>
      <Icon name={unknown ? 'help' : accepted ? 'clock' : succeeded ? 'check' : 'alert'} />
      <div className="grow">
        <b>
          {accepted ? '已接受 · 等待结算' : succeeded ? '已完成' : unknown ? '回执未知 · 结果待核对' : '操作失败'}
        </b>
        <span className="receipt-meta mono">{receipt.operation} · {receipt.requestKey}</span>
        {receipt.error === undefined ? null : (
          <span className="failure-detail">
            {receipt.error.message}
            {receipt.error.code.length === 0 ? '' : ` · ${receipt.error.code}`}
            {receipt.error.output === undefined ? null : <code className="receipt-output">{receipt.error.output}</code>}
          </span>
        )}
        {accepted ? (
          <span className="receipt-note">服务已接受，尚未结算；以读口为准，不要重复发起同一操作。</span>
        ) : null}
        {unknown ? (
          <span className="receipt-note">保持原记录，只核对原操作；不会自动重发。</span>
        ) : null}
      </div>
      <div className="actions">
        {unknown && onVerify !== undefined ? (
          <Button variant="secondary" size="sm" icon="search" disabled={verifying === true} onClick={() => { onVerify(receipt.requestKey); }}>
            核对原操作
          </Button>
        ) : null}
        {onDismiss === undefined ? null : (
          <Button variant="ghost" size="sm" onClick={onDismiss}>
            收起
          </Button>
        )}
      </div>
    </div>
  );
}

/** 未知回执的核对结果（operations.by-key）。 */
export function OperationLookupResult({
  operation,
  stillUnknown,
}: {
  readonly operation: { readonly status: string; readonly operation: string; readonly requestKey: string; readonly settledAt?: string; readonly error?: { readonly code: string; readonly message: string } };
  readonly stillUnknown: boolean;
}) {
  return (
    <div className={['banner', stillUnknown ? 'unknown' : operation.status === 'failed' ? 'danger' : 'ok'].join(' ')}>
      <Icon name={stillUnknown ? 'help' : operation.status === 'failed' ? 'alert' : 'check'} />
      <div className="grow">
        <b>核对结果：{stillUnknown ? '仍然未知' : operation.status === 'failed' ? '原操作明确失败' : '原操作已结算'}</b>
        <br />
        {operation.operation} · <span className="mono">{operation.requestKey}</span>
        {operation.error === undefined ? null : ` · ${operation.error.message}`}
        {operation.settledAt === undefined ? null : ` · 结算于 ${formatAbsolute(operation.settledAt)}`}
        {stillUnknown ? '。只有服务结算后的回执才能清除未知，界面不会重发。' : '。界面已按服务回执更新，不重发原请求。'}
      </div>
    </div>
  );
}

/** 只读提示，用于「审查只读 / 不改用户工作区」这类责任边界。 */
export function ReadOnlyHint({ children }: { readonly children: ReactNode }) {
  return (
    <div className="readonly-hint">
      <Icon name="eye" size="sm" />
      <span>{children}</span>
    </div>
  );
}

export function KeyValue({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className="kv-line">
      <span className="k">{label}</span>
      <span className="v">{children}</span>
    </div>
  );
}

export function PersonChip({ person, role }: { readonly person: GitPerson | undefined; readonly role?: string }) {
  const initials = person?.initials ?? person?.name.slice(0, 1).toUpperCase() ?? '?';
  return (
    <span className="person-chip">
      <span className="avatar">{initials}</span>
      <span className="ellipsis">{role === undefined ? personLabel(person) : `${role} · ${personLabel(person)}`}</span>
    </span>
  );
}

/** 小号状态点 + 文字（状态永不只靠颜色）。 */
export function StatusMark({ tone, children }: { readonly tone: BadgeTone; readonly children: ReactNode }) {
  return <Badge tone={tone}>{children}</Badge>;
}
