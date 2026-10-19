import type {
  Attempt,
  AttemptResult,
  DiffPage,
  ExecutionStatusValue,
  FileChange,
  GitBranch,
  GitCommit,
  GitCommitSummary,
  GitMergeRequest,
  GitRepo,
  ModelProfile,
  NodeStatusValue,
  RepoGitStateValue,
  TaskChanges,
} from '@agent-workflow/shared';
import type { OpenCodeManagerStatus, OpenCodeSession, PromptOutcome, SessionSink } from '@agent-workflow/opencode';

/** Ports keep the engine independent of concrete Git/OpenCode/MySQL adapters. */

export interface GitRepoDetection {
  readonly gitState: RepoGitStateValue;
  readonly defaultBranch?: string;
  readonly remoteDisplayUrl?: string;
  readonly detail?: string;
}

export interface WorktreeCreateInput {
  readonly repoRoot: string;
  readonly worktreesRoot: string;
  readonly taskId: string;
  readonly baseRef: string;
  readonly baseSha: string;
  readonly branch: string;
}

export interface WorktreeHandle {
  readonly path: string;
  readonly handle: string;
  readonly branch: string;
  readonly headSha: string;
}

export interface GitDiffFilesInput {
  readonly repoRoot: string;
  readonly baseSha: string;
  readonly headSha?: string;
  readonly worktreePath?: string;
}

export interface GitCommitInput {
  readonly worktreePath: string;
  readonly filePaths: readonly string[];
  readonly message: string;
  readonly author: { readonly name: string; readonly email: string };
  readonly expectedHeadSha?: string;
}

export interface GitPushInput {
  readonly repoRoot: string;
  readonly localSha: string;
  readonly remote: string;
  readonly remoteRef: string;
  readonly token?: string;
}

export interface GitPort {
  detect(rootPath: string): Promise<GitRepoDetection>;
  status(rootPath: string): Promise<GitRepo['status'] | undefined>;
  listCommits(input: { readonly rootPath: string; readonly ref?: string; readonly limit?: number; readonly cursor?: string; readonly query?: string; readonly author?: string }): Promise<{ readonly commits: readonly GitCommitSummary[]; readonly nextCursor?: string }>;
  commitShow(rootPath: string, sha: string): Promise<GitCommit | undefined>;
  diffFiles(input: GitDiffFilesInput): Promise<readonly FileChange[]>;
  diffPage(input: { readonly repoRoot?: string; readonly worktreePath?: string; readonly baseSha: string; readonly headSha?: string; readonly path: string; readonly ignoreWhitespace?: boolean; readonly cursor?: string }): Promise<DiffPage>;
  branches(rootPath: string): Promise<readonly GitBranch[]>;
  mergeRequests?(rootPath: string): Promise<readonly GitMergeRequest[]>;
  createWorktree(input: WorktreeCreateInput): Promise<WorktreeHandle>;
  removeWorktree(input: { readonly repoRoot: string; readonly worktreePath: string; readonly branch?: string; readonly deleteBranch: boolean }): Promise<void>;
  worktreeChangedFiles(input: { readonly worktreePath: string; readonly baseSha: string }): Promise<{ readonly files: readonly FileChange[]; readonly changesRevision: string }>;
  commit(input: GitCommitInput): Promise<{ readonly sha: string }>;
  push(input: GitPushInput): Promise<{ readonly remoteRef: string; readonly pushedSha: string; readonly created: boolean }>;
  createMergeRequest?(input: { readonly repoRoot: string; readonly sourceBranch: string; readonly targetBranch: string; readonly title: string; readonly description: string }): Promise<{ readonly iid: number; readonly webUrl: string }>;
  /** Read-only snapshot comparison for non-Git projects. */
  copyToDirectory?(input: { readonly sourceRoot: string; readonly targetRoot: string }): Promise<void>;
}

export interface OpenCodeRunRequest {
  readonly kind: 'planning' | 'execution' | 'review' | 'fix';
  readonly metadata: Record<string, string>;
  readonly cwd: string;
  readonly prompt: string;
  readonly system?: string;
  readonly model: ModelProfile;
  readonly permission: 'read_only' | 'workspace_write';
  readonly jsonSchema?: Record<string, unknown>;
  readonly sink: SessionSink;
  readonly timeoutMs: number;
  readonly abortOnToolCall?: readonly string[];
  readonly onSessionId?: (sessionId: string) => void;
}

export interface OpenCodeRunResult {
  readonly sessionId: string;
  readonly outcome: PromptOutcome;
}

export interface OpenCodePort {
  status(): OpenCodeManagerStatus;
  ensureReady(): Promise<void>;
  runSession(request: OpenCodeRunRequest): Promise<OpenCodeRunResult>;
  abortSession(sessionId: string): Promise<void>;
  findSessions(metadata: Record<string, string>): Promise<readonly OpenCodeSession[]>;
}

export interface DatabasePort {
  probe(connectionId: string): Promise<{ readonly state: string; readonly serverVersion?: string; readonly latencyMs?: number; readonly message?: string }>;
  query(connectionId: string, sql: string, limit?: number): Promise<unknown>;
}

export interface ClockPort {
  now(): Date;
}

export const systemClock: ClockPort = { now: () => new Date() };

export interface EnginePorts {
  readonly git: GitPort;
  readonly opencode: OpenCodePort;
  readonly database?: DatabasePort;
  readonly clock?: ClockPort;
}

export function isActiveExecutionStatus(status: ExecutionStatusValue): boolean {
  return status === 'running' || status === 'pausing' || status === 'paused' || status === 'waiting_confirmation';
}

export function isTerminalNodeStatus(status: NodeStatusValue): boolean {
  return status === 'succeeded' || status === 'failed' || status === 'skipped' || status === 'cancelled';
}

export type { Attempt, AttemptResult, TaskChanges };
