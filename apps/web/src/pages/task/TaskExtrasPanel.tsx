import { useMemo, useState } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  type OperationReceipt,
  type PlanRevision,
  type SnapshotBatchState,
  type SnapshotPartialReport,
  type SnapshotReviewBatch,
  type SnapshotReviewModel,
  type TaskAuditEntry,
  type FrozenPlanSnapshot,
} from '@agent-workflow/shared';
import { Badge } from '../../components/Badge.tsx';
import { Button } from '../../components/Button.tsx';
import { EmptyState, SkeletonText } from '../../components/EmptyState.tsx';
import { Icon } from '../../components/Icon.tsx';
import { Modal } from '../../components/Modal.tsx';
import { ServiceNotice } from '../../components/ServiceNotice.tsx';
import { CommandErrorNotice, ReceiptNotice } from '../../flow/workflow-ui.tsx';
import { formatAbsoluteTime, formatDateTime } from '../../app/format.ts';
import { fetchSnapshotReview, fetchTaskAudit, fetchTaskFreezes, freezeTaskPlan } from './task-extras.ts';
import './task-extras.css';

export type TaskExtrasMode = 'freeze' | 'audit' | 'snapshot-review';

type BadgeTone = 'neutral' | 'run' | 'stall' | 'fail' | 'done' | 'ok' | 'wait' | 'idle' | 'danger' | 'unknown' | 'warn' | 'accent';

const MODE_TITLE: Readonly<Record<TaskExtrasMode, string>> = {
  freeze: '冻结计划',
  audit: '审计记录',
  'snapshot-review': '快照评审 · 只读',
};

const MODE_FOOTER: Readonly<Record<TaskExtrasMode, string>> = {
  freeze: '冻结只写入本机只读快照，不会改变计划、执行、工作区或交付。',
  audit: '审计记录来自持久化事件与操作台账，只读；不会改变执行。',
  'snapshot-review': '查看进度和报告不会启动、暂停或改变执行。',
};

const AUDIT_KINDS: readonly { readonly value: string; readonly label: string }[] = [
  { value: '', label: '全部类型' },
  { value: 'plan.', label: '计划' },
  { value: 'execution.', label: '执行' },
  { value: 'node.', label: '节点验收' },
  { value: 'task.plan.', label: '冻结计划' },
  { value: 'task.delivery.', label: '交付' },
  { value: 'workspace.', label: '工作区' },
  { value: 'task.recovery.', label: '恢复' },
  { value: 'task.', label: '任务事件' },
];

const BATCH_STATE: Readonly<Record<SnapshotBatchState, { readonly label: string; readonly tone: BadgeTone }>> = {
  verified: { label: '已验证', tone: 'done' },
  unverified: { label: '未验证', tone: 'warn' },
  running: { label: '执行中', tone: 'run' },
  attention: { label: '需处理', tone: 'fail' },
  pending: { label: '待执行', tone: 'idle' },
  skipped: { label: '已跳过', tone: 'neutral' },
};

function statusTone(status: string | undefined): BadgeTone {
  if (status === 'succeeded') return 'ok';
  if (status === 'failed') return 'fail';
  if (status === 'accepted') return 'wait';
  if (status === 'unknown') return 'unknown';
  return 'idle';
}

function shortSha(sha: string | undefined): string {
  return sha === undefined || sha.length === 0 ? '—' : sha.slice(0, 7);
}

function snapshotMeta(snapshot: FrozenPlanSnapshot): readonly { readonly label: string; readonly value: string }[] {
  return [
    { label: '冻结时间', value: formatAbsoluteTime(snapshot.frozenAt) },
    { label: '操作人（本地）', value: snapshot.actor },
    { label: '需求修订', value: `r${String(snapshot.requirementRevision)}` },
    { label: '流程', value: `${snapshot.methodId} · ${snapshot.methodRevision}` },
    ...(snapshot.template === undefined ? [] : [{ label: '模板', value: `${snapshot.template.name} · v${String(snapshot.template.version)}` }]),
    { label: '计划修订', value: `修订 ${String(snapshot.planRevisionNumber)} · ${snapshot.planStatus}` },
    { label: '计划哈希', value: shortSha(snapshot.planHash) },
  ];
}

