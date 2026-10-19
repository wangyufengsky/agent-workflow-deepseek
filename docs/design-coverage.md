# 设计稿覆盖矩阵

> 设计来源：`opencode-workflow-design-showcase/`（v5：`originals/main` 22 个正式产品页 + B-01/B-04/B-15 补出 recovery / requirements / roles-legacy，共 25 页；另核对 delivery / planning / git / node 补充稿）。
> 实现基线：`apps/web/src/app/App.tsx`（2026-10-19，Wave 0–3G 全部功能完成后的工作区快照）。
> 状态口径：✅ 主流程与设计对齐（仅文案/P2 差异，关键缺口列仍注明）；🟡 页面/载体已实现，但部分区块按服务能力降级或仍有限制；缺失/无载体 **当前 0 页**。
> 证据口径：集成测试 + `npm test`（最终 **403 tests / 54 suites / 392 pass / 11 skipped / 0 fail**，67.6s，`.tmp/wave3g-verify.log`）+ `docs/review/execution-log.md` + `npm run docs:api` / `check:docs-routes`（**163 路由**）+ `build:web`/`build:server` + `test:e2e` + `ui:smoke`（兼容 flags，13 截图 + 2 交互）。截图清单见 `docs/evidence/README.md`（30 张：8 张当前 + 22 张历史）。
> 打包/真实环境：W4-4 已重建 346MB 未签名 `.app`；W4-5 真实 PG/GitLab 因本机无实例/凭据 **blocked**。证据与复现见 `docs/packaging.md`。
> 与审查报告的关系：`docs/review/design-parity.md`（18:39 快照）是逐页差异审查；本文件是**当前覆盖矩阵**，已按 Wave 1/2/3A–3G 的最终代码更新。

## 0. 总结

- 25 个正式页：**✅ 3、🟡 22、缺失 0**。所有页面均有路由/载体；`workflow-editor` 已在 W3-8b/8c 实现并标 🟡（受服务模型限制）。
- 已闭合的全部功能波次（Wave 0–3G）包括：基础回执/启动恢复、执行控制/验收 gating、PPT 作品库/四步工作台、Inbox interactions、角色四页签、项目详情 charter/docPaths/GitLab、PE37 分组细化、知识研究步骤/工具轨迹、任务冻结/审计/快照评审 B-07/运行内容、工作流目录与编辑器、设置/工具/数据库/模板结构、CI/e2e/截图刷新、API 文档（163 路由）。
- **仍为降级但不阻塞功能**：B-07 阶段报告 `available:false`（未接评审报告服务）、知识问答非流式（无 SSE，旧历史无 steps）、charter 模型生成真实 501、GitLab 项目级配置运行时仍用全局、角色 B-02/B-03 与形象/使用统计、数据库/工具/模板部分后端字段、工作流编辑器无并行/任意连线/缩放/视觉 diff、PPT 高级视觉、首页「进行中」单卡、审查并排代码差异、恢复不复制执行上下文。
- **唯一外部阻塞**：W4-5/W2-5 真实 PostgreSQL/GitLab（无实例/凭据，未伪造 PASS，见 `docs/packaging.md` §7）；发布类 W4-4 签名/公证/跨平台/自动更新、W4-6 推送 main 待执行。
- **品牌决策**：产品名继续 `agent-workflow`；设计稿 `opencode-workflow` 仅作来源名，不做全局改名（见 README「品牌与命名」）。

## 1. 25 个正式产品页

