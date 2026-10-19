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
  type Project,
  type ProjectDetailResponse,
  type ProjectSettings,
  type RepoGitStateValue,
  type TaskSummary,
} from '@agent-workflow/shared';
import { apiGet, errorMessage, isApiClientError, request } from '../../api/client.ts';
import { classifyGitFailure, fetchGitRepo, gitKeys } from '../../api/git.ts';
import { queryKeys, useBootstrap } from '../../api/hooks.ts';
import { Badge, type BadgeTone } from '../../components/Badge.tsx';
import { Button, LinkButton } from '../../components/Button.tsx';
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

/**
 * `docPaths` is not part of the current shared ProjectSettings contract. Read it
 * defensively so a future/back-end extension can be shown without inventing data.
 */
function readDocPaths(settings: ProjectSettings): readonly string[] | undefined {
  const record = settings as unknown as Record<string, unknown>;
  const raw = record.docPaths;
  if (typeof raw === 'string') return raw.trim().length === 0 ? [] : [raw];
  if (!Array.isArray(raw)) return undefined;
  return raw.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

async function patchDocPaths(projectId: string, paths: readonly string[]): Promise<CommandResponse<ProjectDetailResponse>> {
  const response = await request<CommandResponse<ProjectDetailResponse>>(ROUTES.project(projectId), {
    method: 'PATCH',
    body: { requestKey: createRequestKey(), settings: { docPaths: [...paths] } },
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
          subtitle="仓库事实来自服务端 Git 读取接口；项目级仓库绑定与证据来源尚无接口。"
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

          <div className="banner warn" style={{ marginTop: 12 }}>
            <Icon name="lock" />
            <div className="grow">
              <b>项目级 GitLab 仓库绑定与证据来源暂未提供接口。</b>
              <br />
              证据来源（JUnit 报告 / 日志目录）需要服务端项目集成 / 证据来源契约；本页不展示可保存的表单，也不伪造绑定结果。
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

function DocumentPathsTab({ project }: { readonly project: Project }) {
  const queryClient = useQueryClient();
  const docPaths = useMemo(() => readDocPaths(project.settings), [project.settings]);
  const initial = docPaths?.join('\n') ?? '';
  const [draft, setDraft] = useState(initial);
  const [receipt, setReceipt] = useState<OperationReceipt | undefined>(undefined);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    setDraft(initial);
  }, [initial, project.id]);

  const mutation = useMutation({
    mutationFn: async (paths: readonly string[]) => patchDocPaths(project.id, paths),
    onSuccess: async (data) => {
      setReceipt(data.receipt);
      setError(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: projectDetailKey(project.id) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.projects }),
        queryClient.invalidateQueries({ queryKey: queryKeys.bootstrap }),
      ]);
    },
    onError: (caught) => { setError(caught); },
  });

  const lines = draft.split('\n').map((line) => line.trim()).filter((line) => line.length > 0);
  const preview = lines.map((line) => (line.startsWith('/') ? line : `${project.rootPath.replace(/\/+$/u, '')}/${line}`));
  const configured = docPaths !== undefined;
  const disabledReason = !configured
    ? '服务未在项目 settings 返回 docPaths；当前 PATCH 契约也不包含该字段，需要后端补充后才能保存。'
    : mutation.isPending
      ? '正在保存文档路径，等待服务回执…'
      : draft === initial
        ? '没有修改。'
        : undefined;

  return (
    <DetailSection
      title="文档路径"
      subtitle="任务产出的设计文档、变更说明会写到这里；相对路径基于项目目录，留空表示不生成。"
      aside={<Badge tone={configured ? 'ok' : 'idle'}>{configured ? '已配置' : '未配置'}</Badge>}
    >
      {!configured ? (
        <div className="banner warn">
          <Icon name="help" />
          <div className="grow">
            <b>服务未提供文档路径字段。</b>
            <br />
            当前项目 settings 没有 docPaths，上传/保存入口保持禁用；页面不会伪造保存成功。需要后端在项目设置契约中补充该字段。
          </div>
        </div>
      ) : null}

      <div className="field" style={{ margin: 0 }}>
        <label className="label" htmlFor="project-doc-paths">文档目录</label>
        <textarea
          id="project-doc-paths"
          className="textarea mono"
          rows={4}
          value={draft}
          disabled={!configured || mutation.isPending}
          placeholder="每行一个目录，例如 docs"
          onChange={(event) => { setDraft(event.target.value); }}
        />
        <span className="hint">每行一个路径；相对路径基于项目目录，留空表示不生成。</span>
      </div>

      {configured ? (
        <div className="project-doc-preview">
          实际位置：{preview.length === 0 ? '不生成项目文档' : preview.join('、')}
        </div>
      ) : null}

      <ReceiptNotice receipt={receipt} successMessage="文档路径已保存。" />
      {error === null ? null : <CommandErrorNotice error={error} title="文档路径未保存" />}

      <div className="project-doc-actions">
        <span className="hint grow">服务只保存路径，不会创建或移动目录。</span>
        <Button
          variant="ghost"
          size="sm"
          disabled={draft === initial || mutation.isPending}
          disabledReason={mutation.isPending ? '正在保存文档路径，等待服务回执…' : '没有修改。'}
          onClick={() => { setDraft(initial); }}
        >
          放弃修改
        </Button>
        <Button
          variant="primary"
          size="sm"
          icon="check"
          disabled={disabledReason !== undefined}
          disabledReason={disabledReason}
          onClick={() => { mutation.mutate(lines); }}
        >
          {mutation.isPending ? '保存中…' : '保存文档路径'}
        </Button>
      </div>
    </DetailSection>
  );
}

