# 任务分派文档：完成审查发现的所有剩余工作

> 依据：[`docs/review/2026-10-19-audit.md`](review/2026-10-19-audit.md) 及四份明细报告。
> 目标：把审查确认的剩余任务拆成可并行、可验收的工作包，按波次分派给 agent 员工；Lead 负责整合、类型检查、测试、验收与记录。
> 状态口径：`pending` 未开始 / `in_progress` 进行中 / `blocked` 阻塞（写明原因）/ `done` 完成（有验收证据）。所有任务最终必须是 `done`。
> 过程记录：每完成一个任务，在 [`docs/review/execution-log.md`](review/execution-log.md) 追加一条；每次整合（合并多个任务后跑全量检查）追加一条「整合记录」。

## 1. 协作规则（所有 agent 必须遵守）

1. **只改自己任务列出的文件/目录**；跨文件契约变更先发消息给 Lead，由 Lead 调整写范围。
2. **先读后写**；遵守 `AGENTS.md`：ESM + 完整 `.ts`/`.tsx` 扩展名、不用 TS `enum`/`namespace`、常量/状态机放 `packages/shared`、写操作走 `requestKey + 回执`、不修改 `opencode-workflow-design-showcase/`。
3. **每个任务必须带测试或可复现验证**：领域/存储用 `node --test`，HTTP 用真实服务集成测试，前端用 `build:web` + 现有 smoke 或新增 smoke；不得伪造模型结果。
4. **完成前自检**：`npx tsc -p tsconfig.json --noEmit` 通过 + 任务相关测试通过；把命令与结果写进任务回执。
5. **完成后**：`team_task_update action=complete`，并 `send_message` 给 Lead，内容含：任务 ID、改动文件、验证命令/结果、未覆盖项。
6. **Lead 验收**：对每个完成项跑类型检查 + 相关测试；每波结束跑全量 `npm test` 与 `npm run build:web`（必要时 `build:server`），更新任务状态与执行日志。验收不通过则退回（`reopen`）给原 agent 修复。
7. **禁止**为了让测试通过而改设计稿、验收脚本或伪造数据；不得把真实凭据写进仓库。

## 2. Agent 花名册（按波次启用）

| Agent | 职责 | 本轮任务 |
| --- | --- | --- |
| `be-api` | HTTP 契约、回执、SPA 兜底、ROUTES 同步、硬编码状态 | W0-1/W0-2/W0-5/W1-9/W1-10/W2-7 |
| `be-recovery` | 启动恢复：execution/planning/workspace | W0-3 |
| `be-exec` | 执行控制：自动推进/推进一步/放弃调整/节点验收 | W2-1/W2-2/W2-6（下一波） |
| `be-workspace` | 非 Git 清理、恢复深度、GitLab/GitHub 适配 | W2-3/W2-4/W2-8/W2-11（下一波） |
| `fe-ppt` | PPT 页完整闭环 | W1-1 |
| `fe-templates` | 模板可视化/JSON 编辑器 | W1-2 |
| `fe-misc` | 陈旧文案、深链、运行时状态、死代码 | W1-3/W1-4/W1-5/W1-6/W1-7/W1-8 |
| `fe-cleanup` | 工作区清理 UI、交付 no-op、文案泄漏 | W1-11/W1-12 |
| `design-pages` | 缺失页、项目详情、Inbox、角色页签、知识体验、任务画布扩展 | W3-*（后续波次） |
| `docs-keeper` | 文档重写、证据清单、契约快照、CI 脚本 | W4-*（后续波次） |

## 3. 完整任务清单

### Wave 0 · P0 止血

