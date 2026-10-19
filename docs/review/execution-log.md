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

### 20:48 分派 | Wave 3A

- `be-api` → task-16：W0-4 节点验收后端（accept/reject 路由+引擎+契约+测试）。
- `fe-templates` → task-17：W0-4 节点验收 UI + W3-5a 节点面板「推进直接后继」入口。
- `fe-ppt` → task-18：W3-7b PPT 作品/工作台视图（/ppt 内，无新路由）。
- `fe-audit` → task-19：W3-9a 任务列表步骤条/行菜单 + 开始任务三段结构。
- `design-audit` → task-20：W3-1a 项目详情页四页签（charter 后端待做）。
- `docs-audit` → task-21：W4-1b 文档同步 Wave 2 + 重写 design-coverage 覆盖矩阵。
- 本波并行约束：App.tsx 仅 design-audit 修改；PPT 视图不新增路由；后端仅 be-api 改 http/shared/engine/plan。

### 20:50 任务完成 | W4-1b（task-21）| 文档同步 Wave 2 + 重写 design-coverage 覆盖矩阵

- 负责人：`docs-audit`；写范围：`README.md`、`docs/remaining-work.md`、`docs/verification.md`、`docs/design-coverage.md`；未改 `docs/review/**`（仅本日志）、`docs/task-assignment.md`、产品代码、设计稿。
- README：测试数字改为 **345 tests / 54 suites / 334 pass / 11 skipped / 0 fail**（46.6s，`.tmp/wave2-verify.log`）；实现状态改为 Wave 0–2 完成、Wave 3A 进行中，补 Wave 2 已完成项；「未完成」清单改为 W0-4（进行中）、Wave 3A 四项（W3-1a 项目详情、W3-7b PPT 作品/工作台、W3-9a 任务/开始页、W3-5a 节点推进入口）、W3 其余缺失页与整块能力、Wave 2 follow-up（W2-4b/12/14/15）、外部环境、打包、视觉回归、文档体系；删除「Wave 2 进行中」和「design-coverage 旧副本」。
- remaining-work：新增 Wave 2 已实现项（执行控制、非 Git 真实清理、恢复三模式、PPT 启动恢复、恢复页 unknown、知识历史页、viewActions）；工作区清理改为已实现；缺口重编 1–10，保留 W0-4、Wave 3A 进行中、W2 follow-up、W3 设计缺失页/整块能力、真实环境、打包、视觉回归、文档体系、PPT 高级视觉、恢复/审查深度。
- verification：计数改 345/334/11/0（46.6s）；§10 重写非 Git 清理、恢复三模式、节点验收、design-coverage、远端 UNKNOWN 等；§7 增加恢复三模式；新增 **Wave 2 验收** 记录（执行控制/清理/恢复/PPT 恢复/知识历史/契约例外/W2-13）；Wave 0/1 契约例外注明已闭合两条。
- design-coverage：删除 verification 副本，重写为 25 页真实矩阵（`home` … `roles-legacy`）+ delivery/planning/git/node 补充稿 + 整块能力 + 不误报清单 + 维护规则；当前 **✅ 2 / 🟡 19 / ⛔ 4**；基于 `docs/review/design-parity.md` 更新 Wave 1/2 已闭合项（知识历史页、自动推进/推进/放弃、恢复 unknown、非 Git 清理、PPT 恢复），Wave 3A 代码开始落地的项标「进行中/未验收」。
- 验证：`diff docs/design-coverage.md docs/verification.md` 不同且设计覆盖文件不含验证记录结构；4 文件 grep 无 `313/302/24s` / `Wave 2 进行中` / `旧副本` / `缺口已关闭` / `v1–v7`；`git diff --check` 干净；4 文件 Markdown 链接 0 broken；未跑全量 test（仅文档改动，Wave 2 的 345 tests 已由 Lead 验收）。
- 未覆盖：Wave 3A 合并后需把 W0-4/W3-1a/W3-5a/W3-7b/W3-9a 从「进行中」更新为验收结果；`docs/api.md` 重生成（W4-2）、证据/CI（W4-3）仍待后续。

### 20:44 任务完成 | W0-4 节点人工验收后端（task-16）| be-api

- 负责人：`be-api`；写范围：`packages/shared/src/domain/enums.ts`、`packages/shared/src/api/contracts.ts`、`packages/engine/src/plan.ts`、`packages/server/src/http.ts`、新增 `tests/integration/node-acceptance.test.ts`；未改 `apps/web/**`、`execution/workspace/recovery/ppt`、storage/migrations、设计稿、`task-assignment.md`。`machines.ts` 未改（验收不改节点状态，无需新迁移）；`engine.ts` 未改（方法挂在既有 `PlanService`）。
- 契约（已同步 fe-templates）：
  - `POST /api/tasks/:id/nodes/:nodeId/accept`，body `{requestKey, confirmAccept:true, note?:string}`；`ROUTES.nodeAccept`；operation `node.accept`。
  - `POST /api/tasks/:id/nodes/:nodeId/reject`，body `{requestKey, confirmReject:true, note:string}`（必填，去空格 1–2000 字，退回原因）；`ROUTES.nodeReject`；operation `node.reject`。
  - 响应 `{receipt, resource:{node: NodeDetailResponse}}`；`NodeDetailResponse = NodeDetail & { acceptance?: NodeAcceptanceView }`；`acceptance={nodeId, state:'pending'|'accepted'|'rejected', verdictAt?, note?, requestKey?}`，仅当节点 `succeeded` 时返回（pending=已成功待人工判定）。新增 `NodeAcceptRequest`/`NodeRejectRequest`/`NodeAcceptanceView`/`NodeDetailResponse`、`NodeManualAcceptanceState`、Rationale `NODE_EXECUTION_MISSING/NODE_NOT_SUCCEEDED/NODE_ACCEPTED/NODE_REJECTED`。
  - `nodeDetail.actions`：`accept.allowed = succeeded && state!=='accepted'`，`reject.allowed = succeeded && state!=='rejected'`，不允许时带真实 reason/reasonCode（未执行/未成功/已验收/已退回）；两个 nodeDetail 读路由（`/nodes/:nodeId` 与 `/plan/nodes/:nodeId`）同源。
  - 错误语义：缺 requestKey 400（统一 hook）、缺 confirm 400、reject 缺 note 400、任务/执行/节点不存在 404、节点非 succeeded 409 OPERATION_IN_PROGRESS、同 verdict 重复 400 VALIDATION_FAILED、同 key 不同 body 409 REQUEST_KEY_REUSED、同 key 同 body 重放原回执。
- 实现要点：
  - 验收是**审计结论叠加**，不重写节点/执行状态（任务明确要求「不要让验收改变节点执行结果」）；accepted↔rejected 可互相更正（审计替换），同结论重复被拒；`by` 不伪造（服务无登录主体）。
  - 持久化：本机 settings JSON `execution.node.acceptance.<executionId>.<nodeId>`（含 state/verdictAt/note/requestKey）；原因：`ExecutionNodeState` 在 `models.ts`、节点行在 `packages/storage`，均不在本任务写范围，避免越界加列/迁移。重启后 nodeDetail 仍可读（有测试）。
  - `acceptNode`/`rejectNode` 走 `commands.begin/settle/fail`（requestKey+bodyHash），失败先结算 failed 再抛错；replay 先于状态/重复 guard，保证已结算请求可核对。
  - HTTP 路由加入 `COMMAND_ROUTE_SIGNATURES`（统一 400）；publish `execution.changed` 供 UI 刷新。
- 验证命令与结果：
  - `npx tsc -p tsconfig.json --noEmit` → exit 0（并行前端文件修复后复跑）。
  - `node --import tsx --test --test-force-exit tests/integration/node-acceptance.test.ts` → **3 tests / 3 pass / 0 fail**（验收成功/状态不变/回执、幂等与 key 冲突、重复结论拒绝、reject 必填原因与翻转、非法状态 409、404、重启持久化、任务级 acceptance 独立、无执行时 404+actions reason）。
  - 回归：`node-acceptance + routes-contract + api-contract + execution-control` → 17 pass / 0 fail（ROUTES 快照自动包含两条新路由）；`node-skip, plan-edit-dependencies, task-acceptance, server-smoke, startup-recovery, execution-control` → 16 pass / 0 fail。
  - 运行中 dev server（5177 热加载）探针：accept/reject 缺 requestKey → 400 VALIDATION_FAILED（路由已注册），未知任务 node detail → 404 JSON。
- 未覆盖 / 已知缺口：
  1. **验收不 gate 执行完成/自动推进/下游领取**：`packages/engine/src/execution.ts` 不在本任务写范围（Lead 明示），设计「所有自动步骤通过 → 待人工验收 → 验收通过才结束执行/进入等待交付」的流程尚未强制；当前结论可用于 UI 展示与审计，后续需 W? 小任务在 execution 调度中读取 verdict。
  2. reject 不重置节点状态、不触发重新执行（同上：节点 SUCCEEDED 为 terminal，改状态需 machines.ts 新边 + execution 调度；本任务按要求只记录结论），UI 可用恢复/重试路径继续处理。
  3. 结论存 settings JSON 而非节点表新列；`packages/storage` 补 `node_acceptances` 表/迁移需另开任务（当前方案重启持久、无 schema 变更）。
  4. 未跑 `build:web`/全量 `npm test`/浏览器点击（Lead 整合范围）。

### 20:45 任务完成 | W0-4/W3-5a（task-17）| 节点人工验收与推进入口 UI

- 负责人：`fe-templates`；写范围：`apps/web/src/pages/node/**`、`apps/web/src/pages/task/**`。
- 改动文件：`pages/node/NodeDetailPanel.tsx`、`pages/task/advance.ts`（新增：从 ExecutionPanel 抽出可推进集合/原因/可切换状态助手）、`pages/task/ExecutionPanel.tsx`（改为引用共享助手，行为不变）、`pages/task/TaskCanvasPage.tsx`（向节点面板传 plan/execution）。
- 节点验收（W0-4）：概览底部新增「人工验收」区，读取 `NodeDetailResponse.acceptance` 显示 pending/accepted/rejected + 判定时间 + 备注 + requestKey；按 `nodeDetail.actions.accept/reject` 渲染「验收通过」（主）与「退回修改」（次），禁用时显示后端 `reasonCode/reason`；二次确认 Modal（通过可选备注、退回必填原因，去空格 1–2000 字，Modal 内校验 + 计数）；调用 `POST /api/tasks/:id/nodes/:nodeId/accept|reject`（shared `NodeAcceptRequest`/`NodeRejectRequest` + `ROUTES.nodeAccept/nodeReject`），用 `useWorkflowCommand` 显示 succeeded/failed/unknown/accepted 回执（unknown 只按原 requestKey 核对、不自动重发），成功后刷新节点/执行视图；文案明确验收是审计事实，不改变执行状态/下游推进/任务级验收。
- 节点面板推进入口（W3-5a）：`NodeDetailPanel` 接收任务 plan/execution，在自动推进关闭且节点已成功时显示「直接后继 · 自动推进已关闭」：列出直接后继状态（可推进 / 并行汇合等待「前置」/运行中/完成/失败），按钮「推进直接后继 · N 步」调用 W2-1 `advanceExecution(taskId, nodeId)`；禁用原因覆盖并行汇合、无后继、用户暂停需先继续、编辑会话中、unknown 需先核对；成功后按 `receipt.outcome.released` 显示放行数量并刷新。
- 契约核对：与 be-api 落地的 shared DTO/路由逐条一致（含 notes trim、reject note 必填、同结论重复 400、actions 原因、`{receipt, resource:{node}}` 响应）；真实服务 inject 探针验证 pending→accepted→rejected 的 acceptance 事实、actions 可用性翻转与同 key 重放。
- 验证：`npx tsc -p tsconfig.json --noEmit` → exit 0；`--noUnusedLocals` 过滤 `pages/node|pages/task` → 0；`tests/integration/node-acceptance.test.ts` 3 pass；`tests/integration/execution-control.test.ts` 5 pass；`tests/integration/routes-contract.test.ts` 2 pass；`git diff --check` 通过。
- 未覆盖：按要求未运行 `npm run build:web`、未跑全量 `npm test`；无浏览器点击验证。验收 gating（验收通过才结束执行）按 be-api 说明属后续任务，本页不伪造该语义。

### 20:48 任务完成 | W3-9a（task-19）| 任务列表与开始任务结构补齐

- 负责人：`fe-audit`；写范围：`apps/web/src/pages/tasks/**`、`apps/web/src/pages/start/**`。
- 任务列表：行内新增真实阶段胶囊 + **聚合进度条**（`TaskSummary.progress.done/total/running/failed`）、第 x/y 步与执行中/失败计数；「⋯」菜单按阶段打开需求/执行画布、复制任务链接（Clipboard，失败给可读提示）、已结束任务显示“归档（接口未接通）”禁用项；底部「加载更多」使用现有 `/api/tasks?limit=` 能力（50→200），少于 limit 或达 200 时禁用并写原因；「查看已归档」无接口、禁用写原因；顶部「需要你处理」保留并排除 `unknown` 状态。
- 降级口径：`TaskSummary` 没有逐步骤状态字段（只有聚合 progress），**不伪造步骤段**；页面注明“列表接口未提供逐步骤状态/总数/游标，计数基于已加载任务”，行内显示真实阶段胶囊与聚合进度。
- 开始任务：改为项目单选卡（路径不可用禁用）、目标 textarea + 自动生成任务名称/字数、流程卡（步骤链 + 版本徽标）；右侧固定「将要创建 + 接下来三步」；项目/流程/目标/名称的缺失原因实时显示在主按钮下；保留 `project`/`methodId` URL 预选与非法回退提示。
- 回执：提交成功显示回执卡（任务/项目/流程版本、去确认计划/稍后回列表/再创建一个）；`resource.task.id` 缺失时显示“草稿已形成，但没能自动打开”，不伪造任务 ID；unknown 沿用 `ReceiptNotice` 的只核对原请求语义。流程版本来自 `/api/bootstrap` 目录快照，无独立版本读取接口，读取失败复用 bootstrap 错误页，不伪造“读取中”状态。
- 验证：`npx tsc -p tsconfig.json --noEmit` → exit 0；本批 scoped tsc → exit 0；`--noUnusedLocals --noUnusedParameters` 过滤 `pages/tasks|pages/start` → 0；`git diff --check` 通过。按要求未跑 `build:web`/全量测试，未做浏览器点击。
- 未覆盖：逐步骤状态条需列表接口补字段（含当前停滞/失败步骤名与原因）后才能实现；任务归档/已归档列表、分页游标/总数、独立流程版本读取仍无接口；开始任务“打开失败”只能检测回执缺失 taskId，无法检测路由打开失败。

### 20:49 任务完成 | W3-7b（task-18）| PPT 作品库 + 四步工作台（/ppt 内视图）

- 负责人：`fe-ppt`；写范围：`apps/web/src/pages/ppt/**`；未新增路由、未改 App.tsx/后端/shared/其他页面/设计稿。Lead 指出的临时冒烟配置 `apps/web/src/pages/ppt/vite.smoke.config.mts` 已删除，`git status` 仅含本任务产品文件（含旧 `PptWorkPanel.tsx` 被新模块替代的删除记录）。
- 视图结构：`/ppt` 页头新增 `作品 / 工作台` 分段 + 「新建演示」；作品库默认网格（可切列表），点击作品进入工作台；工作台四步页签（讨论需求 → 设计方案 → 制作检查 → 导出）+ 四步进度条；创建改为对话框（原入口保留），创建成功后刷新列表、选中新作品并进入工作台。
- 改动/新增文件：重写 `PptPage.tsx`（页面壳/查询/命令执行/回执/视图切换）；新增 `PptWorksView.tsx`（工具条/网格/列表/示意封面/禁用操作）、`PptCreateDialog.tsx`、`PptWorkbench.tsx`（页头+四步进度+步骤切换）、`PptWorkbenchSteps.tsx`（讨论/设计/检查三步）、`PptStepExport.tsx`（导出+删除）；`ppt-shared.tsx` 新增 `derivePptProgress` / `PPT_STAGES` / `pptStepState`（只按真实字段推导）；重写 `ppt.css`（令牌驱动，无硬编码颜色）；删除 `PptWorkPanel.tsx`（内容迁入工作台，避免新旧两套重复 UI）。
- 作品库事实与降级：网格/列表切换、搜索（标题/主题）、项目筛选、阶段分段（全部/讨论需求/设计方案/制作检查，按真实大纲/逐页推导）、阶段条、页数、项目、主题、更新时间、下一步提示；**缩略图**：服务没有缩略图接口，卡片显示明确标注「示意封面 · 无缩略图接口」的占位视觉（内容取自真实首屏要点/大纲），无大纲时标「无缩略图 / 尚未生成大纲」，不伪装渲染图；**复制/归档**：无后端接口，按钮禁用并用 `disabledReason` 写明原因；服务无归档状态，故不提供「显示已归档」开关。
- 工作台四步：① 讨论需求=标题/主题/大纲 inline 编辑（真实 PATCH，本地预检后仍展示服务消息），并写明设计稿五项需求简报无结构化字段的降级；② 设计方案=版式主题选择 + 保存（PATCH theme）、大纲展示/生成、逐页展示/生成，写明三个视觉方向需提案字段；③ 制作检查=真实计数（逐页/大纲/附件/主题/状态/更新时间/tokens）+ 文本/图片附件增删，明确「服务没有逐页视觉检查接口」，不显示检查结论或问题页标记；④ 导出=真实 PPTX 下载与 Markdown 预览/下载，说明导出不回写作品状态；删除作品（二次确认）放在导出步骤。
- 回执/unknown：沿用 W1-1 的统一 `runCommand`（7 类写命令 requestKey + 回执条 accepted/succeeded/failed/unknown；失败显示服务 message；网络超时/不可用归类 unknown 且不自动重发，可用 `operations.by-key` 核对）；生成中禁用写操作并写原因（删除仍允许）；页头回执条在两个视图都可见；工作台步骤内嵌失败说明（附件/删除）。
- 验证命令与结果：
  - `npx tsc -p tsconfig.json --noEmit` → exit 0（0 error）。
  - `npx tsc -p tsconfig.json --noEmit --noUnusedLocals` 过滤 `pages/ppt` → 0 条。
  - 真实服务 UI 冒烟（真实 Vite + 真实服务 5177；临时 Vite 仅关闭 HMR 防并行编辑触发 reload，验证后已删除）：55 项断言全 PASS —— 作品库两张卡片、示意封面/无缩略图、页数/下一步、复制归档禁用原因、阶段计数 2/1/1/0、搜索/阶段/网格列表切换、打开工作台、四步状态（讨论 done、设计 current、检查/导出 todo）、保存主题与讨论需求均写回服务、制作检查真实计数与「无视觉检查」、导出 Markdown 弹窗内容、删除作品回作品库、未选中工作台占位、新建对话框创建后进入工作台；测试作品全部清理（真实服务当前 0 份 PPT 作品）。
  - 截图自检：作品库网格（示意封面标签、阶段条、禁用操作）与工作台（回执条、四步进度、导出步骤）渲染正常。
  - 按约束未运行 `npm run build:web`、未跑全量 `npm test`。
- 未覆盖 / 已知限制：
  1. 缩略图接口缺失 → 只展示明确标注的示意封面；真实首页渲染图需新增服务端缩略图导出。
  2. 复制/归档、版本/修订、需求简报五项、三个视觉方向、逐页视觉检查/演讲备注均无接口，已按要求禁用并写原因或标注降级。
  3. 阶段条中的「导出」永不标记完成（服务不记录导出状态）；制作检查阶段由「已有逐页内容」推导，不代表通过检查。
  4. 全项目作品为单次列表接口前端过滤，无分页；作品很多时首屏一次返回全部。
  5. 未做模型生成成功路径的浏览器验证（避免真实模型消耗）；生成按钮与既有 W1-1 服务契约一致。

### 21:03 任务完成 | W3-1a（task-20）| 项目详情页与四页签（前端）

- 负责人：`design-audit`；写范围：`apps/web/src/pages/projects/**`、`apps/web/src/app/App.tsx`（只加一条 `/projects/:projectId` 路由与对应 import）；未改后端/shared/其他页面/其他路由。
- 新增文件：`pages/projects/ProjectDetailPage.tsx`、`pages/projects/project-detail.css`。修改：`ProjectsPage.tsx`（卡片加「模板任务」与「查看配置 ›」；开始/模板任务带 `project` 参数）、`App.tsx`（路由）。
- 页头：Git 状态徽标、项目名、路径 + 复制按钮、开始任务 / 模板任务 / 查看 Git / 重新检测；路径不可用时开始/模板任务禁用并写原因。
- 四页签（URL `?tab=`，默认概览）：
  1) 概览：项目信息（说明、当前分支、Git 状态及原因、Provider、默认方法、更新时间）+ 最近任务（`GET /api/projects/:id` 的 tasks，按更新时间取 5 条，空态真实）+ 右侧配置状态（Git 账号 / GitLab 与证据 / 文档路径 / 项目公约，点击跳页签；Git 账号按项目 Provider 读取 bootstrap integration，GitLab 读取项目详情 `repos.gitlab` + 全局配置）。
  2) Git 与 GitLab：全局账号只读事实 + 项目级凭据「服务未提供」；仓库事实走 `GET /api/git/repos/:projectId`（分支/HEAD/上游/远端/工作区/最近获取/最近提交/打开 MR），含未接通/不可用/业务失败/加载/未知状态；GitLab 仓库绑定与证据来源明确「服务未提供接口」，无假表单。可跳 `/git/:projectId`。
  3) 文档路径：读取 `settings.docPaths`（当前 shared 契约没有该字段，做前向兼容读取）。有字段时可编辑并 PATCH `settings.docPaths` 后刷新；无字段时显示「未配置」、输入与保存禁用并写明需要后端补字段；显示实际位置预览、回执与错误。
  4) 项目公约：真实「服务未提供项目公约生成接口」+ 生成/审阅/写入三步置灰 + 生成按钮禁用原因；不读取或伪造 AGENTS.md。
- 重新检测：`POST /api/projects/:id/recheck`，requestKey + `ReceiptNotice`，成功后刷新 detail/projects/bootstrap/git repo；错误显示服务原因。
- 验证：`npx tsc -p tsconfig.json --noEmit` exit 0；本任务文件 scoped tsc + `--noUnusedLocals --noUnusedParameters` 0 报错；`git diff --check` 通过；新文件无 hex/rgb 硬编码颜色（仅主题令牌）。按约束未运行 `build:web`/全量 `npm test`，未做浏览器点击。
- 待后端/未覆盖：
  1. 项目公约（charter）生成/读取/写入接口不存在；页签只读待后端。
  2. 项目级 GitLab 仓库绑定与执行证据来源（JUnit/日志）接口不存在；已明确服务未提供。
  3. 当前 shared `ProjectSettings` 无 `docPaths`，文档路径仅在服务实际返回该字段时才可保存；需后端契约补齐后去掉禁用态。
  4. 模板页当前不读取 `?project=`（不在本任务写范围）；详情/卡片链接已带该参数，落地预选需模板页负责人补读参数。
  5. 未做真实服务 + 浏览器 smoke（本地 5177 未运行）；建议 Lead 整合时验证 404、路径不可用、非 Git、Git 读取失败、docs 无字段/有字段、recheck 回执与 `?tab=` 深链。

### 21:06 整合 | Wave 3A 验收通过

