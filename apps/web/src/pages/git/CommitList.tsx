import { useMemo } from 'react';
import type { GitCommitSummary } from '@agent-workflow/shared';
import { Badge } from '../../components/Badge.tsx';
import { Button } from '../../components/Button.tsx';
import { EmptyState, Skeleton } from '../../components/EmptyState.tsx';
import { Icon } from '../../components/Icon.tsx';
import { CommitGraphCell, CommitGraphPass, layoutCommitGraph, type CommitGraphRow, type GraphLane } from './commit-graph.tsx';
import { FailureNotice, dateGroupLabel, dateKey, formatTime, reviewLabel, reviewStateTone, shortSha } from './git-shared.tsx';

/** 提交行高度（与 git.css 的 .commit-row min-height 一致，图谱按此高度绘制）。 */
const COMMIT_ROW_HEIGHT = 58;
const GROUP_HEAD_HEIGHT = 30;

export interface CommitListProps {
  readonly commits: readonly GitCommitSummary[];
  readonly selectedSha: string | null;
  readonly onSelect: (sha: string) => void;
  readonly loading: boolean;
  readonly error: unknown;
  readonly onRetry: () => void;
  readonly nextCursor: string | undefined;
  readonly loadingMore: boolean;
  readonly loadMoreError: unknown;
  readonly onLoadMore: () => void;
  readonly shallowBoundaryReached: boolean;
  readonly filtered: boolean;
  readonly loadedCount: number;
}

function CommitSkeleton() {
  return (
    <div style={{ padding: '8px 12px' }}>
      {[0, 1, 2, 3, 4, 5].map((index) => (
        <div key={index} className="stack-tight" style={{ padding: '8px 2px' }}>
          <Skeleton width={`${String(58 + (index % 3) * 9)}%`} height={12} />
          <Skeleton width={`${String(28 + (index % 2) * 12)}%`} height={10} />
        </div>
      ))}
    </div>
  );
}

interface CommitGroup {
  readonly key: string;
  readonly rows: readonly { readonly commit: GitCommitSummary; readonly graph: CommitGraphRow | undefined }[];
  /** 上一组最后一行留下的泳道：日期分组头处续接，图谱不会在分组之间断开。 */
  readonly passIn: readonly GraphLane[];
}

/**
 * 中栏提交列表：按作者日期分组，带简化泳道图谱（按真实父提交关系布局）与审查徽标。
 * 筛选关键词时按设计隐藏图谱、提交平铺；图谱不伪造历史，也不改变提交顺序。
 */
