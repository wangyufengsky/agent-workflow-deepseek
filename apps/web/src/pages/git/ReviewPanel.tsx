import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet } from '../../api/client.ts';
import { Modal } from '../../components/Modal.tsx';
import {
  DIMENSION_ORDER,
  type DimensionValue,
  type FindingStatusValue,
  type SeverityValue,
  type GitCommit,
  type ReviewFinding,
  type ReviewRun,
} from '@agent-workflow/shared';
import {
  classifyGitFailure,
  fetchOperationByKey,
  fetchReview,
  gitKeys,
  startReview,
  stopReview,
  toReceiptView,
  updateFinding,
  type ReceiptView,
} from '../../api/git.ts';
import { useBootstrap } from '../../api/hooks.ts';
import { Badge } from '../../components/Badge.tsx';
import { Button } from '../../components/Button.tsx';
import { Drawer } from '../../components/Drawer.tsx';
import { EmptyState, Skeleton } from '../../components/EmptyState.tsx';
import { Icon } from '../../components/Icon.tsx';
import {
  DIMENSION_ICON,
  DIMENSION_LABEL,
  REVIEW_STAGE_LABEL,
  FailureNotice,
  OperationLookupResult,
  ReadOnlyHint,
  ReceiptBanner,
  SEVERITY_ICON,
  SEVERITY_TONE,
  findingStatusLabel,
  findingStatusTone,
  formatAbsolute,
  formatTime,
  reviewLabel,
  reviewStateTone,
  severityLabel,
  shortSha,
} from './git-shared.tsx';

const ALL_DIMENSIONS = DIMENSION_ORDER;

function shouldRetry(failureCount: number, error: unknown): boolean {
  return classifyGitFailure(error) === 'failed' && failureCount < 2;
}

export interface ReviewPanelProps {
  readonly projectId: string;
  readonly commit: GitCommit;
  readonly reviewRunId: string | undefined;
  readonly selectedFindingIds: ReadonlySet<string>;
  readonly onToggleFinding: (findingId: string, selected: boolean) => void;
  readonly onReviewStarted: (reviewRunId: string) => void;
  readonly onLocate: (finding: ReviewFinding) => void;
  readonly onRequestFix: () => void;
}

interface ReviewFormState {
  readonly compareId: string;
  readonly dimensions: readonly DimensionValue[];
  readonly context: 'diff_only' | 'diff_and_related';
  readonly professionId: string;
  readonly professionRevision: string;
}

