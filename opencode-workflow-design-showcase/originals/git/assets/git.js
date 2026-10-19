/* opencode-workflow · Git 仓库页 · 隔离原型
   - 只读内存里的样例数据（fixtures.js）；不发任何网络请求、不访问桌面桥、不写浏览器存储。
   - 状态由 ?state=<id>&theme=<skin> 选择；所有“写操作”（审查 / 修复 / 提交 / 推送 / 合并）都是内存里的定时器模拟。
   - ?stream=paused（或控制条“模拟 · 暂停”）冻结所有模拟进度，便于截图。 */
(function () {
  'use strict';
  const F = window.GIT_FX, STATES = window.GIT_STATES;
  const I = DS.icon, esc = DS.esc, $ = DS.$, $$ = DS.$$;

  /* ---------- 0. 额外图标（运行时补充，不改 shell 副本的图标表） ---------- */
  Object.assign(DS.ICONS, {
    expand: 'M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7',
    collapse: 'M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7',
    commit: 'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM3 12h5.5M15.5 12H21',
    merge: 'M6 3v18M6 9a9 9 0 0 0 9 9h3M18 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
    pr: 'M6 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 9v12M18 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 15V8a3 3 0 0 0-3-3h-4M13 2.5 10.5 5 13 7.5',
    chevUp: 'M6 15l6-6 6 6',
    unfold: 'M12 3v6M9 6l3-3 3 3M12 21v-6M9 18l3 3 3-3M4 12h16',
    rows: 'M4 5h16v14H4zM4 12h16',
    cols: 'M4 5h16v14H4zM12 5v14',
    wrap: 'M4 6h16M4 12h13a3 3 0 0 1 0 6h-4M15 16l-2 2 2 2M4 18h5',
    tag: 'M3 12V4h8l10 10-8 8zM7.5 8.5h.01',
    cloud: 'M7 18a4.5 4.5 0 0 1-.6-8.96A6 6 0 0 1 18 8.5a4.5 4.5 0 0 1-.5 9.5z',
    user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21c.8-4 4-6 8-6s7.2 2 8 6',
    bug: 'M8 9h8v7a4 4 0 0 1-8 0zM9.5 9V7a2.5 2.5 0 0 1 5 0v2M4 13h4M16 13h4M5 8l3 2M19 8l-3 2M5 19l3-2M19 19l-3-2',
    fork: 'M6 3v4a4 4 0 0 0 4 4h4a4 4 0 0 1 4 4v6M18 3v4M6 21v-6',
  });
  const SEV = F.SEV, DIMS = F.DIMS, DIMN = Object.fromEntries(DIMS);
  const SEVORDER = { blocker: 0, major: 1, minor: 2, hint: 3 };

  /* ---------- 1. 地址参数与全局状态 ---------- */
  const P = new URLSearchParams(location.search);
  const CFG = STATES.find((s) => s.id === P.get('state')) || STATES[0];
  const ALL = F.COMMITS.concat(F.OLDER);
  const byShaMap = Object.fromEntries(ALL.map((c) => [c.sha, c]));
  const commitOf = (sha) => byShaMap[sha];
  const M = {
    view: CFG.view || 'wb', gitlab: CFG.gitlab || 'ok', project: CFG.project || 'order',
    left: CFG.left || 'commits', mr: CFG.mr || null,
    commit: CFG.commit || 'e4f5a6b', tab: CFG.tab || 'files', file: CFG.file || null,
    diff: CFG.diff || 'unified', ws: false, full: !!CFG.full, head: CFG.head || 'open', parent: CFG.parent || 1,
    filter: { branch: 'all', author: 'all', q: '', range: 'all' },
    dirty: CFG.dirty != null ? CFG.dirty : (F.PROJECTS.find((p) => p.id === (CFG.project || 'order')) || {}).dirty || 0, testCmd: true,
    older: false, listState: CFG.listErr ? 'err' : 'idle', listFails: 0,
    diffErr: !!CFG.diffErr, fetch: CFG.fetchErr ? 'auth' : 'idle', fetchedAt: '10:42',
    detached: !!CFG.detached, shallow: !!CFG.shallow, empty: !!CFG.empty,
    note: CFG.focus || null, loadAll: {}, loading: {}, exp: {},
    paused: P.get('stream') === 'paused' || P.get('sim') === 'paused',
    railOpen: false, listOpen: false, fl: true, busy: null, brTab: 'local',
    mrFilter: 'open', group: 'sev', hist: 2, whyOpen: null, undoAsk: null, bodyOpen: false,
    rset: { scope: 'parent', dims: new Set(DIMS.map((d) => d[0])), role: 'r3', ctx: 'related', parent: 1 },
    rvStart: '10:45',
  };
  /* 审查（只为 a1b2c3d 展开完整剧本；c7d8e9f 为“无问题”） */
  const RV = { status: CFG.rv || 'none', phase: CFG.rvPhase || 0, fd: {}, sel: new Set(), check: null };
  function resetFindings(story) {
    F.FINDINGS.forEach((f) => { RV.fd[f.id] = { st: 'open', why: '' }; });
    RV.sel = new Set(story ? ['F1', 'F2', 'F3', 'F5'] : ['F1', 'F2', 'F3', 'F4']);
    if (story) { RV.fd.F4 = { st: 'ignored', why: '沿用旧模块命名，另开任务统一重命名' }; RV.fd.F1.st = 'accepted'; }
  }
  resetFindings(true);
  /* 修复与后续步骤 */
  const FX = { status: CFG.fx || 'none', phase: CFG.fxPhase || 0, logN: 0, reverted: new Set(), file: 'src/refund/service.ts', outOpen: true };
  if (FX.status === 'running') FX.logN = FX.phase === 0 ? 1 : FX.phase === 1 ? 4 : 8;
  if (['done', 'verify-failed', 'nochange', 'failed'].includes(FX.status)) FX.logN = F.FIX.log.length;
  const fixLog = () => FX.status === 'failed' ? F.FIX.log.slice(0, 5).concat([['10:48:40', 'edit', 'src/refund/service.ts：生成的代码没有通过类型检查（第 3 次）'], ['10:49:12', 'edit', '停止：模型未能完成修复，未运行校验']])
    : FX.status === 'verify-failed' ? F.FIX.log.slice(0, 8).concat([['10:48:23', 'verify', '39 通过 · 2 失败 · 用时 21 秒']]) : F.FIX.log;
  const CM = { st: CFG.cm || 'todo', msg: F.FIX.message + '\n\n' + F.FIX.messageBody, files: new Set(F.FIX.files.map((f) => f.p)), ack: false, andPush: false };
  const PS = { st: CFG.ps || 'todo', fetched: false, branch: F.FIX.branch, check: null };
  const MG = { st: CFG.mg || 'todo', mode: 'mr', target: 'feature/refund', reviewers: new Set(['李娜']), title: F.FIX.message, desc: '', check: null, conflictFetched: true };
  MG.open = CFG.mg === 'choose' || CFG.mg === 'conflict';
  if (CFG.mg === 'choose') MG.st = 'todo';
  if (CFG.mg === 'conflict') MG.mode = 'direct';
  MG.desc = '由 AI 修复 a1b2c3d 第 2 次审查中选择的 4 个问题：\n- [严重] 退款金额用浮点数计算，存在舍入误差\n- [一般] 幂等键没有校验\n- [阻断] 日志输出了完整卡号和持卡人姓名\n- [建议] 退款服务没有单元测试（部分修复）\n\n校验：npm test 41 通过 / 0 失败';
  if (CFG.dialog === 'merge') MG.mode = 'direct';

  /* ---------- 2. 小工具 ---------- */
  const toast = (m, k = 'info') => DS.toast(m, k);
  const proto = (what) => toast(`“${what}”：设计样例，不连接真实 Git / GitLab，未发送任何请求`, 'info');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const queue = [];
  function later(ms, fn) { setTimeout(() => { if (M.paused) queue.push(fn); else fn(); }, ms); }
  function resume() { const q = queue.splice(0); q.forEach((fn, i) => setTimeout(() => (M.paused ? queue.push(fn) : fn()), 250 * (i + 1))); }
  function copy(text, label) {
    const ta = document.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;left:-9999px;top:0';
    document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); } catch (e) {} ta.remove();
    toast('已复制' + label, 'ok');
  }
  const proj = () => F.PROJECTS.find((p) => p.id === M.project);
  const authorN = (who) => (F.AUTHORS[who] || ['', 1])[1];
  const av = (who, cls = '') => `<span class="av a${authorN(who)} ${cls}" aria-hidden="true">${esc(who[0])}</span>`;
  const badge = (t, cls, ic, extra = '') => `<span class="badge ${cls} ${extra}">${ic ? I(ic, 'sm') : ''}${t}</span>`;
  const sevBadge = (s, mini) => { const v = SEV[s]; return `<span class="badge ${v[1]} ${mini ? 'mini-badge' : ''}" style="height:20px;font-size:11.5px">${v[0]}</span>`; };
  const glOK = () => M.gitlab === 'ok';
  const isStory = () => M.commit === 'a1b2c3d';

  /* ---------- 3. 图谱布局 ---------- */
  const PAL = ['var(--accent)', 'var(--role-2)', 'var(--role-4)', 'var(--role-3)', 'var(--role-5)', 'var(--role-6)'];
  function layout(list) {
    let lanes = []; let cn = 0; const rows = []; let max = 1;
    for (const c of list) {
      const top = lanes.slice();
      let idx = top.findIndex((l) => l.sha === c.sha);
      let color;
      const next = top.slice();
      if (idx === -1) { idx = next.length; next.push(null); color = PAL[cn++ % PAL.length]; } else color = top[idx].color;
      const conv = []; top.forEach((l, j) => { if (l.sha === c.sha) conv.push(j); });
      conv.forEach((j) => { next[j] = null; });
      const outs = [];
      c.parents.forEach((p, k) => {
        const ex = next.findIndex((l) => l && l.sha === p);
        if (ex !== -1) { outs.push(next[ex]); return; }
        if (k === 0) { next[idx] = { sha: p, color }; outs.push(next[idx]); } else {
          const slot = next.findIndex((l) => l === null); const o = { sha: p, color: PAL[cn++ % PAL.length] };
          if (slot === -1) next.push(o); else next[slot] = o; outs.push(o);
        }
      });
      const bottom = next.filter(Boolean);
      max = Math.max(max, Math.max(top.length, idx + 1), bottom.length);
      rows.push({ c, top, idx, color, bottom, outs, conv });
      lanes = bottom;
    }
    return { rows, max: Math.min(max, 4) };
  }
  const GX = (j) => 13 + j * 14;
  const curve = (x1, y1, x2, y2) => (x1 === x2 ? `M${x1} ${y1}V${y2}` : `M${x1} ${y1}C${x1} ${(y1 + y2) / 2} ${x2} ${(y1 + y2) / 2} ${x2} ${y2}`);
  function graphSVG(r, W, H) {
    const cy = H / 2, cx = GX(r.idx); let p = '';
    r.top.forEach((l, j) => {
      if (r.conv.includes(j)) p += `<path class="ln" stroke="${l.color}" d="${curve(GX(j), 0, cx, cy)}"/>`;
      else { const b = r.bottom.indexOf(l); if (b !== -1) p += `<path class="ln" stroke="${l.color}" d="${curve(GX(j), 0, GX(b), H)}"/>`; }
    });
    r.outs.forEach((o) => { const b = r.bottom.indexOf(o); if (b !== -1) p += `<path class="ln" stroke="${o.color}" d="${curve(cx, cy, GX(b), H)}"/>`; });
    const merge = r.c.parents.length > 1, head = (r.c.refs || []).includes('HEAD') && !M.detached, dHead = M.detached && r.c.sha === 'c7d8e9f';
    if (merge) p += `<circle class="nd" cx="${cx}" cy="${cy}" r="5.5" fill="var(--bg)" stroke="${r.color}"/><circle cx="${cx}" cy="${cy}" r="2" fill="${r.color}"/>`;
    else if (head || dHead) p += `<circle cx="${cx}" cy="${cy}" r="7.5" fill="none" stroke="${dHead ? 'var(--warn)' : r.color}" stroke-width="1.4" opacity=".55"/><circle cx="${cx}" cy="${cy}" r="4.5" fill="${dHead ? 'var(--warn)' : r.color}"/>`;
    else p += `<circle class="nd" cx="${cx}" cy="${cy}" r="4.2" fill="${r.color}" stroke="var(--bg)"/>`;
    return `<svg class="cl-g" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" aria-hidden="true">${p}</svg>`;
  }
  function passSVG(lanes, W, H) {
    return `<svg class="cl-g" width="${W}" height="${H}" aria-hidden="true">${lanes.map((l, j) => `<path class="ln" stroke="${l.color}" d="M${GX(j)} 0V${H}"/>`).join('')}</svg>`;
  }

  /* ---------- 4. 提交筛选 ---------- */
  function reach(tipSha) {
    const set = new Set(); const st = [tipSha];
    while (st.length) { const s = st.pop(); if (set.has(s)) continue; set.add(s); const c = commitOf(s); if (c) st.push(...c.parents); }
    return set;
  }
  const BR_TIP = { 'feature/refund': 'e4f5a6b', 'origin/feature/refund': 'f0e1d2c', main: '8a9b0c1', 'origin/main': '8a9b0c1', 'feature/coupon': 'd2c3b4a', 'origin/feature/coupon': 'd2c3b4a', 'origin/release/1.8': '6e5d4c3', 'hotfix/export-tz': '6e5d4c3' };
  function visibleCommits() {
    let list = F.COMMITS.slice(); if (M.older) list = list.concat(F.OLDER);
    const f = M.filter;
    if (f.branch !== 'all' && BR_TIP[f.branch]) { const R = reach(BR_TIP[f.branch]); list = list.filter((c) => R.has(c.sha)); }
    if (f.author !== 'all') list = list.filter((c) => c.who === f.author);
    if (f.q.trim()) { const q = f.q.trim().toLowerCase(); list = list.filter((c) => c.msg.toLowerCase().includes(q) || c.full.startsWith(q) || c.sha.startsWith(q)); }
    if (f.range === '3d') list = list.filter((c) => c.day >= '10-11');
    return list;
  }
  const flatFilter = () => M.filter.author !== 'all' || !!M.filter.q.trim() || M.filter.range !== 'all';

  /* ---------- 5. 审查徽标 ---------- */
  function rvBadge(c, mini = true) {
    let k = c.rv; if (!k) return '';
    if (k === 'story') {
      if (MG.st === 'mr' || MG.st === 'exists' || MG.st === 'merged') k = 'fixed';
      else k = { none: '', running: 'running', done: 'issues5', clean: 'clean', failed: 'failed', unknown: 'unknown' }[RV.status];
      if (!k) return '';
    }
    const m = { running: ['审查中', 'st-run', null, true], issues5: ['5 个问题', 'st-fail', 'alert'], issues3: ['3 个问题', 'st-fail', 'alert'], clean: ['无问题', 'st-ok', 'check'], fixed: ['已修复', 'st-done', 'check'], failed: ['审查未完成', 'st-fail', 'x'], unknown: ['结果未知', 'st-unknown', 'help'] }[k];
    return `<span class="badge ${m[1]} ${mini ? 'mini-badge' : ''}">${m[3] ? '<span class="spin" style="width:10px;height:10px"></span>' : m[2] ? I(m[2], 'sm') : ''}${m[0]}</span>`;
  }
  function refChip(r, all, full) {
    if (r === 'HEAD') return M.detached ? '' : `<span class="ref head" title="当前检出">HEAD</span>`;
    if (r.startsWith('tag:')) return `<span class="ref tag" title="标签 ${esc(r.slice(4))}">${I('tag')}${esc(r.slice(4))}</span>`;
    if (r.startsWith('origin/')) { if (all && all.includes(r.slice(7))) return ''; return `<span class="ref remote" title="远端分支 ${esc(r)}">${I('cloud')}${esc(full ? r : r.slice(7))}</span>`; }
    const synced = all && all.includes('origin/' + r);
    return `<span class="ref local" title="本地分支 ${esc(r)}${synced ? '（与 origin/' + esc(r) + ' 一致）' : ''}">${esc(r)}${synced ? I('cloud') : ''}</span>`;
  }
  const refsHTML = (refs, full) => (refs || []).map((r) => refChip(r, refs, full)).join('');

  /* ---------- 6. 页头 ---------- */
  function header() {
    const sample = `<span class="badge outline sample" title="设计样例：所有数据为虚构，不连接真实 Git / GitLab / 模型">${I('info', 'sm')}设计样例 · 不连接真实 Git / GitLab / 模型</span>`;
    if (M.view !== 'wb') {
      const sub = { overview: '', missing: '', notgit: '运营报表脚本', unavail: '支付网关' }[M.view];
      return sub ? `<nav class="crumbs" aria-label="位置"><a href="#" data-a="go-overview">Git 仓库</a><span class="sep">/</span><span class="cur">${sub}</span></nav><span class="spacer"></span>${sample}`
        : `<h1>${I('gitRepo')}Git 仓库</h1><span class="spacer"></span>${sample}`;
    }
    const p = proj();
    const chip = M.empty ? `<span class="chip gh-branch" title="当前分支（还没有提交）">${I('gitRepo', 'sm')}main</span>`
      : M.detached ? `<span class="chip gh-branch warn" title="当前不在任何分支上">${I('alert', 'sm')}分离 HEAD · c7d8e9f</span>`
      : `<button class="chip gh-branch" data-a="filter-branch" data-b="feature/refund" title="当前分支 · 点击在提交列表筛选">${I('gitRepo', 'sm')}${esc(p.branch)}</button>`;
    const stale = M.fetch === 'auth';
    const ab = M.empty || M.detached ? '' : `<span class="gh-ab" title="与 origin/feature/refund 比较${stale ? '（10:42 的数据，之后获取失败）' : ''}">${I('arrowUp', 'sm')}<span class="t">领先</span> <b>${p.ahead}</b><span style="color:var(--faint)">·</span><span class="t">落后</span> <b class="${stale ? 'stale' : ''}">${p.behind}</b></span>`;
    const at = M.empty || M.detached ? '' : `<span class="gh-vsep at"></span><span class="gh-at">${M.fetch === 'running' ? '正在获取…' : stale ? '10:42 的数据 · 获取失败' : '上次获取 ' + M.fetchedAt}</span>`;
    const dirty = M.dirty ? `<span class="gh-vsep"></span><span class="gh-dirty" title="只读提示：你的工作区有 ${M.dirty} 个未提交改动。浏览与 AI 修复不受影响（修复在隔离分支中进行）。">${I('edit', 'sm')}<span class="num">${M.dirty}</span><span class="t">个未提交改动</span></span>` : '';
    const fetchDis = !glOK() || M.empty;
    return `<nav class="crumbs" aria-label="位置"><a href="#" data-a="go-overview">Git 仓库</a><span class="sep">/</span>
      <button class="gh-proj" data-a="proj-menu" aria-haspopup="menu" title="切换项目">${esc(p.name)}${I('chevDown', 'sm')}</button></nav>
      ${chip}${ab}${at}${dirty}
      <span class="spacer"></span>${sample}
      <button class="btn secondary sm gh-fetch" data-a="fetch" ${fetchDis || M.fetch === 'running' ? 'disabled' : ''} title="${!glOK() ? '需要先在 设置 → GitLab 配置连接' : '从 origin 获取远端分支与提交（只读，不合并、不改动工作区）· 上次 ' + M.fetchedAt}">${M.fetch === 'running' ? '<span class="spin"></span>' : I('refresh', 'sm')}<span class="t">获取远端更新</span></button>
      <button class="icon-btn" data-a="gl-open" ${!glOK() || !p.gitlab ? 'disabled style="opacity:.4"' : ''} aria-label="在 GitLab 打开" title="${glOK() && p.gitlab ? '在 GitLab 打开 ' + F.GITLAB.host + '/' + p.gitlab : 'GitLab 未配置'}">${I('external')}</button>`;
  }

  /* ---------- 7. 概览 ---------- */
  function overview() {
    const conn = glOK()
      ? `<section class="card ov-conn"><span class="tile">${I('link')}</span><div class="grow"><div style="font-weight:500;display:flex;align-items:center;gap:8px">GitLab 已连接 ${badge('已验证', 'st-ok mini-badge', 'check')}</div><div class="hint">${F.GITLAB.host} · 账号 <span class="mono">${F.GITLAB.user}</span> · ${F.GITLAB.verified} 验证 · 用于远端分支、合并请求与推送</div></div><button class="btn ghost sm" data-a="settings">${I('settings', 'sm')}管理连接</button></section>`
      : `<section class="card ov-conn none"><span class="tile">${I('link')}</span><div class="grow"><div style="font-weight:500">GitLab 未配置</div><div class="hint" style="color:var(--ink-2)">本地提交、分支和 AI 审查仍可使用；远端分支、合并请求、推送与合并需要先配置 GitLab 连接。</div></div><button class="btn primary sm" data-a="settings">去设置 → GitLab${I('arrowRight', 'sm')}</button></section>`;
    return `<div class="page wide">
      <div class="page-head"><div class="grow"><h2 class="title">Git 仓库</h2><p class="lede">查看已登记项目的提交、分支与合并请求，并用 AI 审查提交。浏览全部只读；写操作只出现在修复流程里，并且逐步确认。</p></div></div>
      ${conn}
      <div class="ov-grid">${F.PROJECTS.map(ovCard).join('')}</div>
      <p class="hint" style="margin-top:18px;display:flex;gap:6px;align-items:center">${I('info', 'sm')}项目页卡片与详情里的 Git 徽标可以点“查看 Git”，会直接进入这里并预选该项目。</p>
    </div>`;
  }
  function ovCard(p, i) {
    const head = (tile, badges) => `<div class="ov-top"><span class="tile lg" ${tile}>${I(p.mode === 'git' ? 'gitRepo' : p.mode === 'direct' ? 'folder' : 'alert', 'lg')}</span>
      <div class="grow"><div class="ov-name">${esc(p.name)}</div><div class="ov-path" title="${esc(p.path)}">${I('pin', 'sm')}<span>${esc(p.path)}</span></div><div class="row wrap" style="gap:6px;margin-top:8px">${badges}</div></div></div>`;
    if (p.mode === 'direct') return `<article class="card ov-card dim in" style="animation-delay:${i * 50}ms">${head('', badge('直接执行目录', 'st-idle', 'folder'))}
      <div class="ov-why"><b>这个项目是直接执行目录，不受 Git 管理。</b>任务直接在目录里改文件，没有分支、提交或合并请求可看。
        <div class="out">${I('arrowRight', 'sm')}<span>如需 Git 能力：先把目录初始化为 Git 仓库，再到 项目 → 运营报表脚本 → Git 与 GitLab 改为“Git 分支模式”。</span></div></div>
      <div class="ov-foot"><button class="btn secondary sm" disabled title="不受 Git 管理">进入</button><button class="btn ghost sm" data-a="proto" data-msg="查看项目配置">${I('settings', 'sm')}查看项目配置</button></div></article>`;
    if (p.mode === 'unavailable') return `<article class="card ov-card dim in" style="animation-delay:${i * 50}ms">${head('style="color:var(--warn)"', badge('Git 分支模式', 'st-accent', 'git') + badge('路径不可用', 'st-fail', 'alert'))}
      <div class="ov-why warn"><b>本机找不到这个目录</b>，读不到任何 Git 信息。为避免误读，这里不显示之前缓存的分支或提交。
        <div class="out">${I('arrowRight', 'sm')}<span>如果项目已搬家：到 项目 页取消管理后按新路径重新登记；如果是磁盘未挂载，挂载后点“重新检查”。</span></div></div>
      <div class="ov-foot"><button class="btn secondary sm" disabled title="路径不可用">进入</button><button class="btn ghost sm" data-a="proto" data-msg="重新检查路径">${I('refresh', 'sm')}重新检查</button></div></article>`;
    if (p.empty) return `<article class="card ov-card in" style="animation-delay:${i * 50}ms">${head('', badge('Git 分支模式', 'st-accent', 'git') + badge('空仓库', 'st-idle'))}
      <div class="ov-facts"><div><div class="k">当前分支</div><div class="v mono">main</div><div class="s">还没有提交</div></div><div><div class="k">未提交改动</div><div class="v" style="color:var(--warn)">${p.dirty} 个文件</div><div class="s">只读提示</div></div><div><div class="k">合并请求</div><div class="v" style="color:var(--muted)">—</div><div class="s">未绑定 GitLab 项目</div></div></div>
      <div class="ov-why">仓库已初始化但还没有任何提交，提交列表和 AI 审查暂时为空。<div class="out">${I('arrowRight', 'sm')}<span>要读取远端分支和合并请求：到 项目 → 客户服务平台 → Git 与 GitLab 绑定 GitLab 项目。</span></div></div>
      <div class="ov-foot"><button class="btn primary sm" data-a="enter" data-p="cs">进入${I('arrowRight', 'sm')}</button><span class="grow"></span></div></article>`;
    const stale = !glOK();
    return `<article class="card hoverable ov-card in" style="animation-delay:${i * 50}ms;cursor:pointer" data-a="enter" data-p="${p.id}" tabindex="0">${head('', badge('Git 分支模式', 'st-accent', 'git') + (p.gitlab ? `<span class="badge outline">${I('link', 'sm')}<span class="mono" style="font-size:11.5px">${p.gitlab}</span></span>` : ''))}
      <div class="ov-facts">
        <div><div class="k">当前分支</div><div class="v"><span class="mono">${esc(p.branch)}</span></div><div class="s">TypeScript · Node 20</div></div>
        <div><div class="k">与远端</div><div class="v num">领先 ${p.ahead} · 落后 ${p.behind}</div><div class="s">${stale ? '上次已知（10:42）' : '上次获取 ' + p.fetched}</div></div>
        <div><div class="k">未提交改动</div><div class="v" style="color:var(--warn)">${I('edit', 'sm')}${p.dirty} 个</div><div class="s">只读提示 · 不影响修复</div></div>
        <div><div class="k">合并请求</div><div class="v">${stale ? '<span style="color:var(--muted)">需要 GitLab</span>' : `<span class="num">${p.mrsOpen}</span> 个打开`}</div><div class="s">${stale ? '配置后可读取' : '!52 待审批 · !49 冲突'}</div></div>
        <div><div class="k">AI 审查</div><div class="v"><span class="num" style="color:var(--warn)">${p.reviewOpen}</span> 个待处理问题</div><div class="s">a1b2c3d · 第 2 次审查</div></div>
        <div><div class="k">提交</div><div class="v num">最近 7 天 14 个</div><div class="s">5 位作者</div></div>
      </div>
      <div class="ov-last">${av(p.last.who)}<span class="m"><span class="sha" style="margin-right:6px">${p.last.sha}</span>${esc(p.last.msg)}</span><span class="hint" style="white-space:nowrap">${p.last.who} · ${p.last.when}</span></div>
      <div class="ov-foot"><button class="btn primary sm" data-a="enter" data-p="${p.id}">进入${I('arrowRight', 'sm')}</button><button class="btn ghost sm" data-a="gl-open" ${stale ? 'disabled' : ''}>${I('external', 'sm')}在 GitLab 打开</button><span class="grow"></span><span class="hint">${I('lock', 'sm')} 浏览只读</span></div></article>`;
  }
  function missing() {
    return `<div class="page"><div class="missing"><span class="tile">${I('unfold', 'lg')}</span>
      <div class="eyebrow" style="color:var(--unknown)">尚未接入 · 不是错误</div><h2 style="margin-top:6px">Git 能力尚未接入</h2>
      <p>Git 仓库页不直接执行 git。它通过应用服务读取仓库，服务再调用内部 MCP（git / gitlab）。这两项能力接入后，这里会列出所有受 Git 管理的项目；在那之前不会读取任何仓库，也不提供审查与修复。</p>
      <div class="flowline"><span>Git 仓库页</span>${I('arrowRight', 'sm')}<span>应用服务（读口 / 命令）</span>${I('arrowRight', 'sm')}<span class="off">内部 MCP · git</span><span class="off">内部 MCP · gitlab</span></div>
      <div class="cap-list">
        <div class="cap-item">${I('help')}<div><div class="t">git MCP · 未接入</div><div class="d">提交、分支、差异、提交 / 推送 / 合并命令</div></div></div>
        <div class="cap-item">${I('help')}<div><div class="t">gitlab MCP · 未接入</div><div class="d">远端分支、合并请求、流水线与审批</div></div></div>
      </div>
      <p class="hint" style="margin-top:16px">已登记 4 个项目，其中 3 个受 Git 管理。项目本身的执行不受影响。</p></div></div>`;
  }
  function notGit(kind) {
    const un = kind === 'unavail';
    return `<div class="page narrow"><div class="card"><div class="empty"><span class="tile" style="${un ? 'color:var(--warn)' : ''}">${I(un ? 'alert' : 'folder', 'lg')}</span>
      <h3>${un ? '支付网关的本机路径不可用' : '运营报表脚本不受 Git 管理'}</h3>
      <p>${un ? '项目登记为 Git 分支模式，但 <span class="mono">/workspace/payment-gateway</span> 在本机找不到，读不到提交、分支或合并请求。为避免误读，不显示之前缓存的数据。' : '这个项目是直接执行目录：任务直接在 <span class="mono">/workspace/ops-report-scripts</span> 里改文件，没有分支、提交或合并请求可看。'}</p>
      <div class="row" style="margin-top:8px;gap:8px"><button class="btn secondary sm" data-a="go-overview">${I('arrowLeft', 'sm')}返回仓库概览</button><button class="btn ghost sm" data-a="proto" data-msg="${un ? '到项目页更新路径' : '查看项目配置'}">${I('settings', 'sm')}${un ? '到项目页更新路径' : '查看项目配置'}</button></div></div></div></div>`;
  }

  /* ---------- 8. 工作台：左栏 ---------- */
  function rail() {
    const seg = `<div class="seg rail-seg" role="tablist" aria-label="左栏内容">${[['commits', '提交'], ['branches', '分支'], ['mrs', '合并请求']].map(([k, l]) => `<button role="tab" aria-selected="${M.left === k}" data-a="left" data-k="${k}" ${M.empty && k !== 'commits' ? 'disabled style="opacity:.45;cursor:not-allowed"' : ''}>${l}</button>`).join('')}</div>`;
    let body = '';
    if (M.empty) {
      body = `<div class="rail-sec"><div class="cap"><span>本地分支</span></div>${brQuick('main', '尚无提交', 'var(--faint)', true)}</div>
        <div class="rail-note">${I('info', 'sm')}<span>仓库还没有提交：筛选、分支表与 AI 审查暂不可用。</span></div>`;
    } else if (M.left === 'commits') {
      const f = M.filter;
      const brs = [['all', '全部分支'], ['feature/refund', 'feature/refund（当前）'], ['main', 'main'], ['feature/coupon', 'feature/coupon'], ['origin/feature/refund', 'origin/feature/refund']];
      body = `<div class="rail-sec rail-f"><div class="cap"><span>筛选</span>${flatFilter() || f.branch !== 'all' ? `<button class="btn ghost sm" style="height:22px;padding:0 6px;font-size:11.5px" data-a="clear-filter">清除</button>` : ''}</div>
        <select class="select" data-in="branch" aria-label="分支">${brs.map(([k, l]) => `<option value="${k}" ${f.branch === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <select class="select" data-in="author" aria-label="作者"><option value="all">全部作者</option>${Object.keys(F.AUTHORS).map((a) => `<option ${f.author === a ? 'selected' : ''}>${a}</option>`).join('')}</select>
        <div class="input-wrap">${I('search', 'sm')}<input class="input" data-in="q" placeholder="提交信息或 SHA" value="${esc(f.q)}" aria-label="搜索提交信息或 SHA"></div>
        <select class="select" data-in="range" aria-label="时间范围"><option value="all" ${f.range === 'all' ? 'selected' : ''}>全部时间</option><option value="3d" ${f.range === '3d' ? 'selected' : ''}>最近 3 天</option></select></div>
        <div class="rail-sec"><div class="cap"><span>本地分支</span></div>
          ${F.BRANCHES.local.slice(0, 3).map((b) => brQuick(b.n, b.cur ? '当前' : b.lock ? I('lock', 'sm') : '', b.n === 'main' ? 'var(--role-3)' : b.n === 'feature/coupon' ? 'var(--role-2)' : 'var(--accent)')).join('')}</div>
        <div class="rail-sec"><div class="cap"><span>远端 · origin</span>${!glOK() ? '<span>不可用</span>' : ''}</div>
          ${['origin/feature/refund', 'origin/main'].map((n) => brQuick(n, n === 'origin/feature/refund' ? '↓1' : I('lock', 'sm'), n === 'origin/main' ? 'var(--role-3)' : 'var(--role-4)', !glOK())).join('')}</div>`;
    } else if (M.left === 'branches') {
      body = `<div class="rail-sec"><div class="cap"><span>分支</span></div>
        ${[['local', '本地分支', F.BRANCHES.local.length], ['remote', '远端分支 · origin', glOK() ? F.BRANCHES.remote.length : '—']].map(([k, l, n]) => `<button class="rail-stat" aria-pressed="${M.brTab === k}" data-a="br-tab" data-k="${k}">${l}<span class="num">${n}</span></button>`).join('')}</div>
        <div class="rail-note">${I('lock', 'sm')}<span>带锁的是保护分支：只能通过合并请求合并。</span></div>
        <div class="rail-note">${I('eye', 'sm')}<span>分支表只读：点一个分支 = 在提交列表里筛选它，不会检出、新建或删除分支。</span></div>`;
    } else {
      const c = (st) => F.MRS.filter((m) => st === 'all' || (st === 'open' ? ['打开', '冲突'].includes(m.st[0]) : st === 'merged' ? m.st[0] === '已合并' : m.st[0] === '已关闭')).length;
      body = glOK() ? `<div class="rail-sec"><div class="cap"><span>合并请求 · GitLab</span></div>
        ${[['open', '打开中'], ['merged', '已合并'], ['closed', '已关闭'], ['all', '全部']].map(([k, l]) => `<button class="rail-stat" aria-pressed="${M.mrFilter === k}" data-a="mr-filter" data-k="${k}">${l}<span class="num">${c(k)}</span></button>`).join('')}</div>
        <div class="rail-note">${I('eye', 'sm')}<span>只读：评论、审批、合并都在 GitLab 中完成。</span></div>`
        : `<div class="rail-note" style="color:var(--warn)">${I('alert', 'sm')}<span>GitLab 未配置，读不到合并请求。</span></div>`;
    }
    const foot = glOK() && !proj().gitlab ? `<div class="rail-foot">${I('link', 'sm')}<div><div class="t">GitLab · 已连接</div><div class="d">这个项目未绑定 GitLab 项目 · <a href="#" data-a="proto" data-msg="到项目配置绑定" style="color:var(--accent)">去绑定</a></div></div></div>`
      : glOK() ? `<div class="rail-foot">${I('link', 'sm')}<div><div class="t">GitLab · 已连接</div><div class="d">${F.GITLAB.user} · ${F.GITLAB.project}</div></div></div>`
      : `<div class="rail-foot" style="border-color:var(--warn-line);background:var(--warn-fill)">${I('alert', 'sm')}<div><div class="t">GitLab 未配置</div><div class="d">本地浏览可用 · <a href="#" data-a="settings" style="color:var(--accent)">去设置</a></div></div></div>`;
    const mini = `<div class="rail-mini">${[['commits', 'commit', '提交'], ['branches', 'gitRepo', '分支'], ['mrs', 'pr', '合并请求']].map(([k, ic, l]) => `<button class="icon-btn" aria-pressed="${M.left === k}" data-a="left" data-k="${k}" title="${l}" aria-label="${l}">${I(ic)}</button>`).join('')}<hr><button class="icon-btn" data-a="rail-toggle" title="展开筛选" aria-label="展开筛选">${I('filter')}</button><button class="icon-btn only-narrow" data-a="list-toggle" title="提交列表" aria-label="提交列表">${I('list')}</button></div>`;
    return `<aside class="wb-rail" aria-label="筛选与分支">${mini}<div class="rail-full">${seg}${body}${foot}</div></aside>`;
  }
  function brQuick(n, m, color, dis) {
    return `<button class="rail-br" aria-pressed="${M.filter.branch === n}" ${dis ? 'aria-disabled="true" title="GitLab 未配置"' : `data-a="filter-branch" data-b="${n}"`}><span class="lane" style="background:${color}"></span><span class="n">${esc(n)}</span><span class="m">${m}</span></button>`;
  }

  /* ---------- 9. 工作台：提交列表 ---------- */
  function commitList() {
    if (M.empty) return '';
    const list = visibleCommits(); const flat = flatFilter();
    const L = layout(list); const W = 12 + L.max * 14;
    let html = '', day = null, prevBottom = [];
    L.rows.forEach((r) => {
      const c = r.c;
      if (c.day !== day) { day = c.day; html += `<div class="cl-day">${flat ? '' : passSVG(prevBottom, W, 30)}<span>${F.DAYS[c.day] || c.day}</span></div>`; }
      const refs = refsHTML(c.refs);
      html += `<button class="cl-row ${c.parents.length > 1 ? 'merge' : ''}" role="option" aria-selected="${M.left === 'commits' && M.commit === c.sha}" data-a="commit" data-sha="${c.sha}" title="${esc(c.msg)}">
        ${flat ? '' : graphSVG(r, W, 58)}
        <span class="cl-main"><span class="cl-l1">${refs}<span class="cl-msg">${esc(c.msg)}</span>${rvBadge(c)}</span>
        <span class="cl-l2">${av(c.who)}<span class="who">${c.who}</span><span>·</span><span>${c.rel}</span><span class="shs">${c.sha}</span></span></span></button>`;
      prevBottom = r.bottom;
    });
    if (!list.length) html = `<div class="empty" style="padding:40px 16px"><span class="tile">${I('search', 'lg')}</span><h3>没有匹配的提交</h3><p>换个关键词或清除筛选。</p><button class="btn secondary sm" data-a="clear-filter">清除筛选</button></div>`;
    let tail = '';
    if (list.length) {
      if (M.shallow) tail = `<div class="cl-end">${I('layers', 'sm')}只有最近 50 个提交（浅克隆）· 更早的历史不在本机</div>`;
      else if (M.listState === 'err') tail = `<div class="cl-err">${I('alert', 'sm')}<div class="grow"><b style="font-weight:500;color:var(--ink)">加载更早的提交失败</b><br>Git 服务没有响应（读取超时）。已加载的 ${list.length} 个提交不受影响。</div><button class="btn secondary sm" data-a="more" style="flex:none">${I('refresh', 'sm')}重试</button></div>`;
      else if (M.listState === 'loading') tail = `<div class="cl-more"><button class="btn secondary sm" disabled><span class="spin"></span>正在加载…</button></div>`;
      else if (!M.older) tail = `<div class="cl-more"><button class="btn secondary sm" data-a="more">${I('chevDown', 'sm')}加载更早的提交</button><span class="hint">每次 20 个 · 按游标继续</span></div>`;
      else tail = `<div class="cl-end">${I('check', 'sm')}已到最早的提交 · c9d8e7f 初始化 CI 流水线</div>`;
    }
    const bName = M.filter.branch === 'all' ? '全部分支' : M.filter.branch;
    const notes = (M.detached ? `<div class="cl-note">${I('alert', 'sm')}<div><b style="font-weight:500">当前不在任何分支上</b>（分离 HEAD · c7d8e9f）。浏览与审查照常；修复会基于你选择的分支进行。</div></div>` : '')
      + (flat ? `<div class="cl-note info">${I('info', 'sm')}<div>筛选作者 / 关键词 / 时间时不画图谱，提交按时间平铺。</div></div>` : '');
    return `<section class="wb-list" aria-label="提交列表"><div class="cl-head"><div class="grow" style="min-width:0"><div class="t">提交</div><div class="s">${esc(bName)} · ${list.length} 个${M.older ? '' : ' · 还有更早'}</div></div>
      <button class="icon-btn" data-a="proto" data-msg="复制提交列表的筛选链接" title="复制筛选链接" aria-label="复制筛选链接">${I('link', 'sm')}</button></div>${notes}
      <div class="cl-scroll ${flat ? 'nograph' : ''}" id="clScroll" data-sk="cl" role="listbox" aria-label="提交">${html}${tail}</div></section>`;
  }

  /* ---------- 10. 差异解析与渲染 ---------- */
  const langOf = (p) => (/\.(ts|js|tsx)$/.test(p) ? 'ts' : /\.sql$/.test(p) ? 'sql' : /\.md$/.test(p) ? 'md' : /\.sh$/.test(p) ? 'sh' : 'txt');
  const PARSED = new Map();
  function parse(file) {
    if (PARSED.has(file)) return PARSED.get(file);
    const out = []; let o = 1, n = 1; const lang = langOf(file.p); const pool = F.FILLER[lang] || ['…']; let fi = 0;
    if (file.src) for (const raw of file.src.split('\n').slice(1)) {
      const m = raw.match(/^~(\d+)/);
      if (m) { for (let i = 0; i < +m[1]; i++) out.push({ t: ' ', o: o++, n: n++, x: pool[fi++ % pool.length], f: 1 }); continue; }
      let ws = false, l = raw; if (l[0] === '!') { ws = true; l = l.slice(1); }
      const t = l[0] || ' ', x = l.slice(1);
      if (t === '-') out.push({ t, o: o++, x, ws }); else if (t === '+') out.push({ t, n: n++, x, ws }); else out.push({ t: ' ', o: o++, n: n++, x });
    }
    file.add = out.filter((l) => l.t === '+').length; file.del = out.filter((l) => l.t === '-').length;
    PARSED.set(file, out); return out;
  }
  function withWs(lines, ignore) {
    if (!ignore) return lines;
    const out = []; let i = 0;
    while (i < lines.length) {
      if (lines[i].t === '-' && lines[i].ws) {
        const d = []; while (i < lines.length && lines[i].t === '-') d.push(lines[i++]);
        const a = []; while (i < lines.length && lines[i].t === '+') a.push(lines[i++]);
        const pairs = Math.min(d.length, a.length);
        for (let k = 0; k < pairs; k++) { if (d[k].ws && a[k].ws) out.push({ t: ' ', o: d[k].o, n: a[k].n, x: a[k].x, wsx: 1 }); else { out.push(d[k]); out.push(a[k]); } }
        d.slice(pairs).forEach((x) => out.push(x)); a.slice(pairs).forEach((x) => out.push(x));
      } else out.push(lines[i++]);
    }
    return out;
  }
  /* 语法着色：先切成 [类名, 文本] 片段，再按行内高亮区间切分 */
  const KW = { ts: /^(import|from|export|class|const|let|var|function|async|await|return|if|else|throw|new|private|public|readonly|protected|interface|enum|type|extends|implements|for|of|in|try|catch|true|false|null|undefined|this|typeof|default|number|string|boolean|any|Promise)\b/,
    sql: /^(create|table|insert|into|values|primary|key|not|null|default|index|unique|on|begin|commit|varchar|bigint|timestamp|true|false|now)\b/i, sh: /^(if|then|fi|set|echo|exit|export|for|do|done)\b/ };
  function tokens(x, lang) {
    if (lang === 'md') {
      if (/^#{1,6}\s/.test(x)) return [['tk-h', x]];
      if (/^```/.test(x)) return [['tk-c', x]];
      const segs = []; x.split(/(`[^`]+`)/).forEach((s) => { if (s) segs.push([/^`/.test(s) ? 'tk-s' : (/^\s*\|/.test(x) && /^[\s|-]+$/.test(s) ? 'tk-c' : ''), s]); }); return segs;
    }
    if (lang === 'txt') return [['', x]];
    const segs = []; let i = 0; let plain = '';
    const flush = () => { if (plain) { segs.push(['', plain]); plain = ''; } };
    const cm = lang === 'sql' ? '--' : lang === 'sh' ? '#' : '//';
    while (i < x.length) {
      const r = x.slice(i);
      if (r.startsWith(cm)) { flush(); segs.push(['tk-c', r]); break; }
      if (lang === 'ts' && r.startsWith('/*')) { const e = r.indexOf('*/'); const s = e === -1 ? r : r.slice(0, e + 2); flush(); segs.push(['tk-c', s]); i += s.length; continue; }
      const q = r[0];
      if (q === "'" || q === '"' || q === '`') { let j = 1; while (j < r.length && r[j] !== q) { if (r[j] === '\\') j++; j++; } const s = r.slice(0, j + 1); flush(); segs.push(['tk-s', s]); i += s.length; continue; }
      const prev = x[i - 1] || ' ';
      if (/[A-Za-z_$@0-9]/.test(prev)) { plain += r[0]; i++; continue; }
      let m;
      if (lang === 'ts' && (m = r.match(/^@\w+/))) { flush(); segs.push(['tk-d', m[0]]); i += m[0].length; continue; }
      if ((m = r.match(/^\d+(\.\d+)?\b/))) { flush(); segs.push(['tk-n', m[0]]); i += m[0].length; continue; }
      if (KW[lang] && (m = r.match(KW[lang]))) { flush(); segs.push(['tk-k', m[0]]); i += m[0].length; continue; }
      if (lang === 'ts' && (m = r.match(/^[A-Z][A-Za-z0-9_]*/))) { flush(); segs.push(['tk-t', m[0]]); i += m[0].length; continue; }
      if ((m = r.match(/^[A-Za-z_$][\w$]*/))) { plain += m[0]; i += m[0].length; continue; }
      plain += r[0]; i++;
    }
    flush(); return segs;
  }
  function hlHTML(x, lang, rng) {
    const segs = tokens(x, lang); let pos = 0, h = '';
    for (const [cls, s] of segs) {
      const a = pos, b = pos + s.length; pos = b;
      if (!rng || b <= rng[0] || a >= rng[1]) { h += cls ? `<span class="${cls}">${esc(s)}</span>` : esc(s); continue; }
      const parts = [[a, Math.max(a, rng[0])], [Math.max(a, rng[0]), Math.min(b, rng[1])], [Math.min(b, rng[1]), b]];
      parts.forEach(([p, q], k) => { if (q <= p) return; const t = esc(s.slice(p - a, q - a)); const inner = cls ? `<span class="${cls}">${t}</span>` : t; h += k === 1 ? `<span class="hl">${inner}</span>` : inner; });
    }
    return h;
  }
  function intraPairs(lines) {
    const R = new Map(); let i = 0;
    while (i < lines.length) {
      if (lines[i].t !== '-') { i++; continue; }
      const d = []; while (i < lines.length && lines[i].t === '-') d.push(lines[i++]);
      const a = []; while (i < lines.length && lines[i].t === '+') a.push(lines[i++]);
      for (let k = 0; k < Math.min(d.length, a.length); k++) {
        const x = d[k].x, y = a[k].x; let p = 0; while (p < x.length && p < y.length && x[p] === y[p]) p++;
        let s = 0; while (s < x.length - p && s < y.length - p && x[x.length - 1 - s] === y[y.length - 1 - s]) s++;
        const changed = Math.max(x.length - p - s, y.length - p - s);
        if (p + s > 4 && changed < Math.max(x.length, y.length) * 0.7) { R.set(d[k], [p, x.length - s]); R.set(a[k], [p, y.length - s]); }
      }
    }
    return R;
  }
  const FN_RE = /^\s*(export\s+)?(default\s+)?(async\s+)?(function|class|interface|describe|it\(|create table|##?\s|(private|public|protected)?\s*(async\s+)?[A-Za-z_]\w*\s*\([^)]*\)\s*(:\s*[^{]+)?\{)/i;
  function fnCtx(lines, idx) { for (let i = idx - 1; i >= 0; i--) { const t = lines[i].x; if (FN_RE.test(t) && !/^\s*(if|for|while|return)\b/.test(t)) return t.trim().slice(0, 60); } return ''; }
  /* 把全部行切成：可见块 + 折叠区 */
  function blocks(lines, key) {
    const CTX = 3, vis = lines.map((l) => l.t !== ' ');
    if (!vis.some(Boolean)) return [{ gap: 0, from: 0, to: lines.length }];
    lines.forEach((l, i) => { if (l.t !== ' ') for (let k = Math.max(0, i - CTX); k <= Math.min(lines.length - 1, i + CTX); k++) vis[k] = true; });
    const segs = []; let i = 0, gi = 0;
    while (i < lines.length) {
      const v = vis[i]; let j = i; while (j < lines.length && vis[j] === v) j++;
      if (v) segs.push({ vis: true, from: i, to: j }); else segs.push({ vis: false, from: i, to: j, gi: gi++ });
      i = j;
    }
    // 应用展开：折叠区从靠近下一块的一侧（文件末尾的折叠区从上侧）逐次露出 20 行
    const out = [];
    segs.forEach((s, k) => {
      if (s.vis) { out.push({ vis: true, from: s.from, to: s.to }); return; }
      const size = s.to - s.from, r = Math.min(size, M.exp[key + ':' + s.gi] || 0), last = k === segs.length - 1;
      if (size <= 4 || r >= size) { out.push({ vis: true, from: s.from, to: s.to }); return; }
      if (last) { if (r) out.push({ vis: true, from: s.from, to: s.from + r }); out.push({ vis: false, from: s.from + r, to: s.to, gi: s.gi, last: true }); }
      else { out.push({ vis: false, from: s.from, to: s.to - r, gi: s.gi }); if (r) out.push({ vis: true, from: s.to - r, to: s.to }); }
    });
    // 合并相邻可见段
    const merged = []; out.forEach((s) => { const p = merged[merged.length - 1]; if (p && p.vis && s.vis) p.to = s.to; else merged.push(Object.assign({}, s)); });
    return merged;
  }
  function findingsFor(path, fix) {
    if (fix || !isStory() || RV.status !== 'done' || M.hist !== 2) return [];
    return F.FINDINGS.filter((f) => f.file === path && (M.parent === 1));
  }
  function diffView(file, opt = {}) {
    const key = (opt.fix ? 'fix:' : M.commit + ':') + file.p;
    const ren = file.st === 'R' ? `<span class="old">${esc(file.old)}</span> ${I('arrowRight', 'sm')} ` : '';
    const fds = findingsFor(file.p, opt.fix);
    const fdIdx = fds.findIndex((f) => f.id === M.note);
    const nav = fds.length ? `<span class="fnav" title="这个文件里的审查问题">${I('alert', 'sm')}问题 ${fdIdx === -1 ? '–' : fdIdx + 1} / ${fds.length}<button class="icon-btn" data-a="fnav" data-d="-1" aria-label="上一个问题">${I('chevUp', 'sm')}</button><button class="icon-btn" data-a="fnav" data-d="1" aria-label="下一个问题">${I('chevDown', 'sm')}</button></span>` : '';
    const fi = opt.files ? opt.files.findIndex((f) => f.p === file.p) : -1;
    const fsw = opt.files && !M.full ? `<button class="icon-btn" data-a="fl-toggle" title="${M.fl ? '收起文件列表' : '显示文件列表'}" aria-label="${M.fl ? '收起文件列表' : '显示文件列表'}" aria-pressed="${M.fl}" style="width:28px;height:28px;margin-left:-6px">${I('panel', 'sm')}</button>` : '';
    const fnv = opt.files && !M.fl && !M.full ? `<span class="fnav" style="padding-left:8px">${fi + 1} / ${opt.files.length}<button class="icon-btn" data-a="file-step" data-d="-1" aria-label="上一个文件">${I('chevUp', 'sm')}</button><button class="icon-btn" data-a="file-step" data-d="1" aria-label="下一个文件">${I('chevDown', 'sm')}</button></span>` : '';
    const bar = `<div class="dv-bar">${fsw}${fnv}<div class="dv-path">${file.st === 'R' ? '' : `<span class="fst ${file.st}">${file.st}</span>`}<span class="p" title="${esc(file.old ? file.old + ' → ' + file.p : file.p)}"><bdi>${ren}${esc(file.p)}</bdi></span>
        ${file.binary || file.mode ? '' : `<span class="add-n" style="font-size:12px">+${(parse(file), file.add).toLocaleString()}</span><span class="del-n" style="font-size:12px">−${file.del ?? 0}</span>`}
        ${file.st === 'R' ? `<span class="badge mini-badge st-wait">重命名 · 相似度 ${file.sim}%</span>` : ''}</div>
      <div class="dv-tools">${nav}
        <div class="seg" role="group" aria-label="差异视图"><button aria-pressed="${M.diff === 'unified'}" data-a="diff-mode" data-k="unified">${I('rows', 'sm')}统一</button><button aria-pressed="${M.diff === 'split'}" data-a="diff-mode" data-k="split">${I('cols', 'sm')}并排</button></div>
        <label class="chk" title="忽略只有空白不同的改动"><input type="checkbox" data-a="ws" ${M.ws ? 'checked' : ''}>忽略空白</label>
        ${opt.fix ? '' : `<button class="icon-btn" data-a="full" title="${M.full ? '退出全宽（Esc）' : '展开到全宽（隐藏提交列表）'}" aria-label="${M.full ? '退出全宽' : '展开到全宽'}">${I(M.full ? 'collapse' : 'expand', 'sm')}</button>`}</div></div>`;
    let body;
    if (opt.reverted) body = `<div class="dv-msg"><span class="tile">${I('undo', 'lg')}</span><h3>这个文件的修复改动已撤销</h3><p>只在修复分支内撤销：文件恢复为 e4f5a6b 的内容，不会被提交。你的工作区与 feature/refund 不受影响。</p><button class="btn secondary sm" data-a="unrevert" data-p="${esc(file.p)}">${I('redo', 'sm')}恢复这个文件的改动</button></div>`;
    else if (M.diffErr && !opt.fix && file.p === 'src/order/repository.ts') body = `<div class="dv-err"><div class="banner danger">${I('alert')}<div><b>读取这个文件的差异失败</b><br>Git 服务返回“对象读取超时”。其他文件不受影响，已加载的提交详情保留。</div><div class="actions"><button class="btn secondary sm" data-a="diff-retry">${M.loading.diff ? '<span class="spin"></span>读取中' : I('refresh', 'sm') + '重试'}</button></div></div></div>`;
    else if (file.binary) body = `<div class="dv-msg"><span class="tile">${I('file', 'lg')}</span><h3>二进制文件，不显示差异</h3><p>${file.binary.before ? `${file.binary.before} → ${file.binary.after}` : `新增 · ${file.binary.after}`}。原型不预览图片内容。</p></div>`;
    else if (file.mode) body = `<div class="dv-msg"><span class="tile">${I('lock', 'lg')}</span><h3>权限变更 · 内容未改动</h3><p><span class="mono">${file.mode[0]}</span> → <span class="mono">${file.mode[1]}</span>（加上了可执行权限）</p></div>`;
    else body = diffTable(file, key, fds);
    return `<div class="dv">${bar}<div class="dv-scroll" id="dvScroll" data-sk="dv:${esc(key)}">${body}</div></div>`;
  }
  function diffTable(file, key, fds) {
    const lines = withWs(parse(file), M.ws); const lang = langOf(file.p);
    const hl = intraPairs(lines);
    const split = M.diff === 'split';
    const LIMIT = 400; const trunc = file.large && !M.loadAll[key];
    const fdStart = {}; const fdCover = {}; const fdEnd = {};
    fds.forEach((f) => { (fdStart[f.from] = fdStart[f.from] || []).push(f); for (let n = f.from; n <= f.to; n++) { const cur = fdCover[n]; if (!cur || SEVORDER[f.sev] < SEVORDER[cur.sev]) fdCover[n] = f; } (fdEnd[f.to] = fdEnd[f.to] || []).push(f); });
    const segs = blocks(lines, key); let rows = 0, html = '';
    const noteFor = (n) => (fdEnd[n] || []).filter((f) => f.id === M.note).map(noteHTML).join('');
    const mk = (l) => { if (l.n == null) return ''; const s = fdStart[l.n]; return s ? s.slice(0, 2).map((f) => `<button class="fdot sevc-${f.sev}" data-a="note" data-f="${f.id}" title="${SEV[f.sev][0]} · ${esc(f.title)}" aria-label="审查问题：${esc(f.title)}"></button>`).join('') : ''; };
    const frc = (l) => (l.n != null && fdCover[l.n] ? ` fr sevc-${fdCover[l.n].sev}` : '');
    const code = (l) => hlHTML(l.x, lang, hl.get(l));
    let pending = null;
    const expBtns = (g) => { const size = g.to - g.from; return `<span class="exp"><button data-a="exp" data-k="${esc(key)}:${g.gi}" data-n="20">${I(g.last ? 'chevDown' : 'chevUp', 'sm')}展开 20 行</button><span class="m">·</span><button data-a="exp" data-k="${esc(key)}:${g.gi}" data-n="9999">全部 ${size} 行</button><span class="m">${g.last ? '文件末尾未改动' : '未改动'}</span></span>`; };
    const gut = (g) => g ? `<span class="g"><button data-a="exp" data-k="${esc(key)}:${g.gi}" data-n="20" title="展开 20 行" aria-label="展开 20 行">${I(g.last ? 'chevDown' : 'chevUp', 'sm')}</button><button data-a="exp" data-k="${esc(key)}:${g.gi}" data-n="9999" title="展开全部 ${g.to - g.from} 行" aria-label="展开全部">${I('unfold', 'sm')}</button></span>` : '<span class="g"></span>';
    segs.forEach((s, si) => {
      if (trunc && rows >= LIMIT) return;
      if (!s.vis) {
        if (s.last) html += `<div class="dh">${gut(s)}<span class="dh-in">${expBtns(s)}</span></div>`; else pending = s;
        return;
      }
      const blk = lines.slice(s.from, s.to); const os = blk.find((l) => l.o != null), ns = blk.find((l) => l.n != null);
      const oc = blk.filter((l) => l.o != null).length, nc = blk.filter((l) => l.n != null).length;
      html += `<div class="dh">${gut(pending)}<span class="dh-in">${pending ? expBtns(pending) + '<span class="vsep"></span>' : ''}<span class="txt"><b>@@ -${os ? os.o : 0},${oc} +${ns ? ns.n : 0},${nc} @@</b>  ${esc(fnCtx(lines, s.from))}</span></span></div>`;
      pending = null;
      if (!split) {
        for (let i = s.from; i < s.to; i++) {
          if (trunc && rows >= LIMIT) break;
          const l = lines[i]; rows++;
          const cls = l.t === '+' ? 'add' : l.t === '-' ? 'del' : 'ctx';
          html += `<div class="dl ${cls}${frc(l)}" ${l.n != null ? `data-n="${l.n}"` : ''}><span class="ln o">${l.o ?? ''}</span><span class="ln n">${l.n ?? ''}</span><span class="mk">${mk(l)}</span><span class="cx"><span class="sg">${l.t === ' ' ? ' ' : l.t === '-' ? '−' : '+'}</span>${code(l)}</span></div>`;
          if (l.n != null) html += noteFor(l.n);
        }
      } else {
        let i = s.from;
        while (i < s.to) {
          if (trunc && rows >= LIMIT) break;
          const l = lines[i];
          if (l.t === ' ') { rows++; html += `<div class="dl ctx${frc(l)}" data-n="${l.n}"><span class="ln">${l.o}</span><span class="mk"></span><span class="cx l">${code(l)}</span><span class="ln r">${l.n}</span><span class="mk">${mk(l)}</span><span class="cx">${code(l)}</span></div>${noteFor(l.n)}`; i++; continue; }
          const d = []; while (i < s.to && lines[i].t === '-') d.push(lines[i++]);
          const a = []; while (i < s.to && lines[i].t === '+') a.push(lines[i++]);
          for (let k = 0; k < Math.max(d.length, a.length); k++) {
            rows++; const L = d[k], R = a[k];
            html += `<div class="dl${R ? frc(R) : ''}" ${R ? `data-n="${R.n}"` : ''}>${L ? `<span class="ln s-del">${L.o}</span><span class="mk s-del"></span><span class="cx l s-del dl-del">${hlHTML(L.x, lang, hl.get(L))}</span>` : '<span class="ln s-emp"></span><span class="mk s-emp"></span><span class="cx l s-emp"></span>'}
              ${R ? `<span class="ln r s-add">${R.n}</span><span class="mk s-add">${mk(R)}</span><span class="cx s-add">${hlHTML(R.x, lang, hl.get(R))}</span>` : '<span class="ln r s-emp"></span><span class="mk s-emp"></span><span class="cx s-emp"></span>'}</div>`;
            if (R) html += noteFor(R.n);
          }
        }
      }
    });
    if (trunc) {
      const total = lines.length;
      html += `<div class="dv-trunc">${I('alert', 'sm')}<span class="grow">改动过大，已显示前 ${LIMIT} 行（共 ${total.toLocaleString()} 行）。其余内容没有读取。</span><button class="btn secondary sm" data-a="load-all" data-k="${esc(key)}">${M.loading[key] ? '<span class="spin"></span>读取中…' : I('download', 'sm') + '加载全部'}</button></div>`;
    }
    const topNote = trunc ? `<div class="dv-trunc top">${I('alert', 'sm')}<span class="grow">改动过大（${lines.length.toLocaleString()} 行），已显示前 ${LIMIT} 行。</span><button class="btn ghost sm" data-a="load-all" data-k="${esc(key)}">${M.loading[key] ? '<span class="spin"></span>读取中…' : '加载全部'}</button></div>` : '';
    return `<div class="dv-t ${split ? 'split' : ''}">${topNote}${html}</div>`;
  }
  function noteHTML(f) {
    const st = RV.fd[f.id].st;
    return `<div class="dn" data-note="${f.id}"><div class="fd hit" style="max-width:640px;background:var(--panel)"><div class="fd-ck"><span class="dot sevc-${f.sev}" style="color:var(--fc);width:9px;height:9px;margin:5px 0 0 4px;display:block"></span></div><div style="min-width:0">
      <div class="fd-h">${sevBadge(f.sev)}<span class="chip" style="height:20px;font-size:11.5px">${DIMN[f.dim]}</span><span class="grow"></span><button class="icon-btn" style="width:24px;height:24px" data-a="note" data-f="${f.id}" aria-label="收起问题">${I('x', 'sm')}</button></div>
      <div class="fd-title">${esc(f.title)}</div><div class="fd-desc">${esc(f.desc)}</div>
      <div class="fd-act">${triHTML(f)}<span class="grow"></span><button class="btn ghost sm" data-a="to-review" data-f="${f.id}">在问题列表中查看${I('arrowRight', 'sm')}</button></div>
      ${st !== 'open' && st !== 'accepted' && RV.fd[f.id].why ? `<div class="fd-st" style="margin-top:6px">${I('info', 'sm')}原因：${esc(RV.fd[f.id].why)}</div>` : ''}</div></div></div>`;
  }

  /* ---------- 11. 文件列表 ---------- */
  function fileList(files, opt = {}) {
    const groups = {}; files.forEach((f) => { const d = f.p.includes('/') ? f.p.slice(0, f.p.lastIndexOf('/')) : '.'; (groups[d] = groups[d] || []).push(f); });
    const cur = opt.cur;
    const tot = files.reduce((a, f) => { if (f.src) parse(f); return [a[0] + (f.add || 0), a[1] + (f.del || 0)]; }, [0, 0]);
    return `<nav class="fl" aria-label="改动文件"><div class="fl-h"><span>${files.length} 个文件</span><span class="mono"><span class="add-n">+${tot[0].toLocaleString()}</span> <span class="del-n">−${tot[1]}</span></span></div>
      ${Object.keys(groups).sort().map((d) => `<div class="fl-dir" title="${esc(d)}">${I('folder', 'sm')}${esc(d)}/</div>${groups[d].map((f) => {
        const fds = opt.fix ? [] : findingsFor(f.p, false); const rv = opt.reverted && opt.reverted.has(f.p);
        const name = f.p.slice(f.p.lastIndexOf('/') + 1);
        return `<button class="fl-i ${rv ? 'reverted' : ''}" aria-selected="${f.p === cur}" data-a="${opt.fix ? 'fx-file' : 'file'}" data-p="${esc(f.p)}" title="${esc(f.old ? f.old + ' → ' + f.p : f.p)}">
          <span class="fst ${f.st}">${f.st}</span><span class="nm">${esc(name)}${f.old ? `<small>← ${esc(f.old)}</small>` : ''}</span>
          ${fds.length ? `<span class="fpill sevc-${fds.slice().sort((x, y) => SEVORDER[x.sev] - SEVORDER[y.sev])[0].sev}" title="${fds.length} 个审查问题">${fds.length}</span>` : ''}
          <span class="ct">${f.binary ? '<span class="muted">二进制</span>' : f.mode ? '<span class="muted">权限</span>' : `<span class="add-n">+${f.add.toLocaleString()}</span><span class="del-n">−${f.del}</span>`}</span></button>`;
      }).join('')}`).join('')}</nav>`;
  }

  /* ---------- 12. 提交详情 ---------- */
  function filesOf(sha) { return sha === '5b6c7d8' ? F.FILES['5b6c7d8@' + M.parent] : (F.FILES[sha] || []); }
  function stats(files) { let a = 0, d = 0; files.forEach((f) => { if (f.src) { parse(f); a += f.add; d += f.del; } }); return [a, d]; }
  function statBar(a, d) { const t = a + d || 1; const na = Math.round((a / t) * 5), nd = Math.min(5 - na, Math.round((d / t) * 5)); return `<span class="statbar" aria-hidden="true">${'<i class="a"></i>'.repeat(na)}${'<i class="d"></i>'.repeat(nd)}${'<i></i>'.repeat(5 - na - nd)}</span>`; }
  function branchesContaining(sha) {
    const out = []; Object.entries(BR_TIP).forEach(([b, tip]) => { if (b === 'hotfix/export-tz' || b === 'origin/release/1.8') return; if (reach(tip).has(sha)) out.push(b); });
    return out;
  }
  function detailHead(c) {
    const files = filesOf(c.sha); const [a, d] = stats(files);
    const merge = c.parents.length > 1;
    const body = F.BODIES[c.sha];
    const brs = branchesContaining(c.sha);
    const rvBtn = isStory() && RV.status === 'none' ? `<button class="btn primary sm" data-a="review-open">${I('sparkle', 'sm')}AI 审查此提交</button>`
      : isStory() && ['done', 'failed', 'clean'].includes(RV.status) ? `<button class="btn secondary sm" data-a="review-open" ${M.busy ? 'disabled' : ''}>${I('sparkle', 'sm')}重新审查</button>`
      : isStory() ? '' : c.rv === 'clean' ? `<button class="btn secondary sm" data-a="review-open-other">${I('sparkle', 'sm')}重新审查</button>` : `<button class="btn primary sm" data-a="review-open-other">${I('sparkle', 'sm')}AI 审查此提交</button>`;
    const more = `<button class="icon-btn" data-a="cd-more" aria-label="更多操作" title="更多">${I('more')}</button>`;
    const tog = `<button class="icon-btn" data-a="head-toggle" aria-label="${M.head === 'open' ? '收起提交信息' : '展开提交信息'}" title="${M.head === 'open' ? '收起' : '展开作者、SHA、父提交'}">${I(M.head === 'open' ? 'chevUp' : 'chevDown')}</button>`;
    const narrowList = `<button class="btn ghost sm only-narrow" data-a="list-toggle">${I('list', 'sm')}提交列表</button>`;
    const parentLinks = c.parents.map((p, i) => `<button class="sha" data-a="commit" data-sha="${p}" title="${esc((commitOf(p) || {}).msg || '')}">${p}</button>${merge ? `<span class="hint">父 ${i + 1}${i === 0 ? ' · feature/refund' : ' · main'}</span>` : ''}`).join(' ');
    if (M.head !== 'open') {
      return `<div class="cd-head" style="padding:12px 16px 12px 20px"><div class="cd-t"><div class="grow" style="min-width:0"><div class="row" style="gap:8px;min-width:0"><div class="cd-title ellipsis" style="font-size:15.5px">${esc(c.msg)}</div>${rvBadge(c, false)}</div>
        <div class="cd-meta">${av(c.who)}<span>${c.who}</span><span class="hint">${c.rel === '1 小时前' ? '今天 09:12' : c.rel}</span><span class="sep"></span><button class="sha" data-a="copy-sha" title="复制完整 SHA ${c.full}">${c.sha} ${I('copy', 'sm')}</button><span class="sep"></span><span class="mono" style="font-size:12px">${files.length} 个文件 <span class="add-n">+${a.toLocaleString()}</span> <span class="del-n">−${d.toLocaleString()}</span></span>${merge ? `<span class="sep"></span><span class="hint">对比父 ${M.parent}</span>` : ''}</div></div>
        <div class="row" style="gap:6px;flex:none">${narrowList}${rvBtn}${more}${tog}</div></div></div>`;
    }
    return `<div class="cd-head"><div class="cd-t"><div class="grow" style="min-width:0"><div class="row wrap" style="gap:8px"><div class="cd-title">${esc(c.msg)}</div>${rvBadge(c, false)}</div>
        ${body ? `<div class="cd-body">${esc(body)}</div>` : ''}</div><div class="row" style="gap:6px;flex:none;align-self:flex-start">${narrowList}${rvBtn}${more}${tog}</div></div>
      <dl class="cd-kv">
        <dt>作者</dt><dd>${av(c.who)}<span style="color:var(--ink)">${c.who}</span><span class="hint">&lt;${F.AUTHORS[c.who][0]}&gt;</span><span class="hint">· 2026-${c.day} ${c.time} +08:00</span></dd>
        <dt>提交者</dt><dd><span class="hint">与作者相同</span></dd>
        <dt>SHA</dt><dd><span class="full-sha">${c.full}</span><button class="icon-btn" data-a="copy-sha" aria-label="复制完整 SHA" title="复制完整 SHA">${I('copy', 'sm')}</button></dd>
        <dt>${merge ? '父提交（2）' : '父提交'}</dt><dd class="cd-parents">${parentLinks}</dd>
        <dt>所在分支</dt><dd>${brs.map((b) => refChip(b, null, true)).join('')}</dd>
        <dt>改动</dt><dd><span>${files.length} 个文件</span><span class="add-n">+${a.toLocaleString()}</span><span class="del-n">−${d}</span>${statBar(a, d)}${merge ? `<span class="hint">· 对比父 ${M.parent}</span>` : ''}</dd>
      </dl>
      ${merge ? `<div class="par-pick" role="radiogroup" aria-label="对比的父提交">${[1, 2].map((k) => { const p = c.parents[k - 1]; const fs = F.FILES['5b6c7d8@' + k]; const s = stats(fs); return `<button class="rcard" role="radio" aria-checked="${M.parent === k}" data-a="parent" data-k="${k}"><span class="rd"></span><span style="min-width:0"><span style="font-size:13px;font-weight:500;display:block">对比父 ${k} · <span class="mono">${p}</span></span><span class="hint" style="display:block">${k === 1 ? '看合并带进来的 main 改动' : '看 feature/refund 相对 main 的改动'} · ${fs.length} 个文件 +${s[0].toLocaleString()} −${s[1]}</span></span></button>`; }).join('')}</div>` : ''}
    </div>`;
  }
  function stepper() {
    if (!isStory() || RV.status === 'none') return '';
    const S = [];
    const rvs = { running: ['run', '进行中'], done: ['done', `5 个问题 · 选 ${RV.sel.size}`], failed: ['fail', '未完成'], unknown: ['unk', '结果未知'], stopped: ['fail', '已停止'] }[RV.status] || ['done', ''];
    S.push(['审查', ...rvs]);
    const fxs = { none: [RV.status === 'done' ? 'cur' : 'todo', RV.status === 'done' ? '选择问题后开始' : '未开始'], running: ['run', '进行中'], done: ['done', '3 已修复 · 1 部分'], 'verify-failed': ['fail', '校验未通过'], nochange: ['off', '无需修改'], failed: ['fail', '未完成'], stopped: ['fail', '已停止'] }[FX.status];
    S.push(['修复', ...fxs]);
    const fxOk = FX.status === 'done' || FX.status === 'verify-failed';
    const cms = !fxOk ? ['todo', '未开始'] : { todo: ['cur', '待提交'], running: ['run', '提交中'], done: ['done', F.FIX.newSha], hook: ['fail', 'hook 拒绝'] }[CM.st];
    S.push(['提交', ...cms]);
    const pss = CM.st !== 'done' ? ['todo', '未开始'] : { todo: ['cur', '待推送'], running: ['run', '推送中'], done: ['done', 'origin'], rejected: ['fail', '被拒绝'], auth: ['fail', '认证失败'], unknown: ['unk', '结果未知'] }[PS.st] || ['todo', ''];
    S.push(['推送', ...pss]);
    const mgs = PS.st !== 'done' ? ['todo', '未开始'] : { todo: ['cur', '选择方式'], running: ['run', '进行中'], mr: ['done', `MR ${F.FIX.mr} 已创建`], exists: ['done', `已有 ${F.FIX.mr}`], merged: ['done', '已合并'], conflict: ['fail', '有冲突'], unknown: ['unk', '结果未知'] }[MG.st] || ['todo', ''];
    S.push(['合并', ...mgs]);
    return `<div class="stp" aria-label="修复流程">${S.map(([l, st, s], i) => `${i ? `<span class="stp-bar ${st === 'done' || S[i - 1][1] === 'done' && st !== 'todo' && st !== 'off' ? 'done' : ''}"></span>` : ''}<span class="stp-i ${st}"><span class="stp-c">${st === 'done' ? I('check') : st === 'fail' ? I('x') : st === 'unk' ? '?' : st === 'run' ? '<span class="spin" style="width:11px;height:11px;border-width:1.5px"></span>' : i + 1}</span><span class="stp-l">${l}<span class="stp-s">${s}</span></span></span>`).join('')}</div>`;
  }
  function tabs(c) {
    const story = isStory();
    const files = filesOf(c.sha);
    const rvN = story ? (RV.status === 'done' ? 5 : RV.status === 'running' ? '…' : '') : c.rv === 'clean' ? 0 : c.rv === 'issues3' ? 3 : '';
    const fxDis = !story;
    const T = [['files', '改动文件', files.length], ['review', 'AI 审查', rvN], ['fix', '修复', story && FX.status !== 'none' ? '' : '']];
    return `<div class="tabs cd-tabs" role="tablist">${T.map(([k, l, n]) => `<button class="tab" role="tab" aria-selected="${M.tab === k}" data-a="tab" data-k="${k}" ${k === 'fix' && fxDis ? 'aria-disabled="true" title="原型只为 a1b2c3d 展开修复流程"' : ''}>${l}${n !== '' && n != null ? `<span class="n">${n}</span>` : ''}${k === 'fix' && story && ['running'].includes(FX.status) ? ' <span class="spin" style="width:10px;height:10px;display:inline-block;vertical-align:-1px"></span>' : ''}</button>`).join('')}
      <span class="grow"></span>${M.tab === 'files' && !M.full ? `<span class="kbd-hint">${I('lock', 'sm')}浏览只读</span>` : ''}</div>`;
  }
  function commitDetail() {
    const c = commitOf(M.commit);
    const fullBar = M.full ? `<div class="full-bar">${I('expand', 'sm')}<span>全宽阅读 · 提交列表已收起</span><span class="sha">${c.sha}</span><span class="ellipsis" style="min-width:0">${esc(c.msg)}</span><span class="grow"></span><span class="kbd">Esc</span><button class="btn ghost sm" data-a="full">${I('collapse', 'sm')}退出全宽</button></div>` : '';
    let pane = '';
    if (M.tab === 'files') {
      const files = filesOf(c.sha);
      if (!M.file || !files.find((f) => f.p === M.file)) M.file = files[0] && files[0].p;
      const file = files.find((f) => f.p === M.file);
      pane = `<div class="cd-pane">${M.fl || M.full ? fileList(files, { cur: M.file }) : ''}${file ? diffView(file, { files }) : ''}</div>`;
    } else if (M.tab === 'review') pane = `<div class="cd-pane" style="flex-direction:column">${reviewPane(c)}</div>`;
    else pane = `<div class="cd-pane" style="flex-direction:column">${fixPane()}</div>`;
    return `<section class="wb-detail" aria-label="提交详情">${fullBar}${detailHead(c)}${stepper()}${tabs(c)}${pane}</section>`;
  }

  /* ---------- 13. 审查页签 ---------- */
  function reviewObj() { return `<span class="sha">a1b2c3d</span><span>对比父提交 5b6c7d8</span><span>·</span><span>代码评审员 修订 3</span><span>·</span><span>改动 + 相关文件</span><span>·</span><span>${RV.status === 'running' ? M.rvStart + ' 开始' : '10:46 完成'}</span>`; }
  function histBtn() { return `<button class="rv-hist" data-a="hist-menu" aria-haspopup="menu">${I('clock', 'sm')}${M.hist === 2 ? '第 2 次审查 · 今天 10:46' : '第 1 次审查 · 今天 09:40'}${I('chevDown', 'sm')}</button>`; }
  function reviewPane(c) {
    if (!isStory()) {
      if (c.rv === 'clean') return `<div class="cd-scroll"><div class="cd-pad">${cleanCard('c7d8e9f', '今天 10:02')}</div></div>`;
      if (c.rv) return `<div class="cd-scroll"><div class="cd-pad"><div class="banner info">${I('info')}<div><b>${c.rv === 'issues3' ? '第 1 次审查 · 昨天 16:30 · 3 个问题（一般 2 · 建议 1）' : '第 1 次审查 · 昨天 17:40 · 2 个问题，均已在后续提交中修复'}</b><br>原型只为 a1b2c3d 展开完整的审查结果与修复流程。</div></div></div></div>`;
      return `<div class="cd-scroll"><div class="empty"><span class="tile">${I('sparkle', 'lg')}</span><h3>这个提交还没有审查</h3><p>AI 审查只读取代码，不会修改文件或分支。原型只为 a1b2c3d 展开完整的审查流程。</p><button class="btn secondary sm" data-a="review-open-other">${I('sparkle', 'sm')}AI 审查此提交</button></div></div>`;
    }
    if (RV.status === 'none') return `<div class="cd-scroll"><div class="empty"><span class="tile">${I('sparkle', 'lg')}</span><h3>这个提交还没有审查</h3><p>审查会读取 a1b2c3d 的 8 个文件改动（可选读取相关文件），按缺陷、安全、性能、质量、规范、测试 6 个维度给出问题与建议修改。只读，不改动任何文件或分支。</p><button class="btn primary" data-a="review-open" style="margin-top:6px">${I('sparkle', 'sm')}AI 审查此提交</button></div></div>`;
    if (RV.status === 'running') {
      const ph = [['读取改动', '8 个文件 · 251 行改动 · 2 个相关文件'], ['分析', '按 6 个维度逐文件分析'], ['汇总', '合并重复问题、排序、生成建议修改']];
      return `<div class="cd-scroll"><div class="cd-pad"><div class="rv-bar">${badge('审查进行中', 'st-run', null)}<span class="hint">只读 · 不会修改文件或分支</span></div>
        <section class="card rv-run"><div class="row" style="gap:8px"><div class="grow section-title">正在审查 a1b2c3d</div>
          <button class="btn ghost sm" data-a="task-link">${I('external', 'sm')}在任务中查看详情</button><button class="btn secondary sm" data-a="stop-review">${I('stop', 'sm')}停止审查</button></div>
          <div class="rv-obj" style="box-shadow:none;padding:0;margin:6px 0 18px">${reviewObj()}</div>
          ${ph.map((p, i) => { const st = i < RV.phase ? 'done' : i === RV.phase ? 'on' : 'todo'; return `<div class="ph ${st}"><div class="rail"><i>${st === 'done' ? I('check') : st === 'on' ? '<span class="spin" style="width:11px;height:11px;border-width:1.5px;color:var(--run)"></span>' : ''}</i>${i < 2 ? '<b></b>' : ''}</div><div class="c"><div class="t">${p[0]}${st === 'on' ? `<span class="hint" style="font-weight:400">${i === 1 ? '已用 38 秒' : '进行中'}</span>` : ''}</div><div class="d">${p[1]}${st === 'done' && i === 0 ? ' · 完成于 10:45:09' : ''}</div></div></div>`; }).join('')}
          <div class="lockline" style="margin-top:4px">${I('info', 'sm')}<span>审查以只读模板任务「AI 代码审查」运行（任务 T-2087），执行过程可在任务中查看，复用执行详情页。这里不显示估算的百分比。</span></div></section></div></div>`;
    }
    if (RV.status === 'failed') return `<div class="cd-scroll"><div class="cd-pad"><div class="rv-bar">${histBtn()}<span class="grow"></span></div>
      <div class="banner warn">${I('alert')}<div><b>第 3 次审查没有完成</b><br>停在“分析”阶段：模型服务超时（10:51:40，等待 120 秒无响应）。已读取的改动保留在任务记录里；没有生成任何问题，也没有修改任何文件。</div></div>
      <section class="card rv-run" style="margin-top:14px">${[['读取改动', '完成 · 8 个文件', 'done'], ['分析', '模型服务超时', 'bad'], ['汇总', '未开始', 'todo']].map((p, i) => `<div class="ph ${p[2]}"><div class="rail"><i>${p[2] === 'done' ? I('check') : p[2] === 'bad' ? I('x') : ''}</i>${i < 2 ? '<b></b>' : ''}</div><div class="c"><div class="t">${p[0]}</div><div class="d">${p[1]}</div></div></div>`).join('')}
        <div class="row" style="gap:8px;margin-top:4px"><button class="btn primary sm" data-a="review-open">${I('refresh', 'sm')}重新审查</button><button class="btn ghost sm" data-a="task-link">${I('external', 'sm')}在任务中查看详情</button><span class="grow"></span><span class="hint">重新审查会新开一次，保留上次设置</span></div></section>
      <p class="hint" style="margin-top:12px">历史审查记录不受影响：可以在上方切到第 2 次审查（今天 10:46 · 5 个问题）。</p></div></div>`;
    if (RV.status === 'unknown') {
      const ck = RV.check;
      return `<div class="cd-scroll"><div class="cd-pad"><div class="banner unknown">${I('help')}<div><b>不确定审查是否已经开始</b><br>10:45:02 发出“开始审查”（原操作 op-review-41d8）后没有收到回执。可能已经在运行，也可能没有收到。保持原记录，<b>不会重新发送</b>。${ck === 'loading' ? '' : ck ? `<div style="margin-top:6px">${ck}</div>` : ''}</div>
        <div class="actions"><button class="btn secondary sm" data-a="check-review" ${ck === 'loading' ? 'disabled' : ''}>${ck === 'loading' ? '<span class="spin"></span>核对中' : I('search', 'sm') + '核对原操作'}</button></div></div>
        <div class="lockline" style="margin-top:12px">${I('lock', 'sm')}<span>核对完成前，“重新审查”与“AI 修复”不可用，避免同一提交被重复审查。</span></div></div></div>`;
    }
    if (M.hist === 1) return `<div class="cd-scroll"><div class="cd-pad"><div class="rv-bar">${histBtn()}<span class="grow"></span></div>
      <div class="banner">${I('clock')}<div><b>这是历史审查记录（只读）</b><br>第 1 次审查 · 今天 09:40 · 代码评审员 修订 2 · 4 个问题。修复只能基于最新一次审查。</div><div class="actions"><button class="btn secondary sm" data-a="hist" data-k="2">回到第 2 次</button></div></div>
      <div style="margin-top:14px">${F.FINDINGS.filter((f) => f.id !== 'F3').map((f) => fdCard(f, true)).join('')}</div></div></div>`;
    // 结果
    const open = F.FINDINGS.filter((f) => !['ignored', 'false'].includes(RV.fd[f.id].st));
    const cnt = (s) => F.FINDINGS.filter((f) => f.sev === s).length;
    const dcnt = (d) => F.FINDINGS.filter((f) => f.dim === d).length;
    const concl = `<section class="card concl"><div class="row" style="gap:8px;margin-bottom:8px"><span class="eyebrow">结论</span><span class="grow"></span>${badge('需要处理后再合并', 'st-fail mini-badge', 'alert')}</div>
      <p class="say">退款接口的金额计算和日志存在合并前必须处理的问题：金额用浮点数计算、日志输出了完整卡号；幂等键没有查重，单元测试缺失。</p>
      <div class="sevs">${Object.keys(SEV).map((s) => `<div class="sevc-${s} ${cnt(s) ? '' : 'zero'}"><div class="v"><i></i>${cnt(s)}</div><div class="k">${SEV[s][0]}</div></div>`).join('')}</div>
      <div class="dims">${DIMS.map(([k, l]) => `<span class="chip ${dcnt(k) ? '' : 'zero'}">${l} <b>${dcnt(k) || '0'}</b></span>`).join('')}</div>
      <div class="rv-obj">${I('target', 'sm')}<span>审查对象</span>${reviewObj()}</div></section>`;
    void 0;
    const sorted = M.group === 'sev' ? F.FINDINGS.slice().sort((a, b) => SEVORDER[a.sev] - SEVORDER[b.sev]) : F.FINDINGS.slice().sort((a, b) => a.file.localeCompare(b.file) || a.from - b.from);
    let list = ''; let g = null;
    sorted.forEach((f) => { const k = M.group === 'sev' ? SEV[f.sev][0] : f.file; if (k !== g) { g = k; list += `<div class="fd-grp">${M.group === 'sev' ? `<span class="dot sevc-${f.sev}" style="color:var(--fc)"></span>${k}` : `${I('file', 'sm')}<span class="mono">${esc(k)}</span>`}</div>`; } list += fdCard(f); });
    const selN = RV.sel.size; const fixLocked = FX.status !== 'none';
    return `<div class="cd-scroll" id="rvScroll" data-sk="rv"><div class="cd-pad">
      <div class="rv-bar">${histBtn()}<span class="grow"></span><button class="btn ghost sm" data-a="task-link">${I('external', 'sm')}在任务中查看</button></div>
      ${concl}
      <div class="fd-tools"><span class="t">问题</span><span class="hint">${F.FINDINGS.length} 个 · ${open.length} 个待处理</span><span class="grow"></span>
        <div class="seg" role="group" aria-label="分组"><button aria-pressed="${M.group === 'sev'}" data-a="group" data-k="sev">按严重度</button><button aria-pressed="${M.group === 'file'}" data-a="group" data-k="file">按文件</button></div></div>
      ${list}</div></div>
      <div class="fixbar">${fixLocked ? `<span class="grow hint">${I('lock', 'sm')} 已经开始一次修复（${FX.status === 'running' ? '进行中' : '已完成'}）· 查看“修复”页签</span><button class="btn secondary" data-a="tab" data-k="fix">查看修复${I('arrowRight', 'sm')}</button>`
        : `<span class="n">已选 ${selN} 个问题</span><span class="hint grow">${selN ? '在隔离的修复分支中进行，不改动你的工作区' : '勾选要修复的问题'}</span><button class="btn primary" data-a="fix-open" ${selN ? '' : 'disabled'}>${I('wand', 'sm')}AI 修复所选问题</button>`}</div>`;
  }
  function triHTML(f, ro) {
    const st = RV.fd[f.id].st;
    return `<div class="tri" role="group" aria-label="处理状态">${[['accepted', '接受', 'check'], ['ignored', '忽略', 'eye'], ['false', '误报', 'x']].map(([k, l, ic]) => `<button aria-pressed="${st === k}" class="${k === 'accepted' ? 'ok' : ''}" data-a="fd-st" data-f="${f.id}" data-k="${k}" ${ro ? 'disabled' : ''}>${l}</button>`).join('')}</div>`;
  }
  function fdCard(f, ro) {
    const s = RV.fd[f.id]; const dis = ['ignored', 'false'].includes(s.st); const sel = RV.sel.has(f.id) && !dis;
    const locked = ro || FX.status !== 'none';
    const sug = `<div class="fd-sug"><div class="h">${I('wand', 'sm')}建议修改</div><pre>${f.fix.map((l) => `<div class="${l[0] === '+' ? 'a' : l[0] === '-' ? 'd' : 'c'}">${esc(l)}</div>`).join('')}</pre></div>`;
    const why = M.whyOpen && M.whyOpen.f === f.id ? `<div class="fd-why"><input class="input grow" id="whyIn" placeholder="${M.whyOpen.k === 'ignored' ? '忽略原因（可选）' : '为什么是误报（可选）'}" aria-label="原因"><button class="btn secondary sm" data-a="why-ok">确定</button><button class="btn ghost sm" data-a="why-cancel">取消</button></div>` : '';
    const stLine = dis ? `<span class="fd-st">${I(s.st === 'ignored' ? 'eye' : 'x', 'sm')}${s.st === 'ignored' ? '已忽略' : '已标为误报'}${s.why ? ' · ' + esc(s.why) : ''}</span>` : s.st === 'accepted' ? `<span class="fd-st" style="color:var(--ok)">${I('check', 'sm')}已接受</span>` : '';
    const fxr = FX.status === 'done' || FX.status === 'verify-failed' ? F.FIX.result[f.id] : null;
    return `<article class="fd ${sel ? 'sel' : ''} ${dis ? 'muted' : ''}" id="fd-${f.id}">
      <div class="fd-ck"><input type="checkbox" data-a="fd-sel" data-f="${f.id}" ${sel ? 'checked' : ''} ${dis || locked ? 'disabled' : ''} aria-label="选入修复：${esc(f.title)}" title="${dis ? '已忽略 / 误报的问题不能选入修复' : locked ? '修复已开始，选择已锁定' : '选入修复'}"></div>
      <div style="min-width:0"><div class="fd-h">${sevBadge(f.sev)}<span class="chip" style="height:20px;font-size:11.5px">${DIMN[f.dim]}</span>${fxr ? badge(fxr[0] === 'done' ? '已修复' : '部分修复', fxr[0] === 'done' ? 'st-ok mini-badge' : 'st-fail mini-badge', fxr[0] === 'done' ? 'check' : 'alert') : ''}<span class="grow"></span><span class="hint mono">${f.id}</span></div>
        <div class="fd-title">${esc(f.title)}</div>
        <button class="fd-loc" data-a="loc" data-f="${f.id}" title="在改动文件中定位">${I('target', 'sm')}${esc(f.file)}:${f.from}${f.to !== f.from ? '–' + f.to : ''}</button>
        <div class="fd-desc">${esc(f.desc)}</div>${sug}
        <div class="fd-act">${triHTML(f, ro)}${stLine}</div>${why}</div></article>`;
  }
  function cleanCard(sha, when) {
    return `<div class="rv-bar"><button class="rv-hist">${I('clock', 'sm')}第 1 次审查 · ${when}${I('chevDown', 'sm')}</button><span class="grow"></span></div>
      <section class="card concl"><div class="row" style="gap:10px"><span class="tile" style="color:var(--ok);background:var(--ok-fill)">${I('check', 'lg')}</span><div><div class="section-title">没有发现需要处理的问题</div><div class="hint">6 个维度都检查过了。可以照常合并；审查不代替人工评审。</div></div></div>
        <div class="clean-list">${DIMS.map(([, l]) => `<div>${I('check', 'sm')}${l}</div>`).join('')}</div>
        <div class="rv-obj">${I('target', 'sm')}<span>审查对象</span><span class="sha">${sha}</span><span>对比父提交 a1b2c3d · 代码评审员 修订 3 · ${when} 完成</span></div></section>`;
  }

  /* ---------- 14. 修复页签 ---------- */
  function fixPane() {
    if (FX.status === 'none') return `<div class="cd-scroll"><div class="empty"><span class="tile">${I('wand', 'lg')}</span><h3>还没有修复</h3><p>${RV.status === 'done' ? '在“AI 审查”里勾选要修复的问题，再点“AI 修复所选问题”。修复在隔离的修复分支中进行，不改动你当前的工作区。' : '先完成 AI 审查，再选择要修复的问题。'}</p>${RV.status === 'done' ? `<button class="btn secondary sm" data-a="tab" data-k="review">${I('arrowLeft', 'sm')}去选择问题</button>` : ''}</div></div>`;
    const ph = ['准备修复分支', '修改代码', '校验', '完成'];
    const cur = FX.status === 'running' ? FX.phase : FX.status === 'failed' ? 1 : 4;
    const phCls = (i) => (FX.status === 'failed' && i === 1 ? 'bad' : FX.status === 'verify-failed' && i === 2 ? 'bad' : i < cur ? 'done' : i === cur && FX.status === 'running' ? 'on' : FX.status === 'nochange' && i >= 2 ? '' : '');
    const phases = `<div class="fx-phases">${ph.map((p, i) => `${i ? `<span class="fx-phbar ${phCls(i - 1) === 'done' && phCls(i) !== '' ? 'done' : ''}"></span>` : ''}<span class="fx-ph ${phCls(i)}"><i>${phCls(i) === 'done' ? I('check') : phCls(i) === 'bad' ? I('x') : phCls(i) === 'on' ? '<span class="spin" style="width:11px;height:11px;border-width:1.5px"></span>' : i + 1}</i><span>${p}</span></span>`).join('')}</div>`;
    const log = `<div class="fx-log" id="fxLog" data-sk="fxlog">${fixLog().slice(0, FX.logN).map((l, i) => `<div class="${i === FX.logN - 1 && FX.status === 'running' ? 'new' : ''}"><span class="ts">${l[0]}</span><span class="tg">${{ prep: '准备', edit: '修改', verify: '校验' }[l[1]]}</span><span class="x">${esc(l[2])}</span></div>`).join('')}${FX.status === 'running' ? `<div><span class="ts">${' '.repeat(8)}</span><span class="tg"></span><span class="x" style="color:var(--muted)"><span class="spin" style="width:10px;height:10px;display:inline-block;vertical-align:-1px;margin-right:6px"></span>${FX.phase === 2 ? '运行测试中' : '模型正在修改代码'}</span></div>` : ''}</div>`;
    const headRow = (t, s, right) => `<div class="card-head"><div class="grow"><div class="section-title">${t}</div>${s ? `<div class="hint">${s}</div>` : ''}</div>${right || ''}</div>`;
    let main = '';
    if (FX.status === 'running') {
      main = `<section class="card fx-sec">${headRow('修复进行中', `${F.FIX.branch} · 基于 feature/refund 的 e4f5a6b · ${F.FIX.role}`, `<button class="btn ghost sm" data-a="task-link">${I('external', 'sm')}在任务中查看</button><button class="btn secondary sm" data-a="stop-fix">${I('stop', 'sm')}停止修复</button>`)}${phases}${log}</section>
        <div class="lockline" style="margin-top:12px">${I('lock', 'sm')}<span>修复进行中：提交、推送、合并与再次修复都已锁定。你的工作区与 feature/refund 不受影响。</span></div>`;
    } else if (FX.status === 'failed') {
      main = `<section class="card fx-sec">${headRow('修复没有完成', `${F.FIX.branch} · 停在“修改代码”`)}${phases}
        <div style="padding:0 16px 14px"><div class="banner warn">${I('alert')}<div><b>模型未能完成修复</b><br>修改 src/refund/service.ts 时连续 3 次生成的代码无法通过类型检查，任务在 10:49:12 停止。修复分支里有 1 个文件的部分改动，<b>未校验</b>，不提供提交。</div></div></div>${log}</section>
        <div class="row" style="gap:8px;margin-top:12px"><button class="btn primary sm" data-a="fix-open">${I('refresh', 'sm')}重新修复</button><button class="btn secondary sm" data-a="discard">${I('trash', 'sm')}放弃修复</button><span class="grow"></span><button class="btn ghost sm" data-a="task-link">${I('external', 'sm')}在任务中查看</button></div>`;
    } else if (FX.status === 'nochange') {
      main = `<section class="card fx-sec">${headRow('AI 认为无需修改', `${F.FIX.branch} · 修复分支没有任何改动`)}
        ${['F1', 'F2', 'F3', 'F5'].map((id) => { const f = F.FINDINGS.find((x) => x.id === id); const why = { F1: '在 e4f5a6b 中 calcRefundAmt 的返回值只用于展示，入库金额由 Money.prorate 重新计算（已在后续提交修正）。', F2: '幂等由数据库唯一索引（order_id, idempotency_key）保证，服务层查重属于重复校验。', F3: '日志在网关层已统一脱敏，本服务的 logger 不落盘。', F5: '测试位于另一个仓库 order-service-tests，本仓库不需要新增。' }[id]; return `<div class="map-row"><div class="t">${sevBadge(f.sev)}<span class="ttl">${esc(f.title)}</span></div>${badge('未修复', 'st-idle mini-badge')}<div class="why">AI 的判断：${why}</div></div>`; }).join('')}</section>
        <div class="banner" style="margin-top:12px">${I('info')}<div>如果你不同意这些判断，可以回到问题列表调整说明后重新修复，或标为误报。修复分支没有改动，可以直接清理。</div><div class="actions"><button class="btn secondary sm" data-a="tab" data-k="review">回到问题列表</button><button class="btn secondary sm" data-a="discard-now">${I('trash', 'sm')}清理修复分支</button></div></div>`;
    } else {
      const res = F.FIX.result;
      const mapping = `<section class="card fx-sec">${headRow('问题对照', '4 个所选问题 · 3 个已修复 · 1 个部分修复', badge(FX.status === 'verify-failed' ? '校验未通过' : '校验通过', FX.status === 'verify-failed' ? 'st-fail' : 'st-ok', FX.status === 'verify-failed' ? 'x' : 'check'))}
        ${['F3', 'F1', 'F2', 'F5'].map((id) => { const f = F.FINDINGS.find((x) => x.id === id); const r = res[id]; return `<div class="map-row"><div class="t">${sevBadge(f.sev)}<span class="ttl">${esc(f.title)}</span></div>${badge(r[0] === 'done' ? '已修复' : '部分修复', r[0] === 'done' ? 'st-ok mini-badge' : 'st-fail mini-badge', r[0] === 'done' ? 'check' : 'alert')}<div class="why">${esc(r[1])}</div></div>`; }).join('')}</section>`;
      const files = F.FIX.files; const ff = files.find((f) => f.p === FX.file) || files[0];
      const canUndo = CM.st !== 'done' && !M.busy;
      const undo = FX.reverted.has(ff.p) ? '' : M.undoAsk === ff.p ? `<span class="hint">只在修复分支内撤销，不影响工作区</span><button class="btn danger sm" data-a="revert" data-p="${esc(ff.p)}">确认撤销</button><button class="btn ghost sm" data-a="revert-cancel">取消</button>`
        : `<button class="btn ghost sm" data-a="revert-ask" data-p="${esc(ff.p)}" ${canUndo ? '' : `disabled title="${CM.st === 'done' ? '已提交，不能再撤销单个文件' : '写操作进行中'}"`}>${I('undo', 'sm')}撤销此文件的改动</button>`;
      const s = stats(files.filter((f) => !FX.reverted.has(f.p)));
      const changes = `<section class="card fx-sec" style="overflow:hidden">${headRow('修复改动', `${F.FIX.branch} · 相对 e4f5a6b · ${files.length - FX.reverted.size} 个文件 <span class="add-n">+${s[0]}</span> <span class="del-n">−${s[1]}</span>${FX.reverted.size ? ` · 已撤销 ${FX.reverted.size} 个` : ''}`, `<div class="row" style="gap:6px">${undo}</div>`)}
        <div class="fx-diff">${fileList(files, { cur: ff.p, fix: true, reverted: FX.reverted })}${diffView(ff, { fix: true, reverted: FX.reverted.has(ff.p) })}</div></section>`;
      const v = FX.status === 'verify-failed' ? F.FIX.verifyFail : F.FIX.verifyOk;
      const verify = `<section class="card fx-sec">${headRow('校验结果', `运行项目测试命令 <span class="mono">${v.cmd}</span> · 用时 ${v.secs} 秒 · 在修复工作副本中运行`)}
        <div class="vf"><span class="tile" style="${v.fail ? 'color:var(--warn);background:var(--warn-fill)' : 'color:var(--ok);background:var(--ok-fill)'}">${I(v.fail ? 'x' : 'check', 'lg')}</span><div><div class="big"><span style="color:var(--ok)">${v.pass} 通过</span> <span style="color:${v.fail ? 'var(--danger)' : 'var(--muted)'}">· ${v.fail} 失败</span></div><div class="hint">${v.fail ? '2 个用例失败：都与金额舍入有关。仍可提交，但需要确认。' : '全部通过 · 41 个用例，其中 3 个是本次新增'}</div></div><span class="grow"></span>${v.fail ? `<button class="btn ghost sm" data-a="out-toggle">${FX.outOpen ? '收起输出' : '查看输出'}</button>` : ''}</div>
        ${v.fail && FX.outOpen ? `<pre class="tout">${esc(v.out).replace(/(FAIL.*|●.*|Received:.*|Tests:.*)/g, '<span class="bad">$1</span>').replace(/(Expected:.*)/g, '<span class="ok">$1</span>')}</pre>` : ''}
        ${v.fail ? `<div style="padding:0 16px 14px"><button class="btn secondary sm" data-a="fix-open">${I('refresh', 'sm')}重新修复（新开一次）</button></div>` : ''}</section>`;
      main = mapping + changes + verify;
    }
    return `<div class="fx-wrap"><div class="fx-main" id="fxScroll" data-sk="fx">${main}</div><div class="ns-col" id="nsScroll" data-sk="ns">${nextSteps()}</div></div>`;
  }

  /* ---------- 15. 下一步：提交 / 推送 / 合并（分步，依赖清楚） ---------- */
  function nextSteps() {
    const fxOk = FX.status === 'done' || FX.status === 'verify-failed';
    const head = `<div class="ns-h"><span class="t">下一步</span><span class="hint">分三步，逐步确认 · 不会自动连锁</span></div>`;
    if (!fxOk) {
      const why = FX.status === 'running' ? '修复完成后才能提交' : FX.status === 'nochange' ? '修复分支没有改动，没有可提交的内容' : '修复没有完成，不提供提交';
      return `<aside class="ns">${head}${[['提交修复', why], ['推送修复', '先完成 ① 提交'], ['合并修复', '先完成 ② 推送']].map((s, i) => `<div class="ns-step lock"><div class="ns-sh"><span class="ns-no">${i + 1}</span><span class="ns-tt"><span class="t">${s[0]}</span><span class="s">${I('lock', 'sm')} ${s[1]}</span></span></div></div>`).join('')}</aside>`;
    }
    return `<aside class="ns" aria-label="下一步">${head}${stepCommit()}${stepPush()}${stepMerge()}
      ${MG.st === 'mr' || MG.st === 'exists' || MG.st === 'merged' ? `<div class="ns-foot">${I('check', 'sm')}<span>修复已交给合并请求 · 本地修复分支会在合并后自动清理</span></div>` : `<div class="ns-foot">${I('trash', 'sm')}<span>不想要这次修复？</span><button class="btn ghost sm" style="color:var(--danger)" data-a="discard" ${M.busy ? 'disabled' : ''}>放弃修复…</button></div>`}</aside>`;
  }
  function stepCommit() {
    const files = F.FIX.files.filter((f) => !FX.reverted.has(f.p));
    if (CM.st === 'done') return `<div class="ns-step done"><div class="ns-sh"><span class="ns-no">${I('check')}</span><span class="ns-tt"><span class="t">已提交到 ${F.FIX.branch}</span><span class="s">dev-zhang · 10:52 · ${files.length} 个文件</span></span><button class="sha" data-a="copy-new">${F.FIX.newSha}</button></div></div>`;
    const ver = FX.status === 'verify-failed';
    const n = [...CM.files].filter((p) => !FX.reverted.has(p)).length;
    const busy = M.busy === 'commit';
    const dis = !n || (ver && !CM.ack) || !!M.busy;
    const why = !n ? '至少选择 1 个文件' : ver && !CM.ack ? '先确认校验未通过' : '';
    const hook = CM.st === 'hook' ? `<div class="banner danger" style="padding:10px 12px">${I('alert', 'sm')}<div style="min-width:0"><b>提交被 pre-commit hook 拒绝</b><br>修复分支内容没有变化。按输出修改后重试；不提供跳过 hook。<pre class="tout" style="margin:8px 0 0;max-height:180px">${esc(F.FIX.hook)}</pre></div></div>` : '';
    return `<div class="ns-step ${CM.st === 'hook' ? 'bad' : 'cur'}"><div class="ns-sh"><span class="ns-no">${CM.st === 'hook' ? I('x') : '1'}</span><span class="ns-tt"><span class="t">提交修复</span><span class="s">在本地修复分支 ${F.FIX.branch} 新建 1 个提交</span></span></div>
      <div class="ns-b">${hook}
        <div class="field"><label class="label" for="cmMsg">提交信息 <span class="opt">AI 草拟 · 可编辑</span></label><textarea class="textarea" id="cmMsg" data-in="cm-msg" rows="5" ${busy ? 'disabled' : ''}>${esc(CM.msg)}</textarea></div>
        <dl class="ns-kv"><dt>作者</dt><dd>dev-zhang &lt;dev@example.com&gt; <span class="hint">· 来自 设置 → Git 账号</span></dd><dt>分支</dt><dd class="mono" style="font-size:12px">${F.FIX.branch}</dd></dl>
        <div class="field"><span class="label">要提交的文件 <span class="opt">${n} / ${F.FIX.files.length}</span></span><div class="ns-files">${F.FIX.files.map((f) => { const rv = FX.reverted.has(f.p); return `<label class="${rv ? 'off' : ''}" title="${rv ? '已撤销，不会提交' : ''}"><input type="checkbox" data-a="cm-file" data-p="${esc(f.p)}" ${CM.files.has(f.p) && !rv ? 'checked' : ''} ${rv || busy ? 'disabled' : ''}><span class="ellipsis">${esc(f.p)}</span><span class="ct"><span class="add-n">+${f.add}</span> <span class="del-n">−${f.del}</span></span></label>`; }).join('')}</div></div>
        ${ver ? `<label class="check" style="font-size:12.5px;color:var(--ink-2)"><input type="checkbox" data-a="cm-ack" ${CM.ack ? 'checked' : ''}><span>我已了解校验未通过（2 个用例失败），仍要提交到修复分支</span></label>` : ''}
        <div class="conseq">${I('info', 'sm')}<div><b>后果：</b>只在本地修复分支新增 1 个提交。<ul><li>不改动 feature/refund，也不改动你的工作区（${M.dirty ? M.dirty + ' 个未提交改动保持原样' : '工作区干净'}）</li><li>提交后不能再撤销单个文件；推送是下一步，需要你再确认</li></ul></div></div>
        <div class="ns-act"><span class="grow">${why}</span><div class="splitbtn"><button class="btn primary sm" data-a="commit-do" ${dis ? 'disabled' : ''}>${busy ? '<span class="spin"></span>提交中…' : CM.st === 'hook' ? I('refresh', 'sm') + '重试提交' : I('commit', 'sm') + '提交到 ' + F.FIX.branch}</button><button class="btn primary sm" data-a="commit-menu" aria-label="更多提交方式" ${dis ? 'disabled' : ''}>${I('chevDown', 'sm')}</button></div></div>
      </div></div>`;
  }
  function stepPush() {
    if (CM.st !== 'done') return `<div class="ns-step lock"><div class="ns-sh"><span class="ns-no">2</span><span class="ns-tt"><span class="t">推送修复</span><span class="s">${I('lock', 'sm')} 先完成 ① 提交</span></span></div></div>`;
    if (PS.st === 'done') return `<div class="ns-step done"><div class="ns-sh"><span class="ns-no">${I('check')}</span><span class="ns-tt"><span class="t">已推送到 GitLab</span><span class="s">origin/${PS.branch} @ ${F.FIX.newSha} · 新建远端分支</span></span><button class="icon-btn" data-a="gl-open" title="在 GitLab 打开分支" aria-label="在 GitLab 打开分支">${I('external', 'sm')}</button></div></div>`;
    const busy = M.busy === 'push';
    const noGl = !glOK();
    let body = '';
    if (PS.st === 'rejected') {
      body = `<div class="banner warn" style="padding:10px 12px">${I('alert', 'sm')}<div><b>推送被拒绝（non-fast-forward）</b><br>远端已有 ${PS.branch}，并且包含本地没有的提交。<b>不会强制推送</b>，以免覆盖别人的改动。先获取远端更新，再决定怎么做。</div></div>
        ${PS.fetched ? `<div class="mrform"><div class="label">远端多出的提交</div><div class="row" style="gap:8px;font-size:12.5px">${av('李娜')}<span class="sha">b8c9d0e</span><span class="ellipsis grow">手动调整退款测试数据</span><span class="hint">李娜 · 10:50</span></div>
          <div class="hint">同名分支是李娜手动建的。可以换一个分支名推送这次修复，原分支保持不动。</div>
          <div class="field"><label class="label" for="psName">新分支名</label><input class="input mono" id="psName" value="${PS.branch}-2" data-in="ps-name"></div>
          <div class="ns-act"><button class="btn ghost sm" data-a="push-later">稍后处理</button><button class="btn primary sm" data-a="push-rename">${I('upload', 'sm')}以新分支名推送</button></div></div>`
        : `<div class="ns-act"><span class="grow">获取只读取远端，不改动任何分支</span><button class="btn primary sm" data-a="push-fetch" ${busy ? 'disabled' : ''}>${busy ? '<span class="spin"></span>获取中…' : I('refresh', 'sm') + '获取远端更新'}</button></div>`}`;
    } else if (PS.st === 'auth') {
      body = `<div class="banner danger" style="padding:10px 12px">${I('alert', 'sm')}<div><b>推送认证失败（403）</b><br>GitLab 拒绝了账号 dev-zhang 的写入：访问令牌已过期或没有 write_repository 权限。修复提交还在本地，没有丢失。</div></div>
        <div class="ns-act"><button class="btn ghost sm" data-a="settings">去设置验证连接</button><button class="btn primary sm" data-a="push-do" ${busy ? 'disabled' : ''}>${busy ? '<span class="spin"></span>推送中…' : I('refresh', 'sm') + '重试推送'}</button></div>`;
    } else if (PS.st === 'unknown') {
      const ck = PS.check;
      body = `<div class="banner unknown" style="padding:10px 12px">${I('help', 'sm')}<div><b>推送结果未知</b><br>10:53:20 发出推送（原操作 op-push-7c21）后连接中断，没有收到回执。保持原记录，<b>不会重新推送</b>。${ck && ck !== 'loading' ? `<div style="margin-top:6px">${ck}</div>` : ''}</div></div>
        <div class="ns-act"><span class="grow">核对：读取远端分支，比对是否已有 ${F.FIX.newSha}</span><button class="btn secondary sm" data-a="push-check" ${ck === 'loading' ? 'disabled' : ''}>${ck === 'loading' ? '<span class="spin"></span>核对中' : I('search', 'sm') + '核对原操作'}</button></div>`;
    } else {
      body = `<dl class="ns-kv"><dt>远端</dt><dd>origin · ${F.GITLAB.host}/${F.GITLAB.project}</dd><dt>分支</dt><dd><span class="mono" style="font-size:12px">${PS.branch}</span> ${badge('新建远端分支', 'st-accent mini-badge')}</dd><dt>内容</dt><dd>1 个提交 · ${F.FIX.newSha}</dd></dl>
        <div class="conseq">${I('info', 'sm')}<div><b>后果：</b>在 GitLab 新建分支 ${PS.branch}，团队成员可见。<ul><li>不改动 feature/refund 与 main</li><li>永不强制推送：远端有冲突时会停下来让你决定</li></ul></div></div>
        ${noGl ? `<div class="lockline">${I('lock', 'sm')}<span><b>GitLab 未配置</b>，不能推送。到 设置 → GitLab 配置连接后回来继续；修复提交保留在本地。</span></div>` : ''}
        <div class="ns-act"><button class="btn primary sm" data-a="push-do" ${busy || noGl || M.busy ? 'disabled' : ''}>${busy ? '<span class="spin"></span>推送中…' : I('upload', 'sm') + '推送到 GitLab'}</button></div>`;
    }
    const cls = PS.st === 'rejected' || PS.st === 'auth' ? 'bad' : PS.st === 'unknown' ? 'unk' : 'cur';
    return `<div class="ns-step ${cls}"><div class="ns-sh"><span class="ns-no">${cls === 'bad' ? I('x') : cls === 'unk' ? '?' : '2'}</span><span class="ns-tt"><span class="t">推送修复</span><span class="s">origin / ${PS.branch}</span></span></div><div class="ns-b">${body}</div></div>`;
  }
  function directBlock() {
    if (MG.target === 'main') return 'main 是保护分支，只能通过合并请求合并。';
    if (!glOK()) return '需要 GitLab：直接合并后要推送目标分支。';
    if (M.dirty) return `feature/refund 是你当前检出的分支，且工作区有 ${M.dirty} 个未提交改动；直接合并会改动工作区。请先提交或暂存这些改动，或改用合并请求。`;
    return '';
  }
  function stepMerge() {
    if (PS.st !== 'done') return `<div class="ns-step lock"><div class="ns-sh"><span class="ns-no">3</span><span class="ns-tt"><span class="t">合并修复</span><span class="s">${I('lock', 'sm')} ${PS.st === 'unknown' ? '推送结果确认前不能合并' : '先完成 ② 推送'}</span></span></div></div>`;
    if (MG.st === 'mr' || MG.st === 'exists') return `<div class="ns-step done"><div class="ns-sh"><span class="ns-no">${I('check')}</span><span class="ns-tt"><span class="t">${MG.st === 'mr' ? '已创建合并请求' : '合并请求已存在'} ${F.FIX.mr}</span><span class="s">${PS.branch} → ${MG.target}</span></span></div>
      <div class="ns-b"><div class="mrform"><div class="row" style="gap:8px"><span class="tile" style="width:28px;height:28px;border-radius:8px">${I('pr', 'sm')}</span><div class="grow" style="min-width:0"><div class="ellipsis" style="font-size:13px;font-weight:500">${esc(MG.title)}</div><div class="hint">${F.FIX.mr} · ${MG.st === 'mr' ? '刚刚由 dev-zhang 创建' : '李娜 · 10:49 创建 · 推送已更新它'}</div></div></div>
        <div class="pipe">${badge('打开', 'st-run mini-badge')}${badge('流水线 运行中', 'st-wait mini-badge')}${badge('审批 0 / 1 · ' + [...MG.reviewers].join('、'), 'st-idle mini-badge')}</div>
        ${MG.st === 'exists' ? `<div class="hint">同一源 → 目标已有打开的合并请求，没有重复创建。</div>` : ''}
        <div class="ns-act"><button class="btn secondary sm" data-a="gl-open">${I('external', 'sm')}在 GitLab 打开 ${F.FIX.mr}</button></div></div></div></div>`;
    if (MG.st === 'merged') return `<div class="ns-step done"><div class="ns-sh"><span class="ns-no">${I('check')}</span><span class="ns-tt"><span class="t">已合并到 ${MG.target}</span><span class="s">快进合并 · 已推送 origin/${MG.target} · 7e6d5c4</span></span></div></div>`;
    const busy = M.busy === 'merge';
    if (MG.st === 'conflict') return `<div class="ns-step bad"><div class="ns-sh"><span class="ns-no">${I('x')}</span><span class="ns-tt"><span class="t">直接合并有冲突</span><span class="s">${PS.branch} → ${MG.target}</span></span></div><div class="ns-b">
      <div class="banner warn" style="padding:10px 12px">${I('alert', 'sm')}<div><b>合并已取消，feature/refund 未被改动</b><br>合并前获取到 origin/feature/refund 的新提交 b5a4c3d（李娜 · 10:58 · 退款金额改用 Money 工具），与修复改动冲突：<div class="conf-files">${['src/refund/service.ts', 'src/common/money.ts'].map((p) => `<div>${I('alert', 'sm')}${p}</div>`).join('')}</div></div></div>
      <div class="conseq">${I('info', 'sm')}<div>建议改用合并请求，在 GitLab 中解决冲突并由评审人确认。原型不在这里提供冲突编辑。</div></div>
      <div class="ns-act"><button class="btn primary sm" data-a="to-mr">${I('pr', 'sm')}改为创建合并请求</button></div></div></div>`;
    if (!MG.open) return `<div class="ns-step cur"><div class="ns-sh"><span class="ns-no">3</span><span class="ns-tt"><span class="t">合并修复</span><span class="s">${PS.branch} → ${MG.target}</span></span></div>
      <div class="ns-b"><div class="hint">推荐：创建合并请求，由评审人在 GitLab 中确认后合并。也可以在条件满足时直接合并。</div><div class="ns-act"><button class="btn primary sm" data-a="mg-open">${I('merge', 'sm')}选择合并方式</button></div></div></div>`;
    const blk = directBlock();
    const mrDis = !glOK();
    const mode = blk && MG.mode === 'direct' ? 'mr' : MG.mode; MG.mode = mode;
    const cards = `<div class="mcards" role="radiogroup" aria-label="合并方式">
      <button class="rcard2" role="radio" aria-checked="${mode === 'mr'}" data-a="mg-mode" data-k="mr" ${mrDis ? 'aria-disabled="true"' : ''}><span class="rd"></span><span><span class="t">创建合并请求（推荐）</span><span class="d" style="display:block">在 GitLab 新建 ${PS.branch} → ${MG.target} 的合并请求，由评审人确认后合并。附审查问题列表。</span></span></button>
      <button class="rcard2" role="radio" aria-checked="${mode === 'direct'}" data-a="mg-mode" data-k="direct" ${blk ? 'aria-disabled="true"' : ''}><span class="rd"></span><span><span class="t">直接合并到 ${MG.target}</span><span class="d" style="display:block">${blk ? `<span style="color:var(--warn);display:flex;gap:5px;align-items:flex-start">${I('lock', 'sm')}<span>不可用：${esc(blk)}</span></span>` : '合并后自动推送 origin/' + MG.target + '。仅当目标分支未受保护、可快进或无冲突时可用。'}${MG.target !== 'main' ? `<span style="display:flex;gap:5px;align-items:flex-start;margin-top:4px;color:var(--muted)">${I('lock', 'sm')}<span>main：保护分支，只能通过合并请求合并</span></span>` : ''}</span></span></button></div>`;
    const target = `<div class="field"><label class="label" for="mgT">目标分支</label><select class="select" id="mgT" data-in="mg-target" style="height:34px;font-size:13px"><option value="feature/refund" ${MG.target === 'feature/refund' ? 'selected' : ''}>feature/refund（这次修复所在的分支）</option><option value="main" ${MG.target === 'main' ? 'selected' : ''}>main · 保护分支</option></select></div>`;
    const form = mode === 'mr' ? `<div class="mrform"><div class="field"><label class="label" for="mgTitle">标题 <span class="opt">AI 草拟</span></label><input class="input" id="mgTitle" data-in="mg-title" value="${esc(MG.title)}"></div>
        <div class="field"><label class="label" for="mgDesc">描述 <span class="opt">附审查问题列表</span></label><textarea class="textarea" id="mgDesc" data-in="mg-desc" style="min-height:120px;font-size:12.5px">${esc(MG.desc)}</textarea></div>
        <div class="field"><span class="label">评审人 <span class="opt">可选</span></span><div class="reviewers">${['李娜', '刘洋', '王芳'].map((n) => `<button aria-pressed="${MG.reviewers.has(n)}" data-a="mg-rev" data-k="${n}">${av(n)}${n}</button>`).join('')}</div></div></div>
      <div class="conseq">${I('info', 'sm')}<div><b>后果：</b>在 GitLab 创建合并请求，${MG.reviewers.size ? '通知 ' + [...MG.reviewers].join('、') + '；' : ''}不会合并任何代码，目标分支 ${MG.target} 不变。</div></div>
      <div class="ns-act"><button class="btn primary sm" data-a="mr-do" ${busy || mrDis || M.busy ? 'disabled' : ''}>${busy ? '<span class="spin"></span>创建中…' : I('pr', 'sm') + '创建合并请求'}</button></div>`
      : `<div class="conseq" style="border-color:var(--warn-line)">${I('alert', 'sm')}<div><b>后果：</b>把 ${PS.branch} 合并进 ${MG.target}，并<b>自动推送 origin/${MG.target}</b>，团队成员会立即拉到这些改动。合并前会再确认一次。</div></div>
      <div class="ns-act"><button class="btn primary sm" data-a="direct-ask" ${busy || M.busy ? 'disabled' : ''}>${busy ? '<span class="spin"></span>合并中…' : I('merge', 'sm') + '直接合并…'}</button></div>`;
    return `<div class="ns-step cur"><div class="ns-sh"><span class="ns-no">3</span><span class="ns-tt"><span class="t">合并修复</span><span class="s">${PS.branch} → ${MG.target}</span></span></div><div class="ns-b">${target}${cards}${form}</div></div>`;
  }

  /* ---------- 16. 分支 / 合并请求视图（右栏） ---------- */
  function branchesView() {
    const rows = M.brTab === 'local' ? F.BRANCHES.local : F.BRANCHES.remote;
    const off = M.brTab === 'remote' && !glOK();
    return `<section class="wb-detail" aria-label="分支"><div class="cd-head"><div class="cd-t"><div class="grow"><div class="cd-title">分支</div><div class="hint">本地 ${F.BRANCHES.local.length} 个 · 远端 ${glOK() ? F.BRANCHES.remote.length : '—'} 个 · 默认分支 main · 只读</div></div><button class="btn ghost sm only-narrow" data-a="list-toggle">${I('list', 'sm')}提交列表</button></div>
      <div class="seg" style="margin-top:12px">${[['local', '本地'], ['remote', '远端 · origin']].map(([k, l]) => `<button aria-pressed="${M.brTab === k}" data-a="br-tab" data-k="${k}">${l}</button>`).join('')}</div></div>
      <div class="cd-scroll"><div class="cd-pad">${off ? `<div class="banner warn">${I('alert')}<div><b>GitLab 未配置，读不到远端分支</b><br>本地分支仍可浏览。</div><div class="actions"><button class="btn secondary sm" data-a="settings">去设置</button></div></div>` : `
      <table class="tbl fixed"><colgroup><col style="width:36%"><col style="width:78px"><col><col style="width:96px"></colgroup><thead><tr><th>分支</th><th>相对 main</th><th>最后提交</th><th>合并请求</th></tr></thead><tbody>
      ${rows.map((b) => `<tr class="click ${M.filter.branch === b.n ? 'on' : ''}" data-a="filter-branch" data-b="${b.n}" tabindex="0" title="在提交列表筛选 ${b.n}"><td><div class="bn">${b.lock ? `<span title="保护分支">${I('lock', 'sm')}</span>` : I('gitRepo', 'sm')}${esc(b.n)}${b.cur ? badge('当前', 'st-accent mini-badge') : ''}${b.def ? badge('默认', 'st-idle mini-badge') : ''}</div>${b.up ? `<div class="hint ellipsis" style="margin-top:2px;font-size:11.5px" title="上游 ${esc(b.up)}">上游 ${esc(b.up)}</div>` : ''}</td>
        <td><span class="ab">${b.def || b.n === 'origin/main' ? '—' : `<span class="up">↑${b.a}</span> <span class="dn2">↓${b.b}</span>`}</span></td>
        <td><div class="lm"><span class="m"><span class="sha" style="margin-right:6px">${b.sha}</span>${esc(b.msg)}</span><span class="w">${b.when}</span></div></td>
        <td>${b.mr ? `<span class="badge ${b.mr[2]} mini-badge">${b.mr[0]} · ${b.mr[1]}</span>` : '<span class="hint">—</span>'}</td></tr>`).join('')}</tbody></table>
      <p class="hint" style="margin-top:12px;display:flex;gap:6px;align-items:center">${I('info', 'sm')}点一行 = 在提交列表筛选该分支。这里不提供检出、新建、删除或重命名分支。</p>`}</div></div></section>`;
  }
  function mrView() {
    if (!glOK()) return `<section class="wb-detail"><div class="cd-scroll"><div class="empty" style="padding-top:80px"><span class="tile" style="color:var(--warn)">${I('pr', 'lg')}</span><h3>合并请求需要 GitLab 连接</h3><p>GitLab 未配置，读不到合并请求、流水线与审批。本地提交、分支与 AI 审查仍可使用。</p><button class="btn primary sm" data-a="settings">去设置 → GitLab${I('arrowRight', 'sm')}</button></div></div></section>`;
    const list = F.MRS.filter((m) => M.mrFilter === 'all' || (M.mrFilter === 'open' ? ['打开', '冲突'].includes(m.st[0]) : M.mrFilter === 'merged' ? m.st[0] === '已合并' : m.st[0] === '已关闭'));
    const sel = F.MRS.find((m) => m.id === M.mr);
    const rows = list.map((m) => `<button class="mr-row" aria-selected="${M.mr === m.id}" data-a="mr" data-k="${m.id}"><span class="t"><span class="hint mono" style="font-weight:400">${m.id}</span><span class="x">${esc(m.title)}</span></span>
      <span class="m"><span class="srcdst">${esc(m.src)} ${I('arrowRight', 'sm')} ${esc(m.dst)}</span><span>·</span>${av(m.who)}<span>${m.who}</span><span>·</span><span>${m.when}</span></span>
      <span class="r">${badge(m.st[0], m.st[1] + ' mini-badge', m.st[2])}${m.pipe[1] ? badge('流水线 ' + m.pipe[0], m.pipe[1] + ' mini-badge', m.pipe[2]) : ''}<span class="hint" style="font-size:12px;white-space:nowrap">审批 ${m.appr}</span></span></button>`).join('');
    const det = sel ? `<section class="card" style="margin-top:16px"><div class="mr-d"><div class="row" style="gap:8px;flex-wrap:wrap"><span class="hint mono">${sel.id}</span><span class="section-title">${esc(sel.title)}</span>${badge(sel.st[0], sel.st[1], sel.st[2])}<span class="grow"></span><button class="btn secondary sm" data-a="gl-open">${I('external', 'sm')}在 GitLab 打开</button></div>
        <div class="srcdst" style="margin-top:6px">${esc(sel.src)} ${I('arrowRight', 'sm')} ${esc(sel.dst)}</div>
        <p style="margin-top:10px;font-size:13.5px;line-height:1.7;color:var(--ink-2)">${esc(sel.desc)}</p>
        <div class="grid-2" style="margin-top:14px"><div><div class="eyebrow" style="margin-bottom:6px">流水线</div><div class="pipe">${sel.stages.length ? sel.stages.map((s) => badge(s[0], s[1] + ' mini-badge', s[1] === 'st-ok' ? 'check' : s[1] === 'st-danger' ? 'x' : null)).join(I('chevRight', 'sm')) : '<span class="hint">没有流水线</span>'}</div></div>
          <div><div class="eyebrow" style="margin-bottom:6px">审批 · ${sel.appr}</div><div class="pipe">${sel.approvers.length ? sel.approvers.map((a) => `<span class="row" style="gap:5px;font-size:12.5px">${av(a[0])}${a[0]} ${badge(a[1], a[2] + ' mini-badge')}</span>`).join('') : '<span class="hint">—</span>'}</div></div></div></div>
        ${sel.commits.length ? `<div class="card-head" style="box-shadow:inset 0 1px 0 var(--line),inset 0 -1px 0 var(--line);padding:10px 18px"><span class="section-title" style="font-size:13.5px">${sel.commits.length} 个提交</span><span class="hint">点提交查看详情</span></div>
        <div class="list mr-commits" style="padding:6px">${sel.commits.map((s) => { const c = commitOf(s); return `<button class="list-row" data-a="commit" data-sha="${s}">${av(c.who)}<span class="sha">${s}</span><span class="grow ellipsis">${esc(c.msg)}</span>${rvBadge(c)}<span class="hint" style="white-space:nowrap">${c.rel}</span>${I('chevRight', 'sm')}</button>`; }).join('')}</div>` : ''}</section>` : '';
    return `<section class="wb-detail" aria-label="合并请求"><div class="cd-head"><div class="cd-t"><div class="grow"><div class="cd-title">合并请求</div><div class="hint">${F.GITLAB.host}/${F.GITLAB.project} · 只读 · 最近获取 ${M.fetchedAt}</div></div><button class="btn ghost sm only-narrow" data-a="list-toggle">${I('list', 'sm')}提交列表</button><button class="btn secondary sm" data-a="gl-open">${I('external', 'sm')}在 GitLab 打开</button></div></div>
      <div class="cd-scroll"><div class="cd-pad"><section class="card" style="overflow:hidden">${rows || '<div class="empty">没有合并请求</div>'}</section>${det}</div></div></section>`;
  }

  /* ---------- 17. 工作台总装 ---------- */
  function workbench() {
    const p = proj();
    let bn = '';
    if (M.fetch === 'auth') bn = `<div class="wb-bn"><div class="banner danger">${I('alert')}<div><b>获取远端更新失败：GitLab 认证失败（401）</b><br>账号 dev-zhang 的访问令牌被拒绝。本地提交仍可浏览；领先 / 落后停留在 10:42 的数据。</div><div class="actions"><button class="btn secondary sm" data-a="settings">去设置验证连接</button><button class="btn ghost sm" data-a="fetch">${I('refresh', 'sm')}重试</button><button class="icon-btn" data-a="dismiss-fetch" aria-label="关闭提示">${I('x', 'sm')}</button></div></div></div>`;
    if (M.empty) {
      return `<div class="wb-wrap">${bn}<div class="wb" style="grid-template-columns:${'240px minmax(0,1fr)'}">${rail()}<section class="wb-detail"><div class="cd-scroll"><div class="empty" style="padding-top:72px"><span class="tile">${I('commit', 'lg')}</span><h3>${esc(p.name)} 还没有任何提交</h3>
        <p>仓库已经初始化，当前分支 <span class="mono">main</span> 还没有提交，所以没有提交列表、差异或 AI 审查。第一次提交后这里会自动出现。</p>
        <div class="lockline" style="max-width:460px;margin-top:6px;text-align:left">${I('edit', 'sm')}<span>工作区里有 <b>${p.dirty} 个未提交文件</b>（只读提示）。在你常用的工具里完成第一次提交即可，这个页面不代替你提交。</span></div>
        <div class="lockline" style="max-width:460px;text-align:left">${I('link', 'sm')}<span>这个项目没有绑定 GitLab 项目：到 项目 → ${esc(p.name)} → Git 与 GitLab 绑定后，可读取远端分支和合并请求。</span></div></div></div></section></div></div>`;
    }
    let right;
    if (M.left === 'branches') right = branchesView();
    else if (M.left === 'mrs') right = mrView();
    else right = commitDetail();
    return `<div class="wb-wrap">${bn}<div class="wb ${M.full && M.left === 'commits' ? 'full' : ''} ${M.railOpen ? 'rail-open' : ''} ${M.listOpen ? 'list-open' : ''}" id="wb">${rail()}${commitList()}${right}</div></div>`;
  }

  /* ---------- 18. 抽屉与对话框 ---------- */
  function overlays() {
    return `<aside class="drawer md" id="rvDrawer" aria-hidden="true" role="dialog" aria-labelledby="rvT" tabindex="-1"></aside>
      <div class="dialog wide" id="dlgFix" role="alertdialog" aria-labelledby="dfT"></div>
      <div class="dialog" id="dlgDiscard" role="alertdialog" aria-labelledby="ddT"></div>
      <div class="dialog" id="dlgMerge" role="alertdialog" aria-labelledby="dmT"></div>
      <div class="dialog" id="dlgStop" role="alertdialog" aria-labelledby="dsT"></div>
      <aside class="drawer md" id="explain" aria-hidden="true" role="dialog" aria-labelledby="exT" tabindex="-1">
        <div class="drawer-head"><div class="grow"><div class="eyebrow">原型说明 · 设计样例</div><h2 id="exT" style="margin-top:3px"></h2><div class="ex-id" id="exId" style="margin-top:4px"></div></div><button class="icon-btn" aria-label="关闭说明" data-a="close-drawer" data-k="explain">${I('x')}</button></div>
        <div class="drawer-body" id="exB"></div>
        <div class="drawer-foot"><span class="hint grow">原型完成不等于接入内部 MCP、真实 Git / GitLab 或模型验证。</span><button class="btn secondary" data-a="close-drawer" data-k="explain">关闭</button></div></aside>`;
  }
  function fillReviewDrawer() {
    const c = commitOf(M.commit); const r = M.rset; const merge = c.parents.length > 1;
    $('#rvDrawer').innerHTML = `<div class="drawer-head"><div class="grow"><div class="eyebrow">AI 审查 · 审查设置</div><h2 id="rvT" style="margin-top:3px">审查 <span class="mono" style="font-size:14px">${c.sha}</span> ${esc(c.msg)}</h2><span class="badge outline sample" style="margin-top:8px">${I('info', 'sm')}设计样例 · 不连接真实 Git / GitLab / 模型</span></div><button class="icon-btn" aria-label="关闭" data-a="close-drawer" data-k="rvDrawer">${I('x')}</button></div>
      <div class="drawer-body">
        <div class="field"><span class="label">审查范围</span><div class="rcards" role="radiogroup">
          <button class="rcard2" role="radio" aria-checked="${r.scope === 'parent'}" data-a="rs-scope" data-k="parent"><span class="rd"></span><span><span class="t">只看这次提交的改动</span><span class="d" style="display:block">对比父提交 ${merge ? '（合并提交须选父）' : c.parents[0]} · ${filesOf(c.sha).length} 个文件</span></span></button>
          <button class="rcard2" role="radio" aria-checked="${r.scope === 'target'}" data-a="rs-scope" data-k="target"><span class="rd"></span><span><span class="t">对比目标分支</span><span class="d" style="display:block">main…${c.sha} · 这条分支到此提交为止的全部改动（较慢）</span></span></button></div>
          ${merge ? `<div class="seg" style="margin-top:8px">${[1, 2].map((k) => `<button aria-pressed="${r.parent === k}" data-a="rs-parent" data-k="${k}">对比父 ${k} · ${c.parents[k - 1]}</button>`).join('')}</div>` : ''}</div>
        <div class="field"><div class="row between"><span class="label">维度</span><span class="counter">${r.dims.size} / 6</span></div><div class="dchips">${DIMS.map(([k, l]) => `<button class="dchip" aria-pressed="${r.dims.has(k)}" data-a="rs-dim" data-k="${k}">${I('check')}${l}</button>`).join('')}</div>${r.dims.size ? '' : '<span class="error-text">至少选择 1 个维度</span>'}</div>
        <div class="field"><label class="label" for="rsRole">审查职业</label><select class="select" id="rsRole"><option>代码评审员 · 发布修订 3</option><option>安全评审员 · 发布修订 1</option></select><span class="hint">审查按开始时冻结的职业版本执行；之后职业再发布不影响这次审查。</span></div>
        <div class="field"><span class="label">上下文</span><div class="seg">${[['diff', '只读改动'], ['related', '改动 + 相关文件（推荐）']].map(([k, l]) => `<button aria-pressed="${r.ctx === k}" data-a="rs-ctx" data-k="${k}">${l}</button>`).join('')}</div><span class="hint">${r.ctx === 'related' ? '会额外读取被改动代码引用的文件（例如 repository、dto），结论更准确。' : '只读取 diff，速度快，但可能漏掉跨文件问题。'}</span></div>
        <div class="lockline" style="margin-top:20px">${I('lock', 'sm')}<span><b>审查只读取代码，不会修改文件或分支。</b>以只读模板任务运行，可在任务中查看执行过程。</span></div>
      </div>
      <div class="drawer-foot"><span class="hint grow">${RV.status === 'done' || RV.status === 'failed' ? '新开第 3 次审查，历史记录保留' : '预计 1–3 分钟'}</span><button class="btn ghost" data-a="close-drawer" data-k="rvDrawer">取消</button><button class="btn primary" data-a="review-start" ${r.dims.size ? '' : 'disabled'}>${I('sparkle', 'sm')}开始审查</button></div>`;
  }
  function fillFixDialog() {
    const sel = F.FINDINGS.filter((f) => RV.sel.has(f.id));
    $('#dlgFix').innerHTML = `<div class="dialog-body"><h2 id="dfT">开始 AI 修复？</h2><p>AI 会按所选的 ${sel.length} 个问题修改代码，完成后由你逐步决定是否提交、推送、合并。</p>
      <div class="safe">${I('shield')}<div><b>在隔离的修复分支中进行，不改动你当前的工作区。</b><br><span style="color:var(--sub);font-size:12.5px">你的 ${M.dirty ? M.dirty + ' 个未提交改动和' : ''}当前检出的 feature/refund 保持原样。</span></div></div>
      <dl class="dlg-kv">
        <dt>修复分支</dt><dd><span class="mono">${F.FIX.branch}</span> ${badge('新建 · 本地', 'st-accent mini-badge')}</dd>
        <dt>基于</dt><dd>feature/refund 的最新提交 <span class="sha">e4f5a6b</span><div class="hint">${F.FIX.baseNote}</div></dd>
        <dt>问题</dt><dd>${sel.map((f) => `<div class="row" style="gap:6px;margin-bottom:3px">${sevBadge(f.sev)}<span class="ellipsis" style="font-size:12.5px">${esc(f.title)}</span></div>`).join('')}</dd>
        <dt>修复职业</dt><dd><select class="select" style="height:34px;font-size:13px"><option>${F.FIX.role}</option><option>后端工程师 · 修订 2</option></select></dd>
        <dt>修复后校验</dt><dd>${M.testCmd ? `<label class="check" style="font-size:13px"><input type="checkbox" checked><span>运行项目测试命令 <span class="mono">npm test</span><span class="hint" style="display:block">来自项目配置 · 在修复工作副本里运行</span></span></label>` : `<span style="color:var(--warn)">${I('alert', 'sm')} 项目未配置测试命令，修复后不会自动校验。</span><div class="hint">可以在 项目 → 订单服务 → 配置 中设置。</div>`}</dd>
      </dl></div>
      <div class="dialog-foot"><button class="btn ghost" data-a="close-dialog" autofocus>取消</button><button class="btn primary" data-a="fix-start">${I('wand', 'sm')}开始修复</button></div>`;
  }
  function fillDiscardDialog() {
    const pushed = PS.st === 'done';
    $('#dlgDiscard').innerHTML = `<div class="dialog-body"><h2 id="ddT">放弃这次修复？</h2><p>修复改动${CM.st === 'done' ? '和修复提交 ' + F.FIX.newSha : ''}将不再保留。审查结果和问题状态保留，可以重新修复。</p>
      <ul class="dlg-list"><li style="color:var(--danger)">${I('trash', 'sm')}<span>删除本地修复分支 <span class="mono">${F.FIX.branch}</span></span></li><li style="color:var(--danger)">${I('trash', 'sm')}<span>删除修复工作副本（隔离目录）</span></li>
        ${pushed ? `<li>${I('cloud', 'sm')}<span><b style="font-weight:500">不会删除</b>已推送的远端分支 <span class="mono">origin/${PS.branch}</span>，需要时在 GitLab 中删除</span></li>` : ''}
        <li>${I('shield', 'sm')}<span>你的工作区与 feature/refund 不受影响</span></li></ul></div>
      <div class="dialog-foot"><button class="btn ghost" data-a="close-dialog" autofocus>保留修复</button><button class="btn danger" data-a="discard-do">放弃修复</button></div>`;
  }
  function fillMergeDialog() {
    $('#dlgMerge').innerHTML = `<div class="dialog-body"><h2 id="dmT">直接合并到 ${MG.target}？</h2><p>将把 <span class="mono">${PS.branch}</span> 合并进 <span class="mono">${MG.target}</span>：</p>
      <ul class="dlg-list"><li>${I('merge', 'sm')}<span>在修复工作副本中合并（可快进时快进）</span></li><li style="color:var(--warn)">${I('upload', 'sm')}<span>合并后<b style="font-weight:500">自动推送 origin/${MG.target}</b>，团队成员会立即拉到这些改动</span></li><li>${I('shield', 'sm')}<span>有冲突时自动取消，${MG.target} 保持不变</span></li></ul></div>
      <div class="dialog-foot"><button class="btn ghost" data-a="close-dialog" autofocus>取消</button><button class="btn primary" data-a="direct-do">${I('merge', 'sm')}合并并推送</button></div>`;
  }
  let stopKind = 'review';
  function fillStopDialog() {
    const fx = stopKind === 'fix';
    $('#dlgStop').innerHTML = `<div class="dialog-body"><h2 id="dsT">${fx ? '停止修复？' : '停止审查？'}</h2><p>${fx ? '已经做出的部分改动保留在修复分支里但不会被校验；之后可以放弃修复或重新修复。停止需要一点时间，确认前按钮保持锁定。' : '已读取的内容保留在任务记录里，不会生成问题。之后可以重新审查。'}</p></div>
      <div class="dialog-foot"><button class="btn ghost" data-a="close-dialog" autofocus>继续${fx ? '修复' : '审查'}</button><button class="btn danger" data-a="stop-do">停止</button></div>`;
  }

  /* ---------- 19. 渲染 ---------- */
  function render() {
    const keep = {}; $$('[data-sk]').forEach((el) => { keep[el.dataset.sk] = [el.scrollTop, el.scrollLeft]; });
    const ae = document.activeElement; const aeKey = ae && ae.dataset && (ae.dataset.in || null); const aePos = aeKey && ae.selectionStart;
    $('.header').innerHTML = header();
    const content = $('#content');
    content.classList.toggle('wb-mode', M.view === 'wb');
    $('#page').innerHTML = M.view === 'overview' ? overview() : M.view === 'missing' ? missing() : M.view === 'notgit' ? notGit('notgit') : M.view === 'unavail' ? notGit('unavail') : workbench();
    $$('[data-sk]').forEach((el) => { const k = keep[el.dataset.sk]; if (k) { el.scrollTop = k[0]; el.scrollLeft = k[1]; } });
    const dv = $('#dvScroll'); if (dv) dv.style.setProperty('--dvw', dv.clientWidth + 'px');
    if (aeKey) { const el = $(`[data-in="${aeKey}"]`); if (el) { el.focus(); try { if (aePos != null) el.setSelectionRange(aePos, aePos); } catch (e) {} } }
  }
  function scrollToLine(n, flash) {
    requestAnimationFrame(() => {
      const sc = $('#dvScroll'); if (!sc) return;
      const row = $(`.dl[data-n="${n}"]`, sc); if (!row) return;
      sc.scrollTop = Math.max(0, row.offsetTop - sc.clientHeight * 0.28);
      if (flash) $$(`.dl[data-n]`, sc).forEach((r) => { const k = +r.dataset.n; if (k >= flash[0] && k <= flash[1]) r.classList.add('flash'); });
    });
  }
  function scrollSelectedCommit() { requestAnimationFrame(() => { const r = $('.cl-row[aria-selected="true"]'); const sc = $('#clScroll'); if (r && sc && (r.offsetTop < sc.scrollTop || r.offsetTop > sc.scrollTop + sc.clientHeight - 60)) sc.scrollTop = r.offsetTop - 80; }); }

  /* ---------- 20. 模拟的写操作 ---------- */
  function startReview() {
    DS.closeDrawer('rvDrawer');
    RV.status = 'running'; RV.phase = 0; M.tab = 'review'; M.head = 'compact'; M.hist = 2; M.busy = 'review'; M.rvStart = '10:54';
    render(); toast('已开始审查 a1b2c3d（只读）', 'info');
    later(1600, () => { if (RV.status !== 'running') return; RV.phase = 1; render(); });
    later(4200, () => { if (RV.status !== 'running') return; RV.phase = 2; render(); });
    later(5600, () => { if (RV.status !== 'running') return; RV.status = 'done'; M.busy = null; resetFindings(false); render(); toast('审查完成：5 个问题（阻断 1 · 严重 1 · 一般 2 · 建议 1）', 'ok'); });
  }
  function runReviewFrom(phase) {
    later(1800, () => { if (RV.status !== 'running') return; if (RV.phase < 2) { RV.phase++; render(); runReviewFrom(RV.phase); } else { RV.status = 'done'; M.busy = null; render(); toast('审查完成：5 个问题', 'ok'); } });
  }
  function startFix() {
    DS.closeDialog('dlgFix');
    FX.status = 'running'; FX.phase = 0; FX.logN = 1; FX.reverted.clear(); M.tab = 'fix'; M.full = true; M.head = 'compact'; M.busy = 'fix';
    CM.st = 'todo'; PS.st = 'todo'; MG.st = 'todo';
    render(); toast('已开始修复：在隔离分支 ' + F.FIX.branch + ' 中进行', 'info');
    stepFix();
  }
  function stepFix() {
    later(900, () => {
      if (FX.status !== 'running') return;
      FX.logN++;
      const tag = F.FIX.log[FX.logN - 1] ? F.FIX.log[FX.logN - 1][1] : 'done';
      FX.phase = tag === 'prep' ? 0 : tag === 'edit' ? 1 : 2;
      if (FX.logN >= F.FIX.log.length) { FX.status = M.testCmd ? 'done' : 'done'; FX.phase = 4; M.busy = null; render(); toast('修复完成：3 个问题已修复、1 个部分修复 · 测试 41 通过', 'ok'); return; }
      render(); const lg = $('#fxLog'); if (lg) lg.scrollTop = lg.scrollHeight; stepFix();
    });
  }
  function doCommit(andPush) {
    if (M.busy) return;
    M.busy = 'commit'; render();
    later(1300, () => {
      M.busy = null;
      if (CFG.id === 'g59-commit-hook-rejected' && CM.st === 'hook' && !CM.retried) { CM.retried = true; render(); toast('提交仍被 hook 拒绝（原型：再试一次会成功）', 'warn'); return; }
      CM.st = 'done'; PS.st = PS.st === 'locked' ? 'todo' : PS.st; render(); toast(`已提交到 ${F.FIX.branch} · ${F.FIX.newSha}`, 'ok');
      if (andPush) { toast('按你的选择继续推送…', 'info'); later(500, doPush); }
    });
  }
  function doPush() {
    if (M.busy) return;
    M.busy = 'push'; render();
    later(1500, () => { M.busy = null; PS.st = 'done'; MG.st = 'todo'; render(); toast(`已推送 origin/${PS.branch}`, 'ok'); });
  }
  function doMR() {
    if (M.busy) return;
    M.busy = 'merge'; render();
    later(1300, () => { M.busy = null; MG.st = 'mr'; render(); toast(`已创建合并请求 ${F.FIX.mr}`, 'ok'); });
  }
  function doDirect() {
    DS.closeDialog('dlgMerge'); if (M.busy) return;
    M.busy = 'merge'; render();
    later(1600, () => { M.busy = null; MG.st = CFG.id === 'g56-merge-conflict' ? 'conflict' : 'merged'; render(); toast(MG.st === 'merged' ? '已合并到 feature/refund 并推送' : '合并有冲突，已取消', MG.st === 'merged' ? 'ok' : 'warn'); });
  }

  /* ---------- 21. 弹出菜单 ---------- */
  function pop(trigger, items, align) {
    closePop();
    const m = document.createElement('div'); m.className = 'pop'; m.setAttribute('role', 'menu');
    m.innerHTML = items.map((it, i) => it === '-' ? '<hr>' : it.cap ? `<div class="cap">${esc(it.cap)}</div>` : `<button class="pi" role="menuitem" data-i="${i}" ${it.dis ? 'aria-disabled="true"' : ''}>${it.icon ? I(it.icon, 'sm') : ''}<span style="min-width:0">${esc(it.label)}${it.d ? `<span class="d">${esc(it.d)}</span>` : ''}</span>${it.ck ? `<span class="ck">${I('check', 'sm')}</span>` : ''}</button>`).join('');
    document.body.appendChild(m);
    const r = trigger.getBoundingClientRect();
    m.style.top = Math.min(r.bottom + 6, innerHeight - m.offsetHeight - 60) + 'px';
    m.style.left = Math.max(8, Math.min(align === 'right' ? r.right - m.offsetWidth : r.left, innerWidth - m.offsetWidth - 8)) + 'px';
    m.addEventListener('click', (e) => { const b = e.target.closest('[data-i]'); if (!b) return; const it = items[+b.dataset.i]; if (it.dis) return; closePop(); it.run && it.run(); });
    setTimeout(() => document.addEventListener('click', offPop), 0);
    const f = m.querySelector('.pi:not([aria-disabled])'); if (f) f.focus();
  }
  function offPop(e) { const m = $('.pop'); if (m && !m.contains(e.target)) closePop(); }
  function closePop() { $$('.pop').forEach((m) => m.remove()); document.removeEventListener('click', offPop); }

  /* ---------- 22. 原型控制条 / 说明抽屉 ---------- */
  function protoBar() {
    const groups = [...new Set(STATES.map((s) => s.g))];
    const opts = groups.map((g) => `<optgroup label="${g}">${STATES.filter((s) => s.g === g).map((s) => `<option value="${s.id}" ${s.id === CFG.id ? 'selected' : ''}>${s.id.split('-')[0].toUpperCase()} · ${esc(s.label)}</option>`).join('')}</optgroup>`).join('');
    document.body.insertAdjacentHTML('beforeend', `<div class="proto-dock"></div><div class="proto" role="region" aria-label="原型控制（设计样例，非产品界面）">
      <span class="proto-tag">${I('info', 'sm')}设计样例</span>
      <label>状态<select id="pState" aria-label="切换原型状态">${opts}</select></label>
      <label>主题${DS.skinSelect()}</label><span class="proto-sep"></span>
      <button class="proto-btn" id="pSim"></button>
      <button class="proto-btn" id="pExplain">${I('help', 'sm')}说明</button></div>`);
    $('#pState').addEventListener('change', (e) => { const p = new URLSearchParams(location.search); p.set('state', e.target.value); p.set('theme', document.documentElement.dataset.skin); p.delete('skin'); if (M.paused) p.set('stream', 'paused'); else p.delete('stream'); location.search = p.toString(); });
    $('#pSim').addEventListener('click', () => { M.paused = !M.paused; updProto(); if (!M.paused) resume(); toast(M.paused ? '已暂停模拟：审查 / 修复 / 提交等进度停在当前步' : '继续模拟', 'info'); });
    $('#pExplain').addEventListener('click', (e) => { explain(); DS.openDrawer('explain', e.currentTarget); });
    updProto();
  }
  function updProto() { const b = $('#pSim'); if (b) b.innerHTML = M.paused ? `${I('play', 'sm')}模拟 · 继续` : `${I('pause', 'sm')}模拟 · 暂停`; }
  function explain() {
    $('#exT').textContent = CFG.label; $('#exId').textContent = `?state=${CFG.id} · ${CFG.mode}`;
    $('#exB').innerHTML = `<div class="ex-sec"><h3>设计意图</h3><p>${esc(CFG.intent)}</p></div>
      <div class="ex-sec"><h3>验收要点</h3><ul>${CFG.checks.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>
      <div class="ex-sec"><h3>原型开关（只改内存）</h3><div class="col">
        <div class="ex-toggle"><span class="grow">工作区有未提交改动（影响“直接合并”与页头提示）</span><button class="switch" role="switch" aria-checked="${M.dirty > 0}" data-a="x-dirty" aria-label="工作区有未提交改动"></button></div>
        <div class="ex-toggle"><span class="grow">项目配置了测试命令（影响修复确认框与校验）</span><button class="switch" role="switch" aria-checked="${M.testCmd}" data-a="x-test" aria-label="项目配置了测试命令"></button></div>
        <div class="ex-toggle"><span class="grow">GitLab 已配置</span><button class="switch" role="switch" aria-checked="${glOK()}" data-a="x-gl" aria-label="GitLab 已配置"></button></div></div></div>
      <div class="ex-sec"><h3>边界</h3><ul><li>数据全部来自 fixtures.js 的虚构样例；不调用桌面桥、网络或模型，不写浏览器存储。</li><li>界面不直接执行 git：读口 / 命令经应用服务调用内部 MCP（git / gitlab），目前都是候选接口。</li><li>浏览只读；写操作只在修复流程里出现，每步写清后果，不自动连锁；回执未知时只“核对原操作”，不重发。</li><li>布局：≥1400 三栏；1100–1399 左栏收为图标条；&lt;1100 提交列表收成抽屉。</li></ul></div>`;
  }

  /* ---------- 23. 事件 ---------- */
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-a]'); if (!b) return;
    if (b.closest('.pop')) return;
    const a = b.dataset.a, k = b.dataset.k;
    if (b.matches('input[type=checkbox]')) return; // 交给 change
    if (b.getAttribute('aria-disabled') === 'true' && a !== 'tab') return;
    if (b.tagName === 'A') e.preventDefault();
    switch (a) {
      case 'go-overview': SC.go('git/index.html?state=g01-overview'); return;
      case 'enter': { SC.go('git/index.html?state=g10-commits',{project:b.dataset.p}); return; }
      case 'proj-menu': pop(b, [{ cap: '受 Git 管理的项目' }, ...F.PROJECTS.map((p) => ({ label: p.name, d: p.mode === 'direct' ? '直接执行目录，不受 Git 管理' : p.mode === 'unavailable' ? '本机路径不可用' : p.empty ? 'main · 还没有提交' : p.branch + ' · 领先 2 · 落后 1', dis: p.mode !== 'git', ck: p.id === M.project, icon: p.mode === 'git' ? 'gitRepo' : p.mode === 'direct' ? 'folder' : 'alert', run() { M.project = p.id; M.empty = !!p.empty; M.dirty = p.dirty || 0; M.view = 'wb'; if (!p.empty) { M.commit = 'e4f5a6b'; M.left = 'commits'; } render(); } })), '-', { label: '返回仓库概览', icon: 'arrowLeft', run() { M.view = 'overview'; render(); } }]); return;
      case 'fetch': if (!glOK()) return; M.fetch = 'running'; render(); later(1300, () => { if (CFG.fetchErr) { M.fetch = 'auth'; render(); toast('仍然认证失败：请先到 设置 → GitLab 验证连接', 'warn'); return; } M.fetch = 'idle'; M.fetchedAt = '10:55'; render(); toast('已获取远端更新：没有新的提交 · 不会合并或改动工作区', 'ok'); }); return;
      case 'dismiss-fetch': M.fetch = 'idle'; render(); return;
      case 'gl-open': proto('在 GitLab 打开'); return;
      case 'settings': SC.go('main/pages/settings.html?state=gitlab'); return;
      case 'proto': proto(b.dataset.msg || '操作'); return;
      case 'left': M.left = k; M.railOpen = false; if (k !== 'commits') M.full = false; if (k === 'mrs' && !M.mr) M.mr = '!52'; render(); return;
      case 'rail-toggle': M.railOpen = !M.railOpen; render(); return;
      case 'list-toggle': M.listOpen = !M.listOpen; render(); return;
      case 'clear-filter': M.filter = { branch: 'all', author: 'all', q: '', range: 'all' }; render(); return;
      case 'filter-branch': M.filter.branch = M.filter.branch === b.dataset.b ? 'all' : b.dataset.b; render(); toast(M.filter.branch === 'all' ? '已显示全部分支' : `提交列表已筛选：${M.filter.branch}`, 'info'); return;
      case 'br-tab': M.brTab = k; render(); return;
      case 'mr-filter': M.mrFilter = k; render(); return;
      case 'mr': M.mr = M.mr === k ? null : k; render(); return;
      case 'commit': M.commit = b.dataset.sha; M.left = 'commits'; M.listOpen = false; M.note = null; M.file = null; M.parent = 1;
        if (!['files', 'review'].includes(M.tab) || (M.tab === 'fix' && !isStory())) M.tab = 'files';
        if (M.tab === 'fix' && b.dataset.sha !== 'a1b2c3d') M.tab = 'files';
        render(); scrollSelectedCommit(); return;
      case 'more': M.listState = 'loading'; render(); later(800, () => { M.older = true; M.listState = 'idle'; render(); toast('已加载 5 个更早的提交', 'ok'); }); return;
      case 'tab': if (b.getAttribute('aria-disabled') === 'true') { toast(b.title, 'info'); return; } M.tab = k; if (k !== 'files' && M.full && k !== 'fix') M.full = false; if (k === 'fix' && FX.status !== 'none') M.full = true; M.head = k === 'files' && M.head === 'open' ? 'open' : 'compact'; render(); return;
      case 'head-toggle': M.head = M.head === 'open' ? 'compact' : 'open'; render(); return;
      case 'copy-sha': copy(commitOf(M.commit).full, '完整 SHA'); return;
      case 'copy-new': copy(F.FIX.newFull, '修复提交 SHA'); return;
      case 'cd-more': pop(b, [{ label: '复制完整 SHA', icon: 'copy', run() { copy(commitOf(M.commit).full, '完整 SHA'); } }, { label: '复制提交信息', icon: 'doc', run() { copy(commitOf(M.commit).msg, '提交信息'); } }, { label: M.full ? '退出全宽' : '展开到全宽', icon: M.full ? 'collapse' : 'expand', run() { M.full = !M.full; render(); } }, '-', { label: '在 GitLab 打开', icon: 'external', dis: !glOK(), run() { proto('在 GitLab 打开'); } }, { label: '检出 / 回滚 / 拣选', icon: 'lock', d: '不在本页提供：浏览只读', dis: true }], 'right'); return;
      case 'parent': M.parent = +k; M.file = null; render(); return;
      case 'file': M.file = b.dataset.p; M.note = null; render(); { const sc = $('#dvScroll'); if (sc) sc.scrollTop = 0; } return;
      case 'fl-toggle': M.fl = !M.fl; render(); return;
      case 'file-step': { const fs = filesOf(M.commit); let i = fs.findIndex((f) => f.p === M.file) + +b.dataset.d; i = (i + fs.length) % fs.length; M.file = fs[i].p; M.note = null; render(); return; }
      case 'fx-file': FX.file = b.dataset.p; M.undoAsk = null; render(); return;
      case 'diff-mode': M.diff = k; if (k === 'split' && !M.full && innerWidth < 1800) { M.full = true; toast('并排视图需要更宽的空间，已展开到全宽 · Esc 返回', 'info'); } render(); return;
      case 'full': M.full = !M.full; render(); if (M.note) { const f = F.FINDINGS.find((x) => x.id === M.note); if (f) scrollToLine(f.from); } return;
      case 'exp': M.exp[b.dataset.k] = (M.exp[b.dataset.k] || 0) + +b.dataset.n; render(); return;
      case 'load-all': { const key = b.dataset.k; M.loading[key] = true; render(); later(900, () => { M.loading[key] = false; M.loadAll[key] = true; render(); toast('已加载全部 1,240 行', 'ok'); }); return; }
      case 'diff-retry': M.loading.diff = true; render(); later(900, () => { M.loading.diff = false; M.diffErr = false; render(); }); return;
      case 'note': M.note = M.note === b.dataset.f ? null : b.dataset.f; render(); return;
      case 'fnav': { const fds = findingsFor(M.file, false); if (!fds.length) return; let i = fds.findIndex((f) => f.id === M.note); i = (i + +b.dataset.d + fds.length) % fds.length; if (i < 0) i = 0; M.note = fds[i].id; render(); scrollToLine(fds[i].from, [fds[i].from, fds[i].to]); return; }
      case 'loc': case 'to-review': {
        const f = F.FINDINGS.find((x) => x.id === b.dataset.f);
        if (a === 'to-review') { M.tab = 'review'; render(); requestAnimationFrame(() => { const el = $('#fd-' + f.id); if (el) { el.scrollIntoView({ block: 'center' }); el.classList.add('hit'); } }); return; }
        M.tab = 'files'; M.file = f.file; M.note = f.id; M.head = 'compact'; render(); scrollToLine(f.from, [f.from, f.to]); return; }
      case 'review-open': if (M.busy && M.busy !== 'review') return; fillReviewDrawer(); DS.openDrawer('rvDrawer', b); return;
      case 'review-open-other': fillReviewDrawer(); DS.openDrawer('rvDrawer', b); return;
      case 'rs-scope': M.rset.scope = k; fillReviewDrawer(); return;
      case 'rs-parent': M.rset.parent = +k; fillReviewDrawer(); return;
      case 'rs-dim': M.rset.dims.has(k) ? M.rset.dims.delete(k) : M.rset.dims.add(k); fillReviewDrawer(); return;
      case 'rs-ctx': M.rset.ctx = k; fillReviewDrawer(); return;
      case 'review-start': if (!isStory()) { DS.closeDrawer('rvDrawer'); toast('原型只为 a1b2c3d 展开完整的审查流程（审查设置已演示）', 'info'); return; } startReview(); return;
      case 'stop-review': stopKind = 'review'; fillStopDialog(); DS.openDialog('dlgStop', b); return;
      case 'stop-fix': stopKind = 'fix'; fillStopDialog(); DS.openDialog('dlgStop', b); return;
      case 'stop-do': DS.closeDialog('dlgStop');
        if (stopKind === 'review') { RV.status = 'failed'; M.busy = null; render(); toast('审查已停止，没有生成问题', 'info'); }
        else { FX.status = 'failed'; M.busy = null; render(); toast('修复已停止，部分改动未校验', 'info'); }
        return;
      case 'task-link': toast('审查 / 修复以模板任务运行（任务 T-2087），执行详情复用节点执行详情页；原型不跳转', 'info'); return;
      case 'check-review': RV.check = 'loading'; render(); later(1100, () => { RV.check = null; RV.status = 'running'; RV.phase = 1; M.busy = 'review'; render(); toast('核对结果：审查已经在运行（10:45:02 开始），没有重复发送', 'ok'); runReviewFrom(1); }); return;
      case 'hist-menu': pop(b, [{ label: '第 2 次审查 · 今天 10:46', d: '代码评审员 修订 3 · 5 个问题', ck: M.hist === 2, run() { M.hist = 2; render(); } }, { label: '第 1 次审查 · 今天 09:40', d: '代码评审员 修订 2 · 4 个问题 · 只读', ck: M.hist === 1, run() { M.hist = 1; render(); } }]); return;
      case 'hist': M.hist = +k; render(); return;
      case 'group': M.group = k; render(); return;
      case 'fd-st': { const s = RV.fd[b.dataset.f]; if (s.st === k) { s.st = 'open'; s.why = ''; render(); return; } if (k === 'accepted') { s.st = 'accepted'; render(); return; } M.whyOpen = { f: b.dataset.f, k }; render(); requestAnimationFrame(() => { const el = $('#whyIn'); if (el) el.focus(); }); return; }
      case 'why-ok': { const w = M.whyOpen; const v = ($('#whyIn') || {}).value || ''; RV.fd[w.f] = { st: w.k, why: v.trim() }; RV.sel.delete(w.f); M.whyOpen = null; render(); toast(w.k === 'ignored' ? '已忽略，不会选入修复' : '已标为误报，会反馈给审查职业', 'info'); return; }
      case 'why-cancel': M.whyOpen = null; render(); return;
      case 'fix-open': if (!RV.sel.size) return; fillFixDialog(); DS.openDialog('dlgFix', b); return;
      case 'fix-start': startFix(); return;
      case 'close-dialog': DS.closeDialog(); return;
      case 'close-drawer': DS.closeDrawer(k); return;
      case 'out-toggle': FX.outOpen = !FX.outOpen; render(); return;
      case 'revert-ask': M.undoAsk = b.dataset.p; render(); return;
      case 'revert-cancel': M.undoAsk = null; render(); return;
      case 'revert': FX.reverted.add(b.dataset.p); CM.files.delete(b.dataset.p); M.undoAsk = null; render(); toast('已在修复分支内撤销这个文件的改动（不会提交）', 'info'); return;
      case 'unrevert': FX.reverted.delete(b.dataset.p); CM.files.add(b.dataset.p); render(); return;
      case 'commit-do': doCommit(false); return;
      case 'commit-menu': pop(b, [{ label: '提交到 ' + F.FIX.branch, d: '只新建本地提交', icon: 'commit', run() { doCommit(false); } }, { label: '提交并推送', d: '提交后立即推送到 origin（新建远端分支），仍然不会合并', icon: 'upload', dis: !glOK(), run() { doCommit(true); } }], 'right'); return;
      case 'push-do': doPush(); return;
      case 'push-fetch': M.busy = 'push'; render(); later(1100, () => { M.busy = null; PS.fetched = true; render(); }); return;
      case 'push-rename': PS.branch = ($('#psName') || {}).value || PS.branch + '-2'; PS.st = 'todo'; doPush(); return;
      case 'push-later': toast('修复提交保留在本地分支，稍后可以回来推送', 'info'); return;
      case 'push-check': PS.check = 'loading'; render(); later(1200, () => { PS.check = null; PS.st = 'done'; MG.st = 'todo'; render(); toast('核对结果：远端已有 ' + F.FIX.newSha + '，推送已成功，没有重复推送', 'ok'); }); return;
      case 'mg-open': MG.open = true; render(); return;
      case 'mg-mode': if (b.getAttribute('aria-disabled') === 'true') return; MG.mode = k; render(); return;
      case 'mg-rev': MG.reviewers.has(k) ? MG.reviewers.delete(k) : MG.reviewers.add(k); render(); return;
      case 'mr-do': doMR(); return;
      case 'direct-ask': fillMergeDialog(); DS.openDialog('dlgMerge', b); return;
      case 'direct-do': doDirect(); return;
      case 'to-mr': MG.st = 'todo'; MG.mode = 'mr'; MG.open = true; render(); return;
      case 'discard': fillDiscardDialog(); DS.openDialog('dlgDiscard', b); return;
      case 'discard-now': case 'discard-do': DS.closeDialog('dlgDiscard'); FX.status = 'none'; CM.st = 'todo'; PS.st = 'todo'; MG.st = 'todo'; FX.reverted.clear(); M.tab = 'review'; M.full = false; render(); toast(a === 'discard-now' ? '已清理修复分支（没有改动）' : '已删除本地修复分支与工作副本' + (PS.fetched ? '' : '') , 'info'); return;
      case 'x-dirty': M.dirty = M.dirty ? 0 : 3; render(); explain(); return;
      case 'x-test': M.testCmd = !M.testCmd; render(); explain(); return;
      case 'x-gl': M.gitlab = glOK() ? 'none' : 'ok'; render(); explain(); return;
      default: return;
    }
  });
  document.addEventListener('change', (e) => {
    const t = e.target; const a = t.dataset.a, inn = t.dataset.in;
    if (a === 'ws') { M.ws = t.checked; render(); toast(M.ws ? '已忽略空白：只有缩进不同的行显示为上下文' : '已显示空白改动', 'info'); return; }
    if (a === 'fd-sel') { const id = t.dataset.f; t.checked ? RV.sel.add(id) : RV.sel.delete(id); render(); return; }
    if (a === 'cm-file') { const p = t.dataset.p; t.checked ? CM.files.add(p) : CM.files.delete(p); render(); return; }
    if (a === 'cm-ack') { CM.ack = t.checked; render(); return; }
    if (inn === 'branch' || inn === 'author' || inn === 'range') { M.filter[inn] = t.value; render(); return; }
    if (inn === 'mg-target') { MG.target = t.value; render(); return; }
  });
  document.addEventListener('input', (e) => {
    const t = e.target, inn = t.dataset.in; if (!inn) return;
    if (inn === 'q') { M.filter.q = t.value; render(); return; }
    if (inn === 'cm-msg') CM.msg = t.value;
    if (inn === 'mg-title') MG.title = t.value;
    if (inn === 'mg-desc') MG.desc = t.value;
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if ($('.pop')) { closePop(); return; }
      if ($('.drawer.open') || $('.dialog.open')) return;
      if (M.railOpen || M.listOpen) { M.railOpen = M.listOpen = false; render(); return; }
      if (M.full) { M.full = false; render(); toast('已退出全宽', 'info'); return; }
    }
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && e.target.closest && e.target.closest('.cl-row')) {
      e.preventDefault(); const rows = $$('.cl-row'); const i = rows.indexOf(e.target.closest('.cl-row')); const n = rows[i + (e.key === 'ArrowDown' ? 1 : -1)];
      if (n) { M.commit = n.dataset.sha; render(); const r = $(`.cl-row[data-sha="${M.commit}"]`); if (r) r.focus(); scrollSelectedCommit(); }
    }
    if (e.key === 'Enter' && e.target.matches && e.target.matches('.ov-card[data-a="enter"], tr[data-a]')) e.target.click();
  });
  document.addEventListener('gitnav', () => { M.view = 'overview'; M.full = false; render(); });
  document.addEventListener('skinchange', () => { const dv = $('#dvScroll'); if (dv) dv.style.setProperty('--dvw', dv.clientWidth + 'px'); });
  addEventListener('resize', () => { const dv = $('#dvScroll'); if (dv) dv.style.setProperty('--dvw', dv.clientWidth + 'px'); });

  /* ---------- 24. 启动 ---------- */
  DS.mount({ header: '', proto: false });
  document.body.insertAdjacentHTML('beforeend', overlays());
  protoBar();
  render();
  // 进入状态时自动选好：抽屉 / 对话框 / 定位 / 运行中的模拟
  requestAnimationFrame(() => {
    if (CFG.drawer === 'review') { fillReviewDrawer(); DS.openDrawer('rvDrawer'); }
    if (CFG.dialog === 'fix') { fillFixDialog(); DS.openDialog('dlgFix'); }
    if (CFG.dialog === 'discard') { fillDiscardDialog(); DS.openDialog('dlgDiscard'); }
    if (CFG.focus) { const f = F.FINDINGS.find((x) => x.id === CFG.focus); scrollToLine(f.from, [f.from, f.to]); }
    if (CFG.id === 'g12-diff-unified') scrollToLine(20);
    if (CFG.id === 'g43-fix-verify-failed') { const el = $$('.fx-sec')[2]; const sc = $('#fxScroll'); if (el && sc) sc.scrollTop = el.offsetTop - 20; }
    if (CFG.focusStep) { const ta = $('#cmMsg'); if (ta) ta.scrollIntoView({ block: 'center' }); }
    if (CFG.mg === 'choose' || CFG.mg === 'conflict') { const el = $('.ns-step.cur, .ns-step.bad'); const sc = $('#nsScroll'); if (el && sc) sc.scrollTop = el.offsetTop - 60; }
    if (CFG.listErr || CFG.shallow) { const sc = $('#clScroll'); if (sc) sc.scrollTop = sc.scrollHeight; } else scrollSelectedCommit();
    if (RV.status === 'running') { M.busy = 'review'; runReviewFrom(RV.phase); }
    if (FX.status === 'running') { M.busy = 'fix'; render(); stepFix(); }
  });
})();
