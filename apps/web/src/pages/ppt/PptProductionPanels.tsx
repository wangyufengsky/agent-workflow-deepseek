import { Icon } from '../../components/Icon.tsx';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ROUTES, createRequestKey, type PptWork, type PptBrief, type PptVisualDirectionValue, type PptCheckReport } from '@agent-workflow/shared';
import { apiGet } from '../../api/client.ts';
import { Button } from '../../components/Button.tsx';
import { ServiceNotice } from '../../components/ServiceNotice.tsx';
import type { PptCommand } from './ppt-shared.tsx';
interface Props {
    readonly work: PptWork;
    readonly blocked: boolean;
    readonly onCommand: (command: PptCommand) => void;
}
const EMPTY: PptBrief = { audience: '', objective: '', length: '', style: '', sources: '' };
const BRIEF_FIELDS = [['audience', '给谁看'], ['objective', '想达到'], ['length', '篇幅'], ['style', '风格'], ['sources', '依据资料']] as const;
export function PptBriefEditor({ work, blocked, onCommand }: Props) {
    const [brief, setBrief] = useState(work.brief ?? EMPTY);
    const [baselineRevision, setBaselineRevision] = useState(work.revision ?? 1);
    useEffect(() => { if (JSON.stringify(brief) === JSON.stringify(work.brief ?? EMPTY))
        setBaselineRevision(work.revision ?? 1); }, [work.revision, brief, work.brief]);
    return <section className="card pad"><h3>需求简报</h3><p className="hint">明确听众、目标、篇幅、风格与依据；简报保存后会用于生成。</p>{BRIEF_FIELDS.map(([field, label]) => <div className="field" key={field}><label className="label" htmlFor={`ppt-brief-${field}`}>{label}</label><textarea className="textarea" id={`ppt-brief-${field}`} maxLength={2000} rows={2} value={brief[field]} disabled={blocked} onChange={(event) => setBrief({ ...brief, [field]: event.target.value })}/></div>)}<Button disabled={blocked || JSON.stringify(brief) === JSON.stringify(work.brief ?? EMPTY)} onClick={() => onCommand({ kind: 'update', workId: work.id, body: { requestKey: createRequestKey(), brief, expectedRevision: baselineRevision, confirmUpdate: true } })}>保存需求简报</Button></section>;
}
const DIRECTIONS: readonly {
    id: PptVisualDirectionValue;
    title: string;
    description: string;
}[] = [
    { id: 'restrained', title: '深色克制', description: '深色底、少量强调色，清晰呈现关键内容。' },
    { id: 'editorial', title: '浅色编辑', description: '浅底大字，适合投影和打印。' },
    { id: 'contrast', title: '高对比', description: '黑底高亮，适合大会场远距离观看。' },
];
export function PptDirections({ work, blocked, onCommand }: Props) {
    return <section className="card pad"><h3>视觉方向</h3><div className="grid-3">{DIRECTIONS.map((direction) => <button type="button" className="card pad" key={direction.id} aria-pressed={work.direction === direction.id} disabled={blocked} onClick={() => onCommand({ kind: 'update', workId: work.id, body: { requestKey: createRequestKey(), direction: direction.id, expectedRevision: work.revision ?? 1, confirmUpdate: true } })}><img alt={`${direction.title}当前内容预览`} style={{ width: '100%', aspectRatio: '16/9' }} src={`${ROUTES.pptWorkThumbnail(work.id)}?direction=${direction.id}&revision=${work.revision ?? 1}`}/><b>{direction.title}{work.direction === direction.id ? ' · 已选' : ''}</b><p className="hint">{direction.description}</p></button>)}</div><p className="hint">已保存的方向用于内容生成、页面渲染和 PPTX 导出，界面主题独立设置。</p></section>;
}
export function PptPageChecks({ work, blocked, onCommand }: Props) {
    const report = useQuery({ queryKey: ['ppt', work.id, 'check', work.revision], queryFn: async () => (await apiGet<PptCheckReport>(ROUTES.pptWorkCheck(work.id))).data, retry: false });
    return <section><h3>逐页制作检查</h3>{report.isLoading ? <p role="status">正在检查当前修订…</p> : report.error ? <ServiceNotice error={report.error} onRetry={() => { void report.refetch(); }}/> : <><>{report.data?.revision !== (work.revision ?? 1) ? <div className="banner warn"><Icon name="alert" />作品已有新修订，请重新读取作品；当前编辑输入保留，保存时会核对原修订。</div> : null}</><p className="hint">修订 {report.data?.revision} · 确定性版式边界与内容检查，不代替人工审阅。</p>{report.data?.pages.map((page) => <article key={page.page} className="card pad" style={{ marginTop: 12 }}><img style={{ width: '100%', maxWidth: 480, aspectRatio: '16/9' }} src={`${ROUTES.pptWorkThumbnail(work.id)}?page=${page.page}&revision=${work.revision ?? 1}`} alt={`第${page.page + 1}页：${page.title}`}/><h4>{page.page + 1}. {page.title}</h4>{page.issues.length ? <ul>{page.issues.map((issue) => <li key={issue.code}><Icon name="alert" size="sm" /> {issue.message}</li>)}</ul> : <p><Icon name="check" size="sm" /> 当前规则未发现问题</p>}{page.page > 0 && work.slides[page.page - 1] ? <PptSlideEditor key={`${work.id}:${page.page}`} {...{ work, blocked, onCommand }} index={page.page - 1}/> : null}</article>)}<h4>尚需人工核对</h4><ul>{report.data?.unchecked.map((item) => <li key={item}>{item}</li>)}</ul></>}</section>;
}
function PptSlideEditor({ work, blocked, onCommand, index }: Props & {
    readonly index: number;
}) {
    const page = work.slides[index]!;
    const [title, setTitle] = useState(page.title);
    const [bullets, setBullets] = useState(page.bullets.join('\n'));
    const [notes, setNotes] = useState(page.notes ?? '');
    const [imageName, setImageName] = useState(page.imageName ?? '');
    const [baselineRevision, setBaselineRevision] = useState(work.revision ?? 1);
    useEffect(() => { if (title === page.title && bullets === page.bullets.join('\n') && notes === (page.notes ?? '') && imageName === (page.imageName ?? ''))
        setBaselineRevision(work.revision ?? 1); }, [work.revision, title, bullets, notes, imageName, page]);
    return <details><summary>编辑本页与演讲备注</summary><div className="field"><label className="label">页标题<input className="input" maxLength={200} value={title} onChange={(event) => setTitle(event.target.value)} disabled={blocked}/></label><label className="label">正文要点（每行一条）<textarea className="textarea" rows={5} value={bullets} onChange={(event) => setBullets(event.target.value)} disabled={blocked}/></label><label className="label">演讲备注<textarea className="textarea" rows={3} maxLength={4000} value={notes} onChange={(event) => setNotes(event.target.value)} disabled={blocked}/></label><label className="label">页面图片<select className="select" value={imageName} onChange={(event) => setImageName(event.target.value)} disabled={blocked}><option value="">不使用图片</option>{work.attachments.filter((item) => item.kind === 'image').map((item) => <option key={item.name}>{item.name}</option>)}</select></label><Button disabled={blocked} onClick={() => onCommand({ kind: 'update', workId: work.id, body: { requestKey: createRequestKey(), expectedRevision: baselineRevision, slides: work.slides.map((slide, at) => at === index ? { title, bullets: bullets.split('\n').filter(Boolean), notes, imageName } : slide), confirmUpdate: true } })}>保存本页</Button></div></details>;
}
export function PptVersions({ work, blocked, onCommand }: Props) {
    return <details className="card pad"><summary>版本与修订 · 当前 r{work.revision ?? 1}</summary><p className="hint">保留最近30次内容修订；恢复会创建新修订，不改变当前附件。</p>{work.versions?.length ? work.versions.map((version) => <div className="row wrap" key={version.revision}><span className="grow">r{version.revision} · {version.title} · {version.savedAt}</span><details><summary>查看内容</summary><pre style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(version, null, 2)}</pre></details><Button disabled={blocked} onClick={() => onCommand({ kind: 'restore', workId: work.id, body: { requestKey: createRequestKey(), confirm: true, expectedRevision: work.revision ?? 1, revision: version.revision } })}>恢复此内容版本</Button></div>) : <p>还没有历史修订</p>}</details>;
}
