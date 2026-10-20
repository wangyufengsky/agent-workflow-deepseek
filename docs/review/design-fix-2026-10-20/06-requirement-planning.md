# 需求画布（P11 · planning/PW/PE37/LG）设计一致性修复处置 · 2026-10-20

> 任务：task-5（区域 06）。权威审计：`docs/review/design-audit-2026-10-20.md` + `docs/review/design-audit-2026-10-20/06-requirement-planning.md`。
> 基线：`main@3f6f9b2`；分支 `fix/design-audit-2026-10-20`（未 commit/push/checkout）。
> 写范围：`apps/web/src/pages/requirement/**`、`apps/web/src/api/workflow.ts`（planning/requirement 函数，最小 edit）、`packages/shared/src/api/contracts.ts`（planning/workspace 段，最小 edit）、`packages/shared/src/domain/enums.ts`（planning 段，最小 edit）、`packages/shared/src/domain/planning.ts`、`packages/server/src/http.ts`（requirement/planning/workspace 路由段，最小 edit）、`packages/engine/src/planning.ts`、`packages/engine/src/plan.ts`、`packages/engine/src/actions.ts`（planning/workspace action 投影）。共享文件均最小 edit，未整文件重写；设计稿目录只读。
> 状态口径：**已修复**=代码可达且服务权威字段/命令闭环；**部分**=主链可达但存在服务契约缺口（C1）或标注为能力缺口；**延后**=本轮未做（排期/跨区域）。

## 汇总

| ID | 严重度 | 状态 | 一句话 |
|---|---|---|---|
| P11-01 | P1 | 已修复 | 「计划」页签有计划步骤清单 + 单步手改（职业/做什么/产出说明/验收/前置）→ 新计划修订 + 回执；PE28「改为先后执行」形成新差异并重新检查 |
| P11-02 | P1 | 已修复 | 命令层持有 requestKey：UNKNOWN/传输失败后锁定原操作，只保留“按原请求号核对”，页面与 5 个对话框共用锁 |
| P11-03 | P1 | 已修复 | 准备独立工作区 / 开始执行各自独立确认对话框（将创建/保持不变/绑定/首批步骤/不执行说明） |
| P11-04 | P1 | 部分 | 六个 PW 异常态 + unavailable/failed 均有服务投影、专属横幅与唯一动作，未知/受阻不可再次 prepare；name-conflict「使用新名称重新预览」已由 task-7 服务层 branchName/directoryName override 接通；仅 partial「只补缺步」仍为能力缺口（C1） |
| REQ-01 | P1 | 已修复 | 必答问题门禁（actions/preview/start/saveAnswer 四层）+ 保存答复后候选按新输入修订重新校验（QA02 ok / QA03 stale） |
| REQ-02 | P1 | 已修复 | 硬阻塞候选改为可审阅态（轮次不判失败）：应用被服务禁用并给出“有 N 个必须处理的问题”，不采用/新一轮可用 |
| P11-14 | P3 | 已修复 | 计划来源/执行状态/计划修订状态/轮次状态改用中文标签，不再渲染英文枚举 |
| REQ-05 | P2 | 已修复 | 停止事实补回执号、受理时间、停稳时间；三件事分开写（停稳/结账不合并） |
| REQ-11 | P2 | 部分 | 不采用原因改为可选；应用框/确认框分区展示“业务决定/风险核对/确认范围·规划依据”；`planningBindingHash` 服务未提供（C1，确认框诚实说明） |
| REQ-12 | P2 | 已修复 | 固定模板任务在计划页签新增“固定模板”区块（模板/版本/入口参数/固定步骤/能做/不能做），确认框带同样摘要 |
| REQ-14 | P2 | 部分 | 检查页新增“并行写冲突（PE28）”区块，`改为先后执行` 可用（engine `plan.edit.draft` 序列化 + V7 重检），`申请子隔离与汇合` 禁用并写“未安装 · 后续分期” |
| REQ-15 | P2 | 部分 | 候选过期横幅逐项写“候选基于修订 X → 当前修订 Y”和服务重校验结论，并提供按当前输入预览新一轮入口；资料变化维度仍由服务基准指纹缺失（C1） |
| REQ-13 / P11-09 等 | P2 | 延后 | 见下“延后清单” |

