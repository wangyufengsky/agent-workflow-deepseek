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

export function breadcrumbsFor(pathname: string): readonly Crumb[] {
  if (pathname === '/') return [{ label: '主页' }];
  if (pathname === '/start') return [{ label: '开始任务' }];
  if (pathname.startsWith('/tasks/')) {
    return [{ label: '任务列表', to: '/tasks' }, { label: '任务画布' }];
  }
  if (pathname.startsWith('/runs/')) {
    return [{ label: '任务列表', to: '/tasks' }, { label: '运行内容' }];
  }
  if (pathname.startsWith('/requirement/')) {
    return [{ label: '需求目录', to: '/requirements' }, { label: '需求画布' }];
  }
  if (pathname === '/roles/legacy') {
    return [{ label: '角色管理', to: '/roles' }, { label: '历史配置' }];
  }
  const item = NAV_ITEMS.find((entry) => pathname === entry.href || pathname.startsWith(`${entry.href}/`));
  if (item !== undefined) return [{ label: item.label }];
  return [{ label: '页面' }];
}
