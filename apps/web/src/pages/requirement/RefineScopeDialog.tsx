import { useEffect, useState } from 'react';
import {
  type OperationReceipt,
  type RefineScopePreview,
} from '@agent-workflow/shared';
import { formatDateTime } from '../../app/format.ts';
import { Button } from '../../components/Button.tsx';
import { Icon } from '../../components/Icon.tsx';
import { Modal } from '../../components/Modal.tsx';
import { previewRefineScope, startScopedPlanning } from './pe37.ts';
import { CommandErrorNotice, ReceiptNotice } from '../../flow/workflow-ui.tsx';
import { Pe37ScopeNotice } from './Pe37Overview.tsx';
import { pe37ScopeFromError } from './pe37.ts';

export interface RefineScopeDialogProps {
  readonly open: boolean;
  readonly taskId: string;
  readonly groupRef: string | null;
  readonly groupTitle: string | null;
  readonly sourceInputRevision: number;
  readonly onClose: () => void;
  readonly onStarted: (receipt: OperationReceipt) => void;
}

/**
 * PE37 S2: preview is read-only; only the explicit confirm calls the model.
 * Every scoped round is a new round with its own dispatch/revise quota.
 */
export function RefineScopeDialog({ open, taskId, groupRef, groupTitle, sourceInputRevision, onClose, onStarted }: RefineScopeDialogProps) {
  const [preview, setPreview] = useState<RefineScopePreview | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [receipt, setReceipt] = useState<OperationReceipt | undefined>(undefined);

  useEffect(() => {
    if (!open || groupRef === null) {
      setPreview(undefined);
      setLoadError(null);
      setError(null);
      setReceipt(undefined);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    setError(null);
    setReceipt(undefined);
    setPreview(undefined);
    void previewRefineScope(taskId, groupRef)
      .then((result) => {
        if (!cancelled) setPreview(result);
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
  }, [open, taskId, groupRef]);

  const blockers = preview?.blockers ?? [];
  const expired = preview !== undefined && new Date(preview.expiresAt).getTime() <= Date.now();
  const disabledReason = loading
    ? '正在读取选区预览…'
    : loadError !== null
      ? '预览读取失败，不能开始规划。'
      : preview === undefined
        ? '服务未返回选区预览。'
        : blockers.length > 0
          ? `${blockers[0]?.code ?? 'BLOCKED'} · ${blockers[0]?.message ?? '预览发现阻塞项'}`
          : expired
            ? '预览已过期，请关闭后重新预览。'
            : receipt?.status === 'unknown' || receipt?.status === 'accepted'
              ? '结果待核对，不能重复开始。'
              : busy
                ? '正在确认模型调用…'
                : undefined;

  const runStart = () => {
    if (preview === undefined || disabledReason !== undefined) return;
    setBusy(true);
    setError(null);
    setReceipt(undefined);
    void startScopedPlanning(taskId, {
      previewRef: preview.previewRef,
      sourceInputRevision,
      groupRef: preview.groupRef,
    })
      .then((response) => {
        setReceipt(response.receipt);
        if (response.receipt.status === 'succeeded') {
          onStarted(response.receipt);
          onClose();
        }
      })
      .catch((caught: unknown) => {
        setError(caught);
      })
      .finally(() => {
        setBusy(false);
      });
  };

  return (
    <Modal
      open={open}
      title="继续规划选区 · 预览"
      onClose={onClose}
      className="wide-dialog pe37-refine-dialog"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
            返回
          </Button>
          <Button
            variant="primary"
            size="sm"
            icon="sparkle"
            disabled={disabledReason !== undefined}
            disabledReason={disabledReason}
            onClick={runStart}
          >
            {busy ? '正在确认…' : '确认开始规划'}
          </Button>
        </>
      }
    >
      {loading ? <p className="hint">正在向服务读取选区预览（只读，不调用模型）…</p> : null}
      <CommandErrorNotice error={loadError} title="选区预览读取失败" />
      <CommandErrorNotice error={error} title="本轮规划未开始" />
      {pe37ScopeFromError(error) === undefined ? null : <Pe37ScopeNotice issue={pe37ScopeFromError(error)!} />}
      <ReceiptNotice receipt={receipt} successMessage="已开始本轮分组规划。" />
      {preview === undefined ? null : (
        <>
          <p className="lede" style={{ marginTop: 4 }}>
            第 {preview.round} 轮 · 只细化“{preview.groupTitle}”
          </p>
          <p className="hint">
            确认后才会调用模型。规划只生成候选：不会修改当前草稿；候选需要你审阅、应用，全部组细化后再确认计划。
          </p>
          <dl className="kv-list" style={{ marginTop: 12 }}>
            <dt>细化范围</dt>
            <dd>
              分组“{preview.groupTitle}”（第 {preview.round} 轮）
              <span className="hint">只在该组内生成叶子步骤；替换 {preview.scope.placeholderNodeIds.length} 个未细化占位，其他分组与当前草稿不变，跨组依赖按总览连线保留。每次继续规划选区都是新的一轮，各有 1 次修订机会。</span>
            </dd>
            <dt>计划修订</dt>
            <dd>当前 {preview.limits.currentNodes} 个叶子步骤 · {preview.limits.projectedLeafCount} 个预计叶子 · {preview.limits.currentGroups} 个分组</dd>
            <dt>次数</dt>
            <dd>最多 {preview.budget.dispatches} 次派发：初稿 1 + 修订 {preview.budget.revisions}</dd>
            <dt>时限</dt>
            <dd>总 {preview.budget.timeLimitMinutes} 分钟 · 单次 ≤ {preview.budget.perDispatchLimitMinutes} 分钟</dd>
            <dt>本轮预算</dt>
            <dd>
              上限 {preview.budget.budgetLimit} {preview.budget.currency}
            </dd>
            <dt>上限</dt>
            <dd>
              节点 ≤ {preview.limits.maxNodes} · 分组 ≤ {preview.limits.maxGroups} · 深度 ≤ {preview.limits.maxDepth}
            </dd>
            <dt>预览有效期</dt>
            <dd>{formatDateTime(preview.expiresAt)}</dd>
            {groupTitle === null ? null : (
              <>
                <dt>入口分组</dt>
                <dd>{groupTitle}</dd>
              </>
            )}
          </dl>
          {preview.instructions.length === 0 ? null : (
            <div className="dialog-note" style={{ marginTop: 10 }}>
              <Icon name="info" size="sm" />
              <div>
                {preview.instructions.map((instruction) => <div key={instruction}>· {instruction}</div>)}
              </div>
            </div>
          )}
          {blockers.length === 0 ? null : (
            <div className="banner warn" style={{ marginTop: 12 }}>
              <Icon name="alert" />
              <div className="grow">
                <b>预览发现 {blockers.length} 项阻塞，不能开始规划</b>
                <ul className="list-plain" style={{ marginTop: 6 }}>
                  {blockers.map((blocker) => <li key={blocker.code}>{blocker.code} · {blocker.message}</li>)}
                </ul>
              </div>
            </div>
          )}
          {expired ? (
            <div className="banner warn" style={{ marginTop: 10 }}>
              <Icon name="clock" />
              <div className="grow">预览已过期；关闭后重新点“继续规划选区”读取新的预览，不会沿用旧预览。</div>
            </div>
          ) : null}
          <div className="dialog-note">
            <Icon name="info" size="sm" />
            <span>
              只有这一处确认模型调用。停止只停本轮；停稳并结账后才会显示“已停止”。离开页面不会停止规划。
            </span>
          </div>
        </>
      )}
    </Modal>
  );
}
