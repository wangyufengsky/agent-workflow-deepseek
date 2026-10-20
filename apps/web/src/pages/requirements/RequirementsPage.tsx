import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  PLANNING_STAGE_LABEL,
  PLANNING_STATUS_LABEL,
  TaskStage,
  TASK_STAGE_LABEL,
  type TaskStageValue,
  type TaskSummary,
} from '@agent-workflow/shared';
import { useQuery } from '@tanstack/react-query';
import { fetchTaskDetail } from '../../api/workflow.ts';
import { Drawer } from '../../components/Drawer.tsx';
import { taskHref } from '../../app/taskStatus.ts';
import { useProjects, useTasks } from '../../api/hooks.ts';
import { formatRelativeTime } from '../../app/format.ts';
import { sortByUpdatedDesc, taskStageIcon } from '../../app/taskStatus.ts';
import { Button, LinkButton } from '../../components/Button.tsx';
import { PageHeader } from '../../components/Card.tsx';
import { EmptyState, Skeleton } from '../../components/EmptyState.tsx';
import { Icon } from '../../components/Icon.tsx';
import { IconButton } from '../../components/IconButton.tsx';
import { SegmentedControl, type SegmentOption } from '../../components/SegmentedControl.tsx';
import { ServiceNotice } from '../../components/ServiceNotice.tsx';
import { TaskStatusBadge } from '../../components/StageBadge.tsx';

type StageFilter = 'all' | TaskStageValue;

const PAGE_SIZE = 20;

function planningText(task: TaskSummary): string {
  if (task.planning === undefined) return '—';
  return `${PLANNING_STATUS_LABEL[task.planning.status]} · ${PLANNING_STAGE_LABEL[task.planning.stage]}`;
}