| # | 设计页 | 实现路由 / 载体 | 覆盖度 | 已验证证据 | 关键限制 / 降级 | 更新 |
|---|---|---|---|---|---|---|
| 1 | `home` | `/` `HomePage` | 🟡 | W3-11a 展示化：hero/流程演示/能力卡；`evidence/ui-home-*.png` 刷新 | 设计「进行中」单卡未做；产品名按决策用 `agent-workflow` | 10-19 |
| 2 | `projects` | `/projects`、`/projects/:projectId` `ProjectDetailPage` | 🟡 | W3-1b+3-1c：charter 状态机/手动编辑/confirm 写 AGENTS.md/501 生成、docPaths 保存、GitLab 项目级覆盖；四页签 UI | charter 模型生成 501（手动 fallback）；GitLab 项目级只保存非敏感配置、运行时仍全局；charter 版本只读无恢复接口 | 10-19 |
| 3 | `knowledge` | `/knowledge` `KnowledgePage` | 🟡 | W3-4b：真实研究步骤（retrieve/model/tool/validate）与工具轨迹时间线；来源选择/引用原文 520/研究员面板 | **非流式**（无 SSE；完成后一次性时间线）；旧历史无 steps/toolActivity 时隐藏；角色证据/项目许可无 DTO | 10-19 |
| 4 | `knowledge-history` | `/knowledge/history` `KnowledgeHistoryPage` | 🟡 | 真实历史/引用分段/日期分组/继续追问 | 服务无会话状态字段（按引用降级）；无重命名/归档/删除 | 10-19 |
| 5 | `ppt` | `/ppt` `PptPage` + `PptWorksView`/`PptWorkbench` | 🟡 | 作品/附件/生成/编辑/导出/删除全链路；真实 PPTX；`evidence/ui-ppt.png` | 讨论需求五项/视觉方向/逐页视觉检查无契约；高级视觉（品牌模板/PDF）未做 | 10-19 |
| 6 | `ppt-works` | `/ppt` 内作品库（无独立路由） | 🟡 | 作品网格/列表/选中进入工作台 | 缩略图接口缺失（示意封面）；复制/归档/版本无接口；无分页 | 10-19 |
| 7 | `ppt-studio` | `/ppt` 内四步工作台（无独立路由） | 🟡 | 四步（讨论/设计/制作检查/导出）、阶段进度/下一步 | 三个视觉方向、简报五项、逐页视觉检查无契约；导出不标记完成 | 10-19 |
| 8 | `start` | `/start` `StartPage` | 🟡 | 项目→目标（自动名）→流程三段卡、版本/回执、深链 | 项目/流程抽屉仍为选择卡；部分状态矩阵未细分 | 10-19 |
| 9 | `workflows` | `/workflows` `WorkflowsPage` | 🟡 | W3-8：目录（内置/我的/搜索/归档）、复制/新建/归档、详情步骤链 | 并行分支/任意连线无服务字段；无使用次数统计；详情错误态有限 | 10-19 |
| 10 | `workflow-editor` | `/workflows/:id/edit` `WorkflowEditorPage` | 🟡 | W3-8b/c：画布步骤链/插入/面板/检查/保存/409 冲突（查看版本/导出修改）；内置只读→复制后改 | 无并行/任意连线（服务为有序步骤）、无拖拽平移缩放、无步骤模板抽屉、无视觉 diff；描述只能在新建对话框设置 | 10-19 |
| 11 | `requirement` | `/requirement/:id` `RequirementCanvasPage` | ✅ | planning-live；PE37 proposal/refine-preview/scoped start/组候选/确认拦截（`pe37-http.test.ts` 5 pass）；五段胶囊/图层/页签/检查/应用/确认 | 缺页头「更多操作」；跨组依赖提示依赖服务校验 | 10-19 |
| 12 | `tasks` | `/tasks` `TasksPage` | 🟡 | 行菜单/聚合进度/加载更多 | 服务无逐步骤状态（聚合替代）；归档接口未接通；分页无总数/游标 | 10-19 |
| 13 | `task` | `/tasks/:id` `TaskCanvasPage` | 🟡 | W3-5b：「⋯」四入口（恢复/冻结/审计/快照评审 B-07/运行内容）+ 冻结/审计/评审 HTTP 回执；W0-4c 待验收情况条 | B-07 阶段报告 `available:false`、mode/depth=unknown；冻结只存快照不改计划；快照评审只读；情况条缺上下文操作 | 10-19 |
| 14 | `inbox` | `/inbox` `InboxPage` + `/api/interactions` | 🟡 | interactions 3 测试；自由文本/候选审阅/unknown 只读/草稿/回执 | 无选项/多选/推荐/拒绝字段（free_text 降级）；权限/策略无来源；review/reconcile 跳画布；无分页 | 10-19 |
| 15 | `insights` | `/insights` `InsightsPage` | ✅ | insights/task-acceptance/task-usage 测试 | 少项目/任务状态/归档筛选；多出运行统计块（P2） | 10-19 |
| 16 | `templates` | `/templates` `TemplatesPage` | 🟡 | W3-9c 分组/运行说明/B-06 只读说明；33 项 UI 断言 | 分支/时间范围/源码范围/需求文档/分类/B-06 归档无后端字段 | 10-19 |
| 17 | `run` | `/runs/:taskId` `RunContentPage` | 🟡 | W3-7c 47 项断言；W3-12 diff 修复；W3-5b 任务画布入口 | 无专用运行内容接口（批次/报告/测试结果/日志降级） | 10-19 |
| 18 | `runtime` | `/runtime` `RuntimePage` | 🟡 | 状态卡/重启确认/错误态 | 「最近一次操作」空占位；缺外部进程/启动失败态（P2） | 10-19 |
| 19 | `tools` | `/tools` `ToolsPage` | 🟡 | W3-9c 配置范围/影响清单/Skill | 项目级工具配置、单工具策略、来源级停用、外部 MCP/安装状态无接口 | 10-19 |
| 20 | `databases` | `/databases` `DatabasesPage` | 🟡 | W3-9c 可读范围/授权/三格检查/驱动标签/说明 | 多 schema/表级范围、项目授权、会话只读、最近 probe 摘要、openGauss/GaussDB 无契约 | 10-19 |
| 21 | `roles` | `/roles` `RolesPage` | 🟡 | 四页签/资源权限/形象/发布检查；`role-catalog-extended` 5 pass；`evidence/ui-roles.png` | B-02 已发布回执核对、B-03 权限预估、形象目录、步骤级使用统计无接口 | 10-19 |
| 22 | `settings` | `/settings` `SettingsPage` | 🟡 | W3-9b 分区/脏保存/降级；W4-3c 修复 `.snav .cap` 并重拍；`evidence/ui-settings.png` | 保存条只覆盖执行限制+监控；部分引擎字段未读取；业务超时/分类重试字段未提供 | 10-19 |
| 23 | `recovery` | `/recovery`、`/tasks/:id/recovery` `RecoveryPage` | ✅ | recovery-api/modes；verify_only 硬只读+readOnly 投影；abandon 暂停态；unknown 三入口 | 不复制执行上下文/阶段图；规划上下文仍以核对/未知为主 | 10-19 |
| 24 | `requirements` | `/requirements` `RequirementsPage` | 🟡 | 搜索/项目筛选/阶段计数/加载更多 | B-15 详情抽屉/计划修订说明未做（结构批次） | 10-19 |
| 25 | `roles-legacy` | `/roles/legacy` `RolesLegacyPage` | 🟡 | 真实目录/分组/四组只读/发布快照 diff；面包屑 | 能力/资源权限/形象契约缺失（明确未提供）；导入无接口；阶段绑定字段缺失 | 10-19 |