function CharterTab() {
  return (
    <DetailSection
      title="项目公约"
      subtitle="AGENTS.md 告诉执行中的智能体这个项目的约定；当前服务没有读取或生成接口。"
      aside={<Badge tone="unknown" icon="help">服务未提供</Badge>}
    >
      <div className="banner unknown">
        <Icon name="lock" />
        <div className="grow">
          <b>服务未提供项目公约生成接口。</b>
          <br />
          本页不会生成草稿、不会写入 AGENTS.md，也不会展示示例公约内容。生成、审阅与写入需要后端 charter 契约。
        </div>
      </div>

      <div className="project-charter-steps" aria-label="项目公约步骤（当前不可执行）">
        {[
          ['生成草稿', '根据项目结构与约定生成 AGENTS.md 草稿'],
          ['审阅差异', '对比当前公约，确认要写入的内容'],
          ['写入项目', '确认后才写入项目目录'],
        ].map(([title, description], index, all) => (
          <div className="project-charter-step pending" key={title}>
            <div className="rail" aria-hidden="true">
              <i>{String(index + 1)}</i>
              {index < all.length - 1 ? <b /> : null}
            </div>
            <div className="tx">
              <div className="t">{title}</div>
              <div className="hint">{description}</div>
            </div>
            <Badge tone="idle" icon="lock">待后端</Badge>
          </div>
        ))}
      </div>

      <div className="row" style={{ marginTop: 8, gap: 8, flexWrap: 'wrap' }}>
        <Button
          variant="primary"
          size="sm"
          icon="sparkle"
          disabled
          disabledReason="后端尚未提供项目公约（charter）生成接口；本页不会伪造生成结果。"
        >
          生成公约草稿
        </Button>
        <span className="hint">接口就绪前不会写入任何文件。</span>
      </div>
    </DetailSection>
  );
}

function ConfigStatusCard({
  project,
  integration,
  integrationLoading,
  docPaths,
  gitlabState,
  onSelect,
}: {
  readonly project: Project;
  readonly integration?: IntegrationStatus;
  readonly integrationLoading: boolean;
  readonly docPaths: readonly string[] | undefined;
  readonly gitlabState: GitConnectionStateValue | undefined;
  readonly onSelect: (tab: ProjectTab, gitSection?: GitSection) => void;
}) {
  const isGit = project.gitState === RepoGitState.GIT;
  const gitlabConfigured = integration?.git.gitlab.configured === true;
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
  const gitlabDetail = !isGit
    ? '非 Git 项目'
    : gitlabState === 'not_configured' && gitlabConfigured
      ? '全局 GitLab 已配置 · 证据来源未提供'
      : '证据来源配置服务未提供';

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
          detail={docPaths === undefined ? '服务未提供 docPaths 字段' : docPaths.length === 0 ? '已配置但为空' : docPaths.join('、')}
          tone={docPaths === undefined || docPaths.length === 0 ? 'idle' : 'ok'}
          status={docPaths === undefined || docPaths.length === 0 ? '未配置' : '已配置'}
          onSelect={() => { onSelect('docs'); }}
        />
        <ConfigItem
          icon="doc"
          label="项目公约"
          detail="待后端 charter 接口"
          tone="unknown"
          status="服务未提供"
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
  const startDisabledReason = unavailable ? '项目路径或 Git 能力不可用：服务返回的 gitState 不允许在此开始任务。' : undefined;
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
          {unavailable ? (
            <Button variant="primary" size="sm" icon="plus" disabled disabledReason={startDisabledReason}>
              开始任务
            </Button>
          ) : (
            <LinkButton to={`/start?project=${encodeURIComponent(project.id)}`} variant="primary" size="sm" icon="plus">
              开始任务
            </LinkButton>
          )}
          {unavailable ? (
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
            {item.id === 'charter' ? <span className="project-tab-dot" title="服务未提供接口" aria-label="服务未提供接口" /> : null}
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
                <LinkButton to="/tasks" variant="ghost" size="sm" iconAfter="chevRight">
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
      {tab === 'charter' ? <CharterTab /> : null}
    </div>
  );
}