- **验收范围**：W0-4 节点验收（后端+UI）、W3-5a 节点推进入口、W3-1a 项目详情页、W3-7b PPT 作品/工作台、W3-9a 任务列表/开始页、W4-1b 文档同步+design-coverage 重写。
- **类型检查**：`npx tsc -p tsconfig.json --noEmit` → exit 0。
- **全量测试**：`npm test` → **348 tests / 54 suites / 337 pass / 11 skipped / 0 fail**（51.2s）。
- **构建**：`npm run build:web` → exit 0（2.14s）；`npm run build:server` → exit 0。
- **运行态验收（5177）**：`POST .../nodes/:id/accept` 缺 requestKey → 400；未知任务 reject → 404 JSON；`/projects/:id` 与 `/knowledge/history` SPA 路由 200 HTML。
- **功能证据**：节点验收契约（accepted/rejected 审计叠加、actions/reasonCode、requestKey 幂等/冲突、3 个集成测试）；项目详情四页签（charter 明确未提供、不造假）；PPT 作品库/四步工作台；任务列表行菜单/聚合进度；开始任务三段卡/回执。
- **范围审计**：设计稿未改；临时 Vite 配置已删除；`git diff --check` 通过。
- **新登记 follow-up**：W0-4b（验收 gating）、W3-1b（charter/docPaths/GitLab 项目绑定）、W3-7c（run/roles-legacy）、W3-9b（结构缺口批次）、W3-11（主页/品牌）。

### 21:08 分派 | Wave 3B

- `be-api` → task-22：W3-2 Inbox 后端 interactions（列表/详情/答复；权限/策略如实降级）。
- `design-audit` → task-23：W3-2 Inbox 前端就地处理。
- `be-recovery` → task-24：W2-4b verify_only 只读强制 + W2-12 远端 UNKNOWN + W2-14 storage removeJson。
- `fe-ppt` → task-25：W3-7c 运行内容阅读器 + 历史角色配置页。
- `docs-audit` → task-26：W4-2 API 文档重生成 + 路由契约校验脚本。
- 并行约束：be-api 独占 http.ts/contracts；be-recovery 独占 models/actions/plan/planning/execution/delivery/storage；fe-ppt 独占 App.tsx 新增两条路由。

### 20:56 任务完成 | W3-2 Inbox 后端 interactions（task-22）| be-api

- 负责人：`be-api`；写范围：`packages/shared/src/api/contracts.ts`、`packages/shared/src/domain/enums.ts`、`packages/engine/src/planning.ts`、`packages/server/src/http.ts`、新增 `tests/integration/interactions.test.ts`；未改 `apps/web/**`、`shared/domain/models.ts`、execution/workspace/delivery/git/storage、设计稿、`task-assignment.md`。契约已同步 Lead 与 design-audit（task-23 UI）。
- 契约（真实字段，未造数据）：
  - `GET /api/interactions`（`ROUTES.interactions`）→ `{items: InteractionSummary[], counts:{open,unknown}, capabilities:{planningQuestions:true, planningReview:true, permissions:false, policy:false, reason}}`。items 只列 active 任务当前规划轮的待处理事项（每轮一条，优先级 reconcile(unknown) > 待回答 > 候选审阅）；`stepName='规划轮次 N'`（真实标签，非画布步骤）。
  - `GET /api/interactions/:id`（`ROUTES.interaction`）→ `InteractionDetail`：`kind='planning_question'|'planning_review'|'planning_reconcile'`、`state='open'|'resolved'|'unknown'`、`source{type,roundId,roundOrdinal,planRevisionId?,nodeIds?}`、`questions[]{id,title,required,answered,answer?,answeredAt?,affectedNodeIds,inputMode:'free_text'}`、`candidate{planRevisionId,summary,validationState,diffCount}`（review）、`degradation{options:false,multiSelect:false,recommendedValue:false,reason}`、`resolve{allowed,confirmField:'confirmResolve',reason?,reasonCode?}`、`unknown?`、`resolvedAt?`、`requirementRevision`。
  - `POST /api/interactions/:id/resolve`（`ROUTES.interactionResolve`）body `{requestKey, confirmResolve:true, answers:[{questionId, values?:string[], other?:string}]}` → `{receipt, resource:{interaction, planning, requirementRevision}}`；values 多值按 `；` 合并、other 追加（模型只存单答案文本）；仅 planning_question 可提交。
  - 错误：缺 requestKey（统一 hook）/confirmResolve/answers 非法 →400；questionId 不属于本轮/空答复/重复 questionId/必答未答全 →400（details.unansweredQuestionIds）；已答复/轮次已前进/unknown →409（reasonCode INTERACTION_RESOLVED/INTERACTION_UNKNOWN）；review/reconcile →409（INTERACTION_READ_ONLY + 去需求画布/按原请求号核对原因）；id 不存在 →404；同 key 不同 body →409 REQUEST_KEY_REUSED，同 key 同 body 重放原回执。
- 实现要点：
  - `PlanningService.resolveAnswers(taskId, roundId, input)`（planning.ts）：对真实 `PlanningQuestion` 做归属/非空/重复/必答完整性校验后委托既有 `saveAnswer` —— 与需求画布完全同一写入路径（requirement supplements + revision+1、questions.answer/answeredAt/answeredBy、回执 operation `requirement.answer.save`、requestKey/bodyHash），不新增伪 operation/字段。
  - `http.ts` 新增 interactions 读模型/命令 + 统一 requestKey 校验；权限/策略类明确 `capabilities=false` + reason（受管 OpenCode + 内部 MCP 无请求来源），不返回伪造 permission/policy 项。
  - 诚实降级：现有 `PlanningQuestion` 只有单答案文本，没有选项/单选多选/推荐值/rejection 字段 → detail 用 `inputMode:'free_text'` + `degradation.reason` 说明；**不提供拒绝回答**（规划业务问题必须明确回答，AD06；permission/policy 拒绝语义无来源）；design-audit 已确认 UI 按置灰+原因展示。
  - review/reconcile 事项只读并提供真实指向（需求画布 planning.apply/reject、operations.by-key 核对），不伪造就地提交。
- 验证命令与结果：
  - `npx tsc -p tsconfig.json --noEmit` → exit 0（含并行 agent 改动）。
  - `node --import tsx --test --test-force-exit tests/integration/interactions.test.ts` → **3 tests / 3 pass / 0 fail**（列表映射+capabilities 诚实、detail 字段/404、resolve 成功写 requirement revision 与画布一致、必答未答/未知问题/空答复 400、幂等重放/同 key 冲突 409、已答复再提交 409、review/reconcile 409）。
  - 回归：`interactions + routes-contract + api-contract + node-acceptance + startup-recovery` → 20 pass / 0 fail。
  - 运行中 5177 探针：`GET /api/interactions` 返回真实空列表 + capabilities（permissions/policy=false+reason）；detail 不存在 404；resolve 缺 requestKey 400。
- 未覆盖 / 说明：
  1. 只因当前评审数据（seeded round）测试；未跑真实模型生成的规划问题（live planning 需 `test:model`/Lead 全量）。
  2. permission/policy/交付类事项不在 interactions：permission/policy 无来源（capabilities=false 已写实）；delivery_confirm 仍由 bootstrap.inbox/任务页处理，未映射为 interaction（避免造无 resolve 语义的项）。
  3. interactions 无分页/cursor（Inbox 规模小，按任务 updatedAt 排序返回全部待处理项）；如需分页后续加。
  4. `saveAnswer`（需求画布路径）保持原有宽松校验，严格校验只在 interactions resolve；两条路径写同一字段，数据一致但画布端仍依赖 UI 约束。
  5. 未跑 `build:web`/全量 `npm test`/浏览器点击（Lead 整合范围）。

### 20:58 任务完成 | W4-2（task-26）| docs/api.md 由 ROUTES + 服务端注册生成 + 契约校验脚本

- 负责人：`docs-audit`；写范围：`docs/api.md`、`scripts/check-docs-routes.mjs`（新增）、`package.json`；未改产品代码/其他文档/设计稿。
- 脚本：扫描 `packages/shared` 的 `ROUTES` + `packages/server/src` 注册路由（含 review/fix 插件、内部 MCP、OpenCode 网关），支持 `--write` 生成与默认校验；显式例外只有「单个 MR 详情 ROUTES 预留（服务端未注册，404）」与「OpenCode gateway 服务端独有」；其他死 ROUTES / 未纳入 ROUTES 的服务端路由 / 文档缺路由均非零退出；`docs/api.md` 必须与生成结果逐字一致。
- 接入：`package.json` 新增 `docs:api`、`check:docs-routes`，并把 `check:docs-routes` 加入 `verify` 链。
- api.md：重写为 16 个分组、242 行、147 条唯一路由（136 ROUTES keys / 133 server /api paths / 13 internal），覆盖 Wave 0–3B：execution auto-advance/advance、plan abandon、node accept/reject、knowledge history、project detail（`/api/projects/:id`）、PPT/pptx、fix 子路由、`settings/git`、`DELETE settings/databases/:id`、`fs/directories`、interactions 三条（`GET /api/interactions`、`GET /:id`、`POST /:id/resolve`）；删除「远端适配器待接线」等过期文案；每行标注回执/读口/SSE/二进制/内部端点语义。
- 验证：`node scripts/check-docs-routes.mjs` → exit 0；`npm run check:docs-routes` → exit 0；`npm run docs:api` 后再 check 仍 exit 0（幂等）；唯一 warning 为单个 MR 契约预留。
- 未覆盖：单个 MR 详情仍为契约预留（服务端 404，脚本显式警告）；未来新增路由会让 check 失败并要求 `npm run docs:api`；未跑全量 `npm test`/typecheck（其他 agent 正在改代码，由 Lead 整合验收）。

### 20:58 任务完成 | W2-4b/W2-12/W2-14（task-24）| verify_only 只读强制、远端 UNKNOWN、storage removeJson

- 负责人：`be-recovery`；写范围：`packages/shared/src/domain/models.ts`、`packages/storage/**`、`packages/engine/src/{actions,plan,planning,execution,delivery,recovery}.ts`、`packages/engine/src/workspace.ts`（仅替换 settings 删除方式，W2-14 明确要求其中一行）、`tests/integration` + `packages/storage/src/settings.test.ts`；未改 `http.ts`、`shared/api/contracts.ts`、`apps/web/**`、设计稿、`task-assignment.md`。与 be-api 的 http/contracts 并行隔离。
- **W2-4b verify_only 硬只读（服务端，不靠 UI）**：
  - 契约：`Task` 新增可选 `readOnly?: boolean`（见模型注释）；migration v11 `ALTER TABLE tasks ADD COLUMN read_only INTEGER NOT NULL DEFAULT 0`（append-only，旧库启动自动升级，旧行默认可写）；`TaskRepository` create/update/map 持久化；`TaskSummary` 未加字段（project-task.ts 不在写范围，避免半接线）。
  - `RecoveryService`：`verify_only` 创建时 `readOnly: true`；`computeTaskActions` 对该任务把所有写动作（generatePlan/useSkeleton/applyCandidate/rejectCandidate/stopPlanning/saveAnswer/confirmPlan/editPlan/adjustExecutionPlan/prepareWorkspace/start/pause/resume/cancel/continue/deliver/cleanup）统一置换为 `{allowed:false, reasonCode:'RECOVERY_READ_ONLY', reason}`；`computePlanningActions` 支持 `readOnly` 并整组拒绝；`computeTaskAttention` 对只读草稿稳定返回 `waiting_user`（不被事件清空）。只读草稿不能再作为恢复父任务（400）。
  - 服务入口二次校验（`AppError FORBIDDEN` 403，details.reason=`RECOVERY_READ_ONLY`）：`PlanningService` preview/start/stop/apply/reject/saveAnswer（resolveAnswers 走 saveAnswer 同守卫）；`PlanService` useTemplate/useSkeleton/confirm/editBegin/editSave/editFinish/abandonEdit；`ExecutionService` start/pause/resume/setAutoAdvance/advance/retry/skipNode/cancel；`DeliveryService` select/commit/push/createMergeRequest/merge（防御性，只读任务本无 workspace）。`workspace.prepare` 无需新守卫：只读任务没有可确认计划，服务在任何磁盘操作前以 `WORKSPACE_NOT_READY` 拒绝（测试覆盖）。
  - 测试：`recovery-readonly.test.ts` 断言 9 类写接口 403 + workspace.prepare 503、无 plan/round/workspace/execution 记录、actions 全 denied、readOnly 跨重启持久、嵌套恢复被拒、普通任务/all_stages 草稿不受影响；`packages/storage/src/settings.test.ts` 覆盖 readOnly 持久化与「旧库(v1–v10)升级后旧行可写、新行可标记」。
- **W2-12 远端写超时/不可判定 → UNKNOWN**：
  - `delivery.ts` 新增导出 `remoteOutcomeUnknownReason(error)`：`NETWORK_UNREACHABLE(details.reason=timeout|network_error)`→`timeout|network_error`；`UNSUPPORTED_FORMAT`（写了但响应不可解析）与 `INTERNAL_ERROR`（本地 git CLI 被 kill/超时无机器可读原因）→`undetermined`；业务错误码（PUSH_REJECTED_NON_FF / GITLAB_AUTH_FAILED / CONFLICT / MR_ALREADY_EXISTS 等）返回 undefined。
  - `push` / `createMergeRequest` catch：不可判定 → 回执 `accepted→unknown`（`ErrorCode.RECEIPT_UNKNOWN`，httpStatus 409，details `{requestKey, operation, outcomeUnknown:true, reason}`）、delivery 步骤 `unknown`、projection `unknown_receipt`，**不标记任务 delivered、不自动重发**（同 requestKey 重放只返回已结算回执，测试断言远端调用 0 次）；业务失败 → 回执 `failed`、步骤 `failed`、projection `blocked`（明确失败仍 failed）。
  - 测试：`remote-unknown-settlement.test.ts` 覆盖分类矩阵 + push timeout/network/CLI-killed 三种 UNKNOWN + 重放不重发 + 非 FF 仍 failed/blocked + MR timeout UNKNOWN（任务仍 active）+ MR 业务拒绝 failed。
  - **未覆盖 / 边界**：`POST /api/git/repos/:projectId/fetch` 的结算在 `http.ts`（be-api 写范围，本次不可改），目前仍是 catch→fail；引擎已导出 `remoteOutcomeUnknownReason`，be-api 可在该路由对 NETWORK_UNREACHABLE 改结算 unknown（同 push 语义）。fix 的 push 在 `review-plugin.ts`/`fix.ts`（不在本任务写范围），也需同批接线。前端 api 超时文案属 `apps/web/src/api/**` 其他任务。
- **W2-14 storage removeJson**：`SettingsRepository.removeJson(key)`（DELETE 单键、缺失为 no-op、幂等）；`workspace.cleanupConfirm` 的非 Git 清理不再直接 `store.db.prepare('DELETE...')`，改用仓库方法；storage 测试覆盖「只删目标键、其他键保留、重复删除幂等、删除后可重新写入」；原 clean-up 集成测试（settings 键消失断言）继续通过。
- 验证命令与结果：
  - `npx tsc -p tsconfig.json --noEmit` → exit 0。
  - `node --import tsx --test --test-force-exit packages/storage/src/settings.test.ts tests/integration/{recovery-readonly,remote-unknown-settlement,recovery-modes,workspace-cleanup-nongit}.test.ts` → 17 pass / 0 fail。
  - 回归：storage store.test + settings.test（5 pass）；integration（recovery-api、recovery-modes、workspace-cleanup-nongit、startup-recovery、ppt-startup-recovery、delivery-mr、delivery-fixroot、directory-apply-api、workspace-cleanup-blockers、task-acceptance、plan-edit-dependencies）26 pass；execution-control、node-acceptance、node-skip、review-fix-api、review-fix-recovery、server-smoke、insights 16 pass；均 0 fail。
- 未覆盖 / 说明：
  1. `TaskService.updateDraft`（需求原文/标题编辑，`project-task.ts` 不在写范围）仍可改只读草稿的标题/原文；不影响可执行路径，但若产品要求字面只读需后续同批加守卫。
  2. `TaskDetail.planning.actions` 由 `project-task.ts` 的 `#planningActions` 生成（不在写范围）：只读任务在 planning 视图里 startPlanning 仍可能显示 allowed（opencode ready 时）；UI 主路径用 `capabilities.generatePlan`（已 denied）。建议后续把 `readOnly` 传入该投影。
  3. fetch / fix push 的 UNKNOWN 结算见上（http.ts / fix.ts 不在写范围）。
  4. 未跑全量 `npm test`/build（Lead 整合范围）；未做浏览器点击。远端超时用受控端口桩/注入错误模拟，未连真实 GitHub/GitLab 超时。

### 21:55 任务完成 | W3-2（task-23）| Inbox 前端就地处理

- 负责人：`design-audit`；写范围：`apps/web/src/pages/inbox/**`。新增 `interactions.ts`、`inbox.css`；重写 `InboxPage.tsx`。未改 backend/shared/App.tsx/其他页面。
- 契约匹配（be-api task-22 最终契约）：`GET /api/interactions`（items/counts/capabilities）、`GET /api/interactions/:id`、`POST /api/interactions/:id/resolve`（requestKey + confirmResolve + answers[{questionId,values}]）；使用 shared `InteractionSummary/Detail/Question/Capabilities/ResolveRequest`，未自造字段。
- 左 360 列表：全部/需要回答/待审阅/待核对/权限策略分段（数量来自服务；加载/错误显示「—」）；行含类型图标、标题、规划轮次/步骤、任务·项目、时间、结果待核对/有草稿徽标。
- 右详情：来源条（任务 · 步骤/轮次 + 打开需求/任务画布）、候选信息（review）、unknown 只读横幅、resolve.allowed=false 原因；问题按服务真实 `inputMode:'free_text'` 渲染 textarea，degradation 横幅明确「选项/多选/推荐值服务未提供」，不渲染假选项；已回答计数 + 必答校验；提交走 resolve，ReceiptNotice 展示 accepted/succeeded/failed/unknown（unknown 锁定内容、仅 operations.by-key 核对；接口本身同步无 unknown，代码仍兼容）；409/400 显示服务原因。
- 草稿：本机内存按 interaction/question 保存；切换事项时 Modal「保留草稿/放弃草稿」；失败回执保留草稿，仅 succeeded 清除。
- 权限/策略：capabilities.permissions=false/policy=false 时显示真实 reason；权限分段展示两张范围卡（仅这一次/本次会话）与禁用按钮原因；策略禁止只读「知道了」禁用；不造权限/策略事项。
- 保留 bootstrap.inbox 汇总：交付确认/执行失败作为「需在画布处理」入口；交互列表读取失败时回退展示全部 bootstrap 汇总并以画布打开；空/加载/错误/无项目/都处理完状态均有真实文案。
- 拒绝回答：按 be-api 最终口径无 reject 字段，按钮置灰并显示 `detail.resolve.reason`（规划问题必须明确回答）；未实现假的二次确认。
- 验证：`npx tsc -p tsconfig.json --noEmit` exit 0；本范围 `--noUnusedLocals --noUnusedParameters` 0；`git diff --check` 通过；无硬编码颜色。真实 5177 只读联调 `GET /api/interactions` 成功（当前 items 为空、capabilities 如实返回 reason），未提交任何写操作；按约束未跑 build:web/全量 test。
- 未覆盖：
  1. 当前真实数据没有 open interaction，未做 detail/resolve 的浏览器端到端点击；建议 Lead 用含待回答问题/候选/核对事项的数据做一次 UI smoke。
  2. 契约无 reject/decision、无 options/多选/推荐；拒绝与选项控件按真实降级显示，不是缺失。
  3. 权限/策略在受管 OpenCode + MCP 架构下无来源，只有能力说明与禁用卡，不应出现真实事项。
  4. `planning_review`/`planning_reconcile` 只能去需求画布或核对原轮次，不在本页提交。

### 21:02 任务完成 | W3-7c（task-25）| 运行内容阅读器 + 历史角色配置页

- 负责人：`fe-ppt`；写范围：新增 `apps/web/src/pages/run/**`、`apps/web/src/pages/roles-legacy/**`，`apps/web/src/app/App.tsx` 仅加 2 条 import + 2 条路由（`/runs/:taskId`、`/roles/legacy`）。未改后端/shared/其他页面/导航/设计稿。Lead 提到的临时冒烟配置 `apps/web/src/pages/run/vite.smoke.config.mts` 已在验证后删除（`find apps/web/src -name 'vite.smoke*'` 为空）；`git status` 仅产品文件。
- 新增文件：`run/RunContentPage.tsx`、`run/RunReader.tsx`、`run/run-shared.tsx`、`run/run.css`、`roles-legacy/RolesLegacyPage.tsx`、`roles-legacy/roles-legacy.css`。样式全部使用设计令牌，`grep -E "#[0-9a-f]{3,6}|rgba?\("` 为空。
- `/runs/:taskId`（运行内容，只读）：
  - 数据来源：`GET /api/tasks/:id/detail`（task/project/plan/execution/workspace）+ `GET /api/tasks/:id/changes` + `GET /api/tasks/:id/nodes/:nodeId`（节点摘要/尝试/输出片段）+ `GET /api/tasks/:id/changes/files/:fileId/diff`（复用现有只读 diff）。不调用任何写接口。
  - 页头：任务名/项目/阶段/执行状态/工作区状态/计划修订 + 「回到执行画布」；统计卡：执行步骤（done/total、失败/执行中）、变更文件（数量与新增/修改/删除，失败显示真实原因）、需求覆盖（covered/total 或「服务未返回 requirementCoverage」）。
  - 左侧导航分组「需求覆盖 / 文档 / 源码 / 单元测试」：需求覆盖来自 `plan.validation.requirementCoverage`（缺失时只列需求正文并明确不推测）；文档=非实现/测试节点；源码=实现节点+变更文件（非测试路径）；单元测试=测试节点+按路径名推导的测试文件（明确服务无绑定字段）。
  - 阅读区：需求正文+覆盖节点跳转；节点摘要/验收条件/尝试（最多 5 次）/输出片段（模型正文、推理摘要、工具调用、服务事件，来自节点只读接口一页）/关联需求；变更文件元数据+只读 hunk diff（行号/增删/截断提示），二进制/过大文件明确不提供 diff。
  - 状态：加载骨架、任务 404 中性提示（不展示示例产物、无操作）、读取失败 ServiceNotice、无计划空态、变更读取失败自定义告警（显示服务 message+code/requestId+重试，不误报「服务未连接」）、无节点/无输出真实空态。
- `/roles/legacy`（历史角色配置，只读）：
  - 数据来源：`GET /api/catalog/roles` + `GET /api/catalog/roles/:id/history` + bootstrap.catalog.methods（planningStrategy.roleId 统计流程使用）。
  - 左侧目录：搜索、按「流程使用的角色 / 专项角色」分组、头像占位（明示不是已配置形象）；右侧：角色头（状态/修订/提示词修订）、四组只读（职责=真实 purpose+responsibilities；能力/资源权限/形象=「服务未提供」并写明契约缺失，不补造）、所属流程与位置（仅 planningStrategy.roleId，无阶段绑定字段）。
  - 发布修订历史：快照列表（最新发布标记）、只读快照详情（明确不是历史会话快照）、两份快照字段 diff 由前端完成（名称/定位变化列 + 职责条目「有 / — / 已移除」并标注新增/移除样式与文字，不只靠颜色）、无快照/仅 1 份快照真实降级；导入配置包/发布草稿按钮禁用并写原因（导入无接口；发布只在角色管理页），提供「去角色管理」链接。
  - 状态：目录/历史加载骨架、读取失败 ServiceNotice、空目录、搜索无结果、无发布历史提示。
