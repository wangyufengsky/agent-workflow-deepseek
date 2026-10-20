import { useSearchParams } from 'react-router-dom';
import { pendingCommands } from '../../api/pending-commands.ts';
import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ROUTES,
  createRequestKey,
  type CommandResponse,
  type OperationReceipt,
  type OperationsByKeyResponse,
  type PptWork,
} from '@agent-workflow/shared';
import { ApiClientError, apiGet, apiPost, errorMessage, request } from '../../api/client.ts';
import { useProjects } from '../../api/hooks.ts';
import { Button } from '../../components/Button.tsx';
import { PageHeader } from '../../components/Card.tsx';
import { EmptyState } from '../../components/EmptyState.tsx';
import { Icon } from '../../components/Icon.tsx';
import { ServiceNotice } from '../../components/ServiceNotice.tsx';
import { PptCreatePage } from './PptCreatePage.tsx';
import { PptWorkbench } from './PptWorkbench.tsx';
import { PptWorksView } from './PptWorksView.tsx';
import {
  PPT_COMMAND_LABEL,
  PptReceiptBanner,
  pptCommandRequestKey,
  toPptLookup,
  toPptReceipt,
  type PptCommand,
  type PptCommandKind,
  type PptCommandOutcome,
  type PptCommandSignal,
  type PptReceiptState,
} from './ppt-shared.tsx';
import './ppt.css';

const WORKS_QUERY_KEY = ['ppt', 'works'] as const;

type PptView = 'works' | 'create' | 'workbench';

/** 执行写命令并取出服务回执；未知/失败由调用方按回执状态展示。 */
async function executePptCommand(command: PptCommand, requestKey: string): Promise<OperationReceipt> {
  switch (command.kind) {
    case 'copy':
    case 'archive':
    case 'restore': {
      return (await apiPost<CommandResponse<PptWork>>(({ archive: ROUTES.pptWorkArchive, copy: ROUTES.pptWorkCopy, restore: ROUTES.pptWorkRestore })[command.kind](command.workId), command.body)).data.receipt;
    }
    case 'create': {
      const response = await apiPost<CommandResponse<readonly PptWork[]>>(ROUTES.pptWorks, command.body, { timeoutMs: 20_000 });
      return response.data.receipt;
    }
    case 'attach': {
      const response = await apiPost<CommandResponse<PptWork>>(ROUTES.pptWorkAttachments(command.workId), command.body);
      return response.data.receipt;
    }
    case 'detach': {
      const response = await request<CommandResponse<PptWork>>(ROUTES.pptWorkAttachment(command.workId, command.name), {
        method: 'DELETE', body: { requestKey },
      });
      return response.data.receipt;
    }
    case 'update': {
      const response = await request<CommandResponse<PptWork>>(ROUTES.pptWorkUpdate(command.workId), {
        method: 'PATCH',
        body: { ...command.body, expectedRevision: command.body.expectedRevision },
      });
      return response.data.receipt;
    }
    case 'generate': {
      const response = await apiPost<CommandResponse<PptWork>>(ROUTES.pptWorkGenerate(command.workId), command.body, {
        timeoutMs: 120_000,
      });
      return response.data.receipt;
    }
    case 'generateSlides': {
      const response = await apiPost<CommandResponse<PptWork>>(ROUTES.pptWorkGenerateSlides(command.workId), {...command.body,background:true}, {
        timeoutMs: 150_000,
      });
      return response.data.receipt;
    }
    case 'delete': {
      const response = await request<CommandResponse<readonly PptWork[]>>(ROUTES.pptWork(command.workId), { method: 'DELETE', body: { requestKey } });
      return response.data.receipt;
    }
  }
}

