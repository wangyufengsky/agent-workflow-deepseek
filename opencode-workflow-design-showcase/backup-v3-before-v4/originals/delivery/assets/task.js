/* task.html · TD02 任务画布与待交付 + TD06 工作区详情与清理（设计样例 · 合成数据）
   - 画布、情况条、右侧 480 面板、页签与底部动作沿用原稿 deepseek/pages/task.html
   - 不发请求、不写本机存储；所有写操作（取消、清理、核对）只用定时器切换模拟状态
*/
(function () {
  'use strict';
  const I = DS.icon, esc = DS.esc, $ = DS.$, $$ = DS.$$;
  const FX = window.TASK_FX;
  const QP = new URLSearchParams(location.search);
  let S = TD.init('task.html');

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
  };
  const DONE = { n1: 'done', n2: 'done', n3: 'done', n4: 'done', n5: 'done' };
  const NODEMAP = {
    running: { n1: 'done', n2: 'run', n3: 'run', n4: 'idle', n5: 'idle' },
    parallel: { n1: 'done', n2: 'run', n3: 'run', n4: 'idle', n5: 'idle' },
    failcand: Object.assign({}, DONE, { n4: 'fail' }),
    deliveredFail: Object.assign({}, DONE, { n4: 'fail' }),
    cancelled: { n1: 'done', n2: 'done', n3: 'done', n4: 'idle', n5: 'idle' },
  };

  let cfg, ph, T, kind, auth, uniq, panel = null, tab = 'overview', nodeTab = 'overview', bgNote = true, busy = null;
  function load() {
    cfg = ST[S] || ST['td02-awaiting'];
    ph = cfg.ph;
    kind = cfg.kind || (!cfg.gitOnly && QP.get('kind') === 'dir' ? 'dir' : 'git');
    T = kind === 'dir' ? FX.T2043 : (QP.get('task') === 'T-2042' ? FX.T2042 : FX.T2041);
    auth = QP.get('auth') === 'deny' ? 'deny' : 'allow';
    uniq = QP.get('unique') === '1';
  }
  load();
  const isGit = () => kind === 'git';
  const st = () => NODEMAP[ph] || DONE;
  const total = () => T.adm.A + T.adm.M + T.adm.D;
  const delivered = () => ['delivered', 'deliveredFail', 'cleaned', 'cleanPartial'].includes(ph);
  const undelivered = () => ph === 'nochg' ? 0 : delivered() ? (kind === 'dir' && ph !== 'cleaned' ? T.applied.skip : 0) : total();
  const undeliveredDesc = () => delivered() ? `<span class="mono">config/report.yaml</span>（修改 · 暂不交付）` : `新增 ${T.adm.A} · 修改 ${T.adm.M} · 删除 ${T.adm.D}`;
  const ctx = () => Object.assign({ from: 'task', fromState: S }, kind === 'dir' ? { kind: 'dir' } : {}, T.id === 'T-2042' ? { task: 'T-2042' } : {});
  const nTitle = (id) => T.nodes.find((n) => n.id === id).title;

  /* ---------- 画布 ---------- */
  const cvOpt = {
    nodes: [], edges: [],
    statusOf: (id) => st()[id],
    onSelect: (id, sys) => {
      if (quiet) return;
      if (sys) { if (id === 'end') openDelivery(); else decorate(); return; }
      if (!id) { closeSide(); return; }
      openNode(id); cv.reveal(id);
    },
  };
  let quiet = false;
  function buildGraph() {
    const showWrite = ['running', 'parallel'].includes(ph);
    cvOpt.nodes = T.nodes.map((n) => {
      const m = Object.assign({}, n);
      if (showWrite) m.meta = { n1: '只读 · 基线一致快照', n2: '写入：' + T.subs[0][1], n3: '写入：' + T.subs[1][1], n4: '读：汇合后的一致快照', n5: '只读验收' }[n.id];
      return m;
    });
    const lab = showWrite ? { 'n2>n4': '汇合', 'n3>n4': '汇合' } : {};
    cvOpt.edges = [['start', 'n1'], ['n1', 'n2'], ['n1', 'n3'], ['n2', 'n4'], ['n3', 'n4'], ['n4', 'n5'], ['n5', 'end']].map(([from, to]) => ({ from, to, label: lab[from + '>' + to] }));
  }
  buildGraph();
  const cv = DSCanvas($('#cv'), cvOpt);
  function decorate() {
    const b = $('#cv .cv-sys[data-id="end"]'); if (!b) return;
    const E = PH[ph].end;
    b.classList.add('td-end'); b.classList.toggle('sel', panel === 'delivery');
    b.setAttribute('aria-pressed', panel === 'delivery');
    b.setAttribute('aria-label', `交付端点：${E[0]}。打开交付面板`);
    b.innerHTML = `<span class="td-end-t">${I('inbox', 'sm')}交付</span><span class="badge ${E[1]}">${I(E[2], 'sm')}${E[0]}</span>`;
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
  function renderCanvas() { buildGraph(); cv.render(); decorate(); overlays(); }

  /* ---------- 页头 ---------- */
  function bar() {
    const B = PH[ph].task, X = ph === 'failcand' || ph === 'deliveredFail' ? null : PH[ph].extra;
    const r = TD.ret();
    const running = ph === 'running' || ph === 'parallel';
    $('#bar').innerHTML = `
      <nav class="crumbs"><a href="#" data-a="tasks">任务列表</a><span class="sep">/</span></nav>
      <span class="task-title" title="${esc(T.title)}">${esc(T.title)}</span>
      <span class="badge ${B[1]}" id="taskBadge">${I(B[2], 'sm')}${B[0]}</span>
      ${ph === 'failcand' ? `<span class="badge st-fail">${I('x', 'sm')}验证未通过</span>` : ''}
      ${X ? `<span class="badge ${X[1]}">${I(X[2], 'sm')}${X[0]}</span>` : ''}
      <button class="td-wschip" data-a="ws" id="wsChip" aria-label="工作区详情：${esc(T.ws)}">${I(isGit() ? 'branch' : 'folder', 'sm')}<span class="ellipsis">${esc(T.ws)}</span><span class="td-wsk">${isGit() ? 'worktree' : '独立副本'}</span></button>
      <span class="td-mock" title="合成数据，不连接任务、Git、GitLab、目录或模型">设计样例 · 合成数据，不连接任务 / Git / 目录</span>
      <span class="grow"></span>
      ${r.from === 'task' && r.fromState ? `<a class="btn ghost sm" href="${TD.backHref()}">${I('arrowLeft', 'sm')}返回上一个任务</a>` : ''}
      ${running ? `<label class="auto" title="开启时，步骤验收通过后自动开始满足条件的下一批步骤">自动节点推进<button class="switch" role="switch" aria-checked="true" aria-label="自动节点推进" data-a="auto"></button></label>` : ''}
      <button class="icon-btn" aria-label="更多" data-a="more" id="moreBtn">${I('more')}</button>`;
  }

  /* ---------- 情况条：两个事实 ---------- */
  function execFact() {
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
  function situ() {
    const e = execFact(), d = delivFact();
    let right = '';
    if (ph === 'running') right = `<span class="hint td-sit-hint">${I('lock', 'sm')}写入在独立${isGit() ? '工作区' : '副本'} ${esc(T.ws)}，原项目不受影响</span>`;
    else if (ph === 'parallel') right = `<button class="btn secondary sm" data-a="pick-n2">${I('split', 'sm')}查看并行写策略</button>`;
    else right = `<button class="btn secondary sm" data-a="open-deliv">${I('inbox', 'sm')}${delivered() ? '查看交付回执' : '打开交付'}</button>`;
    $('#situ').innerHTML = `<div class="situ td-situ ${PH[ph].sit}" role="status">
      <div class="td-fact"><span class="td-fk">执行与验收</span><span class="td-fv" style="color:${e[2]}">${I(e[0], 'sm')}<span>${e[1]}</span></span></div>
      <span class="sep" aria-hidden="true"></span>
      <div class="td-fact"><span class="td-fk">交付</span><span class="td-fv" style="color:${d[2]}">${I(d[0], 'sm')}<span>${d[1]}</span></span></div>
      <span class="grow"></span>${right}</div>`;
  }
  function overlays() {
    $$('#cv .cv-overlay').forEach((e) => e.remove());
    $('#cv').insertAdjacentHTML('beforeend', `<div class="cv-overlay legend" aria-hidden="true"><span style="color:var(--run)">${I('play', 'sm')}执行中</span><span style="color:var(--warn)">${I('x', 'sm')}失败</span><span style="color:var(--done)">${I('check', 'sm')}完成</span><span>${I('inbox', 'sm')}交付端点可点击</span></div>`);
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
  function closeSide() { panel = null; sideShow(false); decorate(); situ(); }
  function selectEnd() { quiet = true; if (cv.selected) cv.select(null); quiet = false; openDelivery(); cv.reveal('end'); }
  function openDelivery(t) {
    if (t) tab = t;
    if (cv.selected) { quiet = true; cv.select(null); quiet = false; }
    panel = 'delivery'; sideShow(true);
    const E = PH[ph].end;
    const tabs = [['overview', '交付概览'], ['changes', isGit() ? '任务变更' : '副本变更'], ['records', '交付记录']];
    $('#side').innerHTML = `
      <div class="side-head"><div class="grow"><div class="eyebrow">系统节点 · 任务级交付端点</div><div class="td-ptitle">交付</div>
        <div class="row wrap" style="gap:6px;margin-top:8px"><span class="badge ${E[1]}">${I(E[2], 'sm')}${E[0]}</span><span class="badge outline">${I(isGit() ? 'branch' : 'folder', 'sm')}${isGit() ? 'Git · 独立分支与 worktree' : '非 Git · 基线快照与独立副本'}</span></div></div>
        <button class="icon-btn" aria-label="关闭交付面板，回到全图" data-a="close-side">${I('x')}</button></div>
      <div class="tabs" role="tablist" aria-label="交付面板" style="padding:0 12px">${tabs.map(([k, l]) => `<button class="tab" role="tab" aria-selected="${tab === k}" data-a="tab" data-t="${k}">${l}</button>`).join('')}</div>
      <div class="side-body" id="sideBody">${{ overview: dOverview, changes: dChanges, records: dRecords }[tab]()}</div>
      ${dFooter()}`;
    decorate(); situ();
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
      case 'running': case 'parallel':
        return `<div class="banner info">${I('info')}<div><b>执行尚未结束</b><br>「${esc(nTitle('n2'))}」「${esc(nTitle('n3'))}」执行中。全部步骤结束并验收后，这里会变为待交付。</div></div>`;
      case 'awaiting':
        return `<div class="lockline">${I('lock', 'sm')}<span><b class="ink">执行已结束，等待你选择交付。</b>交付前任务不算完成；各节点保留自己的验收结果，交付不会再跑一遍验收。</span></div>`;
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
    const vFail = ['failcand', 'deliveredFail'].includes(ph), running = ['running', 'parallel'].includes(ph);
    const passN = ph === 'cancelled' ? '3 / 5' : running ? '1 / 5' : vFail ? '4 / 5' : '5 / 5';
    const goal = g ? ({ committed: '提交、推送并创建 MR', pushUnknown: '提交、推送并创建 MR' }[ph] || (delivered() ? '提交、推送并创建 MR' : '尚未选择 · 在 Git 工作台三选一')) : (delivered() ? '将所选变更应用回原项目' : '将所选变更应用回原项目 · 尚未选择文件');
    const action = { committed: '等待你确认推送', pushUnknown: '核对原推送', blocked: '无 · 等待执行停稳', running: '无', parallel: '无' }[ph] || (delivered() ? '无 · 已结算' : '无');
    const orig = { committed: `提交 <span class="td-sha">${T.commit}</span> 已结算（回执 16:12）`, pushUnknown: `<span style="color:var(--unknown)">${I('help', 'sm')} 推送 · 回执未知（原请求 req·p-2041-1）</span>` }[ph] || (delivered() ? '全部原请求已结算' : '无待核对的原请求');
    const pending = delivered() ? (g ? '未纳入 3 项保留在工作区（不在交付范围）' : 'config/report.yaml 暂不交付，留在独立副本') : ph === 'nochg' ? '无' : `${total()} 个文件未交付 · ${T.excluded.length} 项未纳入（不会交付）`;
    const retained = ph === 'cleaned' ? `已清理本地${g ? '任务分支、worktree 目录与子工作区' : '独立副本与子副本'}（你于 16:45 确认）<div class="hint">保留：${g ? '远端分支、MR、提交、' : '原目录、基线快照、'}全部回执与记录</div>`
      : `${g ? `任务分支 <span class="mono">${esc(T.branch)}</span> · worktree 目录 · 子工作区 2 个（已汇合）` : `独立副本 · 基线快照 <span class="mono">${T.baseline}</span> · 子副本 2 个（已汇合）`}<div class="hint">全部保留，不会自动或定时清理${ph === 'cleanPartial' ? ' · 清理未完成，待核对' : ''}</div>`;
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
    if (!cfg.gitOnly && !cfg.kind) segs.push(['kind', '项目类型', [['git', 'Git · T-2041'], ['dir', '非 Git · T-2043']], kind]);
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
      ${ph === 'cleaned' ? '' : `<div class="sec"><button class="btn secondary sm" data-a="deliver-view"${ph === 'nochg' ? ' aria-disabled="true"' : ''}>${I('external', 'sm')}${g ? '在 Git 工作台查看 diff' : '在应用视图查看三方比较'}</button></div>`}`;
  }
  function dRecords() {
    const g = isGit();
    const R = [['10:31', `准备${g ? '独立工作区' : '独立副本'}`, '已结算', 'ok']];
    if (ph === 'cancelled') R.push(['15:10', '取消任务 · 执行服务确认停稳', '已结算', 'ok'], ['15:10', '工作区保留（未清理）', '保留中', 'idle']);
    else if (!['running', 'parallel'].includes(ph)) R.push(['16:01', '执行结束 · 交付端点到达', ph === 'blocked' ? '执行未停稳' : '已记录', ph === 'blocked' ? 'stall' : 'ok'], ['16:02', `读取变更快照 ${T.changesRev}`, '只读', 'idle']);
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
      case 'running': case 'parallel': f = dis('执行尚未结束，结束并验收后才能交付'); break;
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

  /* ---------- 右侧面板：步骤（沿用原稿结构，新增「写入位置」） ---------- */
  function openNode(id, t) {
    if (!id) { closeSide(); return; }
    if(['session','attempts'].includes(t)){const n=T.nodes.find(x=>x.id===id);SC.openExecutionNode(id,t,{title:n?.title,taskTitle:T.title});return;}
    if (t) nodeTab = t;
    panel = 'node'; sideShow(true);
    const n = T.nodes.find((x) => x.id === id), s = st()[id], SS = DSCanvas.STATUS[s];
    const showTabs = !['idle', 'ready'].includes(s); if (!showTabs) nodeTab = 'overview';
    const tabs = [['overview', '概览'], ['session', '执行现场'], ['attempts', '尝试与产出']];
    $('#side').innerHTML = `
      <div class="side-head"><div class="grow"><div class="eyebrow">步骤 ${T.nodes.indexOf(n)} · ${n.role}</div><div class="td-ptitle">${esc(n.title)}</div><span class="badge ${SS[1]}" style="margin-top:8px">${I(SS[2], 'sm')}${SS[0]}</span></div>
        <button class="icon-btn" aria-label="关闭步骤详情，回到全图" data-a="desel">${I('x')}</button></div>
      ${showTabs ? `<div class="tabs" role="tablist" style="padding:0 12px">${tabs.map(([k, l]) => `<button class="tab" role="tab" aria-selected="${nodeTab === k}" data-a="node-tab" data-id="${id}" data-t="${k}">${l}</button>`).join('')}</div>` : ''}
      <div class="side-body">${{ overview: nOverview, session: nSession, attempts: nAttempts }[nodeTab](n, s)}</div>
      <div class="side-foot">${nFooter(n, s)}</div>`;
    decorate();
  }
  function writePos(n) {
    const g = isGit(), W = g ? '工作区' : '副本';
    const i = n.id === 'n2' ? 0 : n.id === 'n3' ? 1 : -1;
    if (i >= 0) return `<div class="td-wpos">${I(g ? 'branch' : 'folder', 'sm')}<div><b>${esc(T.subs[i][1])}</b> · 本步骤独占写入<div class="hint">从任务${W}分出；两步都验收后由服务汇合到任务${W} <span class="mono">${esc(T.ws)}</span>。不写原项目目录。</div></div></div>`;
    if (n.id === 'n4') return `<div class="td-wpos">${I('eye', 'sm')}<div><b>读汇合后的一致快照</b><div class="hint">测试产物写入 coverage/（未纳入交付）</div></div></div>`;
    return `<div class="td-wpos">${I('eye', 'sm')}<div><b>只读</b><div class="hint">${n.id === 'n1' ? '读取基线一致快照，不写文件' : '只读验收，不写文件'}</div></div></div>`;
  }
  function nOverview(n, s) {
    let top = '';
    if (s === 'fail') top = `<div class="reason" style="background:var(--warn-fill)"><b style="color:var(--warn)">失败原因</b><br>2 个用例断言不通过：<ul style="margin:6px 0 0;padding-left:18px;color:var(--ink-2)"><li>export 分页边界 › 末页为空时页码越界</li><li>export 分页边界 › 单页 1000 条时漏掉最后一条</li></ul><div class="hint" style="margin-top:6px">失败记录保留；是否允许知情交付由原证据规则判定，见「交付」端点。</div></div>`;
    const strat = ph === 'parallel' && (n.id === 'n2' || n.id === 'n3') ? `<div class="sec"><div class="sec-t">并行写策略 · 服务决定</div><div class="td-flow">
      <div class="td-flow-r"><span class="chip">${esc(nTitle('n2'))}</span>${I('arrowRight', 'sm')}<span class="chip">${esc(T.subs[0][1])}</span></div>
      <div class="td-flow-r"><span class="chip">${esc(nTitle('n3'))}</span>${I('arrowRight', 'sm')}<span class="chip">${esc(T.subs[1][1])}</span></div>
      <div class="td-flow-r">${I('chevRight', 'sm')}<span>汇合（服务执行）</span>${I('arrowRight', 'sm')}<span class="chip">任务${isGit() ? '工作区' : '副本'}</span>${I('arrowRight', 'sm')}<span>回归测试读一致快照</span></div></div>
      <p class="hint" style="margin-top:8px">策略由调度服务决定并在这里展示，不需要你分配目录。汇合有冲突时，汇合步骤会停下并在画布上显示原因。</p></div>` : '';
    return `${top ? `<div class="sec">${top}</div>` : ''}
      <div class="sec"><div class="sec-t">写入位置</div>${writePos(n)}</div>${strat}
      <div class="sec"><div class="sec-t">这一步做什么</div><p class="td-p">${esc(n.what)}</p></div>
      <div class="sec"><div class="sec-t">谁来做</div><div class="att"><span class="cv-av" style="width:28px;height:28px;background:var(--accent-fill);color:var(--accent)">${n.role === '人工' ? I('users', 'sm') : n.role[0]}</span><span class="grow">${n.role}<div class="hint">执行时冻结的职业</div></span></div></div>
      <div class="sec"><div class="sec-t">产出</div><div class="att">${I('file', 'sm')}<span class="grow">${esc(n.output)}</span>${s === 'done' || s === 'fail' ? '<button class="btn ghost sm" data-a="node-act">打开</button>' : '<span class="hint">尚未产出</span>'}</div></div>`;
  }
  function nSession(n, s) {
    return `<div class="row" style="margin-bottom:12px"><span class="badge ${s === 'run' ? 'st-run' : 'st-idle'}">${s === 'run' ? '<span class="dot pulse"></span>实时' : '已结束'}</span><span class="hint">尝试 1 · 开始于 14:20 · 目录 ${esc(n.id === 'n2' ? T.subs[0][1] : n.id === 'n3' ? T.subs[1][1] : '任务' + (isGit() ? '工作区' : '副本'))}</span></div>
      <div class="log"><div class="m"><span class="who">14:20</span><span>读取需求说明与接口约定</span></div>
      <div class="m"><span class="who">14:22</span><span><span class="tool">read</span> src/refund/service.ts</span></div><div class="res">→ 412 行</div>
      <div class="m"><span class="who">14:31</span><span><span class="tool">edit</span> src/refund/export.ts · 新增分页导出</span></div><div class="res">→ +182</div>
      ${s === 'run' ? `<div class="m"><span class="who">14:40</span><span><span class="tool">bash</span> npm run lint</span></div><div class="res"><span class="spin" style="display:inline-block;vertical-align:-2px"></span> 运行中…</div>` : ''}</div>
      <p class="hint" style="margin-top:14px">只显示工具调用摘要；完整参数与输出在「尝试与产出」。</p>`;
  }
  function nAttempts(n, s) {
    const a = s === 'fail' ? ['尝试 1', '失败 · 2 个用例未通过', 'st-fail', '失败'] : s === 'run' ? ['尝试 1', '进行中', 'st-run', '进行中'] : ['尝试 1', '通过 · 双评审一致', 'st-done', '通过'];
    return `<div class="att"><span class="grow"><div>${a[0]}</div><div class="hint">${a[1]}</div></span><span class="badge ${a[2]}">${a[3]}</span><button class="btn ghost sm" data-a="node-act">查看</button></div>`;
  }
  function nFooter(n, s) {
    return {
      run: `<span class="grow"></span><button class="btn primary" data-a="node-tab" data-id="${n.id}" data-t="session">${I('terminal', 'sm')}查看执行现场</button>`,
      done: `<span class="grow"></span><button class="btn secondary" data-a="node-tab" data-id="${n.id}" data-t="attempts">查看产出</button>`,
      fail: `<button class="btn ghost sm" data-a="node-tab" data-id="${n.id}" data-t="attempts">查看尝试</button><span class="grow"></span><button class="btn secondary" data-a="node-act">${I('refresh', 'sm')}恢复这一步…</button>`,
      idle: `<span class="hint grow">等待前面的步骤完成</span>`,
    }[s] || '';
  }
  function openAudit() {
    if (cv.selected) { quiet = true; cv.select(null); quiet = false; }
    panel = 'audit'; sideShow(true); decorate();
    const rows = [['10:31', '准备独立工作区成功，开始执行'], ['14:20', `「${nTitle('n2')}」「${nTitle('n3')}」开始，各写子工作区`], ['15:40', '服务汇合子工作区到任务工作区'], ['16:01', '人工验收通过；执行结束请求已发出'], ['16:03', '「回归测试」执行进程仍在写入，未确认退出（等待服务确认停稳）']];
    $('#side').innerHTML = `<div class="side-head"><div class="grow"><div class="eyebrow">只读</div><div class="td-ptitle">审计记录</div></div><button class="icon-btn" aria-label="关闭" data-a="close-side">${I('x')}</button></div>
      <div class="side-body"><div class="log" style="font-family:var(--font)">${rows.map(([t, x]) => `<div class="m"><span class="who mono">${t}</span><span style="font-size:13px">${esc(x)}</span></div>`).join('')}</div></div>
      <div class="side-foot"><button class="btn ghost sm" data-a="open-deliv">${I('arrowLeft', 'sm')}回到交付</button></div>`;
  }

  /* ---------- 图层：抽屉 / 对话框（焦点限定、Esc 关闭、焦点还原） ---------- */
  const layers = []; // {el, back}
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
    const runningW = ['running', 'parallel'].includes(ph);
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
            ['子' + W, cleaned ? '已删除' : `${esc(T.subs[0][1])}（${esc(T.subs[0][0])}）、${esc(T.subs[1][1])}（${esc(T.subs[1][0])}）${runningW ? ' · 写入中' : ' · 已汇合 15:40'}`],
            ['创建', T.created], ['最后检查', T.checked], ['占用空间', '未知（服务未提供）']])}</div>
        <div class="sec"><div class="sec-t">当前状态</div>${kv([
          ['活动写入', runningW ? `<span style="color:var(--run)">${I('play', 'sm')} ${esc(nTitle('n2'))}、${esc(nTitle('n3'))} 写入子${W}</span>` : ph === 'blocked' || ph === 'pushUnknown' ? `<span style="color:var(--stall)">${I('alert', 'sm')} 「回归测试」执行进程未停稳</span>` : '无'],
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
    if (!undelivered() || ['running', 'parallel'].includes(ph) || cleanBlockers().length) return '';
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
    return `<div class="dialog-body"><h2 id="tdDialogT">${stopping ? '正在取消…' : '取消任务？'}</h2><p>「${esc(T.title)}」中执行中的「${esc(nTitle('n2'))}」「${esc(nTitle('n3'))}」会停在安全点；已完成的步骤和记录保留。</p>
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
  function openCleanup(back) { dlg(cleanupHTML(), true); openLayer($('#tdDialog'), back || '#cleanBtn'); }

  /* ---------- 状态切换（同页、保留画布视角） ---------- */
  function goState(id, toast) {
    const v = cv.view();
    while (layers.some((l) => l.el.id === 'tdDialog')) closeLayer($('#tdDialog'));
    S = id; QP.set('state', id);
    history.replaceState(null, '', location.pathname + '?' + QP.toString());
    TD.init('task.html'); const sel = $('#tdStateSel'); if (sel) sel.value = id;
    load(); renderAll(); cv.restore(v);
    if (cfg.open === 'delivery') openDelivery(); else if (!cfg.open) closeSide();
    if (cfg.drawer) { $('#wsDrawer').innerHTML = drawerHTML(); if (!layers.some((l) => l.el.id === 'wsDrawer')) openLayer($('#wsDrawer'), '#side [data-a="ws"]'); else $('#wsDrawer [data-a="drawer-close"]').focus(); }
    else ($('#side:not(.hidden) .tab[aria-selected="true"]') || $('#cv')).focus();
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
  function renderAll() { bar(); situ(); renderCanvas(); if (panel === 'delivery') openDelivery(); else if (panel === 'node' && cv.selected) openNode(cv.selected); }

  /* ---------- 事件 ---------- */
  document.addEventListener('click', (e) => {
    const a = e.target.closest('[data-a]'); if (!a) return;
    const act = a.dataset.a;
    if (a.getAttribute('aria-disabled') === 'true') { e.preventDefault(); return; }
    switch (act) {
      case 'tasks': e.preventDefault(); SC.go('main/pages/tasks.html'); break;
      case 'ws': openLayer($('#wsDrawer'), a); $('#wsDrawer').innerHTML = drawerHTML(); setTimeout(() => $('#wsDrawer [data-a="drawer-close"]').focus(), 60); break;
      case 'drawer-close': closeLayer($('#wsDrawer')); break;
      case 'dlg-close': closeLayer($('#tdDialog')); break;
      case 'more': DS.menu(a, [{ label: '工作区详情', icon: 'folder', run() { openLayer($('#wsDrawer'), '#moreBtn'); $('#wsDrawer').innerHTML = drawerHTML(); } }, { label: '审计记录', icon: 'clock', run: openAudit }, '-',
        ...(['running', 'parallel'].includes(ph) ? [{ label: '取消任务…', icon: 'stop', danger: true, run() { dlg(cancelHTML()); openLayer($('#tdDialog'), '#moreBtn'); } }] : [])]); break;
      case 'auto': DS.toast('自动节点推进的开关沿用原设计（原型未展开）', 'info'); break;
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
  document.addEventListener('change', (e) => {
    if (e.target.id === 'ackU') { const b = $('#cleanDo'); if (!b) return; if (e.target.checked) { b.removeAttribute('aria-disabled'); $('#cleanWhy').textContent = '已确认知情'; } else { b.setAttribute('aria-disabled', 'true'); $('#cleanWhy').textContent = '需要先勾选知情确认'; } }
  });

  /* ---------- 挂载 ---------- */
  DS.mount({ header: '', proto: false });
  $('.header').remove();
  TD.mountProto();
  if (cfg.bg) {
    const tl = $('.nav [data-proto-nav="任务列表"]'); if (tl) tl.insertAdjacentHTML('beforeend', '<span class="count num td-count" aria-label="1 个任务等待交付">1</span>');
    const ib = $('.nav [data-proto-nav="待处理中心"] .count'); if (ib) { ib.textContent = '3'; ib.setAttribute('aria-label', '3 项待处理，含 1 个等待交付的任务'); }
  }
  bar(); situ(); overlays();
  if (cfg.open === 'delivery') openDelivery();
  else if (cfg.open && cfg.open.startsWith('node:')) { const id = cfg.open.slice(5); quiet = true; cv.select(id); quiet = false; openNode(id); }
  decorate();
  requestAnimationFrame(() => requestAnimationFrame(() => {
    cv.fit(false);
    if (cfg.open) focusView(cfg.open === 'delivery' ? 'end' : cfg.open.slice(5));
    if(/^n[1-5]$/.test(QP.get('selectedNode')||'')){const id=QP.get('selectedNode');quiet=true;cv.select(id);quiet=false;openNode(id,'overview');try{const v=JSON.parse(QP.get('canvasView'));if(v&&['tx','ty','k'].every(k=>Number.isFinite(v[k])))cv.restore(v);}catch(e){}}
    if (cfg.drawer) { $('#wsDrawer').innerHTML = drawerHTML(); openLayer($('#wsDrawer'), '#side [data-a="ws"]'); if (ph === 'cleanPartial') { const c = $('#wsClean'), body = $('#wsDrawer .drawer-body'); body.scrollTop = c.offsetTop - body.offsetTop - 12; } }
    if (cfg.dialog === 'cleanup') { openCleanup('#cleanBtn'); }
    if (cfg.dialog === 'cancel') { dlg(cancelHTML()); openLayer($('#tdDialog'), '#moreBtn'); }
  }));
  // 自检用：读取画布视角与选中（只读）
  window.__tdTask = { view: () => cv.view(), sel: () => cv.selected, panel: () => panel, layers: () => layers.map((l) => l.el.id) };
})();
