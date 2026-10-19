import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { TaskLifecycle, type TaskLifecycleValue, type TaskSummary } from '@agent-workflow/shared';
import { useQuery } from '@tanstack/react-query';
import { useBootstrap } from '../../api/hooks.ts';
import { apiGet } from '../../api/client.ts';
import type { InsightsResponse, InsightsTaskUsageResponse } from '@agent-workflow/shared';
import { formatAbsoluteTime, formatCount, formatRelativeTime } from '../../app/format.ts';
import { deriveTaskStatus, sortByUpdatedDesc, taskHref, taskProgressText } from '../../app/taskStatus.ts';
import { Badge } from '../../components/Badge.tsx';
import { LinkButton } from '../../components/Button.tsx';
import { PageHeader } from '../../components/Card.tsx';
import { EmptyState, Skeleton } from '../../components/EmptyState.tsx';
import { Icon } from '../../components/Icon.tsx';
import { SegmentedControl, type SegmentOption } from '../../components/SegmentedControl.tsx';
import { ServiceNotice } from '../../components/ServiceNotice.tsx';
import { StageCapsule } from '../../components/StageCapsule.tsx';

type QualityFilter = 'all' | 'attention' | TaskLifecycleValue;

function statusFilter(task: TaskSummary): Exclude<QualityFilter, 'all'> {
  if (task.attention !== 'none') return 'attention';
  return task.lifecycle;
}

function UnknownValue({ reason }: { readonly reason: string }) {
  return (
    <Badge tone="unknown" icon="help" title={reason}>
      未知
    </Badge>
  );
}

function TaskDetail({ task }: { readonly task: TaskSummary }) {
  const status = deriveTaskStatus(task);
  return (
    <aside className="card solid" aria-label="任务明细" style={{ padding: 20, position: 'sticky', top: 24 }}>
      <div className="row wrap" style={{ gap: 8 }}>
        <Badge tone={status.tone} icon={status.icon}>
          {status.label}
        </Badge>
        <span className="hint">更新 {formatRelativeTime(task.updatedAt)}</span>
      </div>
      <h2 style={{ fontSize: 17, fontWeight: 500, marginTop: 10 }}>{task.title}</h2>
      <p className="hint" style={{ marginTop: 4 }}>
        {task.projectName} · {task.methodName}
      </p>

      <div className="section" style={{ marginTop: 16 }}>
        <div className="eyebrow" style={{ marginBottom: 8 }}>
          阶段
        </div>
        <StageCapsule compact current={task.stage} lifecycle={task.lifecycle} attention={task.attention} />
        <p className="hint" style={{ marginTop: 8 }}>
          执行进度 {taskProgressText(task)} · 回执与证据在任务画布中查看。
        </p>
      </div>

      <div className="section">
        <div className="eyebrow" style={{ marginBottom: 8 }}>
          验收与评审
        </div>
        <div className="banner unknown">
          <Icon name="help" />
          <div className="grow">
            验收 / 评审结果接口尚未接通；本页不显示通过率、评审结论或人工认定。
          </div>
        </div>
      </div>

      <div className="section">
        <div className="eyebrow" style={{ marginBottom: 8 }}>
          用量
        </div>
        <div className="grid-2" style={{ gap: 8 }}>
          <div className="card pad" style={{ padding: 12 }}>
            <div className="eyebrow">已记录 Tokens</div>
            <div style={{ marginTop: 4 }}>
              <UnknownValue reason="服务未提供按任务聚合的 tokens 接口" />
            </div>
          </div>
          <div className="card pad" style={{ padding: 12 }}>
            <div className="eyebrow">成本</div>
            <div style={{ marginTop: 4 }}>
              <UnknownValue reason="服务未提供成本聚合接口" />
            </div>
          </div>
          <div className="card pad" style={{ padding: 12 }}>
            <div className="eyebrow">耗时</div>
            <div style={{ marginTop: 4 }}>
              <UnknownValue reason="服务未提供任务耗时接口" />
            </div>
          </div>
          <div className="card pad" style={{ padding: 12 }}>
            <div className="eyebrow">重试</div>
            <div style={{ marginTop: 4 }}>
              <UnknownValue reason="服务未提供重试次数聚合接口" />
            </div>
          </div>
        </div>
      </div>

      <div className="row wrap" style={{ gap: 8, marginTop: 18 }}>
        <LinkButton to={taskHref(task)} variant="primary" icon="eye">
          查看任务画布
        </LinkButton>
        <Link className="btn ghost sm" to="/tasks">
          <Icon name="list" size="sm" />
          任务列表
        </Link>
      </div>
    </aside>
  );
}