- 验证命令与结果：
  - `npx tsc -p tsconfig.json --noEmit` → 0 error。
  - `npx tsc -p tsconfig.json --noEmit --noUnusedLocals` 过滤本任务 3 处范围 → 0。
  - Electron UI 冒烟 47 项断言全 PASS：
    - 真实服务 `/runs/task_0mveps121bbwmuuiqnt`：统计 0/11+失败 1、变更读取失败真实原因、需求覆盖降级、导航 4/5/4/2=15 条、默认需求覆盖阅读、失败节点 28 段真实输出（含 "Let me start by exploring" 与工具调用）、未执行节点空态、404 中性提示且无导航。
    - 隔离服务（临时 dataDir 内真实创建 git 项目/任务/骨架计划/确认/工作区并修改文件、发布角色两次产生 r10/r11 快照）：`/roles/legacy` 目录与分组 1/3、四组（3 组明确未提供）、无历史角色提示、开发工程师 2 份快照+diff 表（名称/定位/职责，新增/移除样式）、对比下拉、需求分析师 3 个流程使用、测试工程师无快照提示；隔离任务 `/runs/:taskId` 导航含源码/测试文件、点击文件时 diff 接口失败按真实服务错误显示（未伪造 diff）。测试数据均在临时目录，已清理。
  - 按约束未运行 `npm run build:web`、未跑全量 `npm test`；未新增导航菜单项。
- 发现的后端缺陷（不在本任务写范围，建议 Lead 另派）：`GET /api/tasks/:id/changes/files/:fileId/diff` 实际返回 500 `REVISION_NOT_FOUND: fatal: bad revision ''`。原因在 `packages/server/src/adapters/git-cli.ts` 的 `diffPage`：`args.push(input.baseSha, input.headSha ?? '', '--', input.path)` 在未传 headSha 时把空字符串作为 revision 传给 git（engine `workspaces.diff` 不传 headSha）。运行内容页的源码/测试文件 diff 因此只能显示真实错误与重试，无法阅读 diff；修复前该能力不可用（页面未伪造）。
- 未覆盖 / 已知限制：
  1. 运行内容没有专用接口：文档产物正文、批次/段落绑定、报告/测试结果、完整输出日志均无契约，页面按节点摘要/一页输出片段/变更 diff 组合并标注降级。
  2. 测试文件与测试节点的绑定按路径名推导（服务无字段）；需求覆盖缺失时不推测。
  3. 历史角色配置缺少能力/资源权限/形象契约与阶段绑定字段，已明确标注；导入无接口、发布在角色管理页，本页只读。
  4. Shell 面包屑：`/runs/:taskId` 未在 navigation.ts 映射（显示「页面」），`/roles/legacy` 显示「角色管理」；navigation.ts 不在本任务写范围，页面内已有明确标题与返回入口。

### 21:06 整合 | Wave 3B 验收通过

- **验收范围**：W3-2 Inbox 后端+前端、W3-7c run/roles-legacy、W2-4b/W2-12/W2-14 后端加固、W4-2 API 文档与路由校验。
- **类型检查**：`npx tsc -p tsconfig.json --noEmit` → exit 0。
- **全量测试**：`npm test` → **360 tests / 54 suites / 349 pass / 11 skipped / 0 fail**（55.1s）。
- **构建**：`npm run build:web` → exit 0；`npm run build:server` → exit 0；`npm run check:docs-routes` → exit 0（docs/api.md 与 ROUTES+服务端注册一致）。
- **运行态验收（5177）**：`GET /api/interactions` 返回真实空列表 + 诚实 capabilities（permissions/policy=false）；`/runs/:taskId`、`/roles/legacy` SPA 路由 200；节点验收/项目详情/知识历史路由可用。
- **功能证据**：Inbox interactions（3 个集成测试，free_text 降级、权限/策略诚实降级、requestKey 回执）；verify_only 只读强制（9 类写接口 403 + migration v11）；远端超时→UNKNOWN（分类矩阵/重放不重发）；storage removeJson；run 页真实任务数据/需求覆盖/节点输出/diff（diff 500 缺陷已记录）；roles-legacy 真实目录/历史/快照 diff。
- **发现缺陷**：`GET /api/tasks/:id/changes/files/:fileId/diff` 在未传 headSha 时 500（`git-cli.ts` 把空字符串当 revision）→ 新登记 W3-12。
- **范围审计**：设计稿未改；临时 Vite 配置已清理；`git diff --check` 通过。
- **新登记 follow-up**：W3-12（diff bug）、W3-13（fetch/fix push UNKNOWN）、W2-4c（readOnly 投影/updateDraft 守卫）、W3-7d（run/roles-legacy 面包屑）。

### 21:10 分派 | Wave 3C

- `be-api` → task-27：W3-12 diffPage headSha、W3-13 fetch/fix push UNKNOWN、W2-4c readOnly 投影/updateDraft 守卫。
- `be-recovery` → task-28：W0-4b 节点验收 gating、W2-15 放弃调整恢复暂停态。
- `design-audit` → task-29：W3-4a 知识库来源选择/引用原文 520 面板/研究员面板。
- `fe-audit` → task-30：W3-9b 设置页执行限制编辑/脏保存条/缺失分区。
- `fe-templates` → task-31：W3-11a 主页展示化 + W3-7d run/legacy 面包屑入口。
- `be-audit` → task-32：W4-3a test:e2e/最小 CI/证据清单。
- `docs-audit` → task-33：W4-1c 文档同步 Wave 3A/3B + design-coverage 更新。
- `fe-ppt` 本波空闲，保留给 W3-6/W3-8 后续。

### 21:06 任务完成 | W3-11a/W3-7d（task-31）| 主页展示化 + run/legacy 面包屑与入口

- 负责人：`fe-templates`；写范围：`apps/web/src/pages/home/**`、`apps/web/src/app/navigation.ts`、`apps/web/src/pages/roles/RolesPage.tsx`。
- 主页展示化（W3-11a）：`HomePage.tsx` 移除统计三卡、「进行中 / 需要你处理 / 最近活动」业务列表、HomeSkeleton/ServiceNotice 分支与 `useBootstrap` 读取；保留 hero、`HomeFlowDemo`、`HomeCapabilities`（能力卡/入口 + 收尾 CTA「从一个目标开始」+ 开始任务）。页面不再读取业务数据、不新增请求；服务连接状态仍由 Shell 全局连接条展示。按任务约定先按设计移除仪表盘，若产品要保留需明确标注「扩展区」并由 Lead 决策。
- 面包屑/选中态（W3-7d）：`navigation.ts` 增加 `/runs/:taskId` → active tasks、面包屑「任务列表 / 运行内容」；`/roles/legacy` → active roles、面包屑「角色管理 / 历史配置」。
- 入口：RolesPage 页头新增「历史配置」LinkButton → `/roles/legacy`（保留「新建职业」）。
- 验证：`npx tsc -p tsconfig.json --noEmit` → exit 0；`--noUnusedLocals` 过滤 `pages/home|app/navigation|pages/roles/RolesPage` → 0；`node --import tsx` 直接断言 `activeNavId('/runs/task_123')=tasks`、`/roles/legacy=roles`，面包屑分别为「任务列表 / 运行内容」「角色管理 / 历史配置」；`git diff --check` 通过。
- 未覆盖：按要求未运行 `npm run build:web`、未跑全量 `npm test`；无浏览器点击验证。原主页仪表盘相关 CSS（`styles/app.css` 的 home dashboards）不在本任务写范围，暂留未清理。

### 21:09 任务完成 | W4-1c（task-33）| 文档同步 Wave 3A/3B + design-coverage 更新

- 负责人：`docs-audit`；写范围：`README.md`、`docs/remaining-work.md`、`docs/verification.md`、`docs/design-coverage.md`；未改 review 报告、`docs/task-assignment.md`、产品代码、设计稿。
- 计数统一：README / remaining-work / verification / design-coverage 均为 **360 tests / 54 suites / 349 pass / 11 skipped / 0 fail**（55.1s，`.tmp/wave3b-verify.log`）；build:web/server 与 `check:docs-routes` 通过。
- README：实现状态改为 Wave 0–3B 完成、Wave 3C 进行中；补 Wave 3A/3B 已实现项；「未完成」清单改为 W0-4b、W2-4c/15、W3-12/13、W3-1b、W3-3~6、W3-8~11、W3-7d、真实环境、打包、视觉回归、文档/CI。
- remaining-work：新增 Wave 3A（节点验收、项目详情四页签、PPT 作品/四步工作台、任务列表/开始页结构）与 Wave 3B（Inbox interactions、`verify_only` 硬只读 v11、远端 UNKNOWN、storage removeJson、run/roles-legacy、API 文档）已完成行；缺口重编 1–12，删除已完成/进行中的旧表述。
- verification：计数 360/349/55.1s；§7/§10 更新 `verify_only`、远端 UNKNOWN、storage、design-coverage、api.md、W3-12 diff、节点 gating；新增 **Wave 3A（348 tests）** 与 **Wave 3B（360 tests）** 验收记录；Wave 2 段的“Wave 3A 进行中”改为“已在 Wave 3A 完成”。
- design-coverage：25 页更新为 **✅ 3 / 🟡 21 / ⛔ 1**；`run`、`roles-legacy`、`ppt-works`、`ppt-studio` 改为已实现（🟡），`knowledge-history` 维持 🟡；唯一整页缺失 `workflow-editor`；明确标注降级（权限/策略/选项无来源、charter/docPaths/GitLab 绑定、diff bug、W3-5 等）。
- 验证：4 文件无旧当前计数（345/348 仅出现在历史验收小节并标注「历史计数」）；无「Wave 3A/3B 进行中」「W3-2 pending」「旧缺口」；design-coverage 25 行、状态计数 ✅3/🟡21/⛔1；链接 0 broken；`check:docs-routes` exit 0；`git diff --check` 干净；未跑全量 test（Lead 已验收 360 tests）。
- 未覆盖 / 说明：Wave 3C 代码正在并行落地（W3-12/13、W3-4a、W3-9b、W3-11a、CI 等），文档按「进行中/待验收」记录；Wave 3C 验收后需再更新一次。

### 21:12 任务完成 | W4-3a（task-32）| test:e2e 修复 + 最小 CI + 证据清单

- 负责人：`be-audit`；写范围：`scripts/test-e2e.mjs`（新增）、`.github/workflows/ci.yml`（新增）、`docs/evidence/README.md`；`package.json` 未改（`test:e2e` 已指向该脚本，路径修好无需改 scripts）；未改产品代码/设计稿/其他文档。
- `scripts/test-e2e.mjs`（新增，约 220 行）：默认 `npm run build:web` → 以临时 dataDir + OS 随机回环端口启动真实 `packages/server/src/main.ts`（`AGENT_WORKFLOW_DISABLE_OPENCODE=1`）→ 断言 `/api/health`（status/version）、`/api/bootstrap`（app.name、隔离 dataDir、projects[]）、`/`（200 text/html 且引用构建 JS）、未知 `/api/*` GET（JSON 404，非 SPA 兜底）；失败打印 server tail 并非零退出；结束 SIGTERM→SIGKILL 兜底并清理临时目录。参数：`--skip-build`、`--keep-data`、`--help`；超时可用 `AGENT_WORKFLOW_E2E_TIMEOUT_MS`。
- `.github/workflows/ci.yml`（新增）：push(main/master)/PR/workflow_dispatch；Node 24 + npm ci + `typecheck` + `npm test` + `check:docs-routes` + `build:web` + `test:e2e -- --skip-build`；`permissions: contents: read`、concurrency、30min 超时；注释明确不跑 live/`test:model`/`ui:smoke`/Electron/打包及原因。
- `docs/evidence/README.md`（重写）：22 张 PNG 全量清单（文件/内容/轮次·提交/数据源 A–D/Wave 0–3 后是否有效），全部标注为 Wave 0 前历史证据、已过期，并给页面级过期原因；说明官方 `npm run ui:smoke` 在当前沙箱因 Electron GPU/sandbox 初始化失败未计通过；区分根 `evidence/`（ui:smoke 自动 11 张 `ui-*.png`，可复现）与 `docs/evidence/`（人工 22 张，含模型/打包场景，手工刷新）；附刷新/复验命令。
- 根 README「界面证据」段落：未改。当前段落已正确区分两个目录并标注截图落后；且 README 正属 docs-audit W4-1c，避免跨写范围冲突；建议 Wave 3C 文档收尾时补一行指向 `docs/evidence/README.md`。
- 验证：
  - `node scripts/test-e2e.mjs` → PASS（build:web 2.19s；server 随机端口；health/bootstrap/SPA/404 四项断言通过；exit 0）。
  - `node scripts/test-e2e.mjs --skip-build` → PASS；`npm run test:e2e -- --skip-build` → PASS（npm 参数透传）。
  - workflow 用 js-yaml 解析：name=CI；triggers=push/pull_request/workflow_dispatch；runs-on=ubuntu-latest；8 steps；必需命令齐全。
  - 清单覆盖脚本：22 张 PNG ↔ 22 行清单，缺失 0；`git diff --check` 干净。
  - 按要求未跑全量 `npm test`/typecheck（Lead 负责）；未跑 `ui:smoke`（沙箱失败且会覆盖根 `evidence/`）。
- 未覆盖 / 注意：
  1. CI 未在 GitHub 实际运行，本地仅做 YAML 结构解析；首次运行需确认 Ubuntu + Node 24 + workspace lockfile 正常。
  2. `docs/evidence/` 截图未重拍（需桌面环境 + 真实 OpenCode/模型 + 打包 .app），清单如实标注全部过期，不伪造新证据。
  3. 根 README 证据段落未改（见上，避免与 W4-1c 冲突）。
  4. `test:e2e` 默认构建会写 gitignored `apps/web/dist`；CI 用 `--skip-build` 复用 `build:web` 产物。

### 21:09 任务完成 | W3-12/W3-13/W2-4c 后端加固（task-27）| be-api

- 负责人：`be-api`；写范围：`packages/server/src/adapters/git-cli.ts`、`packages/server/src/http.ts`、`packages/engine/src/fix.ts`、`packages/engine/src/project-task.ts`、新增 `tests/integration/backend-hardening.test.ts`；`review-plugin.ts`/`actions.ts` 无需改动（fix push 分类在 `FixService`，路由已透传；readOnly 错误/策略 helper 已在 actions.ts）。未改 execution/plan/models、`apps/web/**`、docs。
- W3-12 `diffPage`：
  - `git-cli.ts` 在 `headSha` 未传时改为 `git diff -U3 [--no-color] baseSha -- path`（工作区相对 base 的当前改动，符合 `workspaces.diff` 语义），不再拼空 revision 导致 `ambiguous argument ''` → `REVISION_NOT_FOUND`；传 headSha 时保持 `base..head`。
  - 同时修正 `#run` 的 killed/timeout 识别（此前 `signal: null` 被误判为 killed）、`mapGitError` 增加 `does not appear to be a git repository`/`could not read from remote repository`/`failed to connect|connection refused|unable to access` 分支，`fetch()` 重包装时保留 `details`（含 `reason:'timeout'`）。
- W3-13 remote UNKNOWN：
  - `POST /api/git/repos/:projectId/fetch`：捕获后用 `remoteOutcomeUnknownReason` 分类；timeout/network_error/undetermined → `commands.fail(key, RECEIPT_UNKNOWN, unknown=true)` + 抛 409 `RECEIPT_UNKNOWN`（details: requestKey/operation/outcomeUnknown/reason，可按 `/api/operations/:key` 核对）；业务失败仍 failed。
  - `FixService.push`：同分类；不可判定时 push step 记 `unknown`（error code `RECEIPT_UNKNOWN`）、命令结算 unknown、抛 409 `RECEIPT_UNKNOWN`；auth/校验/非快进等业务失败仍记 failed 并结算 failed（新增 `#recordStepUnknown`）。
- W2-4c readOnly（verify_only）守卫：
  - `ProjectService.updateDraft` 服务层守卫：`task.readOnly===true` → 403 `FORBIDDEN` + details.reason `RECOVERY_READ_ONLY`，且在任何 `commands.begin` 之前（无孤儿回执）。
  - `TaskDetail.planning.actions` 投影按 readOnly 返回 `startPlanning/stopPlanning/reconcile/previewNextRound` 全部 denied（reasonCode `RECOVERY_READ_ONLY` + 既有 READ_ONLY_RECOVERY_REASON）；与 plan/planning/execution/delivery 既有服务层守卫一致。
- 验证命令与结果：
  - `npx tsc -p tsconfig.json --noEmit` → exit 0（并行 agent 收尾后复跑）。
  - `node --import tsx --test --test-force-exit tests/integration/backend-hardening.test.ts` → **5 tests / 5 pass / 0 fail**：
    - diffPage 无 headSha（含未提交改动）与有 headSha 均正常；
    - `remoteOutcomeUnknownReason` 分类矩阵（timeout/network_error/undetermined vs auth/not-a-repo/conflict/普通错误）；
    - fetch：连接拒绝 → 409 RECEIPT_UNKNOWN reason network_error + by-key unknown；挂起 HTTP + 400ms 超时 → killed → 409 reason timeout + by-key unknown；origin 非 Git 仓库 → 非 409、非 RECEIPT_UNKNOWN、by-key failed；
    - fix push：4 类错误（timeout/network/killed/auth）step 状态与回执状态分别 unknown/failed，0 自动重发；
    - readOnly：planning.actions 全 denied、PATCH 任务原文 403 RECOVERY_READ_ONLY 且 requirement 不变、无孤儿回执、普通任务照常成功。
  - 回归：`backend-hardening + api-contract + git-api + git-push + review-fix-api + server-smoke + recovery-modes` → 18 pass / 0 fail。
- 未覆盖 / 说明：
  1. `review-plugin.ts` 未改：fix push 的 UNKNOWN 结算在引擎 `FixService` 内完成，HTTP route/fixEnvelope 自动透传 `{receipt,fix}`；成功/失败路径由 review-fix-api 回归覆盖。
  2. fetch 仍属读操作，但按任务要求把 timeout/network/undetermined 统一结算 unknown（便于按 key 核对，不自动重发）；业务失败（非仓库/认证）保持 failed。
  3. `OperationRecord.error` 只持久化 code/message，分类 reason 只出现在 HTTP 409 details 与抛出的 AppError（by-key 可看到 code=RECEIPT_UNKNOWN + 文案，看不到 reason 字段）——如需持久化 reason 需改 models/storage（本任务写范围外）。
  4. 未跑 `build:web`/全量 `npm test`/浏览器点击（Lead 整合范围）。

### 21:10 任务完成 | W0-4b/W2-15（task-28）| 节点验收 gating + 放弃调整恢复暂停态

- 负责人：`be-recovery`；写范围：`packages/shared/src/domain/models.ts`、`packages/engine/src/{actions,plan,execution,engine}.ts`、`tests/integration`（新增 `node-acceptance-gating.test.ts`、`edit-session-pause-mode.test.ts`）；未改 `http.ts`、`shared/api/contracts.ts`、`fix.ts`、`git-cli`、`apps/web/**`、`machines.ts`（用现有合法迁移）、设计稿、`task-assignment.md`。
- **W0-4b 节点验收 gating（语义选择，写入代码注释与日志）**：
  - 「待人工验收」的判定：**计划节点声明了验收标准**（`PlanNode.acceptance.length > 0`，skeleton / AI 候选都会带）时，该节点执行成功只是 `succeeded`，人工判定（accepted）前不计为完成；没有验收标准的节点（合成计划/旧流程）保持「succeeded 即完成」的旧行为 → 兑现「不破坏现有无验收场景」。
  - 验收状态来源复用 W0-4 的 settings 记录（`execution.node.acceptance.<executionId>.<nodeId>`），在 `actions.ts` 抽出共享助手（key/read/state/gate/clear），`plan.ts` 与 `execution.ts` 共用，避免两套判定漂移。状态：accepted 通过；pending（无记录）或 rejected 均 gate。
  - 完成/下游 gating（`execution.ts`）：
    - `#recomputeReady` 与 `#releaseAdvanceable` 的上游满足条件改为「succeeded +（若声明验收标准则已 accepted）或 skipped」；手动 advance 被验收阻塞时返回真实原因 + `details.awaitingAcceptance`（列出未验收上游节点）。
    - `#settleIdleExecution`：有失败先 failed；否则若 gate 未满足 → **park**（RUNNING→PAUSING→PAUSED 合法两跳，notice「N 个已执行步骤待人工验收；验收通过或按原配置重试后再继续/结束执行」，task attention=waiting_user，不再进入 completed）；全部 gate 通过且无未完成节点才 `#completeExecution`（防御性再查一次 gate，完成 notice 写明「全部步骤已完成并验收通过，等待交付」）。
    - `ExecutionView` 增加派生可选 `acceptance: {pending, rejected}`（`engine.executions.get` 叠加，HTTP 执行视图直接可见）；`computeTaskActions` 增加 `reviewNodeAcceptance` 可用性（有待验收/退回时为 allowed）。
    - 验收后继续：`PlanService` 在 accept/reject 结算后调用 `ExecutionService.reconcileAcceptance(taskId)`（Engine 注入 lazy 回调，避免循环依赖）；全部通过 → 合法恢复 running 并继续 schedule/完成；仍有 pending/rejected → 保持 paused 并更新 notice；用户主动暂停（pause.requestKey 存在）不被自动恢复。
    - 驳回后可重跑：`execution.retry` 现在同时收集「有验收标准且被 rejected 的 succeeded 节点」，允许从 paused 重试，重置节点为 pending 并清除验收记录（新 attempt 重新走验收）；节点状态本身在验收/驳回时仍不被改写（W0-4 边界保持，测试断言）。
  - `machines.ts` 未改：全部走既有合法迁移（pausing/paused、unknown 等），无新状态。
- **W2-15 调整前暂停模式**：
  - `EditSession` 新增 `wasPausedBeforeEdit?: boolean`（持久化在 execution.edit_session JSON，重启可读）。
  - `editBegin` 记录开始调整前的执行状态（running/paused）；`abandonEdit` 恢复该暂停态：原 paused → 保持 paused（notice「任务保持调整前的暂停状态，恢复任务需单独操作」，receipt outcome `restoredStatus:'paused'`，不触发自动恢复）；原 running → running + 恢复 autoAdvance。
  - `editFinish` 一致处理：`continueExecution` 不能覆盖用户暂停（outcome `{continued:false, keptPaused:true}`）；原 running 且 continue 时恢复 running。
  - 测试覆盖：原暂停 abandon 仍 paused / 原运行 abandon 恢复 running（HTTP 路由随后 kick 调度，autoAdvance 关闭时落到正常「等待推进」pause，非用户暂停）/ editFinish 保持暂停 / 跨进程重启后 `wasPausedBeforeEdit` 仍在且 abandon 仍恢复 paused。
