import type { IconName } from '../components/Icon.tsx';

export interface NavItem {
  readonly id: string;
  readonly label: string;
  readonly icon: IconName;
  readonly href: string;
  /** Which bootstrap counter is shown as a pill on this item. */
  readonly count?: 'waitingUser';
}

export interface NavGroup {
  readonly caption: string;
  readonly items: readonly NavItem[];
}

/**
 * Official product menu, same order/labels/icons as the design authority
 * (showcase/navigation.js + originals/main/assets/shell.js).
 */
export const NAV_GROUPS: readonly NavGroup[] = [
  {
    caption: '工作区',
    items: [
      { id: 'home', label: '主页', icon: 'home', href: '/' },
      { id: 'projects', label: '项目', icon: 'folder', href: '/projects' },
      { id: 'git', label: 'Git 仓库', icon: 'gitRepo', href: '/git' },
      { id: 'knowledge', label: '知识库', icon: 'book', href: '/knowledge' },
      { id: 'ppt', label: 'PPT 制作', icon: 'slides', href: '/ppt' },
    ],
  },
  {
    caption: '规划与执行',
    items: [
      { id: 'workflows', label: '流程', icon: 'flow', href: '/workflows' },
      { id: 'requirements', label: '需求目录', icon: 'file', href: '/requirements' },
      { id: 'tasks', label: '任务列表', icon: 'list', href: '/tasks' },
      { id: 'inbox', label: '待处理中心', icon: 'inbox', href: '/inbox', count: 'waitingUser' },
      { id: 'insights', label: '质量与用量', icon: 'chart', href: '/insights' },
      { id: 'templates', label: '模板任务', icon: 'template', href: '/templates' },
    ],
  },
  {
    caption: '系统',
    items: [
      { id: 'runtime', label: '运行环境', icon: 'server', href: '/runtime' },
      { id: 'tools', label: '工具与 Skill', icon: 'tool', href: '/tools' },
      { id: 'databases', label: '数据库', icon: 'db', href: '/databases' },
      { id: 'roles', label: '角色管理', icon: 'users', href: '/roles' },
      { id: 'settings', label: '设置', icon: 'settings', href: '/settings' },
    ],
  },
];

export const NAV_ITEMS: readonly NavItem[] = NAV_GROUPS.flatMap((group) => group.items);

export function findNavItem(id: string): NavItem | undefined {
  return NAV_ITEMS.find((item) => item.id === id);
}

/** Resolves the highlighted menu entry for a pathname. */
export function activeNavId(pathname: string): string {
  if (pathname === '/' || pathname.length === 0) return 'home';
  if (pathname === '/start') return 'start';
  if (pathname === '/tasks' || pathname.startsWith('/tasks/')) return 'tasks';
  // Run content is a task sub-view (W3-7d), so the task list stays highlighted.
  if (pathname.startsWith('/runs/')) return 'tasks';
  if (pathname === '/requirements' || pathname.startsWith('/requirement/')) return 'requirements';
  if (pathname === '/inbox' || pathname.startsWith('/inbox/')) return 'inbox';
  if (pathname === '/roles/legacy') return 'roles';
  const item = NAV_ITEMS.find((entry) => pathname === entry.href || pathname.startsWith(`${entry.href}/`));
  return item?.id ?? '';
}

export interface Crumb {
  readonly label: string;
  readonly to?: string;
}

/** Extra facts (resolved from real service data) for data-bearing breadcrumb levels. */
export interface BreadcrumbContext {
  readonly projectName?: string;
  readonly taskTitle?: string;
}

/**
 * Shell page-header policy (design v5 `REVIEW.md:31`): the header only carries
 * breadcrumb/page name + the current page's primary action.
 *
 * - `hidden`: the design page mounts with `header:''`, so the shell header must
 *   not render a title (the content `page-head` owns the only title).
 * - `headerActions`: the design page puts its primary action in the shell
 *   header, so the page's `PageHeader` actions are portalled there.
 */
export interface ShellHeaderPolicy {
  readonly hidden: boolean;
  readonly headerActions: boolean;
}

