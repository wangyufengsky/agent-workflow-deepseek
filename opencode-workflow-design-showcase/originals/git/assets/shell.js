/* opencode-workflow · deepseek 风原型外壳（Git 仓库页 · 隔离原型副本）
   复制自节点执行详情原型的隔离副本（源头 deepseek/assets/shell.js），本副本的改动：
   - 侧栏「工作区」组在「项目」之后新增「Git 仓库」（图标 gitRepo），本原型高亮它
   - 侧栏其他导航只提示“设计样例只包含 Git 仓库页”
   - 主题只读 URL 参数 ?theme=（兼容旧 ?skin=），映射到 <html data-skin>；不读写浏览器本机存储
   - 切换主题只改内存与地址栏（history.replaceState），不发任何请求
   - 侧栏导航不跳出原型（原型只包含节点执行详情），运行环境卡写“设计样例 · 未连接”
   - mount({proto:false}) 时不插入原稿的原型状态条（本原型自带控制条）
*/
(function () {
  const SKINS = [['deepseek', 'deepseek 风'], ['warm', 'claude 风'], ['spdb', 'SPDB'], ['github-white', 'GitHub 白']];
  function readSkin() {
    const sp = new URLSearchParams(location.search);
    const q = sp.get('theme') || sp.get('skin');
    if (q && SKINS.some((x) => x[0] === q)) return q;
    return 'deepseek';
  }
  function setSkin(k) {
    if (!SKINS.some((x) => x[0] === k)) return;
    document.documentElement.dataset.skin = k;
    try { const u = new URL(location.href); u.searchParams.set('theme', k); u.searchParams.delete('skin'); history.replaceState(null, '', u.toString()); } catch (e) {}
    document.querySelectorAll('select[data-skin-select]').forEach((el) => { el.value = k; });
    document.dispatchEvent(new CustomEvent('skinchange', { detail: k }));
  }
  document.documentElement.dataset.skin = readSkin();
  const ICONS = {
    home: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z',
    folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
    book: 'M4 5.5A1.5 1.5 0 0 1 5.5 4H10a2 2 0 0 1 2 2v14a2 2 0 0 0-2-2H4zM20 5.5A1.5 1.5 0 0 0 18.5 4H14a2 2 0 0 0-2 2v14a2 2 0 0 1 2-2h6z',
    slides: 'M3 4h18v12H3zM12 16v4M8 20h8',
    plus: 'M12 5v14M5 12h14',
    flow: 'M3 3h7v6H3zM14 15h7v6h-7zM6.5 9v2.5A3.5 3.5 0 0 0 10 15h4',
    list: 'M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01',
    inbox: 'M3 13l3-8h12l3 8v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1zM3 13h5l1.5 2.5h5L16 13h5',
    chart: 'M4 20V11M10 20V5M16 20v-6M2 20h20',
    template: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM16.5 13v7M13 16.5h7',
    server: 'M3 4h18v7H3zM3 13h18v7H3zM7 7.5h.01M7 16.5h.01',
    tool: 'M14.7 6.3a4 4 0 0 0-5.4 5.4L3.6 17.4a2 2 0 0 0 2.8 2.8l5.7-5.7a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-.6-.6-2.4z',
    db: 'M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zM4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3',
    users: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21c.7-3.6 3.6-6 7-6s6.3 2.4 7 6M16 3.5a4 4 0 0 1 0 7.5M18.5 14.5c1.8.9 3 2.9 3.5 6',
    settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
    search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4',
    chevDown: 'M6 9l6 6 6-6', chevRight: 'M9 6l6 6-6 6', chevLeft: 'M15 6l-6 6 6 6',
    arrowRight: 'M5 12h14M13 6l6 6-6 6', arrowLeft: 'M19 12H5M11 6l-6 6 6 6', arrowUp: 'M12 19V5M6 11l6-6 6 6',
    x: 'M6 6l12 12M18 6 6 18', minus: 'M5 12h14',
    undo: 'M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11', redo: 'M15 14l5-5-5-5M20 9H9.5a5.5 5.5 0 0 0 0 11H13',
    split: 'M6 3v6a6 6 0 0 0 6 6h0a6 6 0 0 1 6 6M18 3v6a6 6 0 0 1-6 6',
    zap: 'M13 2 4 14h7l-1 8 9-12h-7z', panel: 'M3 4h18v16H3zM15 4v16', check: 'M5 12.5l4.5 4.5L19 7.5',
    more: 'M5 12h.01M12 12h.01M19 12h.01',
    refresh: 'M20 12a8 8 0 1 1-2.3-5.7M20 4v4h-4',
    play: 'M7 5v14l11-7z', pause: 'M7 5h3v14H7zM14 5h3v14h-3z', stop: 'M6 6h12v12H6z',
    branch: 'M6 3v12M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 9a9 9 0 0 1-9 9',
    git: 'M12 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM12 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM12 9v6',
    file: 'M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8zM14 3v5h5M9 13h6M9 17h4',
    doc: 'M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8zM14 3v5h5',
    link: 'M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1',
    info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5M12 8h.01',
    alert: 'M12 3 2 20h20zM12 10v4M12 17h.01',
    help: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 1-1 1.7M12 17h.01',
    lock: 'M6 11h12v10H6zM8.5 11V7.5a3.5 3.5 0 0 1 7 0V11',
    sparkle: 'M12 3l1.8 5.6L19.5 10l-5.7 1.6L12 17l-1.8-5.4L4.5 10l5.7-1.4z',
    clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
    edit: 'M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16zM13.5 6.5l4 4',
    trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
    copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
    eye: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
    external: 'M14 4h6v6M20 4l-9 9M18 14v6H4V6h6',
    target: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 12h.01',
    layers: 'M12 3 2 8l10 5 10-5zM2 13l10 5 10-5',
    shield: 'M12 3 4 6v6c0 5 3.4 8 8 9 4.6-1 8-4 8-9V6z',
    terminal: 'M4 5h16v14H4zM8 10l3 2-3 2M13 15h3',
    archive: 'M3 4h18v4H3zM5 8v12h14V8M10 12h4',
    upload: 'M12 16V4M7 9l5-5 5 5M4 16v4h16v-4',
    download: 'M12 4v12M7 11l5 5 5-5M4 20h16',
    filter: 'M4 5h16l-6 8v6l-4-2v-4z',
    wand: 'M15 4V2M15 10V8M11 6h2M17 6h2M4 20 14 10M19.5 14.5l1 1M19.5 9.5l1-1',
    calendar: 'M4 5h16v16H4zM4 10h16M9 3v4M15 3v4',
    pin: 'M12 22s7-6.3 7-12a7 7 0 0 0-14 0c0 5.7 7 12 7 12zM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
    send: 'M12 19V5M6 11l6-6 6 6',
    logo: 'M20 12a8 8 0 1 1-3-6.2M20 4v4h-4M12 14.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
    gitRepo: 'M6 3.5v11M6 20.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM18 8.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM18 8.5c0 5-6 4.5-11 9',
  };
  const icon = (name, cls = '') => `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true"><path d="${ICONS[name] || ICONS.info}"/></svg>`;

  const NAV = [
    { cap: '工作区' },
    { id: 'home', label: '主页', icon: 'home', href: 'home.html' },
    { id: 'projects', label: '项目', icon: 'folder', href: 'projects.html' },
    { id: 'git', label: 'Git 仓库', icon: 'gitRepo', href: 'index.html' },
    { id: 'knowledge', label: '知识库', icon: 'book', href: 'knowledge.html' },
    { id: 'ppt', label: 'PPT 制作', icon: 'slides', href: 'ppt.html' },
    { cap: '规划与执行' },
    { id: 'workflows', label: '流程', icon: 'flow', href: 'workflows.html' },
    { id: 'tasks', label: '任务列表', icon: 'list', href: 'tasks.html' },
    { id: 'inbox', label: '待处理中心', icon: 'inbox', href: 'inbox.html', count: 2 },
    { id: 'insights', label: '质量与用量', icon: 'chart', href: 'insights.html' },
    { id: 'templates', label: '模板任务', icon: 'template', href: 'templates.html' },
    { cap: '系统' },
    { id: 'runtime', label: '运行环境', icon: 'server', href: 'runtime.html' },
    { id: 'tools', label: '工具与 Skill', icon: 'tool', href: 'tools.html' },
    { id: 'databases', label: '数据库', icon: 'db', href: 'databases.html' },
    { id: 'roles', label: '角色管理', icon: 'users', href: 'roles.html' },
    { id: 'settings', label: '设置', icon: 'settings', href: 'settings.html' },
  ];

  function navHTML(active) { return SC.navHTML(active, icon);
  }

  /* ---------- 小工具 ---------- */
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const params = new URLSearchParams(location.search);

  /* ---------- 抽屉 / 对话框 ---------- */
  let lastTrigger = null;
  function openDrawer(id, trigger) {
    const d = document.getElementById(id); if (!d) return;
    lastTrigger = trigger || document.activeElement;
    ensureScrim().classList.add('open');
    d.classList.add('open'); d.setAttribute('aria-hidden', 'false');
    setTimeout(() => (d.querySelector('[autofocus],input,button') || d).focus(), 60);
  }
  function closeDrawer(id) {
    const d = id ? document.getElementById(id) : $('.drawer.open'); if (!d) return;
    d.classList.remove('open'); d.setAttribute('aria-hidden', 'true');
    if (!$('.drawer.open') && !$('.dialog.open')) ensureScrim().classList.remove('open');
    if (lastTrigger && lastTrigger.focus) lastTrigger.focus();
  }
  function openDialog(id, trigger) { lastTrigger = trigger || document.activeElement; ensureScrim().classList.add('open'); const d = document.getElementById(id); d.classList.add('open'); setTimeout(() => (d.querySelector('[autofocus],button') || d).focus(), 60); }
  function closeDialog(id) { const d = id ? document.getElementById(id) : $('.dialog.open'); if (!d) return; d.classList.remove('open'); if (!$('.drawer.open')) ensureScrim().classList.remove('open'); if (lastTrigger && lastTrigger.focus) lastTrigger.focus(); }
  function ensureScrim() {
    let s = $('.scrim');
    if (!s) { s = document.createElement('div'); s.className = 'scrim'; s.addEventListener('click', () => { if ($('.dialog.open')) return; closeDrawer(); }); document.body.appendChild(s); }
    return s;
  }
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { if ($('.dialog.open')) closeDialog(); else if ($('.drawer.open')) closeDrawer(); else $$('.menu').forEach((m) => m.remove()); } });

  function toast(msg, kind = 'ok') {
    let host = $('.toast-host'); if (!host) { host = document.createElement('div'); host.className = 'toast-host'; host.setAttribute('role', 'status'); document.body.appendChild(host); }
    const t = document.createElement('div'); t.className = 'toast';
    const color = { ok: 'var(--ok)', info: 'var(--accent)', warn: 'var(--warn)', danger: 'var(--danger)' }[kind];
    t.innerHTML = `<span class="dot" style="color:${color}"></span>${esc(msg)}`;
    host.appendChild(t); setTimeout(() => { t.style.transition = 'opacity .3s'; t.style.opacity = '0'; setTimeout(() => t.remove(), 320); }, 2600);
  }

  function menu(trigger, items) {
    $$('.menu').forEach((m) => m.remove());
    const m = document.createElement('div'); m.className = 'menu'; m.setAttribute('role', 'menu');
    m.innerHTML = items.map((it, i) => it === '-' ? '<hr>' : `<button role="menuitem" data-i="${i}" class="${it.danger ? 'danger' : ''}">${it.icon ? icon(it.icon) : ''}${esc(it.label)}</button>`).join('');
    document.body.appendChild(m);
    const r = trigger.getBoundingClientRect();
    m.style.top = r.bottom + 6 + window.scrollY + 'px';
    m.style.left = Math.max(8, Math.min(r.right - m.offsetWidth, innerWidth - m.offsetWidth - 8)) + 'px';
    m.addEventListener('click', (e) => { const b = e.target.closest('button[data-i]'); if (!b) return; m.remove(); items[+b.dataset.i].run?.(); });
    setTimeout(() => document.addEventListener('click', function off(e) { if (!m.contains(e.target)) { m.remove(); document.removeEventListener('click', off); } }), 0);
    m.querySelector('button')?.focus();
  }

  /* ---------- 原型状态切换器 ---------- */
  function protoBar(states, current) {
    if (!states || !states.length) return '';
    const opts = states.map((s) => `<option value="${s.id}"${s.id === current ? ' selected' : ''}>${esc(s.label)}</option>`).join('');
    return `<div class="proto" role="region" aria-label="原型状态（非产品界面）">
      <span>原型状态</span>
      <select aria-label="切换原型状态" onchange="DS.setState(this.value)">${opts}</select>
      ${skinSelect()}
    </div>`;
  }
  function skinSelect() {
    const cur = document.documentElement.dataset.skin;
    return `<select data-skin-select aria-label="预览皮肤" onchange="DS.setSkin(this.value)">${SKINS.map(([k, l]) => `<option value="${k}"${k === cur ? ' selected' : ''}>${l}</option>`).join('')}</select>`;
  }
  function setState(id) { const p = new URLSearchParams(location.search); p.set('state', id); p.set('theme', document.documentElement.dataset.skin); p.delete('skin'); location.search = p.toString(); }

  /* ---------- 挂载 ---------- */
  function mount(opts) {
    const page = document.body.dataset.page;
    const app = document.createElement('div'); app.className = 'app';
    app.innerHTML = `<nav class="nav" aria-label="主导航">${navHTML(page)}</nav>
      <div class="main">
        <header class="header">${opts.header || ''}</header>
        <div class="content" id="content"></div>
      </div>`;
    const slot = document.getElementById('page');
    document.body.insertBefore(app, document.body.firstChild);
    $('#content', app).appendChild(slot);
    slot.hidden = false;
    if (opts.proto !== false) document.body.insertAdjacentHTML('beforeend', opts.states ? protoBar(opts.states, opts.state)
      : `<div class="proto" role="region" aria-label="原型控制（非产品界面）"><span>皮肤</span>${skinSelect()}</div>`);
    app.addEventListener('click', (e) => { const a = e.target.closest('[data-proto-nav]'); if (!a) return; e.preventDefault(); if (a.dataset.protoNav === 'Git 仓库') { document.dispatchEvent(new CustomEvent('gitnav')); return; } toast('设计样例只包含 Git 仓库页，“' + a.dataset.protoNav + '”不在本原型内', 'info'); });
  }

  // 自动替换 data-icon 占位（mount 时与 DOMContentLoaded 时各跑一次；动态内容可手动调用 DS.icons()）
  function icons(root = document) { $$('[data-icon]', root).forEach((el) => { el.insertAdjacentHTML('afterbegin', icon(el.dataset.icon, el.dataset.iconSize || '')); el.removeAttribute('data-icon'); }); }
  window.DS = { SKINS, setSkin, skinSelect, icon, icons, ICONS, $, $$, esc, params, mount: (o) => { mount(o); icons(); }, openDrawer, closeDrawer, openDialog, closeDialog, toast, menu, setState, state: params.get('state') };
  document.addEventListener('DOMContentLoaded', () => icons());
})();
