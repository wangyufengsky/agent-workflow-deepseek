import { Route, Routes } from 'react-router-dom';
import { HomePage } from '../pages/home/HomePage.tsx';
import { SettingsPage } from '../pages/settings/SettingsPage.tsx';
import { TasksPage } from '../pages/tasks/TasksPage.tsx';
import { Shell } from './Shell.tsx';
import {
  DatabasesPlaceholder,
  GitPlaceholder,
  InboxPlaceholder,
  InsightsPlaceholder,
  KnowledgePlaceholder,
  NotFoundPlaceholder,
  PptPlaceholder,
  ProjectsPlaceholder,
  RequirementCanvasPlaceholder,
  RequirementsPlaceholder,
  RolesPlaceholder,
  RuntimePlaceholder,
  StartPlaceholder,
  TaskCanvasPlaceholder,
  TemplatesPlaceholder,
  ToolsPlaceholder,
  WorkflowsPlaceholder,
} from './placeholders.tsx';

/**
 * Application routes. Canvases (/tasks/:id, /requirement/:id) currently render
 * in-app placeholders; the canvas modules under src/pages/** can replace the
 * element without touching the shell.
 */
export function App() {
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route index element={<HomePage />} />
        <Route path="tasks" element={<TasksPage />} />
        <Route path="tasks/:taskId" element={<TaskCanvasPlaceholder />} />
        <Route path="requirements" element={<RequirementsPlaceholder />} />
        <Route path="requirement/:requirementId" element={<RequirementCanvasPlaceholder />} />
        <Route path="start" element={<StartPlaceholder />} />
        <Route path="inbox" element={<InboxPlaceholder />} />
        <Route path="projects" element={<ProjectsPlaceholder />} />
        <Route path="git" element={<GitPlaceholder />} />
        <Route path="workflows" element={<WorkflowsPlaceholder />} />
        <Route path="knowledge" element={<KnowledgePlaceholder />} />
        <Route path="ppt" element={<PptPlaceholder />} />
        <Route path="insights" element={<InsightsPlaceholder />} />
        <Route path="templates" element={<TemplatesPlaceholder />} />
        <Route path="runtime" element={<RuntimePlaceholder />} />
        <Route path="tools" element={<ToolsPlaceholder />} />
        <Route path="databases" element={<DatabasesPlaceholder />} />
        <Route path="roles" element={<RolesPlaceholder />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="*" element={<NotFoundPlaceholder />} />
      </Route>
    </Routes>
  );
}
