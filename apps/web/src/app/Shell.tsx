import { useEffect, useRef, useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { DisplayMode, THEMES, type DisplayModeValue } from '@agent-workflow/shared';
import { useBootstrap } from '../api/hooks.ts';
import { StatusDot, type StatusDotTone } from '../components/Badge.tsx';
import { Button } from '../components/Button.tsx';
import { Icon } from '../components/Icon.tsx';
import { SegmentedControl } from '../components/SegmentedControl.tsx';
import { useTheme } from '../theme/ThemeProvider.tsx';
import { formatCount } from './format.ts';
import { activeNavId, breadcrumbsFor, findNavItem, NAV_GROUPS } from './navigation.ts';

const DISPLAY_MODE_KEY = 'agent-workflow.display-mode';

function readDisplayMode(): DisplayModeValue {
  try {
    const value = window.localStorage.getItem(DISPLAY_MODE_KEY);
    if (value === DisplayMode.PRESENT || value === DisplayMode.REVIEW) return value;
  } catch {
    // Storage unavailable; fall back to the default display mode.
  }
  return DisplayMode.PRESENT;
}

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
  const location = useLocation();
  const contentRef = useRef<HTMLDivElement>(null);
  const bootstrap = useBootstrap();
  const { theme, cycleTheme } = useTheme();
  const [displayMode, setDisplayMode] = useState<DisplayModeValue>(() => readDisplayMode());

  const activeId = activeNavId(location.pathname);
  const activeItem = findNavItem(activeId);
  const crumbs = breadcrumbsFor(location.pathname);
  const connection = bootstrap.isLoading ? 'loading' : bootstrap.isError ? 'disconnected' : 'connected';
  const opencodeStatus = bootstrap.data?.integration.opencode.status;
  const runtime = runtimeState(connection, opencodeStatus);
  const waitingUser = bootstrap.data?.counts.waitingUser;

  useEffect(() => {
    contentRef.current?.scrollTo({ top: 0 });
  }, [location.pathname]);

  useEffect(() => {
    const leaf = crumbs[crumbs.length - 1]?.label ?? 'Agent Workflow';
    document.title = `${leaf} · Agent Workflow`;
  }, [crumbs]);

  const changeDisplayMode = (mode: DisplayModeValue) => {
    setDisplayMode(mode);
    try {
      window.localStorage.setItem(DISPLAY_MODE_KEY, mode);
    } catch {
      // Non-persistent toggle is still usable.
    }
  };

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
          <span className="spacer" />
          <div className="header-actions">
            <Link className="project-chip" to="/projects" title="项目">
              <Icon name="folder" size="sm" />
              <span>{bootstrap.data === undefined ? '项目' : `${formatCount(bootstrap.data.projects.length)} 个项目`}</span>
            </Link>
            <span className="conn-chip" title={bootstrap.isError ? '服务未连接' : '服务连接状态'}>
              <StatusDot
                tone={connection === 'connected' ? 'ok' : connection === 'loading' ? 'muted' : 'danger'}
                pulse={connection === 'loading'}
                label={connection === 'connected' ? '服务已连接' : connection === 'loading' ? '正在连接服务' : '服务未连接'}
              />
              <span>{connection === 'connected' ? '服务已连接' : connection === 'loading' ? '正在连接' : '服务未连接'}</span>
            </span>
            <SegmentedControl
              className="display-seg"
              ariaLabel="显示模式"
              value={displayMode}
              onChange={changeDisplayMode}
              options={[
                { value: DisplayMode.PRESENT, label: '展示' },
                { value: DisplayMode.REVIEW, label: '审阅' },
              ]}
            />
            <button
              type="button"
              className="header-theme"
              onClick={() => {
                cycleTheme();
              }}
              title="切换主题（下一套）"
            >
              <Icon name="sparkle" size="sm" />
              <span>{THEMES[theme].label}</span>
            </button>
          </div>
        </header>

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
          <Outlet />
        </div>
      </div>
    </div>
  );
}
