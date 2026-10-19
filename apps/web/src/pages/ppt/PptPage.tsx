import { useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ROUTES,
  THEME_IDS,
  THEMES,
  createRequestKey,
  type CommandResponse,
  type OperationReceipt,
  type OperationsByKeyResponse,
  type PptWork,
  type PptWorkCreateRequest,
  type ThemeIdValue,
} from '@agent-workflow/shared';
import { ApiClientError, apiGet, apiPost, errorMessage, request } from '../../api/client.ts';
import { useProjects } from '../../api/hooks.ts';
import { formatRelativeTime } from '../../app/format.ts';
import { Badge } from '../../components/Badge.tsx';
import { Button } from '../../components/Button.tsx';
import { PageHeader } from '../../components/Card.tsx';
import { EmptyState, Skeleton } from '../../components/EmptyState.tsx';
import { Icon } from '../../components/Icon.tsx';
import { ServiceNotice } from '../../components/ServiceNotice.tsx';
import { PptWorkPanel } from './PptWorkPanel.tsx';
import {
  PPT_COMMAND_LABEL,
  PptReceiptBanner,
  pptCommandRequestKey,
  pptPageSummary,
  pptStatusMeta,
  themeLabel,
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
/** opencode-ready 之外的真实约束：服务要求标题/主题非空，这里给用户一个可写清的要求。 */
const MIN_TOPIC_LENGTH = 6;

const IDEAS = ['新人入门：项目架构说明', '季度复盘：交付与质量', '技术方案评审：恢复机制'] as const;

const STEPS = [
  {
    ordinal: '01',
    title: '创建作品',
    detail: '选项目、写清对象与篇幅，保存成草稿；创建成功后列表自动刷新并选中这份作品。',
    icon: 'plus' as const,
  },
  {
    ordinal: '02',
    title: '生成或手写大纲',
    detail: '生成大纲会调用受管模型，可能较慢；也可以直接改标题、主题与每页大纲。',
    icon: 'wand' as const,
  },
  {
    ordinal: '03',
    title: '逐页内容与导出',
    detail: '按大纲生成逐页要点，再导出 PPTX 或 Markdown；生成与导出都由服务执行并返回回执。',
    icon: 'download' as const,
  },
];

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

function WorkMiniPreview({ work }: { readonly work: PptWork }) {
  const firstSlide = work.slides[0];
  return (
    <span className="ppt-mini" aria-hidden="true">
      {firstSlide !== undefined ? (
        <>
          <b>{firstSlide.title}</b>
          {firstSlide.bullets.slice(0, 2).map((bullet, index) => (
            <i key={`${String(index)}-${bullet}`} style={{ width: index === 0 ? '72%' : '54%' }} />
          ))}
        </>
      ) : work.outline.length > 0 ? (
        <>
          <b>{work.title}</b>
          {work.outline.slice(0, 3).map((line, index) => (
            <i key={`${String(index)}-${line}`} style={{ width: index === 0 ? '68%' : index === 1 ? '82%' : '50%' }} />
          ))}
        </>
      ) : (
        <span className="ppt-mini-empty">尚无大纲</span>
      )}
      <span className="ppt-mini-page">{pptPageSummary(work)}</span>
    </span>
  );
}

function RecentWorkCard({
  work,
  projectName,
  selected,
  onSelect,
}: {
  readonly work: PptWork;
  readonly projectName?: string;
  readonly selected: boolean;
  readonly onSelect: () => void;
}) {
  const status = pptStatusMeta(work.status);
  return (
    <button type="button" className="ppt-recent-card" aria-pressed={selected} onClick={onSelect}>
      <WorkMiniPreview work={work} />
      <span className="row" style={{ gap: 6 }}>
        <span className="ellipsis grow" style={{ fontSize: 13, fontWeight: 500 }} title={work.title}>
          {work.title}
        </span>
        <Badge tone={status.tone} icon={status.icon}>
          {status.label}
        </Badge>
      </span>
      <span className="hint ellipsis" title={work.topic}>
        {work.topic}
      </span>
      <span className="hint ellipsis">
        {projectName === undefined ? '未归属项目' : projectName} · {themeLabel(work.theme)} · 更新于{' '}
        {formatRelativeTime(work.updatedAt)}
      </span>
    </button>
  );
}

function WorkRow({
  work,
  selected,
  onSelect,
}: {
  readonly work: PptWork;
  readonly selected: boolean;
  readonly onSelect: () => void;
}) {
  const status = pptStatusMeta(work.status);
  return (
    <button type="button" className="list-row" aria-pressed={selected} onClick={onSelect}>
      <span className="tile">
        <Icon name="slides" />
      </span>
      <span className="grow" style={{ minWidth: 0, textAlign: 'left' }}>
        <span className="row" style={{ gap: 8 }}>
          <span className="ellipsis" style={{ fontSize: 13.5, fontWeight: 500 }} title={work.title}>
            {work.title}
          </span>
          <Badge tone={status.tone} icon={status.icon}>
            {status.label}
          </Badge>
        </span>
        <span className="hint ellipsis" style={{ display: 'block' }} title={work.topic}>
          {work.topic}
        </span>
      </span>
      <span className="hint ppt-row-extra">{pptPageSummary(work)}</span>
      <span className="hint ppt-row-time">更新于 {formatRelativeTime(work.updatedAt)}</span>
    </button>
  );
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

  const works = useMemo(
    () => [...(worksQuery.data ?? [])].sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt)),
    [worksQuery.data],
  );
  const recentWorks = works.slice(0, 3);

  const [projectId, setProjectId] = useState('');
  const [theme, setTheme] = useState<ThemeIdValue>('deepseek');
  const [topic, setTopic] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busyKind, setBusyKind] = useState<PptCommandKind | null>(null);
  const [receipt, setReceipt] = useState<PptReceiptState | null>(null);
  const [lastResult, setLastResult] = useState<PptCommandSignal | null>(null);
  const busyRef = useRef<PptCommandKind | null>(null);

  const project = projects.find((item) => item.id === projectId);
  const selectedWork = selectedId === null ? undefined : works.find((work) => work.id === selectedId);
  const valid = topic.trim().length >= MIN_TOPIC_LENGTH;

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
      const view = toPptReceipt(rawReceipt);
      const outcome: PptCommandOutcome = view.status;
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
        }
        setReceipt({
          label,
          outcome,
          receipt: view,
          requestKey: view.requestKey,
          message: '回执已结算，作品列表已刷新。',
        });
      } else if (outcome === 'accepted') {
        signalMessage = '服务已接受但尚未结算：界面不会重复提交，请稍后刷新作品列表核对。';
        setReceipt({
          label,
          outcome,
          receipt: view,
          requestKey: view.requestKey,
          message: signalMessage,
        });
      } else if (outcome === 'unknown') {
        signalMessage = '服务返回 unknown 回执：结果未明，界面不会自动重发，可用「核对原操作」按请求号确认。';
        setReceipt({
          label,
          outcome,
          receipt: view,
          requestKey: view.requestKey,
          message: signalMessage,
        });
      } else {
        const detail = view.error?.message;
        signalMessage = detail === undefined ? '服务返回失败回执，但没有说明原因。' : `服务拒绝或未完成这次操作：${detail}`;
        setReceipt({
          label,
          outcome,
          receipt: view,
          requestKey: view.requestKey,
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
      setReceipt({
        label,
        outcome,
        requestKey,
        message,
      });
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
        } else if (workId !== undefined) {
          setSelectedId(workId);
        }
      }
    } catch (error) {
      setReceipt((prev) => (prev === null ? prev : { ...prev, lookupBusy: false, lookupError: errorMessage(error) }));
    }
  };

  const submitCreate = (): void => {
    if (!valid || busyRef.current !== null) return;
    const body: PptWorkCreateRequest = {
      requestKey: createRequestKey(),
      ...(projectId === '' ? {} : { projectId }),
      title: topic.trim().slice(0, 40) || '未命名演示',
      topic: topic.trim(),
      theme,
      confirmCreate: true,
    };
    void runCommand({ kind: 'create', body });
  };

  const commandBusyReason = '另一条 PPT 命令正在等待服务回执；为避免重复提交，先等它结束。';

  return (
    <div className="page">
      <PageHeader
        title="PPT 制作"
        lede="从创建作品到导出：添加文本/图片附件、生成大纲与逐页内容、编辑标题与大纲、删除作品，以及导出 PPTX / Markdown。全部写操作返回真实回执；模型调用可能较慢。"
        actions={
          <div className="row" style={{ gap: 8 }}>
            {worksQuery.isError ? (
              <Badge tone="unknown" icon="help" title="作品列表读取失败，数量未知">
                作品数量未知
              </Badge>
            ) : worksQuery.isLoading ? (
              <Badge tone="wait" icon="clock">
                正在读取作品…
              </Badge>
            ) : (
              <Badge tone="accent" icon="slides">
                {String(works.length)} 份作品
              </Badge>
            )}
            <Button
              variant="secondary"
              size="sm"
              icon="refresh"
              disabled={worksQuery.isFetching}
              disabledReason={worksQuery.isFetching ? '正在刷新作品列表…' : undefined}
              onClick={() => {
                void worksQuery.refetch();
              }}
            >
              {worksQuery.isFetching ? '刷新中…' : '刷新'}
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

      <div className="ppt-layout">
        <div className="ppt-col">
          <section className="card pad" aria-label="创建演示" id="ppt-create">
            <div className="row" style={{ gap: 10 }}>
              <span className="tile">
                <Icon name="sparkle" />
              </span>
              <div className="grow">
                <h3 style={{ fontSize: 15, fontWeight: 500 }}>新建演示</h3>
                <div className="hint">写清对象、目的与篇幅；创建成功后会自动刷新作品列表并选中新草稿。</div>
              </div>
            </div>

            <div className="col" style={{ gap: 14, marginTop: 18 }}>
              <div className="ppt-field-row">
                <div className="field" style={{ flex: '1 1 260px' }}>
                  <label className="label" htmlFor="ppt-project">
                    项目<span className="opt">（可选）</span>
                  </label>
                  <select
                    id="ppt-project"
                    className="select"
                    value={projectId}
                    disabled={projectsQuery.isLoading}
                    onChange={(event) => {
                      setProjectId(event.target.value);
                    }}
                  >
                    <option value="">不归属项目</option>
                    {projects.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                  <span className="hint">
                    {projectsQuery.isLoading
                      ? '正在读取项目列表…'
                      : project === undefined
                        ? '不选项目也能创建与导出；只是生成时不会读取项目资料。'
                        : `已选择 ${project.name}；生成大纲/逐页时会读取该项目知识来源。`}
                  </span>
                </div>
                <div className="field" style={{ flex: '0 0 200px' }}>
                  <label className="label" htmlFor="ppt-theme">
                    版式主题
                  </label>
                  <select
                    id="ppt-theme"
                    className="select"
                    value={theme}
                    onChange={(event) => {
                      setTheme(event.target.value as ThemeIdValue);
                    }}
                  >
                    {THEME_IDS.map((id) => (
                      <option key={id} value={id}>
                        {THEMES[id].label}（{id}）
                      </option>
                    ))}
                  </select>
                  <span className="hint">导出 PPTX 时使用对应背景/文字/强调色。</span>
                </div>
              </div>

              <div className="field" style={{ margin: 0 }}>
                <label className="label" htmlFor="ppt-topic">
                  你希望这份 PPT 讲什么<span className="req">*</span>
                </label>
                <textarea
                  id="ppt-topic"
                  className="textarea"
                  value={topic}
                  placeholder="对象、目的、大概几页。例如：给新同事讲项目架构与任务流程，约 6 页，20 分钟。"
                  onChange={(event) => {
                    setTopic(event.target.value);
                  }}
                />
                <div className="row" style={{ gap: 8 }}>
                  <span className="hint grow">
                    至少 {String(MIN_TOPIC_LENGTH)} 个字；这段说明会成为作品主题，标题取前 40 个字。保存会真实写入服务。
                  </span>
                  <span className="hint num">{String(topic.length)} 字</span>
                </div>
              </div>

              <div className="row wrap" style={{ gap: 8 }}>
                <span className="hint">灵感：</span>
                {IDEAS.map((idea) => (
                  <button
                    key={idea}
                    type="button"
                    className="chip"
                    onClick={() => {
                      setTopic(idea);
                    }}
                  >
                    {idea}
                  </button>
                ))}
                <span className="grow" />
                <Button
                  variant="primary"
                  icon="plus"
                  disabled={!valid || busyKind !== null}
                  disabledReason={
                    !valid ? `至少写 ${String(MIN_TOPIC_LENGTH)} 个字说明主题。` : busyKind !== null ? commandBusyReason : undefined
                  }
                  onClick={submitCreate}
                >
                  {busyKind === 'create' ? '正在创建…' : '保存为演示草稿'}
                </Button>
              </div>

              {projects.length === 0 && !projectsQuery.isLoading && !projectsQuery.isError ? (
                <div className="banner info">
                  <Icon name="info" />
                  <div className="grow">服务里还没有登记项目。不选项目也可以创建与导出；只是生成时不会读取项目资料。</div>
                </div>
              ) : null}
            </div>
          </section>

          <section className="card" aria-label="作品列表">
            <div className="card-head">
              <Icon name="slides" />
              <h3 className="grow" style={{ fontSize: 14, fontWeight: 500 }}>
                作品
              </h3>
              <span className="hint">{worksQuery.isFetching && !worksQuery.isLoading ? '刷新中…' : works.length > 0 ? `${String(works.length)} 份` : ''}</span>
            </div>
            <div className="card-body">
              {worksQuery.isLoading ? (
                <div className="col" style={{ gap: 14 }}>
                  {[0, 1, 2].map((index) => (
                    <div key={index} className="stack-sm">
                      <Skeleton height={14} width="58%" />
                      <Skeleton height={11} width="34%" />
                    </div>
                  ))}
                </div>
              ) : worksQuery.isError ? (
                <ServiceNotice
                  error={worksQuery.error}
                  onRetry={() => {
                    void worksQuery.refetch();
                  }}
                />
              ) : works.length === 0 ? (
                <EmptyState
                  icon="slides"
                  title="还没有演示"
                  description="在上方写清主题并保存为草稿；创建成功后会自动出现在这里并选中。"
                />
              ) : (
                <>
                  <div className="eyebrow">最近演示</div>
                  <div className="ppt-recent">
                    {recentWorks.map((work) => (
                      <RecentWorkCard
                        key={work.id}
                        work={work}
                        projectName={projects.find((item) => item.id === work.projectId)?.name}
                        selected={work.id === selectedId}
                        onSelect={() => {
                          setSelectedId(work.id);
                        }}
                      />
                    ))}
                  </div>

                  <div className="eyebrow" style={{ marginTop: 20, marginBottom: 8 }}>
                    全部作品
                  </div>
                  <div className="list">
                    {works.map((work) => (
                      <WorkRow
                        key={work.id}
                        work={work}
                        selected={work.id === selectedId}
                        onSelect={() => {
                          setSelectedId(work.id);
                        }}
                      />
                    ))}
                  </div>
                </>
              )}
            </div>
          </section>
        </div>

        <div className="ppt-col">
          {receipt === null ? null : (
            <PptReceiptBanner
              state={receipt}
              onVerify={(requestKey) => {
                void verifyReceipt(requestKey);
              }}
              onDismiss={() => {
                setReceipt(null);
              }}
            />
          )}

          {selectedId !== null && selectedWork === undefined && !worksQuery.isLoading && !worksQuery.isError ? (
            <div className="banner warn">
              <Icon name="help" />
              <div className="grow">
                <b>选中的作品不在当前列表</b>
                <br />
                它可能已被删除，或作品列表刚刷新过。请重新选择一份作品。
              </div>
              <div className="actions">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setSelectedId(null);
                  }}
                >
                  清除选择
                </Button>
              </div>
            </div>
          ) : null}

          {selectedWork === undefined ? (
            <section className="card pad" aria-label="作品详情占位">
              <EmptyState
                icon="slides"
                title="选择一份作品"
                description={
                  works.length === 0
                    ? '作品列表为空。先在上方创建一份演示草稿。'
                    : '从左侧「最近演示」或「全部作品」里选择；选中后可以生成大纲/逐页内容、添加附件、编辑与导出。'
                }
              />
            </section>
          ) : (
            <PptWorkPanel
              key={selectedWork.id}
              work={selectedWork}
              projectName={projects.find((item) => item.id === selectedWork.projectId)?.name}
              busyKind={busyKind}
              lastResult={lastResult}
              onCommand={(command) => {
                void runCommand(command);
              }}
            />
          )}
        </div>
      </div>

      <div className="grid-3" style={{ marginTop: 16 }}>
        {STEPS.map((step) => (
          <section key={step.ordinal} className="card pad">
            <div className="row" style={{ gap: 8, marginBottom: 8 }}>
              <span className="badge outline num">{step.ordinal}</span>
              <Icon name={step.icon} size="sm" />
            </div>
            <h3 style={{ fontSize: 14, fontWeight: 500 }}>{step.title}</h3>
            <p className="hint" style={{ marginTop: 6, lineHeight: 1.6 }}>
              {step.detail}
            </p>
          </section>
        ))}
      </div>
    </div>
  );
}
