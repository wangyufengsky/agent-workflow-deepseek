import { useNodeOutput } from '../../api/workflow.ts';
import { Button } from '../../components/Button.tsx';
import { ServiceNotice } from '../../components/ServiceNotice.tsx';
import { ReadableText } from '../node/ReadableText.tsx';
import { ToolDetailView } from '../node/ToolDetailView.tsx';
import { toolFeed } from '../node/tool-feed.ts';
import { Badge } from '../../components/Badge.tsx';
import { FRAGMENT_CATEGORY_LABEL } from './run-shared.tsx';

export function AttemptOutput({ taskId, nodeId, attemptId, ordinal }: { readonly taskId: string; readonly nodeId: string; readonly attemptId: string; readonly ordinal: number }) {
  const query = useNodeOutput(taskId, nodeId, attemptId);
  const fragments = query.error ? [] : query.data?.fragments ?? [];
  return <div className="col" style={{ gap: 12 }}>
    <div className="row"><h3 className="grow">第 {ordinal} 次尝试的记录</h3><Button size="sm" onClick={() => { void query.refetch(); }}>重新读取</Button></div>
    {query.isPending ? <p role="status">正在读取记录…</p> : query.error ? <ServiceNotice error={query.error} onRetry={() => { void query.refetch(); }} /> : <>
      {fragments.length === 0 ? <p>这次尝试还没有公开记录。</p> : toolFeed(fragments).map((fragment) => <div className="run-fragment" key={fragment.fragmentId}>
        <Badge>{FRAGMENT_CATEGORY_LABEL[fragment.category]}</Badge>
        {fragment.category === 'tool_activity' && fragment.toolCallRef ? <details><summary>工具调用 · {fragment.toolCallRef.status}</summary><ToolDetailView taskId={taskId} nodeId={nodeId} attemptId={attemptId} fragment={fragment} attemptLabel={`第 ${ordinal} 次尝试`} /></details> : fragment.text ? <ReadableText text={fragment.text} mediaType={fragment.format === 'markdown' ? 'text/markdown' : 'text/plain'} /> : null}
      </div>)}
      {query.hasNextPage ? <Button disabled={query.isFetchingNextPage} disabledReason="正在读取下一段" onClick={() => { void query.fetchNextPage(); }}>{query.isFetchingNextPage ? '读取中…' : '继续读取记录'}</Button> : <p className="hint">{query.data?.terminal ? '已读到记录末尾。' : '已读到当前记录末尾；执行仍可能继续产生内容。'}</p>}
    </>}
  </div>;
}
