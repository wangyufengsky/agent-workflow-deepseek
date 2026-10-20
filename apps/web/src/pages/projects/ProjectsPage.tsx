import {usePendingIdentity,pendingIdentityForPath,isUncertainCommandFailure} from '../../api/pending-identity.ts';
import { ProjectBranchValue, ProjectTechnologyValue } from './ProjectFacts.tsx';
import './projects.css';
import { useNavigate } from 'react-router-dom';
import { useMemo, useState, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ROUTES,
  RepoGitState,
  createRequestKey,
  type CommandResponse,
  type CreateProjectRequest,
  type OperationsByKeyResponse,
  type ProjectDetailResponse,
  type ProjectSummary,
  type RepoGitStateValue,
} from '@agent-workflow/shared';
import { ApiClientError, apiGet, apiPost, errorMessage, request } from '../../api/client.ts';
import { queryKeys, useProjects } from '../../api/hooks.ts';
import { Badge, type BadgeTone } from '../../components/Badge.tsx';
import { Button, LinkButton } from '../../components/Button.tsx';
import { PageHeader } from '../../components/Card.tsx';
import { Drawer } from '../../components/Drawer.tsx';
import { DirectoryPicker } from '../../components/DirectoryPicker.tsx';
import { Modal } from '../../components/Modal.tsx';
import { EmptyState, Skeleton } from '../../components/EmptyState.tsx';
import { Icon } from '../../components/Icon.tsx';
import { IconButton } from '../../components/IconButton.tsx';
import { SegmentedControl, type SegmentOption } from '../../components/SegmentedControl.tsx';
import { ServiceNotice } from '../../components/ServiceNotice.tsx';

