import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import type { GitRepo } from '@agent-workflow/shared';
import { classifyGitFailure, fetchGitOverview, gitKeys } from '../../api/git.ts';
import { formatRelativeTime } from '../../app/format.ts';
import { Badge } from '../../components/Badge.tsx';
import { Button, LinkButton } from '../../components/Button.tsx';
import { PageHeader } from '../../components/Card.tsx';
import { EmptyState, Skeleton } from '../../components/EmptyState.tsx';
import { Icon } from '../../components/Icon.tsx';
import { GIT_CONNECTION_LABEL, REPO_GIT_STATE_LABEL, UnavailablePanel, aheadBehind, connectionTone, repoStateTone, shortSha } from './git-shared.tsx';

const PROVIDER_LABEL = { github: 'GitHub', gitlab: 'GitLab' } as const;

function shouldRetry(failureCount: number, error: unknown): boolean {
  const kind = classifyGitFailure(error);
  return kind === 'failed' && failureCount < 2;
}

function RepoSkeleton() {
  return (
    <div className="git-repo-grid">
      {[0, 1].map((index) => (
        <div key={index} className="git-repo-card">
          <Skeleton width="42%" height={15} />
          <Skeleton width="68%" height={11} />
          <div className="git-repo-grid-stats">
            <Skeleton height={26} />
            <Skeleton height={26} />
            <Skeleton height={26} />
            <Skeleton height={26} />
          </div>
        </div>
      ))}
    </div>
  );
}

function RepoCard({ repo }: { readonly repo: GitRepo }) {
  const usable = repo.gitState === 'git';
  const status = repo.status;
  const branchLabel =
    status === undefined
      ? '—'
      : status.head.kind === 'branch'
        ? (status.head.branch ?? '—')
        : status.head.kind === 'detached'
          ? `分离 HEAD · ${shortSha(status.head.sha ?? '')}`
          : `${status.head.branch ?? '未命名分支'}（还没有提交）`;

  const cardBody = (
    <>
      <div className="git-repo-head">
        <span className="tile">
          <Icon name={usable ? 'gitRepo' : repo.gitState === 'path_unavailable' ? 'folder' : 'lock'} />
        </span>
        <div className="git-repo-main grow" style={{ minWidth: 0 }}>
          <div className="git-repo-title">
            <span>{repo.projectName}</span>
            <Badge tone={repoStateTone(repo.gitState)} icon={usable ? 'gitRepo' : repo.gitState === 'path_unavailable' ? 'alert' : 'lock'}>
              {REPO_GIT_STATE_LABEL[repo.gitState]}
            </Badge>
          </div>
          {repo.displayRoot === undefined ? null : <div className="git-repo-root">{repo.displayRoot}</div>}
        </div>
      </div>

      {usable ? (
        <>
          <div className="git-repo-grid-stats">
            <div className="git-stat">
              <span className="l">当前分支</span>
              <span className="v mono">{branchLabel}</span>
            </div>
            <div className="git-stat">
              <span className="l">与远端</span>
              <span className="v">{status?.upstream === undefined ? '—（未设置 upstream 或未读取）' : aheadBehind(status.upstream.ahead, status.upstream.behind)}</span>
            </div>
            <div className="git-stat">
              <span className="l">未提交改动</span>
              <span className="v">
                {status === undefined
                  ? '—'
                  : `${String(status.workingTree.uncommitted)} 未提交 · ${String(status.workingTree.staged)} 已暂存 · ${String(status.workingTree.untracked)} 未跟踪`}
              </span>
            </div>
            <div className="git-stat">
              <span className="l">打开的合并请求</span>
              <span className="v">
                {repo.summary === undefined || repo.summary.openMrCount === null
                  ? '—（GitLab 未配置或未读取）'
                  : String(repo.summary.openMrCount)}
              </span>
            </div>
            <div className="git-stat">
              <span className="l">最近提交</span>
              <span className="v">
                {repo.summary?.lastCommit === undefined ? '—' : repo.summary.lastCommit.subject}
              </span>
            </div>
            <div className="git-stat">
              <span className="l">AI 审查待处理</span>
              <span className="v">
                {repo.summary === undefined ? '—' : String(repo.summary.pendingFindingCount)}
              </span>
            </div>
          </div>

          {status?.isEmpty === true ? (
            <div className="git-repo-reason">空仓库：当前分支还没有任何提交，工作区文件不会被当成历史提交。完成首次提交后再进入工作台。</div>
          ) : null}
          {status?.shallow === undefined ? null : (
            <div className="git-repo-reason">
              浅克隆仓库（{status.shallow.depth === undefined ? '深度未知' : `深度 ${String(status.shallow.depth)}`}）：更早的提交可能读不到，界面不会伪造历史。
            </div>
          )}
          {status?.lastFetchAt === undefined ? null : (
            <div className="muted-note">上次获取远端：{formatRelativeTime(status.lastFetchAt)}</div>
          )}
          {status?.userOperationInProgress === undefined ? null : (
            <div className="git-repo-reason">本机仓库正在进行 {status.userOperationInProgress} 操作；只读浏览可用，写操作由服务判定是否允许。</div>
          )}
        </>
      ) : (
        <div className="git-repo-reason">
          {repo.gitStateDetail ?? '服务没有说明不可用原因。'}
          {repo.gitState === 'not_git'
            ? ' 这个项目不在 Git 管理下；Git 工作台不会为它创建分支或提交。'
            : repo.gitState === 'path_unavailable'
              ? ' 本机路径不可用，无法读取任何 Git 事实；请到项目页更新路径后重新读取。'
              : ' Git 能力由服务端内部 MCP 提供；接入前本页只说明状态，不显示占位提交。'}
        </div>
      )}

      <div className="git-repo-foot">
        {repo.remote === undefined ? null : (
          <span className="chip" title={repo.remote.displayUrl}>
            <Icon name="link" size="sm" />
            {repo.remote.name}
          </span>
        )}
        {repo.defaultBranch === undefined ? null : (
          <span className="chip">
            <Icon name="branch" size="sm" />
            {repo.defaultBranch}
          </span>
        )}
        <span className="push-right" />
        {usable ? (
          <span className="btn ghost sm">
            打开工作台
            <Icon name="arrowRight" size="sm" />
          </span>
        ) : (
          <span className="btn ghost sm">
            查看项目
            <Icon name="arrowRight" size="sm" />
          </span>
        )}
      </div>
    </>
  );

  if (!usable) {
    return <div className="git-repo-card unavailable">{cardBody}</div>;
  }
  return (
    <Link className="git-repo-card" to={`/git/${encodeURIComponent(repo.projectId)}`} aria-label={`打开 ${repo.projectName} 的 Git 工作台`}>
      {cardBody}
    </Link>
  );
}

