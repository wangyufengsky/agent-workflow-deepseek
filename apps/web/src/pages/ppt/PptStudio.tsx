import { useEffect, useState, type KeyboardEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ROUTES, createRequestKey, pptPages, pptPageLayout, renderPptPage, type PptCheckReport, type PptSlide, type PptTextStyle, type PptWork } from '@agent-workflow/shared';
import { apiGet } from '../../api/client.ts';
import { Button } from '../../components/Button.tsx';
import { Icon } from '../../components/Icon.tsx';
import { ServiceNotice } from '../../components/ServiceNotice.tsx';
import { PptAssistantPanel } from './PptAssistantPanel.tsx';
import type { PptCommand } from './ppt-shared.tsx';
type ObjectKind = 'title' | 'body' | 'tag';
type SideTab = 'chat' | 'prop' | 'check';
interface PageDraft {
    readonly page: PptSlide;
    readonly revision: number;
}
function restoreStudio(id: string): {
    current?: number;
    tab?: SideTab;
    manual?: boolean;
    selected?: ObjectKind;
    drafts?: Record<number, PageDraft>;
} {
    try {
        const value = JSON.parse(sessionStorage.getItem(`ppt.studio.${id}`) ?? 'null');
        if (!value || typeof value !== 'object')
            return {};
        return { current: Number.isInteger(value.current) && value.current >= 0 ? value.current : 0, tab: ['chat', 'prop', 'check'].includes(value.tab) ? value.tab : 'chat', manual: value.manual === true, selected: ['title', 'body', 'tag'].includes(value.selected) ? value.selected : undefined, drafts: Object.fromEntries(Object.entries(value.drafts ?? {}).filter(([index, draft]) => /^\d+$/.test(index) && !!draft && typeof draft === 'object' && Number.isInteger((draft as PageDraft).revision) && typeof (draft as PageDraft).page?.title === 'string' && Array.isArray((draft as PageDraft).page?.bullets))) };
    }
    catch {
        return {};
    }
}
const TABS = [['chat', 'PPT 助手'], ['prop', '对象属性'], ['check', '检查']] as const;
const LABEL: Record<ObjectKind, string> = { title: '标题', body: '正文', tag: '小标签' };
const uri = (work: PptWork, page: number) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(renderPptPage(work, page))}`;
/** Draft identity includes the baseline revision; switching pages never overwrites unsaved edits. */
export function studioPageWork(work: PptWork, pageIndex: number, page: PptSlide): PptWork {
    return pageIndex === 0 ? { ...work, cover: page, title: page.title, topic: page.bullets.join('\n') } : { ...work, slides: (work.slides.length ? work.slides : pptPages(work).slice(1)).map((item, index) => index === pageIndex - 1 ? page : item) };
}
export function studioPageCommand(work: PptWork, pageIndex: number, draft: PageDraft): PptCommand {
    return { kind: 'update', workId: work.id, body: { requestKey: createRequestKey(), confirmUpdate: true, expectedRevision: draft.revision, ...(pageIndex === 0 ? { cover: draft.page, title: draft.page.title, topic: draft.page.bullets.join('\n') } : { slides: (work.slides.length ? work.slides : pptPages(work).slice(1)).map((item, index) => index === pageIndex - 1 ? draft.page : item), outline: work.outline.map((title, index) => index === pageIndex - 1 ? draft.page.title : title) }) } };
}
export function PptStudio({ work, blocked, blockedReason, onCommand }: {
    readonly work: PptWork;
    readonly blocked: boolean;
    readonly blockedReason?: string;
    readonly onCommand: (command: PptCommand) => void;
}) {
    const pages = pptPages(work);
    const [restored] = useState(() => restoreStudio(work.id));
    const [current, setCurrent] = useState(restored.current ?? 0);
    const [tab, setTab] = useState<SideTab>(restored.tab ?? 'chat');
    const [manual, setManual] = useState(restored.manual ?? false);
    const [selected, setSelected] = useState<ObjectKind>(restored.selected);
    const [drafts, setDrafts] = useState<Record<number, PageDraft>>(restored.drafts ?? {});
    useEffect(() => {
        try {
            sessionStorage.setItem(`ppt.studio.${work.id}`, JSON.stringify({ current, tab, manual, selected, drafts }));
        }
        catch { /* Editing still remains in memory; save uses the ordinary command journal. */ }
    }, [work.id, current, tab, manual, selected, drafts]);
    const pageIndex = Math.min(current, Math.max(0, pages.length - 1));
    const original = pages[pageIndex]!;
    const draft = drafts[pageIndex] ?? { page: original, revision: work.revision ?? 1 };
    const dirty = JSON.stringify(draft.page) !== JSON.stringify(original);
    const preview = studioPageWork(work, pageIndex, draft.page);
    const layout = pptPageLayout(pptPages(preview)[pageIndex]!, pageIndex === 0);
    const report = useQuery({ queryKey: ['ppt', work.id, 'check', work.revision], queryFn: async () => (await apiGet<PptCheckReport>(ROUTES.pptWorkCheck(work.id))).data, retry: false });
    const currentIssues = report.data?.pages.find(page => page.page === pageIndex)?.issues ?? [];
    useEffect(() => { setDrafts(existing => Object.fromEntries(Object.entries(existing).filter(([index, value]) => pages[Number(index)] && JSON.stringify(value.page) !== JSON.stringify(pages[Number(index)])))); }, [work.revision]);
    const changePage = (value: number) => { setCurrent(value); setSelected(undefined); };
    const update = (patch: Partial<PptSlide>) => setDrafts(values => ({ ...values, [pageIndex]: { page: { ...draft.page, ...patch }, revision: draft.revision } }));
    const styleKey = selected === 'title' ? 'titleStyle' : selected === 'body' ? 'bodyStyle' : 'tagStyle';
    const textStyle: PptTextStyle = draft.page[styleKey] ?? { fontSize: selected === 'title' ? (pageIndex === 0 ? 32 : 24) : selected === 'body' ? 16 : 12, color: selected === 'title' ? 'accent' : 'primary', align: 'left' };
    const text = selected === 'title' ? draft.page.title : selected === 'body' ? draft.page.bullets.join('\n') : draft.page.tag ?? '';
    const updateStyle = (value: Partial<PptTextStyle>) => update({ [styleKey]: { ...textStyle, ...value } });
    const tabKeys = (event: KeyboardEvent<HTMLDivElement>) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key))
            return;
        event.preventDefault();
        const at = TABS.findIndex(([key]) => key === tab);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? 2 : (at + (event.key === 'ArrowRight' ? 1 : -1) + 3) % 3;
        setTab(TABS[next]![0]);
        event.currentTarget.querySelectorAll<HTMLButtonElement>('[role=tab]')[next]?.focus();
    };
    const selectObject = (kind: ObjectKind) => { setSelected(kind); setTab('prop'); };
    return <div className="ppt-studio" aria-label="逐页制作工作台">
  <nav className="ppt-studio-rail" aria-label="页面">
   {pages.map((page, index) => <button className="ppt-studio-thumb" key={index} aria-current={pageIndex === index ? 'page' : undefined} onClick={() => changePage(index)} onKeyDown={event => {
                if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key))
                    return;
                event.preventDefault();
                const next = event.key === 'Home' ? 0 : event.key === 'End' ? pages.length - 1 : Math.min(pages.length - 1, Math.max(0, index + (event.key === 'ArrowDown' ? 1 : -1)));
                changePage(next);
                event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('.ppt-studio-thumb')[next]?.focus();
            }} aria-label={`第 ${index + 1} 页 ${page.title}`}><span className="num">{index + 1}</span><img alt="" src={uri(work, index)}/>{report.data?.pages.find(item => item.page === index)?.issues.length ? <Icon name="alert" size="sm"/> : null}{drafts[index] && JSON.stringify(drafts[index]?.page) !== JSON.stringify(page) ? <span className="hint">未保存</span> : null}</button>)}
   <Button variant="ghost" size="sm" icon="plus" disabled={blocked || pages.length >= 100} disabledReason={blockedReason ?? '最多100页（含封面）'} onClick={() => onCommand({ kind: 'update', workId: work.id, body: { requestKey: createRequestKey(), expectedRevision: work.revision ?? 1, confirmUpdate: true, outline: [...work.outline, '新页面'], slides: [...(work.slides.length ? work.slides : pptPages(work).slice(1)), { title: '新页面', bullets: [] }] } })}>加一页</Button>
  </nav>
  <section className="card ppt-studio-center" aria-label="当前页面">
   <div className="card-head row wrap"><span className="grow">第 {pageIndex + 1} 页 · {original.title}</span>{currentIssues.length ? <span className="hint"><Icon name="alert" size="sm"/>{currentIssues.length} 个检查问题</span> : null}<label className="row hint" style={{ gap: 8 }}>手动编辑<input type="checkbox" role="switch" checked={manual} disabled={blocked} title={blockedReason} onChange={event => { setManual(event.target.checked); setSelected(undefined); setTab(event.target.checked ? 'prop' : 'chat'); }}/></label><Button size="sm" variant="ghost" icon="shield" onClick={() => setTab('check')}>检查</Button></div>
   <div className="ppt-studio-stage"><div className="ppt-object-preview"><img src={uri(preview, pageIndex)} alt={`第 ${pageIndex + 1} 页 · ${draft.page.title} 当前页面`}/>{manual ? (['title', 'body', 'tag'] as const).map(kind => { const lines = layout[kind]; const x = lines.length ? Math.min(...lines.map(line => line.x)) : 0.7; const y = lines.length ? Math.min(...lines.map(line => line.y)) : 6.75; const bottom = lines.length ? Math.max(...lines.map(line => line.y + line.height)) : 7.1; return <button key={kind} className="ppt-object-hit" data-selected={selected === kind} aria-label={`选择${LABEL[kind]}对象`} disabled={blocked} title={blockedReason} style={{ left: `${x / 13.333 * 100}%`, top: `${y / 7.5 * 100}%`, width: '88%', height: `${Math.max(.35, bottom - y) / 7.5 * 100}%` }} onClick={() => selectObject(kind)}/>; }) : null}</div>
    <details className="ppt-studio-notes" open><summary><Icon name="edit" size="sm"/>演讲备注<span className="hint">只在演讲者视图显示</span></summary><textarea className="textarea" aria-label="演讲备注" value={draft.page.notes ?? ''} maxLength={4000} disabled={blocked} onChange={event => update({ notes: event.target.value })}/></details>
    {dirty ? <div className="row wrap"><span className="hint grow">{draft.revision !== (work.revision ?? 1) ? '作品已有新修订；本地输入保留，先比对后保存。' : '本页修改尚未保存；切换页面仍会保留。'}</span><Button disabled={blocked || draft.revision !== (work.revision ?? 1)} disabledReason={blockedReason ?? '作品已有新修订，请比对当前内容'} onClick={() => onCommand(studioPageCommand(work, pageIndex, draft))}>保存本页修改</Button><Button variant="ghost" onClick={() => setDrafts(values => { const next = { ...values }; delete next[pageIndex]; return next; })}>放弃本页修改</Button></div> : null}
   </div>
  </section>
  <aside className="card ppt-studio-aside" aria-label="PPT 助手与页面属性"><div className="tabs" role="tablist" aria-label="页面侧栏" onKeyDown={tabKeys}>{TABS.map(([key, label]) => <button className="tab" key={key} role="tab" aria-selected={tab === key} tabIndex={tab === key ? 0 : -1} onClick={() => setTab(key)}>{label}</button>)}</div>
   <div className="ppt-studio-side-body" hidden={tab !== 'chat'} role="tabpanel" aria-label="PPT 助手"><PptAssistantPanel work={work} blocked={blocked} selectedPage={pageIndex - 1} embedded/></div>
   <div className="ppt-studio-side-body pad" hidden={tab !== 'prop'} role="tabpanel" aria-label="对象属性">{!manual ? <div className="empty"><Icon name="edit"/><h3>打开手动编辑后可选中对象</h3><Button size="sm" variant="secondary" disabled={blocked} disabledReason={blockedReason} onClick={() => setManual(true)}>打开手动编辑</Button></div> : !selected ? <div className="empty"><h3>点击页面中的文字来编辑</h3><p>标题、正文和小标签都可以直接改。</p></div> : <div className="col" style={{ gap: 12 }}><p className="hint">已选中 · {LABEL[selected]}</p><label>文字<textarea className="textarea" rows={5} disabled={blocked} maxLength={selected === 'body' ? 2400 : 200} value={text} onChange={event => update(selected === 'title' ? { title: event.target.value } : selected === 'body' ? { bullets: event.target.value.split('\n').filter(Boolean) } : { tag: event.target.value })}/></label><label>字号（8–72）<input className="input" type="number" disabled={blocked} min={8} max={72} value={textStyle.fontSize} onChange={event => updateStyle({ fontSize: Number(event.target.value) })}/></label><label>颜色<select className="select" disabled={blocked} value={textStyle.color} onChange={event => updateStyle({ color: event.target.value as PptTextStyle['color'] })}><option value="primary">主文字</option><option value="accent">强调色</option><option value="muted">次要</option></select></label><div><label>对齐</label><div className="seg" role="group" aria-label="对象对齐">{(['left', 'center', 'right'] as const).map(align => <button key={align} disabled={blocked} aria-pressed={textStyle.align === align} onClick={() => updateStyle({ align })}>{{ left: '左', center: '中', right: '右' }[align]}</button>)}</div></div><div className="banner info"><Icon name="info"/><span>手动修改会被保留。之后让助手改这一页时，会先列出将覆盖的内容。</span></div></div>}</div>
   <div className="ppt-studio-side-body pad" hidden={tab !== 'check'} role="tabpanel" aria-label="检查"><div className="row"><b className="grow">当前修订检查</b><Button size="sm" variant="ghost" icon="refresh" onClick={() => { void report.refetch(); }}>重新检查</Button></div>{report.isLoading ? <p role="status">正在检查当前修订…</p> : report.error ? <ServiceNotice error={report.error} onRetry={() => { void report.refetch(); }}/> : <><p className="hint">修订 {report.data?.revision} · 由当前内容与版式规则检查</p>{report.data?.pages.flatMap(page => page.issues.map(issue => <button className="ppt-studio-issue" key={`${page.page}:${issue.code}`} onClick={() => changePage(page.page)}><Icon name="alert"/><span>第 {page.page + 1} 页 · {issue.message}</span></button>))}{report.data?.pages.every(page => page.issues.length === 0) ? <p><Icon name="check"/>当前规则未发现问题</p> : null}<h4>尚需人工核对</h4>{report.data?.unchecked.map(item => <p className="hint" key={item}>{item}</p>)}</>}</div>
  </aside>
 </div>;
}
