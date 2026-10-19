import { useMemo, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  TASK_ATTENTION_LABEL,
  TaskAttention,
  createRequestKey,
  type RecoveryCreateRequest,
  type RecoveryCreateResponse,
  type RecoveryHistoryResponse,
  type TaskSummary,
} from '@agent-workflow/shared';
import { apiGet, apiPost, errorMessage, isServiceUnavailable } from '../../api/client.ts';
import { cancelExecution, resumeExecution, retryExecution, skipExecutionNode } from '../../api/workflow.ts';
import type { TaskDetailResponse } from '@agent-workflow/shared';
import { useBootstrap } from '../../api/hooks.ts';
import { formatRelativeTime } from '../../app/format.ts';
import { deriveTaskStatus, taskHref, taskProgressText } from '../../app/taskStatus.ts';
import { Badge } from '../../components/Badge.tsx';
import { Button, LinkButton } from '../../components/Button.tsx';
import { PageHeader } from '../../components/Card.tsx';
import { EmptyState } from '../../components/EmptyState.tsx';
import { Icon } from '../../components/Icon.tsx';
import { ServiceNotice } from '../../components/ServiceNotice.tsx';
import { StageCapsule } from '../../components/StageCapsule.tsx';

type RecoveryMode = 'from_failed_stage' | 'all_stages' | 'verify_only';

const MODES: readonly { readonly id: RecoveryMode; readonly title: string; readonly description: string; readonly permission: string }[] = [
  {
    id: 'from_failed_stage',
    title: '从失败阶段恢复',
    description: '复制失败阶段与后续阶段，保留既有上下文。',
    permission: '可执行修改',
  },
  {
    id: 'all_stages',
    title: '复制全部阶段',
    description: '从冻结任务设置复制完整阶段，按开始时冻结的设置重新来过。',
    permission: '可执行修改',
  },
  {
    id: 'verify_only',
    title: '只读验证',
    description: '复用已有产物核对结果，不执行文件修改。',
    permission: '只读验证',
  },
];

const RECOVERY_REQUIRES_TASK_REASON = '先从左侧选择一个需要恢复的任务，再创建派生草稿。';

function TaskContext({ task }: { readonly task: TaskSummary }) {
  const status = deriveTaskStatus(task);
  return (
    <section className="card solid" aria-label="失败上下文">
      <div className="card-head">
        <span className="tile">
          <Icon name="alert" />
        </span>
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="row wrap" style={{ gap: 8 }}>
            <span className="section-title">哪里失败了</span>
            <Badge tone={status.tone} icon={status.icon}>
              {status.label}
            </Badge>
          </div>
          <div className="hint" style={{ marginTop: 2 }}>
            原任务、执行证据与失败记录保持不变；恢复只生成派生草稿。
          </div>
        </div>
      </div>
      <div className="card-body">
        <div style={{ fontSize: 15, fontWeight: 500 }}>{task.title}</div>
        <p className="hint" style={{ marginTop: 6 }}>
          {task.projectName} · {task.methodName} · 更新 {formatRelativeTime(task.updatedAt)}
        </p>
        <div style={{ marginTop: 12 }}>
          <StageCapsule compact current={task.stage} lifecycle={task.lifecycle} attention={task.attention} />
        </div>
        <dl className="kv" style={{ gridTemplateColumns: '92px minmax(0,1fr)', fontSize: 12.5, marginTop: 16 }}>
          <dt>项目</dt>
          <dd>{task.projectName}</dd>
          <dt>阶段</dt>
          <dd>{status.label}</dd>
          <dt>执行进度</dt>
          <dd>{taskProgressText(task)}</dd>
          <dt>需要处理</dt>
          <dd>{TASK_ATTENTION_LABEL[task.attention] === '' ? '—' : TASK_ATTENTION_LABEL[task.attention]}</dd>
          <dt>任务</dt>
          <dd className="mono-wrap">{task.id}</dd>
        </dl>
        <div className="banner info" style={{ marginTop: 14 }}>
          <Icon name="info" />
          <div className="grow">
            失败原因、尝试次数与阶段明细来自任务画布；本页只读取任务摘要，不补写失败记录。
          </div>
        </div>
        <div className="row wrap" style={{ gap: 8, marginTop: 14 }}>
          <LinkButton to={taskHref(task)} variant="secondary" size="sm" icon="arrowLeft">
            返回原任务
          </LinkButton>
        </div>
      </div>
    </section>
  );
}

