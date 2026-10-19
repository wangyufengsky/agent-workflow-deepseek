# 设计稿覆盖矩阵

> 设计来源：`opencode-workflow-design-showcase/`（v5：`originals/main` 22 个正式产品页 + B-01/B-04/B-15 补出 recovery / requirements / roles-legacy，共 25 页；另核对 delivery / planning / git / node 补充稿）。
> 实现基线：`apps/web/src/app/App.tsx`（2026-10-19，Wave 3D 完成、Wave 3E 进行中的工作区快照）。
> 状态口径：✅ 主流程与设计对齐（仅文案/P2 差异，关键缺口列仍注明）；🟡 页面/载体已存在，但核心区块缺失、降级或以面板替代；⛔ 无路由、无载体或未实现。
> 证据口径：集成测试 + `npm test`（最近一次 **379 tests / 54 suites / 368 pass / 11 skipped / 0 fail**，62.4s，`.tmp/wave3d-test.log`）+ `docs/review/execution-log.md` + `npm run build:web` / `build:server` + `npm run check:docs-routes`（148 路由）+ `npm run test:e2e`。一次性 Electron 页面冒烟见 Wave 3A–3D 记录，但未进入 `npm test`/CI；`docs/evidence/` 22 张截图仍是 Wave 0 前历史证据（清单见 `docs/evidence/README.md`）。
> 打包/真实环境：W4-4 已重建 346MB 未签名 `.app`；W4-5 真实 PG/GitLab 因本机无实例/凭据 **blocked**。证据与复现见 `docs/packaging.md`。
> 与审查报告的关系：`docs/review/design-parity.md`（18:39 快照）是逐页差异审查；本文件是**当前覆盖矩阵**，已按 Wave 1/2/3A/3B/3C/3D 的实际代码更新其中已闭合项，后续每波合并后同步更新。

## 0. 总结

- 25 个正式页中：**✅ 3、🟡 21、⛔ 1**。**唯一完全缺失页：`workflow-editor`**；其余 24 页均有路由或载体，其中 21 页为部分实现/降级。
- Wave 3A/3B/3C 已闭合：节点验收/gating、项目详情四页签、PPT 作品库/四步工作台、任务列表/开始页结构、Inbox interactions、`verify_only` 硬只读、远端 UNKNOWN、run/roles-legacy 页、API 文档、节点 gating、diff 修复、知识 W3-4a、设置 W3-9b、CI/e2e。
- Wave 3D 已闭合：角色管理四页签（后端字段/校验/发布核对 + 前端）、待验收情况条/去验收/驳回重试（W0-4c）、节点详情工具/产物/引用/宽阅读子视图（W3-10）、数据库/工具/模板结构诚实降级（W3-9c）、PE37 分组细化引擎（W3-6，HTTP/UI 待 W3-6b）、W4-4 打包重建与 W4-5 环境评估（blocked 如实记录）。
- 仍缺：W3-1b（charter/docPaths/GitLab 绑定）、W3-6b（PE37 HTTP/UI）、W3-4b（研究步骤/流式 DTO）、W3-5（任务画布扩展/快照评审）、W3-8a/W3-8b（工作流编辑器）、W4-3b（视觉回归）、W4-4 残留（签名/公证/安装包/跨平台/自动更新）、W4-5/W2-5（blocked）。
- **品牌决策**：产品名继续 `agent-workflow`；设计稿 `opencode-workflow` 仅作来源名，不做全局改名（见 README「品牌与命名」）。
- **不要把本矩阵当完成度百分比**：标 🟡 的页面多数主流程可用，但设计要求的核心区块仍有降级；⛔ 页没有可点击载体。

## 1. 25 个正式产品页