## 2. 补充稿与评审辅助页

| 设计稿 | 实现载体 | 覆盖度 | 已验证证据 | 关键限制 | 更新 |
|---|---|---|---|---|---|
| `delivery/start.html` | `/start` + 需求画布「工作区」页签 | 🟡 | 开始页三段结构；workspace 测试 | 无隔离方式行/两步预览；隔离信息在需求画布 | 10-19 |
| `delivery/task.html` | 任务页 `TaskDeliveryPanel` | ✅ | delivery/directory-apply 测试 | 以右侧面板承载（设计明确不新增一级页面） | 10-19 |
| `delivery/git.html`、`delivery/apply.html` | 任务页交付面板 | ✅ | directory-apply-e2e、merge/MR 测试 | 非 Git 应用/文件选择/分步确认齐全 | 10-19 |
| `delivery/index.html`、`delivery/flows.html` | 不适用 | N/A | — | 评审辅助状态图 | 10-19 |
| `planning/start.html` | `/start` | ✅ | planning-live；三段卡 | 方法卡/版本/回执齐全 | 10-19 |
| `planning/requirement.html` | `/requirement/:id` | ✅ | planning-live；PE37 HTTP/UI | 五段/图层/页签/记录/检查/PE37 齐全 | 10-19 |
| `planning/task.html` | `/tasks/:id` | 🟡 | execution-control 5 pass；节点验收/gating；W3-5b | B-07 阶段报告/mode/depth 降级；冻结不改计划 | 10-19 |
| `git/index.html` | `/git`、`/git/:projectId` | ✅ | git 测试 + GitHub 真实读/写 | 三栏/三页签/diff/审查/修复/交付齐全 | 10-19 |
| `git/flows.html` | 不适用 | N/A | — | 操作流程说明 | 10-19 |
| `node/index.html` | 任务页 `NodeDetailPanel` + `NodeSubviews` | 🟡 | W3-10 工具/产物/引用/宽阅读/断线提示；W3-5a 推进 | 服务无产物正文/工具增量接口处降级；平移到节点未实现 | 10-19 |
| `main/index.html`、`main/skin-map.html` | 不适用 | N/A | — | 设计目录/颜色迁移图 | 10-19 |

