import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ListTasksQuery, OpenCodeStatusResponse, TaskSummary } from '@agent-workflow/shared';
import { isServiceUnavailable, openEventStream } from './client.ts';
import {
  fetchBootstrap,
  fetchOpenCodeStatus,
  fetchProjects,
  fetchSettings,
  fetchTasks,
  restartOpenCode,
  fetchOpenCodeDetect,
} from './endpoints.ts';

/** Retry only transient, non-connection failures; a down service should surface immediately. */
function shouldRetry(failureCount: number, error: unknown): boolean {
  return !isServiceUnavailable(error) && failureCount < 2;
}

export const queryKeys = {
  bootstrap: ['bootstrap'] as const,
  tasks: (query: ListTasksQuery = {}) => ['tasks', query] as const,
  projects: ['projects'] as const,
  settings: ['settings'] as const,
  opencodeStatus: ['opencode', 'status'] as const,
};

export function useBootstrap() {
  return useQuery({
    queryKey: queryKeys.bootstrap,
    queryFn: fetchBootstrap,
    retry: shouldRetry,
    staleTime: 15_000,
  });
}

export function useTasks(query: ListTasksQuery = {}) {
  return useQuery({
    queryKey: queryKeys.tasks(query),
    queryFn: () => fetchTasks(query),
    retry: shouldRetry,
    staleTime: 10_000,
  });
}

export function useProjects(includeArchived = false) {
  return useQuery({
    queryKey: [...queryKeys.projects, includeArchived] as const,
    queryFn: () => fetchProjects(includeArchived),
    retry: shouldRetry,
    staleTime: 30_000,
  });
}

export function useSettings() {
  return useQuery({
    queryKey: queryKeys.settings,
    queryFn: fetchSettings,
    retry: shouldRetry,
    staleTime: 30_000,
  });
}

export function useOpenCodeDetect(enabled = false) {
  return useQuery({ queryKey: ['opencode', 'detect'] as const, queryFn: fetchOpenCodeDetect, enabled, retry: false });
}

export function useOpenCodeStatus() {
  return useQuery({
    queryKey: queryKeys.opencodeStatus,
    queryFn: fetchOpenCodeStatus,
    retry: shouldRetry,
    staleTime: 15_000,
    refetchInterval: (query) => {
      const data = query.state.data as OpenCodeStatusResponse['status'] | undefined;
      const state = data?.state;
      if (state === 'starting' || state === 'degraded') return 4_000;
      if (state === 'ready') return 15_000;
      return false;
    },
  });
}

export function useRestartOpenCode() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: restartOpenCode,
    retry: false,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.opencodeStatus }),
        queryClient.invalidateQueries({ queryKey: queryKeys.bootstrap }),
      ]);
    },
  });
}

/** Aggregate connection state for the shell / page banners. */
export function useServiceConnection(): {
  state: 'loading' | 'connected' | 'disconnected';
  error: unknown;
  retry: () => void;
} {
  const bootstrap = useBootstrap();
  const state = bootstrap.isLoading ? 'loading' : bootstrap.isError ? 'disconnected' : 'connected';
  return {
    state,
    error: bootstrap.error,
    retry: () => {
      void bootstrap.refetch();
    },
  };
}

export type TasksQueryResult = ReturnType<typeof useTasks>;
export type TaskList = readonly TaskSummary[];


/** One shell subscription keeps badges consistent with live questions outside the Inbox page. */
export function useInboxLiveSummary() {
  const client = useQueryClient();
  useEffect(() => {
    let debounce: ReturnType<typeof setTimeout> | undefined;
    let fallback: ReturnType<typeof setInterval> | undefined;
    const refresh = () => {
      if (debounce !== undefined) return;
      debounce = setTimeout(() => {
        debounce = undefined;
        void client.invalidateQueries({ queryKey: queryKeys.bootstrap });
        void client.invalidateQueries({ queryKey: ['interactions'] });
        void client.invalidateQueries({ queryKey: ['runtime-interactions'] });
      }, 200);
    };
    const poll = () => { if (fallback === undefined) fallback = setInterval(refresh, 5000); };
    let stream: ReturnType<typeof openEventStream> | undefined;
    if (typeof EventSource === 'undefined') poll();
    else {
      try { stream = openEventStream({ onEvent: (event) => {
        if (fallback !== undefined) { clearInterval(fallback); fallback = undefined; }
        if (['ready', 'inbox.changed', 'task.changed', 'planning.changed', 'execution.changed'].includes(event.type)) refresh();
      }, onError: poll }); } catch { poll(); }
    }
    return () => { stream?.close(); if (debounce !== undefined) clearTimeout(debounce); if (fallback !== undefined) clearInterval(fallback); };
  }, [client]);
}
