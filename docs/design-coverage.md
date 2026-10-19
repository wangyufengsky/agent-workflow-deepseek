# 设计稿覆盖矩阵

> 设计来源：`opencode-workflow-design-showcase/`（v5：`originals/main` 22 个正式产品页 + B-01/B-04/B-15 补出 recovery / requirements / roles-legacy，共 25 页；另核对 delivery / planning / git / node 补充稿）。
> 实现基线：`apps/web/src/app/App.tsx`（2026-10-19，Wave 3E 完成、Wave 3F 进行中的工作区快照）。
> 状态口径：✅ 主流程与设计对齐（仅文案/P2 差异，关键缺口列仍注明）；🟡 页面/载体已存在，但核心区块缺失、降级或以面板替代；⛔ 无路由、无载体或未实现。
> 证据口径：集成测试 + `npm test`（最近一次 **391 tests / 54 suites / 380 pass / 11 skipped / 0 fail**，65.0s，`.tmp/wave3e-verify.log`）+ `docs/review/execution-log.md` + `npm run docs:api` / `check:docs-routes`（153 路由）+ `build:web`/`build:server` + `test:e2e` + `ui:smoke`（兼容 flags，13 截图 + 2 交互）。截图清单见 `docs/evidence/README.md`（30 张：8 张当前 + 22 张历史）。
> 打包/真实环境：W4-4 已重建 346MB 未签名 `.app`；W4-5 真实 PG/GitLab 因本机无实例/凭据 **blocked**。证据与复现见 `docs/packaging.md`。
> 与审查报告的关系：`docs/review/design-parity.md`（18:39 快照）是逐页差异审查；本文件是**当前覆盖矩阵**，已按 Wave 1/2/3A–3E 的实际代码更新其中已闭合项，后续每波合并后同步更新。

## 0. 总结

- 25 个正式页中：**✅ 3、🟡 21、⛔ 1**。**唯一完全缺失页：`workflow-editor`**（W3-8b/8c 进行中）；其余 24 页均有路由或载体，其中 21 页为部分实现/降级。
- Wave 3A–3D 已闭合：节点验收/gating、项目详情四页签、PPT 作品库/四步工作台、任务列表/开始页结构、Inbox interactions、`verify_only` 硬只读、远端 UNKNOWN、run/roles-legacy 页、API 文档、diff 修复、知识 W3-4a、设置 W3-9b、角色四页签、节点详情子视图、数据库/工具/模板、PE37 引擎、CI/e2e。
- Wave 3E 已闭合：PE37 HTTP + UI（proposal/refine-preview/scoped start/组候选/确认拦截）、项目公约后端（GET/PATCH/confirm 写 AGENTS.md、generate 诚实 501）、`docPaths`/项目级 GitLab 覆盖契约与读回、方法目录（method catalog）后端核心、W4-3b `ui:smoke` 兼容 flags + 截图刷新（13 截图 + 2 交互，`docs/evidence/README.md` 30 张清单）、W4-2 API 文档 153 路由。
- 仍缺：W3-1c（项目详情 UI 接入 charter/docPaths/GitLab）、W3-8c/W3-8b（method catalog HTTP/Engine + 编辑器 UI）、W3-5（任务画布扩展/快照评审）、W4-3c（设置页导航样式+重拍）、W3-4b（研究步骤/流式）、W3-10 剩余降级、W4-4 残留、W4-5/W2-5 blocked。
- **品牌决策**：产品名继续 `agent-workflow`；设计稿 `opencode-workflow` 仅作来源名，不做全局改名（见 README「品牌与命名」）。
- **不要把本矩阵当完成度百分比**：标 🟡 的页面多数主流程可用，但设计要求的核心区块仍有降级；⛔ 页没有可点击载体。

## 1. 25 个正式产品页

