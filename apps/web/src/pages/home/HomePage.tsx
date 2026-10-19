import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { TASK_STAGE_LABEL, TaskLifecycle, type BootstrapResponse, type InboxItem, type TaskSummary } from '@agent-workflow/shared';
import { useBootstrap } from '../../api/hooks.ts';
import { Badge } from '../../components/Badge.tsx';
import { LinkButton } from '../../components/Button.tsx';
import { EmptyState, Skeleton } from '../../components/EmptyState.tsx';
import { Icon } from '../../components/Icon.tsx';
import { ServiceNotice } from '../../components/ServiceNotice.tsx';
import { TaskStatusBadge } from '../../components/StageBadge.tsx';
import { formatCount, formatRelativeTime } from '../../app/format.ts';
import { inboxHref, inboxKindIcon, inboxKindLabel, sortByUpdatedDesc, taskHref, taskStageIcon } from '../../app/taskStatus.ts';
import { HomeCapabilities } from './HomeCapabilities.tsx';
import { HomeFlowDemo } from './HomeFlowDemo.tsx';

function OngoingRow({ task }: { readonly task: TaskSummary }) {
  return (
    <Link className="home-row" to={taskHref(task)}>
      <span className="tile">
        <Icon name={taskStageIcon(task.stage)} />
      </span>
      <div className="grow" style={{ minWidth: 0 }}>
        <div className="title-line">{task.title}</div>
        <div className="meta-line">
          {task.projectName} · {TASK_STAGE_LABEL[task.stage]} · 更新 {formatRelativeTime(task.updatedAt)}
        </div>
      </div>
      <span className="side">
        <TaskStatusBadge task={task} />
        <span className="when">{formatRelativeTime(task.updatedAt)}</span>
      </span>
    </Link>
  );
}

function AttentionRow({ item }: { readonly item: InboxItem }) {
  return (
    <Link className="home-row" to={inboxHref(item)}>
      <span className="tile">
        <Icon name={inboxKindIcon(item)} />
      </span>
      <div className="grow" style={{ minWidth: 0 }}>
        <div className="title-line">{item.taskTitle}</div>
        <div className="meta-line">
          {item.title} · {item.projectName}
        </div>
      </div>
      <span className="side">
        <Badge tone="wait" icon="help">
          {inboxKindLabel(item)}
        </Badge>
        <span className="when">{formatRelativeTime(item.createdAt)}</span>
      </span>
    </Link>
  );
}

function RecentRow({ task }: { readonly task: TaskSummary }) {
  return (
    <Link className="home-row" to={taskHref(task)}>
      <span className="tile">
        <Icon name={taskStageIcon(task.stage)} />
      </span>
      <div className="grow" style={{ minWidth: 0 }}>
        <div className="title-line">{task.title}</div>
        <div className="meta-line">
          {task.projectName} · {task.methodName}
        </div>
      </div>
      <span className="side">
        <TaskStatusBadge task={task} />
        <span className="when">{formatRelativeTime(task.updatedAt)}</span>
      </span>
    </Link>
  );
}

function SectionLink({ to, children }: { readonly to: string; readonly children: ReactNode }) {
  return (
    <Link className="btn ghost sm home-link-more" to={to}>
      {children}
      <Icon name="chevRight" size="sm" />
    </Link>
  );
}

