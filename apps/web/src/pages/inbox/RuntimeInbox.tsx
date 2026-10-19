import { Link } from 'react-router-dom';
import { pendingCommands, subscribePending } from '../../api/pending-commands.ts';
import { useState, useSyncExternalStore } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ROUTES, createRequestKey, type CommandResponse, type OperationReceipt, type RuntimeInteraction, type RuntimeInteractionResolveRequest } from '@agent-workflow/shared';
import { apiGet, apiPost, errorMessage } from '../../api/client.ts';
import { Button } from '../../components/Button.tsx';
import { Icon } from '../../components/Icon.tsx';
import { QuestionInput, hasQuestionAnswer, type QuestionDraft } from '../../components/QuestionInput.tsx';
import { ReceiptNotice } from '../../flow/workflow-ui.tsx';

export function RuntimeItem({ item }: { readonly item: RuntimeInteraction }) {
  const client = useQueryClient();
  const pendingKey = useSyncExternalStore(subscribePending, () => pendingCommands().find((command) => command.path === ROUTES.runtimeInteractionResolve(item.id))?.requestKey ?? null);
  const [drafts, setDrafts] = useState<Record<string, QuestionDraft>>(() => client.getQueryData(['runtime-draft', item.id]) ?? {});
  const [receipt, setReceipt] = useState<OperationReceipt>();
  const submit = useMutation({ mutationFn: async (action: RuntimeInteractionResolveRequest['action']) => {
    const body: RuntimeInteractionResolveRequest = { requestKey: createRequestKey(), confirmResolve: true, action, ...(action === 'answer' ? { answers: item.questions.map((question) => ({ questionId: question.id, ...drafts[question.id] })) } : {}) };
    return (await apiPost<CommandResponse<RuntimeInteraction>>(ROUTES.runtimeInteractionResolve(item.id), body)).data;
  }, onSuccess: (response) => { setReceipt(response.receipt); client.setQueryData(['runtime-receipt'], response.receipt); if (response.receipt.status === 'succeeded') client.removeQueries({ queryKey: ['runtime-draft', item.id] }); void client.invalidateQueries({ queryKey: ['runtime-interactions'] }); void client.invalidateQueries({ queryKey: ['bootstrap'] }); void client.invalidateQueries({ queryKey: ['interactions'] }); void client.invalidateQueries({ queryKey: ['workflow', item.binding.taskId] }); } });
  const check = useMutation({ mutationFn: async () => {
    const key = item.requestKey ?? receipt?.requestKey ?? pendingKey;
    if (!key) throw new Error('原请求号不可用');
    return (await apiGet<{ operation: OperationReceipt }>(`/api/operations/${encodeURIComponent(key)}`)).data.operation;
  }, onSuccess: (value) => { setReceipt(value); client.setQueryData(['runtime-receipt'], value); void client.invalidateQueries({ queryKey: ['runtime-interactions'] }); void client.invalidateQueries({ queryKey: ['bootstrap'] }); void client.invalidateQueries({ queryKey: ['interactions'] }); void client.invalidateQueries({ queryKey: ['workflow', item.binding.taskId] }); } });
  const locked = pendingKey !== null || item.resolveAllowed === false || item.state !== 'open' || submit.isPending || receipt?.status === 'unknown' || receipt?.status === 'accepted' || receipt?.status === 'succeeded';
  return <section className="card solid" style={{ padding: 18 }}>
    <h3><Icon name={item.hard ? 'lock' : item.kind === 'question' ? 'help' : 'shield'} /> {item.kind === 'question' ? '需要你回答' : item.hard ? '策略已阻止' : '需要只读授权'} · {item.state === 'unknown' ? '待核对' : item.state === 'resolved' ? '已处理' : '待处理'}</h3>
    <p>{item.contextTitle ?? item.taskTitle} · {item.stepName} · <Link to={item.binding.taskId === undefined ? `/knowledge?project=${encodeURIComponent(item.binding.projectId)}&conversation=${encodeURIComponent(item.binding.conversationId ?? '')}&requestKey=${encodeURIComponent(item.binding.knowledgeRequestKey ?? '')}` : `/tasks/${encodeURIComponent(item.binding.taskId)}${item.binding.nodeId ? `?node=${encodeURIComponent(item.binding.nodeId)}` : ''}`}>{item.binding.taskId === undefined ? '回到对话' : '回到任务'}</Link></p><p className="hint">{item.reason}</p>
    {item.permission ? <p>权限：{item.permission}</p> : null}
    {item.patterns.length ? <ul>{item.patterns.map((pattern, index) => <li key={index}><code>{pattern}</code></li>)}</ul> : null}
    {item.questions.map((question) => <div key={question.id} style={{ marginBottom: 14 }}><strong>{question.title}</strong><QuestionInput id={`${item.id}-${question.id}`} title={question.title} question={question} value={drafts[question.id] ?? { values: [], other: '' }} disabled={locked} onChange={(value) => setDrafts((prior) => { const next = { ...prior, [question.id]: value }; client.setQueryData(['runtime-draft', item.id], next); return next; })} /></div>)}
    <div className="row" style={{ gap: 8 }}>
      {pendingKey !== null || item.state === 'unknown' || receipt?.status === 'unknown' || receipt?.status === 'accepted' ? <Button disabled={check.isPending || !(item.requestKey ?? receipt?.requestKey ?? pendingKey)} onClick={() => check.mutate()}>核对原请求</Button> : null}
      {item.hard ? <Button disabled={locked} onClick={() => submit.mutate('ack')}>知道了</Button> : item.kind === 'question' ? <>
        <Button disabled={locked} onClick={() => submit.mutate('reject')}>拒绝回答</Button>
        <Button disabled={locked || !item.questions.every((question) => hasQuestionAnswer(drafts[question.id] ?? { values: [], other: '' }))} onClick={() => submit.mutate('answer')}>提交答复</Button>
      </> : <><Button disabled={locked} onClick={() => submit.mutate('reject')}>拒绝</Button><Button disabled={locked || item.grantAllowed === false} title={item.unavailableReason} onClick={() => submit.mutate('session')}>本会话允许</Button><Button disabled={locked || item.grantAllowed === false} title={item.unavailableReason} onClick={() => submit.mutate('once')}>仅这一次</Button></>}
    </div>
    {item.unavailableReason ? <p className="hint">{item.unavailableReason}</p> : null}
    {receipt ? <ReceiptNotice receipt={receipt} successMessage="运行时答复已确认。" /> : null}
    {submit.isError || check.isError ? <p role="alert">{errorMessage(submit.error ?? check.error)}</p> : null}
  </section>;
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
