import type {
  OperationReceipt,
  OperationRecord,
  PptAttachmentRequest,
  PptWork,
  PptWorkCreateRequest,
  PptWorkGenerateContentRequest,
  PptWorkGenerateRequest,
  PptWorkStatusValue,
  PptWorkUpdateRequest,
  ReceiptStatusValue,
} from '@agent-workflow/shared';
import { THEMES } from '@agent-workflow/shared';
import { formatAbsoluteTime } from '../../app/format.ts';
import type { BadgeTone } from '../../components/Badge.tsx';
import { Button } from '../../components/Button.tsx';
import { Icon, type IconName } from '../../components/Icon.tsx';

/* ------------------------------------------------------------------ */
/* 作品状态 / 计数 / 主题                                               */
/* ------------------------------------------------------------------ */

export interface PptStatusMeta {
  readonly label: string;
  readonly tone: BadgeTone;
  readonly icon: IconName;
}

/** PPT 作品阶段标签（对齐 shared 的 PptWorkStatus；状态一律文字 + 图标）。 */
export const PPT_STATUS_META: Record<PptWorkStatusValue, PptStatusMeta> = {
  draft: { label: '草稿', tone: 'idle', icon: 'edit' },
  generating: { label: '生成中', tone: 'run', icon: 'sparkle' },
  ready: { label: '已生成', tone: 'done', icon: 'check' },
  failed: { label: '生成失败', tone: 'fail', icon: 'alert' },
};

export function pptStatusMeta(status: PptWorkStatusValue): PptStatusMeta {
  return PPT_STATUS_META[status] ?? PPT_STATUS_META.draft;
}

export function themeLabel(theme: PptWork['theme']): string {
  return THEMES[theme]?.label ?? theme;
}

export interface PptPageCount {
  readonly outline: number;
  readonly slides: number;
}

export function pptPageCount(work: PptWork): PptPageCount {
  return { outline: work.outline.length, slides: work.slides.length };
}

/** 作品列表里的页数口径：已生成逐页就报页数，否则报大纲条数。 */
export function pptPageSummary(work: PptWork): string {
  const count = pptPageCount(work);
  if (count.slides > 0) return `已生成 ${String(count.slides)} 页`;
  if (count.outline > 0) return `大纲 ${String(count.outline)} 条 · 未生成逐页`;
  return '尚无大纲';
}

