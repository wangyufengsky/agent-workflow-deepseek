import { AppError, ErrorCode } from '@agent-workflow/shared';
import type { PublicSearchPort } from '@agent-workflow/engine';
function text(value: string): string { return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").trim(); }
export function parsePublicSearchRss(xml: string): Awaited<ReturnType<PublicSearchPort['search']>> {
  const results: { url: string; title: string; excerpt: string }[] = [];
  for (const match of xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/g)) {
    const field = (name: string) => text(match[1]!.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`))?.[1] ?? '');
    try { const url = new URL(field('link')); if (!['https:', 'http:'].includes(url.protocol) || url.username !== '' || url.password !== '') continue; const title = field('title'); const excerpt = field('description'); if (title !== '' && excerpt !== '') results.push({ url: url.href, title, excerpt }); } catch { /* malformed provider entry is never a citation */ }
  }
  return results.slice(0, 5);
}
/** Fixed HTTPS search endpoint: no caller URL, redirects, local fetch, or model tools. */
export class BingPublicSearch implements PublicSearchPort {
  async search(query: string) {
    const url = new URL('https://www.bing.com/search'); url.searchParams.set('format', 'rss'); url.searchParams.set('q', query.slice(0, 500));
    let response: Response;
    try { response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(12000), headers: { accept: 'application/rss+xml, application/xml, text/xml' } }); }
    catch { throw new AppError(ErrorCode.CAPABILITY_UNAVAILABLE, '公共检索连接失败或超时，没有采用网络内容'); }
    if (!response.ok) throw new AppError(ErrorCode.CAPABILITY_UNAVAILABLE, `公共检索服务返回 HTTP ${response.status}，没有采用网络内容`);
    if (response.body === null) throw new AppError(ErrorCode.CAPABILITY_UNAVAILABLE, '公共检索未返回正文');
    const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let bytes = 0;
    try { while (true) { const item = await reader.read(); if (item.done) break; bytes += item.value.byteLength; if (bytes > 1024 * 1024) throw new AppError(ErrorCode.TRUNCATED, '公共检索响应过大'); chunks.push(item.value); } }
    finally { await reader.cancel().catch(() => undefined); }
    const xml = Buffer.concat(chunks).toString('utf8');
    if (!/<rss\b/.test(xml)) throw new AppError(ErrorCode.CAPABILITY_UNAVAILABLE, '公共检索返回非RSS内容，没有采用网络内容');
    const results = parsePublicSearchRss(xml);
    if (results.length === 0) throw new AppError(ErrorCode.CAPABILITY_UNAVAILABLE, '公共检索没有返回可验证URL与摘要的结果');
    return results;
  }
}
