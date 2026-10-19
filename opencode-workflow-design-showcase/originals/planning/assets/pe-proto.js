/* 普通流程 AI 规划补充稿 · 原型公共脚本（设计样例 · 全部模拟；不发请求、不写本机存储）
   - PE.init(page) → 当前状态 id（URL ?state=，否则本页第一个状态）
   - PE.ctx(k) / PE.setCtx({k:v}) → 读写 URL 里的返回上下文（replaceState，不新增历史，前进/后退不会重放命令）
   - PE.to(id, extra) → 命令结果：用 replaceState 切换状态并重绘（不留下可被“后退”重放的命令历史）
   - PE.link(id, extra) / PE.nav(id, extra) → 普通导航（跨页或同页，进入浏览器历史）
   - PE.mountProto({onEvent}) → 底部原型控制条：切状态、主题、减弱动态、模拟服务事件、说明、状态总览 */
(function () {
  const STATES = window.PE_STATES || [];
  const byId = Object.fromEntries(STATES.map((s) => [s.id, s]));
  const P = () => new URLSearchParams(location.search);
  let page = '', state = '', onRender = null;
  if (P().get('motion') === 'reduce' || (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches)) document.documentElement.classList.add('reduced');
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  /* 返回上下文字段（URL 即持久样例）：project, execution, requirement, round, sel, tab, view, returnTo, theme */
  const CTX = ['task', 'project', 'execution', 'requirement', 'round', 'sel', 'tab', 'view', 'returnTo', 'from', 'layer', 'sub'];
  function init(pg, render) {
    page = pg; onRender = render || null;
    const want = P().get('state');
    const mine = STATES.filter((s) => s.page === pg);
    state = (want && byId[want] && byId[want].page === pg) ? want : (mine[0] ? mine[0].id : '');
    return state;
  }
  function ctx(k) { return P().get(k); }
  function setCtx(obj, push) {
    const u = new URL(location.href);
    Object.entries(obj).forEach(([k, v]) => { if (v === null || v === undefined || v === '') u.searchParams.delete(k); else u.searchParams.set(k, typeof v === 'string' ? v : JSON.stringify(v)); });
    (push ? history.pushState : history.replaceState).call(history, history.state, '', u);
  }
  function keepCtx(extra) {
    const o = {}; const p = P(); ['task', 'project', 'execution', 'requirement', 'returnTo', 'from'].forEach((k) => { if (p.get(k)) o[k] = p.get(k); });
    return Object.assign(o, extra || {});
  }
  function href(id, extra) { const s = byId[id]; return s ? PEN.url(s.page, Object.assign(keepCtx(), { state: id }, extra || {})) : '#'; }
  function nav(id, extra) { location.href = href(id, extra); }
  /* 命令结果：同页 replaceState + 重绘；跨页 location.replace（不留下“命令前”的历史条目） */
  function to(id, extra) {
    const s = byId[id]; if (!s) return;
    if (s.page !== page || !onRender) { location.replace(href(id, extra)); return; }
    state = id; setCtx(Object.assign({ state: id }, extra || {}));
    const sel = document.getElementById('peStateSel'); if (sel) sel.value = id;
    onRender(id);
  }
  window.addEventListener('popstate', () => { const w = P().get('state'); if (onRender && w && byId[w] && byId[w].page === page && w !== state) { state = w; onRender(w); } });

  let eventFn = null;
  function setEvent(label, fn) {
    eventFn = fn; const b = document.getElementById('peEvent'); if (!b) return;
    b.disabled = !fn; b.innerHTML = `▶ ${esc(fn ? label : '无可模拟的服务事件')}`;
    b.title = fn ? '原型：模拟服务端发生的下一件事（产品里由服务事件推进，不由前端定时器推进）' : '';
  }
  function mountProto() {
    const groups = [];
    STATES.forEach((s) => { let g = groups.find((x) => x[0] === s.group); if (!g) groups.push(g = [s.group, []]); g[1].push(s); });
    const opts = groups.map(([g, list]) => `<optgroup label="${esc(g)}">${list.map((s) => `<option value="${s.id}"${s.id === state ? ' selected' : ''}>${esc(s.id.toUpperCase())} · ${esc(s.label)}</option>`).join('')}</optgroup>`).join('');
    const skins = (window.DS && DS.SKINS) || [];
    const cur = document.documentElement.dataset.skin;
    document.body.insertAdjacentHTML('beforeend', `<div class="proto-dock"></div>
      <div class="proto" role="region" aria-label="原型控制（非产品界面）">
        <span class="proto-tag" title="合成数据，不连接真实任务、模型、目录或服务">设计样例 · 全部模拟</span>
        <label>状态<select aria-label="切换原型状态" id="peStateSel">${state ? '' : '<option value="">—</option>'}${opts}</select></label>
        <label>主题<select aria-label="切换主题" id="peSkinSel">${skins.map(([k, l]) => `<option value="${k}"${k === cur ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
        <label>减弱动态<button class="switch" role="switch" id="peMotion" aria-checked="${document.documentElement.classList.contains('reduced')}" aria-label="减弱动态"></button></label>
        <span class="proto-sep"></span>
        <button class="proto-btn" id="peEvent" type="button" disabled>▶ 无可模拟的服务事件</button>
        <button class="proto-btn" id="peExplainBtn" type="button"${state ? '' : ' disabled'}>说明</button>
        <a class="proto-btn" href="${PEN.url('index.html')}">状态总览</a>
      </div>`);
    document.getElementById('peStateSel').addEventListener('change', (e) => { if (e.target.value) nav(e.target.value); });
    document.getElementById('peSkinSel').addEventListener('change', (e) => DS.setSkin(e.target.value));
    document.addEventListener('skinchange', (e) => { const s = document.getElementById('peSkinSel'); if (s) s.value = e.detail; });
    document.getElementById('peMotion').addEventListener('click', (e) => { const on = !document.documentElement.classList.contains('reduced'); document.documentElement.classList.toggle('reduced', on); e.currentTarget.setAttribute('aria-checked', on); setCtx({ motion: on ? 'reduce' : null }); });
    document.getElementById('peEvent').addEventListener('click', () => eventFn && eventFn());
    document.getElementById('peExplainBtn').addEventListener('click', openExplain);
  }
  function openExplain() {
    const s = byId[state]; if (!s) return;
    let d = document.getElementById('peExplain');
    if (!d) { document.body.insertAdjacentHTML('beforeend', `<div class="scrim" id="peExplainScrim"></div><aside class="drawer pe-explain" id="peExplain" role="dialog" aria-modal="true" aria-labelledby="peExplainT" style="width:420px"></aside>`); d = document.getElementById('peExplain'); document.getElementById('peExplainScrim').addEventListener('click', closeExplain); }
    d.innerHTML = `<div class="drawer-head"><div class="grow"><div class="eyebrow">${esc(s.group)}</div><div id="peExplainT" style="font-size:16px;font-weight:500;margin-top:3px">${esc(s.id.toUpperCase())} · ${esc(s.label)}</div></div><button class="icon-btn" aria-label="关闭说明" id="peExplainX">×</button></div>
      <div class="drawer-body"><span class="td-mock">设计样例 · 全部模拟 · 业务：${esc(s.biz)}</span>
      <div class="sec-t">设计意图</div><p>${esc(s.desc)}</p>
      <div class="sec-t">验收要点</div><p>${esc(s.check)}</p>
      <div class="sec-t">正常入口</div><p>${esc(s.entry)}</p>
      <div class="sec-t">所需 DTO / API</div><p class="mono" style="font-size:12px">${esc(s.api)}</p>
      <div class="sec-t">对应功能 / 验收场景 · 实施期</div><div class="req">${s.f.concat(s.a).map((r) => `<span class="badge outline">${r}</span>`).join('')}<span class="badge outline">${esc(s.phase)}</span></div></div>`;
    document.getElementById('peExplainX').addEventListener('click', closeExplain);
    d.classList.add('open'); document.getElementById('peExplainScrim').classList.add('open'); document.getElementById('peExplainX').focus();
  }
  function closeExplain() { const d = document.getElementById('peExplain'); if (!d) return; d.classList.remove('open'); document.getElementById('peExplainScrim').classList.remove('open'); document.getElementById('peExplainBtn').focus(); }
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && document.getElementById('peExplain')?.classList.contains('open')) { e.stopPropagation(); closeExplain(); } }, true);

  window.PE = { init, ctx, setCtx, keepCtx, href, nav, to, setEvent, mountProto, esc, byId, STATES, get state() { return state; }, get page() { return page; } };
})();
