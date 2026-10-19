/** Persist only command identity, never credentials or request bodies. */
export interface PendingCommand { readonly scope: string; readonly path: string; readonly requestKey: string; readonly phase?: 'accepted' }
const storageKey = 'agent-workflow.pending-commands.v1';
const listeners = new Set<() => void>();
let memory: PendingCommand[] = [];
let storageUnavailable = false;
export function pendingCommands(): PendingCommand[] {
  if (storageUnavailable) return memory;
  try { const raw: unknown = JSON.parse(localStorage.getItem(storageKey) ?? '[]');
    if (Array.isArray(raw)) return memory = raw.filter((v): v is PendingCommand => typeof v?.scope === 'string' && typeof v?.path === 'string' && typeof v?.requestKey === 'string');
  } catch { storageUnavailable = true; }
  return memory;
}
function save(values: PendingCommand[]) { memory = values; try { localStorage.setItem(storageKey, JSON.stringify(values)); } catch { storageUnavailable = true; } for (const listener of listeners) listener(); }
export function subscribePending(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
export function commandScope(path: string): string | undefined {
  if (path === '/api/settings') return path;
  if (path.startsWith('/api/ppt/works')) return '/api/ppt/works';
  return path.match(/^\/api\/tasks\/[^/?]+/)?.[0];
}
export function rememberCommand(command: PendingCommand) { save([...pendingCommands().filter((v) => v.requestKey !== command.requestKey), command]); }
export function settleCommand(requestKey: string) { save(pendingCommands().filter((v) => v.requestKey !== requestKey)); }
export function pendingForScope(scope: string) { return pendingCommands().find((v) => v.scope === scope && v.phase !== 'accepted'); }
