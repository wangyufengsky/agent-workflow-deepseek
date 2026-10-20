import {
  DELIVERY_PROJECTION_LABEL,
  EXECUTION_STATUS_LABEL,
  NODE_STATUS_LABEL,
  TASK_ATTENTION_LABEL,
  TASK_STAGE_LABEL,
  TaskAttention,
  TaskLifecycle,
  TaskStage,
  type DeliveryProjectionValue,
  type ExecutionView,
  type PlanRevision,
  type Task,
  type TaskAttentionItem,
  type TaskDelivery,
  type TaskWorkspace,
} from '@agent-workflow/shared';
import type { BadgeTone } from '../../components/Badge.tsx';
import type { IconName } from '../../components/Icon.tsx';

/** Situation-bar tint from the design (`situ.wait/need/fail/ok/unk`); '' is the neutral bar. */
export type SituationMode = '' | 'wait' | 'need' | 'fail' | 'ok' | 'unk';

export interface SituationFact {
  readonly key: 'plan' | 'execution' | 'delivery';
  readonly label: string;
  readonly icon: IconName;
  readonly text: string;
  /** Theme-token colour name used by the situation bar. */
  readonly color: 'ink' | 'muted' | 'run' | 'wait' | 'warn' | 'done' | 'unknown' | 'stall';
}

export interface CanvasPrimaryAction {
  readonly label: string;
  readonly icon: IconName;
  readonly kind: 'accept' | 'delivery' | 'inbox' | 'resume' | 'reread' | 'recovery' | 'focus';
  readonly nodeId?: string;
}

export interface CanvasSituation {
  readonly mode: SituationMode;
  readonly status: { readonly label: string; readonly icon: IconName; readonly tone: BadgeTone };
  readonly facts: readonly SituationFact[];
  readonly primary?: CanvasPrimaryAction;
  /** Extra design badge, e.g. "验证未通过" or "N 个步骤待人工验收". */
  readonly secondary?: { readonly label: string; readonly icon: IconName; readonly tone: BadgeTone };
}

const DELIVERY_FACT_TONE: Record<DeliveryProjectionValue, { readonly color: SituationFact['color']; readonly icon: IconName }> = {
  awaiting_selection: { color: 'wait', icon: 'clock' },
  awaiting_confirmation: { color: 'wait', icon: 'clock' },
  in_progress: { color: 'run', icon: 'play' },
  blocked: { color: 'stall', icon: 'lock' },
  unknown_receipt: { color: 'unknown', icon: 'help' },
  delivered: { color: 'done', icon: 'check' },
};

const EXECUTION_STATUS_ICON: Record<string, IconName> = {
  idle: 'clock',
  ready: 'play',
  running: 'play',
  pausing: 'pause',
  paused: 'pause',
  waiting_confirmation: 'refresh',
  stopping: 'stop',
  stopped: 'stop',
  completed: 'check',
  failed: 'x',
  unknown: 'help',
};

function nodeTitle(plan: PlanRevision | undefined, nodeId: string): string {
  return plan?.graph.nodes.find((node) => node.id === nodeId)?.title ?? nodeId;
}

function runTitles(plan: PlanRevision | undefined, execution: ExecutionView | undefined): readonly string[] {
  if (execution === undefined) return [];
  return execution.nodes.filter((node) => node.status === 'running').map((node) => nodeTitle(plan, node.nodeId));
}

function failedNode(execution: ExecutionView | undefined): { readonly nodeId: string; readonly code?: string; readonly message?: string } | undefined {
  const node = execution?.nodes.find((item) => item.status === 'failed');
  if (node === undefined) return undefined;
  return { nodeId: node.nodeId, ...(node.error === undefined ? {} : { code: node.error.code, message: node.error.message }) };
}

/**
 * P13-01/P13-02: the canvas situation bar is derived from two independent service
 * facts — 执行与验收 (ExecutionView) and 交付 (TaskDelivery + task lifecycle).
 *
 * A finished execution is NEVER presented as a green "任务已完成": the outer
 * status stays wait「执行已结束 · 等待交付」until the service read model says the
 * task is delivered (lifecycle completed / delivery projection delivered).
 */
