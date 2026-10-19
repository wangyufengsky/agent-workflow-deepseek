# 执行日志（任务完成与整合记录）

> 与 [`docs/task-assignment.md`](task-assignment.md) 配套。每次任务完成由执行 agent 或 Lead 追加；每次整合由 Lead 追加。
> 格式：`[时间] 类型 | 任务 ID | 摘要 | 证据/命令 | 结果`。
> 状态：任务全部完成后，本文件应与任务分派文档的完成状态一致。

## 2026-10-19

### 20:15 分派 | Wave 0 + Wave 1

- 依据：`docs/review/2026-10-19-audit.md`（P0×5、P1×约25、P2×约30、文档失真 12+）。
- 产出：[`docs/task-assignment.md`](task-assignment.md)，含 5 个波次、36 个工作包、文件所有权与验收标准。
- 本轮并行启用：`be-api`、`be-recovery`、`fe-ppt`、`fe-templates`、`fe-misc`、`fe-cleanup`。
- 规则：文件写范围硬隔离；Lead 每波跑 typecheck + 全量测试 + build:web，并记录整合。
- 待验收：W0-1、W0-2、W0-5、W1-1~W1-12。

### 20:15 分派 | 基线证据

- 基线：`npx tsc --noEmit` exit 0；`npm test` 316 tests / 305 pass / 11 skip / 0 fail。
- 仓库状态：仅有审查新增 `docs/review/` 与本分派文档，无产品代码改动。

### 20:20 分派 | 6 个 agent 与任务包

