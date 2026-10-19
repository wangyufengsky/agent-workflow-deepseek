import { QualityEvidence } from './QualityEvidence.tsx';
import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ROUTES, aggregateTaskUsage, filterInsightsTasks, createRequestKey, type InsightsQuality, type TaskUsageView, type TaskAcceptanceResponse, type TaskSummary } from '@agent-workflow/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useBootstrap } from '../../api/hooks.ts';
import { apiGet, apiPost, errorMessage } from '../../api/client.ts';
import type { InsightsTaskAcceptanceResponse, InsightsTaskUsageResponse } from '@agent-workflow/shared';
import { formatCount, formatRelativeTime } from '../../app/format.ts';
import { deriveTaskStatus, sortByUpdatedDesc, taskHref, taskProgressText } from '../../app/taskStatus.ts';
import { Badge } from '../../components/Badge.tsx';
import { Button, LinkButton } from '../../components/Button.tsx';
import { PageHeader } from '../../components/Card.tsx';
import { EmptyState } from '../../components/EmptyState.tsx';
import { Icon } from '../../components/Icon.tsx';
import { SegmentedControl, type SegmentOption } from '../../components/SegmentedControl.tsx';
import { ServiceNotice } from '../../components/ServiceNotice.tsx';
import { StageCapsule } from '../../components/StageCapsule.tsx';

const qualityLabels: Record<InsightsQuality, string> = { passed: '质量通过', pending_acceptance: '待验收', pending_review: '待评审', issues: '存在问题' };
function Costs({ usage }: { readonly usage: Pick<TaskUsageView, 'costs' | 'unknownCostRecords'> | undefined }) {
  return usage === undefined ? <UnknownValue reason="正在读取成本或读取失败" /> : <>{usage.costs.length ? usage.costs.map((cost) => <div className="num" key={cost.currency} title={`${cost.currency} ${cost.amount}`}>{cost.currency} {cost.amount.toFixed(4)}</div>) : <UnknownValue reason="没有带记录币种的成本计量；不按当前模型价格推算" />}<div className="hint">{usage.unknownCostRecords} 条运行成本未知；不同币种不换算、不相加</div></>;
}
function Duration({ usage }: { readonly usage?: TaskUsageView }) { return <>{usage?.durationMs === undefined ? <UnknownValue reason="没有完整的运行起止时间" /> : <span className="num">{Math.round(usage.durationMs / 1000)} 秒</span>}<div className="hint">已记录运行时长之和{usage ? ` · ${usage.unknownDurationRecords} 条未知` : ''}</div></>; }

function UnknownValue({ reason }: { readonly reason: string }) {
  return (
    <Badge tone="unknown" icon="help" title={reason}>
      未知
    </Badge>
  );
}

