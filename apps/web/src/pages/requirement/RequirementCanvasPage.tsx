import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  PLANNING_STAGE_LABEL,
  PLAN_REVISION_STATUS_LABEL,
  TASK_ATTENTION_LABEL,
  TASK_STAGE_LABEL,
  TaskStage,
  type ActionAvailability,
  type PlanLayerValue,
  type PlanningPreviewResponse,
  type PlanningRound,
  type TaskDetailResponse,
} from '@agent-workflow/shared';
import { useBootstrap } from '../../api/hooks.ts';
import { isApiClientError } from '../../api/client.ts';
import {
  applyPlanSkeleton,
  findTemplate,
  prepareWorkspace,
  reconcilePlanning,
  savePlanningAnswers,
  startExecution,
  usePlanRevision,
  usePlanningRecord,
  useRequirementView,
  useTaskDetail,
  useTaskLiveUpdates,
  useWorkflowCommand,
  useWorkflowRefresh,
} from '../../api/workflow.ts';
import { Badge } from '../../components/Badge.tsx';
import { Button, LinkButton } from '../../components/Button.tsx';
import { IconButton } from '../../components/IconButton.tsx';
import { EmptyState, Skeleton, SkeletonText } from '../../components/EmptyState.tsx';
import { ServiceNotice } from '../../components/ServiceNotice.tsx';
import { StageCapsule } from '../../components/StageCapsule.tsx';
import { Icon } from '../../components/Icon.tsx';
import { FlowCanvas, type FlowLegendItem } from '../../flow/FlowCanvas.tsx';
import { planRevisionToFlow, EMPTY_FLOW_GRAPH, type FlowLayerOption } from '../../flow/index.ts';
import { CommandErrorNotice, ConnectionBanner, ReceiptNotice } from '../../flow/workflow-ui.tsx';
import type { OperationReceipt } from '@agent-workflow/shared';
import { ChecksPanel } from './ChecksPanel.tsx';
import { DraftPanel } from './DraftPanel.tsx';
import { PlanningRecordPanel } from './PlanningRecordPanel.tsx';
import { PlanningStrip } from './PlanningStrip.tsx';
import { PlanReviewPanel } from './PlanReviewPanel.tsx';
import { RequirementPanel } from './RequirementPanel.tsx';
import { TrackingPanel } from './TrackingPanel.tsx';
import { WorkspacePanel } from './WorkspacePanel.tsx';
import { ApplyCandidateDialog, ConfirmPlanDialog, PlanningPreviewDialog, RejectCandidateDialog, StopPlanningDialog } from './dialogs.tsx';
import { planStatusText, roundIsActive, roundIsUnknown, selectRound } from './requirement-utils.ts';
import './requirement.css';

type PanelTab = 'input' | 'plan' | 'check' | 'records' | 'draft' | 'workspace' | 'tracking';

const TAB_LABEL: Record<PanelTab, string> = {
  input: '需求与输入',
  plan: '计划',
  check: '检查',
  records: '规划记录',
  draft: '草稿与问题',
  workspace: '工作区',
  tracking: '执行追踪',
};

const TAB_ORDER: readonly PanelTab[] = ['input', 'plan', 'check', 'records', 'draft', 'workspace', 'tracking'];

type DialogKind = 'preview' | 'apply' | 'reject' | 'stop' | 'confirm' | null;

function deriveTabs(detail: TaskDetailResponse, round: PlanningRound | undefined): readonly PanelTab[] {
  const tabs = new Set<PanelTab>(['input']);
  const plan = detail.plan;
  if (plan !== undefined || round?.candidate !== undefined) tabs.add('plan');
  if (plan?.validation !== undefined || round?.candidate?.validation !== undefined) tabs.add('check');
  if (round !== undefined) {
    tabs.add('records');
    if (
      round.stage === 'needs_answer' ||
      round.questions.length > 0 ||
      round.assumptions.length > 0 ||
      round.candidate?.checkpoint !== undefined
    ) {
      tabs.add('draft');
    }
  }
  if (detail.task.stage === TaskStage.PREPARING || detail.task.stage === TaskStage.EXECUTING || detail.workspace?.state === 'ready' || plan?.status === 'confirmed') {
    tabs.add('workspace');
  }
  if (detail.task.stage === TaskStage.EXECUTING) tabs.add('tracking');
  return TAB_ORDER.filter((tab) => tabs.has(tab));
}

function defaultTab(detail: TaskDetailResponse, round: PlanningRound | undefined): PanelTab {
  if (detail.task.stage === TaskStage.EXECUTING) return 'tracking';
  if (round?.candidate !== undefined) return 'plan';
  if (detail.workspace?.state === 'preparing') return 'workspace';
  if (round?.stage === 'needs_answer') return 'draft';
  if (round !== undefined && roundIsActive(round)) return 'records';
  if (detail.plan?.status === 'confirmed') return 'workspace';
  if (detail.plan !== undefined) return 'plan';
  return 'input';
}

