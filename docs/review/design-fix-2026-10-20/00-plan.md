# 前端设计一致性修复 · 执行计划与验收（2026-10-20）

> 输入：`docs/review/design-audit-2026-10-20.md` 及 16 个区域报告（369 条 finding：P0 2 / P1 50 / P2 183 / P3 134）。
> 工作分支：`fix/design-audit-2026-10-20`（基于 `main` @ `3f6f9b2`；审计文档已先提交）。
> 角色：Lead 负责规划、分派、跨区域裁决与最终验收；8 名员工按工作流并行修复（Agent Teams 共享任务板）。

## 1. 本轮范围（PR 内容）

| 批次 | 内容 | 计数 | 说明 |
|---|---|---|---|
| 批次 1 | P0 + P1（数据诚实 / UNKNOWN 回执安全 / 全局外壳 / 各页主链路） | 52 | **本轮必须修复**；审计 §7 批次 1–3 |
| 批次 2 | 全局横切全部 P2/P3（GLB） | 13 | 影响全站，随批次 1 一起做 |
| 批次 3 | 各区域 P2/P3 中与数据诚实/死代码/文案直接相关、成本低者 | 视产能 | 由各区域负责人在 P0/P1 完成后顺延处理 |
| 后续 | 其余 P2/P3 | 见 `p2-p3-backlog.md` | 批次 4「持续」，按区域报告逐条收口 |

**判定口径（重要）**：设计态不可达若根因是服务/契约缺失（C1）或需产品/设计裁决（C9）、需 GUI 或真实外部服务验证，则本轮只做「诚实降级 + 契约补齐（可做时）」，并在区域处置文档记录原因，**不得伪造成功态或假称已修复**。任何 finding 都必须有处置记录（已修复 / 部分 / 延后+原因）。

## 2. 工作流分派（共享任务板）

| 任务 | 负责人 | 范围 | 主要 finding |
|---|---|---|---|
| task-1 | global-shell | 外壳/页头/导航/主题/共享组件/设计系统校验 | GLB-01..14 |
| task-2 | ppt-parity | P05/P06/P07，含 P0 | P07-23(P0)、P05-01/03、P07-01/02/03 + P2 |
| task-3 | task-canvas | P12/P13 + TD06 | P07…P13-01/02/03/04/05/06/12、P12-01/02、DEL-26 |
| task-4 | node-detail | 节点执行详情 N01–N20 | NODE-01..10 P1 + P2 |
| task-5 | requirement | P11 需求画布 | P11-01..04、REQ-01/02 |
| task-6 | git-parity | Git 仓库页 | GIT-01..06 P1 + P2 |
| task-7 | delivery-parity | 交付/隔离 TD01–TD07 | DEL-07/14/01/13/20 + P2 |
| task-8 | roles-settings | P21/P22 | P21-01/02、P22-04 等 |
| task-9 | （待指派，队列） | P03/P04 | P03-01/02 + P2 |
| task-10 | （待指派，队列） | P08/P14/P18/P20/P23 | P08-01、P14-02、P20-01、P23-01 |
| task-11 | Lead | 最终验收/文档/PR | — |

> 团队并发上限 8 名员工；task-9/task-10 在前序成员空闲后立即派发，Lead 视情况自己兜底。

## 3. 验收门禁（Lead 执行）

1. `npm run typecheck` 0 错误（全仓）。
2. `npm test` 全量通过（单元+集成；包含新增回归测试）。
3. `npm run check:docs-routes` 通过（新增/修改端点必须同步 `docs/api.md`：`npm run docs:api`）。
4. `npm run check:design` 通过（GLB-11 新增：ds.css 与设计稿逐字节一致）。
5. `npm run build:web` / `npm run build:server` 构建通过。
6. 重点人工复核：P07-23（保存方案不再伪造全部完成、导出仍拦截）、P13-01（未交付不显示绿色完成）、DEL-07（产品内合并移除）、UNKNOWN 链（只核对原 requestKey）。
7. 每条 P0/P1 在处置文档有「已修复/部分/延后+原因」记录；延后项必须给 C1/C9/需 GUI/外部服务原因。
8. 处置文档汇总为最终验收报告；PR 合并到 `main`。

## 4. 已知风险

- **并发写**：8 名员工并行，共享文件（`contracts.ts`/`enums.ts`/`http.ts`/`api/workflow.ts`）约定只做最小 `edit`，出现 `FS_STALE_VERSION` 重读后重试；Lead 最终统一复核。
- **契约先行**：C1 类 finding 需先补 shared DTO/服务端点；若无法在不伪造数据的前提下补齐，按延后处理。
- **静态审计局限**：审计未跑 GUI/真实模型/外部服务；视觉像素级与键盘矩阵类结论仍标「需 GUI」，本轮不伪造「已通过」。
- **范围**：317 条 P2/P3 不在本轮全部修复范围（审计 §7 批次 4「持续」），以 `p2-p3-backlog.md` 跟踪。

## 5. 产出物

- 产品代码修复（apps/web、packages/*）。
- `docs/review/design-fix-2026-10-20/<区域>.md`：逐 finding 处置记录（每条：ID | 状态 | 证据 | 说明）。
- `docs/review/design-fix-2026-10-20/p2-p3-backlog.md`：未纳入本轮的 P2/P3 清单。
- 本文件补充最终验收结果（§6）与 GitHub PR。

## 6. 最终验收结果（2026-10-20）

| 项 | 结果 |
|---|---|
| typecheck（全仓） | ✅ 0 错误 |
| 全量测试 | ✅ 681 tests / 663 pass / 0 fail / 18 skipped（skipped=需真实模型/外部服务的 live 用例） |
| P0 回归 | ✅ P07-23 ppt.test 5/5；P13-01 situation.test 8/8；DEL-07/14/17 delivery.test 11/11 |
| Web 单测 | ✅ 21/21（node 14 + situation 8；默认脚本未扫 apps/web） |
| check:design | ✅ ds.css 逐字节一致 + themes.ts 生成一致 |
| check:docs-routes | ✅ docs/api.md 已重生成（+20 路由 / -1 已移除的 delivery merge） |
| build | ✅ typecheck + mcp + web + server + desktop 构建通过 |
| diff 卫生 | ✅ `git diff --check` 干净；设计稿目录 0 改动 |
| 独立复核 | ✅ 5 组高风险修复：4 PASS + 1 PASS（1 条 P2 MR 核对边界已修复并补测试） |

处置统计：369 条 = 已修复 163 / 部分 79 / 延后 127；P0 2/2 已修复，P1 50 条中 40 已修复、9 部分、1 延后（P20-01 C9 驱动缺口）。
完整验收记录与复验命令见 `README.md`；逐条处置见各区域文档；后续 P2/P3 见 `p2-p3-backlog.md`。
