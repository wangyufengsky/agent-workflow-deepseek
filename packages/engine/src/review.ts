import { createHash } from 'node:crypto';
import type {
  CatalogSnapshot,
  CommandResponse,
  DiffHunk,
  DiffPage,
  DimensionValue,
  FileChange,
  GitCommit,
  GitCompareBase,
  ModelProfile,
  Project,
  ReviewFinding,
  ReviewFindingUpdateRequest,
  ReviewResponse,
  ReviewRun,
  ReviewRunStateValue,
  ReviewStartRequest,
  SeverityValue,
} from '@agent-workflow/shared';
import {
  AppError,
  DIMENSION_ORDER,
  DEFAULT_CATALOG,
  ErrorCode,
  FindingStatus,
  ReviewRunState,
  SEVERITY_ORDER,
  Severity,
  createId,
  nowIso,
} from '@agent-workflow/shared';
import type { SessionSink } from '@agent-workflow/opencode';
import type { Store } from '@agent-workflow/storage';
import type { EngineContext } from './actions.ts';
import type { CommandService } from './operations.ts';
import type { GitPort, OpenCodePort } from './ports.ts';

/**
 * AI review (read-only) over one commit compared with a resolved base.
 *
 * The server is the only authority: the start request is recorded in the
 * request-key ledger, the model output must be a strict JSON object, and every
 * claim (severity, dimension, file, line) is validated against the diff the
 * service itself read through the Git port. Unverifiable findings are dropped
 * and counted; nothing is invented.
 */

const ACTIVE_REVIEW_STATES: readonly ReviewRunStateValue[] = [
  ReviewRunState.QUEUED,
  ReviewRunState.RUNNING,
  ReviewRunState.STOPPING,
];

const MAX_FINDINGS = 200;
const MAX_FILES_IN_PROMPT = 40;
const MAX_DIFF_CHARS = 80_000;
const MAX_TITLE_CHARS = 300;
const MAX_DETAIL_CHARS = 4_000;
const MAX_SUMMARY_CHARS = 4_000;
const MAX_LOCATION_LINES = 500;

export interface ReviewServiceOptions {
  readonly store: Store;
  readonly commands: CommandService;
  readonly context: EngineContext;
  readonly git: GitPort;
  readonly opencode: OpenCodePort;
  /** Catalog supplies the frozen profession (role) name and revision. */
  readonly catalog?: CatalogSnapshot;
  /** Override for tests; defaults to the planning per-dispatch limit. */
  readonly timeoutMs?: number;
}

interface DiffContext {
  readonly files: ReadonlyMap<string, FileChange>;
  readonly pages: ReadonlyMap<string, DiffPage>;
  readonly unreadable: ReadonlySet<string>;
}

interface ParsedFinding {
  readonly finding: Omit<ReviewFinding, 'reviewRunId' | 'ordinal'>;
  /** True when the location could not be checked (binary/truncated/unreadable diff). */
  readonly unverified: boolean;
}

export const REVIEW_OUTPUT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'findings'],
  properties: {
    summary: { type: 'string', description: '一句话结论（审查范围与总体判断）' },
    findings: {
      type: 'array',
      description: '发现的问题；没有问题时返回空数组',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['severity', 'dimension', 'title', 'detail'],
        properties: {
          severity: { type: 'string', enum: [...SEVERITY_ORDER] },
          dimension: { type: 'string', enum: [...DIMENSION_ORDER] },
          path: { type: 'string', description: '相对仓库根的文件路径，必须属于本次 diff' },
          startLine: { type: 'integer', minimum: 1 },
          endLine: { type: 'integer', minimum: 1 },
          side: { type: 'string', enum: ['old', 'new'] },
          title: { type: 'string' },
          detail: { type: 'string' },
        },
      },
    },
  },
};

export const REVIEW_SYSTEM_PROMPT = `你是「代码审查员（reviewer）」，只读审查，不修改任何文件。
硬性规则：
1. 只输出一个 JSON 对象，不要 Markdown 代码块、不要解释、不要前后缀。结构：
   {"summary":"一句话结论","findings":[{"severity":"blocker|critical|major|suggestion","dimension":"correctness|security|performance|quality|style|tests","path":"相对路径","startLine":12,"endLine":14,"side":"old|new","title":"问题标题","detail":"依据与建议"}]}
2. 只报告本次 diff 引入或直接相关的问题；不要报告与本次改动无关的历史问题。
3. path 必须是本次 diff 中出现的文件；行号必须是该文件中 diff 可见的行；side=new 指新版本行号，side=old 指旧版本行号。
4. 没有问题就输出 {"summary":"...","findings":[]}。不要编造问题，不要为了凑数降低标准。
5. 只使用被要求的维度；不在要求内的维度不要报告。
6. 你可以使用只读工具查看项目中的相关文件，但不得尝试修改、提交或访问网络。`;

