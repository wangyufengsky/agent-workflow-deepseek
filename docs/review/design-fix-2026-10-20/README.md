# 前端设计一致性修复 · 验收报告（2026-10-20）

> 输入：`docs/review/design-audit-2026-10-20.md` + 16 份区域审计报告（369 条 finding：P0 2 / P1 50 / P2 183 / P3 134）。
> 分支：`fix/design-audit-2026-10-20`（基于 `main` @ `3f6f9b2`，审计文档先单独提交）。
> 执行方式：Lead 规划与验收 + 8 名员工（Agent Teams 共享任务板，task-1..task-17），写范围隔离、共享文件最小 edit；Lead 另直接修复 P08-01/P14-02/P23-01 及 P07-23/P13-01 的独立复核与门禁。
> 判定口径：`已修复` = 设计态可达且有代码/测试证据；`部分` = 主链可达但存在 C1 契约 / C9 设计裁决 / 需 GUI 残差；`延后` = 本轮不做且写明原因。设计稿目录 `opencode-workflow-design-showcase/` 全程只读（`git status` 0 改动）。

## 1. 结果总览

| 严重度 | 总数 | 已修复 | 部分 | 延后 |
|---|---|---|---|---|
| P0 | 2 | **2** | 0 | 0 |
| P1 | 50 | **40** | 9 | 1 |
| P2/P3 | 317 | 121 | 70 | 126 |
| **合计** | **369** | **163** | **79** | **127** |

- 每条 finding 的处置记录：15 份区域文档（`00-global-crosscutting.md`、`01-home-projects.md` … `15-delivery.md`），逐条 `ID | 状态 | 证据 文件:行 | 说明`；少量仅在报告正文记录的条目已在本轮补录为表格行。
- **P0 验收核心**：
  - `P07-23`（PPT 保存方案/加一页伪造“全部页面已完成”、放开导出）→ 服务端逐页 diff 合并 + 保留停止/失败/未知状态 + 导出门槛以 `productionPages` 为准；`packages/engine/src/ppt.test.ts` 5/5 回归通过。
  - `P13-01`（执行结束待交付却显示绿色“已完成”）→ `situation.ts` 拆「执行与验收 / 交付」两事实，未交付固定 wait「执行已结束 · 等待交付」；`situation.test.ts` 8/8 含“未交付不得显示任务已完成”断言。
- **P1 未完全修复项（9 部分 + 1 延后）**：
  - 部分：`P11-04`（PW 六态已接，partial「只补缺步」缺 GitPort 跨域能力）、`P13-04`（停滞无服务事实，审批/验收已接）、`NODE-03/07/08/09/10`（工具排队/取消、取消链、补读游标、结构化引用、尝试详情受 C1 服务字段限制）、`DEL-01`（服务/契约异常家族已实现，UI 由需求画布接线后仍余部分创建补建）、`DEL-20`（确认层/冲突事实已做，三方文本读口 C1）。
  - 延后：`P20-01`（openGauss/GaussDB/Oracle/达梦/DB2 驱动缺口，C9 产品/设计裁决 + 外部实例；现状已诚实禁用，未伪造）。
- **P2/P3**：本轮按区域报告逐条分诊与修复（区域 01/05/09/11/13/14/15 等），剩余 126 条延后的主要原因为 C1 契约缺失、C9 设计裁决、需 GUI/真实模型/外部服务验证、跨写范围/时间盒；完整清单见 `p2-p3-backlog.md`。

## 2. 关键验收证据

| 门禁 | 结果 | 说明 |
|---|---|---|
| `npm run typecheck` | ✅ 0 错误 | 全仓 `tsc -p tsconfig.json --noEmit` |
| `npm test` | ✅ 681 tests / 663 pass / 0 fail / 18 skipped | skipped 均为需要真实模型/外部服务的 live 测试（原有行为） |
| Web 单测（node） | ✅ 21/21 | `apps/web/src/pages/node/*.test.ts` + `task/situation.test.ts`（默认 `npm test` 只扫 packages/tests，未纳入） |
| P0 回归 | ✅ P07-23 5/5；P13-01 8/8；DEL-14/17 11/11 | 新增 engine 回归测试已随 `npm test` 执行 |
| `npm run check:design` | ✅ | ds.css 与设计稿逐字节一致（30045 字节）；themes.ts 与生成器输出一致（86 令牌 × 4 主题） |
| `npm run check:docs-routes` | ✅ | `npm run docs:api` 已重生成 `docs/api.md`（新增 20 路由、删除 1 条已移除的 delivery merge 路由） |
| `npm run build` | ✅（typecheck/mcp/web/server/desktop） | 产物构建通过 |
| `git diff --check` | ✅ | 无空白错误 |
| 设计稿只读 | ✅ | `opencode-workflow-design-showcase/` 0 改动 |
| 独立代码复核（只读） | ✅ | 对 P07-23 / P13-01 / DEL-07·14 / UNKNOWN 链 / 全局外壳 5 组复核：4 PASS + 1 PASS；发现的 1 条 P2 边界（MR 核对未覆盖 merged/closed）已修复并补 2 条回归测试 |

