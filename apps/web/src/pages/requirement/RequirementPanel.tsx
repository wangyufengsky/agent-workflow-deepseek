import {
  TaskMethodSupport,
  type PlanningPreview,
  type PlanningRound,
  type RequirementInput,
  type Task,
  type TaskTemplate,
  type WorkflowMethod,
} from '@agent-workflow/shared';
import { Badge } from '../../components/Badge.tsx';
import { Icon } from '../../components/Icon.tsx';
import { formatDateTime } from '../../app/format.ts';
import { PanelEmpty, RoundMeta, Section } from './requirement-ui.tsx';

const ENTRY_KIND_LABEL: Record<RequirementInput['entries'][number]['kind'], string> = {
  requirement: '需求',
  constraint: '约束',
  acceptance: '验收',
};

export interface RequirementPanelProps {
  readonly task: Task;
  readonly requirement: RequirementInput;
  readonly method: WorkflowMethod | null;
  readonly preview?: PlanningPreview;
  readonly round?: PlanningRound;
  readonly template?: TaskTemplate;
}

/** “需求与输入” tab: read-only source of truth plus the method / model preview facts. */
export function RequirementPanel({ task, requirement, method, preview, round, template }: RequirementPanelProps) {
  return (
    <div>
      {task.fixedTemplate === undefined ? null : (
        <div className="banner info" style={{ marginBottom: 14 }}>
          <Icon name="lock" />
          <div className="grow">
            <b>固定模板任务：{template?.name ?? task.fixedTemplate.templateId} · 模板版本 {task.fixedTemplate.templateVersion}</b>
            <br />
            步骤与依赖创建后固定，不能修改；可以查看、确认计划、准备独立工作区与开始执行。
          </div>
        </div>
      )}

      <Section title="需求原文" aside={<Badge outline>只读 · 修订 {requirement.revision}</Badge>}>
        <div className="quote">{requirement.text}</div>
        <p className="hint" style={{ marginTop: 6 }}>
          原文冻结为「需求原文 修订 1」；之后的补充以新修订保存，不改原文。更新于 {formatDateTime(requirement.updatedAt)}。
        </p>
      </Section>

      <Section title="需求条目" aside={<span className="hint">{requirement.entries.length} 条</span>}>
        {requirement.entries.length === 0 ? (
          <PanelEmpty compact icon="file" title="服务未返回需求条目" description="没有条目时不推断需求结构。" />
        ) : (
          <div className="box">
            {requirement.entries.map((entry, index) => (
              <div key={entry.id} className="rowx">
                <span className={`tagx ${entry.kind === 'acceptance' ? 'decision' : entry.kind === 'constraint' ? 'ext' : 'fact'}`}>{ENTRY_KIND_LABEL[entry.kind]}</span>
                <div className="grow">
                  <div>{entry.text}</div>
                  <div className="s">
                    {entry.id}
                    {entry.sourceStart === undefined || entry.sourceEnd === undefined
                      ? ''
                      : ` · 原文位置 ${String(entry.sourceStart)}–${String(entry.sourceEnd)}`}
                    {index === 0 ? '' : ''}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="补充需求" aside={<Badge tone={requirement.supplements.length > 0 ? 'accent' : 'idle'}>{requirement.supplements.length} 条</Badge>}>
        {requirement.supplements.length === 0 ? (
          <p className="hint">尚无补充需求。补充会形成新的输入修订；已提交的规划轮次按当时输入不变。</p>
        ) : (
          <div className="box">
            {requirement.supplements.map((supplement) => (
              <div key={supplement.id} className="rowx">
                <span className="ic idle">
                  <Icon name="file" size="sm" />
                </span>
                <div className="grow">
                  <div>{supplement.text}</div>
                  <div className="s">
                    输入修订 {supplement.revision} · {formatDateTime(supplement.savedAt)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="资料与读取范围" aside={<span className="tagx ext">只读引用</span>}>
        {preview === undefined ? (
          <p className="hint">生成计划前会打开规划预览，由服务列出资料、可读性与授权范围；这里不预造资料清单。</p>
        ) : (
          <div className="box">
            {preview.sources.map((source) => (
              <div key={source.label} className="rowx">
                <span className={`ic ${source.readable ? 'ok' : 'warn'}`}>
                  <Icon name={source.readable ? 'check' : 'alert'} size="sm" />
                </span>
                <div className="grow">
                  <div className="t">{source.label}</div>
                  <div className="s">{source.detail}</div>
                </div>
                <Badge tone={source.readable ? 'ok' : 'warn'}>{source.readable ? '可读' : '不可读'}</Badge>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="流程方法" aside={method === null ? <Badge tone="warn">目录缺少该方法</Badge> : <Badge outline>{method.revision}</Badge>}>
        {method === null ? (
          <p className="hint">任务引用的流程方法不在当前目录中；不能据此推断步骤。</p>
        ) : (
          <>
            <div className="row wrap" style={{ gap: 6, marginBottom: 8 }}>
              <b>{method.name}</b>
              {method.support === TaskMethodSupport.AI_PLANNING ? (
                <Badge tone="ok" icon="check">
                  支持 AI 规划
                </Badge>
              ) : (
                <Badge tone="warn" icon="alert">
                  未配置 AI 规划 · 仅骨架
                </Badge>
              )}
              {method.planningStrategy === undefined ? null : (
                <Badge outline>
                  {method.planningStrategy.id} · {method.planningStrategy.version}
                </Badge>
              )}
            </div>
            <div className="method-step-list">
              {method.requiredSteps.map((step) => {
                const refinable = method.refinableGroups.includes(step.group);
                return (
                  <span key={step.key} className={refinable ? 'step-chip refinable' : 'step-chip'} title={step.group}>
                    {step.title}
                    {step.optional === true ? '（可选）' : ''}
                  </span>
                );
              })}
            </div>
            <p className="hint" style={{ marginTop: 6 }}>
              可按需求拆分：{method.refinableGroups.length === 0 ? '无' : method.refinableGroups.join('、')}。
            </p>
          </>
        )}
      </Section>

      <Section title="模型与预算" aside={<span className="hint">来自规划预览</span>}>
        {preview === undefined ? (
          <p className="hint">尚未预览。生成计划会先打开规划预览，列出模型、派发次数、预算与时限；确认后才调用模型。</p>
        ) : (
          <>
            <dl className="kv-list">
              <dt>模型</dt>
              <dd>{preview.model.label}</dd>
              <dt>最多派发</dt>
              <dd>
                初稿 {preview.dispatchLimit.drafts} + 修订 {preview.dispatchLimit.revisions} · 自动传输重试 {preview.dispatchLimit.transportRetries}
              </dd>
              <dt>时限</dt>
              <dd>
                总 {preview.timeLimitMinutes} 分钟 · 单次 {preview.perDispatchLimitMinutes} 分钟
              </dd>
              <dt>本轮预算</dt>
              <dd>
                {preview.budget.limit} {preview.budget.currency}（已预留 {preview.budget.reserved}）
              </dd>
              <dt>图规模上限</dt>
              <dd>
                节点 {preview.graphLimits.nodes} · 依赖 {preview.graphLimits.edges} · 分组 {preview.graphLimits.groups} · 深度 {preview.graphLimits.depth}
              </dd>
              <dt>预览有效期</dt>
              <dd>{formatDateTime(preview.expiresAt)}</dd>
            </dl>
            {preview.blockers.length === 0 ? null : (
              <div className="banner warn" style={{ marginTop: 10 }}>
                <Icon name="alert" />
                <div className="grow">
                  <b>预览发现 {preview.blockers.length} 项阻塞，生成按钮会禁用</b>
                  <ul className="list-plain" style={{ marginTop: 6 }}>
                    {preview.blockers.map((blocker) => (
                      <li key={blocker.code}>
                        {blocker.code} · {blocker.message}
                        {blocker.goTo === undefined ? '' : `（去 ${blocker.goTo}）`}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
          </>
        )}
      </Section>

      {round === undefined ? null : (
        <Section title="本轮依据" aside={<span className="hint">服务事实</span>}>
          <RoundMeta round={round} />
        </Section>
      )}
    </div>
  );
}