/**
 * Last-resort tolerant extraction used only to recover a JSON object from a
 * fenced or lightly wrapped model answer. A missing object is an explicit
 * failure, never an empty result.
 */
export function extractJsonObject(text: string): unknown | undefined {
  const trimmed = text.trim();
  const candidates: string[] = [];
  if (trimmed.startsWith('{')) candidates.push(trimmed);
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const fenced = fence?.[1]?.trim();
  if (fenced !== undefined && fenced !== '') candidates.push(fenced);
  const balanced = firstBalancedObject(text);
  if (balanced !== undefined) candidates.push(balanced);
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // Try the next representation.
    }
  }
  return undefined;
}

function firstBalancedObject(text: string): string | undefined {
  const start = text.indexOf('{');
  if (start < 0) return undefined;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }
  return undefined;
}

/**
 * Deterministic status revision over every finding status. It is stable across
 * restarts and changes whenever a status or its reason changes, which makes it
 * usable as the optimistic-concurrency token for `review.finding.update`.
 */
export function findingStatusRevision(review: Pick<ReviewRun, 'findings'>): string {
  const canonical = review.findings
    .map((finding) => `${finding.findingId}:${finding.status}:${finding.statusReason ?? ''}`)
    .sort()
    .join('|');
  return createHash('sha256').update(canonical, 'utf8').digest('hex').slice(0, 24);
}

export class ReviewService {
  readonly #store: Store;
  readonly #commands: CommandService;
  readonly #context: EngineContext;
  readonly #git: GitPort;
  readonly #opencode: OpenCodePort;
  readonly #catalog: CatalogSnapshot;
  readonly #timeoutMs: number | undefined;
  readonly #stopKeys = new Map<string, string>();
  readonly #sessions = new Map<string, string>();

  constructor(options: ReviewServiceOptions) {
    this.#store = options.store;
    this.#commands = options.commands;
    this.#context = options.context;
    this.#git = options.git;
    this.#opencode = options.opencode;
    this.#catalog = options.catalog ?? DEFAULT_CATALOG;
    this.#timeoutMs = options.timeoutMs;
  }

