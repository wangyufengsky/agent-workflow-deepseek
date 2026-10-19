import { createHash } from 'node:crypto';
import { basename } from 'node:path';
import { ROUTES, type ApiEnvelope, type PptDocumentResponse, type PptNativeExportRequest, type PptNativeExportResult } from '@agent-workflow/shared';
export interface PptExportHost {
    readonly baseUrl: string;
    readonly fetch: typeof fetch;
    readonly choosePath: (filename: string) => Promise<string | undefined>;
    readonly printPdf: (html: string) => Promise<Uint8Array>;
    readonly write: (path: string, bytes: Uint8Array) => Promise<void>;
    readonly read: (path: string) => Promise<Uint8Array>;
}
const hash = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
export async function exportPpt(input: PptNativeExportRequest, host: PptExportHost): Promise<PptNativeExportResult> {
    try {
        if (!input || typeof input.workId !== 'string' || input.workId.length > 200 || !Number.isInteger(input.revision) || input.revision < 1 || !['pptx', 'pdf'].includes(input.format) || input.includeNotes !== undefined && typeof input.includeNotes !== 'boolean')
            return { status: 'failed', message: '作品标识或修订无效' };
        const meta = await host.fetch(new URL(`${ROUTES.pptDocument(input.workId)}?revision=${input.revision}${input.includeNotes === undefined ? '' : `&includeNotes=${input.includeNotes}`}`, host.baseUrl), { signal: AbortSignal.timeout(15000) });
        if (!meta.ok)
            return { status: 'failed', message: '作品修订已变化或服务不可用，请重新读取' };
        const document = (await meta.json() as ApiEnvelope<PptDocumentResponse>).data;
        if (document.workId !== input.workId || document.revision !== input.revision || typeof document.html !== 'string' || document.html.length > 12000000 || hash(document.html) !== document.sha256)
            return { status: 'failed', message: '导出快照校验失败，没有保存' };
        const filename = basename(document.filename).replace(/\.pdf$/i, `.${input.format}`);
        const path = await host.choosePath(filename);
        if (!path)
            return { status: 'cancelled' };
        let bytes: Uint8Array;
        if (input.format === 'pdf')
            bytes = await host.printPdf(document.html);
        else {
            const response = await host.fetch(new URL(`${ROUTES.pptWorkPptx(input.workId)}?revision=${input.revision}${input.includeNotes === undefined ? '' : `&includeNotes=${input.includeNotes}`}`, host.baseUrl), { signal: AbortSignal.timeout(30000) });
            if (!response.ok)
                return { status: 'failed', message: 'PPTX读取失败，作品可能已有新修订' };
            bytes = new Uint8Array(await response.arrayBuffer());
            if (hash(bytes) !== response.headers.get('x-content-sha256'))
                return { status: 'failed', message: 'PPTX哈希校验失败，没有保存' };
        }
        if (bytes.length < 10 || bytes.length > 64 * 1024 * 1024 || input.format === 'pdf' && new TextDecoder().decode(bytes.slice(0, 5)) !== '%PDF-')
            return { status: 'failed', message: '导出文件内容无效，没有保存' };
        const sha256 = hash(bytes);
        await host.write(path, bytes);
        if (hash(await host.read(path)) !== sha256)
            return { status: 'failed', message: '文件已写入但保存后哈希不一致，请检查目标文件' };
        return { status: 'saved', filename: basename(path), size: bytes.length, sha256 };
    }
    catch {
        return { status: 'failed', message: '生成、下载或保存失败；没有取得已保存证据，请检查连接和目标目录' };
    }
}
