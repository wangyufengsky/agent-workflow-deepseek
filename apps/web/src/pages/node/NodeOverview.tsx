import type { ArtifactRef, Attempt, NodeAcceptanceView, NodeDetailResponse } from '@agent-workflow/shared';
import { Badge } from '../../components/Badge.tsx';
import { Button } from '../../components/Button.tsx';
import { Icon } from '../../components/Icon.tsx';
import { FactsBar, FactPill } from '../../flow/workflow-ui.tsx';
import { formatDateTime } from '../../app/format.ts';
import { attemptVisual, pillTone, resultVisual } from './node-labels.ts';
import { shortId } from './node-facts.ts';
import type { RequirementLink } from './NodeSubviews.tsx';

const EDGE_KIND_LABEL: Readonly<Record<string, string>> = { data: '数据依赖', order: '顺序依赖', resource: '资源依赖' };

export interface NodeOverviewProps {
  readonly detail: NodeDetailResponse;
  readonly attempt: Attempt | undefined;
  readonly isHistorical: boolean;
  readonly acceptance?: NodeAcceptanceView;
  readonly toolCount: number;
  readonly onOpenPlan?: () => void;
  readonly onOpenCitation: (link: RequirementLink) => void;
  readonly onOpenArtifact: (artifact: ArtifactRef) => void;
  readonly onOpenAttempts: () => void;
}

/**
 * Overview tab (design §13): current attempt card, what this step does, who runs
 * it and the attempt's outputs. Percentages are deliberately absent — the design
 * forbids estimating progress without a trusted total.
 */
