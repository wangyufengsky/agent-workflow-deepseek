import { Link } from 'react-router-dom';
import { pendingCommands, subscribePending } from '../../api/pending-commands.ts';
import { useState, useSyncExternalStore } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ROUTES, createRequestKey, type CommandResponse, type OperationReceipt, type RuntimeInteraction, type RuntimeInteractionResolveRequest } from '@agent-workflow/shared';
import { apiGet, apiPost, errorMessage } from '../../api/client.ts';
import { Badge } from '../../components/Badge.tsx';
import { Button } from '../../components/Button.tsx';
import { Icon } from '../../components/Icon.tsx';
import { Modal } from '../../components/Modal.tsx';
import { QuestionInput, hasQuestionAnswer, type QuestionDraft } from '../../components/QuestionInput.tsx';
import { ReceiptNotice } from '../../flow/workflow-ui.tsx';

/**
 * P14-03/P14-04: the runtime permission detail keeps the design's information
 * architecture — request operation, reason, the two authorization-scope cards,
 * a hard-policy danger banner, and a confirmation dialog for 拒绝.
 */
export function RuntimeItem({ item }: { readonly item: RuntimeInteraction }) {
  const client = useQueryClient();
  const pendingKey = useSyncExternalStore(subscribePending, () => pendingCommands().find((command) => command.path === ROUTES.runtimeInteractionResolve(item.id))?.requestKey ?? null);
  const [drafts, setDrafts] = useState<Record<string, QuestionDraft>>(() => client.getQueryData(['runtime-draft', item.id]) ?? {});
  const [receipt, setReceipt] = useState<OperationReceipt>();
  const [rejectOpen, setRejectOpen] = useState(false);
  const submit = useMutation({ mutationFn: async (action: RuntimeInteractionResolveRequest['action']) => {
    const body: RuntimeInteractionResolveRequest = { requestKey: createRequestKey(), confirmResolve: true, action, ...(action === 'answer' ? { answers: item.questions.map((question) => ({ questionId: question.id, ...drafts[question.id] })) } : {}) };
    return (await apiPost<CommandResponse<RuntimeInteraction>>(ROUTES.runtimeInteractionResolve(item.id), body)).data;
  }, onSuccess: (response) => { setReceipt(response.receipt); client.setQueryData(['runtime-receipt'], response.receipt); if (response.receipt.status === 'succeeded') client.removeQueries({ queryKey: ['runtime-draft', item.id] }); void client.invalidateQueries({ queryKey: ['runtime-interactions'] }); void client.invalidateQueries({ queryKey: ['bootstrap'] }); void client.invalidateQueries({ queryKey: ['interactions'] }); void client.invalidateQueries({ queryKey: ['workflow', item.binding.taskId] }); } });
  const check = useMutation({ mutationFn: async () => {
    const key = item.requestKey ?? receipt?.requestKey ?? pendingKey;
    if (!key) throw new Error('原请求号不可用');
    return (await apiGet<{ operation: OperationReceipt }>(`/api/operations/${encodeURIComponent(key)}`)).data.operation;
  }, onSuccess: (value) => { setReceipt(value); client.setQueryData(['runtime-receipt'], value); void client.invalidateQueries({ queryKey: ['runtime-interactions'] }); void client.invalidateQueries({ queryKey: ['bootstrap'] }); void client.invalidateQueries({ queryKey: ['interactions'] }); void client.invalidateQueries({ queryKey: ['workflow', item.binding.taskId] }); } });
  const unresolved = pendingKey !== null || item.state === 'unknown' || receipt?.status === 'unknown' || receipt?.status === 'accepted';
  const locked = pendingKey !== null || item.resolveAllowed === false || item.state !== 'open' || submit.isPending || receipt?.status === 'unknown' || receipt?.status === 'accepted' || receipt?.status === 'succeeded';
  const isQuestion = item.kind === 'question';
  const title = isQuestion ? '需要你回答' : item.hard ? '策略已阻止' : '需要只读授权';
  const rejectCopy = isQuestion
    ? '任务会收到“拒绝回答”，由执行中的步骤决定如何继续。'
    : '这一步不会获得读取权限，会尝试在没有这些文件的情况下继续。';
  return (
    <section className="card solid" style={{ padding: 18 }} aria-label="运行时事项详情">
      <div className="row wrap" style={{ gap: 6 }}>
        <Badge tone={isQuestion ? 'wait' : item.hard ? 'danger' : 'wait'} icon={item.hard ? 'lock' : isQuestion ? 'help' : 'shield'}>
          {isQuestion ? '需要你回答' : item.hard ? '策略禁止' : '权限请求'}
        </Badge>
        {item.state === 'unknown' ? <Badge tone="unknown" icon="help">结果待核对</Badge> : null}
        {item.state === 'resolved' ? <Badge tone="done" icon="check">已处理</Badge> : null}
      </div>
      <h2 style={{ fontSize: 19, fontWeight: 500, marginTop: 10 }}>{title} · {item.contextTitle ?? item.taskTitle}</h2>
      <p className="hint" style={{ marginTop: 6 }}>
        来自 {item.taskTitle === undefined ? '对话' : <b>{item.taskTitle}</b>} · 步骤“{item.stepName}”
        {isQuestion ? ' · 等你回答，其他步骤继续' : ' · 等你授权'} ·{' '}
        <Link to={item.binding.taskId === undefined ? `/knowledge?project=${encodeURIComponent(item.binding.projectId)}&conversation=${encodeURIComponent(item.binding.conversationId ?? '')}` : `/tasks/${encodeURIComponent(item.binding.taskId)}${item.binding.nodeId ? `?node=${encodeURIComponent(item.binding.nodeId)}` : ''}`}>
          {item.binding.taskId === undefined ? '回到对话' : '在任务画布中查看'}
        </Link>
      </p>

      {unresolved ? (
        <div className="banner unknown" role="alert" style={{ marginTop: 14 }}>
          <Icon name="help" />
          <div className="grow">
            <b>回答已发出，但没有收到确认</b>
            <br />
            内容已锁定。这里只会重新读取事项状态，不会再次提交；事项从列表消失也不代表回答成功。
            <span className="mono receipt-key">请求号 {item.requestKey ?? receipt?.requestKey ?? pendingKey ?? '—'}</span>
          </div>
          <div className="actions">
            <Button variant="secondary" size="sm" icon="refresh" disabled={check.isPending || !(item.requestKey ?? receipt?.requestKey ?? pendingKey)} onClick={() => check.mutate()}>
              {check.isPending ? '正在核对…' : '按原请求号核对'}
            </Button>
          </div>
        </div>
      ) : null}

      <div className="section" style={{ marginTop: 18 }}>
        <div className="eyebrow" style={{ marginBottom: 8 }}>请求的操作</div>
        {item.permission === undefined ? null : <p style={{ fontSize: 13 }}>{item.permission}</p>}
        {item.patterns.length ? (
          <div className="inbox-pat">
            {item.patterns.map((pattern, index) => (
              <div key={index}><code>{pattern}</code></div>
            ))}
          </div>
        ) : (
          <p className="hint">服务未返回具体操作对象；不会补造范围。</p>
        )}
      </div>

      <div className="section" style={{ marginTop: 16 }}>
        <div className="eyebrow" style={{ marginBottom: 8 }}>原因</div>
        <p style={{ fontSize: 13.5 }}>{item.reason}</p>
      </div>

      {isQuestion ? (
        <div style={{ marginTop: 16 }}>
          {item.questions.map((question) => (
            <div key={question.id} style={{ marginBottom: 14 }}>
              <strong>{question.title}</strong>
              <QuestionInput id={`${item.id}-${question.id}`} title={question.title} question={question} value={drafts[question.id] ?? { values: [], other: '' }} disabled={locked} onChange={(value) => setDrafts((prior) => { const next = { ...prior, [question.id]: value }; client.setQueryData(['runtime-draft', item.id], next); return next; })} />
            </div>
          ))}
        </div>
      ) : item.hard ? (
        <div className="banner danger" style={{ marginTop: 16 }} role="alert">
          <Icon name="lock" />
          <div className="grow">
            这个操作被运行环境策略禁止，<b>不能在这里授权</b>。步骤会被告知无法读取，并继续处理其余部分。
          </div>
        </div>
      ) : (
        <div className="section" style={{ marginTop: 16 }}>
          <div className="eyebrow" style={{ marginBottom: 8 }}>授权范围</div>
          <div className="inbox-scope-grid">
            <div className="card pad inbox-scope-card">
              <div className="inbox-scope-title">仅这一次</div>
              <div className="hint">只允许上面列出的这次读取。</div>
            </div>
            <div className="card pad inbox-scope-card">
              <div className="inbox-scope-title">本次会话内都允许</div>
              <div className="hint">同一执行会话中再次读取这些文件时不再询问。</div>
            </div>
          </div>
        </div>
      )}

      <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 14 }}>
        {unresolved ? <Button variant="secondary" size="sm" disabled={check.isPending || !(item.requestKey ?? receipt?.requestKey ?? pendingKey)} onClick={() => check.mutate()}>按原请求号核对</Button> : null}
        {item.hard ? (
          <Button variant="secondary" disabled={locked} onClick={() => submit.mutate('ack')}>知道了</Button>
        ) : isQuestion ? (
          <>
            <Button variant="ghost" disabled={locked} onClick={() => setRejectOpen(true)}>拒绝回答</Button>
            <span className="grow" />
            <Button variant="primary" disabled={locked || !item.questions.every((question) => hasQuestionAnswer(drafts[question.id] ?? { values: [], other: '' }))} onClick={() => submit.mutate('answer')}>提交答复</Button>
          </>
        ) : (
          <>
            <Button variant="ghost" disabled={locked} onClick={() => setRejectOpen(true)}>拒绝</Button>
            <span className="grow" />
            <Button variant="secondary" disabled={locked || item.grantAllowed === false} disabledReason={item.grantAllowed === false ? item.unavailableReason : undefined} onClick={() => submit.mutate('session')}>本次会话都允许</Button>
            <Button variant="primary" disabled={locked || item.grantAllowed === false} disabledReason={item.grantAllowed === false ? item.unavailableReason : undefined} onClick={() => submit.mutate('once')}>允许这一次</Button>
          </>
        )}
      </div>
      {item.unavailableReason ? <p className="hint" role="note">{item.unavailableReason}</p> : null}
      {receipt ? <ReceiptNotice receipt={receipt} successMessage={item.hard ? '已记录知晓，未授予权限。' : isQuestion ? '已提交回答，任务继续执行。' : '授权已记录，任务继续执行。'} /> : null}
      {submit.isError || check.isError ? <p role="alert">{errorMessage(submit.error ?? check.error)}</p> : null}

      <Modal
        open={rejectOpen}
        title="拒绝这个事项？"
        onClose={() => { setRejectOpen(false); }}
        footer={
          <>
            <Button variant="ghost" onClick={() => { setRejectOpen(false); }}>返回</Button>
            <span className="spacer" />
            <Button variant="danger" icon="x" disabled={locked} disabledReason={locked ? '当前不能提交拒绝' : undefined} onClick={() => { setRejectOpen(false); submit.mutate('reject'); }}>拒绝</Button>
          </>
        }
      >
        <p>{rejectCopy}</p>
        {isQuestion ? <p className="hint">规划/运行时问题由执行中的步骤决定如何继续；拒绝后不能撤回。</p> : <p className="hint">拒绝后这一步不会获得读取权限；不能在这里再次授权同一请求。</p>}
      </Modal>
    </section>
  );
}