export function PptPage() {
  const queryClient = useQueryClient();
  const worksQuery = useQuery({
    queryKey: WORKS_QUERY_KEY,
    queryFn: async () => (await apiGet<{ works: readonly PptWork[] }>(ROUTES.pptWorks)).data.works,
    retry: false,
    refetchInterval: (query) => (query.state.data?.some((work) => work.status === 'generating' || work.mutationBlock !== undefined) === true ? 1_500 : false),
  });
  const projectsQuery = useProjects();
  const projects = projectsQuery.data ?? [];

  const works = [...(worksQuery.data ?? [])].sort(
    (left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt),
  );

  const [params,setParams]=useSearchParams();
  /* P05-01：独立创作页是设计的主入口（?view=create）；作品库与工作台保持原路由语义。 */
  const view:PptView=params.has('work')?'workbench':params.get('view')==='create'?'create':'works';
  const selectedId=params.get('work');
  const lastSelected=useRef<string|null>(selectedId);
  if(selectedId!==null)lastSelected.current=selectedId;
  const setSelectedId=(value:string|null|((current:string|null)=>string|null))=>{const id=typeof value==='function'?value(selectedId):value;const next=new URLSearchParams(params);if(id===null)next.delete('work');else next.set('work',id);setParams(next);};
  const setView=(value:PptView)=>{const next=new URLSearchParams(params);if(value==='works'){next.delete('work');next.delete('view');}else if(value==='create'){next.delete('work');next.set('view','create');setCreateReceipt(prev=>prev?.outcome==='succeeded'?null:prev);}else{next.delete('view');if(!next.has('work')){const id=lastSelected.current??works[0]?.id;if(id)next.set('work',id);}}setParams(next);};
  const [createReceipt, setCreateReceipt] = useState<PptReceiptState | null>(null);
  const [busyKind, setBusyKind] = useState<PptCommandKind | null>(null);
  const [receipt, setReceipt] = useState<PptReceiptState | null>(null);
  const [lastResult, setLastResult] = useState<PptCommandSignal | null>(null);
  const busyRef = useRef<PptCommandKind | null>(null);
  const commandEpoch = useRef(0);
  const activeWorkRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (busyRef.current !== 'generate' && busyRef.current !== 'generateSlides') return;
    const stopped=worksQuery.data?.find(work=>work.id===activeWorkRef.current)?.generation;
    if(stopped?.status!=='stopped')return;
    const epoch=commandEpoch.current;
    void apiGet<OperationsByKeyResponse>(ROUTES.operationsByKey(stopped.requestKey)).then(response=>{
      if(commandEpoch.current!==epoch || response.data.operation.status!=='succeeded' || response.data.operation.outcome?.stopped!==true)return;
      commandEpoch.current+=1;busyRef.current=null;setBusyKind(null);
    }).catch(()=>undefined);
  },[worksQuery.data]);

  const selectedWork = selectedId === null ? undefined : works.find((work) => work.id === selectedId);
  const refreshWorks = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: WORKS_QUERY_KEY });
  };

  /** 创建命令的回执同时发布给创作页：失败/超时/UNKNOWN 必须显示在操作发生处（P05-03）。 */
  const publishReceipt = (next: PptReceiptState | null, kind: PptCommandKind): void => {
    setReceipt(next);
    if (kind === 'create') setCreateReceipt(next);
  };

  const runCommand = async (command: PptCommand): Promise<void> => {
    if (busyRef.current !== null) return;
    const epoch=++commandEpoch.current;
    activeWorkRef.current='workId' in command ? command.workId : undefined;
    busyRef.current = command.kind;
    setBusyKind(command.kind);
    if (command.kind === 'generate' || command.kind === 'generateSlides') window.setTimeout(() => { void refreshWorks(); }, 150);
    publishReceipt(null, command.kind);
    const label = PPT_COMMAND_LABEL[command.kind];
    const requestKey = pptCommandRequestKey(command) ?? createRequestKey();
    try {
      const rawReceipt = await executePptCommand(command, requestKey);
      if(epoch!==commandEpoch.current)return;
      const receiptView = toPptReceipt(rawReceipt);
      const outcome: PptCommandOutcome = receiptView.status;
      let signalMessage: string | undefined;
      if (outcome === 'succeeded') {
        await refreshWorks();
        if (command.kind === 'create') {
          const fromOutcome = typeof rawReceipt.outcome?.workId === 'string' ? rawReceipt.outcome.workId : undefined;
          const latest = queryClient.getQueryData<readonly PptWork[]>(WORKS_QUERY_KEY);
          const createdId = fromOutcome ?? latest?.[0]?.id;
          if (createdId !== undefined) setSelectedId(createdId);
        } else if (command.kind === 'delete') {
          setSelectedId((prev) => (prev === command.workId ? null : prev));
          setView('works');
        }
        publishReceipt({
          label,
          outcome,
          receipt: receiptView,
          requestKey: receiptView.requestKey,
          message: rawReceipt.outcome?.stopped === true ? '原生成已核对停止，已有内容保留；未采用迟到生成结果。' : '回执已结算，作品列表已刷新。',
        }, command.kind);
      } else if (outcome === 'accepted') {
        signalMessage = '服务已接受但尚未结算：界面不会重复提交，请稍后刷新作品列表核对。';
        publishReceipt({ label, outcome, receipt: receiptView, requestKey: receiptView.requestKey, message: signalMessage }, command.kind);
      } else if (outcome === 'unknown') {
        signalMessage = '服务返回 unknown 回执：结果未明，界面不会自动重发，可用「核对原操作」按请求号确认。';
        publishReceipt({ label, outcome, receipt: receiptView, requestKey: receiptView.requestKey, message: signalMessage }, command.kind);
      } else {
        const detail = receiptView.error?.message;
        signalMessage = detail === undefined ? '服务返回失败回执，但没有说明原因。' : `服务拒绝或未完成这次操作：${detail}`;
        publishReceipt({
          label,
          outcome,
          receipt: receiptView,
          requestKey: receiptView.requestKey,
          message: detail === undefined ? signalMessage : '回执状态为 failed；失败原因见下。',
        }, command.kind);
      }
      setLastResult({ kind: command.kind, outcome, ...(signalMessage === undefined ? {} : { message: signalMessage }), at: Date.now() });
    } catch (error) {
      if(epoch!==commandEpoch.current)return;
      const effectiveKey=error instanceof ApiClientError && typeof error.details?.requestKey==='string' ? error.details.requestKey : requestKey;
      const failureKind = error instanceof ApiClientError ? error.kind : null;
      const unresolved = pendingCommands().some(item=>item.requestKey===effectiveKey) || failureKind === 'timeout' || failureKind === 'unavailable';
      const outcome: PptCommandOutcome = unresolved ? 'unknown' : 'failed';
      const detail = errorMessage(error);
      const message = unresolved
        ? requestKey === undefined
          ? '没有收到服务回执：结果未明，界面不会自动重发。该命令的请求号由服务端生成且未返回，请刷新作品列表按真实状态核对。'
          : '没有收到服务回执：结果未明，界面不会自动重发。可用请求号核对原操作，再按读口刷新作品列表。'
        : detail;
      publishReceipt({ label, outcome, requestKey: effectiveKey, message }, command.kind);
      setLastResult({ kind: command.kind, outcome, message, at: Date.now() });
    } finally {
      if(epoch===commandEpoch.current){busyRef.current = null;setBusyKind(null);}
      /* P07-09：更新失败/冲突后主动重读作品，让方案抽屉进入“已有新版本”并可用读取最新方案。 */
      if(command.kind==='update') void refreshWorks();
    }
  };

  const verifyReceipt = async (requestKey: string): Promise<void> => {
    setReceipt((prev) => (prev === null ? prev : { ...prev, lookupBusy: true, lookupError: undefined }));
    setCreateReceipt((prev) => (prev === null || prev.requestKey !== requestKey ? prev : { ...prev, lookupBusy: true, lookupError: undefined }));
    try {
      const response = await apiGet<OperationsByKeyResponse>(ROUTES.operationsByKey(requestKey));
      const record = response.data.operation;
      const lookup = toPptLookup(record);
      const apply = (prev: PptReceiptState): PptReceiptState => ({ ...prev, outcome: record.status, receipt: toPptReceipt(record), message: record.outcome?.stopped === true ? '原生成已停止，已有内容保留' : record.status==='succeeded' ? '原操作已结算' : prev.message, lookupBusy: false, lookup });
      setReceipt((prev) => (prev === null ? prev : apply(prev)));
      setCreateReceipt((prev) => (prev === null || prev.requestKey !== requestKey ? prev : apply(prev)));
      if (record.status === 'succeeded') {
        await refreshWorks();
        const workId = typeof record.outcome?.workId === 'string' ? record.outcome.workId : undefined;
        if (record.operation === 'ppt.work.delete') {
          setSelectedId((prev) => (prev === workId ? null : prev));
          setView('works');
        } else if (workId !== undefined) {
          setSelectedId(workId);
        }
      }
    } catch (error) {
      const fail = (prev: PptReceiptState): PptReceiptState => ({ ...prev, lookupBusy: false, lookupError: errorMessage(error) });
      setReceipt((prev) => (prev === null ? prev : fail(prev)));
      setCreateReceipt((prev) => (prev === null || prev.requestKey !== requestKey ? prev : fail(prev)));
    }
  };

  const checkedTerminal=useRef('');
  useEffect(()=>{const run=selectedWork?.generation;if(run&&['completed','failed','stopped'].includes(run.status)&&receipt?.requestKey===run.requestKey&&['accepted','unknown'].includes(receipt.outcome)&&checkedTerminal.current!==`${run.requestKey}:${run.status}`){checkedTerminal.current=`${run.requestKey}:${run.status}`;void verifyReceipt(run.requestKey);}},[selectedWork?.generation?.requestKey,selectedWork?.generation?.status,receipt?.requestKey,receipt?.outcome]);

  return (
    <div className="page">
      {view === 'works' ? (
        <PageHeader
          eyebrow="PPT 制作"
          title="全部作品"
          lede="全部演示作品。点选作品进入四步工作台；所有写操作都返回服务回执。"
          actions={
            <Button variant="primary" size="sm" icon="plus" onClick={() => setView('create')}>
              新建演示
            </Button>
          }
        />
      ) : view === 'create' ? (
        <div>
          <div className="row wrap" style={{ gap: 8 }}>
            <span className="grow" />
            <Button variant="ghost" size="sm" icon="arrowLeft" onClick={() => setView('works')}>
              全部作品
            </Button>
          </div>
          <PptCreatePage
            projects={projects}
            projectsLoading={projectsQuery.isLoading}
            {...(projectsQuery.isError ? { projectsError: projectsQuery.error } : {})}
            receipt={createReceipt}
            busy={busyKind === 'create'}
            onVerify={(requestKey) => {
              void verifyReceipt(requestKey);
            }}
            onRetryProjects={() => {
              void projectsQuery.refetch();
            }}
            onCreate={(body) => {
              void runCommand({ kind: 'create', body });
            }}
            onOpenWork={(workId) => {
              setSelectedId(workId);
            }}
            onOpenWorks={() => setView('works')}
            recentWorks={works}
          />
        </div>
      ) : null}

      {view !== 'create' && projectsQuery.isError ? (
        <div style={{ marginBottom: 16 }}>
          <ServiceNotice
            error={projectsQuery.error}
            onRetry={() => {
              void projectsQuery.refetch();
            }}
          />
        </div>
      ) : null}

      {receipt === null || view === 'create' ? null : (
        <div style={{ marginBottom: 16 }}>
          <PptReceiptBanner
            state={receipt}
            onVerify={(requestKey) => {
              void verifyReceipt(requestKey);
            }}
            onDismiss={() => {
              setReceipt(null);
            }}
          />
        </div>
      )}

      {view === 'works' ? (
        <PptWorksView
          works={works}
          projects={projects}
          loading={worksQuery.isLoading}
          error={worksQuery.isError ? worksQuery.error : undefined}
          fetching={worksQuery.isFetching}
          selectedId={selectedId}
          onOpen={(work) => {
            setSelectedId(work.id);
            }}
          onNew={() => {
            setView('create');
          }}
          onCommand={(command) => { void runCommand(command); }}
            onRetry={() => {
            void worksQuery.refetch();
          }}
        />
      ) : selectedWork === undefined && selectedId !== null && worksQuery.isLoading ? (
        <section className="card pad" style={{ marginTop: 16 }}>
          <p role="status"><Icon name="clock" size="sm" /> 正在读取作品…</p>
          <p className="hint">深链刷新时会先读取作品列表；不会把加载中当成“作品不存在”。</p>
        </section>
      ) : selectedWork === undefined && selectedId !== null && worksQuery.isError ? (
        <section className="card pad" style={{ marginTop: 16 }}>
          <ServiceNotice error={worksQuery.error} onRetry={() => { void worksQuery.refetch(); }} />
          <div style={{ marginTop: 12 }}>
            <Button variant="ghost" size="sm" icon="arrowLeft" onClick={() => setSelectedId(null)}>去作品库</Button>
          </div>
        </section>
      ) : view === 'create' ? null : selectedWork === undefined ? (
        <section className="card pad" style={{ marginTop: 16 }}>
          {selectedId !== null && !worksQuery.isLoading && !worksQuery.isError && works.length > 0 ? (
            <>
              <div className="banner warn" style={{ marginBottom: 16 }}>
                <Icon name="help" />
                <div className="grow">
                  <b>选中的作品不在当前列表</b>
                  <br />
                  它可能已被删除，或作品列表刚刷新过。请重新选择一份作品。
                </div>
              </div>
              <EmptyState
                icon="slides"
                title="作品不可用"
                description="回到作品库重新选择；已删除的作品无法恢复。"
                action={
                  <Button
                    variant="primary"
                    size="sm"
                    icon="arrowLeft"
                    onClick={() => {
                      setSelectedId(null);
                      setView('works');
                    }}
                  >
                    去作品库
                  </Button>
                }
              />
            </>
          ) : (
            <EmptyState
              icon="slides"
              title={works.length === 0 ? '作品库还是空的' : '还没有选择作品'}
              description={
                works.length === 0
                  ? '先新建一份演示草稿，再进入四步工作台。'
                  : '从作品库点选一份作品；工作台会按四步展示真实数据与操作。'
              }
              action={
                <Button
                  variant={works.length === 0 ? 'primary' : 'secondary'}
                  size="sm"
                  icon={works.length === 0 ? 'plus' : 'arrowLeft'}
                  onClick={() => {
                    if (works.length === 0) setView('create');
                    else setView('works');
                  }}
                >
                  {works.length === 0 ? '新建演示' : '去作品库'}
                </Button>
              }
            />
          )}
        </section>
      ) : (
        <div style={{ marginTop: 16 }}>
          <PptWorkbench
            key={selectedWork.id}
            work={selectedWork}
            projectName={projects.find((project) => project.id === selectedWork.projectId)?.name}
            busyKind={busyKind}
            lastResult={lastResult}
            onCommand={(command) => {
              void runCommand(command);
            }}
            onRefresh={() => { void refreshWorks(); }}
            onBack={() => {
              setView('works');
            }}
          />
        </div>
      )}
    </div>
  );
}