## 逐条处置

### P11-01 「计划」页签没有计划步骤清单与手改入口（dirty/unbound/PE31/PE28）— 已修复

- **服务命令**：`packages/engine/src/plan.ts:248` 新增 `PlanService.editDraft()`：只允许确认前（`CONFIRMING/DRAFT` 且计划 `unconfirmed/draft`）手改；校验请求号/修订号/固定模板/职业目录/前置存在性/无环；生成 `source:'edit'` 的新未确认计划修订（保留旧修订为 superseded），重算 `structural/humanReview/basis/readiness/checks/requirementCoverage` 与 `diffGraphs` 差异；不调用模型、不执行；写 `plan.changed` 并 settle 回执。
- **PE28 串行采纳**：同命令 `serialize:[{fromNodeId,toNodeId}]` 追加 `kind:'order'` 边；`validatePlanningCandidate` 支持可选 `resourceOrderAware`（`packages/shared/src/domain/planning.ts`，默认 false，AI 候选行为不变），有序写入不再判 `WRITE_COLLISION`，`V7` 重检通过；用户手改的顺序作为“已人工判断”记录。
- **契约/路由**：`packages/shared/src/api/contracts.ts` `PlanDraftEditChange/PlanDraftSerializePair/PlanDraftEditRequest/PlanDraftEditResponse`、`ROUTES.planEditDraft`；`packages/shared/src/domain/enums.ts` `OperationKind.PLAN_EDIT_DRAFT` + `OPERATIONS['plan.edit.draft']`（requestKey 契约）；`packages/server/src/http.ts:788` `POST /api/tasks/:id/plan/edit-draft`（在 `COMMAND_ROUTE_SIGNATURES` 中预校验 requestKey）。
- **前端**：`apps/web/src/pages/requirement/PlanReviewPanel.tsx:291` 计划步骤清单（步骤/职业/分组/产出/验收/未指定职业徽标/选中），`:415` `NodeEditForm`（做什么、产出说明、验收条款、职业下拉、前置多选）→ 保存为新计划修订；`apps/web/src/pages/requirement/RequirementCanvasPage.tsx` `runNodeEdit`/`runSerializeSteps` 经回执命令层提交；`plan.source==='edit' && unconfirmed` 显示“计划已手改（未确认）”横幅（dirty），`unboundNodes>0` 显示 unbound 横幅并可定位到未绑定步骤。
- **验收证据**：临时验证脚本（仓库根运行后删除）断言：手改后 `revisionNumber+1`、title/roleId 生效、`serialize` 后硬问题中不再含 `WRITE_COLLISION` 且 `V7=passed`；全仓 typecheck 对本区域 0 错误。
- **仍不可静态验证**：保存回执 UI 与真实服务下的脏修订行为需 GUI（见“需 GUI”）。

### P11-02 UNKNOWN 回执后原操作不锁定、可换新 requestKey 重投 — 已修复

- **命令层**：新增 `apps/web/src/pages/requirement/requirement-command.tsx` `useReceiptCommand()`：命令持有 requestKey；`receipt.status==='unknown'` 或传输层不确定（`unavailable/timeout/5xx`）→ 进入 `pendingUnknown{operation,requestKey,message}`；锁定期间 `run()` 直接拒绝任何新提交；唯一出口 `lookup()` 走 `GET /api/operations/:key`（只读），`stillUnknown` 时保持锁定，结论明确才解锁。页面级状态，对话框关闭后仍锁。
- **API 传键**：`apps/web/src/api/workflow.ts` 的 planning/requirement 命令函数全部支持调用方传入 `requestKey`（start/stop/apply/reject/saveAnswer/skeleton/confirm/prepare/startExecution/editDraft），默认仍在函数内生成（其他页面行为不变）。
- **UI**：`RequirementCanvasPage.tsx:640` 页面横幅 `UnknownLockBanner`；`requirement-command.tsx:129` 统一锁横幅（原请求号 + 核对结果）；页头/侧栏/计划页操作按钮在 `lockedReason` 存在时禁用并显示“只按原请求号核对”；5 个对话框（预览/应用/不采用/停止/确认）全部改为走页面回执层并各自展示锁横幅（`dialogs.tsx:134/281/377/451/534`），不再保留独立 `useDialogCommand` 自由重投路径；准备/开始对话框同样受锁。
- **验证**：代码证据（无网络故障注入）；真实丢包场景需 GUI/真实服务（审计口径一致）。

