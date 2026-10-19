# 后端缺口审查：桩、未注册接口、内存态与文档过度声明

> 审查范围：`packages/server/src`（全部路由）、engine / mcp / opencode / git / database / storage / shared。
> 方法：只读读码 + 隔离探针（临时数据目录、`disableListen`）+ 定向测试子集；未修改产品代码，未改设计稿目录。
> 标记说明：**【读码】**静态证据；**【探针】**本次隔离运行结果（/tmp 数据目录）；**【测试】**本次实际跑过的测试；**【未验证】**依赖真实模型/真实远端，本次未复跑。
> 证据边界：未复跑全量 `npm test`/typecheck；文档中的 live PASS 与测试计数未独立复核；GitHub/GitLab/MySQL 真实环境未重连。

## 1. 结论摘要

后端路由规模（【读码】脚本统计）：**152 条注册路由 = 135 条 `/api` 业务路由 + 13 条 `/internal/mcp` + 3 条静态兜底 + 1 条 provider 网关**；其中写路由 71 条。整体不是"空壳"：规划/计划编辑/执行/跳过/交付/审查/修复/非 Git 应用/角色/PPT/知识库单次问答等确有真实实现（见 §7）。但存在 5 个 P0 级问题——它们与文档/提交的"已完成"声明直接冲突，或破坏写操作回执契约。

### 最严重 5 条

1. **P0-1 模板可视化编辑是死代码**：文档称"缺口已关闭"（`docs/remaining-work.md:32`），提交 `67b6ddb`/`091073c` 称已做可视化编辑与拖拽；实际 `TemplatesPage.tsx` 只有按钮和 6 个从未渲染的状态（jsonEditor/jsonError/jsonBusy/visualEditor/visualError/dragIndex），`Modal`/`request` 导入未使用，从未调用 `PATCH /api/catalog/templates/:id`。点击"可视化编辑"无任何反应。【读码】`apps/web/src/pages/templates/TemplatesPage.tsx:92-97,632-654`。
2. **P0-2 写操作回执承诺被两处接口破坏，前端读取回执会崩溃**：`POST /api/git/repos/:projectId/fetch` 只返回 `{fetchedAt}`，前端却把它当 `CommandResponse` 并执行 `setReceipt(toReceiptView(data.receipt))`；`POST /api/opencode/restart` 同样只返回 `{status}`，`OpenCodeCard` 渲染 `restart.data.receipt.status`。README 却宣称"所有写操作走 requestKey + bodyHash + 回执"。【探针】fetch 返回 keys=`["fetchedAt"]`；【读码】`packages/server/src/http.ts:512-519,822-830`、`apps/web/src/api/git.ts:264-268`、`apps/web/src/pages/git/RepoWorkbench.tsx:181`、`apps/web/src/pages/settings/OpenCodeCard.tsx:225-226`、`README.md:22-23`。
3. **P0-3 SPA 兜底让未知 GET 返回 200 HTML，掩盖缺失接口**：`apps/web/dist` 存在时，任意未注册的 `GET /api/...` 落到 `app.get('/*')`，返回 `200 text/html` 的 index.html，而不是 JSON 404。shared `ROUTES` 中 3 条死路由（`planEditAbandon`、`executionAdvance`、`gitMergeRequest`）因此"假成功"。【探针】`GET /api/not-a-real-route`、`GET /api/tasks/task_x/execution/advance` 均 200 text/html；`POST` 同类路径为 404 JSON。【读码】`packages/server/src/http.ts:876-888`、`packages/shared/src/api/contracts.ts:1051,1066,1088`。
4. **P0-4 进程重启后 execution / planning / workspace 没有恢复路径**：只有 review/fix 有 `recoverOnStartup()`；执行中的节点/attempt、`preparing` 工作区在重启后永久停留在原状态，没有 unknown 标记，`operations.by-key` 也无从核对；规划轮次会停在 running（start 回执保持 accepted、by-key 只会显示 stillUnknown），但没有任何状态迁移/核对入口，UI 一直显示"运行中"。【读码】`packages/server/src/review-plugin.ts:61-62`、`packages/engine/src/review.ts:212`、`packages/engine/src/fix.ts:189`；execution.ts / planning.ts / workspace.ts 无对应恢复入口。
5. **P0-5 节点验收能力缺失**：README 产品定位写"节点验收"（`README.md:3`），但 `node.accept`/`node.reject` 只存在于枚举和操作表（`packages/shared/src/domain/enums.ts:500-501,587-588`），没有引擎方法、没有 HTTP 路由；`PlanService.nodeDetail` 直接硬编码 `accept: { allowed:false, reason:'执行未实现验收动作' }`（`packages/engine/src/plan.ts:351-353`）。前端也明说"没有……验收入口"（`apps/web/src/pages/node/NodeDetailPanel.tsx:327`）。

