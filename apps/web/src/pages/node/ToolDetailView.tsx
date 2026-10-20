import { useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { ROUTES, type OutputFragment, type ToolCallReadResponse } from '@agent-workflow/shared';
import { ApiClientError, apiGet } from '../../api/client.ts';
import { Badge } from '../../components/Badge.tsx';
import { Button } from '../../components/Button.tsx';
import { Icon } from '../../components/Icon.tsx';
import { ReadableText } from './ReadableText.tsx';
import { clockTime } from './node-facts.ts';
import { TOOL_SOURCE_NOTE, toolSourceLabel, toolVisual } from './node-labels.ts';

function CopyInline({ text, label }: { readonly text: string; readonly label: string }) {
  const [state, setState] = useState<'idle' | 'ok' | 'fail'>('idle');
  return (
    <Button
      size="sm"
      variant="ghost"
      icon="copy"
      aria-label={label}
      title={state === 'fail' ? '复制失败，请手动选择内容' : label}
      onClick={() => {
        void navigator.clipboard.writeText(text).then(
          () => setState('ok'),
          () => setState('fail'),
        );
      }}
    >
      {state === 'ok' ? '已复制' : state === 'fail' ? '复制失败' : '复制'}
    </Button>
  );
}

/**
 * Tool call detail (design §19): source tag, call ID, attempt, status, start/end/
 * duration, parameter and result summary, then the parameter/result/error viewer.
 * `FORBIDDEN` locks the content but keeps the summary layer; `CAPABILITY_UNAVAILABLE`
 * is a neutral unknown (the design explicitly says this is not an error).
 */
export function ToolDetailView({ taskId, nodeId, attemptId, fragment, attemptLabel }: { readonly taskId: string; readonly nodeId: string; readonly attemptId: string; readonly fragment: OutputFragment; readonly attemptLabel: string }) {
  const [part, setPart] = useState<'input' | 'output' | 'error'>('output');
  const callId = fragment.toolCallRef?.callId ?? '';
  const query = useInfiniteQuery({
    queryKey: ['node-tool', taskId, nodeId, attemptId, callId, part],
    initialPageParam: undefined as string | undefined,
    enabled: !!attemptId && !!callId,
    retry: false,
    queryFn: async ({ pageParam }) => {
      const response = (await apiGet<ToolCallReadResponse>(`${ROUTES.nodeTool(taskId, nodeId, attemptId, callId)}?part=${part}${pageParam === undefined ? '' : `&cursor=${encodeURIComponent(pageParam)}`}`)).data;
      if (response.taskId !== taskId || response.nodeId !== nodeId || response.attemptId !== attemptId || response.callId !== callId || response.part !== part) throw new ApiClientError({ kind: 'protocol', message: '调用记录身份不一致，请重新读取' });
      return response;
    },
    getNextPageParam: (page) => page.nextCursor,
  });
  const code = query.error instanceof ApiClientError ? query.error.code : null;
  const forbidden = code === 'FORBIDDEN';
  const capabilityMissing = code === 'CAPABILITY_UNAVAILABLE';
  const stale = code === 'STALE_TARGET';
  const missing = code === 'NOT_FOUND';
  const pages = query.data?.pages ?? [];
  const first = pages[0];
  const status = first?.status ?? fragment.toolCallRef?.status ?? 'unknown';
  const evidence = first?.evidence ?? fragment.toolEvidence;
  // The read response intentionally omits argument/output/error bodies (they come
  // from the part reader); the record-level evidence keeps the summary lines.
  const summary = fragment.toolEvidence;
  const visual = toolVisual(status, false);
  const content = pages.map((page) => page.content ?? '').join('');
  const contentLoaded = pages.length > 0 && !forbidden && !capabilityMissing && !missing;
  const pageError = query.error !== null && query.error !== undefined && contentLoaded;
  const lineCount = content.length === 0 ? 0 : content.split('\n').length;
  const hasMore = query.hasNextPage;
  const partLabel = part === 'input' ? '调用参数' : part === 'error' ? '错误信息' : '返回结果';
  return (
    <div className="node-tool-view">
      <div className="row wrap" style={{ gap: 8 }}>
        <span className="node-td-name">{evidence?.name ?? fragment.toolEvidence?.name ?? '工具调用'}</span>
        <span className="node-src-tag">{toolSourceLabel(fragment.toolCallRef?.source)}</span>
        <span className="grow" />
        <Badge tone={visual.tone} icon={visual.icon}>
          {visual.label}
        </Badge>
      </div>
      <div className="node-td-meta">
        <span>调用 ID</span>
        <code>{callId.length === 0 ? '调用ID未记录' : `#${callId}`}</code>
        {callId.length === 0 ? null : <CopyInline text={callId} label="复制调用 ID" />}
        <span>
          · 所属 <b>{attemptLabel}</b>
        </span>
      </div>
      <div className="node-td-time">
        <div>
          <div className="k">开始</div>
          <div className={`v${evidence?.startedAt === undefined ? ' unk' : ''}`}>{evidence?.startedAt === undefined ? '未知' : clockTime(evidence.startedAt)}</div>
        </div>
        <div>
          <div className="k">结束</div>
          <div className={`v${evidence?.endedAt === undefined ? ' unk' : ''}`}>
            {evidence?.endedAt === undefined ? (status === 'running' || status === 'queued' || status === 'called' ? '尚未结束' : '未知') : clockTime(evidence.endedAt)}
          </div>
        </div>
        <div>
          <div className="k">时长</div>
          <div className={`v${evidence?.durationMs === undefined ? ' unk' : ''}`}>{evidence?.durationMs === undefined ? '未记录' : `${String(evidence.durationMs)} ms`}</div>
        </div>
      </div>
      <div className="node-td-src">
        <Icon name="terminal" size="sm" />
        {TOOL_SOURCE_NOTE[fragment.toolCallRef?.source ?? ''] ?? '来源说明未提供'}
      </div>
      <div className="node-td-sum">
        <div className="node-tc-l">
          <span className="k">参数</span>
          <span className={summary?.input === undefined ? 'v muted' : 'v'}>{summary?.input === undefined ? '服务未记录调用参数' : (summary.input.split('\n')[0] ?? '').slice(0, 160)}</span>
        </div>
        <div className="node-tc-l">
          <span className="k">结果</span>
          <span className={status === 'completed' ? 'v' : 'v muted'}>
            {status === 'completed'
              ? (summary?.output === undefined ? '服务未记录返回结果' : (summary.output.split('\n')[0] ?? '').slice(0, 160))
              : status === 'failed'
                ? (summary?.error === undefined ? '调用失败（服务未记录错误详情）' : (summary.error.split('\n')[0] ?? '').slice(0, 160))
                : status === 'running' || status === 'queued' || status === 'called'
                  ? '等待服务返回结果'
                  : '没有记录到结果'}
          </span>
        </div>
      </div>
      {forbidden ? (
        <div className="node-lock">
          <span className="tile">
            <Icon name="lock" size="lg" />
          </span>
          <h3>你没有查看此调用完整参数的权限</h3>
          <p>只显示上方的摘要层。完整参数与输出不会在这里、复制或下载中出现。</p>
        </div>
      ) : capabilityMissing ? (
        <div className="node-lock unk">
          <span className="tile">
            <Icon name="help" size="lg" />
          </span>
          <h3>当前服务尚未提供工具完整参数读取</h3>
          <p>这不是错误：OpenCode 工具活动记录目前只提供摘要。上方摘要来自服务记录；不会显示成“已完整读取”。</p>
        </div>
      ) : missing ? (
        <div className="node-lock">
          <span className="tile">
            <Icon name="alert" size="lg" />
          </span>
          <h3>服务找不到这次工具调用记录</h3>
          <p>记录可能已被清理；这里不用其他调用的内容代替。</p>
        </div>
      ) : (
        <>
          <div className="node-seg" role="tablist" aria-label="参数与结果">
            {(
              [
                ['input', '参数'],
                ['output', '结果'],
                ['error', '错误'],
              ] as const
            ).map(([value, label]) => (
              <button key={value} type="button" role="tab" aria-selected={part === value} className={`node-seg-item${part === value ? ' active' : ''}`} onClick={() => setPart(value)}>
                {label}
              </button>
            ))}
          </div>
          {query.isPending && query.fetchStatus !== 'idle' ? (
            <p role="status">
              <span className="spin" aria-hidden="true" /> 正在读取调用内容…
            </p>
          ) : null}
          {stale ? (
            <div className="banner warn" role="alert">
              <Icon name="alert" />
              <div className="grow">
                <b>工具调用内容已更新</b>
                <br />
                之前读到的内容可能过期；重新读取只重读这次调用，不会执行任何工具。
              </div>
              <div className="actions">
                <Button size="sm" variant="secondary" icon="refresh" onClick={() => { void query.refetch(); }}>
                  重新读取
                </Button>
              </div>
            </div>
          ) : null}
          {pageError ? (
            <div className="banner danger" role="alert">
              <Icon name="alert" />
              <div className="grow">
                <b>读取失败</b>
                <br />
                继续读取时出错；下面保留已加载的内容。
              </div>
              <div className="actions">
                <Button size="sm" variant="secondary" icon="refresh" onClick={() => { void query.fetchNextPage(); }}>
                  重新读取
                </Button>
              </div>
            </div>
          ) : null}
          {query.error !== null && query.error !== undefined && !contentLoaded && !stale && !pageError ? <p role="alert"><Icon name="alert" size="sm" /> {partLabel}读取失败；没有可显示的内容。</p> : null}
          {first !== undefined && first.content === null ? (
            <div className="node-box-dashed">服务没有保存这部分的{partLabel}。</div>
          ) : contentLoaded ? (
            <>
              <ReadableText
                key={`${callId}:${part}`}
                text={content}
                header={
                  <>
                    <span className="node-fmt-chip">{looksJson(content) ? 'JSON' : '文本'}</span>
                    <span className="hint">复制只含服务返回的保留内容</span>
                  </>
                }
                footer={
                  <span className="grow">
                    已加载 1–{String(lineCount)} 行{hasMore ? ' · 服务还有更多可继续读取' : ' · 已加载全部返回内容'}
                  </span>
                }
              />
              {hasMore && !pageError ? (
                <Button disabled={query.isFetchingNextPage} disabledReason="正在读取下一段" onClick={() => { void query.fetchNextPage(); }}>
                  {query.isFetchingNextPage ? '读取中…' : '继续读取'}
                </Button>
              ) : null}
            </>
          ) : contentLoaded ? null : null}
        </>
      )}
      {evidence?.redacted === true ? (
        <div className="node-redact">
          <Icon name="lock" size="sm" />
          <span>已隐藏 · 服务端脱敏</span>
          <span className="hint">值在服务端已隐藏，从未发送到这里；复制与下载同样不含这些值。</span>
        </div>
      ) : null}
      {evidence?.truncated === true ? (
        <div className="banner warn" role="status">
          <Icon name="alert" />
          <div className="grow">
            <b>内容已截断：服务只保留了受限长度的内容</b>
            <br />
            具体保留量服务未提供；以下是服务保留的全部内容，复制同样只含保留部分。
          </div>
        </div>
      ) : null}
      {status === 'failed' ? (
        <p className="hint">
          <Icon name="alert" size="sm" /> 这次工具调用失败。已记录内容可继续阅读。
        </p>
      ) : null}
      <p className="hint node-td-foot">
        <Icon name="info" size="sm" /> 执行现场列出的工具不一定是全部工具轨迹：受管 MCP 结算与 OpenCode 工具活动是两类记录来源。这里只查看记录，不提供重新执行。
      </p>
    </div>
  );
}

function looksJson(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return false;
  try {
    JSON.parse(trimmed);
    return true;
  } catch {
    return false;
  }
}
