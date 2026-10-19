import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { TaskSummary } from '@agent-workflow/shared';
import { useTasks } from '../../api/hooks.ts';
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
  const [limit, setLimit] = useState(50);
  const [archived, setArchived] = useState(false);
  const tasksQuery = useTasks({ limit, archived });
  const [filter, setFilter] = useState<TaskFilter>('all');
  const [keyword, setKeyword] = useState('');
  const [project, setProject] = useState('all');
  const [grouped, setGrouped] = useState(false);

  const tasks = tasksQuery.data ?? [];
  const loadMoreBlockedReason = limit >= 200
    ? '服务端单次最多返回 200 条任务；请用搜索或项目筛选缩小范围。'
    : tasks.length < limit
      ? '已加载全部任务（列表接口未返回更多分页信息）。'
      : undefined;
  const loadMoreDisabledReason = tasksQuery.isFetching ? '正在读取任务…' : loadMoreBlockedReason;

  const counts = useMemo(() => {
    const base: Record<TaskFilter, number> = { all: tasks.length, attention: 0, active: 0, closed: 0 };
    for (const task of tasks) base[taskGroup(task)] += 1;
    return base;
  }, [tasks]);

  const projects = useMemo(() => {
    const names = new Set(tasks.map((task) => task.projectName));
    return [...names].sort((a, b) => a.localeCompare(b, 'zh-CN'));
  }, [tasks]);

  const filtered = useMemo(() => {
    const rows = tasks.filter((task) => {
      if (filter !== 'all' && taskGroup(task) !== filter) return false;
      if (project !== 'all' && task.projectName !== project) return false;
      return matchesSearch(task, keyword.trim());
    });
    return sortByUpdatedDesc(rows);
  }, [filter, keyword, project, tasks]);

  const groupedTasks = useMemo(() => {
    const map = new Map<string, TaskSummary[]>();
    for (const task of filtered) {
      const bucket = map.get(task.projectName);
      if (bucket === undefined) {
        map.set(task.projectName, [task]);
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
    { value: 'all', label: '全部', count: counts.all },
    { value: 'attention', label: FILTER_LABELS.attention, count: counts.attention },
    { value: 'active', label: FILTER_LABELS.active, count: counts.active },
    { value: 'closed', label: FILTER_LABELS.closed, count: counts.closed },
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
  } else if (tasksQuery.isError) {
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
  } else if (tasks.length === 0) {
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
              {projectName}
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
        title="任务"
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
          {projects.map((name) => (
            <option key={name} value={name}>
              {name}
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
        列表接口未提供逐步骤状态，也未返回总数/游标；行内展示阶段胶囊与聚合进度（完成/总数步），计数基于已加载任务。
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
        {tasksQuery.isSuccess && filtered.length > 0 ? (
          <div className="task-foot">
            <span className="hint grow">
              已加载 {String(filtered.length)} 个 · 最近更新优先
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
                setLimit(Math.min(limit + 50, 200));
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