### P1 / P2 概览

- **P1（9 条）**：流程编辑 API 缺失；执行自动推进切换缺失；知识库 conversation 接口缺失（文档标 ✅）；GitLab 真实写仅测试桩 + `gitlabConfigured` 恒 false + 自托管 host 推导缺陷；GitHub 写产品边界仅 push/create PR；回执覆盖缺口（settings/databases/gitlab/restart/fetch/template archive）；工作区清理非 Git 副本不删除；恢复模式仅改标题；模板归档无回执/未测试。
- **P2（12 条）**：ROUTES 与注册不一致；状态口硬编码（tools=13、database.connected=0、output.terminal=false、per-view actions 恒 `{}`）；死配置（autoStart/permissionMode/delivery.* 等）；confirm 标志未强制；双 Git 实现（`packages/git` 未被产品使用）；engine→server 反向依赖；静态路径前缀校验；写路由缺 requestKey 时 500；远端超时一律 failed（无 UNKNOWN）；文档 stale/自相矛盾（README 轮次、verification §10 与 §3.2、api.md、迁移版本、两文档近重复）；知识库历史塞 settings JSON；测试/轮次计数陈旧。

## 2. 汇总表

| 编号 | 严重度 | 能力 | 状态 | 证据 |
| --- | --- | --- | --- | --- |
| P0-1 | P0 | 模板可视化编辑 / JSON 编辑新版本 / 归档 | 未实现（UI 死代码；后端 PATCH 真实） | `apps/web/src/pages/templates/TemplatesPage.tsx:92-97,632-654`；`docs/remaining-work.md:32`；后端 `packages/engine/src/template-catalog.ts:49-69` |
| P0-2 | P0 | fetch / opencode restart 回执 | 未实现（返回形状不符 `CommandResponse`） | `packages/server/src/http.ts:512-519,822-830`；`apps/web/src/api/git.ts:264-268`；`…/RepoWorkbench.tsx:181`；`…/OpenCodeCard.tsx:225-226` |
| P0-3 | P0 | 未知 GET /api 的 404 语义 | 破坏（返回 200 HTML） | `packages/server/src/http.ts:876-888`；探针 3 例 |
| P0-4 | P0 | execution/planning/workspace 重启恢复 | 未实现 | `review-plugin.ts:61-62` 仅 review/fix；`engine/execution.ts` 无恢复 |
| P0-5 | P0 | 节点验收 | 未实现 | `engine/plan.ts:351-353`；`shared/domain/enums.ts:587-588`；无路由 |
| P1-1 | P1 | 流程（method）编辑 API | 未实现 | `apps/web/src/pages/workflows/WorkflowsPage.tsx:12,131-136`；无 catalog.method 写路由/服务 |
| P1-2 | P1 | 执行自动推进切换 | 未实现（仅默认值与只读展示） | `packages/server/src/http.ts`（无 advance 路由）；`shared/api/contracts.ts:1066`；`…/ExecutionPanel.tsx:120-128`；`enums.ts:584` |
| P1-3 | P1 | 知识库 conversation 接口 | 未实现（单次问答与历史真实） | `apps/web/src/pages/knowledge/KnowledgePage.tsx:15-18`；全仓无 `conversations` 实现；`engine/knowledge.ts:46-120` 真实 |
| P1-4 | P1 | GitLab 真实写 | 仅测试桩 | `tests/integration/gitlab-mr.test.ts:26-60`；`docs/verification.md:161-162`；`application.ts:86`；`server/remote.ts:196-233` |
| P1-5 | P1 | GitHub 写 | 部分实现（产品仅 push + create PR） | `packages/git/src/remote.ts:243-287`（无 close/merge）；`tests/integration/github-live-write.test.ts:113-137` 关闭/删分支为测试内 raw REST |
| P1-6 | P1 | 写操作回执覆盖 | 部分实现 | 见 §3.4 矩阵 |
| P1-7 | P1 | 工作区清理 | 部分实现（非 Git 副本/基线不删） | `engine/workspace.ts:96-107,269-275` |
| P1-8 | P1 | 恢复深度（三种模式） | 仅标题装饰 | `engine/recovery.ts:156-160`；测试仅断言标题 `tests/integration/recovery-api.test.ts:42-50` |
| P1-9 | P1 | 模板归档 | 后端真实但无回执、无测试、UI 未接线 | `http.ts:630-633`；`template-catalog.ts:70-75`；`template-import.test.ts` 无 archive 调用 |
| P2-1 | P2 | shared ROUTES 一致性 | 3 条死条目 + 7 条 fix 路由未收录 | `contracts.ts:1051,1066,1088`；`review-plugin.ts:112-173` |
| P2-2 | P2 | 状态口真实性 | 硬编码/恒空 | `http.ts:179,305,320,351,357,799-803` |
| P2-3 | P2 | 配置项生效 | 多项死配置 | `shared/config/settings.ts:29,33,37,207-217`；仅 `execution.nodeTimeoutMinutes` 被用（`execution.ts:430`） |
| P2-4 | P2 | 显式确认强制 | 未校验 | `engine/delivery.ts` 全文；对照 `fix.ts:508`、`execution.ts:164`、`acceptance.ts:20` |
| P2-5 | P2 | 双 Git 实现 | `packages/git` 的 repository/worktree 未被产品使用 | `server/application.ts:10` 用 `adapters/git-cli.ts`；`server/remote.ts:3-4` 仅用远端适配器 |
| P2-6 | P2 | 分层/依赖声明 | engine→server 反向运行时依赖；依赖清单不全 | `engine/knowledge.ts:19`、`engine/ppt.ts:14`；各 package.json 仅声明 shared |
| P2-7 | P2 | 静态资源路径校验 | `startsWith` 无分隔符；`/assets/*` 不拒绝 `..` | `http.ts:863-875` |
| P2-8 | P2 | 缺 requestKey 的 400 语义 | 500 | 探针 `POST /api/tasks` → 500；仅 `http.ts:212-213`、`review-plugin.ts:206-207`、`directory-apply-plugin.ts:100-102` 校验 |
| P2-9 | P2 | 远端写失败分类 | 一律 failed，无 UNKNOWN | `engine/delivery.ts:205-208`；`engine/fix.ts:633+` |
| P2-10 | P2 | 审查快照对比 | 仅 findings 集合差（文档已承认无代码快照） | `http.ts:437-461`；`shared/domain/models.ts:928-949` |
| P2-11 | P2 | 知识库/PPT 历史数据模型 | 存 settings JSON，无会话表 | `engine/knowledge.ts:111-113`；`storage/migrations.ts` 无 knowledge 表 |
| P2-12 | P2 | 文档一致性 | 12 处 stale/矛盾/重复 | 见 §5 |

