/* TD05 · 非 Git 应用与三方冲突（apply.html）
   设计样例 · 合成数据：不读写任何目录，不发请求，不写本机存储；所有「检查 / 冻结 / 应用 / 核对」只用定时器切换模拟状态。
   三个来源标签固定：基线 / 任务副本 / 当前原目录。差异与三方标注只为展示，不是 merge 算法。 */
(function () {
  'use strict';
  const S = TD.init('apply.html');
  const FX = window.AP_FX;
  const I = DS.icon, esc = TD.esc;
  const ITEMS = FX.items;
  const byId = (id) => ITEMS.find((x) => x.id === id);
  const CT = FX.conflictTypes;
  const ORIG = FX.paths.orig, COPY = FX.paths.copy;
  const abs = (p) => ORIG + '/' + p;
  const cabs = (p) => COPY + '/' + p;
  const VARIANT = S === 'td05-preview';
  const APPLY_ORDER = ['monthly', 'calendar', 'readme', 'logo', 'tpl', 'legacy', 'yaml', 'exports'];
  const REDUCED = () => document.documentElement.classList.contains('reduced');
  const T = (ms) => (REDUCED() ? Math.min(ms, 250) : ms);
  /* 返回任务：沿 TD.backHref('td02-awaiting')，并带 kind=dir 让任务页显示非 Git 任务 T-2043 */
  const BACK = (() => { const h = TD.backHref('td02-awaiting'); return /[?&]kind=/.test(h) ? h : h + '&kind=dir'; })();

  /* ---------- 模型 ---------- */
  const M = {
    phase: 'select', sel: 'monthly', view: 'uni', cmp: 'task', listless: false,
    checkedAt: null, frozenAt: null, frozenRef: null, applyAt: null, round: 1,
    errKind: 'perm', svc: null, busy: null, st: {}, settledAt: null,
  };
  ITEMS.forEach((it) => { M.st[it.id] = { sel: true, chk: null, res: null, note: '', out: null, outAt: '', drift: false }; });
  const st = (id) => M.st[id];

  const storyChk = (it) => (it.conflict ? { k: 'cf', type: it.conflict } : { k: 'ok', act: 'replace' });
  const variantChk = (it) => ({ k: 'ok', act: it.kind === 'A' ? (it.type === 'dir' ? 'adddir' : 'add') : it.kind === 'D' ? 'delete' : 'replace' });
  function checkAll() { ITEMS.forEach((it) => { st(it.id).chk = VARIANT ? variantChk(it) : storyChk(it); }); M.checkedAt = FX.checkedAt; }
  function presetResolved() {
    checkAll();
    Object.assign(st('monthly'), { chk: { k: 'ok', act: 'replace', merged: true, type: 'both' }, res: 'manual', note: '16:09 重新检查：任务副本已并入原目录 14:20 的取整与单位修改' });
    st('calendar').res = 'adopt'; st('legacy').res = 'keep'; st('exports').res = 'keep'; st('logo').res = 'adopt';
    st('yaml').sel = false;
    M.svc = { at: '16:12', ok: true };
    M.frozenAt = FX.frozenAt; M.frozenRef = FX.previewRef;
  }
  function outs(map) { Object.entries(map).forEach(([id, v]) => { st(id).out = v[0]; st(id).outAt = v[1] || ''; }); M.applyAt = '16:14'; }
  function driftReadme() { st('readme').drift = true; st('readme').chk = { k: 'cf', type: 'both' }; st('readme').note = '16:14 重新读取：原目录在 16:13 修改了 README.md（新增「负责人」一行），与冻结预览不一致'; }

  switch (S) {
    case 'td05-overview': M.phase = 'select'; M.sel = 'monthly'; break;
    case 'td05-checking': M.phase = 'checking'; M.sel = 'monthly'; break;
    case 'td05-preview': checkAll(); M.phase = 'resolve'; M.sel = '__plan'; break;
    case 'td05-conflicts': checkAll(); M.phase = 'resolve'; M.sel = '__cf'; break;
    case 'td05-conflict-text': checkAll(); M.phase = 'resolve'; M.sel = 'monthly'; M.view = 'three'; break;
    case 'td05-conflict-binary': checkAll(); M.phase = 'resolve'; M.sel = 'logo'; break;
    case 'td05-recheck': case 'td05-apply-confirm': presetResolved(); M.phase = 'frozen'; M.sel = '__plan'; break;
    case 'td05-drift': presetResolved(); M.phase = 'result'; M.sel = '__result';
      outs({ monthly: ['applied', '16:14:02'], calendar: ['applied', '16:14:03'], logo: ['applied', '16:14:04'], tpl: ['applied', '16:14:05'], readme: ['blocked', '16:14:05'] }); driftReadme(); break;
    case 'td05-partial': presetResolved(); M.phase = 'result'; M.sel = '__result';
      outs({ monthly: ['applied', '16:14:02'], calendar: ['applied', '16:14:03'], readme: ['blocked', '16:14:03'], logo: ['unknown', '16:14:04'], tpl: ['notrun', ''] }); driftReadme(); break;
    case 'td05-unknown': presetResolved(); M.phase = 'result'; M.sel = '__result';
      outs({ monthly: ['applied', '16:14:02'], calendar: ['applied', '16:14:03'], readme: ['unknown', '16:14:04'], logo: ['unknown', '16:14:04'], tpl: ['unknown', '16:14:04'] }); break;
    case 'td05-applied': presetResolved(); M.phase = 'result'; M.sel = '__result';
      outs({ monthly: ['applied', '16:14:02'], calendar: ['applied', '16:14:03'], readme: ['applied', '16:14:03'], logo: ['applied', '16:14:04'], tpl: ['applied', '16:14:05'] }); M.settledAt = '16:15'; break;
    case 'td05-read-error': M.phase = 'error'; M.sel = '__err'; break;
  }

  /* ---------- 派生 ---------- */
  const origOf = (it) => { if (VARIANT) return it.base; if (st(it.id).drift && it.origDrift) return it.origDrift; return it.orig === 'base' ? it.base : it.orig; };
  const taskOf = (it) => (st(it.id).chk && st(it.id).chk.merged && it.taskMerged ? it.taskMerged : it.task);
  const binOrig = (it) => (VARIANT ? null : it.bin.orig);
  const adoptAct = (t) => ({ both: 'replace', addadd: 'replace', binary: 'replace', delmod: 'delete', moddel: 'create', type: 'replacetype' }[t]);
  function act(it) {
    const s = st(it.id);
    if (!s.sel) return 'excluded';
    const c = s.chk; if (!c || c.k === 'run' || c.k === 'wait') return null;
    if (c.k === 'ok') return c.act;
    if (c.k === 'ns') return 'unsupported';
    if (c.k === 'cf') { if (s.res === 'keep') return 'none'; if (s.res === 'adopt') return adoptAct(c.type); return 'pending'; }
    return null;
  }
  const WRITES = ['replace', 'add', 'adddir', 'delete', 'create', 'replacetype'];
  const isWrite = (a) => WRITES.includes(a);
  const ACT = {
    replace: '替换', add: '新增', adddir: '新增目录', delete: '删除', create: '重新创建', replacetype: '删除文件，新建目录',
    none: '不写入 · 保留当前原文件', excluded: '不交付 · 留在独立副本', pending: '待处理冲突', unsupported: '不支持',
  };
  function actPhrase(it, a) {
    const p = `<span class="path">${esc(abs(it.path))}${it.type === 'dir' ? '/' : ''}</span>`;
    switch (a) {
      case 'replace': return `将替换 ${p}`;
      case 'add': return `将新增 ${p}`;
      case 'adddir': return `将新增目录 ${p}（${esc(it.bin.task.size)}）`;
      case 'delete': return `将删除 ${p}`;
      case 'create': return `将重新创建 ${p}`;
      case 'replacetype': return `将删除文件 <span class="path">${esc(abs(it.path))}</span>，并新建目录 ${p}/`;
      case 'none': return `不写入；${p} 保持现状`;
      case 'excluded': return `不写入原目录；任务版本留在独立副本 <span class="path">${esc(cabs(it.path))}</span>`;
      case 'pending': return '先处理冲突，处理后在这里显示准确的写入动作';
      case 'unsupported': return '不支持写入，只能暂不交付';
      default: return M.phase === 'error' ? '原目录不可读，暂时无法确定' : '检查当前原目录后确定';
    }
  }
  const wasCf = (it) => !!(st(it.id).chk && (st(it.id).chk.k === 'cf' || st(it.id).chk.merged));
  const cfItems = () => ITEMS.filter(wasCf);
  const isResolved = (it) => { const s = st(it.id); return !s.sel || (s.chk && s.chk.k === 'cf' && (s.res === 'keep' || s.res === 'adopt')) || (s.chk && s.chk.k !== 'cf'); };
  const remaining = () => ITEMS.filter((it) => ['blocked', 'notrun'].includes(st(it.id).out));
  const inScope = () => (M.round > 1 || M.phase === 'result' ? remaining() : ITEMS);
  const unresolvedIn = (list) => list.filter((it) => st(it.id).sel && st(it.id).chk && st(it.id).chk.k === 'cf' && !isResolved(it));
  const selCount = () => ITEMS.filter((it) => st(it.id).sel).length;
  const reqExcluded = () => ITEMS.filter((it) => FX.required[it.path] && !st(it.id).sel);
  const editable = (it) => {
    const s = st(it.id);
    if (M.busy) return false;
    if (['resolve', 'frozen'].includes(M.phase) && M.round === 1) return !s.out;
    if (['result', 'frozen'].includes(M.phase) && ['blocked', 'notrun'].includes(s.out)) return true;
    return false;
  };

  /* ---------- 小件 ---------- */
  const KD = { A: ['新增', 'plus'], M: ['修改', 'edit'], D: ['删除', 'minus'] };
  const kd = (k) => `<span class="kd ${k}" title="变化类型：${KD[k][0]}">${I(KD[k][1], 'sm')}${KD[k][0]}</span>`;
  const pathHTML = (p, cls) => { const tr = p.endsWith('/') ? '/' : ''; const q = tr ? p.slice(0, -1) : p; const i = q.lastIndexOf('/'); return `<span class="${cls}">${i >= 0 ? `<span class="d">${esc(q.slice(0, i + 1))}</span>` : ''}${esc(q.slice(i + 1) + tr)}</span>`; };
  const copyBtn = (text, label) => `<button class="icon-btn" type="button" data-copy="${esc(text)}" aria-label="复制${esc(label || '路径')}" title="复制${esc(label || '路径')}">${I('copy', 'sm')}</button>`;
  const RES_LABEL = { keep: '保留当前原文件', adopt: '采用任务版本', manual: '我已手动解决', exclude: '暂不交付' };

  function resultLine(it, noReq) {
    const s = st(it.id);
    const O = {
      applied: `<span class="rs okd">${I('check', 'sm')}已应用 · ${esc(s.outAt)}</span>`,
      blocked: `<span class="rs bl">${I('alert', 'sm')}被阻塞 · 原目录又变化，未写入</span>`,
      unknown: `<span class="rs unk">${I('help', 'sm')}待核实 · 未收到回执</span>`,
      notrun: `<span class="rs">${I('clock', 'sm')}未执行</span>`,
      verifying: `<span class="rs run"><span class="spin" style="width:12px;height:12px"></span>核对原操作中</span>`,
      running: `<span class="rs run"><span class="spin" style="width:12px;height:12px"></span>写入中</span>`,
    };
    let h = '';
    if (s.out) h = O[s.out];
    else if (!s.sel) h = `<span class="rs">${I('minus', 'sm')}未选 · 留在独立副本</span>`;
    else if (!s.chk) h = M.phase === 'error' ? `<span class="rs">${I('clock', 'sm')}未检查 · 原目录不可读</span>` : `<span class="rs">${I('clock', 'sm')}未检查原目录</span>`;
    else if (s.chk.k === 'run') h = `<span class="rs run"><span class="spin" style="width:12px;height:12px"></span>检查中</span>`;
    else if (s.chk.k === 'wait') h = `<span class="rs">${I('clock', 'sm')}等待检查</span>`;
    else if (s.chk.k === 'ok') h = `<span class="rs ok">${I('check', 'sm')}可应用 · ${ACT[s.chk.act]}${s.chk.merged ? '（已手动解决）' : ''}</span>`;
    else if (s.chk.k === 'ns') h = `<span class="rs ns">${I('lock', 'sm')}不支持 · ${esc(CT.link.short)}</span>`;
    else if (s.chk.k === 'cf') h = isResolved(it) ? `<span class="rs rv">${I('check', 'sm')}已处理 · ${RES_LABEL[s.res]}</span>` : `<span class="rs cf">${I('alert', 'sm')}冲突 · ${esc(CT[s.chk.type].short)}</span>`;
    if (s.busyRow) h = `<span class="rs run"><span class="spin" style="width:12px;height:12px"></span>重新检查这一项</span>`;
    if (FX.required[it.path] && !noReq) h += `<span class="chipx req" title="计划确认的必需成果：${esc(FX.required[it.path])}">${I('target', 'sm')}必需成果</span>`;
    return h;
  }

  /* ---------- 页头 / 情况条 ---------- */
  function bar() {
    const delivered = !!M.settledAt;
    const badge = delivered ? `<span class="badge st-ok">${I('check', 'sm')}任务已交付</span>` : `<span class="badge st-wait">${I('clock', 'sm')}执行已结束 · 等待交付</span>`;
    DS.$('#bar').innerHTML = `
      <nav class="crumbs" aria-label="位置"><a href="${TD.href('td02-awaiting', { kind: 'dir' })}">任务列表</a><span class="sep">/</span><a href="${BACK}" title="${esc(FX.task.title)}">${esc(FX.task.title)}</a><span class="sep">/</span><span class="cur" aria-current="page">应用到原项目</span></nav>
      ${badge}<span class="badge outline">${I('copy', 'sm')}非 Git · 独立副本</span>
      <span class="grow"></span>
      <span class="td-mock">${I('info', 'sm')}设计样例 · 合成数据，不连接任务 / Git / 目录</span>
      <a class="btn ghost sm" href="${TD.href('td06-detail-nongit', { kind: 'dir', from: 'apply', fromState: S })}">${I('layers', 'sm')}工作区详情</a>
      <a class="btn secondary sm" href="${M.settledAt ? TD.href('td02-delivered', { kind: 'dir' }) : BACK}" data-k="back">${I('arrowLeft', 'sm')}返回任务</a>`;
  }
  function situ() {
    const exec = `<span class="where">${I('check', 'sm')}<span class="seg-t">执行与验收</span>全部步骤验收通过 · 单元测试 17 / 17 通过 · 样例月报比对一致</span><span class="sep"></span>`;
    let cls = 'wait', d;
    const nCf = unresolvedIn(ITEMS).length;
    const o = countOuts();
    if (M.settledAt) { cls = 'ok'; d = `<b>任务已交付</b> · ${o.applied} 项已应用到原项目（服务结算于 ${M.settledAt}）`; }
    else if (M.phase === 'error') { cls = 'fail'; d = '<b>无法读取当前原目录</b> · 候选文件与独立副本保留，没有写入任何文件'; }
    else if (M.phase === 'applying') { cls = 'wait'; d = '<b>正在逐项应用</b> · 不要关闭也没关系，结果按原操作逐项读取'; }
    else if (M.phase === 'result' || (M.round > 1)) {
      if (o.unknown) { cls = 'unk'; d = `<b>${o.unknown} 项结果待核实</b> · 已应用 ${o.applied} 项，只能逐项核对原操作`; }
      else { cls = 'fail'; d = `<b>部分应用</b> · 已应用 ${o.applied} 项，${o.blocked + o.notrun} 项未完成，任务尚未交付`; }
    } else if (M.phase === 'select' || M.phase === 'checking') d = '应用所选变更回原项目 · ' + (M.phase === 'checking' ? '正在检查当前原目录（只读）' : '尚未检查当前原目录');
    else if (M.phase === 'frozen') d = `应用所选变更回原项目 · 预览 ${M.frozenRef} 已冻结，等待你确认`;
    else d = `应用所选变更回原项目 · ${nCf ? `<b>${nCf} 项冲突待处理</b>` : '没有未处理的冲突'}`;
    DS.$('#situ').innerHTML = `<div class="situ ${cls}" role="status">${exec}<span class="where"><span class="seg-t">交付</span>${d}</span></div>`;
  }

  /* ---------- 交付视图头：来源图例 + 范围披露 + 步骤条 ---------- */
  function head() {
    const origMeta = M.phase === 'error' ? '读取失败 16:05' : M.phase === 'checking' ? '检查中…' : !M.checkedAt ? '尚未检查' : (ITEMS.some((it) => st(it.id).drift) ? '重新读取于 16:14' : `检查于 ${M.checkedAt}`);
    const b = FX.baseline;
    return `<div class="ap-head">
      <div class="ap-ttl"><h2>应用到原项目 ${VARIANT ? '<span class="badge outline">变体样例 · 原目录在所选路径上与基线一致</span>' : ''}</h2>
        <div class="hint">交付目标：将所选变更应用回原项目。逐项写入，不覆盖整个目录；检查与预览只读，不写文件。</div></div>
      <div class="ap-legend">
        <div class="srcs" role="list" aria-label="比较来源（标签固定）">
          <span class="src src-base" role="listitem"><span class="sw"></span>${I('layers', 'sm')}基线<span class="m">快照 ${esc(b.at)}</span></span>
          <span class="src src-task" role="listitem"><span class="sw"></span>${I('copy', 'sm')}任务副本<span class="m">${esc(FX.task.id)}</span></span>
          <span class="src src-orig" role="listitem"><span class="sw"></span>${I('folder', 'sm')}当前原目录<span class="m">${esc(origMeta)}</span></span>
        </div>
        <div class="ap-scope-wrap"><details class="ap-scope" id="scope"><summary data-k="scope"><span class="chev">${I('chevRight', 'sm')}</span>基线范围 · 排除 ${b.excludes.length} 类 · 未复制 ${b.notCopied.length} 个文件</summary>
          <div class="ap-scope-body">
            <dl class="ap-kv">
              <dt>基线快照</dt><dd><span class="mono">${esc(b.ref)}</span> · ${esc(b.at)} · 范围：${esc(b.scope)}</dd>
              <dt>排除</dt><dd><ul>${b.excludes.map(([p, r]) => `<li><span class="mono">${esc(p)}</span> <span class="hint">（${esc(r)}）</span></li>`).join('')}</ul></dd>
              <dt>未复制</dt><dd>${b.notCopied.map((n) => `<div class="cpy"><span class="path">${esc(n.path)}</span>${copyBtn(n.path)}</div> · ${esc(n.size)}<div class="hint">${esc(n.reason)}。任务没有读写它，应用也不会改动原目录中的它；独立副本不等于整个项目都已隔离。</div>`).join('')}</dd>
              <dt>任务副本</dt><dd><div class="cpy"><span class="path">${esc(COPY)}</span>${copyBtn(COPY)}</div></dd>
              <dt>当前原目录</dt><dd><div class="cpy"><span class="path">${esc(ORIG)}</span>${copyBtn(ORIG)}</div><div class="hint">项目「${esc(FX.task.project)}」· 直接目录，不受 Git 管理，不会自动初始化仓库</div></dd>
            </dl></div></details></div>
      </div>
    </div>${stepper()}`;
  }
  function stepper() {
    const L = ['选择变更', '检查原目录', '预览与处理冲突', '冻结预览', '确认应用', '结果'];
    const o = countOuts();
    const nCf = unresolvedIn(inScope()).length;
    let s;
    const D = (x) => ['done', x];
    switch (M.phase) {
      case 'select': s = [['cur', `已选 ${selCount()} / ${ITEMS.length}`], ['', ''], ['', ''], ['', ''], ['', ''], ['', '']]; break;
      case 'checking': s = [D(`已选 ${selCount()}`), ['run', `已检查 ${ITEMS.filter((it) => st(it.id).chk && st(it.id).chk.k !== 'run' && st(it.id).chk.k !== 'wait').length} / ${ITEMS.length}`], ['', ''], ['', ''], ['', ''], ['', '']]; break;
      case 'error': s = [D(`已选 ${selCount()}`), ['fail', '原目录不可读'], ['', ''], ['', ''], ['', ''], ['', '']]; break;
      case 'resolve': s = [D(`已选 ${selCount()}`), D(`检查于 ${M.checkedAt}`), ['cur', nCf ? `冲突 ${nCf} 未解决` : '无未解决冲突'], ['', ''], ['', ''], ['', '']]; break;
      case 'frozen':
        if (M.round > 1) { s = [D(''), D('16:14 重新读取'), D('已处理'), D(`${M.frozenRef} · ${M.frozenAt}`), ['cur', `待确认 ${frozenWrites().length} 项`], ['fail', `已应用 ${o.applied}`]]; break; }
        s = [D(`已选 ${selCount()}`), D(`检查于 ${M.checkedAt}`), D('冲突已处理'), D(`${M.frozenRef} · ${M.frozenAt}`), ['cur', '待确认'], ['', '']]; break;
      case 'applying': s = [D(''), D(''), D(''), D(`${M.frozenRef} · ${M.frozenAt}`), D(`${M.applyAt} 已确认`), ['run', '逐项写入中']]; break;
      case 'result':
        s = [D(''), D(''), D(''), D(`${M.frozenRef} · ${M.frozenAt}`), D(`${M.applyAt} 已确认`),
          M.settledAt ? D('任务已交付') : o.unknown ? ['unk', `${o.unknown} 项待核实`] : ['fail', `${o.blocked ? `${o.blocked} 项被阻塞` : `${o.notrun} 项未执行`}`]]; break;
    }
    return `<ol class="stp" aria-label="应用步骤">${L.map((l, i) => {
      const [c, sub] = s[i];
      const ic = c === 'done' ? I('check') : c === 'fail' ? I('alert') : c === 'unk' ? '?' : c === 'run' ? '<span class="spin" style="width:11px;height:11px"></span>' : i + 1;
      const word = { done: '已完成', cur: '当前', run: '进行中', fail: '需处理', unk: '待核实' }[c] || '未开始';
      return `${i ? `<span class="stp-bar ${s[i - 1][0] === 'done' ? 'done' : ''}" aria-hidden="true"></span>` : ''}<li class="stp-i ${c}" ${c === 'cur' ? 'aria-current="step"' : ''}><span class="stp-c" aria-hidden="true">${ic}</span><span class="stp-l">${l}<span class="sr">（${word}）</span>${sub ? `<span class="stp-s">${esc(sub)}</span>` : ''}</span></li>`;
    }).join('')}</ol>`;
  }
  function countOuts() { const c = { applied: 0, blocked: 0, unknown: 0, notrun: 0 }; ITEMS.forEach((it) => { const o = st(it.id).out; if (o === 'verifying') c.unknown++; else if (c[o] !== undefined) c[o]++; }); return c; }

  /* ---------- 左：变更清单 ---------- */
  function list() {
    const checked = ITEMS.every((it) => st(it.id).chk && !['run', 'wait'].includes(st(it.id).chk.k));
    const canToggle = ['select', 'resolve', 'frozen', 'error'].includes(M.phase) && M.round === 1 && !M.busy;
    const all = ITEMS.every((it) => st(it.id).sel);
    let h = `<div class="al-h"><label class="check"><input type="checkbox" data-a="selall" ${all ? 'checked' : ''} ${canToggle ? '' : 'disabled'} aria-label="全选变更">全部 ${ITEMS.length} 项</label><span class="grow"></span><span>已选 ${selCount()}</span></div>`;
    const sums = [];
    if (M.phase === 'resolve' && cfItems().length) sums.push(['__cf', 'alert', '冲突概览', `<span class="${unresolvedIn(ITEMS).length ? 'cf-n' : 'ok-n'}">${unresolvedIn(ITEMS).length ? `${unresolvedIn(ITEMS).length} 未解决` : '已全部处理'}</span>`]);
    if (M.phase === 'resolve' || (M.phase === 'frozen' && M.round === 1)) sums.push(['__plan', 'list', M.phase === 'frozen' ? '冻结预览 · 逐项写入动作' : '逐项预览', `<span class="hint">${M.phase === 'frozen' ? M.frozenRef : '未冻结'}</span>`]);
    if (['result', 'applying'].includes(M.phase) || M.round > 1) sums.push(['__result', 'list', '逐项应用结果', '']);
    if (M.phase === 'error') sums.push(['__err', 'alert', '原目录读取失败', '']);
    h += sums.map(([k, ic, l, r]) => `<button class="al-sum nav-k" type="button" data-sel="${k}" data-k="row-${k}" ${M.sel === k ? 'aria-current="true"' : ''}>${I(ic, 'sm')}<span class="grow">${l}</span>${r}</button>`).join('');
    const rows = (arr) => arr.map((it) => {
      const s = st(it.id);
      return `<div class="al-row ${M.sel === it.id ? 'cur' : ''} ${s.sel ? '' : 'off'}">
        <input type="checkbox" data-a="sel" data-id="${it.id}" data-k="chk-${it.id}" ${s.sel ? 'checked' : ''} ${canToggle && !s.out ? '' : 'disabled'} aria-label="${s.sel ? '取消选择' : '选择'} ${esc(it.path)}${s.sel ? '（取消后留在独立副本）' : ''}">
        <button class="al-btn nav-k" type="button" data-sel="${it.id}" data-k="row-${it.id}" ${M.sel === it.id ? 'aria-current="true"' : ''}>
          <span class="al-top">${kd(it.kind)}${pathHTML(it.path + (it.type === 'dir' ? '/' : ''), 'al-p')}<span class="al-st">${esc(it.stat)}</span></span>
          <span class="al-rs">${resultLine(it)}</span>
        </button></div>`;
    }).join('');
    const grouped = checked && ['resolve', 'frozen'].includes(M.phase) && M.round === 1;
    if (grouped) {
      const g = (k) => ITEMS.filter((it) => st(it.id).chk.k === k && !wasCf(it));
      const cf = ITEMS.filter(wasCf), ok = g('ok'), ns = g('ns');
      if (cf.length) h += `<div class="al-g" role="heading" aria-level="3">${I('alert', 'sm')}冲突 · ${cf.length}</div>${rows(cf)}`;
      if (ok.length) h += `<div class="al-g" role="heading" aria-level="3">${I('check', 'sm')}可应用 · ${ok.length}</div>${rows(ok)}`;
      if (ns.length) h += `<div class="al-g" role="heading" aria-level="3">${I('lock', 'sm')}不支持 · ${ns.length}</div>${rows(ns)}`;
    } else {
      const order = ['result', 'applying'].includes(M.phase) || M.round > 1 ? APPLY_ORDER.map(byId) : ITEMS;
      h += `<div class="al-g" role="heading" aria-level="3">${I('file', 'sm')}任务副本中的变更 · ${ITEMS.length}</div>${rows(order)}`;
    }
    h += `<div class="al-foot">${I('info', 'sm')}<span>未选的文件不会写入原目录，原样留在独立副本，之后仍可查看或再次交付。勾选的是整个文件，不做片段选择。</span></div>`;
    return h;
  }

  /* ---------- 差异（展示用 LCS） ---------- */
  function lcs(a, b) {
    const n = a.length, m = b.length, dp = Array.from({ length: n + 1 }, () => new Int16Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    const ops = []; let i = 0, j = 0;
    while (i < n && j < m) { if (a[i] === b[j]) { ops.push({ t: '=', a: i, b: j }); i++; j++; } else if (dp[i + 1][j] >= dp[i][j + 1]) { ops.push({ t: '-', a: i }); i++; } else { ops.push({ t: '+', b: j }); j++; } }
    while (i < n) ops.push({ t: '-', a: i++ }); while (j < m) ops.push({ t: '+', b: j++ });
    return ops;
  }
  const dl = (cls, o, n, mk, tx) => `<div class="dl ${cls}"><span class="ln o">${o}</span><span class="ln n">${n}</span><span class="mk" aria-hidden="true">${mk}</span><span class="cx">${esc(tx)}</span></div>`;
  function uniHTML(a, b) {
    a = a || []; b = b || [];
    return `<div class="dv-t"><div class="dh">@@ −1,${a.length} +1,${b.length} @@</div>${lcs(a, b).map((o) => o.t === '=' ? dl('', o.a + 1, o.b + 1, '', a[o.a]) : o.t === '-' ? dl('del', o.a + 1, '', '−', a[o.a]) : dl('add', '', o.b + 1, '+', b[o.b])).join('')}</div>`;
  }
  function splitHTML(a, b) {
    a = a || []; b = b || [];
    const ops = lcs(a, b), out = []; let k = 0;
    const cell = (side, ln, txt, cls) => cls === 's-emp' ? `<span class="ln s-emp"></span><span class="mk s-emp"></span><span class="cx ${side} s-emp"></span>` : `<span class="ln ${cls}">${ln}</span><span class="mk ${cls}" aria-hidden="true">${cls === 's-del' ? '−' : cls === 's-add' ? '+' : ''}</span><span class="cx ${side} ${cls}">${esc(txt)}</span>`;
    while (k < ops.length) {
      if (ops[k].t === '=') { const o = ops[k++]; out.push(`<div class="dl">${cell('l', o.a + 1, a[o.a], '')}${cell('r', o.b + 1, b[o.b], '')}</div>`); continue; }
      const dels = [], adds = [];
      while (k < ops.length && ops[k].t !== '=') { (ops[k].t === '-' ? dels : adds).push(ops[k]); k++; }
      for (let x = 0; x < Math.max(dels.length, adds.length); x++) {
        const d = dels[x], ad = adds[x];
        out.push(`<div class="dl">${d ? cell('l', d.a + 1, a[d.a], 's-del') : cell('l', '', '', 's-emp')}${ad ? cell('r', ad.b + 1, b[ad.b], 's-add') : cell('r', '', '', 's-emp')}</div>`);
      }
    }
    return `<div class="dv-t split"><div class="dh">@@ −1,${a.length} +1,${b.length} @@</div>${out.join('')}</div>`;
  }
  function blocks(base, x) {
    const ops = lcs(base, x), bl = []; let k = 0, ai = 0;
    while (k < ops.length) {
      if (ops[k].t === '=') { ai = ops[k].a + 1; k++; continue; }
      const b = { a0: ai, a1: ai, xs: [], as: [] };
      while (k < ops.length && ops[k].t !== '=') { if (ops[k].t === '-') { b.as.push(ops[k].a); b.a1 = ops[k].a + 1; ai = ops[k].a + 1; } else b.xs.push(ops[k].b); k++; }
      bl.push(b);
    }
    return bl;
  }
  const overlap = (p, q) => (p.a0 < q.a1 && q.a0 < p.a1) || (p.a0 === p.a1 && q.a0 <= p.a0 && p.a0 <= q.a1) || (q.a0 === q.a1 && p.a0 <= q.a0 && q.a0 <= p.a1);
  function threeHTML(it) {
    const base = it.base, task = taskOf(it), orig = origOf(it);
    const c = st(it.id).chk, isCf = c && c.k === 'cf';
    const bT = base && task ? blocks(base, task) : [], bO = base && orig ? blocks(base, orig) : [];
    const cfT = new Set(), cfO = new Set(), chT = new Set(), chO = new Set(), bCh = new Set(), bCf = new Set();
    bT.forEach((p) => { p.xs.forEach((x) => chT.add(x)); p.as.forEach((a) => bCh.add(a)); });
    bO.forEach((q) => { q.xs.forEach((x) => chO.add(x)); q.as.forEach((a) => bCh.add(a)); });
    let nCf = 0;
    if (isCf) bT.forEach((p) => bO.forEach((q) => { if (overlap(p, q)) { nCf++; p.xs.forEach((x) => cfT.add(x)); q.xs.forEach((x) => cfO.add(x)); p.as.concat(q.as).forEach((a) => bCf.add(a)); } }));
    const full = (arr, set, cf) => arr.map((t, i) => `<div class="tw-l ${set.has(i) ? 'chg' : ''} ${cf.has(i) ? 'cf' : ''}"><span class="ln">${i + 1}</span><span class="cx">${esc(t)}</span></div>`).join('');
    const allSet = (arr) => new Set(arr ? arr.map((_, i) => i) : []);
    const col = (cls, icon, name, meta, arr, set, cf, none) => `<section class="tw-col ${cls}" aria-label="${name}">
      <div class="tw-h">${I(icon, 'sm')}<span><span class="t">${name}</span><span class="m">${meta}</span></span></div>
      ${arr ? `<div class="tw-code" tabindex="0" aria-label="${name}内容">${full(arr, set, cf)}</div>` : `<div class="tw-none">${I('minus', 'sm')}<b>${none[0]}</b><span>${none[1]}</span></div>`}</section>`;
    const tAll = !base && task ? allSet(task) : chT, oAll = !base && orig ? allSet(orig) : chO;
    const tCf = isCf && (!base || !orig || !task) ? (task ? allSet(task) : new Set()) : cfT;
    const oCf = isCf && (!base || !orig || !task) ? (orig ? allSet(orig) : new Set()) : cfO;
    if (isCf && (!base || !orig || !task)) nCf = 1;
    const origMeta = M.checkedAt ? (st(it.id).drift ? '重新读取于 16:14 · 16:13 修改' : `检查于 ${M.checkedAt}${it.origNote && !VARIANT ? ' · ' + esc(it.origNote.replace('原目录 ', '').replace(/（.*$/, '')) : ''}`) : '尚未检查';
    return `<div class="tw">
      ${col('base', 'layers', '基线', `快照 ${FX.baseline.at}${base ? ` · ${base.length} 行` : ''}`, base, bCh, bCf, ['基线中不存在', `快照 ${FX.baseline.at} 时没有这个路径`])}
      ${col('task', 'copy', '任务副本', `${FX.task.id}${task ? ` · ${task.length} 行` : ''}${c && c.merged ? ' · 已手动合并' : ''}`, task, tAll, tCf, ['任务副本中已删除', '任务删除了这个文件'])}
      ${col('orig', 'folder', '当前原目录', origMeta, orig, oAll, oCf, ['当前原目录中不存在', it.origNote ? esc(it.origNote) : '原目录中没有这个路径'])}
    </div>
    <div class="tw-key" aria-hidden="false"><span><i style="background:color-mix(in srgb,var(--accent) 30%,transparent)"></i>任务副本相对基线的改动</span><span><i style="background:color-mix(in srgb,var(--wait) 30%,transparent)"></i>当前原目录相对基线的改动</span><span><i style="background:var(--stall)"></i>两边改到同一处（${nCf} 处冲突）</span><span>只做对照，不自动合并</span></div>`;
  }

  /* ---------- 右：详情 ---------- */
  function detail() {
    if (M.sel === '__cf') return cfOverview();
    if (M.sel === '__plan') return planView();
    if (M.sel === '__result') return resultView();
    if (M.sel === '__err') return errView();
    const it = byId(M.sel); if (!it) return '';
    const s = st(it.id), c = s.chk, a = act(it);
    const isCf = c && c.k === 'cf';
    const ct = isCf ? CT[c.type] : null;
    let h = `<div class="dt"><div class="dt-h">${kd(it.kind)}<div class="dt-p">${pathHTML(it.path + (it.type === 'dir' ? '/' : ''), '')}</div>${copyBtn(it.path, '相对路径')}
      <button class="icon-btn" type="button" data-a="listless" data-k="listless" aria-pressed="${M.listless}" aria-label="${M.listless ? '显示变更清单' : '收起变更清单，全宽阅读'}" title="${M.listless ? '显示变更清单' : '全宽阅读'}">${I('panel', 'sm')}</button></div>
      <div class="dt-meta"><span>${esc(it.stat)}</span>${it.origNote && M.checkedAt && !VARIANT ? `<span>· ${esc(st(it.id).drift ? '原目录 16:13 又修改' : it.origNote)}</span>` : ''}${FX.required[it.path] ? `<span class="chipx req">${I('target', 'sm')}必需成果：${esc(FX.required[it.path])}</span>` : ''}</div>`;
    if (s.note) h += `<div class="banner ${s.drift ? 'warn' : 'info'}" style="margin-top:12px">${I(s.drift ? 'alert' : 'refresh')}<div>${esc(s.note)}${s.drift && s.out === 'blocked' ? '。<br>这一项没有写入；其余已应用的项不会重做。按下方选择处理后，只为未完成的项重新冻结预览。' : ''}</div></div>`;
    h += `<dl class="dt-act ${isCf ? (isResolved(it) ? 'rv' : 'cf') : ''}">
      <dt>检查结果</dt><dd>${resultLine(it, true)}${isCf ? `<div class="cfd"><b>${esc(ct.title)}</b>：${esc(ct.desc)}</div>` : ''}</dd>
      <dt>原目录操作</dt><dd>${actPhrase(it, a)}</dd>
      <dt>任务副本</dt><dd><div class="cpy"><span class="path">${esc(cabs(it.path))}</span>${copyBtn(cabs(it.path))}</div></dd>
    </dl>`;
    if (it.type === 'text') h += textView(it);
    else h += idView(it);
    if (isCf || (s.out && ['blocked', 'notrun'].includes(s.out) && c && c.k === 'cf')) h += resolutionBox(it);
    else if (c && c.k === 'ok' && !s.out) h += `<p class="hint" style="margin-top:14px">${I('info', 'sm')} 这一项没有冲突。不想交付时，在左侧取消勾选：不写入原目录，任务版本留在独立副本。</p>`;
    if (FX.required[it.path] && !s.sel) h += reqNote(it);
    return h + '</div>';
  }
  function textView(it) {
    const checked = !!(st(it.id).chk && !['run', 'wait'].includes(st(it.id).chk.k));
    if (!checked && M.view === 'three') M.view = 'uni';
    const views = [['uni', '统一'], ['split', '并排'], ['three', '三方']];
    const seg = `<div class="seg" role="group" aria-label="差异视图">${views.map(([k, l]) => {
      const dis = k === 'three' && !checked;
      return `<button type="button" data-view="${k}" data-k="view-${k}" aria-pressed="${M.view === k}" ${dis ? 'aria-disabled="true" title="检查当前原目录后才能三方对照"' : ''}>${l}</button>`;
    }).join('')}</div>`;
    const cmps = [['task', '基线 → 任务副本'], ['orig', '基线 → 当前原目录'], ['apply', '当前原目录 → 任务副本']];
    let cmp = M.cmp; if (!checked) cmp = 'task';
    const cmpSeg = M.view === 'three' ? '' : `<span class="lbl">比较</span><div class="seg" role="group" aria-label="比较对象">${cmps.map(([k, l]) => {
      const dis = k !== 'task' && !checked;
      return `<button type="button" data-cmp="${k}" data-k="cmp-${k}" aria-pressed="${cmp === k}" ${dis ? 'aria-disabled="true" title="检查当前原目录后可用"' : ''}>${l}</button>`;
    }).join('')}</div>`;
    let body;
    if (M.view === 'three') body = threeHTML(it);
    else {
      const pair = { task: [it.base, taskOf(it)], orig: [it.base, origOf(it)], apply: [origOf(it), taskOf(it)] }[cmp];
      const lab = { task: ['基线', '任务副本'], orig: ['基线', '当前原目录'], apply: ['当前原目录', '任务副本'] }[cmp];
      const [a, b] = pair;
      let inner;
      if (!a && !b) inner = `<div class="dv-msg"><b>两边都没有这个文件</b></div>`;
      else inner = M.view === 'split' ? splitHTML(a, b) : uniHTML(a, b);
      const none = (x, n) => (!x ? ` · ${n}中不存在` : '');
      body = `<div class="dv-box"><div class="dv-cap">${I('arrowRight', 'sm')}<b style="font-weight:500;color:var(--ink-2)">${lab[0]}</b> → <b style="font-weight:500;color:var(--ink-2)">${lab[1]}</b>${none(a, lab[0])}${none(b, lab[1])}${cmp === 'apply' ? ' · 即应用后原文件的变化' : ''}</div><div class="dv-scroll" tabindex="0" aria-label="差异内容">${inner}</div></div>`;
    }
    return `<div class="dt-tools">${seg}${cmpSeg}</div>${body}`;
  }
  function idView(it) {
    const card = (cls, icon, name, meta, d, noneTxt) => `<section class="idc-c ${cls}" aria-label="${name}"><div class="tw-h">${I(icon, 'sm')}<span><span class="t">${name}</span><span class="m">${meta}</span></span></div>
      <div class="idc-b">${d ? `${it.type === 'binary' ? `<div class="thumb" aria-hidden="true">${I('file')}</div>` : ''}<dl><dt>类型</dt><dd>${esc(d.kind)}</dd><dt>大小</dt><dd>${esc(d.size)}</dd>${d.dim ? `<dt>尺寸</dt><dd>${esc(d.dim)}</dd>` : ''}<dt>修改于</dt><dd>${esc(d.mtime)}</dd></dl>${d.list ? `<ul>${d.list.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}${d.note ? `<div class="note">${esc(d.note)}</div>` : ''}` : `<div class="tw-none" style="min-height:90px">${I('minus', 'sm')}<b>${noneTxt}</b></div>`}</div></section>`;
    const o = binOrig(it);
    const checked = !!(st(it.id).chk && !['run', 'wait'].includes(st(it.id).chk.k));
    return `<div class="dt-tools"><span class="lbl">${it.type === 'binary' ? '二进制文件不按行比较，只显示身份与大小' : '路径类型不同，无法逐行比较，只显示两边各是什么'}</span></div>
      <div class="idc">${card('base', 'layers', '基线', `快照 ${FX.baseline.at}`, it.bin.base, '基线中不存在')}${card('task', 'copy', '任务副本', FX.task.id, it.bin.task, '任务副本中不存在')}${card('orig', 'folder', '当前原目录', checked ? `检查于 ${M.checkedAt}` : '尚未检查', checked ? o : null, checked ? '当前原目录中不存在' : '检查后显示')}</div>
      <details class="adv" style="margin-top:10px"><summary><span class="chev">${I('chevRight', 'sm')}</span>诊断详情（公开安全引用，可复制）</summary><div class="hint" style="padding:6px 0 0;line-height:1.7">内容指纹只用于诊断核对，不需要你比较。<br><span class="mono">task: sha256:7f3a…c21e</span> · <span class="mono">orig: sha256:1b9d…04aa</span></div></details>
      ${it.type === 'binary' ? `<details class="adv" style="margin-top:4px"><summary><span class="chev">${I('chevRight', 'sm')}</span>同类：符号链接显示为「不支持」</summary><div class="hint" style="padding:6px 0 0;line-height:1.7">若变更是符号链接，检查结果显示 <span class="rs ns">${I('lock', 'sm')}不支持 · ${esc(CT.link.short)}</span>，只能「暂不交付该项」；不会被当成普通文件写入。本样例故事中没有链接项。</div></details>` : ''}`;
  }
  function optsFor(it) {
    const t = st(it.id).chk.type, p = it.path;
    const K = {
      both: [`原目录中的 ${p} 保持现状（含 14:20 的修改）；任务的修改不交付，留在独立副本。`, `用任务版本替换原文件；原目录 14:20 的修改不会保留在该文件中。`],
      addadd: [`原目录中同名的新文件保持现状；任务新建的版本留在独立副本。`, `用任务版本替换原目录中同名的新文件（13:10 新建，财务口径）。`],
      delmod: [`原文件保留（含 14:40 的修改）；任务中的删除不交付。`, `删除原文件；原目录 14:40 的修改会随文件一起删除。`],
      moddel: [`原目录中保持已删除；任务修改的版本留在独立副本。`, `在原目录重新创建这个文件（任务版本）；原目录 15:02 删除它的结果不再保留。`],
      type: [`原目录中的文件 exports 保持现状；任务目录 exports/ 留在独立副本。`, `删除原目录中的文件 exports（1.2 KB），新建目录 exports/（3 个文件）。`],
      binary: [`原目录中的 ${p}（12.1 KB）保持现状。`, `用任务版本（18.4 KB）替换原目录中的 12.1 KB 版本。`],
    }[t];
    return [
      ['keep', '保留当前原文件', K[0], ''],
      ['adopt', '采用任务版本', K[1], '会覆盖原目录中的改动 · 选择时需再确认'],
      ['manual', '我已手动解决，重新检查', '你在原目录或任务副本中自行处理后，只重新读取这一项，以重新检查的结果为准。', ''],
      ['exclude', '暂不交付该项', '不写入原目录；任务版本留在独立副本，可以稍后再交付。', FX.required[p] ? '涉及必需成果 · 能否交付由服务判定' : ''],
    ];
  }
  function resolutionBox(it) {
    const s = st(it.id), can = editable(it);
    const cur = !s.sel ? 'exclude' : s.res;
    return `<fieldset class="rsv" ${can ? '' : 'disabled'}><legend>${I('wand', 'sm')}怎么处理这一项${!can ? '<span class="badge outline">只读 · 当前阶段不可修改</span>' : ''}</legend>
      <div class="hint">只影响这一项，其余文件不受影响。不提供整目录覆盖：每一项冲突都要单独决定。${M.phase === 'frozen' && can ? '修改选择会让已冻结的预览失效。' : ''}</div>
      <div class="rsv-grid" role="radiogroup" aria-label="处理方式">${optsFor(it).map(([k, t, d, w]) => `<label class="ro"><input type="radio" name="rsv-${it.id}" value="${k}" data-a="res" data-id="${it.id}" data-k="res-${it.id}-${k}" ${cur === k ? 'checked' : ''}><span class="r" aria-hidden="true"></span><span><span class="t">${t}</span><div class="d">${esc(d)}</div>${w ? `<span class="w">${I('alert', 'sm')}${w}</span>` : ''}</span></label>`).join('')}</div></fieldset>`;
  }
  function reqNote(it) {
    const dec = M.svc ? `<br><b>服务判定（${M.svc.at}）：</b>${M.svc.ok ? `允许在排除该项的情况下交付；交付回执会记为「${esc(it.path)} · 未交付（用户排除）」。` : '不满足交付条件。'}` : '<br>判定会在「重新检查并冻结预览」时由服务给出；判定前「确认应用」不可用。';
    return `<div class="banner unknown reqnote">${I('target')}<div><b>排除了必需成果相关项</b><br>「${esc(FX.required[it.path])}」是计划确认的必需成果。排除后任务能否交付由服务判定，界面不自行放行，也不自动缩小成果范围。${dec}</div></div>`;
  }
  function cfOverview() {
    const cf = cfItems();
    const n = unresolvedIn(ITEMS).length;
    return `<div class="dt"><div class="sec2"><h3>${I('alert', 'sm')}冲突清单 · ${cf.length} 项<span class="hint">${n ? `${n} 项未处理` : '已全部处理'} · 原目录检查于 ${M.checkedAt}</span></h3>
      <p class="hint" style="margin-bottom:12px">每项单独处理：保留当前原文件、采用任务版本（需再确认）、手动解决后重新检查，或暂不交付。没有一键覆盖整个项目。</p>
      <div class="cfl">${cf.map((it) => { const s = st(it.id), r = isResolved(it); return `<button type="button" class="cfc ${r ? 'done' : ''}" data-sel="${it.id}" data-k="cfc-${it.id}"><span class="tp">${I(r ? 'check' : 'alert', 'sm')}${r ? `已处理 · ${!s.sel ? '暂不交付' : RES_LABEL[s.res]}` : esc(CT[s.chk.type].title)}</span><span class="pp">${esc(it.path)}${it.type === 'dir' ? '/' : ''}</span><span class="ds">${esc(CT[s.chk.type].desc)}</span><span class="row" style="gap:6px">${kd(it.kind)}${FX.required[it.path] ? `<span class="chipx req">${I('target', 'sm')}必需成果</span>` : ''}<span class="hint">${esc(it.origNote || '')}</span></span></button>`; }).join('')}</div></div>
      <div class="sec2"><h3>${I('check', 'sm')}无冲突 · ${ITEMS.filter((it) => st(it.id).chk && st(it.id).chk.k === 'ok').length} 项</h3>
      ${planTable(ITEMS.filter((it) => st(it.id).chk && st(it.id).chk.k === 'ok'))}</div>
      ${reqExcluded().length ? reqExcluded().map(reqNote).join('') : ''}</div>`;
  }
  function planTable(arr) {
    return `<div class="tblw"><table class="rt"><colgroup><col class="c-kd"><col></colgroup><thead><tr><th>变化</th><th>原目录中的准确动作</th></tr></thead><tbody>${arr.map((it) => `<tr><td>${kd(it.kind)}</td><td>${actPhrase(it, act(it))}${st(it.id).note && st(it.id).res === 'manual' ? `<div class="sub2">${esc(st(it.id).note)}</div>` : ''}</td></tr>`).join('')}</tbody></table></div>`;
  }
  function frozenWrites() { return (M.round > 1 ? remaining() : ITEMS).filter((it) => isWrite(act(it))); }
  function planView() {
    const frozen = M.phase === 'frozen';
    const w = ITEMS.filter((it) => isWrite(act(it))), keep = ITEMS.filter((it) => act(it) === 'none'), ex = ITEMS.filter((it) => act(it) === 'excluded'), pend = ITEMS.filter((it) => act(it) === 'pending');
    const resCount = cfItems().filter(isResolved).length;
    return `<div class="dt">
      ${frozen ? `<div class="banner ok">${I('lock')}<div><b>预览 ${M.frozenRef} 已冻结于 ${M.frozenAt}</b><br>重新检查了当前原目录与任务副本：所选项与 16:05 的检查结果一致，冲突已全部处理。确认时服务会再核对一次；之后任何一项变化都会被阻塞，不会被覆盖。</div></div>`
      : `<div class="banner info">${I('eye')}<div><b>逐项预览 · 只读</b><br>${VARIANT ? '原目录在所选路径上与基线一致，没有冲突。' : ''}预览不写入任何文件。点「重新检查并冻结预览」会再读一次原目录并固定这份清单，之后才能确认应用。</div></div>`}
      <div class="sumgrid" role="list"><div role="listitem"><div class="v">${w.length}</div><div class="k">${I('upload', 'sm')}将写入原目录</div></div><div role="listitem"><div class="v">${keep.length}</div><div class="k">${I('folder', 'sm')}保留当前原文件</div></div><div role="listitem"><div class="v">${ex.length}</div><div class="k">${I('copy', 'sm')}留在独立副本</div></div><div role="listitem"><div class="v">${resCount} / ${cfItems().length}</div><div class="k">${I('check', 'sm')}冲突已处理</div></div></div>
      <div class="sec2"><h3>将写入原目录 · ${w.length} 项<span class="hint">A ${w.filter((x) => x.kind === 'A').length} · M ${w.filter((x) => x.kind === 'M').length} · D ${w.filter((x) => x.kind === 'D').length}</span></h3>${w.length ? planTable(w) : '<p class="hint">没有要写入的项。</p>'}</div>
      ${pend.length ? `<div class="sec2"><h3>${I('alert', 'sm')}待处理冲突 · ${pend.length} 项</h3>${planTable(pend)}</div>` : ''}
      ${keep.length ? `<div class="sec2"><h3>不写入 · 保留当前原文件 · ${keep.length} 项</h3>${planTable(keep)}</div>` : ''}
      ${ex.length ? `<div class="sec2"><h3>不交付 · 留在独立副本 · ${ex.length} 项</h3>${planTable(ex)}</div>` : ''}
      ${reqExcluded().map(reqNote).join('')}
      <p class="hint" style="margin-top:14px">${I('shield', 'sm')} 原目录中不在上面列表里的文件与目录（包括未复制的 data/raw-2025.parquet）不读写、不删除。</p></div>`;
  }
  function resultView() {
    const o = countOuts();
    const writes = APPLY_ORDER.map(byId).filter((it) => st(it.id).out);
    const rest = APPLY_ORDER.map(byId).filter((it) => !st(it.id).out);
    const R = {
      applied: (it) => [`<span class="rs okd">${I('check', 'sm')}已应用</span>`, `${esc(st(it.id).outAt)} · 原操作回执 op-ap-${it.id}`, ''],
      blocked: (it) => [`<span class="rs bl">${I('alert', 'sm')}被阻塞</span>`, '原目录在确认之后又变化（16:13），未写入；已重新读取', `<button class="btn secondary sm" type="button" data-sel="${it.id}" data-k="rr-${it.id}">${I('wand', 'sm')}查看并处理</button>`],
      unknown: (it) => [`<span class="rs unk">${I('help', 'sm')}待核实</span>`, `${esc(st(it.id).outAt)} 发出写入（原操作 op-ap-${it.id}）后连接中断，没有收到回执。保持原记录，不会重新写入。`, `<button class="btn secondary sm" type="button" data-a="verify" data-id="${it.id}" data-k="vf-${it.id}">${I('search', 'sm')}核对原操作</button>`],
      verifying: () => [`<span class="rs run"><span class="spin" style="width:12px;height:12px"></span>核对中</span>`, '按原操作读取原目录中的这一项…', ''],
      notrun: (it) => [`<span class="rs">${I('clock', 'sm')}未执行</span>`, st(it.id).note && !st(it.id).drift ? esc(st(it.id).note) : '应用在这一项之前中断，原目录中的它没有被改动', '<span class="hint">纳入下一次预览</span>'],
      running: () => [`<span class="rs run"><span class="spin" style="width:12px;height:12px"></span>写入中</span>`, '', ''],
    };
    const done = !!M.settledAt;
    let top;
    if (done) top = `<div class="dlv" role="status"><h3>${I('check')}任务已交付</h3><p>所选的 ${o.applied} 项全部可信写入原目录，服务于 ${M.settledAt} 读回交付结算。验证事实保持原样：单元测试 17 / 17 通过 · 样例月报比对一致。</p>
      <p>未交付内容保留：<span class="path">config/report.yaml</span> 按你的选择留在独立副本（服务已判定允许交付）；保留当前原文件的 2 项没有写入。独立副本不会自动清理。</p>
      <div class="row wrap" style="gap:8px"><a class="btn primary sm" href="${TD.href('td02-delivered', { kind: 'dir' })}" data-k="dlv-back">${I('arrowLeft', 'sm')}返回任务</a><a class="btn secondary sm" href="${TD.href('td06-detail-nongit', { kind: 'dir', from: 'apply', fromState: S })}">${I('layers', 'sm')}工作区详情</a></div></div>`;
    else if (M.phase === 'applying') top = `<div class="banner info">${I('upload')}<div><b>正在逐项写入原目录</b><br>每项写入前服务再核对一次原目录；结果按原操作逐项显示。</div></div>`;
    else if (o.unknown) top = `<div class="banner unknown">${I('help')}<div><b>${o.unknown} 项结果待核实</b><br>16:14:04 起连接中断，这几项可能已经写入，也可能没有。只能逐项「核对原操作」：读取原目录中的这一项并与原操作比对。不会再次发送写入，也没有整批重做。</div></div>`;
    else top = `<div class="banner warn">${I('alert')}<div><b>部分应用 · 任务尚未交付</b><br>已应用 ${o.applied} 项${o.blocked ? `，${o.blocked} 项因原目录又变化被阻塞` : ''}${o.notrun ? `，${o.notrun} 项未执行` : ''}。已应用的项保留，不会回滚，也不会重做；只为未完成的项重新检查并冻结预览。</div></div>`;
    const tx = `<p class="hint" style="margin-top:10px">${I('info', 'sm')} 这不是文件系统事务：逐项写入，任何一项失败或中断都不会撤销已写入的项，也不会自动回滚你之后在原目录中的编辑。全部所选项可信成功后，服务才结算交付。</p>`;
    return `<div class="dt">${top}
      <div class="sumgrid" role="list"><div role="listitem"><div class="v ok-n">${o.applied}</div><div class="k">${I('check', 'sm')}已应用</div></div><div role="listitem"><div class="v" style="color:var(--warn)">${o.blocked}</div><div class="k">${I('alert', 'sm')}被阻塞</div></div><div role="listitem"><div class="v" style="color:var(--unknown)">${o.unknown}</div><div class="k">${I('help', 'sm')}待核实</div></div><div role="listitem"><div class="v">${o.notrun}</div><div class="k">${I('clock', 'sm')}未执行</div></div></div>
      <div class="sec2"><h3>逐项结果 · 应用于 ${M.applyAt} 确认的预览 ${M.frozenRef}</h3>
      <div class="tblw"><table class="rt"><colgroup><col class="c-path"><col class="c-kd"><col class="c-res"><col></colgroup><thead><tr><th>路径</th><th>变化</th><th>结果</th><th>原操作 / 下一步</th></tr></thead><tbody>
      ${writes.map((it) => { const r = R[st(it.id).out](it); return `<tr class="${st(it.id).out === 'blocked' ? 'hl' : st(it.id).out === 'unknown' ? 'uk' : ''}"><td><div class="cpy"><span class="path">${esc(it.path)}</span>${copyBtn(abs(it.path), '原目录中的完整路径')}</div><div class="sub2">${ACT[act(it)] || ''}</div></td><td>${kd(it.kind)}</td><td>${r[0]}</td><td><div class="act"><span style="font-size:12.5px;line-height:1.55">${r[1]}</span>${r[2]}</div></td></tr>`; }).join('')}
      </tbody></table></div>${tx}</div>
      <div class="sec2"><h3>没有写入的项 · ${rest.length}</h3><div class="tblw"><table class="rt"><colgroup><col class="c-path"><col class="c-kd"><col></colgroup><thead><tr><th>路径</th><th>变化</th><th>原因</th></tr></thead><tbody>${rest.map((it) => `<tr><td><span class="path">${esc(it.path)}${it.type === 'dir' ? '/' : ''}</span></td><td>${kd(it.kind)}</td><td>${act(it) === 'none' ? '冲突处理：保留当前原文件，原目录中的它没有被改动' : '暂不交付：留在独立副本 ' + `<span class="path">${esc(cabs(it.path))}</span>`}${FX.required[it.path] ? `<div class="sub2">必需成果「${esc(FX.required[it.path])}」· 服务判定（${M.svc ? M.svc.at : '—'}）：允许交付</div>` : ''}</td></tr>`).join('')}</tbody></table></div></div></div>`;
  }
  function errView() {
    const E = {
      perm: ['权限不足', `opencode-workflow 没有读取 <span class="path">${esc(ORIG)}</span> 的权限（系统返回：拒绝访问）。`, '在系统设置中给 opencode-workflow 授予这个目录的读取权限后，再点「重新读取」。'],
      path: ['路径不可用', `<span class="path">${esc(ORIG)}</span> 当前不存在或所在磁盘未挂载。`, '确认目录仍在原位置（或重新挂载磁盘）后，再点「重新读取」。不会改用别的目录。'],
      timeout: ['读取超时', `读取 <span class="path">${esc(ORIG)}</span> 时 30 秒内没有完成（目录可能在网络盘上）。`, '稍后点「重新读取」。读取只读，不会写入任何文件。'],
    };
    const e = E[M.errKind];
    return `<div class="dt" style="padding:0"><div class="errcard" role="alert"><h3>${I('alert')}无法读取当前原目录 · ${e[0]}</h3>
      <p>${e[1]}</p><p>${e[2]}</p>
      <div class="seg" role="group" aria-label="示例原因（原型）">${Object.entries(E).map(([k, v]) => `<button type="button" data-err="${k}" data-k="err-${k}" aria-pressed="${M.errKind === k}">${v[0]}</button>`).join('')}</div></div>
      <div style="padding:0 20px 20px"><div class="banner ok">${I('shield')}<div><b>候选文件与独立副本都保留</b><br>没有写入原目录，也没有删除或移动任何文件。8 项候选变更与你的选择保持不变；左侧仍可查看「基线 → 任务副本」的差异。</div></div>
      <dl class="ap-kv" style="margin-top:14px"><dt>原目录</dt><dd><div class="cpy"><span class="path">${esc(ORIG)}</span>${copyBtn(ORIG)}</div></dd><dt>任务副本</dt><dd><div class="cpy"><span class="path">${esc(COPY)}</span>${copyBtn(COPY)}</div><div class="hint">可读 · 8 项变更</div></dd><dt>最近尝试</dt><dd>10-15 16:05 · 只读</dd></dl></div></div>`;
  }

  /* ---------- 底部操作栏 ---------- */
  function actionBar() {
    const n = selCount();
    const scope = inScope();
    const nCf = unresolvedIn(scope).length;
    const pv = '<span class="hint">检查与预览只读，不写入原目录</span>';
    let cnt, btns, why = '';
    const confirmBtn = (on, reason, label) => `<button class="btn ${on ? 'primary' : 'secondary'}" type="button" data-a="confirm" data-k="confirm" ${on ? '' : `aria-disabled="true" title="${esc(reason)}"`}>${I('check', 'sm')}${label || '确认应用'}</button>`;
    const freezeBtn = (on, reason, label, primary) => `<button class="btn ${primary && on ? 'primary' : 'secondary'}" type="button" data-a="freeze" data-k="freeze" ${on ? '' : `aria-disabled="true" title="${esc(reason)}"`}>${M.busy === 'freeze' ? '<span class="spin"></span>正在重新检查' : `${I('refresh', 'sm')}${label || '重新检查并冻结预览'}`}</button>`;
    const sel = `<span>已选 <b>${n}</b></span><span class="sepd"></span>`;
    switch (M.phase) {
      case 'select':
        cnt = `${sel}<span>尚未检查当前原目录</span>`;
        btns = `<button class="btn primary" type="button" data-a="check" data-k="check" ${n ? '' : 'aria-disabled="true" title="至少选择 1 项"'}>${I('search', 'sm')}检查原目录</button>${confirmBtn(false, '先检查原目录并冻结预览')}`;
        why = '检查只读取当前原目录，与基线、任务副本三方比较；不写入任何文件。';
        break;
      case 'checking':
        cnt = `${sel}<span class="rs run"><span class="spin" style="width:12px;height:12px"></span>正在读取当前原目录</span>`;
        btns = `<button class="btn secondary" type="button" aria-disabled="true" title="检查进行中">${I('refresh', 'sm')}重新检查并冻结预览</button>${confirmBtn(false, '检查完成并冻结预览后才能确认')}`;
        why = '检查中，不能重复发起；只读，不写入。';
        break;
      case 'error':
        cnt = `${sel}<span class="rs cf">${I('alert', 'sm')}原目录不可读</span><span class="sepd"></span><span>候选文件与独立副本保留</span>`;
        btns = `<button class="btn primary" type="button" data-a="reread" data-k="reread">${M.busy === 'reread' ? '<span class="spin"></span>读取中' : `${I('refresh', 'sm')}重新读取`}</button>${confirmBtn(false, '原目录不可读，无法预览')}`;
        break;
      case 'resolve': {
        const reqPending = reqExcluded().length && !M.svc;
        cnt = `${sel}<span>冲突 <b class="${nCf ? 'cf-n' : 'ok-n'}">${nCf}</b> 未解决</span>${reqExcluded().length ? `<span class="sepd"></span><span class="chipx req">${I('target', 'sm')}已排除必需成果 ${reqExcluded().length} 项 · 待服务判定</span>` : ''}`;
        const on = !nCf && n > 0 && !M.busy;
        btns = `${freezeBtn(on, nCf ? `还有 ${nCf} 项冲突未处理` : '至少选择 1 项', '', true)}${confirmBtn(false, '先重新检查并冻结预览')}`;
        why = nCf ? `还有 ${nCf} 项冲突未处理，处理后才能冻结预览。` : reqPending ? '冻结预览时，服务会一并判定排除必需成果后能否交付。' : '冻结前会再读一次原目录。';
        break;
      }
      case 'frozen': {
        const fw = frozenWrites();
        cnt = M.round > 1 ? `<span>本次待确认 <b>${fw.length}</b> 项</span><span class="sepd"></span><span>已应用 ${countOuts().applied} 项不会重做</span>` : `${sel}<span>冲突 <b class="ok-n">0</b> 未解决</span><span class="sepd"></span><span>预览 <b>${M.frozenRef}</b> 已冻结 · ${M.frozenAt}</span>`;
        btns = `${freezeBtn(!M.busy, '', '重新检查')}${confirmBtn(fw.length > 0 && !M.busy, '没有要写入的项', `确认应用 ${fw.length} 项…`)}`;
        why = '确认会打开对话框再核对一次；在那之前不会写入任何文件。';
        break;
      }
      case 'applying':
        cnt = `<span class="rs run"><span class="spin" style="width:12px;height:12px"></span>正在逐项写入原目录</span>`;
        btns = `${confirmBtn(false, '应用进行中，不能重复提交', '应用中')}`;
        break;
      case 'result': {
        const o = countOuts();
        if (M.settledAt) { cnt = `<span class="rs okd">${I('check', 'sm')}任务已交付</span><span class="sepd"></span><span>已应用 <b>${o.applied}</b> 项 · 留在独立副本 1 项 · 保留原文件 2 项</span>`; btns = `<a class="btn primary" href="${TD.href('td02-delivered', { kind: 'dir' })}" data-k="bar-back">${I('arrowLeft', 'sm')}返回任务</a>`; break; }
        cnt = `<span>已应用 <b>${o.applied}</b></span><span class="sepd"></span><span>被阻塞 <b>${o.blocked}</b></span><span class="sepd"></span><span>待核实 <b>${o.unknown}</b></span><span class="sepd"></span><span>未执行 <b>${o.notrun}</b></span><span class="sepd"></span><span>任务尚未交付</span>`;
        const rem = remaining();
        if (!rem.length && !o.unknown) { btns = `<button class="btn primary" type="button" data-a="settle" data-k="settle">${I('refresh', 'sm')}读取交付结算</button>`; why = '全部所选项都已有可信结果；结算由服务读回，界面不自行判定完成。'; break; }
        const nCf2 = unresolvedIn(rem).length;
        btns = rem.length ? `${freezeBtn(!nCf2 && !M.busy, `${nCf2} 项冲突未处理`, `为未完成的 ${rem.length} 项重新检查并冻结预览`, true)}${confirmBtn(false, '先为未完成的项冻结预览')}` : `${confirmBtn(false, '待核实的项需要先逐项核对原操作')}`;
        why = `${o.unknown ? `待核实的 ${o.unknown} 项不进入新的预览，先逐项核对原操作。` : ''}${nCf2 ? `未完成项中还有 ${nCf2} 项冲突未处理。` : ''}没有「整批重做」，已应用的项不会再写一次。`;
        break;
      }
    }
    return `<div class="ap-bar" role="region" aria-label="应用操作"><div class="cnt">${cnt}${why ? `<span class="why">${why}</span>` : ''}</div><div class="btns">${btns}</div></div>`;
  }

  /* ---------- 渲染 ---------- */
  function render() {
    const ae = document.activeElement, fk = ae && ae.dataset ? ae.dataset.k : null;
    const det = DS.$('#apDetail'), keepScroll = det && det.dataset.sel === M.sel ? det.scrollTop : 0;
    const lst = DS.$('#apList'), listScroll = lst ? lst.scrollTop : 0;
    const scopeOpen = DS.$('#scope') && DS.$('#scope').open;
    bar(); situ();
    DS.$('#ap').className = 'ap' + (M.listless ? ' listless' : '');
    DS.$('#ap').innerHTML = `${head()}<div class="ap-body"><div class="ap-list" id="apList" role="region" aria-label="变更清单">${list()}</div><div class="ap-detail" id="apDetail" data-sel="${M.sel}" role="region" aria-label="所选项详情" tabindex="-1">${detail()}</div></div>${actionBar()}`;
    if (scopeOpen) DS.$('#scope').open = true;
    DS.$('#apDetail').scrollTop = keepScroll; DS.$('#apList').scrollTop = listScroll;
    if (fk) { const el = document.querySelector(`[data-k="${CSS.escape(fk)}"]`); if (el) el.focus({ preventScroll: true }); }
  }

  /* ---------- 动作 ---------- */
  function select(id, focusDetail) { M.sel = id; render(); if (focusDetail) DS.$('#apDetail').focus({ preventScroll: true }); DS.$('#apDetail').scrollTop = 0; }
  function invalidate() { if (M.phase === 'frozen' && M.round === 1) { M.phase = 'resolve'; M.frozenAt = null; DS.toast('选择已改变，冻结的预览已失效，需要重新检查并冻结', 'info'); } }
  function runCheck(after) {
    M.phase = 'checking'; M.busy = 'check';
    ITEMS.forEach((it) => { st(it.id).chk = { k: 'wait' }; });
    let i = 0;
    const step = () => {
      if (i > 0) { const p = ITEMS[i - 1]; st(p.id).chk = storyChk(p); }
      if (i < ITEMS.length) { st(ITEMS[i].id).chk = { k: 'run' }; i++; render(); setTimeout(step, T(420)); }
      else { render(); setTimeout(after, T(300)); }
    };
    step();
  }
  function freeze() {
    const rem = M.phase === 'result' || M.round > 1;
    M.busy = 'freeze'; render();
    setTimeout(() => {
      M.busy = null;
      if (reqExcluded().length) M.svc = { at: '16:12', ok: true };
      M.frozenAt = rem ? '16:16' : FX.frozenAt; M.frozenRef = rem ? 'pv-4' : FX.previewRef;
      if (rem) M.round = 2;
      M.phase = 'frozen'; M.sel = rem ? '__result' : '__plan';
      render(); DS.toast(`预览 ${M.frozenRef} 已冻结：只读检查，没有写入任何文件`, 'info');
      const b = DS.$('[data-k="confirm"]'); if (b) b.focus();
    }, T(1100));
  }

  /* 对话框：焦点限定、Esc 关闭、关闭后还原焦点 */
  let dlgTrigger = null, dlgCancel = null;
  function openDlg(html, trigger, onCancel, cls) {
    closeDlg(true);
    dlgTrigger = trigger || document.activeElement; dlgCancel = onCancel || null;
    DS.$('#apDlgHost').innerHTML = `<div class="dialog ap-dlg ${cls || ''}" id="apDlg" role="alertdialog" aria-modal="true" aria-labelledby="apDlgT" aria-describedby="apDlgD">${html}</div>`;
    let s = DS.$('#apScrim'); if (!s) { s = document.createElement('div'); s.className = 'scrim'; s.id = 'apScrim'; document.body.appendChild(s); }
    s.classList.add('open');
    const d = DS.$('#apDlg'); requestAnimationFrame(() => { d.classList.add('open'); (d.querySelector('[autofocus]') || d.querySelector('button')).focus(); });
  }
  function closeDlg(silent) {
    const d = DS.$('#apDlg'); if (!d) return;
    d.remove(); const s = DS.$('#apScrim'); if (s) s.classList.remove('open');
    if (!silent) { const cb = dlgCancel; dlgCancel = null; if (cb) cb(); }
    if (dlgTrigger && document.contains(dlgTrigger)) dlgTrigger.focus(); else { const k = dlgTrigger && dlgTrigger.dataset && dlgTrigger.dataset.k; const el = k && document.querySelector(`[data-k="${k}"]`); if (el) el.focus(); }
  }
  document.addEventListener('keydown', (e) => {
    const d = DS.$('#apDlg');
    if (d && e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); closeDlg(); return; }
    if (d && e.key === 'Tab') {
      const f = [...d.querySelectorAll('button:not([disabled]),a[href],input:not([disabled]),[tabindex="0"]')];
      if (!f.length) return;
      const i = f.indexOf(document.activeElement);
      if (e.shiftKey && (i <= 0)) { e.preventDefault(); f[f.length - 1].focus(); } else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
    }
    if (!d && e.key === 'Escape' && DS.$('#scope') && DS.$('#scope').open) { DS.$('#scope').open = false; const sm = DS.$('#scope summary'); if (sm) sm.focus(); }
  }, true);

  function adoptDialog(it, trigger) {
    const t = st(it.id).chk.type;
    const what = {
      both: ['替换已被修改的原文件？', `原目录中的 <span class="path">${esc(abs(it.path))}</span> 在 14:20 被修改（金额取整、单位）。采用任务版本后，这些修改不会保留在该文件中。`],
      addadd: ['替换原目录中同名的新文件？', `原目录在 13:10 新建了同名文件 <span class="path">${esc(abs(it.path))}</span>（财务口径，8 行）。采用任务版本后，它的内容会被任务版本替换。`],
      delmod: ['删除已被修改的原文件？', `原目录中的 <span class="path">${esc(abs(it.path))}</span> 在 14:40 被修改。采用任务版本会删除这个文件，连同那次修改。`],
      moddel: ['在原目录重新创建已删除的文件？', `原目录在 15:02 删除了 <span class="path">${esc(abs(it.path))}</span>。采用任务版本会重新创建它。`],
      type: ['用目录替换原目录中的文件？', `原目录中的 <span class="path">${esc(abs(it.path))}</span> 是一个文件（1.2 KB，15:20 新建）。采用任务版本会删除它并新建目录 exports/（3 个文件）。`],
      binary: ['替换原目录中不同版本的二进制文件？', `原目录中的 <span class="path">${esc(abs(it.path))}</span>（12.1 KB，11:47）会被任务版本（18.4 KB）替换。二进制文件无法合并。`],
    }[t];
    openDlg(`<div class="dialog-body"><h2 id="apDlgT">${what[0]}</h2><p id="apDlgD">${what[1]}</p>
      <div class="banner info" style="margin-top:12px">${I('info')}<div>这一步只记入预览，不会写入文件。真正写入还要在「确认应用」时再确认一次；如果原文件之后又变化，这一项会被阻塞。</div></div></div>
      <div class="dialog-foot"><button class="btn ghost" type="button" data-a="dlg-cancel" autofocus>取消</button><button class="btn primary" type="button" data-a="adopt-ok" data-id="${it.id}">采用任务版本</button></div>`, trigger, () => render(), 'sm');
  }
  function applyDialog(trigger) {
    const fw = frozenWrites();
    const scope = M.round > 1 ? remaining() : ITEMS;
    const keep = scope.filter((it) => act(it) === 'none'), ex = scope.filter((it) => act(it) === 'excluded');
    const cfDone = scope.filter((it) => st(it.id).chk && (st(it.id).chk.k === 'cf' || st(it.id).chk.merged) && isResolved(it));
    const by = { manual: 0, adopt: 0, keep: 0, exclude: 0 };
    cfDone.forEach((it) => { const s = st(it.id); by[!s.sel ? 'exclude' : s.res] = (by[!s.sel ? 'exclude' : s.res] || 0) + 1; });
    const nA = fw.filter((x) => x.kind === 'A').length, nM = fw.filter((x) => x.kind === 'M').length, nD = fw.filter((x) => x.kind === 'D').length;
    openDlg(`<div class="dialog-body"><h2 id="apDlgT">确认把 ${fw.length} 项应用到原项目？</h2>
      <p id="apDlgD">按冻结预览 ${M.frozenRef}（${M.frozenAt}）逐项写入原目录。确认时服务会再核对一次；与预览不一致的项会被阻塞，不会被覆盖。</p>
      <dl class="cf-kv">
        <dt>原目录</dt><dd><div class="cpy"><span class="path">${esc(ORIG)}</span>${copyBtn(ORIG)}</div></dd>
        <dt>写入 ${fw.length} 项</dt><dd><div class="row wrap" style="gap:6px">${kd('A')}<b>${nA}</b>${kd('M')}<b>${nM}</b>${kd('D')}<b>${nD}</b></div>
          <ul class="cf-list">${fw.map((it) => `<li>${I('arrowRight', 'sm')}<span><b style="font-weight:500">${ACT[act(it)]}</b> <span class="path">${esc(it.path)}</span></span></li>`).join('')}</ul></dd>
        ${cfDone.length ? `<dt>冲突已处理</dt><dd>${cfDone.length} 项：${[['manual', '手动解决'], ['adopt', '采用任务版本'], ['keep', '保留当前原文件'], ['exclude', '暂不交付']].filter(([k]) => by[k]).map(([k, l]) => `${l} ${by[k]}`).join(' · ')}</dd>` : ''}
        ${keep.length ? `<dt>不写入</dt><dd>保留当前原文件 ${keep.length} 项：${keep.map((x) => `<span class="path">${esc(x.path)}</span>`).join('、')}</dd>` : ''}
        ${ex.length ? `<dt>留在独立副本</dt><dd>${ex.map((x) => `<span class="path">${esc(x.path)}</span>`).join('、')}${reqExcluded().length && M.svc ? `<div class="hint">必需成果相关 · 服务判定（${M.svc.at}）：允许交付</div>` : ''}</dd>` : ''}
        <dt>不会改动</dt><dd>原目录中不在上面列表里的文件与目录（包括未复制的 <span class="path">data/raw-2025.parquet</span>）。${M.round > 1 ? `已应用的 ${countOuts().applied} 项不会重做。` : ''}</dd>
      </dl>
      <div class="banner unknown nobk">${I('help')}<div><b>服务未提供备份证据</b><br>这次预览没有附带被替换、被删除文件的备份或恢复点，界面不声称可以撤销。若需要保留某个原文件，请先自行备份，或回去把那一项改为「保留当前原文件」。</div></div>
      <p class="hint" style="margin-top:10px">${I('info', 'sm')} 不是文件系统事务：逐项写入，中途中断时已写入的项保留，结果逐项显示。</p></div>
      <div class="dialog-foot"><button class="btn ghost" type="button" data-a="dlg-cancel" autofocus>取消</button><button class="btn primary" type="button" data-a="apply-ok">${I('check', 'sm')}确认应用 ${fw.length} 项</button></div>`, trigger);
  }
  function doApply() {
    const fw = frozenWrites();
    closeDlg(true);
    M.phase = 'applying'; M.applyAt = '16:14'; M.sel = '__result';
    fw.forEach((it) => { st(it.id).out = 'notrun'; });
    let i = 0;
    const step = () => {
      if (i > 0) { st(fw[i - 1].id).out = 'applied'; st(fw[i - 1].id).outAt = '16:14:0' + (i + 1); }
      if (i < fw.length) { st(fw[i].id).out = 'running'; i++; render(); setTimeout(step, T(520)); }
      else { render(); setTimeout(() => TD.go('td05-applied'), T(500)); }
    };
    step();
  }
  function verify(id) {
    st(id).out = 'verifying'; render();
    setTimeout(() => {
      const s = st(id);
      if (id === 'readme' && S === 'td05-unknown') { s.out = 'notrun'; s.outAt = ''; s.note = '核对结果（16:15）：原操作没有到达原目录，README.md 与预览时一致，未被改动'; DS.toast('README.md：原操作未执行，原文件未改动', 'info'); }
      else { s.out = 'applied'; s.outAt = s.outAt + '（核对于 16:15）'; DS.toast(`${byId(id).path}：核对原操作 → 已应用`, 'ok'); }
      render();
    }, T(1000));
  }

  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-copy],[data-sel],[data-view],[data-cmp],[data-a],[data-err]');
    if (!t || t.closest('.proto')) return;
    if (t.getAttribute('aria-disabled') === 'true') { e.preventDefault(); DS.toast(t.title || '当前不可用', 'info'); return; }
    if (t.dataset.copy) { const v = t.dataset.copy; try { navigator.clipboard && navigator.clipboard.writeText(v).catch(() => {}); } catch (x) { /* 原型 */ } DS.toast('已复制：' + v, 'info'); return; }
    if (t.dataset.sel) { select(t.dataset.sel, false); return; }
    if (t.dataset.view) { M.view = t.dataset.view; render(); return; }
    if (t.dataset.cmp) { M.cmp = t.dataset.cmp; render(); return; }
    if (t.dataset.err) { M.errKind = t.dataset.err; render(); return; }
    const a = t.dataset.a;
    if (a === 'listless') { M.listless = !M.listless; render(); return; }
    if (a === 'check') { runCheck(() => TD.go('td05-conflicts')); return; }
    if (a === 'reread') { M.busy = 'reread'; render(); setTimeout(() => TD.go('td05-conflicts'), T(1100)); return; }
    if (a === 'freeze') { freeze(); return; }
    if (a === 'confirm') { applyDialog(t); return; }
    if (a === 'dlg-cancel') { closeDlg(); return; }
    if (a === 'apply-ok') { doApply(); return; }
    if (a === 'adopt-ok') { const id = t.dataset.id; st(id).res = 'adopt'; st(id).sel = true; invalidate(); closeDlg(true); render(); DS.toast('已记入预览：采用任务版本（尚未写入）', 'info'); const el = document.querySelector(`[data-k="res-${id}-adopt"]`); if (el) el.focus(); return; }
    if (a === 'verify') { verify(t.dataset.id); return; }
    if (a === 'settle') { t.innerHTML = '<span class="spin"></span>读取中'; setTimeout(() => TD.go('td05-applied'), T(900)); return; }
  });
  document.addEventListener('change', (e) => {
    const t = e.target; if (!t.dataset || !t.dataset.a) return;
    if (t.dataset.a === 'sel') {
      const s = st(t.dataset.id); s.sel = t.checked; if (t.checked && s.res === 'exclude') s.res = null;
      invalidate(); render(); return;
    }
    if (t.dataset.a === 'selall') { ITEMS.forEach((it) => { if (!st(it.id).out) st(it.id).sel = t.checked; }); invalidate(); render(); return; }
    if (t.dataset.a === 'res') {
      const id = t.dataset.id, it = byId(id), s = st(id), v = t.value;
      if (v === 'adopt') { adoptDialog(it, t); return; }
      if (v === 'exclude') { s.sel = false; s.res = null; invalidate(); render(); return; }
      if (v === 'keep') { s.sel = true; s.res = 'keep'; invalidate(); render(); return; }
      if (v === 'manual') {
        s.sel = true; s.res = null; s.busyRow = true; invalidate(); render();
        setTimeout(() => {
          s.busyRow = false;
          if (it.taskMerged && !s.drift) { s.chk = { k: 'ok', act: 'replace', merged: true, type: 'both' }; s.res = 'manual'; s.note = '16:09 重新检查：任务副本已并入原目录 14:20 的取整与单位修改，可应用 · 替换'; DS.toast(`${it.path}：重新检查后可应用`, 'ok'); }
          else { s.note = `${s.drift ? '16:15' : '16:09'} 重新检查：当前原目录与任务副本在这一项上仍然不同，冲突仍在。请改选其他处理方式，或处理后再检查。`; DS.toast(`${it.path}：仍有冲突`, 'warn'); }
          render();
        }, T(1000));
      }
    }
  });
  /* 清单键盘：↑↓ / Home / End 在行之间移动，Enter / 空格打开详情 */
  document.addEventListener('keydown', (e) => {
    const t = e.target; if (!t.classList || !t.classList.contains('nav-k')) return;
    const all = [...document.querySelectorAll('#apList .nav-k')], i = all.indexOf(t);
    let n = null;
    if (e.key === 'ArrowDown') n = all[i + 1]; else if (e.key === 'ArrowUp') n = all[i - 1]; else if (e.key === 'Home') n = all[0]; else if (e.key === 'End') n = all[all.length - 1];
    if (n) { e.preventDefault(); n.focus(); }
  });

  /* ---------- 挂载 ---------- */
  DS.mount({ header: '', proto: false });
  DS.$('.header').remove();
  TD.mountProto();
  render();
  if (S === 'td05-checking') {
    ITEMS.forEach((it, i) => { st(it.id).chk = i < 3 ? storyChk(it) : i === 3 ? { k: 'run' } : { k: 'wait' }; });
    render();
    let i = 3;
    const step = () => { if (i < ITEMS.length) { st(ITEMS[i].id).chk = storyChk(ITEMS[i]); i++; if (i < ITEMS.length) st(ITEMS[i].id).chk = { k: 'run' }; render(); setTimeout(step, T(1400)); } else setTimeout(() => TD.go('td05-conflicts'), T(800)); };
    setTimeout(step, T(2400));
  }
  if (S === 'td05-conflict-text') { const d = DS.$('#apDetail'), t = DS.$('#apDetail .dt-tools'); if (d && t) d.scrollTop = t.getBoundingClientRect().top - d.getBoundingClientRect().top + d.scrollTop - 6; }
  if (S === 'td05-apply-confirm') setTimeout(() => applyDialog(DS.$('[data-k="confirm"]')), 120);
  if (S === 'td05-drift') { /* 已在结果表中高亮被阻塞项 */ }
})();
