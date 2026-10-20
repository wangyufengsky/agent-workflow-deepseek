import { Badge } from '../../components/Badge.tsx';
import { Button } from '../../components/Button.tsx';
import { Icon } from '../../components/Icon.tsx';
import { QualityReviewResult } from './QualityReviewResult.tsx';
import type { ArtifactRef, Attempt, NodeAcceptanceView, NodeDetail } from '@agent-workflow/shared';
import { formatDateTime } from '../../app/format.ts';
import { attemptVisual, resultVisual } from './node-labels.ts';
import { clockTime, shortId } from './node-facts.ts';

/** Attempts rows come from `node.attempts`; the read model sends no pagination. */
export interface AttemptRowModel {
  readonly attemptId: string;
  readonly ordinal: number;
  readonly status: string;
  readonly isCurrent: boolean;
  readonly startedAt?: string;
  readonly endedAt?: string;
  readonly reasonSummary?: string;
  readonly definitionPlanRevisionId?: string;
}

export function designAttemptRows(attempts: readonly Attempt[], currentAttemptId: string | undefined, fallbackRows: readonly { readonly attemptId: string; readonly ordinal: number; readonly status: string; readonly isCurrent: boolean; readonly startedAt?: string; readonly endedAt?: string; readonly reasonSummary?: string }[]): readonly AttemptRowModel[] {
  if (attempts.length === 0) return fallbackRows;
  return attempts
    .map((attempt) => ({
      attemptId: attempt.id,
      ordinal: attempt.ordinal,
      status: attempt.status,
      isCurrent: attempt.id === currentAttemptId,
      ...(attempt.startedAt === undefined ? {} : { startedAt: attempt.startedAt }),
      ...(attempt.endedAt === undefined ? {} : { endedAt: attempt.endedAt }),
      ...(attempt.readability.result === 'forbidden' || attempt.result?.summary === undefined ? {} : { reasonSummary: attempt.result.summary }),
      ...(attempt.definition?.planRevisionId === undefined ? {} : { definitionPlanRevisionId: attempt.definition.planRevisionId }),
    }))
    .sort((left, right) => right.ordinal - left.ordinal);
}

export interface AttemptsListProps {
  readonly rows: readonly AttemptRowModel[];
  readonly selectedAttemptId: string | undefined;
  readonly onSelect: (attemptId: string) => void;
  readonly error?: unknown;
  readonly onRetry: () => void;
  readonly retrying: boolean;
}

/**
 * Design §17 attempt list: ordinal, current/history tag, design status badge,
 * start–end, definition revision, reason and a read-only「查看」entry.
 * The service returns every attempt at once — no cursor/retention field exists,
 * so the list states that instead of pretending there is pagination.
 */
export function AttemptsList({ rows, selectedAttemptId, onSelect, error, onRetry, retrying }: AttemptsListProps) {
  if (rows.length === 0) {
    return (
      <div className="node-att-empty">
        <Icon name="clock" />
        <h3>还没有尝试记录</h3>
        <p>这一步尚未执行；没有尝试时不生成历史，服务也不会返回演示记录。</p>
      </div>
    );
  }
  return (
    <div className="node-attempts">
      {error === undefined ? null : (
        <div className="banner danger" role="alert">
          <Icon name="alert" />
          <div className="grow">
            <b>尝试列表读取失败</b>
            <br />
            已加载的尝试保留；重试只重新读取列表，不会启动执行。
          </div>
          <div className="actions">
            <Button size="sm" variant="secondary" icon="refresh" disabled={retrying} disabledReason="正在重新读取" onClick={onRetry}>
              {retrying ? '读取中…' : '重试'}
            </Button>
          </div>
        </div>
      )}
      {rows.map((row) => {
        const visual = attemptVisual({ status: row.status });
        const active = selectedAttemptId === row.attemptId;
        return (
          <div className={`node-att-row${row.isCurrent ? ' cur' : ''}${active ? ' active' : ''}`} key={row.attemptId}>
            <div className="node-att-main">
              <div className="node-att-title">
                尝试 #{row.ordinal}
                <span className={`tag${row.isCurrent ? ' cur' : ''}`}>{row.isCurrent ? '当前' : '历史'}</span>
                <Badge tone={visual.tone} icon={visual.icon}>
                  {visual.label}
                </Badge>
              </div>
              <div className="node-att-meta">
                {row.startedAt === undefined ? '开始时间未记录' : `开始于 ${formatDateTime(row.startedAt)}`}
                {row.endedAt === undefined ? '' : ` · 结束于 ${formatDateTime(row.endedAt)}`}
                {row.definitionPlanRevisionId === undefined ? '' : ` · 定义修订 ${shortId(row.definitionPlanRevisionId)}`}
              </div>
              {row.reasonSummary === undefined ? null : <div className="node-att-why">{row.reasonSummary}</div>}
            </div>
            <div className="node-att-act">
              <Button size="sm" variant="ghost" icon="eye" aria-pressed={active} onClick={() => onSelect(row.attemptId)}>
                查看
              </Button>
            </div>
          </div>
        );
      })}
      <p className="node-list-end">
        <Icon name="check" size="sm" />已显示全部 {String(rows.length)} 次尝试 · 服务未提供保留期与分页信息
      </p>
      <p className="hint">「查看」只读：不会重跑、恢复、推进或验收。执行动作只在当前尝试，并以服务状态为准。</p>
    </div>
  );
}

