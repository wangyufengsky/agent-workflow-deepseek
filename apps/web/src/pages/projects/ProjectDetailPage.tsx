import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ROUTES,
  RepoGitState,
  createRequestKey,
  type CommandResponse,
  type GitConnectionStateValue,
  type GitRepo,
  type IntegrationStatus,
  type OperationReceipt,
  type OperationsByKeyResponse,
  type Project,
  type ProjectCharterResponse,
  type ProjectCharterStatusValue,
  type ProjectCharterView,
  type ProjectDetailResponse,
  type ProjectSettings,
  type RepoGitStateValue,
  type TaskSummary,
  type UpdateProjectRequest,
} from '@agent-workflow/shared';
import { apiGet, apiPost, errorMessage, isApiClientError, request } from '../../api/client.ts';
import { classifyGitFailure, fetchGitRepo, gitKeys } from '../../api/git.ts';
import { queryKeys, useBootstrap } from '../../api/hooks.ts';
import { Badge, type BadgeTone } from '../../components/Badge.tsx';
import { Button, LinkButton } from '../../components/Button.tsx';
import { Modal } from '../../components/Modal.tsx';
import { EmptyState, Skeleton, SkeletonText } from '../../components/EmptyState.tsx';
import { Icon, type IconName } from '../../components/Icon.tsx';
import { IconButton } from '../../components/IconButton.tsx';
import { ServiceNotice } from '../../components/ServiceNotice.tsx';
import { TaskStatusBadge } from '../../components/StageBadge.tsx';
import { CommandErrorNotice, ReceiptNotice } from '../../flow/workflow-ui.tsx';
import { formatDateTime, formatRelativeTime } from '../../app/format.ts';
import { sortByUpdatedDesc, taskHref } from '../../app/taskStatus.ts';
import './project-detail.css';

type ProjectTab = 'overview' | 'git' | 'docs' | 'charter';
type GitSection = 'account' | 'gitlab';

const TAB_ORDER: readonly { readonly id: ProjectTab; readonly label: string }[] = [
  { id: 'overview', label: '概览' },
  { id: 'git', label: 'Git 与 GitLab' },
  { id: 'docs', label: '文档路径' },
  { id: 'charter', label: '项目公约' },
];

const GIT_STATE_LABEL: Record<RepoGitStateValue, string> = {
  git: 'Git 仓库',
  not_git: '非 Git 目录',
  path_unavailable: '路径不可用',
  capability_unavailable: 'Git 能力不可用',
};

const GIT_STATE_TONE: Record<RepoGitStateValue, BadgeTone> = {
  git: 'accent',
  not_git: 'idle',
  path_unavailable: 'fail',
  capability_unavailable: 'unknown',
};

const GIT_STATE_ICON: Record<RepoGitStateValue, IconName> = {
  git: 'git',
  not_git: 'folder',
  path_unavailable: 'alert',
  capability_unavailable: 'help',
};

const GITLAB_STATE_LABEL: Record<GitConnectionStateValue, string> = {
  connected: '已连接',
  not_configured: '未配置',
  auth_failed: '认证失败',
  unreachable: '不可达',
};

const GITLAB_STATE_TONE: Record<GitConnectionStateValue, BadgeTone> = {
  connected: 'ok',
  not_configured: 'idle',
  auth_failed: 'fail',
  unreachable: 'fail',
};

const PROVIDER_LABEL: Record<'github' | 'gitlab', string> = {
  github: 'GitHub',
  gitlab: 'GitLab',
};

function parseTab(value: string | null): ProjectTab {
  const match = TAB_ORDER.find((tab) => tab.id === value);
  return match?.id ?? 'overview';
}

function projectDetailKey(projectId: string) {
  return ['project', projectId, 'detail'] as const;
}

async function fetchProjectDetail(projectId: string): Promise<ProjectDetailResponse> {
  const response = await apiGet<ProjectDetailResponse>(ROUTES.project(projectId));
  return response.data;
}

async function recheckProject(projectId: string): Promise<CommandResponse<ProjectDetailResponse>> {
  const response = await request<CommandResponse<ProjectDetailResponse>>(ROUTES.projectRecheck(projectId), {
    method: 'POST',
    body: { requestKey: createRequestKey() },
  });
  return response.data;
}

function readDocPaths(settings: ProjectSettings): readonly string[] {
  return [...(settings.docPaths ?? [])];
}

async function patchDocPaths(projectId: string, paths: readonly string[]): Promise<CommandResponse<ProjectDetailResponse>> {
  const response = await request<CommandResponse<ProjectDetailResponse>>(ROUTES.project(projectId), {
    method: 'PATCH',
    body: { requestKey: createRequestKey(), settings: { docPaths: [...paths] } },
  });
  return response.data;
}

function charterKey(projectId: string) {
  return ['project', projectId, 'charter'] as const;
}

async function fetchCharter(projectId: string): Promise<ProjectCharterView> {
  const response = await apiGet<ProjectCharterResponse>(ROUTES.projectCharter(projectId));
  return response.data.charter;
}

async function updateCharter(projectId: string, content: string, expectedVersion: number | undefined): Promise<CommandResponse<ProjectCharterResponse>> {
  const response = await request<CommandResponse<ProjectCharterResponse>>(ROUTES.projectCharter(projectId), {
    method: 'PATCH',
    body: { requestKey: createRequestKey(), content, ...(expectedVersion === undefined ? {} : { expectedVersion }) },
  });
  return response.data;
}

async function generateCharter(projectId: string): Promise<CommandResponse<ProjectCharterResponse>> {
  const response = await apiPost<CommandResponse<ProjectCharterResponse>>(ROUTES.projectCharterGenerate(projectId), {
    requestKey: createRequestKey(),
    confirmGenerate: true,
  });
  return response.data;
}

async function confirmCharter(projectId: string, expectedVersion: number | undefined): Promise<CommandResponse<ProjectCharterResponse>> {
  const response = await request<CommandResponse<ProjectCharterResponse>>(ROUTES.projectCharterConfirm(projectId), {
    method: 'POST',
    body: { requestKey: createRequestKey(), confirmWrite: true, ...(expectedVersion === undefined ? {} : { expectedVersion }) },
  });
  return response.data;
}

function GitStateBadge({ gitState }: { readonly gitState: RepoGitStateValue }) {
  return (
    <Badge tone={GIT_STATE_TONE[gitState]} icon={GIT_STATE_ICON[gitState]}>
      {GIT_STATE_LABEL[gitState]}
    </Badge>
  );
}

function DetailSection({
  title,
  subtitle,
  aside,
  children,
  className,
}: {
  readonly title: ReactNode;
  readonly subtitle?: ReactNode;
  readonly aside?: ReactNode;
  readonly children: ReactNode;
  readonly className?: string;
}) {
  return (
    <section className={['card', className ?? ''].filter(Boolean).join(' ')}>
      <div className="card-head">
        <div className="grow">
          <span className="section-title">{title}</span>
          {subtitle === undefined ? null : <div className="hint" style={{ marginTop: 2 }}>{subtitle}</div>}
        </div>
        {aside}
      </div>
      <div className="card-body">{children}</div>
    </section>
  );
}

