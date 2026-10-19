# 设计稿一致性审查报告（design parity）

> **历史审查基线，保留原始发现。** 后续已修复内容与当前证据以 `docs/design-coverage.md`、`docs/review/design-parity-acceptance-2026-10-20.md` 和 `docs/task-assignment.md` 第9节为准。下文“缺失/无路由”不是当前实现状态。

> 审查对象：`opencode-workflow-design-showcase/`（只读权威） vs `apps/web`（React 实现）。
> 审查方式：读设计页 HTML/JS 的静态结构、状态列表与 `sources/` 验收文档，逐页对照实现的 TSX 结构与真实状态分支；不做逐像素对比。全程只读，未修改设计稿与产品代码。
> 基线：`originals/main/index.html:85-152` 的 GROUPS（22 个正式产品页）+ `index.html:171` 的 BITEMS（B-01…B-15，补出 recovery / requirements / roles-legacy 三页），合计 25 个正式页；另核对 delivery / planning / git / node 补充稿。
> 实现路由基线：`apps/web/src/app/App.tsx:31-56`；菜单：`apps/web/src/app/navigation.ts:21-53`（与 `sources/navigation-coverage-v2.json` 的 17 项菜单一致）。

## 0. 结论摘要

- **整页缺失 6 个**：`knowledge-history`（知识对话记录）、`ppt-works`（PPT 作品）、`ppt-studio`（PPT 工作台）、`workflow-editor`（流程画布）、`run`（运行内容阅读器）、`roles-legacy`（历史角色配置），均无独立路由；其中知识对话记录只有知识库页底部一张历史卡替代。
- **整块能力缺失 5 处**：待处理中心不提供就地回答/授权；任务画布缺自动节点推进、推进一步、恢复/冻结计划/审计/运行内容入口；角色管理缺四个页签与发布核对；知识库缺研究过程、流式回答、引用原文面板与研究员面板；项目缺详情页签与配置状态清单。
- **实现臆造/占位残留**：主页多出统计卡与「需要你处理」「最近活动」两块；知识库、PPT 存在未使用的旧「未接通」常量与过时说明；`app/placeholders.tsx` 整套占位页已成死代码。
- **主题令牌**：未发现组件内硬编码颜色；四套主题由 `packages/shared/src/config/themes.ts:441` 与 `styles/ds.css` 令牌驱动，这一项对齐。
- 按设计稿自身口径，**Git 工作台、任务恢复、交付面板、需求目录、质量与用量**基本对齐或仅剩 P2 差异。

## 1. 设计页 → 实现路由/载体映射矩阵

### 1.1 正式 25 产品页

| # | 设计页（入口行号） | 实现路由/载体 | 覆盖度 | 关键缺口 |
|---|---|---|---|---|
| 1 | `home`（index:85；home.html） | `/` `HomePage` | 部分 | 多出统计卡/「需要你处理」/「最近活动」；设计仅有「进行中」单卡 |
| 2 | `projects`（index:88） | `/projects` `ProjectsPage` | 部分 | 无项目详情页与四页签（概览/Git 与 GitLab/文档路径/项目公约）、无配置状态清单 |
| 3 | `knowledge`（index:91） | `/knowledge` `KnowledgePage` | 部分 | 无研究四步、流式回答、来源选择面板、引用原文 520 面板、研究员检查面板 |
| 4 | `knowledge-history`（index:94） | **无路由**；仅 `/knowledge` 底部「问答历史」卡 | 载体替代 | 无搜索/项目/状态分段、日期分组、回答摘要、去回答/继续入口 |
| 5 | `ppt`（index:97） | `/ppt` `PptPage` | 部分 | 无「最近的演示」、讨论会话、资料附件、提交回执；只能存草稿 |
| 6 | `ppt-works`（index:100） | **无路由** | 缺失 | 作品网格/列表、阶段进度、下一步提示、归档、复制、导出 |
| 7 | `ppt-studio`（index:103） | **无路由** | 缺失 | 四步工作台、大纲/视觉方向、逐页检查、手动编辑、制作方案七模块 |
| 8 | `start`（index:108） | `/start` `StartPage` | 部分 | 无自动命名/目标、项目与流程抽屉、版本核对、草稿回执页；`methodId/project` 参数不生效 |
| 9 | `workflows`（index:111） | `/workflows` `WorkflowsPage` | 部分 | 无步骤链（并行）、使用次数、复制/归档、详情加载/错误态；编辑禁用 |
| 10 | `workflow-editor`（index:114） | **无路由** | 缺失 | 画布编辑、添加/插入/删除、撤销重做、检查定位、保存/冲突 |
| 11 | `requirement`（index:117） | `/requirement/:id` `RequirementCanvasPage` | 基本对齐 | 缺「更多操作」（保存为流程/查看问答/取消需求）；规划体验已按 planning 补充稿实现 |
| 12 | `tasks`（index:120） | `/tasks` `TasksPage` | 部分 | 行内步骤状态条→全局阶段胶囊；无行更多菜单、加载更多/已归档 |
| 13 | `task`（index:123） | `/tasks/:id` `TaskCanvasPage` | 部分 | 无自动节点推进开关/推进一步；无恢复/冻结计划/审计/运行内容入口；无快照评审面板 |
| 14 | `inbox`（index:126） | `/inbox` `InboxPage` | 部分 | 不能就地回答/授权；无单选/多选/推荐、权限范围卡、未知回读、草稿保留 |
| 15 | `insights`（index:129） | `/insights` `InsightsPage` | 基本对齐 | 少项目/任务状态/包含已归档筛选；多出「运行统计」块 |
| 16 | `templates`（index:132） | `/templates` `TemplatesPage` | 部分 | 无分支/时间范围/源码范围/需求文档、底部固定说明条、历史模板与自动化档案（B-06） |
| 17 | `run`（index:135） | **无路由** | 缺失 | 文档/源码/单测阅读器、需求覆盖、批次恢复、引用原文、运行身份未知态 |
| 18 | `runtime`（index:140） | `/runtime` `RuntimePage` | 基本对齐 | 「最近一次操作」为空占位；无外部进程/启动失败专门态 |
| 19 | `tools`（index:143） | `/tools` `ToolsPage` | 部分 | 无配置范围（全局/项目）、逐工具继承/启用/停用、来源整体停用与影响清单 |
| 20 | `databases`（index:146） | `/databases` `DatabasesPage` | 部分 | 卡片缺可读范围/授权项目；缺 openGauss/GaussDB；缺只读强制三态；抽屉无授权项目 |
| 21 | `roles`（index:149） | `/roles` `RolesPage` | 部分 | 无四页签、能力范围、资源权限、形象、已发布版本核对、权限预估、发布前检查 |
| 22 | `settings`（index:152） | `/settings` `SettingsPage` | 部分 | 缺重试等待/发布网络/开发辅助、设计监控间隔、会话异常阈值+细分超时、生效标签、底部保存条 |
| 23 | `recovery`（B-01） | `/recovery`、`/tasks/:id/recovery` `RecoveryPage` | 基本对齐 | 失败上下文/三种方式/派生记录均有；缺任务画布入口 |
| 24 | `requirements`（B-15） | `/requirements` `RequirementsPage` | 部分 | 无详情抽屉（行直接进画布）、无计划修订/状态说明 |
| 25 | `roles-legacy`（B-04） | **无路由** | 缺失 | 旧角色配置目录/四页签、版本比较、导入四步核对、发布 |

