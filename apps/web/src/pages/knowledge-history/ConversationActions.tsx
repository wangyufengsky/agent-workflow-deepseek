import { useState, useSyncExternalStore } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ROUTES, createRequestKey, type CommandResponse, type KnowledgeConversation, type KnowledgeConversationCommand, type OperationReceipt, type OperationsByKeyResponse } from '@agent-workflow/shared';
import { apiGet, apiPost, errorMessage } from '../../api/client.ts';
import { pendingCommands, subscribePending } from '../../api/pending-commands.ts';
import { Button } from '../../components/Button.tsx';
import { Modal } from '../../components/Modal.tsx';
import { ReceiptNotice } from '../../flow/workflow-ui.tsx';

export function ConversationActions({ conversation }: { readonly conversation: KnowledgeConversation }) {
  const client = useQueryClient();
  const [editing, setEditing] = useState(false); const [title, setTitle] = useState(conversation.title); const [receipt, setReceipt] = useState<OperationReceipt>();
  const base = ROUTES.knowledgeConversation(conversation.id);
  const pendingKey = useSyncExternalStore(subscribePending, () => pendingCommands().find((item) => item.path.startsWith(`${base}/`))?.requestKey ?? null);
  const refresh = () => { void client.invalidateQueries({ queryKey: ['knowledge', 'history'] }); void client.invalidateQueries({ queryKey: ['knowledge', 'conversation'] }); void client.invalidateQueries({ queryKey: ['bootstrap'] }); };
  const mutation = useMutation({ mutationFn: async (action: 'rename' | 'archive' | 'restore') => {
    const path = action === 'rename' ? ROUTES.knowledgeConversationRename(conversation.id) : action === 'archive' ? ROUTES.knowledgeConversationArchive(conversation.id) : ROUTES.knowledgeConversationRestore(conversation.id);
    const body: KnowledgeConversationCommand = { requestKey: createRequestKey(), projectId: conversation.projectId, expectedRevision: conversation.revision, confirm: true, ...(action === 'rename' ? { title } : {}) };
    return (await apiPost<CommandResponse<KnowledgeConversation>>(path, body)).data;
  }, onSuccess: (response) => { setReceipt(response.receipt); if (response.receipt.status === 'succeeded') setEditing(false); refresh(); } });
  const check = useMutation({ mutationFn: async () => { const key = pendingKey ?? receipt?.requestKey; if (!key) throw new Error('原请求号不可用'); return (await apiGet<OperationsByKeyResponse>(ROUTES.operationsByKey(key))).data.operation; }, onSuccess: (value) => { setReceipt(value); refresh(); } });
  const locked = pendingKey !== null || mutation.isPending;
  return <>
    <div className="row wrap" style={{ gap: 8 }}>
      <Button variant="ghost" size="sm" disabled={locked || !conversation.actions.rename.allowed} disabledReason={conversation.actions.rename.reason ?? '先核对原请求'} onClick={() => { setTitle(conversation.title); setEditing(true); }}>重命名</Button>
      {conversation.archivedAt === undefined ? <Button variant="ghost" size="sm" disabled={locked || !conversation.actions.archive.allowed} disabledReason={conversation.actions.archive.reason ?? '先核对原请求'} onClick={() => mutation.mutate('archive')}>归档</Button> : <Button variant="secondary" size="sm" disabled={locked || !conversation.actions.restore.allowed} disabledReason={conversation.actions.restore.reason ?? '先核对原请求'} onClick={() => mutation.mutate('restore')}>恢复对话</Button>}
      {pendingKey !== null || receipt?.status === 'unknown' || receipt?.status === 'accepted' ? <Button variant="secondary" size="sm" disabled={check.isPending} onClick={() => check.mutate()}>核对原请求</Button> : null}
    </div>
    {receipt ? <ReceiptNotice receipt={receipt} successMessage="对话元数据已保存。" /> : null}
    {mutation.isError || check.isError ? <p role="alert" className="hint">{errorMessage(mutation.error ?? check.error)}</p> : null}
    <Modal open={editing} title="重命名对话" onClose={() => { if (!locked) setEditing(false); }} footer={<><Button variant="ghost" disabled={locked} onClick={() => setEditing(false)}>取消</Button><Button disabled={locked || !title.trim() || title.trim().length > 100} onClick={() => mutation.mutate('rename')}>保存名称</Button></>}>
      <label htmlFor={`conversation-title-${conversation.id}`}>对话名称</label><input className="input" id={`conversation-title-${conversation.id}`} value={title} maxLength={100} disabled={locked} onChange={(event) => setTitle(event.target.value)} /><p className="hint">只修改对话名称，原问题、回答和引用保持原记录。</p>
    </Modal>
  </>;
}