/** Actual runtime requests remain separate from planning candidate questions. */
export function useRuntimeInteractions() { return useQuery({ queryKey: ['runtime-interactions'], queryFn: async () => (await apiGet<{ items: readonly RuntimeInteraction[] }>(ROUTES.runtimeInteractions)).data, refetchInterval: 2000, retry: false }); }

export function RuntimeInbox({ filter }: { readonly filter: string }) {
  const query = useRuntimeInteractions();
  const items = (query.data?.items ?? []).filter((item) => item.state !== 'resolved' && (filter === 'permissions' ? item.kind !== 'question' : filter === 'planning_question' ? item.kind === 'question' : filter === 'all'));
  // A failed refresh must not leave an actionable cached authorization form.
  if (query.isError) return <section className="card" style={{ padding: 16 }}><p role="alert">运行时事项读取失败：{errorMessage(query.error)}</p><Button onClick={() => { void query.refetch(); }}>重新读取</Button></section>;
  if (query.isPending) return <p>正在读取运行时事项…</p>;
  if (!items.length) return filter === 'permissions' ? <p className="hint">当前没有运行时权限或策略事项。</p> : null;
  return <div className="col" style={{ gap: 16 }} aria-label="运行时待处理事项">{items.map((item) => <RuntimeItem key={item.id} item={item} />)}</div>;
}

export function RuntimeReceipt() {
  const { data } = useQuery<OperationReceipt | null>({ queryKey: ['runtime-receipt'], queryFn: async () => null, enabled: false });
  return data?.status === 'succeeded' ? <ReceiptNotice receipt={data} successMessage={data.outcome?.action === 'ack' ? '已记录知晓，未授予权限。' : '原运行时答复已确认。'} /> : null;
}
