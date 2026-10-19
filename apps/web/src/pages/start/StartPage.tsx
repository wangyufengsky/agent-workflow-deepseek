import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  TaskMethodSupport,
  type TaskTemplate,
  type WorkflowMethod,
} from '@agent-workflow/shared';
import { useBootstrap } from '../../api/hooks.ts';
import { createTask, receiptIsUnknown } from '../../api/workflow.ts';
import { errorMessage, isServiceUnavailable } from '../../api/client.ts';
import { Badge } from '../../components/Badge.tsx';
import { Button, LinkButton } from '../../components/Button.tsx';
import { Card } from '../../components/Card.tsx';
import { EmptyState, Skeleton, SkeletonText } from '../../components/EmptyState.tsx';
import { Icon } from '../../components/Icon.tsx';
import { ServiceNotice } from '../../components/ServiceNotice.tsx';
import { ReceiptNotice } from '../../flow/workflow-ui.tsx';
import type { OperationReceipt } from '@agent-workflow/shared';
import './start.css';

interface CreatedDraft {
  readonly taskId: string;
  readonly title: string;
  readonly projectName: string;
  readonly methodName: string;
  readonly methodRevision: string;
}

function autoTitle(input: string): string {
  const compact = input.trim().replace(/\s+/g, ' ');
  return Array.from(compact).slice(0, 60).join('');
}

function StepHead({ number, title, complete, hint }: {
  readonly number: number;
  readonly title: string;
  readonly complete: boolean;
  readonly hint?: string;
}) {
  return (
    <div className="row" style={{ gap: 8, marginBottom: 10, alignItems: 'center' }}>
      <span className="badge outline num" aria-hidden="true" style={{ minWidth: 22, justifyContent: 'center' }}>
        {complete ? <Icon name="check" size="sm" /> : String(number)}
      </span>
      <span className="sec-t grow" style={{ margin: 0 }}>{title}</span>
      {hint === undefined ? null : <span className="hint">{hint}</span>}
    </div>
  );
}


