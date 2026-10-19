import { createHash } from 'node:crypto';
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { AppError, ErrorCode, nowIso, type TaskWorkspace } from '@agent-workflow/shared';
import type { Store } from '@agent-workflow/storage';
import type { GitPort } from './ports.ts';

const ignored = new Set(['.git', 'node_modules', '.data']);

/** Snapshot real regular files; never traverse a symlink or copy runtime data. */
export function recoveryTreeRevision(root: string): string {
  const hash = createHash('sha256');
  for (const entry of readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (ignored.has(entry.name)) continue;
    const path = join(root, entry.name);
    if (lstatSync(path).isSymbolicLink()) throw new AppError(ErrorCode.VALIDATION_FAILED, '恢复快照含符号链接，需先人工确认范围', { details: { name: entry.name } });
    hash.update(entry.name);
    if (entry.isDirectory()) hash.update(recoveryTreeRevision(path));
    else if (entry.isFile()) hash.update(readFileSync(path));
    else if (!entry.isFile()) throw new AppError(ErrorCode.VALIDATION_FAILED, '恢复快照含非常规文件，不能复制');
  }
  return hash.digest('hex');
}

function copySnapshot(source: string, target: string): void {
  const src = resolve(source);
  const dst = resolve(target);
  if (src === dst || dst.startsWith(`${src}${sep}`)) throw new AppError(ErrorCode.FORBIDDEN, '恢复目标不能位于来源目录内');
  const before = recoveryTreeRevision(src);
  mkdirSync(dst, { recursive: true });
  for (const name of readdirSync(dst)) if (name !== '.git') rmSync(join(dst, name), { recursive: true, force: true });
  for (const name of readdirSync(src)) {
    if (!ignored.has(name)) cpSync(join(src, name), join(dst, name), { recursive: true, errorOnExist: true });
  }
  if (before !== recoveryTreeRevision(src) || before !== recoveryTreeRevision(dst)) throw new AppError(ErrorCode.STALE_TARGET, '来源文件在恢复快照期间变化，保留现场并重新核对');
}

/** Creates a new owned path; the parent workspace is only read, never rebound. */
export async function createRecoveryWorkspace(store: Store, git: GitPort, parentTaskId: string, taskId: string, mode: 'from_failed_stage' | 'all_stages'): Promise<TaskWorkspace | undefined> {
  const parent = store.tasks.get(parentTaskId)!;
  const source = parent.workspaceId === undefined ? store.workspaces.byTask(parentTaskId) : store.workspaces.get(parent.workspaceId);
  if (source === undefined) return undefined;
  if (source.state !== 'ready' || source.displayRoot === undefined || !existsSync(source.displayRoot)) throw new AppError(ErrorCode.WORKSPACE_NOT_READY, '原任务工作区不可读，不能恢复已有产出');
  const project = store.projects.get(parent.projectId)!;
  const workspace = store.workspaces.create({ taskId, kind: source.kind, originalRootDisplay: project.rootPath, baseRef: source.baseRef });
  store.workspaces.update(workspace.id, { state: 'preparing' });
  try {
    if (source.kind === 'git_worktree') {
      const head = mode === 'from_failed_stage' ? (await git.status(source.displayRoot))?.head.sha : source.baseSha;
      if (head === undefined) throw new AppError(ErrorCode.WORKSPACE_NOT_READY, '无法读取原任务工作区基线');
      const handle = await git.createWorktree({ repoRoot: project.rootPath, worktreesRoot: join(store.dataDir, 'recovery-worktrees'), taskId, baseRef: head, baseSha: head, branch: `task/recovery-${taskId.replace(/^task_/, '')}` });
      const expectedPath = resolve(store.dataDir, 'recovery-worktrees', taskId);
      if (resolve(handle.path) !== expectedPath) throw new AppError(ErrorCode.FORBIDDEN, '适配器返回了不属于新任务的恢复路径');
      // Retain deletions and uncommitted output without copying .git metadata.
      if (mode === 'from_failed_stage') copySnapshot(source.displayRoot, handle.path);
      return store.workspaces.update(workspace.id, { state: 'ready', displayRoot: handle.path, branch: handle.branch, worktreeHandle: handle.handle, baseRef: source.baseRef, baseSha: source.baseSha ?? handle.headSha, lastCheckedAt: nowIso(), steps: [{step:'resolve_baseline',state:'completed',detail:mode==='all_stages'?'读取原任务冻结基线':'读取原任务当前提交及文件快照'},{step:'create_branch',state:'completed',detail:handle.branch},{step:'create_worktree',state:'completed',detail:'创建新任务独立路径'},{step:'verify_worktree',state:'completed',detail:'新分支/新路径，原任务文件与未提交产出只读复制'},{step:'bind_task',state:'completed',detail:'工作区仅绑定新派生任务'}] })!;
    }
    const baseline = store.settings.getJson<{ baselineRoot: string }>(`directory.baseline.${source.id}`)?.baselineRoot;
    if (baseline === undefined || !existsSync(baseline)) throw new AppError(ErrorCode.WORKSPACE_NOT_READY, '原任务目录基线缺失，不能用当前目录伪造恢复基线');
    const baselineRoot = join(store.dataDir, 'baselines', workspace.id);
    const target = join(store.dataDir, 'workspaces', taskId);
    copySnapshot(baseline, baselineRoot);
    copySnapshot(mode === 'from_failed_stage' ? source.displayRoot : baseline, target);
    store.settings.putJson(`directory.baseline.${workspace.id}`, { baselineRoot, sourceRoot: project.rootPath, createdAt: nowIso() });
    return store.workspaces.update(workspace.id, { state: 'ready', displayRoot: target, baseRef: source.baseRef, lastCheckedAt: nowIso(), steps: [{step:'resolve_baseline',state:'completed',detail:'读取保存的三方原始目录基线'},{step:'create_branch',state:'completed',detail:'已核对：目录项目不创建Git分支'},{step:'create_worktree',state:'completed',detail:'创建新任务独立目录'},{step:'verify_worktree',state:'completed',detail:'新目录保留原始基线和已产生文件'},{step:'bind_task',state:'completed',detail:'目录仅绑定新派生任务'}] })!;
  } catch (error) {
    store.workspaces.update(workspace.id, { state: 'blocked', steps: [{ step: 'verify_worktree', state: 'failed', detail: error instanceof Error ? error.message : '恢复快照失败；保留现场' }] });
    throw error;
  }
}
