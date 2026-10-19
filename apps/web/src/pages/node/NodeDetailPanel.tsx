import { useEffect, useMemo, useRef, useState } from 'react';
import { NODE_STATUS_LABEL, type Attempt, type NodeDetail, type OutputFragment } from '@agent-workflow/shared';
import { Badge } from '../../components/Badge.tsx';
import { Button } from '../../components/Button.tsx';
import { Icon } from '../../components/Icon.tsx';
import { IconButton } from '../../components/IconButton.tsx';
import { EmptyState, SkeletonText } from '../../components/EmptyState.tsx';
import { ServiceNotice } from '../../components/ServiceNotice.tsx';
import { useNodeAttempts, useNodeDetail, useNodeOutput, type PollInterval, type WorkflowStreamConnection } from '../../api/workflow.ts';
import { NODE_KIND_LABEL } from '../../flow/types.ts';
import { FactPill, FactsBar } from '../../flow/workflow-ui.tsx';
import { formatAbsoluteTime, formatDateTime } from '../../app/format.ts';
import './node.css';

type NodeTab = 'overview' | 'session' | 'attempts';

const EDGE_KIND_LABEL: Record<'data' | 'order' | 'resource', string> = { data: '数据依赖', order: '顺序依赖', resource: '资源依赖' };

function nodeStatusText(status: string): string {
  return NODE_STATUS_LABEL[status as keyof typeof NODE_STATUS_LABEL] ?? status;
}

const RESULT_STATE_LABEL: Record<string, { label: string; tone: 'ok' | 'fail' | 'idle' | 'run' }> = {
  passed: { label: '校验通过', tone: 'ok' },
  failed: { label: '校验未通过', tone: 'fail' },
  not_configured: { label: '未配置校验', tone: 'idle' },
  error: { label: '校验出错', tone: 'fail' },
};

function fragmentTag(category: OutputFragment['category']): { label: string; className: string } {
  switch (category) {
    case 'model_text':
      return { label: '模型陈述', className: 'claim' };
    case 'public_reasoning_summary':
      return { label: '公开推理摘要 · 模型陈述', className: 'claim' };
    case 'tool_activity':
      return { label: '工具活动 · 外部资料', className: 'ext' };
    default:
      return { label: '服务事实', className: 'fact' };
  }
}

export interface NodeDetailPanelProps {
  readonly taskId: string;
  readonly nodeId: string;
  readonly connection: WorkflowStreamConnection;
  readonly pollInterval: PollInterval;
  readonly onClose: () => void;
  readonly onOpenPlan?: () => void;
}

/**
 * 节点执行现场：事实条、公开正文/工具卡、尝试列表与只读历史。
 * Missing model text is stated as a runtime fact — never filled with fake prose.
 */
