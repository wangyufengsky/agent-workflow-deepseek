import { useEffect, useState } from 'react';
import {
  WORKSPACE_STATE_LABEL,
  createRequestKey,
  type ActionAvailability,
  type CommandResponse,
  type OperationReceipt,
  type PlanRevision,
  type TaskDetailResponse,
  type TaskWorkspace,
  type WorkspaceCleanupPreview,
  type WorkspacePrepareOutcome,
  type WorkspacePreparePreview,
  type WorkspacePrepareProjection,
} from '@agent-workflow/shared';
import { errorMessage, isApiClientError } from '../../api/client.ts';
import {
  confirmWorkspaceCleanup,
  fetchOperationByKey,
  prepareWorkspace,
  previewWorkspaceCleanup,
  startExecution,
  useWorkflowRefresh,
} from '../../api/workflow.ts';
import { Badge } from '../../components/Badge.tsx';
import { Button } from '../../components/Button.tsx';
import { Icon } from '../../components/Icon.tsx';
import { Modal } from '../../components/Modal.tsx';
import { ActionReasonLine, CommandErrorNotice, ReceiptNotice, ServiceActionButton } from '../../flow/workflow-ui.tsx';
import { formatDateTime } from '../../app/format.ts';
import { PanelEmpty, RevisionMeta, Section } from './requirement-ui.tsx';

type CleanupPreviewState =
  | { readonly phase: 'idle' }
  | { readonly phase: 'loading' }
  | { readonly phase: 'ready'; readonly preview: WorkspaceCleanupPreview }
  | { readonly phase: 'error'; readonly error: unknown };

interface OperationLookup {
  readonly checking: boolean;
  readonly status?: string;
  readonly stillUnknown?: boolean;
  readonly error?: unknown;
}

const STEP_ORDER = ['resolve_baseline', 'create_branch', 'create_worktree', 'verify_worktree', 'bind_task'] as const;

const WORKSPACE_STEP_LABEL: Record<(typeof STEP_ORDER)[number], string> = {
  resolve_baseline: '解析基线',
  create_branch: '创建任务分支',
  create_worktree: '创建独立工作区',
  verify_worktree: '校验工作区',
  bind_task: '绑定任务',
};

function stepClass(state: TaskWorkspace['steps'][number]['state'] | undefined): string {
  if (state === 'completed') return 'done';
  if (state === 'running') return 'on';
  if (state === 'failed') return 'bad';
  return '';
}



/** First execution batch: plan nodes without an incoming dependency edge (service graph only). */
function firstBatchSteps(plan: PlanRevision | undefined): string {
  if (plan === undefined) return '服务未返回计划';
  const incoming = new Set(plan.graph.edges.map((edge) => edge.to));
  const roots = plan.graph.nodes.filter((node) => !incoming.has(node.id));
  if (roots.length === 0) return '服务未返回可领取的首批步骤（可能全部有前置）';
  const shown = roots.slice(0, 6).map((node) => node.title);
  return `${shown.join('、')}${roots.length > shown.length ? ` 等 ${String(roots.length)} 个` : `（共 ${String(roots.length)} 个）`}`;
}

/** P11-04: the six abnormal PW states each carry their own banner and unique action. */
const PREPARE_OUTCOME_VIEW: Record<Exclude<WorkspacePrepareOutcome, 'none'>, { readonly tone: 'unknown' | 'warn' | 'fail' | 'info'; readonly title: string; readonly body: string }> = {
  ready: { tone: 'info', title: '工作区已准备', body: '准备成功只是第一步；开始执行需要单独确认（受管 OpenCode 会启动步骤）。' },
  preparing: { tone: 'info', title: '正在准备工作区', body: '服务正在解析基线/创建分支与目录/核对；没有百分比，也不自动推进。' },
  unknown: { tone: 'unknown', title: '工作区创建结果待核对', body: '只按原创建请求号核对；核对前不能开始执行，也不会再准备新的工作区（不会再分配第二个目录或分支）。' },
  partial: { tone: 'warn', title: '工作区部分创建', body: '部分对象已创建。唯一允许的动作是“补建工作目录”，不会重复创建已有对象，也不会新建第二套工作区。' },
  conflict: { tone: 'warn', title: '存在同名分支或 worktree', body: '服务返回了同名对象。先核对同名对象并处理；当前服务未提供“以新名称重新预览”的命名能力（能力缺口 C1），不会静默改名。' },
  drift: { tone: 'warn', title: '基线已前移', body: '工作区记录的基线与当前基线不一致。重新读取基线并按当前基线重新预览后再准备；不会按旧基线继续。' },
  denied: { tone: 'fail', title: '无法读取项目目录', body: '当前账号没有该项目目录的读取权限。按授权说明处理并重新读取；不会伪造工作区已创建。' },
  empty: { tone: 'fail', title: 'Git 空仓库没有可固定基线', body: '空仓库不能准备独立工作区（仍禁用准备）。请从“开始任务”新建，或先初始化仓库并提交后再重读。' },
  unavailable: { tone: 'fail', title: '工作区准备能力不可用', body: '服务缺少该能力（例如非 Git 目录适配未接通）。不是前端可修复项；等能力接通后再准备。' },
  failed: { tone: 'fail', title: '上一次准备工作区明确失败', body: '这是明确失败（不是未知）。核对失败阶段与错误后，可按“重试准备”用新请求号重新发起。' },
};

