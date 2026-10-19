import { QuestionInput, questionDraft, hasQuestionAnswer, type QuestionDraft } from '../../components/QuestionInput.tsx';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  InboxKind,
  InteractionKind,
  InteractionState,
  type InboxItem,
  type InteractionCapabilitiesView,
  type InteractionDetail,
  type InteractionKindValue,
  type InteractionQuestion,
  type InteractionResolveRequest,
  type InteractionSummary,
  type OperationReceipt,
} from '@agent-workflow/shared';
import { errorMessage } from '../../api/client.ts';
import { useBootstrap } from '../../api/hooks.ts';
import { formatRelativeTime } from '../../app/format.ts';
import { Badge, type BadgeTone } from '../../components/Badge.tsx';
import { Button, LinkButton } from '../../components/Button.tsx';
import { PageHeader } from '../../components/Card.tsx';
import { EmptyState, Skeleton, SkeletonText } from '../../components/EmptyState.tsx';
import { Icon, type IconName } from '../../components/Icon.tsx';
import { Modal } from '../../components/Modal.tsx';
import { ServiceNotice } from '../../components/ServiceNotice.tsx';
import { CommandErrorNotice, ReceiptNotice } from '../../flow/workflow-ui.tsx';
import { fetchInteraction, fetchInteractions, resolveInteraction } from './interactions.ts';
import './inbox.css';

type InboxFilter = 'all' | 'planning_question' | 'planning_review' | 'planning_reconcile' | 'permissions';

interface KindMeta {
  readonly label: string;
  readonly shortLabel: string;
  readonly icon: IconName;
  readonly tone: BadgeTone;
  readonly sourceHint: string;
}

const KIND_META: Record<InteractionKindValue, KindMeta> = {
  [InteractionKind.PLANNING_QUESTION]: {
    label: '需要你回答',
    shortLabel: '问题',
    icon: 'help',
    tone: 'wait',
    sourceHint: '等你回答，其他步骤继续',
  },
  [InteractionKind.PLANNING_REVIEW]: {
    label: '候选待审阅',
    shortLabel: '审阅',
    icon: 'eye',
    tone: 'wait',
    sourceHint: '候选需要你在需求画布审阅；本事项不能就地提交',
  },
  [InteractionKind.PLANNING_RECONCILE]: {
    label: '状态待核对',
    shortLabel: '核对',
    icon: 'help',
    tone: 'unknown',
    sourceHint: '结果未明；只核对原轮次，不会自动重发',
  },
};

const FILTERS: readonly { readonly value: InboxFilter; readonly label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'planning_question', label: '需要回答' },
  { value: 'planning_review', label: '待审阅' },
  { value: 'planning_reconcile', label: '待核对' },
  { value: 'permissions', label: '权限/策略' },
];

const OTHER_KINDS: readonly string[] = [InboxKind.DELIVERY_CONFIRM, InboxKind.EXECUTION_FAILED];

interface ResolveState {
  readonly interactionId: string;
  readonly receipt?: OperationReceipt;
  readonly error?: unknown;
}

interface ResolveInput {
  readonly interactionId: string;
  readonly answers: InteractionResolveRequest['answers'];
}

type DraftMap = Record<string, Record<string, QuestionDraft>>;

function targetHref(item: InboxItem): string {
  const base =
    item.kind === InboxKind.DELIVERY_CONFIRM || item.kind === InboxKind.EXECUTION_FAILED
      ? `/tasks/${encodeURIComponent(item.taskId)}`
      : `/requirement/${encodeURIComponent(item.taskId)}`;
  return `${base}?returnTo=${encodeURIComponent('/inbox')}`;
}

function otherKindLabel(kind: InboxItem['kind']): { readonly label: string; readonly icon: IconName; readonly tone: BadgeTone } {
  if (kind === InboxKind.DELIVERY_CONFIRM) return { label: '交付确认', icon: 'upload', tone: 'wait' };
  if (kind === InboxKind.EXECUTION_FAILED) return { label: '执行失败', icon: 'alert', tone: 'stall' };
  return { label: '规划事项', icon: 'flow', tone: 'wait' };
}