/** One immutable frozen-plan snapshot (read-only). */
function FreezeSnapshotCard({ snapshot, current }: { readonly snapshot: FrozenPlanSnapshot; readonly current: boolean }) {
  return (
    <article className="card pad tx-freeze-card" aria-label={`冻结快照 修订 ${String(snapshot.planRevisionNumber)}`}>
      <div className="row wrap" style={{ gap: 6 }}>
        <Badge outline icon="lock">修订 {String(snapshot.planRevisionNumber)}</Badge>
        {current ? <Badge tone="done" icon="check">当前快照</Badge> : null}
        <span className="hint mono">{snapshot.snapshotId}</span>
      </div>
      <dl className="tx-kv">
        {snapshotMeta(snapshot).map((item) => (
          <div key={item.label} className="tx-kv-row">
            <dt>{item.label}</dt>
            <dd className={item.label === '计划哈希' ? 'mono' : undefined}>{item.value}</dd>
          </div>
        ))}
      </dl>
      {snapshot.note === undefined ? null : <p className="hint" style={{ marginTop: 8 }}>备注：{snapshot.note}</p>}
      <div className="row wrap" style={{ gap: 6, marginTop: 10 }}>
        <span className="chip">步骤 {String(snapshot.summary.nodes)}</span>
        <span className="chip">依赖 {String(snapshot.summary.edges)}</span>
        <span className="chip">分组 {String(snapshot.summary.groups)}</span>
        {snapshot.summary.groupLabels.slice(0, 4).map((label) => (
          <span key={label} className="chip">{label}</span>
        ))}
        {snapshot.summary.groupLabels.length > 4 ? <span className="hint">+{String(snapshot.summary.groupLabels.length - 4)} 组</span> : null}
      </div>
      {snapshot.executionAtFreeze === undefined ? null : (
        <p className="hint" style={{ marginTop: 8 }}>
          冻结时执行：{snapshot.executionAtFreeze.status} · {String(snapshot.executionAtFreeze.progress.done)} / {String(snapshot.executionAtFreeze.progress.total)} 完成 · {String(snapshot.executionAtFreeze.progress.running)} 执行中 · {String(snapshot.executionAtFreeze.progress.failed)} 失败
        </p>
      )}
    </article>
  );
}

