/* 需求画布 · 普通流程 AI 规划（设计样例 · 全部模拟）
   一张画布承接：空草稿 → 预览 → 长规划（阶段 / 记录 / 部分草稿）→ 检查 → 候选审阅 → 应用 → 确认 → 准备独立工作区。
   所有“服务事实”来自样例；状态推进由按钮（命令，replaceState）或底部“模拟服务事件”触发，不由前端定时器自行跳阶段。 */
(function () {
  const I = DS.icon, esc = DS.esc, $ = (s, r = document) => r.querySelector(s);
  const LG = ['pe37', 'lg-planning', 'lg-cand'];
  const LARGE_MODE = () => LG.includes(S);
  let S = PE.init('requirement.html', (id) => { S = id; resetTransient(); render(); });
  /* ---------- v4：真实身份（规划同构样例 / 旧需求 / 固定模板），直接打开某状态时用该状态的默认身份 ---------- */
  const DEF_TASK = { 'pw-nongit': 'T-2064', 'pw-preparing': 'T-2051', 'pw-ready': 'T-2051', 'pw-unknown': 'T-2062', 'pw-partial': 'T-2063', 'pw-conflict': 'T-2065', 'pw-drift': 'T-2027', 'pw-denied': 'T-2066', 'pw-empty': 'T-2067', fx01: 'T-2070', qa02: 'T-2051', qa03: 'T-2051' , pe37: 'T-2060', 'lg-planning': 'T-2060', 'lg-cand': 'T-2060' };
  const T = resolveTask(PE.ctx('task') || DEF_TASK[S]);
  function resolveTask(id) {
    if (id === 'T-2060') return PEF.LARGE.task();
    const U = window.UTF || {};
    const L = U.LEGACY && U.LEGACY[id];
    if (L) {
      const span = (s) => { const a = L.original.indexOf(s); return [a, a + s.length]; };
      return { id, title: L.title, project: L.project, baseline: 'main @ 7c1e9a2', method: L.method, policy: '—', original: L.original, legacy: true, draft: !!L.draft, rqId: L.rqId, planRev: L.planRev, confirmedAt: L.confirmedAt,
        items: L.items.map(([k, kind, text, src]) => ({ k, kind, text, span: span(src) })), steps: L.steps, edges: L.edges, pkg: 'docs', cls: 'Doc' };
    }
    const tp = (U.tplByTask && U.tplByTask(id)) || (PE.ctx('tpl') && U.TEMPLATES && U.TEMPLATES[PE.ctx('tpl')] ? [PE.ctx('tpl'), U.TEMPLATES[PE.ctx('tpl')]] : null);
    if (tp && (id || '').startsWith('T-207')) {
      const t = tp[1];
      return { id: id || t.task, title: `${t.name} · ${t.project}${t.params[0] ? ' · ' + t.params[0][1].split('/').slice(-2).join('/') : ''}`, project: t.project, baseline: 'main @ 7c1e9a2', method: `${t.name} · 模板版本 ${t.rev}`, fixed: true, tpl: Object.assign({ key: tp[0] }, t), planRev: 1, confirmedAt: '14:31',
        original: '', items: [], pkg: 'tpl', cls: 'Tpl' };
    }
    return Object.assign(PEF.task(id), { planRev: 3 });
  }
  const isLegacy = () => !!T.legacy, isFixed = () => !!T.fixed, isLarge = () => !!T.large, special = () => isLegacy() || isFixed() || isLarge();
  /* v5（PE37）：分组逐步细化的 URL 事实（原型对服务读模型的模拟）：done = 已应用的组（按轮次顺序）；gp = 本轮细化的组 */
  const lgDone = () => (PE.ctx('done') || '').split(',').filter((g) => PEF.LARGE.UNREFINED.includes(g)).filter((g, i, a) => a.indexOf(g) === i);
  const lgLeft = () => PEF.LARGE.UNREFINED.filter((g) => !lgDone().includes(g));
  const lgGp = () => (PEF.LARGE.UNREFINED.includes(PE.ctx('gp')) && !lgDone().includes(PE.ctx('gp')) ? PE.ctx('gp') : lgLeft()[0]);
  /* v5（Q9）：规划依据可以点进目录的只读详情（流程 → AI 规划；角色管理 → 规划职责），带 back 回到当前画布 */
  const here = () => (window.SC && SC.originalRoot ? location.href.slice(SC.originalRoot.href.length) : '');
  const catUrl = (k) => window.SC ? SC.url(k === 'role' ? 'main/pages/roles.html' : 'main/pages/workflows.html', { state: k === 'role' ? 'planning-role' : 'detail-planning', back: here() }) : '#';
  const basisHTML = () => `<a href="${catUrl('policy')}" data-cat="policy" style="color:var(--accent)">规划策略 v1</a> · <a href="${catUrl('role')}" data-cat="role" style="color:var(--accent)">需求分析师（规划职责）</a>`;
  const lgName = (g) => (PEF.LARGE.groups.find((x) => x.id === g) || {}).title || g;
  const lgRound = () => 2 + lgDone().length;  // 总览是第 1 轮；每次继续规划选区是新的一轮
  const lgRev = () => 2 + lgDone().length;    // 总览应用 → 修订 2；每应用一组 +1
  const DET = special() ? {} : PEF.details(T), REC = special() ? [] : PEF.records(T);
  const ui = { tab: PE.ctx('tab'), sel: PE.ctx('sel'), layer: PE.ctx('layer'), reading: false, tool: null, follow: true, acks: {}, collapsed: {}, skeleton: false, dismissed: false, serial: false, ws: 'idle', supp: '', dialog: null, busy: null, newCount: 0,
    ans: {}, ansSaved: S === 'qa02' || S === 'qa03' ? 2 : null, reval: S === 'qa02' ? 'ok' : S === 'qa03' ? 'stale' : null, fixedConfirmed: false };
  if (S === 'qa02') ui.ans = { 'q-date': 'created', 'q-limit': '10000' };
  if (PE.ctx('ans')) { const v = PE.ctx('ans').split('|'); if (v.length === 2) { ui.ans = { 'q-date': v[0], 'q-limit': v[1] }; ui.ansSaved = 2; if (['pe25'].includes(S) && round() === 1) ui.reval = v[0] === 'created' && v[1] === '10000' ? 'ok' : 'stale'; } }
  if (S === 'qa03') ui.ans = { 'q-date': 'finished', 'q-limit': '10000' };
  let view = null; try { view = JSON.parse(PE.ctx('view') || 'null'); } catch (e) { view = null; }
  function resetTransient() { ui.tool = null; ui.dialog = null; ui.busy = null; ui.follow = true; ui.newCount = 0; ui.tab = PE.ctx('tab'); ui.layer = PE.ctx('layer'); }

  /* ---------- v4（AD06 / C05）：业务问题与风险核对分开 ----------
     会改变业务含义、范围或验收的提议（日期字段、导出上限）是“业务问题”：显示选项、对步骤 / 输入输出 / 验收的影响与来源，
     必须由你明确回答；未回答不能应用。预选只是建议，不算回答。回答形成需求输入修订（旧轮输入保留），由服务按新修订重新校验候选。
     只有不改变业务范围的一般不确定性才走“需人工判断”逐项勾选（ACKS）。不做“关键 / 非关键”自动打分。 */
  const BQ = [
    { id: 'q-date', t: '日期范围按哪个字段筛选？', src: '模型假设（规划记录 #9）· 原文只写“日期范围”', nodes: ['n3', 'n7'], impact: '后端筛选查询的查询条件、旧数据回归的验收',
      opts: [['created', '创建时间（created_at）', '与候选一致：按 created_at 过滤；旧数据回归覆盖创建时间为空'], ['finished', '完成时间（finished_at）', '未完成的单据没有完成时间，不会出现在日期筛选结果里；候选需要重新规划']], suggest: 'created' },
    { id: 'q-limit', t: '导出 CSV 单次最多多少行？超出时怎么办？', src: '模型提议（规划记录 #13）· 原文未要求', nodes: ['n4', 'n5'], impact: '导出 CSV 接口的验收条款与前端提示',
      opts: [['10000', '最多 10,000 行，超出时提示缩小筛选范围', '与候选一致：写入导出 CSV 接口的验收'], ['50000', '最多 50,000 行，超出时改为异步生成', '范围扩大（异步生成与通知），候选需要重新规划'], ['none', '不限制', '需要分批写出；候选需要重新规划']], suggest: '10000' },
  ];
  const bqAnswered = () => BQ.every((q) => ui.ans[q.id]);
  const bqMatches = () => BQ.every((q) => ui.ans[q.id] === q.suggest);
  const bqLabel = (q, v) => (q.opts.find((o) => o[0] === v) || [])[1] || '';
  const PREP_STATE = { plan: 'pe32', preparing: 'pw-preparing', ready: 'pw-ready', unknown: 'pw-unknown', partial: 'pw-partial', conflict: 'pw-conflict', drift: 'pw-drift', denied: 'pw-denied', empty: 'pw-empty' };
  const PW = ['pe32', 'pw-nongit', 'pw-preparing', 'pw-ready', 'pw-unknown', 'pw-partial', 'pw-conflict', 'pw-drift', 'pw-denied', 'pw-empty'];
  const isPW = () => PW.includes(S);
  let PR = null;
  function prep() {
    if (PR || !window.PREP || !window.UTF) return PR;
    const F = UTF.prepFacts(T.id, T.project, isFixed() ? T.tpl.key : isLegacy() ? 'docs' : isLarge() ? 'points-rework' : 'filter-export');
    const init = { pe32: 'plan', 'pw-nongit': 'plan' }[S] || ({ 'pw-preparing': 'preparing', 'pw-ready': 'ready', 'pw-unknown': 'unknown', 'pw-partial': 'partial', 'pw-conflict': 'conflict', 'pw-drift': 'drift', 'pw-denied': 'denied', 'pw-empty': 'empty' })[S] || 'plan';
    const first = isFixed() ? T.tpl.steps[0][0] : (isLegacy() || isLarge()) ? T.steps[0].title : '梳理需求';
    PR = PREP({ T, F, firstStep: first, reduced: document.documentElement.classList.contains('reduced'),
      init: { ws: init, stage: +PE.ctx('at') || (init === 'preparing' ? 2 : 0), renamed: PE.ctx('ren') === '1', reread: PE.ctx('rr') === '1', readable: PE.ctx('rd') === '1' },
      onState: (ws, st) => { PE.to(PREP_STATE[ws] === 'pe32' && !PR.git ? 'pw-nongit' : PREP_STATE[ws], { ren: st.renamed ? '1' : null, rr: st.reread ? '1' : null, rd: st.readable ? '1' : null, at: ws === 'preparing' ? String(st.stage) : null, tab: 'ws' }); },
      rerender: () => { renderSide(cfg()); renderBar(cfg()); },
      openDialog: (html, trigger) => { ui.dialog = 'prep'; const d = $('#dlg'); d.innerHTML = html; d.dataset.opt = '{}'; DS.openDialog('dlg', trigger); },
      closeDialog: () => { ui.dialog = null; DS.closeDialog('dlg'); },
      focus: (sel) => setTimeout(() => $(sel)?.focus(), 40),
      onStart: () => startExec(),
      onNewTask: () => { location.href = PEN.url('start.html', { state: 'pe01' }); } });
    if (init === 'preparing' && PE.ctx('sim') === '1') setTimeout(() => PR.tick(), 50);
    return PR;
  }
  function startExec() {
    SC.go('delivery/task.html?state=' + (isFixed() ? 'ut-fixed-running' : 'ut-running'), { task: T.id, note: 'started' });
  }

  /* ================= 状态配置 ================= */
  const RUNNING = ['pe05', 'pe06', 'pe07', 'pe08', 'pe09', 'pe10', 'pe13', 'pe15', 'pe16', 'pe17', 'pe18', 'pe26', 'pe24', 'b01'];
  const READY = ['pe25', 'pe27', 'pe28', 'pe29', 'b05', 'qa02', 'qa03'];
  const STOPPED = ['pe19', 'pe20', 'pe21', 'pe22', 'pe23'];
  const EMPTY = ['pe02', 'pe03', 'pe04', 'b06', 'b07'];
  function round() { if (['qa02', 'qa03'].includes(S)) return 1; const r = +PE.ctx('round'); return r === 1 ? 1 : 2; }
  function rounds() { return round() === 1 ? [{ n: 1, label: '第 1 轮 · 当前' }] : PEF.ROUNDS; }

  function phases(s) {
    // 只点亮真实到达的阶段；“修订候选”只有发生时才出现
    const P = [['prep', '准备输入'], ['gen', '生成候选'], ['check', '检查计划'], ['rev', '修订候选'], ['rev2', '等待审阅']];
    const at = { pe05: 'prep', pe06: 'gen', pe07: 'gen', pe08: 'gen', pe13: 'gen', pe15: 'gen', pe16: 'gen', pe17: 'gen', pe18: 'gen', pe24: 'gen', b01: 'gen', pe09: 'check', pe26: 'check', pe10: 'rev' }[s];
    const endAt = { pe11: ['gen', 'need', '需要你答复'], pe12: ['rev', 'need', '已达上限'], pe19: ['gen', 'stop', '正在停止'], pe20: ['gen', 'stop', '已停止'], pe21: ['gen', 'unk', '结果待核对'], pe22: ['gen', 'stop', '失败'], pe23: ['gen', 'unk', '核对中'] }[s];
    const showRev = s === 'pe10' || s === 'pe12';
    const list = P.filter(([k]) => k !== 'rev' || showRev);
    const idx = (k) => list.findIndex((x) => x[0] === k);
    const out = [];
    list.forEach(([k, l], i) => {
      let cls = '', ic = String(i + 1);
      if (READY.includes(s) || ['pe30', 'pe31', 'pe32'].includes(s)) { cls = k === 'rev2' ? 'cur' : 'done'; }
      else if (endAt) { const e = idx(endAt[0]); if (i < e) cls = 'done'; else if (i === e) { cls = endAt[1] === 'unk' ? 'unk cur' : endAt[1] === 'stop' ? 'stop cur' : 'done'; if (endAt[1] !== 'need') l = l + ' · ' + endAt[2]; } if (endAt[1] === 'need' && k === 'rev2') { cls = 'cur'; l = endAt[2]; } }
      else if (at) { const a = idx(at); cls = i < a ? 'done' : i === a ? 'cur' : ''; }
      if (cls.includes('done')) ic = I('check'); if (cls.includes('stop')) ic = I('x'); if (cls.includes('unk')) ic = '?';
      out.push(`<span class="ph ${cls} ${k === 'rev' ? 'opt' : ''}" ${cls.includes('cur') ? 'aria-current="step"' : ''}><i>${ic}</i>${l}</span>`);
      if (i < list.length - 1) out.push(`<span class="arr">${I('chevRight')}</span>`);
    });
    return out.join('');
  }

  function cfg() { const c = cfg0(); if (ui.layer && c.layers && c.layers.includes(ui.layer)) c.layer = ui.layer; return c; }
  function cfg0() {
    const R = round();
    const c = { badge: null, strip: null, banners: [], acts: [], layer: 'skeleton', layers: null, tabs: ['input'], tab: 'input', cut: 0, rec: {}, foot: null, readonly: false, event: null };
    if (S === 'fx01') {
      c.layer = 'draft'; c.tabs = ['plan']; c.tab = 'plan'; c.badge = ['固定模板 · 计划待确认', 'st-wait', 'lock']; c.stage = [2, '固定模板 · 待确认', 'need', 'lock'];
      c.acts = [{ id: 'refine', label: 'AI 细化 / 修改步骤', kind: 'ghost', off: '该任务使用固定模板，创建后不能修改步骤；要改要求，请从“模板任务”新建。' }];
      c.banners.push({ k: 'info', i: 'lock', h: `<b>固定模板任务：${esc(T.tpl.name)} · 模板版本 ${T.tpl.rev}（实例创建时固定，origin=fixed-menu-template）。</b>步骤、依赖、职业、模型、验收与入口参数都不能修改；可以查看、调整布局、确认计划，再准备独立工作区与开始执行。` });
      return c;
    }
    if (isPW()) {
      c.layer = 'draft'; c.tabs = special() ? ['ws', 'plan'] : ['ws', 'plan', 'check', 'records']; c.tab = 'ws'; c.cut = 18; c.check = 'done'; c.strip = null; c.acts = [];
      c.badge = ['已确认 · 计划修订 ' + T.planRev, 'st-done', 'check'];
      c.banners.push({ k: 'ok', i: 'check', h: isFixed() ? `<b>固定模板计划已确认（${esc(T.tpl.ref)}@r${T.tpl.rev}）。</b>下一步在右侧“工作区”：准备独立工作区 → 成功后单独开始执行。步骤仍然锁定。` : isLegacy() ? `<b>计划修订 ${T.planRev} 已确认（旧版流程，${esc(T.confirmedAt || '14:21')}）。</b>确认没有调用模型，也没有开始执行。下一步在右侧“工作区”：准备独立工作区 → 成功后单独开始执行。` : `<b>计划修订 ${T.planRev} 已确认（${esc(T.confirmedAt || '14:21')}${isLarge() ? ' · 总览 + 3 轮分组细化' : ''}）。</b>确认没有调用模型，也没有开始执行。下一步在右侧“工作区”：准备独立工作区 → 成功后单独开始执行。` });
      return c;
    }
    const run = (o) => Object.assign({ started: '14:02:06', elapsed: '6 分 09 秒', last: '14:07:58 · 模型公开正文', reads: 7, draft: 5, known: '0.31 元（本代未结账）', reserved: '2.00 元', unknown: '无', disp: '1 / 2', rep: '0 / 1', deadline: '14:17:06', cls: '' }, o);
    if (EMPTY.includes(S)) {
      c.layer = ui.skeleton ? 'skeleton' : 'empty'; c.tabs = ['input']; c.tab = 'input';
      c.badge = ['需求草稿 · 尚未调用模型', 'st-idle', 'file'];
      const genLbl = ui.skeleton ? 'AI 细化计划' : '生成计划';
      if (S === 'b07') {
        c.acts = [{ id: 'skeleton', label: '使用方法骨架', kind: 'primary', off: ui.skeleton ? '已使用方法骨架' : null }, { id: 'generate', label: genLbl, kind: 'secondary', off: '该流程尚未配置 AI 规划；可使用骨架并手动调整' }];
        c.banners.push({ k: 'info', i: 'info', h: '<b>“文档整理 · r2”尚未配置 AI 规划。</b>可以使用方法骨架，再在画布上手动调整；不会回退为空图自由生成。' });
      } else if (S === 'pe04') {
        c.acts = [{ id: 'skeleton', label: '使用方法骨架', kind: 'secondary', off: ui.skeleton ? '已使用方法骨架' : null }, { id: 'generate', label: genLbl, kind: 'primary', off: '还缺 2 项：预算上限未设置；1 份资料无读取权限' }];
        c.banners.push({ k: 'warn', i: 'alert', h: '<b>暂不能生成计划。</b>规划预览发现 2 项缺失（详见右侧“需求与输入”）。草稿、补充与已选资料都已保留。', a: [['go-settings', '去设置预算'], ['pick-material', '重新选择资料']] });
      } else {
        c.acts = [{ id: 'skeleton', label: '使用方法骨架', kind: 'secondary', off: ui.skeleton ? '已使用方法骨架' : null }, { id: 'generate', label: genLbl, kind: 'primary' }];
      }
      if (S === 'b06') c.banners.push({ k: 'info', i: 'info', h: '已取消规划预览；补充草稿保留（未保存为新的输入修订）。' });
      if (S === 'pe03') c.dialog = 'preview';
      return c;
    }
    if (['b02', 'b03', 'b04'].includes(S)) {
      c.layer = 'skeleton'; c.tabs = ['records']; c.tab = 'records'; c.readonly = true;
      if (S === 'b02') { c.badge = ['读取失败', 'st-fail', 'alert']; c.banners.push({ k: 'danger', i: 'alert', h: '<b>规划记录读取失败（服务返回 503）。</b>这只是读取失败，不代表规划失败；重新读取不会调用模型。', a: [['reread', '重新读取']] }); c.rec.err = true; }
      if (S === 'b03') { c.badge = ['无权限查看规划记录', 'st-idle', 'lock']; c.banners.push({ k: 'warn', i: 'lock', h: '<b>当前账号无权查看本任务的规划正文与工具结果。</b>只显示可公开的任务信息；不会展示本机缓存的旧内容。' }); c.rec.perm = true; }
      if (S === 'b04') { c.badge = ['此版本不支持该规划轮次', 'st-unknown', 'help']; c.banners.push({ k: 'unknown', i: 'help', h: '<b>此版本不支持该规划轮次（planning-expansion.v1）。</b>只显示旧轮已知事实：第 1 轮“已请求停止”，停稳与结账待核对——不显示为“已停止”。请升级后查看完整记录；本版本不会写入任何规划数据。' }); c.rec.old = true; }
      return c;
    }
    if (LARGE_MODE()) {
      /* v5（Q10 · PE37 开放）：总览 → 选组继续规划（新一轮）→ 组候选审阅 → 应用 → 全部细化后才能确认 */
      const done = lgDone(), left = lgLeft(), gp = lgGp();
      c.layer = 'large'; c.round = S === 'pe37' ? (done.length ? done.length + 1 : 1) : lgRound();
      const capNote = `本期上限：节点 ≤ 20（细化完成后 18）、分组 ≤ 8、深度 ≤ 2`;
      if (S === 'lg-planning') {
        c.tabs = ['plan']; c.tab = 'plan';
        c.badge = [`规划中 · 分组“${lgName(gp)}”`, 'st-run', 'play'];
        c.stage = [1, `第 ${lgRound()} 轮 · 细化“${lgName(gp)}”`, 'run', 'play'];
        c.acts = [{ id: 'lg-stop', label: '停止规划', kind: 'secondary', icon: 'stop' }];
        c.strip = run({ started: '14:40:12', elapsed: '1 分 52 秒', last: '14:42:04 · 模型公开正文', reads: 6, draft: 0, known: '0.12 元（本代未结账）', rep: '0 / 1', deadline: '14:55:12',
          phasesHTML: '<span class="ph done"><i>' + I('check') + '</i>读取范围</span><span class="arr">' + I('chevRight') + '</span><span class="ph cur"><i>2</i>生成候选</span><span class="arr">' + I('chevRight') + '</span><span class="ph"><i>3</i>检查</span>' });
        c.banners.push({ k: 'info', i: 'layers', h: `<b>正在细化分组“${esc(lgName(gp))}”（第 ${lgRound()} 轮）。</b>只细化这一组；其他分组与当前草稿（计划修订 ${lgRev()}）不变。可以离开页面，规划不会停止。` });
        c.event = ['服务事件：本轮候选已生成并检查完成', () => PE.to('lg-cand', { gp, sim: null })];
        return c;
      }
      if (S === 'lg-cand') {
        c.tabs = ['plan', 'check']; c.tab = 'plan';
        c.badge = [`分组候选 · 等待审阅`, 'st-wait', 'eye'];
        c.stage = [1, `第 ${lgRound()} 轮 · “${lgName(gp)}”候选待审阅`, 'need', 'eye'];
        c.strip = run({ started: '14:40:12', elapsed: '4 分 31 秒（本轮已结束）', last: '14:44:43 · 检查完成', reads: 9, draft: PEF.LARGE.refine[gp].nodes.length, known: PEF.LARGE.refine[gp].cost + '（已结账）', reserved: '—', disp: '1 / 2', rep: '0 / 1',
          phasesHTML: '<span class="ph done"><i>' + I('check') + '</i>读取范围</span><span class="arr">' + I('chevRight') + '</span><span class="ph done"><i>' + I('check') + '</i>生成候选</span><span class="arr">' + I('chevRight') + '</span><span class="ph done"><i>' + I('check') + '</i>检查</span>' });
        c.banners.push({ k: 'info', i: 'eye', h: `<b>“${esc(lgName(gp))}”的候选已生成（第 ${lgRound()} 轮，${PEF.LARGE.refine[gp].nodes.length} 步）。</b>候选在画布上以“新增”标出，<b>当前草稿未改变</b>。应用后该组变为已细化；本轮还有 1 次修订机会。` });
        return c;
      }
      c.tabs = ['plan', 'check']; c.tab = 'plan';
      if (left.length) {
        c.badge = [`规划总览 · ${left.length} 组未细化`, 'st-unknown', 'layers'];
        c.stage = [1, `总览 · ${left.length} 组未细化`, 'need', 'layers'];
        c.strip = run({ cls: 'need', phasesHTML: '<span class="ph done"><i>' + I('check') + '</i>总览已生成</span><span class="arr">' + I('chevRight') + '</span><span class="ph cur"><i>2</i>选择范围继续细化 · ' + (3 - left.length) + ' / 3</span>', elapsed: done.length ? `第 ${c.round} 轮已结束` : '9 分 40 秒（第 1 轮已结束）', last: done.length ? `14:45:10 · “${lgName(done[done.length - 1])}”候选已应用（未确认）` : '14:31:20 · 总览候选已应用到草稿（未确认）', reads: 23, draft: PEF.LARGE.leafCount(done), known: (0.88 + done.reduce((x, g) => x + parseFloat(PEF.LARGE.refine[g].cost), 0)).toFixed(2) + ' 元（已结账）', unknown: '无', disp: '1 / 2', rep: '0 / 1' });
        c.banners.push({ k: 'info', i: 'layers', h: `<b>这是覆盖全部需求的规划总览，还不是可执行计划。</b>${left.map((g) => '“' + esc(lgName(g)) + '”').join('、')}尚未细化。请选择一个分组“继续规划选区”：每次是新的一轮，各有 1 次修订机会。<b>已细化的组不会先执行</b>，全部细化后才能确认计划。${capNote}。` });
      } else {
        c.badge = ['规划总览 · 已全部细化', 'st-wait', 'check'];
        c.stage = [2, `计划修订 ${lgRev()} · 未确认`, 'need', 'edit'];
        c.strip = null;
        c.banners.push({ k: 'ok', i: 'check', h: `<b>6 个分组已全部细化（共 ${PEF.LARGE.leafCount(done)} 步，计划修订 ${lgRev()}，未确认）。</b>现在可以确认整份计划；确认后在本页“工作区”准备独立工作区，再单独开始执行。` });
      }
      const ap = PE.ctx('applied'), rj = PE.ctx('rejected'), st = PE.ctx('stopped');
      if (ap && done.includes(ap)) c.banners.unshift({ k: 'ok', i: 'check', h: `已把第 ${2 + done.indexOf(ap)} 轮候选应用到草稿：“${esc(lgName(ap))}”已细化（新增 ${PEF.LARGE.refine[ap].nodes.length} 步，计划修订 ${1 + 2 + done.indexOf(ap)}，未确认）。` });
      if (rj && left.includes(rj)) c.banners.unshift({ k: 'info', i: 'info', h: `已不采用“${esc(lgName(rj))}”的候选；该组仍未细化，候选与记录保留在历史里。可以再次“继续规划选区”（新的一轮）。` });
      if (st && left.includes(st)) c.banners.unshift({ k: 'info', i: 'info', h: `已停止“${esc(lgName(st))}”的规划（原调用已停稳，用量已结账）。该组仍未细化。` });
      return c;
    }
    c.round = R;
    if (RUNNING.includes(S) || ['pe11', 'pe12'].includes(S) || STOPPED.includes(S) || S === 'pe30') {
      c.tabs = ['records', 'draft']; c.tab = 'records';
      c.layer = 'skeleton';
      c.badge = ['规划中 · 生成候选', 'st-run', 'play'];
      c.acts = [{ id: 'stop', label: '停止规划', kind: 'secondary', icon: 'stop' }];
      c.hint = '';
      c.strip = run({});
      c.cut = 13; c.stream = S === 'pe07' || S === 'pe18';
    }
    switch (S) {
      case 'b01': c.loading = true; c.badge = ['正在读取…', 'st-idle', 'clock']; c.acts = []; c.hint = ''; c.cut = 0; c.event = ['读取完成', () => PE.to('pe07')]; break;
      case 'pe05': c.badge = ['规划中 · 准备输入', 'st-run', 'play']; c.strip = run({ elapsed: '1 分 02 秒', last: '14:02:15 · 读取 db/schema（只读节选）· 运行中', reads: 4, draft: 0, known: '0.00 元（尚未派发模型）', disp: '0 / 2' }); c.cut = 5; c.rec.running = 5; c.event = ['生成候选：收到正文与工具记录', () => PE.to('pe07')]; break;
      case 'pe06': c.strip = run({ last: '14:07:10 · 读取 web/src/pages/…/List.vue' }); c.rec.noText = true; c.event = ['发布草稿检查点 #2', () => PE.to('pe08')]; break;
      case 'pe07': c.event = ['发布草稿检查点 #2', () => PE.to('pe08')]; break;
      case 'pe18': c.dialog = 'stop'; break;
      case 'pe08': c.layer = 'partial'; c.tab = 'draft'; c.strip = run({ last: '14:06:55 · 草稿检查点 #2 已保存', draft: 5 }); c.cut = 11; c.layers = ['skeleton', 'partial']; c.event = ['候选已提交 · 开始程序检查', () => PE.to('pe09')]; break;
      case 'pe09': c.badge = ['规划中 · 检查计划', 'st-run', 'play']; c.layer = 'cand'; c.layers = ['skeleton', 'cand', 'compare']; c.tabs = ['records', 'check']; c.tab = 'check'; c.cut = 15; c.strip = run({ elapsed: '6 分 18 秒', last: '14:08:24 · 程序检查 V3 进行中', draft: 8 }); c.check = 'running'; c.event = ['检查完成 · 候选就绪', () => PE.to('pe25')]; break;
      case 'pe10': c.badge = ['规划中 · 修订候选 1/1', 'st-run', 'play']; c.layer = 'cand'; c.layers = ['skeleton', 'cand', 'compare']; c.tabs = ['records', 'check']; c.tab = 'records'; c.cut = 15; c.rec.revise = true; c.strip = run({ elapsed: '7 分 26 秒', last: '14:09:31 · 第 2 次派发（修订）· 正文生成中', draft: 8, known: '0.46 元（第 1 次已结账）+ 本次未结账', disp: '2 / 2', rep: '1 / 1' }); c.check = 'repair';
        c.banners.push({ k: 'info', i: 'refresh', h: '<b>修订 1/1：</b>“前端筛选栏与导出按钮”缺少必需输入 <span class="mono">/api-contract</span>（IO_REQUIRED_UNBOUND，可自动修订）。这是本轮唯一一次修订；修订后仍不合格会停下来交给你。' }); c.event = ['修订候选通过检查', () => PE.to('pe25')]; break;
      case 'pe13': c.banners.push({ k: 'info', i: 'info', h: '<b>补充已保存为“需求输入修订 2”，未纳入本轮。</b>本轮仍按修订 1 生成：“导出单次最多 10,000 行”。', a: [['wait', '等本轮结果后再规划'], ['stop-replan', '停止本轮并按补充重新规划']] }); c.tab = 'draft'; ui.supp = ui.supp || '导出单次最多 10,000 行；超过时提示用户缩小筛选范围。'; c.rec.inputSaved = true; c.event = ['本轮候选就绪', () => PE.to('pe25')]; break;
      case 'pe15': c.cut = 9; c.rec.catching = true; c.banners.push({ k: 'info', i: 'refresh', h: `<b>已从${esc(fromLabel())}返回第 ${R} 轮。</b>正在按游标补读离开期间的记录（从 #10 起，共 9 条）——不会再次调用模型；画布视角与选中节点已恢复。` }); c.event = ['补读完成', () => PE.to('pe07')]; break;
      case 'pe16': c.badge = ['连接已断开 · 规划状态以服务为准', 'st-unknown', 'help']; c.strip.cls = 'unk'; c.banners.push({ k: 'unknown', i: 'link', h: '<b>本页与服务的数据连接已断开，正在重连（第 2 次，14:08:40）。</b>这不代表规划失败：最后已知服务状态“生成候选”，最近活动 14:07:58。已读内容保留，不会自动重发任何请求。', a: [['reconnect', '立即重连']] }); c.acts = [{ id: 'stop', label: '停止规划', kind: 'secondary', icon: 'stop', off: '连接恢复后可用（需要服务回执）' }]; c.event = ['连接恢复 · 开始补读', () => PE.to('pe15')]; break;
      case 'pe17': c.rec.gap = true; c.banners.push({ k: 'unknown', i: 'help', h: '<b>有 1 段记录无法补读（#6–#9）。</b>服务说明：该段公开记录超出保留期已清理。前后已读内容不受影响；规划本身仍在运行。' }); break;
      case 'pe26': c.badge = ['候选已收到 · 核对本轮结束', 'st-unknown', 'help']; c.layer = 'cand'; c.layers = ['skeleton', 'cand', 'compare']; c.tabs = ['plan', 'check', 'records']; c.tab = 'plan'; c.cut = 15; c.rec.unsettled = true; c.check = 'done'; c.strip = run({ cls: 'unk', elapsed: '6 分 58 秒', last: '14:09:05 · 程序检查完成；原调用尚未停稳', draft: 8 });
        c.banners.push({ k: 'unknown', i: 'help', h: '<b>候选已收到，正在核对本轮结束。</b>原调用尚未停稳、用量尚未结账；可以先只读审阅候选，暂不能应用。' }); c.applyOff = '正在核对本轮结束（原调用未停稳 / 未结账）'; c.event = ['原调用停稳 · 结账完成', () => PE.to('pe25')]; break;
      case 'pe24': c.badge = ['原轮仍在运行 · 仅观察', 'st-run', 'eye']; c.strip = run({ elapsed: '8 分 12 秒（含重启前）', last: '14:09:58 · 原进程心跳', known: '0.31 元（未结账）' }); c.banners.push({ k: 'ok', i: 'check', h: '<b>核对完成：第 2 轮的原进程仍在运行（owner 与会话未变）。</b>正在继续查看原轮次——不会发送新的提示，也不会重新计时。若核对结果是“不能续接”，这里会改为“从保留草稿开始新轮次”（新调用，需重新预览）。' }); c.event = ['原轮发布候选', () => PE.to('pe26')]; break;
      case 'pe11': c.badge = ['需要你答复 2 个问题', 'st-wait', 'help']; c.layer = 'partial'; c.layers = ['skeleton', 'partial']; c.tabs = ['draft', 'records']; c.tab = 'draft'; c.cut = 13; c.rec.needs = true; c.acts = [{ id: 'new-round', label: '预览新一轮', kind: 'primary', off: ui.ansSaved ? null : '先明确回答 2 个业务问题并保存，形成新的输入修订' }]; c.hint = '';
        c.strip = run({ cls: 'need', elapsed: '7 分 02 秒（本轮已结束）', last: '14:09:08 · 停在“需要你答复”', known: '0.46 元（已结账）', reserved: '0.00 元', disp: '1 / 2' }); break;
      case 'pe12': c.badge = ['已达本轮上限 · 等你决定', 'st-wait', 'alert']; c.layer = 'partial'; c.layers = ['skeleton', 'partial']; c.tabs = ['draft', 'records']; c.tab = 'draft'; c.cut = 17; c.rec.limit = true; c.hint = '';
        c.acts = [{ id: 'edit-input', label: '编辑输入', kind: 'secondary' }, { id: 'new-round', label: '预览新一轮', kind: 'primary' }];
        c.strip = run({ cls: 'need', elapsed: '12 分 40 秒（本轮已结束）', last: '14:14:46 · 修订 1/1 后同一问题仍存在', known: '1.62 元（已结账）', reserved: '0.00 元', disp: '2 / 2', rep: '1 / 1' });
        c.banners.push({ k: 'warn', i: 'alert', h: '<b>本轮已达修订上限（1/1），同一问题仍存在：</b>“导出 CSV 接口”的输入与“后端筛选查询”的输出类型不匹配。已保留检查点 #2、两次候选与全部记录；原账已结清（已知 1.62 元，未明 无）。不会自动加预算或再修订。' }); break;
      case 'pe19': c.badge = ['正在停止', 'st-wait', 'stop']; c.layer = 'partial'; c.layers = ['skeleton', 'partial']; c.cut = 13; c.rec.stopReq = true; c.hint = ''; c.acts = [{ id: 'stop', label: '正在停止…', kind: 'secondary', off: '停止请求已受理，等待原进程停稳与结账' }, { id: 'new-round', label: '预览新一轮', kind: 'secondary', off: '停止完成前不能开始新一轮' }];
        c.strip = run({ cls: 'unk', last: '14:08:44 · 已受理停止请求（回执 rk-7f3a）' });
        c.banners.push({ k: 'unknown', i: 'clock', h: '<b>已请求停止第 ' + R + ' 轮（回执 rk-7f3a · 14:08:44）。</b>停止请求：已受理 · 原进程：等待停稳 · 用量：未结账。期间可以查看记录与草稿；不能应用或开始新一轮。只停止规划，不影响任何业务步骤。' }); c.event = ['原进程停稳 · 结账完成', () => PE.to('pe20')]; break;
      case 'pe20': c.badge = ['已停止', 'st-idle', 'stop']; c.layer = 'partial'; c.layers = ['skeleton', 'partial']; c.cut = 13; c.rec.stopped = true; c.hint = ''; c.acts = [{ id: 'new-round', label: '从保留草稿预览新一轮', kind: 'primary' }];
        c.strip = run({ cls: '', elapsed: '6 分 56 秒（已停止）', last: '14:09:02 · 原进程停稳；用量已结账', known: '0.31 元（已结账）', reserved: '0.00 元' });
        c.banners.push({ k: 'ok', i: 'check', h: '<b>第 ' + R + ' 轮已停止。</b>原进程 14:09:02 停稳；用量已结账，已知 0.31 元。检查点 #2 与 13 条记录已保留。迟到的提交只会记入审计，不会恢复候选。' }); break;
      case 'pe21': c.badge = ['停止结果待核对', 'st-unknown', 'help']; c.layer = 'partial'; c.layers = ['skeleton', 'partial']; c.cut = 13; c.rec.unknown = true; c.hint = ''; c.acts = [{ id: 'reconcile', label: '核对原轮次', kind: 'primary' }, { id: 'new-round', label: '预览新一轮', kind: 'secondary', off: '原轮停止结果与用量不明，先核对原轮次' }];
        c.strip = run({ cls: 'unk', elapsed: '—（以服务核对为准）', last: '14:08:44 · 停止请求已发出，回执未收到', known: '0.31 元', unknown: '有（本代可能仍在计费）' });
        c.banners.push({ k: 'unknown', i: 'help', h: '<b>停止结果待核对：</b>停止请求 <span class="mono">rk-7f3a</span> 的回执未收到，原进程与用量状态不明。“核对原轮次”只按原请求号查询，不会重新生成，也不会换新请求号重发。' }); break;
      case 'pe22': c.badge = ['规划失败 · 生成候选', 'st-fail', 'x']; c.layer = 'partial'; c.layers = ['skeleton', 'partial']; c.cut = 13; c.rec.failed = true; c.hint = ''; c.acts = [{ id: 'edit-input', label: '编辑输入', kind: 'secondary' }, { id: 'new-round', label: '从保留草稿预览新一轮', kind: 'primary' }];
        c.strip = run({ cls: 'fail', elapsed: '6 分 31 秒（已结束）', last: '14:08:37 · 模型服务返回错误', known: '0.29 元（已结账）', reserved: '0.00 元' });
        c.banners.push({ k: 'danger', i: 'alert', h: '<b>第 ' + R + ' 轮在“生成候选”失败：</b>模型服务返回“请求内容超出模型上限”（公开错误码 context_length_exceeded）。已保留：检查点 #2、13 条记录、原账（已知 0.29 元，已结账）。不会自动重试；可缩小资料范围后预览新一轮。' }); break;
      case 'pe23': c.badge = ['服务重启 · 核对中', 'st-unknown', 'refresh']; c.layer = 'partial'; c.layers = ['skeleton', 'partial']; c.cut = 13; c.rec.reconciling = true; c.hint = ''; c.acts = [{ id: 'stop', label: '停止规划', kind: 'secondary', off: '核对完成前只读' }];
        c.strip = run({ cls: 'unk', elapsed: '—（不因重启重新计时）', last: '14:06:12 · 服务重启；正在核对原轮次', known: '0.31 元', unknown: '核对中' });
        c.banners.push({ k: 'unknown', i: 'refresh', h: '<b>服务在 14:06:12 重启，正在核对第 ' + R + ' 轮。</b>逐项核对原派发意图、进程 owner、会话、租约与用量；核对完成前只读，不会自动派发或“自动恢复”。' }); c.event = ['核对完成：原轮仍在运行', () => PE.to('pe24')]; break;
      case 'pe30': c.badge = ['历史轮次 · 只读', 'st-wait', 'clock']; c.layer = 'partial'; c.readonly = true; c.hist = true; c.cut = 9; c.acts = []; c.hint = ''; c.rec.hist = true;
        c.strip = run({ cls: '', phasesHTML: '<span class="ph done"><i>' + I('check') + '</i>准备输入</span><span class="arr">' + I('chevRight') + '</span><span class="ph stop cur"><i>' + I('x') + '</i>生成候选 · 已停止</span>', elapsed: '3 分 20 秒（第 1 轮）', last: '13:51:30 · 用户停止（补充需求后）', reads: 6, draft: 2, known: '0.18 元（已结账）', reserved: '0.00 元', disp: '1 / 2', started: '13:48:10' });
        c.banners.push({ k: 'info', i: 'clock', h: '<b>历史轮次 · 只读 · 第 1 轮（已停止）。</b>显示当时的输入（需求输入修订 1）、检查点 #1、记录与原账；没有应用或执行动作。', a: [['back-current', '回到当前']] }); break;
    }
    if (READY.includes(S)) {
      c.layer = 'compare'; c.layers = ['skeleton', 'cand', 'compare']; c.tabs = ['plan', 'check', 'records']; c.tab = 'plan'; c.cut = 18; c.check = 'done';
      c.badge = ['候选待审阅 · 第 ' + R + ' 轮', 'st-review', 'eye'];
      if (R === 1 && !['pe27', 'pe29'].includes(S)) { if (!ui.ansSaved) c.badge = ['候选待审阅 · 2 个业务问题待回答', 'st-wait', 'help']; else if (ui.reval === 'stale') c.badge = ['答复与候选不一致 · 需新一轮', 'st-unknown', 'help']; }
      c.strip = run({ cls: 'ok', elapsed: '7 分 00 秒（本轮已结束）', last: '14:09:05 · 候选已发布，等待审阅', draft: 8, known: '0.46 元（已结账）', reserved: '0.00 元（余额已释放）', disp: '1 / 2', rep: '0 / 1' });
      c.acts = [{ id: 'refine', label: 'AI 细化计划', kind: 'ghost', off: '已有候选待审阅：先应用或不采用' }];
      if (S === 'pe27') { c.badge = ['候选有 4 个必须处理的问题', 'st-fail', 'alert']; c.check = 'block'; c.applyOff = '有 4 个必须处理的问题；这些规则不能忽略'; c.banners.push({ k: 'danger', i: 'alert', h: '<b>候选有 4 个必须处理的问题：</b>循环依赖、必需输入未绑定、引用的行号不存在、写入超出授权。这些是硬规则，不能“忽略继续”。可以补充输入后预览新一轮，或不采用此候选。', a: [['edit-input', '补充输入后新一轮']] }); c.tab = 'check'; }
      if (S === 'pe28') { c.check = ui.serial ? 'done' : 'conflict'; c.badge = ui.serial ? ['候选待审阅 · 已改为先后执行', 'st-review', 'eye'] : ['并行写冲突 · 需处理', 'st-fail', 'alert']; c.applyOff = ui.serial ? null : '有 1 个资源冲突需要处理'; c.tab = 'check'; c.banners.push({ k: 'warn', i: 'alert', later: true, h: ui.serial ? '<b>已采纳“先后执行”：</b>形成新差异（新增资源依赖 导出 CSV 接口 → 前端筛选栏与导出按钮），已按整图重新检查。' : '<b>两个互不依赖的步骤会写同一文件：</b><span class="mono">web/src/api/' + esc(T.pkg) + '.ts</span>。MVP 只能改为先后执行；子隔离与汇合尚未安装。程序不会静默加边。' }); }
      if (S === 'pe29' && PE.ctx('chg') === '1') { c.check = 'stale'; c.badge = ['答复已修改 · 候选已过期', 'st-unknown', 'help']; c.applyOff = '候选基于需求输入修订 2，你的新答复形成了修订 3'; c.banners.push({ k: 'warn', i: 'alert', h: '<b>你修改了业务答复，形成需求输入修订 3。</b>第 2 轮候选基于修订 2（日期按创建时间、导出最多 10,000 行），已过期，不能应用；修订 2 与第 2 轮记录保留不变，不回写旧轮。请按修订 3 预览新一轮。', a: [['repreview', '按输入修订 3 预览新一轮']] }); c.layers = ['skeleton', 'cand', 'compare']; }
      else if (S === 'pe29') { c.check = 'stale'; c.badge = ['候选已过期 · 需重新预览', 'st-unknown', 'help']; c.applyOff = '候选基于旧输入与旧计划，已过期'; c.banners.push({ k: 'warn', i: 'alert', h: '<b>候选已过期：</b>它基于需求输入修订 1 / 计划修订 2；现在是输入修订 2（你补充了“导出上限”）/ 计划修订 3（你手动改了“测试”）；<span class="mono">docs/api/' + esc(T.pkg) + '.md</span> 内容也已变化。旧候选保留可比较，不能覆盖当前草稿。', a: [['repreview', '按当前输入重新预览']] }); c.layers = ['skeleton', 'cand', 'compare']; }
      if (S === 'b05') { c.badge = ['应用结果待核对', 'st-unknown', 'help']; c.applyOff = '应用请求 rk-a2c4 结果未知，先按原请求号核对'; c.banners.push({ k: 'unknown', i: 'help', h: '<b>应用结果待核对：</b>“应用到草稿”请求 <span class="mono">rk-a2c4</span> 已发出，响应丢失。按钮已锁定防止重复提交；只按原请求号核对，不生成新请求。', a: [['by-key', '按原请求号核对']] }); }
      if (S === 'pe25' && R === 1) c.banners.push({ k: 'info', i: 'info', h: '本轮从<b>空草稿 → 方法骨架</b>开始；候选只在候选层显示，<b>当前草稿（方法骨架）未改变</b>。应用后仍需确认计划。' });
      if (ui.dismissed) { c.layer = 'skeleton'; c.layers = null; c.badge = ['当前草稿 · 候选未采用', 'st-idle', 'file']; c.banners = [{ k: 'info', i: 'info', h: '<b>已不采用第 ' + R + ' 轮候选。</b>候选与记录保留在历史里；当前草稿（计划修订 2）没有改变。' }]; c.acts = [{ id: 'refine', label: 'AI 细化计划', kind: 'primary' }]; c.tabs = ['records']; c.tab = 'records'; c.dismissedView = true; }
    }
    if (S === 'pe31' && isLegacy()) { c.layer = 'draft'; c.tabs = ['plan']; c.tab = 'plan'; c.check = 'done'; c.badge = ['草稿 · 计划修订 ' + T.planRev + ' · 未确认', 'st-wait', 'edit']; c.strip = null; c.acts = [{ id: 'refine-legacy', label: 'AI 细化计划', kind: 'ghost' }]; c.stage = [2, '计划修订 ' + T.planRev + ' · 未确认', 'need', 'edit'];
      c.banners.push({ k: 'info', i: 'info', h: `<b>旧版流程生成的计划草稿（计划修订 ${T.planRev}，未确认）。</b>需求“${esc(T.title)}”从旧需求目录迁入新版需求画布，身份不变；没有 AI 规划轮次。可以确认计划，确认后在本页准备工作区。` }); }
    else if (S === 'pe31') { c.layer = 'draft'; c.tabs = ['plan', 'check', 'records']; c.tab = 'plan'; c.cut = 18; c.check = 'done'; c.badge = ['草稿 · 计划修订 3 · 未确认', 'st-wait', 'edit']; c.strip = null; c.acts = [{ id: 'refine', label: 'AI 细化计划', kind: 'ghost' }];
      c.banners.push({ k: 'ok', i: 'check', h: '<b>已把第 ' + R + ' 轮候选应用到草稿（计划修订 2 → 3，未确认）。</b>新增 5 步、修改 2 步、细化替换 2 步。可以继续手改；确认后才能准备执行。' }); }
    if (S === 'b08') { c.layer = 'draft'; c.tabs = special() ? ['plan'] : ['plan', 'records']; c.tab = 'plan'; c.cut = 18; c.check = 'done'; c.strip = null; c.acts = []; c.readonly = true; c.exec = true;
      c.stage = [4, '执行中 · ' + (isFixed() ? '固定模板' : '计划修订 ' + T.planRev), 'run', 'play'];
      c.banners.push({ k: 'info', i: 'play', h: '<b>执行已开始（' + (isFixed() ? '固定模板 ' + esc(T.tpl.ref) + '@r' + T.tpl.rev : '计划修订 ' + T.planRev) + '）。</b>规划面板只读；需求追踪表增加“执行结果 / 证据”。工作包、尝试与产出归执行侧：在任务画布与节点详情查看。', a: [['open-task', '打开任务画布']] }); }
    return c;
  }
  function fromLabel() { const f = PE.ctx('from'); return ({ tasks: '任务列表', requirements: '需求目录', inbox: '待处理中心', home: '主页' })[f] || '任务列表'; }

  /* ================= 画布图层 ================= */
  function graph(c) {
    if (c.layer === 'large') { const g = PEF.LARGE.graph(lgDone(), S === 'lg-cand' ? lgGp() : null, S === 'lg-planning' ? lgGp() : null); g.groups.forEach((x) => { x.collapsed = ui.collapsed[x.id] ?? x.collapsed; }); return g; }
    if (c.layer === 'empty') return { nodes: [], edges: [], groups: [] };
    if (special()) return specialGraph(c);
    if (c.layer === 'skeleton') return { nodes: PEF.SKELETON.nodes, edges: PEF.SKELETON.edges, groups: [] };
    const groups = PEF.GROUPS.map((g) => Object.assign({}, g, { collapsed: !!ui.collapsed[g.id] }));
    if (c.layer === 'partial') { const p = PEF.partial(T); if (c.hist) { p.nodes = p.nodes.filter((n) => ['start', 'n1', 'n2'].includes(n.id)).concat([{ id: 'gapH', title: '实现 · 测试 · 验收', gap: true, group: 'g2', meta: '第 1 轮停止时只到检查点 #1' }]); p.edges = [['start', 'n1'], ['n1', 'n2'], ['n2', 'gapH']].map(([from, to]) => ({ from, to })); } return Object.assign(p, { groups }); }
    const g = PEF.candidate(T);
    let nodes = g.nodes.map((n) => Object.assign({}, n)), edges = g.edges.map((e) => Object.assign({}, e));
    if (c.layer === 'cand' || c.layer === 'draft') nodes.forEach((n) => { n.diff = null; });
    if (S === 'pe27') {
      edges.push({ from: 'n6', to: 'n4', kind: 'bad', label: '循环：接口测试 → 导出 CSV 接口' });
      nodes.forEach((n) => { if (['n3', 'n4', 'n5', 'n6'].includes(n.id)) n.flag = 'block'; });
    }
    if (S === 'pe28') { nodes.forEach((n) => { if (['n4', 'n5'].includes(n.id) && !ui.serial) n.flag = 'warn'; }); if (ui.serial) edges.push({ from: 'n4', to: 'n5', kind: 'resource', label: '资源：先后执行' }); }
    if (isPW()) nodes.forEach((n) => { if (!n.system) n.badge = ['已确认', 'st-done', 'check']; });
    return { nodes, edges, groups };
  }
  /* v4：旧需求 / 固定模板的计划图（不经过 AI 规划；固定模板全部锁定） */
  function specialGraph(c) {
    const confirmed = isPW();
    if (isFixed()) {
      const st = T.tpl.steps.map(([title, role, output], i) => ({ id: 'n' + (i + 1), title, role, meta: output, lock: true, badge: confirmed ? ['已确认 · 固定', 'st-done', 'lock'] : ['固定 · 只读', 'st-idle', 'lock'] }));
      const nodes = [{ id: 'start', title: '开始', system: true }].concat(st, [{ id: 'end', title: '交付', system: true }]);
      const edges = []; for (let i = 0; i < nodes.length - 1; i++) edges.push({ from: nodes[i].id, to: nodes[i + 1].id });
      return { nodes, edges, groups: [] };
    }
    const nodes = [{ id: 'start', title: '开始', system: true }].concat(T.steps.map((x) => ({ id: x.id, title: x.title, role: x.role, meta: x.output, group: x.group, badge: confirmed ? ['已确认', 'st-done', 'check'] : null })), [{ id: 'end', title: '交付', system: true }]);
    const groups = isLarge() ? PEF.LARGE.groups.map((g) => Object.assign({}, g, { tone: null, badge: ['已细化', 'st-done'], meta: `${T.steps.filter((x) => x.group === g.id).length} 步`, collapsed: !!ui.collapsed[g.id] })) : [];
    return { nodes, edges: T.edges.map(([from, to]) => ({ from, to })), groups };
  }
  let CV = null;
  /* b08：执行侧事实随任务画布进入时的执行时刻（at=first 刚开始；默认为执行中段） */
  const EXEC = PE.ctx('at') === 'first' ? { n1: 'run' } : { n1: 'done', n2: 'done', n3: 'done', n4: 'run', n5: 'idle', n6: 'idle', n7: 'idle', n8: 'idle' };
  function renderCanvas(c) {
    const host = $('#cv');
    const g = graph(c);
    const over = [];
    const tag = special() && c.layer === 'draft' ? { draft: ['', I(isFixed() ? 'lock' : S === 'b08' ? 'play' : 'edit') + (isFixed() ? `固定模板 · ${esc(T.tpl.name)} r${T.tpl.rev} · 创建后不能修改步骤` : S === 'b08' ? `执行中 · 已确认计划修订 ${T.planRev}（只读）` : isPW() ? `已确认计划 · 修订 ${T.planRev}${isLarge() ? '（总览 + 3 轮分组细化）' : '（旧版流程）'}` : `计划草稿 · 修订 ${T.planRev}（旧版流程 · 未确认）`)] }.draft : { empty: null, skeleton: ['', I('file') + (ui.skeleton || !EMPTY.includes(S) ? '当前草稿 · 计划修订 2（方法骨架 · 未确认）' : '')], partial: ['partial', I('layers') + (c.hist ? '第 1 轮 · 检查点 #1（历史，只读）' : '部分草稿 · 检查点 #2 · 尚未完成，不能执行')], cand: ['cand', I('sparkle') + '候选 · 第 ' + round() + ' 轮 · 未应用（只读）'], compare: ['cand', I('split') + '对照：候选相对当前草稿（计划修订 2）'], draft: ['', I(S === 'b08' ? 'play' : 'edit') + (S === 'b08' ? '执行中 · 已确认计划修订 3（只读）' : isPW() ? '已确认计划 · 修订 3' : '当前草稿 · 计划修订 3（未确认）')], large: S === 'lg-cand' ? ['cand', I('sparkle') + `候选 · 第 ${lgRound()} 轮 · “${esc(lgName(lgGp()))}” · 未应用（只读）`] : S === 'lg-planning' ? ['partial', I('layers') + `规划中 · “${esc(lgName(lgGp()))}”（第 ${lgRound()} 轮）· 其他分组不变`] : lgLeft().length ? ['partial', I('layers') + `规划总览 · ${lgLeft().length} 组未细化 · 不能确认执行`] : ['', I('edit') + `当前草稿 · 计划修订 ${lgRev()}（已全部细化 · 未确认）`] }[c.layer];
    if (tag && tag[1]) over.push(`<div class="cv-overlay layer-tag ${tag[0]}" role="status">${tag[1]}</div>`);
    if (c.layers) over.push(`<div class="cv-overlay seg layer-seg" role="group" aria-label="画布图层">${c.layers.map((l) => `<button data-layer="${l}" aria-pressed="${l === c.layer}">${{ skeleton: '当前草稿', partial: '部分草稿', cand: '候选', compare: '对照' }[l]}</button>`).join('')}</div>`);
    if (c.layer === 'compare') over.push(`<div class="cv-overlay diff-legend" aria-label="差异图例"><span><i class="sw add"></i>新增</span><span><i class="sw mod"></i>修改</span><span><i class="sw repl"></i>由细化替换（见右侧）</span><span><i class="sw"></i>未变</span></div>`);
    if (c.layer === 'empty') over.push(`<div class="cv-overlay cv-center"><div class="empty"><div class="tile">${I('flow', 'lg')}</div><h3>还没有计划</h3><p>可以“生成计划”：先看一次规划预览（模型、次数、预算与时限），确认后才调用模型。也可以“使用方法骨架”，只复制“${esc(T.method)}”的必经步骤，不调用模型。</p></div></div>`);
    if (c.loading) over.push(`<div class="cv-overlay cv-center"><div class="empty"><div class="skel" style="width:220px;height:14px"></div><div class="skel" style="width:300px;height:14px"></div><div class="skel" style="width:180px;height:14px"></div><p class="muted">正在读取计划与规划记录…</p></div></div>`);
    if (!CV) {
      CV = PECanvas(host, { nodes: g.nodes, edges: g.edges, groups: g.groups, selected: ui.sel, view, statusOf: (id) => S === 'b08' ? (EXEC[id] || (id === 'start' || id === 'end' ? null : 'idle')) : null,
        onSelect: (id) => { ui.sel = id && !id.startsWith('grp:') && !['start', 'end'].includes(id) ? id : null; PE.setCtx({ sel: ui.sel }); if (ui.sel) { const c2 = cfg(); const t = c2.tabs.includes('plan') ? 'plan' : c2.tabs.includes('draft') ? 'draft' : c2.tabs[0]; ui.tab = t; PE.setCtx({ tab: t }); } renderSide(cfg()); },
        onToggleGroup: (gid) => { ui.collapsed[gid] = !(isCollapsed(gid)); const c2 = cfg(); const g2 = graph(c2); CV.set({ nodes: g2.nodes, edges: g2.edges, groups: g2.groups }); },
        onView: debounce((v) => PE.setCtx({ view: JSON.stringify(v) }), 300) });
    } else { CV.set({ nodes: g.nodes, edges: g.edges, groups: g.groups }); }
    host.querySelectorAll('.cv-overlay').forEach((e) => e.remove());
    host.insertAdjacentHTML('beforeend', over.join(''));
    if (ui.sideCollapsed) { host.insertAdjacentHTML('beforeend', `<button class="cv-overlay btn secondary sm" id="sideOpen" style="right:14px;top:14px">${I('chevLeft', 'sm')}展开规划面板</button>`); $('#sideOpen').addEventListener('click', () => { ui.sideCollapsed = false; renderSide(cfg()); renderCanvas(cfg()); $('#sideClose')?.focus(); }); }
    host.querySelectorAll('[data-layer]').forEach((b) => b.addEventListener('click', () => { ui.layer = b.dataset.layer; PE.setCtx({ layer: ui.layer }); render(true); }));
  }
  function isCollapsed(gid) { if (LARGE_MODE()) { const g = PEF.LARGE.groups.find((x) => x.id === gid); return ui.collapsed[gid] ?? !!g?.collapsed; } return !!ui.collapsed[gid]; }

  /* 进入合集新版节点详情（整合后由 showcase/navigation.js 提供 SC）；返回时恢复选中步骤与画布视角 */
  function openNode(id, tab, title, status) {
    if (window.SC && SC.go && SC.originalRoot) {
      const u = new URL(location.href); u.searchParams.set('sel', id); try { u.searchParams.set('view', JSON.stringify(CV.view())); } catch (e) {}
      const entry = tab === 'attempts' ? 'n17-history' : status === 'run' ? 'n03-stream' : 'n11-done';
      SC.go('node/index.html?state=' + entry, { stream: 'paused', nodeId: id, nodeTitle: title, taskTitle: T.title, returnTo: u.href.slice(SC.originalRoot.href.length) });
    } else DS.toast('整合后进入合集节点详情 node/index.html；返回时恢复画布视角与选中步骤', 'info');
  }
  function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

  /* ================= 页头与状态条 ================= */
  function btn(a, i) {
    const id = 'act-' + a.id + '-' + i;
    if (a.off) return `<span class="dis-wrap"><button class="btn ${a.kind}" data-act="${a.id}" aria-disabled="true" aria-describedby="${id}-r">${a.icon ? I(a.icon) : ''}${esc(a.label)}</button><span class="dis-reason" id="${id}-r">${esc(a.off)}</span></span>`;
    return `<button class="btn ${a.kind}" data-act="${a.id}" ${a.id === 'stop' ? 'title="离开页面不会停止规划；停止只影响这一轮规划"' : ''} ${ui.busy === a.id ? 'aria-busy="true"' : ''}>${ui.busy === a.id ? '<span class="spin"></span>' : a.icon ? I(a.icon) : ''}${esc(ui.busy === a.id ? '请求中…' : a.label)}</button>`;
  }
  function renderBar(c) {
    const back = PE.ctx('returnTo') || 'tasks.html';
    const backLbl = { 'tasks.html': '任务列表', 'requirements.html': '需求目录', 'inbox.html': '待处理中心', 'home.html': '主页', 'start.html': '开始任务', 'templates.html': '模板任务', 'task.html': '任务画布' }[back.split('?')[0].split('/').pop()] || '任务列表';
    const title = LARGE_MODE() ? PEF.LARGE.title : T.title, tid = LARGE_MODE() ? PEF.LARGE.id : T.id, proj = LARGE_MODE() ? PEF.LARGE.project : T.project;
    $('#bar').innerHTML = `<nav class="crumbs" aria-label="位置"><a href="${PEN.url(back.split('?')[0], Object.assign(Object.fromEntries(new URLSearchParams(back.split('?')[1] || '')), {}))}">${backLbl}</a><span class="sep">/</span></nav>
      <h1 class="task-title" title="${esc(title)}">${esc(title)}</h1>
      <div class="pe-chips"><span class="chip">${I('folder', 'sm')}${esc(proj)} · ${esc(tid)}</span></div>
      ${capsule(c)}
      <div class="acts">${c.hint ? `<span class="why">${esc(c.hint)}</span>` : ''}${c.acts.map(btn).join('')}</div>`;
    const s = c.strip;
    if (!s) { $('#strip').innerHTML = ''; return; }
    $('#strip').innerHTML = `<div class="pe-strip ${s.cls}" role="group" aria-label="规划状态">
      <span class="kv1 rnd"><b>第 ${c.round || 1} 轮</b><span class="k">${esc(LARGE_MODE() ? PEF.LARGE.method : T.method)}</span></span><span class="sep"></span>
      <div class="track" aria-label="规划段内实际到达的阶段">${s.phasesHTML || phases(S)}</div><span class="sep"></span>
      <span class="kv1"><span class="k">开始</span><span class="num">${s.started}</span></span>
      <span class="kv1"><span class="k">已用</span><span class="num">${s.elapsed}</span></span>
      <span class="kv1 opt"><span class="k">资料</span><span class="num">${s.reads}</span></span>
      <span class="kv1 opt"><span class="k">草稿节点</span><span class="num">${s.draft}</span></span>
      <span class="last" title="${esc(s.last)}"><span class="muted">最近活动 </span>${esc(s.last)}</span>
      <button class="budget-btn" id="budgetBtn" aria-expanded="false" aria-controls="budgetPop">${I('chart', 'sm')}用量 · 派发 ${s.disp}${I('chevDown', 'sm')}</button></div>`;
    $('#budgetBtn').addEventListener('click', (e) => toggleBudget(e.currentTarget, s));
  }
  /* 任务总阶段胶囊（五段，与最新 TD 一致）：取代页头状态徽标；当前段写子状态。状态条只作“规划”段的展开。 */
  const STAGES = ['需求草稿', '规划', '确认计划', '准备工作区', '开始执行'];
  const TONE = { 'st-run': 'run', 'st-wait': 'need', 'st-fail': 'fail', 'st-unknown': 'unk', 'st-review': 'review', 'st-done': 'ok', 'st-idle': 'idle' };
  function stageOf(c) {
    if (c.stage) return c.stage;
    const b = c.badge || ['', 'st-idle', 'clock'];
    let idx = 1, sub = b[0].replace(/^规划中 · /, '');
    if (EMPTY.includes(S) && !ui.dismissed) { idx = 0; sub = ui.skeleton ? '方法骨架 · 未调用模型' : '尚未调用模型'; }
    if (S === 'pe31') { idx = 2; sub = '计划修订 3 · 未确认'; }
    if (isPW() && prep()) return prep().stage();
    return [idx, sub, TONE[b[1]] || 'idle', b[2]];
  }
  function capsule(c) {
    const [idx, sub, tone, ic] = stageOf(c);
    return `<ol class="stages pe-stages" aria-label="任务阶段">${STAGES.map((l, i) => `<li class="stage ${i < idx ? 'done' : i === idx ? 'cur tone-' + tone : ''}" title="${l}${i < idx ? '（已完成）' : i > idx ? '（未到）' : ''}"${i === idx ? ' aria-current="step"' : ''}><i>${i < idx ? I('check') : i === idx && ['fail', 'unk', 'need'].includes(tone) ? I(ic) : i + 1}</i><span class="lb">${l}</span>${i === idx && sub ? `<span class="sb">${esc(sub)}</span>` : ''}${i < idx ? '<span class="sr">（已完成）</span>' : ''}</li>`).join('')}</ol>`;
  }
  function toggleBudget(b, s) {
    let p = $('#budgetPop'); if (p) { p.remove(); b.setAttribute('aria-expanded', 'false'); return; }
    document.body.insertAdjacentHTML('beforeend', `<div class="budget-pop" id="budgetPop" role="dialog" aria-label="本轮用量"><dl class="kv"><dt>资料 / 草稿</dt><dd>已读 ${esc(String(s.reads))} 份 · 草稿节点 ${esc(String(s.draft))}</dd><dt>已知</dt><dd>${esc(s.known)}</dd><dt>已预留</dt><dd>${esc(s.reserved)}</dd><dt>未明</dt><dd>${esc(s.unknown)}</dd><dt>模型派发</dt><dd>${esc(s.disp)}（初稿 1 + 修订 ${esc(s.rep.split('/')[1].trim())}）· 自动传输重试 0</dd><dt>修订</dt><dd>${esc(s.rep)}</dd><dt>本轮时限</dt><dd>总 15 分钟，截止 ${esc(s.deadline)}；单次 ≤ 8 分钟</dd><dt>模型</dt><dd>DeepSeek V4 · 来自当前设置</dd></dl><p>“已知 / 已预留 / 未明”分开显示：未明不会显示为 0；可能已发送的派发保持预留直到核对。时限是截止时刻，不是剩余时间估计。</p></div>`);
    p = $('#budgetPop'); const r = b.getBoundingClientRect(); p.style.top = r.bottom + 8 + 'px'; p.style.left = Math.max(8, Math.min(r.right - 340, innerWidth - 348)) + 'px';
    b.setAttribute('aria-expanded', 'true');
    setTimeout(() => document.addEventListener('click', function off(e) { if (!p.contains(e.target) && e.target !== b) { p.remove(); b.setAttribute('aria-expanded', 'false'); document.removeEventListener('click', off); } }), 0);
  }
  function renderBanners(c) {
    $('#banners').innerHTML = c.banners.map((b) => `<div class="banner ${b.k}">${I(b.i)}<div class="grow">${b.later ? '<span class="tagx later" style="margin-right:6px">设计候选 · 后续分期</span>' : ''}${b.h}</div>${b.a ? `<div class="actions">${b.a.map(([id, l]) => `<button class="btn secondary sm" data-act="${id}">${esc(l)}</button>`).join('')}</div>` : ''}</div>`).join('');
  }

  /* ================= 右侧面板 ================= */
  const TAB_L = { input: '需求与输入', records: '规划记录', draft: '草稿与问题', plan: '计划', check: '检查', ws: '工作区' };
  function renderSide(c) {
    const side = $('#side');
    const tabs = c.tabs; let tab = ui.tab && tabs.includes(ui.tab) ? ui.tab : c.tab;
    ui.tab = tab;
    side.classList.toggle('reading', ui.reading && tab === 'records');
    const cnt = { records: recItems(c).filter((r) => r.seq).length, check: issues(c).length };
    const head = `<div class="side-head"><div class="row1"><div class="grow"><div class="eyebrow">${esc(LARGE_MODE() ? PEF.LARGE.method : T.method)}</div></div>
        ${tabs.includes('records') ? `<label class="sr" for="roundSel">规划轮次</label><select class="round-sel" id="roundSel" ${c.round ? '' : 'disabled'}>${(c.round ? rounds() : [{ n: 0, label: '暂无规划轮次' }]).map((r) => `<option value="${r.n}" ${(c.hist ? r.n === 1 : r.n === c.round) ? 'selected' : ''}>${r.label}</option>`).join('')}</select>` : ''}
        <button class="icon-btn" id="sideClose" aria-label="收起右侧面板" title="收起右侧面板">${I('chevRight')}</button>${tab === 'records' ? `<button class="icon-btn" id="wideBtn" aria-pressed="${ui.reading}" aria-label="${ui.reading ? '退出宽阅读' : '宽阅读'}" title="${ui.reading ? '退出宽阅读' : '宽阅读'}">${I('panel')}</button>` : ''}</div>
      <div class="tabs" role="tablist" aria-label="规划面板">${tabs.map((t) => `<button class="tab" role="tab" id="tab-${t}" aria-selected="${t === tab}" aria-controls="tp" data-tab="${t}">${TAB_L[t]}${cnt[t] ? `<span class="n">${cnt[t]}</span>` : ''}${t === 'check' && ['block', 'conflict'].includes(c.check) ? '<span class="mk" style="background:var(--danger)"></span>' : ''}</button>`).join('')}</div></div>`;
    let body = '', foot = '';
    if (tab === 'records') body = recordsHTML(c);
    else if (tab === 'input') body = `<div class="side-body" id="tp" role="tabpanel" aria-labelledby="tab-input">${inputHTML(c)}</div>`;
    else if (tab === 'draft') body = `<div class="side-body" id="tp" role="tabpanel" aria-labelledby="tab-draft">${ui.sel ? nodeHTML(c) : draftHTML(c)}</div>`;
    else if (tab === 'plan') { body = `<div class="side-body" id="tp" role="tabpanel" aria-labelledby="tab-plan">${ui.sel ? nodeHTML(c) : planHTML(c)}</div>`; foot = planFoot(c); }
    else if (tab === 'check') { body = `<div class="side-body" id="tp" role="tabpanel" aria-labelledby="tab-check">${checkHTML(c)}</div>`; foot = planFoot(c); }
    else if (tab === 'ws' && prep()) { body = `<div class="side-body" id="tp" role="tabpanel" aria-labelledby="tab-ws">${prep().html()}</div>`; foot = prep().foot(); }
    side.innerHTML = head + body + foot;
    side.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => { ui.tab = b.dataset.tab; ui.tool = null; PE.setCtx({ tab: ui.tab }); renderSide(cfg()); $('#tab-' + ui.tab)?.focus(); }));
    side.querySelector('[role=tablist]')?.addEventListener('keydown', (e) => { if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return; const i = tabs.indexOf(ui.tab) + (e.key === 'ArrowRight' ? 1 : -1); const t = tabs[(i + tabs.length) % tabs.length]; ui.tab = t; PE.setCtx({ tab: t }); renderSide(cfg()); $('#tab-' + t)?.focus(); });
    $('#roundSel')?.addEventListener('change', (e) => { const n = +e.target.value; if (n === 1 && round() === 2) PE.nav('pe30', { round: 2, back: S, tab: 'records' }); else if (S === 'pe30') PE.nav(PE.ctx('back') || 'pe25', { round: 2 }); });
    side.classList.toggle('collapsed', !!ui.sideCollapsed);
    $('#sideClose')?.addEventListener('click', () => { ui.sideCollapsed = true; renderSide(cfg()); renderCanvas(cfg()); $('#sideOpen')?.focus(); });
    $('#wideBtn')?.addEventListener('click', () => { ui.reading = !ui.reading; renderSide(cfg()); });
    wireRecords(c);
  }

  function inputHTML(c) {
    let q = esc(T.original);
    T.items.slice().sort((a, b) => b.span[0] - a.span[0]).forEach((it) => { const raw = T.original.slice(it.span[0], it.span[1]); q = q.replace(esc(raw), `<mark title="${it.k}">${esc(raw)}</mark>`); });
    const pe04 = S === 'pe04';
    return `<div class="sec"><div class="sec-h"><h3 class="grow">需求原文</h3><span class="badge outline">修订 1 · 只读</span></div><div class="quote">${q}</div><div class="lock-note">${I('lock', 'sm')}原文不可删改；拆分条目回指原文区间（下方 R1–C2）。</div></div>
      <div class="sec"><div class="sec-h"><h3 class="grow">需求条目</h3><span class="cnt">5 条 · 稳定编号</span></div><div class="box">${T.items.map((it) => `<div class="rowx"><span class="tagx ${it.kind === '限制' ? 'decision' : ''} mono">${it.k}</span><div class="grow"><div>${esc(it.text)}</div><div class="s">${it.kind} · 原文第 ${it.span[0] + 1}–${it.span[1]} 字</div></div></div>`).join('')}</div></div>
      <div class="sec"><div class="sec-h"><h3 class="grow">补充需求</h3><span class="cnt">${ui.supp ? '未保存' : '可选'}</span></div><label class="sr" for="supp">补充需求</label><textarea class="textarea" id="supp" rows="3" placeholder="补充目标、限制或验收要求；保存后形成新的输入修订">${esc(ui.supp)}</textarea></div>
      <div class="sec"><div class="sec-h"><h3 class="grow">资料（只读引用）</h3><span class="cnt">3 份</span></div><div class="box">
        <div class="rowx"><span class="ic ok">${I('check')}</span><div class="grow"><div class="mono" style="font-size:12.5px">src/${esc(T.pkg)}/**</div><div class="s">已授权目录 · 只读</div></div></div>
        <div class="rowx"><span class="ic ${pe04 ? 'no' : 'ok'}">${I(pe04 ? 'x' : 'check')}</span><div class="grow"><div class="mono" style="font-size:12.5px">docs/api/${esc(T.pkg)}.md</div><div class="s">${pe04 ? '<span style="color:var(--danger)">无读取权限（项目授权已变更）</span> · 去项目授权或换一份资料' : '项目文档 · 只读'}</div></div></div>
        <div class="rowx"><span class="ic ok">${I('check')}</span><div class="grow"><div class="mono" style="font-size:12.5px">db/schema/${esc(T.pkg)}.sql</div><div class="s">只读节选（不连接数据库）</div></div></div></div></div>
      <div class="sec"><div class="sec-h"><h3 class="grow">流程方法</h3><span class="badge outline">${esc(T.method)}</span></div><div class="box pad" style="font-size:13px;line-height:1.7">
        <div><span class="muted">必经步骤</span>　梳理需求 → 方案设计 → 实现 → 测试 → 人工验收</div><div><span class="muted">可细化</span>　实现、测试（每步 ≤ 4 个子步骤，深度 ≤ 2）</div><div><span class="muted">AI 规划</span>　${S === 'b07' ? '<span style="color:var(--warn)">未配置</span>' : basisHTML()}</div></div></div>
      <div class="sec"><div class="sec-h"><h3 class="grow">模型与预算（来自现有设置）</h3></div><dl class="mini-kv"><dt>模型</dt><dd>DeepSeek V4</dd><dt>本轮预算</dt><dd>${pe04 ? '<span style="color:var(--warn)">未设置 · </span><a href="#" data-act="go-settings" style="color:var(--accent)">去设置</a>' : '2.00 元 / 轮（设置与任务上限取交集）'}</dd><dt>次数</dt><dd>最多 2 次派发（初稿 1 + 修订 1）</dd></dl></div>`;
  }

  function draftHTML(c) {
    const isNeed = S === 'pe11', isLimit = S === 'pe12';
    const cov = `<div class="sec"><div class="sec-h"><h3 class="grow">${c.hist ? '检查点 #1（第 1 轮）' : '草稿检查点 #2'}</h3><span class="tagx fact">服务事实</span></div><div class="box">
      <div class="rowx"><span class="ic ok">${I('check')}</span><div class="grow"><div class="t">已覆盖</div><div class="s">${c.hist ? 'R1、R2 · 需求与方案 2 步' : 'R1、R2、R3、C1 · 需求与方案 2 步、实现 3 步'}</div></div></div>
      <div class="rowx"><span class="ic unk">?</span><div class="grow"><div class="t">尚未覆盖</div><div class="s">${c.hist ? 'R3、C1、C2 · 实现、测试、验收' : 'C2（旧数据）的验收 · 测试、验收两组'}</div></div></div></div>
      <div class="foot-note" style="margin-top:8px">${I('info', 'sm')}部分草稿只读、不能应用或确认；只有服务保存的结构化检查点才会画到画布上，不从聊天文字解析节点。</div></div>`;
    const qs = isNeed ? bqHTML('need') + `<div class="foot-note" style="margin:-10px 0 18px">${I('info', 'sm')}答复不会修改第 ${round()} 轮的输入；“预览新一轮”时带上修订 2。模型不会自己替你决定，建议项也不算回答。</div>` : `<div class="sec"><div class="sec-h"><h3 class="grow">模型提出的问题与假设</h3><span class="tagx claim">模型陈述 · 未确认</span></div>
      ${`<div class="box"><div class="rowx"><span class="ic wait">${I('help')}</span><div class="grow"><div class="t">假设：日期按创建时间（created_at）筛选</div><div class="s">记录 #9 · 候选出来后作为业务问题请你明确回答（不能用勾选代替）</div></div></div><div class="rowx"><span class="ic wait">${I('help')}</span><div class="grow"><div class="t">提议：导出单次最多 10,000 行</div><div class="s">记录 #13 · 原文未要求 · 同样作为业务问题请你回答</div></div></div></div>`}</div>`;
    const lim = isLimit ? `<div class="sec"><div class="sec-h"><h3 class="grow">为什么停下</h3><span class="tagx fact">服务事实</span></div><div class="box"><div class="rowx"><span class="ic no">${I('x')}</span><div class="grow"><div class="t">修订上限 1/1 已用</div><div class="s">IO_TYPE_MISMATCH 在修订后重复（同一问题签名）</div></div></div><div class="rowx"><span class="ic ok">${I('check')}</span><div class="grow"><div class="t">原账已结清</div><div class="s">已知 1.62 元 · 预留余额已释放 · 未明 无</div></div></div></div></div>` : '';
    const supp = c.readonly || isNeed || isLimit || STOPPED.includes(S) ? '' : `<div class="sec"><div class="sec-h"><h3 class="grow">补充需求</h3>${S === 'pe13' ? `<span class="badge st-done">${I('check', 'sm')}已保存 · 输入修订 2</span>` : ''}</div><label class="sr" for="supp2">补充需求</label><textarea class="textarea" id="supp2" rows="3" placeholder="例如：导出单次最多 10,000 行" ${S === 'pe13' ? 'readonly' : ''}>${esc(ui.supp)}</textarea>
      <div class="row" style="margin-top:8px;gap:8px">${S === 'pe13' ? '' : '<button class="btn secondary sm" data-act="save-supp">保存补充</button>'}<span class="why">保存后不会纳入本轮；本轮仍按修订 1 生成。</span></div></div>`;
    return lim + qs + cov + supp;
  }

  /* ---------- 规划记录 ---------- */
  function recItems(c) {
    let r = REC.filter((x) => x.seq <= (c.cut || 0)).map((x) => Object.assign({}, x));
    if (c.rec.noText) r = r.filter((x) => x.kind !== 'text');
    if (c.rec.running) r.forEach((x) => { if (x.seq === c.rec.running) { x.st = 'run'; x.res = '读取中…'; } });
    if (c.rec.gap) { r = r.filter((x) => x.seq < 6 || x.seq > 9); const i = r.findIndex((x) => x.seq > 9); r.splice(i, 0, { kind: 'gap', body: '#6–#9 共 4 条记录无法补读：服务说明“超出保留期已清理”。前后内容不受影响。' }); }
    if (c.rec.unsettled) r = r.filter((x) => x.seq !== 16).concat([{ seq: 17, tm: '14:09:05', kind: 'check', title: '程序检查 · 完成', body: '结构检查通过；需人工判断 3 项；依据部分（1 份截断）。' }, { kind: 'phase', tm: '14:09:06', seq: 18, cls: 'unk', title: '等待原调用停稳与结账', body: '候选只读预览已发布；应用需等原调用停稳、用量结账。' }]);
    if (c.rec.revise) r = r.concat([{ seq: 16, tm: '14:08:31', kind: 'phase', title: '原调用已停稳 · 用量已结账', body: '第 1 次派发：已知 0.46 元。' }, { seq: 17, tm: '14:08:52', kind: 'check', title: '程序检查 · 发现 1 个可自动修订的问题', body: 'IO_REQUIRED_UNBOUND：前端筛选栏与导出按钮 缺少必需输入 /api-contract。' }, { seq: 18, tm: '14:08:53', kind: 'phase', title: '检查计划 → 修订候选 · 第 1/1 次修订', body: '第 2 次派发（generation 1）：只修改该问题及直接受影响的节点/边。' }, { seq: 19, tm: '14:09:31', kind: 'text', body: ['给“前端筛选栏与导出按钮”接上方案设计的 /api-contract 输出，其余节点不变。'] }]);
    if (c.rec.inputSaved) r.push({ seq: 14, tm: '14:08:02', kind: 'phase', title: '需求输入修订 2 已保存（未纳入本轮）', body: '补充：导出单次最多 10,000 行。第 2 轮继续按修订 1 生成。' });
    if (c.rec.needs) r = r.concat([{ seq: 14, tm: '14:08:20', kind: 'phase', title: '生成候选 · 停止：需要用户答复', body: '模型提交了 2 个业务问题，未提交候选；原调用已停稳、已结账（已知 0.46 元）。' }]);
    if (c.rec.limit) r = r.filter((x) => x.seq <= 16).concat([{ seq: 17, tm: '14:09:05', kind: 'check', title: '程序检查 · 1 个可自动修订问题', body: 'IO_TYPE_MISMATCH：导出 CSV 接口 /query-service 与 后端筛选查询 /patch 类型不符。' }, { seq: 18, tm: '14:09:06', kind: 'phase', title: '修订候选 · 第 1/1 次', body: '第 2 次派发。' }, { seq: 25, tm: '14:14:46', kind: 'check', title: '程序检查 · 同一问题仍存在', body: '问题签名与修订前相同；修订上限 1/1 已用。停下交给你。' }, { seq: 26, tm: '14:14:47', kind: 'phase', title: '停在“需要你决定”', body: '原调用已停稳、已结账（已知 1.62 元）。' }]);
    if (c.rec.stopReq) r.push({ seq: 14, tm: '14:08:44', kind: 'phase', cls: 'stop', title: '已受理停止请求（rk-7f3a）', body: '规划派发权已收回；等待原进程停稳与结账。迟到提交将被拒绝（STALE_ATTEMPT）。' });
    if (c.rec.stopped) r = r.concat([{ seq: 14, tm: '14:08:44', kind: 'phase', cls: 'stop', title: '已受理停止请求（rk-7f3a）', body: '规划派发权已收回。' }, { seq: 15, tm: '14:09:02', kind: 'phase', cls: 'stop', title: '原进程已停稳 · 用量已结账', body: '已知 0.31 元。第 2 轮已停止。' }]);
    if (c.rec.unknown) r.push({ seq: 14, tm: '14:08:44', kind: 'phase', cls: 'unk', title: '停止请求已发出 · 回执未知', body: '请求号 rk-7f3a。进程与用量状态待核对。' });
    if (c.rec.failed) r.push({ seq: 14, tm: '14:08:37', kind: 'phase', cls: 'stop', title: '生成候选 · 失败', body: '模型服务返回 context_length_exceeded（公开错误）。原调用已结束、已结账（已知 0.29 元）。不自动重试。' });
    if (c.rec.reconciling) r.push({ seq: 14, tm: '14:06:12', kind: 'phase', cls: 'unk', title: '服务重启 · 核对原轮次', body: '派发意图：已发送 · owner：核对中 · 会话：核对中 · 用量：核对中。' });
    if (c.rec.hist) r = r.filter((x) => x.seq <= 9).map((x) => Object.assign({}, x, { tm: x.tm.replace(/^14:0(\d)/, (m, d) => '13:4' + (+d + 8 > 9 ? 9 : +d + 8)) })).concat([{ seq: 10, tm: '13:51:30', kind: 'phase', cls: 'stop', title: '用户停止 · 原进程停稳 · 已结账', body: '已知 0.18 元。停止原因：用户补充需求后选择“停止本轮并按补充重新规划”。' }]);
    return r;
  }
  function recordsHTML(c) {
    if (special()) return `<div class="side-body" id="tp" role="tabpanel" aria-labelledby="tab-records"><div class="empty" style="padding:40px 12px"><div class="tile">${I('clock', 'lg')}</div><h3>${isLarge() ? '规划记录按轮次保存' : '没有 AI 规划记录'}</h3><p>${isFixed() ? '固定模板任务不经过 AI 规划。' : isLarge() ? '本任务共 4 轮：总览 1 轮 + 3 轮分组细化。原型只示意总览与分组轮次，记录形态与普通规划相同。' : '这份计划由旧版流程生成并确认，没有规划轮次。'}</p></div></div>`;
    if (ui.tool) return toolHTML(c);
    let top = '';
    if (c.rec.noText) top = `<div class="notice">${I('info', 'sm')}<span>此运行时暂未提供公开正文；阶段与工具活动仍然真实显示。没有正文不代表失败。</span></div>`;
    const about = `<div class="rec-top"><div class="rec-about">${I('info', 'sm')}<span>按服务序号排列。来源标签：<span class="tagx fact">服务事实</span> 阶段、工具、检查；<span class="tagx claim">模型陈述</span> 公开正文（不改变阶段）。不显示隐藏推理。离开页面不会停止规划。</span></div>${c.rec.catching ? `<div class="banner info" style="padding:8px 12px;font-size:12.5px">${I('refresh', 'sm')}<span>正在补读 #10 起的 9 条记录…已读的 #1–#9 先显示；按序号去重。</span></div>` : ''}</div>`;
    if (c.rec.err) return `<div class="side-body flush" id="tp" role="tabpanel" aria-labelledby="tab-records">${about}<div class="rec-wrap"><div class="rec"><div class="empty" style="padding:40px 12px"><div class="tile">${I('alert', 'lg')}</div><h3>读取失败</h3><p>规划记录接口返回 503。重新读取不会调用模型，也不会改变规划状态。</p><button class="btn secondary sm" data-act="reread">重新读取</button></div></div></div></div>`;
    if (c.rec.perm) return `<div class="side-body flush" id="tp" role="tabpanel" aria-labelledby="tab-records">${about}<div class="rec-wrap"><div class="rec"><div class="empty" style="padding:40px 12px"><div class="tile">${I('lock', 'lg')}</div><h3>当前账号无权查看</h3><p>规划正文与工具结果需要该项目的读取权限。阶段名称等公开信息仍可见。</p></div></div></div></div>`;
    const items = c.rec.old ? [{ seq: 1, tm: '13:48:10', kind: 'phase', title: '第 1 轮 · 已开始（旧格式）', body: '旧版轮次只记录了开始与停止请求。' }, { seq: 2, tm: '13:51:30', kind: 'phase', cls: 'unk', title: '已请求停止 · 停稳与结账待核对', body: '旧格式没有停稳证据，不显示为“已停止”。' }] : recItems(c);
    if (!items.length) return `<div class="side-body flush" id="tp" role="tabpanel" aria-labelledby="tab-records">${about}<div class="rec-wrap"><div class="rec"><div class="empty" style="padding:40px 12px"><div class="tile">${I('clock', 'lg')}</div><h3>${c.loading ? '正在读取…' : '尚无规划记录'}</h3><p>${c.loading ? '先显示已持久的记录，再按游标补读。' : '确认开始规划后，这里会出现阶段、工具与检查记录。'}</p></div></div></div></div>`;
    const html = items.map((r, i) => {
      const last = i === items.length - 1;
      const tm = `<div class="tm">${r.tm || ''}${r.seq ? `<span class="sq">#${r.seq}</span>` : ''}</div>`;
      if (r.kind === 'gap') return `<div class="gapx" role="note"><span>${I('help', 'sm')}${esc(r.body)}</span></div>`;
      if (r.kind === 'phase' || r.kind === 'checkpoint') return `<div class="ri">${tm}<div class="ph-card ${r.cls || ''}">${I(r.kind === 'checkpoint' ? 'layers' : r.cls === 'stop' ? 'stop' : r.cls === 'unk' ? 'help' : 'info')}<div class="grow"><b>${esc(r.title)}</b> <span class="tagx fact">服务事实</span><span class="meta">${esc(r.body)}</span>${r.kind === 'checkpoint' && !c.readonly ? `<button class="btn ghost sm" data-act="show-partial" style="margin-top:4px;height:26px">在画布查看部分草稿</button>` : ''}</div></div></div>`;
      if (r.kind === 'text') return `<div class="ri">${tm}<div class="txt ${c.stream && last ? 'streaming' : ''}"><div class="hd">模型公开正文 <span class="tagx claim">模型陈述</span>${c.stream && last ? '<span class="muted">· 正在生成</span>' : ''}</div>${r.body.map((p) => `<p>${esc(p)}</p>`).join('')}</div></div>`;
      if (r.kind === 'tool') return `<div class="ri">${tm}<button class="tc" data-tool="${r.seq}" aria-label="工具 ${esc(r.nm)} ${esc(r.id)}，${r.st === 'run' ? '运行中' : '成功'}，打开只读详情"><div class="tc-h"><span class="nm">${esc(r.nm)}</span><span class="id">${esc(r.id)}</span><span class="src-tag tagx ext">只读资料</span><span class="badge ${r.st === 'run' ? 'st-run' : 'st-done'}">${r.st === 'run' ? '<span class="spin"></span>运行中' : I('check', 'sm') + '成功'}</span></div><div class="tc-l"><span class="k">参数</span><span class="v">${esc(r.arg)}</span></div><div class="tc-l"><span class="k">结果</span><span class="v ${r.st === 'run' ? 'muted' : ''}">${esc(r.res)}</span></div>${r.note ? `<div class="tc-note">${I('alert', 'sm')}${esc(r.note)}</div>` : ''}</button></div>`;
      if (r.kind === 'check') return `<div class="ri">${tm}<div class="ck-card"><div class="h">${I('shield', 'sm')}${esc(r.title)} <span class="tagx fact">服务事实</span></div><div style="margin-top:3px">${esc(r.body)}</div></div></div>`;
      return '';
    }).join('');
    const live = RUNNING.includes(S) && !['pe26', 'b01'].includes(S);
    return `<div class="side-body flush" id="tp" role="tabpanel" aria-labelledby="tab-records">${about}<div class="rec-wrap"><div class="rec" id="rec" tabindex="0" aria-label="规划记录（可滚动）">${top}${html}${live ? `<div class="muted" style="font-size:12px;padding:10px 0 0 68px">${I('clock', 'sm')} 等待服务的下一条记录…（没有预计时间）</div>` : ''}</div>
      ${live ? `<button class="newpill" id="newPill" hidden>${I('arrowRight', 'sm')}回到最新</button><div class="follow"><span>跟随最新</span><button class="switch" role="switch" id="followSw" aria-checked="${ui.follow}" aria-label="跟随最新"></button></div>` : ''}</div></div>`;
  }
  function toolHTML(c) {
    const r = REC.find((x) => x.seq === ui.tool) || REC[3];
    const running = c.rec.running === r.seq;
    const excerpt = r.nm === 'project.read_file' && /QueryService/.test(r.arg) ? `public class ${T.cls}QueryService {\n  public Page<${T.cls}View> query(${T.cls}Query q) {\n    // 现有查询：按订单号 / 用户筛选\n    ...\n  }\n  ……（第 1–120 行）` : r.nm === 'project.search' ? `src/${T.pkg}/query/${T.cls}QueryService.java:88  status\nsrc/${T.pkg}/model/${T.cls}.java:41  status\ndb/schema/${T.pkg}.sql:12  status VARCHAR(16) NULL\n……共 12 处` : `（${esc(r.res)}；只读节选按读取许可显示）`;
    return `<div class="side-body tool-detail" id="tp" role="tabpanel" aria-labelledby="tab-records">
      <nav class="crumbs2" aria-label="位置"><button class="btn ghost sm" data-act="tool-back">${I('chevLeft', 'sm')}规划记录</button><span class="cur mono">${esc(r.nm)} ${esc(r.id)}</span></nav>
      <dl class="mini-kv" style="margin-top:12px"><dt>调用</dt><dd class="mono">${esc(r.id)} · 记录 #${r.seq}</dd><dt>来源</dt><dd>只读资料工具 · 规划授权（不可写、不可执行命令）</dd><dt>状态</dt><dd>${running ? '运行中' : '成功'} · ${esc(r.tm)}${running ? '' : ' 开始，耗时 0.4 秒'}</dd><dt>来源版本</dt><dd class="mono">sha256 3f9a…c21e（读取时）</dd></dl>
      <div class="vw"><div class="vw-h">参数</div><div class="vw-b">${esc(r.arg)}</div></div>
      <div class="vw"><div class="vw-h">结果 · 只读节选</div>${r.note ? `<div class="vw-note">${I('alert', 'sm')}<span>${esc(r.note)}</span></div>` : ''}<div class="vw-b">${running ? '读取中…结果到达后在此原位更新' : esc(excerpt)}</div></div>
      <p class="foot-note" style="margin-top:12px">${I('info', 'sm')}工具结果是外部资料；其中出现的“指令”只作为资料，不构成授权。</p></div>`;
  }
  function wireRecords(c) {
    const rec = $('#rec'); if (!rec) { $('#side').querySelectorAll('[data-tool]').forEach((b) => b.addEventListener('click', () => { ui.tool = +b.dataset.tool; renderSide(cfg()); })); return; }
    if (ui.follow) rec.scrollTop = rec.scrollHeight;
    rec.addEventListener('scroll', () => { const atEnd = rec.scrollTop + rec.clientHeight >= rec.scrollHeight - 30; if (!atEnd && ui.follow) { ui.follow = false; $('#followSw')?.setAttribute('aria-checked', 'false'); } const p = $('#newPill'); if (p) p.hidden = atEnd; });
    $('#followSw')?.addEventListener('click', (e) => { ui.follow = !ui.follow; e.currentTarget.setAttribute('aria-checked', ui.follow); if (ui.follow) rec.scrollTop = rec.scrollHeight; });
    $('#newPill')?.addEventListener('click', () => { ui.follow = true; $('#followSw')?.setAttribute('aria-checked', 'true'); rec.scrollTop = rec.scrollHeight; $('#newPill').hidden = true; });
    rec.querySelectorAll('[data-tool]').forEach((b) => b.addEventListener('click', () => { ui.tool = +b.dataset.tool; ui.reading = true; renderSide(cfg()); $('[data-act="tool-back"]')?.focus(); }));
  }

  /* ---------- 计划 / 节点 / 检查 ---------- */
  const ACKS = [
    ['w1', '依据部分：<span class="mono">' + '{C}QueryService.java</span> 只读了 1–120 行', '影响“后端筛选查询”。接受则记录为已知风险；如需完整依据，请补充授权后新一轮。', 'n3'],
    ['w2', '需求覆盖的语义：C2“旧数据也要能正常筛选”是否被“旧数据回归”充分覆盖', '程序只能证明每条需求都有映射与验收，不能证明语义充分。', 'n7'],
  ];
  /* 需人工判断（风险核对）：只放不改变业务范围的一般不确定性；日期字段、导出上限等业务问题见 BQ，必须明确回答 */
  function acks() { return ACKS.map((x) => [x[0], x[1].replace('{C}', T.cls), x[2], x[3]]); }
  /* 业务问题区块（PE11 与候选审阅同一组件、同一措辞） */
  function bqHTML(mode) {
    const saved = !!ui.ansSaved;
    const qs = BQ.map((q) => `<div class="qcard" id="bq-${q.id}"><div class="qt">${esc(q.t)}</div><div class="qs">影响：${esc(q.impact)} · 来源：${esc(q.src)}</div>
      <div class="qopts" role="radiogroup" aria-label="${esc(q.t)}">${q.opts.map(([v, l, imp]) => `<button class="qopt" role="radio" data-bq="${q.id}" data-v="${v}" aria-checked="${ui.ans[q.id] === v}" ${saved ? 'aria-disabled="true"' : ''}><span class="r"></span><span class="grow"><span>${esc(l)}</span>${v === q.suggest ? ' <span class="tagx claim">建议 · 模型提议，未作答</span>' : ''}<br><span class="muted" style="font-size:11.5px">${esc(imp)}</span></span></button>`).join('')}</div>
      <div class="row" style="gap:6px;margin-top:6px">${q.nodes.map((n) => `<button class="btn ghost sm" data-focus="${n}" style="height:24px;padding:0 8px">定位</button>`).join('')}</div></div>`).join('');
    const left = BQ.filter((q) => !ui.ans[q.id]).length;
    let foot;
    if (!saved) foot = `<div class="row" style="margin-top:12px;gap:8px;flex-wrap:wrap">${left ? `<span class="dis-wrap" style="align-items:flex-start"><button class="btn secondary sm" data-act="bq-save" aria-disabled="true" aria-describedby="bqWhy">保存答复（形成需求输入修订 2）</button><span class="dis-reason" id="bqWhy" style="text-align:left">还有 ${left} 个问题未回答；预选建议不算回答</span></span>` : `<button class="btn secondary sm" data-act="bq-save" id="bqSave">保存答复（形成需求输入修订 2）</button>`}</div>`;
    else foot = `<div class="box" style="margin-top:12px"><div class="rowx"><span class="ic ok">${I('check')}</span><div class="grow"><div class="t">已保存为需求输入修订 2</div><div class="s">你 · 14:12 · ${BQ.map((q) => esc(bqLabel(q, ui.ans[q.id]))).join('；')}</div></div></div>
      ${mode === 'cand' ? `<div class="rowx"><span class="ic ${ui.reval === 'ok' ? 'ok' : ui.reval === 'stale' ? 'no' : 'run'}">${ui.reval === 'checking' ? '<span class="spin" style="width:10px;height:10px"></span>' : I(ui.reval === 'ok' ? 'check' : 'x')}</span><div class="grow"><div class="t">${ui.reval === 'checking' ? '正在按输入修订 2 重新校验候选…' : ui.reval === 'ok' ? '候选与答复一致：已按输入修订 2 重新校验（不调用模型）' : '候选与答复不一致：候选基于修订 1 的假设，已过期'}</div><div class="s">${ui.reval === 'stale' ? '修订 1 与本轮记录保留，不回写；请按修订 2 预览新一轮' : '候选键与输入修订绑定，应用时一起记录'}</div></div>${ui.reval === 'stale' ? '<button class="btn secondary sm" data-act="repreview">预览新一轮</button>' : ''}</div>` : ''}</div>`;
    return `<div class="sec" id="bqSec"><div class="sec-h"><h3 class="grow">需要你回答 · 业务问题</h3><span class="cnt">${saved ? '已回答' : `${BQ.length - left}/${BQ.length} 已回答`}</span></div>
      <p class="muted" style="font-size:12.5px;line-height:1.6;margin:-2px 0 10px">这些提议会改变业务含义、范围或验收，不能用“勾选风险”代替回答；答复形成新的需求输入修订，旧轮输入保留。</p>${qs}${foot}</div>`;
  }
  function planHTML(c) {
    if (LARGE_MODE()) return largeHTML(c);
    if (special()) return specialPlanHTML(c);
    if (c.dismissedView) return '';
    if (c.exec) return traceHTML();
    const cand = ['compare', 'cand'].includes(c.layer) || READY.includes(S) || S === 'pe26';
    const summary = `<div class="sec"><div class="sec-h"><h3 class="grow">${S === 'pe31' || isPW() ? '本次应用的改动' : '候选相对当前草稿'}</h3><span class="cnt">计划修订 2 → ${S === 'pe31' || isPW() ? '3' : '3（应用后）'}</span></div>
      <div class="sum-grid"><div class="c"><b>5</b><span>新增步骤</span></div><div class="c"><b>2</b><span>修改步骤</span></div><div class="c"><b>2</b><span>由细化替换</span></div></div>
      <div class="box" style="margin-top:8px">${PEF.GROUPS.map((g) => `<button class="rowx" data-focus-grp="${g.id}"><span class="ic ${g.id === 'g2' || g.id === 'g3' ? 'run' : 'idle'}">${I('layers')}</span><div class="grow"><div class="t">${esc(g.title)}</div><div class="s">${{ g1: '梳理需求（修改：补充验收）· 方案设计（未变）', g2: '替换骨架“实现” → 后端筛选查询 · 导出 CSV 接口 · 前端筛选栏与导出按钮', g3: '替换骨架“测试” → 接口测试 · 旧数据回归', g4: '人工验收（修改：按 5 条需求展开验收清单）' }[g.id]}</div></div>${I('chevRight', 'sm')}</button>`).join('')}</div>
      <div class="foot-note" style="margin-top:8px">${I('info', 'sm')}差异由服务对“当前草稿”与编译后的候选计算，不采信模型自报的删除清单。依赖：新增 11 条、移除 4 条。</div></div>`;
    const cov = `<div class="sec"><div class="sec-h"><h3 class="grow">需求覆盖</h3><span class="cnt">5/5 已映射 · 语义需人工核对</span></div>${coverageTable()}</div>`;
    let ackSec = '';
    if (cand && !['pe27', 'pe29'].includes(S)) {
      const A = acks(); const done = A.filter((a) => ui.acks[a[0]]).length;
      ackSec = `<div class="sec"><div class="sec-h"><h3 class="grow">需人工判断</h3><span class="cnt">${done}/${A.length} 已核对</span></div><div class="box">${A.map((a) => `<label class="ackl"><input type="checkbox" data-ack="${a[0]}" ${ui.acks[a[0]] ? 'checked' : ''}><span class="grow"><span style="color:var(--ink)">${a[1]}</span><br><span class="muted" style="font-size:12px">${esc(a[2])}</span> <button class="btn ghost sm" data-focus="${a[3]}" style="height:24px;padding:0 8px">定位</button></span></label>`).join('')}</div>
        <div class="foot-note" style="margin-top:8px">${I('info', 'sm')}勾选表示你接受这项具体风险，会记录你与版本；它不等于“检查通过”。</div></div>
        ${round() === 2 ? decisionsHTML() : ''}`;
    }
    const bqSec = cand && round() === 1 && !['pe27', 'pe29'].includes(S) ? bqHTML('cand') : '';
    const applied = S === 'pe31' || isPW() ? `<div class="sec"><div class="sec-h"><h3 class="grow">规划依据</h3></div><div class="box"><div class="rowx"><span class="ic ok">${I('check')}</span><div class="grow"><div class="t">第 ${round()} 轮候选 · 已应用</div><div class="s">需求输入修订 ${round()} · 规划策略 v1 · 检查报告 14:09:05 · 人工判断 ${acks().length} 项已核对</div></div></div></div></div>` : '';
    const five = `<div class="foot-note" style="margin-top:18px">${I('info', 'sm')}生成计划、应用到草稿、确认计划、准备独立工作区、开始执行是五个独立操作，任何一步都不会自动触发下一步。</div>`;
    return (applied || '') + bqSec + summary + ackSec + cov + five;
  }
  function decisionsHTML() {
    return `<div class="sec"><div class="sec-h"><h3 class="grow">已确认的业务决定</h3><span class="cnt">需求输入修订 2</span></div><div class="box">${BQ.map((q) => `<div class="rowx"><span class="ic ok">${I('check')}</span><div class="grow"><div class="t">${esc(q.t)} → ${esc(bqLabel(q, q.suggest))}</div><div class="s">你在第 1 轮后明确回答 · 来源：需求输入修订 2 · 本轮候选按此生成</div></div></div>`).join('')}</div>
      <div class="row" style="margin-top:8px"><button class="btn ghost sm" data-act="bq-change">${I('edit', 'sm')}修改答复…</button><span class="muted" style="font-size:12px">修改会形成修订 3，当前候选过期</span></div></div>`;
  }
  /* v4：旧需求 / 固定模板的“计划”页签 */
  function specialPlanHTML(c) {
    if (isFixed()) {
      const tp = T.tpl;
      return `<div class="sec"><div class="sec-h"><h3 class="grow">固定模板</h3><span class="tagx fact">实例创建时固定</span></div><dl class="mini-kv"><dt>模板</dt><dd>${esc(tp.name)} · <span class="mono">${esc(tp.ref)}@r${tp.rev}</span></dd><dt>来源</dt><dd>origin=fixed-menu-template（锁定按来源，不按名称或版本）</dd><dt>项目</dt><dd>${esc(tp.project)} · ${esc(tp.branch)}</dd>${tp.params.map(([k, v]) => `<dt>${esc(k)}</dt><dd class="mono" style="font-size:12.5px">${esc(v)}</dd>`).join('')}<dt>计划</dt><dd>修订 ${T.planRev} · ${isPW() || S === 'b08' ? '已确认' : '待确认'}</dd></dl></div>
        <div class="sec"><div class="sec-h"><h3 class="grow">固定步骤</h3><span class="cnt">${tp.steps.length} 步</span></div><div class="box">${tp.steps.map(([t, r, o, w], i) => `<button class="rowx" data-focus="n${i + 1}"><span class="ic idle">${I('lock')}</span><div class="grow"><div class="t">${esc(t)}</div><div class="s">${esc(r)} · ${esc(o)} · ${w === 'ro' ? '只读' : '写任务工作区'}</div></div></button>`).join('')}</div></div>
        <div class="sec"><div class="sec-h"><h3 class="grow">不能做的事</h3></div><div class="box">${['新增 / 删除步骤', '改依赖、职业、模型、验收与入口参数', 'AI 细化计划', '执行中调整待执行计划'].map((x) => `<div class="rowx"><span class="ic idle">${I('lock')}</span><div class="grow">${x}</div></div>`).join('')}</div>
          <div class="foot-note" style="margin-top:8px">${I('info', 'sm')}要改要求，请从<a href="${PEN.url('templates.html')}" style="color:var(--accent)">模板任务</a>新建；本实例保持不变。权限审批与安全输入照常，不等于可改执行配置。</div></div>
        <div class="sec"><div class="sec-h"><h3 class="grow">可以做的事</h3></div><ol class="steps4"><li class="${isPW() || S === 'b08' ? 'done' : 'cur'}"><span class="n">${isPW() || S === 'b08' ? I('check') : 1}</span><div><div>确认计划</div><div class="s">固定步骤的精确范围</div></div></li><li class="${isPW() ? 'cur' : S === 'b08' ? 'done' : ''}"><span class="n">${S === 'b08' ? I('check') : 2}</span><div><div>准备独立工作区</div><div class="s">与普通任务同一准备区（右侧“工作区”页签）</div></div></li><li class="${S === 'b08' ? 'cur' : ''}"><span class="n">3</span><div><div>开始执行</div><div class="s">准备成功后单独启动；开始后步骤仍锁定</div></div></li></ol></div>`;
    }
    const nm = (id) => (T.steps.find((x) => x.id === id) || {}).title;
    const cov = `<table class="cov"><thead><tr><th>需求</th><th>步骤</th></tr></thead><tbody>${T.items.map((it) => `<tr><td><span class="k">${it.k}</span><br>${esc(it.text)}</td><td>${T.steps.filter((x) => (x.req || []).includes(it.k)).map((x) => `<button class="btn ghost sm" data-focus="${x.id}" style="height:24px;padding:0 6px;font-size:12px">${esc(x.title)}</button>`).join('<br>')}</td></tr>`).join('')}</tbody></table>`;
    const exec = S === 'b08' ? `<div class="sec"><div class="sec-h"><h3 class="grow">需求追踪（执行后）</h3><span class="cnt">${Object.values(EXEC).filter((x) => x === 'done').length ? Object.values(EXEC).filter((x) => x === 'done').length + ' 步已有验收证据' : '执行开始 · 尚无验收证据'}</span></div><div class="foot-note">${I('info', 'sm')}执行结果只取步骤当前有效且验收通过的结果；未执行的不预造产物。工作包、尝试与产出在任务画布与节点详情。</div><button class="btn secondary sm" data-act="open-task" style="margin-top:10px">${I('play', 'sm')}打开任务画布</button></div>` : '';
    return `${exec}<div class="sec"><div class="sec-h"><h3 class="grow">计划 · 修订 ${T.planRev}</h3><span class="cnt">${isPW() || S === 'b08' ? '已确认' : '未确认'} · ${isLarge() ? 'AI 规划 · 总览 + 3 轮分组细化' : '旧版流程'}</span></div><div class="box">${T.steps.map((x) => `<button class="rowx" data-focus="${x.id}"><span class="ic idle">${I('layers')}</span><div class="grow"><div class="t">${esc(x.title)}</div><div class="s">${esc(x.role)} · ${esc(x.output)}${isLarge() ? ' · ' + esc(lgName(x.group)) : ''}</div></div></button>`).join('')}</div>
        <div class="foot-note" style="margin-top:8px">${I('info', 'sm')}${isLarge() ? '总览（第 1 轮）与 3 轮分组细化分别应用，确认的是整份计划修订 ' + T.planRev + '；分组只是展示，不是调度屏障。' : `来自旧需求目录 <span class="mono">${esc(T.rqId || '')}</span>，迁入新版需求画布后身份不变；没有 AI 规划轮次与规划记录。`}</div></div>
      <div class="sec"><div class="sec-h"><h3 class="grow">需求覆盖</h3><span class="cnt">${T.items.length} 条</span></div>${cov}</div>`;
  }
  function coverageTable() {
    const map = { R1: [['n3', 'n5'], '状态筛选返回正确集合'], R2: [['n3', 'n5'], '日期范围筛选边界正确'], R3: [['n4', 'n5'], '导出内容与筛选结果一致'], C1: [['n3', 'n4', 'n6'], '返回字段快照比对无差异'], C2: [['n3', 'n7'], '空状态与历史日期可筛选'] };
    const nm = (id) => PEF.candidate(T).nodes.find((n) => n.id === id)?.title;
    return `<table class="cov"><thead><tr><th>需求</th><th>步骤</th><th>验收条款</th></tr></thead><tbody>${T.items.map((it) => `<tr><td><span class="k">${it.k}</span><br>${esc(it.text)}</td><td>${map[it.k][0].map((id) => `<button class="btn ghost sm" data-focus="${id}" style="height:24px;padding:0 6px;font-size:12px">${esc(nm(id))}</button>`).join('<br>')}</td><td>${esc(map[it.k][1])}</td></tr>`).join('')}</tbody></table>
      <div class="foot-note" style="margin-top:8px">${I('info', 'sm')}未映射的原文区段：无。执行后的结果与证据在真实执行后才会填入，不预造产物。</div>`;
  }
  function traceHTML() {
    const nm = (id) => PEF.candidate(T).nodes.find((n) => n.id === id)?.title;
    const res = {}; ['n1', 'n2', 'n3', 'n4', 'n5', 'n6', 'n7', 'n8'].forEach((id) => { const x = EXEC[id]; res[id] = x === 'done' ? ['ok', '已验收', id === 'n3' ? '验收报告 #ev-3a1 · 尝试 #2' : '验收报告 · 尝试 #1'] : x === 'run' ? ['run', '执行中', '尝试 #1 进行中'] : ['idle', '待执行', '']; });
    const withEv = T.items.filter((it) => ({ R1: ['n3', 'n5'], R2: ['n3', 'n5'], R3: ['n4', 'n5'], C1: ['n3', 'n4', 'n6'], C2: ['n3', 'n7'] })[it.k].some((id) => res[id][0] === 'ok')).length;
    const map = { R1: ['n3', 'n5'], R2: ['n3', 'n5'], R3: ['n4', 'n5'], C1: ['n3', 'n4', 'n6'], C2: ['n3', 'n7'] };
    const crit = { R1: '状态筛选返回正确集合', R2: '日期范围筛选边界正确', R3: '导出内容与筛选结果一致', C1: '返回字段快照比对无差异', C2: '空状态与历史日期可筛选' };
    const ic = { ok: ['ok', 'check'], run: ['run', 'play'], idle: ['idle', 'clock'] };
    return `<div class="sec"><div class="sec-h"><h3 class="grow">需求追踪（执行后）</h3><span class="cnt">${withEv}/5 条已有验收证据</span></div>
      <table class="cov"><thead><tr><th>需求</th><th>验收条款</th><th>步骤 · 执行结果 / 证据</th></tr></thead><tbody>${T.items.map((it) => `<tr><td><span class="k">${it.k}</span><br>${esc(it.text)}</td><td>${esc(crit[it.k])}</td><td>${map[it.k].map((id) => { const r = res[id]; return `<div class="row" style="gap:6px;align-items:flex-start;margin-bottom:6px"><span class="ic ${ic[r[0]][0]}" style="width:18px;height:18px;border-radius:50%;display:grid;place-items:center;flex:none">${I(ic[r[0]][1], 'sm')}</span><span class="grow"><button class="btn ghost sm" data-focus="${id}" style="height:22px;padding:0 4px;font-size:12px">${esc(nm(id))}</button><br><span class="muted" style="font-size:11.5px">${r[1]}${r[2] ? ' · ' + r[2] : ''}</span>${r[0] === 'ok' ? ` <button class="btn ghost sm" data-act="open-pkg" style="height:22px;padding:0 6px;font-size:11.5px">查看工作包</button>` : ''}</span></div>`; }).join('')}</td></tr>`).join('')}</tbody></table>
      <div class="foot-note" style="margin-top:8px">${I('info', 'sm')}执行结果只取步骤“当前有效且验收通过”的结果；未执行的不预造产物。工作包、尝试与产出在任务画布与节点详情（原主稿“澄清与规划面板”的工作包页签已归到执行侧）。</div></div>
      <div class="sec"><div class="sec-h"><h3 class="grow">规划依据</h3></div><div class="box"><div class="rowx"><span class="ic ok">${I('check')}</span><div class="grow"><div class="t">第 2 轮候选 · 已应用并确认</div><div class="s">需求输入修订 2 · 规划策略 v1 · 计划修订 3 · 确认 14:21</div></div></div></div></div>`;
  }
  function largeHTML(c) {
    const L = PEF.LARGE, done = lgDone(), left = lgLeft();
    if (S === 'lg-cand') return lgCandHTML();
    if (S === 'lg-planning') { const gp = lgGp(); return `<div class="sec"><div class="sec-h"><h3 class="grow">本轮范围</h3><span class="cnt">第 ${lgRound()} 轮</span></div><div class="box"><div class="rowx"><span class="ic run"><span class="spin" style="width:10px;height:10px"></span></span><div class="grow"><div class="t">${esc(lgName(gp))}</div><div class="s">覆盖 ${L.cover[gp].join('、')} · 规划中 · 生成候选</div></div></div></div>
      <dl class="mini-kv" style="margin-top:10px"><dt>边界</dt><dd>只在该组内新增叶子步骤；与其他组的依赖按总览连线保留</dd><dt>次数</dt><dd>本轮最多 2 次派发：初稿 1 + 修订 1</dd><dt>草稿</dt><dd>计划修订 ${lgRev()} 不变，候选出来后由你审阅、应用</dd></dl>
      <div class="foot-note" style="margin-top:8px">${I('info', 'sm')}停止只影响这一轮：已细化的组与当前草稿都保留。</div></div>${groupListHTML(done, left)}`; }
    return groupListHTML(done, left) + `<div class="sec"><div class="sec-h"><h3 class="grow">本期能力上限</h3></div><dl class="mini-kv"><dt>节点</dt><dd>已用 ${L.leafCount(done)} / 上限 20${left.length ? `（全部细化后约 18）` : ''}</dd><dt>分组</dt><dd>6 / 8</dd><dt>细化深度</dt><dd>≤ 2</dd><dt>轮次</dt><dd>总览 1 轮 + 每组 1 轮；每轮各有 1 次修订机会</dd><dt>规划依据</dt><dd>${basisHTML()}</dd></dl><div class="foot-note" style="margin-top:8px">${I('alert', 'sm')}预计超过 20 个节点时，需要你明确把本期目标与后续待办分开（形成新的需求修订并重新审阅覆盖）；不会自动丢弃剩余需求。</div></div>
      <div class="sec"><div class="sec-h"><h3 class="grow">需求覆盖</h3><span class="cnt">${PEF.LARGE.items.length} 条 · ${left.length ? left.reduce((n, g) => n + L.cover[g].length, 0) + ' 条待细化' : '全部有叶子步骤'}</span></div><table class="cov"><thead><tr><th>需求</th><th>分组 · 状态</th></tr></thead><tbody>${L.items.map(([k, kind, text]) => { const g = Object.keys(L.cover).find((x) => L.cover[x].includes(k)); const ok = !L.UNREFINED.includes(g) || done.includes(g); return `<tr><td><span class="k">${k}</span><br>${esc(text)}</td><td>${esc(lgName(g))}<br><span class="muted" style="font-size:11.5px">${ok ? '已细化 · 有步骤与验收' : '未细化 · 尚无步骤'}</span></td></tr>`; }).join('')}</tbody></table></div>`;
  }
  function groupListHTML(done, left) {
    const L = PEF.LARGE, busy = S === 'lg-planning' ? lgGp() : null, cand = S === 'lg-cand' ? lgGp() : null;
    return `<div class="sec"><div class="sec-h"><h3 class="grow">分组与细化状态</h3><span class="cnt">6 组 · ${left.length ? left.length + ' 组未细化' : '全部已细化'}</span></div><div class="box">${L.groups.map((g) => {
      const unref = L.UNREFINED.includes(g.id) && !done.includes(g.id), k = done.indexOf(g.id);
      const meta = k >= 0 ? `已细化 · ${L.refine[g.id].nodes.length} 步 · 第 ${k + 2} 轮` : busy === g.id ? '规划中 · 第 ' + lgRound() + ' 轮' : cand === g.id ? '候选待审阅 · 第 ' + lgRound() + ' 轮' : g.meta;
      const icon = unref ? (busy === g.id ? `<span class="ic run"><span class="spin" style="width:10px;height:10px"></span></span>` : cand === g.id ? `<span class="ic wait">${I('eye')}</span>` : '<span class="ic unk">?</span>') : `<span class="ic ok">${I('check')}</span>`;
      const act = unref && S === 'pe37' ? `<button class="btn secondary sm" data-act="refine-scope" data-grp="${g.id}">继续规划选区</button>` : unref ? '' : `<button class="btn ghost sm" data-toggle-grp="${g.id}">${isCollapsed(g.id) ? '展开' : '折叠'}</button>`;
      return `<div class="rowx">${icon}<div class="grow"><div class="t">${esc(g.title)}</div><div class="s">${esc(meta)}</div></div>${act}</div>`; }).join('')}</div>
      <div class="foot-note" style="margin-top:8px">${I('info', 'sm')}分组只是展示与范围索引，不是执行节点，也不是调度屏障；已细化的组不会先执行，全部细化并确认后才开始。</div></div>`;
  }
  function lgCandHTML() {
    const L = PEF.LARGE, gp = lgGp(), r = L.refine[gp];
    return `<div class="sec"><div class="sec-h"><h3 class="grow">候选相对当前草稿</h3><span class="cnt">计划修订 ${lgRev()} → ${lgRev() + 1}（应用后）</span></div>
      <div class="sum-grid"><div class="c"><b>${r.nodes.length}</b><span>新增步骤</span></div><div class="c"><b>1</b><span>替换“未细化”占位</span></div><div class="c"><b>0</b><span>改动组外步骤</span></div></div>
      <div class="box" style="margin-top:8px">${r.nodes.map((n) => `<button class="rowx" data-focus="${n.id}"><span class="ic run">${I('plus')}</span><div class="grow"><div class="t">${esc(n.title)}</div><div class="s">${esc(n.role)} · ${esc(n.meta)} · 覆盖 ${n.req.join('、')}</div></div>${I('chevRight', 'sm')}</button>`).join('')}</div>
      <div class="foot-note" style="margin-top:8px">${I('info', 'sm')}差异由服务对当前草稿与编译后的候选计算；组外步骤没有改动，跨组依赖按总览连线接入（${r.edges.filter(([a, b]) => !r.nodes.some((n) => n.id === a) || !r.nodes.some((n) => n.id === b)).map(([a, b]) => esc((L.nodes.concat(r.nodes).find((n) => n.id === a) || {}).title) + ' → ' + esc((L.nodes.concat(r.nodes).find((n) => n.id === b) || {}).title)).join('、')}）。</div></div>
      <div class="sec"><div class="sec-h"><h3 class="grow">本轮</h3><span class="cnt">第 ${lgRound()} 轮</span></div><dl class="mini-kv"><dt>检查</dt><dd>${esc(r.checks)}</dd><dt>修订</dt><dd>0 / 1 已用（本轮还有 1 次修订机会；每次继续规划选区都是新的一轮）</dd><dt>用量</dt><dd>${esc(r.cost)}（已结账）</dd><dt>节点</dt><dd>应用后 ${L.leafCount(lgDone()) + r.nodes.length} / 20</dd></dl></div>
      <div class="foot-note" style="margin-top:18px">${I('info', 'sm')}应用只写入未确认的草稿，不会执行；全部分组细化后，才能确认整份计划。</div>`;
  }
  function nodeHTML(c) {
    const id = ui.sel;
    if (LARGE_MODE()) {
      const L = PEF.LARGE, all = L.nodes.concat(...Object.values(L.refine).map((r) => r.nodes)), n = all.find((x) => x.id === id) || {};
      const b = L.base[id], req = n.req || (b ? b.slice(0, -1) : []), what = n.what || (b ? b[b.length - 1] : '尚未细化：这是分组占位，不是可执行步骤。');
      const isCand = S === 'lg-cand' && n.group === lgGp() && !Object.values(L.PH).includes(id);
      return `<button class="btn ghost sm" data-act="unsel">${I('chevLeft', 'sm')}返回</button><div class="nd-h" style="margin-top:10px"><h3 class="grow">${esc(n.title || id)}</h3>${isCand ? '<span class="badge st-wait">候选 · 新增</span>' : Object.values(L.PH).includes(id) ? '<span class="badge st-unknown">未细化</span>' : '<span class="badge st-done">已细化</span>'}</div>
        <dl class="mini-kv" style="margin-top:12px">${n.role ? `<dt>职业</dt><dd>${esc(n.role)}</dd><dt>产出</dt><dd>${esc(n.meta || '')}</dd>` : ''}<dt>做什么</dt><dd>${esc(what)}</dd><dt>分组</dt><dd>${esc(lgName(n.group))}</dd>${req.length ? `<dt>覆盖</dt><dd>${req.join('、')}</dd>` : ''}</dl>
        <div class="foot-note" style="margin-top:10px">${I('info', 'sm')}${isCand ? '候选步骤只读；应用后写入未确认的草稿。' : '计划步骤在全部分组细化并确认后才会执行。'}</div>`;
    }
    if (special()) {
      const n = isFixed() ? (() => { const i = +id.slice(1) - 1; const x = T.tpl.steps[i]; return x && { title: x[0], role: x[1], output: x[2], what: `模板“${T.tpl.name}”的固定步骤：${x[0]}。`, w: x[3] }; })() : T.steps.find((x) => x.id === id);
      if (!n) return `<button class="btn ghost sm" data-act="unsel">${I('chevLeft', 'sm')}返回</button>`;
      return `<button class="btn ghost sm" data-act="unsel">${I('chevLeft', 'sm')}计划</button><div class="nd-h" style="margin-top:10px"><h3 class="grow">${esc(n.title)}</h3>${isFixed() ? `<span class="badge st-idle">${I('lock', 'sm')}固定</span>` : ''}</div>
        <dl class="mini-kv" style="margin-top:12px"><dt>职业</dt><dd>${esc(n.role)}${isFixed() ? '（模板指定）' : ''}</dd><dt>产出</dt><dd>${esc(n.output)}</dd><dt>做什么</dt><dd>${esc(n.what)}</dd>${isFixed() ? `<dt>读写</dt><dd>${n.w === 'ro' ? '只读' : '写任务工作区'}</dd><dt>验收</dt><dd>模板最低验收，不能修改</dd>` : `<dt>需求</dt><dd>${(n.req || []).join('、')}</dd>`}</dl>
        ${isFixed() ? `<div class="banner" style="margin-top:12px;font-size:12.5px">${I('lock', 'sm')}<span>该任务使用固定模板，创建后不能修改步骤；要改要求，请从“模板任务”新建。</span></div>` : ''}`;
    }
    const sk = PEF.SKELETON.nodes.find((n) => n.id === id);
    if (sk) return `<button class="btn ghost sm" data-act="unsel">${I('chevLeft', 'sm')}返回</button><div class="nd-h" style="margin-top:10px"><h3 class="grow">${esc(sk.title)}</h3><span class="badge outline">方法骨架</span></div><dl class="mini-kv" style="margin-top:12px"><dt>来源</dt><dd>${esc(T.method)} 的必经步骤（复制，未调用模型）</dd><dt>职业</dt><dd>${esc(sk.role)}</dd><dt>可细化</dt><dd>${['s3', 's4'].includes(id) ? '是 · 每步 ≤ 4 个子步骤' : '否'}</dd></dl>`;
    const n = PEF.candidate(T).nodes.find((x) => x.id === id); const d = DET[id];
    if (!n || !d) return `<button class="btn ghost sm" data-act="unsel">${I('chevLeft', 'sm')}返回</button>`;
    const D = n.diff && (['compare'].includes(c.layer)) ? PECanvas.DIFF[n.diff] : null;
    const iss = issues(c).filter((x) => x.nodes.includes(id));
    const reqT = (k) => T.items.find((x) => x.k === k);
    return `<button class="btn ghost sm" data-act="unsel">${I('chevLeft', 'sm')}${S === 'pe31' || isPW() ? '计划' : '候选摘要'}</button>
      <div class="nd-h" style="margin-top:10px"><h3 class="grow">${esc(n.title)}</h3>${D ? `<span class="badge ${D[1]}">${I(D[2], 'sm')}${D[0]}</span>` : ''}</div>
      <div class="muted" style="font-size:12.5px;margin-top:4px">${esc(n.role)} · 方法归属：${esc(d.step)} · 分组：${esc(PEF.GROUPS.find((g) => g.id === n.group)?.title || '')}</div>
      ${iss.map((x) => `<div class="banner ${x.sev === 'block' ? 'danger' : 'warn'}" style="margin-top:10px;font-size:12.5px;padding:9px 12px">${I('alert', 'sm')}<span><b>${esc(x.title)}</b><br>${esc(x.fix)}</span></div>`).join('')}
      ${d.diffNote && D ? `<div class="banner info" style="margin-top:10px;font-size:12.5px;padding:9px 12px">${I('edit', 'sm')}<span>${esc(d.diffNote)}</span></div>` : ''}
      <div class="sec" style="margin-top:16px"><div class="sec-t">任务</div><p style="font-size:13.5px;line-height:1.65;color:var(--ink-2)">${esc(d.task)}</p></div>
      <div class="sec"><div class="sec-t">来源需求</div><div class="box">${d.req.map((k) => `<div class="rowx"><span class="tagx mono">${k}</span><div class="grow">${esc(reqT(k)?.text)}<div class="s">原文第 ${reqT(k).span[0] + 1}–${reqT(k).span[1]} 字</div></div></div>`).join('')}</div></div>
      <div class="sec"><div class="sec-t">为什么在这里（依赖与原因）</div><div class="box">${d.why.map(([k, from, what]) => `<div class="rowx"><span class="tagx">${{ data: '数据', prerequisite: '前置', ordering: '顺序', resource: '资源' }[k]}</span><div class="grow">${esc(from)}<div class="s">${esc(what)}</div></div></div>`).join('')}${S === 'pe27' && id === 'n4' ? `<div class="rowx"><span class="tagx block">循环</span><div class="grow">接口测试 → 本步骤<div class="s">与“本步骤 → 接口测试”构成环</div></div></div>` : ''}</div></div>
      <div class="sec"><div class="sec-t">输入 → 本步骤</div><ul class="io-l">${d.inputs.map(([f, p, t]) => `<li><span class="a">${esc(f)} <span class="mono">${esc(p)}</span></span><span class="ar">${I('arrowRight', 'sm')}</span><span class="b mono">${esc(t)}</span></li>`).join('')}${S === 'pe27' && id === 'n5' ? `<li><span class="a">（无来源）</span><span class="ar">${I('arrowRight', 'sm')}</span><span class="b bad mono">/api-contract 必需 · 未绑定</span></li>` : ''}</ul>
        <div class="sec-t" style="margin-top:12px">输出</div><div class="row" style="flex-wrap:wrap;gap:6px">${d.outputs.map((o) => `<span class="chip mono">${esc(o)}</span>`).join('')}<span class="muted" style="font-size:12px">待产出槽位，执行后才有结果</span></div></div>
      <div class="sec"><div class="sec-t">验收条款</div><ul class="io-l" style="gap:4px">${d.criteria.map((x) => `<li style="grid-template-columns:16px minmax(0,1fr)"><span class="ar">${I('check', 'sm')}</span><span style="color:var(--ink-2)">${esc(x)}</span></li>`).join('')}</ul></div>
      <div class="sec"><div class="sec-t">读写资源</div><ul class="res-l">${d.res.map(([a, p, b]) => `<li><span class="acc ${a}">${a === 'w' ? '写' : '读'}</span><span class="mono grow" style="font-size:12px">${esc(p)}</span><span class="muted" style="font-size:11.5px">${esc(b)}</span></li>`).join('') || '<li class="muted">无（人工步骤）</li>'}${S === 'pe27' && id === 'n3' ? `<li><span class="acc w">写</span><span class="mono grow" style="font-size:12px;color:var(--danger)">db/schema/${esc(T.pkg)}.sql</span><span style="font-size:11.5px;color:var(--danger)">超出授权</span></li>` : ''}</ul></div>
      <details class="adv" style="margin-top:16px"><summary>${I('chevRight', 'sm')}版本与依据</summary><div class="body">职业：${esc(n.role)} · revision 由目录分配<br>任务类型：<span class="mono">${esc(d.type)}</span><br>候选键：<span class="mono">${esc(id)}</span>（正式节点 ID 由服务分配）<br>方法策略：需求开发 r12 · policyHash 1111…1111<br>规划依据：${basisHTML()}<br>依据：${d.res.filter((r) => r[2].startsWith('已读')).map((r) => `<span class="mono">${esc(r[1])}</span>`).join('、') || '—'}（sha256 见规划记录）</div></details>`;
  }
  function issues(c) {
    if (c.check === 'block') return [
      { sev: 'block', code: 'GRAPH_CYCLE', title: '循环依赖：导出 CSV 接口 ⇄ 接口测试', nodes: ['n4', 'n6'], fix: '去掉其中一条依赖；循环不支持。' },
      { sev: 'block', code: 'IO_REQUIRED_UNBOUND', title: '必需输入未绑定：前端筛选栏与导出按钮 /api-contract', nodes: ['n5'], fix: '需要来自“方案设计”的接口约定；没有来源不能执行。' },
      { sev: 'block', code: 'EVIDENCE_MISSING', title: `引用不存在：docs/api/${T.pkg}.md 第 120–140 行`, nodes: ['n4'], fix: '该文件只有 96 行；依据定位与读取记录不符。' },
      { sev: 'block', code: 'RESOURCE_OUT_OF_SCOPE', title: `写入超出授权：db/schema/${T.pkg}.sql`, nodes: ['n3'], fix: '本任务授权为只读该文件；不能通过规划扩权。' },
    ];
    if (c.check === 'conflict') return [{ sev: 'block', code: 'RESOURCE_CONFLICT', title: `并行写冲突：导出 CSV 接口 与 前端筛选栏与导出按钮 都写 web/src/api/${T.pkg}.ts`, nodes: ['n4', 'n5'], fix: '两步互不依赖，会同时写同一文件。改为先后执行，或（后续分期）申请子隔离与汇合。' }];
    if (c.check === 'stale') return [{ sev: 'block', code: 'CANDIDATE_STALE', title: '候选基于旧输入、旧计划与旧依据', nodes: [], fix: '重新预览，按当前输入生成新一轮。' }];
    const bq = round() === 1 && READY.includes(S) && !ui.ansSaved ? BQ.map((q) => ({ sev: 'question', code: 'BUSINESS_QUESTION', title: q.t, nodes: q.nodes, fix: '需要你在“计划”页签明确回答；回答形成新的需求输入修订。' })) : [];
    if (bq.length && ['done'].includes(c.check)) return bq.concat(acks().map((a) => ({ sev: 'decision', code: 'NEEDS_REVIEW', title: a[1].replace(/<[^>]+>/g, ''), nodes: [a[3]], fix: a[2] })));
    if (['done', 'repair'].includes(c.check) || c.check === undefined) return c.check === 'repair' ? [{ sev: 'warning', code: 'IO_REQUIRED_UNBOUND', title: '必需输入未绑定（修订中）', nodes: ['n5'], fix: '修订 1/1 正在处理。' }] : (c.check ? acks().map((a) => ({ sev: 'decision', code: 'NEEDS_REVIEW', title: a[1].replace(/<[^>]+>/g, ''), nodes: [a[3]], fix: a[2] })) : []);
    return [];
  }
  function checkHTML(c) {
    if (LARGE_MODE()) {
      const left = lgLeft();
      if (S === 'lg-cand') return `<div class="layers4"><div class="c pass"><div class="k">结构检查（本组候选）</div><div class="v">${I('check', 'sm')}通过</div></div><div class="c pass"><div class="k">需求覆盖</div><div class="v">${I('check', 'sm')}${PEF.LARGE.cover[lgGp()].join('、')} 已映射</div></div><div class="c ${left.length > 1 ? 'fail' : 'pass'}"><div class="k">可确认性（应用后）</div><div class="v">${I(left.length > 1 ? 'x' : 'check', 'sm')}${left.length > 1 ? '还有 ' + (left.length - 1) + ' 组未细化' : '可以确认'}</div></div></div>`;
      if (!left.length) return `<div class="layers4"><div class="c pass"><div class="k">结构检查</div><div class="v">${I('check', 'sm')}通过</div></div><div class="c pass"><div class="k">需求覆盖</div><div class="v">${I('check', 'sm')}11 / 11</div></div><div class="c pass"><div class="k">可确认性</div><div class="v">${I('check', 'sm')}可以确认</div></div><div class="c review"><div class="k">执行准备</div><div class="v">${I('clock', 'sm')}需准备独立工作区</div></div></div>`;
      return `<div class="layers4"><div class="c pass"><div class="k">结构检查（已细化部分）</div><div class="v">${I('check', 'sm')}通过</div></div><div class="c fail"><div class="k">可确认性</div><div class="v">${I('x', 'sm')}${left.length} 组未细化</div></div></div><div class="sec" style="margin-top:16px"><div class="box"><div class="rowx"><span class="ic no">${I('x')}</span><div class="grow"><div class="t">REQUIREMENT_UNCOVERED · 未细化范围</div><div class="s">${left.map((g) => esc(lgName(g)) + '（' + PEF.LARGE.cover[g].join('、') + '）').join('、')}还没有叶子步骤与验收。</div></div></div></div></div>`;
    }
    const L = {
      running: [['V1 协议', 'pass'], ['V2 图与方法', 'pass'], ['V3 配置与输入输出', 'run'], ['V4 需求覆盖', 'idle'], ['V5 依据', 'idle'], ['V6 可执行性', 'idle'], ['V7 并行与资源', 'idle'], ['V8 变更与确认', 'idle']],
      done: [['V1 协议', 'pass'], ['V2 图与方法', 'pass'], ['V3 配置与输入输出', 'pass'], ['V4 需求覆盖', 'review', '已全映射 · 语义需人工核对'], ['V5 依据', 'partial', '1 份截断'], ['V6 可执行性', 'setup', '需准备独立工作区'], ['V7 并行与资源', 'pass', '无交叉写入'], ['V8 变更与确认', 'pass']],
      repair: [['V1 协议', 'pass'], ['V2 图与方法', 'pass'], ['V3 配置与输入输出', 'fail', '1 个可自动修订'], ['V4 需求覆盖', 'idle'], ['V5 依据', 'idle'], ['V6 可执行性', 'idle'], ['V7 并行与资源', 'idle'], ['V8 变更与确认', 'idle']],
      block: [['V1 协议', 'pass'], ['V2 图与方法', 'fail', '循环'], ['V3 配置与输入输出', 'fail', '必需输入未绑定'], ['V4 需求覆盖', 'review'], ['V5 依据', 'fail', '引用不存在'], ['V6 可执行性', 'fail', '写入越权'], ['V7 并行与资源', 'pass'], ['V8 变更与确认', 'pass']],
      conflict: [['V1 协议', 'pass'], ['V2 图与方法', 'pass'], ['V3 配置与输入输出', 'pass'], ['V4 需求覆盖', 'review'], ['V5 依据', 'partial'], ['V6 可执行性', 'setup'], ['V7 并行与资源', 'fail', '1 处写写交集'], ['V8 变更与确认', 'pass']],
      stale: [['全部 8 层', 'stale', '基于旧输入，已失效']],
    }[c.check || 'done'];
    const ic = { pass: ['ok', 'check', '通过'], fail: ['no', 'x', '未通过'], run: ['run', null, '检查中'], idle: ['idle', 'clock', '未开始'], review: ['wait', 'eye', '需人工判断'], partial: ['unk', 'help', '部分'], setup: ['wait', 'clock', '需准备'], stale: ['unk', 'help', '已过期'] };
    const blocked = ['block', 'conflict', 'stale'].includes(c.check);
    const tiles = c.check === 'running' ? '' : `<div class="layers4"><div class="c ${blocked ? 'fail' : 'pass'}"><div class="k">结构检查</div><div class="v">${I(blocked ? 'x' : 'check', 'sm')}${blocked ? '未通过' : '通过'}</div></div><div class="c review"><div class="k">需人工判断</div><div class="v">${I('eye', 'sm')}${acks().length} 项</div></div><div class="c partial"><div class="k">依据</div><div class="v">${I('help', 'sm')}部分 · 1 份截断</div></div><div class="c review"><div class="k">执行准备</div><div class="v">${I('clock', 'sm')}需准备独立工作区</div></div></div>`;
    const iss = issues(c);
    return `${tiles}<div class="sec" style="margin-top:16px"><div class="sec-h"><h3 class="grow">检查层</h3><span class="cnt">${c.check === 'running' ? '按实际进度' : '14:09:05 完成'}</span></div><div class="box">${L.map(([n, s, note]) => `<div class="rowx"><span class="ic ${ic[s][0]}">${ic[s][1] ? I(ic[s][1]) : '<span class="spin" style="width:10px;height:10px"></span>'}</span><div class="grow"><div>${n}</div>${note ? `<div class="s">${note}</div>` : ''}</div><span class="muted" style="font-size:12px">${ic[s][2]}</span></div>`).join('')}</div>
      ${c.check === 'running' ? `<div class="foot-note" style="margin-top:8px">${I('info', 'sm')}没跑到的层写“未开始”，不预先打勾；候选在检查完成前只读。</div>` : ''}</div>
      ${iss.length && c.check !== 'running' ? `<div class="sec"><div class="sec-h"><h3 class="grow">${blocked ? '必须处理的问题' : '业务问题与需人工判断（在“计划”页签回答 / 核对）'}</h3><span class="cnt">${iss.length}</span></div><div class="box">${iss.map((x) => `<div class="rowx"><span class="ic ${x.sev === 'block' ? 'no' : 'wait'}">${I(x.sev === 'block' ? 'x' : x.sev === 'question' ? 'help' : 'eye')}</span><div class="grow"><div class="t">${esc(x.title)}</div><div class="s"><span class="mono">${x.code}</span> · ${esc(x.fix)}</div>${S === 'pe28' && !ui.serial ? `<div class="row" style="gap:8px;margin-top:8px;flex-wrap:wrap"><button class="btn secondary sm" data-act="serial">改为先后执行（形成新差异）</button><span class="dis-wrap" style="align-items:flex-start"><button class="btn ghost sm" data-act="isolate" aria-disabled="true" aria-describedby="isoR">申请子隔离与汇合</button><span class="dis-reason" id="isoR" style="text-align:left">未安装 · 后续分期</span></span></div>` : ''}</div>${x.nodes.length ? `<button class="btn ghost sm" data-focus="${x.nodes[0]}">定位</button>` : ''}</div>`).join('')}</div>${blocked && c.check !== 'stale' ? `<div class="foot-note" style="margin-top:8px">${I('lock', 'sm')}硬规则没有“忽略继续”。外部写入（数据库、HTTP）不会因为有独立工作区就被当作已隔离。</div>` : ''}</div>` : ''}`;
  }
  function planFoot(c) {
    if (LARGE_MODE()) {
      if (S === 'lg-planning') return `<div class="side-foot"><div class="reason">候选出来前不能应用；停止只影响这一轮</div></div>`;
      if (S === 'lg-cand') return `<div class="side-foot"><div class="btns"><button class="btn ghost" data-act="lg-reject">不采用</button><button class="btn primary wide lg" data-act="lg-apply">应用到草稿</button></div><div class="reason">应用不会执行；“${esc(lgName(lgGp()))}”变为已细化</div></div>`;
      const n = lgLeft().length;
      return n ? `<div class="side-foot"><span class="dis-wrap" style="align-items:stretch"><button class="btn primary lg" aria-disabled="true" aria-describedby="lgR" data-act="confirm">确认计划</button><span class="reason warn" id="lgR">还有 ${n} 个组未细化，不能确认执行</span></span></div>`
        : `<div class="side-foot"><div class="btns"><button class="btn primary wide lg" data-act="confirm">确认计划</button></div><div class="reason">确认不会调用模型，也不会立即执行</div></div>`;
    }
    if (S === 'fx01') return `<div class="side-foot"><div class="btns"><button class="btn primary wide lg" data-act="confirm" id="fxConfirm">确认计划</button></div><div class="reason">确认后在本页“工作区”准备独立工作区，再单独开始执行</div></div>`;
    if (isPW()) return `<div class="side-foot"><div class="reason">准备独立工作区与开始执行在“工作区”页签</div><div class="btns"><button class="btn secondary wide" data-act="to-ws">${I('folder', 'sm')}前往工作区</button></div></div>`;
    if (S === 'pe32') return `<div class="side-foot"><div class="sec-t" style="margin:0">接下来（最新任务隔离流程）</div><ol class="steps4"><li class="done"><span class="n">${I('check')}</span><div><div>形成需求草稿</div><div class="s">已形成</div></div></li><li class="done"><span class="n">${I('check')}</span><div><div>确认计划</div><div class="s">修订 3 · 14:21</div></div></li><li class="${ui.ws === 'ready' ? 'done' : 'cur'}"><span class="n">${ui.ws === 'ready' ? I('check') : 3}</span><div><div>准备独立工作区</div><div class="s">${ui.ws === 'ready' ? '已就绪 · task/' + T.id + '-filter-export' : ui.ws === 'busy' ? '准备中…（模拟）' : '创建任务分支与 worktree，原项目不变'}</div></div></li><li class="${ui.ws === 'ready' ? 'cur' : ''}"><span class="n">4</span><div><div>开始执行</div><div class="s">准备成功后单独启动</div></div></li></ol>
      <div class="btns">${ui.ws === 'ready' ? `<button class="btn primary wide lg" data-act="start-exec">${I('play')}开始执行</button>` : `<button class="btn primary wide lg" data-act="prepare" ${ui.ws === 'busy' ? 'aria-busy="true"' : ''}>${ui.ws === 'busy' ? '<span class="spin"></span>准备中…' : I('folder') + '准备独立工作区'}</button>`}</div><div class="reason">${ui.ws === 'ready' ? '开始执行按已确认计划领取第一批步骤' : '准备成功前不会运行任何写文件的步骤'}</div></div>`;
    if (S === 'pe31') return `<div class="side-foot"><div class="btns"><button class="btn primary wide lg" data-act="confirm">确认计划</button></div><div class="reason">确认不会调用模型，也不会立即执行</div></div>`;
    if (c.dismissedView) return '';
    if (!(READY.includes(S) || S === 'pe26')) return '';
    const A = acks(); const left = A.filter((a) => !ui.acks[a[0]]).length;
    const bqOff = round() === 1 && !['pe27', 'pe29'].includes(S) ? (!ui.ansSaved ? (bqAnswered() ? '业务答复尚未保存（保存后形成需求输入修订 2）' : `还有 ${BQ.filter((q) => !ui.ans[q.id]).length} 个业务问题未回答（必须明确回答，不能用勾选代替）`) : ui.reval === 'checking' ? '正在按输入修订 2 重新校验候选' : ui.reval === 'stale' ? '候选基于修订 1 的假设，与你的答复不一致，已过期' : null) : null;
    const off = c.applyOff || bqOff || (left ? `还有 ${left} 项需人工判断未核对` : null);
    return `<div class="side-foot"><div class="btns"><button class="btn secondary lg" data-act="reject" ${S === 'b05' ? 'aria-disabled="true"' : ''}>不采用</button>${off ? `<button class="btn primary wide lg" data-act="apply" aria-disabled="true" aria-describedby="applyR">应用到草稿</button>` : `<button class="btn primary wide lg" data-act="apply" ${ui.busy === 'apply' ? 'aria-busy="true"' : ''}>${ui.busy === 'apply' ? '<span class="spin"></span>请求中…' : '应用到草稿'}</button>`}</div><div class="reason ${off ? 'warn' : ''}" id="applyR">${off ? esc(off) : '应用只写入未确认草稿（计划修订 2 → 3），不会执行'}</div></div>`;
  }

  /* ================= 对话框 ================= */
  function openDialog(kind, trigger, opt = {}) {
    ui.dialog = kind; const d = $('#dlg'); const R = round();
    const prevRound = opt.newRound ? `<dt>上一轮</dt><dd>第 ${R} 轮（${{ pe11: '需要答复', pe12: '已达上限', pe20: '已停止', pe22: '失败', pe29: '候选已过期', pe13: '停止后' }[S] || '—'}）· 原账已结清<span class="hint">新一轮是新的模型调用，单独计费</span></dd>` : '';
    const input = opt.newRound || S === 'pe29' ? '需求原文 修订 1 · 补充 修订 2（导出上限、日期字段）' : '需求原文 修订 1' + (ui.supp ? ' · 补充（未保存的草稿不会带上）' : '');
    const scope = opt.scope ? `<dt>细化范围</dt><dd>分组“${esc(opt.scope)}”（第 ${lgRound()} 轮）<span class="hint">只在该组内生成叶子步骤；其他分组与当前草稿不变，跨组依赖按总览连线保留。每次继续规划选区是新的一轮，各有 1 次修订机会</span></dd>` : `<dt>细化范围</dt><dd>${ui.skeleton || !EMPTY.includes(S) ? '整个未启动草稿（计划修订 2 · 方法骨架）' : '空草稿 → 按方法生成完整计划'}</dd>`;
    const html = {
      preview: `<div class="dialog-body"><h2 id="dlgT">${opt.scope ? '继续规划选区 · 预览' : opt.newRound ? '预览新一轮规划' : '开始规划前，请确认'}</h2>
        <p>确认后才会调用模型。规划只生成候选：不会修改当前草稿，候选需要你审阅、应用、再确认计划。</p>
        <dl class="kv"><dt>项目</dt><dd>${esc(T.project)} · ${esc(T.baseline)}<span class="hint">只读捕获已授权的 3 份资料；不创建执行工作区</span></dd>
        <dt>输入</dt><dd>${input}</dd>${prevRound}${scope}
        ${opt.newRound ? `<dt>配置</dt><dd>沿用第 ${R} 轮：方法、规划策略、模型、预算上限<span class="hint">默认带上（原“沿用本轮配置”）；要改请到设置或“需求与输入”</span></dd>` : ''}
        <dt>方法</dt><dd>${esc(T.method)} · 规划策略 v1<span class="hint">必经步骤与最低验收不可弱化；只能用目录里已发布的职业 / 任务类型</span></dd>
        <dt>模型</dt><dd>DeepSeek V4<span class="hint">来自当前设置；不会自动换更贵的模型</span></dd>
        <dt>次数</dt><dd>最多 2 次派发：初稿 1 + 修订 1 · 自动传输重试 0</dd>
        <dt>时限</dt><dd>本轮总 15 分钟，单次 ≤ 8 分钟<span class="hint">截止时刻从确认开始计算；重启不会延长</span></dd>
        <dt>预算</dt><dd>本轮上限 2.00 元，确认后预留<span class="hint">实际用量按模型服务计量；未明部分不会显示为 0</span></dd>
        <dt>上限</dt><dd>节点 ≤ 20 · 依赖 ≤ 50 · 分组 ≤ 8 · 细化深度 ≤ 2</dd></dl>
        <div class="banner info">${I('info', 'sm')}<span>可以离开页面，规划不会停止；任务列表会显示进度。预览有效至 14:12，过期需重新预览。</span></div></div>
        <div class="dialog-foot"><button class="btn ghost" data-dlg="cancel">返回</button><button class="btn primary" data-dlg="start">确认开始规划</button></div>`,
      lgapply: `<div class="dialog-body"><h2 id="dlgT">把第 ${lgRound()} 轮候选应用到草稿？</h2><p>“${esc(lgName(lgGp()))}”的 ${S === 'lg-cand' ? PEF.LARGE.refine[lgGp()].nodes.length : 0} 个步骤会写入<b class="ink">未确认的草稿</b>（计划修订 ${lgRev()} → ${lgRev() + 1}），替换该组的“未细化”占位；组外步骤不变。应用不会执行任何步骤。</p>${lgLeft().length > 1 ? `<div class="banner info">${I('info', 'sm')}<span>应用后还有 ${lgLeft().length - 1} 个组未细化，仍不能确认计划；已细化的组不会先执行。</span></div>` : `<div class="banner ok">${I('check', 'sm')}<span>这是最后一个未细化的组：应用后可以确认整份计划。</span></div>`}</div>
        <div class="dialog-foot"><button class="btn ghost" data-dlg="cancel">再看看</button><button class="btn primary" data-dlg="lgapply">应用到草稿</button></div>`,
      lgreject: `<div class="dialog-body"><h2 id="dlgT">不采用“${esc(lgName(lgGp()))}”的候选？</h2><p>当前草稿保持不变，该组仍未细化；候选、检查与记录保留在历史里。之后可以再次“继续规划选区”（新的一轮）。</p></div>
        <div class="dialog-foot"><button class="btn ghost" data-dlg="cancel">取消</button><button class="btn danger" data-dlg="lgreject">不采用</button></div>`,
      lgstop: `<div class="dialog-body"><h2 id="dlgT">停止第 ${lgRound()} 轮规划？</h2><p>只停止“${esc(lgName(lgGp()))}”这一轮，<b class="ink">不影响已细化的分组与当前草稿</b>。服务确认原调用停稳、用量结账后才显示“已停止”。</p></div>
        <div class="dialog-foot"><button class="btn ghost" data-dlg="cancel">继续规划</button><button class="btn danger" data-dlg="lgstop">停止本轮规划</button></div>`,
      stop: `<div class="dialog-body"><h2 id="dlgT">停止第 ${R} 轮规划？</h2><p>只停止这一轮规划，<b class="ink">不影响任何业务步骤</b>。已有记录、部分草稿与用量都会保留。停止是“请求”：服务确认原进程停稳、用量结账后才显示“已停止”；在此之前不能开始新一轮。</p>${opt.replan ? '<div class="banner info">' + I('info', 'sm') + '<span>停稳并核对原账后，会打开“预览新一轮”，带上你保存的输入修订 2。</span></div>' : ''}</div>
        <div class="dialog-foot"><button class="btn ghost" data-dlg="cancel">继续规划</button><button class="btn danger" data-dlg="stop">停止本轮规划</button></div>`,
      apply: `<div class="dialog-body"><h2 id="dlgT">把第 ${R} 轮候选应用到草稿？</h2><p>候选会写入<b class="ink">未确认的草稿</b>（计划修订 2 → 3）：新增 5 步、修改 2 步、细化替换 2 步。应用不会执行任何步骤；之后你可以继续手改，再<b class="ink">确认计划</b>。</p>
        ${round() === 1 ? `<div class="sub-h">业务决定（你明确回答 · 需求输入修订 2）</div><ul style="margin:0 0 8px;padding-left:18px;font-size:13px;color:var(--ink-2);line-height:1.7">${BQ.map((q) => `<li>${esc(q.t)} → ${esc(bqLabel(q, ui.ans[q.id]))}</li>`).join('')}</ul>` : `<div class="sub-h">业务决定（需求输入修订 2）</div><ul style="margin:0 0 8px;padding-left:18px;font-size:13px;color:var(--ink-2);line-height:1.7">${BQ.map((q) => `<li>${esc(q.t)} → ${esc(bqLabel(q, q.suggest))}</li>`).join('')}</ul>`}
        <div class="sub-h">将随应用记录的风险核对（你 · 本轮版本；不改变业务范围）</div><ul style="margin:0;padding-left:18px;font-size:13px;color:var(--ink-2);line-height:1.7">${acks().map((a) => `<li>${a[1].replace(/<[^>]+>/g, '')}</li>`).join('')}</ul></div>
        <div class="dialog-foot"><button class="btn ghost" data-dlg="cancel">再看看</button><button class="btn primary" data-dlg="apply">应用到草稿</button></div>`,
      chg: `<div class="dialog-body"><h2 id="dlgT">修改业务答复？</h2><p>修改会形成<b class="ink">需求输入修订 3</b>。当前第 ${R} 轮候选基于修订 2，会被标为过期、不能应用；修订 2、第 ${R} 轮输入与记录都保留，不回写旧轮。之后按修订 3 预览新一轮。</p></div>
        <div class="dialog-foot"><button class="btn ghost" data-dlg="cancel">不修改</button><button class="btn primary" data-dlg="chg">修改答复</button></div>`,
      reject: `<div class="dialog-body"><h2 id="dlgT">不采用第 ${R} 轮候选？</h2><p>当前草稿保持不变；候选、检查报告与记录都保留在历史里。“不采用”不是删除，也不能用来撤回已经应用的改动。</p></div>
        <div class="dialog-foot"><button class="btn ghost" data-dlg="cancel">取消</button><button class="btn danger" data-dlg="reject">不采用</button></div>`,
      confirm: isFixed() ? `<div class="dialog-body"><h2 id="dlgT">确认固定模板计划？</h2><p>确认<b class="ink">不调用模型、不执行</b>。确认后在本页“工作区”准备独立工作区，成功后再单独开始执行；步骤始终锁定。</p>
        <dl class="kv"><dt>模板</dt><dd>${esc(T.tpl.name)} · <span class="mono">${esc(T.tpl.ref)}@r${T.tpl.rev}</span></dd><dt>步骤</dt><dd>${T.tpl.steps.length} 个固定步骤：${T.tpl.steps.map((x) => esc(x[0])).join(' → ')}</dd><dt>入口参数</dt><dd>${T.tpl.params.map(([k, v]) => `${esc(k)} <span class="mono">${esc(v)}</span>`).join('<br>')}</dd><dt>验收</dt><dd>模板最低验收（不能弱化）</dd></dl></div>
        <div class="dialog-foot"><button class="btn ghost" data-dlg="cancel">再看看</button><button class="btn primary" data-dlg="confirm">确认计划</button></div>`
      : isLarge() ? `<div class="dialog-body"><h2 id="dlgT">确认计划修订 ${lgRev()}？</h2><p>确认<b class="ink">不调用模型、不执行</b>。确认后在本页“工作区”准备独立工作区，成功后再单独开始执行。</p>
        <dl class="kv"><dt>步骤</dt><dd>${PEF.LARGE.leafCount(lgDone())} 步 · 6 个分组（分组只是展示）</dd><dt>规划轮次</dt><dd>总览 1 轮 + 分组细化 3 轮（${lgDone().map((g) => esc(lgName(g))).join(' → ')}），每轮各自应用</dd><dt>需求覆盖</dt><dd>${PEF.LARGE.items.length} 条（含 3 条限制）均有步骤与验收</dd><dt>上限</dt><dd>节点 ${PEF.LARGE.leafCount(lgDone())} / 20 · 分组 6 / 8 · 深度 ≤ 2</dd><dt>项目</dt><dd>${esc(T.project)} · ${esc(T.baseline)}</dd></dl></div>
        <div class="dialog-foot"><button class="btn ghost" data-dlg="cancel">再看看</button><button class="btn primary" data-dlg="confirm">确认计划</button></div>`
      : isLegacy() ? `<div class="dialog-body"><h2 id="dlgT">确认计划修订 ${T.planRev}？</h2><p>确认<b class="ink">不调用模型、不执行</b>。确认后在本页“工作区”准备独立工作区，成功后再单独开始执行。</p>
        <dl class="kv"><dt>步骤</dt><dd>${T.steps.length} 步：${T.steps.map((x) => esc(x.title)).join('、')}</dd><dt>需求覆盖</dt><dd>${T.items.length} 条（旧版流程映射）</dd><dt>来源</dt><dd>旧需求目录 <span class="mono">${esc(T.rqId || '')}</span>，身份不变</dd></dl></div>
        <div class="dialog-foot"><button class="btn ghost" data-dlg="cancel">再看看</button><button class="btn primary" data-dlg="confirm">确认计划</button></div>`
      : `<div class="dialog-body"><h2 id="dlgT">确认计划修订 3？</h2><p>确认<b class="ink">不调用模型、不执行</b>。确认后下一步是“准备独立工作区”，成功后再单独开始执行。</p>
        <dl class="kv"><dt>步骤</dt><dd>8 步 · 4 个分组（分组只是展示）</dd><dt>依赖</dt><dd>12 条（数据 9 · 前置 3）</dd><dt>需求覆盖</dt><dd>5 条（含 2 条限制）均有步骤与验收</dd><dt>业务决定</dt><dd>${BQ.length} 项由你明确回答（需求输入修订 2）</dd><dt>风险核对</dt><dd>${acks().length} 项已由你核对（记录于应用时）</dd><dt>读写范围</dt><dd>读：src/${esc(T.pkg)}/**、docs、db/schema 节选<br>写：src/${esc(T.pkg)}/query/**、src/${esc(T.pkg)}/export/**、web/src/pages/${esc(T.pkg)}/**、web/src/api/${esc(T.pkg)}.ts、artifacts/**<span class="hint">同任务文件写入仍按原有互斥规则逐个领取</span></dd><dt>规划依据</dt><dd class="mono" style="font-size:12px">planningBindingHash 9c4e…a7d0<span class="hint">确认范围包含输入、方法、覆盖、检查与人工判断</span></dd></dl></div>
        <div class="dialog-foot"><button class="btn ghost" data-dlg="cancel">再看看</button><button class="btn primary" data-dlg="confirm">确认计划</button></div>`,
    }[kind];
    d.innerHTML = html;
    d.dataset.trigger = trigger ? (trigger.dataset.act || '') : '';
    d.dataset.opt = JSON.stringify(opt);
    DS.openDialog('dlg', trigger);
  }
  function closeDlg(keepDraft) { ui.dialog = null; DS.closeDialog('dlg'); }
  document.addEventListener('keydown', (e) => {
    const d = $('#dlg'); if (!d.classList.contains('open')) return;
    if (e.key === 'Tab') { const f = [...d.querySelectorAll('button:not([disabled]),a[href],input,textarea,select')]; if (!f.length) return; const a = f[0], b = f[f.length - 1]; if (e.shiftKey && document.activeElement === a) { e.preventDefault(); b.focus(); } else if (!e.shiftKey && document.activeElement === b) { e.preventDefault(); a.focus(); } }
    if (e.key === 'Escape' && S === 'pe03') { /* Esc = 返回，草稿保留 */ setTimeout(() => PE.to('b06'), 0); }
  });
  $('#dlg').addEventListener('click', (e) => {
    const b = e.target.closest('[data-dlg]'); if (!b) return;
    if (b.getAttribute('aria-disabled') === 'true') { DS.toast('设计候选 · 后续分期：选区细化本期不开放', 'info'); return; }
    const k = b.dataset.dlg; const opt = JSON.parse($('#dlg').dataset.opt || '{}');
    closeDlg();
    if (k === 'cancel') { if (S === 'pe03' || (EMPTY.includes(S) && ui.supp)) PE.to('b06'); else if (S === 'pe18') PE.to('pe07'); return; }
    if (k === 'start' && opt.grp) { DS.toast(`已确认开始第 ${lgRound()} 轮（模拟）：只细化“${lgName(opt.grp)}”`, 'ok'); PE.to('lg-planning', { gp: opt.grp, sim: '1', applied: null, rejected: null, stopped: null, task: T.id }); return; }
    if (k === 'lgapply') { const gp = lgGp(); ui.busy = 'lg-apply'; render(true); setTimeout(() => PE.to('pe37', { done: lgDone().concat([gp]).join(','), gp: null, applied: gp, sim: null, task: T.id }), 500); return; }
    if (k === 'lgreject') { const gp = lgGp(); PE.to('pe37', { gp: null, rejected: gp, sim: null, task: T.id }); DS.toast('已不采用候选；当前草稿未变', 'info'); return; }
    if (k === 'lgstop') { const gp = lgGp(); ui.busy = 'lg-stop'; render(true); setTimeout(() => { DS.toast('已停止：原调用已停稳，用量已结账（模拟）', 'ok'); PE.to('pe37', { gp: null, stopped: gp, sim: null, task: T.id }); }, 600); return; }
    if (k === 'start') { DS.toast('已确认开始规划（模拟）：派发意图已持久化', 'ok'); PE.to('pe05', Object.assign({ sim: '1' }, opt.newRound ? { round: 2 } : (EMPTY.includes(S) ? { round: 1 } : {}))); }
    if (k === 'stop') { ui.busy = 'stop'; render(); setTimeout(() => PE.to('pe19', { sim: '1' }), 500); }
    if (k === 'chg') { DS.toast('已形成需求输入修订 3（模拟）；当前候选已过期', 'info'); PE.to('pe29', { chg: '1' }); }
    if (k === 'apply') { ui.busy = 'apply'; render(); setTimeout(() => PE.to('pe31'), 600); }
    if (k === 'reject') { ui.dismissed = true; render(); DS.toast('已不采用候选；当前草稿未变', 'info'); }
    if (k === 'confirm') { ui.busy = 'confirm'; const dir = window.UTF && UTF.prepFacts(T.id, T.project).kind === 'dir'; setTimeout(() => PE.to(dir ? 'pw-nongit' : 'pe32', Object.assign({ tab: 'ws' }, isLarge() ? { task: T.id, done: null, applied: null, gp: null } : {})), 400); }
  });

  /* ================= 动作 ================= */
  document.addEventListener('click', (e) => {
    const cat = e.target.closest('a[data-cat]'); if (cat) { cat.href = catUrl(cat.dataset.cat); return; }
    const f = e.target.closest('[data-focus]'); if (f) { e.preventDefault(); focusNode(f.dataset.focus); return; }
    const fg = e.target.closest('[data-focus-grp]'); if (fg) { const id = PEF.candidate(T).nodes.find((n) => n.group === fg.dataset.focusGrp)?.id; if (id) focusNode(id); return; }
    const tg = e.target.closest('[data-toggle-grp]'); if (tg) { ui.collapsed[tg.dataset.toggleGrp] = !isCollapsed(tg.dataset.toggleGrp); render(true); return; }
    const a = e.target.closest('[data-act]'); if (!a || a.closest('#dlg')) return;
    const act = a.dataset.act;
    if (a.getAttribute('aria-disabled') === 'true') { const r = a.getAttribute('aria-describedby'); DS.toast((r && document.getElementById(r)?.textContent) || '当前不可用', 'info'); return; }
    switch (act) {
      case 'generate': case 'refine': if (EMPTY.includes(S) || ui.dismissed || S === 'pe31') openDialog('preview', a); break;
      case 'skeleton': ui.skeleton = true; render(true); DS.toast('已复制方法骨架到草稿（未调用模型）', 'ok'); break;
      case 'stop': openDialog('stop', a); break;
      case 'stop-replan': openDialog('stop', a, { replan: true }); break;
      case 'wait': DS.toast('好的：本轮结果出来后，可以按输入修订 2 预览新一轮', 'info'); break;
      case 'apply': openDialog('apply', a); break;
      case 'reject': openDialog('reject', a); break;
      case 'confirm': openDialog('confirm', a); break;
      case 'new-round': case 'repreview': openDialog('preview', a, { newRound: true }); break;
      case 'refine-scope': PE.setCtx({ gp: a.dataset.grp }); openDialog('preview', a, { scope: lgName(a.dataset.grp), grp: a.dataset.grp }); break;
      case 'lg-apply': openDialog('lgapply', a); break;
      case 'lg-reject': openDialog('lgreject', a); break;
      case 'lg-stop': openDialog('lgstop', a); break;
      case 'edit-input': DS.toast('在“草稿与问题”中补充输入，保存后形成新的输入修订', 'info'); ui.tab = ui.tab === 'draft' ? 'draft' : (cfg().tabs.includes('draft') ? 'draft' : ui.tab); render(); break;
      case 'reconcile': ui.busy = 'reconcile'; render(); setTimeout(() => { DS.toast('核对完成：原进程已停稳，用量已结账（模拟）', 'ok'); PE.to('pe20'); }, 700); break;
      case 'by-key': a.setAttribute('aria-busy', 'true'); setTimeout(() => { DS.toast('按原请求号核对：应用已生效（计划修订 3）', 'ok'); PE.to('pe31'); }, 600); break;
      case 'reread': DS.toast('重新读取（模拟）：成功，不调用模型', 'ok'); PE.to('pe07'); break;
      case 'reconnect': PE.to('pe15'); break;
      case 'back-current': PE.nav(PE.ctx('back') || 'pe25', { round: 2, tab: 'records' }); break;
      case 'save-supp': { const v = ($('#supp2') || $('#supp'))?.value.trim(); if (!v) { DS.toast('补充内容为空', 'warn'); return; } ui.supp = v; PE.to('pe13'); break; }
      case 'save-answers': break;
      case 'bq-save': {
        if (!bqAnswered()) { DS.toast('还有业务问题未回答；预选建议不算回答', 'warn'); break; }
        ui.ansSaved = 2; PE.setCtx({ ans: BQ.map((q) => ui.ans[q.id]).join('|') });
        DS.toast('已保存为需求输入修订 2（你 · 模拟）；第 ' + round() + ' 轮输入保留', 'ok');
        if (READY.includes(S)) { ui.reval = 'checking'; render(true); setTimeout(() => { ui.reval = bqMatches() ? 'ok' : 'stale'; render(true); DS.toast(ui.reval === 'ok' ? '候选与答复一致：已按输入修订 2 重新校验（模拟）' : '候选与答复不一致：已过期，需要按修订 2 新一轮', ui.reval === 'ok' ? 'ok' : 'info'); }, 800); }
        else render(true);
        setTimeout(() => $('#bqSec')?.scrollIntoView({ block: 'nearest' }), 30);
        break;
      }
      case 'bq-change': openDialog('chg', a); break;
      case 'to-ws': ui.tab = 'ws'; PE.setCtx({ tab: 'ws' }); renderSide(cfg()); $('#tab-ws')?.focus(); break;
      case 'refine-legacy': DS.toast('原型没有为这条旧需求准备 AI 规划样例（产品里同样可用）；规划流程请看“开始任务”或 T-2051', 'info'); break;
      case 'show-partial': ui.layer = 'partial'; PE.setCtx({ layer: 'partial' }); render(true); break;
      case 'serial': ui.serial = true; render(true); DS.toast('已形成新差异并重新检查（模拟）', 'ok'); break;
      case 'unsel': ui.sel = null; PE.setCtx({ sel: null }); CV?.select(null); break;
      case 'tool-back': ui.tool = null; renderSide(cfg()); break;
      case 'start-exec': startExec(); break;
      case 'go-settings': e.preventDefault(); DS.toast('整合后跳到现有“设置 → 模型与预算”页面', 'info'); break;
      case 'pick-material': DS.toast('整合后打开现有资料选择抽屉（按项目授权）', 'info'); break;
      case 'isolate': break;
      case 'open-task': { const r = PE.ctx('returnTo'); if (r && /^delivery\/task\.html/.test(r)) SC.go(r); else SC.go('delivery/task.html?state=' + (isFixed() ? 'ut-fixed-running' : PE.ctx('at') === 'first' ? 'ut-running' : 'ut-running-mid'), { task: T.id, returnTo: 'planning/requirement.html?state=b08&task=' + T.id }); break; }
      case 'open-pkg': openNode('n3', 'attempts', '后端筛选查询', 'done'); break;
    }
  });
  document.addEventListener('click', (e) => {
    const pw = e.target.closest('[data-pw]'); if (pw && prep()) { if (pw.dataset.pw === 'dis' || !pw.disabled) prep().act(pw.dataset.pw, pw); return; }
    const q = e.target.closest('.qopt'); if (q) { if (q.getAttribute('aria-disabled') === 'true') { DS.toast('答复已保存为需求输入修订 2；要改请用“修改答复”', 'info'); return; } if (q.dataset.bq) { ui.ans[q.dataset.bq] = q.dataset.v; const y = $('#tp')?.scrollTop; renderSide(cfg()); renderBar(cfg()); if ($('#tp')) $('#tp').scrollTop = y; $(`.qopt[data-bq="${q.dataset.bq}"][data-v="${q.dataset.v}"]`)?.focus(); } return; }
    const ck = e.target.closest('[data-ack]'); if (ck) { ui.acks[ck.dataset.ack] = ck.checked; const c = cfg(); const scroll = $('#tp')?.scrollTop; renderSide(c); if ($('#tp')) $('#tp').scrollTop = scroll; $(`[data-ack="${ck.dataset.ack}"]`)?.focus(); }
  });
  document.addEventListener('input', (e) => { if (e.target.id === 'supp' || e.target.id === 'supp2') ui.supp = e.target.value; });
  function focusNode(id) {
    const c = cfg();
    if (c.layer === 'skeleton' || c.layer === 'empty') { ui.layer = c.layers?.includes('compare') ? 'compare' : c.layers?.includes('partial') ? 'partial' : ui.layer; }
    PE.setCtx({ sel: id, layer: ui.layer }); renderCanvas(cfg()); CV.focusNode(id);
  }

  /* ================= 渲染 ================= */
  /* 从按钮进入（sim=1）时，服务事件按样例时间线自动到达；直接打开某个状态 = 静态画面（可用底部“模拟服务事件”）。 */
  const AUTO = ['pe05', 'pe06', 'pe07', 'pe08', 'pe09', 'pe10', 'pe19', 'pe23', 'pe24', 'pe26', 'b01', 'lg-planning'];
  let autoT = null;
  function render(keepView) {
    const c = cfg();
    clearTimeout(autoT);
    if (PE.ctx('sim') === '1' && c.event && AUTO.includes(S)) autoT = setTimeout(() => { if (!ui.dialog) c.event[1](); }, document.documentElement.classList.contains('reduced') ? 1200 : 2400);
    document.title = `需求画布 · ${PE.byId[S]?.label || ''} · opencode-workflow 设计样例`;
    renderBar(c); renderBanners(c); renderCanvas(c); renderSide(c);
    PE.setEvent(c.event?.[0], c.event?.[1]);
    if (c.dialog && !ui.dialog) setTimeout(() => openDialog(c.dialog, document.querySelector(`[data-act="${c.dialog === 'preview' ? 'generate' : 'stop'}"]`)), 120);
    if (!keepView && !view) requestAnimationFrame(() => CV?.fit(false));
    view = null;
  }
  DS.mount({ proto: false });
  PE.mountProto();
  // 返回上下文：深链冷开时根据 URL 恢复选中节点、页签、图层与画布视角
  if (S === 'pe15' && !ui.sel) ui.sel = 's3';
  render(!!view);
})();
