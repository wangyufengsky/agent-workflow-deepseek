/* 任务画布 · 执行中调整待执行计划 / 固定模板任务 / 有界局部细化（设计样例 · 全部模拟）
   PE33 申请调整（暂停新增领取）→ PE34 编辑待执行区（锁、表单式依赖、领取竞态）→ PE35 语义保存后重新确认 → 继续执行
   PE36 固定模板任务只读；PE38 有界局部细化候选（设计候选 · 后续分期） */
(function () {
  const I = DS.icon, esc = DS.esc, $ = (s, r = document) => r.querySelector(s);
  let S = PE.init('task.html', (id) => { S = id; sub = defSub(); edits = defEdits(); conflict = S === 'pe34'; render(); });
  const FIXED = () => S === 'pe36';
  const T = PEF.task(PE.ctx('task') || (FIXED() ? 'T-2050' : 'T-2050'));
  function defSub() { return S === 'pe33' ? (PE.ctx('sub') || 'pausing') : S === 'pe34' || S === 'pe38' ? 'editing' : S === 'pe35' ? 'reconfirm' : 'fixed'; }
  let sub = defSub();
  function defEdits() { return S === 'pe34' ? { added: true, n4mod: true } : S === 'pe35' ? { added: true } : {}; }
  let edits = defEdits(), conflict = S === 'pe34', reread = false, auto = true, sel = PE.ctx('sel'), confirmed = false, refine = S === 'pe38';
  let view = null; try { view = JSON.parse(PE.ctx('view') || 'null'); } catch (e) { view = null; }

  /* ---------- 图 ---------- */
  function statusOf(id) {
    if (FIXED()) return ['start', 'end'].includes(id) ? null : 'fixed';
    const st = { n1: 'done', n2: 'done', n3: 'run', n4: conflict || reread ? 'claimed' : 'idle', n5: 'idle', n6: 'idle', n7: 'idle', n8: 'idle', n9: 'idle' };
    if (sub === 'editing' && !refine) { if (['n5', 'n6', 'n7', 'n8', 'n9'].includes(id) || (id === 'n4' && !conflict && !reread)) return 'ready'; }
    if (sub === 'running' && id === 'n4' && confirmed) return 'claimed';
    return st[id] || null;
  }
  function graph() {
    if (FIXED()) {
      const n = [['start', '开始', null], ['f1', '分析覆盖', '测试工程师', '覆盖缺口清单'], ['f2', '编写测试', '测试工程师', '测试代码'], ['f3', '运行验收', '质量工程师', '测试报告与覆盖率'], ['end', '交付', null]];
      return { nodes: n.map(([id, title, role, meta]) => role === null ? { id, title, system: true } : { id, title, role, meta, lock: true }), edges: [['start', 'f1'], ['f1', 'f2'], ['f2', 'f3'], ['f3', 'end']].map(([from, to]) => ({ from, to })), groups: [] };
    }
    if (refine) {
      const nodes = [
        { id: 'n3', title: '后端筛选查询', role: '后端工程师', meta: '范围外 · 保留', dim: true },
        { id: 'pin', title: '后端筛选查询 /patch → /query-service', port: 'in' },
        { id: 'n4a', title: '导出分页游标', role: '后端工程师', meta: '候选 · 新增', diff: 'add', group: 'scope' },
        { id: 'n4b', title: 'CSV 生成与下载', role: '后端工程师', meta: '候选 · 新增', diff: 'add', group: 'scope' },
        { id: 'pout', title: '/export-api → 接口测试 · 旧数据回归', port: 'out' },
        { id: 'n6', title: '接口测试', role: '测试工程师', meta: '范围外 · 保留', dim: true },
        { id: 'n7', title: '旧数据回归', role: '测试工程师', meta: '范围外 · 保留', dim: true },
      ];
      const edges = [['n3', 'pin', 'port'], ['pin', 'n4a', 'port'], ['n4a', 'n4b', 'new'], ['n4b', 'pout', 'port'], ['pout', 'n6', 'port'], ['pout', 'n7', 'port']].map(([from, to, kind]) => ({ from, to, kind }));
      return { nodes, edges, groups: [{ id: 'scope', title: '细化选区：导出 CSV 接口', meta: '候选替换 1 → 2 步', tone: 'scope' }] };
    }
    const g = PEF.candidate(T);
    const nodes = g.nodes.map((n) => Object.assign({}, n, { diff: null }));
    let edges = g.edges.map((e) => Object.assign({}, e));
    nodes.forEach((n) => { const s = statusOf(n.id); if (sub !== 'running' && sub !== 'pausing' && ['done', 'run', 'claimed'].includes(s)) n.lock = true; });
    if (edits.added) { nodes.splice(nodes.findIndex((n) => n.id === 'n8'), 0, { id: 'n9', title: '导出性能测试', role: '测试工程师', meta: '1 万行导出 ≤ 10 秒', group: 'g3', badge: sub === 'editing' || sub === 'reconfirm' ? ['本次新增', 'd-add', 'plus'] : null }); edges = edges.concat([{ from: 'n4', to: 'n9' }, { from: 'n9', to: 'n8' }]); }
    if (edits.n4mod && !reread) { const n = nodes.find((x) => x.id === 'n4'); n.badge = ['本地修改', 'd-mod', 'edit']; n.meta = '验收改为“单次最多 1 万行”'; }
    if (conflict) nodes.find((x) => x.id === 'n4').flag = 'warn';
    return { nodes, edges, groups: PEF.GROUPS };
  }
  let CV;
  function renderCanvas() {
    const g = graph();
    const opts = { nodes: g.nodes, edges: g.edges, groups: g.groups, statusOf, selected: sel, view,
      editable: (n) => sub === 'editing' && !refine && ['ready'].includes(statusOf(n.id)) && !n.system,
      onAddAfter: (id) => { if (id !== 'n4' || edits.added) { DS.toast('原型只演示在“导出 CSV 接口”后新增一步', 'info'); return; } edits.added = true; render(true); DS.toast('已在本地草稿新增“导出性能测试”（未保存）', 'ok'); },
      onSelect: (id) => { sel = id && !['start', 'end'].includes(id) ? id : null; PE.setCtx({ sel }); renderSide(); },
      onToggleGroup: () => {}, onView: debounce((v) => PE.setCtx({ view: JSON.stringify(v) }), 300) };
    if (!CV) CV = PECanvas($('#cv'), opts); else CV.set(opts);
    const host = $('#cv'); host.querySelectorAll('.cv-overlay').forEach((e) => e.remove());
    const tag = FIXED() ? ['', I('lock') + '固定模板 · 创建后不能修改步骤'] : refine ? ['cand', I('sparkle') + '局部细化候选 · 未应用（设计候选 · 后续分期）'] : sub === 'editing' ? ['partial', I('edit') + '调整待执行计划 · 本地草稿' + (edits.added || edits.n4mod ? '（有未保存修改）' : '')] : sub === 'reconfirm' ? ['partial', I('alert') + '计划修订 6 · 等待重新确认'] : null;
    if (tag) host.insertAdjacentHTML('beforeend', `<div class="cv-overlay layer-tag ${tag[0]}" role="status">${tag[1]}</div>`);
    if (sub === 'editing' && !refine) host.insertAdjacentHTML('beforeend', `<div class="cv-overlay diff-legend"><span>${I('lock', 'sm')}已领取 / 运行中 / 已完成：锁定（含入边）</span><span>${I('edit', 'sm')}待执行：可修改</span></div>`);
  }

  /* 进入合集新版节点详情（整合后由 showcase/navigation.js 提供 SC）；返回时恢复选中步骤与画布视角 */
  function openNode(id, tab, title, status) {
    if (window.SC && SC.go && SC.originalRoot) {
      const u = new URL(location.href); u.searchParams.set('sel', id); try { u.searchParams.set('view', JSON.stringify(CV.view())); } catch (e) {}
      const entry = tab === 'attempts' ? 'n17-history' : status === 'run' ? 'n03-stream' : 'n11-done';
      SC.go('node/index.html?state=' + entry, { stream: 'paused', nodeId: id, nodeTitle: title, taskTitle: T.title, returnTo: u.href.slice(SC.originalRoot.href.length) });
    } else DS.toast('整合后进入合集节点详情 node/index.html；返回时恢复画布视角与选中步骤', 'info');
  }
  function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

  /* ---------- 页头 / 情况条 ---------- */
  function renderBar() {
    const back = PE.ctx('returnTo') || 'tasks.html';
    const badge = FIXED() ? ['固定模板 · 待确认', 'st-wait', 'lock'] : { running: ['执行中', 'st-run', 'play'], pausing: ['正在暂停新增领取', 'st-wait', 'pause'], editing: ['调整待执行计划', 'st-wait', 'edit'], reconfirm: [confirmed ? '已重新确认 · 新增领取暂停中' : '等待重新确认', confirmed ? 'st-done' : 'st-wait', confirmed ? 'check' : 'alert'] }[sub];
    const title = FIXED() ? '单元测试开发 · loopper/task' : T.title;
    const adjOff = FIXED() ? '该任务使用固定模板，创建后不能修改步骤；要改要求，请新建模板任务。' : sub === 'pausing' ? '正在等待暂停回执' : null;
    const showAdj = FIXED() || sub === 'running' || sub === 'pausing';
    $('#bar').innerHTML = `<nav class="crumbs" aria-label="位置"><a href="${PEN.url(back.split('?')[0], Object.fromEntries(new URLSearchParams(back.split('?')[1] || '')))}">${{ 'requirement.html': '需求画布', 'templates.html': '模板任务' }[back.split('?')[0]] || '任务列表'}</a><span class="sep">/</span></nav>
      <h1 class="task-title" title="${esc(title)}">${esc(title)}</h1>
      <div class="pe-chips"><span class="chip">${I('folder', 'sm')}${FIXED() ? 'OpenCode Loopper · T-2070' : esc(T.project) + ' · ' + esc(T.id)}</span></div>
      ${capsule(badge)}
      <div class="acts">${FIXED() ? `<span class="dis-wrap"><span class="row" style="gap:8px"><button class="btn ghost" aria-disabled="true" aria-describedby="fx-r" data-act="noop">AI 细化计划</button><button class="btn secondary" aria-disabled="true" aria-describedby="fx-r" data-act="noop">${I('edit')}调整待执行计划</button></span><span class="dis-reason" id="fx-r">${esc(adjOff)}</span></span>` : showAdj ? (adjOff ? dis('调整待执行计划', 'secondary', adjOff, 'adj') : `<button class="btn secondary" data-act="adjust">${I('edit')}调整待执行计划</button>`) : ''}
        ${FIXED() ? '' : `<span class="auto-sw" style="display:inline-flex;align-items:center;gap:10px;height:36px;padding:0 6px 0 12px;border-radius:var(--r-pill);border:1px solid var(--line-2);font-size:13px;color:var(--ink-2)">自动节点推进<button class="switch" role="switch" aria-checked="${auto}" aria-label="自动节点推进" data-act="auto" ${sub === 'running' ? '' : 'aria-disabled="true" title="调整期间保持暂停；继续执行时恢复原设置"'}></button></span>`}</div>`;
    let situ = '';
    if (FIXED()) situ = `<div class="pe-strip"><span class="kv1">${I('lock', 'sm')}<b>固定模板任务</b></span><span class="sep"></span><span class="last">步骤、依赖、职业、模型、验收与参数在创建时固定；可以查看、调整布局、确认、准备与开始。</span></div>`;
    else if (sub === 'running') situ = `<div class="pe-strip"><span class="kv1">${I('play', 'sm')}进行到第 3 段：<b>后端筛选查询</b> 执行中</span><span class="sep"></span><span class="last">前端筛选栏与导出按钮：等待写入互斥（同任务文件写入逐个领取）· 没有需要你处理的事</span>${confirmed ? `<span class="badge st-done">${I('check', 'sm')}已按修订 6 继续 · 自动节点推进 开启</span>` : ''}</div>`;
    else if (sub === 'pausing') situ = `<div class="pe-strip unk"><span class="kv1"><span class="spin"></span><b>正在暂停新增领取…</b></span><span class="sep"></span><span class="last">请求 rk-e51b 已发出，等待服务回执；回执成功前不开放编辑。“后端筛选查询”按原快照继续执行，不会被强停。</span></div>`;
    else if (sub === 'editing') situ = `<div class="pe-strip need"><span class="kv1">${I('pause', 'sm')}<b>已暂停新增领取</b></span><span class="sep"></span><span class="last">正在调整待执行计划（基于修订 5）· 运行中的“后端筛选查询”按原快照继续 · 调整前自动节点推进：开启</span></div>`;
    else situ = confirmed ? `<div class="pe-strip ok"><span class="kv1">${I('check', 'sm')}<b>计划修订 6 已重新确认</b></span><span class="sep"></span><span class="last">新增领取仍暂停，点“继续执行”后恢复调整前的设置（自动节点推进：开启）。</span></div>`
      : `<div class="pe-strip need"><span class="kv1">${I('alert', 'sm')}<b>计划已变更，后续步骤等待重新确认</b></span><span class="sep"></span><span class="last">修订 5 → 6：新增“导出性能测试”。确认前不会领取新步骤；运行中的步骤不受影响。</span></div>`;
    $('#strip').innerHTML = situ;
    const bn = [];
    if (conflict) bn.push(`<div class="banner warn">${I('alert')}<div class="grow"><b>保存未成功：“导出 CSV 接口”在暂停生效前已被领取</b>（服务返回 REVISION_CONFLICT，计划修订 5 → 5.1 领取记录）。你的修改已保留为本地草稿，没有丢失。重新读取后，涉及已领取步骤的修改会被标出。</div><div class="actions"><button class="btn secondary sm" data-act="reread">重新读取并比对</button></div></div>`);
    if (reread && sub === 'editing' && !refine) bn.push(`<div class="banner info">${I('info')}<div class="grow"><b>已重新读取。</b>“导出 CSV 接口”已领取并锁定，你对它的验收修改不能再保存（已从草稿移出，内容可在下方复制）。新增的“导出性能测试”接在它的输出之后，仍可保存。</div></div>`);
    if (refine) bn.push(`<div class="banner warn">${I('alert')}<div class="grow"><span class="tagx later" style="margin-right:6px">设计候选 · 后续分期</span><b>局部细化只读预览。</b>选区外的图保留；边界端口由服务从当前图计算、只读。边界端口契约冻结前，跨范围替换不能应用。</div><div class="actions"><button class="btn secondary sm" data-act="exit-refine">退出预览</button></div></div>`);
    $('#banners').innerHTML = bn.join('');
  }
  /* 任务总阶段胶囊（与需求画布同一组件；执行画布用紧凑形态：只有当前段写文字） */
  function capsule(b) {
    const ST = ['需求草稿', '规划', '确认计划', '准备工作区', '开始执行'];
    const idx = FIXED() ? 2 : 4; const tone = { 'st-run': 'run', 'st-wait': 'need', 'st-done': 'ok' }[b[1]] || 'idle';
    const sl = FIXED() ? b[0] : (sub0() ? b[0] + ' · 计划修订 ' + (sub === 'reconfirm' ? 6 : 5) : b[0]);
    return `<ol class="stages compact pe-stages" aria-label="任务阶段">${ST.map((l, i) => `<li class="stage ${i < idx ? 'done' : i === idx ? 'cur tone-' + tone : ''}" title="${l}${i < idx ? '（已完成）' : i > idx ? '（未到）' : ''}"${i === idx ? ' aria-current="step"' : ''}><i>${i < idx ? I('check') : i === idx && tone === 'need' ? I(b[2]) : i + 1}</i><span class="lb">${l}</span><span class="sb">${esc(sl)}</span></li>`.replace(i === idx ? '' : /<span class="sb">.*?<\/span>/, '')).join('')}</ol>`;
  }
  function sub0() { return sub === 'editing' || sub === 'reconfirm'; }
  function dis(label, kind, reason, id) { return `<span class="dis-wrap"><button class="btn ${kind}" aria-disabled="true" aria-describedby="${id}-r" data-act="noop">${esc(label)}</button><span class="dis-reason" id="${id}-r">${esc(reason)}</span></span>`; }

  /* ---------- 右侧 ---------- */
  function renderSide() {
    const side = $('#side'); let html = '';
    if (FIXED()) html = fixedSide();
    else if (refine) html = refineSide();
    else if (sub === 'editing') html = editSide();
    else if (sub === 'reconfirm') html = reconfirmSide();
    else html = runSide();
    side.innerHTML = html;
  }
  function nodeBlock(id, editable) {
    const n = graph().nodes.find((x) => x.id === id); if (!n) return '';
    const s = statusOf(id); const lockedWhy = { done: '已完成：结果与验收按原身份保留', run: '运行中：当前尝试按原快照继续，不能修改', claimed: '已被领取：不能修改，入边一并锁定' }[s];
    const preds = graph().edges.filter((e) => e.to === id).map((e) => e.from);
    const cands = ['n2', 'n3', 'n4', 'n5'].filter((x) => x !== id);
    return `<div class="sec"><div class="nd-h"><h3 class="grow">${esc(n.title)}</h3>${lockedWhy ? `<span class="badge st-idle">${I('lock', 'sm')}锁定</span>` : editable ? `<span class="badge st-idle">${I('edit', 'sm')}可修改</span>` : ''}</div><div class="muted" style="font-size:12.5px;margin-top:4px">${esc(n.role || '')}${n.meta ? ' · ' + esc(n.meta) : ''}</div>
      ${lockedWhy ? `<div class="banner" style="margin-top:10px;font-size:12.5px;padding:9px 12px">${I('lock', 'sm')}<span>${lockedWhy}</span></div>` : ''}
      ${editable && !lockedWhy ? `<div class="field" style="margin-top:14px"><label class="label" for="fTitle">步骤名称</label><input class="input" id="fTitle" value="${esc(n.title)}"></div>
        <div class="field"><span class="label">前置步骤（键盘可用的依赖编辑，替代拖拽连线）</span><div class="box">${cands.map((c) => { const t = graph().nodes.find((x) => x.id === c); const lk = ['done', 'run', 'claimed'].includes(statusOf(c)); return `<label class="ackl"><input type="checkbox" ${preds.includes(c) ? 'checked' : ''} data-pred="${c}"><span class="grow">${esc(t?.title)} <span class="muted" style="font-size:12px">${lk ? '· 已锁定（作为前置可保留，不能改它本身）' : ''}</span></span></label>`; }).join('')}</div></div>
        <div class="field"><label class="label" for="fAcc">验收条款</label><textarea class="textarea" id="fAcc" rows="2">${esc(id === 'n9' ? '1 万行导出 ≤ 10 秒；超时给出明确提示' : '按原验收')}</textarea></div>
        ${id === 'n9' ? '' : `<button class="btn ghost sm danger" style="margin-top:10px" data-act="del-node">${I('trash', 'sm')}从计划移除…</button><div class="foot-note" style="margin-top:6px">${I('info', 'sm')}移除前会列出需求覆盖、输入输出与必需产物的影响；必需节点不能只删方块。</div>`}` : ''}</div>`;
  }
  function runSide() {
    if (sel) return `<div class="side-head"><div class="row1"><div class="grow"><div class="eyebrow">步骤</div></div><button class="icon-btn" data-act="unsel" aria-label="关闭">${I('x')}</button></div></div><div class="side-body">${nodeBlock(sel, false)}${['done', 'run'].includes(statusOf(sel)) ? `<button class="btn secondary sm" data-act="open-node" style="margin-top:12px">${I('eye', 'sm')}查看执行现场与产出</button><div class="foot-note" style="margin-top:8px">${I('info', 'sm')}进入新版节点详情；返回时回到这里并恢复画布视角与选中步骤。</div>` : ''}</div>`;
    return `<div class="side-head"><div class="row1"><div class="grow"><div class="eyebrow">任务</div><div style="font-size:16px;font-weight:500;margin-top:2px">执行概况</div></div></div></div><div class="side-body">
      <dl class="mini-kv"><dt>计划</dt><dd>修订 ${confirmed ? 6 : 5} · 已确认</dd><dt>工作区</dt><dd>独立工作区 · task/${esc(T.id)}-filter-export</dd><dt>自动推进</dt><dd>${auto ? '开启' : '关闭'}</dd></dl>
      <div class="sec" style="margin-top:18px"><div class="sec-h"><h3 class="grow">调整待执行计划</h3></div><p style="font-size:13px;line-height:1.7;color:var(--ink-2)">要增删改还没开始的步骤，先“调整待执行计划”：服务会暂停新增领取，运行中的步骤按原快照继续。保存语义修改后需要重新确认，再“继续执行”。</p></div></div>`;
  }
  function editSide() {
    const locked = ['n1', 'n2', 'n3'].concat(conflict || reread ? ['n4'] : []);
    return `<div class="side-head"><div class="row1"><div class="grow"><div class="eyebrow">计划修订 5 · 本地草稿</div><div style="font-size:16px;font-weight:500;margin-top:2px">调整待执行计划</div></div></div></div>
      <div class="side-body">${sel ? `<button class="btn ghost sm" data-act="unsel">${I('chevLeft', 'sm')}全部</button>` + nodeBlock(sel, true) : `
        <div class="sec"><div class="sec-h"><h3 class="grow">本地修改</h3><span class="cnt">${(edits.added ? 1 : 0) + (edits.n4mod && !reread ? 1 : 0)} 项 · 未保存</span></div><div class="box">
          ${edits.added ? `<div class="rowx"><span class="ic ok">${I('plus')}</span><div class="grow"><div class="t">新增：导出性能测试</div><div class="s">在“导出 CSV 接口”之后、“人工验收”之前 · 覆盖 R3</div></div><button class="btn ghost sm" data-focus="n9">定位</button></div>` : `<div class="rowx"><span class="ic idle">${I('info')}</span><div class="grow"><div class="s">在可修改步骤上点“+”添加下一步，或选中步骤编辑。</div></div></div>`}
          ${edits.n4mod ? `<div class="rowx"><span class="ic ${reread ? 'no' : 'wait'}">${I(reread ? 'x' : 'edit')}</span><div class="grow"><div class="t">${reread ? '不能保存：' : ''}修改“导出 CSV 接口”的验收</div><div class="s">${reread ? '该步骤已被领取并锁定；修改内容：“单次最多 1 万行”（可复制到新步骤）' : '单次最多 1 万行'}</div></div></div>` : ''}</div></div>
        <div class="sec"><div class="sec-h"><h3 class="grow">锁定的步骤</h3><span class="cnt">${locked.length}</span></div><div class="box">${locked.map((id) => { const n = graph().nodes.find((x) => x.id === id); return `<div class="rowx"><span class="ic idle">${I('lock')}</span><div class="grow"><div>${esc(n.title)}</div><div class="s">${{ done: '已完成', run: '运行中 · 按原快照继续', claimed: '已被领取' }[statusOf(id)]} · 入边一并锁定</div></div></div>`; }).join('')}</div></div>
        <div class="foot-note">${I('info', 'sm')}锁以服务实时状态为准；保存时服务再做一次版本比对（CAS）。布局移动不算语义修改。</div>`}</div>
      <div class="side-foot"><div class="btns"><button class="btn secondary lg" data-act="abandon">放弃调整</button>${conflict ? `<button class="btn primary wide lg" aria-disabled="true" aria-describedby="svR" data-act="noop">保存修改</button>` : `<button class="btn primary wide lg" data-act="save" ${edits.added ? '' : 'aria-disabled="true"'} aria-describedby="svR">保存修改</button>`}</div><div class="reason ${conflict ? 'warn' : ''}" id="svR">${conflict ? '先重新读取并比对' : '保存语义修改后需要重新确认计划'}</div></div>`;
  }
  function reconfirmSide() {
    return `<div class="side-head"><div class="row1"><div class="grow"><div class="eyebrow">计划修订 5 → 6</div><div style="font-size:16px;font-weight:500;margin-top:2px">${confirmed ? '已重新确认' : '重新确认计划'}</div></div></div></div>
      <div class="side-body"><div class="sec"><div class="sec-h"><h3 class="grow">改动</h3></div><div class="box"><div class="rowx"><span class="ic ok">${I('plus')}</span><div class="grow"><div class="t">新增：导出性能测试</div><div class="s">覆盖 R3 · 写 artifacts/test/${esc(T.pkg)}-perf/**</div></div></div></div></div>
        <div class="sec"><div class="sec-h"><h3 class="grow">当前整图重新检查</h3><span class="tagx fact">服务事实</span></div><div class="box"><div class="rowx"><span class="ic ok">${I('check')}</span><div class="grow">结构、输入输出、依赖：通过</div></div><div class="rowx"><span class="ic wait">${I('eye')}</span><div class="grow">需求归属：新步骤映射到 R3（你填写）<div class="s">旧候选的覆盖与检查报告已作历史，不沿用旧绿勾</div></div></div></div></div>
        <div class="sec"><div class="sec-h"><h3 class="grow">继续执行时</h3></div><dl class="mini-kv"><dt>自动推进</dt><dd>恢复为调整前：开启</dd><dt>运行中</dt><dd>后端筛选查询（不受影响）</dd></dl></div></div>
      <div class="side-foot"><div class="btns">${confirmed ? `<button class="btn primary wide lg" data-act="continue">${I('play')}继续执行</button>` : `<button class="btn primary wide lg" data-act="reconfirm">重新确认计划</button>`}</div><div class="reason">${confirmed ? '继续后才会领取新步骤' : '确认不会调用模型，也不会立即领取步骤'}</div></div>`;
  }
  function fixedSide() {
    if (sel) return `<div class="side-head"><div class="row1"><div class="grow"><div class="eyebrow">固定模板步骤</div></div><button class="icon-btn" data-act="unsel" aria-label="关闭">${I('x')}</button></div></div><div class="side-body"><div class="nd-h"><h3 class="grow">${esc(graph().nodes.find((n) => n.id === sel)?.title)}</h3><span class="badge st-idle">${I('lock', 'sm')}固定</span></div>
      <dl class="mini-kv" style="margin-top:12px"><dt>职业</dt><dd>${esc(graph().nodes.find((n) => n.id === sel)?.role)}（模板指定）</dd><dt>参数</dt><dd>源码路径 src/main/java/com/loopper/task · 分支 main（创建时填写）</dd><dt>验收</dt><dd>模板最低验收，不能修改</dd></dl>
      <div class="banner" style="margin-top:12px;font-size:12.5px">${I('lock', 'sm')}<span>该任务使用固定模板，创建后不能修改步骤；要改要求，请新建模板任务。</span></div></div>`;
    return `<div class="side-head"><div class="row1"><div class="grow"><div class="eyebrow">任务 T-2070</div><div style="font-size:16px;font-weight:500;margin-top:2px">固定模板任务</div></div></div></div>
      <div class="side-body"><dl class="mini-kv"><dt>模板</dt><dd>单元测试开发 · 模板版本 7（实例创建时固定）</dd><dt>入口参数</dt><dd>项目 OpenCode Loopper · 分支 main<br>源码路径 src/main/java/com/loopper/task</dd><dt>计划</dt><dd>修订 1 · 待确认</dd></dl>
        <div class="sec" style="margin-top:18px"><div class="sec-h"><h3 class="grow">不能做的事</h3></div><div class="box">${['新增 / 删除步骤', '改依赖、职业、模型、验收与参数', 'AI 细化计划', '调整待执行计划'].map((x) => `<div class="rowx"><span class="ic idle">${I('lock')}</span><div class="grow">${x}</div></div>`).join('')}</div>
        <div class="foot-note" style="margin-top:8px">${I('info', 'sm')}该任务使用固定模板，创建后不能修改步骤；要改要求，请<a href="${PEN.url('templates.html')}" style="color:var(--accent)">新建模板任务</a>。原有的权限审批与安全输入照常，不等于可改执行配置。</div></div>
        <div class="sec"><div class="sec-h"><h3 class="grow">可以做的事</h3></div><ol class="steps4"><li class="cur"><span class="n">1</span><div><div>确认计划</div><div class="s">固定步骤的精确范围</div></div></li><li><span class="n">2</span><div><div>准备独立工作区</div><div class="s">与普通任务相同</div></div></li><li><span class="n">3</span><div><div>开始执行</div><div class="s">准备成功后单独启动</div></div></li></ol></div></div>
      <div class="side-foot"><div class="btns"><button class="btn primary wide lg" data-act="fixed-confirm">确认计划</button></div><div class="reason">查看、调整布局、确认、准备、开始与按原配置重试都可用</div></div>`;
  }
  function refineSide() {
    return `<div class="side-head"><div class="row1"><div class="grow"><div class="eyebrow"><span class="tagx later">设计候选 · 后续分期</span></div><div style="font-size:16px;font-weight:500;margin-top:4px">有界局部细化 · 导出 CSV 接口</div></div></div></div>
      <div class="side-body"><div class="sec"><div class="sec-h"><h3 class="grow">边界端口（只读）</h3><span class="tagx fact">服务计算</span></div><div class="box">
        <div class="rowx"><span class="ic idle">${I('lock')}</span><div class="grow"><div class="t">入口 · 必需</div><div class="s mono">后端筛选查询 /patch → /query-service · 原边 e-34</div></div></div>
        <div class="rowx"><span class="ic idle">${I('lock')}</span><div class="grow"><div class="t">出口 · 必需</div><div class="s mono">/export-api → 接口测试 /export · 旧数据回归 /export · 原边 e-46、e-47</div></div></div></div>
        <div class="foot-note" style="margin-top:8px">${I('info', 'sm')}端口由服务从当前图计算，模型不能新增或改写；若外部步骤已被领取，涉及其入边的端口不可用。</div></div>
        <div class="sec"><div class="sec-h"><h3 class="grow">候选如何接回</h3></div><ul class="io-l"><li><span class="a">入口端口</span><span class="ar">${I('arrowRight', 'sm')}</span><span class="b">导出分页游标</span></li><li><span class="a">CSV 生成与下载 <span class="mono">/export-api</span></span><span class="ar">${I('arrowRight', 'sm')}</span><span class="b">出口端口</span></li></ul>
        <div class="foot-note" style="margin-top:8px">${I('check', 'sm')}没有旁路：外部步骤不能直接读已删除的“导出 CSV 接口”结果。</div></div>
        <div class="sec"><div class="sec-h"><h3 class="grow">覆盖变化</h3></div><table class="cov"><tbody><tr><td><span class="k">R3</span></td><td>导出 CSV 接口 → 导出分页游标、CSV 生成与下载</td></tr><tr><td><span class="k">C1</span></td><td>不变（接口测试仍比对返回字段）</td></tr></tbody></table></div></div>
      <div class="side-foot"><div class="btns"><button class="btn secondary lg" data-act="exit-refine">不采用</button><button class="btn primary wide lg" aria-disabled="true" aria-describedby="rfR" data-act="noop">应用到草稿</button></div><div class="reason warn" id="rfR">边界端口契约未冻结，跨范围替换暂不可用（后续分期）</div></div>`;
  }

  /* ---------- 对话框 ---------- */
  function dialog(kind, trigger) {
    const d = $('#dlg');
    d.innerHTML = {
      adjust: `<div class="dialog-body"><h2 id="dlgT">调整待执行计划？</h2><p>服务会<b class="ink">暂停新增领取</b>，回执成功后才开放编辑。正在运行的“后端筛选查询”按原快照继续，不会被强停。保存语义修改后需要重新确认，再由你“继续执行”。</p><div class="banner info">${I('info', 'sm')}<span>当前“自动节点推进”为开启；调整期间保持暂停，继续执行时恢复为开启。</span></div></div><div class="dialog-foot"><button class="btn ghost" data-dlg="cancel">取消</button><button class="btn primary" data-dlg="adjust">暂停新增领取并调整</button></div>`,
      reconfirm: `<div class="dialog-body"><h2 id="dlgT">重新确认计划修订 6？</h2><p>确认<b class="ink">不调用模型、不立即领取</b>。</p><dl class="kv"><dt>改动</dt><dd>新增 1 步：导出性能测试</dd><dt>步骤 / 依赖</dt><dd>9 步 / 14 条</dd><dt>锁定不变</dt><dd>梳理需求、方案设计、后端筛选查询、导出 CSV 接口</dd><dt>检查</dt><dd>按当前整图重新检查：结构通过；新步骤需求归属由你填写（R3）</dd></dl></div><div class="dialog-foot"><button class="btn ghost" data-dlg="cancel">再看看</button><button class="btn primary" data-dlg="reconfirm">重新确认</button></div>`,
      abandon: `<div class="dialog-body"><h2 id="dlgT">放弃这次调整？</h2><p>本地草稿会丢弃，计划保持修订 5；结束暂停后恢复调整前的设置（自动节点推进：开启）。</p></div><div class="dialog-foot"><button class="btn ghost" data-dlg="cancel">继续调整</button><button class="btn danger" data-dlg="abandon">放弃调整</button></div>`,
      fixed: `<div class="dialog-body"><h2 id="dlgT">确认固定模板计划？</h2><p>3 个固定步骤（分析覆盖 → 编写测试 → 运行验收）、模板最低验收与创建时填写的参数。确认后下一步是“准备独立工作区”。</p></div><div class="dialog-foot"><button class="btn ghost" data-dlg="cancel">再看看</button><button class="btn primary" data-dlg="fixed">确认计划</button></div>`,
    }[kind];
    DS.openDialog('dlg', trigger);
  }
  $('#dlg').addEventListener('click', (e) => {
    const b = e.target.closest('[data-dlg]'); if (!b) return; const k = b.dataset.dlg; DS.closeDialog('dlg');
    if (k === 'adjust') { PE.to('pe33', { sub: 'pausing' }); }
    if (k === 'reconfirm') { confirmed = true; render(true); DS.toast('计划修订 6 已重新确认（模拟）', 'ok'); }
    if (k === 'abandon') { PE.to('pe33', { sub: 'running' }); DS.toast('已放弃调整；已恢复新增领取（模拟）', 'info'); }
    if (k === 'fixed') DS.toast('已确认（模拟）；下一步：准备独立工作区', 'ok');
  });
  document.addEventListener('keydown', (e) => { const d = $('#dlg'); if (!d.classList.contains('open') || e.key !== 'Tab') return; const f = [...d.querySelectorAll('button')]; const a = f[0], b = f[f.length - 1]; if (e.shiftKey && document.activeElement === a) { e.preventDefault(); b.focus(); } else if (!e.shiftKey && document.activeElement === b) { e.preventDefault(); a.focus(); } });

  document.addEventListener('click', (e) => {
    const f = e.target.closest('[data-focus]'); if (f) { CV.focusNode(f.dataset.focus); return; }
    const a = e.target.closest('[data-act]'); if (!a || a.closest('#dlg')) return;
    if (a.getAttribute('aria-disabled') === 'true') { const r = a.getAttribute('aria-describedby'); DS.toast((r && document.getElementById(r)?.textContent) || '当前不可用', 'info'); return; }
    const act = a.dataset.act;
    if (act === 'adjust') dialog('adjust', a);
    if (act === 'reread') { a.setAttribute('aria-busy', 'true'); setTimeout(() => { conflict = false; reread = true; render(true); DS.toast('已重读计划修订 5（含最新领取）', 'info'); }, 500); }
    if (act === 'save') { a.setAttribute('aria-busy', 'true'); setTimeout(() => PE.to('pe35'), 500); }
    if (act === 'abandon') dialog('abandon', a);
    if (act === 'reconfirm') dialog('reconfirm', a);
    if (act === 'continue') { auto = true; confirmed = true; PE.to('pe33', { sub: 'running' }); DS.toast('已继续执行；自动节点推进恢复为开启', 'ok'); }
    if (act === 'unsel') { sel = null; PE.setCtx({ sel: null }); CV.select(null); }
    if (act === 'exit-refine') { refine = false; conflict = false; edits = {}; render(true); DS.toast('已退出局部细化预览；回到编辑待执行区', 'info'); }
    if (act === 'fixed-confirm') dialog('fixed', a);
    if (act === 'open-node') { const n = graph().nodes.find((x) => x.id === sel); openNode(sel, 'session', n?.title, statusOf(sel)); }
    if (act === 'auto') { auto = !auto; render(true); }
    if (act === 'del-node') DS.toast('将先列出需求覆盖、输入输出与必需产物的影响，再确认移除', 'info');
  });
  document.addEventListener('change', (e) => { if (e.target.dataset.pred) DS.toast('已更新本地草稿中的前置步骤（未保存）', 'info'); });

  function render(keepView) {
    document.title = `任务画布 · ${PE.byId[S]?.label || ''} · opencode-workflow 设计样例`;
    renderBar(); renderCanvas(); renderSide();
    PE.setEvent(sub === 'pausing' ? '暂停回执成功 · 开放编辑' : null, sub === 'pausing' ? () => { PE.to('pe34'); conflict = false; edits = {}; render(true); } : null);
    if (!keepView && !view) requestAnimationFrame(() => CV?.fit(false));
    view = null;
  }
  DS.mount({ proto: false }); PE.mountProto();
  if (S === 'pe38' && !sel) sel = null;
  render(!!view);
})();