function PrepareOutcomeBanner({ projection }: { readonly projection: WorkspacePrepareProjection }) {
  if (projection.outcome === 'none') return null;
  const view = PREPARE_OUTCOME_VIEW[projection.outcome];
  return (
    <div className={`banner ${view.tone}`} style={{ marginTop: 12 }} role="note">
      <Icon name={view.tone === 'unknown' ? 'help' : view.tone === 'info' ? 'info' : 'alert'} />
      <div className="grow">
        <b>{view.title}</b>
        <br />
        {view.body}
        {projection.failedStep === undefined ? null : (
          <>
            <br />
            失败阶段：{projection.failedStep}
          </>
        )}
        {projection.errorCode === undefined ? null : (
          <>
            <br />
            <span className="mono">
              {projection.errorCode}
              {projection.errorMessage === undefined ? '' : ` · ${projection.errorMessage}`}
            </span>
          </>
        )}
        {projection.detail === undefined ? null : (
          <>
            <br />
            {projection.detail}
          </>
        )}
        {projection.requestKey === undefined ? null : (
          <>
            <br />
            <span className="mono">原创建请求号 {projection.requestKey}</span>
          </>
        )}
        {projection.checkedAt === undefined ? null : <span className="hint"> · 最近检查 {formatDateTime(projection.checkedAt)}</span>}
      </div>
    </div>
  );
}

export interface WorkspacePanelProps {
  readonly detail?: TaskDetailResponse;
  readonly plan?: PlanRevision;
  readonly workspace?: TaskWorkspace;
  /** P11-04 service projection of the last prepare result. */
  readonly projection?: WorkspacePrepareProjection;
  /** P11-03 read-only prepare preview (baseline / same-name / empty facts). */
  readonly preparePreview?: WorkspacePreparePreview;
  readonly previewLoading: boolean;
  readonly previewError: unknown;
  readonly onPreviewRefresh: () => void;
  readonly onNewTaskFromEmpty: () => void;
  readonly actions: Record<string, ActionAvailability>;
  readonly busy: boolean;
  /** P11-02: non-undefined while an UNKNOWN receipt locks the original operation. */
  readonly lockedReason?: string;
  /** Runs through the page-level receipt command runner (keeps the request key). */
  readonly runCommand: <T>(operation: string, execute: (requestKey: string) => Promise<CommandResponse<T>>) => Promise<CommandResponse<T> | undefined>;
  readonly onPrepared: () => void;
  readonly onStartedExecution: () => void;
  readonly onOpenTask: () => void;
}

/**
 * “工作区” tab: plan confirmation → prepare isolated workspace → start execution,
 * with the two steps kept separate and every disabled action carrying a reason.
 */
