/* task.html · 统一任务画布（补稿 v4，2026-10-16）
   基于 TD02 任务画布与待交付 + TD06 工作区详情与清理（设计样例 · 合成数据），在同一张画布上补齐：
   - 统一身份：?task= 读取真实任务（规划创建 / 旧任务迁入 / TD / 固定模板 / 旧版记录），不再跳回旧任务画布
   - 调整待执行计划（捕获并保留原自动推进 / 暂停模式，AD05）；自动节点推进为真实开关，关闭时可整体推进 / 推进选中后继
   - 旧任务画布状态迁入：等待审批、停滞、失败与恢复、待人工验收、状态待核对、旧版记录、快照评审运行面板
   - 固定模板任务只读（origin=fixed-menu-template；与模板名称 / 版本无关）
   不发请求、不写本机存储；写操作（调整、保存、确认、继续、推进、恢复、取消、清理、核对）只用定时器切换模拟状态。
   从按钮进入（?sim=1）时用短定时器模拟服务回执；直接打开某个状态 = 静态画面。原 TD02 / TD06 状态与行为保持不变。 */
(function () {
  'use strict';
  const I = DS.icon, esc = DS.esc, $ = DS.$, $$ = DS.$$;
  const FX = window.TASK_FX, REG = window.UT_REG || {};
  const QP = new URLSearchParams(location.search);
  let S = TD.init('task.html');
  Object.assign(DSCanvas.STATUS, { adv: ['待推进', 'st-wait', 'play'], paused: ['已暂停', 'st-idle', 'pause'] });

  /* ---------- 状态 → 画面布置 ---------- */
  const ST = {
    'td02-running': { ph: 'running' },
    'td02-parallel': { ph: 'parallel', open: 'node:n2' },
    'td02-awaiting': { ph: 'awaiting', open: 'delivery' },
    'td02-blocked': { ph: 'blocked', open: 'delivery' },
    'td02-no-changes': { ph: 'nochg', open: 'delivery' },
    'td02-failed-candidate': { ph: 'failcand', open: 'delivery' },
    'td02-step-committed': { ph: 'committed', open: 'delivery', gitOnly: true },
    'td02-delivered': { ph: 'delivered', open: 'delivery' },
    'td02-delivered-verify-failed': { ph: 'deliveredFail', open: 'delivery' },
    'td02-background': { ph: 'running', bg: true, gitOnly: true },
    'td02-cancelled-retained': { ph: 'cancelled', open: 'delivery' },
    'td06-detail-git': { ph: 'awaiting', open: 'delivery', drawer: true, kind: 'git' },
    'td06-detail-nongit': { ph: 'awaiting', open: 'delivery', drawer: true, kind: 'dir' },
    'td06-close-retain': { ph: 'running', dialog: 'cancel' },
    'td06-cleanup-preview': { ph: 'delivered', open: 'delivery', drawer: true, dialog: 'cleanup' },
    'td06-cleanup-undelivered': { ph: 'awaiting', open: 'delivery', drawer: true, dialog: 'cleanup' },
    'td06-cleanup-blocked': { ph: 'pushUnknown', open: 'delivery', drawer: true, dialog: 'cleanup', gitOnly: true },
    'td06-cleanup-partial': { ph: 'cleanPartial', open: 'delivery', drawer: true },
    'td06-cleaned': { ph: 'cleaned', open: 'delivery', drawer: true },
    /* ----- 补稿 v4：统一任务画布 ----- */
    'ut-running': { ut: true, ph: 'running', run: 'first', task: 'T-2051' },
    'ut-running-mid': { ut: true, ph: 'running', run: 'mid', task: 'T-2050' },
    'ut-auto-off': { ut: true, ph: 'running', run: 'mid', task: 'T-2035', auto: false },
    'ut-advance': { ut: true, ph: 'advance', run: 'advance', task: 'T-2035', auto: false },
    'ut-paused': { ut: true, ph: 'paused', run: 'paused', task: 'T-2030' },
    'ut-waiting': { ut: true, ph: 'waiting', run: 'waiting', task: 'T-2044', open: 'node:n3' },
    'ut-stalled': { ut: true, ph: 'stalled', run: 'stalled', task: 'T-2038', open: 'node:n2' },
    'ut-failed': { ut: true, ph: 'failed', run: 'failed', task: 'T-2004', open: 'node:n4' },
    'ut-recovering': { ut: true, ph: 'failed', run: 'recovering', task: 'T-2004', open: 'recovery' },
    'ut-review': { ut: true, ph: 'review', run: 'review', task: 'T-2044', open: 'node:n5' },
    'ut-unknown': { ut: true, ph: 'unknown', run: 'unknown', task: 'T-1998' },
    'ut-legacy-done': { ut: true, ph: 'legacyDone', run: 'done', task: 'T-2019' },
    'ut-legacy-stopped': { ut: true, ph: 'legacyStop', run: 'stopped', task: 'T-2011' },
    'ut-adj-pausing': { ut: true, ph: 'running', run: 'mid', task: 'T-2050', adj: 'pausing' },
    'ut-adj-editing': { ut: true, ph: 'running', run: 'mid', task: 'T-2050', adj: 'editing' },
    'ut-adj-conflict': { ut: true, ph: 'running', run: 'mid', task: 'T-2050', adj: 'conflict' },
    'ut-adj-reconfirm': { ut: true, ph: 'running', run: 'mid', task: 'T-2050', adj: 'reconfirm' },
    'ut-adj-ready': { ut: true, ph: 'running', run: 'mid', task: 'T-2050', adj: 'ready' },
    'ut-fixed-running': { ut: true, ph: 'running', run: 'first', task: 'T-2070' },
    'ut-fixed-snapshot': { ut: true, ph: 'running', run: 'mid', task: 'T-2003', open: 'snap' },
  };
  /* 任务徽标 / 交付端点徽标 / 情况条底色 */
  const PH = {
    running: { task: ['执行中', 'st-run', 'play'], end: ['未到达', 'st-idle', 'clock'], sit: '' },
    parallel: { task: ['执行中', 'st-run', 'play'], end: ['未到达', 'st-idle', 'clock'], sit: '' },
    awaiting: { task: ['执行已结束 · 等待交付', 'st-wait', 'clock'], end: ['待交付', 'st-wait', 'clock'], sit: 'wait' },
    blocked: { task: ['等待执行停稳', 'st-wait', 'pause'], end: ['交付受阻', 'st-stall', 'lock'], sit: 'need' },
    nochg: { task: ['执行已结束 · 等待交付', 'st-wait', 'clock'], end: ['待交付 · 无变更', 'st-wait', 'clock'], sit: 'wait' },
    failcand: { task: ['执行已结束 · 等待交付', 'st-wait', 'clock'], extra: ['验证未通过', 'st-fail', 'x'], end: ['待交付', 'st-wait', 'clock'], sit: 'fail' },
    committed: { task: ['交付进行中 · 等待推送确认', 'st-wait', 'clock'], end: ['进行中 · 1 / 3', 'st-accent', 'play'], sit: 'wait' },
    pushUnknown: { task: ['交付待核对', 'st-unknown', 'help'], end: ['待核对', 'st-unknown', 'help'], sit: 'unk' },
    delivered: { task: ['任务已交付', 'st-ok', 'check'], end: ['已交付', 'st-ok', 'check'], sit: 'ok' },
    deliveredFail: { task: ['已交付，验证未通过', 'st-fail', 'alert'], end: ['已交付 · 验证未通过', 'st-fail', 'alert'], sit: 'fail' },
    cancelled: { task: ['已取消', 'st-idle', 'stop'], end: ['未交付 · 已保留', 'st-idle', 'archive'], sit: '' },
    cleaned: { task: ['任务已交付', 'st-ok', 'check'], end: ['已交付', 'st-ok', 'check'], sit: 'ok' },
    cleanPartial: { task: ['任务已交付', 'st-ok', 'check'], end: ['已交付', 'st-ok', 'check'], sit: 'unk' },
    /* v4 */
    advance: { task: ['等待推进', 'st-wait', 'pause'], end: ['未到达', 'st-idle', 'clock'], sit: 'wait' },
    paused: { task: ['已暂停', 'st-idle', 'pause'], end: ['未到达', 'st-idle', 'clock'], sit: '' },
    waiting: { task: ['等待你处理', 'st-wait', 'help'], end: ['未到达', 'st-idle', 'clock'], sit: 'wait' },
    stalled: { task: ['有步骤停滞', 'st-stall', 'alert'], end: ['未到达', 'st-idle', 'clock'], sit: 'need' },
    failed: { task: ['有步骤失败', 'st-fail', 'x'], end: ['未到达', 'st-idle', 'clock'], sit: 'fail' },
    review: { task: ['待人工验收', 'st-wait', 'eye'], end: ['未到达', 'st-idle', 'clock'], sit: 'wait' },
    unknown: { task: ['状态待核对', 'st-unknown', 'help'], end: ['未到达', 'st-idle', 'clock'], sit: 'unk' },
    legacyDone: { task: ['已完成 · 旧版记录', 'st-done', 'check'], end: ['旧版 · 无交付端点', 'st-idle', 'archive'], sit: 'ok' },
    legacyStop: { task: ['已终止 · 旧版记录', 'st-idle', 'stop'], end: ['旧版 · 无交付端点', 'st-idle', 'archive'], sit: '' },
  };
  const DONE = { n1: 'done', n2: 'done', n3: 'done', n4: 'done', n5: 'done' };
  const NODEMAP = {
    running: { n1: 'done', n2: 'run', n3: 'run', n4: 'idle', n5: 'idle' },
    parallel: { n1: 'done', n2: 'run', n3: 'run', n4: 'idle', n5: 'idle' },
    failcand: Object.assign({}, DONE, { n4: 'fail' }),
    deliveredFail: Object.assign({}, DONE, { n4: 'fail' }),
    cancelled: { n1: 'done', n2: 'done', n3: 'done', n4: 'idle', n5: 'idle' },
  };
  const E5 = [['start', 'n1'], ['n1', 'n2'], ['n1', 'n3'], ['n2', 'n4'], ['n3', 'n4'], ['n4', 'n5'], ['n5', 'end']];

  let cfg, ph, T, kind, auth, uniq, panel = null, tab = 'overview', nodeTab = 'overview', bgNote = true, busy = null;
  /* v4 局部状态：自动推进（服务事实，URL auto=）、原模式（URL prior=，调整开始时捕获）、调整子状态、本地草稿 */
  let autoOn = true, prior = 'on', adj = null, edits = {}, reread = false, rec = { mode: 'retry', phase: 'choose' }, snap = null, editSel = null;
  function load() {
    cfg = ST[S] || ST['td02-awaiting'];
    ph = cfg.ph;
    const want = QP.get('task');
    if (cfg.ut) { T = REG[want] || REG[cfg.task]; kind = T.kind === 'dir' ? 'dir' : 'git'; }
    else {
      kind = cfg.kind || (!cfg.gitOnly && QP.get('kind') === 'dir' ? 'dir' : 'git');
      T = kind === 'dir' ? FX.T2043 : (REG[want] && REG[want].origin !== 'legacy' && REG[want].kind !== 'dir' ? REG[want] : FX.T2041);
      if (kind === 'dir' && REG[want] && REG[want].kind === 'dir') T = REG[want];
    }
    auth = QP.get('auth') === 'deny' ? 'deny' : 'allow';
    uniq = QP.get('unique') === '1';
    autoOn = QP.has('auto') ? QP.get('auto') === '1' : (cfg.auto !== undefined ? cfg.auto : T.auto !== false);
    adj = cfg.adj || null;
    prior = QP.get('prior') || (ph === 'paused' || T.execState === 'paused' && cfg.adj ? 'paused' : autoOn ? 'on' : 'off');
    edits = { conflict: { added: true, mod: true }, reconfirm: { added: true }, ready: { added: true } }[adj] || {};
    if (adj === 'editing' && QP.get('draft') === '1') edits = { added: true };
    reread = false;
    snap = T.tpl && T.tpl.snapshot ? (QP.get('snap') || (cfg.open === 'snap' ? 'progress' : null)) : null;
  }
  load();
  const isUT = () => !!cfg.ut;
  const isGit = () => kind === 'git';
  const isFixed = () => T.origin === 'fixed';
  const isLegacy = () => T.origin === 'legacy';
  const planRev = () => (T.planRev || 2) + (QP.get('added') === '1' ? 1 : 0);
  const priorLabel = (p) => ({ on: '自动节点推进 开启', off: '自动节点推进 关闭（手动推进）', paused: '任务已暂停（自动节点推进 ' + (autoOn ? '开启' : '关闭') + '）' })[p || prior];
  function runKey() { const at = QP.get('at'); if (at && T.run && T.run[at]) return at; if (adj && prior === 'paused') return 'paused'; return cfg.run; }
  function st() {
    if (!isUT()) { const m = Object.assign({}, NODEMAP[ph] || DONE); if (T.adj && QP.get('added') === '1') m[T.adj.add.id] = delivered() || !notEnded() ? 'done' : 'idle'; return m; }
    const s = Object.assign({}, (T.run && T.run[runKey()]) || {});
    T.nodes.forEach((n) => { if (!n.system && !s[n.id]) s[n.id] = 'idle'; });
    if (T.adj && (QP.get('added') === '1' || (adj && edits.added))) s[T.adj.add.id] = s[T.adj.add.id] || 'idle';
    if (adj && T.adj) {
      if (adj === 'conflict' || reread) s[T.adj.conflict] = 'claimed';
      if (adj === 'editing' || adj === 'conflict') Object.keys(s).forEach((id) => { if (s[id] === 'idle' || s[id] === 'adv') s[id] = 'ready'; });
    }
    return s;
  }
  const total = () => T.adm.A + T.adm.M + T.adm.D;
  const delivered = () => ['delivered', 'deliveredFail', 'cleaned', 'cleanPartial'].includes(ph);
  const undelivered = () => ph === 'nochg' ? 0 : delivered() ? (kind === 'dir' && ph !== 'cleaned' ? T.applied.skip : 0) : total();
  const undeliveredDesc = () => delivered() ? `<span class="mono">config/report.yaml</span>（修改 · 暂不交付）` : `新增 ${T.adm.A} · 修改 ${T.adm.M} · 删除 ${T.adm.D}`;
  const ctx = () => Object.assign({ from: 'task', fromState: S }, kind === 'dir' ? { kind: 'dir' } : {}, T.id !== 'T-2041' && T.id !== 'T-2043' ? { task: T.id } : {});
  const nTitle = (id) => (allNodes().find((n) => n.id === id) || {}).title || id;
  const execRunning = () => ['running', 'parallel'].includes(ph);
  const notEnded = () => ['running', 'parallel', 'advance', 'paused', 'waiting', 'stalled', 'failed', 'review', 'unknown'].includes(ph);
  const titlesBy = (stat) => allNodes().filter((n) => st()[n.id] === stat).map((n) => n.title);
  function allNodes() { const ns = T.nodes.slice(); if (T.adj && (QP.get('added') === '1' || (adj && edits.added))) ns.splice(ns.length - 1, 0, Object.assign({ added: true }, T.adj.add)); return ns; }

  /* ---------- 画布 ---------- */
  const cvOpt = {
    nodes: [], edges: [],
    statusOf: (id) => st()[id],
    editable: (n) => editing() && st()[n.id] === 'ready' && !n.system,
    onAddAfter: (id) => addAfter(id),
    onSelect: (id, sys) => {
      if (quiet) return;
      if (sys) { if (id === 'end') openDelivery(); else decorate(); return; }
      if (!id) { closeSide(); return; }
      openNode(id); cv.reveal(id);
    },
  };
  let quiet = false;
  const editing = () => adj === 'editing' || adj === 'conflict';
  function buildGraph() {
    const showWrite = ['running', 'parallel'].includes(ph) && T.origin === 'td' && !adj;
    cvOpt.nodes = allNodes().map((n) => {
      const m = Object.assign({}, n);
      if (showWrite) m.meta = { n1: '只读 · 基线一致快照', n2: '写入：' + T.subs[0][1], n3: '写入：' + T.subs[1][1], n4: '读：汇合后的一致快照', n5: '只读验收' }[n.id];
      else if (n.added) m.meta = n.meta;
      else if (adj && T.adj && n.id === T.adj.conflict && edits.mod && !reread) m.meta = T.adj.mod;
      return m;
    });
    const lab = showWrite ? { 'n2>n4': '汇合', 'n3>n4': '汇合' } : {};
    let edges = (T.edges || E5).map(([from, to]) => ({ from, to, label: lab[from + '>' + to] }));
    if (T.adj && (QP.get('added') === '1' || (adj && edits.added))) {
      const A = T.adj; edges = edges.filter((e) => !(e.from === A.after && e.to === A.to));
      edges.push({ from: A.after, to: A.add.id }, { from: A.add.id, to: A.to });
    }
    cvOpt.edges = edges;
  }
  buildGraph();
  const cv = DSCanvas($('#cv'), cvOpt);
  function decorate() {
    const b = $('#cv .cv-sys[data-id="end"]');
    if (b) {
      const E = PH[ph].end;
      b.classList.add('td-end'); b.classList.toggle('sel', panel === 'delivery');
      b.setAttribute('aria-pressed', panel === 'delivery');
      b.setAttribute('aria-label', `交付端点：${E[0]}。打开交付面板`);
      b.innerHTML = `<span class="td-end-t">${I('inbox', 'sm')}交付</span><span class="badge ${E[1]}">${I(E[2], 'sm')}${E[0]}</span>`;
    }
    if (!isUT()) return;
    const s = st();
    $$('#cv .cv-node').forEach((el) => {
      const id = el.dataset.id, n = allNodes().find((x) => x.id === id); if (!n) return;
      const top = el.querySelector('.cv-top'); if (!top || top.querySelector('.ut-mk')) return;
      let mk = '';
      if (isFixed()) mk = `<span class="ut-mk lock" title="固定模板步骤：不能修改">${I('lock', 'sm')}</span>`;
      else if (adj && ['done', 'run', 'claimed', 'paused', 'stall', 'fail', 'wait', 'review', 'unknown'].includes(s[id])) mk = `<span class="ut-mk lock" title="锁定：${DSCanvas.STATUS[s[id]][0]}（含入边）">${I('lock', 'sm')}</span>`;
      if (mk) top.insertAdjacentHTML('afterbegin', mk);
      const meta = el.querySelector('.cv-meta');
      if (adj && n.added && ['editing', 'conflict', 'reconfirm'].includes(adj)) meta.insertAdjacentHTML('afterbegin', `<span class="ut-diff add">${I('plus', 'sm')}本次新增</span>`);
      if (adj && T.adj && id === T.adj.conflict && edits.mod && !reread && ['editing', 'conflict'].includes(adj)) meta.insertAdjacentHTML('afterbegin', `<span class="ut-diff mod">${I('edit', 'sm')}本地修改</span>`);
    });
  }
  /* 进入状态时：面板占去右侧后，把关键节点放到可读的缩放（≥ 适应画布），并留在可见区内 */
  function focusView(id) {
    const host = $('#cv'), el = $(`#cv [data-id="${id}"]`); if (!el) return;
    const v = cv.view(), r = host.getBoundingClientRect();
    const k = Math.max(v.k, Math.min(0.82, r.width / 900));
    const x = el.offsetLeft, y = el.offsetTop, w = el.offsetWidth, h = el.offsetHeight;
    let tx = id === 'end' ? r.width - 48 - (x + w) * k : r.width * 0.42 - (x + w / 2) * k;
    const ty = (r.height - 40) / 2 - (y + h / 2) * k;
    cv.restore({ tx, ty, k });
  }
  function renderCanvas() { const host = $('#cv'); if (host) { host.scrollLeft = 0; host.scrollTop = 0; } buildGraph(); cv.render(); decorate(); overlays(); document.body.classList.toggle('ut-panel-first', isUT() && (!autoOn || !!adj || ph !== 'running')); document.body.classList.toggle('ut-editing', editing()); }

  /* ---------- 页头 ---------- */
  function backInfo() {
    const r = QP.get('returnTo');
    if (r && /^(main\/pages|planning)\/[a-z\-]+\.html/.test(r) && !r.includes('..')) {
      const f = r.split('?')[0].split('/').pop();
      return { href: SC.url(r), label: { 'tasks.html': '任务列表', 'requirements.html': '需求目录', 'inbox.html': '待处理中心', 'home.html': '主页', 'templates.html': '模板任务', 'requirement.html': '需求画布' }[f] || '任务列表' };
    }
    return { href: SC.url('main/pages/tasks.html'), label: '任务列表' };
  }
  function originChip() {
    if (!isUT() && T.origin === 'td') return '';
    const chip = (cls, ic, txt, tip) => `<span class="ut-origin ${cls}" title="${tip}" aria-label="${txt}（${tip}）">${I(ic, 'sm')}<span class="ut-ot">${txt}</span></span>`;
    if (isFixed()) return chip('fixed', 'lock', `固定模板 · ${esc(T.tpl.name)} r${T.tpl.rev}`, `origin=fixed-menu-template · ${esc(T.tpl.ref)}@r${T.tpl.rev} · 创建后不能修改步骤`);
    if (T.origin === 'planning') return chip('', 'sparkle', `AI 规划 · 修订 ${planRev()}`, '由需求画布 AI 规划形成并确认');
    if (T.origin === 'old') return chip('', 'refresh', `迁入 · 修订 ${planRev()}`, '原任务画布的任务，已迁入统一任务画布（身份不变）');
    if (isLegacy()) return chip('legacy', 'archive', '旧版记录', '独立工作区上线前结束的旧任务记录');
    return '';
  }
  function canAdjust() { return !isLegacy() && !isFixed() && !adj && !cfg.bg && (isUT() ? ['running', 'advance', 'paused', 'waiting', 'stalled', 'failed', 'unknown'].includes(ph) : ['running', 'parallel'].includes(ph)) && !!T.adj; }
  function bar() {
    const B = PH[ph].task, X = ph === 'failcand' || ph === 'deliveredFail' ? null : PH[ph].extra;
    const r = TD.ret(), back = backInfo();
    const showAuto = (execRunning() || ['advance', 'paused', 'waiting', 'stalled', 'failed', 'review', 'unknown'].includes(ph)) && !isLegacy();
    const adjBadge = adj ? { pausing: ['正在暂停新增领取', 'st-wait', 'pause'], editing: ['调整待执行计划', 'st-wait', 'edit'], conflict: ['调整 · 保存冲突', 'st-fail', 'alert'], reconfirm: ['等待重新确认', 'st-wait', 'alert'], ready: ['已重新确认 · 待继续', 'st-done', 'check'] }[adj] : null;
    const BB = adjBadge || B;
    let adjBtn = '';
    if (isFixed() && ['running', 'advance', 'paused'].includes(ph)) adjBtn = `<span class="dis-wrap ut-dis"><button class="btn secondary sm" aria-disabled="true" aria-describedby="fxWhy" data-a="dis">${I('edit', 'sm')}调整待执行计划</button><span class="sr" id="fxWhy">该任务使用固定模板，创建后不能修改步骤；要改要求，请从“模板任务”新建。</span></span>`;
    else if (canAdjust()) adjBtn = `<button class="btn secondary sm" data-a="adjust" id="adjBtn">${I('edit', 'sm')}调整待执行计划</button>`;
    const advN = advanceable().length;
    const advBtn = showAuto && !autoOn && !adj && !['paused'].includes(ph) ? (advN ? `<button class="btn primary sm" data-a="advance-all" id="advBtn" title="放行此刻满足条件的全部后继步骤；同次不级联" aria-label="整体推进，启动 ${advN} 步">${I('play', 'sm')}整体推进<span class="ut-long"> · 启动 ${advN} 步</span></button>` : `<span class="dis-wrap ut-dis"><button class="btn secondary sm" aria-disabled="true" aria-describedby="advWhy" data-a="dis" id="advBtn">${I('play', 'sm')}整体推进</button><span class="sr" id="advWhy">没有可以推进的步骤：正在等待执行中或待验收的步骤</span></span>`) : '';
    $('#bar').innerHTML = `
      <nav class="crumbs"><a href="${back.href}" data-a="back">${back.label}</a><span class="sep">/</span></nav>
      <span class="task-title" title="${esc(T.title)}">${esc(T.title)}</span>
      <span class="badge ${BB[1]}" id="taskBadge">${I(BB[2], 'sm')}${BB[0]}</span>
      ${ph === 'failcand' ? `<span class="badge st-fail">${I('x', 'sm')}验证未通过</span>` : ''}
      ${X ? `<span class="badge ${X[1]}">${I(X[2], 'sm')}${X[0]}</span>` : ''}
      ${isLegacy() ? `<button class="td-wschip ut-legacychip" data-a="legacy-info" aria-label="旧版任务：直接在项目目录执行">${I('folder', 'sm')}<span class="ellipsis">${esc(T.project)}</span><span class="td-wsk">直接目录 · 旧版</span></button>`
        : `<button class="td-wschip" data-a="ws" id="wsChip" aria-label="工作区详情：${esc(T.ws)}" title="${esc(T.ws)}">${I(isGit() ? 'branch' : 'folder', 'sm')}<span class="ellipsis">${esc(T.ws.split(' · ')[0])}</span><span class="ut-wsid">· ${esc(T.ws.split(' · ')[1] || '')}</span><span class="td-wsk">${isGit() ? 'worktree' : '独立副本'}</span></button>`}
      ${originChip()}
      <span class="td-mock" title="合成数据，不连接任务、Git、GitLab、目录或模型">设计样例 · 合成数据</span>
      <span class="grow"></span>
      ${r.from === 'task' && r.fromState ? `<a class="btn ghost sm" href="${TD.backHref()}">${I('arrowLeft', 'sm')}返回上一个任务</a>` : ''}
      ${snap !== null && T.tpl && T.tpl.snapshot ? `<div class="seg ut-snapseg" role="group" aria-label="运行面板"><button aria-pressed="${panel === 'snap' && snapTab === 'progress'}" data-a="snap" data-t="progress">${I('chart', 'sm')}执行进度</button><button aria-pressed="${panel === 'snap' && snapTab === 'reports'}" data-a="snap" data-t="reports">${I('doc', 'sm')}模板报告</button></div>` : ''}
      ${adjBtn}${advBtn}
      ${showAuto ? `<label class="auto" title="开启时，步骤验收通过后自动开始满足条件的下一批步骤"><span class="ut-autol">自动节点推进</span><button class="switch" role="switch" aria-checked="${autoOn}" aria-label="自动节点推进" data-a="auto" id="autoSw" ${adj ? 'aria-disabled="true" title="调整期间新增领取已暂停；继续时恢复原设置"' : ''}></button></label>` : ''}
      <button class="icon-btn" aria-label="更多" data-a="more" id="moreBtn">${I('more')}</button>`;
    $('#bar').classList.toggle('ut-dense', !!(advBtn || (snap !== null && T.tpl && T.tpl.snapshot)));
  }
  function advanceable() {
    if (!isUT() || autoOn) return [];
    const s = st();
    return allNodes().filter((n) => s[n.id] === 'adv');
  }

  /* ---------- 情况条：两个事实（+ 调整中的“计划”事实） ---------- */
  function execFact() {
    if (isUT() && adj && prior === 'paused') return ['pause', '任务已暂停（你于 11:20 暂停）· 调整期间仍保持暂停', 'var(--sub)'];
    if (isUT()) {
      const run = titlesBy('run'), first = run.map((t) => `<b>${esc(t)}</b>`).join('、');
      const k = runKey();
      const m = {
        running: run.length ? ['play', `${k === 'first' ? '第一批' : '进行中'}：${first} 执行中${run.length > 1 ? '（并行）' : ''}`, 'var(--run)'] : ['clock', '等待调度领取', 'var(--sub)'],
        advance: ['pause', `<b>${esc(titlesBy('done').slice(-1)[0] || '')}</b> 已验收 · 自动推进已关闭 · ${advanceable().length} 步待推进`, 'var(--wait)'],
        paused: ['pause', `任务已暂停（你于 11:20 暂停）· 运行中的步骤已停在安全点`, 'var(--sub)'],
        waiting: ['help', `<b>${esc(titlesBy('wait')[0] || '')}</b> 请求写入 docs/api-reference.md，等你审批 · 其他步骤继续`, 'var(--wait)'],
        stalled: ['alert', `<b>${esc(titlesBy('stall')[0] || '')}</b> 已停滞 18 分钟 · 等你授权读取数据库连接配置`, 'var(--stall)'],
        failed: ['x', `<b>${esc(titlesBy('fail')[0] || '')}</b> 失败：3 个用例断言不通过 · 尝试 3 / 3`, 'var(--warn)'],
        review: ['eye', '所有自动步骤已通过，等待你<b>人工验收</b>', 'var(--wait)'],
        unknown: ['help', `<b>${esc(titlesBy('unknown')[0] || '')}</b> 状态未核对 · 画布保留上次进度`, 'var(--unknown)'],
        legacyDone: ['check', `已完成 · ${allNodes().filter((n) => !n.system).length} 步全部验收通过（${esc(T.doneAt || '')}）`, 'var(--done)'],
        legacyStop: ['stop', `已终止于第 2 步（${esc(T.doneAt || '')}）`, 'var(--sub)'],
      }[ph];
      if (m) return m;
    }
    const n2 = nTitle('n2'), n3 = nTitle('n3');
    return {
      running: ['play', `进行到第 2 段：<b>${n2}</b>、<b>${n3}</b> 并行执行中`, 'var(--run)'],
      parallel: ['play', `<b>${n2}</b>、<b>${n3}</b> 并行写入各自子${isGit() ? '工作区' : '副本'}`, 'var(--run)'],
      blocked: ['alert', '5 / 5 步通过验收 · 执行器尚未停稳', 'var(--stall)'],
      failcand: ['x', '执行已结束 · 回归测试未通过（2 个失败）', 'var(--warn)'],
      deliveredFail: ['x', '回归测试未通过（2 个失败）· 失败记录保留', 'var(--warn)'],
      cancelled: ['stop', '任务已取消（15:10）· 3 / 5 步通过验收', 'var(--sub)'],
    }[ph] || ['check', '执行已结束 · 5 / 5 步通过验收', 'var(--done)'];
  }
  function delivFact() {
    const dir = !isGit();
    if (isLegacy()) return ['archive', '旧版记录：没有交付端点 · 结果当时直接写入项目目录', 'var(--sub)'];
    if (['advance', 'paused', 'waiting', 'stalled', 'failed', 'review', 'unknown'].includes(ph)) return ['clock', '未到达 · 执行结束后在「交付」端点选择交付', 'var(--sub)'];
    return {
      running: ['clock', '未到达 · 执行结束后在「交付」端点选择交付', 'var(--sub)'],
      parallel: ['clock', '未到达', 'var(--sub)'],
      awaiting: ['inbox', `等待交付 · ${total()} 个文件变更，尚未${dir ? '选择要应用的变更' : '选择完成目标'}`, 'var(--wait)'],
      blocked: ['lock', '交付受阻 · 仍有活动写入，执行未停稳', 'var(--stall)'],
      nochg: ['info', `没有文件变更 · 不会生成空提交${dir ? '' : '或合并请求'}`, 'var(--wait)'],
      failcand: auth === 'allow' ? ['alert', '等待交付 · 原规则允许知情交付此失败结果', 'var(--wait)'] : ['lock', '不能交付 · 原规则不允许交付此失败结果', 'var(--warn)'],
      committed: ['play', `已提交 ${T.commit} · 等待推送确认（1 / 3 步）`, 'var(--wait)'],
      pushUnknown: ['help', '推送回执未知 · 只核对原推送', 'var(--unknown)'],
      delivered: dir ? ['check', `任务已交付 · ${T.applied.ok} 项已写入原目录`, 'var(--ok)'] : ['check', `任务已交付 · 合并请求 ${T.mr} 已创建（未合并）`, 'var(--ok)'],
      deliveredFail: ['check', '已交付，验证未通过 · 知情交付', 'var(--warn)'],
      cancelled: ['archive', '未交付 · 文件保留，可稍后交付', 'var(--sub)'],
      cleaned: ['check', '任务已交付 · 工作区已清理，回执保留', 'var(--ok)'],
      cleanPartial: ['help', '任务已交付 · 清理未完成，待核对原清理', 'var(--unknown)'],
    }[ph];
  }
  function adjFact() {
    if (!adj) return null;
    const N = planRev();
    return {
      pausing: ['spin', `<b>正在暂停新增领取…</b> 请求 rk-e51b 已发出，回执成功前不开放编辑`, 'var(--wait)'],
      editing: ['pause', `<b>已暂停新增领取</b> · 编辑待执行区（基于修订 ${N}）· 调整前：${priorLabel()}`, 'var(--wait)'],
      conflict: ['alert', `<b>保存未成功</b> · “${esc(nTitle(T.adj.conflict))}”在暂停生效前已被领取`, 'var(--warn)'],
      reconfirm: ['alert', `<b>计划已变更，后续步骤等待重新确认</b> · 修订 ${N} → ${N + 1}`, 'var(--wait)'],
      ready: ['check', `<b>计划修订 ${N + 1} 已重新确认</b> · 新增领取仍暂停 · 继续时恢复：${priorLabel()}`, 'var(--ok)'],
    }[adj];
  }
  function situ() {
    const e = execFact(), d = delivFact(), a = adjFact();
    let right = '';
    if (adj) right = '';
    else if (ph === 'running' && isUT()) right = `<span class="hint td-sit-hint">${I('lock', 'sm')}写入在独立${isGit() ? '工作区' : '副本'}，原项目不受影响</span>`;
    else if (ph === 'running') right = `<span class="hint td-sit-hint">${I('lock', 'sm')}写入在独立${isGit() ? '工作区' : '副本'} ${esc(T.ws)}，原项目不受影响</span>`;
    else if (ph === 'parallel') right = `<button class="btn secondary sm" data-a="pick-n2">${I('split', 'sm')}查看并行写策略</button>`;
    else if (ph === 'paused') right = `<button class="btn primary sm" data-a="resume" id="resumeBtn">${I('play', 'sm')}恢复任务</button>`;
    else if (ph === 'advance') right = `<span class="hint td-sit-hint">${I('info', 'sm')}页头“整体推进”或选中已验收步骤推进其直接后继</span>`;
    else if (ph === 'waiting') right = `<button class="btn primary sm" data-a="focus-stat" data-s="wait">审批</button>`;
    else if (ph === 'stalled') right = `<button class="btn secondary sm" data-a="focus-stat" data-s="stall">查看并处理</button>`;
    else if (ph === 'failed') right = `<button class="btn primary sm" data-a="focus-stat" data-s="fail">查看原因并恢复</button>`;
    else if (ph === 'review') right = `<button class="btn primary sm" data-a="focus-stat" data-s="review">去验收</button>`;
    else if (ph === 'unknown') right = `<button class="btn secondary sm" data-a="reread-status">${I('refresh', 'sm')}立即重新读取</button>`;
    else if (isLegacy()) right = `<button class="btn secondary sm" data-a="legacy-info">${I('info', 'sm')}关于旧版记录</button>`;
    else right = `<button class="btn secondary sm" data-a="open-deliv">${I('inbox', 'sm')}${delivered() ? '查看交付回执' : '打开交付'}</button>`;
    const sit = adj ? ({ conflict: 'fail', reconfirm: 'need', ready: 'ok', editing: 'wait', pausing: 'unk' }[adj]) : PH[ph].sit;
    const fact = (k, f) => `<div class="td-fact"><span class="td-fk">${k}</span><span class="td-fv" style="color:${f[2]}">${f[0] === 'spin' ? '<span class="spin"></span>' : I(f[0], 'sm')}<span>${f[1]}</span></span></div>`;
    $('#situ').innerHTML = `<div class="situ td-situ ${sit}" role="status">
      ${a ? fact('计划', a) + '<span class="sep" aria-hidden="true"></span>' : ''}
      ${fact('执行与验收', e)}
      <span class="sep" aria-hidden="true"></span>
      ${fact('交付', d)}
      <span class="grow"></span>${right}</div>${bannersHTML()}`;
  }
  function bannersHTML() {
    const b = [];
    if (QP.get('note') === 'continued') b.push(`<div class="banner ok ut-banner">${I('check')}<div class="grow"><b>已按计划修订 ${planRev()} 继续执行。</b>恢复为调整前的设置：${priorLabel(QP.get('was') || prior)}${(QP.get('was') || prior) === 'off' ? '；执行中的步骤验收后等你“整体推进”或推进选中步骤的直接后继' : ''}。</div><button class="icon-btn" data-a="note-x" aria-label="关闭提示">${I('x', 'sm')}</button></div>`);
    if (QP.get('note') === 'abandoned') b.push(`<div class="banner info ut-banner">${I('info')}<div class="grow"><b>已放弃这次调整</b>，计划保持修订 ${planRev()}；已恢复调整前的设置：${priorLabel(QP.get('was') || prior)}。</div><button class="icon-btn" data-a="note-x" aria-label="关闭提示">${I('x', 'sm')}</button></div>`);
    if (QP.get('note') === 'adjusted-paused') b.push(`<div class="banner info ut-banner">${I('info')}<div class="grow"><b>调整已结束，计划修订 ${planRev()} 已确认。</b>任务仍是暂停状态（调整前就已暂停）；点“恢复任务”才会继续执行，自动节点推进保持${autoOn ? '开启' : '关闭'}。</div><button class="icon-btn" data-a="note-x" aria-label="关闭提示">${I('x', 'sm')}</button></div>`);
    if (QP.get('note') === 'started') b.push(`<div class="banner ok ut-banner">${I('play')}<div class="grow"><b>已开始执行${isFixed() ? '固定模板任务' : '计划修订 ' + planRev()}。</b>写文件的步骤只在${isGit() ? '任务工作区' : '独立副本'} ${esc(T.ws)} 中运行；${isFixed() ? '固定步骤继续锁定。' : '需要增删改还没开始的步骤时，用“调整待执行计划”。'}</div><button class="icon-btn" data-a="note-x" aria-label="关闭提示">${I('x', 'sm')}</button></div>`);
    if (adj === 'conflict') b.push(`<div class="banner warn ut-banner">${I('alert')}<div class="grow"><b>保存未成功：“${esc(nTitle(T.adj.conflict))}”在暂停生效前已被领取</b>（服务返回 REVISION_CONFLICT）。你的修改已保留为本地草稿，没有丢失。重新读取后，涉及已领取步骤的修改会被标出。</div><div class="actions"><button class="btn secondary sm" data-a="reread">重新读取并比对</button></div></div>`);
    if (adj === 'editing' && reread) b.push(`<div class="banner info ut-banner">${I('info')}<div class="grow"><b>已重新读取。</b>“${esc(nTitle(T.adj.conflict))}”已领取并锁定，你对它的修改不能再保存（已从草稿移出，内容可在右侧复制）。新增的“${esc(T.adj.add.title)}”接在它的输出之后，仍可保存。</div></div>`);
    return b.length ? `<div class="ut-banners">${b.join('')}</div>` : '';
  }
  function overlays() {
    $$('#cv .cv-overlay').forEach((e) => e.remove());
    $('#cv').insertAdjacentHTML('beforeend', `<div class="cv-overlay legend" aria-hidden="true"><span style="color:var(--run)">${I('play', 'sm')}执行中</span><span style="color:var(--warn)">${I('x', 'sm')}失败</span><span style="color:var(--done)">${I('check', 'sm')}完成</span>${editing() ? `<span>${I('lock', 'sm')}锁定</span><span>${I('edit', 'sm')}可修改</span>` : `<span>${I('inbox', 'sm')}交付端点可点击</span>`}</div>`);
    if (isUT()) {
      const tag = isFixed() ? ['', I('lock', 'sm') + `固定模板 · ${esc(T.tpl.name)} r${T.tpl.rev} · 创建后不能修改步骤`] : editing() ? ['partial', I('edit', 'sm') + `调整待执行计划 · 本地草稿${edits.added || edits.mod ? '（有未保存修改）' : ''}`] : adj === 'reconfirm' ? ['partial', I('alert', 'sm') + `计划修订 ${planRev() + 1} · 等待重新确认`] : isLegacy() ? ['', I('archive', 'sm') + '旧版记录 · 只读'] : null;
      if (tag) $('#cv').insertAdjacentHTML('beforeend', `<div class="cv-overlay ut-layer ${tag[0]}" role="status">${tag[1]}</div>`);
    }
    if (ph === 'parallel') $('#cv').insertAdjacentHTML('beforeend', `<div class="cv-overlay td-strategy"><div class="td-strategy-h">${I('split', 'sm')}并行写策略 <span class="badge outline">服务决定 · 只展示</span></div>
      <ol><li><b>${esc(nTitle('n2'))}</b>、<b>${esc(nTitle('n3'))}</b> 各写各的子${isGit() ? '工作区' : '副本'}（${esc(T.subs[0][1])} / ${esc(T.subs[1][1])}）</li><li>两步都验收后，由服务把子${isGit() ? '工作区' : '副本'}汇合到任务${isGit() ? '工作区' : '副本'}</li><li>回归测试与人工验收读汇合后的一致快照，不写原项目</li></ol></div>`);
    if (cfg.bg && bgNote) $('#cv').insertAdjacentHTML('beforeend', `<div class="cv-overlay td-bgnote" role="status" aria-live="polite">
      <span class="tile">${I('inbox')}</span>
      <div class="grow"><div class="td-bgnote-t">后台任务执行已结束 · 等待交付</div>
        <div class="hint">「${esc(FX.T2042.title)}」${FX.T2042.id} · 16:04 · 已放入任务列表与待处理中心。当前画布与选中保持不变。</div>
        <div class="row" style="gap:6px;margin-top:8px"><button class="btn secondary sm" data-a="open-bg">打开 ${FX.T2042.id}</button><button class="btn ghost sm" data-a="bg-dismiss">稍后处理</button></div></div>
      <button class="icon-btn" aria-label="关闭这条提示（任务仍在待处理中心）" data-a="bg-dismiss">${I('x', 'sm')}</button></div>`);
  }

  /* ---------- 右侧面板：交付 ---------- */
  function sideShow(on) { $('#side').classList.toggle('hidden', !on); }
  function closeSide() { panel = null; sideShow(false); decorate(); situ(); bar(); }
  function selectEnd() { quiet = true; if (cv.selected) cv.select(null); quiet = false; openDelivery(); cv.reveal('end'); }
  function openDelivery(t) {
    if (t) tab = t;
    if (cv.selected) { quiet = true; cv.select(null); quiet = false; }
    panel = 'delivery'; sideShow(true);
    const E = PH[ph].end;
    const tabs = [['overview', '交付概览'], ['changes', isGit() ? '任务变更' : '副本变更'], ['records', '交付记录']];
    if (isLegacy()) {
      $('#side').innerHTML = `<div class="side-head"><div class="grow"><div class="eyebrow">系统节点 · 旧版记录</div><div class="td-ptitle">交付</div><div class="row wrap" style="gap:6px;margin-top:8px"><span class="badge ${E[1]}">${I(E[2], 'sm')}${E[0]}</span></div></div><button class="icon-btn" aria-label="关闭交付面板，回到全图" data-a="close-side">${I('x')}</button></div>
        <div class="side-body"><div class="sec">${legacyHTML()}</div></div>`;
      decorate(); situ(); return;
    }
    $('#side').innerHTML = `
      <div class="side-head"><div class="grow"><div class="eyebrow">系统节点 · 任务级交付端点</div><div class="td-ptitle">交付</div>
        <div class="row wrap" style="gap:6px;margin-top:8px"><span class="badge ${E[1]}">${I(E[2], 'sm')}${E[0]}</span><span class="badge outline">${I(isGit() ? 'branch' : 'folder', 'sm')}${isGit() ? 'Git · 独立分支与 worktree' : '非 Git · 基线快照与独立副本'}</span></div></div>
        <button class="icon-btn" aria-label="关闭交付面板，回到全图" data-a="close-side">${I('x')}</button></div>
      <div class="tabs" role="tablist" aria-label="交付面板" style="padding:0 12px">${tabs.map(([k, l]) => `<button class="tab" role="tab" aria-selected="${tab === k}" data-a="tab" data-t="${k}">${l}</button>`).join('')}</div>
      <div class="side-body" id="sideBody">${{ overview: dOverview, changes: dChanges, records: dRecords }[tab]()}</div>
      ${dFooter()}`;
    decorate(); situ();
  }
  function legacyHTML() {
    return `<div class="banner">${I('archive')}<div><b>旧版任务记录</b><br>这个任务在独立工作区与交付端点上线前${ph === 'legacyStop' ? '终止' : '完成'}，执行时直接写入项目目录 <span class="mono td-wrap">${esc(T.projectPath)}</span>。没有任务工作区、交付回执或可清理对象；这里只读显示当时的步骤记录，不补造交付结果。</div></div>
      <dl class="td-kv" style="margin-top:14px"><dt>任务</dt><dd>${esc(T.title)} · <span class="mono">${T.id}</span></dd><dt>项目</dt><dd>${esc(T.project)}</dd><dt>结束</dt><dd>${esc(T.doneAt || '')} · ${ph === 'legacyStop' ? '已终止' : '已完成'}</dd><dt>需求</dt><dd>${T.rqId ? `需求目录 <span class="mono">${esc(T.rqId)}</span>` : '—'}</dd></dl>
      <p class="hint" style="margin-top:12px">要在新版流程里继续这项工作，请从“开始任务”新建任务；旧记录保持不变。</p>`;
  }
  const kv = (rows) => `<dl class="td-kv">${rows.filter(Boolean).map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>`;
  const sha = (s, what) => `<span class="td-sha">${esc(s)}</span><button class="icon-btn td-copy" aria-label="复制${what || s}" data-a="copy" data-what="${what || s}">${I('copy', 'sm')}</button>`;
  function receipt() {
    const fail = ph === 'deliveredFail';
    if (!isGit()) return `<div class="td-receipt ${fail ? 'warn' : 'ok'}"><div class="td-receipt-h">${I('check')}<b>${fail ? '已交付，验证未通过' : '任务已交付'}</b><span class="hint">${T.deliveredAt} · 由服务读回</span></div>
      ${kv([['完成目标', '将所选变更应用回原项目'], ['应用结果', `${T.applied.ok} 项写入原目录 · ${T.applied.keep} 项保留当前原文件 · ${T.applied.skip} 项暂不交付<div class="hint">写入：${esc(T.applied.okNote)}</div><div class="hint">${esc(T.applied.keepNote)}</div>`], ['原目录', `<span class="mono td-wrap">${esc(T.projectPath)}</span>`], ['验证', fail ? `<span style="color:var(--warn)">${I('x', 'sm')} ${esc(T.verify.fail)}</span><div class="hint">知情交付：依据原证据规则，失败记录保留</div>` : `<span style="color:var(--ok)">${I('check', 'sm')} ${esc(T.verify.ok)}</span>`], ['残留', `${esc(T.applied.skipNote)}；未复制资源不在副本中`]])}</div>`;
    return `<div class="td-receipt ${fail ? 'warn' : 'ok'}"><div class="td-receipt-h">${I('check')}<b>${fail ? '已交付，验证未通过' : '任务已交付'}</b><span class="hint">${T.deliveredAt} · 由服务读回</span></div>
      ${kv([['完成目标', '提交、推送并创建 MR · 3 / 3 步成功'], ['提交', `${sha(T.commit, '提交 SHA')}<div class="hint">作者 ${esc(T.author)} · 来自 设置 → Git 账号</div>`], ['远端分支', `<span class="mono td-wrap">${esc(T.remoteRef)}</span><div class="hint">新远端分支 · 未强推</div>`], ['合并请求', `<a href="${TD.href('td07-mr-detail', ctx())}" class="td-link">${I('link', 'sm')}${T.mr} → ${T.mrTarget}</a><div class="hint">${esc(T.mrTitle)}</div>`],
        ['验证', fail ? `<span style="color:var(--warn)">${I('x', 'sm')} ${esc(T.verify.fail)}</span><div class="hint">知情交付：依据失败候选规则（C33）由服务许可；与「全部通过」分开记录</div>` : `<span style="color:var(--ok)">${I('check', 'sm')} ${esc(T.verify.ok)}</span>`], ['残留', '未纳入 3 项（dist/、.env.local、coverage/）保留在工作区']])}</div>
      <div class="td-indep"><div class="td-indep-h"><span class="sec-t" style="margin:0">合并请求 ${T.mr} · 独立事实</span><span class="hint">GitLab 只读 · 读取于 16:40</span></div>
        <div class="row wrap" style="gap:6px;margin-top:6px"><span class="badge st-accent">${I('help', 'sm')}打开中 · 未合并</span></div>
        <p class="hint" style="margin-top:8px">合并在 GitLab 中进行，本产品不提供合并。MR 之后合并、关闭或冲突，都不改变这次任务交付的记录。</p>
        <button class="btn ghost sm" style="margin:6px 0 0 -10px" data-a="gitlab">${I('external', 'sm')}在 GitLab 打开</button></div>`;
  }
  function topBlock() {
    const g = isGit();
    switch (ph) {
      case 'running': case 'parallel': case 'advance': case 'paused': case 'waiting': case 'stalled': case 'failed': case 'review': case 'unknown':
        return `<div class="banner info">${I('info')}<div><b>执行尚未结束</b><br>${isUT() ? (titlesBy('run').length ? '「' + titlesBy('run').map(esc).join('」「') + '」执行中。' : '') : `「${esc(nTitle('n2'))}」「${esc(nTitle('n3'))}」执行中。`}全部步骤结束并验收后，这里会变为待交付。</div></div>`;
      case 'awaiting':
        return `<div class="lockline">${I('lock', 'sm')}<span><b class="ink">执行已结束，等待你选择交付。</b>交付前任务不算完成；各节点保留自己的验收结果，交付不会再跑一遍验收。</span></div>${T.origin && T.origin !== 'td' ? `<div class="lockline" style="margin-top:8px">${I('info', 'sm')}<span>原型说明：Git 工作台 / 应用视图只有 TD 样例数据（T-2041 / T-2043）；从这里进入时用它演示交付步骤，产品里按本任务 ${T.id} 读取。</span></div>` : ''}`;
      case 'blocked':
        return `<div class="banner warn" id="blkReasons">${I('alert')}<div><b>暂时不能交付</b>
          <ul class="td-reasons"><li><span><b>活动写入</b>：「回归测试」的执行进程仍持有任务工作区写入（最后心跳 16:03:12）。</span><button class="btn ghost sm" data-a="focus-n4">${I('target', 'sm')}定位到节点</button></li>
          <li><span><b>未停稳</b>：执行结束请求已发出，执行服务尚未确认进程退出。</span><button class="btn ghost sm" data-a="audit">${I('clock', 'sm')}查看审计记录</button></li></ul>
          <div class="hint">停稳后由服务读回，按钮自动可用；界面不会跳过这一步，也不会代你结束进程。</div></div></div>`;
      case 'nochg':
        return `<div class="banner info">${I('info')}<div><b>没有文件变更</b><br>任务${g ? '工作区与基线 <span class="mono">main @ 7c1e9a2</span>' : '副本与基线快照 <span class="mono">bs-0915-0940</span>'} 一致。不会生成空提交${g ? '，也不会创建合并请求' : '，也不会写入原目录'}。</div></div>
          <div class="td-cand"><div class="row wrap" style="gap:6px"><span class="badge td-candtag">${I('help', 'sm')}候选 · 待产品 / API 核准</span></div>
          <p>「确认无文件交付并结束」是建议中的特殊结算，尚未成为已确认的能力。原型点击只显示说明，不会结算；在此之前任务保持「等待交付」。</p></div>`;
      case 'failcand':
        return `<div class="banner warn">${I('x')}<div><b>回归测试未通过：2 个用例失败</b><ul class="td-plain"><li>export 分页边界 › 末页为空时页码越界</li><li>export 分页边界 › 单页 1000 条时漏掉最后一条</li></ul><span class="hint">失败记录保留。界面不能把它改成通过，也没有「忽略失败」的勾选。</span></div></div>
          ${auth === 'allow'
            ? `<div class="td-auth allow"><div class="td-auth-h">${I('shield', 'sm')}交付资格 · 由原证据规则判定</div><div class="td-auth-v" style="color:var(--ok)">${I('check', 'sm')}允许知情交付</div><p>依据：失败候选规则（C33）· 执行正常结束、失败已记录 · 判定于 16:01。提交时需要你再次确认知情；交付后显示「已交付，验证未通过」，与全部通过分开。</p></div>`
            : `<div class="td-auth deny"><div class="td-auth-h">${I('shield', 'sm')}交付资格 · 由原证据规则判定</div><div class="td-auth-v" style="color:var(--warn)">${I('lock', 'sm')}不允许交付此结果</div><p>原因：该失败不在可知情交付的范围内（回归测试属于必需验收）。可以恢复「回归测试」重新验收；文件保留在工作区。</p></div>`}`;
      case 'committed':
        return `<div class="banner info">${I('info')}<div><b>提交已成功，任务尚未完成</b><br>所选目标是「提交、推送并创建 MR」。推送不会自动发送，需要你单独确认；创建 MR 在推送成功后再确认。</div></div>
          <ol class="td-steps"><li class="ok">${I('check', 'sm')}<span>① 提交 <span class="td-sha">${T.commit}</span><span class="hint"> · 回执 16:12</span></span></li><li class="cur">${I('clock', 'sm')}<span>② 推送到 <span class="mono">${esc(T.remoteRef)}</span> · 等待你确认</span></li><li>${I('clock', 'sm')}<span>③ 创建 MR → main · 未开始</span></li></ol>`;
      case 'pushUnknown':
        return `<div class="banner unknown">${I('help')}<div><b>推送回执未知</b><br>16:15 发出的推送没有收到可信回执。只能核对原推送，不会重新发送；核对前任务保持待核对。</div></div>`;
      case 'delivered': case 'deliveredFail': case 'cleaned': case 'cleanPartial':
        return receipt() + (ph === 'cleaned' ? `<div class="banner" style="margin-top:12px">${I('archive')}<div><b>工作区已清理</b>（10-15 16:45）<br>可查看提交 / 保存的证据；本地文件与 diff 已不可用。</div></div>` : ph === 'cleanPartial' ? `<div class="banner unknown" style="margin-top:12px">${I('help')}<div><b>清理未完成 · 待核对原清理</b><br>交付回执不受影响。打开工作区详情核对原清理操作。</div></div>` : '');
      case 'cancelled':
        return `<div class="banner">${I('archive')}<div><b>任务已于 15:10 取消</b><br>文件保留，可稍后交付 / 查看：任务${g ? '工作区与任务分支' : '副本'}没有被清理。交付已完成的部分不会把任务改成已完成，取消记录保留。</div></div>`;
    }
    return '';
  }
  function dOverview() {
    const g = isGit(), A = ph === 'nochg' ? { A: 0, M: 0, D: 0 } : T.adm;
    const vFail = ['failcand', 'deliveredFail'].includes(ph), running = notEnded();
    const nAll = allNodes().filter((n) => !n.system).length, nDone = Object.values(st()).filter((x) => x === 'done').length;
    const passN = isUT() ? `${nDone} / ${nAll}` : ph === 'cancelled' ? '3 / 5' : running ? '1 / 5' : vFail ? '4 / 5' : '5 / 5';
    const goal = g ? ({ committed: '提交、推送并创建 MR', pushUnknown: '提交、推送并创建 MR' }[ph] || (delivered() ? '提交、推送并创建 MR' : '尚未选择 · 在 Git 工作台三选一')) : (delivered() ? '将所选变更应用回原项目' : '将所选变更应用回原项目 · 尚未选择文件');
    const action = { committed: '等待你确认推送', pushUnknown: '核对原推送', blocked: '无 · 等待执行停稳' }[ph] || (running ? '无' : delivered() ? '无 · 已结算' : '无');
    const orig = { committed: `提交 <span class="td-sha">${T.commit}</span> 已结算（回执 16:12）`, pushUnknown: `<span style="color:var(--unknown)">${I('help', 'sm')} 推送 · 回执未知（原请求 req·p-2041-1）</span>` }[ph] || (delivered() ? '全部原请求已结算' : '无待核对的原请求');
    const pending = delivered() ? (g ? '未纳入 3 项保留在工作区（不在交付范围）' : 'config/report.yaml 暂不交付，留在独立副本') : ph === 'nochg' ? '无' : `${total()} 个文件未交付 · ${T.excluded.length} 项未纳入（不会交付）`;
    const retained = ph === 'cleaned' ? `已清理本地${g ? '任务分支、worktree 目录与子工作区' : '独立副本与子副本'}（你于 16:45 确认）<div class="hint">保留：${g ? '远端分支、MR、提交、' : '原目录、基线快照、'}全部回执与记录</div>`
      : `${g ? `任务分支 <span class="mono">${esc(T.branch)}</span> · worktree 目录${isUT() ? '' : ' · 子工作区 2 个（已汇合）'}` : `独立副本 · 基线快照 <span class="mono">${T.baseline}</span>${isUT() ? '' : ' · 子副本 2 个（已汇合）'}`}<div class="hint">全部保留，不会自动或定时清理${ph === 'cleanPartial' ? ' · 清理未完成，待核对' : ''}</div>`;
    return `${topBlock() ? `<div class="sec">${topBlock()}</div>` : ''}
      <div class="sec"><div class="sec-t">身份</div>${kv([
        ['任务', `${esc(T.title)} · <span class="mono">${T.id}</span><div class="hint">执行 ${T.exec} · 流程 ${esc(T.flow)}</div>`],
        ['项目', `${esc(T.project)}<div class="mono td-wrap td-dim">${esc(T.projectPath)}</div>`],
        ['工作区', g ? `${esc(T.ws)}<div class="hint">分支 <span class="mono">${esc(T.branch)}</span> · 基线 <span class="mono">${T.base} @ ${T.baseSha}</span></div>` : `${esc(T.ws)}<div class="hint">基线快照 <span class="mono">${T.baseline}</span> · ${T.baselineAt} · ${T.scope}</div>`],
      ])}</div>
      <div class="sec"><div class="sec-t">执行与验收</div>
        <div class="td-line">${I(vFail ? 'x' : running ? 'play' : ph === 'cancelled' ? 'stop' : 'check', 'sm')}<span><b>${passN}</b> 步通过验收${vFail ? ' · 回归测试失败' : ph === 'cancelled' ? ' · 任务已取消，回归测试与人工验收未开始' : running ? ' · 执行中' : ''}</span></div>
        <div class="td-line" style="color:${vFail ? 'var(--warn)' : 'var(--ink-2)'}">${I(vFail ? 'alert' : 'doc', 'sm')}<span>${running || ph === 'cancelled' ? '验证尚未运行' : esc(vFail ? T.verify.fail : T.verify.ok)}</span></div>
        ${running || ph === 'cancelled' ? '' : `<details class="td-log"><summary><span class="chev">${I('chevRight', 'sm')}</span>验证日志 · 回归测试 尝试 1</summary><div class="log">
          <div class="m"><span class="who">15:52</span><span><span class="tool">bash</span> npm run lint</span></div><div class="res">→ 0 problems</div>
          <div class="m"><span class="who">15:53</span><span><span class="tool">bash</span> npm test</span></div><div class="res"${vFail ? ' style="color:var(--warn)"' : ''}>→ ${vFail ? '2 failed, 39 passed' : '41 passed'}</div>
          <div class="m"><span class="who">15:58</span><span><span class="tool">bash</span> npm run test:regression</span></div><div class="res"${vFail ? ' style="color:var(--warn)"' : ''}>→ ${vFail ? '2 failed (export pagination)' : 'all passed'}</div></div></details>`}</div>
      <div class="sec"><div class="sec-t">变更统计</div>
        <div class="td-adm"><div><span class="td-tag a">A</span><b class="num">${A.A}</b><span>新增</span></div><div><span class="td-tag m">M</span><b class="num">${A.M}</b><span>修改</span></div><div><span class="td-tag d">D</span><b class="num">${A.D}</b><span>删除</span></div></div>
        <p class="hint" style="margin-top:8px">${ph === 'cleaned' ? '数字来自交付回执；本地文件已清理' : `快照 ${T.changesRev} · 读取于 ${T.readAt}${T.lines && ph !== 'nochg' ? ' · ' + T.lines : ''} · 另有 ${T.excluded.length} 项未纳入`}${running ? ' · 执行中，数字会变化' : ''}</p></div>
      <div class="sec"><div class="sec-t">交付进度</div>${kv([['所选目标', goal], ['当前动作', action], ['原请求核对', orig], ['未处理项', pending]])}</div>
      <div class="sec"><div class="sec-t">保留资源</div><p class="td-p">${retained}</p></div>
      <p class="hint td-upd">${I('refresh', 'sm')} 最后更新 ${delivered() ? '16:40:12' : ph === 'committed' ? '16:12:30' : '16:02:41'} · 由服务读回；重新打开任务会从服务恢复这些事实，不依赖瞬时提示。</p>
      ${protoBox()}`;
  }
  function protoBox() {
    const segs = [];
    if (!cfg.gitOnly && !cfg.kind && !isUT() && !QP.get('task')) segs.push(['kind', '项目类型', [['git', 'Git · T-2041'], ['dir', '非 Git · T-2043']], kind]);
    if (ph === 'failcand') segs.push(['auth', '原规则判定', [['allow', '允许知情交付'], ['deny', '不允许']], auth]);
    if (!segs.length) return '';
    return `<div class="td-protobox" aria-label="原型变体切换（非产品界面）"><span class="td-protobox-k">原型变体 · 非产品界面</span>${segs.map(([k, l, opts, cur]) => `<div class="row wrap" style="gap:8px"><span class="hint">${l}</span><div class="seg" role="group" aria-label="${l}">${opts.map(([v, t]) => `<button aria-pressed="${cur === v}" data-a="var" data-k="${k}" data-v="${v}">${t}</button>`).join('')}</div></div>`).join('')}</div>`;
  }
  function dChanges() {
    const g = isGit();
    const files = ph === 'nochg' ? [] : T.files;
    const head = ph === 'cleaned' ? `<div class="banner">${I('archive')}<div><b>工作区已清理，可查看提交 / 保存证据</b><br>下方清单来自交付回执；本地文件与 diff 已不可用，不显示为仍在。</div></div>`
      : ph === 'nochg' ? `<div class="empty" style="padding:28px 12px"><span class="tile">${I('doc', 'lg')}</span><h3>没有文件变更</h3><p>与基线一致，不会生成空提交${g ? '或假 MR' : ''}。</p></div>`
      : `<p class="hint">快照 ${T.changesRev} · 读取于 ${T.readAt}。这里只读；选择文件与${g ? '提交' : '应用'}在${g ? ' Git 工作台「任务变更」' : '「应用到原项目」视图'}中进行。</p>`;
    return `<div class="sec">${head}</div>
      ${files.length ? `<div class="sec"><div class="sec-t">${ph === 'cleaned' ? '已交付文件（来自回执）' : '变更文件'} · ${files.length}</div><div class="td-files">${files.map(([k, p, n, note]) => `<div class="td-file"><span class="td-tag ${k.toLowerCase()}" aria-label="${{ A: '新增', M: '修改', D: '删除' }[k]}">${k}</span><span class="grow"><span class="mono td-wrap">${esc(p)}</span>${note ? `<span class="hint"> · ${esc(note)}</span>` : ''}</span><span class="num td-n">${esc(n)}</span></div>`).join('')}</div></div>` : ''}
      ${ph === 'nochg' ? '' : `<div class="sec"><div class="sec-t">未纳入 · ${T.excluded.length}</div><div class="td-files">${T.excluded.map(([p, r]) => `<div class="td-file"><span class="td-tag x" aria-label="未纳入">—</span><span class="grow"><span class="mono">${esc(p)}</span></span><span class="hint">${esc(r)}</span></div>`).join('')}</div></div>`}
      ${ph === 'cleaned' || notEnded() ? '' : `<div class="sec"><button class="btn secondary sm" data-a="deliver-view"${ph === 'nochg' ? ' aria-disabled="true"' : ''}>${I('external', 'sm')}${g ? '在 Git 工作台查看 diff' : '在应用视图查看三方比较'}</button></div>`}`;
  }
  function dRecords() {
    const g = isGit();
    const R = [[isUT() ? '14:26' : '10:31', `准备${g ? '独立工作区' : '独立副本'}`, '已结算', 'ok']];
    if (ph === 'cancelled') R.push(['15:10', '取消任务 · 执行服务确认停稳', '已结算', 'ok'], ['15:10', '工作区保留（未清理）', '保留中', 'idle']);
    else if (!notEnded()) R.push(['16:01', '执行结束 · 交付端点到达', ph === 'blocked' ? '执行未停稳' : '已记录', ph === 'blocked' ? 'stall' : 'ok'], ['16:02', `读取变更快照 ${T.changesRev}`, '只读', 'idle']);
    if (['committed', 'pushUnknown', 'delivered', 'deliveredFail', 'cleaned', 'cleanPartial'].includes(ph)) {
      if (g) {
        R.push(['16:10', '选择完成目标：提交、推送并创建 MR', '已记录', 'idle'], ['16:12', `提交 ${T.commit} · req·c-2041-1`, '已结算', 'ok']);
        if (ph === 'pushUnknown') R.push(['16:15', `推送 ${T.remoteRef} · req·p-2041-1`, '回执未知', 'unknown']);
        if (delivered()) R.push(['16:15', `推送 ${T.remoteRef} · req·p-2041-1`, '已结算', 'ok'], ['16:20', `创建 MR ${T.mr} · req·m-2041-1`, '已结算', 'ok']);
      } else if (delivered()) R.push([T.frozenAt, `冻结应用预览 · 写入 ${T.applied.ok} 项 · 保留当前原文件 ${T.applied.keep} 项 · 暂不交付 ${T.applied.skip} 项`, '已记录', 'idle'], [T.appliedAt, `应用到原目录 · ${T.applied.ok} 项逐项成功`, '已结算', 'ok']);
      if (delivered()) R.push([T.deliveredAt.slice(6), ph === 'deliveredFail' ? '服务结算：已交付，验证未通过' : '服务结算：任务已交付', '完成记录', 'ok']);
      if (ph === 'cleanPartial') R.push(['16:31', '清理工作区 · req·w-2041-1', '部分完成 · 待核对', 'unknown']);
      if (ph === 'cleaned') R.push(['16:45', '清理工作区 · req·w-2041-1', '已结算', 'ok']);
    }
    const B = { ok: 'st-ok', idle: 'st-idle', unknown: 'st-unknown', stall: 'st-stall' };
    return `<div class="sec"><p class="hint" style="margin-bottom:12px">原请求与回执按时间排列；核对只读取原记录，不会重发。</p>
      <div class="td-tl">${R.map(([t, x, s, k]) => `<div class="td-tl-row"><span class="mono td-tl-t">${t}</span><span class="grow">${esc(x)}</span><span class="badge ${B[k]}">${s}</span></div>`).join('')}</div></div>`;
  }
  function dFooter() {
    const g = isGit();
    const ws = `<button class="btn ghost sm" data-a="ws">${I('folder', 'sm')}工作区详情</button>`;
    const go = `<button class="btn primary" data-a="deliver">${g ? '查看变更并交付' : '查看变更并应用'}${I('arrowRight', 'sm')}</button>`;
    const dis = (reason) => `<div class="td-dis" id="delivReason">${I('lock', 'sm')}<span>${reason}</span></div>${ws}<span class="grow"></span><button class="btn primary" aria-disabled="true" aria-describedby="delivReason" data-a="deliver-dis">${g ? '查看变更并交付' : '查看变更并应用'}</button>`;
    let f;
    switch (ph) {
      case 'running': case 'parallel': case 'advance': case 'paused': case 'waiting': case 'stalled': case 'failed': case 'review': case 'unknown': f = dis('执行尚未结束，结束并验收后才能交付'); break;
      case 'blocked': f = dis('不能交付：仍有活动写入，执行未停稳（见上方原因）'); break;
      case 'failcand': f = auth === 'allow' ? `${ws}<span class="grow"></span>${go}` : dis('不能交付：原证据规则不允许交付此失败结果'); break;
      case 'nochg': f = `${ws}<span class="grow"></span><button class="btn secondary" data-a="nochg">确认无文件交付并结束<span class="badge td-candtag">候选</span></button>`; break;
      case 'committed': f = `${ws}<span class="grow"></span><button class="btn primary" data-a="continue-push">继续交付：确认推送${I('arrowRight', 'sm')}</button>`; break;
      case 'pushUnknown': f = `${ws}<span class="grow"></span><button class="btn primary" data-a="check-push">${I('search', 'sm')}核对原推送</button>`; break;
      case 'delivered': case 'deliveredFail': case 'cleaned': case 'cleanPartial':
        f = `${ws}<span class="grow"></span>${g ? `<button class="btn secondary" data-a="view-mr">${I('link', 'sm')}查看 MR ${T.mr}</button>` : `<button class="btn secondary" data-a="view-applied">${I('doc', 'sm')}查看应用回执</button>`}`; break;
      default: f = `${ws}<span class="grow"></span>${go}`;
    }
    return `<div class="side-foot td-foot">${f}</div>`;
  }

  /* ---------- 右侧面板：步骤 ---------- */
  function openNode(id, t) {
    if (!id) { closeSide(); return; }
    if (editing() && isUT()) return openEditNode(id);
    if (['session', 'attempts'].includes(t)) { const n = allNodes().find((x) => x.id === id); SC.openExecutionNode(id, t, { title: n && n.title, taskTitle: T.title }); return; }
    if (t) nodeTab = t;
    panel = 'node'; sideShow(true);
    const n = allNodes().find((x) => x.id === id), s = st()[id], SS = DSCanvas.STATUS[s] || DSCanvas.STATUS.idle;
    if (!n) { closeSide(); return; }
    const showTabs = !['idle', 'ready', 'adv', 'claimed'].includes(s) && !n.added; if (!showTabs) nodeTab = 'overview';
    const tabs = [['overview', '概览'], ['session', '执行现场'], ['attempts', '尝试与产出']];
    $('#side').innerHTML = `
      <div class="side-head"><div class="grow"><div class="eyebrow">步骤 ${allNodes().indexOf(n)} · ${esc(n.role || '')}${isFixed() ? ' · 固定模板' : ''}</div><div class="td-ptitle">${esc(n.title)}</div><span class="badge ${SS[1]}" style="margin-top:8px">${I(SS[2], 'sm')}${SS[0]}</span></div>
        <button class="icon-btn" aria-label="关闭步骤详情，回到全图" data-a="desel">${I('x')}</button></div>
      ${showTabs ? `<div class="tabs" role="tablist" style="padding:0 12px">${tabs.map(([k, l]) => `<button class="tab" role="tab" aria-selected="${nodeTab === k}" data-a="node-tab" data-id="${id}" data-t="${k}">${l}</button>`).join('')}</div>` : ''}
      <div class="side-body">${{ overview: nOverview, session: nSession, attempts: nAttempts }[nodeTab](n, s)}</div>
      <div class="side-foot td-foot">${nFooter(n, s)}</div>`;
    decorate();
  }
  function writePos(n) {
    const g = isGit(), W = g ? '工作区' : '副本';
    if (isUT() && T.origin !== 'td') {
      const ro = n.w === 'ro' || /产品经理|人工/.test(n.role || '');
      return ro ? `<div class="td-wpos">${I('eye', 'sm')}<div><b>只读</b><div class="hint">读取任务${W}的一致快照，不写文件</div></div></div>`
        : `<div class="td-wpos">${I(g ? 'branch' : 'folder', 'sm')}<div><b>写入：任务${W}</b> <span class="mono" style="font-size:12px">${esc(T.ws)}</span><div class="hint">同任务写入按原有互斥规则逐个领取；不写原项目目录。</div></div></div>`;
    }
    const i = n.id === 'n2' ? 0 : n.id === 'n3' ? 1 : -1;
    if (i >= 0) return `<div class="td-wpos">${I(g ? 'branch' : 'folder', 'sm')}<div><b>${esc(T.subs[i][1])}</b> · 本步骤独占写入<div class="hint">从任务${W}分出；两步都验收后由服务汇合到任务${W} <span class="mono">${esc(T.ws)}</span>。不写原项目目录。</div></div></div>`;
    if (n.id === 'n4') return `<div class="td-wpos">${I('eye', 'sm')}<div><b>读汇合后的一致快照</b><div class="hint">测试产物写入 coverage/（未纳入交付）</div></div></div>`;
    return `<div class="td-wpos">${I('eye', 'sm')}<div><b>只读</b><div class="hint">${n.id === 'n1' ? '读取基线一致快照，不写文件' : '只读验收，不写文件'}</div></div></div>`;
  }
  function preds(id) { return cvOpt.edges.filter((e) => e.to === id).map((e) => e.from).filter((x) => x !== 'start'); }
  function succs(id) { return cvOpt.edges.filter((e) => e.from === id).map((e) => e.to).filter((x) => x !== 'end'); }
  function nOverview(n, s) {
    let top = '';
    if (s === 'fail') top = `<div class="reason" style="background:var(--warn-fill)"><b style="color:var(--warn)">失败原因</b><br>${isUT() ? '3 个用例断言不通过（尝试 3 / 3 已用完，不会自动重试）。' : '2 个用例断言不通过：<ul style="margin:6px 0 0;padding-left:18px;color:var(--ink-2)"><li>export 分页边界 › 末页为空时页码越界</li><li>export 分页边界 › 单页 1000 条时漏掉最后一条</li></ul>'}<div class="hint" style="margin-top:6px">${isUT() ? '失败记录保留；可以在这里恢复这一步，或从“更多 → 任务恢复…”进入独立恢复工作台。' : '失败记录保留；是否允许知情交付由原证据规则判定，见「交付」端点。'}</div></div>`;
    if (s === 'stall') top = `<div class="reason" style="background:var(--stall-fill);color:var(--ink-2)"><b style="color:var(--stall)">为什么停滞</b><br>执行器报告 18 分钟内没有新的输出。最后一条记录：请求读取 <span class="mono">config/database.yml</span>（项目目录内，含连接配置），等待你授权。<div class="row wrap" style="margin-top:10px;gap:6px"><button class="btn primary sm" data-a="approve" data-s="stall">允许本次读取</button><button class="btn ghost sm" style="color:var(--danger)" data-a="deny">拒绝</button></div><div class="hint" style="margin-top:6px">停滞由执行服务判定，不是界面计时。</div></div>`;
    if (s === 'wait') top = `<div class="reason" style="background:var(--wait-fill)"><b style="color:var(--wait)">需要你审批</b><br>写入 <span class="mono">docs/api-reference.md</span>（任务工作区内）。<div class="row wrap" style="margin-top:10px;gap:6px"><button class="btn primary sm" data-a="approve" data-s="wait">允许本次</button><button class="btn secondary sm" data-a="approve" data-s="wait" data-all="1">本任务内都允许</button><button class="btn ghost sm" style="color:var(--danger)" data-a="deny">拒绝</button></div></div>`;
    if (s === 'review') top = `<div class="reason" style="background:var(--wait-fill)"><b style="color:var(--wait)">请确认结果是否达到目标</b><br>目标：${esc(T.title)}<div class="row wrap" style="margin-top:10px;gap:6px"><button class="btn secondary sm" data-a="node-tab" data-id="${n.id}" data-t="attempts">${I('file', 'sm')}变更摘要</button><button class="btn secondary sm" data-a="node-tab" data-id="${n.id}" data-t="attempts">${I('doc', 'sm')}测试报告</button></div></div>`;
    if (s === 'unknown') top = `<div class="reason" style="background:var(--unknown-fill);border:1px dashed var(--unknown-line)"><b style="color:var(--unknown)">状态未核对</b><br>无法确认这一步是否仍在执行。画布显示的是上次读到的进度，核对前不能修改或恢复它。</div>`;
    if (s === 'paused') top = `<div class="lockline">${I('pause', 'sm')}<span><b class="ink">任务已暂停，这一步停在安全点。</b>恢复任务后从安全点继续；已产出的内容保留。</span></div>`;
    if (s === 'adv') { const ps = preds(n.id).map(nTitle); top = `<div class="lockline">${I('play', 'sm')}<span><b class="ink">前置已验收，等待推进。</b>前置：${ps.map(esc).join('、')}。点页头“整体推进”，或选中前置步骤“推进直接后继”。</span></div>`; }
    if (s === 'claimed') top = `<div class="lockline">${I('lock', 'sm')}<span><b class="ink">已被调度领取，当前不可修改。</b></span></div>`;
    if (isFixed()) top += `<div class="lockline" style="margin-top:8px">${I('lock', 'sm')}<span>固定模板步骤：职业、依赖、模型、验收与参数在创建时固定，不能修改。可以查看、调整布局、查看执行现场，失败时按原配置重试。</span></div>`;
    const strat = ph === 'parallel' && (n.id === 'n2' || n.id === 'n3') ? `<div class="sec"><div class="sec-t">并行写策略 · 服务决定</div><div class="td-flow">
      <div class="td-flow-r"><span class="chip">${esc(nTitle('n2'))}</span>${I('arrowRight', 'sm')}<span class="chip">${esc(T.subs[0][1])}</span></div>
      <div class="td-flow-r"><span class="chip">${esc(nTitle('n3'))}</span>${I('arrowRight', 'sm')}<span class="chip">${esc(T.subs[1][1])}</span></div>
      <div class="td-flow-r">${I('chevRight', 'sm')}<span>汇合（服务执行）</span>${I('arrowRight', 'sm')}<span class="chip">任务${isGit() ? '工作区' : '副本'}</span>${I('arrowRight', 'sm')}<span>回归测试读一致快照</span></div></div>
      <p class="hint" style="margin-top:8px">策略由调度服务决定并在这里展示，不需要你分配目录。汇合有冲突时，汇合步骤会停下并在画布上显示原因。</p></div>` : '';
    const advSec = isUT() && !autoOn && s === 'done' && !adj ? advSuccHTML(n) : '';
    return `${top ? `<div class="sec">${top}</div>` : ''}${advSec}
      <div class="sec"><div class="sec-t">写入位置</div>${writePos(n)}</div>${strat}
      <div class="sec"><div class="sec-t">这一步做什么</div><p class="td-p">${esc(n.what || n.meta || '')}</p></div>
      <div class="sec"><div class="sec-t">谁来做</div><div class="att"><span class="cv-av" style="width:28px;height:28px;background:var(--accent-fill);color:var(--accent)">${n.role === '人工' ? I('users', 'sm') : esc((n.role || '?')[0])}</span><span class="grow">${esc(n.role || '')}<div class="hint">${isFixed() ? '模板指定的职业' : '执行时冻结的职业'}</div></span></div></div>
      <div class="sec"><div class="sec-t">产出</div><div class="att">${I('file', 'sm')}<span class="grow">${esc(n.output || n.meta || '')}</span>${s === 'done' || s === 'fail' || s === 'review' ? '<button class="btn ghost sm" data-a="node-tab" data-id="' + n.id + '" data-t="attempts">打开</button>' : '<span class="hint">尚未产出</span>'}</div></div>`;
  }
  function advSuccHTML(n) {
    const s = st(), out = succs(n.id).map((id) => { const ps = preds(id); const waitP = ps.filter((p) => s[p] !== 'done'); return { id, t: nTitle(id), st: s[id], waitP }; });
    if (!out.length) return '';
    const ready = out.filter((o) => o.st === 'adv' && !o.waitP.length);
    return `<div class="sec"><div class="sec-t">直接后继 · 自动推进已关闭</div><div class="ut-succ">${out.map((o) => `<div class="ut-succ-r"><span class="grow">${esc(o.t)}</span>${o.st === 'adv' && !o.waitP.length ? `<span class="badge st-wait">${I('play', 'sm')}可推进</span>` : o.waitP.length ? `<span class="badge st-idle" title="并行汇合：等全部前置验收">${I('clock', 'sm')}等「${esc(o.waitP.map(nTitle).join('、'))}」</span>` : `<span class="badge ${DSCanvas.STATUS[o.st][1]}">${DSCanvas.STATUS[o.st][0]}</span>`}</div>`).join('')}</div>
      ${ready.length ? `<button class="btn primary sm" data-a="advance-succ" data-id="${n.id}" style="margin-top:10px">${I('play', 'sm')}推进直接后继 · ${ready.length} 步</button>` : `<p class="hint" style="margin-top:8px">${out.some((o) => o.waitP.length) ? '有多个前置的步骤要等全部前置验收（并行汇合），此次不会启动。' : '直接后继已开始或已完成。'}</p>`}
      <p class="hint" style="margin-top:6px">只启动这一步的直接后继；它们验收后不会自动继续（同次不级联）。</p></div>`;
  }
  function nSession(n, s) {
    return `<div class="row" style="margin-bottom:12px"><span class="badge ${s === 'run' ? 'st-run' : 'st-idle'}">${s === 'run' ? '<span class="dot pulse"></span>实时' : '已结束'}</span><span class="hint">尝试 1 · 开始于 14:20</span></div>
      <div class="log"><div class="m"><span class="who">14:20</span><span>读取需求说明与接口约定</span></div>
      <div class="m"><span class="who">14:31</span><span><span class="tool">edit</span> 任务工作区内文件</span></div><div class="res">→ +182</div></div>
      <p class="hint" style="margin-top:14px">完整执行现场在节点详情。</p>`;
  }
  function nAttempts(n, s) {
    const a = s === 'fail' ? ['尝试 3', '失败 · 3 个用例未通过', 'st-fail', '失败'] : s === 'run' ? ['尝试 1', '进行中', 'st-run', '进行中'] : ['尝试 1', '通过 · 双评审一致', 'st-done', '通过'];
    return `<div class="att"><span class="grow"><div>${a[0]}</div><div class="hint">${a[1]}</div></span><span class="badge ${a[2]}">${a[3]}</span><button class="btn ghost sm" data-a="node-tab" data-id="${n.id}" data-t="attempts">查看</button></div>`;
  }
  function nFooter(n, s) {
    const live = `<button class="btn ghost sm" data-a="node-tab" data-id="${n.id}" data-t="session">${I('terminal', 'sm')}执行现场</button>`;
    return {
      run: `<span class="grow"></span><button class="btn primary" data-a="node-tab" data-id="${n.id}" data-t="session">${I('terminal', 'sm')}查看执行现场</button>`,
      done: `<span class="grow"></span><button class="btn secondary" data-a="node-tab" data-id="${n.id}" data-t="attempts">查看产出</button>`,
      fail: `<button class="btn ghost sm" data-a="node-tab" data-id="${n.id}" data-t="attempts">查看尝试</button><span class="grow"></span><button class="btn secondary" data-a="recover" data-id="${n.id}">${I('refresh', 'sm')}恢复这一步…</button>`,
      stall: `${live}<span class="grow"></span><button class="btn secondary" data-a="restart-step">${I('refresh', 'sm')}重新开始这一步</button>`,
      wait: `${live}<span class="grow"></span><span class="hint">审批后这一步继续执行</span>`,
      review: `<button class="btn ghost sm" style="color:var(--danger)" data-a="reject-review">退回修改</button><span class="grow"></span><button class="btn primary" data-a="accept">${I('check', 'sm')}验收通过</button>`,
      unknown: `<span class="hint grow">核对完成前不能操作</span>`,
      paused: `${live}<span class="grow"></span><span class="hint">恢复任务后继续</span>`,
      adv: `<span class="hint grow">等待推进</span>`,
      skip: `<span class="hint grow">已移出计划 · 未执行</span>`,
      claimed: `<span class="hint grow">已被领取 · 即将开始</span>`,
      idle: `<span class="hint grow">等待前面的步骤完成</span>`,
    }[s] || '';
  }
  function openAudit() {
    if (cv.selected) { quiet = true; cv.select(null); quiet = false; }
    panel = 'audit'; sideShow(true); decorate();
    const rows = isUT() ? auditRows() : [['10:31', '准备独立工作区成功，开始执行'], ['14:20', `「${nTitle('n2')}」「${nTitle('n3')}」开始，各写子工作区`], ['15:40', '服务汇合子工作区到任务工作区'], ['16:01', '人工验收通过；执行结束请求已发出'], ['16:03', '「回归测试」执行进程仍在写入，未确认退出（等待服务确认停稳）']];
    $('#side').innerHTML = `<div class="side-head"><div class="grow"><div class="eyebrow">只读</div><div class="td-ptitle">审计记录</div></div><button class="icon-btn" aria-label="关闭" data-a="close-side">${I('x')}</button></div>
      <div class="side-body"><div class="log" style="font-family:var(--font)">${rows.map(([t, x]) => `<div class="m"><span class="who mono">${t}</span><span style="font-size:13px">${esc(x)}</span></div>`).join('')}</div></div>
      <div class="side-foot"><button class="btn ghost sm" data-a="open-deliv">${I('arrowLeft', 'sm')}回到交付</button></div>`;
  }
  function auditRows() {
    const r = [['14:21', `你确认了计划（修订 ${T.planRev || 2}）${isFixed() ? ' · 固定模板 ' + T.tpl.ref + '@r' + T.tpl.rev : ''}`], ['14:26', '准备独立工作区成功'], ['14:27', '开始执行；自动节点推进：' + ((T.auto !== false) ? '开启' : '关闭')]];
    if (T.id === 'T-2035') r.push(['13:40', '你关闭了自动节点推进（之后由你推进）']);
    if (T.execState === 'paused') r.push(['11:20', '你暂停了任务：运行中的步骤停在安全点']);
    if (QP.get('added') === '1') r.push(['14:52', `调整待执行计划：保存修订 ${planRev()}（新增“${T.adj.add.title}”）`], ['14:53', `你重新确认了计划修订 ${planRev()}；继续时恢复原设置（${priorLabel(QP.get('was') || prior)}）`]);
    return r;
  }
  function openPlan() {
    if (cv.selected) { quiet = true; cv.select(null); quiet = false; }
    panel = 'plan'; sideShow(true); decorate();
    const req = hasReq();
    $('#side').innerHTML = `<div class="side-head"><div class="grow"><div class="eyebrow">只读</div><div class="td-ptitle">当前有效计划 · 修订 ${planRev()}</div><div class="hint" style="margin-top:4px">开始执行时冻结；执行中的调整形成新的有效计划，原记录保留。</div></div><button class="icon-btn" aria-label="关闭" data-a="close-side">${I('x')}</button></div>
      <div class="side-body"><div class="sec"><div class="sec-t">来源</div>${kv([['来源', isFixed() ? `固定菜单模板 <span class="mono">${esc(T.tpl.ref)}@r${T.tpl.rev}</span><div class="hint">origin=fixed-menu-template · 实例创建即语义锁</div>` : T.origin === 'planning' ? 'AI 规划候选 → 应用 → 你确认' : T.origin === 'old' ? '旧版流程生成并确认（迁入统一画布，身份不变）' : isLegacy() ? '旧版记录' : '计划确认（TD 样例）'], ['步骤', `${allNodes().filter((n) => !n.system).length} 步 · 依赖 ${cvOpt.edges.length} 条`], ['自动推进', autoOn ? '开启' : '关闭（手动推进）']])}</div>
        ${isFixed() ? `<div class="sec"><div class="sec-t">入口参数（创建时填写）</div>${kv(T.tpl.params.map(([k, v]) => [esc(k), `<span class="mono">${esc(v)}</span>`]).concat([['项目 / 分支', `${esc(T.project)} · ${esc(T.tpl.branch)}`]]))}</div>` : ''}
        ${req ? `<div class="sec"><button class="btn secondary sm" data-a="open-req">${I('file', 'sm')}在需求画布查看需求追踪</button></div>` : ''}</div>`;
  }

  /* ---------- 调整待执行计划（C04：原模式捕获与保留） ---------- */
  function openAdjPanel() {
    panel = 'adjust'; sideShow(true);
    const N = planRev(), A = T.adj, s = st();
    const locked = allNodes().filter((n) => !n.system && ['done', 'run', 'claimed', 'paused'].includes(s[n.id]));
    const nLocal = (edits.added ? 1 : 0) + (edits.mod && !reread ? 1 : 0);
    let body = '', foot = '';
    if (adj === 'pausing') {
      body = `<div class="sec"><div class="banner unknown">${I('clock')}<div><b>正在暂停新增领取</b><br>请求 <span class="mono">rk-e51b</span> 已发出，等待服务回执；回执成功前不开放编辑。运行中的步骤按原快照继续，不会被强停。</div></div></div>
        <div class="sec"><div class="sec-t">调整前（服务记录的原模式）</div>${kv([['自动推进', prior === 'off' ? '关闭（手动推进）' : '开启'], ['执行状态', prior === 'paused' ? '已暂停（你于 11:20 暂停）' : '运行中'], ['记录于', '14:51:08 · guard rk-e51b']])}<p class="hint" style="margin-top:8px">继续或放弃时按这里记录的原模式恢复，不由界面另行决定。</p></div>`;
      foot = `<span class="hint grow">回执到达后开放编辑</span><button class="btn secondary" aria-disabled="true" data-a="dis">${I('edit', 'sm')}编辑</button>`;
    } else if (adj === 'editing' || adj === 'conflict') {
      body = editSel ? editNodeHTML(editSel) : `
        <div class="sec"><div class="sec-t">本地修改 · ${nLocal} 项 · 未保存</div><div class="ut-box">
          ${edits.added ? `<div class="ut-row"><span class="ut-ic ok">${I('plus', 'sm')}</span><div class="grow"><div class="t">新增：${esc(A.add.title)}</div><div class="s">在“${esc(nTitle(A.after))}”之后、“${esc(nTitle(A.to))}”之前 · ${esc(A.add.meta)}</div></div><button class="btn ghost sm" data-a="edit-focus" data-id="${A.add.id}">定位</button></div>` : `<div class="ut-row"><span class="ut-ic">${I('info', 'sm')}</span><div class="grow"><div class="s">在可修改步骤上点“+”添加下一步（例如在“${esc(nTitle(A.after))}”后），或选中步骤编辑。</div></div></div>`}
          ${edits.mod ? `<div class="ut-row"><span class="ut-ic ${reread ? 'no' : 'wait'}">${I(reread ? 'x' : 'edit', 'sm')}</span><div class="grow"><div class="t">${reread ? '不能保存：' : ''}修改“${esc(nTitle(A.conflict))}”的验收</div><div class="s">${esc(A.mod)}${reread ? '（该步骤已被领取并锁定；内容可复制到新步骤）' : ''}</div></div>${reread ? `<button class="btn ghost sm" data-a="copy" data-what="修改内容">${I('copy', 'sm')}复制</button>` : ''}</div>` : ''}</div></div>
        <div class="sec"><div class="sec-t">锁定的步骤 · ${locked.length}</div><div class="ut-box">${locked.map((n) => `<div class="ut-row"><span class="ut-ic">${I('lock', 'sm')}</span><div class="grow"><div>${esc(n.title)}</div><div class="s">${{ done: '已完成', run: '运行中 · 按原快照继续', claimed: '已被领取', paused: '已暂停 · 停在安全点' }[s[n.id]]} · 入边一并锁定</div></div></div>`).join('')}</div>
          <p class="hint" style="margin-top:8px">${I('info', 'sm')} 锁以服务实时状态为准；保存时服务再做一次版本比对（CAS）。布局移动不算语义修改。</p></div>
        <div class="sec"><div class="sec-t">调整前（服务记录的原模式）</div><p class="td-p">${priorLabel()}</p></div>`;
      const canSave = adj !== 'conflict' && (edits.added || (edits.mod && !reread));
      foot = `<button class="btn secondary" data-a="abandon">放弃调整</button><span class="grow"></span>${adj === 'conflict' ? `<button class="btn primary" aria-disabled="true" aria-describedby="svR" data-a="dis">保存修改</button>` : `<button class="btn primary" data-a="save" ${canSave ? '' : 'aria-disabled="true"'} aria-describedby="svR">保存修改</button>`}<div class="td-dis" id="svR" style="color:var(--sub)">${I('info', 'sm')}<span>${adj === 'conflict' ? '先重新读取并比对' : canSave ? '保存语义修改后需要重新确认计划' : '还没有本地修改'}</span></div>`;
    } else if (adj === 'reconfirm' || adj === 'ready') {
      const contLbl = prior === 'paused' ? '结束调整（任务保持暂停）' : '继续执行';
      body = `<div class="sec"><div class="sec-t">改动 · 计划修订 ${N} → ${N + 1}</div><div class="ut-box"><div class="ut-row"><span class="ut-ic ok">${I('plus', 'sm')}</span><div class="grow"><div class="t">新增：${esc(A.add.title)}</div><div class="s">${esc(A.add.meta)} · 接在“${esc(nTitle(A.after))}”之后</div></div></div></div></div>
        <div class="sec"><div class="sec-t">当前整图重新检查 <span class="badge outline" style="height:18px">服务事实</span></div><div class="ut-box"><div class="ut-row"><span class="ut-ic ok">${I('check', 'sm')}</span><div class="grow">结构、输入输出、依赖：通过</div></div><div class="ut-row"><span class="ut-ic wait">${I('eye', 'sm')}</span><div class="grow">需求归属：新步骤映射由你填写<div class="s">旧检查报告作历史，不沿用旧绿勾</div></div></div></div></div>
        <div class="sec"><div class="sec-t">${adj === 'ready' ? '继续时（按原模式恢复）' : '确认后，继续时'}</div>${kv([['自动推进', prior === 'off' ? '保持关闭 · 之后由你推进' : prior === 'paused' ? `保持${autoOn ? '开启' : '关闭'}（任务恢复后生效）` : '恢复为开启'], ['执行状态', prior === 'paused' ? '保持暂停 · “恢复任务”才继续' : '恢复新增领取'], ['运行中', titlesBy('run').map(esc).join('、') || '无'], ['原模式来源', 'guard rk-e51b · 14:51:08 服务记录']])}</div>`;
      foot = adj === 'ready' ? `<span class="grow"></span><button class="btn primary" data-a="continue" id="contBtn">${I(prior === 'paused' ? 'check' : 'play', 'sm')}${contLbl}</button><div class="td-dis" style="color:var(--sub)">${I('info', 'sm')}<span>${prior === 'paused' ? '只结束调整；任务保持暂停' : prior === 'off' ? '继续后自动推进仍关闭；手动推进可用' : '继续后才会领取新步骤'}</span></div>`
        : `<span class="grow"></span><button class="btn primary" data-a="reconfirm" id="reconfirmBtn">重新确认计划</button><div class="td-dis" style="color:var(--sub)">${I('info', 'sm')}<span>确认不会调用模型，也不会立即领取步骤</span></div>`;
    }
    $('#side').innerHTML = `<div class="side-head"><div class="grow"><div class="eyebrow">计划修订 ${N}${adj === 'reconfirm' || adj === 'ready' ? ' → ' + (N + 1) : ' · 本地草稿'}</div><div class="td-ptitle">${{ pausing: '申请调整', editing: '调整待执行计划', conflict: '调整待执行计划', reconfirm: '重新确认计划', ready: '已重新确认' }[adj]}</div></div></div>
      <div class="side-body">${body}</div><div class="side-foot td-foot">${foot}</div>`;
  }
  function editNodeHTML(id) {
    const n = allNodes().find((x) => x.id === id); if (!n) return '';
    const s = st()[id];
    const lockedWhy = { done: '已完成：结果与验收按原身份保留', run: '运行中：当前尝试按原快照继续，不能修改', claimed: '已被领取：不能修改，入边一并锁定', paused: '已暂停：停在安全点，不能修改' }[s];
    const ps = preds(id);
    const cands = allNodes().filter((x) => !x.system && x.id !== id);
    return `<button class="btn ghost sm" data-a="edit-back">${I('chevLeft', 'sm')}全部修改</button>
      <div class="sec" style="margin-top:10px"><div class="row" style="gap:8px"><b class="grow" style="font-size:15px;font-weight:500">${esc(n.title)}</b>${lockedWhy ? `<span class="badge st-idle">${I('lock', 'sm')}锁定</span>` : `<span class="badge st-idle">${I('edit', 'sm')}可修改</span>`}</div><div class="hint" style="margin-top:4px">${esc(n.role || '')}${n.meta ? ' · ' + esc(n.meta) : ''}</div>
      ${lockedWhy ? `<div class="lockline" style="margin-top:10px">${I('lock', 'sm')}<span>${lockedWhy}</span></div>` : `
        <div class="field" style="margin-top:14px"><label class="label" for="fTitle">步骤名称</label><input class="input" id="fTitle" value="${esc(n.title)}"></div>
        <div class="field"><span class="label">前置步骤（键盘可用的依赖编辑，替代拖拽连线）</span><div class="ut-box">${cands.map((c) => { const lk = ['done', 'run', 'claimed', 'paused'].includes(st()[c.id]); return `<label class="ut-row" style="cursor:pointer"><input type="checkbox" ${ps.includes(c.id) ? 'checked' : ''} data-pred="${c.id}"><span class="grow">${esc(c.title)} <span class="hint">${lk ? '· 已锁定（可作前置，不能改它本身）' : ''}</span></span></label>`; }).join('')}</div></div>
        <div class="field"><label class="label" for="fAcc">验收条款</label><textarea class="textarea" id="fAcc" rows="2">${esc(n.added ? n.meta : '按原验收')}</textarea></div>
        ${n.added ? `<button class="btn ghost sm" style="color:var(--danger);margin-top:6px" data-a="undo-add">${I('trash', 'sm')}撤销新增</button>` : `<button class="btn ghost sm" style="color:var(--danger);margin-top:6px" data-a="del-node">${I('trash', 'sm')}从计划移除…</button><p class="hint" style="margin-top:6px">移除前会列出需求覆盖、输入输出与必需产物的影响；必需步骤不能只删方块。</p>`}`}</div>`;
  }
  function openEditNode(id) { editSel = id; openAdjPanel(); }
  function addAfter(id) {
    if (!editing() || adj === 'conflict') return;
    if (id !== T.adj.after || edits.added) { DS.toast(`原型只演示在“${nTitle(T.adj.after)}”后新增一步`, 'info'); return; }
    edits.added = true; editSel = T.adj.add.id; renderAll(); openAdjPanel(); DS.toast(`已在本地草稿新增“${T.adj.add.title}”（未保存）`, 'ok');
  }

  /* ---------- 恢复这一步（原任务画布迁入） ---------- */
  function openRecovery() {
    panel = 'recovery'; sideShow(true);
    const fid = Object.keys(st()).find((k) => st()[k] === 'fail') || 'n4', fn = nTitle(fid);
    const pre = preds(fid).map(nTitle);
    const modes = isFixed() ? [['retry', '按原配置重试这一步', '固定模板任务只能按原配置重试，不能修改步骤或参数。']] : [['retry', '原样重试这一步', '用相同的输入和职业再执行一次。适合偶发错误。'], ['edit', '修改后重试', '先调整这一步的说明或输入，再执行。适合方向不对。'], ['from', '从上一步重新执行', `连同“${pre.join('”“')}”一起重做。适合上游产出有问题。`]];
    const P = rec.phase;
    $('#side').innerHTML = `
      <div class="side-head"><button class="icon-btn" aria-label="返回步骤" data-a="rec-back" data-id="${fid}">${I('chevLeft')}</button><div class="grow"><div class="eyebrow">恢复 · ${esc(fn)}</div><div class="td-ptitle">${P === 'ready' ? '恢复已准备好' : '选择恢复方式'}</div></div></div>
      <div class="side-body">
        <div class="lockline" style="margin-bottom:16px">${I('lock', 'sm')}<span>原任务、失败记录和已完成的步骤保持不变。恢复会生成关联的恢复记录，准备好后再单独开始；写入仍在任务工作区 ${esc(T.ws)}。</span></div>
        ${P === 'choose' ? `<div class="col" style="gap:8px" role="radiogroup" aria-label="恢复方式">${modes.map(([k, t, d]) => `<button class="ut-opt" role="radio" aria-checked="${rec.mode === k}" data-a="rec-mode" data-m="${k}"><span class="r"></span><span><div style="font-size:14px;font-weight:500">${t}</div><div class="hint">${esc(d)}</div></span></button>`).join('')}</div>
          <div class="sec" style="margin-top:18px"><div class="sec-t">将重新执行</div><div class="row wrap" style="gap:6px">${(rec.mode === 'from' ? pre.concat([fn]) : [fn]).map((x) => `<span class="chip">${esc(x)}</span>`).join('')}<span class="chip" style="opacity:.6">之后的步骤（照常）</span></div></div>
          ${rec.mode === 'edit' ? `<div class="sec"><div class="sec-t">修改这一步</div><textarea class="textarea" aria-label="修改这一步">${esc((allNodes().find((n) => n.id === fid) || {}).what || '')}</textarea></div>` : ''}
          <p class="hint" style="margin-top:12px">也可以从“更多 → 任务恢复…”进入独立恢复工作台查看失败上下文。</p>`
        : P === 'creating' ? `<div class="row"><span class="spin"></span>正在准备恢复…</div>`
        : `<div class="banner ok">${I('check')}<div><b>恢复已准备好</b><br>方式：${modes.find((m) => m[0] === rec.mode)[1]}。开始后回到这张画布继续。</div></div>`}
      </div>
      <div class="side-foot td-foot">${P === 'choose' ? `<button class="btn ghost" data-a="rec-back" data-id="${fid}">取消</button><span class="grow"></span><button class="btn primary" data-a="rec-prepare">准备恢复</button>`
        : P === 'ready' ? `<span class="grow"></span><button class="btn primary" data-a="rec-start">${I('play', 'sm')}开始恢复</button>` : ''}</div>`;
  }

  /* ---------- 快照评审运行面板（原任务画布“快照代码评审”迁入） ---------- */
  let snapTab = ['report', 'report-loading', 'report-read', 'report-error', 'cancelled'].includes(snap) ? 'reports' : 'progress';
  let snapBatches = /^batches/.test(snap || ''), snapPartial = { 'report-read': 'read', cancelled: 'read', 'report-loading': 'loading', 'report-error': 'error' }[snap] || 'none';
  const SNAPD = (() => {
    const full = { mode: '日期增量审查', light: false, rev: 3, sup: 2, base: 'b71e04c9d2a35f8e1c6047ab93de25f1c08a7e64', target: '9f3c2a7e5b1d4c08a6f2e91b7d3c5a40e8b6f1d2', phase: '审查（功能批次分析）', met: [14, 3, 1, 12], rows: [['功能批次分析', 11, 20], ['补充批次', 1, 2], ['候选问题复核', 2, null]], count: 24, dir: 'reports/snapshot-review/' + (T.project === '订单服务' ? 'order-service-2026-10' : 'opencode-loopper-w41') };
    if (snap === 'light') return Object.assign({}, full, { mode: '全面审查', light: true, base: '', target: '4e8d1b0c7a93f25e6d01b8c4a7f3e92d5c06b1a8', met: [9, 2, 0, 5], rows: [['功能批次分析', 9, 14], ['候选问题复核', 0, null]], count: 14 });
    if (snap === 'batches-empty') return Object.assign({}, full, { rev: 1, sup: 0, phase: '冻结版本后制定审查计划', met: [0, 0, 0, null], rows: [['功能批次分析', 0, null]], count: 0 });
    if (snap === 'cancelled') return Object.assign({}, full, { phase: '已取消', met: [14, 0, 1, 12] });
    return full;
  })();
  const SNAP_BATCHES = [['订单创建与库存预占', '功能分析', 'done'], ['支付回调与幂等', '功能分析', 'run'], ['退款流程', '功能分析', 'fail', '分析输出缺少问题定位（文件与行号），校验未通过。'], ['优惠券叠加规则', '候选问题复核', 'run'], ['订单导出（补充）', '补充分析', 'idle'], ['用户地址簿', '功能分析', 'done']];
  const BST = { done: ['已验证', 'st-done', 'check'], run: ['执行中', 'st-run', 'play'], fail: ['需处理', 'st-fail', 'alert'], idle: ['待执行', 'st-idle', 'clock'] };
  const shaRow = (label, s) => `<span>${label}</span><code title="${s}">${s.slice(0, 7)}</code><button class="icon-btn" aria-label="复制${label}版本号" data-a="copy" data-what="${label}版本号">${I('copy', 'sm')}</button>`;
  function snapProgress() {
    const d = SNAPD, m = d.met, c3 = m[3] == null;
    const cells = [[m[0], '已验证审查批次'], [m[1], '执行中'], [m[2], '需处理', m[2] ? 'var(--warn)' : '']].concat(c3 ? [] : [[m[3], '剩余批次']]);
    let batches = '';
    if (snapBatches) {
      let inner;
      if (snap === 'batches-loading') inner = [0, 1, 2].map(() => `<div class="sn-b"><div><div class="skel" style="height:13px;width:62%"></div><div class="skel" style="height:11px;width:36%;margin-top:7px"></div></div><div class="skel" style="height:20px;width:56px;border-radius:999px"></div></div>`).join('');
      else if (snap === 'batches-error') inner = `<div class="banner danger" role="alert" style="margin:10px 0 4px">${I('alert')}<div><b>功能批次读取失败</b><br>没有拿到批次列表，上方进度数字不受影响。</div><div class="actions"><button class="btn secondary sm" data-a="snap-retry">${I('refresh', 'sm')}重试</button></div></div>`;
      else if (!d.count) inner = `<div class="hint" style="padding:14px 0 6px">尚未创建功能批次。审查计划确认后，会按功能拆分批次并显示在这里。</div>`;
      else inner = SNAP_BATCHES.map(([t, p, s, err]) => { const B = BST[s]; return `<div class="sn-b"><div style="min-width:0"><div class="t">${t}</div><div class="p">${p}</div></div><span class="badge ${B[1]}">${I(B[2], 'sm')}${B[0]}</span>${err ? `<div class="err">${I('alert', 'sm')}<span>${err}</span></div>` : ''}</div>`; }).join('')
        + `<div class="row" style="padding-top:8px;box-shadow:inset 0 1px 0 var(--line)"><span class="hint grow">已显示 6 / ${d.count}</span><button class="btn ghost sm" data-a="toast" data-msg="已加载下一页批次（原型示意）">加载更多</button></div>`;
      batches = `<div class="sn-bl">${inner}</div>`;
    }
    return `<div class="sec"><div class="sn-met ${c3 ? 'c3' : ''}">${cells.map(([v, k, col]) => `<div><div class="v num" ${col ? `style="color:${col}"` : ''}>${v}</div><div class="k">${k}</div></div>`).join('')}</div>${c3 ? '<p class="hint" style="margin-top:8px">批次总数在审查计划确认后确定。</p>' : ''}</div>
      <div class="sec"><div class="sec-t">阶段</div>${d.rows.map(([l, done, tot]) => `<div class="sn-ph"><span class="ellipsis">${l}</span><div class="meter">${tot ? `<i style="width:${Math.round(done / tot * 100)}%;background:var(--done)"></i>` : ''}</div><span class="c num">${done} / ${tot == null ? '待定' : tot}</span></div>`).join('')}
        <div class="sn-note">${I('info', 'sm')}<span><b>进度不等于完成。</b>批次全部验证后，还要汇总报告并通过校验，任务才算完成；最终状态以执行服务为准。</span></div></div>
      <div class="sec"><div class="sec-t">审查范围</div><div class="sn-box">
        <div class="hd"><span class="badge st-accent">${I(d.base ? 'calendar' : 'layers', 'sm')}${d.mode}</span><span class="badge ${d.light ? 'st-idle' : 'outline'}">${d.light ? '轻量审查' : '全量审查'}</span></div>
        ${d.light ? `<p class="hint" style="margin-top:10px">分析批次固定；只有发现候选问题的批次会增加独立复核。</p>` : `<div class="sn-facts"><span>审查计划<b class="num">修订 ${d.rev}</b></span><span>补充批次<b class="num">${d.sup} 个</b></span></div>`}
        <div class="sn-sha">${d.base ? `${shaRow('基线', d.base)}<span style="color:var(--faint)">${I('arrowRight', 'sm')}</span>` : ''}${shaRow('目标', d.target)}</div>
        <p class="hint" style="margin-top:10px">${I('lock', 'sm')} 源码版本在开始时固定，执行中不随仓库变化。</p></div></div>
      <div class="sec"><button class="sn-tog" aria-expanded="${snapBatches}" data-a="snap-batches"><span class="chev">${I('chevRight', 'sm')}</span><span class="grow">功能批次</span>${d.count ? `<span class="hint num">${d.count} 个</span>` : ''}</button>${batches}</div>
      <div class="sec"><div class="sec-t">输出目录</div><div class="att">${I('folder', 'sm')}<span class="grow mono ellipsis" title="${d.dir}">${d.dir}</span><button class="btn ghost sm" data-a="copy" data-what="输出目录">${I('copy', 'sm')}复制</button></div></div>`;
  }
  function snapReports() {
    const P = snapPartial, a = 132, p = 41, x = 9, tot = a + p + x;
    let body;
    if (P === 'none') body = `<div class="empty" style="padding:24px 12px;gap:8px"><span class="tile">${I('doc', 'lg')}</span><h3>还没有读取阶段报告</h3><p>读取后显示已分析、未完成和排除的范围，以及截至目前的结论。</p></div>`;
    else if (P === 'loading') body = `<div class="row" style="padding:6px 0 10px"><span class="spin"></span><span class="sub">正在读取阶段报告…</span></div><div class="skel" style="height:10px"></div><div class="skel" style="height:120px;margin-top:14px;border-radius:12px"></div>`;
    else if (P === 'error') body = `<div class="banner danger" role="alert">${I('alert')}<div><b>阶段报告读取失败</b><br>没有拿到报告内容，不会显示旧内容代替。重新读取不会启动执行。</div></div>`;
    else body = `<div class="sn-bar" role="img" aria-label="已分析 ${a}，未完成 ${p}，排除 ${x}"><i style="flex:${a};background:var(--done)"></i><i style="flex:${p};background:var(--fill-5)"></i><i style="flex:${x};background:transparent;box-shadow:inset 0 0 0 1px var(--line-3)"></i></div>
      <div class="sn-lg"><div><i style="background:var(--done)"></i>已分析<b class="num">${a}</b></div><div><i style="background:var(--fill-5)"></i>未完成<b class="num">${p}</b></div><div><i style="box-shadow:inset 0 0 0 1px var(--line-3)"></i>排除<b class="num">${x}</b></div></div>
      <p class="hint" style="margin-top:6px">按分析单元计，共 ${tot} 个 · 读取于 14:32</p>
      <div class="sn-doc"><h4>已分析范围</h4><p>11 个功能批次已验证。</p><h4>已确认问题</h4><ul><li><span class="sn-sev hi">高</span>支付回调缺少幂等校验 <code>payment/callback.ts:88</code></li><li><span class="sn-sev">中</span>退款金额用浮点数计算 <code>refund/amount.ts:41</code></li></ul><h4>未完成范围</h4><p>41 个单元尚未分析。</p><h4>排除</h4><p>9 个单元按审查计划排除。</p></div>`;
    const canDl = P === 'read';
    return `${snap === 'cancelled' ? `<div class="banner info" style="margin-bottom:16px">${I('info')}<div><b>任务已取消</b><br>已分析的部分保留，阶段报告仍可读取和下载；读取不会重新开始执行。</div></div>` : ''}
      <div class="sec"><div class="sec-t">评审报告</div><div class="att">${I('file', 'sm')}<span class="grow">最终报告<div class="hint">${snap === 'cancelled' ? '任务已取消，不会生成最终报告' : '全部分析与复核完成后生成'}</div></span><span class="badge st-idle">${snap === 'cancelled' ? '未生成' : '待生成'}</span></div></div>
      <div class="sec"><div class="row" style="margin-bottom:8px"><span class="sec-t grow" style="margin:0">阶段报告</span><span class="badge outline">${I('eye', 'sm')}只读</span></div>
        <div class="row wrap" style="margin-bottom:14px;gap:8px"><button class="btn ${canDl ? 'ghost' : 'primary'} sm" data-a="snap-read" ${P === 'loading' ? 'disabled' : ''}>${P === 'loading' ? '<span class="spin"></span>读取中' : `${I(canDl || P === 'error' ? 'refresh' : 'eye', 'sm')}${canDl || P === 'error' ? '重新读取' : '读取阶段报告'}`}</button>
          <button class="btn ${canDl ? 'primary' : 'secondary'} sm" ${canDl ? '' : 'disabled'} data-a="toast" data-msg="已下载 阶段报告.md（原型示意）">${I('download', 'sm')}下载 Markdown</button>${canDl ? '' : '<span class="hint">读取后才能下载</span>'}</div>${body}</div>`;
  }
  function openSnap(t) {
    if (t) snapTab = t;
    if (cv.selected) { quiet = true; cv.select(null); quiet = false; }
    panel = 'snap'; sideShow(true); bar();
    $('#side').innerHTML = `<div class="side-head"><div class="grow"><div class="eyebrow">快照评审 · 只读视图</div><div class="td-ptitle">${snapTab === 'progress' ? '执行进度' : '模板报告'}</div>${snapTab === 'progress' ? `<div class="hint" style="margin-top:4px">当前阶段：${SNAPD.phase}</div>` : ''}</div><button class="icon-btn" aria-label="关闭运行面板" data-a="close-side">${I('x')}</button></div>
      <div class="tabs" role="tablist" style="padding:0 12px">${[['progress', '执行进度'], ['reports', '模板报告']].map(([k, l]) => `<button class="tab" role="tab" aria-selected="${snapTab === k}" data-a="snap" data-t="${k}">${l}</button>`).join('')}</div>
      <div class="side-body">${snapTab === 'progress' ? snapProgress() : snapReports()}</div>
      <div class="side-foot"><span class="hint grow">${I('lock', 'sm')} 查看进度和报告不会启动、暂停或改变执行</span></div>`;
  }

  /* ---------- 图层：抽屉 / 对话框（焦点限定、Esc 关闭、焦点还原） ---------- */
  const layers = [];
  const FOC = 'button:not([disabled]),[href],input:not([disabled]),select,textarea,summary,[tabindex]:not([tabindex="-1"])';
  function selOf(el) {
    if (!el || el === document.body) return null;
    if (el.id) return '#' + el.id;
    const host = el.closest('[id]');
    if (el.dataset && el.dataset.a) return (host ? '#' + host.id + ' ' : '') + `[data-a="${el.dataset.a}"]`;
    return null;
  }
  function openLayer(el, back) {
    if (layers.some((l) => l.el === el)) return;
    layers.push({ el, back: typeof back === 'string' ? back : selOf(back || document.activeElement) });
    const dlg = el.classList.contains('dialog');
    (dlg ? $('#tdDScrim') : $('#tdScrim')).classList.add('open');
    el.classList.add('open'); el.setAttribute('aria-hidden', 'false');
    setTimeout(() => { const f = el.querySelector('[autofocus]') || el.querySelector(FOC); (f || el).focus(); }, 60);
  }
  function closeLayer(el) {
    const i = layers.findIndex((l) => l.el === el); if (i < 0) return;
    const L = layers.splice(i, 1)[0];
    el.classList.remove('open'); el.setAttribute('aria-hidden', 'true');
    if (el.classList.contains('dialog')) $('#tdDScrim').classList.remove('open'); else $('#tdScrim').classList.remove('open');
    const t = L.back && document.querySelector(L.back);
    if (t && t.offsetParent !== null) t.focus(); else { const top = layers[layers.length - 1]; if (top) (top.el.querySelector(FOC) || top.el).focus(); }
  }
  const closeTop = () => { const L = layers[layers.length - 1]; if (L) closeLayer(L.el); };
  window.addEventListener('keydown', (e) => {
    if (document.getElementById('tdExplain')?.classList.contains('open')) return;
    if (e.key === 'Escape' && layers.length) { e.preventDefault(); e.stopImmediatePropagation(); closeTop(); return; }
    if (e.key === 'Tab' && layers.length) {
      const el = layers[layers.length - 1].el;
      const f = [...el.querySelectorAll(FOC)].filter((x) => x.offsetParent !== null || x === document.activeElement);
      if (!f.length) { e.preventDefault(); el.focus(); return; }
      const a = f[0], z = f[f.length - 1];
      if (!el.contains(document.activeElement)) { e.preventDefault(); a.focus(); }
      else if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); }
      else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
    }
  }, true);
  $('#tdScrim').addEventListener('click', () => { const top = layers[layers.length - 1]; if (top && top.el.id === 'wsDrawer') closeTop(); });

  /* ---------- TD06 工作区详情抽屉 ---------- */
  function drawerHTML() {
    const g = isGit(), W = g ? '工作区' : '副本';
    const cleaned = ph === 'cleaned', partial = ph === 'cleanPartial';
    const runningW = notEnded();
    const ret = cleaned ? ['已清理', 'st-idle', 'archive'] : partial ? ['清理未完成 · 待核对', 'st-unknown', 'help'] : ['保留中', 'st-accent', 'lock'];
    const blockers = cleanBlockers();
    const avail = cleaned ? `<span class="sub">已清理 · 10-15 16:45（你确认）</span>`
      : partial ? `<span style="color:var(--unknown)">${I('help', 'sm')} 清理已部分发生，回执未知</span>`
      : runningW ? `<span style="color:var(--warn)">${I('lock', 'sm')} 执行中不能清理</span>`
      : blockers.length ? `<span style="color:var(--warn)">${I('lock', 'sm')} 暂不能清理 · ${blockers.length} 个阻塞原因</span>`
      : uniq && undelivered() ? `<span style="color:var(--warn)">${I('lock', 'sm')} 不能清理 · 有需保留的唯一产物</span>`
      : undelivered() ? `<span style="color:var(--wait)">${I('alert', 'sm')} 可以清理 · 有 ${undelivered()} 个未交付文件，默认保留，需要额外知情确认</span>`
      : `<span style="color:var(--ok)">${I('check', 'sm')} 可以清理 · 已选变更已全部交付</span>`;
    const reveal = `<button class="btn ghost sm" aria-disabled="true" aria-describedby="revealWhy" data-a="reveal-dis">${I('external', 'sm')}在文件管理器显示</button><span class="hint td-why" id="revealWhy">当前桌面宿主未提供「在文件管理器显示」能力</span>`;
    const partialSteps = `<ol class="td-steps"><li class="ok">${I('check', 'sm')}<span>删除子${W} 2 个 · 已核实</span></li><li class="ok">${I('check', 'sm')}<span>删除${g ? ' worktree 目录' : '独立副本目录'} · 已核实</span></li>${g ? `<li class="unk">${I('help', 'sm')}<span>删除本地任务分支 <span class="mono">${esc(T.branch)}</span> · 回执未知（16:31 连接中断）</span></li>` : `<li class="unk">${I('help', 'sm')}<span>删除任务内部缓存 · 回执未知（16:31 连接中断）</span></li>`}<li>${I('clock', 'sm')}<span>核实清理结果 · 未执行</span></li></ol>
      <p class="hint" style="margin-top:8px">只能核对原清理操作（原请求 req·w-2041-1），不会再次发出删除。</p><div id="partialCheck"></div>`;
    return `<div class="drawer-head"><div class="grow"><div class="eyebrow">工作区详情 · 任务 ${T.id}</div><h2 id="wsDrawerT" style="margin-top:3px">${esc(T.ws)}</h2>
        <div class="row wrap" style="gap:6px;margin-top:8px"><span class="badge ${ret[1]}">${I(ret[2], 'sm')}${ret[0]}</span><span class="badge outline">${g ? 'Git · 独立分支与 worktree' : '非 Git · 基线快照与独立副本'}</span></div>${(() => { const r = TD.ret(); if (!r.fromState || !TD.byId[r.fromState] || !['git', 'apply'].includes(r.from)) return ''; const ex = {}; const q = new URLSearchParams(location.search); if (q.get('kind')) ex.kind = q.get('kind'); return `<a class="btn ghost sm" style="margin:10px 0 0 -10px" href="${TD.href(r.fromState, ex)}">${I('arrowLeft', 'sm')}${r.from === 'git' ? '返回 Git 任务变更' : '返回应用视图'}</a>`; })()}</div>
        <button class="icon-btn" aria-label="关闭工作区详情" data-a="drawer-close">${I('x')}</button></div>
      <div class="drawer-body">
        ${cleaned ? `<div class="banner" style="margin-bottom:16px">${I('archive')}<div><b>工作区已清理，可查看提交 / 保存证据</b><br>本地${g ? '任务分支与 worktree' : '独立副本'}已删除；交付回执、${g ? '提交、远端分支与 MR' : '应用回执与基线快照'}保留，仍可阅读。</div></div>` : ''}
        <div class="sec"><div class="sec-t">类型与身份</div>${kv([['类型', g ? 'Git · 独立分支与 worktree' : '非 Git · 基线快照与独立副本（不是 worktree）'], ['公开身份', sha(T.wsRef, '工作区公开身份')], ['任务', `${esc(T.title)} · <span class="mono">${T.id}</span> · 执行 ${T.exec}`]])}</div>
        <div class="sec"><div class="sec-t">原项目</div>${kv([['项目', esc(T.project) + (g ? `<div class="hint">${esc(T.remote)}</div>` : '')], ['原路径', `<span class="mono td-wrap">${esc(T.projectPath)}</span>`], ['说明', `${esc(T.originNote)}${g ? '' : '<div class="hint" style="color:var(--ok)">原目录从不是清理对象</div>'}`]])}</div>
        <div class="sec"><div class="sec-t">基线</div>${g
          ? `${kv([['基线', `<span class="mono">${T.base} @ ${T.baseSha}</span>`]])}<details class="td-diag"><summary><span class="chev">${I('chevRight', 'sm')}</span>诊断详情（公开安全引用）</summary>${kv([['完整 SHA', sha(T.baseShaFull, '完整 SHA')], ['工作区引用', sha(T.wsRef, '工作区引用')], ['变更快照', `<span class="mono">${T.changesRev}</span>`]])}</details>`
          : kv([['快照', `<span class="mono">${T.baseline}</span> · ${T.baselineAt}`], ['范围', T.scope], ['排除', T.excludes.map(esc).join('、')], ['未复制', T.notCopied.map(([p, s]) => `<span class="mono">${esc(p)}</span>（${s}）`).join('<br>') + '<div class="hint">这些资源不在副本中；任务不能声称整项目已隔离</div>']])}</div>
        <div class="sec"><div class="sec-t">任务${g ? '目录与分支' : '副本目录'}</div>
          <div class="td-path${cleaned ? ' gone' : ''}"><span class="mono td-wrap">${esc(T.wsPath)}</span>${cleaned ? '<span class="badge st-idle">已删除</span>' : ''}</div>
          <div class="row wrap" style="gap:4px 6px;margin-top:8px"><button class="btn ghost sm" data-a="copy" data-what="显示路径">${I('copy', 'sm')}复制显示路径</button>${cleaned ? '' : reveal}</div>
          <p class="hint" style="margin-top:6px">只显示路径，不能在这里修改；真实目录由宿主登记。</p>
          ${kv([g ? ['任务分支', `<span class="mono td-wrap">${esc(T.branch)}</span> <button class="icon-btn td-copy" aria-label="复制分支名" data-a="copy" data-what="分支名">${I('copy', 'sm')}</button>${cleaned ? '<div class="hint">本地分支已删除；远端分支保留</div>' : '<div class="hint">本地 · 系统生成</div>'}`] : null,
            ['子' + W, cleaned ? '已删除' : isUT() ? '按并行写步骤由服务创建与汇合' : `${esc(T.subs[0][1])}（${esc(T.subs[0][0])}）、${esc(T.subs[1][1])}（${esc(T.subs[1][0])}）${runningW ? ' · 写入中' : ' · 已汇合 15:40'}`],
            ['创建', T.created], ['最后检查', T.checked], ['占用空间', '未知（服务未提供）']])}</div>
        <div class="sec"><div class="sec-t">当前状态</div>${kv([
          ['活动写入', runningW ? (isUT() ? (titlesBy('run').length ? `<span style="color:var(--run)">${I('play', 'sm')} ${esc(titlesBy('run').join('、'))}</span>` : '无') : `<span style="color:var(--run)">${I('play', 'sm')} ${esc(nTitle('n2'))}、${esc(nTitle('n3'))} 写入子${W}</span>`) : ph === 'blocked' || ph === 'pushUnknown' ? `<span style="color:var(--stall)">${I('alert', 'sm')} 「回归测试」执行进程未停稳</span>` : '无'],
          ['未交付 / 未选', undelivered() ? `${undelivered()} 个文件未交付（${undeliveredDesc()}）<div class="hint">另有 ${T.excluded.length} 项未纳入</div>` : delivered() ? (g ? '0 · 已选变更全部交付；未纳入 3 项' : '0 · config/report.yaml 暂不交付，留在副本') : '0 · 没有文件变更'],
          ['未决原请求', ph === 'pushUnknown' ? `<span style="color:var(--unknown)">${I('help', 'sm')} 推送 · 回执未知</span>` : partial ? `<span style="color:var(--unknown)">${I('help', 'sm')} 清理 · 回执未知</span>` : ph === 'committed' ? '无 · 推送待你确认' : '无'],
          ['已交付凭证', delivered() ? (g ? `提交 <span class="td-sha">${T.commit}</span> · <span class="mono">${esc(T.remoteRef)}</span> · MR ${T.mr}` : `应用回执 · ${T.applied.ok} 项写入原目录 · 结算 ${T.deliveredAt}`) : ph === 'committed' || ph === 'pushUnknown' ? `提交 <span class="td-sha">${T.commit}</span>（交付未完成）` : '尚无'],
        ])}</div>
        <div class="sec" id="wsClean"><div class="sec-t">清理</div><div class="td-p">${avail}</div>
          ${blockers.length && !runningW ? `<ul class="td-reasons" style="margin-top:8px">${blockers.map((b) => `<li><span><b>${b[0]}</b>：${b[1]}</span>${b[2]}</li>`).join('')}</ul>` : ''}
          ${partial ? partialSteps : ''}
          <p class="hint" style="margin-top:8px">${I('shield', 'sm')} 清理是独立动作，只在你确认后进行；不设定时或自动清理。退出窗口、失败、取消、交付完成都不会触发清理。</p></div>
        ${protoUniq()}
      </div>
      <div class="drawer-foot"><span class="hint grow">关闭不会清理 · 文件保留，可稍后交付 / 查看</span><button class="btn ghost" data-a="drawer-close">关闭</button>
        ${partial ? `<button class="btn primary" data-a="recheck-clean">${I('search', 'sm')}核对原清理</button>` : cleaned ? '' : runningW ? `<button class="btn danger" aria-disabled="true" aria-describedby="cleanWhyD" data-a="clean-dis">${I('trash', 'sm')}清理工作区…</button><span class="sr" id="cleanWhyD">执行中不能清理</span>` : `<button class="btn danger" data-a="cleanup" id="cleanBtn">${I('trash', 'sm')}清理工作区…</button>`}</div>`;
  }
  function protoUniq() {
    if (!undelivered() || notEnded() || cleanBlockers().length || isUT()) return '';
    return `<div class="td-protobox"><span class="td-protobox-k">原型变体 · 非产品界面</span><div class="row wrap" style="gap:8px"><span class="hint">唯一产物</span><div class="seg" role="group" aria-label="唯一产物"><button aria-pressed="${!uniq}" data-a="var" data-k="unique" data-v="0">无</button><button aria-pressed="${uniq}" data-a="var" data-k="unique" data-v="1">含需保留的唯一产物</button></div></div></div>`;
  }
  function cleanBlockers() {
    if (ph === 'blocked') return [['活动写入', '「回归测试」执行进程仍持有任务工作区写入', `<button class="btn ghost sm" data-a="focus-n4">${I('target', 'sm')}定位到节点</button>`], ['未停稳', '执行结束请求尚未被服务确认', `<button class="btn ghost sm" data-a="audit">${I('clock', 'sm')}审计记录</button>`]];
    if (ph === 'pushUnknown') return [
      ['活动写入', '「回归测试」执行进程仍持有任务工作区写入（未停稳）', `<button class="btn ghost sm" data-a="focus-n4">${I('target', 'sm')}定位到节点</button>`],
      ['原请求待核对', `推送 <span class="mono">${esc(T.remoteRef)}</span> 回执未知`, `<button class="btn ghost sm" data-a="check-push">${I('search', 'sm')}核对原推送</button>`],
      ['恢复依赖', '恢复任务「回归测试 · 恢复 1」正在准备，依赖此工作区', `<button class="btn ghost sm" data-a="audit">${I('clock', 'sm')}查看恢复记录</button>`]];
    return [];
  }

  /* ---------- 对话框 ---------- */
  function dlg(html, wide) { const d = $('#tdDialog'); d.classList.toggle('wide', !!wide); d.innerHTML = html; }
  function cleanupHTML() {
    const g = isGit(), W = g ? '工作区' : '副本';
    const B = cleanBlockers(), U = undelivered();
    const delList = g ? [['本地任务分支', `<span class="mono">${esc(T.branch)}</span>`], ['worktree 目录', `<span class="mono td-wrap">${esc(T.wsPath)}</span>`], ['子工作区 2 个', `${esc(T.subs[0][1])}、${esc(T.subs[1][1])}（已汇合）`], ['任务内部缓存', '']]
      : [['独立副本目录', `<span class="mono td-wrap">${esc(T.wsPath)}</span>`], ['子副本 2 个', `${esc(T.subs[0][1])}、${esc(T.subs[1][1])}（已汇合）`], ['任务内部缓存', '']];
    const keepList = g ? [['原项目', `<span class="mono td-wrap">${esc(T.projectPath)}</span><div class="hint">含 3 个未提交改动，不受影响</div>`],
      delivered() ? ['远端分支', `<span class="mono">${esc(T.remoteRef)}</span><div class="hint">需要时在 GitLab 中删除</div>`] : null,
      delivered() ? ['合并请求与提交', `MR ${T.mr} · 提交 <span class="td-sha">${T.commit}</span>`] : ph === 'pushUnknown' ? ['提交', `<span class="td-sha">${T.commit}</span>`] : null,
      ['记录', '交付回执、验证记录与审计记录']]
      : [['原目录', `<span class="mono td-wrap">${esc(T.projectPath)}</span><div class="hint">原目录从不是清理对象</div>`], ['基线快照', `<span class="mono">${T.baseline}</span><div class="hint">服务说明：保留（应用回执引用此快照）</div>`], ['记录', '应用回执、验证记录与审计记录']];
    const L = (arr, cls, ic) => `<ul class="dlg-list ${cls}">${arr.filter(Boolean).map(([a, b]) => `<li>${I(ic, 'sm')}<span><b>${a}</b>${b ? ' ' + b : ''}</span></li>`).join('')}</ul>`;
    if (B.length) return `<div class="dialog-body"><h2 id="tdDialogT">暂时不能清理</h2><p>服务报告以下阻塞原因。处理后重新打开清理预览；不会排队，也不会在条件满足后自动清理。</p>
        <ul class="td-reasons td-reasons-box">${B.map((b) => `<li><span><b>${b[0]}</b>：${b[1]}</span>${b[2]}</li>`).join('')}</ul>
        <details class="td-diag" style="margin-top:12px"><summary><span class="chev">${I('chevRight', 'sm')}</span>解除阻塞后的清理范围</summary><div class="td-cl-h">将删除</div>${L(delList, 'del', 'trash')}<div class="td-cl-h">保留</div>${L(keepList, 'keep', 'shield')}</details></div>
      <div class="dialog-foot"><span class="hint grow" id="cleanWhy">有 ${B.length} 个阻塞原因，处理后才能清理</span><button class="btn ghost" data-a="dlg-close" autofocus>关闭</button><button class="btn danger" aria-disabled="true" aria-describedby="cleanWhy" data-a="clean-dis">${I('trash', 'sm')}清理</button></div>`;
    const blockU = uniq && U;
    return `<div class="dialog-body"><h2 id="tdDialogT">${blockU ? '不能清理这个工作区' : `清理任务${W}？`}</h2><p>只删除本任务自有的本地对象。确认后分步执行并逐步核实；不会定时或自动清理。</p>
      <div class="td-cl-h">${I('trash', 'sm')}将删除 · 本任务自有 · 本地</div>${L(delList, 'del', 'trash')}
      <div class="td-cl-h">${I('shield', 'sm')}保留 · 不会删除</div>${L(keepList, 'keep', 'shield')}
      <div class="td-cl-h">${I('doc', 'sm')}未交付内容</div>
      ${U ? `<div class="banner warn" style="margin-top:6px">${I('alert')}<div><b>${U} 个文件未交付</b>（${undeliveredDesc()}），默认保留。清理会永久丢弃这些改动，产品内无法恢复。${delivered() ? '' : `<div class="hint" style="margin-top:4px">${T.files.slice(0, 3).map((f) => esc(f[1])).join('、')} 等</div>`}</div></div>
          ${blockU ? `<div class="banner danger" style="margin-top:8px">${I('lock')}<div><b>有需保留的唯一产物</b><br><span class="mono">${g ? 'docs/export-sample.xlsx' : 'config/report.yaml'}</span> 是人工验收引用的唯一产物，服务要求保留，不提供删除。先交付或另存后才能清理。</div></div>`
            : `<label class="check td-ack"><input type="checkbox" id="ackU" data-a="ack"><span>我已知晓：清理会永久丢弃这 ${U} 个未交付文件</span></label>`}`
        : `<p class="td-p" style="margin-top:4px">0 个文件 · 已选变更全部交付${g ? '。未纳入的 dist/、coverage/、.env.local 不在交付范围，随目录删除' : ''}。</p>`}
      <p class="hint" style="margin-top:10px">占用空间：未知（服务未提供）</p></div>
      <div class="dialog-foot">${U && !blockU ? '<span class="hint grow" id="cleanWhy">需要先勾选知情确认</span>' : '<span class="grow"></span>'}<button class="btn ghost" data-a="dlg-close" autofocus>${blockU ? '关闭' : `保留${W}`}</button>${blockU ? '' : `<button class="btn danger" data-a="clean-do" id="cleanDo"${U ? ' aria-disabled="true" aria-describedby="cleanWhy"' : ''}>${I('trash', 'sm')}清理</button>`}</div>`;
  }
  function cleaningHTML(k) {
    const g = isGit(), W = g ? '工作区' : '副本';
    const steps = ['核对当前状态与所有权', `删除子${W} 2 个`, g ? '删除 worktree 目录' : '删除独立副本目录', g ? '删除本地任务分支' : '删除任务内部缓存', '核实清理结果'];
    return `<div class="dialog-body"><h2 id="tdDialogT">正在清理…</h2><p>逐步执行并核实；中断时保留原请求，只能核对，不会重复删除。</p>
      <ol class="td-steps">${steps.map((s, i) => `<li class="${i < k ? 'ok' : i === k ? 'cur' : ''}">${i < k ? I('check', 'sm') : i === k ? '<span class="spin"></span>' : I('clock', 'sm')}<span>${s}</span></li>`).join('')}</ol></div>
      <div class="dialog-foot"><span class="hint grow">原请求 req·w-${T.id.slice(2)}-1</span><button class="btn danger" disabled>${I('trash', 'sm')}清理中</button></div>`;
  }
  function cancelHTML(stopping) {
    const run = isUT() ? titlesBy('run') : [nTitle('n2'), nTitle('n3')];
    return `<div class="dialog-body"><h2 id="tdDialogT">${stopping ? '正在取消…' : '取消任务？'}</h2><p>「${esc(T.title)}」${run.length ? '中执行中的「' + run.map(esc).join('」「') + '」会停在安全点；' : ''}已完成的步骤和记录保留。</p>
      <div class="td-retain">${I('lock')}<div><b>文件保留，可稍后交付 / 查看</b><br>任务${isGit() ? '工作区 ' + esc(T.ws) + ' 与任务分支' : '副本'}不会被清理。取消后可以查看变更、交付已完成的部分，或在工作区详情中单独清理。</div></div>
      ${stopping ? `<div class="row" style="margin-top:12px"><span class="spin"></span><span class="sub">等待执行服务确认停稳…</span></div>` : ''}</div>
      <div class="dialog-foot"><button class="btn ghost" data-a="dlg-close" ${stopping ? 'disabled' : 'autofocus'}>继续执行</button><button class="btn danger" data-a="cancel-do" ${stopping ? 'disabled' : ''}>${I('stop', 'sm')}取消任务</button></div>`;
  }
  function nochgHTML() {
    return `<div class="dialog-body"><h2 id="tdDialogT">确认无文件交付并结束 <span class="badge td-candtag" style="vertical-align:2px">候选</span></h2>
      <p>这是建议中的特殊结算：在没有文件变更时，由你确认「无文件交付」，服务记录后结束任务。它<b class="ink">待产品 / API 核准</b>，还不是已确认的能力。</p>
      <ul class="dlg-list"><li>${I('info', 'sm')}<span>原型不会结算任务；任务保持「执行已结束 · 等待交付」</span></li><li>${I('shield', 'sm')}<span>不会生成空提交${isGit() ? '，也不会创建合并请求' : ''}</span></li><li>${I('lock', 'sm')}<span>工作区保留，不会自动清理</span></li></ul></div>
      <div class="dialog-foot"><button class="btn secondary" data-a="dlg-close" autofocus>知道了</button></div>`;
  }
  /* v4 对话框：调整 / 重新确认 / 放弃 / 继续（结束调整）/ 恢复任务 / 暂停任务 / 整体推进 */
  function adjustHTML() {
    const pr = ph === 'paused' ? 'paused' : autoOn ? 'on' : 'off';
    const run = titlesBy('run');
    return `<div class="dialog-body"><h2 id="tdDialogT">调整待执行计划？</h2><p>服务会先记录当前设置，再<b class="ink">暂停新增领取</b>；回执成功后才开放编辑。${run.length ? '正在运行的「' + run.map(esc).join('」「') + '」按原快照继续，不会被强停。' : ''}保存语义修改后需要重新确认，再由你继续。</p>
      <div class="ut-prior"><div class="k">调整前的设置（继续或放弃时按此恢复）</div><dl class="td-kv"><dt>自动节点推进</dt><dd>${autoOn ? '开启' : '关闭（手动推进）'}</dd><dt>执行状态</dt><dd>${pr === 'paused' ? '已暂停（你于 11:20 暂停）· 调整结束后仍暂停' : '运行中'}</dd></dl></div></div>
      <div class="dialog-foot"><button class="btn ghost" data-a="dlg-close" autofocus>取消</button><button class="btn primary" data-a="adjust-go">暂停新增领取并调整</button></div>`;
  }
  function reconfirmHTML() {
    const N = planRev(), A = T.adj;
    return `<div class="dialog-body"><h2 id="tdDialogT">重新确认计划修订 ${N + 1}？</h2><p>确认<b class="ink">不调用模型、不立即领取</b>。</p>
      <dl class="td-kv"><dt>改动</dt><dd>新增 1 步：${esc(A.add.title)}</dd><dt>步骤 / 依赖</dt><dd>${allNodes().filter((n) => !n.system).length} 步 / ${cvOpt.edges.length} 条</dd><dt>锁定不变</dt><dd>${allNodes().filter((n) => ['done', 'run', 'claimed', 'paused'].includes(st()[n.id])).map((n) => esc(n.title)).join('、')}</dd><dt>检查</dt><dd>按当前整图重新检查：结构通过；新步骤需求归属由你填写</dd><dt>继续时</dt><dd>${prior === 'paused' ? '任务保持暂停（调整前就已暂停）' : prior === 'off' ? '自动节点推进保持关闭，手动推进可用' : '自动节点推进恢复为开启'}</dd></dl></div>
      <div class="dialog-foot"><button class="btn ghost" data-a="dlg-close" autofocus>再看看</button><button class="btn primary" data-a="reconfirm-go">重新确认</button></div>`;
  }
  function abandonHTML() {
    return `<div class="dialog-body"><h2 id="tdDialogT">放弃这次调整？</h2><p>本地草稿会丢弃，计划保持修订 ${planRev()}；结束暂停新增领取后恢复调整前的设置：<b class="ink">${priorLabel()}</b>。</p></div>
      <div class="dialog-foot"><button class="btn ghost" data-a="dlg-close" autofocus>继续调整</button><button class="btn danger" data-a="abandon-go">放弃调整</button></div>`;
  }
  function resumeHTML() {
    return `<div class="dialog-body"><h2 id="tdDialogT">恢复任务？</h2><p>暂停在安全点的步骤从安全点继续；恢复后自动节点推进按原设置：<b class="ink">${autoOn ? '开启' : '关闭（手动推进）'}</b>。</p></div>
      <div class="dialog-foot"><button class="btn ghost" data-a="dlg-close" autofocus>保持暂停</button><button class="btn primary" data-a="resume-go">${I('play', 'sm')}恢复任务</button></div>`;
  }
  function pauseHTML() {
    return `<div class="dialog-body"><h2 id="tdDialogT">暂停任务？</h2><p>执行中的步骤会停在安全点；不再领取新步骤。暂停不影响工作区和已完成的步骤；之后由你“恢复任务”。</p></div>
      <div class="dialog-foot"><button class="btn ghost" data-a="dlg-close" autofocus>不暂停</button><button class="btn primary" data-a="pause-go">${I('pause', 'sm')}暂停任务</button></div>`;
  }
  function openCleanup(back) { dlg(cleanupHTML(), true); openLayer($('#tdDialog'), back || '#cleanBtn'); }

  /* ---------- 状态切换（同页、保留画布视角；命令结果用 replaceState，后退不会重放） ---------- */
  function goState(id, toast, extra) {
    const v = cv.view();
    while (layers.some((l) => l.el.id === 'tdDialog')) closeLayer($('#tdDialog'));
    S = id; QP.set('state', id);
    const keepEdits = !!(extra && extra.keepEdits); const e0 = edits;
    Object.entries(extra || {}).forEach(([k, x]) => { if (k === 'keepEdits' || k === 'fit') return; if (x === null || x === undefined) QP.delete(k); else QP.set(k, x); });
    if (ST[id] && ST[id].ut && T && !QP.get('task')) QP.set('task', T.id);
    history.replaceState(null, '', location.pathname + '?' + QP.toString());
    TD.init('task.html'); const sel = $('#tdStateSel'); if (sel) sel.value = id;
    editSel = null;
    load(); if (keepEdits) edits = e0;
    if (panel === 'adjust' && !adj) panel = null;
    renderAll(); if (extra && extra.fit) requestAnimationFrame(() => cv.fit(true)); else cv.restore(v);
    if (adj) openAdjPanel();
    else if (cfg.open === 'delivery') openDelivery(); else if (cfg.open === 'recovery') openRecovery(); else if (!cfg.open && panel !== 'snap') closeSide();
    if (cfg.drawer) { $('#wsDrawer').innerHTML = drawerHTML(); if (!layers.some((l) => l.el.id === 'wsDrawer')) openLayer($('#wsDrawer'), '#side [data-a="ws"]'); else $('#wsDrawer [data-a="drawer-close"]').focus(); }
    else ($('#side:not(.hidden) .tab[aria-selected="true"]') || $('#side:not(.hidden) .side-foot .btn.primary:not([aria-disabled])') || $('#cv')).focus();
    if (toast) DS.toast(toast, 'info');
  }
  function setVar(k, v) {
    const def = { kind: 'git', auth: 'allow', unique: '0' }[k];
    if (v === def) QP.delete(k); else QP.set(k, v);
    history.replaceState(null, '', location.pathname + '?' + QP.toString());
    const v0 = cv.view(); load(); renderAll(); cv.restore(v0);
    if (panel === 'delivery') openDelivery();
    if (layers.some((l) => l.el.id === 'wsDrawer')) { $('#wsDrawer').innerHTML = drawerHTML(); const b = $(`#wsDrawer [data-k="${k}"][data-v="${v}"]`); if (b) b.focus(); }
    else { const b = $(`#side [data-k="${k}"][data-v="${v}"]`); if (b) b.focus(); }
  }
  function renderAll() { bar(); situ(); renderCanvas(); if (panel === 'delivery') openDelivery(); else if (panel === 'node' && cv.selected) openNode(cv.selected); else if (panel === 'adjust' && adj) openAdjPanel(); else if (panel === 'snap') openSnap(); }
  const sim = (fn, ms) => setTimeout(fn, ms || 700);
  function setURL(extra) { Object.entries(extra).forEach(([k, x]) => { if (x === null) QP.delete(k); else QP.set(k, x); }); history.replaceState(null, '', location.pathname + '?' + QP.toString()); }

  /* ---------- 事件 ---------- */
  document.addEventListener('click', (e) => {
    const a = e.target.closest('[data-a]'); if (!a) return;
    const act = a.dataset.a;
    if (a.getAttribute('aria-disabled') === 'true') { e.preventDefault(); const r = a.getAttribute('aria-describedby'); const t = r && document.getElementById(r); if (t && act === 'dis') DS.toast(t.textContent, 'info'); return; }
    switch (act) {
      case 'back': break;
      case 'tasks': e.preventDefault(); SC.go('main/pages/tasks.html'); break;
      case 'ws': openLayer($('#wsDrawer'), a); $('#wsDrawer').innerHTML = drawerHTML(); setTimeout(() => $('#wsDrawer [data-a="drawer-close"]').focus(), 60); break;
      case 'legacy-info': openDelivery(); break;
      case 'drawer-close': closeLayer($('#wsDrawer')); break;
      case 'dlg-close': closeLayer($('#tdDialog')); break;
      case 'more': {
        const items = [{ label: '工作区详情', icon: 'folder', run() { openLayer($('#wsDrawer'), '#moreBtn'); $('#wsDrawer').innerHTML = drawerHTML(); } }, { label: '当前有效计划', icon: 'layers', run: openPlan }, { label: '审计记录', icon: 'clock', run: openAudit }];
        if (hasReq()) items.push({ label: '在需求画布查看', icon: 'file', run: openReq });
        if (isLegacy()) items.splice(0, 1);
        if (['failed'].includes(ph)) items.push({ label: '任务恢复…（独立恢复工作台）', icon: 'refresh', run() { SC.go('main/pages/recovery.html?state=default', { task: T.id, taskTitle: T.title, project: T.project, returnTo: retHere() }); } });
        items.push('-');
        if (isUT() && ph === 'running' && !adj && !isLegacy()) items.push({ label: '暂停任务…', icon: 'pause', run() { dlg(pauseHTML()); openLayer($('#tdDialog'), '#moreBtn'); } });
        if (['running', 'parallel'].includes(ph) && !adj) items.push({ label: '取消任务…', icon: 'stop', danger: true, run() { dlg(cancelHTML()); openLayer($('#tdDialog'), '#moreBtn'); } });
        DS.menu(a, items); break;
      }
      case 'auto': {
        autoOn = !autoOn; setURL({ auto: autoOn ? '1' : '0' });
        DS.toast(autoOn ? '已开启自动节点推进（服务设置已更新 · 模拟）' : '已关闭自动节点推进：执行中的步骤会继续跑完，之后等你推进', 'info');
        renderAll(); const sw = $('#autoSw'); if (sw) sw.focus(); break;
      }
      case 'advance-all': case 'advance-succ': {
        const list = act === 'advance-all' ? advanceable().map((n) => n.title) : succs(a.dataset.id).filter((id) => st()[id] === 'adv').map(nTitle);
        a.disabled = true; a.innerHTML = '<span class="spin"></span>放行中';
        sim(() => goState('ut-auto-off', null, { at: null }) || DS.toast(`已放行 ${list.length} 步：${list.join('、')}；它们验收后不会自动继续`, 'ok'), 700); break;
      }
      case 'adjust': dlg(adjustHTML()); openLayer($('#tdDialog'), '#adjBtn'); break;
      case 'adjust-go': {
        const pr = ph === 'paused' ? 'paused' : autoOn ? 'on' : 'off';
        goState('ut-adj-pausing', null, { prior: pr, auto: autoOn ? '1' : '0', note: null, was: null, task: T.id, ret: S });
        sim(() => { if (S === 'ut-adj-pausing') goState('ut-adj-editing', '暂停新增领取已生效（回执 rk-e51b）· 可以编辑待执行步骤'); }, 1200); break;
      }
      case 'save': {
        a.setAttribute('aria-busy', 'true'); a.innerHTML = '<span class="spin"></span>保存中';
        const conflictDemo = !reread && edits.mod;
        sim(() => { if (conflictDemo) goState('ut-adj-conflict', null, { keepEdits: true }); else goState('ut-adj-reconfirm', `已保存语义修改（计划修订 ${planRev()} → ${planRev() + 1}，模拟）· 需要重新确认`); }, 700); break;
      }
      case 'reread': {
        a.disabled = true; a.innerHTML = '<span class="spin"></span>读取中';
        sim(() => { goState('ut-adj-editing', '已重读计划（含最新领取）', { keepEdits: true }); reread = true; renderAll(); openAdjPanel(); }, 700); break;
      }
      case 'abandon': dlg(abandonHTML()); openLayer($('#tdDialog'), a); break;
      case 'abandon-go': {
        const was = prior;
        goState(retState(was), null, { note: 'abandoned', was, auto: was === 'off' ? '0' : QP.get('auto'), prior: null, ret: null, fit: true });
        DS.toast('已放弃调整；已恢复调整前的设置（模拟）', 'info'); break;
      }
      case 'reconfirm': dlg(reconfirmHTML()); openLayer($('#tdDialog'), '#reconfirmBtn'); break;
      case 'reconfirm-go': { closeLayer($('#tdDialog')); sim(() => goState('ut-adj-ready', `计划修订 ${planRev() + 1} 已重新确认（模拟）`), 500); break; }
      case 'continue': {
        const was = prior;
        setURL({ added: '1' });
        goState(retState(was), null, { note: was === 'paused' ? 'adjusted-paused' : 'continued', was, auto: was === 'off' ? '0' : '1', prior: null, ret: null, fit: true });
        DS.toast(was === 'paused' ? '已结束调整；任务保持暂停' : was === 'off' ? '已继续执行；自动节点推进保持关闭（调整前设置）' : '已继续执行；自动节点推进恢复为开启', 'ok'); break;
      }
      case 'edit-focus': editSel = a.dataset.id; cv.focusNode(a.dataset.id); break;
      case 'edit-back': editSel = null; quiet = true; cv.select(null); quiet = false; openAdjPanel(); break;
      case 'undo-add': edits.added = false; editSel = null; renderAll(); openAdjPanel(); break;
      case 'del-node': DS.toast('将先列出需求覆盖、输入输出与必需产物的影响，再确认移除（原型未展开）', 'info'); break;
      case 'resume': dlg(resumeHTML()); openLayer($('#tdDialog'), '#resumeBtn'); break;
      case 'resume-go': goState(autoOn ? 'ut-running-mid' : 'ut-auto-off', '任务已恢复（模拟）', { note: null, at: null }); break;
      case 'pause-go': goState('ut-paused', '任务已暂停：运行中的步骤停在安全点（模拟）', { note: null }); break;
      case 'note-x': setURL({ note: null, was: null }); situ(); break;
      case 'focus-stat': { const id = Object.keys(st()).find((k) => st()[k] === a.dataset.s); if (id) cv.focusNode(id); break; }
      case 'approve': goState('ut-running-mid', a.dataset.all ? '本任务内同类写入将自动允许（模拟）' : '已允许本次，步骤继续执行（模拟）', { at: null }); break;
      case 'deny': DS.toast('已拒绝；这一步会说明无法完成的部分（模拟）', 'warn'); break;
      case 'restart-step': DS.toast('已请求执行器从安全点重试（模拟）；是否恢复由执行服务判定', 'info'); break;
      case 'accept': a.innerHTML = '<span class="spin"></span>提交中'; sim(() => goState('td02-awaiting', '已验收：执行结束，等待你选择交付', { task: T.id })); break;
      case 'reject-review': DS.toast('已退回，请写明原因（原型未展开）', 'warn'); break;
      case 'reread-status': a.innerHTML = '<span class="spin"></span>读取中'; sim(() => goState('ut-running-mid', '已重新读取：步骤仍在执行', { at: null }), 800); break;
      case 'recover': rec = { mode: 'retry', phase: 'choose' }; goState('ut-recovering'); break;
      case 'rec-mode': rec.mode = a.dataset.m; openRecovery(); break;
      case 'rec-back': rec.phase = 'choose'; goState('ut-failed'); break;
      case 'rec-prepare': rec.phase = 'creating'; openRecovery(); sim(() => { rec.phase = 'ready'; openRecovery(); $('#side [data-a="rec-start"]')?.focus(); }, 900); break;
      case 'rec-start': rec = { mode: 'retry', phase: 'choose' }; goState('ut-running-mid', '恢复已开始（模拟）：失败记录保留', { at: 'recover' }); break;
      case 'snap': openSnap(a.dataset.t); setURL({ snap: a.dataset.t }); break;
      case 'snap-batches': snapBatches = !snapBatches; openSnap('progress'); break;
      case 'snap-retry': snap = 'batches'; snapBatches = true; openSnap('progress'); break;
      case 'snap-read': snapPartial = 'loading'; openSnap('reports'); sim(() => { snapPartial = 'read'; openSnap('reports'); }, 800); break;
      case 'toast': DS.toast(a.dataset.msg, 'info'); break;
      case 'open-req': openReq(); break;
      case 'open-deliv': selectEnd(); break;
      case 'pick-n2': cv.focusNode('n2'); break;
      case 'close-side': closeSide(); break;
      case 'desel': cv.select(null); break;
      case 'tab': openDelivery(a.dataset.t); $(`#side [data-t="${a.dataset.t}"]`).focus(); break;
      case 'node-tab': openNode(a.dataset.id, a.dataset.t); break;
      case 'node-act': DS.toast('沿用原任务画布的步骤详情（原型未展开）', 'info'); break;
      case 'deliver': case 'deliver-view': if (isGit()) TD.go('td03-changes', ctx()); else TD.go('td05-overview', ctx()); break;
      case 'continue-push': TD.go('td04-committed-wait-push', ctx()); break;
      case 'check-push': TD.go('td04-push-unknown', ctx()); break;
      case 'view-mr': TD.go('td07-mr-detail', ctx()); break;
      case 'view-applied': TD.go('td05-applied', ctx()); break;
      case 'gitlab': DS.toast('外部链接来自可信读口；设计样例不打开外部地址', 'info'); break;
      case 'nochg': dlg(nochgHTML()); openLayer($('#tdDialog'), a); break;
      case 'focus-n4': while (layers.length) closeTop(); cv.focusNode('n4'); setTimeout(() => $('#side [data-a="desel"]')?.focus(), 400); break;
      case 'audit': while (layers.length) closeTop(); openAudit(); $('#side [data-a="close-side"]').focus(); break;
      case 'var': setVar(a.dataset.k, a.dataset.v); break;
      case 'copy': DS.toast('已复制' + (a.dataset.what || '') + '（原型示意，未写剪贴板）', 'info'); break;
      case 'open-bg': TD.go('td02-awaiting', { task: 'T-2042', from: 'task', fromState: S }); break;
      case 'bg-dismiss': bgNote = false; overlays(); $('#cv').focus(); break;
      case 'cleanup': openCleanup(a); break;
      case 'clean-do': {
        let k = 0; dlg(cleaningHTML(0), true); $('#tdDialog').focus();
        busy = setInterval(() => { k++; if (k < 5) dlg(cleaningHTML(k), true); else { clearInterval(busy); goState('td06-cleaned', '工作区已清理 · 交付回执仍可阅读'); } }, 520);
        break;
      }
      case 'cancel-do': dlg(cancelHTML(true)); $('#tdDialog').focus(); setTimeout(() => goState('td02-cancelled-retained', '任务已取消 · 文件保留，可稍后交付 / 查看'), 1200); break;
      case 'recheck-clean': {
        a.disabled = true; a.innerHTML = '<span class="spin"></span>核对中';
        setTimeout(() => { $('#partialCheck').innerHTML = `<div class="banner ok" style="margin-top:10px" role="status">${I('check')}<div><b>核对完成</b><br>原清理操作已在 16:31 生效：本地任务分支已删除。没有再次发出删除。</div></div>`; setTimeout(() => goState('td06-cleaned'), 1100); }, 1000);
        break;
      }
    }
  });
  document.addEventListener('input', (e) => {
    if (!editing() || !editSel || !T.adj) return;
    if ((e.target.id === 'fAcc' || e.target.id === 'fTitle') && editSel === T.adj.conflict && !edits.mod) { edits.mod = true; renderCanvas(); }
  });
  document.addEventListener('change', (e) => {
    if (e.target.id === 'ackU') { const b = $('#cleanDo'); if (!b) return; if (e.target.checked) { b.removeAttribute('aria-disabled'); $('#cleanWhy').textContent = '已确认知情'; } else { b.setAttribute('aria-disabled', 'true'); $('#cleanWhy').textContent = '需要先勾选知情确认'; } }
    if (e.target.dataset.pred) DS.toast('已更新本地草稿中的前置步骤（未保存）', 'info');
  });
  /* 调整结束（继续 / 放弃）后回到调整前的状态：由 guard 记录的原模式决定，不写死“自动开启” */
  function retState(was) {
    const r = QP.get('ret');
    if (r && ST[r] && !ST[r].adj && (was !== 'paused' || ST[r].ph === 'paused')) return r;
    return was === 'paused' ? 'ut-paused' : was === 'off' ? 'ut-auto-off' : 'ut-running-mid';
  }
  function retHere() { return location.href.slice(SC.originalRoot.href.length).replace(/([?&])(theme|skin)=[^&]*/g, '$1').replace(/[?&]+$/, ''); }
  function hasReq() { return T.origin === 'planning' || !!(window.UTF && UTF.LEGACY[T.id]); }
  function openReq() { SC.go('planning/requirement.html?state=b08', { task: T.id, at: runKey() === 'first' ? 'first' : null, returnTo: retHere(), from: 'task' }); }

  /* ---------- 挂载 ---------- */
  DS.mount({ header: '', proto: false });
  $('.header').remove();
  TD.mountProto();
  if (cfg.bg) {
    const tl = $('.nav [data-proto-nav="任务列表"]'); if (tl) tl.insertAdjacentHTML('beforeend', '<span class="count num td-count" aria-label="1 个任务等待交付">1</span>');
    const ib = $('.nav [data-proto-nav="待处理中心"] .count'); if (ib) { ib.textContent = '3'; ib.setAttribute('aria-label', '3 项待处理，含 1 个等待交付的任务'); }
  }
  if (isUT()) document.title = `任务画布 · ${T.title} · opencode-workflow 设计样例`;
  bar(); situ(); renderCanvas();
  if (adj) openAdjPanel();
  else if (cfg.open === 'delivery') openDelivery();
  else if (cfg.open === 'recovery') openRecovery();
  else if (cfg.open === 'snap') openSnap(snapTab);
  else if (cfg.open && cfg.open.startsWith('node:')) { const id = cfg.open.slice(5); quiet = true; cv.select(id); quiet = false; openNode(id); }
  decorate();
  requestAnimationFrame(() => requestAnimationFrame(() => {
    cv.fit(false);
    if (cfg.open && cfg.open !== 'recovery' && cfg.open !== 'snap') focusView(cfg.open === 'delivery' ? 'end' : cfg.open.slice(5));
    /* 节点详情往返：恢复同任务的选中步骤、右侧面板与页签、画布视角 */
    const selN = QP.get('selectedNode');
    if (/^n\d+$/.test(selN || '') && allNodes().some((n) => n.id === selN)) {
      const p = QP.get('sidePanel');
      if (p === 'delivery') openDelivery(QP.get('sideTab') || 'overview');
      else { quiet = true; cv.select(selN); quiet = false; openNode(selN, 'overview'); }
      try { const v = JSON.parse(QP.get('canvasView')); if (v && ['tx', 'ty', 'k'].every((k) => Number.isFinite(v[k]))) cv.restore(v); } catch (err) { /* 原型：忽略 */ }
    }
    if (cfg.drawer) { $('#wsDrawer').innerHTML = drawerHTML(); openLayer($('#wsDrawer'), '#side [data-a="ws"]'); if (ph === 'cleanPartial') { const c = $('#wsClean'), body = $('#wsDrawer .drawer-body'); body.scrollTop = c.offsetTop - body.offsetTop - 12; } }
    if (cfg.dialog === 'cleanup') { openCleanup('#cleanBtn'); }
    if (cfg.dialog === 'cancel') { dlg(cancelHTML()); openLayer($('#tdDialog'), '#moreBtn'); }
    if (S === 'ut-adj-pausing' && QP.get('sim') === '1') sim(() => { if (S === 'ut-adj-pausing') goState('ut-adj-editing', '暂停新增领取已生效（回执 rk-e51b）'); }, 1200);
  }));
  // 自检用：读取画布视角、选中、面板与页签（只读）
  window.__tdTask = { view: () => cv.view(), sel: () => cv.selected, panel: () => panel, tab: () => (panel === 'delivery' ? tab : nodeTab), layers: () => layers.map((l) => l.el.id), auto: () => autoOn, prior: () => prior, task: () => T.id, state: () => S };
})();
