import { Route, Routes } from 'react-router-dom';
import { HomePage } from '../pages/home/HomePage.tsx';
import { SettingsPage } from '../pages/settings/SettingsPage.tsx';
import { TasksPage } from '../pages/tasks/TasksPage.tsx';
import { InboxPage } from '../pages/inbox/InboxPage.tsx';
import { RequirementsPage } from '../pages/requirements/RequirementsPage.tsx';
import { TemplatesPage } from '../pages/templates/TemplatesPage.tsx';
import { RolesPage } from '../pages/roles/RolesPage.tsx';
import { DatabasesPage } from '../pages/databases/DatabasesPage.tsx';
import { ToolsPage } from '../pages/tools/ToolsPage.tsx';
import { KnowledgePage } from '../pages/knowledge/KnowledgePage.tsx';
import { PptPage } from '../pages/ppt/PptPage.tsx';
import { ProjectsPage } from '../pages/projects/ProjectsPage.tsx';
import { RecoveryPage } from '../pages/recovery/RecoveryPage.tsx';
import { RuntimePage } from '../pages/runtime/RuntimePage.tsx';
import { InsightsPage } from '../pages/insights/InsightsPage.tsx';
import { WorkflowsPage } from '../pages/workflows/WorkflowsPage.tsx';
import { Shell } from './Shell.tsx';
import {
  GitPlaceholder,
  NotFoundPlaceholder,
  RequirementCanvasPlaceholder,
  StartPlaceholder,
  TaskCanvasPlaceholder,
} from './placeholders.tsx';

/**
 * Application routes. The canvas pages (/start, /requirement/:id, /tasks/:id)
 * are wired to the real modules as they land; the shell stays untouched.
 */
export function App() {
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route index element={<HomePage />} />
        <Route path="tasks" element={<TasksPage />} />
        <Route path="tasks/:taskId" element={<TaskCanvasPlaceholder />} />
        <Route path="tasks/:taskId/recovery" element={<RecoveryPage />} />
        <Route path="requirements" element={<RequirementsPage />} />
        <Route path="requirement/:requirementId" element={<RequirementCanvasPlaceholder />} />
        <Route path="start" element={<StartPlaceholder />} />
        <Route path="inbox" element={<InboxPage />} />
        <Route path="projects" element={<ProjectsPage />} />
        <Route path="git" element={<GitPlaceholder />} />
        <Route path="workflows" element={<WorkflowsPage />} />
        <Route path="knowledge" element={<KnowledgePage />} />
        <Route path="ppt" element={<PptPage />} />
        <Route path="insights" element={<InsightsPage />} />
        <Route path="templates" element={<TemplatesPage />} />
        <Route path="runtime" element={<RuntimePage />} />
        <Route path="tools" element={<ToolsPage />} />
        <Route path="databases" element={<DatabasesPage />} />
        <Route path="roles" element={<RolesPage />} />
        <Route path="recovery" element={<RecoveryPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="*" element={<NotFoundPlaceholder />} />
      </Route>
    </Routes>
  );
}
