import { AppError, ErrorCode, type PptProductionPlan, type PptSlide, type PptTextStyle } from '@agent-workflow/shared';
const fail = (message: string): never => { throw new AppError(ErrorCode.VALIDATION_FAILED, message); };
function text(value: unknown, label: string, max = 4000): asserts value is string { if (typeof value !== 'string' || value.length > max)
    fail(`${label}需要是${max}字以内文本`); }
export function validatePlan(value: PptProductionPlan): PptProductionPlan {
    if (!value || typeof value !== 'object')
        fail('制作方案必须是对象');
    if (typeof value.confirmed !== 'boolean')
        fail('需要明确制作方案确认状态');
    text(value.duration, '汇报时长');
    text(value.requirements, '补充要求');
    text(value.storyline, '讲述主线');
    if (!Number.isInteger(value.pageCount) || value.pageCount < 1 || value.pageCount > 100)
        fail('预计页数需要在1–100之间');
    if (!Array.isArray(value.directions) || value.directions.length > 8)
        fail('方向最多8项');
    for (const item of value.directions) {
        if (!['restrained', 'editorial', 'contrast'].includes(item.id))
            fail('方向身份不可用');
        for (const field of ['title', 'description', 'storyline', 'chapters', 'visual'] as const)
            text(item[field], `方向${field}`);
        if (!Number.isInteger(item.suggestedPages) || item.suggestedPages < 1 || item.suggestedPages > 100)
            fail('建议页数需要在1–100之间');
    }
    if (!Array.isArray(value.chapters) || value.chapters.length > 30)
        fail('章节最多30项');
    for (const item of value.chapters) {
        text(item.name, '章节名称', 200);
        text(item.purpose, '章节目的');
        if (!Number.isInteger(item.pages) || item.pages < 1 || item.pages > 100)
            fail('章节页数需要在1–100之间');
    }
    if (!value.visual || !/^#[0-9a-fA-F]{6}$/.test(value.visual.accent))
        fail('强调色需要是6位十六进制色值');
    text(value.visual.style, '整体风格');
    text(value.visual.fontFace, '字体', 100);
    if (!['Arial', '思源黑体', '苹方', '微软雅黑'].includes(value.visual.fontFace))
        fail('字体不可用');
    if (!['sparse', 'balanced', 'detailed'].includes(value.visual.density) || value.visual.aspect !== '16:9')
        fail('文字密度或页面比例不可用');
    if (!value.assets || !value.delivery)
        fail('缺少素材要求或交付设置');
    text(value.assets.usage, '素材使用要求');
    text(value.assets.charts, '图表表达要求');
    text(value.assets.images, '配图要求');
    text(value.delivery.filename, '文件名称', 120);
    text(value.delivery.targetSoftware, '目标办公软件');
    if (typeof value.delivery.includeNotes !== 'boolean')
        fail('需要明确是否导出演讲备注');
    return structuredClone(value);
}
export function validatePptTextStyle(style: PptTextStyle | undefined) {
    if (style === undefined)
        return;
    if (!style || !Number.isFinite(style.fontSize) || style.fontSize < 8 || style.fontSize > 72 || !['primary', 'accent', 'muted'].includes(style.color) || !['left', 'center', 'right'].includes(style.align))
        fail('对象字号需在8–72之间，颜色/对齐必须为可用选项');
}
export function validateSlideExtras(page: PptSlide) {
    if (page.layout !== undefined && !['title', 'text', 'columns', 'cards', 'flow', 'image'].includes(page.layout))
        fail('页面版式不可用');
    if (page.chapter !== undefined)
        text(page.chapter, '章节', 200);
    if (page.keyMessage !== undefined)
        text(page.keyMessage, '核心观点');
    if (page.tag !== undefined)
        text(page.tag, '小标签', 200);
    if (page.sourceNames !== undefined && (!Array.isArray(page.sourceNames) || page.sourceNames.length > 10 || page.sourceNames.some((value) => typeof value !== 'string')))
        fail('页面资料引用不可用');
    validatePptTextStyle(page.titleStyle);
    validatePptTextStyle(page.bodyStyle);
    validatePptTextStyle(page.tagStyle);
}
