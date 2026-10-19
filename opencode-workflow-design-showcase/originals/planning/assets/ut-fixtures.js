/* 补稿 v4（2026-10-16）· 统一任务身份与准备事实 · 合成样例数据（设计样例 · 全部模拟）
   需求画布（planning/requirement.html）与统一任务画布（delivery/task.html）共用：
   - NOUNS：新增几条同构规划任务（只换业务名词），用来在正常入口里各自演示一种“准备独立工作区”的服务结果
   - LEGACY：旧版需求 / 旧任务的真实身份（标题、项目、原文、步骤），迁入新版视图时保持身份，不改成样例 T-2051
   - TEMPLATES：固定菜单模板（模板引用 / 修订 / 固定步骤 / 入口参数都是数据变量；锁定只看 origin=fixed-menu-template）
   - PREP：每个任务的准备事实（项目类型、基线、分支 / 副本、服务会返回的结果）。结果由“服务”决定，界面只呈现。
   所有路径、SHA、请求号都是虚构样例；不连接任务、Git、目录或模型。 */
(function () {
  'use strict';
  /* ---------- 新增同构规划任务（准备结果样例） ---------- */
  const NOUNS = {
    'T-2062': { noun: '工单', pkg: 'ticket', cls: 'Ticket', project: '客服服务', repo: 'shop/support-service' },
    'T-2063': { noun: '发票', pkg: 'invoice', cls: 'Invoice', project: '财务服务', repo: 'shop/finance-service' },
    'T-2064': { noun: '对账单', pkg: 'statement', cls: 'Statement', project: '运营报表脚本', repo: '' },
    'T-2065': { noun: '积分单', pkg: 'points', cls: 'Points', project: '会员服务', repo: 'shop/member-service' },
    'T-2066': { noun: '支付单', pkg: 'payment', cls: 'Payment', project: '支付网关', repo: 'shop/payment-gateway' },
    'T-2067': { noun: '通知单', pkg: 'notice', cls: 'Notice', project: '通知中心', repo: 'shop/notify-center' },
  };
  if (window.PEF && PEF.TASKS) Object.assign(PEF.TASKS, NOUNS);

  /* ---------- 旧版需求 / 旧任务（迁入新版视图，保持身份） ---------- */
  const step = (id, title, role, output, what, extra) => Object.assign({ id, title, role, output, what }, extra || {});
  const LEGACY = {
    /* 旧需求目录 rq-2027 · PENDING_START（已确认 · 待开始）→ 需求画布 PE32 准备区（基线前移样例） */
    'T-2027': { title: '接口文档整理与变更说明', project: 'OpenCode Loopper', repo: 'loopper/opencode-loopper', rqId: 'rq-2027', planRev: 1, confirmedAt: '10-10 10:05', method: '文档整理 · r2',
      original: '整理任务服务对外接口文档，补齐近三个版本的变更说明；不改动接口本身，文档按模块拆分，旧链接保持可访问。',
      items: [['R1', '目标', '整理任务服务对外接口文档', '整理任务服务对外接口文档'], ['R2', '目标', '补齐近三个版本的变更说明', '补齐近三个版本的变更说明'], ['C1', '限制', '不改动接口本身', '不改动接口本身'], ['C2', '限制', '旧链接保持可访问', '旧链接保持可访问']],
      steps: [step('n1', '梳理接口清单', '技术写作', '接口清单', '盘点任务服务对外接口与近三个版本的变更。', { req: ['R1', 'R2'] }), step('n2', '编写接口文档', '技术写作', '接口文档', '按模块拆分编写接口文档。', { req: ['R1', 'C1'] }), step('n3', '编写变更说明', '技术写作', '变更说明', '补齐近三个版本的变更说明。', { req: ['R2'] }), step('n4', '链接与示例核对', '测试工程师', '核对报告', '核对旧链接重定向与示例请求可用。', { req: ['C2'] }), step('n5', '人工验收', '人工', '验收结论', '由你确认文档是否完整。', { req: ['R1', 'R2', 'C1', 'C2'] })],
      edges: [['start', 'n1'], ['n1', 'n2'], ['n1', 'n3'], ['n2', 'n4'], ['n3', 'n4'], ['n4', 'n5'], ['n5', 'end']] },
    /* 旧需求目录 rq-2041 · PLANNING（旧版“审阅计划”）→ 需求画布：计划草稿待确认（旧流程生成，无 AI 规划轮次） */
    'T-2046': { title: '项目配置入口整合', project: 'OpenCode Loopper', repo: 'loopper/opencode-loopper', rqId: 'rq-2041', planRev: 2, draft: true, method: '需求开发 · r12',
      original: '让项目配置更容易找到，减少切换页面的次数：合并项目详情里分散的配置入口，在详情页加入配置状态清单，并同步更新接口说明。',
      items: [['R1', '目标', '合并分散的配置入口', '合并项目详情里分散的配置入口'], ['R2', '目标', '详情页加入配置状态清单', '在详情页加入配置状态清单'], ['R3', '目标', '同步更新接口说明', '同步更新接口说明']],
      steps: [step('n1', '梳理配置入口', '产品经理', '入口清单与调整方案', '盘点现有配置入口，标出重复与难找的位置，提出合并方案。', { req: ['R1'] }), step('n2', '调整页面结构', '前端工程师', '代码变更', '按方案合并配置入口，项目详情加入配置状态清单。', { req: ['R1', 'R2'] }), step('n3', '补充接口说明', '技术写作', '接口文档更新', '更新配置相关接口与页面说明。', { req: ['R3'] }), step('n4', '回归测试', '测试工程师', '测试报告', '覆盖项目列表、详情、配置保存的回归用例。', { req: ['R1', 'R2'] }), step('n5', '人工验收', '人工', '验收结论', '由你确认改动是否达到目标。', { req: ['R1', 'R2', 'R3'] })],
      edges: [['start', 'n1'], ['n1', 'n2'], ['n1', 'n3'], ['n2', 'n4'], ['n3', 'n4'], ['n4', 'n5'], ['n5', 'end']] },
  };
  /* 旧任务（任务列表 / 需求目录的旧行；直接进入统一任务画布） */
  const OLD = {
    'T-2044': { title: '让项目配置更容易找到，减少切换页面的次数。', project: 'opencode-workflow 控制台', path: '/Users/dev/workspace/opencode-workflow-console', repo: 'loopper/opencode-workflow-console', note: '原任务画布的样例任务（旧深链默认身份）',
      steps: [['梳理配置入口', '产品经理', '入口清单与调整方案', '盘点现有配置入口，标出重复与难找的位置，提出合并方案。'], ['调整页面结构', '前端工程师', '代码变更', '按方案合并配置入口，项目详情加入配置状态清单。'], ['补充接口说明', '技术写作', '接口文档更新', '更新配置相关接口与页面说明。'], ['回归测试', '测试工程师', '测试报告', '覆盖项目列表、详情、配置保存的回归用例。'], ['人工验收', '人工', '验收结论', '由你确认改动是否达到目标。']] },
    'T-2038': { title: '登录页偶发 500 错误修复', project: 'OpenCode Loopper', path: '/Users/dev/workspace/opencode-loopper', repo: 'loopper/opencode-loopper', rqId: 'rq-2038',
      steps: [['收集错误日志', '运维工程师', '错误样本与时间线', '收集近 7 天登录 500 的日志样本与时间线。'], ['实施修复', '软件工程师', '代码变更', '定位会话校验的空指针并修复，补充错误码。'], ['补充错误码说明', '技术写作', '错误码文档', '更新登录相关错误码说明。'], ['回归测试', '测试工程师', '测试报告', '覆盖登录、会话续期与错误码的回归用例。'], ['人工验收', '人工', '验收结论', '由你确认问题已修复。']] },
    'T-2035': { title: '任务执行结果的状态反馈', project: 'OpenCode Loopper', path: '/Users/dev/workspace/opencode-loopper', repo: 'loopper/opencode-loopper', rqId: 'rq-2035',
      steps: [['梳理反馈场景', '产品经理', '反馈场景清单', '梳理任务执行结果需要反馈的场景与文案。'], ['实现状态推送', '软件工程师', '代码变更', '服务端推送执行结果状态。'], ['调整状态展示', '前端工程师', '页面变更', '列表与详情展示执行结果状态。'], ['回归测试', '测试工程师', '测试报告', '覆盖推送、展示与断线重连的回归用例。'], ['人工验收', '人工', '验收结论', '由你确认反馈是否清楚。']] },
    'T-2030': { title: '订单服务单元测试补齐', project: '客户服务平台', path: '/Users/dev/workspace/customer-platform', repo: 'cs/customer-platform', rqId: 'rq-2030',
      steps: [['分析覆盖缺口', '测试工程师', '覆盖缺口清单', '按包统计订单服务的覆盖缺口。'], ['编写测试', '测试工程师', '测试代码', '为下单、改价、取消补齐单元测试。'], ['补齐测试数据', '软件工程师', '测试数据', '整理订单状态机的测试数据。'], ['运行验收', '质量工程师', '测试报告与覆盖率', '运行测试并核对覆盖率达标。'], ['人工验收', '人工', '验收结论', '由你确认覆盖是否足够。']] },
    'T-2004': { title: '退款对账脚本重写，兼容新旧两套结算口径并补齐异常单据的人工复核流程', project: '客户服务平台', path: '/Users/dev/workspace/customer-platform', repo: 'cs/customer-platform', rqId: 'rq-2004',
      steps: [['梳理结算口径', '产品经理', '口径说明', '整理新旧两套结算口径与差异。'], ['重写对账脚本', '软件工程师', '脚本变更', '按两套口径重写对账脚本。'], ['异常单据复核流程', '软件工程师', '流程变更', '异常单据进入人工复核队列。'], ['回归测试', '测试工程师', '测试报告', '用历史账期回归对账结果。'], ['人工验收', '人工', '验收结论', '由你确认对账结果。']] },
    'T-1998': { title: '导出任务报告的异常恢复', project: '客户服务平台', path: '/Users/dev/workspace/customer-platform', repo: 'cs/customer-platform', chain: true,
      steps: [['定位异常', '软件工程师', '异常分析', '定位导出中断的原因。'], ['实现断点续传', '软件工程师', '代码变更', '导出中断后可从断点继续。'], ['回归测试', '测试工程师', '测试报告', '覆盖中断与恢复。']] },
    'T-2019': { title: '任务筛选条件的地址同步', project: 'OpenCode Loopper', path: '/Users/dev/workspace/opencode-loopper', repo: 'loopper/opencode-loopper', rqId: 'rq-2019', legacy: 'done', doneAt: '今天 09:47', chain: true,
      steps: [['梳理筛选条件', '产品经理', '条件清单', '整理任务列表筛选条件。'], ['同步到地址', '前端工程师', '页面变更', '筛选条件写入地址并可还原。'], ['回归测试', '测试工程师', '测试报告', '覆盖刷新与分享链接。'], ['人工验收', '人工', '验收结论', '由你确认。']] },
    'T-1975': { title: '需求说明文档生成', project: '客户服务平台', path: '/Users/dev/workspace/customer-platform', repo: 'cs/customer-platform', legacy: 'done', doneAt: '昨天', chain: true, type: '文档任务',
      steps: [['收集资料', '技术写作', '资料清单', '收集需求相关资料。'], ['生成文档', '技术写作', '需求说明', '生成需求说明文档。']] },
    'T-2011': { title: '旧版报表接口迁移', project: 'OpenCode Loopper', path: '/Users/dev/workspace/opencode-loopper', repo: 'loopper/opencode-loopper', rqId: 'rq-2011', legacy: 'stopped', doneAt: '10月8日 16:02', chain: true,
      steps: [['梳理旧接口', '软件工程师', '接口清单', '梳理旧版报表接口调用方。'], ['迁移实现', '软件工程师', '代码变更', '迁移到新报表接口。'], ['回归测试', '测试工程师', '测试报告', '覆盖迁移后的报表。']] },
    'T-1996': { title: '客服工单导出改为异步', project: '客户服务平台', path: '/Users/dev/workspace/customer-platform', repo: 'cs/customer-platform', rqId: 'rq-1996', legacy: 'done', doneAt: '10月5日 15:31', chain: true,
      steps: [['方案设计', '架构师', '异步导出方案', '设计异步导出与通知。'], ['实现异步导出', '软件工程师', '代码变更', '导出改为后台任务。'], ['人工验收', '人工', '验收结论', '由你确认。']] },
    'T-1990': { title: '项目公约文档补充', project: 'OpenCode Loopper', path: '/Users/dev/workspace/opencode-loopper', repo: 'loopper/opencode-loopper', rqId: 'rq-1990', legacy: 'done', doneAt: '10月3日 10:12', chain: true,
      steps: [['收集公约', '技术写作', '公约清单', '收集现有项目公约。'], ['补充文档', '技术写作', '公约文档', '补充 AGENTS.md 与贡献说明。']] },
  };

  /* ---------- 固定菜单模板（与“模板任务”页同一份数据；锁定规则只看 origin） ---------- */
  const TEMPLATES = {
    ut: { ref: 'tpl/unit-test', name: '单元测试开发', rev: 7, task: 'T-2070', group: '开发', project: 'OpenCode Loopper', branch: 'main', params: [['源码路径', 'src/main/java/com/loopper/task']],
      steps: [['分析覆盖', '测试工程师', '覆盖缺口清单', 'ro'], ['编写测试', '测试工程师', '测试代码', 'rw'], ['运行验收', '质量工程师', '测试报告与覆盖率', 'rw']] },
    design: { ref: 'tpl/detailed-design', name: '详细设计编写', rev: 5, task: 'T-2071', group: '开发', project: 'OpenCode Loopper', branch: 'main', params: [['源码路径', 'src/main/java/com/loopper/scheduler'], ['输出位置', 'docs/design/scheduler']],
      steps: [['读取源码', '架构师', '源码阅读笔记', 'ro'], ['编写设计', '架构师', '详细设计与流程图', 'rw'], ['覆盖核对', '质量工程师', '源码覆盖清单', 'ro']] },
    weekly: { ref: 'tpl/weekly-contribution', name: '项目人员贡献周报', rev: 10, task: 'T-2072', group: '报告', project: 'OpenCode Loopper', branch: 'main', params: [['时间范围', '10-03 至 10-09'], ['输出位置', 'docs/reports/weekly']],
      steps: [['采集 Git 证据', '数据工程师', '贡献证据', 'ro'], ['分析与生成报告', '技术写作', '周报', 'rw']] },
    history: { ref: 'tpl/history-review', name: '历史提交审查', rev: 4, task: 'T-2073', group: '报告', project: 'OpenCode Loopper', branch: 'main', params: [['时间范围', '10-03 至 10-09']],
      steps: [['采集提交', '数据工程师', '提交清单', 'ro'], ['逐条审查', '代码审查员', '审查记录', 'ro'], ['汇总', '技术写作', '审查报告', 'rw']] },
    review: { ref: 'tpl/snapshot-review', name: '代码审查', rev: 6, task: 'T-2074', group: '代码审查', project: 'OpenCode Loopper', branch: 'main', params: [['审查方式', '日期增量审查'], ['时间范围', '10-03 至 10-09']], snapshot: true,
      steps: [['冻结版本', '构建工程师', '基线与目标版本', 'ro'], ['审查', '代码审查员', '批次分析结论', 'ro'], ['复核', '独立复核员', '复核结论与报告', 'rw']] },
    req: { ref: 'tpl/requirement-review', name: '需求代码评审', rev: 3, task: 'T-2075', group: '代码审查', project: 'OpenCode Loopper', branch: 'feature/config-entry', params: [['需求文档', '登录与会话需求说明 v3.docx']],
      steps: [['读取需求文档', '产品经理', '需求要点', 'ro'], ['对照代码', '代码审查员', '对照记录', 'ro'], ['出具评审', '技术写作', '评审报告', 'rw']] },
  };
  /* 已在执行中的固定模板任务（任务列表旧行 / 旧快照评审深链） */
  const FIXED_RUNNING = {
    'T-2003': { tpl: 'review', title: '本周代码质量分析报告', project: 'OpenCode Loopper', at: '6 分钟前' },
    'T-2008': { tpl: 'review', title: '订单服务 · 10 月代码评审', project: '订单服务', at: '今天 14:02', snapArchive: true },
  };
  const tplByTask = (id) => Object.entries(TEMPLATES).find(([, t]) => t.task === id);

  /* ---------- 准备事实（服务决定；结果字段 outcome 只用于原型推演） ---------- */
  const proj = (name, path, kind, extra) => Object.assign({ name, path, kind }, extra || {});
  const PROJECTS = {
    '订单服务': proj('订单服务', '/Users/dev/workspace/order-service', 'git', { remote: 'GitLab · shop/order-service', head: 'main', dirty: 3, slug: 'order-service' }),
    '售后服务': proj('售后服务', '/Users/dev/workspace/aftersale-service', 'git', { remote: 'GitLab · shop/aftersale-service', head: 'main', dirty: 0, slug: 'aftersale-service' }),
    '仓储服务': proj('仓储服务', '/Users/dev/workspace/warehouse-service', 'git', { remote: 'GitLab · shop/warehouse-service', head: 'main', dirty: 1, slug: 'warehouse-service' }),
    '客服服务': proj('客服服务', '/Users/dev/workspace/support-service', 'git', { remote: 'GitLab · shop/support-service', head: 'main', dirty: 0, slug: 'support-service' }),
    '财务服务': proj('财务服务', '/Users/dev/workspace/finance-service', 'git', { remote: 'GitLab · shop/finance-service', head: 'main', dirty: 2, slug: 'finance-service' }),
    '运营报表脚本': proj('运营报表脚本', '/Users/dev/workspace/ops-report-scripts', 'dir', { slug: 'ops-report-scripts' }),
    '会员服务': proj('会员服务', '/Users/dev/workspace/member-service', 'git', { remote: 'GitLab · shop/member-service', head: 'main', dirty: 0, slug: 'member-service' }),
    '支付网关': proj('支付网关', '/Users/dev/workspace/payment-gateway', 'git', { remote: 'GitLab · shop/payment-gateway', head: 'main', dirty: 0, slug: 'payment-gateway', denied: true }),
    '通知中心': proj('通知中心', '/Users/dev/workspace/notify-center', 'git', { remote: 'GitLab · shop/notify-center', head: 'main', dirty: 0, slug: 'notify-center', empty: true }),
    'OpenCode Loopper': proj('OpenCode Loopper', '/Users/dev/workspace/opencode-loopper', 'git', { remote: 'GitLab · loopper/opencode-loopper', head: 'main', dirty: 1, slug: 'opencode-loopper' }),
    '客户服务平台': proj('客户服务平台', '/Users/dev/workspace/customer-platform', 'git', { remote: 'GitLab · cs/customer-platform', head: 'main', dirty: 0, slug: 'customer-platform' }),
  };
  /* 每个任务在“准备独立工作区”时服务会返回的结果（原型用；产品里由 task.workspace.prepare 回执决定） */
  const OUTCOME = {
    'T-2051': 'ok', 'T-2050': 'ok', 'T-2054': 'ok', 'T-2055': 'ok', 'T-2056': 'ok', 'T-2057': 'ok',
    'T-2062': 'unknown', 'T-2063': 'partial', 'T-2064': 'ok', 'T-2065': 'conflict', 'T-2066': 'denied', 'T-2067': 'empty',
    'T-2027': 'drift', 'T-2046': 'ok',
    'T-2070': 'ok', 'T-2071': 'ok', 'T-2072': 'ok', 'T-2073': 'ok', 'T-2074': 'ok', 'T-2075': 'ok',
  };
  function prepFacts(id, project, slugHint) {
    const p = PROJECTS[project] || PROJECTS['订单服务'];
    const n = id.replace('T-', '');
    const git = p.kind === 'git';
    const sl = slugHint || 'task';
    return {
      task: id, project: p.name, path: p.path, kind: p.kind, remote: p.remote || '', head: p.head || '', dirty: p.dirty || 0, denied: !!p.denied, empty: !!p.empty,
      outcome: OUTCOME[id] || 'ok',
      base: { sha: '7c1e9a2', full: '7c1e9a2f4b0d8e61c3a95f27d48b1e09a6c3f5d2', readAt: '14:21' },
      oldBase: { sha: '5b3a8f1', full: '5b3a8f17d0c4e2b9a61f83d05c7e4a92b1d6f038', readAt: '14:21' },
      newBase: { sha: 'a4c1f0e', full: 'a4c1f0e93b27d6c18e05f4a29b7d3c61e8f0a952', readAt: '14:24' },
      newCommits: [['9e2b4c7', '修正接口文档目录结构', 'li.wei · 14:22'], ['a4c1f0e', '升级文档生成工具到 2.3', 'dev-zhao · 14:23']],
      branch: `task/${id}-${sl}`, wsName: `${p.slug} · ${id}`, wsPath: `~/.opencode-workflow/${git ? 'workspaces' : 'copies'}/${p.slug}/${id}`, wsRoot: `~/.opencode-workflow/${git ? 'workspaces' : 'copies'}/${p.slug}`,
      prepKey: `prep-${id}-01`,
      conflict: { branch: { name: `task/${id}-${sl}`, at: '3f2e1d0', when: '10-12 14:20 创建', owner: '不属于本任务的准备记录' }, dir: { path: `~/.opencode-workflow/workspaces/${p.slug}/${id}`, note: '目录已存在且非空', owner: '不属于本任务的准备记录' } },
      snap: { ref: 'bs-' + n + '-1424', at: '10-16 14:24', pre: '10-16 14:22' }, scope: '全部文件', excludes: ['node_modules/', '.cache/', '单个大于 50 MB 的文件'], skipped: [{ path: 'data/raw-2025.parquet', size: '210 MB', why: '超过单文件 50 MB 上限' }],
      policy: git ? '写文件的步骤按计划依赖与同任务写入互斥逐个领取；并行写的步骤各写子工作区，结束后由服务汇合。只读步骤读取一致快照。' : '本计划写文件的步骤按顺序在独立副本中运行；只读步骤读取一致快照。',
    };
  }
  window.UTF = { NOUNS, LEGACY, OLD, TEMPLATES, FIXED_RUNNING, tplByTask, PROJECTS, OUTCOME, prepFacts };
})();
