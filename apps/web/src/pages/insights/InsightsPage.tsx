import { QualityEvidence } from './QualityEvidence.tsx';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ROUTES, aggregateTaskUsage, filterInsightsTasks, createRequestKey, type InsightsQuality, type TaskUsageView, type TaskAcceptanceResponse, type TaskSummary } from '@agent-workflow/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useBootstrap } from '../../api/hooks.ts';
import { apiGet, apiPost, errorMessage } from '../../api/client.ts';
import type { InsightsTaskAcceptanceResponse, InsightsTaskUsageResponse } from '@agent-workflow/shared';
import { formatCount, formatDateTime, formatRelativeTime } from '../../app/format.ts';
import { deriveTaskStatus, sortByUpdatedDesc, taskHref, taskProgressText } from '../../app/taskStatus.ts';
import { Badge } from '../../components/Badge.tsx';
import { Button, LinkButton } from '../../components/Button.tsx';
import { PageHeader } from '../../components/Card.tsx';
import { EmptyState } from '../../components/EmptyState.tsx';
import { Icon } from '../../components/Icon.tsx';
import { SegmentedControl, type SegmentOption } from '../../components/SegmentedControl.tsx';
import { ServiceNotice } from '../../components/ServiceNotice.tsx';
import './insights.css';

const qualityLabels: Record<InsightsQuality, string> = { passed: '质量通过', pending_acceptance: '待验收', pending_review: '待评审', issues: '存在问题' };
const qualityTone: Record<InsightsQuality, 'ok' | 'wait' | 'danger'> = { passed: 'ok', pending_acceptance: 'wait', pending_review: 'wait', issues: 'danger' };

function UnknownValue({ reason }: { readonly reason: string }) {
  return (
    <Badge tone="unknown" icon="help" title={reason}>
      未知
    </Badge>
  );
}

function Costs({ usage }: { readonly usage: Pick<TaskUsageView, 'costs' | 'unknownCostRecords'> | undefined }) {
  if (usage === undefined) return <UnknownValue reason="正在读取成本或读取失败" />;
  return (
    <>
      {usage.costs.length ? (
        usage.costs.map((cost) => (
          <div className="num" key={cost.currency} title={`${cost.currency} ${cost.amount}`}>
            <span className="hint" style={{ marginRight: 4 }}>{cost.currency}</span>
            {cost.amount.toFixed(4)}
          </div>
        ))
      ) : (
        <UnknownValue reason="没有带记录币种的成本计量；不按当前模型价格推算" />
      )}
      <div className="hint">{usage.unknownCostRecords} 条运行成本未知；不同币种不换算、不相加</div>
    </>
  );
}

function Duration({ usage }: { readonly usage?: TaskUsageView }) {
  return (
    <>
      {usage?.durationMs === undefined ? <UnknownValue reason="没有完整的运行起止时间" /> : <span className="num">{Math.round(usage.durationMs / 1000)} 秒</span>}
      <div className="hint">已记录运行时长之和{usage ? ` · ${usage.unknownDurationRecords} 条未知` : ''}</div>
    </>
  );
}

/** P15-04: while the read model is unknown (first load or failed read), never render a real zero. */
function SummaryTiles({ loaded, failed, summary, rowCount, taskCount, snapshotAt }: {
  readonly loaded: boolean;
  readonly failed: boolean;
  readonly summary: ReturnType<typeof aggregateTaskUsage>;
  readonly rowCount: number;
  readonly taskCount: number;
  readonly snapshotAt: string | undefined;
}) {
  const unknownReason = failed ? '读取失败：数量未知，不代表 0' : '正在读取：数量未知，不代表 0';
  return (
    <div className="insights-tiles">
      <div className="card pad insights-tile">
        <div className="eyebrow">已记录用量</div>
        <div className="num" style={{ fontSize: 22, marginTop: 6 }}>
          {!loaded ? <UnknownValue reason={unknownReason} /> : summary.tokens === undefined ? <UnknownValue reason="筛选范围没有已记录用量" /> : <>{formatCount(summary.tokens)}<span className="hint" style={{ marginLeft: 6 }}>Tokens</span></>}
        </div>
        <div className="hint">{loaded ? `${summary.unknownRecords} 条运行用量未知，未计入；${summary.unknownTasks} 个任务没有计量` : unknownReason}</div>
      </div>
      <div className="card pad">
        <div className="eyebrow">成本 · 按币种分列</div>
        <div style={{ marginTop: 6 }}>
          {loaded ? <Costs usage={summary} /> : <UnknownValue reason={unknownReason} />}
        </div>
      </div>
      <div className="card pad">
        <div className="eyebrow">有用量的任务</div>
        <div className="num" style={{ fontSize: 22, marginTop: 6 }}>
          {!loaded ? (
            <UnknownValue reason={unknownReason} />
          ) : (
            <>
              {summary.knownTasks}
              <span className="hint" style={{ marginLeft: 6 }}>/ 已加载 {rowCount} 个</span>
            </>
          )}
        </div>
        <div className="hint">{loaded ? `汇总与表格来自同一次全量读取（已加载即筛选范围内全部 ${rowCount} 个任务；共 ${taskCount} 个）；服务无分页/“加载更多”` : unknownReason}</div>
        {snapshotAt === undefined || !loaded ? null : <div className="hint">快照 {formatDateTime(snapshotAt)}</div>}
      </div>
    </div>
  );
}