### 1.2 补充稿与评审辅助页

| 设计页 | 实现载体 | 覆盖度 | 说明 |
|---|---|---|---|
| `delivery/start.html` | `/start` + 需求画布「工作区」页签 | 部分 | 设计要求的隔离方式行、准备/开始两步分散到了需求画布；没有开始页上的隔离预览 |
| `delivery/task.html` | `/tasks/:id` 交付面板 `TaskDeliveryPanel` | 基本对齐 | 设计明确“不新增一级页面”，以画布右侧交付面板承载；实现符合 |
| `delivery/git.html` / `delivery/apply.html` | 任务画布交付面板（Git / 非 Git 应用预览） | 基本对齐 | 文件选择、目标、应用预览、分步确认均有 |
| `delivery/index.html`、`delivery/flows.html` | 不适用 | N/A | 评审辅助（状态图/容器说明），非产品页 |
| `planning/start.html` | `/start` `StartPage` | 基本对齐 | 方法卡（必经步骤/可细化/AI 规划）、右侧四步说明均实现 |
| `planning/requirement.html` | `/requirement/:id` | 基本对齐 | 五段胶囊、规划状态条、图层、页签、规划记录、检查、候选/应用/确认均有 |
| `planning/task.html` | `/tasks/:id` | 部分 | 紧凑五段胶囊与执行调整已实现；自动推进开关、领取竞态重确认入口不完整 |
| `planning/index.html` | 不适用 | N/A | 状态总览文档 |
| `git/index.html` | `/git`、`/git/:projectId` | 基本对齐 | 概览+三栏工作台、提交详情三页签、AI 审查、修复、提交/推送/MR/合并、diff 能力齐全 |
| `git/flows.html` | 不适用 | N/A | 操作流程说明文档 |
| `node/index.html` | `/tasks/:id?node=…` 右侧 `NodeDetailPanel` | 部分（以面板代替页面） | 页签/正文/工具卡/尝试/跟随最新已有；缺宽阅读区、工具详情、产物阅读、引用、补读缺口 |
| `main/index.html`、`main/skin-map.html` | 不适用 | N/A | 设计目录与颜色迁移图 |

### 1.3 路由与菜单口径

- **完全缺失路由**：`/knowledge/history`、`/ppt/works`、`/ppt/studio`、`/workflows/:id/edit`、`/runs/:id`、`/roles/legacy`（对应上面 6 页）。
- **未纳入菜单**：`/start`（设计即侧栏 CTA「开始任务」，不是菜单项，符合设计）、`/recovery` 与 `/tasks/:id/recovery`（设计从任务画布进入，但实现没有入口，等同不可发现）、`/git/:projectId`（从概览进入，符合设计）。
- **菜单标签/顺序**：与 `navigation-coverage-v2.json` 一致（含「Git 仓库」「需求目录」）。注意 `originals/main/assets/shell.js:78-96` 的旧 NAV 没有 Git/需求目录/开始任务，以 nav v2 + GROUPS 为准，不算实现缺口。
- **占位页残留**：`app/placeholders.tsx` 除 `NotFoundPlaceholder` 外全部无人引用（`App.tsx:23` 只导入 NotFound），属于死代码。

