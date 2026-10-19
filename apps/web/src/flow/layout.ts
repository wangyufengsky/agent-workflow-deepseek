import type { PlanNodeId } from '@agent-workflow/shared';
import type { FlowEdgeView, FlowGraphView, FlowGroupView, FlowNodeView } from './types.ts';

export const FLOW_NODE_WIDTH = 236;
export const FLOW_NODE_HEIGHT = 104;
const COLUMN_GAP = 300;
const LANE_HEADER = 52;
const LANE_GAP = 26;
const LANE_PAD = 20;

export interface PositionedFlowNode {
  readonly view: FlowNodeView;
  readonly x: number;
  readonly y: number;
}

export interface PositionedFlowFrame extends FlowGroupView {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface FlowLayout {
  readonly nodes: readonly PositionedFlowNode[];
  readonly frames: readonly PositionedFlowFrame[];
}

/**
 * Deterministic canvas layout.
 * - service-provided `position` always wins (the service stores it so re-reads keep the view),
 * - otherwise nodes flow left→right by dependency depth and groups become horizontal lanes,
 * - group frames are computed from their member cards (display-only, never execution nodes).
 */
export function layoutFlowGraph(graph: FlowGraphView): FlowLayout {
  if (graph.nodes.length === 0) return { nodes: [], frames: [] };

  const nodeIds = new Set(graph.nodes.map((node) => node.id));
  const depth = dependencyDepth(graph.nodes.map((node) => node.id), graph.edges, nodeIds);
  const sortedGroups = [...graph.groups];

  const laneByGroup = new Map<string, number>();
  for (const [index, group] of sortedGroups.entries()) laneByGroup.set(group.id, index);

  const nodesByGroup = new Map<string, FlowNodeView[]>();
  for (const node of graph.nodes) {
    const key = laneByGroup.has(node.groupId) ? node.groupId : '__ungrouped__';
    const list = nodesByGroup.get(key) ?? [];
    list.push(node);
    nodesByGroup.set(key, list);
  }

  const positioned: PositionedFlowNode[] = [];
  const frameBoxes = new Map<string, { minX: number; maxX: number; minY: number; maxY: number; count: number }>();

  const hasServicePositions = graph.nodes.every((node) => node.servicePosition !== undefined);
  if (hasServicePositions) {
    for (const node of graph.nodes) {
      const point = node.servicePosition ?? { x: 0, y: 0 };
      positioned.push({ view: node, x: point.x, y: point.y });
      expand(frameBoxes, node.groupId, point.x, point.y);
    }
  } else {
    let laneTop = 20;
    const laneOrder = [...sortedGroups.map((group) => group.id), ...(nodesByGroup.has('__ungrouped__') ? ['__ungrouped__'] : [])];
    for (const groupId of laneOrder) {
      const members = nodesByGroup.get(groupId) ?? [];
      if (members.length === 0) continue;
      const ordered = [...members].sort((a, b) => (depth.get(a.id) ?? 0) - (depth.get(b.id) ?? 0) || a.title.localeCompare(b.title, 'zh-CN'));
      const perDepth = new Map<number, number>();
      let laneHeight = 0;
      for (const node of ordered) {
        const level = depth.get(node.id) ?? 0;
        const indexAtLevel = perDepth.get(level) ?? 0;
        perDepth.set(level, indexAtLevel + 1);
        const x = 32 + level * COLUMN_GAP;
        const y = laneTop + LANE_HEADER + indexAtLevel * (FLOW_NODE_HEIGHT + 14);
        positioned.push({ view: node, x, y });
        expand(frameBoxes, node.groupId, x, y);
        laneHeight = Math.max(laneHeight, LANE_HEADER + (indexAtLevel + 1) * (FLOW_NODE_HEIGHT + 14));
      }
      laneTop += laneHeight + LANE_GAP + LANE_PAD;
    }
  }

  const frames: PositionedFlowFrame[] = [];
  for (const group of sortedGroups) {
    const box = frameBoxes.get(group.id);
    if (box === undefined) continue;
    frames.push({
      ...group,
      x: box.minX - 20,
      y: box.minY - LANE_HEADER,
      width: box.maxX - box.minX + FLOW_NODE_WIDTH + 40,
      height: box.maxY - box.minY + FLOW_NODE_HEIGHT + LANE_HEADER + 14,
    });
  }

  return { nodes: positioned, frames };
}

function expand(
  boxes: Map<string, { minX: number; maxX: number; minY: number; maxY: number; count: number }>,
  groupId: string,
  x: number,
  y: number,
): void {
  const current = boxes.get(groupId);
  if (current === undefined) {
    boxes.set(groupId, { minX: x, maxX: x, minY: y, maxY: y, count: 1 });
    return;
  }
  current.minX = Math.min(current.minX, x);
  current.maxX = Math.max(current.maxX, x);
  current.minY = Math.min(current.minY, y);
  current.maxY = Math.max(current.maxY, y);
  current.count += 1;
}

/** Longest-path depth with cycle protection (a malformed graph must still render). */
function dependencyDepth(ids: readonly PlanNodeId[], edges: readonly FlowEdgeView[], nodeIds: ReadonlySet<string>): Map<string, number> {
  const incoming = new Map<string, string[]>();
  for (const id of ids) incoming.set(id, []);
  for (const edge of edges) {
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) continue;
    incoming.get(edge.to)?.push(edge.from);
  }
  const memo = new Map<string, number>();
  const visiting = new Set<string>();
  const compute = (id: string): number => {
    const cached = memo.get(id);
    if (cached !== undefined) return cached;
    if (visiting.has(id)) return 0;
    visiting.add(id);
    const parents = incoming.get(id) ?? [];
    const value = parents.length === 0 ? 0 : 1 + Math.max(...parents.map(compute));
    visiting.delete(id);
    memo.set(id, value);
    return value;
  };
  const result = new Map<string, number>();
  for (const id of ids) result.set(id, compute(id));
  return result;
}
