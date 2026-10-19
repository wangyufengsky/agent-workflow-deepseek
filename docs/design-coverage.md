# 设计稿覆盖矩阵

> 设计来源：`opencode-workflow-design-showcase/`（v5：`originals/main` 22 个正式产品页 + B-01/B-04/B-15 补出 recovery / requirements / roles-legacy，共 25 页；另核对 delivery / planning / git / node 补充稿）。
> 实现基线：`apps/web/src/app/App.tsx`（2026-10-19，Wave 3B 完成、Wave 3C 进行中的工作区快照）。
> 状态口径：✅ 主流程与设计对齐（仅文案/P2 差异，关键缺口列仍注明）；🟡 页面/载体已存在，但核心区块缺失、降级或以面板替代；⛔ 无路由、无载体或未实现。
> 证据口径：集成测试 + `npm test`（最近一次 **360 tests / 54 suites / 349 pass / 11 skipped / 0 fail**，55.1s，`.tmp/wave3b-verify.log`）+ `docs/review/execution-log.md` + `npm run build:web` / `build:server` + `npm run check:docs-routes`。一次性 Electron 页面冒烟见 Wave 3A/3B 记录，但未进入 `npm test`/CI；`docs/evidence/` 截图早于 Wave 0。
> 与审查报告的关系：`docs/review/design-parity.md`（18:39 快照）是逐页差异审查；本文件是**当前覆盖矩阵**，已按 Wave 1/2/3A/3B 的实际代码更新其中已闭合项，后续每波合并后同步更新。

## 0. 总结

- 25 个正式页中：**✅ 3、🟡 21、⛔ 1**。**唯一完全缺失页：`workflow-editor`**；其余 24 页均有路由或载体，其中 21 页为部分实现/降级。
- Wave 3A 已闭合：节点验收（accept/reject 审计叠加；gating 待 W0-4b）、项目详情四页签（charter/docPaths/GitLab 绑定待 W3-1b）、PPT 作品库 + 四步工作台、任务列表步骤条/行菜单、开始任务三段结构、节点面板推进入口。
- Wave 3B 已闭合：Inbox interactions 就地处理（问题列表/详情/答复；权限/策略/选项如实降级）、`verify_only` 硬只读（migration v11）、远端写超时 UNKNOWN（push/MR）、storage `removeJson`、`/runs/:taskId` 运行内容页、`/roles/legacy` 历史角色配置页、`docs/api.md` 重生成 + `check:docs-routes`。
- 仍缺的整块能力：角色四页签、知识库研究体验（前端 W3-4a 进行中）、任务画布冻结/审计/运行内容入口与快照评审 B-07、PE37、工作流编辑器、W3-9b 结构缺口、节点详情子视图、主页/品牌；后端 follow-up：W0-4b、W2-4c、W2-15、W3-12、W3-13。
- **不要把本矩阵当完成度百分比**：标 🟡 的页面多数主流程可用，但设计要求的核心区块仍有降级；⛔ 页没有可点击载体。

## 1. 25 个正式产品页