## 3. 路由与接口缺口明细

### 3.1 缺失 / 死路由

| 方法 | 路径（shared ROUTES 键） | 现状 | 证据 |
| --- | --- | --- | --- |
| POST | `/api/tasks/:id/plan/edit/abandon`（`planEditAbandon`） | 404；引擎无方法；操作表 `plan.edit.abandon` 从未使用 | `contracts.ts:1051`；`enums.ts:575`；探针 |
| POST | `/api/tasks/:id/execution/advance`（`executionAdvance`） | 404；引擎无方法；`execution.advance` 从未使用 | `contracts.ts:1066`；`enums.ts:584`；探针 |
| GET | `/api/git/repos/:projectId/merge-requests/:iid`（`gitMergeRequest`） | 未注册；被 SPA 兜底返回 200 HTML | `contracts.ts:1088`；探针 |
| POST | `/api/knowledge/conversations`、`/…/:id/messages` | 服务端未注册（前端仅作为"建议能力"展示，并未调用） | `KnowledgePage.tsx:15-18`；全仓 grep 无实现；探针 404 |

### 3.2 shared ROUTES 与服务端注册不一致（【读码】+【探针】）

- **ROUTES 有、服务端无**：`planEditAbandon`、`executionAdvance`、`gitMergeRequest`（`contracts.ts:1051,1066,1088`）。
- **服务端有、ROUTES 无**：fix 的 `diff/stop/commit/push/merge-request/discard/files/:fileId/revert` 共 7 条（`review-plugin.ts:112-173`）；`GET /api/settings/git`（`http.ts:750`）；`GET /api/ppt/works/:id/pptx`（`http.ts:568`）；`DELETE /api/settings/databases/:id`（`http.ts:719`）；`ALL /api/opencode/gateway/:secret/v1/*`（`opencode-gateway.ts:60`）。
- `docs/api.md:3` 声称"实现以 ROUTES 为准"，但上述双向不一致使该表述不成立；`docs/api.md:66` 还称 delivery merge-request"远端适配器待接线"，实际已接线（`delivery.ts:169-209`）。
- 操作表 `OPERATIONS` 声明了 74 个操作（`enums.ts:555-631`），脚本对照后确认 **14 个从未被 `commands.begin` 使用**：`task.archive`、`plan.edit.abandon`、`plan.reconfirm`、`task.workspace.cleanup.preview`（非变更）、`execution.advance`、`node.accept`、`node.reject`、`catalog.template.archive`、`git.fetch`、`database.test`、`database.query`（非变更）、`settings.update`、`secret.save`、`opencode.restart`。其中 `git.fetch/settings.update/secret.save/opencode.restart/catalog.template.archive` 对应路由**实际存在但绕过了回执**。

