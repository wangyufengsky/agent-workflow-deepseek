import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  TaskMethodSupport,
  TASK_STAGE_LABEL,
  type TaskTemplate,
  type WorkflowMethod,
} from '@agent-workflow/shared';
import { useBootstrap } from '../../api/hooks.ts';
import { createTask, receiptIsUnknown } from '../../api/workflow.ts';
import { errorMessage, isServiceUnavailable } from '../../api/client.ts';
import { Badge } from '../../components/Badge.tsx';
import { Button } from '../../components/Button.tsx';
import { Card } from '../../components/Card.tsx';
import { EmptyState, Skeleton, SkeletonText } from '../../components/EmptyState.tsx';
import { Icon } from '../../components/Icon.tsx';
import { ServiceNotice } from '../../components/ServiceNotice.tsx';
import { ReceiptNotice } from '../../flow/workflow-ui.tsx';
import type { OperationReceipt } from '@agent-workflow/shared';
import './start.css';

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
          {method.requiredSteps.map((step) => {
            const refinable = method.refinableGroups.includes(step.group);
            return (
              <span key={step.key} className={refinable ? 'step-chip refinable' : 'step-chip'} title={refinable ? `「${step.group}」组可按需求细化` : step.group}>
                {step.title}
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

/** 开始任务：项目、需求原文、流程方法卡；只形成需求草稿，不调用模型。 */
export function StartPage() {
  const navigate = useNavigate();
  const bootstrap = useBootstrap();
  const [projectId, setProjectId] = useState<string>('');
  const [title, setTitle] = useState('');
  const [requirementText, setRequirementText] = useState('');
  const [methodId, setMethodId] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [receipt, setReceipt] = useState<OperationReceipt | undefined>(undefined);

  const projects: readonly import('@agent-workflow/shared').ProjectSummary[] = bootstrap.data?.projects ?? [];
  const methods: readonly WorkflowMethod[] = bootstrap.data?.catalog.methods ?? [];
  const templates: readonly TaskTemplate[] = bootstrap.data?.catalog.templates ?? [];
  const opencodeStatus = bootstrap.data?.integration.opencode.status;
  const effectiveProjectId = projectId.length > 0 ? projectId : (projects[0]?.id ?? '');
  const effectiveMethodId = methodId.length > 0 ? methodId : (methods[0]?.id ?? '');
  const selectedMethod = methods.find((method) => method.id === effectiveMethodId);
  const selectedProject = projects.find((project) => project.id === effectiveProjectId);

  const missing = (() => {
    if (bootstrap.isError) return '服务未连接：无法读取项目与流程方法';
    if (receipt !== undefined && receiptIsUnknown(receipt)) return '形成结果待核对：请先按原请求号核对，不会重发命令';
    if (projects.length === 0) return '尚未登记项目：请先在「项目」页登记项目目录';
    if (selectedProject === undefined) return '请选择项目';
    if (title.trim().length === 0) return '请填写需求标题';
    if (requirementText.trim().length === 0) return '请填写需求原文';
    if (selectedMethod === undefined) return '请选择流程方法';
    return undefined;
  })();

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
      const taskId = response.resource?.task.id;
      if (response.receipt.status === 'succeeded' && taskId !== undefined) {
        navigate(`/requirement/${encodeURIComponent(taskId)}`);
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
            <h2 className="title">描述要做的事，选择流程方法</h2>
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
            <h2 className="title">描述要做的事，选择流程方法</h2>
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

  return (
    <div className="page wide start-page">
      <div className="page-head">
        <div className="grow">
          <span className="eyebrow">开始任务</span>
          <h2 className="title">描述要做的事，选择流程方法</h2>
          <p className="lede">先形成需求草稿；之后在需求画布上生成或手动调整计划，确认后再准备独立工作区与开始执行。</p>
        </div>
      </div>

      <ReceiptNotice receipt={receipt} successMessage="需求草稿已形成，正在打开需求画布…" />
      {error === null || isServiceUnavailable(error) ? null : (
        <div className="banner danger" role="alert" style={{ marginBottom: 12 }}>
          <Icon name="alert" />
          <div className="grow">
            <b>形成需求草稿失败</b>
            <br />
            {errorMessage(error)}
          </div>
        </div>
      )}

      <div className="start-grid">
        <div className="col" style={{ gap: 18 }}>
          <Card className="pad">
            <div className="sec-t">1 · 项目</div>
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
              <div className="row" style={{ gap: 10 }}>
                <span className="tile">
                  <Icon name="folder" />
                </span>
                <div className="grow">
                  <select
                    className="select"
                    aria-label="项目"
                    value={effectiveProjectId}
                    onChange={(event) => {
                      setProjectId(event.target.value);
                    }}
                  >
                    {projects.map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.name}
                      </option>
                    ))}
                  </select>
                  <div className="hint" style={{ marginTop: 6 }}>
                    {selectedProject === undefined
                      ? '—'
                      : `${selectedProject.gitState === 'git' ? 'Git 仓库' : '非 Git 目录'} · ${selectedProject.rootPath} · 进行中 ${String(selectedProject.openTaskCount)} 个任务`}
                  </div>
                </div>
              </div>
            )}
          </Card>

          <Card className="pad">
            <label className="sec-t" htmlFor="start-title">
              2 · 需求
            </label>
            <div className="field">
              <label className="label" htmlFor="start-title">
                标题<span className="req">*</span>
              </label>
              <input
                id="start-title"
                className="input"
                value={title}
                maxLength={120}
                placeholder="例如：退款单按状态与日期筛选并导出"
                onChange={(event) => {
                  setTitle(event.target.value);
                }}
              />
            </div>
            <div className="field">
              <label className="label" htmlFor="start-req">
                需求原文<span className="req">*</span>
              </label>
              <textarea
                id="start-req"
                className="textarea"
                rows={5}
                value={requirementText}
                placeholder="写清业务目标、范围与验收标准。原文会冻结为「需求原文 修订 1」，之后的补充以新修订保存，不改原文。"
                onChange={(event) => {
                  setRequirementText(event.target.value);
                }}
              />
              <span className="hint">原文会冻结为「需求原文 修订 1」，之后的补充以新修订保存，不改原文。</span>
            </div>
          </Card>

          <Card className="pad">
            <div className="row" style={{ gap: 8 }}>
              <div className="sec-t grow" style={{ margin: 0 }}>
                3 · 流程方法
              </div>
              <Badge outline>来自 GET /api/bootstrap catalog</Badge>
            </div>
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
            <div className="foot-note" style={{ marginTop: 10 }}>
              <Icon name="info" size="sm" /> 高亮的组可按需求细化；模板任务是另一种入口：创建后步骤固定，不能修改。
            </div>
            <TemplateStrip templates={templates} />
          </Card>
        </div>

        <aside className="start-aside">
          <Card solid className="pad">
            <div className="eyebrow">将形成</div>
            <div className="start-summary-title">{title.trim().length > 0 ? title.trim() : '（尚未填写需求标题）'}</div>
            <dl className="mini-kv" style={{ marginTop: 12 }}>
              <dt>项目</dt>
              <dd>{selectedProject?.name ?? '—'}</dd>
              <dt>方法</dt>
              <dd>{selectedMethod === undefined ? '—' : `${selectedMethod.name} · ${selectedMethod.revision}`}</dd>
              <dt>阶段</dt>
              <dd>{TASK_STAGE_LABEL.draft}</dd>
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
                  <div className="s">只建草稿，不调用模型</div>
                </div>
              </li>
              <li>
                <span className="n">2</span>
                <div>
                  <div>生成计划（可选）</div>
                  <div className="s">先预览模型、次数、预算与时限，确认后才调用</div>
                </div>
              </li>
              <li>
                <span className="n">3</span>
                <div>
                  <div>确认计划</div>
                  <div className="s">确认不调用模型，也不会立即执行</div>
                </div>
              </li>
              <li>
                <span className="n">4</span>
                <div>
                  <div>准备独立工作区 → 开始执行</div>
                  <div className="s">两步分开，准备成功前不能开始</div>
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
