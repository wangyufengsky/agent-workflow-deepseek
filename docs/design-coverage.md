# 设计稿覆盖矩阵

> 设计来源：`opencode-workflow-design-showcase/`（v5：`originals/main` 22 个正式产品页 + B-01/B-04/B-15 补出 recovery / requirements / roles-legacy，共 25 页；另核对 delivery / planning / git / node 补充稿）。
> 实现基线：`apps/web/src/app/App.tsx`（2026-10-19，Wave 2 完成、Wave 3A 进行中的工作区快照）。
> 状态口径：✅ 主流程与设计对齐（仅文案/P2 差异，关键缺口列仍注明）；🟡 页面/载体已存在，但核心区块缺失、降级或以面板替代；⛔ 无路由、无载体或未实现。
> 证据口径：集成测试 + `npm test`（最近一次 **345 tests / 54 suites / 334 pass / 11 skipped / 0 fail**，46.6s，`.tmp/wave2-verify.log`）+ `docs/review/execution-log.md` + `npm run build:web`。当前沙箱 UI smoke 因 Electron GPU 初始化失败，**没有像素级视觉回归**；`docs/evidence/` 截图早于 Wave 0。
> 与审查报告的关系：`docs/review/design-parity.md`（18:39 快照）是逐页差异审查；本文件是**当前覆盖矩阵**，已按 Wave 1/2 的实际代码更新其中已闭合项，后续每波合并后同步更新。

## 0. 总结

- 25 个正式页中：**✅ 2、🟡 19、⛔ 4**。4 个完全缺失页：`ppt-studio`、`workflow-editor`、`run`、`roles-legacy`。
- Wave 1/2 已闭合的主要缺口：知识对话记录页（新增 `/knowledge/history`）、任务画布自动推进/整体推进/推进直接后继/放弃调整、恢复页 unknown 三入口、非 Git 工作区真实清理、恢复三模式真实差异、PPT「生成中」启动恢复、`viewActions` 回归、契约路由。
- 仍缺的整块能力：待处理中心就地处理、角色四页签、知识库研究体验、项目详情/公约、工作流编辑器、PPT 工作室/作品专页、run 页、PE37、任务画布冻结/审计/运行内容/快照评审、节点详情子视图、首页/品牌收敛。
- **不要把本矩阵当完成度百分比**：标 🟡 的页面多数主流程可用，但设计要求的核心区块仍未实现；⛔ 项没有可点击载体。

## 1. 25 个正式产品页

