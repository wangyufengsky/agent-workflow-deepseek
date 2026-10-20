# P07 PPT 工作台 · 设计一致性修复处置（2026-10-20）

> 基线：`main@3f6f9b2`，分支 `fix/design-audit-2026-10-20`（未 commit/push）。权威审计：`docs/review/design-audit-2026-10-20/04-ppt-studio.md`。
> 写范围：`apps/web/src/pages/ppt/**`、`packages/engine/src/ppt.ts` / `ppt-*.ts`、`packages/shared/src/api/contracts.ts`（PPT 段）、`packages/shared/src/domain/ppt-renderer.ts`、本文件。
> 验证：`npm run typecheck`（PPT 相关文件 0 错误）；`node --import tsx --test packages/engine/src/ppt.test.ts`（**5/5 通过**）；`node --import tsx --test tests/integration/ppt-works.test.ts tests/integration/ppt-production.test.ts tests/integration/ppt-plan-stop.test.ts tests/integration/ppt-page-generation.test.ts`（15/15 通过）。

## P07-23（P0）修复与回归证据

**问题**：制作方案保存 / 加一页的整份 `slides` PATCH 让服务端把 `productionPages` 全部改写为 `completed/source:manual` 并 `generation.clear`，伪造“全部完成”、抹掉停止/失败页原因、放开导出。

**修复（服务端）**
1. `packages/engine/src/ppt.ts:240-249`：整份 `slides`/`outline` PATCH 不再整体改写 `productionPages`，改为逐页合并（`mergeProductionPages`，`:501` 起）：
   - 内容未变的页保留原 `status/source/message`（含 `stopped/failed/unknown/pending`）；
   - 仅排序变化的页按内容身份移动到新索引并保留状态；
   - 用户真正改了内容的页记为人工完成（`source:'manual'`）；新增页与全空“新页面”只能是 `pending`，永不 `completed`；
   - 仅改大纲标题时按标题身份保留未完成页状态。
2. `packages/engine/src/ppt.ts:245-255`：删除 `this.#generation.clear(id)`——生成记录是“本次已制作 X/Y”与停止/失败原因的唯一证据，新一次生成开始时自然覆盖。
3. `:446-452`：导出门槛改为以 `productionPages`（逐页生产事实）优先，`generation.pages` 仅作旧数据回退；`#assertProductionComplete` 继续拒绝未完成页导出。
4. 显式“加一页”语义：`PptWorkUpdateRequest.appendPage`（`packages/shared/src/api/contracts.ts:932-933`）+ 服务端 `:218-231` 只追加一个 `pending` 页，前端 `PptStudio.tsx:112` 不再提交整份 slides。
5. 前端：`PptPlanDrawer.tsx:68` 保存方案默认只提交方案字段，仅当页面内容真的改动时才带 `slides`；`ppt-shared.tsx` 新增 `pptProductionPages()`，PptStudio/导出门槛/进度推导改为 `productionPages` 优先，避免旧 generation 快照盖过逐页事实。

**回归测试**：`packages/engine/src/ppt.test.ts`（5 条，全部通过）
1. `:104` 保存方案（plan-only PATCH）不清空未完成页状态、不清生成记录、导出仍被拦截；
2. `:123` 旧版前端整份 slides PATCH（内容未变）不会再伪造全部完成；
3. `:135` 加一页（appendPage）只追加 pending 页，已有逐页状态保留且导出仍被拦截；
4. `:149` 真正编辑某一页时只有该页记为人工完成，其余未完成页保留；
5. `:163` 删除后再加一页时空的新页面只能是 pending，不能借用旧页索引伪造完成。
证据口径：测试用真实 `Store` + `PptService`，预置“逐页制作中途停止后”的持久状态（page0 completed、page1-2 stopped、`ppt.generation.<id>` 记录），断言 `productionPages` 状态/原因未被改写、生成记录仍在、`actions.export.allowed===false` 且 `exportMarkdown()` 抛“未完成制作”。

## 逐条处置

