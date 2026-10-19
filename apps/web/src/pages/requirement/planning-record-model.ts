import type { PlanningRecordResponse } from '@agent-workflow/shared';

type Fragment = PlanningRecordResponse['fragments'][number];
type RecordRow = Fragment & { readonly lastSeq?: number };
/** A tool's newest lifecycle event replaces its existing card at the first call position. */
export function planningRecordRows(fragments: readonly Fragment[]): readonly RecordRow[] {
  const ordered = [...new Map(fragments.map((fragment) => [fragment.seq, fragment])).values()].sort((a, b) => a.seq - b.seq);
  const result: RecordRow[] = [];
  const calls = new Map<string, number>();
  for (const fragment of ordered) {
    const callId = fragment.category === 'tool_activity' ? fragment.toolCallRef?.callId : undefined;
    if (!callId) { result.push(fragment); continue; }
    const index = calls.get(callId);
    if (index === undefined) { calls.set(callId, result.length); result.push(fragment); }
    else result[index] = { ...fragment, seq: result[index]!.seq, lastSeq: fragment.seq, fragmentId: result[index]!.fragmentId };
  }
  return result;
}