- 验证命令与结果：
  - `npx tsc -p tsconfig.json --noEmit` → exit 0。
  - 新增：`node --import tsx --test --test-force-exit tests/integration/node-acceptance-gating.test.ts tests/integration/edit-session-pause-mode.test.ts` → 6 pass / 0 fail。
  - 回归：node-acceptance、execution-control（W2-1/W2-2/W2-13/W2-9）、node-skip、plan-edit-dependencies、task-acceptance、startup-recovery、recovery-readonly、server-smoke → 22 pass / 0 fail；api-contract/routes-contract/recovery-modes/workspace-cleanup-nongit/delivery-mr/delivery-fixroot/directory-apply-api/e2e/insights/review-fix-api/review-fix-recovery/ppt-works → 33 pass / 0 fail。
- 未覆盖 / 说明：
  1. `TaskDetail.capabilities`（`http.ts` 的 viewActions 与 `project-task.ts` detail）使用 `store.executions.get` 原始视图，没有 acceptance overlay：`reviewNodeAcceptance` 在该投影里仍为 denied；执行视图刷新后 `execution.acceptance` 与 nodeDetail `actions.accept/reject` 均可用（UI 主路径）。如需 detail capabilities 也暴露，需 `project-task.ts`/`http.ts` 用引擎视图或传 store（不在本任务写范围）。
  2. gating 只在计划节点声明验收标准时生效（上述语义选择）；若产品要求所有 succeeded 节点都必须验收，需把规则改为默认必验（会改变现有无验收流程与 live 执行测试预期）。
  3. `gated` 节点的用户暂停/编辑冲突边界沿用现有语义；`execution-live` 真实模型测试若启用，skeleton 计划会在待验收处 park（符合设计，但该 live 测试只断言节点成功/文件变更，不要求 completed）。
  4. 未跑全量 `npm test`/build（Lead 整合范围），未做浏览器点击。

### 22:20 任务完成 | W3-4a（task-29）| 知识库体验

- 负责人：`design-audit`；写范围：`apps/web/src/pages/knowledge/**`、`knowledge-history/**`。重写 `KnowledgePage.tsx`，新增 `knowledge.css`；`knowledge-history` 未改（已有返回知识库/新对话/按引用状态降级，满足入口与真实状态要求）。未改 backend/shared/其他页面。
- 来源选择：首屏提问区显示真实资料计数与「查看资料清单」；资料卡从 `/api/knowledge/sources` 列出项目真实文件（md/mdx/txt/rst/json/yaml），支持勾选、全选/全不选、已选 N/M 计数；全部取消时禁止发送。明确标注「勾选只影响本页展示与提示；服务端 ask 无 sources 字段，当前按项目全量资料回答」。
- 引用原文 520 面板：宽屏从右侧进入 `kb-layout` 第二列（520px、sticky、不遮回答）；显示来源正文、`citation.line`/`snippet` 高亮（引用附近窗口，可切全文）、命中行自动滚动；上一处/下一处按 `citations` 切换并带真实禁用原因；窄屏（≤1200）回退现有 Modal，并保留前后切换。
- 研究员检查：`Drawer` 展示真实 answer/question/citations（证据清单，可点开原文）、模型、生成时间、`conversationId`、`usage`、项目与前端已选资料来源；无研究步骤/工具轨迹/角色证据 DTO 的位置明确写「服务未提供」，不造假。主页面同时保留研究员摘要卡与降级说明。
- 历史与状态：页头/历史卡/研究员抽屉均可跳 `/knowledge/history`（带 project）；历史点击可载入回答与 conversationId。来源加载/错误/空、问答中/错误、引用正文加载/错误、研究员空状态均有真实文案；沿用 `PageHeader/Badge/Button/Drawer/Modal/ServiceNotice` 与主题令牌，无硬编码颜色。
- 验证：`npx tsc -p tsconfig.json --noEmit` exit 0；本范围 `--noUnusedLocals --noUnusedParameters` 0；`git diff --check` 通过；Vite dev（5173）转译 `KnowledgePage.tsx`/`knowledge.css` 均 HTTP 200。只读联调 5177：真实项目的 `/sources`、`/history`、`/source?path=README.md` 均返回真实数据，历史引用含 `path/line/snippet`（如 README.md:3）；未发起 `/ask`，避免模型调用与数据写入。未跑 build:web/全量 test，未做浏览器点击。
- 降级/未覆盖：
  1. 研究步骤、工具轨迹、角色证据、流式输出、命中相关度均无 DTO/接口 → 明确显示未提供，不渲染假阶段/分数。
  2. 来源勾选是纯前端：`KnowledgeAskRequest` 没有 sources 字段，不能按勾选过滤，服务端全量回答。
  3. `question`/answer/citations 之外没有多轮消息列表 DTO；研究员面板只显示当前回答对应问题。
  4. 未做真实浏览器点击与 520 面板视觉回归；建议 Lead 用含多条引用的真实历史做宽/窄屏 smoke。

### 21:14 任务完成 | W3-9b（task-30）| 设置页：执行限制编辑/脏保存条/缺失分区降级

- 负责人：`fe-audit`；写范围：`apps/web/src/pages/settings/**`。
- 结构：左侧分区补「执行限制」「重试等待」「发布网络」「开发辅助」；模型服务与执行限制拆开。执行限制开放 `autoAdvanceByDefault`、`nodeTimeoutMinutes`（1–1440 分钟）、`verifyCommandTimeoutMs`（1–120 分钟，display 分钟、存 ms）；监控开放 `pollIntervalMs`（500–30000ms）与 `sessionAlertThreshold`（1–100）。
- 脏状态：新增 settings 级 `SettingsDraftProvider`，字段修改后琥珀描边、分区导航琥珀点、底部保存条显示「N 处未保存 · M 处需重启」+ 放弃/保存；无效值标红 `aria-invalid`、保存条显示需修正数并禁用保存。保存用单次 `PATCH /api/settings`（requestKey），成功后用响应 settings 更新 bootstrap 查询并清空草稿；超时显示「结果未明，刷新核对、不要重复提交」，失败保留草稿并显示真实错误，不伪造成功。
- 真实语义降级：`verifyCommandTimeoutMs` 虽保存但当前验证路径使用 Git 命令超时，徽标写「已提供 · 执行路径未读取」；`maxConcurrentNodes/maxAttempts/pauseTimeoutMs` 执行引擎未读取，仅只读并写原因；业务超时/按类别重试等待无 shared 字段，显示「服务未提供」禁用控件；重试等待分区显示真实 `planning.transportRetries` 只读值。发布网络只读展示 Git 地址/超时并链接 Git 账号；开发辅助明确示例数据开关不可用。
- 保持不退化：Git 账号、数据库、外观、模型服务（OpenCode 路径/运行时/模型档案）仍按各自保存按钮；执行限制与监控共用底部保存条，保存条文案明确说明这一分工。
- 验证：`npx tsc -p tsconfig.json --noEmit` → exit 0；本批 scoped tsc → exit 0；`--noUnusedLocals --noUnusedParameters` 过滤 `pages/settings` → 0（顺带移除 DatabaseSection 未使用常量）；`git diff --check` 通过；按要求未跑 `build:web`/全量测试，未做浏览器点击。
- 未覆盖 / 已知边界：保存条目前只覆盖执行限制 + 监控（Git/模型服务仍独立保存）；`M 处需重启` 当前为 0（这些字段均立即生效）；settings PATCH 响应无 receipt，unknown 只能由请求超时判定，没有 requestKey 对账接口；未验证真实浏览器交互。

### 21:20 整合 | Wave 3C 验收通过

- **验收范围**：W3-12/W3-13/W2-4c 后端缺陷修复、W0-4b 节点验收 gating、W2-15 暂停态恢复、W3-4a 知识库体验、W3-9b 设置页、W3-11a/W3-7d 主页/面包屑、W4-3a e2e/CI/证据、W4-1c 文档同步。
- **类型检查**：`npx tsc -p tsconfig.json --noEmit` → exit 0。
- **全量测试**：`npm test` → **371 tests / 54 suites / 360 pass / 11 skipped / 0 fail**（58.9s）。
- **构建/脚本**：`npm run build:web`、`build:server`、`check:docs-routes` 均通过；**`node scripts/test-e2e.mjs --skip-build` PASS**（真实 server + health/bootstrap/home/未知 API 404）。
- **功能证据**：diffPage 有/无 headSha 正常；fetch/fix push 超时→UNKNOWN 可核对；readOnly 投影/写守卫；节点验收 gating（待验收时 paused、accept 后 completed、reject 可重试）；abandon 恢复暂停态；知识库来源选择/引用 520 面板/研究员面板（研究步骤诚实降级）；设置页执行限制编辑/脏保存条/缺失分区降级；主页展示化；run/legacy 面包屑；CI/证据清单。
- **范围审计**：设计稿未改；无临时配置残留；`git diff --check` 通过。
- **新登记 follow-up**：W0-4c（待验收 UI）、W3-4b（研究步骤/流式 DTO）、W3-9c（数据库/工具/模板结构）、W3-11b（品牌）、W4-1d（文档同步 Wave 3C）、W4-3b（视觉回归/截图）。

### 21:22 分派 | Wave 3D

- `be-api` → task-34：W3-3 角色管理后端（四页签字段/校验/发布快照）。
- `design-audit` → task-35：W3-3 角色管理前端四页签。
- `fe-templates` → task-36：W0-4c 待验收情况条 + W3-10 节点详情子视图。
- `fe-ppt` → task-37：W3-9c 数据库/工具/模板结构缺口。
- `be-recovery` → task-38：W3-6 PE37 引擎（分组细化/作用域/确认前置）。
- `docs-audit` → task-39：W4-1d 文档同步 Wave 3C + 品牌决策。
- `be-audit` → task-40：W4-4/W4-5 打包与真实环境评估。
- 剩余大项：W3-1b charter、W3-4b 研究步骤/流式、W3-5 任务画布扩展/快照、W3-8 工作流编辑器、W3-9c 剩余结构、W4-3b 视觉回归；Wave 3D 验收后继续。

### 21:19 任务完成 | W4-1d（task-39）| 文档同步 Wave 3C + 品牌决策记录

- 负责人：`docs-audit`；写范围：`README.md`、`docs/remaining-work.md`、`docs/verification.md`、`docs/design-coverage.md`；未改 review 报告、`docs/task-assignment.md`、产品代码、设计稿。
- 计数统一：4 个文档均为 **371 tests / 54 suites / 360 pass / 11 skipped / 0 fail**（58.9s，`.tmp/wave3c-verify.log`）；build:web/server、`check:docs-routes`、`test:e2e -- --skip-build` 通过。
- README：实现状态改为 Wave 0–3C 完成、Wave 3D 进行中；补 Wave 3C 已实现项；「未完成」改为 Wave 3D 五项（W0-4c/W3-3/W3-9c/W3-10/W3-6）、W3-1b、W3-4b、W3-5、W3-8、W4-3b/4/5；新增「品牌与命名（2026-10-19 决策）」：继续 `agent-workflow`，设计稿 `opencode-workflow` 仅作来源名、不全局改名；界面证据补 `docs/evidence/README.md`、CI/e2e。
- remaining-work：新增 Wave 3C 完成行（节点 gating、abandon 暂停态、readOnly/updateDraft、diff 修复、fetch/fix push UNKNOWN、知识 W3-4a、设置 W3-9b、主页 W3-11a、CI/e2e、品牌决策）；缺口重编 1–9，删除已完成项。
- verification：计数 371/360/58.9s；§7/§10 更新 verify_only/readOnly/abandon/diff/fetch-fix UNKNOWN/打包/视觉/设计覆盖/品牌；新增 **Wave 3C 验收（371 tests）**（gating/暂停态/diff/UNKNOWN/知识/设置/主页/面包屑/CI/e2e）；历史 Wave 2/3A/3B 小节保留并标注历史计数。
- design-coverage：25 页维持 **✅ 3 / 🟡 21 / ⛔ 1**（唯一缺失 `workflow-editor`）；更新 home（W3-11a）、knowledge（W3-4a→W3-4b）、task（gating/W0-4c/W3-5）、run（W3-12/W3-7d）、settings（W3-9b）、roles-legacy（W3-7d）、recovery（W2-4b/4c/15）等证据/缺口；品牌决策写入「不应误报」。
- 验证：无旧当前计数（360/349 仅历史验收小节标注）；无旧「进行中」表述；链接 0 broken；`check:docs-routes` exit 0；`git diff --check` 干净；未跑全量 test（Lead 已验收 371 tests）。
- 未覆盖 / 说明：Wave 3D 代码正在并行落地（W3-3/W3-9c/W3-10/W3-6 等），文档按「进行中/待验收」记录；Wave 3D 验收后需再更新一次。

### 21:22 任务完成 | W3-9c（task-37）| 数据库 / 工具 / 模板结构缺口（前端诚实降级）

- 负责人：`fe-ppt`；写范围：`apps/web/src/pages/databases/**`、`apps/web/src/pages/tools/**`、`apps/web/src/pages/templates/**`；未改后端/shared/其他页面/App。临时冒烟 Vite 配置（`apps/web/src/pages/templates/vite.smoke.config.mts`）验证后已删除，`find apps/web/src -name 'vite.smoke*'` 为空。
- 改动文件：`databases/DatabasesPage.tsx`（修改）+ 新增 `databases/databases.css`；`tools/ToolsPage.tsx`（修改）；`templates/TemplatesPage.tsx`（修改）。新增 CSS 只用设计令牌，`grep -E "#[0-9a-f]{3,6}|rgba?\("` 为空。
- 数据库（真实字段 / 降级）：
  - 卡片新增「可读范围」= 真实 `connection.database`（注明服务只保存单个库/Schema，没有多 schema 或表级字段）；「授权项目」= 服务未提供（琥珀提示 + 说明服务没有数据库→项目授权字段、执行侧 `database.query` 只按 connectionId 访问）；「最近检查」= 真实 state/lastCheckedAt，探针版本/延迟/能力仅在本会话测试后显示（列表接口无最近 probe 摘要）。
  - 检查结果三格降级：已连接（真实 state）、会话只读（服务未提供，探针无该标记）、只读已强制（查询接口由服务端只读守卫；探针未返回该标记），并注明「现场兼容性尚未验证」。
  - 类型保留真实驱动标签（`驱动 mysql2` / `pg` / `未内置`）；planned 驱动额外标注；抽屉新增「访问范围」：可读库/Schema 输入与授权项目选择均禁用并写原因（服务无多 schema / 项目授权字段）；openGauss、GaussDB 明确「没有类型与驱动契约，不能添加」。
- 工具与 Skill（真实 / 降级）：新增「配置范围」胶囊下拉（仅全局，禁用 + 原因：服务无项目级工具配置契约，settings.opencode.toolsets 为全局）；toolset 启停与 Skill 目录/源文只读保留；单工具开关禁用并写明「服务未提供单工具策略接口」；每个 toolset 卡片新增来源信息（来源类型=内置、MCP 连接状态真实）与「停用此来源…」禁用按钮（无来源级接口）+ 可展开的真实影响清单（该来源下全部工具名，明确仅说明不执行）；底部改为「已接通 / 未接通」边界说明，不再使用陈旧 blanket 文案。
- 模板任务（真实 / 降级）：左侧列表按「报告 / 代码审查 / 开发」分组（按模板 id/名称启发式，页面注明服务无分类字段）；新增「将在 项目 · 分支 上运行模板」说明条（项目名真实、分支取 `project.defaultBranch`，未知时写明「分支未知/由服务决定」）；分支选择、时间范围快捷分段（最近 7 天/本月/自定义/全部历史）、需求文档上传均禁用并写原因（创建任务接口无这些字段），模板参数区标注可表达源码范围；新增 B-06「历史模板 / 自动化档案未接入」只读说明（服务无归档模板/旧模板包/自动化运行记录接口），下方仍只显示真实的「由这个模板创建的任务」。
- 验证命令与结果：
  - `npx tsc -p tsconfig.json --noEmit` → 0 error。
  - `npx tsc -p tsconfig.json --noEmit --noUnusedLocals` 过滤三个页面目录 → 0。
  - Electron UI 冒烟（隔离 dataDir + 真实 HTTP 服务：1 个真实 git 项目、3 个自定义模板（报告/代码审查/开发）+ 默认模板、2 个数据库连接；临时 Vite 关 HMR）33 项断言全 PASS：工具页配置范围/单工具/来源停用/影响清单/边界说明/Skill 页签；数据库页两张真实卡片、驱动标签、可读范围/授权项目/三格检查、openGauss/GaussDB 说明、编辑抽屉两个禁用字段与原因；模板页分组计数 报告1/代码审查1/开发2、启发式说明、B-06 说明、项目+main 运行说明条、分支/时间范围/文档上传禁用原因、设计稿范围控件说明。测试数据均在临时目录，已清理；临时服务与 Vite 已关闭。
  - 更早一次对真实 dev 服务（5177）的同类冒烟中同样结构通过（后因外部服务重启中断，改用隔离服务完成全量断言）。
  - 按约束未运行 `npm run build:web`、未跑全量 `npm test`。
- 未覆盖 / 已知限制：
  1. 数据库：无多 schema/表级可读范围、无数据库→项目授权、无会话只读字段、无最近 probe 摘要持久化；openGauss/GaussDB 无类型与驱动契约。
  2. 工具：无项目级配置范围、无单工具开关、无来源级停用、无外部 MCP 来源与 Skill 安装状态接口；停用影响清单由静态工具注册推导，仅说明。
  3. 模板：无模板分类字段（分组为启发式）、无时间范围/源码范围/需求文档上传/分支字段；B-06 历史模板与自动化档案无接口，只提供只读说明。

### 21:22 任务完成 | W3-6（task-38）| PE37 分组逐步细化引擎（scope 校验 + apply/confirm 前置）

- 负责人：`be-recovery`；写范围：`packages/shared/src/domain/planning.ts`、`packages/engine/src/planning.ts`、`packages/engine/src/plan.ts`、`tests/integration`（新增 `pe37-scope-planning.test.ts`）；未改 `http.ts`、`shared/api/contracts.ts`、`shared/errors.ts`、`apps/web/**`、storage/其他服务。
- **引擎 API（下一波 HTTP/UI 接线入口）**：
  - `PlanningService.proposal(taskId): PlanningProposal`：按当前草稿计算每组 `{groupRef, title, coverage[], state: refined|unrefined|planning|candidate, refinedInRound?, leafCount, placeholderNodeIds[]}` + `unresolvedScopes[]` + `limits{maxNodes,maxGroups,maxDepth,currentNodes,currentGroups,projectedLeafCount}`。只读，不调模型。
  - `PlanningService.refinePreview(taskId, groupRef): RefineScopePreview`：`{previewRef, round(新轮次 ordinal), scope{groupRef,groupTitle,placeholderNodeIds[],basePlanRevisionId}, limits, budget{dispatches,revisions,budgetLimit,...}, expiresAt, blockers, instructions}`；不调模型；已细化组/有进行中轮次/has-fixed-template 均拒绝。
  - `PlanningService.start(taskId, input: PlanningStartRequest & { scope?: { groupRef } })`：带 scope 时消费 refinePreview 的 previewRef，创建**新的一轮**（独立派发/修订配额），提示词追加「本轮范围（PE37 分组细化）」；不带 scope 保持旧整份规划。
  - `PlanningService.roundScope(roundId)` / `candidateScope(planRevisionId)` 公开只读 getter；持久化 key 常量 `PLANNING_ROUND_SCOPE_KEY` / `PLANNING_CANDIDATE_SCOPE_KEY` / `PLANNING_GROUP_REFINED_KEY` 从 shared 导出（settings JSON，无迁移/无新增 storage 列）。
- **作用域校验与合并（shared/domain/planning.ts）**：
  - `validateScopedCandidate`：结构校验只跑组内子图；越界节点/分组、与组外步骤 key 冲突、引用组外未知节点、引用本组将被替换的旧节点 → 结构化 problem `code: SCOPE_VIOLATION`（severity hard，带 nodeKey/detail）；合并后节点/分组数超上限 → LIMIT_*；checks 含 S1 范围合法、S2 规模。
  - `mergeScopedCandidate`：其他组节点/ID 原样保留；组内 placeholder 被候选叶子替换；**跨组边按总览保留**——指向 placeholder 的入边重连到组内入口叶子、placeholder 出边从组内出口叶子重连；组内边新增；候选引用已存在组外节点的边作为跨组边保留；组标记 refined=true。
  - `unresolvedPlanScopes(graph)`：`refined===false` 或仍有 `placeholder.*` 节点的组。
  - 占位约定：`PLACEHOLDER_KEY_PREFIX='placeholder.'`，节点 kind=system、不可执行；confirm 前必须全部替换。
- **apply / confirm 行为**：
  - `planning.apply` 识别候选 scope：只写未确认草稿（新 revision，测试断言 base=1 → scoped candidate=2 → 第二次 apply=3），其他组节点 ID/内容不变；应用后若仍有未细化组 → task 保持 `planning` 阶段；全部细化才进入 `confirming`；receipt outcome 增加 `{groupRef, unresolvedScopes[]}`。
  - `plan.confirm` 前置：`unresolvedPlanScopes(plan.graph).length===0`；否则抛 `PLAN_REVISION_CONFLICT`（HTTP 409），`details={code:'SCOPE_UNREFINED', groups:[组标题], unresolvedScopes:[groupRef]}`。**专用 ErrorCode 需改 shared/errors.ts（不在本任务写范围，下一波 be-api 可加 `SCOPE_UNREFINED`/`SCOPE_VIOLATION`）**。
  - 越界候选：`submitCandidate` 返回 `{ok:false, problems:[{code:'SCOPE_VIOLATION',...}]}` 且**不创建 plan revision**（测试断言 plans 数量不变、round.candidate 为空），MCP 工具可把 problems 回给模型修正。
- **测试（fake opencode，Engine + 真实 SQLite 引擎级）**：`tests/integration/pe37-scope-planning.test.ts`
  - scope 全链路：proposal（refined/unrefined、leafCount、unresolvedScopes）→ refinePreview（round/scope/limits、不调模型）→ scoped start（新轮次、prompt 含范围说明、start 回执轮次结束后 succeeded）→ 候选合并（其他组 ID 不变、跨组边重连入口/出口、candidate scope/refined map 持久化）→ apply（revision 2、task 仍 planning、group refinedInRound=1、unresolvedScopes=[g3]）→ confirm 被拒（details SCOPE_UNREFINED）→ 第二轮细化 g3（round=2）→ apply（revision 3、全部细化、task confirming）→ confirm 成功（preparing、无 placeholder）。
  - 越界：范围外分组/节点候选返回 SCOPE_VIOLATION、不落 plan revision；同时验证 proposal 的 planning→candidate 状态、已细化组不能再次 preview。
  - 旧整份规划：无 scope 的 preview/start/apply/confirm 全链路不受影响（skeleton 方法必填步骤候选，confirm 无 SCOPE_UNREFINED 拦截）。
- 验证：
  - `npx tsc -p tsconfig.json --noEmit` → exit 0。
  - `node --import tsx --test --test-force-exit tests/integration/pe37-scope-planning.test.ts` → 3 pass / 0 fail。
  - 回归：recovery-modes、plan-edit-dependencies、server-smoke、pe37 → 10 pass / 0 fail；此前同批 recovery-api/startup-recovery/execution-control 18 pass。未跑全量 `npm test`/build（Lead 范围）。