### P11-03 准备独立工作区 / 开始执行缺独立确认 — 已修复

- **准备确认**：`apps/web/src/pages/requirement/WorkspacePanel.tsx:837` “准备独立工作区 · 确认”（补建/重试复用同框，标题与说明区分）：列出项目、已确认计划修订、将创建（任务身份登记/固定基线+当前 SHA/任务分支或独立副本/工作目录/核对）、保持不变（原项目目录/默认分支/其他工作区/不会 git init）、预览阻塞项与同名对象；确认才发 `prepareWorkspace`，明确“准备回执不当成执行成功”。
- **开始确认**：`WorkspacePanel.tsx:944` “开始执行 · 确认”：已确认计划修订、工作区位置、基线、第一批步骤（计划图无入边的根步骤，来自服务图数据）、“准备回执不当成执行成功/开始后可暂停继续取消”。
- **基线核对接线**：`apps/web/src/api/workflow.ts:316` `prepareWorkspace` 现接收并提交 `expectedBaseTip`（来自准备预览 `currentBaseSha`），所以基线前移会被服务以 `STALE_TARGET` 拒绝（此前前端从不触发核对）。
- **验证**：静态；取消焦点归还与真实准备/开始需 GUI（见“需 GUI”）。

### P11-04 工作区 PW 六异常态唯一动作缺失、未知/受阻仍可再次准备 — 部分

- **服务投影（真实字段，不伪造）**：
  - 契约：`packages/shared/src/api/contracts.ts:1603` `WorkspacePrepareOutcome`、`:1616` `WorkspacePrepareProjection`（outcome/requestKey/operationStatus/errorCode/errorMessage/detail/failedStep/checkedAt）、`:1628` `WorkspacePreparePreview`（baseRef/currentBaseSha/workspaceBaseSha/steps/sameNameObjects/emptyRepo/suggestedBranchName/blockers/readError）、`TaskDetailResponse.workspacePrepare?`、`WorkspaceResponse.prepare?`。
  - `packages/server/src/http.ts:239` `workspacePrepareProjection()`：`unknown` 来自最新 `task.workspace.prepare` operation `status=unknown`（进程重启恢复路径）或 `workspace.state='unknown'`；`partial` 来自 `workspace.state='partial'`；其余失败态读取 prepare 路由 catch 持久化的投影（`:168` key `task.workspace.prepare.projection.<taskId>`）：`drift`=STALE_TARGET（expected/actual）、`empty`=details.empty、`denied`=FORBIDDEN/UNAUTHORIZED/权限文案、`conflict`=WORKSPACE_NAME_CONFLICT/同名文案、`unavailable`=CAPABILITY_UNAVAILABLE、`failed`=其余明确失败；成功 prepare 清除失败投影。
  - `packages/server/src/http.ts:293` `workspacePreparePreview()`：只读，真实 `engine.ports.git.status/branches` 读当前 HEAD、同名分支对象（含 tip sha/是否被其他 worktree 检出）、空仓库、读取失败；`suggestedBranchName` 仅建议、无应用能力。路由 `POST /api/tasks/:id/workspace/prepare-preview`（:891）。
  - `detail`/`workspace` GET 把投影与唯一动作投影合并进 `capabilities`（`http.ts:587` `taskDetailEnvelope`、`:885` workspace GET）。
- **唯一动作投影**：`packages/engine/src/actions.ts:346` `workspacePrepareActions()`：
  - `prepareWorkspace` 仅 `outcome==='none'`（从未准备）允许，其余逐个用对应原因禁用（unknown“只按原创建核对，不能再准备新的工作区”/partial“先补建”/conflict/drift/denied/empty/ready/preparing/failed/unavailable）；
  - `reconcilePrepare`（unknown，原创建 by-key 核对）、`repairPrepare`（partial，补建）、`rereadBaseline`（drift，重读基线并预览）、`rereadWorkspace`（denied/conflict/failed，重新读取）、`newTaskFromEmpty`（empty，从“开始任务”新建）、`retryPrepare`（明确失败，新请求号重试）、`renameWorkspace`（conflict 唯一动作；task-7 服务层命名 override 接通后 `allowed`，UI 打开“使用新名称重新预览”流程）。
