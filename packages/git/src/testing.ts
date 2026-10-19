import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

/**
 * Test-only helpers. Not exported from `index.ts` and not part of the runtime
 * surface; they create throwaway repositories under the OS temp directory.
 */

const baseEnv: Record<string, string> = {};
for (const [key, value] of Object.entries(process.env)) {
  if (value !== undefined) baseEnv[key] = value;
}

export const FIXTURE_ENV: Record<string, string> = {
  ...baseEnv,
  GIT_AUTHOR_NAME: 'Test Author',
  GIT_AUTHOR_EMAIL: 'author@example.com',
  GIT_COMMITTER_NAME: 'Test Committer',
  GIT_COMMITTER_EMAIL: 'committer@example.com',
  GIT_AUTHOR_DATE: '2026-01-02T03:04:05Z',
  GIT_COMMITTER_DATE: '2026-01-02T03:04:05Z',
  GIT_TERMINAL_PROMPT: '0',
  GIT_CONFIG_NOSYSTEM: '1',
};

export interface FixtureRepo {
  readonly root: string;
  git(args: readonly string[], options?: { readonly cwd?: string }): string;
  write(relativePath: string, content: string | Uint8Array): void;
  remove(relativePath: string): void;
  commit(message: string, files?: Readonly<Record<string, string | Uint8Array>>): string;
  sha(ref?: string): string;
  exists(relativePath: string): boolean;
  cleanup(): void;
}

export function makeTempDir(prefix = 'aw-git-'): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

export function runFixtureGit(args: readonly string[], cwd: string): string {
  return execFileSync('git', [...args], {
    cwd,
    env: FIXTURE_ENV,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

export interface FixtureRepoOptions {
  readonly empty?: boolean;
  readonly defaultBranch?: string;
}

/** Create a temp git repo with a deterministic local user. */
export function createFixtureRepo(options: FixtureRepoOptions = {}): FixtureRepo {
  const root = makeTempDir();
  const defaultBranch = options.defaultBranch ?? 'main';
  runFixtureGit(['init', '-q', '-b', defaultBranch], root);
  runFixtureGit(['config', 'user.name', 'Test Author'], root);
  runFixtureGit(['config', 'user.email', 'author@example.com'], root);

  const repo: FixtureRepo = {
    root,
    git(args, runOptions) {
      return runFixtureGit(args, runOptions?.cwd ?? root);
    },
    write(relativePath, content) {
      const full = join(root, relativePath);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, content);
    },
    remove(relativePath) {
      rmSync(join(root, relativePath), { force: true });
    },
    commit(message, files) {
      if (files !== undefined) {
        for (const [relativePath, content] of Object.entries(files)) repo.write(relativePath, content);
      }
      repo.git(['add', '-A']);
      repo.git(['commit', '-q', '-m', message]);
      return repo.sha();
    },
    sha(ref = 'HEAD') {
      return repo.git(['rev-parse', '--verify', `${ref}^{commit}`]).trim();
    },
    exists(relativePath) {
      try {
        repo.git(['cat-file', '-e', `HEAD:${relativePath}`]);
        return true;
      } catch {
        return false;
      }
    },
    cleanup() {
      rmSync(root, { recursive: true, force: true });
    },
  };

  if (options.empty !== true) {
    repo.write('README.md', '# fixture\n');
    repo.commit('initial commit');
  }
  return repo;
}

/** Create a bare remote repository inside a temp dir. */
export function createBareRemote(): FixtureRepo {
  const root = makeTempDir('aw-git-remote-');
  runFixtureGit(['init', '-q', '--bare', '-b', 'main'], root);
  return {
    root,
    git: (args) => runFixtureGit(args, root),
    write: () => {
      throw new Error('cannot write into a bare fixture');
    },
    remove: () => {
      throw new Error('cannot remove from a bare fixture');
    },
    commit: () => {
      throw new Error('cannot commit into a bare fixture');
    },
    sha: () => runFixtureGit(['rev-parse', '--verify', 'HEAD'], root).trim(),
    exists: () => false,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

/** Join a relative test path below a temp root. */
export function under(root: string, ...segments: string[]): string {
  return join(root, ...segments);
}
