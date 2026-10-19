import type { MethodStepDefinition } from './models.ts';

/** Missing dependencies preserve legacy ordered catalogs; [] explicitly starts a branch. */
export function methodDependencies(steps: readonly MethodStepDefinition[], index: number): readonly string[] {
  return steps[index]?.requires ?? (index > 0 && steps[index - 1] !== undefined ? [steps[index - 1]!.key] : []);
}

export function explicitMethodSteps(steps: readonly MethodStepDefinition[]): MethodStepDefinition[] {
  return steps.map((step, index) => ({ ...step, requires: [...methodDependencies(steps, index)] }));
}

export function methodCycle(steps: readonly MethodStepDefinition[]): readonly string[] | undefined {
  const graph = new Map(steps.map((step, index) => [step.key, methodDependencies(steps, index)]));
  const seen = new Set<string>();
  const path: string[] = [];
  const visit = (key: string): readonly string[] | undefined => {
    if (path.includes(key)) return [...path.slice(path.indexOf(key)), key];
    if (seen.has(key)) return undefined;
    path.push(key);
    for (const dependency of graph.get(key) ?? []) { const cycle = visit(dependency); if (cycle !== undefined) return cycle; }
    path.pop(); seen.add(key);
    return undefined;
  };
  for (const step of steps) { const cycle = visit(step.key); if (cycle !== undefined) return cycle; }
  return undefined;
}
