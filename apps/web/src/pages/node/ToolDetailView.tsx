import { useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { ROUTES, type OutputFragment, type ToolCallReadResponse } from '@agent-workflow/shared';
import { ApiClientError, apiGet } from '../../api/client.ts';
import { Badge } from '../../components/Badge.tsx';
import { Button } from '../../components/Button.tsx';
import { Icon } from '../../components/Icon.tsx';
import { ServiceNotice } from '../../components/ServiceNotice.tsx';
import { ReadableText } from './ReadableText.tsx';
import { formatAbsoluteTime } from '../../app/format.ts';

export function ToolDetailView({ taskId, nodeId, attemptId, fragment, attemptLabel }: { readonly taskId: string; readonly nodeId: string; readonly attemptId: string; readonly fragment: OutputFragment; readonly attemptLabel: string }) {
  const [part, setPart] = useState<'input' | 'output' | 'error'>('output');
  const callId = fragment.toolCallRef?.callId ?? '';
  const query = useInfiniteQuery({
    queryKey: ['node-tool', taskId, nodeId, attemptId, callId, part], initialPageParam: undefined as string | undefined, enabled: !!attemptId && !!callId, retry: false,
    queryFn: async ({ pageParam }) => {
      const response = (await apiGet<ToolCallReadResponse>(`${ROUTES.nodeTool(taskId, nodeId, attemptId, callId)}?part=${part}${pageParam === undefined ? '' : `&cursor=${encodeURIComponent(pageParam)}`}`)).data;
      if (response.taskId !== taskId || response.nodeId !== nodeId || response.attemptId !== attemptId || response.callId !== callId || response.part !== part) throw new ApiClientError({ kind: 'protocol', message: '调用记录身份不一致，请重新读取' });
      return response;
    },
    getNextPageParam: (page) => page.nextCursor,
  });
  const revoked = query.error instanceof ApiClientError && query.error.code === 'FORBIDDEN';
  const stale = query.error instanceof ApiClientError && query.error.code === 'STALE_TARGET';
  const data = query.error || (query.isFetching && !query.isFetchingNextPage) ? undefined : query.data?.pages[0];
  const content = data === undefined ? undefined : query.data!.pages.map((page) => page.content ?? '').join('');
  const status = data?.status ?? fragment.toolCallRef?.status ?? 'unknown';
  const evidence = data?.evidence;
  return <div className="node-subview">
    <div className="row wrap"><Badge icon={status === 'completed' ? 'check' : status === 'failed' ? 'alert' : 'clock'} tone={status === 'failed' ? 'fail' : status === 'completed' ? 'done' : 'run'}>{status === 'completed' ? '已完成' : status === 'failed' ? '调用失败' : status === 'running' ? '运行中' : '状态未知'}</Badge><b>{evidence?.name ?? fragment.toolEvidence?.name ?? '工具调用'}</b><span className="hint">{attemptLabel}</span></div>
    <p className="hint mono">{callId || '调用ID未记录'}</p>
    {evidence ? <p className="hint">{evidence.startedAt === undefined ? '开始时间未记录' : formatAbsoluteTime(evidence.startedAt)} · {evidence.durationMs === undefined ? '时长未记录' : `${evidence.durationMs} ms`}</p> : null}
    <div role="tablist" aria-label="工具调用内容" className="row wrap">{([['input', '调用参数'], ['output', '返回结果'], ['error', '错误信息']] as const).map(([value, label]) => <Button key={value} role="tab" aria-selected={part === value} variant={part === value ? 'primary' : 'secondary'} onClick={() => setPart(value)}>{label}</Button>)}</div>
    {query.isPending && query.fetchStatus !== 'idle' ? <p role="status">正在读取调用内容…</p> : null}
    {query.error ? <ServiceNotice error={query.error} onRetry={() => { void (query.isFetchNextPageError && !stale ? query.fetchNextPage() : query.refetch()); }} /> : null}
    {revoked ? <p><Icon name="lock" />你没有查看此调用完整参数的权限。</p> : data && data.content === null ? <p className="hint">这条记录没有保存{part === 'input' ? '调用参数' : part === 'error' ? '错误信息' : '返回内容'}。</p> : content !== undefined ? <ReadableText key={`${callId}:${part}`} text={content} /> : null}
    {evidence?.redacted ? <p><Icon name="shield" />敏感字段已隐藏。</p> : null}
    {evidence?.truncated ? <p><Icon name="alert" />内容已截断：服务只保留了限定长度的内容。</p> : null}
    {data && query.hasNextPage ? <Button disabled={query.isFetchingNextPage} disabledReason="正在读取下一段" onClick={() => { void query.fetchNextPage(); }}>{query.isFetchingNextPage ? '读取中…' : '继续读取'}</Button> : null}
    {status === 'failed' ? <p><Icon name="alert" />这次工具调用失败。已记录内容可继续阅读。</p> : null}
  </div>;
}
