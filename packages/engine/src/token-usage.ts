import type { TokenUsage } from '@agent-workflow/shared';

/** Sum assistant token usage from OpenCode messages; unknown keys are ignored. */
export function usageFromMessages(messages: readonly { readonly info: { readonly role: string; readonly tokens?: Record<string, unknown> } }[] | undefined): TokenUsage {
  let input = 0;
  let output = 0;
  let reasoning = 0;
  let cache = 0;
  for (const message of messages ?? []) {
    if (message.info.role !== 'assistant') continue;
    const raw = message.info.tokens ?? {};
    const num = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);
    const cacheInfo = raw['cache'] !== null && typeof raw['cache'] === 'object' ? raw['cache'] as Record<string, unknown> : {};
    input += num(raw['input']);
    output += num(raw['output']);
    reasoning += num(raw['reasoning']);
    cache += num(cacheInfo['read']) + num(cacheInfo['write']);
  }
  return { input, output, reasoning, cache, total: input + output + reasoning + cache };
}
