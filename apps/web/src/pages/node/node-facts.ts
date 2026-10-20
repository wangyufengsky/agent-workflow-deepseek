import { NodeStatus, type Attempt, type NodeAcceptanceView, type OutputFragment } from '@agent-workflow/shared';
import type { BadgeTone } from '../../components/Badge.tsx';
import type { IconName } from '../../components/Icon.tsx';
import { attemptVisual, resultVisual, toolVisual, type NodeStateVisual } from './node-labels.ts';
import { readCitations } from './node-citations.ts';

/**
 * Pure projections for the node detail panel. Everything here is derived from
 * the service read models (attempt / output fragments / execution projection) —
 * nothing is simulated. Where the read model cannot answer a design question the
 * fact says so instead of guessing.
 */

export type ReconnectPhase = 'idle' | 'reading' | 'done' | 'gap' | 'failed';
export type ConnectionState = 'connecting' | 'connected' | 'disconnected';

export interface ToolCardModel {
  readonly callId: string;
  readonly name: string;
  readonly source: string | undefined;
  readonly status: string;
  readonly visual: NodeStateVisual;
  readonly argsSummary?: string;
  readonly resultLine: string;
  readonly resultMuted: boolean;
  readonly note?: { readonly text: string; readonly unknown: boolean };
  readonly late?: { readonly at?: string };
  readonly startedAt?: string;
  readonly endedAt?: string;
  readonly durationMs?: number;
  readonly seq: number;
  readonly fragment: OutputFragment;
}

export interface ServiceEventRow {
  readonly id: string;
  readonly text: string;
  readonly tone: 'neutral' | 'ok' | 'warn' | 'wait' | 'unknown' | 'danger' | 'accent';
  readonly icon: IconName;
  readonly at?: string;
}

export interface NodeFact {
  readonly key: 'connection' | 'model' | 'tools' | 'attempt' | 'result';
  readonly label: string;
  readonly value: string;
  readonly tone: BadgeTone;
  readonly icon: IconName;
  /** Design `facet.unk`: dashed/unknown styling. */
  readonly unknown: boolean;
  /** Design `stale-tag`: value was read before the data channel broke. */
  readonly stale: boolean;
  /** Design `facet.w3`: wider grid cell. */
  readonly wide: boolean;
  /** Shows the design `.spin` marker (reading / running). */
  readonly busy: boolean;
}