## 2. 主要实现页的结构化缺口

### 2.1 主页（home）
- **多出设计没有的区域**：统计三卡（进行中/需要你处理/正在规划）与「需要你处理」「最近活动」卡（`HomePage.tsx:129-157`、`:184-211`）。设计主页只有「进行中」单卡（`home.html:85-90`）+ 流程演示（`:92-107`）+ 能力卡/入口（`:109-139`）+ 底部 CTA（`:141-145`）。
- 设计的「进行中」行要求带「离开不会停止规划」提示（`home.html:87`）；实现行显示项目/阶段/更新时间（`HomePage.tsx:24-30`）。
- 能力卡、入口、页脚、流程演示均实现（`HomeCapabilities.tsx:7-17,93-131`、`HomeFlowDemo.tsx:39`），这部分对齐。

### 2.2 任务列表（tasks）
- **步骤状态条缺失**：设计表头是「任务 / 需要处理 / 步骤 / 状态」，行内是 5 段 done/run/stall/fail/unk 小条 + 说明（`tasks.html:74,83,110`）。实现换成整体五段阶段胶囊（`TaskRow.tsx:31-40`），用户看不到单个步骤停滞/失败位置；表头改为「阶段」（`TasksPage.tsx:260-266`）。
- **行更多操作缺失**：设计每行有「打开执行画布 / 复制任务链接 / 归档」菜单（`tasks.html:85`）；实现行是整行 Link，无菜单（`TaskRow.tsx:14-45`）。
- **底部操作不同**：设计为「加载更多 / 已归档」（`tasks.html:111`）；实现为「刷新 / 待处理中心」（`TasksPage.tsx:268-289`）。
- 顶部「需要你处理」卡、分段筛选、项目下拉、按项目分组都实现（`TasksPage.tsx:51-78,131-257`）；设计排除的 unknown/plunk/ploverview 在实现里未排除，会进入 attention 条（`:126-129`）。

### 2.3 开始任务（start）
- **字段结构不同**：设计是「项目 → 目标（textarea，自动生成名称）→ 流程」三段 + 右侧总结（`start.html:120-190`）；实现是「项目 select → 标题 + 需求原文 → 流程方法卡」（`StartPage.tsx:269-333`），没有自动命名与「未命名任务」占位。
- **项目/流程交互降级**：设计项目与流程为单选卡 +「其他项目…／全部流程…」抽屉（`start.html:65-76,128-160`）；实现项目为原生 select（`StartPage.tsx:245-258`）、方法直接铺满。
- **跨页参数不生效**：流程详情「用这个流程开始任务」传 `?methodId=`（`WorkflowsPage.tsx:128`），项目卡开始任务传 `?project=`（`ProjectsPage.tsx:137`），但 `StartPage.tsx:94-105` 不读 URL 参数，项目/方法不会预选。
- **状态缺口**：设计有 ready/filled/reading/flow-error/project-error/submitting/unknown/accepted/handoff-error（`start.html:219-221`）；实现只有 loading/error/submitting/receipt（`StartPage.tsx:154-220`），没有流程版本核对中/失败、项目列表失败、草稿回执卡（设计 `start.html:209-218`）。

### 2.4 需求画布（requirement）
- 整体按 planning 补充稿实现：页头五段胶囊（`RequirementCanvasPage.tsx:465`）、规划状态条、图层 current/partial/candidate/compare（`:189-255`）、页签 input/plan/check/records/draft/workspace/tracking（`:56-92`）、规划记录/检查/应用/退回/停止/未知横幅（`:537-687`），与 `planning/DESIGN-DELTA.md:33-47` 基本一致。
- **缺「更多操作」**：主稿页头有「保存为流程 / 查看澄清问答 / 澄清与规划 / 取消这个需求」菜单（`requirement.html:430`），实现页头只有主按钮组（`RequirementCanvasPage.tsx:467-521`），无该菜单。
- **命名差异**：右侧面板标题「规划面板」（`:797`），主稿叫「计划」；属于文案差异。
- 主稿的低阶任务设置「模型/预算/资料 修改」在实现中是只读「来自规划预览」（`RequirementPanel.tsx:159-175`），修改入口只在规划预览；符合 planning 补充稿的“模型来自设置”，但与主稿可修改动作不同。