| ID | 任务 | 负责人 | 依赖 | 写范围 | 验收标准 | 状态 |
| --- | --- | --- | --- | --- | --- | --- |
| W0-1 | `restart` / `git fetch` 返回合法 `CommandResponse`（含 receipt），修前端按回执读取；补 ErrorBoundary | be-api | — | `packages/server/src/http.ts`、`packages/shared/src/api/contracts.ts`、`apps/web/src/api/endpoints.ts`、`apps/web/src/main.tsx`、`tests/integration/**` | 设置页重启成功不崩；Git 工作台 fetch 成功不崩；两种响应都有 `receipt.requestKey/status`；集成测试通过 | done |
| W0-2 | SPA 兜底只匹配非 `/api`；未知 `GET /api/*` 返回 JSON 404 | be-api | — | `packages/server/src/http.ts`、`tests/integration/**` | 实测未知 GET `/api/not-a-real-route` 与死 ROUTES 返回 404 JSON；静态页面仍可访问 | done |
| W0-3 | 启动恢复：execution（running→unknown + 结算回执）、planning（running→unknown/可 reconcile）、workspace（preparing→unknown），并在状态投影/UI 标记 | be-recovery | — | `packages/engine/src/{execution,planning,workspace,engine}.ts`、`packages/server/src/application.ts`、`tests/integration/**` | 重启后执行/规划/工作区不再永久 running；`/api/operations/:key` 可核对；新增集成测试 | done |
| W0-4 | 节点验收：实现 `node.accept/node.reject`（路由+引擎+状态机+UI），或经产品确认后移除并改 README | be-exec | W0-1..3 后 | `packages/engine/src/plan.ts`、`packages/shared/src/domain/{enums,machines}.ts`、`packages/server/src/http.ts`、`apps/web/src/pages/node/**`、`tests/**` | 节点面板可验收/驳回；状态与回执正确；或文档明确移除且不再宣传 | done |
| W0-5 | 修硬编码状态：`output.terminal` 用真实值，`mcp.tools` 从诊断计数，`database.connected` 真实探测，view `actions` 至少返回任务能力 | be-api | — | `packages/server/src/http.ts`、`packages/engine/src/**`（仅必要处）、`tests/**` | 终态节点显示「未提供正文/完成」；工具数随 toolset 变化；测试覆盖 | done |

### Wave 1 · 前端假接通清理

| ID | 任务 | 负责人 | 依赖 | 写范围 | 验收标准 | 状态 |
| --- | --- | --- | --- | --- | --- | --- |
| W1-1 | PPT 页闭环：作品列表、附件增删、生成大纲/逐页、更新、删除、PPTX/Markdown 导出；删假禁用与陈旧文案 | fe-ppt | — | `apps/web/src/pages/ppt/**` | 真实服务上创建→作品列表→附件→生成→导出全链路可点；无 unused 声明；页面无「未接通」 | done |
| W1-2 | 模板编辑器：可视化步骤增删/排序/类型/分组 + JSON 编辑 + 归档；显示导入错误 | fe-templates | — | `apps/web/src/pages/templates/**` | 两个按钮都打开可操作 Modal；PATCH/DELETE 真实调用；导入失败有错误提示 | done |
| W1-3 | 知识库陈旧文案清理：删除/改写「不会发送」「仍未接通」「conversations 建议能力」；保留真实问答/历史/引用 | fe-misc | — | `apps/web/src/pages/knowledge/**` | `grep` 无「不会发送/仍未接通/conversations」；问答与历史可用 | done |
| W1-4 | `/start` 读取 `project`/`methodId` URL 参数并预选；非法值回退并提示 | fe-misc | — | `apps/web/src/pages/start/**` | 从项目/流程跳转后预选正确；不存在参数回退默认 | done |
| W1-5 | 质量与用量页：删除「验收未接入」；任务 tokens 用 `usageByTask`；成本/耗时/重试按 DTO 明确「服务未提供」 | fe-misc | — | `apps/web/src/pages/insights/**` | 已验收任务显示结论；每任务 tokens 与列表一致；无虚假「未知接口」 | done |
| W1-6 | 运行环境页读取 `managed`；未知/加载中/未受管状态禁用重启并写原因；文案区分受管/外部 | fe-misc | — | `apps/web/src/pages/runtime/**` | 状态矩阵符合设计；按钮禁用原因可读 | done |
| W1-7 | 陈旧文案与内部标记：外观区、工具页、交付/修复面板「（P2）」、合并文案矛盾 | fe-misc | — | `apps/web/src/pages/settings/AppearanceSection.tsx`、`apps/web/src/pages/tools/ToolsPage.tsx`、`apps/web/src/pages/delivery/**`、`apps/web/src/pages/git/FixPanel.tsx` | 用户可见文案无内部标记/矛盾；toolset 已接表述准确 | done |
| W1-8 | 死代码清理：`app/placeholders.tsx` 仅留 NotFound、`api/types.ts` 删除或接入；未使用常量/导入清理 | fe-misc | — | `apps/web/src/app/placeholders.tsx`、`apps/web/src/api/types.ts`、相关未使用导入 | `--noUnusedLocals` 不再报这些文件；构建通过 | done |
| W1-9 | 写操作回执覆盖：settings/databases/gitlab/restart/fetch/template archive；缺 requestKey 返回 400；强制 confirm 标志 | be-api | — | `packages/server/src/http.ts`、`packages/engine/src/{delivery,workspace}.ts`、`packages/shared/src/api/contracts.ts`、`tests/**` | 8 条写/验证请求都有 receipt 或显式非变更语义；缺 requestKey 400；测试覆盖 | done |
| W1-10 | ROUTES 同步：补 7 条 fix 子路由、`/settings/git`、`DELETE db`、`pptx`、网关；删除/实现 3 条死 ROUTES（实现留给 W2-1/2，先加契约测试） | be-api | — | `packages/shared/src/api/contracts.ts`、`tests/**` | 契约快照测试：ROUTES ↔ 服务端注册一致（允许显式例外表） | done |
| W1-11 | 工作区清理 UI：预览/blockers/确认/回执；清理后状态刷新 | fe-cleanup | — | `apps/web/src/pages/requirement/WorkspacePanel.tsx`、`apps/web/src/api/workflow.ts` | 需求画布可预览/确认清理；blockers 可见；回执显示 | done |
| W1-12 | 「查看变更并交付」no-op 修复；交付面板文案/内部标记统一；禁用按钮补原因（本面板范围） | fe-cleanup | — | `apps/web/src/pages/task/TaskCanvasPage.tsx`、`apps/web/src/pages/delivery/**` | 点击进入交付/Git 上下文有可见变化；本面板禁用按钮均有原因 | done |