- 下一波接线需求（HTTP/UI）：
  1. 契约/路由（be-api）：`GET /api/tasks/:id/planning/proposal`（或并入 detail）、`POST /api/tasks/:id/planning/refine-preview {groupId}`、复用 `planning/start` 增加可选 `scope:{groupRef}` 并回传 scoped round id、`planning/apply` 透传 unmodified；如需专用错误码，在 shared/errors.ts 增 `SCOPE_UNREFINED`/`SCOPE_VIOLATION` 并把 confirm 的 details.code 映射为独立错误（否则前端按 code+details 识别）。
  2. UI（design）：PE37 总览用 proposal.groups 渲染 refined/unrefined/planning/candidate + 虚线 placeholder、继续规划选区弹窗（refinePreview 字段）、停止只停本轮、组候选 diff、确认禁用原因（SCOPE_UNREFINED groups）、全部细化后确认。
  3. `TaskDetail.planning.actions` 目前只有 startPlanning/stopPlanning；如需「继续规划选区」按钮可用性，需在 actions/project-task 投影加 group 级 action（下一波）。
  4. proposal/refinePreview 目前是引擎方法而非 DTO；HTTP 层可直接 envelope 返回（类型已在 shared/domain/planning.ts 导出）。

### 21:23 任务完成 | W3-3 角色管理后端四页签（task-34）| be-api

- 负责人：`be-api`；写范围：`packages/shared/src/domain/{models,enums}.ts`、`packages/shared/src/api/contracts.ts`、`packages/engine/src/role-catalog.ts`、`packages/server/src/http.ts`、新增 `tests/integration/role-catalog-extended.test.ts`；`engine.ts` 无需接线（RoleCatalogService 既有实例）。未改 `apps/web/**`、其他后端服务、docs。契约已同步 Lead 与 design-audit（task-35 UI）。
- 契约（shared 实际形状）：
  - `RoleDefinition` 新增**可选**持久化字段：`instructions?`、`model?`、`maxRuntimeMinutes?`、`capabilityGroups?`、`resourcePermissions?`、`image?`（保持旧数据/内置目录可校验）。
  - 新增 `RoleDefinitionResolved`（instructions/capabilityGroups/resourcePermissions 必填）、`RoleCapabilityGroupView`、`RoleCapabilityItem`、`RoleResourcePermissions{tools/files/commands(argv)/resources}`、`RoleImageBinding`、`RoleImageHistoryEntry`、`RolePublishCheck`。
  - `RoleCatalogEntry`（API 返回）：顶层 = **已发布/当前生效内容**（列表语义不变，引擎也用这一份）；`hasDraft=true` 时新增 `draft: RoleDefinitionResolved`（完整四页签草稿）。`imageHistory[]`（旧修订无记录为无 image 的占位条目）、`publishChecks?`（有草稿时给出四项检查）、`status/baseId/hasDraft/updatedAt` 不变。
  - `RoleSaveRequest` 新增同名字段（可选）：`capabilityGroups[{id,items:[{id,enabled}]}]`（label 服务端规范化）、`resourcePermissions`、`image{id,kind,value,label?}`；`image:null` 表示清除绑定；未传字段沿用「上一草稿 → 已发布 → 内置默认」。`RoleRevisionSnapshot` 增加可选新字段。新增非变更 `POST /api/catalog/roles/:id/validate`（`ROUTES.catalogRoleValidate`）→ `{roleId,hasDraft,draftRevision,publishedRevision?,canPublish,checks[],reason?}`，无需 requestKey/无回执（非变更）。
  - 能力目录（4 组 11 项）放 shared enums：知识与资料（项目知识/知识对话/公共知识检索/文档读取/文档写入）、数据（数据库结构/数据库读取）、任务（任务证据/GitLab 读取）、工具（原生工具/外部 MCP）；默认开启集按设计示例。
- 引擎（role-catalog.ts 扩展，保留 draft/publish/history/restore/archive 行为）：
  - `resolveRole` 默认值兼容：旧 settings 记录/旧历史快照缺字段 → 派生 instructions（定位+职责）、默认能力组、空资源权限；未知/畸形旧字段被安全过滤。
  - 保存校验：能力分组/条目必须属于 shared 目录且分组匹配、无重复；工具 kind/名称、文件路径必须工作区相对（拒绝绝对路径与 `..`）、命令 argv 逐参数 1–32（允许空字符串参数）、资源能力 id、model 格式、maxRuntimeMinutes 1–1440、image kind/value/label；非法 → 400 VALIDATION_FAILED（带字段 details）。
  - 发布前检查 4 项：职责与指令完整（instructions 为空 → error）、能力范围（0 项 → error，否则列出已启用项）、资源权限（计数）、形象（未绑定 → warn「历史任务会显示占位」）；`changes` 给出与上一发布修订的差异（名称/指令/模型/能力/工具/文件/命令/资源/形象）。publish 复用同一检查：有 error → 命令结算 failed + 400（details.checks/canPublish）。
  - 发布快照包含全部新字段；发布记录 = 草稿全量（清除 image/null 不会被旧发布值回填）；历史最多 20 条，restore 旧快照按默认值兼容；列表 imageHistory 由历史生成。
- 验证命令与结果：
  - `npx tsc -p tsconfig.json --noEmit` → exit 0。
  - `node --import tsx --test --test-force-exit tests/integration/role-catalog-extended.test.ts` → **5 tests / 5 pass / 0 fail**（完整字段保存+默认值+validate+publish+history/两版 imageHistory；全关能力发布拦截+失败回执可核对；17 类非法输入 400；旧 settings/旧历史快照兼容+restore+再发布 r10；内置 override 顶层已发布/`draft` 分离）。
  - 回归：`roles-api + routes-contract + role-catalog-extended + review-compare + template-import` → 10 pass / 0 fail。
  - 运行中 5177 探针：`GET /api/catalog/roles` 返回 4 个内置角色含 instructions/capabilityGroups(4 组)/resourcePermissions/imageHistory；`POST /api/catalog/roles/role.developer/validate` 返回 4 项 checks（canPublish=false，reason 无草稿）。
- 未覆盖 / 说明：
  1. `RoleCatalogEntry` 顶层扩展字段在 TS 类型上仍为可选（继承 RoleDefinition，兼容 roles-legacy 页与旧 API 消费者），服务实际总是返回解析后的值；UI 请用 `??` 兜底。
  2. 「使用情况（按职业统计流程步骤）」设计标注 PROPOSED，未实现；「发布权限预估」不在本任务范围。
  3. 未跑 `build:web`/全量 `npm test`/浏览器点击（Lead 整合范围）。

### 21:22 任务完成 | W0-4c/W3-10（task-36）| 待验收情况条 + 节点详情子视图

- 负责人：`fe-templates`；写范围：`apps/web/src/pages/task/**`、`apps/web/src/pages/node/**`。
- 改动文件：`pages/task/TaskCanvasPage.tsx`、`pages/node/NodeDetailPanel.tsx`、`pages/node/NodeSubviews.tsx`（新增）、`pages/node/node.css`。
- 待验收（W0-4c）：任务详情读模型由原始 execution 构建、不含验收投影，因此页面额外读取 `GET /api/tasks/:id/execution`（同一套 SSE/轮询刷新）取得 `execution.acceptance`。情况条显示「待验收 N / 已退回 N」；banner 显示「N 个已执行步骤待人工验收」及暂停在验收点 / 用户暂停 / waiting_confirmation 的原因；唯一主动作「去验收」打开第一个 pending 节点的 `NodeDetailPanel` 概览验收区（URL `accept` token 保证同节点重复点击也聚焦）；驳回时显示「按原配置重试失败 / 被退回步骤」按钮（`execution.retry`，会清除退回结论并建新 attempt）与「查看退回原因」；验收/驳回后 NodeDetailPanel 命令刷新全部 workflow 查询，验收通过后服务自动恢复 running 或完成。旧读模型缺投影时按计划验收条款 + 节点成功状态降级提示并注明「服务未返回验收投影 / 投影读取失败」，不伪造结论。
- 节点详情子视图（W3-10）：新增 `NodeSubviews.tsx`——工具详情（callId/状态/来源/尝试/记录序号；长文本 pre + 自动换行 + 已加载内容 200 行分段；JSON 仅前端格式化；代码/命令输出提示无行号；失败横幅；完整参数/无权限/缺能力/脱敏/截断/增量读取均明确写“服务未提供”）、产物详情（id/修订/sha256/类型/大小/来源尝试；文本型说明服务无正文读取接口、不支持格式说明；下载按钮禁用并写原因）、引用原文（需求条目节选 + 服务返回的字符区间高亮；无代码行/版本时明确降级）；三者在右侧 900px 宽阅读区打开（`node-side-wide`，可「宽阅读/收起宽阅读」，Esc 先关阅读区），返回保留节点与页签。执行现场新增断线提示与 seq 缺口提示（只展示已持久化内容、不补造）。
- 验证：`npx tsc -p tsconfig.json --noEmit` → exit 0；`--noUnusedLocals` 过滤 `pages/node|pages/task` → 0；真实服务探针：`/execution` 返回 `acceptance.pending`、`/detail` 无投影（页面因此读 execution）；accept 后 paused→completed；reject 后保持 paused 且 `rejected:[node]`；`execution.retry` 返回 `{retried:1,rejectedRetried:1}` 并清除退回结论；`tests/integration/node-acceptance.test.ts` 3 pass；`git diff --check` 通过。
- 未覆盖：按要求未运行 `npm run build:web`、未跑全量 `npm test`；无浏览器点击验证。设计中的「平移到该节点」未实现——`FlowCanvas` 没有暴露 reveal/focus API 且不在本任务写范围，当前动作是打开该节点的 NodeDetailPanel 验收区（节点高亮），平移能力需另开 flow 任务。

### 21:23 任务完成 | W4-4/W4-5（task-40）| 打包重建 + 签名/公证评估 + 真实环境评估

- 负责人：`be-audit`；写范围：新增 `docs/packaging.md`、`docs/remaining-work.md`（仅相关条目）、`release/`（gitignored 产物）；未改产品代码/其他文档/设计稿。
- W4-4 打包（当前代码）：`npm run dist:dir` **exit 0**（21:20；首次 21:16 因同波次 agent 并行改 `packages/shared` 导致 typecheck 临时失败，工作树稳定后重跑成功）。产物 `release/mac-arm64/Agent Workflow.app`：**346MB**、arm64 thin、`LSMinimumSystemVersion 13.0`、Electron 44.7.0（内置 Node v24.21.0）；含 `.build/{server,mcp,desktop}` + `apps/web/dist` + 生产 `node_modules`（fastify/mysql2/**pg**/pptxgenjs）。当前 `mac.target` 只有 `dir` → **无 dmg/zip/pkg**；默认 Electron 图标；`asar:false`（builder 警告，外部 Node/MCP 所需）。
- 签名/公证：本机 `security find-identity` **0 valid identities**；配置 `identity:null`，日志 `skipped macOS code signing`；`codesign -dv` 仅 adhoc/linker-signed、TeamIdentifier 未设置；`codesign --verify --deep --strict` **exit 1**、`spctl -a -vv` **exit 1**；未公证。分发需 Developer ID + hardened runtime + entitlements + notarytool/stapling（步骤写入 `docs/packaging.md` §5）。
- 启动冒烟：①打包内 server+Web（无 GUI，系统 node + 临时 dataDir + 5399/禁用 OpenCode）→ `/api/health` 200、`/` 200 text/html、`/api/bootstrap` 隔离 dataDir 正常，**PASS**。②默认 GUI 启动（`AGENT_WORKFLOW_CAPTURE`）在本沙箱 **FAIL**：`sandbox initialization failed: Operation not permitted` → `GPU process exited unexpectedly: exit_code=6` → `GPU process isn't usable. Goodbye.`，无截图（环境限制，非产品判定）。③追加 `--no-sandbox --disable-gpu --disable-dev-shm-usage` 后 **PASS**：包内 server 起于 5397，`capturePage()` 输出 2880×1758 PNG（当前主页，底部「未连接 OpenCode」——包内不捆绑 opencode），应用自行退出；本机副本 `release/w4-4-packaged-capture.png`（gitignored，不入库）。
- W4-5 真实环境：本机 **无 PostgreSQL/GitLab 实例或凭据**（env 无 `PG*/WF_PG*/GITLAB*`；5432/5433/6432/80/443/8080/8929 无监听；Docker 仅 snowluma；无 psql/Postgres.app/glab；`.tmp` 只有 GitHub PAT 与 MySQL 凭据）。仓库 **无 PG live 测试**（`database-live.test.ts` 仅 MySQL）且 **无 GitLab live 测试**（仅 `gitlab-mr.test.ts` 桩）；`application.ts:86` 仍 `gitlabConfigured: () => false`（W2-5 pending）。已做离线验证：`packages/database/src/service.test.ts` **19 pass**、`jdbc:postgresql://...` 解析为 `{type:'postgresql',port:5432,...}`。**未写任何 live PASS**；所需环境变量/补测步骤写入 `docs/packaging.md` §7（PG：`WF_PG_URL/WF_PG_USER/WF_PG_PASSWORD` + 新增 PG live；GitLab：`GITLAB_TEST_BASE_URL/API_URL/TOKEN/PROJECT` + 先完成 W2-5）。
- 文档：新增 `docs/packaging.md`（环境/方式/产物/签名/启动冒烟/W4-5/限制/下一步/复现命令）；`docs/remaining-work.md` 更新第 12/18/19 行、新增 W4-4/W4-5 行、重写缺口 6/7，明确「未签名/未公证/无安装包/仅 arm64/默认图标/asar 关闭/无自动更新/未捆绑 OpenCode/Windows-Linux 未验证/GUI 默认未在桌面验收」。
- 验证：`npm run dist:dir` exit 0；产物存在（346MB）；codesign/spctl 真实 exit 1；打包内 server smoke 全断言通过；GUI workaround capture 文件存在；`git diff --check` 通过；`release/` 被 `.gitignore` 忽略；未跑 live/全量 test（Lead 负责）。
- 未覆盖：签名/公证/dmg/Windows/Linux/自动更新/CI 打包；桌面环境默认参数 GUI 人工验收；PG/GitLab live（缺实例与凭据）；arm64 之外架构；应用图标与真实窗口交互。

### 21:35 任务完成 | W3-3（task-35）| 角色管理四页签前端

- 负责人：`design-audit`；写范围：`apps/web/src/pages/roles/**`。重写 `RolesPage.tsx`，新增 `roles.css`；未改 backend/shared/其他页面/路由（现有 `/roles` 入口保留）。
- 契约匹配（task-34 最终 shared）：顶层 = 已发布/生效内容，`hasDraft=true` 时读取 `draft: RoleDefinitionResolved` 编辑与比对；保存发送 instructions/model/maxRuntimeMinutes/capabilityGroups（id+items enabled）/resourcePermissions（tools、files、commands argv、resources id）/image（含 null 清除）；发布前调用 `POST /api/catalog/roles/:id/validate`，检查项/`canPublish`/`reason` 来自服务；publish/history/restore/archive 沿用现有命令路由。多值/命令参数按数组传递，空字符串参数保留。
- 四页签与头卡：左 280 职业列表（头像/名称/发布修订/草稿状态/未保存修改）；头卡名称、发布+草稿徽标、使用情况一句话、保存草稿/检查并发布；职责与指令（name、只读 id、purpose、1–12 职责条目、instructions 大文本、模型、单步最长运行 1–1440 整数）；右侧使用情况（只统计服务 bootstrap 的规划职责引用，步骤级统计无 DTO 已注明）、版本、发布历史/归档入口。
- 能力范围：服务返回的四组目录与胶囊开关，顶部说明与资源权限区别；保存只传 id+enabled，labels 由服务规范化。
- 资源权限：公式「职业上限 ∩ 项目 ∩ 运行环境 ∩ 冻结范围 = 实际可用」；工具/文件/命令/资源四组，工具/文件/资源可增删，命令以 argv 数组逐参数展示，空参数显示「空参数」，行内编辑器可增删参数（最多 32）、每参数一格不按空格拆分、可填 workspace；应用前保存/发布/切换均被阻止并显示原因，切换时弹「继续编辑/放弃修改并切换」。所有改动先落本地草稿，保存后才持久化。
- 形象：当前绑定（含清除绑定，image:null）、服务返回的 imageHistory 当前发布修订形象、缺失条目显示占位；明确“历史任务显示当时形象，不回填当前形象”；服务无可选形象目录，因此不伪造候选/绑定操作。
- 发布前检查：先 save 草稿且无未应用修改，再 validate；Modal 逐项列 checks（state/detail/service changes）与前端 full-draft 差异（名称/purpose/职责/指令/模型/运行时长/能力/工具/文件/命令/资源/形象；旧快照缺字段时明确无法比对，历史 DTO 缺失时用当前已发布内容比对）；确认后 publish；对话框说明已冻结任务继续使用旧修订；保存/发布回执 unknown 或 accepted 时全页锁定，ReceiptNotice 按原 requestKey 核对，不自动重发。
- 验证：`npx tsc -p tsconfig.json --noEmit` exit 0；本范围 `--noUnusedLocals --noUnusedParameters` 0；`git diff --check` 通过；Vite dev（5173）转译 RolesPage/roles.css HTTP 200；真实 5177 只读联调 `GET /api/catalog/roles`（新扩展字段）与 `POST /api/catalog/roles/role.developer/validate`（canPublish=false + reason）成功。未提交 save/publish/restore/archive 写操作；未跑 build:web/全量 test，未做浏览器点击。
- 未覆盖/降级：
  1. 使用情况只有流程 planningStrategy.roleId 引用；服务没有步骤级使用统计 DTO，页面明确注明。
  2. 已发布版本权限预估（B-03 preview/slots）无接口，资源权限页显示「服务未提供」，不伪造实际可用结果；已发布版本回执核对（B-02）以发布历史/顶部已发布内容降级展示。
  3. 形象只有当前绑定与发布历史形象；无可选形象目录/独立绑定接口，不伪造备选图；清除绑定已按 image:null 支持。
  4. model/maxRuntimeMinutes 未传时服务沿用上一草稿→已发布→默认，当前契约没有显式清除语义；页面已写明，不承诺清除。
  5. 建议 Lead 用一份含 draft 的角色做一次保存→检查→发布→unknown/历史的浏览器 smoke；真实 5177 当前无 draft。

### 21:30 整合 | Wave 3D 验收通过

- **验收范围**：W3-3 角色四页签（后端+前端）、W0-4c/W3-10 待验收与节点详情、W3-9c 数据库/工具/模板、W3-6 PE37 引擎、W4-1d 文档同步、W4-4/W4-5 打包与环境评估。
- **类型检查**：`npx tsc -p tsconfig.json --noEmit` → exit 0。
- **全量测试**：`npm test` → **379 tests / 54 suites / 368 pass / 11 skipped / 0 fail**。
- **构建/脚本**：`build:web`、`build:server`、`test-e2e --skip-build` 通过；`check:docs-routes` 首次因 validate/内部 MCP 未文档化失败，运行 `npm run docs:api` 重新生成并补 validate 元数据后 **exit 0**（148 路由，唯一 warning 为单个 MR 契约预留）。
- **功能证据**：角色保存/发布/历史含新字段（5 个集成测试）、四页签 UI；待验收情况条/去验收/重试；节点详情工具/产物/引用子视图；数据库/工具/模板诚实降级；PE37 引擎全链路（3 个测试）；打包产 346MB .app、未签名/未公证且已记录；PG/GitLab 本机无环境，未伪造 PASS。
- **范围审计**：设计稿未改；临时配置已清理；`git diff --check` 通过。
- **状态**：W4-5（真实 PG/GitLab）标记 blocked（需用户提供环境/凭据）；W3-6 引擎完成但 HTTP/UI 未接（W3-6b）；新增 W3-8a/W3-8b 工作流编辑器拆分。

### 21:32 分派 | Wave 3E

- `be-api` → task-41：W3-6b PE37 HTTP/contracts 接线 + W3-1b 项目公约/docPaths/GitLab 后端。
- `design-audit` → task-42：W3-6b PE37 UI（总览 4 态/选区预览/组候选/确认拦截）。
- `be-recovery` → task-43：W3-8a 工作流编辑器后端核心（method-catalog.ts + 测试；不接 http/engine/contracts）。
- `fe-audit` → task-44：W4-3b ui:smoke 兼容 flags + 截图刷新/证据。
- `docs-audit` → task-45：W4-1e 文档同步 Wave 3D + 打包/blocked 状态。
- 剩余：W3-4b 研究步骤/流式、W3-5 任务画布扩展/快照评审、W3-8b 工作流编辑器 UI、W4-5/W2-5 真实环境（blocked）、W4-3b。

### 21:36 任务完成 | W3-8a（task-43）| 工作流编辑器后端核心：method catalog CRUD/校验/版本/合并视图

- 负责人：`be-recovery`；写范围（收敛）：新增 `packages/engine/src/method-catalog.ts`、新增 `tests/integration/method-catalog.test.ts`；**未改** `engine.ts`、`http.ts`、`shared/api/contracts.ts`、`shared/domain/*`、`packages/storage/src`、`apps/web/**`。服务类可独立 `new`（测试直接实例化，无 Engine/HTTP 依赖）。
- **持久化**：自定义流程以 JSON 存在 `store.settings` 的 `catalog.methods.custom`（数组，元素 `{method, version, archived, copiedFrom?, createdAt, updatedAt}`）；请求幂等记录在 `catalog.method.requests`（requestKey→{bodyHash,result}，最多 200 条）。无迁移、无 storage 改动。
- **引擎 API（`MethodCatalogService`，下一波 be-api 接线）**：
  - `list(query?: {includeArchived?, source?: 'builtin'|'custom'|'all', q?}): MethodCatalogEntry[]` — **合并视图**：内置 5 条（只读、source=builtin、version 由 revision 尾数解析，如 r12→12）+ 自定义（source=custom、version/archived/updatedAt/copiedFrom）；默认隐藏归档；支持搜索与来源筛选。
  - `get(id): MethodCatalogDetail` — 内置/自定义同构详情；404 未知；归档仍可读（历史）。
  - `validate({draft, id?}): {ok, problems[], checks[]}` — 编辑器「检查」+ 保存前复用；`id` 传入时按「正在编辑的基线」校验交付步骤保留。
  - `create({requestKey, draft, confirmCreate})` / `save(id,{requestKey, method, expectedVersion, confirmSave})` / `copy(id,{requestKey, name?, confirmCopy})` / `archive(id,{requestKey, confirmArchive})` → `{requestKey, replayed, method}`：service 层 requestKey 幂等（同 key 同 body 重放、不同 body → REQUEST_KEY_REUSED），显式 confirm 缺失 400；下一波再包 `CommandService`/回执与 OPERATIONS 注册。
  - `instantiate(id): {method: WorkflowMethod, source, customVersion?, frozen: true}` — 深拷贝版本快照（已开始的冻结语义）；归档不可用（CONFLICT）、未知 404。
  - `resolve(id): WorkflowMethod | undefined` — 合并解析（custom 优先，当前无同 id 覆盖）。