### 2.5 任务执行画布（task）
- **自动节点推进开关缺失（P0/P1）**：设计工具条有开关 + 关闭后「推进一步 · 将启动 N 步」（`task.html:168-169`）；实现只显示「自动推进 开启/关闭」文本（`TaskCanvasPage.tsx:226,288-290`），开关是 `disabled` 且写「服务未提供切换自动推进的接口」（`ExecutionPanel.tsx:120-128`），也没有推进一步。
- **更多菜单与侧面板缺失**：设计「⋯」含任务恢复、冻结计划、审计记录、暂停、停止（`task.html:170`），且冻结计划/审计在同一画布右侧面板（`task.html:371-380`）；实现只有页头按钮（调整计划/暂停/继续/交付/需求画布，`TaskCanvasPage.tsx:234-265`），无恢复入口、无冻结计划、无审计记录。
- **运行内容入口缺失**：模板任务/完成态应有「阅读运行内容」→ `run.html`（`task.html:167`），实现无此按钮，也没有 `/runs/:id` 路由。
- **情况条语义不同**：设计情况条是「现在到哪 / 要你做什么（带操作）/ 下一步」+ `role=status`（`task.html:173-186`）；实现是进度条 + running/failed 计数 + 通知文本（`TaskCanvasPage.tsx:268-300`），没有上下文操作按钮。
- **右侧面板默认态不同**：设计右侧面板默认隐藏，点步骤才打开（`task.html:22`、GROUPS `index.html:123`）；实现默认常驻「执行面板」（`TaskCanvasPage.tsx:389-412`）。步骤面板本身（概览/执行现场/尝试与产出）由 `NodeDetailPanel.tsx:148-158` 承载。
- **快照评审专用区域缺失**：设计 B-07 要求快照评审任务有「执行进度 / 模板报告」分段、审查范围、功能批次、阶段报告（`index.html:171` BITEMS、`task.html:302-351`）；实现搜索不到快照/审查批次任何 UI（仅 `PlanEditPanel` 的“执行快照”字样）。

### 2.6 节点执行详情（node）
- 设计是独立地址 `node/index.html`，带调用方 URL、选中节点与画布视口（`node/index.html:19-28`）；实现没有 `/node` 路由，以任务画布右侧面板 `NodeDetailPanel` 承载（`TaskCanvasPage.tsx:361-364`）。**以面板代替独立页可接受**（内容同构），但以下设计区块缺失：
  - 宽阅读区 900（`sources/node/COVERAGE.md:60-64` N20）未实现；
  - 工具详情子视图（长文本/JSON/代码分段/失败/脱敏/无权限/截断，`COVERAGE.md:43-50`）未实现，仅有 tool-card 单层（`NodeDetailPanel.tsx:225-239`）；
  - 产物阅读/下载/不支持格式（`COVERAGE.md:56-60` N15）未实现，尝试页只列产物名（`:363-366`）；
  - 引用原文段落/代码行（`COVERAGE.md:61-63` N16）未实现；
  - 断线补读/缺口线/未保留说明（`COVERAGE.md:32-36` N10、N18）未实现；实现只有“重连后会补读”的文字（`NodeDetailPanel.tsx:394`）。

### 2.7 Git 工作台（基本对齐，列差异）
- 设计三栏、左栏提交/分支/合并请求、右栏改动文件/AI 审查/修复三页签（`sources/git/README.md:21-45`）；实现 `RepoWorkbench.tsx:457-530`、`CommitDetail.tsx:268-279` 一致。
- 设计 diff 统一/并排/忽略空白/全宽/展开/大文件/二进制/重命名（`git/README.md:47-50`）；实现 `DiffViewer.tsx:118,237-305,405` 齐全。
- 设计审查四选项 + 问题接受/忽略/误报/选入修复 + 历史（`README.md:52-67`）；实现 `ReviewPanel.tsx:478-588,366-446` 齐全。
- 设计修复只写隔离副本 + 提交/推送/MR/合并逐步确认 + 未知只核对（`README.md:68-88`）；实现 `FixPanel.tsx:100-120` 与 `TaskDeliveryPanel` 一致。**未发现结构性缺口**，只余文案/细节级差异。

### 2.8 知识库 / 对话记录
- **核心问答体验缺失**：设计有研究过程四步（理解/检索/读取/组织，`knowledge.html:152-200`）、命中来源卡、流式回答与引用编号、引用原文 520 面板、研究员检查抽屉（`knowledge.html:109-135`、`index.html:171` B-08）。实现是一个表单 + 答案文本 + 引用列表（`KnowledgePage.tsx:92-185`），没有研究步骤、来源卡、流式、原文高亮面板、研究员面板。
- **来源选择缺失**：设计 composer 有「资料来源 N」、代码/文档/数据库计数、网络检索开关（`knowledge.html` composer）；实现只有「资料来源」禁用按钮（`KnowledgePage.tsx:132-134`）。
- **历史页未落地**：设计 `knowledge-history.html:34-77` 要求搜索 + 项目 + 状态分段 + 日期分组 + 回答摘要 + 去回答/继续；实现只有知识库页底部一张历史卡（`KnowledgePage.tsx:320-349`），无筛选/分组/入口。
- **陈旧文案**：`ASK_BLOCKED_REASON` 定义后未使用（`KnowledgePage.tsx:13`），页内仍写「问答与引用仍未接通」（`:225,293,367`），与已接通的 `/api/knowledge/ask`（`:38-49`）及页头「文档问答可用」徽标（`:75-77`）矛盾。

