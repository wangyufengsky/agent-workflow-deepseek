import { useEffect, useState } from 'react';
import { Background, BaseEdge, Controls, EdgeLabelRenderer, ReactFlow, ReactFlowProvider, applyNodeChanges, getBezierPath, type Edge, type EdgeProps, type Node, type ReactFlowInstance, Position } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { explicitMethodSteps, type MethodStepDefinition } from '@agent-workflow/shared';
import { Button } from '../../components/Button.tsx';
import { Icon } from '../../components/Icon.tsx';
import { WORKFLOW_STEP_KIND_LABEL } from './workflow-model.ts';
import { workflowDifferences, workflowLayout } from './workflow-graph.ts';

function InsertEdge(props: EdgeProps) {
  const [path, x, y] = getBezierPath(props);
  const insert = props.data?.insert;
  return <><BaseEdge path={path} markerEnd={props.markerEnd} /><EdgeLabelRenderer>{typeof insert === 'function' ? <button type="button" className="wfe-connection-insert nodrag nopan" style={{ transform: `translate(-50%, -50%) translate(${x}px,${y}px)` }} aria-label="在连线上插入步骤" onClick={() => { insert(); }}><Icon name="plus" size="sm" /></button> : null}</EdgeLabelRenderer></>;
}
const edgeTypes = { insert: InsertEdge };

export function WorkflowGraphCanvas(props: {
  readonly steps: readonly MethodStepDefinition[];
  readonly roleNames: ReadonlyMap<string, string>;
  readonly baseline?: readonly MethodStepDefinition[];
  readonly selected?: string | null;
  readonly readonly: boolean;
  readonly onSelect: (key: string) => void;
  readonly onConnect: (from: string, to: string) => void;
  readonly onDisconnect: (from: string, to: string) => void;
  readonly onInsert: (from: string, to: string) => void;
  readonly onLayout: (positions: ReadonlyMap<string, { x: number; y: number }>) => void;
  readonly onPosition: (key: string, position: { x: number; y: number }) => void;
}) {
  const [instance, setInstance] = useState<ReactFlowInstance | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<Edge | null>(null);
  const graph = explicitMethodSteps(props.steps);
  const changes = workflowDifferences(props.baseline ?? props.steps, props.steps);
  const positions = workflowLayout(props.steps);
  const makeNodes = (): Node[] => {
    const result: Node[] = graph.map((step) => {
    const change = changes.find((item) => item.key === step.key);
    return { id: step.key, sourcePosition: Position.Right, targetPosition: Position.Left, position: step.position ?? positions.get(step.key)!, selected: step.key === props.selected,
      className: `wfe-flow-node ${change?.kind ?? ''}`, data: { label: <div><b>{step.title}</b><div className="hint">{WORKFLOW_STEP_KIND_LABEL[step.kind]} · {step.group}</div><div className="hint">职业：{step.roleId === undefined ? '未指定' : props.roleNames.get(step.roleId) ?? step.roleId}</div>{change === undefined ? null : <span><Icon name={change.kind === 'added' ? 'plus' : 'edit'} size="sm" />{change.kind === 'added' ? '新增' : '修改'}</span>}</div> } };
    });
    const maxX = Math.max(0, ...result.map((node) => node.position.x));
    return [...result,
      { id: '__start', width: 160, height: 60, type: 'input', sourcePosition: Position.Right, position: { x: -220, y: 80 }, data: { label: '开始' }, draggable: false, connectable: false, className: 'wfe-flow-node' },
      { id: '__end', width: 160, height: 60, type: 'output', targetPosition: Position.Left, position: { x: maxX + 300, y: 80 }, data: { label: '交付' }, draggable: false, connectable: false, className: 'wfe-flow-node' },
    ];
  };
  const [nodes, setNodes] = useState<Node[]>(makeNodes);
  useEffect(() => { setNodes(makeNodes()); }, [props.steps, props.selected, props.baseline, props.roleNames]);
  const dependencyEdges: Edge[] = graph.flatMap((step) => step.requires!.map((from) => ({ id: `${from}->${step.key}`, source: from, target: step.key, type: 'insert', data: props.readonly ? {} : { insert: () => { props.onInsert(from, step.key); } } })));
  const rootKeys = graph.filter((step) => step.requires!.length === 0).map((step) => step.key);
  const leafKeys = graph.filter((step) => !graph.some((other) => other.requires!.includes(step.key))).map((step) => step.key);
  const edges: Edge[] = [...dependencyEdges, ...rootKeys.map((key) => ({ id: `__start-${key}`, source: '__start', target: key })), ...leafKeys.map((key) => ({ id: `${key}-__end`, source: key, target: '__end' }))];
  return <div className="wfe-graph-container">
    <div className="row wrap wfe-graph-tools">
      <span className="hint">拖动空白平移 · Ctrl/⌘ + 滚轮缩放 · 拖动端口连线</span><span className="grow" />
      <Button variant="ghost" size="sm" disabled={props.readonly} disabledReason={props.readonly ? '只读流程' : undefined} onClick={() => { props.onLayout(positions); }}>自动排列</Button>
      <Button variant="ghost" size="sm" onClick={() => { void instance?.fitView({ padding: 0.2 }); }}>适应画布</Button>
      <Button variant="ghost" size="sm" disabled={props.readonly || selectedEdge === null || selectedEdge.source === '__start' || selectedEdge.target === '__end'} disabledReason={props.readonly ? '只读流程' : selectedEdge === null ? '先选择一条连线' : selectedEdge.source === '__start' || selectedEdge.target === '__end' ? '开始与交付边界连线由服务图自动生成' : undefined} onClick={() => { if (selectedEdge !== null) props.onDisconnect(selectedEdge.source, selectedEdge.target); setSelectedEdge(null); }}>移除选中连线</Button>
    </div>
    <div className="wfe-graph-surface" role="region" aria-label="可缩放流程依赖图">
      <ReactFlowProvider><ReactFlow nodes={nodes} edges={edges} edgeTypes={edgeTypes} onInit={setInstance} fitView minZoom={0.2} maxZoom={2}
        nodesDraggable={!props.readonly} nodesConnectable={!props.readonly} deleteKeyCode={null} zoomActivationKeyCode={['Meta', 'Control']}
        onNodesChange={(changes) => { setNodes((items) => applyNodeChanges(changes, items)); }}
        onNodeClick={(_, node) => { if (!node.id.startsWith('__')) props.onSelect(node.id); }}
        onNodeDragStop={(_, node) => { if (!node.id.startsWith('__')) props.onPosition(node.id, node.position); }}
        onEdgeClick={(_, edge) => { setSelectedEdge(edge); }}
        onConnect={(connection) => { if (connection.source !== null && connection.target !== null) props.onConnect(connection.source, connection.target); }}>
        <Background /><Controls showInteractive={false} />
      </ReactFlow></ReactFlowProvider>
    </div>
    <p className="hint">{props.steps.length} 个步骤 · {dependencyEdges.length} 条依赖。没有前驱的步骤可同时就绪；实际领取仍受职业权限、工作区写入互斥及并发上限约束。</p>
  </div>;
}
