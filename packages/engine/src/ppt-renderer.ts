import { nowIso, type PptCheckReport, type PptSlide, type PptWork } from '@agent-workflow/shared';
const PALETTES: Record<string, {
    bg: string;
    text: string;
    accent: string;
}> = {
    deepseek: { bg: '0B1220', text: 'E5E7EB', accent: '7C9CFF' }, warm: { bg: 'FFF8F0', text: '3B2F2F', accent: 'B45309' },
    spdb: { bg: 'FFFFFF', text: '1F2A44', accent: '0B5FA5' }, 'github-white': { bg: 'FFFFFF', text: '1F2328', accent: '0969DA' },
};
export function pptPalette(work: PptWork) { return work.direction === 'editorial' ? PALETTES.warm! : work.direction === 'contrast' ? { bg: '080808', text: 'FFFFFF', accent: 'BEFF50' } : PALETTES[work.theme]!; }
export function pptPages(work: PptWork): readonly PptSlide[] { return [{ title: work.title, bullets: work.topic ? [work.topic] : [] }, ...(work.slides.length > 0 ? work.slides : work.outline.map((title) => ({ title, bullets: [] })))]; }
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
    const titleLines = pptLines(page.title, cover ? 42 : 58);
    const title = titleLines.map((text, index) => ({ text, x: 0.6, y: (cover ? 2 : 0.4) + index * 0.65, size: cover ? 32 : 24, height: 0.65 }));
    let y = cover ? 3.6 : Math.max(1.45, 0.5 + titleLines.length * 0.65);
    const body = page.bullets.flatMap((bullet) => {
        const lines = pptLines(`• ${bullet}`, page.imageName ? 45 : 96).map((text) => { const item = { text, x: 0.7, y, size: 16, height: 0.42 }; y += 0.42; return item; });
        y += 0.15;
        return lines;
    });
    return { title, body, bottom: Math.max(y, ...title.map((line) => line.y + line.height)) };
}
const escapeXml = (text: string) => text.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]!);
export function renderPptPage(work: PptWork, pageIndex = 0): string {
    const page = pptPages(work)[pageIndex];
    if (page === undefined)
        throw new Error('页面不存在');
    const image = work.attachments.find((item) => item.kind === 'image' && item.name === page.imageName);
    const palette = pptPalette(work);
    const layout = pptPageLayout(page, pageIndex === 0);
    return `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720"><title>${escapeXml(page.title)}</title><rect width="1280" height="720" fill="#${palette.bg}"/>${image === undefined ? '' : `<image href="${escapeXml(image.content)}" x="672" y="154" width="528" height="461" preserveAspectRatio="none"/>`}${[...layout.title.map((line) => ({ ...line, color: palette.accent })), ...layout.body.map((line) => ({ ...line, color: palette.text }))].map((line) => `<text x="${line.x * 96}" y="${(line.y + line.height * 0.75) * 96}" font-family="Arial,sans-serif" font-size="${line.size * 1.333}" fill="#${line.color}">${escapeXml(line.text)}</text>`).join('')}<text x="1200" y="690" font-size="16" fill="#${palette.text}">${pageIndex + 1}</text></svg>`;
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
            if (layout.bottom > 7.1)
                issues.push({ code: 'TEXT_OVERFLOW', message: `文本框底边 ${layout.bottom.toFixed(2)} 英寸，超出页面安全区域 7.1 英寸` });
            if (index > 0 && page.bullets.length === 0)
                issues.push({ code: 'EMPTY_BODY', message: '这一页尚无正文要点' });
            if (index > 0 && !page.notes?.trim())
                issues.push({ code: 'MISSING_NOTES', message: '尚未填写演讲备注' });
            if (page.imageName && !work.attachments.some((item) => item.kind === 'image' && item.name === page.imageName))
                issues.push({ code: 'MISSING_IMAGE', message: '所选图片素材已移除或不可读取' });
            if (index > 0 && work.outline[index - 1] !== page.title)
                issues.push({ code: 'OUTLINE_MISMATCH', message: '页标题与已保存大纲不一致' });
            return { page: index, title: page.title, issues };
        }), unchecked: ['事实准确性与引用依据需要人工核对', '字体替换与实际投影效果需要导出后检查', ...(work.attachments.some((item) => item.kind === 'image') ? ['图片素材的授权和拉伸比例需要人工审阅'] : [])] };
}