export function CommitList({
  commits,
  selectedSha,
  onSelect,
  loading,
  error,
  onRetry,
  nextCursor,
  loadingMore,
  loadMoreError,
  onLoadMore,
  shallowBoundaryReached,
  filtered,
  loadedCount,
}: CommitListProps) {
  const layout = useMemo(() => layoutCommitGraph(commits), [commits]);
  const graphBySha = useMemo(() => new Map(layout.rows.map((row) => [row.sha, row])), [layout]);

  const groups = useMemo<readonly CommitGroup[]>(() => {
    const buckets = new Map<string, GitCommitSummary[]>();
    for (const commit of commits) {
      const key = dateKey(commit.authoredAt);
      const bucket = buckets.get(key);
      if (bucket === undefined) buckets.set(key, [commit]);
      else bucket.push(commit);
    }
    let passIn: readonly GraphLane[] = [];
    const result: CommitGroup[] = [];
    for (const [key, rows] of buckets.entries()) {
      const last = rows[rows.length - 1];
      const lastGraph = last === undefined ? undefined : graphBySha.get(last.sha);
      result.push({
        key,
        rows: rows.map((commit) => ({ commit, graph: graphBySha.get(commit.sha) })),
        passIn,
      });
      if (lastGraph !== undefined) passIn = lastGraph.bottom.filter((lane): lane is GraphLane => lane !== null);
    }
    return result;
  }, [commits, graphBySha]);

  if (loading) return <CommitSkeleton />;

  if (error !== null && error !== undefined) {
    return (
      <div style={{ padding: 12 }}>
        <FailureNotice error={error} onRetry={onRetry} compact />
      </div>
    );
  }

  if (commits.length === 0) {
    return (
      <div className="git-mid-empty">
        <EmptyState
          compact
          icon={filtered ? 'filter' : 'list'}
          title={filtered ? '已加载的提交里没有匹配项' : '这个引用还没有提交'}
          description={
            filtered
              ? `筛选只作用于已加载的 ${String(loadedCount)} 个提交；不会向服务伪造查询结果。`
              : '服务读取到的提交列表为空。空仓库或被浅克隆边界截断时都不会编造历史。'
          }
        />
      </div>
    );
  }

  return (
    <>
      {groups.map((group) => (
        <section key={group.key} aria-label={dateGroupLabel(group.key)}>
          <div className="commit-group-head">
            <span className="commit-graph-pass" aria-hidden="true">
              {filtered || group.passIn.length === 0 ? null : (
                <CommitGraphPass lanes={group.passIn} laneCount={layout.laneCount} height={GROUP_HEAD_HEIGHT} />
              )}
            </span>
            <Icon name="calendar" size="sm" />
            {dateGroupLabel(group.key)}
            <span className="grow" />
            <span>{String(group.rows.length)} 个提交</span>
          </div>
          {group.rows.map(({ commit, graph }) => {
            const selected = commit.sha === selectedSha;
            const review = commit.review;
            const head = commit.refs.some((ref) => ref.kind === 'head');
            return (
              <button
                key={commit.sha}
                type="button"
                className="commit-row"
                aria-selected={selected}
                onClick={() => { onSelect(commit.sha); }}
              >
                {filtered || graph === undefined ? null : (
                  <span className="commit-graph" aria-hidden="true">
                    <CommitGraphCell row={graph} rowHeight={COMMIT_ROW_HEIGHT} head={head} />
                  </span>
                )}
                <span className="commit-main">
                  <span className="commit-subject">{commit.subject}</span>
                  <span className="commit-meta">
                    <span className="sha">{shortSha(commit.sha)}</span>
                    <span>·</span>
                    <span className="ellipsis">{commit.author.name}</span>
                    <span>·</span>
                    <span>{formatTime(commit.authoredAt)}</span>
                    {commit.parents.length > 1 ? <span className="chip">合并</span> : null}
                  </span>
                  {commit.refs.length === 0 && review === undefined ? null : (
                    <span className="commit-badges">
                      {commit.refs.slice(0, 3).map((ref) => (
                        <Badge key={`${ref.kind}:${ref.name}`} outline tone={ref.kind === 'head' ? 'accent' : 'neutral'}>
                          {ref.kind === 'head' ? 'HEAD' : ref.kind === 'tag' ? `tag ${ref.name}` : ref.name}
                        </Badge>
                      ))}
                      {review === undefined ? null : (
                        <Badge tone={reviewStateTone(review.state)} icon={review.state === 'completed' ? 'check' : review.state === 'running' ? 'sparkle' : 'alert'}>
                          {reviewLabel(review.state)}
                          {review.openCount === undefined ? '' : ` · ${String(review.openCount)}`}
                        </Badge>
                      )}
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </section>
      ))}

      {filtered ? null : (
        <div className="commit-graph-tail" aria-hidden="true">
          <CommitGraphPass lanes={trailingLanes(layout.rows)} laneCount={layout.laneCount} height={18} />
        </div>
      )}

      <div className="mid-more">
        {loadMoreError !== null && loadMoreError !== undefined ? (
          <FailureNotice error={loadMoreError} onRetry={onLoadMore} compact />
        ) : shallowBoundaryReached ? (
          <p className="mid-note">已到达浅克隆边界；不提供「加载更早」，也不会伪造边界之前的历史。</p>
        ) : nextCursor === undefined ? (
          <p className="mid-note">已到最早的提交。</p>
        ) : (
          <Button variant="secondary" size="sm" icon="download" disabled={loadingMore} onClick={onLoadMore}>
            {loadingMore ? '加载中…' : '加载更早的提交'}
          </Button>
        )}
        {filtered ? null : <p className="mid-note">泳道按已加载提交的真实父提交关系计算；不伪造分支历史。</p>}
      </div>
    </>
  );
}

function trailingLanes(rows: readonly CommitGraphRow[]): readonly GraphLane[] {
  const last = rows[rows.length - 1];
  return last === undefined ? [] : last.bottom.filter((lane): lane is GraphLane => lane !== null);
}
