import { useMemo } from 'react';
import type { GitBranch } from '@agent-workflow/shared';
import { Badge } from '../../components/Badge.tsx';
import { EmptyState, Skeleton } from '../../components/EmptyState.tsx';
import { Icon } from '../../components/Icon.tsx';
import { FailureNotice, aheadBehind, formatTime, shortRef, shortSha } from './git-shared.tsx';

export interface BranchesPanelProps {
  readonly branches: readonly GitBranch[];
  readonly loading: boolean;
  readonly error: unknown;
  readonly onRetry: () => void;
  readonly onSelect: (branch: GitBranch) => void;
  readonly activeRef: string | null;
  readonly gitlabConfigured: boolean;
}

/** 分支列表（只读）：点分支 = 在提交列表按该引用筛选，不切换、不改本地分支。 */
export function BranchesPanel({ branches, loading, error, onRetry, onSelect, activeRef, gitlabConfigured }: BranchesPanelProps) {
  const groups = useMemo(() => {
    const local = branches.filter((branch) => branch.kind === 'local');
    const remote = branches.filter((branch) => branch.kind === 'remote');
    return [
      { key: 'local', label: '本地分支', rows: local },
      { key: 'remote', label: '远端分支', rows: remote },
    ];
  }, [branches]);

  if (loading) {
    return (
      <div style={{ padding: 12 }}>
        {[0, 1, 2, 3].map((index) => (
          <div key={index} className="stack-tight" style={{ padding: '7px 2px' }}>
            <Skeleton width="52%" height={11} />
            <Skeleton width="32%" height={9} />
          </div>
        ))}
      </div>
    );
  }

  if (error !== null && error !== undefined) {
    return (
      <div style={{ padding: 12 }}>
        <FailureNotice error={error} onRetry={onRetry} compact />
      </div>
    );
  }

  return (
    <>
      {groups.map((group) => (
        <section key={group.key} aria-label={group.label}>
          <div className="branch-group-head">
            {group.label} · {String(group.rows.length)}
          </div>
          {group.rows.length === 0 ? <p className="mid-note">没有{group.label}。</p> : null}
          {group.rows.map((branch) => {
            const selected = activeRef === branch.fullRef;
            return (
              <button
                key={branch.fullRef}
                type="button"
                className={['branch-row', branch.isCurrent ? 'current' : ''].filter(Boolean).join(' ')}
                aria-selected={selected}
                onClick={() => { onSelect(branch); }}
                title="在提交列表中筛选这个引用"
              >
                <span className="tile" style={{ width: 26, height: 26, borderRadius: 7, flex: 'none' }}>
                  <Icon name="branch" size="sm" />
                </span>
                <span className="branch-main grow">
                  <span className="branch-name">
                    {branch.name}
                    {branch.isCurrent ? ' · 当前' : ''}
                  </span>
                  <span className="branch-meta">
                    <span className="branch-tip">{shortSha(branch.tipSha)}</span>
                    {branch.upstream === undefined ? null : <span>↑ {shortRef(branch.upstream)}</span>}
                    <span>{branch.vsDefault === undefined ? '相对默认分支未知' : aheadBehind(branch.vsDefault.ahead, branch.vsDefault.behind)}</span>
                  </span>
                  <span className="branch-meta">
                    {branch.lastCommit === undefined ? null : (
                      <>
                        <span className="ellipsis">{branch.lastCommit.subject}</span>
                        <span>·</span>
                        <span>{formatTime(branch.lastCommit.authoredAt)}</span>
                      </>
                    )}
                  </span>
                  <span className="branch-meta">
                    {branch.checkedOutInUserWorktree ? (
                      <Badge tone="wait" icon="eye">已在用户工作区检出</Badge>
                    ) : null}
                    {branch.protected === null ? (
                      <Badge tone="unknown" icon="help">保护状态未知</Badge>
                    ) : branch.protected ? (
                      <Badge tone="fail" icon="lock">保护分支</Badge>
                    ) : (
                      <Badge tone="neutral" icon="git">非保护分支</Badge>
                    )}
                    {!gitlabConfigured ? <span className="muted-note">GitLab 未配置 · 保护状态未知</span> : null}
                  </span>
                </span>
              </button>
            );
          })}
        </section>
      ))}
      {branches.length === 0 ? (
        <div className="git-mid-empty">
          <EmptyState compact icon="branch" title="没有读取到分支" description="服务返回的分支列表为空；不会伪造分支名。" />
        </div>
      ) : null}
    </>
  );
}