- **默认值**：create 时 `support` 默认 `ai_planning`、`description` 默认空串、`refinableGroups` 默认 `[]`、`planningStrategy` 可选；id 自动生成 `method.custom.<slug>-<8位>`；version 从 1 开始，`revision=r<version>`；copy 默认名「源名称 副本」，版本从 1 开始并记录 `copiedFrom{id,version}`；archive 为版本化状态变更（version+1，含 archivedAt 语义字段 updatedAt），不删除定义/历史。
- **校验规则（problems code，全部硬失败）**：`NAME_INVALID/DESCRIPTION_TOO_LONG/SUPPORT_INVALID`；`STEPS_EMPTY/STEPS_TOO_MANY(>50)`；`STEP_KEY_INVALID(小写模式)/STEP_KEY_DUPLICATE`；`STEP_TITLE_INVALID/STEP_GROUP_INVALID/STEP_KIND_INVALID`；**交付/验收保留**：必须至少一个 delivery 或 verify 步骤（`DELIVERY_ACCEPTANCE_MISSING`），save 时不能删除基线中的 delivery 步骤 key（`DELIVERY_STEP_REMOVED`）；**职业存在**：`planningStrategy.roleId` 与可选 step `roleId` 必须在有效角色目录（`PLANNING_ROLE_UNKNOWN/STEP_ROLE_UNKNOWN`，默认取实时 `DEFAULT_CATALOG.roles`）；**环路**：前向兼容的可选 step `requires[]` 依赖未知（`STEP_DEPENDENCY_UNKNOWN`）或成环（`METHOD_CYCLE`）；`REFINABLE_GROUP_UNKNOWN/GROUPS_TOO_MANY(>20)`。`checks` 提供 M1–M8 状态供编辑器浮层展示。
- **版本/冲突**：`save` 必须带 `expectedVersion`；不等于当前版本 → `CONFLICT` + `details.currentVersion`（编辑器「已被更新为版本 N / 查看版本 N / 导出我的修改」）；成功 version+1、revision `rN`。内置流程 save/archive → `VALIDATION_FAILED`（“内置流程只读：请先复制后修改”）。
- **旧数据兼容**：读取时归一化 raw `WorkflowMethod` 数组、`{methods:[...]}` 整包、以及元素级 `{method,...}` 包装；缺失 `version/archived/description/support/timestamps` 时用 revision 尾数/默认值兜底；坏条目（非 method.custom.*、null）跳过不崩；旧记录可继续 save（版本冲突语义相同）。
- 测试（`tests/integration/method-catalog.test.ts`，直接 new 服务 + 临时 Store）7 个场景全过：合并视图/内置只读；create/幂等重放/深拷贝 instantiate；save 版本递增+陈旧冲突+校验拒绝；copy 内置/自定义+默认名+名称超长；archive 隐藏/可读/禁止使用/内置拒绝；校验矩阵（空步骤、重复/非法 key、字段缺失、交付移除、未知职业、环路/未知依赖、未知细化组、超 50 步、合法带 step roleId）；旧数据（raw、元素包装、整包包装、坏数据跳过、旧记录继续编辑到 r4）。
- 验证：`npx tsc -p tsconfig.json --noEmit` → exit 0；`node --import tsx --test --test-force-exit tests/integration/method-catalog.test.ts` → 7 pass / 0 fail；未跑全量 npm test/build（Lead 范围）。
- **下一波接线清单（be-api/fe）**：
  1. `packages/engine/src/index.ts` 增加 `export * from './method-catalog.ts'`；Engine 构造/持有 `MethodCatalogService`（可像 RoleCatalog 一样接 `engine.methods`）。
  2. shared：`OPERATIONS` 加 `catalog.method.create/copy/save/archive`（requestKey 强制），contracts 增 `MethodCatalogEntry/Detail/Draft/Validation/Mutation/Copy/Archive` DTO 与 ROUTES：`GET /api/workflows`（也可用 `/api/catalog/methods`）、`GET /api/workflows/:id`、`POST /api/workflows`、`POST /api/workflows/:id/copy`、`PATCH /api/workflows/:id`（带 expectedVersion）、`DELETE /api/workflows/:id`（archive）、`POST /api/workflows/validate`、`POST /api/workflows/:id/instantiate`（开始任务时选流程版本）。
  3. HTTP 把 service 的 `{requestKey,replayed,method}` 包成 `CommandResponse`（begin/settle/fail + by-key 核对），把 `VALIDATION_FAILED.details.problems` 原样透传；`CONFLICT.details.currentVersion` 驱动编辑器版本冲突横幅。
  4. contracts 若要把「谁来做/依赖」正式化，建议 `MethodStepDefinition` 增加可选 `roleId/requires`（当前 method-catalog 已按扩展字段持久化/校验，加字段不破坏旧数据）；「已用于 N 个任务」仍无数据源（设计标 PROPOSED，先隐藏）。
  5. 前端 W3-8b：目录合并视图（内置/我的）、详情步骤链、复制/归档 Modal、画布保存用 expectedVersion（冲突时不覆盖）、检查浮层用 validate.checks/problems。

### 21:38 任务完成 | W4-1e（task-45）| 文档同步 Wave 3D + 打包/blocked 状态

- 负责人：`docs-audit`；写范围：`README.md`、`docs/remaining-work.md`、`docs/verification.md`、`docs/design-coverage.md`；未改 review 报告、`docs/task-assignment.md`、`docs/api.md`、产品代码、设计稿。
- 计数统一：4 个文档均为 **379 tests / 54 suites / 368 pass / 11 skipped / 0 fail**（62.4s，`.tmp/wave3d-test.log`）；Wave 3D 验收的 build:web/server、`check:docs-routes`（148 路由）、`test:e2e --skip-build` 通过。
- README：实现状态改为 Wave 0–3D 完成、Wave 3E 进行中；补 Wave 3D 已实现项（角色四页签、W0-4c、W3-10、W3-9c、PE37 引擎、W4-4 打包、W4-5 评估）；「未完成」改为 Wave 3E 进行中（W3-1b/W3-6b/W3-8a/W4-3b）、W3-4b、W3-5、W3-8a/8b、**W4-5/W2-5 blocked（环境变量/补测见 `docs/packaging.md` §7）**、打包残留（346MB 未签名、无 dmg/zip、arm64、默认图标、asar 关闭、GUI sandbox/flags、跨平台/自动更新）、W4-3b、深度项。
- remaining-work：新增 Wave 3D 完成行（角色四页签、待验收情况条、节点详情子视图、数据库/工具/模板、PE37 引擎、打包/真实环境）；缺口重编 1–9；W4-5/W2-5 blocked 与 W4-4 残留引用 `docs/packaging.md`；不再把 W3-3/W3-9c/W3-10/W3-6 写成进行中。
- verification：计数 379/368/62.4s；§10 更新角色 B-02/B-03、W0-4c/W3-10、W3-9c 后端、PE37 引擎（HTTP/UI W3-6b）、打包 346MB、W4-5 blocked、design-coverage（148 路由）；新增 **Wave 3D 验收（379 tests）**（角色 5 pass、节点/待验收、W3-9c 33 断言、PE37 3 pass、打包评估、W4-5 blocked）；历史小节标注历史计数。
- design-coverage：25 页维持 **✅ 3 / 🟡 21 / ⛔ 1**（唯一缺失 `workflow-editor`）；更新 roles（四页签，B-02/B-03 仍缺）、task（W0-4c 完成、W3-5 缺）、node（W3-10 子视图，平移/产物正文降级）、databases/tools/templates（W3-9c 前端降级、后端缺口）、ppt（Wave 3D 未改，仍 W3-7b）；section 3 加 Wave 3D 已闭合 + W4-4 残留/W4-5 blocked。
- 验证：无旧当前计数（371/360/58.9 仅历史验收小节并标注历史计数）；无「Wave 3D 进行中」旧表述；链接 0 broken；`git diff --check` 干净；**当前 `check:docs-routes` 因 Wave 3E 并行落地的 `planningProposal`/`planningRefinePreview` 契约尚无服务端实现而暂时失败**，按要求未改 `docs/api.md`，待 W3-6b 落地后由 Lead 重新 `npm run docs:api`；未跑全量 test（Lead 已验收 379 tests）。
- 未覆盖 / 说明：Wave 3E 代码正在并行落地（W3-1b/W3-6b/W3-8a/W4-3b），文档按「进行中/待验收」记录；打包与真实环境 blocked 需用户提供环境/凭据。

### 21:40 任务完成 | W3-6b PE37 HTTP 接线 + W3-1b 项目公约后端（task-41）| be-api

- 负责人：`be-api`；写范围：`packages/shared/src/{api/contracts,errors,domain/models,domain/enums}.ts`、`packages/engine/src/{project-task,engine}.ts`、`packages/server/src/http.ts`、新增 `tests/integration/{pe37-http,charter}.test.ts`。`engine/planning.ts` 未改（proposal/refinePreview/start(scope)/apply/confirm 已具备）；storage 未改（charter 用 settings JSON）。未改 `apps/web/**`、其他服务、docs。契约已同步 Lead 与 design-audit。
- A) PE37 接线：
  - `GET /api/tasks/:id/planning/proposal`（只读）→ `{proposal: PlanningProposal}`；`POST /api/tasks/:id/planning/refine-preview`（只读，body `{groupRef}`，无 requestKey/无回执）→ `{preview: RefineScopePreview, taskId}`。
  - `PlanningStartRequest` 增加可选 `scope:{groupRef}`；`/planning/start` 原样透传（scope 与 refine 预览不一致 409 STALE_TARGET details.previewGroupRef；refine 预览缺 scope 400 details.groupRef，均由引擎既有校验保证）。
  - `TaskDetail.planning.actions.continuePlanning` 新增：按固定模板/无计划/计划已确认/规划进行中/候选待应用/分组全部细化/只读恢复 分别给出 `FIXED_TEMPLATE_LOCKED`/`PLAN_NOT_READY`/`PLAN_ALREADY_CONFIRMED`/`OPERATION_IN_PROGRESS`/`OPERATION_IN_PROGRESS`/`PLAN_FULLY_REFINED`/`RECOVERY_READ_ONLY`，可继续时 allowed=true 且 reason 带剩余组数；不改 PlanningView（models.ts 契约未动）。
  - SCOPE 错误保持结构化 details（未新增 ErrorCode）：提前 confirm → 409 `PLAN_REVISION_CONFLICT` + `details={code:'SCOPE_UNREFINED',groups,unresolvedScopes}`；越界候选 apply → 400 `VALIDATION_FAILED` + `details.problems[].code='SCOPE_VIOLATION'`。
- B) 项目公约（charter）：
  - `GET /api/projects/:id/charter` → `{charter: ProjectCharterView}`：status none/draft/generating/written/unknown、draft{version,content,source,savedAt}、written{version,path,writtenAt}、current{path:'AGENTS.md',exists,content?,readError?}、versions[]、needsReconcile、capabilities{generate/edit/confirmWrite}。
  - `PATCH /api/projects/:id/charter`（requestKey，`{content,expectedVersion?}`）保存草稿，版本递增（最多保留 10 版），内容 1–64000 字符，expectedVersion 过期 409 STALE_TARGET；`POST …/charter/confirm`（requestKey，`{confirmWrite:true,expectedVersion?}`）原子写入项目根 `AGENTS.md`（同目录临时文件 + rename；写入前先持久化 `writing` 状态，进程中断后 GET 显示 status='unknown'+needsReconcile=true，不自动重试；EACCES/EPERM/EROFS → 403 FORBIDDEN 且草稿保留）。写成功后 written 记录、draft 清空；同 requestKey 重放返回原回执不重写。
  - `POST …/charter/generate`（requestKey）诚实返回 **501** `CHARTER_GENERATION_UNAVAILABLE`（模型生成未接线，details.capability/fallback；命令回执 failed）；capabilities.generate.allowed 恒 false，UI 走手动编辑闭环。
  - `ProjectSettings` 新增 `docPaths?: string[]`（项目根相对路径、0–20 条、拒绝绝对路径/`..`/重复）与 `gitlab?: {inheritGlobal, baseUrl?, projectPath?, enabled?}`（项目级覆盖，仅非敏感配置；inheritGlobal=false 时必须给 http(s) 地址与 group/repo 路径）。复用 `PATCH /api/projects/:id` 的 settings 写入并在项目详情读回。
  - 新增 OperationKind：`project.charter.generate/update/confirm`（回执审计需要，属共享契约最小补充）。
- 验证命令与结果：
  - `npx tsc -p tsconfig.json --noEmit` → exit 0（前端 agent 收尾后复跑）。
  - 新增 `node --import tsx --test --test-force-exit tests/integration/pe37-http.test.ts tests/integration/charter.test.ts` → **5 tests / 5 pass / 0 fail**：proposal/refine-preview/continuePlanning/scoped start 的缺 scope+scope 不匹配/SCOPE_UNREFINED confirm 门/计划确认后 action 翻转；越界候选 SCOPE_VIOLATION；charter 全链路（含 501 生成、403 写失败保留草稿、expectedVersion、重放幂等、写后新草稿 current 不变、unknown 恢复）；docPaths/GitLab 覆盖校验与读回。
  - 回归：`routes-contract + api-contract + pe37-scope-planning + pe37-http + charter + project-archive + project-recheck + server-smoke + node-acceptance + backend-hardening` → 30 pass / 0 fail；`roles-api + role-catalog-extended + charter + pe37-http` → 11 pass / 0 fail。
  - 运行中 5177 探针：`GET /api/projects/:id/charter` 正确读取真实 AGENTS.md（status none + current.exists/content）；`GET /api/tasks/:id/planning/proposal` 返回 groups/state/placeholder；当前数据无未细化任务，refine-preview 只读路径由集成测试覆盖。
- 未覆盖 / 说明：
  1. 公约“模型生成”未接线（本轮按任务允许的最小闭环：读取/手动保存/审阅当前文件/确认写入；generate 为明确 501，不伪造内容）。
  2. 项目级 GitLab 仅契约+读回，运行时时仍用全局 GitLab 配置（无 token 落入项目设置）；接线远端适配不在本任务范围。
  3. 写入目标固定为项目根 `AGENTS.md`；docPaths 只保存契约，不参与公约写入。
  4. 未跑 `build:web`/全量 `npm test`/浏览器点击（Lead 整合范围）。

### 21:43 任务完成 | W4-3b（task-44）| UI 视觉回归兼容 flags + 截图刷新

- 负责人：`fe-audit`；写范围：`scripts/capture-ui.cjs`、`evidence/`、`docs/evidence/README.md`。
- 脚本：显式 `CAPTURE_UI_NO_SANDBOX=1` 或 `--compat-flags` 才追加 `--no-sandbox --disable-gpu --disable-dev-shm-usage`，默认行为不变；新增可选 `CAPTURE_UI_PORT`、`CAPTURE_UI_TMP_DIR`（默认仍 5288 / `.tmp`）用于隔离并发；失败改为 `app.exit(1)`（此前端口冲突仍以 0 退出）；新增 `CAPTURE_UI_EXTRA=1` 额外截取 roles/ppt（默认不变）。
- 运行：`CAPTURE_UI_NO_SANDBOX=1 CAPTURE_UI_PORT=5292 CAPTURE_UI_TMP_DIR=.tmp/ui-task44 CAPTURE_UI_EXTRA=1 npm run ui:smoke` → **exit 0**；13 个截图目标全部成功（11 默认 + roles/ppt），数据库抽屉与项目选择器 2 个交互 smoke 通过；GPU 缓存 `Gpu Cache Creation failed` / `SharedImageManager` 为非致命环境噪音，截图 1440×900 写入正常。
- 证据：根 `evidence/` 11 张 `ui-*.png` 已覆盖为 21:39 产物，并新增 `ui-roles.png`、`ui-ppt.png`；`docs/evidence/` 新增 8 张 `*-2026-10-19.png`（home/tasks/requirement/task/git/settings/roles/ppt），历史 22 张保留；README 重写为 30 张清单/有效性/命令/提交 `449b3ac` 口径。
- 发现（不在本任务写范围，未修）：设置页左侧分区导航组标题 `.snav .cap` 命中全局首页 `.cap` 样式，计算值 `min-height:300px; display:flex`，导致导航组之间约 300px 大间距；`settings-2026-10-19.png` 与 `evidence/ui-settings.png` 如实显示该问题。需另开设置页样式修复并重新截图。
- 限制：截图由 21:31 的 `apps/web/dist` + `.build/server/main.mjs` 渲染，HEAD `449b3ac`；若工作树后续还有未提交前端改动，Lead 整合后需 `build:web` + 本 smoke 再刷新。未跑 `build:web`（写范围外）与全量测试；未修改产品代码/设计稿。

### 21:44 任务完成 | W3-6b（task-42）| PE37 分组细化 UI

- 负责人：`design-audit`；写范围：`apps/web/src/pages/requirement/**`、`apps/web/src/pages/tasks/**`。新增 `pe37.ts`、`Pe37Overview.tsx`、`RefineScopeDialog.tsx`、`pe37.css`；改 `RequirementCanvasPage.tsx`、`PlanReviewPanel.tsx`、`dialogs.tsx`；`tasks` 无需要改动。未改 backend/shared/其他页面。
- 契约匹配（task-41 最终 shared）：独立 `GET /api/tasks/:id/planning/proposal`（`{proposal}`，使用 `PlanningProposal`）、`POST …/planning/refine-preview`（`{groupRef}` → `{preview,taskId}`，`RefineScopePreview`）、`planning/start` 增加 `scope:{groupRef}` 且仍带 `previewId/sourceInputRevision/confirmModelDispatch:true`；`planning.actions.continuePlanning` 的 allowed/reason 直接驱动按钮；`SCOPE_UNREFINED`/`SCOPE_VIOLATION` 从结构化 `details` 解析，不自造 ErrorCode。
- 总览：PE37 计划存在且未确认时读取 proposal；四态 refined/unrefined/planning/candidate 徽标、每组分覆盖/叶子数/第 N 轮、coverage 总数、unresolvedScopes、limits 全展示；未细化组提供「继续规划选区」，规划中提供「停止本轮」，候选提供「审阅候选」。全部细化前确认禁用并显示缺组原因；proposal 读取中/失败时确认也禁用并写原因。
- 画布占位：按 `proposal.groups[].state`/`placeholderNodeIds` 为没有真实叶子的未细化/规划中/候选组叠加只读虚线占位（`NodeStatus.UNKNOWN` + lock +「未细化 · 不可执行」），不创建边、不伪造执行状态；点击占位不打开节点详情。分组框 tone 改为 unrefined/scope，图例注明「未细化占位」。已确认计划后隐藏 PE37 总览，不干扰原有执行画布。
- 继续规划选区：选组后弹 `RefineScopeDialog`，显示第 N 轮、只细化该组、当前计划修订/节点/分组、派发/修订配额、预算/币种、总时限/单次、节点/分组/深度上限、预览有效期、blockers、服务 instructions；过期/阻塞/预览未加载时确认禁用。确认调用 scoped start（新 requestKey + scope），unknown/accepted 锁定显示回执，不自动重发；停止仍复用原 StopPlanningDialog（只停本轮）。
- 组候选：复用现有 apply/reject/对照图层；新增组候选横幅显示候选组、组内实际差异、组外差异（服务若返回组外改动则警告会被 SCOPE_VIOLATION 拒绝）、跨组依赖条数、应用后本组节点数；应用只写未确认草稿，其他组不变，全部细化后才能确认。确认计划 Modal 逐项展示服务 checks + 前端 full-draft 差异，未细化时本地禁用并说明冻结任务不受影响。
- 验证：`npx tsc -p tsconfig.json --noEmit` exit 0；本范围 `--noUnusedLocals --noUnusedParameters` 0；`git diff --check` 通过；Vite 5173 对 7 个改动文件转译 HTTP 200；真实 5177 只读 `GET …/planning/proposal`（草稿任务 groups=[]、已确认任务返回 6 个 refined 组）与 `planning.actions.continuePlanning`（PLAN_NOT_READY / PLAN_ALREADY_CONFIRMED）成功；未创建计划/未开始 scoped round/未写数据，未跑 build:web/全量 test，未做浏览器点击。
- 未覆盖/降级：
  1. 当前真实数据没有“未细化组”的计划，无法在 5177 走一遍 refine-preview→start→group candidate→apply→confirm 的完整 UI；建议 Lead 用 PE37 测试数据做浏览器 smoke。
  2. proposal 读取失败时保留计划面板并禁用确认；不把“读取失败”当作全部已细化。
  3. 组候选跨组依赖数来自服务候选图，不能替代应用时的 SCOPE_VIOLATION 校验；服务错误仍优先。
  4. `tasks` 页面没有改动：任务列表 DTO 不包含 proposal/未细化组数，不能伪造入口计数。

### 21:45 整合 | Wave 3E 验收通过

- **验收范围**：W3-6b PE37 HTTP+UI、W3-1b 项目公约/docPaths/GitLab 后端、W3-8a method catalog 后端核心、W4-3b 视觉回归/截图、W4-1e 文档同步。
- **类型检查**：`npx tsc -p tsconfig.json --noEmit` → exit 0。
- **全量测试**：`npm test` → **391 tests / 54 suites / 380 pass / 11 skipped / 0 fail**（65.0s）。
- **构建/脚本**：`docs:api` 重生成（153 路由）、`check:docs-routes` OK、`build:web`、`build:server`、`test-e2e --skip-build` 通过。
- **功能证据**：PE37 proposal/refine-preview/scoped start/确认拦截/组候选 UI；项目公约 GET/PATCH/generate(501)/confirm（写入 AGENTS.md、unknown 恢复）、docPaths/GitLab 项目级覆盖；method catalog CRUD/校验/版本/合并（7 测试）；ui:smoke 兼容 flags 13 截图 + 2 交互 smoke 通过，证据刷新到 HEAD 口径。
- **范围审计**：设计稿未改；临时配置已清理；`git diff --check` 通过。
- **新登记 follow-up**：W3-1c（项目详情接 charter UI）、W3-8c（method catalog HTTP/Engine 接线）、W3-8b（流程编辑器 UI）、W3-5（任务画布扩展/快照评审）、W4-3c（设置页导航样式修复+重拍）。
- **阻塞**：W4-5/W2-5（真实 PG/GitLab）无本机实例/凭据，保持 blocked。

### 21:47 分派 | Wave 3F

- `be-api` → task-46：W3-8c method catalog HTTP/Engine 接线（/api/workflows*、回执/冲突、内置/自定义合并）。
- `fe-ppt` → task-47：W3-8b 工作流编辑器前端（目录 + /workflows/:id/edit 画布/检查/冲突）。
- `design-audit` → task-48：W3-1c 项目详情 UI 接入 charter/docPaths/GitLab。
- `be-recovery` → task-49：W3-5 任务画布后端核心（冻结/审计/快照评审/运行内容读模型，暂不接 HTTP）。
- `fe-audit` → task-50：W4-3c 设置页导航 `.cap` 样式冲突修复 + ui:smoke 重拍。
- `docs-audit` → task-51：W4-1f 文档同步 Wave 3E。
- 剩余预计：W3-5 HTTP/UI 接线、W3-4b 知识研究步骤/流式、最终整合与 blocked 项确认。

### 21:48 用户新增验收要求 | 推送到 GitHub main

- 目标仓库：https://github.com/wangyufengsky/agent-workflow-deepseek（已确认存在，远端 main 初始提交 8a3d1a3）。
- 凭据：本机 `gh` 已登录 `wangyufengsky`（repo/workflow scope），HTTPS 可用。
- 安排：全部任务 done 后，添加 origin（已完成本地配置）、合并/处理远端初始 main、推送本地历史到 main，并用 `git ls-remote` 核对；该动作登记为 W4-6，未完成前不推送。

### 21:50 任务完成 | W4-1f（task-51）| 文档同步 Wave 3E + 证据/阻塞状态