### Wave 2 · 契约与执行控制

| ID | 任务 | 负责人 | 说明 | 状态 |
| --- | --- | --- | --- | --- |
| W2-1 | 自动推进切换 + 整体推进 + 推进直接后继（服务端路由/引擎/回执/UI） | be-exec + fe | 兑现 `executionAdvance`、设计 v4 §C | done |
| W2-2 | 放弃调整 `plan/edit/abandon`（恢复原自动推进/暂停模式） | be-exec + fe | 兑现 `planEditAbandon` | done |
| W2-3 | 非 Git 工作区清理真正删除副本/baseline + 测试 | be-workspace | 修「假清理」 | done |
| W2-4 | 恢复三种模式真实语义（from_failed_stage/all_stages/verify_only） | be-workspace | 不只改标题 | done |
| W2-5 | GitLab host/API base 推导 + `gitlabConfigured` 真实检测 + 真实 smoke | be-workspace | 需要真实 GitLab 凭据（可由用户提供） | pending |
| W2-6 | 节点验收（若 W0-4 未做） | be-exec | 路由+引擎+UI | pending |
| W2-7 | 硬编码状态/契约快照剩余项：view actions、tools 计数、database.connected | be-api | — | pending |
| W2-8 | 远端写失败 UNKNOWN 语义；GitHub 关闭/合并/删分支产品边界确认与文档 | be-workspace | 远端可能已成功 | pending |
| W2-9 | 静态路径前缀校验、缺 requestKey 400 等健壮性收口 | be-api | — | done |

