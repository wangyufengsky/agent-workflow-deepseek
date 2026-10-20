import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  ROUTES,
  createRequestKey,
  type ArtifactRef,
  type Attempt,
  type CommandResponse,
  type ExecutionView,
  type NodeAcceptRequest,
  type NodeAcceptanceView,
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
import { ActionReasonLine, CommandErrorNotice, FactPill, FactsBar, ReceiptNotice, ServiceActionButton } from '../../flow/workflow-ui.tsx';
import { formatDateTime } from '../../app/format.ts';
import { advanceTargets, nodeTitle, successorReason } from '../task/advance.ts';
import { ArtifactDetailView, CitationDetailView, CitationSourceView, ToolDetailView, type NodeReaderState, type RequirementLink } from './NodeSubviews.tsx';
import { NodeOverview } from './NodeOverview.tsx';
import { AttemptDetailView, AttemptsList, designAttemptRows, type AttemptRowModel } from './NodeAttempts.tsx';
import { NodeRecordFeed } from './NodeRecordFeed.tsx';
import {
  buildFeedItems,
  buildGaps,
  buildServiceEvents,
  buildToolCards,
  clockTime,
  deriveCombo,
  deriveFacts,
  gapText,
  type ConnectionState,
  type NodeFact,
  type ReconnectPhase,
  type ServiceEventRow,
  type ToolCardModel,
} from './node-facts.ts';
import { attemptVisual, pillTone } from './node-labels.ts';
import { readCitations, type NodeCitation } from './node-citations.ts';
import './node.css';

type NodeTab = 'overview' | 'session' | 'attempts';

const TAB_ORDER: readonly NodeTab[] = ['overview', 'session', 'attempts'];
const TAB_LABEL: Readonly<Record<NodeTab, string>> = { overview: '概览', session: '执行现场', attempts: '尝试与产出' };

/** Panel memory (design: tab/attempt/scroll survive panel interactions, not reloads). */
interface PanelMemory {
  readonly tab: NodeTab;
  readonly attemptId?: string;
  readonly following: boolean;
}
const panelMemory = new Map<string, PanelMemory>();
const feedMemory = new Map<string, { readonly top: number; readonly following: boolean }>();

const ACCEPTANCE_LABEL: Readonly<Record<NodeAcceptanceView['state'], string>> = {
  pending: '待人工验收',
  accepted: '已验收通过',
  rejected: '已退回修改',
};

function acceptanceTone(state: NodeAcceptanceView['state']): 'wait' | 'ok' | 'fail' {
  return state === 'accepted' ? 'ok' : state === 'rejected' ? 'fail' : 'wait';
}


