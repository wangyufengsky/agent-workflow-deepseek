import { createId, methodCycle, type NodeKindValue, type TaskMethodSupportValue } from '@agent-workflow/shared';
import type { WorkflowCatalogDetail, WorkflowDraft, WorkflowStepView, WorkflowValidationProblem } from './workflow-api.ts';

export const WORKFLOW_STEP_KIND_LABEL: Record<NodeKindValue, string> = {
  requirement: '需求',
  design: '设计',
  implementation: '实现',
  test: '测试',
  verify: '验收',
  delivery: '交付',
  system: '系统',
};

export const STEP_KINDS: readonly NodeKindValue[] = ['requirement', 'design', 'implementation', 'test', 'verify', 'delivery', 'system'];

export function draftFromDetail(detail: WorkflowCatalogDetail): WorkflowDraft {
  return {
    name: detail.name,
    description: detail.description,
    support: detail.support,
    requiredSteps: detail.requiredSteps.map((step) => ({
      ...structuredClone(step),
      key: step.key,
      title: step.title,
      kind: step.kind,
      group: step.group,
      ...(step.optional === true ? { optional: true } : {}),
      ...(step.roleId === undefined ? {} : { roleId: step.roleId }),
      ...(step.requires === undefined ? {} : { requires: [...step.requires] }),
    })),
    refinableGroups: [...detail.refinableGroups],
    ...(detail.planningStrategy === undefined ? {} : { planningStrategy: { ...detail.planningStrategy } }),
  };
}

export function draftEquals(left: WorkflowDraft, right: WorkflowDraft): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/** 未保存修改数量：名称/说明/支持方式 + 步骤增删改 + 分组/规划策略。 */
export function countDraftChanges(saved: WorkflowDraft, draft: WorkflowDraft): number {
  let changes = 0;
  if (saved.name !== draft.name) changes += 1;
  if (saved.description !== draft.description) changes += 1;
  if (saved.support !== draft.support) changes += 1;
  if (JSON.stringify(saved.refinableGroups) !== JSON.stringify(draft.refinableGroups)) changes += 1;
  if (JSON.stringify(saved.planningStrategy) !== JSON.stringify(draft.planningStrategy)) changes += 1;
  const savedByKey = new Map(saved.requiredSteps.map((step) => [step.key, step]));
  const draftKeys = new Set(draft.requiredSteps.map((step) => step.key));
  for (const [key, step] of savedByKey) {
    if (!draftKeys.has(key)) {
      changes += 1;
      continue;
    }
    const next = draft.requiredSteps.find((item) => item.key === key);
    if (next !== undefined && JSON.stringify(step) !== JSON.stringify(next)) changes += 1;
  }
  for (const key of draftKeys) {
    if (!savedByKey.has(key)) changes += 1;
  }
  return changes;
}

export function nextStepKey(existing: readonly WorkflowStepView[]): string {
  const used = new Set(existing.map((step) => step.key));
  for (let attempt = 0; attempt < 1000; attempt += 1) {
    const candidate = `step.${createId('x').replace(/^x_/, '').slice(0, 8).toLowerCase()}`;
    if (!used.has(candidate)) return candidate;
  }
  return `step.${String(Date.now())}`;
}

export function newStep(existing: readonly WorkflowStepView[], title: string, kind: NodeKindValue = 'implementation'): WorkflowStepView {
  return { key: nextStepKey(existing), title, kind, group: '固定步骤' };
}

export interface LocalProblem extends WorkflowValidationProblem {
  readonly canLocate: boolean;
}

/**
 * 本地检查（保存前/检查按钮）：
 * - 服务端 `MethodCatalogService.validate` 的确定性规则（步骤非空、键唯一、交付/验守护、职业存在）；
 * - 设计要求「每个执行步骤必须指定职业」在这里作为更严格的产品规则，明确标注为前端规则。
 */