- **UI**：`WorkspacePanel.tsx:89` `PrepareOutcomeBanner` 按六态+unavailable/failed 渲染专属文案（原请求号/失败阶段/错误码/最近检查）；`:417` 起按投影渲染唯一动作按钮（含按原创建请求号核对与核对结果、补建、重读基线、重新读取、从开始任务新建、冲突“使用新名称重新预览…”），未知/受阻时不再出现可点的“准备独立工作区”。
- **name-conflict 已接通（服务层由 task-7 提供）**：`packages/shared/src/api/contracts.ts` `PrepareWorkspaceRequest.branchName?/directoryName?`、`WorkspacePreparePreview.suggestedDirectoryName?`、`sameNameObjects` 含 `kind:'worktree'`；`packages/engine/src/workspace.ts:147-213` 使用覆盖名并在准备前主动检查同名分支/目录（命中 `WORKSPACE_NAME_CONFLICT` + `details.occupied`，不覆盖不静默复用）；`packages/server/src/http.ts:331-360` 预览成对生成 `-2` 后缀建议名。UI：冲突态启用“使用新名称重新预览…”（刷新预览 + 打开准备确认框），确认时传 `branchName`/`directoryName`，显示旧对象与将用的新名称；新名称可用时 name-conflict 阻塞不再阻断确认（`unresolvedBlockers` 过滤）。
- **剩余能力缺口（C1，延后）**：`PW-PARTIAL` 的“只补建缺失步骤”需要 GitPort 的“复用已存在分支 add worktree”能力（adapter 属其他域，task-7 未伪造）；UI 复用 prepare 作为“补建工作目录”（幂等重跑已有对象）并诚实说明。不是前端伪造。
- **验证**：静态 + 临时脚本断言 6 类投影的动作投影（unknown 禁止 prepare/允许核对；partial 禁止 prepare/允许补建；empty 禁止 prepare/允许新建；none 允许 prepare）；真实 Git 场景（空仓库/基线前移/同名/无权限）需 GUI/真实服务。

### REQ-01 「问题必答」门禁缺失 + 答复后不重新校验候选（PE11/QA02/QA03）— 已修复

- **门禁四层**：
  - `packages/engine/src/actions.ts:191,210`：上一轮存在必答未答复问题时 `generatePlan` 以 `ANSWER_REQUIRED` 禁用（“先保存答复再预览新一轮”）；
  - `packages/engine/src/planning.ts:205`：`preview()` blockers 增加 `ANSWER_REQUIRED`（预览对话框可见且确认按钮禁用）；
  - `packages/engine/src/planning.ts:259-266`：`start()` 服务端拒绝绕过（`ANSWER_REQUIRED`）；
  - `packages/engine/src/planning.ts:1293`：`saveAnswer()` 服务端要求所有必答问题有答复（增量保存合并已有答复），未满足拒绝；
  - 前端 `apps/web/src/pages/requirement/DraftPanel.tsx`：保存按钮在必答未齐时禁用并写“还有 N 个必须回答的问题未答复”，列出问题文本；`RequirementCanvasPage` 必答横幅写清“全部回答并保存前不能预览新一轮”。
- **答复后候选重新校验（QA02/QA03）**：`packages/engine/src/planning.ts:1352` `#revalidateCandidate()`：保存答复形成新需求输入修订后，不调用模型，用确定性规则（`planGraphToCandidatePayload` + `validatePlanningCandidate`）重检已有候选并更新候选修订 `validation`：
  - 一致 → `round.stage='awaiting_review'`、`basis.state='complete'`（“答复已保存为需求输入修订 N；候选按确定性规则重新校验通过”）；应用动作恢复可用 → QA02 可达；
  - 不一致 → `basis.state='stale'`（“候选基于修订 X，当前修订 Y；按当前输入预览新一轮”）且候选结构保持 failed → 应用被服务禁用、横幅给出 QA03 文案 + “按当前输入预览新一轮/不采用”；`RequirementCanvasPage` 增加 QA02 成功横幅与 QA03 过期横幅。