| # | 设计页 | 实现路由 / 载体 | 覆盖度 | 已验证证据 | 关键缺口（未完成） | 更新 |
|---|---|---|---|---|---|---|
| 1 | `home` | `/` `HomePage` | 🟡 | `npm run build:web`；`docs/evidence/home-deepseek.png`（旧图） | 多出统计三卡、「需要你处理」「最近活动」；设计只有「进行中」单卡；W3-11a 展示化进行中 | 10-19 |
| 2 | `projects` | `/projects`、`/projects/:projectId` `ProjectDetailPage` | 🟡 | Wave 3A 四页签实现（概览 / Git 与 GitLab / 文档路径 / 项目公约）；项目登记/重检集成测试 | 项目公约（charter）后端未提供、`ProjectSettings.docPaths` 字段缺失、项目级 GitLab 绑定/证据无接口（W3-1b）；文档路径仅在服务返回字段时可保存 | 10-19 |
| 3 | `knowledge` | `/knowledge` `KnowledgePage` | 🟡 | knowledge-sources 测试、知识问答 live PASS（引用校验 + conversationId） | 研究四步、来源选择、流式回答、引用原文 520 面板、研究员检查面板未落地；W3-4a 前端进行中 | 10-19 |
| 4 | `knowledge-history` | `/knowledge/history` `KnowledgeHistoryPage` | 🟡 | W3-7a 33 项 UI 断言；`/api/knowledge/history` | 服务端无会话状态字段：状态分段降级为「全部/有引用/无引用」；无重命名/归档/删除；面包屑仍「知识库」；无独立集成测试 | 10-19 |
| 5 | `ppt` | `/ppt` `PptPage` + `PptWorksView` / `PptWorkbench` | 🟡 | `ppt-works.test.ts`、PPT live PASS、真实 PPTX 导出；四步工作台真实数据 | 设计「讨论需求」五项/「三个视觉方向」/逐页视觉检查无契约，已按真实字段降级；高级视觉（品牌模板/PDF）未做 | 10-19 |
| 6 | `ppt-works` | `/ppt` 内作品库视图（无独立路由） | 🟡 | W3-7b 作品网格/列表、选中后进入工作台 | 缩略图接口缺失（示意封面）、复制/归档/版本无接口；全项目作品为单次列表前端过滤，无分页 | 10-19 |
| 7 | `ppt-studio` | `/ppt` 内四步工作台（无独立路由） | 🟡 | W3-7b 四步（讨论需求/设计方案/制作检查/导出）、阶段进度与下一步提示 | 三个视觉方向、需求简报五项、逐页视觉检查/演讲备注无契约，已禁用并写原因；导出阶段不标记完成（服务不记录导出状态） | 10-19 |
| 8 | `start` | `/start` `StartPage` | 🟡 | W3-9a 项目→目标（自动生成名称）→流程三段卡 + 版本核对 + 草稿回执；`methodId/project` 深链 | 项目/流程「其他项目… / 全部流程…」抽屉仍为选择卡；部分状态矩阵（reading/flow-error/project-error/handoff-error）未细分 | 10-19 |
| 9 | `workflows` | `/workflows` `WorkflowsPage` | 🟡 | 搜索/筛选/详情步骤/「用这个流程开始任务」 | 目录只读、编辑按钮禁用；缺步骤链（并行）、使用次数、复制/归档、详情加载/错误态（W3-8） | 10-19 |
| 10 | `workflow-editor` | 无 | ⛔ | — | 画布编辑/增删/撤销重做/检查定位/保存与冲突全缺；W3-8 pending。**当前唯一整页缺失** | 10-19 |
| 11 | `requirement` | `/requirement/:id` `RequirementCanvasPage` | ✅ | planning-live PASS；五段胶囊/规划状态条/四图层/阶段页签/规划记录/检查/应用/确认 | 缺页头「更多操作」（保存为流程/查看问答/取消需求）；右侧标题「规划面板」与设计「计划」为文案差异 | 10-19 |
| 12 | `tasks` | `/tasks` `TasksPage` | 🟡 | W3-9a 行菜单（打开画布/复制链接）、聚合进度、加载更多；build:web | 服务不提供逐步骤状态（行内为阶段胶囊+聚合进度）；归档/已归档接口未接通；分页无总数/游标 | 10-19 |
| 13 | `task` | `/tasks/:id` `TaskCanvasPage` | 🟡 | 执行控制 5 pass；节点验收 + 节点面板推进；恢复页 unknown 入口 | W3-5 未完成：缺「⋯」菜单中的冻结计划/审计记录、运行内容入口（run 页已有但画布无入口）、快照评审 B-07；W0-4b 验收 gating、W2-15 abandon 暂停态未收口 | 10-19 |
| 14 | `inbox` | `/inbox` `InboxPage` + `/api/interactions` | 🟡 | interactions 3 个集成测试；自由文本问答/候选审阅/unknown 只读/草稿保留/回执 | 服务端无选项/多选/推荐值/拒绝字段，按 free_text 降级；权限/策略无来源（capabilities=false + reason）；review/reconcile 只能跳需求画布；无分页 | 10-19 |
| 15 | `insights` | `/insights` `InsightsPage` | ✅ | insights / task-acceptance / task-usage 集成测试 | 少项目/任务状态/包含已归档筛选；多出「运行统计」块；汇总卡口径与设计三卡不同（P2） | 10-19 |
| 16 | `templates` | `/templates` `TemplatesPage` | 🟡 | templates 测试；导入/可视化+JSON 编辑/归档；历史任务 | 分支/时间范围/源码范围/需求文档、底部固定说明条、B-06 五页签归档、左侧分组（W3-9b） | 10-19 |
| 17 | `run` | `/runs/:taskId` `RunContentPage` | 🟡 | W3-7c 47 项 UI 断言：真实任务/节点输出/需求覆盖/变更文件；只读 | 无专用运行内容接口（批次/报告/测试结果/完整日志降级）；`changes` 文件 diff 受 W3-12 空 headSha bug 影响（Wave 3C 修复中，验收前仍报真实错误）；面包屑 W3-7d | 10-19 |
| 18 | `runtime` | `/runtime` `RuntimePage` | 🟡 | 状态主卡/事实卡/重启确认/错误态（round 85/86 实测） | 「最近一次操作」为空占位；缺外部进程/启动失败专门态；P2 | 10-19 |
| 19 | `tools` | `/tools` `ToolsPage` | 🟡 | 工具总览/toolset 启停/Skill 带行号源文；skills 测试 | 配置范围（全局/项目）、逐工具继承/启用/停用、来源整体停用影响清单、部分/未知状态（W3-9b） | 10-19 |
| 20 | `databases` | `/databases` `DatabasesPage` | 🟡 | 连接 CRUD/探针/只读查询/JDBC 拆分；database 测试 | openGauss/GaussDB 契约类型、授权项目/可读范围、只读强制三态、抽屉授权项目/启用开关、状态分段筛选（W3-9b） | 10-19 |
| 21 | `roles` | `/roles` `RolesPage` | 🟡 | roles-api 测试；发布历史/恢复快照 | 四页签（职责与指令/能力范围/资源权限/形象）、能力开关、发布核对/差异、权限预估（W3-3） | 10-19 |
| 22 | `settings` | `/settings` `SettingsPage` | 🟡 | settings 测试；服务/外观/模型与执行/Git/数据库分区可保存 | 重试等待/发布网络/开发辅助分区、监控间隔语义、会话异常阈值+细分超时、脏保存条与「生效」标签（W3-9b 进行中） | 10-19 |
| 23 | `recovery` | `/recovery`、`/tasks/:id/recovery` `RecoveryPage` | ✅ | recovery-api + recovery-modes 测试；`verify_only` 9 类写接口 403 + migration v11；unknown 三入口 | W2-4c：只读任务的 `planning.actions` 投影与 `updateDraft` 守卫未收口；恢复不复制执行上下文/阶段图 | 10-19 |
| 24 | `requirements` | `/requirements` `RequirementsPage` | 🟡 | 搜索/项目筛选/阶段计数/加载更多 | B-15 详情抽屉、计划修订/状态说明（W3-9b） | 10-19 |
| 25 | `roles-legacy` | `/roles/legacy` `RolesLegacyPage` | 🟡 | W3-7c：真实目录/分组/四组只读/发布快照 diff；47 项断言 | 能力/资源权限/形象契约缺失（已标注未提供）；导入无接口、发布只能去角色管理；阶段绑定字段缺失；面包屑 W3-7d | 10-19 |