export function InsightsPage() {
  const bootstrap = useBootstrap();
  const insights = useQuery({ queryKey: ['insights'], queryFn: async () => (await apiGet<InsightsResponse>('/api/insights')).data, retry: false });
  const taskUsage = useQuery({ queryKey: ['insights', 'task-usage'], queryFn: async () => (await apiGet<InsightsTaskUsageResponse>('/api/insights/task-usage')).data, retry: false });
  const usageByTask = useMemo(() => new Map((taskUsage.data?.usage ?? []).map((entry) => [entry.taskId, entry.tokens])), [taskUsage.data]);
  const tasks = bootstrap.data?.tasks ?? [];
  const counts = bootstrap.data?.counts;
  const [quality, setQuality] = useState<QualityFilter>('all');
  const [keyword, setKeyword] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const lifecycleCounts = useMemo(() => {
    const result: Record<QualityFilter, number> = { all: tasks.length, active: 0, completed: 0, cancelled: 0, attention: 0 };
    for (const task of tasks) result[statusFilter(task)] += 1;
    return result;
  }, [tasks]);

  const filterOptions: readonly SegmentOption<QualityFilter>[] = [
    { value: 'all', label: '全部', count: lifecycleCounts.all },
    { value: 'active', label: '进行中', count: lifecycleCounts.active },
    { value: 'completed', label: '已完成', count: lifecycleCounts.completed },
    { value: 'cancelled', label: '已取消', count: lifecycleCounts.cancelled },
    { value: 'attention', label: '需要处理', count: lifecycleCounts.attention },
  ];

  const rows = useMemo(() => {
    const needle = keyword.trim().toLowerCase();
    const filtered = tasks.filter((task) => {
      if (quality !== 'all' && statusFilter(task) !== quality) return false;
      if (needle.length === 0) return true;
      return [task.title, task.projectName, task.methodName].join(' ').toLowerCase().includes(needle);
    });
    return sortByUpdatedDesc(filtered);
  }, [keyword, quality, tasks]);

  const selected = rows.find((task) => task.id === selectedId) ?? rows[0];
  const completed = tasks.filter((task) => task.lifecycle === TaskLifecycle.COMPLETED).length;
  const cancelled = tasks.filter((task) => task.lifecycle === TaskLifecycle.CANCELLED).length;

  let body: ReactNode;
  if (bootstrap.isLoading) {
    body = <p className="hint">正在读取任务与统计…</p>;
  } else if (bootstrap.isError) {
    body = (
      <ServiceNotice
        error={bootstrap.error}
        onRetry={() => {
          void bootstrap.refetch();
        }}
      />
    );
  } else if (tasks.length === 0) {
    body = <EmptyState icon="chart" title="还没有可统计的任务" description="任务产生后，这里按任务列出状态；用量与质量指标在对应接口接通前保持未知。" />;
  } else if (rows.length === 0) {
    body = <EmptyState icon="search" title="没有符合条件的任务" description="清除筛选或换个关键词后重试。" />;
  } else {
    body = (
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 380px)', gap: 16, alignItems: 'start' }}>
        <section className="card" aria-label="质量与用量列表">
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ color: 'var(--muted)', textAlign: 'left', boxShadow: 'inset 0 -1px 0 var(--line)' }}>
                  <th style={{ padding: '12px 16px', fontWeight: 400 }}>任务</th>
                  <th style={{ padding: '12px 8px', fontWeight: 400 }}>状态</th>
                  <th style={{ padding: '12px 8px', fontWeight: 400 }}>质量</th>
                  <th style={{ padding: '12px 16px', fontWeight: 400 }}>用量</th>
                  <th style={{ padding: '12px 16px', fontWeight: 400 }}>更新时间</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((task) => {
                  const status = deriveTaskStatus(task);
                  return (
                    <tr
                      key={task.id}
                      aria-selected={selected?.id === task.id}
                      tabIndex={0}
                      onClick={() => {
                        setSelectedId(task.id);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          setSelectedId(task.id);
                        }
                      }}
                      style={{ cursor: 'pointer', boxShadow: 'inset 0 -1px 0 var(--line)', background: selected?.id === task.id ? 'var(--fill-2)' : undefined }}
                    >
                      <td style={{ padding: '12px 16px' }}>
                        <div style={{ fontWeight: 500 }}>{task.title}</div>
                        <div className="hint">
                          {task.projectName} · {task.methodName}
                        </div>
                      </td>
                      <td style={{ padding: '12px 8px' }}>
                        <Badge tone={status.tone} icon={status.icon}>
                          {status.label}
                        </Badge>
                      </td>
                      <td style={{ padding: '12px 8px' }}>
                        <UnknownValue reason="验收 / 评审接口尚未接通" />
                      </td>
                      <td style={{ padding: '12px 16px' }}>
                        {taskUsage.data === undefined ? <UnknownValue reason="正在读取规划用量" /> : (
                          <span className="hint num">{formatCount(usageByTask.get(task.id) ?? 0)} 规划 tokens</span>
                        )}
                      </td>
                      <td style={{ padding: '12px 16px' }}>
                        <span className="hint num">{formatRelativeTime(task.updatedAt)}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="row" style={{ padding: '10px 16px 12px', flexWrap: 'wrap', gap: 8 }}>
            <span className="hint grow">
              已加载 {String(rows.length)} 个任务 · 汇总覆盖当前筛选范围
            </span>
            <span className="hint">逐任务用量：仅统计规划轮次 tokens</span>
          </div>
        </section>
        {selected === undefined ? null : <TaskDetail task={selected} />}
      </div>
    );
  }

  return (
    <div className="page">
      <PageHeader
        title="质量与用量"
        lede="按任务核对状态、验收与消耗。计数、规划 tokens/成本与执行 tokens 来自 /api/insights；验收与评审结论仍按未知显示。"
        actions={
          <button
            type="button"
            className="icon-btn"
            aria-label="刷新统计"
            title="刷新统计"
            onClick={() => {
              void bootstrap.refetch();
            }}
          >
            <Icon name="refresh" />
          </button>
        }
      />

      <div className="toolbar">
        <div className="input-wrap" style={{ width: 240 }}>
          <Icon name="search" />
          <input
            className="input ctl"
            placeholder="搜索任务标题"
            aria-label="搜索任务标题"
            value={keyword}
            onChange={(event) => {
              setKeyword(event.target.value);
            }}
          />
        </div>
        <SegmentedControl ariaLabel="任务状态" options={filterOptions} value={quality} onChange={setQuality} />
        <span className="spacer" />
        <span className="hint">服务启动于 {formatAbsoluteTime(bootstrap.data?.app.startedAt)}</span>
      </div>

      <div className="grid-3" style={{ marginBottom: 16 }}>
        <div className="card pad">
          <div className="eyebrow">已记录用量 · 规划</div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, marginTop: 6 }}>
            {insights.data === undefined ? <UnknownValue reason="正在读取 insights" /> : `${formatCount(insights.data.planning.tokens.total)} tokens`}
          </div>
          <div className="hint" style={{ marginTop: 6 }}>
            {insights.data === undefined ? '尚未读取' : `输入 ${formatCount(insights.data.planning.tokens.input)} · 输出 ${formatCount(insights.data.planning.tokens.output)} · 推理 ${formatCount(insights.data.planning.tokens.reasoning)} · 缓存 ${formatCount(insights.data.planning.tokens.cache)}`}
          </div>
        </div>
        <div className="card pad">
          <div className="eyebrow">成本 · 规划</div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, marginTop: 6 }}>
            {insights.data === undefined ? <UnknownValue reason="正在读取 insights" /> : `${insights.data.planning.currency} ${insights.data.planning.costKnown.toFixed(4)}`}
          </div>
          <div className="hint" style={{ marginTop: 6 }}>
            规划成本已结账；执行 tokens 已汇总，评审/修复用量未聚合。
          </div>
        </div>
        <div className="card pad">
          <div className="eyebrow">任务状态汇总</div>
          <div className="row wrap" style={{ gap: 8, marginTop: 6 }}>
            <Badge tone="run" icon="play">
              进行中 {formatCount(counts?.activeTasks ?? lifecycleCounts.active)}
            </Badge>
            <Badge tone="done" icon="check">
              已完成 {formatCount(completed)}
            </Badge>
            <Badge tone="idle" icon="stop">
              已取消 {formatCount(cancelled)}
            </Badge>
            <Badge tone="wait" icon="help">
              需要处理 {formatCount(counts?.waitingUser ?? lifecycleCounts.attention)}
            </Badge>
          </div>
          <div className="hint" style={{ marginTop: 6 }}>
            来自 bootstrap.counts 与真实任务生命周期。
          </div>
        </div>
      </div>

      {insights.data === undefined ? null : (
        <section className="card" aria-label="运行统计" style={{ marginBottom: 16 }}>
          <div className="card-head">
            <span className="tile"><Icon name="chart" /></span>
            <div className="grow">
              <span className="section-title">运行统计</span>
              <div className="hint" style={{ marginTop: 2 }}>来自 SQLite 的真实计数（阅读于 {new Date(insights.data.generatedAt).toLocaleString('zh-CN')}）；不含伪造的 token/成本数据。</div>
            </div>
          </div>
          <div className="card-body">
            <div className="grid-2" style={{ gap: 12 }}>
              <div className="card pad"><div className="eyebrow">任务</div><div style={{ fontSize: 18, marginTop: 4 }}>{String(insights.data.tasks.total)}</div><div className="hint">进行中 {String(insights.data.tasks.active)} · 已完成 {String(insights.data.tasks.completed)} · 待处理 {String(insights.data.tasks.attention)}</div></div>
              <div className="card pad"><div className="eyebrow">规划轮次</div><div style={{ fontSize: 18, marginTop: 4 }}>{String(insights.data.planning.rounds)}</div><div className="hint">完成 {String(insights.data.planning.completed)} · 失败 {String(insights.data.planning.failed)} · 进行中 {String(insights.data.planning.running)} · 已记录成本 {insights.data.planning.costKnown.toFixed(4)} {insights.data.planning.currency}（{String(insights.data.planning.budgetUnknownRounds)} 轮未知预算）</div></div>
              <div className="card pad"><div className="eyebrow">执行 / 尝试</div><div style={{ fontSize: 18, marginTop: 4 }}>{String(insights.data.executions.total)} / {String(insights.data.executions.attempts)}</div><div className="hint">运行中 {String(insights.data.executions.running)} · 失败 {String(insights.data.executions.failed)}</div><div className="hint">执行 tokens {formatCount(insights.data.executions.tokens.total)}（输入 {formatCount(insights.data.executions.tokens.input)} · 输出 {formatCount(insights.data.executions.tokens.output)}）</div></div>
              <div className="card pad"><div className="eyebrow">审查</div><div style={{ fontSize: 18, marginTop: 4 }}>{String(insights.data.reviews.total)}</div><div className="hint">完成 {String(insights.data.reviews.completed)} · 失败 {String(insights.data.reviews.failed)} · 待处理问题 {String(insights.data.reviews.openFindings)}</div><div className="hint">审查 tokens {formatCount(insights.data.reviews.tokens.total)}</div></div>
              <div className="card pad"><div className="eyebrow">修复</div><div style={{ fontSize: 18, marginTop: 4 }}>{String(insights.data.fixes.total)}</div><div className="hint">待提交 {String(insights.data.fixes.ready)} · 已放弃 {String(insights.data.fixes.discarded)}</div><div className="hint">修复 tokens {formatCount(insights.data.fixes.tokens.total)}</div></div>
              <div className="card pad"><div className="eyebrow">交付</div><div style={{ fontSize: 18, marginTop: 4 }}>{String(insights.data.deliveries.delivered)}</div><div className="hint">已交付 · 受阻 {String(insights.data.deliveries.blocked)} · 进行中 {String(insights.data.deliveries.inProgress)}</div></div>
            </div>
          </div>
        </section>
      )}
      {body}
    </div>
  );
}
