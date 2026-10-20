import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import ReactMarkdown from 'react-markdown';
import { ROUTES, createRequestKey, type PptAssistantView, type PptWork, type CommandResponse, type OperationReceipt, type OperationsByKeyResponse } from '@agent-workflow/shared';
import { apiGet, apiPost, errorMessage } from '../../api/client.ts';
import { pendingForScope, subscribePending } from '../../api/pending-commands.ts';
import { Icon } from '../../components/Icon.tsx';
import { ServiceNotice } from '../../components/ServiceNotice.tsx';
import { ReceiptNotice } from '../../flow/workflow-ui.tsx';
import { PptAssistantProposal } from './PptAssistantProposal.tsx';
export function PptAssistantPanel({ work, blocked, selectedPage, embedded=false, discussionAllowed=false, mode='make', draftMessage }: {
    readonly work: PptWork;
    readonly blocked: boolean;
    readonly selectedPage?: number;
    readonly embedded?: boolean;
    readonly discussionAllowed?:boolean;
    readonly mode?: 'discuss' | 'make';
    readonly draftMessage?: { readonly text: string; readonly at: number };
}) {
    const client = useQueryClient();
    const [message, setMessage] = useState('');
    const [scope, setScope] = useState<'brief' | 'page' | 'all'>(work.slides.length ? 'page' : 'brief');
    const [pageIndex, setPage] = useState(selectedPage ?? (work.slides.length ? 0 : -1));
    useEffect(()=>{if(draftMessage!==undefined)setMessage(draftMessage.text);},[draftMessage?.at]);
    useEffect(()=>{if(selectedPage!==undefined)setPage(selectedPage);},[selectedPage]);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [receipt, setReceipt] = useState<OperationReceipt>();
    const [epoch, setEpoch] = useState(0);
    void epoch;
    const pending = pendingForScope('/api/ppt/works') !== undefined;
    const query = useQuery({ queryKey: ['ppt', 'assistant', work.id], queryFn: async () => (await apiGet<PptAssistantView>(ROUTES.pptAssistant(work.id))).data, retry: false, refetchInterval: query => pending || query.state.data?.activeRequestKey ? 1500 : false });
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
    useEffect(()=>{if(receipt?.status==='accepted' && !query.data?.activeRequestKey)void apiGet<OperationsByKeyResponse>(ROUTES.operationsByKey(receipt.requestKey)).then(({data})=>{if(data.operation.status==='succeeded'){setMessage('');setReceipt({...receipt,status:'succeeded'});}else if(data.operation.status==='failed')setReceipt({...receipt,status:'failed'});}).catch(()=>{});},[query.data?.activeRequestKey,receipt?.requestKey,receipt?.status]);
    const proposalLocked=blocked || busy || pending || work.archived===true;
    const locked = (blocked && !discussionAllowed) || busy || pending || work.archived === true || query.data?.activeRequestKey!==undefined;
    return <aside className={`card ppt-assistant${embedded?' ppt-assistant-embedded':''}`} aria-label="PPT 助手">
  <div className="card-head"><Icon name="sparkle"/><b>PPT 助手</b><span className="hint">讨论后审阅，再应用</span></div>
  <div className="card-body col" style={{ gap: 12 }}>
   <div className="ppt-assistant-history">
   {query.isLoading ? <p className="hint"><Icon name="clock" size="sm"/>正在读取对话…</p> : query.isError ? <ServiceNotice error={query.error} onRetry={() => { void query.refetch(); }}/> : query.data?.messages.length ? query.data.messages.map(item => <section key={item.id} className={item.role === 'user' ? 'ppt-user-message' : 'ppt-assistant-message'}><div className="hint">{item.role === 'user' ? '你' : 'PPT 助手'} · {item.createdAt}</div><ReactMarkdown skipHtml components={{ a: ({ children }) => <span>{children}</span>, img: () => null }}>{item.text}</ReactMarkdown>{item.proposalId ? query.data.proposals.filter(proposal => proposal.id === item.proposalId).map(proposal => <PptAssistantProposal key={proposal.id} proposal={proposal} currentRevision={work.revision ?? 1} blocked={proposalLocked} onDecide={decision => { void run(async () => (await apiPost<CommandResponse<PptAssistantView>>(ROUTES.pptAssistantDecide(work.id), { requestKey: createRequestKey(), proposalId: proposal.id, decision, confirm: true })).data); }}/>) : null}</section>) : <p className="hint">回答听众、目标、篇幅，或告诉助手要怎么改。助手生成的修改先列出差异，应用前作品内容保持不变。</p>}
   {query.data?.activeRequestKey ? <div className="banner info"><Icon name="clock"/><span>助手请求仍在处理或待核对，离开页面不会重发。原请求号 {query.data.activeRequestKey}；可在上方对应的助手讨论中停止，未知结果按原请求号核对。</span></div> : null}
   <ReceiptNotice receipt={receipt}/>{error ? <p className="banner danger" role="alert"><Icon name="alert"/>{error}</p> : null}
   </div><div className="ppt-assistant-composer">
   {mode === 'discuss' ? null : <label>修改范围<select className="select" value={scope} disabled={locked} onChange={event => setScope(event.target.value as typeof scope)}><option value="page">仅所选页面</option><option value="all">整份演示</option></select></label>}
   {scope === 'page' && !embedded ? <label>页面<select className="select" value={pageIndex} disabled={locked} onChange={event => setPage(Number(event.target.value))}><option value={-1}>封面</option>{work.slides.map((page, index) => <option key={index} value={index}>第 {index + 2} 页 · {page.title}</option>)}</select></label> : null}
   {scope==='page'&&embedded?<p className="hint">仅第 {pageIndex+2} 页{pageIndex===-1?' · 封面':''}</p>:null}
   <textarea className="textarea" aria-label="给 PPT 助手的消息" placeholder={mode === 'discuss' ? '回答问题，或补充你的想法…' : '告诉助手要怎么改…'} value={message} disabled={locked} onChange={event => setMessage(event.target.value)} maxLength={4000}/>
   <button className="btn primary" disabled={locked || !message.trim()} title={locked ? '作品只读或原请求尚未结束' : !message.trim() ? '请填写消息' : undefined} onClick={() => { void run(async () => (await apiPost<CommandResponse<PptAssistantView>>(ROUTES.pptAssistant(work.id), { requestKey: createRequestKey(), expectedRevision: work.revision ?? 1, message, scope, ...(scope === 'page' ? { pageIndex } : {}), confirmSend: true,background:true })).data); }}><Icon name="arrowUp" size="sm"/>{busy ? '正在等待助手…' : '发送'}</button>
   </div>
  </div>
 </aside>;
}