### 2.9 PPT
- **只能存草稿**：设计 `ppt.html` 是「讨论需求 → 确认方向 → 逐页制作」入口 + 「最近的演示」（`ppt.html:56-85`）；实现只有项目/主题/说明 + 保存草稿（`PptPage.tsx:89-221`），页头挂「仅草稿」（`:95-97`），附件上传禁用（`:177-179`），底部仍提示「需要先接通：创建演示/讨论会话、逐页生成…」（`:239`）。
- **已取数据未渲染**：`worksQuery` 已请求 `/api/ppt/works`（`PptPage.tsx:27`），但从未使用；设计要求的「最近的演示」与「全部作品」均无。
- **作品/工作台整页缺失**：`ppt-works.html:39-85`（网格/列表、阶段进度、下一步、归档）与 `ppt-studio.html:229`（四步工作台、七模块制作方案）无路由、无组件。
- 实现多出「版式主题」下拉（`PptPage.tsx:150-155`），设计页无此控件。

### 2.10 模板任务
- **表单结构降级**：设计要求项目与分支并排、时间范围快捷分段、源码范围、需求文档上传、底部固定「将在 项目 · 分支 上运行…」说明条（`templates.html:100-120`）；实现只有项目/标题/说明/目录方法/通用参数（`TemplatesPage.tsx:400-551`），没有分支、时间范围、源码范围、需求文档。
- **历史档案缺失**：设计页头有「历史任务 / 历史模板与自动化记录」入口（`templates.html:149`），并在 B-06 要求五页签只读归档（`index.html:171`）；实现只有当前模板的「由这个模板创建的任务」卡（`TemplatesPage.tsx:555-594`），无归档抽屉。
- **左侧分组缺失**：设计按「报告 / 代码审查 / 开发」分组并带搜索（`templates.html:97-119`）；实现是平铺列表 + 页头搜索（`TemplatesPage.tsx:248-284`）。
- 实现多出「导入模板 JSON」与可视化步骤编辑（`TemplatesPage.tsx:617-638` 附近），设计稿无对应入口（可视为实现自行扩展，不是缺口，但需确认是否产品要求）。

### 2.11 角色管理
- **整块配置能力缺失**：设计要求四个页签「职责与指令 / 能力范围 / 资源权限 / 形象」（`roles.html:148`）、能力分组开关（`:178-180`）、资源权限「职业上限 ∩ 项目 ∩ 运行环境 ∩ 冻结范围」（`:238` 附近）、形象占位规则（`:210-211`）、发布前检查与差异（`:153-154`）、已发布版本核对（`:254-296`）、权限预估（`:330-338`）。实现全部没有页签，`RolesPage.tsx` 全文无 `className="tab"`，只有左侧目录 + 右侧纵向「职责范围 / 版本 / 规划职责」+ 三个按钮（`RolesPage.tsx:58-121,232-273`）。
- 设计 B-02/B-03（已发布版本核对、权限预估）在实现中没有任何对应状态。
- 实现有发布历史弹窗与恢复草稿（`RolesPage.tsx:361-398`），设计稿无此弹窗形态（设计是页头版本切换 + 发布检查），属于实现自行扩展。

### 2.12 数据库
- **类型缺失**：设计 B-13 要求 openGauss / GaussDB / GoldenDB / 达梦 / DB2 五种扩展类型与只读强制三态（`index.html:171`、`databases.html:220-223`）；共享契约只有 mysql/mariadb/goldendb/postgresql/oracle/dm/db2（`packages/shared/src/config/settings.ts:221-232`），**没有 openGauss、GaussDB**，实现下拉自然也没有。
- **卡片字段缺失**：设计要求卡片展示「可读范围」「授权项目（未授权琥珀提示）」「最近检查结果」（`databases.html:97-104`）；实现卡片有引擎/主机/状态/只读徽标，但没有可读范围与授权项目（`DatabasesPage.tsx:370-455`）。
- **抽屉字段缺失**：设计要求可读 schema 标签输入 + 授权项目复选 + 启用/停用（`databases.html:126-128,254`）；实现有 JDBC、名称、类型、主机、端口、库、账号、密码、SSL、只读标记（`DatabasesPage.tsx:556-789`），没有授权项目、没有启用开关。
- **筛选口径不同**：设计要求「状态分段筛选」（`databases.html:91` GROUPS 注）；实现按「数据库类型」分段筛选（`DatabasesPage.tsx:526-528`）。
- **探针结果缺三格**：设计检查结果拆「已连接 / 会话只读 / 只读已强制」（`databases.html:143-145,220-223`）；实现展示连接状态 + 查询/EXPLAIN/表结构能力（`DatabasesPage.tsx:160-176`），没有只读强制状态。
- 只读查询抽屉、requestKey 回执说明、类型不支持原因均有（`DatabasesPage.tsx:791-944`、`:355`）。

