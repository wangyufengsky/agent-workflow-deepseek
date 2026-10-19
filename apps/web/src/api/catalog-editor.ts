import {
  ROUTES,
  createRequestKey,
  type CommandResponse,
  type RoleArchiveRequest,
  type RoleCatalogResponse,
  type RolePublishRequest,
  type RoleSaveRequest,
} from '@agent-workflow/shared';
import { apiGet, apiPost } from './client.ts';

export async function fetchRoleCatalog(): Promise<RoleCatalogResponse> {
  const response = await apiGet<RoleCatalogResponse>(ROUTES.catalogRoles);
  return response.data;
}

export interface RoleDraftInput {
  readonly roleId?: string;
  readonly baseId?: string;
  readonly name: string;
  readonly purpose: string;
  readonly responsibilities: readonly string[];
}

export async function saveRoleDraft(input: RoleDraftInput): Promise<RoleCatalogResponse> {
  const body: RoleSaveRequest = {
    requestKey: createRequestKey(),
    ...(input.roleId === undefined ? {} : { roleId: input.roleId }),
    ...(input.baseId === undefined ? {} : { baseId: input.baseId }),
    name: input.name,
    purpose: input.purpose,
    responsibilities: input.responsibilities,
    confirmSave: true,
  };
  const response = await apiPost<CommandResponse<RoleCatalogResponse>>(ROUTES.catalogRoleSave, body);
  return response.data.resource ?? { roles: [], actions: {} };
}

export async function publishRole(roleId: string): Promise<RoleCatalogResponse> {
  const body: RolePublishRequest = { requestKey: createRequestKey(), confirmPublish: true };
  const response = await apiPost<CommandResponse<RoleCatalogResponse>>(ROUTES.catalogRolePublish(roleId), body);
  return response.data.resource ?? { roles: [], actions: {} };
}

export async function archiveRole(roleId: string): Promise<RoleCatalogResponse> {
  const body: RoleArchiveRequest = { requestKey: createRequestKey(), confirmArchive: true };
  const response = await apiPost<CommandResponse<RoleCatalogResponse>>(ROUTES.catalogRoleArchive(roleId), body);
  return response.data.resource ?? { roles: [], actions: {} };
}