function InteractionRow({
  item,
  selected,
  draft,
  onSelect,
}: {
  readonly item: InteractionSummary;
  readonly selected: boolean;
  readonly draft: boolean;
  readonly onSelect: () => void;
}) {
  const meta = KIND_META[item.kind];
  return (
    <button type="button" className="list-row inbox-row" aria-selected={selected} onClick={onSelect}>
      <span className="tile">
        <Icon name={meta.icon} />
      </span>
      <span className="grow" style={{ minWidth: 0 }}>
        <span className="inbox-row-title">{item.title}</span>
        <span className="inbox-row-meta">
          {meta.shortLabel} · {item.stepName} · {formatRelativeTime(item.updatedAt)}
        </span>
        <span className="inbox-row-meta">{item.taskTitle} · {item.projectName}</span>
        <span className="inbox-row-badges">
          {item.state === InteractionState.UNKNOWN ? <Badge tone="unknown" icon="help">结果待核对</Badge> : null}
          {draft ? <Badge tone="accent" icon="edit">有草稿</Badge> : null}
        </span>
      </span>
      <Icon name="chevRight" size="sm" />
    </button>
  );
}

function OtherInboxEntries({ items }: { readonly items: readonly InboxItem[] }) {
  if (items.length === 0) return null;
  return (
    <section className="card" aria-label="需在画布处理的事项">
      <div className="card-head">
        <span className="tile"><Icon name="inbox" /></span>
        <div className="grow">
          <span className="section-title">需在画布处理</span>
          <div className="hint" style={{ marginTop: 2 }}>这些汇总事项暂无就地交互，仍可打开对应画布处理。</div>
        </div>
        <Badge tone="neutral">{String(items.length)}</Badge>
      </div>
      <div className="inbox-other-grid">
        {items.map((item) => {
          const meta = otherKindLabel(item.kind);
          return (
            <Link key={item.id} className="list-row" to={targetHref(item)}>
              <Badge tone={meta.tone} icon={meta.icon}>{meta.label}</Badge>
              <span className="grow" style={{ minWidth: 0 }}>
                <span className="inbox-other-title">{item.title}</span>
                <span className="inbox-row-meta">{item.taskTitle} · {item.projectName} · {formatRelativeTime(item.createdAt)}</span>
              </span>
              <Icon name="chevRight" size="sm" />
            </Link>
          );
        })}
      </div>
    </section>
  );
}

function InteractionSkeleton() {
  return (
    <div className="card solid">
      <div className="inbox-detail-skeleton">
        <SkeletonText lines={3} />
        <div style={{ marginTop: 18 }}>
          <Skeleton height={38} radius={12} />
        </div>
        <div style={{ marginTop: 18 }}>
          <SkeletonText lines={6} />
        </div>
      </div>
    </div>
  );
}