/** Routes whose design source is `DS.mount({header:''})`: no shell header title. */
function designHeaderEmpty(pathname: string, search: string): boolean {
  if (pathname === '/start' || pathname === '/tools') return true;
  if (pathname === '/knowledge' || pathname === '/projects' || pathname.startsWith('/projects/')) return true;
  if (pathname === '/roles' || pathname === '/roles/legacy') return true;
  if (pathname.startsWith('/runs/')) return true;
  if (/^\/tasks\/[^/]+$/.test(pathname)) return true;
  if (/^\/requirement\/[^/]+$/.test(pathname)) return true;
  if (/^\/workflows\/[^/]+\/edit$/.test(pathname)) return true;
  // `/ppt` renders the works library (`ppt-works.html`, header with breadcrumb);
  // `?work=<id>` renders the studio (`ppt-studio.html`, header:'').
  if (pathname === '/ppt') return new URLSearchParams(search).has('work');
  return false;
}

/** Routes whose design header carries the primary action (`tasks.html:115` etc.). */
function designHeaderActions(pathname: string): boolean {
  if (pathname === '/tasks') return true;
  if (pathname === '/workflows') return true;
  if (pathname === '/templates') return true;
  if (pathname === '/databases') return true;
  if (pathname === '/requirements') return true;
  if (pathname === '/runtime') return true;
  if (pathname === '/recovery') return true;
  return /^\/tasks\/[^/]+\/recovery$/.test(pathname);
}

export function shellHeaderPolicy(pathname: string, search = ''): ShellHeaderPolicy {
  const hidden = designHeaderEmpty(pathname, search);
  return { hidden, headerActions: !hidden && designHeaderActions(pathname) };
}

export function breadcrumbsFor(pathname: string, search = '', context: BreadcrumbContext = {}): readonly Crumb[] {
  if (pathname === '/') return [{ label: '主页' }];
  if (pathname === '/start') return [{ label: '开始任务' }];
  const recoveryMatch = /^\/tasks\/([^/]+)\/recovery$/.exec(pathname);
  if (recoveryMatch !== null) {
    return [
      { label: '任务列表', to: '/tasks' },
      { label: context.taskTitle ?? '原任务', to: `/tasks/${recoveryMatch[1] ?? ''}` },
      { label: '恢复' },
    ];
  }
  if (pathname === '/recovery') return [{ label: '任务列表', to: '/tasks' }, { label: '恢复' }];
  if (pathname.startsWith('/tasks/')) {
    return [{ label: '任务列表', to: '/tasks' }, { label: '任务画布' }];
  }
  if (pathname.startsWith('/runs/')) {
    return [{ label: '任务列表', to: '/tasks' }, { label: '运行内容' }];
  }
  if (pathname.startsWith('/requirement/')) {
    return [{ label: '需求目录', to: '/requirements' }, { label: '需求画布' }];
  }
  if (pathname === '/knowledge/history') {
    return [{ label: '知识库', to: '/knowledge' }, { label: '对话记录' }];
  }
  if (pathname === '/ppt') {
    const workId = new URLSearchParams(search).get('work');
    if (workId === null) return [{ label: 'PPT 制作' }, { label: '全部作品' }];
    return [{ label: 'PPT 制作' }, { label: '全部作品', to: '/ppt' }, { label: 'PPT 工作台' }];
  }
  const gitProjectMatch = /^\/git\/([^/]+)$/.exec(pathname);
  if (gitProjectMatch !== null) {
    return [{ label: 'Git 仓库', to: '/git' }, { label: context.projectName ?? '项目工作台' }];
  }
  if (pathname === '/requirements') {
    return [{ label: '任务列表', to: '/tasks' }, { label: '需求' }];
  }
  if (pathname === '/roles/legacy') {
    return [{ label: '角色管理', to: '/roles' }, { label: '历史配置' }];
  }
  const item = NAV_ITEMS.find((entry) => pathname === entry.href || pathname.startsWith(`${entry.href}/`));
  if (item !== undefined) return [{ label: item.label }];
  return [{ label: '页面不存在' }];
}
