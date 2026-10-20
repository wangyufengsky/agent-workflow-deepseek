import { useState } from 'react';
import {
  EXECUTION_STATUS_LABEL,
  WORKSPACE_STATE_LABEL,
  createRequestKey,
  type ExecutionView,
  type OperationReceipt,
  type PlanRevision,
  type Task,
  type TaskDelivery,
  type TaskWorkspace,
  type WorkspaceCleanupPreview,
} from '@agent-workflow/shared';
import { errorMessage, isApiClientError } from '../../api/client.ts';
import { confirmWorkspaceCleanup, fetchOperationByKey, previewWorkspaceCleanup } from '../../api/workflow.ts';
import { Badge } from '../../components/Badge.tsx';
import { Button } from '../../components/Button.tsx';
import { Drawer } from '../../components/Drawer.tsx';
import { Icon } from '../../components/Icon.tsx';
import { Modal } from '../../components/Modal.tsx';
import { formatDateTime } from '../../app/format.ts';
import { CommandErrorNotice, ReceiptNotice } from '../../flow/workflow-ui.tsx';

export interface WorkspaceDetailDrawerProps {
  readonly open: boolean;
  readonly task: Task;
  readonly plan?: PlanRevision;
  readonly execution?: ExecutionView;
  readonly workspace?: TaskWorkspace;
  readonly delivery?: TaskDelivery;
  readonly onClose: () => void;
  readonly onRefresh: () => Promise<void>;
}

type PreviewState =
  | { readonly phase: 'idle' }
  | { readonly phase: 'loading' }
  | { readonly phase: 'ready'; readonly preview: WorkspaceCleanupPreview }
  | { readonly phase: 'error'; readonly error: unknown };

function stepStateLabel(state: WorkspaceCleanupPreview | undefined): string {
  if (state === undefined) return '—';
  return state.previewRef.length > 0 ? '预览已读取' : '—';
}

/**
 * TD06 (P13-12 / DEL-26): 任务画布「工作区详情」520 抽屉。
 *
 * 只消费服务真实字段（TaskWorkspace / TaskDelivery / 清理预览端点），
 * 不伪造容量、清理步骤或交付凭证；服务未提供的能力显式标注「未知 / 未提供」。
 */