function RecentTaskRow({ task }: { readonly task: TaskSummary }) {
  return (
    <Link className="list-row" to={taskHref(task)}>
      <span className="grow" style={{ minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 13.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {task.title}
        </span>
        <span className="hint" style={{ display: 'block', marginTop: 2 }}>
          {task.methodName} · 更新 {formatRelativeTime(task.updatedAt)}
        </span>
      </span>
      <TaskStatusBadge task={task} />
    </Link>
  );
}

function ConfigItem({
  icon,
  label,
  detail,
  tone,
  status,
  onSelect,
}: {
  readonly icon: IconName;
  readonly label: string;
  readonly detail: string;
  readonly tone: BadgeTone;
  readonly status: string;
  readonly onSelect: () => void;
}) {
  return (
    <button type="button" className="project-config-item" onClick={onSelect}>
      <span className="tile" style={{ width: 32, height: 32, borderRadius: 9 }}>
        <Icon name={icon} size="sm" />
      </span>
      <span className="grow" style={{ minWidth: 0 }}>
        <span className="t" style={{ display: 'block' }}>{label}</span>
        <span className="d" style={{ display: 'block' }}>{detail}</span>
      </span>
      <Badge tone={tone}>{status}</Badge>
      <Icon name="chevRight" size="sm" />
    </button>
  );
}

function GitAccountFacts({ integration, loading }: { readonly integration?: IntegrationStatus; readonly loading: boolean }) {
  if (loading) {
    return <p className="hint">正在读取 bootstrap 集成状态…</p>;
  }
  if (integration === undefined) {
    return <p className="hint">服务未连接或 bootstrap 未返回集成状态；Git 账号状态未知。</p>;
  }
  const git = integration.git;
  return (
    <dl className="kv">
      <dt>默认 Provider</dt>
      <dd>{PROVIDER_LABEL[git.provider]}</dd>
      <dt>GitHub</dt>
      <dd>
        {git.github.configured ? '已配置' : '未配置'}
        {git.github.authState.trim().length === 0 ? '' : ` · ${git.github.authState}`}
      </dd>
      <dt>GitLab</dt>
      <dd>
        {git.gitlab.configured ? '已配置' : '未配置'}
        {git.gitlab.authState.trim().length === 0 ? '' : ` · ${git.gitlab.authState}`}
      </dd>
    </dl>
  );
}

function ProjectGitlabForm({ project, globalBaseUrl }: { readonly project: Project; readonly globalBaseUrl?: string }) {
  const queryClient = useQueryClient();
  const override = project.settings.gitlab;
  const [inheritGlobal, setInheritGlobal] = useState(override?.inheritGlobal ?? true);
  const [baseUrl, setBaseUrl] = useState(override?.baseUrl ?? '');
  const [projectPath, setProjectPath] = useState(override?.projectPath ?? '');
  const [enabled, setEnabled] = useState(override?.enabled ?? true);
  const [receipt, setReceipt] = useState<OperationReceipt | undefined>(undefined);
  const [error, setError] = useState<unknown>(null);
  const overrideKey = JSON.stringify(override ?? null);

  useEffect(() => {
    const next = project.settings.gitlab;
    setInheritGlobal(next?.inheritGlobal ?? true);
    setBaseUrl(next?.baseUrl ?? '');
    setProjectPath(next?.projectPath ?? '');
    setEnabled(next?.enabled ?? true);
  }, [project.id, overrideKey]);

  useEffect(() => {
    setReceipt(undefined);
    setError(null);
  }, [project.id]);

  const initial = JSON.stringify({
    inheritGlobal: override?.inheritGlobal ?? true,
    baseUrl: override?.baseUrl ?? '',
    projectPath: override?.projectPath ?? '',
    enabled: override?.enabled ?? true,
  });
  const current = JSON.stringify({ inheritGlobal, baseUrl, projectPath, enabled });
  const dirty = initial !== current;
  const urlValid = inheritGlobal || /^https?:\/\/[^\s]+$/iu.test(baseUrl.trim());
  const pathValid = inheritGlobal || /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)+$/u.test(projectPath.trim());
  const locked = receipt !== undefined && (receipt.status === 'unknown' || receipt.status === 'accepted');
  const mutation = useMutation({
    mutationFn: async () => {
      const body: UpdateProjectRequest = {
        requestKey: createRequestKey(),
        settings: {
          gitlab: {
            inheritGlobal,
            ...(inheritGlobal ? {} : {
              ...(baseUrl.trim() === '' ? {} : { baseUrl: baseUrl.trim() }),
              ...(projectPath.trim() === '' ? {} : { projectPath: projectPath.trim() }),
            }),
            enabled,
          },
        },
      };
      const response = await request<CommandResponse<ProjectDetailResponse>>(ROUTES.project(project.id), { method: 'PATCH', body });
      return response.data;
    },
    onSuccess: async (data) => {
      setReceipt(data.receipt);
      setError(null);
      if (data.resource !== undefined) queryClient.setQueryData(projectDetailKey(project.id), data.resource);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: projectDetailKey(project.id) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.projects }),
        queryClient.invalidateQueries({ queryKey: queryKeys.bootstrap }),
      ]);
    },
    onError: (caught) => { setError(caught); },
  });

  const disabledReason = locked
    ? '保存结果未明或已受理；按原请求号核对后再修改。'
    : !dirty
      ? '没有修改。'
      : !inheritGlobal && baseUrl.trim() === ''
        ? '不继承全局 GitLab 时，地址不能为空。'
        : !urlValid
          ? 'GitLab 地址必须是 http(s) URL。'
          : !inheritGlobal && projectPath.trim() === ''
            ? '不继承全局 GitLab 时，项目路径不能为空。'
            : !pathValid
              ? '项目路径需要是 group/repo 形式。'
              : mutation.isPending ? '正在保存 GitLab 覆盖…' : undefined;

  return (
    <div className="section" style={{ marginTop: 16 }}>
      <div className="sec-h"><h3 className="grow">项目级 GitLab 覆盖</h3><Badge tone={override === undefined ? 'idle' : 'ok'}>{override === undefined ? '未保存' : override.inheritGlobal ? '继承全局' : '项目覆盖'}</Badge></div>
      <div className="banner info">
        <Icon name="info" />
        <div className="grow">
          <b>项目 GitLab 配置用于远程仓库调用。</b>
          <br />
          项目地址与 projectPath 用于合并请求和保护分支查询；凭据继承本机 GitLab 账号。停用后不发起 GitLab 远程调用。
        </div>
      </div>
      <label className="check" style={{ marginTop: 10 }}>
        <input type="checkbox" checked={inheritGlobal} disabled={mutation.isPending || locked} onChange={(event) => { setInheritGlobal(event.target.checked); }} />
        <span>继承全局 GitLab 配置（不保存项目地址/路径）</span>
      </label>
      <div className="grid-2" style={{ gap: 10, marginTop: 10 }}>
        <div className="field" style={{ margin: 0 }}>
          <label className="label" htmlFor="project-gitlab-base">GitLab 地址</label>
          <input
            id="project-gitlab-base"
            className="input mono"
            value={inheritGlobal ? (globalBaseUrl ?? '') : baseUrl}
            disabled={inheritGlobal || mutation.isPending || locked}
            placeholder={globalBaseUrl ?? 'https://gitlab.example.com'}
            onChange={(event) => { setBaseUrl(event.target.value); }}
          />
          <span className="hint">{inheritGlobal ? '来自全局设置（只读展示）' : '必须为 http(s) URL'}</span>
        </div>
        <div className="field" style={{ margin: 0 }}>
          <label className="label" htmlFor="project-gitlab-path">Project Path</label>
          <input
            id="project-gitlab-path"
            className="input mono"
            value={projectPath}
            disabled={inheritGlobal || mutation.isPending || locked}
            placeholder="group/repo"
            onChange={(event) => { setProjectPath(event.target.value); }}
          />
          <span className="hint">group/repo 形式；不是 URL。</span>
        </div>
      </div>
      <label className="check" style={{ marginTop: 8 }}>
        <input type="checkbox" checked={enabled} disabled={mutation.isPending || locked} onChange={(event) => { setEnabled(event.target.checked); }} />
        <span>启用项目级 GitLab 覆盖</span>
      </label>
      <div className="row wrap" style={{ gap: 8, marginTop: 10 }}>
        <span className="hint grow">非敏感配置；不保存 token。远程调用采用已保存的项目覆盖；凭据仍保存在本机。</span>
        <Button
          variant="primary"
          size="sm"
          icon="check"
          disabled={disabledReason !== undefined}
          disabledReason={disabledReason}
          onClick={() => { setReceipt(undefined); setError(null); mutation.mutate(); }}
        >
          {mutation.isPending ? '保存中…' : '保存 GitLab 覆盖'}
        </Button>
      </div>
      <ReceiptNotice receipt={receipt} successMessage="项目级 GitLab 覆盖已保存并用于后续远程调用。" />
      {error === null ? null : <CommandErrorNotice error={error} title="GitLab 覆盖未保存" />}
    </div>
  );
}

