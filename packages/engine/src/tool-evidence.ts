import type { OpenCodePart } from '@agent-workflow/opencode';
import type { ToolCallEvidence } from '@agent-workflow/shared';

const LIMIT = 256 * 1024;
/** Redact before persistence, including strings embedded inside otherwise safe keys. */
export function toolEvidence(part: OpenCodePart): ToolCallEvidence {
  let redacted = false;
  let truncated = false;
  const clean = (value: unknown, key = '', depth = 0): unknown => {
    if (/password|passwd|secret|token|authorization|cookie|api[-_]?key|private[-_]?key/i.test(key)) { redacted = true; return '[已隐藏]'; }
    if (typeof value === 'string') {
      const safe = value.replace(/\b(Bearer\s+)[\w.+/~=-]+/gi, '$1[已隐藏]').replace(/\b(sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9_]+|glpat-[A-Za-z0-9_-]+)\b/g, '[已隐藏]').replace(/((?:password|passwd|token|secret|api[_-]?key)\s*[:=]\s*["']?)[^\s,"'}]+/gi, '$1[已隐藏]').replace(/(https?:\/\/)[^\s/@:]+:[^\s/@]+@/g, '$1[已隐藏]@');
      if (safe !== value) redacted = true;
      if (safe.length > LIMIT) { truncated = true; return safe.slice(0, LIMIT); }
      return safe;
    }
    if (depth > 12) { truncated = true; return '[层级过深]'; }
    if (Array.isArray(value)) { if (value.length > 1000) truncated = true; return value.slice(0, 1000).map((v) => clean(v, '', depth + 1)); }
    if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, clean(v, k, depth + 1)]));
    return value;
  };
  const input = part.state?.input === undefined ? undefined : clean(part.state.input);
  const inputText = input === undefined ? undefined : JSON.stringify(input);
  if (inputText !== undefined && inputText.length > LIMIT) truncated = true;
  const output = part.state?.output === undefined ? undefined : clean(part.state.output) as string;
  const error = part.state?.error === undefined ? undefined : clean(part.state.error) as string;
  const start = part.state?.time?.start;
  const end = part.state?.time?.end;
  const validTime = (time: number | undefined): time is number => time !== undefined && Number.isFinite(time) && time >= 0 && time <= 8.64e15;
  return {
    name: part.tool ?? '未知工具',
    ...(inputText === undefined ? {} : { input: inputText.slice(0, LIMIT) }),
    ...(output === undefined ? {} : { output }),
    ...(error === undefined ? {} : { error }),
    ...(validTime(start) ? { startedAt: new Date(start).toISOString() } : {}),
    ...(validTime(end) ? { endedAt: new Date(end).toISOString() } : {}),
    ...(validTime(start) && validTime(end) && end >= start ? { durationMs: end - start } : {}),
    redacted, truncated,
  };
}
