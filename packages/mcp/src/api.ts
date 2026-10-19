import type { PlanningCandidatePayload } from '@agent-workflow/shared';
import type { InternalApiClient } from './client.ts';

/**
 * Internal loopback routes exposed by `packages/server`. All paths live here so
 * the contract can be aligned in one place.
 */
export const INTERNAL_MCP_ROUTES = {
  context: '/internal/mcp/context',
  planSubmit: '/internal/mcp/plan-submit',
  question: '/internal/mcp/question',
  resultSubmit: '/internal/mcp/result-submit',
  gitStatus: '/internal/mcp/git/status',
  gitLog: '/internal/mcp/git/log',
  gitDiffFiles: '/internal/mcp/git/diff-files',
  gitCommitShow: '/internal/mcp/git/commit-show',
  databaseQuery: '/internal/mcp/database/query',
  workspaceFile: '/internal/mcp/workspace/file',
  workspaceFiles: '/internal/mcp/workspace/files',
  workspaceFileWrite: '/internal/mcp/workspace/file-write',
  workspaceExec: '/internal/mcp/workspace/exec',
} as const;

export interface PlanSubmitInput {
  readonly taskId: string;
  readonly roundId: string;
  readonly candidate: PlanningCandidatePayload;
}

export interface QuestionAskInput {
  readonly taskId: string;
  readonly roundId: string;
  readonly question: string;
  readonly required: boolean;
  readonly nodeKeys?: readonly string[];
}

export type VerificationState = 'passed' | 'failed' | 'not_configured';

export interface VerificationInput {
  readonly state: VerificationState;
  readonly passed?: number;
  readonly failed?: number;
  readonly summary?: string;
}

export interface ResultSubmitInput {
  readonly taskId: string;
  readonly nodeId: string;
  readonly attemptId: string;
  readonly summary: string;
  readonly payload?: Record<string, unknown>;
  readonly verification?: VerificationInput;
}

export interface DatabaseQueryInput {
  readonly taskId?: string;
  readonly connectionId: string;
  readonly sql: string;
  readonly limit?: number;
}

export interface GitLogQuery {
  readonly limit?: number;
  /** Revision/ref to start the log from (server contract: `ref`). */
  readonly ref?: string;
}

/** Typed facade over `/internal/mcp/*`; keeps tool handlers free of URL details. */
export class InternalMcpApi {
  readonly #client: InternalApiClient;

  constructor(client: InternalApiClient) {
    this.#client = client;
  }

  getContext(input: { readonly taskId: string; readonly nodeId?: string; readonly attemptId?: string }): Promise<unknown> {
    return this.#client.get(INTERNAL_MCP_ROUTES.context, {
      taskId: input.taskId,
      ...(input.nodeId === undefined ? {} : { nodeId: input.nodeId }),
      ...(input.attemptId === undefined ? {} : { attemptId: input.attemptId }),
    });
  }

  submitPlan(input: PlanSubmitInput): Promise<unknown> {
    return this.#client.post(INTERNAL_MCP_ROUTES.planSubmit, {
      taskId: input.taskId,
      roundId: input.roundId,
      candidate: input.candidate,
    });
  }

  askQuestion(input: QuestionAskInput): Promise<unknown> {
    return this.#client.post(INTERNAL_MCP_ROUTES.question, {
      taskId: input.taskId,
      roundId: input.roundId,
      question: input.question,
      required: input.required,
      ...(input.nodeKeys === undefined ? {} : { nodeKeys: input.nodeKeys }),
    });
  }

  submitResult(input: ResultSubmitInput): Promise<unknown> {
    return this.#client.post(INTERNAL_MCP_ROUTES.resultSubmit, {
      taskId: input.taskId,
      nodeId: input.nodeId,
      attemptId: input.attemptId,
      summary: input.summary,
      ...(input.payload === undefined ? {} : { payload: input.payload }),
      ...(input.verification === undefined ? {} : { verification: input.verification }),
    });
  }

  gitStatus(input: { readonly projectId: string }): Promise<unknown> {
    return this.#client.get(INTERNAL_MCP_ROUTES.gitStatus, { projectId: input.projectId });
  }

  gitLog(input: { readonly projectId: string; readonly limit?: number; readonly ref?: string }): Promise<unknown> {
    return this.#client.get(INTERNAL_MCP_ROUTES.gitLog, {
      projectId: input.projectId,
      ...(input.limit === undefined ? {} : { limit: input.limit }),
      ...(input.ref === undefined ? {} : { ref: input.ref }),
    });
  }

  gitDiffFiles(input: { readonly projectId: string; readonly baseSha?: string; readonly headSha?: string }): Promise<unknown> {
    return this.#client.get(INTERNAL_MCP_ROUTES.gitDiffFiles, {
      projectId: input.projectId,
      ...(input.baseSha === undefined ? {} : { baseSha: input.baseSha }),
      ...(input.headSha === undefined ? {} : { headSha: input.headSha }),
    });
  }

  gitCommitShow(input: { readonly projectId: string; readonly sha?: string }): Promise<unknown> {
    return this.#client.get(INTERNAL_MCP_ROUTES.gitCommitShow, {
      projectId: input.projectId,
      ...(input.sha === undefined ? {} : { sha: input.sha }),
    });
  }

  databaseQuery(input: DatabaseQueryInput): Promise<unknown> {
    return this.#client.post(INTERNAL_MCP_ROUTES.databaseQuery, {
      ...(input.taskId === undefined ? {} : { taskId: input.taskId }),
      connectionId: input.connectionId,
      sql: input.sql,
      ...(input.limit === undefined ? {} : { limit: input.limit }),
    });
  }

  readWorkspaceFile(input: { readonly taskId: string; readonly path: string; readonly offset?: number; readonly limit?: number }): Promise<unknown> {
    return this.#client.get(INTERNAL_MCP_ROUTES.workspaceFile, {
      taskId: input.taskId,
      path: input.path,
      ...(input.offset === undefined ? {} : { offset: input.offset }),
      ...(input.limit === undefined ? {} : { limit: input.limit }),
    });
  }

  listWorkspaceFiles(input: { readonly taskId: string; readonly path?: string }): Promise<unknown> {
    return this.#client.get(INTERNAL_MCP_ROUTES.workspaceFiles, {
      taskId: input.taskId,
      ...(input.path === undefined ? {} : { path: input.path }),
    });
  }

  writeWorkspaceFile(input: {
    readonly taskId: string;
    readonly path: string;
    readonly content: string;
    readonly expectedSha?: string;
  }): Promise<unknown> {
    return this.#client.post(INTERNAL_MCP_ROUTES.workspaceFileWrite, {
      taskId: input.taskId,
      path: input.path,
      content: input.content,
      ...(input.expectedSha === undefined ? {} : { expectedSha: input.expectedSha }),
    });
  }

  execWorkspace(input: { readonly taskId: string; readonly command: string }): Promise<unknown> {
    return this.#client.post(INTERNAL_MCP_ROUTES.workspaceExec, {
      taskId: input.taskId,
      command: input.command,
    });
  }
}
