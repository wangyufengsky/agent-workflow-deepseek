import { QualityReviewResult } from './QualityReviewResult.tsx';
import { useQueryClient } from '@tanstack/react-query';
import { toolFeed } from './tool-feed.ts';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  NODE_STATUS_LABEL,
  ROUTES,
  createRequestKey,
  type Attempt,
  type CommandResponse,
  type ExecutionView,
  type NodeAcceptRequest,
  type NodeAcceptanceView,
  type NodeDetail,
  type NodeDetailResponse,
  type NodeRejectRequest,
  type NodeResponse,
  type OutputFragment,
  type PlanRevision,
} from '@agent-workflow/shared';
import { apiPost } from '../../api/client.ts';
import { Badge } from '../../components/Badge.tsx';
import { Button } from '../../components/Button.tsx';
import { Icon } from '../../components/Icon.tsx';
import { IconButton } from '../../components/IconButton.tsx';
import { EmptyState, SkeletonText } from '../../components/EmptyState.tsx';
import { Modal } from '../../components/Modal.tsx';
import { ServiceNotice } from '../../components/ServiceNotice.tsx';
import {
  advanceExecution,
  useNodeAttempts,
  useNodeDetail,
  useNodeOutput,
  useWorkflowCommand,
  type PollInterval,
  type WorkflowStreamConnection,
} from '../../api/workflow.ts';
import { NODE_KIND_LABEL } from '../../flow/types.ts';
import { ActionReasonLine, CommandErrorNotice, FactPill, FactsBar, ReceiptNotice, ServiceActionButton } from '../../flow/workflow-ui.tsx';
import { formatAbsoluteTime, formatDateTime } from '../../app/format.ts';
import { advanceTargets, nodeTitle, successorReason } from '../task/advance.ts';
import { ArtifactDetailView, CitationSourceView, ToolDetailView, type NodeReaderState, type RequirementLink } from './NodeSubviews.tsx';
import './node.css';

type NodeTab = 'overview' | 'session' | 'attempts';

const EDGE_KIND_LABEL: Record<'data' | 'order' | 'resource', string> = { data: '数据依赖', order: '顺序依赖', resource: '资源依赖' };

function nodeStatusText(status: string): string {
  return NODE_STATUS_LABEL[status as keyof typeof NODE_STATUS_LABEL] ?? status;
}

const RESULT_STATE_LABEL: Record<string, { label: string; tone: 'ok' | 'fail' | 'idle' | 'run' }> = {
  passed: { label: '校验通过', tone: 'ok' },
  failed: { label: '校验未通过', tone: 'fail' },
  not_configured: { label: '未配置校验', tone: 'idle' },
  error: { label: '校验出错', tone: 'fail' },
};

const ACCEPTANCE_LABEL: Readonly<Record<NodeAcceptanceView['state'], string>> = {
  pending: '待人工验收',
  accepted: '已验收通过',
  rejected: '已退回修改',
};

function acceptanceTone(state: NodeAcceptanceView['state']): 'wait' | 'ok' | 'fail' {
  return state === 'accepted' ? 'ok' : state === 'rejected' ? 'fail' : 'wait';
}

function fragmentTag(category: OutputFragment['category']): { label: string; className: string } {
  switch (category) {
    case 'model_text':
      return { label: '模型陈述', className: 'claim' };
    case 'public_reasoning_summary':
      return { label: '公开推理摘要 · 模型陈述', className: 'claim' };
    case 'tool_activity':
      return { label: '工具活动 · 外部资料', className: 'ext' };
    default:
      return { label: '服务事实', className: 'fact' };
  }
}

async function submitNodeVerdict(taskId: string, nodeId: string, kind: 'accept' | 'reject', note: string): Promise<CommandResponse<NodeResponse>> {
  if (kind === 'accept') {
    const body: NodeAcceptRequest = {
      requestKey: createRequestKey(),
      confirmAccept: true,
      ...(note.length === 0 ? {} : { note }),
    };
    return (await apiPost<CommandResponse<NodeResponse>>(ROUTES.nodeAccept(taskId, nodeId), body)).data;
  }
  const body: NodeRejectRequest = { requestKey: createRequestKey(), confirmReject: true, note };
  return (await apiPost<CommandResponse<NodeResponse>>(ROUTES.nodeReject(taskId, nodeId), body)).data;
}

export interface NodeDetailPanelProps {
  readonly taskId: string;
  readonly nodeId: string;
  readonly connection: WorkflowStreamConnection;
  readonly pollInterval: PollInterval;
  /** Authoritative plan/execution of the current task (W3-5a manual advance). */
  readonly plan?: PlanRevision;
  readonly execution?: ExecutionView;
  /** W0-4c: opened from the "去验收" situation action, so land on the acceptance area. */
  readonly focusAcceptance?: boolean;
  /** Changes on every "去验收" click so a repeat click re-focuses even on the same node. */
  readonly focusAcceptanceToken?: string;
  readonly onClose: () => void;
  readonly onOpenPlan?: () => void;
}

/**
 * 节点执行现场：事实条、公开正文/工具卡、尝试列表与只读历史。
 * Missing model text is stated as a runtime fact — never filled with fake prose.
 */