function TaskDetail({ task, usage }: { readonly task: TaskSummary; readonly usage?: TaskUsageView }) {
  const status = deriveTaskStatus(task);
  const queryClient = useQueryClient();
  const [note, setNote] = useState('');
  const acceptanceQuery = useQuery({
    queryKey: ['task-acceptance', task.id],
    queryFn: async () => (await apiGet<TaskAcceptanceResponse>(ROUTES.taskAcceptance(task.id))).data,
    retry: false,
  });
  const decide = useMutation({
    mutationFn: async (verdict: 'accepted' | 'rejected') => {
      await apiPost(ROUTES.taskAcceptance(task.id), { requestKey: createRequestKey(), verdict, ...(note.trim() === '' ? {} : { note: note.trim() }), confirmDecide: true });
    },
    onSuccess: async () => {
      setNote('');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['task-acceptance', task.id] }),
        queryClient.invalidateQueries({ queryKey: ['insights', 'task-acceptance'] }),
        queryClient.invalidateQueries({ queryKey: ['insights', 'task-usage'] }),
      ]);
    },
  });
  const acceptance = acceptanceQuery.data?.acceptance;
  const canDecide = task.lifecycle === 'completed';
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
        <QualityEvidence evidence={usage?.qualityEvidence} />
        <div className="eyebrow" style={{ marginTop: 14, marginBottom: 8 }}>记录人工意见</div>
        {acceptanceQuery.isError ? (
          <p className="hint" style={{ color: 'var(--danger)' }}>读取人工验收失败：{errorMessage(acceptanceQuery.error)}</p>
        ) : acceptanceQuery.data === undefined ? <p className="hint">正在读取人工验收…</p> : acceptance === undefined ? (
          <div className="col" style={{ gap: 8 }}>
            <p className="hint">尚未人工验收。{canDecide ? '可以记录验收结论；结论只保存在本机。' : '任务完成后才能记录验收结论。'}</p>
            <textarea className="textarea" placeholder="验收备注（可选）" value={note} onChange={(event) => { setNote(event.target.value); }} />
            <div className="row" style={{ gap: 8 }}>
              <Button variant="primary" size="sm" icon="check" disabled={!canDecide || decide.isPending} disabledReason={canDecide ? undefined : '任务完成后才可验收'} onClick={() => { decide.mutate('accepted'); }}>验收通过</Button>
              <Button variant="ghost" size="sm" icon="x" disabled={!canDecide || decide.isPending} disabledReason={canDecide ? undefined : '任务完成后才可验收'} onClick={() => { decide.mutate('rejected'); }}>驳回</Button>
            </div>
          </div>
        ) : (
          <div className="col" style={{ gap: 6 }}>
            <div className="row" style={{ gap: 8 }}>
              <Badge tone={acceptance.verdict === 'accepted' ? 'ok' : 'wait'} icon={acceptance.verdict === 'accepted' ? 'check' : 'x'}>
                {acceptance.verdict === 'accepted' ? '人工验收通过' : '人工验收驳回'}
              </Badge>
              <span className="hint">{new Date(acceptance.decidedAt).toLocaleString('zh-CN')}</span>
            </div>
            {acceptance.note === undefined ? null : <p className="hint">{acceptance.note}</p>}
            <div className="row" style={{ gap: 8 }}>
              <Button variant="ghost" size="sm" icon="refresh" disabled={!canDecide || decide.isPending} onClick={() => { decide.mutate(acceptance.verdict === 'accepted' ? 'rejected' : 'accepted'); }}>改为{acceptance.verdict === 'accepted' ? '驳回' : '通过'}</Button>
            </div>
          </div>
        )}
        {decide.isError ? <p className="hint" style={{ color: 'var(--danger)', marginTop: 6 }}>记录失败：{errorMessage(decide.error)}</p> : null}
      </div>

      <div className="section">
        <div className="eyebrow" style={{ marginBottom: 8 }}>
          用量
        </div>
        <div className="grid-2" style={{ gap: 8 }}>
          <div className="card pad" style={{ padding: 12 }}>
            <div className="eyebrow">已记录 Tokens</div>
            <div style={{ marginTop: 4 }}>
              {usage?.tokens === undefined
                ? <UnknownValue reason="没有已记录 tokens；缺失不等于零" />
                : <span className="num" style={{ fontFamily: 'var(--font-display)', fontSize: 20 }}>{formatCount(usage.tokens)}</span>}
            </div>
            <div className="hint" style={{ marginTop: 4 }}>规划 / 执行 / 评审 / 修复实际计量{usage ? ` · ${usage.knownRecords} 条已记录 / ${usage.unknownRecords} 条未知` : ''}</div>
          </div>
          <div className="card pad" style={{ padding: 12 }}>
            <div className="eyebrow">成本</div>
            <div style={{ marginTop: 4 }}>
              <Costs usage={usage} />
            </div>
          </div>
          <div className="card pad" style={{ padding: 12 }}>
            <div className="eyebrow">耗时</div>
            <div style={{ marginTop: 4 }}>
              <Duration usage={usage} />
            </div>
          </div>
          <div className="card pad" style={{ padding: 12 }}>
            <div className="eyebrow">重试</div>
            <div style={{ marginTop: 4 }}>
              {usage === undefined ? <UnknownValue reason="读取失败或尚未读取" /> : <span>{usage.retries} 次执行重试</span>}
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
  const taskUsage = useQuery({ queryKey: ['insights', 'task-usage'], queryFn: async () => (await apiGet<InsightsTaskUsageResponse>(ROUTES.insightsTaskUsage)).data, retry: false });
  const taskAcceptance = useQuery({ queryKey: ['insights', 'task-acceptance'], queryFn: async () => (await apiGet<InsightsTaskAcceptanceResponse>(ROUTES.insightsTaskAcceptance)).data, retry: false });
  const acceptanceByTask = useMemo(() => new Map((taskAcceptance.data?.items ?? []).map((entry) => [entry.taskId, entry])), [taskAcceptance.data]);
  const usageByTask = useMemo(() => new Map((taskUsage.data?.usage ?? []).map((entry) => [entry.taskId, entry])), [taskUsage.data]);
  const [quality, setQuality] = useState<'all' | InsightsQuality>('all');
  const [projectId, setProjectId] = useState(''); const [status, setStatus] = useState('all'); const [includeArchived, setIncludeArchived] = useState(false);
  const [keyword, setKeyword] = useState(''); const [selectedId, setSelectedId] = useState<string | null>(null);
  const tasks = taskUsage.data?.tasks ?? [];
  const rows = sortByUpdatedDesc(filterInsightsTasks(tasks, taskUsage.data?.usage ?? [], { projectId, status, quality, includeArchived, keyword }));
  const summary = aggregateTaskUsage(rows.flatMap((task) => usageByTask.get(task.id) ? [usageByTask.get(task.id)!] : []));
  const selected = rows.find((task) => task.id === selectedId) ?? rows[0];
  const projects = [...new Map([...(bootstrap.data?.projects ?? []).map((project) => [project.id, project.name] as const), ...tasks.map((task) => [task.projectId, task.projectName] as const)]).entries()];
  const filterOptions: readonly SegmentOption<'all' | InsightsQuality>[] = [{ value: 'all', label: '全部质量' }, ...Object.entries(qualityLabels).map(([value, label]) => ({ value: value as InsightsQuality, label }))];
  const refresh = () => { void taskUsage.refetch(); void taskAcceptance.refetch(); void bootstrap.refetch(); };
  return <div className="page">
    <PageHeader title="质量与用量" lede="按任务核对消耗、验收与评审结果。汇总覆盖整个筛选范围，不只是已加载的行。" actions={<button type="button" className="icon-btn" aria-label="刷新统计" onClick={refresh}><Icon name="refresh" /></button>} />
    <div className="toolbar" style={{ flexWrap: 'wrap', gap: 10 }}>
      <div className="input-wrap" style={{ width: 240 }}><Icon name="search" /><input className="input ctl" placeholder="搜索任务标题" aria-label="搜索任务标题" value={keyword} onChange={(event) => setKeyword(event.target.value)} /></div>
      <select className="select ctl" aria-label="项目" value={projectId} onChange={(event) => setProjectId(event.target.value)}><option value="">全部项目</option>{projects.map(([id, name]) => <option key={id} value={id}>{name}{projects.filter(([, candidate]) => candidate === name).length > 1 ? ` · ${bootstrap.data?.projects.find((project) => project.id === id)?.rootPath ?? id}` : ''}</option>)}</select>
      <select className="select ctl" aria-label="任务状态" value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">全部状态</option><option value="active">进行中</option><option value="completed">已完成</option><option value="cancelled">已取消</option></select>
      <SegmentedControl ariaLabel="质量" options={filterOptions} value={quality} onChange={setQuality} /><span className="spacer" />
      <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={includeArchived} onChange={(event) => setIncludeArchived(event.target.checked)} />包含已归档</label>
    </div>
    {taskUsage.isError ? <ServiceNotice error={taskUsage.error} onRetry={refresh} /> : null}
    {taskUsage.isError && taskUsage.data ? <p className="hint">读取失败，下方保留上次成功读取的快照；筛选条件未改变，请重试更新。</p> : null}
    {taskUsage.isFetching && taskUsage.data ? <p className="hint">正在重新读取；下方为上次快照，筛选条件保持不变。</p> : null}
    <div className="grid-3" style={{ marginBottom: 16 }}>
      <div className="card pad"><div className="eyebrow">已记录用量</div><div className="num" style={{ fontSize: 22, marginTop: 6 }}>{summary.tokens === undefined ? <UnknownValue reason={taskUsage.isError ? '读取失败' : taskUsage.data ? '筛选范围没有已记录用量' : '正在读取用量'} /> : `${formatCount(summary.tokens)} Tokens`}</div><div className="hint">{summary.unknownRecords} 条运行用量未知，未计入；{summary.unknownTasks} 个任务没有计量</div></div>
      <div className="card pad"><div className="eyebrow">成本 · 按币种分列</div><div style={{ marginTop: 6 }}><Costs usage={taskUsage.data ? summary : undefined} /></div></div>
      <div className="card pad"><div className="eyebrow">有用量的任务</div><div className="num" style={{ fontSize: 22, marginTop: 6 }}>{summary.knownTasks} / {rows.length}</div><div className="hint">当前筛选范围全部 {rows.length} 个任务；全部任务共 {tasks.length} 个</div></div>
    </div>
    {taskUsage.data === undefined ? taskUsage.isError ? null : <p className="hint">正在读取任务与计量…</p> : rows.length === 0 ? <EmptyState icon="search" title="没有符合条件的任务" description="清除筛选后重试。" /> : <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 380px)', gap: 16, alignItems: 'start' }}>
      <section className="card" aria-label="质量与用量列表"><div style={{ overflowX: 'auto' }}><table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}><thead><tr>{['任务', '状态', '质量', 'Tokens', '耗时'].map((label) => <th key={label} style={{ padding: 12, textAlign: 'left', fontWeight: 400 }}>{label}</th>)}</tr></thead><tbody>
        {rows.map((task) => { const usage = usageByTask.get(task.id); const state = deriveTaskStatus(task); const acceptance = acceptanceByTask.get(task.id); return <tr key={task.id} aria-selected={selected?.id === task.id} tabIndex={0} onClick={() => setSelectedId(task.id)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelectedId(task.id); } }} style={{ cursor: 'pointer', boxShadow: 'inset 0 -1px 0 var(--line)', background: selected?.id === task.id ? 'var(--fill-2)' : undefined }}>
          <td style={{ padding: 12 }}><div>{task.title}{task.archivedAt ? ' · 已归档' : ''}</div><div className="hint">{task.projectName} · {task.methodName}</div></td>
          <td style={{ padding: 12 }}><Badge tone={state.tone} icon={state.icon}>{state.label}</Badge></td>
          <td style={{ padding: 12 }}>{usage ? <Badge tone={usage.quality === 'passed' ? 'ok' : usage.quality === 'issues' ? 'danger' : 'wait'} icon={usage.quality === 'passed' ? 'check' : 'help'}>{qualityLabels[usage.quality]}</Badge> : <UnknownValue reason="质量读取失败" />}<div className="hint">{acceptance ? `${acceptance.passed}/${acceptance.total} 节点成功；不是测试通过数` : '节点验收尚未读取或未执行'}</div></td>
          <td style={{ padding: 12 }}>{usage?.tokens === undefined ? <UnknownValue reason="没有已记录 tokens；缺失不等于零" /> : <span className="num">{formatCount(usage.tokens)}</span>}{usage?.unknownRecords ? <div className="hint">另有 {usage.unknownRecords} 条未知</div> : null}</td><td style={{ padding: 12 }}><Duration usage={usage} /></td>
        </tr>; })}
      </tbody></table></div><div className="hint" style={{ padding: 12 }}>质量通过依据当前执行已配置的真实验收和评审来源；未配置项不额外设门槛，人工意见不改写原结论；节点成功不替代测试证据。用量包含规划 / 执行 / 评审 / 修复。</div></section>
      {selected ? <TaskDetail key={selected.id} task={selected} usage={usageByTask.get(selected.id)} /> : null}
    </div>}
  </div>;
}