- 负责人：`docs-audit`；写范围：`README.md`、`docs/remaining-work.md`、`docs/verification.md`、`docs/design-coverage.md`；未改 review 报告、`docs/task-assignment.md`、`docs/api.md`、产品代码、设计稿。
- 计数统一：4 个文档均为 **391 tests / 54 suites / 380 pass / 11 skipped / 0 fail**（65.0s，`.tmp/wave3e-verify.log`）；Wave 3E 验收的 `docs:api`/`check:docs-routes`（153 路由）、`build:web`/`build:server`、`test:e2e`、`ui:smoke`（兼容 flags，13 截图 + 2 交互）通过。
- README：实现状态改为 Wave 0–3E 完成、Wave 3F 进行中；补 Wave 3E 完成项（PE37 HTTP+UI、charter 后端、docPaths/GitLab 覆盖、method catalog 核心、截图刷新、API 153 路由）；「未完成」改为 Wave 3F（W3-1c/W3-8c/W3-8b/W3-5）、W4-3c、W3-4b、W3-10 剩余、W4-5/W2-5 blocked、打包残留、深度项；界面证据更新为 30 张 docs/evidence（8 当前 + 22 历史）+ 13 张根证据、`ui:smoke` 命令、W4-3c 设置页样式缺陷。
- remaining-work：新增 Wave 3E 完成行（PE37 HTTP+UI、charter/docPaths/GitLab、method catalog、W4-3b 截图、W4-2 153 路由）；缺口重编 1–9，W4-3c/W3-4b/W3-5/W3-8b/8c/W3-10/blocked/打包残留写清。
- verification：计数 391/380/65.0s；§10 更新 PE37/charter/method catalog/截图/W4-3c/153 路由；新增 **Wave 3E 验收（391 tests）**；历史 Wave 3A–3D 小节标注历史计数并修正「当前 391 见下」。
- design-coverage：25 页维持 **✅ 3 / 🟡 21 / ⛔ 1**（唯一缺失 `workflow-editor`，W3-8b/8c 进行中）；更新 projects（charter 后端已接、UI W3-1c 进行中）、requirement（PE37 HTTP/UI）、workflows/workflow-editor（method catalog 核心、编辑器进行中）、settings（W4-3c 样式缺陷）、证据口径（30 截图/`ui:smoke` 命令）。
- 验证：无旧当前计数（379/368/62.4 仅历史验收小节并标注历史计数）；无「Wave 3E 进行中」旧表述；链接 0 broken；`git diff --check` 干净。**当前 `check:docs-routes` 因 Wave 3F 并行落地的 `/api/workflows*` 契约尚无服务端实现而暂时失败**，按要求未改 `docs/api.md`，待 W3-8c 落地后由 Lead 重新 `npm run docs:api`；未跑全量 test（Lead 已验收 391 tests）。
- 未覆盖：Wave 3F 代码并行落地中（W3-1c/W3-8c/W3-8b/W3-5），文档按「进行中/待验收」记录；W4-5/W2-5 仍 blocked；W4-3c 设置页导航样式与重拍未完成。

### 21:49 任务完成 | W4-3c（task-50）| 设置导航样式修复 + 截图重拍

- 负责人：`fe-audit`；写范围：`apps/web/src/pages/settings/settings.css`、`scripts/capture-ui.cjs`（无需再改）、`evidence/`、`docs/evidence/README.md`。
- 修复：在 `settings.css` 增加 `.snav .cap { display:block; min-height:0; height:auto; gap:0; padding:12px 10px 6px; overflow:visible; }`，覆盖全局首页 `.cap` 的 `min-height:300px/display:flex`；特异性 `.snav .cap` 高于 `.cap`，首页 `.cap` 不受影响。截图确认设置导航分组紧凑、无 300px 间距；其他设置页全局类（`.row/.card/.grid-2`）未见新的明显冲突。
- 构建：`npm run build:web` → exit 0（Vite 403 modules，21:47；仅有 errors.ts 重复 case/chunk 大小等既有警告）。
- 重拍：`CAPTURE_UI_NO_SANDBOX=1 CAPTURE_UI_PORT=5293 CAPTURE_UI_TMP_DIR=.tmp/ui-task46 CAPTURE_UI_EXTRA=1 npm run ui:smoke` → **exit 0**；13 个截图目标 + 2 个交互 smoke 通过，截图 1440×900；GPU 缓存错误仍为非致命环境噪音。
- 证据：根 `evidence/` 13 张 `ui-*.png` 刷新至 21:47/21:48；`docs/evidence/` 8 张 `*-2026-10-19.png` 已用新产物覆盖（checksum 与 root 一致），settings 截图导航正常。README 更新为：21:47 重拍、`build:web` 21:47、HEAD `14c9fdd`（含本轮未提交 CSS 修复）、命令 5293/`.tmp/ui-task46`，并把“已知视觉问题”改为“已修复验证”。
- 验证：`npm run build:web` exit 0；`npm run ui:smoke` exit 0；settings 截图 1440×900、导航间距人工核对正常；README 与实际 30 张 PNG 一致。未跑全量 `npm test`/Electron 打包；截图基于 21:47 构建的 dist，工作树后续改动需重新构建/重拍。

### 21:52 任务完成 | W3-5 后端核心（task-49）| 冻结计划 / 审计记录 / 快照评审读模型 / 运行内容

- 负责人：`be-recovery`；写范围：新增 `packages/engine/src/task-extras.ts`、新增 `tests/integration/task-extras.test.ts`；**未改** `engine.ts`、`http.ts`、`shared/**`、`apps/web/**`、storage。服务 `TaskExtrasService` 可独立 `new`（Store 注入 + 可选 templates/actor provider），测试直接实例化。
- **1) 冻结计划快照**（settings JSON `task.freeze.<taskId>`，每任务最多 20 条）：
  - `freezePlan(taskId,{requestKey?,planRevisionId?,note?,actor?})` → `{replayed,snapshot}`；快照含 `snapshotId/planRevisionId/revisionNumber/status/planHash(sha256)/frozenAt/actor(本地，默认 local-user)/note/requirementRevision/methodId+methodRevision/template{id,version,name}/summary{nodes,edges,groups,groupLabels,nodeKeys}/executionAtFreeze{executionId,status,progress}`。
  - 幂等：同 requestKey 同 planHash 重放原快照；同 planRevision 同内容再冻结返回原快照（不重复）；不同 revision 生成新快照（newest first）。requestKey 复用于不同计划 → REQUEST_KEY_REUSED。**只写 settings，不改变计划/执行**（测试对比执行视图前后相等）。
  - `latestPlanFreeze(taskId)` / `listPlanFreezes(taskId)`；未知任务/无计划 → NOT_FOUND。
- **2) 审计时间线**（只读，最新在前，分页）：
  - 来源：持久化事件日志（扫描上限 5000，取 taskId/target 命中）+ operations 台账（最近 500，target.taskId 命中）；`operation.settled` 事件与台账按 requestKey 去重，避免双条。
  - 映射：task.changed→`任务阶段`、plan.changed→`计划修订 N · status`、planning.changed→`规划轮次 status/stage`、execution.changed→`执行状态`、workspace.updated/changes.updated/delivery.updated + 全部按 requestKey 的命令（plan.confirm/execution.*/node.accept|reject/task.delivery.*/task.recovery.* 等，status/requestKey/refs）。
  - `audit(taskId,{limit?≤100,cursor?,kinds?})` → `{items,total,limit,cursor,nextCursor?}`；错误：未知任务 404、非法 cursor 400；kinds 前缀过滤（如 `execution.`）。
- **3) 快照评审运行面板（B-07，固定模板任务）** `snapshotReview(taskId,{limit?,cursor?})`：
  - `applicable`：仅 `fixedTemplate` 任务；非模板任务返回 `applicable:false + reason`，各分区空。
  - `scope`（审查范围与版本，只给可核对事实）：planRevisionNumber/status、template{id,version,name}、`baselineSha`（workspace.baseSha）、`targetSha`（delivery push.pushedSha 或 commit.commitSha，`targetShaSource:'delivery'|'none'`）、branch、`versionsFixed:true`；**mode/depth 固定 `unknown` + modeSource='unavailable' + limitations**（审查方式/深度需快照评审服务数据，不伪造）。
  - `progress`：totalBatches（无执行时 null=待定）、verified/unverified/running/attention/skipped/remaining、phases（按计划分组 label/total/completed）、固定提示「进度不等于完成…」。**verified 只认 attempt result verification=passed 或人工验收 accepted；succeeded 但无验证 → unverified**，不伪造审查结论。
  - `batches`：按「模板步骤 key ↔ 计划节点 key」分组，输出 batchId/title/purpose(模板步骤·分组)/state(verified|unverified|running|attention|pending|skipped)/source(execution|template)/nodeId/templateStepKey/attemptId/attemptStatus/verificationState/fragmentCount/errorMessage/updatedAt；分页 limit≤50；**无执行时批次为空（总数待定），不预造 pending 批次**。空模板步骤（计划缺失）在无执行时同样不出现。
  - `partialReport`（阶段报告）：诚实空态 `{available:false, analyzedUnits/pendingUnits/excludedUnits/contentMarkdown:null, download:{available:false, reason:'阶段报告读取后才能下载'}, reason:'快照评审服务尚未提供阶段报告数据；这里如实置空，不生成审查结论'}`。
- **4) 运行内容入口** `runContent(taskId)`：计划节点 + 最近 attempt + 输出片段（每 attempt 最多 500）→ 分组 documents/source/tests/other（按节点 kind）；节点项含 status/attemptCount/latestAttempt{status,summary,verification,artifactCount,errorCount,fragmentCount}/outputs(声明产出)/writes(声明写资源)/errorMessage；另附 workspace{state,kind,displayRoot,baseSha,retention} 与 deliveryEvidence{projection,commitSha,pushedSha,remoteRef,mrIid,mrWebUrl}；无计划 → `available:false` 诚实空态；未知任务 404。
- 测试（`tests/integration/task-extras.test.ts`，6 场景全过）：冻结字段/幂等/不变执行/新 revision；冻结错误（未知任务、无计划、恒等）；审计合并+去重+分页+过滤+错误；快照评审分组（verified/unverified/running/pending、版本、模板、分页、partial 空态）；模板任务无执行与普通任务空态；运行内容分组/attempt/fragment/workspace/delivery/空态/404。
- 验证：`npx tsc -p tsconfig.json --noEmit`（本任务文件 0 error；仓库另有并行前端 `WorkflowEditorPage.tsx` 改动中的 1 个错误，非本任务文件）；`node --import tsx --test --test-force-exit tests/integration/task-extras.test.ts` → 6 pass / 0 fail；未跑全量 npm test/build（Lead 范围）。
- **下一波接线清单（be-api/fe）**：
  1. `packages/engine/src/index.ts` 加 `export * from './task-extras.ts'`；Engine 持有 `extras = new TaskExtrasService({store, templates: () => this.catalog.templates})`。
  2. contracts/routes：`POST /api/tasks/:id/plan/freeze`（回执；requestKey+confirmFreeze 由路由强制）、`GET /api/tasks/:id/plan/freezes`/`latest`、`GET /api/tasks/:id/audit?limit&cursor&kinds`、`GET /api/tasks/:id/snapshot-review?limit&cursor`、`GET /api/tasks/:id/run-content`；DTO 直接镜像 task-extras 的类型（FrozenPlanSnapshot/TaskAuditPage/SnapshotReviewModel/RunContentModel）。
  3. 前置：`OPERATIONS` 增 `task.plan.freeze`（requestKey 强制）；冻结快照类型写入 contracts；审计分页 cursor 作为不透明字符串透传。
  4. 快照评审的 mode/depth 与阶段报告字段目前是诚实 unknown/空；若产品要求真实审查报告，需要评审服务提供 snapshot/partial-report 数据源（另一任务），届时替换 `scope.mode/depth` 与 `partialReport`，其余读模型不变。
  5. 前端：任务画布「⋯」菜单接三类入口（恢复已有路由、冻结弹窗→freeze、审计记录页/抽屉→audit、运行内容→runContent）；B-07 面板用 snapshotReview（执行进度/审查范围/功能批次/阶段报告空态，下载禁用并说明原因）；保留「进度不等于完成」「查看不会改变执行」文案。

### 21:54 任务完成 | W3-8c method catalog HTTP/Engine 接线（task-46）| be-api

- 负责人：`be-api`；写范围（声明）：`packages/engine/src/{engine,index}.ts`、`packages/shared/src/{api/contracts,domain/enums,domain/models}.ts`、`packages/server/src/http.ts`、`tests/integration`。为满足“Planning/Start 读取合并自定义方法”还最小化了 `packages/engine/src/{project-task,planning,plan}.ts` 的 catalog 注入（不再硬编码 `DEFAULT_CATALOG`），并修复 `method-catalog.ts` 的 id 后缀 bug（见下）。未改 `apps/web/**`、其他服务、docs。
- Engine：
  - 新增 `Engine.methods: MethodCatalogService`；`engine.catalog` 改为稳定代理对象（roles/templates 仍可被既有 service 原地更新，`methods` 为动态 getter），因此 `/api/bootstrap`（开始任务目录/工作流页）、`TaskService.create`、`PlanningService`、`PlanService` 都能看到内置+自定义方法，且任务创建后可解析自定义 `methodId`。
  - `TaskService`/`PlanService` 改用注入的 `#catalog`；`PlanningService` 增加可选 `catalog` 参数（默认 DEFAULT_CATALOG）并解析合并目录。
- shared：
  - `MethodStepDefinition` 增加可选 `roleId`/`requires`（编辑器“谁来做/依赖”，仅用于校验）。
  - OPERATIONS 新增 `catalog.method.create/copy/save/archive`（scope global、mutating、requestKey 强制）。
  - contracts 新增 `MethodDraftDefinition`、`MethodValidationResult`（problems/checks）、`MethodCatalogEntry/Detail`、`MethodCreate/Copy/Save/ArchiveRequest`、`MethodValidateRequest`、`MethodInstantiateResponse` 与 ROUTES（workflows/workflow/workflowCopy/workflowValidate/workflowInstantiate）。
- HTTP：
  - `GET /api/workflows`（includeArchived/source/q，默认隐藏归档）、`GET /api/workflows/:id`、`POST /api/workflows/validate`（非变更、无 requestKey）、`POST /api/workflows/:id/instantiate`（非变更、深拷贝）。
  - 写操作 `POST /api/workflows`、`POST /:id/copy`、`PATCH /:id`（expectedVersion）、`DELETE /:id`（archive）全部经 `commands.begin/settle/fail` + `{receipt, resource:{method}}`；同 requestKey 重放返回原回执；`/api/operations/:key` 可核对。
  - 错误透传：400 `VALIDATION_FAILED` + `details.problems[]`；409 `CONFLICT` + `details.currentVersion/expectedVersion/methodId`；内置只读 400 + `details.builtIn=true`；缺 requestKey 400；不存在 404。
- 修复（method-catalog.ts，1 行）：`randomSuffix()` 原先取 `createId` 前缀后的前 8 字符（9 字符时钟的前 8 位），同 slug 方法在时间窗内生成相同 id，导致同 id 多条记录、复制结果的 `copiedFrom` 读丢；改为取随机尾巴。属原 W3-8a 交付缺陷，已同步 Lead。
- 验证命令与结果：
  - `npx tsc -p tsconfig.json --noEmit` → exit 0（前端 agent 收尾后复跑）。
  - 新增 `tests/integration/workflow-catalog.test.ts` → 连续 3 次 1 pass / 0 fail：内置列表/详情、非变更 validate（problems/checks）、缺 requestKey 400、创建回执+by-key、自定义出现在 `/api/workflows`/`/api/bootstrap` 且可创建任务、复制 copiedFrom+重放、save 版本 r1→r2 与 409 currentVersion、save-mode 校验 DELIVERY_STEP_REMOVED、内置 save/archive 只读 details.builtIn、instantiate builtin/custom、归档默认隐藏/includeArchived/归档后 instantiate 409。
  - 回归：`routes-contract + api-contract + server-smoke + method-catalog + pe37-scope-planning + pe37-http + plan-edit-dependencies + template-import + roles-api + role-catalog-extended + workflow-catalog` → 33 pass / 0 fail。
  - 运行中 5177 探针：GET list（5 个内置）、GET detail（r12/11 步/planningStrategy）、POST validate（结构化 problems）、POST instantiate（builtin/frozen）均正常。
- 未覆盖 / 说明：
  1. 契约 DTO 里的 `MethodStepDefinition.roleId/requires` 是可选扩展；既有内置方法不含这些字段。
  2. instantiate 不创建任务本身（返回冻结定义）；前端仍用 `POST /api/tasks` 传 methodId，已加集成覆盖。
  3. 归档是软删除（列表隐藏、不可实例化/编辑），没有物理删除路由。
  4. 未跑 `build:web`/全量 `npm test`/浏览器点击（Lead 整合范围）。

### 22:00 任务完成 | W3-1c（task-48）| 项目详情 charter/docPaths/GitLab

- 负责人：`design-audit`；写范围：`apps/web/src/pages/projects/**`。改 `ProjectDetailPage.tsx`、`project-detail.css`；未改 backend/shared/其他页面。
- 契约匹配（task-41 最终 shared）：`GET /api/projects/:id/charter` → `{charter}`；`PATCH /charter`（requestKey/content/expectedVersion）与 `POST /charter/confirm`（requestKey/confirmWrite/expectedVersion）；`POST /charter/generate`（requestKey/confirmGenerate）按真实 501 `CHARTER_GENERATION_UNAVAILABLE` 处理；`ProjectSettings.docPaths` 与 `settings.gitlab` 通过现有 `PATCH /api/projects/:id` 保存。类型全部使用 shared `ProjectCharterView/ProjectCharterResponse/UpdateProjectRequest`。
- 项目公约页签：真实读取 none/draft/generating/written/unknown；手动编辑草稿 + 保存（expectedVersion）+ ReceiptNotice；生成按钮真实调用 generate，原地显示 501/错误码/服务原因（不伪造成功）；确认写入 AGENTS.md 二次确认、回执、失败错误；unknown/needsReconcile 显示「重新读取 AGENTS.md」且禁止自动重试/重复写入，核对后可重新编辑草稿恢复；当前文件正文只读、版本列表只读（不提供不存在的恢复接口）。
- 文档路径页签：从 shared docPaths 读取（缺失视为空，不再假禁用）；多行路径列表逐个输入/添加/删除，前端校验绝对路径、反斜杠、`..`、控制字符、重复、空行、500 字/20 条；保存空列表=清空；保存走项目 PATCH + receipt/unknown 锁定 + 刷新；实际位置预览。
- Git 与 GitLab 页签：项目级覆盖表单读取/保存 inheritGlobal/baseUrl/projectPath/enabled；继承时地址路径禁用并展示全局地址，非继承时校验 http(s) URL 与 group/repo；保存项目 PATCH + receipt/error；常驻说明「运行时仍使用全局 GitLab 配置」，不伪造项目级远程调用。
- 概览配置状态：charter 真实状态/读取失败、docPaths 条数/未配置、GitLab 全局状态 + 项目覆盖摘要，均可跳转对应页签。
- 验证：`npx tsc -p tsconfig.json --noEmit` exit 0；本范围 `--noUnusedLocals --noUnusedParameters` 0；`git diff --check` 通过；Vite 5173 对 ProjectDetailPage/项目 CSS 转译 HTTP 200；5177 只读 GET charter（status=none、generate reasonCode=CHARTER_GENERATION_UNAVAILABLE、AGENTS.md 不存在）与 project settings 成功。未执行 charter PATCH/confirm/generate 或项目 PATCH 写操作；未跑 build:web/全量 test，未做浏览器点击。
- 未覆盖/降级：
  1. `generate` 只展示真实 501 与手动编辑 fallback；模型生成未接线是后端事实。
  2. GitLab 项目级覆盖只保存非敏感配置；运行时、凭据、证据来源仍使用全局/未提供，页面已明确。
  3. charter 版本列表只读；没有版本恢复接口，不补造。
  4. 未做真实写入 AGENTS.md 的 smoke（避免改本机项目文件）；建议 Lead 用临时项目验证 draft→confirm→unknown/重新读取。

### 21:57 任务完成 | W3-8b（task-47）| 工作流目录升级 + 编辑器（画布/检查/保存冲突）

- 负责人：`fe-ppt`；写范围：`apps/web/src/pages/workflows/**`、`apps/web/src/app/App.tsx`（仅 +1 import、+1 路由 `/workflows/:id/edit`）。未改后端/shared/其他页面。临时 Vite 冒烟配置 `apps/web/src/pages/workflows/vite.smoke.config.mts` 已删除（find 无残留）；临时 5194 服务 / 5287 Vite 已关闭。
- 文件：改写 `WorkflowsPage.tsx`；新增 `WorkflowEditorPage.tsx`、`workflow-api.ts`（HTTP 适配）、`workflow-model.ts`（草稿/检查/布局辅助）、`workflows.css`（令牌驱动，无硬编码颜色）。
- 契约匹配（按 be-api task-46 最终契约）：GET `/api/workflows` → `{items}`；GET `/:id` → `{method}`；POST `/validate`（无 requestKey）→ `{ok,problems,checks}`；写操作 POST/POST copy/PATCH（`method`+`expectedVersion`）/DELETE 归档，data `{receipt,resource:{method}}`；409 `CONFLICT.details.currentVersion` → 冲突横幅；400 `VALIDATION_FAILED.details.problems` / `builtIn` → 具体原因展示。类型直接使用 shared 的 `MethodCatalogEntry/Detail/DraftDefinition/ValidationResult` 与 `ROUTES.workflows/workflow/workflowCopy/workflowValidate`，本地只做容错解包；接口未接通时降级到 bootstrap 内置目录（只读，新建/复制/归档禁用并写原因）。
- 目录：搜索 + 全部/我的流程/程序内置分段（真实计数）；行显示来源/修订/步骤数/更新时间；详情读取 `GET /:id`（加载/错误态），步骤链（按分组并排展示，注明执行仍按顺序、服务无并行分支字段）；操作：用这个流程开始任务（/start?methodId=）、编辑流程/查看步骤（/workflows/:id/edit）、复制（对话框+回执）、归档（确认+回执+归档后默认隐藏，可勾选显示已归档）、新建（对话框 → POST → 选中）；复制/归档/新建结果未明时显示 unknown 横幅 +「核对原操作」(`/api/operations/:key`)，不自动重发。
- 编辑器：工具条（面包屑/可改名/来源版本/未保存 N 处/撤销重做/添加步骤/检查 N/保存）；画布横向有序步骤链（开始/步骤/交付节点、连线、插入“+”按钮、空流程“添加第一步”引导、步骤计数）；内置流程只读并给「复制后修改」（真实 copy → 新流程编辑器）；步骤面板（名称/职业（角色目录）/类型/分组/之后/高级设置=可选+requires 依赖/删除二次确认）并明确“服务未提供「这一步做什么/产出与验收」字段，不伪造”；检查浮层（优先 `/validate`，接口不可用时明确“前端规则”，问题可定位并选中步骤）；保存前本地+服务检查（未指定职业阻止保存并说明为前端规则）；保存走 PATCH `expectedVersion`，成功刷新版本并清历史；409 冲突横幅「已被更新为版本 N」+「查看版本 N」（重新 GET 最新 detail 弹窗）+「导出我的修改」（下载 JSON）；网络超时/不可用 → 保存结果未明，画布锁定只读、保留草稿，按原 requestKey 核对 `/api/operations/:key`，不自动重发；“并行步骤 / 连接到”按钮禁用并写明服务模型只有有序步骤列表。
- 验证：`npx tsc -p tsconfig.json --noEmit` → 0 error；`--noUnusedLocals` 过滤 workflows 与 App → 0；Electron UI 冒烟（隔离真实服务 5194 + 临时 Vite 5287，关 HMR）全部 PASS：目录列表/筛选/详情/复制/新建/归档/显示已归档；编辑器添加步骤→面板→设职业→检查→保存（服务版本 1→2、步骤落库）→改名撤销→服务端升级到版本 3 后保存触发冲突横幅+查看版本弹窗；内置流程只读且无保存按钮、显示「复制后修改」。临时数据/服务已清理；未跑 build:web/全量测试。
- 未覆盖：并行分支/任意连线（服务无字段）；画布拖拽平移/缩放、步骤模板抽屉（设计稿中的 400 抽屉）、视觉 diff 未实现（冲突只给最新版本快照与导出）；编辑器内不能编辑流程描述（仅在新建对话框设置）；保存 unknown 只做了代码路径与锁定，未构造线上断网故障；复制/归档 unknown 核对路径同样未做故障注入。

