import type { FixRun, GitRepo, ReviewRun } from '@agent-workflow/shared';
import { createId } from '@agent-workflow/shared';
import { nowIso } from '@agent-workflow/shared';
import type { SqliteDatabase } from './db.ts';
import { jsonParse, jsonStringify } from './db.ts';

type Row = Record<string, unknown>;

export interface RepoRecordInput {
  readonly projectId: string;
  readonly gitState: string;
  readonly displayRoot?: string;
  readonly defaultBranch?: string;
  readonly remote?: GitRepo['remote'];
  readonly lastStatus?: GitRepo['status'];
  readonly lastFetchAt?: string;
  readonly revision?: string;
  readonly checkedAt?: string;
}

export class RepoRepository {
  readonly #db: SqliteDatabase;

  constructor(db: SqliteDatabase) {
    this.#db = db;
  }

  upsert(input: RepoRecordInput): GitRepo {
    const repo: GitRepo = {
      projectId: input.projectId,
      repoId: createId('repo'),
      projectName: '',
      gitState: input.gitState as GitRepo['gitState'],
      displayRoot: input.displayRoot,
      defaultBranch: input.defaultBranch,
      remote: input.remote,
      status: input.lastStatus,
      gitlab: 'not_configured',
    };
    this.#db
      .prepare(
        `INSERT INTO repos (project_id, repo_id, git_state, display_root, default_branch, remote_json, last_status_json, last_fetch_at, revision, checked_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(project_id) DO UPDATE SET git_state = excluded.git_state, display_root = excluded.display_root, default_branch = excluded.default_branch,
           remote_json = excluded.remote_json, last_status_json = excluded.last_status_json, last_fetch_at = excluded.last_fetch_at,
           revision = excluded.revision, checked_at = excluded.checked_at`,
      )
      .run(
        repo.projectId,
        repo.repoId ?? createId('repo'),
        repo.gitState,
        repo.displayRoot ?? null,
        repo.defaultBranch ?? null,
        repo.remote === undefined ? null : jsonStringify(repo.remote),
        repo.status === undefined ? null : jsonStringify(repo.status),
        input.lastFetchAt ?? null,
        input.revision ?? String(Date.now()),
        input.checkedAt ?? nowIso(),
      );
    return repo;
  }

  get(projectId: string): GitRepo | undefined {
    const row = this.#db.prepare('SELECT * FROM repos WHERE project_id = ?').get(projectId) as Row | undefined;
    return row === undefined ? undefined : mapRepo(row);
  }

  list(): readonly GitRepo[] {
    const rows = this.#db.prepare('SELECT * FROM repos ORDER BY checked_at DESC').all() as unknown as Row[];
    return rows.map(mapRepo);
  }

  setStatus(projectId: string, status: GitRepo['status'], revision: string, checkedAt = nowIso()): void {
    this.#db.prepare('UPDATE repos SET last_status_json = ?, revision = ?, checked_at = ? WHERE project_id = ?').run(jsonStringify(status), revision, checkedAt, projectId);
  }
}

function mapRepo(row: Row): GitRepo {
  return {
    projectId: String(row.project_id),
    repoId: String(row.repo_id),
    projectName: '',
    gitState: row.git_state as GitRepo['gitState'],
    displayRoot: row.display_root === null ? undefined : String(row.display_root),
    defaultBranch: row.default_branch === null ? undefined : String(row.default_branch),
    remote: jsonParse<GitRepo['remote'] | undefined>(row.remote_json as string | null, undefined),
    status: jsonParse<GitRepo['status'] | undefined>(row.last_status_json as string | null, undefined),
    gitlab: 'not_configured',
  };
}

/* ------------------------------------------------------------------ */
/* Reviews                                                             */
/* ------------------------------------------------------------------ */

export class ReviewRepository {
  readonly #db: SqliteDatabase;

  constructor(db: SqliteDatabase) {
    this.#db = db;
  }

