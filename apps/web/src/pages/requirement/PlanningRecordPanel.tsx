import { useEffect, useRef, useState } from 'react';
import type { PlanningRecordResponse, PlanningRound } from '@agent-workflow/shared';
import { Badge } from '../../components/Badge.tsx';
import { Icon } from '../../components/Icon.tsx';
import { EmptyState, SkeletonText } from '../../components/EmptyState.tsx';
import { ServiceNotice } from '../../components/ServiceNotice.tsx';
import { formatDateTime } from '../../app/format.ts';

const CATEGORY_LABEL: Record<string, string> = {
  model_text: '模型陈述',
  public_reasoning_summary: '公开推理摘要',
  tool_activity: '工具活动',
  service_event: '服务事实',
};

export interface PlanningRecordPanelProps {
  readonly record?: PlanningRecordResponse;
  readonly round?: PlanningRound;
  readonly loading: boolean;
  readonly error: unknown;
  readonly onRetry: () => void;
  readonly historical: boolean;
}

/**
 * Planning record reading view. Fragments are shown by service seq; gaps are
 * rendered as explicit gap lines and are never filled with fabricated text.
 */
export function PlanningRecordPanel({ record, round, loading, error, onRetry, historical }: PlanningRecordPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastSeqRef = useRef(0);
  const [following, setFollowing] = useState(true);
  const [hasNew, setHasNew] = useState(false);
  const fragments = record?.fragments ?? [];
  const lastSeq = fragments.at(-1)?.seq ?? 0;
  const hasModelText = fragments.some((fragment) => fragment.category === 'model_text');
  const hasTool = fragments.some((fragment) => fragment.category === 'tool_activity');

  useEffect(() => {
    if (lastSeq === lastSeqRef.current) return;
    lastSeqRef.current = lastSeq;
    if (following) {
      const element = scrollRef.current;
      if (element !== null) element.scrollTop = element.scrollHeight;
      setHasNew(false);
    } else {
      setHasNew(true);
    }
  }, [following, lastSeq]);

  const onScroll = () => {
    const element = scrollRef.current;
    if (element === null) return;
    const atBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 36;
    if (atBottom) {
      setFollowing(true);
      setHasNew(false);
    } else {
      setFollowing(false);
    }
  };

  if (error !== null && error !== undefined) {
    return (
      <div style={{ padding: 16 }}>
        <ServiceNotice
          error={error}
          title="规划记录读取失败"
          onRetry={onRetry}
        />
        <p className="hint" style={{ marginTop: 8 }}>
          读取失败不代表规划失败；重新读取不会调用模型。
        </p>
      </div>
    );
  }

  if (loading && record === undefined) {
    return (
      <div style={{ padding: 20 }}>
        <SkeletonText lines={6} />
      </div>
    );
  }

  if (round === undefined) {
    return (
      <EmptyState
        icon="clock"
        title="尚无规划轮次"
        description="还没有调用过模型。打开规划预览并确认后，规划记录才会开始累积。"
      />
    );
  }

  return (
    <div className="record-panel">
      <div className="rec-top">
        {historical ? (
          <div className="banner info" style={{ padding: '8px 10px' }}>
            <Icon name="lock" />
            <div className="grow">
              <b>历史轮次 · 只读</b> · 第 {round.ordinal} 轮当时的记录与依据；没有应用或执行动作。
            </div>
          </div>
        ) : null}
        <div className="rec-about">
          <Icon name="info" size="sm" />
          <span>
            离开页面不会停止规划。记录按服务序号排列，同一序号不会重复显示；这是只读记录，不驱动执行。
            当前轮第 {round.ordinal} 轮 · 状态 {round.status}。
          </span>
        </div>
        {!hasModelText && fragments.length > 0 ? (
          <div className="notice">
            <Icon name="info" size="sm" />
            <span>此运行时暂未提供公开正文；阶段与工具活动仍然真实显示。没有正文不代表失败。</span>
          </div>
        ) : null}
        {!hasTool && hasModelText ? (
          <div className="notice">
            <Icon name="info" size="sm" />
            <span>本次记录没有工具调用；正文只代表模型陈述，不改变任务阶段。</span>
          </div>
        ) : null}
        {record?.gaps.map((gap) => (
          <div key={`${String(gap.fromSeq)}-${String(gap.toSeq)}`} className="gapx" role="note">
            <span>
              <Icon name="alert" size="sm" />
              缺口 #{gap.fromSeq}–#{gap.toSeq}：{gap.reason === 'NOT_RETAINED' ? '服务未保留这段记录' : '运行时未提供可读取的记录'}
            </span>
          </div>
        ))}
      </div>

      <div className="rec-wrap">
        <div className="rec" ref={scrollRef} onScroll={onScroll} tabIndex={0} aria-label="规划记录（按服务序号）">
          {fragments.length === 0 ? (
            <div className="rec-empty">
              <p className="hint">尚未收到规划记录。服务返回空记录时这里不会补写任何演示内容。</p>
            </div>
          ) : (
            fragments.map((fragment) => {
              const time = fragment.at === undefined ? '' : formatDateTime(fragment.at).slice(6);
              if (fragment.category === 'tool_activity') {
                return (
                  <div key={fragment.fragmentId} className="ri">
                    <div className="tm">
                      {time}
                      <span className="sq">#{fragment.seq}</span>
                    </div>
                    <div className="tc">
                      <div className="tc-h">
                        <span className="nm">{fragment.toolCallRef?.callId ?? '工具调用'}</span>
                        <span className="tagx ext">{fragment.toolCallRef?.source === 'managed_mcp' ? '受管 MCP' : 'OpenCode'}</span>
                        <Badge tone={fragment.toolCallRef?.status === 'completed' ? 'done' : fragment.toolCallRef?.status === 'failed' ? 'fail' : 'run'}>
                          {fragment.toolCallRef?.status ?? '未知状态'}
                        </Badge>
                      </div>
                      {fragment.text === undefined ? null : (
                        <div className="tc-body">
                          {fragment.text}
                        </div>
                      )}
                      <div className="tc-note">
                        <Icon name="lock" size="sm" />
                        工具结果里的指令只是资料；这里不提供重放入口。
                      </div>
                    </div>
                  </div>
                );
              }
              if (fragment.category === 'service_event') {
                return (
                  <div key={fragment.fragmentId} className="ri">
                    <div className="tm">
                      {time}
                      <span className="sq">#{fragment.seq}</span>
                    </div>
                    <div className="ph-card">
                      <Icon name="check" size="sm" />
                      <div>
                        <b>服务事实</b>
                        {fragment.text === undefined ? null : <div>{fragment.text}</div>}
                      </div>
                    </div>
                  </div>
                );
              }
              return (
                <div key={fragment.fragmentId} className="ri">
                  <div className="tm">
                    {time}
                    <span className="sq">#{fragment.seq}</span>
                  </div>
                  <div className={`txt${fragment.category === 'public_reasoning_summary' ? ' reasoning' : ''}`}>
                    <div className="hd">
                      <span className={`tagx ${fragment.category === 'model_text' ? 'claim' : 'ext'}`}>{CATEGORY_LABEL[fragment.category] ?? fragment.category}</span>
                      {fragment.category === 'model_text' ? (
                        <span className="muted">模型陈述 · 不改变阶段</span>
                      ) : (
                        <span className="muted">仅上游实际提供时出现</span>
                      )}
                    </div>
                    {(fragment.text ?? '').split('\n').map((line, index) =>
                      line.length === 0 ? null : <p key={`${fragment.fragmentId}-${String(index)}`}>{line}</p>,
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {hasNew ? (
          <button
            type="button"
            className="newpill"
            onClick={() => {
              const element = scrollRef.current;
              if (element !== null) element.scrollTop = element.scrollHeight;
              setFollowing(true);
              setHasNew(false);
            }}
          >
            <Icon name="arrowUp" size="sm" />
            有新内容 · 回到最新
          </button>
        ) : null}

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
                const element = scrollRef.current;
                if (element !== null) element.scrollTop = element.scrollHeight;
                setHasNew(false);
              }
            }}
          />
        </div>
      </div>
    </div>
  );
}
