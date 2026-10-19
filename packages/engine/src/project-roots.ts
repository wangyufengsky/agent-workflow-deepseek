import { realpath, stat } from 'node:fs/promises';
import { isAbsolute, relative, sep } from 'node:path';
import { AppError, ErrorCode } from '@agent-workflow/shared';
/** Real-path containment, only for newly registered projects. Existing registrations stay usable. */
export async function assertAllowedProjectRoot(projectPath: string, allowed: readonly string[]): Promise<void> {
  if (!allowed.length) return;
  let candidate: string;
  try { candidate = await realpath(projectPath); if (!(await stat(candidate)).isDirectory()) throw new Error(); }
  catch { throw new AppError(ErrorCode.FORBIDDEN, '项目目录不可核对，无法确认符合允许的项目根目录'); }
  for (const root of allowed) {
    try { const base = await realpath(root); if (!(await stat(base)).isDirectory()) continue; const rel = relative(base, candidate); if (rel === '' || !isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`)) return; }
    catch { /* An unavailable allowed root grants nothing. */ }
  }
  throw new AppError(ErrorCode.FORBIDDEN, '项目实际目录不在允许的项目根目录内；已有项目不受此限制影响');
}
