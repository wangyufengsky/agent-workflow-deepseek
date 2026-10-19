/** Persist only command identity, never credentials or request bodies. */
export interface PendingCommand { readonly scope: string; readonly path: string; readonly requestKey: string; readonly phase?: 'accepted' | 'sending' }
const storageKey = 'agent-workflow.pending-commands.v1';
const inFlight = new Set<string>();
const listeners = new Set<() => void>();
let memory: PendingCommand[] = [];
export function pendingCommands(): PendingCommand[] {
  try { const raw: unknown = JSON.parse(localStorage.getItem(storageKey) ?? '[]');
    if (Array.isArray(raw)) memory = raw.filter((v): v is PendingCommand => typeof v?.scope === 'string' && typeof v?.path === 'string' && typeof v?.requestKey === 'string');
  } catch { /* Keep in-memory locks if reading durable storage fails. */ }
  return memory.map((item) => ({ ...item, phase: inFlight.has(item.requestKey) ? 'sending' : item.phase === 'accepted' ? 'accepted' : undefined }));
}
function save(values: PendingCommand[], requireDurable = false) {
  try { localStorage.setItem(storageKey, JSON.stringify(values.map((item) => ({ ...item, phase: item.phase === 'accepted' ? 'accepted' : undefined })))); }
  catch {
    if (requireDurable) throw new Error('无法持久保存请求号，操作尚未发送。请恢复本地存储后重试。');
  }
  memory = values;
  for (const listener of listeners) listener();
}
export function subscribePending(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
export function commandScope(path: string): string | undefined {
  if (path === '/api/settings') return path;
  if (path.startsWith('/api/ppt/works')) return '/api/ppt/works';
  if (path === '/api/tasks' || path === '/api/projects') return path;
  // All request-key writes, including roles, workflows and runtime controls.
  return path.match(/^\/api\/[^/?]+(?:\/[^/?]+)?/)?.[0];
}
export function rememberCommand(command: PendingCommand) { save([...pendingCommands().filter((v) => v.requestKey !== command.requestKey), command], true); }
export function settleCommand(requestKey: string) { save(pendingCommands().filter((v) => v.requestKey !== requestKey)); }
export function pendingForScope(scope: string) { return pendingCommands().find((v) => v.scope === scope && v.phase !== 'accepted'); }

/** Sending is local to this page lifetime; a reload cannot prove the request is still in flight. */
export function setCommandInFlight(requestKey: string, active: boolean) {
  if (active) inFlight.add(requestKey); else inFlight.delete(requestKey);
  for (const listener of listeners) listener();
}
