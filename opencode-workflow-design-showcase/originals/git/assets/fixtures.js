/* opencode-workflow · Git 仓库页 · 隔离原型样例数据
   全部虚构：项目、人名、地址、SHA、令牌都不是真实数据；不含任何真实凭据。
   差异用一个小格式书写：每行首字符 ' ' 上下文 / '-' 删除 / '+' 新增；
   '~N' 表示 N 行未改动且原型里没有写出原文的上下文（展开时用同语言的占位行）。
   '!' 开头的行是只在空白上不同的改动（忽略空白时会当作上下文）。 */
(function () {
  'use strict';

  /* ---------- 项目 ---------- */
  const PROJECTS = [
    { id: 'order', name: '订单服务', path: '/workspace/order-service', mode: 'git', branch: 'feature/refund', ahead: 2, behind: 1, fetched: '10:42',
      dirty: 3, mrsOpen: 2, reviewOpen: 5, gitlab: 'shop/order-service', last: { sha: 'e4f5a6b', msg: '补充退款单查询的分页参数', who: '李娜', when: '22 分钟前' }, stack: 'TypeScript · Node 20' },
    { id: 'cs', name: '客户服务平台', path: '/workspace/customer-service-platform', mode: 'git', branch: 'main', empty: true, ahead: 0, behind: 0, fetched: null,
      dirty: 12, mrsOpen: null, reviewOpen: 0, gitlab: null, last: null, stack: 'TypeScript · Vue' },
    { id: 'report', name: '运营报表脚本', path: '/workspace/ops-report-scripts', mode: 'direct', stack: 'Python' },
    { id: 'pay', name: '支付网关', path: '/workspace/payment-gateway', mode: 'unavailable', stack: 'Go · gRPC' },
  ];
  const GITLAB = { host: 'gitlab.example.internal', user: 'dev-zhang', verified: '10:40', project: 'shop/order-service' };
  const AUTHORS = { 张伟: ['zhang.wei@example.com', 1], 李娜: ['li.na@example.com', 2], 王芳: ['wang.fang@example.com', 3], 刘洋: ['liu.yang@example.com', 4], 陈静: ['chen.jing@example.com', 5] };

  /* ---------- 提交（新 → 旧）---------- */
  const C = (sha, full, msg, who, day, time, parents, extra) => Object.assign({ sha, full, msg, who, day, time, parents }, extra || {});
  const COMMITS = [
    C('e4f5a6b', 'e4f5a6b7c8d9e0f1a2b3c4d5e6f708192a3b4c5d', '补充退款单查询的分页参数', '李娜', '10-13', '10:31', ['c7d8e9f'], { refs: ['HEAD', 'feature/refund'], rel: '22 分钟前' }),
    C('d2c3b4a', 'd2c3b4a5968778695a4b3c2d1e0f9a8b7c6d5e4f', '优惠券叠加规则校验', '陈静', '10-13', '10:12', ['9a8b7c6'], { refs: ['feature/coupon', 'origin/feature/coupon'], rel: '41 分钟前' }),
    C('f0e1d2c', 'f0e1d2c3b4a5968778695a4b3c2d1e0f9a8b7c6d', '更新退款接口文档', '王芳', '10-13', '10:05', ['a1b2c3d'], { refs: ['origin/feature/refund'], rel: '48 分钟前' }),
    C('c7d8e9f', 'c7d8e9f0a1b2c3d4e5f60718293a4b5c6d7e8f90', '调整退款状态枚举的序列化', '张伟', '10-13', '09:58', ['a1b2c3d'], { rel: '55 分钟前', rv: 'clean' }),
    C('a1b2c3d', 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678', '新增退款接口', '张伟', '10-13', '09:12', ['5b6c7d8'], { rel: '1 小时前', rv: 'story' }),
    C('5b6c7d8', '5b6c7d8e9f0a1b2c3d4e5f60718293a4b5c6d7e8', "Merge branch 'main' into feature/refund", '张伟', '10-13', '08:40', ['3c4d5e6', '8a9b0c1'], { rel: '2 小时前' }),
    C('9a8b7c6', '9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b', '优惠券领域模型', '陈静', '10-12', '18:02', ['8a9b0c1'], { rel: '昨天 18:02' }),
    C('8a9b0c1', '8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b', '修复订单导出的时区偏移', '王芳', '10-12', '17:22', ['7f6e5d4'], { refs: ['main', 'origin/main'], rel: '昨天 17:22', rv: 'fixed' }),
    C('3c4d5e6', '3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d', '退款单表结构与迁移脚本', '张伟', '10-12', '16:05', ['2b3c4d5'], { rel: '昨天 16:05', rv: 'issues3' }),
    C('2b3c4d5', '2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c', '新增退款领域模型', '张伟', '10-12', '11:30', ['7f6e5d4'], { rel: '昨天 11:30' }),
    C('7f6e5d4', '7f6e5d4c3b2a1f0e9d8c7b6a5f4e3d2c1b0a9f8e', '订单详情接口返回支付渠道', '刘洋', '10-12', '10:12', ['6e5d4c3'], { rel: '昨天 10:12' }),
    C('6e5d4c3', '6e5d4c3b2a1f0e9d8c7b6a5f4e3d2c1b0a9f8e7d', "Merge branch 'feature/pay-retry' into 'main'", '刘洋', '10-10', '18:40', ['5d4c3b2', '4c3b2a1'], { refs: ['tag:v1.8.2'], rel: '10月10日' }),
    C('4c3b2a1', '4c3b2a1f0e9d8c7b6a5f4e3d2c1b0a9f8e7d6c5b', '支付回调失败后指数退避重试', '陈静', '10-10', '15:20', ['5d4c3b2'], { rel: '10月10日' }),
    C('5d4c3b2', '5d4c3b2a1f0e9d8c7b6a5f4e3d2c1b0a9f8e7d6c', '统一金额字段为「分」', '刘洋', '10-10', '11:02', ['1a2b3c4'], { rel: '10月10日' }),
  ];
  const OLDER = [
    C('1a2b3c4', '1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b', '订单列表支持按支付渠道筛选', '王芳', '10-09', '16:44', ['0f1e2d3'], { rel: '10月9日' }),
    C('0f1e2d3', '0f1e2d3c4b5a69788796a5b4c3d2e1f0a9b8c7d6', '升级 Node 运行时到 20', '刘洋', '10-09', '10:20', ['e1d2c3b'], { rel: '10月9日' }),
    C('e1d2c3b', 'e1d2c3b4a5968778695a4b3c2d1e0f9a8b7c6d5e', '订单服务健康检查接口', '李娜', '10-08', '15:31', ['b7a6c5d'], { rel: '10月8日' }),
    C('b7a6c5d', 'b7a6c5d4e3f2a1b0c9d8e7f6a5b4c3d2e1f0a9b8', '补充订单创建的参数校验', '张伟', '10-08', '11:05', ['c9d8e7f'], { refs: ['tag:v1.8.1'], rel: '10月8日' }),
    C('c9d8e7f', 'c9d8e7f6a5b4c3d2e1f0a9b8c7d6e5f4a3b2c1d0', '初始化 CI 流水线', '刘洋', '10-07', '17:50', [], { rel: '10月7日' }),
  ];
  const DAYS = { '10-13': '今天 · 10月13日 周二', '10-12': '昨天 · 10月12日 周一', '10-10': '10月10日 周六', '10-09': '10月9日 周五', '10-08': '10月8日 周四', '10-07': '10月7日 周三' };

  /* ---------- 差异：a1b2c3d 新增退款接口 ---------- */
  const SERVICE = `
 import { Injectable } from '../common/di';
-import { OrderRepository } from '../order/repository';
+import { Order, OrderRepository } from '../order/repository';
 import { RefundRepository } from './repository';
 import { logger } from '../common/logger';
-import { toYuan } from '../utils/money';
+import { toYuan } from '../common/money';
+import { CreateRefundInput, RefundView, toView } from './dto';
+import { RefundError } from './errors';

 @Injectable()
 export class RefundService {
   constructor(
     private readonly orders: OrderRepository,
     private readonly refunds: RefundRepository,
   ) {}

   async getRefund(id: string): Promise<RefundView | null> {
     const refund = await this.refunds.findById(id);
     return refund ? toView(refund) : null;
   }

+  async createRefund(input: CreateRefundInput): Promise<RefundView> {
+    const order = await this.orders.findById(input.orderId);
+    if (!order) throw RefundError.orderNotFound(input.orderId);
+    if (order.status !== 'PAID') throw RefundError.notRefundable(order.status);
+    // 同一订单同一幂等键只应创建一次退款
+    const key = input.idempotencyKey;
+    const existing = await this.refunds.findByOrder(order.id);
+    if (existing.length >= order.maxRefunds) {
+      throw RefundError.tooMany(order.id);
+    }
+
+    const amount = this.calcRefundAmt(order, input);
+    const refund = await this.refunds.insert({
+      orderId: order.id,
+      amount,
+      reason: input.reason,
+      idempotencyKey: key,
+    });
+    return toView(refund);
+  }
+
+  private calcRefundAmt(order: Order, input: CreateRefundInput): number {
+    const paid = order.paidAmount / 100; // 元
+    const ratio = input.quantity / order.quantity;
+    const amount = paid * ratio;
+    const fee = amount * order.feeRate;
+    return Math.round((amount - fee) * 100) / 100;
+  }
+
-  async listRefunds(orderId: string) {
-    const rows = await this.refunds.findByOrder(orderId);
+  async listRefunds(orderId: string, page = 1, size = 20) {
+    const rows = await this.refunds.findByOrder(orderId, { page, size });
     return rows.map(toView);
   }

   async cancelRefund(id: string, operator: string) {
     const refund = await this.refunds.findById(id);
     if (!refund) throw new Error('refund not found');
     if (refund.status !== 'PENDING') {
       throw new Error('only pending refund can be cancelled');
     }
     await this.refunds.update(id, { status: 'CANCELLED', operator });
     logger.info('refund.cancel', { id, operator });
   }

   async summarize(orderId: string) {
     const rows = await this.refunds.findByOrder(orderId);
     const done = rows
!-    .filter((r) => r.status === 'DONE')
!+      .filter((r) => r.status === 'DONE')
!-    .map((r) => r.amount);
!+      .map((r) => r.amount);
     return {
       count: done.length,
       total: toYuan(done.reduce((a, b) => a + b, 0)),
     };
   }

-  /** @deprecated 使用 createRefund */
-  async refund(orderId: string, amount: number) {
-    const order = await this.orders.findById(orderId);
-    if (!order) throw new Error('order not found');
-    await this.refunds.insert({ orderId, amount });
-    return { ok: true };
-  }
-
 }

 function assertPositive(n: number, name: string) {
   if (!(n > 0)) throw new Error(name + ' must be positive');
 }`;

  const CONTROLLER = `
+import { Body, Controller, Get, Param, Post, Headers } from '../common/http';
+import { logger } from '../common/logger';
+import { RefundService } from './service';
+import { CreateRefundBody, CreateRefundInput } from './dto';
+
+@Controller('/api/refunds')
+export class RefundController {
+  constructor(private readonly service: RefundService) {}
+
+  @Post('/')
+  async create(
+    @Body() body: CreateRefundBody,
+    @Headers('idempotency-key') key: string,
+  ) {
+    const input: CreateRefundInput = {
+      orderId: body.orderId,
+      quantity: body.quantity,
+      reason: body.reason,
+      idempotencyKey: key,
+    };
+    // 方便排查：记录请求关键字段
+    logger.info('refund.request', { orderId: body.orderId, card: body.cardNo, holder: body.cardHolder });
+    logger.debug('refund.request.raw', body);
+    return this.service.createRefund(input);
+  }
+
+  @Get('/:id')
+  async get(@Param('id') id: string) {
+    const view = await this.service.getRefund(id);
+    if (!view) return { status: 404, body: { message: '退款单不存在' } };
+    return view;
+  }
+
+  @Get('/')
+  async list(
+    @Param('orderId') orderId: string,
+    @Param('page') page = 1,
+  ) {
+    return this.service.listRefunds(orderId, Number(page));
+  }
+
+  @Post('/:id/cancel')
+  async cancel(@Param('id') id: string, @Body() body: { operator: string }) {
+    await this.service.cancelRefund(id, body.operator);
+    return { ok: true };
+  }
+}`;

  const DTO = `
+export interface CreateRefundBody {
+  orderId: string;
+  quantity: number;
+  reason: string;
+  cardNo?: string;
+  cardHolder?: string;
+}
+
+export interface CreateRefundInput {
+  orderId: string;
+  quantity: number;
+  reason: string;
+  idempotencyKey: string;
+}
+
+export interface RefundView {
+  id: string;
+  orderId: string;
+  amount: number;
+  status: 'PENDING' | 'DONE' | 'CANCELLED';
+  createdAt: string;
+}
+
+export function toView(row: any): RefundView {
+  return {
+    id: row.id,
+    orderId: row.orderId,
+    amount: row.amount,
+    status: row.status,
+    createdAt: row.createdAt.toISOString(),
+  };
+}`;

  const REPO = `
~38
   async findById(id: string): Promise<Order | null> {
-    const row = await this.db.query('select * from orders where id = ?', [id]);
-    return row[0] || null;
+    const rows = await this.db.query(
+      'select id, status, paid_amount, quantity, fee_rate, max_refunds from orders where id = ?',
+      [id],
+    );
+    return rows[0] ? toOrder(rows[0]) : null;
   }

-  async listByUser(userId: string) {
-    return this.db.query('select * from orders where user_id = ?', [userId]);
+  async listByUser(userId: string, limit = 50) {
+    return this.db.query('select * from orders where user_id = ? limit ?', [userId, limit]);
   }
~22
 }

-function toOrder(row) {
+export interface Order {
+  id: string; status: string; paidAmount: number; quantity: number; feeRate: number; maxRefunds: number;
+}
+
+function toOrder(row: any): Order {
   return {
     id: row.id,
     status: row.status,
-    paidAmount: row.paid_amount,
-    quantity: row.quantity,
-    feeRate: row.fee_rate,
+    paidAmount: Number(row.paid_amount),
+    quantity: Number(row.quantity),
+    feeRate: Number(row.fee_rate),
+    maxRefunds: Number(row.max_refunds ?? 1),
   };
 }`;

  const MONEY = `
 /** 金额工具：库里一律存「分」 */
-export function toYuan(cents) {
-  return (cents / 100).toFixed(2);
+export function toYuan(cents: number): string {
+  return (cents / 100).toFixed(2);
 }

-export function toCents(yuan) {
-  return Math.round(yuan * 100);
+export function toCents(yuan: string | number): number {
+  return Math.round(Number(yuan) * 100);
 }

-export function sum(list) {
-  return list.reduce((a, b) => a + b, 0);
+export function sum(list: number[]): number {
+  return list.reduce((a, b) => a + b, 0);
 }
+
+export const Money = { toYuan, toCents, sum };`;

  const ROUTES = `
~11
 import { OrderController } from '../order/controller';
 import { PaymentController } from '../payment/controller';
+import { RefundController } from '../refund/controller';
 
-export const routes = [
+export const routes: Controller[] = [
   OrderController,
   PaymentController,
+  RefundController,
 ];
+
+export const idempotentRoutes = ['POST /api/refunds'];
 
 export function mount(app: App) {
   routes.forEach((r) => app.register(r));
~3`;

  const DOC = `
+# 退款接口
+
+## POST /api/refunds
+
+创建退款单。需要在请求头带 \`Idempotency-Key\`，同一订单同一幂等键只会创建一次退款。
+
+| 字段 | 类型 | 说明 |
+| --- | --- | --- |
+| orderId | string | 订单号 |
+| quantity | number | 退款件数 |
+| reason | string | 退款原因 |
+
+## GET /api/refunds/:id
+
+读取单个退款单；不存在时返回 404。
+
+## 金额
+
+退款金额按订单实付金额与退款件数比例计算，单位为「分」。
+手续费按订单费率计算后从退款金额中扣除。
+
+## 请求示例
+
+\`\`\`http
+POST /api/refunds
+Idempotency-Key: 7f3c0e2a-refund-0001
+Content-Type: application/json
+
+{ "orderId": "O20261013001", "quantity": 1, "reason": "少件漏发" }
+\`\`\`
+
+## 响应示例
+
+\`\`\`json
+{
+  "id": "R20261013001",
+  "orderId": "O20261013001",
+  "amount": 3313,
+  "status": "PENDING",
+  "createdAt": "2026-10-13T09:12:00+08:00"
+}
+\`\`\`
+
+## 错误码
+
+| 状态码 | 代码 | 说明 |
+| --- | --- | --- |
+| 404 | ORDER_NOT_FOUND | 订单不存在 |
+| 409 | NOT_REFUNDABLE | 订单状态不允许退款 |
+| 409 | TOO_MANY_REFUNDS | 超过订单允许的退款次数 |
+| 422 | INVALID_QUANTITY | 退款件数不合法 |
+
+## 取消退款
+
+\`POST /api/refunds/:id/cancel\`，只有待处理（PENDING）的退款单可以取消。
+
+## 分页
+
+\`GET /api/refunds?orderId=…&page=1\`，每页 20 条。
+
+## 变更记录
+
+- 2026-10-13 新增退款接口（SHOP-1287）
+- 2026-10-12 新增退款单表（SHOP-1286）
+- 2026-10-13 金额单位统一为「分」
+
+## 联系人
+
+订单组 · 张伟`;

  const LEGACY = `
-// 旧版退款入口，已由 RefundService.createRefund 取代
-export async function legacyRefund(orderId: string, amount: number) {
-  return { orderId, amount, legacy: true };
-}
-
-export const LEGACY_REFUND_ENABLED = false;
-// 保留到 1.9 后删除
-// 见 SHOP-1290`;

  /* ---------- 差异：3c4d5e6 表结构与迁移（大 diff / 二进制 / 重命名 / 权限）---------- */
  function seedSql() {
    const reasons = ['商品质量问题', '发错货', '少件漏发', '不想要了', '尺码不合适', '物流破损', '描述不符', '重复下单', '价格变动', '其他原因'];
    const L = ['-- 退款原因码种子数据（自动生成，请勿手改）', 'begin;', ''];
    for (let i = 1; L.length < 1240; i++) {
      const code = 'RR' + String(i).padStart(4, '0');
      L.push(`insert into refund_reason_codes (code, label, channel, enabled) values ('${code}', '${reasons[i % reasons.length]}', '${['app', 'web', 'mini', 'pos'][i % 4]}', ${i % 7 ? 'true' : 'false'});`);
    }
    L.push('commit;');
    return '\n' + L.slice(0, 1240).map((x) => '+' + x).join('\n');
  }
  const MIGRATION = `
+-- V12 新增退款单表
+create table refunds (
+  id              varchar(32)  primary key,
+  order_id        varchar(32)  not null,
+  amount          bigint       not null,           -- 单位：分
+  status          varchar(16)  not null default 'PENDING',
+  reason          varchar(200),
+  idempotency_key varchar(64),
+  operator        varchar(64),
+  created_at      timestamp    not null default now()
+);
+create index idx_refunds_order on refunds (order_id);
+create unique index uq_refunds_idem on refunds (order_id, idempotency_key);`;
  const MODEL = `
 export interface RefundRow {
   id: string;
   orderId: string;
-  amount: number; // 元
+  amount: number; // 分
   status: 'PENDING' | 'DONE' | 'CANCELLED';
+  idempotencyKey?: string;
 }`;
  const REFUND_REPO = `
+import { Db } from '../common/db';
+import { RefundRow } from './model';
+
+export class RefundRepository {
+  constructor(private readonly db: Db) {}
+
+  findById(id: string): Promise<RefundRow | null> {
+    return this.db.one('select * from refunds where id = ?', [id]);
+  }
+
+  findByOrder(orderId: string, page?: { page: number; size: number }) {
+    const p = page || { page: 1, size: 100 };
+    return this.db.query(
+      'select * from refunds where order_id = ? order by created_at desc limit ? offset ?',
+      [orderId, p.size, (p.page - 1) * p.size],
+    );
+  }
+
+  insert(row: Partial<RefundRow>) {
+    return this.db.insert('refunds', row);
+  }
+
+  update(id: string, patch: Partial<RefundRow>) {
+    return this.db.update('refunds', id, patch);
+  }
+}`;

  /* ---------- 差异：合并提交 5b6c7d8 ---------- */
  const EXPORT_TZ = `
~8
 import { format, formatInTimeZone } from 'date-fns-tz';
 import { orders } from './repository';
 
 export async function exportOrders(range: DateRange) {
-  const tz = 'UTC';
+  const tz = process.env.ORDER_TZ || 'Asia/Shanghai';
   const rows = await orders.listByRange(range.from, range.to);
-  return rows.map((r) => [r.id, format(r.createdAt, 'yyyy-MM-dd HH:mm')]);
+  return rows.map((r) => [r.id, formatInTimeZone(r.createdAt, tz, 'yyyy-MM-dd HH:mm')]);
 }
 
 export function header() {
   return ['订单号', '下单时间'];
~27`;
  const EXPORT_TEST = `
~5
 describe('exportOrders', () => {
   beforeEach(() => seedOrders());
 
+  it('按东八区导出下单时间', async () => {
+    const rows = await exportOrders({ from: '2026-10-01', to: '2026-10-02' });
+    expect(rows[0][1]).toBe('2026-10-01 08:00');
+  });
+
   it('按下单时间排序', async () => {
     const rows = await exportOrders({ from: '2026-10-01', to: '2026-10-31' });
     expect(rows.length).toBeGreaterThan(0);
~9`;

  /* ---------- 其他提交的简短差异 ---------- */
  const SMALL = {
    e4f5a6b: [{ p: 'src/refund/service.ts', st: 'M', src: `
~44
     const fee = amount * order.feeRate;
     return Math.round((amount - fee) * 100) / 100;
   }
 
-  async listRefunds(orderId: string, page = 1, size = 20) {
-    const rows = await this.refunds.findByOrder(orderId, { page, size });
-    return rows.map(toView);
+  async listRefunds(orderId: string, page = 1, size = 20): Promise<Page<RefundView>> {
+    const safeSize = Math.min(Math.max(size, 1), 100);
+    const rows = await this.refunds.findByOrder(orderId, { page, size: safeSize });
+    const total = await this.refunds.countByOrder(orderId);
+    return { items: rows.map(toView), page, size: safeSize, total };
   }
 
   async cancelRefund(id: string, operator: string) {
     const refund = await this.refunds.findById(id);
~40` }, { p: 'src/refund/controller.ts', st: 'M', src: `
~32
-    @Param('page') page = 1,
+    @Param('page') page = 1,
+    @Param('size') size = 20,
   ) {
-    return this.service.listRefunds(orderId, Number(page));
+    return this.service.listRefunds(orderId, Number(page), Number(size));
   }
~12` }],
    c7d8e9f: [{ p: 'src/refund/dto.ts', st: 'M', src: `
~14
 export interface RefundView {
   id: string;
   orderId: string;
   amount: number;
-  status: 'PENDING' | 'DONE' | 'CANCELLED';
+  status: RefundStatus;
   createdAt: string;
 }
 
+export enum RefundStatus {
+  PENDING = 'PENDING',
+  DONE = 'DONE',
+  CANCELLED = 'CANCELLED',
+}
+
 export function toView(row: any): RefundView {
   return {
     id: row.id,
~6` }],
    f0e1d2c: [{ p: 'docs/api/refund.md', st: 'M', src: `
 # 退款接口
 
 ## POST /api/refunds
 
-创建退款单。需要在请求头带 \`Idempotency-Key\`，同一订单同一幂等键只会创建一次退款。
+创建退款单。需要在请求头带 \`Idempotency-Key\`（最长 64 个字符），同一订单同一幂等键只会创建一次退款；
+重复请求返回第一次创建的退款单，状态码 200。
 
 | 字段 | 类型 | 说明 |
 | --- | --- | --- |
~12` }],
    d2c3b4a: [{ p: 'src/coupon/rules.ts', st: 'M', src: `
~17
 export function isExpired(c: Coupon, now = new Date()): boolean {
   return c.expiresAt.getTime() < now.getTime();
 }
 
+export function canStack(a: Coupon, b: Coupon): boolean {
+  if (a.exclusive || b.exclusive) return false;
+  return a.kind !== b.kind;
+}
+
 export function applyAll(order: Order, list: Coupon[]) {
   return list.reduce((o, c) => apply(o, c), order);
 }
~13` }],
    '9a8b7c6': [{ p: 'src/coupon/model.ts', st: 'A', src: `
+export interface Coupon {
+  id: string;
+  kind: 'DISCOUNT' | 'CASH' | 'SHIPPING';
+  exclusive: boolean;
+  amount: number; // 分
+}` }],
    '8a9b0c1': [{ p: 'src/order/export.ts', st: 'M', src: EXPORT_TZ }, { p: 'test/order/export.spec.ts', st: 'M', src: EXPORT_TEST }],
    '2b3c4d5': [{ p: 'src/refund/model.ts', st: 'A', src: `
+export interface RefundRow {
+  id: string;
+  orderId: string;
+  amount: number; // 元
+  status: 'PENDING' | 'DONE' | 'CANCELLED';
+}` }],
    '7f6e5d4': [{ p: 'src/order/controller.ts', st: 'M', src: `
~37
   async detail(@Param('id') id: string) {
     const order = await this.orders.findById(id);
     if (!order) return { status: 404 };
     return {
       id: order.id,
       status: order.status,
+      payChannel: order.payChannel,
     };
   }
 
~16` }],
    '6e5d4c3': [{ p: 'src/payment/callback.ts', st: 'M', src: `
 import { orders } from '../order/repository';
 import { notify } from './notify';
+import { retry } from '../common/retry';
 import { logger } from '../common/logger';
 
 export async function onPaid(orderId: string) {
~24
   const order = await orders.findById(orderId);
   if (!order) return;
   logger.info('payment.paid', { orderId });
-  await notify(order);
+  await retry(() => notify(order), { times: 5, backoff: 'exponential' });
 }
~8` }],
    '4c3b2a1': [{ p: 'src/common/retry.ts', st: 'A', src: `
+export async function retry<T>(fn: () => Promise<T>, opt: { times: number; backoff: 'exponential' }) {
+  let wait = 200;
+  for (let i = 0; ; i++) {
+    try { return await fn(); } catch (e) {
+      if (i + 1 >= opt.times) throw e;
+      await new Promise((r) => setTimeout(r, wait));
+      wait *= 2;
+    }
+  }
+}` }],
    '5d4c3b2': [{ p: 'src/order/model.ts', st: 'M', src: `
~3
 export interface Order {
   id: string;
   status: string;
-  paidAmount: number; // 元
+  paidAmount: number; // 分
   quantity: number;
   feeRate: number;
 }
~9` }],
  };

  /* ---------- 文件清单 ---------- */
  const FILES = {
    a1b2c3d: [
      { p: 'src/refund/service.ts', st: 'M', src: SERVICE },
      { p: 'src/refund/controller.ts', st: 'A', src: CONTROLLER },
      { p: 'src/refund/dto.ts', st: 'A', src: DTO },
      { p: 'src/order/repository.ts', st: 'M', src: REPO },
      { p: 'src/common/money.ts', old: 'src/utils/money.ts', st: 'R', sim: 87, src: MONEY },
      { p: 'src/config/routes.ts', st: 'M', src: ROUTES },
      { p: 'docs/api/refund.md', st: 'A', src: DOC },
      { p: 'src/refund/legacy-refund.ts', st: 'D', src: LEGACY },
    ],
    '3c4d5e6': [
      { p: 'db/seeds/refund_reason_codes.sql', st: 'A', src: seedSql(), large: true },
      { p: 'db/migrations/V12__create_refunds.sql', st: 'A', src: MIGRATION },
      { p: 'src/refund/model.ts', old: 'src/refund/entity.ts', st: 'R', sim: 92, src: MODEL },
      { p: 'src/refund/repository.ts', st: 'A', src: REFUND_REPO },
      { p: 'docs/refund-flow.png', st: 'A', binary: { before: null, after: '112 KB' } },
      { p: 'docs/order-states.png', st: 'M', binary: { before: '84 KB', after: '91 KB' } },
      { p: 'scripts/migrate.sh', st: 'M', mode: ['100644', '100755'] },
    ],
    /* 合并提交：对比父 1（feature/refund 一侧）= 合并带进来的 main 改动；对比父 2（main 一侧）= 这条分支相对 main 的改动 */
    '5b6c7d8@1': [{ p: 'src/order/export.ts', st: 'M', src: EXPORT_TZ }, { p: 'test/order/export.spec.ts', st: 'M', src: EXPORT_TEST }],
    '5b6c7d8@2': [
      { p: 'db/seeds/refund_reason_codes.sql', st: 'A', src: seedSql(), large: true },
      { p: 'db/migrations/V12__create_refunds.sql', st: 'A', src: MIGRATION },
      { p: 'src/refund/model.ts', st: 'A', src: MODEL.replace(/\n /g, '\n+').replace(/\n-.*$/m, '') },
      { p: 'src/refund/repository.ts', st: 'A', src: REFUND_REPO },
      { p: 'docs/refund-flow.png', st: 'A', binary: { before: null, after: '112 KB' } },
      { p: 'scripts/migrate.sh', st: 'M', mode: ['100644', '100755'] },
    ],
  };
  Object.keys(SMALL).forEach((k) => { FILES[k] = SMALL[k]; });

  const BODIES = {
    a1b2c3d: '- 新增 POST /api/refunds 与 GET /api/refunds/:id\n- 退款金额按订单实付金额与退款件数比例计算\n- 接入幂等键 Idempotency-Key\n- money 工具从 utils 挪到 common\n\nRefs: SHOP-1287',
    '5b6c7d8': '同步 main 上的订单导出时区修复，避免退款对账报表时间错位。',
    '3c4d5e6': '- refunds 表与唯一索引（order_id, idempotency_key）\n- 退款原因码种子数据\n- 迁移脚本加执行权限\n\nRefs: SHOP-1286',
    c7d8e9f: '状态改为枚举，序列化结果保持原字符串，接口不变。',
    e4f5a6b: '列表接口支持 page / size，size 限制在 1–100。',
  };

  /* ---------- 审查问题（a1b2c3d · 第 2 次审查）---------- */
  const FINDINGS = [
    { id: 'F1', sev: 'major', dim: 'bug', title: '退款金额用浮点数计算，存在舍入误差', file: 'src/refund/service.ts', from: 42, to: 48,
      desc: '订单实付金额以「分」存储，这里先除以 100 转成「元」再乘比例和费率，最后 Math.round(x*100)/100 又以「元」返回。部分退款（如 1/3）会产生 0.01 元级别的误差，且返回单位与库里约定的「分」不一致，对账会出现差额。',
      fix: ['-    const paid = order.paidAmount / 100; // 元', '-    const amount = paid * ratio;', '+    const amountCents = Money.prorate(order.paidAmount, input.quantity, order.quantity);', '+    const feeCents = Money.mulRate(amountCents, order.feeRate);', '+    return amountCents - feeCents;'] },
    { id: 'F2', sev: 'minor', dim: 'bug', title: '幂等键没有校验，重复请求会创建多笔退款', file: 'src/refund/service.ts', from: 26, to: 30,
      desc: '读取了 idempotencyKey，但只按订单统计已有退款数，没有按幂等键查重。客户端超时重试时会再插入一笔；虽然数据库有唯一索引，但会以 500 错误返回而不是返回第一次的结果。',
      fix: ['     const key = input.idempotencyKey;', '+    const replay = await this.refunds.findByIdempotencyKey(order.id, key);', '+    if (replay) return toView(replay);'] },
    { id: 'F3', sev: 'blocker', dim: 'sec', title: '日志输出了完整卡号和持卡人姓名', file: 'src/refund/controller.ts', from: 22, to: 23,
      desc: 'refund.request 日志写入了 cardNo 与 cardHolder 原文，debug 日志还输出了整个请求体。按支付数据规范，日志里只允许出现卡号后四位。',
      fix: ["-    logger.info('refund.request', { orderId: body.orderId, card: body.cardNo, holder: body.cardHolder });", '-    logger.debug(\'refund.request.raw\', body);', "+    logger.info('refund.request', { orderId: body.orderId, cardLast4: maskCard(body.cardNo) });"] },
    { id: 'F4', sev: 'minor', dim: 'style', title: '函数命名与项目约定不一致：calcRefundAmt', file: 'src/refund/service.ts', from: 42, to: 42,
      desc: '项目公约要求不使用缩写，金额计算函数统一以 compute… 开头，建议命名为 computeRefundAmount。',
      fix: ['-  private calcRefundAmt(order: Order, input: CreateRefundInput): number {', '+  private computeRefundAmount(order: Order, input: CreateRefundInput): number {'] },
    { id: 'F5', sev: 'hint', dim: 'test', title: '退款服务没有单元测试', file: 'src/refund/service.ts', from: 21, to: 21,
      desc: 'createRefund 的金额计算、幂等与次数上限都没有测试。建议至少覆盖：全额退款、部分退款舍入、重复幂等键、超出次数上限。',
      fix: ['+// test/refund/service.spec.ts', "+it('部分退款按比例计算金额（分）', ...)", "+it('重复幂等键返回第一次的退款单', ...)"] },
  ];
  const SEV = { blocker: ['阻断', 'st-danger', 4], major: ['严重', 'st-stall', 3], minor: ['一般', 'st-fail', 2], hint: ['建议', 'st-idle', 1] };
  const DIMS = [['bug', '缺陷与逻辑'], ['sec', '安全'], ['perf', '性能'], ['quality', '代码质量'], ['style', '规范与风格'], ['test', '测试覆盖']];

  /* ---------- 修复（ai-fix/a1b2c3d-1013，基于 e4f5a6b）---------- */
  const FIX_SERVICE = `
 import { Injectable } from '../common/di';
 import { Order, OrderRepository } from '../order/repository';
 import { RefundRepository } from './repository';
 import { logger } from '../common/logger';
-import { toYuan } from '../common/money';
+import { Money, toYuan } from '../common/money';
 import { CreateRefundInput, RefundView, toView } from './dto';
 import { RefundError } from './errors';
 
~10
   async createRefund(input: CreateRefundInput): Promise<RefundView> {
     const order = await this.orders.findById(input.orderId);
     if (!order) throw RefundError.orderNotFound(input.orderId);
     if (order.status !== 'PAID') throw RefundError.notRefundable(order.status);
     // 同一订单同一幂等键只应创建一次退款
     const key = input.idempotencyKey;
+    const replay = await this.refunds.findByIdempotencyKey(order.id, key);
+    if (replay) return toView(replay);
     const existing = await this.refunds.findByOrder(order.id);
     if (existing.length >= order.maxRefunds) {
       throw RefundError.tooMany(order.id);
     }
~9
     return toView(refund);
   }
 
   private calcRefundAmt(order: Order, input: CreateRefundInput): number {
-    const paid = order.paidAmount / 100; // 元
-    const ratio = input.quantity / order.quantity;
-    const amount = paid * ratio;
-    const fee = amount * order.feeRate;
-    return Math.round((amount - fee) * 100) / 100;
+    // 全程用「分」（整数）计算，只在最后一步按银行家舍入取整
+    const amountCents = Money.prorate(order.paidAmount, input.quantity, order.quantity);
+    const feeCents = Money.mulRate(amountCents, order.feeRate);
+    return amountCents - feeCents;
   }
~44`;
  const FIX_CONTROLLER = `
 import { Body, Controller, Get, Param, Post, Headers } from '../common/http';
 import { logger } from '../common/logger';
+import { maskCard } from '../common/mask';
 import { RefundService } from './service';
 import { CreateRefundBody, CreateRefundInput } from './dto';
 
~12
       reason: body.reason,
       idempotencyKey: key,
     };
-    // 方便排查：记录请求关键字段
-    logger.info('refund.request', { orderId: body.orderId, card: body.cardNo, holder: body.cardHolder });
-    logger.debug('refund.request.raw', body);
+    // 只记录卡号后四位（支付数据规范 3.2）
+    logger.info('refund.request', { orderId: body.orderId, cardLast4: maskCard(body.cardNo) });
     return this.service.createRefund(input);
   }
~26`;
  const FIX_MONEY = `
~13
 export function sum(list: number[]): number {
   return list.reduce((a, b) => a + b, 0);
 }
+
+/** 按件数比例分摊金额（分），结果向下取整，余数留给最后一笔 */
+export function prorate(totalCents: number, part: number, whole: number): number {
+  return Math.floor((totalCents * part) / whole);
+}
+
+/** 金额乘费率（分），银行家舍入 */
+export function mulRate(cents: number, rate: number): number {
+  const raw = cents * rate;
+  const floor = Math.floor(raw);
+  const diff = raw - floor;
+  if (diff > 0.5) return floor + 1;
+  if (diff < 0.5) return floor;
+  return floor % 2 === 0 ? floor : floor + 1;
+}

-export const Money = { toYuan, toCents, sum };
+export const Money = { toYuan, toCents, sum, prorate, mulRate };`;
  const FIX_TEST = `
+import { RefundService } from '../../src/refund/service';
+import { fakeOrders, fakeRefunds } from '../fakes';
+
+describe('RefundService.createRefund', () => {
+  const orders = fakeOrders({ id: 'O1', status: 'PAID', paidAmount: 10000, quantity: 3, feeRate: 0.006, maxRefunds: 3 });
+
+  it('全额退款金额等于实付减手续费（分）', async () => {
+    const s = new RefundService(orders, fakeRefunds());
+    const r = await s.createRefund({ orderId: 'O1', quantity: 3, reason: '质量问题', idempotencyKey: 'k1' });
+    expect(r.amount).toBe(9940);
+  });
+
+  it('部分退款按比例计算金额（分）', async () => {
+    const s = new RefundService(orders, fakeRefunds());
+    const r = await s.createRefund({ orderId: 'O1', quantity: 1, reason: '少件', idempotencyKey: 'k2' });
+    expect(r.amount).toBe(3313);
+  });
+
+  it('重复幂等键返回第一次的退款单', async () => {
+    const refunds = fakeRefunds();
+    const s = new RefundService(orders, refunds);
+    const a = await s.createRefund({ orderId: 'O1', quantity: 1, reason: '少件', idempotencyKey: 'k3' });
+    const b = await s.createRefund({ orderId: 'O1', quantity: 1, reason: '少件', idempotencyKey: 'k3' });
+    expect(b.id).toBe(a.id);
+    expect(refunds.count()).toBe(1);
+  });
+});`;
  const FIX = {
    branch: 'ai-fix/a1b2c3d-1013', base: 'e4f5a6b', baseNote: '此提交之后 feature/refund 又有 2 个提交（c7d8e9f、e4f5a6b），修复会基于最新代码进行。',
    role: '软件工程师 · 修订 5', testCmd: 'npm test', newSha: '9d8c7b6', newFull: '9d8c7b6a5f4e3d2c1b0a9f8e7d6c5b4a3f2e1d0c', mr: '!58',
    message: 'fix: 修复退款金额舍入与幂等校验 (AI review a1b2c3d)',
    messageBody: '- 金额全程以「分」计算，费率用银行家舍入\n- 按幂等键查重，重复请求返回第一次的退款单\n- 日志只记录卡号后四位\n- 补充 createRefund 单元测试\n\n审查：a1b2c3d 第 2 次审查 · 代码评审员 修订 3',
    files: [
      { p: 'src/refund/service.ts', st: 'M', src: FIX_SERVICE },
      { p: 'src/refund/controller.ts', st: 'M', src: FIX_CONTROLLER },
      { p: 'src/common/money.ts', st: 'M', src: FIX_MONEY },
      { p: 'test/refund/service.spec.ts', st: 'A', src: FIX_TEST },
    ],
    result: { F1: ['done', '金额改为整数「分」计算，费率银行家舍入'], F2: ['done', '按幂等键查重，重复请求返回第一次的退款单'], F3: ['done', '日志只保留卡号后四位，删除原始请求体日志'], F5: ['partial', '补了 createRefund 的 3 个用例；controller 层未覆盖'] },
    log: [
      ['10:47:02', 'prep', '从 feature/refund 的 e4f5a6b 创建隔离工作副本'],
      ['10:47:03', 'prep', '新建本地分支 ai-fix/a1b2c3d-1013（不检出到你的工作区）'],
      ['10:47:05', 'edit', '读取 4 个问题涉及的 3 个文件与 2 个相关文件'],
      ['10:47:19', 'edit', 'src/common/money.ts：新增 prorate、mulRate'],
      ['10:47:31', 'edit', 'src/refund/service.ts：金额改用「分」计算；按幂等键查重'],
      ['10:47:40', 'edit', 'src/refund/controller.ts：日志只记录卡号后四位'],
      ['10:47:58', 'edit', 'test/refund/service.spec.ts：新增 3 个用例'],
      ['10:48:02', 'verify', '运行 npm test'],
      ['10:48:20', 'verify', '41 通过 · 0 失败 · 用时 18 秒'],
    ],
    verifyOk: { pass: 41, fail: 0, secs: 18, cmd: 'npm test' },
    verifyFail: { pass: 39, fail: 2, secs: 21, cmd: 'npm test', out: `FAIL test/refund/service.spec.ts
  ● RefundService.createRefund › 部分退款按比例计算金额（分）

    expect(received).toBe(expected) // Object.is equality

    Expected: 3313
    Received: 3314

      19 |     const r = await s.createRefund({ orderId: 'O1', quantity: 1, ... });
    > 20 |     expect(r.amount).toBe(3313);
         |                      ^

  ● RefundSummary › summarize › 合计金额以元展示

    Expected: "99.40"
    Received: "9940.00"

Tests:       2 failed, 39 passed, 41 total
Time:        21.4 s` },
    hook: `husky > pre-commit (node v20.11.1)
> lint-staged

✖ eslint --max-warnings=0:
/tmp/ai-fix-a1b2c3d-1013/test/refund/service.spec.ts
  2:10  error  'fakeOrders' is defined but never used in this scope  no-unused-vars
  9:5   error  Missing return type on function                      @typescript-eslint/explicit-function-return-type

✖ 2 problems (2 errors, 0 warnings)
husky > pre-commit hook exited with code 1 (error)`,
  };

  /* ---------- 分支 ---------- */
  const BRANCHES = {
    local: [
      { n: 'feature/refund', cur: true, a: 6, b: 0, sha: 'e4f5a6b', msg: '补充退款单查询的分页参数', when: '22 分钟前', mr: ['!52', '打开', 'st-run'], up: 'origin/feature/refund ↑2 ↓1' },
      { n: 'main', lock: true, a: 0, b: 0, def: true, sha: '8a9b0c1', msg: '修复订单导出的时区偏移', when: '昨天 17:22', mr: null, up: 'origin/main' },
      { n: 'feature/coupon', a: 2, b: 0, sha: 'd2c3b4a', msg: '优惠券叠加规则校验', when: '41 分钟前', mr: ['!49', '冲突', 'st-fail'], up: 'origin/feature/coupon' },
      { n: 'hotfix/export-tz', a: 0, b: 3, sha: '6c5b4a3', msg: '导出时区改为可配置', when: '3 天前', mr: ['!47', '已合并', 'st-done'], up: '远端已删除' },
    ],
    remote: [
      { n: 'origin/main', lock: true, a: 0, b: 0, sha: '8a9b0c1', msg: '修复订单导出的时区偏移', when: '昨天 17:22', mr: null },
      { n: 'origin/feature/refund', a: 5, b: 0, sha: 'f0e1d2c', msg: '更新退款接口文档', when: '48 分钟前', mr: ['!52', '打开', 'st-run'] },
      { n: 'origin/feature/coupon', a: 2, b: 0, sha: 'd2c3b4a', msg: '优惠券叠加规则校验', when: '41 分钟前', mr: ['!49', '冲突', 'st-fail'] },
      { n: 'origin/release/1.8', lock: true, a: 0, b: 4, sha: '6e5d4c3', msg: "Merge branch 'feature/pay-retry' into 'main'", when: '10月10日', mr: null },
    ],
  };

  /* ---------- 合并请求 ---------- */
  const MRS = [
    { id: '!52', title: '新增退款接口与幂等校验', src: 'feature/refund', dst: 'main', st: ['打开', 'st-run', 'play'], pipe: ['通过', 'st-ok', 'check'], appr: '1 / 2', when: '今天 10:20', who: '张伟',
      desc: '退款 MVP：退款单表、创建 / 查询 / 取消接口、幂等键。合并前需要完成 AI 审查中阻断与严重问题的修复。', commits: ['e4f5a6b', 'c7d8e9f', 'a1b2c3d', '5b6c7d8', '3c4d5e6', '2b3c4d5'],
      approvers: [['李娜', '已批准', 'st-ok'], ['刘洋', '待审批', 'st-idle']], stages: [['构建', 'st-ok'], ['单元测试', 'st-ok'], ['代码扫描', 'st-ok']] },
    { id: '!49', title: '优惠券叠加规则', src: 'feature/coupon', dst: 'main', st: ['冲突', 'st-fail', 'alert'], pipe: ['失败', 'st-danger', 'x'], appr: '0 / 2', when: '今天 10:14', who: '陈静',
      desc: '优惠券叠加规则与领域模型。与 main 上的订单导出改动冲突，需要在 GitLab 中解决。', commits: ['d2c3b4a', '9a8b7c6'], approvers: [['张伟', '待审批', 'st-idle'], ['刘洋', '待审批', 'st-idle']], stages: [['构建', 'st-ok'], ['单元测试', 'st-danger'], ['代码扫描', 'st-idle']] },
    { id: '!47', title: '修复订单导出时区偏移', src: 'hotfix/export-tz', dst: 'main', st: ['已合并', 'st-done', 'check'], pipe: ['通过', 'st-ok', 'check'], appr: '2 / 2', when: '昨天 17:25', who: '王芳', desc: '导出时区改为 Asia/Shanghai，可用 ORDER_TZ 覆盖。', commits: ['8a9b0c1'], approvers: [['张伟', '已批准', 'st-ok'], ['刘洋', '已批准', 'st-ok']], stages: [['构建', 'st-ok'], ['单元测试', 'st-ok']] },
    { id: '!45', title: '订单导出改为异步任务', src: 'feature/export-async', dst: 'main', st: ['已关闭', 'st-idle', 'x'], pipe: ['—', '', ''], appr: '0 / 2', when: '10月9日', who: '刘洋', desc: '方案改为在报表服务中实现，关闭。', commits: [], approvers: [], stages: [] },
    { id: '!41', title: '支付回调失败后重试', src: 'feature/pay-retry', dst: 'main', st: ['已合并', 'st-done', 'check'], pipe: ['通过', 'st-ok', 'check'], appr: '2 / 2', when: '10月10日', who: '陈静', desc: '指数退避重试 5 次。', commits: ['6e5d4c3', '4c3b2a1'], approvers: [['刘洋', '已批准', 'st-ok'], ['张伟', '已批准', 'st-ok']], stages: [['构建', 'st-ok'], ['单元测试', 'st-ok']] },
  ];

  /* ---------- 占位上下文（'~N' 展开时使用；不代表真实文件内容）---------- */
  const FILLER = {
    ts: ['', '  // …（原型未写出这段未改动的原文）'],
    sql: ['-- …'],
    md: [''],
    sh: ['# …'],
  };

  window.GIT_FX = { PROJECTS, GITLAB, AUTHORS, COMMITS, OLDER, DAYS, FILES, BODIES, FINDINGS, SEV, DIMS, FIX, BRANCHES, MRS, FILLER };
})();