- **影响步骤可见**：`DraftPanel` 问题卡显示影响的步骤数量并“定位到第 1 个”（检查图层选中）。
- **验证**：临时脚本断言必答未答时 `generatePlan.allowed=false` 且原因含“必须答复”；真实“保存答复→重校验”行为需真实服务/GUI（服务端逻辑为确定性、可单测，但本轮未新增 engine 测试文件——测试文件不在 task-5 写范围）。

### REQ-02 候选硬阻塞时应用/不采用被服务投影禁用且原因误导 — 已修复

- **轮次落态**：`packages/engine/src/planning.ts:600-640` 起：模型提交的候选未通过结构检查时，轮次不再写 `status='failed'/'stage='failed'/'failure'`，而是 `status='completed'` + 候选保留（`awaiting_review`，若同时有必答问题则 `needs_answer`），`lastActivity='候选硬阻塞：N 个必须处理的问题'`，start 回执 settle 并带 `candidateBlocked/hardProblemCount`；“明确失败”（模型未提交/调度失败）仍保持 failed（pe22 与 pe27 区分）。
- **动作投影**：`packages/engine/src/actions.ts:196-226`：`candidateBlocked` 时 `applyCandidate` 以 `HARD_PROBLEMS` 禁用，原因 `有 N 个必须处理的问题：<前 3 个标题>…；这些规则不能忽略（补充输入或手改后再试，或不采用候选）`；`rejectCandidate` 在候选存在且非运行中时允许（硬阻塞也可“不采用”）；`generatePlan` 允许（“补充输入后新一轮”，服务端不受候选 pending 阻塞）；stale 候选给 `STALE_INPUT` 专用原因。
- **前端**：`RequirementCanvasPage` 新增“候选硬阻塞：N 个必须处理的问题”/“候选已过期（答复与候选不一致）”横幅（列问题标题，动作：查看检查问题/编辑输入后新一轮）；`PlanReviewPanel` 的应用禁用原因改用服务 action（不再是“没有候选”）；失败横幅只对 `round.failure` 渲染（硬阻塞不再显示“本轮失败”）。
- **验证**：临时脚本断言 blocked 候选：`applyCandidate.allowed=false` 且原因含“必须处理的问题”、`rejectCandidate.allowed=true`、`generatePlan.allowed=true`。

### 其余 P2（本轮已尽力）

- **P11-14 已修复**：`requirement-ui.tsx` `PLAN_SOURCE_LABEL`（initial/skeleton/applied/manual/template/edit 中文）、`ChecksPanel` 计划修订状态用 `PLAN_REVISION_STATUS_LABEL`、`TrackingPanel` 执行状态用 `EXECUTION_STATUS_LABEL`、轮次下拉用 `PLANNING_STATUS_LABEL`。
- **REQ-05 已修复**：`RequirementCanvasPage.formatStoppedFacts` 输出“停止请求：已受理（回执 req_… · 受理时间）”与“停稳时间”；三件事（受理/停稳/结账）分开写，`processState/accountingState/settledAt` 均来自 `PlanningRound.stop`。
- **REQ-11 部分**：`dialogs.tsx` 应用框按“业务决定（输入修订 N）/将随应用记录的风险核对”分区；确认框按“确认范围 · 计划依据”列计划修订/来源/需求输入修订/检查依据/覆盖/人工判断/读写范围；不采用原因改为可选（保留空原因默认文案）。`planningBindingHash` 服务读模型未提供 → 确认框诚实写 C1，不伪造 hash。
- **REQ-12 已修复**：见 P11-01 证据同文件：`PlanReviewPanel` “固定模板”区块（模板/版本/入口参数/固定步骤/能做/不能做统一原因），`ConfirmPlanDialog` 同样摘要。
- **REQ-14 部分**：`ChecksPanel` 新增“并行写冲突（PE28）”区块：从服务计划图写资源分组得出冲突步骤对，“改为先后执行”调用 P11-01 的 `editDraft(serialize)` 形成新差异并重检；“申请子隔离与汇合”禁用并写“未安装 · 后续分期（设计明确不开放）”。
- **REQ-15 部分**：过期横幅/计划面板应用禁用原因改为服务重校验结论（输入修订 X→Y、QA02/QA03），页头在候选阻塞/过期时放行“编辑输入后新一轮”（`generatePlan` 投影允许），可重新预览；计划修订/资料变化维度仍需候选基准指纹（C1）。

