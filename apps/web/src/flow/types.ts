import type { NodeDiffKind, NodeKindValue, NodeStatusValue, PlanEdgeKind, PlanLayerValue, PlanNodeId } from '@agent-workflow/shared';
import type { BadgeTone } from '../components/Badge.tsx';
import type { IconName } from '../components/Icon.tsx';

/** One card on the plan / execution canvas. All fields derive from service data. */
export interface FlowNodeView {
  readonly id: PlanNodeId;
  readonly title: string;
  readonly kind: NodeKindValue;
  readonly groupId: string;
  readonly groupLabel?: string;
  readonly summary?: string;
  readonly status?: NodeStatusValue;
  /** Plan revision / candidate / layer annotation shown as a pill. */
  readonly badgeLabel?: string;
  readonly badgeTone?: BadgeTone;
  readonly badgeIcon?: IconName;
  /** Fixed-template or execution-edit lock: never a fake state, always a service fact. */
  readonly lock?: boolean;
  readonly lockReason?: string;
  readonly diff?: NodeDiffKind;
  readonly flag?: 'block' | 'warn';
  readonly meta?: string;
  readonly roleLabel?: string;
  readonly dimmed?: boolean;
  readonly servicePosition?: { readonly x: number; readonly y: number };
  readonly inputCount?: number;
  readonly outputCount?: number;
  readonly acceptanceCount?: number;
}

export interface FlowEdgeView {
  readonly id: string;
  readonly from: PlanNodeId;
  readonly to: PlanNodeId;
  readonly kind: PlanEdgeKind;
  readonly label?: string;
  readonly state?: 'normal' | 'done' | 'live' | 'bad' | 'candidate' | 'removed';
}

export interface FlowGroupView {
  readonly id: string;
  readonly label: string;
  readonly kind: string;
  readonly refined: boolean;
  readonly nodeCount: number;
  readonly tone?: 'default' | 'scope' | 'unrefined';
}

export interface FlowGraphView {
  readonly nodes: readonly FlowNodeView[];
  readonly edges: readonly FlowEdgeView[];
  readonly groups: readonly FlowGroupView[];
}

export const EMPTY_FLOW_GRAPH: FlowGraphView = { nodes: [], edges: [], groups: [] };

export interface FlowLayerOption {
  readonly value: PlanLayerValue;
  readonly label: string;
  /** Service-derived reason when the layer cannot be shown (kept visible, never silently hidden). */
  readonly disabledReason?: string;
}

export const NODE_KIND_LABEL: Record<NodeKindValue, string> = {
  requirement: '需求',
  design: '设计',
  implementation: '实现',
  test: '测试',
  verify: '验收',
  delivery: '交付',
  system: '系统',
};

export const NODE_KIND_TONE: Record<NodeKindValue, string> = {
  requirement: 'k-requirement',
  design: 'k-design',
  implementation: 'k-implementation',
  test: 'k-test',
  verify: 'k-verify',
  delivery: 'k-delivery',
  system: 'k-system',
};

export const NODE_STATUS_TONE: Record<NodeStatusValue, string> = {
  pending: 's-pending',
  ready: 's-ready',
  running: 's-run',
  succeeded: 's-done',
  failed: 's-fail',
  skipped: 's-skip',
  cancelled: 's-skip',
  unknown: 's-unknown',
};

export const EDGE_KIND_LABEL: Record<PlanEdgeKind, string> = {
  data: '数据',
  order: '顺序',
  resource: '资源',
};

export const DIFF_LABEL: Record<NodeDiffKind, string> = {
  added: '新增',
  modified: '修改',
  replaced_by_refinement: '细化替换',
  unchanged: '未变',
};

export const DIFF_TONE: Record<NodeDiffKind, BadgeTone> = {
  added: 'ok',
  modified: 'accent',
  replaced_by_refinement: 'wait',
  unchanged: 'idle',
};