function GitTab({
  project,
  detailRepo,
  integration,
  integrationLoading,
  gitlabBaseUrl,
  section,
  onSectionChange,
}: {
  readonly project: Project;
  readonly detailRepo?: GitRepo;
  readonly integration?: IntegrationStatus;
  readonly integrationLoading: boolean;
  readonly gitlabBaseUrl?: string;
  readonly section: GitSection;
  readonly onSectionChange: (section: GitSection) => void;
}) {
  const isGit = project.gitState === RepoGitState.GIT;
  const repoQuery = useQuery({
    queryKey: gitKeys.repo(project.id),
    queryFn: () => fetchGitRepo(project.id),
    enabled: isGit,
    retry: (failureCount, error) => classifyGitFailure(error) === 'unavailable' && failureCount < 1,
  });
  const repo = repoQuery.data?.repo ?? detailRepo;
  const gitState = repo?.gitState ?? project.gitState;
  const gitlabState = repo?.gitlab ?? 'not_configured';
  const failure = repoQuery.isError ? classifyGitFailure(repoQuery.error) : null;

  const repoFacts = (
    <dl className="kv">
      <dt>Git 状态</dt>
      <dd><GitStateBadge gitState={gitState} /></dd>
      <dt>当前分支</dt>
      <dd className="mono">{repo?.status?.head.branch ?? repo?.defaultBranch ?? '未知'}</dd>
      <dt>HEAD</dt>
      <dd className="mono">{repo?.status?.head.kind === 'detached' ? '分离 HEAD' : repo?.status?.head.sha?.slice(0, 12) ?? '未知'}</dd>
      <dt>上游</dt>
      <dd>
        {repo?.status?.upstream === undefined
          ? '未知'
          : `${repo.status.upstream.ref} · 领先 ${String(repo.status.upstream.ahead)} / 落后 ${String(repo.status.upstream.behind)}`}
      </dd>
      <dt>远端</dt>
      <dd className="mono">{repo?.remote?.displayUrl ?? '服务未返回远端'}</dd>
      <dt>工作区</dt>
      <dd>
        {repo?.status === undefined
          ? '未知'
          : `未提交 ${String(repo.status.workingTree.uncommitted)} · 暂存 ${String(repo.status.workingTree.staged)} · 未跟踪 ${String(repo.status.workingTree.untracked)}`}
      </dd>
      <dt>最近获取</dt>
      <dd>{formatRelativeTime(repo?.status?.lastFetchAt)}</dd>
      <dt>最近提交</dt>
      <dd>
        {repo?.summary?.lastCommit === undefined
          ? '未知'
          : `${repo.summary.lastCommit.subject} · ${repo.summary.lastCommit.author.name} · ${formatRelativeTime(repo.summary.lastCommit.authoredAt)}`}
      </dd>
    </dl>
  );

  return (
    <>
      <div className="seg" role="tablist" aria-label="Git 与 GitLab">
        <button type="button" role="tab" aria-selected={section === 'account'} onClick={() => { onSectionChange('account'); }}>
          Git 账号
        </button>
        <button type="button" role="tab" aria-selected={section === 'gitlab'} onClick={() => { onSectionChange('gitlab'); }}>
          GitLab 与证据
        </button>
      </div>

      {!isGit ? (
        <div className="banner info" style={{ marginTop: 14 }}>
          <Icon name="info" />
          <div className="grow">
            <b>{GIT_STATE_LABEL[project.gitState]}</b>
            <br />
            {project.gitState === RepoGitState.NOT_GIT
              ? '该项目不是 Git 仓库；Git 账号与仓库事实不适用，任务仍可按非 Git 目录交付。'
              : '服务返回的 Git 状态不可用于读取仓库；请先重新检测项目路径，本页不会伪造仓库事实。'}
          </div>
        </div>
      ) : null}

      {section === 'account' ? (
        <DetailSection
          title="Git 账号"
          subtitle="账号与令牌只在服务端设置中维护；项目页只读。"
          className="project-section"
          aside={<Badge outline>{project.settings.gitProvider === undefined ? '继承全局' : PROVIDER_LABEL[project.settings.gitProvider]}</Badge>}
        >
          {!isGit ? (
            <p className="hint">
              非 Git 项目：Git 账号与 Provider 不适用于这个项目；仍可在设置中查看全局 Git 账号。
            </p>
          ) : (
            <>
              <dl className="kv">
                <dt>项目 Provider</dt>
                <dd>{project.settings.gitProvider === undefined ? '继承全局默认' : PROVIDER_LABEL[project.settings.gitProvider]}</dd>
                <dt>项目级凭据</dt>
                <dd>未提供（服务没有项目级 Git 凭据接口）</dd>
              </dl>
              <GitAccountFacts integration={integration} loading={integrationLoading} />
              <div className="grid-2" style={{ gap: 10, marginTop: 12 }}>
                <div className="card pad">
                  <div className="row" style={{ gap: 8 }}>
                    <span className="grow" style={{ fontSize: 13.5, fontWeight: 500 }}>继承全局账号</span>
                    <Badge tone="ok" icon="check">只读</Badge>
                  </div>
                  <p className="hint" style={{ marginTop: 4, lineHeight: 1.6 }}>
                    任务提交使用设置中的 Git 账号；本页不保存令牌。
                  </p>
                </div>
                <div className="card pad">
                  <div className="row" style={{ gap: 8 }}>
                    <span className="grow" style={{ fontSize: 13.5, fontWeight: 500 }}>此项目单独配置</span>
                    <Badge tone="unknown" icon="help">服务未提供</Badge>
                  </div>
                  <p className="hint" style={{ marginTop: 4, lineHeight: 1.6 }}>
                    服务没有项目级 Git 凭据接口；不会伪造项目账号或验证结果。
                  </p>
                </div>
              </div>
            </>
          )}
          <div className="row" style={{ marginTop: 12, gap: 8, flexWrap: 'wrap' }}>
            <LinkButton to="/settings?section=git" variant="secondary" size="sm" icon="settings">
              去设置 Git 账号
            </LinkButton>
            <span className="hint">凭证、令牌与 Provider 配置都在设置页；本页不保存凭据。</span>
          </div>
        </DetailSection>
      ) : (
        <DetailSection
          title="GitLab 与证据"
          subtitle="仓库事实来自服务端 Git 读取接口；项目级 GitLab 覆盖用于远程仓库读取与合并请求。"
          className="project-section"
          aside={repo === undefined ? <Badge tone="idle">未读取</Badge> : <Badge tone={GITLAB_STATE_TONE[gitlabState]} icon={gitlabState === 'connected' ? 'check' : gitlabState === 'auth_failed' || gitlabState === 'unreachable' ? 'alert' : 'help'}>{GITLAB_STATE_LABEL[gitlabState]}</Badge>}
        >
          {!isGit ? (
            <p className="hint">非 Git 项目：没有可读取的仓库、分支或 GitLab 事实。</p>
          ) : (
            <>
              {repoQuery.isLoading && repo === undefined ? <SkeletonText lines={5} /> : repoFacts}
              {repoQuery.isFetching && repo !== undefined ? <p className="hint">正在读取完整仓库事实…</p> : null}
              {failure === 'not_connected' ? (
                <div className="banner warn">
                  <Icon name="help" />
                  <div className="grow">Git 读取接口未接通；本页不显示示例仓库与分支。</div>
                </div>
              ) : null}
              {failure === 'unavailable' ? (
                <div className="banner warn">
                  <Icon name="alert" />
                  <div className="grow">本地服务未连接，读取不到仓库事实；连接后重试。</div>
                </div>
              ) : null}
              {failure === 'failed' ? <CommandErrorNotice error={repoQuery.error} title="仓库读取失败" /> : null}
              {failure === null ? null : (
                <div className="row" style={{ marginTop: 8 }}>
                  <Button
                    variant="secondary"
                    size="sm"
                    icon="refresh"
                    disabled={repoQuery.isFetching}
                    disabledReason={repoQuery.isFetching ? '正在重新读取仓库…' : undefined}
                    onClick={() => { void repoQuery.refetch(); }}
                  >
                    重新读取仓库
                  </Button>
                </div>
              )}
              <dl className="kv" style={{ marginTop: 12 }}>
                <dt>GitLab 连接</dt>
                <dd>{repo === undefined ? '未知（未读取仓库）' : GITLAB_STATE_LABEL[gitlabState]}</dd>
                <dt>全局 GitLab 账号</dt>
                <dd>
                  {integrationLoading
                    ? '读取中'
                    : integration === undefined
                      ? '未知（bootstrap 未返回）'
                      : integration.git.gitlab.configured ? '已配置' : '未配置'}
                </dd>
                <dt>GitLab 地址</dt>
                <dd className="mono">{gitlabBaseUrl ?? '未知'}</dd>
                <dt>打开的合并请求</dt>
                <dd>{repo?.summary?.openMrCount === undefined || repo.summary.openMrCount === null ? '未知' : `${String(repo.summary.openMrCount)} 个`}</dd>
              </dl>
            </>
          )}

          <ProjectGitlabForm project={project} {...(gitlabBaseUrl === undefined ? {} : { globalBaseUrl: gitlabBaseUrl })} />
          <div className="banner info" style={{ marginTop: 12 }}>
            <Icon name="info" />
            <div className="grow">
              <b>证据来源（JUnit 报告 / 日志目录）仍未提供接口。</b>
              <br />
              本页不展示可保存的测试报告/日志目录表单，也不伪造绑定结果；GitLab 连接状态以上方服务事实为准。
            </div>
          </div>

          <div className="row" style={{ marginTop: 12, gap: 8, flexWrap: 'wrap' }}>
            {isGit ? (
              <LinkButton to={`/git/${encodeURIComponent(project.id)}`} variant="secondary" size="sm" icon="gitRepo" iconAfter="arrowRight">
                打开 Git 工作台
              </LinkButton>
            ) : null}
            <span className="hint">提交、分支、审查与 MR 的完整事实在 Git 工作台。</span>
          </div>
        </DetailSection>
      )}
    </>
  );
}

