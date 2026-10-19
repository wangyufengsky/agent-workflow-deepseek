/* 规划补充稿 · 合集整合版兼容层（替代补充稿独立版的 pe-nav.js）
   在合集里，菜单、顶部演示条与路由由 showcase/navigation.js（SC）与 bridge.js 提供；这里只把补充稿里的 PEN 接口转接到 SC：
   - 规划页面 → originals/planning/*.html；任务列表 / 需求目录 / 待处理 / 主页 / 模板任务 → 合集原有正式页面 originals/main/pages/*.html
   - 主题、展示/审阅模式由 SC.url 统一带上；业务身份参数由调用方显式传入 */
(() => {
  'use strict';
  const MAIN = { 'home.html': 'main/pages/home.html', 'tasks.html': 'main/pages/tasks.html', 'requirements.html': 'main/pages/requirements.html', 'inbox.html': 'main/pages/inbox.html', 'templates.html': 'main/pages/templates.html' };
  function url(page, extra) {
    const [p, qs] = String(page).split('?');
    const ex = Object.assign(Object.fromEntries(new URLSearchParams(qs || '')), extra || {});
    const target = MAIN[p] || ('planning/' + p);
    if (MAIN[p]) ['state', 'task', 'from', 'returnTo', 'sel', 'tab', 'layer', 'view', 'round', 'sub'].forEach((k) => delete ex[k]);
    if (document.documentElement.classList.contains('reduced') || new URLSearchParams(location.search).get('motion') === 'reduce') ex.motion = 'reduce';
    Object.keys(ex).forEach((k) => { if (ex[k] === undefined || ex[k] === null || ex[k] === '') delete ex[k]; });
    return SC.url(target, ex);
  }
  window.PEN = { url, go: (p, e) => { location.href = url(p, e); }, theme: () => SC.theme(), navHTML: (a, icon) => SC.navHTML(a, icon), toolbar() {}, refresh() {}, SKINS: SC.skins, MENU: SC.menu };
})();
