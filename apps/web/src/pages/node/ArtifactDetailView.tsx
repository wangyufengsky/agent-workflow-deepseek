import { ReadableText } from './ReadableText.tsx';
import { useState } from 'react';
import { Button } from '../../components/Button.tsx';
import { useInfiniteQuery } from '@tanstack/react-query';
import { ROUTES, type ArtifactRef, type ArtifactContentResponse } from '@agent-workflow/shared';
import { apiGet, ApiClientError } from '../../api/client.ts';
import { Badge } from '../../components/Badge.tsx';
import { Icon } from '../../components/Icon.tsx';
import { ServiceNotice } from '../../components/ServiceNotice.tsx';

export function ArtifactDetailView({ taskId, artifact, attemptLabel }: { readonly taskId: string; readonly artifact: ArtifactRef; readonly attemptLabel: string }) {
  const [download, setDownload] = useState<'idle' | 'saving' | 'saved' | 'cancelled' | 'failed'>('idle');
  const [message, setMessage] = useState('');
  const save = async () => {
    if (!window.workflowDesktop?.exportArtifact || !artifact.sourceAttemptId) return;
    setDownload('saving'); setMessage('');
    try {
      const result = await window.workflowDesktop.exportArtifact({ taskId, attemptId: artifact.sourceAttemptId, artifactId: artifact.id, revision: artifact.revision, sha256: artifact.sha256 });
      setDownload(result.status === 'unsupported' ? 'failed' : result.status);
      setMessage(result.status === 'failed' ? result.message : result.status === 'saved' ? '产物已保存' : result.status === 'cancelled' ? '已取消保存' : '当前宿主不支持保存');
    } catch { setDownload('failed'); setMessage('保存失败，请重试。'); }
  };
  const url = `${ROUTES.taskArtifact(taskId, artifact.sourceAttemptId ?? '', artifact.id)}?revision=${encodeURIComponent(artifact.revision)}&sha256=${encodeURIComponent(artifact.sha256)}`;
  const query = useInfiniteQuery({ queryKey: ['artifact', taskId, artifact.sourceAttemptId, artifact.id, artifact.revision, artifact.sha256], initialPageParam: undefined as string | undefined, queryFn: async ({ pageParam }) => { const response = (await apiGet<ArtifactContentResponse>(`${url}${pageParam === undefined ? '' : `&cursor=${encodeURIComponent(pageParam)}`}`)).data; if (response.artifact.id !== artifact.id || response.artifact.revision !== artifact.revision || response.artifact.sha256 !== artifact.sha256 || response.artifact.sourceAttemptId !== artifact.sourceAttemptId) throw new ApiClientError({ kind: 'protocol', message: '产物身份或版本不一致，请重新读取' }); return response; }, getNextPageParam: (page) => page.nextCursor, enabled: artifact.sourceAttemptId !== undefined, retry: false });
  // Refetch failures and changed versions must suppress the previous successful body.
  const data = (query.isFetching && !query.isFetchingNextPage) || query.error ? undefined : query.data?.pages[0];
  const valid = data?.artifact.id === artifact.id && data?.artifact.revision === artifact.revision && data?.artifact.sha256 === artifact.sha256 && data?.artifact.sourceAttemptId === artifact.sourceAttemptId;
  return <div className="node-subview">
    <div className="row wrap"><Icon name="file" /><b className="grow">{artifact.name}</b><Badge outline>{artifact.mediaType}</Badge></div>
    <dl className="kv-list"><dt>大小</dt><dd>{artifact.sizeBytes === undefined ? '未知' : `${artifact.sizeBytes.toLocaleString()} 字节`}</dd><dt>版本</dt><dd>{artifact.revision}</dd><dt>SHA-256</dt><dd className="mono-wrap" style={{ overflowWrap: 'anywhere' }}>{artifact.sha256}</dd><dt>来源尝试</dt><dd>{attemptLabel} · {artifact.sourceAttemptId ?? '历史记录没有来源尝试'}</dd></dl>
    {query.isPending && query.fetchStatus !== 'idle' ? <p role="status"><Icon name="refresh" /> 正在核对产物并读取…</p> : query.error ? <ServiceNotice error={query.error} onRetry={() => { void query.refetch(); }} /> : artifact.sourceAttemptId === undefined ? <p role="status"><Icon name="alert" />缺少来源尝试，无法读取这个历史产物。</p> : data && !valid ? <p role="alert"><Icon name="alert" />产物身份或版本不一致，请重新打开。</p> : valid ? <>
      {data.preview === null ? <p><Icon name="info" />此文件格式请下载后查看。</p> : <ReadableText text={query.data!.pages.map((page) => page.preview ?? '').join('')} mediaType={artifact.mediaType} />}
      {query.hasNextPage ? <Button disabled={query.isFetchingNextPage} disabledReason="正在读取产物下一段" onClick={() => { void query.fetchNextPage(); }}>{query.isFetchingNextPage ? '读取中…' : '继续读取'}</Button> : null}
      {window.workflowDesktop?.exportArtifact ? <Button icon="download" disabled={download === 'saving'} disabledReason={download === 'saving' ? '正在保存产物' : undefined} onClick={() => { void save(); }}>{download === 'saving' ? '下载中…' : download === 'failed' ? '重试下载' : download === 'saved' ? '再次下载' : '下载产物'}</Button> : <a className="btn secondary" href={`${url}&download=1`} download={artifact.name}><Icon name="download" />通过浏览器下载</a>}
      {message ? <p role="status"><Icon name={download === 'saved' ? 'check' : download === 'failed' ? 'alert' : 'info'} />{message}</p> : null}
    </> : null}
  </div>;
}
