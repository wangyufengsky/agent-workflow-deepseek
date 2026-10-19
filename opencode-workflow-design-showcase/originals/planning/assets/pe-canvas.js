/* opencode-workflow · 流程画布组件（规划补充稿扩展副本）
   复制自合集 assets/canvas.js（布局、平移、缩放、节点卡、编辑“+”行为不变），本副本只做加法：
   - 分组框：opt.groups=[{id,title,meta,collapsed,tone}]；分组只是展示与范围索引，不是执行节点、不是调度屏障。
     折叠时把组内节点换成一张“组摘要卡”，组外连线按端点合并（仍是同一张 DAG）。
   - 候选差异：node.diff = add | mod | repl | del；node.gap（虚线缺口）、node.lock（带锁）、node.dim（选区外变淡）、node.port（只读边界端口）
   - 连线：edge.kind = resource | new | del | bad | port
   用法：const cv = PECanvas(el, { nodes, edges, groups, statusOf, onSelect, onToggleGroup, editable, onAddAfter }) */
(function () {
  const NODE_W = 204, NODE_H = 100, SYS_W = 96, SYS_H = 40, PORT_W = 168, PORT_H = 44, GRP_W = 204, GRP_H = 100, COL_GAP = 64, ROW_GAP = 26;
  const ROLE_COLORS = [1, 2, 3, 4, 5, 6].map((n) => `var(--role-${n})`);
  const STATUS = {
    idle: ['待执行', 'st-idle', 'clock'], ready: ['待执行 · 可修改', 'st-idle', 'edit'], claimed: ['已被领取', 'st-wait', 'lock'],
    run: ['执行中', 'st-run', 'play'], review: ['待验收', 'st-wait', 'eye'], done: ['已完成', 'st-done', 'check'],
    stall: ['停滞', 'st-stall', 'alert'], fail: ['失败', 'st-fail', 'x'], wait: ['等待你处理', 'st-wait', 'help'],
    skip: ['已移出计划', 'st-idle', 'archive'], unknown: ['状态未核对', 'st-unknown', 'help'], fixed: ['固定 · 只读', 'st-idle', 'lock'],
  };
  const DIFF = { add: ['新增', 'd-add', 'plus'], mod: ['修改', 'd-mod', 'edit'], repl: ['由细化替换', 'd-repl', 'split'], del: ['移除', 'd-del', 'minus'] };

  function collapse(nodes, edges, groups) {
    const closed = (groups || []).filter((g) => g.collapsed);
    if (!closed.length) return { nodes, edges };
    const map = {}; const out = [];
    nodes.forEach((n) => { const g = closed.find((x) => x.id === n.group); if (g) map[n.id] = 'grp:' + g.id; else out.push(n); });
    closed.forEach((g) => { if (Object.values(map).includes('grp:' + g.id)) out.push({ id: 'grp:' + g.id, groupNode: g, title: g.title, group: null, count: nodes.filter((n) => n.group === g.id && !n.gap).length, meta: g.meta }); });
    const seen = new Set(); const es = [];
    edges.forEach((e) => { const f = map[e.from] || e.from, t = map[e.to] || e.to; if (f === t) return; const k = f + '>' + t; if (seen.has(k)) return; seen.add(k); es.push(Object.assign({}, e, { from: f, to: t, label: map[e.from] || map[e.to] ? '' : e.label })); });
    // 合并后若产生环（不应发生），保留原样由校验层报错；这里只做展示
    return { nodes: out, edges: es };
  }
  function size(n) { return n.system ? [SYS_W, SYS_H] : n.port ? [PORT_W, PORT_H] : n.groupNode ? [GRP_W, GRP_H] : [NODE_W, NODE_H]; }
  function layout(nodes, edges, groups) {
    const ids = nodes.map((n) => n.id), rank = {}, inc = {};
    ids.forEach((id) => { rank[id] = 0; inc[id] = 0; });
    const es = edges.filter((e) => e.kind !== 'bad' && ids.includes(e.from) && ids.includes(e.to));
    es.forEach((e) => { inc[e.to] = (inc[e.to] || 0) + 1; });
    const q = ids.filter((id) => !inc[id]), deg = { ...inc }, order = [];
    while (q.length) { const id = q.shift(); order.push(id); es.filter((e) => e.from === id).forEach((e) => { rank[e.to] = Math.max(rank[e.to], rank[id] + 1); if (--deg[e.to] === 0) q.push(e.to); }); }
    ids.forEach((id) => { if (!order.includes(id)) order.push(id); });
    nodes.forEach((n) => { if (n.rank != null) rank[n.id] = n.rank; });
    const gi = (id) => { const n = nodes.find((m) => m.id === id); const k = (groups || []).findIndex((g) => g.id === n.group); return k < 0 ? 99 : k; };
    const cols = {};
    order.forEach((id) => { (cols[rank[id]] = cols[rank[id]] || []).push(id); });
    Object.values(cols).forEach((l) => l.sort((a, b) => (gi(a) - gi(b)) || (nodes.findIndex((n) => n.id === a) - nodes.findIndex((n) => n.id === b))));
    const pos = {}; let x = 0;
    Object.keys(cols).sort((a, b) => a - b).forEach((c) => {
      const list = cols[c];
      const sz = list.map((id) => size(nodes.find((n) => n.id === id)));
      const w = Math.max(...sz.map((s) => s[0]));
      let total = sz.reduce((a, s) => a + s[1], 0) + ROW_GAP * (list.length - 1);
      // 不同分组之间多留出框头的空间
      for (let i = 1; i < list.length; i++) if (gi(list[i]) !== gi(list[i - 1])) total += 40;
      let y = -total / 2;
      list.forEach((id, i) => { if (i && gi(id) !== gi(list[i - 1])) y += 40; pos[id] = { x: x + (w - sz[i][0]) / 2, y, w: sz[i][0], h: sz[i][1] }; y += sz[i][1] + ROW_GAP; });
      x += w + COL_GAP;
    });
    return pos;
  }
  function avatar(role, i) {
    if (!role) return `<span class="cv-av unbound" title="未绑定职业">?</span>`;
    if (role === '人工') return `<span class="cv-av human">${DS.icon('users', 'sm')}</span>`;
    const c = ROLE_COLORS[(role.charCodeAt(0) + (i || 0)) % ROLE_COLORS.length];
    return `<span class="cv-av" style="color:${c};background:color-mix(in srgb,${c} 16%,transparent)">${role.slice(0, 1)}</span>`;
  }

  window.PECanvas = function (host, opt) {
    host.classList.add('cv');
    host.innerHTML = `<div class="cv-world"><div class="cv-frames"></div><svg class="cv-edges"></svg><div class="cv-nodes"></div></div>
      <div class="cv-zoom" role="group" aria-label="画布缩放">
        <button class="icon-btn" data-z="out" aria-label="缩小">${DS.icon('minus', 'sm')}</button>
        <span class="cv-pct num">100%</span>
        <button class="icon-btn" data-z="in" aria-label="放大">${DS.icon('plus', 'sm')}</button>
        <span class="cv-sep"></span>
        <button class="btn ghost sm" data-z="fit">${DS.icon('target', 'sm')}适应画布</button>
      </div>`;
    const world = host.querySelector('.cv-world'), svg = host.querySelector('.cv-edges'), layer = host.querySelector('.cv-nodes'), frames = host.querySelector('.cv-frames');
    const st = { tx: 0, ty: 0, k: 1, sel: opt.selected || null, pos: {} };
    const apply = () => { world.style.transform = `translate(${st.tx}px,${st.ty}px) scale(${st.k})`; host.querySelector('.cv-pct').textContent = Math.round(st.k * 100) + '%'; opt.onView?.(api.view()); };

    function render() {
      const g = collapse(opt.nodes, opt.edges, opt.groups);
      const nodes = g.nodes, edges = g.edges;
      if (!nodes.length) { svg.innerHTML = ''; layer.innerHTML = ''; frames.innerHTML = ''; st.pos = {}; st.bounds = null; return; }
      st.pos = layout(nodes, edges, opt.groups);
      const P = st.pos;
      const xs = Object.values(P), minX = Math.min(...xs.map((p) => p.x)) - 50, minY = Math.min(...xs.map((p) => p.y)) - 80;
      const maxX = Math.max(...xs.map((p) => p.x + p.w)) + 50, maxY = Math.max(...xs.map((p) => p.y + p.h)) + 60;
      svg.setAttribute('viewBox', `${minX} ${minY} ${maxX - minX} ${maxY - minY}`);
      Object.assign(svg.style, { left: minX + 'px', top: minY + 'px', width: maxX - minX + 'px', height: maxY - minY + 'px' });
      st.bounds = { minX, minY, maxX, maxY };
      // 分组框（只为展开的组画）
      frames.innerHTML = (opt.groups || []).filter((gr) => !gr.collapsed).map((gr) => {
        const mem = nodes.filter((n) => n.group === gr.id && P[n.id]); if (!mem.length) return '';
        const x1 = Math.min(...mem.map((n) => P[n.id].x)) - 16, y1 = Math.min(...mem.map((n) => P[n.id].y)) - 40;
        const x2 = Math.max(...mem.map((n) => P[n.id].x + P[n.id].w)) + 16, y2 = Math.max(...mem.map((n) => P[n.id].y + P[n.id].h)) + 14;
        return `<div class="cv-frame ${gr.tone ? 'tone-' + gr.tone : ''}" style="left:${x1}px;top:${y1}px;width:${x2 - x1}px;height:${y2 - y1}px">
          <div class="cv-frame-h"><button class="cv-frame-t" data-grp="${gr.id}" aria-expanded="true" aria-label="折叠分组“${DS.esc(gr.title)}”">${DS.icon('chevDown', 'sm')}<span>${DS.esc(gr.title)}</span></button><span class="cv-frame-m">${DS.esc(gr.meta || '')}</span></div></div>`;
      }).join('');
      svg.innerHTML = `<defs><marker id="pe-arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" class="cv-arrow"/></marker></defs>` + edges.map((e) => {
        const a = P[e.from], b = P[e.to]; if (!a || !b) return '';
        let d;
        const x1 = a.x + a.w, y1 = a.y + a.h / 2, x2 = b.x, y2 = b.y + b.h / 2;
        if (x2 <= x1) { const yb = Math.max(a.y + a.h, b.y + b.h) + 46; d = `M${x1} ${y1} C${x1 + 60} ${y1} ${x1 + 60} ${yb} ${(x1 + x2) / 2} ${yb} S${x2 - 60} ${y2} ${x2} ${y2}`; }
        else { const mx = (x1 + x2) / 2; d = `M${x1} ${y1} C${mx} ${y1} ${mx} ${y2} ${x2} ${y2}`; }
        const sa = opt.statusOf?.(e.from), sb = opt.statusOf?.(e.to);
        const cls = e.kind ? 'k-' + e.kind : (sb === 'stall' || sb === 'fail' ? 'bad' : sb === 'run' ? 'live' : (sa === 'done' && sb && sb !== 'idle' && sb !== 'ready') ? 'done' : '');
        const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
        return `<path class="cv-edge ${cls}" d="${d}"${e.kind === 'bad' ? ' marker-end="url(#pe-arr)"' : ''}/>${e.label ? `<text class="cv-elabel ${e.kind ? 'k-' + e.kind : ''}" x="${x2 <= x1 ? (x1 + x2) / 2 : mx}" y="${x2 <= x1 ? Math.max(a.y + a.h, b.y + b.h) + 40 : my - 8}" text-anchor="middle">${DS.esc(e.label)}</text>` : ''}`;
      }).join('');
      layer.innerHTML = nodes.map((n, i) => {
        const p = P[n.id]; const s = opt.statusOf?.(n.id);
        const box = `left:${p.x}px;top:${p.y}px;width:${p.w}px;height:${p.h}px`;
        if (n.system) return `<button class="cv-sys" data-id="${n.id}" style="${box}" aria-label="${n.title}（系统节点）">${DS.icon(n.id === 'start' ? 'play' : 'check', 'sm')}${n.title}</button>`;
        if (n.port) return `<div class="cv-port ${n.port}" data-id="${n.id}" style="${box}" role="note" aria-label="只读边界端口：${DS.esc(n.title)}">${DS.icon('lock', 'sm')}<span class="grow"><b>${n.port === 'in' ? '入口' : '出口'} · 只读</b><br><span class="mono">${DS.esc(n.title)}</span></span></div>`;
        if (n.groupNode) {
          const gr = n.groupNode;
          return `<div class="cv-node cv-grp ${gr.tone ? 'tone-' + gr.tone : ''} ${st.sel === n.id ? 'sel' : ''}" data-id="${n.id}" style="${box}">
            <button class="cv-hit" data-grp="${gr.id}" aria-expanded="false" aria-label="分组“${DS.esc(gr.title)}”，已折叠，${n.count} 步，按回车展开"></button>
            <div class="cv-top"><span class="cv-title">${DS.icon('layers', 'sm')} ${DS.esc(gr.title)}</span>${gr.badge ? `<span class="badge ${gr.badge[1]}">${gr.badge[0]}</span>` : ''}</div>
            <div class="cv-role"><span class="ellipsis">${n.count ? n.count + ' 步 · 已折叠' : '未细化 · 0 个叶子步骤'}</span></div>
            <div class="cv-meta">${DS.esc(gr.meta || '')}</div></div>`;
        }
        if (n.gap) return `<div class="cv-node cv-gap" data-id="${n.id}" style="${box}" role="note" aria-label="缺口：${DS.esc(n.title)}"><div class="cv-top"><span class="cv-title">${DS.esc(n.title)}</span></div><div class="cv-meta" style="white-space:normal">${DS.esc(n.meta || '尚未生成')}</div></div>`;
        const S = s && STATUS[s]; const D = n.diff && DIFF[n.diff];
        const badge = n.badge ? `<span class="badge ${n.badge[1]}">${n.badge[2] ? DS.icon(n.badge[2], 'sm') : ''}${n.badge[0]}</span>` : D ? `<span class="badge ${D[1]}">${DS.icon(D[2], 'sm')}${D[0]}</span>` : S ? `<span class="badge ${S[1]}">${DS.icon(S[2], 'sm')}${S[0]}</span>` : '';
        const label = `${n.title}${S ? '，' + S[0] : ''}${D ? '，' + D[0] : ''}${n.lock ? '，已锁定' : ''}`;
        return `<div class="cv-node ${st.sel === n.id ? 'sel' : ''} ${s ? 's-' + s : ''} ${D ? D[1] : ''} ${n.lock ? 'locked' : ''} ${n.dim ? 'dim' : ''} ${n.flag ? 'flag-' + n.flag : ''}" data-id="${n.id}" style="${box}">
          <button class="cv-hit" aria-label="${DS.esc(label)}" aria-pressed="${st.sel === n.id}"></button>
          <div class="cv-top"><span class="cv-title">${n.lock ? DS.icon('lock', 'sm') + ' ' : ''}${DS.esc(n.title)}</span>${badge}</div>
          <div class="cv-role">${avatar(n.role, i)}<span class="ellipsis">${n.role ? DS.esc(n.role) : '<span style="color:var(--warn)">未绑定职业</span>'}</span></div>
          <div class="cv-meta">${DS.esc(n.meta || n.output || '')}</div>
          ${opt.editable && opt.editable(n) ? `<button class="cv-plus" data-after="${n.id}" aria-label="在“${DS.esc(n.title)}”后添加步骤" title="添加下一步">${DS.icon('plus', 'sm')}</button>` : ''}
        </div>`;
      }).join('');
    }
    function fit(animate) {
      const r = host.getBoundingClientRect(), b = st.bounds; if (!b || !r.width) return;
      const pad = 36, k = Math.min(1.05, Math.max(.5, Math.min((r.width - pad * 2) / (b.maxX - b.minX), (r.height - pad * 2 - 40) / (b.maxY - b.minY))));
      st.k = k; st.ty = (r.height - 30) / 2 - ((b.minY + b.maxY) / 2) * k;
      const gw = (b.maxX - b.minX) * k;
      st.tx = gw <= r.width - pad * 2 ? r.width / 2 - ((b.minX + b.maxX) / 2) * k : pad - b.minX * k;
      world.style.transition = animate ? 'transform .35s cubic-bezier(.2,.7,.2,1)' : 'none'; apply(); setTimeout(() => (world.style.transition = 'none'), 380);
    }
    function zoom(f, cx, cy) {
      const r = host.getBoundingClientRect(); cx = cx ?? r.width / 2; cy = cy ?? r.height / 2;
      const k = Math.min(2, Math.max(.3, st.k * f)); st.tx = cx - (cx - st.tx) * (k / st.k); st.ty = cy - (cy - st.ty) * (k / st.k); st.k = k; apply();
    }
    let drag = null;
    host.addEventListener('pointerdown', (e) => { if (e.target.closest('button,.cv-node,.cv-overlay,.cv-port')) return; drag = { x: e.clientX, y: e.clientY, tx: st.tx, ty: st.ty }; host.setPointerCapture(e.pointerId); host.classList.add('panning'); });
    host.addEventListener('pointermove', (e) => { if (!drag) return; st.tx = drag.tx + e.clientX - drag.x; st.ty = drag.ty + e.clientY - drag.y; apply(); });
    host.addEventListener('pointerup', (e) => { if (drag && Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y) < 4) { st.sel = null; render(); opt.onSelect?.(null); } drag = null; host.classList.remove('panning'); });
    host.addEventListener('wheel', (e) => { if (e.target.closest('.cv-overlay')) return; e.preventDefault(); if (e.ctrlKey || e.metaKey) { const r = host.getBoundingClientRect(); zoom(e.deltaY < 0 ? 1.1 : 0.9, e.clientX - r.left, e.clientY - r.top); } else { st.tx -= e.deltaX; st.ty -= e.deltaY; apply(); } }, { passive: false });
    host.addEventListener('click', (e) => {
      if (e.target.closest('.cv-overlay')) return;
      const z = e.target.closest('[data-z]'); if (z) { if (z.dataset.z === 'fit') fit(true); else zoom(z.dataset.z === 'in' ? 1.2 : 1 / 1.2); return; }
      const gb = e.target.closest('[data-grp]'); if (gb) { opt.onToggleGroup?.(gb.dataset.grp); return; }
      const plus = e.target.closest('.cv-plus'); if (plus) { opt.onAddAfter?.(plus.dataset.after, plus); return; }
      const sys = e.target.closest('.cv-sys'); if (sys) { opt.onSelect?.(sys.dataset.id, true); return; }
      const node = e.target.closest('.cv-node:not(.cv-gap)'); if (node) { api.select(node.dataset.id); }
    });
    host.addEventListener('keydown', (e) => { if (e.target.closest('input,textarea,select,.cv-overlay')) return; if (e.key === '=' || e.key === '+') zoom(1.2); if (e.key === '-') zoom(1 / 1.2); });
    window.addEventListener('resize', () => fit(false));
    const api = {
      render() { render(); }, fit, zoom,
      set(o) { Object.assign(opt, o); render(); },
      select(id) { st.sel = id; render(); opt.onSelect?.(id); const b = layer.querySelector(`.cv-node[data-id="${CSS.escape(id || '')}"] .cv-hit`); if (b && document.activeElement && host.contains(document.activeElement)) b.focus(); },
      get selected() { return st.sel; },
      focusNode(id) {
        const p = st.pos[id], r = host.getBoundingClientRect(); if (!p) return;
        st.tx = r.width * 0.42 - (p.x + p.w / 2) * st.k; st.ty = (r.height - 30) / 2 - (p.y + p.h / 2) * st.k;
        world.style.transition = 'transform .35s cubic-bezier(.2,.7,.2,1)'; apply(); setTimeout(() => (world.style.transition = 'none'), 380); this.select(id);
      },
      view() { return { tx: Math.round(st.tx), ty: Math.round(st.ty), k: +st.k.toFixed(3) }; },
      restore(v) { if (!v) return; Object.assign(st, v); apply(); },
    };
    render(); requestAnimationFrame(() => { if (opt.view) api.restore(opt.view); else fit(false); });
    return api;
  };
  window.PECanvas.STATUS = STATUS; window.PECanvas.DIFF = DIFF;
})();