| W2-10 | 恢复页支持 unknown：把 retry/cancel/skip 入口加入 execution unknown 状态（服务端已支持） | fe | 来自 W0-3 验收 | `apps/web/src/pages/recovery/**`、`apps/web/src/pages/task/**` | unknown 执行可从 UI 重试/跳过；有原因与回执 | done |
| W2-11 | PPT generating 启动恢复：进程重启后不永久「生成中」 | be | 来自 W1-1 验收 | `packages/engine/src/ppt.ts`、启动恢复 | 重启后 generating → unknown/failed 可重试 | done |
| W2-12 | 远端 fetch/写操作超时语义：前端客户端超时、服务端 UNKNOWN、可核对 | be | 来自 live fetch 探针 | `packages/git`、`packages/engine/src/delivery.ts`、`apps/web/src/api/**` | 超时不静默失败；可按 requestKey 核对；有测试 | done |
| W2-13 | `viewActions` 变更回归：确认未知任务视图 404 对前端无破坏，补测试 | be-api | 来自 W0-5 验收 | `packages/server/src/http.ts`、`tests/**` | 未知任务返回 404 JSON；正常任务 actions 完整 | done |

| W2-4b | verify_only 硬只读：Task 增加只读/恢复模式字段，actions/plan/planning/execution 全部校验 | be | 来自 W2-4 验收 | `shared/domain/models.ts`、`engine/{actions,plan,planning,execution}.ts` | verify_only 任务无法被规划/执行；测试覆盖 | done |
| W2-14 | storage 补 `removeJson`，替换清理里直接 SQL DELETE settings | be | 来自 W2-3 验收 | `packages/storage/**`、`engine/workspace.ts` | 不再绕过仓库封装；测试通过 | done |
| W2-15 | abandon 恢复「调整前已暂停」：EditSession 持久化 pause 模式 | be | 来自 W2-2 验收 | `shared/domain/models.ts`、`engine/plan.ts`、`engine/execution.ts` | 原暂停任务放弃调整后仍暂停；测试覆盖 | done |
| W3-5a | NodeDetailPanel 增加「推进直接后继」入口 | fe | 来自 W2-1 验收 | `apps/web/src/pages/node/**` | 节点面板可推进直接后继并显示回执 | pending |
| W4-1b | 文档同步 Wave 2（345 tests）并重写 design-coverage 为真实覆盖矩阵 | docs | 来自 W4-1a | `README.md`、`docs/remaining-work.md`、`docs/verification.md`、`docs/design-coverage.md` | 计数/状态一致；design-coverage 不再是 verification 副本 | pending |

### Wave 3 · 设计缺失页与整块能力

| ID | 任务 | 负责人 | 说明 | 状态 |
| --- | --- | --- | --- | --- |
| W3-1 | 项目详情 `/projects/:id` + 四页签（概览/Git 与 GitLab/文档路径/项目公约）+ 配置状态 + 公约后端 | design-pages | 设计 REVIEW §4 | in_progress |
| W3-2 | 待处理中心就地处理：问题/权限/策略禁止/结果未明/草稿；后端 interactions 契约 | design-pages | 设计 REVIEW §11 | done |
| W3-3 | 角色管理四页签 + 能力/资源权限/形象/发布检查/权限预估（扩展 RoleDefinition） | design-pages | 设计 REVIEW §23 | pending |
| W3-4 | 知识库体验：研究步骤、来源选择、流式/轮询回答、引用原文面板、研究员面板 | design-pages | 设计 REVIEW §14/B-08 | in_progress |
| W3-5 | 任务画布：恢复/冻结计划/审计记录/运行内容入口、快照评审面板（B-07） | design-pages | 设计 task.html | in_progress |
| W3-6 | PE37 大需求分组逐步细化：refineScope preview/start、未细化确认拦截 | design-pages | v5 已批准 | pending |
| W3-7 | 缺失页：knowledge-history、ppt-works、ppt-studio、run、roles-legacy | design-pages | 先只读/空/加载/错误/未知 | done |
| W3-8 | 工作流编辑器：method CRUD/复制/归档/校验 + 前端画布编辑 | design-pages | 设计 REVIEW §6-7 | pending |
| W3-9 | 结构缺口批次：任务列表步骤条/行菜单、开始任务三段卡/回执、模板分支/时间/文档、数据库授权项目/类型/三态、设置分区/脏保存、工具范围、需求目录抽屉 | design-pages | 设计细节 | in_progress |
| W3-10 | 节点详情子视图：工具详情/产物阅读/引用原文/宽阅读区/补读 | design-pages | 设计 node COVERAGE | pending |
| W3-11 | 主页与品牌：按设计调整主页区块；产品名是否改 `opencode-workflow` 需产品确认 | design-pages | 设计 REVIEW §3 | in_progress |

