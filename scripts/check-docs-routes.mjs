#!/usr/bin/env node
/**
 * check-docs-routes.mjs — docs/api.md generator + route contract checker.
 *
 * Usage:
 *   node scripts/check-docs-routes.mjs          # check mode (exit 1 on drift)
 *   node scripts/check-docs-routes.mjs --write  # regenerate docs/api.md
 *
 * Source of truth:
 *   - packages/shared/src/api/contracts.ts  (ROUTES)
 *   - packages/server/src (all .ts files)    (registered app.get/post/patch/put/delete/all)
 *   - packages/server/src/internal.ts       (/internal/mcp/* internal endpoints)
 *
 * The public /api surface must be described by ROUTES; the only allowed
 * exceptions are listed in ROUTES_ONLY_EXCEPTIONS / SERVER_ONLY_EXCEPTIONS
 * below with an explicit reason. Any other drift fails the check.
 *
 * docs/api.md is fully generated from these sources. Run `npm run docs:api`
 * after changing ROUTES or server routes; `npm run check:docs-routes` (wired
 * into `npm run verify`) refuses to pass when the document is stale.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROUTES } from '../packages/shared/src/api/contracts.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DOC_PATH = join(ROOT, 'docs', 'api.md');
const WRITE = process.argv.includes('--write');

/* ------------------------------------------------------------------ */
/* 1. Extract route registrations                                     */
/* ------------------------------------------------------------------ */

function walkTs(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walkTs(path, out);
    else if (path.endsWith('.ts') && !path.includes('.test.')) out.push(path);
  }
  return out;
}

const methodPattern = /app\.(get|post|patch|put|delete|all)\s*(?:<[\s\S]*?>\s*)?\(\s*'([^']+)'/g;
const methodOrder = ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'ALL'];

/** Normalize a concrete/Fastify path to a comparable shape: params and wildcards -> `*`. */
function normalize(path) {
  return path
    .split('?')[0]
    .split('/')
    .map((segment) => (segment.startsWith(':') || segment === '*' || /^__p\d+__$/.test(segment) ? '*' : segment))
    .join('/');
}

const serverRoutes = new Map(); // normalizedPath -> { methods:Set, rawPaths:Set, files:Set }
for (const file of walkTs(join(ROOT, 'packages', 'server', 'src'))) {
  const source = readFileSync(file, 'utf8');
  let match;
  while ((match = methodPattern.exec(source)) !== null) {
    const method = match[1].toUpperCase();
    const rawPath = match[2];
    const key = normalize(rawPath);
    if (!serverRoutes.has(key)) serverRoutes.set(key, { methods: new Set(), rawPaths: new Set(), files: new Set() });
    const entry = serverRoutes.get(key);
    entry.methods.add(method);
    entry.rawPaths.add(rawPath);
    entry.files.add(file.startsWith(ROOT) ? file.slice(ROOT.length + 1) : file);
  }
}

/* ------------------------------------------------------------------ */
/* 2. ROUTES model + explicit exceptions                              */
/* ------------------------------------------------------------------ */

/**
 * ROUTES entries kept ahead of the server surface. Each exception must stay
 * documented in docs/api.md as a "contract reserved" row. Remove the entry
 * from this table when the server route is implemented.
 */
const ROUTES_ONLY_EXCEPTIONS = {
  '/api/git/repos/*/merge-requests/*': {
    reason: '单个 MR 详情待定；列表接口已实现（服务端未注册，当前返回 404）',
    docsPath: '/api/git/repos/:projectId/merge-requests/:iid',
    method: 'GET',
  },
};

/** Server /api routes intentionally kept out of the shared ROUTES table. */
const SERVER_ONLY_EXCEPTIONS = {
  '/api/opencode/gateway/*/v1/*': {
    reason: 'OpenCode 内部网关：每次启动随机 secret，仅受管进程使用，不进入共享客户端契约',
    docsPath: '/api/opencode/gateway/:secret/v1/*',
    method: 'ALL',
  },
};