export function localProblems(draft: WorkflowDraft, roleIds: readonly string[]): readonly LocalProblem[] {
  const problems: LocalProblem[] = [];
  const push = (code: string, message: string, extra: { field?: WorkflowValidationProblem['field']; stepKey?: string; canLocate?: boolean } = {}): void => {
    problems.push({ code, message, ...(extra.field === undefined ? {} : { field: extra.field }), ...(extra.stepKey === undefined ? {} : { stepKey: extra.stepKey }), canLocate: extra.canLocate === true });
  };
  if (draft.name.trim() === '') push('NAME_INVALID', '流程名称不能为空', { field: 'name' });
  if (draft.name.trim().length > 120) push('NAME_INVALID', '流程名称不能超过 120 个字符', { field: 'name' });
  if (draft.description.length > 2_000) push('DESCRIPTION_TOO_LONG', '说明不能超过 2000 个字符', { field: 'description' });
  if (draft.requiredSteps.length === 0) push('STEPS_EMPTY', '流程至少需要一个步骤（含交付或验收步骤）', { field: 'requiredSteps' });
  if (draft.requiredSteps.length > 50) push('STEPS_TOO_MANY', '步骤最多 50 个', { field: 'requiredSteps' });
  const keys = new Set<string>();
  const roleSet = new Set(roleIds);
  for (const step of draft.requiredSteps) {
    if (!/^[a-z][a-z0-9_.-]{0,63}$/.test(step.key)) {
      push('STEP_KEY_INVALID', `步骤键「${step.key}」不合法（小写字母开头，可含 ._-）`, { stepKey: step.key, canLocate: true });
    } else if (keys.has(step.key)) {
      push('STEP_KEY_DUPLICATE', `步骤键「${step.key}」重复`, { stepKey: step.key, canLocate: true });
    }
    keys.add(step.key);
    if (step.title.trim() === '') push('STEP_TITLE_INVALID', '有步骤缺少名称', { stepKey: step.key, canLocate: true });
    if (step.group.trim() === '') push('STEP_GROUP_INVALID', `步骤「${step.title || step.key}」缺少分组`, { stepKey: step.key, canLocate: true });
    if (step.roleId === undefined || step.roleId === '') {
      push('STEP_ROLE_MISSING', `步骤「${step.title || step.key}」还没有指定职业（前端规则：执行前必须有明确负责人）`, { stepKey: step.key, canLocate: true });
    } else if (!roleSet.has(step.roleId)) {
      push('STEP_ROLE_UNKNOWN', `步骤「${step.title || step.key}」的职业「${step.roleId}」不在角色目录中`, { stepKey: step.key, canLocate: true });
    }
    for (const dependency of step.requires ?? []) {
      if (!draft.requiredSteps.some((item) => item.key === dependency)) {
        push('STEP_DEPENDENCY_UNKNOWN', `步骤「${step.title || step.key}」依赖不存在的步骤「${dependency}」`, { stepKey: step.key, canLocate: true });
      }
    }
  }
  if (!draft.requiredSteps.some((step) => step.kind === 'delivery' || step.kind === 'verify')) {
    push('DELIVERY_ACCEPTANCE_MISSING', '必须保留至少一个交付或验收步骤', { field: 'requiredSteps' });
  }
  for (const step of draft.requiredSteps) {
    for (const dependency of step.requires ?? []) {
      if (dependency === step.key) push('METHOD_CYCLE', `步骤「${step.title || step.key}」不能依赖自己`, { stepKey: step.key, canLocate: true });
    }
  }
  const cycle = methodCycle(draft.requiredSteps);
  if (cycle !== undefined) push('METHOD_CYCLE', `步骤依赖存在环路：${cycle.join(' → ')}`, { stepKey: cycle[0], canLocate: true });
  return problems;
}

export function draftToSaveBody(draft: WorkflowDraft): WorkflowDraft {
  return {
    name: draft.name.trim(),
    description: draft.description,
    support: draft.support,
    requiredSteps: draft.requiredSteps.map((step) => ({
      ...structuredClone(step),
      key: step.key,
      title: step.title.trim(),
      kind: step.kind,
      group: step.group.trim(),
      ...(step.optional === true ? { optional: true } : {}),
      ...(step.roleId === undefined || step.roleId === '' ? {} : { roleId: step.roleId }),
      ...(step.requires === undefined ? {} : { requires: step.requires }),
    })),
    refinableGroups: draft.refinableGroups,
    ...(draft.planningStrategy === undefined ? {} : { planningStrategy: draft.planningStrategy }),
  };
}

export function supportLabel(support: TaskMethodSupportValue): string {
  return support === 'ai_planning' ? 'AI 规划' : '仅方法骨架';
}

/** 步骤链签名（目录详情用）：分组连续相同则视作并排展示。 */
export function stepChainGroups(steps: readonly WorkflowStepView[]): readonly { readonly group: string; readonly steps: readonly WorkflowStepView[] }[] {
  const groups: { group: string; steps: WorkflowStepView[] }[] = [];
  for (const step of steps) {
    const last = groups.at(-1);
    if (last !== undefined && last.group === step.group) last.steps.push(step);
    else groups.push({ group: step.group, steps: [step] });
  }
  return groups;
}