  async start(projectId: string, input: ReviewStartRequest): Promise<CommandResponse<ReviewResponse>> {
    if (input === null || typeof input !== 'object') throw new AppError(ErrorCode.VALIDATION_FAILED, '审查请求体不合法');
    const project = this.#requireProject(projectId);
    this.#assertGitProject(project);
    const sha = requireNonEmpty(input.sha, '提交 SHA');
    const compareId = requireNonEmpty(input.compareId, '对比基线');
    const dimensions = normalizeDimensions(input.dimensions);
    const context = normalizeContext(input.context);
    const profession = this.#resolveProfession(input.professionId, input.professionRevision);
    const model = this.#requireModel('reviewer');
    this.#assertOpencodeUsable();

    const commit = await this.#git.commitShow(project.rootPath, sha);
    if (commit === undefined) throw new AppError(ErrorCode.REVISION_NOT_FOUND, '提交不存在，无法审查');
    const compareBase = resolveCompareBase(commit, compareId);

    const { record, replayed } = this.#commands.begin({
      requestKey: input.requestKey,
      operation: 'review.start',
      body: {
        projectId,
        sha,
        compareId,
        dimensions,
        context,
        professionId: profession.professionId,
        professionRevision: profession.revision,
        model: model.id,
      },
      target: { projectId, ref: sha },
    });
    if (replayed) {
      const existing = this.#reviewsByRequestKey(projectId, input.requestKey);
      if (existing !== undefined) return { receipt: this.#commands.toReceipt(record), resource: { review: existing } };
      if (record.status !== 'accepted') return { receipt: this.#commands.toReceipt(record) };
      throw new AppError(ErrorCode.OPERATION_IN_PROGRESS, '同一请求号已受理但还没有审查记录；请按 requestKey 核对回执', {
        details: { requestKey: input.requestKey },
      });
    }

    const active = this.#activeReview(projectId, sha, compareId);
    if (active !== undefined) {
      const conflict = new AppError(ErrorCode.OPERATION_IN_PROGRESS, '该提交在同一对比基线下已有进行中的审查', {
        details: { reviewRunId: active.reviewRunId, state: active.state },
      });
      this.#commands.fail(input.requestKey, conflict);
      throw conflict;
    }

    const created = this.#store.reviews.create({
      projectId,
      executionId: createId('exec'),
      subject: { commitSha: sha, compareBase },
      dimensions,
      context,
      profession,
      state: ReviewRunState.QUEUED,
      stage: 'queued',
      startedAt: nowIso(),
      findings: [],
      receipt: this.#commands.toReceipt(record),
    });
    this.#publish(created, ReviewRunState.QUEUED);
    void this.#run(created.reviewRunId).catch((error: unknown) => {
      this.#fail(created.reviewRunId, created.receipt.requestKey, error);
    });
    return { receipt: this.#commands.toReceipt(record), resource: { review: this.#requireReview(projectId, created.reviewRunId) } };
  }

  get(projectId: string, reviewRunId: string): ReviewRun {
    return this.#requireReview(projectId, reviewRunId);
  }

  list(projectId: string): readonly ReviewRun[] {
    this.#requireProject(projectId);
    return this.#store.reviews.listByProject(projectId);
  }

  async stop(projectId: string, reviewRunId: string, input: { readonly requestKey: string }): Promise<CommandResponse> {
    const review = this.#requireReview(projectId, reviewRunId);
    if (!ACTIVE_REVIEW_STATES.includes(review.state)) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, '审查已结束，无需停止', { details: { state: review.state } });
    }
    const { record, replayed } = this.#commands.begin({
      requestKey: input.requestKey,
      operation: 'review.stop',
      body: { projectId, reviewRunId },
      target: { projectId, ref: review.subject.commitSha },
    });
    if (replayed && record.status !== 'accepted') return { receipt: this.#commands.toReceipt(record) };
    if (review.state !== ReviewRunState.STOPPING) {
      const updated: ReviewRun = { ...review, state: ReviewRunState.STOPPING, stage: 'stopping' };
      this.#store.reviews.update(updated);
      this.#publish(updated, ReviewRunState.STOPPING);
    }
    this.#stopKeys.set(reviewRunId, input.requestKey);
    const sessionId = this.#sessions.get(reviewRunId);
    if (sessionId !== undefined) {
      await this.#opencode.abortSession(sessionId).catch(() => undefined);
    }
    return { receipt: this.#commands.toReceipt(this.#commands.get(input.requestKey) ?? record) };
  }

  async updateFinding(projectId: string, findingId: string, input: ReviewFindingUpdateRequest): Promise<CommandResponse> {
    const status = normalizeFindingStatus(input.status);
    const review = this.#findReviewByFinding(projectId, findingId);
    const existing = review.findings.find((finding) => finding.findingId === findingId);
    if (existing === undefined) throw new AppError(ErrorCode.NOT_FOUND, '审查问题不存在');
    const currentRevision = findingStatusRevision(review);
    const expected = input.expectedStatusRevision;
    if (expected !== undefined && expected !== '' && expected !== currentRevision) {
      throw new AppError(ErrorCode.STALE_TARGET, '问题状态已被更新，请重新读取后再操作', {
        details: { expected, actual: currentRevision },
      });
    }
    const { record, replayed } = this.#commands.begin({
      requestKey: input.requestKey,
      operation: 'review.finding.update',
      body: { projectId, findingId, status, reason: input.reason ?? '', expectedStatusRevision: expected ?? '' },
      target: { projectId, ref: review.subject.commitSha },
    });
    if (replayed && record.status !== 'accepted') return { receipt: this.#commands.toReceipt(record) };
    const reason = typeof input.reason === 'string' && input.reason.trim() !== '' ? input.reason.trim().slice(0, 1_000) : undefined;
    const findings = review.findings.map((finding) =>
      finding.findingId === findingId ? { ...finding, status, ...(reason === undefined ? {} : { statusReason: reason }) } : finding,
    );
    const updated: ReviewRun = { ...review, findings };
    this.#store.reviews.update(updated);
    this.#publish(updated, updated.state);
    const nextRevision = findingStatusRevision(updated);
    this.#commands.settle(input.requestKey, { findingId, status, statusRevision: nextRevision });
    return { receipt: this.#commands.toReceipt(this.#commands.get(input.requestKey) ?? record) };
  }

  async #run(reviewRunId: string): Promise<void> {
    const review = this.#store.reviews.get(reviewRunId);
    if (review === undefined) return;
    const project = this.#requireProject(review.projectId);
    const startKey = review.receipt.requestKey;
    try {
      const reading: ReviewRun = { ...review, state: ReviewRunState.RUNNING, stage: 'reading_diff', startedAt: review.startedAt ?? nowIso() };
      this.#store.reviews.update(reading);
      this.#publish(reading, ReviewRunState.RUNNING);

      const commit = await this.#git.commitShow(project.rootPath, reading.subject.commitSha);
      if (commit === undefined) throw new AppError(ErrorCode.REVISION_NOT_FOUND, '提交已不存在，无法完成审查');
      const baseSha = reading.subject.compareBase.baseSha;
      const headSha = reading.subject.commitSha;
      const files = await this.#git.diffFiles({ repoRoot: project.rootPath, baseSha, headSha });

      if (files.length === 0) {
        this.#complete(reviewRunId, startKey, [], `本次对比 ${shortSha(baseSha)}..${shortSha(headSha)} 没有文本改动；服务未调用模型，也没有推断任何问题。`);
        return;
      }

      const diffContext = await this.#collectDiff(project.rootPath, baseSha, headSha, files);
      if (this.#isStopping(reviewRunId)) {
        this.#markStopped(reviewRunId);
        return;
      }
      const analyzing: ReviewRun = { ...this.#store.reviews.get(reviewRunId)!, stage: 'analyzing' };
      this.#store.reviews.update(analyzing);
      this.#publish(analyzing, analyzing.state);

      const model = this.#requireModel('reviewer');
      const prompt = this.#buildPrompt(reading, commit, diffContext);
      const result = await this.#opencode.runSession({
        kind: 'review',
        metadata: { projectId: review.projectId, reviewRunId },
        cwd: project.rootPath,
        prompt,
        system: REVIEW_SYSTEM_PROMPT,
        model,
        permission: 'read_only',
        sink: this.#sink(reviewRunId),
        timeoutMs: this.#timeoutBudget(),
        onSessionId: (sessionId) => {
          this.#sessions.set(reviewRunId, sessionId);
        },
      });

      if (this.#isStopping(reviewRunId)) {
        this.#markStopped(reviewRunId);
        return;
      }
      if (result.outcome.timedOut) {
        const failure = new AppError(ErrorCode.MODEL_BUDGET_EXCEEDED, '审查超过时限，结果待核对');
        this.#fail(reviewRunId, startKey, failure, true);
        return;
      }
      if (result.outcome.error !== undefined && result.outcome.error !== '') {
        this.#fail(reviewRunId, startKey, new AppError(ErrorCode.OPENCODE_PROVIDER_FAILED, `审查会话失败：${result.outcome.error}`));
        return;
      }

      const summarizing: ReviewRun = { ...this.#store.reviews.get(reviewRunId)!, stage: 'summarizing' };
      this.#store.reviews.update(summarizing);
      this.#publish(summarizing, summarizing.state);

      const parsed = extractJsonObject(result.outcome.assistantText);
      if (!isRecord(parsed) || !Array.isArray(parsed.findings)) {
        this.#fail(
          reviewRunId,
          startKey,
          new AppError(ErrorCode.VALIDATION_FAILED, '模型输出不是约定的严格 JSON（缺少 findings 数组），本次审查按失败处理'),
        );
        return;
      }
      const summaryText = typeof parsed.summary === 'string' ? parsed.summary.trim().slice(0, MAX_SUMMARY_CHARS) : '';
      const { findings, discarded, unverified } = this.#parseFindings(reviewRunId, reading, parsed.findings, diffContext);
      const notes: string[] = [];
      if (diffContext.unreadable.size > 0) notes.push(`${diffContext.unreadable.size} 个文件的 diff 无法读取，未纳入模型输入。`);
      if (summaryText === '') notes.push('模型没有给出结论摘要。');
      if (discarded > 0) notes.push(`服务丢弃了 ${discarded} 条无法在本次 diff 中定位或字段不合法的问题。`);
      if (unverified > 0) notes.push(`${unverified} 条问题的行号因二进制/截断的 diff 无法核对，已保留但未校验。`);
      this.#complete(reviewRunId, startKey, findings, [summaryText, ...notes].filter((part) => part !== '').join('\n'));
    } catch (error) {
      if (this.#isStopping(reviewRunId)) {
        this.#markStopped(reviewRunId);
        return;
      }
      this.#fail(reviewRunId, startKey, error);
    } finally {
      this.#sessions.delete(reviewRunId);
    }
  }

  #complete(reviewRunId: string, startKey: string, findings: readonly ReviewFinding[], summaryText: string): void {
    const current = this.#store.reviews.get(reviewRunId);
    if (current === undefined) return;
    const record = this.#commands.get(startKey);
    if (record !== undefined && record.status === 'accepted') this.#commands.settle(startKey, { reviewRunId, findings: findings.length });
    const completed: ReviewRun = {
      ...current,
      state: ReviewRunState.COMPLETED,
      stage: 'completed',
      endedAt: nowIso(),
      findings,
      summary: buildSummary(summaryText, findings),
      receipt: this.#commands.toReceipt(this.#commands.get(startKey)!),
    };
    this.#store.reviews.update(completed);
    this.#publish(completed, ReviewRunState.COMPLETED);
  }

  #fail(reviewRunId: string, startKey: string, error: unknown, unknown = false): void {
    const current = this.#store.reviews.get(reviewRunId);
    if (current === undefined) return;
    const failure = error instanceof AppError ? error : new AppError(ErrorCode.INTERNAL_ERROR, error instanceof Error ? error.message : '审查失败');
    const record = this.#commands.get(startKey);
    if (record !== undefined && record.status === 'accepted') this.#commands.fail(startKey, failure, unknown);
    const failed: ReviewRun = {
      ...current,
      state: unknown ? ReviewRunState.UNKNOWN : ReviewRunState.FAILED,
      stage: unknown ? 'unknown' : 'failed',
      endedAt: unknown ? current.endedAt : nowIso(),
      receipt: this.#commands.get(startKey) === undefined ? current.receipt : this.#commands.toReceipt(this.#commands.get(startKey)!),
    };
    this.#store.reviews.update(failed);
    this.#publish(failed, failed.state);
  }

  #markStopped(reviewRunId: string): void {
    const current = this.#store.reviews.get(reviewRunId);
    if (current === undefined) return;
    const startKey = current.receipt.requestKey;
    const startRecord = this.#commands.get(startKey);
    if (startRecord !== undefined && startRecord.status === 'accepted') this.#commands.settle(startKey, { stopped: true });
    const stopKey = this.#stopKeys.get(reviewRunId);
    if (stopKey !== undefined) {
      const stopRecord = this.#commands.get(stopKey);
      if (stopRecord !== undefined && stopRecord.status === 'accepted') this.#commands.settle(stopKey, { stopped: true });
    }
    this.#stopKeys.delete(reviewRunId);
    const stopped: ReviewRun = {
      ...current,
      state: ReviewRunState.STOPPED,
      stage: 'stopped',
      endedAt: nowIso(),
      receipt: this.#commands.get(startKey) === undefined ? current.receipt : this.#commands.toReceipt(this.#commands.get(startKey)!),
    };
    this.#store.reviews.update(stopped);
    this.#publish(stopped, ReviewRunState.STOPPED);
  }

  #isStopping(reviewRunId: string): boolean {
    return this.#store.reviews.get(reviewRunId)?.state === ReviewRunState.STOPPING;
  }

  #parseFindings(
    reviewRunId: string,
    review: ReviewRun,
    raw: readonly unknown[],
    context: DiffContext,
  ): { findings: ReviewFinding[]; discarded: number; unverified: number } {
    const findings: ReviewFinding[] = [];
    let discarded = 0;
    let unverified = 0;
    for (const item of raw.slice(0, MAX_FINDINGS * 4)) {
      if (findings.length >= MAX_FINDINGS) {
        discarded += 1;
        continue;
      }
      const parsed = parseFinding(item, review, context);
      if (parsed === undefined) {
        discarded += 1;
        continue;
      }
      findings.push({ ...parsed.finding, reviewRunId, ordinal: findings.length + 1 });
      if (parsed.unverified) unverified += 1;
    }
    return { findings, discarded, unverified };
  }

  async #collectDiff(repoRoot: string, baseSha: string, headSha: string, files: readonly FileChange[]): Promise<DiffContext> {
    const fileMap = new Map<string, FileChange>();
    for (const file of files) fileMap.set(file.path, file);
    const pages = new Map<string, DiffPage>();
    const unreadable = new Set<string>();
    for (const file of files) {
      if (file.binary) continue;
      try {
        const page = await this.#git.diffPage({ repoRoot, baseSha, headSha, path: file.path });
        pages.set(file.path, page);
      } catch {
        unreadable.add(file.path);
      }
    }
    return { files: fileMap, pages, unreadable };
  }

  #buildPrompt(review: ReviewRun, commit: GitCommit, context: DiffContext): string {
    const role = this.#catalog.roles.find((item) => item.id === review.profession.professionId);
    const responsibilities = role === undefined ? [] : role.responsibilities.map((item) => `- ${item}`).join('\n');
    const dimensionList = review.dimensions.map((dimension) => `${dimension}${DIMENSION_LABEL[dimension] === undefined ? '' : `（${DIMENSION_LABEL[dimension]}）`}`).join('\n');
    const rendered = renderDiff(context, MAX_FILES_IN_PROMPT, MAX_DIFF_CHARS);
    return `# 审查任务
项目：${review.projectId}
提交：${review.subject.commitSha}（${commit.subject}）
作者：${commit.author.name}
对比基线：${review.subject.compareBase.label} · ${review.subject.compareBase.baseSha}
范围：${review.context === 'diff_only' ? '只看本次改动' : '本次改动 + 相关文件（可使用只读工具查看相关文件）'}
职业：${review.profession.displayName}（${review.profession.professionId}@${review.profession.revision}）
${responsibilities}

# 审查维度
${dimensionList}

# 本次 diff
${rendered.text}

# 输出要求
只输出 JSON 对象：{"summary":"一句话结论","findings":[...]}。
fields：severity ∈ blocker/critical/major/suggestion；dimension ∈ ${review.dimensions.join('/')}；path 必须来自上面的文件列表；
startLine/endLine 必须落在 diff 行号内；side=old 用旧版本行号，side=new 用新版本行号。
没有问题就返回空 findings；不要臆造。${rendered.notes.length === 0 ? '' : `\n服务提示：${rendered.notes.join('；')}`}`;
  }

  #sink(reviewRunId: string): SessionSink {
    const touch = (): void => {
      const current = this.#store.reviews.get(reviewRunId);
      if (current === undefined || current.state !== ReviewRunState.RUNNING) return;
      const updated: ReviewRun = { ...current, stage: 'analyzing' };
      this.#store.reviews.update(updated);
    };
    return {
      onTool: () => {
        touch();
      },
      onPermission: (permission) => {
        const writeTools = ['edit', 'bash', 'webfetch', 'websearch', 'external_directory'];
        return writeTools.includes(permission.permission) ? 'reject' : 'once';
      },
      onError: () => {
        // The run settles from the returned outcome; transient errors are not success.
      },
    };
  }

  #timeoutBudget(): number {
    if (this.#timeoutMs !== undefined) return this.#timeoutMs;
    const minutes = this.#context.settings().planning.perDispatchLimitMinutes;
    return Math.max(1, Number.isFinite(minutes) ? minutes : 20) * 60_000;
  }

  #publish(review: ReviewRun, state: ReviewRunStateValue | string): void {
    this.#store.events.publish('review.changed', {
      projectId: review.projectId,
      reviewRunId: review.reviewRunId,
      state: String(state),
      revision: Date.now(),
    });
  }

  #reviewsByRequestKey(projectId: string, requestKey: string): ReviewRun | undefined {
    return this.#store.reviews.listByProject(projectId).find((review) => review.receipt.requestKey === requestKey);
  }

  #activeReview(projectId: string, sha: string, compareId: string): ReviewRun | undefined {
    return this.#store.reviews
      .listByProject(projectId)
      .find((review) => ACTIVE_REVIEW_STATES.includes(review.state) && review.subject.commitSha === sha && review.subject.compareBase.compareId === compareId);
  }

  #findReviewByFinding(projectId: string, findingId: string): ReviewRun {
    const review = this.#store.reviews.listByProject(projectId).find((item) => item.findings.some((finding) => finding.findingId === findingId));
    if (review === undefined) throw new AppError(ErrorCode.NOT_FOUND, '审查问题不存在');
    return review;
  }

  #requireReview(projectId: string, reviewRunId: string): ReviewRun {
    const review = this.#store.reviews.get(reviewRunId);
    if (review === undefined || review.projectId !== projectId) throw new AppError(ErrorCode.NOT_FOUND, '审查记录不存在');
    return review;
  }

  #requireProject(projectId: string): Project {
    const project = this.#store.projects.get(projectId);
    if (project === undefined) throw new AppError(ErrorCode.NOT_FOUND, '项目不存在');
    return project;
  }

  #assertGitProject(project: Project): void {
    if (project.gitState !== 'git') throw new AppError(ErrorCode.GIT_CAPABILITY_UNAVAILABLE, '非 Git 项目不支持 AI 审查');
    if (project.rootPath.trim() === '') throw new AppError(ErrorCode.REPO_PATH_UNAVAILABLE, '项目路径不可用');
  }

  #assertOpencodeUsable(): void {
    const status = this.#opencode.status();
    if (status.state !== 'ready' && status.state !== 'starting') {
      throw new AppError(ErrorCode.OPENCODE_NOT_READY, '受管 OpenCode 服务未就绪，无法开始审查');
    }
  }

  #resolveProfession(professionId: unknown, revision: unknown): ReviewRun['profession'] {
    const id = requireNonEmpty(professionId, '审查职业');
    const rev = requireNonEmpty(revision, '职业版本');
    const role = this.#catalog.roles.find((item) => item.id === id);
    if (role === undefined) throw new AppError(ErrorCode.VALIDATION_FAILED, '审查职业不存在或未发布', { details: { professionId: id } });
    if (role.revision !== rev) {
      throw new AppError(ErrorCode.STALE_TARGET, '审查职业版本已更新，请重新选择', { details: { professionId: id, expected: role.revision, actual: rev } });
    }
    return { professionId: id, revision: rev, displayName: role.name };
  }

  #requireModel(role: 'reviewer'): ModelProfile {
    const models = this.#context.settings().models;
    const model = models.find((item) => item.enabled && item.roles.includes(role));
    if (model === undefined) throw new AppError(ErrorCode.MODEL_NOT_CONFIGURED, `没有启用的 ${role} 模型；请先在设置中配置`, { details: { role } });
    return model;
  }
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const DIMENSION_LABEL: Record<DimensionValue, string> = {
  correctness: '缺陷与逻辑',
  security: '安全',
  performance: '性能',
  quality: '代码质量',
  style: '规范与风格',
  tests: '测试覆盖',
};