const routesByPath = new Map(); // normalizedPath -> keys[]
for (const [key, value] of Object.entries(ROUTES)) {
  const raw = typeof value === 'function'
    ? value(...Array.from({ length: value.length }, (_, index) => `__p${index}__`))
    : value;
  const keyPath = normalize(raw);
  if (!routesByPath.has(keyPath)) routesByPath.set(keyPath, []);
  routesByPath.get(keyPath).push(key);
}

/* ------------------------------------------------------------------ */
/* 3. Descriptions, kinds and groups                                  */
/* ------------------------------------------------------------------ */

const GROUP_ORDER = [
  ['base', '基础'],
  ['projects', '项目 / 任务 / 需求'],
  ['planning', '规划'],
  ['plan', '计划 / 工作区 / 执行'],
  ['delivery', '交付'],
  ['git', 'Git 读口'],
  ['review', 'AI 审查 / 修复'],
  ['catalog', '角色 / 模板目录'],
  ['knowledge', '知识库'],
  ['ppt', 'PPT'],
  ['insights', '洞察 / 验收'],
  ['skills', '技能'],
  ['settings', '设置 / OpenCode / 数据库'],
  ['interactions', '交互（待处理中心）'],
  ['internal', '内部 MCP 回环（Bearer `AGENT_WORKFLOW_MCP_TOKEN`）'],
  ['serverOnly', '仅服务端（不进入 ROUTES）'],
  ['other', '其他 / 未分类'],
];

const GROUP_BY_KEY = new Map();
function assignGroup(groupId, keys) {
  for (const key of keys) GROUP_BY_KEY.set(key, groupId);
}
assignGroup('base', ['health', 'fsDirectories', 'bootstrap', 'events', 'operationsByKey']);
assignGroup('projects', [
  'projects', 'project', 'projectRecheck', 'tasks', 'task', 'taskDetail', 'requirement',
  'taskRecovery', 'taskRecoveries', 'taskAcceptance', 'taskPlanFromTemplate',
]);
assignGroup('planning', [
  'planning', 'planningPreview', 'planningStart', 'planningStop', 'planningReconcile',
  'planningApply', 'planningReject', 'planningAnswers', 'planningRecord',
]);
assignGroup('plan', [
  'plan', 'planSkeleton', 'planConfirm', 'planEditBegin', 'planEditSave', 'planEditFinish',
  'planEditAbandon', 'planNode', 'planRevision', 'workspace', 'workspacePrepare',
  'workspaceCleanupPreview', 'workspaceCleanupConfirm', 'changes', 'changesDiff',
  'execution', 'executionStart', 'executionPause', 'executionResume', 'executionRetry',
  'executionSkipNode', 'executionAdvance', 'executionAutoAdvance', 'executionCancel',
  'node', 'nodeAttempts', 'nodeOutput', 'nodeAccept', 'nodeReject',
]);
assignGroup('delivery', [
  'delivery', 'deliverySelect', 'deliveryCommit', 'deliveryPush', 'deliveryMergeRequest',
  'deliveryMerge', 'deliveryApplyPreview', 'deliveryApply',
]);
assignGroup('git', [
  'gitOverview', 'gitRepo', 'gitCommits', 'gitCommit', 'gitCommitFiles', 'gitDiff',
  'gitBranches', 'gitFetch', 'gitMergeRequests', 'gitMergeRequest',
]);
assignGroup('review', [
  'reviews', 'reviewCompare', 'commitReviews', 'review', 'reviewStart', 'reviewStop',
  'reviewFinding', 'fixes', 'fix', 'fixStart', 'fixDiff', 'fixStop', 'fixCommit', 'fixPush',
  'fixMerge', 'fixMergeRequest', 'fixDiscard', 'fixFileRevert',
]);
assignGroup('catalog', [
  'catalogRoles', 'catalogRoleSave', 'catalogRolePublish', 'catalogRoleRestore',
  'catalogRoleHistory', 'catalogRoleArchive', 'catalogTemplateImport',
  'catalogTemplateUpdate', 'catalogTemplateArchive', 'templateDetail', 'templateTasks',
]);
assignGroup('knowledge', [
  'knowledgeSources', 'knowledgeSearch', 'knowledgeSourceContent', 'knowledgeAsk', 'knowledgeHistory',
]);
assignGroup('ppt', [
  'pptWorks', 'pptWork', 'pptWorkUpdate', 'pptWorkPptx', 'pptWorkGenerateSlides',
  'pptWorkExport', 'pptWorkAttachments', 'pptWorkAttachment', 'pptWorkGenerate',
]);
assignGroup('insights', ['insights', 'insightsTaskUsage', 'insightsTaskQuality', 'insightsTaskAcceptance']);
assignGroup('skills', ['skills', 'skillSource']);
assignGroup('interactions', ['interactions', 'interaction', 'interactionResolve']);
assignGroup('settings', [
  'settings', 'settingsGit', 'gitlabConnection', 'gitlabConnectionTest', 'databaseConnections',
  'databaseConnection', 'databaseProbe', 'databaseQuery', 'opencodeStatus', 'opencodeRestart',
  'opencodeDetect', 'opencodeLogs',
]);

