import { useEffect, useMemo, useRef, useState } from 'react';
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

  const graph = useMemo(() => {
    if (plan === undefined) return EMPTY_FLOW_GRAPH;
    const nodeIds = plan.graph.nodes.map((node) => node.id);
    return planRevisionToFlow(plan, {
      layer: 'current',
      execution,
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
            {task.attention === 'none' ? null : (
              <Badge tone={task.attention === 'waiting_user' ? 'wait' : task.attention === 'failed' ? 'fail' : task.attention === 'blocked' ? 'stall' : 'unknown'} icon={task.attention === 'failed' ? 'x' : 'help'}>
                {TASK_ATTENTION_LABEL[task.attention]}
              </Badge>
            )}
          </div>
          <div className="task-subline">
            <span>
              {readOnly ? '核对父任务已有产物' : <>{EXECUTION_STATUS_LABEL[execution?.status ?? 'idle']} · 计划修订 {plan?.revisionNumber ?? '—'} · {plan === undefined ? '无计划' : PLAN_REVISION_STATUS_LABEL[plan.status]}</>}
            </span>
            <span className="sep">·</span>
            <span>{readOnly ? '不创建新执行或工作区' : <>工作区 {workspace === undefined ? '未创建' : WORKSPACE_STATE_LABEL[workspace.state]}</>}</span>
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
              disabledReason={command.state.busy ? '正在提交操作，等待服务回执…' : actions.adjustExecutionPlan?.reason}
              onClick={openEdit}
            >
              调整待执行计划
            </Button>
          )}
          {execution?.status === 'running' ? (
            <Button variant="secondary" size="sm" icon="pause" disabled={command.state.busy || actions.pauseExecution?.allowed !== true} disabledReason={command.state.busy ? '正在提交操作，等待服务回执…' : actions.pauseExecution?.reason} onClick={runPause}>
              暂停
            </Button>
          ) : null}
          {execution?.status === 'paused' ? (
            <Button variant="secondary" size="sm" icon="play" disabled={command.state.busy || actions.resumeExecution?.allowed !== true} disabledReason={command.state.busy ? '正在提交操作，等待服务回执…' : actions.resumeExecution?.reason} onClick={runResume}>
              继续
            </Button>
          ) : null}
          {detail?.delivery !== undefined || execution?.status === 'completed' ? (
            <Button variant="secondary" size="sm" icon="doc" onClick={requestDeliveryFocus}>
              查看变更并交付
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
                <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); if (taskId !== undefined) navigate(`/recovery?taskId=${encodeURIComponent(taskId)}`); }}>
                  <Icon name="refresh" size="sm" />
                  任务恢复…
                </button>
                <button type="button" role="menuitem" onClick={() => { openExtras('freeze'); }}>
                  <Icon name="layers" size="sm" />
                  冻结计划…
                </button>
                <button type="button" role="menuitem" onClick={() => { openExtras('audit'); }}>
                  <Icon name="clock" size="sm" />
                  审计记录
                </button>
                {task.fixedTemplate?.snapshot === undefined ? null : <button type="button" role="menuitem" onClick={() => { openExtras('snapshot-review'); }}>
                  <Icon name="eye" size="sm" />
                  快照评审
                </button>}
                <button type="button" role="menuitem" onClick={openRunContent}>
                  <Icon name="terminal" size="sm" />
                  运行内容
                </button>
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
        {pendingAcceptanceCount > 0 ? (
          <span className="situ-kv warn">
            <span className="k">待验收</span>
            {pendingAcceptanceCount}
          </span>
        ) : null}
        {rejectedAcceptance.length > 0 ? (
          <span className="situ-kv warn">
            <span className="k">已退回</span>
            {rejectedAcceptance.length}
          </span>
        ) : null}
        {editSession === undefined ? null : (
          <span className="situ-kv warn">
            <span className="k">调整</span>
            {editSession.state === 'editing' ? '编辑中' : editSession.state === 'saved' ? '已保存 · 待重新确认' : editSession.state === 'conflict' ? '领取竞态' : editSession.state}
          </span>
        )}
        <span className="situ-notice">
          {readOnly ? '只读验证：核对父任务已有产物。' : execution?.notice === undefined ? (execution === undefined ? '执行尚未创建；下一步在需求画布准备工作区。' : '没有待处理情况。') : execution.notice.message}
        </span>
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
              <Button
                variant="secondary"
                size="sm"
                icon="refresh"
                onClick={() => {
                  if (taskId !== undefined) navigate(`/recovery?taskId=${encodeURIComponent(taskId)}`);
                }}
              >
                到恢复页处理
              </Button>
            </div>
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
                onToggleAutoAdvance={runToggleAutoAdvance}
                onAdvanceAll={runAdvanceAll}
                onAdvanceSuccessors={runAdvanceSuccessors}
                onOpenNode={openNode}
                onOpenEdit={openEdit}
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