function MethodCard({ method, selected, onSelect }: { readonly method: WorkflowMethod; readonly selected: boolean; readonly onSelect: () => void }) {
  const ai = method.support === TaskMethodSupport.AI_PLANNING;
  return (
    <button type="button" role="radio" aria-checked={selected} className="method-card" onClick={onSelect}>
      <div className="method-card-head">
        <Icon name="flow" size="sm" />
        <span className="method-name">{method.name}</span>
        <Badge outline>{method.revision}</Badge>
        {ai ? (
          <Badge tone="ok" icon="check">
            支持 AI 规划
          </Badge>
        ) : (
          <Badge tone="warn" icon="alert">
            未配置 AI 规划
          </Badge>
        )}
      </div>
      <p className="method-desc">{method.description}</p>
      <div className="method-line">
        <b>必经步骤</b>
        <span className="method-steps">
          {method.requiredSteps.map((step, index) => {
            const refinable = method.refinableGroups.includes(step.group);
            return (
              <span key={step.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                {index === 0 ? null : <span className="muted" aria-hidden="true">→</span>}
                <span className={refinable ? 'step-chip refinable' : 'step-chip'} title={refinable ? `「${step.group}」组可按需求细化` : step.group}>
                  {step.title}
                </span>
              </span>
            );
          })}
        </span>
      </div>
      <div className="method-line">
        <b>可按需求拆分</b>
        <span className="method-refine">
          {method.refinableGroups.length === 0 ? '无（全部为固定步骤）' : `${method.refinableGroups.join('、')}组（每组 ≤ 4 个子步骤）`}
        </span>
      </div>
      <div className="method-line">
        <b>AI 规划</b>
        <span className={ai ? 'method-ai ok' : 'method-ai warn'}>
          <Icon name={ai ? 'check' : 'alert'} size="sm" />
          {ai ? `支持 · ${method.planningStrategy?.id ?? 'planning'} ${method.planningStrategy?.version ?? 'v1'}` : '未适配：可用方法骨架并手动调整'}
        </span>
      </div>
    </button>
  );
}

function TemplateStrip({ templates }: { readonly templates: readonly TaskTemplate[] }) {
  return (
    <div className="template-strip">
      <span className="tile">
        <Icon name="template" size="lg" />
      </span>
      <div className="grow">
        <div className="template-title">要用固定步骤？去模板任务</div>
        <div className="hint">
          {templates.length === 0
            ? '当前目录没有可用固定模板。'
            : `可用：${templates.map((template) => `${template.name} · v${String(template.version)}`).join('、')}。模板任务创建后步骤固定，不能修改。`}
        </div>
      </div>
      <Link className="btn secondary sm" to="/templates">
        <Icon name="template" size="sm" />
        模板任务
      </Link>
    </div>
  );
}

/** 开始任务：项目、目标（自动生成名称）、流程方法卡；只形成需求草稿，不调用模型。 */
export function StartPage() {
  const [searchParams] = useSearchParams();
  const bootstrap = useBootstrap();
  const [projectId, setProjectId] = useState<string>('');
  const [title, setTitle] = useState('');
  const [titleTouched, setTitleTouched] = useState(false);
  const [requirementText, setRequirementText] = useState('');
  const [methodId, setMethodId] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [receipt, setReceipt] = useState<OperationReceipt | undefined>(undefined);
  const [created, setCreated] = useState<CreatedDraft | undefined>(undefined);

  const projects: readonly import('@agent-workflow/shared').ProjectSummary[] = bootstrap.data?.projects ?? [];
  const methods: readonly WorkflowMethod[] = bootstrap.data?.catalog.methods ?? [];
  const templates: readonly TaskTemplate[] = bootstrap.data?.catalog.templates ?? [];
  const opencodeStatus = bootstrap.data?.integration.opencode.status;
  const requestedProjectId = searchParams.get('project') ?? '';
  const requestedMethodId = searchParams.get('methodId') ?? '';
  const pathAvailable = (project: (typeof projects)[number]) => project.gitState !== 'path_unavailable';
  const projectFromQuery = requestedProjectId !== '' && projects.some((project) => project.id === requestedProjectId && pathAvailable(project)) ? requestedProjectId : '';
  const methodFromQuery = requestedMethodId !== '' && methods.some((method) => method.id === requestedMethodId) ? requestedMethodId : '';
  const effectiveProjectId = projectId.length > 0 ? projectId : projectFromQuery.length > 0 ? projectFromQuery : (projects.find(pathAvailable)?.id ?? '');
  const effectiveProject = projects.find((project) => project.id === effectiveProjectId);
  const projectDefaultMethod = effectiveProject?.settings.defaultMethodId;
  const defaultMethodId = projectDefaultMethod !== undefined && methods.some((method) => method.id === projectDefaultMethod)
    ? projectDefaultMethod
    : (methods[0]?.id ?? '');
  const effectiveMethodId = methodId.length > 0 ? methodId : methodFromQuery.length > 0 ? methodFromQuery : defaultMethodId;
  const selectedMethod = methods.find((method) => method.id === effectiveMethodId);
  const selectedProject = projects.find((project) => project.id === effectiveProjectId);
  const noUsableProject = projects.length > 0 && !projects.some(pathAvailable);
  const invalidProjectQuery = projects.length > 0 && projectId.length === 0 && requestedProjectId !== '' && projectFromQuery === '';
  const invalidMethodQuery = methods.length > 0 && methodId.length === 0 && requestedMethodId !== '' && methodFromQuery === '';
  const queryNotice = [
    invalidProjectQuery ? `URL 中的项目「${requestedProjectId}」不存在或路径不可用，已使用默认项目。` : null,
    invalidMethodQuery ? `URL 中的流程方法「${requestedMethodId}」不存在，已使用默认方法。` : null,
  ].filter((item): item is string => item !== null).join(' ');

  const missing = (() => {
    if (bootstrap.isError) return '服务未连接：无法读取项目与流程方法';
    if (receipt !== undefined && receiptIsUnknown(receipt)) return '形成结果待核对：请先按原请求号核对，不会重发命令';
    if (projects.length === 0) return '尚未登记项目：请先在「项目」页登记项目目录';
    if (noUsableProject) return '没有可用项目：项目路径都不可用，请先在「项目」页修正路径';
    if (selectedProject === undefined) return '请选择项目';
    if (requirementText.trim().length === 0) return '请写下目标';
    if (title.trim().length === 0) return '请填写任务名称';
    if (selectedMethod === undefined) return '请选择流程';
    return undefined;
  })();

  const createdTaskHref = created === undefined || created.taskId === ''
    ? undefined
    : `/requirement/${encodeURIComponent(created.taskId)}`;

  const resetAfterReceipt = () => {
    setCreated(undefined);
    setReceipt(undefined);
    setTitle('');
    setTitleTouched(false);
    setRequirementText('');
    setProjectId('');
    setMethodId('');
    setError(null);
  };

  const submit = async () => {
    if (missing !== undefined || selectedProject === undefined || selectedMethod === undefined) return;
    setSubmitting(true);
    setError(null);
    setReceipt(undefined);
    try {
      const response = await createTask({
        projectId: selectedProject.id,
        title: title.trim(),
        requirementText: requirementText.trim(),
        methodId: selectedMethod.id,
      });
      setReceipt(response.receipt);
      if (response.receipt.status === 'succeeded') {
        setCreated({
          taskId: response.resource?.task.id ?? '',
          title: title.trim(),
          projectName: selectedProject.name,
          methodName: selectedMethod.name,
          methodRevision: selectedMethod.revision,
        });
      }
    } catch (caught) {
      setError(caught);
    } finally {
      setSubmitting(false);
    }
  };

  if (bootstrap.isLoading) {
    return (
      <div className="page wide start-page">
        <div className="page-head">
          <div className="grow">
            <span className="eyebrow">开始任务</span>
            <h2 className="title">开始一个任务</h2>
            <p className="lede">先形成需求草稿；之后在需求画布上生成或手动调整计划，确认后再准备独立工作区与开始执行。</p>
          </div>
        </div>
        <div className="start-grid">
          <div className="col" style={{ gap: 18 }}>
            <Card className="pad">
              <SkeletonText lines={2} />
            </Card>
            <Card className="pad">
              <SkeletonText lines={4} />
            </Card>
          </div>
          <Card className="pad">
            <Skeleton height={120} />
          </Card>
        </div>
      </div>
    );
  }

  if (bootstrap.isError) {
    return (
      <div className="page wide start-page">
        <div className="page-head">
          <div className="grow">
            <span className="eyebrow">开始任务</span>
            <h2 className="title">开始一个任务</h2>
          </div>
        </div>
        <ServiceNotice
          error={bootstrap.error}
          onRetry={() => {
            void bootstrap.refetch();
          }}
        />
      </div>
    );
  }

  if (created !== undefined) {
    const canOpen = createdTaskHref !== undefined;
    return (
      <div className="page wide start-page">
        <div className="page-head">
          <div className="grow">
            <span className="eyebrow">开始任务</span>
            <h2 className="title">{canOpen ? '需求草稿已形成' : '草稿已形成，但没能自动打开'}</h2>
            <p className="lede">
              {canOpen
                ? '需求草稿已经保存；下一步在需求画布确认计划。确认之前，任务不会开始执行。'
                : '服务回执成功，但没有返回任务 ID；草稿可能已经保存，请回到任务列表核对，不要重复创建。'}
            </p>
          </div>
        </div>

        <section className="card pad start-receipt" aria-live="polite">
          <div className="row" style={{ gap: 14, alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <span className="tile lg" style={{ background: canOpen ? 'var(--ok-fill)' : 'var(--warn-fill)', color: canOpen ? 'var(--ok)' : 'var(--warn)' }}>
              <Icon name={canOpen ? 'check' : 'alert'} size="lg" />
            </span>
            <div className="grow" style={{ minWidth: 240 }}>
              <div className="row wrap" style={{ gap: 8 }}>
                <span style={{ fontSize: 16, fontWeight: 500 }}>{created.title}</span>
                <Badge tone={canOpen ? 'ok' : 'warn'} icon={canOpen ? 'check' : 'alert'}>
                  {canOpen ? '回执成功' : '回执成功 · 缺少任务 ID'}
                </Badge>
              </div>
              <dl className="mini-kv" style={{ marginTop: 12 }}>
                <dt>项目</dt>
                <dd>{created.projectName}</dd>
                <dt>流程</dt>
                <dd>{created.methodName} · 版本 {created.methodRevision}</dd>
                <dt>下一步</dt>
                <dd>在需求画布确认计划；确认后才会准备工作区并单独开始执行。</dd>
              </dl>
              <div className="row wrap" style={{ gap: 8, marginTop: 16 }}>
                {canOpen ? (
                  <LinkButton to={createdTaskHref} variant="primary" icon="arrowRight">
                    去确认计划
                  </LinkButton>
                ) : (
                  <Button variant="primary" icon="file" disabled disabledReason="服务回执没有返回任务 ID，无法直接打开；请回任务列表查看。">
                    打开原草稿
                  </Button>
                )}
                <Link className="btn ghost" to="/tasks">稍后，回到任务列表</Link>
                <Button variant="ghost" icon="plus" onClick={resetAfterReceipt}>再创建一个</Button>
              </div>
              {canOpen ? null : (
                <p className="hint" style={{ marginTop: 10 }}>
                  回执状态为 succeeded，但 resource.task.id 缺失；这是服务返回的数据不完整，页面不会伪造任务 ID。
                </p>
              )}
            </div>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="page wide start-page">
      <div className="page-head">
        <div className="grow">
          <span className="eyebrow">开始任务</span>
          <h2 className="title">开始一个任务</h2>
          <p className="lede">选好项目，写下目标，再挑一个流程。opencode-workflow 会先形成一份需求草稿供你审阅——此时不会开始执行。</p>
        </div>
      </div>

      <ReceiptNotice receipt={receipt} successMessage="需求草稿已形成。" />
      {queryNotice.length === 0 ? null : (
        <div className="banner info" role="status" style={{ marginBottom: 12 }}>
          <Icon name="info" />
          <div className="grow">{queryNotice}</div>
        </div>
      )}
      {error === null ? null : (
        <div className="banner danger" role="alert" style={{ marginBottom: 12 }}>
          <Icon name="alert" />
          <div className="grow">
            <b>{isServiceUnavailable(error) ? '服务未连接，未创建任务' : '形成需求草稿失败'}</b>
            <br />
            {errorMessage(error)}
          </div>
        </div>
      )}

      <div className="start-grid">
        <div className="col" style={{ gap: 18 }}>
          <Card className="pad">
            <StepHead
              number={1}
              title="项目"
              complete={selectedProject !== undefined}
              hint={selectedProject === undefined ? '选择任务归属的项目目录' : '已选择'}
            />
            {projects.length === 0 ? (
              <EmptyState
                compact
                icon="folder"
                title="尚未登记项目"
                description="需求草稿必须归属于一个真实项目目录。请先登记项目，再回来开始任务。"
                action={
                  <Link className="btn secondary sm" to="/projects">
                    <Icon name="folder" size="sm" />
                    去项目页
                  </Link>
                }
              />
            ) : (
              <div className="start-opts" role="radiogroup" aria-label="选择项目">
                {projects.map((project) => {
                  const selected = project.id === selectedProject?.id;
                  const pathUnavailable = project.gitState === 'path_unavailable';
                  return (
                    <button
                      key={project.id}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      className="start-opt"
                      disabled={pathUnavailable}
                      title={pathUnavailable ? '项目路径不可用；先到项目页修正路径。' : undefined}
                      onClick={() => {
                        setProjectId(project.id);
                      }}
                    >
                      <span className="r" aria-hidden="true" />
                      <span className="grow" style={{ minWidth: 0 }}>
                        <span className="t">{project.name}</span>
                        <span className="d mono">{project.rootPath}</span>
                        <span className="d">
                          {project.gitState === 'git'
                            ? 'Git 仓库'
                            : project.gitState === 'not_git'
                              ? '非 Git 目录'
                              : project.gitState === 'path_unavailable'
                                ? '路径不可用'
                                : 'Git 能力不可用'}
                          {' · '}进行中 {String(project.openTaskCount)} 个任务
                        </span>
                      </span>
                      {selected ? <Icon name="check" size="sm" /> : null}
                    </button>
                  );
                })}
              </div>
            )}
          </Card>

          <Card className="pad">
            <StepHead
              number={2}
              title="目标"
              complete={requirementText.trim().length > 0}
              hint={selectedProject === undefined ? '先选择项目' : `在 ${selectedProject.name} 中`}
            />
            <label className="label" htmlFor="start-goal">
              目标<span className="req">*</span>
            </label>
            <textarea
              id="start-goal"
              className="textarea"
              rows={6}
              value={requirementText}
              disabled={selectedProject === undefined}
              placeholder={'描述要做什么，以及完成后希望看到的结果。\n例如：让项目配置更容易找到，减少切换页面的次数。'}
              onChange={(event) => {
                const next = event.target.value;
                setRequirementText(next);
                if (!titleTouched || title.trim().length === 0) setTitle(autoTitle(next));
              }}
            />
            <div className="row wrap" style={{ gap: 8, alignItems: 'center', marginTop: 10 }}>
              <Icon name="edit" size="sm" />
              <label className="label" htmlFor="start-title" style={{ margin: 0 }}>
                任务名称
              </label>
              <input
                id="start-title"
                className="input"
                style={{ flex: 1, minWidth: 180, height: 32 }}
                maxLength={120}
                value={title}
                placeholder="留空时从目标自动生成"
                onChange={(event) => {
                  setTitle(event.target.value);
                  setTitleTouched(true);
                }}
              />
              <span className="hint num">{Array.from(requirementText).length} 字</span>
            </div>
            <span className="hint" style={{ display: 'block', marginTop: 6 }}>
              {titleTouched ? '已使用你填写的任务名称。' : '任务名称会从目标自动生成，形成草稿前都可以修改。'}
            </span>
            <p className="hint" style={{ marginTop: 8 }}>
              目标原文会冻结为「需求原文 修订 1」，之后的补充以新修订保存，不改原文。
            </p>
          </Card>

          <Card className="pad">
            <StepHead
              number={3}
              title="流程"
              complete={selectedMethod !== undefined}
              hint={selectedMethod === undefined ? '选择任务会经过的步骤' : `版本 ${selectedMethod.revision}`}
            />
            {methods.length === 0 ? (
              <EmptyState compact icon="flow" title="目录里没有流程方法" description="服务返回的 catalog.methods 为空；不能在这里凭空创建方法。" />
            ) : (
              <div className="method-grid" role="radiogroup" aria-label="流程方法">
                {methods.map((method) => (
                  <MethodCard
                    key={method.id}
                    method={method}
                    selected={method.id === effectiveMethodId}
                    onSelect={() => {
                      setMethodId(method.id);
                    }}
                  />
                ))}
              </div>
            )}
            <p className="hint" style={{ marginTop: 10 }}>
              流程版本来自 /api/bootstrap 的目录快照（只读）；本页不单独读取流程定义，目录读取失败时不能提交。
            </p>
            <div className="foot-note" style={{ marginTop: 10 }}>
              <Icon name="info" size="sm" /> 高亮的组可按需求细化；模板任务是另一种入口：创建后步骤固定，不能修改。
            </div>
            <TemplateStrip templates={templates} />
          </Card>
        </div>

        <aside className="start-aside">
          <Card solid className="pad">
            <div className="eyebrow">将要创建</div>
            <div className="start-summary-title">{title.trim().length > 0 ? title.trim() : '未命名任务'}</div>
            <dl className="mini-kv" style={{ marginTop: 12 }}>
              <dt>项目</dt>
              <dd>{selectedProject?.name ?? '—'}</dd>
              <dt>流程</dt>
              <dd>
                {selectedMethod === undefined ? '—' : (
                  <>
                    {selectedMethod.name}
                    <span className="hint" style={{ display: 'block', marginTop: 2 }}>
                      版本 {selectedMethod.revision} · 目录快照
                    </span>
                  </>
                )}
              </dd>
              <dt>目标</dt>
              <dd>{requirementText.trim().length === 0 ? <span className="muted">尚未填写</span> : `${Array.from(requirementText.trim()).length} 字`}</dd>
              <dt>服务</dt>
              <dd>
                {opencodeStatus === 'ready' ? (
                  <span className="start-ok">
                    <Icon name="check" size="sm" />
                    OpenCode 就绪
                  </span>
                ) : (
                  <span className="start-warn">
                    <Icon name="alert" size="sm" />
                    受管 OpenCode 未就绪（仍可先形成草稿）
                  </span>
                )}
              </dd>
            </dl>

            <div className="sec-t" style={{ marginTop: 16 }}>
              接下来
            </div>
            <ol className="steps4">
              <li className="cur">
                <span className="n">1</span>
                <div>
                  <div>形成需求草稿</div>
                  <div className="s">本页完成，不调用模型，也不会入队执行</div>
                </div>
              </li>
              <li>
                <span className="n">2</span>
                <div>
                  <div>在需求画布确认计划</div>
                  <div className="s">可以调整步骤、模型与预算；确认前不会执行</div>
                </div>
              </li>
              <li>
                <span className="n">3</span>
                <div>
                  <div>开始执行</div>
                  <div className="s">确认计划并准备工作区后，单独启动</div>
                </div>
              </li>
            </ol>

            <Button
              variant="primary"
              size="lg"
              className="start-submit"
              icon="plus"
              disabled={submitting || missing !== undefined}
              disabledReason={missing}
              aria-busy={submitting || undefined}
              onClick={() => {
                void submit();
              }}
            >
              {submitting ? (
                <>
                  <span className="spin" />正在形成…
                </>
              ) : (
                '形成需求草稿'
              )}
            </Button>
            {missing === undefined ? null : (
              <p className="start-reason">
                <Icon name="lock" size="sm" />
                {missing}
              </p>
            )}
            <p className="hint" style={{ marginTop: 8, textAlign: 'center' }}>
              不会调用模型、不产生费用
            </p>
          </Card>
        </aside>
      </div>
    </div>
  );
}
