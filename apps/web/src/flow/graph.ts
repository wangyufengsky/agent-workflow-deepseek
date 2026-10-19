import {
  NODE_TERMINAL_STATUSES,
  NodeStatus,
  NodeKind,
  NODE_STATUS_LABEL,
  PlanRevisionStatus,
  type ExecutionView,
  type NodeDiff,
  type NodeKindValue,
  type NodeStatusValue,
  type PlanNode,
  type PlanProblem,
  type PlanRevision,
  type PlanLayerValue,
} from '@agent-workflow/shared';
import type { IconName } from '../components/Icon.tsx';
import type { BadgeTone } from '../components/Badge.tsx';
import type { FlowEdgeView, FlowGraphView, FlowGroupView, FlowNodeView } from './types.ts';

export interface PlanGraphLayerOptions {
  readonly layer: PlanLayerValue;
  readonly execution?: ExecutionView;
  readonly diff?: readonly NodeDiff[];
  readonly problems?: readonly PlanProblem[];
  readonly lockedNodeIds?: readonly string[];
  readonly lockedReason?: string;
  /** Node-level pill used by the plan layer (plan revision / candidate / checkpoint). */
  readonly badge?: { readonly label: string; readonly tone: BadgeTone; readonly icon: IconName };
  /** Groups reported as missing by a checkpoint; drawn as dashed gap cards, never as steps. */
  readonly missingGroups?: readonly string[];
  /** Compare layer dims the unchanged nodes. */
  readonly dimUnchanged?: boolean;
}

const EXEC_STATUS_TONE: Record<NodeStatusValue, BadgeTone> = {
  pending: 'neutral',
  ready: 'wait',
  running: 'run',
  succeeded: 'done',
  failed: 'fail',
  skipped: 'idle',
  cancelled: 'idle',
  unknown: 'unknown',
};

const EXEC_STATUS_ICON: Record<NodeStatusValue, IconName> = {
  pending: 'clock',
  ready: 'clock',
  running: 'play',
  succeeded: 'check',
  failed: 'x',
  skipped: 'stop',
  cancelled: 'stop',
  unknown: 'help',
};

const KIND_GROUPS: Record<string, string> = {
  requirement: '需求',
  design: '设计',
  implementation: '实现',
  test: '测试',
  verify: '验收',
  delivery: '交付',
  system: '系统',
};

function groupIdsFor(plan: PlanRevision): Map<string, string> {
  return new Map(plan.graph.groups.map((group) => [group.id, group.label]));
}

function diffByKey(diff: readonly NodeDiff[] | undefined): Map<string, NodeDiff['kind']> {
  const map = new Map<string, NodeDiff['kind']>();
  for (const item of diff ?? []) map.set(item.nodeKey, item.kind);
  return map;
}

function problemsByNode(problems: readonly PlanProblem[] | undefined): Map<string, 'block' | 'warn'> {
  const map = new Map<string, 'block' | 'warn'>();
  for (const problem of problems ?? []) {
    if (problem.nodeId === undefined) continue;
    if (problem.severity === 'hard') map.set(problem.nodeId, 'block');
    else if (!map.has(problem.nodeId)) map.set(problem.nodeId, 'warn');
  }
  return map;
}

function planNodeToView(
  node: PlanNode,
  plan: PlanRevision,
  options: PlanGraphLayerOptions,
  context: {
    readonly groups: Map<string, string>;
    readonly diff: Map<string, NodeDiff['kind']>;
    readonly flags: Map<string, 'block' | 'warn'>;
    readonly execution?: Map<string, ExecutionView['nodes'][number]>;
    readonly locked: ReadonlySet<string>;
  },
): FlowNodeView {
  const executionNode = context.execution?.get(node.id);
  const diff = context.diff.get(node.key);
  const missingHint = plan.status === PlanRevisionStatus.DRAFT ? '候选 · 未应用（只读）' : undefined;
  const execStatus = executionNode?.status;
  const badgeLabel = options.badge?.label ?? missingHint ?? (execStatus === undefined ? undefined : NODE_STATUS_LABEL[execStatus]);
  const badgeTone = options.badge?.tone ?? (execStatus === undefined ? 'idle' : EXEC_STATUS_TONE[execStatus]);
  const badgeIcon = options.badge?.icon ?? (execStatus === undefined ? 'file' : EXEC_STATUS_ICON[execStatus]);

  const meta =
    options.layer === 'current' || options.layer === 'partial' || options.layer === 'candidate' || options.layer === 'compare'
      ? context.groups.get(node.groupId) ?? KIND_GROUPS[node.kind] ?? '未分组'
      : executionNode === undefined
        ? '尚未开始'
        : executionNode.error !== undefined
          ? `${executionNode.error.code} · ${executionNode.error.message}`
          : executionNode.attemptCount > 0
            ? `尝试 ${String(executionNode.attemptCount)} 次`
            : '尚未开始';

  return {
    id: node.id,
    title: node.title,
    kind: node.kind,
    groupId: node.groupId,
    groupLabel: context.groups.get(node.groupId),
    summary: node.summary,
    status: executionNode?.status,
    badgeLabel,
    badgeTone,
    badgeIcon,
    lock: context.locked.has(node.id),
    lockReason: context.locked.has(node.id) ? options.lockedReason : undefined,
    diff,
    flag: context.flags.get(node.id),
    meta,
    servicePosition: node.position,
    inputCount: node.inputs.length,
    outputCount: node.outputs.length,
    acceptanceCount: node.acceptance.length,
    dimmed: options.dimUnchanged === true && diff === 'unchanged',
  };
}