### 3.3 前端路径对照结论

用脚本提取 `apps/web/src` 全部 `/api` 字面量路径（22 条）与 ROUTES 键（119 个），与服务端 135 条 `/api` 路由对照：

- **没有任何"前端正在调用但服务端未注册"的路径**（会 404 的两条 knowledge conversations 仅渲染为"建议的服务端能力"，无 fetch 调用）。
- 存在 2 条**契约形状不一致**（非未注册）：`fetch`、`opencode/restart` 被前端按 `CommandResponse` 解析但服务端不返回 `receipt`（见 P0-2）。
- 存在 1 条**响应被兜底掩盖**：`GET …/merge-requests/:iid` 在 dist 存在时返回 200 HTML。

### 3.4 写操作 requestKey / 回执覆盖矩阵（71 条写路由）

| 覆盖情况 | 路由 |
| --- | --- |
| ✅ 走 `CommandService`，requestKey + bodyHash + 回执 | projects（create/recheck/update）、tasks（create/updateDraft）、planning（start/stop/apply/reject/answers）、plan（from-template/skeleton/confirm/edit begin/save/finish）、workspace（prepare/cleanup confirm）、execution（start/pause/resume/retry/skip/cancel）、delivery（select/commit/push/merge-request/merge）、directory apply、reviews（start/stop/finding update）、fixes（start/stop/commit/push/merge/merge-request/discard/revert）、ppt（create/update/generate/slides/attach）、knowledge ask、acceptance、roles（save/publish/restore/archive）、templates import/update、recovery |
| ❌ 无回执 / 不登记操作 | `PATCH /api/settings`（`http.ts:675-683`）、`POST /api/settings/databases`（`:690`）、`DELETE /api/settings/databases/:id`（`:719`）、`POST /api/settings/gitlab`（`:763`）、`POST /api/settings/gitlab/test`（`:772`）、`POST /api/opencode/restart`（`:822`）、`POST /api/git/repos/:projectId/fetch`（`:512`）、`DELETE /api/catalog/templates/:id`（`:630`） |
| ⚠️ 有回执但 requestKey 由服务端自造，调用方无法核对 | `DELETE /api/ppt/works/:id`（`engine/ppt.ts:258-270`）、`DELETE …/attachments/:name`（`ppt.ts:132-137`） |
| ⚠️ 非变更 POST（可接受） | planning preview、planning reconcile、workspace cleanup preview、delivery apply preview、database probe/query |

**UNKNOWN 可核对性缺口**：

- review/fix 重启会置 unknown 并结算（`review.ts:212-233`、`fix.ts:189-204`），可用 `GET /api/operations/:key` 核对（`http.ts:664-668`）。
- execution/workspace 重启不产生 unknown（P0-4），`/api/operations` 无对应记录；planning 的 start 回执停在 accepted（by-key 只显示 stillUnknown），但轮次状态留在 running、UI 不进入待核对。
- 远端写超时全部落 `failed`（`delivery.ts:205-208`），远端可能已成功；重试可能重复创建 MR/重复推送，无 UNKNOWN 供核对（P2-9）。
- 上述无回执请求（7 条写 + `gitlab/test` 验证）在失败后既无 accepted 也无 UNKNOWN，无法按约定核对。

### 3.5 其他契约/健壮性问题