| # | 设计页 | 实现路由 / 载体 | 覆盖度 | 已验证证据 | 关键缺口（未完成） | 更新 |
|---|---|---|---|---|---|---|
| 1 | `home` | `/` `HomePage` | 🟡 | `npm run build:web`；`docs/evidence/home-deepseek.png`（旧图） | 多出统计三卡、「需要你处理」「最近活动」；设计只有「进行中」单卡；行内提示文案不同 | 10-19 |
| 2 | `projects` | `/projects`、`/projects/:projectId` `ProjectDetailPage`（W3-1a 进行中，未验收） | 🟡 | 项目登记/重检/归档集成测试；build:web；W3-1a 代码已开始落地 | 四页签（概览/Git 与 GitLab/文档路径/项目公约）、配置状态清单与项目公约后端待验收；卡片缺「查看 Git / 模板任务」入口 | 10-19 |
| 3 | `knowledge` | `/knowledge` `KnowledgePage` | 🟡 | knowledge-sources 测试、知识问答 live PASS（引用校验 + conversationId） | 缺研究四步、命中来源卡、来源选择、流式/轮询回答、引用原文 520 面板、研究员检查面板（W3-4） | 10-19 |
| 4 | `knowledge-history` | `/knowledge/history` `KnowledgeHistoryPage` | 🟡 | `App.tsx`（`/knowledge/history` 路由）；W3-7a 33 项 UI 断言（execution-log 20:36）；`/api/knowledge/history` | 服务端无会话状态字段：状态分段降级为「全部/有引用/无引用」，无「需要回答/进行中/已完成/去回答」；无重命名/归档/删除；面包屑仍「知识库」；无独立集成测试 | 10-19 |
| 5 | `ppt` | `/ppt` `PptPage` + 作品视图组件（`PptWorksView` / `PptWorkbench`，W3-7b 进行中） | 🟡 | `ppt-works.test.ts`、PPT live PASS、W1-1 44 项 UI 断言、真实 PPTX 导出 | 设计「讨论需求 → 确认方向 → 逐页制作」的讨论会话与确认方向入口未做；作品/工作台视图 W3-7b 待验收；高级视觉（品牌模板/PDF/逐页视觉检查）未做 | 10-19 |
| 6 | `ppt-works` | 无独立路由；`/ppt` 内 `PptWorksView` / `PptWorkbench`（W3-7b 进行中，未验收） | 🟡 | `PptPage.tsx` 作品列表/选中/导出；W3-7b 代码已开始落地 | 无 `/ppt/works` 专页；作品网格/阶段进度/下一步/归档/复制/导出页级入口待验收 | 10-19 |
| 7 | `ppt-studio` | 无 | ⛔ | — | 四步工作台、大纲/视觉方向、逐页检查、七模块制作方案均无；W3-7b/后续 | 10-19 |
| 8 | `start` | `/start` `StartPage` | 🟡 | W1-4 查询参数预选（`StartPage.tsx`）；planning/start 补充稿基本对齐 | 仍是「标题 + 需求原文」结构；缺自动命名/「未命名任务」、项目与流程抽屉、版本核对、草稿回执页；W3-9a 进行中 | 10-19 |
| 9 | `workflows` | `/workflows` `WorkflowsPage` | 🟡 | 搜索/筛选/详情步骤/「用这个流程开始任务」；build:web | 目录只读、编辑按钮禁用；缺步骤链（并行）、使用次数、复制/归档、详情加载/错误态（W3-8） | 10-19 |
| 10 | `workflow-editor` | 无 | ⛔ | — | 画布编辑/增删/撤销重做/检查定位/保存与冲突全缺；W3-8 pending | 10-19 |
| 11 | `requirement` | `/requirement/:id` `RequirementCanvasPage` | ✅ | planning-live PASS；五段胶囊/规划状态条/四图层/阶段页签/规划记录/检查/应用/确认 | 缺页头「更多操作」（保存为流程/查看问答/取消需求）；右侧标题「规划面板」与设计「计划」为文案差异 | 10-19 |
| 12 | `tasks` | `/tasks` `TasksPage` | 🟡 | 列表/筛选/项目分组/需处理；build:web | 行内步骤状态条、行更多菜单（打开画布/复制链接/归档）、加载更多/已归档缺失；W3-9a 进行中 | 10-19 |
| 13 | `task` | `/tasks/:id` `TaskCanvasPage` | 🟡 | `execution-control.test.ts` 5 pass（自动推进/推进一步/放弃调整）；W2-10 恢复页 unknown；任务画布恢复入口 | 缺「⋯」菜单（恢复/冻结计划/审计记录/暂停/停止）、运行内容入口、快照评审 B-07；节点面板「推进直接后继」W3-5a 已落地待验收；放弃调整后恢复「调整前已暂停」W2-15；情况条缺少上下文操作 | 10-19 |
| 14 | `inbox` | `/inbox` `InboxPage` | 🟡 | 汇总列表/按类型分组/跳转；build:web | 不能就地回答/授权/拒绝；缺单选多选/推荐/权限范围卡/未知回读/草稿保留；规划事项区缺失；W3-2 pending | 10-19 |
| 15 | `insights` | `/insights` `InsightsPage` | ✅ | insights / task-acceptance / task-usage 集成测试 | 少项目/任务状态/包含已归档筛选；多出「运行统计」块；汇总卡口径与设计三卡不同（P2） | 10-19 |
| 16 | `templates` | `/templates` `TemplatesPage` | 🟡 | templates 测试；W1-2 导入/可视化+JSON 编辑/归档；历史任务 | 缺分支/时间范围/源码范围/需求文档、底部固定说明条、B-06 五页签归档、左侧分组；导入与可视化编辑是实现自行扩展 | 10-19 |
| 17 | `run` | 无 | ⛔ | — | 文档/源码/单测阅读器、需求覆盖、批次恢复、引用原文、运行身份未知态全缺；W3-5/W3-7 | 10-19 |
| 18 | `runtime` | `/runtime` `RuntimePage` | 🟡 | 状态主卡/事实卡/重启确认/错误态（round 85/86 实测） | 「最近一次操作」为空占位；缺外部进程/启动失败专门态；P2 | 10-19 |
| 19 | `tools` | `/tools` `ToolsPage` | 🟡 | 工具总览/toolset 启停/Skill 带行号源文；skills 测试 | 缺配置范围（全局/项目）、逐工具继承/启用/停用、来源整体停用影响清单、部分/未知状态 | 10-19 |
| 20 | `databases` | `/databases` `DatabasesPage` | 🟡 | 连接 CRUD/探针/只读查询/JDBC 拆分；database 测试 | 缺 openGauss/GaussDB 契约类型、授权项目/可读范围、只读强制三态、抽屉授权项目/启用开关、状态分段筛选；W3-9 | 10-19 |
| 21 | `roles` | `/roles` `RolesPage` | 🟡 | roles-api 测试；发布历史/恢复快照 | 四页签（职责与指令/能力范围/资源权限/形象）、能力开关、发布核对/差异、权限预估全缺；W3-3 pending | 10-19 |
| 22 | `settings` | `/settings` `SettingsPage` | 🟡 | settings 测试；服务/外观/模型与执行/Git/数据库分区可保存 | 缺重试等待/发布网络/开发辅助分区；设计监控间隔语义不同；缺会话异常阈值+细分超时；缺脏保存条与「生效」标签；W3-9 | 10-19 |
| 23 | `recovery` | `/recovery`、`/tasks/:id/recovery` `RecoveryPage` | 🟡 | recovery-api + `recovery-modes.test.ts`（三模式真实差异）；W2-10 unknown 三入口；任务画布入口 | `verify_only` 硬只读未强制（W2-4b）；恢复不复制执行上下文/阶段图；缺任务画布内完整入口（已有「到恢复页处理」） | 10-19 |
| 24 | `requirements` | `/requirements` `RequirementsPage` | 🟡 | 搜索/项目筛选/阶段计数/加载更多；build:web | 无 B-15 详情抽屉（行直接进画布）、无计划修订/状态说明；W3-9 | 10-19 |
| 25 | `roles-legacy` | 无 | ⛔ | — | 旧角色配置目录/四页签、版本比较、导入四步核对、发布全缺；W3-7 再评估 | 10-19 |

