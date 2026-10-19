import { useQuery } from '@tanstack/react-query';
import { ROUTES, type RequirementSourceResponse } from '@agent-workflow/shared';
import { apiGet, ApiClientError } from '../../api/client.ts';
import { Badge } from '../../components/Badge.tsx';
import { Icon } from '../../components/Icon.tsx';
import { ServiceNotice } from '../../components/ServiceNotice.tsx';
import type { RequirementLink } from './NodeSubviews.tsx';

export function CitationSourceView({ taskId, nodeId, link }: { readonly taskId: string; readonly nodeId: string; readonly link: RequirementLink }) {
  const ref = link.sourceRef;
  const query = useQuery({
    queryKey: ['node-source', taskId, nodeId, link.entryId, ref?.planRevisionId, ref?.requirementRevision, ref?.sha256], enabled: ref !== undefined, retry: false,
    queryFn: async () => {
      const result = (await apiGet<RequirementSourceResponse>(`${ROUTES.nodeSource(taskId, nodeId, ref!.planRevisionId, link.entryId)}?revision=${ref!.requirementRevision}&sha256=${ref!.sha256}`)).data;
      if (result.taskId !== taskId || result.nodeId !== nodeId || result.entryId !== link.entryId || result.planRevisionId !== ref!.planRevisionId || result.requirementRevision !== ref!.requirementRevision || result.sha256 !== ref!.sha256) throw new ApiClientError({ kind: 'protocol', message: '引用来源身份或版本不一致' });
      return result;
    },
  });
  const source = query.error || query.isFetching ? undefined : query.data;
  const located = source?.start !== undefined && source.end !== undefined && source.start >= 0 && source.end > source.start && source.end <= source.content.length;
  return <div className="node-subview">
    <div className="row wrap"><Badge icon="link">引用原文</Badge><b>{link.label}</b><span className="hint">{link.entryId}</span></div>
    {ref ? <p className="hint">计划 {ref.planRevisionId} · 需求修订 {ref.requirementRevision}</p> : <p><Icon name="info" />{link.unavailableReason ?? '这条记录没有保留精确来源版本。'}</p>}
    {query.isFetching ? <p role="status">正在读取对应版本原文…</p> : query.error ? <ServiceNotice error={query.error} onRetry={() => { void query.refetch(); }} /> : source ? <>
      <p className="hint">{source.scope === 'full' ? '完整需求原文，已定位所引用条目' : '已保留的条目节选；未保存全文定位'}</p>
      <div className="node-reader-para" style={{ whiteSpace: 'pre-wrap' }}>{located ? <>{source.content.slice(0, source.start)}<mark className="node-cite-hit">{source.content.slice(source.start, source.end)}</mark>{source.content.slice(source.end)}</> : source.content}</div>
      {located ? <p className="hint">字符 {source.start}–{source.end}；定位属于此需求版本。</p> : null}
    </> : null}
  </div>;
}
