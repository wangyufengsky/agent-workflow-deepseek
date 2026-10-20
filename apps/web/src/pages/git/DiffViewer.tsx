import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { DiffHunk, DiffLine, FileChange, ReviewFinding } from '@agent-workflow/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  classifyGitFailure,
  fetchFixDiff,
  fetchGitDiff,
  gitKeys,
  type DiffPage,
} from '../../api/git.ts';
import { Badge } from '../../components/Badge.tsx';
import { Button } from '../../components/Button.tsx';
import { EmptyState, Skeleton } from '../../components/EmptyState.tsx';
import { Icon } from '../../components/Icon.tsx';
import { SegmentedControl } from '../../components/SegmentedControl.tsx';
import {
  CHANGE_STATUS_LABEL,
  CHANGE_STATUS_TONE,
  DIMENSION_ICON,
  DIMENSION_LABEL,
  FailureNotice,
  SEVERITY_ICON,
  SEVERITY_TONE,
  findingStatusLabel,
  findingStatusTone,
  formatAbsolute,
  severityLabel,
} from './git-shared.tsx';
import { buildIntraLineRanges, type IntraRange } from './intra-line.ts';
import { highlightLine, languageForPath, type SyntaxToken } from './syntax.ts';

export interface DiffViewerProps {
  readonly projectId: string;
  readonly file: FileChange;
  readonly baseSha?: string;
  readonly headSha?: string;
  /** 修复副本：以 fixRunId 选择服务私有 worktree，而不是提交范围。 */
  readonly fixRunId?: string;
  readonly findings?: readonly ReviewFinding[];
  readonly focusFindingId?: string | null;
  readonly onFindingSelect?: (finding: ReviewFinding) => void;
  /** 行下问题卡可直接接受 / 忽略（写审查问题状态；历史审查只读时不传）。 */
  readonly onUpdateFindingStatus?: (findingId: string, status: 'accepted' | 'dismissed') => void;
  readonly findingStatusBusyId?: string | null;
  readonly onBackToReview?: () => void;
  readonly fullscreen: boolean;
  readonly onToggleFullscreen: () => void;
}

function shouldRetry(failureCount: number, error: unknown): boolean {
  return classifyGitFailure(error) === 'failed' && failureCount < 2;
}

function lineCount(hunks: readonly DiffHunk[]): number {
  return hunks.reduce((total, hunk) => total + hunk.lines.length, 0);
}

function isChanged(line: DiffLine): boolean {
  return line.kind === 'add' || line.kind === 'del';
}

function buildSplitRows(hunk: DiffHunk): readonly { readonly left: DiffLine | null; readonly right: DiffLine | null }[] {
  const rows: { left: DiffLine | null; right: DiffLine | null }[] = [];
  const lines = hunk.lines;
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (line === undefined) break;
    if (line.kind === 'context') {
      rows.push({ left: line, right: line });
      index += 1;
      continue;
    }
    if (line.kind === 'no_newline') {
      rows.push({ left: line.oldLine === undefined ? null : line, right: line.newLine === undefined ? null : line });
      index += 1;
      continue;
    }
    const dels: DiffLine[] = [];
    const adds: DiffLine[] = [];
    while (index < lines.length) {
      const current = lines[index];
      if (current === undefined || !isChanged(current)) break;
      if (current.kind === 'del') dels.push(current);
      else adds.push(current);
      index += 1;
    }
    const size = Math.max(dels.length, adds.length);
    for (let offset = 0; offset < size; offset += 1) {
      rows.push({ left: dels[offset] ?? null, right: adds[offset] ?? null });
    }
  }
  return rows;
}

function findingForLine(line: DiffLine, side: 'old' | 'new', findings: readonly ReviewFinding[]): readonly ReviewFinding[] {
  const number = side === 'old' ? line.oldLine : line.newLine;
  if (number === undefined) return [];
  return findings.filter((finding) => {
    const location = finding.location;
    if (location === undefined) return false;
    if (location.side !== side) return false;
    return number >= location.startLine && number <= location.endLine;
  });
}

