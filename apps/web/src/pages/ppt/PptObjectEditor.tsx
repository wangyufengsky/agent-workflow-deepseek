import { useState, useEffect } from 'react';
import { renderPptPage, pptPageLayout, pptPages, createRequestKey, type PptWork, type PptSlide, type PptTextStyle } from '@agent-workflow/shared';
import { Button } from '../../components/Button.tsx';
import { Icon } from '../../components/Icon.tsx';
import type { PptCommand } from './ppt-shared.tsx';
type Kind = 'title' | 'body' | 'tag';
export function PptObjectEditor({ work, index, blocked, onCommand }: {
    readonly work: PptWork;
    readonly index: number;
    readonly blocked: boolean;
    readonly onCommand: (command: PptCommand) => void;
}) {
    const original: PptSlide = index < 0 ? { ...work.cover, title: work.title, bullets: work.topic ? [work.topic] : [] } : work.slides[index]!;
    const [page, setPage] = useState<PptSlide>(original);
    const [revision, setRevision] = useState(work.revision ?? 1);
    const [manual, setManual] = useState(false);
    const [selected, setSelected] = useState<Kind>();
    useEffect(() => { if (JSON.stringify(page) === JSON.stringify(original))
        setRevision(work.revision ?? 1); }, [work.revision, page, original]);
    const styleKey = selected === 'title' ? 'titleStyle' : selected === 'body' ? 'bodyStyle' : 'tagStyle';
    const style: PptTextStyle = page[styleKey] ?? { fontSize: selected === 'title' ? (index < 0 ? 32 : 24) : selected === 'body' ? (work.plan?.visual.density === 'sparse' ? 20 : work.plan?.visual.density === 'detailed' ? 14 : 16) : 12, color: selected === 'title' ? 'accent' : 'primary', align: 'left' };
    const content = selected === 'title' ? page.title : selected === 'body' ? page.bullets.join('\n') : page.tag ?? '';
    const setContent = (text: string) => setPage({ ...page, ...(selected === 'title' ? { title: text } : selected === 'body' ? { bullets: text.split('\n').filter(Boolean) } : { tag: text }) });
    const setStyle = (patch: Partial<PptTextStyle>) => setPage({ ...page, [styleKey]: { ...style, ...patch } });
    const preview = index < 0 ? { ...work, title: page.title, topic: page.bullets.join('\n'), cover: page } : { ...work, slides: work.slides.map((item, at) => at === index ? page : item) };
    const layout = pptPageLayout(pptPages(preview)[index + 1]!, index < 0);
    const uri = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(renderPptPage(preview, index + 1))}`;
    return <section className="card pad"><div className="row"><b className="grow">{index < 0 ? '封面' : `第${index + 2}页`} · 页面与对象</b><label className="row">手动编辑<input type="checkbox" role="switch" checked={manual} disabled={blocked} onChange={event => { setManual(event.target.checked); setSelected(undefined); }}/></label></div><div className="ppt-object-editor"><div className="ppt-object-preview"><img src={uri} alt={`${page.title}当前编辑预览`}/>{manual ? (['title', 'body', 'tag'] as const).map(kind => { const lines = layout[kind]; const x = lines.length ? Math.min(...lines.map(line => line.x)) : 0.7; const y = lines.length ? Math.min(...lines.map(line => line.y)) : 6.75; const bottom = lines.length ? Math.max(...lines.map(line => line.y + line.height)) : 7.1; return <button type="button" className="ppt-object-hit" data-selected={selected === kind} key={kind} aria-label={`选择${kind === 'title' ? '标题' : kind === 'body' ? '正文' : '小标签'}对象`} style={{ left: `${x / 13.333 * 100}%`, top: `${y / 7.5 * 100}%`, width: '88%', height: `${Math.max(0.35, bottom - y) / 7.5 * 100}%` }} onClick={() => setSelected(kind)}/>; }) : null}</div><aside className="ppt-object-props">{!manual ? <p className="hint">打开手动编辑后可选中标题、正文与小标签。</p> : !selected ? <p className="hint">点击页面中的文字来编辑。</p> : <><h4>对象属性 · {selected === 'title' ? '标题' : selected === 'body' ? '正文' : '小标签'}</h4><label className="field"><span className="label">文字</span><textarea className="textarea" disabled={blocked} rows={4} value={content} maxLength={selected === 'body' ? 2400 : 200} onChange={event => setContent(event.target.value)}/></label><label className="field"><span className="label">字号（8–72）</span><input className="input" disabled={blocked} type="number" min={8} max={72} value={style.fontSize} onChange={event => setStyle({ fontSize: Number(event.target.value) })}/></label><label className="field"><span className="label">颜色</span><select className="select" disabled={blocked} value={style.color} onChange={event => setStyle({ color: event.target.value as PptTextStyle['color'] })}><option value="primary">主文字</option><option value="accent">强调色</option><option value="muted">次要</option></select></label><div className="seg" role="group" aria-label="对象对齐">{(['left', 'center', 'right'] as const).map(align => <button type="button" disabled={blocked} aria-pressed={style.align === align} key={align} onClick={() => setStyle({ align })}>{{ left: '左', center: '中', right: '右' }[align]}</button>)}</div><p className="hint"><Icon name="info" size="sm"/>手动修改作为内容修订保存；重新生成前会保留当前版本。</p></>}</aside></div><Button disabled={blocked || JSON.stringify(page) === JSON.stringify(original)} onClick={() => onCommand({ kind: 'update', workId: work.id, body: { requestKey: createRequestKey(), confirmUpdate: true, expectedRevision: revision, ...(index < 0 ? { cover: page, title: page.title, topic: page.bullets.join('\n') } : { slides: work.slides.map((item, at) => at === index ? page : item) }) } })}>保存本页对象修改</Button></section>;
}