function normalizeDimensions(value: readonly string[]): readonly DimensionValue[] {
  if (!Array.isArray(value) || value.length === 0) throw new AppError(ErrorCode.VALIDATION_FAILED, '至少选择一个审查维度');
  const seen = new Set<DimensionValue>();
  for (const raw of value) {
    if (typeof raw !== 'string' || !(DIMENSION_ORDER as readonly string[]).includes(raw)) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, `未知审查维度：${String(raw)}`);
    }
    seen.add(raw as DimensionValue);
  }
  return DIMENSION_ORDER.filter((dimension) => seen.has(dimension));
}

function normalizeContext(value: unknown): ReviewRun['context'] {
  if (value === 'diff_only' || value === 'diff_and_related') return value;
  throw new AppError(ErrorCode.VALIDATION_FAILED, '审查上下文只能是 diff_only 或 diff_and_related');
}

function normalizeFindingStatus(value: unknown): ReviewFinding['status'] {
  const statuses: readonly string[] = Object.values(FindingStatus);
  if (typeof value !== 'string' || !statuses.includes(value)) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, `未知问题状态：${String(value)}`);
  }
  return value as ReviewFinding['status'];
}

function resolveCompareBase(commit: GitCommit, compareId: string): GitCompareBase {
  const found = commit.compareOptions.find((option) => option.compareId === compareId);
  if (found === undefined) {
    throw new AppError(ErrorCode.STALE_TARGET, '对比基线已不可用，请重新选择对比范围', {
      details: { compareId, available: commit.compareOptions.map((option) => option.compareId) },
    });
  }
  return found;
}

