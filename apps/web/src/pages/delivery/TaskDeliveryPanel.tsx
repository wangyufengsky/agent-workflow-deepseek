import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  type DeliveryGoalValue,
  type GitBranch,
  type OperationReceipt,
  type TaskDelivery,
} from '@agent-workflow/shared';
import {
  classifyGitFailure,
  commitDelivery,
  createDeliveryMergeRequest,
  fetchGitBranches,
  fetchOperationByKey,
  fetchTaskChanges,
  fetchTaskDelivery,
  fetchTaskDetail,
  gitKeys,
  pushDelivery,
  selectDelivery,
  toReceiptView,
  type ReceiptView,
} from '../../api/git.ts';
import { fetchDeliveryMergeRequestFact, verifyDeliveryMergeRequest, verifyDeliveryPush } from '../../api/workflow.ts';
import { Badge } from '../../components/Badge.tsx';
import { Button } from '../../components/Button.tsx';
import { EmptyState, Skeleton } from '../../components/EmptyState.tsx';
import { Icon } from '../../components/Icon.tsx';
import { IconButton } from '../../components/IconButton.tsx';
import { Modal } from '../../components/Modal.tsx';
import {
  FailureNotice,
  OperationLookupResult,
  ReceiptBanner,
  deliveryGoalLabel,
  deliveryProjectionTone,
  formatTime,
  projectionLabel,
  shortSha,
} from '../git/git-shared.tsx';
import { DeliveryFileSelect } from './DeliveryFileSelect.tsx';
import { DeliveryGoalPicker } from './DeliveryGoalPicker.tsx';
import { DeliveryStepList } from './DeliveryStepList.tsx';
import { DeliveryApplyPreview } from './DeliveryApplyPreview.tsx';
import { TaskChangesView } from './TaskChangesView.tsx';
import './delivery.css';

type DeliveryDialog = 'commit' | 'push' | 'mr' | null;

const RETENTION_LABEL: Record<string, string> = {
  retained: '保留中',
  cleaning: '清理中',
  partial: '部分清理',
  cleaned: '已清理',
};

const MR_STATE_LABEL: Record<string, string> = {
  opened: '打开中 · 未合并',
  merged: '已合并',
  closed: '已关闭',
  locked: '已锁定',
};

const DELIVERY_STEP_TITLE: Record<string, string> = {
  commit: '提交',
  push: '推送',
  mergeRequest: '创建合并请求',
  apply: '应用到原目录',
};

/**
 * DEL-11：交付投影文案按当前未完成步骤拼（等待确认/进行中/待核对），
 * 不再只显示通用“等待确认下一步”。
 */
function projectionLabelFor(delivery: TaskDelivery): string {
  if (delivery.projection === 'awaiting_confirmation') {
    const commit = delivery.steps.find((step) => step.step === 'commit');
    const push = delivery.steps.find((step) => step.step === 'push');
    const mr = delivery.steps.find((step) => step.step === 'mergeRequest');
    if (commit?.state === 'succeeded' && push?.state !== 'succeeded') return '提交完成 · 等待推送确认';
    if (push?.state === 'succeeded' && mr?.state !== 'succeeded') return '推送完成 · 等待创建合并请求';
    return delivery.goal === 'apply_to_original' ? '等待你确认应用' : projectionLabel(delivery.projection);
  }
  if (delivery.projection === 'unknown_receipt') {
    const unknown = delivery.steps.find((step) => step.state === 'unknown');
    return unknown === undefined ? '结果待核对' : `${DELIVERY_STEP_TITLE[unknown.step] ?? unknown.step}结果待核对`;
  }
  if (delivery.projection === 'in_progress') {
    const running = delivery.steps.find((step) => step.state === 'in_progress');
    return running === undefined ? projectionLabel(delivery.projection) : `${DELIVERY_STEP_TITLE[running.step] ?? running.step}中…`;
  }
  return projectionLabel(delivery.projection);
}

const VERIFICATION_LABEL: Record<string, string> = {
  all_passed: '验证全部通过',
  failed: '验证未通过',
  not_run: '未运行验证',
};

function shouldRetry(failureCount: number, error: unknown): boolean {
  return classifyGitFailure(error) === 'failed' && failureCount < 2;
}

function stepOf(delivery: TaskDelivery | undefined, step: string) {
  return delivery?.steps.find((item) => item.step === step);
}

export interface TaskDeliveryPanelProps {
  readonly taskId: string;
  /** 任务画布等宿主提供的关闭入口；没有时面板不显示关闭按钮。 */
  readonly onClose?: () => void;
  /** 定位到交付区（滚动并聚焦文件选择）；每次递增触发，不再重复设置同一参数。 */
  readonly onOpenChanges?: () => void;
  /** 嵌入任务画布内联显示（无固定宽度）；默认是 480 右侧面板。 */
  readonly inline?: boolean;
  /** 宿主请求定位待交付变更区；值递增时滚动并聚焦文件选择。 */
  readonly focusChangesRequest?: number;
}

/**
 * 任务交付面板：
 * - 投影状态与不可交付原因全部读自服务；
 * - 文件选择 / 完成目标 / 提交 / 推送 / 创建 MR / 合并各自独立确认；
 * - 回执 UNKNOWN 只核对原操作（operations.by-key），不重发；
 * - 非 Git 项目只显示只读应用预览，并禁用写操作、写明原因。
 */
