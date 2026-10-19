import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ROUTES,
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
import { SegmentedControl, type SegmentOption } from '../../components/SegmentedControl.tsx';
import { ServiceNotice } from '../../components/ServiceNotice.tsx';
import { PptCreateDialog } from './PptCreateDialog.tsx';
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

type PptView = 'works' | 'workbench';

/** 执行写命令并取出服务回执；未知/失败由调用方按回执状态展示。 */
async function executePptCommand(command: PptCommand): Promise<OperationReceipt> {
  switch (command.kind) {
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
        method: 'DELETE',
      });
      return response.data.receipt;
    }
    case 'update': {
      const response = await request<CommandResponse<PptWork>>(ROUTES.pptWorkUpdate(command.workId), {
        method: 'PATCH',
        body: command.body,
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
      const response = await apiPost<CommandResponse<PptWork>>(ROUTES.pptWorkGenerateSlides(command.workId), command.body, {
        timeoutMs: 150_000,
      });
      return response.data.receipt;
    }
    case 'delete': {
      const response = await request<CommandResponse<readonly PptWork[]>>(ROUTES.pptWork(command.workId), { method: 'DELETE' });
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
    refetchInterval: (query) => (query.state.data?.some((work) => work.status === 'generating') === true ? 5_000 : false),
  });
  const projectsQuery = useProjects();
  const projects = projectsQuery.data ?? [];

  const works = [...(worksQuery.data ?? [])].sort(
    (left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt),
  );

  const [view, setView] = useState<PptView>('works');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [busyKind, setBusyKind] = useState<PptCommandKind | null>(null);
  const [receipt, setReceipt] = useState<PptReceiptState | null>(null);
  const [lastResult, setLastResult] = useState<PptCommandSignal | null>(null);
  const busyRef = useRef<PptCommandKind | null>(null);

  const selectedWork = selectedId === null ? undefined : works.find((work) => work.id === selectedId);
  const viewOptions: readonly SegmentOption<PptView>[] = [
    { value: 'works', label: '作品' },
    { value: 'workbench', label: '工作台' },
  ];

  const refreshWorks = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: WORKS_QUERY_KEY });
  };

  const runCommand = async (command: PptCommand): Promise<void> => {
    if (busyRef.current !== null) return;
    busyRef.current = command.kind;
    setBusyKind(command.kind);
    setReceipt(null);
    const label = PPT_COMMAND_LABEL[command.kind];
    const requestKey = pptCommandRequestKey(command);
    try {
      const rawReceipt = await executePptCommand(command);
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
          setCreateOpen(false);
          setView('workbench');
        } else if (command.kind === 'delete') {
          setSelectedId((prev) => (prev === command.workId ? null : prev));
          setView('works');
        }
        setReceipt({
          label,
          outcome,
          receipt: receiptView,
          requestKey: receiptView.requestKey,
          message: '回执已结算，作品列表已刷新。',
        });
      } else if (outcome === 'accepted') {
        signalMessage = '服务已接受但尚未结算：界面不会重复提交，请稍后刷新作品列表核对。';
        setReceipt({ label, outcome, receipt: receiptView, requestKey: receiptView.requestKey, message: signalMessage });
      } else if (outcome === 'unknown') {
        signalMessage = '服务返回 unknown 回执：结果未明，界面不会自动重发，可用「核对原操作」按请求号确认。';
        setReceipt({ label, outcome, receipt: receiptView, requestKey: receiptView.requestKey, message: signalMessage });
      } else {
        const detail = receiptView.error?.message;
        signalMessage = detail === undefined ? '服务返回失败回执，但没有说明原因。' : `服务拒绝或未完成这次操作：${detail}`;
        setReceipt({
          label,
          outcome,
          receipt: receiptView,
          requestKey: receiptView.requestKey,
          message: detail === undefined ? signalMessage : '回执状态为 failed；失败原因见下。',
        });
      }
      setLastResult({ kind: command.kind, outcome, ...(signalMessage === undefined ? {} : { message: signalMessage }), at: Date.now() });
    } catch (error) {
      const failureKind = error instanceof ApiClientError ? error.kind : null;
      const unresolved = failureKind === 'timeout' || failureKind === 'unavailable';
      const outcome: PptCommandOutcome = unresolved ? 'unknown' : 'failed';
      const detail = errorMessage(error);
      const message = unresolved
        ? requestKey === undefined
          ? '没有收到服务回执：结果未明，界面不会自动重发。该命令的请求号由服务端生成且未返回，请刷新作品列表按真实状态核对。'
          : '没有收到服务回执：结果未明，界面不会自动重发。可用请求号核对原操作，再按读口刷新作品列表。'
        : detail;
      setReceipt({ label, outcome, requestKey, message });
      setLastResult({ kind: command.kind, outcome, message, at: Date.now() });
    } finally {
      busyRef.current = null;
      setBusyKind(null);
    }
  };

  const verifyReceipt = async (requestKey: string): Promise<void> => {
    setReceipt((prev) => (prev === null ? prev : { ...prev, lookupBusy: true, lookupError: undefined }));
    try {
      const response = await apiGet<OperationsByKeyResponse>(ROUTES.operationsByKey(requestKey));
      const record = response.data.operation;
      const lookup = toPptLookup(record);
      setReceipt((prev) => (prev === null ? prev : { ...prev, lookupBusy: false, lookup }));
      if (record.status === 'succeeded') {
        await refreshWorks();
        const workId = typeof record.outcome?.workId === 'string' ? record.outcome.workId : undefined;
        if (record.operation === 'ppt.work.delete') {
          setSelectedId((prev) => (prev === workId ? null : prev));
          setView('works');
        } else if (workId !== undefined) {
          setSelectedId(workId);
          setView('workbench');
        }
      }
    } catch (error) {
      setReceipt((prev) => (prev === null ? prev : { ...prev, lookupBusy: false, lookupError: errorMessage(error) }));
    }
  };

  return (
    <div className="page">
      <PageHeader
        title="PPT 制作"
        lede="作品库与工作台：网格/列表查看全部作品；选中作品后在四步工作台完成讨论需求、设计方案、制作检查与导出。所有写操作返回真实回执，模型调用可能较慢。"
        actions={
          <div className="row wrap" style={{ gap: 8 }}>
            <SegmentedControl ariaLabel="PPT 视图" options={viewOptions} value={view} onChange={setView} />
            <Button variant="primary" size="sm" icon="plus" onClick={() => setCreateOpen(true)}>
              新建演示
            </Button>
          </div>
        }
      />

      {projectsQuery.isError ? (
        <div style={{ marginBottom: 16 }}>
          <ServiceNotice
            error={projectsQuery.error}
            onRetry={() => {
              void projectsQuery.refetch();
            }}
          />
        </div>
      ) : null}

      {receipt === null ? null : (
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
            setView('workbench');
          }}
          onNew={() => {
            setCreateOpen(true);
          }}
          onRetry={() => {
            void worksQuery.refetch();
          }}
        />
      ) : selectedWork === undefined ? (
        <section className="card pad" style={{ marginTop: 16 }}>
          {selectedId !== null && !worksQuery.isLoading && !worksQuery.isError ? (
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
                    if (works.length === 0) setCreateOpen(true);
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
            onBack={() => {
              setView('works');
            }}
          />
        </div>
      )}

      {createOpen ? (
        <PptCreateDialog
          projects={projects}
          projectsLoading={projectsQuery.isLoading}
          busy={busyKind === 'create'}
          onClose={() => {
            setCreateOpen(false);
          }}
          onCreate={(body) => {
            void runCommand({ kind: 'create', body });
          }}
        />
      ) : null}
    </div>
  );
}