| # | 设计页 | 实现路由 / 载体 | 覆盖度 | 已验证证据 | 关键缺口（未完成） | 更新 |
|---|---|---|---|---|---|---|
| 1 | `home` | `/` `HomePage` | 🟡 | W3-11a 主页展示化：移除统计三卡/业务列表，保留 hero/流程演示/能力卡 | 设计「进行中」单卡仍未做；产品名按决策用 `agent-workflow`（设计稿名仅来源） | 10-19 |
| 2 | `projects` | `/projects`、`/projects/:projectId` `ProjectDetailPage` | 🟡 | Wave 3A 四页签（概览 / Git 与 GitLab / 文档路径 / 项目公约）；项目登记/重检集成测试 | 项目公约（charter）后端未提供、`ProjectSettings.docPaths` 字段缺失、项目级 GitLab 绑定/证据无接口（W3-1b 进行中）；文档路径仅在服务返回字段时可保存 | 10-19 |
| 3 | `knowledge` | `/knowledge` `KnowledgePage` | 🟡 | W3-4a：来源选择、引用原文 520 面板、研究员面板、历史入口；knowledge live PASS | 研究步骤、工具轨迹、流式/轮询回答、命中相关度无 DTO（W3-4b）；来源勾选仅前端（ask 无 sources 字段） | 10-19 |
| 4 | `knowledge-history` | `/knowledge/history` `KnowledgeHistoryPage` | 🟡 | W3-7a 33 项 UI 断言；真实历史/引用分段/日期分组/继续追问 | 服务端无会话状态字段：分段降级为「全部/有引用/无引用」；无重命名/归档/删除；无独立集成测试 | 10-19 |
| 5 | `ppt` | `/ppt` `PptPage` + `PptWorksView` / `PptWorkbench` | 🟡 | `ppt-works.test.ts`、PPT live PASS、真实 PPTX 导出；四步工作台真实数据；Wave 3D 未改 PPT 代码 | 设计「讨论需求」五项/「三个视觉方向」/逐页视觉检查无契约，已按真实字段降级；高级视觉（品牌模板/PDF）未做 | 10-19 |
| 6 | `ppt-works` | `/ppt` 内作品库视图（无独立路由） | 🟡 | W3-7b 作品网格/列表、选中后进入工作台；Wave 3D 未变更 | 缩略图接口缺失（示意封面）、复制/归档/版本无接口；全项目作品单次列表前端过滤，无分页 | 10-19 |
| 7 | `ppt-studio` | `/ppt` 内四步工作台（无独立路由） | 🟡 | W3-7b 四步（讨论需求/设计方案/制作检查/导出）、阶段进度与下一步提示；Wave 3D 未变更 | 三个视觉方向、需求简报五项、逐页视觉检查/演讲备注无契约，已禁用并写原因；导出阶段不标记完成 | 10-19 |
| 8 | `start` | `/start` `StartPage` | 🟡 | W3-9a 项目→目标（自动生成名称）→流程三段卡 + 版本核对 + 草稿回执；`methodId/project` 深链 | 项目/流程「其他项目… / 全部流程…」抽屉仍为选择卡；部分状态矩阵（reading/flow-error/project-error/handoff-error）未细分 | 10-19 |
| 9 | `workflows` | `/workflows` `WorkflowsPage` | 🟡 | 搜索/筛选/详情步骤/「用这个流程开始任务」 | 目录只读、编辑按钮禁用；缺步骤链（并行）、使用次数、复制/归档、详情加载/错误态（W3-8a/8b） | 10-19 |
| 10 | `workflow-editor` | 无 | ⛔ | — | 画布编辑/增删/撤销重做/检查定位/保存与冲突全缺；W3-8a 后端进行中（Wave 3E）、W3-8b UI 待做。**当前唯一整页缺失** | 10-19 |
| 11 | `requirement` | `/requirement/:id` `RequirementCanvasPage` | ✅ | planning-live PASS；五段胶囊/规划状态条/四图层/阶段页签/规划记录/检查/应用/确认 | 缺页头「更多操作」（保存为流程/查看问答/取消需求）；右侧标题「规划面板」与设计「计划」为文案差异 | 10-19 |
| 12 | `tasks` | `/tasks` `TasksPage` | 🟡 | W3-9a 行菜单（打开画布/复制链接）、聚合进度、加载更多；build:web | 服务不提供逐步骤状态（行内为阶段胶囊+聚合进度）；归档/已归档接口未接通；分页无总数/游标 | 10-19 |
| 13 | `task` | `/tasks/:id` `TaskCanvasPage` | 🟡 | 执行控制 5 pass；节点验收 + gating；W0-4c 待验收情况条/去验收/驳回重试；恢复页 unknown | W3-5 冻结计划/审计记录/运行内容入口/快照评审 B-07 未完成；情况条缺上下文操作 | 10-19 |
| 14 | `inbox` | `/inbox` `InboxPage` + `/api/interactions` | 🟡 | `interactions.test.ts` 3 pass；自由文本问答/候选审阅/unknown 只读/草稿保留/回执 | 服务端无选项/多选/推荐值/拒绝字段，按 free_text 降级；权限/策略无来源（capabilities=false + reason）；review/reconcile 只能跳需求画布；无分页 | 10-19 |
| 15 | `insights` | `/insights` `InsightsPage` | ✅ | insights / task-acceptance / task-usage 集成测试 | 少项目/任务状态/包含已归档筛选；多出「运行统计」块；汇总卡口径与设计三卡不同（P2） | 10-19 |
| 16 | `templates` | `/templates` `TemplatesPage` | 🟡 | W3-9c：左栏按报告/代码审查/开发分组（启发式）、项目+分支运行说明、B-06 只读说明；33 项 UI 断言 | 分支字段、时间范围、源码范围、需求文档上传、模板分类字段、B-06 归档/自动化档案均无后端接口，控件禁用并写原因 | 10-19 |
| 17 | `run` | `/runs/:taskId` `RunContentPage` | 🟡 | W3-7c 47 项 UI 断言；W3-12 diff 修复；W3-7d 面包屑与入口 | 无专用运行内容接口（批次/报告/测试结果/完整日志降级）；任务画布入口 W3-5 未做 | 10-19 |
| 18 | `runtime` | `/runtime` `RuntimePage` | 🟡 | 状态主卡/事实卡/重启确认/错误态（round 85/86 实测） | 「最近一次操作」为空占位；缺外部进程/启动失败专门态；P2 | 10-19 |
| 19 | `tools` | `/tools` `ToolsPage` | 🟡 | W3-9c：配置范围（全局，项目级禁用+原因）、单工具/来源停用原因、真实影响清单、Skill；33 项 UI 断言 | 项目级工具配置、单工具策略、来源级停用、外部 MCP 来源/Skill 安装状态无接口 | 10-19 |
| 20 | `databases` | `/databases` `DatabasesPage` | 🟡 | W3-9c：可读范围/授权项目/三格检查真实降级、驱动标签、openGauss/GaussDB 说明、抽屉禁用原因；33 项 UI 断言 | 多 schema/表级可读范围、数据库→项目授权、会话只读字段、最近 probe 摘要、openGauss/GaussDB 类型与驱动均无契约 | 10-19 |
| 21 | `roles` | `/roles` `RolesPage` | 🟡 | W3-3 四页签（职责与指令/能力范围/资源权限/形象）+ 保存/检查/发布/历史新字段；`role-catalog-extended.test.ts` 5 pass | B-02 已发布版本回执核对、B-03 权限预估、形象目录、步骤级使用统计无接口/未实现；`/roles/legacy` 只读历史可用 | 10-19 |
| 22 | `settings` | `/settings` `SettingsPage` | 🟡 | W3-9b：执行限制/重试等待/发布网络/开发辅助分区、脏保存条、真实降级 | 保存条只覆盖执行限制+监控；`verifyCommandTimeoutMs` 执行路径未读取；`maxConcurrentNodes/maxAttempts/pauseTimeoutMs` 引擎未读取；业务超时/按类别重试字段未提供 | 10-19 |
| 23 | `recovery` | `/recovery`、`/tasks/:id/recovery` `RecoveryPage` | ✅ | recovery-api + recovery-modes；`verify_only` 硬只读 + readOnly 投影/`updateDraft` 守卫；abandon 恢复暂停态；unknown 三入口 | 恢复不复制执行上下文/阶段图；后续轮次规划上下文仍以核对/未知为主 | 10-19 |
| 24 | `requirements` | `/requirements` `RequirementsPage` | 🟡 | 搜索/项目筛选/阶段计数/加载更多 | B-15 详情抽屉、计划修订/状态说明（结构批次） | 10-19 |
| 25 | `roles-legacy` | `/roles/legacy` `RolesLegacyPage` | 🟡 | W3-7c：真实目录/分组/四组只读/发布快照 diff；W3-7d 面包屑与入口 | 能力/资源权限/形象契约缺失（已标注未提供）；导入无接口、发布只能去角色管理；阶段绑定字段缺失 | 10-19 |

