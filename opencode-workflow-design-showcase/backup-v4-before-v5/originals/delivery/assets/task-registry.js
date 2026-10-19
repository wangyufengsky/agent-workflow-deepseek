/* 补稿 v4（2026-10-16）· 统一任务画布的任务身份注册表（设计样例 · 合成数据）
   统一任务画布 delivery/task.html 按 ?task= 读取真实身份；没有 ?task= 时，TD 状态沿用原 T-2041，补稿状态用各自的默认身份。
   来源：TASK_FX（最新 TD：T-2041 / T-2042 / T-2043）、PEF（规划创建的任务）、UTF（旧任务、固定模板与准备事实）。
   每个任务带 origin：planning（AI 规划创建）· old（迁入的旧普通任务）· td（TD 样例）· fixed（固定菜单模板，origin=fixed-menu-template）· legacy（独立工作区上线前已结束的旧记录）。 */
window.UT_REG = (function () {
  'use strict';
  const FX = window.TASK_FX, U = window.UTF, PF = window.PEF;
  const R = {};
  const E5 = [['start', 'n1'], ['n1', 'n2'], ['n1', 'n3'], ['n2', 'n4'], ['n3', 'n4'], ['n4', 'n5'], ['n5', 'end']];
  const chainEdges = (n) => { const e = [['start', 'n1']]; for (let i = 1; i < n; i++) e.push(['n' + i, 'n' + (i + 1)]); e.push(['n' + n, 'end']); return e; };
  const sysNodes = (list) => [{ id: 'start', title: '开始', system: true }].concat(list, [{ id: 'end', title: '交付', system: true }]);
  /* 5 步拓扑（n1 → n2 ∥ n3 → n4 → n5）各执行时刻的步骤状态 */
  const RUN5 = {
    first: { n1: 'run' }, mid: { n1: 'done', n2: 'run', n3: 'run' }, advance: { n1: 'done', n2: 'adv', n3: 'adv' },
    paused: { n1: 'done', n2: 'paused', n3: 'paused' }, stalled: { n1: 'done', n2: 'stall', n3: 'done' }, waiting: { n1: 'done', n2: 'run', n3: 'wait' },
    failed: { n1: 'done', n2: 'done', n3: 'done', n4: 'fail' }, recovering: { n1: 'done', n2: 'done', n3: 'done', n4: 'fail' }, review: { n1: 'done', n2: 'done', n3: 'done', n4: 'done', n5: 'review' },
    unknown: { n1: 'done', n2: 'unknown', n3: 'run' }, recover: { n1: 'done', n2: 'done', n3: 'done', n4: 'run' }, done: { n1: 'done', n2: 'done', n3: 'done', n4: 'done', n5: 'done' }, stopped: { n1: 'done', n2: 'skip', n3: 'skip', n4: 'skip', n5: 'skip' },
  };
  const runChain = (n) => { const all = (s) => Object.fromEntries(Array.from({ length: n }, (_, i) => ['n' + (i + 1), s])); return { first: { n1: 'run' }, mid: { n1: 'done', n2: 'run' }, paused: { n1: 'done', n2: 'paused' }, unknown: { n1: 'done', n2: 'unknown' }, done: all('done'), stopped: Object.assign(all('skip'), { n1: 'done' }), failed: Object.assign(all('done'), { ['n' + n]: 'fail' }) }; };
  /* 与需求画布 B08 的执行时刻一致：第 3 段“后端筛选查询”已验收，“导出 CSV 接口”执行中，“前端筛选栏与导出按钮”等待同任务写入互斥 */
  const RUN8 = { first: { n1: 'run' }, mid: { n1: 'done', n2: 'done', n3: 'done', n4: 'run' }, paused: { n1: 'done', n2: 'done', n3: 'done', n4: 'paused' } };
  /* 交付面板等沿用 TD 字段：基于 T-2041 / T-2043 的结构复制，替换身份 */
  function base(kind) { return Object.assign({}, kind === 'dir' ? FX.T2043 : FX.T2041); }
  function wsFields(id, project, slug, kind) {
    const p = (U.PROJECTS[project]) || { slug: 'project', path: '/Users/dev/workspace/project', remote: '' };
    const git = kind !== 'dir';
    return { kind: git ? 'git' : 'dir', project, projectPath: p.path, remote: p.remote ? p.remote.replace(' · ', ' ') : '', ws: `${p.slug} · ${id}`, wsRef: 'ws-' + id.slice(2), wsPath: `~/.opencode-workflow/${git ? 'workspaces' : 'copies'}/${p.slug}/${id}`,
      branch: `task/${id}-${slug}`, originNote: git ? `原工作区仍在 main${p.dirty ? `，${p.dirty} 个未提交改动保留` : ''}，不受本任务影响` : '直接目录，不受 Git 管理，不会自动初始化仓库；任务期间原目录不被写入',
      exec: 'ex-' + id.slice(2), created: '10-16 14:26', checked: '10-16 14:40', changesRev: 'cr-1', readAt: '14:40' };
  }
  const genFiles = (pkg, Cls) => [['A', `src/${pkg}/query/${Cls}Filter.java`, '+64', ''], ['M', `src/${pkg}/query/${Cls}QueryService.java`, '+22 −4', ''], ['A', `src/${pkg}/export/${Cls}CsvExporter.java`, '+118', ''], ['M', `web/src/pages/${pkg}/List.vue`, '+41 −6', ''], ['A', `test/${pkg}/${Cls}FilterTest.java`, '+73', '']];

  /* ---------- TD 样例（保持原样，补 origin 与调整点） ---------- */
  [FX.T2041, FX.T2042, FX.T2043].forEach((t) => { R[t.id] = Object.assign(t, { origin: 'td', edges: E5, run: RUN5, auto: true, execState: 'running', adj: { after: 'n4', add: { id: 'n6', title: '补充冒烟测试', role: '测试工程师', meta: '主流程冒烟 ≤ 5 分钟', what: '在汇合后的任务工作区跑主流程冒烟。' }, to: 'n5', conflict: 'n4', mod: '验收补充“空页与末页”' }, planRev: 2 }); });

  /* ---------- AI 规划创建的任务（PEF 同构样例 + v4 新增名词） ---------- */
  function planning(id, over) {
    const t = PF.task(id), g = PF.candidate(t), D = PF.details(t);
    const kind = (U.PROJECTS[t.project] || {}).kind || 'git';
    const nodes = g.nodes.map((n) => n.system ? { id: n.id, title: n.title, system: true } : { id: n.id, title: n.title, role: n.role, output: n.meta, what: (D[n.id] && D[n.id].task) || n.meta, req: (D[n.id] && D[n.id].req) || [] });
    const files = genFiles(t.pkg, t.cls);
    const o = Object.assign(base(kind), wsFields(id, t.project, 'filter-export', kind), {
      id, origin: 'planning', title: t.title, flow: t.method, nodes, edges: g.edges.map((e) => [e.from, e.to]), run: RUN8, auto: true, execState: 'running', planRev: 3,
      files, adm: { A: 3, M: 2, D: 0 }, lines: '+318 −10', excluded: [['dist/', '构建产物（.gitignore）']],
      subs: [['后端筛选查询', '子工作区 A'], ['前端筛选栏与导出按钮', '子工作区 B']],
      verify: { ok: '接口测试 26 / 26 通过 · 旧数据回归通过', fail: '旧数据回归 1 个失败（空状态）' },
      adj: { after: 'n6', add: { id: 'n9', title: '导出性能测试', role: '测试工程师', meta: '1 万行导出 ≤ 10 秒', what: '验证 1 万行导出在 10 秒内完成，超时给出明确提示。' }, to: 'n8', conflict: 'n5', mod: '验收补充“导出按钮带当前筛选条件”' },
      noun: t.noun, pkg: t.pkg,
    }, over || {});
    if (kind === 'dir') Object.assign(o, { baseline: 'bs-' + id.slice(2) + '-1424', baselineAt: '10-16 14:24', scope: '全部文件', excludes: ['node_modules/', '.cache/', '单个大于 50 MB 的文件'], notCopied: [['data/raw-2025.parquet', '210 MB']] });
    return o;
  }
  ['T-2050', 'T-2051', 'T-2054', 'T-2055', 'T-2056', 'T-2057', 'T-2062', 'T-2063', 'T-2064', 'T-2065', 'T-2066', 'T-2067'].forEach((id) => { R[id] = planning(id); });

  /* ---------- 旧需求（已确认 / 草稿，经需求画布准备后开始执行） ---------- */
  Object.entries(U.LEGACY).forEach(([id, L]) => {
    const nodes = sysNodes(L.steps.map((s) => ({ id: s.id, title: s.title, role: s.role, output: s.output, what: s.what, req: s.req })));
    R[id] = Object.assign(base('git'), wsFields(id, L.project, 'docs', 'git'), { id, origin: 'old', title: L.title, flow: L.method, nodes, edges: L.edges, run: RUN5, auto: true, execState: 'running', planRev: L.planRev + 1,
      files: [['M', 'docs/api/tasks.md', '+120 −40', ''], ['A', 'docs/changelog/v2.4.md', '+64', '']], adm: { A: 1, M: 1, D: 0 }, lines: '+184 −40', excluded: [], subs: [['编写接口文档', '子工作区 A'], ['编写变更说明', '子工作区 B']],
      adj: { after: 'n4', add: { id: 'n6', title: '补充示例请求', role: '技术写作', meta: '每个接口 1 个示例', what: '为每个接口补 1 个可运行的示例请求。' }, to: 'n5', conflict: 'n4', mod: '验收补充“示例可运行”' }, rqId: L.rqId });
  });

  /* ---------- 迁入的旧普通任务 ---------- */
  Object.entries(U.OLD).forEach(([id, O]) => {
    const n = O.steps.length;
    const nodes = sysNodes(O.steps.map(([title, role, output, what], i) => ({ id: 'n' + (i + 1), title, role, output, what })));
    const legacy = !!O.legacy;
    R[id] = Object.assign(base('git'), wsFields(id, O.project, 'task', 'git'), {
      id, origin: legacy ? 'legacy' : 'old', legacy: O.legacy || null, doneAt: O.doneAt, title: O.title, flow: '需求开发 · 标准', nodes, edges: O.chain ? chainEdges(n) : E5, run: O.chain ? runChain(n) : RUN5,
      auto: id !== 'T-2035', execState: id === 'T-2030' ? 'paused' : 'running', planRev: 2, rqId: O.rqId, type: O.type || '需求任务', note: O.note,
      files: [['M', 'src/app/service.ts', '+42 −9', ''], ['A', 'test/app/service.spec.ts', '+58', '']], adm: { A: 1, M: 1, D: 0 }, lines: '+100 −9', excluded: [['dist/', '构建产物（.gitignore）']],
      subs: [[O.steps[1][0], '子工作区 A'], [(O.steps[2] || O.steps[1])[0], '子工作区 B']],
      verify: { ok: '单元测试通过 · lint 通过', fail: '回归测试 3 个失败' },
      adj: O.chain ? null : { after: 'n4', add: { id: 'n6', title: '补充冒烟测试', role: '测试工程师', meta: '主流程冒烟 ≤ 5 分钟', what: '在任务工作区跑主流程冒烟。' }, to: 'n5', conflict: 'n4', mod: '验收补充“覆盖空状态”' },
    });
  });

  /* ---------- 固定菜单模板任务（origin=fixed-menu-template，锁定与名称 / 版本无关） ---------- */
  function fixed(id, tplKey, over) {
    const tp = U.TEMPLATES[tplKey];
    const nodes = sysNodes(tp.steps.map(([title, role, output, w], i) => ({ id: 'n' + (i + 1), title, role, output, w, what: `模板“${tp.name}”的固定步骤：${title}。` })));
    return Object.assign(base('git'), wsFields(id, (over && over.project) || tp.project, tplKey, 'git'), {
      id, origin: 'fixed', tpl: Object.assign({ key: tplKey }, tp), title: `${tp.name} · ${(tp.params[0] || [])[1] || tp.project}`, flow: `${tp.name} · 模板版本 ${tp.rev}`,
      nodes, edges: chainEdges(tp.steps.length), run: runChain(tp.steps.length), auto: true, execState: 'running', planRev: 1, adj: null,
      files: [['A', 'src/test/java/com/loopper/task/TaskServiceTest.java', '+96', '']], adm: { A: 1, M: 0, D: 0 }, lines: '+96', excluded: [], subs: [[tp.steps[1][0], '子工作区 A'], [tp.steps[1][0], '子工作区 A']],
    }, over || {});
  }
  Object.entries(U.TEMPLATES).forEach(([k, tp]) => { R[tp.task] = fixed(tp.task, k, { title: `${tp.name} · ${tp.project}${tp.params[0] ? ' · ' + tp.params[0][1].split('/').slice(-2).join('/') : ''}` }); });
  Object.entries(U.FIXED_RUNNING).forEach(([id, F]) => { R[id] = fixed(id, F.tpl, { title: F.title, project: F.project, snapArchive: !!F.snapArchive }); });

  return R;
})();
