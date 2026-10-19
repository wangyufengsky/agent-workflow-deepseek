import { QueryClient } from '@tanstack/react-query';
import { isServiceUnavailable } from '../api/client.ts';

/** One QueryClient per app. Connection failures fail fast so the UI can say「服务未连接」. */
export function createAppQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: (failureCount, error) => !isServiceUnavailable(error) && failureCount < 2,
        staleTime: 10_000,
        refetchOnWindowFocus: false,
      },
      mutations: {
        retry: false,
      },
    },
  });
}