### 21:58 整合 | Wave 3F 验收通过

- **验收范围**：W3-8c method catalog HTTP/Engine 接线、W3-8b 工作流编辑器 UI、W3-1c 项目详情 charter/docPaths/GitLab UI、W3-5 后端核心（冻结/审计/快照评审/运行内容）、W4-3c 设置导航修复+截图重拍、W4-1f 文档同步。
- **类型检查**：`npx tsc -p tsconfig.json --noEmit` → exit 0。
- **全量测试**：`npm test` → **398 tests / 54 suites / 387 pass / 11 skipped / 0 fail**（69.6s）。
- **构建/脚本**：`docs:api` 重生成（158 路由）、`check:docs-routes` OK、`build:web`、`build:server`、`test-e2e --skip-build` 通过。
- **功能证据**：流程目录内置/我的、创建/复制/归档/版本冲突、编辑器画布/检查/保存/冲突横幅；项目公约手动编辑/确认写入 AGENTS.md/501 生成/unknown、docPaths、GitLab 覆盖；任务扩展读模型（冻结 6 测试）；method catalog 7 测试；ui:smoke 设置导航修复后 13 截图通过。
- **剩余**：W3-5b（HTTP/UI 接线）、W3-4b（知识研究步骤/工具轨迹/流式）、W4-6 推送 main；W4-5/W2-5 blocked（真实 PG/GitLab）。

### 22:00 分派 | Wave 3G（最后功能波次）

- `be-api` → task-52：W3-5b 任务扩展 HTTP/契约（freeze/freezes/audit/snapshot-review/run-content）+ W3-4b 知识研究步骤/工具轨迹后端（真实执行数据，不编造）。
- `fe-templates` → task-53：W3-5b UI（任务画布「⋯」四入口、冻结/审计/快照评审 B-07）。
- `design-audit` → task-54：W3-4b UI（知识研究过程/工具轨迹时间线，无数据明确降级）。
- 完成后：Lead 跑全量验收 + 文档同步（W4-1g）+ 推送 GitHub main（W4-6）。
- 阻塞：W4-5/W2-5 真实 PG/GitLab 仍需用户提供环境/凭据。

### 22:05 任务完成 | W3-4b（task-54）| 知识研究过程/工具轨迹时间线

- 负责人：`design-audit`；写范围：`apps/web/src/pages/knowledge/**`。新增 `ResearchTimeline.tsx`、`research-timeline.css`；改 `KnowledgePage.tsx`。来源选择、引用 520 面板、研究员检查 Drawer 全部保留。
- 契约匹配（task-52 最终 shared）：使用 `KnowledgeAskResponse.steps?: KnowledgeStep[]`（id/kind retrieve|model|tool|validate/label/status/startedAt/endedAt?/durationMs?/detail?）与 `toolActivity?: KnowledgeToolActivity[]`（name/status/summary?/callId?/startedAt?/endedAt?）；历史 `KnowledgeHistoryEntry` 同一形状。没有 capabilities/SSE，明确按“完成后时间线”展示，不显示假动画/进度。
- 回答区时间线：顺序渲染真实 steps（kind 图标、label、status 文字+图标、startedAt/endedAt、durationMs 或真实时间差、detail），不重排不补造；toolActivity 独立列表显示工具名/status/摘要/callId/真实起止/耗时；failed/unknown 如实展示。无 steps/无 toolActivity 时明确「服务未提供研究步骤/工具轨迹…不补造固定四步」；部分缺失分别标注缺步骤或缺工具轨迹。
- 研究员检查 Drawer 同一时间线（compact），删除旧的「服务未提供研究过程/工具轨迹」硬编码；角色证据/项目许可仍按无 DTO 明确降级。回答尾部/摘要卡同步区分「服务未返回」与「已由服务返回」。
- 历史：点击历史记录载入的 `askResult` 携带新字段时同一组件展示；旧历史无字段时走明确降级，不回填/伪造。
- 验证：`npx tsc -p tsconfig.json --noEmit` exit 0；本范围 `--noUnusedLocals --noUnusedParameters` 0；`git diff --check` 通过；Vite 5173 对 KnowledgePage/ResearchTimeline/时间线 CSS 转译 HTTP 200；5177 只读历史接口探针成功（现有旧记录不含 steps/toolActivity，UI 会明确降级）。未发起新 `/ask`（避免模型调用/写历史），未跑 build:web/全量 test，未做浏览器点击。
- 未覆盖：
  1. 现有真实历史全部是接入前记录，无 steps/toolActivity，无法在 5177 看到完整时间线渲染；建议用新一次真实 ask 做浏览器 smoke。
  2. 本轮服务没有 SSE；若后续新增 `knowledge.progress`，需要另接实时追加（当前按完成任务的一次性 DTO）。
  3. 工具轨迹空数组与字段缺省都按“未提供/为空”处理，不补造调用。

### 22:04 任务完成 | W3-5b 任务扩展 HTTP + W3-4b 知识研究步骤/工具轨迹（task-52）| be-api

- 负责人：`be-api`；写范围：`packages/shared/src/api/contracts.ts`、`packages/engine/src/{engine,knowledge}.ts`、`packages/server/src/http.ts`、新增 `tests/integration/{task-extras-http,knowledge-steps}.test.ts`。`engine/task-extras.ts` 无需改（直接实例化导出类型）；`enums.ts` 仅加 `task.plan.freeze` 操作（OPERATIONS 需要，属契约最小补充）。未改 `apps/web/**`、其他服务、docs。契约已同步 Lead、fe-templates（W3-5b UI）、design-audit（W3-4b 时间线）。
- A) W3-5b：
  - Engine 持有 `extras: TaskExtrasService`（`templates: () => this.catalog.templates`）。
  - shared：OPERATIONS `task.plan.freeze`（requestKey 强制）；contracts 镜像 task-extras 全量 DTO：`FrozenPlanSnapshot`、`TaskPlanFreezeRequest/Response`、`TaskPlanFreezesResponse`、`TaskAuditEntry/Page`、`SnapshotBatchState`、`SnapshotReviewBatch/Progress/Scope/BatchesPage`、`SnapshotPartialReport`、`SnapshotReviewModel`、`RunContentCategory/Node/Group/Model`；ROUTES `taskPlanFreeze/taskPlanFreezes/taskAudit/taskSnapshotReview/taskRunContent`。
  - HTTP：`POST /api/tasks/:id/plan/freeze` 走 `commands.begin/settle/fail`，body `{requestKey,confirmFreeze:true,planRevisionId?,note?}` → `{receipt, resource:{freeze,replayed}}`，同 key 重放返回原快照（replayed=true），无计划 404 且回执 failed；`GET …/plan/freezes` → `{items,latest?}`；`GET …/audit?limit&cursor&kinds`（kinds 逗号分隔前缀，cursor 不透明透传）→ TaskAuditPage；`GET …/snapshot-review?limit&cursor` → SnapshotReviewModel（非固定模板 applicable:false + 空 partialReport；无执行不编造 batch）；`GET …/run-content` → RunContentModel；未知任务全部 404。
- B) W3-4b：
  - `KnowledgeAskResponse`（及继承它的 `KnowledgeHistoryEntry`）新增可选 `steps?: KnowledgeStep[]`（kind retrieve/model/tool/validate；status/startedAt/endedAt?/durationMs?/detail?/label 来自实际执行）与 `toolActivity?: KnowledgeToolActivity[]`（name/status/summary?/callId?/startedAt?/endedAt?）。
  - knowledge.ts 采集真实数据：retrieve=实际读取文档数与耗时；model=assistant message `time.created/completed`（缺失则不产生 model 步骤）；tool=OpenCode 消息真实 tool parts（tool/state.status/state.time/state.title|output 摘要；callID 为步骤 id），无 tool parts 时 **toolActivity 字段整体缺省**；validate=真实引用校验接受/拒绝条数。不编造固定四步，步骤按真实 startedAt 排序；步骤/工具轨迹随历史条目落库，历史读取同样返回。
  - 本轮非流式（未加 SSE/knowledge.progress）；完成后一次性返回时间线，UI 按“已完成时间线”展示（已同步 design-audit）。
- 验证命令与结果：
  - `npx tsc -p tsconfig.json --noEmit` → 后端/测试 0 错（前端 fe-templates 正在编辑 TaskExtrasPanel，其临时错误不在本任务；收尾后 Lead 复跑）。
  - 新增 `task-extras-http.test.ts + knowledge-steps.test.ts` → **5 tests / 5 pass / 0 fail**：冻结回执/by-key/重放/列表/无计划 404；审计分页+nextCursor+kinds 前缀过滤；快照评审 applicable:false 与固定模板空 batch/progress.available:false/scope.versionsFixed；运行内容；知识 ask 的 retrieve/tool/model/validate 真实时间与 toolActivity 落库+历史读取、无工具时 toolActivity 缺省且无 tool 步骤、无 message time 时不产生 model 步骤、失败回答不落历史。
  - 回归：`routes-contract + api-contract + server-smoke + knowledge-sources + task-extras-http + knowledge-steps + plan-edit-dependencies + node-acceptance + workflow-catalog + pe37-http` → 24 pass / 0 fail。
  - 运行中 5177 探针：`plan/freezes`、`audit`、`snapshot-review`、`run-content` 均返回真实数据/空态（非固定模板 applicable:false）；冻结写操作未在真实数据上执行。
- 未覆盖 / 说明：
  1. 未做 SSE `knowledge.progress`（明确非流式）；老历史条目没有 steps/toolActivity 属正常，UI 隐藏时间线。
  2. 冻结只写 settings JSON 快照，不改变计划/执行；无独立 latest 路由（清单内含 latest）。
  3. B-07 partialReport 的评审结论字段仍诚实不可用（available:false/null），未接入评审报告服务。
  4. 未跑 `build:web`/全量 `npm test`/浏览器点击（Lead 整合范围）。

### 22:07 任务完成 | W3-5b（task-53）| 任务画布「⋯」四入口 + 冻结/审计/快照评审 B-07

- 负责人：`fe-templates`；写范围：`apps/web/src/pages/task/**`、`apps/web/src/pages/node/**`。
- 新增文件：`pages/task/task-extras.ts`（客户端与 shared DTO/ROUTES：freeze/freezes/audit/snapshot-review）、`pages/task/TaskExtrasPanel.tsx`（自由/审计/评审三面板）、`pages/task/task-extras.css`；修改 `pages/task/TaskCanvasPage.tsx`（⋯ 菜单 + 面板分支 + 打开面板时收起节点/交付/调整面板）。
- 「⋯」菜单：任务恢复…（`/recovery?taskId=`）、冻结计划…、审计记录、快照评审、运行内容（`/runs/:taskId`）、暂停任务…/继续任务…/停止任务…（复用现有命令，禁用时 title 写原因）；支持外部点击/Esc 关闭。
- 冻结计划：`POST /plan/freeze`（`requestKey + confirmFreeze:true + 可选 planRevisionId/note`，shared `TaskPlanFreezeRequest`），面板显示 receipt/replayed；只读快照说明与当前快照/历史快照（版本/时间/操作人/备注/摘要/模板/planHash/冻结时执行事实）；冻结不改变计划/执行；读 `GET /plan/freezes`（items+latest），失败/空态真实。
- 审计记录：`GET /audit?limit&cursor&kinds`（kinds 逗号前缀），`useInfiniteQuery` 分页加载更多；类型筛选（计划/执行/节点验收/冻结/交付/工作区/恢复/任务）；时间线显示时间、summary、status、action、requestKey、refs；空/错误/未知状态真实。
- 快照评审 B-07：`GET /snapshot-review?limit&cursor`（游标只控制 batches 页，用 infinite query 合并去重）；非模板任务按 `applicable:false + reason` 显示空态；执行进度四格（已验证/未验证/执行中/剩余，attention 额外提示，`totalBatches null` 显示待定）、阶段进度条（total null 待定）、`progress.note` 的「进度不等于完成」；审查范围卡（plan/template/baseline/target/branch/short sha/full sha title、版本固定说明）；mode/depth=unknown 明确「服务未提供」，不伪造审查方式；功能批次按模板步骤分组、状态徽标、错误行、加载更多；模板报告页签渲染 `partialReport` 空态：`available:false` 原因、读取按钮禁用并写原因、下载禁用并显示 `download.reason`；未来 available=true 时展示 units 比例与 Markdown（下载仍无前端端点，禁用说明）；页脚固定「查看进度和报告不会启动、暂停或改变执行」。
- 契约匹配：按 be-api 最终契约实现并与 shared 落地一致（freeze `{receipt, resource:{freeze, replayed}}`、freezes `{items, latest?}`、audit 直接 `TaskAuditPage` + `kinds` 逗号串、snapshot-review 直接 `SnapshotReviewModel`、非模板 200 applicable:false）；真实服务 inject 探针 + `task-extras-http.test.ts` 2 pass 验证。前端 `task-extras.ts` 客户端函数也已用真实 HTTP 注入探针验证（freeze → replayed、freezes latest、audit kinds、review applicable:false）。
- 验证：`npx tsc -p tsconfig.json --noEmit` → exit 0；`--noUnusedLocals` 过滤 `pages/task|pages/node` → 0；`tests/integration/task-extras-http.test.ts` 2 pass；`tests/integration/routes-contract.test.ts` 2 pass；`git diff --check` 通过。
- 未覆盖：按要求未运行 `npm run build:web`、未跑全量 `npm test`；无浏览器点击验证（菜单/面板已按现有 task-side/.menu/.banner 样式与令牌实现）。快照评审的 mode/depth 与阶段报告字段后端目前是诚实 unknown/空态，前端不补造；若后续接入评审服务，只需替换数据来源。

### 22:14 任务完成 | W4-1g（task-55）| 最终文档收口 + design-coverage 全页覆盖

- 负责人：`docs-audit`；写范围：`README.md`、`docs/remaining-work.md`、`docs/verification.md`、`docs/design-coverage.md`；未改 `docs/review/**`、`docs/task-assignment.md`、`docs/api.md`、产品代码、设计稿。
- 最终计数统一：**403 tests / 54 suites / 392 pass / 11 skipped / 0 fail**（67.6s，`.tmp/wave3g-verify.log`）；`docs:api`/`check:docs-routes`（**163 路由**）、`build:web`/`build:server`、`test:e2e`、`ui:smoke`（兼容 flags，13 截图 + 2 交互 / 15 条 smoke）通过。
- README：实现状态改为 **Wave 0–3G 全部功能完成、外部验证 blocked**；补 Wave 3F（工作流编辑器/charter UI/task extras 核心/设置修复）与 Wave 3G（任务扩展 UI/知识时间线/最终 163 路由）；「未完成」只剩 W4-5/W2-5 blocked（`WF_PG_*`/`GITLAB_TEST_*` + `docs/packaging.md` §7）、W4-4 签名/公证/跨平台/自动更新、W4-6 推送 main、可选像素级视觉回归与设计级降级；界面证据写清 30 张 docs/evidence（8 当前 + 22 历史）+ 13 张 root、ui:smoke 命令、W4-3c 已修复；补仓库地址 `https://github.com/wangyufengsky/agent-workflow-deepseek`。
- remaining-work：重写为 blocked/发布类 + 可选深度，不再列已完成功能；W4-5/W2-5 blocked 变量、W4-4 发布残留、W4-6 推送、像素级回归、设计级降级（B-07/非流式/charter 501/角色/DB·工具·模板/编辑器限制/PPT 等）写清。
- verification：顶部计数 403/392/67.6s；新增 **Wave 3F（398 tests / 69.6s / 158 路由）** 与 **Wave 3G（403 tests / 67.6s / 163 路由，最终）** 验收记录；§10 更新为最终 blocked/发布/可选深度；历史小节标注历史计数并修正「当前 403 见下」。
- design-coverage：25 页 **✅ 3 / 🟡 22 / 缺失 0**（`workflow-editor` 改为已实现 🟡，含并行/连线/缩放/抽屉/视觉 diff 限制）；更新 projects（charter UI）、knowledge（非流式步骤/工具轨迹）、task（W3-5b 四入口/B-07 降级）、workflows/editor、settings（W4-3c 修复）、roles 等；新增「最终剩余项」表（仅 blocked/发布/设计降级）。
- 验证：4 文件当前计数统一 403、无旧当前计数；design-coverage 25 行、无缺失页标记；链接 0 broken；`check:docs-routes` exit 0；`git diff --check` 干净；未跑全量 test（Lead 已最终验收 403 tests）。
- 未覆盖 / 说明：W4-5/W2-5 仍 blocked（无 PG/GitLab 环境/凭据）；W4-4 仍为未签名 346MB arm64 `.app`；W4-6 推送 main 待在文档提交后由 Lead 执行。

### 22:15 最终整合 | Wave 3G 验收 + 全部功能任务完成

- **最终验证**：`npx tsc --noEmit` exit 0；`npm test` → **403 tests / 54 suites / 392 pass / 11 skipped / 0 fail**（67.6s）；`docs:api` 163 路由 + `check:docs-routes` OK；`build:web`、`build:server`、`test-e2e --skip-build` 通过。
- **最终 UI 冒烟**：`CAPTURE_UI_NO_SANDBOX=1 CAPTURE_UI_PORT=5294 CAPTURE_UI_TMP_DIR=.tmp/ui-final CAPTURE_UI_EXTRA=1 npm run ui:smoke` → **exit 0**，13 截图目标 + 2 交互 smoke 全通过；根 `evidence/` 与 `docs/evidence/*-2026-10-19.png` 已更新到最终构建（22:10）。
- **最终功能验收**：W3-5b 任务画布「⋯」四入口（冻结/审计/快照评审 B-07/运行内容）+ HTTP 回执（5 测试）；W3-4b 知识研究步骤/工具轨迹时间线（真实执行、非流式，5 测试）；W4-1g 文档收口（README/remaining-work/verification/design-coverage：25 页 ✅3/🟡22/⛔0，剩余仅 blocked/发布/设计降级）。
- **全部功能任务状态**：任务分派文档中除 W4-5/W2-5（真实 PG/GitLab，blocked 外部环境）与 W4-6（推送，执行中）外均为 done。
- **下一步**：提交最终改动 → 合并远端初始 main → 推送 `main` → `git ls-remote` 核对；W4-5/W2-5 保持 blocked，W4-4 打包未签名/未公证为发布前置。

### 22:20 完成 | W4-6 推送到 GitHub main

- 合并远端初始 main（`8a3d1a3 Initial commit`，LICENSE/README）→ 本地合并提交 `c87f45c`（保留本项目 README，引入 LICENSE）。
- 本地分支重命名 `master` → `main`，`git push -u origin main` **成功**（`8a3d1a3..c87f45c`）；远端地址 https://github.com/wangyufengsky/agent-workflow-deepseek。
- 核对：本地 HEAD 与 `git ls-remote origin main` 均为 `c87f45c7939572f2d2d7729089956e48503bd990`（MATCH）；远端包含 apps/packages/docs/evidence/CI 等全部内容。
- 遗留（非代码缺口）：W4-5/W2-5 真实 PostgreSQL/GitLab 验证仍 blocked（本机无实例/凭据，未伪造 PASS）；W4-4 打包产物未签名/未公证、无 dmg/跨平台/自动更新。均记录于 README/remaining-work/packaging。

### 22:22 最终状态清理 | 全部可执行任务 done

- 任务分派文档中所有历史拆分/被后续任务覆盖的 `pending/in_progress` 行统一标为 `done（由后续拆分任务覆盖/完成）`：W2-6/W2-7/W2-8、W3-5a、W4-1b/d、W3-1、W3-8、W3-7c/d、W3-9b/c、W3-11b。
- 仅保留两项 `blocked`：W2-5 / W4-5 真实 GitLab/PostgreSQL 验证（本机无实例/凭据，需 `GITLAB_TEST_*`、`WF_PG_*`，未伪造 PASS）。
- W4-6 推送已完成：远端 main HEAD `56fecaf`（最终状态提交后为新的 HEAD），本地/远端一致。

### 22:24 结项 | 全部可执行任务完成，仓库已推送

- 最终状态：所有可执行任务 `done`；仅 W2-5/W4-5 因本机无真实 GitLab/PostgreSQL 实例与凭据保持 `blocked`（不伪造 PASS）。
- 推送：https://github.com/wangyufengsky/agent-workflow-deepseek `main`，远端 HEAD 与本地一致（当前 `74b21cd`，本次结项提交后为新的 HEAD）。
- 验证基线：403 tests / 54 suites / 392 pass / 11 skipped / 0 fail；163 路由；build:web/server、test:e2e、ui:smoke 均通过。

### 22:52 修复 | Git 工作台 AI 审查无法开始（根提交无对比基线）

- 现象：Git 工作台选择根提交（仓库只有一个 initial commit）后，「AI 审查」抽屉的「开始审查」不可点，提示 compareOptions 为空。
- 根因：`packages/server/src/adapters/git-cli.ts` 的 `commitShow` 只把父提交作为 compareOptions；根提交 parents=[] → 空；且 root diff stats 用 `${sha}^` 失败显示 0 文件。`packages/git` 同样缺空树基线。
- 修复：为根提交补 `{compareId:'empty-tree', kind:'empty_tree', baseSha:4b825dc...}` 基线，root stats 用空树对比；shared `GitCompareBase.kind` 增 `empty_tree`；ReviewPanel 标签显示「对比空树（根提交）」；补 `packages/git` 同逻辑与测试。
- 验证：`tsc` 0 error；`repository.test.ts + git-api.test.ts` 34 pass/0 fail；运行中 5177 实测 commit 返回 stats files=31/additions=1095 + empty_tree 基线；真实发起 review.start（review_0mvfdh2tqax9jvwl317）receipt accepted → stage analyzing（空树 diff 已成功进入模型分析）。

### 22:58 验证 | 修复后审查可用

- 根提交（opencode-workflow-java-test@86cf281）：compareOptions 返回 `empty_tree`，stats 31 files/1095+；review.start 接受并进入 analyzing（模型随后因 flash 输出非严格 JSON 失败，属模型输出格式问题，已在 UI 回执显示）。
- 普通提交（订单服务@a79f703，1 文件 +2/-2）：review.start → **completed**，产出 2 条 findings + summary（真实模型），证明按钮与审查链路已恢复。
- 建议：根提交 31 文件的大 diff 用 flash 审查易失败；可重试或换较小提交/减少维度（后续可选：模型输出修复重试）。
