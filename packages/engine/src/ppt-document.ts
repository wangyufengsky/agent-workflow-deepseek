import { createHash } from 'node:crypto';
import { renderPptPage, pptPages, type PptDocumentResponse, type PptWork } from '@agent-workflow/shared';
export function pptDocument(work: PptWork, includeNotes = work.plan?.delivery.includeNotes !== false): PptDocumentResponse {
    const pages = pptPages(work);
    const esc = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));
    const html = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src 'none'"><title>${esc(work.title)}</title><style>@page{size:13.333333in 7.5in;margin:0}html,body{margin:0;padding:0}.page{width:13.333333in;height:7.5in;break-after:page;overflow:hidden}.page:last-child{break-after:auto}.page svg{width:100%;height:100%}.notes{font:16pt Arial;padding:0.5in;box-sizing:border-box;white-space:pre-wrap}</style></head><body>${pages.map((page, index) => `<section class="page">${renderPptPage(work, index)}</section>${includeNotes && page.notes ? `<section class="page notes">${esc(page.title)} · 演讲备注<br>${esc(page.notes)}</section>` : ''}`).join('')}</body></html>`;
    return { workId: work.id, revision: work.revision ?? 1, filename: `${(work.plan?.delivery.filename || work.title).replace(/[\\/:*?"<>|]/g, '_').slice(0, 60) || '演示'}.pdf`, html, sha256: createHash('sha256').update(html).digest('hex'), pages: pages.length + (includeNotes ? pages.filter(page => page.notes).length : 0) };
}
