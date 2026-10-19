import {usePendingIdentityMatching,pendingIdentityMatching,isUncertainCommandFailure} from '../../api/pending-identity.ts';
import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ROUTES, createRequestKey, type WorkflowMethod } from '@agent-workflow/shared';
import { apiGet, errorMessage } from '../../api/client.ts';
import { useBootstrap } from '../../api/hooks.ts';
import { formatRelativeTime } from '../../app/format.ts';
import { Badge } from '../../components/Badge.tsx';
import { Button, LinkButton } from '../../components/Button.tsx';
import { PageHeader } from '../../components/Card.tsx';
import { EmptyState, Skeleton } from '../../components/EmptyState.tsx';
import { Icon } from '../../components/Icon.tsx';
import { Modal } from '../../components/Modal.tsx';
import { SegmentedControl, type SegmentOption } from '../../components/SegmentedControl.tsx';
import { ServiceNotice } from '../../components/ServiceNotice.tsx';
import {
  archiveWorkflow,
  builtinCatalogFromBootstrap,
  copyWorkflow,
  createWorkflow,
  fetchWorkflowDetail,
  fetchWorkflowList,
  isWorkflowUnavailable,
  workflowErrorDetail,
  type WorkflowCatalogDetail,
  type WorkflowCatalogEntry,
  type WorkflowDraft,
} from './workflow-api.ts';
import { WORKFLOW_STEP_KIND_LABEL, supportLabel } from './workflow-model.ts';
import './workflows.css';
import { WorkflowReadDetails } from './WorkflowReadDetails.tsx';

type SourceFilter = 'all' | 'mine' | 'builtin';

interface CommandReceipt {
  readonly label: string;
  readonly status: 'sending' | 'accepted' | 'succeeded' | 'failed' | 'unknown';
  readonly requestKey?: string;
  readonly message?: string;
  readonly lookup?: string;
}

const isWorkflowCommand=(path:string)=>path===ROUTES.workflows||path.startsWith(ROUTES.workflows+'/');
const LIST_KEY = ['workflows', 'list'] as const;

function hasSteps(entry: WorkflowCatalogEntry | WorkflowCatalogDetail): entry is WorkflowCatalogDetail {
  return Array.isArray((entry as WorkflowCatalogDetail).requiredSteps);
}

function builtinEntriesFromBootstrap(methods: readonly WorkflowMethod[]): readonly WorkflowCatalogDetail[] {
  return builtinCatalogFromBootstrap(methods);
}

function StepChain({ detail }: { readonly detail: WorkflowCatalogDetail }) {
  return (
    <ol className="wf-chain">
      {detail.requiredSteps.map((step, index) => (
        <li key={step.key} className="wf-chain-row">
          <span className="wf-chain-index mono">{String(index + 1).padStart(2, '0')}</span>
          <span className="grow" style={{ minWidth: 0 }}>
            <span className="wf-chain-title">{step.title}</span>
            <span className="hint wf-chain-meta">
              {WORKFLOW_STEP_KIND_LABEL[step.kind]} · {step.group}
              {step.roleId === undefined ? ' · 未指定职业' : ` · ${step.roleId}`}
              {step.optional === true ? ' · 可选' : ''}
            </span>
          </span>
          {step.roleId === undefined ? <Badge tone="warn" icon="help">未指定职业</Badge> : null}
        </li>
      ))}
    </ol>
  );
}