const META = {
  health: ['进程存活探针', 'read'],
  fsDirectories: ['只读目录浏览（目录名与 `.git` 标记；要求绝对路径）', 'read'],
  bootstrap: ['应用启动快照（设置/主题/目录/项目/任务/收件箱/集成/计数/数据）', 'read'],
  events: ['SSE 事件流（先发 ready，再补播，随后增量）', 'sse'],
  operationsByKey: ['按原 requestKey 核对回执（UNKNOWN 的唯一核对入口）', 'read'],

  projects: ['项目列表 / 登记项目（requestKey）', 'mixed'],
  project: ['项目详情 / 更新项目', 'mixed'],
  projectRecheck: ['重新检测项目路径与 Git 状态', 'command'],
  tasks: ['任务列表 / 形成需求草稿（requestKey）', 'mixed'],
  task: ['任务详情 / 保存草稿或补充需求', 'mixed'],
  taskDetail: ['任务详情聚合（计划/规划/执行/工作区/交付/能力）', 'read'],
  requirement: ['需求原文、条目、方法与能力', 'read'],
  taskRecovery: ['创建恢复派生草稿', 'command'],
  taskRecoveries: ['恢复派生草稿历史', 'read'],
  taskAcceptance: ['人工验收结论读取 / 记录（通过/驳回 + 备注）', 'mixed'],
  taskPlanFromTemplate: ['按固定模板生成计划', 'command'],

  planning: ['规划轮次、当前轮与动作可用性', 'read'],
  planningPreview: ['规划只读预览（预算/时限/规模/有效期）', 'preview'],
  planningStart: ['开始规划（异步模型会话）', 'command'],
  planningStop: ['请求停止规划（停稳后结算）', 'command'],
  planningReconcile: ['按原轮次核对规划结果', 'command'],
  planningApply: ['应用候选（需人工逐项 accepted）', 'command'],
  planningReject: ['不采用候选', 'command'],
  planningAnswers: ['保存业务问题答复（生成需求修订）', 'command'],
  planningRecord: ['规划记录（模型正文/工具/服务事件）', 'read'],

  plan: ['当前计划、历史与动作', 'read'],
  planSkeleton: ['使用流程方法骨架', 'command'],
  planConfirm: ['确认计划（创建 execution + workspace）', 'command'],
  planEditBegin: ['开始执行中调整计划', 'command'],
  planEditSave: ['保存计划调整（新修订）', 'command'],
  planEditFinish: ['结束计划调整并继续', 'command'],
  planEditAbandon: ['放弃计划调整（恢复原自动推进设置）', 'command'],
  planNode: ['计划节点详情', 'read'],
  planRevision: ['按修订读取计划（候选/检查点）', 'read'],
  workspace: ['工作区视图', 'read'],
  workspacePrepare: ['准备独立工作区（worktree / 目录副本）', 'command'],
  workspaceCleanupPreview: ['清理预览（blockers / 删除对象）', 'command'],
  workspaceCleanupConfirm: ['确认清理（回执、幂等）', 'command'],
  changes: ['任务变更集', 'read'],
  changesDiff: ['文件 diff', 'read'],
  execution: ['执行视图', 'read'],
  executionStart: ['开始执行', 'command'],
  executionPause: ['暂停执行', 'command'],
  executionResume: ['继续执行', 'command'],
  executionRetry: ['按原配置重试失败步骤', 'command'],
  executionSkipNode: ['跳过节点及全部下游', 'command'],
  executionAdvance: ['手动推进（整体或指定步骤的直接后继）', 'command'],
  executionAutoAdvance: ['切换自动推进（requestKey + 回执）', 'command'],
  executionCancel: ['取消执行（保留工作区）', 'command'],
  node: ['节点详情', 'read'],
  nodeAttempts: ['节点尝试列表', 'read'],
  nodeOutput: ['节点输出（attempt / afterSeq）', 'read'],
  nodeAccept: ['人工验收通过节点', 'command'],
  nodeReject: ['人工退回修改节点', 'command'],

  delivery: ['交付投影、步骤与资格', 'read'],
  deliverySelect: ['选择交付目标 / 文件', 'command'],
  deliveryCommit: ['提交（CAS changesRevision / branch head）', 'command'],
  deliveryPush: ['推送（create-only，无 force）', 'command'],
  deliveryMergeRequest: ['创建 MR', 'command'],
  deliveryMerge: ['合并到目标分支（临时 worktree + CAS）', 'command'],
  deliveryApplyPreview: ['非 Git 应用预览（只读）', 'preview'],
  deliveryApply: ['非 Git 应用到原目录（冻结预览 + 逐项）', 'command'],

  gitOverview: ['Git 仓库概览', 'read'],
  gitRepo: ['单仓库读模型', 'read'],
  gitCommits: ['提交列表（分页 / 筛选）', 'read'],
  gitCommit: ['提交详情', 'read'],
  gitCommitFiles: ['提交文件列表（可对比基线）', 'read'],
  gitDiff: ['文件 diff（统一 / 并排 / 忽略空白）', 'read'],
  gitBranches: ['分支列表', 'read'],
  gitFetch: ['拉取远端引用（requestKey + 回执）', 'command'],
  gitMergeRequests: ['MR 列表', 'read'],
  gitMergeRequest: ['单个 MR 详情（契约预留；服务端未注册，当前 404）', 'read'],

  reviews: ['审查记录列表', 'read'],
  reviewCompare: ['两次审查对比（已解决 / 新增 / 仍存在）', 'read'],
  commitReviews: ['提交的审查投影', 'read'],
  review: ['审查详情', 'read'],
  reviewStart: ['开始 AI 审查', 'command'],
  reviewStop: ['请求停止审查', 'command'],
  reviewFinding: ['接受 / 忽略 / 误报 finding', 'command'],
  fixes: ['修复记录列表', 'read'],
  fix: ['修复详情', 'read'],
  fixStart: ['开始 AI 修复（隔离 worktree）', 'command'],
  fixDiff: ['修复权威 diff', 'read'],
  fixStop: ['请求停止修复', 'command'],
  fixCommit: ['提交修复', 'command'],
  fixPush: ['推送修复分支', 'command'],
  fixMerge: ['合并修复分支（no-ff + CAS）', 'command'],
  fixMergeRequest: ['创建修复 MR', 'command'],
  fixDiscard: ['放弃修复并清理', 'command'],
  fixFileRevert: ['撤销单个修复文件', 'command'],

  catalogRoles: ['角色目录列表', 'read'],
  catalogRoleSave: ['保存角色草稿 / 自定义角色', 'command'],
  catalogRolePublish: ['发布角色（修订递增）', 'command'],
  catalogRoleRestore: ['恢复历史快照为草稿', 'command'],
  catalogRoleHistory: ['角色发布历史', 'read'],
  catalogRoleArchive: ['归档角色', 'command'],
  catalogTemplateImport: ['导入自定义模板', 'command'],
  catalogTemplateUpdate: ['更新模板（新版本）', 'command'],
  catalogTemplateArchive: ['归档自定义模板', 'command'],
  templateDetail: ['固定模板详情', 'read'],
  templateTasks: ['模板创建的任务历史', 'read'],

  knowledgeSources: ['知识来源清单（只读）', 'read'],
  knowledgeSearch: ['来源搜索（只读）', 'read'],
  knowledgeSourceContent: ['来源正文（只读）', 'read'],
  knowledgeAsk: ['文档问答（模型；引用校验；写本机历史，无 requestKey 回执；可能 15–90 秒）', 'preview'],
  knowledgeHistory: ['问答历史（每个项目最多 30 条）', 'read'],

  pptWorks: ['PPT 作品列表 / 创建草稿', 'mixed'],
  pptWork: ['作品更新或删除（单作品读取包含在列表响应中）', 'command'],
  pptWorkUpdate: ['更新作品标题 / 主题 / 大纲', 'command'],
  pptWorkPptx: ['导出 PPTX（二进制响应，非 envelope）', 'binary'],
  pptWorkGenerateSlides: ['生成逐页内容（模型）', 'command'],
  pptWorkExport: ['导出 Markdown 大纲', 'read'],
  pptWorkAttachments: ['添加文本 / 图片附件', 'command'],
  pptWorkAttachment: ['移除附件', 'command'],
  pptWorkGenerate: ['生成大纲（模型）', 'command'],

  insights: ['质量与用量汇总', 'read'],
  insightsTaskUsage: ['逐任务 token 用量', 'read'],
  insightsTaskQuality: ['逐任务执行 / 审查质量', 'read'],
  insightsTaskAcceptance: ['逐任务人工验收', 'read'],
  skills: ['已发现的 SKILL.md 元数据（只读）', 'read'],
  skillSource: ['Skill 源文（带行号，≤2000 行）', 'read'],

  settings: ['设置读取 / 保存', 'mixed'],
  settingsGit: ['GitHub / GitLab 连接状态（不含令牌）', 'read'],
  gitlabConnection: ['保存 GitLab / GitHub 连接与令牌（只写不读）', 'command'],
  gitlabConnectionTest: ['验证已保存令牌（可写验证状态缓存，非配置变更）', 'preview'],
  databaseConnections: ['数据库连接列表 / 登记', 'mixed'],
  databaseConnection: ['删除数据库连接（兼容无 body：服务端生成请求号）', 'command'],
  databaseProbe: ['连接探针（只读）', 'preview'],
  databaseQuery: ['只读 SQL 查询（守卫注入 LIMIT）', 'preview'],
  opencodeStatus: ['受管 OpenCode 状态 / 模型 / MCP / 网关计数', 'read'],
  opencodeRestart: ['重启受管 OpenCode', 'command'],
  opencodeDetect: ['扫描本机 OpenCode 候选与版本（只读）', 'read'],
  opencodeLogs: ['受管 OpenCode 日志尾部（脱敏）', 'read'],

  interactions: ['可交互待办列表（问题 / 权限 / 策略禁止 / 结果未明 / 草稿）', 'read'],
  interaction: ['单条交互详情（问题选项 / 权限范围 / 未知回读）', 'read'],
  interactionResolve: ['就地处理交互（回答 / 授权 / 拒绝 / 确认）', 'command'],
};

