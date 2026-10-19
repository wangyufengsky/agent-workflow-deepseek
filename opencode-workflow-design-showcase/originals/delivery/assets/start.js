/* TD01 开始任务与隔离准备 · 页面脚本（设计样例 · 合成数据）
   - 结构沿用原稿 start.html：项目 → 目标 → 流程 → 计划确认（新增「工作区」卡）
   - 所有写操作（形成草稿、准备工作区、核对、补建、开始执行）只用定时器切换模拟状态，不发请求、不写本机存储
   - 直接打开某个状态 = 静态画面；从按钮进入（?sim=1）才自动推进准备阶段 */
(function () {
  const S = TD.init('start.html');
  const FX = window.START_FX;
  const I = DS.icon, esc = DS.esc, $ = DS.$, $$ = DS.$$;
  const Q = new URLSearchParams(location.search);

  const CFG = {
    'td01-git-plan': { phase: 'plan', kind: 'git', ws: 'plan' },
    'td01-nongit-plan': { phase: 'plan', kind: 'dir', ws: 'plan' },
    'td01-checking': { phase: 'edit', project: 'order', check: 'checking' },
    'td01-combined': { phase: 'plan', kind: 'git', ws: 'plan', combined: true },
    'td01-preparing': { phase: 'plan', ws: 'preparing' },
    'td01-ready': { phase: 'plan', ws: 'ready' },
    'td01-unavailable': { phase: 'edit', project: 'pay' },
    'td01-empty-repo': { phase: 'edit', project: 'notify' },
    'td01-name-conflict': { phase: 'plan', kind: 'git', ws: 'conflict' },
    'td01-baseline-drift': { phase: 'plan', kind: 'git', ws: 'drift' },
    'td01-prepare-unknown': { phase: 'plan', kind: 'git', ws: 'unknown' },
    'td01-partial': { phase: 'plan', kind: 'git', ws: 'partial' },
  };
  const C = CFG[S] || CFG['td01-git-plan'];
  const kind = C.kind || (Q.get('kind') === 'dir' ? 'dir' : 'git');
  const combined = !!C.combined || Q.get('mode') === 'combined';
  const sim = Q.get('sim') === '1';
  const alt = Q.get('alt') === '2';
  const T = FX.tasks[kind];
  const PJ = (id) => FX.projects.find((p) => p.id === id);
  const FL = (id) => FX.flows.find((f) => f.id === id);

  const st = {
    phase: C.phase,
    project: C.phase === 'edit' ? C.project : T.project,
    check: C.check || 'ok',
    goal: FX.tasks.git.goal,
    name: FX.tasks.git.name,
    flow: C.phase === 'edit' ? 'std' : T.flow,
    ws: C.ws,
    stage: C.ws === 'preparing' ? (+Q.get('at') || 2) : 0,
    renamed: alt,
    reread: false,
    busy: '',
  };
  const branchName = () => T.branch + (st.renamed ? '-2' : '');
  const wsName = () => T.wsName + (st.renamed ? '-2' : '');
  const wsPath = () => T.wsPath + (st.renamed ? '-2' : '');

  /* ---------- 小部件 ---------- */
  const copyBtn = (v, label) => `<button class="icon-btn copy" type="button" data-copy="${esc(v)}" aria-label="复制${esc(label || '')}" title="复制">${I('copy', 'sm')}</button>`;
  const pathRow = (v, label) => `<span class="path"><span class="mono">${esc(v)}</span>${copyBtn(v, label)}</span>`;
  function isoChip(p, check) {
    if (check === 'checking') return `<span class="badge st-unknown"><span class="spin"></span>正在核对项目类型</span>`;
    if (p.denied) return `<span class="badge st-danger">${I('lock', 'sm')}无法读取 · 权限不足</span>`;
    if (p.kind === 'git') return `<span class="iso-k">${I('branch', 'sm')}Git · 独立分支与 worktree</span>`;
    return `<span class="iso-k">${I('layers', 'sm')}非 Git · 基线快照与独立副本</span>`;
  }
  function isoRow(p, check) {
    let extra = '';
    if (check === 'checking') extra = `<span>核对完成前不按非 Git 处理，也不能准备工作区</span>`;
    else if (p.denied) extra = `<span>隔离方式要读到项目后才能确定</span>`;
    else if (p.empty) extra = `<span class="badge st-fail">${I('alert', 'sm')}空仓库 · 没有可用基线</span>`;
    else if (p.kind === 'git') extra = `<span>原工作区在 ${p.head} · ${p.dirty} 个未提交改动保持不变</span>`;
    else extra = `<span>不受 Git 管理 · 不会初始化仓库</span>`;
    return `<div class="iso"><span class="lbl">隔离方式</span>${isoChip(p, check)}${extra}</div>`;
  }
  function wTag(w) { return w === 'rw' ? '<span class="w w-rw">写文件</span>' : w === 'ro' ? '<span class="w w-ro">只读</span>' : '<span class="w w-human">人工</span>'; }
  const pnode = (n) => `<div class="pnode"><span class="n">${esc(n.t)}</span><span class="m">${esc(n.r)}${wTag(n.w)}</span></div>`;
  function planNodes() {
    return T.nodes.map((n) => n.par ? `<div class="ppar" aria-label="并行"><span class="pl">并行</span>${n.par.map(pnode).join('')}</div>` : pnode(n))
      .join('<span class="parrow" aria-hidden="true">→</span>') + `<span class="parrow" aria-hidden="true">→</span><span class="pend">${I('target', 'sm')}交付</span>`;
  }

  /* ---------- 页头 ---------- */
  function header() {
    $('.header').innerHTML = `<h1>${I('plus')}开始任务</h1><span class="spacer"></span>
      <span class="hint-wide">草稿 → 确认计划 → 准备独立工作区 → 开始执行，逐步分开进行</span>
      <span class="td-mock">${I('info', 'sm')}设计样例 · 合成数据，不连接任务 / Git / 目录</span>`;
  }

  /* ---------- 编辑阶段（原稿：项目 → 目标 → 流程） ---------- */
  function whyEdit() {
    const p = PJ(st.project);
    if (!p) return '先选择项目';
    if (st.check === 'checking') return '正在核对项目类型，核对完成后才能形成草稿';
    if (p.denied) return '读不到这个项目，不能形成草稿';
    if (p.empty) return '这个仓库没有可用基线，无法准备独立工作区';
    if (!st.goal.trim()) return '写下目标后才能形成草稿';
    if (!st.flow) return '还需要选择流程';
    return '';
  }
  function projOpt(p, locked) {
    const sel = st.project === p.id;
    const cls = sel && p.denied ? ' bad' : sel && p.empty ? ' warnb' : '';
    return `<button class="opt${cls}" role="radio" aria-checked="${sel}" ${locked ? 'disabled' : ''} data-a="project" data-id="${p.id}"><span class="r"></span><span class="grow"><div class="t">${esc(p.name)}</div><div class="d mono">${esc(p.path)}</div>${sel ? isoRow(p, st.check) : ''}</span></button>`;
  }
  function projProblem() {
    const p = PJ(st.project);
    if (!p || st.check === 'checking') return '';
    if (p.denied) return `<div class="banner danger" role="alert">${I('lock')}<div class="grow"><b>无法读取「${esc(p.name)}」</b><p>opencode-workflow 对 <span class="mono">${esc(p.path)}</span> 没有读取权限，读不到项目类型和基线，所以不能形成草稿，也不能准备独立工作区。已填写的目标和流程保留。</p></div><div class="actions"><button class="btn secondary sm" data-a="view-project">${I('folder', 'sm')}查看项目</button><button class="btn ghost sm" data-a="auth-help">${I('help', 'sm')}授权说明</button></div></div>`;
    if (p.empty) return `<div class="banner warn" role="alert">${I('alert')}<div class="grow"><b>「${esc(p.name)}」是空仓库，没有可用基线</b><p>仓库还没有任何提交，无法固定基线 SHA，也就无法创建任务分支。opencode-workflow 不会替你创建初始提交，也不会用占位 SHA 继续。请先在原项目中完成首次提交，再重新读取。</p></div><div class="actions"><button class="btn secondary sm" data-a="reread-project">${st.busy === 'reread-project' ? '<span class="spin"></span>读取中' : I('refresh', 'sm') + '重新读取'}</button><button class="btn ghost sm" data-a="view-project">${I('folder', 'sm')}查看项目</button></div></div>`;
    return '';
  }
  function editView() {
    const p = PJ(st.project), f = FL(st.flow);
    const rec = FX.projects.slice(0, 3);
    const extra = p && !rec.includes(p) ? [p] : [];
    const busy = st.busy === 'draft';
    const why = whyEdit();
    const isoTxt = !p ? '<span class="muted">选择项目后显示</span>' : st.check === 'checking' ? '<span class="badge st-unknown"><span class="spin"></span>核对中</span>' : p.denied ? '<span class="badge st-danger">' + I('lock', 'sm') + '无法确定</span>' : p.kind === 'git' ? 'Git · 独立分支与 worktree' : '非 Git · 基线快照与独立副本';
    const baseTxt = !p || st.check === 'checking' ? '<span class="muted">核对项目后显示</span>' : p.denied ? '<span class="muted">读取不到</span>' : p.empty ? '<span class="badge st-fail">' + I('alert', 'sm') + '无 · 仓库没有提交</span>' : p.kind === 'git' ? esc(p.head) + ' · 准备时固定 SHA' : '基线快照 · 准备时固定';
    return `
    <div class="page-head"><div class="grow"><h2 class="title">开始一个任务</h2><p class="lede">选好项目，写下目标，再挑一个流程，opencode-workflow 会先形成一份需求草稿供你审阅——此时不会开始执行。每个任务都在自己的独立工作区里运行，原项目保持不变。</p></div></div>
    <div class="layout">
      <div>
        <section class="step ${p && !p.denied && !p.empty && st.check === 'ok' ? 'ok' : ''}">
          <span class="step-no">${p && !p.denied && !p.empty && st.check === 'ok' ? I('check', 'sm') : '1'}</span>
          <div class="col" style="gap:10px">
            <span class="step-title">项目</span>
            <div class="opts" role="radiogroup" aria-label="选择项目">
              ${rec.concat(extra).map((x) => projOpt(x, busy)).join('')}
              <button class="opt more-opt" ${busy ? 'disabled' : ''} data-a="pick-project">${I('search', 'sm')}其他项目…</button>
            </div>
            ${projProblem()}
            <p class="proj-note">${I('shield', 'sm')}<span>隔离是规则，不是选项：Git 项目用独立分支与 worktree，非 Git 项目用基线快照与独立副本；没有“直接在原目录运行”。</span></p>
          </div>
        </section>

        <section class="step ${st.goal.trim() ? 'ok' : ''} ${p ? '' : 'off'}" id="goalStep">
          <span class="step-no">${st.goal.trim() ? I('check', 'sm') : '2'}</span>
          <div class="col" style="gap:10px">
            <div class="row"><label class="step-title" for="goal">目标</label>${p ? `<span class="hint">在 ${esc(p.name)} 中</span>` : '<span class="hint">先选择项目</span>'}</div>
            <div class="goal">
              <textarea id="goal" ${busy || !p ? 'readonly' : ''} placeholder="描述要做什么，以及完成后希望看到的结果。">${esc(st.goal)}</textarea>
              <div class="goal-foot">
                <label class="name-inline" for="name">${I('edit', 'sm')}任务名称</label>
                <span class="name-inline grow"><input id="name" ${busy ? 'readonly' : ''} value="${esc(st.name)}" placeholder="留空时从目标自动生成"></span>
                <span class="counter" id="cnt">${[...st.goal].length} 字</span>
              </div>
            </div>
          </div>
        </section>

        <section class="step ${st.flow ? 'ok' : ''}">
          <span class="step-no">${st.flow ? I('check', 'sm') : '3'}</span>
          <div class="col" style="gap:10px">
            <div class="row"><span class="step-title">流程</span><span class="hint">决定任务会经过哪些步骤</span></div>
            <div class="opts" role="radiogroup" aria-label="选择流程">
              ${FX.flows.map((x) => `<button class="opt" role="radio" aria-checked="${st.flow === x.id}" ${busy ? 'disabled' : ''} data-a="flow" data-id="${x.id}"><span class="r"></span><span class="grow"><div class="t">${esc(x.name)}</div><div class="d">${esc(x.desc)}</div><div class="chain">${x.steps.map((s, i) => `${i ? '<i>→</i>' : ''}<span>${esc(s)}</span>`).join('')}</div></span></button>`).join('')}
              <button class="opt more-opt" ${busy ? 'disabled' : ''} data-a="pick-flow">${I('search', 'sm')}全部流程…</button>
            </div>
          </div>
        </section>
      </div>

      <aside class="summary">
        <div class="card">
          <div style="padding:16px 18px 6px"><div class="eyebrow">将要创建</div>
            <div style="font-size:15px;font-weight:500;margin-top:6px;overflow-wrap:anywhere" id="sumName">${esc(st.name) || '<span class="muted">未命名任务</span>'}</div></div>
          <dl style="margin:0;padding:4px 18px 10px">
            <div class="sum-row"><dt>项目</dt><dd>${p ? esc(p.name) : '<span class="muted">未选择</span>'}</dd></div>
            <div class="sum-row"><dt>隔离</dt><dd>${isoTxt}</dd></div>
            <div class="sum-row"><dt>基线</dt><dd>${baseTxt}</dd></div>
            <div class="sum-row"><dt>流程</dt><dd>${f ? `${esc(f.name)} <span class="badge st-ok" style="height:18px">版本 r${f.rev} 已核对</span>` : '<span class="muted">未选择</span>'}</dd></div>
          </dl>
          <div style="padding:6px 18px 4px;box-shadow:inset 0 1px 0 var(--line)">
            <div class="eyebrow" style="margin:10px 0 10px">接下来</div>
            <div class="next">
              <div class="nx"><div class="rail"><i class="here">1</i><b></b></div><div class="tx"><strong>形成需求草稿</strong>本页完成，不会入队或执行</div></div>
              <div class="nx"><div class="rail"><i>2</i><b></b></div><div class="tx"><strong>确认计划</strong>可调整步骤、模型与预算</div></div>
              <div class="nx"><div class="rail"><i>3</i><b></b></div><div class="tx"><strong>准备独立工作区</strong>${p && p.kind === 'dir' ? '固定基线快照并复制独立副本' : '创建任务分支与 worktree'}，原项目不变</div></div>
              <div class="nx"><div class="rail"><i>4</i></div><div class="tx"><strong>开始执行</strong>准备成功后单独启动</div></div>
            </div>
          </div>
          <div class="act">
            <button class="btn primary lg" id="go" ${why || busy ? 'disabled' : ''} data-a="draft" aria-describedby="why">${busy ? '<span class="spin"></span>正在形成草稿' : '形成需求草稿'}</button>
            <p class="why" id="why">${esc(why)}</p>
          </div>
        </div>
      </aside>
    </div>`;
  }

  /* ---------- 计划阶段（草稿已形成、计划已确认；新增「工作区」卡） ---------- */
  function stageModel() {
    const lab = ['登记任务身份', '固定基线', kind === 'git' ? '创建任务分支' : '复制快照', '创建工作目录', '核对'];
    const okD = kind === 'git'
      ? [T.id, 'main @ ' + T.base.sha, '已创建', '已创建', '分支与目录一致']
      : [T.id, '快照 ' + T.snap.at.slice(6), '1 个资源未复制', '已创建', '副本与快照清单一致'];
    const ws = st.ws;
    let s = ['todo', 'todo', 'todo', 'todo', 'todo'], d = ['未开始', '未开始', '未开始', '未开始', '未开始'];
    const doneTo = (n) => { for (let i = 0; i < n; i++) { s[i] = 'done'; d[i] = okD[i]; } };
    if (ws === 'preparing') { doneTo(st.stage); if (st.stage < 5) { s[st.stage] = 'on'; d[st.stage] = '进行中'; } if (+Q.get('at') === 3) d[2] = '已创建（原记录）'; }
    else if (ws === 'ready') doneTo(5);
    else if (ws === 'unknown') { doneTo(2); s[2] = s[3] = s[4] = 'unk'; d[2] = '回执未收到'; d[3] = '未知'; d[4] = '未知'; }
    else if (ws === 'partial') { doneTo(3); s[3] = 'bad'; d[3] = '失败 · 无写入权限'; d[4] = '未执行'; s[4] = 'na'; }
    else if (ws === 'conflict' && !st.renamed) { doneTo(2); s[2] = 'bad'; d[2] = '停止 · 同名对象已存在'; d[3] = d[4] = '未执行'; s[3] = s[4] = 'na'; }
    else if (ws === 'drift' && !st.reread) { doneTo(1); s[1] = 'bad'; d[1] = '停止 · 基线已前移'; d[2] = d[3] = d[4] = '未执行'; s[2] = s[3] = s[4] = 'na'; }
    return lab.map((l, i) => ({ l, s: s[i], d: d[i] }));
  }
  function stagesHTML() {
    const ms = stageModel();
    const head = st.ws === 'preparing' ? `<span class="spin" style="width:12px;height:12px"></span>正在准备 · 准备成功前不会运行任何写文件的节点`
      : st.ws === 'ready' ? `${I('check', 'sm')}准备完成 · 10-15 ${kind === 'git' ? '10:02:11' : '09:40:26'}`
      : ['plan'].includes(st.ws) || (st.ws === 'conflict' && st.renamed) || (st.ws === 'drift' && st.reread) ? '准备阶段（点「准备独立工作区」后依次进行）'
      : '准备阶段';
    return `<div class="stg" role="list" aria-label="准备阶段">
      <div class="stg-h">${head}</div>
      ${ms.map((m, i) => `<div class="sg ${m.s}" role="listitem"><div class="top"><span class="no">${m.s === 'done' ? I('check') : m.s === 'on' ? '<span class="spin"></span>' : m.s === 'bad' ? I('x') : m.s === 'unk' ? '?' : i + 1}</span><span class="bar"></span></div><span class="lb">${m.l}</span><span class="dt">${esc(m.d)}</span></div>`).join('')}
    </div>`;
  }
  function wsStatus() {
    const w = st.ws;
    if (w === 'preparing') return `<span class="badge st-run"><span class="spin" style="width:11px;height:11px"></span>准备中</span>`;
    if (w === 'ready') return `<span class="badge st-ok">${I('check', 'sm')}已就绪</span>`;
    if (w === 'unknown') return `<span class="badge st-unknown">${I('help', 'sm')}待核对原创建</span>`;
    if (w === 'partial') return `<span class="badge st-fail">${I('alert', 'sm')}部分创建</span>`;
    if (w === 'conflict') return st.renamed ? `<span class="badge st-wait">${I('edit', 'sm')}新名称 · 待确认</span>` : `<span class="badge st-fail">${I('alert', 'sm')}同名冲突</span>`;
    if (w === 'drift') return st.reread ? `<span class="badge st-wait">${I('refresh', 'sm')}新基线 · 待确认</span>` : `<span class="badge st-fail">${I('alert', 'sm')}基线已前移</span>`;
    return `<span class="badge st-idle">${I('clock', 'sm')}未准备</span>`;
  }
  function wsAlert() {
    const w = st.ws;
    if (w === 'unknown') return `<div class="banner unknown ws-alert" role="status">${I('help')}<div class="grow"><b>不知道独立工作区是否已经创建</b><p>10:01:58 发出准备请求（原请求 <span class="mono">${T.prepKey}</span>），「固定基线」之后连接中断，没有收到回执。分支和目录可能已建、可能未建。原请求保持不变：不会再分配第二个目录或分支，也不会开始执行。</p><div class="ws-acts"><button class="btn secondary sm" data-a="check-origin" ${st.busy ? 'disabled' : ''}>${st.busy === 'check' ? '<span class="spin"></span>核对中' : I('search', 'sm') + '核对原创建'}</button></div></div></div>`;
    if (w === 'partial') return `<div class="banner warn ws-alert" role="alert">${I('alert')}<div class="grow"><b>部分创建：任务分支已建，工作目录没有建成</b><p>「创建工作目录」失败：<span class="mono">${T.wsRoot}</span> 没有写入权限。已创建的任务分支 <span class="mono">${T.branch}</span> 保留在原仓库中，不会自动删除；原工作区未被改动。修好权限后，可沿用原准备记录只补建工作目录。</p><div class="ws-acts"><button class="btn secondary sm" data-a="fix-partial" ${st.busy ? 'disabled' : ''}>${st.busy === 'fix' ? '<span class="spin"></span>补建中' : I('folder', 'sm') + '补建工作目录'}</button><button class="btn ghost sm" data-a="auth-help">${I('help', 'sm')}授权说明</button></div></div></div>`;
    if (w === 'conflict' && !st.renamed) {
      const c = T.conflict;
      return `<div class="banner warn ws-alert" role="alert">${I('alert')}<div class="grow"><b>同名的分支和目录已经存在，准备已停止</b><p>这两个对象不属于本任务的准备记录。opencode-workflow 不会覆盖，也不会直接拿来复用；需求草稿和已确认的计划都保留，没有创建任何分支或目录。</p>
        <div class="objs">
          <div class="obj"><span class="k">${I('branch', 'sm')}</span><span class="v">${esc(c.branch.name)}</span><span class="m">分支 · 指向 ${c.branch.at} · ${c.branch.when} · ${c.branch.owner}</span><span class="acts"><button class="btn ghost sm" data-a="view-branch">${I('external', 'sm')}在 Git 仓库查看</button>${copyBtn(c.branch.name, '分支名')}</span></div>
          <div class="obj"><span class="k">${I('folder', 'sm')}</span><span class="v">${esc(c.dir.path)}</span><span class="m">目录 · ${c.dir.note} · ${c.dir.owner}</span><span class="acts"><button class="btn ghost sm" disabled title="宿主未提供“在文件管理器显示”能力">${I('folder', 'sm')}在文件管理器显示（宿主未提供）</button>${copyBtn(c.dir.path, '目录路径')}</span></div>
        </div><div class="ws-acts"><button class="btn secondary sm" data-a="rename" ${st.busy ? 'disabled' : ''}>${st.busy === 'rename' ? '<span class="spin"></span>生成中' : I('edit', 'sm') + '使用新名称重新预览'}</button></div></div></div>`;
    }
    if (w === 'conflict' && st.renamed) return `<div class="banner info ws-alert">${I('info')}<div class="grow"><b>已生成新名称，请重新确认</b><p>新分支 <span class="mono">${esc(branchName())}</span> 与新目录 <span class="mono">…/${esc(wsPath().split('/').pop())}</span> 当前都不存在。原有同名分支和目录保持不动。</p></div></div>`;
    if (w === 'drift' && !st.reread) return `<div class="banner warn ws-alert" role="alert">${I('alert')}<div class="grow"><b>基线已前移，准备已停止</b><p>确认计划后 main 又有 2 个新提交。旧基线不再是当前 main，不能静默换成新基线继续；没有创建任何分支或目录。重新读取后，请按新基线重新确认。</p>
        <div class="cmp"><div class="side-b old"><span class="h">确认计划时 · ${T.oldBase.readAt}</span><span class="s">main @ ${T.oldBase.sha}</span></div><span class="ar">${I('arrowRight')}</span><div class="side-b new"><span class="h">现在 · 10-15 10:01 读取</span><span class="s">main @ ${T.base.sha}</span></div></div>
        <div class="commits">${T.newCommits.map((c) => `<div><span class="mono">${c[0]}</span><span class="grow ellipsis">${esc(c[1])}</span><span>${esc(c[2])}</span></div>`).join('')}</div>
      <div class="ws-acts"><button class="btn secondary sm" data-a="reread" ${st.busy ? 'disabled' : ''}>${st.busy === 'reread' ? '<span class="spin"></span>读取中' : I('refresh', 'sm') + '重新读取基线'}</button></div></div></div>`;
    if (w === 'drift' && st.reread) return `<div class="banner info ws-alert">${I('info')}<div class="grow"><b>已读取新基线 main @ ${T.base.sha}，请重新确认</b><p>旧基线 ${T.oldBase.sha} 不再使用。工作区将从新基线创建；计划内容不变。</p></div></div>`;
    return '';
  }
  function wsBody() {
    const p = PJ(st.project);
    const ready = st.ws === 'ready';
    if (kind === 'git') {
      const baseLine = st.ws === 'drift' && !st.reread
        ? `<span class="line"><span class="code old">main @ ${T.oldBase.sha}</span><span class="tagx">${I('alert', 'sm')}已过期</span></span>`
        : `<span class="line"><span class="code${st.ws === 'drift' ? ' new' : ''}">main @ ${T.base.sha}</span>${st.ws === 'drift' ? `<span class="tagx new">新基线</span>` : ''}<span class="sub2">读取于 ${st.ws === 'drift' ? '10-15 10:01' : T.base.readAt} · 完整 SHA 见诊断详情</span></span>`;
      const brState = st.ws === 'conflict' && !st.renamed ? `<span class="tagx" style="color:var(--warn);background:var(--warn-fill)">${I('alert', 'sm')}同名已存在</span>` : st.renamed ? `<span class="tagx new">新名称</span>` : ready || st.ws === 'partial' ? `<span class="tagx" style="color:var(--ok);background:var(--ok-fill)">${I('check', 'sm')}已创建</span>` : `<span class="tagx">系统生成</span>`;
      return `<dl class="ws-kv">
        <dt>任务</dt><dd><span class="line">${esc(T.name)}<span class="mono" style="color:var(--sub)">${T.id}</span></span></dd>
        <dt>原项目</dt><dd><span class="line">${esc(p.name)}<span class="sub2">${esc(p.remote)}</span></span>${pathRow(p.path, '原项目路径')}</dd>
        <dt>基线</dt><dd>${baseLine}</dd>
        <dt>任务分支</dt><dd><span class="line"><span class="code">${esc(branchName())}</span>${brState}</span><span class="sub2">由服务按任务 ID 生成；同名时不会覆盖或复用</span></dd>
        <dt>工作目录</dt><dd><span class="line">${esc(wsName())}${st.ws === 'partial' ? `<span class="tagx" style="color:var(--warn);background:var(--warn-fill)">${I('x', 'sm')}未建成</span>` : ready ? `<span class="tagx" style="color:var(--ok);background:var(--ok-fill)">${I('check', 'sm')}已创建</span>` : ''}</span>${pathRow(wsPath(), '工作目录路径')}</dd>
        <dt>读写授权</dt><dd><span>写入：只在任务工作目录（含并行子工作区）</span><span>读取：任务工作目录与基线 ${T.base.sha}</span><span class="sub2">原工作区：不读写 · ${p.head} 上 ${p.dirty} 个未提交改动、暂存区和当前分支保持不变</span></dd>
        <dt>并行写</dt><dd><span class="policy">${I('lock', 'sm')}<span>${esc(T.policy)}</span></span><span class="sub2">由服务决定，只展示，不能在这里修改</span></dd>
      </dl>`;
    }
    const sk = T.skipped[0];
    return `<dl class="ws-kv">
      <dt>任务</dt><dd><span class="line">${esc(T.name)}<span class="mono" style="color:var(--sub)">${T.id}</span></span></dd>
      <dt>原项目</dt><dd><span class="line">${esc(p.name)}<span class="sub2">直接目录 · 不受 Git 管理，不会执行 git init</span></span>${pathRow(p.path, '原项目路径')}</dd>
      <dt>基线快照</dt><dd>${ready ? `<span class="line"><span class="code">${T.snap.ref}</span><span class="sub2">固定于 ${T.snap.at}</span></span>` : `<span class="line">准备时固定<span class="sub2">范围预检读取于 ${T.snap.pre}</span></span>`}</dd>
      <dt>范围</dt><dd>${esc(T.scope)}</dd>
      <dt>排除</dt><dd><span class="excl">${T.excludes.map((x) => `<span class="code">${esc(x)}</span>`).join('')}</span></dd>
      <dt>未复制</dt><dd><div class="skip"><span class="row">${I('alert', 'sm')}<span class="mono" style="color:var(--ink);overflow-wrap:anywhere">${esc(sk.path)}</span><span class="tagx">${sk.size}</span><span class="sub2">${esc(sk.why)}</span></span><p>这个文件不会出现在独立副本里，需要它的节点会读不到。独立副本不等于整个项目都已隔离。</p></div></dd>
      <dt>独立副本</dt><dd><span class="line">${esc(T.wsName)}${ready ? `<span class="tagx" style="color:var(--ok);background:var(--ok-fill)">${I('check', 'sm')}已创建</span>` : ''}</span>${pathRow(T.wsPath, '独立副本路径')}</dd>
      <dt>读写授权</dt><dd><span>写入：只在独立副本</span><span>读取：独立副本与基线快照</span><span class="sub2">原目录：不写入 · 交付时逐项检查当前原目录，确认后才应用</span></dd>
      <dt>并行写</dt><dd><span class="policy">${I('lock', 'sm')}<span>${esc(T.policy)}</span></span><span class="sub2">由服务决定，只展示，不能在这里修改</span></dd>
    </dl>`;
  }
  function diagHTML() {
    const prepared = !['plan'].includes(st.ws) && !(st.ws === 'drift') && !(st.ws === 'conflict' && st.renamed);
    const rows = kind === 'git' ? [
      ['任务引用', 'task/' + T.id], ['计划版本', `plan/${T.id}@r${T.planRev}`], ['项目引用', 'project/order-service@r18'],
      ['基线 SHA', st.ws === 'drift' && !st.reread ? T.oldBase.full + '（已过期）' : T.base.full],
      ['准备请求', st.ws === 'conflict' || st.ws === 'drift' || prepared ? T.prepKey : null],
      ['工作区引用', st.ws === 'ready' || st.ws === 'partial' ? 'ws/' + T.id : null],
    ] : [
      ['任务引用', 'task/' + T.id], ['计划版本', `plan/${T.id}@r${T.planRev}`], ['项目引用', 'project/ops-report-scripts@r7'],
      ['基线快照', st.ws === 'ready' ? T.snap.ref : null], ['准备请求', prepared ? T.prepKey : null], ['工作区引用', st.ws === 'ready' ? 'ws/' + T.id : null],
    ];
    return `<details class="adv diag" ${Q.get('diag') === '1' ? 'open' : ''}><summary><span class="chev">${I('chevRight', 'sm')}</span><span class="grow">诊断详情<span class="hint">公开安全引用，可复制</span></span></summary>
      <div class="diag-body">${rows.map(([k, v]) => `<div class="ref"><span class="k">${k}</span>${v ? `<span class="v">${esc(v)}</span>${copyBtn(v, k)}` : '<span class="v na">准备时生成</span><span></span>'}</div>`).join('')}
      <p class="hint" style="margin-top:8px">不包含凭据引用、目录句柄、设备身份、租约或其他内部事实。</p></div></details>`;
  }
  function wsCard() {
    return `<section class="card ws" id="wsCard" aria-labelledby="wsT">
      <div class="card-head"><span class="tile">${I(kind === 'git' ? 'branch' : 'layers')}</span><div class="grow"><div class="tt" id="wsT">工作区</div><div class="hint">${kind === 'git' ? 'Git · 独立分支与 worktree' : '非 Git · 基线快照与独立副本'}</div></div>${wsStatus()}</div>
      ${wsAlert()}
      ${st.ws === 'plan' ? '' : stagesHTML()}
      <div class="ws-body">${wsBody()}</div>
      ${st.ws === 'plan' ? stagesHTML() : ''}
      <div style="padding-top:14px">${diagHTML()}</div>
    </section>`;
  }
  /* 右侧摘要里的按钮区（两步：准备独立工作区 → 开始执行；备选文案为「准备并开始」） */
  function actions() {
    const w = st.ws;
    const guard = `<div class="guard">${I('shield', 'sm')}<span>准备成功前不会运行任何写文件的节点。原项目${kind === 'git' ? '工作区' : '目录'}不会被改动。</span></div>`;
    const startOff = (why) => `<button class="btn secondary" disabled aria-describedby="whyStart">${I('play', 'sm')}开始执行</button><p class="why" id="whyStart">${why}</p>`;
    if (combined && (w === 'plan' || w === 'preparing')) {
      return `<span class="alt-tag">${I('alert', 'sm')}备选文案 · 待 API 评审二选一</span>
        ${w === 'plan' ? `<button class="btn primary lg" data-a="prepare">${I('play', 'sm')}准备并开始</button>` : `<button class="btn primary lg" disabled><span class="spin"></span>正在准备 · 成功后开始执行</button>`}
        <div class="alt-note">${I('info', 'sm')}<span>同一个按钮先准备独立工作区，准备成功后才开始执行；准备成功前没有任何写文件的节点运行。准备失败或结果未知时停在本页，不会开始执行。此文案与「准备独立工作区 → 开始执行」两步方案只能择一，不混用。</span></div>`;
    }
    if (w === 'plan') return `<button class="btn primary lg" data-a="prepare">${I('folder', 'sm')}准备独立工作区</button>${startOff('准备成功后才能开始执行')}${guard}`;
    if (w === 'preparing') return `<button class="btn primary lg" disabled><span class="spin"></span>正在准备独立工作区</button>${startOff('准备成功后才能开始执行')}<p class="why l">可以离开本页，准备会继续；回来时读取原准备记录，不会重新创建。</p>`;
    if (w === 'ready') return `<div class="ready-row">${I('check')}<span class="grow">独立工作区已就绪</span><span class="mono" style="font-size:12px;color:var(--sub)">${kind === 'git' ? T.base.sha : T.snap.ref}</span></div>
      <button class="btn primary lg" data-a="start">${I('play', 'sm')}开始执行</button><p class="why">开始后进入任务画布，第一批启动「${esc(T.nodes[0].t)}」（只读）</p>`;
    if (w === 'unknown') return `<button class="btn secondary lg" data-a="check-origin" ${st.busy ? 'disabled' : ''}>${st.busy === 'check' ? '<span class="spin"></span>核对中' : I('search', 'sm') + '核对原创建'}</button>${startOff('原创建核对前不能开始执行，也不会再准备新的工作区')}`;
    if (w === 'partial') return `${startOff('工作目录补建并核对成功前不能开始执行')}<p class="why l">已发生的步骤见左侧「准备阶段」；恢复入口在工作区卡内。不会自动清理已创建的分支。</p>`;
    if (w === 'conflict') return st.renamed
      ? `<button class="btn primary lg" data-a="prepare">${I('folder', 'sm')}按新名称准备独立工作区</button>${startOff('准备成功后才能开始执行')}${guard}`
      : `<button class="btn primary lg" disabled aria-describedby="whyP">${I('folder', 'sm')}准备独立工作区</button><p class="why" id="whyP">同名分支和目录已存在，先用新名称重新预览</p>${startOff('准备成功后才能开始执行')}`;
    if (w === 'drift') return st.reread
      ? `<button class="btn primary lg" data-a="prepare">${I('folder', 'sm')}按新基线准备独立工作区</button>${startOff('准备成功后才能开始执行')}${guard}`
      : `<button class="btn primary lg" disabled aria-describedby="whyP">${I('folder', 'sm')}准备独立工作区</button><p class="why" id="whyP">基线已前移，先重新读取并确认新基线</p>${startOff('准备成功后才能开始执行')}`;
    return '';
  }
  function railHTML() {
    const w = st.ws;
    const prepCls = w === 'ready' ? 'done' : w === 'unknown' ? 'unk' : ['partial'].includes(w) || (w === 'conflict' && !st.renamed) || (w === 'drift' && !st.reread) ? 'bad' : 'here';
    const prepIcon = prepCls === 'done' ? I('check') : prepCls === 'unk' ? '?' : prepCls === 'bad' ? '!' : '3';
    const prepSub = { ready: kind === 'git' ? '分支与工作目录已建好' : '快照已固定，独立副本已建好', unknown: '回执未知 · 核对原创建', partial: '部分创建 · 等待定向补建', preparing: '进行中 · 按阶段推进' }[w]
      || (w === 'conflict' && !st.renamed ? '同名冲突 · 未创建任何对象' : w === 'drift' && !st.reread ? '基线已前移 · 需重新确认' : kind === 'git' ? '创建任务分支与 worktree，原项目不变' : '固定基线快照并复制独立副本');
    const rows = [
      ['done', I('check'), '形成需求草稿', '已形成'],
      ['done', I('check'), '确认计划', `修订 ${T.planRev} · ${T.planAt}`],
    ];
    if (combined && (w === 'plan' || w === 'preparing')) rows.push([w === 'preparing' ? 'here' : 'here', '3', '准备并开始执行', '准备成功后才派发写文件的节点']);
    else { rows.push([prepCls, prepIcon, '准备独立工作区', prepSub]); rows.push([w === 'ready' ? 'here' : '', '4', '开始执行', w === 'ready' ? '现在可以单独开始' : '准备成功后单独启动']); }
    return `<div class="next">${rows.map((r, i) => `<div class="nx"><div class="rail"><i class="${r[0]}">${r[1]}</i>${i < rows.length - 1 ? '<b></b>' : ''}</div><div class="tx"><strong>${r[2]}</strong>${esc(r[3])}</div></div>`).join('')}</div>`;
  }
  function planView() {
    const p = PJ(st.project), f = FL(st.flow);
    const wsTxt = { plan: '未准备', preparing: '准备中', ready: '已就绪', unknown: '待核对原创建', partial: '部分创建', conflict: st.renamed ? '新名称待确认' : '同名冲突', drift: st.reread ? '新基线待确认' : '基线已前移' }[st.ws];
    return `
    <div class="page-head"><div class="grow"><h2 class="title">开始一个任务</h2><p class="lede">需求草稿已形成，计划已确认。先为这个任务准备独立工作区，准备成功后再单独开始执行——原项目保持不变。</p></div></div>
    <div class="layout plan">
      <div>
        <section class="step ok">
          <span class="step-no">${I('check', 'sm')}</span>
          <div class="col" style="gap:10px">
            <div class="row"><span class="step-title">项目</span><span class="locked-note">${I('lock', 'sm')}计划已确认，换项目需新建任务</span></div>
            <div class="opts" role="radiogroup" aria-label="项目（已确认）"><div class="opt wide" role="radio" aria-checked="true" aria-disabled="true"><span class="r"></span><span class="grow"><div class="t">${esc(p.name)}</div><div class="d mono">${esc(p.path)}</div>${isoRow(p, 'ok')}</span></div></div>
          </div>
        </section>
        <section class="step ok">
          <span class="step-no">${I('check', 'sm')}</span>
          <div class="col" style="gap:10px">
            <span class="step-title">目标</span>
            <div class="fixed"><div class="goal-t">${esc(T.goal)}</div><div class="meta"><span>任务名称 <b style="color:var(--ink-2);font-weight:500">${esc(T.name)}</b></span><span>任务 ID <span class="mono">${T.id}</span></span></div></div>
          </div>
        </section>
        <section class="step ok">
          <span class="step-no">${I('check', 'sm')}</span>
          <div class="col" style="gap:10px">
            <div class="row"><span class="step-title">流程</span><span class="hint">${esc(f.name)} · 版本 r${f.rev}</span></div>
          </div>
        </section>
        <section class="step cur" id="planStep">
          <span class="step-no">4</span>
          <div class="col" style="gap:0">
            <div class="row wrap"><span class="step-title">计划确认</span>${combined ? `<span class="hint">审阅计划 → 确认原范围 → 准备并开始（准备成功后才执行）</span><span class="alt-tag">${I('alert', 'sm')}备选文案 · 待 API 评审二选一</span>` : '<span class="hint">审阅计划 → 确认原范围 → 准备独立工作区 → 单独开始执行</span>'}</div>
            <div class="card plan-card" style="margin-top:10px">
              <div class="plan-head"><span class="t">计划 · 修订 ${T.planRev}</span><span class="badge st-ok">${I('check', 'sm')}已确认 ${T.planAt}</span><span class="grow"></span><button class="btn ghost sm" data-a="open-plan">${I('external', 'sm')}在需求画布查看</button></div>
              <div class="pnodes">${planNodes()}</div>
            </div>
            ${wsCard()}
          </div>
        </section>
      </div>

      <aside class="summary">
        <div class="card">
          <div style="padding:16px 18px 6px"><div class="eyebrow">任务 ${T.id}</div>
            <div style="font-size:15px;font-weight:500;margin-top:6px;overflow-wrap:anywhere">${esc(T.name)}</div></div>
          <dl style="margin:0;padding:4px 18px 10px">
            <div class="sum-row"><dt>项目</dt><dd>${esc(p.name)}</dd></div>
            <div class="sum-row"><dt>隔离</dt><dd>${kind === 'git' ? 'Git · 独立分支与 worktree' : '非 Git · 基线快照与独立副本'}</dd></div>
            <div class="sum-row"><dt>计划</dt><dd>修订 ${T.planRev}<span class="badge st-ok" style="height:18px">已确认</span></dd></div>
            <div class="sum-row"><dt>工作区</dt><dd>${wsTxt}</dd></div>
          </dl>
          <div style="padding:6px 18px 4px;box-shadow:inset 0 1px 0 var(--line)">
            <div class="eyebrow" style="margin:10px 0 10px">步骤</div>
            ${railHTML()}
          </div>
          <div class="act">${actions()}</div>
        </div>
      </aside>
    </div>`;
  }

  /* ---------- 对话框 ---------- */
  function dialog(id, html, wide) {
    $('#dlgHost').innerHTML = `<div class="dialog${wide ? ' wide' : ''}" id="${id}" role="alertdialog" aria-modal="true" aria-labelledby="${id}T">${html}</div>`;
    DS.icons($('#dlgHost'));
  }
  function openPrepareDlg(trigger) {
    const p = PJ(st.project);
    const mk = kind === 'git'
      ? [`任务分支 <span class="mono">${esc(branchName())}</span>，基于 <span class="mono">main @ ${T.base.sha}</span>`, `工作目录 ${esc(wsName())}<br><span class="mono" style="font-size:12px;color:var(--muted);word-break:break-all">${esc(wsPath())}</span>`]
      : [`基线快照：全部文件，排除 ${T.excludes.map(esc).join('、')}`, `独立副本 ${esc(T.wsName)}<br><span class="mono" style="font-size:12px;color:var(--muted);word-break:break-all">${esc(T.wsPath)}</span>`, `未复制：<span class="mono">${esc(T.skipped[0].path)}</span>（${T.skipped[0].size}）`];
    const keep = kind === 'git'
      ? [`原工作区 <span class="mono">${esc(p.path)}</span> 的文件、暂存区和当前分支 ${p.head}`, `${p.dirty} 个未提交改动`]
      : [`原目录 <span class="mono">${esc(p.path)}</span> 的全部文件`, '不会执行 git init，也不会创建 Git 仓库'];
    const t = combined ? '准备独立工作区并开始执行？' : '准备独立工作区？';
    dialog('prepDlg', `<div class="dialog-body"><h2 id="prepDlgT">${t}</h2>
      <p>${combined ? '先准备工作区；准备成功后才开始执行，准备成功前不会运行任何写文件的节点。' : '这一步只准备工作区，不会运行任何节点；准备成功后再单独开始执行。'}</p>
      <div class="dlg-cap">将创建</div><div class="dlg-list">${mk.map((x) => `<div class="li mk">${I('plus', 'sm')}<span>${x}</span></div>`).join('')}</div>
      <div class="dlg-cap">保持不变</div><div class="dlg-list">${keep.map((x) => `<div class="li keep">${I('shield', 'sm')}<span>${x}</span></div>`).join('')}</div>
      ${combined ? '<p class="hint" style="margin-top:10px"><span class="alt-tag" style="height:20px">备选文案 · 待 API 评审二选一</span></p>' : ''}
      </div><div class="dialog-foot"><button class="btn ghost" data-a="dlg-close">再看看</button><button class="btn primary" data-a="prepare-go" autofocus>${combined ? '准备并开始' : '准备独立工作区'}</button></div>`, true);
    DS.openDialog('prepDlg', trigger);
  }
  function openStartDlg(trigger) {
    dialog('startDlg', `<div class="dialog-body"><h2 id="startDlgT">开始执行这个计划？</h2>
      <p>将启动第一批步骤：<b class="ink">${esc(T.nodes[0].t)}</b>（只读）。写文件的节点只在${kind === 'git' ? '任务工作区' : '独立副本'} <b class="ink">${esc(kind === 'git' ? wsName() : T.wsName)}</b> 中运行，原项目不受影响。执行结束后任务停在“等待交付”，由你选择交付方式。</p></div>
      <div class="dialog-foot"><button class="btn ghost" data-a="dlg-close">再看看</button><button class="btn primary" data-a="start-go" autofocus>${I('play', 'sm')}开始执行</button></div>`);
    DS.openDialog('startDlg', trigger);
  }
  function openAuthDlg(trigger) {
    const p = PJ(st.project);
    const partial = st.ws === 'partial';
    dialog('authDlg', `<div class="dialog-body"><h2 id="authDlgT">授权说明</h2>
      <p>${partial ? `准备工作区需要对 <span class="mono">${esc(T.wsRoot)}</span> 有写入权限。` : `opencode-workflow 需要读取 <span class="mono">${esc(p ? p.path : '')}</span> 才能识别项目类型并固定基线。`}opencode-workflow 不会自行修改目录权限，也不会改用其他位置。</p>
      <ol><li>${partial ? '确认该目录属于当前用户，或请目录所有者开放写入权限。' : '确认目录存在，并属于当前用户或已对当前用户开放读取。'}</li><li>macOS：在 系统设置 → 隐私与安全性 → 文件与文件夹 中允许 opencode-workflow 访问该位置。</li><li>回到本页${partial ? '「补建工作目录」' : '「重新读取」或换一个项目'}；已填写的内容会保留。</li></ol></div>
      <div class="dialog-foot"><button class="btn primary" data-a="dlg-close" autofocus>知道了</button></div>`);
    DS.openDialog('authDlg', trigger);
  }
  function openFixDlg(trigger) {
    dialog('fixDlg', `<div class="dialog-body"><h2 id="fixDlgT">只补建工作目录？</h2>
      <p>沿用原准备记录 <span class="mono">${T.prepKey}</span> 和已创建的任务分支 <span class="mono">${esc(T.branch)}</span>，只创建缺失的工作目录并重新核对。不会再建分支，也不会分配第二个目录。</p>
      <div class="dlg-list"><div class="li mk">${I('plus', 'sm')}<span>工作目录 ${esc(T.wsName)}<br><span class="mono" style="font-size:12px;color:var(--muted);word-break:break-all">${esc(T.wsPath)}</span></span></div></div></div>
      <div class="dialog-foot"><button class="btn ghost" data-a="dlg-close">再看看</button><button class="btn primary" data-a="fix-go" autofocus>补建工作目录</button></div>`, true);
    DS.openDialog('fixDlg', trigger);
  }

  /* ---------- 渲染与交互 ---------- */
  function render() {
    header();
    $('#view').innerHTML = st.phase === 'edit' ? editView() : planView();
  }
  function rerender() { const c = $('.content'); const y = c ? c.scrollTop : 0; render(); if (c) c.scrollTop = y; }
  function flashFocus(sel) { setTimeout(() => { const el = $(sel); if (el) el.focus(); }, 30); }

  function prepTick() {
    if (st.ws !== 'preparing') return;
    setTimeout(() => {
      st.stage++;
      if (st.stage >= 5) {
        st.ws = 'ready'; rerender();
        setTimeout(() => { if (combined) TD.go('td02-running'); else TD.go('td01-ready', kind === 'dir' ? { kind: 'dir' } : (st.renamed ? { alt: '2' } : {})); }, 700);
        return;
      }
      rerender(); prepTick();
    }, 1300);
  }

  document.addEventListener('click', (e) => {
    const cp = e.target.closest('[data-copy]');
    if (cp) { const v = cp.dataset.copy; try { navigator.clipboard && navigator.clipboard.writeText(v).catch(() => {}); } catch (err) { /* 原型：忽略 */ } DS.toast('已复制：' + (v.length > 46 ? v.slice(0, 44) + '…' : v), 'info'); return; }
    const b = e.target.closest('[data-a]'); if (!b || b.disabled) return;
    const a = b.dataset.a;
    if (a === 'close-drawer') return DS.closeDrawer();
    if (a === 'dlg-close') return DS.closeDialog();
    if (a === 'project') {
      st.project = b.dataset.id; st.check = 'checking'; DS.closeDrawer(); rerender();
      setTimeout(() => { st.check = 'ok'; rerender(); }, 900);
      return;
    }
    if (a === 'flow') { st.flow = b.dataset.id; DS.closeDrawer(); rerender(); return; }
    if (a === 'pick-project') {
      $('#pdList').innerHTML = FX.projects.map((p) => `<button class="list-row" data-a="project" data-id="${p.id}"><span class="tile" style="width:32px;height:32px">${I(p.denied ? 'lock' : p.kind === 'git' ? 'branch' : 'folder', 'sm')}</span><span class="grow"><div style="font-size:13.5px;overflow-wrap:anywhere">${esc(p.name)}</div><div class="hint mono" style="overflow-wrap:anywhere">${esc(p.path)}</div><div class="hint">${p.denied ? '权限不足' : p.empty ? 'Git · 空仓库' : p.kind === 'git' ? 'Git 项目' : '非 Git 目录'}</div></span>${st.project === p.id ? `<span style="color:var(--accent)">${I('check')}</span>` : ''}</button>`).join('');
      DS.openDrawer('projDrawer', b); return;
    }
    if (a === 'pick-flow') {
      $('#fdList').innerHTML = FX.flows.map((f) => `<button class="list-row" data-a="flow" data-id="${f.id}"><span class="tile" style="width:32px;height:32px">${I('flow', 'sm')}</span><span class="grow"><div style="font-size:13.5px">${esc(f.name)}</div><div class="hint">${f.steps.map(esc).join(' → ')}</div></span>${st.flow === f.id ? `<span style="color:var(--accent)">${I('check')}</span>` : ''}</button>`).join('');
      DS.openDrawer('flowDrawer', b); return;
    }
    if (a === 'draft') { const k = PJ(st.project).kind; st.busy = 'draft'; rerender(); setTimeout(() => TD.go(k === 'dir' ? 'td01-nongit-plan' : 'td01-git-plan'), 1000); return; }
    if (a === 'view-project') return DS.toast('项目页不在本原型内：在「项目」中可查看路径与登记信息', 'info');
    if (a === 'view-branch') return DS.toast('Git 仓库的分支浏览不在本原型的 TD 状态内（只读查看，不在这里删除或改名）', 'info');
    if (a === 'open-plan') return SC.go('main/pages/requirement.html?state=confirmed');
    if (a === 'auth-help') return openAuthDlg(b);
    if (a === 'reread-project') { st.busy = 'reread-project'; rerender(); setTimeout(() => { st.busy = ''; rerender(); DS.toast('已重新读取：仓库仍没有任何提交', 'warn'); }, 1000); return; }
    if (a === 'prepare') return openPrepareDlg(b);
    if (a === 'prepare-go') { DS.closeDialog(); const ex = { sim: '1' }; if (kind === 'dir') ex.kind = 'dir'; if (combined) ex.mode = 'combined'; if (st.renamed) ex.alt = '2'; TD.go('td01-preparing', ex); return; }
    if (a === 'start') return openStartDlg(b);
    if (a === 'start-go') { DS.closeDialog(); DS.toast('已开始执行，正在打开任务画布', 'ok'); setTimeout(() => TD.go('td02-running'), 700); return; }
    if (a === 'check-origin') { st.busy = 'check'; rerender(); setTimeout(() => { DS.toast('核对结果：原请求已创建分支与工作目录，没有重复创建', 'ok'); setTimeout(() => TD.go('td01-ready'), 600); }, 1300); return; }
    if (a === 'fix-partial') return openFixDlg(b);
    if (a === 'fix-go') { DS.closeDialog(); TD.go('td01-preparing', { sim: '1', at: '3' }); return; }
    if (a === 'rename') { st.busy = 'rename'; rerender(); setTimeout(() => { st.busy = ''; st.renamed = true; rerender(); flashFocus('[data-a="prepare"]'); }, 900); return; }
    if (a === 'reread') { st.busy = 'reread'; rerender(); setTimeout(() => { st.busy = ''; st.reread = true; rerender(); flashFocus('[data-a="prepare"]'); }, 1000); return; }
  });
  document.addEventListener('input', (e) => {
    if (e.target.id === 'goal') { st.goal = e.target.value; $('#cnt').textContent = [...st.goal].length + ' 字'; const w = whyEdit(); $('#go').disabled = !!w; $('#why').textContent = w; }
    if (e.target.id === 'name') { st.name = e.target.value; $('#sumName').textContent = st.name || '未命名任务'; }
    if (e.target.dataset.filter) { const v = e.target.value.toLowerCase(); $$(e.target.dataset.filter + ' .list-row').forEach((r) => { r.style.display = r.textContent.toLowerCase().includes(v) ? '' : 'none'; }); }
  });
  /* 弹窗 / 抽屉焦点限定在框内 */
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const box = $('.dialog.open') || $('.drawer.open'); if (!box) return;
    const f = $$('button:not([disabled]),a[href],input,select,textarea,[tabindex]:not([tabindex="-1"])', box).filter((x) => x.offsetParent !== null);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (!box.contains(document.activeElement)) { e.preventDefault(); first.focus(); return; }
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });

  DS.mount({ header: '', proto: false });
  const cta = $('.nav-cta'); if (cta) cta.setAttribute('aria-current', 'page');
  render();
  TD.mountProto();

  /* 进入状态时布置画面：计划阶段的异常 / 进行中状态滚到工作区卡 */
  const scrollTo = { 'td01-preparing': '#wsCard', 'td01-ready': '#wsCard', 'td01-name-conflict': '#wsCard', 'td01-baseline-drift': '#wsCard', 'td01-prepare-unknown': '#wsCard', 'td01-partial': '#wsCard', 'td01-git-plan': '#planStep', 'td01-nongit-plan': '#planStep', 'td01-combined': '#planStep' }[S];
  const narrowAct = innerWidth <= 1120 && ['td01-git-plan', 'td01-nongit-plan', 'td01-combined', 'td01-ready'].includes(S);
  if (scrollTo) requestAnimationFrame(() => { const el = $(narrowAct ? '.summary' : scrollTo), c = $('.content'); if (el && c) c.scrollTop = Math.max(0, el.getBoundingClientRect().top - c.getBoundingClientRect().top + c.scrollTop - 16); });
  if (st.ws === 'preparing' && sim) prepTick();
})();
