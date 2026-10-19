/* 普通流程 AI 规划补充稿 · 合成样例数据（设计样例 · 全部模拟；虚构项目、路径与金额，不含真实账号或凭据）
   一组同构任务共用同一份计划结构，只换业务名词，便于任务列表里的不同状态点进去后内容自洽。 */
(function () {
  const TASKS = {
    'T-2051': { noun: '退款单', pkg: 'refund', cls: 'Refund', project: '订单服务', repo: 'shop/order-service' },
    'T-2054': { noun: '售后单', pkg: 'aftersale', cls: 'AfterSale', project: '售后服务', repo: 'shop/aftersale-service' },
    'T-2055': { noun: '退货单', pkg: 'returns', cls: 'Return', project: '仓储服务', repo: 'shop/warehouse-service' },
    'T-2056': { noun: '换货单', pkg: 'exchange', cls: 'Exchange', project: '订单服务', repo: 'shop/order-service' },
    'T-2057': { noun: '补发单', pkg: 'reship', cls: 'Reship', project: '仓储服务', repo: 'shop/warehouse-service' },
    'T-2050': { noun: '赔付单', pkg: 'compensation', cls: 'Compensation', project: '订单服务', repo: 'shop/order-service' },
  };
  function task(id) {
    const t = TASKS[id] || TASKS['T-2051']; const tid = TASKS[id] ? id : 'T-2051';
    const original = `${t.noun}列表增加按状态和日期范围筛选，并支持把筛选结果导出为 CSV；不要改动现有${t.noun}查询接口的返回字段，旧数据也要能正常筛选。`;
    const span = (s) => { const a = original.indexOf(s); return [a, a + s.length]; };
    return Object.assign({ id: tid, title: `${t.noun}按状态与日期筛选并导出`, baseline: 'main @ 7c1e9a2', method: '需求开发 · r12', policy: '规划策略 v1', original,
      items: [
        { k: 'R1', kind: '目标', text: '按状态筛选', span: span('按状态') },
        { k: 'R2', kind: '目标', text: '按日期范围筛选', span: span('日期范围筛选') },
        { k: 'R3', kind: '目标', text: '筛选结果导出为 CSV', span: span('把筛选结果导出为 CSV') },
        { k: 'C1', kind: '限制', text: `不改现有${t.noun}查询接口的返回字段`, span: span(`不要改动现有${t.noun}查询接口的返回字段`) },
        { k: 'C2', kind: '限制', text: '旧数据也能正常筛选', span: span('旧数据也要能正常筛选') },
      ] }, t);
  }

  /* ---------- 方法骨架（当前草稿 · 计划修订 2；仅复制方法图，未调用模型） ---------- */
  const SKELETON = {
    nodes: [
      { id: 'start', title: '开始', system: true },
      { id: 's1', title: '梳理需求', role: '产品经理', meta: '必经步骤' },
      { id: 's2', title: '方案设计', role: '架构师', meta: '必经步骤' },
      { id: 's3', title: '实现', role: '后端工程师', meta: '必经 · 可细化' },
      { id: 's4', title: '测试', role: '测试工程师', meta: '必经 · 可细化' },
      { id: 's5', title: '人工验收', role: '人工', meta: '必经步骤' },
      { id: 'end', title: '交付', system: true },
    ],
    edges: [['start', 's1'], ['s1', 's2'], ['s2', 's3'], ['s3', 's4'], ['s4', 's5'], ['s5', 'end']].map(([from, to]) => ({ from, to })),
  };
  const GROUPS = [
    { id: 'g1', title: '需求与方案', meta: '必经：梳理需求 → 方案设计' },
    { id: 'g2', title: '实现', meta: '可细化 · 替换骨架“实现”' },
    { id: 'g3', title: '测试', meta: '可细化 · 替换骨架“测试”' },
    { id: 'g4', title: '验收', meta: '必经：人工验收' },
  ];
  /* ---------- 第 N 轮候选（ProposalV1 编译后的图） ---------- */
  function candidate(t) {
    return {
      nodes: [
        { id: 'start', title: '开始', system: true },
        { id: 'n1', title: '梳理需求', role: '产品经理', meta: '需求条目与验收清单', group: 'g1', diff: 'mod' },
        { id: 'n2', title: '方案设计', role: '架构师', meta: '筛选与导出接口约定', group: 'g1' },
        { id: 'n3', title: '后端筛选查询', role: '后端工程师', meta: '查询服务变更', group: 'g2', diff: 'add' },
        { id: 'n5', title: '前端筛选栏与导出按钮', role: '前端工程师', meta: '页面变更', group: 'g2', diff: 'add' },
        { id: 'n4', title: '导出 CSV 接口', role: '后端工程师', meta: '导出接口与文件生成', group: 'g2', diff: 'add' },
        { id: 'n6', title: '接口测试', role: '测试工程师', meta: '接口测试报告', group: 'g3', diff: 'add' },
        { id: 'n7', title: '旧数据回归', role: '测试工程师', meta: '旧数据回归报告', group: 'g3', diff: 'add' },
        { id: 'n8', title: '人工验收', role: '人工', meta: '验收结论', group: 'g4', diff: 'mod' },
        { id: 'end', title: '交付', system: true },
      ],
      edges: [['start', 'n1'], ['n1', 'n2'], ['n2', 'n3'], ['n2', 'n5'], ['n3', 'n4'], ['n3', 'n6'], ['n4', 'n6'], ['n4', 'n7'], ['n5', 'n8'], ['n6', 'n8'], ['n7', 'n8'], ['n8', 'end']].map(([from, to]) => ({ from, to })),
    };
  }
  /* 部分草稿：检查点 #2（需求与方案 + 实现已生成；测试、验收缺口） */
  function partial(t) {
    const c = candidate(t);
    return {
      nodes: c.nodes.filter((n) => ['start', 'n1', 'n2', 'n3', 'n4', 'n5'].includes(n.id)).map((n) => Object.assign({}, n, { diff: null }))
        .concat([{ id: 'gap3', title: '测试 · 尚未生成', gap: true, group: 'g3', meta: '检查点 #2 未覆盖：接口测试、旧数据回归的拆分与验收' },
          { id: 'gap4', title: '验收 · 尚未生成', gap: true, group: 'g4', meta: '人工验收清单尚未提出' }]),
      edges: [['start', 'n1'], ['n1', 'n2'], ['n2', 'n3'], ['n2', 'n5'], ['n3', 'n4'], ['n4', 'gap3'], ['gap3', 'gap4']].map(([from, to]) => ({ from, to })),
    };
  }
  /* 节点详情（候选） */
  function details(t) {
    const P = t.pkg, C = t.cls;
    return {
      n1: { step: '梳理需求（必经）', type: 'requirements.clarify@0.1.2', req: ['R1', 'R2', 'R3', 'C1', 'C2'], task: '把原文拆成可验收条目，补充每条的验收方法；限制条件逐条保留。', why: [['data', '开始', '原需求文本（不可改）']], inputs: [['原需求 修订 1', '/text', '/requirement']], outputs: ['/items', '/criteria'], criteria: ['5 条需求条目均能回指原文区间', '限制 C1、C2 各有可观察的验收方法'], res: [['r', `docs/api/${P}.md`, '已读']], diffNote: '修改：补充需求映射与 2 条验收条款（原骨架只有“澄清需求”）' },
      n2: { step: '方案设计（必经）', type: 'design.solution@2', req: ['R1', 'R2', 'R3', 'C1'], task: '给出筛选参数、导出接口与分页游标约定；明确不改现有查询接口返回字段。', why: [['data', '梳理需求', '需求条目 /items']], inputs: [['梳理需求', '/items', '/items']], outputs: ['/api-contract'], criteria: ['接口约定覆盖 R1–R3', '列出与现有返回字段的兼容方式（C1）'], res: [['r', `src/${P}/**`, '已读'], ['w', `artifacts/design/${P}-filter.md`, '声明']] },
      n3: { step: '实现（可细化）', type: 'code.implement@3', req: ['R1', 'R2', 'C1', 'C2'], task: `在 ${C}QueryService 增加状态与日期范围条件；旧数据 status 为空按“未知”处理并可筛选。`, why: [['data', '方案设计', '接口约定 /api-contract'], ['prerequisite', '方案设计', '必经顺序：方案设计先于实现']], inputs: [['方案设计', '/api-contract', '/contract']], outputs: ['/patch'], criteria: ['新增条件不改变现有返回字段（C1）', '旧数据空状态可被筛出（C2）'], res: [['r', `src/${P}/**`, '已读 · 1 份截断'], ['w', `src/${P}/query/**`, '声明']] },
      n4: { step: '实现（可细化）', type: 'code.implement@3', req: ['R3', 'C1'], task: '新增导出接口：按当前筛选条件分页读取，生成 CSV 文件。', why: [['data', '后端筛选查询', '查询服务变更 /patch']], inputs: [['后端筛选查询', '/patch', '/query-service']], outputs: ['/export-api'], criteria: ['导出内容与筛选结果一致', '单次最多 10,000 行（模型提议，需你确认）'], res: [['r', `src/${P}/**`, '已读'], ['w', `src/${P}/export/**`, '声明'], ['w', `web/src/api/${P}.ts`, '声明']] },
      n5: { step: '实现（可细化）', type: 'code.implement@3', req: ['R1', 'R2', 'R3'], task: '列表页增加状态、日期范围筛选栏与“导出”按钮。', why: [['data', '方案设计', '接口约定 /api-contract']], inputs: [['方案设计', '/api-contract', '/contract']], outputs: ['/patch'], criteria: ['筛选项与接口约定一致', '导出按钮带当前筛选条件'], res: [['r', `web/src/pages/${P}/**`, '已读'], ['w', `web/src/pages/${P}/**`, '声明'], ['w', `web/src/api/${P}.ts`, '声明']] },
      n6: { step: '测试（可细化）', type: 'test.api@2', req: ['R1', 'R2', 'R3', 'C1'], task: '覆盖筛选组合与导出；比对现有查询接口返回字段未变化。', why: [['data', '后端筛选查询', '/patch'], ['data', '导出 CSV 接口', '/export-api']], inputs: [['后端筛选查询', '/patch', '/target'], ['导出 CSV 接口', '/export-api', '/export']], outputs: ['/report'], criteria: ['返回字段快照比对无差异（C1）', '导出与查询结果逐行一致'], res: [['r', `src/${P}/**`, '声明'], ['w', `artifacts/test/${P}-api/**`, '声明']] },
      n7: { step: '测试（可细化）', type: 'test.regression@2', req: ['C2'], task: '用旧数据样本回归筛选与导出。', why: [['data', '导出 CSV 接口', '/export-api']], inputs: [['导出 CSV 接口', '/export-api', '/export']], outputs: ['/report'], criteria: ['空状态、历史日期格式均可筛选'], res: [['r', `db/schema/${P}.sql`, '已读（只读节选）'], ['w', `artifacts/test/${P}-legacy/**`, '声明']] },
      n8: { step: '人工验收（必经）', type: 'human.accept@1', req: ['R1', 'R2', 'R3', 'C1', 'C2'], task: '由你确认筛选、导出与兼容性达到目标。', why: [['prerequisite', '接口测试 · 旧数据回归 · 前端筛选栏', '全部必需分支验收后']], inputs: [['接口测试', '/report', '/api-report'], ['旧数据回归', '/report', '/legacy-report']], outputs: ['/verdict'], criteria: ['逐条核对 R1–C2 的验收结果'], res: [], diffNote: '修改：验收清单按 5 条需求条目展开' },
    };
  }
  /* ---------- 规划记录（服务持久记录；sequence 为服务序号） ---------- */
  function records(t) {
    const P = t.pkg, C = t.cls;
    return [
      { seq: 1, tm: '14:02:06', kind: 'phase', title: '准备输入 · 开始', body: `已冻结输入：需求原文 修订 1 · 方法 需求开发 r12 · 规划策略 v1 · 当前草稿 计划修订 2（方法骨架）` },
      { seq: 2, tm: '14:02:07', kind: 'tool', nm: 'project.list_dir', id: '#c-01a3', arg: `src/${P}/**（已授权目录）`, res: '38 个文件', st: 'ok' },
      { seq: 3, tm: '14:02:09', kind: 'tool', nm: 'project.read_file', id: '#c-02b7', arg: `docs/api/${P}.md`, res: '96 行 · 3.1 KB', st: 'ok' },
      { seq: 4, tm: '14:02:12', kind: 'tool', nm: 'project.read_file', id: '#c-03c1', arg: `src/${P}/query/${C}QueryService.java`, res: '212 行 · 已读 1–120 行', st: 'ok', note: '按单次读取上限截断：后 92 行未读；依据标“部分”' },
      { seq: 5, tm: '14:02:15', kind: 'tool', nm: 'project.read_file', id: '#c-04d9', arg: `db/schema/${P}.sql（只读节选）`, res: '1.4 KB', st: 'ok' },
      { seq: 6, tm: '14:03:41', kind: 'phase', title: '准备输入 · 完成 → 生成候选 · 开始', body: '依据包已捕获：7 份资料，1 份截断。第 1 次模型派发（初稿）。' },
      { seq: 7, tm: '14:03:52', kind: 'text', body: ['先按方法的五个必经步骤搭骨架。“实现”和“测试”是可细化步骤：实现拆成后端筛选查询、导出接口、前端筛选栏；测试拆成接口测试和旧数据回归。', '“不改返回字段”这条限制会同时约束后端两步，并由接口测试做字段比对。'] },
      { seq: 8, tm: '14:04:30', kind: 'tool', nm: 'project.search', id: '#c-05e2', arg: 'status|created_at（已授权目录内）', res: '12 处匹配 · 4 个文件', st: 'ok' },
      { seq: 9, tm: '14:05:02', kind: 'text', body: ['旧数据里 status 有空值。我把“旧数据回归”作为单独的测试步骤。', '原文没说日期按哪个字段筛选，我先按创建时间（created_at）提出，标为假设，需要你确认。'] },
      { seq: 10, tm: '14:05:40', kind: 'checkpoint', title: '草稿检查点 #1 已保存', body: '需求与方案 2 步；覆盖 R1–R3、C1。' },
      { seq: 11, tm: '14:06:55', kind: 'checkpoint', title: '草稿检查点 #2 已保存', body: '实现 3 步；测试、验收尚未生成（未覆盖 C2 的验收）。' },
      { seq: 12, tm: '14:07:10', kind: 'tool', nm: 'project.read_file', id: '#c-06f0', arg: `web/src/pages/${P}/List.vue`, res: '184 行 · 5.2 KB', st: 'ok' },
      { seq: 13, tm: '14:07:58', kind: 'text', body: ['导出接口按当前筛选条件分页读取，避免一次读全表；单次上限我先写 10,000 行，作为模型提议的验收值，交给你判断。'] },
      { seq: 14, tm: '14:08:20', kind: 'phase', title: '生成候选 · 完成 → 检查计划 · 开始', body: '已收到候选（提交回执 rc-91d2）。本代提交名额已用，原调用结清中。' },
      { seq: 15, tm: '14:08:24', kind: 'check', title: '程序检查 · 进行中', body: 'V1 协议 通过 · V2 图与方法 通过 · V3 配置与输入输出 进行中' },
      { seq: 16, tm: '14:08:31', kind: 'phase', title: '原调用已停稳 · 用量已结账', body: '第 1 次派发：已知 0.46 元；预留 2.00 元中的余额继续保留到本轮结束。' },
      { seq: 17, tm: '14:09:05', kind: 'check', title: '程序检查 · 完成', body: '结构检查通过（V1–V3、V7、V8）；需人工判断 3 项；依据部分（1 份截断）；执行准备：需准备独立工作区。' },
      { seq: 18, tm: '14:09:05', kind: 'phase', title: '检查计划 · 完成 → 等待审阅', body: '候选第 3 版已发布；等待你审阅、应用与确认。' },
    ];
  }
  const ROUNDS = [
    { n: 2, label: '第 2 轮 · 当前' },
    { n: 1, label: '第 1 轮 · 已停止（补充需求后）' },
  ];
  /* ---------- 大需求总览（T-2060） ---------- */
  const LARGE = {
    id: 'T-2060', title: '会员积分体系重构', project: '会员服务', method: '需求开发 · r12',
    groups: [
      { id: 'L1', title: '积分账户与流水', meta: '已细化 · 4 步', badge: ['已细化', 'st-done'] },
      { id: 'L2', title: '获取规则', meta: '已细化 · 3 步', badge: ['已细化', 'st-done'] },
      { id: 'L3', title: '消耗与抵扣', meta: '未细化 · 覆盖 R5–R7', tone: 'unrefined', badge: ['未细化', 'st-unknown'], collapsed: true },
      { id: 'L4', title: '过期与清零', meta: '未细化 · 覆盖 R8、C3', tone: 'unrefined', badge: ['未细化', 'st-unknown'], collapsed: true },
      { id: 'L5', title: '数据迁移', meta: '未细化 · 覆盖 C1、C2', tone: 'unrefined', badge: ['未细化', 'st-unknown'], collapsed: true },
      { id: 'L6', title: '验收', meta: '必经 · 1 步', badge: ['已细化', 'st-done'] },
    ],
    nodes: [
      { id: 'start', title: '开始', system: true },
      { id: 'a1', title: '账户模型设计', role: '架构师', meta: '账户 / 流水表结构', group: 'L1' },
      { id: 'a2', title: '流水写入服务', role: '后端工程师', meta: '幂等写入', group: 'L1' },
      { id: 'a3', title: '余额查询接口', role: '后端工程师', meta: '查询接口', group: 'L1' },
      { id: 'a4', title: '账户测试', role: '测试工程师', meta: '测试报告', group: 'L1' },
      { id: 'b1', title: '规则配置', role: '后端工程师', meta: '获取规则', group: 'L2' },
      { id: 'b2', title: '下单得积分', role: '后端工程师', meta: '事件订阅', group: 'L2' },
      { id: 'b3', title: '规则测试', role: '测试工程师', meta: '测试报告', group: 'L2' },
      { id: 'c0', title: '消耗与抵扣', group: 'L3' }, { id: 'd0', title: '过期与清零', group: 'L4' }, { id: 'e0', title: '数据迁移', group: 'L5' },
      { id: 'f1', title: '人工验收', role: '人工', meta: '验收结论', group: 'L6' },
      { id: 'end', title: '交付', system: true },
    ],
    edges: [['start', 'a1'], ['a1', 'a2'], ['a1', 'a3'], ['a2', 'a4'], ['a3', 'a4'], ['a1', 'b1'], ['b1', 'b2'], ['b2', 'b3'], ['a2', 'c0'], ['a2', 'd0'], ['a1', 'e0'], ['a4', 'f1'], ['b3', 'f1'], ['c0', 'f1'], ['d0', 'f1'], ['e0', 'f1'], ['f1', 'end']].map(([from, to]) => ({ from, to })),
  };
  window.PEF = { TASKS, task, SKELETON, GROUPS, candidate, partial, details, records, ROUNDS, LARGE };
})();
