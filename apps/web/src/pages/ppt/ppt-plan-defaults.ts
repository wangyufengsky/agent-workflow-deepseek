import { pptPalette, type PptProductionPlan, type PptWork } from '@agent-workflow/shared';
/** Editable initial values from current work, never presented as a generated proposal. */
export function defaultPptPlan(work: PptWork): PptProductionPlan {
    return { confirmed: false, duration: work.brief?.length ?? '', pageCount: Math.max(1, work.slides.length || work.outline.length), requirements: work.brief?.style ?? '', storyline: '',
        directions: [
            { id: 'restrained', title: '深色克制', description: '深色底、少量强调色', storyline: '', chapters: '', suggestedPages: Math.max(1, work.outline.length), visual: '深色底 · 少量强调色' },
            { id: 'editorial', title: '浅色编辑', description: '浅底大字，适合投影和打印', storyline: '', chapters: '', suggestedPages: Math.max(1, work.outline.length), visual: '浅底 · 大字' },
            { id: 'contrast', title: '高对比', description: '黑底高亮，适合远距离观看', storyline: '', chapters: '', suggestedPages: Math.max(1, work.outline.length), visual: '黑底 · 高亮强调' },
        ], chapters: [], visual: { style: work.brief?.style ?? '', fontFace: 'Arial', accent: `#${pptPalette(work).accent}`, density: 'balanced', aspect: '16:9' }, assets: { usage: work.brief?.sources ?? '', charts: '', images: '' }, delivery: { filename: work.title, targetSoftware: 'Microsoft PowerPoint 2019 及以上', includeNotes: true } };
}
