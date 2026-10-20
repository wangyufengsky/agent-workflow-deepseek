import { NodeStatus, type Attempt, type NodeAcceptanceView, type OutputFragment } from '@agent-workflow/shared';
import type { BadgeTone } from '../../components/Badge.tsx';
import type { IconName } from '../../components/Icon.tsx';

/**
 * Node-detail vocabulary from the design authority
 * (`opencode-workflow-design-showcase/originals/node/assets/node-detail.js`):
 * `ATT_ST`, `RES_ST`, `TOOL_ST`, `SRC` and the record block labels.
 * Every visual is text + icon + tone — colour alone never carries a state.
 */
export interface NodeStateVisual {
  readonly label: string;
  readonly tone: BadgeTone;
  readonly icon: IconName;
}

const UNKNOWN_VISUAL: NodeStateVisual = { label: '状态未知', tone: 'unknown', icon: 'help' };

/** Narrow a badge tone to the `FactPill` tone set. */
export function pillTone(tone: BadgeTone): 'neutral' | 'ok' | 'warn' | 'run' | 'wait' | 'unknown' | 'done' | 'fail' | 'idle' {
  switch (tone) {
    case 'accent':
      return 'wait';
    case 'stall':
    case 'danger':
      return 'fail';
    default:
      return tone;
  }
}

/** Design `ATT_ST`: attempt state, not the node read model. */
export function attemptVisual(attempt: { readonly status: string } | undefined, acceptance?: NodeAcceptanceView, executionStatus?: string): NodeStateVisual {
  if (attempt === undefined) return { label: '待执行', tone: 'idle', icon: 'clock' };
  switch (attempt.status) {
    case NodeStatus.PENDING:
      return { label: '待执行', tone: 'idle', icon: 'clock' };
    case NodeStatus.READY:
      return { label: '待执行 · 可开始', tone: 'wait', icon: 'play' };
    case NodeStatus.RUNNING:
      // A stop request is not a stop: until the executor confirms, the attempt
      // may still append records (design N08-cancelling).
      return executionStatus === 'stopping' || executionStatus === 'pausing'
        ? { label: '取消中', tone: 'wait', icon: 'clock' }
        : { label: '执行中', tone: 'run', icon: 'play' };
    case NodeStatus.SUCCEEDED:
      if (acceptance?.state === 'accepted') return { label: '已完成', tone: 'done', icon: 'check' };
      if (acceptance?.state === 'rejected') return { label: '验收未通过', tone: 'fail', icon: 'x' };
      // Design N06: transferred + result submitted is still "执行已结束", never
      // "已完成" before the verdict.
      return { label: '执行已结束', tone: 'idle', icon: 'stop' };
    case NodeStatus.FAILED:
      return { label: '失败', tone: 'fail', icon: 'x' };
    case NodeStatus.CANCELLED:
      return { label: '已取消', tone: 'idle', icon: 'stop' };
    case NodeStatus.SKIPPED:
      return { label: '已移出计划', tone: 'idle', icon: 'archive' };
    case NodeStatus.UNKNOWN:
      return { label: '状态未核对', tone: 'unknown', icon: 'help' };
    default:
      return UNKNOWN_VISUAL;
  }
}

/** Design `RES_ST`: result submission + verification + human acceptance. */
export function resultVisual(attempt: { readonly status: string; readonly result?: Attempt['result'] } | undefined, acceptance?: NodeAcceptanceView): NodeStateVisual {
  if (attempt === undefined) return { label: '未提交', tone: 'idle', icon: 'minus' };
  const revision = attempt.result?.resultRevision;
  const suffix = revision === undefined ? '' : `（结果修订 ${revision}）`;
  if (acceptance !== undefined) {
    if (acceptance.state === 'accepted') return { label: `验收通过${suffix}`, tone: 'done', icon: 'check' };
    if (acceptance.state === 'rejected') return { label: `未通过${suffix}`, tone: 'fail', icon: 'x' };
    return { label: `待人工验收${suffix}`, tone: 'wait', icon: 'eye' };
  }
  if (attempt.result === undefined) {
    if (attempt.status === NodeStatus.FAILED) return { label: '未提交（执行失败）', tone: 'idle', icon: 'minus' };
    if (attempt.status === NodeStatus.CANCELLED) return { label: '未提交（已取消）', tone: 'idle', icon: 'minus' };
    return { label: '未提交', tone: 'idle', icon: 'minus' };
  }
  if (attempt.result.verification?.state === 'failed') return { label: `未通过${suffix}`, tone: 'fail', icon: 'x' };
  // Result exists but no verdict yet: design says "已提交待验收", never "已完成".
  return { label: `已提交待验收${suffix}`, tone: 'wait', icon: 'upload' };
}

/** Design `TOOL_ST` mapped onto the statuses the service actually records. */
export function toolVisual(status: string | undefined, attemptEnded: boolean): NodeStateVisual {
  switch (status) {
    case 'completed':
      return { label: '成功', tone: 'done', icon: 'check' };
    case 'failed':
      return { label: '失败', tone: 'fail', icon: 'x' };
    case 'running':
      return attemptEnded
        // Design N07: an attempt that ended while the call was still running has
        // no recorded result — never keep showing "运行中".
        ? { label: '结果未知', tone: 'unknown', icon: 'help' }
        : { label: '运行中', tone: 'run', icon: 'play' };
    case 'queued':
      return { label: '排队', tone: 'idle', icon: 'clock' };
    case 'cancelled':
    case 'cancel':
      return { label: '已取消', tone: 'idle', icon: 'stop' };
    case 'unknown':
      return { label: '结果未知', tone: 'unknown', icon: 'help' };
    default:
      return UNKNOWN_VISUAL;
  }
}

/** Record block labels from the design mock (design N26 vocabulary). */
export const RECORD_LABEL = {
  modelText: '模型正文',
  reasoning: '公开推理摘要 · 由模型服务提供',
  tool: '工具调用',
  service: '服务事件',
} as const;

export const TOOL_SOURCE_LABEL: Readonly<Record<string, string>> = {
  managed_mcp: '受管 MCP',
  opencode: 'OpenCode 工具',
};

/** Design source explanation shown in the tool detail footer. */
export const TOOL_SOURCE_NOTE: Readonly<Record<string, string>> = {
  managed_mcp: '来自受管 MCP 结算记录',
  opencode: '来自 OpenCode 工具活动记录',
};

export function toolSourceLabel(source: string | undefined): string {
  return source === undefined ? '来源未记录' : (TOOL_SOURCE_LABEL[source] ?? source);
}

/** Defensive read of the record-source capability string sent by the service. */
export function modelTextCapabilityLabel(capability: string | undefined): string {
  if (capability === 'ok') return '有公开正文';
  if (capability === 'forbidden') return '无权读取';
  if (capability === undefined) return '能力未知';
  return '此运行时未提供';
}

/** `[n]` citations only become links when the service sent structured citations. */
export function recordCategoryLabel(fragment: OutputFragment): string {
  switch (fragment.category) {
    case 'model_text':
      return RECORD_LABEL.modelText;
    case 'public_reasoning_summary':
      return RECORD_LABEL.reasoning;
    case 'tool_activity':
      return RECORD_LABEL.tool;
    default:
      return RECORD_LABEL.service;
  }
}
