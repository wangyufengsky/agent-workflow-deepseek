/* opencode-workflow · Git 任务变更（TD03 / TD04 / TD07）· 合成样例数据
   全部虚构：项目、人名、地址、SHA、请求 key 都不是真实数据；不含任何凭据。
   差异沿用 git-workbench 原型的小格式：首行留空；' ' 上下文 / '-' 删除 / '+' 新增；
   '~N' = N 行未改动且原型没有写出的上下文（展开时用占位行）；'!' 前缀 = 只有空白不同。
   新增 / 删除整文件用 plus() / minus() 生成前缀，行数与统一样例故事一致（+182 / +96 / −58 等）。 */
(function () {
  'use strict';
  const plus = (t) => '\n' + t.replace(/^\n/, '').replace(/\n$/, '').split('\n').map((l) => '+' + l).join('\n');
  const minus = (t) => '\n' + t.replace(/^\n/, '').replace(/\n$/, '').split('\n').map((l) => '-' + l).join('\n');

  /* ---------- 任务与工作区身份（与 TD-SPEC §1 一致）---------- */
  const TASK = {
    id: 'T-2041', name: '退款单分页查询与导出', exec: 'ex-2041', flow: '需求开发 · 标准',
    project: '订单服务', projectPath: '/Users/dev/workspace/order-service', gitlab: 'shop/order-service',
    branch: 'task/T-2041-refund-export', base: 'main', baseSha: '7c1e9a2', baseFull: '7c1e9a24b8d0f3e6a51c9d27e80b4f6a3c2d1e05',
    ws: 'order-service · T-2041', wsPath: '~/.opencode-workflow/workspaces/order-service/T-2041',
    rev: 'cr-7', readAt: '16:02', origDirty: 3,
    author: 'dev-zhang <dev@example.com>', account: 'dev-zhang', host: 'gitlab.example.internal', remote: 'origin', conn: 'conn-v4', connAt: '15:58',
    newSha: '9d8c7b6', newFull: '9d8c7b6a5f4e3d2c1b0a99887766554433221100',
    mr: '!58', mrIid: 58, mrUrl: 'gitlab.example.internal/shop/order-service/-/merge_requests/58',
    times: { commit: '16:06', push: '16:12', mr: '16:19', delivered: '16:20', mrRead: '16:24' },
    keys: { commit: 'op-commit-9d8c', push: 'op-push-31f0', pushFailed: 'op-push-2a17', mr: 'op-mr-58c2', delivery: 'dv-3' },
    driftTip: '4b7e2d0',
  };

  /* ---------- src/refund/export.ts（A，+182）---------- */
  const EXPORT_TS = plus(`
import { Money } from '../common/money';
import { RefundRecord, RefundStatus } from './types';
import { toXlsx } from '../common/xlsx';

/** 导出格式：CSV 默认 UTF-8 BOM，便于 Excel 直接打开 */
export type ExportFormat = 'csv' | 'xlsx';

export interface RefundQuery {
  orderId?: string;
  status?: RefundStatus;
  createdFrom?: Date;
  createdTo?: Date;
  pageSize?: number;
}

export interface PageCursor {
  /** 上一页最后一条退款单的 id（游标分页，不用 offset） */
  after: string;
}

export interface ExportFile {
  name: string;
  mime: string;
  body: Buffer;
  rows: number;
}

interface Column {
  key: string;
  title: string;
  width: number;
  value: (r: RefundRecord) => string;
}

const fmtTime = (d: Date | null) => (d ? d.toISOString().replace('T', ' ').slice(0, 19) : '');
const fmtMoney = (cents: number) => Money.format(cents, { symbol: false });

/** 导出列：顺序即文件列顺序；金额一律以「分」入库、导出时格式化为元 */
export const COLUMNS: Column[] = [
  { key: 'refundNo', title: '退款单号', width: 22, value: (r) => r.refundNo },
  { key: 'orderNo', title: '订单号', width: 20, value: (r) => r.orderNo },
  { key: 'status', title: '状态', width: 10, value: (r) => STATUS_TEXT[r.status] },
  { key: 'amount', title: '退款金额（元）', width: 14, value: (r) => fmtMoney(r.cents) },
  { key: 'paid', title: '实付金额（元）', width: 14, value: (r) => fmtMoney(r.paidCents) },
  { key: 'reason', title: '退款原因', width: 24, value: (r) => r.reasonText ?? '' },
  { key: 'channel', title: '退款渠道', width: 12, value: (r) => r.channel },
  { key: 'operator', title: '操作人', width: 12, value: (r) => r.operator ?? '系统' },
  { key: 'createdAt', title: '申请时间', width: 20, value: (r) => fmtTime(r.createdAt) },
  { key: 'finishedAt', title: '完成时间', width: 20, value: (r) => fmtTime(r.finishedAt) },
];

const STATUS_TEXT: Record<RefundStatus, string> = {
  pending: '待处理',
  processing: '处理中',
  succeeded: '已退款',
  failed: '失败',
  cancelled: '已取消',
};

/** 单页上限：列表接口与导出共用 */
export const MAX_PAGE_SIZE = 200;

/** 解析查询参数；非法值直接拒绝，不静默忽略 */
export function parseRefundQuery(q: Record<string, string | undefined>): RefundQuery {
  const out: RefundQuery = {};
  if (q.orderId) out.orderId = q.orderId.trim();
  if (q.status) {
    if (!(q.status in STATUS_TEXT)) throw new RangeError(\`未知的退款状态：\${q.status}\`);
    out.status = q.status as RefundStatus;
  }
  if (q.createdFrom) out.createdFrom = parseDate(q.createdFrom, 'createdFrom');
  if (q.createdTo) out.createdTo = parseDate(q.createdTo, 'createdTo');
  if (out.createdFrom && out.createdTo && out.createdFrom > out.createdTo) {
    throw new RangeError('createdFrom 不能晚于 createdTo');
  }
  if (q.pageSize) {
    const n = Number(q.pageSize);
    if (!Number.isInteger(n) || n < 1) throw new RangeError('pageSize 必须是正整数');
    out.pageSize = Math.min(n, MAX_PAGE_SIZE);
  }
  return out;
}

export function parseCursor(after?: string): PageCursor | undefined {
  if (!after) return undefined;
  if (!/^rf_[0-9a-z]{10,}$/.test(after)) throw new RangeError('游标格式不正确');
  return { after };
}

function parseDate(v: string, field: string): Date {
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw new RangeError(\`\${field} 不是合法时间\`);
  return d;
}

/** CSV 单元格转义：含逗号、引号、换行时整体加引号，引号翻倍 */
export function escapeCsv(v: string): string {
  if (/[",\\r\\n]/.test(v)) return '"' + v.replace(/"/g, '""') + '"';
  // 防止以 = + - @ 开头的内容在表格软件里被当作公式执行
  if (/^[=+\\-@]/.test(v)) return "'" + v;
  return v;
}

export function toCsvRow(r: RefundRecord): string {
  return COLUMNS.map((c) => escapeCsv(c.value(r))).join(',');
}

const BOM = '\\uFEFF';

/**
 * 按页读取并写出：pages 每次产出一页退款单（最多 MAX_PAGE_SIZE 条）。
 * 不把全部记录一次载入内存；XLSX 受库限制仍需在内存中组装，行数上限 100 万。
 */
export async function exportRefunds(
  pages: AsyncIterable<RefundRecord[]>,
  format: ExportFormat,
): Promise<ExportFile> {
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  if (format === 'csv') {
    const chunks: string[] = [BOM + COLUMNS.map((c) => c.title).join(',')];
    let rows = 0;
    for await (const page of pages) {
      for (const r of page) chunks.push(toCsvRow(r));
      rows += page.length;
    }
    return {
      name: \`refunds-\${stamp}.csv\`,
      mime: 'text/csv; charset=utf-8',
      body: Buffer.from(chunks.join('\\r\\n'), 'utf8'),
      rows,
    };
  }
  const sheet: string[][] = [COLUMNS.map((c) => c.title)];
  for await (const page of pages) {
    for (const r of page) sheet.push(COLUMNS.map((c) => c.value(r)));
    if (sheet.length > XLSX_MAX_ROWS) {
      throw new RangeError(\`XLSX 最多导出 \${XLSX_MAX_ROWS} 行，请缩小时间范围或改用 CSV\`);
    }
  }
  return {
    name: \`refunds-\${stamp}.xlsx\`,
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    body: await toXlsx(sheet, { widths: COLUMNS.map((c) => c.width), freezeHeader: true }),
    rows: sheet.length - 1,
  };
}

const XLSX_MAX_ROWS = 1_000_000;

/** 导出文件名里的日期按服务器时区；时区在部署配置 ORDER_TZ 中设置 */
export function exportFileName(format: ExportFormat, at = new Date()): string {
  const d = at.toISOString().slice(0, 10).replace(/-/g, '');
  return \`refunds-\${d}.\${format}\`;
}

/** 只导出部分列：fields 为空时导出全部列；未知列名直接报错 */
export function columnsFor(fields?: string[]): Column[] {
  if (!fields || !fields.length) return COLUMNS;
  const byKey = new Map(COLUMNS.map((c) => [c.key, c]));
  return fields.map((k) => {
    const c = byKey.get(k);
    if (!c) throw new RangeError(\`未知的导出列：\${k}\`);
    return c;
  });
}

/** 导出摘要：写入审计日志，不含任何金额明细 */
export function exportSummary(file: ExportFile, query: RefundQuery) {
  return {
    name: file.name,
    rows: file.rows,
    bytes: file.body.length,
    orderId: query.orderId ?? null,
    status: query.status ?? null,
  };
}

/** 给导出接口的限流与超时配置（路由层使用） */
export const EXPORT_LIMITS = {
  perMinute: 6,
  timeoutMs: 120_000,
} as const;
`);

  /* ---------- src/refund/service.ts（M，+37 −14）---------- */
  const serviceTs = (rev8) => `
 import { Injectable } from '../common/di';
 import { RefundRepository } from './repository';
-import { exportLegacy } from './legacy-export';
+import { exportRefunds, ExportFormat, RefundQuery, PageCursor, MAX_PAGE_SIZE } from './export';
 import { logger } from '../common/logger';
~6
 @Injectable()
 export class RefundService {
   constructor(private readonly repo: RefundRepository) {}
~18
-  async list(orderId: string, page = 1) {
-    const rows = await this.repo.findByOrder(orderId);
-    return rows.slice((page - 1) * 20, page * 20);
-  }
+  /** 分页查询退款单：游标分页，pageSize 上限 200 */${rev8 ? `
+  // 16:04 补充：pageSize 超过上限时按上限截断，不报错（与列表页约定一致）
+  // 见 SHOP-1841 评论 #12` : ''}
+  async list(query: RefundQuery, cursor?: PageCursor) {
+    const pageSize = Math.min(query.pageSize ?? 20, MAX_PAGE_SIZE);
+    const rows = await this.repo.findPage({
+      orderId: query.orderId,
+      status: query.status,
+      createdFrom: query.createdFrom,
+      createdTo: query.createdTo,
+      after: cursor?.after,
+      limit: pageSize + 1,
+    });
+    const hasMore = rows.length > pageSize;
+    const items = hasMore ? rows.slice(0, pageSize) : rows;
+    return { items, next: hasMore ? { after: items[items.length - 1].id } : null };
+  }

-  async export(orderId: string) {
-    const rows = await this.repo.findByOrder(orderId);
-    logger.info('export refunds', { orderId, count: rows.length });
-    return exportLegacy(rows);
-  }
+  /** 导出：按页读取，避免一次性载入全部退款单 */
+  async export(query: RefundQuery, format: ExportFormat) {
+    let total = 0;
+    const self = this;
+    async function* pages() {
+      let cursor: PageCursor | undefined;
+      do {
+        const page = await self.list({ ...query, pageSize: EXPORT_PAGE_SIZE }, cursor);
+        total += page.items.length;
+        yield page.items;
+        cursor = page.next ?? undefined;
+      } while (cursor);
+    }
+    const file = await exportRefunds(pages(), format);
+    logger.info('export refunds', { orderId: query.orderId, total, format });
+    return file;
+  }
~4
!-	async detail(id: string) {
!+  async detail(id: string) {
~4
-  private toYuan(cents: number) {
-    return (cents / 100).toFixed(2);
-  }
+  // 金额格式化移到 export.ts 的列定义（Money.format）
 }
+
+const EXPORT_PAGE_SIZE = MAX_PAGE_SIZE;
~4`;

  /* ---------- src/refund/controller.ts（M，+12 −3）---------- */
  const CONTROLLER_TS = `
 import { Controller, Get, Query, Res, Response } from '../common/http';
 import { RefundService } from './service';
+import { parseRefundQuery, parseCursor } from './export';
~5
 @Controller('/refunds')
 export class RefundController {
   constructor(private readonly svc: RefundService) {}

   @Get('/')
-  async list(@Query('orderId') orderId: string, @Query('page') page = '1') {
-    return this.svc.list(orderId, Number(page));
+  async list(@Query() q: Record<string, string>) {
+    return this.svc.list(parseRefundQuery(q), parseCursor(q.after));
   }

   @Get('/export')
-  async export(@Query('orderId') orderId: string, @Res() res: Response) {
+  async export(@Query() q: Record<string, string>, @Res() res: Response) {
+    const format = q.format === 'xlsx' ? 'xlsx' : 'csv';
+    const file = await this.svc.export(parseRefundQuery(q), format);
+    // 文件名由服务按日期生成，不信任前端传入
+    res.setHeader('Content-Type', file.mime);
+    res.setHeader('Content-Disposition', \`attachment; filename="\${file.name}"\`);
+    res.setHeader('X-Export-Rows', String(file.rows));
+    if (!file.rows) res.setHeader('X-Export-Empty', '1');
+    return res.send(file.body);
   }
~3`;

  /* ---------- src/api/refunds.route.ts（M，+6 −1）---------- */
  const ROUTE_TS = `
 import { Router } from '../common/http';
 import { RefundController } from '../refund/controller';
+import { EXPORT_LIMITS } from '../refund/export';
~4
 export const refundRoutes = (r: Router, c: RefundController) => {
   r.get('/refunds', c.list.bind(c));
-  r.get('/refunds/export', c.export.bind(c));
+  // 导出可能较慢：单独限流，超时放宽到 120 秒
+  r.get('/refunds/export', {
+    rateLimit: { perMinute: EXPORT_LIMITS.perMinute },
+    timeoutMs: EXPORT_LIMITS.timeoutMs,
+  }, c.export.bind(c));
   r.get('/refunds/:id', c.detail.bind(c));
 };`;

  /* ---------- test/refund/export.spec.ts（A，+96）---------- */
  const SPEC_TS = plus(`
import { describe, it, expect } from 'vitest';
import { escapeCsv, toCsvRow, parseRefundQuery, parseCursor, exportRefunds, columnsFor, MAX_PAGE_SIZE } from '../../src/refund/export';
import { makeRefund } from './fixtures';

async function* pagesOf(...pages: ReturnType<typeof makeRefund>[][]) {
  for (const p of pages) yield p;
}

describe('escapeCsv', () => {
  it('普通文本原样输出', () => {
    expect(escapeCsv('退款')).toBe('退款');
  });
  it('含逗号或引号时加引号并把引号翻倍', () => {
    expect(escapeCsv('a,b')).toBe('"a,b"');
    expect(escapeCsv('说"明"')).toBe('"说""明"""');
  });
  it('防止公式注入', () => {
    expect(escapeCsv('=SUM(A1:A9)')).toBe("'=SUM(A1:A9)");
    expect(escapeCsv('@cmd')).toBe("'@cmd");
  });
});

describe('toCsvRow', () => {
  it('金额按分格式化为元，空完成时间输出空串', () => {
    const r = makeRefund({ cents: 1990, paidCents: 5000, finishedAt: null });
    const cols = toCsvRow(r).split(',');
    expect(cols[3]).toBe('19.90');
    expect(cols[4]).toBe('50.00');
    expect(cols[9]).toBe('');
  });
});

describe('parseRefundQuery', () => {
  it('pageSize 超过上限时按上限截断', () => {
    expect(parseRefundQuery({ pageSize: '5000' }).pageSize).toBe(MAX_PAGE_SIZE);
  });
  it('pageSize 非正整数时报错', () => {
    expect(() => parseRefundQuery({ pageSize: '0' })).toThrow('pageSize');
    expect(() => parseRefundQuery({ pageSize: '2.5' })).toThrow('pageSize');
  });
  it('时间范围颠倒时报错', () => {
    expect(() => parseRefundQuery({ createdFrom: '2026-10-02', createdTo: '2026-10-01' })).toThrow();
  });
  it('未知状态报错，不静默忽略', () => {
    expect(() => parseRefundQuery({ status: 'done' })).toThrow('未知的退款状态');
  });
});

describe('parseCursor', () => {
  it('空游标返回 undefined', () => {
    expect(parseCursor(undefined)).toBeUndefined();
  });
  it('格式不对时报错', () => {
    expect(() => parseCursor('123')).toThrow('游标');
  });
});

describe('exportRefunds', () => {
  it('CSV：带 BOM 与表头，逐页写出', async () => {
    const a = [makeRefund({ refundNo: 'R1' }), makeRefund({ refundNo: 'R2' })];
    const b = [makeRefund({ refundNo: 'R3' })];
    const f = await exportRefunds(pagesOf(a, b), 'csv');
    const text = f.body.toString('utf8');
    expect(text.startsWith('\\uFEFF退款单号,订单号')).toBe(true);
    expect(f.rows).toBe(3);
    expect(text.split('\\r\\n')).toHaveLength(4);
  });
  it('分页边界：恰好 MAX_PAGE_SIZE 条时不丢最后一条', async () => {
    const page = Array.from({ length: MAX_PAGE_SIZE }, (_, i) => makeRefund({ refundNo: 'R' + i }));
    const f = await exportRefunds(pagesOf(page), 'csv');
    expect(f.rows).toBe(MAX_PAGE_SIZE);
  });
  it('空结果仍输出表头', async () => {
    const f = await exportRefunds(pagesOf([]), 'csv');
    expect(f.rows).toBe(0);
    expect(f.body.toString('utf8')).toContain('退款单号');
  });
  it('XLSX：文件名与 MIME 正确', async () => {
    const f = await exportRefunds(pagesOf([makeRefund({})]), 'xlsx');
    expect(f.name).toMatch(/^refunds-\\d{8}\\.xlsx$/);
    expect(f.mime).toContain('spreadsheetml');
    expect(f.rows).toBe(1);
  });
});

describe('columnsFor', () => {
  it('不传 fields 时返回全部列', () => {
    expect(columnsFor()).toHaveLength(10);
  });
  it('按给定顺序返回所选列', () => {
    expect(columnsFor(['amount', 'refundNo']).map((c) => c.key)).toEqual(['amount', 'refundNo']);
  });
  it('未知列名报错', () => {
    expect(() => columnsFor(['foo'])).toThrow('未知的导出列');
  });
});
`);

  /* ---------- src/refund/legacy-export.ts（D，−58）---------- */
  const LEGACY_TS = minus(`
import { RefundRecord } from './types';

/**
 * 旧版导出：一次性读取订单下全部退款单并拼接 CSV。
 * 问题：没有分页、金额用浮点、没有转义，已由 export.ts 替代。
 * 原计划保留到 v2.3，本任务提前删除（路由已切换）。
 */
export function exportLegacy(rows: RefundRecord[]): string {
  const header = 'refund_no,order_no,status,amount,created_at';
  const lines = [header];
  for (const r of rows) {
    lines.push([
      r.refundNo,
      r.orderNo,
      r.status,
      (r.cents / 100).toFixed(2),
      r.createdAt.toISOString(),
    ].join(','));
  }
  return lines.join('\\n');
}

export function legacyFileName(orderId: string): string {
  return 'refunds_' + orderId + '.csv';
}

/** 旧接口兼容：按订单号导出并返回下载头 */
export function legacyHeaders(orderId: string) {
  return {
    'Content-Type': 'text/csv',
    'Cache-Control': 'no-store',
    'Content-Disposition': 'attachment; filename=' + legacyFileName(orderId),
  };
}

/** 旧版金额汇总，只用于导出末行 */
export function legacyTotal(rows: RefundRecord[]): string {
  let sum = 0;
  for (const r of rows) {
    if (r.status === 'succeeded') sum += r.cents / 100;
  }
  return sum.toFixed(2);
}

export function legacyExportWithTotal(rows: RefundRecord[]): string {
  return exportLegacy(rows) + '\\n' + ',,,' + legacyTotal(rows) + ',';
}

// 兼容 v1 报表脚本的列名映射
export const LEGACY_COLUMNS = {
  refund_no: 'refundNo',
  order_no: 'orderNo',
  status: 'status',
  amount: 'cents',
  created_at: 'createdAt',
} as const;

export default exportLegacy;
`);

  /* ---------- fixtures/refunds-2026.csv（M，2.4 MB，分段读取）---------- */
  function csvRows(from, n) {
    const st = ['succeeded', 'succeeded', 'succeeded', 'failed', 'cancelled', 'processing'];
    const ch = ['原路退回', '原路退回', '余额', '银行卡'];
    const out = [];
    for (let i = 0; i < n; i++) {
      const k = from + i;
      const day = String(1 + (k % 28)).padStart(2, '0'), mon = String(1 + Math.floor(k / 120) % 10).padStart(2, '0');
      const cents = 990 + ((k * 7919) % 48000);
      out.push(`+R2026${String(k).padStart(6, '0')},O88${String(120000 + k * 37).slice(-6)},${st[k % st.length]},${(cents / 100).toFixed(2)},${((cents + 2000 + (k % 9) * 300) / 100).toFixed(2)},${ch[k % ch.length]},2026-${mon}-${day} ${String(8 + (k % 12)).padStart(2, '0')}:${String((k * 13) % 60).padStart(2, '0')}:00`);
    }
    return out.join('\n');
  }
  const CSV = `
-refund_no,order_no,status,amount,created_at
+refund_no,order_no,status,amount,paid,channel,created_at
 R2025000001,O88120037,succeeded,19.90,39.90,原路退回,2025-01-01 08:00:00
 R2025000002,O88120074,succeeded,128.00,148.00,原路退回,2025-01-02 09:13:00
 R2025000003,O88120111,failed,56.30,76.30,余额,2025-01-03 10:26:00
~21468
 R2025021472,O88914501,succeeded,88.00,108.00,银行卡,2025-12-28 17:49:00
 R2025021473,O88914538,cancelled,12.50,32.50,原路退回,2025-12-29 18:02:00
 R2025021474,O88914575,succeeded,301.20,321.20,原路退回,2025-12-30 19:15:00
${csvRows(1, 1203)}`;

  const FILES = [
    { p: 'src/refund/export.ts', st: 'A', src: EXPORT_TS, kind: 'ts' },
    { p: 'src/refund/service.ts', st: 'M', src: serviceTs(false), src8: serviceTs(true), kind: 'ts' },
    { p: 'src/refund/controller.ts', st: 'M', src: CONTROLLER_TS, kind: 'ts' },
    { p: 'src/api/refunds.route.ts', st: 'M', src: ROUTE_TS, kind: 'ts' },
    { p: 'test/refund/export.spec.ts', st: 'A', src: SPEC_TS, kind: 'ts' },
    { p: 'src/refund/legacy-export.ts', st: 'D', src: LEGACY_TS, kind: 'ts' },
    { p: 'fixtures/refunds-2026.csv', st: 'M', src: CSV, large: true, size: '2.4 MB', kind: 'csv' },
    { p: 'docs/export-sample.xlsx', st: 'A', binary: { before: null, after: '48 KB' }, ident: 'sha256:3f9a0c…e21b' },
    { p: 'scripts/export.sh', st: 'M', mode: ['100644', '100755'] },
  ];
  /* 默认选择：整文件，除 docs/export-sample.xlsx（二进制样例，用户决定先不交付）以外全部选中 */
  const DEFAULT_SEL = FILES.map((f) => f.p).filter((p) => p !== 'docs/export-sample.xlsx');

  /* ---------- 未纳入 / 忽略（服务扫描结果；排除原因必须可见）---------- */
  const EXCLUDED = [
    { p: 'dist/', kind: '构建产物', rule: '.gitignore 第 3 行 · dist/', count: '14 个文件 · 1.1 MB', note: '由「实现接口」节点的构建命令生成。不进入交付，也不会被清理。', hidden: false },
    { p: '.env.local', kind: '忽略规则', rule: '.gitignore 第 7 行 · .env*.local', count: '1 个文件', note: '可能含本机密钥：服务不读取、本页不显示内容，也不提供预览或加入交付。', hidden: true },
    { p: 'coverage/', kind: '工具生成', rule: '.gitignore 第 5 行 · coverage/', count: '37 个文件 · 2.6 MB', note: '「编写测试」节点运行覆盖率时生成。覆盖率摘要见「验证与成果」。', hidden: false },
  ];

  /* ---------- 验证与成果（任务目标 / 节点成果 / 验收；没有 AI 审查问题）---------- */
  const RESULTS = {
    goal: '退款单列表支持按订单、状态和申请时间筛选，改为游标分页（单页最多 200 条）；新增 CSV / XLSX 导出，导出按页读取、不一次载入全部数据；用新实现替换旧的 legacy-export。',
    nodes: [
      ['梳理需求', '产品经理', '已完成', '需求说明 v2：筛选项、分页约定、导出列与上限'],
      ['实现接口', '软件工程师', '已完成', '子工作区 · 15:31 汇合到任务工作区（汇合由服务执行）'],
      ['编写测试', '测试工程师', '已完成', '子工作区 · 15:33 汇合；新增 16 个导出用例'],
      ['回归测试', '测试工程师', '已通过', '在任务工作区一致快照上运行'],
      ['人工验收', '张伟', '已通过', '15:52 通过：「导出 2 万行用时 4.1 秒，可以交付」'],
    ],
    verify: [
      ['单元测试', '41 / 41 通过', 'ok', 'npm test · 用时 18 秒 · 15:40'],
      ['lint', '通过', 'ok', 'npm run lint · 0 错误 0 警告'],
      ['回归测试', '通过', 'ok', '订单、退款、导出 3 组 · 15:47'],
    ],
    accept: [
      '列表接口支持 orderId / status / createdFrom / createdTo 筛选',
      '游标分页，pageSize 超过 200 时截断，非法值报错',
      'CSV 带 BOM、转义逗号 / 引号并防公式注入；XLSX 冻结表头',
      '旧导出 legacy-export 删除，路由切换到新实现',
    ],
  };

  /* ---------- 提交 hook 输出（已脱敏）---------- */
  const HOOK_OUT = `husky > commit-msg (node v20.11.1)
✖ subject-issue: 提交信息需要关联需求单，格式 "Refs: SHOP-<编号>"
  输入：feat: 退款单分页查询与导出
  提示：在正文末尾加一行 Refs: SHOP-1841
  环境：GITLAB_TOKEN=[已脱敏]  HOOK_USER=dev-zhang
husky > commit-msg hook exited with code 1 (error)`;

  const MSG = 'feat: 退款单分页查询与导出\n\n- 退款单列表改为游标分页，支持订单 / 状态 / 时间筛选（单页 ≤ 200）\n- 新增 CSV / XLSX 导出，按页读取\n- 删除 legacy-export，路由切换到新实现\n\nRefs: SHOP-1841\nTask: T-2041';
  const MSG_NO_REF = MSG.replace('\n\nRefs: SHOP-1841', '');
  const MR_DESC = '任务 T-2041「退款单分页查询与导出」的交付。\n\n- 游标分页与筛选：src/refund/service.ts、controller.ts\n- 导出：src/refund/export.ts（CSV / XLSX）\n- 删除 src/refund/legacy-export.ts\n\n验证：单元测试 41/41 通过 · lint 通过 · 回归测试通过 · 人工验收通过（张伟 15:52）\n未纳入本次提交：docs/export-sample.xlsx（留在任务工作区）';

  /* ---------- 普通历史（退出任务上下文后可见）---------- */
  const COMMITS = [
    ['7c1e9a2', '修复订单导出的时区偏移', '王芳', '10-15 11:20', ['main', 'origin/main']],
    ['6b0d8f1', 'Merge branch \'feature/pay-retry\' into \'main\'', '陈静', '10-14 18:02', []],
    ['5a9c7e0', '支付回调失败后指数退避重试', '陈静', '10-14 17:40', []],
    ['4f8b6d9', '订单详情接口返回支付渠道', '刘洋', '10-14 10:12', []],
    ['3e7a5c8', '退款单表增加 channel 字段', '张伟', '10-13 16:05', []],
    ['2d6f4b7', '升级 Node 20 与依赖', '李娜', '10-13 09:30', []],
  ];
  const BRANCHES = [
    { n: 'main', cur: true, lock: true, sha: '7c1e9a2', msg: '修复订单导出的时区偏移', when: '10-15 11:20', note: '原工作区当前分支 · 3 个未提交改动' },
    { n: 'task/T-2041-refund-export', task: 'T-2041', sha: '7c1e9a2', msg: '（基线，尚未提交）', when: '10-15 09:52', note: '任务分支 · 系统生成 · 在任务工作区检出' },
    { n: 'task/T-2042-coupon-expiry', task: 'T-2042', sha: '7c1e9a2', msg: '（基线，尚未提交）', when: '10-15 10:30', note: '任务分支 · 后台任务待交付' },
    { n: 'feature/refund', sha: 'e4f5a6b', msg: '补充退款单查询的分页参数', when: '10-13 10:31', note: '' },
  ];
  const MRS = [
    { id: '!58', title: 'feat: 退款单分页查询与导出', src: 'task/T-2041-refund-export', dst: 'main', who: 'dev-zhang', when: '10-15 16:19', task: 'T-2041', commits: [['9d8c7b6', 'feat: 退款单分页查询与导出']] },
    { id: '!55', title: '修复订单导出时区偏移', src: 'hotfix/export-tz', dst: 'main', who: '王芳', when: '10-15 11:18', st: ['已合并', 'st-done', 'check'] },
    { id: '!52', title: '新增退款接口与幂等校验', src: 'feature/refund', dst: 'main', who: '张伟', when: '10-13 10:20', st: ['打开', 'st-run', 'play'] },
    { id: '!49', title: '优惠券叠加规则', src: 'feature/coupon', dst: 'main', who: '陈静', when: '10-13 10:14', st: ['冲突', 'st-fail', 'alert'] },
  ];

  const FILLER = { ts: ['', '  // …（原型未写出这段未改动的原文）'], csv: ['R2025…（原型未写出这段未改动的数据行）'], sh: ['# …'], txt: ['…'] };

  window.GTD = { TASK, FILES, DEFAULT_SEL, EXCLUDED, RESULTS, HOOK_OUT, MSG, MSG_NO_REF, MR_DESC, COMMITS, BRANCHES, MRS, FILLER };
})();