### 2.13 设置
- **分区缺口**：设计分区为 服务 / 外观 / 模型服务 / 执行限制 / 重试等待 / Git 账号 / 发布网络 / 开发辅助（`settings.html:90,97-139`）；实现只有 服务 / 外观 / 模型与执行 / Git 账号 / 数据库（`SettingsPage.tsx:29-49`），**重试等待、发布网络、开发辅助三块完全缺失**。
- **监控与执行限制口径不同**：设计 B-11「设计监控间隔 250–10000ms + 超范围校验」、B-12「会话异常阈值 + 验证超时 + 业务超时三项分钟字段」（`index.html:171`）；实现设置的是「断连轮询间隔 500–30000ms」与「会话告警阈值 1–100 个会话」（`ServiceSection.tsx:78-104,108-145`），语义不同；执行限制只有只读值（`ModelSection.tsx:159-163`）。
- **无全局未保存提示**：设计要求每个字段标「立即生效 / 重启后生效」，有修改时出现底部保存条「2 处未保存 · 1 处需重启」（`settings.html:109-113,221`）；实现是逐字段内联保存（`ServiceSection.tsx:88-104`），没有脏状态/保存条/分区导航圆点。
- 外观四主题缩略图、减少动态开关展示与设计一致（`AppearanceSection.tsx:14-40`、`ThemeSelector.tsx`）；注意设计 GROUPS 文案写“五套皮肤”，但 `settings.html` 与 `CLAUDE-设计结果.md` 实际都是四套，实现四套正确。

### 2.14 待处理中心（inbox）
- **不能就地处理（P0）**：设计要求问题页单选/多选 + 推荐标签 + 自定义回答 + 已回答计数 + 提交/拒绝；权限请求并排「仅这一次 / 本次会话都允许」；策略禁止只给「知道了」；提交未知时锁定只可重新读取（`inbox.html:87-130,139-148`）。实现详情只显示类型/项目/任务 ID + 蓝色提示「本页只做汇总和跳转」（`InboxPage.tsx:70-127`），没有回答控件、权限范围卡、未知/回读状态。
- **规划事项区缺失**：设计顶部有 13 项「规划事项」卡片（需求画布/任务画布入口，`inbox.html` planHTML）；实现只有按类型过滤的列表（`InboxPage.tsx:130-250`）。
- 设计的「草稿保留/切换事项确认」「拒绝确认」对话框也未实现。

### 2.15 其余页面（简）
- **项目**：卡片有名称/路径/Git 状态/分支/进行中/需要处理/归档/重新检测（`ProjectsPage.tsx:64-154`），但**无详情页与四页签**（`projects.html:175-260`）、无配置状态清单、无「查看 Git」入口、无「模板任务」入口。
- **需求目录**：搜索/项目筛选/阶段计数/加载更多都实现（`RequirementsPage.tsx:89-328`），但行直接链到画布（`:53-87`），设计 B-15 的详情抽屉（`requirements.html:170-213`）与计划修订说明缺失。
- **质量与用量**：真实数据、验收/评审、tokens/成本、未知值处理均实现（`InsightsPage.tsx:58-405`）；缺项目/任务状态/包含已归档筛选（`insights.html:94-98`），多出「运行统计」大块（`:384-402`），汇总卡口径与设计三卡不同。
- **运行环境**：状态主卡 + 三张事实卡 + 重启确认 + 错误态都实现（`RuntimePage.tsx:90-227`）；「最近一次操作」是空占位「启动/重启历史尚未接通」（`:255-270`），设计要求的最近操作记录、外部进程/启动失败专门态（`runtime.html:67,108,130`）缺失。
- **工具与 Skill**：工具总览 + 工具集启停 + Skill 阅读/带行号源文弹窗已实现（`ToolsPage.tsx:315,252-279`）；缺配置范围下拉、逐工具继承/启用/停用、来源整体停用与受影响清单、部分清单/结果未明状态（`tools.html:90-129`）。
- **流程目录**：搜索、支持筛选、详情步骤列表、开始任务入口已实现（`WorkflowsPage.tsx:142-291`）；缺步骤链（并行并排）、使用次数、复制/归档、详情加载/错误态、编辑入口（设计 `workflows.html:43-53,144`；实现编辑按钮禁用 `:12,131-133`）。
- **任务恢复**：三种恢复方式、失败上下文、派生记录、创建草稿、不可恢复/未知状态基本实现（`RecoveryPage.tsx:25-48,264-330`），与 B-01 对齐；只缺任务画布入口。

## 3. P0 / P1 高优先级不一致清单

