import { useEffect, useState } from 'react';
import {
  WORKSPACE_STATE_LABEL,
  createRequestKey,
  type ActionAvailability,
  type OperationReceipt,
  type PlanRevision,
  type TaskDetailResponse,
  type TaskWorkspace,
  type WorkspaceCleanupPreview,
} from '@agent-workflow/shared';
import { errorMessage, isApiClientError } from '../../api/client.ts';
import {
  confirmWorkspaceCleanup,
  fetchOperationByKey,
  previewWorkspaceCleanup,
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

export interface WorkspacePanelProps {
  readonly detail?: TaskDetailResponse;
  readonly plan?: PlanRevision;
  readonly workspace?: TaskWorkspace;
  readonly actions: Record<string, ActionAvailability>;
  readonly busy: boolean;
  readonly onPrepare: () => void;
  readonly onStartExecution: () => void;
  readonly onOpenTask: () => void;
}

/**
 * “工作区” tab: plan confirmation → prepare isolated workspace → start execution,
 * with the two steps kept separate and every disabled action carrying a reason.
 */
export function WorkspacePanel({ detail, plan, workspace, actions, busy, onPrepare, onStartExecution, onOpenTask }: WorkspacePanelProps) {
  const taskId = detail?.task.id ?? '';
  const refresh = useWorkflowRefresh(taskId);
  const startAction = actions.startExecution;
  const prepareAction = actions.prepareWorkspace;
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

            {workspace.state === 'partial' || workspace.state === 'unknown' || workspace.state === 'blocked' ? (
              <div className="banner unknown" style={{ marginTop: 12 }}>
                <Icon name="help" />
                <div className="grow">
                  <b>工作区状态：{WORKSPACE_STATE_LABEL[workspace.state]}</b>
                  <br />
                  这不等于执行失败；按服务状态核对后再决定是否重试准备。不自动重发命令。
                </div>
              </div>
            ) : null}

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

        <div className="ws-actions">
          <ServiceActionButton
            size="sm"
            variant={workspaceReady ? 'secondary' : 'primary'}
            action={prepareAction}
            busy={busy && !workspaceReady}
            fallbackReason="服务未提供准备动作"
            onRun={onPrepare}
          >
            {workspaceReady ? '重新准备' : '准备独立工作区'}
          </ServiceActionButton>
          <ActionReasonLine action={prepareAction} />
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
          <ServiceActionButton
            variant="primary"
            icon="play"
            action={startAction}
            busy={busy && workspaceReady}
            fallbackReason="服务未提供开始执行动作"
            onRun={onStartExecution}
          >
            开始执行
          </ServiceActionButton>
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
    </div>
  );
}
