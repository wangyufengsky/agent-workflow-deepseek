import type { OutputFragment } from '@agent-workflow/shared';
/** Keep a call at its first event position; later state belongs to that exact call ID. */
export function toolFeed(fragments: readonly OutputFragment[]): readonly OutputFragment[] {
  const result: OutputFragment[] = [];
  const index = new Map<string, number>();
  for (const fragment of fragments) {
    const callId = fragment.category === 'tool_activity' ? fragment.toolCallRef?.callId : undefined;
    const existing = callId ? index.get(callId) : undefined;
    if (existing === undefined) {
      if (callId) index.set(callId, result.length);
      result.push(fragment);
    } else {
      const original = result[existing]!;
      result[existing] = { ...fragment, fragmentId: original.fragmentId, seq: original.seq };
    }
  }
  return result;
}
