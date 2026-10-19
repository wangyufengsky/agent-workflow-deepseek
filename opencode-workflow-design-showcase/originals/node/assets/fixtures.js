/* opencode-workflow · 节点执行详情 · 设计样例数据（全部虚构）
   - 不来自任何真实项目、服务或模型；不包含真实凭据。
   - 服务端脱敏字段在样例里只有一个标记 {"$redacted": "<类别>"}，值本身从未进入数据。
   - 时间都写成“服务记录时间”；t:null 表示服务没有给出时间（界面写“时间未知”）。
*/
(function () {
  const F = {};

  /* ---------- 项目与画布 ---------- */
  F.PROJECTS = {
    A: {
      name: '示例项目 · 订单服务', task: '订单服务 · 退款流程改造',
      nodes: [
        { id: 'start', title: '开始', system: true },
        { id: 'n1', title: '梳理需求', role: '产品经理', output: '退款需求清单', what: '整理退款场景（全额、部分、重复请求），明确金额精度与幂等要求。' },
        { id: 'n2', title: '实现接口', role: '软件工程师', output: '退款接口代码变更', what: '新增 POST /api/refunds：金额统一为整数分，请求必须带幂等键；补齐单元测试。' },
        { id: 'n3', title: '编写测试', role: '测试工程师', output: '接口测试用例', what: '按需求清单编写退款接口的接口测试用例。' },
        { id: 'n4', title: '回归测试', role: '测试工程师', output: '回归测试报告', what: '覆盖下单、支付回调、退款三条链路的回归用例。' },
        { id: 'n5', title: '人工验收', role: '人工', output: '验收结论', what: '由你确认退款流程是否达到目标。' },
        { id: 'end', title: '交付', system: true },
      ],
      edges: [['start', 'n1'], ['n1', 'n2'], ['n1', 'n3'], ['n2', 'n4'], ['n3', 'n4'], ['n4', 'n5'], ['n5', 'end']],
    },
    B: {
      name: '示例项目 · 支付网关', task: '支付网关 · 对账任务补齐',
      nodes: [
        { id: 'start', title: '开始', system: true },
        { id: 'p1', title: '接入回调', role: '软件工程师', output: '回调处理代码', what: '接入支付网关回调。' },
        { id: 'p2', title: '对账任务', role: '软件工程师', output: '对账脚本', what: '每日对账任务。' },
        { id: 'p3', title: '人工验收', role: '人工', output: '验收结论', what: '确认对账结果。' },
        { id: 'end', title: '交付', system: true },
      ],
      edges: [['start', 'p1'], ['p1', 'p2'], ['p2', 'p3'], ['p3', 'end']],
    },
  };

  /* ---------- 尝试（节点“实现接口”） ---------- */
  // 当前尝试 #3 的状态由原型状态决定；历史 #1/#2 是固定记录。
  F.ATTEMPTS = {
    1: { no: 1, status: 'fail', start: '09:12:04', end: '09:20:47', rev: 'v4', gen: 1,
      reason: '构建失败：RefundAmount 类型不匹配（TS2322）',
      result: null, acceptance: null,
      errors: [['error', '构建失败：src/refund/service.ts(57,11) TS2322 Type \'number\' is not assignable to type \'RefundAmount\'。']],
      arts: ['h1-svc'], cites: [] },
    2: { no: 2, status: 'cancel', start: '09:58:30', end: '10:33:52', rev: 'v4', gen: 2,
      reason: '你在 10:33 停止了这次尝试（结果 r2 未通过验收后仍在修改）',
      result: { rev: 'r2', at: '10:24:16', value: { refundId: 'RF-20261011-0007', orderId: 'ORD-1042', amountCents: 1234, status: 'PENDING', idempotencyKey: null, tests: { passed: 36, failed: 0 } } },
      acceptance: { status: 'rejected', resultRev: 'r2', policy: 'v3', at: '10:24:40', detail: '2 条规则未满足：请求缺少幂等键；重复请求会产生第二笔退款。' },
      errors: [['warn', '执行器在 10:33:52 确认停止；停止前未提交新的结果。']],
      arts: ['h2-svc', 'h2-result'], cites: ['cite-src'] },
    3: { no: 3, start: '10:42:01', rev: 'v4', gen: 2, cur: true,
      arts: ['a-svc', 'a-notes', 'a-result', 'a-log', 'a-bin', 'a-cov', 'a-missing', 'a-denied', 'a-yaml'],
      cites: ['cite-src', 'cite-code', 'cite-excerpt', 'cite-summary'] },
  };

  /* ---------- 正文、推理摘要 ---------- */
  const R1 = '目标是新增退款接口，并修掉尝试 #1 的构建错误：调用方仍在传以“元”为单位的浮点数，和 RefundAmount 类型不一致。\n尝试 #2 提交的 r2 没有通过验收（缺少幂等键），这次要把幂等放进接口约束，而不是靠调用方自觉。\n顺序：读现有实现 → 查金额相关调用 → 改金额类型 → 新增接口 → 构建 → 单元测试 → 提交结构化结果。\n不改数据库表结构；如果需要迁移，只在实现说明里提出，不在这一步执行。';
  const R2 = 'toCents 需要处理 0.005 这类半分值。设计文档第 3 节要求四舍五入到分，不用银行家舍入。';

  const B1 = ['## 计划\n\n我会按下面的顺序改动：\n\n', '1. 读取 `src/refund/` 现有实现\n2. 把金额统一成整数分（`amountCents`）\n', '3. 新增 `POST /api/refunds`，请求必须带幂等键\n4. 构建并运行单元测试，再提交结构化结果\n'];
  const B2 = ['现有实现用 `number` 表示“元”，`0.1 + 0.2` 这类计算会产生分位误差。依据设计文档的约定[1]，金额一律用**整数分**保存与传输。\n\n', '相关决策记录：`docs/design/refund/2026-10/refund-idempotency-and-amount-precision-decision-record-v3.md`\n\n', '内部讨论链接：wiki.example.invalid/order-service/refund/threads/2026-10-09-amount-precision-and-idempotency-key-requirements-for-partial-refunds\n'];
  const B3 = ['接下来新增接口。核心逻辑如下：\n\n```ts\n', 'export async function createRefund(req: RefundRequest): Promise<Refund> {\n', '  const existing = await refunds.findByKey(req.idempotencyKey);\n', '  if (existing) return existing; // 幂等：同一个键只退一次\n', '  const amountCents = toCents(req.amount);\n  assertRefundable(req.orderId, amountCents);\n', '  return refunds.create({ ...req, amountCents, status: \'PENDING\' });\n}\n```\n\n', '重复请求会直接返回第一次的结果，不会产生第二笔退款。\n'];
  const B4 = ['构建通过。现在运行退款模块的单元测试。\n'];
  const B5 = ['有 2 个用例失败：部分退款时 `12.345` 被换算成 `1234`，应为 `1235`。', '原因是 `toCents` 先截断再乘 100，已改为先乘再四舍五入。\n'];
  const B6 = ['## 结果\n\n- 新增 `POST /api/refunds`，按幂等键去重\n- 金额统一为整数分，修正了 `toCents` 的舍入\n', '- 退款模块单元测试 41 个全部通过\n\n| 文件 | 变更 | 说明 |\n|---|---|---|\n| src/refund/amount.ts | +27 −10 | 整数分与舍入规则 |\n', '| src/refund/service.ts | +86 −12 | createRefund 与幂等查询 |\n| src/api/refunds.route.ts | 新增 | 路由与请求校验（idempotencyKey 必填） |\n\n', '接下来提交结构化结果，等待验收。\n'];

  /* ---------- 当前尝试 #3 的服务记录（按服务顺序，seq 稳定） ---------- */
  const E = [];
  let seq = 0;
  const ev = (o) => { o.seq = ++seq; E.push(o); return o; };
  const txt = (id, t, parts, mark) => parts.forEach((d, i) => ev({ k: 'txt', id, t, d, end: i === parts.length - 1, mark: i === parts.length - 1 ? mark : (mark ? mark + '-' + i : undefined) }));
  ev({ k: 'svc', t: '10:42:01', icon: 'play', text: '尝试 #3 开始 · 定义修订 v4 · 执行代次 2', mark: 'start' });
  ev({ k: 'rsn', id: 'r1', t: '10:42:05', text: R1, mark: 'r1' });
  txt('b1', '10:42:08', B1, 'b1');
  ev({ k: 'tool', id: 'c-7f3a', t: '10:42:15', st: 'running' });
  ev({ k: 'tool', id: 'c-7f3a', t: '10:42:16', st: 'ok' });
  ev({ k: 'tool', id: 'c-2e44', t: '10:42:18', st: 'running' });
  ev({ k: 'tool', id: 'c-2e44', t: '10:42:19', st: 'ok' });
  ev({ k: 'tool', id: 'c-81d0', t: '10:42:20', st: 'running' });
  ev({ k: 'tool', id: 'c-81d0', t: '10:42:21', st: 'ok' });
  ev({ k: 'tool', id: 'c-6b31', t: '10:42:22', st: 'running' });
  ev({ k: 'tool', id: 'c-6b31', t: '10:42:22', st: 'ok', mark: 'reads' });
  txt('b2', '10:42:31', B2, 'b2');
  ev({ k: 'rsn', id: 'r2', t: '10:42:50', text: R2, mark: 'r2' });
  ev({ k: 'tool', id: 'c-9b12', t: '10:43:02', st: 'running' });
  ev({ k: 'tool', id: 'c-9b12', t: '10:43:04', st: 'ok', mark: 'edit1' });
  ev({ k: 'tool', id: 'c-b7e1', t: '10:43:10', st: 'running', mark: 'q1-start' });
  ev({ k: 'tool', id: 'c-d2a8', t: '10:43:11', st: 'running' });
  ev({ k: 'tool', id: 'c-d2a8', t: '10:43:13', st: 'ok', mark: 'q2' });
  txt('b3', '10:43:14', B3, 'b3');
  ev({ k: 'tool', id: 'c-b7e1', t: '10:44:31', st: 'ok', late: true, mark: 'q1-late' });
  ev({ k: 'tool', id: 'c-a4e6', t: '10:44:40', st: 'running', mark: 'build-start' });
  ev({ k: 'tool', id: 'c-a4e6', t: '10:45:02', st: 'ok', mark: 'build' });
  txt('b4', '10:45:10', B4, 'b4');
  ev({ k: 'tool', id: 'c-c3f9', t: '10:45:12', st: 'queued', mark: 'test-queued' });
  ev({ k: 'tool', id: 'c-c3f9', t: '10:45:13', st: 'running', mark: 'test-running' });
  ev({ k: 'tool', id: 'c-c3f9', t: '10:46:01', st: 'fail', mark: 'test-fail' });
  txt('b5', '10:46:05', B5, 'b5');
  ev({ k: 'tool', id: 'c-e1a0', t: '10:46:20', st: 'running' });
  ev({ k: 'tool', id: 'c-e1a0', t: '10:46:22', st: 'ok' });
  ev({ k: 'tool', id: 'c-f4b8', t: '10:46:30', st: 'running', mark: 'test2-start' });
  ev({ k: 'tool', id: 'c-f4b8', t: '10:47:05', st: 'ok', mark: 'test2' });
  ev({ k: 'tool', id: 'c-0d6c', t: '10:47:12', st: 'running' });
  ev({ k: 'tool', id: 'c-0d6c', t: '10:47:15', st: 'ok', mark: 'export' });
  txt('b6', '10:47:20', B6, 'b6');
  F.EVENTS = E;
  F.mark = (m) => { const i = E.findIndex((e) => e.mark === m); if (i < 0) throw new Error('no mark ' + m); return i + 1; };

  /* ---------- 历史尝试的固定记录 ---------- */
  F.HIST = {
    1: [
      { k: 'svc', t: '09:12:04', icon: 'play', text: '尝试 #1 开始 · 定义修订 v4 · 执行代次 1' },
      { k: 'txt', id: 'h1b1', t: '09:12:10', d: '先按现有的 `RefundAmount` 类型实现接口，金额暂时沿用调用方传入的数值。\n', end: true },
      { k: 'tool', id: 'h1-c1', t: '09:13:02', st: 'ok' },
      { k: 'tool', id: 'h1-c2', t: '09:19:40', st: 'fail' },
      { k: 'txt', id: 'h1b2', t: '09:20:30', d: '构建失败：`service.ts` 第 57 行把 `number` 传给了 `RefundAmount`。需要先统一金额类型，这次尝试无法继续。\n', end: true },
      { k: 'err', t: '09:20:47', text: '执行失败 · 构建错误（TS2322）。这次尝试没有提交结果。' },
    ],
    2: [
      { k: 'svc', t: '09:58:30', icon: 'play', text: '尝试 #2 开始 · 定义修订 v4 · 执行代次 2' },
      { k: 'txt', id: 'h2b1', t: '09:58:41', d: '这次把金额改成整数分后再实现接口。\n', end: true },
      { k: 'tool', id: 'h2-c1', t: '10:05:12', st: 'ok' },
      { k: 'svc', t: '10:24:16', icon: 'upload', text: '结果已提交 · 结果版本 r2' },
      { k: 'svc', t: '10:24:40', icon: 'x', tone: 'warn', text: '验收未通过 · 结果版本 r2 · 验收策略 v3：缺少幂等键' },
      { k: 'txt', id: 'h2b2', t: '10:25:02', d: '收到验收意见，开始补幂等键校验……\n', end: true },
      { k: 'svc', t: '10:33:30', icon: 'stop', text: '你请求停止这一步' },
      { k: 'svc', t: '10:33:52', icon: 'stop', text: '执行器已确认停止' },
    ],
  };

  /* ---------- 工具调用 ---------- */
  const T = (o) => o;
  F.TOOLS = {
    'c-7f3a': T({ name: 'read', src: 'oc', start: '10:42:15', end: '10:42:16', args: '读取 src/refund/service.ts', res: '312 行 · TypeScript',
      argv: { fmt: 'json', size: '0.1 KB', value: { filePath: 'src/refund/service.ts' } },
      out: { fmt: 'code', lang: 'ts', file: 'service', total: 312, size: '11.4 KB' },
      refs: [['src/refund/service.ts @ 仓库修订 4e8d1b0 · 第 1–312 行', 'art', 'a-svc']] }),
    'c-2e44': T({ name: 'read', src: 'oc', start: '10:42:18', end: '10:42:19', args: '读取 docs/design/refund-design.md', res: '4 节 · 约 2,100 字',
      argv: { fmt: 'json', size: '0.1 KB', value: { filePath: 'docs/design/refund-design.md' } },
      out: { fmt: 'text', size: '6.2 KB', paras: 'design' },
      refs: [['refund-design.md @ r2 · 第 3 节（正文引用 [1]）', 'cite', 'cite-src']] }),
    'c-81d0': T({ name: 'grep', src: 'oc', start: '10:42:20', end: '10:42:21', args: '在 src/ 中查找 amount', res: '17 处匹配 · 6 个文件', access: 'nocap' }),
    'c-6b31': T({ name: 'glob', src: 'oc', start: '10:42:22', end: '10:42:22', args: '匹配 src/refund/**/*.test.ts', res: '空结果',
      argv: { fmt: 'json', size: '0.1 KB', value: { pattern: 'src/refund/**/*.test.ts' } }, out: { fmt: 'empty' }, refs: [] }),
    'c-9b12': T({ name: 'edit', src: 'oc', start: '10:43:02', end: '10:43:04', args: '修改 src/refund/amount.ts · 改为整数分', res: '+24 −9',
      argv: { fmt: 'json', size: '1.6 KB', value: { filePath: 'src/refund/amount.ts', oldString: 'export const toYuan = (n: number) => n', newString: 'export const toCents = (yuan: number): number =>\n  Math.round(yuan * 100)' } },
      out: { fmt: 'text', size: '0.2 KB', plain: '已写入 src/refund/amount.ts：+24 −9。' },
      refs: [['src/refund/amount.ts @ r3 · 第 42–48 行', 'cite', 'cite-code']] }),
    'c-b7e1': T({ name: 'order-db.query', src: 'mcp', start: '10:43:10', end: '10:44:31', args: '只读查询 ORD-1042 的退款记录', res: '4 行 · 1.2 KB',
      redacted: 2,
      argv: { fmt: 'json', size: '0.6 KB', value: { database: 'orders_sample', mode: 'readonly', sql: 'select id, amount_cents, status, idempotency_key from refunds where order_id = :orderId', params: { orderId: 'ORD-1042' }, connection: { host: 'db.sample.invalid', user: 'refund_reader', credential: { $redacted: 'credential' } }, headers: { authorization: { $redacted: 'auth-header' } } } },
      out: { fmt: 'json', size: '1.2 KB', value: { rowCount: 4, rows: [
        { id: 'RF-0001', amount_cents: 1200, status: 'SUCCEEDED', idempotency_key: 'k-71a2' },
        { id: 'RF-0002', amount_cents: 34, status: 'SUCCEEDED', idempotency_key: 'k-71a3' },
        { id: 'RF-0007', amount_cents: 1234, status: 'PENDING', idempotency_key: null },
        { id: 'RF-0008', amount_cents: 1234, status: 'PENDING', idempotency_key: null },
      ], truncated: false, elapsedMs: 41 } },
      refs: [['查询结果快照 q-77 · JSON（尝试 #3）', 'art', 'a-result']] }),
    'c-d2a8': T({ name: 'order-db.query', src: 'mcp', start: '10:43:11', end: '10:43:13', args: '只读查询 ORD-1042 的支付流水', res: '3 行 · 0.8 KB', access: 'denied' }),
    'c-a4e6': T({ name: 'bash', src: 'oc', start: '10:44:40', end: '10:45:02', args: 'npm run build', res: '退出码 0 · 用时 22 秒',
      argv: { fmt: 'cmd', size: '0.1 KB', plain: 'npm run build' },
      out: { fmt: 'cmd', exit: 0, size: '64 KB（已截断）', file: 'build', total: 1210, truncated: true }, refs: [] }),
    'c-c3f9': T({ name: 'bash', src: 'oc', start: '10:45:12', end: '10:46:01', args: 'npm test -- refund', res: '退出码 1 · 2 失败 · 39 通过',
      argv: { fmt: 'cmd', size: '0.1 KB', plain: 'npm test -- refund' },
      err: { fmt: 'cmd', exit: 1, size: '96 KB', file: 'test', total: 1840 },
      refs: [['test-output.txt · 测试输出全文', 'art', 'a-log']] }),
    'c-e1a0': T({ name: 'edit', src: 'oc', start: '10:46:20', end: '10:46:22', args: '修改 src/refund/amount.ts · 先乘后舍入', res: '+3 −1',
      argv: { fmt: 'json', size: '0.3 KB', value: { filePath: 'src/refund/amount.ts', oldString: 'Math.trunc(yuan) * 100', newString: 'Math.round(yuan * 100)' } },
      out: { fmt: 'text', size: '0.1 KB', plain: '已写入 src/refund/amount.ts：+3 −1。' }, refs: [] }),
    'c-f4b8': T({ name: 'bash', src: 'oc', start: '10:46:30', end: '10:47:05', args: 'npm test -- refund', res: '退出码 0 · 41 通过',
      argv: { fmt: 'cmd', size: '0.1 KB', plain: 'npm test -- refund' },
      out: { fmt: 'cmd', exit: 0, size: '88 KB', file: 'test-ok', total: 1712 }, refs: [['test-output.txt · 测试输出全文', 'art', 'a-log']] }),
    'c-0d6c': T({ name: 'fixtures.export', src: 'mcp', start: '10:47:12', end: '10:47:15', args: '导出退款测试夹具', res: '2.3 MB · application/octet-stream',
      argv: { fmt: 'json', size: '0.1 KB', value: { suite: 'refund', format: 'binary' } },
      out: { fmt: 'bin', mime: 'application/octet-stream', size: '2.3 MB' }, refs: [['refund-fixtures.bin', 'art', 'a-bin']] }),
    // 历史尝试中的调用
    'h1-c1': T({ name: 'edit', src: 'oc', start: '09:13:02', end: '09:13:05', args: '修改 src/refund/service.ts', res: '+61 −4', att: 1,
      argv: { fmt: 'json', size: '0.4 KB', value: { filePath: 'src/refund/service.ts' } }, out: { fmt: 'text', size: '0.1 KB', plain: '已写入 src/refund/service.ts：+61 −4。' }, refs: [] }),
    'h1-c2': T({ name: 'bash', src: 'oc', start: '09:19:40', end: '09:20:22', args: 'npm run build', res: '退出码 2 · TS2322', att: 1,
      argv: { fmt: 'cmd', size: '0.1 KB', plain: 'npm run build' }, err: { fmt: 'cmd', exit: 2, size: '3.1 KB', file: 'h1build', total: 38 }, refs: [] }),
    'h2-c1': T({ name: 'edit', src: 'oc', start: '10:05:12', end: '10:05:15', args: '修改 src/refund/amount.ts', res: '+18 −6', att: 2,
      argv: { fmt: 'json', size: '0.3 KB', value: { filePath: 'src/refund/amount.ts' } }, out: { fmt: 'text', size: '0.1 KB', plain: '已写入 src/refund/amount.ts：+18 −6。' }, refs: [] }),
  };

  /* ---------- 长文本 / 代码样例 ---------- */
  F.DESIGN_PARAS = [
    ['第 1 节 · 范围', '退款流程覆盖全额退款、部分退款与重复请求三种情形。退款只能针对已支付成功的订单发起，单笔订单累计退款金额不得超过实付金额。'],
    ['第 2 节 · 状态', '退款单的状态由退款服务持有：PENDING、SUCCEEDED、FAILED。界面与调用方只读取状态，不自行推断；支付网关回调是唯一能把 PENDING 改为终态的入口。'],
    ['第 3 节 · 金额精度', '金额一律以整数“分”保存与传输，字段名统一为 amountCents。由“元”换算时先乘以 100 再四舍五入到整数，不使用银行家舍入；禁止在任何环节用浮点数累加金额。'],
    ['第 4 节 · 幂等', '每个退款请求必须携带调用方生成的 idempotencyKey。服务在同一订单内按幂等键去重：重复请求返回第一次的结果，不得产生第二笔退款，也不得改变已存在退款单的金额。'],
  ];

  function svcLines() {
    const head = [
      ['c', '// 退款服务：金额一律为整数分（amountCents）'],
      ['', "import { refunds } from './repo';"],
      ['', "import { toCents, assertRefundable } from './amount';"],
      ['', "import type { RefundRequest, Refund } from './types';"],
      ['', ''],
      ['c', '/** 同一个幂等键只产生一笔退款 */'],
      ['', 'export async function createRefund(req: RefundRequest): Promise<Refund> {'],
      ['', '  const existing = await refunds.findByKey(req.idempotencyKey);'],
      ['', '  if (existing) return existing;'],
      ['', '  const amountCents = toCents(req.amount);'],
      ['', '  assertRefundable(req.orderId, amountCents);'],
      ['', "  return refunds.create({ ...req, amountCents, status: 'PENDING' });"],
      ['', '}'],
      ['', ''],
    ];
    const out = head.map((x) => x[1]);
    const names = ['listRefunds', 'getRefund', 'markSucceeded', 'markFailed', 'sumRefunded', 'assertWithinPaid', 'toResponse', 'auditRefund'];
    let i = 0;
    while (out.length < 312) {
      const n = names[i % names.length] + (i >= names.length ? (Math.floor(i / names.length) + 1) : '');
      out.push(`export async function ${n}(orderId: string, opts: QueryOptions = {}): Promise<Refund[]> {`);
      out.push(`  const rows = await refunds.query({ orderId, limit: opts.limit ?? 50 });`);
      out.push(`  return rows.filter((r) => r.status !== 'FAILED').map(toResponse); // 第 ${i + 1} 组示例代码`);
      out.push('}');
      out.push('');
      i++;
    }
    return out.slice(0, 312);
  }
  function amountLines() {
    const L = [];
    L.push('// 金额工具：整数分（设计文档第 3 节）');
    L.push("import { RefundError } from './errors';");
    L.push('');
    for (let i = 4; i < 42; i++) {
      if (i % 6 === 4) L.push(`/** 辅助函数 ${Math.floor(i / 6)}：格式化与校验 */`);
      else if (i % 6 === 5) L.push(`export const fmt${Math.floor(i / 6)} = (cents: number): string => (cents / 100).toFixed(2);`);
      else L.push('');
    }
    L.push('/** 由“元”换算为整数分：先乘 100 再四舍五入 */'); // 42
    L.push('export const toCents = (yuan: number): number => {'); // 43
    L.push('  if (!Number.isFinite(yuan)) throw new RefundError(\'AMOUNT_INVALID\');'); // 44
    L.push('  const cents = Math.round(yuan * 100);'); // 45
    L.push('  if (cents <= 0) throw new RefundError(\'AMOUNT_NOT_POSITIVE\');'); // 46
    L.push('  return cents;'); // 47
    L.push('};'); // 48
    L.push('');
    L.push('export function assertRefundable(orderId: string, cents: number): void {');
    L.push('  // 累计退款不得超过实付金额（第 1 节）');
    L.push('  const paid = paidCents(orderId);');
    L.push('  if (refundedCents(orderId) + cents > paid) throw new RefundError(\'OVER_REFUND\');');
    L.push('}');
    while (L.length < 96) L.push(L.length % 4 ? '' : `// 其余样例代码 · 第 ${L.length + 1} 行`);
    return L;
  }
  function testLines(total, failing) {
    const L = [];
    L.push('> order-service@2.4.0 test');
    L.push('> jest -- refund');
    L.push('');
    if (failing) {
      L.push('FAIL src/refund/service.test.ts');
      L.push('  ● createRefund › 部分退款 › 12.345 元换算为 1235 分');
      L.push('');
      L.push('    expect(received).toBe(expected)');
      L.push('');
      L.push('    Expected: 1235');
      L.push('    Received: 1234');
      L.push('');
      L.push('      at Object.<anonymous> (src/refund/service.test.ts:88:31)');
      L.push('');
      L.push('  ● createRefund › 部分退款 › 0.005 元换算为 1 分');
      L.push('');
      L.push('    Expected: 1');
      L.push('    Received: 0');
      L.push('');
    }
    const cases = ['全额退款返回 PENDING', '重复请求返回第一次结果', '缺少幂等键时拒绝', '超过实付金额时拒绝', '金额为 0 时拒绝', '并发请求只产生一笔', '回调成功后为 SUCCEEDED', '回调失败后为 FAILED'];
    let n = 0;
    while (L.length < total - 6) {
      L.push(`PASS src/refund/case-${String(Math.floor(n / 8) + 1).padStart(3, '0')}.test.ts`);
      for (let k = 0; k < 8 && L.length < total - 6; k++, n++) L.push(`  ✓ ${cases[k]}（样例 ${n + 1}）(${(n * 7) % 23 + 2} ms)`);
    }
    L.push('');
    L.push(failing ? 'Test Suites: 1 failed, 12 passed, 13 total' : 'Test Suites: 13 passed, 13 total');
    L.push(failing ? 'Tests:       2 failed, 39 passed, 41 total' : 'Tests:       41 passed, 41 total');
    L.push('Time:        ' + (failing ? '47.82 s' : '34.11 s'));
    L.push('Ran all test suites matching /refund/i.');
    L.push('');
    return L.slice(0, total);
  }
  function buildLines(total) {
    const L = ['> order-service@2.4.0 build', '> tsc -p tsconfig.build.json --listEmittedFiles', ''];
    let i = 0;
    while (L.length < total) { L.push(`TSFILE: dist/refund/generated/module-${String(i).padStart(4, '0')}.js`); i++; }
    return L;
  }
  function h1BuildLines() {
    return ['> order-service@2.4.0 build', '> tsc -p tsconfig.build.json', '',
      "src/refund/service.ts(57,11): error TS2322: Type 'number' is not assignable to type 'RefundAmount'.", '',
      '57     amount: req.amount,', '             ~~~~~~', '',
      "  src/refund/types.ts(12,3): The expected type comes from property 'amount' which is declared here on type 'RefundDraft'.", '',
      'Found 1 error in src/refund/service.ts:57', '', 'npm ERR! code 2', 'npm ERR! command failed'].concat(Array.from({ length: 24 }, (_, i) => `npm ERR! 样例日志行 ${i + 1}`));
  }
  const cache = {};
  F.lines = (file) => {
    if (cache[file]) return cache[file];
    const map = { service: svcLines, amount: amountLines, test: () => testLines(1840, true), 'test-ok': () => testLines(1712, false), build: () => buildLines(1210), h1build: h1BuildLines,
      'svc-r1': () => svcLines().slice(0, 60).map((l) => l.replace('amountCents', 'amount')) };
    return (cache[file] = map[file]());
  };
  F.EXCERPT = { file: 'docs/runbook/refund-ops.md', from: 40, lines: [
    '## 退款对账异常', '', '当同一订单出现两笔 PENDING 退款时：', '',
    '1. 先按 idempotencyKey 查询两笔记录是否来自同一请求；', '2. 若幂等键为空，说明请求来自旧版本接口，需人工确认；', '3. 不要直接取消其中一笔，等待支付网关回调给出终态。', '',
    '> 对账脚本每日 02:00 运行，只读取退款服务的状态，不修改退款单。', '',
    '| 情形 | 处理 |', '|---|---|', '| 幂等键相同 | 视为同一请求 |', '| 幂等键为空 | 人工确认 |', '',
    '排查时可以用只读账号查询 refunds 表；账号凭据由运维平台托管，不写入文档。', '', '## 回调重放', '', '回调重放只能由支付网关发起。', ''] };

  F.NOTES_MD = '# 实现说明 · 退款接口\n\n本说明随结果 r3 提交，描述这次尝试做了什么、没做什么。\n\n## 已完成\n\n- 新增 `POST /api/refunds`，`idempotencyKey` 必填\n- 金额统一为整数分，字段名 `amountCents`\n- `toCents` 改为先乘 100 再四舍五入（设计文档第 3 节）\n- 退款模块单元测试 41 个通过\n\n## 未完成 / 需要后续确认\n\n- 旧接口 `POST /refund`（幂等键为空）仍在被 2 个调用方使用，本步骤没有下线它\n- 数据库迁移没有执行：`refunds.idempotency_key` 需要加唯一索引，迁移脚本放在 `migration-plan.md`（尚未生成）\n\n## 验证方式\n\n```sh\nnpm run build\nnpm test -- refund\n```\n\n| 检查 | 结果 |\n|---|---|\n| 构建 | 通过 |\n| 单元测试 | 41 通过 · 0 失败 |\n';

  F.RESULT_R3 = { resultRev: 'r3', summary: '新增退款接口，金额统一为整数分，幂等键必填', changes: [
    { file: 'src/refund/amount.ts', added: 27, removed: 10 },
    { file: 'src/refund/service.ts', added: 86, removed: 12 },
    { file: 'src/api/refunds.route.ts', added: 54, removed: 0 }], tests: { passed: 41, failed: 0, skipped: 0 }, followUps: ['下线旧接口 POST /refund', '为 refunds.idempotency_key 加唯一索引'] };

  /* ---------- 产物与引用（属于各自尝试） ---------- */
  F.ARTS = {
    'a-svc': { name: 'refund-service.ts', rev: 'r3', sha: '9f3c2a7e5b1d4c08', kind: 'code', lang: 'ts', file: 'service', mime: 'text/typescript', size: '11.4 KB', from: '工具调用 #c-9b12', dl: 'ok', type: '代码' },
    'a-notes': { name: '实现说明.md', rev: 'r3', sha: '4e8d1b0c7a93f25e', kind: 'md', mime: 'text/markdown', size: '1.3 KB', from: '结果 r3', dl: 'ok', type: 'Markdown' },
    'a-result': { name: 'refund-result.json', rev: 'r3', sha: 'b71e04c9d2a35f8e', kind: 'json', mime: 'application/json', size: '0.6 KB', from: '结果 r3', dl: 'ok', type: 'JSON' },
    'a-log': { name: 'test-output.txt', rev: 'r3', sha: 'c08a7e64d1b2f3a9', kind: 'text', file: 'test-ok', mime: 'text/plain', size: '88 KB', from: '工具调用 #c-f4b8', dl: 'fail-once', type: '纯文本' },
    'a-bin': { name: 'refund-fixtures.bin', rev: 'r3', sha: '1d4c08a6f2e91b7d', kind: 'bin', mime: 'application/octet-stream', size: '2.3 MB', from: '工具调用 #c-0d6c', dl: 'none', type: '二进制' },
    'a-cov': { name: 'coverage-summary.txt', rev: '—', sha: null, kind: 'pending', mime: 'text/plain', size: '—', from: '结果 r3', dl: 'none', type: '纯文本' },
    'a-missing': { name: 'migration-plan.md', rev: 'r3', sha: '5b1d4c08a6f2e91b', kind: 'missing', mime: 'text/markdown', size: '—', from: '实现说明 · 引用', dl: 'none', type: 'Markdown' },
    'a-denied': { name: '生产配置核对.md', rev: 'r3', sha: 'e8b6f1d29f3c2a7e', kind: 'denied', mime: 'text/markdown', size: '—', from: '结果 r3', dl: 'none', type: 'Markdown' },
    'a-yaml': { name: 'api-contract.yaml', rev: 'r3', sha: 'a6f2e91b7d3c5a40', kind: 'readfail', mime: 'application/yaml', size: '3.8 KB', from: '结果 r3', dl: 'ok', type: '文本' },
    'h1-svc': { name: 'refund-service.ts', rev: 'r1', sha: '0c7a93f25e6d01b8', kind: 'expired', mime: 'text/typescript', size: '—', from: '尝试 #1 · 工具调用 #h1-c1', dl: 'none', type: '代码' },
    'h2-svc': { name: 'refund-service.ts', rev: 'r2', sha: '7a93f25e6d01b8c4', kind: 'expired', mime: 'text/typescript', size: '—', from: '尝试 #2 · 工具调用 #h2-c1', dl: 'none', type: '代码' },
    'h2-result': { name: 'refund-result.json', rev: 'r2', sha: '3f25e6d01b8c4a7f', kind: 'json', value: 'r2', mime: 'application/json', size: '0.4 KB', from: '结果 r2', dl: 'ok', type: 'JSON' },
  };
  F.CITES = {
    'cite-src': { name: 'refund-design.md', rev: 'r2', kind: 'source', para: 2, path: 'docs/design/refund-design.md', note: '正文引用 [1] · 第 3 节', latest: 'r2' },
    'cite-code': { name: 'amount.ts', rev: 'r3', kind: 'code', lines: [42, 48], path: 'src/refund/amount.ts', note: '工具调用 #c-9b12 · 第 42–48 行', latest: 'r5' },
    'cite-excerpt': { name: 'refund-ops.md', rev: 'r7', kind: 'excerpt', path: 'docs/runbook/refund-ops.md', note: '只有节选 · 第 40–60 行附近', latest: 'r7' },
    'cite-summary': { name: '支付网关退款说明', rev: '—', kind: 'summary', path: '外部资料 · 服务只提供摘要', note: '摘要 · 无原文定位', latest: null,
      text: '支付网关对同一商户订单号的退款请求按“商户退款单号”去重；退款结果以异步回调为准，查询接口只用于补偿，不应作为终态依据。' },
  };

  window.ND_FIXTURES = F;
})();