## 2. 补充稿与评审辅助页

| 设计稿 | 实现载体 | 覆盖度 | 已验证证据 | 关键缺口 | 更新 |
|---|---|---|---|---|---|
| `delivery/start.html` | `/start` + 需求画布「工作区」页签 | 🟡 | W3-9a 开始页三段结构；workspace 测试 | 开始页没有隔离方式行/准备-开始两步预览；隔离信息分散在需求画布 | 10-19 |
| `delivery/task.html` | 任务页 `TaskDeliveryPanel` | ✅ | delivery / directory-apply 集成测试 | 设计明确「不新增一级页面」，以右侧面板承载，符合；仅细节文案差异 | 10-19 |
| `delivery/git.html`、`delivery/apply.html` | 任务页交付面板（Git / 非 Git 应用预览） | ✅ | `directory-apply-e2e.test.ts`、delivery merge/MR 测试 | 非 Git 应用、文件选择、目标、分步确认齐全 | 10-19 |
| `delivery/index.html`、`delivery/flows.html` | 不适用 | N/A | — | 评审辅助（状态图/容器说明），非产品页 | 10-19 |
| `planning/start.html` | `/start` | ✅ | planning-live PASS；W3-9a 三段卡 | 方法卡（必经步骤/可细化/AI 规划）、版本与回执已实现 | 10-19 |
| `planning/requirement.html` | `/requirement/:id` | ✅ | planning-live PASS | 五段胶囊、规划状态条、图层、页签、记录、检查、候选/应用/确认齐全 | 10-19 |
| `planning/task.html` | `/tasks/:id` | 🟡 | execution-control 5 pass；节点验收 | 自动推进/推进一步/放弃调整/节点验收已补；仍缺冻结/审计/运行内容入口（W3-5）与 W2-15 | 10-19 |
| `git/index.html` | `/git`、`/git/:projectId` | ✅ | git 读模型/worktree/REST 测试；GitHub 真实读/写 live PASS | 三栏工作台、提交三页签、diff、AI 审查/修复、提交/推送/MR/合并齐全；无结构性缺口 | 10-19 |
| `git/flows.html` | 不适用 | N/A | — | 操作流程说明文档 | 10-19 |
| `node/index.html` | `/tasks/:id` 右侧 `NodeDetailPanel` | 🟡 | 节点详情/attempt/output 集成测试；节点验收 + 推进直接后继（W3-5a） | 以面板替代独立页可接受；缺宽阅读区、工具详情、产物阅读/下载、引用原文、断线补读（W3-10） | 10-19 |
| `main/index.html`、`main/skin-map.html` | 不适用 | N/A | — | 设计目录/颜色迁移图 | 10-19 |

## 3. 已闭合与仍缺的整块能力