function FreezePanel({ taskId, plan }: { readonly taskId: string; readonly plan?: PlanRevision }) {
  const queryClient = useQueryClient();
  const freezesQuery = useQuery({ queryKey: ['task-extras', 'freezes', taskId], queryFn: () => fetchTaskFreezes(taskId), retry: false });
  const [freezeOpen, setFreezeOpen] = useState(false);
  const [note, setNote] = useState('');
  const [receipt, setReceipt] = useState<OperationReceipt | undefined>(undefined);
  const [receiptMessage, setReceiptMessage] = useState<string | undefined>(undefined);

  const freeze = useMutation({
    mutationFn: () => freezeTaskPlan(taskId, { ...(plan === undefined ? {} : { planRevisionId: plan.id }), note }),
    onSuccess: async (response) => {
      setFreezeOpen(false);
      setNote('');
      setReceipt(response.receipt);
      if (response.receipt.status === 'succeeded') {
        setReceiptMessage(
          response.resource?.replayed === true
            ? '这个冻结点已经存在：服务返回原快照（replayed），没有产生重复记录。'
            : '已冻结当前计划：只读快照已保存，计划与执行均未改变。',
        );
        await queryClient.invalidateQueries({ queryKey: ['task-extras', 'freezes', taskId] });
      }
    },
    onError: () => {
      setReceipt(undefined);
      setReceiptMessage(undefined);
      setFreezeOpen(false);
    },
  });

  const freezes = freezesQuery.data?.items ?? [];
  const latest = freezesQuery.data?.latest ?? freezes[0];

  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="banner info" role="status">
        <Icon name="lock" />
        <div className="grow">
          <b>只读快照。</b>冻结会保存当前计划修订的不可变快照（本机记录），用于对照审查；不改变计划、执行、工作区或交付。
        </div>
      </div>

      <div className="row wrap" style={{ gap: 8 }}>
        <Button
          variant="primary"
          size="sm"
          icon="archive"
          disabled={plan === undefined || freeze.isPending}
          disabledReason={plan === undefined ? '当前没有可冻结的计划修订' : '正在写入冻结快照'}
          onClick={() => {
            setReceiptMessage(undefined);
            setFreezeOpen(true);
          }}
        >
          {freeze.isPending ? '正在冻结…' : '冻结当前计划'}
        </Button>
        <span className="hint grow">
          {plan === undefined ? '服务未返回当前计划，无法冻结。' : `当前计划：修订 ${String(plan.revisionNumber)} · ${plan.status}`}
        </span>
        <Button variant="ghost" size="sm" icon="refresh" disabled={freezesQuery.isFetching} onClick={() => { void freezesQuery.refetch(); }}>
          重新读取
        </Button>
      </div>

      <ReceiptNotice receipt={receipt} successMessage={receiptMessage} />
      <CommandErrorNotice error={freeze.error} title="冻结未完成" />

      {freezesQuery.isLoading ? <SkeletonText lines={5} /> : null}
      {freezesQuery.isError ? (
        <ServiceNotice error={freezesQuery.error} onRetry={() => { void freezesQuery.refetch(); }} />
      ) : null}
      {freezesQuery.data === undefined || freezesQuery.isError ? null : latest === undefined ? (
        <EmptyState compact icon="archive" title="还没有冻结快照" description="冻结当前计划后，这里会按时间倒序列出只读快照；冻结不会改变执行。" />
      ) : (
        <>
          <div className="sec-t">当前快照</div>
          <FreezeSnapshotCard snapshot={latest} current />
          {freezes.length <= 1 ? null : (
            <>
              <div className="sec-t" style={{ marginTop: 6 }}>最近快照 · {String(freezes.length)} 条</div>
              <div className="col" style={{ gap: 10 }}>
                {freezes.filter((item) => item.snapshotId !== latest.snapshotId).map((snapshot) => (
                  <FreezeSnapshotCard key={snapshot.snapshotId} snapshot={snapshot} current={false} />
                ))}
              </div>
            </>
          )}
        </>
      )}

      <Modal
        open={freezeOpen}
        title="冻结当前计划？"
        onClose={() => {
          if (!freeze.isPending) setFreezeOpen(false);
        }}
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => { setFreezeOpen(false); }} disabled={freeze.isPending} disabledReason="正在写入冻结快照">
              取消
            </Button>
            <span className="spacer" />
            <Button variant="primary" size="sm" icon="archive" disabled={freeze.isPending} disabledReason="正在写入冻结快照" onClick={() => { freeze.mutate(); }}>
              {freeze.isPending ? '正在冻结…' : '确认冻结'}
            </Button>
          </>
        }
      >
        <p>
          冻结当前计划修订{plan === undefined ? '' : `（修订 ${String(plan.revisionNumber)}）`}为一个只读快照。快照包含计划结构、版本绑定的摘要与冻结时的执行事实；
          <b>不会修改计划、执行、工作区或交付</b>。
        </p>
        <div className="field" style={{ marginTop: 12 }}>
          <label className="label" htmlFor="tx-freeze-note">备注（可选，最多 500 字）</label>
          <textarea
            id="tx-freeze-note"
            className="textarea"
            value={note}
            maxLength={500}
            disabled={freeze.isPending}
            placeholder="例如：交付前对照审查；说明冻结原因"
            onChange={(event) => { setNote(event.target.value); }}
          />
          <span className="hint">{note.length} / 500</span>
        </div>
        <p className="hint" style={{ marginTop: 8 }}>
          同一冻结点重复冻结不会产生重复快照；服务按 requestKey 与计划哈希去重。结果未知时只按原请求号核对，不会自动重发。
        </p>
      </Modal>
    </div>
  );
}

