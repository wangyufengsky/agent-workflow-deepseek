import type { EventTypeValue } from './enums.ts';
import type { IsoDateTime } from '../ids.ts';

export interface AppEventEnvelope<T = unknown> {
  readonly id: string;
  readonly seq: number;
  readonly type: EventTypeValue;
  readonly at: IsoDateTime;
  readonly payload: T;
}

export interface OutputFragmentEvent {
  readonly taskId: string;
  readonly roundId: string;
  readonly seq: number;
  readonly fragmentId: string;
  readonly category: 'model_text' | 'public_reasoning_summary' | 'tool_activity' | 'service_event';
  readonly text?: string;
  readonly blockId?: string;
  readonly toolCallRef?: { readonly callId: string; readonly status: string; readonly source: 'managed_mcp' | 'opencode' };
}

export interface NodeOutputFragmentEvent extends Omit<OutputFragmentEvent, 'roundId'> {
  readonly executionId: string;
  readonly nodeId: string;
  readonly attemptId: string;
}

export interface EventMap {
  'inbox.changed': { readonly taskId: string };
  'ready': { readonly serverStartedAt: IsoDateTime };
  'task.changed': { readonly taskId: string; readonly projectId: string; readonly stage: string; readonly revision: number };
  'plan.changed': { readonly taskId: string; readonly planRevisionId: string; readonly revisionNumber: number; readonly status: string };
  'planning.changed': {
    readonly taskId: string;
    readonly roundId: string;
    readonly status: string;
    readonly stage: string;
    readonly revision: number;
  };
  'planning.output.appended': OutputFragmentEvent;
  'execution.changed': {
    readonly taskId: string;
    readonly executionId: string;
    readonly status: string;
    readonly revision: number;
  };
  'node.output.appended': NodeOutputFragmentEvent;
  'task.workspace.updated': { readonly taskId: string; readonly workspaceId: string; readonly revision: string; readonly state: string };
  'task.changes.updated': { readonly taskId: string; readonly workspaceId: string; readonly changesRevision: string };
  'task.delivery.updated': { readonly taskId: string; readonly deliveryId: string; readonly revision: string; readonly projection: string };
  'operation.settled': {
    readonly requestKey: string;
    readonly operation: string;
    readonly status: 'accepted' | 'succeeded' | 'failed' | 'unknown';
    readonly target?: string;
  };
  'git.repo.changed': { readonly projectId: string; readonly repoRevision?: string; readonly changedRefs?: readonly string[] };
  'review.changed': { readonly projectId: string; readonly reviewRunId: string; readonly state: string; readonly revision: number };
  'fix.changed': { readonly projectId: string; readonly fixRunId: string; readonly state: string; readonly revision: number };
  'opencode.status.changed': { readonly status: string; readonly pid?: number; readonly port?: number; readonly message?: string };
  'catalog.changed': { readonly kind: string; readonly roleId: string; readonly revision: number };
}

export type AppEvent = {
  [K in keyof EventMap]: { readonly type: K; readonly payload: EventMap[K] };
}[keyof EventMap];

export function isAppEvent(value: unknown): value is AppEvent {
  return typeof value === 'object' && value !== null && typeof (value as { type?: unknown }).type === 'string';
}