| # | 设计页 | 实现路由 / 载体 | 覆盖度 | 已验证证据 | 关键缺口（未完成） | 更新 |
|---|---|---|---|---|---|---|
| 1 | `home` | `/` `HomePage` | 🟡 | W3-11a 主页展示化：移除统计三卡/业务列表，保留 hero/流程演示/能力卡；`evidence/ui-home-*.png` 已刷新 | 设计「进行中」单卡仍未做；产品名按决策用 `agent-workflow`（设计稿名仅来源） | 10-19 |
| 2 | `projects` | `/projects`、`/projects/:projectId` `ProjectDetailPage` | 🟡 | **W3-1b 后端已接线**：charter GET/PATCH/confirm（原子写 AGENTS.md、unknown 恢复、generate 501）、`docPaths`、项目级 GitLab 覆盖（`charter.test.ts` + `pe37-http.test.ts` 5 pass）；W3A 四页签 UI | 项目详情 UI 仍用旧「服务未提供」降级，W3-1c 进行中；charter 模型生成未接线；项目级 GitLab 仅契约+读回，运行时仍用全局配置 | 10-19 |
| 3 | `knowledge` | `/knowledge` `KnowledgePage` | 🟡 | W3-4a：来源选择、引用原文 520 面板、研究员面板、历史入口；knowledge live PASS | 研究步骤、工具轨迹、流式/轮询回答、命中相关度无 DTO（W3-4b）；来源勾选仅前端 | 10-19 |
| 4 | `knowledge-history` | `/knowledge/history` `KnowledgeHistoryPage` | 🟡 | W3-7a 33 项 UI 断言；真实历史/引用分段/日期分组/继续追问 | 服务端无会话状态字段：分段降级为「全部/有引用/无引用」；无重命名/归档/删除 | 10-19 |
| 5 | `ppt` | `/ppt` `PptPage` + `PptWorksView` / `PptWorkbench` | 🟡 | `ppt-works.test.ts`、PPT live PASS、真实 PPTX 导出；四步工作台真实数据；`evidence/ui-ppt.png` | 讨论需求五项/三个视觉方向/逐页视觉检查无契约，按真实字段降级；高级视觉（品牌模板/PDF）未做 | 10-19 |
| 6 | `ppt-works` | `/ppt` 内作品库视图（无独立路由） | 🟡 | W3-7b 作品网格/列表、选中进入工作台；`evidence/ui-ppt.png` | 缩略图接口缺失（示意封面）、复制/归档/版本无接口；全项目作品单次列表前端过滤，无分页 | 10-19 |
| 7 | `ppt-studio` | `/ppt` 内四步工作台（无独立路由） | 🟡 | W3-7b 四步（讨论需求/设计方案/制作检查/导出）、阶段进度与下一步提示 | 三个视觉方向、需求简报五项、逐页视觉检查/演讲备注无契约，已禁用并写原因 | 10-19 |
| 8 | `start` | `/start` `StartPage` | 🟡 | W3-9a 项目→目标（自动生成名称）→流程三段卡 + 版本核对 + 草稿回执；`evidence/ui-start.png` | 项目/流程「其他项目… / 全部流程…」抽屉仍为选择卡；部分状态矩阵未细分 | 10-19 |
| 9 | `workflows` | `/workflows` `WorkflowsPage` | 🟡 | 搜索/筛选/详情步骤；W3-8a method catalog 合并视图/CRUD/校验/版本（`method-catalog.test.ts` 7 pass） | 页面仍只读、编辑按钮禁用；W3-8c HTTP/Engine 与 W3-8b 编辑器 UI 进行中；缺步骤链/使用次数/复制归档/详情错误态 | 10-19 |
| 10 | `workflow-editor` | 无 | ⛔ | — | W3-8b 编辑器 UI / W3-8c HTTP 接线进行中（Wave 3F）；画布编辑/增删/撤销/检查/保存冲突仍未提供。**当前唯一整页缺失** | 10-19 |
| 11 | `requirement` | `/requirement/:id` `RequirementCanvasPage` | ✅ | planning-live PASS；**W3-6b PE37 UI**：proposal 四态/虚线占位/选区预览/组候选/确认拦截（`pe37-http.test.ts` 5 pass）；五段胶囊/图层/页签/检查/应用/确认 | 缺页头「更多操作」（保存为流程/查看问答/取消需求）；组候选跨组依赖提示依赖服务校验 | 10-19 |
| 12 | `tasks` | `/tasks` `TasksPage` | 🟡 | W3-9a 行菜单（打开画布/复制链接）、聚合进度、加载更多 | 服务不提供逐步骤状态（行级聚合进度）；归档/已归档接口未接通；分页无总数/游标 | 10-19 |
| 13 | `task` | `/tasks/:id` `TaskCanvasPage` | 🟡 | 执行控制 5 pass；节点验收 + gating；W0-4c 待验收情况条/去验收/驳回重试；恢复页 unknown | W3-5 冻结计划/审计记录/运行内容入口/快照评审 B-07 未完成；情况条缺上下文操作 | 10-19 |
| 14 | `inbox` | `/inbox` `InboxPage` + `/api/interactions` | 🟡 | `interactions.test.ts` 3 pass；自由文本/候选审阅/unknown 只读/草稿保留/回执 | 无选项/多选/推荐/拒绝字段（free_text 降级）；权限/策略无来源；review/reconcile 跳需求画布；无分页 | 10-19 |
| 15 | `insights` | `/insights` `InsightsPage` | ✅ | insights / task-acceptance / task-usage 集成测试 | 少项目/任务状态/包含已归档筛选；多出「运行统计」块；汇总卡口径 P2 | 10-19 |
| 16 | `templates` | `/templates` `TemplatesPage` | 🟡 | W3-9c：分组（启发式）、项目+分支运行说明、B-06 只读说明；33 项 UI 断言 | 分支字段、时间范围、源码范围、需求文档、模板分类、B-06 归档/自动化档案无后端接口 | 10-19 |
| 17 | `run` | `/runs/:taskId` `RunContentPage` | 🟡 | W3-7c 47 项 UI 断言；W3-12 diff 修复；W3-7d 面包屑 | 无专用运行内容接口（批次/报告/测试结果/完整日志降级）；任务画布入口 W3-5 未做 | 10-19 |
| 18 | `runtime` | `/runtime` `RuntimePage` | 🟡 | 状态主卡/事实卡/重启确认/错误态 | 「最近一次操作」为空占位；缺外部进程/启动失败专门态；P2 | 10-19 |
| 19 | `tools` | `/tools` `ToolsPage` | 🟡 | W3-9c：配置范围（全局，项目级禁用+原因）、单工具/来源停用原因、影响清单、Skill | 项目级工具配置、单工具策略、来源级停用、外部 MCP/Skill 安装状态无接口 | 10-19 |
| 20 | `databases` | `/databases` `DatabasesPage` | 🟡 | W3-9c：可读范围/授权项目/三格检查真实降级、驱动标签、openGauss/GaussDB 说明、抽屉禁用原因 | 多 schema/表级范围、数据库→项目授权、会话只读字段、最近 probe 摘要、openGauss/GaussDB 类型/驱动无契约 | 10-19 |
| 21 | `roles` | `/roles` `RolesPage` | 🟡 | W3-3 四页签/资源权限/形象/发布检查；`role-catalog-extended.test.ts` 5 pass；`evidence/ui-roles.png` | B-02 已发布回执核对、B-03 权限预估、形象目录、步骤级使用统计无接口；`/roles/legacy` 只读历史可用 | 10-19 |
| 22 | `settings` | `/settings` `SettingsPage` | 🟡 | W3-9b：执行限制/重试等待/发布网络/开发辅助分区、脏保存条、真实降级；`evidence/ui-settings.png` | 保存条只覆盖执行限制+监控；部分引擎字段未读取；**W4-3c 左侧导航 `.snav .cap` 命中全局 `.cap` 样式（约 300px 间距）待修/重拍** | 10-19 |
| 23 | `recovery` | `/recovery`、`/tasks/:id/recovery` `RecoveryPage` | ✅ | recovery-api + recovery-modes；`verify_only` 硬只读 + readOnly 投影/`updateDraft` 守卫；abandon 恢复暂停态；unknown 三入口 | 恢复不复制执行上下文/阶段图；后续轮次规划上下文仍以核对/未知为主 | 10-19 |
| 24 | `requirements` | `/requirements` `RequirementsPage` | 🟡 | 搜索/项目筛选/阶段计数/加载更多 | B-15 详情抽屉、计划修订/状态说明（结构批次） | 10-19 |
| 25 | `roles-legacy` | `/roles/legacy` `RolesLegacyPage` | 🟡 | W3-7c 真实目录/分组/四组只读/发布快照 diff；W3-7d 面包屑与入口 | 能力/资源权限/形象契约缺失（已标注未提供）；导入无接口、发布只能去角色管理；阶段绑定字段缺失 | 10-19 |

