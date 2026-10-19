import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ListTasksQuery, OpenCodeStatusResponse, TaskSummary } from '@agent-workflow/shared';
import { isServiceUnavailable } from './client.ts';
import {
  fetchBootstrap,
  fetchOpenCodeStatus,
  fetchProjects,
  fetchSettings,
  fetchTasks,
  restartOpenCode,
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

export function useProjects() {
  return useQuery({
    queryKey: queryKeys.projects,
    queryFn: fetchProjects,
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

export function useOpenCodeStatus() {
  return useQuery({
    queryKey: queryKeys.opencodeStatus,
    queryFn: fetchOpenCodeStatus,
    retry: shouldRetry,
    staleTime: 15_000,
    refetchInterval: (query) => {
      const data = query.state.data as OpenCodeStatusResponse['status'] | undefined;
      const state = data?.state;
      return state === 'starting' || state === 'degraded' ? 4_000 : false;
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