- **缺 requestKey 返回 500**：`POST /api/tasks`（无 requestKey）【探针】→ `500 INTERNAL_ERROR`；因为 `CommandService.begin` 在 `input.requestKey.startsWith` 处抛 TypeError（`engine/operations.ts:43`），HTTP 层未先校验。仅 3 处做了显式校验。
- **confirm 标志未强制**：delivery 的 commit/push/merge-request/merge 均未检查 `confirmCommit/confirmPush/confirmMergeRequest/confirmMerge === true`（`engine/delivery.ts:80-263`），cleanup confirm 未检查 `confirmCleanup`（`workspace.ts:249`）；与 skip/fix/acceptance 的强制校验不一致。
- **字段级硬编码**：`output.terminal: false`（`http.ts:351`，前端 `NodeDetailPanel.tsx:91` 会一直按"未终止"处理）；`bootstrap.integration.database.connected: 0`（`http.ts:179`）；`mcp.tools: 13`（`http.ts:802`，工具集可被关闭到少于 13）；workspace/execution/delivery 视图 `actions: {}`（`http.ts:305,320,357`）。

## 4. 领域能力盘点

| 能力 | 判定 | 证据与说明 |
| --- | --- | --- |
| 流程编辑 API（method 目录写） | **未实现** | 只有 `bootstrap.catalog.methods` 只读；UI 按钮禁用并写明原因 `WorkflowsPage.tsx:12,131-136`；无服务/路由/操作 |
| OpenCode 检测 | **真实实现** | 扫描 PATH / `~/.opencode/versions` 并探测 `--version`：`opencode-detect.ts:24-71`；`GET /api/opencode/detect` |
| OpenCode 启动 / 重启 | **真实实现** | `manager.ts:67-174`（spawn serve、config 注入、健康检查/版本校验）、`:192-195` restart；`application.ts:185-189` 后台启动 |
| OpenCode 启动/重启历史 | **未实现** | 状态类型只有单次 `startedAt/lastError`（`opencode/types.ts:92-101`）；无历史表/接口；UI 自述"启动 / 重启历史尚未接通"（`RuntimePage.tsx:225,256`） |
| 执行自动推进（行为） | **真实实现** | `execution.ts:293-298` 按 `autoAdvance` 暂停；默认值来自 `settings.execution.autoAdvanceByDefault`（`plan.ts:153`） |
| 执行自动推进切换 | **未实现** | 无路由/方法；UI switch 永久 disabled 且文案"服务未提供切换自动推进的接口"（`ExecutionPanel.tsx:120-128`） |
| 审查快照对比 | **部分实现** | findings 三分类真实（`http.ts:437-461`；【测试】review-compare 通过）；ReviewRun 不存 diff/文件快照（`models.ts:928-949`），无并排代码快照视图（文档已承认 `remaining-work.md:34`） |
| 模板编辑（后端） | **真实实现** | import/update 有 requestKey+回执与版本递增校验：`template-catalog.ts:31-69`；【测试】template-import 通过 |
| 模板编辑（UI/归档） | **未实现/部分** | 前端死代码 P0-1；`DELETE /api/catalog/templates/:id` 无回执且测试未覆盖（`http.ts:630-633`） |
| 节点跳过 | **真实实现** | `execution.ts:160-214`：确认位、暂停态校验、下游级联 cancelled、回执；【测试】node-skip 通过 |
| 节点验收 | **未实现** | `plan.ts:351-353` 硬编码拒绝；无 `node.accept/reject` 路由；README:3 却宣传"节点验收" |
| 工作区准备（Git worktree / 非 Git 副本） | **真实实现** | `workspace.ts:41-159`；`git-cli.ts:269-287`；【既有测试】concurrent-worktrees / directory-apply-e2e（本次未复跑） |
| 工作区清理 | **部分实现** | Git worktree + 本地分支真实删除（`workspace.ts:270-273`）；非 Git 目录副本与 baseline 从不删除（`displayRoot` 有值但 `branch` 为空 → 跳过删除），却把状态改成 `cleaned`（`workspace.ts:273`）；无对应测试 |
| 交付合并（本地 Git） | **真实实现** | `delivery.ts:211-263`；`git-cli.ts:367-413`：目标 tip CAS、临时 worktree、冲突 abort、目标分支不变 |
| 远端 MR 合并/关闭 | **未实现** | 远端 Provider 接口只有 test/getProject/getDefaultBranch/list/create/listProtectedBranches（`git/src/remote.ts:42-50`） |
| 恢复深度 | **部分实现** | 只派生 draft 并复制需求/方法（`recovery.ts:68-84`）；三种模式只影响标题（`:156-160`）；无执行/规划上下文恢复；无 execution/planning 启动恢复 |
| GitLab 真实写 | **仅测试桩** | 适配器代码真实（`git/src/remote.ts:412-427`）但只对本地 stub 测试（`gitlab-mr.test.ts:26-60`）；真实实例未连接（`verification.md:161-162`）；`gitlabConfigured` 恒 false（`application.ts:86`，且 `actions.ts:42` 接收后从未使用）；自托管 host 推断缺陷（`server/remote.ts:225-232` 仅识别 github，其余全按 GitLab；API base 取全局 settings 而非远端 host） |
| GitHub 写 | **部分实现** | 产品能力：push（`git-cli.ts:352-365`）+ 创建 PR（`git/src/remote.ts:259-274`）+ list；无关闭/合并/删分支。live 测试里关闭 MR/删分支是测试内 raw REST（`github-live-write.test.ts:113-137`），push 也是 raw git；产品 push 未在 GitHub live 中走通 |
| PPT 高级视觉 | **部分实现** | 仅纯色背景 + 标题 + bullet + 单图附件（`ppt.ts:52-89`）；无母版/图表/版式/备注；文档已承认"基础版式"（`verification.md:79`） |
| PPT 附件 | **真实实现** | `ppt.ts:102-125`；迁移 v8；测试覆盖 |
| 知识库固定来源/搜索/正文 | **真实实现** | `http.ts:532-562`；`server/knowledge.ts` 路径逃逸防护 |
| 知识库单次问答 + 校验引用 + 历史 | **真实实现** | `engine/knowledge.ts:46-125`；conversationId 仅用于在同一 settings JSON 历史中取最近 3 条（`:66-71,111-113`） |
| 知识库 conversation 接口 | **未实现** | 无 conversations/messages 路由、无会话存储表；前端标为"建议能力" |
| 数据库（MySQL/PostgreSQL 只读） | **真实实现（live 未复跑）** | MySQL 真实探针/只读/写拦截（CI 测试与 live 记录）；PG 驱动真实但仅单测（`database/postgres.ts`、`service.ts:296-301`）；Oracle/DM/DB2 明确 `planned`（`settings.ts:229-231`） |
| 内部 MCP（13 工具 + 鉴权 + 路径/命令白名单） | **真实实现** | `mcp/src/tools/index.ts:21-35`；`server/internal.ts:22-217`（Bearer、safePath、exec 白名单） |

