/* opencode-workflow · deepseek 风 流程画布组件（原型）
   用于：流程画布（定义编辑）、需求画布（计划审阅）、任务执行画布（运行视图）。
   - 自动分层布局：从左到右，按最长路径分列；同列节点竖向居中排列
   - 平移：拖动空白处；缩放：Ctrl/⌘ + 滚轮，或右下角按钮；“适应画布”
   - 节点：职业头像 + 名称 + 可选状态徽标 + 底部说明；系统节点（开始 / 交付）为小胶囊
   - 编辑模式：悬停节点出现右侧 “+”；连线中点出现 “+”（插入步骤）
   用法：const cv = DSCanvas(el, { nodes, edges, editable, onSelect, onAddAfter, onInsert, statusOf })
*/
(function () {
  const NODE_W = 204, NODE_H = 100, SYS_W = 96, SYS_H = 40, COL_GAP = 60, ROW_GAP = 24;
  const ROLE_COLORS = [1, 2, 3, 4, 5, 6].map((n) => `var(--role-${n})`);
  const STATUS = {
    idle: ['待执行', 'st-idle', 'clock'], ready: ['待执行 · 可修改', 'st-idle', 'edit'], claimed: ['已被领取', 'st-wait', 'lock'],
    run: ['执行中', 'st-run', 'play'], review: ['待验收', 'st-wait', 'eye'], done: ['已完成', 'st-done', 'check'],
    stall: ['停滞', 'st-stall', 'alert'], fail: ['失败', 'st-fail', 'x'], wait: ['等待你处理', 'st-wait', 'help'],
    skip: ['已移出计划', 'st-idle', 'archive'], unknown: ['状态未核对', 'st-unknown', 'help'],
  };

  function layout(nodes, edges) {
    const ids = nodes.map((n) => n.id), rank = {}, inc = {};
    ids.forEach((id) => { rank[id] = 0; inc[id] = 0; });
    edges.forEach((e) => { inc[e.to] = (inc[e.to] || 0) + 1; });
    // 最长路径分层（拓扑序）
    const q = ids.filter((id) => !inc[id]), deg = { ...inc }, order = [];
    while (q.length) { const id = q.shift(); order.push(id); edges.filter((e) => e.from === id).forEach((e) => { rank[e.to] = Math.max(rank[e.to], rank[id] + 1); if (--deg[e.to] === 0) q.push(e.to); }); }
    const cols = {};
    order.forEach((id) => { (cols[rank[id]] = cols[rank[id]] || []).push(id); });
    const pos = {};
    let x = 0;
    Object.keys(cols).sort((a, b) => a - b).forEach((c) => {
      const list = cols[c];
      const sizes = list.map((id) => nodes.find((n) => n.id === id).system ? SYS_H : NODE_H);
      const w = Math.max(...list.map((id) => nodes.find((n) => n.id === id).system ? SYS_W : NODE_W));
      const total = sizes.reduce((a, b) => a + b, 0) + ROW_GAP * (list.length - 1);
      let y = -total / 2;
      list.forEach((id, i) => { const n = nodes.find((m) => m.id === id); const nw = n.system ? SYS_W : NODE_W; pos[id] = { x: x + (w - nw) / 2, y, w: nw, h: sizes[i] }; y += sizes[i] + ROW_GAP; });
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

  window.DSCanvas = function (host, opt) {
    host.classList.add('cv');
    host.innerHTML = `<div class="cv-world"><svg class="cv-edges"></svg><div class="cv-nodes"></div></div>
      <div class="cv-zoom" role="group" aria-label="画布缩放">
        <button class="icon-btn" data-z="out" aria-label="缩小">${DS.icon('minus', 'sm')}</button>
        <span class="cv-pct num">100%</span>
        <button class="icon-btn" data-z="in" aria-label="放大">${DS.icon('plus', 'sm')}</button>
        <span class="cv-sep"></span>
        <button class="btn ghost sm" data-z="fit">${DS.icon('target', 'sm')}适应画布</button>
      </div>`;
    const world = host.querySelector('.cv-world'), svg = host.querySelector('.cv-edges'), layer = host.querySelector('.cv-nodes');
    const st = { tx: 0, ty: 0, k: 1, sel: null, pos: {} };
    const apply = () => { world.style.transform = `translate(${st.tx}px,${st.ty}px) scale(${st.k})`; host.querySelector('.cv-pct').textContent = Math.round(st.k * 100) + '%'; };

    function render() {
      const { nodes, edges } = opt;
      if (!nodes.length) { svg.innerHTML = ''; layer.innerHTML = ''; st.pos = {}; st.bounds = null; return; }
      st.pos = layout(nodes, edges);
      const P = st.pos;
      const xs = Object.values(P), minX = Math.min(...xs.map((p) => p.x)) - 40, minY = Math.min(...xs.map((p) => p.y)) - 60;
      const maxX = Math.max(...xs.map((p) => p.x + p.w)) + 40, maxY = Math.max(...xs.map((p) => p.y + p.h)) + 60;
      svg.setAttribute('viewBox', `${minX} ${minY} ${maxX - minX} ${maxY - minY}`);
      Object.assign(svg.style, { left: minX + 'px', top: minY + 'px', width: maxX - minX + 'px', height: maxY - minY + 'px' });
      st.bounds = { minX, minY, maxX, maxY };
      // 连线
      svg.innerHTML = edges.map((e, i) => {
        const a = P[e.from], b = P[e.to]; if (!a || !b) return '';
        const x1 = a.x + a.w, y1 = a.y + a.h / 2, x2 = b.x, y2 = b.y + b.h / 2, mx = (x1 + x2) / 2;
        const sa = opt.statusOf?.(e.from), sb = opt.statusOf?.(e.to);
        const cls = sb === 'stall' || sb === 'fail' ? 'bad' : sb === 'run' ? 'live' : (sa === 'done' && sb && sb !== 'idle' && sb !== 'ready') ? 'done' : '';
        return `<path class="cv-edge ${cls}" d="M${x1} ${y1} C${mx} ${y1} ${mx} ${y2} ${x2} ${y2}"/>${e.label ? `<text class="cv-elabel" x="${mx}" y="${(y1 + y2) / 2 - 8}" text-anchor="middle">${DS.esc(e.label)}</text>` : ''}`;
      }).join('');
      // 节点
      layer.innerHTML = nodes.map((n, i) => {
        const p = P[n.id];
        const s = opt.statusOf?.(n.id);
        if (n.system) return `<button class="cv-sys" data-id="${n.id}" style="left:${p.x}px;top:${p.y}px;width:${p.w}px;height:${p.h}px" aria-label="${n.title}（系统节点）">${DS.icon(n.id === 'start' ? 'play' : 'check', 'sm')}${n.title}</button>`;
        const S = s && STATUS[s];
        return `<div class="cv-node ${st.sel === n.id ? 'sel' : ''} ${s ? 's-' + s : ''}" data-id="${n.id}" style="left:${p.x}px;top:${p.y}px;width:${p.w}px;height:${p.h}px">
          <button class="cv-hit" aria-label="${DS.esc(n.title)}${S ? '，' + S[0] : ''}" aria-pressed="${st.sel === n.id}"></button>
          <div class="cv-top"><span class="cv-title">${DS.esc(n.title)}</span>${S ? `<span class="badge ${S[1]}">${DS.icon(S[2], 'sm')}${S[0]}</span>` : ''}</div>
          <div class="cv-role">${avatar(n.role, i)}<span class="ellipsis">${n.role ? DS.esc(n.role) : '<span style="color:var(--warn)">未绑定职业</span>'}</span></div>
          <div class="cv-meta">${DS.esc(n.meta || n.output || '')}</div>
          ${opt.editable && opt.editable(n) ? `<button class="cv-plus" data-after="${n.id}" aria-label="在“${DS.esc(n.title)}”后添加步骤" title="添加下一步">${DS.icon('plus', 'sm')}</button>` : ''}
        </div>`;
      }).join('') + (opt.editable ? edges.map((e) => {
        const a = P[e.from], b = P[e.to]; if (!a || !b) return '';
        const from = nodes.find((n) => n.id === e.from), to = nodes.find((n) => n.id === e.to);
        if (!opt.canInsert || !opt.canInsert(from, to)) return '';
        const x = (a.x + a.w + b.x) / 2 - 11, y = (a.y + a.h / 2 + b.y + b.h / 2) / 2 - 11;
        return `<button class="cv-ins" data-from="${e.from}" data-to="${e.to}" style="left:${x}px;top:${y}px" aria-label="在“${DS.esc(from.title)}”和“${DS.esc(to.title)}”之间插入步骤">${DS.icon('plus', 'sm')}</button>`;
      }).join('') : '');
    }

    function fit(animate) {
      const r = host.getBoundingClientRect(), b = st.bounds; if (!b || !r.width) return;
      const pad = 40, k = Math.min(1.05, Math.max(.55, Math.min((r.width - pad * 2) / (b.maxX - b.minX), (r.height - pad * 2 - 40) / (b.maxY - b.minY))));
      st.k = k; st.ty = (r.height - 40) / 2 - ((b.minY + b.maxY) / 2) * k;
      const gw = (b.maxX - b.minX) * k;  // 图比画布宽时，左对齐让“开始”可见，其余可平移查看
      st.tx = gw <= r.width - pad * 2 ? r.width / 2 - ((b.minX + b.maxX) / 2) * k : pad - b.minX * k;
      world.style.transition = animate ? 'transform .35s cubic-bezier(.2,.7,.2,1)' : 'none'; apply(); setTimeout(() => (world.style.transition = 'none'), 380);
    }
    function zoom(f, cx, cy) {
      const r = host.getBoundingClientRect(); cx = cx ?? r.width / 2; cy = cy ?? r.height / 2;
      const k = Math.min(2, Math.max(.3, st.k * f)); st.tx = cx - (cx - st.tx) * (k / st.k); st.ty = cy - (cy - st.ty) * (k / st.k); st.k = k; apply();
    }
    // 交互
    let drag = null;
    host.addEventListener('pointerdown', (e) => { if (e.target.closest('button,.cv-node')) return; drag = { x: e.clientX, y: e.clientY, tx: st.tx, ty: st.ty }; host.setPointerCapture(e.pointerId); host.classList.add('panning'); });
    host.addEventListener('pointermove', (e) => { if (!drag) return; st.tx = drag.tx + e.clientX - drag.x; st.ty = drag.ty + e.clientY - drag.y; apply(); });
    host.addEventListener('pointerup', (e) => { if (drag && Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y) < 4) { st.sel = null; render(); opt.onSelect?.(null); } drag = null; host.classList.remove('panning'); });
    host.addEventListener('wheel', (e) => { e.preventDefault(); if (e.ctrlKey || e.metaKey) { const r = host.getBoundingClientRect(); zoom(e.deltaY < 0 ? 1.1 : 0.9, e.clientX - r.left, e.clientY - r.top); } else { st.tx -= e.deltaX; st.ty -= e.deltaY; apply(); } }, { passive: false });
    host.addEventListener('click', (e) => {
      const z = e.target.closest('[data-z]'); if (z) { if (z.dataset.z === 'fit') fit(true); else zoom(z.dataset.z === 'in' ? 1.2 : 1 / 1.2); return; }
      const plus = e.target.closest('.cv-plus'); if (plus) { opt.onAddAfter?.(plus.dataset.after, plus); return; }
      const ins = e.target.closest('.cv-ins'); if (ins) { opt.onInsert?.(ins.dataset.from, ins.dataset.to, ins); return; }
      const sys = e.target.closest('.cv-sys'); if (sys) { opt.onSelect?.(sys.dataset.id, true); return; }
      const node = e.target.closest('.cv-node'); if (node) { api.select(node.dataset.id); }
    });
    host.addEventListener('keydown', (e) => { if ((e.key === '=' || e.key === '+') && !e.target.closest('input,textarea')) zoom(1.2); if (e.key === '-' && !e.target.closest('input,textarea')) zoom(1 / 1.2); });
    window.addEventListener('resize', () => fit(false));

    const api = {
      render() { render(); },
      fit, zoom,
      select(id) { st.sel = id; render(); opt.onSelect?.(id); },
      get selected() { return st.sel; },
      focusNode(id) { // 平移到节点并选中（保持缩放）
        const p = st.pos[id], r = host.getBoundingClientRect(); if (!p) return;
        st.tx = r.width * 0.38 - (p.x + p.w / 2) * st.k; st.ty = (r.height - 40) / 2 - (p.y + p.h / 2) * st.k;
        world.style.transition = 'transform .35s cubic-bezier(.2,.7,.2,1)'; apply(); setTimeout(() => (world.style.transition = 'none'), 380); this.select(id);
      },
      reveal(id) { // 节点被右侧面板遮住时平移进可见区，缩放不变
        requestAnimationFrame(() => {
          const p = st.pos[id], r = host.getBoundingClientRect(); if (!p) return;
          const x1 = st.tx + p.x * st.k, x2 = st.tx + (p.x + p.w) * st.k;
          let dx = 0; if (x2 > r.width - 24) dx = r.width - 24 - x2; if (x1 + dx < 24) dx = 24 - x1;
          if (!dx) return; st.tx += dx; world.style.transition = 'transform .35s cubic-bezier(.2,.7,.2,1)'; apply(); setTimeout(() => (world.style.transition = 'none'), 380);
        });
      },
      view() { return { tx: st.tx, ty: st.ty, k: st.k }; },
      restore(v) { Object.assign(st, v); apply(); },
    };
    render(); requestAnimationFrame(() => fit(false));
    return api;
  };
  window.DSCanvas.STATUS = STATUS;
})();