export function NodeDetailPanel({ taskId, nodeId, connection, pollInterval, onClose, onOpenPlan }: NodeDetailPanelProps) {
  const [tab, setTab] = useState<NodeTab>('session');
  const [selectedAttemptId, setSelectedAttemptId] = useState<string | undefined>(undefined);
  const detailQuery = useNodeDetail(taskId, nodeId);
  const attemptsQuery = useNodeAttempts(taskId, nodeId);
  const selectedAttemptIdResolved = selectedAttemptId ?? detailQuery.data?.currentAttempt?.id;
  const outputQuery = useNodeOutput(taskId, nodeId, selectedAttemptIdResolved, pollInterval);

  useEffect(() => {
    setTab('session');
    setSelectedAttemptId(undefined);
  }, [nodeId]);

  const detail = detailQuery.data;
  const currentAttempt = detail?.currentAttempt;
  const attempts =
    attemptsQuery.data?.attempts ??
    (detail?.attempts ?? []).map((attempt) => ({
      attemptId: attempt.id,
      ordinal: attempt.ordinal,
      status: attempt.status,
      isCurrent: attempt.id === currentAttempt?.id,
      startedAt: attempt.startedAt,
      endedAt: attempt.endedAt,
      reasonSummary: attempt.result?.summary,
    }));
  const isHistoricalAttempt = selectedAttemptIdResolved !== undefined && currentAttempt !== undefined && selectedAttemptIdResolved !== currentAttempt.id;
  const selectedAttempt: Attempt | undefined = useMemo(() => {
    if (detail === undefined) return undefined;
    if (selectedAttemptIdResolved === undefined) return detail.attempts[0];
    return detail.attempts.find((attempt) => attempt.id === selectedAttemptIdResolved) ?? (currentAttempt?.id === selectedAttemptIdResolved ? currentAttempt : undefined);
  }, [currentAttempt, detail, selectedAttemptIdResolved]);
  const fragments = outputQuery.data?.fragments ?? detail?.output.fragments ?? [];
  const capability = detail?.output.capabilities;
  const hasModelText = fragments.some((fragment) => fragment.category === 'model_text');
  const terminal = outputQuery.data?.terminal ?? detail?.output.terminal ?? false;
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [following, setFollowing] = useState(true);

  useEffect(() => {
    if (!following) return;
    const element = scrollerRef.current;
    if (element !== null) element.scrollTop = element.scrollHeight;
  }, [following, fragments.length]);

  if (detailQuery.isError) {
    return (
      <aside className="side node-side" aria-label="节点执行现场">
        <div className="side-head">
          <h2 className="grow">节点执行现场</h2>
          <IconButton icon="x" label="关闭节点面板" onClick={onClose} />
        </div>
        <div className="side-body">
          <ServiceNotice
            error={detailQuery.error}
            onRetry={() => {
              void detailQuery.refetch();
            }}
          />
        </div>
      </aside>
    );
  }

  if (detailQuery.isLoading || detail === undefined) {
    return (
      <aside className="side node-side" aria-label="节点执行现场">
        <div className="side-head">
          <h2 className="grow">节点执行现场</h2>
          <IconButton icon="x" label="关闭节点面板" onClick={onClose} />
        </div>
        <div className="side-body">
          <SkeletonText lines={8} />
        </div>
      </aside>
    );
  }

  return (
    <aside className="side node-side" aria-label="节点执行现场">
      <div className="side-head node-side-head">
        <div className="node-head-row">
          <div className="grow">
            <div className="node-head-eyebrow">
              <Badge outline>{NODE_KIND_LABEL[detail.node.kind]}</Badge>
              {detail.group === undefined ? null : <span className="hint">{detail.group.label}</span>}
              <span className="mono muted">{detail.node.key}</span>
            </div>
            <h2 className="node-head-title">{detail.node.title}</h2>
          </div>
          <IconButton icon="x" label="关闭节点面板" onClick={onClose} />
        </div>
        <div className="tabs node-tabs" role="tablist" aria-label="节点页签">
          {(
            [
              ['overview', '概览'],
              ['session', '执行现场'],
              ['attempts', '尝试与产出'],
            ] as const
          ).map(([id, label]) => (
            <button key={id} type="button" role="tab" className="tab" aria-selected={tab === id} onClick={() => setTab(id)}>
              {label}
              {id === 'attempts' ? <span className="tab-n">{attempts.length}</span> : null}
            </button>
          ))}
        </div>
      </div>

      <div className="side-body node-side-body">
        {tab === 'overview' ? <NodeOverview detail={detail} onOpenPlan={onOpenPlan} /> : null}
        {tab === 'session' ? (
          <div className="node-session">
            <FactsBar>
              <FactPill label="数据连接" value={connection === 'connected' ? '已连接' : connection === 'connecting' ? '正在连接' : '已断开（只读轮询）'} tone={connection === 'connected' ? 'ok' : connection === 'connecting' ? 'neutral' : 'warn'} />
              <FactPill label="模型正文" value={capability?.modelText === 'ok' ? (hasModelText ? '有公开正文' : terminal ? '未提供正文' : '等待正文') : '此运行时未提供'} tone={hasModelText ? 'ok' : 'neutral'} />
              <FactPill label="工具" value={fragments.some((f) => f.category === 'tool_activity') ? '有工具记录' : '无工具记录'} tone="neutral" />
              <FactPill label="尝试" value={`${String(attempts.length)} 次`} tone="neutral" />
              <FactPill label="结果与验收" value={detail.execution === undefined ? '尚未执行' : NODE_STATUS_LABEL[detail.execution.status]} tone={detail.execution?.status === 'succeeded' ? 'ok' : detail.execution?.status === 'failed' ? 'warn' : 'neutral'} />
            </FactsBar>
            <p className="node-explain">{explainSentence(detail, hasModelText)}</p>

            {isHistoricalAttempt ? (
              <div className="hist-bar" role="status">
                <Icon name="clock" size="sm" />
                <span className="grow">正在查看尝试 #{selectedAttempt?.ordinal ?? '?'} 的固定记录 · 只读，不会追加，也不触发执行。</span>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    setSelectedAttemptId(undefined);
                  }}
                >
                  回到当前尝试
                </Button>
              </div>
            ) : null}

            {capability?.modelText !== 'ok' ? (
              <div className="notice">
                <Icon name="info" size="sm" />
                <span>此运行时暂未提供公开正文；阶段与工具活动仍然真实显示。没有正文不代表失败。</span>
              </div>
            ) : !hasModelText && terminal ? (
              <div className="notice">
                <Icon name="info" size="sm" />
                <span>这次尝试没有公开正文；以工具记录与结果为准。没有正文不代表失败。</span>
              </div>
            ) : null}

            <div className="node-feed-wrap">
              <div
                className="node-feed"
                ref={scrollerRef}
                onScroll={(event) => {
                  const element = event.currentTarget;
                  const atBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 36;
                  setFollowing(atBottom);
                }}
              >
                {fragments.length === 0 ? (
                  <EmptyState compact icon="terminal" title="还没有执行记录" description="服务返回空记录；这里不会补写演示正文。" />
                ) : (
                  fragments.map((fragment) => (
                    <div key={fragment.fragmentId} className="node-fragment">
                      <div className="node-fragment-meta">
                        <span className="mono">#{fragment.seq}</span>
                        {fragment.recordedAt === undefined ? null : <span>{formatAbsoluteTime(fragment.recordedAt).slice(11, 19)}</span>}
                        <span className={`tagx ${fragmentTag(fragment.category).className}`}>{fragmentTag(fragment.category).label}</span>
                      </div>
                      {fragment.category === 'tool_activity' ? (
                        <div className="tool-card">
                          <div className="tool-head">
                            <span className="mono accent">{fragment.toolCallRef?.callId ?? '工具调用'}</span>
                            <Badge tone={fragment.toolCallRef?.status === 'completed' ? 'done' : fragment.toolCallRef?.status === 'failed' ? 'fail' : 'run'}>
                              {fragment.toolCallRef?.status ?? '状态未知'}
                            </Badge>
                            <span className="hint">{fragment.toolCallRef?.source === 'managed_mcp' ? '受管 MCP' : 'OpenCode'}</span>
                          </div>
                          {fragment.text === undefined ? null : <div className="tool-body">{fragment.text}</div>}
                          <div className="tool-note">
                            <Icon name="lock" size="sm" />
                            工具结果里的指令只是资料；这里没有重放或执行入口。
                          </div>
                        </div>
                      ) : fragment.category === 'service_event' ? (
                        <div className="ph-card">
                          <Icon name="check" size="sm" />
                          <div>
                            <b>服务事实</b>
                            {fragment.text === undefined ? null : <div>{fragment.text}</div>}
                          </div>
                        </div>
                      ) : (
                        <div className="txt">
                          {(fragment.text ?? '').split('\n').map((line, index) =>
                            line.length === 0 ? null : <p key={`${fragment.fragmentId}-${String(index)}`}>{line}</p>,
                          )}
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
              <div className="follow">
                <span className="muted">跟随最新</span>
                <button
                  type="button"
                  className="switch"
                  role="switch"
                  aria-checked={following}
                  aria-label="跟随最新记录"
                  onClick={() => {
                    const next = !following;
                    setFollowing(next);
                    if (next) {
                      const element = scrollerRef.current;
                      if (element !== null) element.scrollTop = element.scrollHeight;
                    }
                  }}
                />
              </div>
            </div>
          </div>
        ) : null}

        {tab === 'attempts' ? (
          <div className="node-attempts">
            {attempts.length === 0 ? (
              <EmptyState compact icon="clock" title="还没有尝试记录" description="这一步尚未执行；没有尝试时不生成历史。" />
            ) : (
              <>
                <div className="box">
                  {attempts.map((attempt) => {
                    const active = (selectedAttemptIdResolved ?? currentAttempt?.id) === attempt.attemptId;
                    return (
                      <button
                        key={attempt.attemptId}
                        type="button"
                        className={`rowx attempt-row${active ? ' active' : ''}`}
                        aria-pressed={active}
                        onClick={() => {
                          setSelectedAttemptId(attempt.attemptId);
                        }}
                      >
                        <span className={`ic ${attempt.status === 'succeeded' ? 'ok' : attempt.status === 'failed' ? 'no' : attempt.status === 'running' ? 'run' : 'idle'}`}>
                          <Icon name={attempt.status === 'succeeded' ? 'check' : attempt.status === 'failed' ? 'x' : attempt.status === 'running' ? 'play' : 'clock'} size="sm" />
                        </span>
                        <span className="grow">
                          <span className="t">
                            尝试 #{attempt.ordinal} {attempt.isCurrent ? '· 当前' : '· 历史'}
                          </span>
                          <span className="s">
                            {attempt.startedAt === undefined ? '未开始' : formatDateTime(attempt.startedAt)}
                            {attempt.endedAt === undefined ? '' : ` → ${formatDateTime(attempt.endedAt)}`}
                            {attempt.reasonSummary === undefined ? '' : ` · ${attempt.reasonSummary}`}
                          </span>
                        </span>
                        <Badge tone={attempt.status === 'succeeded' ? 'done' : attempt.status === 'failed' ? 'fail' : attempt.status === 'running' ? 'run' : 'idle'}>
                          {nodeStatusText(attempt.status)}
                        </Badge>
                      </button>
                    );
                  })}
                </div>

                <div className="sec-t" style={{ marginTop: 16 }}>
                  所选尝试的结果与产出
                </div>
                {isHistoricalAttempt ? (
                  <div className="banner info" style={{ marginBottom: 10 }}>
                    <Icon name="lock" />
                    <div className="grow">历史尝试只读：结果、验收与产物都属于所选尝试；没有重跑、恢复或验收入口。</div>
                  </div>
                ) : null}
                {selectedAttempt?.result === undefined ? (
                  <p className="hint">这次尝试还没有提交结果。没有结果时不显示结论，也不把“正文结束”当作完成。</p>
                ) : (
                  <div className="box pad">
                    <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                      <Badge tone={selectedAttempt.result.verification?.state === 'passed' ? 'ok' : selectedAttempt.result.verification?.state === 'failed' ? 'fail' : 'idle'}>
                        {RESULT_STATE_LABEL[selectedAttempt.result.verification?.state ?? 'not_configured']?.label ?? '验收状态未知'}
                      </Badge>
                      <span className="mono muted" style={{ fontSize: 11.5 }}>
                        结果修订 {selectedAttempt.result.resultRevision}
                      </span>
                    </div>
                    <p className="node-result-summary">{selectedAttempt.result.summary}</p>
                    {selectedAttempt.result.verification?.summary === undefined ? null : (
                      <p className="hint">{selectedAttempt.result.verification.summary}</p>
                    )}
                    {selectedAttempt.result.errors.length > 0 ? (
                      <ul className="list-plain" style={{ marginTop: 8 }}>
                        {selectedAttempt.result.errors.map((error) => (
                          <li key={`${error.code}-${error.message}`} style={{ color: 'var(--warn)' }}>
                            {error.code} · {error.message}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    {selectedAttempt.result.warnings.length > 0 ? (
                      <ul className="list-plain" style={{ marginTop: 8 }}>
                        {selectedAttempt.result.warnings.map((warning) => (
                          <li key={warning}>{warning}</li>
                        ))}
                      </ul>
                    ) : null}
                    <div className="sec-t" style={{ marginTop: 12 }}>
                      产物
                    </div>
                    {selectedAttempt.result.artifacts.length === 0 ? (
                      <p className="hint">这次尝试没有登记产物。</p>
                    ) : (
                      <ul className="artifact-list">
                        {selectedAttempt.result.artifacts.map((artifact) => (
                          <li key={artifact.id}>
                            <Icon name="file" size="sm" />
                            <span className="grow">
                              <b>{artifact.name}</b>
                              <span className="hint">
                                {artifact.mediaType}
                                {artifact.sizeBytes === undefined ? '' : ` · ${String(artifact.sizeBytes)} B`}
                              </span>
                            </span>
                            <span className="mono hint">{artifact.sha256.slice(0, 12)}…</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        ) : null}

        {tab === 'overview' ? null : null}

        {attemptsQuery.isError ? <p className="hint">尝试列表读取失败；不会用当前尝试顶替历史。</p> : null}
        {outputQuery.isError ? <p className="hint">执行记录读取失败；已显示已持久化的片段，重连后会补读。</p> : null}
      </div>
    </aside>
  );
}

function explainSentence(detail: NodeDetail, hasModelText: boolean): string {
  const status = detail.execution?.status;
  if (status === undefined) return '这一步尚未执行；没有尝试记录时不会预造正文或结果。';
  if (status === 'running') return hasModelText ? '正文正在记录；模型说“完成了”不会改变步骤状态。' : '正文尚未出现；以服务事实与工具活动为准。';
  if (status === 'failed') return '这次执行失败；已收到的正文与工具记录保留，不会自动重试。';
  if (status === 'succeeded') return '结果已提交并通过验收时才会显示完成；产出与证据属于这次尝试。';
  return `当前状态：${NODE_STATUS_LABEL[status]}；以服务事实为准。`;
}

function NodeOverview({ detail, onOpenPlan }: { readonly detail: NodeDetail; readonly onOpenPlan?: () => void }) {
  return (
    <div>
      <div className="banner info" style={{ marginBottom: 12 }}>
        <Icon name="info" />
        <div className="grow">
          <b>{detail.group?.label ?? '未分组'} · {detail.node.key}</b>
          <br />
          {detail.node.summary}
        </div>
        {onOpenPlan === undefined ? null : (
          <div className="actions">
            <Button size="sm" variant="secondary" icon="flow" onClick={onOpenPlan}>
              打开计划
            </Button>
          </div>
        )}
      </div>

      <div className="sec-t">状态</div>
      <FactsBar>
        <FactPill label="执行状态" value={detail.execution === undefined ? '未执行' : NODE_STATUS_LABEL[detail.execution.status]} tone={detail.execution?.status === 'succeeded' ? 'ok' : detail.execution?.status === 'failed' ? 'warn' : 'neutral'} />
        <FactPill label="尝试次数" value={String(detail.execution?.attemptCount ?? 0)} />
        <FactPill label="当前尝试" value={detail.currentAttempt === undefined ? '—' : `#${String(detail.currentAttempt.ordinal)}`} />
        <FactPill label="结果与验收" value={detail.currentAttempt?.result === undefined ? '尚未提交' : detail.currentAttempt.result.verification === undefined ? '无验收记录' : RESULT_STATE_LABEL[detail.currentAttempt.result.verification.state]?.label ?? '未知'} />
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
            {detail.node.inputs.length === 0 ? <span className="hint">无</span> : detail.node.inputs.map((input, index) => <span key={`${input.name}-${String(index)}`} className="io-chip">{input.name} · {input.source}</span>)}
          </div>
          <span className="io-arrow">
            <Icon name="arrowRight" size="sm" />
          </span>
          <div className="io-side">
            {detail.node.outputs.length === 0 ? <span className="hint">无</span> : detail.node.outputs.map((output, index) => <span key={`${output.name}-${String(index)}`} className="io-chip">{output.name} · 执行后才有结果</span>)}
          </div>
        </li>
      </ul>

      <div className="sec-t" style={{ marginTop: 14 }}>
        验收条款
      </div>
      {detail.node.acceptance.length === 0 ? <p className="hint">服务未声明验收条款。</p> : <ul className="list-plain">{detail.node.acceptance.map((item, index) => <li key={`${item}-${String(index)}`}>{item}</li>)}</ul>}

      <div className="sec-t" style={{ marginTop: 14 }}>
        读写资源
      </div>
      <div className="io-list">
        <li>
          <div className="io-side">
            <span className="hint">读取</span>
            {detail.node.resources.read.length === 0 ? <span className="hint">无</span> : detail.node.resources.read.map((resource) => <span key={`r-${resource.label}`} className="io-chip">{resource.label} · {resource.basis}</span>)}
          </div>
          <span className="io-arrow" />
          <div className="io-side">
            <span className="hint">写入</span>
            {detail.node.resources.write.length === 0 ? <span className="hint">无</span> : detail.node.resources.write.map((resource) => <span key={`w-${resource.label}`} className="io-chip">{resource.label} · {resource.basis}</span>)}
          </div>
        </li>
      </div>

      <div className="sec-t" style={{ marginTop: 14 }}>
        动作
      </div>
      <p className="hint">
        {Object.entries(detail.actions)
          .map(([key, action]) => `${key}: ${action.allowed ? '允许' : (action.reason ?? '不允许')}`)
          .join(' · ') || '服务未提供节点动作'}
      </p>
    </div>
  );
}