## 5. 文档过度声明清单

| # | 文档位置 | 声明 | 代码事实 | 结论 |
| --- | --- | --- | --- | --- |
| 1 | `docs/remaining-work.md:32` | 模板编辑器"可视化步骤增删/拖拽排序/JSON 编辑新版本/归档……缺口已关闭" | UI 从未渲染编辑器，未调用 PATCH/DELETE；提交 `67b6ddb`、`091073c` 只加了状态与按钮 | **过度声明（P0）** |
| 2 | `docs/verification.md:47` | `server/templates` 覆盖"可视化编辑新版本……归档" | 测试只覆盖 import + PATCH update；无 archive 调用（`template-import.test.ts`） | 过度声明 |
| 3 | `docs/remaining-work.md:25` | 知识库 ✅ "conversationId 会话/历史" | 只有单次问答 + settings JSON 历史；无会话 CRUD/读取接口 | 部分过度声明 |
| 4 | `docs/remaining-work.md:16,31`、`README.md:84` | "GitHub 真实 push/MR/关闭/删分支已验证" | push + 创建 MR 在测试中执行（push 为 raw git，MR 为 RemoteService）；关闭/删分支为测试内 raw REST；产品无这些能力 | 表述易被读成产品能力，实际仅测试脚本 |
| 5 | `README.md:3` | 产品流程含"节点验收" | 无节点验收 API/动作，nodeDetail 明确拒绝 | 过度声明（P0-5） |
| 6 | `README.md:22-23` | "所有写操作走 requestKey + bodyHash + 回执" | 7 条写请求无回执（另 1 条验证请求）；2 处前端读取不存在的 receipt | 事实不成立（P0-2/P1-6） |
| 7 | `docs/remaining-work.md:20` | "常量/枚举/状态机/回执 ✅ operations 回执与 UNKNOWN 核对" | 回执覆盖不全；execution/planning 重启无 UNKNOWN | 部分过度声明 |
| 8 | `docs/verification.md:266` | "`fix.merge` 未实现" | `fix.ts:500-548` 已实现 merge + 路由 + 测试；同文档 `:135` 又写 merge PASS | 文档自相矛盾（stale） |
| 9 | `docs/verification.md:267` | "FixRun start/stop requestKey 只存在内存" | 已持久化到 settings：`fix.ts:293,386` | stale（underclaim） |
| 10 | `docs/verification.md:264-268` | "真实 GitHub push / 创建 MR / 直接合并未执行" | 同文档 §3.2（`:82-93`）写"真实 GitHub 远端写（PASS）" | 文档自相矛盾 |
| 11 | `docs/remaining-work.md:26` vs `:33` | 前者说 PPT"附件未做"，后者说"文本+图片附件已做" | 附件真实实现（v8 + API + 测试） | 文档自相矛盾（row 26 stale） |
| 12 | `docs/remaining-work.md:14` | "迁移 v1–v7" | `storage/migrations.ts` 已到 v10 | stale（underclaim） |
| 13 | `docs/remaining-work.md:3` / `README.md:110` | "第 62 轮" / "截至第 15 轮"；verification 写 313 tests / 54 suites | verification 内容已写到第 89 轮；仓库现有 69 个测试文件（含后续新增） | 更新标记/计数陈旧（未复跑全量） |
| 14 | `docs/api.md:3,66` | "实现以 ROUTES 为准"；merge-request"远端适配器待接线" | ROUTES 有 3 死条目、缺 7 条 fix 路由；merge-request 已接线 | stale/不一致 |
| 15 | `docs/design-coverage.md` | 独立文档 | 与 `docs/verification.md` 除末节外逐行相同（diff 仅 6 行差异） | 文档重复，易双份失真 |