export function WorkspaceDetailDrawer({ open, task, plan, execution, workspace, delivery, onClose, onRefresh }: WorkspaceDetailDrawerProps) {
  const [preview, setPreview] = useState<PreviewState>({ phase: 'idle' });
  const [dialog, setDialog] = useState<'preview' | 'confirm' | null>(null);
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState<OperationReceipt | undefined>(undefined);
  const [submitError, setSubmitError] = useState<unknown>(null);
  const [uncertainKey, setUncertainKey] = useState<string | undefined>(undefined);
  const [checking, setChecking] = useState(false);
  const [checkResult, setCheckResult] = useState<{ readonly status: string; readonly stillUnknown: boolean } | undefined>(undefined);

  if (workspace === undefined) {
    return (
      <Drawer open={open} title="工作区详情" size="lg" onClose={onClose} footer={<span className="hint grow">还没有工作区；准备独立工作区后才能查看与清理。</span>}>
        <div className="banner info">
          <Icon name="folder" />
          <div className="grow">
            <b>任务还没有独立工作区。</b>
            <br />
            出发准备成功后，这里显示任务分支 / worktree 或独立副本、活动写入、交付与清理事实。
          </div>
        </div>
      </Drawer>
    );
  }

  const git = workspace.kind === 'git_worktree';
  const cleaned = workspace.state === 'cleaned' || workspace.retention === 'cleaned';
  const partial = workspace.state === 'partial' || workspace.retention === 'partial';
  const cleaning = workspace.state === 'cleaning' || workspace.retention === 'cleaning';
  const runningWrites = workspace.activeWrites.length > 0 || execution?.status === 'running';
  const delivered = task.lifecycle === 'completed' || delivery?.projection === 'delivered';
  const undelivered = delivered ? 0 : delivery?.remaining.unselected ?? (delivery === undefined ? 0 : 1);
  const blockers = preview.phase === 'ready' ? preview.preview.blockers : [];
  const previewExpired = preview.phase === 'ready' && Date.parse(preview.preview.expiresAt) <= Date.now();
  const needsAck = preview.phase === 'ready' && preview.preview.requiresUndeliveredAck === true && !ack;
  const cleanupUncertain = submitError !== null && uncertainKey !== undefined;
  const cleanupBlockedReason = cleaning
    ? '工作区正在清理，不能重复清理。'
    : workspace.pendingOperationRef !== undefined
      ? `工作区有未结清操作（${workspace.pendingOperationRef}）；先按原请求核对。`
      : preview.phase === 'ready' && blockers.length > 0
        ? `存在 ${String(blockers.length)} 项阻塞：${blockers.map((blocker) => blocker.label).join('；')}`
        : previewExpired
          ? '清理预览已过期，请重新读取预览。'
          : needsAck
            ? '请先勾选知情确认：清理会永久丢弃未交付变更。'
            : cleanupUncertain
              ? '上一次清理请求没有收到回执：先按原请求号核对，不要重复提交。'
              : undefined;

  const loadPreview = async () => {
    setPreview({ phase: 'loading' });
    setSubmitError(null);
    try {
      const result = await previewWorkspaceCleanup(task.id);
      setPreview({ phase: 'ready', preview: result.preview });
    } catch (error) {
      setPreview({ phase: 'error', error });
    }
  };

  const openCleanup = () => {
    setAck(false);
    setCheckResult(undefined);
    setDialog('preview');
    void loadPreview();
  };

  const confirmCleanup = async () => {
    if (preview.phase !== 'ready' || cleanupBlockedReason !== undefined || busy) return;
    setBusy(true);
    setSubmitError(null);
    setCheckResult(undefined);
    // Keep the original request key so an unknown outcome can only be reconciled, never re-sent.
    const requestKey = createRequestKey();
    setUncertainKey(requestKey);
    try {
      const response = await confirmWorkspaceCleanup(task.id, {
        previewRef: preview.preview.previewRef,
        workspaceRevision: preview.preview.workspaceRevision,
        requestKey,
      });
      setReceipt(response.receipt);
      setDialog(null);
      await onRefresh();
      if (response.receipt.status === 'succeeded') {
        setPreview({ phase: 'idle' });
        setAck(false);
      }
    } catch (error) {
      setSubmitError(error);
      if (isApiClientError(error) && error.kind === 'http' && (error.status ?? 500) < 500) setUncertainKey(undefined);
    } finally {
      setBusy(false);
    }
  };

  const verifyPending = async (requestKey: string) => {
    setChecking(true);
    try {
      const result = await fetchOperationByKey(requestKey);
      setCheckResult({ status: result.operation.status, stillUnknown: result.stillUnknown });
      await onRefresh();
    } catch (error) {
      setSubmitError(error);
    } finally {
      setChecking(false);
    }
  };

  return (
    <>
      <Drawer
        open={open}
        title={`工作区详情 · ${task.title}`}
        size="lg"
        onClose={() => {
          // The cleanup dialogs sit above the drawer; Esc belongs to the dialog first.
          if (dialog !== null || busy) return;
          onClose();
        }}
        footer={
          <>
            <span className="hint grow">关闭不会清理 · 文件保留，可稍后交付 / 查看</span>
            <Button variant="ghost" size="sm" onClick={onClose}>
              关闭
            </Button>
            {partial && workspace.pendingOperationRef !== undefined ? (
              <Button variant="secondary" size="sm" icon="search" disabled={checking} disabledReason={checking ? '正在核对原清理…' : undefined} onClick={() => { void verifyPending(workspace.pendingOperationRef!); }}>
                {checking ? '正在核对…' : '核对原清理'}
              </Button>
            ) : null}
            {cleaned ? null : (
              <Button variant="danger" size="sm" icon="trash" disabled={runningWrites || cleaning || cleanupUncertain} disabledReason={runningWrites ? '执行仍在进行，确认停稳后才能清理工作区' : cleaning ? '工作区正在清理' : cleanupUncertain ? '上一次清理请求没有收到回执：先按原请求号核对' : undefined} onClick={openCleanup}>
                清理工作区…
              </Button>
            )}
          </>
        }
      >
        {cleaned ? (
          <div className="banner ok" style={{ marginBottom: 14 }}>
            <Icon name="archive" />
            <div className="grow">
              <b>工作区已清理，可查看提交与回执。</b>
              <br />
              本地{git ? '任务分支与 worktree' : '独立副本'}已删除；交付回执、{git ? '提交、远端分支与 MR' : '应用回执与基线快照'}保留，仍可阅读。变更页签不再代表本地文件仍在。
            </div>
          </div>
        ) : null}
        {partial ? (
          <div className="banner unknown" style={{ marginBottom: 14 }}>
            <Icon name="help" />
            <div className="grow">
              <b>清理未完成 · 待核对。</b>
              <br />
              {workspace.pendingOperationRef === undefined ? '服务没有返回原清理请求号；保持待核对，不会重复发出删除。' : `原清理请求 ${workspace.pendingOperationRef} 回执未知；只能核对原操作，不会再次发出删除。`}
            </div>
          </div>
        ) : null}
        {checkResult === undefined ? null : (
          <div className={`banner ${checkResult.stillUnknown ? 'unknown' : 'info'}`} role="status" style={{ marginBottom: 14 }}>
            <Icon name={checkResult.stillUnknown ? 'help' : 'check'} />
            <div className="grow">
              核对结果：{checkResult.status}
              {checkResult.stillUnknown ? ' · 仍为未知，保持待核对，不会重发。' : ' · 已按服务回读工作区状态。'}
            </div>
          </div>
        )}

        <dl className="kv-list">
          <dt>类型</dt>
          <dd>{git ? 'Git · 独立分支与 worktree' : '非 Git · 基线快照与独立副本（不是 worktree）'}</dd>
          <dt>公开身份</dt>
          <dd className="mono">{workspace.id}</dd>
          <dt>任务</dt>
          <dd>
            {task.title} · <span className="mono">{task.id}</span> · 执行 {execution === undefined ? '尚未创建' : EXECUTION_STATUS_LABEL[execution.status]}
          </dd>
          <dt>状态</dt>
          <dd>
            <Badge tone={workspace.state === 'ready' ? 'ok' : workspace.state === 'blocked' ? 'fail' : workspace.state === 'unknown' ? 'unknown' : 'idle'}>{WORKSPACE_STATE_LABEL[workspace.state]}</Badge>
            {workspace.retention === 'retained' || workspace.retention === 'cleaned' || workspace.retention === 'partial' || workspace.retention === 'cleaning' ? <span className="hint"> · 保留策略 {workspace.retention}</span> : null}
          </dd>
          <dt>原项目</dt>
          <dd className="mono">{workspace.originalRootDisplay ?? '—'}</dd>
          <dt>说明</dt>
          <dd>原目录从不是清理对象；{git ? '写入发生在独立分支与 worktree。' : '写入发生在独立副本；原目录只读。'}</dd>
          <dt>基线</dt>
          <dd className="mono">
            {workspace.baseRef ?? '—'}
            {workspace.baseSha === undefined ? '' : ` @ ${workspace.baseSha.slice(0, 10)}`}
          </dd>
          <dt>{git ? '任务目录与分支' : '副本目录'}</dt>
          <dd>
            <span className={`mono${cleaned ? ' ws-path-gone' : ''}`}>{workspace.displayRoot ?? '—'}</span>
            {cleaned ? <Badge tone="idle">已删除</Badge> : null}
            <br />
            {git ? (
              <>
                任务分支 <span className="mono">{workspace.branch ?? '—'}</span>
                <span className="hint"> · 本地 · 系统生成{cleaned ? '（本地已删除，远端保留）' : ''}</span>
              </>
            ) : (
              <span className="hint">独立副本，不创建分支</span>
            )}
          </dd>
          <dt>子工作区</dt>
          <dd>
            {workspace.children.length === 0 ? (
              <span className="hint">无子工作区（并行写策略：{workspace.parallelWritePolicy === 'serial' ? '逐个领取' : '子隔离后合并'}）</span>
            ) : (
              workspace.children.map((child) => `${child.name}（${child.state}${child.mergedAt === undefined ? '' : ` · 已汇合 ${formatDateTime(child.mergedAt)}`}）`).join('、')
            )}
          </dd>
          <dt>创建</dt>
          <dd>{formatDateTime(workspace.createdAt)}</dd>
          <dt>最后检查</dt>
          <dd>{formatDateTime(workspace.lastCheckedAt)}</dd>
          <dt>占用空间</dt>
          <dd className="hint">未知（服务未提供）</dd>
        </dl>

        <div className="sec" style={{ marginTop: 16 }}>
          <div className="eyebrow">当前状态</div>
          <dl className="kv-list">
            <dt>活动写入</dt>
            <dd>
              {runningWrites ? (
                <span style={{ color: 'var(--run)' }}>
                  <Icon name="play" size="sm" /> {workspace.activeWrites.length === 0 ? '运行中的步骤可能持有写入' : `${workspace.activeWrites.map((nodeId) => plan?.graph.nodes.find((node) => node.id === nodeId)?.title ?? nodeId).join('、')} 写入中`}
                </span>
              ) : (
                '无'
              )}
            </dd>
            <dt>未交付 / 未选</dt>
            <dd>{delivered ? '0 · 已交付' : `${String(undelivered)} 项未交付（清理会永久丢弃，产品内无法恢复）`}</dd>
            <dt>未决原请求</dt>
            <dd className="mono">{workspace.pendingOperationRef ?? (partial ? '清理 · 回执未知（服务未返回请求号）' : '无')}</dd>
            <dt>已交付凭证</dt>
            <dd>
              {delivered
                ? delivery === undefined
                  ? '任务已完成；交付面板中的回执仍可读'
                  : delivery.steps
                      .filter((step) => step.state === 'succeeded')
                      .map((step) => `${step.step}${step.commitSha === undefined ? '' : ` · ${step.commitSha.slice(0, 7)}`}${step.mrIid === undefined ? '' : ` · MR !${String(step.mrIid)}`}${step.remoteRef === undefined ? '' : ` · ${step.remoteRef}`}`)
                      .join(' / ') || '交付回执已记录'
                : '尚无'}
            </dd>
          </dl>
        </div>

        <div className="sec" style={{ marginTop: 16 }}>
          <div className="eyebrow">清理</div>
          <p className="hint">
            {cleaned
              ? '工作区已清理；清理是独立动作，不会定时或自动发生。'
              : runningWrites
                ? '执行进行中，暂不能清理；确认停稳后由你确认清理。'
                : '清理只删除本任务自有的本地对象；原目录、远端分支、回执与审计记录保留。清理是独立动作，只在你确认后进行，不设定时或自动清理。'}
          </p>
          <p className="hint">在文件管理器显示：{typeof window !== 'undefined' && window.workflowDesktop?.revealInFileManager !== undefined && workspace.displayRoot !== undefined && !cleaned ? '宿主支持，可从任务目录按钮打开' : '当前宿主未提供该能力'}</p>
          {workspace.displayRoot === undefined || cleaned ? null : (
            <Button
              size="sm"
              variant="ghost"
              icon="external"
              disabled={window.workflowDesktop?.revealInFileManager === undefined}
              disabledReason="当前桌面宿主未提供「在文件管理器显示」能力"
              onClick={() => {
                void window.workflowDesktop?.revealInFileManager?.(workspace.displayRoot!);
              }}
            >
              在文件管理器显示
            </Button>
          )}
        </div>

        <ReceiptNotice receipt={receipt} successMessage="工作区清理请求已结算；工作区与本地分支的最终状态以服务回读为准。" />
        {submitError === null ? null : cleanupUncertain ? (
          <div className="banner danger" role="alert">
            <Icon name="alert" />
            <div className="grow">
              <b>清理请求没有收到回执</b>
              <br />
              {errorMessage(submitError)}
              <span className="mono"> 请求号 {uncertainKey}</span>
              <span style={{ display: 'block', marginTop: 4 }}>请求可能已经发出：只按原请求号核对，不自动重发；核对前不要再次清理。</span>
            </div>
            <div className="actions">
              <Button variant="secondary" size="sm" icon="search" disabled={checking} disabledReason={checking ? '正在核对原请求…' : undefined} onClick={() => { if (uncertainKey !== undefined) void verifyPending(uncertainKey); }}>
                {checking ? '正在核对…' : '按原请求号核对'}
              </Button>
            </div>
          </div>
        ) : (
          <CommandErrorNotice error={submitError} title="清理没有完成" />
        )}
      </Drawer>

      <Modal
        open={dialog === 'preview'}
        title="清理工作区 · 预览"
        onClose={() => {
          if (busy) return;
          setDialog(null);
        }}
        footer={
          <>
            <Button variant="ghost" onClick={() => { setDialog(null); }} disabled={busy} disabledReason={busy ? '正在提交清理请求，等待服务回执…' : undefined}>
              取消
            </Button>
            <span className="spacer" />
            <Button variant="secondary" icon="refresh" disabled={busy || preview.phase === 'loading'} disabledReason={busy ? '正在提交清理请求…' : '正在读取清理预览…'} onClick={() => { void loadPreview(); }}>
              重新读取预览
            </Button>
            <Button variant="danger" icon="trash" disabled={preview.phase !== 'ready' || cleanupBlockedReason !== undefined} disabledReason={cleanupBlockedReason ?? (preview.phase === 'loading' ? '正在读取清理预览…' : undefined)} onClick={() => { setDialog('confirm'); }}>
              继续确认清理
            </Button>
          </>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <p className="hint">下面是服务返回的清理预览，只读；确认前不会删除任何东西。</p>
          {preview.phase === 'loading' ? <p className="hint">正在读取清理预览…</p> : null}
          {preview.phase === 'error' ? (
            <>
              <CommandErrorNotice error={preview.error} title="清理预览读取失败" />
              <Button variant="secondary" size="sm" icon="refresh" onClick={() => { void loadPreview(); }}>
                重试读取预览
              </Button>
            </>
          ) : null}
          {preview.phase !== 'ready' ? null : (
            <>
              {preview.preview.blockers.length === 0 ? (
                <div className="banner ok" role="status">
                  <Icon name="check" />
                  <div className="grow">没有阻塞项，可以清理。</div>
                </div>
              ) : (
                <div className="banner danger" role="alert">
                  <Icon name="lock" />
                  <div className="grow">
                    <b>现在不能清理：还有 {String(preview.preview.blockers.length)} 项阻塞</b>
                    <ul className="list-plain" style={{ marginTop: 6 }}>
                      {preview.preview.blockers.map((blocker, index) => (
                        <li key={`${blocker.kind}:${blocker.ref ?? String(index)}`}>
                          {blocker.label}
                          {blocker.ref === undefined ? null : <span className="mono hint"> · {blocker.ref}</span>}
                        </li>
                      ))}
                    </ul>
                    <p className="hint" style={{ marginTop: 6 }}>阻塞原因来自服务；解除后重新读取预览。不会排队，也不会在条件满足后自动清理。</p>
                  </div>
                </div>
              )}
              <div>
                <div className="eyebrow">将删除</div>
                {preview.preview.deleteObjects.length === 0 ? (
                  <p className="hint">服务没有返回可删除对象。</p>
                ) : (
                  <ul className="list-plain">
                    {preview.preview.deleteObjects.map((item) => (
                      <li key={`${item.kind}:${item.label}`}>
                        <Icon name="trash" size="sm" /> {item.label}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div>
                <div className="eyebrow">保留</div>
                <ul className="list-plain">
                  {preview.preview.retainObjects.map((item) => (
                    <li key={`${item.kind}:${item.label}`}>
                      <Icon name="lock" size="sm" /> {item.label}
                    </li>
                  ))}
                </ul>
              </div>
              <div className={`banner ${preview.preview.undelivered.count > 0 ? 'warn' : 'info'}`}>
                <Icon name={preview.preview.undelivered.count > 0 ? 'alert' : 'info'} />
                <div className="grow">
                  <b>未交付变更：{preview.preview.undelivered.count === 0 ? '没有' : `${String(preview.preview.undelivered.count)} 项`}</b>
                  <br />
                  {preview.preview.undelivered.reason}
                </div>
              </div>
              {preview.preview.requiresUndeliveredAck ? (
                <label className="check">
                  <input type="checkbox" checked={ack} onChange={(event) => { setAck(event.target.checked); }} />
                  <span style={{ fontSize: 13, lineHeight: 1.6 }}>
                    我已了解：清理会删除本工作区与本地任务分支；远端分支、回执与审计记录保留。
                    {preview.preview.undelivered.count > 0 ? ' 还有未交付变更，清理后不能从工作区恢复。' : ''}
                  </span>
                </label>
              ) : null}
              <p className="hint">
                预览有效期至 {formatDateTime(preview.preview.expiresAt)}；过期或工作区变化后服务会拒绝确认，需要重新读取预览。
              </p>
            </>
          )}
        </div>
      </Modal>

      <Modal
        open={dialog === 'confirm'}
        title="确认清理工作区"
        onClose={() => {
          if (busy) return;
          setDialog(null);
        }}
        footer={
          <>
            <Button variant="ghost" onClick={() => { setDialog('preview'); }} disabled={busy} disabledReason={busy ? '正在提交清理请求，等待服务回执…' : undefined}>
              返回预览
            </Button>
            <span className="spacer" />
            <Button variant="danger" icon="trash" disabled={busy || preview.phase !== 'ready' || cleanupBlockedReason !== undefined} disabledReason={busy ? '正在提交清理请求，等待服务回执…' : cleanupBlockedReason} onClick={() => { void confirmCleanup(); }}>
              {busy ? '正在清理…' : '确认清理'}
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
          {preview.phase !== 'ready' ? (
            <p className="hint">清理预览还没有读取成功。</p>
          ) : (
            <>
              <p className="hint">将删除：{preview.preview.deleteObjects.map((item) => item.label).join('、') || '（服务没有返回可删除对象）'}</p>
              <p className="hint">保留：{preview.preview.retainObjects.map((item) => item.label).join('、')}</p>
              <p className="hint">{stepStateLabel(preview.preview)} · 预览有效期至 {formatDateTime(preview.preview.expiresAt)}。</p>
            </>
          )}
        </div>
      </Modal>
    </>
  );
}
