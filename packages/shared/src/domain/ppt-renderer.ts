import { nowIso } from '../ids.ts';
import type { PptCheckReport, PptSlide, PptWork } from './models.ts';
const PALETTES: Record<string, {
    bg: string;
    text: string;
    accent: string;
}> = {
    deepseek: { bg: '0B1220', text: 'E5E7EB', accent: '7C9CFF' }, warm: { bg: 'FFF8F0', text: '3B2F2F', accent: 'B45309' },
    spdb: { bg: 'FFFFFF', text: '1F2A44', accent: '0B5FA5' }, 'github-white': { bg: 'FFFFFF', text: '1F2328', accent: '0969DA' },
};
export function pptPalette(work: PptWork) {
    const palette = work.direction === 'editorial' ? PALETTES.warm! : work.direction === 'contrast' ? { bg: '080808', text: 'FFFFFF', accent: 'BEFF50' } : PALETTES[work.theme]!;
    return work.plan?.visual.accent ? { ...palette, accent: work.plan.visual.accent.slice(1) } : palette;
}
export function pptPages(work: PptWork): readonly PptSlide[] { return [{ ...work.cover, title: work.title, bullets: work.topic ? [work.topic] : [] }, ...(work.outline.length > work.slides.length ? work.outline.map((title,index): PptSlide => work.slides[index] ?? ({ title, bullets: [] })) : work.slides)].map((page) => ({ ...page, bodyStyle: page.bodyStyle ?? { fontSize: work.plan?.visual.density === 'sparse' ? 20 : work.plan?.visual.density === 'detailed' ? 14 : 16, color: 'primary' as const, align: 'left' as const } })); }
/** Explicit lines/boxes are shared by SVG thumbnails, checks and native PPTX text. */
export function pptLines(text: string, maxUnits: number): string[] {
    const lines: string[] = [];
    let line = '';
    let units = 0;
    for (const char of text) {
        const width = /[^\x00-\xff]/.test(char) ? 2 : 1;
        if (char === '\n' || units + width > maxUnits) {
            lines.push(line);
            line = '';
            units = 0;
        }
        if (char !== '\n') {
            line += char;
            units += width;
        }
    }
    if (line)
        lines.push(line);
    return lines;
}
export function pptPageLayout(page: PptSlide, cover: boolean) {
    cover = cover || page.layout === 'title';
    const titleSize = page.titleStyle?.fontSize ?? (cover ? 32 : 24);
    const bodySize = page.bodyStyle?.fontSize ?? 16;
    const titleLines = pptLines(page.title, Math.floor((cover ? 42 : 58) * (cover ? 32 : 24) / titleSize));
    const title = titleLines.map((text, index) => ({ text, x: 0.6, y: (cover ? 2 : 0.4) + index * titleSize / 36, size: titleSize, height: titleSize / 36, width: 12, align: page.titleStyle?.align ?? 'left', color: page.titleStyle?.color ?? 'accent' }));
    const body: typeof title = [];
    let bottom = cover ? 3.6 : Math.max(1.45, 0.5 + titleLines.length * titleSize / 36);
    const originY = bottom;
    const columns = page.layout === 'columns' ? 2 : page.layout === 'cards' ? 3 : page.layout === 'flow' ? Math.min(5, Math.max(1, page.bullets.length)) : 1;
    const colWidth = page.imageName ? 5.5 : columns === 1 ? 12 : 11.8 / columns - 0.2;
    const ys = Array(columns).fill(originY) as number[];
    page.bullets.forEach((bullet, index) => {
        const col = columns === 1 ? 0 : index % columns;
        const lines = pptLines(`• ${bullet}`, Math.max(8, Math.floor(colWidth * 8 * 16 / bodySize)));
        for (const text of lines) {
            body.push({ text, x: 0.7 + col * (11.8 / columns), y: ys[col]!, size: bodySize, height: bodySize / 38, width: colWidth, align: page.bodyStyle?.align ?? 'left', color: page.bodyStyle?.color ?? 'primary' });
            ys[col]! += bodySize / 38;
        }
        ys[col]! += 0.15;
    });
    bottom = Math.max(bottom, ...ys);
    const tag = page.tag ? [{ text: page.tag, x: 0.7, y: 6.75, size: page.tagStyle?.fontSize ?? 12, height: 0.4, width: 11.5, align: page.tagStyle?.align ?? 'left', color: page.tagStyle?.color ?? 'muted' }] : [];
    return { title, body, tag, bottom: Math.max(bottom, ...title.map((line) => line.y + line.height)) };
}
export function pptLineColor(color: string, palette: {
    text: string;
    accent: string;
}) { return color === 'accent' ? palette.accent : palette.text; }
const escapeXml = (text: string) => text.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]!);
export function renderPptPage(work: PptWork, pageIndex = 0): string {
    const page = pptPages(work)[pageIndex];
    if (page === undefined)
        throw new Error('页面不存在');
    const image = work.attachments.find((item) => item.kind === 'image' && item.name === page.imageName);
    const palette = pptPalette(work);
    const layout = pptPageLayout(page, pageIndex === 0);
    const font = escapeXml(work.plan?.visual.fontFace ?? 'Arial');
    const lines = [...layout.title, ...layout.body, ...layout.tag];
    return `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720"><title>${escapeXml(page.title)}</title><rect width="1280" height="720" fill="#${palette.bg}"/>${image === undefined ? '' : `<image href="${escapeXml(image.content)}" x="672" y="154" width="528" height="461" preserveAspectRatio="none"/>`}${lines.map((line) => `<text x="${(line.x + (line.align === 'center' ? line.width / 2 : line.align === 'right' ? line.width : 0)) * 96}" y="${(line.y + line.height * 0.75) * 96}" text-anchor="${line.align === 'center' ? 'middle' : line.align === 'right' ? 'end' : 'start'}" font-family="${font},sans-serif" font-size="${line.size * 1.333}" fill="#${pptLineColor(line.color, palette)}" opacity="${line.color === 'muted' ? 0.65 : 1}">${escapeXml(line.text)}</text>`).join('')}<text x="1200" y="690" font-size="16" fill="#${palette.text}">${pageIndex + 1}</text></svg>`;
}
export function checkPpt(work: PptWork): PptCheckReport {
    return { revision: work.revision ?? 1, checkedAt: nowIso(), pages: pptPages(work).map((page, index) => {
            const issues: {
                code: string;
                message: string;
            }[] = [];
            const layout = pptPageLayout(page, index === 0);
            if (!page.title.trim())
                issues.push({ code: 'EMPTY_TITLE', message: '页标题为空' });
            if (layout.bottom > (page.tag ? 6.65 : 7.1))
                issues.push({ code: 'TEXT_OVERFLOW', message: `文本框底边 ${layout.bottom.toFixed(2)} 英寸，超出页面安全区域 7.1 英寸` });
            if (/TODO|待补充|Lorem ipsum|占位/i.test([page.title, ...page.bullets].join(' ')))
                issues.push({ code: 'PLACEHOLDER', message: '页面仍含占位文字' });
            if ((page.titleStyle?.fontSize ?? 24) < (page.bodyStyle?.fontSize ?? 16))
                issues.push({ code: 'FONT_HIERARCHY', message: '标题字号小于正文字号' });
            if (page.sourceNames?.some((name) => !work.attachments.some((item) => item.name === name)))
                issues.push({ code: 'MISSING_SOURCE', message: '页面绑定的依据资料已移除' });
            if (index > 0 && page.bullets.length === 0)
                issues.push({ code: 'EMPTY_BODY', message: '这一页尚无正文要点' });
            if (index > 0 && !page.notes?.trim())
                issues.push({ code: 'MISSING_NOTES', message: '尚未填写演讲备注' });
            if (page.layout === 'image' && !page.imageName)
                issues.push({ code: 'EMPTY_IMAGE', message: '大图版式尚未选择图片素材' });
            if (page.imageName && !work.attachments.some((item) => item.kind === 'image' && item.name === page.imageName))
                issues.push({ code: 'MISSING_IMAGE', message: '所选图片素材已移除或不可读取' });
            if (index > 0 && work.outline[index - 1] !== page.title)
                issues.push({ code: 'OUTLINE_MISMATCH', message: '页标题与已保存大纲不一致' });
            return { page: index, title: page.title, issues };
        }), unchecked: ['事实准确性与引用依据需要人工核对', '字体替换与实际投影效果需要导出后检查', ...(work.attachments.some((item) => item.kind === 'image') ? ['图片素材的授权和拉伸比例需要人工审阅'] : [])] };
}