/** 行内变化区间：把 tokens 按字符偏移切开，落在区间内的片段套 `<mark class="intra">`。 */
function SyntaxText({ tokens, range }: { readonly tokens: readonly SyntaxToken[]; readonly range: IntraRange | undefined }): ReactNode {
  if (tokens.length === 0) return null;
  if (range === undefined) {
    return (
      <>
        {tokens.map((token, index) => (
          <span key={String(index)} className={token.cls === undefined ? undefined : `tok-${token.cls}`}>
            {token.text}
          </span>
        ))}
      </>
    );
  }
  const nodes: ReactNode[] = [];
  let offset = 0;
  tokens.forEach((token, index) => {
    const start = offset;
    offset += token.text.length;
    const className = token.cls === undefined ? undefined : `tok-${token.cls}`;
    const localStart = Math.max(range.start - start, 0);
    const localEnd = Math.min(range.end - start, token.text.length);
    if (localEnd <= 0 || localStart >= token.text.length) {
      nodes.push(
        <span key={String(index)} className={className}>
          {token.text}
        </span>,
      );
      return;
    }
    const before = token.text.slice(0, localStart);
    const inside = token.text.slice(localStart, localEnd);
    const after = token.text.slice(localEnd);
    if (before.length > 0) nodes.push(<span key={`${String(index)}-b`} className={className}>{before}</span>);
    nodes.push(
      <mark key={`${String(index)}-m`} className={className === undefined ? 'intra' : `intra ${className}`}>
        {inside}
      </mark>,
    );
    if (after.length > 0) nodes.push(<span key={`${String(index)}-a`} className={className}>{after}</span>);
  });
  return <>{nodes}</>;
}

function FindingMark({
  finding,
  expanded,
  onSelect,
}: {
  readonly finding: ReviewFinding;
  readonly expanded: boolean;
  readonly onSelect: ((finding: ReviewFinding) => void) | undefined;
}) {
  return (
    <button
      type="button"
      className={['finding-mark', `sev-${finding.severity}`, expanded ? 'open' : ''].filter(Boolean).join(' ')}
      aria-expanded={expanded}
      data-finding-id={finding.findingId}
      title={`${severityLabel(finding.severity)} · ${finding.title}（点击查看问题）`}
      aria-label={`审查问题：${finding.title}`}
      onClick={() => {
        onSelect?.(finding);
      }}
    >
      !
    </button>
  );
}

const SEVERITY_RANK: Record<ReviewFinding['severity'], number> = { blocker: 0, critical: 1, major: 2, suggestion: 3 };

function highestSeverity(findings: readonly ReviewFinding[]): ReviewFinding['severity'] | undefined {
  let result: ReviewFinding['severity'] | undefined;
  for (const finding of findings) {
    if (result === undefined || SEVERITY_RANK[finding.severity] < SEVERITY_RANK[result]) result = finding.severity;
  }
  return result;
}

