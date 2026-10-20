import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  EXECUTION_STATUS_LABEL,
  PLAN_REVISION_STATUS_LABEL,
  WORKSPACE_STATE_LABEL,
  type ActionAvailability,
  type OperationReceipt,
} from '@agent-workflow/shared';
import { isApiClientError } from '../../api/client.ts';
import {
  advanceExecution,
  cancelExecution,
  pauseExecution,
  resumeExecution,
  retryExecution,
  setExecutionAutoAdvance,
  startExecution,
  useExecutionView,
  useTaskDetail,
  useTaskLiveUpdates,
  useWorkflowCommand,
} from '../../api/workflow.ts';
import { Badge } from '../../components/Badge.tsx';
import { Button, LinkButton } from '../../components/Button.tsx';
import { EmptyState, Skeleton, SkeletonText } from '../../components/EmptyState.tsx';
import { Icon } from '../../components/Icon.tsx';
import { IconButton } from '../../components/IconButton.tsx';
import { Modal } from '../../components/Modal.tsx';
import { ServiceNotice } from '../../components/ServiceNotice.tsx';
import { StageCapsule } from '../../components/StageCapsule.tsx';
import { FlowCanvas, type FlowLegendItem } from '../../flow/FlowCanvas.tsx';
import { EMPTY_FLOW_GRAPH, planRevisionToFlow } from '../../flow/index.ts';
import { CommandErrorNotice, ConnectionBanner, ReceiptNotice } from '../../flow/workflow-ui.tsx';
import { NodeDetailPanel } from '../node/NodeDetailPanel.tsx';
import { TaskDeliveryPanel } from '../delivery/TaskDeliveryPanel.tsx';
import { ExecutionPanel } from './ExecutionPanel.tsx';
import { PlanEditPanel } from './PlanEditPanel.tsx';
import { TaskExtrasPanel, type TaskExtrasMode } from './TaskExtrasPanel.tsx';
import { WorkspaceDetailDrawer } from './WorkspaceDetailDrawer.tsx';
import { AUTO_ADVANCE_STATUSES, advanceTargets, hasActiveEditSession, manualAdvanceReason } from './advance.ts';
import { deriveCanvasSituation, type CanvasPrimaryAction } from './situation.ts';
import './task.css';

const FIXED_TEMPLATE_REASON = '该任务使用固定模板，创建后不能修改步骤；要改要求，请新建模板任务。';