function AuditItem({ entry }: { readonly entry: TaskAuditEntry }) {
  const refs = [
    entry.refs.nodeId === undefined ? undefined : `步骤 ${entry.refs.nodeId}`,
    entry.refs.planRevisionId === undefined ? undefined : `计划 ${entry.refs.planRevisionId}`,
    entry.refs.executionId === undefined ? undefined : `执行 ${entry.refs.executionId}`,
    entry.refs.deliveryId === undefined ? undefined : `交付 ${entry.refs.deliveryId}`,
    entry.refs.workspaceId === undefined ? undefined : `工作区 ${entry.refs.workspaceId}`,
    entry.refs.roundId === undefined ? undefined : `规划轮次 ${entry.refs.roundId}`,
  ].filter((item): item is string => item !== undefined);
  return (
    <li className="tx-audit-item">
      <span className="tx-audit-time mono">{formatDateTime(entry.at)}</span>
      <div className="grow" style={{ minWidth: 0 }}>
        <div className="row wrap" style={{ gap: 6 }}>
          <span style={{ fontSize: 13.5 }}>{entry.summary}</span>
          {entry.status === undefined ? null : <Badge tone={statusTone(entry.status)}>{entry.status}</Badge>}
          <Badge outline>{entry.source === 'operation' ? '操作台账' : '事件'}</Badge>
        </div>
        <div className="hint mono tx-audit-action">
          {entry.action}
          {entry.requestKey === undefined ? '' : ` · ${entry.requestKey}`}
        </div>
        {refs.length === 0 ? null : <div className="hint">{refs.join(' · ')}</div>}
      </div>
    </li>
  );
}

