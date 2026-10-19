import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  type DeliveryStepState,
  type FileChange,
  type FixRun,
  type GitBranch,
  type GitCommit,
  type GitRepo,
  type ReviewRun,
} from '@agent-workflow/shared';
import {
  classifyGitFailure,
  commitFix,
  mergeFix,
  createFixMergeRequest,
  discardFix,
  fetchFix,
  fetchOperationByKey,
  fetchReview,
  gitKeys,
  pushFix,
  revertFixFile,
  startFix,
  stopFix,
  toReceiptView,
  type ReceiptView,
} from '../../api/git.ts';
import { useBootstrap } from '../../api/hooks.ts';
import { Badge } from '../../components/Badge.tsx';
import { Button } from '../../components/Button.tsx';
import { EmptyState, Skeleton } from '../../components/EmptyState.tsx';
import { Icon } from '../../components/Icon.tsx';
import { Modal } from '../../components/Modal.tsx';
import {
  CHANGE_STATUS_LABEL,
  CHANGE_STATUS_TONE,
  FailureNotice,
  OperationLookupResult,
  ReadOnlyHint,
  ReceiptBanner,
  actionReasonText,
  countDelta,
  deliveryStepStateTone,
  fixLabel,
  fixOutcomeLabel,
  fixOutcomeTone,
  fixStateTone,
  shortSha,
} from './git-shared.tsx';

type FixDialog = 'start' | 'commit' | 'push' | 'mr' | 'merge' | 'discard' | null;

function shouldRetry(failureCount: number, error: unknown): boolean {
  return classifyGitFailure(error) === 'failed' && failureCount < 2;
}

function stepOf(fix: FixRun, step: DeliveryStepState['step']): DeliveryStepState | undefined {
  return fix.steps.find((item) => item.step === step);
}

function relocationLabel(relocation: 'exact' | 'moved' | 'not_found'): string {
  switch (relocation) {
    case 'exact':
      return '位置一致';
    case 'moved':
      return '位置已移动';
    case 'not_found':
      return '找不到原位置';
  }
}

function verificationText(fix: FixRun): string {
  const verification = fix.verification;
  if (verification === undefined) return '服务尚未返回校验结果。';
  switch (verification.state) {
    case 'passed':
      return `校验通过${verification.passed === undefined ? '' : ` · 通过 ${String(verification.passed)}`}${verification.summary === undefined ? '' : ` · ${verification.summary}`}`;
    case 'failed':
      return `校验未通过${verification.passed === undefined ? '' : ` · 通过 ${String(verification.passed)}`}${verification.failed === undefined ? '' : ` · 失败 ${String(verification.failed)}`}${verification.summary === undefined ? '' : ` · ${verification.summary}`}`;
    case 'not_configured':
      return '项目没有配置校验命令（不是失败）。';
    default:
      return verification.summary ?? '校验过程出现错误，详见服务记录。';
  }
}

export interface FixPanelProps {
  readonly projectId: string;
  readonly repo: GitRepo;
  readonly commit: GitCommit;
  readonly reviewRunId: string | undefined;
  readonly selectedFindingIds: ReadonlySet<string>;
  readonly branches: readonly GitBranch[];
  readonly onOpenDiff: (file: FileChange, fixRunId: string) => void;
  readonly onClearSelection: () => void;
}

/**
 * AI 修复页签：确认 → 隔离副本修复 → 逐问题结果 → 提交 / 推送 / 创建 MR 三步，
 * 每步独立确认（split 不自动连锁）；UNKNOWN 只核对原操作。
 */