## 2. 补充稿与评审辅助页

| 设计稿 | 实现载体 | 覆盖度 | 已验证证据 | 关键缺口 | 更新 |
|---|---|---|---|---|---|
| `delivery/start.html` | `/start` + 需求画布「工作区」页签 | 🟡 | W3-9a 开始页三段结构；workspace 测试 | 开始页没有隔离方式行/准备-开始两步预览；隔离信息分散在需求画布 | 10-19 |
| `delivery/task.html` | 任务页 `TaskDeliveryPanel` | ✅ | delivery / directory-apply 集成测试 | 设计明确「不新增一级页面」，以右侧面板承载，符合；仅细节文案差异 | 10-19 |
| `delivery/git.html`、`delivery/apply.html` | 任务页交付面板（Git / 非 Git 应用预览） | ✅ | `directory-apply-e2e.test.ts`、delivery merge/MR 测试 | 非 Git 应用、文件选择、目标、分步确认齐全 | 10-19 |
| `delivery/index.html`、`delivery/flows.html` | 不适用 | N/A | — | 评审辅助（状态图/容器说明），非产品页 | 10-19 |
| `planning/start.html` | `/start` | ✅ | planning-live PASS；W3-9a 三段卡 | 方法卡（必经步骤/可细化/AI 规划）、版本与回执已实现 | 10-19 |
| `planning/requirement.html` | `/requirement/:id` | ✅ | planning-live PASS | 五段胶囊、规划状态条、图层、页签、记录、检查、候选/应用/确认齐全 | 10-19 |
| `planning/task.html` | `/tasks/:id` | 🟡 | execution-control 5 pass；节点验收 + gating；W0-4c 情况条 | 自动推进/推进/放弃调整/节点验收/gating 已补；仍缺冻结/审计/运行内容入口与快照评审（W3-5） | 10-19 |
| `git/index.html` | `/git`、`/git/:projectId` | ✅ | git 读模型/worktree/REST 测试；GitHub 真实读/写 live PASS | 三栏工作台、提交三页签、diff、AI 审查/修复、提交/推送/MR/合并齐全；无结构性缺口 | 10-19 |
| `git/flows.html` | 不适用 | N/A | — | 操作流程说明文档 | 10-19 |
| `node/index.html` | `/tasks/:id` 右侧 `NodeDetailPanel` | 🟡 | 节点详情/attempt/output 集成测试；W3-10 工具详情/产物详情/引用原文/900px 宽阅读区/断线 seq 缺口提示；W3-5a 推进入口 | 服务无产物正文读取/工具增量读取接口处如实降级；平移到该节点未实现；W3-5 未做 | 10-19 |
| `main/index.html`、`main/skin-map.html` | 不适用 | N/A | — | 设计目录/颜色迁移图 | 10-19 |