/** 行下问题卡（设计 g33）：直接接受 / 忽略，或回到问题列表处理。 */
function InlineFindingCard({
  finding,
  busy,
  readOnly,
  onUpdate,
  onBackToReview,
  onCollapse,
}: {
  readonly finding: ReviewFinding;
  readonly busy: boolean;
  readonly readOnly: boolean;
  readonly onUpdate: ((findingId: string, status: 'accepted' | 'dismissed') => void) | undefined;
  readonly onBackToReview: (() => void) | undefined;
  readonly onCollapse: () => void;
}) {
  return (
    <div className="diff-finding-card" data-finding-card={finding.findingId} role="group" aria-label={`审查问题：${finding.title}`}>
      <div className="finding-head">
        <Badge tone={SEVERITY_TONE[finding.severity]} icon={SEVERITY_ICON[finding.severity]}>{severityLabel(finding.severity)}</Badge>
        <Badge outline icon={DIMENSION_ICON[finding.dimension]} tone="neutral">{DIMENSION_LABEL[finding.dimension]}</Badge>
        <span className="finding-title">{finding.title}</span>
        <Badge tone={findingStatusTone(finding.status)}>{findingStatusLabel(finding.status)}</Badge>
      </div>
      <div className="finding-detail">{finding.detail}</div>
      {finding.location === undefined ? null : (
        <span className="muted-note mono-sm">
          {finding.location.path}:{String(finding.location.startLine)}–{String(finding.location.endLine)} · {finding.location.side === 'new' ? '新版本' : '旧版本'}
        </span>
      )}
      <div className="finding-actions">
        <Button variant="ghost" size="sm" icon="check" disabled={readOnly || busy || finding.status === 'accepted'} disabledReason={readOnly ? '历史审查只读。' : finding.status === 'accepted' ? '已标记为接受。' : undefined} onClick={() => { onUpdate?.(finding.findingId, 'accepted'); }}>
          接受
        </Button>
        <Button variant="ghost" size="sm" icon="eye" disabled={readOnly || busy || finding.status === 'dismissed'} disabledReason={readOnly ? '历史审查只读。' : finding.status === 'dismissed' ? '已忽略。' : undefined} onClick={() => { onUpdate?.(finding.findingId, 'dismissed'); }}>
          忽略
        </Button>
        <span className="spacer" />
        {onBackToReview === undefined ? null : (
          <Button variant="ghost" size="sm" icon="list" onClick={onBackToReview}>
            回到问题列表
          </Button>
        )}
        <Button variant="ghost" size="sm" icon="chevUp" onClick={onCollapse}>
          收起
        </Button>
      </div>
    </div>
  );
}


/** 折叠未改动上下文：设计稿的「展开 20 行 / 全部」。 */
function DiffGap({
  lines,
  canExpand,
  expanding,
  onExpand,
}: {
  readonly lines: number;
  readonly canExpand: boolean;
  readonly expanding: boolean;
  readonly onExpand: ((lines: number) => void) | undefined;
}) {
  return (
    <div className="diff-gap" role="note">
      <Icon name="chevDown" size="sm" />
      <span className="grow">未改动的 {String(lines)} 行未显示</span>
      {canExpand && onExpand !== undefined ? (
        <>
          <Button variant="ghost" size="sm" disabled={expanding} onClick={() => { onExpand(20); }}>
            展开 20 行
          </Button>
          <Button variant="ghost" size="sm" disabled={expanding} onClick={() => { onExpand(lines); }}>
            全部 {String(lines)} 行
          </Button>
        </>
      ) : (
        <span className="muted-note">{expandUnavailableNote(canExpand)}</span>
      )}
    </div>
  );
}

function expandUnavailableNote(canExpand: boolean): string {
  return canExpand ? '展开失败：服务没有返回更大的上下文。' : '修复副本的 diff 暂不支持展开上下文（服务读口未开放）。';
}

interface GapInfo {
  readonly lines: number;
}

/** 由 hunk 头计算与上一个 hunk 之间的未改动行数；首 hunk 之前也要折叠。 */
function gapBefore(hunks: readonly DiffHunk[], index: number): GapInfo | undefined {
  const hunk = hunks[index];
  if (hunk === undefined) return undefined;
  const previous = index === 0 ? undefined : hunks[index - 1];
  const oldStart = hunk.oldStart;
  if (Number.isNaN(oldStart) || oldStart <= 1) return undefined;
  const previousEnd = previous === undefined ? 1 : previous.oldStart + previous.oldLines;
  const gap = oldStart - previousEnd;
  return gap > 0 ? { lines: gap } : undefined;
}

