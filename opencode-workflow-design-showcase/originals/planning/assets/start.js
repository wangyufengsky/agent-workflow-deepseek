/* 开始任务 · 普通流程方法选择（PE01，设计样例 · 全部模拟）
   修改点（相对合集最新 TD 开始任务）：流程方法卡写清必经步骤 / 可细化范围 / AI 规划支持；固定步骤的模板任务只给入口不混用；
   “形成需求草稿”只建草稿，不调用模型。 */
(function () {
  const I = DS.icon, esc = DS.esc, $ = (s, r = document) => r.querySelector(s);
  PE.init('start.html');
  const T = PEF.task('T-2051');
  const METHODS = [
    { id: 'dev', name: '需求开发', ver: 'r12', ai: true, steps: ['梳理需求', '方案设计', '实现', '测试', '人工验收'], ref: ['实现', '测试'], note: '规划策略 v1 · 需求分析师（规划职责）' },
    { id: 'fix', name: '缺陷修复', ver: 'r4', ai: true, steps: ['复现', '定位', '修复', '回归测试'], ref: ['修复', '回归测试'], note: '规划策略 v1' },
    { id: 'doc', name: '文档整理', ver: 'r2', ai: false, steps: ['收集资料', '撰写', '人工审阅'], ref: [], note: '尚未配置 AI 规划：可用骨架手动调整' },
  ];
  let pick = PE.ctx('method') || 'dev';
  function render() {
    $('#view').innerHTML = `
      <div class="page-head" style="margin-bottom:18px"><div class="grow"><div class="eyebrow">开始任务</div><h1 class="title" style="font-size:24px;margin-top:4px">描述要做的事，选择流程方法</h1><p class="lede" style="margin-top:6px;color:var(--sub);font-size:13.5px">先形成需求草稿；之后在需求画布上生成或手动调整计划，确认后再准备独立工作区与开始执行。</p></div></div>
      <div style="display:grid;grid-template-columns:minmax(0,1fr) 320px;gap:20px;align-items:start">
        <div class="col" style="gap:18px">
          <section class="card pad"><div class="sec-t">1 · 项目</div><div class="row" style="gap:10px"><span class="tile">${I('folder')}</span><div class="grow"><div style="font-weight:500">${esc(T.project)}</div><div class="muted" style="font-size:12.5px">GitLab · ${esc(T.repo)} · 基线 ${esc(T.baseline)}</div></div><button class="btn secondary sm" data-x="proj">更换</button></div></section>
          <section class="card pad"><label class="sec-t" for="req" style="display:block">2 · 需求</label><textarea class="textarea" id="req" rows="3">${esc(T.original)}</textarea><div class="hint" style="margin-top:6px">原文会冻结为“需求原文 修订 1”，之后的补充以新修订保存，不改原文。</div></section>
          <section class="card pad"><div class="row"><div class="sec-t grow" style="margin:0">3 · 流程方法</div><a class="btn ghost sm" href="${PEN.url('templates.html')}">${I('template', 'sm')}要用固定步骤？去模板任务</a></div>
            <div class="mcards" role="radiogroup" aria-label="流程方法" style="margin-top:10px">${METHODS.map((m) => `<button class="mcard" role="radio" aria-checked="${pick === m.id}" data-m="${m.id}">
              <div class="nm">${I('flow', 'sm')}${esc(m.name)}<span class="badge outline" style="margin-left:auto">${m.ver}</span></div>
              <div class="ln"><b>必经步骤</b></div><div class="steps-mini">${m.steps.map((s) => `<span class="${m.ref.includes(s) ? 'rf' : ''}">${esc(s)}</span>`).join('')}</div>
              <div class="ln"><b>可按需求拆分</b>　${m.ref.length ? esc(m.ref.join('、')) + '（每步 ≤ 4 个子步骤）' : '无'}</div>
              <div class="ln"><b>AI 规划</b>　${m.ai ? `<span style="color:var(--ok)">${I('check', 'sm')} 支持</span> · ${esc(m.note)}` : `<span style="color:var(--warn)">${I('alert', 'sm')} 未配置</span> · 可用骨架手动调整`}</div></button>`).join('')}</div>
            <div class="foot-note" style="margin-top:10px">${I('info', 'sm')}流程方法可以在需求画布上按需求细化（高亮的步骤）；“模板任务”是另一种入口：创建后步骤固定，不能修改。</div></section>
        </div>
        <aside class="card solid" style="position:sticky;top:12px"><div class="card-body"><div class="eyebrow">将形成</div><div style="font-size:16px;font-weight:500;margin-top:4px">${esc(T.title)}</div>
          <dl class="mini-kv" style="margin-top:12px"><dt>项目</dt><dd>${esc(T.project)}</dd><dt>方法</dt><dd>${esc(METHODS.find((m) => m.id === pick).name)} · ${METHODS.find((m) => m.id === pick).ver}</dd></dl>
          <div class="sec-t" style="margin-top:16px">接下来</div><ol class="steps4"><li class="cur"><span class="n">1</span><div><div>形成需求草稿</div><div class="s">只建草稿，不调用模型</div></div></li><li><span class="n">2</span><div><div>生成计划（可选）</div><div class="s">先预览模型、次数、预算与时限，确认后才调用</div></div></li><li><span class="n">3</span><div><div>确认计划</div><div class="s">确认不执行</div></div></li><li><span class="n">4</span><div><div>准备独立工作区 → 开始执行</div><div class="s">两步分开</div></div></li></ol>
          <button class="btn primary lg" style="width:100%;margin-top:14px" data-x="form">形成需求草稿</button>
          <p class="hint" style="margin-top:8px;text-align:center">不会调用模型、不产生费用</p></div></aside>
      </div>`;
  }
  document.addEventListener('click', (e) => {
    const m = e.target.closest('[data-m]'); if (m) { pick = m.dataset.m; PE.setCtx({ method: pick }); render(); $(`[data-m="${pick}"]`).focus(); return; }
    const x = e.target.closest('[data-x]'); if (!x) return;
    if (x.dataset.x === 'proj') DS.toast('整合后打开合集现有“选择项目”抽屉', 'info');
    if (x.dataset.x === 'form') { x.setAttribute('aria-busy', 'true'); x.innerHTML = '<span class="spin"></span>正在形成…'; setTimeout(() => { location.href = PEN.url('requirement.html', { state: pick === 'doc' ? 'b07' : 'pe02', task: 'T-2051', round: 1, returnTo: 'start.html?state=pe01' }); }, 400); }
  });
  document.addEventListener('keydown', (e) => { const m = e.target.closest?.('[data-m]'); if (!m || !['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].includes(e.key)) return; e.preventDefault(); const ids = METHODS.map((x) => x.id); pick = ids[(ids.indexOf(pick) + (['ArrowRight', 'ArrowDown'].includes(e.key) ? 1 : -1) + ids.length) % ids.length]; render(); $(`[data-m="${pick}"]`).focus(); });
  DS.mount({ proto: false }); PE.mountProto(); render();
})();
