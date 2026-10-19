import { useMemo, useState, type ReactNode } from 'react';
import { RepoGitState, type ProjectSummary, type RepoGitStateValue } from '@agent-workflow/shared';
import { useProjects } from '../../api/hooks.ts';
import { Badge, type BadgeTone } from '../../components/Badge.tsx';
import { Button, LinkButton } from '../../components/Button.tsx';
import { PageHeader } from '../../components/Card.tsx';
import { EmptyState, Skeleton } from '../../components/EmptyState.tsx';
import { Icon } from '../../components/Icon.tsx';
import { SegmentedControl, type SegmentOption } from '../../components/SegmentedControl.tsx';
import { ServiceNotice } from '../../components/ServiceNotice.tsx';

const REGISTER_BLOCKED_REASON = '项目登记写入未在本批次接通：本页只读取 /api/projects；登记抽屉与写入流程由 Lead 安排后续接通。';

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

const GIT_STATE_ICON: Record<RepoGitStateValue, 'git' | 'folder' | 'alert' | 'help'> = {
  git: 'git',
  not_git: 'folder',
  path_unavailable: 'alert',
  capability_unavailable: 'help',
};

type GitFilter = 'all' | RepoGitStateValue;

function ProjectCard({ project }: { readonly project: ProjectSummary }) {
  const unavailable = project.gitState === RepoGitState.PATH_UNAVAILABLE || project.gitState === RepoGitState.CAPABILITY_UNAVAILABLE;
  return (
    <article className="card pad hoverable" aria-label={project.name} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="row" style={{ alignItems: 'flex-start', gap: 12 }}>
        <span className="tile lg">
          <Icon name={unavailable ? 'alert' : 'folder'} />
        </span>
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="row wrap" style={{ gap: 6 }}>
            <span style={{ fontSize: 14.5, fontWeight: 500 }}>{project.name}</span>
            {project.archived ? <Badge tone="idle" icon="archive">已归档</Badge> : null}
          </div>
          <div className="hint mono" style={{ marginTop: 3, overflowWrap: 'anywhere' }}>
            {project.rootPath}
          </div>
        </div>
        <Badge tone={GIT_STATE_TONE[project.gitState]} icon={GIT_STATE_ICON[project.gitState]}>
          {GIT_STATE_LABEL[project.gitState]}
        </Badge>
      </div>

      {project.description.trim().length === 0 ? null : (
        <p className="hint" style={{ lineHeight: 1.6 }}>
          {project.description}
        </p>
      )}

      <div className="grid-3" style={{ gap: 8 }}>
        <div>
          <div className="eyebrow">分支</div>
          <div className="mono" style={{ fontSize: 13 }}>
            {project.defaultBranch ?? '—'}
          </div>
        </div>
        <div>
          <div className="eyebrow">进行中任务</div>
          <div className="num" style={{ fontSize: 13 }}>
            {String(project.openTaskCount)} 个
          </div>
        </div>
        <div>
          <div className="eyebrow">需要处理</div>
          <div className="num" style={{ fontSize: 13, color: project.attentionCount > 0 ? 'var(--warn)' : undefined }}>
            {String(project.attentionCount)} 个
          </div>
        </div>
      </div>

      {project.remoteDisplayUrl === undefined ? null : (
        <div className="hint mono" style={{ overflowWrap: 'anywhere' }}>
          <Icon name="link" size="sm" /> {project.remoteDisplayUrl}
        </div>
      )}

      <div className="row wrap" style={{ gap: 8, marginTop: 'auto', paddingTop: 10, boxShadow: 'inset 0 1px 0 var(--line)' }}>
        <LinkButton to={`/requirements?projectId=${encodeURIComponent(project.id)}`} variant="secondary" size="sm" icon="file">
          需求目录
        </LinkButton>
        {unavailable ? (
          <Button
            variant="ghost"
            size="sm"
            icon="plus"
            disabled
            disabledReason="项目路径或 Git 能力不可用：服务返回的 gitState 不允许在此开始任务。"
          >
            开始任务
          </Button>
        ) : (
          <LinkButton to={`/start?project=${encodeURIComponent(project.id)}`} variant="ghost" size="sm" icon="plus">
            开始任务
          </LinkButton>
        )}
        <span className="spacer" />
        <span className="hint mono">{project.id}</span>
      </div>
    </article>
  );
}

