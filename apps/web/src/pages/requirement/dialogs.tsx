import { useEffect, useState } from 'react';
import {
  PLAN_REVISION_STATUS_LABEL,
  type OperationReceipt,
  type PlanRevision,
  type PlanningPreviewResponse,
  type PlanningRound,
  type TaskDetailResponse,
} from '@agent-workflow/shared';
import { Button } from '../../components/Button.tsx';
import { Icon } from '../../components/Icon.tsx';
import { Modal } from '../../components/Modal.tsx';
import { Pe37ScopeNotice } from './Pe37Overview.tsx';
import { pe37ScopeFromError } from './pe37.ts';
import { formatDateTime } from '../../app/format.ts';
import { applyPlanning, confirmPlan, previewPlanning, rejectPlanning, startPlanning, stopPlanning } from '../../api/workflow.ts';
import { CommandErrorNotice, ReceiptNotice } from '../../flow/workflow-ui.tsx';
import { UnknownLockBanner, unknownLockReason, type ReceiptCommandRunner } from './requirement-command.tsx';

/**
 * P11-02: every mutating dialog routes its command through the page-level
 * receipt command runner, so an UNKNOWN outcome locks the original operation
 * (by original request key) instead of leaving the button free to mint a new
 * request key and re-send.
 */
export interface DialogCommandProps {
  readonly command: ReceiptCommandRunner;
}

function dialogLocked(command: ReceiptCommandRunner): boolean {
  return command.state.busy || command.state.pendingUnknown !== undefined;
}

function dialogLockReason(command: ReceiptCommandRunner, fallback?: string): string | undefined {
  return unknownLockReason(command.state.pendingUnknown) ?? (command.state.busy ? '正在提交，等待服务回执…' : fallback);
}

/* ------------------------------------------------------------------ */
/* Planning preview                                                    */
/* ------------------------------------------------------------------ */

export interface PlanningPreviewDialogProps extends DialogCommandProps {
  readonly open: boolean;
  readonly taskId: string;
  readonly nextOrdinal: number;
  readonly onClose: () => void;
  readonly onPreviewLoaded?: (preview: PlanningPreviewResponse) => void;
  readonly onStarted: (receipt: OperationReceipt) => void;
}