## 跨区域协作（task-7 delivery-parity）

- `packages/engine/src/workspace.ts` 的 name-conflict override（`branchName/directoryName` + 主动同名检查）与 prepare 失败读模型（失败/未知后重读已发生对象、state=partial/unknown、pendingOperationRef、lastCheckedAt）由 task-7 提供；本区域 UI 按其契约接线，`packages/engine/src/workspace.ts` 未由 task-5 修改。
- DEL-01（TD01 隔离准备异常家族 UI）与本区域 P11-04 为同一片 UI：六态横幅/唯一动作/两步确认在 `WorkspacePanel.tsx`；task-7 在 `15-delivery.md` DEL-01 行引用本文件证据（跨区域协作）。

## 延后清单（本轮未做/排期）

| ID | 状态 | 原因 |
|---|---|---|
| P11-01 剩余（新增/插入/移出步骤的 UI 入口） | 部分 | 本轮做了单步编辑（职业/做什么/产出说明/验收/前置）与串行采纳；新增/移出节点需要扩展 `EditSaveRequest` 类契约（与 task-3 P13-06 重叠），避免双写冲突延后 |
| P11-04 剩余（partial 只补缺步） | 部分 | 需 GitPort “复用已存在分支 add worktree”能力（跨域）；UI 复用 prepare 诚实说明并记 C1。name-conflict override 已由 task-7 服务层接通，UI 已接线 |
| REQ-03 状态条信息（资料数/修订 1/1/达上限 pe12） | 延后 | 需 `PlanningRound` 达限事件与用量投影（C1），排期 |
| REQ-04 规划中补充输入（pe13/b06） | 延后 | 需新增需求画布内补充保存与预览草稿保留（PATCH 契约已有），排期 |
| REQ-06/07 待核对/断连细化 | 延后 | 需 reconcile 分项进度与 last-known 运行快照（C1） |
| REQ-08 工具卡详情/宽阅读 | 延后 | 需规划记录 DTO 补工具参数/结果/截断（C1） |
| REQ-09 部分草稿独立检查点读模型 | 延后 | 需服务独立检查点读模型（C1） |
| REQ-10 历史轮输入快照/原账 | 延后 | 需历史轮输入投影（C1） |
| REQ-13 PE37 组候选明细/应用后剩余组提示/超限分期 | 延后 | 需组级用量与检查摘要投影（C1），排期 |
| REQ-16 补读横幅 | 延后 | 低风险文案增强，排期 |
| P11-05..08、P11-10..13、P11-15 | 延后 | P2/P3；P11-05（PW 五阶段文案/准备绑定）与 P11-04 同区域但需服务阶段名/绑定哈希（C1），P11-06 胶囊子状态跨共享组件（task-1 范围），P11-13 主按钮语义 P3 |

## 验证

- `npm run typecheck`：本区域改动文件（`apps/web/src/pages/requirement/**`、`apps/web/src/api/workflow.ts`、`packages/engine/src/{plan,planning,actions}.ts`、`packages/server/src/http.ts`、`packages/shared/src/{api/contracts.ts,domain/planning.ts,domain/enums.ts}`）**0 错误**；全仓仅剩 `apps/web/src/pages/ppt/PptPage.tsx:338,345`（task-2 PPT 并行编辑，非本区域）。
- 临时验证脚本（真实 `Store`+`Engine`，运行后删除）：断言 P11-01 手改/串行（新修订、title/roleId 生效、serialize 后 `WRITE_COLLISION` 消失且 V7 passed）、REQ-02 阻塞候选动作投影、REQ-01 必答门禁、P11-04 投影动作（unknown/partial/empty/none），全部通过。
- 未新增提交到仓库的测试文件：`packages/engine/src` 测试文件不在 task-5 写范围；相关 engine 测试（`node --import tsx --test packages/engine/src/graph.test.ts`）未受本区域改动影响（`validatePlanningCandidate` 新参数默认保持旧行为）。
- 现有相关测试：`node --import tsx --test packages/shared/src/domain/machines.test.ts packages/engine/src/graph.test.ts` 通过（见执行记录）。

