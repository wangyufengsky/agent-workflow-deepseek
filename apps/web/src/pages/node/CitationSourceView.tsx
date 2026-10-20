import { useQuery } from '@tanstack/react-query';
import { ROUTES, type RequirementSourceResponse } from '@agent-workflow/shared';
import { apiGet, ApiClientError } from '../../api/client.ts';
import { Badge } from '../../components/Badge.tsx';
import { Button } from '../../components/Button.tsx';
import { Icon } from '../../components/Icon.tsx';
import { ServiceNotice } from '../../components/ServiceNotice.tsx';
import type { RequirementLink } from './NodeSubviews.tsx';
import { citationVisual, type NodeCitation } from './node-citations.ts';

function CitationBreadcrumb({ nodeTitle, attemptLabel, name }: { readonly nodeTitle: string; readonly attemptLabel: string; readonly name: string }) {
  return (
    <div className="node-rd-crumbs" aria-label="引用位置">
      <span>{nodeTitle}</span>
      <Icon name="chevRight" size="sm" />
      <span>{attemptLabel}</span>
      <Icon name="chevRight" size="sm" />
      <span className="cur">{name}</span>
    </div>
  );
}

/**
 * Requirement-source citation (the only citation family the service exposes
 * today). Locator wording follows `API-REQUIREMENTS.md`: a full-source hit may
 * claim a version binding, an excerpt must say it is not the full original, and
 * a missing offset is called out instead of drawing a fake line number.
 */
export function CitationSourceView({ taskId, nodeId, link, attemptLabel, onBack }: { readonly taskId: string; readonly nodeId: string; readonly link: RequirementLink; readonly attemptLabel?: string; readonly onBack?: () => void }) {
  const ref = link.sourceRef;
  const query = useQuery({
    queryKey: ['node-source', taskId, nodeId, link.entryId, ref?.planRevisionId, ref?.requirementRevision, ref?.sha256],
    enabled: ref !== undefined,
    retry: false,
    queryFn: async () => {
      const result = (await apiGet<RequirementSourceResponse>(`${ROUTES.nodeSource(taskId, nodeId, ref!.planRevisionId, link.entryId)}?revision=${ref!.requirementRevision}&sha256=${ref!.sha256}`)).data;
      if (result.taskId !== taskId || result.nodeId !== nodeId || result.entryId !== link.entryId || result.planRevisionId !== ref!.planRevisionId || result.requirementRevision !== ref!.requirementRevision || result.sha256 !== ref!.sha256) throw new ApiClientError({ kind: 'protocol', message: '引用来源身份或版本不一致' });
      return result;
    },
  });
  const source = query.error || query.isFetching ? undefined : query.data;
  const located = source?.start !== undefined && source.end !== undefined && source.start >= 0 && source.end > source.start && source.end <= source.content.length;
  const locator = source === undefined
    ? undefined
    : source.scope === 'full'
      ? { text: `引用定位：完整原文 · 来源版本 r${String(source.requirementRevision)}`, tone: 'accent' as const, icon: 'target' as const }
      : located
        ? { text: `仅提供节选（字符 ${String(source.start)}–${String(source.end)}），不是完整原文`, tone: 'unknown' as const, icon: 'info' as const }
        : { text: '仅提供节选，服务未保留定位范围', tone: 'unknown' as const, icon: 'help' as const };
  return (
    <div className="node-cite-view">
      <CitationBreadcrumb nodeTitle={link.label} attemptLabel={attemptLabel ?? '当前尝试'} name="引用原文" />
      <div className="row wrap" style={{ gap: 8 }}>
        <Badge icon="link" tone="accent">
          引用原文
        </Badge>
        <b className="grow">{link.label}</b>
        {onBack === undefined ? null : (
          <Button size="sm" variant="ghost" icon="chevLeft" onClick={onBack}>
            返回节点
          </Button>
        )}
      </div>
      {ref === undefined ? (
        <p className="hint">
          <Icon name="info" size="sm" /> {link.unavailableReason ?? '这条记录没有保留精确来源版本；不显示推测的定位。'}
        </p>
      ) : (
        <p className="hint">
          计划修订 {ref.planRevisionId} · 需求修订 r{String(ref.requirementRevision)} · sha256 {ref.sha256.slice(0, 12)}…
        </p>
      )}
      {query.isFetching ? (
        <p role="status">
          <span className="spin" aria-hidden="true" /> 正在读取对应版本原文…
        </p>
      ) : query.error ? (
        <ServiceNotice error={query.error} onRetry={() => { void query.refetch(); }} />
      ) : source ? (
        <>
          {locator === undefined ? null : (
            <Badge tone={locator.tone} icon={locator.icon}>
              {locator.text}
            </Badge>
          )}
          <div className="node-reader-para" style={{ whiteSpace: 'pre-wrap' }}>
            {located ? (
              <>
                {source.content.slice(0, source.start)}
                <mark className="node-cite-hit">{source.content.slice(source.start, source.end)}</mark>
                {source.content.slice(source.end)}
              </>
            ) : (
              source.content
            )}
          </div>
          {source.scope === 'full' ? <p className="hint">这是引用时冻结的版本；定位属于该需求修订。</p> : <p className="hint">服务只返回了这一段节选；节选之外不显示推测内容。</p>}
        </>
      ) : null}
    </div>
  );
}