export function TaskDeliveryPanel({ taskId, onClose, onOpenChanges, inline, focusChangesRequest }: TaskDeliveryPanelProps) {
  const queryClient = useQueryClient();
  const [selectedFileIds, setSelectedFileIds] = useState<ReadonlySet<string>>(new Set());
  const [goal, setGoal] = useState<DeliveryGoalValue | null>(null);
  const [dialog, setDialog] = useState<DeliveryDialog>(null);
  const [receipts, setReceipts] = useState<readonly ReceiptView[]>([]);
  const [lookupKey, setLookupKey] = useState<string | null>(null);
  const [reconciledKeys, setReconciledKeys] = useState<ReadonlySet<string>>(new Set());
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [mrVerifyNote, setMrVerifyNote] = useState<{ readonly found: boolean; readonly note: string } | null>(null);
  const [pushVerifyNote, setPushVerifyNote] = useState<{ readonly found: boolean; readonly note: string } | null>(null);
  const [changesView, setChangesView] = useState(false);
  const [focusNotice, setFocusNotice] = useState(0);
  const changesFocusRef = useRef<HTMLDivElement>(null);
  const handledFocusRequest = useRef(0);
  const selectionReady = useRef(false);
  const goalReady = useRef(false);

  const [commitMessage, setCommitMessage] = useState('');
  const [commitFileIds, setCommitFileIds] = useState<ReadonlySet<string>>(new Set());
  const [ackFailedVerification, setAckFailedVerification] = useState(false);
  const [continueToPush, setContinueToPush] = useState(false);
  const [remoteBranch, setRemoteBranch] = useState('');
  const [continueToMr, setContinueToMr] = useState(false);
  const [mrTarget, setMrTarget] = useState('');
  const [mrTitle, setMrTitle] = useState('');
  const [mrDescription, setMrDescription] = useState('');

  const detailQuery = useQuery({
    queryKey: gitKeys.taskDetail(taskId),
    queryFn: () => fetchTaskDetail(taskId),
    retry: shouldRetry,
  });
  const deliveryQuery = useQuery({
    queryKey: gitKeys.delivery(taskId),
    queryFn: () => fetchTaskDelivery(taskId),
    retry: shouldRetry,
  });

  const detail = detailQuery.data;
  const delivery = deliveryQuery.data?.delivery ?? detail?.delivery;
  const actions = deliveryQuery.data?.actions ?? {};
  const changesQuery = useQuery({
    queryKey: gitKeys.taskChanges(taskId),
    queryFn: () => fetchTaskChanges(taskId),
    enabled: delivery !== undefined,
    retry: shouldRetry,
  });
  const changes = changesQuery.data;
  const project = detail?.project;
  const workspace = detail?.workspace;
  const projectGit = project?.gitState === 'git';
  const projectId = project?.id;

  const branchesQuery = useQuery({
    queryKey: gitKeys.branches(projectId ?? ''),
    queryFn: () => fetchGitBranches(projectId ?? ''),
    enabled: projectGit && projectId !== undefined,
    retry: shouldRetry,
  });
  const branches: readonly GitBranch[] = branchesQuery.data ?? [];

  const lookupQuery = useQuery({
    queryKey: gitKeys.operation(lookupKey ?? ''),
    queryFn: () => fetchOperationByKey(lookupKey ?? ''),
    enabled: lookupKey !== null,
    retry: false,
  });

  // DEL-12：已交付后读 GitLab 的 MR 状态（只读独立事实；读不到不伪造状态）。
  const hasMergeRequestStep = delivery?.steps.some((step) => step.step === 'mergeRequest' && step.mrIid !== undefined) ?? false;
  const mrFactQuery = useQuery({
    queryKey: ['task', taskId, 'delivery', 'mr-fact'] as const,
    queryFn: () => fetchDeliveryMergeRequestFact(taskId),
    enabled: delivery?.projection === 'delivered' && hasMergeRequestStep,
    retry: false,
    staleTime: 30_000,
  });

  useEffect(() => {
    // 核对到服务已结算后，按权威读口重新读取；本地回执不自行“清除未知”。
    if (lookupQuery.data === undefined || lookupQuery.data.stillUnknown) return;
    if (lookupKey !== null) {
      setReconciledKeys((current) => {
        if (current.has(lookupKey)) return current;
        const next = new Set(current);
        next.add(lookupKey);
        return next;
      });
    }
    void queryClient.invalidateQueries({ queryKey: gitKeys.delivery(taskId) });
    void queryClient.invalidateQueries({ queryKey: gitKeys.taskDetail(taskId) });
    void queryClient.invalidateQueries({ queryKey: gitKeys.taskChanges(taskId) });
  }, [lookupQuery.data, lookupKey, queryClient, taskId]);

  // 初次读取后把服务的选择对到本地；后续写操作只更新本地选择，不变更服务事实。
  useEffect(() => {
    if (selectionReady.current || delivery === undefined) return;
    const initial = delivery.selectedFileIds.length > 0
      ? delivery.selectedFileIds
      : (changes?.files ?? []).map((file) => file.fileId);
    setSelectedFileIds(new Set(initial));
    if (delivery.selectedFileIds.length > 0 || changes !== undefined) selectionReady.current = true;
  }, [delivery, changes]);

  useEffect(() => {
    if (goalReady.current || delivery === undefined) return;
    setGoal(delivery.goal ?? null);
    goalReady.current = true;
  }, [delivery]);

  // 宿主点「查看变更并交付」时真正定位到交付区：滚动并聚焦文件选择，而不是再次设置同一个 URL 参数。
  useEffect(() => {
    if (focusChangesRequest === undefined || focusChangesRequest <= handledFocusRequest.current) return;
    if (delivery === undefined) return;
    const container = changesFocusRef.current;
    if (container === null) return;
    handledFocusRequest.current = focusChangesRequest;
    container.scrollIntoView({ block: 'start', behavior: 'smooth' });
    const focusTarget = container.querySelector<HTMLElement>('input[type="checkbox"], button, [tabindex]');
    if (focusTarget !== null) focusTarget.focus({ preventScroll: true });
    else container.focus({ preventScroll: true });
    setFocusNotice(focusChangesRequest);
  }, [changes, delivery, focusChangesRequest]);

  useEffect(() => {
    if (focusNotice === 0) return;
    const timer = window.setTimeout(() => { setFocusNotice(0); }, 5000);
    return () => { window.clearTimeout(timer); };
  }, [focusNotice]);

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: gitKeys.delivery(taskId) }),
      queryClient.invalidateQueries({ queryKey: gitKeys.taskDetail(taskId) }),
      queryClient.invalidateQueries({ queryKey: gitKeys.taskChanges(taskId) }),
    ]);
  };

  const recordReceipt = (receipt: OperationReceipt) => {
    const view = toReceiptView(receipt);
    setReceipts((current) => [view, ...current.filter((item) => item.requestKey !== view.requestKey)].slice(0, 4));
  };

  const selectMutation = useMutation({
    mutationFn: () =>
      selectDelivery({
        taskId,
        goal: goal ?? 'local_commit',
        fileIds: [...selectedFileIds],
        changesRevision: changes?.changesRevision ?? '',
        expectedDeliveryRevision: delivery?.revision,
      }),
    retry: false,
    onSuccess: (data) => {
      recordReceipt(data.receipt);
      void invalidate();
    },
  });

  const commitMutation = useMutation({
    mutationFn: () =>
      commitDelivery({
        taskId,
        fileIds: [...commitFileIds],
        message: commitMessage,
        expectedChangesRevision: changes?.changesRevision ?? '',
        expectedBranchHead: branchTip ?? '',
      }),
    retry: false,
    onSuccess: (data) => {
      recordReceipt(data.receipt);
      setDialog(null);
      setPendingAction(null);
      void invalidate();
      if (continueToPush && (goal === 'push_branch' || goal === 'create_merge_request')) {
        setContinueToPush(false);
        window.setTimeout(() => { setDialog('push'); }, 250);
      }
    },
    onError: () => { setPendingAction(null); },
  });

  const pushMutation = useMutation({
    mutationFn: () =>
      pushDelivery({
        taskId,
        expectedLocalSha: commitStep?.commitSha ?? '',
        remoteBranchName: remoteBranch,
      }),
    retry: false,
    onSuccess: (data) => {
      recordReceipt(data.receipt);
      setDialog(null);
      setPendingAction(null);
      void invalidate();
      if (continueToMr && goal === 'create_merge_request') {
        setContinueToMr(false);
        window.setTimeout(() => { setDialog('mr'); }, 250);
      }
    },
    onError: () => { setPendingAction(null); },
  });

  const mrMutation = useMutation({
    mutationFn: () =>
      createDeliveryMergeRequest({
        taskId,
        sourceRef: pushStep?.remoteRef ?? '',
        pushedSha: pushStep?.pushedSha ?? '',
        targetBranch: mrTarget,
        expectedTargetTip: mrTargetTip ?? '',
        title: mrTitle,
        description: mrDescription,
      }),
    retry: false,
    onSuccess: (data) => {
      recordReceipt(data.receipt);
      setDialog(null);
      setPendingAction(null);
      void invalidate();
    },
    onError: () => { setPendingAction(null); },
  });

  const mrVerifyMutation = useMutation({
    mutationFn: (requestKey: string) => verifyDeliveryMergeRequest({ taskId, targetRequestKey: requestKey }),
    retry: false,
    onSuccess: (data) => {
      setMrVerifyNote({ found: data.resource?.found === true, note: data.resource?.note ?? '已核对原操作。' });
      void invalidate();
    },
    onError: (error) => {
      setMrVerifyNote({ found: false, note: error instanceof Error ? error.message : '核对原操作失败。' });
    },
  });

  const pushVerifyMutation = useMutation({
    mutationFn: (requestKey: string) => verifyDeliveryPush({ taskId, targetRequestKey: requestKey }),
    retry: false,
    onSuccess: (data) => {
      setPushVerifyNote({ found: data.resource?.found === true, note: data.resource?.note ?? '已核对原推送。' });
      void invalidate();
    },
    onError: (error) => {
      setPushVerifyNote({ found: false, note: error instanceof Error ? error.message : '核对原推送失败。' });
    },
  });

  const commitStep = stepOf(delivery, 'commit');
  const pushStep = stepOf(delivery, 'push');
  const mrStep = stepOf(delivery, 'mergeRequest');
  const applyStep = stepOf(delivery, 'apply');

  const taskBranch = workspace?.branch;
  const branchTip = useMemo(() => {
    if (taskBranch === undefined) return undefined;
    const branch = branches.find((item) => item.fullRef === taskBranch || item.name === taskBranch);
    return branch?.tipSha;
  }, [branches, taskBranch]);

  const targetBranch = project?.defaultBranch;
  const targetTip = useMemo(
    () => branches.find((item) => item.name === targetBranch)?.tipSha,
    [branches, targetBranch],
  );
  const mrTargetTip = useMemo(
    () => branches.find((item) => item.name === mrTarget)?.tipSha ?? targetTip,
    [branches, mrTarget, targetTip],
  );
  const stepsStarted = delivery !== undefined && delivery.steps.some((step) => step.state !== 'not_started');
  const delivered = delivery?.projection === 'delivered';
  const hasUnknown = (delivery !== undefined && delivery.projection === 'unknown_receipt')
    || (delivery?.steps.some((step) => step.state === 'unknown') ?? false)
    || receipts.some((receipt) => receipt.status === 'unknown' && !reconciledKeys.has(receipt.requestKey));
  const eligibility = delivery?.eligibility;
  const eligibilityReason = eligibility !== undefined && !eligibility.allowed
    ? (eligibility.reason ?? eligibility.reasonCode ?? '服务未说明交付资格原因')
    : null;

  const savedIds = delivery?.selectedFileIds ?? [];
  const dirty = delivery === undefined
    || goal !== delivery.goal
    || selectedFileIds.size !== savedIds.length
    || savedIds.some((fileId) => !selectedFileIds.has(fileId));

  const selectBlockedReason =
    delivery === undefined ? '交付记录还没有读取成功。'
      : delivered ? '任务已交付，不能重新保存选择。'
        : stepsStarted ? '已开始交付；为避免改变已提交的范围，这里不提供静默改选。'
          : hasUnknown ? '有回执未知的操作，先核对原操作。'
            : eligibilityReason !== null ? eligibilityReason
              : goal === null ? '先选择完成目标。'
                : selectedFileIds.size === 0 ? '至少选择一个文件。'
                  : changes === undefined ? '变更集还没有读取成功。'
                    : !dirty ? '当前选择与已保存的一致。'
                      : null;

  const fileSelectDisabledReason =
    delivery === undefined ? '交付记录还没有读取成功。'
      : delivered ? '任务已交付。'
        : stepsStarted ? '交付步骤已经开始；文件选择已锁定。'
          : hasUnknown ? '有回执未知的操作，先核对原操作。'
            : eligibilityReason;

  const openCommitDialog = () => {
    setCommitMessage(detail?.task.title ?? '');
    setCommitFileIds(new Set(selectedFileIds));
    setAckFailedVerification(false);
    setContinueToPush(false);
    setDialog('commit');
  };

  const openPushDialog = () => {
    setRemoteBranch(taskBranch ?? '');
    setContinueToMr(false);
    setDialog('push');
  };

  const openMrDialog = () => {
    setMrTarget(targetBranch ?? '');
    setMrTitle(detail?.task.title ?? '');
    setMrDescription('');
    setDialog('mr');
  };

  const verificationFailed = delivery?.verificationOutcome === 'failed';

  const commitBlockedReason =
    branchTip === undefined ? '没有读取到任务分支当前 tip，不能安全提交；先刷新分支。'
      : changes === undefined ? '变更集还没有读取成功。'
        : commitFileIds.size === 0 ? '至少勾选一个要提交的文件。'
          : commitMessage.trim().length === 0 ? '提交信息不能为空。'
            : verificationFailed && !ackFailedVerification ? '验证未通过：需要勾选“我已了解验证未通过”后才能提交。'
              : null;

  const pushBlockedReason =
    commitStep?.commitSha === undefined ? '没有已成功的提交，不能推送。'
      : remoteBranch.trim().length === 0 ? '远端分支名不能为空。'
        : hasUnknown ? '有回执未知的操作，先核对原操作。'
          : null;

  const mrBlockedReason =
    pushStep?.pushedSha === undefined || pushStep.remoteRef === undefined ? '没有已推送的 ref / SHA。'
      : mrTargetTip === undefined ? '没有读取到目标分支当前 tip；先刷新分支，避免拿旧确认创建 MR。'
        : mrTitle.trim().length === 0 ? '标题不能为空。'
          : null;

  if (changesView && delivery !== undefined) {
    return (
      <TaskChangesView
        taskId={taskId}
        taskTitle={detail?.task.title ?? '任务'}
        projectName={detail?.project.name ?? '项目未知'}
        branch={workspace?.branch}
        baseRef={workspace?.baseRef}
        baseSha={workspace?.baseSha}
        workspaceDisplayRoot={workspace?.displayRoot}
        changes={changes}
        loading={changesQuery.isPending}
        error={changesQuery.isError ? changesQuery.error : null}
        onRetry={() => { void changesQuery.refetch(); }}
        files={changes?.files ?? []}
        selected={selectedFileIds}
        deliverySelected={new Set(delivery.selectedFileIds)}
        onToggle={(fileId, selected) => {
          setSelectedFileIds((current) => {
            const next = new Set(current);
            if (selected) next.add(fileId);
            else next.delete(fileId);
            return next;
          });
        }}
        onSelectAll={() => { setSelectedFileIds(new Set((changes?.files ?? []).map((file) => file.fileId))); }}
        onSelectNone={() => { setSelectedFileIds(new Set()); }}
        verificationLabel={delivery.verificationOutcome === undefined ? undefined : VERIFICATION_LABEL[delivery.verificationOutcome] ?? delivery.verificationOutcome}
        onClose={() => { setChangesView(false); }}
      />
    );
  }

  if (detailQuery.isPending) {
    return (
      <div className={['delivery-panel', inline === true ? 'inline' : ''].filter(Boolean).join(' ')}>
        <div className="delivery-head">
          <Skeleton width={120} height={16} />
          <span className="spacer" />
          {onClose === undefined ? null : <IconButton icon="x" label="关闭交付面板" onClick={onClose} />}
        </div>
        <div className="delivery-body">
          <Skeleton height={40} />
          <Skeleton height={64} />
          <Skeleton height={120} />
        </div>
      </div>
    );
  }

  if (detailQuery.isError) {
    return (
      <div className={['delivery-panel', inline === true ? 'inline' : ''].filter(Boolean).join(' ')}>
        <div className="delivery-head">
          <h2>任务交付</h2>
          <span className="spacer" />
          {onClose === undefined ? null : <IconButton icon="x" label="关闭交付面板" onClick={onClose} />}
        </div>
        <div className="delivery-body">
          <FailureNotice error={detailQuery.error} onRetry={() => { void detailQuery.refetch(); }} />
        </div>
      </div>
    );
  }

  if (delivery === undefined) {
    const deliveryError = deliveryQuery.isError ? deliveryQuery.error : new Error('服务还没有创建这个任务的交付记录');
    return (
      <div className={['delivery-panel', inline === true ? 'inline' : ''].filter(Boolean).join(' ')}>
        <div className="delivery-head">
          <div className="grow">
            <h2>任务交付</h2>
            <div className="sub">{detail?.project.name ?? '项目未知'}</div>
          </div>
          {onClose === undefined ? null : <IconButton icon="x" label="关闭交付面板" onClick={onClose} />}
        </div>
        <div className="delivery-body">
          <EmptyState
            icon="inbox"
            title="还不能交付"
            description="交付需要任务工作区。服务没有返回可交付记录时，界面不会显示可执行的交付步骤。"
          />
          <FailureNotice error={deliveryError} onRetry={() => { void deliveryQuery.refetch(); void detailQuery.refetch(); }} />
        </div>
      </div>
    );
  }

  const projectLabel = detail?.project.name ?? '项目未知';
  const workspaceKind = workspace === undefined
    ? '服务未返回工作区'
    : workspace.kind === 'git_worktree'
      ? 'Git 独立分支与 worktree'
      : '非 Git 独立副本';

  return (
    <div className={['delivery-panel', inline === true ? 'inline' : ''].filter(Boolean).join(' ')}>
      <div className="delivery-head">
        <div className="grow">
          <h2>任务交付</h2>
          <div className="sub">{projectLabel} · {taskId}</div>
        </div>
        <div className="delivery-head-actions">
          <IconButton
            icon="refresh"
            label="重新读取交付"
            onClick={() => {
              void detailQuery.refetch();
              void deliveryQuery.refetch();
              void changesQuery.refetch();
              // DEL-16：目标分支 tip 必须随「重新读取」一起重取，漂移后才能用新 tip 重新确认。
              if (projectGit && projectId !== undefined) void branchesQuery.refetch();
            }}
          />
          {onClose === undefined ? null : <IconButton icon="x" label="关闭交付面板" onClick={onClose} />}
        </div>
      </div>

      <div className="delivery-body">
        <div className="delivery-projection" aria-live="polite">
          <div className="delivery-projection-head">
            <Badge tone={deliveryProjectionTone(delivery.projection)} icon={delivery.projection === 'delivered' ? 'check' : delivery.projection === 'unknown_receipt' ? 'help' : delivery.projection === 'blocked' ? 'alert' : 'clock'}>
              {projectionLabelFor(delivery)}
            </Badge>
            <span className="muted-note">最后更新 {formatTime(delivery.lastUpdatedAt)}</span>
            <span className="grow" />
            {delivery.goal === undefined ? null : <Badge tone="neutral">{deliveryGoalLabel(delivery.goal)}</Badge>}
          </div>
          {delivery.projectionReason === undefined ? null : (
            <div className="delivery-projection-reason">{delivery.projectionReason}</div>
          )}
          <div className="delivery-facts">
            <div className="delivery-fact-row"><span className="k">工作区</span><span className="v">{workspaceKind}{workspace === undefined ? '' : ` · ${workspace.state}`}</span></div>
            <div className="delivery-fact-row"><span className="k">任务分支</span><span className="v mono">{workspace?.branch ?? '—'}</span></div>
            <div className="delivery-fact-row"><span className="k">基线</span><span className="v mono">{workspace?.baseRef ?? '—'}{workspace?.baseSha === undefined ? '' : ` @ ${shortSha(workspace.baseSha)}`}</span></div>
            {workspace?.displayRoot === undefined ? null : (
              <div className="delivery-fact-row"><span className="k">目录</span><span className="v mono">{workspace.displayRoot}（仅显示）</span></div>
            )}
            <div className="delivery-fact-row"><span className="k">保留状态</span><span className="v">{RETENTION_LABEL[delivery.workspaceRetention ?? workspace?.retention ?? ''] ?? '未知'}</span></div>
            <div className="delivery-fact-row"><span className="k">验证</span><span className="v">{delivery.verificationOutcome === undefined ? '服务未返回验证结论' : VERIFICATION_LABEL[delivery.verificationOutcome] ?? delivery.verificationOutcome}</span></div>
          </div>
        </div>

        {eligibilityReason === null ? null : (
          <div className="banner danger" role="alert">
            <Icon name="lock" />
            <div className="grow">
              <b>交付资格未通过</b>
              <br />
              {eligibilityReason}
              {eligibility?.reasonCode === undefined ? null : <span className="failure-detail">{eligibility.reasonCode}</span>}
            </div>
          </div>
        )}

        {verificationFailed ? (
          <div className="banner warn" role="status">
            <Icon name="alert" />
            <div className="grow">
              <b>验证未通过</b>
              <br />
              任务仍可交付，但提交前需要知性确认（勾选“我已了解验证未通过”），回执会记录这一事实。
            </div>
          </div>
        ) : null}

        {receipts.length === 0 ? null : (
          <div className="delivery-receipts">
            {receipts.map((receipt) => (
              <ReceiptBanner
                key={receipt.requestKey}
                receipt={receipt}
                verifying={lookupQuery.isFetching}
                onVerify={(key) => { setLookupKey(key); }}
                onDismiss={() => { setReceipts((current) => current.filter((item) => item.requestKey !== receipt.requestKey)); }}
              />
            ))}
          </div>
        )}

        {mrVerifyNote === null ? null : (
          <div className={`banner ${mrVerifyNote.found ? 'ok' : 'info'}`} role="status">
            <Icon name={mrVerifyNote.found ? 'check' : 'search'} />
            <div className="grow">
              <b>{mrVerifyNote.found ? '核对到已有原合并请求' : '已核对远端事实'}</b>
              <br />
              {mrVerifyNote.note}
            </div>
            <Button variant="ghost" size="sm" onClick={() => { setMrVerifyNote(null); }}>关闭</Button>
          </div>
        )}

        {pushVerifyNote === null ? null : (
          <div className={`banner ${pushVerifyNote.found ? 'ok' : 'warn'}`} role="status">
            <Icon name={pushVerifyNote.found ? 'check' : 'help'} />
            <div className="grow">
              <b>{pushVerifyNote.found ? '核对到远端已推送' : '已核对原推送'}</b>
              <br />
              {pushVerifyNote.note}
            </div>
            <Button variant="ghost" size="sm" onClick={() => { setPushVerifyNote(null); }}>关闭</Button>
          </div>
        )}

        {lookupKey === null ? null : lookupQuery.isPending ? (
          <div className="banner info"><Icon name="clock" /><div className="grow">正在核对原操作…</div></div>
        ) : lookupQuery.isError ? (
          <FailureNotice error={lookupQuery.error} compact />
        ) : lookupQuery.data === undefined ? null : (
          <OperationLookupResult operation={lookupQuery.data.operation} stillUnknown={lookupQuery.data.stillUnknown} />
        )}

        {delivery.projection === 'delivered' ? (
          <div className={`delivery-success ${delivery.verificationOutcome === 'failed' ? 'warn' : ''}`} role="status">
            <span className="title">
              <Icon name={delivery.verificationOutcome === 'failed' ? 'alert' : 'check'} />
              {delivery.verificationOutcome === 'failed' ? '已交付 · 验证未通过' : '任务已交付'}
            </span>
            {commitStep?.commitSha === undefined ? null : <span className="fact">提交 {commitStep.commitSha}</span>}
            {pushStep?.remoteRef === undefined ? null : <span className="fact">远端 {pushStep.remoteRef}{pushStep.pushedSha === undefined ? '' : ` @ ${shortSha(pushStep.pushedSha)}`}</span>}
            {mrStep?.mrIid === undefined ? null : <span className="fact">合并请求 !{String(mrStep.mrIid)}{mrStep.mrWebUrl === undefined ? '' : ` · ${mrStep.mrWebUrl}`}</span>}
            {delivery.taskCompletionRef === undefined ? null : <span className="fact">完成记录 {delivery.taskCompletionRef}</span>}
            {mrStep?.mrIid === undefined ? (
              <span className="fact">合并在 GitLab 中进行，产品内合并未提供。</span>
            ) : (
              <span className="fact">合并在 GitLab 中进行，产品内合并未提供。</span>
            )}
            {mrStep?.mrIid === undefined ? null : mrFactQuery.isPending ? (
              <span className="fact">正在读取 GitLab 的 MR 状态…</span>
            ) : mrFactQuery.data?.available === true && mrFactQuery.data.mergeRequest !== undefined ? (
              <span className="fact">
                MR 状态（GitLab 只读）：{MR_STATE_LABEL[mrFactQuery.data.mergeRequest.state] ?? mrFactQuery.data.mergeRequest.state}
                {' · '}更新 {formatTime(mrFactQuery.data.mergeRequest.updatedAt)}
                {' · '}MR 合并/关闭不改写任务交付记录。
              </span>
            ) : (
              <span className="fact">MR 状态未读取：{mrFactQuery.data?.reason ?? (mrFactQuery.isError ? '读取失败（交付事实不受影响）' : '服务未返回')}</span>
            )}
            {delivery.workspaceRetention === 'retained' ? (
              <span className="fact">工作区保留中；没有自动清理。</span>
            ) : null}
          </div>
        ) : null}

        {focusNotice === 0 ? null : (
          <div className="banner info" role="status">
            <Icon name="target" />
            <div className="grow">已定位到待交付变更；选择文件后可保存目标与选择。</div>
          </div>
        )}

        <div ref={changesFocusRef} tabIndex={-1} aria-label="待交付变更区">
          <DeliveryFileSelect
            files={changes?.files ?? []}
            selected={selectedFileIds}
            onToggle={(fileId, selected) => {
              setSelectedFileIds((current) => {
                const next = new Set(current);
                if (selected) next.add(fileId);
                else next.delete(fileId);
                return next;
              });
            }}
            onSelectAll={() => { setSelectedFileIds(new Set((changes?.files ?? []).map((file) => file.fileId))); }}
            onSelectNone={() => { setSelectedFileIds(new Set()); }}
            excluded={changes?.excluded}
            remaining={delivery.remaining}
            loading={changesQuery.isPending && delivery !== undefined}
            error={changesQuery.isError ? changesQuery.error : null}
            onRetry={() => { void changesQuery.refetch(); }}
            disabled={fileSelectDisabledReason !== null}
            disabledReason={fileSelectDisabledReason}
          />
        </div>

        <DeliveryGoalPicker
          projectGit={projectGit}
          value={goal}
          onChange={(next) => { setGoal(next); }}
          disabled={delivered || stepsStarted || hasUnknown || (eligibilityReason !== null)}
          disabledReason={
            delivered ? '任务已交付。'
              : stepsStarted ? '已开始交付；为避免改变已提交的范围，这里不提供静默改目标。'
                : hasUnknown ? '有回执未知的操作，先核对原操作。'
                  : eligibilityReason
          }
        />

        {stepsStarted || !dirty ? null : (
          <div className="row-wrap">
            <Button
              variant="primary"
              icon="check"
              disabled={selectBlockedReason !== null || selectMutation.isPending}
              disabledReason={selectMutation.isPending ? '正在保存目标与选择，等待服务回执…' : selectBlockedReason ?? undefined}
              onClick={() => {
                setPendingAction('select');
                selectMutation.mutate(undefined, {
                  onSettled: () => { setPendingAction(null); },
                });
              }}
            >
              {selectMutation.isPending ? '保存中…' : '保存目标与选择'}
            </Button>
            <span className="delivery-hint">只记录目标与范围，不会自动提交或推送。</span>
          </div>
        )}
        {selectBlockedReason !== null && !stepsStarted && dirty ? (
          <span className="action-reason"><Icon name="lock" size="sm" />{selectBlockedReason}</span>
        ) : null}
        {selectMutation.isError ? <FailureNotice error={selectMutation.error} compact /> : null}

        {stepsStarted ? (
          <div className="delivery-hint">
            已保存目标：{deliveryGoalLabel(delivery.goal ?? undefined)} · 已选 {String(delivery.selectedFileIds.length)} 个文件。
          </div>
        ) : delivery.goal !== undefined ? (
          <div className="delivery-hint">
            已保存目标：{deliveryGoalLabel(delivery.goal)} · 已选 {String(delivery.selectedFileIds.length)} 个文件。
            修改文件或目标后会出现「保存目标与选择」；选择只记录范围，不会自动执行。
          </div>
        ) : null}

        <DeliveryStepList
          delivery={delivery}
          goal={delivery.goal ?? null}
          projectGit={projectGit}
          hasUnknown={hasUnknown}
          actions={actions}
          pendingAction={pendingAction}
          eligibilityReason={
            eligibilityReason
            ?? (stepsStarted || (delivery.goal ?? goal) !== null ? null : '先保存完成目标与文件选择，再执行交付步骤。')
          }
          onCommit={() => { setPendingAction(null); openCommitDialog(); }}
          onPush={() => { setPendingAction(null); openPushDialog(); }}
          onCreateMr={() => { setPendingAction(null); openMrDialog(); }}
          onVerify={(requestKey) => { setLookupKey(requestKey); }}
          onVerifyMr={(requestKey) => { setLookupKey(null); mrVerifyMutation.mutate(requestKey); }}
          onVerifyPush={(requestKey) => { setLookupKey(null); pushVerifyMutation.mutate(requestKey); }}
        />

        {!projectGit ? (
          <DeliveryApplyPreview
            delivery={delivery}
            originalRoot={project?.rootPath}
            copyRoot={workspace?.displayRoot}
            files={changes?.files}
          />
        ) : null}

        {changes?.verification === undefined ? null : (
          <div className="delivery-hint">
            原验证记录：{changes.verification.state}
            {changes.verification.passed === undefined ? '' : ` · 通过 ${String(changes.verification.passed)}`}
            {changes.verification.failed === undefined ? '' : ` · 失败 ${String(changes.verification.failed)}`}
            {changes.verification.summary === undefined ? '' : ` · ${changes.verification.summary}`}
          </div>
        )}

        {applyStep?.error === undefined ? null : (
          <div className="delivery-step-error">应用错误：{applyStep.error.message}</div>
        )}

      </div>

      <div className="delivery-foot">
        {projectGit ? (
          <Button
            variant="primary"
            size="sm"
            icon="gitRepo"
            disabled={hasUnknown || changes === undefined}
            disabledReason={hasUnknown ? '有回执未知的操作，先核对原操作。' : changes === undefined ? (changesQuery.isError ? '变更集读取失败；先重新读取。' : '变更集还没有读取成功。') : undefined}
            onClick={() => { setChangesView(true); }}
          >
            查看变更并交付
          </Button>
        ) : onOpenChanges === undefined ? null : (
          <Button variant="secondary" size="sm" icon="folder" onClick={onOpenChanges}>
            查看变更并交付
          </Button>
        )}
        <span className="spacer" />
        <span className="delivery-hint">交付由你逐步确认；界面不自动重发未知回执。</span>
        {onClose === undefined ? null : (
          <Button variant="ghost" size="sm" onClick={onClose}>
            关闭
          </Button>
        )}
      </div>

      {/* ① 提交确认 */}
      <Modal
        open={dialog === 'commit'}
        title="确认提交所选文件？"
        onClose={() => { setDialog(null); }}
        footer={
          <>
            <Button variant="ghost" onClick={() => { setDialog(null); }}>取消</Button>
            <span className="spacer" />
            {goal === 'push_branch' || goal === 'create_merge_request' ? (
              <Button
                variant="secondary"
                icon="upload"
                disabled={commitBlockedReason !== null || commitMutation.isPending}
                disabledReason={commitMutation.isPending ? '正在提交，等待服务回执…' : commitBlockedReason ?? undefined}
                onClick={() => { setContinueToPush(true); setPendingAction('commit'); commitMutation.mutate(); }}
              >
                提交（完成后确认推送）
              </Button>
            ) : null}
            <Button
              variant="primary"
              icon="check"
              disabled={commitBlockedReason !== null || commitMutation.isPending}
              disabledReason={commitMutation.isPending ? '正在提交，等待服务回执…' : commitBlockedReason ?? undefined}
              onClick={() => { setContinueToPush(false); setPendingAction('commit'); commitMutation.mutate(); }}
            >
              {commitMutation.isPending ? '提交中…' : '确认提交'}
            </Button>
          </>
        }
      >
        <div className="stack-loose">
          <div className="delivery-dialog-facts">
            <div className="row-line"><span className="k">目标任务分支</span><span className="v mono">{workspace?.branch ?? '—'}</span></div>
            <div className="row-line"><span className="k">分支 head</span><span className="v mono">{branchTip ?? '未读取到 tip'}</span></div>
            <div className="row-line"><span className="k">文件</span><span className="v">{String(commitFileIds.size)} 个 · 新增 {String([...(changes?.files ?? [])].filter((file) => commitFileIds.has(file.fileId) && file.status === 'A').length)} · 修改 {String([...(changes?.files ?? [])].filter((file) => commitFileIds.has(file.fileId) && file.status === 'M').length)} · 删除 {String([...(changes?.files ?? [])].filter((file) => commitFileIds.has(file.fileId) && file.status === 'D').length)}</span></div>
            <div className="row-line"><span className="k">变更版本</span><span className="v mono">{changes?.changesRevision ?? '—'}</span></div>
            <div className="row-line"><span className="k">作者</span><span className="v">取自设置 → Git 账号（不可在此修改）</span></div>
            <div className="row-line"><span className="k">验证</span><span className="v">{delivery.verificationOutcome === undefined ? '服务未返回验证结论' : VERIFICATION_LABEL[delivery.verificationOutcome]}</span></div>
          </div>
          <label className="form-label">
            提交信息 <span className="req">*</span>
            <textarea className="textarea" value={commitMessage} onChange={(event) => { setCommitMessage(event.target.value); }} placeholder="写清这次交付的改动" />
            <span className="hint">预填文案来自任务标题（真实数据），可编辑；服务没有提供 AI 草稿时不会自动生成。</span>
          </label>
          <div className="delivery-dialog-filelist">
            {(changes?.files ?? []).map((file) => (
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
                <span className="mono-sm">{file.path}</span>
              </label>
            ))}
          </div>
          {verificationFailed ? (
            <label className="inline-check">
              <input type="checkbox" checked={ackFailedVerification} onChange={(event) => { setAckFailedVerification(event.target.checked); }} />
              我已了解验证未通过，仍要提交（服务会在回执里记录知情确认）。
            </label>
          ) : null}
          <div className="dialog-warning">
            <Icon name="info" />
            <span>{goal === 'local_commit' ? '本地提交成功即完成所选交付目标；不会推送或创建 MR。' : '提交后仍需完成所选目标；推送与创建 MR 分别确认，不会自动连锁。'}</span>
          </div>
          {commitMutation.isError ? <FailureNotice error={commitMutation.error} compact /> : null}
        </div>
      </Modal>

      {/* ② 推送确认 */}
      <Modal
        open={dialog === 'push'}
        title="确认推送任务分支？"
        onClose={() => { setDialog(null); }}
        footer={
          <>
            <Button variant="ghost" onClick={() => { setDialog(null); }}>取消</Button>
            <span className="spacer" />
            <Button
              variant="primary"
              icon="upload"
              disabled={pushBlockedReason !== null || pushMutation.isPending}
              disabledReason={pushMutation.isPending ? '正在推送，等待服务回执…' : pushBlockedReason ?? undefined}
              onClick={() => { setPendingAction('push'); pushMutation.mutate(); }}
            >
              {pushMutation.isPending ? '推送中…' : '确认推送'}
            </Button>
          </>
        }
      >
        <div className="stack-loose">
          <div className="delivery-dialog-facts">
            <div className="row-line"><span className="k">源提交</span><span className="v mono">{commitStep?.commitSha ?? '—'}</span></div>
            <div className="row-line"><span className="k">远端</span><span className="v">{project?.remoteDisplayUrl ?? '服务未返回远端地址'}</span></div>
            <div className="row-line"><span className="k">项目</span><span className="v">{project?.name ?? '—'}</span></div>
          </div>
          <label className="form-label">
            远端分支名 <span className="req">*</span>
            <input className="input" value={remoteBranch} onChange={(event) => { setRemoteBranch(event.target.value); }} />
            <span className="hint">只创建新分支：远端同名即停止，永不强推。已存在时换一个名称重新确认。</span>
          </label>
          {goal === 'create_merge_request' ? (
            <label className="inline-check">
              <input type="checkbox" checked={continueToMr} onChange={(event) => { setContinueToMr(event.target.checked); }} />
              推送成功后继续打开「创建合并请求」确认框（仍为独立确认，不会自动创建）。
            </label>
          ) : null}
          <div className="delivery-dialog-facts">
            <div className="row-line"><span className="k">账户 / 服务器公开名</span><span className="v">服务未返回（C1，不猜测显示）</span></div>
            <div className="row-line"><span className="k">连接版本</span><span className="v">服务未返回（C1）</span></div>
          </div>
          <div className="dialog-warning">
            <Icon name="shield" />
            <span>语义：只创建新远端分支 · 不强推 · 不覆盖。服务端当前未提供「预览推送」只读读口（C1），确认后只发一次推送；远端同名 / 认证失败会给出服务原因并保留本地提交，不提供自动重试。</span>
          </div>
          {pushMutation.isError ? <FailureNotice error={pushMutation.error} compact /> : null}
        </div>
      </Modal>

      {/* ③ 创建 MR 确认 */}
      <Modal
        open={dialog === 'mr'}
        title="创建合并请求？"
        onClose={() => { setDialog(null); }}
        footer={
          <>
            <Button variant="ghost" onClick={() => { setDialog(null); }}>取消</Button>
            <span className="spacer" />
            <Button
              variant="primary"
              icon="gitRepo"
              disabled={mrBlockedReason !== null || mrMutation.isPending}
              disabledReason={mrMutation.isPending ? '正在创建合并请求，等待服务回执…' : mrBlockedReason ?? undefined}
              onClick={() => { setPendingAction('mr'); mrMutation.mutate(); }}
            >
              {mrMutation.isPending ? '创建中…' : '确认创建'}
            </Button>
          </>
        }
      >
        <div className="stack-loose">
          <div className="delivery-dialog-facts">
            <div className="row-line"><span className="k">源</span><span className="v mono">{pushStep?.remoteRef ?? '—'} @ {pushStep?.pushedSha === undefined ? '—' : shortSha(pushStep.pushedSha)}</span></div>
            <div className="row-line"><span className="k">目标</span><span className="v">
              <select className="select" style={{ height: 30, width: 'auto', display: 'inline-block' }} value={mrTarget} onChange={(event) => { setMrTarget(event.target.value); }}>
                {branches.map((branch) => (
                  <option key={`${branch.kind}:${branch.fullRef}`} value={branch.name}>
                    {branch.kind === 'local' ? '' : '远端 · '}{branch.name}
                  </option>
                ))}
              </select>
              {mrTargetTip === undefined ? ' · 当前 tip 未读取' : ` · tip ${shortSha(mrTargetTip)}`}
            </span></div>
            <div className="row-line"><span className="k">目标 tip 读取于</span><span className="v">{branchesQuery.dataUpdatedAt === 0 ? '未读取' : formatTime(new Date(branchesQuery.dataUpdatedAt).toISOString())}{branchesQuery.isFetching ? ' · 重新读取中…' : ''}</span></div>
            <div className="row-line"><span className="k">评审人</span><span className="v">暂未接通（非必填）</span></div>
          </div>
          <div className="row-wrap">
            <Button variant="ghost" size="sm" icon="refresh" disabled={branchesQuery.isFetching} disabledReason={branchesQuery.isFetching ? '正在重新读取分支…' : undefined} onClick={() => { void branchesQuery.refetch(); }}>
              重新读取目标分支
            </Button>
            <span className="delivery-hint">目标已前移时先用新 tip 重新确认，不拿旧确认直接创建。</span>
          </div>
          <label className="form-label">
            标题 <span className="req">*</span>
            <input className="input" value={mrTitle} maxLength={255} onChange={(event) => { setMrTitle(event.target.value); }} />
          </label>
          <label className="form-label">
            说明
            <textarea className="textarea" value={mrDescription} onChange={(event) => { setMrDescription(event.target.value); }} placeholder="可选：来源任务、验证结论" />
          </label>
          <div className="dialog-warning">
            <Icon name="info" />
            <span>创建成功即完成所选交付，不等待合并。合并在 GitLab 中进行：产品内不提供合并按钮。已有同源 → 目标的打开 MR 时服务会显示原链接，不会重复创建。</span>
          </div>
          {mrMutation.isError ? <FailureNotice error={mrMutation.error} compact /> : null}
        </div>
      </Modal>

    </div>
  );
}
