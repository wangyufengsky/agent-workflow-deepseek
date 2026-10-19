/* opencode-workflow · 节点执行详情 · 隔离原型
   - 只读内存里的样例数据（fixtures.js），不发任何网络请求、不访问桌面桥、不写浏览器存储。
   - 状态由 ?state=<id>&theme=<skin> 选择；其余交互都在内存中。
*/
(function () {
  'use strict';
  const F = window.ND_FIXTURES, STATES = window.ND_STATES;
  const I = DS.icon, esc = DS.esc, $ = DS.$, $$ = DS.$$;

  /* ---------- 0. 额外图标与画布状态（运行时补充，不改原稿文件） ---------- */
  Object.assign(DS.ICONS, {
    history: 'M3.5 12a8.5 8.5 0 1 0 2.6-6.1M3.5 4.5v4h4M12 7.5V12l3 2',
    unplug: 'M9 7V3M15 7V3M7 7h10v4a5 5 0 0 1-10 0zM12 16v5M4 4l16 16',
    wrap: 'M4 6h16M4 12h13a3 3 0 0 1 0 6h-4M15 16l-2 2 2 2M4 18h5',
    expand: 'M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7',
    collapse: 'M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7',
    quote: 'M7 7h4v4c0 3-1.5 5-4 6M15 7h4v4c0 3-1.5 5-4 6',
    braces: 'M8 4c-2 0-3 1-3 3v2c0 1.5-1 3-2.5 3 1.5 0 2.5 1.5 2.5 3v2c0 2 1 3 3 3M16 4c2 0 3 1 3 3v2c0 1.5 1 3 2.5 3-1.5 0-2.5 1.5-2.5 3v2c0 2-1 3-3 3',
    code: 'M8 8l-4 4 4 4M16 8l4 4-4 4M14 5l-4 14',
    cloud: 'M7 18a4.5 4.5 0 0 1-.6-8.96A6 6 0 0 1 18 8.5a4.5 4.5 0 0 1-.5 9.5z',
  });
  Object.assign(DSCanvas.STATUS, {
    cancelling: ['取消中', 'st-wait', 'clock'], cancel: ['已取消', 'st-idle', 'stop'],
    reject: ['验收未通过', 'st-fail', 'x'], manual: ['待人工验收', 'st-wait', 'eye'],
  });

  /* ---------- 1. 地址参数与全局状态 ---------- */
  const P = new URLSearchParams(location.search);
  if(P.get('returnTo')&&P.get('taskTitle'))F.PROJECTS.A.task=P.get('taskTitle');
  const CFG = Object.assign({},STATES.find((s) => s.id === P.get('state')) || STATES.find((s) => s.id === 'n01-open'));if(/^n\d+$/.test(P.get('nodeId')||'')){const nid=P.get('nodeId');if(F.PROJECTS.A.nodes.some(x=>x.id===nid))CFG.open=nid;const tgt=F.PROJECTS.A.nodes.find(x=>x.id===CFG.open);if(P.get('nodeTitle')&&tgt)tgt.title=P.get('nodeTitle');}
  const S = {
    project: CFG.project || 'A', open: null, tab: CFG.tab || 'session', view: 3,
    sub: null, reader: null, readerFrom: null,
    reduced: P.get('motion') === 'reduce' || !!CFG.reduced || matchMedia('(prefers-reduced-motion: reduce)').matches,
    stream: P.get('stream') === 'paused' ? false : !!CFG.stream,
    curHasNew: false, lateNote: null,
  };
  const INIT_TX = CFG.tx || null; let txInitUsed = false;
  const MEM = new Map();      // 记录区阅读位置与跟随状态，key = 节点:尝试（只在内存）
  const EXP = new Set();      // 展开的推理摘要 / 代码块
  const VW = {};              // 查看器状态（已加载行数、换行、读取失败）
  const DL = {};              // 下载模拟状态
  const CHECK = {};           // 核对原操作的模拟结果
  if (S.reduced) document.documentElement.classList.add('reduced');

  /* ---------- 2. 小工具 ---------- */
  const secs = (t) => { if (!t) return null; const [h, m, s] = t.split(':').map(Number); return h * 3600 + m * 60 + (s || 0); };
  const dur = (a, b) => { const x = secs(a), y = secs(b); if (x == null || y == null) return null; const d = y - x; return d >= 60 ? `${Math.floor(d / 60)} 分 ${d % 60} 秒` : `${d} 秒`; };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const toast = (m, k = 'info') => DS.toast(m, k);
  function copyText(text, label) {
    const done = () => toast('已复制' + label + '（只含这一块的原文）', 'ok');
    const fallback = () => { const ta = document.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;left:-9999px;top:0'; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); } catch (e) {} ta.remove(); done(); };
    try { if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(done, fallback); else fallback(); } catch (e) { fallback(); }
  }

  /* ---------- 3. Markdown（流式安全） ---------- */
  function inline(s) {
    let h = esc(s);
    h = h.replace(/`([^`]+)`/g, (m, c) => `<code>${c}</code>`);
    h = h.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    h = h.replace(/\[(\d+)\]/g, (m, n) => `<button class="cite" data-cite="${n}" aria-label="打开引用 ${n}" title="打开引用 ${n} 的原文">${n}</button>`);
    h = h.replace(/\b([a-z0-9.-]+\.invalid\/[^\s<]*)/gi, '<span class="lnk" title="设计样例：原型不打开任何外部链接">$1</span>');
    return h;
  }
  const CARET = '<span class="caret" aria-hidden="true"></span>';
  function mdRender(src, opt = {}) {
    const L = String(src || '').split('\n'), B = [];
    let i = 0;
    const isBlockStart = (l) => /^```/.test(l) || /^#{1,4}\s/.test(l) || /^\s*([-*]|\d+\.)\s+/.test(l) || /^>\s?/.test(l) || /^\s*\|/.test(l);
    while (i < L.length) {
      const l = L[i];
      const fm = l.match(/^```([\w-]*)\s*$/);
      if (fm) {
        const buf = []; let closed = false; i++;
        while (i < L.length) { if (/^```\s*$/.test(L[i])) { closed = true; i++; break; } buf.push(L[i]); i++; }
        if (!closed && buf.length && buf[buf.length - 1] === '') buf.pop();
        B.push({ t: 'code', lang: fm[1] || '', code: buf, closed }); continue;
      }
      if (/^\s*$/.test(l)) { i++; continue; }
      const hm = l.match(/^(#{1,4})\s+(.*)$/);
      if (hm) { B.push({ t: 'h', lv: Math.min(4, hm[1].length + 1), text: hm[2] }); i++; continue; }
      if (/^\s*\|/.test(l) && i + 1 < L.length && /^\s*\|?\s*:?-{2,}/.test(L[i + 1])) {
        const cells = (r) => r.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
        const head = cells(l); i += 2; const rows = [];
        while (i < L.length && /^\s*\|/.test(L[i])) { rows.push(cells(L[i])); i++; }
        B.push({ t: 'table', head, rows }); continue;
      }
      if (/^\s*([-*]|\d+\.)\s+/.test(l)) {
        const ordered = /^\s*\d+\./.test(l), items = [];
        while (i < L.length && /^\s*([-*]|\d+\.)\s+/.test(L[i])) { items.push(L[i].replace(/^\s*([-*]|\d+\.)\s+/, '')); i++; }
        B.push({ t: 'list', ordered, items }); continue;
      }
      if (/^>\s?/.test(l)) { const q = []; while (i < L.length && /^>\s?/.test(L[i])) { q.push(L[i].replace(/^>\s?/, '')); i++; } B.push({ t: 'quote', text: q.join(' ') }); continue; }
      const p = [l]; i++;
      while (i < L.length && !/^\s*$/.test(L[i]) && !isBlockStart(L[i])) { p.push(L[i]); i++; }
      B.push({ t: 'p', text: p.join('\n') });
    }
    const caretAt = opt.caret ? B.length - 1 : -1;
    return B.map((b, k) => {
      const c = k === caretAt ? CARET : '';
      if (b.t === 'h') return `<h${b.lv}>${inline(b.text)}${c}</h${b.lv}>`;
      if (b.t === 'p') return `<p>${inline(b.text).replace(/\n/g, '<br>')}${c}</p>`;
      if (b.t === 'quote') return `<blockquote>${inline(b.text)}${c}</blockquote>`;
      if (b.t === 'list') { const tg = b.ordered ? 'ol' : 'ul'; return `<${tg}>${b.items.map((x, j) => `<li>${inline(x)}${j === b.items.length - 1 ? c : ''}</li>`).join('')}</${tg}>`; }
      if (b.t === 'table') return `<div class="md-tbl" tabindex="0" role="region" aria-label="表格（可横向滚动）"><table><thead><tr>${b.head.map((h) => `<th>${inline(h)}</th>`).join('')}</tr></thead><tbody>${b.rows.map((r) => `<tr>${r.map((x) => `<td>${inline(x)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>${c ? `<p>${c}</p>` : ''}`;
      if (b.t === 'code') {
        const raw = b.code.join('\n'), key = 'code:' + (opt.key || '') + ':' + k, long = b.closed && b.code.length > 14, open = EXP.has(key);
        return `<div class="md-code ${long && !open ? 'collapsed' : ''}" data-raw="${esc(raw)}" data-key="${key}">
          <div class="md-code-h"><span class="lang">${esc(b.lang || '代码')}</span><span class="grow"></span><button class="btn ghost sm" data-copy-code style="height:24px;padding:0 8px;font-size:11.5px">${I('copy', 'sm')}复制</button></div>
          <pre><code>${b.code.map((x) => hl(x, b.lang)).join('\n')}${c}</code></pre>
          ${long ? `<div class="md-code-more"><button class="btn ghost sm" data-code-toggle>${open ? '收起' : `展开全部 ${b.code.length} 行`}</button></div>` : ''}
          ${b.closed ? '' : `<div class="md-code-f">${I('clock', 'sm')}代码块未结束 · ${opt.live ? '正在生成' : '没有收到结束标记'}</div>`}
        </div>`;
      }
      return '';
    }).join('');
  }

  /* ---------- 4. 语法色（令牌着色，四主题通用） ---------- */
  const KW = new Set('export async function const let var return if else await import from type interface class extends new throw try catch for of in while true false null undefined void typeof'.split(' '));
  function hl(line, lang) {
    if (!/^(ts|js|typescript|javascript|json|sh|bash|yaml|diff)$/.test(lang || '')) return esc(line);
    const sh = /^(sh|bash|yaml)$/.test(lang);
    const re = sh ? /(#.*$)|('(?:[^'\\]|\\.)*'?|"(?:[^"\\]|\\.)*"?)|\b(\d+(?:\.\d+)?)\b|([A-Za-z_][\w-]*)/g
      : /(\/\/.*$)|('(?:[^'\\]|\\.)*'?|"(?:[^"\\]|\\.)*"?|`(?:[^`\\]|\\.)*`?)|\b(\d+(?:\.\d+)?)\b|([A-Za-z_$][\w$]*)/g;
    let out = '', last = 0, m;
    while ((m = re.exec(line))) {
      out += esc(line.slice(last, m.index));
      if (m[1]) out += `<span class="tk-c">${esc(m[1])}</span>`;
      else if (m[2]) out += `<span class="tk-s">${esc(m[2])}</span>`;
      else if (m[3]) out += `<span class="tk-n">${m[3]}</span>`;
      else if (m[4]) out += !sh && KW.has(m[4]) ? `<span class="tk-k">${m[4]}</span>` : !sh && /^[A-Z]/.test(m[4]) ? `<span class="tk-t">${m[4]}</span>` : sh && /^(npm|jest|tsc|run|test|build)$/.test(m[4]) ? `<span class="tk-k">${m[4]}</span>` : esc(m[4]);
      last = re.lastIndex;
      if (m[0] === '') re.lastIndex++;
    }
    return out + esc(line.slice(last));
  }

  /* ---------- 5. JSON 树（脱敏标记 → chip） ---------- */
  const isRed = (v) => v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 1 && '$redacted' in v;
  const REDACT = `<span class="redact" title="值在服务端已隐藏，从未发送到这里">${I('lock', 'sm')}已隐藏 · 服务端脱敏</span>`;
  function jsonForCopy(v) { if (isRed(v)) return '[已隐藏]'; if (Array.isArray(v)) return v.map(jsonForCopy); if (v && typeof v === 'object') { const o = {}; for (const k in v) o[k] = jsonForCopy(v[k]); return o; } return v; }
  function countRed(v) { if (isRed(v)) return 1; if (v && typeof v === 'object') return Object.values(v).reduce((a, x) => a + countRed(x), 0); return 0; }
  function jprim(v) {
    if (isRed(v)) return REDACT;
    if (typeof v === 'string') return `<span class="str">"${esc(v)}"</span>`;
    if (typeof v === 'number') return `<span class="num">${v}</span>`;
    return `<span class="lit">${v === null ? 'null' : String(v)}</span>`;
  }
  function jnode(v, key, last, depth) {
    const kh = key == null ? '' : `<span class="key">"${esc(key)}"</span><span class="pn colon">: </span>`;
    const cm = last ? '' : '<span class="pn">,</span>';
    if (v === null || typeof v !== 'object' || isRed(v)) return `<div class="row">${kh}${jprim(v)}${cm}</div>`;
    const arr = Array.isArray(v), ent = arr ? v.map((x, i) => [null, x]) : Object.entries(v);
    const o = arr ? '[' : '{', c = arr ? ']' : '}';
    return `<details ${depth < 3 ? 'open' : ''}><summary><span class="tw">${I('chevRight', 'sm')}</span>${kh}<span class="pn">${o}</span><span class="sm">${arr ? ent.length + ' 项' : ent.length + ' 个字段'} ${c}${cm ? ',' : ''}</span></summary>
      <div class="ch">${ent.map(([k, x], i) => jnode(x, k, i === ent.length - 1, depth + 1)).join('')}</div><div class="pn cl" style="padding-left:16px">${c}${last ? '' : ','}</div></details>`;
  }
  const jsonTree = (v) => `<div class="jt" data-jt>${jnode(v, null, true, 0)}</div>`;

  /* ---------- 6. 代码 / 命令输出查看器 ---------- */
  function markText(l, needle) {
    const re = new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    let out = '', last = 0, m;
    while ((m = re.exec(l))) { out += esc(l.slice(last, m.index)) + `<mark class="hit">${esc(m[0])}</mark>`; last = re.lastIndex; if (!m[0]) re.lastIndex++; }
    return out + esc(l.slice(last));
  }
  function linesHTML(lines, o = {}) {
    const start = o.start || 1, needle = (o.find || '').trim(), low = needle.toLowerCase();
    return lines.map((l, i) => {
      const no = start + i, inHl = o.hl && no >= o.hl[0] && no <= o.hl[1];
      const hit = low && l.toLowerCase().includes(low);
      const body = hit && !o.lang ? markText(l, needle) : hl(l, o.lang);
      const err = o.errLines && /^(FAIL\b|\s+●)|Expected:|Received:|error TS|ERR!/.test(l);
      return `<div class="l ${inHl ? 'hl' : ''} ${err ? 'err' : ''} ${hit && o.lang ? 'mark' : ''}" ${o.anchor ? `id="${o.anchor}-L${no}"` : ''}><b>${no}</b><span>${body || ' '}</span></div>`;
    }).join('');
  }
  function codeHTML(lines, o = {}) {
    const start = o.start || 1, gut = Math.max(40, String(start + lines.length).length * 8 + 22);
    return `<div class="cd ${o.wrap ? 'wrap' : ''}" style="--gut:${gut}px" tabindex="0" role="region" aria-label="${esc(o.label || '代码')}">${linesHTML(lines, o)}</div>`;
  }

  /* ---------- 7. 记录模型（按 seq 去重，原位更新） ---------- */
  function newModel() { return { items: [], byId: {}, seen: new Set(), dup: 0, bf: 0, n: 0 }; }
  function apply(m, e) {
    if (e.seq != null) { if (m.seen.has(e.seq)) { if (e.bf) m.dup++; return null; } m.seen.add(e.seq); }
    if (e.bf && e.seq != null) m.bf++;
    const add = (it) => { it.bf = !!e.bf; m.items.push(it); m.byId[it.id] = it; return { id: it.id, isNew: true }; };
    if (e.k === 'txt') {
      const it = m.byId[e.id];
      if (it) { it.md += e.d; it.done = !!e.end; if (e.bf) it.bfUpd = true; return { id: it.id, isNew: false }; }
      return add({ id: e.id, k: 'txt', t: e.t, md: e.d, done: !!e.end });
    }
    if (e.k === 'tool') {
      const it = m.byId[e.id];
      if (it) {
        it.st = e.st; if (e.bf) it.bfUpd = true;
        if (['ok', 'fail', 'cancel'].includes(e.st)) it.endT = e.t;
        if (e.late) it.late = e.t;
        if (e.note) it.note = e.note;
        return { id: it.id, isNew: false };
      }
      return add({ id: e.id, k: 'tool', t: e.t, st: e.st, endT: ['ok', 'fail'].includes(e.st) ? e.t : null, note: e.note });
    }
    if (e.k === 'rsn') return add({ id: e.id, k: 'rsn', t: e.t, text: e.text });
    const id = 'i' + (++m.n) + '-' + e.k;
    return add(Object.assign({ id, k: e.k }, e));
  }
  const build = (events) => { const m = newModel(); events.forEach((e) => apply(m, e)); return m; };
  const evs = (from, to) => F.EVENTS.slice(from, to);
  const M = (k) => F.mark(k);

  /* ---------- 8. 当前尝试 #3 的服务事实剧本 ---------- */
  const SV = (t, icon, text, tone) => ({ k: 'svc', t, icon, text, tone });
  const DISC = SV('10:44:05', 'unplug', '<b>连接中断</b> · 数据通道断开，之后的记录需要补读', 'danger');
  const SUBMIT = SV('10:48:31', 'upload', '<b>结果已提交 · 等待验收</b> · 结果版本 r3', 'wait');
  function bfList(withLate) {
    const dupB3 = F.EVENTS[M('b3') - 1], dupQ2 = F.EVENTS[M('q2') - 1];
    const L = [dupB3];
    if (withLate) L.push(F.EVENTS[M('q1-late') - 1]);
    else L.push({ k: 'gap', from: '10:44:12', to: '10:44:38' }, { k: 'tool', id: 'c-b7e1', t: null, st: 'unknown', note: 'gap' });
    L.push(dupQ2);
    evs(M('build-start') - 1, M('test-running')).forEach((e) => L.push(e));
    return L.map((e) => Object.assign({}, e, { bf: true }));
  }
  function makeCur(kind) {
    const C = { kind, status: 'run', result: 'none', ended: false, conn: 'ok', loading: false, revoked: false, queue: [], model: null, extra: {} };
    let init = [];
    const upto = (k) => { init = evs(0, k === 'all' ? F.EVENTS.length : M(k)); };
    const until = (from, k) => { C.queue = evs(M(from), k === 'all' ? F.EVENTS.length : M(k)); };
    switch (kind) {
      case 'loading': case 'back-loading': C.loading = true; C.after = 'tool-running'; if (kind === 'loading') C.after = 'run-mid'; break;
      case 'revoked': C.revoked = true; break;
      case 'empty': upto('start'); until('start', 'b1'); break;
      case 'run-mid': upto('b3-2'); until('b3-2', 'test-running'); break;
      case 'run-b4': upto('b4'); until('b4', 'b6'); break;
      case 'wait-tool': upto('test-queued'); until('test-queued', 'b5'); break;
      case 'tool-running': upto('test-running'); until('test-running', 'b5'); break;
      case 'tool-done': upto('test2'); until('test2', 'all'); break;
      case 'reasoning': upto('r2'); until('r2', 'b3'); break;
      case 'no-reasoning': upto('r2'); init = init.filter((e) => e.k !== 'rsn'); C.noRsn = true; until('r2', 'b3'); break;
      case 'twice': upto('build'); until('build', 'test-running'); break;
      case 'ended': upto('all'); C.ended = true; break;
      case 'pending': upto('all'); init.push(SUBMIT); C.ended = true; C.status = 'ended'; C.result = 'pending'; break;
      case 'done': upto('all'); init.push(SUBMIT, SV('10:49:05', 'check', '<b>验收通过</b> · 结果版本 r3 · 验收策略 v3', 'ok')); C.ended = true; C.status = 'done'; C.result = 'accepted'; break;
      case 'rejected': upto('all'); init.push(SUBMIT, SV('10:49:05', 'x', '<b>验收未通过</b> · 结果版本 r3 · 验收策略 v3：旧接口 POST /refund 仍可绕过幂等键（规则 R4）', 'warn')); C.ended = true; C.status = 'ended'; C.result = 'rejected'; break;
      case 'manual': upto('all'); init.push(SUBMIT, SV('10:49:05', 'eye', '<b>进入人工验收</b> · 结果版本 r3 · 验收策略 v3 要求人工确认', 'wait')); C.ended = true; C.status = 'ended'; C.result = 'manual'; break;
      case 'receipt-unknown': upto('all'); init.push(SV('10:48:31', 'upload', '结果提交请求已发出 · 结果版本 r3'), SV('10:49:31', 'help', '<b>提交回执未知</b> · 60 秒内没有收到服务回执；原记录保持，不会重发', 'unk')); C.ended = true; C.result = 'receipt-unknown'; C.check = 'submit'; break;
      case 'failed': upto('b3-3'); init.push({ k: 'err', t: '10:43:31', text: '模型服务中止了输出（upstream_aborted）。已收到的正文保留，这次尝试不会自动重试。' }, { k: 'tool', id: 'c-b7e1', t: null, st: 'unknown', note: 'failed' }); C.status = 'fail'; break;
      case 'cancelling': upto('test-running'); init.push(SV('10:45:40', 'stop', '<b>你请求停止这一步</b> · 等待执行器确认；确认前它可能仍在执行', 'wait')); C.status = 'cancelling'; C.queue = evs(M('test-running'), M('b5')); break;
      case 'cancelled': upto('test-running'); init.push(SV('10:45:40', 'stop', '你请求停止这一步', 'wait'), { k: 'tool', id: 'c-c3f9', t: '10:45:58', st: 'cancel' }, SV('10:45:58', 'stop', '<b>执行器已确认停止</b> · 已收到的正文与工具记录保留')); C.status = 'cancelled'; break;
      case 'cancel-unknown': upto('test-running'); init.push(SV('10:45:40', 'stop', '你请求停止这一步', 'wait'), SV('10:46:40', 'help', '<b>停止请求没有收到回执</b> · 结果未知；界面不会重复发送停止', 'unk')); C.status = 'cancel-unknown'; C.check = 'stop'; break;
      case 'disc': case 'reconn': upto('b3'); init.push(DISC); C.conn = kind === 'disc' ? 'down' : 'reconnecting'; C.disc = '10:44:05'; break;
      case 'bf-ing': { upto('b3'); init.push(DISC, SV('10:45:16', 'refresh', '<b>开始补读</b> · 按服务序号读取 10:44:05 之后的记录', 'acc')); const B = bfList(true); init = init.concat(B.slice(0, 4)); C.queue = B.slice(4).concat([{ k: 'bfdone' }]); C.conn = 'backfilling'; C.disc = '10:44:05'; break; }
      case 'bf-done': case 'gap': {
        upto('b3'); init.push(DISC); init = init.concat(bfList(kind === 'bf-done'));
        C.conn = 'backfilled'; C.gap = kind === 'gap' ? '10:44:12–10:44:38' : null; C.disc = '10:44:05';
        C.queue = evs(M('test-running'), M('b5')); break;
      }
      default: upto('b3-2');
    }
    C.endT = C.ended ? '10:47:20' : { fail: '10:43:31', cancelled: '10:45:58' }[C.status] || null;
    C.model = build(init);
    if (kind === 'bf-done' || kind === 'gap') pushBfDone(C);
    return C;
  }
  function pushBfDone(C) {
    const m = C.model;
    C.conn = 'backfilled';
    return apply(m, SV('10:45:20', 'refresh', `<b>已补读 ${m.bf} 条（去重 ${m.dup} 条）</b>${C.gap ? ' · 有 1 段记录无法补读' : ''} · 顺序与服务一致`, C.gap ? 'unk' : 'acc'));
  }
  let CUR = makeCur(CFG.cur || 'run-mid');

  /* ---------- 9. 历史尝试与其他节点的固定记录 ---------- */
  const HCTX = {};
  [1, 2].forEach((no) => { HCTX[no] = { hist: true, no, model: build(F.HIST[no].map((e, i) => Object.assign({ seq: 1000 * no + i }, e))), status: F.ATTEMPTS[no].status, ended: true, conn: 'hist', result: no === 2 ? 'rejected' : 'none' }; });
  const OTHER = {
    n1: { status: 'done', result: 'accepted', ended: true, conn: 'ok', model: build([
      SV('09:01:10', 'play', '尝试 #1 开始 · 定义修订 v2'),
      { k: 'txt', id: 'o1', t: '09:01:16', d: '已整理退款场景：全额、部分、重复请求。金额统一为整数分，重复请求按幂等键去重。\n', end: true },
      SV('09:06:40', 'upload', '结果已提交 · 结果版本 r1', 'wait'), SV('09:07:02', 'check', '<b>验收通过</b> · 结果版本 r1 · 验收策略 v1', 'ok')]) },
    n3: { status: 'run', result: 'none', ended: false, conn: 'ok', model: build([
      SV('10:40:12', 'play', '尝试 #1 开始 · 定义修订 v3'),
      { k: 'txt', id: 'o3', t: '10:40:20', d: '按需求清单编写接口测试：先覆盖重复请求与金额精度两类。\n', end: true }]) },
  };
  const nodeOf = (id) => F.PROJECTS[S.project].nodes.find((n) => n.id === id);
  function ctx() {
    const id = S.open;
    if (id === 'n2') return S.view === 3 ? Object.assign({ hist: false, no: 3, node: 'n2', live: true }, CUR) : Object.assign({ node: 'n2' }, HCTX[S.view]);
    const o = OTHER[id] || { status: 'idle', result: 'none', ended: false, conn: 'ok', model: newModel() };
    return Object.assign({ hist: false, no: 1, node: id, other: true }, o, id === 'n3' && S.lateNote ? { loading: true } : {});
  }
  const memKey = () => `${S.project}:${S.open}:${S.view}`;

  /* ---------- 10. 画布状态 ---------- */
  function n2Status() {
    const c = CUR;
    if (c.revoked) return 'unknown';
    if (c.result === 'receipt-unknown' || c.status === 'cancel-unknown') return 'unknown';
    return { run: 'run', fail: 'fail', cancelling: 'cancelling', cancelled: 'cancel', done: 'done' }[c.status]
      || { pending: 'review', rejected: 'reject', manual: 'manual' }[c.result] || 'run';
  }
  function statusOf(id) {
    if (S.project === 'B') return { p1: 'done', p2: 'run', p3: 'idle' }[id];
    return { n1: 'done', n2: n2Status(), n3: 'run', n4: 'idle', n5: 'idle' }[id];
  }
  const CVOPT = { nodes: F.PROJECTS[S.project].nodes, edges: F.PROJECTS[S.project].edges.map(([from, to]) => ({ from, to })), statusOf,
    onSelect: (id, sys) => { if (sys) { toast('“' + (nodeOf(id) || {}).title + '”是系统节点，没有执行详情', 'info'); return; } if (!id) return closePanel(true); openNode(id); } };
  let cv;

  /* ---------- 11. 页头与情况条 ---------- */
  function bar() {
    const pr = F.PROJECTS[S.project];
    const st = P.get('returnTo') ? ['节点执行回放','st-idle','history'] : S.project === 'B' ? ['执行中', 'st-run', 'play'] : ({ run: ['执行中', 'st-run', 'play'], cancelling: ['执行中', 'st-run', 'play'], review: ['待验收', 'st-wait', 'eye'], manual: ['待人工验收', 'st-wait', 'eye'], fail: ['有步骤失败', 'st-fail', 'x'], reject: ['有步骤失败', 'st-fail', 'x'], unknown: ['状态待核对', 'st-unknown', 'help'], cancel: ['有步骤已停止', 'st-idle', 'stop'], done: ['执行中', 'st-run', 'play'] })[n2Status()];
    $('#bar').innerHTML = `
      <nav class="crumbs" aria-label="位置"><a href="#" data-proto-nav="任务列表">任务列表</a><span class="sep">/</span></nav>
      <span class="task-title" title="${esc(pr.task)}">${esc(pr.task)}</span>
      <span class="badge ${st[1]}">${I(st[2], 'sm')}${st[0]}</span>
      <span class="badge outline sample-badge" title="本原型只用虚构样例数据">${I('info', 'sm')}设计样例 · 不连接真实服务/模型</span>
      <span class="grow"></span>
      <label class="auto" title="开启时，步骤验收通过后自动开始满足条件的下一批步骤">自动节点推进<button class="switch" role="switch" aria-checked="true" aria-label="自动节点推进" data-act="auto"></button></label>
      <button class="icon-btn" aria-label="更多" data-act="more">${I('more')}</button>`;
  }
  function situ() {
    let s;
    if (S.project === 'B') s = ['', `<span class="where">${I('folder', 'sm')}已切换到 <b>示例项目 · 支付网关</b></span><span class="sep"></span><span class="sub">上一个项目的节点详情、记录与阅读位置已清除，不会带到这里</span>`];
    else {
      const c = CUR, k = n2Status();
      if (c.revoked) s = ['unk', `<span class="where" style="color:var(--unknown)">${I('lock', 'sm')}你已无权查看 <b>实现接口</b> 的执行记录</span><span class="sep"></span><span class="sub">面板里的内容已清除；画布只显示服务允许的状态</span>`];
      else if (c.conn === 'down' || c.conn === 'reconnecting') s = ['unk', `<span class="where" style="color:var(--unknown)">${I('unplug', 'sm')}数据连接${c.conn === 'down' ? '已断开' : '正在重新连接'}</span><span class="sep"></span><span class="sub">画布显示 10:44:05 读到的状态；模型是否仍在执行以服务为准</span>`];
      else if (k === 'unknown') s = ['unk', `<span class="where" style="color:var(--unknown)">${I('help', 'sm')}<b>实现接口</b> 有一个操作的结果未确认</span><span class="sep"></span><span class="sub">核对原操作前不能继续操作这一步</span><span class="grow"></span><button class="btn secondary sm" data-act="focus-n2">查看并核对</button>`];
      else if (k === 'fail' || k === 'reject') s = ['fail', `<span class="where" style="color:var(--warn)">${I('x', 'sm')}<b>实现接口</b> ${k === 'fail' ? '失败：模型服务中止了输出' : '验收未通过：旧接口仍可绕过幂等键'}</span><span class="sep"></span><span class="sub">已用尝试 3 次</span><span class="grow"></span><button class="btn primary sm" data-act="focus-n2">查看原因</button>`];
      else if (k === 'review' || k === 'manual') s = ['wait', `<span class="where" style="color:var(--wait)">${I('eye', 'sm')}<b>实现接口</b> 结果 r3 已提交，${k === 'manual' ? '等待你人工验收' : '等待验收'}</span><span class="grow"></span><button class="btn ${k === 'manual' ? 'primary' : 'secondary'} sm" data-act="focus-n2">${k === 'manual' ? '去验收' : '查看'}</button>`];
      else if (k === 'cancelling') s = ['wait', `<span class="where" style="color:var(--wait)">${I('clock', 'sm')}<b>实现接口</b> 正在停止：等待执行器确认</span><span class="sep"></span><span class="sub">“编写测试”继续执行</span>`];
      else if (k === 'cancel') s = ['', `<span class="where">${I('stop', 'sm')}<b>实现接口</b> 已停止（执行器 10:45:58 确认）</span><span class="sep"></span><span class="sub">“编写测试”继续执行</span>`];
      else s = ['', `<span class="where">${I('play', 'sm')}进行到第 2 段：<b>实现接口</b>、<b>编写测试</b> 并行执行中</span><span class="sep"></span><span class="sub">没有需要你处理的事</span><span class="grow"></span><span class="hint">下一步：两步都验收通过后自动开始“回归测试”</span>`];
    }
    if(P.get('returnTo'))s=['', '<span class="where">节点执行记录 · 回放视图</span><span class="sep"></span><span class="sub">任务当前的隔离、验证与交付状态请返回任务画布查看</span>'];
    $('#situ').innerHTML = `<div class="situ ${s[0]}" role="status">${s[1]}</div>`;
    $$('#cv .cv-overlay').forEach((e) => e.remove());
    $('#cv').insertAdjacentHTML('beforeend', `<div class="cv-overlay legend" aria-hidden="true"><span style="color:var(--run)">${I('play', 'sm')}执行中</span><span style="color:var(--warn)">${I('x', 'sm')}失败</span><span style="color:var(--wait)">${I('eye', 'sm')}待验收</span><span style="color:var(--done)">${I('check', 'sm')}完成</span><span style="color:var(--unknown)">${I('help', 'sm')}未核对</span></div>`);
    if (CFG.kb) $('#cv').insertAdjacentHTML('beforeend', `<div class="cv-overlay kb-legend" role="note"><b>键盘操作</b><br><span class="kbd">Tab</span> 画布 → 面板头 → 页签 → 记录 → 页脚<br><span class="kbd">←</span> <span class="kbd">→</span> 在页签之间切换<br><span class="kbd">Enter</span> 打开工具 / 引用 · <span class="kbd">Esc</span> 关闭阅读区，再关闭子视图</div>`);
  }

  /* ---------- 12. 面板：头 / 历史条 / 页签 / 页脚 ---------- */
  const ATT_ST = { run: ['执行中', 'st-run', 'play'], fail: ['失败', 'st-fail', 'x'], cancelling: ['取消中', 'st-wait', 'clock'], cancelled: ['已取消', 'st-idle', 'stop'], cancel: ['已取消', 'st-idle', 'stop'], 'cancel-unknown': ['取消结果未知', 'st-unknown', 'help'], ended: ['执行已结束', 'st-idle', 'stop'], done: ['已完成', 'st-done', 'check'], idle: ['待执行', 'st-idle', 'clock'] };
  const RES_ST = { none: ['未提交', 'st-idle', 'minus'], pending: ['已提交待验收', 'st-wait', 'eye'], accepted: ['验收通过', 'st-done', 'check'], rejected: ['未通过', 'st-fail', 'x'], manual: ['待人工验收', 'st-wait', 'eye'], 'receipt-unknown': ['回执未知', 'st-unknown', 'help'] };
  const badge = (a, extra = '') => `<span class="badge ${a[1]}" ${extra}>${I(a[2], 'sm')}${a[0]}</span>`;
  function attMenuItems() {
    const c = ATT_ST[CUR.status] || ATT_ST.run;
    return [
      { label: `尝试 #3 · ${c[0]} · 10:42 开始（当前）`, icon: 'play', run() { switchAttempt(3); } },
      { label: '尝试 #2 · 已取消 · 09:58–10:33', icon: 'history', run() { switchAttempt(2); } },
      { label: '尝试 #1 · 失败 · 09:12–09:20', icon: 'history', run() { switchAttempt(1); } },
    ];
  }
  function headHTML(n, s) {
    const SS = DSCanvas.STATUS[s] || DSCanvas.STATUS.idle, isN2 = n.id === 'n2' && S.project === 'A';
    const hist = isN2 && S.view !== 3;
    const chip = isN2 ? `<button class="att-chip ${hist ? 'hist' : ''}" data-act="att-menu" aria-haspopup="menu" aria-label="选择尝试，当前查看尝试 #${S.view}">${hist ? I('history', 'sm') : ''}尝试 #${S.view} · ${hist ? '历史' : '当前'}${I('chevDown', 'sm')}</button>`
      : (OTHER[n.id] ? `<span class="att-chip" style="cursor:default">尝试 #1 · 当前</span>` : '');
    return `<div class="side-head"><div class="grow"><div class="eyebrow">步骤 ${F.PROJECTS[S.project].nodes.indexOf(n)} · ${esc(n.role)}</div><div style="font-size:16px;font-weight:500;margin-top:3px">${esc(n.title)}</div>
      <div class="row wrap" style="margin-top:8px;gap:6px">${badge(SS)}${chip}</div></div>
      <button class="icon-btn" aria-label="关闭步骤详情，回到全图" data-act="close">${I('x')}</button></div>`;
  }
  function histBarHTML() {
    if (!(S.open === 'n2' && S.view !== 3)) return '';
    return `<div class="hist-bar" role="status">${I('history')}<span class="grow">正在查看<b>尝试 #${S.view}</b> 的记录 · 只读<span class="newdot" id="newdot" ${S.curHasNew && CUR.status === 'run' ? '' : 'hidden'}><span class="dot"></span>当前尝试有新内容</span></span><button class="btn secondary sm" data-act="back-current">回到当前尝试</button></div>`;
  }
  function footHTML(n, s, c) {
    if (c.hist) return `<div class="side-foot"><span class="hint grow">${I('lock', 'sm')} 历史记录只读，不会重跑、恢复或验收</span><button class="btn secondary" data-act="back-current">回到当前尝试</button></div>`;
    if (S.project === 'B') return `<div class="side-foot"><span class="hint grow">示例项目切换演示，没有执行记录</span></div>`;
    if (n.id !== 'n2') {
      const f = { done: `<span class="grow"></span><button class="btn secondary" data-act="proto" data-msg="查看产出">查看产出</button>`, run: S.tab === 'session' ? `<span class="hint grow">${I('lock', 'sm')} 查看记录不会启动、暂停或改变执行</span>` : `<span class="grow"></span><button class="btn primary" data-act="tab" data-tab="session">${I('terminal', 'sm')}查看执行现场</button>`, idle: `<span class="hint grow">等待前面的步骤完成</span>` }[s] || '';
      return `<div class="side-foot">${f}</div>`;
    }
    if (c.loading) return `<div class="side-foot"><span class="hint grow">读取完成前不能操作</span></div>`;
    if (c.revoked) return `<div class="side-foot"><span class="hint grow">无权查看时不提供任何动作</span><button class="btn secondary" data-act="close">回到全图</button></div>`;
    const cn = c.conn === 'down' || c.conn === 'reconnecting' || c.conn === 'backfilling';
    let f;
    if (cn) f = `<span class="hint grow">${I('unplug', 'sm')} 连接恢复并补读完成后才能操作</span>`;
    else if (c.status === 'fail' || c.result === 'rejected') f = `<button class="btn ghost sm" data-act="tab" data-tab="attempts">查看 3 次尝试</button><span class="grow"></span><button class="btn primary" data-act="proto" data-msg="恢复这一步">${I('refresh', 'sm')}恢复这一步</button>`;
    else if (c.status === 'cancel-unknown' || c.result === 'receipt-unknown') f = `<span class="hint grow">核对完成前不能操作</span><button class="btn secondary" data-act="check">${I('refresh', 'sm')}核对原操作</button>`;
    else if (c.status === 'cancelling') f = `<span class="hint grow">${I('clock', 'sm')} 等待执行器确认停止，期间不能再次停止或恢复</span>`;
    else if (c.status === 'cancelled') f = `<span class="hint grow">这一步已停止，已产生的记录保留</span><button class="btn primary" data-act="proto" data-msg="恢复这一步">${I('refresh', 'sm')}恢复这一步</button>`;
    else if (c.result === 'manual') f = `<button class="btn ghost sm" style="color:var(--danger)" data-act="proto" data-msg="退回修改">退回修改</button><span class="grow"></span><button class="btn primary" data-act="proto" data-msg="验收通过（结果 r3 · 策略 v3）">${I('check', 'sm')}验收通过</button>`;
    else if (c.result === 'pending') f = `<span class="hint grow">${I('eye', 'sm')} 等待验收；验收通过后这一步才完成</span>`;
    else if (c.result === 'accepted') f = `<span class="grow"></span><button class="btn secondary" data-act="tab" data-tab="attempts">查看产出</button>`;
    else if (c.ended) f = `<span class="hint grow">等待结果提交 · 传输结束不等于完成</span>`;
    else f = S.tab === 'session' ? `<span class="hint grow">${I('lock', 'sm')} 查看记录不会启动、暂停或改变执行</span>` : `<span class="grow"></span><button class="btn primary" data-act="tab" data-tab="session">${I('terminal', 'sm')}查看执行现场</button>`;
    return `<div class="side-foot">${f}</div>`;
  }
  const TABS = [['overview', '概览'], ['session', '执行现场'], ['attempts', '尝试与产出']];
  function tabsHTML(show) {
    if (!show) return '';
    return `<div class="tabs" role="tablist" aria-label="步骤详情" style="padding:0 12px;flex:none">${TABS.map(([k, l]) => `<button class="tab" role="tab" id="tab-${k}" aria-selected="${S.tab === k}" aria-controls="tabpanel" tabindex="${S.tab === k ? 0 : -1}" data-act="tab" data-tab="${k}">${l}</button>`).join('')}</div>`;
  }

  /* ---------- 13. 概览 ---------- */
  function artsFor(no) {
    const all = F.ATTEMPTS[no] ? F.ATTEMPTS[no].arts : [];
    if (no === 3 && CUR.result === 'none' && !CUR.ended) return ['a-svc'];
    if (no === 3 && CUR.result === 'none') return ['a-svc', 'a-log'];
    return all;
  }
  const AV = { code: ['可阅读', 'st-ok', 'eye'], md: ['可阅读', 'st-ok', 'eye'], json: ['可阅读', 'st-ok', 'eye'], text: ['可阅读', 'st-ok', 'eye'], bin: ['不能预览', 'st-idle', 'minus'], pending: ['尚未生成', 'st-wait', 'clock'], missing: ['不存在', 'st-danger', 'alert'], denied: ['无权读取', 'st-idle', 'lock'], readfail: ['读取失败', 'st-danger', 'alert'], expired: ['已失效', 'st-unknown', 'help'] };
  function overview(n, s, c) {
    if (S.project === 'B') return `<div class="sec"><div class="lockline">${I('info', 'sm')}<span>这个示例项目只用来演示项目切换，没有样例执行记录。</span></div></div>`;
    let top = '';
    if (n.id === 'n2') {
      if (c.hist && S.view === 1) top = `<div class="reason" style="background:var(--warn-fill)"><b style="color:var(--warn)">尝试 #1 · 失败原因</b><br>构建失败：RefundAmount 类型不匹配（TS2322）。这次尝试没有提交结果，也没有进入验收。</div>`;
      else if (c.hist) top = `<div class="reason" style="background:var(--fill-2)"><b>尝试 #2 · 已取消</b><br>结果 r2 未通过验收（缺少幂等键），之后你在 10:33 停止了这次尝试。</div>`;
      else if (c.loading) top = `<div class="reason" style="background:var(--unknown-fill);border:1px dashed var(--unknown-line)"><b style="color:var(--unknown)">正在读取当前尝试</b><br>读取完成前不显示结果或验收结论，也不会用历史尝试的内容代替。</div>`;
      else if (c.conn === 'down' || c.conn === 'reconnecting') top = `<div class="reason" style="background:var(--unknown-fill);border:1px dashed var(--unknown-line)"><b style="color:var(--unknown)">数据连接已断开</b><br>这里显示的是 10:44:05 读到的状态。模型是否仍在执行，以服务状态为准，目前未知。</div>`;
      else if (c.status === 'fail') top = `<div class="reason" style="background:var(--warn-fill)"><b style="color:var(--warn)">失败原因</b><br>模型服务中止了输出（upstream_aborted · 10:43:31）。已收到的正文保留在执行现场。<div class="hint" style="margin-top:6px">已用尝试 3 次；恢复前不会自动重试。</div></div>`;
      else if (c.result === 'rejected') top = `<div class="reason" style="background:var(--warn-fill)"><b style="color:var(--warn)">验收未通过</b><br>结果 r3 · 验收策略 v3：旧接口 POST /refund 仍可绕过幂等键（规则 R4）。</div>`;
      else if (c.result === 'manual') top = `<div class="reason" style="background:var(--wait-fill)"><b style="color:var(--wait)">请确认结果 r3 是否达到目标</b><br>验收策略 v3 要求人工确认退款接口的幂等行为。<div class="row wrap" style="margin-top:10px;gap:6px"><button class="btn secondary sm" data-open-art="a-notes">${I('file', 'sm')}实现说明</button><button class="btn secondary sm" data-open-art="a-result">${I('braces', 'sm')}结构化结果</button></div></div>`;
      else if (c.result === 'pending') top = `<div class="reason" style="background:var(--wait-fill)"><b style="color:var(--wait)">结果已提交，等待验收</b><br>结果 r3 · 验收策略 v3。验收通过前这一步没有完成。</div>`;
      else if (c.status === 'cancel-unknown' || c.result === 'receipt-unknown') top = `<div class="reason" style="background:var(--unknown-fill);border:1px dashed var(--unknown-line)"><b style="color:var(--unknown)">${c.status === 'cancel-unknown' ? '停止请求的结果未知' : '结果提交的回执未知'}</b><br>原记录保持不变；请在页脚“核对原操作”，界面不会重新发送。</div>`;
      else if (c.status === 'cancelling') top = `<div class="lockline">${I('clock', 'sm')}<span><b class="ink">已请求停止，等待执行器确认。</b>确认前这一步可能仍在执行，新的记录仍会出现在执行现场。</span></div>`;
      else if (c.status === 'cancelled') top = `<div class="lockline">${I('stop', 'sm')}<span><b class="ink">这一步已停止。</b>执行器 10:45:58 确认；已收到的正文与工具记录保留。</span></div>`;
      else if (c.ended && c.result === 'none') top = `<div class="reason" style="background:var(--fill-2)"><b>正文传输已结束，结果尚未提交</b><br>这不代表这一步已完成；完成以结果提交与验收为准。</div>`;
    }
    const no = c.hist ? S.view : 3, A = F.ATTEMPTS[no];
    const toolsN = c.model ? c.model.items.filter((x) => x.k === 'tool').length : 0;
    const arts = n.id === 'n2' ? artsFor(no) : [];
    const outRow = n.id === 'n2' ? (c.loading ? `<div class="att"><span class="skel" style="height:12px;width:60%"></span></div>` : arts.map((id) => { const a = F.ARTS[id], av = AV[a.kind]; return `<div class="att">${I(a.kind === 'json' ? 'braces' : a.kind === 'code' ? 'code' : 'file', 'sm')}<span class="grow" style="min-width:0"><div class="ellipsis">${esc(a.name)} <span class="muted mono" style="font-size:12px">@ ${a.rev}</span></div><div class="hint">${a.type} · ${esc(a.from)}</div></span>${a.kind === 'code' || a.kind === 'md' || a.kind === 'json' || a.kind === 'text' ? '' : `<span class="badge ${av[1]}" style="height:20px;font-size:11px">${av[0]}</span>`}<button class="btn ghost sm" data-open-art="${id}">打开</button></div>`; }).join('') + (no === 3 && CUR.result === 'none' ? `<p class="hint" style="margin-top:6px">结果尚未提交：这里只列出执行中已产生的文件，不代表最终产出。</p>` : ''))
      : `<div class="att">${I('file', 'sm')}<span class="grow">${esc(n.output)}</span><span class="hint">${s === 'done' ? '已产出' : '尚未产出'}</span></div>`;
    const curAtt = n.id === 'n2' && !c.loading ? `<div class="sec"><div class="sec-t">${c.hist ? '所查看的尝试' : '当前尝试'}</div><div class="att"><span class="grow"><div style="font-weight:500">尝试 #${no} <span class="tag ${c.hist ? '' : 'cur'}" style="margin-left:4px">${c.hist ? '历史' : '当前'}</span></div><div class="hint">开始于 ${A.start}${(A.end || (no === 3 && CUR.endT)) ? ' · 结束于 ' + (A.end || CUR.endT) : ''} · 定义修订 ${A.rev} · 执行代次 ${A.gen}</div></span>${badge(ATT_ST[c.status] || ATT_ST.run)}</div>
      <div class="stat"><div><div class="k">工具调用（已记录）</div><div class="v num">${toolsN}</div></div><div><div class="k">尝试次数</div><div class="v num">3</div></div><div><div class="k">结果与验收</div><div class="v" style="font-size:13px;color:var(--${(RES_ST[c.result] || RES_ST.none)[1].replace('st-', '').replace('fail', 'warn')})">${(RES_ST[c.result] || RES_ST.none)[0]}</div></div></div>
      <p class="hint" style="margin-top:8px">只列服务记录的事实，不估算进度；正文没有可信总量，不显示百分比。</p></div>` : '';
    return `${top ? `<div class="sec">${top}</div>` : ''}${curAtt}
      <div class="sec"><div class="sec-t">这一步做什么</div><p style="font-size:13.5px;line-height:1.7;color:var(--ink-2)">${esc(n.what)}</p></div>
      <div class="sec"><div class="sec-t">谁来做</div><div class="att"><span class="cv-av" style="width:28px;height:28px;background:var(--accent-fill);color:var(--accent)">${n.role === '人工' ? I('users', 'sm') : esc(n.role[0])}</span><span class="grow">${esc(n.role)}<div class="hint">执行时冻结的职业 · 形象记录缺失时显示占位</div></span></div></div>
      <div class="sec"><div class="sec-t">产出${n.id === 'n2' ? ` · 尝试 #${no}` : ''}</div><div class="col" style="gap:6px">${outRow}</div></div>`;
  }

  /* ---------- 14. 执行现场：事实条 / 组合说明 / 提示 ---------- */
  function facets(c) {
    const items = c.model ? c.model.items : [];
    const stale = ['down', 'reconnecting', 'backfilling'].includes(c.conn);
    const F5 = [];
    const conn = c.hist ? ['历史记录 · 不更新', 'idle', 'lock'] : { ok: ['已连接', 'ok', 'link'], down: ['已断开', 'danger', 'unplug'], reconnecting: ['重新连接中', 'wait', 'spin'], backfilling: ['补读中', 'accent', 'spin'], backfilled: ['已连接 · 已补读', 'ok', 'link'] }[c.conn] || ['已连接', 'ok', 'link'];
    F5.push({ k: '数据连接', v: conn[0], c: conn[1], i: conn[2] });
    const txts = items.filter((x) => x.k === 'txt'), tools = items.filter((x) => x.k === 'tool');
    const last = items.filter((x) => x.k === 'txt' || x.k === 'tool').slice(-1)[0];
    let body;
    if (c.loading) body = ['读取中', 'idle', 'spin'];
    else if (!txts.length) body = ['尚无正文', 'idle', 'minus'];
    else if (c.status === 'fail') body = ['传输中断', 'warn', 'alert'];
    else if (c.status === 'cancelled' || c.status === 'cancel') body = ['已停止', 'idle', 'stop'];
    else if (c.ended || c.hist) body = ['传输结束', 'idle', 'stop'];
    else if (last && last.k === 'tool' && ['queued', 'running'].includes(last.st)) body = ['等待工具返回', 'wait', 'clock'];
    else body = ['正在生成', 'run', 'play'];
    F5.push({ k: '模型正文', v: body[0], c: body[1], i: body[2], stale: stale && !c.loading });
    let tl;
    if (c.loading) tl = ['读取中', 'idle', 'spin'];
    else if (!tools.length) tl = ['无', 'idle', 'minus'];
    else if (tools.some((x) => x.st === 'unknown')) tl = ['结果未知', 'unknown', 'help'];
    else if (tools.some((x) => x.st === 'running')) tl = [`${tools.filter((x) => x.st === 'running').length} 个运行中`, 'run', 'spin'];
    else if (tools.some((x) => x.st === 'queued')) tl = ['1 个排队', 'wait', 'clock'];
    else tl = ['全部结束', 'idle', 'check'];
    F5.push({ k: '工具', v: tl[0], c: tl[1], i: tl[2], stale: stale && !c.loading });
    const a = c.loading ? ['读取中', 'st-idle', 'spin'] : (ATT_ST[c.status] || ATT_ST.run);
    F5.push({ k: c.hist ? `尝试 #${c.no}` : '尝试 #3', v: a[0], c: a[1].replace('st-', '').replace('fail', 'warn'), i: a[2], w3: true, stale: stale && !c.loading });
    const r = c.loading ? ['读取中', 'st-idle', 'spin'] : c.hist && c.no === 1 ? ['未提交 · 未进入验收', 'st-idle', 'minus'] : c.hist ? ['r2 · 未通过', 'st-fail', 'x'] : (RES_ST[c.result] || RES_ST.none);
    F5.push({ k: '结果与验收', v: r[0], c: r[1].replace('st-', '').replace('fail', 'warn'), i: r[2], w3: true, stale: stale && !c.loading });
    return `<div class="facets" role="group" aria-label="执行事实">${F5.map((f) => `<div class="facet ${f.w3 ? 'w3' : ''} ${f.c === 'unknown' ? 'unk' : ''}"><div class="k">${f.k}${f.stale ? '<span class="stale-tag" title="连接断开前读到的值">过时</span>' : ''}</div><div class="v" style="color:var(--${f.c === 'accent' ? 'accent' : f.c})">${f.i === 'spin' ? '<span class="spin"></span>' : I(f.i, 'sm')}<span>${f.v}</span></div></div>`).join('')}</div>`;
  }
  function combo(c) {
    let t;
    if (c.hist) t = `这是尝试 #${c.no} 的固定记录：只读，不会追加，也不会触发任何执行。`;
    else if (c.loading) t = c.kind === 'back-loading' ? '已回到当前尝试：正在读取尝试 #3 的最新记录，读取完成前不显示结论，也不用尝试 #1 的内容顶替。' : '正在读取这一步的执行记录。';
    else if (c.conn === 'down') t = '<b>数据连接已断开（10:44:05）。</b>下方是断开前收到的记录，已标为过时。<br><b>模型是否仍在执行：</b>以服务状态为准，目前未知。';
    else if (c.conn === 'reconnecting') t = '<b>正在重新连接数据通道。</b>重连成功只代表数据恢复，不代表模型仍在执行。';
    else if (c.conn === 'backfilling') t = '<b>正在按服务序号补读断开期间的记录。</b>补读完成前，内容可能还不是最新；重复的片段会被去重。';
    else if (c.status === 'fail') t = '<b>执行失败。</b>已收到的正文保留可读；失败不会被显示成完成。';
    else if (c.status === 'cancelling') t = '<b>已请求停止，执行器尚未确认。</b>取消请求不等于已停止，确认前仍可能有新记录。';
    else if (c.status === 'cancelled') t = '执行器已确认停止；已收到的正文与工具记录保留。';
    else if (c.status === 'cancel-unknown') t = '<b>停止请求的结果未知。</b>请核对原操作；界面不会重复发送停止。';
    else if (c.result === 'receipt-unknown') t = '<b>结果提交的回执未知。</b>服务还没确认是否收到，界面不会重发，也不会显示成已提交。';
    else if (c.result === 'accepted') t = '结果 r3 已提交，并按验收策略 v3 <b>验收通过</b>：这一步已完成。';
    else if (c.result === 'rejected') t = '正文与执行都已结束，但结果 r3 <b>验收未通过</b>：这一步没有完成。';
    else if (c.result === 'manual') t = '结果 r3 已提交，需要你<b>人工验收</b>；在此之前这一步没有完成。';
    else if (c.result === 'pending') t = '结果 r3 已提交，<b>等待验收</b>；验收通过后这一步才算完成。';
    else if (c.ended) t = '<b>正文传输已结束，结果尚未提交</b>——这不代表这一步已完成。';
    else {
      const items = c.model.items, last = items.filter((x) => x.k === 'txt' || x.k === 'tool').slice(-1)[0];
      if (!items.some((x) => x.k === 'txt')) t = '尝试已开始，模型还没有输出正文；这不是错误，也不是完成。';
      else if (last && last.k === 'tool' && ['queued', 'running'].includes(last.st)) t = `正文暂停，<b>等待工具返回</b>（${esc(F.TOOLS[last.id].name)} #${last.id}）；工具结果以服务记录为准。`;
      else t = '模型正在生成正文；结果尚未提交，这一步仍在执行。';
      if (c.conn === 'backfilled') t = '<b>数据连接已恢复。</b>' + (c.gap ? '有 1 段记录服务未保留，已标出缺口。' : '断开期间的记录已补读。') + '<br><b>模型仍在执行</b>（服务状态 10:45:20）。';
    }
    return `<div class="combo" id="combo">${I('info', 'sm')}<span>${t}</span></div>`;
  }
  function sessBanner(c) {
    if (c.hist || c.loading) return '';
    const ck = CHECK[c.check];
    if (c.status === 'cancel-unknown' || c.result === 'receipt-unknown') {
      const what = c.status === 'cancel-unknown' ? '停止请求 · 10:45:40 发出' : '结果提交 · 10:48:31 发出';
      return `<div class="banner unknown sess-banner" role="status">${I('help')}<div><b>原操作：${what}</b><br>${ck === 'loading' ? '正在按原操作编号读取服务记录…' : ck ? `<span>${ck}</span>` : '没有收到回执。核对只读取原操作的状态，不会重发。'}</div><div class="actions"><button class="btn secondary sm" data-act="check" ${ck === 'loading' ? 'disabled' : ''}>${ck === 'loading' ? '<span class="spin"></span>' : I('refresh', 'sm')}核对原操作</button></div></div>`;
    }
    if (c.conn === 'down') return `<div class="banner unknown sess-banner" role="status">${I('unplug')}<div><b>内容可能不是最新</b> · 断开前的记录保留</div><div class="actions"><button class="btn secondary sm" data-act="reconnect">${I('refresh', 'sm')}重新连接</button></div></div>`;
    return '';
  }

  /* ---------- 15. 执行现场：记录条目 ---------- */
  const TOOL_ST = { queued: ['排队', 'st-idle', 'clock'], running: ['运行中', 'st-run', 'spin'], ok: ['成功', 'st-done', 'check'], fail: ['失败', 'st-fail', 'x'], cancel: ['已取消', 'st-idle', 'stop'], unknown: ['结果未知', 'st-unknown', 'help'] };
  const SRC = { mcp: ['受管 MCP', 'mcp', '来自受管 MCP 结算记录'], oc: ['OpenCode 工具', '', '来自 OpenCode 工具活动记录'] };
  const timeCell = (t) => t ? `<div class="tt">${t}</div>` : `<div class="tt unk">时间未知</div>`;
  function itemHTML(it, c) {
    const stale = ['down', 'reconnecting', 'backfilling'].includes(c.conn) && !it.bf ? 'stale' : '';
    const bfTag = it.bf || it.bfUpd ? '<span class="bf-tag">补读</span>' : '';
    if (it.k === 'gap') return `<div class="gap" data-id="${it.id}" role="separator"><span>${I('alert', 'sm')}${it.from}–${it.to} 的记录无法补读（服务未保留）</span></div>`;
    let body = '';
    if (it.k === 'txt') {
      const live = !c.hist && c.status === 'run' && !it.done && !c.ended && !stale;
      body = `<div class="blk-h"><span class="blk-l">模型正文</span>${bfTag}<span class="grow"></span><button class="icon-btn xs" data-copy-item="${it.id}" aria-label="复制这段模型正文">${I('copy', 'sm')}</button></div>
        <div class="md">${mdRender(it.md, { caret: live, live, key: it.id })}</div>
        ${!it.done && !live && (c.status === 'fail' || c.hist || c.status === 'cancelled') ? `<div class="cut">${I('alert', 'sm')}正文在此中断 · 未完整</div>` : ''}`;
    } else if (it.k === 'rsn') {
      const long = it.text.length > 90 || it.text.split('\n').length > 3, open = EXP.has('rsn:' + it.id);
      body = `<div class="rsn ${long && !open ? 'clamp' : ''}"><div class="blk-h"><span class="blk-l">公开推理摘要 · 由模型服务提供</span>${bfTag}<span class="grow"></span><button class="icon-btn xs" data-copy-item="${it.id}" aria-label="复制这段公开推理摘要">${I('copy', 'sm')}</button></div>
        <div class="rs-text">${esc(it.text)}</div>${long ? `<button class="rs-more" data-rsn="${it.id}" aria-expanded="${open}">${I(open ? 'chevDown' : 'chevRight', 'sm')}${open ? '收起' : '展开全部'}</button>` : ''}</div>`;
    } else if (it.k === 'tool') {
      const T = F.TOOLS[it.id], ts = TOOL_ST[it.st], src = SRC[T.src];
      const resLine = it.st === 'ok' || it.st === 'fail' ? `<span class="v">${esc(T.res)}</span>` : it.st === 'unknown' ? '<span class="v muted">没有记录到结果</span>' : it.st === 'cancel' ? '<span class="v muted">执行器停止时仍在运行</span>' : '<span class="v muted">等待服务返回结果</span>';
      let note = '';
      if (it.late) note = `<div class="tc-note">${I('clock', 'sm')}结果于 ${it.late} 返回（晚于后续正文）</div>`;
      if (it.note === 'gap') note = `<div class="tc-note unk">${I('help', 'sm')}结果可能落在 ${c.gap || '10:44:12–10:44:38'} 的缺口内，服务未保留，无法补读</div>`;
      if (it.note === 'failed') note = `<div class="tc-note unk">${I('help', 'sm')}尝试失败时这次调用仍在运行，服务没有记录它的结果</div>`;
      body = `<button class="tc" data-tool="${it.id}" aria-label="查看工具调用 ${esc(T.name)} #${it.id} 的详情">
        <div class="tc-h"><span class="nm">${esc(T.name)}</span><span class="src-tag ${src[1]}">${src[0]}</span><span class="id">#${it.id}</span>${bfTag}<span class="grow"></span><span class="badge ${ts[1]}">${ts[2] === 'spin' ? '<span class="spin"></span>' : I(ts[2], 'sm')}${ts[0]}</span></div>
        <div class="tc-l"><span class="k">参数</span><span class="v">${esc(T.args)}</span></div>
        <div class="tc-l"><span class="k">结果</span>${resLine}</div>${note}</button>`;
    } else if (it.k === 'err') {
      body = `<div class="sv err">${I('alert', 'sm')}<span><b>执行失败</b> · ${esc(it.text)}</span></div>`;
    } else {
      body = `<div class="sv ${it.tone || ''}">${I(it.icon || 'info', 'sm')}<span>${it.text}${bfTag}</span></div>`;
    }
    return `<div class="ti ${stale} ${it.bf ? 'bf' : ''}" data-id="${it.id}">${timeCell(it.t)}<div class="tm">${body}</div></div>`;
  }
  function aboutHTML(c) {
    const noRsn = !c.model.items.some((x) => x.k === 'rsn');
    const src = c.hist ? `尝试 #${c.no} 的固定记录 · 按服务顺序 · 只读，不再追加` : '按服务记录顺序 · 来源：模型服务（正文、公开推理摘要）、OpenCode 工具活动、受管 MCP 结算';
    return `<div class="tx-about">${I('info', 'sm')}<span>${src}${noRsn ? ' · <b style="color:var(--sub);font-weight:500">本次未提供公开推理摘要</b>' : ''}。时间为服务记录时间。</span></div>`;
  }
  function txBodyHTML(c) {
    if (c.hist && S.view === 1 && CFG.retention) return `<div class="tx-empty"><span class="tile" style="color:var(--unknown)">${I('archive', 'lg')}</span><h3>这次尝试的执行现场未保留</h3><p>服务只保留最近 7 天的正文与工具记录。尝试 #1 的状态、时间与失败原因仍可在“尝试与产出”查看。</p></div>`;
    if (c.loading) return `<div style="padding:6px 0">${[86, 64, 92, 40].map((w, i) => `<div class="ti"><div class="skel" style="height:11px;width:44px;margin-top:4px"></div><div><div class="skel" style="height:12px;width:${w}%"></div>${i % 2 ? '' : '<div class="skel" style="height:12px;width:56%;margin-top:8px"></div>'}</div></div>`).join('')}</div>`;
    const items = c.model.items;
    const hasTxt = items.some((x) => x.k === 'txt' || x.k === 'tool' || x.k === 'rsn');
    return aboutHTML(c) + `<div id="txItems">${items.map((it) => itemHTML(it, c)).join('')}</div>` + (hasTxt ? '' : `<div class="tx-empty" id="txEmpty"><span class="tile">${I('doc', 'lg')}</span><h3>模型还没有输出正文</h3><p>尝试 #3 已于 10:42:01 开始。正文到达后会按服务顺序显示在这里；这不是错误，也不是完成。</p></div>`);
  }
  function session(c) {
    if (c.revoked) return `<div class="side-body"><div class="lock" style="margin-top:6px"><span class="tile">${I('lock', 'lg')}</span><h3>你已无权查看此尝试的记录</h3><p>读取时服务返回无权限。之前显示的正文、工具与结果已从这个面板清除，不保留缓存。</p><p class="hint">如需查看，请联系项目负责人确认你的访问范围。</p></div></div>`;
    if (S.lateNote && c.node === 'n3' && c.loading) return `<div class="side-body sess"><div class="sess-top"><div class="banner sess-banner" style="margin-top:0">${I('info')}<div>已忽略属于上一个节点（实现接口）的晚到内容</div></div></div><div class="tx-wrap"><div class="tx">${txBodyHTML(c)}</div></div></div>`;
    return `<div class="side-body sess" role="tabpanel" id="tabpanel" aria-labelledby="tab-session">
      <div class="sess-top">${facets(c)}${combo(c)}${sessBanner(c)}</div>
      <div class="tx-wrap"><div class="tx" id="tx" tabindex="0" role="log" aria-live="${c.hist ? 'off' : 'polite'}" aria-label="执行记录">${txBodyHTML(c)}</div>
        ${c.hist || c.loading || !c.live ? '' : `<div class="follow" id="follow"></div><button class="newpill" id="newpill" hidden data-act="to-latest"></button>`}
      </div></div>`;
  }

  /* ---------- 16. 跟随最新 ---------- */
  const TX = {
    el: null, key: null, follow: true, paused: false, newCount: 0, dirty: false, lastTop: 0,
    attach(el, key, init) {
      this.el = el; this.key = key;
      const m = MEM.get(key);
      if (m) {
        Object.assign(this, { follow: m.follow, paused: m.paused, newCount: m.newCount, dirty: m.dirty });
        if (m.follow && !m.paused && m.atBottom) this.toBottom(false); else el.scrollTop = m.top;
      } else {
        const t = init || {};
        this.follow = t.follow !== false; this.paused = !!t.paused; this.newCount = 0; this.dirty = false;
        if (t.scroll === 'top') el.scrollTop = 0;
        else if (t.scroll === 'middle') el.scrollTop = Math.max(0, (el.scrollHeight - el.clientHeight) * 0.45);
        else if (t.scroll === 'card') { const n = t.card === '@gap' ? el.querySelector('.gap') : el.querySelector(`[data-id="${t.card}"]`); if (n) el.scrollTop = t.card === '@gap' ? n.offsetTop - el.clientHeight * 0.45 : n.offsetTop - 12; (t.flash || []).forEach((id) => { const x = el.querySelector(`[data-id="${id}"]`); if (x) x.classList.add('flash'); }); this.paused = true; }
        else this.toBottom(false);
      }
      this.lastTop = el.scrollTop;
      el.addEventListener('scroll', () => { if (this.el === el) this.onScroll(); }, { passive: true });
      this.ui();
    },
    detach() { if (!this.el || !this.el.isConnected) { this.el = null; return; } this.save(); this.el = null; },
    save() { if (!this.el) return; MEM.set(this.key, { top: this.el.scrollTop, follow: this.follow, paused: this.paused, newCount: this.newCount, dirty: this.dirty, atBottom: this.dist() < 8 }); },
    dist() { const e = this.el; return e.scrollHeight - e.scrollTop - e.clientHeight; },
    onScroll() {
      const top = this.el.scrollTop, d = this.dist();
      if (this.follow && !this.paused && top < this.lastTop - 2 && d > 80) { this.paused = true; this.ui(); }
      if (d < 8 && (this.paused || this.newCount || this.dirty)) { if (this.follow) this.paused = false; this.newCount = 0; this.dirty = false; this.ui(); }
      this.lastTop = top;
    },
    toBottom(smooth) { const e = this.el; if (!e) return; e.scrollTo({ top: e.scrollHeight, behavior: smooth && !S.reduced ? 'smooth' : 'auto' }); },
    content(isNew) {
      if (!this.el) return;
      if (this.follow && !this.paused) { this.toBottom(true); return; }
      if (isNew) this.newCount++; else this.dirty = true;
      this.ui();
    },
    pin() { if (this.follow && !this.paused) { this.paused = true; this.ui(); } },
    setFollow(v) { this.follow = v; this.paused = false; if (v) { this.newCount = 0; this.dirty = false; this.toBottom(true); } this.ui(); toast(v ? '已开启跟随最新' : '已关闭跟随：不会自动滚动，只提示新内容数量', 'info'); },
    latest() { this.newCount = 0; this.dirty = false; if (this.follow) this.paused = false; this.toBottom(true); this.ui(); },
    ui() {
      const f = $('#follow'), p = $('#newpill');
      if (f) f.innerHTML = `<span>跟随最新</span>${this.follow && this.paused ? '<span class="st">· 已暂停</span>' : ''}<button class="switch" role="switch" aria-checked="${this.follow}" aria-label="跟随最新" data-act="follow"></button>`;
      if (p) {
        const show = this.newCount > 0 || this.dirty || (this.follow && this.paused);
        p.hidden = !show;
        p.innerHTML = `${I('chevDown', 'sm')}${this.newCount ? `有 ${this.newCount} 条新内容 · 回到最新` : this.dirty ? '有新内容 · 回到最新' : '回到最新'}`;
      }
    },
  };

  /* ---------- 17. 尝试与产出 ---------- */
  let pageState = CFG.pageFail ? 'fail' : 'all';
  function attRow(no, c) {
    const A = F.ATTEMPTS[no], cur = no === 3;
    const st = cur ? (CUR.loading ? ['读取中', 'st-idle', 'clock'] : ATT_ST[CUR.status] || ATT_ST.run) : ATT_ST[A.status];
    const reason = cur ? ({ run: CUR.ended ? '正文传输已结束，结果尚未提交' : '正在执行：最近一条记录 ' + (((CUR.model && CUR.model.items.slice(-1)[0]) || {}).t || '时间未知'), fail: '模型服务中止了输出（upstream_aborted）', cancelling: '已请求停止，等待执行器确认', cancelled: '你在 10:45 停止了这次尝试', 'cancel-unknown': '停止请求的结果未知', ended: '结果 r3 · ' + (RES_ST[CUR.result] || RES_ST.none)[0], done: '结果 r3 · 验收通过（策略 v3）' }[CUR.status] || '') : A.reason;
    const notRet = no === 1 && CFG.retention;
    return `<div class="att-row ${cur ? 'cur' : ''}"><div><div class="t">尝试 #${no}<span class="tag ${cur ? 'cur' : ''}">${cur ? '当前' : '历史'}</span>${notRet ? '<span class="tag unk">详细记录未保留</span>' : ''}${badge(st, 'style="height:20px;font-size:11px"')}</div>
      <div class="m">${cur ? `开始于 ${A.start}${CUR.status === 'run' ? ' · 进行中' : ''}` : `${A.start} – ${A.end}`} · 定义修订 ${A.rev} · 执行代次 ${A.gen}</div></div>
      <div class="act"><button class="btn ghost sm" data-view-att="${no}">查看</button></div>
      <div class="why">${esc(reason)}</div></div>`;
  }
  function attempts(n, s, c) {
    if (n.id !== 'n2' || S.project === 'B') return `<div class="att-row cur"><div><div class="t">尝试 #1<span class="tag cur">当前</span>${badge(ATT_ST[s === 'done' ? 'done' : s] || ATT_ST.run, 'style="height:20px;font-size:11px"')}</div><div class="m">定义修订 v${n.id === 'n1' ? 2 : 3} · 执行代次 1</div></div><div class="act"><button class="btn ghost sm" data-act="proto" data-msg="单次详情（原型只为“实现接口”展开）">查看</button></div></div>`;
    let rows = [3, 2].map((no) => attRow(no)).join('');
    let end;
    if (pageState === 'fail') end = `<div class="banner danger" role="alert" style="margin-top:12px">${I('alert')}<div><b>加载更早的尝试失败</b><br>已加载的 2 次尝试保留；重试只重新读取列表，不会启动执行。</div><div class="actions"><button class="btn secondary sm" data-act="page-retry">${I('refresh', 'sm')}重试</button></div></div>`;
    else if (pageState === 'loading') end = `<div class="list-end"><span class="spin"></span>正在加载更早的尝试…</div>`;
    else {
      rows += attRow(1);
      end = CFG.retention ? `<div class="box dashed" style="margin-top:12px;font-size:12.5px;line-height:1.6;color:var(--ink-2)"><b style="color:var(--unknown);font-weight:500">${I('archive', 'sm')} 记录范围</b><br>服务只保留最近 7 天的正文与工具记录。尝试 #1 的执行现场已超出保留期，只保留状态、时间、失败原因与结果摘要；更早的尝试记录未保留。</div>`
        : `<div class="list-end">${I('check', 'sm')}已显示全部 3 次尝试 · 最早一次为尝试 #1</div>`;
    }
    return `<div class="col" style="gap:0">${rows}</div>${end}
      <p class="hint" style="margin-top:14px">“查看”只读：不会重跑、恢复、推进或验收。执行动作只在页脚，并以当前尝试的服务状态为准。</p>`;
  }

  /* ---------- 18. 单次尝试详情（子视图） ---------- */
  function attDetail(no) {
    const A = F.ATTEMPTS[no], cur = no === 3;
    const c = cur ? CUR : HCTX[no];
    const st = cur ? ATT_ST[CUR.status] || ATT_ST.run : ATT_ST[A.status];
    const prev = no > 1 ? no - 1 : null, next = no < 3 ? no + 1 : null;
    const head = `<div class="sub-head"><button class="btn ghost sm" data-act="sub-back">${I('chevLeft', 'sm')}尝试列表</button><span class="grow"></span>
      <span class="att-switch" role="group" aria-label="切换尝试"><button class="icon-btn" ${prev ? `data-view-att="${prev}"` : 'disabled style="opacity:.35"'} aria-label="上一次尝试">${I('chevLeft', 'sm')}</button>${prev ? `#${prev}` : ''}<b>尝试 #${no}</b>${next ? `#${next}` : ''}<button class="icon-btn" ${next ? `data-view-att="${next}"` : 'disabled style="opacity:.35"'} aria-label="下一次尝试">${I('chevRight', 'sm')}</button></span></div>`;
    // 结果
    let result;
    const curHasResult = ['pending', 'accepted', 'rejected', 'manual'].includes(CUR.result);
    if (cur) result = curHasResult ? `<div class="box"><div class="row"><b style="font-weight:500">结果版本 r3</b><span class="hint">已提交 10:48:31</span></div><div class="jt" style="padding:8px 0 0">${jnode(F.RESULT_R3, null, true, 1)}</div></div>`
      : CUR.result === 'receipt-unknown' ? `<div class="box dashed"><b style="color:var(--unknown);font-weight:500">结果提交回执未知</b><div class="hint" style="margin-top:4px">10:48:31 发出的提交没有回执；核对前不显示结果内容。</div></div>`
        : `<div class="box"><span class="sub">这次尝试还没有提交结果</span></div>`;
    else if (A.result) result = `<div class="box"><div class="row"><b style="font-weight:500">结果版本 ${A.result.rev}</b><span class="hint">已提交 ${A.result.at}</span></div><div class="jt" style="padding:8px 0 0">${jnode(A.result.value, null, true, 1)}</div>
      <div class="replaced">${I('info', 'sm')}${curHasResult ? '已被尝试 #3 的结果 r3 替代' : '未被采用：验收未通过'}</div></div>`;
    else result = `<div class="box"><span class="sub">这次尝试没有提交结果</span></div>`;
    // 验收
    let acc;
    const ACC = { accepted: ['验收通过', 'st-done', 'check'], rejected: ['未通过', 'st-fail', 'x'], manual: ['待人工验收', 'st-wait', 'eye'], pending: ['等待验收', 'st-wait', 'clock'] };
    if (cur) acc = ACC[CUR.result] ? `<div class="box"><div class="row">${badge(ACC[CUR.result])}<span class="grow"></span></div><div class="bind">绑定 <code>结果版本 r3</code><code>验收策略 v3</code></div>${CUR.result === 'rejected' ? '<p class="hint" style="margin-top:6px">规则 R4：旧接口 POST /refund 仍可绕过幂等键。</p>' : ''}</div>` : `<div class="box"><span class="sub">这次尝试还没有进入验收</span></div>`;
    else if (A.acceptance) acc = `<div class="box"><div class="row">${badge(ACC[A.acceptance.status])}<span class="hint">${A.acceptance.at}</span></div><div class="bind">绑定 <code>结果版本 ${A.acceptance.resultRev}</code><code>验收策略 ${A.acceptance.policy}</code></div><p class="hint" style="margin-top:6px">${esc(A.acceptance.detail)}</p></div>`;
    else acc = `<div class="box"><span class="sub">这次尝试未进入验收</span></div>`;
    // 产物
    const arts = (cur ? artsFor(3) : A.arts).map((id) => { const a = F.ARTS[id], av = AV[a.kind]; return `<button class="ref" data-open-art="${id}" data-att="${no}">${I(a.kind === 'json' ? 'braces' : a.kind === 'code' ? 'code' : 'file', 'sm')}<span class="grow">${esc(a.name)} <span class="mono muted" style="font-size:12px">@ ${a.rev}</span><div class="hint">${a.type} · ${a.kind === 'expired' ? `${a.rev} 已被替代，内容不再提供` : esc(a.from)}</div></span><span class="badge ${av[1]}" style="height:20px;font-size:11px">${av[0]}</span>${I('chevRight', 'sm')}</button>`; }).join('');
    const errs = cur ? (CUR.status === 'fail' ? [['error', '模型服务中止了输出（upstream_aborted · 10:43:31）。']] : []) : A.errors;
    const notRet = no === 1 && CFG.retention;
    return head + `<div class="side-body">
      <div class="sec"><div class="row" style="gap:8px"><span style="font-size:15px;font-weight:500">尝试 #${no}</span><span class="tag ${cur ? 'cur' : ''}">${cur ? '当前' : '历史 · 只读'}</span>${badge(st)}</div>
        <dl class="kv" style="margin:12px 0 0;grid-template-columns:84px minmax(0,1fr);font-size:13px"><dt>时间</dt><dd>${A.start} – ${A.end || (cur && CUR.endT) || (cur && CUR.status === 'run' ? '进行中' : '结束时间未知')}${(A.end || (cur && CUR.endT)) ? ` · ${dur(A.start, A.end || CUR.endT)}` : ''}</dd><dt>修订</dt><dd>定义修订 ${A.rev} · 执行代次 ${A.gen}</dd><dt>原因</dt><dd>${esc(cur ? (CUR.status === 'fail' ? '模型服务中止了输出' : (RES_ST[CUR.result] || RES_ST.none)[0] === '未提交' ? '进行中 / 尚未提交结果' : '结果 r3 · ' + RES_ST[CUR.result][0]) : A.reason)}</dd></dl></div>
      ${notRet ? `<div class="sec"><div class="banner unknown">${I('archive')}<div><b>执行现场未保留</b><br>正文与工具记录已超出保留期（7 天）；以下状态、结果与验收摘要仍保留。</div></div></div>` : ''}
      <div class="sec"><div class="sec-t">结果</div>${result}</div>
      <div class="sec"><div class="sec-t">验收</div>${acc}</div>
      <div class="sec"><div class="sec-t">产物 · 属于尝试 #${no}</div><div class="refs">${arts || '<span class="hint">没有产物</span>'}</div></div>
      ${errs.length ? `<div class="sec"><div class="sec-t">错误与警告</div><div class="col" style="gap:6px">${errs.map(([k, t]) => `<div class="sv ${k === 'error' ? 'err' : 'wait'}" style="${k === 'error' ? '' : 'padding:8px 10px;border-radius:10px;background:var(--fill-2)'}">${I(k === 'error' ? 'alert' : 'info', 'sm')}<span>${esc(t)}</span></div>`).join('')}</div></div>` : ''}
      <div class="sec"><button class="btn secondary sm" data-act="att-session" data-no="${no}">${I('terminal', 'sm')}查看这次的执行现场</button><p class="hint" style="margin-top:8px">${cur ? '执行动作只在页脚；这里不放恢复、重跑或验收。' : '历史详情只读：没有恢复、重跑、推进或验收按钮。'}</p></div>
    </div>`;
  }

  /* ---------- 19. 工具调用详情（面板子视图 / 宽阅读区共用） ---------- */
  function toolItem(id, no) { const m = no === 3 ? CUR.model : HCTX[no] && HCTX[no].model; return m && m.byId[id]; }
  function toolDetail(id, seg, no, wide) {
    const T = F.TOOLS[id], it = toolItem(id, no) || { st: 'ok', t: T.start, endT: T.end };
    const ts = TOOL_ST[it.st], src = SRC[T.src];
    const endT = ['ok', 'fail', 'cancel'].includes(it.st) ? (it.endT || T.end) : null;
    const d = endT ? dur(it.t || T.start, endT) : null;
    const errSeg = !!T.err;
    seg = seg || 'out';
    const head = `<div class="row wrap" style="gap:8px"><span class="td-name">${esc(T.name)}</span><span class="src-tag ${src[1]}">${src[0]}</span></div>
      <div class="td-meta"><span>调用 ID</span><code>#${id}</code><button class="icon-btn xs" data-copy-raw="${id}" aria-label="复制调用 ID">${I('copy', 'sm')}</button><span>· 所属 <b style="font-weight:500;color:var(--ink-2)">尝试 #${no}</b></span>${badge(ts[2] === 'spin' ? [ts[0], ts[1], 'play'] : ts)}</div>
      <div class="td-time"><div><div class="k">开始</div><div class="v ${it.t ? '' : 'unk'}">${it.t || T.start || '未知'}</div></div><div><div class="k">结束</div><div class="v ${endT ? '' : 'unk'}">${endT || (['running', 'queued'].includes(it.st) ? '尚未结束' : '未知')}</div></div><div><div class="k">时长</div><div class="v ${d ? '' : 'unk'}">${d || '—'}</div></div></div>
      <div class="td-src">${I(T.src === 'mcp' ? 'shield' : 'terminal', 'sm')}${src[2]}</div>
      <div class="td-sum"><div class="tc-l"><span class="k">参数</span><span class="v">${esc(T.args)}</span></div><div class="tc-l"><span class="k">结果</span><span class="v">${it.st === 'unknown' ? '<span class="muted">没有记录到结果</span>' : ['running', 'queued'].includes(it.st) ? '<span class="muted">等待服务返回结果</span>' : esc(T.res)}</span></div></div>`;
    let area;
    if (T.access === 'denied') area = `<div class="lock"><span class="tile">${I('lock', 'lg')}</span><h3>你没有查看此调用完整参数的权限</h3><p>只显示上方的摘要层。完整参数与输出不会在这里、复制或下载中出现。</p></div>`;
    else if (T.access === 'nocap') area = `<div class="lock unk"><span class="tile">${I('help', 'lg')}</span><h3>当前服务尚未提供工具完整参数读取</h3><p>这不是错误：OpenCode 工具活动记录目前只提供摘要。上方摘要来自服务记录；不会显示成“已完整读取”。</p></div>`;
    else {
      const segs = `<div class="seg" role="tablist" aria-label="参数与${errSeg ? '错误' : '结果'}" style="margin-top:16px"><button role="tab" aria-selected="${seg === 'args'}" data-seg="args" data-tool-id="${id}">参数</button><button role="tab" aria-selected="${seg === 'out'}" data-seg="out" data-tool-id="${id}">${errSeg ? I('alert', 'sm') + '错误' : '结果'}</button></div>`;
      const data = seg === 'args' ? T.argv : (T.err || T.out);
      area = segs + viewer(id + ':' + seg, data, { tool: T, seg, wide, st: it.st });
    }
    const refs = (T.refs || []).length ? `<div class="sec" style="margin-top:18px"><div class="sec-t">结果引用</div><div class="refs">${T.refs.map(([l, k, rid]) => `<button class="ref" data-open-${k === 'art' ? 'art' : 'cite'}="${rid}" data-att="${no}">${I(k === 'art' ? 'file' : 'quote', 'sm')}<span class="grow">${esc(l)}</span>${I('chevRight', 'sm')}</button>`).join('')}</div></div>` : '';
    return head + area + refs + `<p class="hint" style="margin-top:18px;padding-top:12px;box-shadow:inset 0 1px 0 var(--line)">${I('info', 'sm')} 执行现场列出的工具不一定是全部工具轨迹：受管 MCP 结算与 OpenCode 工具活动是两类记录来源。这里只查看记录，不提供重新执行。</p>`;
  }
  const FMT = { json: ['JSON', 'braces'], code: ['代码', 'code'], cmd: ['命令输出', 'terminal'], text: ['文本', 'doc'], empty: ['空', 'minus'], bin: ['二进制', 'file'] };
  function viewer(key, d, o) {
    if (!d) return `<div class="vw"><div class="vw-b pad"><span class="sub">服务没有提供这一部分</span></div></div>`;
    const v = VW[key] || (VW[key] = { loaded: Math.min(200, d.total || 0), wrap: false, fails: 0, state: 'ok' });
    const fmt = FMT[d.fmt];
    const chip = `<span class="fmt">${I(fmt[1], 'sm')}${fmt[0]}${d.lang ? ' · TypeScript' : ''}</span>`;
    const size = d.size ? `<span>${esc(d.size)}</span>` : '';
    if (d.fmt === 'empty') return `<div class="vw"><div class="vw-h">${chip}</div><div class="vw-b pad" style="text-align:center;padding:26px 14px"><div class="sub">${I('minus', 'sm')} 工具返回空结果</div><div class="hint" style="margin-top:4px">匹配为空是正常结果，不是错误。</div></div></div>`;
    if (d.fmt === 'bin') return `<div class="vw"><div class="vw-h">${chip}${size}<span class="grow"></span><button class="btn ghost sm" disabled title="服务尚未提供此类产物的下载">${I('download', 'sm')}下载</button></div><div class="vw-b pad" style="text-align:center;padding:26px 14px"><div class="sub">这种格式（${esc(d.mime)} · ${esc(d.size)}）不能在这里预览</div><div class="hint" style="margin-top:4px">下载不可用：服务尚未提供此类产物的下载</div></div></div>`;
    if (d.fmt === 'json') {
      const n = countRed(d.value);
      return `<div class="vw" data-json-key="${key}"><div class="vw-h">${chip}${size}<span class="grow"></span><button class="btn ghost sm" data-jt-all="1">${I('expand', 'sm')}全部展开</button><button class="btn ghost sm" data-jt-all="0">${I('collapse', 'sm')}收起</button><button class="btn ghost sm" data-copy-json="${key}">${I('copy', 'sm')}复制</button></div>
        ${n ? `<div class="vw-note">${I('lock', 'sm')}<span>${n} 个字段已由服务端隐藏，复制与下载同样不含这些值</span></div>` : ''}<div class="vw-b">${jsonTree(d.value)}</div></div>`;
    }
    if (d.fmt === 'text') {
      const body = d.paras === 'design' ? F.DESIGN_PARAS.map(([lb, t]) => `<div class="para"><span class="lb">${lb}</span>${esc(t)}</div>`).join('') : `<p style="font-size:13px;line-height:1.7;color:var(--ink-2)">${esc(d.plain)}</p>`;
      return `<div class="vw"><div class="vw-h">${chip}${size}<span class="grow"></span><button class="btn ghost sm" data-copy-text="${key}">${I('copy', 'sm')}复制</button></div><div class="vw-b pad" style="background:var(--panel)">${body}</div></div>`;
    }
    // 代码 / 命令输出
    const lines = d.plain ? [d.plain] : F.lines(d.file);
    const total = d.plain ? 1 : d.total;
    const shown = d.plain ? lines : lines.slice(0, v.loaded);
    const exit = d.exit != null ? `<span class="exit ${d.exit ? 'bad' : ''}">退出码 ${d.exit}</span>` : '';
    const more = !d.plain && !d.truncated && v.loaded < total;
    const foot = d.plain ? '' : `<div class="vw-foot"><span class="grow">已加载 1–${v.loaded.toLocaleString('en-US')} 行 · 共 ${total.toLocaleString('en-US')} 行${d.truncated ? ' · 服务只保留了这些' : ''}</span>${more ? `<button class="btn secondary sm" data-more="${key}" ${v.state === 'loading' ? 'disabled' : ''}>${v.state === 'loading' ? '<span class="spin"></span>读取中' : `继续读取 ${Math.min(200, total - v.loaded)} 行`}</button>` : ''}</div>`;
    const failB = v.state === 'fail' ? `<div class="banner danger" role="alert">${I('alert')}<div><b>读取失败</b> · 第 ${v.loaded + 1} 行之后的内容没有读到。下面保留已加载的内容。</div><div class="actions"><button class="btn secondary sm" data-retry="${key}">${I('refresh', 'sm')}重新读取</button></div></div><div class="vw-note">${I('clock', 'sm')}<span>以下为 10:52 读取的内容</span></div>` : '';
    const trunc = d.truncated ? `<div class="banner warn" role="status">${I('alert')}<div><b>内容已截断：服务只保留了前 64 KB</b><br>以下是服务保留的全部内容，没有更多可以读取。</div></div>` : '';
    return `<div class="vw"><div class="vw-h">${chip}${size}${exit}<span class="grow"></span><button class="btn ghost sm" data-wrap="${key}" aria-pressed="${v.wrap}">${I('wrap', 'sm')}自动换行${v.wrap ? ' · 开' : ''}</button><button class="btn ghost sm" data-copy-lines="${key}">${I('copy', 'sm')}复制</button></div>
      ${trunc}${failB}<div class="vw-b">${codeHTML(shown, { lang: d.lang || (d.fmt === 'cmd' && o.seg === 'args' ? 'sh' : ''), wrap: v.wrap, errLines: d.fmt === 'cmd', label: fmt[0] })}</div>${foot}</div>`;
  }

  /* ---------- 20. 宽阅读区 ---------- */
  function readerList(R) {
    const no = R.att;
    if (R.kind === 'tool') {
      const ids = (no === 3 ? CUR.model : HCTX[no].model).items.filter((x) => x.k === 'tool').map((x) => x.id);
      return `<div class="cap"><span>工具调用 · 尝试 #${no}</span><span class="num">${ids.length}</span></div>` + ids.map((id) => { const T = F.TOOLS[id]; return `<button class="n2" aria-current="${R.id === id}" data-rd="tool:${id}"><span class="ic">${I(T.src === 'mcp' ? 'shield' : 'terminal', 'sm')}</span><span><div class="t mono" style="font-size:12.5px">${esc(T.name)} <span class="muted">#${id}</span></div><div class="s">${esc(T.args)}</div></span></button>`; }).join('');
    }
    const arts = no === 3 ? artsFor(3) : F.ATTEMPTS[no].arts, cites = F.ATTEMPTS[no].cites;
    const icK = { missing: 'bad', readfail: 'bad', expired: 'unk', pending: 'unk' };
    return `<div class="cap"><span>产物 · 尝试 #${no}</span><span class="num">${arts.length}</span></div>` + arts.map((id) => { const a = F.ARTS[id], av = AV[a.kind]; return `<button class="n2" aria-current="${R.kind === 'art' && R.id === id}" data-rd="art:${id}"><span class="ic ${icK[a.kind] || ''}">${I(a.kind === 'json' ? 'braces' : a.kind === 'code' ? 'code' : a.kind === 'denied' ? 'lock' : 'file', 'sm')}</span><span style="min-width:0"><div class="t">${esc(a.name)}</div><div class="s">${a.rev} · ${a.type} · ${av[0]}</div></span></button>`; }).join('')
      + (cites.length ? `<div class="cap" style="margin-top:6px"><span>引用 · 尝试 #${no}</span><span class="num">${cites.length}</span></div>` + cites.map((id) => { const q = F.CITES[id]; return `<button class="n2" aria-current="${R.kind === 'cite' && R.id === id}" data-rd="cite:${id}"><span class="ic">${I('quote', 'sm')}</span><span style="min-width:0"><div class="t">${esc(q.name)}</div><div class="s">${esc(q.note)}</div></span></button>`; }).join('') : '');
  }
  function dlButton(id, a) {
    const st = DL[id] || 'idle';
    if (a.dl === 'none') { const why = { bin: '服务尚未提供此类产物的下载', missing: '产物不存在，无法下载', denied: '无权读取，也不能下载', expired: '版本已失效，不能下载', pending: '正文尚未生成，不能下载' }[a.kind] || '服务尚未提供下载'; return `<button class="btn secondary sm" disabled>${I('download', 'sm')}下载</button><span class="dl-msg">${why}</span>`; }
    if (st === 'loading') return `<button class="btn secondary sm" disabled><span class="spin"></span>下载中…</button>`;
    if (st === 'done') return `<button class="btn secondary sm" data-dl="${id}">${I('download', 'sm')}再次下载</button><span class="dl-msg ok">${I('check', 'sm')} 已下载（原型模拟，未保存任何文件）</span>`;
    if (st === 'fail') return `<button class="btn secondary sm" data-dl="${id}">${I('refresh', 'sm')}下载失败 · 重试</button><span class="dl-msg bad">下载失败不改变执行状态；阅读不受影响</span>`;
    return `<button class="btn secondary sm" data-dl="${id}">${I('download', 'sm')}下载</button>`;
  }
  function readerMain(R) {
    const no = R.att;
    if (R.kind === 'tool') return `<div class="rd-c" id="rdc" style="padding-top:18px"><div style="max-width:880px">${toolDetail(R.id, R.seg || 'out', no, true)}</div></div>`;
    if (R.kind === 'cite') {
      const q = F.CITES[R.id];
      const loc = q.kind === 'source' ? `引用定位：第 3 节 · 来源版本 ${q.rev}` : q.kind === 'code' ? `引用定位：第 ${q.lines[0]}–${q.lines[1]} 行 · 来源版本 ${q.rev}（不是最新文件）` : q.kind === 'excerpt' ? '引用定位：第 40–60 行附近 · 节选' : '摘要 · 无原文定位';
      const meta = `<div class="rd-meta"><span>${I('folder', 'sm')}<code>${esc(q.path)}</code></span><span>来源 尝试 #${no} · ${esc(q.note)}</span></div>`;
      const locRow = `<div class="rd-loc">${badge([loc, q.kind === 'summary' ? 'st-unknown' : 'st-accent', q.kind === 'summary' ? 'help' : 'target'])}${q.latest && q.latest !== q.rev ? `<span class="hint">${I('info', 'sm')} 此文件已有更新版本 ${q.latest}，引用仍指向 ${q.rev}</span>` : q.kind === 'source' ? '<span class="hint">这是引用时冻结的版本</span>' : ''}</div>`;
      let body;
      if (q.kind === 'source') body = `<div style="max-width:var(--read-max)">${F.DESIGN_PARAS.map(([lb, t], k) => `<div class="para ${k === q.para ? 'hl' : ''}" ${k === q.para ? 'id="rd-hl"' : ''}><span class="lb">${lb}${k === q.para ? ' · 引用位置' : ''}</span>${esc(t)}</div>`).join('')}</div>`;
      else if (q.kind === 'code') body = codeHTML(F.lines('amount'), { lang: 'ts', hl: q.lines, anchor: 'amount', label: 'amount.ts @ r3', find: R.find });
      else if (q.kind === 'excerpt') body = `<div class="banner info" style="margin-bottom:12px">${I('info')}<div><b>仅提供节选（第 40–60 行附近），不是完整原文</b><br>服务只返回了这一段；节选之外不显示行号，也不推测其他内容。</div></div><div class="cd" style="--gut:48px;border:1px solid var(--line);border-radius:12px;background:var(--bg-sunken)" tabindex="0" role="region" aria-label="节选"><div class="excerpt-gap">…… 节选之前的内容服务没有提供</div>${linesHTML(F.EXCERPT.lines, { start: F.EXCERPT.from })}<div class="excerpt-gap">…… 节选之后的内容服务没有提供</div></div>`;
      else body = `<div class="box dashed" style="max-width:var(--read-max)"><div class="row" style="gap:8px">${badge(['摘要 · 无原文定位', 'st-unknown', 'help'])}</div><p style="margin-top:10px;font-size:14px;line-height:1.8;color:var(--ink-2)">${esc(q.text)}</p><p class="hint" style="margin-top:8px">服务只提供了摘要，没有原文与行号；这里不伪造定位。</p></div>`;
      return `<div class="rd-h"><div class="eyebrow">引用 · 属于尝试 #${no}</div><div class="doc-h">${esc(q.name)} <span class="mono muted" style="font-size:14px">@ ${q.rev}</span></div>${meta}${locRow}
        ${q.kind === 'code' ? `<div class="rd-act"><div class="input-wrap"><span>${I('search', 'sm')}</span><input class="input find" placeholder="在已加载内容中查找" aria-label="在已加载内容中查找" data-find value="${esc(R.find || '')}"></div><span class="hint">已加载 1–96 行 · 共 96 行</span></div>` : ''}</div>
        <div class="rd-c" id="rdc">${body}</div>`;
    }
    const a = F.ARTS[R.id], av = AV[a.kind];
    const meta = `<div class="rd-meta"><span>版本 <code>${a.rev}</code></span>${a.sha ? `<span>sha256 <code title="sha256:${a.sha}…（样例短码）">${a.sha.slice(0, 7)}</code><button class="icon-btn xs" data-copy-raw="sha256:${a.sha}" aria-label="复制 sha256">${I('copy', 'sm')}</button></span>` : ''}<span>来源 尝试 #${no} · ${esc(a.from)}</span><span class="mono">${esc(a.mime)}</span>${a.size !== '—' ? `<span>${esc(a.size)}</span>` : ''}${badge(av, 'style="height:20px;font-size:11px"')}</div>`;
    const v = VW['art:' + R.id] || (VW['art:' + R.id] = { loaded: 200, wrap: false, state: a.kind === 'readfail' ? 'fail' : 'ok' });
    let body, act = '';
    const findBox = (rng) => `<div class="input-wrap"><span>${I('search', 'sm')}</span><input class="input find" placeholder="在已加载内容中查找" aria-label="在已加载内容中查找" data-find value="${esc(R.find || '')}"></div><span class="hint">${rng}</span>`;
    if (a.kind === 'code') { const L = F.lines(a.file); body = codeHTML(L, { lang: a.lang, find: R.find, anchor: 'art', label: a.name }); act = findBox(`已加载 1–${L.length} 行 · 共 ${L.length} 行`); }
    else if (a.kind === 'text') { const L = F.lines(a.file), sh = L.slice(0, v.loaded); body = codeHTML(sh, { find: R.find, errLines: true, label: a.name }) + `<div class="vw-foot" style="margin-top:8px;border-radius:10px"><span class="grow">已加载 1–${v.loaded} 行 · 共 ${L.length.toLocaleString('en-US')} 行 · 查找只在已加载内容中进行</span>${v.loaded < L.length ? `<button class="btn secondary sm" data-art-more="${R.id}">继续读取 200 行</button>` : ''}</div>`; act = findBox(`已加载 1–${v.loaded} 行 · 共 ${L.length.toLocaleString('en-US')} 行`); }
    else if (a.kind === 'md') body = `<div class="md">${mdRender(F.NOTES_MD, { key: 'notes' })}</div>`;
    else if (a.kind === 'json') act = `<button class="btn ghost sm" data-jt-all="1">${I('expand', 'sm')}全部展开</button><button class="btn ghost sm" data-jt-all="0">${I('collapse', 'sm')}收起</button><button class="btn ghost sm" data-copy-art-json="${R.id}">${I('copy', 'sm')}复制</button>`;
    if (a.kind === 'json') body = jsonTree(a.value === 'r2' ? F.ATTEMPTS[2].result.value : F.RESULT_R3);
    else if (a.kind === 'bin') body = `<div class="lock" style="max-width:560px"><span class="tile">${I('file', 'lg')}</span><h3>这种格式（${esc(a.mime)} · ${esc(a.size)}）不能在这里预览</h3><p>阅读器只支持 Markdown、纯文本、JSON 与代码。</p></div>`;
    else if (a.kind === 'pending') body = `<div class="lock unk" style="max-width:560px"><span class="tile">${I('clock', 'lg')}</span><h3>正文尚未提供</h3><p>服务还没有生成这个产物的正文。生成前不显示占位内容，也不用其他版本代替。</p></div>`;
    else if (a.kind === 'missing') body = `<div class="lock" style="max-width:560px"><span class="tile" style="color:var(--danger)">${I('alert', 'lg')}</span><h3>服务找不到这个产物</h3><p>${esc(a.name)} @ ${a.rev} 被实现说明引用，但服务里不存在：可能还没有生成，或已被清理。不会用其他版本或最新文件代替。</p></div>`;
    else if (a.kind === 'denied') body = `<div class="lock" style="max-width:560px"><span class="tile">${I('lock', 'lg')}</span><h3>你没有读取此产物的权限</h3><p>只显示名称、版本与来源。正文、复制与下载都不可用。</p></div>`;
    else if (a.kind === 'expired') body = `<div class="lock unk" style="max-width:560px"><span class="tile">${I('help', 'lg')}</span><h3>${a.rev} 已被替代，内容不再提供</h3><p>这个版本属于尝试 #${no}；服务只保留了版本号与 sha256，不会用后续尝试的版本代替。</p></div>`;
    else if (a.kind === 'readfail') body = v.state === 'fail' ? `<div class="banner danger" role="alert" style="max-width:640px">${I('alert')}<div><b>读取失败</b><br>没有拿到 ${esc(a.name)} 的正文。这不会改变执行状态。</div><div class="actions"><button class="btn secondary sm" data-art-retry="${R.id}">${I('refresh', 'sm')}重新读取</button></div></div>` : v.state === 'loading' ? `<div class="row"><span class="spin"></span>正在重新读取…</div>` : codeHTML(['openapi: 3.0.3', 'paths:', '  /api/refunds:', '    post:', '      summary: 创建退款（按幂等键去重）', '      parameters:', '        - in: header', '          name: Idempotency-Key', '          required: true', '      responses:', "        '201': { description: 已创建 }", "        '200': { description: 重复请求，返回第一次的结果 }"], { lang: 'yaml', label: a.name });
    return `<div class="rd-h"><div class="eyebrow">产物 · 属于尝试 #${no}</div><div class="doc-h">${esc(a.name)} <span class="mono muted" style="font-size:14px">@ ${a.rev}</span></div>${meta}<div class="rd-act">${act}<span class="grow"></span>${dlButton(R.id, a)}</div></div>
      <div class="rd-c" id="rdc">${body}</div>`;
  }
  function readerHTML() {
    const R = S.reader, no = R.att, n = nodeOf(S.open);
    const nm = R.kind === 'art' ? `产物 ${F.ARTS[R.id].name} @ ${F.ARTS[R.id].rev}` : R.kind === 'cite' ? `引用 ${F.CITES[R.id].name} @ ${F.CITES[R.id].rev}` : `工具调用 ${F.TOOLS[R.id].name} #${R.id}`;
    return `<div class="pane" role="region" aria-label="宽阅读区">
      <div class="rd-top"><nav class="rd-crumbs grow" aria-label="阅读位置"><span>${esc(n.title)}</span><span class="sep">${I('chevRight', 'sm')}</span><span>尝试 #${no}${no === 3 ? '' : ' · 历史'}</span><span class="sep">${I('chevRight', 'sm')}</span><span class="cur">${esc(nm)}</span></nav>
        <span class="hint" style="white-space:nowrap"><span class="kbd">Esc</span></span><button class="btn secondary sm" data-act="reader-close" id="rdBack">${I('arrowLeft', 'sm')}返回节点详情</button></div>
      <div class="rd-body"><nav class="rd-list" aria-label="阅读列表">${readerList(R)}</nav><section class="rd-main">${readerMain(R)}</section></div></div>`;
  }

  /* ---------- 21. 面板总渲染 ---------- */
  function renderPanel() {
    TX.detach();
    const side = $('#side');
    if (!S.open) { side.classList.add('hidden'); side.classList.remove('reading'); side.innerHTML = ''; return; }
    side.classList.remove('hidden');
    if (S.reader) {
      side.classList.add('reading'); side.innerHTML = readerHTML();
      requestAnimationFrame(() => { const hs = $('#rd-hl') ? [$('#rd-hl')] : $$('#side .cd .l.hl'); const rc = $('#rdc'); if (hs.length && rc) { const r0 = rc.getBoundingClientRect(), a = hs[0].getBoundingClientRect(), b = hs[hs.length - 1].getBoundingClientRect(); const mid = (a.top + b.bottom) / 2 - r0.top + rc.scrollTop; rc.scrollTop = Math.max(0, mid - rc.clientHeight / 2); } });
      return;
    }
    side.classList.remove('reading');
    const n = nodeOf(S.open), s = statusOf(S.open), c = ctx();
    const showTabs = !['ready', 'claimed', 'idle'].includes(s) && S.project === 'A';
    if (!showTabs) S.tab = 'overview';
    let main;
    if (S.sub && S.sub.tool) main = `<div class="sub-head"><button class="btn ghost sm" data-act="sub-back">${I('chevLeft', 'sm')}执行现场</button><span class="grow"></span><button class="btn ghost sm" data-act="tool-wide">${I('expand', 'sm')}展开阅读</button></div><div class="side-body" id="subBody">${toolDetail(S.sub.tool, S.sub.seg, S.view, false)}</div>`;
    else if (S.sub && S.sub.att) main = attDetail(S.sub.att);
    else {
      const body = S.tab === 'session' ? session(c) : `<div class="side-body" role="tabpanel" id="tabpanel" aria-labelledby="tab-${S.tab}">${S.tab === 'overview' ? overview(n, s, c) : attempts(n, s, c)}</div>`;
      main = tabsHTML(showTabs) + body;
    }
    side.innerHTML = `<div class="pane">${headHTML(n, s)}${histBarHTML()}${main}${footHTML(n, s, c)}</div>`;
    const tx = $('#tx');
    if (tx && c.live && !c.loading) { TX.attach(tx, memKey(), txInitUsed ? null : INIT_TX); txInitUsed = true; }
    else if (tx && (c.hist || c.loading)) { const m = MEM.get(memKey()); tx.scrollTop = m ? m.top : 0; TX.el = null; TX.key = memKey(); tx.addEventListener('scroll', () => MEM.set(memKey(), { top: tx.scrollTop, follow: true, paused: false, newCount: 0, atBottom: false }), { passive: true }); }
  }
  function refreshFacets() {
    const top = $('#side .sess-top'); if (!top) return;
    const c = ctx(); top.innerHTML = facets(c) + combo(c) + sessBanner(c);
  }

  /* ---------- 22. 导航动作 ---------- */
  function openNode(id, tab) {
    if (S.open && S.open !== id) { TX.detach(); S.sub = null; S.reader = null; S.view = 3; }
    S.open = id; if (tab) S.tab = tab;
    renderPanel(); if (cv) cv.reveal(id);
  }
  function closePanel(clearSel) {
    TX.detach(); S.open = null; S.sub = null; S.reader = null;
    renderPanel();
    if (clearSel === true && cv && cv.selected) { /* 画布已处理选中清除 */ }
  }
  function setTab(t, focus) { if (S.sub) S.sub = null; S.tab = t; renderPanel(); if (focus) { const b = $('#tab-' + t); if (b) b.focus(); } }
  function switchAttempt(no) {
    S.view = no; S.sub = null; if (no === 3) S.curHasNew = false;
    if (no !== 3) toast(`正在查看尝试 #${no} 的记录 · 只读`, 'info');
    renderPanel();
  }
  async function backToCurrent() {
    S.view = 3; S.sub = null; S.curHasNew = false; renderPanel();
  }
  function openTool(id) { if (TX.el) TX.pin(); S.sub = { tool: id, seg: CFG.sub && CFG.sub.tool === id ? CFG.sub.seg : (F.TOOLS[id].err ? 'out' : 'out') }; renderPanel(); const sb = $('#subBody'); if (sb) sb.scrollTop = 0; }
  function openReader(kind, id, att) {
    if (TX.el) TX.pin();
    TX.detach();
    S.readerFrom = { sub: S.sub };
    S.reader = { kind, id, att: att || S.view, find: '' };
    renderPanel();
    setTimeout(() => { const b = $('#rdBack'); if (b) b.focus({ preventScroll: true }); }, 30);
  }
  function closeReader() { S.reader = null; if (S.readerFrom) S.sub = S.readerFrom.sub; renderPanel(); }
  function switchProject() {
    TX.detach(); MEM.clear(); S.open = null; S.sub = null; S.reader = null; S.view = 3; S.project = 'B';
    CVOPT.nodes = F.PROJECTS.B.nodes; CVOPT.edges = F.PROJECTS.B.edges.map(([from, to]) => ({ from, to }));
    cv.select(null); cv.render(); cv.fit(true); bar(); situ(); renderPanel();
    toast('已切换到示例项目 · 支付网关；上一个项目的详情已清除', 'info');
  }

  /* ---------- 23. 模拟流式 ---------- */
  function tick() {
    if (!S.stream || S.project !== 'A' || CUR.loading || CUR.revoked) return;
    const e = CUR.queue.shift(); if (!e) { updateProto(); return; }
    let r;
    if (e.k === 'bfdone') { r = pushBfDone(CUR); situ(); }
    else r = apply(CUR.model, e);
    if (!r) { return tick(); } // 重复序号：去重后不渲染
    const visible = S.open === 'n2' && S.view === 3 && !S.sub && !S.reader && S.tab === 'session' && $('#txItems');
    if (visible) {
      const c = ctx(), it = CUR.model.byId[r.id];
      const box = $('#txItems'), old = box.querySelector(`[data-id="${CSS.escape(r.id)}"]`);
      const html = itemHTML(it, c);
      if (old) old.outerHTML = html; else box.insertAdjacentHTML('beforeend', html);
      if (e.k === 'bfdone' || e.bf || e.k === 'tool') { /* 原位更新 */ }
      const empty = $('#txEmpty'); if (empty) empty.remove();
      // 上一个正文块的光标：新条目出现后重绘
      if (r.isNew) { const prev = CUR.model.items[CUR.model.items.length - 2]; if (prev && prev.k === 'txt') { const pn = box.querySelector(`[data-id="${prev.id}"]`); if (pn) pn.outerHTML = itemHTML(prev, c); } }
      if (e.k === 'bfdone') { const ab = $('#side .tx'); if (ab) { /* 去掉过时标记 */ box.innerHTML = CUR.model.items.map((x) => itemHTML(x, ctx())).join(''); } }
      refreshFacets();
      TX.content(r.isNew);
    } else {
      const k = `A:n2:3`, m = MEM.get(k);
      if (m && (!m.follow || m.paused || !m.atBottom)) { if (r.isNew) m.newCount++; else m.dirty = true; }
      if (S.open === 'n2' && S.view !== 3) { S.curHasNew = true; const d = $('#newdot'); if (d && CUR.status === 'run') d.hidden = false; }
      if (S.open === 'n2' && S.view === 3 && !S.sub && !S.reader && S.tab !== 'session') { /* 概览等页签：不打扰 */ }
    }
  }
  setInterval(tick, 1300);

  /* ---------- 24. 原型控制条 / 说明抽屉 ---------- */
  const NT = { N01: '全图与详情', N02: '首次加载 / 尚无正文', N03: '正文流式追加', N04: '工具等待 / 运行 / 完成', N05: '公开推理摘要', N06: '传输结束 ≠ 完成', N07: '失败与部分正文', N08: '取消', N09: '回执未知', N10: '断连与补读', N11: '完成与验收', N12: '跟随最新', N13: '工具详情', N14: '工具读取边界', N15: '产物阅读与下载', N16: '引用定位', N17: '尝试列表与历史', N18: '记录保留与分页', N19: '晚到 / 撤权 / 项目切换', N20: '阅读区 / 键盘 / 减少动态' };
  function protoBar() {
    const groups = Object.keys(NT).map((n) => `<optgroup label="${n} · ${NT[n]}">${STATES.filter((s) => s.n === n).map((s) => `<option value="${s.id}" ${s.id === CFG.id ? 'selected' : ''}>${s.n} · ${esc(s.label)}</option>`).join('')}</optgroup>`).join('');
    document.body.insertAdjacentHTML('beforeend', `<div class="proto-dock"></div><div class="proto" role="region" aria-label="原型控制（设计样例，非产品界面）">
      <span class="proto-tag">${I('info', 'sm')}设计样例</span>
      <label>状态<select id="pState" aria-label="切换原型状态">${groups}</select></label>
      <label>主题${DS.skinSelect()}</label>
      <span class="proto-sep"></span>
      <label>减少动态<button class="switch" role="switch" id="pReduced" aria-checked="${S.reduced}" aria-label="减少动态"></button></label>
      <button class="proto-btn" id="pStream"></button>
      <button class="proto-btn" id="pExplain">${I('help', 'sm')}说明</button>
    </div>
    <aside class="drawer" id="explain" aria-hidden="true" role="dialog" aria-labelledby="exT" tabindex="-1">
      <div class="drawer-head"><div class="grow"><div class="eyebrow">原型说明 · 设计样例</div><h2 id="exT" style="margin-top:3px"></h2><div class="ex-id" id="exId" style="margin-top:4px"></div></div><button class="icon-btn" aria-label="关闭说明" onclick="DS.closeDrawer('explain')">${I('x')}</button></div>
      <div class="drawer-body" id="exB"></div>
      <div class="drawer-foot"><span class="hint grow">原型完成不等于前后端接通、真实模型验证或流程验收。</span><button class="btn secondary" onclick="DS.closeDrawer('explain')">关闭</button></div>
    </aside>`);
    $('#pState').addEventListener('change', (e) => { const p = new URLSearchParams(location.search); p.set('state', e.target.value); p.set('theme', document.documentElement.dataset.skin); if (S.reduced && !STATES.find((s) => s.id === e.target.value).reduced) p.set('motion', 'reduce'); else p.delete('motion'); p.delete('stream'); location.search = p.toString(); });
    $('#pReduced').addEventListener('click', () => { S.reduced = !S.reduced; document.documentElement.classList.toggle('reduced', S.reduced); updateProto(); try { const u = new URL(location.href); if (S.reduced) u.searchParams.set('motion', 'reduce'); else u.searchParams.delete('motion'); history.replaceState(null, '', u.toString()); } catch (e) {} toast(S.reduced ? '已开启减少动态：无闪烁、无平滑滚动，状态仍有图标与文字' : '已关闭减少动态', 'info'); });
    $('#pStream').addEventListener('click', () => { S.stream = !S.stream; updateProto(); toast(S.stream ? '继续模拟流式（只在内存中追加样例片段）' : '已暂停模拟流式', 'info'); });
    $('#pExplain').addEventListener('click', (e) => { explain(); DS.openDrawer('explain', e.currentTarget); });
    updateProto();
  }
  function updateProto() {
    const b = $('#pStream'); if (!b) return;
    const left = CUR.queue.length;
    b.innerHTML = S.stream ? `${I('pause', 'sm')}流式 · 暂停` : `${I('play', 'sm')}流式 · 继续`;
    b.title = left ? `剩余 ${left} 个样例片段` : '这个状态没有更多样例片段';
    const r = $('#pReduced'); if (r) r.setAttribute('aria-checked', S.reduced);
  }
  function explain() {
    $('#exT').textContent = CFG.label; $('#exId').textContent = `${CFG.n} · ?state=${CFG.id} · ${CFG.mode}`;
    $('#exB').innerHTML = `<div class="ex-sec"><h3>设计意图</h3><p>${esc(CFG.intent)}</p></div>
      <div class="ex-sec"><h3>验收要点</h3><ul>${CFG.checks.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>
      <div class="ex-sec"><h3>边界</h3><ul><li>所有数据来自 fixtures.js 的虚构样例；不调用桌面桥、网络或模型。</li><li>“传输结束”不等于完成；完成只在结果提交 + 验收通过后出现。</li><li>历史尝试只读，不出现重跑 / 恢复 / 验收等执行动作。</li></ul></div>`;
  }

  /* ---------- 25. 事件委托 ---------- */
  document.addEventListener('click', (e) => {
    const t = e.target;
    const q = (sel) => t.closest(sel);
    let b;
    if ((b = q('[data-act]'))) {
      const a = b.dataset.act;
      if (a === 'close') { closePanel(false); toast('已关闭详情：画布视口与选中保持不变', 'info'); return; }
      if (a === 'tab') return setTab(b.dataset.tab);
      if (a === 'att-menu') return DS.menu(b, attMenuItems());
      if (a === 'back-current') return backToCurrent();
      if (a === 'follow') return TX.setFollow(!TX.follow);
      if (a === 'to-latest') return TX.latest();
      if (a === 'sub-back') { S.sub = null; renderPanel(); return; }
      if (a === 'tool-wide') { const s = S.sub; openReader('tool', s.tool, S.view); S.reader.seg = s.seg; renderPanel(); return; }
      if (a === 'reader-close') return closeReader();
      if (a === 'att-session') { const no = +b.dataset.no; S.sub = null; S.tab = 'session'; S.view = no; renderPanel(); if (no !== 3) toast(`正在查看尝试 #${no} 的执行现场 · 只读`, 'info'); return; }
      if (a === 'page-retry') { pageState = 'loading'; renderPanel(); setTimeout(() => { pageState = 'all'; renderPanel(); }, 900); return; }
      if (a === 'check') { const k = CUR.check; CHECK[k] = 'loading'; renderPanel(); setTimeout(() => { CHECK[k] = `${k === 'stop' ? '10:52:14' : '10:52:14'} 核对：<b>仍未确认</b>（原操作 ${k === 'stop' ? 'op-stop-3f2a' : 'op-submit-9c41'} 仍在服务处理中）。不会重发，稍后可再次核对。`; renderPanel(); }, 900); return; }
      if (a === 'reconnect') { CUR.conn = 'reconnecting'; renderPanel(); situ(); setTimeout(() => { CUR.conn = 'backfilling'; const B = bfList(true); CUR.queue = B.concat([{ k: 'bfdone' }], CUR.queue); renderPanel(); situ(); S.stream = true; updateProto(); }, 1400); return; }
      if (a === 'auto') { const on = b.getAttribute('aria-checked') !== 'true'; b.setAttribute('aria-checked', on); toast(on ? '已开启自动节点推进（原型示意）' : '已关闭自动节点推进（原型示意）', 'info'); return; }
      if (a === 'more') return DS.menu(b, [{ label: '冻结计划', icon: 'layers', run() { toast('冻结计划不在本原型范围（见 task.html）', 'info'); } }, { label: '审计记录', icon: 'clock', run() { toast('审计记录不在本原型范围（见 task.html）', 'info'); } }, '-', { label: '切换到另一个示例项目（N19）', icon: 'folder', run: switchProject }]);
      if (a === 'focus-n2') { cv.focusNode('n2'); return; }
      if (a === 'proto') { toast(`“${b.dataset.msg}”：原型示意，未发送任何请求`, 'info'); return; }
    }
    if ((b = q('[data-tool]'))) return openTool(b.dataset.tool);
    if ((b = q('[data-cite]'))) return openReader('cite', 'cite-src', S.view === 3 ? 3 : S.view);
    if ((b = q('[data-open-art]'))) return openReader('art', b.dataset.openArt, b.dataset.att ? +b.dataset.att : S.view);
    if ((b = q('[data-open-cite]'))) return openReader('cite', b.dataset.openCite, b.dataset.att ? +b.dataset.att : S.view);
    if ((b = q('[data-view-att]'))) { const no = +b.dataset.viewAtt; S.view = no; S.sub = { att: no }; renderPanel(); return; }
    if ((b = q('[data-rd]'))) { const [k, id] = b.dataset.rd.split(':'); S.reader = Object.assign({}, S.reader, { kind: k, id, find: '' }); renderPanel(); return; }
    if ((b = q('[data-seg]'))) { if (S.reader && S.reader.kind === 'tool') S.reader.seg = b.dataset.seg; else if (S.sub) S.sub.seg = b.dataset.seg; renderPanel(); return; }
    if ((b = q('[data-rsn]'))) { const k = 'rsn:' + b.dataset.rsn; EXP.has(k) ? EXP.delete(k) : EXP.add(k); TX.pin(); const it = (ctx().model || { byId: {} }).byId[b.dataset.rsn] || null; const node = b.closest('.ti'); if (it && node) node.outerHTML = itemHTML(it, ctx()); return; }
    if ((b = q('[data-code-toggle]'))) { const box = b.closest('.md-code'), k = box.dataset.key; EXP.has(k) ? EXP.delete(k) : EXP.add(k); TX.pin(); box.classList.toggle('collapsed'); b.textContent = EXP.has(k) ? '收起' : '展开全部'; return; }
    if ((b = q('[data-copy-code]'))) { TX.pin(); return copyText(b.closest('.md-code').dataset.raw, '代码块'); }
    if ((b = q('[data-copy-item]'))) { TX.pin(); const c = ctx(); const it = c.model.byId[b.dataset.copyItem]; return copyText(it.k === 'rsn' ? it.text : it.md, it.k === 'rsn' ? '公开推理摘要' : '模型正文'); }
    if ((b = q('[data-copy-raw]'))) return copyText(b.dataset.copyRaw.startsWith('sha') ? b.dataset.copyRaw : '#' + b.dataset.copyRaw, b.dataset.copyRaw.startsWith('sha') ? ' sha256' : '调用 ID');
    if ((b = q('[data-copy-json]'))) { const [id, seg] = b.dataset.copyJson.split(':'); const T = F.TOOLS[id], d = seg === 'args' ? T.argv : (T.err || T.out); return copyText(JSON.stringify(jsonForCopy(d.value), null, 2), ' JSON（脱敏字段为 "[已隐藏]"）'); }
    if ((b = q('[data-copy-art-json]'))) { const a = F.ARTS[b.dataset.copyArtJson]; return copyText(JSON.stringify(a.value === 'r2' ? F.ATTEMPTS[2].result.value : F.RESULT_R3, null, 2), ' JSON'); }
    if ((b = q('[data-copy-text]'))) { const [id] = b.dataset.copyText.split(':'); const d = F.TOOLS[id].out; return copyText(d.paras ? F.DESIGN_PARAS.map((x) => x.join('\n')).join('\n\n') : d.plain, '文本'); }
    if ((b = q('[data-copy-lines]'))) { const key = b.dataset.copyLines, [id, seg] = key.split(':'), T = F.TOOLS[id], d = seg === 'args' ? T.argv : (T.err || T.out); const L = d.plain ? [d.plain] : F.lines(d.file).slice(0, VW[key].loaded); return copyText(L.join('\n'), `已加载的 ${L.length} 行（不含行号）`); }
    if ((b = q('[data-jt-all]'))) { const box = b.closest('.vw') || b.closest('.rd-main'); $$('details', box).forEach((d) => { d.open = b.dataset.jtAll === '1'; }); return; }
    if ((b = q('[data-wrap]'))) { const v = VW[b.dataset.wrap]; v.wrap = !v.wrap; rerenderKeep(); return; }
    if ((b = q('[data-more]'))) { const key = b.dataset.more, v = VW[key]; v.state = 'loading'; rerenderKeep(); setTimeout(() => { v.fails = (v.fails || 0) + 1; const [id] = key.split(':'); if (id === 'c-c3f9' && v.fails === 2) v.state = 'fail'; else { v.loaded = Math.min(v.loaded + 200, F.TOOLS[id].err ? F.TOOLS[id].err.total : F.TOOLS[id].out.total); v.state = 'ok'; } rerenderKeep(); }, 650); return; }
    if ((b = q('[data-retry]'))) { const v = VW[b.dataset.retry]; v.state = 'loading'; rerenderKeep(); setTimeout(() => { v.loaded += 200; v.state = 'ok'; rerenderKeep(); }, 650); return; }
    if ((b = q('[data-art-more]'))) { const v = VW['art:' + b.dataset.artMore]; v.loaded = Math.min(v.loaded + 200, F.lines(F.ARTS[b.dataset.artMore].file).length); rerenderKeep(); return; }
    if ((b = q('[data-art-retry]'))) { const v = VW['art:' + b.dataset.artRetry]; v.state = 'loading'; rerenderKeep(); setTimeout(() => { v.state = 'ok'; rerenderKeep(); }, 800); return; }
    if ((b = q('[data-dl]'))) { const id = b.dataset.dl, a = F.ARTS[id]; DL[id] = 'loading'; rerenderKeep(); setTimeout(() => { DL[id] = a.dl === 'fail-once' && !DL['_' + id] ? 'fail' : 'done'; DL['_' + id] = 1; rerenderKeep(); }, 900); return; }
  });
  function rerenderKeep() {
    const sb = $('#subBody') || $('#rdc'), top = sb ? sb.scrollTop : 0, lx = $$('.vw-b .cd, .rd-c .cd').map((x) => x.scrollLeft);
    renderPanel();
    const nb = $('#subBody') || $('#rdc'); if (nb) nb.scrollTop = top;
    $$('.vw-b .cd, .rd-c .cd').forEach((x, i) => { x.scrollLeft = lx[i] || 0; });
  }
  document.addEventListener('input', (e) => { if (e.target.matches('[data-find]')) { S.reader.find = e.target.value; const pos = e.target.selectionStart; rerenderKeep(); const f = $('[data-find]'); if (f) { f.focus(); f.setSelectionRange(pos, pos); } } });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if ($('.drawer.open') || $('.dialog.open') || $('.menu')) return;
      if (S.reader) { e.preventDefault(); closeReader(); setTimeout(() => { const t = $('#side .tab[aria-selected="true"]') || $('#side [data-act="sub-back"]'); if (t) t.focus(); }, 20); return; }
      if (S.sub) { e.preventDefault(); S.sub = null; renderPanel(); return; }
    }
    if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && e.target.matches && e.target.matches('.tab[role="tab"]')) {
      e.preventDefault();
      const i = TABS.findIndex(([k]) => k === S.tab), j = (i + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length;
      setTab(TABS[j][0], true);
    }
  });

  /* ---------- 26. 启动 ---------- */
  DS.mount({ header: '', proto: false });
  DS.$('.header').remove();
  cv = DSCanvas($('#cv'), CVOPT);
  bar(); situ(); protoBar();
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (CFG.closedFrom) {
      cv.zoom(1.15); cv.select(CFG.closedFrom); // 打开
      setTimeout(() => { closePanel(false); toast('已关闭详情：画布视口与选中保持不变', 'info'); }, 60);
    } else if (CFG.lateFrom) {
      cv.select(CFG.lateFrom);
      S.lateNote = true; cv.select(CFG.open);
      setTimeout(() => { S.lateNote = false; if (S.open === 'n3') renderPanel(); }, 3000);
    } else if (CFG.open) {
      S.tab = CFG.tab || 'session'; S.view = CFG.view || 3;
      if (CFG.sub && CFG.sub.att) S.sub = { att: CFG.sub.att };
      if (CFG.sub && CFG.sub.tool) S.sub = { tool: CFG.sub.tool, seg: CFG.sub.seg };
      if (CFG.reader) { S.reader = { kind: CFG.reader.kind, id: CFG.reader.id, att: 3, find: '' }; S.readerFrom = { sub: null }; if (CFG.reader.dl) { DL[CFG.reader.id] = CFG.reader.dl; DL['_' + CFG.reader.id] = 1; } }
      cv.select(CFG.open);
      if (INIT_TX && INIT_TX.pre) { S.stream = true; for (let i = 0; i < INIT_TX.pre; i++) tick(); S.stream = !!CFG.stream && P.get('stream') !== 'paused'; updateProto(); }
    }
    if (CUR.loading) setTimeout(() => { const k = CUR.after; CUR = makeCur(k); CUR.loadedFrom = k; renderPanel(); bar(); situ(); updateProto(); }, 2500);
    if (CFG.focus) setTimeout(() => { const f = $(CFG.focus), sb = $('#subBody'); if (f && sb) sb.scrollTop = f.getBoundingClientRect().top - sb.getBoundingClientRect().top + sb.scrollTop - 70; }, 60);
    if (CFG.kb) { document.documentElement.classList.add('kb-demo'); setTimeout(() => { const t = $('#tab-session'); if (t) t.focus(); }, 120); }
  }));
  // 原型自检用（不属于产品界面）
  window.ND = { S, get CUR() { return CUR; }, MEM, TX, tick, cfg: CFG };
})();
