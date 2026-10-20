import { PendingCommands } from '../components/PendingCommands.tsx';
import { useEffect, useRef } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { useBootstrap, useInboxLiveSummary } from '../api/hooks.ts';
import { StatusDot, type StatusDotTone } from '../components/Badge.tsx';
import { Button } from '../components/Button.tsx';
import { Icon } from '../components/Icon.tsx';
import { applyMotionPreference, resolveMotionPreference } from '../theme/motion.ts';
import { formatCount } from './format.ts';
import { activeNavId, breadcrumbsFor, findNavItem, NAV_GROUPS, shellHeaderPolicy, type BreadcrumbContext } from './navigation.ts';

interface RuntimeState {
  readonly tone: StatusDotTone;
  readonly label: string;
}

function runtimeState(connection: 'loading' | 'connected' | 'disconnected', opencodeStatus: string | undefined): RuntimeState {
  if (connection === 'loading') return { tone: 'muted', label: '正在连接' };
  if (connection === 'disconnected') return { tone: 'danger', label: '未连接 · 重试' };
  if (opencodeStatus === 'ready') return { tone: 'ok', label: '本地服务已连接' };
  if (opencodeStatus === 'starting') return { tone: 'warn', label: '正在启动 OpenCode' };
  return { tone: 'warn', label: '部分可用 · 未连接 OpenCode' };
}

export function Shell() {
  useInboxLiveSummary();
  const location = useLocation();
  const contentRef = useRef<HTMLDivElement>(null);
  const bootstrap = useBootstrap();

  const activeId = activeNavId(location.pathname);
  const activeItem = findNavItem(activeId);
  const header = shellHeaderPolicy(location.pathname, location.search);
  // Data-bearing breadcrumb levels come from real service data only.
  const gitProjectId = /^\/git\/([^/]+)$/.exec(location.pathname)?.[1];
  const recoveryTaskId = /^\/tasks\/([^/]+)\/recovery$/.exec(location.pathname)?.[1];
  const breadcrumbContext: BreadcrumbContext = {
    projectName: gitProjectId === undefined ? undefined : bootstrap.data?.projects.find((project) => project.id === gitProjectId)?.name,
    taskTitle: recoveryTaskId === undefined ? undefined : bootstrap.data?.tasks.find((task) => task.id === recoveryTaskId)?.title,
  };
  const crumbs = breadcrumbsFor(location.pathname, location.search, breadcrumbContext);
  const connection = bootstrap.isLoading ? 'loading' : bootstrap.isError ? 'disconnected' : 'connected';
  const opencodeStatus = bootstrap.data?.integration.opencode.status;
  const runtime = runtimeState(connection, opencodeStatus);
  const waitingUser = bootstrap.data?.counts.waitingUser;
  const serviceReducedMotion = bootstrap.data?.settings.ui.reducedMotion;

  useEffect(() => {
    contentRef.current?.scrollTo({ top: 0 });
  }, [location.pathname]);

  useEffect(() => {
    const leaf = crumbs[crumbs.length - 1]?.label ?? 'Agent Workflow';
    document.title = `${leaf} · Agent Workflow`;
  }, [crumbs]);

  // Consumer for settings.ui.reducedMotion: an explicit local choice wins,
  // otherwise the service configuration decides (see theme/motion.ts).
  useEffect(() => {
    applyMotionPreference(resolveMotionPreference(serviceReducedMotion));
  }, [serviceReducedMotion]);

  return (
    <div className="app">
      <nav className="nav" aria-label="主导航">
        <Link className="brand" to="/" aria-label="agent-workflow 主页">
          <span className="brand-mark">
            <Icon name="logo" />
          </span>
          <span style={{ minWidth: 0 }}>
            <span className="brand-name" style={{ fontSize: 12 }}>
              agent-workflow
            </span>
            <br />
            <span className="brand-sub">本地开发工作区</span>
          </span>
        </Link>
        <Link className="nav-cta" to="/start" aria-current={activeId === 'start' ? 'page' : undefined}>
          <Icon name="plus" />
          <span>开始任务</span>
        </Link>
        {NAV_GROUPS.map((group) => (
          <div key={group.caption}>
            <div className="nav-cap">{group.caption}</div>
            {group.items.map((item) => {
              const count = item.count === 'waitingUser' ? waitingUser : undefined;
              return (
                <Link
                  key={item.id}
                  className="nav-item"
                  to={item.href}
                  aria-current={activeId === item.id ? 'page' : undefined}
                >
                  <Icon name={item.icon} />
                  <span>{item.label}</span>
                  {count === undefined || count === 0 ? null : (
                    <span className="count" title={`${formatCount(count)} 项待处理`}>
                      {formatCount(count)}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        ))}
        <div className="nav-foot">
          <Link className="runtime-chip" to="/runtime">
            <StatusDot tone={runtime.tone} label={`运行环境：${runtime.label}`} />
            <span>
              <span>运行环境</span>
              <br />
              <span className="hint">{runtime.label}</span>
            </span>
          </Link>
        </div>
      </nav>

      <div className="main">
        {header.hidden ? null : (
          <header className="header">
            <h1>
              <Icon name={activeItem?.icon ?? (activeId === 'start' ? 'plus' : 'file')} />
              <span className="crumbs">
                {crumbs.map((crumb, index) => (
                  <span key={`${crumb.label}-${String(index)}`} className="row" style={{ gap: 6 }}>
                    {index > 0 ? <span className="sep">/</span> : null}
                    {crumb.to === undefined ? <span className="cur">{crumb.label}</span> : <Link to={crumb.to}>{crumb.label}</Link>}
                  </span>
                ))}
              </span>
            </h1>
            <div id="page-header-context" className="row" />
            <span className="spacer" />
            <div className="header-actions">
              <div id="page-header-actions" className="row" />
            </div>
          </header>
        )}

        {bootstrap.isError ? (
          <div className="connection-strip" role="alert">
            <Icon name="alert" size="sm" />
            <span className="grow">
              <b>服务未连接</b> · 无法读取任务、项目与设置数据
            </span>
            <Button
              variant="secondary"
              size="sm"
              icon="refresh"
              onClick={() => {
                void bootstrap.refetch();
              }}
            >
              重试
            </Button>
          </div>
        ) : null}

        <div className="content" ref={contentRef}>
          <PendingCommands /><Outlet />
        </div>
      </div>
    </div>
  );
}