/** AI 审查页签：开始审查（抽屉）→ 运行状态 → 结果与问题处理。审查只读。 */
export function ReviewPanel({
  projectId,
  commit,
  reviewRunId,
  selectedFindingIds,
  onToggleFinding,
  onReviewStarted,
  onLocate,
  onRequestFix,
}: ReviewPanelProps) {
  const queryClient = useQueryClient();
  const bootstrap = useBootstrap();
  const [setupOpen, setSetupOpen] = useState(false);
  const [receipt, setReceipt] = useState<ReceiptView | null>(null);
  const [lookupKey, setLookupKey] = useState<string | null>(null);
  const [compareOpen, setCompareOpen] = useState(false);
  const [compareBusy, setCompareBusy] = useState(false);
  const [compareError, setCompareError] = useState<string | undefined>(undefined);
  const [compareResult, setCompareResult] = useState<{ resolved: { title: string }[]; introduced: { title: string }[]; persisting: { title: string }[] } | null>(null);

  const reviewQuery = useQuery({
    queryKey: gitKeys.review(projectId, reviewRunId ?? ''),
    queryFn: () => fetchReview(projectId, reviewRunId ?? ''),
    enabled: reviewRunId !== undefined,
    retry: shouldRetry,
    refetchInterval: (query) => {
      const state = (query.state.data as ReviewRun | undefined)?.state;
      return state === 'running' || state === 'queued' || state === 'stopping' ? 3_000 : false;
    },
  });

  const lookupQuery = useQuery({
    queryKey: gitKeys.operation(lookupKey ?? ''),
    queryFn: () => fetchOperationByKey(lookupKey ?? ''),
    enabled: lookupKey !== null,
    retry: false,
  });

  const stopMutation = useMutation({
    mutationFn: () => stopReview(projectId, reviewRunId ?? ''),
    retry: false,
    onSuccess: (data) => {
      setReceipt(toReceiptView(data.receipt));
      void queryClient.invalidateQueries({ queryKey: gitKeys.review(projectId, reviewRunId ?? '') });
    },
  });

  const findingMutation = useMutation({
    mutationFn: (input: { findingId: string; status: FindingStatusValue; reason?: string }) =>
      updateFinding({ projectId, findingId: input.findingId, status: input.status, reason: input.reason }),
    retry: false,
    onSuccess: (data, variables) => {
      setReceipt(toReceiptView(data.receipt));
      if (variables.status === 'dismissed' || variables.status === 'false_positive') {
        onToggleFinding(variables.findingId, false);
      }
      void queryClient.invalidateQueries({ queryKey: gitKeys.review(projectId, reviewRunId ?? '') });
    },
  });

  const roles = bootstrap.data?.catalog.roles ?? [];
  const firstRole = roles[0];
  const compareOptions = commit.compareOptions;

  const [form, setForm] = useState<ReviewFormState>(() => ({
    compareId: compareOptions[0]?.compareId ?? '',
    dimensions: [...ALL_DIMENSIONS],
    context: 'diff_only',
    professionId: firstRole?.id ?? '',
    professionRevision: firstRole?.revision ?? '',
  }));

  // 目录 / 提交变化后把表单对到新的真实基线与第一个已发布职业；不虚构 Id。
  useEffect(() => {
    setForm((current) => ({
      ...current,
      compareId: compareOptions.some((option) => option.compareId === current.compareId)
        ? current.compareId
        : (compareOptions[0]?.compareId ?? ''),
      professionId: roles.some((role) => role.id === current.professionId)
        ? current.professionId
        : (roles[0]?.id ?? ''),
      professionRevision: roles.some((role) => role.id === current.professionId)
        ? current.professionRevision
        : (roles[0]?.revision ?? ''),
    }));
  }, [commit.sha, compareOptions, roles]);

  const startMutation = useMutation({
    mutationFn: () =>
      startReview({
        projectId,
        sha: commit.sha,
        compareId: form.compareId,
        dimensions: form.dimensions,
        context: form.context,
        professionId: form.professionId,
        professionRevision: form.professionRevision,
      }),
    retry: false,
    onSuccess: (data) => {
      const view = toReceiptView(data.receipt);
      setReceipt(view);
      const review = data.resource?.review;
      if (review !== undefined && view.status !== 'unknown' && view.status !== 'failed') {
        setSetupOpen(false);
        onReviewStarted(review.reviewRunId);
      }
    },
  });

  const review = reviewQuery.data;
  const findings = review?.findings ?? [];
  const selectedCount = findings.filter((finding) => selectedFindingIds.has(finding.findingId)).length;

  const countsBySeverity = useMemo<Record<SeverityValue, number> | null>(() => {
    if (review === undefined) return null;
    if (review.summary !== undefined) return review.summary.countsBySeverity;
    const base: Record<SeverityValue, number> = { blocker: 0, critical: 0, major: 0, suggestion: 0 };
    for (const finding of findings) base[finding.severity] += 1;
    return base;
  }, [findings, review]);

  const startBlockedReason =
    compareOptions.length === 0
      ? '服务没有提供可对比的基线（compareOptions 为空），不能开始审查。'
      : form.dimensions.length === 0
        ? '至少选择一个审查维度。'
        : roles.length === 0
          ? '取不到已发布的审查职业；目录未加载时不开始审查。'
          : form.professionId.length === 0
            ? '没有选中审查职业；职业版本是审查冻结的一部分。'
          : form.compareId.length === 0
            ? '请选择审查范围。'
            : null;

  return (
    <div className="stack-loose">
      <ReadOnlyHint>AI 审查只读取改动与相关文件，不写仓库、不改工作区；提交、推送与合并只能由你点击触发。</ReadOnlyHint>

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

      <div className="review-toolbar">
        {review === undefined ? null : (
          <>
            <Badge tone={reviewStateTone(review.state)} icon={review.state === 'completed' ? 'check' : review.state === 'running' ? 'sparkle' : 'alert'}>
              {reviewLabel(review.state)}
            </Badge>
            <span className="muted-note">
              第 {String(review.ordinal)} 次审查 · {review.profession.displayName} · {review.context === 'diff_only' ? '只读改动' : '改动 + 相关文件'}
            </span>
          </>
        )}
        <span className="spacer" />
        {reviewRunId === undefined ? (
          <Button variant="primary" size="sm" icon="sparkle" disabled={startBlockedReason !== null} disabledReason={startBlockedReason ?? undefined} onClick={() => { setSetupOpen(true); }}>
            AI 审查此提交
          </Button>
        ) : (
          <>
            {review?.state === 'running' || review?.state === 'stopping' ? (
              <Button variant="secondary" size="sm" icon="stop" disabled={stopMutation.isPending || review.state === 'stopping'} disabledReason={review.state === 'stopping' ? '服务正在停止审查；停止请求不等于已停止。' : undefined} onClick={() => { stopMutation.mutate(); }}>
                停止审查
              </Button>
            ) : (
              <Button variant="secondary" size="sm" icon="refresh" disabled={startBlockedReason !== null} disabledReason={startBlockedReason ?? undefined} onClick={() => { setSetupOpen(true); }}>
                再次审查
              </Button>
            )}
            <Button variant="ghost" size="sm" icon="refresh" onClick={() => { void reviewQuery.refetch(); }}>
              重新读取
            </Button>
          </>
        )}
      </div>

      {reviewQuery.isPending && reviewRunId !== undefined ? (
        <div className="stack-tight">
          <Skeleton height={14} />
          <Skeleton width="76%" height={12} />
        </div>
      ) : reviewQuery.isError ? (
        <FailureNotice error={reviewQuery.error} onRetry={() => { void reviewQuery.refetch(); }} />
      ) : review === undefined ? (
        <EmptyState
          icon="sparkle"
          title="这个提交还没有 AI 审查"
          description="审查是只读任务：选择范围、维度与职业后由服务执行。审查结果未知时只会「核对原操作」，不会重发。"
          action={
            <Button variant="primary" icon="sparkle" disabled={startBlockedReason !== null} disabledReason={startBlockedReason ?? undefined} onClick={() => { setSetupOpen(true); }}>
              开始审查
            </Button>
          }
        />
      ) : (
        <>
          <div className="review-summary-card">
            <div className="row-wrap">
              <Badge tone={reviewStateTone(review.state)} icon={review.state === 'completed' ? 'check' : 'alert'}>
                {reviewLabel(review.state)}
              </Badge>
              <span className="muted-note">
                对比 {review.subject.compareBase.label} · base {shortSha(review.subject.compareBase.baseSha)} · 提交 {shortSha(review.subject.commitSha)}
              </span>
              <span className="grow" />
              {review.startedAt === undefined ? null : <span className="muted-note">开始于 {formatTime(review.startedAt)}</span>}
              {review.endedAt === undefined ? null : <span className="muted-note">结束于 {formatAbsolute(review.endedAt)}</span>}
            </div>
            {review.stage === undefined ? null : (
              <div className="review-summary-text">当前阶段：{REVIEW_STAGE_LABEL[review.stage] ?? review.stage}</div>
            )}
            {review.summary === undefined ? (
              <div className="review-summary-text muted">
                {review.state === 'completed'
                  ? '服务没有返回结论文本；问题列表仍按下方的真实数据展示。'
                  : review.state === 'failed'
                    ? '审查没有完成。历史审查记录不受影响；可以重新审查（新开一次）。'
                    : review.state === 'unknown'
                      ? '审查结果未知：只核对原操作，不重发。'
                      : '审查进行中；不显示假百分比，阶段由服务给出。'}
              </div>
            ) : (
              <div className="review-summary-text">{review.summary.text}</div>
            )}
            {review.summary === undefined || countsBySeverity === null ? null : (
              <>
                <div className="review-counts">
                  {(['blocker', 'critical', 'major', 'suggestion'] as const).map((severity) => (
                    <Badge key={severity} tone={SEVERITY_TONE[severity]} icon={SEVERITY_ICON[severity]}>
                      {severityLabel(severity)} {String(countsBySeverity[severity] ?? 0)}
                    </Badge>
                  ))}
                </div>
                <div className="review-dimension-list">
                  {DIMENSION_ORDER.map((dimension) => (
                    <Badge key={dimension} outline icon={DIMENSION_ICON[dimension]} tone="neutral">
                      {DIMENSION_LABEL[dimension]} {String(review.summary?.countsByDimension[dimension] ?? 0)}
                    </Badge>
                  ))}
                </div>
              </>
            )}
          </div>

          <div className="review-toolbar">
            <h3 style={{ fontSize: 13.5, fontWeight: 500 }}>问题列表</h3>
            <Badge tone="neutral">{String(findings.length)}</Badge>
            <span className="spacer" />
            <Button
              variant="ghost"
              size="sm"
              icon="refresh"
              disabled={reviewRunId === undefined || compareBusy}
              onClick={() => {
                if (reviewRunId === undefined) return;
                setCompareBusy(true);
                setCompareError(undefined);
                void (async () => {
                  try {
                    const list = (await apiGet<{ reviews: { reviewRunId: string }[] }>(`/api/git/repos/${encodeURIComponent(projectId)}/commits/${encodeURIComponent(commit.sha)}/reviews`)).data.reviews;
                    const previous = list.find((item) => item.reviewRunId !== reviewRunId);
                    if (previous === undefined) throw new Error('这个提交还没有更早的审查可对比');
                    const comparison = (await apiGet<{ resolved: { title: string }[]; introduced: { title: string }[]; persisting: { title: string }[] }>(`/api/git/repos/${encodeURIComponent(projectId)}/reviews/${encodeURIComponent(previous.reviewRunId)}/compare/${encodeURIComponent(reviewRunId)}`)).data;
                    setCompareResult(comparison);
                    setCompareOpen(true);
                  } catch (error) {
                    setCompareError(error instanceof Error ? error.message : '对比失败');
                  } finally {
                    setCompareBusy(false);
                  }
                })();
              }}
            >
              {compareBusy ? '对比中…' : '对比上次审查'}
            </Button>
            <span className="muted-note">接受 / 忽略 / 误报会写入审查问题状态；忽略与误报不能被选入修复。</span>
          </div>

          {findings.length === 0 ? (
            <EmptyState
              compact
              icon="check"
              title={review.state === 'completed' ? '没有发现需要处理的问题' : '还没有问题数据'}
              description={review.state === 'completed' ? '结论由服务汇总；修复页签在无问题时不可选。' : '审查未完成或结果未知时，不推断“没有问题”。'}
            />
          ) : (
            <div className="list-cards">
              {findings.map((finding) => {
                const selected = selectedFindingIds.has(finding.findingId);
                const selectable = finding.status === 'open' || finding.status === 'accepted';
                const busy = findingMutation.isPending && findingMutation.variables?.findingId === finding.findingId;
                return (
                  <div key={finding.findingId} className={['finding-card', `sev-${finding.severity}`, finding.status !== 'open' ? 'resolved' : ''].filter(Boolean).join(' ')}>
                    <div className="finding-head">
                      <Badge tone={SEVERITY_TONE[finding.severity]} icon={SEVERITY_ICON[finding.severity]}>
                        {severityLabel(finding.severity)}
                      </Badge>
                      <Badge outline icon={DIMENSION_ICON[finding.dimension]} tone="neutral">
                        {DIMENSION_LABEL[finding.dimension]}
                      </Badge>
                      <span className="finding-title">{finding.title}</span>
                      <Badge tone={findingStatusTone(finding.status)}>{findingStatusLabel(finding.status)}</Badge>
                    </div>
                    {finding.location === undefined ? null : (
                      <span>
                        <button
                          type="button"
                          className="finding-loc"
                          title="在 diff 中定位"
                          onClick={() => { onLocate(finding); }}
                        >
                          <Icon name="target" size="sm" />
                          {finding.location.path}:{String(finding.location.startLine)}–{String(finding.location.endLine)} · {finding.location.side === 'new' ? '新版本' : '旧版本'}
                        </button>
                      </span>
                    )}
                    <div className="finding-detail">{finding.detail}</div>
                    {finding.statusReason === undefined ? null : <div className="finding-status-note">状态原因：{finding.statusReason}</div>}
                    <div className="finding-actions">
                      <Button variant="ghost" size="sm" icon="check" disabled={busy || finding.status === 'accepted'} disabledReason={finding.status === 'accepted' ? '已标记为接受。' : undefined} onClick={() => { findingMutation.mutate({ findingId: finding.findingId, status: 'accepted' }); }}>
                        接受
                      </Button>
                      <Button variant="ghost" size="sm" icon="eye" disabled={busy || finding.status === 'dismissed'} disabledReason={finding.status === 'dismissed' ? '已忽略。' : undefined} onClick={() => { findingMutation.mutate({ findingId: finding.findingId, status: 'dismissed' }); }}>
                        忽略
                      </Button>
                      <Button variant="ghost" size="sm" icon="x" disabled={busy || finding.status === 'false_positive'} disabledReason={finding.status === 'false_positive' ? '已标记为误报。' : undefined} onClick={() => { findingMutation.mutate({ findingId: finding.findingId, status: 'false_positive' }); }}>
                        误报
                      </Button>
                      {finding.status === 'open' ? null : (
                        <Button variant="ghost" size="sm" icon="undo" disabled={busy} onClick={() => { findingMutation.mutate({ findingId: finding.findingId, status: 'open' }); }}>
                          恢复待处理
                        </Button>
                      )}
                      <span className="spacer" />
                      <label className="finding-selected" title={selectable ? undefined : '忽略或误报的问题不能选入修复'}>
                        <input
                          type="checkbox"
                          checked={selected}
                          disabled={!selectable}
                          onChange={(event) => { onToggleFinding(finding.findingId, event.target.checked); }}
                        />
                        选入修复
                      </label>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {findingMutation.isError ? <FailureNotice error={findingMutation.error} compact /> : null}

          <div className="review-sticky-foot">
            <span className="muted-note">
              已选 {String(selectedCount)} 个问题
              {reviewRunId === undefined ? '' : ` · 失败候选或未知问题不会自动选中`}
            </span>
            <span className="spacer" />
            <Button variant="primary" size="sm" icon="wand" disabled={selectedCount === 0 || review.state !== 'completed'} disabledReason={selectedCount === 0 ? '先在问题列表勾选要修复的问题。' : review.state !== 'completed' ? '审查完成后才能开始修复。' : undefined} onClick={onRequestFix}>
              AI 修复所选问题
            </Button>
          </div>
        </>
      )}

      <Drawer
        open={setupOpen}
        title="AI 审查此提交"
        size="md"
        onClose={() => { setSetupOpen(false); }}
        footer={
          <>
            <Button variant="ghost" onClick={() => { setSetupOpen(false); }}>取消</Button>
            <span className="spacer" />
            <Button
              variant="primary"
              icon="sparkle"
              disabled={startMutation.isPending || startBlockedReason !== null}
              disabledReason={startBlockedReason ?? undefined}
              onClick={() => { startMutation.mutate(); }}
            >
              {startMutation.isPending ? '提交中…' : '开始审查'}
            </Button>
          </>
        }
      >
        <div className="stack-loose">
          <ReadOnlyHint>审查只读：不写仓库、不改工作区、不提交。范围、维度、职业与上下文会冻结在这次审查里。</ReadOnlyHint>
          {startMutation.isError ? <FailureNotice error={startMutation.error} compact /> : null}

          <div className="review-form-section">
            <span className="rail-cap">范围</span>
            {compareOptions.length === 0 ? (
              <div className="banner warn">
                <Icon name="alert" />
                <div className="grow">服务没有提供可对比的基线。合并提交需要先选择对比哪个父提交；没有 compareOptions 时不开始审查。</div>
              </div>
            ) : (
              <div className="radio-card-list">
                {compareOptions.map((option) => (
                  <label key={option.compareId} className="radio-card" data-checked={form.compareId === option.compareId}>
                    <input
                      type="radio"
                      name="review-compare"
                      checked={form.compareId === option.compareId}
                      onChange={() => { setForm((current) => ({ ...current, compareId: option.compareId })); }}
                    />
                    <span>
                      <span className="radio-title">
                        {option.label}
                        <Badge outline tone="neutral">
                          {option.kind === 'parent' ? '对比父提交' : option.kind === 'empty_tree' ? '对比空树（根提交）' : '对比目标分支'}
                        </Badge>
                      </span>
                      <span className="radio-desc mono-sm">base {option.baseSha}</span>
                    </span>
                  </label>
                ))}
              </div>
            )}
          </div>

          <div className="review-form-section">
            <span className="rail-cap">维度（多选）</span>
            <div className="dimension-grid">
              {ALL_DIMENSIONS.map((dimension) => {
                const checked = form.dimensions.includes(dimension);
                return (
                  <label key={dimension} className="dimension-check">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => {
                        setForm((current) => ({
                          ...current,
                          dimensions: checked
                            ? current.dimensions.filter((item) => item !== dimension)
                            : [...current.dimensions, dimension],
                        }));
                      }}
                    />
                    <Icon name={DIMENSION_ICON[dimension]} size="sm" />
                    {DIMENSION_LABEL[dimension]}
                  </label>
                );
              })}
            </div>
            {form.dimensions.length === 0 ? <span className="action-reason"><Icon name="lock" size="sm" />至少选择一个维度。</span> : null}
          </div>

          <div className="review-form-section">
            <span className="rail-cap">审查职业</span>
            {roles.length === 0 ? (
              <div className="banner warn">
                <Icon name="lock" />
                <div className="grow">目录没有加载到已发布的职业；职业是审查的冻结版本，缺失时不开始审查。</div>
              </div>
            ) : (
              <select
                className="select"
                value={form.professionId}
                onChange={(event) => {
                  const role = roles.find((item) => item.id === event.target.value);
                  setForm((current) => ({
                    ...current,
                    professionId: role?.id ?? '',
                    professionRevision: role?.revision ?? '',
                  }));
                }}
              >
                {roles.map((role) => (
                  <option key={role.id} value={role.id}>
                    {role.name} · 修订 {role.revision}
                  </option>
                ))}
              </select>
            )}
            <span className="hint">职业版本冻结在审查记录里；界面不提供临时改写。</span>
          </div>

          <div className="review-form-section">
            <span className="rail-cap">上下文</span>
            <div className="radio-card-list">
              <label className="radio-card" data-checked={form.context === 'diff_only'}>
                <input type="radio" name="review-context" checked={form.context === 'diff_only'} onChange={() => { setForm((current) => ({ ...current, context: 'diff_only' })); }} />
                <span>
                  <span className="radio-title">只读改动</span>
                  <span className="radio-desc">只读取 diff，范围最小。</span>
                </span>
              </label>
              <label className="radio-card" data-checked={form.context === 'diff_and_related'}>
                <input type="radio" name="review-context" checked={form.context === 'diff_and_related'} onChange={() => { setForm((current) => ({ ...current, context: 'diff_and_related' })); }} />
                <span>
                  <span className="radio-title">改动 + 相关文件</span>
                  <span className="radio-desc">额外读取与改动相关的文件；读取范围由服务限定。</span>
                </span>
              </label>
            </div>
          </div>

          {startBlockedReason === null ? null : (
            <div className="action-reason">
              <Icon name="lock" size="sm" />
              {startBlockedReason}
            </div>
          )}
          {receipt !== null && setupOpen ? <ReceiptBanner receipt={receipt} onVerify={(key) => { setLookupKey(key); }} verifying={lookupQuery.isFetching} /> : null}
        </div>
      </Drawer>

      <Modal open={compareOpen} title="审查对比" onClose={() => { setCompareOpen(false); }} footer={<Button variant="ghost" onClick={() => { setCompareOpen(false); }}>关闭</Button>}>
        {compareResult === null ? null : (
          <div className="col" style={{ gap: 12 }}>
            <p className="hint">与同一提交的上一次审查按「维度 + 位置 + 标题」匹配；仅比较问题清单，不推断代码质量。</p>
            {(['resolved', 'introduced', 'persisting'] as const).map((bucket) => (
              <div key={bucket}>
                <div className="row" style={{ gap: 8 }}>
                  <span className="section-title">{bucket === 'resolved' ? '已解决' : bucket === 'introduced' ? '新发现' : '仍存在'}</span>
                  <Badge tone="neutral">{String(compareResult[bucket].length)}</Badge>
                </div>
                {compareResult[bucket].length === 0 ? <p className="hint">无</p> : compareResult[bucket].map((item, index) => <p key={`${bucket}-${String(index)}`} className="hint">· {item.title}</p>)}
              </div>
            ))}
          </div>
        )}
      </Modal>
    </div>
  );
}