> 未发现"整页假的成功画面"式过度声明：多数页面在未接通处有明确"只读/未接通"文案。上述问题集中在模板编辑、节点验收、会话接口、回执承诺与文档 stale。

## 6. 建议下一步任务（按优先级）

1. **修回执契约（P0-2/P1-6）**：为 `git.fetch`、`opencode.restart`、`settings.update`、`secret.save`、数据库连接 upsert/delete、`catalog.template.archive` 接入 `CommandService.begin/settle/fail`；在 shared 定义对应 response 形状；修 `RepoWorkbench` 与 `OpenCodeCard` 的 receipt 读取；补 HTTP 层 requestKey 校验（缺失返回 400）。
2. **修路由兜底（P0-3）**：静态 SPA 兜底只匹配非 `/api` 路径；未知 `/api` GET 返回 JSON 404；删除 `planEditAbandon`/`executionAdvance`/`gitMergeRequest` 死 ROUTES，或补齐实现。
3. **启动恢复（P0-4）**：在 `createApplication` 启动序列中扫描 running execution（节点/attempt 标记 interrupted + execution unknown + 结算 accepted 回执）、running/queued planning（置 unknown 或触发 reconcile）、preparing workspace（置 unknown），并在 UI 提供核对入口。
4. **兑现或撤回"已完成"声明（P0-1/P0-5）**：要么实现模板编辑器模态（visual + JSON + archive）并接上 PATCH/DELETE，要么删除按钮与 remaining-work:32 的"缺口已关闭"；节点验收同理（实现 `node.accept/reject` 或从 README/产品流程移除"节点验收"）。
5. **流程编辑与自动推进切换（P1-1/P1-2）**：明确 method 目录是否可写；若不可写，从 ROUTES/操作表移除 `execution.advance` 并保留禁用说明；若可写，补 catalog.method 写服务、回执、修订与回滚。
6. **知识库会话（P1-3）**：新增 conversations 表 + `POST /conversations`、`POST /conversations/:id/messages`、`GET /conversations/:id`，把历史从 settings JSON 迁移；先统一 KnowledgePage 文案（当前同时存在"文档问答可用"`：76` 与"问答仍未接通"`：367`）。
7. **GitLab 真实写（P1-4）**：按远端 host 推导 apiBaseUrl/webUrl；`gitlabConfigured` 改为真实 token/连接检测并从 `computeTaskActions` 真正使用；跑一次真实 GitLab smoke；说明 MR close/merge 不在能力内。
8. **GitHub 写边界（P1-5）**：如需"关闭 MR/删分支/合并"产品能力，补 Provider 方法与路由；否则修正 README/remaining-work 表述为"创建 PR + 推送已验证，关闭/删除仅为测试清理"。
9. **工作区清理（P1-7）**：非 Git 任务在 cleanup confirm 中删除 `workspaces/<taskId>` 与 `baselines/<workspaceId>`（含 settings 键），或明确保留策略并改投影；补非 Git 清理测试。
10. **收口细节（P2）**：修硬编码状态（tools 数、database.connected、output.terminal、view actions）；删除或实现死配置；强制 confirm 标志；统一 `packages/git` 与 server adapter（或声明其为测试库）；把 engine 对 server 的 import 下沉到 shared/engine；修正 §5 全部文档条目并合并 design-coverage/verification。