function HomeSkeleton() {
  return (
    <section aria-label="工作区概览" style={{ marginTop: 28 }}>
      <div className="stat-grid">
        {[0, 1, 2].map((index) => (
          <div key={index} className="card stat">
            <Skeleton width={34} height={34} radius={10} />
            <div className="grow stack-sm">
              <Skeleton width="40%" height={18} />
              <Skeleton width="60%" height={11} />
            </div>
          </div>
        ))}
      </div>
      <div className="card pad">
        <div className="stack">
          {[0, 1, 2, 3].map((index) => (
            <div key={index} className="home-skeleton-row">
              <Skeleton width={32} height={32} radius={9} />
              <div className="grow stack-sm">
                <Skeleton width="42%" height={13} />
                <Skeleton width="26%" height={11} />
              </div>
              <Skeleton width={84} height={22} radius={99} />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function HomeLive({ data }: { readonly data: BootstrapResponse }) {
  const ongoing = sortByUpdatedDesc(data.tasks.filter((task) => task.lifecycle === TaskLifecycle.ACTIVE)).slice(0, 4);
  const attention = [...data.inbox]
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, 4);
  const recent = sortByUpdatedDesc(data.tasks).slice(0, 5);
  const counts = data.counts;

  return (
    <section aria-label="工作区概览">
      <div className="stat-grid">
        <Link className="card stat hoverable" to="/tasks">
          <span className="tile">
            <Icon name="play" />
          </span>
          <div>
            <div className="v num">{formatCount(counts.activeTasks)}</div>
            <div className="l">进行中的任务</div>
          </div>
        </Link>
        <Link className="card stat hoverable" to="/inbox">
          <span className="tile">
            <Icon name="inbox" />
          </span>
          <div>
            <div className="v num">{formatCount(counts.waitingUser)}</div>
            <div className="l">需要你处理</div>
          </div>
        </Link>
        <Link className="card stat hoverable" to="/requirements">
          <span className="tile">
            <Icon name="sparkle" />
          </span>
          <div>
            <div className="v num">{formatCount(counts.openPlannings)}</div>
            <div className="l">正在规划</div>
          </div>
        </Link>
      </div>

      <div className="home-live-grid">
        <section className="card home-card" aria-label="进行中">
          <div className="home-card-head">
            <span className="eyebrow grow">进行中</span>
            <SectionLink to="/tasks">全部任务</SectionLink>
          </div>
          <div className="home-card-body">
            {ongoing.length === 0 ? (
              <EmptyState
                compact
                icon="play"
                title="还没有进行中的任务"
                description="从一个目标开始：选项目、写目标、选流程，先得到一份需求草稿。"
                action={
                  <LinkButton to="/start" variant="primary" size="sm" icon="plus">
                    开始任务
                  </LinkButton>
                }
              />
            ) : (
              ongoing.map((task) => <OngoingRow key={task.id} task={task} />)
            )}
          </div>
        </section>

        <section className="card home-card" aria-label="需要你处理">
          <div className="home-card-head">
            <span className="eyebrow grow">需要你处理</span>
            <SectionLink to="/inbox">待处理中心</SectionLink>
          </div>
          <div className="home-card-body">
            {attention.length === 0 ? (
              <EmptyState compact icon="check" title="没有待处理事项" description="需要你回答、审阅或确认的事项会显示在这里。" />
            ) : (
              attention.map((item) => <AttentionRow key={item.id} item={item} />)
            )}
          </div>
        </section>
      </div>

      <section className="card home-card" aria-label="最近活动">
        <div className="home-card-head">
          <span className="eyebrow grow">最近活动</span>
          <SectionLink to="/tasks">查看全部</SectionLink>
        </div>
        <div className="home-card-body">
          {recent.length === 0 ? (
            <EmptyState compact icon="list" title="还没有任务记录" description="服务已连接，但还没有任务。创建第一个需求草稿后会出现在这里。" />
          ) : (
            recent.map((task) => <RecentRow key={task.id} task={task} />)
          )}
        </div>
      </section>
    </section>
  );
}

export function HomePage() {
  const bootstrap = useBootstrap();

  return (
    <div className="page home">
      <section className="hero in">
        <span className="badge outline">
          <Icon name="sparkle" size="sm" />
          本地开发工作区
        </span>
        <h2>
          Everything is a <em>Workflow.</em>
        </h2>
        <p>
          万事皆流程，执行由你掌控。
          <br />
          先把想法说清楚，再让工作沿流程展开，每一步都有迹可循。
        </p>
        <div className="row">
          <LinkButton to="/start" variant="primary" size="lg" iconAfter="arrowRight">
            开始任务
          </LinkButton>
          <LinkButton to="/projects" variant="secondary" size="lg" icon="folder">
            查看项目
          </LinkButton>
        </div>
      </section>

      {bootstrap.isLoading ? <HomeSkeleton /> : null}

      {bootstrap.isError ? (
        <section aria-label="工作区概览" style={{ marginTop: 28 }}>
          <ServiceNotice
            error={bootstrap.error}
            onRetry={() => {
              void bootstrap.refetch();
            }}
          />
          <p className="hint" style={{ marginTop: 10 }}>
            「进行中」「需要你处理」「最近活动」只在服务连接后显示真实数据；未连接时不使用示例数据。
          </p>
        </section>
      ) : null}

      {bootstrap.data === undefined ? null : <HomeLive data={bootstrap.data} />}

      <HomeFlowDemo />
      <HomeCapabilities />
    </div>
  );
}