export function deriveCanvasSituation(input: {
  readonly task: Task;
  readonly plan?: PlanRevision;
  readonly execution?: ExecutionView;
  readonly delivery?: TaskDelivery;
  readonly workspace?: TaskWorkspace;
  readonly attentionItems?: readonly TaskAttentionItem[];
  readonly editSession?: ExecutionView['editSession'];
}): CanvasSituation {
  const { task, plan, execution, delivery, attentionItems } = input;
  const editSession = input.editSession ?? execution?.editSession;
  const lifecycle = task.lifecycle;
  const delivered = lifecycle === TaskLifecycle.COMPLETED || delivery?.projection === 'delivered';
  const cancelled = lifecycle === TaskLifecycle.CANCELLED;
  const pendingAcceptance = execution?.acceptance?.pending.length ?? 0;
  const rejectedAcceptance = execution?.acceptance?.rejected.length ?? 0;
  const status = execution?.status;
  const failed = failedNode(execution);

  let mode: SituationMode = '';
  let head: CanvasSituation['status'];
  if (task.readOnly === true) {
    head = { label: '只读验证', icon: 'lock', tone: 'idle' };
  } else if (delivered) {
    head = { label: '任务已交付', icon: 'check', tone: 'done' };
    mode = 'ok';
  } else if (cancelled) {
    head = { label: '已取消', icon: 'stop', tone: 'idle' };
  } else if (delivery?.projection !== undefined) {
    const label = DELIVERY_PROJECTION_LABEL[delivery.projection];
    head = { label, icon: DELIVERY_FACT_TONE[delivery.projection].icon, tone: delivery.projection === 'unknown_receipt' ? 'unknown' : delivery.projection === 'blocked' ? 'stall' : delivery.projection === 'in_progress' ? 'run' : 'wait' };
    mode = delivery.projection === 'unknown_receipt' ? 'unk' : delivery.projection === 'blocked' ? 'need' : delivery.projection === 'in_progress' ? 'wait' : 'wait';
  } else if (status === 'completed') {
    // P13-01: the execution finished, but delivery has not been settled. This is
    // a wait fact — not a green task completion.
    head = { label: '执行已结束 · 等待交付', icon: 'clock', tone: 'wait' };
    mode = 'wait';
  } else if (pendingAcceptance > 0) {
    head = { label: '待人工验收', icon: 'eye', tone: 'wait' };
    mode = 'wait';
  } else if (status === 'failed') {
    head = { label: '有步骤失败', icon: 'x', tone: 'fail' };
    mode = 'fail';
  } else if (status === 'unknown') {
    head = { label: '状态待核对', icon: 'help', tone: 'unknown' };
    mode = 'unk';
  } else if (status === 'paused') {
    head = { label: '已暂停', icon: 'pause', tone: 'idle' };
  } else if (status === 'waiting_confirmation') {
    head = { label: '等待重新确认', icon: 'refresh', tone: 'wait' };
    mode = 'wait';
  } else if (status === 'running') {
    head = { label: '执行中', icon: 'play', tone: 'run' };
    mode = '';
  } else if (task.stage === TaskStage.PLANNING && plan === undefined) {
    head = { label: TASK_STAGE_LABEL[task.stage], icon: 'sparkle', tone: 'accent' };
  } else if (task.attention !== TaskAttention.NONE) {
    head = {
      label: TASK_ATTENTION_LABEL[task.attention],
      icon: task.attention === 'failed' ? 'x' : task.attention === 'blocked' ? 'alert' : 'help',
      tone: task.attention === 'failed' ? 'fail' : task.attention === 'blocked' ? 'stall' : task.attention === 'unknown' ? 'unknown' : 'wait',
    };
    mode = task.attention === 'failed' ? 'fail' : task.attention === 'unknown' ? 'unk' : 'need';
  } else if (status === 'stopping' || status === 'pausing') {
    head = { label: EXECUTION_STATUS_LABEL[status], icon: EXECUTION_STATUS_ICON[status] ?? 'clock', tone: 'wait' };
    mode = 'wait';
  } else {
    head = { label: TASK_STAGE_LABEL[task.stage], icon: 'clock', tone: 'idle' };
  }

  // ---- fact 1: 执行与验收 -------------------------------------------------
  let executionFact: SituationFact;
  const total = execution?.progress.total ?? plan?.graph.nodes.length ?? 0;
  const done = execution?.progress.done ?? 0;
  if (task.readOnly === true) {
    executionFact = { key: 'execution', label: '执行与验收', icon: 'lock', color: 'muted', text: '只读验证：核对父任务已有产物，不创建新的执行或工作区' };
  } else if (execution === undefined) {
    executionFact = { key: 'execution', label: '执行与验收', icon: 'clock', color: 'muted', text: '尚未开始执行；确认计划并准备独立工作区后开始' };
  } else if (status === 'completed') {
    executionFact = {
      key: 'execution',
      label: '执行与验收',
      icon: 'check',
      color: 'done',
      text: pendingAcceptance > 0
        ? `执行已结束 · ${String(total)} / ${String(total)} 步已执行，剩余 ${String(pendingAcceptance)} 步待人工验收`
        : `执行已结束 · ${String(total)} / ${String(total)} 步通过验收`,
    };
  } else if (status === 'running') {
    const running = runTitles(plan, execution);
    executionFact = {
      key: 'execution',
      label: '执行与验收',
      icon: 'play',
      color: 'run',
      text: running.length === 0 ? '等待调度领取下一步' : `${running.map((title) => `「${title}」`).join('、')} 执行中${running.length > 1 ? '（并行）' : ''} · ${String(done)} / ${String(total)} 步已通过验收`,
    };
  } else if (status === 'paused') {
    executionFact = {
      key: 'execution',
      label: '执行与验收',
      icon: 'pause',
      color: 'muted',
      text: `任务已暂停 · ${String(done)} / ${String(total)} 步已通过验收；运行中的步骤已停在安全点`,
    };
  } else if (status === 'waiting_confirmation') {
    executionFact = {
      key: 'execution',
      label: '执行与验收',
      icon: 'refresh',
      color: 'wait',
      text: `计划已变更，后续步骤等待重新确认 · ${String(done)} / ${String(total)} 步已通过验收`,
    };
  } else if (status === 'failed') {
    const title = failed === undefined ? '某一步' : nodeTitle(plan, failed.nodeId);
    const reason = failed?.message === undefined || failed.message.length === 0 ? (failed?.code ?? '服务报告执行失败') : failed.message;
    executionFact = {
      key: 'execution',
      label: '执行与验收',
      icon: 'x',
      color: 'warn',
      text: `「${title}」失败：${reason} · ${String(done)} / ${String(total)} 步已通过验收`,
    };
  } else if (status === 'unknown') {
    executionFact = {
      key: 'execution',
      label: '执行与验收',
      icon: 'help',
      color: 'unknown',
      text: `状态未核对 · 画布保留上次读取的进度（${String(done)} / ${String(total)} 步）；核对前不能修改或恢复`,
    };
  } else if (status === 'stopped') {
    executionFact = {
      key: 'execution',
      label: '执行与验收',
      icon: 'stop',
      color: 'muted',
      text: `执行已停止 · ${String(done)} / ${String(total)} 步已通过验收`,
    };
  } else if (status === 'stopping' || status === 'pausing') {
    executionFact = {
      key: 'execution',
      label: '执行与验收',
      icon: 'pause',
      color: 'wait',
      text: `${EXECUTION_STATUS_LABEL[status]} · ${String(done)} / ${String(total)} 步已通过验收`,
    };
  } else {
    executionFact = {
      key: 'execution',
      label: '执行与验收',
      icon: 'clock',
      color: 'muted',
      text: `${status === undefined ? EXECUTION_STATUS_LABEL.idle : EXECUTION_STATUS_LABEL[status]} · ${String(done)} / ${String(total)} 步已通过验收`,
    };
  }

  // ---- fact 2: 交付 -------------------------------------------------------
  let deliveryFact: SituationFact;
  if (task.readOnly === true) {
    deliveryFact = { key: 'delivery', label: '交付', icon: 'lock', color: 'muted', text: '只读验证不创建交付；请到父任务查看交付回执' };
  } else if (delivered) {
    const verificationFailed = delivery?.verificationOutcome === 'failed';
    const goal = delivery?.goal;
    const detailText = delivery?.projectionReason ?? (goal === 'apply_to_original' ? '应用回执已记录' : goal === 'create_merge_request' ? '合并请求已创建（未合并）' : '交付回执已记录');
    deliveryFact = {
      key: 'delivery',
      label: '交付',
      icon: verificationFailed ? 'alert' : 'check',
      color: verificationFailed ? 'warn' : 'done',
      text: verificationFailed ? `已交付，验证未通过 · ${detailText}` : `任务已交付 · ${detailText}`,
    };
  } else if (delivery?.projection !== undefined) {
    const tone = DELIVERY_FACT_TONE[delivery.projection];
    deliveryFact = {
      key: 'delivery',
      label: '交付',
      icon: tone.icon,
      color: tone.color,
      text: `${DELIVERY_PROJECTION_LABEL[delivery.projection]}${delivery.projectionReason === undefined ? '' : ` · ${delivery.projectionReason}`}`,
    };
  } else if (status === 'completed') {
    deliveryFact = {
      key: 'delivery',
      label: '交付',
      icon: 'clock',
      color: 'wait',
      text: '等待交付 · 执行已结束，请在「交付」端点选择交付目标（合并请求 / 应用回原目录 / 仅本地提交）',
    };
  } else {
    deliveryFact = {
      key: 'delivery',
      label: '交付',
      icon: 'clock',
      color: 'muted',
      text: '未到达 · 执行结束后在「交付」端点选择交付目标',
    };
  }

  const facts: SituationFact[] = [executionFact, deliveryFact];

  // ---- fact 0: 调整中的计划（仅调整会话存在时） ---------------------------
  if (editSession !== undefined && !['finished', 'abandoned'].includes(editSession.state)) {
    const revision = plan?.revisionNumber === undefined ? '—' : String(plan.revisionNumber);
    const stateText = editSession.state === 'conflict'
      ? '保存遇到领取竞态 · 本地草稿保留，重新读取并比对后才能保存'
      : editSession.state === 'saved'
        ? `计划修订 ${revision} 未确认 · 等待重新确认（确认后才出现继续执行）`
        : `已暂停新增领取 · 编辑待执行区（基于修订 ${revision}）· 调整前自动推进 ${editSession.autoAdvanceBeforeEdit ? '开启' : '关闭'}`;
    facts.unshift({ key: 'plan', label: '计划', icon: 'edit', color: editSession.state === 'conflict' ? 'warn' : editSession.state === 'saved' ? 'wait' : 'wait', text: stateText });
  }

  // ---- primary action (design: one nearest action per state) ---------------
  let primary: CanvasPrimaryAction | undefined;
  if (task.readOnly !== true && editSession === undefined) {
    if (pendingAcceptance > 0) primary = { label: '去验收', icon: 'check', kind: 'accept', ...(execution?.acceptance?.pending[0] === undefined ? {} : { nodeId: execution.acceptance.pending[0] }) };
    else if (delivery?.projection === 'awaiting_selection') primary = { label: '打开交付', icon: 'inbox', kind: 'delivery' };
    else if (delivery?.projection === 'unknown_receipt') primary = { label: '打开交付 · 核对回执', icon: 'inbox', kind: 'delivery' };
    else if (status === 'completed') primary = { label: '打开交付', icon: 'inbox', kind: 'delivery' };
    else if (status === 'paused' && execution?.pause?.requestKey !== undefined) primary = { label: '恢复任务', icon: 'play', kind: 'resume' };
    else if (status === 'failed' && failed !== undefined) primary = { label: '查看原因并恢复', icon: 'target', kind: 'focus', nodeId: failed.nodeId };
    else if (status === 'unknown') primary = { label: '立即重新读取', icon: 'refresh', kind: 'reread' };
    else if ((attentionItems ?? []).some((item) => item.kind.startsWith('runtime_'))) primary = { label: '去待处理中心', icon: 'inbox', kind: 'inbox' };
    else if (status === 'stopped') primary = { label: '任务恢复…', icon: 'refresh', kind: 'recovery' };
  }

  // ---- secondary badges (P13-01/P13-04: delivered-verification & acceptance) -
  let secondary: CanvasSituation['secondary'];
  if (delivered && delivery?.verificationOutcome === 'failed') secondary = { label: '交付 · 验证未通过', icon: 'alert', tone: 'warn' };
  else if (pendingAcceptance > 0 && status !== 'completed') secondary = { label: `${String(pendingAcceptance)} 步待人工验收`, icon: 'eye', tone: 'wait' };
  else if (rejectedAcceptance > 0) secondary = { label: `${String(rejectedAcceptance)} 步已退回修改`, icon: 'undo', tone: 'fail' };
  else if ((attentionItems ?? []).some((item) => item.kind.startsWith('runtime_'))) secondary = { label: '等待你处理', icon: 'help', tone: 'wait' };

  return { mode, status: head, facts, ...(primary === undefined ? {} : { primary }), ...(secondary === undefined ? {} : { secondary }) };
}

/** Short node status label used by the situation bar fact list. */
export function nodeStatusLabel(status: string): string {
  const table = NODE_STATUS_LABEL as Record<string, string>;
  return table[status] ?? status;
}
