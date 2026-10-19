import {
  ROUTES,
  createRequestKey,
  type BootstrapResponse,
  type CommandResponse,
  type ListTasksQuery,
  type OpenCodeDetectResponse,
  type OpenCodeRestartRequest,
  type OpenCodeStatusResponse,
  type Page,
  type ProjectSummary,
  type SettingsResponse,
  type TaskSummary,
} from '@agent-workflow/shared';
import { apiGet, apiPost } from './client.ts';

function toQueryString(query: ListTasksQuery): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    params.set(key, String(value));
  }
  const text = params.toString();
  return text.length === 0 ? '' : `?${text}`;
}

export async function fetchBootstrap(): Promise<BootstrapResponse> {
  const response = await apiGet<BootstrapResponse>(ROUTES.bootstrap);
  return response.data;
}

export async function fetchTasks(query: ListTasksQuery = {}): Promise<readonly TaskSummary[]> {
  const response = await apiGet<Page<TaskSummary>>(`${ROUTES.tasks}${toQueryString(query)}`);
  return response.data.items;
}

export async function fetchProjects(includeArchived = false): Promise<readonly ProjectSummary[]> {
  const response = await apiGet<Page<ProjectSummary>>(`${ROUTES.projects}${includeArchived ? '?includeArchived=1' : ''}`);
  return response.data.items;
}

export async function fetchSettings(): Promise<SettingsResponse> {
  const response = await apiGet<SettingsResponse>(ROUTES.settings);
  return response.data;
}

export async function fetchOpenCodeStatus(): Promise<OpenCodeStatusResponse['status']> {
  const response = await apiGet<OpenCodeStatusResponse>(ROUTES.opencodeStatus);
  return response.data.status;
}

export async function fetchOpenCodeDetect(): Promise<OpenCodeDetectResponse> {
  const response = await apiGet<OpenCodeDetectResponse>('/api/opencode/detect');
  return response.data;
}

export async function restartOpenCode(): Promise<CommandResponse> {
  const body: OpenCodeRestartRequest = { requestKey: createRequestKey(), confirmRestart: true };
  const response = await apiPost<CommandResponse>(ROUTES.opencodeRestart, body);
  return response.data;
}
