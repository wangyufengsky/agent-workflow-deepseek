import { execFile } from 'node:child_process';
import { existsSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';
import { nowIso } from '@agent-workflow/shared';

export interface OpenCodeCandidate {
  readonly path: string;
  readonly version?: string;
  readonly source: 'current' | 'path' | 'versions-dir';
}

export interface OpenCodeDetectResult {
  readonly current: string;
  readonly scannedAt: string;
  readonly candidates: readonly OpenCodeCandidate[];
}

/**
 * Read-only scan for OpenCode binaries. Only executes `<binary> --version` for
 * candidates discovered on PATH or under ~/.opencode/versions; never runs a
 * user-supplied command string and never changes settings by itself.
 */
export async function detectOpenCodeBinaries(current: string): Promise<OpenCodeDetectResult> {
  const discovered: Array<{ path: string; source: OpenCodeCandidate['source'] }> = [];
  const add = (path: string, source: OpenCodeCandidate['source']) => {
    if (path.trim() === '' || !existsSync(path)) return;
    try {
      if (!statSync(path).isFile()) return;
    } catch {
      return;
    }
    const canonical = (() => {
      try {
        return realpathSync(path);
      } catch {
        return path;
      }
    })();
    if (discovered.some((entry) => entry.path === canonical)) return;
    discovered.push({ path: canonical, source });
  };

  if (/\//.test(current)) add(current, 'current');
  for (const directory of (process.env.PATH ?? '').split(delimiter)) {
    if (directory.trim() === '') continue;
    add(join(directory, 'opencode'), 'path');
  }
  const versionsRoot = join(homedir(), '.opencode', 'versions');
  try {
    if (existsSync(versionsRoot)) {
      for (const entry of readdirSync(versionsRoot, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        add(join(versionsRoot, entry.name, 'opencode'), 'versions-dir');
      }
    }
  } catch {
    // Detection is best-effort and must never fail the status page.
  }

  const candidates: OpenCodeCandidate[] = [];
  for (const entry of discovered.slice(0, 12)) {
    const version = await probeVersion(entry.path);
    candidates.push({ path: entry.path, source: entry.source, ...(version === undefined ? {} : { version }) });
  }
  candidates.sort((a, b) => {
    if (a.path === current) return -1;
    if (b.path === current) return 1;
    return (b.version ?? '').localeCompare(a.version ?? '', undefined, { numeric: true });
  });
  return { current, scannedAt: nowIso(), candidates };
}

function probeVersion(binary: string): Promise<string | undefined> {
  return new Promise((resolveProbe) => {
    execFile(binary, ['--version'], { timeout: 4_000, maxBuffer: 64 * 1024, shell: false, env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: process.env.HOME ?? '' } }, (error, stdout) => {
      if (error !== null) {
        resolveProbe(undefined);
        return;
      }
      const match = /\b(\d+\.\d+\.\d+)\b/.exec(`${stdout}`);
      resolveProbe(match?.[1]);
    });
  });
}