/** 单文件 diff 查看器：统一 / 并排、忽略空白、全宽、hunk 折叠、展开上下文、语法着色、行内高亮。 */
export function DiffViewer({
  projectId,
  file,
  baseSha,
  headSha,
  fixRunId,
  findings = [],
  focusFindingId,
  onFindingSelect,
  onUpdateFindingStatus,
  findingStatusBusyId,
  onBackToReview,
  fullscreen,
  onToggleFullscreen,
}: DiffViewerProps) {
  const [ignoreWhitespace, setIgnoreWhitespace] = useState(false);
  const [mode, setMode] = useState<'unified' | 'split'>('unified');
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [moreHunks, setMoreHunks] = useState<readonly DiffHunk[]>([]);
  const [moreDiff, setMoreDiff] = useState<DiffPage | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<unknown>(null);
  const [extraContext, setExtraContext] = useState(0);
  const [expandedFindingId, setExpandedFindingId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const canExpand = fixRunId === undefined;
  const requestedContext = canExpand && extraContext > 0 ? 3 + extraContext : undefined;

  const diffQuery = useQuery({
    queryKey:
      fixRunId === undefined
        ? [...gitKeys.diff(projectId, `${file.path}|${baseSha ?? ''}|${headSha ?? ''}`, ignoreWhitespace), extraContext] as const
        : gitKeys.fixDiff(projectId, fixRunId, `${file.fileId}|${ignoreWhitespace}`),
    queryFn: async () => {
      if (fixRunId !== undefined) {
        return fetchFixDiff(projectId, fixRunId, file, ignoreWhitespace);
      }
      return fetchGitDiff(projectId, {
        path: file.path,
        baseSha,
        headSha,
        ignoreWhitespace,
        ...(requestedContext === undefined ? {} : { contextLines: requestedContext }),
      });
    },
    retry: shouldRetry,
    staleTime: 30_000,
    enabled: !file.binary,
    // 读取失败时保留上一次成功内容（设计 g21：失败只影响失败的那一块）。
    placeholderData: keepPreviousData,
  });

  // 切换文件 / 空白选项 / 视图时重置本地阅读状态。
  const diffIdentity = `${file.fileId}|${ignoreWhitespace}|${fixRunId ?? ''}`;
  useEffect(() => {
    setCollapsed(new Set());
    setMoreHunks([]);
    setMoreDiff(null);
    setLoadMoreError(null);
    setExtraContext(0);
    setExpandedFindingId(null);
  }, [diffIdentity]);

  useEffect(() => {
    if (focusFindingId === null || focusFindingId === undefined) return;
    const target = containerRef.current?.querySelector(`[data-finding-id="${focusFindingId}"]`);
    if (target instanceof HTMLElement) {
      target.scrollIntoView({ block: 'center', behavior: 'smooth' });
      target.focus({ preventScroll: true });
    }
  }, [focusFindingId, diffQuery.dataUpdatedAt]);

  const selectFinding = (finding: ReviewFinding): void => {
    setExpandedFindingId((current) => (current === finding.findingId ? null : finding.findingId));
    onFindingSelect?.(finding);
  };

  const diff = diffQuery.data;
  const hunks = useMemo(() => [...(diff?.hunks ?? []), ...moreHunks], [diff, moreHunks]);
  const nextCursor = moreDiff === null ? diff?.nextCursor : moreDiff.nextCursor;
  const truncated = moreDiff?.truncated ?? diff?.truncated;
  const fileFindings = findings.filter((finding) => finding.location?.path === file.path);
  const lineTotal = lineCount(hunks);
  const allCollapsed = hunks.length > 0 && hunks.every((hunk) => collapsed.has(hunk.hunkId));
  const language = useMemo(() => languageForPath(file.path), [file.path]);

  // 语法着色与行内高亮都是纯派生：只读取服务返回的行文本，不改变行文本内容。
  const tokensByAnchor = useMemo(() => {
    const map = new Map<string, readonly SyntaxToken[]>();
    let state = { inBlockComment: false };
    for (const hunk of hunks) {
      for (const line of hunk.lines) {
        const result = highlightLine(line.text, language, state);
        map.set(line.anchorId, result.tokens);
        state = result.state;
      }
    }
    return map;
  }, [hunks, language]);

  const intraRanges = useMemo(() => {
    const map = new Map<string, IntraRange>();
    for (const hunk of hunks) {
      for (const [anchorId, range] of buildIntraLineRanges(hunk.lines)) map.set(anchorId, range);
    }
    return map;
  }, [hunks]);

  const expandedFinding = expandedFindingId === null ? undefined : fileFindings.find((finding) => finding.findingId === expandedFindingId);
  const expandedIndex = expandedFindingId === null ? -1 : fileFindings.findIndex((finding) => finding.findingId === expandedFindingId);

  const cycleFinding = (direction: 1 | -1): void => {
    if (fileFindings.length === 0) return;
    const next = expandedIndex === -1
      ? (direction === 1 ? 0 : fileFindings.length - 1)
      : (expandedIndex + direction + fileFindings.length) % fileFindings.length;
    const finding = fileFindings[next];
    if (finding === undefined) return;
    setExpandedFindingId(finding.findingId);
    onFindingSelect?.(finding);
  };

  const toggleHunk = (hunkId: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(hunkId)) next.delete(hunkId);
      else next.add(hunkId);
      return next;
    });
  };

  const toggleAll = () => {
    if (allCollapsed) {
      setCollapsed(new Set());
      return;
    }
    setCollapsed(new Set(hunks.map((hunk) => hunk.hunkId)));
  };

  const expandContext = (lines: number) => {
    // 服务硬上限（GIT_LIMITS.maxDiffContextLines = 2000）：一次读足够大的上下文，
    // 「全部」与「再展开」都只是增大 unified 半径后重新读取同一个文件。
    setExtraContext((current) => Math.min(current + lines, 2_000));
  };

  const loadMore = async () => {
    if (nextCursor === undefined || diff === undefined) return;
    setLoadingMore(true);
    setLoadMoreError(null);
    try {
      const page =
        fixRunId === undefined
          ? await fetchGitDiff(projectId, {
              path: file.path,
              baseSha,
              headSha,
              ignoreWhitespace,
              cursor: nextCursor,
              ...(requestedContext === undefined ? {} : { contextLines: requestedContext }),
            })
          : await fetchFixDiff(projectId, fixRunId, file, ignoreWhitespace, nextCursor);
      setMoreHunks((current) => [...current, ...page.hunks]);
      setMoreDiff(page);
    } catch (error) {
      setLoadMoreError(error);
    } finally {
      setLoadingMore(false);
    }
  };

  const renderedCards = new Set<string>();
  const inlineCardFor = (line: DiffLine, side: 'old' | 'new'): ReactNode => {
    if (expandedFinding === undefined || expandedFinding.location === undefined) return null;
    if (renderedCards.has(expandedFinding.findingId)) return null;
    if (expandedFinding.location.side !== side) return null;
    const number = side === 'old' ? line.oldLine : line.newLine;
    if (number !== expandedFinding.location.startLine) return null;
    renderedCards.add(expandedFinding.findingId);
    return (
      <InlineFindingCard
        finding={expandedFinding}
        busy={findingStatusBusyId === expandedFinding.findingId}
        readOnly={onUpdateFindingStatus === undefined}
        onUpdate={onUpdateFindingStatus}
        onBackToReview={onBackToReview}
        onCollapse={() => { setExpandedFindingId(null); }}
      />
    );
  };
  const severityClass = (line: DiffLine, side: 'old' | 'new'): string => {
    const severity = highestSeverity(findingForLine(line, side, fileFindings));
    return severity === undefined ? '' : `has-finding sev-${severity}`;
  };

  const staleError = diffQuery.isError && diff !== undefined;
  const contentPending = diff === undefined && diffQuery.isPending;

  return (
    <div className="diff-pane">
      <div className="diff-toolbar">
        <span className="diff-file-title">
          <Badge tone={CHANGE_STATUS_TONE[file.status]}>{CHANGE_STATUS_LABEL[file.status]}</Badge>
          <span className="ellipsis">{file.path}</span>
        </span>
        <span className="spacer" />
        {fileFindings.length === 0 ? null : (
          <span className="finding-nav" aria-label="这个文件里的审查问题">
            <Icon name="alert" size="sm" />
            问题 {expandedIndex === -1 ? '–' : String(expandedIndex + 1)} / {String(fileFindings.length)}
            <button type="button" className="icon-btn" aria-label="上一个问题" onClick={() => { cycleFinding(-1); }}>
              <Icon name="chevUp" size="sm" />
            </button>
            <button type="button" className="icon-btn" aria-label="下一个问题" onClick={() => { cycleFinding(1); }}>
              <Icon name="chevDown" size="sm" />
            </button>
          </span>
        )}
        <SegmentedControl
          ariaLabel="差异视图"
          value={mode}
          onChange={(value) => {
            setMode(value);
            // 并排视图需要宽度：切到并排自动全宽；切回统一不自动退出全宽（设计 g13）。
            if (value === 'split' && !fullscreen) onToggleFullscreen();
          }}
          options={[
            { value: 'unified', label: '统一' },
            { value: 'split', label: '并排' },
          ]}
        />
        <label className="inline-check" style={{ fontSize: 12 }}>
          <input
            type="checkbox"
            checked={ignoreWhitespace}
            onChange={(event) => { setIgnoreWhitespace(event.target.checked); }}
          />
          忽略空白
        </label>
        <Button variant={fullscreen ? 'secondary' : 'ghost'} size="sm" icon={fullscreen ? 'panel' : 'split'} onClick={onToggleFullscreen}>
          {fullscreen ? '退出全宽' : '全宽'}
        </Button>
        {hunks.length === 0 ? null : (
          <Button variant="ghost" size="sm" icon="chevDown" onClick={toggleAll}>
            {allCollapsed ? '全部展开' : '全部收起'}
          </Button>
        )}
      </div>

      <div className="row-wrap" style={{ marginBottom: 8 }}>
        {file.oldPath === undefined ? null : (
          <span className="rename-note">
            <Icon name="split" size="sm" />
            重命名 {file.oldPath} → {file.path}
          </span>
        )}
        {file.mode === undefined ? null : (
          <span className="mode-note">
            权限 {file.mode.old ?? '?'} → {file.mode.new ?? '?'}
          </span>
        )}
        {file.sizeClass === 'large' ? <Badge tone="fail" icon="alert">大文件 · 分段读取</Badge> : null}
        {file.sizeClass === 'too_large' ? <Badge tone="danger" icon="alert">超出读取上限</Badge> : null}
        {baseSha === undefined ? null : <span className="mono-sm">base {baseSha.slice(0, 7)}</span>}
        {headSha === undefined ? null : <span className="mono-sm">head {headSha.slice(0, 7)}</span>}
        {diff?.ignoreWhitespace === true ? <span className="diff-note">服务已按忽略空白返回</span> : null}
        {extraContext > 0 ? (
          <>
            <Badge tone="accent" icon="chevUp">已展开上下文 +{String(extraContext)} 行</Badge>
            <Button variant="ghost" size="sm" icon="refresh" onClick={() => { setExtraContext(0); }}>
              恢复默认上下文
            </Button>
          </>
        ) : null}
      </div>

      {staleError ? (
        <>
          <FailureNotice error={diffQuery.error} onRetry={() => { void diffQuery.refetch(); }} compact />
          <p className="muted-note" style={{ margin: '4px 0 8px' }}>
            下方保留上次成功读取的内容（读取于 {formatAbsolute(new Date(diffQuery.dataUpdatedAt).toISOString())}）；失败只影响这次重新读取。
          </p>
        </>
      ) : null}

      {file.binary ? (
        <div className="diff-container">
          <div className="diff-binary">
            <b>二进制文件</b>
            <br />
            服务没有提供文本差异；界面不会把二进制内容渲染成文本。请在本机用合适的工具查看。
          </div>
        </div>
      ) : contentPending ? (
        <div className="diff-container" style={{ padding: 14 }}>
          <Skeleton height={12} />
          <div style={{ height: 8 }} />
          <Skeleton width="82%" height={12} />
          <div style={{ height: 8 }} />
          <Skeleton width="66%" height={12} />
        </div>
      ) : diffQuery.isError && diff === undefined ? (
        <FailureNotice error={diffQuery.error} onRetry={() => { void diffQuery.refetch(); }} />
      ) : diff === undefined ? (
        <EmptyState compact icon="file" title="没有差异数据" description="服务返回的空差异不会显示成“文件未改动”。" />
      ) : hunks.length === 0 ? (
        <EmptyState compact icon="file" title="这个文件没有行级差异" description="可能是仅权限变更、重命名，或服务判断没有可显示的 hunk。" />
      ) : (
        <>
          <div className={['diff-container', fullscreen ? 'fullscreen' : ''].filter(Boolean).join(' ')}>
            <div className="diff-scroll" ref={containerRef}>
              {hunks.map((hunk, hunkIndex) => {
                const isCollapsed = collapsed.has(hunk.hunkId);
                const gap = gapBefore(hunks, hunkIndex);
                return (
                  <section key={hunk.hunkId} className={['diff-hunk', isCollapsed ? 'collapsed' : ''].filter(Boolean).join(' ')}>
                    {gap === undefined || isCollapsed ? null : (
                      <DiffGap
                        lines={gap.lines}
                        canExpand={canExpand}
                        expanding={diffQuery.isFetching}
                        onExpand={canExpand ? expandContext : undefined}
                      />
                    )}
                    <button
                      type="button"
                      className="diff-hunk-head"
                      aria-expanded={!isCollapsed}
                      onClick={() => { toggleHunk(hunk.hunkId); }}
                    >
                      <Icon name={isCollapsed ? 'chevRight' : 'chevDown'} size="sm" />
                      <span>{hunk.header}</span>
                      {hunk.section === undefined ? null : <span className="section">{hunk.section}</span>}
                      <span className="spacer" />
                      <span>{String(hunk.lines.length)} 行</span>
                    </button>
                    {isCollapsed ? null : (
                      <div className="diff-table">
                        {mode === 'unified'
                          ? hunk.lines.map((line) => (
                              <div key={`${hunk.hunkId}:${line.anchorId}`}>
                                <div className={['diff-line', line.kind, line.kind === 'del' ? severityClass(line, 'old') : severityClass(line, 'new')].filter(Boolean).join(' ')}>
                                  <span className="ln">{line.oldLine === undefined ? '' : String(line.oldLine)}</span>
                                  <span className="ln">{line.newLine === undefined ? '' : String(line.newLine)}</span>
                                  <span className="code">
                                    <span aria-hidden="true" style={{ color: 'var(--faint)' }}>
                                      {line.kind === 'add' ? '+' : line.kind === 'del' ? '−' : line.kind === 'no_newline' ? '\\' : ' '}
                                    </span>
                                    {line.kind === 'del'
                                      ? findingForLine(line, 'old', fileFindings).map((finding) => (
                                          <FindingMark key={finding.findingId} finding={finding} expanded={expandedFindingId === finding.findingId} onSelect={selectFinding} />
                                        ))
                                      : null}
                                    {line.kind === 'add' || line.kind === 'context'
                                      ? findingForLine(line, 'new', fileFindings).map((finding) => (
                                          <FindingMark key={finding.findingId} finding={finding} expanded={expandedFindingId === finding.findingId} onSelect={selectFinding} />
                                        ))
                                      : null}
                                    <SyntaxText tokens={tokensByAnchor.get(line.anchorId) ?? [{ text: line.text }]} range={intraRanges.get(line.anchorId)} />
                                  </span>
                                </div>
                                {line.kind === 'del' ? inlineCardFor(line, 'old') : line.kind === 'no_newline' ? null : inlineCardFor(line, 'new')}
                              </div>
                            ))
                          : buildSplitRows(hunk).map((row, index) => {
                              const left = row.left;
                              const right = row.right;
                              return (
                                <div key={`${hunk.hunkId}:split:${String(index)}`}>
                                  <div className="diff-line split">
                                    <span className="ln">{left?.oldLine === undefined ? '' : String(left.oldLine)}</span>
                                    <span className={['code', left?.kind === 'del' ? 'del-code' : '', left === null ? 'diff-empty-line' : '', left === null ? '' : severityClass(left, 'old')].filter(Boolean).join(' ')}>
                                      {left === null ? '' : (
                                        <>
                                          {left.kind === 'del' ? '− ' : '  '}
                                          {left.kind === 'del'
                                            ? findingForLine(left, 'old', fileFindings).map((finding) => (
                                                <FindingMark key={finding.findingId} finding={finding} expanded={expandedFindingId === finding.findingId} onSelect={selectFinding} />
                                              ))
                                            : null}
                                          <SyntaxText tokens={tokensByAnchor.get(left.anchorId) ?? [{ text: left.text }]} range={intraRanges.get(left.anchorId)} />
                                        </>
                                      )}
                                    </span>
                                    <span className="ln">{right?.newLine === undefined ? '' : String(right.newLine)}</span>
                                    <span className={['code', right?.kind === 'add' ? 'add-code' : '', right === null ? 'diff-empty-line' : '', right === null ? '' : severityClass(right, 'new')].filter(Boolean).join(' ')}>
                                      {right === null ? '' : (
                                        <>
                                          {right.kind === 'add' ? '+ ' : '  '}
                                          {right.kind === 'add' || right.kind === 'context'
                                            ? findingForLine(right, 'new', fileFindings).map((finding) => (
                                                <FindingMark key={finding.findingId} finding={finding} expanded={expandedFindingId === finding.findingId} onSelect={selectFinding} />
                                              ))
                                            : null}
                                          <SyntaxText tokens={tokensByAnchor.get(right.anchorId) ?? [{ text: right.text }]} range={intraRanges.get(right.anchorId)} />
                                        </>
                                      )}
                                    </span>
                                  </div>
                                  {left !== null && left.kind === 'del' ? inlineCardFor(left, 'old') : right !== null ? inlineCardFor(right, 'new') : null}
                                </div>
                              );
                            })}
                      </div>
                    )}
                  </section>
                );
              })}
            </div>

            {truncated === undefined ? null : (
              <div className="diff-truncated" role="status">
                <Icon name="alert" size="sm" />
                <span>
                  差异被截断（{truncated.reason === 'LINE_LIMIT' ? '行数上限' : '字节上限'}，已显示 {String(truncated.shownLines)} 行
                  {lineTotal === 0 ? '' : `，本页共 ${String(lineTotal)} 行`}）。
                </span>
                <span className="grow" />
                {nextCursor === undefined ? (
                  <span className="muted-note">服务没有提供更多分页。</span>
                ) : (
                  <Button variant="secondary" size="sm" icon="download" disabled={loadingMore} onClick={() => { void loadMore(); }}>
                    {loadingMore ? '读取中…' : '加载全部'}
                  </Button>
                )}
              </div>
            )}
          </div>
          {loadMoreError === null || loadMoreError === undefined ? null : (
            <FailureNotice error={loadMoreError} onRetry={() => { void loadMore(); }} compact className="inline-banner" />
          )}
          {fileFindings.length === 0 ? null : (
            <p className="muted-note" style={{ marginTop: 8 }}>
              这个文件有 {String(fileFindings.length)} 个审查问题；圆点可在 diff 中定位，点击在行下展开问题卡（接受 / 忽略），或回到审查页签处理。
            </p>
          )}
          <p className="muted-note" style={{ marginTop: 4 }}>
            语法着色与行内高亮仅作用于展示，不改变 diff 文本；展开上下文会重新读取真实的未改动行。
          </p>
        </>
      )}
    </div>
  );
}