export function RecoveryPage() {
  const params = useParams<{ taskId?: string }>();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const bootstrap = useBootstrap();
  const [mode, setMode] = useState<RecoveryMode>('from_failed_stage');
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const [failure, setFailure] = useState<string | undefined>(undefined);

  const taskId = params.taskId ?? search.get('taskId') ?? '';
  const tasks = bootstrap.data?.tasks ?? [];
  const task = tasks.find((item) => item.id === taskId);
  const history = useQuery({
    queryKey: ['recovery', 'history', taskId],
    queryFn: async () => (await apiGet<RecoveryHistoryResponse>(`/api/tasks/${encodeURIComponent(taskId)}/recoveries`)).data,
    enabled: taskId.length > 0,
    retry: false,
  });
  const detail = useQuery({
    queryKey: ['recovery', 'detail', taskId],
    queryFn: async () => (await apiGet<TaskDetailResponse>(`/api/tasks/${encodeURIComponent(taskId)}/detail`)).data,
    enabled: taskId.length > 0,
    retry: false,
  });
  const executionNode = detail.data?.execution;
  const failedNodes = executionNode?.nodes.filter((node) => node.status === 'failed') ?? [];
  const [skipNodeId, setSkipNodeId] = useState('');
  const executionRecovery = useMutation({
    mutationFn: async (action: 'resume' | 'retry' | 'cancel' | 'skip') => {
      if (action === 'resume') return resumeExecution(taskId, executionNode?.status);
      if (action === 'retry') return retryExecution(taskId, executionNode?.status);
      if (action === 'skip') return skipExecutionNode(taskId, skipNodeId);
      return cancelExecution(taskId, executionNode?.status);
    },
    onSuccess: async (response) => {
      setFailure(undefined);
      setNotice(`执行命令回执：${response.receipt.status}`);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['recovery', 'detail', taskId] }),
        queryClient.invalidateQueries({ queryKey: ['bootstrap'] }),
      ]);
    },
    onError: (error) => {
      setNotice(undefined);
      setFailure(isServiceUnavailable(error) ? '服务未连接，命令未提交。' : errorMessage(error));
    },
  });
  const createRecovery = useMutation({
    mutationFn: async () => {
      const payload: RecoveryCreateRequest = { requestKey: createRequestKey(), mode, confirmCreate: true };
      return (await apiPost<RecoveryCreateResponse>(`/api/tasks/${encodeURIComponent(taskId)}/recovery`, payload)).data;
    },
    onSuccess: async (created) => {
      setFailure(undefined);
      setNotice(`已创建派生草稿：${created.task.title}`);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['bootstrap'] }),
        queryClient.invalidateQueries({ queryKey: ['recovery', 'history', taskId] }),
      ]);
      navigate(`/requirement/${created.task.id}`);
    },
    onError: (error) => {
      setNotice(undefined);
      setFailure(isServiceUnavailable(error) ? '服务未连接，未创建派生草稿。' : errorMessage(error));
    },
  });
  const candidates = useMemo(
    () => tasks.filter((item) => item.attention !== TaskAttention.NONE),
    [tasks],
  );

  let body: ReactNode;
  if (bootstrap.isLoading) {
    body = <p className="hint">正在读取恢复上下文…</p>;
  } else if (bootstrap.isError) {
    body = (
      <ServiceNotice
        error={bootstrap.error}
        onRetry={() => {
          void bootstrap.refetch();
        }}
      />
    );
  } else if (taskId.length > 0 && task === undefined) {
    body = (
      <div className="card">
        <EmptyState
          icon="search"
          title="没有可读取的父任务"
          description="这个恢复地址对应的任务不存在或已不可见。请返回任务列表核对。"
          action={
            <LinkButton to="/tasks" variant="secondary" size="sm" icon="arrowLeft">
              返回任务列表
            </LinkButton>
          }
        />
      </div>
    );
  } else if (taskId.length === 0) {
    body = (
      <div className="col" style={{ gap: 16 }}>
        <div className="banner info">
          <Icon name="info" />
          <div className="grow">
            <b>选择要恢复的任务</b>
            <br />
            只列出需要处理或已取消的任务；也可以从任务画布进入恢复页。
          </div>
        </div>
        {candidates.length === 0 ? (
          <div className="card">
            <EmptyState icon="check" title="没有需要恢复的任务" description="当前没有失败、受阻或待核对的任务。" />
          </div>
        ) : (
          <section className="card" aria-label="可恢复任务">
            <div className="list" style={{ padding: 6 }}>
              {candidates.map((item) => {
                const status = deriveTaskStatus(item);
                return (
                  <Link key={item.id} className="list-row" to={`/recovery?taskId=${encodeURIComponent(item.id)}`}>
                    <span className="tile">
                      <Icon name="alert" />
                    </span>
                    <span className="grow" style={{ minWidth: 0 }}>
                      <span style={{ display: 'block', fontSize: 13.5 }}>{item.title}</span>
                      <span className="hint" style={{ display: 'block', marginTop: 2 }}>
                        {item.projectName} · 更新 {formatRelativeTime(item.updatedAt)}
                      </span>
                    </span>
                    <Badge tone={status.tone} icon={status.icon}>
                      {status.label}
                    </Badge>
                    <Icon name="chevRight" size="sm" />
                  </Link>
                );
              })}
            </div>
          </section>
        )}
        <div className="card pad">
          <div className="section-title">恢复会做什么</div>
          <p className="hint" style={{ marginTop: 8, lineHeight: 1.7 }}>
            恢复只生成一个派生草稿，不会开始执行。原任务、执行证据和失败记录保持不变；创建前由服务端核对原任务已停止与权限。
          </p>
          <Button variant="primary" icon="layers" disabled disabledReason={RECOVERY_REQUIRES_TASK_REASON} style={{ marginTop: 12 }}>
            创建恢复草稿
          </Button>
        </div>
      </div>
    );
  } else if (task !== undefined) {
    body = (
      <div className="col" style={{ gap: 16 }}>
        <div className="grid-2" style={{ gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', alignItems: 'start' }}>
          <TaskContext task={task} />
          <section className="card solid" aria-label="恢复草稿设置">
            <div className="card-head">
              <span className="tile">
                <Icon name="layers" />
              </span>
              <div className="grow">
                <span className="section-title">怎样恢复</span>
                <div className="hint" style={{ marginTop: 2 }}>
                  新建派生草稿 · 当前页只读
                </div>
              </div>
            </div>
            <div className="card-body">
              <div className="banner info" style={{ marginBottom: 14 }}>
                <Icon name="info" />
                <div className="grow">
                  <b>只创建派生草稿</b>
                  <br />
                  原任务、执行证据与失败记录保持不变；草稿创建后在需求画布中重新规划。
                </div>
              </div>
              <div role="radiogroup" aria-label="恢复方式" className="col" style={{ gap: 10 }}>
                {MODES.map((item) => {
                  const checked = mode === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      role="radio"
                      aria-checked={checked}
                      className="card"
                      onClick={() => {
                        setMode(item.id);
                      }}
                      style={{
                        textAlign: 'left',
                        padding: 14,
                        borderColor: checked ? 'var(--accent-line)' : undefined,
                        background: checked ? 'var(--accent-fill)' : undefined,
                      }}
                    >
                      <span className="row wrap" style={{ gap: 8 }}>
                        <span className="grow" style={{ fontSize: 13.5, fontWeight: 500 }}>
                          {item.title}
                        </span>
                        <Badge tone={item.id === 'verify_only' ? 'idle' : 'accent'} icon={item.id === 'verify_only' ? 'eye' : 'edit'}>
                          {item.permission}
                        </Badge>
                      </span>
                      <span className="hint" style={{ display: 'block', marginTop: 4, lineHeight: 1.6 }}>
                        {item.description}
                      </span>
                      {checked ? (
                        <span className="hint" style={{ display: 'block', marginTop: 6 }}>
                          <Icon name="check" size="sm" /> 已选择（未提交）
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
              <p className="hint" style={{ marginTop: 14, lineHeight: 1.7 }}>
                <b>只创建草稿，不会开始执行。</b>草稿准备好后，到任务页单独开始；创建前由服务端核对原任务已停止、你有权限。
              </p>
              <Button variant="primary" icon="layers" disabled={createRecovery.isPending} onClick={() => createRecovery.mutate()} style={{ marginTop: 12 }}>
                {createRecovery.isPending ? '正在创建…' : '创建恢复草稿'}
              </Button>
              {failure === undefined ? null : <p className="hint" style={{ marginTop: 8, color: 'var(--danger)' }}>{failure}</p>}
              {notice === undefined ? null : <p className="hint" style={{ marginTop: 8 }}>{notice}</p>}
            </div>
          </section>
        </div>

        <section className="card solid" aria-label="执行恢复">
          <div className="card-head">
            <span className="tile"><Icon name="play" /></span>
            <div className="grow">
              <span className="section-title">执行恢复</span>
              <div className="hint" style={{ marginTop: 2 }}>
                {executionNode === undefined
                  ? '这个任务还没有执行记录；恢复草稿创建后重新规划即可。'
                  : `执行状态 ${executionNode.status} · 失败步骤 ${String(failedNodes.length)} 个`}
              </div>
            </div>
            {executionNode === undefined ? null : <Badge tone={executionNode.status === 'failed' ? 'fail' : executionNode.status === 'running' ? 'ok' : 'idle'}>{executionNode.status}</Badge>}
          </div>
          <div className="card-body">
            {executionNode === undefined ? (
              <p className="hint">没有可执行的恢复动作。</p>
            ) : (
              <>
                {failedNodes.length === 0 ? null : (
                  <ul className="hint" style={{ margin: '0 0 12px 18px', lineHeight: 1.7 }}>
                    {failedNodes.slice(0, 5).map((node) => (
                      <li key={node.nodeId}>{node.nodeId}{node.error === undefined ? '' : `：${node.error.message}`}</li>
                    ))}
                  </ul>
                )}
                <div className="row wrap" style={{ gap: 8 }}>
                  {executionNode.status === 'paused' ? (
                    <Button variant="secondary" size="sm" icon="play" disabled={executionRecovery.isPending} onClick={() => executionRecovery.mutate('resume')}>
                      继续执行
                    </Button>
                  ) : null}
                  {failedNodes.length > 0 && ['failed', 'stopped', 'paused'].includes(executionNode.status) ? (
                    <Button variant="primary" size="sm" icon="refresh" disabled={executionRecovery.isPending} onClick={() => executionRecovery.mutate('retry')}>
                      {executionRecovery.isPending ? '正在提交…' : `按原配置重试 ${String(failedNodes.length)} 个失败步骤`}
                    </Button>
                  ) : null}
                  {['running', 'paused'].includes(executionNode.status) ? (
                    <Button variant="secondary" size="sm" icon="stop" disabled={executionRecovery.isPending} onClick={() => executionRecovery.mutate('cancel')}>
                      停止执行（保留工作区）
                    </Button>
                  ) : null}
                </div>
                {['failed', 'stopped', 'paused'].includes(executionNode.status) ? (
                  <div className="row wrap" style={{ gap: 8, marginTop: 10 }}>
                    <select className="select" style={{ width: 'auto', height: 30 }} value={skipNodeId} onChange={(event) => { setSkipNodeId(event.target.value); }} aria-label="选择要跳过的节点">
                      <option value="">选择节点…</option>
                      {executionNode.nodes.filter((node) => ['pending', 'ready', 'failed'].includes(node.status)).map((node) => (
                        <option key={node.nodeId} value={node.nodeId}>{node.nodeId} · {node.status}</option>
                      ))}
                    </select>
                    <Button
                      variant="secondary"
                      size="sm"
                      icon="stop"
                      disabled={skipNodeId === '' || executionRecovery.isPending}
                      onClick={() => {
                        if (window.confirm('跳过该节点及其所有下游节点？已成功的节点不受影响，此操作不可撤销。')) executionRecovery.mutate('skip');
                      }}
                    >
                      跳过节点及下游
                    </Button>
                  </div>
                ) : null}
                {failure === undefined ? null : <p className="hint" style={{ marginTop: 8, color: 'var(--danger)' }}>{failure}</p>}
                {notice === undefined ? null : <p className="hint" style={{ marginTop: 8 }}>{notice}</p>}
                <p className="hint" style={{ marginTop: 10 }}>
                  重试会为失败步骤创建新的 attempt，按原计划与配置重新运行；不会改动已成功的步骤。
                </p>
              </>
            )}
          </div>
        </section>

        <section className="card solid" aria-label="派生草稿记录">
          <div className="card-head">
            <span className="tile">
              <Icon name="archive" />
            </span>
            <div className="grow">
              <span className="section-title">派生草稿</span>
              <div className="hint" style={{ marginTop: 2 }}>
                {history.data === undefined ? '读取中…' : history.data.recoveries.length === 0 ? '尚无派生草稿' : `${String(history.data.recoveries.length)} 个派生草稿`}
              </div>
            </div>
            <Badge tone={history.data === undefined ? 'idle' : 'neutral'} icon="archive">
              只读
            </Badge>
          </div>
          <div className="card-body">
            {history.data === undefined ? (
              <p className="hint">正在读取恢复记录…</p>
            ) : history.data.recoveries.length === 0 ? (
              <EmptyState compact icon="archive" title="还没有派生草稿" description="创建恢复草稿后，这里会列出派生任务；原任务保持不变。" />
            ) : (
              <div className="list" style={{ padding: 6 }}>
                {history.data.recoveries.map((record) => (
                  <Link key={record.taskId} className="list-row" to={`/tasks/${encodeURIComponent(record.taskId)}`}>
                    <span className="tile"><Icon name="layers" /></span>
                    <span className="grow" style={{ minWidth: 0 }}>
                      <span style={{ display: 'block', fontSize: 13.5 }}>{record.title}</span>
                      <span className="hint" style={{ display: 'block', marginTop: 2 }}>
                        {record.mode} · {new Date(record.createdAt).toLocaleString('zh-CN')}
                      </span>
                    </span>
                    <Badge tone="neutral">{record.stage}</Badge>
                    <Icon name="chevRight" size="sm" />
                  </Link>
                ))}
              </div>
            )}
          </div>
        </section>

        <div className="banner info">
          <Icon name="info" />
          <div className="grow">
            本页路径约定：<span className="mono">/recovery?taskId=…</span> 或 <span className="mono">/tasks/:taskId/recovery</span>。
            恢复只生成草稿，不会自动开始规划或执行。
          </div>
        </div>
      </div>
    );
  } else {
    body = null;
  }

  return (
    <div className="page">
      <PageHeader
        title="任务恢复"
        lede="为失败或受阻的任务创建派生草稿。原任务、执行证据和失败记录保持不变；恢复只创建草稿，不会自动开始。"
        actions={
          <LinkButton to="/tasks" variant="secondary" size="sm" icon="list">
            任务列表
          </LinkButton>
        }
      />
      {body}
    </div>
  );
}
