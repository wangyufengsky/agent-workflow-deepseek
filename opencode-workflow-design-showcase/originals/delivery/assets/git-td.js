/* opencode-workflow · Git 仓库页 · 任务变更上下文（TD03 / TD04 / TD07）· 隔离原型
   复制自 git-workbench/prototype/assets/git.js 并改造：
   - 保留工作台外壳（页头、左栏、文件树 + diff 查看器：统一 / 并排、忽略空白、展开上下文、全宽、大文件分段、二进制、权限变更）
     与右侧步骤栏（约 400）；去掉 AI 审查 / findings / 修复流程，改为「任务变更」上下文与所选交付（提交 → 推送 → 创建 MR）。
   - 数据只来自 git-td-fixtures.js（window.GTD）；不发请求、不访问桌面桥、不写浏览器存储。所有写操作都是内存里的定时器模拟。
   - 状态由 ?state=<td03-*|td04-*|td07-*>&theme=… 选择（td-states.js 注册），返回上下文用 ?from=&fromState=。 */
(function () {
  'use strict';
  const G = window.GTD, T = G.TASK;
  const I = DS.icon, esc = DS.esc, $ = DS.$, $$ = DS.$$;

  Object.assign(DS.ICONS, {
    expand: 'M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7',
    collapse: 'M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7',
    commit: 'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM3 12h5.5M15.5 12H21',
    pr: 'M6 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 9v12M18 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 15V8a3 3 0 0 0-3-3h-4M13 2.5 10.5 5 13 7.5',
    chevUp: 'M6 15l6-6 6 6',
    unfold: 'M12 3v6M9 6l3-3 3 3M12 21v-6M9 18l3 3 3-3M4 12h16',
    rows: 'M4 5h16v14H4zM4 12h16',
    cols: 'M4 5h16v14H4zM12 5v14',
    cloud: 'M7 18a4.5 4.5 0 0 1-.6-8.96A6 6 0 0 1 18 8.5a4.5 4.5 0 0 1-.5 9.5z',
    circle: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z',
    eyeOff: 'M3 3l18 18M10.6 6.1A9.8 9.8 0 0 1 12 6c6.4 0 10 6 10 6a17 17 0 0 1-3.1 3.7M6.6 6.6C3.9 8.3 2 12 2 12s3.6 6 10 6c1.6 0 3-.4 4.3-1M9.9 9.9a3 3 0 0 0 4.2 4.2',
  });

  /* ---------- 1. 状态配置（每个 td 状态进入时如何布置画面）---------- */
  const CFG = {
    'td03-changes': {},
    'td03-excluded': { view: 'excluded' },
    'td03-large-binary': { file: 'fixtures/refunds-2026.csv' },
    'td03-leave-context': { goal: 'mr', leave: 'commits' },
    'td03-loading': { load: 'loading' },
    'td03-read-error': { load: 'error' },
    'td04-goal': { goal: 'mr', focus: 'goal' },
    'td04-commit-confirm': { goal: 'mr', dialog: 'commit' },
    'td04-commit-drift': { goal: 'mr', cm: 'drift' },
    'td04-hook-rejected': { goal: 'mr', cm: 'hook', msg: 'noref' },
    'td04-commit-only-done': { goal: 'local', cm: 'done', delivered: true },
    'td04-committed-wait-push': { goal: 'mr', cm: 'done' },
    'td04-push-confirm': { goal: 'mr', cm: 'done', dialog: 'push' },
    'td04-push-exists': { goal: 'mr', cm: 'done', ps: 'exists' },
    'td04-push-auth': { goal: 'mr', cm: 'done', ps: 'auth' },
    'td04-push-failed': { goal: 'mr', cm: 'done', ps: 'failed' },
    'td04-push-unknown': { goal: 'mr', cm: 'done', ps: 'unknown' },
    'td04-mr-confirm': { goal: 'mr', cm: 'done', ps: 'done', dialog: 'mr' },
    'td04-target-drift': { goal: 'mr', cm: 'done', ps: 'done', mr: 'drift' },
    'td04-mr-exists': { goal: 'mr', cm: 'done', ps: 'done', mr: 'exists', delivered: true },
    'td04-mr-unknown': { goal: 'mr', cm: 'done', ps: 'done', mr: 'unknown' },
    'td04-delivered': { goal: 'mr', cm: 'done', ps: 'done', mr: 'done', delivered: true },
    'td04-goal-change': { goal: 'mr', cm: 'done', dialog: 'goal' },
    'td07-mr-detail': { ctx: 'none', left: 'mrs', goal: 'mr', cm: 'done', ps: 'done', mr: 'done', delivered: true, mrSel: '!58' },
    'td07-mr-list': { ctx: 'none', left: 'mrs', goal: 'mr', cm: 'done', ps: 'done', mr: 'done', delivered: true },
    'td07-mr-closed-later': { ctx: 'none', left: 'mrs', goal: 'mr', cm: 'done', ps: 'done', mr: 'done', delivered: true, mrSel: '!58', closed: true },
  };
  let CUR = TD.init('git.html');
  const RET = TD.ret();
  const GOALS = {
    local: { t: '仅本地提交', d: '在任务分支新建 1 个提交；提交成功后由服务结算交付。不推送。', steps: ['cm'] },
    push: { t: '提交并推送', d: '提交后推送到 GitLab 的新远端分支；推送成功后结算交付。', steps: ['cm', 'ps'] },
    mr: { t: '提交、推送并创建 MR', d: '推送后创建到 main 的合并请求；MR 创建成功即交付，不等待合并。', steps: ['cm', 'ps', 'mr'] },
  };
  const STEPN = { cm: ['①', '提交'], ps: ['②', '推送'], mr: ['③', '创建 MR'] };

  /* ---------- 2. 模型 ---------- */
  const M = {
    ctx: 'task', left: 'task', leave: null, load: 'ok', tab: 'changes', view: 'diff', file: 'src/refund/service.ts',
    diff: 'unified', ws: false, full: false, exp: {}, pages: {}, loading: {}, rev: T.rev, readAt: T.readAt,
    sel: new Set(G.DEFAULT_SEL), goal: null, goalTo: 'push', cm: 'todo', ps: 'todo', mr: 'todo', delivered: false, settling: false,
    busy: null, msg: G.MSG, pushName: T.branch, newName: T.branch + '-2', nameChecked: false, conn: T.conn, connAt: T.connAt,
    mrTitle: 'feat: 退款单分页查询与导出', mrDesc: G.MR_DESC, tip: T.baseSha, tipAt: '16:14', check: null, hookN: 0,
    mrSel: null, mrFilter: 'open', closed: false, nsOpen: false, focus: null, pushKey: T.keys.push,
  };
  function applyState(id) {
    const c = CFG[id] || {};
    M.ctx = c.ctx || 'task'; M.left = c.left || (M.ctx === 'task' ? 'task' : 'commits'); M.leave = c.leave || null;
    M.load = c.load || 'ok'; M.view = c.view || 'diff'; M.tab = 'changes'; M.file = c.file || 'src/refund/service.ts';
    M.goal = c.goal || null; M.cm = c.cm || 'todo'; M.ps = c.ps || 'todo'; M.mr = c.mr || 'todo'; M.delivered = !!c.delivered;
    M.msg = c.msg === 'noref' ? G.MSG_NO_REF : G.MSG; M.mrSel = c.mrSel || null; M.closed = !!c.closed; M.focus = c.focus || null;
    M.mrFilter = c.closed ? 'all' : 'open';
    M.nsOpen = innerWidth < 1100 && /^td04-/.test(id);
  }
  applyState(CUR);

  /* ---------- 3. 小工具 ---------- */
  const toast = (m, k = 'info') => DS.toast(m, k);
  const proto = (what) => toast(`“${what}”：设计样例，不连接真实任务 / Git / GitLab，未发送任何请求`, 'info');
  function later(ms, fn) { setTimeout(fn, ms); }
  function copy(text, label) {
    const ta = document.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;left:-9999px;top:0';
    document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); } catch (e) {} ta.remove();
    toast('已复制' + label, 'ok');
  }
  const badge = (t, cls, ic, extra = '') => `<span class="badge ${cls} ${extra}">${ic ? I(ic, 'sm') : ''}${t}</span>`;
  const fileByP = (p) => G.FILES.find((f) => f.p === p);
  const steps = () => (M.goal ? GOALS[M.goal].steps : []);
  const delivHref = () => TD.href('td02-delivered', { from: 'git', fromState: CUR });
  const backHref = () => (M.delivered ? delivHref() : TD.backHref('td02-awaiting'));
  const wsHref = () => TD.href('td06-detail-git', { from: 'git', fromState: CUR });
  const selFiles = () => G.FILES.filter((f) => M.sel.has(f.p));
  const unselFiles = () => G.FILES.filter((f) => !M.sel.has(f.p));
  const amd = (fs) => ['A', 'M', 'D'].map((k) => `${k} ${fs.filter((f) => f.st === k).length}`).join(' · ');
  const selLocked = () => M.cm === 'done' || M.cm === 'busy' || M.delivered || M.load !== 'ok';
  /* 切换到另一个已登记状态（不重载页面：保留草稿；同步地址、控制条与说明） */
  function mark(id) {
    if (!TD.byId[id]) return; CUR = id;
    try { const q = TD.keep({ state: id, from: RET.from, fromState: RET.fromState }); history.replaceState(null, '', 'git.html?' + q); } catch (e) {}
    const sel = document.getElementById('tdStateSel'); if (sel) sel.value = id;
  }

  /* ---------- 4. 差异解析与渲染（沿用 git-workbench）---------- */
  const langOf = (p) => (/\.(ts|js|tsx)$/.test(p) ? 'ts' : /\.csv$/.test(p) ? 'csv' : /\.sh$/.test(p) ? 'sh' : 'txt');
  const PARSED = new Map();
  const V8 = new Map();
  function fileObj(f) { if (M.rev === 'cr-8' && f.src8) { if (!V8.has(f)) V8.set(f, Object.assign({}, f, { src: f.src8 })); return V8.get(f); } return f; }
  function parse(file) {
    if (PARSED.has(file)) return PARSED.get(file);
    const out = []; let o = 1, n = 1; const pool = G.FILLER[langOf(file.p)] || ['…']; let fi = 0;
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
  const KW = { ts: /^(import|from|export|class|const|let|var|function|async|await|return|if|else|throw|new|private|public|readonly|protected|interface|enum|type|extends|implements|for|of|in|do|while|yield|try|catch|true|false|null|undefined|this|typeof|default|number|string|boolean|any|Promise|as)\b/, sh: /^(if|then|fi|set|echo|exit|export|for|do|done)\b/ };
  function tokens(x, lang) {
    if (lang === 'txt' || lang === 'csv') return [['', x]];
    const segs = []; let i = 0; let plain = '';
    const flush = () => { if (plain) { segs.push(['', plain]); plain = ''; } };
    const cm = lang === 'sh' ? '#' : '//';
    while (i < x.length) {
      const r = x.slice(i);
      if (r.startsWith(cm)) { flush(); segs.push(['tk-c', r]); break; }
      if (lang === 'ts' && r.startsWith('/*')) { const e = r.indexOf('*/'); const s = e === -1 ? r : r.slice(0, e + 2); flush(); segs.push(['tk-c', s]); i += s.length; continue; }
      if (lang === 'ts' && /^\s*\*/.test(x) && i === 0) { flush(); segs.push(['tk-c', x]); break; }
      const q = r[0];
      if (q === "'" || q === '"' || q === '`') { let j = 1; while (j < r.length && r[j] !== q) { if (r[j] === '\\') j++; j++; } const s = r.slice(0, j + 1); flush(); segs.push(['tk-s', s]); i += s.length; continue; }
      const prev = x[i - 1] || ' ';
      if (/[A-Za-z_$@0-9]/.test(prev)) { plain += r[0]; i++; continue; }
      let m;
      if (lang === 'ts' && (m = r.match(/^@\w+/))) { flush(); segs.push(['tk-d', m[0]]); i += m[0].length; continue; }
      if ((m = r.match(/^\d[\d_]*(\.\d+)?\b/))) { flush(); segs.push(['tk-n', m[0]]); i += m[0].length; continue; }
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
  const FN_RE = /^\s*(export\s+)?(default\s+)?(async\s+)?(function|class|interface|describe|it\(|(private|public|protected)?\s*(async\s+)?[A-Za-z_]\w*\s*\([^)]*\)\s*(:\s*[^{]+)?\{)/i;
  function fnCtx(lines, idx) { for (let i = idx - 1; i >= 0; i--) { const t = lines[i].x; if (FN_RE.test(t) && !/^\s*(if|for|while|return)\b/.test(t)) return t.trim().slice(0, 60); } return ''; }
  function blocks(lines, key) {
    const CTX = 3, vis = lines.map((l) => l.t !== ' ');
    if (!vis.some(Boolean)) return [{ vis: true, from: 0, to: lines.length }];
    lines.forEach((l, i) => { if (l.t !== ' ') for (let k = Math.max(0, i - CTX); k <= Math.min(lines.length - 1, i + CTX); k++) vis[k] = true; });
    const segs = []; let i = 0, gi = 0;
    while (i < lines.length) {
      const v = vis[i]; let j = i; while (j < lines.length && vis[j] === v) j++;
      if (v) segs.push({ vis: true, from: i, to: j }); else segs.push({ vis: false, from: i, to: j, gi: gi++ });
      i = j;
    }
    const out = [];
    segs.forEach((s, k) => {
      if (s.vis) { out.push({ vis: true, from: s.from, to: s.to }); return; }
      const size = s.to - s.from, r = Math.min(size, M.exp[key + ':' + s.gi] || 0), last = k === segs.length - 1;
      if (size <= 4 || r >= size) { out.push({ vis: true, from: s.from, to: s.to }); return; }
      if (last) { if (r) out.push({ vis: true, from: s.from, to: s.from + r }); out.push({ vis: false, from: s.from + r, to: s.to, gi: s.gi, last: true }); }
      else { out.push({ vis: false, from: s.from, to: s.to - r, gi: s.gi }); if (r) out.push({ vis: true, from: s.to - r, to: s.to }); }
    });
    const merged = []; out.forEach((s) => { const p = merged[merged.length - 1]; if (p && p.vis && s.vis) p.to = s.to; else merged.push(Object.assign({}, s)); });
    return merged;
  }
  const SEG = 400;
  function diffTable(file, key) {
    const lines = withWs(parse(file), M.ws); const lang = langOf(file.p);
    const hl = intraPairs(lines); const split = M.diff === 'split';
    const pages = M.pages[key] || 1; const LIMIT = SEG * pages;
    const segs = blocks(lines, key); let rows = 0, html = '', pending = null, more = false;
    const total = segs.filter((s) => s.vis).reduce((a, s) => a + (s.to - s.from), 0);
    const code = (l) => hlHTML(l.x, lang, hl.get(l));
    const expBtns = (g) => { const size = g.to - g.from; return `<span class="exp"><button data-a="exp" data-k="${esc(key)}:${g.gi}" data-n="20">${I(g.last ? 'chevDown' : 'chevUp', 'sm')}展开 20 行</button><span class="m">·</span><button data-a="exp" data-k="${esc(key)}:${g.gi}" data-n="9999">全部 ${size.toLocaleString()} 行</button><span class="m">${g.last ? '文件末尾未改动' : '未改动'}</span></span>`; };
    const gut = (g) => g ? `<span class="g"><button data-a="exp" data-k="${esc(key)}:${g.gi}" data-n="20" title="展开 20 行" aria-label="展开 20 行">${I(g.last ? 'chevDown' : 'chevUp', 'sm')}</button><button data-a="exp" data-k="${esc(key)}:${g.gi}" data-n="9999" title="展开全部 ${g.to - g.from} 行" aria-label="展开全部">${I('unfold', 'sm')}</button></span>` : '<span class="g"></span>';
    segs.forEach((s) => {
      if (file.large && rows >= LIMIT) { more = true; return; }
      if (!s.vis) { if (s.last) html += `<div class="dh">${gut(s)}<span class="dh-in">${expBtns(s)}</span></div>`; else pending = s; return; }
      const blk = lines.slice(s.from, s.to); const os = blk.find((l) => l.o != null), ns = blk.find((l) => l.n != null);
      const oc = blk.filter((l) => l.o != null).length, nc = blk.filter((l) => l.n != null).length;
      html += `<div class="dh">${gut(pending)}<span class="dh-in">${pending ? expBtns(pending) + '<span class="vsep"></span>' : ''}<span class="txt"><b>@@ -${os ? os.o : 0},${oc} +${ns ? ns.n : 0},${nc} @@</b>  ${esc(fnCtx(lines, s.from))}</span></span></div>`;
      pending = null;
      if (!split) {
        for (let i = s.from; i < s.to; i++) {
          if (file.large && rows >= LIMIT) { more = true; break; }
          const l = lines[i]; rows++;
          const cls = l.t === '+' ? 'add' : l.t === '-' ? 'del' : 'ctx';
          html += `<div class="dl ${cls}"><span class="ln o">${l.o ?? ''}</span><span class="ln n">${l.n ?? ''}</span><span class="mk"></span><span class="cx"><span class="sg">${l.t === ' ' ? ' ' : l.t === '-' ? '−' : '+'}</span>${code(l)}</span></div>`;
        }
      } else {
        let i = s.from;
        while (i < s.to) {
          if (file.large && rows >= LIMIT) { more = true; break; }
          const l = lines[i];
          if (l.t === ' ') { rows++; html += `<div class="dl ctx"><span class="ln">${l.o}</span><span class="mk"></span><span class="cx l">${code(l)}</span><span class="ln r">${l.n}</span><span class="mk"></span><span class="cx">${code(l)}</span></div>`; i++; continue; }
          const d = []; while (i < s.to && lines[i].t === '-') d.push(lines[i++]);
          const a = []; while (i < s.to && lines[i].t === '+') a.push(lines[i++]);
          for (let k = 0; k < Math.max(d.length, a.length); k++) {
            rows++; const L = d[k], R = a[k];
            html += `<div class="dl">${L ? `<span class="ln s-del">${L.o}</span><span class="mk s-del"></span><span class="cx l s-del">${hlHTML(L.x, lang, hl.get(L))}</span>` : '<span class="ln s-emp"></span><span class="mk s-emp"></span><span class="cx l s-emp"></span>'}
              ${R ? `<span class="ln r s-add">${R.n}</span><span class="mk s-add"></span><span class="cx s-add">${hlHTML(R.x, lang, hl.get(R))}</span>` : '<span class="ln r s-emp"></span><span class="mk s-emp"></span><span class="cx s-emp"></span>'}</div>`;
          }
        }
      }
    });
    let top = '', tail = '';
    if (file.large) {
      const nSeg = Math.max(1, Math.ceil(total / SEG)); const shown = Math.min(total, LIMIT);
      top = `<div class="dv-seg top">${I('layers', 'sm')}<span class="grow">大文件 · ${file.size} · 分段读取：第 ${Math.min(pages, nSeg)} 段 / 共 ${nSeg} 段，已显示 ${shown.toLocaleString()} / ${total.toLocaleString()} 行改动。其余内容尚未读取。</span></div>`;
      tail = more ? `<div class="dv-seg">${I('layers', 'sm')}<span class="grow">已显示前 ${shown.toLocaleString()} 行（第 ${pages} 段 / 共 ${nSeg} 段）。读取下一段只读取差异，不改变文件或选择。</span><button class="btn secondary sm" data-a="seg-next" data-k="${esc(key)}" ${M.loading[key] ? 'disabled' : ''}>${M.loading[key] ? '<span class="spin"></span>读取中…' : I('download', 'sm') + '读取下一段'}</button></div>`
        : `<div class="dv-seg">${I('check', 'sm')}<span class="grow">已读取全部 ${nSeg} 段 · ${total.toLocaleString()} 行改动</span></div>`;
    }
    return `<div class="dv-t ${split ? 'split' : ''} ${file.large ? 'wide-ln' : ''}">${top}${html}${tail}</div>`;
  }
  function diffView(file) {
    file = fileObj(file);
    const key = M.rev + ':' + file.p;
    const files = G.FILES; const fi = files.findIndex((f) => f.p === file.p);
    const unsel = !M.sel.has(file.p);
    const bar = `<div class="dv-bar"><span class="fnav" style="padding-left:8px">${fi + 1} / ${files.length}<button class="icon-btn" data-a="file-step" data-d="-1" aria-label="上一个文件">${I('chevUp', 'sm')}</button><button class="icon-btn" data-a="file-step" data-d="1" aria-label="下一个文件">${I('chevDown', 'sm')}</button></span>
      <div class="dv-path"><span class="fst ${file.st}" title="${{ A: '新增', M: '修改', D: '删除' }[file.st]}">${file.st}</span><span class="p" title="${esc(file.p)}"><bdi>${esc(file.p)}</bdi></span>
        ${file.binary || file.mode ? '' : `<span class="add-n" style="font-size:12px">+${(parse(file), file.add).toLocaleString()}</span><span class="del-n" style="font-size:12px">−${file.del}</span>`}
        ${unsel ? badge('未选 · 留在工作区', 'st-idle mini-badge') : ''}${M.rev === 'cr-8' && file.src8 ? badge('16:04 有改动', 'st-fail mini-badge', 'alert') : ''}</div>
      <div class="dv-tools">
        <div class="seg" role="group" aria-label="差异视图"><button aria-pressed="${M.diff === 'unified'}" data-a="diff-mode" data-k="unified">${I('rows', 'sm')}统一</button><button aria-pressed="${M.diff === 'split'}" data-a="diff-mode" data-k="split">${I('cols', 'sm')}并排</button></div>
        <label class="chk" title="忽略只有空白不同的改动"><input type="checkbox" data-a="ws" ${M.ws ? 'checked' : ''}>忽略空白</label>
        <button class="icon-btn" data-a="full" title="${M.full ? '退出全宽（Esc）' : '全宽阅读（收起交付步骤）'}" aria-label="${M.full ? '退出全宽' : '全宽阅读'}">${I(M.full ? 'collapse' : 'expand', 'sm')}</button></div></div>`;
    let body;
    if (file.binary) body = `<div class="dv-msg"><span class="tile">${I('file', 'lg')}</span><h3>二进制文件，不显示差异</h3><p>新增 · ${file.binary.after}。原型不预览表格内容；交付时按整文件处理。</p><dl class="facts-mini"><dt>内容标识</dt><dd>${file.ident}（诊断）</dd><dt>本次选择</dt><dd style="font-family:var(--font)">${unsel ? '未选：提交后留在任务工作区' : '已选：随提交交付'}</dd></dl></div>`;
    else if (file.mode) body = `<div class="dv-msg"><span class="tile">${I('lock', 'lg')}</span><h3>权限变更 · 内容未改动</h3><p><span class="mono">${file.mode[0]}</span> → <span class="mono">${file.mode[1]}</span>（加上了可执行权限）</p></div>`;
    else body = diffTable(file, key);
    return `<div class="dv">${bar}<div class="dv-scroll" id="dvScroll" data-sk="dv:${esc(key)}">${body}</div></div>`;
  }

  /* ---------- 5. 页头 + 上下文条 ---------- */
  function header() {
    const mock = `<span class="td-mock" title="合成数据，不连接真实任务、Git、GitLab、目录或模型">${I('info', 'sm')}设计样例 · 合成数据，不连接任务 / Git / 目录</span>`;
    const gl = `<button class="icon-btn" data-a="gl-open" aria-label="在 GitLab 打开项目" title="在 GitLab 打开 ${T.host}/${T.gitlab}">${I('external')}</button>`;
    if (M.ctx === 'task') return `<nav class="crumbs" aria-label="位置"><a href="#" data-a="crumb" data-k="commits">Git 仓库</a><span class="sep">/</span><a href="#" data-a="crumb" data-k="commits">${esc(T.project)}</a><span class="sep">/</span><span class="cur" title="任务变更 · ${esc(T.name)}">任务变更 · ${esc(T.name)}</span></nav><span class="spacer"></span>${mock}${gl}`;
    const tail = M.left === 'mrs' ? (M.mrSel ? `合并请求 ${M.mrSel}` : '合并请求') : M.left === 'branches' ? '分支' : '提交';
    return `<nav class="crumbs" aria-label="位置"><a href="#" data-a="proto" data-msg="Git 仓库概览">Git 仓库</a><span class="sep">/</span><span>${esc(T.project)}</span><span class="sep">/</span><span class="cur">${tail}</span></nav>
      <span class="chip gh-branch" title="原工作区当前分支">${I('gitRepo', 'sm')}main</span><span class="gh-dirty" title="原工作区有 ${T.origDirty} 个未提交改动（只读提示，不受任务影响）">${I('edit', 'sm')}<span class="num">${T.origDirty}</span><span class="t">个未提交改动</span></span>
      <span class="spacer"></span>${mock}${gl}`;
  }
  function ctxBar() {
    const nsN = M.delivered ? '已交付' : M.goal ? GOALS[M.goal].steps.filter((s) => M[s] !== 'done').length + ' 步待完成' : '未选目标';
    return `<div class="ctx-bar" role="region" aria-label="任务上下文">
      <span class="ctx-tag" title="任务 ${T.id} · 执行 ${T.exec} · ${T.flow}">${I('target', 'sm')}任务变更 · ${T.id}</span>
      <span class="ctx-i"><span class="k">任务分支</span><span class="v mono">${T.branch}</span><button class="icon-btn" data-a="copy" data-v="${T.branch}" data-l="任务分支名" aria-label="复制任务分支名" title="复制">${I('copy', 'sm')}</button></span>
      <span class="ctx-i"><span class="k">基线</span><span class="v mono" title="完整 SHA 在诊断中复制">${T.base} @ ${T.baseSha}</span><button class="icon-btn" data-a="copy" data-v="${T.baseFull}" data-l="基线完整 SHA（诊断）" aria-label="复制基线完整 SHA" title="复制完整 SHA（诊断）">${I('copy', 'sm')}</button></span>
      <span class="ctx-i"><span class="k">工作区</span><span class="v" title="${esc(T.wsPath)}">${esc(T.ws)}</span><button class="icon-btn" data-a="copy" data-v="${esc(T.wsPath)}" data-l="工作区显示路径" aria-label="复制工作区显示路径" title="复制显示路径 ${esc(T.wsPath)}">${I('copy', 'sm')}</button></span>
      <span class="ctx-i"><span class="k">快照</span><span class="v mono">${M.rev}</span><span class="hint">读取于 ${M.readAt}</span><button class="icon-btn" data-a="reread" aria-label="重新读取任务变更" title="重新读取（只读）" ${M.busy || M.load === 'loading' ? 'disabled' : ''}>${I('refresh', 'sm')}</button></span>
      <span class="ctx-act"><button class="btn ghost sm ns-tog" data-a="ns-toggle" aria-expanded="${M.nsOpen}">${I('panel', 'sm')}交付步骤 · ${nsN}</button>
      <a class="btn secondary sm" href="${backHref()}" data-a="back">${I('arrowLeft', 'sm')}返回任务</a></span></div>`;
  }

  /* ---------- 6. 左栏：任务文件树 / 普通模式 ---------- */
  function seg() {
    return `<div class="tr-top"><div class="seg rail-seg" role="tablist" aria-label="左栏内容">${[['task', '任务变更'], ['commits', '提交'], ['branches', '分支'], ['mrs', '合并请求']].map(([k, l]) => `<button role="tab" aria-selected="${M.left === k}" data-a="left" data-k="${k}">${l}</button>`).join('')}</div></div>`;
  }
  function tree() {
    if (M.ctx !== 'task') return plainRail();
    if (M.load !== 'ok') return `<aside class="wb-rail tr-col" aria-label="任务变更文件">${seg()}<div class="tr-h"><span>${M.load === 'loading' ? '正在读取文件列表…' : '文件列表未读取'}</span></div><div class="tr-list">${M.load === 'loading' ? [70, 55, 80, 60, 75, 50, 65].map((w) => `<div class="skel skel-row" style="width:${w}%"></div>`).join('') : `<div class="empty" style="padding:28px 10px"><p style="font-size:12.5px">读取失败时不显示旧的文件列表，避免基于过期版本选择。</p></div>`}</div></aside>`;
    const groups = {}; G.FILES.forEach((f) => { const d = f.p.slice(0, f.p.lastIndexOf('/')); (groups[d] = groups[d] || []).push(f); });
    const lock = selLocked();
    const tot = G.FILES.reduce((a, f) => { if (f.src) { const o = fileObj(f); parse(o); return [a[0] + o.add, a[1] + o.del]; } return a; }, [0, 0]);
    const all = M.sel.size === G.FILES.length;
    const lockWhy = M.delivered ? '已交付，选择已锁定' : M.cm === 'done' ? '已提交，选择已锁定（不能再增减文件）' : M.cm === 'busy' ? '提交进行中' : '';
    const rows = Object.keys(groups).sort().map((d) => `<div class="fl-dir" title="${esc(d)}">${I('folder', 'sm')}${esc(d)}/</div>${groups[d].map((f) => {
      const on = M.sel.has(f.p); const o = fileObj(f); if (o.src) parse(o);
      const name = f.p.slice(f.p.lastIndexOf('/') + 1); const cur = M.view === 'diff' && M.tab === 'changes' && M.file === f.p;
      return `<div class="tr-i ${on ? '' : 'unsel'}" aria-current="${cur}"><input type="checkbox" data-a="sel" data-p="${esc(f.p)}" ${on ? 'checked' : ''} ${lock ? `disabled title="${lockWhy}"` : ''} aria-label="交付整个文件 ${esc(f.p)}">
        <button class="tr-b" data-a="file" data-p="${esc(f.p)}" title="${esc(f.p)}"><span class="fst ${f.st}" aria-label="${{ A: '新增', M: '修改', D: '删除' }[f.st]}">${f.st}</span><span class="nm">${esc(name)}</span>${M.rev === 'cr-8' && f.src8 ? '<span class="chg" title="16:04 有改动（cr-8）"></span>' : ''}
        <span class="ct">${f.binary ? '<span class="muted">二进制</span>' : f.mode ? '<span class="muted">权限</span>' : `<span class="add-n">+${o.add.toLocaleString()}</span><span class="del-n">−${o.del}</span>`}</span></button></div>`;
    }).join('')}`).join('');
    return `<aside class="wb-rail tr-col" aria-label="任务变更文件">${seg()}
      <div class="tr-h"><label title="${lockWhy || '整文件选择'}"><input type="checkbox" data-a="sel-all" ${all ? 'checked' : ''} ${lock ? 'disabled' : ''} aria-label="全选交付文件">已选 ${M.sel.size} / ${G.FILES.length}</label><span class="mono"><span class="add-n">+${tot[0].toLocaleString()}</span> <span class="del-n">−${tot[1]}</span></span></div>
      <div class="tr-list" data-sk="tree">${rows}</div>
      <button class="tr-ex" data-a="excluded" aria-pressed="${M.view === 'excluded'}">${I('eyeOff', 'sm')}<span class="grow">未纳入 ${G.EXCLUDED.length} 项<small>构建产物 · 忽略规则 · 工具生成</small></span>${I('chevRight', 'sm')}</button>
      <div class="tr-note">${I('info', 'sm')}<span>整文件选择，不提供片段暂存；查看 diff 不会改变选择。原工作区 main 的 ${T.origDirty} 个未提交改动不受影响。</span></div></aside>`;
  }
  function plainRail() {
    let body = '';
    if (M.left === 'mrs') {
      const c = (k) => G.MRS.filter((m) => mrMatch(m, k)).length;
      body = `<div class="rail-sec"><div class="cap"><span>合并请求 · GitLab</span></div>${[['open', '打开中'], ['merged', '已合并'], ['closed', '已关闭'], ['all', '全部']].map(([k, l]) => `<button class="rail-stat" aria-pressed="${M.mrFilter === k}" data-a="mr-filter" data-k="${k}">${l}<span class="num">${c(k)}</span></button>`).join('')}</div>
        <div class="rail-note">${I('eye', 'sm')}<span>只读：评审、审批与合并都在 GitLab 中完成；刷新只重新读取。</span></div>`;
    } else if (M.left === 'branches') body = `<div class="rail-note">${I('eye', 'sm')}<span>分支表只读：不检出、新建或删除分支。任务分支由系统生成，在任务工作区里检出。</span></div>`;
    else body = `<div class="rail-note">${I('eye', 'sm')}<span>普通提交历史（main）。提交详情沿用原 Git 工作台，本原型只列出摘要。</span></div>`;
    return `<aside class="wb-rail tr-col" aria-label="Git 浏览">${seg()}<div class="rail-body">
      <div class="ret-card"><span><b>任务 ${T.id} · ${esc(T.name)}</b><br>${M.delivered ? '已交付（10-15 16:20）' : '待交付'}。文件选择与提交信息草稿保留在该任务下。</span><button class="btn secondary sm" data-a="left" data-k="task">${I('target', 'sm')}回到任务变更</button></div>
      ${body}</div></aside>`;
  }

  /* ---------- 7. 中栏：任务头 + 页签 + diff / 未纳入 / 验证与成果 ---------- */
  function center() {
    const fullBar = M.full ? `<div class="full-bar">${I('expand', 'sm')}<span>全宽阅读 · 交付步骤已收起</span><span class="grow"></span><span class="kbd">Esc</span><button class="btn ghost sm" data-a="full">${I('collapse', 'sm')}退出全宽</button></div>` : '';
    const st = M.delivered ? badge('任务已交付', 'st-ok', 'check') : badge('执行已结束 · 等待交付', 'st-wait', 'clock');
    const vf = badge('单元测试 41/41 · lint · 回归 · 人工验收通过', 'st-ok mini-badge', 'check');
    const head = `<div class="tc-head"><div class="row wrap" style="gap:8px"><h2 class="tc-title">${esc(T.name)}</h2><span class="badge outline mono" style="font-size:11.5px">${T.id}</span>${st}</div>
      <div class="tc-meta"><span>${G.FILES.length} 个文件 · ${amd(G.FILES)}</span><span class="sep"></span><span>验证</span>${vf}</div></div>`;
    const tabs = `<div class="tabs cd-tabs" role="tablist">${[['changes', '任务变更', G.FILES.length], ['results', '验证与成果', '']].map(([k, l, n]) => `<button class="tab" role="tab" aria-selected="${M.tab === k}" data-a="tab" data-k="${k}">${l}${n !== '' ? `<span class="n">${n}</span>` : ''}</button>`).join('')}<span class="grow"></span><span class="kbd-hint">${I('lock', 'sm')}浏览只读 · 不显示 AI 审查</span></div>`;
    let pane;
    if (M.load === 'loading') pane = `<div class="tc-scroll"><div class="tc-pad">${[90, 60, 80, 70, 40, 85, 55].map((w) => `<div class="skel" style="height:16px;width:${w}%"></div>`).join('')}<p class="hint" style="display:flex;gap:6px;align-items:center"><span class="spin"></span>正在读取任务变更 ${M.rev}：文件列表 → 差异。读取只读，不会改动任务工作区。</p></div></div>`;
    else if (M.load === 'error') pane = `<div class="tc-scroll"><div class="tc-pad"><div class="banner danger">${I('alert')}<div><b>读取任务变更失败</b><br>任务服务没有在 15 秒内返回 ${M.rev} 的文件列表（读取超时）。这是读取失败，没有发生任何写操作；交付步骤在重新读取成功前暂停，已选文件与提交信息草稿保留。</div><div class="actions"><button class="btn secondary sm" data-a="reread">${I('refresh', 'sm')}重新读取</button></div></div>
      <div class="lockline">${I('info', 'sm')}<span>如果再次失败，可以「返回任务」查看工作区状态；不会因为读取失败而判断“没有变更”。</span></div></div></div>`;
    else if (M.tab === 'results') pane = resultsView();
    else if (M.view === 'excluded') pane = excludedView();
    else pane = diffView(fileByP(M.file));
    return `<section class="wb-detail tc" aria-label="任务变更">${fullBar}${head}${tabs}<div class="cd-pane">${pane}</div></section>`;
  }
  function excludedView() {
    return `<div class="tc-scroll" data-sk="ex"><div class="tc-pad">
      <div class="row" style="gap:10px"><div class="grow"><div class="section-title">未纳入的文件</div><div class="hint">服务扫描任务工作区时按项目忽略规则排除；不进入交付、不会被提交，也不会被清理。</div></div><button class="btn ghost sm" data-a="view-diff">${I('arrowLeft', 'sm')}回到文件差异</button></div>
      <section class="card" style="overflow:hidden">${G.EXCLUDED.map((x) => `<div class="ex-row"><span class="tile" style="width:28px;height:28px;border-radius:8px">${I(x.hidden ? 'lock' : 'folder', 'sm')}</span>
        <div style="min-width:0"><div class="p">${esc(x.p)}</div><div class="r">${esc(x.rule)}</div></div><span class="row" style="gap:6px">${badge(x.kind, x.hidden ? 'st-fail mini-badge' : 'st-idle mini-badge')}<span class="hint" style="white-space:nowrap">${x.count}</span></span>
        <div class="d">${esc(x.note)}${x.hidden ? `<div><span class="ex-hidden">${I('eyeOff', 'sm')}内容不显示 · 服务不读取</span></div>` : ''}</div></div>`).join('')}</section>
      <div class="lockline">${I('info', 'sm')}<span>需要交付其中的文件时，先调整项目的忽略规则，再重新读取任务变更；本页不能把未纳入文件加入交付，也不提供“全部加入”。</span></div></div></div>`;
  }
  function resultsView() {
    const R = G.RESULTS;
    return `<div class="tc-scroll" data-sk="res"><div class="tc-pad">
      <section class="card"><div class="card-head" style="padding:12px 16px"><div class="grow"><div class="section-title" style="font-size:14px">任务目标</div><div class="hint">来自计划确认 · 10-15 09:50</div></div></div><p style="padding:12px 16px 14px;font-size:13.5px;line-height:1.75;color:var(--ink-2)">${esc(R.goal)}</p></section>
      <section class="card"><div class="card-head" style="padding:12px 16px"><div class="grow"><div class="section-title" style="font-size:14px">验证</div><div class="hint">在任务工作区一致快照上运行 · 结果由任务服务记录</div></div><button class="btn ghost sm" data-a="proto" data-msg="查看验证日志（任务页）">${I('terminal', 'sm')}查看验证日志</button></div>
        <div class="vf-grid">${R.verify.map(([k, v, c, s]) => `<div><div class="k">${k}</div><div class="v" style="color:var(--${c})">${I('check', 'sm')}${v}</div><div class="s">${s}</div></div>`).join('')}</div></section>
      <section class="card" style="overflow:hidden"><div class="card-head" style="padding:12px 16px"><div class="grow"><div class="section-title" style="font-size:14px">节点成果</div><div class="hint">节点保留各自真实状态；并行写节点在子工作区执行后由服务汇合</div></div></div>
        ${R.nodes.map(([n, r, s, d]) => `<div class="res-node"><span class="t"><span>${n}</span><span class="hint">${r}</span></span>${badge(s, 'st-ok mini-badge', 'check')}<span class="d">${esc(d)}</span></div>`).join('')}</section>
      <section class="card"><div class="card-head" style="padding:12px 16px"><div class="grow"><div class="section-title" style="font-size:14px">验收标准</div><div class="hint">人工验收：张伟 · 15:52 通过</div></div></div><ul class="acc-list">${R.accept.map((a) => `<li>${I('check', 'sm')}<span>${esc(a)}</span></li>`).join('')}</ul></section>
      <p class="hint" style="display:flex;gap:6px;align-items:center">${I('info', 'sm')}普通任务交付不要求 AI 审查，也不显示审查问题对照。</p></div></div>`;
  }

  /* ---------- 8. 右栏：完成目标 · 步骤卡 · 交付状态 ---------- */
  function nsCol() {
    const x = `<button class="icon-btn ns-x" data-a="ns-toggle" aria-label="收起交付步骤" title="收起">${I('x', 'sm')}</button>`;
    const head = `<div class="ns-h"><span class="t">交付</span><span class="hint">选择完成目标 · 每步单独确认</span>${x}</div>`;
    if (M.load !== 'ok') return `<aside class="ns-col" id="nsCol" aria-label="交付"><div class="ns">${head}<div class="ns-placeholder">${I('lock', 'sm')}<span>${M.load === 'loading' ? '读取任务变更完成前不能选择文件或执行交付步骤。' : '任务变更读取失败：交付步骤暂停。重新读取成功后继续，草稿保留。'}</span></div></div></aside>`;
    return `<aside class="ns-col" id="nsCol" data-sk="ns" aria-label="交付"><div class="ns">${head}
      ${M.delivered ? deliveredCard() : ''}${goalSection()}${selSummary()}${stepCards()}${statusCard()}</div></aside>`;
  }
  function chain(g) { return `<span class="chain">${GOALS[g].steps.map((s, i) => `${i ? I('arrowRight', 'sm') : ''}<span>${STEPN[s][0]} ${STEPN[s][1]}</span>`).join('')}</span>`; }
  function goalSection() {
    const started = M.cm === 'done' || M.delivered;
    if (started) {
      return `<div class="goal-row" id="goalSec">${I('target', 'sm')}<span>完成目标 <b>${GOALS[M.goal].t}</b></span>
        <button class="btn ghost sm" data-a="goal-change" ${M.delivered || M.busy ? `disabled title="${M.delivered ? '已交付：交付记录不再改变' : '写操作进行中'}"` : ''}>改变目标…</button></div>`;
    }
    return `<section class="goal" id="goalSec" aria-labelledby="goalT"><div class="label" id="goalT" style="font-size:12.5px">完成目标 <span class="opt">三选一 · 依赖完整</span></div>
      <div class="rcards" role="radiogroup" aria-labelledby="goalT">${Object.keys(GOALS).map((k) => `<button class="rcard2" role="radio" aria-checked="${M.goal === k}" data-a="goal" data-k="${k}" ${M.busy ? 'aria-disabled="true"' : ''}><span class="rd"></span><span style="min-width:0"><span class="t">${GOALS[k].t}</span><span class="d" style="display:block">${GOALS[k].d}</span>${chain(k)}</span></button>`).join('')}</div>
      <div class="lockline">${I('info', 'sm')}<span><b>选择目标不会自动执行任何步骤。</b>提交、推送、创建 MR 各自单独确认；前一步成功只记为已成功，所选目标全部成功后任务才交付。</span></div></section>`;
  }
  function selSummary() {
    const un = unselFiles();
    return `<div class="sel-sum"><div><b>已选 ${M.sel.size} 个文件</b>（${amd(selFiles())}）· 未选 ${un.length} 个</div>
      ${un.length ? `<div class="un">${un.map((f) => `<div><span class="fst ${f.st}">${f.st}</span><span class="p" title="${esc(f.p)}">${esc(f.p)}</span></div>`).join('')}</div>` : ''}
      <div class="hint">完成后仍留在任务工作区：未选的 ${un.length} 个文件、未纳入的 ${G.EXCLUDED.length} 项（dist/、.env.local、coverage/）。不会被提交，也不会被自动清理。</div></div>`;
  }
  function stepCards() {
    if (!M.goal) return `<div class="ns-placeholder">${I('arrowUp', 'sm')}<span>先选择完成目标，这里会按目标列出需要的步骤（① 提交 · ② 推送 · ③ 创建 MR），每步有自己的表单与确认。</span></div>`;
    return steps().map((s) => ({ cm: stepCommit, ps: stepPush, mr: stepMR })[s]()).join('');
  }
  const stepHead = (cls, no, t, s, right = '') => `<div class="ns-sh"><span class="ns-no">${cls === 'done' ? I('check') : cls === 'bad' ? I('x') : cls === 'unk' ? '?' : no}</span><span class="ns-tt"><span class="t">${t}</span><span class="s">${s}</span></span>${right}</div>`;
  function stepCommit() {
    const n = M.sel.size;
    if (M.cm === 'done') return `<div class="ns-step done">${stepHead('done', 1, '已提交到任务分支', `dev-zhang · ${T.times.commit} · ${n} 个文件 · 回执 ${T.keys.commit}`, `<button class="sha" data-a="copy" data-v="${T.newFull}" data-l="提交完整 SHA" title="复制完整 SHA">${T.newSha}</button>`)}</div>`;
    const busy = M.cm === 'busy';
    let bn = '';
    if (M.cm === 'drift') bn = `<div class="banner warn">${I('alert', 'sm')}<div><b>确认的文件版本已变化，没有提交</b><br>你确认的是 ${T.rev}；提交前服务核对发现 <span class="mono">src/refund/service.ts</span> 在 16:04 被修改（任务工作区内，非本页面）。为避免提交你没看过的内容，这次提交已停止，不会静默采用新版本。提交信息与文件选择草稿已保留。</div></div>`;
    if (M.cm === 'reviewed') bn = `<div class="banner info">${I('info', 'sm')}<div><b>已读取新版本 cr-8</b> · <span class="mono">src/refund/service.ts</span> 新增 2 行注释（16:04）。请在左侧复核后重新确认提交；确认框会显示新版本。</div></div>`;
    if (M.cm === 'hook') bn = `<div class="banner danger">${I('alert', 'sm')}<div style="min-width:0"><b>提交被 commit-msg hook 拒绝</b><br>原请求 ${M.hookN ? 'op-commit-77e2' : 'op-commit-77e1'} 明确失败，任务分支没有新提交。按输出修改提交信息后，可以发起新的提交确认；不提供跳过 hook。输出已脱敏：<pre class="tout">${esc(G.HOOK_OUT)}</pre></div></div>`;
    const noRef = M.cm === 'hook' && !/Refs:\s*SHOP-\d+/.test(M.msg);
    const dis = !n || busy || M.cm === 'drift' || !!M.busy;
    const why = !n ? '至少选择 1 个文件' : M.cm === 'drift' ? '先复核变更' : noRef ? '提交信息仍缺少 Refs' : '';
    const files = `<div class="ns-files">${G.FILES.map((f) => `<label class="${M.sel.has(f.p) ? '' : 'off'}"><input type="checkbox" data-a="sel" data-p="${esc(f.p)}" ${M.sel.has(f.p) ? 'checked' : ''} ${busy ? 'disabled' : ''} aria-label="交付整个文件 ${esc(f.p)}"><span class="fst ${f.st}">${f.st}</span><span class="ellipsis">${esc(f.p)}</span></label>`).join('')}</div>`;
    return `<div class="ns-step ${M.cm === 'hook' || M.cm === 'drift' ? 'bad' : 'cur'}" id="stepCm">${stepHead(M.cm === 'hook' || M.cm === 'drift' ? 'bad' : 'cur', 1, '提交', `在 ${T.branch} 新建 1 个提交`)}
      <div class="ns-b">${bn}
        <div class="field"><span class="label">已选文件 <span class="opt">${n} / ${G.FILES.length} · 整文件</span></span>${files}</div>
        <div class="field"><label class="label" for="cmMsg">提交信息</label><textarea class="textarea ${noRef ? 'invalid' : ''}" id="cmMsg" data-in="cm-msg" rows="6" ${busy ? 'disabled' : ''} aria-describedby="cmMsgErr">${esc(M.msg)}</textarea>${noRef ? `<span class="msg-err" id="cmMsgErr">${I('alert', 'sm')}hook 要求：正文需要一行 <span class="mono">Refs: SHOP-&lt;编号&gt;</span></span>` : ''}</div>
        <dl class="ns-kv"><dt>作者</dt><dd>${esc(T.author)}<br><span class="lockv">${I('lock', 'sm')}来自 设置 → Git 账号 · 不在此修改</span></dd>
          <dt>分支</dt><dd class="mono">${T.branch}</dd><dt>基线</dt><dd class="mono">${T.base} @ ${T.baseSha}</dd>
          <dt>变更版本</dt><dd><span class="mono">${M.rev}</span> <span class="hint">· 读取于 ${M.readAt}</span></dd>
          <dt>验证</dt><dd>单元测试 41/41 · lint 通过 · 回归通过</dd></dl>
        <div class="conseq">${I('info', 'sm')}<div><b>后果：</b>只在任务分支新增 1 个提交（${n} 个文件）。<ul><li>不推送；原项目 main 与 ${T.origDirty} 个未提交改动不受影响</li><li>未选 ${G.FILES.length - n} 个文件留在任务工作区</li><li>${M.goal === 'local' ? '提交成功后由任务服务结算交付' : '提交后任务仍未交付：' + GOALS[M.goal].steps.slice(1).map((s) => STEPN[s][0] + ' ' + STEPN[s][1]).join('、') + ' 需要再确认'}</li></ul></div></div>
        <div class="ns-act"><span class="grow">${why}</span>${M.cm === 'drift' ? `<button class="btn primary sm" data-a="cm-review" ${M.busy ? 'disabled' : ''}>${M.busy === 'review' ? '<span class="spin"></span>读取中…' : I('refresh', 'sm') + '复核变更'}</button>` : ''}
          <button class="btn ${M.cm === 'drift' ? 'secondary' : 'primary'} sm" data-a="cm-open" id="cmAct" ${dis ? 'disabled' : ''}>${busy ? '<span class="spin"></span>提交中…' : I('commit', 'sm') + (M.cm === 'hook' ? '修改后重新确认提交…' : '预览并确认提交…')}</button></div></div></div>`;
  }
  function stepPush() {
    if (M.cm !== 'done') return `<div class="ns-step lock">${stepHead('lock', 2, '推送', `${I('lock', 'sm')} 先完成 ① 提交`)}</div>`;
    if (M.ps === 'done') return `<div class="ns-step done">${stepHead('done', 2, '已推送到 GitLab', `${T.remote}/${esc(M.pushName)} @ ${T.newSha} · 新建 · ${T.times.push} · 回执 ${M.pushKey}`, `<button class="icon-btn" data-a="gl-open" aria-label="在 GitLab 打开远端分支" title="在 GitLab 打开远端分支">${I('external', 'sm')}</button>`)}</div>`;
    const busy = M.ps === 'busy'; let body = '', cls = 'cur';
    const kv = `<dl class="ns-kv"><dt>源提交</dt><dd><span class="sha">${T.newSha}</span> <span class="hint">1 个提交 · ${T.branch}</span></dd>
      <dt>账户</dt><dd>${T.account} · ${T.host}</dd><dt>项目</dt><dd><span class="mono">${T.gitlab}</span> · remote <span class="mono">${T.remote}</span></dd>
      <dt>远端分支</dt><dd><span class="mono">${esc(M.pushName)}</span> ${badge('新建远端分支', 'st-accent mini-badge')}</dd>
      <dt>连接版本</dt><dd><span class="mono">${M.conn}</span> <span class="hint">· 验证于 ${M.connAt}</span></dd></dl>`;
    const cq = `<div class="conseq">${I('info', 'sm')}<div><b>后果：</b>在 GitLab 新建远端分支 <span class="mono">${esc(M.pushName)}</span>，团队成员可见。<ul><li>只创建新分支：远端已有同名分支时停止，永不强推、不覆盖</li><li>不创建 MR；不改动 main</li></ul></div></div>`;
    const act = (label, a = 'ps-open') => `<div class="ns-act"><button class="btn primary sm" data-a="${a}" id="psAct" ${busy || M.busy ? 'disabled' : ''}>${busy ? '<span class="spin"></span>推送中…' : I('upload', 'sm') + label}</button></div>`;
    if (M.ps === 'exists') {
      cls = 'bad';
      body = `<div class="banner warn">${I('alert', 'sm')}<div><b>远端已有同名分支，没有推送</b><br>预览时读取 ${T.remote} 发现 <span class="mono">${T.branch}</span> 已存在（李娜 · 10-15 15:40 创建，含 2 个本地没有的提交）。不会覆盖，也不会先用旧名字推送试错。</div></div>
        <div class="field"><label class="label" for="psName">新的远端分支名</label><input class="input mono" id="psName" data-in="ps-name" value="${esc(M.newName)}" aria-describedby="psNameHint"><span class="hint" id="psNameHint">${M.nameChecked ? `${I('check', 'sm')} ${T.remote} 上没有这个分支（读取于 16:11）` : '换名后重新预览：服务先读取远端确认没有同名分支，再请你确认推送。'}</span></div>
        <div class="ns-act"><button class="btn primary sm" data-a="ps-rename" id="psAct" ${M.busy ? 'disabled' : ''}>${M.busy === 'rename' ? '<span class="spin"></span>读取远端…' : I('refresh', 'sm') + '用新名称重新预览'}</button></div>`;
    } else if (M.ps === 'auth') {
      cls = 'bad';
      body = `<div class="banner danger">${I('alert', 'sm')}<div><b>推送前检查未通过：账户用途不足</b><br>连接 ${M.conn} 的账户 ${T.account} 只有读取用途，不能创建远端分支。没有发出推送；提交 ${T.newSha} 保留在任务分支。本页不显示、也不修改任何凭据。</div></div>
        <div class="ns-act"><button class="btn ghost sm" data-a="settings">${I('settings', 'sm')}查看 Git 设置</button><button class="btn secondary sm" data-a="ps-reconn" id="psAct" ${M.busy ? 'disabled' : ''}>${M.busy === 'conn' ? '<span class="spin"></span>读取中…' : I('refresh', 'sm') + '重新读取连接'}</button></div>`;
    } else if (M.ps === 'failed') {
      cls = 'bad';
      body = `<div class="banner danger">${I('alert', 'sm')}<div><b>推送明确失败 · 已证明没有副作用</b><br>16:10 发出的推送（原请求 ${T.keys.pushFailed}）在建立连接时被拒绝：服务器证书已过期。服务核对：Git 连接没有建立，${T.remote} 上没有 <span class="mono">${T.branch}</span>，原请求已结算为“失败 · 无副作用”。</div></div>
        <div class="hint">可以发起<b style="font-weight:500;color:var(--ink-2)">新的推送请求</b>（新的请求 key），需要重新预览并确认；原请求记录保留。</div>${kv}${act('新建推送请求…')}`;
    } else if (M.ps === 'unknown' || M.ps === 'checking') {
      cls = 'unk';
      body = `<div class="banner unknown">${I('help', 'sm')}<div><b>推送结果未知</b><br>16:12:08 发出推送（原请求 ${T.keys.push}）后连接中断，没有收到回执。保持原请求，<b>不会重新推送</b>；核对前不能创建 MR。读取不到结果也不代表推送没有发生。</div></div>
        <div class="ns-act"><span class="grow">核对：读取 ${T.remote} 上的分支，比对是否已有 ${T.newSha}</span><button class="btn secondary sm" data-a="ps-check" id="psAct" ${M.ps === 'checking' ? 'disabled' : ''}>${M.ps === 'checking' ? '<span class="spin"></span>核对中' : I('search', 'sm') + '核对原推送'}</button></div>`;
    } else body = kv + cq + act('预览并确认推送…');
    return `<div class="ns-step ${cls}" id="stepPs">${stepHead(cls, 2, '推送', `${T.remote} / ${esc(M.pushName)}`)}<div class="ns-b">${body}</div></div>`;
  }
  function stepMR() {
    if (M.ps !== 'done') return `<div class="ns-step lock">${stepHead('lock', 3, '创建 MR', `${I('lock', 'sm')} ${M.ps === 'unknown' || M.ps === 'checking' ? '推送结果确认前不能创建 MR' : '先完成 ② 推送'}`)}</div>`;
    if (M.mr === 'done' || M.mr === 'exists') return `<div class="ns-step done">${stepHead('done', 3, M.mr === 'done' ? `已创建合并请求 ${T.mr}` : `已有原 MR ${T.mr} · 未重复创建`, `${esc(M.pushName)} → main · ${T.times.mr} · 回执 ${T.keys.mr}`)}
      <div class="ns-b"><div class="mrmini"><div class="t">${esc(M.mrTitle)}</div><div class="done-sub">${badge('打开 · 未合并', 'st-run mini-badge')}<span class="hint">iid ${T.mrIid} · 读取于 ${T.times.delivered}</span></div>
        ${M.mr === 'exists' ? `<div class="hint">原请求 ${T.keys.mr} 在 16:19 已创建这个 MR；核对后直接使用原 MR，没有发出第二次创建。</div>` : ''}
        <div class="ns-act" style="justify-content:flex-start"><button class="btn secondary sm" data-a="gl-open">${I('external', 'sm')}在 GitLab 打开 ${T.mr}</button></div></div></div></div>`;
    const busy = M.mr === 'busy'; let cls = 'cur', bn = '';
    if (M.mr === 'drift') { cls = 'bad'; bn = `<div class="banner warn">${I('alert', 'sm')}<div><b>目标分支已前移，MR 没有创建</b><br>你确认时 main 的 tip 是 ${T.baseSha}；服务创建前核对发现 main 已前移到 ${T.driftTip}（!55 于 16:15 合并）。请重新读取目标分支，然后重新确认。</div></div>`; }
    if (M.mr === 'reread') bn = `<div class="banner info">${I('info', 'sm')}<div>已重新读取：main 的 tip 现在是 <span class="sha">${T.driftTip}</span>（读取于 16:16）。源分支仍基于 ${T.baseSha}；是否有冲突在 GitLab 中查看。请重新确认。</div></div>`;
    if (M.mr === 'unknown' || M.mr === 'checking') {
      return `<div class="ns-step unk" id="stepMr">${stepHead('unk', 3, '创建 MR', `${esc(M.pushName)} → main`)}<div class="ns-b"><div class="banner unknown">${I('help', 'sm')}<div><b>MR 创建结果未知</b><br>16:19:04 发出创建请求（原请求 ${T.keys.mr}）后没有收到回执。不会再次创建；核对时按原请求标记查找 ${esc(M.pushName)} → main 的 MR。</div></div>
        <div class="ns-act"><span class="grow">核对原操作，不重发</span><button class="btn secondary sm" data-a="mr-check" id="mrAct" ${M.mr === 'checking' ? 'disabled' : ''}>${M.mr === 'checking' ? '<span class="spin"></span>核对中' : I('search', 'sm') + '核对原操作'}</button></div></div></div>`;
    }
    const len = [...M.mrTitle].length; const over = len > 255;
    const tipNew = M.mr === 'reread';
    return `<div class="ns-step ${cls}" id="stepMr">${stepHead(cls, 3, '创建 MR', `${esc(M.pushName)} → main`)}<div class="ns-b">${bn}
      <dl class="ns-kv"><dt>源</dt><dd><span class="mono">${T.remote}/${esc(M.pushName)}</span> @ <span class="sha">${T.newSha}</span> <span class="hint">· 已推送 ${T.times.push}</span></dd>
        <dt>目标</dt><dd class="tgt-row"><span class="mono">main</span> · tip <span class="sha ${tipNew ? 'new' : ''}">${M.tip}</span><span class="hint">核对于 ${M.tipAt}</span>${M.mr === 'drift' ? `<button class="btn primary sm" data-a="mr-reread" ${M.busy ? 'disabled' : ''}>${M.busy === 'tip' ? '<span class="spin"></span>读取中…' : I('refresh', 'sm') + '重新读取目标分支'}</button>` : ''}</dd></dl>
      <div class="field"><div class="row between"><label class="label" for="mrTitle">标题</label><span class="counter" style="${over ? 'color:var(--danger)' : ''}">${len} / 255</span></div><input class="input ${over ? 'invalid' : ''}" id="mrTitle" data-in="mr-title" value="${esc(M.mrTitle)}" maxlength="300" aria-describedby="mrTitleErr" ${busy ? 'disabled' : ''}>${over ? `<span class="msg-err" id="mrTitleErr">${I('alert', 'sm')}标题最多 255 个字符</span>` : ''}</div>
      <div class="field"><label class="label" for="mrDesc">说明 <span class="opt">可编辑</span></label><textarea class="textarea" id="mrDesc" data-in="mr-desc" style="min-height:110px;font-size:12.5px" ${busy ? 'disabled' : ''}>${esc(M.mrDesc)}</textarea></div>
      <div class="field"><span class="label">评审人 <span class="opt">非必填</span></span><div class="row wrap" style="gap:8px"><span class="rev-off">${I('help', 'sm')}暂未接通</span><span class="hint">需要时在 GitLab 中指派</span></div></div>
      <div class="conseq">${I('info', 'sm')}<div><b>后果：</b>在 GitLab 创建 ${esc(M.pushName)} → main 的合并请求，不合并任何代码，main 不变。<ul><li>MR 创建成功即完成所选交付；合并之后在 GitLab 中进行</li><li>已有同一原请求创建的 MR 时只显示原链接，不建第二个</li></ul></div></div>
      <div class="ns-act"><span class="grow">${M.mr === 'drift' ? '先重新读取目标分支' : over ? '标题过长' : ''}</span><button class="btn primary sm" data-a="mr-open" id="mrAct" ${busy || over || M.mr === 'drift' || M.busy ? 'disabled' : ''}>${busy ? '<span class="spin"></span>创建中…' : I('pr', 'sm') + '预览并确认创建 MR…'}</button></div></div></div>`;
  }
  function statusCard() {
    const need = steps(); const done = need.filter((s) => M[s] === 'done' || (s === 'mr' && M.mr === 'exists'));
    const wait = need.find((s) => !(M[s] === 'done' || (s === 'mr' && M.mr === 'exists')));
    const waitTxt = !M.goal ? '选择完成目标' : !wait ? '—' : (() => {
      const st = M[wait];
      const w = { todo: '等待你确认', drift: '版本变化 · 等待复核', reviewed: '等待重新确认', hook: '明确失败 · 等待修改后重新确认', busy: '进行中…', exists: '远端同名 · 等待换名预览', auth: '账户用途不足', failed: '明确失败（无副作用）', unknown: '回执未知 · 核对原操作', checking: '核对中…', reread: '等待重新确认' }[st] || '等待你确认';
      return `${STEPN[wait][0]} ${STEPN[wait][1]} · ${w}`;
    })();
    const task = M.delivered ? badge('任务已交付 · 10-15 16:20', 'st-ok mini-badge', 'check') : M.settling ? `<span class="row" style="gap:6px"><span class="spin" style="width:11px;height:11px"></span>结算中 · 等待任务服务读回</span>` : badge('未交付 · 执行已结束', 'st-wait mini-badge', 'clock');
    return `<section class="dst" aria-label="交付状态"><div class="dst-h">${I('layers', 'sm')}交付状态<span class="hint">任务服务读回 · ${M.delivered ? T.times.delivered : M.readAt} · ${T.keys.delivery}</span></div>
      <dl><dt>完成目标</dt><dd>${M.goal ? GOALS[M.goal].t : '<span class="hint">未选择</span>'}</dd>
        <dt>已成功</dt><dd>${done.length ? done.map((s) => `${STEPN[s][0]} ${STEPN[s][1]}${s === 'cm' ? ' ' + T.newSha : s === 'mr' ? ' ' + T.mr : ''}`).join(' · ') : '<span class="hint">—</span>'}</dd>
        <dt>等待</dt><dd>${waitTxt}</dd><dt>任务</dt><dd>${task}</dd></dl>
      ${M.delivered ? '' : `<div class="hint">任务是否交付以服务读回为准：按钮点击或单个步骤成功都不会直接把任务标为已交付。</div>`}</section>`;
  }
  function deliveredCard() {
    const un = unselFiles();
    const g = M.goal;
    return `<section class="dlv" id="dlvCard" aria-labelledby="dlvT"><div class="dlv-h"><span class="tile">${I('check', 'sm')}</span><div><div class="t" id="dlvT">任务已交付</div><div class="s">所选目标「${GOALS[g].t}」全部成功 · 任务服务读回 10-15 ${T.times.delivered}</div></div></div>
      <dl class="dlv-kv"><dt>验证</dt><dd>单元测试 41/41 通过 · lint 通过 · 回归通过 · 人工验收通过</dd>
        <dt>提交</dt><dd><span class="sha">${T.newSha}</span> · ${M.sel.size} 个文件 · <span class="mono">${T.branch}</span></dd>
        ${g !== 'local' ? `<dt>远端</dt><dd><span class="mono">${T.remote}/${esc(M.pushName)}</span>（新建）</dd>` : ''}
        ${g === 'mr' ? `<dt>MR</dt><dd><a href="#" data-a="gl-open" style="color:var(--accent)">${T.mr}</a> · iid ${T.mrIid} · <span class="mono">${esc(M.pushName)}</span> → main<br><span class="hint">回执 ${T.keys.mr} · 读取于 ${T.times.delivered}</span></dd>` : ''}
        <dt>剩余</dt><dd>${un.length ? `${un.length} 个未选文件（${un.map((f) => `<span class="mono">${esc(f.p)}</span>`).join('、')}）· ` : ''}未纳入 ${G.EXCLUDED.length} 项 — 留在任务工作区，未清理</dd></dl>
      <div class="dlv-note">${I('info', 'sm')}<span>${g === 'mr' ? 'MR 是否合并是独立事实：当前<b style="font-weight:500;color:var(--ink-2)">未合并</b>。合并在 GitLab 中进行，之后合并或关闭都不改写这次交付。' : g === 'push' ? '没有创建 MR；需要时可在 GitLab 中基于远端分支发起。' : '提交只在本地任务分支，没有推送。'}</span></div>
      <div class="dlv-act"><a class="btn primary sm" href="${delivHref()}">${I('arrowLeft', 'sm')}返回任务</a>${g === 'mr' ? `<button class="btn secondary sm" data-a="to-mr">${I('pr', 'sm')}查看 MR</button>` : ''}<a class="btn ghost sm" href="${wsHref()}">${I('folder', 'sm')}工作区详情</a></div></section>`;
  }

  /* ---------- 9. 普通视图（退出任务上下文）与 MR（TD07）---------- */
  function mrMatch(m, k) {
    const st = mrState(m)[0];
    return k === 'all' || (k === 'open' ? ['打开', '冲突'].includes(st) : k === 'merged' ? st === '已合并' : st === '已关闭');
  }
  function mrState(m) { if (m.id === '!58') return M.closed ? ['已关闭', 'st-idle', 'x'] : ['打开', 'st-run', 'play']; return m.st; }
  function plainMain() {
    const bb = `<div class="back-bar">${I('target', 'sm')}<span>已退出任务上下文。<b>任务 ${T.id}</b> 的文件选择与提交信息草稿保留在该任务下。</span><span class="grow"></span><button class="btn secondary sm" data-a="left" data-k="task">回到任务变更</button><a class="btn ghost sm" href="${backHref()}">${I('arrowLeft', 'sm')}返回任务</a></div>`;
    if (M.left === 'mrs') return mrMain();
    if (M.left === 'branches') {
      return `<section class="wb-detail" aria-label="分支"><div class="cd-scroll">${bb}<div class="plain-pad"><div><div class="cd-title">分支</div><div class="hint">本地 ${G.BRANCHES.length} 个 · 默认分支 main · 只读</div></div>
        <table class="tbl fixed"><colgroup><col style="width:40%"><col><col style="width:110px"></colgroup><thead><tr><th>分支</th><th>最后提交</th><th>说明</th></tr></thead><tbody>
        ${G.BRANCHES.map((b) => `<tr><td><div class="bn">${b.lock ? I('lock', 'sm') : I('gitRepo', 'sm')}<span class="ellipsis">${esc(b.n)}</span>${b.cur ? badge('当前', 'st-accent mini-badge') : ''}${b.task ? badge('任务 ' + b.task, 'st-wait mini-badge') : ''}</div></td><td><div class="lm"><span class="m"><span class="sha" style="margin-right:6px">${b.sha}</span>${esc(b.msg)}</span><span class="w">${b.when}</span></div></td><td><span class="hint">${esc(b.note) || '—'}</span></td></tr>`).join('')}</tbody></table></div></div></section>`;
    }
    return `<section class="wb-detail" aria-label="提交"><div class="cd-scroll">${bb}<div class="plain-pad"><div><div class="cd-title">提交 · main</div><div class="hint">普通历史，与任务交付无关 · 只读</div></div>
      <section class="card" style="overflow:hidden">${G.COMMITS.map(([s, m, w, t, refs]) => `<button class="cm-row" style="width:100%;text-align:left" data-a="proto" data-msg="提交详情（沿用原 Git 工作台 g11）"><span class="sha">${s}</span>${refs.map((r) => `<span class="ref ${r.startsWith('origin/') ? 'remote' : 'local'}">${esc(r)}</span>`).join('')}<span class="m">${esc(m)}</span><span class="w">${w} · ${t}</span></button>`).join('')}</section></div></div></section>`;
  }
  function mrMain() {
    const sel = M.mrSel && G.MRS.find((m) => m.id === M.mrSel);
    const head = `<div class="cd-head"><div class="cd-t"><div class="grow" style="min-width:0"><div class="cd-title">${sel ? '' : '合并请求'}${sel ? `<button class="btn ghost sm" data-a="mr-list" style="margin-left:-10px">${I('arrowLeft', 'sm')}合并请求列表</button>` : ''}</div><div class="hint">${T.host}/${T.gitlab} · 只读 · 读取于 ${T.times.mrRead}</div></div>
      <button class="btn ghost sm" data-a="mr-refresh">${M.busy === 'mrref' ? '<span class="spin"></span>读取中' : I('refresh', 'sm') + '刷新（只读）'}</button></div></div>`;
    if (sel) return `<section class="wb-detail" aria-label="合并请求详情">${head}<div class="cd-scroll" data-sk="mr"><div class="plain-pad">${mrDetail(sel)}</div></div></section>`;
    const list = G.MRS.filter((m) => mrMatch(m, M.mrFilter));
    const rows = list.map((m) => { const st = mrState(m); return `<button class="mr-row" data-a="mr" data-k="${m.id}"><span class="t"><span class="hint mono" style="font-weight:400">${m.id}</span><span class="x">${esc(m.title)}</span></span>
      <span class="m"><span class="srcdst">${esc(m.src)} ${I('arrowRight', 'sm')} ${esc(m.dst)}</span><span>·</span><span>${m.who}</span><span>·</span><span>${m.when}</span></span>
      <span class="r">${m.task ? `<span class="task-chip" title="来源任务 ${m.task} · ${esc(T.name)}">${I('target', 'sm')}来源任务 ${m.task} · 已交付</span>` : `<span class="task-chip none" title="不是由任务交付创建">来源任务 —</span>`}${badge(st[0], st[1] + ' mini-badge', st[2])}</span></button>`; }).join('');
    return `<section class="wb-detail" aria-label="合并请求">${head}<div class="cd-scroll"><div class="plain-pad"><section class="card" style="overflow:hidden">${rows || '<div class="empty">没有合并请求</div>'}</section>
      <p class="hint" style="display:flex;gap:6px;align-items:flex-start">${I('info', 'sm')}<span>「来源任务」由任务交付记录提供：只对由任务交付创建的 MR 显示。MR 的打开 / 合并 / 关闭状态来自 GitLab 只读读取，与任务是否已交付是两件独立的事实。</span></p></div></div></section>`;
  }
  function mrDetail(m) {
    const st = mrState(m); const closed = M.closed;
    return `<section class="card"><div class="mr-d"><div class="row" style="gap:8px;flex-wrap:wrap"><span class="hint mono">${m.id}</span><span class="section-title">${esc(m.title)}</span>${badge(st[0] + (closed ? '' : ' · 未合并'), st[1], st[2])}</div>
        <div class="srcdst" style="margin-top:6px">${esc(m.src)} ${I('arrowRight', 'sm')} ${esc(m.dst)}<span class="hint" style="font-family:var(--font)">· ${m.who} · ${m.when} 创建 · iid ${T.mrIid}</span></div>
        <div class="row wrap" style="gap:8px;margin-top:12px"><a class="task-chip" href="${delivHref()}" title="返回来源任务">${I('target', 'sm')}来源任务 · ${T.id} ${esc(T.name)}</a><a class="btn ghost sm" href="${delivHref()}">${I('arrowLeft', 'sm')}返回任务</a></div></div></section>
      <div class="facts">
        <div class="fact ok"><span class="tile">${I('check', 'sm')}</span><div><div class="k">任务交付 · 任务服务记录</div><div class="t">该任务已交付（10-15 16:20）</div><div class="d">目标「提交、推送并创建 MR」· 依据 MR ${T.mr} 创建回执 ${T.keys.mr} · 交付记录 ${T.keys.delivery}</div></div></div>
        <div class="fact ${closed ? 'closed' : 'open'}"><span class="tile">${I(closed ? 'x' : 'circle', 'sm')}</span><div><div class="k">MR 状态 · GitLab 只读</div><div class="t">${closed ? 'MR 已关闭' : 'MR 未合并'}</div><div class="d">${closed ? '李娜 · 10-16 09:30 关闭（GitLab 评论：改为拆成两个 MR）· 读取于 10-16 09:42' : '打开 · 读取于 ' + T.times.mrRead}</div></div></div></div>
      <p class="hint" style="display:flex;gap:6px;align-items:flex-start">${I('info', 'sm')}<span>两条事实相互独立：MR 之后合并、关闭或出现冲突，都不会改写或重开这次任务交付${closed ? '。任务仍为已交付；需要继续时按新任务或合法的新交付版本处理，旧的完成记录保留' : '，也不会触发旧任务重新执行'}。</span></p>
      <section class="card"><div class="card-head" style="padding:12px 16px"><div class="grow"><div class="section-title" style="font-size:14px">${closed ? 'MR 已关闭' : '合并'}</div></div></div>
        <div class="merge-out"><div class="grow">${closed ? 'MR 已在 GitLab 中关闭，不能合并。需要时在 GitLab 中查看关闭原因与讨论。' : '<b>合并在 GitLab 中进行：</b>评审、冲突处理与合并都在 GitLab 页面完成。产品内合并未提供。'}</div>
          <a class="btn secondary sm" href="#" data-a="gl-open" title="${T.mrUrl}">${I('external', 'sm')}${closed ? '在 GitLab 查看' : '在 GitLab 打开并合并'}</a></div></section>
      <section class="card"><div class="card-head" style="padding:12px 16px"><div class="grow"><div class="section-title" style="font-size:14px">说明</div></div></div><p style="padding:12px 16px 14px;font-size:13px;line-height:1.7;color:var(--ink-2);white-space:pre-wrap">${esc(G.MR_DESC)}</p></section>
      <section class="card" style="overflow:hidden"><div class="card-head" style="padding:10px 16px"><span class="section-title" style="font-size:13.5px">1 个提交</span></div>${m.commits.map(([s, t]) => `<div class="cm-row"><span class="sha">${s}</span><span class="m">${esc(t)}</span><span class="w">dev-zhang · 10-15 ${T.times.commit}</span></div>`).join('')}</section>`;
  }

  /* ---------- 10. 总装 ---------- */
  function page() {
    if (M.ctx !== 'task') return `<div class="td-wrap"><div class="wb plain" id="wb">${tree()}${plainMain()}</div></div>`;
    const leave = M.leave ? `<div class="leave-bar" role="alertdialog" aria-labelledby="lvT" aria-describedby="lvD">${I('alert')}<div><b id="lvT">切换到「${{ commits: '提交', branches: '分支', mrs: '合并请求' }[M.leave]}」会退出任务变更上下文</b><br><span id="lvD">右侧交付步骤会隐藏，页面回到普通 Git 浏览。任务 ${T.id} 的文件选择（${M.sel.size} 个）与提交信息草稿保留在该任务下，回到「任务变更」时恢复。${M.busy ? '' : '当前没有进行中的写操作。'}</span></div>
      <div class="actions"><button class="btn secondary sm" data-a="leave-cancel" id="lvStay">留在任务变更</button><button class="btn primary sm" data-a="leave-ok">退出任务上下文</button></div></div>` : '';
    return `<div class="td-wrap">${ctxBar()}${leave}<div class="wb task ${M.full ? 'full' : ''} ${M.nsOpen ? 'ns-open' : ''}" id="wb">${tree()}${center()}${nsCol()}</div></div>`;
  }
  function overlays() {
    return ['dlgCommit', 'dlgPush', 'dlgMr', 'dlgGoal'].map((id) => `<div class="dialog wide td" id="${id}" role="dialog" aria-modal="true" aria-labelledby="${id}T"></div>`).join('');
  }
  function render() {
    const keep = {}; $$('[data-sk]').forEach((el) => { keep[el.dataset.sk] = [el.scrollTop, el.scrollLeft]; });
    const ae = document.activeElement; const aeIn = ae && ae.dataset && ae.dataset.in; const aePos = aeIn && ae.selectionStart;
    const aeKey = !aeIn && ae && ae.dataset && ae.dataset.a ? `[data-a="${ae.dataset.a}"]${ae.dataset.k ? `[data-k="${ae.dataset.k}"]` : ''}${ae.dataset.p ? `[data-p="${CSS.escape(ae.dataset.p)}"]` : ''}` : null;
    const inDlg = ae && ae.closest && ae.closest('.dialog');
    $('.header').innerHTML = header();
    $('#content').classList.add('wb-mode');
    $('#page').innerHTML = page();
    $$('[data-sk]').forEach((el) => { const k = keep[el.dataset.sk]; if (k) { el.scrollTop = k[0]; el.scrollLeft = k[1]; } });
    const dv = $('#dvScroll'); if (dv) dv.style.setProperty('--dvw', dv.clientWidth + 'px');
    if (aeIn) { const el = $(`[data-in="${aeIn}"]`); if (el) { el.focus(); try { if (aePos != null) el.setSelectionRange(aePos, aePos); } catch (e) {} } }
    else if (aeKey && !inDlg) { const el = $('#page ' + aeKey) || $('.header ' + aeKey); if (el && !el.disabled) el.focus(); }
    DS.icons();
  }

  /* ---------- 11. 确认对话框（焦点限定 · Esc 关闭 · 关闭后还原焦点）---------- */
  function openDlg(id, trigger) {
    ({ dlgCommit: fillCommit, dlgPush: fillPush, dlgMr: fillMr, dlgGoal: fillGoal })[id]();
    DS.openDialog(id, trigger || document.activeElement);
  }
  const kvRow = (k, v) => `<dt>${k}</dt><dd>${v}</dd>`;
  function fillCommit() {
    const fs = selFiles();
    $('#dlgCommit').innerHTML = `<div class="dialog-body"><h2 id="dlgCommitT">确认提交到任务分支？</h2><p>将在 <span class="mono">${T.branch}</span> 新建 1 个提交。这是一次独立的写操作；推送与创建 MR 之后另行确认。</p>
      <dl class="dlg-kv">${kvRow('目标分支', `<span class="mono">${T.branch}</span> ${badge('任务分支 · 本地', 'st-accent mini-badge')}`)}
        ${kvRow('文件', `${fs.length} 个 · ${amd(fs)}<div class="hint">${fs.map((f) => esc(f.p)).join('、')}</div>`)}
        ${kvRow('提交信息', `<pre class="msgpre">${esc(M.msg)}</pre>`)}
        ${kvRow('作者', `${esc(T.author)}<div class="hint">来自 设置 → Git 账号</div>`)}
        ${kvRow('基线', `<span class="mono">${T.base} @ ${T.baseSha}</span>`)}
        ${kvRow('变更版本', `<span class="mono">${M.rev}</span> · 读取于 ${M.readAt}<div class="hint">确认后文件版本若再变化，提交会停止并请你复核</div>`)}
        ${kvRow('验证', '单元测试 41/41 · lint 通过 · 回归通过')}</dl>
      <ul class="dlg-list"><li class="ok">${I('shield', 'sm')}<span>原项目 main 与 ${T.origDirty} 个未提交改动不受影响</span></li><li>${I('file', 'sm')}<span>未选 ${G.FILES.length - fs.length} 个文件留在任务工作区</span></li>
        <li class="${M.goal === 'local' ? 'ok' : 'warn'}">${I(M.goal === 'local' ? 'check' : 'clock', 'sm')}<span>${M.goal === 'local' ? '目标「仅本地提交」：提交成功后由任务服务结算交付' : `目标「${GOALS[M.goal].t}」：提交后任务仍未交付，不会自动推送`}</span></li></ul></div>
      <div class="dialog-foot"><button class="btn ghost" data-a="close-dialog" autofocus>取消</button><button class="btn primary" data-a="cm-do">${I('commit', 'sm')}确认提交</button></div>`;
  }
  function fillPush() {
    $('#dlgPush').innerHTML = `<div class="dialog-body"><h2 id="dlgPushT">确认推送到 GitLab？</h2><p>把提交推送到一个<b style="font-weight:500;color:var(--ink)">新的</b>远端分支。这是独立的写操作；创建 MR 之后另行确认。</p>
      <dl class="dlg-kv">${kvRow('源提交', `<span class="sha">${T.newSha}</span> · 1 个提交 · <span class="mono">${T.branch}</span>`)}
        ${kvRow('账户', `${T.account} · ${T.host}<div class="hint">公开名称；不显示凭据</div>`)}
        ${kvRow('项目', `<span class="mono">${T.gitlab}</span> · remote <span class="mono">${T.remote}</span>`)}
        ${kvRow('新远端分支', `<span class="mono">${esc(M.pushName)}</span> ${badge('新建', 'st-accent mini-badge')}${M.nameChecked ? `<div class="hint">${T.remote} 上没有这个分支（读取于 16:11）</div>` : ''}`)}
        ${kvRow('连接版本', `<span class="mono">${M.conn}</span> · 验证于 ${M.connAt}`)}
        ${kvRow('请求', `<span class="mono">${M.ps === 'failed' ? T.keys.push + '（新请求）' : T.keys.push}</span>`)}</dl>
      <ul class="dlg-list"><li class="ok">${I('shield', 'sm')}<span>只创建新分支：远端已有同名分支时停止；永不强推，不覆盖任何远端分支</span></li><li>${I('info', 'sm')}<span>不创建 MR，不改动 main</span></li>
        <li class="${M.goal === 'push' ? 'ok' : 'warn'}">${I(M.goal === 'push' ? 'check' : 'clock', 'sm')}<span>${M.goal === 'push' ? '目标「提交并推送」：推送成功后由任务服务结算交付' : '目标「提交、推送并创建 MR」：推送后任务仍未交付'}</span></li></ul></div>
      <div class="dialog-foot"><button class="btn ghost" data-a="close-dialog" autofocus>取消</button><button class="btn primary" data-a="ps-do">${I('upload', 'sm')}确认推送</button></div>`;
  }
  function fillMr() {
    $('#dlgMr').innerHTML = `<div class="dialog-body"><h2 id="dlgMrT">确认创建合并请求？</h2><p>在 GitLab 创建合并请求，不合并任何代码。MR 创建成功即完成所选交付。</p>
      <dl class="dlg-kv">${kvRow('源', `<span class="mono">${T.remote}/${esc(M.pushName)}</span> @ <span class="sha">${T.newSha}</span><div class="hint">已推送 ${T.times.push}</div>`)}
        ${kvRow('目标', `<span class="mono">main</span> · tip <span class="sha">${M.tip}</span><div class="hint">核对于 ${M.tipAt}；创建前服务再次核对，变化时停止并请你重新确认</div>`)}
        ${kvRow('标题', `${esc(M.mrTitle)} <span class="hint">（${[...M.mrTitle].length} / 255）</span>`)}
        ${kvRow('说明', `<pre class="msgpre">${esc(M.mrDesc)}</pre>`)}
        ${kvRow('评审人', '<span class="hint">暂未接通 · 非必填</span>')}
        ${kvRow('请求', `<span class="mono">${T.keys.mr}</span>`)}</dl>
      <ul class="dlg-list"><li class="ok">${I('shield', 'sm')}<span>main 不变；合并之后在 GitLab 中进行，产品内不提供合并</span></li><li>${I('info', 'sm')}<span>同一原请求已有 MR 时只显示原链接，不会建第二个</span></li></ul></div>
      <div class="dialog-foot"><button class="btn ghost" data-a="close-dialog" autofocus>取消</button><button class="btn primary" data-a="mr-do">${I('pr', 'sm')}确认创建 MR</button></div>`;
  }
  function fillGoal() {
    const to = M.goalTo; const from = M.goal;
    const doneSteps = GOALS[from].steps.filter((s) => M[s] === 'done');
    const need = GOALS[to].steps.filter((s) => M[s] !== 'done');
    const drop = GOALS[from].steps.filter((s) => !GOALS[to].steps.includes(s));
    $('#dlgGoal').innerHTML = `<div class="dialog-body"><h2 id="dlgGoalT">改变完成目标？ <span class="badge st-unknown mini-badge">改变目标 · API 未冻结</span></h2>
      <p>当前目标「${GOALS[from].t}」还没有全部完成。改变目标需要你明确确认，并由任务服务按交付版本 ${T.keys.delivery} 校验；版本已变化时会请你重新确认。</p>
      <div class="gc-pick" role="radiogroup" aria-label="新的完成目标">${Object.keys(GOALS).filter((k) => k !== from).map((k) => `<button class="rcard2" role="radio" aria-checked="${to === k}" data-a="goal-to" data-k="${k}"><span class="rd"></span><span><span class="t">${GOALS[k].t}</span><span class="d" style="display:block">${chain(k)}</span></span></button>`).join('')}</div>
      <ul class="dlg-list" style="margin-top:14px">${doneSteps.map((s) => `<li class="ok">${I('check', 'sm')}<span>已完成的 ${STEPN[s][0]} ${STEPN[s][1]}${s === 'cm' ? ' ' + T.newSha : ''} 保留，不撤销</span></li>`).join('')}
        ${need.length ? `<li class="warn">${I('clock', 'sm')}<span>仍需：${need.map((s) => STEPN[s][0] + ' ' + STEPN[s][1]).join('、')}（各自单独确认）</span></li>` : `<li class="ok">${I('check', 'sm')}<span>新目标需要的步骤都已成功：任务服务将以已有提交结算交付，读回后才显示“已交付”</span></li>`}
        ${drop.length ? `<li class="muted">${I('minus', 'sm')}<span>不再需要：${drop.map((s) => STEPN[s][0] + ' ' + STEPN[s][1]).join('、')}</span></li>` : ''}
        <li>${I('shield', 'sm')}<span>已成功的副作用不会撤销，也不会自动删除远端分支</span></li></ul></div>
      <div class="dialog-foot"><button class="btn ghost" data-a="close-dialog" autofocus>保持原目标</button><button class="btn primary" data-a="goal-do">确认改变目标</button></div>`;
  }
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const d = $('.dialog.open') || ($('#tdExplain.open'));
    if (!d) return;
    const fs = $$('button:not([disabled]),a[href],input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])', d).filter((x) => x.offsetParent !== null);
    if (!fs.length) return;
    const first = fs[0], last = fs[fs.length - 1];
    if (!d.contains(document.activeElement)) { e.preventDefault(); first.focus(); return; }
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }, true);

  /* ---------- 12. 模拟的写操作（定时器；结果由“服务读回”后才显示）---------- */
  function settle(next) {
    M.settling = true; render();
    later(900, () => { M.settling = false; M.delivered = true; M.nsOpen = innerWidth < 1100; if (next) mark(next); render(); toast('任务服务读回：任务已交付', 'ok'); const c = $('#dlvCard'); if (c) c.scrollIntoView({ block: 'nearest' }); });
  }
  function doCommit() {
    DS.closeDialog('dlgCommit'); if (M.busy) return;
    const prev = M.cm; M.cm = 'busy'; render();
    later(1300, () => {
      if (prev === 'hook' && !/Refs:\s*SHOP-\d+/.test(M.msg)) { M.cm = 'hook'; M.hookN++; render(); toast('仍被 hook 拒绝：新请求明确失败，任务分支没有新提交', 'warn'); return; }
      M.cm = 'done'; render(); toast(`已提交到 ${T.branch} · ${T.newSha}`, 'ok');
      if (M.goal === 'local') settle('td04-commit-only-done'); else mark('td04-committed-wait-push');
    });
  }
  function doPush() {
    DS.closeDialog('dlgPush'); if (M.busy) return;
    M.ps = 'busy'; render();
    later(1500, () => {
      M.ps = 'done'; M.tipAt = '16:14'; render(); toast(`已推送 ${T.remote}/${M.pushName}（新建远端分支）`, 'ok');
      if (M.goal === 'push') settle(null); else mark('td04-mr-confirm');
    });
  }
  function doMr() {
    DS.closeDialog('dlgMr'); if (M.busy) return;
    M.mr = 'busy'; render();
    later(1300, () => { M.mr = 'done'; render(); toast(`已创建合并请求 ${T.mr}（未合并）`, 'ok'); settle('td04-delivered'); });
  }

  /* ---------- 13. 说明抽屉（与 td-proto 的说明同构；跟随页内状态切换）---------- */
  function openExplain() {
    const s = TD.byId[CUR]; if (!s) return;
    let d = document.getElementById('tdExplain');
    if (!d) {
      document.body.insertAdjacentHTML('beforeend', `<div class="scrim" id="tdExplainScrim"></div><aside class="drawer td-explain" id="tdExplain" role="dialog" aria-modal="true" aria-labelledby="tdExplainT" style="width:400px"></aside>`);
      d = document.getElementById('tdExplain'); document.getElementById('tdExplainScrim').addEventListener('click', closeExplain);
    }
    d.innerHTML = `<div class="drawer-head"><div class="grow"><div class="eyebrow">${esc(s.group)}</div><div id="tdExplainT" style="font-size:16px;font-weight:500;margin-top:3px">${esc(s.label)}</div></div><button class="icon-btn" aria-label="关闭说明" id="tdExplainX">×</button></div>
      <div class="drawer-body"><span class="td-mock">设计样例 · 合成数据</span><div class="sec-t">状态 ID</div><p class="mono">${s.id}</p>
      <div class="sec-t">设计意图与验收要点</div><p>${(window.TD_DESC && window.TD_DESC[s.id]) || s.desc || '（见 STATES.md）'}</p>
      <div class="sec-t">对应验收条件</div><div class="req">${(s.req || []).map((r) => `<span class="badge outline">${r}</span>`).join('')}</div></div>`;
    document.getElementById('tdExplainX').addEventListener('click', closeExplain);
    d.classList.add('open'); document.getElementById('tdExplainScrim').classList.add('open'); document.getElementById('tdExplainX').focus();
  }
  function closeExplain() { const d = document.getElementById('tdExplain'); if (!d) return; d.classList.remove('open'); document.getElementById('tdExplainScrim').classList.remove('open'); const b = document.getElementById('tdExplainBtn'); if (b) b.focus(); }

  /* ---------- 14. 事件 ---------- */
  function go(id) { applyState(id); mark(id); render(); enter(); }
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-a]'); if (!b) return;
    if (b.matches('input[type=checkbox]')) return;
    if (b.getAttribute('aria-disabled') === 'true') return;
    const a = b.dataset.a, k = b.dataset.k;
    if (a === 'back') return; // 普通链接：返回任务（带 from / fromState）
    if (b.tagName === 'A') e.preventDefault();
    switch (a) {
      case 'proto': proto(b.dataset.msg || '操作'); return;
      case 'gl-open': proto('在 GitLab 打开（外部链接，地址来自可信读口）'); return;
      case 'settings': proto('设置 → Git 账号（只说明用途，不显示凭据）'); return;
      case 'copy': copy(b.dataset.v, b.dataset.l || ''); return;
      case 'crumb': if (M.ctx === 'task') { M.leave = k; render(); requestAnimationFrame(() => { const s = $('#lvStay'); if (s) s.focus(); }); } return;
      case 'left':
        if (k === 'task') { if (M.ctx !== 'task') { M.ctx = 'task'; M.left = 'task'; M.leave = null; M.mrSel = null; render(); mark(M.delivered ? 'td04-delivered' : 'td03-changes'); toast('已回到任务变更：文件选择与草稿已恢复', 'info'); } return; }
        if (M.ctx === 'task') { M.leave = k; render(); requestAnimationFrame(() => { const s = $('#lvStay'); if (s) s.focus(); }); return; }
        M.left = k; if (k !== 'mrs') M.mrSel = null; render(); if (k === 'mrs') mark('td07-mr-list'); return;
      case 'leave-cancel': M.leave = null; render(); return;
      case 'leave-ok': M.ctx = 'none'; M.left = M.leave; M.leave = null; M.full = false; render(); if (M.left === 'mrs') mark('td07-mr-list'); toast('已退出任务上下文 · 草稿保留在任务 ' + T.id + ' 下', 'info'); return;
      case 'reread':
        if (M.busy) return; M.load = 'loading'; render();
        later(1100, () => { M.load = 'ok'; M.readAt = M.rev === 'cr-8' ? '16:05' : '16:03'; render(); if (CUR === 'td03-read-error' || CUR === 'td03-loading') mark('td03-changes'); toast('已重新读取任务变更 ' + M.rev + '（只读）', 'ok'); });
        return;
      case 'ns-toggle': M.nsOpen = !M.nsOpen; render(); if (M.nsOpen) requestAnimationFrame(() => { const x = $('#nsCol .ns-x'); if (x) x.focus(); }); else { const t = $('.ns-tog'); if (t) t.focus(); } return;
      case 'tab': M.tab = k; render(); return;
      case 'file': M.file = b.dataset.p; M.view = 'diff'; M.tab = 'changes'; render(); { const sc = $('#dvScroll'); if (sc) sc.scrollTop = 0; } return;
      case 'file-step': { const fs = G.FILES; let i = fs.findIndex((f) => f.p === M.file) + +b.dataset.d; i = (i + fs.length) % fs.length; M.file = fs[i].p; render(); return; }
      case 'excluded': M.view = M.view === 'excluded' ? 'diff' : 'excluded'; M.tab = 'changes'; render(); return;
      case 'view-diff': M.view = 'diff'; render(); return;
      case 'diff-mode': M.diff = k; if (k === 'split' && !M.full && innerWidth < 1800) { M.full = true; toast('并排视图需要更宽的空间，已展开到全宽（交付步骤收起）· Esc 返回', 'info'); } render(); return;
      case 'full': M.full = !M.full; render(); return;
      case 'exp': M.exp[b.dataset.k] = (M.exp[b.dataset.k] || 0) + +b.dataset.n; render(); return;
      case 'seg-next': { const key = b.dataset.k; M.loading[key] = true; render(); later(800, () => { M.loading[key] = false; M.pages[key] = (M.pages[key] || 1) + 1; render(); toast('已读取下一段（只读）', 'ok'); }); return; }
      case 'goal':
        if (M.busy) return;
        M.goal = k; render(); toast(`已记录完成目标「${GOALS[k].t}」· 没有执行任何步骤`, 'info'); if (CUR === 'td03-changes') mark('td04-goal'); return;
      case 'goal-change': M.goalTo = M.goal === 'push' ? 'mr' : 'push'; openDlg('dlgGoal', b); return;
      case 'goal-to': M.goalTo = k; fillGoal(); { const r = $(`#dlgGoal [data-a="goal-to"][data-k="${k}"]`); if (r) r.focus(); } return;
      case 'goal-do': {
        DS.closeDialog('dlgGoal'); const to = M.goalTo; M.busy = 'goal'; render();
        later(700, () => {
          M.busy = null; M.goal = to; if (to !== 'mr') M.mr = 'todo'; if (to === 'local') M.ps = 'todo';
          render(); toast(`服务已校验交付版本：目标改为「${GOALS[to].t}」· 已完成的步骤保留`, 'ok');
          if (GOALS[to].steps.every((s) => M[s] === 'done')) settle(to === 'local' ? 'td04-commit-only-done' : null);
          else if (to === 'push' && M.cm === 'done' && M.ps !== 'done') mark('td04-committed-wait-push');
        });
        return; }
      case 'close-dialog': DS.closeDialog(); return;
      case 'cm-open': openDlg('dlgCommit', b); return;
      case 'cm-do': doCommit(); return;
      case 'cm-review': M.busy = 'review'; render(); later(900, () => { M.busy = null; M.rev = 'cr-8'; M.readAt = '16:05'; M.cm = 'reviewed'; M.file = 'src/refund/service.ts'; M.view = 'diff'; M.tab = 'changes'; render(); toast('已读取 cr-8：src/refund/service.ts +2 行 · 草稿已保留', 'info'); scrollDiffTo(31); }); return;
      case 'ps-open': openDlg('dlgPush', b); return;
      case 'ps-do': if (M.ps === 'failed') M.pushKey = T.keys.push; doPush(); return;
      case 'ps-rename': {
        const v = (($('#psName') || {}).value || '').trim(); if (!v || v === T.branch) { toast('请换一个新的远端分支名', 'warn'); return; }
        M.newName = v; M.busy = 'rename'; render();
        later(900, () => { M.busy = null; M.pushName = v; M.nameChecked = true; M.ps = 'todo'; render(); openDlg('dlgPush', $('#psAct')); });
        return; }
      case 'ps-reconn': M.busy = 'conn'; render(); later(1000, () => { M.busy = null; M.conn = 'conn-v5'; M.connAt = '16:11'; M.ps = 'todo'; render(); toast('已重新读取连接 conn-v5：账户具备写仓库用途 · 请重新预览推送', 'ok'); }); return;
      case 'ps-check': M.ps = 'checking'; render(); later(1200, () => { M.ps = 'done'; render(); mark('td04-mr-confirm'); toast(`核对结果：${T.remote} 已有 ${T.branch} @ ${T.newSha}，原推送成功，没有重复推送`, 'ok'); }); return;
      case 'mr-open': openDlg('dlgMr', b); return;
      case 'mr-do': doMr(); return;
      case 'mr-reread': M.busy = 'tip'; render(); later(900, () => { M.busy = null; M.tip = T.driftTip; M.tipAt = '16:16'; M.mr = 'reread'; render(); toast('已重新读取 main：tip ' + T.driftTip + ' · 请重新确认', 'info'); }); return;
      case 'mr-check': M.mr = 'checking'; render(); later(1200, () => { M.mr = 'exists'; render(); toast(`核对结果：原请求已创建 ${T.mr}，不会再创建`, 'ok'); settle('td04-mr-exists'); }); return;
      case 'to-mr': go('td07-mr-detail'); return;
      case 'mr': M.mrSel = k; render(); if (k === '!58') mark(M.closed ? 'td07-mr-closed-later' : 'td07-mr-detail'); { const sc = $('[data-sk="mr"]'); if (sc) sc.scrollTop = 0; } return;
      case 'mr-list': M.mrSel = null; render(); mark('td07-mr-list'); return;
      case 'mr-filter': M.mrFilter = k; render(); return;
      case 'mr-refresh': M.busy = 'mrref'; render(); later(800, () => { M.busy = null; render(); toast('已刷新（只读）：MR 状态没有变化', 'info'); }); return;
      default: return;
    }
  });
  document.addEventListener('change', (e) => {
    const t = e.target; const a = t.dataset.a;
    if (a === 'ws') { M.ws = t.checked; render(); toast(M.ws ? '已忽略空白：只有缩进不同的行显示为上下文' : '已显示空白改动', 'info'); return; }
    if (a === 'sel') { if (selLocked()) return; const p = t.dataset.p; t.checked ? M.sel.add(p) : M.sel.delete(p); render(); return; }
    if (a === 'sel-all') { if (selLocked()) return; M.sel = t.checked ? new Set(G.FILES.map((f) => f.p)) : new Set(); render(); return; }
  });
  document.addEventListener('input', (e) => {
    const t = e.target, inn = t.dataset.in; if (!inn) return;
    if (inn === 'cm-msg') { const had = /Refs:\s*SHOP-\d+/.test(M.msg); M.msg = t.value; if (M.cm === 'hook' && had !== /Refs:\s*SHOP-\d+/.test(M.msg)) render(); }
    if (inn === 'ps-name') M.newName = t.value;
    if (inn === 'mr-title') { const was = [...M.mrTitle].length > 255; M.mrTitle = t.value; const c = t.closest('.field').querySelector('.counter'); if (c) c.textContent = [...M.mrTitle].length + ' / 255'; if (was !== ([...M.mrTitle].length > 255)) render(); }
    if (inn === 'mr-desc') M.mrDesc = t.value;
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if ($('.dialog.open') || $('.drawer.open')) return; // 由外壳处理：关闭并还原焦点
    if (M.leave) { M.leave = null; render(); return; }
    if (M.nsOpen && innerWidth < 1100) { M.nsOpen = false; render(); const t = $('.ns-tog'); if (t) t.focus(); return; }
    if (M.full) { M.full = false; render(); toast('已退出全宽', 'info'); }
    // Esc 不会退出任务上下文：离开只能通过「返回任务」、面包屑或左栏切换（带确认）
  });
  addEventListener('resize', () => { const dv = $('#dvScroll'); if (dv) dv.style.setProperty('--dvw', dv.clientWidth + 'px'); });
  document.addEventListener('skinchange', () => { const dv = $('#dvScroll'); if (dv) dv.style.setProperty('--dvw', dv.clientWidth + 'px'); });

  function scrollDiffTo(n) { requestAnimationFrame(() => { const sc = $('#dvScroll'); if (!sc) return; const rows = $$('.dl', sc); const r = rows[n]; if (r) sc.scrollTop = Math.max(0, r.offsetTop - 80); }); }
  /* 进入状态时自动布置：对话框 / 定位 / 窄窗步骤栏 */
  function enter() {
    requestAnimationFrame(() => {
      const c = CFG[CUR] || {};
      const ns = $('#nsCol');
      const scrollNs = (sel) => { const el = $(sel); if (el && ns) ns.scrollTop = Math.max(0, el.offsetTop - 56); };
      if (c.dialog === 'commit') { scrollNs('#stepCm'); openDlg('dlgCommit', $('#cmAct')); }
      if (c.dialog === 'push') { scrollNs('#stepPs'); openDlg('dlgPush', $('#psAct')); }
      if (c.dialog === 'mr') { scrollNs('#stepMr'); openDlg('dlgMr', $('#mrAct')); }
      if (c.dialog === 'goal') { M.goalTo = 'push'; openDlg('dlgGoal', $('[data-a="goal-change"]')); }
      if (!c.dialog) {
        if (/^td04-(push|committed)/.test(CUR)) scrollNs('#stepPs');
        if (/^td04-(target|mr-unknown)/.test(CUR)) scrollNs('#stepMr');
        if (/^td04-(hook|commit-drift)/.test(CUR)) scrollNs('#stepCm');
      }
      if (CUR === 'td03-changes' || CUR === 'td04-goal') scrollDiffTo(18);
      if (CUR === 'td03-leave-context') { const s = $('#lvStay'); if (s) s.focus(); }
    });
  }

  /* ---------- 15. 启动 ---------- */
  DS.mount({ header: '', proto: false });
  document.body.insertAdjacentHTML('beforeend', overlays());
  TD.mountProto();
  { const old = document.getElementById('tdExplainBtn'); if (old) { const nb = old.cloneNode(true); old.replaceWith(nb); nb.addEventListener('click', openExplain); } }
  render();
  enter();
})();