| W0-4b | 节点验收 gating：验收通过才结束执行/自动推进下游；驳回可触发重跑 | be | 来自 W0-4 验收 | `engine/execution.ts`、`shared/domain/**`、`tests/**` | 设计要求的待验收语义成立；测试覆盖 | done |
| W3-1b | 项目公约后端：charter 生成/读取/写入；ProjectSettings.docPaths/GitLab 项目绑定契约 | be | 来自 W3-1a | `engine/project-task.ts`、`packages/storage/**`、`server/http.ts`、`shared/**` | 项目详情四页签均有真实数据；测试 | pending |
| W3-7c | 剩余设计页：运行内容 run、历史角色配置 roles-legacy | design | 来自 W3-7 | 新增页面/路由 | 两页有真实数据/明确降级；无 mock | pending |
| W3-9b | 结构缺口批次：模板分支/时间/文档、数据库授权项目/类型/三态、设置脏保存/分区、工具范围、需求目录抽屉 | design | 来自 W3-9a | 对应页面 + 必要后端 | 设计清单逐项验收 | pending |
| W3-11 | 主页按设计对齐（产品窗口/能力卡/收尾）；品牌名 agent-workflow vs opencode-workflow 由产品确认 | design | 设计 REVIEW §3 | `apps/web/src/pages/home/**`、可能的品牌文案 | 设计结构一致或书面 de-scope | in_progress |

| W3-12 | 修 `diffPage` 未传 headSha 时空字符串导致 `REVISION_NOT_FOUND`（changes 文件 diff 500） | be | 来自 W3-7c 验收 | `packages/server/src/adapters/git-cli.ts`、`tests/**` | changes 文件 diff 正常返回；回归测试 | done |
| W3-13 | `POST /api/git/repos/:id/fetch` 与 fix push 接入远端 UNKNOWN 结算（引擎已导出分类 helper） | be | 来自 W2-12 验收 | `packages/server/src/http.ts`、`review-plugin.ts`、`packages/engine/src/fix.ts` | 网络超时/不可判定不误报 failed；可核对；测试 | done |
| W2-4c | readOnly 任务的 planning.actions/updateDraft 守卫（投影仍走 project-task） | be | 来自 W2-4b 验收 | `packages/engine/src/project-task.ts`、`tests/**` | 只读任务所有写入口一致拒绝 | done |
| W3-7d | run/roles-legacy 面包屑与入口映射（navigation.ts / 角色页链接） | fe | 来自 W3-7c 验收 | `apps/web/src/app/navigation.ts`、页面链接 | 面包屑正确、可发现 | pending |

| W0-4c | 任务画布显示「待人工验收」情况条/唯一主动作（execution.acceptance 投影） | fe | 来自 W0-4b 验收 | `apps/web/src/pages/task/**`、`pages/node/**` | 待验收任务可一键去验收；驳回后可重试 | pending |
| W3-4b | 知识研究过程/工具轨迹/流式回答 DTO 与 UI（当前诚实降级） | be+fe | 来自 W3-4a | `shared/api/contracts.ts`、`engine/knowledge.ts`、`server/http.ts`、页面 | 研究步骤与工具轨迹真实可读；流式或轮询 | pending |
| W3-9c | 结构缺口：数据库授权项目/类型/三态、工具范围、模板分支/时间/文档、需求目录抽屉 | design | 来自 W3-9b | 对应页面 + 必要后端 | 设计清单逐项验收 | pending |
| W3-11b | 品牌名决策：agent-workflow vs opencode-workflow；页头主题入口口径 | design | 来自 W3-11a | 品牌文案/Shell | 产品确认并统一 | pending |
| W4-1d | 文档同步 Wave 3C（371 tests、gating、设置、知识、CI） | docs | 来自 W4-3a | README/remaining-work/verification/design-coverage | 计数与状态一致 | pending |
| W4-3b | UI 视觉回归：在可用桌面环境跑 ui:smoke 并重拍关键截图；接入 CI（可选） | docs | 来自 W4-3a | scripts/证据/CI | 截图代表当前 UI；smoke 通过 | pending |

