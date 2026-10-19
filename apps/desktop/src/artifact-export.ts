import { createHash } from 'node:crypto';
import { basename } from 'node:path';
import { ROUTES, type ArtifactExportRequest, type ArtifactExportResult, type ArtifactContentResponse, type ApiEnvelope } from '@agent-workflow/shared';

export interface ArtifactExportHost {
  readonly baseUrl: string;
  readonly fetch: typeof fetch;
  readonly choosePath: (filename: string) => Promise<string | undefined>;
  readonly write: (path: string, bytes: Uint8Array) => Promise<void>;
}

/** The renderer supplies opaque identity only. URL and destination are host-owned. */
export async function exportArtifact(input: ArtifactExportRequest, host: ArtifactExportHost): Promise<ArtifactExportResult> {
  try {
    if (!input || ![input.taskId, input.attemptId, input.artifactId, input.revision, input.sha256].every((value) => typeof value === 'string' && value.length > 0 && value.length <= 200) || !/^[a-f0-9]{64}$/.test(input.sha256)) return { status: 'failed', message: '产物标识无效，请重新打开产物。' };
    const url = new URL(`${ROUTES.taskArtifact(input.taskId, input.attemptId, input.artifactId)}?revision=${encodeURIComponent(input.revision)}&sha256=${input.sha256}`, host.baseUrl).href;
    const metadata = await host.fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!metadata.ok) return { status: 'failed', message: '无法核对这个产物，请重新读取。' };
    const info = (await metadata.json() as ApiEnvelope<ArtifactContentResponse>).data.artifact;
    if (info.id !== input.artifactId || info.revision !== input.revision || info.sha256 !== input.sha256 || info.sourceAttemptId !== input.attemptId) return { status: 'failed', message: '产物版本不一致，请重新读取。' };
    const path = await host.choosePath(basename(info.name));
    if (path === undefined) return { status: 'cancelled' };
    const response = await host.fetch(`${url}&download=1`, { signal: AbortSignal.timeout(30000) });
    if (!response.ok) return { status: 'failed', message: '下载失败，产物可能已失效。可以重新读取后重试。' };
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length > 8 * 1024 * 1024 || bytes.length !== info.sizeBytes || createHash('sha256').update(bytes).digest('hex') !== input.sha256) return { status: 'failed', message: '下载内容校验失败，没有保存文件。' };
    await host.write(path, bytes);
    return { status: 'saved' };
  } catch { return { status: 'failed', message: '下载或保存失败，请检查连接及目标目录后重试。' }; }
}
