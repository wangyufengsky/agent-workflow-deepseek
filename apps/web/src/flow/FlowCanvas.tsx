import { useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react';
import {
  Background,
  BackgroundVariant,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type NodeTypes,
  type Viewport,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { PlanLayerValue } from '@agent-workflow/shared';
import { Icon } from '../components/Icon.tsx';
import { layoutFlowGraph, FLOW_NODE_WIDTH } from './layout.ts';
import { GroupFrameNode, GroupSummaryNode, PlanNodeCard, type FlowCanvasNode } from './PlanNodeCard.tsx';
import type { FlowGraphView, FlowLayerOption } from './types.ts';
import './flow.css';

const NODE_TYPES: NodeTypes = {
  planNode: PlanNodeCard,
  groupFrame: GroupFrameNode,
  groupSummary: GroupSummaryNode,
};

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 1.7;

export interface FlowLegendItem {
  readonly label: string;
  readonly swatch: 'added' | 'modified' | 'replaced' | 'node' | 'run' | 'done' | 'fail' | 'unknown' | 'gap';
}

export interface FlowCanvasProps {
  readonly graph: FlowGraphView;
  readonly ariaLabel: string;
  readonly layer?: PlanLayerValue;
  readonly layers?: readonly FlowLayerOption[];
  readonly onLayerChange?: (layer: PlanLayerValue) => void;
  readonly selectedNodeId?: string;
  readonly onSelectNode?: (nodeId: string | undefined) => void;
  readonly collapsedGroups?: readonly string[];
  readonly onToggleGroup?: (groupId: string) => void;
  /** Overlay note above the canvas (activation limits, candidate layer limits). */
  readonly notice?: ReactNode;
  readonly legend?: readonly FlowLegendItem[];
  readonly emptyState?: ReactNode;
  readonly viewport?: Viewport;
  readonly onViewportChange?: (viewport: Viewport) => void;
  readonly className?: string;
}

function viewportIsValid(viewport: Viewport | undefined): viewport is Viewport {
  return viewport !== undefined && Number.isFinite(viewport.x) && Number.isFinite(viewport.y) && Number.isFinite(viewport.zoom) && viewport.zoom > 0;
}

function FlowCanvasInner(props: FlowCanvasProps) {
  const { fitView, zoomIn, zoomOut } = useReactFlow();
  const layout = useMemo(() => layoutFlowGraph(props.graph), [props.graph]);
  const didInitialFit = useRef(false);
  const collapsed = useMemo(() => new Set(props.collapsedGroups ?? []), [props.collapsedGroups]);

  const nodes = useMemo<FlowCanvasNode[]>(() => {
    const result: FlowCanvasNode[] = [];
    const collapsedIds = new Set<string>();

    for (const frame of layout.frames) {
      const isCollapsed = collapsed.has(frame.id);
      if (isCollapsed) {
        collapsedIds.add(frame.id);
        result.push({
          id: `frame:${frame.id}`,
          type: 'groupSummary',
          position: { x: frame.x + 8, y: frame.y + 10 },
          data: { kind: 'groupSummary', frame, onToggleGroup: props.onToggleGroup },
          style: { width: FLOW_NODE_WIDTH },
          draggable: false,
          selectable: false,
          connectable: false,
          focusable: true,
          zIndex: 1,
        });
        continue;
      }
      result.push({
        id: `frame:${frame.id}`,
        type: 'groupFrame',
        position: { x: frame.x, y: frame.y },
        data: { kind: 'groupFrame', frame, collapsed: false, onToggleGroup: props.onToggleGroup },
        style: { width: frame.width, height: frame.height, zIndex: 0 },
        draggable: false,
        selectable: false,
        connectable: false,
        focusable: false,
        className: 'flow-frame-node',
      });
    }

    for (const item of layout.nodes) {
      if (item.view.groupId !== undefined && collapsedIds.has(item.view.groupId)) continue;
      result.push({
        id: item.view.id,
        type: 'planNode',
        position: { x: item.x, y: item.y },
        data: { kind: 'planNode', view: item.view },
        selected: props.selectedNodeId === item.view.id,
        draggable: false,
        connectable: false,
        focusable: true,
        style: { width: FLOW_NODE_WIDTH },
        zIndex: 2,
      });
    }
    return result;
  }, [collapsed, layout, props.onToggleGroup, props.selectedNodeId]);

  const edges = useMemo<Edge[]>(() => {
    const hidden = new Set(nodes.filter((node) => node.type === 'groupSummary').map((node) => node.id.replace(/^frame:/, '')));
    const visible = new Set(nodes.filter((node) => node.type === 'planNode').map((node) => node.id));
    return props.graph.edges
      .filter((edge) => visible.has(edge.from) && visible.has(edge.to))
      .filter((edge) => {
        const fromGroup = props.graph.nodes.find((node) => node.id === edge.from)?.groupId;
        const toGroup = props.graph.nodes.find((node) => node.id === edge.to)?.groupId;
        return !(fromGroup !== undefined && toGroup !== undefined && fromGroup === toGroup && hidden.has(fromGroup));
      })
      .map((edge) => ({
        id: edge.id,
        source: edge.from,
        target: edge.to,
        type: 'smoothstep',
        label: edge.label,
        className: `flow-edge ${edge.kind} ${edge.state ?? 'normal'}`,
        labelStyle: { fill: 'var(--sub)', fontSize: 11 },
        labelBgStyle: { fill: 'var(--panel)', fillOpacity: 0.92 },
        labelBgPadding: [4, 2] as [number, number],
        labelBgBorderRadius: 4,
      }));
  }, [nodes, props.graph.edges, props.graph.nodes]);

  useEffect(() => {
    if (didInitialFit.current) return;
    didInitialFit.current = true;
    if (viewportIsValid(props.viewport)) return;
    if (nodes.length === 0) return;
    const timer = window.setTimeout(() => {
      void fitView({ padding: 0.18, duration: 220 });
    }, 30);
    return () => {
      window.clearTimeout(timer);
    };
  }, [fitView, nodes.length, props.viewport]);

  const handleNodeClick = useCallback(
    (_event: unknown, node: { id: string; type?: string }) => {
      if (node.type === 'planNode') {
        props.onSelectNode?.(node.id);
        return;
      }
      const frameId = node.id.startsWith('frame:') ? node.id.slice('frame:'.length) : undefined;
      if (frameId !== undefined && node.type === 'groupSummary') props.onToggleGroup?.(frameId);
    },
    [props],
  );

  const onMoveEnd = useCallback(
    (_event: unknown, viewport: Viewport) => {
      props.onViewportChange?.(viewport);
    },
    [props],
  );

  return (
    <div className={['flow-canvas', props.className ?? ''].filter(Boolean).join(' ')}>
      {props.layers !== undefined && props.layers.length > 0 ? (
        <div className="flow-layer-switch" role="group" aria-label="画布图层">
          {props.layers.map((layer) => {
            const active = props.layer === layer.value;
            return (
              <button
                key={layer.value}
                type="button"
                aria-pressed={active}
                disabled={layer.disabledReason !== undefined && layer.disabledReason.length > 0}
                title={layer.disabledReason}
                onClick={() => {
                  if (!active) props.onLayerChange?.(layer.value);
                }}
              >
                {layer.label}
                {layer.disabledReason === undefined ? null : <Icon name="lock" size="sm" />}
              </button>
            );
          })}
        </div>
      ) : null}

      {props.notice === undefined ? null : <div className="flow-notice">{props.notice}</div>}

      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        onNodeClick={handleNodeClick}
        onPaneClick={() => {
          props.onSelectNode?.(undefined);
        }}
        onMoveEnd={onMoveEnd}
        {...(viewportIsValid(props.viewport) ? { defaultViewport: props.viewport } : { fitView: true })}
        minZoom={MIN_ZOOM}
        maxZoom={MAX_ZOOM}
        nodesDraggable={false}
        nodesConnectable={false}
        nodesFocusable
        edgesFocusable={false}
        elementsSelectable
        panOnDrag
        panOnScroll={false}
        zoomOnScroll
        zoomOnPinch
        proOptions={{ hideAttribution: true }}
        aria-label={props.ariaLabel}
        className={props.graph.nodes.length === 0 ? 'is-empty' : undefined}
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="var(--line-2)" />
      </ReactFlow>

      <div className="flow-zoom" role="group" aria-label="画布缩放">
        <button type="button" aria-label="缩小" onClick={() => void zoomOut({ duration: 150 })}>
          <Icon name="minus" size="sm" />
        </button>
        <button type="button" aria-label="放大" onClick={() => void zoomIn({ duration: 150 })}>
          <Icon name="plus" size="sm" />
        </button>
        <span className="flow-zoom-sep" />
        <button type="button" aria-label="适应画布" onClick={() => void fitView({ padding: 0.18, duration: 220 })}>
          <Icon name="target" size="sm" />
          适应
        </button>
      </div>

      {props.legend !== undefined && props.legend.length > 0 ? (
        <div className="flow-legend" role="note" aria-label="图例">
          {props.legend.map((item) => (
            <span key={item.label}>
              <span className={`flow-swatch ${item.swatch}`} />
              {item.label}
            </span>
          ))}
        </div>
      ) : null}

      {props.graph.nodes.length === 0 && props.emptyState !== undefined ? <div className="flow-empty">{props.emptyState}</div> : null}
    </div>
  );
}

/** React Flow wrapper: provider, themed controls, selection and viewport persistence. */
export function FlowCanvas(props: FlowCanvasProps) {
  return (
    <ReactFlowProvider>
      <FlowCanvasInner {...props} />
    </ReactFlowProvider>
  );
}