const INTERNAL_META = {
  '/internal/mcp/context': ['返回任务 / 规划 / 工作区上下文（workflow.context.get）', 'GET'],
  '/internal/mcp/plan-submit': ['提交候选计划（workflow.plan.submit）', 'POST'],
  '/internal/mcp/question': ['提交业务问题（workflow.question.ask）', 'POST'],
  '/internal/mcp/result-submit': ['提交节点结果（workflow.result.submit）', 'POST'],
  '/internal/mcp/git/status': ['Git 状态（git.repo.status）', 'GET'],
  '/internal/mcp/git/log': ['Git 日志（git.log）', 'GET'],
  '/internal/mcp/git/diff-files': ['变更文件（git.diff.files）', 'GET'],
  '/internal/mcp/git/commit-show': ['提交详情（git.commit.show）', 'GET'],
  '/internal/mcp/database/query': ['只读 SQL（database.query）', 'POST'],
  '/internal/mcp/workspace/file': ['读文件（workspace.file.read）', 'GET'],
  '/internal/mcp/workspace/files': ['列目录（workspace.file.list）', 'GET'],
  '/internal/mcp/workspace/file-write': ['写文件（workspace.file.write）', 'POST'],
  '/internal/mcp/workspace/exec': ['白名单命令（workspace.exec）', 'POST'],
};