## 2. 补充稿与评审辅助页

| 设计稿 | 实现载体 | 覆盖度 | 已验证证据 | 关键缺口 | 更新 |
|---|---|---|---|---|---|
| `delivery/start.html` | `/start` + 需求画布「工作区」页签 | 🟡 | W3-9a 开始页三段结构；workspace 测试 | 开始页没有隔离方式行/准备-开始两步预览；隔离信息分散在需求画布 | 10-19 |
| `delivery/task.html` | 任务页 `TaskDeliveryPanel` | ✅ | delivery / directory-apply 集成测试 | 设计明确「不新增一级页面」，以右侧面板承载，符合；仅细节文案差异 | 10-19 |
| `delivery/git.html`、`delivery/apply.html` | 任务页交付面板（Git / 非 Git 应用预览） | ✅ | `directory-apply-e2e.test.ts`、delivery merge/MR 测试 | 非 Git 应用、文件选择、目标、分步确认齐全 | 10-19 |
| `delivery/index.html`、`delivery/flows.html` | 不适用 | N/A | — | 评审辅助（状态图/容器说明），非产品页 | 10-19 |
| `planning/start.html` | `/start` | ✅ | planning-live PASS；W3-9a 三段卡 | 方法卡（必经步骤/可细化/AI 规划）、版本与回执已实现 | 10-19 |
| `planning/requirement.html` | `/requirement/:id` | ✅ | planning-live PASS；PE37 HTTP/UI 已接 | 五段胶囊、规划状态条、图层、页签、记录、检查、候选/应用/确认、PE37 选区/组候选齐全 | 10-19 |
| `planning/task.html` | `/tasks/:id` | 🟡 | execution-control 5 pass；节点验收 + gating；W0-4c 情况条 | 自动推进/推进/放弃调整/节点验收/gating 已补；仍缺冻结/审计/运行内容入口与快照评审（W3-5） | 10-19 |
| `git/index.html` | `/git`、`/git/:projectId` | ✅ | git 读模型/worktree/REST 测试；GitHub 真实读/写 live PASS | 三栏工作台、提交三页签、diff、AI 审查/修复、提交/推送/MR/合并齐全；无结构性缺口 | 10-19 |
| `git/flows.html` | 不适用 | N/A | — | 操作流程说明文档 | 10-19 |
| `node/index.html` | `/tasks/:id` 右侧 `NodeDetailPanel` | 🟡 | 节点详情/attempt/output 集成测试；W3-10 工具/产物/引用/900px 宽阅读/断线 seq 提示 | 服务无产物正文读取/工具增量读取接口处降级；平移到该节点未实现；W3-5 未做 | 10-19 |
| `main/index.html`、`main/skin-map.html` | 不适用 | N/A | — | 设计目录/颜色迁移图 | 10-19 |