async function submitNodeVerdict(taskId: string, nodeId: string, kind: 'accept' | 'reject', note: string): Promise<CommandResponse<NodeResponse>> {
  if (kind === 'accept') {
    const body: NodeAcceptRequest = { requestKey: createRequestKey(), confirmAccept: true, ...(note.length === 0 ? {} : { note }) };
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
 * Node execution detail (design N01–N20): panel head with step/role/status/attempt
 * selector, five honest facts, snapshot service rows, a streaming-safe record feed
 * with follow/pill, attempt history with single-attempt detail, wide reader with a
 * left rail, and a fixed footer. Missing service data is shown as unknown — never
 * filled with sample prose or a guessed success.
 */
export function NodeDetailPanel({ taskId, nodeId, connection, pollInterval, plan, execution, focusAcceptance = false, focusAcceptanceToken, onClose, onOpenPlan }: NodeDetailPanelProps) {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<NodeTab>('session');
  const [selectedAttemptId, setSelectedAttemptId] = useState<string | undefined>(undefined);
  const [attemptDetailId, setAttemptDetailId] = useState<string | undefined>(undefined);
  const [attemptMenuOpen, setAttemptMenuOpen] = useState(false);
  const [actionSuccess, setActionSuccess] = useState<string | undefined>(undefined);
  const [pendingAction, setPendingAction] = useState<'advance' | 'accept' | 'reject' | null>(null);
  const [verdict, setVerdict] = useState<'accept' | 'reject' | null>(null);
  const [verdictNote, setVerdictNote] = useState('');
  const [verdictError, setVerdictError] = useState<string | undefined>(undefined);
  const [reader, setReader] = useState<NodeReaderState | null>(null);
  const [following, setFollowing] = useState(true);
  const [paused, setPaused] = useState(false);
  const [newCount, setNewCount] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [reconnectPhase, setReconnectPhase] = useState<ReconnectPhase>('idle');
  const [reconnectCounts, setReconnectCounts] = useState<{ readonly backfilled: number; readonly deduped: number } | undefined>(undefined);
  const [backfilledIds, setBackfilledIds] = useState<ReadonlySet<string>>(() => new Set());
  const [returningToCurrent, setReturningToCurrent] = useState(false);
  const [lateIgnored, setLateIgnored] = useState(false);
  const [currentAttemptHasNew, setCurrentAttemptHasNew] = useState(false);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const readerTriggerRef = useRef<HTMLElement | null>(null);
  const lastScrollTop = useRef(0);
  const lastItemCount = useRef(0);
  const lastTextLength = useRef(0);
  const saveTopRef = useRef<{ readonly key: string; readonly top: number } | undefined>(undefined);
  const tabRefs = useRef(new Map<NodeTab, HTMLButtonElement | null>());
  const tabOrderIndex = TAB_ORDER.indexOf(tab);

  const detailQuery = useNodeDetail(taskId, nodeId, selectedAttemptId, pollInterval === false ? 2_000 : Math.min(pollInterval, 2_000));
  const attemptsQuery = useNodeAttempts(taskId, nodeId);
  const command = useWorkflowCommand(taskId);
  const selectedAttemptIdResolved = selectedAttemptId ?? detailQuery.data?.currentAttempt?.id;
  const detailData = detailQuery.data;
  const identityOk = detailData !== undefined && detailData.taskId === taskId && detailData.nodeId === nodeId;
  const firstLoad = detailQuery.isFetching && !detailQuery.isFetchedAfterMount;
  const detail: NodeDetailResponse | undefined = firstLoad || !identityOk ? undefined : detailData;
  const shellRef = useRef<NodeDetailResponse | undefined>(undefined);
  if (detail !== undefined) shellRef.current = detail;
  const shellDetail = detail ?? shellRef.current;
  const currentAttempt = detail?.currentAttempt;
  const isHistoricalAttempt = selectedAttemptIdResolved !== undefined && selectedAttemptIdResolved !== currentAttempt?.id;
  const currentAttemptId = currentAttempt?.id;
  const currentOutputQuery = useNodeOutput(taskId, nodeId, isHistoricalAttempt ? currentAttemptId : undefined, isHistoricalAttempt ? pollInterval : false);
  const selectedAttempt: Attempt | undefined = useMemo(() => {
    if (detail === undefined) return undefined;
    if (selectedAttemptIdResolved === undefined) return undefined;
    return detail.attempts.find((attempt) => attempt.id === selectedAttemptIdResolved) ?? (currentAttempt?.id === selectedAttemptIdResolved ? currentAttempt : undefined);
  }, [currentAttempt, detail, selectedAttemptIdResolved]);
  const attemptOutputForbidden = selectedAttempt?.readability.output === 'forbidden';
  const outputQuery = useNodeOutput(taskId, nodeId, attemptOutputForbidden ? undefined : selectedAttemptIdResolved, isHistoricalAttempt ? false : pollInterval);
  const detailExecution = detail?.execution;
  const acceptance = isHistoricalAttempt ? undefined : detail?.acceptance;
  const attemptRows: readonly AttemptRowModel[] = useMemo(
    () => designAttemptRows(detail?.attempts ?? [], currentAttempt?.id, attemptsQuery.data?.attempts ?? []),
    [attemptsQuery.data?.attempts, currentAttempt?.id, detail?.attempts],
  );
  const activeAttempt = selectedAttempt ?? currentAttempt;
  const activeNodeStatus = isHistoricalAttempt ? selectedAttempt?.status : detailExecution?.status;
  const activeExecutionStatus = isHistoricalAttempt ? undefined : execution?.status;
  const statusVisual = attemptVisual(activeAttempt, acceptance, activeExecutionStatus);

  useEffect(() => {
    if (verdict !== null) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (reader !== null) {
        closeReader();
        return;
      }
      if (attemptMenuOpen) {
        setAttemptMenuOpen(false);
        return;
      }
      if (attemptDetailId !== undefined) {
        setAttemptDetailId(undefined);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reader, verdict, attemptMenuOpen, attemptDetailId]);

  useEffect(() => {
    if (!attemptMenuOpen) return;
    const onDown = (event: MouseEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest('.node-att-menu-wrap') !== null) return;
      setAttemptMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('mousedown', onDown);
    };
  }, [attemptMenuOpen]);

  useEffect(() => {
    for (const attempt of detail?.attempts ?? []) {
      const revoked = (key: readonly unknown[]) =>
        (key[0] === 'artifact' && key[1] === taskId && key[2] === attempt.id && attempt.readability.result === 'forbidden') ||
        (key[0] === 'workflow' && key[1] === taskId && key[2] === 'node' && key[3] === nodeId && key[4] === 'output' && key[5] === attempt.id && attempt.readability.output === 'forbidden') ||
        (key[0] === 'node-tool' && key[1] === taskId && key[2] === nodeId && key[3] === attempt.id && (attempt.readability.tools === 'forbidden' || attempt.readability.output === 'forbidden'));
      void queryClient.cancelQueries({ predicate: (query) => revoked(query.queryKey) }).then(() => {
        queryClient.removeQueries({ predicate: (query) => revoked(query.queryKey) });
      });
    }
  }, [detail, taskId, nodeId, queryClient]);

  // Panel/attempt/scroll memory (design N01-closed / N17 / N12 position memory).
  const panelScope = `${taskId}:${nodeId}`;
  const previousPanelScope = useRef(panelScope);
  useEffect(() => {
    const previous = previousPanelScope.current;
    if (previous !== panelScope) {
      panelMemory.set(previous, { tab, ...(selectedAttemptId === undefined ? {} : { attemptId: selectedAttemptId }), following });
      previousPanelScope.current = panelScope;
    }
    const saved = panelMemory.get(panelScope);
    setTab(focusAcceptance ? 'overview' : saved?.tab ?? 'session');
    setSelectedAttemptId(saved?.attemptId);
    setAttemptDetailId(undefined);
    setFollowing(saved?.following ?? true);
    setPaused(false);
    setNewCount(0);
    setDirty(false);
    setReader(null);
    setAttemptMenuOpen(false);
    setReconnectPhase('idle');
    setReconnectCounts(undefined);
    setBackfilledIds(new Set());
    setReturningToCurrent(false);
    setLateIgnored(false);
    setCurrentAttemptHasNew(false);
    setActionSuccess(undefined);
    setVerdict(null);
    setPendingAction(null);
    lastItemCount.current = 0;
    lastTextLength.current = 0;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusAcceptance, focusAcceptanceToken, panelScope]);

  useEffect(() => {
    if (!isHistoricalAttempt) {
      setCurrentAttemptHasNew(false);
      return;
    }
    const count = currentOutputQuery.data?.fragments.length ?? 0;
    if (count > 0) setCurrentAttemptHasNew(true);
  }, [currentOutputQuery.data?.fragments.length, isHistoricalAttempt]);

  const fragments: readonly OutputFragment[] = attemptOutputForbidden
    ? []
    : outputQuery.data?.fragments ?? (selectedAttemptIdResolved === currentAttempt?.id ? detail?.output.fragments : undefined) ?? [];
  const outputReadFailed = outputQuery.error !== undefined && outputQuery.data !== undefined;
  const toolsForbidden = selectedAttempt?.readability.tools === 'forbidden';
  const resultForbidden = selectedAttempt?.readability.result === 'forbidden';
  const attemptRevoked = attemptOutputForbidden || toolsForbidden || resultForbidden;
  const visibleFragments = toolsForbidden ? fragments.filter((fragment) => fragment.category !== 'tool_activity' && fragment.toolEvidence === undefined) : fragments;
  const toolCards = useMemo(() => buildToolCards(visibleFragments, selectedAttempt), [selectedAttempt, visibleFragments]);
  const gaps = useMemo(() => buildGaps(fragments), [fragments]);
  const terminal = outputQuery.data?.terminal ?? detail?.output.terminal ?? false;
  const capability = detail?.output.capabilities;
  const hasModelText = fragments.some((fragment) => fragment.category === 'model_text');
  const feedItems = useMemo(
    () =>
      buildFeedItems({
        allFragments: fragments,
        visibleFragments,
        toolCards,
        attempt: selectedAttempt,
        historical: isHistoricalAttempt,
        live: !isHistoricalAttempt && selectedAttempt?.status === 'running' && !attemptRevoked,
        toolsReadable: !toolsForbidden,
      }),
    [attemptRevoked, fragments, isHistoricalAttempt, selectedAttempt, toolCards, toolsForbidden, visibleFragments],
  );
  const connectionState: ConnectionState = connection;
  const stale = !isHistoricalAttempt && connectionState !== 'connected' && reconnectPhase !== 'done' && reconnectPhase !== 'gap';
  const lastReadAt = outputQuery.dataUpdatedAt > 0 ? new Date(outputQuery.dataUpdatedAt).toISOString() : undefined;
  const factsLoading = detailQuery.isLoading || detail === undefined || returningToCurrent;
  const facts: readonly NodeFact[] = deriveFacts({
    loading: factsLoading,
    historical: isHistoricalAttempt,
    connection: connectionState,
    reconnectPhase,
    attempt: selectedAttempt,
    acceptance,
    executionStatus: activeExecutionStatus,
    modelTextCapability: capability?.modelText,
    toolsReadable: !toolsForbidden,
    outputReadable: !attemptOutputForbidden,
    resultReadable: !resultForbidden,
    hasModelText,
    hasAnyFragment: fragments.length > 0,
    terminal,
    toolCards,
  });
  const combo = deriveCombo({
    loading: factsLoading,
    historical: isHistoricalAttempt,
    connection: connectionState,
    reconnectPhase,
    attempt: selectedAttempt,
    acceptance,
    executionStatus: activeExecutionStatus,
    modelTextCapability: capability?.modelText,
    toolsReadable: !toolsForbidden,
    outputReadable: !attemptOutputForbidden,
    resultReadable: !resultForbidden,
    hasModelText,
    hasAnyFragment: fragments.length > 0,
    terminal,
    toolCards,
    attemptReadable: !attemptRevoked,
    attemptOrdinal: activeAttempt?.ordinal,
    verificationState: selectedAttempt?.result?.verification?.state,
    gaps,
    lastReadAt,
    backfilledCount: reconnectCounts?.backfilled ?? 0,
    dedupedCount: reconnectCounts?.deduped ?? 0,
  });
  const serviceEvents: readonly ServiceEventRow[] = isHistoricalAttempt
    ? []
    : buildServiceEvents({
        attempt: selectedAttempt,
        acceptance,
        executionStatus: activeExecutionStatus,
        nodeStatus: activeNodeStatus,
        nodeError: detailExecution?.error,
        attemptFailureReason: attemptRows.find((row) => row.attemptId === selectedAttemptIdResolved)?.reasonSummary,
        connection: connectionState,
        reconnectPhase,
        backfilledCount: reconnectCounts?.backfilled ?? 0,
        dedupedCount: reconnectCounts?.deduped ?? 0,
        gapCount: gaps.length,
        lastReadAt,
      });

  const feedKey = `${panelScope}:${selectedAttemptIdResolved ?? 'current'}`;
  const saveFeedMemory = () => {
    const element = scrollerRef.current;
    if (element === null) return;
    feedMemory.set(feedKey, { top: element.scrollTop, following });
  };
  const recaptureFeed = () => {
    const element = scrollerRef.current;
    if (element !== null) saveTopRef.current = { key: feedKey, top: element.scrollTop };
  };

  const openReader = (next: NodeReaderState) => {
    recaptureFeed();
    saveFeedMemory();
    readerTriggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (following && !paused) setPaused(true);
    setReader(next);
  };
  const closeReader = () => {
    setReader(null);
    requestAnimationFrame(() => {
      readerTriggerRef.current?.focus();
    });
  };

  const runReconnect = async () => {
    if (reconnectPhase === 'reading') return;
    if (detail === undefined || selectedAttemptIdResolved === undefined) return;
    const baseline = new Set(fragments.map((fragment) => fragment.fragmentId));
    setReconnectPhase('reading');
    setReconnectCounts(undefined);
    const detailResult = await detailQuery.refetch();
    const outputResult = await outputQuery.refetch();
    const attemptsResult = await attemptsQuery.refetch();
    if (detailResult.error !== null || outputResult.error !== null || attemptsResult.error !== null) {
      setReconnectPhase('failed');
      return;
    }
    const pages = outputResult.data?.pages ?? [];
    const latest = pages.flatMap((page) => page.fragments);
    const fresh = latest.filter((fragment) => !baseline.has(fragment.fragmentId));
    setReconnectCounts({ backfilled: fresh.length, deduped: latest.length - fresh.length });
    setBackfilledIds(new Set(fresh.map((fragment) => fragment.fragmentId)));
    setReconnectPhase(buildGaps(latest).length > 0 ? 'gap' : 'done');
  };

  const previousConnection = useRef<WorkflowStreamConnection>(connection);
  useEffect(() => {
    const previous = previousConnection.current;
    previousConnection.current = connection;
    if (previous === 'disconnected' && connection === 'connected' && reconnectPhase !== 'reading' && !isHistoricalAttempt && detail !== undefined) {
      void runReconnect();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connection]);

  const feedSignature = useMemo(
    () => ({ count: feedItems.length, textLength: fragments.reduce((sum, fragment) => sum + (fragment.category === 'tool_activity' ? 0 : fragment.text?.length ?? 0), 0) }),
    [feedItems.length, fragments],
  );
  const scrollFeedToBottom = (smooth: boolean) => {
    const element = scrollerRef.current;
    if (element === null) return;
    element.scrollTo({ top: element.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  };
  useEffect(() => {
    if (feedSignature.count > lastItemCount.current) {
      const added = feedSignature.count - lastItemCount.current;
      const wasEmpty = lastItemCount.current === 0;
      if (!wasEmpty && !(following && !paused)) setNewCount((count) => count + added);
      if (wasEmpty) scrollFeedToBottom(false);
    }
    if (feedSignature.textLength > lastTextLength.current && !(following && !paused) && lastTextLength.current > 0) setDirty(true);
    lastItemCount.current = feedSignature.count;
    lastTextLength.current = feedSignature.textLength;
    if (following && !paused && tab === 'session') scrollFeedToBottom(false);
    // Primitive deps keep this effect off the hot render path: `fragments` is a
    // fresh array on every poll, so depending on its identity would scroll on
    // every render.
  }, [feedSignature.count, feedSignature.textLength, following, paused, tab]);

  useEffect(() => {
    const pending = saveTopRef.current;
    if (pending === undefined || pending.key !== feedKey) return;
    if (tab !== 'session' || reader !== null || attemptDetailId !== undefined) return;
    const element = scrollerRef.current;
    if (element === null) return;
    element.scrollTop = pending.top;
    saveTopRef.current = undefined;
  }, [attemptDetailId, feedItems.length, feedKey, reader, tab]);

  useEffect(() => {
    if (!returningToCurrent) return;
    if (detail === undefined || selectedAttemptIdResolved !== detail.currentAttempt?.id || detailQuery.isFetching) return;
    setReturningToCurrent(false);
  }, [detail, detailQuery.isFetching, returningToCurrent, selectedAttemptIdResolved]);

  const selectAttempt = (attemptId: string | undefined, options: { readonly session?: boolean } = {}) => {
    recaptureFeed();
    saveFeedMemory();
    const targetKey = `${panelScope}:${attemptId ?? 'current'}`;
    const targetMemory = feedMemory.get(targetKey);
    saveTopRef.current = targetMemory === undefined || !targetMemory.following ? undefined : { key: targetKey, top: targetMemory.top };
    setSelectedAttemptId(attemptId);
    setAttemptDetailId(undefined);
    setCurrentAttemptHasNew(false);
    lastItemCount.current = 0;
    lastTextLength.current = 0;
    setNewCount(0);
    setDirty(false);
    setReconnectPhase('idle');
    setReconnectCounts(undefined);
    setBackfilledIds(new Set());
    if (options.session === true) setTab('session');
  };
  const backToCurrent = () => {
    setReturningToCurrent(true);
    selectAttempt(undefined, { session: true });
  };
  const openAttemptDetail = (attemptId: string) => {
    recaptureFeed();
    saveFeedMemory();
    setSelectedAttemptId(attemptId);
    setAttemptDetailId(attemptId);
    setTab('attempts');
    setReconnectPhase('idle');
    setReconnectCounts(undefined);
    setBackfilledIds(new Set());
  };

  const changeTab = (next: NodeTab) => {
    recaptureFeed();
    saveFeedMemory();
    setTab(next);
  };

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
    const reason = successorIds.length === 0 ? '这一步没有直接后继步骤。' : successorReason(plan, execution, targets, command.state.busy);
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
      setActionSuccess(saved === undefined ? `${label}已记录（回执 succeeded）。` : `${label}已记录：${ACCEPTANCE_LABEL[saved.state]}${saved.note === undefined ? '' : ` · 备注：${saved.note}`}（回执 succeeded）。`);
    });
  };

  const loadMoreAttempts = () => {
    void attemptsQuery.refetch();
  };

  const readerForbidden = (() => {
    if (reader === null) return false;
    if (reader.kind === 'citation' || reader.kind === 'structured-citation') return false;
    const attempt = reader.kind === 'tool' ? detail?.attempts.find((item) => item.id === reader.attemptId) : detail?.attempts.find((item) => item.id === reader.artifact.sourceAttemptId);
    if (attempt === undefined) return true;
    return reader.kind === 'artifact' ? attempt.readability.result === 'forbidden' : attempt.readability.tools === 'forbidden' || attempt.readability.output === 'forbidden';
  })();

  const citationEntries = useMemo(() => {
    const entries: { readonly fragmentId: string; readonly citation: NodeCitation }[] = [];
    for (const fragment of fragments) {
      for (const citation of readCitations(fragment)) entries.push({ fragmentId: fragment.fragmentId, citation });
    }
    return entries;
  }, [fragments]);

  const attemptMenuItems = attemptRows.map((row) => {
    const visual = attemptVisual({ status: row.status });
    return {
      id: row.attemptId,
      label: `尝试 #${String(row.ordinal)} · ${visual.label}${row.startedAt === undefined ? '' : ` · ${clockTime(row.startedAt)} 开始`}${row.isCurrent ? '（当前）' : '（历史）'}`,
      current: row.isCurrent,
      select: () => {
        setAttemptMenuOpen(false);
        if (row.isCurrent) backToCurrent();
        else selectAttempt(row.attemptId, { session: true });
      },
    };
  });

  /* ---------------- loading / error shells ---------------- */

  const detailReadFailed = detailQuery.error !== undefined && detailQuery.data !== undefined;
  if (detailQuery.isError || (detailQuery.error !== undefined && detailQuery.data === undefined)) {
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
          {selectedAttemptId === undefined ? null : (
            <div style={{ marginTop: 10 }}>
              <p className="hint">当前查看的是历史尝试；如果这条尝试已被清理，可以回到当前尝试继续查看。</p>
              <Button
                size="sm"
                variant="secondary"
                icon="refresh"
                onClick={() => {
                  setSelectedAttemptId(undefined);
                  setAttemptDetailId(undefined);
                  void detailQuery.refetch();
                }}
              >
                回到当前尝试
              </Button>
            </div>
          )}
        </div>
      </aside>
    );
  }

  if (detail === undefined) {
    const loadingAttempt = shellDetail?.currentAttempt;
    return (
      <aside className="side node-side" aria-label="节点执行现场">
        <div className="side-head node-side-head">
          <div className="node-head-row">
            <div className="grow">
              <div className="node-head-eyebrow">
                <span className="node-step">步骤详情</span>
              </div>
              <h2 className="node-head-title">{shellDetail?.definitionUnavailableReason === undefined ? shellDetail?.node.title ?? '正在读取步骤…' : '步骤定义未保留'}</h2>
              <div className="node-head-badges">
                <Badge tone="idle" icon="refresh">
                  读取中
                </Badge>
              </div>
            </div>
            <IconButton icon="x" label="关闭节点面板" onClick={onClose} />
          </div>
          <div className="tabs node-tabs" role="tablist" aria-label="节点页签">
            {TAB_ORDER.map((id) => (
              <button key={id} type="button" role="tab" className="tab" aria-selected={tab === id} disabled>
                {TAB_LABEL[id]}
              </button>
            ))}
          </div>
        </div>
        <div className="side-body node-side-body">
          <FactsBar>
            {['数据连接', '模型正文', '工具', '尝试', '结果与验收'].map((label) => (
              <FactPill key={label} label={label} value="读取中" tone="idle" />
            ))}
          </FactsBar>
          {(selectedAttemptId !== undefined || returningToCurrent) && loadingAttempt?.id !== selectedAttemptId ? (
            <p className="node-explain" role="status">
              {`正在读取尝试 #${String(attemptRows.find((row) => row.attemptId === selectedAttemptId)?.ordinal ?? '?')} 的最新记录；读取完成前不显示结论，也不用当前尝试的内容顶替。`}
            </p>
          ) : null}
          <div className="node-loading-body">
            <SkeletonText lines={8} />
          </div>
        </div>
        <div className="node-foot">
          <span className="hint grow">
            <Icon name="lock" size="sm" /> 读取完成前不能操作
          </span>
        </div>
      </aside>
    );
  }

  /* ---------------- reader (wide) ---------------- */

  if (reader !== null) {
    const readerAttempt = reader.kind === 'tool' ? detail.attempts.find((attempt) => attempt.id === reader.attemptId) : reader.kind === 'artifact' ? detail.attempts.find((attempt) => attempt.id === reader.artifact.sourceAttemptId) : undefined;
    const readerLabel = reader.kind === 'citation' || reader.kind === 'structured-citation' ? '引用原文' : reader.kind === 'tool' ? '工具详情' : '产物详情';
    const readerItemName = reader.kind === 'tool' ? reader.fragment.toolCallRef?.callId ?? '工具调用' : reader.kind === 'artifact' ? reader.artifact.name : reader.kind === 'structured-citation' ? reader.citation.label : reader.link.label;
    const readerAttemptLabel = readerAttempt === undefined ? (reader.kind === 'citation' ? '节点需求来源' : '当前尝试') : `${readerAttempt.id === currentAttempt?.id ? '当前' : '历史'}尝试 #${String(readerAttempt.ordinal)}`;
    if (readerForbidden) {
      return (
        <aside className="side node-side node-side-wide" aria-label="节点内容无权限">
          <div className="side-head node-side-head">
            <div className="node-head-row">
              <Icon name="lock" />
              <h2 className="grow node-head-title">无权查看这次尝试内容</h2>
              <Button size="sm" variant="secondary" icon="chevLeft" onClick={closeReader}>
                返回节点
              </Button>
              <IconButton icon="x" label="关闭节点面板" onClick={onClose} />
            </div>
          </div>
          <div className="side-body node-side-body">
            <div className="node-lock">
              <span className="tile">
                <Icon name="lock" size="lg" />
              </span>
              <h3>你已无权查看这次尝试的记录</h3>
              <p>读取权限已变化，已隐藏之前加载的内容；这里不提供业务动作。</p>
            </div>
          </div>
        </aside>
      );
    }
    const railItems = (() => {
      if (reader.kind === 'tool') {
        return toolCards.map((card) => ({
          key: card.callId,
          label: card.name,
          sub: `#${card.callId} · ${card.visual.label}`,
          active: (reader.fragment.toolCallRef?.callId ?? '') === card.callId,
          select: () => setReader({ kind: 'tool', attemptId: selectedAttemptIdResolved ?? '', fragment: card.fragment, attemptLabel: readerAttemptLabel }),
        }));
      }
      if (reader.kind === 'artifact') {
        const attempt = readerAttempt ?? selectedAttempt;
        const artifacts = attempt?.readability.result === 'forbidden' ? [] : (attempt?.result?.artifacts ?? []);
        return artifacts.map((artifact) => ({
          key: artifact.id,
          label: artifact.name,
          sub: `@ ${artifact.revision} · ${artifact.mediaType}`,
          active: artifact.id === reader.artifact.id,
          select: () => setReader({ kind: 'artifact', artifact, attemptLabel: readerAttemptLabel }),
        }));
      }
      if (reader.kind === 'structured-citation') {
        return citationEntries.map((entry) => ({
          key: `${entry.fragmentId}:${String(entry.citation.index)}`,
          label: entry.citation.label,
          sub: `[${String(entry.citation.index)}] · ${entry.citation.kind}`,
          active: entry.citation.index === reader.citation.index && entry.citation.label === reader.citation.label,
          select: () => setReader({ kind: 'structured-citation', citation: entry.citation, attemptLabel: readerAttemptLabel }),
        }));
      }
      return detail.requirementLinks.map((link) => ({
        key: link.entryId,
        label: link.label,
        sub: link.entryId,
        active: link.entryId === reader.link.entryId,
        select: () => setReader({ kind: 'citation', link }),
      }));
    })();
    return (
      <aside className="side node-side node-side-wide" aria-label={`${readerLabel}（宽阅读区）`}>
        <div className="side-head node-side-head">
          <div className="node-rd-top">
            <nav className="node-rd-crumbs grow" aria-label="阅读位置">
              <span>{detail.node.title}</span>
              <Icon name="chevRight" size="sm" />
              <span>{readerAttemptLabel}</span>
              <Icon name="chevRight" size="sm" />
              <span className="cur">{readerItemName}</span>
            </nav>
            <span className="hint node-kbd">Esc</span>
            <Button size="sm" variant="secondary" icon="arrowLeft" onClick={closeReader}>
              返回节点详情
            </Button>
            <IconButton icon="x" label="关闭节点面板" onClick={onClose} />
          </div>
        </div>
        <div className="node-rd-body">
          {railItems.length === 0 ? null : (
            <nav className="node-rd-list" aria-label="阅读列表">
              {railItems.map((item) => (
                <button key={item.key} type="button" className="node-rd-item" aria-current={item.active} onClick={item.select}>
                  <span className="t">{item.label}</span>
                  <span className="s">{item.sub}</span>
                </button>
              ))}
            </nav>
          )}
          <section className="node-rd-main">
            {reader.kind === 'tool' ? (
              <ToolDetailView key={`${reader.attemptId}:${reader.fragment.toolCallRef?.callId ?? ''}`} taskId={taskId} nodeId={nodeId} attemptId={reader.attemptId} fragment={reader.fragment} attemptLabel={reader.attemptLabel} />
            ) : reader.kind === 'artifact' ? (
              <ArtifactDetailView key={`${taskId}:${reader.artifact.id}:${reader.artifact.revision}`} taskId={taskId} artifact={reader.artifact} attemptLabel={reader.attemptLabel} />
            ) : reader.kind === 'structured-citation' ? (
              <CitationDetailView citation={reader.citation} attemptLabel={reader.attemptLabel} onBack={closeReader} />
            ) : (
              <CitationSourceView taskId={taskId} nodeId={nodeId} link={reader.link} attemptLabel={readerAttemptLabel} onBack={closeReader} />
            )}
          </section>
        </div>
      </aside>
    );
  }

  /* ---------------- main panel ---------------- */

  const stepIndex = plan === undefined ? undefined : plan.graph.nodes.findIndex((node) => node.id === nodeId);
  const stepLabel = stepIndex === undefined ? '步骤' : stepIndex < 0 ? '步骤' : `步骤 ${String(stepIndex + 1)}`;
  const roleName = detail.node.roleSnapshot?.name;
  const acceptAction = detail.actions.accept;
  const rejectAction = detail.actions.reject;
  const attemptDetailAttempt = attemptDetailId === undefined ? undefined : detail.attempts.find((attempt) => attempt.id === attemptDetailId);
  return (
    <aside className="side node-side" aria-label="节点执行现场">
      <div className="side-head node-side-head">
        <div className="node-head-row">
          <div className="grow">
            <div className="node-head-eyebrow">
              {detail.definitionUnavailableReason === undefined ? (
                <>
                  <span className="node-step">{stepLabel}</span>
                  <span className="node-role">{roleName ?? '职业未记录'}</span>
                  {detail.group === undefined ? null : <span className="hint">· {detail.group.label}</span>}
                  <span className="mono muted node-key">{detail.node.key}</span>
                </>
              ) : (
                <span className="node-step">步骤定义未保留</span>
              )}
            </div>
            <h2 className="node-head-title">{detail.definitionUnavailableReason === undefined ? detail.node.title : '步骤定义未保留'}</h2>
            <div className="node-head-badges">
              <Badge tone={statusVisual.tone} icon={statusVisual.icon}>
                {statusVisual.label}
              </Badge>
              <div className="node-att-menu-wrap">
                <button
                  type="button"
                  className={`node-att-chip${isHistoricalAttempt ? ' hist' : ''}`}
                  aria-haspopup="menu"
                  aria-expanded={attemptMenuOpen}
                  aria-label={`选择尝试，当前查看尝试 #${String(activeAttempt?.ordinal ?? '?')}${isHistoricalAttempt ? '（历史）' : '（当前）'}`}
                  onClick={() => setAttemptMenuOpen(!attemptMenuOpen)}
                >
                  {isHistoricalAttempt ? <Icon name="clock" size="sm" /> : null}
                  {`尝试 #${String(activeAttempt?.ordinal ?? '?')} · ${isHistoricalAttempt ? '历史' : '当前'}`}
                  <Icon name="chevDown" size="sm" />
                </button>
                {attemptMenuOpen ? (
                  <div className="node-att-menu" role="menu" aria-label="尝试选择">
                    {attemptMenuItems.length === 0 ? <div className="node-att-menu-empty">服务未返回尝试记录</div> : attemptMenuItems.map((item) => (
                      <button key={item.id} type="button" role="menuitemradio" aria-checked={item.current && !isHistoricalAttempt} className="node-att-menu-item" onClick={item.select}>
                        {item.label}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
              {isHistoricalAttempt ? (
                <Button size="sm" variant="ghost" icon="refresh" onClick={backToCurrent}>
                  回到当前尝试
                </Button>
              ) : null}
            </div>
          </div>
          <IconButton icon="x" label="关闭节点面板，回到全图" onClick={onClose} />
        </div>
        <div
          className="tabs node-tabs"
          role="tablist"
          aria-label="节点页签"
          onKeyDown={(event) => {
            const key = event.key;
            if (key !== 'ArrowLeft' && key !== 'ArrowRight' && key !== 'Home' && key !== 'End') return;
            event.preventDefault();
            let nextIndex = tabOrderIndex;
            if (key === 'ArrowLeft') nextIndex = tabOrderIndex <= 0 ? TAB_ORDER.length - 1 : tabOrderIndex - 1;
            else if (key === 'ArrowRight') nextIndex = tabOrderIndex >= TAB_ORDER.length - 1 ? 0 : tabOrderIndex + 1;
            else if (key === 'Home') nextIndex = 0;
            else nextIndex = TAB_ORDER.length - 1;
            const next = TAB_ORDER[nextIndex];
            if (next === undefined) return;
            changeTab(next);
            tabRefs.current.get(next)?.focus();
          }}
        >
          {TAB_ORDER.map((id) => (
            <button
              key={id}
              ref={(element) => {
                tabRefs.current.set(id, element);
              }}
              type="button"
              role="tab"
              className="tab"
              aria-selected={tab === id}
              tabIndex={tab === id ? 0 : -1}
              aria-controls="node-tabpanel"
              onClick={() => changeTab(id)}
            >
              {TAB_LABEL[id]}
              {id === 'attempts' ? <span className="tab-n">{attemptRows.length}</span> : null}
            </button>
          ))}
        </div>
      </div>

      <div className={`side-body node-side-body${tab === 'session' ? ' node-body-session' : ''}`} id="node-tabpanel" role="tabpanel" aria-label={TAB_LABEL[tab]}>
        {detail.definitionUnavailableReason === undefined ? null : (
          <p role="status">
            <Icon name="info" size="sm" />
            {detail.definitionUnavailableReason}
          </p>
        )}

        {tab === 'overview' ? (
          <>
            {attemptRevoked ? (
              <div className="banner unknown" role="status">
                <Icon name="lock" />
                <div className="grow">
                  <b>你已无权查看这次尝试的记录</b>
                  <br />
                  内容已清除；概览只保留步骤定义，验收与推进动作不提供。
                </div>
              </div>
            ) : null}
            <p className="node-overview-note">
              <Icon name="info" size="sm" /> 验收与推进动作在当前尝试页脚可达；这里只列服务记录的事实。
            </p>
            <NodeOverview
              detail={detail}
              attempt={attemptRevoked ? undefined : selectedAttempt ?? currentAttempt}
              isHistorical={isHistoricalAttempt}
              acceptance={acceptance}
              toolCount={toolCards.length}
              onOpenPlan={onOpenPlan}
              onOpenAttempts={() => changeTab('attempts')}
              onOpenCitation={(link: RequirementLink) => {
                openReader({ kind: 'citation', link });
              }}
              onOpenArtifact={(artifact: ArtifactRef) => {
                openReader({ kind: 'artifact', artifact, attemptLabel: `${isHistoricalAttempt ? '历史' : '当前'}尝试 #${String((selectedAttempt ?? currentAttempt)?.ordinal ?? '?')}` });
              }}
            />
            {!isHistoricalAttempt && !attemptRevoked && manualAdvance !== undefined ? (
              <div>
                <div className="sec-t" style={{ marginTop: 16 }}>
                  直接后继 · 自动推进已关闭
                </div>
                {manualAdvance.rows.length === 0 ? (
                  <p className="hint">计划里没有从这一步出发的后继步骤。</p>
                ) : (
                  <div className="box">
                    {manualAdvance.rows.map((row) => {
                      const rowVisual = attemptVisual({ status: row.status ?? 'pending' });
                      return (
                        <div key={row.id} className="rowx">
                          <span className={`ic ${rowVisual.tone === 'fail' ? 'no' : rowVisual.tone === 'run' ? 'run' : rowVisual.tone === 'done' ? 'ok' : 'idle'}`}>
                            <Icon name={rowVisual.icon} size="sm" />
                          </span>
                          <span className="grow">
                            <span className="t">{row.title}</span>
                            <span className="s">{row.status === undefined ? '未执行' : rowVisual.label}</span>
                          </span>
                          {row.status === 'pending' || row.status === 'ready' ? (
                            row.blockers.length > 0 ? (
                              <Badge tone="idle" icon="clock">
                                并行汇合 · 等「{row.blockers.join('、')}」
                              </Badge>
                            ) : (
                              <Badge tone="wait" icon="play">
                                可推进
                              </Badge>
                            )
                          ) : (
                            <Badge tone={rowVisual.tone}>{rowVisual.label}</Badge>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
                <div className="row wrap" style={{ gap: 8, marginTop: 10 }}>
                  <Button variant="primary" size="sm" icon="play" disabled={manualAdvance.reason !== undefined} disabledReason={manualAdvance.reason} onClick={runAdvanceSuccessors}>
                    {pendingAction === 'advance' ? '正在推进…' : manualAdvance.targets.candidates.length > 0 ? `推进直接后继 · ${String(manualAdvance.targets.candidates.length)} 步` : '推进直接后继'}
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
          </>
        ) : null}

        {tab === 'session' ? (
          <div className="node-session">
            {lateIgnored ? (
              <p className="node-fine" role="status">
                <Icon name="info" size="sm" /> 已忽略属于上一个节点的晚到内容
              </p>
            ) : null}
            <div className="node-sess-top">
              {attemptRevoked ? (
                <div className="node-lock inline" role="status">
                  <span className="tile">
                    <Icon name="lock" size="lg" />
                  </span>
                  <h3>你已无权查看此尝试的记录</h3>
                  <p>读取时服务返回无权限。之前显示的正文、工具与结果已从这个面板清除，不保留缓存；这里没有业务动作。</p>
                </div>
              ) : (
                <>
                  <FactsBar>
                    {facts.map((fact) => (
                      <FactPill
                        key={fact.key}
                        label={fact.label}
                        value={
                          fact.busy ? (
                            <>
                              <span className="spin" aria-hidden="true" />
                              {fact.value}
                            </>
                          ) : (
                            fact.value
                          )
                        }
                        tone={pillTone(fact.tone)}
                      />
                    ))}
                  </FactsBar>
                  <p className="node-combo" role="status">
                    <Icon name="info" size="sm" />
                    <span>{combo}</span>
                  </p>
                </>
              )}
              {serviceEvents.length > 0 && !attemptRevoked ? (
                <div className="node-svc">
                  <div className="node-svc-h">
                    <span>服务事实</span>
                    <span className="hint">来源：服务快照（不是记录流顺序）</span>
                  </div>
                  {serviceEvents.map((event) => (
                    <div className={`node-sv ${event.tone}`} key={event.id}>
                      <Icon name={event.icon} size="sm" />
                      <span>
                        {event.at === undefined ? null : <span className="mono hint">{clockTime(event.at)} · </span>}
                        {event.text}
                      </span>
                    </div>
                  ))}
                </div>
              ) : null}
              {attemptRevoked ? null : (
                <p className="node-about">
                  <Icon name="info" size="sm" />
                  <span>
                    {isHistoricalAttempt ? `尝试 #${String(selectedAttempt?.ordinal ?? '?')} 的固定记录 · 按服务顺序 · 只读，不再追加` : '按服务记录顺序 · 来源：模型服务（正文）、OpenCode 工具活动、受管 MCP 结算'}。时间为服务记录时间。
                    {fragments.some((fragment) => fragment.category === 'public_reasoning_summary') ? '' : ' 本次未提供公开推理摘要。'}
                  </span>
                </p>
              )}
              {isHistoricalAttempt ? (
                <div className="hist-bar" role="status">
                  <Icon name="clock" size="sm" />
                  <span className="grow">
                    正在查看尝试 #{selectedAttempt?.ordinal ?? '?'} 的记录 · 只读，不会追加，也不触发执行。
                    {currentAttemptHasNew ? (
                      <span className="newdot">
                        <span className="dot" />当前尝试有新内容
                      </span>
                    ) : null}
                  </span>
                  <Button size="sm" variant="secondary" onClick={backToCurrent}>
                    回到当前尝试
                  </Button>
                </div>
              ) : null}
              {connectionState === 'connected' ? null : (
                <div className="banner unknown node-sess-banner" role="status">
                  <Icon name="alert" />
                  <div className="grow">
                    <b>{connectionState === 'connecting' ? '正在重新连接数据通道' : '内容可能不是最新'}</b>
                    <br />
                    {reconnectPhase === 'reading'
                      ? '正在按服务序号补读断开期间的记录；补读完成前内容可能还不是最新。'
                      : connectionState === 'connecting'
                        ? '重连成功只代表数据恢复，不代表模型仍在执行。'
                        : `已断开（截至 ${clockTime(lastReadAt)}）：断开前的记录保留并标为过时；模型是否仍在执行以服务状态为准。`}
                  </div>
                  <div className="actions">
                    <Button size="sm" variant="secondary" icon="refresh" disabled={reconnectPhase === 'reading'} disabledReason={reconnectPhase === 'reading' ? '正在补读' : undefined} onClick={() => { void runReconnect(); }}>
                      {reconnectPhase === 'reading' ? <><span className="spin" aria-hidden="true" />补读中…</> : '重新连接'}
                    </Button>
                  </div>
                </div>
              )}
              {reconnectPhase === 'failed' ? (
                <div className="banner danger" role="status">
                  <Icon name="alert" />
                  <div className="grow">重新读取失败：下面仍是断开前收到的记录，已标为过时；不会重发任何命令。</div>
                </div>
              ) : null}
              {gaps.length > 0 ? (
                <div className="banner unknown" role="status">
                  <Icon name="help" />
                  <div className="grow">已加载记录存在序号缺口：缺少 {gapText(gaps)}。可能是尚未补读或服务未保留；这里只显示已持久化内容，不补造。</div>
                </div>
              ) : null}
              {detailReadFailed ? (
                <div className="banner warn" role="status">
                  <Icon name="alert" />
                  <div className="grow">
                    <b>步骤详情刷新失败</b>
                    <br />
                    下面显示的是上次成功读取的内容，可能已过时；不会用旧内容冒充最新状态。
                  </div>
                  <div className="actions">
                    <Button size="sm" variant="secondary" icon="refresh" onClick={() => { void detailQuery.refetch(); }}>
                      重试
                    </Button>
                  </div>
                </div>
              ) : null}
              {outputReadFailed ? (
                <div className="banner warn" role="status">
                  <Icon name="alert" />
                  <div className="grow">
                    <b>执行记录刷新失败</b>
                    <br />
                    下面是上次成功读取的记录，可能已过时；已加载内容保留。
                  </div>
                  <div className="actions">
                    <Button size="sm" variant="secondary" icon="refresh" onClick={() => { void outputQuery.refetch(); }}>
                      重试
                    </Button>
                  </div>
                </div>
              ) : null}
              <div className="row wrap node-receipts">
                <CommandErrorNotice error={command.state.error} title="节点操作未完成" />
                <ReceiptNotice receipt={command.state.receipt} successMessage={actionSuccess} />
              </div>
            </div>
            <div className="node-feed-wrap">
              <div
                className="node-feed"
                ref={scrollerRef}
                role="log"
                aria-live={isHistoricalAttempt ? 'off' : 'polite'}
                aria-label="执行记录"
                tabIndex={0}
                onScroll={(event) => {
                  const element = event.currentTarget;
                  const distance = element.scrollHeight - element.scrollTop - element.clientHeight;
                  if (following && !paused && element.scrollTop < lastScrollTop.current - 2 && distance > 80) setPaused(true);
                  if (distance < 8 && (paused || newCount > 0 || dirty)) {
                    if (following) setPaused(false);
                    setNewCount(0);
                    setDirty(false);
                  }
                  lastScrollTop.current = element.scrollTop;
                }}
              >
                {attemptRevoked ? null : outputQuery.error && outputQuery.data === undefined ? (
                  <ServiceNotice error={outputQuery.error} onRetry={() => { void outputQuery.refetch(); }} />
                ) : returningToCurrent && feedItems.length === 0 ? (
                  <SkeletonText lines={6} />
                ) : feedItems.length === 0 ? (
                  <EmptyState
                    compact
                    icon="doc"
                    title="模型还没有输出正文"
                    description={
                      selectedAttempt === undefined
                        ? '这一步尚未开始执行；没有尝试记录时不预造正文，也不把“没有记录”当作完成。'
                        : `尝试 #${String(selectedAttempt.ordinal)}${selectedAttempt.startedAt === undefined ? ' 已创建' : ` 已于 ${clockTime(selectedAttempt.startedAt)} 开始`}。正文到达后会按服务顺序显示在这里；这不是错误，也不是完成。`
                    }
                  />
                ) : (
                  <NodeRecordFeed
                    items={feedItems}
                    stale={stale}
                    staleAt={lastReadAt}
                    backfilledIds={backfilledIds}
                    onOpenTool={(card: ToolCardModel) => {
                      openReader({ kind: 'tool', fragment: card.fragment, attemptId: selectedAttemptIdResolved ?? '', attemptLabel: `${isHistoricalAttempt ? '历史' : '当前'}尝试 #${String(selectedAttempt?.ordinal ?? '?')}` });
                    }}
                    onOpenCitation={(citation) => {
                      openReader({ kind: 'structured-citation', citation, attemptLabel: `${isHistoricalAttempt ? '历史' : '当前'}尝试 #${String(selectedAttempt?.ordinal ?? '?')}` });
                    }}
                  />
                )}
                {outputQuery.hasNextPage && !attemptRevoked ? (
                  <div className="node-load-more">
                    <Button disabled={outputQuery.isFetchingNextPage} disabledReason="正在读取下一段" onClick={() => { void outputQuery.fetchNextPage(); }}>
                      {outputQuery.isFetchingNextPage ? '读取中…' : '继续读取记录'}
                    </Button>
                  </div>
                ) : null}
              </div>
              {attemptRevoked || isHistoricalAttempt ? null : (
                <>
                  {newCount > 0 || dirty || (following && paused) ? (
                  <button type="button" className="node-newpill" onClick={() => {
                    setNewCount(0);
                    setDirty(false);
                    if (following) setPaused(false);
                    scrollFeedToBottom(true);
                  }}>
                    <Icon name="chevDown" size="sm" />
                    {newCount > 0 ? `有 ${String(newCount)} 条新内容 · 回到最新` : dirty ? '有新内容 · 回到最新' : '回到最新'}
                  </button>
                  ) : null}
                  <div className="node-follow">
                    <span>跟随最新</span>
                    {following && paused ? <span className="st">· 已暂停</span> : null}
                    <button
                      type="button"
                      className="switch"
                      role="switch"
                      aria-checked={following}
                      aria-label="跟随最新记录"
                      onClick={() => {
                        const next = !following;
                        setFollowing(next);
                        setPaused(false);
                        if (next) {
                          setNewCount(0);
                          setDirty(false);
                          scrollFeedToBottom(true);
                        }
                      }}
                    />
                  </div>
                </>
              )}
            </div>
          </div>
        ) : null}

        {tab === 'attempts' ? (
          attemptRevoked ? (
            <div className="node-lock inline" role="status">
              <span className="tile">
                <Icon name="lock" size="lg" />
              </span>
              <h3>你已无权查看这次尝试的记录</h3>
              <p>读取时服务返回无权限；尝试内容、结果与产物已从这个面板清除，不保留缓存，也没有业务动作。</p>
            </div>
          ) : attemptDetailAttempt !== undefined ? (
            <AttemptDetailView
              attempt={attemptDetailAttempt}
              currentAttempt={currentAttempt}
              acceptance={attemptDetailAttempt.id === currentAttempt?.id ? acceptance : undefined}
              isCurrent={attemptDetailAttempt.id === currentAttempt?.id}
              definitionReason={attemptDetailAttempt.definition === undefined ? '这次尝试未保存步骤定义；不能用当前计划代替。' : undefined}
              rows={attemptRows}
              qualityReviewConfigured={detail.node.qualityReview}
              onBack={() => setAttemptDetailId(undefined)}
              onSwitch={openAttemptDetail}
              onOpenSession={() => {
                setAttemptDetailId(undefined);
                setTab('session');
                setSelectedAttemptId(attemptDetailAttempt.id === currentAttempt?.id ? undefined : attemptDetailAttempt.id);
              }}
              onOpenArtifact={(artifact) => {
                openReader({ kind: 'artifact', artifact, attemptLabel: `${attemptDetailAttempt.id === currentAttempt?.id ? '当前' : '历史'}尝试 #${String(attemptDetailAttempt.ordinal)}` });
              }}
            />
          ) : (
            <AttemptsList
              rows={attemptRows}
              selectedAttemptId={selectedAttemptIdResolved}
              error={attemptsQuery.error}
              retrying={attemptsQuery.isFetching}
              onRetry={loadMoreAttempts}
              onSelect={openAttemptDetail}
            />
          )
        ) : null}

        {tab === 'overview' && !isHistoricalAttempt && !attemptRevoked ? (
          <div>
            <div className="sec-t" style={{ marginTop: 16 }}>
              人工验收
            </div>
            <div className="box pad">
              <div className="row wrap" style={{ gap: 8 }}>
                <Badge tone={acceptance === undefined ? 'idle' : acceptanceTone(acceptance.state)} icon={acceptance?.state === 'accepted' ? 'check' : acceptance?.state === 'rejected' ? 'undo' : 'clock'}>
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
                  <p className="node-bind">
                    <span>绑定 结果修订 {selectedAttempt?.result?.resultRevision ?? currentAttempt?.result?.resultRevision ?? '未提交'}</span>
                    <span className="hint">验收策略版本：服务未提供</span>
                  </p>
                  {acceptance.note === undefined ? null : <p className="hint" style={{ marginTop: 6 }}>备注：{acceptance.note}</p>}
                </>
              )}
              <div className="row wrap" style={{ gap: 8, marginTop: 10 }}>
                <ServiceActionButton size="sm" variant="secondary" icon="undo" action={attemptRevoked ? { allowed: false, reason: '当前没有查看权限，不提供业务动作' } : rejectAction} busy={command.state.busy} fallbackReason="服务未提供退回修改动作" onRun={() => openVerdict('reject')}>
                  退回修改
                </ServiceActionButton>
                <ServiceActionButton size="sm" variant="primary" icon="check" action={attemptRevoked ? { allowed: false, reason: '当前没有查看权限，不提供业务动作' } : acceptAction} busy={command.state.busy} fallbackReason="服务未提供验收动作" onRun={() => openVerdict('accept')}>
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
            <div className="row wrap node-receipts" style={{ marginTop: 12 }}>
              <CommandErrorNotice error={command.state.error} title="节点操作未完成" />
              <ReceiptNotice receipt={command.state.receipt} successMessage={actionSuccess} />
            </div>
          </div>
        ) : null}

        {attemptsQuery.isError ? <p className="hint">尝试列表读取失败；不会用当前尝试顶替历史。</p> : null}
      </div>

      {renderFooter()}

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
    </aside>
  );

  /** Design `footHTML`: the fixed action/status area for the *current* attempt. */
  function renderFooter(): ReactNode {
    const busy = command.state.busy;
    if (isHistoricalAttempt) {
      return (
        <div className="node-foot">
          <span className="hint grow">
            <Icon name="lock" size="sm" /> 历史记录只读，不会重跑、恢复或验收
          </span>
          <Button size="sm" variant="secondary" icon="refresh" onClick={backToCurrent}>
            回到当前尝试
          </Button>
        </div>
      );
    }
    if (attemptRevoked) {
      return (
        <div className="node-foot">
          <span className="hint grow">无权查看时不提供任何动作</span>
          <Button size="sm" variant="secondary" onClick={onClose}>
            回到全图
          </Button>
        </div>
      );
    }
    if (connectionState === 'disconnected' || reconnectPhase === 'reading') {
      return (
        <div className="node-foot">
          <span className="hint grow">
            <Icon name="alert" size="sm" /> 连接恢复并补读完成后才能操作
          </span>
          <Button size="sm" variant="secondary" icon="refresh" disabled={reconnectPhase === 'reading'} disabledReason="正在补读" onClick={() => { void runReconnect(); }}>
            {reconnectPhase === 'reading' ? '补读中…' : '重新连接'}
          </Button>
        </div>
      );
    }
    if (activeNodeStatus === 'unknown' || activeExecutionStatus === 'unknown') {
      return (
        <div className="node-foot">
          <span className="hint grow">
            <Icon name="help" size="sm" /> 结果待核对：核对完成前不能操作；这里只重新读取服务状态，不会重发停止或提交
          </span>
          <Button
            size="sm"
            variant="secondary"
            icon="refresh"
            disabled={detailQuery.isFetching}
            disabledReason={detailQuery.isFetching ? '正在重新读取' : undefined}
            onClick={() => {
              void detailQuery.refetch();
              void outputQuery.refetch();
            }}
          >
            {detailQuery.isFetching ? '读取中…' : '重新读取状态'}
          </Button>
        </div>
      );
    }
    if (activeAttempt?.status === 'failed' || acceptance?.state === 'rejected') {
      return (
        <div className="node-foot">
          <Button size="sm" variant="ghost" icon="clock" onClick={() => changeTab('attempts')}>
            查看 {String(attemptRows.length)} 次尝试
          </Button>
          <span className="grow" />
          <span className="hint">
            <Icon name="info" size="sm" /> 失败/验收未通过不会自动重试；恢复入口在任务的恢复页
          </span>
        </div>
      );
    }
    if (acceptance?.state === 'pending') {
      return (
        <div className="node-foot">
          <span className="hint grow">
            <Icon name="eye" size="sm" /> 等待你人工验收；验收通过后这一步才显示完成
          </span>
          {tab === 'overview' ? null : (
            <Button size="sm" variant="danger" icon="undo" disabled={busy || rejectAction?.allowed !== true} disabledReason={busy ? '正在提交，等待服务回执…' : rejectAction?.reason ?? '服务未提供退回修改动作'} onClick={() => openVerdict('reject')}>
              退回修改
            </Button>
          )}
          {tab === 'overview' ? null : (
            <Button size="sm" variant="primary" icon="check" disabled={busy || acceptAction?.allowed !== true} disabledReason={busy ? '正在提交，等待服务回执…' : acceptAction?.reason ?? '服务未提供验收动作'} onClick={() => openVerdict('accept')}>
              验收通过
            </Button>
          )}
        </div>
      );
    }
    if (acceptance?.state === 'accepted') {
      return (
        <div className="node-foot">
          <span className="hint grow">
            <Icon name="check" size="sm" /> 执行与人工验收都已结束
          </span>
          <Button size="sm" variant="secondary" icon="eye" onClick={() => changeTab('attempts')}>
            查看产出
          </Button>
        </div>
      );
    }
    if (activeAttempt?.status === 'cancelled') {
      return (
        <div className="node-foot">
          <span className="hint grow">
            <Icon name="stop" size="sm" /> 这一步已停止，已产生的记录保留；恢复入口在任务的恢复页
          </span>
          <Button size="sm" variant="secondary" icon="clock" onClick={() => changeTab('attempts')}>
            查看尝试
          </Button>
        </div>
      );
    }
    if (activeAttempt?.status === 'running' && activeExecutionStatus === 'stopping') {
      return (
        <div className="node-foot">
          <span className="hint grow">
            <Icon name="clock" size="sm" /> 等待执行器确认停止，期间不能再次停止或恢复
          </span>
        </div>
      );
    }
    if (activeAttempt?.status === 'running') {
      return (
        <div className="node-foot">
          <span className="hint grow">
            <Icon name="lock" size="sm" /> 查看记录不会启动、暂停或改变执行
          </span>
          {tab === 'session' ? null : (
            <Button size="sm" variant="secondary" icon="terminal" onClick={() => changeTab('session')}>
              查看执行现场
            </Button>
          )}
        </div>
      );
    }
    if (terminal && selectedAttempt?.result === undefined) {
      return (
        <div className="node-foot">
          <span className="hint grow">
            <Icon name="clock" size="sm" /> 等待结果提交 · 传输结束不等于完成
          </span>
        </div>
      );
    }
    if (selectedAttempt?.result !== undefined) {
      return (
        <div className="node-foot">
          <span className="hint grow">
            <Icon name="eye" size="sm" /> 等待验收；验收通过后这一步才显示完成
          </span>
          <Button size="sm" variant="secondary" icon="eye" onClick={() => changeTab('attempts')}>
            查看产出
          </Button>
        </div>
      );
    }
    return (
      <div className="node-foot">
        <span className="hint grow">
          <Icon name="info" size="sm" /> 只显示服务记录的事实；没有记录不代表完成
        </span>
      </div>
    );
  }
}