/* ------------------------------------------------------------------ */
/* 4. Build expected route model                                       */
/* ------------------------------------------------------------------ */

const errors = [];
const warnings = [];

function methodList(methods) {
  const list = [...methods].filter((method) => method !== 'ALL');
  return methodOrder.filter((method) => list.includes(method));
}

function methodText(methods) {
  const list = methodList(methods);
  return list.length === 0 ? 'ALL' : list.join(' / ');
}

/** Receipt/semantics text for a set of route keys. */
function semanticsFor(keys, methods) {
  const kinds = keys.map((key) => META[key]?.[1] ?? 'read');
  const writeMethods = methodList(methods).filter((method) => method !== 'GET');
  if (kinds.includes('binary')) return '二进制响应（非 envelope）；读口';
  if (kinds.includes('sse')) return 'SSE：`ready` → 补播 → 增量';
  if (kinds.includes('mixed')) return 'GET 读口；写命令：`requestKey` + 回执（accepted→succeeded/failed/unknown；UNKNOWN 按 by-key 核对）';
  if (kinds.includes('command') || writeMethods.length > 0) {
    return '写命令：`requestKey` + 回执（accepted→succeeded/failed/unknown；UNKNOWN 按 by-key 核对）';
  }
  if (kinds.includes('preview')) return '只读 / 预览；不产生写回执';
  return '读口；无写回执';
}