## 3. 已闭合与仍缺的整块能力

| 能力 | 状态 | 对应任务 |
|---|---|---|
| Wave 3A–3D：节点验收/gating、项目详情、PPT 作品/工作台、Inbox interactions、verify_only、UNKNOWN、run/legacy、diff 修复、知识 W3-4a、设置 W3-9b、角色四页签、节点详情、数据库/工具/模板、PE37 引擎、CI/e2e | ✅ 已实现并验证（降级见矩阵） | W3A–W3D |
| Wave 3E：PE37 HTTP+UI、项目公约后端（charter/docPaths/GitLab）、method catalog 后端核心、W4-3b 截图刷新、W4-2 API 文档 153 路由 | ✅ 已实现（项目详情 UI、编辑器 HTTP/UI 另列） | W3E |
| W3-1c 项目详情 UI 接入 charter/docPaths/GitLab | 🟡 进行中（Wave 3F） | W3-1c |
| W3-8c/W3-8b method catalog HTTP/Engine + 工作流编辑器 UI | 🟡 进行中（Wave 3F） | W3-8c/W3-8b |
| W3-4b 研究步骤/工具轨迹/流式回答/相关度 DTO | ⛔ 未实现 | W3-4b |
| W3-5 任务画布冻结/审计/运行内容入口、快照评审 B-07 | ⛔ 未实现（W3F 后端核心进行中） | W3-5 |
| W4-3c 设置页导航 `.snav .cap` 样式缺陷 + 重拍 | ⛔ 未实现 | W4-3c |
| W3-10 剩余降级（平移节点、产物正文、补读） | 🟡 部分（子视图已做，接口缺失处降级） | W3-10 |
| 角色 B-02/B-03、形象目录、步骤级使用统计 | ⛔ 未实现 | W3-3 后端补充 |
| W4-4 打包残留（签名/公证/dmg/zip/Windows/Linux/自动更新/CI 打包） | 🟡 只有未签名 arm64 `.app`（`docs/packaging.md`） | W4-4 |
| W4-5 / W2-5 真实 PG/GitLab | ⛔ **blocked**：本机无实例/凭据、无 live 测试（`docs/packaging.md` §7） | W4-5/W2-5 |
| 品牌命名（继续 agent-workflow） | ✅ 决策已记录（README） | W3-11b |

