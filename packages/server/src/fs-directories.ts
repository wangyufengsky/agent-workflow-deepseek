import { existsSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { AppError, ErrorCode } from '@agent-workflow/shared';

const MAX_ENTRIES = 500;

export interface DirectoryListing {
  readonly path: string;
  readonly name: string;
  readonly parent?: string;
  readonly home: string;
  readonly entries: readonly { readonly name: string; readonly path: string; readonly isGit: boolean }[];
  readonly truncated: boolean;
}

/**
 * Read-only directory listing for the local folder picker. It never reads file
 * contents and only returns directory names. Absolute paths are required.
 */
export function listDirectories(rawPath: string | undefined): DirectoryListing {
  const home = safeRealpath(homedir()) ?? homedir();
  const requested = typeof rawPath === 'string' ? rawPath.trim() : '';
  const target = requested === '' || requested === '~' ? home : requested;
  if (!isAbsolute(target)) throw new AppError(ErrorCode.VALIDATION_FAILED, '目录路径必须是绝对路径');
  const real = safeRealpath(target);
  if (real === undefined) throw new AppError(ErrorCode.NOT_FOUND, '目录不存在或不可读');
  let isDirectory = false;
  try {
    isDirectory = statSync(real).isDirectory();
  } catch {
    isDirectory = false;
  }
  if (!isDirectory) throw new AppError(ErrorCode.VALIDATION_FAILED, '路径不是目录');
  let names: string[] = [];
  try {
    names = readdirSync(real);
  } catch {
    throw new AppError(ErrorCode.CAPABILITY_UNAVAILABLE, '目录不可读（权限不足）');
  }
  const directories = names
    .map((name) => {
      const child = join(real, name);
      try {
        if (!statSync(child).isDirectory()) return undefined;
        return { name, path: child, isGit: existsSync(join(child, '.git')) };
      } catch {
        return undefined;
      }
    })
    .filter((entry): entry is { name: string; path: string; isGit: boolean } => entry !== undefined)
    .sort((left, right) => (left.isGit === right.isGit ? left.name.localeCompare(right.name) : left.isGit ? -1 : 1));
  const parent = dirname(real);
  return {
    path: real,
    name: basename(real),
    ...(parent === real ? {} : { parent }),
    home,
    entries: directories.slice(0, MAX_ENTRIES),
    truncated: directories.length > MAX_ENTRIES,
  };
}

function safeRealpath(path: string): string | undefined {
  try {
    return realpathSync(path);
  } catch {
    return undefined;
  }
}