function PermissionsUnavailable({ capabilities }: { readonly capabilities?: InteractionCapabilitiesView }) {
  const reason = capabilities?.reason
    ?? '受管 OpenCode + 内部 MCP 架构没有权限/策略请求来源；服务不会伪造此类事项。';
  return (
    <section className="card solid" aria-label="权限与策略请求不可用">
      <div className="inbox-detail-card">
        <div className="row wrap" style={{ gap: 8 }}>
          <Badge tone="unknown" icon="help">服务未提供</Badge>
          <h2 style={{ fontSize: 19, fontWeight: 500, margin: 0 }}>权限与策略请求</h2>
        </div>
        <p className="sub" style={{ marginTop: 10, lineHeight: 1.7 }}>
          {reason}
        </p>

        <div className="inbox-scope-grid">
          <div className="card pad inbox-scope-card">
            <div className="row" style={{ gap: 8 }}>
              <span className="grow" style={{ fontSize: 13.5, fontWeight: 500 }}>仅这一次</span>
              <Badge tone="idle" icon="lock">不可用</Badge>
            </div>
            <p className="hint" style={{ marginTop: 4, lineHeight: 1.6 }}>只允许当前这一次写入；服务没有权限请求来源，无法提交。</p>
          </div>
          <div className="card pad inbox-scope-card">
            <div className="row" style={{ gap: 8 }}>
              <span className="grow" style={{ fontSize: 13.5, fontWeight: 500 }}>本次会话内都允许</span>
              <Badge tone="idle" icon="lock">不可用</Badge>
            </div>
            <p className="hint" style={{ marginTop: 4, lineHeight: 1.6 }}>会话内同类操作自动允许；服务没有权限请求来源，无法提交。</p>
          </div>
        </div>

        <div className="banner danger" style={{ marginTop: 14 }}>
          <Icon name="shield" />
          <div className="grow">
            <b>策略禁止也需要真实来源。</b>
            <br />
            当前没有策略禁止事项；这里只显示能力原因，不伪造「知道了」结果。
          </div>
          <div className="actions">
            <Button
              variant="secondary"
              size="sm"
              disabled
              disabledReason="服务未提供策略禁止事项来源。"
            >
              知道了
            </Button>
          </div>
        </div>

        <div className="inbox-foot" style={{ margin: '18px -22px 0', paddingLeft: 22, paddingRight: 22 }}>
          <Button variant="ghost" disabled disabledReason="服务未提供权限/策略请求来源。">拒绝</Button>
          <span className="grow" />
          <Button variant="secondary" disabled disabledReason="服务未提供权限/策略请求来源。">本次会话都允许</Button>
          <Button variant="primary" disabled disabledReason="服务未提供权限/策略请求来源。">允许这一次</Button>
        </div>
      </div>
    </section>
  );
}

function effectiveAnswer(
  drafts: DraftMap,
  interactionId: string,
  question: InteractionQuestion,
): QuestionDraft {
  return drafts[interactionId]?.[question.id] ?? questionDraft(question);
}