function RequirementRow({ task, showProject, selected, onSelect }: { readonly task: TaskSummary; readonly showProject: boolean; readonly selected: boolean; readonly onSelect: () => void }) {
  return (
    <button type="button" onClick={onSelect}
      className="list-row"
      aria-selected={selected}
      style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 164px 136px 118px 18px', gap: 16, alignItems: 'center', borderRadius: 0, width: '100%', textAlign: 'left', background: selected ? 'var(--fill-2)' : undefined }}
    >
      <span style={{ minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 14, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={task.title}>
          {task.title}
        </span>
        <span className="row" style={{ gap: 8, marginTop: 3, minWidth: 0 }}>
          <Icon name={taskStageIcon(task.stage)} size="sm" />
          <span className="hint" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {showProject ? `${task.projectName} · ` : ''}
            {task.methodName}
          </span>
        </span>
      </span>
      <span style={{ minWidth: 0 }}>
        <TaskStatusBadge task={task} />
      </span>
      <span className="row" style={{ gap: 6, minWidth: 0 }}>
        <span className="num">{task.planRevision === undefined ? '尚无修订' : `修订 ${task.planRevision}`}</span>

      </span>
      <span className="hint num" style={{ textAlign: 'right', whiteSpace: 'nowrap' }} title={task.updatedAt}>
        {formatRelativeTime(task.updatedAt)}
      </span>
      <Icon name="chevRight" size="sm" />
    </button>
  );
}

export function RequirementsPage() {
  const tasksQuery = useTasks({ limit: 200 });
  const projectsQuery = useProjects();
  const [params, setParams] = useSearchParams();
  const [selected, setSelected] = useState<TaskSummary | null>(null);
  const detail = useQuery({ queryKey: ['requirement-directory', selected?.id], queryFn: () => fetchTaskDetail(selected!.id), enabled: selected !== null, retry: false });
  const [stage, setStage] = useState<StageFilter>('all');
  const [keyword, setKeyword] = useState('');
  const [visible, setVisible] = useState(PAGE_SIZE);

  const projectId = params.get('projectId') ?? 'all';
  const tasks = tasksQuery.data ?? [];
  const projects = projectsQuery.data ?? [];

  useEffect(() => {
    setVisible(PAGE_SIZE);
  }, [projectId, stage, keyword]);

  const counts = useMemo(() => {
    const result: Record<StageFilter, number> = {
      all: tasks.length,
      draft: 0,
      planning: 0,
      confirming: 0,
      preparing: 0,
      executing: 0,
    };
    for (const task of tasks) result[task.stage] += 1;
    return result;
  }, [tasks]);

  const stageOptions: readonly SegmentOption<StageFilter>[] = [
    { value: 'all', label: '全部', count: counts.all },
    { value: TaskStage.DRAFT, label: TASK_STAGE_LABEL.draft, count: counts.draft },
    { value: TaskStage.PLANNING, label: TASK_STAGE_LABEL.planning, count: counts.planning },
    { value: TaskStage.CONFIRMING, label: TASK_STAGE_LABEL.confirming, count: counts.confirming },
    { value: TaskStage.PREPARING, label: TASK_STAGE_LABEL.preparing, count: counts.preparing },
    { value: TaskStage.EXECUTING, label: TASK_STAGE_LABEL.executing, count: counts.executing },
  ];

  const filtered = useMemo(() => {
    const needle = keyword.trim().toLowerCase();
    const rows = tasks.filter((task) => {
      if (projectId !== 'all' && task.projectId !== projectId) return false;
      if (stage !== 'all' && task.stage !== stage) return false;
      if (needle.length === 0) return true;
      return [task.title, task.projectName, task.methodName, planningText(task)].join(' ').toLowerCase().includes(needle);
    });
    return sortByUpdatedDesc(rows);
  }, [keyword, projectId, stage, tasks]);

  const shown = filtered.slice(0, visible);
  const hasMore = visible < filtered.length;

  const setProject = (value: string) => {
    const next = new URLSearchParams(params);
    if (value === 'all') next.delete('projectId');
    else next.set('projectId', value);
    setParams(next, { replace: true });
  };

  const clearFilters = () => {
    setProject('all');
    setStage('all');
    setKeyword('');
  };

  let body: ReactNode;
  if (tasksQuery.isLoading) {
    body = (
      <div style={{ padding: 8 }}>
        {[0, 1, 2, 3, 4].map((index) => (
          <div key={index} className="row" style={{ padding: '14px 12px', gap: 16 }}>
            <div className="col grow" style={{ gap: 6 }}>
              <Skeleton width="46%" height={13} />
              <Skeleton width="24%" height={10} />
            </div>
            <Skeleton width={250} height={20} radius={99} />
            <Skeleton width={80} height={20} radius={99} />
            <Skeleton width={64} height={11} />
          </div>
        ))}
      </div>
    );
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
          需求目录复用 /api/tasks 的真实任务与规划状态；服务未连接时不显示示例需求。
        </p>
      </div>
    );
  } else if (tasks.length === 0) {
    body = (
      <EmptyState
        icon="target"
        title="从一个需求开始"
        description="写下目标、选择流程，在画布上安排本次工作。确认计划之前不会执行任何步骤。"
        action={
          <LinkButton to="/start" variant="primary" size="sm" icon="plus">
            新建需求
          </LinkButton>
        }
      />
    );
  } else if (filtered.length === 0) {
    body = (
      <EmptyState
        icon="search"
        title="没有符合条件的需求"
        description="换个关键词或清除筛选；项目筛选已保留在地址栏中。"
        action={
          <button type="button" className="btn secondary sm" onClick={clearFilters}>
            <Icon name="refresh" size="sm" />
            清除筛选
          </button>
        }
      />
    );
  } else {
    body = (
      <>
        <div
          className="rq-head"
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1fr) 164px 136px 118px 18px',
            gap: 16,
            padding: '10px 16px',
            fontSize: 12,
            color: 'var(--muted)',
            boxShadow: 'inset 0 -1px 0 var(--line)',
          }}
        >
          <span>需求</span>
          <span>状态</span>
          <span>计划修订</span>
          <span style={{ textAlign: 'right' }}>更新时间</span>
          <span />
        </div>
        <div style={{ padding: '4px 6px 6px' }}>
          {shown.map((task) => (
            <RequirementRow key={task.id} task={task} showProject={projectId === 'all'} selected={selected?.id === task.id} onSelect={() => setSelected(task)} />
          ))}
        </div>
        <div className="row" style={{ padding: '10px 16px 14px', boxShadow: 'inset 0 1px 0 var(--line)', flexWrap: 'wrap', gap: 8 }}>
          <span className="hint grow">
            已显示 {String(shown.length)} / {String(filtered.length)} 个 · 最近更新在前
          </span>
          {hasMore ? (
            <button
              type="button"
              className="btn ghost sm"
              onClick={() => {
                setVisible((current) => current + PAGE_SIZE);
              }}
            >
              加载更多
            </button>
          ) : (
            <span className="hint">已全部显示</span>
          )}
        </div>
      </>
    );
  }

  return (
    <div className="page wide">
      <PageHeader
        title="需求"
        lede="每个需求对应一张计划画布：在这里找到它，打开画布继续规划、确认或查看执行。"
        actions={
          <>
            <IconButton
              icon="refresh"
              label="刷新需求目录"
              onClick={() => {
                void tasksQuery.refetch();
                void projectsQuery.refetch();
              }}
            />
            <LinkButton to="/start" variant="primary" size="sm" icon="plus">
              新建需求
            </LinkButton>
          </>
        }
      />

      <div className="toolbar">
        <div className="input-wrap">
          <Icon name="search" />
          <input
            className="input ctl"
            placeholder="搜索需求标题、项目或规划状态"
            aria-label="搜索需求"
            value={keyword}
            onChange={(event) => {
              setKeyword(event.target.value);
            }}
          />
        </div>
        <select className="select ctl" aria-label="项目" value={projectId} onChange={(event) => { setProject(event.target.value); }}>
          <option value="all">全部项目</option>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>
        <SegmentedControl ariaLabel="阶段" options={stageOptions} value={stage} onChange={setStage} />
        <span className="spacer" />
        {projectId === 'all' ? null : (
          <span className="hint">
            <Icon name="filter" size="sm" /> 已按项目筛选，链接可直接分享
          </span>
        )}
      </div>

      {projectsQuery.isError ? (
        <div className="banner warn" style={{ marginBottom: 14 }}>
          <Icon name="alert" />
          <div className="grow">
            <b>项目列表读取失败</b>
            <br />
            暂时不能按项目筛选，下面仍显示全部需求。
          </div>
          <Button variant="secondary" size="sm" icon="refresh" disabled={projectsQuery.isFetching} onClick={() => { void projectsQuery.refetch(); }}>
            {projectsQuery.isFetching ? '重试中…' : '重试'}
          </Button>
        </div>
      ) : null}

      <Drawer open={selected !== null} title={selected?.title ?? '需求'} onClose={() => setSelected(null)} footer={selected ? (() => { const href = taskHref(selected); const requirementCanvas = href.startsWith('/requirement'); return (<div className="col" style={{ gap: 8, width: '100%' }}><span className="hint">{requirementCanvas ? '打开的是需求画布：继续规划与确认计划。' : '打开的是执行画布：查看进度、结果与交付物。'}</span><LinkButton to={href} variant="primary" iconAfter="arrowRight">打开{requirementCanvas ? '需求' : '执行'}画布</LinkButton></div>); })() : null}>
        {detail.isLoading ? <Skeleton height={100} /> : detail.isError ? <ServiceNotice error={detail.error} onRetry={() => { void detail.refetch(); }} /> : detail.data ? <>
          {selected ? <TaskStatusBadge task={{ ...selected, ...detail.data.task }} /> : null}
          <dl className="kv"><dt>计划修订</dt><dd>{detail.data.plan ? `修订 ${detail.data.plan.revisionNumber}` : '尚无计划修订'}</dd><dt>更新时间</dt><dd>{detail.data.task.updatedAt}</dd></dl>
          <p className="hint">计划修订记录已保存的计划变化，与需求输入修订 {detail.data.task.requirement.revision} 分别保留。选中只是查看，确认计划和开始执行都在画布里单独操作。</p>
          <p style={{ whiteSpace: 'pre-wrap' }}>{detail.data.task.requirement.text}</p>
        </> : null}
      </Drawer>
      <section className="card" aria-busy={tasksQuery.isFetching} aria-label="需求目录">
        {body}
      </section>
    </div>
  );
}
