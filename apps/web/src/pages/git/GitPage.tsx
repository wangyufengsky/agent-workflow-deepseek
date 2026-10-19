import { useParams } from 'react-router-dom';
import './git.css';
import { GitOverview } from './GitOverview.tsx';
import { RepoWorkbench } from './RepoWorkbench.tsx';

/**
 * Git 仓库页入口。
 * 建议路由：
 * - `/git` → 仓库概览（未选项目）
 * - `/git/:projectId` → 项目工作台
 * 路由本身由 Lead 在 App.tsx 接线；本组件只读 URL 中的 projectId。
 */
export function GitPage() {
  const { projectId } = useParams<{ projectId?: string }>();
  if (projectId === undefined || projectId.length === 0) {
    return <GitOverview />;
  }
  return <RepoWorkbench key={projectId} projectId={projectId} />;
}