function parseFinding(raw: unknown, review: ReviewRun, context: DiffContext): ParsedFinding | undefined {
  if (!isRecord(raw)) return undefined;
  const severity = raw.severity;
  const dimension = raw.dimension;
  if (typeof severity !== 'string' || !(SEVERITY_ORDER as readonly string[]).includes(severity)) return undefined;
  if (typeof dimension !== 'string' || !review.dimensions.includes(dimension as DimensionValue)) return undefined;
  const title = typeof raw.title === 'string' ? raw.title.trim().slice(0, MAX_TITLE_CHARS) : '';
  const detail = typeof raw.detail === 'string' ? raw.detail.trim().slice(0, MAX_DETAIL_CHARS) : '';
  if (title === '' || detail === '') return undefined;

  const locationInput = isRecord(raw.location) ? raw.location : raw;
  const path = typeof locationInput.path === 'string' ? locationInput.path.trim() : undefined;
  const base: Omit<ReviewFinding, 'reviewRunId' | 'ordinal'> = {
    findingId: createId('find'),
    severity: severity as SeverityValue,
    dimension: dimension as DimensionValue,
    title,
    detail,
    status: FindingStatus.OPEN,
  };
  if (path === undefined || path === '') return { finding: base, unverified: false };
  if (!context.files.has(path)) return undefined;

  const startLine = toPositiveInteger(locationInput.startLine);
  const endLine = toPositiveInteger(locationInput.endLine);
  const side = locationInput.side === 'old' || locationInput.side === 'new' ? locationInput.side : undefined;
  if (startLine === undefined || endLine === undefined || side === undefined) return undefined;
  if (endLine < startLine || endLine - startLine > MAX_LOCATION_LINES) return undefined;

  const file = context.files.get(path);
  const page = context.pages.get(path);
  const cannotVerify = file?.binary === true || context.unreadable.has(path) || page === undefined || (page.truncated !== undefined && page.truncated !== null);
  if (!cannotVerify && page !== undefined && !locationInHunks(page.hunks, side, startLine, endLine)) return undefined;

  return {
    finding: {
      ...base,
      location: {
        path,
        revision: review.subject.commitSha,
        baseRevision: review.subject.compareBase.baseSha,
        startLine,
        endLine,
        side,
      },
    },
    unverified: cannotVerify,
  };
}