## 3. 本轮对既有测试的更新（诚实记录）

行为按设计与审计结论变更后，4 个既有集成用例的旧断言同步更新，均属**产品语义变更**而非放宽校验：

1. `tests/integration/delivery-fixroot.test.ts`：原「产品内 merge API 合并分支并置任务 completed」→ 改为断言 `POST /delivery/merge` 已不存在（404）、目标分支未移动、任务未完成（`DEL-07` 设计明令禁止产品内合并）。
2. `tests/integration/delivery-mr.test.ts`：GitHub stub 增加只读 MR 列表响应（`DEL-14` 创建前只读核对需要），创建仍断言只 POST 一次。
3. `tests/integration/gitlab-mr.test.ts`：列出 MR 的 fixture 源分支改为非交付分支，避免「已有同源 MR」被正确复用而干扰“创建”断言。
4. `tests/integration/remote-unknown-settlement.test.ts`：原 UNKNOWN 后重试期待远端 `MR_ALREADY_EXISTS` → 改为断言 UNKNOWN 期间**不重复 POST**（返回 `RECEIPT_UNKNOWN`、原请求号保持可核对）；确定失败场景改为重置原未知步后单独验证。

另修复 2 个真实回归：

1. `packages/server/src/http.ts` 的 `taskDetailEnvelope` / workspace 路由用 PW prepare 投影覆盖了只读验证草稿的 `RECOVERY_READ_ONLY` 拒绝原因（被 `tests/integration/recovery-readonly.test.ts` 捕获）→ 只读任务保持原 capabilities，不再被 `PLAN_NOT_CONFIRMED` 覆盖。
2. `packages/engine/src/template-scope.ts`：自定义时间范围上界超过 2038（如 2100-01-01）时，git 的 approxidate 32 位 epoch 溢出会让 `--until` 静默匹配不到任何提交（本机 git 2.45 正常、CI git 2.55 复现；该测试在 `main` 上的上一次 CI 也已失败，属既有问题）→ 超范围边界不再传给 git，仍由 JS 日期过滤执行；`tests/integration/task-catalog-parity.test.ts` 覆盖。

## 4. 需 GUI / 真实服务复验（不作为“已通过”）

沿用审计 §6 的局限：本轮未运行 GUI、未做四主题 × 1440/1280/1024 像素级对比、未跑完整键盘矩阵、未调用真实模型/真实 GitLab/PG/达梦等外部服务。各区域处置文档的「需 GUI」清单即为复验清单，重点：

1. 四主题下页头/面包屑/情况条/抽屉/图谱/阅读器的排版、间距、溢出；
2. 键盘矩阵（Tab 焦点陷阱、Esc、焦点归还、页签方向键）与 `data-motion` 三态动画；
3. 真实模型：知识研究四步/引用上标、规划、PPT 助手/逐页制作、审查修复；
4. 真实外部服务：GitHub/GitLab 写（MR 去重/合并状态）、非 Git 目录应用、数据库扩展驱动（planned，未伪造）；
5. 故障注入：断网/丢回执/409 并发/基线漂移/撤权竞态（各页 UNKNOWN 链已按原 requestKey 核对实现，需真实场景复验）。

## 5. 复验命令

```sh
npm install
npm run typecheck
npm test
node --import tsx --test apps/web/src/pages/node/*.test.ts apps/web/src/pages/task/situation.test.ts
npm run check:design
npm run check:docs-routes
npm run build
```

## 6. 产出物索引

- `00-plan.md`：执行计划、任务分派与验收门禁。
- `00-global-crosscutting.md` … `15-delivery.md`：16 个区域逐条处置记录（`03-ppt-main.md`/`04-ppt-studio.md` 等）。
- `02-knowledge.md`、`07-tasks-task.md`、`08-node-detail.md`、`14-git.md`、`15-delivery.md`：重点 P0/P1 证据。
- `p2-p3-backlog.md`：未纳入本轮的 P2/P3 清单（后续批次）。
- `c10-doc-corrections.md`：审计 §3.8 C10 旧文档口径更正记录。