function validateDocPath(value: string, index: number): string | undefined {
  const path = value.trim();
  if (path.length === 0) return `第 ${String(index + 1)} 行为空；留空请删除该行。`;
  if (path.length > 500) return `第 ${String(index + 1)} 行超过 500 字符。`;
  if (path.startsWith('/')) return `第 ${String(index + 1)} 行不能是绝对路径。`;
  if (path.includes('\\')) return `第 ${String(index + 1)} 行不能包含反斜杠。`;
  if (/(^|\/)\.\.(\/|$)/u.test(path)) return `第 ${String(index + 1)} 行不能包含 ..。`;
  if (/[\u0000-\u001f\u007f]/u.test(path)) return `第 ${String(index + 1)} 行包含控制字符。`;
  return undefined;
}

function DocumentPathsTab({ project }: { readonly project: Project }) {
  const queryClient = useQueryClient();
  const docPaths = useMemo(() => readDocPaths(project.settings), [project.settings]);
  const initialKey = JSON.stringify(docPaths);
  const [paths, setPaths] = useState<readonly string[]>(docPaths);
  const [receipt, setReceipt] = useState<OperationReceipt | undefined>(undefined);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    setPaths(docPaths);
  }, [initialKey, project.id]);

  useEffect(() => {
    setReceipt(undefined);
    setError(null);
  }, [project.id]);

  const mutation = useMutation({
    mutationFn: async (next: readonly string[]) => patchDocPaths(project.id, next),
    onSuccess: async (data) => {
      setReceipt(data.receipt);
      setError(null);
      if (data.resource !== undefined) {
        queryClient.setQueryData(projectDetailKey(project.id), data.resource);
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: projectDetailKey(project.id) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.projects }),
        queryClient.invalidateQueries({ queryKey: queryKeys.bootstrap }),
      ]);
    },
    onError: (caught) => {
      setError(caught);
    },
  });

  const trimmed = paths.map((path) => path.trim());
  const lines = trimmed.filter((path) => path.length > 0);
  const pathError = paths.map((path, index) => validateDocPath(path, index)).find((message) => message !== undefined);
  const duplicate = lines.find((path, index) => lines.indexOf(path) !== index);
  const dirty = JSON.stringify(trimmed) !== JSON.stringify(docPaths);
  const locked = receipt !== undefined && (receipt.status === 'unknown' || receipt.status === 'accepted');
  const validationError = pathError ?? (duplicate === undefined ? undefined : `路径重复：${duplicate}`);
  const disabledReason = locked
    ? '文档路径保存结果未明或已受理；按原请求号核对后再修改。'
    : mutation.isPending
      ? '正在保存文档路径，等待服务回执…'
      : !dirty
        ? '没有修改。'
        : validationError;
  const preview = lines.map((line) => `${project.rootPath.replace(/\/+$/u, '')}/${line}`);

  return (
    <DetailSection
      title="文档路径"
      subtitle="任务产出的设计文档、变更说明会写到这里；相对路径基于项目目录，留空表示不生成。"
      aside={<Badge tone={docPaths.length === 0 ? 'idle' : 'ok'}>{docPaths.length === 0 ? '未配置' : `已配置 ${String(docPaths.length)} 条`}</Badge>}
    >
      <div className="project-doc-list">
        {paths.length === 0 ? (
          <p className="hint">还没有文档路径。添加一条相对路径，或保存空列表表示不生成项目文档。</p>
        ) : paths.map((path, index) => (
          <div className="project-doc-row" key={`${String(index)}:${path}`}>
            <span className="mono hint">{String(index + 1)}</span>
            <input
              className="input mono"
              value={path}
              disabled={mutation.isPending || locked}
              placeholder="例如 docs 或 docs/design"
              aria-label={`文档路径 ${String(index + 1)}`}
              onChange={(event) => {
                const next = [...paths];
                next[index] = event.target.value;
                setPaths(next);
              }}
            />
            <IconButton
              icon="trash"
              label={`删除文档路径 ${String(index + 1)}`}
              disabled={mutation.isPending || locked}
              onClick={() => { setPaths(paths.filter((_, position) => position !== index)); }}
            />
          </div>
        ))}
      </div>
      <div className="row wrap" style={{ marginTop: 8, gap: 8 }}>
        <Button
          variant="ghost"
          size="sm"
          icon="plus"
          disabled={mutation.isPending || locked || paths.length >= 20}
          disabledReason={paths.length >= 20 ? '文档路径最多 20 条。' : undefined}
          onClick={() => { setPaths([...paths, '']); }}
        >
          添加路径
        </Button>
        <span className="hint">相对路径；不能以 / 开头、不能包含 .. 或反斜杠；保存空列表表示不生成。</span>
      </div>
      {validationError === undefined ? null : <p className="hint" style={{ color: 'var(--danger)', marginTop: 6 }}>{validationError}</p>}
      <div className="project-doc-preview">
        实际位置：{preview.length === 0 ? '不生成项目文档' : preview.join('、')}
      </div>
      <ReceiptNotice receipt={receipt} successMessage="文档路径已保存。" />
      {error === null ? null : <CommandErrorNotice error={error} title="文档路径未保存" />}
      <div className="project-doc-actions">
        <span className="hint grow">服务只保存路径，不会创建或移动目录。</span>
        <Button
          variant="ghost"
          size="sm"
          disabled={!dirty || mutation.isPending}
          disabledReason={mutation.isPending ? '正在保存文档路径，等待服务回执…' : '没有修改。'}
          onClick={() => { setPaths(docPaths); setReceipt(undefined); setError(null); }}
        >
          放弃修改
        </Button>
        <Button
          variant="primary"
          size="sm"
          icon="check"
          disabled={disabledReason !== undefined}
          disabledReason={disabledReason}
          onClick={() => { setReceipt(undefined); setError(null); mutation.mutate(lines); }}
        >
          {mutation.isPending ? '保存中…' : '保存文档路径'}
        </Button>
      </div>
    </DetailSection>
  );
}

const CHARTER_STATUS_META: Record<ProjectCharterStatusValue, { readonly label: string; readonly tone: BadgeTone; readonly icon: IconName }> = {
  none: { label: '尚未创建', tone: 'idle', icon: 'file' },
  draft: { label: '草稿待写入', tone: 'wait', icon: 'edit' },
  generating: { label: '生成中', tone: 'run', icon: 'play' },
  written: { label: '已写入 AGENTS.md', tone: 'ok', icon: 'check' },
  unknown: { label: '状态未明', tone: 'unknown', icon: 'help' },
};

