import { RunPendingRecovery } from './RunCommands.tsx';
import { TemplateRunView } from './TemplateRunView.tsx';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import {
  ROUTES,
  type RunContentModel,
  EXECUTION_STATUS_LABEL,
  NODE_STATUS_LABEL,
  PLAN_REVISION_STATUS_LABEL,
  TASK_STAGE_LABEL,
  WORKSPACE_STATE_LABEL,
  type NodeStatusValue,
} from '@agent-workflow/shared';
import { apiGet, errorMessage, isApiClientError } from '../../api/client.ts';
import { fetchTaskChanges } from '../../api/git.ts';
import { useTaskDetail } from '../../api/workflow.ts';
import { formatAbsoluteTime, formatRelativeTime } from '../../app/format.ts';
import { Badge } from '../../components/Badge.tsx';
import { Button, LinkButton } from '../../components/Button.tsx';
import { PageHeader } from '../../components/Card.tsx';
import { EmptyState, Skeleton } from '../../components/EmptyState.tsx';
import { Icon } from '../../components/Icon.tsx';
import { ServiceNotice } from '../../components/ServiceNotice.tsx';
import { RunReader } from './RunReader.tsx';
import {
  CHANGE_STATUS_LABEL,
  NODE_KIND_LABEL,
  isTestPath,
  selectionKey,
  type RunNavItem,
  type RunNavSection,
  type RunSelection,
} from './run-shared.tsx';
import './run.css';