## 7. 已核实真实完成清单

以下均为【读码】+ 部分【测试】/【探针】核实，不是桩；标注【既有测试】者本次未复跑，`live` 场景均未复跑：

- 项目登记/重检/更新（receipt、路径检测）：`engine/project-task.ts:56-119`；任务创建/需求草稿（`:225-304`）。
- 规划：preview/start/stop/reconcile/apply/reject/answers/record，含候选校验、人工判断、unknown 会话核对：`engine/planning.ts:675-692,694-760`；`http.ts:252-285`。
- 计划：from-template/skeleton/confirm、执行中编辑 begin/save/finish（锁已领取节点、依赖环检测、自动推进快照恢复）：`engine/plan.ts:64-314`；【测试】plan-edit-dependencies 通过。
- 工作区：Git worktree 与非 Git 目录副本准备、变更集与 diff：`workspace.ts:41-203`；`git-cli.ts:269-287`；【既有测试】concurrent-worktrees（本次未复跑）。
- 执行：start/pause/resume/retry/cancel、节点跳过及下游级联、模型输出流、MCP 结果提交、失败/超时分类：`execution.ts:57-235,328-471`；【测试】node-skip 通过。
- 交付：select/commit/push/merge-request/merge；本地合并 CAS + 冲突 abort：`delivery.ts:50-263`；`git-cli.ts:328-413`。
- 非 Git 三方应用：preview → 冲突处理 → apply → 备份/漂移/路径防护：`engine/directory-apply.ts`（1649 行）；`directory-apply-plugin.ts:28-39`；【既有测试】directory-apply-e2e / directory-apply-api（本次未复跑）。
- 审查/修复：start/stop/get/list、findings 校验与状态更新、修复 worktree/commit/push/MR/merge/discard/revert、进程重启 unknown 结算：`engine/review.ts`、`fix.ts`（1293 行）、`review-plugin.ts`。
- 审查对比：resolved/introduced/persisting 真实；【测试】review-compare 本次通过（`http.ts:437-461`）。
- 恢复派生草稿：requestKey 幂等、父任务不变、历史列表：`recovery.ts:40-115`；【既有测试】recovery-api（本次未复跑；模式仅标题，见 P1-8）。
- 人工验收（任务级）：`acceptance.ts:19-40`。
- 角色目录：草稿/发布/历史快照/恢复/归档 + 热更新：`role-catalog.ts`；【既有测试】roles-api / roles-history（本次未复跑）。
- 固定模板：导入/更新（版本递增）/按模板计划/历史；后端真实（UI 编辑缺失见 P0-1）。
- PPT：草稿 CRUD、模型大纲/逐页、附件、Markdown/PPTX 导出：`ppt.ts:26-255`；【测试】ppt-works 通过（含 pptx 真实 ZIP 头）。
- 知识库：来源/搜索/正文、单次问答 + 引用校验 + usage + 本机历史：`engine/knowledge.ts:46-125`；`server/knowledge.ts`。
- 内部 MCP：13 工具注册、toolsets 前缀过滤、Bearer 鉴权、workspace 读写/路径逃逸防护、exec 白名单：`mcp/src/tools/index.ts:21-35`、`mcp/src/env.ts:94-99`、`server/internal.ts:22-217`。
- Git 读口：repos/commits/commit/files/diff/branches/MR 列表/fetch；worktree/commit/push/merge CAS：`http.ts:366-519`、`git-cli.ts`。
- 数据库：MySQL 真实探针/只读/注入拦截（live 未复跑）；PG 只读驱动（单测未复跑）：`database/mysql.ts`、`postgres.ts`、`guard.ts`。
- 设置校验、数据库连接 CRUD 的持久化与密码 secrets 引用（但无回执，见 P1-6）：`http.ts:671-747`；`storage/secrets.ts`。
- 操作核对：`GET /api/operations/:key`（review/fix 等 unknown 可核对）：`http.ts:664-668`。

### 本次实际运行的验证

- 【测试】`node --import tsx --test`：node-skip / plan-edit-dependencies / review-compare / workspace-cleanup-blockers → **4/4 pass**。
- 【测试】template-import / knowledge-sources / ppt-works → **3/3 pass**。
- 【探针】见 §1/§3 引用；全部使用 `/tmp` 临时数据目录，`git status` 确认仓库仅有 `docs/review/` 未跟踪目录。
- 【未验证】`npm test` 全量、typecheck、模型 live、真实 GitHub/GitLab/MySQL 场景未在本轮复跑；文档中的 PASS 记录未独立复核。