/** P02-02：卡片徽标按设计「工作模式」文案（能力不可用作为真实状态保留原因）。 */
const GIT_MODE_LABEL: Record<RepoGitStateValue, string> = {
  git: 'Git 分支模式',
  not_git: '直接执行目录',
  path_unavailable: '路径不可用',
  capability_unavailable: '能力不可用',
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

/** P02-02：设计只有 全部 / Git 分支 / 直接目录 / 不可用 四段；两种不可用聚合为「不可用」。 */
type WorkModeFilter = 'all' | 'git' | 'direct' | 'unavailable';
function workModeOf(gitState: RepoGitStateValue): WorkModeFilter {
  if (gitState === RepoGitState.GIT) return 'git';
  if (gitState === RepoGitState.NOT_GIT) return 'direct';
  return 'unavailable';
}
type RegisterPhase = 'submitting' | 'failed' | 'unknown';

interface RegisterAttempt {
  readonly phase: RegisterPhase;
  readonly requestKey: string;
  readonly body?: CreateProjectRequest;
  readonly message?: string;
}

function apiErrorDetail(error: unknown): string {
  if (error instanceof ApiClientError) return `${error.code ?? 'HTTP_ERROR'} · ${error.message}`;
  return errorMessage(error);
}

function ProjectCard({ project, busy, onArchive, onEdit, onRecheck }: { readonly project: ProjectSummary; readonly busy: boolean; readonly onArchive: () => void; readonly onEdit: () => void; readonly onRecheck: () => void }) {
  const navigate = useNavigate();
  const [copyMessage, setCopyMessage] = useState('');
  /* P02-03：只有路径不可用才禁用开始/模板任务；Git 能力不可用由服务在准备阶段给出原因，不在入口假禁用。 */
  const pathUnavailable = project.gitState === RepoGitState.PATH_UNAVAILABLE;
  const cannotStart = project.archived || pathUnavailable;
  return (
    <article className="card pad hoverable project-parity-card" role="link" tabIndex={0} onClick={(event) => { if (!(event.target instanceof Element) || event.target.closest('a,button,input,summary,details') === null) navigate(`/projects/${encodeURIComponent(project.id)}`); }} onKeyDown={(event) => { if (event.target === event.currentTarget && event.key === 'Enter') navigate(`/projects/${encodeURIComponent(project.id)}`); }} aria-label={project.name} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="row" style={{ alignItems: 'flex-start', gap: 12 }}>
        <span className="tile lg">
          <Icon name={pathUnavailable ? 'alert' : 'folder'} />
        </span>
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="row wrap" style={{ gap: 6 }}>
            <span style={{ fontSize: 14.5, fontWeight: 500 }}>{project.name}</span>
            {project.archived ? (
              <Badge tone="idle" icon="archive">
                已归档
              </Badge>
            ) : null}
          </div>
          <div className="hint mono" title={project.rootPath} style={{ marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {project.rootPath}
          </div>
        </div>
        <div className="col" style={{ gap: 4, alignItems: 'flex-end' }}>
          <Badge tone={GIT_STATE_TONE[project.gitState]} icon={GIT_STATE_ICON[project.gitState]}>
            {GIT_MODE_LABEL[project.gitState]}
          </Badge>
          {project.attentionCount > 0 ? (
            <Badge tone="wait" icon="alert">{String(project.attentionCount)} 个需要处理</Badge>
          ) : null}
        </div>
      </div>

      {pathUnavailable ? <p className="banner warn"><Icon name="alert" size="sm" />目录在本机找不到或不可访问。请取消管理后按新路径重新登记；文件不会被删除。</p> : null}
      {project.gitState === RepoGitState.CAPABILITY_UNAVAILABLE ? <p className="banner info"><Icon name="info" size="sm" />Git 能力暂不可用（目录可读）：仍可开始任务形成需求草稿；工作区准备阶段若失败，服务会给出具体原因。</p> : null}
      {project.description.trim().length === 0 ? null : (
        <p className="hint" style={{ lineHeight: 1.6 }}>
          {project.description}
        </p>
      )}

      {/* P02-01：设计为三格单行（当前分支/技术栈/任务）。服务未返回任务总数与运行中数量（C1），
          任务格诚实写“N 个进行中”，不把“进行中”冒充任务总数。 */}
      <div className="pfacts">
        <div>
          <div className="k">当前分支</div>
          <div className="v mono">
            <ProjectBranchValue project={project} />
          </div>
        </div>
        <div>
          <div className="k">技术栈</div>
          <div className="v" ><ProjectTechnologyValue project={project} /></div>
        </div>
        <div>
          <div className="k">任务</div>
          <div className="v num" title="服务暂未返回任务总数与运行中数量">
            {String(project.openTaskCount)} 个进行中
          </div>
        </div>
      </div>

      {project.facts ? <p className="hint">事实检测于 {new Date(project.facts.technology.checkedAt).toLocaleString('zh-CN')} · 重新检测可更新</p> : <p className="hint">技术栈与当前分支待识别；可重新检测</p>}
      {project.remoteDisplayUrl === undefined ? null : (
        <div className="hint mono" style={{ overflowWrap: 'anywhere' }}>
          <Icon name="link" size="sm" /> {project.remoteDisplayUrl}
        </div>
      )}

      {/* P02-18：设计主操作「开始任务」为 secondary，模板任务 ghost，查看配置为文字提示；扩展操作收进更多菜单。 */}
      <div className="pfoot">
        {cannotStart ? (
          <Button
            variant="secondary"
            size="sm"
            icon="plus"
            disabled
            disabledReason={project.archived ? '项目已取消管理，请先恢复管理后开始任务' : '项目路径不可用：目录在本机找不到或不可访问，请取消管理后按新路径重新登记。'}
          >
            开始任务
          </Button>
        ) : (
          <LinkButton to={`/start?project=${encodeURIComponent(project.id)}`} variant="secondary" size="sm" icon="plus">
            开始任务
          </LinkButton>
        )}
        {cannotStart ? (
          <Button
            variant="ghost"
            size="sm"
            icon="template"
            disabled
            disabledReason={project.archived ? '项目已取消管理，请先恢复管理后开始模板任务' : '项目路径不可用：无法读取项目目录。'}
          >
            模板任务
          </Button>
        ) : (
          <LinkButton to={`/templates?project=${encodeURIComponent(project.id)}`} variant="ghost" size="sm" icon="template">
            模板任务
          </LinkButton>
        )}
        <span className="grow" />
        <LinkButton to={`/projects/${encodeURIComponent(project.id)}`} variant="ghost" size="sm" iconAfter="chevRight">
          查看配置
        </LinkButton>
        <details className="project-more"><summary aria-label={`更多：${project.name}`}>⋯</summary><div className="card pad col"><LinkButton to={`/projects/${encodeURIComponent(project.id)}`} variant="ghost" size="sm" icon="settings">查看配置</LinkButton><LinkButton to={`/requirements?projectId=${encodeURIComponent(project.id)}`} variant="ghost" size="sm" icon="file">需求目录</LinkButton><Button variant="ghost" size="sm" icon="copy" onClick={() => { void navigator.clipboard.writeText(project.rootPath).then(() => setCopyMessage('目录已复制')).catch(() => setCopyMessage('复制失败，请从项目配置复制目录')); }}>复制项目目录</Button><Button variant="ghost" size="sm" icon="refresh" disabled={busy} disabledReason="项目操作尚未完成" onClick={onRecheck}>重新检测</Button><Button variant="ghost" size="sm" icon="edit" disabled={busy} disabledReason="项目操作尚未完成" onClick={onEdit}>编辑</Button><Button variant="ghost" size="sm" icon={project.archived ? 'refresh' : 'archive'} disabled={busy} disabledReason="项目操作尚未完成" onClick={onArchive}>{project.archived ? '恢复管理' : '取消管理…'}</Button></div></details>{copyMessage ? <span className="hint" role="status">{copyMessage}</span> : null}
      </div>
    </article>
  );
}

export function ProjectsPage() {
  const queryClient = useQueryClient();
  const [archiveCandidate, setArchiveCandidate] = useState<ProjectSummary | null>(null);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [editing, setEditing] = useState<{ id: string; name: string; description: string; testCommand: string; gitProvider: '' | 'github' | 'gitlab'; defaultMethodId: string } | null>(null);
  const projectsQuery = useProjects(includeArchived);
  const projects = projectsQuery.data ?? [];
  const editProject = useMutation({
    mutationFn: async (input: { id: string; name: string; description: string; testCommand: string; gitProvider: '' | 'github' | 'gitlab'; defaultMethodId: string }) => {
      await request(`/api/projects/${encodeURIComponent(input.id)}`, {
        method: 'PATCH',
        body: {
          requestKey: createRequestKey(),
          name: input.name.trim(),
          description: input.description.trim(),
          settings: {
            testCommand: input.testCommand.trim(),
            ...(input.gitProvider === '' ? {} : { gitProvider: input.gitProvider }),
            ...(input.defaultMethodId === '' ? {} : { defaultMethodId: input.defaultMethodId }),
          },
        },
      });
    },
    onSuccess: async () => {
      setEditing(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.projects }),
        queryClient.invalidateQueries({ queryKey: ['bootstrap'] }),
      ]);
    },
  });
  const recheckProject = useMutation({
    mutationFn: async (projectId: string) => {
      await request(`/api/projects/${encodeURIComponent(projectId)}/recheck`, { method: 'POST', body: { requestKey: createRequestKey() } });
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.projects }),
        queryClient.invalidateQueries({ queryKey: ['bootstrap'] }),
      ]);
    },
  });
  const archiveProject = useMutation({
    mutationFn: async (project: ProjectSummary) => {
      return (await request<CommandResponse>(`/api/projects/${encodeURIComponent(project.id)}`, {
        method: 'PATCH',
        body: { requestKey: createRequestKey(), archived: !project.archived },
      })).data;
    },
    onSuccess: async (response) => {
      if (response.receipt.status === 'succeeded') setArchiveCandidate(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.projects }),
        queryClient.invalidateQueries({ queryKey: ['bootstrap'] }),
      ]);
    },
  });
  const [gitFilter, setGitFilter] = useState<WorkModeFilter>('all');
  const [keyword, setKeyword] = useState('');

  const [registerOpen, setRegisterOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [name, setName] = useState('');
  const [rootPath, setRootPath] = useState('');
  const [description, setDescription] = useState('');
  const [localAttempt, setAttempt] = useState<RegisterAttempt | null>(null);
  const pendingRegister=usePendingIdentity(ROUTES.projects);
  const attempt:RegisterAttempt|null=pendingRegister?{...(localAttempt?.requestKey===pendingRegister.requestKey?localAttempt:{}),phase:pendingRegister.phase==='sending'?'submitting':'unknown',requestKey:pendingRegister.requestKey,message:localAttempt?.requestKey===pendingRegister.requestKey?localAttempt.message:'原登记请求尚未结算，请按原请求核对。'}:localAttempt;
  const [notice, setNotice] = useState<string | null>(null);
  /** P02-07：登记抽屉脏关闭确认。 */
  const [leaveRegister, setLeaveRegister] = useState(false);
  const registerDirty = rootPath.trim() !== '' || name.trim() !== '' || description.trim() !== '';

  const counts = useMemo(() => {
    const base: Record<WorkModeFilter, number> = { all: projects.length, git: 0, direct: 0, unavailable: 0 };
    for (const project of projects) base[workModeOf(project.gitState)] += 1;
    return base;
  }, [projects]);

  /** P02-02：设计四段「全部 / Git 分支 / 直接目录 / 不可用」，aria-label=工作模式。 */
  const filterOptions: readonly SegmentOption<WorkModeFilter>[] = [
    { value: 'all', label: '全部', count: counts.all },
    { value: 'git', label: 'Git 分支', count: counts.git },
    { value: 'direct', label: '直接目录', count: counts.direct },
    { value: 'unavailable', label: '不可用', count: counts.unavailable },
  ];

  const filtered = useMemo(() => {
    const needle = keyword.trim().toLowerCase();
    return projects.filter((project) => {
      if (gitFilter !== 'all' && workModeOf(project.gitState) !== gitFilter) return false;
      if (needle.length === 0) return true;
      return [project.name, project.rootPath, project.description, project.id].join(' ').toLowerCase().includes(needle);
    });
  }, [gitFilter, keyword, projects]);
  const clearFilters = () => { setKeyword(''); setGitFilter('all'); };

  const issues: string[] = [];
  if (name.trim().length === 0) issues.push('项目名称');
  if (rootPath.trim().length === 0) issues.push('项目目录');
  else if (!rootPath.trim().startsWith('/')) issues.push('项目目录需要是绝对路径');
  const submitting = attempt?.phase === 'submitting';
  const unknown = attempt?.phase === 'unknown';
  const canSubmit = issues.length === 0 && !submitting && !unknown;

  const openRegister = () => {
    setRegisterOpen(true);
    setAttempt(null);
  };

  const applyRootPath = (next: string) => {
    setRootPath(next);
    if (name.trim().length === 0) {
      const base = next.split('/').filter(Boolean).at(-1);
      if (base !== undefined) setName(base);
    }
  };

  const pickDirectory = () => {
    const desktop = window.workflowDesktop;
    if (desktop === undefined) {
      setPickerOpen(true);
      return;
    }
    void desktop.pickDirectory().then((picked) => {
      if (picked !== undefined && picked !== '') applyRootPath(picked);
    }).catch(() => { setPickerOpen(true); });
  };

  const resetForm = () => {
    setName('');
    setRootPath('');
    setDescription('');
    setAttempt(null);
  };

  const submit = async (suppliedKey?:string, body?: CreateProjectRequest) => {
    const existing=pendingIdentityForPath(ROUTES.projects);
    if(existing){setAttempt({phase:'unknown',requestKey:existing.requestKey,message:'原登记请求尚未结算，请先核对。'});return;}
    const requestKey=suppliedKey??createRequestKey();
    const payload: CreateProjectRequest =
      body ?? {
        requestKey,
        name: name.trim(),
        rootPath: rootPath.trim(),
        ...(description.trim().length === 0 ? {} : { description: description.trim() }),
      };
    setAttempt({ phase: 'submitting', requestKey, body: payload });
    try {
      const response = await apiPost<CommandResponse<ProjectDetailResponse>>(ROUTES.projects, payload);
      const status = response.data.receipt.status;
      if (status === 'succeeded') {
        const project = response.data.resource?.project;
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: queryKeys.projects }),
          queryClient.invalidateQueries({ queryKey: queryKeys.bootstrap }),
        ]);
        setNotice(
          project === undefined
            ? '项目已登记；列表已刷新。'
            : `已登记项目：${project.name}（${project.rootPath}）。登记不会移动或修改任何文件。`,
        );
        setRegisterOpen(false);
        resetForm();
      } else if (status === 'failed') {
        setAttempt({
          phase: 'failed',
          requestKey,
          body: payload,
          message: response.data.receipt.error?.message ?? '服务返回失败回执，项目没有登记。',
        });
      } else {
        setAttempt({
          phase: 'unknown',
          requestKey,
          body: payload,
          message: '登记请求已发出，但服务只返回 accepted / unknown 回执，尚未确认结果。',
        });
      }
    } catch (error) {
      // A timeout/unavailable error leaves the outcome unknown: the project may
      // still have been registered. Never resend automatically.
      const outcomeUnknown = isUncertainCommandFailure(error);
      setAttempt({
        phase: outcomeUnknown ? 'unknown' : 'failed',
        requestKey,
        body: payload,
        message: outcomeUnknown ? '请求没有收到回执，登记结果未明。' : apiErrorDetail(error),
      });
    }
  };

  const reconcile = async () => {
    if (attempt === null) return;
    try {
      const response = await apiGet<OperationsByKeyResponse>(ROUTES.operationsByKey(attempt.requestKey));
      const operation = response.data.operation;
      if (operation.status === 'succeeded') {
        const outcome = operation.outcome ?? {};
        const projectId = typeof outcome.projectId === 'string' ? outcome.projectId : operation.target.projectId;
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: queryKeys.projects }),
          queryClient.invalidateQueries({ queryKey: queryKeys.bootstrap }),
        ]);
        setNotice(projectId === undefined ? '按原请求核对：项目已登记。' : `按原请求核对：项目已登记（${projectId}）。`);
        setRegisterOpen(false);
        resetForm();
      } else if (operation.status === 'failed') {
        setAttempt({ ...attempt, phase: 'failed', message: operation.error?.message ?? '按原请求核对：登记失败。' });
      } else {
        setAttempt({ ...attempt, phase: 'unknown', message: '核对后仍未确认结果；不会自动重复登记。' });
      }
    } catch (error) {
      setAttempt({ ...attempt, message: `核对失败：${apiErrorDetail(error)}` });
    }
  };

  let body: ReactNode;
  if (projectsQuery.isLoading) {
    body = (
      <div className="project-grid">
        {[0, 1, 2, 3].map((index) => (
          <div key={index} className="card pad" style={{ height: 240 }}>
            <div className="row" style={{ gap: 12 }}>
              <Skeleton width={36} height={36} radius={10} />
              <div className="col grow" style={{ gap: 6 }}>
                <Skeleton width="55%" height={14} />
                <Skeleton width="70%" height={11} />
              </div>
            </div>
            <Skeleton width="100%" height={12} />
            <Skeleton width="100%" height={56} />
          </div>
        ))}
      </div>
    );
  } else if (projectsQuery.isError) {
    /* P02-08：按设计给"项目列表读取失败"专用文案，并安抚已登记项目未受影响。 */
    body = (
      <div className="banner danger" role="alert">
        <Icon name="alert" />
        <div className="grow">
          <b>项目列表读取失败</b>
          <br />
          本地服务没有返回项目摘要。已登记的项目没有受影响。
          <br />
          <span className="hint">{errorMessage(projectsQuery.error)}</span>
        </div>
        <div className="actions">
          <Button variant="secondary" size="sm" icon="refresh" onClick={() => { void projectsQuery.refetch(); }}>重试</Button>
        </div>
      </div>
    );
  } else if (projects.length === 0) {
    body = (
      <div className="card">
        <EmptyState
          icon="folder"
          title="还没有登记项目"
          description="登记一个本机项目目录后，就可以围绕它开始任务、配置 Git 与项目公约。"
          action={
            <Button variant="primary" icon="plus" onClick={openRegister}>
              登记第一个项目
            </Button>
          }
        />
      </div>
    );
  } else if (filtered.length === 0) {
    /* P02-16：无匹配空态按设计包 card 并提供恢复动作。 */
    body = (
      <div className="card">
        <EmptyState
          icon="search"
          title="没有匹配的项目"
          description="换个关键词，或清除筛选条件。"
          action={<Button variant="secondary" size="sm" onClick={clearFilters}>清除筛选</Button>}
        />
      </div>
    );
  } else {
    body = (
      <div className="project-grid">
        {filtered.map((project) => (
          <ProjectCard key={project.id} project={project} busy={archiveProject.isPending || editProject.isPending || recheckProject.isPending} onArchive={() => { archiveProject.reset(); setArchiveCandidate(project); }} onRecheck={() => { recheckProject.mutate(project.id); }} onEdit={() => { setEditing({ id: project.id, name: project.name, description: project.description, testCommand: project.settings?.testCommand ?? '', gitProvider: project.settings?.gitProvider ?? '', defaultMethodId: project.settings?.defaultMethodId ?? '' }); }} />
        ))}
      </div>
    );
  }
  const showToolbar = !projectsQuery.isLoading && !projectsQuery.isError && projects.length > 0;

  return (
    <div className="page">
      <Modal
        open={archiveCandidate !== null}
        title={archiveCandidate?.archived ? '恢复项目管理？' : '取消管理这个项目？'}
        onClose={() => { if (!archiveProject.isPending) setArchiveCandidate(null); }}
        footer={
          <>
            <Button variant="ghost" disabled={archiveProject.isPending} onClick={() => setArchiveCandidate(null)}>{archiveCandidate?.archived ? '取消' : '保留'}</Button>
            <span className="spacer" />
            <Button
              variant={archiveCandidate?.archived ? 'primary' : 'danger'}
              disabled={archiveProject.isPending || archiveProject.isError || archiveProject.data?.receipt.status === 'accepted' || archiveProject.data?.receipt.status === 'unknown'}
              disabledReason="请先核对原项目操作；不会重复提交"
              onClick={() => { if (archiveCandidate) archiveProject.mutate(archiveCandidate); }}
            >
              {archiveCandidate?.archived ? '恢复管理' : '取消管理'}
            </Button>
          </>
        }
      >
        <p className="mono-wrap">{archiveCandidate?.rootPath}</p>
        {archiveCandidate?.archived ? (
          <p>将重新显示 <b>{archiveCandidate?.name}</b>；不会移动或修改项目目录中的文件。</p>
        ) : (
          <p>opencode-workflow 将不再显示 <b>{archiveCandidate?.name}</b>，已有任务记录保留。项目目录 <span className="mono">{archiveCandidate?.rootPath}</span> 中的文件<b>不会</b>被删除或修改。</p>
        )}
        {archiveProject.isError ? <ServiceNotice error={archiveProject.error} /> : null}
        {archiveProject.data && archiveProject.data.receipt.status !== 'succeeded' ? <p role="status">项目操作结果待核对，请从全局原操作记录重新读取；不会重复提交。</p> : null}
      </Modal>
      <PageHeader
        title="项目"
        lede="项目是任务、流程和配置的归属。选一个项目开始工作，或进入查看它的配置。"
        actions={
          <Button variant="primary" size="sm" icon="plus" onClick={openRegister}>
            登记项目
          </Button>
        }
      />

      {editProject.isError ? <p className="hint" style={{ marginBottom: 12, color: 'var(--danger)' }}>{errorMessage(editProject.error)}</p> : null}
      {recheckProject.isError ? <p className="hint" style={{ marginBottom: 12, color: 'var(--danger)' }}>重新检测失败：{errorMessage(recheckProject.error)}</p> : null}
      {notice === null ? null : (
        <div className="banner ok" role="status" style={{ marginBottom: 14 }}>
          <Icon name="check" />
          <div className="grow">{notice}</div>
          <div className="actions">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setNotice(null);
              }}
            >
              知道了
            </Button>
          </div>
        </div>
      )}

      {unknown && !registerOpen ? (
        <div className="banner unknown" role="alert" style={{ marginBottom: 14 }}>
          <Icon name="help" />
          <div className="grow">
            <b>项目登记结果未明</b>
            <br />
            {attempt?.message ?? '请求已发出但没有收到确认。'}按原请求核对，不会重复登记。
          </div>
          <div className="actions">
            <Button variant="secondary" size="sm" icon="refresh" onClick={() => void reconcile()}>
              按原请求核对
            </Button>
          </div>
        </div>
      ) : null}

      {showToolbar ? (
        <div className="toolbar">
          <div className="input-wrap project-search">
            <Icon name="search" />
            <input
              className="input ctl"
              placeholder="搜索名称或路径"
              aria-label="搜索项目"
              value={keyword}
              onChange={(event) => {
                setKeyword(event.target.value);
              }}
            />
          </div>
          <SegmentedControl ariaLabel="工作模式" options={filterOptions} value={gitFilter} onChange={setGitFilter} />
          <span className="spacer" />
          <Button variant="ghost" size="sm" icon={includeArchived ? 'eye' : 'archive'} onClick={() => { setIncludeArchived((value) => !value); }}>
            {includeArchived ? '隐藏已归档' : '显示已归档'}
          </Button>
          <IconButton icon="refresh" label="刷新项目列表" disabled={projectsQuery.isFetching} onClick={() => { void projectsQuery.refetch(); }} />
        </div>
      ) : null}

      {body}

      <Modal
        open={editing !== null}
        title="编辑项目"
        onClose={() => { setEditing(null); }}
        footer={
          <>
            <Button variant="ghost" onClick={() => { setEditing(null); }}>取消</Button>
            <span className="spacer" />
            <Button
              variant="primary"
              icon="check"
              disabled={editProject.isPending || (editing?.name.trim().length ?? 0) === 0}
              onClick={() => { if (editing !== null) editProject.mutate(editing); }}
            >
              {editProject.isPending ? '保存中…' : '保存'}
            </Button>
          </>
        }
      >
        {editing === null ? null : (
          <div className="stack-loose">
            <label className="form-label">
              名称
              <input className="input" value={editing.name} maxLength={120} onChange={(event) => { setEditing({ ...editing, name: event.target.value }); }} />
            </label>
            <label className="form-label">
              说明
              <textarea className="textarea" value={editing.description} maxLength={2000} onChange={(event) => { setEditing({ ...editing, description: event.target.value }); }} />
            </label>
            <label className="form-label">
              默认测试命令（项目级）
              <input className="input mono" value={editing.testCommand} maxLength={500} placeholder="例如 npm test" onChange={(event) => { setEditing({ ...editing, testCommand: event.target.value }); }} />
            </label>
            <label className="form-label">
              Git Provider
              <select className="select" value={editing.gitProvider} onChange={(event) => { setEditing({ ...editing, gitProvider: event.target.value as '' | 'github' | 'gitlab' }); }}>
                <option value="">跟随全局</option>
                <option value="github">GitHub</option>
                <option value="gitlab">GitLab</option>
              </select>
            </label>
            <p className="hint">测试命令用于节点执行/修复校验（受白名单与超时约束）；留空时跟随全局默认。</p>
          </div>
        )}
      </Modal>

      <Drawer
        open={registerOpen}
        title="登记项目"
        size="md"
        onClose={() => {
          if (submitting) return;
          if (registerDirty && !unknown && attempt === null) { setLeaveRegister(true); return; }
          setRegisterOpen(false);
          if (!unknown) resetForm();
        }}
        footer={
          <>
            <span className="hint grow">
              {submitting
                ? '正在登记，请稍候…'
                : unknown
                  ? '结果未明：按原请求核对后才能再次提交'
                  : issues.length > 0
                    ? `还缺：${issues.join('、')}`
                    : '登记后可以立即开始任务。'}
            </span>
            <Button
              variant="ghost"
              onClick={() => {
                if (submitting) return;
                if (registerDirty && !unknown) { setLeaveRegister(true); return; }
                setRegisterOpen(false);
                if (!unknown) resetForm();
              }}
              disabled={submitting}
            >
              取消
            </Button>
            <Button
              variant="primary"
              icon="check"
              disabled={!canSubmit}
              disabledReason={unknown?'结果未明，先按原请求核对':submitting?'登记中':issues.length>0?`还缺：${issues.join('、')}`:undefined}
              onClick={() => {
                void submit();
              }}
            >
              {submitting ? '登记中…' : '登记项目'}
            </Button>
          </>
        }
      >
        <div className="col" style={{ gap: 16 }}>
          {attempt?.phase === 'failed' ? (
            <div className="banner danger" role="alert">
              <Icon name="alert" />
              <div className="grow">
                <b>项目没有登记</b>
                <br />
                {attempt.message ?? '未知错误'}。修改输入后重新提交会使用新的 requestKey。
              </div>
            </div>
          ) : null}

          {unknown ? (
            <div className="banner unknown" role="alert">
              <Icon name="help" />
              <div className="grow">
                <b>登记结果未明</b>
                <br />
                {attempt?.message ?? '请求已发出但没有收到确认。'}
                <br />
                <span className="mono" style={{ fontSize: 11.5 }}>
                  requestKey {attempt?.requestKey}
                </span>
              </div>
              <div className="actions">
                <Button variant="secondary" size="sm" icon="refresh" onClick={() => void reconcile()}>
                  按原请求核对
                </Button>
              </div>
            </div>
          ) : null}

          <p className="hint" style={{ lineHeight: 1.65 }}>
            把本机已有的项目目录接入 opencode-workflow。登记会读取目录的 Git 状态并保存路径与名称，不会移动或修改任何文件。
          </p>

          <div className="field" style={{ margin: 0 }}>
            <label className="label" htmlFor="project-path">
              项目目录 <span className="req">*</span>
            </label>
            <div className="row" style={{ gap: 8 }}>
              <input
                id="project-path"
                className="input mono grow"
                value={rootPath}
                disabled={submitting || unknown}
                placeholder="/Users/you/workspace/my-project"
                onChange={(event) => { applyRootPath(event.target.value); }}
              />
              <Button variant="secondary" size="sm" icon="folder" disabled={submitting || unknown} onClick={pickDirectory}>
                选择文件夹…
              </Button>
            </div>
            <span className="hint">可直接输入绝对路径，或点「选择文件夹…」浏览本机目录；桌面版会打开系统文件夹选择器。设置了允许项目根目录时，目录必须存在且真实路径在允许范围内；未限制时，不存在路径可登记为路径不可用。</span>
          </div>

          <div className="field" style={{ margin: 0 }}>
            <label className="label" htmlFor="project-name">
              项目名称 <span className="req">*</span>
            </label>
            <input
              id="project-name"
              className="input"
              value={name}
              disabled={submitting || unknown}
              placeholder="选择目录后自动填入，可修改"
              onChange={(event) => {
                setName(event.target.value);
              }}
            />
          </div>

          <details className="field" style={{ margin: 0 }} open>
            <summary className="label" style={{ cursor: 'pointer' }}>更多（可选）</summary>
            <div className="field" style={{ marginTop: 12 }}>
              <label className="label" htmlFor="project-description">
                说明 <span className="opt">可选</span>
              </label>
              <textarea
                id="project-description"
                className="textarea"
                style={{ minHeight: 90 }}
                value={description}
                disabled={submitting || unknown}
                onChange={(event) => {
                  setDescription(event.target.value);
                }}
              />
            </div>
            <p className="hint">文档目录：创建接口暂不支持 settings（C1 契约缺口），登记后到项目详情「文档路径」页签配置；留空则不生成项目文档。</p>
          </details>

          <div className="banner info">
            <Icon name="info" />
            <div className="grow">
              登记是一个写操作：成功后会刷新项目列表；如果结果未明，页面只用原 requestKey 通过 GET /api/operations/:key 核对，不会自动重发。
            </div>
          </div>
        </div>
      </Drawer>

      <DirectoryPicker
        open={pickerOpen}
        initialPath={rootPath.trim() === '' ? undefined : rootPath.trim()}
        onClose={() => { setPickerOpen(false); }}
        onSelect={applyRootPath}
      />

      <Modal
        open={leaveRegister}
        title="放弃未登记的内容？"
        onClose={() => setLeaveRegister(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setLeaveRegister(false)}>继续填写</Button>
            <span className="spacer" />
            <Button variant="danger" onClick={() => { setLeaveRegister(false); setRegisterOpen(false); resetForm(); }}>放弃</Button>
          </>
        }
      >
        你填写的目录和名称还没有登记，关闭后不会保留。
      </Modal>
    </div>
  );
}