export function WorkflowsPage() {
  const bootstrap = useBootstrap();
  const queryClient = useQueryClient();
  const [source, setSource] = useState<SourceFilter>('all');
  const [keyword, setKeyword] = useState('');
  const [includeArchived, setIncludeArchived] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [localReceipt, setReceipt] = useState<CommandReceipt | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createDescription, setCreateDescription] = useState('');
  const [createSupport, setCreateSupport] = useState<'ai_planning' | 'skeleton_only'>('ai_planning');
  const [createError, setCreateError] = useState<string | undefined>(undefined);
  const [copyOpen, setCopyOpen] = useState(false);
  const [copyName, setCopyName] = useState('');
  const [copyError, setCopyError] = useState<string | undefined>(undefined);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [sending, setCommandBusy] = useState(false);
  const pending=usePendingIdentityMatching(isWorkflowCommand);
  const commandBusy=sending||pending!==undefined;
  const receipt:CommandReceipt|null=pending?{label:localReceipt?.requestKey===pending.requestKey?localReceipt.label:'流程操作',status:pending.phase==='sending'?'sending':pending.phase==='accepted'?'accepted':'unknown',requestKey:pending.requestKey,message:localReceipt?.requestKey===pending.requestKey?localReceipt.message:'原流程请求尚未结算，操作已锁定；请按原请求核对。',lookup:localReceipt?.lookup}:localReceipt;
  const guardPending=()=>{const existing=pendingIdentityMatching(isWorkflowCommand);if(!existing)return false;setReceipt({label:'流程操作',status:existing.phase==='accepted'?'accepted':'unknown',requestKey:existing.requestKey,message:'原请求尚未结算，请先核对原操作。'});return true;};

  const listQuery = useQuery({
    queryKey: [...LIST_KEY, includeArchived],
    queryFn: () => fetchWorkflowList({ includeArchived }),
    retry: false,
  });
  const fallbackMode = listQuery.data === undefined && isWorkflowUnavailable(listQuery.error);

  const fallbackEntries = useMemo(
    () => (fallbackMode && bootstrap.data !== undefined ? builtinEntriesFromBootstrap(bootstrap.data.catalog.methods) : []),
    [bootstrap.data, fallbackMode],
  );

  const entries: readonly (WorkflowCatalogEntry | WorkflowCatalogDetail)[] = listQuery.data ?? fallbackEntries;
  const filtered = useMemo(() => {
    const needle = keyword.trim().toLowerCase();
    return entries.filter((entry) => {
      if (source === 'mine' && entry.source !== 'custom') return false;
      if (source === 'builtin' && entry.source !== 'builtin') return false;
      if (needle === '') return true;
      return `${entry.name} ${entry.description} ${entry.id}`.toLowerCase().includes(needle);
    });
  }, [entries, keyword, source]);

  const selectedEntry = entries.find((entry) => entry.id === selectedId) ?? filtered[0];
  const selectedHasSteps = selectedEntry !== undefined && hasSteps(selectedEntry);
  const detailQuery = useQuery({
    queryKey: ['workflows', 'detail', selectedEntry?.id ?? ''],
    queryFn: () => fetchWorkflowDetail(selectedEntry?.id ?? ''),
    enabled: selectedEntry !== undefined && !selectedHasSteps,
    retry: false,
  });
  const fallbackDetail = selectedEntry !== undefined && hasSteps(selectedEntry) ? selectedEntry : undefined;
  const detail = fallbackDetail ?? detailQuery.data;

  const sourceOptions: readonly SegmentOption<SourceFilter>[] = [
    { value: 'all', label: '全部', count: entries.length },
    { value: 'mine', label: '我的流程', count: entries.filter((entry) => entry.source === 'custom').length },
    { value: 'builtin', label: '程序内置', count: entries.filter((entry) => entry.source === 'builtin').length },
  ];

  const refresh = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: ['workflows'] });
    await queryClient.invalidateQueries({ queryKey: ['bootstrap'] });
  };

  const reconcile = async (requestKey: string): Promise<void> => {
    setReceipt((current) => (current === null ? current : { ...current, lookup: '正在按原请求核对…' }));
    try {
      const response = await apiGet<{ operation: { status: string; error?: { message: string } }; stillUnknown: boolean }>(ROUTES.operationsByKey(requestKey));
      const status = response.data.operation.status;
      await refresh();
      setReceipt((current) => ({
            ...(current??{label:'流程操作',requestKey}),
            status:status==='succeeded'?'succeeded':status==='failed'?'failed':status==='accepted'?'accepted':'unknown',
            lookup:
              status === 'succeeded'
                ? '核对结果：原操作已成功结算。'
                : status === 'failed'
                  ? `核对结果：原操作失败（${response.data.operation.error?.message ?? '未提供原因'}）。`
                  : '核对结果：仍未结算。',
          }));
    } catch (error) {
      setReceipt((current) => ({...(current??{label:'流程操作',requestKey,status:'unknown'}),lookup:`核对失败：${errorMessage(error)}`}));
    }
  };

  const showCommandError = (label: string, error: unknown, requestKey: string): void => {
    const unknown = isUncertainCommandFailure(error);
    setReceipt({
      label,
      status: unknown ? 'unknown' : 'failed',
      requestKey,
      message: unknown ? '请求已发出但没有收到回执；不会自动重发，可按原请求号核对。' : workflowErrorDetail(error),
    });
  };

  const submitCreate = async (): Promise<void> => {
    if(guardPending())return;
    const name = createName.trim();
    if (name === '') {
      setCreateError('流程名称不能为空。');
      return;
    }
    if (name.length > 120) {
      setCreateError('流程名称最多 120 个字符。');
      return;
    }
    const draft: WorkflowDraft = {
      name,
      description: createDescription.trim(),
      support: createSupport,
      requiredSteps: [
        { key: 'step.first', title: '第一步', kind: 'implementation', group: '固定步骤' },
        { key: 'step.delivery', title: '交付', kind: 'delivery', group: '固定步骤' },
      ],
      refinableGroups: [],
    };
    const requestKey = createRequestKey();
    setCommandBusy(true);
    setCreateError(undefined);
    try {
      const mutation = await createWorkflow({ draft, requestKey });
      setReceipt({ label: '新建流程', status: 'succeeded', requestKey });
      setCreateOpen(false);
      setCreateName('');
      setCreateDescription('');
      await refresh();
      setSelectedId(mutation.method.id);
    } catch (error) {
      showCommandError('新建流程', error, requestKey);
      setCreateError(isUncertainCommandFailure(error)?undefined:workflowErrorDetail(error));
    } finally {
      setCommandBusy(false);
    }
  };

  const submitCopy = async (): Promise<void> => {
    if(guardPending())return;
    if (selectedEntry === undefined) return;
    const name = copyName.trim();
    if (name === '') {
      setCopyError('副本名称不能为空。');
      return;
    }
    if (name.length > 120) {
      setCopyError('副本名称最多 120 个字符。');
      return;
    }
    const requestKey = createRequestKey();
    setCommandBusy(true);
    setCopyError(undefined);
    try {
      const mutation = await copyWorkflow({ id: selectedEntry.id, name, requestKey });
      setReceipt({ label: '复制流程', status: 'succeeded', requestKey });
      setCopyOpen(false);
      await refresh();
      setSelectedId(mutation.method.id);
    } catch (error) {
      showCommandError('复制流程', error, requestKey);
      setCopyError(isUncertainCommandFailure(error)?undefined:workflowErrorDetail(error));
    } finally {
      setCommandBusy(false);
    }
  };

  const submitArchive = async (): Promise<void> => {
    if(guardPending())return;
    if (selectedEntry === undefined) return;
    const requestKey = createRequestKey();
    setCommandBusy(true);
    try {
      await archiveWorkflow({ id: selectedEntry.id, requestKey });
      setReceipt({ label: '归档流程', status: 'succeeded', requestKey });
      setArchiveOpen(false);
      setSelectedId(null);
      await refresh();
    } catch (error) {
      showCommandError('归档流程', error, requestKey);
      setArchiveOpen(false);
    } finally {
      setCommandBusy(false);
    }
  };

  const listBody =
    listQuery.isLoading && bootstrap.isLoading ? (
      <div className="col" style={{ gap: 8 }}>
        {[0, 1, 2].map((index) => (
          <Skeleton key={index} height={44} width="100%" radius={10} />
        ))}
      </div>
    ) : listQuery.isError && !fallbackMode ? (
      <ServiceNotice error={listQuery.error} onRetry={() => { void listQuery.refetch(); }} title="流程目录读取失败" />
    ) : filtered.length === 0 ? (
      <EmptyState
        icon="flow"
        title={entries.length === 0 ? '目录里还没有流程' : '没有匹配的流程'}
        description={entries.length === 0 ? '新建一个流程，或等待内置目录返回。页面不展示示例流程。' : '换个关键词或筛选；筛选只影响展示。'}
        action={
          entries.length === 0 ? (
            <Button
              variant="primary"
              size="sm"
              icon="plus"
              disabled={fallbackMode||commandBusy}
              disabledReason={fallbackMode ? '当前服务不支持流程写入，暂时不能新建' :commandBusy?'原操作尚未结算，请先核对原请求': undefined}
              onClick={() => { setCreateOpen(true); }}
            >
              新建流程
            </Button>
          ) : undefined
        }
      />
    ) : (
      <div className="wf-list" role="list">
        {filtered.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="listitem"
            className="wf-row"
            aria-selected={selectedEntry?.id === entry.id}
            onClick={() => {
              setSelectedId(entry.id);
            }}
          >
            <span className="tile">
              <Icon name={entry.source === 'builtin' ? 'template' : 'flow'} />
            </span>
            <span className="grow" style={{ minWidth: 0 }}>
              <span className="row" style={{ gap: 8 }}>
                <span className="wf-row-name ellipsis">{entry.name}</span>
                {entry.source === 'builtin' ? <Badge outline>内置</Badge> : <Badge tone="accent">我的</Badge>}
                {entry.archived ? <Badge tone="idle">已归档</Badge> : null}
              </span>
              <span className="hint ellipsis wf-row-desc">{entry.description}</span>
            </span>
            <span className="wf-row-meta hint">
              {entry.revision} · {String(entry.stepCount)} 步
              {entry.usage === undefined ? ' · 使用次数未知' : ` · ${entry.usage.taskCount} 个任务`}
              {entry.updatedAt === undefined ? null : ` · ${formatRelativeTime(entry.updatedAt)}`}
            </span>
            <Icon name="chevRight" size="sm" />
          </button>
        ))}
      </div>
    );

  return (
    <div className="page wf-page">
      <PageHeader
        title="流程"
        lede="流程目录：程序内置流程只读，我的流程可以编辑；步骤链、复制、归档都走服务真实接口。流程只定义固定步骤，确认计划与开始执行在具体任务里操作。"
        actions={
          <Button
            variant="primary"
            size="sm"
            icon="plus"
            disabled={fallbackMode||commandBusy}
            disabledReason={fallbackMode ? '当前服务不支持流程写入' :commandBusy?'原操作尚未结算，请先核对原请求': undefined}
            onClick={() => {
              setCreateName('');
              setCreateDescription('');
              setCreateError(undefined);
              setCreateOpen(true);
            }}
          >
            新建流程
          </Button>
        }
      />

      {fallbackMode ? (
        <div className="banner warn" style={{ marginBottom: 14 }}>
          <Icon name="info" />
          <div className="grow">
            <b>当前服务未提供流程目录</b>
            <br />
            当前显示已加载的内置流程，只能查看。服务恢复后重新读取目录，即可核对可用操作。
          </div>
        </div>
      ) : null}

      {receipt === null ? null : (
        <div className={['banner', receipt.status === 'succeeded' ? 'ok' : receipt.status === 'unknown' ? 'unknown' : (receipt.status === 'accepted'||receipt.status==='sending') ? 'info' : 'danger'].join(' ')} style={{ marginBottom: 14 }} role={receipt.status === 'succeeded' ? 'status' : 'alert'}>
          <Icon name={receipt.status === 'succeeded' ? 'check' : receipt.status === 'unknown' ? 'help' : (receipt.status === 'accepted'||receipt.status==='sending') ? 'clock' : 'alert'} />
          <div className="grow">
            <b>
              {receipt.label} · {receipt.status === 'succeeded' ? '已完成' : receipt.status === 'unknown' ? '结果未明' : receipt.status==='sending'?'发送中':receipt.status === 'accepted' ? '已接受，等待结算' : '失败'}
            </b>
            {receipt.requestKey === undefined ? null : <span className="mono" style={{ marginLeft: 8 }}>{receipt.requestKey}</span>}
            {receipt.message === undefined ? null : <div style={{ marginTop: 4 }}>{receipt.message}</div>}
            {receipt.lookup === undefined ? null : <div className="hint" style={{ marginTop: 4 }}>{receipt.lookup}</div>}
          </div>
          <div className="actions">
            {(receipt.status === 'unknown'||receipt.status==='accepted') && receipt.requestKey !== undefined ? (
              <Button variant="secondary" size="sm" icon="search" onClick={() => { void reconcile(receipt.requestKey!); }}>
                核对原操作
              </Button>
            ) : null}
            <Button variant="ghost" size="sm" icon="x" onClick={() => { setReceipt(null); }}>收起</Button>
          </div>
        </div>
      )}

      <div className="wf-layout">
        <section className="card pad wf-catalog" aria-label="流程目录">
          <div className="toolbar" style={{ marginTop: 0 }}>
            <div className="input-wrap grow">
              <Icon name="search" />
              <input
                className="input ctl"
                placeholder="搜索流程名称或说明"
                aria-label="搜索流程"
                value={keyword}
                onChange={(event) => { setKeyword(event.target.value); }}
              />
            </div>
            <SegmentedControl ariaLabel="流程来源" options={sourceOptions} value={source} onChange={setSource} />
            <label className="row hint" style={{ gap: 6, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={includeArchived}
                disabled={fallbackMode||commandBusy}
                onChange={(event) => { setIncludeArchived(event.target.checked); }}
              />
              显示已归档
            </label>
          </div>
          <p className="hint" style={{ margin: '6px 0 12px' }}>
            使用次数包含全部版本和已归档任务；最近使用按任务创建时间排列。
          </p>
          {listBody}
        </section>

        <aside className="card wf-detail" aria-label="流程详情">
          {selectedEntry === undefined ? (
            <div className="card-body">
              <EmptyState icon="flow" title="选择一个流程" description="左侧选择流程查看步骤链与操作；内置流程只读，可复制后修改。" compact />
            </div>
          ) : (
            <>
              <div className="card-head" style={{ alignItems: 'flex-start' }}>
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="row wrap" style={{ gap: 6 }}>
                    <Badge tone={selectedEntry.source === 'builtin' ? 'idle' : 'accent'} icon={selectedEntry.source === 'builtin' ? 'lock' : 'users'}>
                      {selectedEntry.source === 'builtin' ? '程序内置' : '我的流程'}
                    </Badge>
                    <Badge outline>{selectedEntry.revision} · 版本 {String(selectedEntry.version)}</Badge>
                    <Badge outline>{supportLabel(selectedEntry.support)}</Badge>
                    {selectedEntry.archived ? <Badge tone="idle">已归档</Badge> : null}
                  </div>
                  <h2 className="wf-detail-title" style={{ fontSize: 18, fontWeight: 500 }}>{selectedEntry.name}</h2>
                  <p className="hint" style={{ lineHeight: 1.7 }}>{selectedEntry.description}</p>
                  {selectedEntry.updatedAt === undefined ? null : (
                    <p className="hint">更新于 {formatRelativeTime(selectedEntry.updatedAt)}</p>
                  )}
                </div>
              </div>
              <div className="card-body" style={{ paddingTop: 0 }}>
                {detailQuery.isLoading ? (
                  <div className="col" style={{ gap: 8 }}>
                    <Skeleton height={14} width="52%" />
                    <Skeleton height={80} width="100%" radius={10} />
                  </div>
                ) : detailQuery.isError && !fallbackMode ? (
                  <ServiceNotice error={detailQuery.error} onRetry={() => { void detailQuery.refetch(); }} title="流程详情读取失败" compact />
                ) : detail === undefined ? (
                  <p className="hint">服务没有返回流程步骤详情。</p>
                ) : (
                  <>
                    <div className="eyebrow" style={{ marginBottom: 8 }}>步骤链 · {String(detail.requiredSteps.length)} 个</div>
                    <StepChain detail={detail} />
                    <p className="hint" style={{ marginTop: 8 }}>
                      步骤按流程定义展示；执行依赖以具体任务的已确认计划为准。
                    </p>
                    <WorkflowReadDetails detail={detail} />
                  </>
                )}

                <div className="row wrap" style={{ gap: 8, marginTop: 18 }}>
                  <LinkButton
                    variant="primary"
                    size="sm"
                    icon="plus"
                    to={`/start?methodId=${encodeURIComponent(selectedEntry.id)}`}
                    className="grow"
                  >
                    用这个流程开始任务
                  </LinkButton>
                </div>
                <div className="row wrap" style={{ gap: 8, marginTop: 8 }}>
                  <LinkButton
                    variant="secondary"
                    size="sm"
                    icon={selectedEntry.source === 'builtin' ? 'eye' : 'edit'}
                    to={`/workflows/${encodeURIComponent(selectedEntry.id)}/edit`}
                  >
                    {selectedEntry.source === 'builtin' ? '查看步骤' : '编辑流程'}
                  </LinkButton>
                  <Button
                    variant="secondary"
                    size="sm"
                    icon="copy"
                    disabled={fallbackMode || commandBusy || selectedEntry.archived}
                    disabledReason={
                      fallbackMode
                        ? '当前服务不支持流程写入'
                        : selectedEntry.archived
                          ? '已归档流程不能复制'
                          : commandBusy
                            ? '另一条流程命令正在等待回执'
                            : undefined
                    }
                    onClick={() => {
                      setCopyName(`${selectedEntry.name} 副本`);
                      setCopyError(undefined);
                      setCopyOpen(true);
                    }}
                  >
                    复制
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    icon="archive"
                    disabled={fallbackMode || commandBusy || selectedEntry.source !== 'custom'}
                    disabledReason={
                      fallbackMode
                        ? '当前服务不支持流程写入'
                        : selectedEntry.source !== 'custom'
                          ? '内置流程不能归档'
                          : commandBusy
                            ? '另一条流程命令正在等待回执'
                            : undefined
                    }
                    onClick={() => { setArchiveOpen(true); }}
                  >
                    归档…
                  </Button>
                </div>
                <p className="hint" style={{ marginTop: 10 }}>
                  内置流程只读：复制后会得到一份可修改的「我的流程」；归档只影响目录与开始任务，已有任务不受影响、历史保留。
                </p>
              </div>
            </>
          )}
        </aside>
      </div>

      <Modal
        open={createOpen}
        title="新建流程"
        onClose={() => { if (!sending) setCreateOpen(false); }}
        footer={
          <>
            <Button variant="ghost" disabled={sending} onClick={() => { setCreateOpen(false); }}>取消</Button>
            <Button
              variant="primary"
              icon="plus"
              disabled={commandBusy || createName.trim() === ''}
              disabledReason={commandBusy ? '原操作尚未结算，请先核对原请求' : createName.trim() === '' ? '流程名称不能为空' : undefined}
              onClick={() => { void submitCreate(); }}
            >
              {sending?'正在创建…':pending?'待核对':'创建并编辑'}
            </Button>
          </>
        }
      >
        <div className="col" style={{ gap: 14 }}>
          <div className="field" style={{ margin: 0 }}>
            <label className="label" htmlFor="wf-create-name">名称</label>
            <input id="wf-create-name" className="input" value={createName} maxLength={120} disabled={commandBusy} onChange={(event) => { setCreateName(event.target.value); setCreateError(undefined); }} />
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label className="label" htmlFor="wf-create-desc">说明</label>
            <textarea id="wf-create-desc" className="textarea" value={createDescription} disabled={commandBusy} onChange={(event) => { setCreateDescription(event.target.value); }} />
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label className="label" htmlFor="wf-create-support">规划支持</label>
            <select id="wf-create-support" className="select" value={createSupport} disabled={commandBusy} onChange={(event) => { setCreateSupport(event.target.value === 'skeleton_only' ? 'skeleton_only' : 'ai_planning'); }}>
              <option value="ai_planning">AI 规划</option>
              <option value="skeleton_only">仅方法骨架</option>
            </select>
            <span className="hint">会先创建两个初始步骤（第一步 + 交付），随后进入编辑器；服务要求至少保留交付或验收步骤。</span>
          </div>
          {createError === undefined ? null : <p className="error-text">{createError}</p>}
        </div>
      </Modal>

      <Modal
        open={copyOpen}
        title="复制流程"
        onClose={() => { if (!sending) setCopyOpen(false); }}
        footer={
          <>
            <Button variant="ghost" disabled={sending} onClick={() => { setCopyOpen(false); }}>取消</Button>
            <Button
              variant="primary"
              icon="copy"
              disabled={commandBusy || copyName.trim() === ''}
              disabledReason={commandBusy ? '原操作尚未结算，请先核对原请求' : copyName.trim() === '' ? '副本名称不能为空' : undefined}
              onClick={() => { void submitCopy(); }}
            >
              {sending?'正在复制…':pending?'待核对':'复制'}
            </Button>
          </>
        }
      >
        <div className="col" style={{ gap: 12 }}>
          <div className="field" style={{ margin: 0 }}>
            <label className="label" htmlFor="wf-copy-name">副本名称</label>
            <input id="wf-copy-name" className="input" value={copyName} maxLength={120} disabled={commandBusy} onChange={(event) => { setCopyName(event.target.value); setCopyError(undefined); }} />
            <span className="hint">将复制{selectedEntry === undefined ? '' : `「${selectedEntry.name}」版本 ${String(selectedEntry.version)}`}的步骤定义。</span>
          </div>
          {copyError === undefined ? null : <p className="error-text">{copyError}</p>}
        </div>
      </Modal>

      <Modal
        open={archiveOpen}
        title="归档流程？"
        onClose={() => { if (!sending) setArchiveOpen(false); }}
        footer={
          <>
            <Button variant="ghost" disabled={sending} onClick={() => { setArchiveOpen(false); }}>取消</Button>
            <Button
              variant="danger"
              icon="archive"
              disabled={commandBusy}
              disabledReason={commandBusy ? '原操作尚未结算，请先核对原请求' : undefined}
              onClick={() => { void submitArchive(); }}
            >
              {sending?'正在归档…':pending?'待核对':'归档'}
            </Button>
          </>
        }
      >
        <p style={{ lineHeight: 1.7 }}>
          「{selectedEntry?.name ?? ''}」归档后不再出现在流程目录和开始任务里；已有任务不受影响，历史保留。归档会返回回执；结果未明时可按原请求核对，不会自动重发。
        </p>
      </Modal>
    </div>
  );
}