function locationInHunks(hunks: readonly DiffHunk[], side: 'old' | 'new', startLine: number, endLine: number): boolean {
  for (const hunk of hunks) {
    const hunkStart = side === 'old' ? hunk.oldStart : hunk.newStart;
    const hunkLines = side === 'old' ? hunk.oldLines : hunk.newLines;
    if (hunkLines <= 0) {
      if (startLine === hunkStart && endLine === hunkStart) return true;
      continue;
    }
    const hunkEnd = hunkStart + hunkLines - 1;
    if (startLine <= hunkEnd && endLine >= hunkStart) return true;
  }
  return false;
}

function toPositiveInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function renderDiff(context: DiffContext, maxFiles: number, maxChars: number): { text: string; notes: string[] } {
  const blocks: string[] = [];
  const notes: string[] = [];
  let used = 0;
  let included = 0;
  let skipped = 0;
  for (const file of context.files.values()) {
    if (included >= maxFiles) {
      skipped += 1;
      continue;
    }
    const page = context.pages.get(file.path);
    const block = renderFile(file, page, context.unreadable.has(file.path));
    if (used + block.length > maxChars) {
      skipped += 1;
      continue;
    }
    blocks.push(block);
    used += block.length;
    included += 1;
  }
  if (skipped > 0) notes.push(`diff 超出本次审查篇幅，只提供了 ${included} 个文件，其余 ${skipped} 个文件未纳入模型输入`);
  if (blocks.length === 0) notes.push('没有任何可读取的文本 diff');
  return { text: blocks.join('\n\n'), notes };
}

