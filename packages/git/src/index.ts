/**
 * `@agent-workflow/git` — local Git CLI adapter, isolated worktree manager and
 * GitHub/GitLab REST adapters.
 *
 * The module never persists credentials, never shells out with a joined
 * command string, and confines worktree writes to the caller supplied
 * `worktreesRoot`.
 */

export { GIT_LIMITS, REMOTE_DEFAULTS, GIT_CHILD_ENV } from './config.ts';

export {
  classifyGitFailure,
  runGit,
  runGitBytes,
  runGitChecked,
  GitCommandError,
  type GitRunOptions,
  type GitRunResult,
  type GitRunBytesResult,
} from './cli.ts';

export {
  containsLikelySecret,
  redactSecrets,
  safeHost,
  safeUrlForDisplay,
} from './redact.ts';

export {
  assertCliValue,
  assertFullRef,
  assertFullSha,
  assertIntInRange,
  assertLineRange,
  assertRelativePath,
  assertRevision,
  assertWorktreeBranchName,
  assertWorktreeHandle,
  isFullRef,
  isFullSha,
  isRelativePath,
  isValidBranchShortName,
  isWorktreeBranchName,
  sanitizeWorktreeSegment,
} from './validation.ts';

export {
  buildFileChanges,
  decodeCursor,
  encodeCursor,
  fileIdFor,
  looksBinary,
  modeFor,
  parseNumstat,
  parseRawDiff,
  parseUnifiedDiff,
  sizeClassFor,
  sliceTextLines,
  type DiffCursor,
  type NumstatEntry,
  type RawDiffEntry,
  type UnifiedDiffParseOptions,
} from './diff.ts';

export {
  detectGitState,
  gitPerson,
  GitRepository,
  initialsFor,
  parseRefDecorations,
  type CommitFileChanges,
  type ContainedInBranches,
  type DiffHunksRequest,
  type FileAtRevisionResult,
  type GitLogOptions,
  type GitLogPage,
  type GitRepositoryOptions,
  type GitRepositoryStatus,
  type RepositoryRemote,
} from './repository.ts';

export {
  buildHandle,
  resolveWorktreePath,
  WorktreeManager,
  type CreateWorktreeRequest,
  type RemoveWorktreeOptions,
  type RemoveWorktreeResult,
  type WorktreeHandle,
  type WorktreeManagerOptions,
} from './worktree.ts';

export {
  RemoteHttpClient,
  remoteBoolean,
  remoteNumber,
  remoteObject,
  remoteString,
  type FetchLike,
  type RemoteAuthStyle,
  type RemoteHttpClientOptions,
  type RemoteJsonRequest,
  type TokenSource,
} from './http.ts';

export {
  createRemoteProvider,
  GitHubAdapter,
  GitLabAdapter,
  mapGitHubPull,
  mapGitLabMergeRequest,
  type CreateMergeRequestInput,
  type GitHubAdapterOptions,
  type GitLabAdapterOptions,
  type ListMergeRequestsOptions,
  type MergeRequestStateInput,
  type RemoteProject,
  type RemoteProvider,
  type RemoteProviderConfig,
} from './remote.ts';
