import { useEffect, useMemo, useRef, useState } from 'react';
import type { DiffHunk, DiffLine, FileChange, ReviewFinding } from '@agent-workflow/shared';
import { useQuery } from '@tanstack/react-query';
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
  FailureNotice,
  countDelta,
  severityLabel,
} from './git-shared.tsx';

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

function FindingMark({
  finding,
  onSelect,
}: {
  readonly finding: ReviewFinding;
  readonly onSelect: ((finding: ReviewFinding) => void) | undefined;
}) {
  return (
    <button
      type="button"
      className={`finding-mark sev-${finding.severity}`}
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

/**
 * Diff 查看器：统一 / 并排、忽略空白、全宽、hunk 折叠、截断与二进制 / 重命名 / 权限标注。
 * 纯只读；切换只影响本视图，不写仓库。
 */
export function DiffViewer({
  projectId,
  file,
  baseSha,
  headSha,
  fixRunId,
  findings = [],
  focusFindingId,
  onFindingSelect,
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
  const containerRef = useRef<HTMLDivElement>(null);

  const diffQuery = useQuery({
    queryKey:
      fixRunId === undefined
        ? gitKeys.diff(projectId, `${file.path}|${baseSha ?? ''}|${headSha ?? ''}`, ignoreWhitespace)
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
      });
    },
    retry: shouldRetry,
    staleTime: 30_000,
    enabled: !file.binary,
  });

  // 切换文件 / 空白选项 / 视图时重置本地阅读状态。
  const diffIdentity = `${file.fileId}|${ignoreWhitespace}|${fixRunId ?? ''}`;
  useEffect(() => {
    setCollapsed(new Set());
    setMoreHunks([]);
    setMoreDiff(null);
    setLoadMoreError(null);
  }, [diffIdentity]);

  useEffect(() => {
    if (focusFindingId === null || focusFindingId === undefined) return;
    const target = containerRef.current?.querySelector(`[data-finding-id="${focusFindingId}"]`);
    if (target instanceof HTMLElement) {
      target.scrollIntoView({ block: 'center', behavior: 'smooth' });
      target.focus({ preventScroll: true });
    }
  }, [focusFindingId, diffQuery.dataUpdatedAt]);

  const diff = diffQuery.data;
  const hunks = useMemo(() => [...(diff?.hunks ?? []), ...moreHunks], [diff, moreHunks]);
  const nextCursor = moreDiff === null ? diff?.nextCursor : moreDiff.nextCursor;
  const truncated = moreDiff?.truncated ?? diff?.truncated;
  const fileFindings = findings.filter((finding) => finding.location?.path === file.path);
  const lineTotal = lineCount(hunks);
  const allCollapsed = hunks.length > 0 && hunks.every((hunk) => collapsed.has(hunk.hunkId));

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

  const loadMore = async () => {
    if (nextCursor === undefined || diff === undefined) return;
    setLoadingMore(true);
    setLoadMoreError(null);
    try {
      const page =
        fixRunId === undefined
          ? await fetchGitDiff(projectId, { path: file.path, baseSha, headSha, ignoreWhitespace, cursor: nextCursor })
          : await fetchFixDiff(projectId, fixRunId, file, ignoreWhitespace, nextCursor);
      setMoreHunks((current) => [...current, ...page.hunks]);
      setMoreDiff(page);
    } catch (error) {
      setLoadMoreError(error);
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <div className="diff-pane">
      <div className="diff-toolbar">
        <span className="diff-file-title">
          <Badge tone={CHANGE_STATUS_TONE[file.status]}>{CHANGE_STATUS_LABEL[file.status]}</Badge>
          <span className="ellipsis">{file.path}</span>
        </span>
        <span className="spacer" />
        <SegmentedControl
          ariaLabel="差异视图"
          value={mode}
          onChange={(value) => { setMode(value); }}
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
      </div>

      {file.binary ? (
        <div className="diff-container">
          <div className="diff-binary">
            <b>二进制文件</b>
            <br />
            服务没有提供文本差异；界面不会把二进制内容渲染成文本。请在本机用合适的工具查看。
          </div>
        </div>
      ) : diffQuery.isPending ? (
        <div className="diff-container" style={{ padding: 14 }}>
          <Skeleton height={12} />
          <div style={{ height: 8 }} />
          <Skeleton width="82%" height={12} />
          <div style={{ height: 8 }} />
          <Skeleton width="66%" height={12} />
        </div>
      ) : diffQuery.isError ? (
        <FailureNotice error={diffQuery.error} onRetry={() => { void diffQuery.refetch(); }} />
      ) : diff === undefined ? (
        <EmptyState compact icon="file" title="没有差异数据" description="服务返回的空差异不会显示成“文件未改动”。" />
      ) : hunks.length === 0 ? (
        <EmptyState compact icon="file" title="这个文件没有行级差异" description="可能是仅权限变更、重命名，或服务判断没有可显示的 hunk。" />
      ) : (
        <>
          <div className={['diff-container', fullscreen ? 'fullscreen' : ''].filter(Boolean).join(' ')}>
            <div className="diff-scroll" ref={containerRef}>
              {hunks.map((hunk) => {
                const isCollapsed = collapsed.has(hunk.hunkId);
                return (
                  <section key={hunk.hunkId} className={['diff-hunk', isCollapsed ? 'collapsed' : ''].filter(Boolean).join(' ')}>
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
                              <div key={`${hunk.hunkId}:${line.anchorId}`} className={['diff-line', line.kind].join(' ')}>
                                <span className="ln">{line.oldLine === undefined ? '' : String(line.oldLine)}</span>
                                <span className="ln">{line.newLine === undefined ? '' : String(line.newLine)}</span>
                                <span className="code">
                                  <span aria-hidden="true" style={{ color: 'var(--faint)' }}>
                                    {line.kind === 'add' ? '+' : line.kind === 'del' ? '−' : line.kind === 'no_newline' ? '\\' : ' '}
                                  </span>
                                  {line.kind === 'del'
                                    ? findingForLine(line, 'old', fileFindings).map((finding) => (
                                        <FindingMark key={finding.findingId} finding={finding} onSelect={onFindingSelect} />
                                      ))
                                    : null}
                                  {line.kind === 'add' || line.kind === 'context'
                                    ? findingForLine(line, 'new', fileFindings).map((finding) => (
                                        <FindingMark key={finding.findingId} finding={finding} onSelect={onFindingSelect} />
                                      ))
                                    : null}
                                  {line.text}
                                </span>
                              </div>
                            ))
                          : buildSplitRows(hunk).map((row, index) => {
                              const left = row.left;
                              const right = row.right;
                              return (
                                <div key={`${hunk.hunkId}:split:${String(index)}`} className="diff-line split">
                                  <span className="ln">{left?.oldLine === undefined ? '' : String(left.oldLine)}</span>
                                  <span className={['code', left?.kind === 'del' ? 'del-code' : '', left === null ? 'diff-empty-line' : ''].filter(Boolean).join(' ')}>
                                    {left === null ? '' : (
                                      <>
                                        {left.kind === 'del' ? '− ' : '  '}
                                        {left.kind === 'del'
                                          ? findingForLine(left, 'old', fileFindings).map((finding) => (
                                              <FindingMark key={finding.findingId} finding={finding} onSelect={onFindingSelect} />
                                            ))
                                          : null}
                                        {left.text}
                                      </>
                                    )}
                                  </span>
                                  <span className="ln">{right?.newLine === undefined ? '' : String(right.newLine)}</span>
                                  <span className={['code', right?.kind === 'add' ? 'add-code' : '', right === null ? 'diff-empty-line' : ''].filter(Boolean).join(' ')}>
                                    {right === null ? '' : (
                                      <>
                                        {right.kind === 'add' ? '+ ' : '  '}
                                        {right.kind === 'add' || right.kind === 'context'
                                          ? findingForLine(right, 'new', fileFindings).map((finding) => (
                                              <FindingMark key={finding.findingId} finding={finding} onSelect={onFindingSelect} />
                                            ))
                                          : null}
                                        {right.text}
                                      </>
                                    )}
                                  </span>
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
              这个文件有 {String(fileFindings.length)} 个审查问题；行号旁的圆点可在 diff 中定位，点击交给审查页签处理。
            </p>
          )}
        </>
      )}
    </div>
  );
}
