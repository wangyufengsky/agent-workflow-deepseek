import { useMemo } from 'react';
import type { GitCommitSummary } from '@agent-workflow/shared';
import { Badge } from '../../components/Badge.tsx';
import { Button } from '../../components/Button.tsx';
import { EmptyState, Skeleton } from '../../components/EmptyState.tsx';
import { Icon } from '../../components/Icon.tsx';
import { FailureNotice, dateGroupLabel, dateKey, formatTime, reviewLabel, reviewStateTone, shortSha } from './git-shared.tsx';

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

/** 中栏提交列表：按作者日期分组，带简化时间线与审查徽标；不做伪造的泳道图谱。 */
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
  const groups = useMemo(() => {
    const buckets = new Map<string, GitCommitSummary[]>();
    for (const commit of commits) {
      const key = dateKey(commit.authoredAt);
      const bucket = buckets.get(key);
      if (bucket === undefined) buckets.set(key, [commit]);
      else bucket.push(commit);
    }
    return [...buckets.entries()];
  }, [commits]);

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
      {groups.map(([key, rows]) => (
        <section key={key} aria-label={dateGroupLabel(key)}>
          <div className="commit-group-head">
            <Icon name="calendar" size="sm" />
            {dateGroupLabel(key)}
            <span className="grow" />
            <span>{String(rows.length)} 个提交</span>
          </div>
          {rows.map((commit) => {
            const selected = commit.sha === selectedSha;
            const review = commit.review;
            return (
              <button
                key={commit.sha}
                type="button"
                className="commit-row"
                aria-selected={selected}
                onClick={() => { onSelect(commit.sha); }}
              >
                <span className="commit-graph" aria-hidden="true">
                  {rows[rows.length - 1]?.sha === commit.sha ? null : <span className="line" />}
                  <span className={['dot', commit.parents.length > 1 ? 'merge' : ''].filter(Boolean).join(' ')} />
                </span>
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
      </div>
    </>
  );
}