| 优先级 | 页面/能力 | 结论 | 证据 |
|---|---|---|---|
| P0-1 | 待处理中心 | 设计要求的就地回答/授权整块缺失，核心流程被迫跳转 | `inbox.html:87-148` → `InboxPage.tsx:70-127` |
| P0-2 | 任务执行画布控制 | 自动节点推进开关/推进一步、恢复/冻结计划/审计/运行内容入口均缺 | `task.html:167-170,371-380`、`index.html:123` → `TaskCanvasPage.tsx:234-300`、`ExecutionPanel.tsx:120-128` |
| P0-3 | 6 个整页 | knowledge-history / ppt-works / ppt-studio / workflow-editor / run / roles-legacy 无路由与载体 | `App.tsx:31-56`；设计 `index.html:94,100,103,114,135`、BITEMS |
| P0-4 | 角色管理 | 四页签、能力范围、资源权限、形象、发布核对/预估整块缺失 | `roles.html:148-211,254-338` → `RolesPage.tsx:58-121,232-273` |
| P0-5 | 知识库 | 研究过程、流式回答、来源选择、引用原文面板、研究员面板缺失 | `knowledge.html:109-200`、BITEMS B-08 → `KnowledgePage.tsx:92-185,285-349` |
| P0-6 | 项目详情 | 详情四页签与配置状态清单完全缺失 | `projects.html:175-260` → `ProjectsPage.tsx:64-154`（无详情路由） |
| P1-1 | 任务列表 | 行步骤状态条、行更多菜单、加载更多/已归档缺失 | `tasks.html:74-85,110-111` → `TaskRow.tsx:31-40`、`TasksPage.tsx:260-289` |
| P1-2 | 开始任务 | `methodId/project` 参数不生效；自动命名、项目/流程抽屉、回执页、版本核对态缺失 | `start.html:120-221`、`WorkflowsPage.tsx:128`、`ProjectsPage.tsx:137` → `StartPage.tsx:94-105` |
| P1-3 | 模板任务 | 分支/时间范围/源码范围/需求文档、固定说明条、B-06 归档缺失 | `templates.html:100-120,149`、BITEMS B-06 → `TemplatesPage.tsx:400-594` |
| P1-4 | 数据库 | openGauss/GaussDB 契约缺失、授权项目/可读范围、只读强制三态、状态筛选缺失 | `databases.html:91-146,220-223`、`settings.ts:221-232` → `DatabasesPage.tsx:370-455,526-789` |
| P1-5 | 设置 | 重试等待/发布网络/开发辅助、设计监控间隔、会话异常阈值+细分超时、脏保存条缺失 | `settings.html:90-145,221` → `SettingsPage.tsx:29-49`、`ServiceSection.tsx:78-145` |
| P1-6 | 流程目录 | 步骤链/并行、使用次数、复制/归档、编辑入口缺失 | `workflows.html:43-53,144` → `WorkflowsPage.tsx:12,127-134,210-256` |
| P1-7 | 节点执行详情 | 工具详情、产物阅读/下载、引用原文、宽阅读区、补读缺口缺失 | `sources/node/COVERAGE.md:32-64` → `NodeDetailPanel.tsx:148-393` |
| P1-8 | 工具与 Skill | 配置范围、逐工具继承/启用/停用、来源停用影响缺失 | `tools.html:90-129` → `ToolsPage.tsx:184,315` |
| P1-9 | 全局品牌与页头 | 产品名写成 agent-workflow/Agent Workflow；页头保留主题切换，与「皮肤切换只在设置」冲突 | `CLAUDE-设计结果.md:5`、`index.html:152` → `Shell.tsx:59,74-80,161-174` |
| P1-10 | 需求目录 | B-15 详情抽屉缺失，行直接进画布 | `requirements.html:170-213` → `RequirementsPage.tsx:53-87` |
| P1-11 | PPT 制作 | 作品/工作台缺失（并入 P0-3）；当前页只有草稿，已写好的生成/作品数据不可达 | `ppt.html:56-85` → `PptPage.tsx:27,89-239` |
| P1-12 | 运行环境 | 最近一次操作、外部进程/启动失败态缺失 | `runtime.html:67,108,130` → `RuntimePage.tsx:255-270` |

**实现臆造区域（设计没有）**：主页统计/「需要你处理」/「最近活动」（`HomePage.tsx:129-211`）；质量页「运行统计」大块（`InsightsPage.tsx:384-402`）；设置里的「数据库」分区入口（`SettingsPage.tsx:45-48`，数据库已在侧栏）；PPT 版式主题下拉（`PptPage.tsx:150-155`）；流程目录的 AI 规划策略详情（`WorkflowsPage.tsx:80-107`，设计只在 method 摘要中出现）；模板页导入/可视化编辑（`TemplatesPage.tsx:617-638` 附近）。这些多为数据可支撑的扩展，建议保留但补设计说明，避免再次出现“设计与实现谁为准”的歧义。

**占位/陈旧文案残留**：
- `KnowledgePage.tsx:13` 定义未使用的 `ASK_BLOCKED_REASON`；`:225,293,367` 与已接通问答矛盾。
- `PptPage.tsx:14` 定义未使用的 `CREATE_BLOCKED_REASON`；`:239` 的「需要先接通：创建演示/讨论会话…」与已接通的创建/生成接口矛盾；`:27` 请求了作品但从不渲染。
- `app/placeholders.tsx` 除 NotFound 外全部死代码，且仍写「当前占位页」「由后续页面实现」。

## 4. 建议下一步任务（按优先级）

