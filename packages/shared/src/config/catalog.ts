import type { CatalogSnapshot, MethodStepDefinition, ModelProfile, WorkflowMethod } from '../domain/models.ts';
import { DEFAULT_MODEL_PROFILES } from './settings.ts';

const step = (key: string, title: string, kind: MethodStepDefinition['kind'], group: string, optional = false): MethodStepDefinition => ({
  key,
  title,
  kind,
  group,
  optional,
});

export const REQUIREMENT_DEVELOPMENT_METHOD: WorkflowMethod = {
  id: 'method.requirement-development',
  name: '需求开发',
  revision: 'r12',
  support: 'ai_planning',
  description: '从需求条目走到可交付变更；AI 可细化实现与测试分组。',
  requiredSteps: [
    step('requirement.clarify', '需求澄清', 'requirement', '需求'),
    step('design.solution', '方案设计', 'design', '设计'),
    step('design.interface', '接口定义', 'design', '设计'),
    step('impl.data-model', '数据模型变更', 'implementation', '实现'),
    step('impl.backend-query', '后端筛选查询', 'implementation', '实现'),
    step('impl.export', '导出 CSV 接口', 'implementation', '实现'),
    step('impl.frontend', '前端页面调整', 'implementation', '实现'),
    step('test.unit', '单元测试', 'test', '测试'),
    step('test.integration', '集成测试', 'test', '测试'),
    step('verify.review', '代码审查', 'verify', '验收'),
    step('delivery.handoff', '验收与交付', 'delivery', '交付'),
  ],
  refinableGroups: ['实现', '测试'],
  planningStrategy: { id: 'planning.requirement-development', version: 'v1', roleId: 'role.requirement-analyst' },
};

export const DEFECT_FIX_METHOD: WorkflowMethod = {
  id: 'method.defect-fix',
  name: '缺陷修复',
  revision: 'r4',
  support: 'ai_planning',
  description: '定位、修复与回归；AI 只细化修复与测试范围。',
  requiredSteps: [
    step('defect.reproduce', '复现与定位', 'requirement', '需求'),
    step('fix.apply', '修复实现', 'implementation', '修复'),
    step('test.regression', '回归测试', 'test', '测试'),
    step('delivery.handoff', '验收与交付', 'delivery', '交付'),
  ],
  refinableGroups: ['修复', '测试'],
  planningStrategy: { id: 'planning.defect-fix', version: 'v1', roleId: 'role.requirement-analyst' },
};

export const TECH_DESIGN_METHOD: WorkflowMethod = {
  id: 'method.tech-design',
  name: '技术设计',
  revision: 'r2',
  support: 'ai_planning',
  description: '调研、方案与评审；产物为设计文档。',
  requiredSteps: [
    step('design.research', '背景与调研', 'design', '设计'),
    step('design.options', '候选方案对比', 'design', '设计'),
    step('design.decision', '方案定稿', 'design', '设计'),
    step('design.review', '设计评审', 'verify', '验收'),
  ],
  refinableGroups: ['设计'],
  planningStrategy: { id: 'planning.tech-design', version: 'v1', roleId: 'role.requirement-analyst' },
};

/** Legacy method without AI planning support: skeleton only. */
export const MANUAL_METHOD: WorkflowMethod = {
  id: 'method.manual',
  name: '手工流程',
  revision: 'r1',
  support: 'skeleton_only',
  description: '未适配 AI 规划；可使用骨架并手动调整。',
  requiredSteps: [
    step('manual.step', '手工步骤', 'implementation', '实现'),
    step('manual.delivery', '交付', 'delivery', '交付'),
  ],
  refinableGroups: [],
};


