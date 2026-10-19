import type { DatabaseConnectionConfig } from '../config/settings.ts';
/** Persisted tool policy. Project null means inherit global policy. */
export interface ToolPolicyItem {
  readonly name: string;
  readonly sourceId: string;
  readonly globalEnabled: boolean;
  readonly projectOverride: boolean | null;
  readonly enabled: boolean;
  readonly editable: boolean;
  readonly projectOverrides?: readonly { readonly projectId: string; readonly enabled: boolean }[];
  readonly reason?: string;
}
export interface ToolPolicyResponse {
  readonly projectId?: string;
  readonly revision: number;
  readonly sources: readonly { readonly id: string; readonly label: string; readonly complete: boolean; readonly kind?: 'builtin' | 'external'; readonly state?: string; readonly reason?: string; readonly tools: readonly ToolPolicyItem[] }[];
}
export interface ToolPolicyUpdate {
  readonly requestKey: string;
  readonly projectId?: string;
  readonly toolName?: string;
  readonly sourceId?: string;
  readonly enabled: boolean | null;
}
export interface DatabaseAccessGrant {
  readonly connectionId: string;
  readonly connectionConfig?: DatabaseConnectionConfig;
  readonly projectIds: readonly string[];
  readonly schemas: readonly string[];
  /** Empty means every table in the explicitly allowed schemas. */
  readonly tables: readonly string[];
  readonly defaultSchema: string;
}
