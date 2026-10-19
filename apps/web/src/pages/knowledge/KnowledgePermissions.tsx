import { useState } from 'react';
import { ROUTES, createRequestKey, type CommandResponse, type KnowledgePermissions as Permissions, type KnowledgePermissionUpdate, type OperationsByKeyResponse } from '@agent-workflow/shared';
import { apiGet, request, errorMessage, isApiClientError } from '../../api/client.ts';
import { Button } from '../../components/Button.tsx';
import { Icon } from '../../components/Icon.tsx';

export function KnowledgePermissions({ permissions, onChange, onLocked }: { readonly permissions: Permissions; readonly onChange: (next: Permissions) => void; readonly onLocked: (locked: boolean) => void }) {
  const storageKey = `agent-workflow.knowledge.permissions.${permissions.projectId}`;
  const [pending, setPending] = useState<KnowledgePermissionUpdate | null>(() => { try { return JSON.parse(sessionStorage.getItem(storageKey) ?? 'null') as KnowledgePermissionUpdate | null; } catch { return null; } });
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState('');
  const remember = (input: KnowledgePermissionUpdate | null) => { if (input === null) sessionStorage.removeItem(storageKey); else sessionStorage.setItem(storageKey, JSON.stringify(input)); setPending(input); onLocked(input !== null); };
  const save = async (name: 'originalRead' | 'publicSearch', value: boolean) => {
    if (pending !== null || busy) return;
    const input = { requestKey: createRequestKey(), [name]: value };
    try { remember(input); } catch { setMessage('无法保留请求号，许可变更尚未发送。'); return; }
    setBusy(true); setMessage('');
    try {
      const result = (await request<CommandResponse<Permissions>>(ROUTES.knowledgePermissions(permissions.projectId), { method: 'PATCH', body: input })).data;
      if (result.receipt.status === 'succeeded' && result.resource !== undefined) { onChange(result.resource); remember(null); }
      else if (result.receipt.status === 'failed') { setMessage(result.receipt.error?.message ?? '许可保存失败'); remember(null); }
      else setMessage('许可结果尚未确认，只能核对原操作。');
    } catch (error) {
      if (isApiClientError(error) && error.kind === 'http' && error.status !== null && error.status < 500 && !/UNKNOWN|IN_PROGRESS/.test(error.code ?? '')) remember(null);
      setMessage(`${errorMessage(error)}${pending === null ? '' : '；请核对原请求。'}`);
    } finally { setBusy(false); }
  };
  const reconcile = async () => {
    if (pending === null || busy) return; setBusy(true);
    try { const result = (await apiGet<OperationsByKeyResponse>(ROUTES.operationsByKey(pending.requestKey))).data.operation;
      if (result.status === 'succeeded' || result.status === 'failed') { const current = (await apiGet<Permissions>(ROUTES.knowledgePermissions(permissions.projectId))).data; onChange(current); remember(null); setMessage(result.status === 'succeeded' ? '已核对：许可保存成功。' : `已核对：许可未保存。${result.error?.message ?? ''}`); }
      else setMessage('原许可操作仍在处理中或未知，不会重新提交。');
    } catch (error) { setMessage(errorMessage(error)); } finally { setBusy(false); }
  };
  return <section className="card pad" style={{ marginTop: 12 }}>
    {(['originalRead', 'publicSearch'] as const).map((name) => <div className="row" key={name} style={{ padding: '8px 0' }}><div className="grow"><b>{name === 'originalRead' ? '原资料读取' : '网络公共检索'}</b><div className="hint">{name === 'originalRead' ? '读取已选代码、文档与授权数据库。关闭后拒绝新读取并清空依赖内容。' : '独立许可；将问题前500字发送给公共搜索服务，采用返回的URL与摘要，不开放自由工具。'}</div></div><Button role="switch" aria-checked={permissions[name]} size="sm" icon={permissions[name] ? 'check' : 'lock'} aria-label={`${name === 'originalRead' ? '原资料读取' : '网络公共检索'}${permissions[name] ? '已开启' : '已关闭'}`} disabled={pending !== null || busy || (name === 'publicSearch' && !permissions.publicSearchAvailability.allowed)} disabledReason={pending !== null ? '许可结果尚未核对' : name === 'publicSearch' && !permissions.publicSearchAvailability.allowed ? permissions.publicSearchAvailability.reason : undefined} onClick={() => { void save(name, !permissions[name]); }}>{permissions[name] ? '已开启' : '已关闭'}</Button></div>)}
    {message === '' ? null : <p className="hint" role="status"><Icon name="info" size="sm" /> {message}</p>}
    {pending === null ? null : <div className="col" style={{ gap: 6 }}><span className="hint mono-wrap">待核对许可请求：{pending.requestKey}</span><Button size="sm" icon="refresh" disabled={busy} onClick={() => { void reconcile(); }}>核对原许可操作</Button></div>}
  </section>;
}