export function NodeOverview({ detail, attempt, isHistorical, acceptance, toolCount, onOpenPlan, onOpenCitation, onOpenArtifact, onOpenAttempts }: NodeOverviewProps) {
  const node = detail.node;
  const visual = attemptVisual(attempt, isHistorical ? undefined : acceptance);
  const result = resultVisual(attempt, isHistorical ? undefined : acceptance);
  const role = node.roleSnapshot?.name;
  const definition = attempt?.definition?.planRevisionId;
  const artifacts = attempt?.readability.result === 'forbidden' ? [] : (attempt?.result?.artifacts ?? []);
  return (
    <div className="node-overview">
      <div className="banner info" style={{ marginBottom: 12 }}>
        <Icon name="info" />
        <div className="grow">
          <b>
            {detail.group?.label ?? '未分组'} · {node.key}
          </b>
          <br />
          {node.summary}
        </div>
        {onOpenPlan === undefined ? null : (
          <div className="actions">
            <Button size="sm" variant="secondary" icon="flow" onClick={onOpenPlan}>
              打开计划
            </Button>
          </div>
        )}
      </div>

      <div className="sec-t">{isHistorical ? '所查看的尝试' : '当前尝试'}</div>
      <div className="node-cur-att">
        <div className="row wrap" style={{ gap: 8 }}>
          <b>尝试 #{attempt?.ordinal ?? '—'}</b>
          <span className={`tag${isHistorical ? '' : ' cur'}`}>{isHistorical ? '历史' : '当前'}</span>
          <Badge tone={visual.tone} icon={visual.icon}>
            {visual.label}
          </Badge>
        </div>
        <div className="hint node-att-meta">
          {attempt?.startedAt === undefined ? '开始时间未记录' : `开始于 ${formatDateTime(attempt.startedAt)}`}
          {attempt?.endedAt === undefined ? (attempt?.status === 'running' ? ' · 进行中' : '') : ` · 结束于 ${formatDateTime(attempt.endedAt)}`}
          {' · '}定义修订 {shortId(definition)}
        </div>
        <div className="node-stat">
          <div>
            <div className="k">工具调用（已记录）</div>
            <div className="v num">{toolCount}</div>
          </div>
          <div>
            <div className="k">尝试次数</div>
            <div className="v num">{detail.attempts.length}</div>
          </div>
          <div>
            <div className="k">结果与验收</div>
            <div className={`v node-result-value tone-${result.tone}`}>{result.label}</div>
          </div>
        </div>
        <p className="hint" style={{ marginTop: 8 }}>
          只列服务记录的事实，不估算进度；正文没有可信总量，不显示百分比。
        </p>
      </div>

      <div className="sec-t" style={{ marginTop: 14 }}>
        这一步做什么
      </div>
      <p className="node-what">{node.summary}</p>

      <div className="sec-t" style={{ marginTop: 14 }}>
        谁来做
      </div>
      <div className="node-who">
        <span className="node-av">{role === undefined ? '?' : role.slice(0, 1)}</span>
        <span className="grow">
          {role ?? '职业快照未保留'}
          <span className="hint" style={{ display: 'block' }}>
            {node.roleSnapshot === undefined ? '历史计划缺少职业修订快照，执行前需要重新确认计划' : `职业修订 ${shortId(node.roleSnapshot.revision)} · 执行时冻结`}
          </span>
        </span>
      </div>

      <div className="sec-t" style={{ marginTop: 14 }}>
        产出{attempt === undefined ? '' : ` · 尝试 #${String(attempt.ordinal)}`}
      </div>
      {attempt?.readability.result === 'forbidden' ? (
        <p className="hint">你已无权查看这次尝试的产物。</p>
      ) : artifacts.length === 0 ? (
        <p className="hint">这次尝试没有登记产物。{attempt?.result === undefined ? '结果尚未提交：执行中的文件不在这里冒充最终产出。' : ''}</p>
      ) : (
        <div className="col" style={{ gap: 6 }}>
          {artifacts.map((artifact) => (
            <div className="node-out-row" key={artifact.id}>
              <Icon name="file" size="sm" />
              <span className="grow">
                <span className="ellipsis">
                  {artifact.name} <span className="muted mono">@ {artifact.revision}</span>
                </span>
                <span className="hint">
                  {artifact.mediaType}
                  {artifact.sizeBytes === undefined ? '' : ` · ${String(artifact.sizeBytes)} B`}
                </span>
              </span>
              <Button size="sm" variant="ghost" icon="eye" onClick={() => onOpenArtifact(artifact)}>
                打开
              </Button>
            </div>
          ))}
        </div>
      )}
      <div className="row" style={{ marginTop: 8 }}>
        <Button size="sm" variant="ghost" icon="clock" onClick={onOpenAttempts}>
          查看全部尝试与产出
        </Button>
      </div>

      <div className="sec-t" style={{ marginTop: 14 }}>
        状态
      </div>
      <FactsBar>
        <FactPill label="执行状态" value={detail.execution === undefined ? '未执行' : visual.label} tone={pillTone(visual.tone)} />
        <FactPill label="尝试次数" value={String(detail.execution?.attemptCount ?? detail.attempts.length)} />
        <FactPill label="当前尝试" value={detail.currentAttempt === undefined ? '—' : `#${String(detail.currentAttempt.ordinal)}`} />
        <FactPill label="结果与验收" value={result.label} tone={pillTone(result.tone)} />
      </FactsBar>

      <div className="sec-t" style={{ marginTop: 14 }}>
        来源需求
      </div>
      {detail.requirementLinks.length === 0 ? (
        <p className="hint">服务未关联需求条目。</p>
      ) : (
        <div className="box">
          {detail.requirementLinks.map((link) => (
            <div key={link.entryId} className="rowx">
              <span className="tagx fact">需求</span>
              <div className="grow">
                <div>{link.text}</div>
                <div className="s mono">{link.entryId}</div>
              </div>
              <Button size="sm" variant="ghost" icon="eye" onClick={() => onOpenCitation(link)}>
                查看原文
              </Button>
            </div>
          ))}
        </div>
      )}

      <div className="sec-t" style={{ marginTop: 14 }}>
        为什么在这里
      </div>
      {detail.dependencyReasons.length === 0 ? (
        <p className="hint">没有上游依赖（或服务未返回依赖原因）。</p>
      ) : (
        <ul className="list-plain">
          {detail.dependencyReasons.map((reason) => (
            <li key={`${reason.fromNodeId}-${reason.kind}`}>
              {EDGE_KIND_LABEL[reason.kind] ?? reason.kind} · {reason.reason}
            </li>
          ))}
        </ul>
      )}

      <div className="sec-t" style={{ marginTop: 14 }}>
        输入 → 本步骤 → 输出槽位
      </div>
      <ul className="io-list">
        <li>
          <div className="io-side">
            {node.inputs.length === 0 ? (
              <span className="hint">无</span>
            ) : (
              node.inputs.map((input, index) => (
                <span key={`${input.name}-${String(index)}`} className="io-chip">
                  {input.name} · {input.source}
                </span>
              ))
            )}
          </div>
          <span className="io-arrow">
            <Icon name="arrowRight" size="sm" />
          </span>
          <div className="io-side">
            {node.outputs.length === 0 ? (
              <span className="hint">无</span>
            ) : (
              node.outputs.map((output, index) => (
                <span key={`${output.name}-${String(index)}`} className="io-chip">
                  {output.name} · 执行后才有结果
                </span>
              ))
            )}
          </div>
        </li>
      </ul>

      <div className="sec-t" style={{ marginTop: 14 }}>
        验收条款
      </div>
      {node.acceptance.length === 0 ? <p className="hint">服务未声明验收条款。</p> : <ul className="list-plain">{node.acceptance.map((item, index) => <li key={`${item}-${String(index)}`}>{item}</li>)}</ul>}

      <div className="sec-t" style={{ marginTop: 14 }}>
        读写资源
      </div>
      <ul className="io-list">
        <li>
          <div className="io-side">
            <span className="hint">读取</span>
            {node.resources.read.length === 0 ? (
              <span className="hint">无</span>
            ) : (
              node.resources.read.map((resource) => (
                <span key={`r-${resource.label}`} className="io-chip">
                  {resource.label} · {resource.basis}
                </span>
              ))
            )}
          </div>
          <span className="io-arrow" />
          <div className="io-side">
            <span className="hint">写入</span>
            {node.resources.write.length === 0 ? (
              <span className="hint">无</span>
            ) : (
              node.resources.write.map((resource) => (
                <span key={`w-${resource.label}`} className="io-chip">
                  {resource.label} · {resource.basis}
                </span>
              ))
            )}
          </div>
        </li>
      </ul>
    </div>
  );
}