| 能力 | 状态 | 对应任务 |
|---|---|---|
| 节点验收 accept/reject（审计叠加、actions/reasonCode、回执） | ✅ 已实现并验证（验收 gating 待 W0-4b） | W0-4 / W3A |
| 项目详情四页签（概览 / Git 与 GitLab / 文档路径 / 项目公约） | ✅ 页面已实现；🟡 charter/docPaths/GitLab 绑定待后端 | W3-1a / W3-1b |
| PPT 作品库 + 四步工作台 | ✅ 已实现（有真实数据降级） | W3-7b |
| 任务列表步骤条/行菜单、开始任务三段结构 | ✅ 已实现（归档/分页契约缺口另行标注） | W3-9a |
| Inbox interactions 就地处理 | ✅ 已实现（free_text/权限/策略诚实降级） | W3-2 |
| 运行内容 run 页、历史角色 roles-legacy 页 | ✅ 已实现（只读 + 明确降级） | W3-7c |
| `verify_only` 硬只读（migration v11）、远端 push/MR UNKNOWN、storage removeJson | ✅ 已实现并验证 | W2-4b/W2-12/W2-14 |
| 项目公约生成/写入、docPaths/GitLab 项目绑定 | ⛔ 未实现 | W3-1b |
| W0-4b 节点验收 gating（验收后才结束/推进下游） | 🟡 进行中 | W0-4b |
| W2-4c readOnly 投影/updateDraft 守卫 | 🟡 进行中 | W2-4c |
| W2-15 放弃调整恢复「调整前已暂停」 | 🟡 进行中 | W2-15 |
| W3-12 `changes` 文件 diff 空 headSha bug | 🟡 进行中 | W3-12 |
| W3-13 fetch / fix push 的 UNKNOWN 结算 | 🟡 进行中 | W3-13 |
| 角色管理四页签、能力/资源权限/形象、发布核对、权限预估 | ⛔ 未实现 | W3-3 |
| 知识库研究步骤、来源选择、流式回答、引用原文、研究员面板 | 🟡 前端 W3-4a 进行中 | W3-4 |
| 任务画布冻结/审计/运行内容/快照评审 B-07 | ⛔ 未实现（W3-5 进行中） | W3-5 |
| PE37 大需求分组逐步细化 | ⛔ 未实现 | W3-6 |
| 工作流编辑器 | ⛔ 未实现 | W3-8 |
| W3-9b 结构缺口（模板/数据库/设置/工具/需求目录） | 🟡 进行中 | W3-9b |
| 节点详情子视图（工具/产物/引用/补读） | ⛔ 未实现 | W3-10 |
| 主页与品牌收敛 | 🟡 W3-11a 进行中 | W3-11 |
| W3-7d run/legacy 面包屑与入口映射 | ⛔ 未实现 | W3-7d |

## 4. 已基本对齐、不应误报的部分

- **阶段胶囊**：主稿为四段，`planning/DESIGN-DELTA.md` 已定五段，实现按五段，视为对齐。
- **恢复位置**：设计 `task.html` 要求画布右面板，B-01 又新增独立恢复页；实现采用独立页 + 画布「到恢复页处理」入口，以较新的 B-01 为准。
- **皮肤数量**：`index.html` 文案写「五套皮肤」，但 `settings.html`/`CLAUDE-设计结果.md` 实际四套，实现四套，视为对齐。
- **菜单**：`originals/main/assets/shell.js` 的旧 NAV 缺 Git/需求目录/开始任务；实现 17 项菜单与 `sources/navigation-coverage-v2.json` 一致；`/runs/:taskId`、`/roles/legacy` 的面包屑映射仍缺（W3-7d）。
- **需求画布页签**：实现按 planning 补充稿的按阶段页签，不按主稿两态，视为对齐。
- **主题系统**：四套主题令牌集中在 `packages/shared/src/config/themes.ts` 与 `apps/web/src/styles/ds.css`，组件 TSX 未发现硬编码颜色。
- **Git 工作台、交付面板、恢复工作台、质量与用量**：主流程对齐，差异多为 P2。

## 5. 证据与维护规则

- 集成测试与结果见 `docs/verification.md`；每轮执行记录见 `docs/review/execution-log.md`；逐页差异细节见 `docs/review/design-parity.md`（注意该报告是 18:39 快照，Wave 1/2/3A/3B 已闭合项以本矩阵为准）。
- Wave 3A/3B 的页面验收包括一次性 Electron 冒烟（W3-7c 47 项、知识历史 33 项等），但**未进入 `npm test`/CI**；`docs/evidence/` 仍是 Wave 0 前旧截图。新增/重写页面的覆盖度需要有真实服务点击或新增断言后才能从 🟡 升到 ✅。
- **维护规则**：每波合并后更新本文件；不得把本文件写成验证记录、不得复制 `docs/verification.md`；缺一项就标 🟡/⛔，不把"有禁用入口/占位页"标成 ✅。