/** 任务执行画布：执行状态、节点画布、执行面板与节点执行现场。 */
export function TaskCanvasPage() {
  const { taskId } = useParams<{ taskId: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const live = useTaskLiveUpdates(taskId);
  const detailQuery = useTaskDetail(taskId, live.refetchInterval);
  // Task detail is built from the raw execution row; `/execution` overlays the
  // W0-4b human-acceptance gate. Reading it keeps the acceptance projection real.
  const executionViewQuery = useExecutionView(taskId, live.refetchInterval);
  const command = useWorkflowCommand(taskId ?? '');

  const [editMode, setEditMode] = useState(false);
  const [extrasMode, setExtrasMode] = useState<TaskExtrasMode | null>(null);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [deliveryFocusRequest, setDeliveryFocusRequest] = useState(0);
  const [pageReceipt, setPageReceipt] = useState<OperationReceipt | undefined>(undefined);
  const [pageReceiptMessage, setPageReceiptMessage] = useState<string | undefined>(undefined);
  const [lastCommand, setLastCommand] = useState<string | undefined>(undefined);

  const detail = detailQuery.data;
  const plan = detail?.plan;
  const execution = detail?.execution;
  const workspace = detail?.workspace;
  const isFixed = detail?.task.fixedTemplate !== undefined;
  const actions: Record<string, ActionAvailability> = detail?.capabilities ?? {};
  const nodeId = searchParams.get('node') ?? undefined;
  const deliveryOpen = searchParams.get('delivery') === '1';
  const acceptFocusToken = searchParams.get('accept') ?? undefined;
  const acceptFocus = acceptFocusToken !== undefined;

  const acceptanceExecution = executionViewQuery.data?.execution;
  const acceptance = acceptanceExecution?.acceptance;
  const pendingAcceptance = acceptance?.pending ?? [];
  const rejectedAcceptance = acceptance?.rejected ?? [];
  /**
   * Older services do not overlay `execution.acceptance` on the task detail read
   * model. Fall back to plan criteria + node statuses and say so in the banner;
   * the per-node verdict itself is only read from the node detail panel.
   */
  const acceptanceFallbackIds =
    acceptance === undefined && !executionViewQuery.isLoading && execution !== undefined && plan !== undefined
      ? execution.nodes
          .filter((node) => node.status === 'succeeded' && (plan.graph.nodes.find((item) => item.id === node.nodeId)?.acceptance.length ?? 0) > 0)
          .map((node) => node.nodeId)
      : [];
  const pendingAcceptanceCount = pendingAcceptance.length > 0 ? pendingAcceptance.length : acceptanceFallbackIds.length;
  const firstAcceptanceNodeId = pendingAcceptance[0] ?? acceptanceFallbackIds[0];
  const firstRejectedNodeId = rejectedAcceptance[0];
  const planNodeTitle = (targetNodeId: string | undefined): string =>
    targetNodeId === undefined ? '该步骤' : plan?.graph.nodes.find((item) => item.id === targetNodeId)?.title ?? targetNodeId;
  const acceptancePaused = execution?.status === 'paused';
  const acceptanceUserPaused = acceptancePaused && execution?.pause?.requestKey !== undefined;
  const reuseRefresh = () => {
    void detailQuery.refetch();
    void executionViewQuery.refetch();
  };

  useEffect(() => {
    if (execution?.editSession !== undefined && (execution.editSession.state === 'editing' || execution.editSession.state === 'conflict' || execution.editSession.state === 'saved')) {
      setEditMode(true);
    }
  }, [execution?.editSession?.id, execution?.editSession?.state]);

  useEffect(() => {
    setExtrasMode(null);
    setMenuOpen(false);
    setWorkspaceOpen(false);
  }, [taskId]);

  useEffect(() => {
    if (!menuOpen) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (event.target instanceof Node && menuRef.current?.contains(event.target) === true) return;
      setMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [menuOpen]);

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

  const requestDeliveryFocus = () => {
    setExtrasMode(null);
    setDeliveryFocusRequest((current) => current + 1);
    if (!deliveryOpen) patchParams({ delivery: '1', node: undefined });
  };

  const openExtras = (mode: TaskExtrasMode) => {
    setMenuOpen(false);
    setEditMode(false);
    setExtrasMode(mode);
    patchParams({ node: undefined, accept: undefined, delivery: undefined });
  };

  const openEdit = () => {
    setExtrasMode(null);
    setEditMode(true);
    patchParams({ node: undefined, accept: undefined, delivery: undefined });
  };

  const openRunContent = () => {
    if (taskId === undefined) return;
    setMenuOpen(false);
    navigate(`/runs/${encodeURIComponent(taskId)}`);
  };

  const editLockedIds = execution?.editSession !== undefined && !['finished', 'abandoned'].includes(execution.editSession.state) ? execution.editSession.lockedNodeIds : undefined;
  const graph = useMemo(() => {
    if (plan === undefined) return EMPTY_FLOW_GRAPH;
    const nodeIds = plan.graph.nodes.map((node) => node.id);
    // P13-13: while adjusting a pending plan the canvas shows the same lock layer
    // as the panel: claimed / running / finished steps (and their in-edges) are locked.
    const lockedNodeIds = isFixed ? nodeIds : editLockedIds;
    return planRevisionToFlow(plan, {
      layer: 'current',
      execution,
      ...(lockedNodeIds === undefined ? {} : { lockedNodeIds, lockedReason: isFixed ? FIXED_TEMPLATE_REASON : '已领取 / 运行中 / 已完成：锁定（含入边）；待执行步骤可修改。' }),
    });
  }, [editLockedIds, execution, isFixed, plan]);

  const legend = useMemo<FlowLegendItem[]>(
    () => [
      { label: '执行中', swatch: 'run' },
      { label: '已完成', swatch: 'done' },
      { label: '失败', swatch: 'fail' },
      { label: '未知 / 未开始', swatch: 'unknown' },
      ...(editLockedIds === undefined ? [] : [{ label: '锁定（已领取 / 运行中 / 已完成）', swatch: 'gap' as const }]),
    ],
    [editLockedIds],
  );

  const openNode = (nextNodeId: string) => {
    setExtrasMode(null);
    patchParams({ node: nextNodeId, accept: undefined });
  };

  const goAccept = (targetNodeId: string | undefined) => {
    if (targetNodeId === undefined) return;
    setExtrasMode(null);
    patchParams({ node: targetNodeId, accept: String(Date.now()), delivery: undefined });
  };

  const closeNode = () => {
    patchParams({ node: undefined, accept: undefined });
  };

  const openRequirement = () => {
    if (taskId === undefined) return;
    navigate(`/requirement/${encodeURIComponent(taskId)}`);
  };

  const runStart = () => {
    if (taskId === undefined) return;
    setLastCommand('开始执行');
    void command.run(() => startExecution(taskId, execution?.status));
  };
  const runPause = () => {
    if (taskId === undefined) return;
    setLastCommand('暂停执行');
    void command.run(() => pauseExecution(taskId, execution?.status));
  };
  const runResume = () => {
    if (taskId === undefined) return;
    setLastCommand('继续执行');
    void command.run(() => resumeExecution(taskId, execution?.status));
  };
  const runCancel = () => {
    if (taskId === undefined) return;
    setLastCommand('取消执行');
    setPageReceiptMessage('取消执行 · 服务回执 succeeded');
    setCancelOpen(false);
    void command.run(() => cancelExecution(taskId, execution?.status)).then((response) => {
      if (response !== undefined) setPageReceipt(response.receipt);
    });
  };
  const runToggleAutoAdvance = (autoAdvance: boolean) => {
    if (taskId === undefined) return;
    setLastCommand(autoAdvance ? '开启自动节点推进' : '关闭自动节点推进');
    void command.run(() => setExecutionAutoAdvance(taskId, autoAdvance));
  };
  const runAdvanceAll = () => {
    if (taskId === undefined) return;
    setLastCommand('整体推进');
    void command.run(() => advanceExecution(taskId)).then((response) => {
      if (response?.receipt.status !== 'succeeded') return;
      const released = response.receipt.outcome?.released;
      const count = Array.isArray(released) ? released.length : 0;
      setLastCommand(count > 0 ? `整体推进 · 已放行 ${String(count)} 步` : '整体推进');
    });
  };
  const runAdvanceSuccessors = (advanceNodeId: string) => {
    if (taskId === undefined) return;
    setLastCommand('推进直接后继');
    void command.run(() => advanceExecution(taskId, advanceNodeId)).then((response) => {
      if (response?.receipt.status !== 'succeeded') return;
      const released = response.receipt.outcome?.released;
      const count = Array.isArray(released) ? released.length : 0;
      setLastCommand(count > 0 ? `推进直接后继 · 已放行 ${String(count)} 步` : '推进直接后继');
    });
  };
  const runRetryRejected = () => {
    if (taskId === undefined) return;
    setLastCommand('按原配置重试失败 / 被退回步骤');
    void command.run(() => retryExecution(taskId, execution?.status));
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
  const readOnly = task.readOnly === true;
  const readOnlyReason = actions.startExecution?.reason ?? '此任务用于核对父任务已有产物，不创建新的执行或工作区。';
  const progress = execution?.progress;
  const percent = progress === undefined || progress.total === 0 ? 0 : Math.round((progress.done / progress.total) * 100);
  const editSession = execution?.editSession;
  // P13-01/P13-02: one service-fact projection drives the badge, the situation
  // bar and the single nearest action; it never maps execution.completed to a
  // green "task completed".
  const situation = deriveCanvasSituation({
    task,
    ...(plan === undefined ? {} : { plan }),
    ...(execution === undefined ? {} : { execution }),
    ...(detail.delivery === undefined ? {} : { delivery: detail.delivery }),
    ...(workspace === undefined ? {} : { workspace }),
    ...(detail.attentionItems === undefined ? {} : { attentionItems: detail.attentionItems }),
    ...(editSession === undefined ? {} : { editSession }),
  });
  const autoToggleAllowed = execution !== undefined && AUTO_ADVANCE_STATUSES.includes(execution.status) && !hasActiveEditSession(execution) && !command.state.busy;
  const autoToggleReason = command.state.busy
    ? '正在提交操作，等待服务回执…'
    : execution === undefined
      ? '开始执行后才能切换自动节点推进。'
      : hasActiveEditSession(execution)
        ? '正在调整待执行计划：结束或放弃调整后才能切换自动节点推进。'
        : !AUTO_ADVANCE_STATUSES.includes(execution.status)
          ? `当前执行状态（${EXECUTION_STATUS_LABEL[execution.status]}）不能切换自动节点推进。`
          : undefined;
  const manualTargets = plan !== undefined && execution !== undefined ? advanceTargets(plan, execution) : { candidates: [], waiting: [] };
  const manualAdvanceVisible = !readOnly && !isFixed && execution !== undefined && execution.autoAdvance === false && ['running', 'paused'].includes(execution.status);
  const manualAdvanceReasonText = manualAdvanceVisible && execution !== undefined ? manualAdvanceReason(execution, manualTargets, plan, command.state.busy) : '开启自动推进时由服务自动领取下一步；关闭后才出现手动推进。';
  const startVisible = !readOnly && (execution === undefined || ['idle', 'ready'].includes(execution.status));
  const runPrimary = (action: CanvasPrimaryAction) => {
    switch (action.kind) {
      case 'accept':
        goAccept(action.nodeId);
        break;
      case 'delivery':
        requestDeliveryFocus();
        break;
      case 'inbox':
        navigate('/inbox');
        break;
      case 'resume':
        runResume();
        break;
      case 'reread':
        reuseRefresh();
        break;
      case 'recovery':
        if (taskId !== undefined) navigate(`/recovery?taskId=${encodeURIComponent(taskId)}`);
        break;
      case 'focus':
        if (action.nodeId !== undefined) openNode(action.nodeId);
        break;
    }
  };
  const snapshotTemplate = task.fixedTemplate?.snapshot === undefined ? undefined : task.fixedTemplate;

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
            {readOnly ? <Badge tone="wait" icon="lock">只读验证</Badge> : null}
            {isFixed ? (
              <Badge tone="wait" icon="lock">
                固定模板 · {task.fixedTemplate?.templateId} v{task.fixedTemplate?.templateVersion}
              </Badge>
            ) : null}
            <Badge tone={situation.status.tone} icon={situation.status.icon}>
              {situation.status.label}
            </Badge>
            {situation.secondary === undefined ? null : (
              <Badge tone={situation.secondary.tone} icon={situation.secondary.icon}>
                {situation.secondary.label}
              </Badge>
            )}
            {workspace === undefined ? null : (
              <button type="button" className="task-wschip" aria-label="工作区详情" title="工作区详情" onClick={() => { setWorkspaceOpen(true); }}>
                <Icon name={workspace.kind === 'git_worktree' ? 'branch' : 'folder'} size="sm" />
                <span>
                  {workspace.kind === 'git_worktree' ? 'worktree' : '独立副本'} · {WORKSPACE_STATE_LABEL[workspace.state]}
                </span>
              </button>
            )}
          </div>
          <div className="task-subline">
            <span>
              {readOnly ? '核对父任务已有产物' : <>计划修订 {plan?.revisionNumber ?? '—'} · {plan === undefined ? '无计划' : PLAN_REVISION_STATUS_LABEL[plan.status]}</>}
            </span>
            <span className="sep">·</span>
            <span>{readOnly ? '不创建新执行或工作区' : <>工作区 {workspace === undefined ? '未创建' : WORKSPACE_STATE_LABEL[workspace.state]}</>}</span>
            {execution === undefined ? null : (
              <>
                <span className="sep">·</span>
                <span>自动推进 {execution.autoAdvance ? '开启' : '关闭'}</span>
              </>
            )}
            {snapshotTemplate === undefined ? null : (
              <span className="task-snapseg" role="group" aria-label="运行面板">
                <Button size="sm" variant="ghost" icon="chart" onClick={() => { openExtras('snapshot-review'); }}>
                  执行进度
                </Button>
                <Button size="sm" variant="ghost" icon="doc" onClick={() => { openExtras('snapshot-review'); }}>
                  模板报告
                </Button>
              </span>
            )}
          </div>
        </div>

        <StageCapsule current={task.stage} lifecycle={task.lifecycle} attention={task.attention} compact className="task-stages" />

        <div className="task-acts">
          {startVisible ? (
            <Button
              variant="primary"
              size="sm"
              icon="play"
              disabled={command.state.busy || actions.startExecution?.allowed !== true}
              disabledReason={command.state.busy ? '正在提交操作，等待服务回执…' : actions.startExecution?.reason}
              onClick={runStart}
            >
              开始执行
            </Button>
          ) : null}
          {execution === undefined || readOnly ? null : (
            <span className={`task-auto${autoToggleAllowed ? '' : ' is-disabled'}`} title={autoToggleReason ?? (execution.autoAdvance ? '点击关闭：只影响后续领取' : '点击开启：验收通过后自动领取下一步')}>
              自动推进
              <button
                type="button"
                className="switch"
                role="switch"
                aria-checked={execution.autoAdvance}
                aria-label="自动节点推进"
                disabled={!autoToggleAllowed}
                onClick={() => { runToggleAutoAdvance(!execution.autoAdvance); }}
              />
            </span>
          )}
          {manualAdvanceVisible ? (
            <Button
              variant="primary"
              size="sm"
              icon="play"
              disabled={command.state.busy || manualAdvanceReasonText !== undefined}
              disabledReason={command.state.busy ? '正在提交操作，等待服务回执…' : manualAdvanceReasonText}
              onClick={runAdvanceAll}
            >
              {manualTargets.candidates.length > 0 ? `整体推进 · 启动 ${String(manualTargets.candidates.length)} 步` : '整体推进'}
            </Button>
          ) : null}
          {execution === undefined || readOnly ? null : (
            <Button
              variant="secondary"
              size="sm"
              icon="edit"
              disabled={actions.adjustExecutionPlan?.allowed !== true || command.state.busy}
              disabledReason={command.state.busy ? '正在提交操作，等待服务回执…' : actions.adjustExecutionPlan?.reason}
              onClick={openEdit}
            >
              调整待执行计划
            </Button>
          )}
          {execution?.status === 'running' && !readOnly ? (
            <Button variant="secondary" size="sm" icon="pause" disabled={command.state.busy || actions.pauseExecution?.allowed !== true} disabledReason={command.state.busy ? '正在提交操作，等待服务回执…' : actions.pauseExecution?.reason} onClick={runPause}>
              暂停
            </Button>
          ) : null}
          {execution?.status === 'paused' && !readOnly ? (
            <Button variant="secondary" size="sm" icon="play" disabled={command.state.busy || actions.resumeExecution?.allowed !== true} disabledReason={command.state.busy ? '正在提交操作，等待服务回执…' : actions.resumeExecution?.reason} onClick={runResume}>
              继续
            </Button>
          ) : null}
          {detail?.delivery !== undefined || execution?.status === 'completed' ? (
            <Button variant="secondary" size="sm" icon="doc" onClick={requestDeliveryFocus}>
              查看变更并交付
            </Button>
          ) : null}
          {isFixed && !readOnly ? (
            <Button variant="ghost" size="sm" icon="file" onClick={openRunContent}>
              阅读运行内容
            </Button>
          ) : null}
          <Button variant="secondary" size="sm" icon="file" onClick={openRequirement}>
            {readOnly ? '查看验证需求' : '需求画布'}
          </Button>
          <div className="task-menu-wrap" ref={menuRef}>
            <IconButton
              icon="more"
              label="更多任务操作"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              onClick={() => { setMenuOpen((current) => !current); }}
            />
            {!menuOpen ? null : (
              <div className="menu task-menu task-extras-menu" role="menu" aria-label="更多任务操作">
                {workspace === undefined ? null : (
                  <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); setWorkspaceOpen(true); }}>
                    <Icon name="folder" size="sm" />
                    工作区详情…
                  </button>
                )}
                <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); setPanelOpen(true); }}>
                  <Icon name="panel" size="sm" />
                  执行面板…
                </button>
                {execution === undefined || !['failed', 'stopped', 'unknown'].includes(execution.status) ? null : (
                  <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); if (taskId !== undefined) navigate(`/recovery?taskId=${encodeURIComponent(taskId)}`); }}>
                    <Icon name="refresh" size="sm" />
                    任务恢复…
                  </button>
                )}
                <button type="button" role="menuitem" onClick={() => { openExtras('freeze'); }}>
                  <Icon name="layers" size="sm" />
                  冻结计划快照…
                </button>
                <button type="button" role="menuitem" onClick={() => { openExtras('audit'); }}>
                  <Icon name="clock" size="sm" />
                  审计记录
                </button>
                {snapshotTemplate === undefined ? null : (
                  <button type="button" role="menuitem" onClick={() => { openExtras('snapshot-review'); }}>
                    <Icon name="eye" size="sm" />
                    快照评审
                  </button>
                )}
                {isFixed ? null : (
                  <button type="button" role="menuitem" onClick={openRunContent}>
                    <Icon name="terminal" size="sm" />
                    运行内容
                  </button>
                )}
                <hr />
                <button
                  type="button"
                  role="menuitem"
                  disabled={command.state.busy || execution?.status !== 'running' || actions.pauseExecution?.allowed !== true}
                  title={command.state.busy ? '正在提交操作，等待服务回执…' : execution?.status !== 'running' ? '当前没有运行中的执行' : actions.pauseExecution?.reason}
                  onClick={() => { setMenuOpen(false); runPause(); }}
                >
                  <Icon name="pause" size="sm" />
                  暂停任务…
                </button>
                <button
                  type="button"
                  role="menuitem"
                  disabled={command.state.busy || execution?.status !== 'paused' || actions.resumeExecution?.allowed !== true}
                  title={command.state.busy ? '正在提交操作，等待服务回执…' : execution?.status !== 'paused' ? '当前没有暂停的执行' : actions.resumeExecution?.reason}
                  onClick={() => { setMenuOpen(false); runResume(); }}
                >
                  <Icon name="play" size="sm" />
                  继续任务…
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="danger"
                  disabled={command.state.busy || actions.cancelExecution?.allowed !== true}
                  title={command.state.busy ? '正在提交操作，等待服务回执…' : actions.cancelExecution?.reason}
                  onClick={() => { setMenuOpen(false); setCancelOpen(true); }}
                >
                  <Icon name="stop" size="sm" />
                  停止任务…
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className={`task-situ situ-${situation.mode}`} role="status" aria-live="polite">
        {situation.facts.map((fact, index) => (
          <span key={fact.key} className={`situ-fact situ-${fact.color}`}>
            <span className="situ-fk">{fact.label}</span>
            <span className="situ-fv">
              <Icon name={fact.icon} size="sm" />
              <span>{fact.text}</span>
            </span>
            {index === situation.facts.length - 1 ? null : <span className="sep" aria-hidden="true" />}
          </span>
        ))}
        <span className="grow" />
        {situation.primary === undefined ? (
          <span className="hint">
            {readOnly
              ? '只读验证：核对父任务已有产物'
              : execution?.notice !== undefined
                ? execution.notice.message
                : execution?.status === 'running'
                  ? `没有需要你处理的事 · 下一步：${execution.autoAdvance ? '步骤验收通过后自动开始下游步骤' : '验收通过后由你「整体推进」'}`
                  : execution?.status === 'paused'
                    ? '下一步：继续任务后恢复调度；也可以先调整待执行计划'
                    : execution?.status === 'idle' || execution?.status === 'ready'
                      ? '下一步：准备工作区完成后开始执行'
                      : '下一步以服务回读的状态为准'}
          </span>
        ) : (
          <Button size="sm" variant={situation.mode === 'fail' || situation.mode === 'need' || situation.mode === 'wait' ? 'primary' : 'secondary'} icon={situation.primary.icon} onClick={() => { runPrimary(situation.primary!); }}>
            {situation.primary.label}
          </Button>
        )}
      </div>

      <div className="task-banners">
        <ConnectionBanner connection={live.connection} transport={live.transport} />
        {readOnly ? <div className="banner info" role="status"><Icon name="lock" /><div className="grow"><b>只读验证</b> · {readOnlyReason}</div></div> : null}
        <CommandErrorNotice error={command.state.error} />
        <ReceiptNotice receipt={command.state.receipt} successMessage={lastCommand === undefined ? undefined : `${lastCommand} · 服务回执 succeeded`} />
        <ReceiptNotice receipt={pageReceipt} successMessage={pageReceiptMessage} />
        {pendingAcceptance.length > 0 ? (
          <div className="banner warn" role="status">
            <Icon name="eye" />
            <div className="grow">
              <b>{String(pendingAcceptance.length)} 个已执行步骤待人工验收</b>
              <br />
              {acceptancePaused
                ? acceptanceUserPaused
                  ? '任务已被你暂停：验收结论不会自动恢复执行；验收后点页面上的“继续”按钮。'
                  : '执行已停在验收点：全部待验收步骤通过后服务会自动继续；退回修改后需按原配置重试。'
                : execution?.status === 'waiting_confirmation'
                  ? '执行在等待重新确认；验收结论不会跳过计划确认。'
                  : '验收通过前不会结束执行或放行下游步骤；退回修改后可按原配置重试。'}
              {execution?.notice === undefined ? null : ` ${execution.notice.message}`}
            </div>
            <div className="actions">
              <Button
                variant="primary"
                size="sm"
                icon="check"
                title={`打开「${planNodeTitle(firstAcceptanceNodeId)}」的验收区`}
                onClick={() => goAccept(firstAcceptanceNodeId)}
              >
                去验收
              </Button>
              <Button variant="ghost" size="sm" icon="refresh" onClick={reuseRefresh}>
                重新读取
              </Button>
            </div>
          </div>
        ) : acceptanceFallbackIds.length > 0 ? (
          <div className="banner info" role="status">
            <Icon name="info" />
            <div className="grow">
              <b>{String(acceptanceFallbackIds.length)} 个已执行步骤可能有待人工验收。</b>
              <br />
              {executionViewQuery.isError
                ? '验收投影读取失败；这里只按计划验收条款与节点成功状态降级提示，结论需逐个打开节点按服务事实核对。'
                : '服务未返回验收投影（旧版读模型）；这里只按计划验收条款与节点成功状态降级提示，结论需逐个打开节点按服务事实核对。'}
            </div>
            <div className="actions">
              <Button variant="secondary" size="sm" icon="eye" onClick={() => goAccept(acceptanceFallbackIds[0])}>
                逐个打开核对
              </Button>
            </div>
          </div>
        ) : null}
        {rejectedAcceptance.length > 0 ? (
          <div className="banner danger" role="alert">
            <Icon name="alert" />
            <div className="grow">
              <b>{String(rejectedAcceptance.length)} 个步骤已被退回修改</b>
              <br />
              「{planNodeTitle(firstRejectedNodeId)}」等需要按原配置重试后再验收；重试会创建新的 attempt 并清除退回结论，已验收通过的步骤不受影响。
            </div>
            <div className="actions">
              <Button
                variant="secondary"
                size="sm"
                icon="refresh"
                disabled={command.state.busy || actions.retryExecution?.allowed === false}
                disabledReason={command.state.busy ? '正在提交，等待服务回执…' : actions.retryExecution?.reason}
                onClick={runRetryRejected}
              >
                按原配置重试失败 / 被退回步骤
              </Button>
              <Button variant="ghost" size="sm" icon="eye" onClick={() => goAccept(firstRejectedNodeId)}>
                查看退回原因
              </Button>
            </div>
          </div>
        ) : null}
        {execution?.status === 'unknown' ? (
          <div className="banner unknown">
            <Icon name="help" />
            <div className="grow">
              <b>执行结果待核对。</b>不会自动重发；以服务回读的状态为准。可按原配置重试失败步骤、跳过节点或取消执行（保留工作区）。
            </div>
            <div className="actions">
              <Button variant="secondary" size="sm" icon="refresh" onClick={reuseRefresh}>
                立即重新读取
              </Button>
              <Button
                variant="ghost"
                size="sm"
                icon="refresh"
                onClick={() => {
                  if (taskId !== undefined) navigate(`/recovery?taskId=${encodeURIComponent(taskId)}`);
                }}
              >
                到恢复页处理
              </Button>
            </div>
            <p className="hint" style={{ flexBasis: '100%', marginTop: 4 }}>
              画布按实时连接自动重读；手动重新读取只核对服务当前状态，不会重发写操作。恢复/重试与核对是两件事。
            </p>
          </div>
        ) : null}
        {!readOnly && plan !== undefined && plan.status === 'unconfirmed' && !isFixed ? (
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
        {isFixed && !readOnly ? (
          <div className="banner info">
            <Icon name="lock" />
            <div className="grow">
              <b>{FIXED_TEMPLATE_REASON}</b>
              <div className="fixed-template-lists">
                <div>
                  <div className="eyebrow">不能做的事</div>
                  <ul className="list-plain">
                    <li>新增 / 删除步骤、改依赖、职业、模型、验收或模板参数</li>
                    <li>让 AI 细化或调整计划（固定模板 = 固定流程）</li>
                  </ul>
                </div>
                <div>
                  <div className="eyebrow">可以做的事</div>
                  <ul className="list-plain">
                    <li>查看与确认计划、准备独立工作区、按原配置开始执行</li>
                    <li>查看执行现场、人工验收、按原配置重试失败步骤</li>
                    <li>查看变更并交付；要改要求请新建模板任务</li>
                  </ul>
                </div>
              </div>
            </div>
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
              icon={readOnly ? 'lock' : 'flow'}
              title={readOnly ? '只读验证已有产物' : '当前没有可显示的节点'}
              description={readOnly ? readOnlyReason : plan === undefined ? '服务还没有返回计划；确认计划后执行画布才会显示步骤。' : '计划图里没有节点；这里不会补造步骤。'}
              action={
                <Button size="sm" variant="secondary" icon="file" onClick={openRequirement}>
                  {readOnly ? '查看验证需求' : '回到需求画布'}
                </Button>
              }
            />
          }
        />

        {nodeId !== undefined ? (
          <NodeDetailPanel
            taskId={taskId}
            nodeId={nodeId}
            connection={live.connection}
            pollInterval={live.refetchInterval}
            plan={plan}
            execution={execution}
            focusAcceptance={acceptFocus}
            focusAcceptanceToken={acceptFocusToken}
            onClose={closeNode}
            onOpenPlan={openRequirement}
          />
        ) : deliveryOpen ? (
          <TaskDeliveryPanel
            taskId={taskId}
            focusChangesRequest={deliveryFocusRequest}
            onClose={() => patchParams({ delivery: undefined })}
            onOpenChanges={requestDeliveryFocus}
          />
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
                onAbandoned={(receipt) => {
                  setPageReceipt(receipt);
                  setPageReceiptMessage('已放弃调整：计划修订未变更，服务已恢复进入调整前的自动推进与暂停设置。');
                  setEditMode(false);
                }}
              />
            </div>
          </aside>
        ) : extrasMode !== null ? (
          <TaskExtrasPanel taskId={taskId} mode={extrasMode} plan={plan} onClose={() => { setExtrasMode(null); }} />
        ) : panelOpen ? (
          // P13-03: the right panel is hidden by default (design `.side.hidden`);
          // it only opens from a step click or an explicit 更多 → 执行面板 action.
          <aside className="side task-side" aria-label="执行面板">
            <div className="side-head task-side-head">
              <h2 className="grow">执行面板</h2>
              <Badge tone={execution?.status === 'running' ? 'run' : execution?.status === 'failed' ? 'fail' : 'idle'}>{EXECUTION_STATUS_LABEL[execution?.status ?? 'idle']}</Badge>
              <IconButton icon="x" label="关闭执行面板，回到全图" onClick={() => { setPanelOpen(false); }} />
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
                onToggleAutoAdvance={runToggleAutoAdvance}
                onAdvanceAll={runAdvanceAll}
                onAdvanceSuccessors={runAdvanceSuccessors}
                onOpenNode={openNode}
                onOpenEdit={openEdit}
                onOpenRequirement={openRequirement}
              />
            </div>
          </aside>
        ) : null}
      </div>

      <Modal
        open={cancelOpen}
        title="取消执行"
        onClose={() => setCancelOpen(false)}
        footer={
          <>
            {workspace === undefined ? null : (
              <Button variant="ghost" size="sm" icon="folder" onClick={() => { setCancelOpen(false); setWorkspaceOpen(true); }}>
                查看工作区详情
              </Button>
            )}
            <span className="spacer" />
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
        <p className="cancel-retain">
          <Icon name="lock" size="sm" />
          <span>
            <b>文件保留，可稍后交付 / 查看。</b>任务{workspace?.kind === 'git_worktree' ? '工作区与任务分支' : '副本'}不会被清理；可查看变更、交付已完成的部分，或在工作区详情中单独清理。
          </span>
        </p>
        <p className="hint" style={{ marginTop: 8 }}>
          当前状态：{EXECUTION_STATUS_LABEL[execution?.status ?? 'idle']}。运行中的步骤可能先完成当前快照。
        </p>
      </Modal>

      <WorkspaceDetailDrawer
        open={workspaceOpen}
        task={task}
        {...(plan === undefined ? {} : { plan })}
        {...(execution === undefined ? {} : { execution })}
        {...(workspace === undefined ? {} : { workspace })}
        {...(detail.delivery === undefined ? {} : { delivery: detail.delivery })}
        onClose={() => { setWorkspaceOpen(false); }}
        onRefresh={async () => {
          await detailQuery.refetch();
          await executionViewQuery.refetch();
        }}
      />
    </div>
  );
}
