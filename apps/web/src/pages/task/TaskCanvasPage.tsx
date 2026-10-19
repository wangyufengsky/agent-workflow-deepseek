import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  EXECUTION_STATUS_LABEL,
  PLAN_REVISION_STATUS_LABEL,
  TASK_ATTENTION_LABEL,
  WORKSPACE_STATE_LABEL,
  type ActionAvailability,
  type OperationReceipt,
} from '@agent-workflow/shared';
import { isApiClientError } from '../../api/client.ts';
import {
  cancelExecution,
  pauseExecution,
  resumeExecution,
  startExecution,
  useTaskDetail,
  useTaskLiveUpdates,
  useWorkflowCommand,
} from '../../api/workflow.ts';
import { Badge } from '../../components/Badge.tsx';
import { Button, LinkButton } from '../../components/Button.tsx';
import { EmptyState, Skeleton, SkeletonText } from '../../components/EmptyState.tsx';
import { Icon } from '../../components/Icon.tsx';
import { Modal } from '../../components/Modal.tsx';
import { ServiceNotice } from '../../components/ServiceNotice.tsx';
import { StageCapsule } from '../../components/StageCapsule.tsx';
import { FlowCanvas, type FlowLegendItem } from '../../flow/FlowCanvas.tsx';
import { EMPTY_FLOW_GRAPH, planRevisionToFlow } from '../../flow/index.ts';
import { CommandErrorNotice, ConnectionBanner, ReceiptNotice } from '../../flow/workflow-ui.tsx';
import { NodeDetailPanel } from '../node/NodeDetailPanel.tsx';
import { ExecutionPanel } from './ExecutionPanel.tsx';
import { PlanEditPanel } from './PlanEditPanel.tsx';
import './task.css';

const FIXED_TEMPLATE_REASON = '该任务使用固定模板，创建后不能修改步骤；要改要求，请新建模板任务。';

