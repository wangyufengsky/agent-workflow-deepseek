import { Link } from 'react-router-dom';
import { PLANNING_STAGE_LABEL } from '@agent-workflow/shared';
import { useTasks } from '../../api/hooks.ts';
import { taskHref, deriveTaskStatus, taskNeedText } from '../../app/taskStatus.ts';
import { Badge } from '../../components/Badge.tsx';
import { Icon } from '../../components/Icon.tsx';
import { Skeleton } from '../../components/EmptyState.tsx';
import { ServiceNotice } from '../../components/ServiceNotice.tsx';
/** A single service-backed card, with one row per current task. The demo below remains illustrative. */
export function HomeOngoing() {
    const query = useTasks({ limit: 200 });
    const rows = (query.data ?? []).filter((task) => task.lifecycle === 'active' && (task.stage !== 'draft' || task.attention !== 'none')).slice(0, 3);
    return <section className="card in" style={{ margin: '0 0 28px', padding: 6 }} aria-label="进行中">
    <div className="row" style={{ padding: '10px 14px 6px' }}><span className="eyebrow grow">进行中</span><Link className="btn ghost sm" to="/tasks">全部任务<Icon name="chevRight" size="sm"/></Link></div>
    {query.isLoading ? <Skeleton height={64}/> : query.isError ? <ServiceNotice error={query.error} onRetry={() => { void query.refetch(); }}/> : rows.length === 0 ? <p className="hint" style={{ padding: 14 }}>当前没有进行中的任务</p> : rows.map((task) => {
            const view = deriveTaskStatus(task);
            return <Link className="list-row" key={task.id} to={`${taskHref(task)}?returnTo=%2F`}><span className="tile"><Icon name={view.icon}/></span><span className="grow" style={{ minWidth: 0 }}><span style={{ fontWeight: 500 }}>{task.title}</span><br /><span className="hint">{task.planning?.status === 'running' ? `规划中 · ${PLANNING_STAGE_LABEL[task.planning.stage]} · 最近活动 ${task.planning.lastActivity || '等待活动记录'} · 离开不会停止规划` : `${task.projectName} · ${taskNeedText(task) === '—' ? view.label : taskNeedText(task)}`}</span></span><Badge tone={view.tone} icon={view.icon}>{view.label}</Badge></Link>;
        })}
  </section>;
}
