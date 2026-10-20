import { PptPlanBrief, PptPlanNarrative, PptPlanSlides, PptPlanVisual, PptPlanAssets, PptPlanNotes, PptPlanDelivery } from './PptPlanSections.tsx';
import { useEffect, useRef, useState } from 'react';
import { createRequestKey, type PptWork, type PptSlide, type PptProductionPlan, type PptBrief } from '@agent-workflow/shared';
import { Drawer } from '../../components/Drawer.tsx';
import { Button } from '../../components/Button.tsx';
import { Modal } from '../../components/Modal.tsx';
import { Icon } from '../../components/Icon.tsx';
import { defaultPptPlan } from './ppt-plan-defaults.ts';
import { pptProductionPages, type PptCommand, type PptCommandKind } from './ppt-shared.tsx';
const TABS = [['brief', '制作目标'], ['narrative', '叙事结构'], ['slides', '页面内容'], ['visual', '视觉规范'], ['assets', '图表素材'], ['notes', '演讲辅助'], ['delivery', '交付设置']] as const;
type Tab = (typeof TABS)[number][0];
const EMPTY_BRIEF: PptBrief = { audience: '', objective: '', length: '', style: '', sources: '' };
export function PptPlanDrawer({ work, open, onClose, blocked, blockedReason, busyKind, onCommand, onRefresh }: {
    readonly work: PptWork;
    readonly open: boolean;
    readonly onClose: () => void;
    readonly blocked: boolean;
    readonly blockedReason?: string;
    readonly busyKind?: PptCommandKind | null;
    readonly onCommand: (command: PptCommand) => void;
    readonly onRefresh?: () => void;
}) {
    const [brief, setBrief] = useState<PptBrief>(work.brief ?? EMPTY_BRIEF);
    const [plan, setPlan] = useState<PptProductionPlan>(work.plan ?? defaultPptPlan(work));
    const [slides, setSlides] = useState<readonly PptSlide[]>(work.slides.length ? work.slides : work.outline.map(title => ({ title, bullets: [] })));
    const [tab, setTab] = useState<Tab>('brief');
    const [revision, setRevision] = useState(work.revision ?? 1);
    const [leave, setLeave] = useState(false);
    const [reopen, setReopen] = useState(false);
    const [direction, setDirection] = useState(work.direction ?? 'restrained');
    const priorSource = useRef({ brief, plan, slides, direction });
    useEffect(() => { const next = { brief: work.brief ?? EMPTY_BRIEF, plan: work.plan ?? defaultPptPlan(work), slides: work.slides.length ? work.slides : work.outline.map(title => ({ title, bullets: [] })), direction: work.direction ?? 'restrained' }; const current = { brief, plan, slides, direction }; if (JSON.stringify(current) === JSON.stringify(priorSource.current) || JSON.stringify(current) === JSON.stringify(next)) { setBrief(next.brief); setPlan(next.plan); setSlides(next.slides); setDirection(next.direction); setRevision(work.revision ?? 1); } priorSource.current = next; }, [work.revision]);
    useEffect(() => {
        if (!open || leave)
            return;
        const trap = (event: KeyboardEvent) => { if (event.key !== 'Tab')
            return; const root = document.querySelector('[role="dialog"][aria-label="制作方案"]'); const nodes = [...(root?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),[tabindex="0"]') ?? [])].filter(node => node.offsetParent !== null); const first = nodes[0], last = nodes.at(-1); if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last?.focus();
        }
        else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
        } };
        document.addEventListener('keydown', trap);
        return () => document.removeEventListener('keydown', trap);
    }, [open, leave]);
    /* P07-03 / pl-review：已用于制作（已确认且已有逐页生产状态）时整表只读，
     * 只留「修改方案」确认；pl-ro-active / pl-ro-archived 同样整表只读并写明原因。 */
    const archived = work.archived === true;
    const generationStatus = work.generation?.status;
    const generating = work.status === 'generating' || generationStatus === 'running' || generationStatus === 'stopping' || generationStatus === 'unknown';
    const productionCount = pptProductionPages(work)?.length ?? 0;
    const reviewPhase = plan.confirmed && productionCount > 0 && !archived && !generating;
    const readOnly = archived || generating || reviewPhase;
    const saving = busyKind === 'update';
    const dirty = JSON.stringify(brief) !== JSON.stringify(work.brief ?? EMPTY_BRIEF) || JSON.stringify(plan) !== JSON.stringify(work.plan ?? defaultPptPlan(work)) || JSON.stringify(slides) !== JSON.stringify(work.slides) || direction !== work.direction;
    const validAccent = /^#[0-9a-fA-F]{6}$/.test(plan.visual.accent);
    const frozen = plan.confirmed;
    useEffect(() => { if (JSON.stringify(plan) === JSON.stringify(work.plan) && JSON.stringify(slides) === JSON.stringify(work.slides))
        setRevision(work.revision ?? 1); }, [work.revision, work.plan, work.slides, plan, slides]);
    const stale = revision !== (work.revision ?? 1);
    /* P07-23：只有页面内容真的改动时才提交 slides；服务端按页 diff，不会伪造完成状态。 */
    const save = (confirmed = plan.confirmed) => { const next = { ...plan, confirmed }; setPlan(next); const slidesChanged = JSON.stringify(slides) !== JSON.stringify(work.slides); const outline = slides.map(page => page.title); const outlineChanged = JSON.stringify(outline) !== JSON.stringify(work.outline); onCommand({ kind: 'update', workId: work.id, body: { requestKey: createRequestKey(), confirmUpdate: true, expectedRevision: revision, plan: next, brief, direction, ...(slidesChanged ? { slides } : {}), ...(slidesChanged || outlineChanged ? { outline } : {}) } }); };
    const startProduction = () => { if (dirty || busyKind !== null && busyKind !== undefined) return; onClose(); onCommand({ kind: 'generateSlides', workId: work.id, body: { requestKey: createRequestKey(), confirmGenerate: true, expectedRevision: work.revision ?? 1 } }); };
    const input = (value: string, change: (value: string) => void, disabled = false) => <input className="input" value={value} maxLength={4000} disabled={blocked || disabled} onChange={event => change(event.target.value)}/>;
    const area = (value: string, change: (value: string) => void, disabled = false) => <textarea className="textarea" rows={3} value={value} maxLength={4000} disabled={blocked || disabled} onChange={event => change(event.target.value)}/>;
    const editPage = (index: number, patch: Partial<PptSlide>) => setSlides(current => current.map((page, at) => at === index ? { ...page, ...patch } : page));
    const removePage = (index: number) => setSlides(current => current.filter((_, at) => at !== index));
    const movePage = (index: number, step: number) => setSlides(current => { const next = [...current]; const destination = index + step; if (destination >= 0 && destination < next.length)
        [next[index], next[destination]] = [next[destination]!, next[index]!]; return next; });
    const context = { work, brief, setBrief, plan, setPlan, slides, setSlides, blocked: blocked || readOnly, frozen, input, area, editPage, removePage, movePage, direction, setDirection, validAccent };
    const phase = archived ? <div className="ppt-plan-phase"><Icon name="archive" /><span className="grow"><b style={{ fontWeight: 500 }}>作品已归档，方案只读</b><span className="hint">恢复作品后才能修改或重新制作。</span></span><Button variant="secondary" size="sm" disabled disabledReason="作品已归档">修改方案</Button></div>
        : generating ? <div className="ppt-plan-phase"><Icon name="clock" /><span className="grow"><b style={{ fontWeight: 500 }}>助手正在制作，方案暂时只读</b><span className="hint">制作完成或停止后，才能重新打开修改。</span></span><Button variant="secondary" size="sm" disabled disabledReason="制作进行中">修改方案</Button></div>
            : reviewPhase ? <div className="ppt-plan-phase"><Icon name="lock" /><span className="grow"><b style={{ fontWeight: 500 }}>方案已用于制作</b><span className="hint">重新打开后才能修改；现有页面和导出会保留。</span></span><Button variant="secondary" size="sm" onClick={() => setReopen(true)}><Icon name="edit" size="sm" />修改方案</Button></div>
                : <div className="ppt-plan-phase"><Icon name="sparkle" /><span className="grow"><b style={{ fontWeight: 500 }}>{plan.confirmed ? '方案已重新打开 · 方向已确认' : '设计方案阶段 · 可以调整方向'}</b><span className="hint">{dirty ? '先保存方案，再按方案制作。' : plan.confirmed ? '按已保存的方案和资料重新完成全部页面。' : '保存并确认方案后，才能开始逐页制作。'}</span></span>{plan.confirmed ? <Button variant="secondary" size="sm" disabled={blocked || dirty || (busyKind !== null && busyKind !== undefined)} disabledReason={blocked ? blockedReason ?? '当前只读' : dirty ? '先保存方案，再开始制作。' : busyKind ? '另一条命令正在等待回执。' : undefined} onClick={startProduction}>按方案制作</Button> : <Button variant="secondary" size="sm" disabled={blocked || (busyKind !== null && busyKind !== undefined)} disabledReason={blocked ? blockedReason ?? '当前只读' : !validAccent ? '修正强调色后才能确认方案。' : busyKind ? '另一条命令正在等待回执。' : undefined} onClick={() => save(true)}>确认方案</Button>}</div>;
    const status = readOnly || saving ? (saving ? '正在保存…' : `只读 · 已保存修订 ${work.revision ?? 1}`) : stale ? '本地修改保留，请先核对新修订' : dirty ? (validAccent ? '有未保存的修改' : '修改已保留，请核对后保存 · 强调色格式不正确') : `已保存修订 ${work.revision ?? 1}`;
    return <><Drawer open={open} title="制作方案" size="md" onClose={() => dirty && !readOnly ? setLeave(true) : onClose()} footer={<><span role="status" className="hint">{status}{readOnly && blockedReason !== undefined && !archived && !generating ? ` · ${blockedReason}` : ''}</span>{readOnly ? null : <Button disabled={blocked || saving || !validAccent || stale || !dirty} disabledReason={!validAccent ? '修正强调色后才能保存' : stale ? '作品有新修订；先比较本地修改与服务版本' : saving ? '保存请求已发出，正在等待服务回执。' : undefined} onClick={() => save()}>{saving ? '正在保存…' : '保存方案'}</Button>}</>}>
 {phase}
 {stale ? <div className="banner warn"><Icon name="alert"/><div>方案已有新版本，本地输入保留。<details><summary>查看服务当前方案并比对</summary><pre style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(work.plan, null, 2)}</pre></details><div className="row wrap" style={{ gap: 8, marginTop: 8 }}><Button variant="secondary" size="sm" icon="refresh" onClick={() => onRefresh?.()}>读取最新方案</Button><Button variant="secondary" size="sm" onClick={() => setRevision(work.revision ?? 1)}>已比对，按当前修订保存</Button></div></div></div> : null}
 <div className="tabs" role="tablist" aria-label="方案模块" onKeyDown={event => { if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')
        return; event.preventDefault(); const index = TABS.findIndex(([id]) => id === tab); const next = (index + (event.key === 'ArrowRight' ? 1 : -1) + TABS.length) % TABS.length; setTab(TABS[next]![0]); const buttons = event.currentTarget.querySelectorAll<HTMLButtonElement>('[role=tab]'); requestAnimationFrame(() => buttons[next]?.focus()); }}>{TABS.map(([id, label]) => <button key={id} type="button" className="tab" role="tab" aria-selected={tab === id} tabIndex={tab === id ? 0 : -1} onClick={() => setTab(id)}>{label}{id === 'visual' && !validAccent ? <span className="bad" aria-label="有需要修正的字段" /> : null}</button>)}</div>
 <div role="tabpanel" aria-label={TABS.find(([id]) => id === tab)?.[1]}>

 {tab === 'brief' ? <PptPlanBrief {...context}/> : null}
 {tab === 'narrative' ? <PptPlanNarrative {...context}/> : null}
 {tab === 'slides' ? <PptPlanSlides {...context}/> : null}
 {tab === 'visual' ? <PptPlanVisual {...context}/> : null}
 {tab === 'assets' ? <PptPlanAssets {...context}/> : null}
 {tab === 'notes' ? <PptPlanNotes {...context}/> : null}
 {tab === 'delivery' ? <PptPlanDelivery {...context}/> : null}
 </div></Drawer><Modal open={leave} title="保留未保存的方案修改？" onClose={() => setLeave(false)} footer={<><Button variant="ghost" onClick={() => { setLeave(false); onClose(); }}>保留本地修改并关闭</Button><Button onClick={() => setLeave(false)}>继续编辑</Button></>}>当前输入保留在本页；重新打开方案可继续编辑，服务版本不会被未保存修改覆盖。</Modal><Modal open={reopen} title="修改制作方案？" onClose={() => setReopen(false)} footer={<><Button variant="ghost" onClick={() => setReopen(false)}>取消</Button><Button onClick={() => { setReopen(false); save(false); }}>修改方案</Button></>}>现有页面和导出会保留。修改后需要重新制作才会生效。</Modal></>;
}
