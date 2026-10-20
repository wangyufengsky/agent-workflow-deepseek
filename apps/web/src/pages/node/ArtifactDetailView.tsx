import { useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { ROUTES, type ArtifactContentResponse, type ArtifactRef } from '@agent-workflow/shared';
import { apiGet, ApiClientError } from '../../api/client.ts';
import { Badge } from '../../components/Badge.tsx';
import { Button } from '../../components/Button.tsx';
import { Icon } from '../../components/Icon.tsx';
import { ReadableText } from './ReadableText.tsx';

function formatBytes(bytes: number | undefined): string {
  if (bytes === undefined) return '未提供';
  if (bytes < 1024) return `${String(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Artifact reader (design §20 / N15): metadata layer stays visible in every
 * state; the body distinguishes not-found / superseded version / forbidden /
 * unsupported format / read failure. Download is the product's real capability —
 * a failed save never changes the execution state.
 */
export function ArtifactDetailView({ taskId, artifact, attemptLabel }: { readonly taskId: string; readonly artifact: ArtifactRef; readonly attemptLabel: string }) {
  const [download, setDownload] = useState<'idle' | 'saving' | 'saved' | 'cancelled' | 'failed'>('idle');
  const [message, setMessage] = useState('');
  const save = async () => {
    if (!window.workflowDesktop?.exportArtifact || !artifact.sourceAttemptId) return;
    setDownload('saving');
    setMessage('');
    try {
      const result = await window.workflowDesktop.exportArtifact({ taskId, attemptId: artifact.sourceAttemptId, artifactId: artifact.id, revision: artifact.revision, sha256: artifact.sha256 });
      setDownload(result.status === 'unsupported' ? 'failed' : result.status);
      setMessage(result.status === 'failed' ? result.message : result.status === 'saved' ? '产物已保存' : result.status === 'cancelled' ? '已取消保存' : '当前宿主不支持保存');
    } catch {
      setDownload('failed');
      setMessage('保存失败，请重试。');
    }
  };
  const url = `${ROUTES.taskArtifact(taskId, artifact.sourceAttemptId ?? '', artifact.id)}?revision=${encodeURIComponent(artifact.revision)}&sha256=${encodeURIComponent(artifact.sha256)}`;
  const query = useInfiniteQuery({
    queryKey: ['artifact', taskId, artifact.sourceAttemptId, artifact.id, artifact.revision, artifact.sha256],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) => {
      const response = (await apiGet<ArtifactContentResponse>(`${url}${pageParam === undefined ? '' : `&cursor=${encodeURIComponent(pageParam)}`}`)).data;
      if (response.artifact.id !== artifact.id || response.artifact.revision !== artifact.revision || response.artifact.sha256 !== artifact.sha256 || response.artifact.sourceAttemptId !== artifact.sourceAttemptId) throw new ApiClientError({ kind: 'protocol', message: '产物身份或版本不一致，请重新读取' });
      return response;
    },
    getNextPageParam: (page) => page.nextCursor,
    enabled: artifact.sourceAttemptId !== undefined,
    retry: false,
  });
  const code = query.error instanceof ApiClientError ? query.error.code : null;
  const forbidden = code === 'FORBIDDEN';
  const notFound = code === 'NOT_FOUND';
  const superseded = code === 'STALE_TARGET' || code === 'VERSION_SUPERSEDED';
  const data = (query.isFetching && !query.isFetchingNextPage) || query.error ? undefined : query.data?.pages[0];
  const valid = data?.artifact.id === artifact.id && data?.artifact.revision === artifact.revision && data?.artifact.sha256 === artifact.sha256 && data?.artifact.sourceAttemptId === artifact.sourceAttemptId;
  const pages = query.data?.pages ?? [];
  const loaded = pages.map((page) => page.preview ?? '').join('');
  const keptOnError = query.error !== null && query.error !== undefined && pages.length > 0;
  const downloadAvailable = window.workflowDesktop?.exportArtifact !== undefined && !forbidden && !notFound && !superseded;
  const downloadMessage = download === 'saved' ? '已保存（未改变执行状态）' : download === 'cancelled' ? '已取消保存' : download === 'failed' ? '下载失败不改变执行状态；阅读不受影响' : message;
  return (
    <div className="node-artifact-view">
      <div className="row wrap" style={{ gap: 8 }}>
        <Icon name="file" />
        <b className="grow node-td-name">{artifact.name}</b>
        <Badge outline>{artifact.mediaType}</Badge>
        <Badge tone={forbidden ? 'unknown' : notFound || superseded ? 'unknown' : 'idle'} icon={forbidden ? 'lock' : notFound || superseded ? 'help' : 'file'}>
          {forbidden ? '无权读取' : notFound ? '不存在' : superseded ? '版本已失效' : '可阅读'}
        </Badge>
      </div>
      <div className="node-rd-meta">
        <span>
          版本 <code>{artifact.revision}</code>
        </span>
        <span>
          sha256 <code title={artifact.sha256}>{artifact.sha256.slice(0, 12)}…</code>
        </span>
        <span>大小 {formatBytes(artifact.sizeBytes)}</span>
        <span>mime {artifact.mediaType}</span>
        <span>来源 {attemptLabel}</span>
      </div>
      {query.isPending && query.fetchStatus !== 'idle' ? (
        <p role="status">
          <span className="spin" aria-hidden="true" /> 正在核对产物并读取…
        </p>
      ) : forbidden ? (
        <div className="node-lock">
          <span className="tile">
            <Icon name="lock" size="lg" />
          </span>
          <h3>你没有读取此产物的权限</h3>
          <p>只显示名称、版本与来源。正文、复制与下载都不可用。</p>
        </div>
      ) : notFound ? (
        <div className="node-lock">
          <span className="tile">
            <Icon name="alert" size="lg" />
          </span>
          <h3>服务找不到这个产物</h3>
          <p>
            {artifact.name} @ {artifact.revision} 被当前记录引用，但服务里不存在：可能还没有生成，或已被清理。不会用其他版本或最新文件代替。
          </p>
        </div>
      ) : superseded ? (
        <div className="node-lock unk">
          <span className="tile">
            <Icon name="help" size="lg" />
          </span>
          <h3>
            {artifact.revision} 已被替代，内容不再提供
          </h3>
          <p>服务只保留了版本号与 sha256；不会用后续尝试的版本代替。打开当前尝试的产物列表重新选择。</p>
        </div>
      ) : query.error !== null && query.error !== undefined && !keptOnError ? (
        <div className="banner danger" role="alert">
          <Icon name="alert" />
          <div className="grow">
            <b>读取失败</b>
            <br />没有拿到 {artifact.name} 的正文。这不会改变执行状态。
          </div>
          <div className="actions">
            <Button size="sm" variant="secondary" icon="refresh" onClick={() => { void query.refetch(); }}>
              重新读取
            </Button>
          </div>
        </div>
      ) : artifact.sourceAttemptId === undefined ? (
        <p role="status">
          <Icon name="alert" size="sm" /> 缺少来源尝试，无法读取这个历史产物。
        </p>
      ) : data !== undefined && !valid ? (
        <p role="alert">
          <Icon name="alert" size="sm" /> 产物身份或版本不一致，请重新打开。
        </p>
      ) : data !== undefined ? (
        <>
          {keptOnError ? (
            <div className="banner danger" role="alert">
              <Icon name="alert" />
              <div className="grow">
                <b>读取失败</b>
                <br />
                继续读取时出错；下面保留已加载的内容。
              </div>
              <div className="actions">
                <Button size="sm" variant="secondary" icon="refresh" onClick={() => { void query.fetchNextPage(); }}>
                  重新读取
                </Button>
              </div>
            </div>
          ) : null}
          {data.preview === null ? (
            <div className="node-lock">
              <span className="tile">
                <Icon name="file" size="lg" />
              </span>
              <h3>
                这种格式（{artifact.mediaType} · {formatBytes(artifact.sizeBytes)}）不能在这里预览
              </h3>
              <p>阅读器只支持 Markdown、纯文本、JSON 与代码。下载仍可用：下载失败不会改变执行状态。</p>
            </div>
          ) : keptOnError ? (
            <ReadableText text={loaded} mediaType={artifact.mediaType} />
          ) : (
            <ReadableText
              text={loaded}
              mediaType={artifact.mediaType}
              header={<span className="node-fmt-chip">{artifact.mediaType === 'text/markdown' ? 'Markdown' : artifact.mediaType === 'application/json' ? 'JSON' : '文本'}</span>}
              footer={
                <span className="grow">
                  已加载 {String(loaded.split('\n').length)} 行{query.hasNextPage ? ' · 服务还有更多可继续读取' : ' · 已加载全部返回内容'}
                  {data.truncated ? ' · 服务保留了受限长度的内容' : ''}
                </span>
              }
            />
          )}
          {query.hasNextPage && !keptOnError ? (
            <Button disabled={query.isFetchingNextPage} disabledReason="正在读取产物下一段" onClick={() => { void query.fetchNextPage(); }}>
              {query.isFetchingNextPage ? '读取中…' : '继续读取'}
            </Button>
          ) : null}
        </>
      ) : null}
      <div className="row wrap" style={{ gap: 8 }}>
        {downloadAvailable ? (
          <Button icon="download" disabled={download === 'saving'} disabledReason={download === 'saving' ? '正在保存产物' : undefined} onClick={() => { void save(); }}>
            {download === 'saving' ? '下载中…' : download === 'failed' ? '下载失败 · 重试' : download === 'saved' ? '再次下载' : '下载产物'}
          </Button>
        ) : window.workflowDesktop?.exportArtifact === undefined ? (
          <a className="btn secondary" href={`${url}&download=1`} download={artifact.name}>
            <Icon name="download" />通过浏览器下载
          </a>
        ) : (
          <Button icon="download" disabled disabledReason={forbidden ? '无权读取，也不能下载' : notFound ? '产物不存在，无法下载' : '版本已失效，不能下载'}>
            下载
          </Button>
        )}
        {downloadMessage === '' ? null : (
          <span className={download === 'failed' ? 'node-dl-msg bad' : download === 'saved' ? 'node-dl-msg ok' : 'node-dl-msg'} role="status">
            {download === 'saved' ? <Icon name="check" size="sm" /> : null}
            {downloadMessage}
          </span>
        )}
      </div>
      {artifact.path === undefined ? null : <p className="hint mono node-path">path {artifact.path}</p>}
    </div>
  );
}