  create(review: Omit<ReviewRun, 'reviewRunId' | 'ordinal' | 'receipt'> & { receipt?: ReviewRun['receipt'] }): ReviewRun {
    const ordinal = this.count(review.projectId) + 1;
    const reviewRunId = createId('review');
    const receipt =
      review.receipt ??
      ({
        operation: 'review.start',
        requestKey: createId('req'),
        bodyHash: '',
        contractVersion: '1',
        status: 'accepted',
        target: { projectId: review.projectId, ref: review.subject.commitSha },
        acceptedAt: nowIso(),
        auditId: createId('audit'),
      } as ReviewRun['receipt']);
    const record: ReviewRun = { ...review, reviewRunId, ordinal, receipt };
    this.#db
      .prepare(
        `INSERT INTO reviews (id, project_id, ordinal, execution_id, subject_json, dimensions_json, context, profession_json, state, stage, started_at, ended_at, findings_json, summary_json, receipt_json, usage_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        reviewRunId,
        record.projectId,
        ordinal,
        record.executionId,
        jsonStringify(record.subject),
        jsonStringify(record.dimensions),
        record.context,
        jsonStringify(record.profession),
        record.state,
        record.stage ?? null,
        record.startedAt ?? null,
        record.endedAt ?? null,
        jsonStringify(record.findings),
        record.summary === undefined ? null : jsonStringify(record.summary),
        jsonStringify(record.receipt),
        record.usage === undefined ? null : jsonStringify(record.usage),
      );
    return record;
  }

  get(id: string): ReviewRun | undefined {
    const row = this.#db.prepare('SELECT * FROM reviews WHERE id = ?').get(id) as Row | undefined;
    return row === undefined ? undefined : mapReview(row);
  }

  listByProject(projectId: string): readonly ReviewRun[] {
    const rows = this.#db.prepare('SELECT * FROM reviews WHERE project_id = ? ORDER BY rowid DESC').all(projectId) as unknown as Row[];
    return rows.map(mapReview);
  }

  listByCommit(projectId: string, sha: string): readonly ReviewRun[] {
    const rows = this.#db.prepare('SELECT * FROM reviews WHERE project_id = ? ORDER BY rowid DESC').all(projectId) as unknown as Row[];
    return rows.map(mapReview).filter((review) => review.subject.commitSha === sha);
  }

  /** Reviews that were in flight when the process stopped (used for recovery). */
  listActive(): readonly ReviewRun[] {
    const rows = this.#db
      .prepare("SELECT * FROM reviews WHERE state IN ('queued','running','stopping') ORDER BY rowid ASC")
      .all() as unknown as Row[];
    return rows.map(mapReview);
  }

  count(projectId: string): number {
    const row = this.#db.prepare('SELECT COUNT(*) AS n FROM reviews WHERE project_id = ?').get(projectId) as { n: number };
    return Number(row.n);
  }

  update(review: ReviewRun): ReviewRun {
    this.#db
      .prepare('UPDATE reviews SET state = ?, stage = ?, started_at = ?, ended_at = ?, findings_json = ?, summary_json = ?, receipt_json = ?, usage_json = ? WHERE id = ?')
      .run(
        review.state,
        review.stage ?? null,
        review.startedAt ?? null,
        review.endedAt ?? null,
        jsonStringify(review.findings),
        review.summary === undefined ? null : jsonStringify(review.summary),
        jsonStringify(review.receipt),
        review.usage === undefined ? null : jsonStringify(review.usage),
        review.reviewRunId,
      );
    return review;
  }
}

function mapReview(row: Row): ReviewRun {
  return {
    reviewRunId: String(row.id),
    projectId: String(row.project_id),
    ordinal: Number(row.ordinal),
    executionId: String(row.execution_id),
    subject: jsonParse<ReviewRun['subject']>(row.subject_json as string, { commitSha: '', compareBase: { compareId: '', kind: 'parent', label: '', baseSha: '' } }),
    dimensions: jsonParse<ReviewRun['dimensions']>(row.dimensions_json as string, []),
    context: row.context as ReviewRun['context'],
    profession: jsonParse<ReviewRun['profession']>(row.profession_json as string, { professionId: '', revision: '', displayName: '' }),
    state: row.state as ReviewRun['state'],
    stage: row.stage === null ? undefined : String(row.stage),
    startedAt: row.started_at === null ? undefined : String(row.started_at),
    endedAt: row.ended_at === null ? undefined : String(row.ended_at),
    findings: jsonParse<ReviewRun['findings']>(row.findings_json as string, []),
    summary: jsonParse<ReviewRun['summary'] | undefined>(row.summary_json as string | null, undefined),
    usage: jsonParse<ReviewRun['usage']>(row.usage_json as string | null, undefined),
    receipt: jsonParse<ReviewRun['receipt']>(row.receipt_json as string, {
      operation: 'review.start',
      requestKey: '',
      bodyHash: '',
      contractVersion: '1',
      status: 'unknown',
      target: {},
      acceptedAt: '',
      auditId: '',
    }),
  };
}

/* ------------------------------------------------------------------ */
/* Fixes                                                               */
/* ------------------------------------------------------------------ */

export class FixRepository {
  readonly #db: SqliteDatabase;

  constructor(db: SqliteDatabase) {
    this.#db = db;
  }

  create(fix: Omit<FixRun, 'fixRunId'> & { fixRunId?: string }): FixRun {
    const fixRunId = fix.fixRunId ?? createId('fix');
    const record: FixRun = { ...fix, fixRunId };
    this.#db
      .prepare(
        `INSERT INTO fixes (id, project_id, execution_id, review_run_id, finding_ids_json, base_json, fix_branch, worktree_id, profession_json,
           verify_command_json, state, outcomes_json, changes_json, verification_json, steps_json, commit_draft_json, fix_revision, actions_json, usage_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        fixRunId,
        record.projectId,
        record.executionId,
        record.reviewRunId,
        jsonStringify(record.findingIds),
        jsonStringify(record.base),
        record.fixBranch,
        record.worktreeId,
        jsonStringify(record.profession),
        record.verifyCommand === null ? null : jsonStringify(record.verifyCommand),
        record.state,
        jsonStringify(record.outcomes),
        record.changes === undefined ? null : jsonStringify(record.changes),
        record.verification === undefined ? null : jsonStringify(record.verification),
        jsonStringify(record.steps),
        record.commitDraft === undefined ? null : jsonStringify(record.commitDraft),
        record.fixRevision,
        jsonStringify(record.actions),
        record.usage === undefined ? null : jsonStringify(record.usage),
      );
    return record;
  }

  get(id: string): FixRun | undefined {
    const row = this.#db.prepare('SELECT * FROM fixes WHERE id = ?').get(id) as Row | undefined;
    return row === undefined ? undefined : mapFix(row);
  }

  listByProject(projectId: string): readonly FixRun[] {
    const rows = this.#db.prepare('SELECT * FROM fixes WHERE project_id = ? ORDER BY rowid DESC').all(projectId) as unknown as Row[];
    return rows.map(mapFix);
  }

  /** Runs that were in flight when the process stopped (used for recovery). */
  listActive(): readonly FixRun[] {
    const rows = this.#db
      .prepare("SELECT * FROM fixes WHERE state IN ('preparing','editing','verifying','stopping') ORDER BY rowid ASC")
      .all() as unknown as Row[];
    return rows.map(mapFix);
  }

  update(fix: FixRun): FixRun {
    this.#db
      .prepare(
        `UPDATE fixes SET state = ?, outcomes_json = ?, changes_json = ?, verification_json = ?, steps_json = ?, commit_draft_json = ?, fix_revision = ?, actions_json = ?, usage_json = ? WHERE id = ?`,
      )
      .run(
        fix.state,
        jsonStringify(fix.outcomes),
        fix.changes === undefined ? null : jsonStringify(fix.changes),
        fix.verification === undefined ? null : jsonStringify(fix.verification),
        jsonStringify(fix.steps),
        fix.commitDraft === undefined ? null : jsonStringify(fix.commitDraft),
        fix.fixRevision,
        jsonStringify(fix.actions),
        fix.usage === undefined ? null : jsonStringify(fix.usage),
        fix.fixRunId,
      );
    return fix;
  }
}

function mapFix(row: Row): FixRun {
  return {
    fixRunId: String(row.id),
    projectId: String(row.project_id),
    executionId: String(row.execution_id),
    reviewRunId: String(row.review_run_id),
    findingIds: jsonParse<FixRun['findingIds']>(row.finding_ids_json as string, []),
    base: jsonParse<FixRun['base']>(row.base_json as string, { branch: '', tipSha: '', reviewedSha: '', commitsAfterReviewed: 0 }),
    fixBranch: String(row.fix_branch),
    worktreeId: String(row.worktree_id),
    profession: jsonParse<FixRun['profession']>(row.profession_json as string, { professionId: '', revision: '', displayName: '' }),
    verifyCommand: jsonParse<FixRun['verifyCommand']>(row.verify_command_json as string | null, null),
    state: row.state as FixRun['state'],
    outcomes: jsonParse<FixRun['outcomes']>(row.outcomes_json as string, []),
    changes: jsonParse<FixRun['changes'] | undefined>(row.changes_json as string | null, undefined),
    verification: jsonParse<FixRun['verification'] | undefined>(row.verification_json as string | null, undefined),
    steps: jsonParse<FixRun['steps']>(row.steps_json as string, []),
    commitDraft: jsonParse<FixRun['commitDraft'] | undefined>(row.commit_draft_json as string | null, undefined),
    fixRevision: String(row.fix_revision),
    actions: jsonParse<FixRun['actions']>(row.actions_json as string, {}),
    usage: jsonParse<FixRun['usage']>(row.usage_json as string | null, undefined),
  };
}