/** The only place that confirms a model dispatch (design PE03/PE04). */
export function PlanningPreviewDialog({ open, taskId, nextOrdinal, command, onClose, onPreviewLoaded, onStarted }: PlanningPreviewDialogProps) {
  const [preview, setPreview] = useState<PlanningPreviewResponse | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<unknown>(null);

  useEffect(() => {
    if (!open) {
      setPreview(undefined);
      setLoadError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    setPreview(undefined);
    void previewPlanning(taskId, { roundOrdinal: nextOrdinal })
      .then((result) => {
        if (!cancelled) {
          setPreview(result);
          onPreviewLoaded?.(result);
        }
      })
      .catch((caught: unknown) => {
        if (!cancelled) setLoadError(caught);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset() is stable enough for this dialog lifecycle
  }, [open, taskId, nextOrdinal]);

  const data = preview?.preview;
  const blockers = preview?.blockers ?? data?.blockers ?? [];
  const blocked = blockers.length > 0;
  const reason = blocked ? `${blockers[0]?.code ?? 'BLOCKED'} · ${blockers[0]?.message ?? '预览发现阻塞项'}` : undefined;
  const notes = data?.notes ?? [];

  return (
    <Modal
      open={open}
      title={`规划预览 · 第 ${nextOrdinal} 轮`}
      onClose={onClose}
      className="wide-dialog"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={command.state.busy}>
            取消
          </Button>
          <Button
            variant="primary"
            size="sm"
            icon="sparkle"
            disabled={dialogLocked(command) || data === undefined || blocked}
            disabledReason={dialogLockReason(command, reason ?? '规划预览尚未加载完成')}
            title={dialogLockReason(command, reason)}
            onClick={() => {
              if (data === undefined) return;
              void command
                .run('确认开始规划', (requestKey) =>
                  startPlanning(taskId, { previewId: data.previewId, sourceInputRevision: data.sourceInputRevision }, requestKey),
                )
                .then((response) => {
                  if (response?.receipt.status === 'succeeded') {
                    onStarted(response.receipt);
                    onClose();
                  }
                });
            }}
          >
            {command.state.busy ? '正在确认…' : '确认开始规划'}
          </Button>
        </>
      }
    >
      {loading ? <p className="hint">正在向服务读取规划预览（只读，不调用模型）…</p> : null}
      <CommandErrorNotice error={loadError} title="规划预览读取失败" />
      <CommandErrorNotice error={command.state.error} />
      {pe37ScopeFromError(command.state.error) === undefined ? null : <Pe37ScopeNotice issue={pe37ScopeFromError(command.state.error)!} />}
      <ReceiptNotice receipt={command.state.receipt} />
      <UnknownLockBanner
        pending={command.state.pendingUnknown}
        checking={command.checking}
        lookupResult={command.lookupResult}
        onLookup={() => {
          void command.lookup();
        }}
      />
      {data === undefined ? null : (
        <>
          <p className="lede" style={{ marginTop: 4 }}>
            {data.project.name} · {data.method.name} {data.method.revision} · 策略 {data.strategy.name} {data.strategy.version}
          </p>
          <dl className="kv-list" style={{ marginTop: 12 }}>
            <dt>模型</dt>
            <dd>{data.model.label}</dd>
            <dt>来源输入</dt>
            <dd>需求输入修订 {data.sourceInputRevision}（原文/补充与资料修订以服务返回为准）</dd>
            <dt>资料</dt>
            <dd>
              {data.sources.map((source) => `${source.label}（${source.readable ? '可读' : '不可读'}）`).join('、') || '服务未返回资料'}
            </dd>
            <dt>最多派发</dt>
            <dd>
              初稿 {data.dispatchLimit.drafts} + 修订 {data.dispatchLimit.revisions} · 自动传输重试 {data.dispatchLimit.transportRetries}
            </dd>
            <dt>时限</dt>
            <dd>
              总 {data.timeLimitMinutes} 分钟 · 单次 {data.perDispatchLimitMinutes} 分钟
            </dd>
            <dt>本轮预算</dt>
            <dd>
              上限 {data.budget.limit} {data.budget.currency} · 已预留 {data.budget.reserved}
            </dd>
            <dt>图规模上限</dt>
            <dd>
              节点 {data.graphLimits.nodes} · 依赖 {data.graphLimits.edges} · 分组 {data.graphLimits.groups} · 深度 {data.graphLimits.depth}
            </dd>
            <dt>预览有效期</dt>
            <dd>{formatDateTime(data.expiresAt)}</dd>
          </dl>
          {notsNotes(notes)}
          {blockers.length === 0 ? null : (
            <div className="banner warn" style={{ marginTop: 12 }}>
              <Icon name="alert" />
              <div className="grow">
                <b>预览发现 {blockers.length} 项阻塞，不能开始规划</b>
                <ul className="list-plain" style={{ marginTop: 6 }}>
                  {blockers.map((blocker) => (
                    <li key={`${blocker.code}-${blocker.message}`}>
                      {blocker.code} · {blocker.message}
                      {blocker.goTo === undefined ? '' : `（去 ${blocker.goTo}）`}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
          <div className="dialog-note">
            <Icon name="info" size="sm" />
            <span>
              只有这一处确认模型调用。确认后不改当前图；候选需要你审阅、应用、确认。离开页面不会停止规划。候选到达后本轮可能仍在核对结束，
              <b>应用</b>按钮会写原因「正在核对本轮结束」。
            </span>
          </div>
        </>
      )}
    </Modal>
  );
}

function notsNotes(notes: readonly string[]) {
  if (notes.length === 0) return null;
  return (
    <div style={{ marginTop: 10 }}>
      <div className="eyebrow">服务说明</div>
      <ul className="list-plain">
        {notes.map((note) => (
          <li key={note}>{note}</li>
        ))}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Apply candidate                                                     */
/* ------------------------------------------------------------------ */

export interface ApplyCandidateDialogProps extends DialogCommandProps {
  readonly open: boolean;
  readonly taskId: string;
  readonly round: PlanningRound | undefined;
  readonly candidateRevision: PlanRevision | undefined;
  readonly acceptedDecisionIds: readonly string[];
  readonly onClose: () => void;
  readonly onApplied: (receipt: OperationReceipt) => void;
}

export function ApplyCandidateDialog({ open, taskId, round, candidateRevision, acceptedDecisionIds, command, onClose, onApplied }: ApplyCandidateDialogProps) {
  const decisions = round?.candidate?.validation.humanReview.items ?? [];
  const canRun = round !== undefined && candidateRevision !== undefined;

  return (
    <Modal
      open={open}
      title="应用到草稿"
      onClose={onClose}
      className="wide-dialog"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={command.state.busy}>
            取消
          </Button>
          <Button
            variant="primary"
            size="sm"
            icon="check"
            disabled={dialogLocked(command) || !canRun}
            disabledReason={dialogLockReason(command, canRun ? undefined : '缺少候选轮次或候选计划修订')}
            onClick={() => {
              if (round === undefined || candidateRevision === undefined) return;
              void command
                .run('应用候选到草稿', (requestKey) =>
                  applyPlanning(taskId, {
                    roundId: round.id,
                    candidatePlanRevisionId: candidateRevision.id,
                    acceptedDecisionIds: [...acceptedDecisionIds],
                    requestKey,
                  }),
                )
                .then((response) => {
                  if (response?.receipt.status === 'succeeded') {
                    onApplied(response.receipt);
                    onClose();
                  }
                });
            }}
          >
            {command.state.busy ? '正在应用…' : '确认应用'}
          </Button>
        </>
      }
    >
      <CommandErrorNotice error={command.state.error} />
      {pe37ScopeFromError(command.state.error) === undefined ? null : <Pe37ScopeNotice issue={pe37ScopeFromError(command.state.error)!} />}
      <ReceiptNotice receipt={command.state.receipt} />
      <UnknownLockBanner
        pending={command.state.pendingUnknown}
        checking={command.checking}
        lookupResult={command.lookupResult}
        onLookup={() => {
          void command.lookup();
        }}
      />
      <p>
        应用会把第 {round?.ordinal ?? '—'} 轮候选写入<b>未确认草稿</b>（计划修订 {candidateRevision?.revisionNumber ?? '—'}），
        <b>不会执行</b>；应用后仍需确认计划。
      </p>
      <div className="sec-t" style={{ marginTop: 14 }}>
        业务决定（需求输入修订 {round?.inputRevision ?? '—'}）
      </div>
      <p className="hint">本次应用将把已审阅的人工判断作为业务决定写入计划修订；应用不会执行任何步骤。</p>
      <div className="sec-t" style={{ marginTop: 14 }}>
        将随应用记录的风险核对（{acceptedDecisionIds.length} 项已核对）
      </div>
      {decisions.length === 0 ? (
        <p className="hint">本轮没有需人工判断项。</p>
      ) : (
        <ul className="list-plain dialog-list">
          {decisions.map((decision) => (
            <li key={decision.id}>
              <Icon name={decision.accepted ? 'check' : 'info'} size="sm" /> {decision.title}
              {decision.accepted ? '（服务已记录）' : ''}
            </li>
          ))}
        </ul>
      )}
      <p className="hint" style={{ marginTop: 10 }}>
        应用结果只记录到服务；如果回执未知，只按原请求号核对，不会自动重发。
      </p>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Reject candidate                                                    */
/* ------------------------------------------------------------------ */

export interface RejectCandidateDialogProps extends DialogCommandProps {
  readonly open: boolean;
  readonly taskId: string;
  readonly round: PlanningRound | undefined;
  readonly onClose: () => void;
  readonly onRejected: (receipt: OperationReceipt) => void;
}

/** Design: 不采用 only confirms “保留记录”，the reason is optional (REQ-11 P3). */
export function RejectCandidateDialog({ open, taskId, round, command, onClose, onRejected }: RejectCandidateDialogProps) {
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (!open) setReason('');
  }, [open]);

  return (
    <Modal
      open={open}
      title="不采用候选"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={command.state.busy}>
            取消
          </Button>
          <Button
            variant="danger"
            size="sm"
            icon="x"
            disabled={dialogLocked(command) || round === undefined}
            disabledReason={dialogLockReason(command, round === undefined ? '当前没有候选轮次' : undefined)}
            onClick={() => {
              if (round === undefined) return;
              void command
                .run('不采用候选', (requestKey) =>
                  rejectPlanning(taskId, { roundId: round.id, reason: reason.trim() === '' ? '用户选择不采用候选（未填写原因）' : reason.trim(), requestKey }),
                )
                .then((response) => {
                  if (response?.receipt.status === 'succeeded') {
                    onRejected(response.receipt);
                    onClose();
                  }
                });
            }}
          >
            {command.state.busy ? '正在提交…' : '确认不采用'}
          </Button>
        </>
      }
    >
      <CommandErrorNotice error={command.state.error} />
      {pe37ScopeFromError(command.state.error) === undefined ? null : <Pe37ScopeNotice issue={pe37ScopeFromError(command.state.error)!} />}
      <ReceiptNotice receipt={command.state.receipt} />
      <UnknownLockBanner
        pending={command.state.pendingUnknown}
        checking={command.checking}
        lookupResult={command.lookupResult}
        onLookup={() => {
          void command.lookup();
        }}
      />
      <p>不采用只保留记录，不是删除；已应用的草稿不受影响。当前草稿不变。候选硬阻塞时也可以“不采用”，不要求先修好。</p>
      <label className="label" htmlFor="reject-reason" style={{ marginTop: 12 }}>
        原因（可选）
      </label>
      <textarea
        id="reject-reason"
        className="textarea"
        value={reason}
        placeholder="例如：候选扩大了需求范围，先补充输入再重新规划"
        onChange={(event) => {
          setReason(event.target.value);
        }}
      />
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Stop planning                                                       */
/* ------------------------------------------------------------------ */

export interface StopPlanningDialogProps extends DialogCommandProps {
  readonly open: boolean;
  readonly taskId: string;
  readonly round: PlanningRound | undefined;
  readonly onClose: () => void;
  readonly onStopped: (receipt: OperationReceipt) => void;
}

export function StopPlanningDialog({ open, taskId, round, command, onClose, onStopped }: StopPlanningDialogProps) {
  return (
    <Modal
      open={open}
      title="请求停止本轮规划"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={command.state.busy}>
            取消
          </Button>
          <Button
            variant="danger"
            size="sm"
            icon="stop"
            disabled={dialogLocked(command) || round === undefined}
            disabledReason={dialogLockReason(command, round === undefined ? '当前没有进行中的轮次' : undefined)}
            onClick={() => {
              if (round === undefined) return;
              void command
                .run('请求停止规划', (requestKey) => stopPlanning(taskId, round.id, requestKey))
                .then((response) => {
                  if (response?.receipt.status === 'succeeded') {
                    onStopped(response.receipt);
                    onClose();
                  }
                });
            }}
          >
            {command.state.busy ? '正在请求停止…' : '确认停止本轮'}
          </Button>
        </>
      }
    >
      <CommandErrorNotice error={command.state.error} />
      {pe37ScopeFromError(command.state.error) === undefined ? null : <Pe37ScopeNotice issue={pe37ScopeFromError(command.state.error)!} />}
      <ReceiptNotice receipt={command.state.receipt} />
      <UnknownLockBanner
        pending={command.state.pendingUnknown}
        checking={command.checking}
        lookupResult={command.lookupResult}
        onLookup={() => {
          void command.lookup();
        }}
      />
      <p>只停止这一轮规划，不影响任何执行中的业务步骤；已有记录、草稿与用量都保留；停止完成前不能开始新一轮。</p>
      <p className="hint" style={{ marginTop: 8 }}>
        停止请求已受理 ≠ 原进程已停稳 ≠ 用量已结账；状态条与横幅会分开显示服务事实。
      </p>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Confirm plan                                                        */
/* ------------------------------------------------------------------ */

export interface ConfirmPlanDialogProps extends DialogCommandProps {
  readonly open: boolean;
  readonly taskId: string;
  readonly detail: TaskDetailResponse | undefined;
  readonly plan: PlanRevision | undefined;
  readonly unresolvedScopes?: readonly { readonly groupRef: string; readonly title: string }[];
  readonly fixedTemplate?: { readonly name: string; readonly version: number; readonly parameters: Readonly<Record<string, string>> };
  readonly onClose: () => void;
  readonly onConfirmed: (receipt: OperationReceipt) => void;
}

export function ConfirmPlanDialog({ open, taskId, detail, plan, unresolvedScopes, fixedTemplate, command, onClose, onConfirmed }: ConfirmPlanDialogProps) {
  const nodes = plan?.graph.nodes ?? [];
  const edges = plan?.graph.edges ?? [];
  const coverage = plan?.validation?.requirementCoverage ?? [];
  const acceptedDecisions = plan?.validation?.humanReview.items.filter((item) => item.accepted).length ?? 0;
  const readResources = nodes.reduce((total, node) => total + node.resources.read.length, 0);
  const writeResources = nodes.reduce((total, node) => total + node.resources.write.length, 0);
  const unresolved = unresolvedScopes ?? [];
  const unresolvedReason = unresolved.length === 0
    ? undefined
    : `还有 ${String(unresolved.length)} 个组未细化：${unresolved.map((scope) => scope.title).join('、')}；全部细化后才能确认计划。`;

  return (
    <Modal
      open={open}
      title="确认计划"
      onClose={onClose}
      className="wide-dialog"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={command.state.busy}>
            取消
          </Button>
          <Button
            variant="primary"
            size="sm"
            icon="check"
            disabled={dialogLocked(command) || plan === undefined || plan.status !== 'unconfirmed' || unresolvedReason !== undefined}
            disabledReason={dialogLockReason(
              command,
              unresolvedReason ?? (plan === undefined ? '当前没有未确认的计划' : plan.status !== 'unconfirmed' ? `计划当前状态：${PLAN_REVISION_STATUS_LABEL[plan.status]}` : undefined),
            )}
            onClick={() => {
              if (plan === undefined || detail === undefined) return;
              void command
                .run('确认计划', (requestKey) => confirmPlan(taskId, plan.id, plan.revisionNumber, requestKey))
                .then((response) => {
                  if (response?.receipt.status === 'succeeded') {
                    onConfirmed(response.receipt);
                    onClose();
                  }
                });
            }}
          >
            {command.state.busy ? '正在确认…' : '确认计划'}
          </Button>
        </>
      }
    >
      <CommandErrorNotice error={command.state.error} />
      {pe37ScopeFromError(command.state.error) === undefined ? null : <Pe37ScopeNotice issue={pe37ScopeFromError(command.state.error)!} />}
      <ReceiptNotice receipt={command.state.receipt} />
      <UnknownLockBanner
        pending={command.state.pendingUnknown}
        checking={command.checking}
        lookupResult={command.lookupResult}
        onLookup={() => {
          void command.lookup();
        }}
      />
      <p>
        确认<b>不调用模型，也不会立即执行</b>；确认后下一步才准备工作区，准备成功后单独开始执行。
      </p>
      {unresolved.length === 0 ? null : (
        <div className="banner warn" style={{ marginTop: 10 }}>
          <Icon name="alert" />
          <div className="grow">
            <b>还有 {String(unresolved.length)} 个组未细化，确认会被服务拒绝。</b>
            <br />
            {unresolved.map((scope) => `“${scope.title}”`).join('、')} 尚未细化；已细化组不会先执行，全部细化后才能确认整份计划。
          </div>
        </div>
      )}
      <div className="sec-t" style={{ marginTop: 12 }}>
        确认范围 · 计划依据
      </div>
      <dl className="kv-list">
        <dt>计划修订</dt>
        <dd>
          #{plan?.revisionNumber ?? '—'} · {plan === undefined ? '—' : PLAN_REVISION_STATUS_LABEL[plan.status]} · 来源 {plan?.source ?? '—'}
        </dd>
        <dt>需求输入修订</dt>
        <dd>{detail?.task.requirement.revision ?? '—'}</dd>
        <dt>检查依据</dt>
        <dd>{plan?.validation?.basis.detail ?? '服务未返回依据说明'}</dd>
        <dt>步骤 / 依赖</dt>
        <dd>
          {nodes.length} 步 · {edges.length} 条依赖
        </dd>
        <dt>需求覆盖</dt>
        <dd>
          {coverage.length === 0 ? '服务未返回覆盖表' : `${coverage.filter((item) => item.covered).length} / ${coverage.length} 项已覆盖`}
        </dd>
        <dt>已审阅人工判断</dt>
        <dd>{acceptedDecisions} 项</dd>
        <dt>读写范围</dt>
        <dd>
          读 {readResources} 处资源引用 · 写 {writeResources} 处资源引用
        </dd>
        <dt>规划依据哈希</dt>
        <dd>服务未提供 planningBindingHash（能力缺口 C1）；确认时服务仍会再次校验计划修订与输入。</dd>
        {fixedTemplate === undefined ? null : (
          <>
            <dt>固定模板</dt>
            <dd>{fixedTemplate.name} · 版本 {fixedTemplate.version}；入口参数 {Object.keys(fixedTemplate.parameters).length === 0 ? '无' : Object.entries(fixedTemplate.parameters).map(([key, value]) => `${key}=${value}`).join('、')}；验收不能弱化</dd>
          </>
        )}
      </dl>
      <div className="dialog-note">
        <Icon name="info" size="sm" />
        <span>确认范围包含规划依据；服务会在命令时再次校验计划修订与输入。</span>
      </div>
    </Modal>
  );
}
