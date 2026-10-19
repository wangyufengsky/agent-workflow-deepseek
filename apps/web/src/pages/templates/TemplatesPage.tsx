import { TemplateArchivePanel } from './TemplateArchivePanel.tsx';
import { TemplateScopeFields, TemplateBranchField, type ScopeInput } from './TemplateScopeFields.tsx';
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  ROUTES,
  createRequestKey,
  type CommandResponse,
  type CreateTaskRequest,
  type OperationsByKeyResponse,
  type ProjectSummary,
  type TaskDetailResponse,
  type TaskTemplate,
  type TemplateDetailResponse,
  type TemplateTasksResponse,
} from '@agent-workflow/shared';
import { ApiClientError, apiGet, apiPost, errorMessage, isServiceUnavailable } from '../../api/client.ts';
import { queryKeys, useBootstrap } from '../../api/hooks.ts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge } from '../../components/Badge.tsx';
import { Button, LinkButton } from '../../components/Button.tsx';
import { PageHeader } from '../../components/Card.tsx';
import { EmptyState } from '../../components/EmptyState.tsx';
import { Icon } from '../../components/Icon.tsx';
import { ServiceNotice } from '../../components/ServiceNotice.tsx';
import {
  ArchiveTemplateDialog,
  JsonTemplateEditor,
  VisualTemplateEditor,
  type TemplateArchiveResult,
  type TemplateSaveResult,
} from './TemplateEditors.tsx';

const CREATE_LOCK_NOTE = '固定模板任务创建后不能修改步骤；要改要求，请新建模板任务。';

type CatalogNoticeTone = 'ok' | 'warn' | 'danger' | 'unknown';

interface CatalogNotice {
  readonly tone: CatalogNoticeTone;
  readonly title: string;
  readonly detail?: string;
}

const NOTICE_ICONS: Readonly<Record<CatalogNoticeTone, 'check' | 'alert' | 'help'>> = {
  ok: 'check',
  warn: 'alert',
  danger: 'alert',
  unknown: 'help',
};

type CreatePhase = 'idle' | 'submitting' | 'succeeded' | 'failed' | 'unknown';

interface CreateState {
  readonly phase: CreatePhase;
  readonly requestKey: string;
  readonly body: CreateTaskRequest;
  readonly message?: string;
  readonly taskId?: string;
  readonly receiptStatus?: string;
}

function templateIcon(template: TaskTemplate) {
  return template.parameters.length > 0 ? 'template' : 'layers';
}

type TemplateGroupKey = 'report' | 'review' | 'dev';

const TEMPLATE_GROUPS: readonly { readonly key: TemplateGroupKey; readonly label: string }[] = [
  { key: 'report', label: '报告' },
  { key: 'review', label: '代码审查' },
  { key: 'dev', label: '开发' },
];

/** 服务没有模板分类字段：按名称/标识启发式归类，页面上必须注明。 */
function templateGroupOf(template: TaskTemplate): TemplateGroupKey {
  if (template.group) return template.group;
  const text = `${template.id} ${template.name}`.toLowerCase();
  if (/(报告|周报|汇报|摘要|report|summary|digest)/.test(text)) return 'report';
  if (/(审阅|评审|审查|复核|review|audit)/.test(text)) return 'review';
  return 'dev';
}

function groupedTemplates(templates: readonly TaskTemplate[]) {
  return TEMPLATE_GROUPS.map((group) => ({
    ...group,
    items: templates.filter((template) => templateGroupOf(template) === group.key),
  })).filter((group) => group.items.length > 0);
}