### Wave 4 · 文档与验证体系

| ID | 任务 | 负责人 | 说明 | 状态 |
| --- | --- | --- | --- | --- |
| W4-1 | 重写 `docs/design-coverage.md`（真实覆盖矩阵），修正 README/remaining-work/verification 矛盾与计数 | docs-keeper | 不得复制 verification | done |
| W4-2 | `docs/api.md` 按 ROUTES+服务端注册重新生成；加契约快照脚本进 verify | docs-keeper | 与 W1-10 配合 | done |
| W4-3 | 证据体系：live 日志摘要、`docs/evidence/README.md` 清单、截图更新、`test:e2e` 修复、最小 CI | docs-keeper | — | done |
| W4-4 | 打包：重新 dist、签名/公证、Windows/Linux 目标评估 | docs-keeper + Lead | 需要环境/凭据 | pending |
| W4-5 | 真实 PostgreSQL/GitLab 验证 | be-workspace + Lead | 需要实例/凭据 | pending |

## 4. 波次与并行策略

- **并行原则**：同一波内按文件所有权切分；不同 agent 不写同一文件。跨文件契约变更先由 Lead 下发变更单。
- **Wave 0**：`be-api` 与 `be-recovery` 并行；前端只做不影响 P0 的 Wave 1 任务。
- **Wave 1**：前端 4 个 agent 并行；`be-api` 继续回执/ROUTES。
- **每波结束**：Lead 跑 `npx tsc -p tsconfig.json --noEmit`、`npm test`、`npm run build:web`；记录整合日志；未通过项退回。
- **Wave 2** 依赖 Wave 0 的 API 契约与启动恢复；**Wave 3** 依赖 Wave 2 的执行/恢复/回执基础；**Wave 4** 最后做，确保文档反映代码。

## 5. 验收清单（Lead 每次整合执行）

```sh
npx tsc -p tsconfig.json --noEmit
npm test
npm run build:web
# 涉及服务端时
npm run build:server
```

- [ ] 类型检查 0 error
- [ ] 全量测试 0 fail（skip 只允许 gated live/凭据场景）
- [ ] web/server 构建成功
- [ ] 本轮任务逐项对照验收标准
- [ ] 执行日志已追加「任务完成」与「整合记录」
- [ ] `git status` 只包含预期改动；设计稿目录未修改
- [ ] 更新本文件状态列与任务板状态

## 6. 风险与阻塞

| 风险 | 影响 | 应对 |
| --- | --- | --- |
| 多位 agent 改同一文件 | 冲突/覆盖 | 写范围硬隔离；Lead 合并；冲突时按任务顺序重做 |
| 真实 GitLab/PostgreSQL/模型凭据缺失 | W2-5/W4-5 无法完成 | 先做离线/桩验证；标记 blocked 并请用户提供环境，不伪造 PASS |
| 设计稿内部矛盾（四段/五段、四套/五套、恢复页/面板） | 实现口径不清 | 按 `design-parity.md` §6 的较新权威处理，Lead 记录决策 |
| 大功能（项目详情/Inbox/角色/PE37/工作流编辑器）体量大 | 单轮做不完 | 拆成后端契约→前端页面→状态覆盖三步，分多轮推进 |
| 文档重写滞后于代码 | 再次失真 | Wave 4 统一重写；每波完成即更新相关章节 |

## 7. 决策记录

| 日期 | 决策 | 理由 |
| --- | --- | --- |
| 2026-10-19 | 采用「共享工作区 + 文件所有权隔离」而非每任务 Git worktree | 当前为 Lead 直接整合；任务量大，worktree 合并成本高；用写范围 + Lead 全量验收控制风险 |
| 2026-10-19 | 先修 P0，再清理假接通，再补设计能力，最后统一文档 | 避免把假状态写进文档；P0 会影响后续所有验收 |
| 2026-10-19 | 节点验收默认「实现」而非「移除」 | README 主打、设计节点面板要求唯一主动作；移除会破坏产品叙事 |