export const UNIT_TEST_TEMPLATE = {
  id: 'template.unit-test-development',
  name: '单元测试开发',
  version: 7,
  lockedAfterCreate: true as const,
  steps: [
    step('unit.read-target', '读取目标代码', 'implementation', '固定步骤'),
    step('unit.plan-cases', '生成测试计划', 'test', '固定步骤'),
    step('unit.write-tests', '编写单元测试', 'test', '固定步骤'),
    step('unit.run-tests', '运行测试', 'test', '固定步骤'),
    step('unit.summary', '汇总结果', 'delivery', '固定步骤'),
  ],
  parameters: [
    { key: 'targetPath', label: '目标代码路径', required: true },
    { key: 'testPath', label: '测试文件路径', required: true },
    { key: 'framework', label: '测试框架', required: false },
  ],
} as const;

export const UNIT_TEST_METHOD: WorkflowMethod = {
  id: 'method.unit-test-development',
  name: '单元测试开发',
  revision: 'template-v7',
  support: 'skeleton_only',
  description: '固定模板任务：步骤由模板版本锁定，创建后不能修改。',
  requiredSteps: UNIT_TEST_TEMPLATE.steps.map((step) => ({ ...step })),
  refinableGroups: [],
};

export const DEFAULT_METHODS: readonly WorkflowMethod[] = [
  REQUIREMENT_DEVELOPMENT_METHOD,
  DEFECT_FIX_METHOD,
  TECH_DESIGN_METHOD,
  MANUAL_METHOD,
  UNIT_TEST_METHOD,
];

export const DEFAULT_ROLES = [
  {
    id: 'role.requirement-analyst',
    name: '需求分析师（规划职责）',
    purpose: '把需求原文转成可确认的具体计划，不执行开发。',
    revision: 'r5',
    promptRevision: 'p5',
    responsibilities: ['读取需求与资料', '生成候选计划', '提出必须答复的问题', '标注需人工判断项'],
  },
  {
    id: 'role.developer',
    name: '开发工程师',
    purpose: '按确认计划实现代码并提交结构化结果。',
    revision: 'r9',
    promptRevision: 'p7',
    responsibilities: ['读取任务上下文', '修改代码', '运行测试', '提交结果与证据'],
  },
  {
    id: 'role.tester',
    name: '测试工程师',
    purpose: '编写并执行测试，给出可核对的验证结果。',
    revision: 'r3',
    promptRevision: 'p3',
    responsibilities: ['补充测试用例', '执行验证', '输出验证记录'],
  },
  {
    id: 'role.reviewer',
    name: '代码审查员',
    purpose: '只读审查，按严重度与维度报告问题。',
    revision: 'r2',
    promptRevision: 'p2',
    responsibilities: ['读取差异', '按维度审查', '输出结构化问题'],
  },
] as const;

export const DEFAULT_TASK_TYPES = [
  { id: 'type.requirement-development', name: '需求开发', methodId: REQUIREMENT_DEVELOPMENT_METHOD.id },
  { id: 'type.defect-fix', name: '缺陷修复', methodId: DEFECT_FIX_METHOD.id },
  { id: 'type.tech-design', name: '技术设计', methodId: TECH_DESIGN_METHOD.id },
  { id: 'type.unit-test', name: '单元测试开发', methodId: UNIT_TEST_METHOD.id },
] as const;

export const DEFAULT_MODELS: readonly ModelProfile[] = DEFAULT_MODEL_PROFILES;

export const DEFAULT_CATALOG: CatalogSnapshot = {
  methods: DEFAULT_METHODS,
  roles: DEFAULT_ROLES.map((role) => ({ ...role, responsibilities: [...role.responsibilities] })),
  templates: [UNIT_TEST_TEMPLATE],
  taskTypes: DEFAULT_TASK_TYPES.map((type) => ({ ...type })),
  modelProfiles: DEFAULT_MODELS,
};

export function findMethod(catalog: CatalogSnapshot, methodId: string): WorkflowMethod | undefined {
  return catalog.methods.find((method) => method.id === methodId);
}

export const STAGE_GROUPS = ['需求', '设计', '实现', '测试', '验收', '交付'] as const;