function descriptionFor(keys) {
  const descriptions = [...new Set(keys.map((key) => META[key]?.[0] ?? `（待补说明：${key}）`))];
  return descriptions.join('；');
}

function groupFor(key, path) {
  if (GROUP_BY_KEY.has(key)) return GROUP_BY_KEY.get(key);
  if (path.startsWith('/api/interactions')) return 'interactions';
  return 'other';
}

const rowsByGroup = new Map(GROUP_ORDER.map(([id]) => [id, []]));

// 4a. Public /api routes described by ROUTES (plus documented exceptions).
for (const [normalized, keys] of routesByPath) {
  const server = serverRoutes.get(normalized);
  const exception = ROUTES_ONLY_EXCEPTIONS[normalized];
  if (server === undefined && exception === undefined) {
    errors.push(`ROUTES 路径没有服务端实现：${normalized}（keys: ${keys.join(', ')}）`);
    continue;
  }
  const docsPath = server !== undefined
    ? [...server.rawPaths].sort()[0]
    : exception.docsPath;
  const methods = server !== undefined ? methodList(server.methods) : [exception.method];
  const group = groupFor(keys[0], docsPath);
  rowsByGroup.get(group).push({
    methods: methodText(methods),
    path: docsPath,
    description: descriptionFor(keys),
    semantics: exception !== undefined
      ? '契约预留：服务端未注册（当前 404）；列表接口已实现'
      : semanticsFor(keys, methods),
    sort: normalize(docsPath),
    keys,
  });
}

// 4b. Server /api routes not covered by ROUTES.
for (const [normalized, server] of serverRoutes) {
  if (!normalized.startsWith('/api/')) continue;
  if (routesByPath.has(normalized)) continue;
  const exception = SERVER_ONLY_EXCEPTIONS[normalized];
  if (exception === undefined) {
    errors.push(`服务端 /api 路由未纳入 ROUTES：${normalized}（${[...server.rawPaths].join(', ')}；${[...server.files].join(', ')}）`);
    continue;
  }
  rowsByGroup.get('serverOnly').push({
    methods: exception.method,
    path: exception.docsPath,
    description: exception.reason,
    semantics: '仅受管 OpenCode 使用；随机 secret；不进入共享客户端契约',
    sort: normalize(exception.docsPath),
    key: 'gateway',
  });
}