## 3. 最终剩余项（仅外部阻塞/发布/设计降级）

| 项 | 状态 | 说明 |
|---|---|---|
| Wave 0–3G 全部功能波次 | ✅ 完成 | 403 tests / 163 路由 / build / e2e / ui:smoke 通过 |
| W4-5 真实 PostgreSQL/GitLab；W2-5 GitLab 真实写 | **blocked（外部环境）** | 本机无实例/凭据、无 live 测试；需 `WF_PG_*` / `GITLAB_TEST_*`，见 `docs/packaging.md` §7；不伪造 PASS |
| W4-4 发布：签名/公证/dmg/zip/Windows/Linux/自动更新/CI 打包 | 🟡 只有未签名 arm64 `.app` | 346MB，未签名/未公证/无安装包；`docs/packaging.md` |
| W4-6 推送 main | 🟡 pending（Lead） | `https://github.com/wangyufengsky/agent-workflow-deepseek`；origin 已配置，当前 master |
| 像素级视觉回归 | 🟡 可选深度 | ui:smoke 文案/主题/交互 + 30 张证据，无像素 diff |
| B-07 阶段报告 / mode / depth | 🟡 设计降级 | `partialReport.available:false`、unknown；不伪造审查方式/报告 |
| 知识问答非流式 | 🟡 设计降级 | 真实 steps/toolActivity 一次性返回；无 SSE；旧历史无字段时隐藏 |
| charter 模型生成；GitLab 运行时 | 🟡 设计降级 | generate 真实 501；项目级只保存非敏感配置，运行时仍全局 |
| 角色 B-02/B-03/形象/使用统计；数据库/工具/模板后端字段 | 🟡 设计降级 | 页面按真实字段禁用/降级并写原因 |
| 工作流编辑器限制 | 🟡 设计降级 | 有序步骤模型：无并行/任意连线/缩放/抽屉/视觉 diff |
| PPT 高级视觉、首页「进行中」单卡、审查并排差异、恢复上下文 | 🟡 设计降级 | 后续可选增强 |
| 品牌命名 | ✅ 决策 | 继续 `agent-workflow`；设计稿名仅来源（README） |

## 4. 已基本对齐、不应误报的部分

- **阶段胶囊**：主稿四段，`planning/DESIGN-DELTA.md` 已定五段，实现五段，视为对齐。
- **恢复位置**：设计 `task.html` 画布右面板 vs B-01 独立页；实现独立页 + 画布入口，以 B-01 为准。
- **皮肤数量**：`index.html` 文案「五套」vs 设计实际四套；实现四套，视为对齐。
- **产品名**：设计稿 `opencode-workflow`，实现/仓库/Electron 统一 `agent-workflow`；已决策不全局改名，不算缺口。
- **菜单**：实现 17 项与 `sources/navigation-coverage-v2.json` 一致；run/legacy 面包屑已补。
- **需求画布页签**：按 planning 补充稿阶段页签，不按主稿两态。
- **主题系统**：四套令牌集中在 `themes.ts`/`ds.css`，组件无硬编码颜色。
- **Git 工作台、交付面板、恢复工作台、质量与用量**：主流程对齐，差异多为 P2。

## 5. 证据与维护规则

- 集成测试/结果见 `docs/verification.md`；每轮记录见 `docs/review/execution-log.md`；打包/真实环境见 `docs/packaging.md`；截图清单见 `docs/evidence/README.md`；逐页差异见 `docs/review/design-parity.md`（18:39 快照，已按最终代码更新）。
- 自动化证据：`npm test`（403）、`check:docs-routes`（163）、`test:e2e`、`.github/workflows/ci.yml`；`ui:smoke` 兼容 flags 通过（13 截图 + 2 交互，15 条 smoke 断言），W4-3c 设置导航缺陷已修复并重拍；仍非像素级回归。
- **blocked**：W4-5/W2-5 因本机无实例/凭据无法执行；所需环境变量/补测见 `docs/packaging.md` §7，不伪造 PASS。
- **维护规则**：每波合并后更新本文件；不得写成验证记录、不得复制 `docs/verification.md`；缺项标 🟡；缺失/无载体当前为 0，不把降级标成完成。
