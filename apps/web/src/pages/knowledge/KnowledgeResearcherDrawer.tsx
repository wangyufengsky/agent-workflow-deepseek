import { useQuery } from '@tanstack/react-query';
import { ROUTES, type KnowledgeAskResponse } from '@agent-workflow/shared';
import { apiGet, isApiClientError } from '../../api/client.ts';
import { Drawer } from '../../components/Drawer.tsx';
import { Badge } from '../../components/Badge.tsx';
import { Button } from '../../components/Button.tsx';
import { Icon } from '../../components/Icon.tsx';
import { ResearchTimeline } from './ResearchTimeline.tsx';

export function KnowledgeResearcherDrawer({ open, result, draft, projectName, selectedSources, onClose, onOpenCitation }: {
  readonly open: boolean; readonly result?: KnowledgeAskResponse; readonly draft: string;
  readonly projectName: string; readonly selectedSources: readonly string[];
  readonly onClose: () => void; readonly onOpenCitation: (index: number) => void;
}) {
  const query = useQuery({ queryKey: ['knowledge', 'evidence', result?.projectId, result?.requestKey],
    queryFn: async () => (await apiGet<KnowledgeAskResponse>(`${ROUTES.knowledgeResult(result!.requestKey!)}?projectId=${encodeURIComponent(result!.projectId)}`)).data,
    enabled: open && result?.requestKey !== undefined, retry: false, staleTime: 0 });
  const fresh = query.isError || query.isFetching ? undefined : result?.requestKey === undefined ? result : query.data;
  const mismatch = fresh !== undefined && result !== undefined && (fresh.conversationId !== result.conversationId || fresh.requestKey !== result.requestKey || fresh.roleEvidence?.conversationVersion !== result.roleEvidence?.conversationVersion);
  const evidence = mismatch || query.isError ? undefined : fresh?.roleEvidence;
  const failure = isApiClientError(query.error) && [401, 403].includes(query.error.status ?? 0)
    ? '暂时没有读取这条消息角色证据的权限，请核对原会话。'
    : isApiClientError(query.error) && query.error.status === 409 ? '消息版本已变化，请重新读取原会话。' : '暂时无法读取角色证据，请重试。';
  return <Drawer open={open} title="知识研究员当前工作" size="md" onClose={onClose}>
    <p className="hint">只读 · 查看不会执行或修改任何内容</p>
    <div className="row" style={{ gap: 16, marginTop: 16 }}>
      <span className="tile" style={{ width: 72, height: 72, fontSize: 28 }} aria-label={evidence?.appearance?.label ?? '中性形象'}>{evidence?.appearance?.value ?? '研'}</span>
      <div><Badge icon={result?.status === 'stopped' ? 'pause' : result === undefined ? 'clock' : 'check'}>{result === undefined ? '未发送' : result.status === 'stopped' ? '已停止' : '已完成'}</Badge><p>依据所选资料回答，并提供可核对的原文引用。</p>{result === undefined ? null : <p className="hint">{new Date(result.generatedAt).toLocaleString('zh-CN')}</p>}</div>
    </div>
    {result === undefined ? <p className="banner info">发送问题后，可以在每条回答上核对当时的执行角色、发布职业和职业外观。</p> : <section className="kb-researcher-section" aria-busy={query.isFetching}>
      <h3>角色证据</h3>
      {query.isFetching ? <p className="hint">正在读取原消息证据…</p> : query.isError ? <div className="banner danger"><Icon name="alert" /><span>{failure}</span><Button size="sm" onClick={() => { void query.refetch(); }}>重试</Button></div> : mismatch ? <div className="banner warn"><Icon name="help" /><span>待核对：会话或消息版本已变化，暂不显示证据结论。</span></div> : <>
        <div className="list-row"><Icon name={evidence === undefined ? 'help' : 'check'} /><span>执行角色</span><span className="grow">{evidence?.executionRole.label ?? '历史消息未记录执行角色'}</span></div>
        <div className="list-row"><Icon name={evidence?.profession === undefined ? 'alert' : 'check'} /><span>发布职业</span><span className="grow">{evidence?.profession === undefined ? '未找到该消息的发布职业版本' : `${evidence.profession.name} · ${evidence.profession.revision}`}</span></div>
        <div className="list-row"><Icon name={evidence?.appearance === undefined ? 'help' : 'check'} /><span>职业外观</span><span className="grow">{evidence?.appearance?.label ?? (evidence === undefined ? '历史未冻结外观，保持中性形象，不套用当前设置' : '该职业未配置外观，这条回答保持中性形象')}</span></div>
        {evidence === undefined ? null : <p className="hint">读取版本：会话 修订 {evidence.conversationVersion} · 消息 修订 {evidence.messageVersion} · 仅为原消息的只读证据，不授予执行权限</p>}
      </>}
    </section>}
    <section className="kb-researcher-section"><h3>已发送问题</h3><div className="kb-researcher-question">{result?.question ?? '尚未发送问题'}</div>{result !== undefined || draft.trim() === '' ? null : <><p>待发送草稿 <Badge>未发送</Badge></p><div className="kb-researcher-question" style={{ borderStyle: 'dashed' }}>{draft}</div></>}</section>
    <section className="kb-researcher-section"><h3>工具记录</h3><ResearchTimeline steps={fresh?.steps} toolActivity={fresh?.toolActivity} compact />{result?.status === 'stopped' ? <p className="hint">本轮已按请求停止，已写内容保留。</p> : null}</section>
    <section className="kb-researcher-section"><h3>引用材料</h3><p className="hint">打开原文时会关闭本面板</p>{(result?.citations ?? []).map((citation, index) => <div className="list-row" key={`${citation.path}:${citation.line}:${index}`}><span>{index + 1}</span><span className="grow mono">{citation.path}:{citation.line}</span><Button size="sm" onClick={() => onOpenCitation(index)}>原文</Button></div>)}</section>
    <section className="kb-researcher-section"><h3>资料来源</h3><p>{projectName} {result === undefined ? '' : '· 本次对话固定'}</p><div className="row wrap">{selectedSources.map((path) => <Badge key={path}>{path}</Badge>)}</div></section>
  </Drawer>;
}
