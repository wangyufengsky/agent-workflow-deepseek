/* 任务隔离与交付 · 原型公共脚本（设计样例 · 合成数据；不发请求、不写本机存储）
   用法：页面在 shell.js、td-states.js 之后引入本文件，然后：
     const S = TD.init('task.html');   // 返回当前状态 id（URL ?state=，否则本页第一个状态）
     DS.mount({ ..., proto:false });     // 用原外壳
     TD.mountProto();                    // 底部原型控制条 + 说明抽屉
   跳转：TD.go('td04-push-confirm') 跳到该状态所在页面；TD.navTo('task.html', {state:'td02-awaiting'}) 保留主题与减弱动态。
   返回上下文：TD.ret() 读取 ?from=&fromState=，TD.backHref() 生成返回链接。
*/
window.TD_DESC = window.TD_DESC || {};
(function () {
  const P = new URLSearchParams(location.search);
  const STATES = window.TD_STATES || [];
  const byId = Object.fromEntries(STATES.map((s) => [s.id, s]));
  let page = '', state = '';
  const reduced = P.get('motion') === 'reduce' || (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  if (reduced) document.documentElement.classList.add('reduced');

  function keep(extra) {
    const q = new URLSearchParams();
    const mode=P.get('showcase');if(mode)q.set('showcase',mode);
    const theme = document.documentElement.dataset.skin || P.get('theme');
    if (theme) q.set('theme', theme);
    if (document.documentElement.classList.contains('reduced')) q.set('motion', 'reduce');
    Object.entries(extra || {}).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') q.set(k, v); });
    return q.toString();
  }
  function navTo(to, extra) { SC.href = to + '?' + keep(extra); }
  function go(id, extra) { const s = byId[id]; if (!s) return; navTo(s.page, Object.assign({ state: id }, extra || {})); }
  function href(id, extra) { const s = byId[id]; return s ? s.page + '?' + keep(Object.assign({ state: id }, extra || {})) : '#'; }
  function init(pg) {
    page = pg;
    const want = P.get('state');
    const mine = STATES.filter((s) => s.page === pg);
    state = (want && byId[want] && byId[want].page === pg) ? want : (mine[0] ? mine[0].id : '');
    return state;
  }
  function ret() { return { from: P.get('from'), fromState: P.get('fromState') }; }
  function backHref(fallbackState) { const r = ret(); const ex = {}; ['kind', 'task'].forEach((k) => { if (P.get(k)) ex[k] = P.get(k); }); if (r.fromState && byId[r.fromState]) return href(r.fromState, ex); return fallbackState ? href(fallbackState, ex) : 'index.html?' + keep(); }
  function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  function mountProto() {
    const groups = [];
    STATES.forEach((s) => { let g = groups.find((x) => x[0] === s.group); if (!g) groups.push(g = [s.group, []]); g[1].push(s); });
    const opts = groups.map(([g, list]) => `<optgroup label="${esc(g)}">${list.map((s) => `<option value="${s.id}"${s.id === state ? ' selected' : ''}>${esc(s.id.toUpperCase().slice(0, 4))} · ${esc(s.label)}</option>`).join('')}</optgroup>`).join('');
    const skins = (window.DS && DS.SKINS) || [['deepseek', 'deepseek 风'], ['warm', 'claude 风'], ['spdb', 'SPDB'], ['github-white', 'GitHub 白']];
    const cur = document.documentElement.dataset.skin;
    document.body.insertAdjacentHTML('beforeend', `<div class="proto-dock" aria-hidden="false"></div>
      <div class="proto" role="region" aria-label="原型控制（非产品界面）">
        <span class="proto-tag" title="合成数据，不连接真实任务、Git、GitLab、目录或模型">设计样例 · mock</span>
        <label>状态<select aria-label="切换原型状态" id="tdStateSel">${opts}</select></label>
        <label>主题<select aria-label="切换主题" id="tdSkinSel">${skins.map(([k, l]) => `<option value="${k}"${k === cur ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
        <span class="proto-sep"></span>
        <label>减弱动态<button class="switch" role="switch" id="tdMotion" aria-checked="${document.documentElement.classList.contains('reduced')}" aria-label="减弱动态"></button></label>
        <span class="proto-sep"></span>
        <button class="proto-btn" id="tdExplainBtn" type="button">说明</button>
        <a class="proto-btn" href="index.html?${keep()}">状态总览</a>
      </div>`);
    document.getElementById('tdStateSel').addEventListener('change', (e) => go(e.target.value));
    document.getElementById('tdSkinSel').addEventListener('change', (e) => { if (window.DS && DS.setSkin) DS.setSkin(e.target.value); else document.documentElement.dataset.skin = e.target.value; });
    document.getElementById('tdMotion').addEventListener('click', (e) => { const on = !document.documentElement.classList.contains('reduced'); document.documentElement.classList.toggle('reduced', on); e.currentTarget.setAttribute('aria-checked', on); });
    document.getElementById('tdExplainBtn').addEventListener('click', openExplain);
  }
  function openExplain() {
    const s = byId[state]; if (!s) return;
    let d = document.getElementById('tdExplain');
    if (!d) { document.body.insertAdjacentHTML('beforeend', `<div class="scrim" id="tdExplainScrim"></div><aside class="drawer td-explain" id="tdExplain" role="dialog" aria-modal="true" aria-labelledby="tdExplainT" style="width:400px"></aside>`); d = document.getElementById('tdExplain'); document.getElementById('tdExplainScrim').addEventListener('click', closeExplain); }
    d.innerHTML = `<div class="drawer-head"><div class="grow"><div class="eyebrow">${esc(s.group)}</div><div id="tdExplainT" style="font-size:16px;font-weight:500;margin-top:3px">${esc(s.label)}</div></div><button class="icon-btn" aria-label="关闭说明" id="tdExplainX">×</button></div>
      <div class="drawer-body"><span class="td-mock">设计样例 · 合成数据</span><div class="sec-t">状态 ID</div><p class="mono">${s.id}</p>
      <div class="sec-t">设计意图与验收要点</div><p>${(window.TD_DESC && window.TD_DESC[s.id]) || s.desc || '（见 STATES.md）'}</p>
      <div class="sec-t">对应验收条件</div><div class="req">${(s.req || []).map((r) => `<span class="badge outline">${r}</span>`).join('')}</div></div>`;
    document.getElementById('tdExplainX').addEventListener('click', closeExplain);
    d.classList.add('open'); document.getElementById('tdExplainScrim').classList.add('open'); document.getElementById('tdExplainX').focus();
  }
  function closeExplain() { const d = document.getElementById('tdExplain'); if (!d) return; d.classList.remove('open'); document.getElementById('tdExplainScrim').classList.remove('open'); document.getElementById('tdExplainBtn').focus(); }
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && document.getElementById('tdExplain')?.classList.contains('open')) { e.stopPropagation(); closeExplain(); } }, true);

  window.TD = { init, mountProto, go, navTo, href, ret, backHref, keep, esc, byId, STATES, get state() { return state; }, get page() { return page; } };
})();
