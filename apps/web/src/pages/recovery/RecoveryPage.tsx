import { useMemo, useState, useSyncExternalStore, useEffect, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import {
  ROUTES,
  type RecoveryPreview,
  type CommandResponse,
  type OperationsByKeyResponse,
  type OperationReceipt,
  NODE_STATUS_LABEL,
  type ExecutionView,
  EXECUTION_STATUS_LABEL,
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
import { Modal } from '../../components/Modal.tsx';
import { pendingCommands, subscribePending } from '../../api/pending-commands.ts';
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

function TaskContext({ task, execution, stages }: { readonly task: TaskSummary; readonly execution?: ExecutionView; readonly stages?: RecoveryPreview['stages'] }) {
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
            原任务、执行证据与失败记录保持不变；恢复复制冻结阶段和独立工作区快照，等待确认。
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
          <dd>{execution?`${execution.nodes.filter(node=>node.status==='succeeded').length} / ${execution.nodes.length} 步`:taskProgressText(task)}</dd>
          <dt>需要处理</dt>
          <dd>{TASK_ATTENTION_LABEL[task.attention] === '' ? '—' : TASK_ATTENTION_LABEL[task.attention]}</dd>
          <dt>任务</dt>
          <dd className="mono-wrap">{task.id}</dd>
        </dl>
        <div className="banner info" style={{ marginTop: 14 }}>
          <Icon name="info" />
          <div className="grow">
            本页只读原任务；恢复不会改写原执行与证据。
          </div>
        </div>
        {stages?.length?<section aria-label="原任务阶段" style={{marginTop:14}}>{stages.map(stage=><div className="row wrap" key={stage.id} style={{padding:'8px 0'}}><span className="grow">{stage.title}</span><Badge icon={stage.status==='failed'?'alert':stage.status==='succeeded'?'check':'clock'} tone={stage.status==='failed'?'fail':stage.status==='succeeded'?'done':'idle'}>{NODE_STATUS_LABEL[stage.status as keyof typeof NODE_STATUS_LABEL]??stage.status}</Badge></div>)}</section>:null}
        {execution?.nodes.filter(node=>node.error).map(node=><p key={node.nodeId} className="hint" role="note">{node.nodeId}：{node.error?.message}</p>)}
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
  const [search,setSearch] = useSearchParams();
  const queryClient = useQueryClient();
  const bootstrap = useBootstrap();
  const mode:RecoveryMode=MODES.some(item=>item.id===search.get('mode'))?search.get('mode') as RecoveryMode:'from_failed_stage';
  const setMode=(value:RecoveryMode)=>{const next=new URLSearchParams(search);next.set('mode',value);setSearch(next);};
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
  const skippableNodes = executionNode?.nodes.filter((node) => ['pending', 'ready', 'failed'].includes(node.status)) ?? [];
  const executionStatus = executionNode?.status;
  const unknownExecution = executionStatus === 'unknown';
  const retryAction = detail.data?.capabilities.retryExecution;
  const resumeAction = detail.data?.capabilities.resumeExecution;
  const [skipNodeId, setSkipNodeId] = useState('');
  const executionRecovery = useMutation({
    mutationFn: async (action: 'resume' | 'retry' | 'cancel' | 'skip') => {
      if (action === 'resume') return resumeExecution(taskId, executionNode?.status);
      if (action === 'retry') return retryExecution(taskId, executionNode?.status);
      if (action === 'skip') return skipExecutionNode(taskId, skipNodeId);
      return cancelExecution(taskId, executionNode?.status);
    },
    onSuccess: async (response) => {
      const receipt = response.receipt;
      if (receipt.status === 'succeeded') {
        setFailure(undefined);
        setNotice(`执行命令已生效：回执 ${receipt.status} · 请求号 ${receipt.requestKey}`);
      } else if (receipt.status === 'failed') {
        setNotice(undefined);
        setFailure(receipt.error?.message ?? '服务返回失败回执，命令没有生效。');
      } else {
        setFailure(undefined);
        setNotice(`执行命令回执 ${receipt.status}：结果待核对，不会自动重发；请按请求号 ${receipt.requestKey} 核对或重新读取执行状态。`);
      }
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
  const [confirm,setConfirm]=useState(false);
  const [receipt,setReceipt]=useState<OperationReceipt>();
  const [createdTaskId,setCreatedTaskId]=useState<string>();
  useEffect(()=>{setConfirm(false);setReceipt(undefined);setCreatedTaskId(undefined);setFailure(undefined);setNotice(undefined);},[taskId]);
  const pendingIdentity=useSyncExternalStore(subscribePending,()=>pendingCommands().filter(item=>item.path===ROUTES.taskRecovery(taskId)).map(item=>item.requestKey).join(','),()=> '');
  const pendingKey=pendingIdentity.split(',').filter(Boolean)[0];
  const preview=useQuery({queryKey:['recovery','preview',taskId,mode],queryFn:async()=>(await apiGet<RecoveryPreview>(`${ROUTES.taskRecoveryPreview(taskId)}?mode=${mode}`)).data,enabled:taskId.length>0,retry:false});
  const refreshRecovery=async()=>{await Promise.all([queryClient.invalidateQueries({queryKey:['bootstrap']}),queryClient.invalidateQueries({queryKey:['recovery','history',taskId]}),queryClient.invalidateQueries({queryKey:['recovery','preview',taskId]})]);};
  const verifyOriginal=async()=>{if(!pendingKey&&!receipt)return;try{const response=await apiGet<OperationsByKeyResponse>(ROUTES.operationsByKey(pendingKey??receipt!.requestKey));const record=response.data.operation;setReceipt(record);if(record.status==='succeeded'){setCreatedTaskId(typeof record.outcome?.taskId==='string'?record.outcome.taskId:undefined);setNotice('恢复草稿已创建，未开始执行');}else if(record.status==='failed')setFailure(record.error?.message??'恢复创建失败');else setNotice('原恢复结果尚未结清；只核对原请求，不自动重发。');await refreshRecovery();}catch(error){setFailure(errorMessage(error));}};
  const createRecovery=useMutation({
    mutationFn:async()=>{if(!preview.data?.allowed)throw new Error(preview.data?.reason??'请先读取恢复差异');const payload:RecoveryCreateRequest={requestKey:createRequestKey(),mode,expectedSourceRevision:preview.data.sourceRevision,confirmCreate:true};return(await apiPost<CommandResponse<RecoveryCreateResponse>>(ROUTES.taskRecovery(taskId),payload)).data;},
    onSuccess:async(created)=>{setConfirm(false);setReceipt(created.receipt);setFailure(undefined);if(created.receipt.status==='succeeded'&&created.resource){setCreatedTaskId(created.resource.task.id);setNotice('恢复草稿已创建，未开始执行；请打开草稿审阅确认。');}else setNotice('恢复请求已受理，结果以原请求回执为准；不会自动重发。');await refreshRecovery();},
    onError:async(error)=>{setConfirm(false);setNotice(undefined);setFailure(errorMessage(error));await preview.refetch();},
  });
  const createBlocked=createRecovery.isPending||Boolean(pendingKey)||!preview.data?.allowed||preview.isFetching||preview.isError||detail.isLoading||detail.isError;
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
          <TaskContext task={task} execution={executionNode} stages={preview.data?.stages} />
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
                  原任务、执行证据与失败记录保持不变；草稿复制已有冻结计划；请审阅确认后再开始。
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
                      disabled={createRecovery.isPending || Boolean(pendingKey)}
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
              <section aria-label="恢复差异预览" className="card pad" style={{marginTop:14}}>
                <b>恢复差异预览</b>{preview.isError?<ServiceNotice error={preview.error} onRetry={()=>void preview.refetch()}/>:preview.isLoading?<p>正在读取冻结阶段与工作区…</p>:preview.data?<><p className="hint">来源冻结计划：{preview.data.sourcePlanId??'无冻结计划'} · {preview.data.workspace}</p>{preview.data.stages.map(stage=><div className="row wrap" key={stage.id}><span className="grow">{stage.title}</span><Badge icon={stage.action==='verify'?'eye':stage.action==='copy'?'layers':'lock'} tone={stage.action==='copy'?'accent':'idle'}>{stage.action==='copy'?'复制到草稿':stage.action==='verify'?'只核对，不修改':'只保留既有上下文'}</Badge><span>{NODE_STATUS_LABEL[stage.status as keyof typeof NODE_STATUS_LABEL]??stage.status}</span></div>)}{!preview.data.allowed?<p role="alert">{preview.data.reason}</p>:null}</>:null}
              </section>
              {pendingKey?<div className="banner unknown"><Icon name="help"/><div>原恢复操作尚未结清，请先核对。<br/>原请求号 {pendingKey}</div><Button onClick={()=>void verifyOriginal()}>核对原操作</Button></div>:null}
              {receipt?<p role="status">原请求号 {receipt.requestKey} · {receipt.status}</p>:null}
              {createdTaskId?<LinkButton to={`/tasks/${encodeURIComponent(createdTaskId)}`} icon="arrowRight">打开草稿</LinkButton>:null}
              <Button variant="primary" icon="layers" disabled={createBlocked} disabledReason={pendingKey?'原恢复结果待核对':preview.data?.reason??'先读取完整恢复差异'} onClick={() => setConfirm(true)} style={{ marginTop: 12 }}>
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
                  ? '这个任务还没有执行记录；有冻结计划时复制到待确认草稿，无计划时保留需求上下文。'
                  : `执行状态 ${EXECUTION_STATUS_LABEL[executionNode.status]} · 失败步骤 ${String(failedNodes.length)} 个${unknownExecution ? ' · 待核对' : ''}`}
              </div>
            </div>
            {executionNode === undefined ? null : (
              <Badge tone={executionNode.status === 'failed' ? 'fail' : executionNode.status === 'unknown' ? 'unknown' : executionNode.status === 'running' ? 'run' : 'idle'}>
                {EXECUTION_STATUS_LABEL[executionNode.status]}
              </Badge>
            )}
          </div>
          <div className="card-body">
            {executionNode === undefined ? (
              <p className="hint">没有可执行的恢复动作。</p>
            ) : (
              <>
                {unknownExecution ? (
                  <div className="banner unknown" role="alert" style={{ marginBottom: 12 }}>
                    <Icon name="help" />
                    <div className="grow">
                      <b>执行状态待核对（unknown）</b>
                      <br />
                      进程中断不证明远端会话已停止。请按原请求号核对；停止确认前不能创建可写恢复或重试活动步骤。
                    </div>
                    <div className="actions">
                      <Button
                        size="sm"
                        variant="secondary"
                        icon="refresh"
                        disabled={detail.isFetching}
                        disabledReason="正在重新读取执行状态"
                        onClick={() => {
                          void detail.refetch();
                        }}
                      >
                        {detail.isFetching ? '读取中…' : '重新读取'}
                      </Button>
                    </div>
                  </div>
                ) : null}
                {failedNodes.length === 0 ? null : (
                  <ul className="hint" style={{ margin: '0 0 12px 18px', lineHeight: 1.7 }}>
                    {failedNodes.slice(0, 5).map((node) => (
                      <li key={node.nodeId}>{node.nodeId}{node.error === undefined ? '' : `：${node.error.message}`}</li>
                    ))}
                  </ul>
                )}
                <div className="row wrap" style={{ gap: 8 }}>
                  {executionNode.status === 'paused' ? (
                    <Button variant="secondary" size="sm" icon="play" disabled={Boolean(pendingKey) || executionRecovery.isPending || resumeAction?.allowed === false} disabledReason={executionRecovery.isPending ? '正在提交命令，等待服务回执…' : resumeAction?.reason} onClick={() => executionRecovery.mutate('resume')}>
                      继续执行
                    </Button>
                  ) : null}
                  {['failed', 'stopped', 'paused', 'unknown'].includes(executionNode.status) ? (
                    <Button
                      variant="primary"
                      size="sm"
                      icon="refresh"
                      disabled={Boolean(pendingKey) || executionRecovery.isPending || retryAction?.allowed === false || (retryAction === undefined && failedNodes.length === 0)}
                      disabledReason={
                        executionRecovery.isPending
                          ? '正在提交命令，等待服务回执…'
                          : retryAction?.reason ?? '当前没有失败步骤可按原配置重试'
                      }
                      onClick={() => executionRecovery.mutate('retry')}
                    >
                      {executionRecovery.isPending ? '正在提交…' : failedNodes.length === 0 ? '按原配置重试失败步骤' : `按原配置重试 ${String(failedNodes.length)} 个失败步骤`}
                    </Button>
                  ) : null}
                  {['running', 'paused', 'unknown'].includes(executionNode.status) ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      icon="stop"
                      disabled={Boolean(pendingKey) || executionRecovery.isPending}
                      disabledReason="正在提交命令，等待服务回执…"
                      onClick={() => executionRecovery.mutate('cancel')}
                    >
                      取消执行（保留工作区）
                    </Button>
                  ) : null}
                </div>
                {['failed', 'stopped', 'paused', 'unknown'].includes(executionNode.status) ? (
                  <div className="row wrap" style={{ gap: 8, marginTop: 10 }}>
                    <select
                      className="select"
                      style={{ width: 'auto', height: 30 }}
                      value={skipNodeId}
                      disabled={Boolean(pendingKey) || executionRecovery.isPending}
                      onChange={(event) => {
                        setSkipNodeId(event.target.value);
                      }}
                      aria-label="选择要跳过的节点"
                    >
                      <option value="">选择节点…</option>
                      {skippableNodes.map((node) => (
                        <option key={node.nodeId} value={node.nodeId}>{node.nodeId} · {node.status}</option>
                      ))}
                    </select>
                    <Button
                      variant="secondary"
                      size="sm"
                      icon="stop"
                      disabled={Boolean(pendingKey) || skipNodeId === '' || executionRecovery.isPending}
                      disabledReason={
                        executionRecovery.isPending
                          ? '正在提交命令，等待服务回执…'
                          : skipNodeId === ''
                            ? skippableNodes.length === 0
                              ? '没有可跳过的节点（已成功或已跳过的步骤不能跳过）'
                              : '先在左侧选择要跳过的节点'
                            : undefined
                      }
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
                  {unknownExecution
                    ? '执行状态待核对：命令结果以回执为准；accepted / unknown 回执不会自动重发，只会按原请求号核对，请以本页重新读取的服务状态为准。'
                    : '重试会为失败步骤创建新的 attempt，按原计划与配置重新运行；不会改动已成功的步骤。'}
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
            {history.isError ? <ServiceNotice error={history.error} onRetry={()=>void history.refetch()}/> : history.data === undefined ? (
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
                        {MODES.find(item=>item.id===record.mode)?.title??record.mode} · {new Date(record.createdAt).toLocaleString('zh-CN')}
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
      <Modal open={confirm} title="确认创建恢复草稿？" onClose={()=>{if(!createRecovery.isPending)setConfirm(false);}} footer={<><Button variant="ghost" onClick={()=>setConfirm(false)} disabled={createRecovery.isPending}>取消</Button><Button disabled={createBlocked} onClick={()=>createRecovery.mutate()}>确认创建</Button></>}><p>{MODES.find(item=>item.id===mode)?.title}：{preview.data?.workspace}</p><p>按刚读取的冻结阶段与文件修订创建；原任务和执行证据保持不变。草稿不会自动开始，需打开草稿另行审阅确认。</p></Modal>
    </div>
  );
}
