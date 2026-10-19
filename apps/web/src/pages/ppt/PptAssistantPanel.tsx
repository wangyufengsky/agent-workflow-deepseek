import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import ReactMarkdown from 'react-markdown';
import { ROUTES, createRequestKey, type PptAssistantView, type PptWork, type CommandResponse, type OperationReceipt } from '@agent-workflow/shared';
import { apiGet, apiPost, errorMessage } from '../../api/client.ts';
import { pendingForScope, subscribePending } from '../../api/pending-commands.ts';
import { Icon } from '../../components/Icon.tsx';
import { ServiceNotice } from '../../components/ServiceNotice.tsx';
import { ReceiptNotice } from '../../flow/workflow-ui.tsx';
import { PptAssistantProposal } from './PptAssistantProposal.tsx';
export function PptAssistantPanel({ work, blocked }: {
    readonly work: PptWork;
    readonly blocked: boolean;
}) {
    const client = useQueryClient();
    const [message, setMessage] = useState('');
    const [scope, setScope] = useState<'brief' | 'page' | 'all'>(work.slides.length ? 'page' : 'brief');
    const [pageIndex, setPage] = useState(work.slides.length ? 0 : -1);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [receipt, setReceipt] = useState<OperationReceipt>();
    const [epoch, setEpoch] = useState(0);
    void epoch;
    const pending = pendingForScope('/api/ppt/works') !== undefined;
    const query = useQuery({ queryKey: ['ppt', 'assistant', work.id], queryFn: async () => (await apiGet<PptAssistantView>(ROUTES.pptAssistant(work.id))).data, retry: false, refetchInterval: pending ? 1500 : false });
    useEffect(() => subscribePending(() => { setEpoch(value => value + 1); void client.invalidateQueries({ queryKey: ['ppt', 'assistant', work.id] }); void client.invalidateQueries({ queryKey: ['ppt', 'works'] }); }), [work.id, client]);
    useEffect(() => { if (query.data?.activeRequestKey)
        void client.invalidateQueries({ queryKey: ['ppt', 'works'] }); }, [query.data?.activeRequestKey, client]);
    const run = async (action: () => Promise<CommandResponse<PptAssistantView>>) => { setBusy(true); setError(''); try {
        const result = await action();
        setReceipt(result.receipt);
        if (result.receipt.status === 'succeeded')
            setMessage('');
    }
    catch (error) {
        setError(errorMessage(error));
    }
    finally {
        setBusy(false);
        await client.invalidateQueries({ queryKey: ['ppt', 'assistant', work.id] });
        await client.invalidateQueries({ queryKey: ['ppt', 'works'] });
    } };
    const locked = blocked || busy || pending || work.archived === true;
    return <aside className="card ppt-assistant" aria-label="PPT 助手">
  <div className="card-head"><Icon name="sparkle"/><b>PPT 助手</b><span className="hint">讨论后审阅，再应用</span></div>
  <div className="card-body col" style={{ gap: 12 }}>
   {query.isLoading ? <p className="hint"><Icon name="clock" size="sm"/>正在读取对话…</p> : query.isError ? <ServiceNotice error={query.error} onRetry={() => { void query.refetch(); }}/> : query.data?.messages.length ? query.data.messages.map(item => <section key={item.id} className={item.role === 'user' ? 'ppt-user-message' : 'ppt-assistant-message'}><div className="hint">{item.role === 'user' ? '你' : 'PPT 助手'} · {item.createdAt}</div><ReactMarkdown skipHtml components={{ a: ({ children }) => <span>{children}</span>, img: () => null }}>{item.text}</ReactMarkdown>{item.proposalId ? query.data.proposals.filter(proposal => proposal.id === item.proposalId).map(proposal => <PptAssistantProposal key={proposal.id} proposal={proposal} currentRevision={work.revision ?? 1} blocked={locked} onDecide={decision => { void run(async () => (await apiPost<CommandResponse<PptAssistantView>>(ROUTES.pptAssistantDecide(work.id), { requestKey: createRequestKey(), proposalId: proposal.id, decision, confirm: true })).data); }}/>) : null}</section>) : <p className="hint">回答听众、目标、篇幅，或告诉助手要怎么改。助手生成的修改先列出差异，应用前作品内容保持不变。</p>}
   {query.data?.activeRequestKey ? <div className="banner info"><Icon name="clock"/><span>助手请求仍在处理或待核对，离开页面不会重发。原请求号 {query.data.activeRequestKey}；可在上方停止，未知结果按原key核对。</span></div> : null}
   <ReceiptNotice receipt={receipt}/>{error ? <p className="banner danger" role="alert"><Icon name="alert"/>{error}</p> : null}
   <label>修改范围<select className="select" value={scope} disabled={locked} onChange={event => setScope(event.target.value as typeof scope)}><option value="brief">需求讨论</option><option value="page">仅所选页面</option><option value="all">整份演示</option></select></label>
   {scope === 'page' ? <label>页面<select className="select" value={pageIndex} disabled={locked} onChange={event => setPage(Number(event.target.value))}><option value={-1}>封面</option>{work.slides.map((page, index) => <option key={index} value={index}>第 {index + 1} 页 · {page.title}</option>)}</select></label> : null}
   <textarea className="textarea" aria-label="给 PPT 助手的消息" placeholder="回答问题，或告诉助手要怎么改…" value={message} disabled={locked} onChange={event => setMessage(event.target.value)} maxLength={4000}/>
   <button className="btn primary" disabled={locked || !message.trim()} title={locked ? '作品只读或原请求尚未结束' : !message.trim() ? '请填写消息' : undefined} onClick={() => { void run(async () => (await apiPost<CommandResponse<PptAssistantView>>(ROUTES.pptAssistant(work.id), { requestKey: createRequestKey(), expectedRevision: work.revision ?? 1, message, scope, ...(scope === 'page' ? { pageIndex } : {}), confirmSend: true })).data); }}><Icon name="arrowUp" size="sm"/>{busy ? '正在等待助手…' : '发送'}</button>
  </div>
 </aside>;
}