export function FixPanel({
  projectId,
  repo,
  commit,
  reviewRunId,
  selectedFindingIds,
  branches,
  onOpenDiff,
  onClearSelection,
}: FixPanelProps) {
  const queryClient = useQueryClient();
  const bootstrap = useBootstrap();
  const [dialog, setDialog] = useState<FixDialog>(null);
  const [mergeMessage, setMergeMessage] = useState('');
  const [receipt, setReceipt] = useState<ReceiptView | null>(null);
  const [lookupKey, setLookupKey] = useState<string | null>(null);
  const [fixRunId, setFixRunId] = useState<string | undefined>(undefined);
  const [discardedFixRunId, setDiscardedFixRunId] = useState<string | null>(null);
  const [commitMessage, setCommitMessage] = useState('');
  const [commitFileIds, setCommitFileIds] = useState<ReadonlySet<string>>(new Set());
  const [verifyAck, setVerifyAck] = useState(false);
  const [continueToPush, setContinueToPush] = useState(false);
  const [mrTitle, setMrTitle] = useState('');
  const [mrDescription, setMrDescription] = useState('');
  const [mrTarget, setMrTarget] = useState('');
  const [professionId, setProfessionId] = useState('');
  const [professionRevision, setProfessionRevision] = useState('');

  const reviewQuery = useQuery({
    queryKey: gitKeys.review(projectId, reviewRunId ?? ''),
    queryFn: () => fetchReview(projectId, reviewRunId ?? ''),
    enabled: reviewRunId !== undefined,
    retry: shouldRetry,
  });
  const review: ReviewRun | undefined = reviewQuery.data;

  const existingFixRunId = useMemo(() => {
    for (const finding of review?.findings ?? []) {
      if (finding.fix !== undefined) return finding.fix.fixRunId;
    }
    return undefined;
  }, [review]);

  const activeFixRunId = fixRunId ?? (existingFixRunId === discardedFixRunId ? undefined : existingFixRunId);
  const fixQuery = useQuery({
    queryKey: gitKeys.fix(projectId, activeFixRunId ?? ''),
    queryFn: () => fetchFix(projectId, activeFixRunId ?? ''),
    enabled: activeFixRunId !== undefined,
    retry: shouldRetry,
    refetchInterval: (query) => {
      const state = (query.state.data as FixRun | undefined)?.state;
      return state === 'preparing' || state === 'editing' || state === 'verifying' || state === 'stopping' ? 3_000 : false;
    },
  });
  const fix = fixQuery.data;

  const lookupQuery = useQuery({
    queryKey: gitKeys.operation(lookupKey ?? ''),
    queryFn: () => fetchOperationByKey(lookupKey ?? ''),
    enabled: lookupKey !== null,
    retry: false,
  });

  const selectedFindings = useMemo(
    () => (review?.findings ?? []).filter((finding) => selectedFindingIds.has(finding.findingId)),
    [review, selectedFindingIds],
  );
  const fixableFindings = selectedFindings.filter((finding) => finding.status === 'open' || finding.status === 'accepted');

  const roles = bootstrap.data?.catalog.roles ?? [];
  const professionOptions = useMemo(() => {
    const options = roles.map((role) => ({ id: role.id, revision: role.revision, name: role.name }));
    if (review !== undefined && !options.some((option) => option.id === review.profession.professionId)) {
      options.unshift({
        id: review.profession.professionId,
        revision: review.profession.revision,
        name: review.profession.displayName,
      });
    }
    return options;
  }, [roles, review]);

  const baseBranch = repo.status?.head.kind === 'branch' ? repo.status.head.branch : repo.defaultBranch;
  const baseTip = repo.status?.head.kind === 'branch' ? repo.status.head.sha : undefined;

  useEffect(() => {
    if (professionId.length > 0 && professionOptions.some((option) => option.id === professionId)) return;
    const preferred = professionOptions[0];
    if (preferred !== undefined) {
      setProfessionId(preferred.id);
      setProfessionRevision(preferred.revision);
    }
  }, [professionId, professionOptions]);

  const invalidateFix = async () => {
    if (activeFixRunId !== undefined) {
      await queryClient.invalidateQueries({ queryKey: gitKeys.fix(projectId, activeFixRunId) });
    }
    if (reviewRunId !== undefined) {
      await queryClient.invalidateQueries({ queryKey: gitKeys.review(projectId, reviewRunId) });
    }
  };

  const startMutation = useMutation({
    mutationFn: () =>
      startFix({
        projectId,
        reviewRunId: reviewRunId ?? '',
        findingIds: fixableFindings.map((finding) => finding.findingId),
        baseBranch: baseBranch ?? '',
        expectedBaseTip: baseTip ?? '',
        professionId,
        professionRevision,
      }),
    retry: false,
    onSuccess: (data) => {
      const view = toReceiptView(data.receipt);
      setReceipt(view);
      const created = data.resource?.fix;
      if (created !== undefined && view.status !== 'unknown' && view.status !== 'failed') {
        setFixRunId(created.fixRunId);
        setDialog(null);
      }
    },
  });

  const stopMutation = useMutation({
    mutationFn: () => stopFix(projectId, activeFixRunId ?? ''),
    retry: false,
    onSuccess: (data) => {
      setReceipt(toReceiptView(data.receipt));
      void invalidateFix();
    },
  });

  const commitMutation = useMutation({
    mutationFn: () =>
      commitFix({
        projectId,
        fixRunId: activeFixRunId ?? '',
        message: commitMessage,
        fileIds: [...commitFileIds],
        expectedFixRevision: fix?.fixRevision ?? '',
        ...(fix?.verification?.state === 'failed' && verifyAck ? { confirmVerifyFailed: true } : {}),
      }),
    retry: false,
    onSuccess: (data) => {
      const view = toReceiptView(data.receipt);
      setReceipt(view);
      if (view.status !== 'unknown' && view.status !== 'failed') {
        setDialog(null);
        if (continueToPush) {
          setContinueToPush(false);
          // 推送仍需单独确认：提交回执成功后才打开推送确认框，不自动发送。
          window.setTimeout(() => { setDialog('push'); }, 250);
        }
      }
      void invalidateFix();
    },
  });

  const pushMutation = useMutation({
    mutationFn: () => {
      const commitStep = fix === undefined ? undefined : stepOf(fix, 'commit');
      return pushFix(projectId, activeFixRunId ?? '', commitStep?.commitSha ?? '');
    },
    retry: false,
    onSuccess: (data) => {
      setReceipt(toReceiptView(data.receipt));
      setDialog(null);
      void invalidateFix();
    },
  });

  const mrMutation = useMutation({
    mutationFn: () =>
      createFixMergeRequest({
        projectId,
        fixRunId: activeFixRunId ?? '',
        targetBranch: mrTarget,
        title: mrTitle,
        description: mrDescription,
      }),
    retry: false,
    onSuccess: (data) => {
      setReceipt(toReceiptView(data.receipt));
      setDialog(null);
      void invalidateFix();
    },
  });

  const revertMutation = useMutation({
    mutationFn: (fileId: string) =>
      revertFixFile(projectId, activeFixRunId ?? '', fileId, fix?.fixRevision ?? ''),
    retry: false,
    onSuccess: (data) => {
      setReceipt(toReceiptView(data.receipt));
      void invalidateFix();
    },
  });

  const discardMutation = useMutation({
    mutationFn: () => discardFix(projectId, activeFixRunId ?? ''),
    retry: false,
    onSuccess: (data) => {
      setReceipt(toReceiptView(data.receipt));
      setDiscardedFixRunId(activeFixRunId ?? null);
      setFixRunId(undefined);
      setDialog(null);
      onClearSelection();
      void invalidateFix();
    },
  });

  const openCommitDialog = () => {
    if (fix === undefined) return;
    const files = fix.changes?.files ?? [];
    setCommitMessage(fix.commitDraft?.message ?? '');
    setCommitFileIds(new Set(files.map((file) => file.fileId)));
    setVerifyAck(false);
    setContinueToPush(false);
    setDialog('commit');
  };

  const openPushDialog = () => {
    setDialog('push');
  };

  const mergeMutation = useMutation({
    mutationFn: async () => {
      if (fix === undefined || mergeBaseTip === undefined) throw new Error('没有读取到基线分支 tip');
      return mergeFix({
        projectId: repo.projectId,
        fixRunId: fix.fixRunId,
        expectedBaseTip: mergeBaseTip,
        ...(mergeMessage.trim() === '' ? {} : { message: mergeMessage.trim() }),
      });
    },
    onSuccess: async (result) => {
      setReceipt(result.receipt ?? null);
      setDialog(null);
      await invalidateFix();
    },
  });

  const openMrDialog = () => {
    const target = repo.defaultBranch ?? branches[0]?.name ?? '';
    setMrTarget(target);
    setMrTitle(fix?.commitDraft?.message.split('\n')[0] ?? `修复审查问题（${shortSha(commit.sha)}）`);
    setMrDescription('');
    setDialog('mr');
  };

  const targetTip = branches.find((branch) => branch.name === mrTarget && branch.kind === 'local')?.tipSha
    ?? branches.find((branch) => branch.name === mrTarget)?.tipSha;

  const commitStep = fix === undefined ? undefined : stepOf(fix, 'commit');
  const pushStep = fix === undefined ? undefined : stepOf(fix, 'push');
  const mrStep = fix === undefined ? undefined : stepOf(fix, 'mergeRequest');
  const mergeStep = fix === undefined ? undefined : stepOf(fix, 'merge');
  const mergeBaseTip = fix === undefined ? undefined : branches.find((branch) => branch.name === fix.base.branch && branch.kind === 'local')?.tipSha ?? branches.find((branch) => branch.name === fix.base.branch)?.tipSha;
  const gitlabReady = repo.gitlab === 'connected' && repo.remote !== undefined;

  const startBlockedReason =
    review === undefined
      ? '审查结果还没有读到，不能开始修复。'
      : reviewRunId === undefined
        ? '请先为这个提交完成一次 AI 审查。'
        : selectedFindingIds.size === 0
          ? '先在「AI 审查」页签勾选要修复的问题。'
          : fixableFindings.length !== selectedFindings.length
            ? '已选问题里有被忽略或误报的项；它们不能进入修复，请取消勾选。'
            : baseBranch === undefined || baseTip === undefined
              ? '服务没有返回当前分支与 tip，无法安全确认修复基线。'
              : professionId.length === 0
                ? '没有可用的修复职业。'
                : null;

  const verification = fix?.verification;
  const verifyFailed = verification?.state === 'failed';
  const commitBlockedReason =
    commitMessage.trim().length === 0
      ? '提交信息不能为空。'
      : commitFileIds.size === 0
        ? '至少勾选一个要提交的文件。'
        : verifyFailed && !verifyAck
          ? '校验未通过：需要勾选“我已了解校验未通过”后才能提交。'
          : null;

  if (reviewQuery.isPending) {
    return (
      <div className="stack-tight">
        <Skeleton height={14} />
        <Skeleton width="70%" height={12} />
      </div>
    );
  }

  if (reviewQuery.isError) {
    return <FailureNotice error={reviewQuery.error} onRetry={() => { void reviewQuery.refetch(); }} />;
  }

  if (reviewRunId === undefined || review === undefined) {
    return (
      <EmptyState
        icon="wand"
        title="先完成审查，才能修复"
        description="AI 修复以审查问题为输入，在隔离的修复分支中进行。没有审查问题时不会创建修复任务。"
      />
    );
  }

  return (
    <div className="stack-loose">
      <ReadOnlyHint>
        修复只写服务私有的修复副本与新分支，不改动你当前的工作区；提交、推送、创建合并请求只能由你逐步确认。
      </ReadOnlyHint>

      {receipt === null ? null : (
        <ReceiptBanner
          receipt={receipt}
          verifying={lookupQuery.isFetching}
          onVerify={(key) => { setLookupKey(key); }}
          onDismiss={() => { setReceipt(null); }}
        />
      )}
      {lookupKey === null ? null : lookupQuery.isPending ? (
        <div className="banner info"><Icon name="clock" /><div className="grow">正在核对原操作…</div></div>
      ) : lookupQuery.isError ? (
        <FailureNotice error={lookupQuery.error} compact />
      ) : lookupQuery.data === undefined ? null : (
        <OperationLookupResult operation={lookupQuery.data.operation} stillUnknown={lookupQuery.data.stillUnknown} />
      )}

      {fixQuery.isError && activeFixRunId !== undefined ? (
        <FailureNotice error={fixQuery.error} onRetry={() => { void fixQuery.refetch(); }} />
      ) : null}

      {fix === undefined ? (
        <div className="fix-step">
          <div className="fix-step-head">
            <Icon name="wand" />
            <span className="fix-step-title">开始 AI 修复</span>
            <Badge tone="neutral">{String(fixableFindings.length)} 个问题</Badge>
          </div>
          <div className="fix-step-desc">
            修复在服务私有副本中进行：会创建新的修复分支 <span className="mono">ai-fix/&lt;sha&gt;-&lt;日期&gt;</span>
            （名称由服务生成），基于 <span className="mono">{baseBranch ?? '未知分支'} @ {baseTip === undefined ? '未知' : shortSha(baseTip)}</span>
            的最新提交，而不是审查提交 <span className="mono">{shortSha(commit.sha)}</span>。问题位置可能移动，结果会逐条标出。
          </div>
          {selectedFindings.length === 0 ? (
            <span className="action-reason"><Icon name="lock" size="sm" />没有选中的问题；先回到「AI 审查」页签勾选。</span>
          ) : (
            <div className="stack-tight">
              {selectedFindings.map((finding) => (
                <span key={finding.findingId} className="fix-outcome-row">
                  <Badge tone="neutral">{finding.severity}</Badge>
                  <span className="grow">{finding.title}</span>
                </span>
              ))}
            </div>
          )}
          <div className="fix-step-actions">
            <Button variant="primary" icon="wand" disabled={startBlockedReason !== null || startMutation.isPending} disabledReason={startBlockedReason ?? undefined} onClick={() => { setDialog('start'); }}>
              开始 AI 修复
            </Button>
            {startBlockedReason === null ? null : <span className="action-reason"><Icon name="lock" size="sm" />{startBlockedReason}</span>}
          </div>
          {startMutation.isError ? <FailureNotice error={startMutation.error} compact /> : null}
        </div>
      ) : (
        <>
          <div className="row-wrap">
            <Badge tone={fixStateTone(fix.state)} icon={fix.state === 'ready' ? 'check' : fix.state === 'failed' ? 'alert' : 'wand'}>
              {fixLabel(fix.state)}
            </Badge>
            <span className="muted-note">
              修复分支 <span className="mono">{fix.fixBranch}</span> · 基于 {fix.base.branch} @ {shortSha(fix.base.tipSha)} · 审查提交 {shortSha(fix.base.reviewedSha)}
              {fix.base.commitsAfterReviewed === 0 ? '（位置无漂移）' : `（审查后已有 ${String(fix.base.commitsAfterReviewed)} 个提交）`}
            </span>
            <span className="grow" />
            {fix.state === 'preparing' || fix.state === 'editing' || fix.state === 'verifying' || fix.state === 'stopping' ? (
              <Button variant="secondary" size="sm" icon="stop" disabled={stopMutation.isPending || fix.state === 'stopping'} disabledReason={fix.state === 'stopping' ? '正在停止；停止请求不等于已停止。' : undefined} onClick={() => { stopMutation.mutate(); }}>
                停止修复
              </Button>
            ) : null}
            <Button variant="ghost" size="sm" icon="refresh" onClick={() => { void fixQuery.refetch(); }}>
              重新读取
            </Button>
          </div>

          {fix.state === 'unknown' ? (
            <div className="banner unknown">
              <Icon name="help" />
              <div className="grow">
                <b>修复结果待核对</b>
                <br />
                保持原记录，只核对原操作；不会创建第二个修复副本。
                {fix.steps.filter((step) => step.state === 'unknown' && step.requestKey !== undefined).map((step) => (
                  <Button key={step.requestKey} variant="secondary" size="sm" icon="search" onClick={() => { setLookupKey(step.requestKey ?? null); }}>
                    核对 {step.step}
                  </Button>
                ))}
              </div>
            </div>
          ) : null}

          <div className={`fix-verification ${verification?.state ?? 'not_configured'}`}>
            <Icon name={verification?.state === 'passed' ? 'check' : verification?.state === 'failed' ? 'alert' : 'info'} />
            <span>
              {verificationText(fix)}
              {verification?.logArtifactId === undefined ? null : <span className="log">校验日志引用：{verification.logArtifactId}</span>}
            </span>
          </div>

          <div className="section-title-row">
            <h3>问题对照</h3>
            <span className="eyebrow">{String(fix.outcomes.length)} 项</span>
          </div>
          <div className="fix-outcome-list">
            {fix.outcomes.length === 0 ? <span className="muted-note">服务还没有返回逐问题结果。</span> : null}
            {fix.outcomes.map((outcome) => {
              const finding = review.findings.find((item) => item.findingId === outcome.findingId);
              return (
                <div key={outcome.findingId} className="fix-outcome-row">
                  <Badge tone={fixOutcomeTone(outcome.outcome)} icon={outcome.outcome === 'fixed' ? 'check' : outcome.outcome === 'partial' ? 'alert' : 'x'}>
                    {fixOutcomeLabel(outcome.outcome)}
                  </Badge>
                  <span className="grow">
                    {finding?.title ?? `问题 ${outcome.findingId}`}
                    <span className="reason">位置：{relocationLabel(outcome.relocation)}{outcome.reason === undefined ? '' : ` · ${outcome.reason}`}</span>
                  </span>
                </div>
              );
            })}
          </div>

          <div className="section-title-row">
            <h3>修复改动</h3>
            <span className="eyebrow">{fix.changes === undefined ? '服务未返回变更' : `${String(fix.changes.files.length)} 个文件`}</span>
          </div>
          {fix.changes === undefined || fix.changes.files.length === 0 ? (
            <span className="muted-note">
              {fix.state === 'no_changes' ? 'AI 认为无需修改：没有可提交的内容，可以放弃修复或回到问题列表调整。' : '服务还没有返回修复改动。'}
            </span>
          ) : (
            <div className="fix-changes">
              {fix.changes.files.map((file) => {
                const revertAction = fix.actions['revertFile'];
                const revertAllowed = revertAction === undefined ? fix.state === 'ready' : revertAction.allowed;
                return (
                  <div key={file.fileId} className="fix-change-row">
                    <Badge tone={CHANGE_STATUS_TONE[file.status]}>{CHANGE_STATUS_LABEL[file.status]}</Badge>
                    <span className="path">{file.path}</span>
                    <span className="mono-sm">{countDelta(file.additions, file.deletions)}</span>
                    <span className="spacer" />
                    <Button variant="ghost" size="sm" icon="eye" onClick={() => { onOpenDiff(file, fix.fixRunId); }}>
                      查看 diff
                    </Button>
                    <Button variant="ghost" size="sm" icon="undo" disabled={!revertAllowed || revertMutation.isPending} disabledReason={revertAllowed ? undefined : actionReasonText(revertAction, '当前状态不允许撤销文件。')} onClick={() => { revertMutation.mutate(file.fileId); }}>
                      撤销此文件
                    </Button>
                  </div>
                );
              })}
            </div>
          )}

          <div className="section-title-row">
            <h3>下一步</h3>
            <span className="eyebrow">三步独立确认 · 不会自动连锁</span>
          </div>
          <div className="fix-next-steps">
            <div className={`fix-step ${fix.state === 'ready' || commitStep?.state === 'succeeded' ? '' : 'locked'}`}>
              <div className="fix-step-head">
                <Badge tone={commitStep === undefined ? 'neutral' : deliveryStepStateTone(commitStep.state)}>
                  {commitStep === undefined ? '未开始' : commitStep.state === 'succeeded' ? '已提交' : commitStep.state}
                </Badge>
                <span className="fix-step-title">① 提交修复</span>
                {commitStep?.commitSha === undefined ? null : <span className="mono-sm">{commitStep.commitSha}</span>}
              </div>
              <div className="fix-step-desc">
                作者取自设置 → Git 账号，不可在此修改；提交信息可编辑，可只勾选部分文件。提交完成只记一步，不会自动推送。
              </div>
              <div className="fix-step-actions">
                <Button
                  variant="secondary"
                  size="sm"
                  icon="check"
                  disabled={fix.state !== 'ready' || (fix.changes?.files.length ?? 0) === 0 || commitStep?.state === 'succeeded'}
                  disabledReason={
                    fix.state !== 'ready' ? '修复尚未就绪（或没有改动），不能提交。'
                      : commitStep?.state === 'succeeded' ? '已提交；下一步是推送。'
                        : '修复改动为空，没有可提交的内容。'
                  }
                  onClick={openCommitDialog}
                >
                  {commitStep?.state === 'succeeded' ? '已提交' : '提交修复'}
                </Button>
                {commitStep?.state === 'succeeded' ? null : <span className="muted-note">可先提交，稍后单独确认推送。</span>}
              </div>
            </div>

            <div className={`fix-step ${commitStep?.state === 'succeeded' ? '' : 'locked'}`}>
              <div className="fix-step-head">
                <Badge tone={pushStep === undefined ? 'neutral' : commitStep?.state === 'succeeded' ? 'accent' : 'neutral'}>
                  {pushStep?.state === 'succeeded' ? '已推送' : pushStep?.state === 'unknown' ? '待核对' : commitStep?.state === 'succeeded' ? '可确认' : '未开始'}
                </Badge>
                <span className="fix-step-title">② 推送修复</span>
                {pushStep?.remoteRef === undefined ? null : <span className="mono-sm">{pushStep.remoteRef}</span>}
              </div>
              <div className="fix-step-desc">
                推到远端同名新分支（<span className="mono">{fix.fixBranch}</span>），永不强推；需要 GitLab 已配置。推送和创建 MR 是两次独立命令。
              </div>
              <div className="fix-step-actions">
                <Button
                  variant="secondary"
                  size="sm"
                  icon="upload"
                  disabled={commitStep?.state !== 'succeeded' || pushStep?.state === 'succeeded' || !gitlabReady || pushMutation.isPending}
                  disabledReason={
                    commitStep?.state !== 'succeeded' ? '提交成功后才能推送。'
                      : pushStep?.state === 'succeeded' ? '已推送；下一步是创建合并请求。'
                        : !gitlabReady ? 'GitLab 未连接或仓库没有远端，推送不可用；到设置 → GitLab 配置连接。'
                          : undefined
                  }
                  onClick={openPushDialog}
                >
                  {pushStep?.state === 'succeeded' ? '已推送' : '推送修复'}
                </Button>
                {pushStep?.state === 'succeeded' ? null : <span className="muted-note">推送只创建新远端分支；远端同名即停止，不覆盖。</span>}
              </div>
            </div>

            <div className={`fix-step ${pushStep?.state === 'succeeded' ? '' : 'locked'}`}>
              <div className="fix-step-head">
                <Badge tone={mrStep?.state === 'succeeded' ? 'ok' : pushStep?.state === 'succeeded' ? 'accent' : 'neutral'}>
                  {mrStep?.state === 'succeeded' ? '已创建' : pushStep?.state === 'succeeded' ? '可确认' : '未开始'}
                </Badge>
                <span className="fix-step-title">③ 创建合并请求</span>
                {mrStep?.mrIid === undefined ? null : <span className="mono-sm">!{String(mrStep.mrIid)}</span>}
              </div>
              <div className="fix-step-desc">
                在 GitLab 创建 MR；创建成功只代表所选交付完成，不等待合并。产品内不提供直接合并。
              </div>
              <div className="fix-step-actions">
                <Button
                  variant="secondary"
                  size="sm"
                  icon="gitRepo"
                  disabled={pushStep?.state !== 'succeeded' || mrStep?.state === 'succeeded' || !gitlabReady || mrMutation.isPending}
                  disabledReason={
                    pushStep?.state !== 'succeeded' ? '推送成功后才能创建合并请求。'
                      : mrStep?.state === 'succeeded' ? '已创建合并请求。'
                        : !gitlabReady ? 'GitLab 未连接，无法创建合并请求。'
                          : undefined
                  }
                  onClick={openMrDialog}
                >
                  {mrStep?.state === 'succeeded' ? '已创建' : '创建合并请求'}
                </Button>
                {mrStep?.mrWebUrl === undefined ? null : (
                  <a className="btn ghost sm" href={mrStep.mrWebUrl} target="_blank" rel="noreferrer noopener">
                    <Icon name="external" size="sm" />
                    在 GitLab 打开
                  </a>
                )}
              </div>
            </div>

            <div className={`fix-step ${commitStep?.state === 'succeeded' ? '' : 'locked'}`}>
              <div className="fix-step-head">
                <Badge tone={mergeStep?.state === 'succeeded' ? 'ok' : commitStep?.state === 'succeeded' ? 'accent' : 'neutral'}>
                  {mergeStep?.state === 'succeeded' ? '已合并' : commitStep?.state === 'succeeded' ? '可确认' : '未开始'}
                </Badge>
                <span className="fix-step-title">④ 合并回基线分支</span>
                {mergeStep?.commitSha === undefined ? null : <span className="mono-sm">{shortSha(mergeStep.commitSha)}</span>}
              </div>
              <div className="fix-step-desc">
                在本地仓库把修复分支合并回 <span className="mono">{fix.base.branch}</span>（no-ff + 目标分支 CAS）；不代替推送/MR，可独立选择。
              </div>
              <div className="fix-step-actions">
                <Button
                  variant="secondary"
                  size="sm"
                  icon="branch"
                  disabled={commitStep?.state !== 'succeeded' || mergeStep?.state === 'succeeded' || mergeBaseTip === undefined || mergeMutation.isPending}
                  disabledReason={
                    commitStep?.state !== 'succeeded' ? '提交成功后才能合并。'
                      : mergeStep?.state === 'succeeded' ? '修复分支已合并。'
                        : mergeBaseTip === undefined ? '没有读取到目标分支当前 tip；刷新分支后再确认。'
                          : undefined
                  }
                  onClick={() => { setDialog('merge'); }}
                >
                  {mergeStep?.state === 'succeeded' ? '已合并' : '合并修复分支'}
                </Button>
                {mergeStep?.state === 'succeeded' ? null : <span className="muted-note">合并前会再次读取目标分支 tip；漂移即停止。</span>}
              </div>
            </div>
          </div>

          <div className="row-wrap">
            <span className="grow" />
            <Button variant="danger" size="sm" icon="trash" disabled={discardMutation.isPending || fix.state === 'preparing' || fix.state === 'editing' || fix.state === 'verifying'} disabledReason={fix.state === 'preparing' || fix.state === 'editing' || fix.state === 'verifying' ? '修复进行中不能放弃；先停止并等停稳。' : undefined} onClick={() => { setDialog('discard'); }}>
              放弃修复
            </Button>
          </div>
          {startMutation.isError || commitMutation.isError || pushMutation.isError || mrMutation.isError || mergeMutation.isError || revertMutation.isError || discardMutation.isError || stopMutation.isError ? (
            <FailureNotice
              error={
                startMutation.error ?? commitMutation.error ?? pushMutation.error ?? mrMutation.error ?? mergeMutation.error ??
                revertMutation.error ?? discardMutation.error ?? stopMutation.error
              }
              compact
            />
          ) : null}
        </>
      )}

      {/* 开始修复确认 */}
      <Modal
        open={dialog === 'start'}
        title="开始 AI 修复？"
        onClose={() => { setDialog(null); }}
        footer={
          <>
            <Button variant="ghost" onClick={() => { setDialog(null); }}>取消</Button>
            <span className="spacer" />
            <Button variant="primary" icon="wand" disabled={startBlockedReason !== null || startMutation.isPending} disabledReason={startBlockedReason ?? undefined} onClick={() => { startMutation.mutate(); }}>
              {startMutation.isPending ? '提交中…' : '确认开始修复'}
            </Button>
          </>
        }
      >
        <div className="fix-confirm-facts">
          <div className="fix-fact">
            <span className="num">1</span>
            <span>
              修复在<b>新的修复分支</b>上，基于 <b>{baseBranch ?? '未知分支'} @ {baseTip === undefined ? '未知' : shortSha(baseTip)}</b> 的最新提交；
              审查针对的是 {shortSha(commit.sha)}，问题位置可能已移动。
            </span>
          </div>
          <div className="fix-fact">
            <span className="num">2</span>
            <span><b>不改动你当前的工作区</b>：修复只写服务私有的修复副本，不切换、不提交你检出的分支。</span>
          </div>
          <div className="fix-fact">
            <span className="num">3</span>
            <span>
              修理由
              <select
                className="select"
                style={{ height: 30, width: 'auto', display: 'inline-block', margin: '0 4px' }}
                value={professionId}
                onChange={(event) => {
                  const option = professionOptions.find((item) => item.id === event.target.value);
                  setProfessionId(option?.id ?? '');
                  setProfessionRevision(option?.revision ?? '');
                }}
              >
                {professionOptions.map((option) => (
                  <option key={option.id} value={option.id}>{option.name} · 修订 {option.revision}</option>
                ))}
              </select>
              执行；项目配置了校验命令时会自动校验，未配置时显示「未配置」而不是失败。
            </span>
          </div>
        </div>
        <div className="dialog-facts" style={{ marginTop: 12 }}>
          <div className="row-line"><span className="k">已选问题</span><span className="v">{String(fixableFindings.length)} 个（忽略 / 误报不能进入修复）</span></div>
          <div className="row-line"><span className="k">修复分支</span><span className="v"><span className="mono">ai-fix/&lt;sha&gt;-&lt;日期&gt;</span>（服务生成，确认后返回真实名称）</span></div>
        </div>
        {startMutation.isError ? <FailureNotice error={startMutation.error} compact /> : null}
      </Modal>

      {/* 提交修复确认 */}
      <Modal
        open={dialog === 'commit'}
        title="提交修复"
        onClose={() => { setDialog(null); }}
        footer={
          <>
            <Button variant="ghost" onClick={() => { setDialog(null); }}>取消</Button>
            <span className="spacer" />
            <Button variant="secondary" icon="upload" disabled={commitBlockedReason !== null || commitMutation.isPending} disabledReason={commitBlockedReason ?? undefined} onClick={() => { setContinueToPush(false); commitMutation.mutate(); }}>
              只提交
            </Button>
            <Button variant="primary" icon="check" disabled={commitBlockedReason !== null || commitMutation.isPending} disabledReason={commitBlockedReason ?? undefined} onClick={() => { setContinueToPush(true); commitMutation.mutate(); }}>
              提交（完成后确认推送）
            </Button>
          </>
        }
      >
        <div className="stack-loose">
          {fix === undefined ? null : (
            <div className="dialog-facts">
              <div className="row-line"><span className="k">目标分支</span><span className="v mono">{fix.fixBranch}</span></div>
              <div className="row-line"><span className="k">文件</span><span className="v">{String(commitFileIds.size)} / {String(fix.changes?.files.length ?? 0)} 个</span></div>
              <div className="row-line"><span className="k">作者</span><span className="v">取自设置 → Git 账号（不可在此修改）</span></div>
              <div className="row-line"><span className="k">校验</span><span className="v">{verificationText(fix)}</span></div>
            </div>
          )}
          <label className="form-label">
            提交信息 <span className="req">*</span>
            <textarea className="textarea" value={commitMessage} onChange={(event) => { setCommitMessage(event.target.value); }} placeholder="写清这次修复做了什么" />
            <span className="hint">服务没有提供 AI 草稿时不会自动生成成功文案；你可以不填，但不能提交空信息。</span>
          </label>
          <div className="stack-tight">
            <span className="rail-cap">要提交的文件</span>
            {(fix?.changes?.files ?? []).map((file) => (
              <label key={file.fileId} className="inline-check">
                <input
                  type="checkbox"
                  checked={commitFileIds.has(file.fileId)}
                  onChange={(event) => {
                    setCommitFileIds((current) => {
                      const next = new Set(current);
                      if (event.target.checked) next.add(file.fileId);
                      else next.delete(file.fileId);
                      return next;
                    });
                  }}
                />
                <span>{file.path}</span>
              </label>
            ))}
          </div>
          {verifyFailed ? (
            <label className="inline-check">
              <input type="checkbox" checked={verifyAck} onChange={(event) => { setVerifyAck(event.target.checked); }} />
              我已了解校验未通过，仍要提交（服务会在回执里记录知情确认）。
            </label>
          ) : null}
          <div className="dialog-warning">
            <Icon name="info" />
            <span>提交成功后任务仍未交付；推送与创建 MR 是两个独立确认，不会自动连锁。</span>
          </div>
          {commitMutation.isError ? <FailureNotice error={commitMutation.error} compact /> : null}
        </div>
      </Modal>

      {/* 推送确认 */}
      <Modal
        open={dialog === 'push'}
        title="确认推送修复分支？"
        onClose={() => { setDialog(null); }}
        footer={
          <>
            <Button variant="ghost" onClick={() => { setDialog(null); }}>取消</Button>
            <span className="spacer" />
            <Button variant="primary" icon="upload" disabled={commitStep?.commitSha === undefined || pushMutation.isPending} disabledReason={commitStep?.commitSha === undefined ? '没有已提交的本地 SHA，不能推送。' : undefined} onClick={() => { pushMutation.mutate(); }}>
              {pushMutation.isPending ? '推送中…' : '确认推送'}
            </Button>
          </>
        }
      >
        <div className="stack-loose">
          <div className="dialog-facts">
            <div className="row-line"><span className="k">源提交</span><span className="v mono">{commitStep?.commitSha ?? '—'}</span></div>
            <div className="row-line"><span className="k">远端分支</span><span className="v mono">{fix?.fixBranch ?? '—'}（新建）</span></div>
            <div className="row-line"><span className="k">远端</span><span className="v">{repo.remote?.displayUrl ?? '服务未返回远端地址'}</span></div>
            <div className="row-line"><span className="k">账户</span><span className="v">{repo.remote?.name ?? '—'} · 凭据只在服务端</span></div>
          </div>
          <div className="dialog-warning">
            <Icon name="shield" />
            <span>只创建新远端分支：远端已有同名分支即停止，永不强推、不覆盖。推送成功后仍需单独确认创建合并请求。</span>
          </div>
          {pushMutation.isError ? <FailureNotice error={pushMutation.error} compact /> : null}
        </div>
      </Modal>

      {/* 创建 MR 确认 */}
      <Modal
        open={dialog === 'mr'}
        title="创建合并请求"
        onClose={() => { setDialog(null); }}
        footer={
          <>
            <Button variant="ghost" onClick={() => { setDialog(null); }}>取消</Button>
            <span className="spacer" />
            <Button
              variant="primary"
              icon="gitRepo"
              disabled={pushStep?.pushedSha === undefined || targetTip === undefined || mrTitle.trim().length === 0 || mrMutation.isPending}
              disabledReason={
                pushStep?.pushedSha === undefined ? '没有已推送的 SHA。'
                  : targetTip === undefined ? '没有读取到目标分支当前 tip；先刷新分支，避免拿旧确认创建 MR。'
                    : mrTitle.trim().length === 0 ? '标题不能为空。'
                      : undefined
              }
              onClick={() => { mrMutation.mutate(); }}
            >
              {mrMutation.isPending ? '创建中…' : '确认创建'}
            </Button>
          </>
        }
      >
        <div className="stack-loose">
          <div className="dialog-facts">
            <div className="row-line"><span className="k">源</span><span className="v mono">{pushStep?.remoteRef ?? '—'} @ {pushStep?.pushedSha === undefined ? '—' : shortSha(pushStep.pushedSha)}</span></div>
            <div className="row-line"><span className="k">目标</span><span className="v">
              <select className="select" style={{ height: 30, width: 'auto', display: 'inline-block' }} value={mrTarget} onChange={(event) => { setMrTarget(event.target.value); }}>
                {branches.map((branch) => (
                  <option key={`${branch.kind}:${branch.fullRef}`} value={branch.name}>
                    {branch.kind === 'local' ? '' : '远端 · '}{branch.name}
                  </option>
                ))}
              </select>
              {targetTip === undefined ? ' · 当前 tip 未知' : ` · tip ${shortSha(targetTip)}`}
            </span></div>
            <div className="row-line"><span className="k">评审人</span><span className="v">暂未接通（非必填）</span></div>
          </div>
          <label className="form-label">
            标题 <span className="req">*</span>
            <input className="input" value={mrTitle} maxLength={255} onChange={(event) => { setMrTitle(event.target.value); }} />
          </label>
          <label className="form-label">
            说明
            <textarea className="textarea" value={mrDescription} onChange={(event) => { setMrDescription(event.target.value); }} placeholder="可选：说明修复了哪些审查问题" />
          </label>
          <div className="dialog-warning">
            <Icon name="info" />
            <span>创建成功只代表所选交付完成，不等待合并；合并在 GitLab 完成。已有同源 → 目标的打开 MR 时服务不会重复创建。</span>
          </div>
          {mrMutation.isError ? <FailureNotice error={mrMutation.error} compact /> : null}
        </div>
      </Modal>

      {/* 合并修复确认 */}
      <Modal
        open={dialog === 'merge'}
        title="合并修复分支？"
        onClose={() => { setDialog(null); }}
        footer={
          <>
            <Button variant="ghost" onClick={() => { setDialog(null); }}>取消</Button>
            <span className="spacer" />
            <Button
              variant="primary"
              icon="branch"
              disabled={mergeBaseTip === undefined || mergeMutation.isPending}
              disabledReason={mergeBaseTip === undefined ? '没有读取到目标分支 tip。' : undefined}
              onClick={() => { mergeMutation.mutate(); }}
            >
              {mergeMutation.isPending ? '合并中…' : '确认合并'}
            </Button>
          </>
        }
      >
        <div className="stack-loose">
          <div className="dialog-facts">
            <div className="row-line"><span className="k">源提交</span><span className="v mono">{commitStep?.commitSha ?? '—'}</span></div>
            <div className="row-line"><span className="k">修复分支</span><span className="v mono">{fix?.fixBranch ?? '—'}</span></div>
            <div className="row-line"><span className="k">目标分支</span><span className="v mono">{fix?.base.branch ?? '—'} @ {mergeBaseTip === undefined ? '未知' : shortSha(mergeBaseTip)}</span></div>
          </div>
          <label className="form-label">
            合并提交信息
            <input className="input" value={mergeMessage} placeholder="可选：默认使用修复分支与摘要" maxLength={400} onChange={(event) => { setMergeMessage(event.target.value); }} />
          </label>
          <div className="dialog-warning">
            <Icon name="shield" />
            <span>合并只更新本地目标分支（no-ff + CAS）；不会推送、不会创建 MR。目标分支在确认后前移时停止并返回 STALE_TARGET。</span>
          </div>
          {mergeMutation.isError ? <FailureNotice error={mergeMutation.error} compact /> : null}
        </div>
      </Modal>

      {/* 放弃修复确认 */}
      <Modal
        open={dialog === 'discard'}
        title="放弃这次修复？"
        onClose={() => { setDialog(null); }}
        footer={
          <>
            <Button variant="ghost" onClick={() => { setDialog(null); }}>取消</Button>
            <span className="spacer" />
            <Button variant="danger" icon="trash" disabled={discardMutation.isPending} onClick={() => { discardMutation.mutate(); }}>
              {discardMutation.isPending ? '提交中…' : '确认放弃修复'}
            </Button>
          </>
        }
      >
        <div className="stack-loose">
          <p className="lede">
            会删除本地的修复分支与修复副本；<b>已推送的远端分支不会删除</b>，需要在 GitLab 中处理。审查记录保留。
          </p>
          <div className="dialog-facts">
            <div className="row-line"><span className="k">修复分支</span><span className="v mono">{fix?.fixBranch ?? '—'}</span></div>
            <div className="row-line"><span className="k">已推送</span><span className="v">{pushStep?.pushedSha === undefined ? '否' : `是 · ${shortSha(pushStep.pushedSha)}（远端保留）`}</span></div>
            <div className="row-line"><span className="k">审查记录</span><span className="v">保留，历史不受影响</span></div>
          </div>
          {discardMutation.isError ? <FailureNotice error={discardMutation.error} compact /> : null}
        </div>
      </Modal>
    </div>
  );
}