| Agent | 共享任务 | 工作包 | 写范围 |
| --- | --- | --- | --- |
| `be-api` | task-5 | W0-1/W0-2/W0-5/W1-9/W1-10 | server/http.ts、shared/contracts.ts、engine/delivery.ts、web/api/endpoints.ts、web/main.tsx、tests/integration |
| `be-recovery` | task-6 | W0-3 | engine/execution.ts、planning.ts、workspace.ts、engine.ts、server/application.ts、tests/integration |
| `fe-ppt` | task-7 | W1-1 | apps/web/src/pages/ppt/** |
| `fe-templates` | task-8 | W1-2 | apps/web/src/pages/templates/** |
| `fe-audit`→实现 | task-9 | W1-3~W1-8 | knowledge/start/insights/runtime/AppearanceSection/ToolsPage/placeholders/api/types |
| `design-audit`→实现 | task-10 | W1-11/W1-12 | requirement/WorkspacePanel.tsx、task/TaskCanvasPage.tsx、delivery/**、git/FixPanel.tsx、api/workflow.ts |

- 约束：文件写范围硬隔离；前端 agent 不跑 `build:web`（避免 dist 冲突），由 Lead 整合时统一构建；后端 agent 用独立临时目录/端口。
- 等待：每个 agent 完成时追加执行日志并向 Lead 发送摘要；Lead 逐项验收后更新任务板与分派文档状态。

### 20:18 完成 | task-9 / W1-3~W1-8 | fe-misc

- 改动文件（均在写范围内）：`pages/knowledge/KnowledgePage.tsx`、`pages/start/StartPage.tsx`、`pages/insights/InsightsPage.tsx`、`pages/runtime/RuntimePage.tsx`、`pages/settings/AppearanceSection.tsx`、`pages/tools/ToolsPage.tsx`、`app/placeholders.tsx`；删除无引用的 `api/types.ts`。
- W1-3 知识库：删除 `ASK_BLOCKED_REASON`、`PLANNED_ENTRYPOINTS`（含不存在的 `/api/knowledge/conversations*`）、底部 PendingBackendNotice；“当前输入不会发送/问答与引用仍未接通/历史对话需要服务端接口”全部改写为真实已接能力；“资料来源”改为滚动到来源卡（去掉假禁用）；历史读取失败/无项目有真实状态。
- W1-4 开始任务：`StartPage` 通过 `useSearchParams` 读取 `project`/`methodId`，校验后预选；非法值回退默认并在页面显示提示；手动选择后提示消失。
- W1-5 质量与用量：删除 lede“人工验收结论仍未接入”；任务明细 tokens 使用 `/api/insights/task-usage` 的 `usageByTask`；成本/耗时/重试改用“服务未提供”徽标；验收/用量读取失败有提示。
- W1-6 运行环境：读取 `status.managed`；未受管显示“外部进程 · 未受管”并禁用重启+原因；加载中/未知/starting/external 全部禁用重启；增加外部进程说明条，补充 bootstrap 错误提示。
- W1-7：`AppearanceSection` 删除“其余设置需要服务端接口”；`ToolsPage` 明确“toolset 启停已接通、单工具未接通”，单工具按钮改为“单工具控制”；`bootstrap` 未读取时禁用 toolset 修改，补错误提示。
- W1-8：`app/placeholders.tsx` 只保留 `NotFoundPlaceholder`；删除 `api/types.ts`（全仓无引用）；清理本批未使用导入/常量（`Skeleton` 等）；`PptPage` 等不在本批范围的未使用项留给该页负责人。
- 验证：`npx tsc -p tsconfig.json --noEmit` exit 0；本批文件 scoped tsc exit 0；`--noUnusedLocals --noUnusedParameters` 在本批文件范围 0 报错；`grep` 上述陈旧文案为空；未跑 `build:web`（Lead 并发约束）。未做浏览器手工点击，建议 Lead 整合 smoke 覆盖 start 深链与 managed=false。
- 未覆盖（其他任务/真实缺口）：运行环境显式 start 与操作历史仍无服务端接口（页面保留真实“尚未接通”说明）；知识库研究步骤/工具轨迹未实现（本页改为真实“引用与核对”）；每任务成本/耗时/重试仍无 DTO；`ToolsPage` 单工具开关仍无后端。

### 20:18 任务完成 | W1-2（task-8）| 模板可视化编辑 / JSON 编辑 / 归档接线

- 负责人：`fe-templates`；写范围：`apps/web/src/pages/templates/**`。
- 改动文件：`apps/web/src/pages/templates/TemplatesPage.tsx`、新增 `apps/web/src/pages/templates/TemplateEditors.tsx`。
- 可视化编辑器 Modal：编辑模板名称与步骤列表（新增/删除/上移/下移/标题/类型 `implementation|test|delivery`/分组）；保存走 `PATCH /api/catalog/templates/:id`，body `{ requestKey, template, confirmUpdate: true }`，版本自动 +1；成功后刷新 bootstrap、关闭 Modal 并在页头显示回执（status/requestKey/auditId）。
- JSON 编辑器 Modal：预填完整模板 JSON（version = 当前 +1）可编辑；`JSON.parse` 失败在 Modal 内显示错误，非对象顶层拦截；保存走同一 PATCH；成功后刷新并关闭。
- 归档：仅自定义模板显示「归档模板」按钮，二次确认 Modal；`DELETE /api/catalog/templates/:id`，body `{ requestKey, confirmArchive: true }`；成功后清空选中态并刷新目录/历史。当前服务端 DELETE 只返回 `{ templates: [] }`（无 receipt）：UI 明示「服务未返回回执（归档路由暂未签发）；已按模板目录核对」，不伪造成功；前端同时兼容未来 `receipt` 形状（be-api W1-9 若补回执无需再改本页）。
- 导入：`importError` 现在渲染为页头错误 banner；超时/不可用归类为「导入结果未明」并刷新目录核对，不自动重试；成功显示回执。
- 状态处理：保存中禁用表单与按钮；失败回执/HTTP 错误显示服务原因；accepted/unknown 显示 requestKey +「按原请求核对」(`GET /api/operations/:key`)，未知时禁止重发。
- 清理：移除未使用的 `Modal`/`request` 导入，以及 `jsonEditor/jsonError/jsonBusy/visualEditor/visualError/dragIndex/creationSucceeded` 死状态；页面不再有只 setState 不渲染的编辑器状态。
- 验证：`npx tsc -p tsconfig.json --noEmit` 于本任务改动后通过（当前全仓再次被并行任务 `apps/web/src/pages/ppt/PptWorkPanel.tsx` 语法错误、`tests/integration/startup-recovery.test.ts` 类型错误阻断，均非本任务文件）；以仅含 templates 的隔离 tsconfig 复核本页 exit 0；`--noUnusedLocals` 过滤 `pages/templates` 结果为 0；`node --import tsx --test tests/integration/template-import.test.ts` 1 pass；真实服务 `inject` 探针确认 PATCH 返回 `succeeded` receipt 且 `operations.by-key` 带 `outcome.version`，DELETE 200 `{templates:[]}`。
- 未覆盖：按要求未运行 `npm run build:web`、未跑全量 `npm test`；无浏览器点击验证，前端路径以类型检查 + 真实服务契约探针核对。归档回执缺口属后端 W1-9 范围。

### 20:18 任务完成 | W0-3（task-6）| 启动恢复：execution / planning / workspace 不再永久 running

- 负责人：`be-recovery`；写范围：`packages/engine/src/{execution,planning,workspace,engine}.ts`、`packages/server/src/application.ts`、新增 `tests/integration/startup-recovery.test.ts`。未碰 `http.ts`、`shared/contracts.ts`、`delivery.ts`、`apps/web/**`、设计稿、`task-assignment.md`。
- 状态机决策（`machines.ts` 在 shared，不在本任务写范围，故只选合法迁移）：
  - execution 没有 `RUNNING → UNKNOWN` 直连边；按两条合法边组合：`RUNNING --execution.pause--> PAUSING --execution.unknown--> UNKNOWN`（与现有 cancel 用 `RUNNING→STOPPING→STOPPED` 组合同一模式）。
  - 节点 `RUNNING → FAILED`（`node.fail`，error code `INTERRUPTED`），attempt 置 `failed`；若 attempt 已终结但节点未写回（crash 落在两次写之间），以 attempt 的持久状态回填节点，不猜测。
  - planning `RUNNING/STOPPING → UNKNOWN`（`planning.changed`）；`QUEUED → FAILED`（`planning.fail`，从未派发模型）；stage 用 `canTransition(planningStageMachine, stage, UNKNOWN)` 判断，`needs_answer` 无入边则保留原 stage。
  - workspace `PREPARING → UNKNOWN`（`workspace.unknown`）。
- execution：启动扫描 `running/pausing/stopping`（均为上一进程遗留），置 `unknown` + `notice.kind='unknown'`（含核对/重试指引）；accepted 的 `execution.*` 回执按 `target.executionId` 结算为 unknown（`commands.fail(key, error, true)`），`GET /api/operations/:key` 可看到中断原因，不自动重发。`retry`/`skipNode` 允许从 `unknown` 发起（用户显式动作）作为恢复出口；修正 `#recomputeReady` 根节点（无入边）在 retry 后不会重新 ready 的缺陷。
- planning：`running/stopping → unknown`、`queued → failed`；结算 accepted 的 `planning.start/planning.stop`；不调用模型、不新建轮次（测试断言轮次数不变）；任务 attention 由 `computeTaskAttention` 变为 `unknown`，`capabilities.reconcile.allowed=true`、`stopPlanning.allowed=false`（UI 不再显示运行中）。
- workspace：`preparing → unknown`；running 准备步骤 → `failed` 并写入核对建议（同时写入第一个未开始步骤 detail）；**不删除/不修改任何目录或分支**（测试用 marker 文件断言恢复后仍在）；结算 accepted 的 `task.workspace.prepare`。
- engine/application：新增 `Engine.recoverOnStartup()` 汇总三个服务、对受影响任务重算 attention、单条失败收集进 `failures` 不抛出；`createApplication` 在注册 HTTP 路由前调用一次；重复启动/重复调用幂等（第二次扫描为空）。
- 验证命令与结果：
  - `npx tsc -p tsconfig.json --noEmit` → exit 0，0 error。
  - `node --import tsx --test --test-force-exit tests/integration/startup-recovery.test.ts` → 5 tests / 5 pass / 0 fail（execution、workspace、running planning、queued planning + 幂等/无在途 no-op）。
  - 相关回归：`node --import tsx --test --test-force-exit tests/integration/{node-skip,workspace-cleanup-blockers,recovery-api,review-fix-recovery,server-smoke,plan-edit-dependencies}.test.ts` → 8 tests / 8 pass。
- 未覆盖 / 后续（不属本任务写范围）：
  1. 前端 `RecoveryPage` 的 retry/cancel 按钮仍只对 `failed/stopped/paused` 显示；执行恢复为 `unknown` 后 UI 没有恢复按钮。服务端已支持 `retry`/`skipNode` from `unknown`，建议前端把 `unknown` 加入条件（fe agent）。
  2. execution 没有 reconcile 路由，`unknown` 后只能 retry/skip/cancel，「核对确认仍在运行」入口未实现（超出 W0-3）。
  3. workspace `cleaning` 中断、execution `pausing→paused` 正常序不在本次恢复范围。
  4. accepted 回执的极小窗口（副作用已落库、settle 前崩溃且实体已终态）未做二次对账；正常路径 settle 是同步的。
  5. 未跑全量 `npm test`/`build`（Lead 整合范围），未做浏览器点击验证。


- 20:22 补记（fe-templates）：全仓 `npx tsc -p tsconfig.json --noEmit` 在并行任务修复后复跑已 exit 0（0 error）；`--noUnusedLocals` 过滤 `pages/templates` 仍为 0。

### 20:55 任务完成 | W1-11/W1-12（task-10）| fe-cleanup

- 负责人：`design-audit`；写范围：`apps/web/src/pages/requirement/WorkspacePanel.tsx`、`apps/web/src/pages/task/TaskCanvasPage.tsx`、`apps/web/src/pages/delivery/**`、`apps/web/src/pages/git/FixPanel.tsx`、`apps/web/src/api/workflow.ts`；仅追加本日志。
- W1-11 工作区清理 UI（WorkspacePanel）：
  - `api/workflow.ts` 新增 `previewWorkspaceCleanup`（POST cleanup/preview，只读）与 `confirmWorkspaceCleanup`（POST cleanup/confirm，强制 `confirmCleanup:true`，可传入外部 requestKey 以便传输失败后按原 key 核对）。
  - 清理区块：说明删除/保留范围；「清理工作区…」打开预览；预览展示 blockers（服务返回的执行中/规划中/交付中/工作区忙等，含 ref）、将删除对象、保留对象、未交付变更与预览有效期；需勾选确认（requiresUndeliveredAck）；二次确认对话框再列影响后提交。
  - 回执：`ReceiptNotice` 覆盖 accepted/succeeded/failed/unknown；succeeded 后 `useWorkflowRefresh` 重读工作区；unknown 仅按原请求号核对不重发；网络/超时无回执时保留 requestKey，提供「按原请求号核对」，核对未结算前禁用再次清理；明确的 4xx（如 STALE_TARGET / DELIVERY_BLOCKED）按已知失败显示，不误标为待核对。
  - 真实状态：预览/提交各有 loading/error，工作区 cleaned/cleaning/pendingOperationRef 均有明确文案；未伪造清理结果。
- W1-12 交付 no-op 与文案：
  - `TaskCanvasPage` 的「查看变更并交付」改为 `requestDeliveryFocus`：面板未开时打开交付面板；已开时通过递增 `focusChangesRequest` 让 `TaskDeliveryPanel` 滚动到变更区、聚焦首个文件控件并显示“已定位到待交付变更”，不再重复设置同一 URL 参数。面板内同按钮共用该行为。
  - 删除交付面板两处用户可见「（P2）」与 `FixPanel` 的“产品内不提供直接合并”矛盾；按代码现状（本地合并已实现且可独立确认）统一为“可在 GitLab 合并，也可在产品内本地合并（no-ff + CAS，独立确认）”。全前端 `grep "（P2）"` 为空。
  - 本轮范围内补 disabledReason：WorkspacePanel（清理/核对/对话框按钮）、TaskCanvasPage（计划/暂停/继续 busy 原因）、DeliveryFileSelect（全选/全不选）、DeliveryApplyPreview（预览/重检/应用 pending）、TaskDeliveryPanel（选择/提交/推送/MR/合并 pending）、FixPanel（开始/停止/撤销/提交/推送/MR/合并/放弃 pending）。
- 验证：`npx tsc -p tsconfig.json --noEmit` exit 0（0 error）；上述 7 个改动文件 scoped tsc exit 0；`--noUnusedLocals --noUnusedParameters` 过滤 7 文件为 0；`grep -rn "（P2）" apps/web/src` 为空；未运行 `build:web`（Lead 并发约束），未跑全量 `npm test`。
- 未覆盖/建议 Lead 验收：需真实服务上走一次 workspace cleanup preview→confirm（含 blockers 与 unknown/网络中断）和任务画布「查看变更并交付」的滚动聚焦；本次未做浏览器手工点击与真实服务探针（本地 5177 未运行）。

### 20:26 任务完成 | W0-1/W0-2/W0-5/W1-9/W1-10（task-5）| be-api

- 负责人：`be-api`；写范围：`packages/server/src/http.ts`、`packages/shared/src/api/contracts.ts`、`packages/engine/src/delivery.ts`、`apps/web/src/api/endpoints.ts`、`apps/web/src/main.tsx`、新增 `tests/integration/api-contract.test.ts` 与 `tests/integration/routes-contract.test.ts`；未碰 execution/planning/workspace/engine.ts/application.ts、`apps/web/src/pages/**`、设计稿与 `task-assignment.md`。
- W0-1 回执形状：
  - `POST /api/opencode/restart` 改为 `engine.commands.begin/settle/fail` + `requestKey`，响应 `{receipt, resource:{status}}`；强制 `confirmRestart:true`；重放已结算请求返回原回执且不会再次重启进程；失败把回执结算为 failed 后抛错。
  - `POST /api/git/repos/:projectId/fetch` 从 body 读 `requestKey`/`remote`/`projectId`（与路径不一致 400），登记 `git.fetch` 操作，响应 `{receipt, resource:{fetchedAt,remote}}`；失败结算 failed；重放返回 outcome.fetchedAt。
  - `apps/web/src/api/endpoints.ts` 的 `restartOpenCode()` 改为 `OpenCodeRestartResponse`（`CommandResponse<{status}>`）；`main.tsx` 增加最小 ErrorBoundary（渲染期异常显示可重新加载的错误页，不再白屏）。
- W0-2 SPA 兜底：`/*` 命中 `api`/`api/*` 时返回与 notFoundHandler 一致的 JSON 404（code NOT_FOUND/requestId/at/retryable:false）；静态文件、`/assets/*` 与非 `/api` 深链回退保持不变。
- W0-5 硬编码状态：
  - `output.terminal` 用真实 node/attempt 终态（succeeded/failed/skipped/cancelled/unknown 为 true；running/pending/无执行 false）。
  - `/api/opencode/status` 的 `mcp.tools` 不再硬编码 13：MCP 诊断未连接为 0，连接时按 `opencode.toolsets` 汇总 `MCP_TOOL_COUNTS_BY_TOOLSET`（新增于 shared contracts）；契约测试逐 toolset 比对 `packages/mcp` 的 `MANAGED_TOOL_NAMES`，drift 会失败。
  - `/api/bootstrap` 的 `integration.database.connected` 改为 `DatabaseService.list()` 中真实 `connected` 状态计数（未 probe 的连接保持 not_configured；bootstrap 不主动开 socket）。
  - workspace/execution/delivery 视图的 `actions` 不再恒 `{}`：返回 `engine.tasks.detail(taskId).capabilities`，与 `/detail` 的能力投影同源。
- W1-9 回执覆盖与健壮性：
  - 新增 HTTP 层 `preValidation` hook + `COMMAND_ROUTE_SIGNATURES`：45 条 CommandRequest 类路由缺 `requestKey` 统一 400 `VALIDATION_FAILED`（不再落到 `CommandService.begin` 变 500），覆盖 PATCH settings、POST databases、POST settings/gitlab、POST restart、POST fetch、DELETE templates 等。
  - `PATCH /api/settings` 登记 `settings.update` 回执（response 同时保留顶层 settings/issues/catalog 兼容旧页面）；`POST /api/settings/databases` 登记 `settings.update`（回执+connection）；`DELETE /api/settings/databases/:id` 也登记回执（旧页面不发 body 时服务端生成 req_ key，body 带 key 时回显）；`POST /api/settings/gitlab` 登记 `secret.save`（bodyHash 不含 token，响应不回显 token）；`POST /api/settings/gitlab/test` 明确非变更语义（`mutating:false`，不登记操作）；`DELETE /api/catalog/templates/:id` 登记 `catalog.template.archive` 回执并强制 `confirmArchive:true`（fe-templates 页面已兼容 receipt 形状，现在能走 receipt 分支）。
  - `engine/delivery.ts` 的 `commit/push/createMergeRequest/merge` 运行时校验 `confirmCommit/confirmPush/confirmMergeRequest/confirmMerge === true`，缺失返回 `VALIDATION_FAILED`（在任何状态读取/变更之前）。
- W1-10 ROUTES 同步：shared `ROUTES` 补 7 条 fix 子路由（diff/stop/commit/push/merge-request/discard/files/:fileId/revert）、`settingsGit`、`databaseConnection(id)`、`pptWorkPptx`；删除重复 fixMerge 定义。
  - 契约快照测试从 ROUTES（函数用占位参数）生成路径集合，与 Fastify `printRoutes` 注册集合按 `*` 归一化后双向比对；3 条死 ROUTES（planEditAbandon/executionAdvance/gitMergeRequest）在 `ROUTES_ONLY_EXCEPTIONS` 明确标注 W2-1/W2-2/待定；网关 `ALL /api/opencode/gateway/:secret/v1/*` 作为 `SERVER_ONLY_EXCEPTIONS` 说明（每次启动随机 secret，仅受管进程使用，并额外用 `findRoute` 断言真实注册）。
- 验证命令与结果：
  - `npx tsc -p tsconfig.json --noEmit` → exit 0，0 error。
  - `node --import tsx --test --test-force-exit tests/integration/api-contract.test.ts tests/integration/routes-contract.test.ts` → 9 tests / 9 pass / 0 fail。
  - 回归（均 pass）：server-smoke、settings-monitoring、database-delete、delivery-mr、gitlab-mr、opencode-logs、task-acceptance、template-import、template-history、git-api、git-push、node-skip、plan-edit-dependencies、recovery-api、roles-api、insights、project-recheck、project-archive、delivery-fixroot、review-fix-api、review-fix-recovery、review-compare、review-projection、concurrent-worktrees、workspace-cleanup-blockers、ppt-works、knowledge-sources、fs-directories、directory-apply-api、directory-apply-e2e。
  - 运行中 dev server（127.0.0.1:5177，--watch 已热加载）实测：`GET /api/not-a-real-route` 与 3 条死 ROUTES → `404 application/json`；`GET /` → `200 text/html`；`PATCH /api/settings`、`POST /api/git/repos/x/fetch`、`POST /api/opencode/restart`、`DELETE /api/catalog/templates/:id` 缺 requestKey → `400 VALIDATION_FAILED`；`/api/opencode/status` mcp.tools=13（4 toolsets 全启用且 MCP connected）；`/api/bootstrap` database 为 `configured:1, connected:0`（真实状态）。
- 未覆盖 / 说明：
  1. restart 成功路径用「真实 Fastify+registerRoutes+真实 Engine/Store，注入假受管适配器」的集成测试覆盖；未启动真实 managed OpenCode（避免占用端口/进程），真实进程重启由 Lead 全量/e2e 验收。真实服务下 restart 失败路径与 400/503 已由同一路由逻辑覆盖。
  2. `mcp.tools` 用「已启用 toolset 的注册工具数」镜像表 + MCP 连接诊断门控，未调用 OpenCode `/experimental/tool/ids`（`OpenCodeAdapter` 未暴露 client，属写范围外）；镜像表有跨包契约测试防漂移。
  3. `DELETE /api/settings/databases/:id` 为兼容当前 DatabasesPage（不发 body）在缺 requestKey 时生成服务端键并返回回执；其余 CommandRequest 类路由已强制 400，W2-9 可把该条也收口为强制 400（需前端同批发送 requestKey）。
  4. `POST /api/ppt/*`、review/fix、directory-apply 路由已有各自插件级 requestKey 校验，未纳入统一 hook（避免与并发前端/其他 agent 写范围冲突）；`POST /api/settings/gitlab/test` 的 `testConnection` 会写连接验证状态缓存，但不变更配置，按非变更语义记录。
  5. ErrorBoundary 仅有类型检查覆盖（仓库无 DOM 测试基建），按要求未运行 `npm run build:web` 与全量 `npm test`（Lead 整合范围）。

### 20:24 任务完成 | W1-1（task-7）| PPT 页完整闭环：作品 / 附件 / 生成 / 编辑 / 导出 / 删除

- 负责人：`fe-ppt`；写范围：`apps/web/src/pages/ppt/**`；未改 api 客户端、其他页面、后端、shared、设计稿。
- 改动文件：重写 `apps/web/src/pages/ppt/PptPage.tsx`（666 行）；新增 `apps/web/src/pages/ppt/PptWorkPanel.tsx`、`apps/web/src/pages/ppt/ppt-shared.tsx`、`apps/web/src/pages/ppt/ppt.css`。
- 作品列表：`GET /api/ppt/works` 渲染「最近演示」（前 3 张带真实数据缩略预览：有逐页取第 1 页要点，否则取前 3 条大纲，再否则「尚无大纲」）+「全部作品」列表；展示标题、主题、状态徽标（草稿/生成中/已生成/失败）、大纲条数/逐页页数、附件数、更新时间、项目与主题；点击选中（`aria-pressed`），选中作品不在列表时显示提示并可清除选择。loading（骨架）/empty（EmptyState）/error（ServiceNotice+重试）/unknown（回执未知）齐全；有 `generating` 作品时列表每 5 秒刷新。
- 创建：项目可选（不选也能创建，文案说明生成时不读项目资料）、主题、版式主题；标题取主题前 40 字；创建成功刷新列表并按 `receipt.outcome.workId` 选中新作品。
- 选中后操作全部真实接线：
  - 生成大纲 `POST /:id/generate`（模型，timout 120s）；生成逐页 `POST /:id/generate-slides`（150s）；均显示「正在…可能较慢」，并常驻「模型调用可能较慢」提示；大纲为空时逐页按钮禁用并写明服务前置条件。
  - 编辑标题/主题/大纲/主题色 `PATCH /:id`（每行一页大纲，本地预检空标题/长度/40 条上限，服务消息仍会展示在弹窗内）。
  - 附件：文本（textarea）与图片（file → data URL，PNG/JPEG/WebP，>2MB 预检）添加 `POST /:id/attachments`、移除 `DELETE /:id/attachments/:name`；显示类型/大小/添加时间/图片缩略图/文本摘要；10 个上限与同名拒绝说明。
  - 删除作品 `DELETE /:id`（二次确认，成功后清空选中）；生成中允许删除（服务不会复活记录），其他写操作在生成中禁用并给原因，避免用旧快照覆盖。
  - 导出 PPTX：直接 `fetch /:id/pptx`（二进制非 envelope），校验响应后 blob 下载，成功显示文件名/大小/zip 事实；失败显示服务错误 JSON 的 message。导出 Markdown：`GET /:id/export` 返回 `{filename, content}`，弹窗预览服务原文 + 下载 .md。
- 回执与 unknown：所有写命令（create/attach/detach/update/generate/generate-slides/delete）走统一 `executePptCommand`，展示服务返回的 accepted/succeeded/failed/unknown；HTTP 4xx/5xx 显示服务 `error.message`；网络超时/不可用归类为 unknown，保留客户端 requestKey 供 `GET /api/operations/:key` 核对，**不自动重发**；服务端自造请求号的 detach/delete 无号码时明确提示只能按作品列表读口核对；失败/未知说明同时显示在对应表单内（编辑弹窗、附件表单、删除确认）。
- 清理：删除「仅草稿」「未接通」「当前输入不会发送」「需要先接通」与 `PendingBackendNotice`；删除附件假禁用；底部三步卡改为真实流程（创建→生成/手写大纲→逐页与导出）；无硬编码颜色（`grep -E "#[0-9a-f]{3,6}|rgba?\\("` 为空），只用设计令牌。
- 验证命令与结果：
  - `npx tsc -p tsconfig.json --noEmit` → exit 0（0 error）。
  - `npx tsc -p tsconfig.json --noEmit --noUnusedLocals` 过滤 `apps/web/src/pages/ppt` → 0 条（原 15 条未使用全部消除）。
  - 真实 HTTP 全链路（临时独立数据目录 + 真实服务进程 5199，OpenCode 关闭）：create → list → PATCH（标题/4 条大纲/主题）→ attach 文本 → export Markdown（含大纲）→ export PPTX（HTTP 200、`presentationml`、65,826 B、`PK`）→ detach → delete → list 空；generate/generate-slides 返回 `OPENCODE_NOT_READY` 与中文 message（前端 catch 即展示该服务消息）；`GET /api/operations/:key` 形状为 `{operation, stillUnknown}` 且 `outcome.workId` 可用。
  - 真实页面 UI 冒烟（Electron offscreen 加载真实 Vite dev `http://127.0.0.1:5173/ppt` + 真实服务 5177）：44 项断言全部 PASS —— 页面渲染/无陈旧文案/创建 succeeded 回执/自动选中/编辑弹窗保存 succeeded/文本附件添加+移除 succeeded/Markdown 弹窗显示服务原文并下载/PPTX 真实下载落盘且 zip 魔数正确（65,839 B）/删除 succeeded 并回到空态；测试作品在真实服务工作区留下 0 条。
  - `node --import tsx --test --test-force-exit tests/integration/ppt-works.test.ts` → 1 test / 1 pass。
  - 未运行 `npm run build:web`（Lead 并发约束）与全量 `npm test`。
- 未覆盖 / 已知限制：
  1. 生成大纲/逐页的**模型成功路径**未在浏览器点击（避免真实模型消耗）；已用同请求体在临时服务验证错误回执形状、并依赖既有 `ppt-live.test.ts`（需 `AGENT_WORKFLOW_LIVE=1`）覆盖成功路径，建议 Lead 在真实服务上点一次生成确认。
  2. 服务端没有 PPT `generating` 状态的重启恢复：进程崩溃后作品可能永久停在「生成中」。页面如实显示该状态并禁用写操作（删除仍可用），但无法自愈，需后端补恢复（不在本任务写范围）。
  3. 回执 accepted/unknown 的真实触发依赖网络中断/服务延迟，本次只做了代码路径核对（核对按钮、禁止自动重发），未构造线上故障。
  4. 图片附件以 data URL 存入 SQLite，3 MB 上限；未做大图压缩或文件拖拽上传。

### 20:32 整合 | Wave 0 + Wave 1 验收通过

- **验收范围**：W0-1、W0-2、W0-3、W0-5、W1-1、W1-2、W1-3~W1-8、W1-9、W1-10、W1-11、W1-12（共 15 个工作包）。W0-4 节点验收仍为下一波。
- **类型检查**：`npx tsc -p tsconfig.json --noEmit` → exit 0。
- **全量测试**：`npm test` → **330 tests / 54 suites / 319 pass / 11 skipped / 0 fail**（43.8s）。
- **构建**：`npm run build:web` → exit 0（1.88s）；`npm run build:server` → exit 0。
- **运行态验收（5177 真实服务）**：
  - 未知 `GET /api/not-a-real-route` 与 3 条死 ROUTES（`execution/advance`、`plan/edit/abandon`、`merge-requests/:iid`）→ **404 JSON**；`GET /` 仍 200 HTML。
  - 缺 requestKey 的 `POST /api/tasks` → **400 VALIDATION_FAILED**。
  - `POST /api/opencode/restart`（confirmRestart=true）→ **200 `{receipt, resource}`**，receipt `succeeded`，`GET /api/operations/req_audit_restart_2` 可核对；重启后 OpenCode `ready`、MCP `tools=13`。
  - `GET /api/bootstrap` 的 `database {configured:1, connected:0}` 来自真实连接状态（未硬编码 0）；未知任务视图返回 404 JSON。
  - `GET /api/git/repos/:id/fetch` 带 requestKey 会签发 accepted 回执；本机 GitHub 网络在 60s 内未完成，客户端超时后 by-key 正确显示 `accepted/stillUnknown`（真实网络限制，非契约失败；本地 bare remote 成功路径由集成测试覆盖）。
- **UI 冒烟**：`npm run ui:smoke` 在当前沙箱环境因 Electron GPU/sandbox 初始化失败（`GPU process isn't usable`）未执行成功，**未计为通过**；前端构建与类型检查通过，UI 验证留到 Wave 4（或用户在桌面环境执行）。
- **范围审计**：`git status` 无设计稿目录改动；无凭据写入；`git diff --check` 通过；改动 27 文件 + 5 新增文件（PPT 3、模板编辑器 1、测试 3、文档）。
- **遗留/新登记**：W0-4（节点验收）、W2-10（恢复页 unknown UI）、W2-11（PPT generating 恢复）、W2-12（远端超时/UNKNOWN）、W2-13（viewActions 回归）；Wave 2-4 见任务分派文档。

### 20:35 分派 | Wave 2

- 复用现有 5 个 agent（不新增成员）：
  - `be-api` → task-11：W2-1 自动推进开关 / W2-2 放弃调整 / W2-9 健壮性 / W2-13 viewActions 回归。
  - `be-recovery` → task-12：W2-3 非 Git 清理、W2-4 恢复模式真实化、W2-11 PPT generating 恢复。
  - `fe-templates` → task-13：W2-1/W2-2/W2-10 前端 UI（自动推进/推进一步/放弃调整/unknown 恢复）。
  - `fe-ppt` → task-14：W3-7a 知识对话记录页（设计缺失页）。
  - `docs-audit` → task-15：W4-1a 文档同步（README/remaining-work/verification/architecture）。
- 契约由 be-api 与 fe-templates 共用：`/execution/auto-advance`、`/execution/advance`、`/plan/edit/abandon`；冲突先由 Lead 裁决。
- 验收仍是：typecheck + 全量测试 + build，每波结束记录；设计稿只读。

### 20:38 任务完成 | W4-1a（task-15）| README / remaining-work / verification / architecture 同步 Wave 0/1

- 负责人：`docs-audit`；写范围：`README.md`、`docs/remaining-work.md`、`docs/verification.md`、`docs/architecture.md`；未改 `docs/review/**`（仅本日志）、`docs/task-assignment.md`、`docs/design-coverage.md`、产品代码、设计稿。
- README：实现状态改为 Wave 0/1 完成后（330 tests / 54 suites / 319 pass / 11 skipped / 0 fail，约 44s，`.tmp/final-verify.log`）；重写「未完成 / 下一步」为真实剩余（W0-4、Wave 2 进行中、W3 设计缺失页、真实外部环境、打包、视觉回归、文档体系）；修正「GitHub 真实写 PASS」与「真实远端写未执行」的矛盾，GitLab 单独标注仅桩验证；数据库行补 PostgreSQL，MCP 行改「默认 13 工具、按启用工具集计数」；界面证据标注 `docs/evidence/` 早于 Wave 0/1、UI smoke 沙箱失败。
- remaining-work：迁移改为 v1–v10；模板编辑器从「缺口」移入「已实现」（可视化 + JSON + 归档，W1-2）；Skill 源文 / 并发会话 / 角色历史移入已实现；缺口重排 1–10，补 W0-4、W2-1~13（明确「进行中」）、W3 设计缺失页（knowledge-history / ppt-works / ppt-studio / run / roles-legacy）、Inbox、角色四页签、项目详情、PE37、工作流编辑器、快照评审、运行内容、真实 GitLab/PostgreSQL、打包、视觉回归、文档体系、PPT 高级视觉、恢复深度；删除重复「10.」与「缺口已关闭」。
- verification：计数改为 330/54/319/11/0（约 44s）并注明「以最近一次 `npm test` 日志为准」；11 项 skip 合并为「10 live + 1 凭据」；原 §3.2 GitHub 块移到 §3.10，新增 §11 轮次日志标题；重写 §10 的 GitHub / fix.merge / FixRun / 清理 / 打包 / 视觉 / 节点验收条目；追加 Wave 0/1 验收记录（404、400、restart/fetch 回执、契约快照、启动恢复、build）。
- architecture：补 PostgreSQL 驱动、非 Git 目录副本已实现、未知 `/api/*` JSON 404、启动恢复、restart/fetch/数据库等命令返回 `CommandResponse`、MCP 按工具集计数。
- 验证：4 个文件不再命中 `313 / 302 pass / 296 条 / 第 15 轮 / 缺口已关闭 / v1–v7`；引用目标均存在；`git status` 无设计稿目录改动；未跑全量 test（仅文档改动，Lead 已完成 330 tests 验收）。
- 未覆盖：`docs/design-coverage.md` 重写（W4-1）与 `docs/api.md` 重生成（W4-2）；Wave 2 进行中条目待完成后再迁入「已实现」。

### 20:35 任务完成 | W2-3/W2-4/W2-11（task-12）| 非 Git 清理、恢复模式真实化、PPT 生成恢复

- 负责人：`be-recovery`；写范围：`packages/engine/src/workspace.ts`、`recovery.ts`、`ppt.ts`、`engine.ts`；新增 `tests/integration/workspace-cleanup-nongit.test.ts`、`recovery-modes.test.ts`、`ppt-startup-recovery.test.ts`，并更新上轮自建 `startup-recovery.test.ts`（summary 增加 `pptWorks`）。未改 `http.ts`、`shared`、`execution.ts`、`plan.ts`、`apps/web/**`、设计稿、`task-assignment.md`。
- **W2-3 非 Git 工作区清理（真实删除）**：
  - `cleanupConfirm` 对 `kind=directory_copy`：置 `cleaning`（retention cleaning）→ 真正 `rmSync` 删除 `dataDir/workspaces/<taskId>` 与 `dataDir/baselines/<workspaceId>`（含 settings 记录中的 baselineRoot）→ `DELETE FROM settings WHERE key='directory.baseline.<workspaceId>'` → 置 `cleaned`；receipt outcome 带 `removed` 列表、`kind`。Git worktree 路径保持原 `removeWorktree`，但同样先置 `cleaning`。
  - 路径安全：只允许 `dataDir/workspaces/*`、`dataDir/baselines/*`（`resolve+sep` 前缀校验）；拒绝等于/包含项目原目录或位于项目原目录内的路径；不安全路径在 preview 中给 `workspace_unmanaged` blocker、confirm 返回 `DELIVERY_BLOCKED`，项目原目录永不删除；其他任务的 baseline 不受影响（有测试）。
  - 失败可重试：清理开始后失败 → 恢复原状态并置 `retention='partial'`、结算回执 failed（不伪造 cleaned）；失败后可重新 preview/confirm。**删除了上轮「假清理」**（旧实现非 Git 只置 cleaned 不删目录）。
  - 补充清理中断恢复：启动扫描 `cleaning` 工作区 → `partial`（合法 `workspace.cleanup.partial`）+ `retention=partial` + 核对建议，accepted 的 `cleanup.confirm` 回执结算 unknown；不自动删目录。
  - 说明：`SettingsRepository` 无删除 API 且 `packages/storage` 不在本任务写范围，settings 键用 `store.db.prepare('DELETE ...')` 直接删除（已在代码注释标注，建议后续在 storage 补 `removeJson`）。
- **W2-4 恢复三种模式真实语义**（派生草稿字段差异，非只改标题；不复制/创建 plan、workspace、execution）：
  - 共同：复制项目/需求原文/方法（`methodId`+冻结 `methodRevision`）与 `fixedTemplate`；派生任务 `stage=draft`（需求阶段）；两任务互不影响，父任务与执行证据只读不变。
  - `from_failed_stage`：复制父任务已有 requirement supplements（既有答复/判断）与 entries，revision=父修订+1，并追加 `恢复上下文（从失败阶段恢复）` 补充，写明失败/未知步骤与 error code/message、执行状态与进度、失败规划轮次、交付投影、人工验收；下一次规划的 prompt（planning 会带 supplements）能读到失败阶段上下文 → 「保留既有上下文」真实生效；attention=none。
  - `all_stages`：只复制需求原文+方法/模板，不继承任何 supplements/答复/执行证据，revision=1 → 从需求阶段完整重来；attention=none。
  - `verify_only`：只读验证草稿。前置条件：父任务必须有已结算的执行 attempt，否则 400 VALIDATION_FAILED（没有可核对产物不能做只读验证）。复制需求原文+既有 supplements/entries，追加 `只读验证范围` 补充：声明不创建计划/工作区/执行、不修改文件，并枚举父任务的尝试/验证结论/失败节点/交付与验收事实，供人工核对；attention=`waiting_user`；服务不创建任何 plan/workspace/execution（测试断言三者均无）。**已知缺口（未伪造）**：把「只读」做成强制约束需要 `Task` 增加只读/恢复模式字段并在 `actions.ts`、`plan.ts`、`planning.ts`、`execution.ts` 里校验，这些文件均不在本任务写范围且 shared 归 be-api 并行；本次只落实可表达且可辩护的部分（只读范围写入需求、等待人工处理、无任何可执行记录），建议 Lead 转 W2-4b 由 be-api 补契约。
  - 记录：settings `task.recovery.<id>` 额外写 `writableSession`、`copiedScope`、`parentStage`、`parentAttention`（审计用，HTTP 契约仍只暴露 `RecoveryRecord`）。
- **W2-11 PPT generating 启动恢复**：新增 `PptService.recoverOnStartup()`，由 `Engine.recoverOnStartup()` 调用（`summary.pptWorks`）。扫描 `status=generating` → `failed`（PPT 四态中的合法终态，UI 可重新生成），保留已生成 outline/slides 供重试；`PptWork` 契约无 notice/error 字段，故中断信息写入 `ppt.recovery.<workId>` 审计键 + 结算 accepted 的 `ppt.work.generate`/`ppt.work.slides` 回执为 unknown（by-key 可核对）；不调用模型、不重新生成。幂等：二次启动无 generating。
- **幂等/异常**：`Engine.recoverOnStartup()` 对每个恢复域独立 try/catch，失败进 `failures` 不抛出、不阻塞启动；`createApplication` 已在注册路由前调用。新增场景均验证「第二次启动/第二次调用无变化、不抛错」。
- 验证命令与结果：
  - `npx tsc -p tsconfig.json --noEmit` → exit 0（0 error，含并行 agent 改动）。
  - `node --import tsx --test --test-force-exit tests/integration/workspace-cleanup-nongit.test.ts` → 5 pass / 0 fail（真实删除+settings 键+幂等、越界拒绝+重试、清理中断恢复、其他 baseline 保留、文件系统失败回执 failed+状态可重试）。
  - `node --import tsx --test --test-force-exit tests/integration/recovery-modes.test.ts tests/integration/ppt-startup-recovery.test.ts` → 5 pass / 0 fail（三模式字段/attention/actions 差异、verify_only 前置、requestKey 幂等、进行中父任务拒绝、PPT 中断恢复+回执+重试入口+幂等）。
  - 回归：`node --import tsx --test --test-force-exit tests/integration/{recovery-api,workspace-cleanup-blockers,startup-recovery,directory-apply-api,directory-apply-e2e,ppt-works}.test.ts` → 13 pass / 0 fail。
- 未覆盖 / 说明：
  1. verify_only 的硬性只读强制（见上）需 shared `Task` 契约 + actions/plan/planning/execution 协作；本次未越权修改。
  2. 恢复不复制执行上下文/阶段图（文档承认缺口），本任务按「需求上下文 + 失败证据 + 派生草稿字段」实现真实差异。
  3. 文件系统失败场景用只读父目录构造（非 root）；root 环境会 skip 该测试。
  4. 未跑全量 `npm test`/build（Lead 整合），未做浏览器点击。

### 20:36 任务完成 | W3-7a（task-14）| 知识对话记录页（设计缺失页）

- 负责人：`fe-ppt`；写范围：新增 `apps/web/src/pages/knowledge-history/**`、`apps/web/src/app/App.tsx`、`apps/web/src/pages/knowledge/KnowledgePage.tsx`；未改后端/shared/其他页面/导航配置/设计稿。
- 新增文件：`apps/web/src/pages/knowledge-history/KnowledgeHistoryPage.tsx`、`apps/web/src/pages/knowledge-history/knowledge-history.css`；路由 `/knowledge/history`（`App.tsx` 仅加 1 条 import 与 1 条 Route，未动其他路由）。
- 页面结构：PageHeader（eyebrow 链接回知识库 + 返回/新建对话）→ 降级说明 banner → 工具条（搜索问题/回答、项目下拉含「全部项目」、引用分段、条数、刷新）→ 今天/昨天/更早时间分组列表 → 行内展开；复用 Badge/Button/LinkButton/PageHeader/EmptyState/Skeleton/Icon/SegmentedControl/ServiceNotice，样式只用设计令牌（新增 CSS 无硬编码颜色，`grep -E "#[0-9a-f]{3,6}|rgba?\("` 为空）。
- 数据与降级口径：使用 `GET /api/knowledge/history?projectId=`（每个项目独立请求后按项目合并，全部项目并行读取；失败项目单独展示 ServiceNotice，不用缓存/示例补齐）。服务端只返回已生成的问答、**没有会话状态字段**，因此设计中的「需要回答/进行中/已完成」不做实现：分段降级为 **全部 / 有引用 / 无引用**，并在页面 banner 明确写出「没有『需要回答 / 进行中 / 已完成』的会话状态字段」及「有引用/无引用」的定义；不显示任何虚构的待回答/进行中状态。
- 交互事实：搜索按 question/answer 文本过滤并高亮首处匹配；时间分组按 generatedAt（今天/昨天/更早）；行内展开显示完整问题、回答、模型、生成时间（绝对+相对）、usage tokens、conversationId 与引用列表；引用点击回跳 `/knowledge?project=<id>&source=<path>`；「继续追问」回跳 `/knowledge?project=<id>&conversation=<conversationId>`（服务 ask 接口支持该 conversationId，KnowledgePage 据此延续上下文）。页面底部说明记录接口、30 条上限与「无重命名/归档/删除接口，故不显示这些操作」。
- KnowledgePage 改动（保持最小）：历史卡头新增「查看全部」按钮（携带当前 projectId 跳 `/knowledge/history?project=`）；新增一个 effect 读取并消费 `?project=` / `?source=` / `?conversation=` 三个查询参数（选中项目、打开来源原文、延续对话），消费后 `replace` 清空 URL 参数；未改问答/搜索/来源逻辑。
- 状态：bootstrap loading（骨架）、无项目（EmptyState + 去登记项目）、历史读取中（骨架）、项目级读取失败（ServiceNotice + 重试）、空记录（EmptyState + 去提问）、筛选无结果（EmptyState + 清除筛选）、服务不可用（ServiceNotice「服务未连接」且不展示记录）；真实浏览器冒烟确认服务停止后无伪造数据。
- 验证命令与结果：
  - `npx tsc -p tsconfig.json --noEmit` → exit 0（0 error）。
  - `npx tsc -p tsconfig.json --noEmit --noUnusedLocals` 过滤 `knowledge-history`/`pages/knowledge/KnowledgePage`/`app/App` → 0 条。
  - 隔离端到端 UI 冒烟（临时 dataDir 写入 3 个项目 / 5 条记录夹具 + 真实服务进程 5199 + 临时 Vite 5280 代理；Electron offscreen）：33 项断言全 PASS —— 5 条记录、时间分组 3/1/1、分段计数 全部5/有引用3/无引用2、搜索过滤+高亮+计数同步、无引用分段空态与清除筛选、展开详情/引用链接/继续追问链接、项目筛选与空项目空态、知识库「查看全部」→按项目筛选、`?project=` 预设并清空 URL、引用回跳知识库打开原文弹窗并选中项目、停服后显示真实错误态且 0 条记录。临时 Vite 配置在使用后已删除，仓库无残留。
  - 真实运行服务（Vite 5173 + 服务 5177）路由冒烟：页面渲染真实 3 条历史记录（真实问题/回答/12·4·8 处引用/模型），知识库历史卡「查看全部」存在；5 项断言 PASS，未写入任何数据。
  - 按约束未运行 `npm run build:web`、未跑全量 `npm test`。
- 未覆盖 / 已知限制：
  1. 会话状态（需要回答/进行中/已完成/停止/中断）无 DTO，本页按任务要求降级并显式标注；需要后端补知识会话模型后才能实现设计稿状态分段与「去回答」。
  2. 无对话重命名/归档/删除接口，本页不提供这些操作（design 行菜单未实现）。
  3. 「继续追问」只恢复 conversationId，不还原当时的问题/回答上下文界面；服务端会取该对话最近 3 条记录作为模型上下文，但页面不回显旧消息。
  4. 全项目视图按项目并行读取（项目数 × 1 请求）；项目很多时首屏请求数线性增长，未做分页/懒加载。
  5. 顶部 Shell 面包屑仍显示「知识库」（`app/navigation.ts` 不在本任务写范围），页面内已用 eyebrow 链接回知识库；如需面包屑「知识库 / 对话记录」需另开任务改 navigation。

### 20:37 任务完成 | W2-1/W2-2/W2-10（task-13）| 执行控制前端 UI

- 负责人：`fe-templates`；写范围：`apps/web/src/pages/task/**`、`apps/web/src/pages/recovery/**`、`apps/web/src/api/workflow.ts`。
- 改动文件：`api/workflow.ts`、`pages/task/TaskCanvasPage.tsx`、`pages/task/ExecutionPanel.tsx`、`pages/task/PlanEditPanel.tsx`、`pages/task/task.css`、`pages/recovery/RecoveryPage.tsx`。
- 自动推进（W2-1）：ExecutionPanel 的只读 switch 改为真实开关，调用 `POST /api/tasks/:id/execution/auto-advance`（shared `ExecutionAutoAdvanceRequest`，`requestKey + autoAdvance + confirmChange:true`），读 `CommandResponse<ExecutionResponse>` 回执；允许状态按后端契约 running/pausing/paused/waiting_confirmation/unknown/failed，调整会话活跃时禁用并写原因；关闭文案明确“只影响后续领取，运行中步骤继续跑完”。
- 手动推进（W2-1）：自动推进关闭后显示「整体推进 · 将启动 N 步」（无 nodeId）与节点行内「推进直接后继 · N 步」（带 nodeId），调用 `POST /api/tasks/:id/execution/advance`；可推进集合按 `plan.graph.edges + execution.nodes`（pending/ready 且全部前置 succeeded/skipped）本地推导用于禁用原因（并行汇合、无后继、用户暂停需先继续、unknown 需先核对等）；成功后用 `receipt.outcome.released` 显示“已放行 N 步”，失败/unknown 走现有 CommandErrorNotice/ReceiptNotice（unknown 只按原请求号核对）。
- 放弃调整（W2-2）：PlanEditPanel 增加「放弃调整」二次确认 Modal，调用 `POST /api/tasks/:id/plan/edit/abandon`（shared `PlanEditAbandonRequest`）；文案写明丢弃本地草稿、计划修订不变、恢复进入调整前的自动推进与暂停设置；仅 editing/conflict 可放弃，`saved`（已生成未确认修订）按后端契约禁用并写原因；成功后刷新任务详情/计划、退出调整面板并在页面显示回执。
- 恢复页 unknown（W2-10）：RecoveryPage 在 execution.status=unknown 时显示「按原配置重试失败步骤」「跳过节点及下游」「取消执行（保留工作区）」+「重新读取」；调用现有 retry/skip/cancel API；回执 succeeded/failed/accepted-unknown 分别显示，unknown 明示“结果待核对、不自动重发、按原请求号核对”。
- 越界说明：设计中的「推进直接后继」节点详情入口位于 `pages/node/NodeDetailPanel.tsx`（不在本任务写范围，Lead 已确认留给 W3-5）；本波入口放在 ExecutionPanel 节点行，带 nodeId 与禁用原因。
- 验证：`npx tsc -p tsconfig.json --noEmit` → exit 0；`--noUnusedLocals` 过滤 `pages/task|pages/recovery|api/workflow` → 0；`node --import tsx --test tests/integration/routes-contract.test.ts` → 2 pass；隔离服务 inject 探针确认三条新路由已注册（未知任务 404 `任务不存在`，缺 requestKey 400 `VALIDATION_FAILED`）。be-api 的 `tests/integration/execution-control.test.ts` 仍有红（同一 key 不同 body 期望 409 实际 400 等后端契约细节），属 be-api/task-11 范围，不影响前端类型与接线。
- 未覆盖：按要求未运行 `npm run build:web`、未跑全量 `npm test`；无浏览器点击验证（本环境 UI smoke 不可用），前端行为以类型检查 + 后端契约代码/探针核对。

### 20:38 任务完成 | W2-1/W2-2/W2-9/W2-13（task-11）| be-api

- 负责人：`be-api`；写范围：`packages/shared/src/api/contracts.ts`、`packages/shared/src/domain/enums.ts`、`packages/engine/src/execution.ts`、`packages/engine/src/plan.ts`、`packages/server/src/http.ts`、新增 `tests/integration/execution-control.test.ts`，并更新 `tests/integration/routes-contract.test.ts`；未改 `apps/web/**`、engine/workspace|ppt|recovery、application.ts、设计稿、`task-assignment.md`。
- 统一契约（已同步 fe-templates，task-13 前端按此实现）：
  - `POST /api/tasks/:id/execution/auto-advance`，body `{requestKey, autoAdvance:boolean, confirmChange:true}`，`ROUTES.executionAutoAdvance`，operation `execution.autoAdvance`（新增于 enums/OPERATIONS），返回 `CommandResponse<ExecutionResponse>`；允许状态 running/pausing/paused/waiting_confirmation/unknown/failed；调整会话活跃 → 409。
  - `POST /api/tasks/:id/execution/advance`，body `{requestKey, nodeId?:string, confirmAdvance:true}`，`ROUTES.executionAdvance`，operation `execution.advance`，返回 `CommandResponse<ExecutionResponse>`；要求 `autoAdvance===false`，status running 或“自动关闭等待推进”的 paused（用户暂停有 `pause.requestKey` → 409，先 resume）；成功 `receipt.outcome={released,waitingFor}`；无可推进 → 400 `VALIDATION_FAILED` + `details.waitingFor`（并行汇合原因）；同次不级联。
  - `POST /api/tasks/:id/plan/edit/abandon`，body `{requestKey, editSessionId, confirmAbandon:true}`，`ROUTES.planEditAbandon`，operation `plan.edit.abandon`，返回 `CommandResponse<PlanResponse>`；仅 requesting_pause/editing/conflict 可放弃（saved → 409，需重新确认/继续）；editSessionId 不匹配 → 409 `STALE_TARGET`；成功后 `editSession.state='abandoned'`、localChanges 清空、计划修订不变、execution 回 running 且 `autoAdvance=autoAdvanceBeforeEdit`，`receipt.outcome` 带 autoAdvance。
  - 三条路由加入 `COMMAND_ROUTE_SIGNATURES`（缺 requestKey 统一 400）；重放返回原回执，同 key 不同 body → 409 `REQUEST_KEY_REUSED`（与既有 CommandService 语义一致）。
- 引擎实现：
  - `ExecutionService.setAutoAdvance`：requestKey+bodyHash+回执、事件、幂等（重放先于状态 guard，已结算请求不因执行后续变化变成报错）；关闭只影响后续领取。
  - `ExecutionService.advance` + `#releaseAdvanceable`：无 nodeId 放行全部“前置均 succeeded/skipped 且自身 pending/ready”的节点；有 nodeId 只放行直接后继；`assertTransition(nodeMachine, pending→ready)`；无可推进时把回执结算 failed 并给 `waitingFor`。
  - `#advance` 调度器：auto 开启时才自动 `#recomputeReady`；关闭时只运行已显式放行的批次，批次跑完用合法边 `RUNNING→PAUSING→PAUSED` 进入“等待推进”（pause 无 requestKey，区别于用户暂停）。
  - `PlanService.abandonEdit`：校验会话/契约标志/状态，丢弃草稿，恢复 autoAdvance，`assertTransition(executionMachine, paused→running)`；http 层在 `edit/finish(continue)` 与 `edit/abandon` 后调用 `engine.executions.kick()`，让恢复后的执行真正被调度。
- W2-9：静态资源根边界从 `normalize+startsWith` 改为 `resolve` + 目录分隔符判定（导出 `isPathInside` 供测试），`/assets/*` 增加 `..` 显式 403；`DELETE /api/settings/databases/:id` 无 body 的兼容策略保留并注明（服务端生成 req key + 回执），新增测试覆盖；三条新命令路由缺 requestKey 400 覆盖。
- W2-13：新增回归测试——未知任务的 execution/workspace/delivery 视图均 404 JSON；正常任务（confirm+prepare 后）三视图 actions 含全部 18 个能力键且 `allowed` 为布尔。
- 验证命令与结果：
  - `npx tsc -p tsconfig.json --noEmit` → exit 0（含并行 agent 改动）。
  - `node --import tsx --test --test-force-exit tests/integration/execution-control.test.ts` → **5 pass / 0 fail**（auto-advance 幂等/冲突/状态限制；advance 放行/直接后继/并行汇合/无候选/用户暂停/404；abandon 丢弃草稿/恢复开关/计划不变/幂等/saved 拒绝；W2-13、W2-9）。
  - `... tests/integration/execution-control.test.ts tests/integration/routes-contract.test.ts tests/integration/api-contract.test.ts` → 14 pass / 0 fail（routes 快照已移除 planEditAbandon/executionAdvance 两条例外并断言 executionAutoAdvance）。
  - 回归：`startup-recovery,node-skip,workspace-cleanup-blockers,plan-edit-dependencies,server-smoke,concurrent-worktrees,delivery-fixroot,recovery-api,task-acceptance` → 16 pass / 0 fail。
- 关于 fe-templates 报告的“execution-control 仍有红”：其 20:37 记录对应本文件并行编辑中的旧快照；当前工作区（含 task-13 前端改动）重跑为 **5 pass / 0 fail**，其中同 key 不同 body 的三条命令均按 CommandService 返回 409（REQUEST_KEY_REUSED / STALE_TARGET），缺 confirm 或非法状态按 400/409 既定错误码。
- 未覆盖 / 说明：
  1. 未跑真实模型执行路径（autoAdvance 关闭下放行批次“逐个跑完再等待”只验证了 release/回执与调度状态，模型执行需 live `test:model`/Lead 全量）。
  2. 放弃调整无法恢复“调整前已暂停”的暂停态：`EditSession` 模型只持久化 `autoAdvanceBeforeEdit`（models.ts 不在本任务写范围）；当前按“回到运行中”实现并在契约注释写明，若需区分需 Lead 批准改 `packages/shared/src/domain/models.ts`。
  3. `saved` 会话禁止放弃（与设计 editing/conflict 才出现“放弃调整”一致）；W2-2 的 continue 路径未改动。
  4. 未运行 `build:web`/全量 `npm test`/浏览器点击（Lead 整合范围）。

### 20:45 整合 | Wave 2 验收通过

- **验收范围**：W2-1、W2-2、W2-3、W2-4、W2-9、W2-10、W2-11、W2-13（8 个工作包）；W3-7a 知识历史页、W4-1a 文档同步也已完成。
- **类型检查**：`npx tsc -p tsconfig.json --noEmit` → exit 0。
- **全量测试**：`npm test` → **345 tests / 54 suites / 334 pass / 11 skipped / 0 fail**（46.6s）。
- **构建**：`npm run build:web` → exit 0（1.83s）；`npm run build:server` → exit 0。
- **运行态验收（5177 真实服务）**：
  - 新路由 `/execution/auto-advance`、`/execution/advance`、`/plan/edit/abandon` 已注册；未知任务返回 404 JSON，缺 requestKey 返回 400 VALIDATION_FAILED。
  - 执行控制契约：自动推进开关（新 operation `execution.autoAdvance`）、整体推进/推进直接后继（`execution.advance`，release 不级联/并行汇合等待）、放弃调整（`plan.edit.abandon`，恢复 autoAdvanceBeforeEdit）均有引擎实现、回执与集成测试（execution-control 5 pass）。
  - 非 Git 清理真实删除受管副本+baseline+settings 键，越界路径拒绝；恢复三模式产生字段差异；PPT generating 启动恢复。
  - 知识历史页 `/knowledge/history` 路由可用，服务端无会话状态字段处按降级口径标注，未造假。
- **UI**：自动推进真实开关/整体推进/推进直接后继入口、放弃调整 Modal、RecoveryPage unknown 三入口、知识历史页接线完成；UI 冒烟仍受当前 Electron sandbox 限制，未计通过。
- **范围审计**：设计稿目录未改；无凭据；`git diff --check` 通过。
- **新登记 follow-up**：W2-4b（verify_only 硬只读）、W2-14（storage removeJson）、W2-15（abandon 恢复暂停态）、W3-5a（NodeDetailPanel 推进入口）、W4-1b（文档同步 Wave 2 + design-coverage 重写）。