## 2. 补充稿与评审辅助页

| 设计稿 | 实现载体 | 覆盖度 | 已验证证据 | 关键缺口 | 更新 |
|---|---|---|---|---|---|
| `delivery/start.html` | `/start` + 需求画布「工作区」页签 | 🟡 | workspace 准备/清理测试；W3-9a 进行中 | 开始页没有隔离方式行/准备-开始两步预览；隔离信息分散在需求画布 | 10-19 |
| `delivery/task.html` | 任务页 `TaskDeliveryPanel` | ✅ | delivery / directory-apply 集成测试 | 设计明确「不新增一级页面」，以右侧面板承载，符合；仅细节文案差异 | 10-19 |
| `delivery/git.html`、`delivery/apply.html` | 任务页交付面板（Git / 非 Git 应用预览） | ✅ | `directory-apply-e2e.test.ts`、delivery merge/MR 测试 | 非 Git 应用、文件选择、目标、分步确认齐全 | 10-19 |
| `delivery/index.html`、`delivery/flows.html` | 不适用 | N/A | — | 评审辅助（状态图/容器说明），非产品页 | 10-19 |
| `planning/start.html` | `/start` | ✅ | planning-live PASS | 方法卡（必经步骤/可细化/AI 规划）、右侧四步说明已实现 | 10-19 |
| `planning/requirement.html` | `/requirement/:id` | ✅ | planning-live PASS | 五段胶囊、规划状态条、图层、页签、记录、检查、候选/应用/确认齐全 | 10-19 |
| `planning/task.html` | `/tasks/:id` | 🟡 | execution-control 5 pass | 自动推进/推进一步/放弃调整已补；仍缺领取竞态重确认、冻结/审计/运行内容入口 | 10-19 |
| `git/index.html` | `/git`、`/git/:projectId` | ✅ | git 读模型/worktree/REST 测试；GitHub 真实读/写 live PASS | 三栏工作台、提交三页签、diff、AI 审查/修复、提交/推送/MR/合并齐全；无结构性缺口 | 10-19 |
| `git/flows.html` | 不适用 | N/A | — | 操作流程说明文档 | 10-19 |
| `node/index.html` | `/tasks/:id` 右侧 `NodeDetailPanel` | 🟡 | 节点详情/attempt/output 集成测试 | 以面板替代独立页可接受；缺宽阅读区、工具详情、产物阅读/下载、引用原文、断线补读缺口；W3-5a/W3-10 | 10-19 |
| `main/index.html`、`main/skin-map.html` | 不适用 | N/A | — | 设计目录/颜色迁移图 | 10-19 |

