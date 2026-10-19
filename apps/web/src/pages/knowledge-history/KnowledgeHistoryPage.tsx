import { useEffect, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import {
  ROUTES,
  type KnowledgeCitation,
  type KnowledgeHistoryEntry,
  type KnowledgeHistoryResponse,
  type ProjectSummary,
} from '@agent-workflow/shared';
import { apiGet } from '../../api/client.ts';
import { useBootstrap } from '../../api/hooks.ts';
import { formatAbsoluteTime, formatDateTime, formatRelativeTime } from '../../app/format.ts';
import { Badge } from '../../components/Badge.tsx';
import { Button, LinkButton } from '../../components/Button.tsx';
import { PageHeader } from '../../components/Card.tsx';
import { EmptyState, Skeleton } from '../../components/EmptyState.tsx';
import { Icon } from '../../components/Icon.tsx';
import { SegmentedControl, type SegmentOption } from '../../components/SegmentedControl.tsx';
import { ServiceNotice } from '../../components/ServiceNotice.tsx';
import './knowledge-history.css';

type StatusFilter = 'all' | 'needs_answer' | 'running' | 'completed';

interface ProjectHistorySlice {
  readonly project: ProjectSummary;
  readonly entries: readonly KnowledgeHistoryEntry[];
  readonly error?: unknown;
}

interface HistoryRow {
  readonly entry: KnowledgeHistoryEntry;
  readonly projectId: string;
  readonly projectName: string;
}

const DAY_GROUPS = ['今天', '昨天', '更早'] as const;
type DayGroup = (typeof DAY_GROUPS)[number];

function startOfLocalDay(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function dayGroup(iso: string): DayGroup {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '更早';
  const today = startOfLocalDay(new Date());
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (date >= today) return '今天';
  if (date >= yesterday) return '昨天';
  return '更早';
}

function formatEntryTime(iso: string, group: DayGroup): string {
  if (group === '今天' || group === '昨天') {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '—';
    return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
  }
  return formatDateTime(iso);
}

/** 摘要只截取服务返回的回答文本，不补写任何内容。 */
function answerSummary(answer: string): string {
  const compact = answer.replace(/\s+/g, ' ').trim();
  return compact.length > 140 ? `${compact.slice(0, 140)}…` : compact;
}

function highlight(text: string, term: string): ReactNode {
  if (term === '') return text;
  const index = text.toLowerCase().indexOf(term.toLowerCase());
  if (index < 0) return text;
  return (
    <>
      {text.slice(0, index)}
      <mark>{text.slice(index, index + term.length)}</mark>
      {text.slice(index + term.length)}
    </>
  );
}

function rowKey(row: HistoryRow): string {
  return `${row.projectId}:${row.entry.id}`;
}

function CitationList({ row, term }: { readonly row: HistoryRow; readonly term: string }) {
  if (row.entry.citations.length === 0) {
    return <p className="hint">模型没有给出可核对引用；这条记录不会伪造引用。</p>;
  }
  return (
    <div className="list">
      {row.entry.citations.map((citation: KnowledgeCitation) => (
        <Link
          key={`${citation.path}:${String(citation.line)}`}
          className="list-row kh-cite"
          to={`/knowledge?project=${encodeURIComponent(row.projectId)}&source=${encodeURIComponent(citation.path)}`}
          title={`打开原文 ${citation.path}:${String(citation.line)}`}
        >
          <span className="tile">
            <Icon name="doc" size="sm" />
          </span>
          <span className="grow mono kh-cite-path">
            {citation.path}:{String(citation.line)}
          </span>
          {citation.snippet === undefined ? null : <span className="hint kh-cite-snippet">{highlight(citation.snippet, term)}</span>}
          <Icon name="chevRight" size="sm" />
        </Link>
      ))}
    </div>
  );
}

function HistoryRowItem({
  row,
  expanded,
  term,
  onToggle,
}: {
  readonly row: HistoryRow;
  readonly expanded: boolean;
  readonly term: string;
  readonly onToggle: () => void;
}) {
  const cited = row.entry.citations.length > 0;
  const group = dayGroup(row.entry.generatedAt);
  const status = row.entry.runStatus ?? 'completed';
  const label = ({ researching: '研究中', answering: '生成中', stopping: '正在停止', stopped: '已停止', completed: '已完成', failed: '失败', unknown: '待核对' } as const)[status];
  return (
    <div className="kh-item" data-cited={cited} data-expanded={expanded}>
      <Link className="kh-row" to={`/knowledge?project=${encodeURIComponent(row.projectId)}&conversation=${encodeURIComponent(row.entry.conversationId)}${row.entry.requestKey === undefined ? '' : `&requestKey=${encodeURIComponent(row.entry.requestKey)}`}`}>
        <span className="kh-ico" aria-hidden="true">
          <Icon name={cited ? 'book' : 'help'} size="sm" />
        </span>
        <span className="grow kh-main">
          <span className="kh-q">{highlight(row.entry.question, term)}</span>
          <span className="kh-a">{highlight(answerSummary(row.entry.answer), term)}</span>
          <span className="kh-meta">
            <Badge tone={status === 'completed' ? 'ok' : 'idle'} icon={status === 'completed' ? 'check' : 'clock'}>
              {label}
            </Badge>
            <span>{row.projectName}</span>
            <span aria-hidden="true">·</span>
            <span className="mono">{row.entry.model === '' ? '模型未标注' : row.entry.model}</span>
            <span aria-hidden="true">·</span>
            <span>{String(row.entry.citations.length)} 处引用</span>
          </span>
        </span>
        <span className="kh-side">
          <span className="hint num" title={formatAbsoluteTime(row.entry.generatedAt)}>
            {formatEntryTime(row.entry.generatedAt, group)}
          </span>
          <span className="hint">查看对话</span>
          <Icon name={expanded ? 'chevDown' : 'chevRight'} size="sm" />
        </span>
      </Link>
      <Button variant="ghost" size="sm" onClick={onToggle}>{expanded ? '收起详情' : '展开详情'}</Button>
      {expanded ? (
        <div className="kh-detail">
          <div>
            <div className="eyebrow" style={{ marginBottom: 6 }}>
              问题
            </div>
            <p className="kh-question">{highlight(row.entry.question, term)}</p>
          </div>
          <div>
            <div className="eyebrow" style={{ marginBottom: 6 }}>
              回答
            </div>
            <p className="kh-answer">{highlight(row.entry.answer, term)}</p>
          </div>
          <div className="kh-detail-meta">
            <span>模型：<span className="mono">{row.entry.model === '' ? '服务未标注' : row.entry.model}</span></span>
            <span>生成于 {formatAbsoluteTime(row.entry.generatedAt)}（{formatRelativeTime(row.entry.generatedAt)}）</span>
            {row.entry.usage === undefined ? null : <span>{String(row.entry.usage.total)} tokens</span>}
            <span className="mono" title="服务端保存的对话标识，用于继续追问">
              对话 {row.entry.conversationId}
            </span>
          </div>
          <div>
            <div className="eyebrow" style={{ marginBottom: 6 }}>
              引用（{String(row.entry.citations.length)}）
            </div>
            <CitationList row={row} term={term} />
          </div>
          <div className="row wrap" style={{ gap: 8 }}>
            <LinkButton
              variant="secondary"
              size="sm"
              icon="arrowRight"
              to={`/knowledge?project=${encodeURIComponent(row.projectId)}&conversation=${encodeURIComponent(row.entry.conversationId)}${row.entry.requestKey === undefined ? '' : `&requestKey=${encodeURIComponent(row.entry.requestKey)}`}`}
            >
              继续追问
            </LinkButton>
            <span className="hint">回到原对话，保留已写回答与来源；未完成的操作按原请求号核对。</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function KnowledgeHistoryPage() {
  const bootstrap = useBootstrap();
  const projects = bootstrap.data?.projects ?? [];
  const [searchParams, setSearchParams] = useSearchParams();
  const [projectFilter, setProjectFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  // 支持从知识库「查看全部」带 ?project= 进来；消费后清掉参数，筛选仍由页面状态驱动。
  useEffect(() => {
    if (bootstrap.data === undefined) return;
    const param = searchParams.get('project');
    if (param === null) return;
    if (bootstrap.data.projects.some((project) => project.id === param)) setProjectFilter(param);
    const next = new URLSearchParams(searchParams);
    next.delete('project');
    setSearchParams(next, { replace: true });
  }, [bootstrap.data, searchParams, setSearchParams]);

  const projectIds = projects.map((project) => project.id).join('|');
  const historyQuery = useQuery({
    queryKey: ['knowledge', 'history', 'all', projectIds],
    queryFn: async (): Promise<readonly ProjectHistorySlice[]> => {
      return Promise.all(
        projects.map(async (project): Promise<ProjectHistorySlice> => {
          try {
            const response = await apiGet<KnowledgeHistoryResponse>(
              `${ROUTES.knowledgeHistory}?projectId=${encodeURIComponent(project.id)}`,
            );
            return { project, entries: response.data.entries };
          } catch (error) {
            return { project, entries: [], error };
          }
        }),
      );
    },
    enabled: projects.length > 0,
    retry: false,
  });

  const slices = (historyQuery.data ?? []).filter((slice) => projectFilter === '' || slice.project.id === projectFilter);
  const failedSlices = slices.filter((slice) => slice.error !== undefined);
  const rows: readonly HistoryRow[] = slices
    .flatMap((slice) =>
      slice.entries.map((entry) => ({ entry, projectId: slice.project.id, projectName: slice.project.name })),
    )
    .sort((left, right) => Date.parse(right.entry.generatedAt) - Date.parse(left.entry.generatedAt));

  const term = searchTerm.trim();
  const lowerTerm = term.toLowerCase();
  const searched = rows.filter(
    (row) =>
      lowerTerm === '' ||
      row.entry.question.toLowerCase().includes(lowerTerm) ||
      row.entry.answer.toLowerCase().includes(lowerTerm),
  );
  const runningRows = searched.filter((row) => ['researching', 'answering', 'stopping', 'unknown'].includes(row.entry.runStatus ?? 'completed'));
  const completedRows = searched.filter((row) => ['completed', 'stopped'].includes(row.entry.runStatus ?? 'completed'));
  const filtered = statusFilter === 'running' ? runningRows : statusFilter === 'completed' ? completedRows : statusFilter === 'needs_answer' ? [] : searched;
  const statusOptions: readonly SegmentOption<StatusFilter>[] = [
    { value: 'all', label: '全部', count: searched.length },
    { value: 'needs_answer', label: '需要回答', count: 0 },
    { value: 'running', label: '进行中', count: runningRows.length },
    { value: 'completed', label: '已完成', count: completedRows.length },
  ];

  const grouped = DAY_GROUPS.map((group) => ({
    group,
    rows: filtered.filter((row) => dayGroup(row.entry.generatedAt) === group),
  })).filter((bucket) => bucket.rows.length > 0);

  const projectParam = projectFilter === '' ? '' : `?project=${encodeURIComponent(projectFilter)}`;
  const loading = bootstrap.isLoading || (projects.length > 0 && historyQuery.isLoading);
  const noProjects = bootstrap.data !== undefined && projects.length === 0;
  const hasNoRecords = !loading && rows.length === 0 && failedSlices.length === 0 && !noProjects;
  const hasNoMatches = !loading && rows.length > 0 && filtered.length === 0;

  const refresh = (): void => {
    void historyQuery.refetch();
  };

  return (
    <div className="page kh-page">
      <PageHeader
        eyebrow={
          <Link to="/knowledge" className="kh-crumb">
            知识库
          </Link>
        }
        title="对话记录"
        lede="回到任何一次提问，查看当时的回答与引用；记录按项目保存在本机，最多各 30 条。"
        actions={
          <div className="row" style={{ gap: 8 }}>
            <LinkButton variant="ghost" size="sm" icon="arrowLeft" to={`/knowledge${projectParam}`}>
              返回知识库
            </LinkButton>
            <LinkButton variant="primary" size="sm" icon="plus" to={`/knowledge${projectParam}`}>
              新建对话
            </LinkButton>
          </div>
        }
      />

      {bootstrap.isError ? (
        <div style={{ marginTop: 16 }}>
          <ServiceNotice
            error={bootstrap.error}
            onRetry={() => {
              void bootstrap.refetch();
            }}
          />
        </div>
      ) : null}

      {noProjects ? (
        <section className="card pad" style={{ marginTop: 16 }}>
          <EmptyState
            icon="folder"
            title="还没有项目"
            description="对话记录按项目保存在本机。先在项目页登记一个本机项目，再去知识库提问；没有项目时这里不会显示任何记录。"
            action={
              <LinkButton variant="primary" size="sm" icon="plus" to="/projects">
                去登记项目
              </LinkButton>
            }
          />
        </section>
      ) : null}

      {projects.length > 0 ? (
        <>
          <div className="kh-tools">
            <div className="input-wrap kh-search">
              <Icon name="search" size="sm" />
              <input
                className="input ctl"
                placeholder="搜索问题或回答内容"
                aria-label="搜索对话"
                value={searchTerm}
                onChange={(event) => {
                  setSearchTerm(event.target.value);
                }}
              />
            </div>
            <select
              className="select ctl kh-project"
              aria-label="项目"
              value={projectFilter}
              onChange={(event) => {
                setProjectFilter(event.target.value);
              }}
            >
              <option value="">全部项目</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
            <SegmentedControl ariaLabel="引用状态" options={statusOptions} value={statusFilter} onChange={setStatusFilter} />
            <span className="spacer" />
            <span className="hint num">{String(filtered.length)} 条</span>
            <Button
              variant="secondary"
              size="sm"
              icon="refresh"
              disabled={historyQuery.isFetching}
              disabledReason={historyQuery.isFetching ? '正在刷新对话记录…' : undefined}
              onClick={refresh}
            >
              {historyQuery.isFetching ? '刷新中…' : '刷新'}
            </Button>
          </div>

          {failedSlices.map((slice) => (
            <div key={slice.project.id} style={{ marginBottom: 8 }}>
              <ServiceNotice error={slice.error} title={`读取「${slice.project.name}」的对话记录失败`} onRetry={refresh} compact />
            </div>
          ))}
          {failedSlices.length > 0 ? (
            <p className="hint" style={{ marginBottom: 8 }}>
              记录读取失败的项目按事实显示为空，不会用缓存或示例数据补齐。
            </p>
          ) : null}

          {loading ? (
            <div className="col" style={{ gap: 8, marginTop: 12 }} aria-busy="true">
              {[0, 1, 2].map((index) => (
                <div className="kh-item kh-skeleton" key={index}>
                  <span className="kh-ico">
                    <Skeleton width={16} height={16} />
                  </span>
                  <div className="grow col" style={{ gap: 8 }}>
                    <Skeleton height={14} width={index === 0 ? '58%' : '46%'} />
                    <Skeleton height={12} width={index === 0 ? '82%' : '64%'} />
                    <Skeleton height={11} width="36%" />
                  </div>
                </div>
              ))}
            </div>
          ) : hasNoRecords ? (
            <section className="card pad" style={{ marginTop: 16 }}>
              <EmptyState
                icon="book"
                title="还没有对话"
                description={`${projectFilter === '' ? '所有项目' : '所选项目'}里还没有已生成的问答记录。去知识库提出第一个问题后，记录会保存在这里。`}
                action={
                  <LinkButton variant="primary" size="sm" icon="arrowRight" to={`/knowledge${projectParam}`}>
                    去提问
                  </LinkButton>
                }
              />
            </section>
          ) : hasNoMatches ? (
            <section className="card pad" style={{ marginTop: 16 }}>
              <EmptyState
                icon="search"
                title="没有匹配的对话"
                description="换个关键词，或清除搜索与分段筛选；筛选只影响展示，不会改动本机记录。"
                action={
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setSearchTerm('');
                      setStatusFilter('all');
                    }}
                  >
                    清除筛选
                  </Button>
                }
              />
            </section>
          ) : (
            <div className="kh-list" aria-label="对话记录列表">
              {grouped.map((bucket) => (
                <section key={bucket.group} aria-label={bucket.group}>
                  <div className="kh-group">
                    <span>{bucket.group}</span>
                    <span className="num">{String(bucket.rows.length)}</span>
                  </div>
                  {bucket.rows.map((row) => {
                    const key = rowKey(row);
                    return (
                      <HistoryRowItem
                        key={key}
                        row={row}
                        expanded={expandedKey === key}
                        term={term}
                        onToggle={() => {
                          setExpandedKey((prev) => (prev === key ? null : key));
                        }}
                      />
                    );
                  })}
                </section>
              ))}
            </div>
          )}
        </>
      ) : null}

      <p className="hint" style={{ marginTop: 18, lineHeight: 1.7 }}>
        记录来自 <span className="mono">GET /api/knowledge/history?projectId=</span>
        （本机设置 JSON，每个项目最多 30 条，按时间倒序）。页面只读：不提供重命名、归档或删除对话记录的服务接口，因此不显示这些操作。
      </p>
    </div>
  );
}