function CharterTab({
  project,
  charter,
  loading,
  error,
  onRetry,
}: {
  readonly project: Project;
  readonly charter?: ProjectCharterView;
  readonly loading: boolean;
  readonly error: unknown;
  readonly onRetry: () => void;
}) {
  const queryClient = useQueryClient();
  const sourceContent = charter?.draft?.content ?? charter?.current.content ?? '';
  const sourceKey = `${project.id}:${charter?.draft?.version === undefined ? 'none' : String(charter.draft.version)}:${charter?.status ?? 'none'}:${String(charter?.current.content?.length ?? 0)}`;
  const [content, setContent] = useState(sourceContent);
  const [baseline, setBaseline] = useState(sourceContent);
  const [receipt, setReceipt] = useState<OperationReceipt | undefined>(undefined);
  const [receiptKind, setReceiptKind] = useState<'save' | 'generate' | 'confirm' | undefined>(undefined);
  const [errorState, setErrorState] = useState<unknown>(null);
  const [generateError, setGenerateError] = useState<unknown>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [stopOpen, setStopOpen] = useState(false);
  const stopMutation = useMutation({
    mutationFn: async () => (await apiPost<CommandResponse<ProjectCharterResponse>>(ROUTES.projectCharterStop(project.id), { requestKey: createRequestKey(), confirmStop: true })).data,
    onSuccess: async (data) => { setStopOpen(false); setReceipt(data.receipt); await refreshCharter(); },
    onError: (caught) => { setGenerateError(caught); },
  });
  useEffect(() => {
    if (charter?.status !== 'generating' && receipt?.status === 'accepted') {
      void apiGet<OperationsByKeyResponse>(ROUTES.operationsByKey(receipt.requestKey)).then((response) => setReceipt(response.data.operation)).catch(() => undefined);
    }
  }, [charter?.status, receipt?.requestKey]);

  useEffect(() => {
    setContent(sourceContent);
    setBaseline(sourceContent);
  }, [sourceKey]);

  useEffect(() => {
    setReceipt(undefined);
    setReceiptKind(undefined);
    setErrorState(null);
    setGenerateError(null);
    setConfirmOpen(false);
  }, [project.id]);

  useEffect(() => {
    if (charter?.status !== 'generating') return;
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    const navigate = (event: MouseEvent) => {
      if (event.target instanceof Element && event.target.closest('a[href]') !== null) { event.preventDefault(); event.stopPropagation(); setStopOpen(true); }
    };
    window.addEventListener('beforeunload', beforeUnload);
    document.addEventListener('click', navigate, true);
    return () => { window.removeEventListener('beforeunload', beforeUnload); document.removeEventListener('click', navigate, true); };
  }, [charter?.status]);

  const dirty = content !== baseline;
  const locked = receipt !== undefined && (receipt.status === 'unknown' || receipt.status === 'accepted');
  const unknownState = charter?.needsReconcile === true || charter?.status === 'unknown' || (error != null && charter?.status === 'generating');
  const canEdit = charter?.capabilities.edit.allowed !== false;
  const expectedVersion = charter?.draft?.version ?? charter?.written?.version;
  const currentStatus = charter?.status;
  const statusMeta = currentStatus === undefined ? { label: '读取中', tone: 'idle' as BadgeTone, icon: 'clock' as IconName } : CHARTER_STATUS_META[currentStatus];
  const refreshCharter = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: charterKey(project.id) }),
      queryClient.invalidateQueries({ queryKey: projectDetailKey(project.id) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.bootstrap }),
    ]);
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const response = await updateCharter(project.id, content, expectedVersion);
      return response;
    },
    onSuccess: async (data) => {
      setReceiptKind('save');
      setReceipt(data.receipt);
      setErrorState(null);
      if (data.resource !== undefined) queryClient.setQueryData(charterKey(project.id), data.resource.charter);
      await refreshCharter();
    },
    onError: (caught) => {
      setErrorState(caught);
    },
  });

  const generateMutation = useMutation({
    mutationFn: async () => generateCharter(project.id),
    onSuccess: async (data) => {
      setGenerateError(null);
      setReceiptKind('generate');
      setReceipt(data.receipt);
      if (data.resource !== undefined) queryClient.setQueryData(charterKey(project.id), data.resource.charter);
      await refreshCharter();
    },
    onError: async (caught) => {
      setGenerateError(caught);
      setErrorState(null);
      await refreshCharter();
    },
  });

  const confirmMutation = useMutation({
    mutationFn: async () => confirmCharter(project.id, charter?.draft?.version),
    onSuccess: async (data) => {
      setReceiptKind('confirm');
      setReceipt(data.receipt);
      setErrorState(null);
      setConfirmOpen(false);
      if (data.resource !== undefined) queryClient.setQueryData(charterKey(project.id), data.resource.charter);
      await refreshCharter();
    },
    onError: async (caught) => {
      setErrorState(caught);
      await refreshCharter();
    },
  });

  const saveDisabledReason = loading
    ? '正在读取项目公约…'
    : error !== null && error !== undefined
      ? '项目公约读取失败，先重试读取。'
      : !canEdit
        ? charter?.capabilities.edit.reason ?? '服务不允许编辑公约草稿。'
        : locked
          ? '保存结果未明或已受理；按原请求号核对后再修改。'
          : saveMutation.isPending
            ? '正在保存公约草稿…'
            : content.trim().length === 0
              ? '公约内容不能为空。'
              : content.length > 64_000
                ? '公约内容不能超过 64000 字符。'
                : !dirty
                  ? '没有修改。'
                  : undefined;
  const confirmReason = loading
    ? '正在读取项目公约…'
    : charter === undefined
      ? '服务没有返回项目公约。'
      : unknownState
        ? '上次写入状态未明；请先核对 AGENTS.md 或重新编辑草稿，不能自动重试。'
        : dirty
          ? '有未保存的公约修改；先保存草稿再确认写入。'
          : charter.capabilities.confirmWrite.allowed !== true
          ? charter.capabilities.confirmWrite.reason ?? '服务不允许写入 AGENTS.md。'
          : locked
            ? '结果待核对；按原请求号核对后再写入。'
            : confirmMutation.isPending
              ? '正在写入 AGENTS.md…'
              : undefined;

  const generateErrorView = generateError === null || generateError === undefined ? null : (
    <div className="banner warn" role="alert">
      <Icon name="alert" />
      <div className="grow">
        <b>生成公约草稿未完成{isApiClientError(generateError) && generateError.code === 'CHARTER_GENERATION_UNAVAILABLE' ? '（服务返回 501）' : ''}。</b>
        <br />
        {errorMessage(generateError)}
        {isApiClientError(generateError) && generateError.code !== null ? <span className="mono"> · {generateError.code}</span> : null}
        <br />
        请按原请求号核对生成结果；已保留的草稿与当前 AGENTS.md 不会被失败结果覆盖。
      </div>
    </div>
  );

  return (
    <DetailSection
      title="项目公约"
      subtitle="根据项目实际结构只读生成草稿，先审阅和编辑，确认后才写入 AGENTS.md。"
      aside={<Badge tone={statusMeta.tone} icon={statusMeta.icon}>{statusMeta.label}</Badge>}
    >
      {loading ? <SkeletonText lines={6} /> : null}
      {error !== null && error !== undefined ? <ServiceNotice error={error} title="项目公约读取失败" onRetry={onRetry} /> : null}
      {unknownState ? (
        <div className="banner unknown" role="alert">
          <Icon name="help" />
          <div className="grow">
            <b>无法确认原公约操作是否已结束。</b>
            <br />
            生成或写入记录保留；本页不会重新生成或重写。请重新读取并按原请求号核对，原进程未停稳前不开放新操作。
            {charter?.current.readError === undefined ? null : <><br />读取错误：{charter.current.readError}</>}
          </div>
          <div className="actions">
            <Button variant="secondary" size="sm" icon="refresh" disabled={loading} disabledReason={loading ? '正在读取项目公约…' : undefined} onClick={onRetry}>
              重新读取 AGENTS.md
            </Button>
          </div>
        </div>
      ) : null}
      {charter === undefined ? null : (
        <>
          <div className="banner info">
            <Icon name="info" />
            <div className="grow">
              <b>当前公约文件：{charter.current.path}</b>
              <br />
              {charter.current.exists ? '文件存在；正文只读展示在下方的「当前文件」中。' : '文件当前不存在；保存草稿不会写入文件，确认写入才会创建/覆盖 AGENTS.md。'}
              {charter.written === undefined ? '' : ` 最近写入版本 v${String(charter.written.version)} · ${formatDateTime(charter.written.writtenAt)}。`}
            </div>
          </div>

          <div className="field" style={{ marginTop: 12 }}>
            <label className="label" htmlFor="project-charter-content">公约草稿</label>
            <textarea
              id="project-charter-content"
              className="textarea mono"
              rows={14}
              maxLength={64_000}
              value={content}
              disabled={loading || !canEdit || locked}
              placeholder="手动编写 AGENTS.md 的内容；保存后形成公约草稿，确认写入才会写入项目文件。"
              onChange={(event) => { setContent(event.target.value); }}
            />
            <span className="hint">
              {charter.draft === undefined
                ? (charter.current.exists ? '当前编辑区基于现有 AGENTS.md 内容；保存后形成草稿。' : '服务没有草稿；保存后形成草稿。')
                : `草稿 v${String(charter.draft.version)} · ${charter.draft.source === 'manual' ? '手动保存' : charter.draft.source === 'model' ? '模型生成' : '现有文件'} · ${formatDateTime(charter.draft.savedAt)}`}
            </span>
          </div>

          <div className="row wrap" style={{ marginTop: 10, gap: 8 }}>
            <Button
              variant="secondary"
              size="sm"
              icon="sparkle"
              disabled={loading || charter === undefined || generateMutation.isPending || locked || dirty || !charter.capabilities.generate.allowed}
              disabledReason={loading ? '正在读取项目公约…' : charter === undefined ? '服务没有返回项目公约。' : locked ? (receipt?.status === 'accepted' ? '原请求已受理，等待服务完成。' : '结果待核对。') : dirty ? '请先保存或放弃未保存的公约修改。' : charter?.capabilities.generate.reason}
              onClick={() => { setGenerateError(null); setReceipt(undefined); setReceiptKind(undefined); generateMutation.mutate(); }}
            >
              {generateMutation.isPending ? '生成中…' : '生成公约草稿'}
            </Button>
            <span className="hint">
              {charter.capabilities.generate.reason ?? '调用已配置的规划模型，只读检查项目；生成后先审阅，不会自动写入。'}
            </span>
          </div>
          {charter.status === 'generating' ? <div className="banner info"><Icon name="play" /><div className="grow"><b>正在生成公约草稿</b><br />开始于 {charter.generation === undefined ? '未知' : formatDateTime(charter.generation.startedAt)} · 请求号 {charter.generation?.requestKey} · 原调用结束前不能编辑、重新生成或确认写入。生成期间请留在本页；需要离开请先停止。</div><Button variant="secondary" disabled={stopMutation.isPending} onClick={() => setStopOpen(true)}>停止</Button></div> : null}
          <Modal open={stopOpen} title="停止生成公约草稿？" onClose={() => { if (!stopMutation.isPending) setStopOpen(false); }} footer={<><Button variant="ghost" disabled={stopMutation.isPending} onClick={() => setStopOpen(false)}>取消</Button><span className="spacer" /><Button disabled={stopMutation.isPending} onClick={() => stopMutation.mutate()}>确认停止</Button></>}>
            已有草稿与 AGENTS.md 保留。停止请求受理后仍等待原调用结束，不会把迟到输出覆盖为新草稿。
          </Modal>
          {generateErrorView}
          <div className="row wrap" style={{ marginTop: 10, gap: 8 }}>
            <Button
              variant="primary"
              size="sm"
              icon="check"
              disabled={saveDisabledReason !== undefined}
              disabledReason={saveDisabledReason}
              onClick={() => { setReceipt(undefined); setReceiptKind(undefined); saveMutation.mutate(); }}
            >
              {saveMutation.isPending ? '保存中…' : '保存草稿'}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              icon="upload"
              disabled={confirmReason !== undefined}
              disabledReason={confirmReason}
              onClick={() => { setConfirmOpen(true); }}
            >
              确认写入 AGENTS.md
            </Button>
            <span className="hint">保存只形成草稿；确认写入才会覆盖项目根 AGENTS.md。</span>
          </div>
          {confirmReason === undefined ? null : <p className="hint" style={{ marginTop: 6 }}>确认写入不可用：{confirmReason}</p>}
          <ReceiptNotice receipt={receipt} successMessage={receiptKind === 'confirm' ? '已写入项目根 AGENTS.md。' : receiptKind === 'generate' ? '服务返回了生成结果。' : '公约草稿已保存；尚未写入项目文件。'} />
          {errorState === null ? null : <CommandErrorNotice error={errorState} title="公约操作未完成" />}

          <div className="section" style={{ marginTop: 18 }}>
            <div className="sec-h"><h3 className="grow">当前文件（只读）</h3><Badge tone={charter.current.exists ? 'ok' : 'idle'}>{charter.current.exists ? '存在' : '不存在'}</Badge></div>
            <p className="hint mono">{charter.current.path}</p>
            {charter.current.readError === undefined ? null : <div className="banner warn"><Icon name="alert" /><div className="grow">{charter.current.readError}</div></div>}
            {charter.current.content === undefined ? <p className="hint">服务没有返回文件正文。</p> : <pre className="code project-charter-file">{charter.current.content}</pre>}
          </div>

          <div className="section" style={{ marginTop: 16 }}>
            <div className="sec-h"><h3 className="grow">版本列表（只读）</h3><span className="hint">{String(charter.versions.length)} 个版本</span></div>
            {charter.versions.length === 0 ? <p className="hint">还没有草稿/写入版本。</p> : (
              <div className="col" style={{ gap: 6 }}>
                {charter.versions.map((version) => (
                  <div className="row wrap" key={`${String(version.version)}:${version.status}`}>
                    <Badge outline>v{String(version.version)}</Badge>
                    <Badge tone={version.status === 'written' ? 'ok' : 'wait'}>{version.status === 'written' ? '已写入' : '草稿'}</Badge>
                    <span className="hint">{version.source === 'manual' ? '手动' : version.source === 'model' ? '模型' : '现有文件'}</span>
                    <span className="hint">{formatDateTime(version.savedAt)}</span>
                    {version.writtenAt === undefined ? null : <span className="hint">写入 {formatDateTime(version.writtenAt)}</span>}
                    {version.path === undefined ? null : <span className="hint mono">{version.path}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      <Modal
        open={confirmOpen}
        title="确认写入 AGENTS.md？"
        onClose={() => { if (!confirmMutation.isPending) setConfirmOpen(false); }}
        footer={
          <>
            <Button variant="ghost" disabled={confirmMutation.isPending} onClick={() => { setConfirmOpen(false); }}>取消</Button>
            <span className="spacer" />
            <Button
              variant="primary"
              icon="upload"
              disabled={confirmReason !== undefined}
              disabledReason={confirmReason}
              onClick={() => { setReceipt(undefined); setReceiptKind(undefined); confirmMutation.mutate(); }}
            >
              {confirmMutation.isPending ? '写入中…' : '确认写入'}
            </Button>
          </>
        }
      >
        {errorState === null ? null : <CommandErrorNotice error={errorState} title="公约写入未完成" />}
        <p>将把草稿写入项目根目录的 AGENTS.md，覆盖当前文件。写入前会再次校验草稿版本；写入中断后不会自动重试，会显示状态未明。</p>
        <dl className="kv-list" style={{ marginTop: 10 }}>
          <dt>目标</dt><dd className="mono">AGENTS.md</dd>
          <dt>草稿版本</dt><dd>{charter?.draft === undefined ? '服务未返回草稿' : `v${String(charter.draft.version)}`}</dd>
          <dt>当前文件</dt><dd>{charter?.current.exists === true ? '存在，将覆盖' : '不存在，将创建'}</dd>
        </dl>
      </Modal>
    </DetailSection>
  );
}

function ConfigStatusCard({
  project,
  integration,
  integrationLoading,
  docPaths,
  gitlabState,
  charter,
  charterLoading,
  charterError,
  onSelect,
}: {
  readonly project: Project;
  readonly integration?: IntegrationStatus;
  readonly integrationLoading: boolean;
  readonly docPaths: readonly string[];
  readonly gitlabState: GitConnectionStateValue | undefined;
  readonly charter?: ProjectCharterView;
  readonly charterLoading: boolean;
  readonly charterError: boolean;
  readonly onSelect: (tab: ProjectTab, gitSection?: GitSection) => void;
}) {
  const isGit = project.gitState === RepoGitState.GIT;
  const gitlabConfigured = integration?.git.gitlab.configured === true;
  const charterMeta = charterError
    ? { label: '读取失败', tone: 'danger' as BadgeTone }
    : charter === undefined
    ? { label: charterLoading ? '读取中' : '未知', tone: 'idle' as BadgeTone }
    : charter.needsReconcile || charter.status === 'unknown'
      ? { label: '状态未明', tone: 'unknown' as BadgeTone }
      : { label: CHARTER_STATUS_META[charter.status].label, tone: CHARTER_STATUS_META[charter.status].tone };
  const charterDetail = charterError
    ? '公约状态读取失败；打开页签可重试'
    : charter === undefined
    ? (charterLoading ? '正在读取公约状态' : '服务未返回公约状态')
    : charter.needsReconcile
      ? '上次写入中断，需要核对 AGENTS.md'
      : charter.status === 'written'
        ? `已写入 AGENTS.md${charter.written === undefined ? '' : ` · v${String(charter.written.version)}`}`
        : charter.draft === undefined
          ? charter.current.exists ? '当前文件存在；尚无草稿' : '尚无草稿或文件'
          : `草稿 v${String(charter.draft.version)} · 待确认写入`;
  const gitlabTone: BadgeTone = integrationLoading
    ? 'idle'
    : !isGit
      ? 'idle'
      : gitlabState === 'connected'
        ? 'ok'
        : gitlabState === 'auth_failed' || gitlabState === 'unreachable'
          ? 'fail'
          : gitlabState === 'not_configured'
            ? 'idle'
            : gitlabConfigured ? 'ok' : 'idle';
  const gitlabStatus = integrationLoading
    ? '读取中'
    : !isGit
      ? '不适用'
      : gitlabState === undefined
        ? (integration === undefined ? '未知' : gitlabConfigured ? '已配置' : '未配置')
        : gitlabState === 'not_configured' && gitlabConfigured
          ? '未绑定'
          : GITLAB_STATE_LABEL[gitlabState];
  const projectGitlab = project.settings.gitlab;
  const gitlabOverride = projectGitlab === undefined
    ? '未保存项目覆盖'
    : projectGitlab.inheritGlobal
      ? '项目覆盖：继承全局'
      : `项目覆盖：${projectGitlab.baseUrl ?? '未填地址'} · ${projectGitlab.projectPath ?? '未填路径'}`;
  const gitlabDetail = !isGit
    ? `非 Git 项目 · ${gitlabOverride} · 远程调用采用项目覆盖或继承全局`
    : `${gitlabState === 'not_configured' && gitlabConfigured ? '全局 GitLab 已配置' : '证据来源配置服务未提供'} · ${gitlabOverride} · 远程调用采用项目覆盖或继承全局`;

  const projectProvider = project.settings.gitProvider ?? integration?.git.provider;
  const providerState = integration === undefined || projectProvider === undefined
    ? undefined
    : projectProvider === 'github' ? integration.git.github : integration.git.gitlab;
  const accountTone: BadgeTone = integrationLoading
    ? 'idle'
    : !isGit
      ? 'idle'
      : providerState === undefined
        ? 'unknown'
        : providerState.configured ? 'ok' : 'warn';
  const accountStatus = integrationLoading
    ? '读取中'
    : !isGit
      ? '不适用'
      : providerState === undefined
        ? '未知'
        : providerState.configured ? '已配置' : '未配置';
  const accountDetail = integrationLoading
    ? '正在读取 bootstrap 集成状态'
    : !isGit
      ? '非 Git 项目'
      : providerState === undefined || projectProvider === undefined
        ? 'bootstrap 未返回集成状态'
        : `${PROVIDER_LABEL[projectProvider]} · ${providerState.configured ? '已配置' : '未配置'}${providerState.authState.trim().length === 0 ? '' : ` · ${providerState.authState}`}`;

  return (
    <section className="card" aria-label="配置状态">
      <div className="card-head">
        <div className="grow">
          <span className="section-title">配置状态</span>
          <div className="hint" style={{ marginTop: 2 }}>执行任务前，确认这些设置符合预期。</div>
        </div>
      </div>
      <div className="project-config-list">
        <ConfigItem
          icon="git"
          label="Git 账号"
          detail={accountDetail}
          tone={accountTone}
          status={accountStatus}
          onSelect={() => { onSelect('git', 'account'); }}
        />
        <ConfigItem
          icon="link"
          label="GitLab 与证据"
          detail={gitlabDetail}
          tone={gitlabTone}
          status={gitlabStatus}
          onSelect={() => { onSelect('git', 'gitlab'); }}
        />
        <ConfigItem
          icon="file"
          label="文档路径"
          detail={docPaths.length === 0 ? '未配置；保存空列表表示不生成项目文档' : docPaths.join('、')}
          tone={docPaths.length === 0 ? 'idle' : 'ok'}
          status={docPaths.length === 0 ? '未配置' : `已配置 ${String(docPaths.length)} 条`}
          onSelect={() => { onSelect('docs'); }}
        />
        <ConfigItem
          icon="doc"
          label="项目公约"
          detail={charterDetail}
          tone={charterMeta.tone}
          status={charterMeta.label}
          onSelect={() => { onSelect('charter'); }}
        />
      </div>
    </section>
  );
}

export function ProjectDetailPage() {
  const { projectId } = useParams<{ projectId?: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const bootstrap = useBootstrap();
  const queryClient = useQueryClient();
  const [gitSection, setGitSection] = useState<GitSection>('account');
  const [copyNotice, setCopyNotice] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<OperationReceipt | undefined>(undefined);
  const tab = parseTab(searchParams.get('tab'));

  const detailQuery = useQuery({
    queryKey: projectDetailKey(projectId ?? ''),
    queryFn: () => fetchProjectDetail(projectId!),
    enabled: projectId !== undefined && projectId.length > 0,
    retry: false,
  });

  const charterQuery = useQuery({
    queryKey: charterKey(projectId ?? ''),
    refetchInterval: (query) => query.state.data?.status === 'generating' ? 1_500 : false,
    queryFn: () => fetchCharter(projectId!),
    enabled: projectId !== undefined && projectId.length > 0,
    retry: false,
    staleTime: 30_000,
  });

  const recheckMutation = useMutation({
    mutationFn: async () => {
      if (projectId === undefined) throw new Error('缺少项目标识');
      return recheckProject(projectId);
    },
    onSuccess: async (data) => {
      setReceipt(data.receipt);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: projectDetailKey(projectId ?? '') }),
        queryClient.invalidateQueries({ queryKey: queryKeys.projects }),
        queryClient.invalidateQueries({ queryKey: queryKeys.bootstrap }),
        queryClient.invalidateQueries({ queryKey: gitKeys.repo(projectId ?? '') }),
      ]);
    },
  });

  const selectTab = (next: ProjectTab, nextGitSection?: GitSection) => {
    if (nextGitSection !== undefined) setGitSection(nextGitSection);
    const params = new URLSearchParams(searchParams);
    if (next === 'overview') params.delete('tab');
    else params.set('tab', next);
    setSearchParams(params, { replace: true });
  };

  const copyPath = async (project: Project) => {
    try {
      await navigator.clipboard.writeText(project.rootPath);
      setCopyNotice('已复制项目路径');
    } catch {
      setCopyNotice('无法访问剪贴板，请手动复制路径');
    }
  };

  useEffect(() => {
    if (copyNotice === null) return;
    const timer = window.setTimeout(() => { setCopyNotice(null); }, 4_000);
    return () => { window.clearTimeout(timer); };
  }, [copyNotice]);

  if (projectId === undefined || projectId.length === 0) {
    return (
      <div className="page">
        <EmptyState icon="folder" title="缺少项目标识" description="地址中没有项目标识，无法读取项目配置。" />
      </div>
    );
  }

  if (detailQuery.isLoading) {
    return (
      <div className="page project-detail-page">
        <div className="project-detail-head">
          <Skeleton width={48} height={48} radius={14} />
          <div className="grow stack-sm">
            <Skeleton width="38%" height={24} />
            <Skeleton width="60%" height={12} />
          </div>
        </div>
        <div className="project-detail-grid">
          <div className="col" style={{ gap: 16 }}>
            <div className="card pad"><SkeletonText lines={5} /></div>
            <div className="card pad"><SkeletonText lines={5} /></div>
          </div>
          <div className="card pad"><SkeletonText lines={6} /></div>
        </div>
      </div>
    );
  }

  if (detailQuery.isError) {
    const notFound = isApiClientError(detailQuery.error) && detailQuery.error.status === 404;
    return (
      <div className="page">
        {notFound ? (
          <EmptyState
            icon="folder"
            title="项目不存在"
            description="服务返回 404；项目可能已被删除或标识错误。"
            action={<LinkButton to="/projects" variant="secondary" size="sm" icon="arrowLeft">返回项目列表</LinkButton>}
          />
        ) : (
          <>
            <ServiceNotice error={detailQuery.error} onRetry={() => { void detailQuery.refetch(); }} />
            <LinkButton to="/projects" variant="ghost" size="sm" icon="arrowLeft" className="mt-12">返回项目列表</LinkButton>
          </>
        )}
      </div>
    );
  }

  const detail = detailQuery.data;
  if (detail === undefined) {
    return (
      <div className="page">
        <EmptyState icon="folder" title="没有可显示的项目" description="服务没有返回项目详情；本页不会伪造项目配置。" />
      </div>
    );
  }

  const project = detail.project;
  const unavailable = project.gitState === RepoGitState.PATH_UNAVAILABLE || project.gitState === RepoGitState.CAPABILITY_UNAVAILABLE;
  const startDisabledReason = project.archived ? '项目已取消管理，请先恢复管理后开始任务' : unavailable ? '项目路径或 Git 能力不可用：服务返回的 gitState 不允许在此开始任务。' : undefined;
  const docPaths = readDocPaths(project.settings);
  const integration = bootstrap.data?.integration;
  const integrationLoading = bootstrap.isLoading;
  const recentTasks = sortByUpdatedDesc(detail.tasks).slice(0, 5);
  const gitlabBaseUrl = bootstrap.data?.settings.git.gitlab.baseUrl;
  const gitStateDetail = detail.repos?.gitStateDetail;

  return (
    <div className="page project-detail-page">
      <div className="project-detail-head">
        <span className="tile">
          <Icon name={unavailable ? 'alert' : 'folder'} size="lg" />
        </span>
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="project-detail-title">
            <Link to="/projects" className="hint">项目</Link>
            <span className="hint">/</span>
            <h2>{project.name}</h2>
            <GitStateBadge gitState={project.gitState} />
            {project.archived ? <Badge tone="idle" icon="archive">已归档</Badge> : null}
          </div>
          <div className="project-detail-path">
            <Icon name="pin" size="sm" />
            <span className="mono">{project.rootPath}</span>
            <IconButton icon="copy" label="复制项目路径" onClick={() => { void copyPath(project); }} />
            {copyNotice === null ? null : <span className="hint" role="status">{copyNotice}</span>}
          </div>
        </div>
        <div className="project-detail-actions">
          {project.archived || unavailable ? (
            <Button variant="primary" size="sm" icon="plus" disabled disabledReason={startDisabledReason}>
              开始任务
            </Button>
          ) : (
            <LinkButton to={`/start?project=${encodeURIComponent(project.id)}`} variant="primary" size="sm" icon="plus">
              开始任务
            </LinkButton>
          )}
          {project.archived || unavailable ? (
            <Button variant="secondary" size="sm" icon="template" disabled disabledReason={startDisabledReason}>
              模板任务
            </Button>
          ) : (
            <LinkButton to={`/templates?project=${encodeURIComponent(project.id)}`} variant="secondary" size="sm" icon="template">
              模板任务
            </LinkButton>
          )}
          {project.gitState === RepoGitState.GIT ? (
            <LinkButton to={`/git/${encodeURIComponent(project.id)}`} variant="secondary" size="sm" icon="gitRepo">
              查看 Git
            </LinkButton>
          ) : (
            <Button variant="secondary" size="sm" icon="gitRepo" disabled disabledReason="项目不是可读取的 Git 仓库；没有 Git 工作台。">
              查看 Git
            </Button>
          )}
          <Button
            variant="secondary"
            size="sm"
            icon="refresh"
            disabled={recheckMutation.isPending}
            disabledReason={recheckMutation.isPending ? '正在重新检测项目，等待服务回执…' : undefined}
            onClick={() => { recheckMutation.mutate(); }}
          >
            {recheckMutation.isPending ? '检测中…' : '重新检测'}
          </Button>
        </div>
      </div>

      {project.archived ? (
        <div className="banner info" style={{ marginBottom: 14 }}>
          <Icon name="archive" />
          <div className="grow">项目已归档；仍可查看配置与历史任务，归档不移动或删除任何文件。</div>
        </div>
      ) : null}

      {bootstrap.isError ? (
        <div className="banner warn" role="alert" style={{ marginBottom: 14 }}>
          <Icon name="alert" />
          <div className="grow">
            <b>bootstrap 读取失败，集成状态未知。</b>
            <br />
            {errorMessage(bootstrap.error)}
          </div>
          <div className="actions">
            <Button variant="secondary" size="sm" icon="refresh" onClick={() => { void bootstrap.refetch(); }}>
              重试读取集成状态
            </Button>
          </div>
        </div>
      ) : null}

      <ReceiptNotice receipt={receipt} successMessage="项目已重新检测，列表与详情已刷新。" />
      {recheckMutation.isError ? <CommandErrorNotice error={recheckMutation.error} title="重新检测失败" /> : null}

      <nav className="tabs project-tabs" role="tablist" aria-label="项目详情">
        {TAB_ORDER.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            className="tab"
            aria-selected={tab === item.id}
            onClick={() => { selectTab(item.id); }}
          >
            {item.label}
            {item.id === 'charter' && charterQuery.data?.needsReconcile === true ? <span className="project-tab-dot" title="公约写入状态未明" aria-label="公约写入状态未明" /> : null}
          </button>
        ))}
      </nav>

      {tab === 'overview' ? (
        <div className="project-detail-grid">
          <div className="col" style={{ gap: 16 }}>
            <DetailSection title="项目信息" className="project-section">
              <dl className="kv">
                <dt>说明</dt>
                <dd>{project.description.trim().length === 0 ? <span className="muted">未填写</span> : project.description}</dd>
                <dt>当前分支</dt>
                <dd className="mono">{project.defaultBranch ?? '未知'}</dd>
                <dt>Git 状态</dt>
                <dd>{GIT_STATE_LABEL[project.gitState]}{gitStateDetail === undefined ? '' : ` · ${gitStateDetail}`}</dd>
                <dt>Git Provider</dt>
                <dd>{project.settings.gitProvider === undefined ? '继承全局默认' : PROVIDER_LABEL[project.settings.gitProvider]}</dd>
                <dt>默认流程方法</dt>
                <dd className="mono">{project.settings.defaultMethodId ?? '未设置（跟随目录默认）'}</dd>
                <dt>更新时间</dt>
                <dd>{formatDateTime(project.updatedAt)}</dd>
              </dl>
            </DetailSection>

            <section className="card" aria-label="最近任务">
              <div className="card-head">
                <span className="tile"><Icon name="list" /></span>
                <div className="grow">
                  <span className="section-title">最近任务</span>
                  <div className="hint" style={{ marginTop: 2 }}>{String(detail.tasks.length)} 个任务属于这个项目</div>
                </div>
                <LinkButton to={`/tasks?projectId=${encodeURIComponent(project.id)}`} variant="ghost" size="sm" iconAfter="chevRight">
                  任务列表
                </LinkButton>
              </div>
              <div className="card-body" style={{ padding: 6 }}>
                {recentTasks.length === 0 ? (
                  <p className="hint" style={{ padding: 16 }}>这个项目还没有任务；从「开始任务」创建第一个需求草稿。</p>
                ) : (
                  recentTasks.map((task) => <RecentTaskRow key={task.id} task={task} />)
                )}
              </div>
            </section>
          </div>

          <div className="col" style={{ gap: 16 }}>
            <ConfigStatusCard
              project={project}
              integration={integration}
              integrationLoading={integrationLoading}
              docPaths={docPaths}
              gitlabState={detail.repos?.gitlab}
              charter={charterQuery.data}
              charterLoading={charterQuery.isLoading}
              charterError={charterQuery.isError}
              onSelect={(next, section) => { selectTab(next, section); }}
            />
            <DetailSection title="相关入口" subtitle="项目配置之外，常用目录与设置。">
              <div className="col" style={{ gap: 8 }}>
                <LinkButton to={`/requirements?projectId=${encodeURIComponent(project.id)}`} variant="ghost" size="sm" icon="file">
                  这个项目的需求目录
                </LinkButton>
                <LinkButton to="/settings?section=git" variant="ghost" size="sm" icon="settings">
                  设置 · Git 账号
                </LinkButton>
                <LinkButton to="/settings?section=database" variant="ghost" size="sm" icon="db">
                  设置 · 数据库
                </LinkButton>
              </div>
            </DetailSection>
          </div>
        </div>
      ) : null}

      {tab === 'git' ? (
        <GitTab
          project={project}
          detailRepo={detail.repos}
          integration={integration}
          integrationLoading={integrationLoading}
          gitlabBaseUrl={gitlabBaseUrl}
          section={gitSection}
          onSectionChange={setGitSection}
        />
      ) : null}

      {tab === 'docs' ? <DocumentPathsTab project={project} /> : null}
      {tab === 'charter' ? (
        <CharterTab
          project={project}
          charter={charterQuery.data}
          loading={charterQuery.isLoading}
          error={charterQuery.error}
          onRetry={() => { void charterQuery.refetch(); }}
        />
      ) : null}
    </div>
  );
}
