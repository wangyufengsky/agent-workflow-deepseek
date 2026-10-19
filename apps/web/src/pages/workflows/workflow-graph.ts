import { explicitMethodSteps, methodCycle, type MethodStepDefinition } from '@agent-workflow/shared';

/** Edits always materialize legacy implicit edges before changing array order. */
export function addWorkflowStep(steps: readonly MethodStepDefinition[], step: MethodStepDefinition, anchor?: string, mode: 'after' | 'parallel' = 'after'): MethodStepDefinition[] {
  const graph = explicitMethodSteps(steps);
  const parent = graph.find((item) => item.key === anchor);
  if (parent === undefined) return [...graph, { ...step, requires: graph.length === 0 ? [] : [graph.at(-1)!.key] }];
  const inserted = { ...step, requires: mode === 'parallel' ? [...parent.requires!] : [parent.key] };
  const result = graph.map((item) => {
    if (!item.requires!.includes(parent.key)) return item;
    return { ...item, requires: mode === 'parallel' ? [...item.requires!, step.key] : item.requires!.map((key) => key === parent.key ? step.key : key) };
  });
  result.splice(result.findIndex((item) => item.key === parent.key) + 1, 0, inserted);
  return result;
}

export function removeWorkflowStep(steps: readonly MethodStepDefinition[], key: string): MethodStepDefinition[] {
  const graph = explicitMethodSteps(steps);
  const removed = graph.find((item) => item.key === key);
  return graph.filter((item) => item.key !== key).map((item) => ({ ...item, requires: [...new Set(item.requires!.flatMap((dependency) => dependency === key ? removed?.requires ?? [] : [dependency]))] }));
}

export function connectWorkflowSteps(steps: readonly MethodStepDefinition[], from: string, to: string): MethodStepDefinition[] | undefined {
  if (from === to || !steps.some((step) => step.key === from) || !steps.some((step) => step.key === to)) return undefined;
  const graph = explicitMethodSteps(steps).map((step) => step.key === to ? { ...step, requires: [...new Set([...step.requires!, from])] } : step);
  return methodCycle(graph) === undefined ? graph : undefined;
}

export interface WorkflowDifference { readonly key: string; readonly title: string; readonly kind: 'added' | 'removed' | 'modified'; readonly fields: readonly string[] }
export function workflowDifferences(before: readonly MethodStepDefinition[], after: readonly MethodStepDefinition[]): WorkflowDifference[] {
  const a = explicitMethodSteps(before); const b = explicitMethodSteps(after);
  const fields = ['title', 'kind', 'group', 'roleId', 'summary', 'inputs', 'outputs', 'acceptance', 'optional', 'requires', 'position'] as const;
  const result: WorkflowDifference[] = [];
  for (const step of a) {
    const next = b.find((item) => item.key === step.key);
    if (next === undefined) result.push({ key: step.key, title: step.title, kind: 'removed', fields: [] });
    else { const changed = fields.filter((field) => JSON.stringify(step[field]) !== JSON.stringify(next[field])); if (changed.length > 0) result.push({ key: step.key, title: next.title, kind: 'modified', fields: changed }); }
  }
  for (const step of b) if (!a.some((item) => item.key === step.key)) result.push({ key: step.key, title: step.title, kind: 'added', fields: [] });
  return result;
}

/** Stable topological columns; independent steps share a column with separate rows. */
export function workflowLayout(steps: readonly MethodStepDefinition[]): ReadonlyMap<string, { x: number; y: number }> {
  const graph = explicitMethodSteps(steps);
  const ranks = new Map<string, number>();
  const rank = (key: string, visiting = new Set<string>()): number => {
    if (ranks.has(key)) return ranks.get(key)!;
    if (visiting.has(key)) return 0;
    visiting.add(key);
    const dependencies = graph.find((step) => step.key === key)?.requires ?? [];
    const value = dependencies.length === 0 ? 0 : 1 + Math.max(...dependencies.map((dependency) => rank(dependency, new Set(visiting))));
    ranks.set(key, value); return value;
  };
  const rows = new Map<number, number>();
  return new Map(graph.map((step) => { const column = rank(step.key); const row = rows.get(column) ?? 0; rows.set(column, row + 1); return [step.key, { x: column * 300, y: row * 160 + 60 }]; }));
}
