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
import { SegmentedControl, type SegmentOption } from '../../components/SegmentedControl.tsx';
import { ServiceNotice } from '../../components/ServiceNotice.tsx';

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
type RegisterPhase = 'submitting' | 'failed' | 'unknown';

interface RegisterAttempt {
  readonly phase: RegisterPhase;
  readonly requestKey: string;
  readonly body: CreateProjectRequest;
  readonly message?: string;
}

function apiErrorDetail(error: unknown): string {
  if (error instanceof ApiClientError) return `${error.code ?? 'HTTP_ERROR'} · ${error.message}`;
  return errorMessage(error);
}

function ProjectCard({ project, busy, onArchive, onEdit, onRecheck }: { readonly project: ProjectSummary; readonly busy: boolean; readonly onArchive: () => void; readonly onEdit: () => void; readonly onRecheck: () => void }) {
  const navigate = useNavigate();
  const [copyMessage, setCopyMessage] = useState('');
  const unavailable = project.gitState === RepoGitState.PATH_UNAVAILABLE || project.gitState === RepoGitState.CAPABILITY_UNAVAILABLE;
  const cannotStart = project.archived || unavailable;
  return (
    <article className="card pad hoverable project-parity-card" role="link" tabIndex={0} onClick={(event) => { if (!(event.target instanceof Element) || event.target.closest('a,button,input,summary,details') === null) navigate(`/projects/${encodeURIComponent(project.id)}`); }} onKeyDown={(event) => { if (event.target === event.currentTarget && event.key === 'Enter') navigate(`/projects/${encodeURIComponent(project.id)}`); }} aria-label={project.name} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="row" style={{ alignItems: 'flex-start', gap: 12 }}>
        <span className="tile lg">
          <Icon name={unavailable ? 'alert' : 'folder'} />
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
        <Badge tone={GIT_STATE_TONE[project.gitState]} icon={GIT_STATE_ICON[project.gitState]}>
          {GIT_STATE_LABEL[project.gitState]}
        </Badge>
      </div>

      {unavailable ? <p className="banner warn"><Icon name="alert" size="sm" />{project.gitState === 'path_unavailable' ? '目录在本机找不到或不可访问。请取消管理后按新路径重新登记；文件不会被删除。' : 'Git 能力不可用，请检查运行环境后重新检测。'}</p> : null}
      {project.description.trim().length === 0 ? null : (
        <p className="hint" style={{ lineHeight: 1.6 }}>
          {project.description}
        </p>
      )}

      <div className="grid-2" style={{ gap: 8 }}>
        <div>
          <div className="eyebrow">当前分支</div>
          <div className="mono" style={{ fontSize: 13 }}>
            <ProjectBranchValue project={project} />
          </div>
        </div>
        <div>
          <div className="eyebrow">技术栈</div>
          <div style={{ fontSize: 13 }}><ProjectTechnologyValue project={project} /></div>
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

      {project.facts ? <p className="hint">事实检测于 {new Date(project.facts.technology.checkedAt).toLocaleString('zh-CN')} · 重新检测可更新</p> : <p className="hint">技术栈与当前分支待识别；可重新检测</p>}
      {project.remoteDisplayUrl === undefined ? null : (
        <div className="hint mono" style={{ overflowWrap: 'anywhere' }}>
          <Icon name="link" size="sm" /> {project.remoteDisplayUrl}
        </div>
      )}

      <div className="row wrap" style={{ gap: 8, marginTop: 'auto', paddingTop: 10, boxShadow: 'inset 0 1px 0 var(--line)' }}>
        <LinkButton to={`/requirements?projectId=${encodeURIComponent(project.id)}`} variant="secondary" size="sm" icon="file">
          需求目录
        </LinkButton>
        {cannotStart ? (
          <Button
            variant="ghost"
            size="sm"
            icon="plus"
            disabled
            disabledReason={project.archived ? '项目已取消管理，请先恢复管理后开始任务' : '项目路径或 Git 能力不可用：服务返回的 gitState 不允许在此开始任务。'}
          >
            开始任务
          </Button>
        ) : (
          <LinkButton to={`/start?project=${encodeURIComponent(project.id)}`} variant="ghost" size="sm" icon="plus">
            开始任务
          </LinkButton>
        )}
        {cannotStart ? (
          <Button
            variant="ghost"
            size="sm"
            icon="template"
            disabled
            disabledReason={project.archived ? '项目已取消管理，请先恢复管理后开始模板任务' : '项目路径或 Git 能力不可用：服务返回的 gitState 不允许在此开始模板任务。'}
          >
            模板任务
          </Button>
        ) : (
          <LinkButton to={`/templates?project=${encodeURIComponent(project.id)}`} variant="ghost" size="sm" icon="template">
            模板任务
          </LinkButton>
        )}
        <LinkButton to={`/projects/${encodeURIComponent(project.id)}`} variant="ghost" size="sm" iconAfter="chevRight">
          查看配置
        </LinkButton>
        <details className="project-more"><summary aria-label={`更多：${project.name}`}>⋯</summary><div className="card pad col"><Button variant="ghost" size="sm" icon="copy" onClick={() => { void navigator.clipboard.writeText(project.rootPath).then(() => setCopyMessage('目录已复制')).catch(() => setCopyMessage('复制失败，请从项目配置复制目录')); }}>复制目录</Button><Button variant="ghost" size="sm" icon="refresh" disabled={busy} disabledReason="项目操作尚未完成" onClick={onRecheck}>重新检测</Button><Button variant="ghost" size="sm" icon="edit" disabled={busy} disabledReason="项目操作尚未完成" onClick={onEdit}>编辑</Button><Button variant="ghost" size="sm" icon={project.archived ? 'refresh' : 'archive'} disabled={busy} disabledReason="项目操作尚未完成" onClick={onArchive}>{project.archived ? '恢复管理' : '取消管理…'}</Button></div></details>{copyMessage ? <span className="hint" role="status">{copyMessage}</span> : null}
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
  const [gitFilter, setGitFilter] = useState<GitFilter>('all');
  const [keyword, setKeyword] = useState('');

  const [registerOpen, setRegisterOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [name, setName] = useState('');
  const [rootPath, setRootPath] = useState('');
  const [description, setDescription] = useState('');
  const [attempt, setAttempt] = useState<RegisterAttempt | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const counts = useMemo(() => {
    const base: Record<GitFilter, number> = { all: projects.length, git: 0, not_git: 0, path_unavailable: 0, capability_unavailable: 0 };
    for (const project of projects) base[project.gitState] += 1;
    return base;
  }, [projects]);

  const filterOptions: readonly SegmentOption<GitFilter>[] = [
    { value: 'all', label: '全部', count: counts.all },
    { value: 'git', label: 'Git 仓库', count: counts.git },
    { value: 'not_git', label: '非 Git', count: counts.not_git },
    { value: 'path_unavailable', label: '路径不可用', count: counts.path_unavailable },
    { value: 'capability_unavailable', label: '能力不可用', count: counts.capability_unavailable },
  ];

  const filtered = useMemo(() => {
    const needle = keyword.trim().toLowerCase();
    return projects.filter((project) => {
      if (gitFilter !== 'all' && project.gitState !== gitFilter) return false;
      if (needle.length === 0) return true;
      return [project.name, project.rootPath, project.description, project.id].join(' ').toLowerCase().includes(needle);
    });
  }, [gitFilter, keyword, projects]);

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

  const submit = async (requestKey = createRequestKey(), body?: CreateProjectRequest) => {
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
      const outcomeUnknown = error instanceof ApiClientError && (error.kind === 'timeout' || error.kind === 'unavailable');
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
          description="登记一个本机项目目录后，就可以围绕它开始任务、配置 Git 与项目公约。登记不会移动或修改任何文件。"
          action={
            <Button variant="primary" icon="plus" onClick={openRegister}>
              登记第一个项目
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
          <ProjectCard key={project.id} project={project} busy={archiveProject.isPending || editProject.isPending || recheckProject.isPending} onArchive={() => { archiveProject.reset(); setArchiveCandidate(project); }} onRecheck={() => { recheckProject.mutate(project.id); }} onEdit={() => { setEditing({ id: project.id, name: project.name, description: project.description, testCommand: project.settings?.testCommand ?? '', gitProvider: project.settings?.gitProvider ?? '', defaultMethodId: project.settings?.defaultMethodId ?? '' }); }} />
        ))}
      </div>
    );
  }

  return (
    <div className="page">
      <Modal open={archiveCandidate !== null} title={archiveCandidate?.archived ? '恢复项目管理？' : '取消项目管理？'} onClose={() => { if (!archiveProject.isPending) setArchiveCandidate(null); }} footer={<><Button disabled={archiveProject.isPending} onClick={() => setArchiveCandidate(null)}>返回</Button><Button variant="primary" disabled={archiveProject.isPending || archiveProject.isError || archiveProject.data?.receipt.status === 'accepted' || archiveProject.data?.receipt.status === 'unknown'} disabledReason="请先核对原项目操作；不会重复提交" onClick={() => { if (archiveCandidate) archiveProject.mutate(archiveCandidate); }}>确认</Button></>}><p>{archiveCandidate?.name}</p><p className="mono-wrap">{archiveCandidate?.rootPath}</p><p>文件不会被删除或修改。历史任务与配置记录保留，取消管理后可按新路径重新登记。</p>{archiveProject.isError ? <ServiceNotice error={archiveProject.error} /> : null}{archiveProject.data && archiveProject.data.receipt.status !== 'succeeded' ? <p role="status">项目操作结果待核对，请从全局原操作记录重新读取；不会重复提交。</p> : null}</Modal>
      <PageHeader
        title="项目"
        lede="项目是任务、流程和配置的归属。选一个项目开始工作，或登记本机已有目录；登记不会移动或修改任何文件。"
        actions={
          <><Button variant="secondary" size="sm" icon={includeArchived ? 'eye' : 'archive'} onClick={() => { setIncludeArchived((value) => !value); }}>
            {includeArchived ? '隐藏已归档' : '显示已归档'}
          </Button>
          <Button variant="primary" size="sm" icon="plus" onClick={openRegister}>
            登记项目
          </Button></>
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
              disabledReason={issues.length > 0 ? `还缺：${issues.join('、')}` : submitting ? '登记中' : '结果未明，先按原请求核对'}
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

          <div className="field" style={{ margin: 0 }}>
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
    </div>
  );
}