// 4c. Internal MCP routes.
for (const [normalized, server] of serverRoutes) {
  if (!normalized.startsWith('/internal/')) continue;
  const rawPath = [...server.rawPaths].sort()[0];
  const meta = INTERNAL_META[rawPath];
  if (meta === undefined) warnings.push(`内部端点缺少用途说明：${rawPath}`);
  rowsByGroup.get('internal').push({
    methods: methodText(server.methods),
    path: rawPath,
    description: meta?.[0] ?? '（待补说明）',
    semantics: '内部端点：Bearer `AGENT_WORKFLOW_MCP_TOKEN`；无 requestKey 回执',
    sort: normalize(rawPath),
    key: 'internal',
  });
}

// 4d. Reserved ROUTES-only paths (already included above via exception branch).
for (const [normalized, exception] of Object.entries(ROUTES_ONLY_EXCEPTIONS)) {
  if (serverRoutes.has(normalized)) {
    errors.push(`ROUTES_ONLY_EXCEPTIONS 中的路径已被服务端实现，请移除例外：${normalized}`);
  }
  if (!routesByPath.has(normalized)) {
    errors.push(`ROUTES_ONLY_EXCEPTIONS 中的路径不在 ROUTES：${normalized}`);
  }
  warnings.push(`契约预留（${exception.method} ${exception.docsPath}）：${exception.reason}`);
}
for (const [normalized] of Object.entries(SERVER_ONLY_EXCEPTIONS)) {
  if (routesByPath.has(normalized)) {
    errors.push(`SERVER_ONLY_EXCEPTIONS 中的路径已进入 ROUTES，请移除例外：${normalized}`);
  }
  if (!serverRoutes.has(normalized)) {
    errors.push(`SERVER_ONLY_EXCEPTIONS 中的路径没有服务端注册：${normalized}`);
  }
}

// 4e. Every ROUTES key must be grouped (fallback group is allowed but noisy).
for (const [normalized, keys] of routesByPath) {
  for (const key of keys) {
    if (META[key] === undefined) warnings.push(`ROUTES.${key} 缺少用途说明（已使用占位文本）`);
    if (!GROUP_BY_KEY.has(key) && !normalized.startsWith('/api/interactions')) {
      warnings.push(`ROUTES.${key} 未显式归组（已放入「其他」）`);
    }
  }
}

if (errors.length > 0) {
  console.error('[check-docs-routes] 路由契约漂移：');
  for (const error of errors) console.error(`  - ${error}`);
  if (warnings.length > 0) {
    console.error('[check-docs-routes] 提示：');
    for (const warning of warnings) console.error(`  - ${warning}`);
  }
  process.exit(1);
}

/* ------------------------------------------------------------------ */
/* 5. Render docs/api.md                                              */
/* ------------------------------------------------------------------ */

function renderTable(rows) {
  const sorted = [...rows].sort((left, right) => {
    if (left.sort !== right.sort) return left.sort < right.sort ? -1 : 1;
    return left.path < right.path ? -1 : left.path > right.path ? 1 : 0;
  });
  const lines = ['| 方法 | 路径 | 用途 | 回执 / 语义 |', '| --- | --- | --- | --- |'];
  for (const row of sorted) {
    lines.push(`| ${row.methods} | \`${row.path}\` | ${row.description} | ${row.semantics} |`);
  }
  return lines.join('\n');
}