## 需 GUI / 真实服务验证（不得当作已通过）

1. 计划步骤手改的保存回执、dirty/unbound 横幅与确认流程（真实服务/GUI）。
2. UNKNOWN 锁定：停止/应用/确认/不采用/准备/开始的真实丢包场景（网络故障注入），核对为 still_unknown 时保持锁定。
3. 准备/开始两步确认的取消焦点归还与“准备回执不当成执行成功”。
4. 六种 PW 异常态真实 Git 场景：空仓库、同名分支、基线前移、无权限、准备中重启（unknown）、部分创建；以及非 Git 目录副本。
5. 必答问题保存答复后的服务重校验（QA02 可应用 / QA03 过期）与新一轮预览。
6. 候选硬阻塞真实模型夹具下的轮次落态（不判失败）与“不采用/补充输入后新一轮”。
7. 四主题下新增横幅/按钮/对话框样式（颜色全部走主题令牌，未新增硬编码颜色）。

---

## task-12 第三批（P2/P3 收口）对区域 06 的复核（追加）

本轮 Lead 时间闸门限定区域 09 修复 + 区域 06 剩余 P2/P3 评估，未新增区域 06 代码改动；逐条处置维持上文“延后清单”结论：

- 需服务契约（C1）：REQ-03（达上限事件/用量投影）、REQ-04（规划中补充保存，PATCH 仅 DRAFT 阶段）、REQ-06/07（reconcile 分项/last-known 快照）、REQ-08（工具参数结果 DTO）、REQ-09（独立检查点读模型）、REQ-10（历史轮输入快照）、REQ-13（组级用量/检查摘要）、P11-05（准备阶段名/绑定哈希，PW 五阶段文案可后续低成本统一）、P11-11（轮次格式版本）。
- 需跨写范围/共享组件：P11-06（StageCapsule 子状态，task-1 范围）、P11-07（returnTo/面包屑，apps/web/src/app 范围）、P11-10（无权限态需读模型字段）、P11-12（Modal 焦点陷阱在 components 范围；页签方向键与缺口可聚焦属本区域、后续可做）。
- 设计裁决（C9）：P11-13 主按钮语义、REQ-13 PE37 上限分期口径、REQ-11 planningBindingHash。
- 本轮实际代码改动文件仅区域 09（见 `09-inbox-insights.md` 追加节），区域 06 文件未再变更，避免与他人并行改动冲突。

## 逐条补充处置（Lead 收口核对后补录）

| ID | 状态 | 证据 | 说明 |
|---|---|---|---|
| P11-07 | 延后 | 区域报告 P11-07 | 面包屑与 returnTo 上下文属全局导航（Shell/navigation）与页面联动，本轮未改；记录为后续批次（C4/C5）。 |
| P11-08 | 延后 | 区域报告 P11-08 | v5 规划职责/规划策略只读目录入口需目录读模型与返回语义扩展（C1/C5），本轮未做。 |
| P11-11 | 延后 | 区域报告 P11-11 | 旧版本/不支持轮次状态分支需服务提供轮次兼容性事实（C1），不伪造 unavailable 态。 |
| P11-12 | 延后（部分随全局组件） | `components/focusTrap.ts`（task-1 已为 Modal 加焦点陷阱）；面板页签方向键未做 | 键盘矩阵需 GUI 复验；Modal 焦点循环已由 GLB-13 提供，页签方向键与缺口线可聚焦仍待后续批次（C8）。 |
| REQ-07 | 延后 | 区域报告 REQ-07 | 断连横幅“最后已知服务状态与时间”需持久服务状态字段（C1）；停止按钮按断连禁用与命令锁定语义需统一命令层，本轮未改。 |