export function NodeDetailPanel({ taskId, nodeId, connection, pollInterval, plan, execution, focusAcceptance = false, focusAcceptanceToken, onClose, onOpenPlan }: NodeDetailPanelProps) {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<NodeTab>('session');
  const [selectedAttemptId, setSelectedAttemptId] = useState<string | undefined>(undefined);
  const [actionSuccess, setActionSuccess] = useState<string | undefined>(undefined);
  const [pendingAction, setPendingAction] = useState<'advance' | 'accept' | 'reject' | null>(null);
  const [verdict, setVerdict] = useState<'accept' | 'reject' | null>(null);
  const [verdictNote, setVerdictNote] = useState('');
  const [verdictError, setVerdictError] = useState<string | undefined>(undefined);
  const [reader, setReader] = useState<NodeReaderState | null>(null);
  const [wide, setWide] = useState(false);
  const detailQuery = useNodeDetail(taskId, nodeId, selectedAttemptId, pollInterval === false ? 2_000 : Math.min(pollInterval, 2_000));
  const attemptsQuery = useNodeAttempts(taskId, nodeId);
  const command = useWorkflowCommand(taskId);
  const selectedAttemptIdResolved = selectedAttemptId ?? detailQuery.data?.currentAttempt?.id;

  useEffect(() => {
    setTab(focusAcceptance ? 'overview' : 'session');
    setSelectedAttemptId(undefined);
    setActionSuccess(undefined);
    setVerdict(null);
    setPendingAction(null);
    setReader(null);
    setWide(false);
  }, [focusAcceptance, focusAcceptanceToken, taskId, nodeId]);

  useEffect(() => {
    if (verdict !== null) return;
    if (reader === null && !wide) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (reader !== null) setReader(null);
      else setWide(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [reader, verdict, wide]);

  const detail = detailQuery.error || (detailQuery.isFetching && !detailQuery.isFetchedAfterMount) || detailQuery.data?.taskId !== taskId || detailQuery.data?.nodeId !== nodeId ? undefined : detailQuery.data as NodeDetailResponse | undefined;
  const currentAttempt = detail?.currentAttempt;
  const attemptRows =
    attemptsQuery.data?.attempts ??
    (detail?.attempts ?? []).map((attempt) => ({
      attemptId: attempt.id,
      ordinal: attempt.ordinal,
      status: attempt.status,
      isCurrent: attempt.id === currentAttempt?.id,
      startedAt: attempt.startedAt,
      endedAt: attempt.endedAt,
      reasonSummary: attempt.result?.summary,
    }));
  const attempts = attemptRows.map((row) => detail?.attempts.find((attempt) => attempt.id === row.attemptId)?.readability.result === 'forbidden' ? { ...row, reasonSummary: undefined } : row);
  const isHistoricalAttempt = selectedAttemptIdResolved !== undefined && selectedAttemptIdResolved !== currentAttempt?.id;
  const selectedAttempt: Attempt | undefined = useMemo(() => {
    if (detail === undefined) return undefined;
    if (selectedAttemptIdResolved === undefined) return undefined;
    const attempt = detail.attempts.find((attempt) => attempt.id === selectedAttemptIdResolved) ?? (currentAttempt?.id === selectedAttemptIdResolved ? currentAttempt : undefined);
    return attempt?.readability.result === 'forbidden' ? { ...attempt, result: undefined } : attempt;
  }, [currentAttempt, detail, selectedAttemptIdResolved]);
  const outputQuery = useNodeOutput(taskId, nodeId, selectedAttempt?.readability.output === 'forbidden' ? undefined : selectedAttemptIdResolved, isHistoricalAttempt ? false : pollInterval);
  useEffect(() => {
    for (const attempt of detail?.attempts ?? []) {
      const revoked = (key: readonly unknown[]) => (key[0] === 'artifact' && key[1] === taskId && key[2] === attempt.id && attempt.readability.result === 'forbidden')
        || (key[0] === 'workflow' && key[1] === taskId && key[2] === 'node' && key[3] === nodeId && key[4] === 'output' && key[5] === attempt.id && attempt.readability.output === 'forbidden')
        || (key[0] === 'node-tool' && key[1] === taskId && key[2] === nodeId && key[3] === attempt.id && (attempt.readability.tools === 'forbidden' || attempt.readability.output === 'forbidden'));
      void queryClient.cancelQueries({ predicate: (query) => revoked(query.queryKey) }).then(() => { queryClient.removeQueries({ predicate: (query) => revoked(query.queryKey) }); });
    }
  }, [detail, taskId, nodeId, queryClient]);
  const fragments = outputQuery.error || detailQuery.error || selectedAttempt?.readability.output === 'forbidden' ? [] : outputQuery.data?.fragments ?? (selectedAttemptIdResolved === currentAttempt?.id ? detail?.output.fragments : undefined) ?? [];
  const visibleFragments = selectedAttempt?.readability.tools === 'forbidden' ? fragments.filter((fragment) => fragment.category !== 'tool_activity' && fragment.toolEvidence === undefined) : fragments;
  const feed = toolFeed(visibleFragments);
  const attemptLabel =
    selectedAttempt === undefined
      ? '尝试记录：服务未提供'
      : `${isHistoricalAttempt ? '历史' : '当前'}尝试 #${String(selectedAttempt.ordinal)}`;
  /**
   * The output read model neither promises contiguous seq nor a retention window.
   * Surface gaps instead of pretending the feed is complete.
   */
  const seqGaps = useMemo(() => {
    const seqs = fragments.map((fragment) => fragment.seq).sort((left, right) => left - right);
    const gaps: { readonly from: number; readonly to: number }[] = [];
    const first = seqs[0];
    if (first !== undefined && first > 1) gaps.push({ from: 1, to: first - 1 });
    for (let index = 1; index < seqs.length; index += 1) {
      const previous = seqs[index - 1];
      const current = seqs[index];
      if (previous === undefined || current === undefined) continue;
      if (current > previous + 1) gaps.push({ from: previous + 1, to: current - 1 });
    }
    return gaps;
  }, [fragments]);
  const gapText = seqGaps
    .map((gap) => (gap.from === gap.to ? `#${String(gap.from)}` : `#${String(gap.from)}–#${String(gap.to)}`))
    .join('、');

  const capability = detail?.output.capabilities;
  const hasModelText = fragments.some((fragment) => fragment.category === 'model_text');
  const terminal = outputQuery.data?.terminal ?? detail?.output.terminal ?? false;
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [following, setFollowing] = useState(true);
  const savedFeedPosition = useRef<{ scope: string; top: number } | undefined>(undefined);
  const openReader = (next: NodeReaderState) => {
    savedFeedPosition.current = { scope: `${taskId}:${nodeId}`, top: scrollerRef.current?.scrollTop ?? 0 };
    setFollowing(false);
    setReader(next);
  };
  useEffect(() => {
    const saved = savedFeedPosition.current;
    if (reader !== null || saved === undefined) return;
    savedFeedPosition.current = undefined;
    if (saved.scope !== `${taskId}:${nodeId}`) return;
    if (scrollerRef.current !== null) scrollerRef.current.scrollTop = saved.top;
  }, [reader, taskId, nodeId]);

  /**
   * W3-5a: while auto advance is off, an accepted step can release its direct
   * successors. Counts/reasons mirror the engine join rule; the service stays
   * authoritative and errors are shown verbatim.
   */
  const manualAdvance = useMemo(() => {
    if (plan === undefined || execution === undefined || execution.autoAdvance !== false) return undefined;
    if (detail?.execution?.status !== 'succeeded') return undefined;
    const targets = advanceTargets(plan, execution, nodeId);
    const successorIds = [...new Set(plan.graph.edges.filter((edge) => edge.from === nodeId).map((edge) => edge.to))];
    const rows = successorIds.map((id) => {
      const nodeStatus = execution.nodes.find((node) => node.nodeId === id)?.status;
      const blockers = plan.graph.edges
        .filter((edge) => edge.to === id)
        .filter((edge) => {
          const source = execution.nodes.find((node) => node.nodeId === edge.from)?.status;
          return source !== 'succeeded' && source !== 'skipped';
        })
        .map((edge) => nodeTitle(plan, edge.from));
      return { id, title: nodeTitle(plan, id), status: nodeStatus, blockers };
    });
    const reason = successorIds.length === 0
      ? '这一步没有直接后继步骤。'
      : successorReason(plan, execution, targets, command.state.busy);
    return { targets, rows, reason };
  }, [command.state.busy, detail?.execution?.status, execution, nodeId, plan]);

  const runAdvanceSuccessors = () => {
    if (manualAdvance === undefined) return;
    setActionSuccess(undefined);
    setPendingAction('advance');
    void command.run(() => advanceExecution(taskId, nodeId)).then((response) => {
      setPendingAction(null);
      if (response?.receipt.status !== 'succeeded') return;
      const released = response.receipt.outcome?.released;
      const count = Array.isArray(released) ? released.length : 0;
      setActionSuccess(count > 0 ? `已放行这一步的直接后继 ${String(count)} 步（回执 succeeded）。` : '推进已受理；本次没有放行新的步骤（回执 succeeded）。');
    });
  };

  const openVerdict = (kind: 'accept' | 'reject') => {
    setVerdict(kind);
    setVerdictNote('');
    setVerdictError(undefined);
    setActionSuccess(undefined);
  };

  const submitVerdict = () => {
    if (verdict === null || command.state.busy) return;
    const trimmed = verdictNote.trim();
    if (verdict === 'reject' && trimmed.length === 0) {
      setVerdictError('退回修改必须填写原因（去空格后 1–2000 字）。');
      return;
    }
    if (trimmed.length > 2000) {
      setVerdictError('备注最多 2000 字。');
      return;
    }
    const kind = verdict;
    setVerdictError(undefined);
    setActionSuccess(undefined);
    setPendingAction(kind);
    void command.run(() => submitNodeVerdict(taskId, nodeId, kind, trimmed)).then((response) => {
      setPendingAction(null);
      setVerdict(null);
      if (response?.receipt.status !== 'succeeded') return;
      const saved = response.resource?.node.acceptance;
      const label = kind === 'accept' ? '验收通过' : '退回修改';
      setActionSuccess(
        saved === undefined
          ? `${label}已记录（回执 succeeded）。`
          : `${label}已记录：${ACCEPTANCE_LABEL[saved.state]}${saved.note === undefined ? '' : ` · 备注：${saved.note}`}（回执 succeeded）。`,
      );
    });
  };

  useEffect(() => {
    if (!following) return;
    const element = scrollerRef.current;
    if (element !== null) element.scrollTop = element.scrollHeight;
  }, [following, fragments.length]);

  if (detailQuery.isError) {
    return (
      <aside className="side node-side" aria-label="节点执行现场">
        <div className="side-head">
          <h2 className="grow">节点执行现场</h2>
          <IconButton icon="x" label="关闭节点面板" onClick={onClose} />
        </div>
        <div className="side-body">
          <ServiceNotice
            error={detailQuery.error}
            onRetry={() => {
              void detailQuery.refetch();
            }}
          />
        </div>
      </aside>
    );
  }

  if (detailQuery.isLoading || detail === undefined) {
    return (
      <aside className="side node-side" aria-label="节点执行现场">
        <div className="side-head">
          <h2 className="grow">节点执行现场</h2>
          <IconButton icon="x" label="关闭节点面板" onClick={onClose} />
        </div>
        <div className="side-body">
          <SkeletonText lines={8} />
        </div>
      </aside>
    );
  }

  const acceptance = detail.acceptance;
  const acceptAction = detail.actions.accept;
  const rejectAction = detail.actions.reject;
  const asideClass = ['side', 'node-side', wide || reader !== null ? 'node-side-wide' : ''].filter(Boolean).join(' ');

  const readerAttempt = reader?.kind === 'artifact' ? detail.attempts.find((attempt) => attempt.id === reader.artifact.sourceAttemptId) : reader?.kind === 'tool' ? detail.attempts.find((attempt) => attempt.id === reader.attemptId) : undefined;
  const readerForbidden = reader?.kind === 'artifact' ? readerAttempt === undefined || readerAttempt.readability.result === 'forbidden' : reader?.kind === 'tool' ? readerAttempt === undefined || readerAttempt.readability.tools === 'forbidden' || readerAttempt.readability.output === 'forbidden' : false;
  if (reader !== null && readerForbidden) return <aside className={asideClass} aria-label="节点内容无权限"><div className="side-head"><Icon name="lock" /><h2 className="grow">无权查看这次尝试内容</h2><Button onClick={() => setReader(null)}>返回节点</Button></div><p>读取权限已变化，已隐藏之前加载的内容。</p></aside>;
  if (reader !== null) {
    const readerTitle = reader.kind === 'tool' ? '工具详情' : reader.kind === 'artifact' ? '产物详情' : '引用原文';
    return (
      <aside className={asideClass} aria-label={`${readerTitle}（宽阅读区）`}>
        <div className="side-head node-side-head">
          <div className="node-head-row">
            <div className="grow">
              <div className="node-head-eyebrow">
                <Badge outline>宽阅读区 · 900</Badge>
                <span className="hint">{detail.definitionUnavailableReason === undefined ? detail.node.title : '步骤定义未保留'}</span>
              </div>
              <h2 className="node-head-title">{readerTitle}</h2>
            </div>
            <Button size="sm" variant="ghost" icon="chevLeft" onClick={() => { setReader(null); }}>
              返回节点
            </Button>
            <IconButton icon="x" label="关闭节点面板" onClick={onClose} />
          </div>
        </div>
        <div className="side-body node-side-body">
          {reader.kind === 'tool' ? (
            <ToolDetailView key={`${reader.attemptId}:${reader.fragment.toolCallRef?.callId}`} taskId={taskId} nodeId={nodeId} attemptId={reader.attemptId} fragment={reader.fragment} attemptLabel={reader.attemptLabel} />
          ) : reader.kind === 'artifact' ? (
            <ArtifactDetailView key={`${taskId}:${reader.artifact.id}:${reader.artifact.revision}`} taskId={taskId} artifact={reader.artifact} attemptLabel={reader.attemptLabel} />
          ) : (
            <CitationSourceView taskId={taskId} nodeId={nodeId} link={reader.link} />
          )}
        </div>
      </aside>
    );
  }

  return (
    <aside className={asideClass} aria-label="节点执行现场">
      <div className="side-head node-side-head">
        <div className="node-head-row">
          <div className="grow">
            <div className="node-head-eyebrow">
              {detail.definitionUnavailableReason === undefined ? <Badge outline>{NODE_KIND_LABEL[detail.node.kind]}</Badge> : null}
              {detail.definitionUnavailableReason !== undefined || detail.group === undefined ? null : <span className="hint">{detail.group.label}</span>}
              {detail.definitionUnavailableReason === undefined ? <span className="mono muted">{detail.node.key}</span> : null}
            </div>
            <h2 className="node-head-title">{detail.definitionUnavailableReason === undefined ? detail.node.title : '步骤定义未保留'}</h2>
          </div>
          <Button
            size="sm"
            variant="ghost"
            icon="panel"
            title={wide ? '退出宽阅读区' : '在宽阅读区打开内容'}
            onClick={() => { setWide(!wide); }}
          >
            {wide ? '收起宽阅读' : '宽阅读'}
          </Button>
          <IconButton icon="x" label="关闭节点面板" onClick={onClose} />
        </div>
        <div className="tabs node-tabs" role="tablist" aria-label="节点页签">
          {(
            [
              ['overview', '概览'],
              ['session', '执行现场'],
              ['attempts', '尝试与产出'],
            ] as const
          ).map(([id, label]) => (
            <button key={id} type="button" role="tab" className="tab" aria-selected={tab === id} onClick={() => setTab(id)}>
              {label}
              {id === 'attempts' ? <span className="tab-n">{attempts.length}</span> : null}
            </button>
          ))}
        </div>
      </div>

      <div className="side-body node-side-body">
        {detail.definitionUnavailableReason === undefined ? null : <p role="status"><Icon name="info" />{detail.definitionUnavailableReason}</p>}
        {tab === 'overview' && detail.definitionUnavailableReason === undefined ? (
          <NodeOverview
            detail={isHistoricalAttempt && selectedAttempt !== undefined ? { ...detail, execution: { nodeId, status: selectedAttempt.status, attemptCount: selectedAttempt.ordinal, currentAttemptId: selectedAttempt.id, startedAt: selectedAttempt.startedAt, endedAt: selectedAttempt.endedAt }, currentAttempt: selectedAttempt } : detail}
            onOpenPlan={onOpenPlan}
            onOpenCitation={(link) => {
              openReader({ kind: 'citation', link });
            }}
          />
        ) : null}
        {tab === 'session' ? (
          <div className="node-session">
            {selectedAttempt?.readability.output === 'forbidden' ? <p role="status"><Icon name="lock" />你没有查看这次尝试正文的权限。</p> : null}
            <FactsBar>
              <FactPill label="数据连接" value={connection === 'connected' ? '已连接' : connection === 'connecting' ? '正在连接' : '已断开（只读轮询）'} tone={connection === 'connected' ? 'ok' : connection === 'connecting' ? 'neutral' : 'warn'} />
              <FactPill label="模型正文" value={capability?.modelText === 'ok' ? (hasModelText ? '有公开正文' : terminal ? '未提供正文' : '等待正文') : capability?.modelText === 'forbidden' ? '无权读取' : '此运行时未提供'} tone={hasModelText ? 'ok' : 'neutral'} />
              <FactPill label="工具" value={selectedAttempt?.readability.tools === 'forbidden' ? '无权读取' : visibleFragments.some((f) => f.category === 'tool_activity') ? '有工具记录' : '无工具记录'} tone="neutral" />
              <FactPill label="尝试" value={`${String(attempts.length)} 次`} tone="neutral" />
              <FactPill label="结果与验收" value={selectedAttempt === undefined ? '尚未执行' : NODE_STATUS_LABEL[selectedAttempt.status]} tone={selectedAttempt?.status === 'succeeded' ? 'ok' : selectedAttempt?.status === 'failed' ? 'warn' : 'neutral'} />
            </FactsBar>
            <p className="node-explain">{explainSentence(selectedAttempt?.status, hasModelText)}</p>

            {isHistoricalAttempt ? (
              <div className="hist-bar" role="status">
                <Icon name="clock" size="sm" />
                <span className="grow">正在查看尝试 #{selectedAttempt?.ordinal ?? '?'} 的固定记录 · 只读，不会追加，也不触发执行。</span>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    setSelectedAttemptId(undefined);
                  }}
                >
                  回到当前尝试
                </Button>
              </div>
            ) : null}

            {selectedAttempt?.readability.output === 'forbidden' ? null : capability?.modelText !== 'ok' ? (
              <div className="notice">
                <Icon name="info" size="sm" />
                <span>此运行时暂未提供公开正文；阶段与工具活动仍然真实显示。没有正文不代表失败。</span>
              </div>
            ) : !hasModelText && terminal ? (
              <div className="notice">
                <Icon name="info" size="sm" />
                <span>这次尝试没有公开正文；以工具记录与结果为准。没有正文不代表失败。</span>
              </div>
            ) : null}

            {connection === 'connected' ? null : (
              <div className="hist-bar" role="status">
                <Icon name="refresh" size="sm" />
                <span className="grow">
                  数据连接{connection === 'connecting' ? '正在重连' : '已断开'}：已加载记录保留；重连后按 seq 只读补读，不会重发命令，也不把断线当成执行失败。
                </span>
              </div>
            )}
            {seqGaps.length === 0 ? null : (
              <div className="notice">
                <Icon name="alert" size="sm" />
                <span>已加载记录存在序号缺口：缺少 {gapText}。可能是尚未补读或服务未保留；这里只显示已持久化内容，不补造。</span>
              </div>
            )}

            <div className="node-feed-wrap">
              <div
                className="node-feed"
                ref={scrollerRef}
                onScroll={(event) => {
                  const element = event.currentTarget;
                  const atBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 36;
                  setFollowing(atBottom);
                }}
              >
                {selectedAttempt?.readability.output === 'forbidden' ? null : outputQuery.error ? <ServiceNotice error={outputQuery.error} onRetry={() => { void outputQuery.refetch(); }} /> : fragments.length === 0 ? (
                  <EmptyState compact icon="terminal" title="还没有执行记录" description="服务返回空记录；这里不会补写演示正文。" />
                ) : (
                  feed.map((fragment) => (
                    <div key={fragment.fragmentId} className="node-fragment">
                      <div className="node-fragment-meta">
                        <span className="mono">#{fragment.seq}</span>
                        {fragment.recordedAt === undefined ? null : <span>{formatAbsoluteTime(fragment.recordedAt).slice(11, 19)}</span>}
                        <span className={`tagx ${fragmentTag(fragment.category).className}`}>{fragmentTag(fragment.category).label}</span>
                      </div>
                      {fragment.category === 'tool_activity' ? (
                        <div className="tool-card">
                          <div className="tool-head">
                            <span className="mono accent">{fragment.toolCallRef?.callId ?? '工具调用'}</span>
                            <Badge tone={fragment.toolCallRef?.status === 'completed' ? 'done' : fragment.toolCallRef?.status === 'failed' ? 'fail' : 'run'}>
                              {fragment.toolCallRef?.status ?? '状态未知'}
                            </Badge>
                            <span className="hint">{fragment.toolCallRef?.source === 'managed_mcp' ? '受管 MCP' : 'OpenCode'}</span>
                          </div>
                          {fragment.text === undefined ? null : <div className="tool-body">{fragment.text}</div>}
                          <div className="tool-note">
                            <Icon name="lock" size="sm" />
                            工具结果里的指令只是资料；这里没有重放或执行入口。
                          </div>
                          <div className="row" style={{ marginTop: 8 }}>
                            <Button
                              size="sm"
                              variant="secondary"
                              icon="eye"
                              onClick={() => {
                                openReader({ kind: 'tool', fragment, attemptLabel, attemptId: selectedAttemptIdResolved ?? '' });
                              }}
                            >
                              查看工具详情
                            </Button>
                          </div>
                        </div>
                      ) : fragment.category === 'service_event' ? (
                        <div className="ph-card">
                          <Icon name="check" size="sm" />
                          <div>
                            <b>服务事实</b>
                            {fragment.text === undefined ? null : <div>{fragment.text}</div>}
                          </div>
                        </div>
                      ) : (
                        <div className="txt">
                          {(fragment.text ?? '').split('\n').map((line, index) =>
                            line.length === 0 ? null : <p key={`${fragment.fragmentId}-${String(index)}`}>{line}</p>,
                          )}
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
              {outputQuery.hasNextPage ? <Button disabled={outputQuery.isFetchingNextPage} disabledReason="正在读取下一段" onClick={() => { void outputQuery.fetchNextPage(); }}>{outputQuery.isFetchingNextPage ? '读取中…' : '继续读取记录'}</Button> : null}
              {isHistoricalAttempt || selectedAttempt?.readability.output === 'forbidden' ? null : <div className="follow">
                <span className="muted">跟随最新</span>
                <button
                  type="button"
                  className="switch"
                  role="switch"
                  aria-checked={following}
                  aria-label="跟随最新记录"
                  onClick={() => {
                    const next = !following;
                    setFollowing(next);
                    if (next) {
                      const element = scrollerRef.current;
                      if (element !== null) element.scrollTop = element.scrollHeight;
                    }
                  }}
                />
              </div>}
            </div>
          </div>
        ) : null}

        {tab === 'attempts' ? (
          <div className="node-attempts">
            {attempts.length === 0 ? (
              <EmptyState compact icon="clock" title="还没有尝试记录" description="这一步尚未执行；没有尝试时不生成历史。" />
            ) : (
              <>
                <div className="box">
                  {attempts.map((attempt) => {
                    const active = (selectedAttemptIdResolved ?? currentAttempt?.id) === attempt.attemptId;
                    return (
                      <button
                        key={attempt.attemptId}
                        type="button"
                        className={`rowx attempt-row${active ? ' active' : ''}`}
                        aria-pressed={active}
                        onClick={() => {
                          setSelectedAttemptId(attempt.attemptId);
                        }}
                      >
                        <span className={`ic ${attempt.status === 'succeeded' ? 'ok' : attempt.status === 'failed' ? 'no' : attempt.status === 'running' ? 'run' : 'idle'}`}>
                          <Icon name={attempt.status === 'succeeded' ? 'check' : attempt.status === 'failed' ? 'x' : attempt.status === 'running' ? 'play' : 'clock'} size="sm" />
                        </span>
                        <span className="grow">
                          <span className="t">
                            尝试 #{attempt.ordinal} {attempt.isCurrent ? '· 当前' : '· 历史'}
                          </span>
                          <span className="s">
                            {attempt.startedAt === undefined ? '未开始' : formatDateTime(attempt.startedAt)}
                            {attempt.endedAt === undefined ? '' : ` → ${formatDateTime(attempt.endedAt)}`}
                            {attempt.reasonSummary === undefined ? '' : ` · ${attempt.reasonSummary}`}
                          </span>
                        </span>
                        <Badge tone={attempt.status === 'succeeded' ? 'done' : attempt.status === 'failed' ? 'fail' : attempt.status === 'running' ? 'run' : 'idle'}>
                          {nodeStatusText(attempt.status)}
                        </Badge>
                      </button>
                    );
                  })}
                </div>

                <div className="sec-t" style={{ marginTop: 16 }}>
                  所选尝试的结果与产出
                </div>
                {isHistoricalAttempt ? (
                  <div className="banner info" style={{ marginBottom: 10 }}>
                    <Icon name="lock" />
                    <div className="grow">历史尝试只读：结果、产物与尝试记录属于所选尝试；没有重跑或恢复入口。人工验收在概览页按节点判定。</div>
                  </div>
                ) : null}
                {selectedAttempt?.result === undefined ? (
                  <p className="hint">{selectedAttempt?.readability.result === 'forbidden' ? '你没有查看这次尝试结果和产物的权限。' : '这次尝试还没有提交结果。没有结果时不显示结论，也不把“正文结束”当作完成。'}</p>
                ) : (
                  <div className="box pad">
                    <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                      <Badge tone={selectedAttempt.result.verification?.state === 'passed' ? 'ok' : selectedAttempt.result.verification?.state === 'failed' ? 'fail' : 'idle'}>
                        {RESULT_STATE_LABEL[selectedAttempt.result.verification?.state ?? 'not_configured']?.label ?? '验收状态未知'}
                      </Badge>
                      <span className="mono muted" style={{ fontSize: 11.5 }}>
                        结果修订 {selectedAttempt.result.resultRevision}
                      </span>
                    </div>
                    <QualityReviewResult report={selectedAttempt.result.qualityReview} configured={detail.node.qualityReview} />
                    <p className="node-result-summary">{selectedAttempt.result.summary}</p>
                    {selectedAttempt.result.verification?.summary === undefined ? null : (
                      <p className="hint">{selectedAttempt.result.verification.summary}</p>
                    )}
                    {selectedAttempt.result.errors.length > 0 ? (
                      <ul className="list-plain" style={{ marginTop: 8 }}>
                        {selectedAttempt.result.errors.map((error) => (
                          <li key={`${error.code}-${error.message}`} style={{ color: 'var(--warn)' }}>
                            {error.code} · {error.message}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    {selectedAttempt.result.warnings.length > 0 ? (
                      <ul className="list-plain" style={{ marginTop: 8 }}>
                        {selectedAttempt.result.warnings.map((warning) => (
                          <li key={warning}>{warning}</li>
                        ))}
                      </ul>
                    ) : null}
                    <div className="sec-t" style={{ marginTop: 12 }}>
                      产物
                    </div>
                    {selectedAttempt.result.artifacts.length === 0 ? (
                      <p className="hint">这次尝试没有登记产物。</p>
                    ) : (
                      <ul className="artifact-list">
                        {selectedAttempt.result.artifacts.map((artifact) => (
                          <li key={artifact.id}>
                            <Icon name="file" size="sm" />
                            <span className="grow">
                              <b>{artifact.name}</b>
                              <span className="hint">
                                {artifact.mediaType}
                                {artifact.sizeBytes === undefined ? '' : ` · ${String(artifact.sizeBytes)} B`}
                              </span>
                            </span>
                            <span className="mono hint">{artifact.sha256.slice(0, 12)}…</span>
                            <Button
                              size="sm"
                              variant="ghost"
                              icon="eye"
                              onClick={() => {
                                openReader({ kind: 'artifact', artifact, attemptLabel });
                              }}
                            >
                              查看产物
                            </Button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        ) : null}

        {tab === 'overview' && !isHistoricalAttempt && manualAdvance !== undefined ? (
          <div>
            <div className="sec-t" style={{ marginTop: 16 }}>
              直接后继 · 自动推进已关闭
            </div>
            {manualAdvance.rows.length === 0 ? (
              <p className="hint">计划里没有从这一步出发的后继步骤。</p>
            ) : (
              <div className="box">
                {manualAdvance.rows.map((row) => (
                  <div key={row.id} className="rowx">
                    <span className={`ic ${row.status === 'succeeded' ? 'ok' : row.status === 'failed' ? 'no' : row.status === 'running' ? 'run' : 'idle'}`}>
                      <Icon name={row.status === 'succeeded' ? 'check' : row.status === 'failed' ? 'x' : row.status === 'running' ? 'play' : 'clock'} size="sm" />
                    </span>
                    <span className="grow">
                      <span className="t">{row.title}</span>
                      <span className="s">{row.status === undefined ? '未执行' : NODE_STATUS_LABEL[row.status]}</span>
                    </span>
                    {row.status === 'pending' || row.status === 'ready' ? (
                      row.blockers.length > 0 ? (
                        <Badge tone="idle" icon="clock">并行汇合 · 等「{row.blockers.join('、')}」</Badge>
                      ) : (
                        <Badge tone="wait" icon="play">可推进</Badge>
                      )
                    ) : (
                      <Badge tone={row.status === 'succeeded' ? 'done' : row.status === 'failed' ? 'fail' : row.status === 'running' ? 'run' : 'idle'}>
                        {row.status === undefined ? '未执行' : NODE_STATUS_LABEL[row.status]}
                      </Badge>
                    )}
                  </div>
                ))}
              </div>
            )}
            <div className="row wrap" style={{ gap: 8, marginTop: 10 }}>
              <Button
                variant="primary"
                size="sm"
                icon="play"
                disabled={manualAdvance.reason !== undefined}
                disabledReason={manualAdvance.reason}
                onClick={runAdvanceSuccessors}
              >
                {pendingAction === 'advance'
                  ? '正在推进…'
                  : manualAdvance.targets.candidates.length > 0
                    ? `推进直接后继 · ${String(manualAdvance.targets.candidates.length)} 步`
                    : '推进直接后继'}
              </Button>
              <span className="hint grow">只启动这一步的直接后继；同次不级联，有多个前置的步骤要等全部前置验收。</span>
            </div>
            {manualAdvance.reason === undefined ? null : (
              <div style={{ marginTop: 6 }}>
                <ActionReasonLine action={{ allowed: false, reason: manualAdvance.reason }} block />
              </div>
            )}
          </div>
        ) : null}

        {tab === 'overview' && !isHistoricalAttempt ? (
          <div>
            <div className="sec-t" style={{ marginTop: 16 }}>
              人工验收
            </div>
            <div className="box pad">
              <div className="row wrap" style={{ gap: 8 }}>
                <Badge
                  tone={acceptance === undefined ? 'idle' : acceptanceTone(acceptance.state)}
                  icon={acceptance?.state === 'accepted' ? 'check' : acceptance?.state === 'rejected' ? 'undo' : 'clock'}
                >
                  {acceptance === undefined ? '暂无验收事实' : ACCEPTANCE_LABEL[acceptance.state]}
                </Badge>
                {acceptance?.verdictAt === undefined ? null : <span className="hint">判定时间 {formatDateTime(acceptance.verdictAt)}</span>}
                {acceptance?.requestKey === undefined ? null : <span className="mono hint">{acceptance.requestKey}</span>}
              </div>
              {acceptance === undefined ? (
                <p className="hint" style={{ marginTop: 8 }}>
                  服务未返回验收事实：只有已成功完成的步骤才会出现待验收结论。
                </p>
              ) : (
                <>
                  <p className="hint" style={{ marginTop: 8 }}>
                    {acceptance.state === 'pending'
                      ? '步骤已成功完成，等待人工验收；验收或退回只记录审计结论，不改变执行状态、下游推进或任务级验收。'
                      : acceptance.state === 'accepted'
                        ? '这一步已由人工验收通过。结论可在需要时更正为退回修改。'
                        : '这一步已退回修改。结论可在需要时更正为验收通过。'}
                  </p>
                  {acceptance.note === undefined ? null : <p className="hint" style={{ marginTop: 6 }}>备注：{acceptance.note}</p>}
                </>
              )}
              <div className="row wrap" style={{ gap: 8, marginTop: 10 }}>
                <ServiceActionButton size="sm" variant="secondary" icon="undo" action={rejectAction} busy={command.state.busy} fallbackReason="服务未提供退回修改动作" onRun={() => openVerdict('reject')}>
                  退回修改
                </ServiceActionButton>
                <ServiceActionButton size="sm" variant="primary" icon="check" action={acceptAction} busy={command.state.busy} fallbackReason="服务未提供验收动作" onRun={() => openVerdict('accept')}>
                  验收通过
                </ServiceActionButton>
              </div>
              {acceptAction?.allowed !== true ? (
                <div style={{ marginTop: 6 }}>
                  <ActionReasonLine action={acceptAction} fallback="服务未提供验收动作" block />
                </div>
              ) : rejectAction?.allowed !== true ? (
                <div style={{ marginTop: 6 }}>
                  <ActionReasonLine action={rejectAction} fallback="服务未提供退回修改动作" block />
                </div>
              ) : null}
              <p className="hint" style={{ marginTop: 8 }}>
                验收结论是审计事实，不改变节点执行状态，也不作为任务完成的 gating；任务级验收在质量与用量页单独记录。
              </p>
            </div>
          </div>
        ) : null}

        {tab === 'overview' ? (
          <>
            <CommandErrorNotice error={command.state.error} title="节点操作未完成" />
            <ReceiptNotice receipt={command.state.receipt} successMessage={actionSuccess} />
          </>
        ) : null}

        <Modal
          open={verdict !== null}
          title={verdict === 'accept' ? '验收通过这一步？' : '退回修改这一步？'}
          onClose={() => {
            if (!command.state.busy) setVerdict(null);
          }}
          footer={
            <>
              <Button variant="ghost" onClick={() => setVerdict(null)} disabled={command.state.busy} disabledReason="正在提交，等待服务回执…">
                取消
              </Button>
              <span className="spacer" />
              <Button
                variant={verdict === 'reject' ? 'danger' : 'primary'}
                icon={verdict === 'reject' ? 'undo' : 'check'}
                disabled={command.state.busy || (verdict === 'reject' && verdictNote.trim().length === 0)}
                disabledReason={command.state.busy ? '正在提交，等待服务回执…' : '退回修改必须填写原因'}
                onClick={submitVerdict}
              >
                {pendingAction === 'accept' || pendingAction === 'reject' ? '正在提交…' : verdict === 'accept' ? '确认验收通过' : '确认退回修改'}
              </Button>
            </>
          }
        >
          <p>{verdict === 'accept' ? '记录“验收通过”结论；可选备注会写入审计事实。' : '记录“退回修改”结论；退回原因必填，会写入审计事实。'}</p>
          <p className="hint">验收 / 退回只记录人工结论，不改变执行状态、下游推进或任务级验收；结果未明时只按原请求号核对，不会自动重发。</p>
          <div className="field" style={{ marginTop: 12 }}>
            <label className="label" htmlFor="node-verdict-note">
              {verdict === 'accept' ? '备注（可选）' : '退回原因（必填）'}
            </label>
            <textarea
              id="node-verdict-note"
              className="textarea"
              value={verdictNote}
              maxLength={2000}
              disabled={command.state.busy}
              placeholder={verdict === 'accept' ? '例如：已核对验收条款与产物' : '写清要改什么（去空格后 1–2000 字）'}
              onChange={(event) => {
                setVerdictNote(event.target.value);
                setVerdictError(undefined);
              }}
            />
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span className="hint">{verdictNote.length} / 2000</span>
              {verdictError === undefined ? null : <span className="hint" style={{ color: 'var(--danger)' }}>{verdictError}</span>}
            </div>
          </div>
        </Modal>

        {attemptsQuery.isError ? <p className="hint">尝试列表读取失败；不会用当前尝试顶替历史。</p> : null}
        {outputQuery.isError ? <p className="hint">执行记录读取失败；重新读取后继续查看。</p> : null}
      </div>
    </aside>
  );
}

function explainSentence(status: Attempt['status'] | undefined, hasModelText: boolean): string {
  if (status === undefined) return '这一步尚未执行；没有尝试记录时不会预造正文或结果。';
  if (status === 'running') return hasModelText ? '正文正在记录；模型说“完成了”不会改变步骤状态。' : '正文尚未出现；以服务事实与工具活动为准。';
  if (status === 'failed') return '这次执行失败；已收到的正文与工具记录保留，不会自动重试。';
  if (status === 'succeeded') return '结果已提交并通过验收时才会显示完成；产出与证据属于这次尝试。';
  return `当前状态：${NODE_STATUS_LABEL[status]}；以服务事实为准。`;
}

function NodeOverview({ detail, onOpenPlan, onOpenCitation }: { readonly detail: NodeDetail; readonly onOpenPlan?: () => void; readonly onOpenCitation?: (link: RequirementLink) => void }) {
  return (
    <div>
      <div className="banner info" style={{ marginBottom: 12 }}>
        <Icon name="info" />
        <div className="grow">
          <b>{detail.group?.label ?? '未分组'} · {detail.node.key}</b>
          <br />
          {detail.node.summary}
        </div>
        {onOpenPlan === undefined ? null : (
          <div className="actions">
            <Button size="sm" variant="secondary" icon="flow" onClick={onOpenPlan}>
              打开计划
            </Button>
          </div>
        )}
      </div>

      <div className="sec-t">状态</div>
      <FactsBar>
        <FactPill label="执行状态" value={detail.execution === undefined ? '未执行' : NODE_STATUS_LABEL[detail.execution.status]} tone={detail.execution?.status === 'succeeded' ? 'ok' : detail.execution?.status === 'failed' ? 'warn' : 'neutral'} />
        <FactPill label="尝试次数" value={String(detail.execution?.attemptCount ?? 0)} />
        <FactPill label="当前尝试" value={detail.currentAttempt === undefined ? '—' : `#${String(detail.currentAttempt.ordinal)}`} />
        <FactPill label="结果与验收" value={detail.currentAttempt?.result === undefined ? '尚未提交' : detail.currentAttempt.result.verification === undefined ? '无验收记录' : RESULT_STATE_LABEL[detail.currentAttempt.result.verification.state]?.label ?? '未知'} />
      </FactsBar>

      <div className="sec-t" style={{ marginTop: 14 }}>
        来源需求
      </div>
      {detail.requirementLinks.length === 0 ? (
        <p className="hint">服务未关联需求条目。</p>
      ) : (
        <div className="box">
          {detail.requirementLinks.map((link) => (
            <div key={link.entryId} className="rowx">
              <span className="tagx fact">需求</span>
              <div className="grow">
                <div>{link.text}</div>
                <div className="s mono">{link.entryId}</div>
              </div>
              {onOpenCitation === undefined ? null : (
                <Button
                  size="sm"
                  variant="ghost"
                  icon="eye"
                  onClick={() => {
                    onOpenCitation(link);
                  }}
                >
                  查看原文
                </Button>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="sec-t" style={{ marginTop: 14 }}>
        为什么在这里
      </div>
      {detail.dependencyReasons.length === 0 ? (
        <p className="hint">没有上游依赖（或服务未返回依赖原因）。</p>
      ) : (
        <ul className="list-plain">
          {detail.dependencyReasons.map((reason) => (
            <li key={`${reason.fromNodeId}-${reason.kind}`}>
              {EDGE_KIND_LABEL[reason.kind] ?? reason.kind} · {reason.reason}
            </li>
          ))}
        </ul>
      )}

      <div className="sec-t" style={{ marginTop: 14 }}>
        输入 → 本步骤 → 输出槽位
      </div>
      <ul className="io-list">
        <li>
          <div className="io-side">
            {detail.node.inputs.length === 0 ? <span className="hint">无</span> : detail.node.inputs.map((input, index) => <span key={`${input.name}-${String(index)}`} className="io-chip">{input.name} · {input.source}</span>)}
          </div>
          <span className="io-arrow">
            <Icon name="arrowRight" size="sm" />
          </span>
          <div className="io-side">
            {detail.node.outputs.length === 0 ? <span className="hint">无</span> : detail.node.outputs.map((output, index) => <span key={`${output.name}-${String(index)}`} className="io-chip">{output.name} · 执行后才有结果</span>)}
          </div>
        </li>
      </ul>

      <div className="sec-t" style={{ marginTop: 14 }}>
        验收条款
      </div>
      {detail.node.acceptance.length === 0 ? <p className="hint">服务未声明验收条款。</p> : <ul className="list-plain">{detail.node.acceptance.map((item, index) => <li key={`${item}-${String(index)}`}>{item}</li>)}</ul>}

      <div className="sec-t" style={{ marginTop: 14 }}>
        读写资源
      </div>
      <div className="io-list">
        <li>
          <div className="io-side">
            <span className="hint">读取</span>
            {detail.node.resources.read.length === 0 ? <span className="hint">无</span> : detail.node.resources.read.map((resource) => <span key={`r-${resource.label}`} className="io-chip">{resource.label} · {resource.basis}</span>)}
          </div>
          <span className="io-arrow" />
          <div className="io-side">
            <span className="hint">写入</span>
            {detail.node.resources.write.length === 0 ? <span className="hint">无</span> : detail.node.resources.write.map((resource) => <span key={`w-${resource.label}`} className="io-chip">{resource.label} · {resource.basis}</span>)}
          </div>
        </li>
      </div>
    </div>
  );
}