export function clockTime(value: string | undefined): string {
  if (value === undefined || value.length === 0) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const pad = (input: number): string => String(input).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/** Shorten opaque service IDs for display; never invent a version number. */
export function shortId(value: string | undefined, length = 10): string {
  if (value === undefined || value.length === 0) return '未提供';
  return value.length <= length ? value : `${value.slice(0, length)}…`;
}

export function firstLine(value: string | undefined, max = 140): string | undefined {
  if (value === undefined) return undefined;
  const line = value.split('\n')[0]?.trim() ?? '';
  if (line.length === 0) return value.trim().length === 0 ? undefined : '（内容以空白开头）';
  return line.length <= max ? line : `${line.slice(0, max)}…`;
}

/** True once the attempt can no longer append records. */
export function attemptEnded(attempt: Pick<Attempt, 'status'> | undefined): boolean {
  return attempt !== undefined && attempt.status !== NodeStatus.RUNNING;
}

/**
 * Group recorded tool calls by `callId`, staying at the first recorded position.
 * Later records of the same call update status/evidence in place (design
 * N13-tool-twice: late updates must not duplicate the card).
 */
export function buildToolCards(fragments: readonly OutputFragment[], attempt: Pick<Attempt, 'status'> | undefined): readonly ToolCardModel[] {
  const order: string[] = [];
  const byCall = new Map<string, OutputFragment[]>();
  for (const fragment of fragments) {
    if (fragment.category !== 'tool_activity') continue;
    const callId = fragment.toolCallRef?.callId ?? '';
    if (callId.length === 0) continue;
    const list = byCall.get(callId);
    if (list === undefined) {
      byCall.set(callId, [fragment]);
      order.push(callId);
    } else {
      list.push(fragment);
    }
  }
  const ended = attemptEnded(attempt);
  const modelSeqs = fragments.filter((fragment) => fragment.category === 'model_text').map((fragment) => fragment.seq);
  return order.map((callId) => {
    const records = byCall.get(callId) ?? [];
    const first = records[0]!;
    const last = records[records.length - 1]!;
    // Evidence is spread over the call's events: parameters arrive with the call,
    // result fields with the completion. Use the newest record that carries each
    // field instead of picking one record and losing the rest.
    const evidences = records.map((record) => record.toolEvidence).filter((entry): entry is NonNullable<typeof entry> => entry !== undefined);
    const evidence = evidences.at(-1) ?? evidences[0];
    const name = evidences.find((entry) => entry.name.length > 0)?.name ?? '';
    const argsText = evidences.map((entry) => entry.input).find((value) => value !== undefined);
    const outputText = [...evidences].reverse().map((entry) => entry.output).find((value) => value !== undefined);
    const errorText = [...evidences].reverse().map((entry) => entry.error).find((value) => value !== undefined);
    const startedAt = evidences.map((entry) => entry.startedAt).find((value) => value !== undefined);
    const endedAt = [...evidences].reverse().map((entry) => entry.endedAt).find((value) => value !== undefined);
    const durationMs = evidences.map((entry) => entry.durationMs).find((value) => value !== undefined);
    const status = last.toolCallRef?.status ?? '';
    const visual = toolVisual(status, ended);
    // Late return: a completion record whose seq sits after later model text was
    // already persisted (design N13-tool-twice). Derived from service order only.
    const lastSeq = Math.max(...records.map((record) => record.seq));
    const late = records.length > 1 && modelSeqs.some((seq) => seq > first.seq && seq < lastSeq);
    const resultLine = status === 'completed'
      ? firstLine(outputText) ?? '服务未记录返回结果'
      : status === 'failed'
        ? firstLine(errorText) ?? '调用失败（服务未记录错误详情）'
        : status === 'running'
          ? '等待服务返回结果'
          : ended
            ? '没有记录到结果'
            : '等待服务返回结果';
    const resultMuted = status !== 'completed' && status !== 'failed';
    let note: ToolCardModel['note'];
    if (status === 'running' && attempt?.status === NodeStatus.FAILED) {
      note = { text: '尝试失败时这次调用仍在运行，服务没有记录它的结果', unknown: true };
    } else if ((status === 'running' || status === 'queued') && attempt?.status === NodeStatus.CANCELLED) {
      note = { text: '执行器停止时这次调用仍在运行，服务没有记录它的结果', unknown: true };
    }
    const argsSummary = firstLine(argsText);
    return {
      callId,
      name: name.length > 0 ? name : (firstLine(first.text, 60)?.split(' · ')[0] ?? '工具调用'),
      source: first.toolCallRef?.source,
      status,
      visual,
      ...(argsSummary === undefined ? {} : { argsSummary }),
      resultLine,
      resultMuted,
      ...(note === undefined ? {} : { note }),
      ...(late ? { late: { ...(last.recordedAt === undefined ? {} : { at: last.recordedAt }) } } : {}),
      ...(startedAt === undefined ? {} : { startedAt }),
      ...(endedAt === undefined ? {} : { endedAt }),
      ...(durationMs === undefined ? {} : { durationMs }),
      seq: first.seq,
      fragment: last,
    } satisfies ToolCardModel;
  });
}

/** Record-sequence holes in the persisted fragment page (never filled in). */
export function buildGaps(fragments: readonly OutputFragment[]): readonly { readonly from: number; readonly to: number }[] {
  const seqs = fragments.map((fragment) => fragment.seq).sort((left, right) => left - right);
  const gaps: { from: number; to: number }[] = [];
  const first = seqs[0];
  if (first !== undefined && first > 1) gaps.push({ from: 1, to: first - 1 });
  for (let index = 1; index < seqs.length; index += 1) {
    const previous = seqs[index - 1];
    const current = seqs[index];
    if (previous === undefined || current === undefined) continue;
    if (current > previous + 1) gaps.push({ from: previous + 1, to: current - 1 });
  }
  return gaps;
}

export function gapText(gaps: readonly { readonly from: number; readonly to: number }[]): string {
  return gaps.map((gap) => (gap.from === gap.to ? `#${String(gap.from)}` : `#${String(gap.from)}–#${String(gap.to)}`)).join('、');
}

export interface NodeFactsContext {
  readonly loading: boolean;
  readonly historical: boolean;
  readonly connection: ConnectionState;
  readonly reconnectPhase: ReconnectPhase;
  readonly attempt?: Pick<Attempt, 'status' | 'result'>;
  readonly acceptance?: NodeAcceptanceView;
  readonly executionStatus?: string;
  readonly modelTextCapability?: string;
  readonly toolsReadable: boolean;
  readonly outputReadable: boolean;
  readonly resultReadable: boolean;
  readonly hasModelText: boolean;
  readonly hasAnyFragment: boolean;
  readonly terminal: boolean;
  readonly toolCards: readonly ToolCardModel[];
}

const LOADING_FACT = { value: '读取中', tone: 'idle', icon: 'refresh', busy: true } as const;
const NO_PERMISSION_FACT = { value: '无权读取', tone: 'idle', icon: 'lock', unknown: true, busy: false } as const;

/** Design `facets()`: five independent facts, each honestly derived. */
export function deriveFacts(context: NodeFactsContext): readonly NodeFact[] {
  const stale = !context.historical && context.connection !== 'connected' && context.reconnectPhase !== 'done' && context.reconnectPhase !== 'gap';
  const connectionFact = ((): Pick<NodeFact, 'value' | 'tone' | 'icon' | 'busy'> => {
    if (context.historical) return { value: '历史记录 · 不更新', tone: 'idle', icon: 'lock', busy: false };
    if (context.reconnectPhase === 'reading') return { value: '补读中', tone: 'accent', icon: 'refresh', busy: true };
    if (context.reconnectPhase === 'failed') return { value: '重新读取失败', tone: 'danger', icon: 'alert', busy: false };
    if (context.reconnectPhase === 'gap') return { value: '已连接 · 有缺口', tone: 'unknown', icon: 'help', busy: false };
    if (context.reconnectPhase === 'done') return { value: '已连接 · 已补读', tone: 'ok', icon: 'link', busy: false };
    if (context.connection === 'connected') return { value: '已连接', tone: 'ok', icon: 'link', busy: false };
    if (context.connection === 'connecting') return { value: '正在连接', tone: 'wait', icon: 'refresh', busy: true };
    return { value: '已断开', tone: 'danger', icon: 'alert', busy: false };
  })();

  const modelFact = ((): Pick<NodeFact, 'value' | 'tone' | 'icon' | 'busy'> => {
    if (context.loading) return LOADING_FACT;
    if (!context.outputReadable) return NO_PERMISSION_FACT;
    if (!context.hasModelText) {
      if (context.modelTextCapability !== undefined && context.modelTextCapability !== 'ok' && context.modelTextCapability !== 'forbidden') {
        return { value: '此运行时未提供', tone: 'idle', icon: 'minus', busy: false };
      }
      return { value: '尚无正文', tone: 'idle', icon: 'minus', busy: false };
    }
    if (context.attempt?.status === NodeStatus.FAILED) return { value: '传输中断', tone: 'fail', icon: 'alert', busy: false };
    if (context.attempt?.status === NodeStatus.CANCELLED) return { value: '已停止', tone: 'idle', icon: 'stop', busy: false };
    if (context.historical || context.terminal) return { value: '传输结束', tone: 'idle', icon: 'stop', busy: false };
    const lastTool = [...context.toolCards].filter((card) => card.status === 'running' || card.status === 'queued').at(-1);
    if (lastTool !== undefined) return { value: '等待工具返回', tone: 'wait', icon: 'clock', busy: false };
    return { value: '正在生成', tone: 'run', icon: 'play', busy: false };
  })();

  const toolsFact = ((): Pick<NodeFact, 'value' | 'tone' | 'icon' | 'busy'> => {
    if (context.loading) return LOADING_FACT;
    if (!context.toolsReadable) return NO_PERMISSION_FACT;
    if (context.toolCards.length === 0) return { value: '无', tone: 'idle', icon: 'minus', busy: false };
    if (context.toolCards.some((card) => card.visual.label === '结果未知')) return { value: '结果未知', tone: 'unknown', icon: 'help', busy: false };
    const running = context.toolCards.filter((card) => card.status === 'running').length;
    if (running > 0 && !attemptEnded(context.attempt)) return { value: `${String(running)} 个运行中`, tone: 'run', icon: 'play', busy: true };
    if (context.toolCards.some((card) => card.status === 'queued')) return { value: '1 个排队', tone: 'wait', icon: 'clock', busy: false };
    return { value: '全部结束', tone: 'idle', icon: 'check', busy: false };
  })();

  const attemptFact: NodeStateVisual | { readonly value: string; readonly tone: BadgeTone; readonly icon: IconName; readonly busy: boolean } = context.loading
    ? LOADING_FACT
    : attemptVisual(context.attempt, context.acceptance, context.executionStatus);
  const resultFact = context.loading ? LOADING_FACT : !context.resultReadable ? NO_PERMISSION_FACT : resultVisual(context.attempt, context.acceptance);
  const attemptValue = 'value' in attemptFact ? attemptFact.value : attemptFact.label;

  return [
    { key: 'connection', label: '数据连接', value: connectionFact.value, tone: connectionFact.tone, icon: connectionFact.icon, busy: connectionFact.busy, unknown: connectionFact.tone === 'unknown', stale: false, wide: false },
    { key: 'model', label: '模型正文', value: modelFact.value, tone: modelFact.tone, icon: modelFact.icon, busy: modelFact.busy, unknown: modelFact.tone === 'unknown', stale, wide: false },
    { key: 'tools', label: '工具', value: toolsFact.value, tone: toolsFact.tone, icon: toolsFact.icon, busy: toolsFact.busy, unknown: toolsFact.tone === 'unknown', stale, wide: false },
    { key: 'attempt', label: '尝试', value: attemptValue, tone: attemptFact.tone, icon: attemptFact.icon, busy: 'busy' in attemptFact ? attemptFact.busy : false, unknown: attemptFact.tone === 'unknown', stale, wide: true },
    { key: 'result', label: '结果与验收', value: 'label' in resultFact ? resultFact.label : resultFact.value, tone: resultFact.tone, icon: resultFact.icon, busy: 'busy' in resultFact ? resultFact.busy : false, unknown: resultFact.tone === 'unknown', stale, wide: true },
  ];
}

export interface ComboContext extends NodeFactsContext {
  readonly attemptReadable: boolean;
  readonly attemptOrdinal?: number;
  readonly verificationState?: string;
  readonly gaps: readonly { readonly from: number; readonly to: number }[];
  readonly lastReadAt?: string;
  readonly backfilledCount: number;
  readonly dedupedCount: number;
}

/** Design `combo()`: one honest sentence for the current combination of facts. */
export function deriveCombo(context: ComboContext): string {
  const ordinal = context.attemptOrdinal === undefined ? '?' : String(context.attemptOrdinal);
  if (context.historical) return `这是尝试 #${ordinal} 的固定记录：只读，不会追加，也不会触发任何执行。`;
  if (!context.attemptReadable) return '你已无权查看这次尝试的记录；事实条与记录已清除，这里不显示结果或验收。';
  if (context.loading) return '正在读取这一步的执行记录。';
  if (context.reconnectPhase === 'failed') return '重新读取失败：下面仍是断开前收到的记录，已标为过时。';
  if (context.reconnectPhase === 'reading') return '正在按服务返回的顺序重新读取数据通道断开期间的记录；重复片段按 fragmentId 去重。';
  if (context.connection === 'disconnected') return `数据连接已断开（截至 ${clockTime(context.lastReadAt)}）。下方是断开前收到的记录，已标为过时；模型是否仍在执行以服务状态为准。`;
  if (context.connection === 'connecting') return '正在重新连接数据通道。重连成功只代表数据恢复，不代表模型仍在执行。';
  if (context.reconnectPhase === 'gap') return `数据连接已恢复，但有一段记录服务未保留（${gapText(context.gaps)}），已在记录流中标出缺口。`;
  if (context.reconnectPhase === 'done') return `数据连接已恢复。断开期间的记录已重新读取：已补读 ${String(context.backfilledCount)} 条（客户端按 fragmentId 去重 ${String(context.dedupedCount)} 条）；模型是否仍在执行以服务状态为准。`;
  if (context.executionStatus === 'stopping') return '已请求停止，执行器尚未确认。取消请求不等于已停止；确认前仍可能有新记录。';
  if (context.attempt?.status === NodeStatus.FAILED) return '执行失败。已收到的正文保留可读；失败不会被显示成完成。';
  if (context.attempt?.status === NodeStatus.CANCELLED) return '执行器已确认停止；已收到的正文与工具记录保留。';
  if (context.attempt?.status === NodeStatus.UNKNOWN || context.executionStatus === 'unknown') {
    return '执行结果待核对：服务未确认结果或停止请求。核对完成前不显示为已完成，界面不会重复发送。';
  }
  if (context.acceptance?.state === 'accepted') return '结果已提交，并已由人工验收通过；执行与验收事实都已结束。';
  if (context.acceptance?.state === 'rejected') return '正文与执行都已结束，但结果验收未通过：这一步没有完成。';
  if (context.acceptance?.state === 'pending') return '结果已提交，需要你人工验收；在此之前不显示为已完成。';
  if (context.attempt?.result !== undefined) {
    return context.verificationState === 'failed'
      ? '结果已提交，但校验未通过：这一步没有完成。'
      : '结果已提交，等待验收；验收通过后才显示完成。';
  }
  if (context.terminal) return '正文传输已结束，结果尚未提交——这不代表这一步已完成。';
  const runningTool = [...context.toolCards].filter((card) => card.status === 'running' || card.status === 'queued').at(-1);
  if (runningTool !== undefined) return `正文暂停，等待工具返回（${runningTool.name} #${runningTool.callId}）；工具结果以服务记录为准。`;
  if (!context.hasAnyFragment) return '尝试已开始，模型还没有输出正文；这不是错误，也不是完成。';
  return '模型正在生成正文；结果尚未提交，这一步仍在执行。';
}

export interface ServiceEventContext {
  readonly attempt?: Attempt;
  readonly acceptance?: NodeAcceptanceView;
  readonly executionStatus?: string;
  readonly nodeStatus?: string;
  readonly nodeError?: { readonly code: string; readonly message: string };
  readonly attemptFailureReason?: string;
  readonly connection: ConnectionState;
  readonly reconnectPhase: ReconnectPhase;
  readonly backfilledCount: number;
  readonly dedupedCount: number;
  readonly gapCount: number;
  readonly lastReadAt?: string;
}

/**
 * Snapshot-projected service facts (design NODE-05). The service does not write
 * `service_event` fragments yet, so these rows are labelled as snapshot facts in
 * the UI — never presented as record-stream order.
 */
export function buildServiceEvents(context: ServiceEventContext): readonly ServiceEventRow[] {
  const rows: ServiceEventRow[] = [];
  const attempt = context.attempt;
  if (attempt?.startedAt !== undefined) {
    rows.push({ id: 'started', icon: 'play', tone: 'neutral', text: `尝试 #${String(attempt.ordinal)} 开始`, at: attempt.startedAt });
  }
  if (context.connection === 'disconnected' || context.reconnectPhase === 'reading' || context.reconnectPhase === 'failed') {
    rows.push({ id: 'disconnected', icon: 'alert', tone: 'danger', text: '连接中断 · 数据通道断开，之后的记录需要补读' });
  }
  if (context.reconnectPhase === 'done' || context.reconnectPhase === 'gap') {
    rows.push({
      id: 'backfilled',
      icon: 'refresh',
      tone: context.reconnectPhase === 'gap' ? 'unknown' : 'accent',
      text: `已补读 ${String(context.backfilledCount)} 条（去重 ${String(context.dedupedCount)} 条）· 客户端按 fragmentId 统计`,
    });
  }
  if (context.gapCount > 0) {
    rows.push({ id: 'gapcount', icon: 'help', tone: 'unknown', text: `有 ${String(context.gapCount)} 段记录无法补读（服务未保留）` });
  }
  if (context.executionStatus === 'stopping' || context.executionStatus === 'pausing') {
    rows.push({ id: 'stopping', icon: 'clock', tone: 'wait', text: '你请求停止这一步 · 等待执行器确认；确认前它可能仍在执行' });
  }
  if (attempt?.result !== undefined) {
    if (context.acceptance?.state === 'accepted') {
      rows.push({ id: 'accepted', icon: 'check', tone: 'ok', text: `验收通过 · 结果修订 ${attempt.result.resultRevision}`, ...(context.acceptance.verdictAt === undefined ? {} : { at: context.acceptance.verdictAt }) });
    } else if (context.acceptance?.state === 'rejected') {
      rows.push({ id: 'rejected', icon: 'x', tone: 'warn', text: `验收未通过 · 结果修订 ${attempt.result.resultRevision}${context.acceptance.note === undefined ? '' : `：${context.acceptance.note}`}`, ...(context.acceptance.verdictAt === undefined ? {} : { at: context.acceptance.verdictAt }) });
    } else if (context.acceptance?.state === 'pending') {
      rows.push({ id: 'pending', icon: 'eye', tone: 'wait', text: `结果已提交 · 进入人工验收 · 结果修订 ${attempt.result.resultRevision}` });
    } else {
      rows.push({ id: 'submitted', icon: 'upload', tone: 'wait', text: `结果已提交 · 等待验收 · 结果修订 ${attempt.result.resultRevision}`, ...(attempt.endedAt === undefined ? {} : { at: attempt.endedAt }) });
    }
  }
  if (attempt?.status === NodeStatus.FAILED) {
    const reason = context.nodeError?.message ?? context.attemptFailureReason ?? '服务未返回失败原因';
    rows.push({ id: 'failed', icon: 'alert', tone: 'warn', text: `执行失败 · ${reason}` });
  }
  if (context.nodeStatus === NodeStatus.CANCELLED) {
    rows.push({ id: 'cancelled', icon: 'stop', tone: 'neutral', text: '执行器已确认停止 · 已收到的正文与工具记录保留' });
  }
  if (context.nodeStatus === NodeStatus.UNKNOWN) {
    rows.push({ id: 'unknown', icon: 'help', tone: 'unknown', text: '执行结果未确认 · 服务未返回执行器确认；界面不会重复发送' });
  }
  return rows;
}

/** Records without a call ID still belong in the feed — show them, don't drop them. */
function fallbackToolCard(fragment: OutputFragment, attempt: Pick<Attempt, 'status'> | undefined): ToolCardModel {
  const status = fragment.toolCallRef?.status ?? '';
  const visual = toolVisual(status, attemptEnded(attempt));
  return {
    callId: fragment.toolCallRef?.callId ?? '',
    name: fragment.toolEvidence?.name ?? firstLine(fragment.text)?.split(' · ')[0] ?? '工具调用',
    source: fragment.toolCallRef?.source,
    status,
    visual,
    resultLine: status === 'completed' ? '服务未记录返回结果' : status === 'failed' ? '调用失败（服务未记录错误详情）' : '等待服务返回结果',
    resultMuted: status !== 'completed' && status !== 'failed',
    seq: fragment.seq,
    fragment,
  };
}

export type NodeFeedItem =
  | { readonly kind: 'model'; readonly id: string; readonly seq: number; readonly text: string; readonly markdown: boolean; readonly live: boolean; readonly citations: readonly import('./node-citations.ts').NodeCitation[]; readonly recordedAt?: string; readonly blockId?: string }
  | { readonly kind: 'reasoning'; readonly id: string; readonly seq: number; readonly text: string; readonly recordedAt?: string }
  | { readonly kind: 'tool'; readonly id: string; readonly seq: number; readonly card: ToolCardModel; readonly recordedAt?: string }
  | { readonly kind: 'service'; readonly id: string; readonly seq: number; readonly text: string; readonly recordedAt?: string }
  | { readonly kind: 'gap'; readonly id: string; readonly from: number; readonly to: number }
  | { readonly kind: 'cut'; readonly id: string }
  | { readonly kind: 'hidden'; readonly id: string; readonly count: number };

export interface FeedInput {
  /** Every persisted fragment of the attempt (used for holes / hidden tool counts). */
  readonly allFragments: readonly OutputFragment[];
  /** Readable fragments only; tool records may already be filtered out. */
  readonly visibleFragments: readonly OutputFragment[];
  readonly toolCards: readonly ToolCardModel[];
  readonly attempt?: Pick<Attempt, 'status'>;
  readonly historical: boolean;
  readonly live: boolean;
  readonly toolsReadable: boolean;
}

/**
 * Ordered record-stream items: text / reasoning / one card per tool call /
 * service rows, with dashed gap separators for service-side holes and an
 * explicit line when a failed or cancelled attempt cut its text short.
 */
export function buildFeedItems(input: FeedInput): readonly NodeFeedItem[] {
  const items: NodeFeedItem[] = [];
  const cards = new Map(input.toolCards.map((card) => [card.callId, card]));
  const serviceGaps = buildGaps(input.allFragments);

  const hiddenToolSeqs = input.toolsReadable
    ? []
    : input.allFragments
      .filter((fragment) => fragment.category === 'tool_activity' || fragment.toolEvidence !== undefined)
      .map((fragment) => fragment.seq);
  if (hiddenToolSeqs.length > 0) items.push({ kind: 'hidden', id: 'hidden-tools', count: hiddenToolSeqs.length });

  const ordered = [...input.visibleFragments].sort((left, right) => left.seq - right.seq);
  let previousSeq = 0;
  const pushGap = (from: number, to: number) => {
    const intersecting = serviceGaps.filter((gap) => gap.from <= to && gap.to >= from);
    if (intersecting.length > 0) {
      for (const gap of intersecting) items.push({ kind: 'gap', id: `gap-${String(gap.from)}`, from: gap.from, to: gap.to });
      return;
    }
    // The hole exists because tool records were filtered out, not because the
    // service lost them.
    const hidden = hiddenToolSeqs.filter((seq) => seq > from - 1 && seq < to + 1).length;
    if (hidden === 0) return;
    items.push({ kind: 'hidden', id: `hidden-${String(from)}`, count: hidden });
  };

  // The tool feed merges later records of the same call into the first position.
  const merged: OutputFragment[] = [];
  const seenCall = new Set<string>();
  for (const fragment of ordered) {
    const callId = fragment.category === 'tool_activity' ? fragment.toolCallRef?.callId : undefined;
    if (callId !== undefined && callId.length > 0) {
      if (seenCall.has(callId)) continue;
      seenCall.add(callId);
    }
    merged.push(fragment);
  }

  const lastModelIndex = (() => {
    for (let index = merged.length - 1; index >= 0; index -= 1) {
      const fragment = merged[index];
      if (fragment !== undefined && (fragment.category === 'model_text' || fragment.category === 'public_reasoning_summary')) return index;
    }
    return -1;
  })();

  merged.forEach((fragment, index) => {
    if (fragment.seq > previousSeq + 1) pushGap(previousSeq + 1, fragment.seq - 1);
    previousSeq = fragment.seq;
    const id = fragment.fragmentId;
    if (fragment.category === 'tool_activity') {
      const card = cards.get(fragment.toolCallRef?.callId ?? '') ?? fallbackToolCard(fragment, input.attempt);
      items.push({ kind: 'tool', id, seq: fragment.seq, card, ...(fragment.recordedAt === undefined ? {} : { recordedAt: fragment.recordedAt }) });
      return;
    }
    if (fragment.category === 'public_reasoning_summary') {
      items.push({ kind: 'reasoning', id, seq: fragment.seq, text: fragment.text ?? '', ...(fragment.recordedAt === undefined ? {} : { recordedAt: fragment.recordedAt }) });
      return;
    }
    if (fragment.category === 'service_event') {
      items.push({ kind: 'service', id, seq: fragment.seq, text: fragment.text ?? '', ...(fragment.recordedAt === undefined ? {} : { recordedAt: fragment.recordedAt }) });
      return;
    }
    items.push({
      kind: 'model',
      id,
      seq: fragment.seq,
      text: fragment.text ?? '',
      markdown: fragment.format !== 'text',
      live: input.live && index === lastModelIndex && !input.historical,
      citations: readCitations(fragment),
      ...(fragment.recordedAt === undefined ? {} : { recordedAt: fragment.recordedAt }),
      ...(fragment.blockId === undefined ? {} : { blockId: fragment.blockId }),
    });
  });

  if ((input.attempt?.status === NodeStatus.FAILED || input.attempt?.status === NodeStatus.CANCELLED) && lastModelIndex >= 0) {
    items.push({ kind: 'cut', id: 'cut' });
  }
  return items;
}