function edgeState(
  layer: PlanLayerValue,
  from: PlanNode,
  to: PlanNode,
  execution: ReadonlyMap<string, ExecutionView['nodes'][number]> | undefined,
  diff: ReadonlyMap<string, NodeDiff['kind']>,
): FlowEdgeView['state'] {
  if (layer === 'compare') {
    const fromDiff = diff.get(from.key);
    const toDiff = diff.get(to.key);
    if (fromDiff === 'replaced_by_refinement' || toDiff === 'replaced_by_refinement') return 'removed';
    if (fromDiff === 'added' || toDiff === 'added' || fromDiff === 'modified' || toDiff === 'modified') return 'candidate';
    return 'normal';
  }
  if (execution === undefined) return 'normal';
  const fromStatus = execution.get(from.id)?.status ?? NodeStatus.PENDING;
  const toStatus = execution.get(to.id)?.status ?? NodeStatus.PENDING;
  if (toStatus === NodeStatus.FAILED) return 'bad';
  if (toStatus === NodeStatus.RUNNING || fromStatus === NodeStatus.RUNNING) return 'live';
  if (NODE_TERMINAL_STATUSES.includes(fromStatus) && toStatus === NodeStatus.SUCCEEDED) return 'done';
  return 'normal';
}

/**
 * Builds the canvas view from a real `PlanRevision` read model.
 * No synthetic nodes or edges: missing checkpoint groups become labelled gap cards
 * and unknown execution statuses stay `unknown`.
 */
export function planRevisionToFlow(plan: PlanRevision, options: PlanGraphLayerOptions): FlowGraphView {
  const groups = groupIdsFor(plan);
  const diff = diffByKey(options.diff);
  const flags = problemsByNode(options.problems ?? plan.validation?.structural.problems);
  const locked = new Set(options.lockedNodeIds ?? []);
  const execution = options.execution === undefined ? undefined : new Map(options.execution.nodes.map((node) => [node.nodeId, node]));

  const context = { groups, diff, flags, execution, locked };
  const nodes: FlowNodeView[] = plan.graph.nodes.map((node) => planNodeToView(node, plan, options, context));

  const groupViews: FlowGroupView[] = plan.graph.groups.map((group) => {
    const count = plan.graph.nodes.filter((node) => node.groupId === group.id).length;
    const missing = (options.missingGroups ?? []).includes(group.label);
    return {
      id: group.id,
      label: group.label,
      kind: group.kind,
      refined: group.refined && !missing,
      nodeCount: count,
      tone: missing ? 'unrefined' : 'default',
    };
  });

  for (const label of options.missingGroups ?? []) {
    if (groupViews.some((group) => group.label === label)) continue;
    const groupId = `gap-group:${label}`;
    groupViews.push({ id: groupId, label, kind: 'gap', refined: false, nodeCount: 1, tone: 'unrefined' });
    nodes.push({
      id: `gap:${label}`,
      title: `缺口：${label}`,
      kind: NodeKind.SYSTEM,
      groupId,
      groupLabel: label,
      summary: '服务保存的检查点缺少这个分组；这里没有生成任何步骤',
      badgeLabel: '缺口',
      badgeTone: 'unknown',
      badgeIcon: 'alert',
      flag: 'warn',
      meta: '部分草稿 · 尚未完成，不能执行',
      inputCount: 0,
      outputCount: 0,
    });
  }

  const nodeById = new Map(plan.graph.nodes.map((node) => [node.id, node]));
  const edges: FlowEdgeView[] = [];
  for (const edge of plan.graph.edges) {
    const from = nodeById.get(edge.from);
    const to = nodeById.get(edge.to);
    if (from === undefined || to === undefined) continue;
    edges.push({
      id: edge.id,
      from: edge.from,
      to: edge.to,
      kind: edge.kind,
      label: edge.label,
      state: edgeState(options.layer, from, to, execution, diff),
    });
  }

  return { nodes, edges, groups: groupViews };
}

/** Execution canvas: node cards carry real `ExecutionNodeState` statuses. */
export function executionToFlow(plan: PlanRevision, execution: ExecutionView): FlowGraphView {
  return planRevisionToFlow(plan, { layer: 'current', execution, missingGroups: [] });
}

export function kindGroupLabel(kind: NodeKindValue): string {
  return KIND_GROUPS[kind] ?? '未分组';
}