## 4. 已基本对齐、不应误报的部分

- **阶段胶囊**：主稿为四段，`planning/DESIGN-DELTA.md` 已定五段，实现按五段，视为对齐。
- **恢复位置**：设计 `task.html` 要求画布右面板，B-01 又新增独立恢复页；实现采用独立页 + 画布「到恢复页处理」入口，以较新的 B-01 为准。
- **皮肤数量**：`index.html` 文案写「五套皮肤」，但 `settings.html`/`CLAUDE-设计结果.md` 实际四套，实现四套，视为对齐。
- **产品名**：设计稿 `CLAUDE-设计结果.md` 使用 `opencode-workflow`，实现/仓库/Electron 统一为 `agent-workflow`；已决策不全局改名（README「品牌与命名」），不算设计缺口。
- **菜单**：`originals/main/assets/shell.js` 的旧 NAV 缺 Git/需求目录/开始任务；实现 17 项菜单与 `sources/navigation-coverage-v2.json` 一致；`/runs/:taskId`、`/roles/legacy` 面包屑已在 W3-7d 补齐。
- **需求画布页签**：实现按 planning 补充稿的按阶段页签，不按主稿两态，视为对齐。
- **主题系统**：四套主题令牌集中在 `packages/shared/src/config/themes.ts` 与 `apps/web/src/styles/ds.css`，组件 TSX 未发现硬编码颜色。
- **Git 工作台、交付面板、恢复工作台、质量与用量**：主流程对齐，差异多为 P2。

## 5. 证据与维护规则

- 集成测试与结果见 `docs/verification.md`；每轮执行记录见 `docs/review/execution-log.md`；打包/真实环境见 `docs/packaging.md`；截图清单见 `docs/evidence/README.md`；逐页差异细节见 `docs/review/design-parity.md`（18:39 快照，Wave 1/2/3A–3E 已闭合项以本矩阵为准）。
- 自动化证据：`npm test`（391 tests）、`check:docs-routes`（153 路由）、`test:e2e`、`.github/workflows/ci.yml`；`ui:smoke` 兼容 flags 通过（13 截图 + 2 交互，命令见 README/`docs/evidence/README.md`），但**不是像素级视觉回归**，且 W4-3c 设置页导航样式缺陷待修/重拍。
- **blocked**：W4-5（真实 PG/GitLab）与 W2-5（GitLab configured/真实写）因本机无实例/凭据无法执行；所需环境变量/补测见 `docs/packaging.md` §7，不伪造 PASS。
- **维护规则**：每波合并后更新本文件；不得把本文件写成验证记录、不得复制 `docs/verification.md`；缺一项就标 🟡/⛔，不把"有禁用入口/占位页"标成 ✅。