export function WorkspacePanel({
  detail,
  plan,
  workspace,
  projection,
  preparePreview,
  previewLoading,
  previewError,
  onPreviewRefresh,
  onNewTaskFromEmpty,
  actions,
  busy,
  lockedReason,
  runCommand,
  onPrepared,
  onStartedExecution,
  onOpenTask,
}: WorkspacePanelProps) {
  const taskId = detail?.task.id ?? '';
  const refresh = useWorkflowRefresh(taskId);
  const startAction = actions.startExecution;
  const prepareAction = actions.prepareWorkspace;
  const repairAction = actions.repairPrepare;
  const retryAction = actions.retryPrepare;
  const reconcilePrepareAction = actions.reconcilePrepare;
  const rereadWorkspaceAction = actions.rereadWorkspace;
  const rereadBaselineAction = actions.rereadBaseline;
  const renameAction = actions.renameWorkspace;
  const newTaskAction = actions.newTaskFromEmpty;
  // 同名冲突可通过“使用新名称重新预览”解决（task-7 服务层 branchName/directoryName override）。
  const nameConflictResolvable = preparePreview !== undefined
    && preparePreview.sameNameObjects.length > 0
    && preparePreview.suggestedBranchName !== undefined;
  const unresolvedBlockers = (preparePreview?.blockers ?? []).filter((blocker) => !(nameConflictResolvable && blocker.code === 'WORKSPACE_NAME_CONFLICT'));
  const [prepareDialog, setPrepareDialog] = useState<'prepare' | 'repair' | 'retry' | 'start' | null>(null);
  const [prepareSubmitError, setPrepareSubmitError] = useState<unknown>(null);
  const [prepareLookup, setPrepareLookup] = useState<OperationLookup>({ checking: false });
  const lock = (reason: string | undefined): string | undefined => lockedReason ?? reason;
  const lookupPrepare = async () => {
    const requestKey = projection?.requestKey;
    if (requestKey === undefined) return;
    setPrepareLookup({ checking: true });
    try {
      const result = await fetchOperationByKey(requestKey);
      setPrepareLookup({ checking: false, status: result.operation.status, stillUnknown: result.stillUnknown });
      await refresh();
    } catch (error) {
      setPrepareLookup({ checking: false, error });
    }
  };
  const workspaceReady = workspace?.state === 'ready';
  const workspaceCleaned = workspace?.state === 'cleaned';
  const confirmed = plan?.status === 'confirmed';
  const steps = STEP_ORDER.map((step) => ({
    step,
    label: WORKSPACE_STEP_LABEL[step],
    state: workspace?.steps.find((item) => item.step === step)?.state,
    detail: workspace?.steps.find((item) => item.step === step)?.detail,
  }));

  const [cleanupPreview, setCleanupPreview] = useState<CleanupPreviewState>({ phase: 'idle' });
  const [cleanupDialog, setCleanupDialog] = useState<'preview' | 'confirm' | null>(null);
  const [cleanupAck, setCleanupAck] = useState(false);
  const [cleanupBusy, setCleanupBusy] = useState(false);
  const [cleanupReceipt, setCleanupReceipt] = useState<OperationReceipt | undefined>(undefined);
  const [cleanupSubmitError, setCleanupSubmitError] = useState<unknown>(null);
  const [uncertainRequestKey, setUncertainRequestKey] = useState<string | undefined>(undefined);
  const [lookup, setLookup] = useState<OperationLookup>({ checking: false });

  const preview = cleanupPreview.phase === 'ready' ? cleanupPreview.preview : undefined;
  const blockers = preview?.blockers ?? [];
  const previewExpiresAt = preview === undefined ? Number.NaN : Date.parse(preview.expiresAt);
  const previewExpired = Number.isFinite(previewExpiresAt) && previewExpiresAt <= Date.now();
  const needsAck = preview?.requiresUndeliveredAck === true;
  const cleanupUncertain = cleanupSubmitError !== null && uncertainRequestKey !== undefined;
  const confirmBlockedReason = cleanupUncertain
    ? '上一次清理请求没有收到回执：先按原请求号核对，不要重复提交。'
    : preview === undefined
      ? '清理预览还没有读取成功。'
      : blockers.length > 0
        ? `存在 ${String(blockers.length)} 项阻塞：${blockers.map((blocker) => blocker.label).join('；')}`
        : previewExpired
          ? '清理预览已过期，请重新读取预览。'
          : needsAck && !cleanupAck
            ? '请先勾选确认清理影响。'
            : undefined;
  const cleanupButtonReason =
    cleanupReceipt?.status === 'unknown'
      ? '上一次清理结果待核对：按原请求号核对后再操作。'
      : cleanupReceipt?.status === 'accepted'
        ? '清理请求已受理，等待服务结算；先重新读取工作区状态。'
        : cleanupUncertain
          ? '上一次清理请求没有收到回执：先按原请求号核对，不要重复提交。'
          : workspace?.pendingOperationRef !== undefined
            ? `工作区有未结清操作（${workspace.pendingOperationRef}）；先按原请求核对。`
            : workspace?.state === 'cleaning'
              ? '工作区正在清理，不能重复清理。'
              : undefined;

  useEffect(() => {
    if (workspaceCleaned) setCleanupDialog(null);
  }, [workspaceCleaned]);

  const loadCleanupPreview = async () => {
    if (taskId.length === 0) return;
    setCleanupPreview({ phase: 'loading' });
    setCleanupSubmitError(null);
    try {
      const result = await previewWorkspaceCleanup(taskId);
      setCleanupPreview({ phase: 'ready', preview: result.preview });
    } catch (error) {
      setCleanupPreview({ phase: 'error', error });
    }
  };

  const openCleanup = () => {
    setCleanupAck(false);
    setLookup({ checking: false });
    setCleanupDialog('preview');
    void loadCleanupPreview();
  };

  const confirmCleanup = async () => {
    if (taskId.length === 0 || preview === undefined || cleanupSubmitError !== null || confirmBlockedReason !== undefined || cleanupBusy) return;
    const requestKey = createRequestKey();
    setUncertainRequestKey(requestKey);
    setCleanupBusy(true);
    setCleanupSubmitError(null);
    setLookup({ checking: false });
    try {
      const response = await confirmWorkspaceCleanup(taskId, {
        previewRef: preview.previewRef,
        workspaceRevision: preview.workspaceRevision,
        requestKey,
      });
      setCleanupReceipt(response.receipt);
      setCleanupDialog(null);
      await refresh();
      if (response.receipt.status === 'succeeded') {
        setCleanupPreview({ phase: 'idle' });
        setCleanupAck(false);
      }
    } catch (error) {
      setCleanupSubmitError(error);
      // 明确的 4xx 拒绝是已知失败（例如 STALE_TARGET / DELIVERY_BLOCKED），不是待核对回执。
      if (isApiClientError(error) && error.kind === 'http' && (error.status ?? 500) < 500) {
        setUncertainRequestKey(undefined);
      }
    } finally {
      setCleanupBusy(false);
    }
  };

  const verifyUncertainRequest = async () => {
    if (uncertainRequestKey === undefined) return;
    setLookup({ checking: true });
    try {
      const result = await fetchOperationByKey(uncertainRequestKey);
      setLookup({
        checking: false,
        status: result.operation.status,
        stillUnknown: result.stillUnknown,
      });
      if (!result.stillUnknown) setCleanupSubmitError(null);
      await refresh();
    } catch (error) {
      setLookup({ checking: false, error });
    }
  };

  return (
    <div>
      {detail?.task.fixedTemplate === undefined ? null : (
        <div className="banner info" style={{ marginBottom: 12 }}>
          <Icon name="lock" />
          <div className="grow">固定模板任务：步骤不能修改；仍可确认计划、准备独立工作区并按原配置开始执行。</div>
        </div>
      )}

      <Section title="计划与确认" aside={plan === undefined ? <Badge tone="idle">没有计划</Badge> : <Badge tone={confirmed ? 'done' : 'wait'}>{confirmed ? '已确认' : '未确认'}</Badge>}>
        {plan === undefined ? (
          <PanelEmpty compact icon="flow" title="还没有计划" description="确认计划后才能准备工作区。" />
        ) : (
          <RevisionMeta plan={plan} />
        )}
        {plan !== undefined && !confirmed ? (
          <div className="banner warn" style={{ marginTop: 10 }}>
            <Icon name="alert" />
            <div className="grow">
              <b>计划尚未确认，不能准备工作区。</b>
              <br />
              回到「计划」页签确认计划；确认不调用模型，也不会立即执行。
            </div>
          </div>
        ) : null}
      </Section>

      <Section title="独立工作区" aside={<Badge tone={workspace === undefined ? 'idle' : workspace.state === 'ready' ? 'done' : workspace.state === 'preparing' ? 'run' : workspace.state === 'blocked' ? 'fail' : 'wait'}>{workspace === undefined ? '未创建' : WORKSPACE_STATE_LABEL[workspace.state]}</Badge>}>
        {workspace === undefined ? (
          <div className="banner info" style={{ marginBottom: 12 }}>
            <Icon name="folder" />
            <div className="grow">
              <b>准备独立工作区（两步的第一步）</b>
              <br />
              服务会解析基线、创建任务分支与 worktree、校验并绑定任务；这一步不会开始执行。
            </div>
          </div>
        ) : (
          <>
            <dl className="kv-list">
              <dt>类型</dt>
              <dd>{workspace.kind === 'git_worktree' ? 'Git worktree（任务独立分支）' : '目录副本（非 Git）'}</dd>
              <dt>位置</dt>
              <dd className="mono">{workspace.displayRoot ?? '—'}</dd>
              <dt>原目录</dt>
              <dd className="mono">{workspace.originalRootDisplay ?? '—'}</dd>
              <dt>分支</dt>
              <dd className="mono">{workspace.branch ?? '—'}</dd>
              <dt>基线</dt>
              <dd className="mono">
                {workspace.baseRef ?? '—'}
                {workspace.baseSha === undefined ? '' : ` @ ${workspace.baseSha.slice(0, 10)}`}
              </dd>
              <dt>并行写策略</dt>
              <dd>{workspace.parallelWritePolicy === 'serial' ? '同任务文件写入逐个领取（串行）' : '子隔离后合并（后续分期）'}</dd>
              <dt>保留策略</dt>
              <dd>{workspace.retention}</dd>
              <dt>最近检查</dt>
              <dd>{formatDateTime(workspace.lastCheckedAt)}</dd>
              {workspace.activeWrites.length === 0 ? null : (
                <>
                  <dt>执行中写入</dt>
                  <dd>{workspace.activeWrites.length} 个步骤</dd>
                </>
              )}
            </dl>

            <div className="ws-track" aria-label="工作区准备阶段">
              {steps.map((item) => (
                <div key={item.step} className={`ws-step ${stepClass(item.state)}`}>
                  <span className="top">
                    <span className="no">{item.state === 'completed' ? <Icon name="check" size="sm" /> : item.state === 'running' ? <span className="spin" /> : <Icon name="clock" size="sm" />}</span>
                    <span className="bar" />
                  </span>
                  <span className="lb">{item.label}</span>
                  <span className="dt">{item.detail ?? (item.state === 'not_started' ? '未开始' : item.state ?? '未知')}</span>
                </div>
              ))}
            </div>

            {workspaceCleaned ? (
              <div className="banner info" style={{ marginTop: 12 }}>
                <Icon name="check" />
                <div className="grow">
                  <b>工作区已清理。</b>
                  <br />
                  远端分支、回执与审计记录保留；任务与计划没有删除。
                </div>
              </div>
            ) : null}
          </>
        )}

        {projection === undefined ? null : <PrepareOutcomeBanner projection={projection} />}

        <div className="ws-actions" style={{ flexWrap: 'wrap' }}>
          {prepareAction?.allowed === true ? (
            <Button variant="primary" size="sm" icon="folder" disabled={busy || lockedReason !== undefined} disabledReason={lock(undefined)} onClick={() => setPrepareDialog('prepare')}>
              准备独立工作区…
            </Button>
          ) : null}
          {repairAction?.allowed === true ? (
            <Button variant="primary" size="sm" icon="refresh" disabled={busy || lockedReason !== undefined} disabledReason={lock(undefined)} onClick={() => setPrepareDialog('repair')}>
              补建工作目录…
            </Button>
          ) : null}
          {retryAction?.allowed === true ? (
            <Button variant="secondary" size="sm" icon="refresh" disabled={busy || lockedReason !== undefined} disabledReason={lock(undefined)} onClick={() => setPrepareDialog('retry')}>
              重试准备（上一次已明确失败）…
            </Button>
          ) : null}
          {reconcilePrepareAction?.allowed === true ? (
            <Button
              variant="secondary"
              size="sm"
              icon="search"
              disabled={prepareLookup.checking || projection?.requestKey === undefined}
              disabledReason={projection?.requestKey === undefined ? '服务未返回原创建请求号' : undefined}
              onClick={() => {
                void lookupPrepare();
              }}
            >
              {prepareLookup.checking ? '正在核对…' : `按原创建请求号核对${projection?.requestKey === undefined ? '' : `（${projection.requestKey}）`}`}
            </Button>
          ) : null}
          {rereadBaselineAction?.allowed === true ? (
            <Button variant="secondary" size="sm" icon="refresh" onClick={onPreviewRefresh}>
              重新读取基线并预览…
            </Button>
          ) : null}
          {rereadWorkspaceAction?.allowed === true ? (
            <Button variant="secondary" size="sm" icon="refresh" onClick={() => { void refresh(); }}>
              重新读取工作区
            </Button>
          ) : null}
          {newTaskAction?.allowed === true ? (
            <Button variant="secondary" size="sm" icon="plus" onClick={onNewTaskFromEmpty}>
              从“开始任务”新建
            </Button>
          ) : null}
          {renameAction?.allowed === true ? (
            <Button
              variant="secondary"
              size="sm"
              icon="edit"
              disabled={busy || lockedReason !== undefined}
              disabledReason={lock(undefined)}
              onClick={() => {
                onPreviewRefresh();
                setPrepareDialog('prepare');
              }}
            >
              使用新名称重新预览…
            </Button>
          ) : null}
          {renameAction === undefined || renameAction.allowed === true ? null : (
            <Button variant="ghost" size="sm" icon="edit" disabled disabledReason={renameAction.reason}>
              以新名称重新预览
            </Button>
          )}
          {prepareAction?.allowed !== true && repairAction?.allowed !== true && retryAction?.allowed !== true ? (
            <ActionReasonLine action={prepareAction} fallback={lockedReason} />
          ) : null}
          {prepareLookup.status === undefined ? null : (
            <span className="hint" role="status">
              核对结果：{prepareLookup.status}
              {prepareLookup.stillUnknown === true ? ' · 仍为未知，保持锁定，不会重发' : ' · 已按服务回读，重新读取后再决定下一步'}
            </span>
          )}
          {prepareLookup.error === undefined ? null : <CommandErrorNotice error={prepareLookup.error} title="核对原创建请求失败" />}
          {prepareSubmitError === null ? null : <span className="hint">上次准备未完成：{String((prepareSubmitError as Error)?.message ?? '结果待核对')}</span>}
        </div>
      </Section>

      {workspace === undefined ? null : (
        <Section title="清理工作区" aside={workspaceCleaned ? <Badge tone="idle" icon="check">已清理</Badge> : <Badge tone="wait" icon="trash">不可撤销</Badge>}>
          {workspaceCleaned ? (
            <p className="hint" style={{ marginBottom: 10 }}>
              工作区已清理。远端分支、回执与审计记录保留；任务与计划没有删除，无需再次清理。
            </p>
          ) : (
            <>
              <p className="hint" style={{ marginBottom: 10 }}>
                清理会删除任务的工作区与本地任务分支，保留远端分支、回执与审计记录；任务、计划和交付记录不会被删除。
                服务会先检查执行、规划与交付是否仍在进行。
              </p>
              <div className="ws-actions">
                <Button
                  variant="danger"
                  size="sm"
                  icon="trash"
                  disabled={cleanupButtonReason !== undefined || cleanupBusy || cleanupPreview.phase === 'loading'}
                  disabledReason={
                    cleanupButtonReason
                    ?? (cleanupBusy ? '清理请求已发出，正在等待服务回执…' : cleanupPreview.phase === 'loading' ? '正在读取清理预览…' : undefined)
                  }
                  onClick={openCleanup}
                >
                  清理工作区…
                </Button>
                {cleanupButtonReason === undefined ? null : (
                  <span className="action-reason" role="note">
                    <Icon name="lock" size="sm" />
                    {cleanupButtonReason}
                  </span>
                )}
                {cleanupReceipt?.status === 'unknown' || cleanupReceipt?.status === 'accepted' || cleanupSubmitError !== null ? (
                  <Button variant="secondary" size="sm" icon="refresh" onClick={() => { void refresh(); }}>
                    重新读取工作区
                  </Button>
                ) : null}
              </div>
            </>
          )}

          <ReceiptNotice receipt={cleanupReceipt} successMessage="工作区已清理；远端分支、回执与审计记录保留。" />

          {cleanupSubmitError === null ? null : cleanupUncertain ? (
            <div className="banner danger" role="alert" style={{ marginTop: 10 }}>
              <Icon name="alert" />
              <div className="grow">
                <b>清理请求没有收到回执</b>
                <br />
                {errorMessage(cleanupSubmitError)}
                <span className="mono receipt-key">请求号 {uncertainRequestKey}</span>
                <span style={{ display: 'block', marginTop: 4 }}>
                  请求可能已经发出：只按原请求号核对，不自动重发；核对前不要再次清理。
                </span>
              </div>
              <div className="actions">
                <Button
                  variant="secondary"
                  size="sm"
                  icon="search"
                  disabled={lookup.checking}
                  disabledReason={lookup.checking ? '正在核对原请求…' : undefined}
                  onClick={() => { void verifyUncertainRequest(); }}
                >
                  {lookup.checking ? '正在核对…' : '按原请求号核对'}
                </Button>
              </div>
            </div>
          ) : (
            <div style={{ marginTop: 10 }}>
              <CommandErrorNotice error={cleanupSubmitError} title="清理没有完成" />
            </div>
          )}

          {lookup.error === undefined ? null : (
            <div className="banner danger" role="alert" style={{ marginTop: 10 }}>
              <Icon name="alert" />
              <div className="grow">
                <b>核对原请求失败</b>
                <br />
                {errorMessage(lookup.error)}
              </div>
            </div>
          )}
          {lookup.status === undefined ? null : (
            <div className={`banner ${lookup.stillUnknown === true ? 'unknown' : 'info'}`} role="status" style={{ marginTop: 10 }}>
              <Icon name={lookup.stillUnknown === true ? 'help' : 'check'} />
              <div className="grow">
                核对结果：{lookup.status}
                {lookup.stillUnknown === true ? ' · 仍为未知，保持待核对，不会重发。' : ' · 已按服务回读工作区状态。'}
              </div>
            </div>
          )}
        </Section>
      )}

      <Section
        title="开始执行"
        aside={
          workspaceReady ? (
            <Badge tone="ok" icon="check">
              工作区已准备
            </Badge>
          ) : (
            <Badge tone="wait" icon="lock">
              准备成功前不可用
            </Badge>
          )
        }
      >
        <p className="hint" style={{ marginBottom: 10 }}>
          第二步：准备成功后才会出现“开始执行”。开始执行会唤起受管 OpenCode 运行步骤；开始后可在任务画布暂停、继续或取消。
        </p>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <Button
            variant="primary"
            icon="play"
            disabled={startAction?.allowed !== true || busy || lockedReason !== undefined}
            disabledReason={lock(startAction?.allowed === true ? undefined : (startAction?.reason ?? '服务未提供开始执行动作'))}
            onClick={() => setPrepareDialog('start')}
          >
            开始执行…
          </Button>
          {workspaceReady ? (
            <Button variant="ghost" size="sm" icon="panel" onClick={onOpenTask}>
              打开任务画布
            </Button>
          ) : null}
        </div>
        <div style={{ marginTop: 6 }}>
          <ActionReasonLine action={startAction} block />
        </div>
      </Section>

      <Modal
        open={cleanupDialog === 'preview'}
        title="清理工作区 · 预览"
        onClose={() => {
          if (cleanupBusy) return;
          setCleanupDialog(null);
        }}
        footer={
          <>
            <Button variant="ghost" onClick={() => { setCleanupDialog(null); }} disabled={cleanupBusy} disabledReason={cleanupBusy ? '正在提交清理请求，等待服务回执…' : undefined}>
              取消
            </Button>
            <span className="spacer" />
            <Button
              variant="secondary"
              icon="refresh"
              disabled={cleanupBusy || cleanupPreview.phase === 'loading'}
              disabledReason={cleanupBusy ? '正在提交清理请求…' : '正在读取清理预览…'}
              onClick={() => { void loadCleanupPreview(); }}
            >
              重新读取预览
            </Button>
            <Button
              variant="danger"
              icon="trash"
              disabled={preview === undefined || confirmBlockedReason !== undefined}
              disabledReason={confirmBlockedReason}
              onClick={() => { setCleanupDialog('confirm'); }}
            >
              继续确认清理
            </Button>
          </>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <p className="hint">
            下面是服务返回的清理预览，只读；确认前不会删除任何东西。清理会删除工作区与本地任务分支，远端分支、回执与审计记录保留。
          </p>

          {cleanupPreview.phase === 'loading' ? <p className="hint">正在读取清理预览…</p> : null}
          {cleanupPreview.phase === 'error' ? (
            <>
              <CommandErrorNotice error={cleanupPreview.error} title="清理预览读取失败" />
              <Button variant="secondary" size="sm" icon="refresh" onClick={() => { void loadCleanupPreview(); }}>
                重试读取预览
              </Button>
            </>
          ) : null}

          {preview === undefined ? null : (
            <>
              {blockers.length === 0 ? (
                <div className="banner ok" role="status">
                  <Icon name="check" />
                  <div className="grow">没有阻塞项，可以清理。</div>
                </div>
              ) : (
                <div className="banner danger" role="alert">
                  <Icon name="lock" />
                  <div className="grow">
                    <b>现在不能清理：还有 {String(blockers.length)} 项阻塞</b>
                    <ul className="list-plain" style={{ marginTop: 6 }}>
                      {blockers.map((blocker, index) => (
                        <li key={`${blocker.kind}:${blocker.ref ?? String(index)}`}>
                          {blocker.label}
                          {blocker.ref === undefined ? null : <span className="mono hint"> · {blocker.ref}</span>}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}

              <div>
                <div className="eyebrow">将删除</div>
                {preview.deleteObjects.length === 0 ? (
                  <p className="hint">服务没有返回可删除对象。</p>
                ) : (
                  <ul className="list-plain">
                    {preview.deleteObjects.map((item) => (
                      <li key={`${item.kind}:${item.label}`}>
                        <Icon name="trash" size="sm" /> {item.label}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div>
                <div className="eyebrow">会保留</div>
                <ul className="list-plain">
                  {preview.retainObjects.map((item) => (
                    <li key={`${item.kind}:${item.label}`}>
                      <Icon name="lock" size="sm" /> {item.label}
                    </li>
                  ))}
                </ul>
              </div>

              <div className={`banner ${preview.undelivered.count > 0 ? 'warn' : 'info'}`}>
                <Icon name={preview.undelivered.count > 0 ? 'alert' : 'info'} />
                <div className="grow">
                  <b>
                    未交付变更：{preview.undelivered.count === 0 ? '没有' : `${String(preview.undelivered.count)} 项`}
                  </b>
                  <br />
                  {preview.undelivered.reason}
                </div>
              </div>

              {preview.requiresUndeliveredAck ? (
                <label className="check">
                  <input
                    type="checkbox"
                    checked={cleanupAck}
                    onChange={(event) => { setCleanupAck(event.target.checked); }}
                  />
                  <span style={{ fontSize: 13, lineHeight: 1.6 }}>
                    我已了解：清理会删除工作区与本地任务分支；远端分支、回执与审计记录保留。
                    {preview.undelivered.count > 0 ? ' 还有未交付变更，清理后不能从工作区恢复。' : ''}
                  </span>
                </label>
              ) : null}

              <p className="hint">
                预览有效期至 {formatDateTime(preview.expiresAt)}；过期或工作区变化后服务会拒绝确认，需要重新读取预览。
              </p>
            </>
          )}
        </div>
      </Modal>

      <Modal
        open={cleanupDialog === 'confirm'}
        title="确认清理工作区"
        onClose={() => {
          if (cleanupBusy) return;
          setCleanupDialog(null);
        }}
        footer={
          <>
            <Button variant="ghost" onClick={() => { setCleanupDialog('preview'); }} disabled={cleanupBusy} disabledReason={cleanupBusy ? '正在提交清理请求，等待服务回执…' : undefined}>
              返回预览
            </Button>
            <span className="spacer" />
            <Button
              variant="danger"
              icon="trash"
              disabled={cleanupBusy || preview === undefined || confirmBlockedReason !== undefined}
              disabledReason={cleanupBusy ? '正在提交清理请求，等待服务回执…' : confirmBlockedReason}
              onClick={() => { void confirmCleanup(); }}
            >
              {cleanupBusy ? '正在清理…' : '确认清理'}
            </Button>
          </>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="banner warn" role="alert">
            <Icon name="alert" />
            <div className="grow">
              <b>清理不可撤销。</b>
              <br />
              会删除工作区与本地任务分支；任务、计划、远端分支、回执与审计记录保留。清理结果未明时只按原请求号核对，不会自动重发。
            </div>
          </div>

          {preview === undefined ? (
            <p className="hint">清理预览还没有读取成功。</p>
          ) : (
            <dl className="kv-list">
              <dt>工作区</dt>
              <dd className="mono">{preview.workspaceId}</dd>
              <dt>将删除</dt>
              <dd>{preview.deleteObjects.length === 0 ? '服务没有返回可删除对象' : preview.deleteObjects.map((item) => item.label).join('、')}</dd>
              <dt>未交付</dt>
              <dd>{preview.undelivered.count === 0 ? '没有' : `${String(preview.undelivered.count)} 项 · ${preview.undelivered.reason}`}</dd>
              <dt>保留</dt>
              <dd>远端分支、回执与审计记录</dd>
            </dl>
          )}

          {cleanupSubmitError === null ? null : cleanupUncertain ? (
            <>
              <CommandErrorNotice error={cleanupSubmitError} title="清理请求未完成" />
              <p className="hint mono">原请求号：{uncertainRequestKey}</p>
              <p className="hint">若请求可能已经发出，请先关闭对话框，在「清理工作区」区块按原请求号核对，不要直接重发。</p>
              <Button
                variant="secondary"
                size="sm"
                icon="refresh"
                onClick={() => {
                  setCleanupDialog('preview');
                  void loadCleanupPreview();
                }}
              >
                重新读取预览
              </Button>
            </>
          ) : (
            <>
              <CommandErrorNotice error={cleanupSubmitError} title="清理没有完成" />
              <Button
                variant="secondary"
                size="sm"
                icon="refresh"
                onClick={() => {
                  setCleanupDialog('preview');
                  void loadCleanupPreview();
                }}
              >
                重新读取预览
              </Button>
            </>
          )}
        </div>
      </Modal>

      <Modal
        open={prepareDialog === 'prepare' || prepareDialog === 'repair' || prepareDialog === 'retry'}
        title={prepareDialog === 'repair' ? '补建工作目录' : prepareDialog === 'retry' ? '重试准备工作区（新请求号）' : '准备独立工作区 · 确认'}
        onClose={() => { if (!busy) setPrepareDialog(null); }}
        className="wide-dialog"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => { setPrepareDialog(null); }} disabled={busy}>
              取消
            </Button>
            <Button
              variant="primary"
              size="sm"
              icon="folder"
              disabled={busy || lockedReason !== undefined || preparePreview === undefined || unresolvedBlockers.length > 0}
              disabledReason={lockedReason ?? (preparePreview === undefined ? (previewLoading ? '正在读取准备预览…' : '准备预览读取失败，不能确认') : (unresolvedBlockers[0]?.message ?? (prepareDialog === 'repair' ? '补建需要当前预览可用' : undefined)))}
              onClick={() => {
                if (taskId.length === 0 || plan === undefined || preparePreview === undefined) return;
                setPrepareSubmitError(null);
                const useNewNames = preparePreview.sameNameObjects.length > 0 && preparePreview.suggestedBranchName !== undefined;
                void runCommand(useNewNames ? '按新名称准备工作区' : prepareDialog === 'repair' ? '补建工作目录' : '准备独立工作区', (requestKey) =>
                  prepareWorkspace(taskId, {
                    expectedPlanRevisionNumber: plan.revisionNumber,
                    expectedBaseRef: preparePreview.baseRef,
                    ...(preparePreview.currentBaseSha === undefined ? {} : { expectedBaseTip: preparePreview.currentBaseSha }),
                    ...(useNewNames ? { branchName: preparePreview.suggestedBranchName, ...(preparePreview.suggestedDirectoryName === undefined ? {} : { directoryName: preparePreview.suggestedDirectoryName }) } : {}),
                    requestKey,
                  }),
                ).then((response) => {
                  if (response?.receipt.status === 'succeeded') {
                    setPrepareDialog(null);
                    onPrepared();
                  }
                }).catch((error: unknown) => {
                  setPrepareSubmitError(error);
                });
              }}
            >
              {busy ? '正在提交…' : prepareDialog === 'repair' ? '确认补建' : prepareDialog === 'retry' ? '确认重试准备' : '确认准备'}
            </Button>
          </>
        }
      >
        <p>
          这一步只创建任务身份、固定基线、任务分支/独立副本与工作目录，并做核对；<b>不会开始执行</b>。准备有回执，回执不当成执行成功。
        </p>
        {prepareDialog === 'repair' ? (
          <div className="banner warn">
            <Icon name="info" />
            <div className="grow">这是“补建”入口：只补建缺失的工作目录/对象，不会新建第二套工作区；已有对象保持不动。</div>
          </div>
        ) : null}
        {previewLoading ? <p className="hint">正在读取准备预览（只读，不创建任何东西）…</p> : null}
        {previewError === null || previewError === undefined ? null : <CommandErrorNotice error={previewError} title="准备预览读取失败" />}
        {preparePreview === undefined ? null : (
          <>
            <dl className="kv-list" style={{ marginTop: 10 }}>
              <dt>项目</dt>
              <dd>{preparePreview.projectName} · {preparePreview.gitState === 'git' ? 'Git worktree' : '目录副本（非 Git）'}</dd>
              <dt>计划修订</dt>
              <dd>#{plan?.revisionNumber ?? preparePreview.expectedPlanRevisionNumber ?? '—'}（已确认）</dd>
              <dt>将创建</dt>
              <dd>任务身份登记 · 固定基线 {preparePreview.baseRef}{preparePreview.currentBaseSha === undefined ? '' : ` @ ${preparePreview.currentBaseSha.slice(0, 10)}`} · 任务分支/独立副本 · 工作目录 · 核对</dd>
              <dt>保持不变</dt>
              <dd>原项目目录、默认分支、其他任务的工作区；不会 git init，也不会改写原目录</dd>
              {preparePreview.workspaceBaseSha === undefined ? null : (
                <>
                  <dt>工作区记录基线</dt>
                  <dd className="mono">{preparePreview.workspaceBaseRef ?? '—'} @ {preparePreview.workspaceBaseSha.slice(0, 10)}</dd>
                </>
              )}
            </dl>
            {unresolvedBlockers.length === 0 ? (
              <div className={`banner ${preparePreview.sameNameObjects.length > 0 ? 'warn' : 'ok'}`} role="status">
                <Icon name={preparePreview.sameNameObjects.length > 0 ? 'alert' : 'check'} />
                <div className="grow">
                  {preparePreview.sameNameObjects.length > 0
                    ? '同名对象会按下方“新名称”创建，不覆盖、不静默复用；确认后仅创建新名称的分支/目录。'
                    : '没有准备阻塞项。'}
                </div>
              </div>
            ) : (
              <div className="banner danger" role="alert">
                <Icon name="lock" />
                <div className="grow">
                  <b>现在不能准备：{unresolvedBlockers.length} 项阻塞</b>
                  <ul className="list-plain" style={{ marginTop: 6 }}>
                    {unresolvedBlockers.map((blocker) => (
                      <li key={`${blocker.code}-${blocker.message}`}>{blocker.code} · {blocker.message}</li>
                    ))}
                  </ul>
                  <button type="button" className="linkish" onClick={onPreviewRefresh}>重新读取预览</button>
                </div>
              </div>
            )}
            {preparePreview.sameNameObjects.length === 0 ? null : (
              <div className="banner warn">
                <Icon name="alert" />
                <div className="grow">
                  同名对象：
                  {preparePreview.sameNameObjects.map((item) => `${item.kind === 'branch' ? '分支' : 'worktree 目录'} ${item.name}`).join('、')}
                  {preparePreview.suggestedBranchName === undefined ? '；服务未返回可用的新名称' : `；将使用新名称：分支 ${preparePreview.suggestedBranchName}${preparePreview.suggestedDirectoryName === undefined ? '' : ` · 目录 ${preparePreview.suggestedDirectoryName}`}（不覆盖原对象）`}
                </div>
              </div>
            )}
          </>
        )}
        {lockedReason === undefined ? null : (
          <p className="hint" role="note">上一次操作结果待核对：{lockedReason}。请关闭对话框并按原请求号核对，不要重新提交。</p>
        )}
        {prepareSubmitError === null ? null : <CommandErrorNotice error={prepareSubmitError} title="准备没有完成" />}
      </Modal>

      <Modal
        open={prepareDialog === 'start'}
        title="开始执行 · 确认"
        onClose={() => { if (!busy) setPrepareDialog(null); }}
        className="wide-dialog"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => { setPrepareDialog(null); }} disabled={busy}>
              取消
            </Button>
            <Button
              variant="primary"
              size="sm"
              icon="play"
              disabled={busy || lockedReason !== undefined || startAction?.allowed !== true}
              disabledReason={lockedReason ?? (startAction?.allowed === true ? undefined : (startAction?.reason ?? '当前不能开始执行'))}
              onClick={() => {
                if (taskId.length === 0) return;
                void runCommand('开始执行', (requestKey) => startExecution(taskId, detail?.execution?.status, requestKey)).then((response) => {
                  if (response?.receipt.status === 'succeeded') {
                    setPrepareDialog(null);
                    onStartedExecution();
                  }
                });
              }}
            >
              {busy ? '正在开始…' : '确认开始执行'}
            </Button>
          </>
        }
      >
        <p>
          这是第二步，与“准备工作区”分开确认。开始执行会唤起受管 OpenCode 按计划领取步骤；<b>准备回执不当成执行成功</b>。开始后可在任务画布暂停、继续或取消。
        </p>
        <dl className="kv-list" style={{ marginTop: 10 }}>
          <dt>计划修订</dt>
          <dd>#{plan?.revisionNumber ?? '—'}（已确认）</dd>
          <dt>工作区</dt>
          <dd className="mono">{workspace?.displayRoot ?? '服务未返回工作区位置'}</dd>
          <dt>基线</dt>
          <dd className="mono">{workspace?.baseRef ?? '—'}{workspace?.baseSha === undefined ? '' : ` @ ${workspace.baseSha.slice(0, 10)}`}</dd>
          <dt>第一批步骤</dt>
          <dd>{firstBatchSteps(plan)}</dd>
        </dl>
        <div className="dialog-note">
          <Icon name="info" size="sm" />
          <span>服务会在命令时再次校验计划修订、工作区就绪与执行状态；不会因为本按钮而跳过准备回执。</span>
        </div>
      </Modal>
    </div>
  );
}
