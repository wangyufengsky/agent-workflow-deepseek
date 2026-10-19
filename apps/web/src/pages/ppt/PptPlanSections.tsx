import type { ReactNode, Dispatch, SetStateAction } from 'react';
import { PptSlideLayout, type PptBrief, type PptSlide, type PptWork, type PptProductionPlan, type PptVisualDirectionValue } from '@agent-workflow/shared';
import { Button } from '../../components/Button.tsx';
export interface PlanContext {
    readonly brief: PptBrief;
    readonly setBrief: (value: PptBrief) => void;
    readonly work: PptWork;
    readonly plan: PptProductionPlan;
    readonly setPlan: (value: PptProductionPlan) => void;
    readonly slides: readonly PptSlide[];
    readonly setSlides: Dispatch<SetStateAction<readonly PptSlide[]>>;
    readonly blocked: boolean;
    readonly frozen: boolean;
    readonly validAccent: boolean;
    readonly direction: PptVisualDirectionValue;
    readonly setDirection: (value: PptVisualDirectionValue) => void;
    readonly input: (value: string, change: (value: string) => void, disabled?: boolean) => ReactNode;
    readonly area: (value: string, change: (value: string) => void, disabled?: boolean) => ReactNode;
    readonly editPage: (index: number, patch: Partial<PptSlide>) => void;
    readonly removePage: (index: number) => void;
    readonly movePage: (index: number, step: number) => void;
}
function Field({ label, children }: {
    readonly label: string;
    readonly children: ReactNode;
}) { return <label className="field"><span className="label">{label}</span>{children}</label>; }
export function PptPlanBrief(context: PlanContext) {
    const { work, brief, setBrief, plan, setPlan, slides, setSlides, blocked, frozen, input, area, editPage, removePage, movePage, direction, setDirection, validAccent } = context;
    return <><Field label="受众">{input(brief.audience, value => setBrief({ ...brief, audience: value }), frozen)}</Field><Field label="目的">{area(brief.objective, value => setBrief({ ...brief, objective: value }), frozen)}</Field><p className="hint">受众与目的与需求简报同步保存；方向确认后需先重新打开需求。</p><Field label="汇报时长">{input(plan.duration, value => setPlan({ ...plan, duration: value }), frozen)}</Field><Field label="预计页数（1–100）"><input className="input" type="number" min={1} max={100} value={plan.pageCount} disabled={blocked || frozen} onChange={event => setPlan({ ...plan, pageCount: Number(event.target.value) })}/></Field><Field label="补充要求">{area(plan.requirements, value => setPlan({ ...plan, requirements: value }), frozen)}</Field></>;
}
export function PptPlanNarrative(context: PlanContext) {
    const { work, brief, setBrief, plan, setPlan, slides, setSlides, blocked, frozen, input, area, editPage, removePage, movePage, direction, setDirection, validAccent } = context;
    return <><h3>整体方向</h3>{plan.directions.map((item, index) => <details className="card pad" key={item.id}><summary><label><input type="radio" name="ppt-plan-direction" checked={direction === item.id} disabled={blocked || frozen} onChange={() => setDirection(item.id)}/>{item.title}</label></summary>{(['title', 'description', 'storyline', 'chapters', 'visual'] as const).map((field) => <Field key={field} label={{ title: '方案名称', description: '方向说明', storyline: '讲述主线', chapters: '章节安排', visual: '视觉方向' }[field]}>{area(item[field], value => setPlan({ ...plan, directions: plan.directions.map((old, at) => at === index ? { ...old, [field]: value } : old) }), frozen)}</Field>)}</details>)}<Field label="全稿主线与章节衔接">{area(plan.storyline, value => setPlan({ ...plan, storyline: value }))}</Field><h3>章节</h3>{plan.chapters.map((chapter, index) => <div className="card pad" key={index}><Field label="章节名称">{input(chapter.name, value => setPlan({ ...plan, chapters: plan.chapters.map((old, at) => at === index ? { ...old, name: value } : old) }))}</Field><Field label="本章目的">{area(chapter.purpose, value => setPlan({ ...plan, chapters: plan.chapters.map((old, at) => at === index ? { ...old, purpose: value } : old) }))}</Field><Field label="页数安排"><input className="input" type="number" min={1} max={100} value={chapter.pages} disabled={blocked} onChange={event => setPlan({ ...plan, chapters: plan.chapters.map((old, at) => at === index ? { ...old, pages: Number(event.target.value) } : old) })}/></Field><Button variant="ghost" disabled={blocked} onClick={() => setPlan({ ...plan, chapters: plan.chapters.filter((_, at) => at !== index) })}>移除章节</Button></div>)}<Button variant="secondary" disabled={blocked || plan.chapters.length >= 30} onClick={() => setPlan({ ...plan, chapters: [...plan.chapters, { name: '新章节', purpose: '', pages: 1 }] })}>添加章节</Button></>;
}
export function PptPlanSlides(context: PlanContext) {
    const { work, brief, setBrief, plan, setPlan, slides, setSlides, blocked, frozen, input, area, editPage, removePage, movePage, direction, setDirection, validAccent } = context;
    return <>{slides.map((page, index) => <details className="card pad" key={index}><summary>{index + 1}. {page.title}</summary><Field label="标题">{input(page.title, value => editPage(index, { title: value }))}</Field><Field label="章节">{input(page.chapter ?? '', value => editPage(index, { chapter: value }))}</Field><Field label="版式"><select className="select" value={page.layout ?? 'text'} disabled={blocked} onChange={event => editPage(index, { layout: event.target.value as PptSlide['layout'] })}>{Object.entries(PptSlideLayout).map(([label, id]) => <option key={id} value={id}>{{ TITLE: '标题页', TEXT: '标题与正文', COLUMNS: '两栏对比', CARDS: '三栏卡片', FLOW: '流程图', IMAGE: '大图' }[label as keyof typeof PptSlideLayout]}</option>)}</select></Field><Field label="核心观点">{area(page.keyMessage ?? '', value => editPage(index, { keyMessage: value }))}</Field><Field label="页面内容（每行一条）">{area(page.bullets.join('\n'), value => editPage(index, { bullets: value.split('\n').filter(Boolean) }))}</Field><div className="row wrap"><Button disabled={blocked || index === 0} onClick={() => movePage(index, -1)}>上移</Button><Button disabled={blocked || index === slides.length - 1} onClick={() => movePage(index, 1)}>下移</Button><Button variant="ghost" disabled={blocked} onClick={() => removePage(index)}>移除这页</Button></div></details>)}<Button disabled={blocked || slides.length >= 100} onClick={() => setSlides([...slides, { title: '新页面', bullets: [] }])}>加一页</Button></>;
}
export function PptPlanVisual(context: PlanContext) {
    const { work, brief, setBrief, plan, setPlan, slides, setSlides, blocked, frozen, input, area, editPage, removePage, movePage, direction, setDirection, validAccent } = context;
    return <><Field label="整体风格">{area(plan.visual.style, value => setPlan({ ...plan, visual: { ...plan.visual, style: value } }))}</Field><Field label="字体"><select className="select" value={plan.visual.fontFace} disabled={blocked} onChange={event => setPlan({ ...plan, visual: { ...plan.visual, fontFace: event.target.value } })}>{['Arial', '思源黑体', '苹方', '微软雅黑'].map(font => <option key={font}>{font}</option>)}</select></Field><Field label="强调色"><input className="input mono" aria-invalid={!validAccent} value={plan.visual.accent} maxLength={7} disabled={blocked} onChange={event => setPlan({ ...plan, visual: { ...plan.visual, accent: event.target.value } })}/></Field>{!validAccent ? <p className="error-text" role="alert">请输入6位十六进制色值，例如 #4D6BFE，修正前不会保存。</p> : null}<Field label="文字密度"><select className="select" value={plan.visual.density} disabled={blocked} onChange={event => setPlan({ ...plan, visual: { ...plan.visual, density: event.target.value as PptProductionPlan['visual']['density'] } })}><option value="sparse">精简</option><option value="balanced">适中</option><option value="detailed">详细</option></select></Field><Field label="页面比例"><input className="input" value="16:9" readOnly/></Field></>;
}
export function PptPlanAssets(context: PlanContext) {
    const { work, brief, setBrief, plan, setPlan, slides, setSlides, blocked, frozen, input, area, editPage, removePage, movePage, direction, setDirection, validAccent } = context;
    return <>{(['usage', 'charts', 'images'] as const).map(field => <Field key={field} label={{ usage: '素材使用要求', charts: '图表表达要求', images: '配图要求' }[field]}>{area(plan.assets[field], value => setPlan({ ...plan, assets: { ...plan.assets, [field]: value } }))}</Field>)}<h3>每页依据</h3>{slides.map((page, index) => <div key={index} className="card pad"><b>{index + 1}. {page.title}</b>{work.attachments.map(source => <label className="row" key={source.name}><input type="checkbox" disabled={blocked} checked={page.sourceNames?.includes(source.name) ?? false} onChange={event => editPage(index, { sourceNames: event.target.checked ? [...(page.sourceNames ?? []), source.name] : (page.sourceNames ?? []).filter(name => name !== source.name) })}/>{source.name}</label>)}</div>)}</>;
}
export function PptPlanNotes(context: PlanContext) {
    const { work, brief, setBrief, plan, setPlan, slides, setSlides, blocked, frozen, input, area, editPage, removePage, movePage, direction, setDirection, validAccent } = context;
    return slides.map((page, index) => <Field key={index} label={`${index + 1}. ${page.title}`}>{area(page.notes ?? '', value => editPage(index, { notes: value }))}</Field>);
}
export function PptPlanDelivery(context: PlanContext) {
    const { work, brief, setBrief, plan, setPlan, slides, setSlides, blocked, frozen, input, area, editPage, removePage, movePage, direction, setDirection, validAccent } = context;
    return <><Field label="文件名称">{input(plan.delivery.filename, value => setPlan({ ...plan, delivery: { ...plan.delivery, filename: value } }))}</Field><Field label="目标办公软件">{input(plan.delivery.targetSoftware, value => setPlan({ ...plan, delivery: { ...plan.delivery, targetSoftware: value } }))}</Field><label className="row"><input type="checkbox" checked={plan.delivery.includeNotes} disabled={blocked} onChange={event => setPlan({ ...plan, delivery: { ...plan.delivery, includeNotes: event.target.checked } })}/>包含演讲备注</label><p className="hint">可编辑PPTX；页面预览来自当前作品内容渲染。</p></>;
}
