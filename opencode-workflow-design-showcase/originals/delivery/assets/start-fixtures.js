/* TD01 开始任务与隔离准备 · 样例数据（设计样例 · 合成数据，不连接任务 / Git / 目录） */
window.START_FX = {
  projects: [
    { id: 'order', name: '订单服务', path: '/Users/dev/workspace/order-service', kind: 'git', remote: 'GitLab · shop/order-service', head: 'main', dirty: 3 },
    { id: 'ops', name: '运营报表脚本', path: '/Users/dev/workspace/ops-report-scripts', kind: 'dir' },
    { id: 'pay', name: '支付网关', path: '/Users/dev/workspace/payment-gateway', kind: 'git', denied: true },
    { id: 'notify', name: '通知中心', path: '/Users/dev/workspace/notify-center', kind: 'git', empty: true },
  ],
  flows: [
    { id: 'std', name: '需求开发 · 标准', desc: '从需求到交付，适合新功能。', steps: ['梳理需求', '实现接口 ∥ 编写测试', '回归测试', '人工验收'], rev: 12 },
    { id: 'fix', name: '小范围修复', desc: '问题明确、改动小。', steps: ['定位问题', '实施修改', '验证'], rev: 5 },
    { id: 'doc', name: '文档编写', desc: '产出设计文档或变更说明。', steps: ['收集资料', '起草', '评审'], rev: 3 },
  ],
  tasks: {
    git: {
      id: 'T-2041', name: '退款单分页查询与导出', project: 'order', flow: 'std', planRev: 2, planAt: '10-15 09:52',
      goal: '退款单列表支持分页查询，并能按当前筛选条件导出 Excel；超过 1 万行时分批生成，导出结果可下载。',
      base: { branch: 'main', sha: '7c1e9a2', full: '7c1e9a2f4b0d8e61c3a95f27d48b1e09a6c3f5d2', readAt: '10-15 09:52' },
      oldBase: { sha: '5b3a8f1', full: '5b3a8f17d0c4e2b9a61f83d05c7e4a92b1d6f038', readAt: '10-15 09:31' },
      newCommits: [['a4c1f0e', '修复订单状态枚举的大小写', 'li.wei · 09:44'], ['7c1e9a2', '升级 exceljs 到 4.4.0', 'dev-zhao · 09:50']],
      branch: 'task/T-2041-refund-export',
      wsName: 'order-service · T-2041',
      wsPath: '~/.opencode-workflow/workspaces/order-service/T-2041',
      wsRoot: '~/.opencode-workflow/workspaces/order-service',
      prepKey: 'prep-T-2041-01',
      nodes: [
        { t: '梳理需求', r: '产品经理', w: 'ro' },
        { par: [{ t: '实现接口', r: '软件工程师', w: 'rw' }, { t: '编写测试', r: '测试工程师', w: 'rw' }] },
        { t: '回归测试', r: '测试工程师', w: 'rw' },
        { t: '人工验收', r: '人工', w: 'human' },
      ],
      policy: '「实现接口」「编写测试」各自在子工作区写入，结束后由服务汇合到任务工作区，再进入「回归测试」；只读节点读取一致快照。',
      conflict: {
        branch: { name: 'task/T-2041-refund-export', at: '3f2e1d0', when: '10-12 14:20 创建', owner: '不属于本任务的准备记录' },
        dir: { path: '~/.opencode-workflow/workspaces/order-service/T-2041', note: '目录已存在且非空', owner: '不属于本任务的准备记录' },
      },
    },
    dir: {
      id: 'T-2043', name: '月报改为按自然月汇总', project: 'ops', flow: 'fix', planRev: 1, planAt: '10-15 09:36',
      goal: '月报目前按 4 周滚动汇总，改为按自然月（1 日至月末）汇总，模板中的周期说明同步更新。',
      snap: { ref: 'bs-0915-0940', at: '10-15 09:40', pre: '10-15 09:38' },
      scope: '全部文件',
      excludes: ['node_modules/', '.cache/', '单个大于 50 MB 的文件'],
      skipped: [{ path: 'data/raw-2025.parquet', size: '210 MB', why: '超过单文件 50 MB 上限' }],
      wsName: 'ops-report-scripts · T-2043',
      wsPath: '~/.opencode-workflow/copies/ops-report-scripts/T-2043',
      prepKey: 'prep-T-2043-01',
      nodes: [
        { t: '定位问题', r: '软件工程师', w: 'ro' },
        { t: '实施修改', r: '软件工程师', w: 'rw' },
        { t: '验证', r: '测试工程师', w: 'rw' },
        { t: '人工验收', r: '人工', w: 'human' },
      ],
      policy: '本计划没有并行写节点：写文件的节点按顺序在独立副本中运行；只读节点读取一致快照。',
    },
  },
};