function parseViewport(value: string | null): { x: number; y: number; zoom: number } | undefined {
  if (value === null) return undefined;
  const parts = value.split(',').map((part) => Number(part));
  if (parts.length !== 3) return undefined;
  const [x, y, zoom] = parts;
  if (x === undefined || y === undefined || zoom === undefined) return undefined;
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(zoom) || zoom <= 0) return undefined;
  return { x, y, zoom };
}

function formatStoppedFacts(round: PlanningRound): string {
  const stop = round.stop;
  if (stop === undefined) return '服务未返回停止状态';
  const process = stop.processState === 'stopped' ? '已停稳' : stop.processState === 'stopping' ? '正在停稳' : stop.processState === 'running' ? '仍在运行' : '未知';
  const accounting = stop.accountingState === 'closed' ? '已结账' : stop.accountingState === 'open' ? '未结账' : '未知';
  return `停止请求：${stop.requestKey === undefined ? '无回执号' : '已受理'} · 原进程：${process} · 用量：${accounting}`;
}

/** 需求画布：需求草稿 → 规划 → 候选审阅/应用 → 确认计划 → 准备工作区 → 开始执行。 */
export function RequirementCanvasPage() {
  const { requirementId } = useParams<{ requirementId: string }>();
  const taskId = requirementId;
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const bootstrap = useBootstrap();
  const live = useTaskLiveUpdates(taskId);
  const detailQuery = useTaskDetail(taskId, live.refetchInterval);
  const requirementQuery = useRequirementView(taskId);
  const refresh = useWorkflowRefresh(taskId ?? '');
  const command = useWorkflowCommand(taskId ?? '');

  const detail = detailQuery.data;
  const rounds = detail?.planning?.rounds ?? [];
  const round = selectRound(rounds, searchParams.get('round'), detail?.planning?.currentRoundId);
  const currentRoundId = detail?.planning?.currentRoundId;
  const historical = round !== undefined && currentRoundId !== undefined && round.id !== currentRoundId;
  const plan = detail?.plan;
  const candidate = round?.candidate;
  const candidateRevisionQuery = usePlanRevision(taskId, candidate?.planRevisionId);
  const checkpointRevisionQuery = usePlanRevision(taskId, candidate?.checkpoint?.planRevisionId);
  const recordQuery = usePlanningRecord(taskId, round?.id, live.refetchInterval);
  const candidateRevision = candidateRevisionQuery.data;
  const checkpointRevision = checkpointRevisionQuery.data;

  const [dialog, setDialog] = useState<DialogKind>(null);
  const [pageReceipt, setPageReceipt] = useState<OperationReceipt | undefined>(undefined);
  const [acceptedDecisions, setAcceptedDecisions] = useState<Record<string, boolean>>({});
  const [reconciling, setReconciling] = useState(false);
  const [reconcileMessage, setReconcileMessage] = useState<string | undefined>(undefined);
  const [reconcileError, setReconcileError] = useState<unknown>(null);
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<readonly string[]>([]);
  const [lastPreview, setLastPreview] = useState<PlanningPreviewResponse | undefined>(undefined);

  useEffect(() => {
    setAcceptedDecisions({});
  }, [candidate?.planRevisionId, round?.id]);

  const patchParams = useCallback(
    (patch: Readonly<Record<string, string | undefined>>) => {
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
    },
    [setSearchParams],
  );

  const tabs: readonly PanelTab[] = detail === undefined ? ['input'] : deriveTabs(detail, round);
  const requestedTab = searchParams.get('tab');
  const tab: PanelTab =
    requestedTab !== null && (tabs as readonly string[]).includes(requestedTab) ? (requestedTab as PanelTab) : detail === undefined ? 'input' : defaultTab(detail, round);

  const selectedNodeId = searchParams.get('sel') ?? undefined;
  const viewport = parseViewport(searchParams.get('view'));

  const layerOptions = useMemo<FlowLayerOption[]>(() => {
    if (detail === undefined) return [];
    const options: FlowLayerOption[] = [];
    options.push(plan === undefined ? { value: 'current', label: '当前草稿', disabledReason: '尚无当前计划' } : { value: 'current', label: '当前草稿' });
    options.push(
      candidate?.checkpoint === undefined
        ? { value: 'partial', label: '部分草稿', disabledReason: '服务尚未保存部分草稿（检查点）' }
        : { value: 'partial', label: '部分草稿' },
    );
    options.push(candidate === undefined ? { value: 'candidate', label: '候选', disabledReason: '服务尚未返回候选计划修订' } : { value: 'candidate', label: '候选' });
    options.push(candidate === undefined ? { value: 'compare', label: '对照', disabledReason: '服务尚未返回候选计划修订' } : { value: 'compare', label: '对照' });
    return options;
  }, [candidate, detail, plan]);

  const requestedLayer = searchParams.get('layer');
  const layerEnabled = (value: PlanLayerValue): boolean => layerOptions.some((option) => option.value === value && option.disabledReason === undefined);
  const layer: PlanLayerValue =
    requestedLayer !== null && (requestedLayer === 'current' || requestedLayer === 'partial' || requestedLayer === 'candidate' || requestedLayer === 'compare') && layerEnabled(requestedLayer)
      ? requestedLayer
      : candidate !== undefined
        ? historical
          ? 'candidate'
          : 'compare'
        : 'current';

  const isFixed = detail?.task.fixedTemplate !== undefined;
  const fixedReason = '该任务使用固定模板，创建后不能修改步骤；要改要求，请新建模板任务。';
  const capabilities: Record<string, ActionAvailability> = detail?.capabilities ?? {};

  const graph = useMemo(() => {
    if (detail === undefined) return EMPTY_FLOW_GRAPH;
    const lockAll = isFixed
      ? {
          lockedNodeIds: [] as string[],
          lockedReason: fixedReason,
        }
      : undefined;

    if (layer === 'partial') {
      if (checkpointRevision === undefined) return EMPTY_FLOW_GRAPH;
      return planRevisionToFlow(checkpointRevision, {
        layer,
        missingGroups: candidate?.checkpoint?.missingGroups,
        badge: { label: '部分草稿 · 检查点 · 尚未完成，不能执行', tone: 'unknown', icon: 'help' },
        ...(lockAll === undefined ? {} : lockAll),
      });
    }
    if (layer === 'candidate' || layer === 'compare') {
      if (candidateRevision === undefined) return EMPTY_FLOW_GRAPH;
      return planRevisionToFlow(candidateRevision, {
        layer,
        diff: candidate?.diff,
        dimUnchanged: layer === 'compare',
        ...(layer === 'candidate'
          ? { badge: { label: `候选 · 第 ${String(round?.ordinal ?? '?')} 轮 · 未应用（只读）`, tone: 'accent', icon: 'eye' } }
          : {}),
        ...(lockAll === undefined ? {} : lockAll),
      });
    }
    if (plan !== undefined) {
      const nodeIds = plan.graph.nodes.map((node) => node.id);
      return planRevisionToFlow(plan, {
        layer: 'current',
        execution: detail.execution,
        badge: {
          label: `当前草稿 · 计划修订 ${String(plan.revisionNumber)} · ${PLAN_REVISION_STATUS_LABEL[plan.status]}`,
          tone: plan.status === 'confirmed' ? 'done' : plan.status === 'draft' ? 'unknown' : 'wait',
          icon: plan.status === 'confirmed' ? 'check' : 'edit',
        },
        ...(isFixed
          ? { lockedNodeIds: nodeIds, lockedReason: fixedReason }
          : historical
            ? { lockedNodeIds: nodeIds, lockedReason: '历史轮次只读' }
            : {}),
      });
    }
    return EMPTY_FLOW_GRAPH;
  }, [candidate?.diff, candidate?.checkpoint?.missingGroups, candidateRevision, checkpointRevision, detail, fixedReason, historical, isFixed, layer, plan, round?.ordinal]);

  const legend = useMemo<FlowLegendItem[]>(() => {
    if (layer === 'compare') {
      return [
        { label: '新增', swatch: 'added' },
        { label: '修改', swatch: 'modified' },
        { label: '细化替换', swatch: 'replaced' },
        { label: '未变', swatch: 'node' },
      ];
    }
    if (detail?.execution !== undefined) {
      return [
        { label: '执行中', swatch: 'run' },
        { label: '已完成', swatch: 'done' },
        { label: '失败', swatch: 'fail' },
        { label: '未知', swatch: 'unknown' },
      ];
    }
    return [];
  }, [detail?.execution, layer]);

  const saveAnswerAction = capabilities.saveAnswer;
  const acceptedIds = (candidate?.validation.humanReview.items ?? []).filter((item) => item.accepted || acceptedDecisions[item.id] === true).map((item) => item.id);
  const candidateUnsettled = candidate !== undefined && round !== undefined && round.status !== 'completed';
  const staleInput = candidate !== undefined && round !== undefined && detail !== undefined && round.inputRevision !== detail.task.requirement.revision;
  const roundUnknown = roundIsUnknown(round);
  const roundActive = roundIsActive(round);

  const runSkeleton = () => {
    if (taskId === undefined) return;
    void command.run(() => applyPlanSkeleton(taskId));
  };

  const runPrepare = () => {
    if (taskId === undefined || plan === undefined) return;
    void command.run(() => prepareWorkspace(taskId, { expectedPlanRevisionNumber: plan.revisionNumber }));
  };

  const runStartExecution = () => {
    if (taskId === undefined) return;
    void command
      .run(() => startExecution(taskId, detail?.execution?.status))
      .then((response) => {
        if (response?.receipt.status === 'succeeded') navigate(`/tasks/${encodeURIComponent(taskId)}`);
      });
  };

  const runSaveAnswers = (answers: readonly { questionId: string; answer: string }[]) => {
    if (taskId === undefined || round === undefined) return;
    void command.run(() => savePlanningAnswers(taskId, { roundId: round.id, answers }));
  };

  const runReconcile = () => {
    if (taskId === undefined || round === undefined) return;
    setReconciling(true);
    setReconcileError(null);
    setReconcileMessage(undefined);
    void reconcilePlanning(taskId, round.id)
      .then(async (result) => {
        setReconcileMessage(`核对完成：${result.round.status} · ${PLANNING_STAGE_LABEL[result.round.stage]}`);
        await refresh();
      })
      .catch((caught: unknown) => {
        setReconcileError(caught);
      })
      .finally(() => {
        setReconciling(false);
      });
  };

  const openTaskCanvas = (nodeId?: string) => {
    if (taskId === undefined) return;
    navigate(`/tasks/${encodeURIComponent(taskId)}${nodeId === undefined ? '' : `?node=${encodeURIComponent(nodeId)}`}`);
  };

  if (taskId === undefined) {
    return (
      <div className="page">
        <EmptyState icon="file" title="缺少需求标识" description="URL 中没有任务标识，无法读取需求画布。" />
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
            icon="file"
            title="任务不存在"
            description="服务返回 404；可能已被归档或标识错误。这里不展示任何缓存数据。"
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

  const { task, project, workspace } = detail;
  const template = findTemplate(bootstrap.data?.catalog.templates ?? [], task.fixedTemplate?.templateId);
  const executing = task.stage === TaskStage.EXECUTING;
  const preparing = task.stage === TaskStage.PREPARING;
  const planConfirmed = plan?.status === 'confirmed';

  const method = requirementQuery.data?.method;
  const methodBlockReason =
    requirementQuery.data !== undefined && method === null
      ? '任务引用的流程方法不在当前目录中，不能生成计划'
      : method?.support === 'skeleton_only'
        ? '该流程尚未配置 AI 规划；可使用骨架并手动调整'
        : undefined;
  const generateAction: ActionAvailability | undefined = methodBlockReason === undefined ? capabilities.generatePlan : { allowed: false, reason: methodBlockReason };
  const skeletonAction = capabilities.useSkeleton;
  const stopAction = capabilities.stopPlanning;
  const reconcileAction = capabilities.reconcile;

  const contextAction = (() => {
    if (historical) {
      return { label: '回到当前轮次', icon: 'undo' as const, onClick: () => patchParams({ round: undefined, sel: undefined }), disabledReason: undefined };
    }
    if (roundActive) return { label: '停止规划', icon: 'stop' as const, onClick: () => setDialog('stop'), disabledReason: stopAction?.allowed === true ? undefined : stopAction?.reason };
    if (candidate !== undefined) return { label: '审阅候选', icon: 'eye' as const, onClick: () => patchParams({ tab: 'plan', layer: 'compare' }), disabledReason: undefined };
    if (planConfirmed) return { label: '去准备工作区', icon: 'folder' as const, onClick: () => patchParams({ tab: 'workspace' }), disabledReason: undefined };
    if (plan !== undefined) return { label: '审阅计划', icon: 'file' as const, onClick: () => patchParams({ tab: 'plan' }), disabledReason: undefined };
    return { label: '生成计划', icon: 'sparkle' as const, onClick: () => setDialog('preview'), disabledReason: generateAction?.allowed === true ? undefined : generateAction?.reason };
  })();

  const statusSubline = (() => {
    if (executing) return '执行已开始 · 规划面板只读';
    if (preparing) return '计划已确认 · 待准备工作区';
    if (candidate !== undefined) return candidateUnsettled ? '候选已到 · 正在核对本轮结束' : '候选待审阅';
    if (roundUnknown) return '结果待核对';
    if (round?.stage === 'needs_answer') return '需要你答复';
    if (round !== undefined && roundActive) return `${PLANNING_STAGE_LABEL[round.stage]}中`;
    if (planConfirmed) return planStatusText(plan);
    if (plan !== undefined) return planStatusText(plan);
    return '尚无计划';
  })();

  return (
    <div className="canvas-page requirement-canvas">
      <div className="canvas-bar req-bar">
        <div className="req-bar-main">
          <div className="req-title-row">
            <span className="task-title" title={task.title}>
              {task.title}
            </span>
            <Badge outline>{project.name}</Badge>
            <Badge outline>{task.id}</Badge>
            {isFixed ? (
              <Badge tone="wait" icon="lock">
                固定模板 · {template?.name ?? task.fixedTemplate?.templateId} v{task.fixedTemplate?.templateVersion}
              </Badge>
            ) : null}
            {task.attention === 'none' ? null : (
              <Badge tone={task.attention === 'waiting_user' ? 'wait' : task.attention === 'failed' ? 'fail' : task.attention === 'blocked' ? 'stall' : 'unknown'} icon={task.attention === 'failed' ? 'x' : 'help'}>
                {TASK_ATTENTION_LABEL[task.attention]}
              </Badge>
            )}
          </div>
          <div className="req-subline">
            <span>{TASK_STAGE_LABEL[task.stage]} · {statusSubline}</span>
            <span className="sep">·</span>
            <span>{task.methodId}</span>
            {round === undefined ? null : (
              <>
                <span className="sep">·</span>
                <span>{PLANNING_STAGE_LABEL[round.stage]}</span>
              </>
            )}
            <span className="sep">·</span>
            <span className="mono">{task.requirement.revision} 修订</span>
          </div>
        </div>

        <StageCapsule current={task.stage} lifecycle={task.lifecycle} attention={task.attention} className="req-stages" />

        <div className="req-acts">
          {historical ? null : (
            <>
              <Button
                variant={roundActive ? 'danger' : 'primary'}
                size="sm"
                icon={contextAction.icon}
                disabled={contextAction.disabledReason !== undefined || command.state.busy}
                disabledReason={contextAction.disabledReason}
                onClick={contextAction.onClick}
              >
                {contextAction.label}
              </Button>
              {roundActive || candidate !== undefined || planConfirmed ? null : (
                <Button
                  variant="secondary"
                  size="sm"
                  icon="sparkle"
                  disabled={generateAction?.allowed !== true || command.state.busy}
                  disabledReason={generateAction?.reason}
                  onClick={() => setDialog('preview')}
                >
                  {plan === undefined ? '生成计划' : 'AI 细化计划'}
                </Button>
              )}
              {plan !== undefined || candidate !== undefined ? null : (
                <Button
                  variant="secondary"
                  size="sm"
                  icon="layers"
                  disabled={skeletonAction?.allowed !== true || command.state.busy}
                  disabledReason={skeletonAction?.reason}
                  onClick={runSkeleton}
                >
                  使用方法骨架
                </Button>
              )}
              {roundUnknown ? (
                <Button variant="secondary" size="sm" icon="refresh" disabled={reconciling || reconcileAction?.allowed !== true} disabledReason={reconcileAction?.reason} onClick={runReconcile}>
                  {reconciling ? '正在核对…' : '核对原轮次'}
                </Button>
              ) : null}
              {executing || preparing ? (
                <Button variant="secondary" size="sm" icon="panel" onClick={() => openTaskCanvas()}>
                  打开任务画布
                </Button>
              ) : null}
            </>
          )}
          {historical ? (
            <Button variant="secondary" size="sm" icon="undo" onClick={() => patchParams({ round: undefined, sel: undefined })}>
              回到当前轮次
            </Button>
          ) : null}
        </div>
      </div>

      {isFixed ? (
        <div className="req-banners">
          <div className="banner info">
            <Icon name="lock" />
            <div className="grow">
              <b>固定模板任务：{template?.name ?? task.fixedTemplate?.templateId} · 模板版本 {task.fixedTemplate?.templateVersion}</b>
              <br />
              {fixedReason}
            </div>
          </div>
        </div>
      ) : null}

      <div className="req-banners" aria-live="polite">
        <ConnectionBanner connection={live.connection} transport={live.transport} />
        <CommandErrorNotice error={command.state.error} title="操作未完成" />
        <CommandErrorNotice error={reconcileError} title="核对未完成" />
        <ReceiptNotice receipt={command.state.receipt} />
        <ReceiptNotice receipt={pageReceipt} />
        {reconcileMessage === undefined ? null : (
          <div className="banner info" role="status">
            <Icon name="refresh" />
            <div className="grow">{reconcileMessage}。只按原请求号核对，没有重新生成。</div>
          </div>
        )}
        {historical ? (
          <div className="banner warn">
            <Icon name="clock" />
            <div className="grow">
              <b>历史轮次 · 只读</b> · 第 {round?.ordinal} 轮（{round === undefined ? '—' : PLANNING_STAGE_LABEL[round.stage]}）。显示当时的输入、候选、记录与原账；没有应用或执行动作。
            </div>
            <div className="actions">
              <Button variant="secondary" size="sm" icon="undo" onClick={() => patchParams({ round: undefined, sel: undefined })}>
                回到当前
              </Button>
            </div>
          </div>
        ) : null}
        {candidateUnsettled ? (
          <div className="banner unknown">
            <Icon name="help" />
            <div className="grow">
              <b>候选已收到，正在核对本轮结束……</b>可以先只读审阅，暂不能应用。正文结束不代表本轮已停稳 / 已结账。
            </div>
          </div>
        ) : null}
        {staleInput ? (
          <div className="banner warn">
            <Icon name="alert" />
            <div className="grow">
              <b>候选已过期：</b>它基于需求输入修订 {round?.inputRevision}；当前输入修订 {task.requirement.revision}。旧候选保留可比较，不能覆盖当前草稿。
            </div>
          </div>
        ) : null}
        {round?.stop === undefined ? null : (
          <div className={`banner ${round.stop.processState === 'stopped' && round.stop.accountingState === 'closed' ? 'info' : 'unknown'}`}>
            <Icon name="stop" />
            <div className="grow">
              <b>{formatStoppedFacts(round)}</b>
              <br />
              不写“已停止”，除非原进程已停稳且用量已结账；迟到候选只记审计，不复活。
            </div>
            {roundUnknown ? (
              <div className="actions">
                <Button variant="secondary" size="sm" icon="refresh" disabled={reconciling} onClick={runReconcile}>
                  {reconciling ? '正在核对…' : '核对原轮次'}
                </Button>
              </div>
            ) : null}
          </div>
        )}
        {round?.failure === undefined ? null : (
          <div className="banner danger">
            <Icon name="alert" />
            <div className="grow">
              <b>本轮在「{PLANNING_STAGE_LABEL[round.stage]}」失败：</b>
              {round.failure.message}（{round.failure.code}）。已保留记录与草稿；不会自动重试，可补充输入后重新预览。
            </div>
          </div>
        )}
        {round?.reconcile === undefined ? null : (
          <div className={`banner ${round.reconcile.state === 'settled' ? 'info' : 'unknown'}`}>
            <Icon name="refresh" />
            <div className="grow">
              <b>核对状态：{round.reconcile.state}</b>
              {round.reconcile.checkedAt === undefined ? '' : ` · ${round.reconcile.checkedAt}`}
              {round.reconcile.detail === undefined ? '' : ` · ${round.reconcile.detail}`}
            </div>
          </div>
        )}
        {round?.stage === 'needs_answer' ? (
          <div className="banner warn">
            <Icon name="help" />
            <div className="grow">
              <b>模型提出了必须由你回答的问题。</b>保存答复会形成新的输入修订；旧轮次输入不变，预览新一轮是新调用。
            </div>
            <div className="actions">
              <Button variant="secondary" size="sm" icon="file" onClick={() => patchParams({ tab: 'draft' })}>
                去答复
              </Button>
            </div>
          </div>
        ) : null}
        {plan?.source === 'applied' && plan.status === 'unconfirmed' ? (
          <div className="banner ok">
            <Icon name="check" />
            <div className="grow">
              <b>已把候选应用到草稿（计划修订 {plan.revisionNumber}，未确认）。</b>可以继续查看或手动调整；确认后才能准备执行。应用不会执行。
            </div>
            <div className="actions">
              <Button variant="secondary" size="sm" icon="check" onClick={() => patchParams({ tab: 'plan' })}>
                确认计划
              </Button>
            </div>
          </div>
        ) : null}
        {executing ? (
          <div className="banner info">
            <Icon name="play" />
            <div className="grow">
              <b>执行已开始，需求画布只读。</b>工作包、尝试与产出归执行侧；规划面板没有应用或确认动作。
            </div>
            <div className="actions">
              <Button variant="secondary" size="sm" icon="panel" onClick={() => openTaskCanvas()}>
                打开任务画布
              </Button>
            </div>
          </div>
        ) : null}
        {preparing && planConfirmed ? (
          <div className="banner info">
            <Icon name="folder" />
            <div className="grow">
              <b>计划已确认（计划修订 {plan.revisionNumber}）。</b>下一步在「工作区」准备独立工作区；成功前没有“开始执行”。
            </div>
            <div className="actions">
              <Button variant="secondary" size="sm" icon="folder" onClick={() => patchParams({ tab: 'workspace' })}>
                去准备工作区
              </Button>
            </div>
          </div>
        ) : null}
        {candidateRevisionQuery.isError ? (
          <div className="banner warn">
            <Icon name="alert" />
            <div className="grow">
              <b>候选计划修订读取失败。</b>不影响当前草稿；可重试读取，或切换回「当前草稿」图层。
            </div>
            <div className="actions">
              <Button variant="secondary" size="sm" icon="refresh" onClick={() => void candidateRevisionQuery.refetch()}>
                重试
              </Button>
            </div>
          </div>
        ) : null}
        {checkpointRevisionQuery.isError ? (
          <div className="banner warn">
            <Icon name="alert" />
            <div className="grow">部分草稿检查点读取失败；不会用当前计划替代检查点。</div>
          </div>
        ) : null}
      </div>

      {detail.task.stage === TaskStage.PLANNING && round !== undefined ? (
        <PlanningStrip
          round={round}
          plan={plan}
          recordLast={recordQuery.data?.fragments.at(-1)?.seq}
          candidateNodeCount={candidateRevision?.graph.nodes.length}
          onOpenRecords={() => patchParams({ tab: 'records' })}
        />
      ) : null}

      <div className="canvas-body req-body">
        <FlowCanvas
          graph={graph}
          ariaLabel="计划画布（方向键不移动节点；Tab 进入节点，Enter 查看；点节点打开详情）"
          layers={layerOptions.length > 0 && (plan !== undefined || candidate !== undefined) ? layerOptions : undefined}
          layer={layer}
          onLayerChange={(next) => patchParams({ layer: next })}
          selectedNodeId={selectedNodeId}
          onSelectNode={(nodeId) => patchParams({ sel: nodeId, tab: 'plan' })}
          collapsedGroups={collapsedGroups}
          onToggleGroup={(groupId) => {
            setCollapsedGroups((previous) => (previous.includes(groupId) ? previous.filter((id) => id !== groupId) : [...previous, groupId]));
          }}
          notice={
            layer === 'partial' && checkpointRevision === undefined
              ? checkpointRevisionQuery.isError
                ? '部分草稿检查点读取失败；不会用当前计划替代检查点'
                : '正在读取部分草稿检查点…'
              : (layer === 'candidate' || layer === 'compare') && candidateRevision === undefined
                ? candidateRevisionQuery.isError
                  ? '候选计划修订读取失败；没有伪造候选图'
                  : '正在读取候选计划修订…'
                : layer === 'partial'
                  ? '部分草稿 · 检查点 · 尚未完成，不能执行'
                  : layer === 'candidate' && candidateUnsettled
                    ? '候选已到，正在核对本轮结束；可以先只读审阅，暂不能应用'
                    : historical
                      ? '历史轮次 · 只读'
                      : undefined
          }
          legend={legend}
          viewport={viewport}
          onViewportChange={(next) => patchParams({ view: `${String(Math.round(next.x))},${String(Math.round(next.y))},${next.zoom.toFixed(2)}` })}
          emptyState={
            layer === 'candidate' || layer === 'compare' ? (
              <EmptyState
                icon="eye"
                title={candidateRevision === undefined ? (candidateRevisionQuery.isError ? '候选计划修订读取失败' : '正在读取候选计划修订…') : '候选计划没有节点'}
                description={
                  candidateRevision === undefined
                    ? '只用服务返回的候选修订渲染候选/对照图层；读取完成前不会用当前草稿冒充候选。'
                    : '服务返回的候选图没有节点；这里不补造步骤。'
                }
                action={
                  candidateRevisionQuery.isError ? (
                    <Button size="sm" variant="secondary" icon="refresh" onClick={() => void candidateRevisionQuery.refetch()}>
                      重试读取
                    </Button>
                  ) : undefined
                }
              />
            ) : layer === 'partial' && checkpointRevision === undefined ? (
              <EmptyState
                icon="layers"
                title={checkpointRevisionQuery.isError ? '部分草稿检查点读取失败' : '正在读取部分草稿检查点…'}
                description="部分草稿只读；没有检查点图时不显示任何替代内容。"
              />
            ) : (
            <EmptyState
              icon="flow"
              title="还没有计划"
              description="生成计划会先打开规划预览并确认；候选需要你审阅、应用、确认。也可以使用方法骨架，不调用模型。"
              action={
                <div className="row" style={{ gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
                  <Button
                    variant="primary"
                    size="sm"
                    icon="sparkle"
                    disabled={generateAction?.allowed !== true || command.state.busy}
                    disabledReason={generateAction?.reason}
                    onClick={() => setDialog('preview')}
                  >
                    生成计划
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    icon="layers"
                    disabled={skeletonAction?.allowed !== true || command.state.busy}
                    disabledReason={skeletonAction?.reason}
                    onClick={runSkeleton}
                  >
                    使用方法骨架
                  </Button>
                </div>
              }
            />
            )
          }
        />

        {panelCollapsed ? (
          <button type="button" className="panel-open" onClick={() => setPanelCollapsed(false)}>
            <Icon name="panel" size="sm" />
            展开规划面板
          </button>
        ) : (
          <aside className="side req-side" aria-label="规划面板">
            <div className="side-head req-side-head">
              <div className="row1">
                <h2 className="grow">规划面板</h2>
                {rounds.length === 0 ? (
                  <Badge tone="idle">尚无规划轮次</Badge>
                ) : (
                  <select
                    className="round-sel"
                    aria-label="规划轮次"
                    value={round?.id ?? ''}
                    onChange={(event) => {
                      const value = event.target.value;
                      const target = rounds.find((item) => item.id === value);
                      const isCurrent = target?.id === currentRoundId;
                      patchParams({ round: isCurrent ? undefined : value, sel: undefined });
                    }}
                  >
                    {rounds.map((item) => (
                      <option key={item.id} value={item.id}>
                        第 {item.ordinal} 轮 · {PLANNING_STAGE_LABEL[item.stage]} · {item.status}
                        {item.id === currentRoundId ? '（当前）' : '（历史）'}
                      </option>
                    ))}
                  </select>
                )}
                <IconButton icon="panel" label="收起规划面板" onClick={() => setPanelCollapsed(true)} />
              </div>
              <div className="tabs req-tabs" role="tablist" aria-label="规划面板页签">
                {tabs.map((item) => (
                  <button
                    key={item}
                    type="button"
                    role="tab"
                    className="tab"
                    aria-selected={tab === item}
                    onClick={() => patchParams({ tab: item })}
                  >
                    {TAB_LABEL[item]}
                    {item === 'records' && recordQuery.data !== undefined ? <span className="tab-n">{recordQuery.data.fragments.length}</span> : null}
                    {item === 'draft' && (round?.questions.length ?? 0) > 0 ? <span className="tab-n">{round?.questions.length}</span> : null}
                    {item === 'check' && candidate !== undefined && candidate.validation.structural.problems.length > 0 ? (
                      <span className="tab-n">{candidate.validation.structural.problems.length}</span>
                    ) : null}
                  </button>
                ))}
              </div>
            </div>
            <div className="side-body req-side-body" role="tabpanel" aria-label={TAB_LABEL[tab]}>
              {requirementQuery.isError ? (
                <ServiceNotice
                  error={requirementQuery.error}
                  onRetry={() => {
                    void requirementQuery.refetch();
                  }}
                />
              ) : null}
              {requirementQuery.data === undefined ? (
                requirementQuery.isLoading ? <SkeletonText lines={8} /> : null
              ) : tab === 'input' ? (
                <RequirementPanel
                  task={task}
                  requirement={requirementQuery.data.requirement}
                  method={requirementQuery.data.method}
                  preview={lastPreview?.preview}
                  round={round}
                  template={template}
                />
              ) : null}

              {tab === 'records' ? (
                <PlanningRecordPanel
                  record={recordQuery.data}
                  round={round}
                  loading={recordQuery.isLoading}
                  error={recordQuery.error}
                  onRetry={() => {
                    void recordQuery.refetch();
                  }}
                  historical={historical}
                />
              ) : null}
              {tab === 'draft' ? <DraftPanel round={round} saveAnswerAction={saveAnswerAction} busy={command.state.busy} onSaveAnswers={runSaveAnswers} /> : null}
              {tab === 'check' ? (
                <ChecksPanel
                  revision={candidateRevision ?? plan}
                  round={round}
                  onLocateNode={(nodeId) => patchParams({ layer: 'compare', sel: nodeId, tab: 'check' })}
                  onOpenPlan={() => patchParams({ tab: 'plan' })}
                />
              ) : null}
              {tab === 'plan' ? (
                <PlanReviewPanel
                  detail={detail}
                  plan={plan}
                  candidateRevision={candidateRevision}
                  round={round}
                  selectedNodeId={selectedNodeId}
                  accepted={acceptedDecisions}
                  onToggleAccepted={(decisionId) => {
                    setAcceptedDecisions((previous) => ({ ...previous, [decisionId]: !previous[decisionId] }));
                  }}
                  onLocateNode={(nodeId) => patchParams({ layer: 'compare', sel: nodeId })}
                  onApply={() => setDialog('apply')}
                  onReject={() => setDialog('reject')}
                  onConfirm={() => setDialog('confirm')}
                  onOpenWorkspace={() => patchParams({ tab: 'workspace' })}
                  onOpenRecords={() => patchParams({ tab: 'records' })}
                  actions={capabilities}
                  busy={command.state.busy}
                  historical={historical}
                  candidateUnsettled={candidateUnsettled}
                  staleInput={staleInput}
                />
              ) : null}
              {tab === 'workspace' ? (
                <WorkspacePanel
                  detail={detail}
                  plan={plan}
                  workspace={workspace}
                  actions={capabilities}
                  busy={command.state.busy}
                  onPrepare={runPrepare}
                  onStartExecution={runStartExecution}
                  onOpenTask={() => openTaskCanvas()}
                />
              ) : null}
              {tab === 'tracking' ? (
                <TrackingPanel plan={plan} execution={detail.execution} onOpenTask={() => openTaskCanvas()} onOpenNode={(nodeId) => openTaskCanvas(nodeId)} />
              ) : null}
            </div>
            {tab === 'input' && plan === undefined ? (
              <div className="side-foot req-side-foot">
                <span className="hint">
                  <Icon name="lock" size="sm" /> 原文只读；补充以新修订保存。
                </span>
              </div>
            ) : null}
          </aside>
        )}
      </div>

      <PlanningPreviewDialog
        open={dialog === 'preview'}
        taskId={taskId}
        nextOrdinal={rounds.length + 1}
        onClose={() => setDialog(null)}
        onPreviewLoaded={(preview) => setLastPreview(preview)}
        onStarted={(receipt) => {
          setPageReceipt(receipt);
          void refresh();
          patchParams({ tab: 'records' });
        }}
      />
      <ApplyCandidateDialog
        open={dialog === 'apply'}
        taskId={taskId}
        round={round}
        candidateRevision={candidateRevision}
        acceptedDecisionIds={acceptedIds}
        onClose={() => setDialog(null)}
        onApplied={(receipt) => {
          setPageReceipt(receipt);
          setAcceptedDecisions({});
          void refresh();
          patchParams({ tab: 'plan', layer: 'current' });
        }}
      />
      <RejectCandidateDialog
        open={dialog === 'reject'}
        taskId={taskId}
        round={round}
        onClose={() => setDialog(null)}
        onRejected={(receipt) => {
          setPageReceipt(receipt);
          void refresh();
        }}
      />
      <StopPlanningDialog
        open={dialog === 'stop'}
        taskId={taskId}
        round={round}
        onClose={() => setDialog(null)}
        onStopped={(receipt) => {
          setPageReceipt(receipt);
          void refresh();
        }}
      />
      <ConfirmPlanDialog
        open={dialog === 'confirm'}
        taskId={taskId}
        detail={detail}
        plan={plan}
        onClose={() => setDialog(null)}
        onConfirmed={(receipt) => {
          setPageReceipt(receipt);
          void refresh();
          patchParams({ tab: 'workspace' });
        }}
      />
    </div>
  );
}