function renderFile(file: FileChange, page: DiffPage | undefined, unreadable: boolean): string {
  const head = `### ${file.path}（${file.status}${file.additions === null ? '' : ` +${file.additions}`}${file.deletions === null ? '' : ` -${file.deletions}`}）`;
  if (file.binary) return `${head}\n[二进制文件，未提供内容]`;
  if (unreadable) return `${head}\n[服务无法读取该文件的 diff]`;
  if (page === undefined || page.hunks.length === 0) return `${head}\n[没有可显示的行级改动]`;
  const lines: string[] = [head];
  for (const hunk of page.hunks) {
    lines.push(hunk.header);
    for (const line of hunk.lines) {
      if (line.kind === 'add') lines.push(`+${line.text}`);
      else if (line.kind === 'del') lines.push(`-${line.text}`);
      else if (line.kind === 'context') lines.push(` ${line.text}`);
      else lines.push(`\\${line.text}`);
    }
  }
  if (page.truncated !== undefined && page.truncated !== null) {
    lines.push(`[该文件的 diff 已截断：${page.truncated.reason}，仅显示 ${page.truncated.shownLines} 行]`);
  }
  return lines.join('\n');
}

function buildSummary(text: string, findings: readonly ReviewFinding[]): ReviewRun['summary'] {
  const countsBySeverity: Record<SeverityValue, number> = {
    [Severity.BLOCKER]: 0,
    [Severity.CRITICAL]: 0,
    [Severity.MAJOR]: 0,
    [Severity.SUGGESTION]: 0,
  };
  const countsByDimension: Partial<Record<DimensionValue, number>> = {};
  for (const finding of findings) {
    countsBySeverity[finding.severity] = (countsBySeverity[finding.severity] ?? 0) + 1;
    countsByDimension[finding.dimension] = (countsByDimension[finding.dimension] ?? 0) + 1;
  }
  return {
    text: text === '' ? '审查完成。' : text,
    countsBySeverity,
    countsByDimension,
  };
}

function requireNonEmpty(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new AppError(ErrorCode.VALIDATION_FAILED, `${label}不能为空`);
  return value.trim();
}

function shortSha(sha: string): string {
  return sha.slice(0, 8);
}
