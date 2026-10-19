import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { NODE_STATUS_LABEL, TASK_ATTENTION_LABEL } from '@agent-workflow/shared';
import { Badge, type BadgeTone } from '../components/Badge.tsx';
import { Icon, type IconName } from '../components/Icon.tsx';
import type { PositionedFlowFrame } from './layout.ts';
import { DIFF_LABEL, DIFF_TONE, NODE_KIND_LABEL, NODE_KIND_TONE, NODE_STATUS_TONE, type FlowNodeView } from './types.ts';

export type PlanNodeData = {
  kind: 'planNode';
  view: FlowNodeView;
};

export type PlanNodeType = Node<PlanNodeData, 'planNode'>;

export type GroupFrameData = {
  kind: 'groupFrame';
  frame: PositionedFlowFrame;
  collapsed: boolean;
  onToggleGroup?: (groupId: string) => void;
};

export type GroupFrameType = Node<GroupFrameData, 'groupFrame'>;

export type GroupSummaryData = {
  kind: 'groupSummary';
  frame: PositionedFlowFrame;
  onToggleGroup?: (groupId: string) => void;
};

export type GroupSummaryType = Node<GroupSummaryData, 'groupSummary'>;

export type FlowCanvasNode = PlanNodeType | GroupFrameType | GroupSummaryType;

function statusBadge(view: FlowNodeView): { label: string; tone: BadgeTone; icon: IconName } | undefined {
  if (view.badgeLabel !== undefined) {
    return { label: view.badgeLabel, tone: view.badgeTone ?? 'neutral', icon: view.badgeIcon ?? 'info' };
  }
  if (view.status === undefined) return undefined;
  const tone: BadgeTone =
    view.status === 'running'
      ? 'run'
      : view.status === 'succeeded'
        ? 'done'
        : view.status === 'failed'
          ? 'fail'
          : view.status === 'unknown'
            ? 'unknown'
            : view.status === 'ready'
              ? 'wait'
              : view.status === 'skipped' || view.status === 'cancelled'
                ? 'idle'
                : 'neutral';
  const icon: IconName =
    view.status === 'running' ? 'play' : view.status === 'succeeded' ? 'check' : view.status === 'failed' ? 'x' : view.status === 'unknown' ? 'help' : 'clock';
  return { label: NODE_STATUS_LABEL[view.status], tone, icon };
}

function lockTitle(view: FlowNodeView): string | undefined {
  if (view.lock !== true) return undefined;
  return view.lockReason ?? '固定模板：此步骤创建后不能修改';
}

/** Plan / execution node card. Every state shown here comes from the service read model. */
export function PlanNodeCard({ data, selected }: NodeProps<PlanNodeType>) {
  const view = data.view;
  const badge = statusBadge(view);
  const classes = [
    'flow-node',
    NODE_KIND_TONE[view.kind],
    view.status === undefined ? '' : NODE_STATUS_TONE[view.status],
    selected ? 'sel' : '',
    view.diff === undefined || view.diff === 'unchanged' ? '' : `d-${view.diff}`,
    view.flag === 'block' ? 'flag-block' : view.flag === 'warn' ? 'flag-warn' : '',
    view.lock === true ? 'locked' : '',
    view.dimmed === true ? 'dim' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={classes} data-node-id={view.id} title={lockTitle(view)}>
      <Handle type="target" position={Position.Left} className="flow-handle" isConnectable={false} />
      <div className="flow-node-top">
        <span className="flow-kind">{NODE_KIND_LABEL[view.kind]}</span>
        {view.lock === true ? (
          <span className="flow-lock" aria-label={lockTitle(view)}>
            <Icon name="lock" size="sm" />
          </span>
        ) : null}
        {badge === undefined ? null : (
          <Badge tone={badge.tone} icon={badge.icon} className="flow-node-badge">
            {badge.label}
          </Badge>
        )}
      </div>
      <div className="flow-node-title">
        {view.title}
        {view.diff === undefined || view.diff === 'unchanged' ? null : <span className={`flow-diff d-${view.diff}`}>{DIFF_LABEL[view.diff]}</span>}
      </div>
      <div className="flow-node-meta">{view.meta ?? view.summary ?? view.groupLabel ?? '—'}</div>
      <div className="flow-node-foot">
        <span className="flow-node-stat">
          <Icon name="arrowRight" size="sm" />
          {view.inputCount ?? 0} 入 / {view.outputCount ?? 0} 出
        </span>
        {view.acceptanceCount !== undefined && view.acceptanceCount > 0 ? (
          <span className="flow-node-stat">
            <Icon name="check" size="sm" />
            {view.acceptanceCount} 条验收
          </span>
        ) : null}
        {view.roleLabel === undefined ? null : <span className="flow-node-role">{view.roleLabel}</span>}
      </div>
      <Handle type="source" position={Position.Right} className="flow-handle" isConnectable={false} />
    </div>
  );
}

/** Display-only group frame: a range index around member cards, never an execution node. */
export function GroupFrameNode({ data }: NodeProps<GroupFrameType>) {
  const { frame } = data;
  return (
    <div className={`flow-frame tone-${frame.tone ?? 'default'}${frame.refined ? '' : ' unrefined'}`}>
      <div className="flow-frame-head">
        <button
          type="button"
          className="flow-frame-title nodrag"
          aria-expanded={!data.collapsed}
          onClick={(event) => {
            event.stopPropagation();
            data.onToggleGroup?.(frame.id);
          }}
        >
          <Icon name="chevDown" size="sm" />
          {frame.label}
        </button>
        <span className="flow-frame-count">{frame.nodeCount} 步</span>
        {frame.refined ? null : <Badge tone="unknown">未细化</Badge>}
      </div>
    </div>
  );
}

export function GroupSummaryNode({ data }: NodeProps<GroupSummaryType>) {
  const { frame } = data;
  return (
    <div className="flow-node flow-group-summary">
      <div className="flow-node-top">
        <span className="flow-kind">分组</span>
        <Badge tone="idle" icon="layers">
          已折叠
        </Badge>
      </div>
      <div className="flow-node-title">{frame.label}</div>
      <div className="flow-node-meta">
        {frame.nodeCount} 个步骤 · {frame.refined ? '已细化' : '未细化'}
      </div>
      <button
        type="button"
        className="flow-node-expand nodrag"
        onClick={(event) => {
          event.stopPropagation();
          data.onToggleGroup?.(frame.id);
        }}
      >
        <Icon name="chevRight" size="sm" />
        展开分组
      </button>
    </div>
  );
}

/** Shared label used by the right panel when it lists locked nodes. */
export function nodeLockReason(view: FlowNodeView): string {
  return view.lockReason ?? '该步骤已锁定，不能修改';
}

export const FLOW_STATUS_TEXT = NODE_STATUS_LABEL;
export const FLOW_ATTENTION_TEXT = TASK_ATTENTION_LABEL;