function ParameterField({ template, parameters, disabled, onChange }: {
  readonly template: TaskTemplate;
  readonly parameters: Record<string, string>;
  readonly disabled: boolean;
  readonly onChange: (key: string, value: string) => void;
}) {
  if (template.parameters.length === 0) {
    return <p className="hint">这个模板没有额外参数。</p>;
  }
  return (
    <div className="col" style={{ gap: 16 }}>
      {template.parameters.filter((parameter) => template.kind !== 'snapshot_review' || !['mode', 'targetRef', 'baselineRef'].includes(parameter.key)).map((parameter, index) => {
        const value = parameters[parameter.key] ?? '';
        return (
          <div key={parameter.key} className="field" style={{ margin: 0 }}>
            <label className="label" htmlFor={`tpl-param-${parameter.key}`}>
              {parameter.label}
              {parameter.required ? <span className="req">*</span> : <span className="opt">可选</span>}
            </label>
            {template.kind === 'snapshot_review' && (parameter.key === 'mode' || parameter.key === 'depth') ? <select id={`tpl-param-${parameter.key}`} className="select" value={value} disabled={disabled} onChange={(event) => { onChange(parameter.key, event.target.value); }}><option value="">选择{parameter.key === 'mode' ? '审查方式' : '审查深度'}</option>{(parameter.key === 'mode' ? [['full', '全面审查'], ['incremental', '增量审查']] : [['full', '全量审查'], ['lightweight', '轻量审查']]).map(([id, label]) => <option value={id} key={id}>{label}</option>)}</select> : <input
              id={`tpl-param-${parameter.key}`}
              className="input mono"
              value={value}
              disabled={disabled}
              placeholder={template.kind === 'snapshot_review' ? parameter.key === 'targetRef' ? 'HEAD' : parameter.key === 'baselineRef' ? '增量基线提交或分支' : '相对项目路径，逗号分隔' : index === 0 ? '相对项目目录或绝对路径' : ''}
              onChange={(event) => {
                onChange(parameter.key, event.target.value);
              }}
            />}
            <span className="hint mono">
              {parameter.key}
              {parameter.required ? ' · 必填' : ' · 可留空'}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function TemplatesPage() {
  const bootstrap = useBootstrap();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [planBusy, setPlanBusy] = useState(false);
  const [planError, setPlanError] = useState<string | undefined>(undefined);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  const [importError, setImportError] = useState<string | undefined>(undefined);
  const [catalogNotice, setCatalogNotice] = useState<CatalogNotice | null>(null);
  const [editor, setEditor] = useState<{ readonly mode: 'visual' | 'json'; readonly templateId: string } | null>(null);
  const [archiveTemplateId, setArchiveTemplateId] = useState<string | null>(null);
  const templates = bootstrap.data?.catalog.templates ?? [];
  const methods = bootstrap.data?.catalog.methods ?? [];
  const projects: readonly ProjectSummary[] = bootstrap.data?.projects ?? [];

  const [params] = useSearchParams();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [projectId, setProjectId] = useState(() => params.get('project') ?? '');
  const [title, setTitle] = useState('');
  const [requirementText, setRequirementText] = useState('');
  const [methodId, setMethodId] = useState('');
  const [scope, setScope] = useState<ScopeInput>({});
  const [parameters, setParameters] = useState<Record<string, string>>({});
  const [keyword, setKeyword] = useState('');
  const [state, setState] = useState<CreateState | null>(null);

  const template = templates.find((item) => item.id === selectedId) ?? templates[0];
  const editorTemplate = editor === null ? undefined : templates.find((item) => item.id === editor.templateId);
  const archiveTemplate = archiveTemplateId === null ? undefined : templates.find((item) => item.id === archiveTemplateId);
  const historyQuery = useQuery({
    queryKey: ['template', 'tasks', template?.id ?? ''],
    queryFn: async () => (await apiGet<TemplateTasksResponse>(ROUTES.templateTasks(template!.id))).data,
    enabled: template !== undefined,
    retry: false,
  });
  const filtered = useMemo(() => {
    const needle = keyword.trim().toLowerCase();
    if (needle.length === 0) return templates;
    return templates.filter((item) => [item.name, item.id, ...item.steps.map((step) => step.title)].join(' ').toLowerCase().includes(needle));
  }, [keyword, templates]);

  const effectiveMethodId = methodId.length > 0 ? methodId : (methods[0]?.id ?? '');
  const selectedMethod = methods.find((method) => method.id === effectiveMethodId);
  const formLocked = state?.phase === 'submitting' || state?.phase === 'unknown';

  const missingFields: string[] = [];
  if (projectId.length === 0) missingFields.push('项目');
  else if (!projects.some((project) => project.id === projectId && !['path_unavailable', 'capability_unavailable'].includes(project.gitState))) missingFields.push('项目不可用，请重新选择');
  if (effectiveMethodId.length === 0) missingFields.push('目录方法');
  if (!scope.branch) missingFields.push('分支');
  if (template?.inputs?.dates && !scope.dateRange) missingFields.push('时间范围');
  if (template?.inputs?.source && !scope.sourcePaths?.length) missingFields.push('源码范围');
  if (template?.inputs?.documents && !scope.documents?.length) missingFields.push('需求文档');
  if (template !== undefined) {
    for (const parameter of template.parameters) {
      if (parameter.required && (parameters[parameter.key] ?? '').trim().length === 0) missingFields.push(parameter.label);
    }
  }
  const canSubmit = template !== undefined && missingFields.length === 0 && !formLocked;

  const resetForm = () => {
    setState(null);
    setTitle('');
    setRequirementText('');
    setParameters({});
    setScope({});
  };

  const submit = async (requestKey = createRequestKey(), body?: CreateTaskRequest) => {
    if (template === undefined) return;
    const payload: CreateTaskRequest =
      body ?? {
        requestKey,
        projectId,
        title: title.trim() || `${template.name} · ${projects.find((project) => project.id === projectId)?.name ?? '项目'}`,
        requirementText: requirementText.trim() || template.description || template.name,
        methodId: effectiveMethodId,
        template: { templateId: template.id, parameters, scope },
      };
    setState({ phase: 'submitting', requestKey, body: payload });
    try {
      const response = await apiPost<CommandResponse<TaskDetailResponse>>(ROUTES.tasks, payload);
      const result = response.data;
      const status = result.receipt.status;
      const createdTaskId = result.resource?.task.id;
      if (status === 'succeeded') {
        setState({
          phase: 'succeeded',
          requestKey,
          body: payload,
          receiptStatus: status,
          ...(createdTaskId === undefined ? {} : { taskId: createdTaskId }),
        });
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: queryKeys.bootstrap }),
          queryClient.invalidateQueries({ queryKey: ['tasks'] }),
          queryClient.invalidateQueries({ queryKey: ['template', 'tasks', template.id] }),
        ]);
      } else if (status === 'failed') {
        setState({
          phase: 'failed',
          requestKey,
          body: payload,
          message: result.receipt.error?.message ?? '服务返回失败回执，任务没有创建。',
        });
      } else {
        setState({
          phase: 'unknown',
          requestKey,
          body: payload,
          message: '创建请求已发出，但服务只返回 accepted / unknown 回执，尚未确认创建结果。',
        });
      }
    } catch (error) {
      // A connection failure or timeout leaves the outcome unknown on the client:
      // the service may still have created the task. Never silently resubmit.
      const unknown = error instanceof ApiClientError && (error.kind === 'timeout' || error.kind === 'unavailable');
      setState({
        phase: unknown ? 'unknown' : 'failed',
        requestKey,
        body: payload,
        message: errorMessage(error),
      });
    }
  };

  const reconcile = async () => {
    if (state === null) return;
    try {
      const response = await apiGet<OperationsByKeyResponse>(ROUTES.operationsByKey(state.requestKey));
      const operation = response.data.operation;
      if (operation.status === 'succeeded') {
        const outcome = operation.outcome ?? {};
        const createdTaskId = typeof outcome.taskId === 'string' ? outcome.taskId : operation.target.taskId;
        setState({
          ...state,
          phase: 'succeeded',
          receiptStatus: operation.status,
          ...(createdTaskId === undefined ? {} : { taskId: createdTaskId }),
          message: '按原请求核对：创建已成功。',
        });
        await queryClient.invalidateQueries({ queryKey: queryKeys.bootstrap });
      } else if (operation.status === 'failed') {
        setState({ ...state, phase: 'failed', message: operation.error?.message ?? '按原请求核对：创建失败。' });
      } else {
        setState({ ...state, phase: 'unknown', message: '核对后仍未确认结果；不会自动重复创建。' });
      }
    } catch (error) {
      setState({ ...state, message: `核对失败：${errorMessage(error)}` });
    }
  };

  const handleTemplateSaved = async (result: TemplateSaveResult) => {
    setEditor(null);
    setSelectedId(result.templateId);
    setCatalogNotice({
      tone: 'ok',
      title: result.version === undefined ? '模板已保存' : `模板已保存为版本 ${String(result.version)}`,
      detail: `回执 ${result.receiptStatus} · requestKey ${result.requestKey}${result.auditId === undefined ? '' : ` · auditId ${result.auditId}`}`,
    });
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.bootstrap }),
      queryClient.invalidateQueries({ queryKey: ['template', 'tasks', result.templateId] }),
    ]);
  };

  const handleTemplateArchived = async (result: TemplateArchiveResult) => {
    setArchiveTemplateId(null);
    setSelectedId(null);
    setCatalogNotice({
      tone: 'ok',
      title: '自定义模板已归档',
      detail:
        result.receiptStatus === undefined
          ? `服务未返回回执（归档路由暂未签发）；已按模板目录核对 · requestKey ${result.requestKey}`
          : `回执 ${result.receiptStatus} · requestKey ${result.requestKey}${result.auditId === undefined ? '' : ` · auditId ${result.auditId}`}`,
    });
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.bootstrap }),
      queryClient.invalidateQueries({ queryKey: ['template', 'tasks'] }),
    ]);
  };

  const verifyArchived = async (templateId: string): Promise<boolean> => {
    const result = await bootstrap.refetch();
    const data = result.data;
    if (data === undefined) throw new Error('刷新模板目录失败，无法确认归档结果。');
    return !data.catalog.templates.some((item) => item.id === templateId);
  };

  let content: ReactNode;
  if (bootstrap.isLoading) {
    content = <p className="hint">正在读取模板目录…</p>;
  } else if (bootstrap.isError) {
    content = (
      <ServiceNotice
        error={bootstrap.error}
        onRetry={() => {
          void bootstrap.refetch();
        }}
      />
    );
  } else if (templates.length === 0) {
    content = <EmptyState icon="template" title="目录里还没有固定模板" description="服务已连接，但 catalog.templates 为空。固定模板由共享契约配置，本页不伪造模板。" />;
  } else if (template === undefined) {
    content = <EmptyState icon="search" title="没有匹配的模板" description="换个关键词，或清空搜索。" />;
  } else {
    content = (
      <div className="grid-2" style={{ gridTemplateColumns: 'minmax(0, 320px) minmax(0, 1fr)', alignItems: 'start' }}>
        <aside className="card" aria-label="模板" style={{ padding: 6 }}>
          <div className="row" style={{ padding: '8px 8px 4px' }}>
            <span className="eyebrow grow">固定模板 · {String(templates.length)}</span>
          </div>
          {groupedTemplates(filtered).map((group) => (
            <div key={group.key} className="col" style={{ gap: 2 }}>
              <div className="row" style={{ padding: '8px 12px 2px' }}>
                <span className="hint grow">{group.label}</span>
                <span className="hint num">{String(group.items.length)}</span>
              </div>
              {group.items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="list-row"
                  aria-selected={template.id === item.id}
                  disabled={formLocked}
                  onClick={() => {
                    setSelectedId(item.id);
                    setParameters(item.kind === 'snapshot_review' ? { mode: 'full', depth: 'full' } : {});
                    setScope((current) => ({ branch: current.branch }));
                    setState(null);
                  }}
                >
                  <span className="tile">
                    <Icon name={templateIcon(item)} />
                  </span>
                  <span className="grow" style={{ minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 13.5 }}>{item.name}</span>
                    <span className="hint" style={{ display: 'block', marginTop: 2 }}>
                      版本 {String(item.version)} · {String(item.steps.length)} 个固定步骤
                    </span>
                  </span>
                  <Icon name="chevRight" size="sm" />
                </button>
              ))}
            </div>
          ))}
          <p className="hint" style={{ padding: '8px 12px 2px' }}>
            模板按服务提供的报告 / 代码审查 / 开发分类；旧自定义模板按名称归类。
          </p>
          <div style={{ padding: '10px 12px', boxShadow: 'inset 0 1px 0 var(--line)' }}>
            <LinkButton to="/start" variant="ghost" size="sm" icon="plus">
              没有合适的模板？开始一个需求任务
            </LinkButton>
          </div>
        </aside>

        <div className="col" style={{ gap: 16 }}>
          <section className="card">
            <div style={{ padding: '20px 22px 18px', boxShadow: 'inset 0 -1px 0 var(--line)' }}>
              <div className="row wrap" style={{ gap: 6 }}>
                <Badge outline icon="template">
                  固定模板
                </Badge>
                <Badge outline>版本 {String(template.version)}</Badge>
                <Badge tone="idle" icon="lock">
                  创建后步骤不可修改
                </Badge>
              </div>
              <div className="row wrap" style={{ gap: 8, marginTop: 10 }}>
                <h2 style={{ fontSize: 20, fontWeight: 500, margin: 0 }}>{template.name}</h2>
                <span className="spacer" />
                <Button
                  variant="ghost"
                  size="sm"
                  icon="doc"
                  onClick={() => {
                    void (async () => {
                      try {
                        const detail = (await apiGet<TemplateDetailResponse>(ROUTES.templateDetail(template.id))).data;
                        const blob = new Blob([JSON.stringify(detail, null, 2)], { type: 'application/json' });
                        const url = URL.createObjectURL(blob);
                        const anchor = document.createElement('a');
                        anchor.href = url;
                        anchor.download = `${template.id}-v${String(template.version)}.json`;
                        anchor.click();
                        URL.revokeObjectURL(url);
                      } catch (error) {
                        setState({ phase: 'failed', requestKey: createRequestKey(), body: {} as CreateTaskRequest, message: `导出失败：${errorMessage(error)}` });
                      }
                    })();
                  }}
                >
                  导出 JSON
                </Button>
              </div>
              <p className="sub" style={{ fontSize: 13.5, marginTop: 6, lineHeight: 1.65 }}>
                {template.description ? <>{template.description}<br /></> : null}
                模板的 {String(template.steps.length)} 个步骤由版本 {String(template.version)} 固定；创建后不能增删或改写。
              </p>
              <div className="row wrap" style={{ gap: 6, marginTop: 12 }}>
                {template.steps.map((step, index) => (
                  <span key={step.key} className="chip">
                    <span className="num muted">{String(index + 1)}</span>
                    {step.title}
                  </span>
                ))}
              </div>
            </div>

            {state?.phase === 'succeeded' ? (
              <div className="card-body" style={{ padding: 22 }}>
                <div className="banner ok" role="status">
                  <Icon name="check" />
                  <div className="grow">
                    <b>{state.message ?? '固定模板任务已创建'}</b>
                    <br />
                    回执 {state.receiptStatus ?? 'succeeded'} · 模板 {template.name} · 版本 {String(template.version)}
                    {state.taskId === undefined ? null : (
                      <>
                        <br />
                        任务 <span className="mono">{state.taskId}</span>
                      </>
                    )}
                  </div>
                </div>
                <p className="hint" style={{ marginTop: 12 }}>
                  任务当前处于需求草稿阶段。先按模板生成计划，再确认计划 → 准备独立工作区 → 开始执行；{CREATE_LOCK_NOTE}
                </p>
                {planError === undefined ? null : <p className="hint" style={{ marginTop: 8, color: 'var(--danger)' }}>生成计划失败：{planError}</p>}
                <div className="row wrap" style={{ gap: 8, marginTop: 16 }}>
                  {state.taskId === undefined ? null : (
                    <Button
                      variant="primary"
                      icon="layers"
                      disabled={planBusy}
                      onClick={() => {
                        const taskId = state.taskId;
                        if (taskId === undefined) return;
                        setPlanBusy(true);
                        setPlanError(undefined);
                        void (async () => {
                          try {
                            await apiPost(ROUTES.taskPlanFromTemplate(taskId), { requestKey: createRequestKey(), confirmUseTemplate: true });
                            await queryClient.invalidateQueries({ queryKey: queryKeys.bootstrap });
                            navigate(`/requirement/${encodeURIComponent(taskId)}`);
                          } catch (error) {
                            setPlanError(errorMessage(error));
                          } finally {
                            setPlanBusy(false);
                          }
                        })();
                      }}
                    >
                      {planBusy ? '正在生成计划…' : '按模板生成计划'}
                    </Button>
                  )}
                  {state.taskId === undefined ? null : (
                    <LinkButton to={`/requirement/${encodeURIComponent(state.taskId)}`} variant="secondary" iconAfter="arrowRight">
                      打开任务画布
                    </LinkButton>
                  )}
                  <LinkButton to="/tasks" variant="secondary" icon="list">
                    任务列表
                  </LinkButton>
                  <Button variant="ghost" icon="plus" onClick={resetForm}>
                    再创建一个
                  </Button>
                </div>
              </div>
            ) : (
              <form
                style={{ padding: 22 }}
                onSubmit={(event) => {
                  event.preventDefault();
                  if (canSubmit) void submit();
                }}
              >
                <div className="banner info" style={{ marginBottom: 16 }}>
                  <Icon name="target" />
                  <div className="grow">
                    {((): ReactNode => {
                      const selectedProject = projects.find((project) => project.id === projectId);
                      const branch = scope.branch ?? selectedProject?.defaultBranch;
                      return (
                        <>
                          <b>
                            将在 {selectedProject?.name ?? '（未选择项目）'} · {branch ?? '分支未知'} 上运行「{template.name}」
                          </b>
                          <br />
                          {branch === undefined
                            ? '请选择分支后创建。'
                            : `创建时固定分支 ${branch} 的提交，工作区使用该基线。`}
                          {' '}分支、日期、源码与文档范围作为固定输入保存，不会自动扩大。
                        </>
                      );
                    })()}
                  </div>
                </div>

                {state?.phase === 'unknown' ? (
                  <div className="banner unknown" role="alert" style={{ marginBottom: 16 }}>
                    <Icon name="help" />
                    <div className="grow">
                      <b>创建结果未明</b>
                      <br />
                      {state.message ?? '请求已发出但没有收到确认。'}参数已锁定；按原请求核对，不会创建第二个任务。
                      <div className="hint mono" style={{ marginTop: 4 }}>
                        requestKey {state.requestKey}
                      </div>
                    </div>
                    <div className="actions">
                      <Button variant="secondary" size="sm" icon="refresh" onClick={() => void reconcile()}>
                        按原请求核对
                      </Button>
                    </div>
                  </div>
                ) : null}

                {state?.phase === 'failed' ? (
                  <div className="banner danger" role="alert" style={{ marginBottom: 16 }}>
                    <Icon name="alert" />
                    <div className="grow">
                      <b>任务没有创建</b>
                      <br />
                      {state.message ?? '未知错误'}。修改输入后重新提交会使用新的 requestKey；同一失败请求不会自动重发。
                    </div>
                  </div>
                ) : null}

                <div className="grid-2" style={{ gap: 12 }}>
                  <div className="field" style={{ margin: 0 }}>
                    <label className="label" htmlFor="tpl-project">
                      项目 <span className="req">*</span>
                    </label>
                    <select
                      id="tpl-project"
                      className="select"
                      value={projectId}
                      disabled={formLocked}
                      onChange={(event) => {
                        setProjectId(event.target.value);
                        setScope({});
                      }}
                    >
                      <option value="">选择项目</option>
                      {projects.map((project) => (
                        <option key={project.id} value={project.id} disabled={['path_unavailable', 'capability_unavailable'].includes(project.gitState)}>
                          {project.name}{projects.filter((item) => item.name === project.name).length > 1 ? ` · ${project.rootPath}` : ''}
                        </option>
                      ))}
                    </select>
                    {projects.length === 0 ? <span className="hint">服务里还没有登记项目；请先在项目页登记。</span> : null}
                  </div>
                  <TemplateBranchField projectId={projectId} value={scope} onChange={setScope} disabled={formLocked} />
                </div>

                <details><summary>任务名称与补充说明（可选）</summary><p className="hint">留空时按模板与项目自动命名，模板说明作为任务目标。</p><div className="field">
                  <label className="label" htmlFor="tpl-title">
                    任务标题（可选）
                  </label>
                  <input
                    id="tpl-title"
                    className="input"
                    value={title}
                    disabled={formLocked}
                    placeholder="例如：订单服务单元测试补齐"
                    onChange={(event) => {
                      setTitle(event.target.value);
                    }}
                  />
                </div>

                <div className="field">
                  <label className="label" htmlFor="tpl-requirement">
                    补充说明（可选）
                  </label>
                  <textarea
                    id="tpl-requirement"
                    className="textarea"
                    value={requirementText}
                    disabled={formLocked}
                    placeholder="写清目标、范围与验收方式；创建后会作为任务需求原文保存。"
                    onChange={(event) => {
                      setRequirementText(event.target.value);
                    }}
                  />
                </div>

                <div className="field">
                  <label className="label" htmlFor="tpl-method">
                    目录方法 <span className="req">*</span>
                  </label>
                  <select
                    id="tpl-method"
                    className="select"
                    value={effectiveMethodId}
                    disabled={formLocked}
                    onChange={(event) => {
                      setMethodId(event.target.value);
                    }}
                  >
                    {methods.map((method) => (
                      <option key={method.id} value={method.id}>
                        {method.name} · {method.revision}
                      </option>
                    ))}
                  </select>
                  <span className="hint">
                    {selectedMethod === undefined
                      ? '目录里没有可用的流程方法，无法创建任务。'
                      : `任务会记录方法 ${selectedMethod.name}（${selectedMethod.revision}）；固定模板的步骤仍以模板版本为准。`}
                  </span>
                </div>

                </details><div className="field">
                  <span className="label">模板额外参数</span>
                  <ParameterField
                    template={template}
                    parameters={parameters}
                    disabled={formLocked}
                    onChange={(key, value) => {
                      setParameters((current) => ({ ...current, [key]: value }));
                    }}
                  />
                </div>

                <TemplateScopeFields key={`${template.id}:${projectId}`} template={template} project={projects.find((item) => item.id === projectId)} value={scope} onChange={setScope} disabled={formLocked} />

                <div className="row wrap" style={{ gap: 8, marginTop: 20, paddingTop: 16, boxShadow: 'inset 0 1px 0 var(--line)' }}>
                  <span className="hint grow">
                    {formLocked
                      ? '请求处理中，表单已锁定。'
                      : missingFields.length > 0
                        ? `还缺：${missingFields.join('、')}`
                        : '创建后进入需求草稿；确认计划与开始执行在任务画布中另行操作。'}
                  </span>
                  <Button
                    type="submit"
                    variant="primary"
                    icon="layers"
                    disabled={!canSubmit}
                    disabledReason={missingFields.length > 0 ? `还缺：${missingFields.join('、')}` : '请求处理中'}
                  >
                    {state?.phase === 'submitting' ? '正在创建…' : '创建固定模板任务'}
                  </Button>
                </div>
                <p className="hint" style={{ marginTop: 10 }}>
                  {CREATE_LOCK_NOTE}创建会写入一条任务记录，但不会开始执行。
                </p>
              </form>
            )}
          </section>

          <TemplateArchivePanel />

          <section className="card" aria-label="模板历史任务">
            <div className="card-head">
              <span className="tile"><Icon name="archive" /></span>
              <div className="grow">
                <span className="section-title">由这个模板创建的任务</span>
                <div className="hint" style={{ marginTop: 2 }}>
                  {historyQuery.data === undefined ? '读取中…' : `${String(historyQuery.data.tasks.length)} 个任务`}
                </div>
              </div>
              <Badge tone="neutral">只读</Badge>
            </div>
            <div className="card-body">
              {historyQuery.data === undefined ? (
                <p className="hint">正在读取历史任务…</p>
              ) : historyQuery.data.tasks.length === 0 ? (
                <p className="hint">还没有用这个模板创建任务。创建后会在任务画布里继续规划与执行。</p>
              ) : (
                <div className="list" style={{ padding: 0 }}>
                  {historyQuery.data.tasks.map((task) => (
                    <a key={task.id} className="list-row" href={`/tasks/${encodeURIComponent(task.id)}`}>
                      <span className="tile"><Icon name="layers" /></span>
                      <span className="grow" style={{ minWidth: 0 }}>
                        <span style={{ display: 'block', fontSize: 13.5 }}>{task.title}</span>
                        <span className="hint" style={{ display: 'block', marginTop: 2 }}>
                          {task.projectName} · {task.stage} · 更新 {new Date(task.updatedAt).toLocaleString('zh-CN')}
                        </span>
                      </span>
                      <Badge tone={task.lifecycle === 'completed' ? 'ok' : 'neutral'}>{task.lifecycle}</Badge>
                      <Icon name="chevRight" size="sm" />
                    </a>
                  ))}
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <PageHeader
        title="模板任务"
        lede="选一个固定模板，填好必要参数创建任务，再在任务里确认计划、准备独立工作区、开始执行。模板使用固定流程：创建后不能修改步骤。"
        actions={
          <div className="row wrap" style={{ gap: 8 }}>
          <input
            ref={importInputRef}
            type="file"
            accept="application/json,.json"
            style={{ display: 'none' }}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file === undefined) return;
              setImportBusy(true);
              setImportError(undefined);
              void (async () => {
                try {
                  const parsed = JSON.parse(await file.text()) as { template?: unknown } | unknown;
                  const imported = parsed !== null && typeof parsed === 'object' && 'template' in parsed ? (parsed as { template: unknown }).template : parsed;
                  const response = await apiPost<CommandResponse<readonly TaskTemplate[]>>(ROUTES.catalogTemplateImport, {
                    requestKey: createRequestKey(),
                    template: imported,
                    confirmImport: true,
                  });
                  await queryClient.invalidateQueries({ queryKey: queryKeys.bootstrap });
                  const receipt = response.data.receipt;
                  setCatalogNotice(
                    receipt.status === 'succeeded'
                      ? { tone: 'ok', title: '模板已导入', detail: `回执 ${receipt.status} · requestKey ${receipt.requestKey}` }
                      : { tone: 'unknown', title: '导入结果未明', detail: `服务返回 ${receipt.status}；已刷新模板目录，请以目录为准。` },
                  );
                } catch (error) {
                  if (isServiceUnavailable(error)) {
                    setImportError(`导入结果未明：${errorMessage(error)} 不会自动重试，请按模板目录核对。`);
                    await queryClient.invalidateQueries({ queryKey: queryKeys.bootstrap });
                  } else {
                    setImportError(`导入失败：${errorMessage(error)}`);
                  }
                } finally {
                  setImportBusy(false);
                }
              })();
            }}
          />
          <Button variant="secondary" size="sm" icon="upload" disabled={importBusy} disabledReason="导入请求处理中" onClick={() => { importInputRef.current?.click(); }}>
            {importBusy ? '导入中…' : '导入模板 JSON'}
          </Button>
          {template !== undefined && template.id.startsWith('template.custom.') ? (
            <>
              <Button
                variant="secondary"
                size="sm"
                icon="edit"
                onClick={() => {
                  setCatalogNotice(null);
                  setEditor({ mode: 'visual', templateId: template.id });
                }}
              >
                可视化编辑
              </Button>
              <Button
                variant="ghost"
                size="sm"
                icon="terminal"
                onClick={() => {
                  setCatalogNotice(null);
                  setEditor({ mode: 'json', templateId: template.id });
                }}
              >
                编辑 JSON
              </Button>
              <Button
                variant="ghost"
                size="sm"
                icon="archive"
                onClick={() => {
                  setCatalogNotice(null);
                  setArchiveTemplateId(template.id);
                }}
              >
                归档模板
              </Button>
            </>
          ) : null}
          <div className="input-wrap" style={{ width: 220 }}>
            <Icon name="search" />
            <input
              className="input ctl"
              placeholder="搜索模板"
              aria-label="搜索模板"
              value={keyword}
              onChange={(event) => {
                setKeyword(event.target.value);
              }}
            />
          </div>
          </div>
        }
      />
      {importError === undefined ? null : (
        <div className="banner danger" role="alert" style={{ marginBottom: 16 }}>
          <Icon name="alert" />
          <div className="grow">
            <b>导入模板失败</b>
            <br />
            {importError}
          </div>
          <div className="actions">
            <Button variant="ghost" size="sm" icon="x" onClick={() => { setImportError(undefined); }}>
              关闭
            </Button>
          </div>
        </div>
      )}
      {catalogNotice === null ? null : (
        <div
          className={`banner ${catalogNotice.tone}`}
          role={catalogNotice.tone === 'ok' ? 'status' : 'alert'}
          style={{ marginBottom: 16 }}
        >
          <Icon name={NOTICE_ICONS[catalogNotice.tone]} />
          <div className="grow">
            <b>{catalogNotice.title}</b>
            {catalogNotice.detail === undefined ? null : (
              <>
                <br />
                {catalogNotice.detail}
              </>
            )}
          </div>
          <div className="actions">
            <Button variant="ghost" size="sm" icon="x" onClick={() => { setCatalogNotice(null); }}>
              关闭
            </Button>
          </div>
        </div>
      )}
      {content}

      {editorTemplate === undefined || editor === null ? null : editor.mode === 'visual' ? (
        <VisualTemplateEditor
          template={editorTemplate}
          onClose={() => { setEditor(null); }}
          onSaved={(result) => { void handleTemplateSaved(result); }}
        />
      ) : (
        <JsonTemplateEditor
          template={editorTemplate}
          onClose={() => { setEditor(null); }}
          onSaved={(result) => { void handleTemplateSaved(result); }}
        />
      )}
      {archiveTemplate === undefined ? null : (
        <ArchiveTemplateDialog
          template={archiveTemplate}
          onClose={() => { setArchiveTemplateId(null); }}
          onArchived={(result) => { void handleTemplateArchived(result); }}
          verifyArchived={verifyArchived}
        />
      )}
    </div>
  );
}