export function RunContentPage() {
  const { taskId = '' } = useParams<{ taskId: string }>();
  const taskDetail = useTaskDetail(taskId);
  const changesQuery = useQuery({
    queryKey: ['run', 'changes', taskId],
    queryFn: () => fetchTaskChanges(taskId),
    enabled: taskId !== '' && taskDetail.data !== undefined,
    retry: false,
  });
  const contentQuery = useQuery({ queryKey: ['run', 'content', taskId], refetchInterval: 5000, queryFn: async () => (await apiGet<RunContentModel>(ROUTES.taskRunContent(taskId))).data, enabled: taskId !== '', retry: false });
  const content = contentQuery.error ? undefined : contentQuery.data;
  const [selection, setSelection] = useState<RunSelection | null>(null);

  useEffect(() => {
    setSelection(null);
  }, [taskId]);

  const data = taskDetail.data;
  const task = data?.task;
  const plan = data?.plan;
  const execution = data?.execution;
  const changes = changesQuery.data;
  const nodes = plan?.graph.nodes ?? [];
  const coverage = plan?.validation?.requirementCoverage ?? [];
  const requirementEntries = task?.requirement.entries ?? [];
  const files = changes?.files ?? [];

  const coverageItems: RunNavItem[] =
    coverage.length > 0
      ? coverage.map((item) => {
          const entry = requirementEntries.find((candidate) => candidate.id === item.requirementId);
          return {
            key: `coverage:${item.requirementId}`,
            label: item.label === '' ? (entry?.text.slice(0, 42) ?? item.requirementId) : item.label,
            meta: `${item.covered ? '已覆盖' : '未覆盖'} · ${String(item.nodeIds.length)} 个节点`,
            icon: 'target' as const,
            selection: { kind: 'coverage' as const, requirementId: item.requirementId },
          };
        })
      : requirementEntries.map((entry) => ({
          key: `coverage:${entry.id}`,
          label: entry.text.slice(0, 42),
          meta: '服务未返回覆盖结论',
          icon: 'target' as const,
          selection: { kind: 'coverage' as const, requirementId: entry.id },
        }));

  const contentNodes = content?.groups.flatMap((group) => group.nodes) ?? [];
  const categoryNodes = (category: string) => contentNodes.filter((node) => node.category === category).map((node) => ({ id: node.nodeId }));
  const docNodes = [...categoryNodes('documents'), ...categoryNodes('other')];
  const implNodes = categoryNodes('source');
  const testNodes = categoryNodes('tests');
  const sourceFiles = files.filter((file) => !isTestPath(file.path));
  const testFiles = files.filter((file) => isTestPath(file.path));

  const nodeItem = (nodeId: string): RunNavItem | null => {
    const node = nodes.find((candidate) => candidate.id === nodeId);
    if (node === undefined) return null;
    const current = contentNodes.find((item) => item.nodeId === nodeId);
    const status = (current?.status ?? 'pending') as NodeStatusValue;
    return {
      key: `node:${nodeId}`,
      label: node.title,
      meta: `${NODE_KIND_LABEL[node.kind]} · ${NODE_STATUS_LABEL[status]} · ${current?.latestAttempt?.artifactCount ?? 0} 个产物`,
      icon: node.kind === 'test' ? 'shield' : node.kind === 'implementation' ? 'terminal' : 'file',
      selection: { kind: 'node', nodeId },
    };
  };
  const fileItem = (fileId: string): RunNavItem | null => {
    const file = files.find((candidate) => candidate.fileId === fileId);
    if (file === undefined) return null;
    return {
      key: `file:${fileId}`,
      label: file.path,
      meta: `${CHANGE_STATUS_LABEL[file.status]} · +${String(file.additions ?? 0)}/-${String(file.deletions ?? 0)}`,
      icon: 'file',
      selection: { kind: 'file', fileId },
    };
  };
  const compact = (items: readonly (RunNavItem | null)[]): readonly RunNavItem[] => items.filter((item): item is RunNavItem => item !== null);

  const sections: readonly RunNavSection[] = [
    {
      key: 'coverage',
      title: '需求覆盖',
      hint: coverage.length > 0 ? '覆盖结论来自计划校验（plan.validation.requirementCoverage）' : '服务未返回 requirementCoverage；这里只列需求正文，不推测覆盖结论',
      items: coverageItems,
    },
    {
      key: 'doc',
      title: '文档',
      hint: '文档步骤与实际提交的产物',
      items: compact(docNodes.map((node) => nodeItem(node.id))),
    },
    {
      key: 'source',
      title: '源码',
      hint: '实现节点 + 变更文件（非测试路径）；文件点击查看只读 diff',
      items: compact([
        ...implNodes.map((node) => nodeItem(node.id)),
        ...sourceFiles.map((file) => fileItem(file.fileId)),
      ]),
    },
    {
      key: 'test',
      title: '单元测试',
      hint: '测试节点 + 按路径名推导的测试文件（服务没有文件与测试节点的绑定字段）',
      items: compact([...testNodes.map((node) => nodeItem(node.id)), ...testFiles.map((file) => fileItem(file.fileId))]),
    },
  ];

  const firstSelection = sections.flatMap((section) => section.items)[0]?.selection;
  const activeSelection = selection ?? firstSelection;
  const activeKey = activeSelection === undefined ? null : selectionKey(activeSelection);

  const refresh = (): void => {
    void taskDetail.refetch();
    void contentQuery.refetch();
    if (taskDetail.data !== undefined) void changesQuery.refetch();
  };

  const backToCanvas = taskId === '' ? null : (
    <LinkButton variant="secondary" size="sm" icon="arrowLeft" to={`/tasks/${encodeURIComponent(taskId)}`}>
      回到执行画布
    </LinkButton>
  );

  if (taskId === '') {
    return (
      <div className="page">
        <PageHeader title="运行内容" lede="一次运行的只读内容阅读器。" actions={null} />
        <section className="card pad">
          <EmptyState
            icon="help"
            title="无法确认这次运行"
            description="链接里没有任务标识；本页不展示任何示例运行内容。请从任务列表或执行画布进入。"
            action={
              <LinkButton variant="primary" size="sm" icon="arrowLeft" to="/tasks">
                去任务列表
              </LinkButton>
            }
          />
        </section>
      </div>
    );
  }

  if (taskDetail.isLoading) {
    return (
      <div className="page">
        <PageHeader title="运行内容" lede="正在读取任务、计划与执行记录…" actions={backToCanvas} />
        <div className="card pad">
          <div className="col" style={{ gap: 12 }}>
            <Skeleton height={22} width="42%" />
            <Skeleton height={13} width="64%" />
            <Skeleton height={80} width="100%" radius={12} />
          </div>
        </div>
      </div>
    );
  }

  if (taskDetail.isError) {
    const notFound = isApiClientError(taskDetail.error) && taskDetail.error.code === 'NOT_FOUND';
    return (
      <div className="page">
        <PageHeader title="运行内容" lede="一次运行的只读内容阅读器。" actions={backToCanvas} />
        {notFound ? (
          <section className="card pad">
            <EmptyState
              icon="help"
              title="任务不存在或标识不一致"
              description="服务没有这个任务的记录；本页显示中性提示，不展示任何示例产物、也不提供操作。"
              action={
                <LinkButton variant="primary" size="sm" icon="arrowLeft" to="/tasks">
                  去任务列表
                </LinkButton>
              }
            />
          </section>
        ) : (
          <ServiceNotice
            error={taskDetail.error}
            onRetry={() => {
              void taskDetail.refetch();
    void contentQuery.refetch();
            }}
            title="运行内容读取失败"
          />
        )}
      </div>
    );
  }

  if (data === undefined || task === undefined) return null;

  if (task.fixedTemplate !== undefined) {
    if (contentQuery.error) return <div className="page"><PageHeader title="运行内容" actions={backToCanvas} /><RunPendingRecovery taskId={taskId} refresh={refresh} /><ServiceNotice error={contentQuery.error} onRetry={refresh} /></div>;
    if (content === undefined) return <div className="page"><PageHeader title="运行内容" actions={backToCanvas} /><section className="card pad"><Skeleton height={120} /></section></div>;
    if (content.taskId !== taskId || (execution !== undefined && content.executionId !== execution.id)) return <div className="page"><PageHeader title="运行身份无法确认" actions={backToCanvas} /><EmptyState title="运行标识不一致" description="没有展示任何产物或操作，请重新读取任务与运行快照。" action={<Button onClick={refresh}>重新读取</Button>} /></div>;
    if (content.specialized !== undefined) return <TemplateRunView key={taskId} taskId={taskId} detail={data} content={content} refresh={refresh} />;
    return <div className="page"><PageHeader title="模板运行内容未接通" actions={backToCanvas} /><EmptyState title="服务未提供模板阅读模型" description="此任务不会以通用节点列表冒充正式模板运行内容。" action={<Button onClick={refresh}>重新读取</Button>} /></div>;
  }

  const progress = execution?.progress;
  const totalSteps = progress?.total ?? nodes.length;
  const doneSteps = progress?.done ?? 0;
  const failedSteps = progress?.failed ?? 0;
  const runningSteps = progress?.running ?? 0;
  const coveredCount = coverage.filter((item) => item.covered).length;
  const executionLabel = execution === undefined ? '尚未开始执行' : (EXECUTION_STATUS_LABEL[execution.status] ?? execution.status);
  const changesLabel = changesQuery.isLoading
    ? '读取中…'
    : changesQuery.isError
      ? '读取失败'
      : changes === undefined
        ? '—'
        : `${String(files.length)} 个文件`;

  return (
    <div className="page">
      <PageHeader
        eyebrow={`任务 / ${task.title}`}
        title="运行内容"
        lede="从执行画布进入的一次运行只读阅读器：需求覆盖、步骤节点与输出、源码变更与测试。任务主入口仍是执行画布。"
        actions={
          <div className="row wrap" style={{ gap: 8 }}>
            <Badge tone="accent" icon="terminal">
              {executionLabel}
            </Badge>
            {backToCanvas}
            <Button
              variant="secondary"
              size="sm"
              icon="refresh"
              disabled={taskDetail.isFetching}
              disabledReason={taskDetail.isFetching ? '正在重新读取运行内容…' : undefined}
              onClick={refresh}
            >
              {taskDetail.isFetching ? '读取中…' : '刷新'}
            </Button>
          </div>
        }
      />

      <div className="banner info run-readonly">
        <Icon name="info" />
        <div className="grow">
          <b>只读运行内容</b>
          <br />
          按本次运行的实际步骤、执行尝试和产物分类阅读。文件产物保存提交时的内容，变更文件显示当前工作区差异。
        </div>
      </div>

      {contentQuery.isFetching ? <p role="status">正在读取运行内容…</p> : contentQuery.error ? <ServiceNotice error={contentQuery.error} onRetry={() => { void contentQuery.refetch(); }} /> : !content?.available ? <p>{content?.note ?? '运行内容尚未产生'}</p> : null}
      <div className="run-summary">
        <span>
          <Icon name="folder" size="sm" />
          {data.project.name}
        </span>
        <span>阶段：{TASK_STAGE_LABEL[task.stage] ?? task.stage}</span>
        <span>执行：{executionLabel}</span>
        <span>
          工作区：{data.workspace === undefined ? '未准备' : (WORKSPACE_STATE_LABEL[data.workspace.state] ?? data.workspace.state)}
        </span>
        <span>计划修订：{plan === undefined ? '无' : `r${String(plan.revisionNumber)} · ${PLAN_REVISION_STATUS_LABEL[plan.status] ?? plan.status}`}</span>
        <span>更新于 {formatRelativeTime(task.updatedAt)}（{formatAbsoluteTime(task.updatedAt)}）</span>
      </div>

      <div className="run-stats">
        <section className="card run-stat" aria-label="执行步骤">
          <span className="run-stat-k">执行步骤</span>
          <span className="run-stat-v">
            {String(doneSteps)} <small>/ {String(totalSteps)}</small>
          </span>
          <span className="run-stat-d">
            失败 {String(failedSteps)} · 执行中 {String(runningSteps)}
            {execution === undefined ? ' · 该任务还没有执行记录' : ''}
          </span>
        </section>
        <section className="card run-stat" aria-label="变更文件">
          <span className="run-stat-k">变更文件</span>
          <span className="run-stat-v">{changesLabel}</span>
          <span className="run-stat-d">
            {changes === undefined
              ? changesQuery.isError
                ? '服务返回错误，见下方提示'
                : '等待工作区变更数据'
              : `新增 ${String(changes.stats.added)} · 修改 ${String(changes.stats.modified)} · 删除 ${String(changes.stats.deleted)}`}
          </span>
        </section>
        <section className="card run-stat" aria-label="需求覆盖">
          <span className="run-stat-k">需求覆盖</span>
          <span className="run-stat-v">
            {coverage.length === 0 ? (
              '—'
            ) : (
              <>
                {String(coveredCount)} <small>/ {String(coverage.length)}</small>
              </>
            )}
          </span>
          <span className="run-stat-d">
            {coverage.length === 0
              ? '服务未返回 requirementCoverage（计划可能未校验或校验中）'
              : `覆盖 ${String(coveredCount)} · 未覆盖 ${String(coverage.length - coveredCount)}`}
          </span>
        </section>
      </div>

      {changesQuery.isError ? (
        <div className="banner warn" role="alert" style={{ marginTop: 12 }}>
          <Icon name="alert" />
          <div className="grow">
            <b>变更文件读取失败（节点内容仍可阅读）</b>
            <br />
            {errorMessage(changesQuery.error)}
            {isApiClientError(changesQuery.error) ? (
              <span className="mono" style={{ display: 'block', marginTop: 4, fontSize: 11.5, color: 'var(--muted)' }}>
                {changesQuery.error.code ?? '—'}
                {changesQuery.error.requestId === null ? '' : ` · ${changesQuery.error.requestId}`}
              </span>
            ) : null}
          </div>
          <div className="actions">
            <Button
              variant="secondary"
              size="sm"
              icon="refresh"
              onClick={() => {
                void changesQuery.refetch();
              }}
            >
              重试
            </Button>
          </div>
        </div>
      ) : null}

      {plan === undefined ? (
        <section className="card pad" style={{ marginTop: 16 }}>
          <EmptyState
            icon="flow"
            title="该任务还没有计划"
            description="运行内容需要计划图与执行记录。先生成并确认计划、准备并执行任务后，再回到本页阅读运行内容。"
            action={
              <LinkButton variant="secondary" size="sm" icon="arrowLeft" to={`/tasks/${encodeURIComponent(taskId)}`}>
                回到执行画布
              </LinkButton>
            }
          />
        </section>
      ) : (
        <div className="run-layout">
          <nav className="card run-nav" aria-label="运行内容导航">
            {sections.map((section) => (
              <div key={section.key} className="run-group">
                <div className="run-group-head">
                  <span>{section.title}</span>
                  <span className="num">{String(section.items.length)}</span>
                </div>
                <p className="hint run-group-hint">{section.hint}</p>
                {section.items.length === 0 ? (
                  <p className="hint run-group-empty">没有可读条目。</p>
                ) : (
                  section.items.map((item) => (
                    <button
                      key={item.key}
                      type="button"
                      className="run-navitem"
                      aria-current={activeKey === item.key ? 'true' : undefined}
                      onClick={() => {
                        setSelection(item.selection);
                      }}
                    >
                      <Icon name={item.icon} size="sm" />
                      <span className="grow" style={{ minWidth: 0 }}>
                        <span className="run-navitem-label">{item.label}</span>
                        <span className="hint run-navitem-meta">{item.meta}</span>
                      </span>
                    </button>
                  ))
                )}
              </div>
            ))}
          </nav>

          <section className="card run-reader" aria-label="只读内容">
            <div className="card-body">
              {activeSelection === undefined ? (
                <EmptyState
                  icon="terminal"
                  title="没有可读内容"
                  description="计划没有节点，也没有可读的需求或变更；本页不补造运行内容。"
                  compact
                />
              ) : (
                <RunReader
                  taskId={taskId}
                  task={task}
                  plan={plan}
                  execution={execution}
                  changes={changes}
                  changesError={changesQuery.isError ? changesQuery.error : undefined}
                  selection={activeSelection}
                  onSelectNode={(nodeId) => {
                    setSelection({ kind: 'node', nodeId });
                  }}
                />
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