function AuditPanel({ taskId }: { readonly taskId: string }) {
  const [kind, setKind] = useState('');
  const auditQuery = useInfiniteQuery({
    queryKey: ['task-extras', 'audit', taskId, kind],
    queryFn: ({ pageParam }) => fetchTaskAudit(taskId, { limit: 30, ...(kind.length === 0 ? {} : { kinds: [kind] }), ...(pageParam === undefined ? {} : { cursor: pageParam }) }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    retry: false,
  });
  const items = useMemo(() => {
    const seen = new Set<string>();
    const result: TaskAuditEntry[] = [];
    for (const page of auditQuery.data?.pages ?? []) {
      for (const item of page.items) {
        if (seen.has(item.id)) continue;
        seen.add(item.id);
        result.push(item);
      }
    }
    return result;
  }, [auditQuery.data?.pages]);
  const total = auditQuery.data?.pages[0]?.total;

  return (
    <div className="col" style={{ gap: 12 }}>
      <div className="banner info" role="status">
        <Icon name="lock" />
        <div className="grow">只读时间线：来自持久化事件与操作台账（去重、最新在前）；不会重发命令或改变执行。</div>
      </div>
      <div className="row wrap" style={{ gap: 8 }}>
        <select className="select" style={{ width: 'auto', height: 32 }} value={kind} aria-label="审计记录类型筛选" onChange={(event) => { setKind(event.target.value); }}>
          {AUDIT_KINDS.map((option) => (
            <option key={option.value.length === 0 ? 'all' : option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
        <span className="spacer" />
        <span className="hint num">{total === undefined ? '—' : `${String(items.length)} / ${String(total)} 条`}</span>
        <Button variant="ghost" size="sm" icon="refresh" disabled={auditQuery.isFetching} onClick={() => { void auditQuery.refetch(); }}>
          重新读取
        </Button>
      </div>

      {auditQuery.isLoading ? <SkeletonText lines={8} /> : null}
      {auditQuery.isError ? (
        <ServiceNotice error={auditQuery.error} onRetry={() => { void auditQuery.refetch(); }} />
      ) : null}
      {auditQuery.data === undefined || auditQuery.isError ? null : items.length === 0 ? (
        <EmptyState compact icon="clock" title="这个筛选下没有审计记录" description="服务返回空列表；审计记录只显示已持久化的事件，不补造历史。" />
      ) : (
        <ol className="tx-audit-list">
          {items.map((entry) => <AuditItem key={entry.id} entry={entry} />)}
        </ol>
      )}
      {auditQuery.hasNextPage ? (
        <Button
          variant="secondary"
          size="sm"
          icon="chevDown"
          disabled={auditQuery.isFetchingNextPage}
          disabledReason={auditQuery.isFetchingNextPage ? '正在加载下一页' : undefined}
          onClick={() => { void auditQuery.fetchNextPage(); }}
        >
          {auditQuery.isFetchingNextPage ? '加载中…' : '加载更多'}
        </Button>
      ) : null}
    </div>
  );
}

function ProgressMetrics({ review }: { readonly review: SnapshotReviewModel }) {
  const progress = review.progress;
  if (progress === undefined) return <p className="hint">服务未返回执行进度。</p>;
  if (!progress.available) return <p className="hint">服务暂未提供执行进度；不会伪造批次统计或审查结论。</p>;
  const metrics: readonly { readonly label: string; readonly value: number | null; readonly warn?: boolean }[] = [
    { label: '已验证审查批次', value: progress.verifiedBatches },
    { label: '未验证', value: progress.unverifiedBatches },
    { label: '执行中', value: progress.runningBatches },
    { label: '剩余批次', value: progress.remainingBatches },
  ];
  return (
    <div>
      <div className={`tx-metrics${progress.totalBatches === null ? ' tx-metrics-three' : ''}`}>
        {metrics.map((metric) => (
          <div key={metric.label} className="tx-metric">
            <div className={`v num${metric.warn === true ? ' warn' : ''}`}>{metric.value === null ? '待定' : String(metric.value)}</div>
            <div className="k">{metric.label}</div>
          </div>
        ))}
      </div>
      {progress.totalBatches === null ? <p className="hint" style={{ marginTop: 8 }}>批次总数在审查计划确认后确定。</p> : null}
      {progress.attentionBatches > 0 ? (
        <div className="row wrap" style={{ gap: 6, marginTop: 8 }}>
          <Badge tone="fail" icon="alert">需处理 {String(progress.attentionBatches)}</Badge>
          <span className="hint">需处理批次不会因为“已完成”而消失；请查看功能批次中的错误。</span>
        </div>
      ) : null}
      {progress.skippedBatches > 0 ? <p className="hint" style={{ marginTop: 6 }}>已跳过 {String(progress.skippedBatches)} 个批次。</p> : null}
    </div>
  );
}

function ScopeCard({ review }: { readonly review: SnapshotReviewModel }) {
  const scope = review.scope;
  if (scope === undefined) return <p className="hint">服务未返回审查范围。</p>;
  return (
    <div className="tx-scope">
      <div className="row wrap" style={{ gap: 6 }}>
        <Badge outline icon="search">
          审查方式：{scope.mode === 'unknown' ? '服务未提供' : scope.mode === 'full' ? '全面审查' : '日期增量审查'}
        </Badge>
        <Badge outline icon="layers">
          审查深度：{scope.depth === 'unknown' ? '服务未提供' : scope.depth === 'full' ? '全量审查' : '轻量审查'}
        </Badge>
      </div>
      <dl className="tx-kv" style={{ marginTop: 10 }}>
        {scope.template === undefined ? null : (
          <div className="tx-kv-row"><dt>模板</dt><dd>{scope.template.name} · v{String(scope.template.version)}</dd></div>
        )}
        <div className="tx-kv-row"><dt>计划</dt><dd>{scope.planRevisionNumber === undefined ? '服务未提供' : `修订 ${String(scope.planRevisionNumber)} · ${scope.planStatus ?? '状态未提供'}`}</dd></div>
        <div className="tx-kv-row"><dt>基线</dt><dd className="mono" title={scope.baselineSha ?? ''}>{scope.baselineSha === undefined ? '无（全面审查不设基线）' : shortSha(scope.baselineSha)}</dd></div>
        <div className="tx-kv-row"><dt>目标</dt><dd className="mono" title={scope.targetSha ?? ''}>{scope.targetSha === undefined ? '服务未提供' : shortSha(scope.targetSha)}</dd></div>
        <div className="tx-kv-row"><dt>分支</dt><dd className="mono">{scope.branch ?? '服务未提供'}</dd></div>
      </dl>
      <p className="hint" style={{ marginTop: 8 }}><Icon name="lock" size="sm" /> 源码版本在开始时固定；执行中不随仓库变化。</p>
      {scope.limitations.length === 0 ? null : (
        <ul className="list-plain" style={{ marginTop: 6 }}>
          {scope.limitations.map((item) => <li key={item}>{item}</li>)}
        </ul>
      )}
    </div>
  );
}

function BatchList({ batches, total, totalUnavailable, hasNextPage, isFetchingNextPage, onLoadMore }: {
  readonly batches: readonly SnapshotReviewBatch[];
  readonly total: number | undefined;
  readonly totalUnavailable: boolean;
  readonly hasNextPage: boolean;
  readonly isFetchingNextPage: boolean;
  readonly onLoadMore: () => void;
}) {
  return (
    <>
      <div className="row wrap" style={{ gap: 8, marginBottom: 8 }}>
        <span className="hint grow">
          {total === undefined ? '服务未返回功能批次。' : `已显示 ${String(batches.length)} / ${String(total)} 个批次`}
        </span>
        <Button
          variant="secondary"
          size="sm"
          icon="chevDown"
          disabled={!hasNextPage || isFetchingNextPage}
          disabledReason={!hasNextPage ? '没有更多批次' : '正在加载更多批次'}
          onClick={onLoadMore}
        >
          {isFetchingNextPage ? '加载中…' : '加载更多'}
        </Button>
      </div>
      {batches.length === 0 ? (
        <p className="hint">尚未创建功能批次{totalUnavailable ? '；审查计划确认后，会按功能拆分批次并显示在这里' : '。'}。</p>
      ) : (
        <div className="box">
          {batches.map((batch) => (
            <div key={batch.batchId} className="tx-batch">
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="t">{batch.title}</div>
                <div className="s">{batch.purpose}{batch.groupLabel === undefined ? '' : ` · ${batch.groupLabel}`}</div>
                {batch.errorMessage === undefined ? null : (
                  <div className="tx-batch-error">
                    <Icon name="alert" size="sm" />
                    <span>{batch.errorMessage}</span>
                  </div>
                )}
                {batch.updatedAt === undefined ? null : <div className="hint">更新 {formatDateTime(batch.updatedAt)}</div>}
              </div>
              <Badge tone={BATCH_STATE[batch.state].tone} icon={batch.state === 'verified' ? 'check' : batch.state === 'attention' ? 'alert' : batch.state === 'running' ? 'play' : 'clock'}>
                {BATCH_STATE[batch.state].label}
              </Badge>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function SnapshotReviewPanel({ taskId }: { readonly taskId: string }) {
  const [tab, setTab] = useState<'progress' | 'reports'>('progress');
  const [batchesOpen, setBatchesOpen] = useState(true);
  const reviewQuery = useInfiniteQuery({
    queryKey: ['task-extras', 'snapshot-review', taskId],
    queryFn: ({ pageParam }) => fetchSnapshotReview(taskId, { limit: 10, ...(pageParam === undefined ? {} : { cursor: pageParam }) }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.batches?.nextCursor,
    retry: false,
  });
  const review = reviewQuery.data?.pages[0];
  const batches = useMemo(() => {
    const seen = new Set<string>();
    const result: SnapshotReviewBatch[] = [];
    for (const page of reviewQuery.data?.pages ?? []) {
      for (const batch of page.batches?.items ?? []) {
        if (seen.has(batch.batchId)) continue;
        seen.add(batch.batchId);
        result.push(batch);
      }
    }
    return result;
  }, [reviewQuery.data?.pages]);
  const totalUnavailable = review?.progress === undefined || review.progress.totalBatches === null;

  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="tabs" role="tablist" aria-label="快照评审页签">
        {([['progress', '执行进度'], ['reports', '模板报告']] as const).map(([id, label]) => (
          <button key={id} type="button" role="tab" className="tab" aria-selected={tab === id} onClick={() => { setTab(id); }}>
            {label}
          </button>
        ))}
      </div>

      {reviewQuery.isLoading ? <SkeletonText lines={8} /> : null}
      {reviewQuery.isError ? <ServiceNotice error={reviewQuery.error} onRetry={() => { void reviewQuery.refetch(); }} /> : null}
      {review === undefined ? null : !review.applicable ? (
        <>
          <EmptyState icon="lock" title="快照评审仅适用于固定模板任务" description={review.reason ?? '服务标记这个任务不适用快照评审面板；不会伪造审查结论。'} />
          <p className="hint">{review.note}</p>
        </>
      ) : reviewQuery.data === undefined ? null : tab === 'progress' ? (
        <>
          <div className="row wrap" style={{ gap: 6 }}>
            <Badge outline icon="lock">只读</Badge>
            <span className="hint">{review.note}</span>
          </div>
          <div className="sec-t">执行进度</div>
          <ProgressMetrics review={review} />
          {review.progress === undefined ? null : (
            <div className="sec-t" style={{ marginTop: 4 }}>阶段</div>
          )}
          {review.progress === undefined ? null : (
            <div className="col" style={{ gap: 8 }}>
              {review.progress.phases.length === 0 ? <p className="hint">服务未返回阶段。</p> : review.progress.phases.map((phase) => (
                <div key={phase.label} className="tx-phase">
                  <span className="tx-phase-label">{phase.label}</span>
                  <div className="tx-meter" aria-hidden="true">
                    {phase.total === null || phase.total === 0 ? null : <i style={{ width: `${String(Math.round((phase.completed / phase.total) * 100))}%` }} />}
                  </div>
                  <span className="hint num">{phase.total === null ? `${String(phase.completed)} / 待定` : `${String(phase.completed)} / ${String(phase.total)}`}</span>
                </div>
              ))}
            </div>
          )}
          <div className="tx-note" role="note">
            <Icon name="info" size="sm" />
            <span>{review.progress?.note ?? '进度不等于完成。批次全部验证后，还要汇总报告并通过校验；最终状态以执行服务为准。'}</span>
          </div>
          <div className="sec-t" style={{ marginTop: 4 }}>审查范围</div>
          <ScopeCard review={review} />
          <button
            type="button"
            className="tx-toggle"
            aria-expanded={batchesOpen}
            onClick={() => { setBatchesOpen(!batchesOpen); }}
          >
            <Icon name="chevRight" size="sm" className={batchesOpen ? 'tx-chev-open' : undefined} />
            <span className="grow">功能批次</span>
            <span className="hint num">{review.batches === undefined ? '—' : `${String(review.batches.total)} 个`}</span>
          </button>
          {batchesOpen ? (
            <BatchList
              batches={batches}
              total={review.batches?.total}
              totalUnavailable={totalUnavailable}
              hasNextPage={reviewQuery.hasNextPage}
              isFetchingNextPage={reviewQuery.isFetchingNextPage}
              onLoadMore={() => { void reviewQuery.fetchNextPage(); }}
            />
          ) : null}
        </>
      ) : (
        <>
          <div className="banner info" role="status">
            <Icon name="eye" />
            <div className="grow">
              <b>阶段报告只读。</b>已分析 / 未完成 / 排除范围分别标注；查看或下载都不会启动、暂停或改变执行。
            </div>
          </div>
          <PartialReport report={review.partialReport} />
        </>
      )}
    </div>
  );
}

function PartialReport({ report }: { readonly report: SnapshotPartialReport }) {
  const analyzed = report.analyzedUnits ?? 0;
  const pending = report.pendingUnits ?? 0;
  const excluded = report.excludedUnits ?? 0;
  const total = analyzed + pending + excluded;
  return (
    <div className="col" style={{ gap: 12 }}>
      <div className="row wrap" style={{ gap: 8 }}>
        <Button variant="secondary" size="sm" icon="eye" disabled disabledReason={report.reason}>
          读取阶段报告
        </Button>
        <Button
          variant="primary"
          size="sm"
          icon="download"
          disabled={report.download.available !== true}
          disabledReason={report.download.available ? '前端尚未接入阶段报告下载接口' : report.download.reason}
        >
          下载 Markdown
        </Button>
        <span className="hint grow">{report.download.available ? '服务字段允许下载，但前端尚无导出端点。' : report.download.reason}</span>
      </div>

      {report.available ? (
        <>
          <div className="tx-report-bar" role="img" aria-label={`已分析 ${String(analyzed)}，未完成 ${String(pending)}，排除 ${String(excluded)}`}>
            <i className="analyzed" style={{ flex: Math.max(analyzed, 0) + 1 }} />
            <i className="pending" style={{ flex: Math.max(pending, 0) + 1 }} />
            <i className="excluded" style={{ flex: Math.max(excluded, 0) + 1 }} />
          </div>
          <div className="row wrap" style={{ gap: 14 }}>
            <span className="hint"><span className="tx-dot analyzed" /> 已分析 <b className="num">{report.analyzedUnits === null ? '—' : String(report.analyzedUnits)}</b></span>
            <span className="hint"><span className="tx-dot pending" /> 未完成 <b className="num">{report.pendingUnits === null ? '—' : String(report.pendingUnits)}</b></span>
            <span className="hint"><span className="tx-dot excluded" /> 排除 <b className="num">{report.excludedUnits === null ? '—' : String(report.excludedUnits)}</b></span>
            <span className="hint">按分析单元计，共 {String(total)} 个{report.readAt === undefined ? '' : ` · 读取于 ${formatDateTime(report.readAt)}`}</span>
          </div>
          {report.contentMarkdown === null ? <p className="hint">服务未返回阶段报告正文。</p> : <pre className="tx-report-doc">{report.contentMarkdown}</pre>}
        </>
      ) : (
        <EmptyState compact icon="doc" title="还没有可读取的阶段报告" description={report.reason} />
      )}
      <p className="hint">{report.note}</p>
    </div>
  );
}

/** Right-side panel for the task canvas "⋯" extras (freeze / audit / B-07). */
export function TaskExtrasPanel({ taskId, mode, plan, onClose }: {
  readonly taskId: string;
  readonly mode: TaskExtrasMode;
  readonly plan?: PlanRevision;
  readonly onClose: () => void;
}) {
  return (
    <aside className="side task-side task-extras-side" aria-label={MODE_TITLE[mode]}>
      <div className="side-head task-side-head">
        <div className="row" style={{ gap: 8 }}>
          <h2 className="grow">{MODE_TITLE[mode]}</h2>
          <Badge outline icon="lock">{mode === 'freeze' ? '只读快照' : '只读'}</Badge>
          <Button size="sm" variant="ghost" icon="x" onClick={onClose}>
            关闭
          </Button>
        </div>
      </div>
      <div className="side-body task-side-body">
        {mode === 'freeze' ? <FreezePanel taskId={taskId} plan={plan} /> : mode === 'audit' ? <AuditPanel taskId={taskId} /> : <SnapshotReviewPanel taskId={taskId} />}
      </div>
      <div className="side-foot">
        <span className="hint grow">{MODE_FOOTER[mode]}</span>
      </div>
    </aside>
  );
}