1. **P0 待处理中心就地处理**：补齐问题单选/多选/推荐/自定义答案、权限两张范围卡、策略禁止、提交未知锁定与重新读取、切换事项草稿保留；接口按 `sources` 的 inbox 状态清单实现；验收覆盖 design `inbox.html` 9 个状态。
2. **P0 任务画布执行控制**：接自动推进开关 + 推进一步（服务 capability 未给时保持禁用并给服务原因）、恢复/冻结计划/审计记录三个右侧面板与「⋯」菜单、运行内容入口；对齐 `task.html` + `planning/DESIGN-DELTA.md §3.7`。
3. **P0 缺失页补齐**：按 `knowledge-history`、`ppt-works`、`ppt-studio`、`workflow-editor`、`run` 五页建立路由与页面骨架，先实现只读/空/加载/错误/未知，再补交互；`roles-legacy` 单独评估是否纳入本期（B-04 体量较大）。
4. **P0 角色管理按页签重构**：职责与指令（草稿/已发布切换 + 发布检查）、能力范围、资源权限（权限预估）、形象；复用现有角色草稿/发布接口，缺的能力/权限数据需服务端契约补充。
5. **P0 知识库问答体验**：研究步骤、来源选择、流式/完成回答、引用原文 520 面板、研究员检查面板；先把 `/api/knowledge/*` 已有读口接成完整链路，再补历史独立页。
6. **P1 项目详情**：新增 `/projects/:id` 四页签与配置状态清单；卡片补「查看 Git / 模板任务」入口；与 Git 工作台、开始任务参数联动。
7. **P1 结构性对齐批次**：任务列表（步骤条、行菜单、加载更多/已归档）、开始任务（URL 预选、回执/版本态）、模板（分支/范围/文档/固定说明条/B-06）、数据库（授权项目/范围/只读三态/扩展类型）、设置（三分区/监控/超时/脏保存条）。
8. **P2 收敛与清理**：统一产品名与页头主题入口；删除 `app/placeholders.tsx` 死代码与未使用常量；清理知识/PPT 过时“未接通”文案；为首页/质量页的扩展区块补设计口径。

## 5. 已基本对齐（避免误报）

以下页面/能力经结构对照，不应按“缺失”误报：

- **需求画布**：五段阶段胶囊（`StageCapsule.tsx`）、规划状态条、四图层、阶段页签、规划记录、检查、候选应用/退回、确认、未知/历史轮次横幅均已实现，符合 planning 补充稿（该补充稿已明确取代主稿四段阶段条与“澄清与规划面板”双面板）。
- **Git 工作台**：概览、三栏、提交详情三页签、统一/并排 diff、忽略空白、全宽、大文件加载、AI 审查四选项与问题处置、修复隔离副本、提交/推送/MR/合并分步确认与未知核对均实现。
- **任务恢复**：独立恢复工作台、三种恢复方式、失败上下文、派生草稿记录、不可恢复/未知/创建失败/无父任务状态基本齐全。
- **交付面板**：Git / 非 Git 应用预览、文件选择、交付目标、分步确认都在任务画布右侧面板，符合 delivery 设计“不新增一级页面”。
- **需求目录**：搜索、项目筛选、阶段计数、加载更多、空/错误/加载态齐全（仅详情抽屉缺失）。
- **质量与用量**：真实数据、未知值不当 0、验收/评审、tokens 与成本、逐任务明细、P2 差异为主。
- **运行环境**：状态主卡、三张事实卡、缺失值“未知”、重启确认与结果未明提示、读取失败提示均有。
- **主题系统**：四套主题令牌集中在 `packages/shared/src/config/themes.ts` 与 `apps/web/src/styles/ds.css`，组件 TSX 未发现硬编码颜色；`data-theme` 切换与主题选择器已实现。
- **恢复 / 交付入口**：恢复页可从任务列表直达（但任务画布内入口仍缺，见 P0-2）。

## 6. 口径说明与设计稿内部矛盾（审查时已按较新权威处理）

1. **阶段胶囊**：主稿 `requirement.html` 为四段（需求草稿/澄清与规划/确认计划/开始执行），`planning/DESIGN-DELTA.md:33-40` 已定五段（需求草稿/规划/确认计划/准备工作区/开始执行）并明确“取消页头状态徽标”；实现按五段，视为对齐。
2. **恢复位置**：`task.html:170` 要求恢复在画布右面板，B-01 又新增独立恢复页；实现采用独立页（有 `/recovery`），但缺画布入口，建议以 B-01 为准并在画布补入口。
3. **皮肤数量**：`index.html:152` 文案写“五套皮肤”，但 `settings.html` 与 `CLAUDE-设计结果.md` 实际四套；实现四套，视为对齐。
4. **菜单**：`originals/main/assets/shell.js:78-96` 的 NAV 缺 Git/需求目录/开始任务，`sources/navigation-coverage-v2.json` 是更新口径；实现 17 项菜单与 v2 一致，视为对齐。
5. **画布页签**：主稿需求画布是“计划 / 步骤”两态，B-05 与 planning 补充稿合并为按阶段页签；实现按后者，视为对齐。
6. **未接通说明**：`workflows` 编辑、`runtime` 启动历史、`tools` 单工具开关、`ppt` 生成等位置，实现以“服务未提供接口”禁用并给原因，符合 AGENTS.md 第 1.2/1.4 条，不应简单计为臆造；问题只在于设计要求的整块能力尚未落地或文案已过时。

> 证据格式：设计文件相对 `opencode-workflow-design-showcase/`；实现文件相对 `apps/web/src/`。行号基于当前工作区快照（2026-10-19），后续改动需重新核对。
