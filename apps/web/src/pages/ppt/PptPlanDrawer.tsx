import { PptPlanBrief, PptPlanNarrative, PptPlanSlides, PptPlanVisual, PptPlanAssets, PptPlanNotes, PptPlanDelivery } from './PptPlanSections.tsx';
import { useEffect, useRef, useState } from 'react';
import { createRequestKey, type PptWork, type PptSlide, type PptProductionPlan, type PptBrief } from '@agent-workflow/shared';
import { Drawer } from '../../components/Drawer.tsx';
import { Button } from '../../components/Button.tsx';
import { Modal } from '../../components/Modal.tsx';
import { Icon } from '../../components/Icon.tsx';
import { defaultPptPlan } from './ppt-plan-defaults.ts';
import type { PptCommand } from './ppt-shared.tsx';
const TABS = [['brief', '制作目标'], ['narrative', '叙事结构'], ['slides', '页面内容'], ['visual', '视觉规范'], ['assets', '图表素材'], ['notes', '演讲辅助'], ['delivery', '交付设置']] as const;
type Tab = (typeof TABS)[number][0];
export function PptPlanDrawer({ work, open, onClose, blocked, onCommand }: {
    readonly work: PptWork;
    readonly open: boolean;
    readonly onClose: () => void;
    readonly blocked: boolean;
    readonly onCommand: (command: PptCommand) => void;
}) {
    const [brief, setBrief] = useState<PptBrief>(work.brief ?? { audience: '', objective: '', length: '', style: '', sources: '' });
    const [plan, setPlan] = useState(work.plan ?? defaultPptPlan(work));
    const [slides, setSlides] = useState<readonly PptSlide[]>(work.slides.length ? work.slides : work.outline.map(title => ({ title, bullets: [] })));
    const [tab, setTab] = useState<Tab>('brief');
    const [revision, setRevision] = useState(work.revision ?? 1);
    const [leave, setLeave] = useState(false);
    const [direction, setDirection] = useState(work.direction ?? 'restrained');
    const priorSource=useRef({brief,plan,slides,direction});
    useEffect(()=>{const next={brief:work.brief??{audience:'',objective:'',length:'',style:'',sources:''},plan:work.plan??defaultPptPlan(work),slides:work.slides.length?work.slides:work.outline.map(title=>({title,bullets:[]})),direction:work.direction??'restrained'};const current={brief,plan,slides,direction};if(JSON.stringify(current)===JSON.stringify(priorSource.current)||JSON.stringify(current)===JSON.stringify(next)){setBrief(next.brief);setPlan(next.plan);setSlides(next.slides);setDirection(next.direction);setRevision(work.revision??1);}priorSource.current=next;},[work.revision]);
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
    const dirty = JSON.stringify(brief) !== JSON.stringify(work.brief ?? { audience: '', objective: '', length: '', style: '', sources: '' }) || JSON.stringify(plan) !== JSON.stringify(work.plan ?? defaultPptPlan(work)) || JSON.stringify(slides) !== JSON.stringify(work.slides) || direction !== work.direction;
    const validAccent = /^#[0-9a-fA-F]{6}$/.test(plan.visual.accent);
    const frozen = plan.confirmed;
    useEffect(() => { if (JSON.stringify(plan) === JSON.stringify(work.plan) && JSON.stringify(slides) === JSON.stringify(work.slides))
        setRevision(work.revision ?? 1); }, [work.revision, work.plan, work.slides, plan, slides]);
    const stale = revision !== (work.revision ?? 1);
    const save = (confirmed = plan.confirmed) => { const next = { ...plan, confirmed }; setPlan(next); onCommand({ kind: 'update', workId: work.id, body: { requestKey: createRequestKey(), confirmUpdate: true, expectedRevision: revision, plan: next, brief, direction, slides, outline: slides.map(page => page.title) } }); };
    const input = (value: string, change: (value: string) => void, disabled = false) => <input className="input" value={value} maxLength={4000} disabled={blocked || disabled} onChange={event => change(event.target.value)}/>;
    const area = (value: string, change: (value: string) => void, disabled = false) => <textarea className="textarea" rows={3} value={value} maxLength={4000} disabled={blocked || disabled} onChange={event => change(event.target.value)}/>;
    const editPage = (index: number, patch: Partial<PptSlide>) => setSlides(current => current.map((page, at) => at === index ? { ...page, ...patch } : page));
    const removePage = (index: number) => setSlides(current => current.filter((_, at) => at !== index));
    const movePage = (index: number, step: number) => setSlides(current => { const next = [...current]; const destination = index + step; if (destination >= 0 && destination < next.length)
        [next[index], next[destination]] = [next[destination]!, next[index]!]; return next; });
    const context = { work, brief, setBrief, plan, setPlan, slides, setSlides, blocked, frozen, input, area, editPage, removePage, movePage, direction, setDirection, validAccent };
    return <><Drawer open={open} title="制作方案" size="md" onClose={() => dirty ? setLeave(true) : onClose()} footer={<><span role="status" className="hint">{blocked ? '当前只读' : stale ? '本地修改保留，请先核对新修订' : dirty ? '有未保存的修改' : `已保存 r${work.revision ?? 1}`}</span><Button disabled={blocked || !validAccent || stale || !dirty} disabledReason={!validAccent ? '修正强调色后才能保存' : stale ? '作品有新修订；先比较本地修改与服务版本' : undefined} onClick={() => save()}>保存方案</Button></>}>
 {stale ? <div className="banner warn"><Icon name="alert"/><div>方案已有新版本，本地输入保留。<details><summary>查看服务当前方案并比对</summary><pre style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(work.plan, null, 2)}</pre></details><Button variant="secondary" onClick={() => setRevision(work.revision ?? 1)}>已比对，按当前修订保存我的修改</Button></div></div> : null}
 <div className="row wrap" style={{ marginBottom: 12 }}><span className="grow">{frozen ? '方案方向已确认；页面、素材与备注仍可调整' : '制作目标与方向可调整'}</span>{frozen ? <Button variant="secondary" disabled={blocked} onClick={() => { setPlan({ ...plan, confirmed: false }); }}>重新打开需求</Button> : <Button disabled={blocked || !validAccent || stale} onClick={() => save(true)}>确认方案</Button>}</div>
 <div className="tabs" role="tablist" aria-label="方案模块" onKeyDown={event => { if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')
        return; event.preventDefault(); const index = TABS.findIndex(([id]) => id === tab); const next = (index + (event.key === 'ArrowRight' ? 1 : -1) + TABS.length) % TABS.length; setTab(TABS[next]![0]); const buttons = event.currentTarget.querySelectorAll<HTMLButtonElement>('[role=tab]'); requestAnimationFrame(() => buttons[next]?.focus()); }}>{TABS.map(([id, label]) => <button key={id} type="button" className="tab" role="tab" aria-selected={tab === id} tabIndex={tab === id ? 0 : -1} onClick={() => setTab(id)}>{label}</button>)}</div>
 <div role="tabpanel" aria-label={TABS.find(([id]) => id === tab)?.[1]}>

 {tab === 'brief' ? <PptPlanBrief {...context}/> : null}
 {tab === 'narrative' ? <PptPlanNarrative {...context}/> : null}
 {tab === 'slides' ? <PptPlanSlides {...context}/> : null}
 {tab === 'visual' ? <PptPlanVisual {...context}/> : null}
 {tab === 'assets' ? <PptPlanAssets {...context}/> : null}
 {tab === 'notes' ? <PptPlanNotes {...context}/> : null}
 {tab === 'delivery' ? <PptPlanDelivery {...context}/> : null}
 </div></Drawer><Modal open={leave} title="保留未保存的方案修改？" onClose={() => setLeave(false)} footer={<><Button variant="ghost" onClick={() => { setLeave(false); onClose(); }}>保留本地修改并关闭</Button><Button onClick={() => setLeave(false)}>继续编辑</Button></>}>当前输入保留在本页；重新打开方案可继续编辑，服务版本不会被未保存修改覆盖。</Modal></>;
}
