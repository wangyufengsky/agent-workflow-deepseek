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
  PptWorkManageRequest,
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
/* 四步制作阶段（讨论需求 → 设计方案 → 制作检查 → 导出）                 */
/* ------------------------------------------------------------------ */

export type PptStageKey = 'discuss' | 'design' | 'check' | 'export';

export interface PptStageStep {
  readonly key: PptStageKey;
  readonly label: string;
  readonly icon: IconName;
}

export const PPT_STAGES: readonly PptStageStep[] = [
  { key: 'discuss', label: '讨论需求', icon: 'help' },
  { key: 'design', label: '设计方案', icon: 'layers' },
  { key: 'check', label: '制作检查', icon: 'shield' },
  { key: 'export', label: '导出', icon: 'download' },
];

export type PptStageFilter = 'all' | 'design' | 'discuss' | 'check';

export interface PptProgress {
  /** 当前真实阶段；导出不是持久状态，因此永远不会由数据推导为 current。 */
  readonly current: 'discuss' | 'design' | 'check';
  /** 已完成的数据阶段数（0–2）：大纲、逐页。 */
  readonly completed: number;
  readonly stageLabel: string;
  readonly nextHint: string;
  readonly pageText: string;
  readonly hasOutline: boolean;
  readonly hasSlides: boolean;
}

/**
 * 只按服务真实字段推导进度：大纲=设计方案产出、逐页=制作产出。
 * 服务没有“已导出/已检查”状态，所以导出与检查不会被标成已完成。
 */
export function derivePptProgress(work: PptWork): PptProgress {
  const hasOutline = work.outline.length > 0;
  const hasSlides = work.slides.length > 0;
  const completed = (hasOutline ? 1 : 0) + (hasSlides ? 1 : 0);
  const current: PptProgress['current'] = !hasOutline ? 'discuss' : !hasSlides ? 'design' : 'check';
  const stageLabel = PPT_STAGES.find((step) => step.key === current)?.label ?? '讨论需求';
  const pageText = hasSlides
    ? `已生成 ${String(work.slides.length)} 页`
    : hasOutline
      ? `大纲 ${String(work.outline.length)} 条 · 未生成逐页`
      : '尚无大纲 · 0 页';
  const nextHint =
    work.status === 'generating'
      ? '服务正在生成内容，等回执后再操作'
      : work.status === 'failed'
        ? '最近一次生成失败；到工作台按回执重试'
        : !hasOutline
          ? '下一步：到工作台补全主题与大纲'
          : !hasSlides
            ? '下一步：生成逐页内容'
            : '下一步：导出 PPTX 或 Markdown';
  return { current, completed, stageLabel, nextHint, pageText, hasOutline, hasSlides };
}

export type PptStepState = 'done' | 'current' | 'todo' | 'available';

/** 工作台四步状态；导出永远不显示为“已完成”（服务不记录导出）。 */
export function pptStepState(step: PptStageKey, progress: PptProgress): PptStepState {
  const order: readonly PptStageKey[] = ['discuss', 'design', 'check', 'export'];
  const currentIndex = order.indexOf(progress.current);
  const index = order.indexOf(step);
  if (step === 'export') return progress.hasSlides ? 'available' : 'todo';
  if (index < currentIndex) return 'done';
  if (index === currentIndex) return 'current';
  return 'todo';
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
  | { readonly kind: 'copy' | 'archive' | 'restore'; readonly workId: string; readonly body: PptWorkManageRequest }
  | { readonly kind: 'delete'; readonly workId: string };

export type PptCommandKind = PptCommand['kind'];

export const PPT_COMMAND_LABEL: Record<PptCommandKind, string> = {
  create: '创建作品', copy: '复制作品', archive: '归档或恢复作品', restore: '恢复内容版本',
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
    case 'copy':
    case 'archive':
    case 'restore':
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
