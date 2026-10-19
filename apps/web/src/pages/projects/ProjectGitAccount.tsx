import { assertProjectAccountReceipt, readProjectAccountOperation } from './project-account-receipt.ts';
import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ROUTES, createRequestKey, type CommandResponse, type OperationReceipt, type ProjectGitAccountView, type ProjectGitAccountDraft, type ProjectGitAccountProbe } from '@agent-workflow/shared';
import { apiGet, request, errorMessage } from '../../api/client.ts';
import { pendingCommands, subscribePending, commandScope } from '../../api/pending-commands.ts';
import { Button } from '../../components/Button.tsx';
import { Badge } from '../../components/Badge.tsx';
function ProjectGitAccountForm({ projectId }: {
    readonly projectId: string;
}) {
    const client = useQueryClient();
    const query = useQuery({ queryKey: ['project-git-account', projectId], queryFn: async () => (await apiGet<{
            account: ProjectGitAccountView;
        }>(ROUTES.projectGitAccount(projectId))).data.account, retry: false });
    const [draft, setDraft] = useState<ProjectGitAccountDraft>({ source: 'inherit', provider: 'gitlab', authentication: 'token', username: '', credential: '', repositoryUrl: '' });
    const [requestKey, setRequestKey] = useState('');
    const [busy, setBusy] = useState(false);
    const [needsReceipt, setNeedsReceipt] = useState(false);
    const [error, setError] = useState('');
    const [receipt, setReceipt] = useState<OperationReceipt>();
    const [probe, setProbe] = useState<ProjectGitAccountProbe>();
    const [pending, setPending] = useState(pendingCommands);
    useEffect(() => subscribePending(() => setPending(pendingCommands())), []);
    useEffect(() => { generation.current++; if (query.data)
        setDraft({ ...query.data, credential: '', repositoryUrl: '' }); setProbe(undefined); setBusy(false); }, [projectId, query.data?.revision]);
    const generation = useRef(0);
    const mounted = useRef(true);
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; generation.current++; }; }, []);
    useEffect(() => { generation.current++; setRequestKey(''); setNeedsReceipt(false); setBusy(false); setReceipt(undefined); setError(''); setProbe(undefined); }, [projectId]);
    useEffect(() => {
        if (!requestKey || busy || receipt || pending.some(item => item.requestKey === requestKey))
            return;
        let active = true;
        const identity = generation.current;
        void readProjectAccountOperation(projectId, requestKey, () => active && mounted.current && identity === generation.current).then(operation => { if (!active)
            return; setReceipt(operation); setNeedsReceipt(!['succeeded','failed'].includes(operation.status)); if (operation.status === 'failed')
            setError(`${operation.error?.message ?? '操作失败'}（原请求已核对为失败，候选验证不会保存账号）`); }).catch(() => undefined);
        return () => { active = false; };
    }, [projectId, requestKey, busy, receipt, pending]);
    const current = query.data;
    const dirty = !!current && (draft.source !== current.source || draft.provider !== current.provider || draft.authentication !== current.authentication || draft.username !== current.username || !!draft.credential);
    const locked = busy || needsReceipt || pending.some((item) => item.scope === commandScope(ROUTES.projectGitAccount(projectId)));
    const update = (patch: Partial<ProjectGitAccountDraft>) => { generation.current++; setDraft(value => ({ ...value, ...patch })); setProbe(undefined); setError(''); };
    useEffect(() => { if (!dirty)
        return; const unload = (event: BeforeUnloadEvent) => { event.preventDefault(); }; const navigate = (event: MouseEvent) => { const target = event.target instanceof Element ? event.target.closest('a,[role="tab"]') : null; if (target && !window.confirm('项目Git账号有未保存修改，离开会放弃这些修改（凭据不会保存在浏览器）。是否离开？')) {
        event.preventDefault();
        event.stopPropagation();
    } }; window.addEventListener('beforeunload', unload); document.addEventListener('click', navigate, true); return () => { window.removeEventListener('beforeunload', unload); document.removeEventListener('click', navigate, true); }; }, [dirty]);
    const reconcile = async () => {
        const key = receipt?.requestKey ?? requestKey;
        if (!key) return;
        const identity = generation.current;
        try {
            const result = await readProjectAccountOperation(projectId, key, () => mounted.current && identity === generation.current);
            setReceipt(result);
            setNeedsReceipt(!['succeeded','failed'].includes(result.status));
            if (result.status === 'succeeded' && result.operation === 'project.git-account.test' && result.outcome?.resource && typeof result.outcome.resource === 'object' && 'readable' in result.outcome.resource) setProbe(result.outcome.resource as ProjectGitAccountProbe);
            if (result.status === 'succeeded' || result.status === 'failed') await Promise.all([client.invalidateQueries({ queryKey: ['project-git-account', projectId] }), client.invalidateQueries({ predicate: query => query.queryKey.includes(projectId) }), client.invalidateQueries({ queryKey: ['bootstrap'] })]);
        } catch (error) { if (mounted.current && identity === generation.current) setError(errorMessage(error)); }
    };
    const submit = async (test: boolean) => { if (!current)
        return; const identity = generation.current; const key = createRequestKey(); setRequestKey(key); setReceipt(undefined); setNeedsReceipt(true); setBusy(true); setError(''); setProbe(undefined); try {
        const response = await request<CommandResponse<ProjectGitAccountView | ProjectGitAccountProbe>>(test ? ROUTES.projectGitAccountTest(projectId) : ROUTES.projectGitAccount(projectId), { method: 'POST', body: { ...draft, credential: draft.source === 'custom' ? draft.credential : undefined, expectedRevision: current.revision, requestKey: key } });
        if (!mounted.current || identity !== generation.current)
            return;
        assertProjectAccountReceipt(response.data.receipt, projectId, key);
        setReceipt(response.data.receipt);
        setNeedsReceipt(!['succeeded','failed'].includes(response.data.receipt.status));
        if (response.data.receipt.status === 'succeeded') {
            if (test)
                setProbe(response.data.resource as ProjectGitAccountProbe);
            else {
                setDraft(value => ({ ...value, credential: '' }));
                await Promise.all([client.invalidateQueries({ queryKey: ['project-git-account', projectId] }), client.invalidateQueries({ predicate: query => query.queryKey.includes(projectId) }), client.invalidateQueries({ queryKey: ['bootstrap'] })]);
            }
        }
    }
    catch (error) {
        if (mounted.current && identity === generation.current)
            setError(errorMessage(error));
    }
    finally {
        if (mounted.current && identity === generation.current)
            setBusy(false);
    } };
    if (query.isError)
        return <div className="banner danger"><p>项目账号读取失败：{errorMessage(query.error)}</p><Button onClick={() => { void query.refetch(); }}>重读</Button></div>;
    if (!current)
        return <p className="hint">正在读取项目Git账号…</p>;
    const reason = locked ? '原请求正在执行或等待核对' : undefined;
    return <section className="card pad" style={{ marginTop: 16 }} aria-label="项目Git账号配置"><div className="row wrap"><b className="grow">账号来源</b><Badge icon="lock" outline>版本 {current.revision}</Badge>{current.source === 'custom' ? <Badge icon="shield">独立账号 · {current.credentialSaved ? '凭据已保存' : '凭据不可用'}</Badge> : <Badge>继承全局</Badge>}</div>
    <div className="row wrap" style={{ gap: 20, marginTop: 12 }}>{(['inherit', 'custom'] as const).map(source => <label className="row" key={source}><input type="radio" name={`git-source-${projectId}`} checked={draft.source === source} disabled={locked} onChange={() => update({ source })}/>{source === 'inherit' ? '继承全局账号' : '此项目单独配置'}</label>)}</div>
    {draft.source === 'custom' ? <div className="grid-2" style={{ gap: 16, marginTop: 16 }}><label className="field" style={{ margin: 0 }}>Provider<select className="select" aria-label="项目账号Provider" value={draft.provider} disabled={locked} onChange={event => update({ provider: event.target.value as 'github' | 'gitlab', credential: '' })}><option value="gitlab">GitLab</option><option value="github">GitHub</option></select></label><label className="field" style={{ margin: 0 }}>认证方式<select className="select" aria-label="项目认证方式" value={draft.authentication} disabled={locked} onChange={event => update({ authentication: event.target.value as 'token' | 'password', credential: '' })}><option value="token">访问令牌</option><option value="password">用户名与密码</option></select></label><label className="field" style={{ margin: 0 }}>用户名<input className="input" aria-label="项目Git用户名" disabled={locked} value={draft.username} onChange={event => update({ username: event.target.value })}/></label><label className="field" style={{ margin: 0 }}>{draft.authentication === 'token' ? '访问令牌' : '密码'}<input className="input" type="password" autoComplete="new-password" aria-label="项目Git凭据" disabled={locked} value={draft.credential ?? ''} placeholder={current.credentialSaved ? '已保存 · 留空则不修改' : '首次配置请填写'} onChange={event => update({ credential: event.target.value })}/></label></div> : null}
    <label className="field" style={{ marginTop: 16 }}>验证用仓库地址（可选）<input className="input mono" aria-label="项目验证用仓库地址" disabled={locked} value={draft.repositoryUrl ?? ''} placeholder="留空使用项目HTTP(S)远端" onChange={event => update({ repositoryUrl: event.target.value })}/></label>
    <p className="hint">保存后凭据不再显示，只在本机密钥库加密保留。独立账号按服务器绑定，凭据缺失或服务器改变不会回退全局账号。用户名密码用于Git传输；GitHub/GitLab API操作需要访问令牌。</p>{current.origin ? <p className="hint">已保存服务器：<span className="mono-wrap">{current.origin}</span></p> : null}
    <div className="row wrap" style={{ gap: 12, marginTop: 16 }}><Button variant="secondary" icon="link" disabled={locked} disabledReason={reason} onClick={() => { void submit(true); }}>{busy ? '处理中…' : '验证连接'}</Button><span className="hint grow">验证只读取仓库，不会保存账号或配置。</span><Button variant="primary" icon="check" disabled={locked || !dirty} disabledReason={reason ?? '没有账号修改'} onClick={() => { void submit(false); }}>保存项目账号</Button></div>
    {error ? <p className="banner danger" role="alert">{error}；旧验证结果已清空，本地输入保留。</p> : null}
    {!receipt && requestKey ? <p className="hint">本次请求号 {requestKey}；结果未知时按原请求号核对，不自动重发。{needsReceipt ? <Button size="sm" onClick={() => { void reconcile(); }}>核对原操作</Button> : null}</p> : null}
    {receipt ? <p className="hint">原请求 {receipt.requestKey} · {receipt.status}{['accepted', 'unknown'].includes(receipt.status) ? <Button size="sm" onClick={() => { void reconcile(); }}>核对原操作</Button> : null}</p> : null}
    {probe ? <p className="banner info" role="status">{probe.message} · {probe.refs} 个分支 · {new Date(probe.checkedAt).toLocaleString('zh-CN')}</p> : null}
  </section>;
}

/** A different project owns a new form, including request keys and credential inputs. */
export function ProjectGitAccount({ projectId }: { readonly projectId: string }) {
    return <ProjectGitAccountForm key={projectId} projectId={projectId} />;
}