## 3. 仍缺的整块能力（对应任务）

| 能力 | 状态 | 对应任务 |
|---|---|---|
| 待处理中心就地回答/授权/拒绝/未知回读/草稿保留 | ⛔ 未实现 | W3-2 |
| 角色管理四页签、能力/资源权限/形象、发布核对、权限预估 | ⛔ 未实现 | W3-3 |
| 知识库研究步骤、来源选择、流式回答、引用原文、研究员面板 | ⛔ 未实现 | W3-4 |
| 项目详情 `/projects/:id` 四页签 + 项目公约后端 | 🟡 进行中（W3-1a）：`App.tsx` 已注册路由，页面/页签/公约后端待验收 | W3-1 |
| 任务画布恢复/冻结/审计/运行内容入口、快照评审 B-07 | 🟡 部分：恢复入口已有；其余未做 | W3-5 |
| 节点面板「推进直接后继」入口 | 🟡 进行中（W3-5a）：`NodeDetailPanel` 已加入口，待验收 | W3-5a |
| PE37 大需求分组逐步细化 | ⛔ 未实现 | W3-6 |
| `ppt-works`/`ppt-studio`/`run`/`roles-legacy` 页 | 🟡 ppt-works 组件已落地待验收；其余 ⛔ | W3-7 / W3-7b |
| 工作流编辑器 | ⛔ 未实现 | W3-8 |
| 任务列表/开始页/模板/数据库/设置/需求目录结构缺口 | 🟡 部分进行中（W3-9a） | W3-9 |
| 节点详情子视图（工具/产物/引用/补读） | ⛔ 未实现 | W3-10 |
| 主页与品牌收敛（多出区块、产品名/页头主题入口） | ⛔ 未实现 | W3-11 |
| 自动推进/推进一步/放弃调整、非 Git 清理、恢复三模式、PPT 生成恢复、知识历史页 | ✅ 已实现并验证 | Wave 2 |
| W2-4b verify_only 硬只读、W2-12 远端超时 UNKNOWN、W2-14 storage removeJson、W2-15 恢复暂停态 | ⛔ 未实现 | Wave 2 follow-up |
| W0-4 节点验收（accept/reject） | 🟡 进行中（Wave 3A task-16/17） | W0-4 |

## 4. 已基本对齐、不应误报的部分

- **阶段胶囊**：主稿为四段，`planning/DESIGN-DELTA.md` 已定五段，实现按五段，视为对齐。
- **恢复位置**：设计 `task.html` 要求画布右面板，B-01 又新增独立恢复页；实现采用独立页 + 画布「到恢复页处理」入口，以较新的 B-01 为准。
- **皮肤数量**：`index.html` 文案写「五套皮肤」，但 `settings.html`/`CLAUDE-设计结果.md` 实际四套，实现四套，视为对齐。
- **菜单**：`originals/main/assets/shell.js` 的旧 NAV 缺 Git/需求目录/开始任务；实现 17 项菜单与 `sources/navigation-coverage-v2.json` 一致，视为对齐。
- **需求画布页签**：实现按 planning 补充稿的按阶段页签，不按主稿两态，视为对齐。
- **主题系统**：四套主题令牌集中在 `packages/shared/src/config/themes.ts` 与 `apps/web/src/styles/ds.css`，组件 TSX 未发现硬编码颜色。
- **Git 工作台、交付面板、恢复工作台、需求目录、质量与用量、运行环境**：主流程对齐，差异多为 P2。

## 5. 证据与维护规则

- 集成测试与结果见 `docs/verification.md`；每轮执行记录见 `docs/review/execution-log.md`；逐页差异细节见 `docs/review/design-parity.md`（注意该报告是 18:39 快照，Wave 1/2 已闭合项以本矩阵为准）。
- 当前没有 UI 视觉回归：`ui:smoke` 只有文案/主题断言且在本沙箱失败；`docs/evidence/` 是 Wave 0 前旧截图。新增/重写页面的覆盖度需要有真实服务点击或新增断言后才能从 🟡 升到 ✅。
- **维护规则**：每波合并后更新本文件；不得把本文件写成验证记录、不得复制 `docs/verification.md`；缺一项就标 🟡/⛔，不把"有禁用入口/占位页"标成 ✅。
