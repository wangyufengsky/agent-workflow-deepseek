# 区域 09 · 待处理中心 / 质量与用量 — 处置记录

> 来源：`docs/review/design-audit-2026-10-20/09-inbox-insights.md`（16 条：P1 1 / P2 7 / P3 8）。

| ID | 状态 | 证据（文件:行） | 说明 |
|---|---|---|---|
| P14-02 | 已修复 | `apps/web/src/pages/inbox/InboxPage.tsx`（`ResolveState.requestKey/unknown/reconcile`、`resolveUnknown`、设计同款 UNKNOWN 横幅、`reconcileResolve`、列表行「结果未明」徽标、inputs/提交按钮锁定）；`apps/web/src/api/pending-identity.ts`（`usePendingCommands`）；`apps/web/src/pages/inbox/interactions.ts`（`resolveInteraction(interactionId, answers, requestKey)`） | 传输层不确定失败不再显示“回答未提交”：进入 UNKNOWN，锁内容，只按原请求号 `GET /api/operations/:key` 核对；成功/失败结算后解锁并刷新事项；刷新后由持久 pending identity 恢复锁定与徽标。服务返回 accepted/unknown 回执原逻辑保留。需断网/丢回执 GUI 复验。 |
| P14-01、P14-03..05、P15-01..08 | 延后 | — | P2/P3 后续批次（见 `p2-p3-backlog.md`）。 |

---

## task-12 第三批收口更新（2026-10-20，追加；上表“延后”行的本轮实际状态以下文为准）

> 范围：区域 09 的 P2/P3（P14-01/03/04/05/08、P15-01..07）。实现文件：`apps/web/src/pages/inbox/{RuntimeInbox.tsx,InboxPage.tsx,inbox.css}`、`apps/web/src/pages/insights/{InsightsPage.tsx,insights.css}`。设计稿只读；未改 `packages/**`。

| ID | 本轮状态 | 证据 | 说明 |
|---|---|---|---|
| P14-01 | 部分 | `InboxPage.tsx`（页脚“本页计数口径：规划交互+运行时事件；任务列表需要处理口径更大”） | 只做诚实口径标注；主稿 v5「规划事项 13 项」区块缺服务 kind/同口径汇总端点（C1），且与 planning 补充三类冲突（C9），待 Lead 定口径后做 |
| P14-03 | 已修复 | `RuntimeInbox.tsx`（权限请求/策略禁止 Badge、请求的操作 code 块、原因分节、授权范围两卡、hard danger 横幅）；`inbox.css`（`.inbox-pat` 新增、`.inbox-scope-card` 去 opacity） | 启用此前已写但无引用的 `.inbox-scope-grid/.inbox-scope-card`；动作文案对齐设计“允许这一次/本次会话都允许” |
| P14-04 | 已修复 | `RuntimeInbox.tsx`（拒绝 Modal：问题/权限两种后果文案、返回/拒绝、锁定态禁用） | 误点保护；成功/UNKNOWN 仍走 ReceiptNotice 原逻辑 |
| P14-05 | 已修复 | `InboxPage.tsx`（`readback` 横幅“回答已被接受，但列表刷新失败…”、success 文案“已提交，任务会继续执行”） | 成功回执 + 名单刷新失败时给出设计 readback 文案与重新读取 |
| P14-08 | 部分 | `InboxPage.tsx`（页头 lede 设计原文、读取失败顶部 danger banner、无运行时事项时隐藏两栏、空态文案） | 视觉/断点仍需 GUI；loading 骨架保持 4 行（设计 3 行）为既有实现，不为此大改 |
| P14-06/07/09 | 延后 | — | 06 共享组件（QuestionInput，跨区域）／07 设计同步（C9）／09 设计裁决（C9） |
| P15-01 | 已修复 | `InsightsPage.tsx`（selection 三态、关闭明细按钮、`insights-layout.no` 单列） | list 态可达；content 默认首行保留 |
| P15-02 | 部分 | `InsightsPage.tsx`（三卡/表格统一“整个筛选范围 + 同一次全量读取快照”，第三卡标题/副文案、表格 footer 快照与无分页说明） | 设计页头 vs 第三卡自相矛盾（C9）已登记；未伪造“加载更多/18:00 快照” |
| P15-03 | 已修复 | `InsightsPage.tsx`（Tokens 列 `.insights-tbar` 按 max 比例宽 80px、未知徽标）＋ `insights.css` | 设计 .tbar 迁移 |
| P15-04 | 已修复 | `InsightsPage.tsx`（`SummaryTiles`：`taskUsage.data===undefined` 时三卡未知占位，不渲染 0/0；失败态 danger banner+重试；首屏 4 行骨架） | P15-04 核心数据诚实修复 |
| P15-05 | 部分 | `InsightsPage.tsx`（明细四格=Tokens/未知记录/耗时/重试、成本单行、关闭按钮、底部“查看任务评审”整宽、质量徽标；移除阶段块；人工验收写入保留并标“扩展”） | 人工验收是产品扩展（C9），保留但标注 |
| P15-06 | 已修复 | `InsightsPage.tsx`（`page wide`）＋ `insights.css`（tiles 1.2fr、`.n` 右对齐） | 质量“存在问题”分段为服务扩展，保留并登记 |
| P15-07 | 部分 | `InsightsPage.tsx`（4 行骨架、空态包 card、验收读取失败行内“节点验收读取失败（不是未执行）”与明细提示）＋ `insights.css`（行 hover） | 明细重试由既有 error 分支提供；像素级需 GUI |

**验证**：`npm run typecheck` 本区域文件 0 错误（全仓剩余错误均在其他并行任务文件）；无新增仓库测试（页面态需 GUI）。**需 GUI/真实服务**：四主题权限两卡/拒绝对话框/readback、Insights 首屏骨架/失败快照/关闭明细单列/tbar/宽版断点。

## 逐条补充处置（Lead 收口核对后补录）

| ID | 状态 | 证据 | 说明 |
|---|---|---|---|
| P14-07 | 延后（C9） | 区域报告 P14-07 | 列表分段 3→5 段与行信息结构属设计同步/裁决项（补充稿口径），需设计确认后统一，不自行改设计口径。 |
| P14-09 | 延后（C9） | 区域报告 P14-09 | 提交门槛“全部问题必答 vs 仅必答题”为主稿与补充稿冲突，需产品/设计裁决；实现按服务投影（required 门禁）执行。 |

