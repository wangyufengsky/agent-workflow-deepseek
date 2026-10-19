import type { TaskSummary } from './models.ts';
export type InsightsQuality = 'passed' | 'pending_acceptance' | 'pending_review' | 'issues';
export type QualityEvidenceState = import('./enums.ts').QualityCheckStatusValue;
export interface QualityEvidenceSource { readonly kind: 'test_run' | 'attempt' | 'code_review' | 'human'; readonly id: string; readonly label: string; readonly href: string }
export interface TaskQualityCheck { readonly kind: 'program' | 'requirement' | 'risk' | 'human' | 'code_review'; readonly state: QualityEvidenceState; readonly required: boolean; readonly reason: string; readonly passed?: number; readonly failed?: number; readonly skipped?: number; readonly sources: readonly QualityEvidenceSource[] }
export interface TaskQualityEvidence { readonly checks: readonly TaskQualityCheck[]; readonly codeReview: TaskQualityCheck; readonly summary: InsightsQuality }
export interface TaskUsageView {
  readonly qualityEvidence?: TaskQualityEvidence;
  readonly taskId: string;
  readonly tokens?: number;
  readonly knownRecords: number;
  readonly unknownRecords: number;
  readonly costs: readonly { readonly currency: string; readonly amount: number }[];
  readonly unknownCostRecords: number;
  /** Sum of measured run intervals, not wall-clock task elapsed time. */
  readonly durationMs?: number;
  readonly unknownDurationRecords: number;
  readonly retries: number;
  readonly stages: Readonly<Record<'planning' | 'execution' | 'review' | 'fix', number>>;
  readonly quality: InsightsQuality;
}
export interface InsightsFilters { readonly projectId: string; readonly status: string; readonly quality: 'all' | InsightsQuality; readonly includeArchived: boolean; readonly keyword: string }
export function filterInsightsTasks(tasks: readonly TaskSummary[], usage: readonly TaskUsageView[], filters: InsightsFilters): readonly TaskSummary[] {
  const byId = new Map(usage.map((item) => [item.taskId, item])); const needle = filters.keyword.trim().toLowerCase();
  return tasks.filter((task) => (filters.includeArchived || !task.archivedAt) && (!filters.projectId || task.projectId === filters.projectId) && (filters.status === 'all' || task.lifecycle === filters.status) && (filters.quality === 'all' || byId.get(task.id)?.quality === filters.quality) && (!needle || task.title.toLowerCase().includes(needle)));
}
export function aggregateTaskUsage(rows: readonly TaskUsageView[]) {
  const costs = new Map<string, number>();
  for (const row of rows) for (const cost of row.costs) costs.set(cost.currency, (costs.get(cost.currency) ?? 0) + cost.amount);
  const measured = rows.filter((row) => row.tokens !== undefined);
  return { tokens: measured.length ? measured.reduce((sum, row) => sum + row.tokens!, 0) : undefined, knownTasks: measured.length, unknownTasks: rows.length - measured.length, unknownRecords: rows.reduce((sum, row) => sum + row.unknownRecords, 0), unknownCostRecords: rows.reduce((sum, row) => sum + row.unknownCostRecords, 0), costs: [...costs].sort(([a], [b]) => a.localeCompare(b)).map(([currency, amount]) => ({ currency, amount })) };
}
