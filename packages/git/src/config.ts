/**
 * Tunables and hard limits for the Git adapter.
 *
 * Every limit is deliberately small enough that a malicious or broken
 * repository cannot make the service allocate unbounded memory or block the
 * event loop for long. Callers may lower a limit, never raise the hard cap.
 */
export const GIT_LIMITS = {
  /** Default number of commits returned by `log()`. */
  defaultLogLimit: 50,
  /** Hard cap for `log()`; the UI never needs more than one page at a time. */
  maxLogLimit: 200,
  /** Default CLI timeout for local commands. */
  defaultTimeoutMs: 15_000,
  /** Timeout for commands that may hit a remote (`fetch`, `ls-remote`). */
  fetchTimeoutMs: 60_000,
  /** Hard cap on captured stdout/stderr for a normal command. */
  maxOutputBytes: 32 * 1024 * 1024,
  /** Default number of diff lines returned for one file. */
  defaultDiffMaxLines: 4_000,
  /** Hard cap on unified diff lines returned for one file. */
  maxDiffLines: 20_000,
  /** Default unified context lines around each hunk (`git diff -U3`). */
  defaultDiffContextLines: 3,
  /** Hard cap for user-requested expansion of unchanged context (`展开全部`). */
  maxDiffContextLines: 2_000,
  /** Hard cap on raw unified diff bytes for one file. */
  maxDiffBytes: 8 * 1024 * 1024,
  /** Hard cap on `fileAtRevision()` output lines. */
  maxFileLines: 5_000,
  /** Hard cap on number of files returned by one diff. */
  maxDiffFiles: 5_000,
  /** Hard cap on branch listing. */
  maxBranches: 500,
  /** Hard cap on "refs containing a commit". */
  maxRefsContaining: 200,
  /** Default page size for remote merge-request listings. */
  defaultRemoteListLimit: 30,
  /** Hard cap for remote list paging (GitHub/GitLab cap per_page at 100). */
  maxRemoteListLimit: 100,
  /** Default HTTP timeout for remote adapters. */
  defaultRemoteTimeoutMs: 20_000,
  /** A file with more changed lines than this is displayed collapsed. */
  largeFileLines: 400,
  /** A file with more changed lines than this is not rendered by default. */
  tooLargeFileLines: 3_000,
  /** Branch names created for agent work must live in one of these namespaces. */
  worktreeBranchPrefixes: ['task/', 'ai-fix/'] as const,
} as const;

/** Shared defaults used by the adapters when a caller does not pass a base URL. */
export const REMOTE_DEFAULTS = {
  github: {
    webBaseUrl: 'https://github.com',
    apiBaseUrl: 'https://api.github.com',
  },
  gitlab: {
    webBaseUrl: 'https://gitlab.com',
    apiBaseUrl: 'https://gitlab.com/api/v4',
  },
} as const;

/** Deterministic environment for every git child process. */
export const GIT_CHILD_ENV: Readonly<Record<string, string>> = {
  GIT_TERMINAL_PROMPT: '0',
  GIT_ASKPASS: '',
  GIT_PAGER: 'cat',
  LC_ALL: 'C',
  LANG: 'C',
};
