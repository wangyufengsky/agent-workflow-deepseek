import { Link } from 'react-router-dom';
import { TASK_LIFECYCLE_LABEL, TASK_STAGE_LABEL } from '@agent-workflow/shared';
import type { WorkflowCatalogDetail } from './workflow-api.ts';
import { Badge } from '../../components/Badge.tsx';
import { formatRelativeTime } from '../../app/format.ts';

export function WorkflowReadDetails({ detail }: { readonly detail: WorkflowCatalogDetail }) {
  const summary = detail.planningSummary;
  return <>
    {detail.support !== 'ai_planning' ? null : <section style={{ marginTop: 18 }} aria-label="AI 规划详情">
      <div className="eyebrow" style={{ marginBottom: 8 }}>AI 规划 · 只读</div>
      <dl className="wf-planning-details">
        <dt>规划策略</dt><dd>{detail.planningStrategy === undefined ? '未绑定专用策略' : `${detail.planningStrategy.id} · ${detail.planningStrategy.version}`}</dd>
        <dt>规划职责</dt><dd>{summary?.role === undefined ? '职责详情暂不可用' : <Link to={`/roles?roleId=${encodeURIComponent(summary.role.id)}`}>{summary.role.name} · {summary.role.revision}</Link>}</dd>
        <dt>可细化</dt><dd>{detail.refinableGroups.length === 0 ? '无可细化分组' : detail.refinableGroups.join('、')}</dd>
        <dt>固定步骤</dt><dd>{detail.requiredSteps.filter((step) => !step.optional).map((step) => step.title).join(' → ') || '无'}</dd>
        <dt>当前上限</dt><dd>{summary === undefined ? '规划上限暂不可用' : `每轮派发 ≤ ${summary.limits.maxDrafts + summary.limits.maxRevisions}（初稿 ${summary.limits.maxDrafts} + 修订 ${summary.limits.maxRevisions}）· 自动传输重试 ${summary.limits.transportRetries} · 节点 ≤ ${summary.limits.maxNodes} · 边 ≤ ${summary.limits.maxEdges} · 分组 ≤ ${summary.limits.maxGroups} · 深度 ≤ ${summary.limits.maxDepth}`}</dd>
        <dt>策略摘要</dt><dd className="mono" style={{ overflowWrap: 'anywhere' }}>{summary?.policyHash ?? '摘要暂不可用'}</dd>
      </dl>
      <p className="hint" style={{ marginTop: 8 }}>目录显示当前配置；已有任务使用其冻结版本。具体派发上限以任务的规划预览为准。</p>
    </section>}
    <section style={{ marginTop: 18 }} aria-label="流程使用记录">
      <div className="row wrap" style={{ gap: 8 }}><div className="eyebrow">最近使用</div><span className="hint">{detail.usage === undefined ? '使用记录暂不可用' : `已用于 ${detail.usage.taskCount} 个任务 · 当前版本 ${detail.usage.currentRevisionTaskCount} 个（含归档）`}</span></div>
      {detail.usage?.taskCount === 0 ? <p className="hint">还没有任务使用这个流程。</p> : null}
      {detail.usage?.recentTasks.map((task) => <Link key={task.taskId} className="wf-recent-task" to={task.executionId === undefined ? `/requirement/${encodeURIComponent(task.taskId)}` : `/tasks/${encodeURIComponent(task.taskId)}`}>
        <span className="grow" style={{ minWidth: 0 }}><span className="ellipsis">{task.title}</span><span className="hint">{task.projectName} · {task.methodRevision} · {formatRelativeTime(task.createdAt)}</span></span>
        <Badge outline icon={task.lifecycle === 'completed' ? 'check' : task.lifecycle === 'cancelled' ? 'x' : 'clock'}>{task.lifecycle === 'active' ? TASK_STAGE_LABEL[task.stage] : TASK_LIFECYCLE_LABEL[task.lifecycle]}</Badge>
      </Link>)}
    </section>
  </>;
}