## 3. 已闭合与仍缺的整块能力

| 能力 | 状态 | 对应任务 |
|---|---|---|
| Wave 3A/3B/3C：节点验收/gating、项目详情、PPT 作品/工作台、Inbox interactions、verify_only、UNKNOWN、run/legacy、diff 修复、知识 W3-4a、设置 W3-9b、主页、CI/e2e | ✅ 已实现并验证（降级见矩阵） | W3A–W3C |
| Wave 3D：角色四页签（后端+前端）、W0-4c 待验收情况条、W3-10 节点详情子视图、W3-9c 数据库/工具/模板结构、PE37 引擎 | ✅ 已实现（角色 B-02/B-03、结构缺口与 PE37 HTTP/UI 另列） | W3-3/W0-4c/W3-10/W3-9c/W3-6 |
| W3-1b charter/docPaths/GitLab 项目绑定 | 🟡 进行中（Wave 3E） | W3-1b |
| W3-6b PE37 HTTP/契约与 UI | 🟡 进行中（Wave 3E） | W3-6b |
| W3-4b 研究步骤/工具轨迹/流式回答/相关度 DTO | ⛔ 未实现 | W3-4b |
| W3-5 任务画布冻结/审计/运行内容入口、快照评审 B-07 | ⛔ 未实现 | W3-5 |
| W3-8a/W3-8b 工作流编辑器（method CRUD/复制/归档/校验 + 画布 UI） | 🟡 W3-8a 进行中；W3-8b 未做 | W3-8 |
| W3-9c 后端结构（数据库授权/多 schema、工具项目级/单工具、模板字段/B-06） | ⛔ 未实现（前端已降级） | W3-9c 后端 |
| 角色 B-02/B-03（已发布回执核对、权限预估）、形象目录、步骤级使用统计 | ⛔ 未实现 | W3-3 后端补充 |
| W4-4 打包残留（签名/公证/dmg/zip/Windows/Linux/自动更新/CI 打包） | 🟡 只有未签名 arm64 `.app`（`docs/packaging.md`） | W4-4 |
| W4-5 / W2-5 真实 PG/GitLab | ⛔ **blocked**：本机无实例/凭据、无 live 测试（`docs/packaging.md` §7） | W4-5/W2-5 |
| W4-3b 视觉回归/截图刷新 | ⛔ 未完成 | W4-3b |
| 品牌命名（继续 agent-workflow） | ✅ 决策已记录（README） | W3-11b |