export function formatFileSize(size: number): string {
  if (!Number.isFinite(size) || size < 0) return '—';
  if (size < 1024) return `${String(size)} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

/* ------------------------------------------------------------------ */
/* 命令（所有写操作都走 requestKey + 回执）                              */
/* ------------------------------------------------------------------ */

export type PptCommand =
  | { readonly kind: 'create'; readonly body: PptWorkCreateRequest }
  | { readonly kind: 'attach'; readonly workId: string; readonly body: PptAttachmentRequest }
  | { readonly kind: 'detach'; readonly workId: string; readonly name: string }
  | { readonly kind: 'update'; readonly workId: string; readonly body: PptWorkUpdateRequest }
  | { readonly kind: 'generate'; readonly workId: string; readonly body: PptWorkGenerateRequest }
  | { readonly kind: 'generateSlides'; readonly workId: string; readonly body: PptWorkGenerateContentRequest }
  | { readonly kind: 'delete'; readonly workId: string };

export type PptCommandKind = PptCommand['kind'];

export const PPT_COMMAND_LABEL: Record<PptCommandKind, string> = {
  create: '创建作品',
  attach: '添加附件',
  detach: '移除附件',
  update: '保存作品编辑',
  generate: '生成大纲',
  generateSlides: '生成逐页内容',
  delete: '删除作品',
};

/** 客户端生成 requestKey 的命令；服务端自造请求号的命令没有可核对号码。 */
export function pptCommandRequestKey(command: PptCommand): string | undefined {
  switch (command.kind) {
    case 'create':
    case 'attach':
    case 'update':
    case 'generate':
    case 'generateSlides':
      return command.body.requestKey;
    default:
      return undefined;
  }
}

export type PptCommandOutcome = 'succeeded' | 'accepted' | 'failed' | 'unknown';

/** 命令结束后交给子面板的成功信号（用于关闭编辑框、清空附件表单）。 */
export interface PptCommandSignal {
  readonly kind: PptCommandKind;
  readonly outcome: PptCommandOutcome;
  /** 非 succeeded 时的服务说明；子面板把它显示在对应表单里。 */
  readonly message?: string;
  readonly at: number;
}

/* ------------------------------------------------------------------ */
/* 回执展示                                                            */
/* ------------------------------------------------------------------ */

export interface PptReceiptView {
  readonly requestKey: string;
  readonly operation: string;
  readonly status: ReceiptStatusValue;
  readonly acceptedAt: string;
  readonly settledAt?: string;
  readonly error?: { readonly code: string; readonly message: string; readonly output?: string };
}

export function toPptReceipt(receipt: OperationReceipt): PptReceiptView {
  return {
    requestKey: receipt.requestKey,
    operation: receipt.operation,
    status: receipt.status,
    acceptedAt: receipt.acceptedAt,
    settledAt: receipt.settledAt,
    error: receipt.error,
  };
}

export interface PptOperationLookup {
  readonly requestKey: string;
  readonly operation: string;
  readonly status: ReceiptStatusValue;
  readonly settledAt?: string;
  readonly error?: { readonly code: string; readonly message: string };
}

export function toPptLookup(record: OperationRecord): PptOperationLookup {
  return {
    requestKey: record.requestKey,
    operation: record.operation,
    status: record.status,
    settledAt: record.settledAt,
    error: record.error === undefined ? undefined : { code: record.error.code, message: record.error.message },
  };
}

export interface PptReceiptState {
  readonly label: string;
  readonly outcome: PptCommandOutcome;
  readonly message?: string;
  readonly receipt?: PptReceiptView;
  readonly requestKey?: string;
  readonly lookup?: PptOperationLookup;
  readonly lookupBusy?: boolean;
  readonly lookupError?: string;
}

const OUTCOME_META: Record<PptCommandOutcome, { readonly title: string; readonly tone: string; readonly icon: IconName }> = {
  succeeded: { title: '已完成', tone: 'ok', icon: 'check' },
  accepted: { title: '已接受 · 等待结算', tone: 'info', icon: 'clock' },
  unknown: { title: '回执未知 · 结果待核对', tone: 'unknown', icon: 'help' },
  failed: { title: '操作失败', tone: 'danger', icon: 'alert' },
};

function lookupTitle(lookup: PptOperationLookup): string {
  if (lookup.status === 'succeeded') return '原操作已结算成功';
  if (lookup.status === 'failed') return '原操作明确失败';
  if (lookup.status === 'accepted') return '原操作仍在处理';
  return '仍然未知';
}

export interface PptReceiptBannerProps {
  readonly state: PptReceiptState;
  readonly onVerify?: (requestKey: string) => void;
  readonly onDismiss?: () => void;
}

/**
 * 真实回执条：accepted / succeeded / failed / unknown 分开显示。
 * 只有未能确认结果时才给「核对原操作」，且永不自动重发。
 */
export function PptReceiptBanner({ state, onVerify, onDismiss }: PptReceiptBannerProps) {
  const meta = OUTCOME_META[state.outcome];
  const verifyKey =
    state.requestKey !== undefined && onVerify !== undefined && state.outcome !== 'succeeded' ? state.requestKey : undefined;

  return (
    <div
      className={['banner', meta.tone, 'ppt-receipt'].join(' ')}
      role={state.outcome === 'failed' || state.outcome === 'unknown' ? 'alert' : 'status'}
    >
      <Icon name={meta.icon} />
      <div className="grow">
        <b>
          {meta.title} · {state.label}
        </b>
        {state.receipt === undefined && state.requestKey === undefined ? null : (
          <div className="ppt-meta mono" style={{ marginTop: 2 }}>
            {state.receipt === undefined ? null : <span>{state.receipt.operation}</span>}
            {state.requestKey === undefined ? null : <span>请求号 {state.requestKey}</span>}
            {state.receipt?.settledAt === undefined ? null : <span>结算于 {formatAbsoluteTime(state.receipt.settledAt)}</span>}
          </div>
        )}
        {state.message === undefined ? null : <div style={{ marginTop: 4 }}>{state.message}</div>}
        {state.receipt?.error === undefined ? null : (
          <div className="error-text" style={{ marginTop: 4 }}>
            {state.receipt.error.message}
            {state.receipt.error.code === '' ? '' : ` · ${state.receipt.error.code}`}
          </div>
        )}
        {state.lookupError === undefined ? null : <div className="error-text" style={{ marginTop: 4 }}>核对失败：{state.lookupError}</div>}
        {state.lookup === undefined ? null : (
          <div className="ppt-lookup">
            <b>核对结果：{lookupTitle(state.lookup)}</b>
            <div className="ppt-meta mono" style={{ marginTop: 2 }}>
              <span>{state.lookup.operation}</span>
              <span>{state.lookup.requestKey}</span>
              {state.lookup.settledAt === undefined ? null : <span>结算于 {formatAbsoluteTime(state.lookup.settledAt)}</span>}
            </div>
            {state.lookup.error === undefined ? null : (
              <div className="error-text" style={{ marginTop: 2 }}>
                {state.lookup.error.message}
              </div>
            )}
          </div>
        )}
      </div>
      <div className="actions">
        {verifyKey === undefined ? null : (
          <Button
            variant="secondary"
            size="sm"
            icon="search"
            disabled={state.lookupBusy === true}
            disabledReason={state.lookupBusy === true ? '正在向服务核对原操作…' : undefined}
            onClick={() => {
              onVerify?.(verifyKey);
            }}
          >
            {state.lookupBusy === true ? '核对中…' : '核对原操作'}
          </Button>
        )}
        {onDismiss === undefined ? null : (
          <Button variant="ghost" size="sm" onClick={onDismiss}>
            收起
          </Button>
        )}
      </div>
    </div>
  );
}