export function ProjectsPage() {
  const projectsQuery = useProjects();
  const projects = projectsQuery.data ?? [];
  const [gitFilter, setGitFilter] = useState<GitFilter>('all');
  const [keyword, setKeyword] = useState('');

  const counts = useMemo(() => {
    const base: Record<GitFilter, number> = { all: projects.length, git: 0, not_git: 0, path_unavailable: 0, capability_unavailable: 0 };
    for (const project of projects) base[project.gitState] += 1;
    return base;
  }, [projects]);

  const filterOptions: readonly SegmentOption<GitFilter>[] = [
    { value: 'all', label: '全部', count: counts.all },
    { value: 'git', label: 'Git 仓库', count: counts.git },
    { value: 'not_git', label: '非 Git', count: counts.not_git },
    { value: 'path_unavailable', label: '路径不可用', count: counts.path_unavailable + counts.capability_unavailable },
  ];

  const filtered = useMemo(() => {
    const needle = keyword.trim().toLowerCase();
    return projects.filter((project) => {
      if (gitFilter === 'path_unavailable') {
        if (project.gitState !== RepoGitState.PATH_UNAVAILABLE && project.gitState !== RepoGitState.CAPABILITY_UNAVAILABLE) return false;
      } else if (gitFilter !== 'all' && project.gitState !== gitFilter) {
        return false;
      }
      if (needle.length === 0) return true;
      return [project.name, project.rootPath, project.description, project.id].join(' ').toLowerCase().includes(needle);
    });
  }, [gitFilter, keyword, projects]);

  let body: ReactNode;
  if (projectsQuery.isLoading) {
    body = (
      <div className="grid-2">
        {[0, 1].map((index) => (
          <div key={index} className="card pad" style={{ height: 236 }}>
            <div className="row" style={{ gap: 12 }}>
              <Skeleton width={44} height={44} radius={12} />
              <div className="col grow" style={{ gap: 6 }}>
                <Skeleton width="52%" height={14} />
                <Skeleton width="70%" height={11} />
              </div>
            </div>
            <Skeleton width="100%" height={54} />
          </div>
        ))}
      </div>
    );
  } else if (projectsQuery.isError) {
    body = (
      <ServiceNotice
        error={projectsQuery.error}
        onRetry={() => {
          void projectsQuery.refetch();
        }}
      />
    );
  } else if (projects.length === 0) {
    body = (
      <div className="card">
        <EmptyState
          icon="folder"
          title="还没有登记项目"
          description="登记一个本机项目目录后，就可以围绕它开始任务、配置 Git 与项目公约。当前页面只读取项目列表，登记写入尚未接通。"
          action={
            <Button variant="primary" icon="plus" disabled disabledReason={REGISTER_BLOCKED_REASON}>
              登记项目
            </Button>
          }
        />
      </div>
    );
  } else if (filtered.length === 0) {
    body = <EmptyState icon="search" title="没有匹配的项目" description="换个关键词，或清除筛选条件。" />;
  } else {
    body = (
      <div className="grid-2">
        {filtered.map((project) => (
          <ProjectCard key={project.id} project={project} />
        ))}
      </div>
    );
  }

  return (
    <div className="page">
      <PageHeader
        title="项目"
        lede="项目是任务、流程和配置的归属。选一个项目开始工作，或查看它的需求与运行状态。"
        actions={
          <Button variant="secondary" size="sm" icon="plus" disabled disabledReason={REGISTER_BLOCKED_REASON}>
            登记项目
          </Button>
        }
      />

      <div className="toolbar">
        <div className="input-wrap">
          <Icon name="search" />
          <input
            className="input ctl"
            placeholder="搜索名称、路径或说明"
            aria-label="搜索项目"
            value={keyword}
            onChange={(event) => {
              setKeyword(event.target.value);
            }}
          />
        </div>
        <SegmentedControl ariaLabel="Git 状态" options={filterOptions} value={gitFilter} onChange={setGitFilter} />
        <span className="spacer" />
        <span className="hint">
          共 {String(projects.length)} 个项目 · {String(counts.git)} 个 Git 仓库
        </span>
      </div>

      {body}
    </div>
  );
}