## 4. 已基本对齐、不应误报的部分

- **阶段胶囊**：主稿为四段，`planning/DESIGN-DELTA.md` 已定五段，实现按五段，视为对齐。
- **恢复位置**：设计 `task.html` 要求画布右面板，B-01 又新增独立恢复页；实现采用独立页 + 画布「到恢复页处理」入口，以较新的 B-01 为准。
- **皮肤数量**：`index.html` 文案写「五套皮肤」，但 `settings.html`/`CLAUDE-设计结果.md` 实际四套，实现四套，视为对齐。
- **产品名**：设计稿 `CLAUDE-设计结果.md` 使用 `opencode-workflow`，实现/仓库/Electron 统一为 `agent-workflow`；已决策不全局改名（README「品牌与命名」），不算设计缺口。
- **菜单**：`originals/main/assets/shell.js` 的旧 NAV 缺 Git/需求目录/开始任务；实现 17 项菜单与 `sources/navigation-coverage-v2.json` 一致；`/runs/:taskId`、`/roles/legacy` 的 active/面包屑已在 W3-7d 补齐。
- **需求画布页签**：实现按 planning 补充稿的按阶段页签，不按主稿两态，视为对齐。
- **主题系统**：四套主题令牌集中在 `packages/shared/src/config/themes.ts` 与 `apps/web/src/styles/ds.css`，组件 TSX 未发现硬编码颜色。
- **Git 工作台、交付面板、恢复工作台、质量与用量**：主流程对齐，差异多为 P2。

## 5. 证据与维护规则

- 集成测试与结果见 `docs/verification.md`；每轮执行记录见 `docs/review/execution-log.md`；打包/真实环境见 `docs/packaging.md`；逐页差异细节见 `docs/review/design-parity.md`（18:39 快照，Wave 1/2/3A–3D 已闭合项以本矩阵为准）。
- 自动化证据：`npm test`（379 tests）、`check:docs-routes`（148 路由）、`test:e2e`、`.github/workflows/ci.yml`；但 `docs/evidence/` 22 张仍是 Wave 0 前历史图（`docs/evidence/README.md` 已标轮次/失效原因），无像素级视觉回归（W4-3b）。
- **blocked**：W4-5（真实 PG/GitLab）与 W2-5（GitLab configured/真实写）因本机无实例/凭据无法执行；所需环境变量/补测步骤见 `docs/packaging.md` §7，不伪造 PASS。
- **维护规则**：每波合并后更新本文件；不得把本文件写成验证记录、不得复制 `docs/verification.md`；缺一项就标 🟡/⛔，不把"有禁用入口/占位页"标成 ✅。