function InteractionDetailPanel({
  detail,
  loading,
  error,
  drafts,
  resolveState,
  resolvePending,
  onRetry,
  onUpdateDraft,
  onResolve,
}: {
  readonly detail?: InteractionDetail;
  readonly loading: boolean;
  readonly error: unknown;
  readonly drafts: DraftMap;
  readonly resolveState?: ResolveState;
  readonly resolvePending: boolean;
  readonly onRetry: () => void;
  readonly onUpdateDraft: (questionId: string, value: QuestionDraft) => void;
  readonly onResolve: (answers: InteractionResolveRequest['answers']) => void;
}) {
  if (loading) return <InteractionSkeleton />;

  if (error !== null && error !== undefined) {
    return (
      <section className="card solid">
        <div className="inbox-detail-skeleton">
          <ServiceNotice error={error} title="事项详情读取失败" onRetry={onRetry} />
          <p className="hint" style={{ marginTop: 10 }}>列表仍保留；不会用列表摘要冒充可回答的问题。</p>
        </div>
      </section>
    );
  }

  if (detail === undefined) {
    return (
      <section className="card solid">
        <div className="inbox-detail-skeleton">
          <EmptyState icon="inbox" title="没有可显示的事项" description="服务没有返回事项详情；本页不会伪造问题或权限。" />
        </div>
      </section>
    );
  }

  const meta = KIND_META[detail.kind];
  const receipt = resolveState?.receipt;
  const receiptStatus = receipt?.status;
  const locked = receiptStatus === 'accepted' || receiptStatus === 'unknown' || receiptStatus === 'succeeded';
  const resolved = detail.state === InteractionState.RESOLVED || detail.resolvedAt !== undefined;
  const isQuestion = detail.kind === InteractionKind.PLANNING_QUESTION;
  const values = detail.questions.map((question) => ({
    question,
    value: effectiveAnswer(drafts, detail.id, question),
  }));
  const answeredCount = values.filter((item) => hasQuestionAnswer(item.value)).length;
  const missingRequired = values.filter((item) => item.question.required && !hasQuestionAnswer(item.value)).length;
  const answers: InteractionResolveRequest['answers'] = values
    .filter((item) => hasQuestionAnswer(item.value))
    .map((item) => ({ questionId: item.question.id, values: item.value.values, other: item.value.other.trim() }));

  const submitReason = !detail.resolve.allowed
    ? (detail.resolve.reason ?? '服务不允许在此提交这个事项。')
    : locked
      ? '已提交，等待回执或核对；内容已锁定，不会重复提交。'
      : resolved
        ? '该事项已经处理。'
        : resolvePending
          ? '正在提交，等待服务回执…'
          : detail.questions.length === 0
            ? '服务没有返回可回答的问题。'
            : answers.length === 0
              ? '至少填写一项回答。'
              : missingRequired > 0
                ? `还有 ${String(missingRequired)} 道必答题未填写。`
                : undefined;

  return (
    <section className="card solid" aria-label="待处理事项详情">
      <div className="inbox-detail-card">
        <div className="inbox-detail-head">
          <div className="row wrap" style={{ gap: 6 }}>
            <Badge tone={meta.tone} icon={meta.icon}>{meta.label}</Badge>
            {detail.state === InteractionState.UNKNOWN ? <Badge tone="unknown" icon="help">结果待核对</Badge> : null}
            {resolved ? <Badge tone="done" icon="check">已处理</Badge> : null}
          </div>
          <h2>{detail.title}</h2>
          <p className="sub" style={{ marginTop: 8, lineHeight: 1.7 }}>{detail.summary}</p>

          <div className="inbox-source">
            <Icon name="flow" size="sm" />
            <span>
              <b>{detail.taskTitle}</b>
              <span className="muted"> · </span>
              {detail.stepName}
              <span className="muted"> · 第 {String(detail.roundOrdinal)} 轮</span>
            </span>
            <span className="hint">{meta.sourceHint}</span>
            <span className="spacer" />
            <Link className="btn ghost sm" to={detail.returnTo}>
              {detail.returnTo.includes('/tasks/') ? '在任务画布中查看' : '在需求画布中查看'}
              <Icon name="chevRight" size="sm" />
            </Link>
          </div>
        </div>

        {detail.unknown === undefined ? null : (
          <div className="banner unknown" style={{ marginTop: 14 }}>
            <Icon name="help" />
            <div className="grow">
              <b>结果未明，内容只读。</b>
              <br />
              {detail.unknown.message}
              <span style={{ display: 'block', marginTop: 4 }}>只能重新读取或按原请求号核对，不会自动重发。</span>
            </div>
            <div className="actions">
              <Button variant="secondary" size="sm" icon="refresh" onClick={onRetry}>
                重新读取事项
              </Button>
            </div>
          </div>
        )}

        {detail.resolve.allowed ? null : (
          <div className="banner warn" style={{ marginTop: 14 }}>
            <Icon name="lock" />
            <div className="grow">
              <b>不能在这里提交。</b>
              <br />
              {detail.resolve.reason ?? '该事项需要在需求画布处理。'}
            </div>
          </div>
        )}

        {isQuestion ? (
          <>
            <p className="hint" style={{ marginTop: 14 }}>{detail.degradation.reason}</p>

            <div className="inbox-questions">
              {detail.questions.length === 0 ? (
                <p className="hint" style={{ padding: '14px 0' }}>服务没有返回问题；不会补造问题或选项。</p>
              ) : (
                detail.questions.map((question, index) => {
                  const value = effectiveAnswer(drafts, detail.id, question);
                  return (
                    <div className="inbox-question" key={question.id}>
                      <div className="inbox-question-head">
                        <span className="n">{String(index + 1)} / {String(detail.questions.length)}</span>
                        <b>{question.title}</b>
                        <Badge tone={question.required ? 'wait' : 'idle'}>{question.required ? '必答' : '可选'}</Badge>
                        {question.answered ? <Badge tone="ok" icon="check">已有答复</Badge> : null}
                        <Badge outline>{question.inputMode === 'free_text' ? '文本回答' : question.multiple ? '多选' : '单选'}</Badge>
                      </div>
                      {question.answered && question.answer !== undefined ? (
                        <p className="hint" style={{ marginBottom: 6 }}>
                          服务已有答复：{question.answer}
                        </p>
                      ) : null}
                      <QuestionInput id={`inbox-q-${detail.id}-${question.id}`} title={question.title} question={question} value={value} disabled={locked || resolved || !detail.resolve.allowed} onChange={(draft) => onUpdateDraft(question.id, draft)} />
                      {question.affectedNodeIds.length === 0 ? null : (
                        <span className="inbox-answer-hint">
                          <Icon name="flow" size="sm" />
                          影响 {String(question.affectedNodeIds.length)} 个计划步骤
                        </span>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </>
        ) : (
          <>
            {detail.candidate === undefined ? null : (
              <div className="card pad" style={{ marginTop: 14 }}>
                <div className="row wrap" style={{ gap: 8 }}>
                  <Badge tone={detail.candidate.validationState === 'passed' ? 'ok' : 'warn'} icon={detail.candidate.validationState === 'passed' ? 'check' : 'alert'}>
                    结构检查 {detail.candidate.validationState === 'passed' ? '通过' : '未通过'}
                  </Badge>
                  <Badge outline>{String(detail.candidate.diffCount)} 处候选差异</Badge>
                </div>
                <p className="sub" style={{ marginTop: 8, lineHeight: 1.7 }}>{detail.candidate.summary}</p>
                <p className="hint" style={{ marginTop: 6 }}>候选只读；应用或不采用都在需求画布完成。</p>
              </div>
            )}
            <div className="banner info" style={{ marginTop: 14 }}>
              <Icon name="info" />
              <div className="grow">
                {detail.kind === InteractionKind.PLANNING_RECONCILE
                  ? '这是停止/结果核对事项，没有可提交的答案；请到需求画布核对原轮次。'
                  : '候选审阅在需求画布完成；本页只提供来源与真实状态。'}
              </div>
            </div>
          </>
        )}

        {receipt === undefined ? null : (
          <div style={{ marginTop: 14 }}>
            <ReceiptNotice receipt={receipt} successMessage="回答已提交，需求修订已更新。" />
          </div>
        )}
        {resolveState?.error === undefined ? null : (
          <div style={{ marginTop: 10 }}>
            <CommandErrorNotice error={resolveState.error} title="回答未提交" />
          </div>
        )}
      </div>

      <div className="inbox-foot">
        {isQuestion ? (
          <>
            <Button
              variant="ghost"
              disabled
              disabledReason={detail.resolve.reason ?? '规划问题必须明确回答；服务没有提供拒绝接口。'}
            >
              拒绝回答
            </Button>
            <span className="hint grow">
              已回答 {String(answeredCount)} / {String(detail.questions.length)} · 必答题需填写
            </span>
            <Button
              variant="secondary"
              disabled={locked || resolved || !detail.resolve.allowed || !detail.questions.some((question) => question.options?.some((option) => option.recommended))}
              disabledReason={detail.resolve.reason ?? '本轮问题没有提供推荐选项，或答复已经提交'}
              onClick={() => { for (const question of detail.questions) {
                const recommended = question.options?.filter((option) => option.recommended).map((option) => option.id) ?? [];
                if (recommended.length) onUpdateDraft(question.id, { ...effectiveAnswer(drafts, detail.id, question), values: question.multiple ? recommended : recommended.slice(0, 1) });
              } }}
            >
              采用推荐答案
            </Button>
            <Button
              variant="primary"
              icon="check"
              disabled={submitReason !== undefined}
              disabledReason={submitReason}
              onClick={() => { onResolve(answers); }}
            >
              {resolvePending ? '提交中…' : '提交回答'}
            </Button>
            {detail.resolve.allowed && detail.resolve.reason !== undefined ? (
              <span className="action-reason" style={{ flexBasis: '100%' }} role="note">
                <Icon name="lock" size="sm" />
                {detail.resolve.reason}
              </span>
            ) : null}
          </>
        ) : (
          <>
            <span className="hint grow">该事项不能在本接口提交；请到需求画布操作，避免绕过真实状态机。</span>
            <LinkButton to={detail.returnTo} variant="secondary" size="sm" icon="file">
              去需求画布
            </LinkButton>
          </>
        )}
      </div>
    </section>
  );
}

export function InboxPage() {
  const bootstrap = useBootstrap();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<InboxFilter>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<DraftMap>({});
  const [pendingSelect, setPendingSelect] = useState<string | null>(null);
  const [switchOpen, setSwitchOpen] = useState(false);
  const [resolveState, setResolveState] = useState<ResolveState | null>(null);

  const listQuery = useQuery({
    queryKey: ['interactions'],
    queryFn: fetchInteractions,
    retry: false,
  });

  const items = listQuery.data?.items ?? [];
  const capabilities = listQuery.data?.capabilities;

  const filtered = useMemo(() => {
    if (filter === 'all') return items;
    if (filter === 'permissions') return [];
    return items.filter((item) => item.kind === filter);
  }, [filter, items]);

  const selectedSummary = filter === 'permissions'
    ? undefined
    : filtered.find((item) => item.id === selectedId) ?? filtered[0];

  const detailQuery = useQuery({
    queryKey: ['interaction', selectedSummary?.id ?? ''],
    queryFn: () => fetchInteraction(selectedSummary!.id),
    enabled: selectedSummary !== undefined,
    retry: false,
  });

  useEffect(() => {
    if (selectedSummary === undefined) return;
    if (selectedId !== selectedSummary.id) setSelectedId(selectedSummary.id);
  }, [selectedId, selectedSummary]);

  useEffect(() => {
    if (selectedSummary === undefined) {
      if (selectedId !== null) setSelectedId(null);
    }
  }, [selectedId, selectedSummary]);

  const resolveMutation = useMutation({
    mutationFn: async (input: ResolveInput) => resolveInteraction(input.interactionId, input.answers),
    onSuccess: async (data, input) => {
      setResolveState({ interactionId: input.interactionId, receipt: data.receipt });
      if (data.receipt.status === 'succeeded') {
        setDrafts((current) => {
          const next = { ...current };
          delete next[input.interactionId];
          return next;
        });
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['interactions'] }),
        queryClient.invalidateQueries({ queryKey: ['interaction', input.interactionId] }),
        queryClient.invalidateQueries({ queryKey: ['bootstrap'] }),
      ]);
    },
    onError: (error, input) => {
      setResolveState({ interactionId: input.interactionId, error });
      void queryClient.invalidateQueries({ queryKey: ['interactions'] });
      void queryClient.invalidateQueries({ queryKey: ['interaction', input.interactionId] });
    },
  });

  const activeResolve = resolveState !== null && selectedSummary !== undefined && resolveState.interactionId === selectedSummary.id
    ? resolveState
    : undefined;
  const offscreenReceipt = resolveState?.receipt !== undefined && resolveState.interactionId !== selectedSummary?.id
    ? resolveState.receipt
    : undefined;

  const selectedDraft = selectedSummary === undefined ? undefined : drafts[selectedSummary.id];
  const hasDraft = selectedDraft !== undefined && Object.keys(selectedDraft).length > 0;

  const requestSelect = (nextId: string) => {
    if (nextId === selectedSummary?.id) return;
    if (hasDraft && selectedSummary !== undefined) {
      setPendingSelect(nextId);
      setSwitchOpen(true);
      return;
    }
    setSelectedId(nextId);
  };

  const keepDraftAndSwitch = () => {
    if (pendingSelect !== null) setSelectedId(pendingSelect);
    setPendingSelect(null);
    setSwitchOpen(false);
  };

  const discardDraftAndSwitch = () => {
    if (selectedSummary !== undefined) {
      setDrafts((current) => {
        const next = { ...current };
        delete next[selectedSummary.id];
        return next;
      });
    }
    if (pendingSelect !== null) setSelectedId(pendingSelect);
    setPendingSelect(null);
    setSwitchOpen(false);
  };

  const updateDraft = (questionId: string, value: QuestionDraft) => {
    if (selectedSummary === undefined) return;
    setDrafts((current) => ({
      ...current,
      [selectedSummary.id]: {
        ...(current[selectedSummary.id] ?? {}),
        [questionId]: value,
      },
    }));
  };

  const submitAnswers = (answers: InteractionResolveRequest['answers']) => {
    if (selectedSummary === undefined) return;
    if (answers.length === 0) return;
    setResolveState((current) => current?.interactionId === selectedSummary.id ? null : current);
    resolveMutation.mutate({ interactionId: selectedSummary.id, answers });
  };

  const otherItems = (bootstrap.data?.inbox ?? []).filter((item) =>
    listQuery.isError ? true : OTHER_KINDS.includes(item.kind));
  const noProjects = bootstrap.data !== undefined && bootstrap.data.projects.length === 0;

  const counts: Record<InboxFilter, number | undefined> = {
    all: listQuery.isLoading || listQuery.isError ? undefined : items.length,
    planning_question: listQuery.isLoading || listQuery.isError ? undefined : items.filter((item) => item.kind === InteractionKind.PLANNING_QUESTION).length,
    planning_review: listQuery.isLoading || listQuery.isError ? undefined : items.filter((item) => item.kind === InteractionKind.PLANNING_REVIEW).length,
    planning_reconcile: listQuery.isLoading || listQuery.isError ? undefined : items.filter((item) => item.kind === InteractionKind.PLANNING_RECONCILE).length,
    permissions: listQuery.isLoading || listQuery.isError ? undefined : 0,
  };

  let leftBody: ReactNode;
  if (listQuery.isLoading) {
    leftBody = (
      <div style={{ padding: 8 }}>
        {[0, 1, 2, 3].map((index) => (
          <div key={index} className="list-row" style={{ alignItems: 'flex-start' }}>
            <Skeleton width={32} height={32} radius={9} />
            <div className="col grow" style={{ gap: 6 }}>
              <Skeleton width="72%" height={13} />
              <Skeleton width="55%" height={11} />
            </div>
          </div>
        ))}
      </div>
    );
  } else if (listQuery.isError) {
    leftBody = (
      <div style={{ padding: 16 }}>
        <ServiceNotice
          error={listQuery.error}
          onRetry={() => { void listQuery.refetch(); }}
        />
        <p className="hint" style={{ marginTop: 10 }}>
          数量显示为「—」；这不代表没有待处理事项。仍可从下方汇总入口打开画布。
        </p>
      </div>
    );
  } else if (filter === 'permissions') {
    leftBody = (
      <div className="inbox-empty-hint">
        <p className="hint" style={{ margin: 0 }}>
          服务未提供权限/策略请求来源；没有可列出的此类事项。
        </p>
      </div>
    );
  } else if (filtered.length === 0) {
    leftBody = (
      <div className="inbox-empty-hint">
        <p className="hint" style={{ margin: 0 }}>
          {filter === 'all' ? '队列已空。' : '这一类暂时没有事项。'}
        </p>
      </div>
    );
  } else {
    leftBody = (
      <div className="list" style={{ padding: '4px 6px 8px' }}>
        {filtered.map((item) => (
          <InteractionRow
            key={item.id}
            item={item}
            selected={item.id === selectedSummary?.id}
            draft={drafts[item.id] !== undefined && Object.keys(drafts[item.id] ?? {}).length > 0}
            onSelect={() => { requestSelect(item.id); }}
          />
        ))}
      </div>
    );
  }

  let detailBody: ReactNode;
  if (filter === 'permissions') {
    if (listQuery.isLoading) {
      detailBody = <InteractionSkeleton />;
    } else if (listQuery.isError) {
      detailBody = (
        <section className="card solid">
          <div className="inbox-detail-skeleton">
            <ServiceNotice error={listQuery.error} title="能力状态读取失败" onRetry={() => { void listQuery.refetch(); }} />
            <p className="hint" style={{ marginTop: 10 }}>读取失败时不把权限/策略标成“服务未提供”，避免把未知当成结论。</p>
          </div>
        </section>
      );
    } else {
      detailBody = <PermissionsUnavailable capabilities={capabilities} />;
    }
  } else if (selectedSummary === undefined) {
    detailBody = (
      <section className="card solid">
        <div className="inbox-detail-skeleton">
          <EmptyState
            icon={listQuery.isError ? 'alert' : 'inbox'}
            title={listQuery.isError ? '待处理事项读取失败' : filter === 'all' ? '都处理完了' : '没有此类事项'}
            description={
              listQuery.isError
                ? '服务没有返回待处理事项；这不是“没有事项”，数量显示为 —。可重试读取，或先通过下方画布入口处理。'
                : noProjects
                  ? '还没有登记项目；登记项目并启动任务后，需要你回答的事项会出现在这里。'
                  : '当前没有待回答、待审阅或待核对的事项；新的问题会在任务停下时出现在这里。'
            }
            action={
              listQuery.isError ? (
                <Button variant="secondary" size="sm" icon="refresh" onClick={() => { void listQuery.refetch(); }}>
                  重新读取
                </Button>
              ) : undefined
            }
          />
        </div>
      </section>
    );
  } else {
    detailBody = (
      <InteractionDetailPanel
        detail={detailQuery.data}
        loading={detailQuery.isLoading}
        error={detailQuery.error}
        drafts={drafts}
        resolveState={activeResolve}
        resolvePending={resolveMutation.isPending}
        onRetry={() => { void detailQuery.refetch(); }}
        onUpdateDraft={updateDraft}
        onResolve={submitAnswers}
      />
    );
  }

  return (
    <div className="page wide">
      <PageHeader
        title="待处理中心"
        lede="任务需要你回答、审阅或核对时会停在这里。问题可直接回答并提交；权限与策略事项如实标注服务未提供，不会伪造。"
        actions={
          <Button
            variant="ghost"
            size="sm"
            icon="refresh"
            disabled={listQuery.isFetching}
            disabledReason={listQuery.isFetching ? '正在刷新待处理事项…' : undefined}
            onClick={() => {
              void listQuery.refetch();
              if (selectedSummary !== undefined) void detailQuery.refetch();
              void bootstrap.refetch();
            }}
          >
            刷新
          </Button>
        }
      />

      {offscreenReceipt === undefined ? null : (
        <div style={{ marginBottom: 14 }}>
          <ReceiptNotice receipt={offscreenReceipt} successMessage="上一次回答已提交，需求修订已更新。" />
        </div>
      )}

      <div className="inbox-split">
        <div className="col" style={{ gap: 16 }}>
          <section className="card inbox-list-card" aria-label="待处理事项列表">
            <div className="inbox-filter">
              <div className="seg" role="group" aria-label="事项类型">
                {FILTERS.map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    aria-pressed={filter === item.value}
                    title={item.value === 'permissions' ? capabilities?.reason ?? '服务未提供权限/策略事项' : undefined}
                    onClick={() => { setFilter(item.value); }}
                  >
                    {item.label}
                    <span className="num muted">{counts[item.value] === undefined ? '—' : String(counts[item.value])}</span>
                  </button>
                ))}
              </div>
            </div>
            {leftBody}
            <div className="inbox-list-foot">
              <span className="hint grow">
                {listQuery.data === undefined
                  ? '数量未知'
                  : `打开 ${String(listQuery.data.counts.open)} · 待核对 ${String(listQuery.data.counts.unknown)}`}
              </span>
              <span className="hint">列表来自 /api/interactions</span>
            </div>
            {capabilities !== undefined && (!capabilities.permissions || !capabilities.policy) ? (
              <div className="inbox-unavailable">
                <Icon name="lock" size="sm" />
                <span>
                  <b>权限/策略事项：服务未提供。</b>
                  <br />
                  {capabilities.reason ?? '受管 OpenCode + 内部 MCP 架构没有权限/策略请求来源。'}
                </span>
              </div>
            ) : null}
          </section>

          {otherItems.length === 0 ? null : (
            <OtherInboxEntries items={otherItems} />
          )}
          {bootstrap.isError ? (
            <p className="hint">bootstrap 汇总读取失败：{errorMessage(bootstrap.error)}；上方交互列表仍可独立使用。</p>
          ) : null}
        </div>

        <div>{detailBody}</div>
      </div>

      <Modal
        open={switchOpen}
        title="保留这份未提交的回答？"
        onClose={() => { setSwitchOpen(false); setPendingSelect(null); }}
        footer={
          <>
            <Button variant="ghost" onClick={discardDraftAndSwitch}>放弃草稿</Button>
            <span className="spacer" />
            <Button variant="primary" onClick={keepDraftAndSwitch}>保留草稿</Button>
          </>
        }
      >
        <p>你已经填写了部分回答。切换到其他事项时，可以把草稿留在本机，回来继续。</p>
      </Modal>
    </div>
  );
}