export interface AttemptDetailProps {
  readonly attempt: Attempt;
  readonly currentAttempt?: Attempt;
  readonly acceptance?: NodeAcceptanceView;
  readonly isCurrent: boolean;
  readonly definitionReason?: string;
  readonly rows: readonly AttemptRowModel[];
  readonly onBack: () => void;
  readonly onSwitch: (attemptId: string) => void;
  readonly onOpenSession: () => void;
  readonly onOpenArtifact: (artifact: ArtifactRef) => void;
  readonly qualityReviewConfigured?: NodeDetail['node']['qualityReview'];
}

/**
 * Design §18 single-attempt detail: ‹ › switch, result / acceptance / artifacts /
 * errors sections and「查看这次的执行现场」. Historical panels stay read-only.
 */
export function AttemptDetailView({ attempt, currentAttempt, acceptance, isCurrent, definitionReason, rows, onBack, onSwitch, onOpenSession, onOpenArtifact, qualityReviewConfigured }: AttemptDetailProps) {
  const ordered = [...rows].sort((left, right) => left.ordinal - right.ordinal);
  const index = ordered.findIndex((row) => row.attemptId === attempt.id);
  const previous = index > 0 ? ordered[index - 1] : undefined;
  const next = index >= 0 && index < ordered.length - 1 ? ordered[index + 1] : undefined;
  const visual = attemptVisual(attempt, isCurrent ? acceptance : undefined);
  const replaced = !isCurrent && attempt.result !== undefined && currentAttempt?.result !== undefined
    ? `已被尝试 #${String(currentAttempt.ordinal)} 的结果 ${currentAttempt.result.resultRevision} 替代`
    : undefined;
  const end = attempt.endedAt === undefined ? (isCurrent && attempt.status === 'running' ? '进行中' : undefined) : attempt.endedAt;
  return (
    <div className="node-attempt-detail">
      <div className="node-sub-head">
        <Button size="sm" variant="ghost" icon="chevLeft" onClick={onBack}>
          尝试列表
        </Button>
        <span className="grow" />
        <span className="node-att-switch" role="group" aria-label="切换尝试">
          <button type="button" className="icon-btn" disabled={previous === undefined} aria-label="上一次尝试" onClick={() => { if (previous !== undefined) onSwitch(previous.attemptId); }}>
            <Icon name="chevLeft" />
          </button>
          <b>尝试 #{attempt.ordinal}</b>
          <button type="button" className="icon-btn" disabled={next === undefined} aria-label="下一次尝试" onClick={() => { if (next !== undefined) onSwitch(next.attemptId); }}>
            <Icon name="chevRight" />
          </button>
        </span>
      </div>
      <div className="node-att-body">
        <div className="node-att-line">
          <span>尝试 #{attempt.ordinal}</span>
          <span className={`tag${isCurrent ? ' cur' : ''}`}>{isCurrent ? '当前' : '历史 · 只读'}</span>
          <Badge tone={visual.tone} icon={visual.icon}>
            {visual.label}
          </Badge>
        </div>
        <dl className="node-kv">
          <dt>时间</dt>
          <dd>
            {attempt.startedAt === undefined ? '开始时间未记录' : clockTime(attempt.startedAt)}
            {' – '}
            {end === undefined ? '结束时间未知' : end === '进行中' ? '进行中' : clockTime(end)}
          </dd>
          <dt>定义修订</dt>
          <dd>{attempt.definition?.planRevisionId === undefined ? '这次尝试未保存步骤定义' : shortId(attempt.definition.planRevisionId)}</dd>
          <dt>执行代次</dt>
          <dd className="hint">服务未提供执行代次字段；每次尝试以尝试序号区分</dd>
          <dt>结果与验收</dt>
          <dd>{resultVisual(attempt, isCurrent ? acceptance : undefined).label}</dd>
        </dl>
        {definitionReason === undefined ? null : <p className="hint">{definitionReason}</p>}

        <div className="sec-t">结果</div>
        {attempt.readability.result === 'forbidden' ? (
          <div className="banner unknown">
            <Icon name="lock" />
            <div className="grow">你已无权查看这次尝试的结果与产物；这里不显示结论。</div>
          </div>
        ) : attempt.result === undefined ? (
          <div className="node-box-dashed">
            {attempt.status === 'failed' ? '这次尝试执行失败，没有提交结果；失败不会被显示成完成。' : attempt.status === 'cancelled' ? '这次尝试已取消，没有提交结果。' : attempt.status === 'running' ? '这次尝试仍在执行，结果尚未提交。' : '这次尝试没有提交结果。'}
          </div>
        ) : (
          <div className="node-box">
            <div className="row wrap" style={{ gap: 8 }}>
              <Badge tone={attempt.result.verification?.state === 'passed' ? 'ok' : attempt.result.verification?.state === 'failed' ? 'fail' : 'idle'} icon={attempt.result.verification?.state === 'passed' ? 'check' : attempt.result.verification?.state === 'failed' ? 'x' : 'minus'}>
                {attempt.result.verification?.state === 'passed' ? '校验通过' : attempt.result.verification?.state === 'failed' ? '校验未通过' : attempt.result.verification === undefined ? '未配置校验' : `校验 ${attempt.result.verification.state}`}
              </Badge>
              <span className="mono hint">结果修订 {attempt.result.resultRevision}</span>
            </div>
            <QualityReviewResult report={attempt.result.qualityReview} configured={qualityReviewConfigured} />
            <p className="node-result-summary">{attempt.result.summary}</p>
            {attempt.result.verification?.summary === undefined ? null : <p className="hint">{attempt.result.verification.summary}</p>}
            {replaced === undefined ? null : (
              <p className="node-replaced">
                <Icon name="info" size="sm" />
                {replaced}
              </p>
            )}
          </div>
        )}

        <div className="sec-t">验收</div>
        {isCurrent ? (
          acceptance === undefined ? (
            <div className="node-box-dashed">这次尝试还没有进入验收；人工验收只在步骤已成功完成时由服务返回。</div>
          ) : (
            <div className="node-box">
              <Badge tone={acceptance.state === 'accepted' ? 'ok' : acceptance.state === 'rejected' ? 'fail' : 'wait'} icon={acceptance.state === 'accepted' ? 'check' : acceptance.state === 'rejected' ? 'x' : 'eye'}>
                {acceptance.state === 'accepted' ? '验收通过' : acceptance.state === 'rejected' ? '未通过' : '待人工验收'}
              </Badge>
              <p className="node-bind">
                <span>绑定 结果修订 {attempt.result?.resultRevision ?? '未提交'}</span>
                <span className="hint">验收策略版本：服务未提供</span>
              </p>
              {acceptance.note === undefined ? null : <p className="hint">备注：{acceptance.note}</p>}
            </div>
          )
        ) : (
          <div className="node-box-dashed">历史尝试的验收结论按节点记录：服务不提供按尝试的验收历史，这里不推测绑定关系。</div>
        )}

        <div className="sec-t">产物 · 属于尝试 #{attempt.ordinal}</div>
        {attempt.readability.result === 'forbidden' ? (
          <div className="node-box-dashed">无权读取这次尝试的产物。</div>
        ) : attempt.result === undefined || attempt.result.artifacts.length === 0 ? (
          <p className="hint">这次尝试没有登记产物。</p>
        ) : (
          <ul className="artifact-list">
            {attempt.result.artifacts.map((artifact) => (
              <li key={artifact.id}>
                <Icon name="file" size="sm" />
                <span className="grow">
                  <b>{artifact.name}</b>
                  <span className="hint">
                    {artifact.mediaType} · {artifact.revision}
                    {artifact.sizeBytes === undefined ? '' : ` · ${String(artifact.sizeBytes)} B`}
                  </span>
                </span>
                <Button size="sm" variant="ghost" icon="eye" onClick={() => onOpenArtifact(artifact)}>
                  打开
                </Button>
              </li>
            ))}
          </ul>
        )}

        {attempt.result === undefined || (attempt.result.errors.length === 0 && attempt.result.warnings.length === 0) ? null : (
          <>
            <div className="sec-t">错误与警告</div>
            <div className="col" style={{ gap: 6 }}>
              {attempt.result.errors.map((error) => (
                <div className="node-sv err" key={`${error.code}-${error.message}`}>
                  <Icon name="alert" size="sm" />
                  <span>
                    <b>{error.code}</b> · {error.message}
                  </span>
                </div>
              ))}
              {attempt.result.warnings.map((warning) => (
                <div className="node-sv warn" key={warning}>
                  <Icon name="info" size="sm" />
                  <span>{warning}</span>
                </div>
              ))}
            </div>
          </>
        )}

        <div className="node-att-actions">
          <Button size="sm" variant="secondary" icon="terminal" onClick={onOpenSession}>
            查看这次的执行现场
          </Button>
          <p className="hint">{isCurrent ? '执行动作只在页脚；这里不放恢复、重跑或验收。' : '历史详情只读：没有恢复、重跑、推进或验收按钮。'}</p>
        </div>
      </div>
    </div>
  );
}
