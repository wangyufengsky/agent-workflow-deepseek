/* 补稿 v4（AD02 / C02）· 需求画布内的“准备独立工作区”区域（设计样例 · 全部模拟）
   复用最新 TD01 准备稿（delivery/assets/start.js）的全部状态与动作，只换容器：确认计划后留在同一任务的需求画布，右侧“工作区”页签。
   - Git：独立分支与 worktree；非 Git：基线快照与独立副本（列出未复制资源）
   - 准备中（阶段名，无百分比）/ 已就绪 / 无读取权限 / 空仓库 / 同名冲突 / 基线前移 / 回执未知（只核对原创建）/ 部分创建（只补建缺失部分）
   - 准备绑定任务、项目、计划修订、确认范围、基线与工作区身份；计划或输入变化后需要重新预览与确认，不复用过期准备
   - 准备成功前“开始执行”禁用；成功后单独开始，不把准备回执当成执行成功
   结果由“服务”决定：原型按任务的样例事实（UTF.prepFacts().outcome）推演；从按钮进入时用短定时器模拟阶段回执。 */
window.PREP = function (opt) {
  'use strict';
  const I = DS.icon, esc = DS.esc;
  const T = opt.T, F = opt.F;
  const git = F.kind === 'git';
  const st = Object.assign({ ws: 'plan', stage: 0, renamed: false, reread: false, busy: '', readable: false }, opt.init || {});
  if (st.ws === 'plan' && F.denied && !st.readable) st.ws = 'denied';
  if (st.ws === 'plan' && F.empty) st.ws = 'empty';
  const branchName = () => F.branch + (st.renamed ? '-2' : '');
  const wsName = () => F.wsName + (st.renamed ? '-2' : '');
  const wsPath = () => F.wsPath + (st.renamed ? '-2' : '');
  const baseNow = () => (st.reread || F.outcome !== 'drift') ? (F.outcome === 'drift' ? F.newBase : F.base) : F.oldBase;
  const copyBtn = (v, label) => `<button class="icon-btn copy" type="button" data-pw="copy" data-v="${esc(v)}" aria-label="复制${esc(label || '')}" title="复制">${I('copy', 'sm')}</button>`;
  const pathRow = (v, label) => `<span class="path"><span class="mono">${esc(v)}</span>${copyBtn(v, label)}</span>`;

  function stageModel() {
    const lab = ['登记任务身份', '固定基线', git ? '创建任务分支' : '复制快照', '创建工作目录', '核对'];
    const okD = git ? [T.id, 'main @ ' + baseNow().sha, '已创建', '已创建', '分支与目录一致'] : [T.id, '快照 ' + F.snap.at.slice(6), F.skipped.length + ' 个资源未复制', '已创建', '副本与快照清单一致'];
    const ws = st.ws;
    const s = ['todo', 'todo', 'todo', 'todo', 'todo'], d = ['未开始', '未开始', '未开始', '未开始', '未开始'];
    const doneTo = (n) => { for (let i = 0; i < n; i++) { s[i] = 'done'; d[i] = okD[i]; } };
    if (ws === 'preparing') { doneTo(st.stage); if (st.stage < 5) { s[st.stage] = 'on'; d[st.stage] = '进行中'; } if (st.fixing) d[2] = '已创建（原记录）'; }
    else if (ws === 'ready') doneTo(5);
    else if (ws === 'unknown') { doneTo(2); s[2] = s[3] = s[4] = 'unk'; d[2] = '回执未收到'; d[3] = '未知'; d[4] = '未知'; }
    else if (ws === 'partial') { doneTo(3); s[3] = 'bad'; d[3] = '失败 · 无写入权限'; d[4] = '未执行'; s[4] = 'na'; }
    else if (ws === 'conflict' && !st.renamed) { doneTo(2); s[2] = 'bad'; d[2] = '停止 · 同名对象已存在'; d[3] = d[4] = '未执行'; s[3] = s[4] = 'na'; }
    else if (ws === 'drift' && !st.reread) { doneTo(1); s[1] = 'bad'; d[1] = '停止 · 基线已前移'; d[2] = d[3] = d[4] = '未执行'; s[2] = s[3] = s[4] = 'na'; }
    return lab.map((l, i) => ({ l, s: s[i], d: d[i] }));
  }
  function stagesHTML() {
    const ms = stageModel();
    const head = st.ws === 'preparing' ? `<span class="spin" style="width:12px;height:12px"></span>正在准备 · 准备成功前不会运行任何写文件的步骤`
      : st.ws === 'ready' ? `${I('check', 'sm')}准备完成 · 10-16 14:26`
      : ['plan'].includes(st.ws) || (st.ws === 'conflict' && st.renamed) || (st.ws === 'drift' && st.reread) ? '准备阶段（点「准备独立工作区」后依次进行）' : '准备阶段';
    return `<div class="stg" role="list" aria-label="准备阶段"><div class="stg-h">${head}</div>
      ${ms.map((m, i) => `<div class="sg ${m.s}" role="listitem"><div class="top"><span class="no">${m.s === 'done' ? I('check') : m.s === 'on' ? '<span class="spin"></span>' : m.s === 'bad' ? I('x') : m.s === 'unk' ? '?' : i + 1}</span><span class="bar"></span></div><span class="lb">${m.l}</span><span class="dt">${esc(m.d)}</span></div>`).join('')}</div>`;
  }
  function status() {
    const w = st.ws;
    if (w === 'preparing') return ['准备中', 'st-run', null];
    if (w === 'ready') return ['已就绪', 'st-ok', 'check'];
    if (w === 'unknown') return ['待核对原创建', 'st-unknown', 'help'];
    if (w === 'partial') return ['部分创建', 'st-fail', 'alert'];
    if (w === 'conflict') return st.renamed ? ['新名称 · 待确认', 'st-wait', 'edit'] : ['同名冲突', 'st-fail', 'alert'];
    if (w === 'drift') return st.reread ? ['新基线 · 待确认', 'st-wait', 'refresh'] : ['基线已前移', 'st-fail', 'alert'];
    if (w === 'denied') return ['无法读取项目', 'st-fail', 'lock'];
    if (w === 'empty') return ['空仓库 · 基线不可用', 'st-fail', 'alert'];
    return ['未准备', 'st-idle', 'clock'];
  }
  function badge() { const s = status(); return `<span class="badge ${s[1]}">${s[2] ? I(s[2], 'sm') : '<span class="spin" style="width:11px;height:11px"></span>'}${s[0]}</span>`; }
  function alertHTML() {
    const w = st.ws, busy = st.busy;
    if (w === 'denied') return `<div class="banner warn ws-alert" role="alert">${I('lock')}<div class="grow"><b>无法读取项目，不能准备工作区</b><p>确认计划后核对项目时，<span class="mono">${esc(F.path)}</span> 没有读取权限（项目授权已变更）。不会改用其他位置，也不会自行修改权限；需求草稿与已确认的计划都保留。</p><div class="ws-acts"><button class="btn secondary sm" data-pw="auth-help">${I('help', 'sm')}授权说明</button><button class="btn secondary sm" data-pw="reread-project" ${busy ? 'disabled' : ''}>${busy === 'reread-project' ? '<span class="spin"></span>读取中' : I('refresh', 'sm') + '重新读取'}</button></div></div></div>`;
    if (w === 'empty') return `<div class="banner warn ws-alert" role="alert">${I('alert')}<div class="grow"><b>Git 仓库还没有任何提交，无法固定基线</b><p>空仓库没有可作为基线的提交，不能创建任务分支，也不会自动建初始提交。先在仓库中提交一次后“重新读取”；要换项目，请从“开始任务”新建任务（本任务与计划保留）。</p><div class="ws-acts"><button class="btn secondary sm" data-pw="reread-empty" ${busy ? 'disabled' : ''}>${busy === 'reread-empty' ? '<span class="spin"></span>读取中' : I('refresh', 'sm') + '重新读取'}</button><button class="btn ghost sm" data-pw="new-task">${I('plus', 'sm')}从“开始任务”新建</button></div></div></div>`;
    if (w === 'unknown') return `<div class="banner unknown ws-alert" role="status">${I('help')}<div class="grow"><b>不知道独立工作区是否已经创建</b><p>14:25:58 发出准备请求（原请求 <span class="mono">${F.prepKey}</span>），「固定基线」之后连接中断，没有收到回执。分支和目录可能已建、可能未建。原请求保持不变：不会再分配第二个目录或分支，也不会开始执行。</p><div class="ws-acts"><button class="btn secondary sm" data-pw="check-origin" ${busy ? 'disabled' : ''}>${busy === 'check' ? '<span class="spin"></span>核对中' : I('search', 'sm') + '核对原创建'}</button></div></div></div>`;
    if (w === 'partial') return `<div class="banner warn ws-alert" role="alert">${I('alert')}<div class="grow"><b>部分创建：任务分支已建，工作目录没有建成</b><p>「创建工作目录」失败：<span class="mono">${esc(F.wsRoot)}</span> 没有写入权限。已创建的任务分支 <span class="mono">${esc(F.branch)}</span> 保留在原仓库中，不会自动删除；原工作区未被改动。修好权限后，可沿用原准备记录只补建工作目录。</p><div class="ws-acts"><button class="btn secondary sm" data-pw="fix-partial" ${busy ? 'disabled' : ''}>${I('folder', 'sm')}补建工作目录</button><button class="btn ghost sm" data-pw="auth-help">${I('help', 'sm')}授权说明</button></div></div></div>`;
    if (w === 'conflict' && !st.renamed) {
      const c = F.conflict;
      return `<div class="banner warn ws-alert" role="alert">${I('alert')}<div class="grow"><b>同名的分支和目录已经存在，准备已停止</b><p>这两个对象不属于本任务的准备记录。不会覆盖，也不会直接拿来复用；需求草稿和已确认的计划都保留，没有创建任何分支或目录。</p>
        <div class="objs"><div class="obj"><span class="k">${I('branch', 'sm')}</span><span class="v">${esc(c.branch.name)}</span><span class="m">分支 · 指向 ${c.branch.at} · ${c.branch.when} · ${c.branch.owner}</span><span class="acts">${copyBtn(c.branch.name, '分支名')}</span></div>
          <div class="obj"><span class="k">${I('folder', 'sm')}</span><span class="v">${esc(c.dir.path)}</span><span class="m">目录 · ${c.dir.note} · ${c.dir.owner}</span><span class="acts">${copyBtn(c.dir.path, '目录路径')}</span></div></div>
        <div class="ws-acts"><button class="btn secondary sm" data-pw="rename" ${busy ? 'disabled' : ''}>${busy === 'rename' ? '<span class="spin"></span>生成中' : I('edit', 'sm') + '使用新名称重新预览'}</button></div></div></div>`;
    }
    if (w === 'conflict' && st.renamed) return `<div class="banner info ws-alert">${I('info')}<div class="grow"><b>已生成新名称，请重新确认</b><p>新分支 <span class="mono">${esc(branchName())}</span> 与新目录 <span class="mono">…/${esc(wsPath().split('/').pop())}</span> 当前都不存在。原有同名分支和目录保持不动。</p></div></div>`;
    if (w === 'drift' && !st.reread) return `<div class="banner warn ws-alert" role="alert">${I('alert')}<div class="grow"><b>基线已前移，准备已停止</b><p>确认计划后 main 又有 2 个新提交。旧基线不再是当前 main，不能静默换成新基线继续；没有创建任何分支或目录。重新读取后，请按新基线重新确认。</p>
        <div class="cmp"><div class="side-b old"><span class="h">确认计划时 · ${F.oldBase.readAt}</span><span class="s">main @ ${F.oldBase.sha}</span></div><span class="ar">${I('arrowRight')}</span><div class="side-b new"><span class="h">现在 · ${F.newBase.readAt} 读取</span><span class="s">main @ ${F.newBase.sha}</span></div></div>
        <div class="commits">${F.newCommits.map((c) => `<div><span class="mono">${c[0]}</span><span class="grow ellipsis">${esc(c[1])}</span><span>${esc(c[2])}</span></div>`).join('')}</div>
        <div class="ws-acts"><button class="btn secondary sm" data-pw="reread" ${busy ? 'disabled' : ''}>${busy === 'reread' ? '<span class="spin"></span>读取中' : I('refresh', 'sm') + '重新读取基线'}</button></div></div></div>`;
    if (w === 'drift' && st.reread) return `<div class="banner info ws-alert">${I('info')}<div class="grow"><b>已读取新基线 main @ ${F.newBase.sha}，请重新确认</b><p>旧基线 ${F.oldBase.sha} 不再使用。工作区将从新基线创建；计划内容不变（计划修订 ${T.planRev}）。</p></div></div>`;
    return '';
  }
  function bodyHTML() {
    const ready = st.ws === 'ready';
    if (git) {
      const b = baseNow();
      const baseLine = st.ws === 'drift' && !st.reread
        ? `<span class="line"><span class="code old">main @ ${F.oldBase.sha}</span><span class="tagx">${I('alert', 'sm')}已过期</span></span>`
        : `<span class="line"><span class="code${st.ws === 'drift' ? ' new' : ''}">main @ ${b.sha}</span>${st.ws === 'drift' ? `<span class="tagx new">新基线</span>` : ''}<span class="sub2">读取于 ${b.readAt} · 完整 SHA 见诊断详情</span></span>`;
      const brState = st.ws === 'conflict' && !st.renamed ? `<span class="tagx warn">${I('alert', 'sm')}同名已存在</span>` : st.renamed ? `<span class="tagx new">新名称</span>` : ready || st.ws === 'partial' ? `<span class="tagx ok">${I('check', 'sm')}已创建</span>` : `<span class="tagx">系统生成</span>`;
      return `<dl class="ws-kv">
        <dt>原项目</dt><dd><span class="line">${esc(F.project)}<span class="sub2">${esc(F.remote)}</span></span>${pathRow(F.path, '原项目路径')}</dd>
        <dt>基线</dt><dd>${baseLine}</dd>
        <dt>任务分支</dt><dd><span class="line"><span class="code">${esc(branchName())}</span>${brState}</span><span class="sub2">由服务按任务 ID 生成；同名时不会覆盖或复用</span></dd>
        <dt>工作目录</dt><dd><span class="line">${esc(wsName())}${st.ws === 'partial' ? `<span class="tagx warn">${I('x', 'sm')}未建成</span>` : ready ? `<span class="tagx ok">${I('check', 'sm')}已创建</span>` : ''}</span>${pathRow(wsPath(), '工作目录路径')}</dd>
        <dt>读写授权</dt><dd><span>写入：只在任务工作目录（含并行子工作区）</span><span>读取：任务工作目录与基线 ${b.sha}</span><span class="sub2">原工作区：不读写 · ${F.head}${F.dirty ? ` 上 ${F.dirty} 个未提交改动` : ''}、暂存区和当前分支保持不变</span></dd>
        <dt>并行写</dt><dd><span class="policy">${I('lock', 'sm')}<span>${esc(F.policy)}</span></span><span class="sub2">由服务决定，只展示</span></dd></dl>`;
    }
    const sk = F.skipped[0];
    return `<dl class="ws-kv">
      <dt>原项目</dt><dd><span class="line">${esc(F.project)}<span class="sub2">直接目录 · 不受 Git 管理，不会执行 git init</span></span>${pathRow(F.path, '原项目路径')}</dd>
      <dt>基线快照</dt><dd>${ready ? `<span class="line"><span class="code">${F.snap.ref}</span><span class="sub2">固定于 ${F.snap.at}</span></span>` : `<span class="line">准备时固定<span class="sub2">范围预检读取于 ${F.snap.pre}</span></span>`}</dd>
      <dt>范围</dt><dd>${esc(F.scope)}</dd>
      <dt>排除</dt><dd><span class="excl">${F.excludes.map((x) => `<span class="code">${esc(x)}</span>`).join('')}</span></dd>
      <dt>未复制</dt><dd><div class="skip"><span class="row">${I('alert', 'sm')}<span class="mono" style="color:var(--ink);overflow-wrap:anywhere">${esc(sk.path)}</span><span class="tagx">${sk.size}</span></span><span class="sub2">${esc(sk.why)}</span><p>这个文件不会出现在独立副本里，需要它的步骤会读不到。独立副本不等于整个项目都已隔离。</p></div></dd>
      <dt>独立副本</dt><dd><span class="line">${esc(F.wsName)}${ready ? `<span class="tagx ok">${I('check', 'sm')}已创建</span>` : ''}</span>${pathRow(F.wsPath, '独立副本路径')}</dd>
      <dt>读写授权</dt><dd><span>写入：只在独立副本</span><span>读取：独立副本与基线快照</span><span class="sub2">原目录：不写入 · 交付时逐项检查当前原目录，确认后才应用</span></dd>
      <dt>并行写</dt><dd><span class="policy">${I('lock', 'sm')}<span>${esc(F.policy)}</span></span></dd></dl>`;
  }
  function bindHTML() {
    const b = baseNow();
    return `<div class="pw-bind"><div class="pw-cap">${I('lock', 'sm')}准备绑定（服务记录；变化后不复用旧准备）</div><dl class="ws-kv">
      <dt>任务</dt><dd><span class="line">${esc(T.title)}<span class="mono sub2">${T.id}</span></span></dd>
      <dt>计划</dt><dd>${T.fixed ? `固定模板 <span class="mono">${esc(T.tpl.ref)}@r${T.tpl.rev}</span> · 计划修订 ${T.planRev}` : `计划修订 ${T.planRev}`} · 已确认 ${esc(T.confirmedAt || '14:21')}<span class="sub2">确认范围 <span class="mono">planningBindingHash 9c4e…a7d0</span></span></dd>
      <dt>基线</dt><dd>${git ? `main @ ${st.ws === 'drift' && !st.reread ? F.oldBase.sha : b.sha}` : '准备时固定快照'}</dd>
      <dt>工作区</dt><dd>${git ? `分支 <span class="mono">${esc(branchName())}</span> · worktree` : '独立副本'}</dd></dl>
      <p class="hint">需求输入、计划修订或基线变化后，需要按原规则重新预览与确认；不会沿用过期的准备。</p></div>`;
  }
  function diagHTML() {
    const prepared = !['plan', 'denied', 'empty'].includes(st.ws) && !(st.ws === 'drift') && !(st.ws === 'conflict' && st.renamed);
    const rows = git ? [['任务引用', 'task/' + T.id], ['计划版本', `plan/${T.id}@r${T.planRev}`], ['项目引用', `project/${F.wsName.split(' · ')[0]}`], ['基线 SHA', st.ws === 'drift' && !st.reread ? F.oldBase.full + '（已过期）' : baseNow().full], ['准备请求', st.ws === 'conflict' || st.ws === 'drift' || prepared ? F.prepKey : null], ['工作区引用', st.ws === 'ready' || st.ws === 'partial' ? 'ws/' + T.id : null]]
      : [['任务引用', 'task/' + T.id], ['计划版本', `plan/${T.id}@r${T.planRev}`], ['基线快照', st.ws === 'ready' ? F.snap.ref : null], ['准备请求', prepared ? F.prepKey : null], ['工作区引用', st.ws === 'ready' ? 'ws/' + T.id : null]];
    return `<details class="adv diag"><summary><span class="chev">${I('chevRight', 'sm')}</span><span class="grow">诊断详情<span class="hint">公开安全引用，可复制</span></span></summary>
      <div class="diag-body">${rows.map(([k, v]) => `<div class="ref"><span class="k">${k}</span>${v ? `<span class="v">${esc(v)}</span>${copyBtn(v, k)}` : '<span class="v na">准备时生成</span><span></span>'}</div>`).join('')}
      <p class="hint" style="margin-top:8px">不包含凭据引用、目录句柄、设备身份、租约或其他内部事实。</p></div></details>`;
  }
  function html() {
    return `<div class="pw">
      <div class="pw-head"><span class="tile">${I(git ? 'branch' : 'layers')}</span><div class="grow"><div class="tt">工作区</div><div class="hint">${git ? 'Git · 独立分支与 worktree' : '非 Git · 基线快照与独立副本'}</div></div>${badge()}</div>
      ${alertHTML()}
      ${st.ws === 'plan' || st.ws === 'denied' || st.ws === 'empty' ? '' : stagesHTML()}
      <div class="ws-body">${bodyHTML()}</div>
      ${st.ws === 'plan' ? stagesHTML() : ''}
      ${bindHTML()}
      ${diagHTML()}</div>`;
  }
  /* 页签底部：两步按钮（准备独立工作区 → 开始执行）与禁用原因 */
  function foot() {
    const w = st.ws;
    const guard = `<div class="guard">${I('shield', 'sm')}<span>准备成功前不运行任何写文件的步骤；原项目${git ? '工作区' : '目录'}不变。</span></div>`;
    const startOff = (why) => `<span class="dis-wrap pw-dis"><button class="btn secondary" aria-disabled="true" aria-describedby="pwWhyStart" data-pw="dis">${I('play', 'sm')}开始执行</button><span class="dis-reason" id="pwWhyStart">${why}</span></span>`;
    const prepOff = (why) => `<span class="dis-wrap pw-dis"><button class="btn primary" aria-disabled="true" aria-describedby="pwWhyP" data-pw="dis">${I('folder', 'sm')}准备独立工作区</button><span class="dis-reason" id="pwWhyP">${why}</span></span>`;
    let b;
    if (w === 'plan') b = `<button class="btn primary" data-pw="prepare" id="pwPrepare">${I('folder', 'sm')}准备独立工作区</button>${startOff('准备成功后才能开始执行')}${guard}`;
    else if (w === 'preparing') b = `<button class="btn primary" disabled><span class="spin"></span>正在准备独立工作区</button>${startOff('准备成功后才能开始执行')}<p class="why">可以离开本页，准备会继续；回来时读取原准备记录，不会重新创建。</p>`;
    else if (w === 'ready') b = `<div class="ready-row">${I('check')}<span class="grow">独立工作区已就绪</span><span class="mono" style="font-size:12px;color:var(--sub)">${git ? baseNow().sha : F.snap.ref}</span></div><button class="btn primary" data-pw="start" id="pwStart">${I('play', 'sm')}开始执行</button><p class="why">开始后进入同一任务的任务画布；第一批启动「${esc(opt.firstStep || '')}」</p>`;
    else if (w === 'unknown') b = `<button class="btn secondary" data-pw="check-origin" ${st.busy ? 'disabled' : ''}>${st.busy === 'check' ? '<span class="spin"></span>核对中' : I('search', 'sm') + '核对原创建'}</button>${startOff('原创建核对前不能开始执行，也不会再准备新的工作区')}`;
    else if (w === 'partial') b = `${startOff('工作目录补建并核对成功前不能开始执行')}<p class="why">已发生的步骤见上方「准备阶段」；不会自动清理已创建的分支。</p>`;
    else if (w === 'conflict') b = st.renamed ? `<button class="btn primary" data-pw="prepare" id="pwPrepare">${I('folder', 'sm')}按新名称准备独立工作区</button>${startOff('准备成功后才能开始执行')}${guard}` : `${prepOff('同名分支和目录已存在，先用新名称重新预览')}${startOff('准备成功后才能开始执行')}`;
    else if (w === 'drift') b = st.reread ? `<button class="btn primary" data-pw="prepare" id="pwPrepare">${I('folder', 'sm')}按新基线准备独立工作区</button>${startOff('准备成功后才能开始执行')}${guard}` : `${prepOff('基线已前移，先重新读取并确认新基线')}${startOff('准备成功后才能开始执行')}`;
    else if (w === 'denied') b = `${prepOff('无法读取项目：先完成授权，再重新读取')}${startOff('准备成功后才能开始执行')}`;
    else if (w === 'empty') b = `${prepOff('空仓库没有可作为基线的提交')}${startOff('准备成功后才能开始执行')}`;
    return `<div class="side-foot pw-foot">${b}</div>`;
  }
  /* 任务总阶段胶囊“准备工作区”段的子状态 */
  function stage() {
    const s = status();
    const tone = { 'st-run': 'run', 'st-ok': 'ok', 'st-unknown': 'unk', 'st-fail': 'fail', 'st-wait': 'need', 'st-idle': 'need' }[s[1]];
    return [3, s[0] + (st.ws === 'preparing' ? ' · ' + (stageModel().find((m) => m.s === 'on') || {}).l : ''), tone, s[2] || 'folder'];
  }
  /* ---------- 对话框 ---------- */
  function prepDlg() {
    const mk = git ? [`任务分支 <span class="mono">${esc(branchName())}</span>，基于 <span class="mono">main @ ${baseNow().sha}</span>`, `工作目录 ${esc(wsName())}<br><span class="mono" style="font-size:12px;color:var(--muted);word-break:break-all">${esc(wsPath())}</span>`]
      : [`基线快照：${esc(F.scope)}，排除 ${F.excludes.map(esc).join('、')}`, `独立副本 ${esc(F.wsName)}<br><span class="mono" style="font-size:12px;color:var(--muted);word-break:break-all">${esc(F.wsPath)}</span>`, `未复制：<span class="mono">${esc(F.skipped[0].path)}</span>（${F.skipped[0].size}）`];
    const keep = git ? [`原工作区 <span class="mono">${esc(F.path)}</span> 的文件、暂存区和当前分支 ${F.head}`, F.dirty ? `${F.dirty} 个未提交改动` : '原工作区当前无未提交改动'] : [`原目录 <span class="mono">${esc(F.path)}</span> 的全部文件`, '不会执行 git init，也不会创建 Git 仓库'];
    return `<div class="dialog-body"><h2 id="dlgT">${st.renamed ? '按新名称准备独立工作区？' : st.reread ? '按新基线准备独立工作区？' : '准备独立工作区？'}</h2>
      <p>这一步只准备工作区，不会运行任何步骤；准备成功后再单独开始执行。绑定：计划修订 ${T.planRev}${git ? ' · 基线 main @ ' + baseNow().sha : ''}。</p>
      <div class="dlg-cap">将创建</div><div class="dlg-list">${mk.map((x) => `<div class="li mk">${I('plus', 'sm')}<span>${x}</span></div>`).join('')}</div>
      <div class="dlg-cap">保持不变</div><div class="dlg-list">${keep.map((x) => `<div class="li keep">${I('shield', 'sm')}<span>${x}</span></div>`).join('')}</div></div>
      <div class="dialog-foot"><button class="btn ghost" data-pw="dlg-close">再看看</button><button class="btn primary" data-pw="prepare-go" autofocus>${st.renamed ? '按新名称准备' : st.reread ? '按新基线准备' : '准备独立工作区'}</button></div>`;
  }
  function startDlg() {
    return `<div class="dialog-body"><h2 id="dlgT">开始执行这个计划？</h2><p>将启动第一批步骤：<b class="ink">${esc(opt.firstStep || '')}</b>。写文件的步骤只在${git ? '任务工作区' : '独立副本'} <b class="ink">${esc(git ? wsName() : F.wsName)}</b> 中运行，原项目不受影响。执行结束后任务停在“等待交付”，由你选择交付方式。${T.fixed ? '<br>固定模板任务开始后，步骤仍然锁定。' : ''}</p></div>
      <div class="dialog-foot"><button class="btn ghost" data-pw="dlg-close">再看看</button><button class="btn primary" data-pw="start-go" autofocus>${I('play', 'sm')}开始执行</button></div>`;
  }
  function authDlg() {
    const partial = st.ws === 'partial';
    return `<div class="dialog-body"><h2 id="dlgT">授权说明</h2>
      <p>${partial ? `准备工作区需要对 <span class="mono">${esc(F.wsRoot)}</span> 有写入权限。` : `需要读取 <span class="mono">${esc(F.path)}</span> 才能识别项目类型并固定基线。`}opencode-workflow 不会自行修改目录权限，也不会改用其他位置。</p>
      <ol><li>${partial ? '确认该目录属于当前用户，或请目录所有者开放写入权限。' : '确认目录存在，并属于当前用户或已对当前用户开放读取。'}</li><li>macOS：在 系统设置 → 隐私与安全性 → 文件与文件夹 中允许 opencode-workflow 访问该位置。</li><li>回到本页${partial ? '「补建工作目录」' : '「重新读取」'}；需求与计划都会保留。</li></ol></div>
      <div class="dialog-foot"><button class="btn primary" data-pw="dlg-close" autofocus>知道了</button></div>`;
  }
  function fixDlg() {
    return `<div class="dialog-body"><h2 id="dlgT">只补建工作目录？</h2>
      <p>沿用原准备记录 <span class="mono">${F.prepKey}</span> 和已创建的任务分支 <span class="mono">${esc(F.branch)}</span>，只创建缺失的工作目录并重新核对。不会再建分支，也不会分配第二个目录。</p>
      <div class="dlg-list"><div class="li mk">${I('plus', 'sm')}<span>工作目录 ${esc(F.wsName)}<br><span class="mono" style="font-size:12px;color:var(--muted);word-break:break-all">${esc(F.wsPath)}</span></span></div></div></div>
      <div class="dialog-foot"><button class="btn ghost" data-pw="dlg-close">再看看</button><button class="btn primary" data-pw="fix-go" autofocus>补建工作目录</button></div>`;
  }
  /* ---------- 推演（服务回执）---------- */
  let timer = null;
  function set(ws, extra) { Object.assign(st, extra || {}); st.ws = ws; opt.onState(ws, st); }
  function tick() {
    clearTimeout(timer);
    if (st.ws !== 'preparing') return;
    timer = setTimeout(() => {
      st.stage++;
      const oc = st.fixing || st.renamed || st.reread ? 'ok' : F.outcome;
      if (oc === 'drift' && st.stage >= 1) { st.stage = 1; set('drift'); return; }
      if (oc === 'conflict' && st.stage >= 2) { set('conflict'); return; }
      if (oc === 'unknown' && st.stage >= 2) { set('unknown'); return; }
      if (oc === 'partial' && st.stage >= 3) { set('partial'); return; }
      if (st.stage >= 5) { set('ready', { fixing: false }); DS.toast('独立工作区已就绪（模拟）· 还没有开始执行', 'ok'); return; }
      opt.rerender(); tick();
    }, opt.reduced ? 500 : 900);
  }
  function act(a, el) {
    switch (a) {
      case 'dis': { const r = el.getAttribute('aria-describedby'); const t = r && document.getElementById(r); if (t) DS.toast(t.textContent, 'info'); return true; }
      case 'copy': DS.toast('已复制（原型示意，未写剪贴板）', 'info'); return true;
      case 'dlg-close': opt.closeDialog(); return true;
      case 'prepare': opt.openDialog(prepDlg(), el); return true;
      case 'prepare-go': opt.closeDialog(); set('preparing', { stage: 0 }); tick(); return true;
      case 'start': opt.openDialog(startDlg(), el); return true;
      case 'start-go': opt.closeDialog(); DS.toast('已开始执行，正在打开任务画布', 'ok'); setTimeout(() => opt.onStart(), 500); return true;
      case 'check-origin': st.busy = 'check'; opt.rerender(); setTimeout(() => { st.busy = ''; DS.toast('核对结果：原请求已创建分支与工作目录，没有重复创建', 'ok'); set('ready'); }, 1100); return true;
      case 'fix-partial': opt.openDialog(fixDlg(), el); return true;
      case 'fix-go': opt.closeDialog(); set('preparing', { stage: 3, fixing: true }); tick(); return true;
      case 'auth-help': opt.openDialog(authDlg(), el); return true;
      case 'rename': st.busy = 'rename'; opt.rerender(); setTimeout(() => { st.busy = ''; set('conflict', { renamed: true }); opt.focus('#pwPrepare'); }, 900); return true;
      case 'reread': st.busy = 'reread'; opt.rerender(); setTimeout(() => { st.busy = ''; set('drift', { reread: true }); opt.focus('#pwPrepare'); }, 1000); return true;
      case 'reread-project': st.busy = 'reread-project'; opt.rerender(); setTimeout(() => { st.busy = ''; DS.toast('已重新读取：现在可以读取项目（你已完成授权 · 模拟）', 'ok'); set('plan', { readable: true }); opt.focus('#pwPrepare'); }, 1000); return true;
      case 'reread-empty': st.busy = 'reread-empty'; opt.rerender(); setTimeout(() => { st.busy = ''; opt.rerender(); DS.toast('已重新读取：仓库仍没有任何提交', 'warn'); }, 900); return true;
      case 'new-task': opt.onNewTask(); return true;
    }
    return false;
  }
  return { html, foot, stage, act, tick, get ws() { return st.ws; }, get st() { return st; }, git };
};