const header = `# HTTP API（v1）

> 本文件由 \`npm run docs:api\`（\`scripts/check-docs-routes.mjs --write\`）从
> \`packages/shared/src/api/contracts.ts\` 的 \`ROUTES\` 与服务端注册路由生成；请勿手改。
> 实现以 **ROUTES + 服务端注册** 为准；\`npm run check:docs-routes\` 校验文档覆盖与契约/路由一致性，
> 已接入 \`npm run verify\`。契约或路由变化后运行 \`npm run docs:api\` 重新生成。
>
> 响应信封：成功 \`{ data, meta:{requestId,at,revision?} }\`；失败
> \`{ error:{code,message,details?,requestId,at,retryable} }\`。错误码见 \`packages/shared/src/errors.ts\`。
>
> 写操作统一 \`requestKey\` + 回执（\`accepted → succeeded / failed / unknown\`）；UNKNOWN 只能按原 key
> 查 \`GET /api/operations/:key\` 核对，不自动重发。GET 为读口；表中「回执 / 语义」列注明每行的写语义。
>
> 不在下表的非契约路由：\`GET /\`（SPA index）与 \`GET /assets/*\`（静态资源）；它们不参与 \`/api\` 契约。
> 表中方法来自服务端实际注册；同一路径存在读/写方法时合并展示。`;

const sections = [];
for (const [groupId, title] of GROUP_ORDER) {
  const rows = rowsByGroup.get(groupId) ?? [];
  if (rows.length === 0) {
    if (groupId === 'interactions') sections.push(`## ${title}\n\n当前没有 \`/api/interactions/*\` 路由。`);
    continue;
  }
  sections.push(`## ${title}\n\n${renderTable(rows)}`);
}

const generated = `${header}\n\n${sections.join('\n\n')}\n`;

/* ------------------------------------------------------------------ */
/* 6. Compare / write + report                                        */
/* ------------------------------------------------------------------ */

const expectedPaths = new Set();
for (const rows of rowsByGroup.values()) for (const row of rows) expectedPaths.add(normalize(row.path));

const summary = [
  `ROUTES keys: ${Object.keys(ROUTES).length}`,
  `ROUTES unique paths: ${routesByPath.size}`,
  `server /api paths: ${[...serverRoutes.keys()].filter((key) => key.startsWith('/api')).length}`,
  `internal paths: ${[...serverRoutes.keys()].filter((key) => key.startsWith('/internal')).length}`,
  `documented rows: ${[...rowsByGroup.values()].reduce((sum, rows) => sum + rows.length, 0)}`,
  `documented unique paths: ${expectedPaths.size}`,
];

if (WRITE) {
  let existing = '';
  try { existing = readFileSync(DOC_PATH, 'utf8'); } catch { /* new file */ }
  writeFileSync(DOC_PATH, generated, 'utf8');
  console.log(`[check-docs-routes] wrote ${DOC_PATH}`);
  for (const line of summary) console.log(`  ${line}`);
  for (const warning of warnings) console.log(`  warn: ${warning}`);
  process.exit(0);
}

let existing = '';
try {
  existing = readFileSync(DOC_PATH, 'utf8');
} catch {
  console.error(`[check-docs-routes] 缺少 ${DOC_PATH}；运行 npm run docs:api 生成`);
  process.exit(1);
}

if (existing !== generated) {
  const documented = new Set();
  for (const match of existing.matchAll(/`(\/api\/[^`]+)`/g)) documented.add(normalize(match[1]));
  const missing = [...expectedPaths].filter((path) => !documented.has(path));
  const stale = [...documented].filter((path) => !expectedPaths.has(path));
  console.error('[check-docs-routes] docs/api.md 与 ROUTES + 服务端注册不一致。');
  if (missing.length > 0) console.error(`  未文档化路由（${missing.length}）：${missing.join(', ')}`);
  if (stale.length > 0) console.error(`  文档中不存在于当前路由表（${stale.length}）：${stale.join(', ')}`);
  if (missing.length === 0 && stale.length === 0) console.error('  路由集合一致，但表格内容/说明/顺序过期。');
  console.error('  修复：npm run docs:api（生成后人工检查说明文本）。');
  process.exit(1);
}

console.log('[check-docs-routes] OK: docs/api.md 与 ROUTES + 服务端注册一致');
for (const line of summary) console.log(`  ${line}`);
for (const warning of warnings) console.log(`  warn: ${warning}`);