/** 任务执行画布：执行状态、节点画布、执行面板与节点执行现场。 */
export function TaskCanvasPage() {
  const { taskId } = useParams<{ taskId: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const live = useTaskLiveUpdates(taskId);
  const detailQuery = useTaskDetail(taskId, live.refetchInterval);
  const command = useWorkflowCommand(taskId ?? '');

  const [editMode, setEditMode] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [pageReceipt, setPageReceipt] = useState<OperationReceipt | undefined>(undefined);

  const detail = detailQuery.data;
  const plan = detail?.plan;
  const execution = detail?.execution;
  const workspace = detail?.workspace;
  const isFixed = detail?.task.fixedTemplate !== undefined;
  const actions: Record<string, ActionAvailability> = detail?.capabilities ?? {};
  const nodeId = searchParams.get('node') ?? undefined;

  useEffect(() => {
    if (execution?.editSession !== undefined && (execution.editSession.state === 'editing' || execution.editSession.state === 'conflict' || execution.editSession.state === 'saved')) {
      setEditMode(true);
    }
  }, [execution?.editSession?.id, execution?.editSession?.state]);

  const patchParams = (patch: Readonly<Record<string, string | undefined>>) => {
    setSearchParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        for (const [key, value] of Object.entries(patch)) {
          if (value === undefined || value.length === 0) next.delete(key);
          else next.set(key, value);
        }
        return next;
      },
      { replace: true },
    );
  };

  const graph = useMemo(() => {
    if (plan === undefined) return EMPTY_FLOW_GRAPH;
    const nodeIds = plan.graph.nodes.map((node) => node.id);
    return planRevisionToFlow(plan, {
      layer: 'current',
      execution,
      ...(execution === undefined
        ? { badge: { label: `计划修订 ${String(plan.revisionNumber)} · ${PLAN_REVISION_STATUS_LABEL[plan.status]}`, tone: plan.status === 'confirmed' ? 'done' : 'wait', icon: plan.status === 'confirmed' ? 'check' : 'clock' } }
        : {}),
      ...(isFixed ? { lockedNodeIds: nodeIds, lockedReason: FIXED_TEMPLATE_REASON } : {}),
    });
  }, [execution, isFixed, plan]);

  const legend = useMemo<FlowLegendItem[]>(
    () => [
      { label: '执行中', swatch: 'run' },
      { label: '已完成', swatch: 'done' },
      { label: '失败', swatch: 'fail' },
      { label: '未知 / 未开始', swatch: 'unknown' },
    ],
    [],
  );

  const openNode = (nextNodeId: string) => {
    patchParams({ node: nextNodeId });
  };

  const closeNode = () => {
    patchParams({ node: undefined });
  };

  const openRequirement = () => {
    if (taskId === undefined) return;
    navigate(`/requirement/${encodeURIComponent(taskId)}`);
  };

  const runStart = () => {
    if (taskId === undefined) return;
    void command.run(() => startExecution(taskId, execution?.status));
  };
  const runPause = () => {
    if (taskId === undefined) return;
    void command.run(() => pauseExecution(taskId, execution?.status));
  };
  const runResume = () => {
    if (taskId === undefined) return;
    void command.run(() => resumeExecution(taskId, execution?.status));
  };
  const runCancel = () => {
    if (taskId === undefined) return;
    setCancelOpen(false);
    void command.run(() => cancelExecution(taskId, execution?.status)).then((response) => {
      if (response !== undefined) setPageReceipt(response.receipt);
    });
  };

  if (taskId === undefined) {
    return (
      <div className="page">
        <EmptyState icon="list" title="缺少任务标识" description="URL 中没有任务标识，无法读取任务画布。" />
      </div>
    );
  }

  if (detailQuery.isLoading) {
    return (
      <div className="canvas-page">
        <div className="canvas-bar">
          <Skeleton width={280} height={20} />
          <Skeleton width={220} height={32} />
        </div>
        <div className="canvas-body">
          <div className="cv-skeleton">
            <SkeletonText lines={6} />
          </div>
          <aside className="side">
            <div className="side-body">
              <SkeletonText lines={8} />
            </div>
          </aside>
        </div>
      </div>
    );
  }

  if (detailQuery.isError || detail === undefined) {
    const notFound = isApiClientError(detailQuery.error) && detailQuery.error.status === 404;
    return (
      <div className="page">
        {notFound ? (
          <EmptyState
            icon="list"
            title="任务不存在"
            description="服务返回 404；可能已被归档或标识错误。"
            action={<LinkButton to="/tasks" size="sm" variant="secondary" icon="list">返回任务列表</LinkButton>}
          />
        ) : (
          <>
            <ServiceNotice
              error={detailQuery.error}
              onRetry={() => {
                void detailQuery.refetch();
              }}
            />
            <LinkButton to="/tasks" size="sm" variant="ghost" icon="arrowLeft" className="mt-12">
              返回任务列表
            </LinkButton>
          </>
        )}
      </div>
    );
  }

  const { task, project } = detail;
  const progress = execution?.progress;
  const percent = progress === undefined || progress.total === 0 ? 0 : Math.round((progress.done / progress.total) * 100);
  const editSession = execution?.editSession;

  return (
    <div className="canvas-page task-canvas">
      <div className="canvas-bar task-bar">
        <div className="task-bar-main">
          <div className="task-title-row">
            <span className="task-title" title={task.title}>
              {task.title}
            </span>
            <Badge outline>{project.name}</Badge>
            <Badge outline>{task.id}</Badge>
            {isFixed ? (
              <Badge tone="wait" icon="lock">
                固定模板 · {task.fixedTemplate?.templateId} v{task.fixedTemplate?.templateVersion}
              </Badge>
            ) : null}
            {task.attention === 'none' ? null : (
              <Badge tone={task.attention === 'waiting_user' ? 'wait' : task.attention === 'failed' ? 'fail' : task.attention === 'blocked' ? 'stall' : 'unknown'} icon={task.attention === 'failed' ? 'x' : 'help'}>
                {TASK_ATTENTION_LABEL[task.attention]}
              </Badge>
            )}
          </div>
          <div className="task-subline">
            <span>
              {EXECUTION_STATUS_LABEL[execution?.status ?? 'idle']} · 计划修订 {plan?.revisionNumber ?? '—'} · {plan === undefined ? '无计划' : PLAN_REVISION_STATUS_LABEL[plan.status]}
            </span>
            <span className="sep">·</span>
            <span>工作区 {workspace === undefined ? '未创建' : WORKSPACE_STATE_LABEL[workspace.state]}</span>
            {execution === undefined ? null : (
              <>
                <span className="sep">·</span>
                <span>自动推进 {execution.autoAdvance ? '开启' : '关闭'}</span>
              </>
            )}
          </div>
        </div>

        <StageCapsule current={task.stage} lifecycle={task.lifecycle} attention={task.attention} compact className="task-stages" />

        <div className="task-acts">
          {execution === undefined ? null : (
            <Button
              variant="secondary"
              size="sm"
              icon="edit"
              disabled={actions.adjustExecutionPlan?.allowed !== true || command.state.busy}
              disabledReason={actions.adjustExecutionPlan?.reason}
              onClick={() => setEditMode(true)}
            >
              调整待执行计划
            </Button>
          )}
          {execution?.status === 'running' ? (
            <Button variant="secondary" size="sm" icon="pause" disabled={command.state.busy || actions.pauseExecution?.allowed !== true} disabledReason={actions.pauseExecution?.reason} onClick={runPause}>
              暂停
            </Button>
          ) : null}
          {execution?.status === 'paused' ? (
            <Button variant="secondary" size="sm" icon="play" disabled={command.state.busy || actions.resumeExecution?.allowed !== true} disabledReason={actions.resumeExecution?.reason} onClick={runResume}>
              继续
            </Button>
          ) : null}
          <Button variant="secondary" size="sm" icon="file" onClick={openRequirement}>
            需求画布
          </Button>
        </div>
      </div>

      <div className="task-situ" aria-live="polite">
        <span className={`situ-status ${execution?.status === 'failed' ? 'bad' : execution?.status === 'unknown' ? 'unk' : execution?.status === 'running' ? 'run' : execution?.status === 'completed' ? 'ok' : ''}`}>
          <Icon name={execution?.status === 'failed' ? 'x' : execution?.status === 'unknown' ? 'help' : execution?.status === 'running' ? 'play' : execution?.status === 'completed' ? 'check' : 'clock'} size="sm" />
          {EXECUTION_STATUS_LABEL[execution?.status ?? 'idle']}
        </span>
        <div className="situ-progress">
          <div className="progress-bar">
            <span style={{ width: `${String(percent)}%` }} />
          </div>
          <span className="num">{progress === undefined ? '—' : `${String(progress.done)} / ${String(progress.total)} 步`}</span>
        </div>
        <span className="situ-kv">
          <span className="k">执行中</span>
          {progress?.running ?? 0}
        </span>
        <span className="situ-kv">
          <span className="k">失败</span>
          {progress?.failed ?? 0}
        </span>
        <span className="situ-kv">
          <span className="k">自动推进</span>
          {execution === undefined ? '—' : execution.autoAdvance ? '开启' : '关闭'}
        </span>
        {editSession === undefined ? null : (
          <span className="situ-kv warn">
            <span className="k">调整</span>
            {editSession.state === 'editing' ? '编辑中' : editSession.state === 'saved' ? '已保存 · 待重新确认' : editSession.state === 'conflict' ? '领取竞态' : editSession.state}
          </span>
        )}
        <span className="situ-notice">
          {execution?.notice === undefined ? (execution === undefined ? '执行尚未创建；下一步在需求画布准备工作区。' : '没有待处理情况。') : execution.notice.message}
        </span>
      </div>

      <div className="task-banners">
        <ConnectionBanner connection={live.connection} transport={live.transport} />
        <CommandErrorNotice error={command.state.error} />
        <ReceiptNotice receipt={command.state.receipt} />
        <ReceiptNotice receipt={pageReceipt} />
        {execution?.status === 'unknown' ? (
          <div className="banner unknown">
            <Icon name="help" />
            <div className="grow">
              <b>执行结果待核对。</b>不会自动重发；以服务回读的状态为准，可回到需求画布核对规划轮次。
            </div>
          </div>
        ) : null}
        {plan !== undefined && plan.status === 'unconfirmed' && !isFixed ? (
          <div className="banner warn">
            <Icon name="alert" />
            <div className="grow">
              <b>计划修订 {plan.revisionNumber} 未确认。</b>执行命令会被服务拒绝；请回到需求画布确认计划后再开始执行。
            </div>
            <div className="actions">
              <Button variant="secondary" size="sm" icon="file" onClick={openRequirement}>
                去确认计划
              </Button>
            </div>
          </div>
        ) : null}
        {isFixed ? (
          <div className="banner info">
            <Icon name="lock" />
            <div className="grow">{FIXED_TEMPLATE_REASON}可以查看、确认、准备工作区并按原配置执行。</div>
          </div>
        ) : null}
      </div>

      <div className="canvas-body task-body">
        <FlowCanvas
          graph={graph}
          ariaLabel="执行画布（点节点打开执行现场；Tab 进入节点，Enter 查看）"
          selectedNodeId={nodeId}
          onSelectNode={(next) => {
            if (next === undefined) closeNode();
            else openNode(next);
          }}
          onViewportChange={() => undefined}
          legend={legend}
          emptyState={
            <EmptyState
              icon="flow"
              title="当前没有可显示的节点"
              description={plan === undefined ? '服务还没有返回计划；确认计划后执行画布才会显示步骤。' : '计划图里没有节点；这里不会补造步骤。'}
              action={
                <Button size="sm" variant="secondary" icon="file" onClick={openRequirement}>
                  回到需求画布
                </Button>
              }
            />
          }
        />

        {nodeId !== undefined ? (
          <NodeDetailPanel taskId={taskId} nodeId={nodeId} connection={live.connection} pollInterval={live.refetchInterval} onClose={closeNode} onOpenPlan={openRequirement} />
        ) : editMode ? (
          <aside className="side task-side" aria-label="调整待执行计划">
            <div className="side-head task-side-head">
              <div className="row" style={{ gap: 8 }}>
                <h2 className="grow">调整待执行计划</h2>
                <Button size="sm" variant="ghost" icon="chevLeft" onClick={() => setEditMode(false)}>
                  返回执行
                </Button>
              </div>
            </div>
            <div className="side-body task-side-body">
              <PlanEditPanel
                taskId={taskId}
                detail={detail}
                execution={execution}
                plan={plan}
                actions={actions}
                onRefresh={async () => {
                  await detailQuery.refetch();
                }}
                onOpenNode={openNode}
              />
            </div>
          </aside>
        ) : (
          <aside className="side task-side" aria-label="执行面板">
            <div className="side-head task-side-head">
              <h2 className="grow">执行面板</h2>
              <Badge tone={execution?.status === 'running' ? 'run' : execution?.status === 'failed' ? 'fail' : 'idle'}>{EXECUTION_STATUS_LABEL[execution?.status ?? 'idle']}</Badge>
            </div>
            <div className="side-body task-side-body">
              <ExecutionPanel
                detail={detail}
                plan={plan}
                execution={execution}
                workspace={workspace}
                actions={actions}
                busy={command.state.busy}
                onStart={runStart}
                onPause={runPause}
                onResume={runResume}
                onCancel={() => setCancelOpen(true)}
                onOpenNode={openNode}
                onOpenEdit={() => setEditMode(true)}
                onOpenRequirement={openRequirement}
              />
            </div>
          </aside>
        )}
      </div>

      <Modal
        open={cancelOpen}
        title="取消执行"
        onClose={() => setCancelOpen(false)}
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setCancelOpen(false)}>
              返回
            </Button>
            <Button variant="danger" size="sm" icon="stop" onClick={runCancel}>
              确认取消执行
            </Button>
          </>
        }
      >
        <p>
          取消会停止这一轮执行；工作区与已产生的记录保留。已提交的结果与回执仍然可读；取消不是删除，也不会自动清理工作区。
        </p>
        <p className="hint" style={{ marginTop: 8 }}>
          当前状态：{EXECUTION_STATUS_LABEL[execution?.status ?? 'idle']}。运行中的步骤可能先完成当前快照。
        </p>
      </Modal>
    </div>
  );
}
