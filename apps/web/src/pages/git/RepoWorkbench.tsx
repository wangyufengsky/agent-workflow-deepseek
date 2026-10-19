import { useCallback, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import type { GitBranch, GitCommitSummary, GitMergeRequest } from '@agent-workflow/shared';
import {
  classifyGitFailure,
  fetchGitBranches,
  fetchGitCommits,
  fetchGitMergeRequests,
  fetchGitOverview,
  fetchGitRepo,
  fetchOperationByKey,
  fetchRemote,
  gitKeys,
  toReceiptView,
  type ReceiptView,
} from '../../api/git.ts';
import { formatRelativeTime } from '../../app/format.ts';
import { Badge } from '../../components/Badge.tsx';
import { Button } from '../../components/Button.tsx';
import { EmptyState, Skeleton } from '../../components/EmptyState.tsx';
import { Icon } from '../../components/Icon.tsx';
import { BranchesPanel } from './BranchesPanel.tsx';
import { CommitDetail } from './CommitDetail.tsx';
import { CommitList } from './CommitList.tsx';
import {
  FailureNotice,
  OperationLookupResult,
  REPO_GIT_STATE_LABEL,
  ReceiptBanner,
  UnavailablePanel,
  aheadBehind,
  formatTime,
  repoStateTone,
  shortRef,
  shortSha,
} from './git-shared.tsx';
import { MergeRequestDetail, MergeRequestsPanel } from './MergeRequestsPanel.tsx';

type RailTab = 'commits' | 'branches' | 'mergeRequests';

function shouldRetry(failureCount: number, error: unknown): boolean {
  return classifyGitFailure(error) === 'failed' && failureCount < 2;
}

function BranchDetail({
  branch,
  onFilter,
}: {
  readonly branch: GitBranch;
  readonly onFilter: () => void;
}) {
  return (
    <div className="stack-loose">
      <div className="mr-detail-head">
        <div className="row-wrap">
          <span className="tile">
            <Icon name="branch" />
          </span>
          <h2 className="mr-detail-title mono">{branch.name}</h2>
          {branch.isCurrent ? <Badge tone="accent" icon="check">当前分支</Badge> : null}
          <span className="grow" />
          <Button variant="secondary" size="sm" icon="filter" onClick={onFilter}>
            在提交列表筛选
          </Button>
        </div>
        <div className="mr-branches">{branch.fullRef}</div>
      </div>

      <div className="mr-facts">
        <div className="git-stat">
          <span className="l">类型</span>
          <span className="v">{branch.kind === 'local' ? '本地分支' : '远端分支'}</span>
        </div>
        <div className="git-stat">
          <span className="l">tip</span>
          <span className="v mono">{branch.tipSha}</span>
        </div>
        <div className="git-stat">
          <span className="l">upstream</span>
          <span className="v mono">{branch.upstream === undefined ? '—' : shortRef(branch.upstream)}</span>
        </div>
        <div className="git-stat">
          <span className="l">相对默认分支</span>
          <span className="v">{branch.vsDefault === undefined ? '未知' : aheadBehind(branch.vsDefault.ahead, branch.vsDefault.behind)}</span>
        </div>
        <div className="git-stat">
          <span className="l">保护分支</span>
          <span className="v">{branch.protected === null ? '未知（GitLab 未配置）' : branch.protected ? '是' : '否'}</span>
        </div>
        <div className="git-stat">
          <span className="l">在用户工作区检出</span>
          <span className="v">{branch.checkedOutInUserWorktree ? '是' : '否'}</span>
        </div>
      </div>

      {branch.lastCommit === undefined ? null : (
        <div className="stack-tight">
          <span className="rail-cap">最后提交</span>
          <span className="muted-note">{branch.lastCommit.subject}</span>
          <span className="muted-note">{branch.lastCommit.author.name} · {formatTime(branch.lastCommit.authoredAt)}</span>
        </div>
      )}
      <p className="muted-note">只读：点击分支不会切换本地检出。筛选只是读取该引用的提交列表。</p>
    </div>
  );
}

/**
 * 仓库工作台 `/git/:projectId`：左栏页签与筛选、中栏提交 / 分支 / 合并请求、
 * 右栏提交详情（改动文件 / AI 审查 / 修复）。
 */
export function RepoWorkbench({ projectId }: { readonly projectId: string }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<RailTab>('commits');
  const [ref, setRef] = useState<string | null>(null);
  const [keyword, setKeyword] = useState('');
  const [selectedSha, setSelectedSha] = useState<string | null>(null);
  const [selectedBranchName, setSelectedBranchName] = useState<string | null>(null);
  const [selectedMrIid, setSelectedMrIid] = useState<number | null>(null);
  const [diffFullscreen, setDiffFullscreen] = useState(false);
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
  const [receipt, setReceipt] = useState<ReceiptView | null>(null);
  const [lookupKey, setLookupKey] = useState<string | null>(null);
  const [moreState, setMoreState] = useState<{
    readonly commits: readonly GitCommitSummary[];
    readonly nextCursor?: string;
    readonly shallow: boolean;
  } | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<unknown>(null);

  const overviewQuery = useQuery({
    queryKey: gitKeys.overview,
    queryFn: fetchGitOverview,
    retry: shouldRetry,
    staleTime: 30_000,
  });

  const repoQuery = useQuery({
    queryKey: gitKeys.repo(projectId),
    queryFn: () => fetchGitRepo(projectId),
    retry: shouldRetry,
  });
  const repo = repoQuery.data?.repo;
  const gitUsable = repo?.gitState === 'git';

  const commitsQuery = useQuery({
    queryKey: gitKeys.commits(projectId, ref),
    queryFn: () => fetchGitCommits(projectId, { ref: ref ?? undefined, limit: 50 }),
    enabled: gitUsable,
    retry: shouldRetry,
  });

  const branchesQuery = useQuery({
    queryKey: gitKeys.branches(projectId),
    queryFn: () => fetchGitBranches(projectId),
    enabled: gitUsable,
    retry: shouldRetry,
  });

  const mergeRequestsQuery = useQuery({
    queryKey: gitKeys.mergeRequests(projectId),
    queryFn: () => fetchGitMergeRequests(projectId),
    enabled: gitUsable,
    retry: shouldRetry,
  });

  const lookupQuery = useQuery({
    queryKey: gitKeys.operation(lookupKey ?? ''),
    queryFn: () => fetchOperationByKey(lookupKey ?? ''),
    enabled: lookupKey !== null,
    retry: false,
  });

  const fetchMutation = useMutation({
    mutationFn: () => fetchRemote(projectId),
    retry: false,
    onSuccess: (data) => {
      setReceipt(toReceiptView(data.receipt));
      void queryClient.invalidateQueries({ queryKey: gitKeys.repo(projectId) });
      void queryClient.invalidateQueries({ queryKey: gitKeys.overview });
      void queryClient.invalidateQueries({ queryKey: gitKeys.commits(projectId, ref) });
      void queryClient.invalidateQueries({ queryKey: gitKeys.branches(projectId) });
    },
  });

  useEffect(() => {
    setMoreState(null);
    setLoadMoreError(null);
    setSelectedSha(null);
    setLoadingMore(false);
  }, [ref, projectId]);

  const commits = useMemo(() => {
    const first = commitsQuery.data?.commits ?? [];
    const extra = moreState?.commits ?? [];
    const seen = new Set<string>();
    const merged: GitCommitSummary[] = [];
    for (const commit of [...first, ...extra]) {
      if (seen.has(commit.sha)) continue;
      seen.add(commit.sha);
      merged.push(commit);
    }
    return merged;
  }, [commitsQuery.data, moreState]);

  const filteredCommits = useMemo(() => {
    const text = keyword.trim().toLowerCase();
    if (text.length === 0) return commits;
    return commits.filter((commit) =>
      [commit.subject, commit.author.name, commit.sha].join(' ').toLowerCase().includes(text),
    );
  }, [commits, keyword]);

  useEffect(() => {
    if (tab !== 'commits') return;
    if (selectedSha !== null && filteredCommits.some((commit) => commit.sha === selectedSha)) return;
    const first = filteredCommits[0];
    if (first !== undefined) setSelectedSha(first.sha);
  }, [filteredCommits, selectedSha, tab]);

  useEffect(() => {
    const branches = branchesQuery.data ?? [];
    if (selectedBranchName !== null && branches.some((branch) => branch.fullRef === selectedBranchName)) return;
    if (branches.length > 0) setSelectedBranchName(branches[0]?.fullRef ?? null);
  }, [branchesQuery.data, selectedBranchName]);

  useEffect(() => {
    const mergeRequests = mergeRequestsQuery.data?.mergeRequests ?? [];
    if (selectedMrIid !== null && mergeRequests.some((mr) => mr.iid === selectedMrIid)) return;
    if (mergeRequests.length > 0) setSelectedMrIid(mergeRequests[0]?.iid ?? null);
  }, [mergeRequestsQuery.data, selectedMrIid]);

  const loadMore = useCallback(async () => {
    const cursor = moreState === null ? commitsQuery.data?.nextCursor : moreState.nextCursor;
    if (cursor === undefined) return;
    setLoadingMore(true);
    setLoadMoreError(null);
    try {
      const page = await fetchGitCommits(projectId, { ref: ref ?? undefined, limit: 50, cursor });
      setMoreState((current) => ({
        commits: [...(current?.commits ?? []), ...page.commits],
        nextCursor: page.nextCursor,
        shallow: page.shallowBoundaryReached ?? false,
      }));
    } catch (error) {
      setLoadMoreError(error);
    } finally {
      setLoadingMore(false);
    }
  }, [commitsQuery.data?.nextCursor, moreState, projectId, ref]);

  const onDiffFullscreenChange = useCallback((fullscreen: boolean) => {
    setDiffFullscreen(fullscreen);
  }, []);

  const refreshAll = () => {
    void repoQuery.refetch();
    void commitsQuery.refetch();
    void branchesQuery.refetch();
    void mergeRequestsQuery.refetch();
    void overviewQuery.refetch();
  };

  const gitlabConfigured = repo?.gitlab === 'connected';

  if (repoQuery.isPending) {
    return (
      <div className="git-page">
        <div className="git-wb-head">
          <Skeleton width={180} height={16} />
          <span className="spacer" />
          <Skeleton width={120} height={28} radius={99} />
        </div>
        <div style={{ padding: 20 }}>
          <Skeleton height={16} />
          <div style={{ height: 10 }} />
          <Skeleton width="64%" height={12} />
        </div>
      </div>
    );
  }

  if (repoQuery.isError) {
    return (
      <div className="git-page">
        <div className="git-page-scroll">
          <div className="git-overview">
            <Link to="/git" className="btn ghost sm" style={{ marginBottom: 12 }}>
              <Icon name="arrowLeft" size="sm" />
              所有仓库
            </Link>
            <UnavailablePanel error={repoQuery.error} onRetry={() => { void repoQuery.refetch(); }} />
          </div>
        </div>
      </div>
    );
  }

  if (repo === undefined) {
    return (
      <div className="git-page">
        <div className="git-page-scroll">
          <div className="git-overview">
            <UnavailablePanel error={new Error('服务没有返回该项目的 Git 仓库信息')} />
          </div>
        </div>
      </div>
    );
  }

  const status = repo.status;
  const headLabel =
    status === undefined
      ? '分支未知'
      : status.head.kind === 'branch'
        ? (status.head.branch ?? '分支未知')
        : status.head.kind === 'detached'
          ? `分离 HEAD · ${shortSha(status.head.sha ?? '')}`
          : `${status.head.branch ?? '未命名分支'} · 空仓库`;
  const branches = branchesQuery.data ?? [];
  const selectedBranch = branches.find((branch) => branch.fullRef === selectedBranchName) ?? null;
  const mergeRequests = mergeRequestsQuery.data?.mergeRequests ?? [];
  const selectedMr: GitMergeRequest | null = mergeRequests.find((mr) => mr.iid === selectedMrIid) ?? null;
  const repositoryOptions = overviewQuery.data?.repos ?? [repo];

  if (!gitUsable) {
    return (
      <div className="git-page">
        <div className="git-page-scroll">
          <div className="git-overview">
            <Link to="/git" className="btn ghost sm" style={{ marginBottom: 12 }}>
              <Icon name="arrowLeft" size="sm" />
              所有仓库
            </Link>
            <div className="row-wrap" style={{ marginBottom: 18 }}>
              <h2 className="title" style={{ fontSize: 22 }}>{repo.projectName}</h2>
              <Badge tone={repoStateTone(repo.gitState)} icon="alert">{REPO_GIT_STATE_LABEL[repo.gitState]}</Badge>
            </div>
            <UnavailablePanel
              error={new Error(repo.gitStateDetail ?? '服务没有说明不可用原因')}
              title={repo.gitState === 'not_git' ? '这个项目不受 Git 管理' : repo.gitState === 'path_unavailable' ? '本机路径不可用' : 'Git 能力尚未接入'}
              description={
                repo.gitState === 'not_git'
                  ? '项目登记根不是 Git 仓库，工作台不会为它创建分支、提交或 worktree。请到项目页确认路径，或改用非 Git 交付。'
                  : repo.gitState === 'path_unavailable'
                    ? '服务读不到本机路径，因此不能读取任何 Git 事实。请到项目页更新路径后重新读取；页面不会伪造提交与分支。'
                    : 'Git 能力由服务端内部 MCP 提供；接入前本页只说明状态。'
              }
              onRetry={() => { void repoQuery.refetch(); }}
            />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="git-page">
      <div className="git-wb-head">
        <Link to="/git" className="btn ghost sm" title="返回仓库概览">
          <Icon name="arrowLeft" size="sm" />
          所有仓库
        </Link>
        <div className="git-wb-title">
          <h2>{repo.projectName}</h2>
          <Badge tone={repoStateTone(repo.gitState)} icon="gitRepo">{REPO_GIT_STATE_LABEL[repo.gitState]}</Badge>
        </div>
        <select
          className="git-select"
          aria-label="切换项目"
          value={projectId}
          onChange={(event) => {
            navigate(`/git/${encodeURIComponent(event.target.value)}`);
          }}
        >
          {repositoryOptions.map((option) => (
            <option key={option.projectId} value={option.projectId}>
              {option.projectName}
            </option>
          ))}
        </select>
        <span className="git-wb-branch" title={headLabel}>
          <Icon name={status?.head.kind === 'detached' ? 'git' : 'branch'} size="sm" />
          {headLabel}
        </span>
        <span className="git-wb-meta">
          <span>{status?.upstream === undefined ? '与远端差异未知' : aheadBehind(status.upstream.ahead, status.upstream.behind)}</span>
          <span>·</span>
          <span>上次获取 {status?.lastFetchAt === undefined ? '未知' : formatRelativeTime(status.lastFetchAt)}</span>
          {status?.shallow === undefined ? null : <Badge tone="wait" icon="archive">浅克隆</Badge>}
          {status?.userOperationInProgress === undefined ? null : <Badge tone="fail" icon="alert">进行中：{status.userOperationInProgress}</Badge>}
        </span>
        <div className="git-wb-actions">
          <Button
            variant="secondary"
            size="sm"
            icon="refresh"
            disabled={fetchMutation.isPending || repo.remote === undefined}
            disabledReason={repo.remote === undefined ? '服务没有返回远端（origin），无法获取远端更新。' : undefined}
            onClick={() => { fetchMutation.mutate(); }}
          >
            {fetchMutation.isPending ? '获取中…' : '获取远端更新'}
          </Button>
          {repo.remote?.webUrl === undefined ? (
            <Button variant="ghost" size="sm" icon="external" disabled disabledReason={gitlabConfigured ? '服务没有返回仓库的网页地址。' : 'GitLab 未配置，没有可打开的网页地址。'}>
              在浏览器打开
            </Button>
          ) : (
            <a className="btn ghost sm" href={repo.remote.webUrl} target="_blank" rel="noreferrer noopener">
              <Icon name="external" size="sm" />
              在浏览器打开
            </a>
          )}
          <Button variant="ghost" size="sm" icon="refresh" onClick={refreshAll}>
            刷新
          </Button>
        </div>
      </div>

      <div style={{ padding: '10px 20px 0' }}>
        {receipt === null ? null : (
          <ReceiptBanner
            receipt={receipt}
            verifying={lookupQuery.isFetching}
            onVerify={(key) => { setLookupKey(key); }}
            onDismiss={() => { setReceipt(null); }}
          />
        )}
        {lookupKey === null ? null : lookupQuery.isPending ? (
          <div className="banner info"><Icon name="clock" /><div className="grow">正在核对原操作…</div></div>
        ) : lookupQuery.isError ? (
          <FailureNotice error={lookupQuery.error} compact />
        ) : lookupQuery.data === undefined ? null : (
          <OperationLookupResult operation={lookupQuery.data.operation} stillUnknown={lookupQuery.data.stillUnknown} />
        )}
        {fetchMutation.isError ? <FailureNotice error={fetchMutation.error} compact /> : null}
        {status?.head.kind === 'detached' ? (
          <div className="banner warn" style={{ marginBottom: 8 }}>
            <Icon name="alert" />
            <div className="grow">当前 HEAD 处于分离状态（{shortSha(status.head.sha ?? '')}），不在任何分支上；只读浏览可用，写操作由服务判定。</div>
          </div>
        ) : null}
        {status?.isEmpty === true ? (
          <div className="banner info" style={{ marginBottom: 8 }}>
            <Icon name="info" />
            <div className="grow">空仓库：当前分支还没有提交；不会显示占位图谱或伪造详情。工作区里的未提交文件可以只读查看（{String(status.workingTree.uncommitted)} 个未提交）。</div>
          </div>
        ) : null}
      </div>

      <div
        className={['git-wb-body', diffFullscreen ? 'diff-full' : '', mobileDetailOpen ? 'detail-open' : ''].filter(Boolean).join(' ')}
      >
        <aside className="git-rail" aria-label="仓库导航与筛选">
          <div className="rail-tabs" role="tablist" aria-label="左栏页签">
            <button type="button" role="tab" className="rail-tab" aria-selected={tab === 'commits'} onClick={() => { setTab('commits'); }}>
              <Icon name="list" size="sm" />
              提交
              <span className="count">{String(commits.length)}</span>
            </button>
            <button type="button" role="tab" className="rail-tab" aria-selected={tab === 'branches'} onClick={() => { setTab('branches'); }}>
              <Icon name="branch" size="sm" />
              分支
              <span className="count">{String(branches.length)}</span>
            </button>
            <button type="button" role="tab" className="rail-tab" aria-selected={tab === 'mergeRequests'} onClick={() => { setTab('mergeRequests'); }}>
              <Icon name="gitRepo" size="sm" />
              合并请求
              <span className="count">{gitlabConfigured ? String(mergeRequests.length) : '—'}</span>
            </button>
          </div>

          {tab === 'commits' ? (
            <>
              <div className="rail-group">
                <span className="rail-cap">引用</span>
                <select
                  className="rail-select"
                  aria-label="按分支筛选提交"
                  value={ref ?? ''}
                  onChange={(event) => {
                    const value = event.target.value;
                    setRef(value.length === 0 ? null : value);
                  }}
                >
                  <option value="">当前分支（{headLabel}）</option>
                  {branches.map((branch) => (
                    <option key={`${branch.kind}:${branch.fullRef}`} value={branch.fullRef}>
                      {branch.kind === 'local' ? '' : '远端 · '}{branch.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="rail-group">
                <span className="rail-cap">筛选已加载提交</span>
                <input
                  className="rail-input"
                  type="search"
                  placeholder="信息 / 作者 / SHA"
                  value={keyword}
                  onChange={(event) => { setKeyword(event.target.value); }}
                />
                {keyword.length === 0 ? null : (
                  <span className="rail-note">显示 {String(filteredCommits.length)} / {String(commits.length)} 个已加载提交。</span>
                )}
              </div>
              <div className="rail-foot">
                <span className="rail-note">
                  {commits.length === 0 ? '还没有提交。' : `已加载 ${String(commits.length)} 个提交。`}
                </span>
                <span className="rail-note">只读浏览：筛选与复制 SHA 都不会改动仓库。</span>
              </div>
            </>
          ) : tab === 'branches' ? (
            <div className="rail-foot">
              <span className="rail-note">本地 / 远端分支来自服务读取；保护状态需要 GitLab 连接，未连接时显示未知。</span>
              <span className="rail-note">{gitlabConfigured ? 'GitLab 已连接。' : 'GitLab 未配置：远端相关能力不可用。'}</span>
            </div>
          ) : (
            <div className="rail-foot">
              <span className="rail-note">合并请求来自 GitLab 只读投影；产品内不提供合并按钮。</span>
              <span className="rail-note">{gitlabConfigured ? 'GitLab 已连接。' : 'GitLab 未配置：合并请求不可用。'}</span>
            </div>
          )}
        </aside>

        <section className="git-mid" aria-label={tab === 'commits' ? '提交列表' : tab === 'branches' ? '分支列表' : '合并请求列表'}>
          <div className="git-mid-head">
            <Icon name={tab === 'commits' ? 'list' : tab === 'branches' ? 'branch' : 'gitRepo'} size="sm" />
            {tab === 'commits' ? '提交' : tab === 'branches' ? '分支' : '合并请求'}
            {ref === null ? null : (
              <button type="button" className="chip" onClick={() => { setRef(null); }} title="清除分支筛选">
                {shortRef(ref)}
                <Icon name="x" size="sm" />
              </button>
            )}
            <span className="spacer" />
            <Button variant="ghost" size="sm" icon="refresh" onClick={() => {
              if (tab === 'commits') void commitsQuery.refetch();
              else if (tab === 'branches') void branchesQuery.refetch();
              else void mergeRequestsQuery.refetch();
            }}>
              重新读取
            </Button>
          </div>
          <div className="git-mid-scroll">
            {tab === 'commits' && commitsQuery.isError && commits.length > 0 ? (
              <div style={{ padding: '0 12px 8px' }}>
                <FailureNotice error={commitsQuery.error} onRetry={() => { void commitsQuery.refetch(); }} compact />
                <p className="muted-note" style={{ marginTop: 4 }}>已加载的提交保留在下方；读取失败只影响失败的那一块。</p>
              </div>
            ) : null}
            {tab === 'commits' ? (
              <CommitList
                commits={filteredCommits}
                selectedSha={selectedSha}
                onSelect={(sha) => { setSelectedSha(sha); setMobileDetailOpen(true); }}
                loading={commitsQuery.isPending}
                error={commitsQuery.isError && commits.length === 0 ? commitsQuery.error : null}
                onRetry={() => { void commitsQuery.refetch(); }}
                nextCursor={moreState === null ? commitsQuery.data?.nextCursor : moreState.nextCursor}
                loadingMore={loadingMore}
                loadMoreError={loadMoreError}
                onLoadMore={() => { void loadMore(); }}
                shallowBoundaryReached={(moreState === null ? commitsQuery.data?.shallowBoundaryReached : moreState.shallow) ?? false}
                filtered={keyword.trim().length > 0}
                loadedCount={commits.length}
              />
            ) : tab === 'branches' ? (
              <BranchesPanel
                branches={branches}
                loading={branchesQuery.isPending}
                error={branchesQuery.isError ? branchesQuery.error : null}
                onRetry={() => { void branchesQuery.refetch(); }}
                activeRef={null}
                gitlabConfigured={gitlabConfigured}
                onSelect={(branch) => {
                  setSelectedBranchName(branch.fullRef);
                  setMobileDetailOpen(true);
                }}
              />
            ) : (
              <MergeRequestsPanel
                mergeRequests={mergeRequests}
                loading={mergeRequestsQuery.isPending}
                error={mergeRequestsQuery.isError ? mergeRequestsQuery.error : null}
                onRetry={() => { void mergeRequestsQuery.refetch(); }}
                selectedIid={selectedMrIid}
                onSelect={(mr) => { setSelectedMrIid(mr.iid); setMobileDetailOpen(true); }}
                gitlabConfigured={gitlabConfigured}
              />
            )}
          </div>
        </section>

        <main className="git-detail" aria-label="详情">
          {tab === 'commits' ? (
            selectedSha === null ? (
              <div className="git-detail-empty">
                <EmptyState
                  icon="list"
                  title={commitsQuery.isPending ? '正在读取提交' : '选择一个提交'}
                  description="提交详情包含改动文件、AI 审查与修复三个页签；浏览全部只读。"
                />
              </div>
            ) : (
              <CommitDetail
                key={selectedSha}
                projectId={projectId}
                sha={selectedSha}
                repo={repo}
                branches={branches}
                onDiffFullscreenChange={onDiffFullscreenChange}
                onBackToList={() => { setMobileDetailOpen(false); }}
              />
            )
          ) : tab === 'branches' ? (
            selectedBranch === null ? (
              <div className="git-detail-empty">
                <EmptyState compact icon="branch" title="选择一个分支" description="分支详情只读：tip、upstream、保护状态与最后提交。" />
              </div>
            ) : (
              <div className="git-detail-scroll">
                <BranchDetail
                  branch={selectedBranch}
                  onFilter={() => {
                    setRef(selectedBranch.fullRef);
                    setKeyword('');
                    setTab('commits');
                  }}
                />
              </div>
            )
          ) : selectedMr === null ? (
            <div className="git-detail-empty">
              <EmptyState compact icon="gitRepo" title="选择一个合并请求" description="合并请求只读；没有可用的 GitLab 连接时不显示远端数字。" />
            </div>
          ) : (
            <div className="git-detail-scroll">
              <MergeRequestDetail mr={selectedMr} />
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