/**
 * `/git` 仓库概览：GitLab 连接状态 + 全部已登记项目。
 * 所有数字都来自 `GET /api/git/repos`；接口没接通时整块说明，不显示示例数据。
 */
export function GitOverview() {
  const overviewQuery = useQuery({
    queryKey: gitKeys.overview,
    queryFn: fetchGitOverview,
    retry: shouldRetry,
    staleTime: 15_000,
  });

  if (overviewQuery.isPending) {
    return (
      <div className="git-page">
        <div className="git-page-scroll">
          <div className="git-overview">
            <PageHeader title="Git 仓库" lede="只读浏览全部已登记项目的 Git 事实；远端相关能力需要服务端 GitLab 连接。" />
            <RepoSkeleton />
          </div>
        </div>
      </div>
    );
  }

  if (overviewQuery.isError) {
    return (
      <div className="git-page">
        <div className="git-page-scroll">
          <div className="git-overview">
            <PageHeader title="Git 仓库" lede="只读浏览全部已登记项目的 Git 事实；远端相关能力需要服务端 GitLab 连接。" />
            <UnavailablePanel error={overviewQuery.error} onRetry={() => { void overviewQuery.refetch(); }} />
          </div>
        </div>
      </div>
    );
  }

  const { connection, repos, capability } = overviewQuery.data;

  return (
    <div className="git-page">
      <div className="git-page-scroll">
        <div className="git-overview">
          <PageHeader
            title="Git 仓库"
            eyebrow="只读浏览"
            lede="提交、文件、diff、分支与合并请求都是只读投影；审查只读，修复只写隔离副本，提交 / 推送 / 合并请求只能由你逐步确认。"
            actions={
              <Button variant="secondary" size="sm" icon="refresh" onClick={() => { void overviewQuery.refetch(); }}>
                刷新列表
              </Button>
            }
          />

          <div className="git-connection">
            <span className="tile">
              <Icon name="gitRepo" />
            </span>
            <div className="git-connection-main grow">
              <div className="git-connection-title">
                <span>{PROVIDER_LABEL[connection.provider]} 连接</span>
                <Badge tone={connectionTone(connection.state)} icon={connection.state === 'connected' ? 'check' : connection.state === 'not_configured' ? 'lock' : 'alert'}>
                  {GIT_CONNECTION_LABEL[connection.state]}
                </Badge>
                {connection.hostDisplayName === undefined ? null : <span className="muted-note">{connection.hostDisplayName}</span>}
                {connection.accountUsername === undefined ? null : <span className="mono-sm">@{connection.accountUsername}</span>}
              </div>
              <div className="git-connection-note">
                {connection.message ??
                  (connection.state === 'connected'
                    ? `凭据只在服务端；界面不读取令牌。${connection.lastVerifiedAt === undefined ? '' : ` 上次验证：${formatRelativeTime(connection.lastVerifiedAt)}。`}`
                    : connection.state === 'not_configured'
                      ? '本地提交仍可浏览；远端分支、合并请求、推送与创建 MR 不可用。到「设置 → GitLab」配置连接。'
                      : '远端相关功能由服务判定不可用；本地只读浏览不受影响。')}
              </div>
            </div>
            <div className="git-connection-actions">
              {connection.state === 'connected' ? null : (
                <LinkButton variant="primary" size="sm" icon="settings" to="/settings">
                  去设置
                </LinkButton>
              )}
            </div>
          </div>

          {capability.allowed ? null : (
            <div className="banner unknown" role="status">
              <Icon name="lock" />
              <div className="grow">
                <b>Git 能力尚未接入</b>
                <br />
                {capability.reason ?? '服务端还没有提供 Git 能力；这不按错误处理，也不显示假数据。'}
                <span className="failure-detail">接入方式：应用服务 → 内部 MCP（git / gitlab）。</span>
              </div>
            </div>
          )}

          <div className="git-section-head">
            <h3>已登记项目</h3>
            <Badge tone="neutral">{String(repos.length)}</Badge>
            <span className="grow" />
            <span className="muted-note">受 Git 管理的项目可以进入工作台；其余项目写明不可用原因。</span>
          </div>

          {repos.length === 0 ? (
            <EmptyState
              icon="gitRepo"
              title="还没有登记项目"
              description="Git 仓库页只读取已登记项目。先在项目页登记本机项目后，这里才会出现 Git 事实。"
              action={<LinkButton variant="secondary" icon="folder" to="/projects">打开项目页</LinkButton>}
            />
          ) : (
            <div className="git-repo-grid">
              {repos.map((repo) => (
                <RepoCard key={repo.projectId} repo={repo} />
              ))}
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
