import { useQuery } from '@tanstack/react-query';
import { ROUTES, KNOWLEDGE_RUN_STATUS_LABEL, type KnowledgeAskResponse, type KnowledgeRunProgress } from '@agent-workflow/shared';
import { apiGet, isApiClientError } from '../../api/client.ts';
import { Badge } from '../../components/Badge.tsx';
import { Button } from '../../components/Button.tsx';
import { Drawer } from '../../components/Drawer.tsx';
import { Skeleton } from '../../components/EmptyState.tsx';
import { Icon } from '../../components/Icon.tsx';
import { ResearchTimeline } from './ResearchTimeline.tsx';

export function KnowledgeResearcherDrawer({ open, result, progress, pending, draft, projectName, selectedSources, onClose, onOpenCitation }: {
  readonly progress?: KnowledgeRunProgress; readonly pending?: { readonly input: { readonly question: string; readonly requestKey: string }; readonly status: 'accepted' | 'unknown' };
  readonly open: boolean; readonly result?: KnowledgeAskResponse; readonly draft: string;
  readonly projectName: string; readonly selectedSources: readonly string[];
  readonly onClose: () => void; readonly onOpenCitation: (index: number) => void;
}) {
  const query = useQuery({ queryKey: ['knowledge', 'evidence', result?.projectId, result?.requestKey],
    queryFn: async () => (await apiGet<KnowledgeAskResponse>(`${ROUTES.knowledgeResult(result!.requestKey!)}?projectId=${encodeURIComponent(result!.projectId)}`)).data,
    enabled: open && result?.requestKey !== undefined, retry: false, staleTime: 0 });
  const fresh = query.isError || query.isFetching ? undefined : result?.requestKey === undefined ? result : query.data;
  const mismatch = fresh !== undefined && result !== undefined && (fresh.conversationId !== result.conversationId || fresh.requestKey !== result.requestKey || fresh.roleEvidence?.conversationVersion !== result.roleEvidence?.conversationVersion);
  const evidence = result === undefined ? progress?.roleEvidence : mismatch || query.isError ? undefined : fresh?.roleEvidence;
  const sentQuestion = result?.question ?? progress?.question ?? pending?.input.question;
  const status = result?.status ?? progress?.status;
  const label = status ? KNOWLEDGE_RUN_STATUS_LABEL[status] : pending ? pending.status === 'accepted' ? '已受理' : '结果待核对' : '未发送';
  const failure = isApiClientError(query.error) && [401, 403].includes(query.error.status ?? 0)
    ? '暂时没有读取这条消息角色证据的权限，请核对原会话。'
    : isApiClientError(query.error) && query.error.status === 409 ? '消息版本已变化，请重新读取原会话。' : '暂时无法读取角色证据，请重试。';
  const hasAppearance = evidence?.appearance !== undefined;
  // Neutral avatar (design B-08 partial/hist): a missing frozen appearance must
  // never borrow the current profession appearance.
  const avatar = hasAppearance ? evidence?.appearance?.value ?? '中' : '中';
  const avatarLabel = hasAppearance ? evidence?.appearance?.label ?? '职业外观' : '中性形象';
  const revisionText = evidence === undefined ? undefined : `会话 修订 ${String(evidence.conversationVersion)} · 消息 修订 ${String(evidence.messageVersion)}`;
  return <Drawer open={open} title="知识研究员当前工作" size="md" onClose={onClose}>
    <p className="hint">只读 · 查看不会执行或修改任何内容</p>
    <div className="row" style={{ gap: 16, marginTop: 16 }}>
      <span className="tile" style={{ width: 72, height: 72, fontSize: 28 }} aria-label={avatarLabel} title={avatarLabel}>{avatar}</span>
      <div>
        <Badge icon={status === 'stopped' ? 'pause' : status === 'completed' ? 'check' : status === 'unknown' || status === 'failed' ? 'alert' : 'clock'}>{label}</Badge>
        <p>依据所选资料回答，并提供可核对的原文引用。</p>
        <p className="hint">角色证据 · 本条回答投递时</p>
        {result === undefined ? null : (
          <p className="hint">
            {result.status === 'stopped' ? '停止于' : '回答于'} {new Date(result.generatedAt).toLocaleString('zh-CN')}
          </p>
        )}
        {hasAppearance ? null : <p className="hint">这条回答保持中性形象。</p>}
      </div>
    </div>
    {result === undefined && progress === undefined ? <p className="banner info">{pending ? `原请求 ${pending.input.requestKey} 已保留；等待服务返回执行角色与结果，不会重复发送。` : '发送问题后，可以在每条回答上核对当时的执行角色、发布职业和职业外观。'}</p> : <section className="kb-researcher-section" aria-busy={query.isFetching}>
      <h3>角色证据</h3>
      {query.isFetching ? (
        <div className="col" style={{ gap: 8 }} aria-label="正在核对本条消息的角色证据">
          {[0, 1, 2].map((row) => <Skeleton key={row} height={14} width={row === 0 ? '64%' : '46%'} />)}
          <p className="hint">正在核对本条消息的角色证据…</p>
        </div>
      ) : query.isError ? <div className="banner danger"><Icon name="alert" /><span>{failure}</span><Button size="sm" onClick={() => { void query.refetch(); }}>重试</Button></div> : mismatch ? (
        <div className="banner warn">
          <Icon name="help" />
          <span>
            待核对：会话或消息版本已变化，暂不显示证据结论。
            {revisionText === undefined ? '' : `页面记录：${revisionText}。`}
          </span>
          <Button size="sm" icon="refresh" onClick={() => { void query.refetch(); }}>重新读取会话</Button>
        </div>
      ) : <>
        <div className="list-row"><Icon name={evidence === undefined ? 'help' : 'check'} /><span>执行角色</span><span className="grow">{evidence?.executionRole.label ?? '历史消息未记录执行角色'}</span></div>
        <div className="list-row"><Icon name={evidence?.profession === undefined ? 'alert' : 'check'} /><span>发布职业</span><span className="grow">{evidence?.profession === undefined ? '未找到与原执行角色完全对应的发布职业版本。' : `${evidence.profession.name} · ${evidence.profession.revision}`}</span></div>
        <div className="list-row"><Icon name={hasAppearance ? 'check' : 'help'} /><span>职业外观</span><span className="grow">{hasAppearance ? evidence?.appearance?.label ?? '已冻结外观' : '本条消息未冻结职业外观，保持中性形象，不套用当前设置。'}</span></div>
        {evidence === undefined ? null : <p className="hint">核对结论：以下为原消息的只读证据，不授予执行权限；读取版本 {revisionText ?? '未返回'}。</p>}
      </>}
    </section>}
    <section className="kb-researcher-section"><h3>已发送问题</h3><div className="kb-researcher-question">{sentQuestion ?? '尚未发送问题'}</div>{sentQuestion !== undefined || draft.trim() === '' ? null : <><p>待发送草稿 <Badge>未发送</Badge></p><div className="kb-researcher-question" style={{ borderStyle: 'dashed' }}>{draft}</div></>}</section>
    <section className="kb-researcher-section"><h3>工具记录</h3>{result === undefined && pending ? <p className="hint">本轮仍在处理中，完整工具记录随结果保留。</p> : <ResearchTimeline steps={fresh?.steps} toolActivity={fresh?.toolActivity} compact />}{result?.status === 'stopped' ? <p className="hint">本轮已按请求停止，已写内容保留。</p> : null}</section>
    <section className="kb-researcher-section"><h3>引用材料</h3><p className="hint">打开原文时会关闭本面板</p>{(result?.citations ?? []).map((citation, index) => <div className="list-row" key={`${citation.path}:${citation.line}:${String(index)}`}><span>{index + 1}</span><span className="grow mono">{citation.path}:{citation.line}</span><Button size="sm" onClick={() => onOpenCitation(index)}>原文</Button></div>)}{result !== undefined && result.citations.length === 0 ? <p className="hint">{result.status === 'stopped' ? '回答在生成中停止；引用只覆盖已完成的句子，因此没有引用材料。' : '模型没有给出可验证的引用。'}</p> : null}</section>
    <section className="kb-researcher-section"><h3>资料来源</h3><p>{projectName} {sentQuestion === undefined ? '' : '· 本次对话固定'}</p><div className="row wrap">{selectedSources.map((path) => <Badge key={path}>{path}</Badge>)}</div></section>
  </Drawer>;
}
