import {useInfiniteQuery} from '@tanstack/react-query';
import {fetchTaskPage} from '../../api/endpoints.ts';
import { useMemo, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { TaskSummary } from '@agent-workflow/shared';
import { useProjects } from '../../api/hooks.ts';
import { Badge } from '../../components/Badge.tsx';
import { Button, LinkButton } from '../../components/Button.tsx';
import { PageHeader } from '../../components/Card.tsx';
import { EmptyState, Skeleton } from '../../components/EmptyState.tsx';
import { Icon } from '../../components/Icon.tsx';
import { IconButton } from '../../components/IconButton.tsx';
import { SegmentedControl, type SegmentOption } from '../../components/SegmentedControl.tsx';
import { ServiceNotice } from '../../components/ServiceNotice.tsx';
import { deriveTaskStatus, sortByUpdatedDesc, taskGroup, taskHref, taskNeedText, type TaskGroup } from '../../app/taskStatus.ts';
import { formatRelativeTime } from '../../app/format.ts';
import { TaskRow } from './TaskRow.tsx';

type TaskFilter = 'all' | TaskGroup;

const FILTER_LABELS: Record<TaskGroup, string> = {
  attention: '需要处理',
  active: '进行中',
  closed: '已结束',
};

function matchesSearch(task: TaskSummary, keyword: string): boolean {
  if (keyword.length === 0) return true;
  const haystack = [task.title, task.projectName, task.methodName, deriveTaskStatus(task).label, taskNeedText(task)]
    .join(' ')
    .toLowerCase();
  return haystack.includes(keyword.toLowerCase());
}

function TaskSkeletonRows() {
  return (
    <div style={{ padding: 8 }}>
      {[0, 1, 2, 3, 4].map((index) => (
        <div key={index} className="task-skeleton">
          <Skeleton width={32} height={32} radius={9} />
          <div className="col">
            <Skeleton width="45%" height={13} />
            <Skeleton width="25%" height={11} />
          </div>
          <Skeleton width={240} height={22} radius={99} />
          <Skeleton width={70} height={20} radius={99} />
        </div>
      ))}
    </div>
  );
}

function AttentionStrip({ tasks }: { readonly tasks: readonly TaskSummary[] }) {
  if (tasks.length === 0) return null;
  return (
    <div className="attn" aria-label="需要你处理">
      {tasks.map((task) => {
        const view = deriveTaskStatus(task);
        return (
          <Link key={task.id} className="card hoverable" to={taskHref(task)}>
            <span className="tile">
              <Icon name={view.icon} />
            </span>
            <span className="grow" style={{ minWidth: 0 }}>
              <span className="title-line" style={{ display: 'block' }}>
                {task.title}
              </span>
              <span className="meta-line" style={{ display: 'block' }}>
                {taskNeedText(task)} · {task.projectName}
              </span>
            </span>
            <Badge tone={view.tone} icon={view.icon}>
              {view.label}
            </Badge>
          </Link>
        );
      })}
    </div>
  );
}

function TaskListBody({ tasks }: { readonly tasks: readonly TaskSummary[] }) {
  return <>{tasks.map((task) => <TaskRow key={task.id} task={task} />)}</>;
}

export function TasksPage() {
  const [archived, setArchived] = useState(false);
  const [params, setParams] = useSearchParams();
  const project = params.get('projectId') ?? 'all';
  const setProject = (id: string) => { const next = new URLSearchParams(params); if (id === 'all') next.delete('projectId'); else next.set('projectId', id); setParams(next); };
  const projectsQuery = useProjects();
  const [filter, setFilter] = useState<TaskFilter>('all');
  const [keyword, setKeyword] = useState('');
  const [grouped, setGrouped] = useState(false);

  const listQuery={archived,...(project==='all'?{}:{projectId:project}),...(filter==='all'?{}:{group:filter}),...(keyword.trim()?{q:keyword.trim()}:{}),limit:50};
  const tasksQuery=useInfiniteQuery({queryKey:['tasks','paged',listQuery],initialPageParam:undefined as string|undefined,queryFn:({pageParam})=>fetchTaskPage({...listQuery,...(pageParam?{cursor:pageParam}:{})}),getNextPageParam:page=>page.nextCursor,retry:false});
  const tasks=useMemo(()=>[...new Map((tasksQuery.data?.pages.flatMap(page=>page.items)??[]).map(task=>[task.id,task])).values()],[tasksQuery.data]);
  const counts=tasksQuery.data?.pages[0]?.counts??{all:0,attention:0,active:0,closed:0};
  const total=tasksQuery.data?.pages[0]?.total;
  const loadMoreDisabledReason=tasksQuery.isFetching?'正在读取任务…':!tasksQuery.hasNextPage?'已加载全部符合条件的任务':undefined;

  const projects = useMemo(() => {
    const byId = new Map<string, { id: string; name: string; rootPath?: string }>((projectsQuery.data ?? []).map((item) => [item.id, { id: item.id, name: item.name, rootPath: item.rootPath }]));
    for (const task of tasks) if (!byId.has(task.projectId)) byId.set(task.projectId, { id: task.projectId, name: task.projectName });
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
  }, [tasks, projectsQuery.data]);

  const filtered=tasks;

  const groupedTasks = useMemo(() => {
    const map = new Map<string, TaskSummary[]>();
    for (const task of filtered) {
      const bucket = map.get(task.projectId);
      if (bucket === undefined) {
        map.set(task.projectId, [task]);
      } else {
        bucket.push(task);
      }
    }
    return [...map.entries()];
  }, [filtered]);

  const attentionTasks = useMemo(
    () => sortByUpdatedDesc(tasks.filter((task) => taskGroup(task) === 'attention' && deriveTaskStatus(task).tone !== 'unknown')).slice(0, 6),
    [tasks],
  );

  const filterOptions: readonly SegmentOption<TaskFilter>[] = [
    { value: 'all', label: '全部', count: tasksQuery.data?counts.all:undefined },
    { value: 'attention', label: FILTER_LABELS.attention, count: tasksQuery.data?counts.attention:undefined },
    { value: 'active', label: FILTER_LABELS.active, count: tasksQuery.data?counts.active:undefined },
    { value: 'closed', label: FILTER_LABELS.closed, count: tasksQuery.data?counts.closed:undefined },
  ];

  const clearFilters = () => {
    setFilter('all');
    setKeyword('');
    setProject('all');
    setGrouped(false);
  };

  let body: ReactNode;
  if (tasksQuery.isLoading) {
    body = <TaskSkeletonRows />;
  } else if (tasksQuery.isError && tasks.length===0) {
    body = (
      <div style={{ padding: 16 }}>
        <ServiceNotice
          error={tasksQuery.error}
          onRetry={() => {
            void tasksQuery.refetch();
          }}
        />
        <p className="hint" style={{ marginTop: 10 }}>
          任务列表、筛选条件与计数全部来自 /api/tasks；服务未连接时不显示示例任务。
        </p>
      </div>
    );
  } else if (tasks.length === 0 && !keyword.trim() && filter==='all' && project==='all') {
    body = (
      <EmptyState
        icon="list"
        title="还没有任务"
        description="从一个目标开始：选项目、写目标、选流程，先得到一份需求草稿。"
        action={
          <LinkButton to="/start" variant="primary" size="sm" icon="plus">
            开始任务
          </LinkButton>
        }
      />
    );
  } else if (filtered.length === 0) {
    body = (
      <EmptyState
        icon="search"
        title="没有符合条件的任务"
        description="换个关键词或清除筛选。"
        action={
          <LinkButton to="/tasks" variant="secondary" size="sm" icon="refresh" onClick={clearFilters}>
            清除筛选
          </LinkButton>
        }
      />
    );
  } else if (grouped) {
    body = (
      <>
        {groupedTasks.map(([projectName, rows]) => (
          <div key={projectName}>
            <div className="task-group-head">
              <Icon name="folder" size="sm" />
              {rows[0]?.projectName ?? projectName}
              <span className="muted num">{String(rows.length)}</span>
            </div>
            <TaskListBody tasks={rows} />
          </div>
        ))}
      </>
    );
  } else {
    body = <TaskListBody tasks={filtered} />;
  }

  const showAttention = !tasksQuery.isLoading && !tasksQuery.isError && attentionTasks.length > 0;

  return (
    <div className="page tasks">
      <PageHeader
        title="任务列表"
        lede="每个任务都在执行画布里：哪一步在跑、哪一步卡住、下一步做什么。"
        actions={
          <>
            <IconButton
              icon="refresh"
              label="刷新任务列表"
              onClick={() => {
                void tasksQuery.refetch();
              }}
            />
            <LinkButton to="/start" variant="primary" size="sm" icon="plus">
              开始任务
            </LinkButton>
          </>
        }
      />

      {showAttention ? <AttentionStrip tasks={attentionTasks} /> : null}

      {tasksQuery.isFetchNextPageError?<div className="banner danger" role="alert"><Icon name="alert"/><span className="grow">更多任务读取失败，已有列表保留。</span><Button onClick={()=>void tasksQuery.fetchNextPage()}>重试加载更多</Button></div>:null}
      <div className="toolbar">
        <div className="input-wrap">
          <Icon name="search" />
          <input
            className="input ctl"
            placeholder="搜索任务、项目或原因"
            aria-label="搜索任务"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
          />
        </div>
        <Button variant="ghost" size="sm" icon="archive" onClick={() => setArchived(!archived)}>{archived ? '已归档 · 返回当前任务' : '查看已归档'}</Button>
        <SegmentedControl ariaLabel="状态" options={filterOptions} value={filter} onChange={setFilter} />
        <select className="select ctl" aria-label="项目" value={project} onChange={(event) => setProject(event.target.value)}>
          <option value="all">全部项目</option>
          {projects.map((item) => (
            <option key={item.id} value={item.id} title={item.rootPath}>
              {item.name}{projects.filter((other) => other.name === item.name).length > 1 ? ` · ${item.rootPath ?? '历史项目（目录未提供）'}` : ''}
            </option>
          ))}
        </select>
        <span className="spacer" />
        <label className="check group-toggle">
          <input type="checkbox" checked={grouped} onChange={(event) => setGrouped(event.target.checked)} />
          按项目分组
        </label>
      </div>

      <p className="hint" style={{ margin: '0 2px 10px' }}>
        按所选范围搜索和分页；状态计数包含该范围的所有任务。行内显示阶段与完成进度。
      </p>

      <section className="card" aria-label="任务列表">
        <div className="task-thead">
          <span>任务</span>
          <span className="c-need">需要处理</span>
          <span className="c-stage">阶段 / 聚合进度</span>
          <span className="task-status">状态</span>
          <span />
        </div>
        <div style={{ padding: '4px 6px 6px' }}>{body}</div>
        {filtered.length > 0 ? (
          <div className="task-foot">
            <span className="hint grow">
              已加载 {String(filtered.length)} / {total??'未知'} 个 · 最近更新优先
              {tasksQuery.isFetching ? ' · 正在刷新' : ''}
            </span>
            <Button
              variant="ghost"
              size="sm"
              icon="refresh"
              disabled={tasksQuery.isFetching}
              disabledReason={tasksQuery.isFetching ? '正在刷新任务列表…' : undefined}
              onClick={() => {
                void tasksQuery.refetch();
              }}
            >
              刷新
            </Button>
            <Button
              variant="secondary"
              size="sm"
              icon="plus"
              disabled={loadMoreDisabledReason !== undefined}
              disabledReason={loadMoreDisabledReason}
              onClick={() => {
                void tasksQuery.fetchNextPage();
              }}
            >
              加载更多
            </Button>
            <Button variant="ghost" size="sm" icon="archive" onClick={() => setArchived(!archived)}>
              {archived ? '返回当前任务' : '查看已归档'}
            </Button>
            <Link className="btn ghost sm" to="/inbox">
              <Icon name="inbox" size="sm" />
              待处理中心
            </Link>
          </div>
        ) : null}
      </section>

      {tasks.length > 0 ? (
        <p className="hint" style={{ marginTop: 12 }}>
          最近更新时间：{formatRelativeTime(filtered[0]?.updatedAt)} · 状态与阶段来自任务服务，不在此页修改。
        </p>
      ) : null}
    </div>
  );
}