| ID | 状态 | 证据（文件:行） | 说明 |
|---|---|---|---|
| P07-23 | 已修复 | 见上节；`packages/engine/src/ppt.ts:218-255,446-452,501+`；`apps/web/src/pages/ppt/PptPlanDrawer.tsx:68`；`PptStudio.tsx:111`；`ppt-shared.tsx:36-47` | 数据诚实 P0 闭环 + 5 条 engine 回归测试。 |
| P07-01 | 部分（核心已修复） | `PptWorkbenchSteps.tsx:52-152`（五项简报 pending/fresh、“还差 N 项/信息已经足够”、“生成制作方案”CTA） | ①讨论需求按设计逐项补全：未补项虚线“等待讨论”、刚补项高亮、底部 CTA 文案与门槛（五项齐全才可用；信息齐全且已保存时触发真实大纲生成，否则先保存再进入②）。**延后**：助手问题快捷选项需在共享 DTO 增加结构化候选字段（C1），本轮不做。 |
| P07-02 | 已修复 | `PptWorkbenchSteps.tsx:154-355`（大纲行编辑/上移/下移/删除/加一页 + 底部确认条）；`PptProductionPanels.tsx:34-45`（方向本地草稿） | ②设计方案 toolbar 文案与设计一致；大纲可增删排序；方向卡本地草稿不再点选即写服务（P07-12 一并修复）；底部 sticky 确认条「回到讨论 / 确认并开始制作（页数 · 时长说明）」；确认保存 `plan.confirmed` 后等新修订回执再发起逐页制作（真实 generateSlides 命令）。预计时长如实写“以模型为准”（服务无估算能力，C9）。 |
| P07-03 | 已修复 | `PptPlanDrawer.tsx:50-76`（阶段条四态 + 整表只读）；`:92`（修改方案确认 Modal） | 顶部阶段条：可编辑（按方案制作/确认方案）、已用于制作（整表只读 +「修改方案」确认“现有页面和导出会保留”）、制作中只读+原因、已归档只读+原因；`pl-review` 整表只读（`context.blocked` 覆盖七个模块），只读时隐藏保存并显示“只读 · 已保存修订 N”。 |
| P07-04 | 已修复 | `PptPlanDrawer.tsx:73-76`；`PptWorkbench.tsx:81,114,154` | 只读原因横幅（制作中/已归档原文）、页头「已归档」徽标、只读时保存按钮隐藏、版本/资料抽屉尺寸 `md` 与设计标题说明。 |
| P07-05 | 部分 | `PptWorkbench.tsx:95`（制作方案入口常显） | 未实现「⋯ 作品菜单」与工作台内归档/恢复入口；B-09 入口结构延后（P2，需作品菜单交互与归档命令放在页头，属结构改造）。 |
| P07-06 | 延后 | — | `pl-blocked` 需要把 studio 的对象草稿状态上提到 workbench 并实现 protect() 拦截；本轮未做跨组件状态提升，避免与 P13 对象编辑并发冲突。 |
| P07-07 | 部分 | `PptPage.tsx`（workbench 深链 loading/error 分支） | 深链加载中不再显示“还没有选择作品”，读取失败给 `ServiceNotice`+重试。抽屉内读取中/失败：方案内嵌在作品列表响应（无独立读取端点，C1），按设计变更登记为“读取状态由作品列表承担”，未伪造 per-panel loading。 |
| P07-08 | 延后（产品/设计决策） | `PptPlanDrawer.tsx:78`（保存中显示“正在保存…”） | 保留显式保存+requestKey 回执模型（更符合仓库写操作契约），未改成自动保存；本轮只修正“保存中显示当前只读”的状态污染。是否补自动保存需产品裁定（C9/C10 交 Lead 统一口径）。 |
| P07-09 | 部分 | `PptPlanDrawer.tsx:80`（「读取最新方案」）；`PptPage.tsx:208-212`（update 失败后主动重读作品） | 409/失败后主动刷新作品列表使抽屉进入陈旧态，并提供「读取最新方案」；尚无单作品读取端点（C1），合并仍按“保留本地输入 + 已比对后按当前修订保存”。 |
| P07-10 | 延后（C1 契约） | `PptPlanSections.tsx:76-80`（诚实说明不可勾选项目文档） | 资料抽屉/每页依据需要“作品来源选择 + 解析状态”结构化契约；本轮只补诚实说明，不伪造设计态。 |
| P07-11 | 已修复 | `PptStudio.tsx:124`（“N 个问题 · M 页已检查”、三项通过清单、让助手精简、用户化 issue 文案）；`:35-37`（code→用户文案映射） | 检查页签补计数、通过项（字号层级/无占位文字；投影可读性按服务无能力如实标“需人工核对”）、问题行「让助手精简」切到助手页签并预填问题描述；缩略图问题标记按 P07-13 用琥珀旗标。 |
| P07-12 | 已修复 | `PptProductionPanels.tsx:34-45`；`PptWorkbenchSteps.tsx:173-180` | 视觉方向改为本地草稿，随②确认条一次提交；不再点选即发 PATCH，不再制造无谓 409。 |
| P07-13 | 已修复 | `PptStudio.tsx:111`（`.ppt-flag` 琥珀旗标）；`:114`（页头问题徽标用用户文案）；`ppt.css`（`.ppt-flag`/`.ppt-issue-badge`） | 缩略图右上角琥珀圆形旗标 + 页头具体问题徽标（文字+图标）。 |
| P07-14 | 已修复 | `PptPlanSections.tsx:88-94`（分段控件、色块预览/斜纹、`.invalid`、选项卡红点、文案原文） | 文字密度改分段控件；强调色 40×40 色块预览、无效时斜纹 + 输入框标红 + 设计原文提示；视觉规范页签红点。 |
| P07-15 | 部分 | `PptPlanSections.tsx:38-68` | 已补：建议页数字段、页面卡“版式 · 核心观点”摘要、演讲辅助标题/空占位、交付设置 `.pptx` hint 与说明、方向描述原文；**延后**：「自行填写方向」需服务放开方向 id（C1），已加诚实说明。 |
| P07-16 | 已修复 | `PptPlanSections.tsx:40,61-65`；`PptPlanDrawer.tsx:92` | 章节移除「历史版本仍会保留」、页面移除「移除这页设计？历史版本仍会保留」、修改方案确认（含“修改后需要重新制作才会生效”）。 |
| P07-17 | 延后（产品决策） | — | 导出仍是第四步页面而非对话框；多出的 Markdown/删除区与“带警告导出已完成页”涉及服务契约（`#assertProductionComplete`）与设计冲突（C9），本轮不改导出结构。 |
| P07-18 | 部分 | `PptWorkbench.tsx:66-84`（面包屑“PPT 制作 / 作品名”） | 页头补面包屑；自动保存状态提示随 P07-08 决策延后。 |
| P07-19 | 已修复 | `ppt.css`（`@media(max-width:1380px)` 只显示当前步名称）；`PptStudio.tsx:117`（手动编辑态收起备注） | 窄屏只显示当前步骤名称；演讲备注在手动编辑态默认收起、其余展开；实现自加的 `available` 导出态保留待产品确认。 |
| P07-20 | 部分 | `components/Drawer.tsx`（已有 `trapTabKey` 焦点圈定） | 版本/资料抽屉已具备 Tab 圈定；四步条 roving tabindex/方向键与助手历史自动滚底未做（P3，需键盘矩阵 GUI 验证）。 |
| P07-21 | 已修复 | `PptWorkbench.tsx:114,154` | 版本/资料抽屉改 `size="md"`（480），标题改为“版本”“资料”并补设计说明。 |
| P07-22 | 部分 | `PptAssistantPanel.tsx`（按阶段 placeholder、修改范围选项、讨论态隐藏范围控件） | 占位文案随阶段变化、范围控件改为“仅所选页面/整份演示”（讨论态不显示）；**延后**：消息角色图标、字段级候选可读化（P3）。 |
| P07-05/06/08/10/17/20 余项 | 延后 | — | 见上表说明；均属 P2/P3 或需契约/产品决策，未阻塞 P0/P1 链路。 |

## 需 GUI / 真实服务复核

1. P07-23：真实服务“逐页制作中途停止 → 保存方案/加一页 → 回工作台/导出”的端到端复现（engine 回归已覆盖持久状态语义，UI 计数/横幅需 GUI 确认）。
2. P07-01/02：讨论阶段五项补全高亮、确认条粘性定位、确认后自动发起逐页制作的回执顺序。
3. P07-03：pl-review 整表只读、修改方案确认、按方案制作关闭抽屉并启动生成的观感。
4. P07-11/13/14：四主题下琥珀旗标对比度、分段控件、色块斜纹与页签红点。
5. 未运行 `npm run dev`、未截图、未做四主题像素对比；`npm run typecheck` 为全仓检查，最终快照时非 PPT 文件存在并发队友的临时错误，PPT 相关文件 0 错误（详见给 Lead 的汇报）。
