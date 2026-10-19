/* task.html 样例数据（设计样例 · 合成数据，不对应任何真实任务、仓库或目录）
   统一故事见 TD-SPEC §1：Git 主线 T-2041、后台任务 T-2042、非 Git 任务 T-2043。 */
window.TASK_FX = (function () {
  const GIT_FILES = [
    ['A', 'src/refund/export.ts', '+182', ''],
    ['M', 'src/refund/service.ts', '+37 −14', ''],
    ['M', 'src/refund/controller.ts', '+12 −3', ''],
    ['M', 'src/api/refunds.route.ts', '+6 −1', ''],
    ['A', 'test/refund/export.spec.ts', '+96', ''],
    ['D', 'src/refund/legacy-export.ts', '−58', ''],
    ['M', 'fixtures/refunds-2026.csv', '2.4 MB', '大文件 · 分段读取'],
    ['A', 'docs/export-sample.xlsx', '二进制', '二进制 · 不显示文本 diff'],
    ['M', 'scripts/export.sh', '100644 → 100755', '仅权限变更'],
  ];
  const GIT_EXCLUDED = [
    ['dist/', '构建产物（.gitignore）'],
    ['.env.local', '忽略规则排除 · 内容不显示'],
    ['coverage/', '工具生成'],
  ];
  const DIR_FILES = [
    ['M', 'report/monthly.py', '+64 −31', ''],
    ['A', 'report/calendar_util.py', '+48', ''],
    ['D', 'report/legacy_week.py', '−72', ''],
    ['M', 'config/report.yaml', '+5 −2', ''],
    ['M', 'templates/monthly.html', '+18 −9', ''],
    ['A', 'assets/logo.png', '二进制', '二进制 · 只比较身份与大小'],
    ['A', 'exports/', '目录', '任务中为目录'],
    ['M', 'README.md', '+12 −4', ''],
  ];
  const T2041 = {
    id: 'T-2041', exec: 'ex-2041', kind: 'git',
    title: '退款单分页查询与导出', flow: '需求开发 · 标准',
    project: '订单服务', projectPath: '/Users/dev/workspace/order-service', remote: 'GitLab shop/order-service',
    originNote: '原工作区仍在 main，3 个未提交改动保留，不受本任务影响',
    ws: 'order-service · T-2041', wsRef: 'ws-2041', wsPath: '~/.opencode-workflow/workspaces/order-service/T-2041',
    branch: 'task/T-2041-refund-export', base: 'main', baseSha: '7c1e9a2', baseShaFull: '7c1e9a2f04d6b3c58e19a7d2f60b4c1e3a95d870',
    created: '10-15 10:31', checked: '10-15 16:02',
    changesRev: 'cr-7', readAt: '16:02',
    files: GIT_FILES, excluded: GIT_EXCLUDED, adm: { A: 3, M: 5, D: 1 }, lines: '+333 −76',
    verify: { ok: '单元测试 41 / 41 通过 · lint 通过', fail: '回归测试 2 个失败（export 分页边界）' },
    commit: '9d8c7b6', author: 'dev-zhang <dev@example.com>', remoteRef: 'origin/task/T-2041-refund-export',
    mr: '!58', mrTarget: 'main', mrTitle: 'feat: 退款单分页查询与导出', deliveredAt: '10-15 16:20',
    subs: [['实现接口', '子工作区 A'], ['编写测试', '子工作区 B']],
    nodes: [
      { id: 'start', title: '开始', system: true },
      { id: 'n1', title: '梳理需求', role: '产品经理', output: '需求说明与接口约定', what: '梳理退款单分页查询与导出的范围、字段和边界条件。' },
      { id: 'n2', title: '实现接口', role: '软件工程师', output: '代码变更', what: '实现分页查询接口与导出服务，替换旧的导出实现。' },
      { id: 'n3', title: '编写测试', role: '测试工程师', output: '测试用例', what: '为分页与导出补充单元测试，覆盖空页与末页。' },
      { id: 'n4', title: '回归测试', role: '测试工程师', output: '测试报告', what: '在汇合后的任务工作区运行单元测试、lint 与回归用例。' },
      { id: 'n5', title: '人工验收', role: '人工', output: '验收结论', what: '由你确认改动是否达到目标。' },
      { id: 'end', title: '交付', system: true },
    ],
  };
  const T2042 = Object.assign({}, T2041, {
    id: 'T-2042', exec: 'ex-2042', title: '优惠券过期提醒',
    ws: 'order-service · T-2042', wsRef: 'ws-2042', wsPath: '~/.opencode-workflow/workspaces/order-service/T-2042',
    branch: 'task/T-2042-coupon-expiry', created: '10-15 11:05', checked: '10-15 16:04', changesRev: 'cr-3', readAt: '16:04',
    files: [['A', 'src/coupon/expiry-notice.ts', '+121', ''], ['M', 'src/coupon/scheduler.ts', '+22 −6', ''], ['M', 'src/coupon/templates.ts', '+9 −2', ''], ['A', 'test/coupon/expiry-notice.spec.ts', '+64', ''], ['M', 'docs/coupon.md', '+8 −1', '']],
    excluded: [['dist/', '构建产物（.gitignore）']], adm: { A: 2, M: 3, D: 0 }, lines: '+224 −9',
    verify: { ok: '单元测试 28 / 28 通过 · lint 通过', fail: '' },
  });
  const T2043 = {
    id: 'T-2043', exec: 'ex-2043', kind: 'dir',
    title: '月报改为按自然月汇总', flow: '需求开发 · 标准',
    project: '运营报表脚本', projectPath: '/Users/dev/workspace/ops-report-scripts', remote: '',
    originNote: '直接目录，不受 Git 管理，不会自动初始化仓库；任务期间原目录不被写入',
    ws: 'ops-report-scripts · T-2043', wsRef: 'ws-2043', wsPath: '~/.opencode-workflow/copies/ops-report-scripts/T-2043',
    baseline: 'bs-0915-0940', baselineAt: '10-15 09:40', scope: '全部文件',
    excludes: ['node_modules/', '.cache/', '单个大于 50 MB 的文件'], notCopied: [['data/raw-2025.parquet', '210 MB']],
    created: '10-15 09:40', checked: '10-15 16:05',
    changesRev: 'dr-4', readAt: '16:05',
    files: DIR_FILES, excluded: [['node_modules/', '基线排除'], ['.cache/', '基线排除'], ['data/raw-2025.parquet', '未复制（210 MB，超过 50 MB）']], adm: { A: 3, M: 4, D: 1 }, lines: '',
    verify: { ok: '单元测试 17 / 17 通过 · 样例月报比对一致', fail: '样例月报比对 1 处不一致（2 月跨月）' },
    deliveredAt: '10-15 16:15', frozenAt: '16:12', appliedAt: '16:14',
    applied: { ok: 5, okNote: 'report/monthly.py、report/calendar_util.py、templates/monthly.html、assets/logo.png、README.md', keep: 2, keepNote: 'report/legacy_week.py、exports 冲突处理为「保留当前原文件」，原目录中未改动', skip: 1, skipNote: 'config/report.yaml 暂不交付，留在独立副本（服务判定允许交付）' },
    subs: [['实现汇总逻辑', '子副本 A'], ['编写测试', '子副本 B']],
    nodes: [
      { id: 'start', title: '开始', system: true },
      { id: 'n1', title: '梳理需求', role: '产品经理', output: '口径说明', what: '确认自然月口径、跨月数据与模板改动范围。' },
      { id: 'n2', title: '实现汇总逻辑', role: '软件工程师', output: '脚本变更', what: '按自然月重写汇总逻辑，删除按周汇总的旧实现。' },
      { id: 'n3', title: '编写测试', role: '测试工程师', output: '测试用例', what: '为跨月、闰年和空月补充测试。' },
      { id: 'n4', title: '回归测试', role: '测试工程师', output: '测试报告', what: '在汇合后的独立副本运行测试与样例月报比对。' },
      { id: 'n5', title: '人工验收', role: '人工', output: '验收结论', what: '由你确认月报口径是否正确。' },
      { id: 'end', title: '交付', system: true },
    ],
  };
  return { T2041, T2042, T2043, byId: { 'T-2041': T2041, 'T-2042': T2042, 'T-2043': T2043 } };
})();