/**
 * Structured citation reader (design N16: source paragraph / exact code lines /
 * excerpt / summary). Rendered only when the record actually carries structured
 * citations; a `[1]` in prose alone never fabricates a source.
 */
export function CitationDetailView({ citation, attemptLabel, onBack }: { readonly citation: NodeCitation; readonly attemptLabel: string; readonly onBack?: () => void }) {
  const visual = citationVisual(citation);
  const lines = citation.lines;
  const code = citation.quote ?? citation.content;
  return (
    <div className="node-cite-view">
      <CitationBreadcrumb nodeTitle={citation.path ?? citation.label} attemptLabel={attemptLabel} name={`引用 ${String(citation.index)}`} />
      <div className="row wrap" style={{ gap: 8 }}>
        <Badge tone={visual.tone} icon={visual.icon}>
          {visual.locator}
        </Badge>
        <b className="grow">{citation.label}</b>
        {onBack === undefined ? null : (
          <Button size="sm" variant="ghost" icon="chevLeft" onClick={onBack}>
            返回节点
          </Button>
        )}
      </div>
      <p className="hint">
        {citation.path === undefined ? '来源路径未提供' : `路径 ${citation.path}`}
        {citation.revision === undefined ? '' : ` · 来源版本 ${citation.revision}`}
        {citation.latestRevision === undefined || citation.latestRevision === citation.revision ? '' : ` · 此文件已有更新版本 ${citation.latestRevision}`}
      </p>
      {citation.kind === 'summary' ? (
        <div className="node-box-dashed">
          <p>{citation.quote ?? citation.content ?? '服务只提供了摘要，没有原文与行号；这里不伪造定位。'}</p>
        </div>
      ) : citation.kind === 'excerpt' ? (
        <>
          <div className="banner unknown">
            <Icon name="info" />
            <div className="grow">
              <b>仅提供节选，不是完整原文</b>
              <br />
              服务只返回了这一段；节选之外不显示行号，也不推测其他内容。
            </div>
          </div>
          <pre className="node-cite-lines">
            {(code ?? '').split('\n').map((line, index) => (
              <div key={index}>
                <b>{lines === undefined ? '' : String(lines.from + index)}</b>
                <span>{line}</span>
              </div>
            ))}
          </pre>
        </>
      ) : citation.kind === 'code' ? (
        <pre className="node-cite-lines">
          {(code ?? '').split('\n').map((line, index) => (
            <div className="hl" key={index}>
              <b>{lines === undefined ? String(index + 1) : String(lines.from + index)}</b>
              <span>{line}</span>
            </div>
          ))}
        </pre>
      ) : (
        <div className="node-reader-para" style={{ whiteSpace: 'pre-wrap' }}>
          {citation.quote ?? citation.content ?? '服务未返回这段引用的原文；不显示替代内容。'}
        </div>
      )}
    </div>
  );
}