function TaskDetail({ task, usage, acceptanceLoadingError, onClose }: {
  readonly task: TaskSummary;
  readonly usage?: TaskUsageView;
  readonly acceptanceLoadingError: boolean;
  readonly onClose: () => void;
}) {
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
    <aside className="card solid" aria-label="任务明细" style={{ padding: 0, position: 'sticky', top: 24 }}>
      <div className="row" style={{ padding: '18px 16px 0 20px', alignItems: 'flex-start' }}>
        <div className="grow">
          <div className="row wrap" style={{ gap: 6 }}>
            <Badge tone={status.tone} icon={status.icon}>{status.label}</Badge>
            <Badge title="质量结论来自真实验收与评审来源" tone={usage === undefined ? 'unknown' : qualityTone[usage.quality]} icon={usage === undefined ? 'help' : usage.quality === 'passed' ? 'check' : 'help'}>
              {usage === undefined ? '质量未知' : qualityLabels[usage.quality]}
            </Badge>
            <span className="hint">更新 {formatRelativeTime(task.updatedAt)}</span>
          </div>
          <h2 style={{ fontSize: 17, fontWeight: 500, marginTop: 10 }}>{task.title}</h2>
          <p className="hint" style={{ marginTop: 4 }}>{task.projectName} · {task.methodName} · {taskProgressText(task)}</p>
        </div>
        <button type="button" className="icon-btn" aria-label="关闭明细" onClick={onClose}><Icon name="x" /></button>
      </div>

      <div style={{ padding: '16px 20px' }}>
        <div className="eyebrow" style={{ marginBottom: 8 }}>验收与评审</div>
        {acceptanceLoadingError ? (
          <p className="hint" role="note" style={{ color: 'var(--danger)' }}>
            节点验收汇总读取失败；这不等于“未执行验收”，也不改变上方质量结论。
          </p>
        ) : null}
        <QualityEvidence evidence={usage?.qualityEvidence} />
        <div className="eyebrow" style={{ marginTop: 14, marginBottom: 8 }}>记录人工意见（扩展）</div>
        {acceptanceQuery.isError ? (
          <p className="hint" role="alert" style={{ color: 'var(--danger)' }}>读取人工验收失败：{errorMessage(acceptanceQuery.error)}</p>
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

      <div style={{ padding: '0 20px 16px' }}>
        <div className="eyebrow" style={{ marginBottom: 8 }}>用量</div>
        <div className="insights-mini">
          <div>
            <div className="k">已记录 Tokens</div>
            <div className="v">{usage?.tokens === undefined ? <UnknownValue reason="没有已记录 tokens；缺失不等于零" /> : formatCount(usage.tokens)}</div>
          </div>
          <div>
            <div className="k">未知记录</div>
            <div className="v">{usage === undefined ? <UnknownValue reason="读取失败或尚未读取" /> : `${usage.unknownRecords} 条`}</div>
          </div>
          <div>
            <div className="k">耗时</div>
            <div className="v">{usage?.durationMs === undefined ? <UnknownValue reason="没有完整的运行起止时间" /> : `${Math.round(usage.durationMs / 1000)} 秒`}</div>
          </div>
          <div>
            <div className="k">重试</div>
            <div className="v">{usage === undefined ? <UnknownValue reason="读取失败或尚未读取" /> : `${usage.retries} 次`}</div>
          </div>
        </div>
        <div className="row" style={{ marginTop: 10, fontSize: 13 }}>
          <span className="muted">成本</span>
          <span className="grow num" style={{ textAlign: 'right' }}>
            {usage === undefined
              ? <UnknownValue reason="读取失败或尚未读取" />
              : usage.costs.length === 0
                ? <UnknownValue reason="没有带币种的成本计量；不按当前模型价格推算" />
                : usage.costs.map((cost) => `${cost.currency} ${cost.amount.toFixed(4)}`).join(' · ')}
          </span>
        </div>
        <div className="hint" style={{ marginTop: 4 }}>不同币种不换算、不相加；成本只取真实计量记录。</div>
      </div>

      <div style={{ padding: '14px 20px 18px', boxShadow: 'inset 0 1px 0 var(--line)' }}>
        <LinkButton to={taskHref(task)} variant="secondary" icon="eye" className="btn-block">
          查看任务评审
        </LinkButton>
        <div className="row" style={{ gap: 8, marginTop: 8 }}>
          <Link className="btn ghost sm" to="/tasks"><Icon name="list" size="sm" />任务列表</Link>
        </div>
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
  const [projectId, setProjectId] = useState('');
  const [status, setStatus] = useState('all');
  const [includeArchived, setIncludeArchived] = useState(false);
  const [keyword, setKeyword] = useState('');
  // P15-01: undefined = design 默认选中第一行(content)，null = 关闭明细(list)，string = 指定行。
  const [selection, setSelection] = useState<string | null | undefined>(undefined);
  const tasks = taskUsage.data?.tasks ?? [];
  const loaded = taskUsage.data !== undefined;
  const rows = sortByUpdatedDesc(filterInsightsTasks(tasks, taskUsage.data?.usage ?? [], { projectId, status, quality, includeArchived, keyword }));
  const summary = aggregateTaskUsage(rows.flatMap((task) => usageByTask.get(task.id) ? [usageByTask.get(task.id)!] : []));
  const selected = selection === null ? undefined : selection === undefined ? rows[0] : rows.find((task) => task.id === selection) ?? rows[0];
  const maxTokens = rows.reduce((max, task) => Math.max(max, usageByTask.get(task.id)?.tokens ?? 0), 0);
  const projects = [...new Map([...(bootstrap.data?.projects ?? []).map((project) => [project.id, project.name] as const), ...tasks.map((task) => [task.projectId, task.projectName] as const)]).entries()];
  const filterOptions: readonly SegmentOption<'all' | InsightsQuality>[] = [{ value: 'all', label: '全部质量' }, ...Object.entries(qualityLabels).map(([value, label]) => ({ value: value as InsightsQuality, label }))];
  const refresh = () => { void taskUsage.refetch(); void taskAcceptance.refetch(); void bootstrap.refetch(); };
  const showTable = loaded && rows.length > 0;
  return (
    <div className="page wide">
      <PageHeader title="质量与用量" lede="按任务核对消耗、验收与评审结果。汇总覆盖整个筛选范围，不只是已加载的行。" actions={<button type="button" className="icon-btn" aria-label="刷新统计" onClick={refresh}><Icon name="refresh" /></button>} />
      <div className="toolbar" style={{ flexWrap: 'wrap', gap: 10 }}>
        <div className="input-wrap" style={{ width: 240 }}><Icon name="search" /><input className="input ctl" placeholder="搜索任务标题" aria-label="搜索任务标题" value={keyword} onChange={(event) => setKeyword(event.target.value)} /></div>
        <select className="select ctl" aria-label="项目" value={projectId} onChange={(event) => setProjectId(event.target.value)}><option value="">全部项目</option>{projects.map(([id, name]) => <option key={id} value={id}>{name}{projects.filter(([, candidate]) => candidate === name).length > 1 ? ` · ${bootstrap.data?.projects.find((project) => project.id === id)?.rootPath ?? id}` : ''}</option>)}</select>
        <select className="select ctl" aria-label="任务状态" value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">全部状态</option><option value="active">进行中</option><option value="completed">已完成</option><option value="cancelled">已取消</option></select>
        <SegmentedControl ariaLabel="质量" options={filterOptions} value={quality} onChange={setQuality} /><span className="spacer" />
        <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={includeArchived} onChange={(event) => setIncludeArchived(event.target.checked)} />包含已归档</label>
      </div>
      {taskUsage.isError ? <ServiceNotice error={taskUsage.error} onRetry={refresh} /> : null}
      {taskUsage.isError && loaded ? <p className="hint">读取失败，下方保留上次成功读取的快照；筛选条件未改变，请重试更新。</p> : null}
      {taskUsage.isFetching && loaded ? <p className="hint">正在重新读取；下方为上次快照，筛选条件保持不变。</p> : null}
      <SummaryTiles
        loaded={loaded}
        failed={taskUsage.isError}
        summary={summary}
        rowCount={rows.length}
        taskCount={tasks.length}
        snapshotAt={taskUsage.dataUpdatedAt === 0 ? undefined : new Date(taskUsage.dataUpdatedAt).toISOString()}
      />
      {showTable ? (
        <div className={selected === undefined ? 'insights-layout no' : 'insights-layout'}>
          <section className="card" aria-label="质量与用量列表">
            <div style={{ overflowX: 'auto' }}>
              <table className="insights-table">
                <thead><tr>{['任务', '状态', '质量', 'Tokens', '耗时'].map((label, index) => <th key={label} className={index >= 3 ? 'n' : undefined}>{label}</th>)}</tr></thead>
                <tbody>
                  {rows.map((task) => {
                    const usage = usageByTask.get(task.id);
                    const state = deriveTaskStatus(task);
                    const acceptance = acceptanceByTask.get(task.id);
                    const tokens = usage?.tokens;
                    const barWidth = tokens === undefined || maxTokens <= 0 ? 0 : Math.max(4, Math.round((tokens / maxTokens) * 80));
                    return (
                      <tr
                        key={task.id}
                        aria-selected={selected?.id === task.id}
                        tabIndex={0}
                        onClick={() => setSelection(task.id)}
                        onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelection(task.id); } }}
                      >
                        <td><div style={{ fontWeight: 500 }}>{task.title}{task.archivedAt ? ' · 已归档' : ''}</div><div className="hint">{task.projectName} · {task.methodName}</div></td>
                        <td><Badge tone={state.tone} icon={state.icon}>{state.label}</Badge></td>
                        <td>
                          {usage ? <Badge tone={qualityTone[usage.quality]} icon={usage.quality === 'passed' ? 'check' : 'help'}>{qualityLabels[usage.quality]}</Badge> : <UnknownValue reason="质量读取失败" />}
                          <div className="hint">{acceptance ? `${acceptance.passed}/${acceptance.total} 节点成功；不是测试通过数` : taskAcceptance.isError ? '节点验收读取失败（不是未执行）' : '节点验收尚未读取或未执行'}</div>
                        </td>
                        <td className="n">
                          {tokens === undefined ? <UnknownValue reason="没有已记录 tokens；缺失不等于零" /> : (
                            <div className="insights-tbar">
                              <i style={{ width: barWidth }} />
                              <span className="num">{formatCount(tokens)}</span>
                            </div>
                          )}
                          {usage?.unknownRecords ? <div className="hint">另有 {usage.unknownRecords} 条未知</div> : null}
                        </td>
                        <td className="n"><Duration usage={usage} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="insights-foot">
              <span className="hint grow">
                已加载 {rows.length} 个任务 · 汇总与表格来自同一次全量读取
                {taskUsage.dataUpdatedAt === 0 ? '' : ` · ${formatDateTime(new Date(taskUsage.dataUpdatedAt).toISOString())} 快照`}
                ；服务一次返回筛选范围内全量任务，没有“加载更多”分页。
              </span>
            </div>
          </section>
          {selected === undefined ? null : (
            <TaskDetail
              key={selected.id}
              task={selected}
              usage={usageByTask.get(selected.id)}
              acceptanceLoadingError={taskAcceptance.isError}
              onClose={() => setSelection(null)}
            />
          )}
        </div>
      ) : null}
      {!loaded ? (
        taskUsage.isError ? (
          <section className="card" style={{ padding: 16 }}>
            <div className="banner danger" role="alert">
              <Icon name="alert" />
              <div className="grow"><b>读取失败</b><br />任务与用量数量暂时未知，不代表 0；不会用空数据冒充真实零。上一次结果若存在会保留在下方之前快照中，筛选条件未改变。</div>
              <div className="actions"><Button variant="secondary" size="sm" icon="refresh" onClick={refresh}>重试</Button></div>
            </div>
          </section>
        ) : (
          <section className="card" aria-label="质量与用量加载中" style={{ padding: 14 }}>
            {[0, 1, 2, 3].map((row) => (
              <div key={row} className="insights-skel" style={{ height: 14, margin: '14px 0', width: `${String([92, 80, 88, 76][row] ?? 90)}%` }} />
            ))}
            <p className="hint">正在读取任务与计量…</p>
          </section>
        )
      ) : rows.length === 0 ? (
        <section className="card" style={{ padding: 8 }}>
          <EmptyState icon="search" title="没有符合条件的任务" description="清除筛选后重试。" />
        </section>
      ) : null}
    </div>
  );
}
