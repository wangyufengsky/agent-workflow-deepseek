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
