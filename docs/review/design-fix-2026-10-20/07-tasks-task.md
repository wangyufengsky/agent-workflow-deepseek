# 07 任务列表 / 任务画布 · 设计一致性修复处置记录（2026-10-20）

> 输入：`docs/review/design-audit-2026-10-20/07-tasks-task.md`（P12/P13 共 29 条）+ `15-delivery.md` 的 `DEL-26`（TD06 工作区详情抽屉）。
> 基线：`main` @ `3f6f9b2`；工作分支 `fix/design-audit-2026-10-20`（不切换、不 commit/push）。
> 判定口径：`已修复` = 设计态可达且有代码/测试证据；`部分` = 主路径可达但仍有 C1/C9/GUI 残差；`延后` = 本轮不做且写明原因（C1 契约缺失 / C9 需产品裁决 / 跨写范围 / 需 GUI）。
> 范围：`apps/web/src/pages/task/**`、`apps/web/src/pages/tasks/**`、`apps/web/src/app/taskStatus.ts`、`apps/web/src/api/workflow.ts`（task 段）、`packages/shared/src/domain/{models,task-list}.ts`、`packages/shared/src/api/contracts.ts`（task 段）、`packages/engine/src/{actions,plan,project-task,task-extras,acceptance}.ts`（最小 edit）。设计稿目录只读，未修改。

## 1. 处置总表

| ID | 状态 | 证据（文件:行） | 说明 |
|---|---|---|---|
| **P13-01** | 已修复 | `apps/web/src/pages/task/situation.ts:95,128-130,262-290`；`TaskCanvasPage.tsx:343,611-628`；`ExecutionPanel.tsx:85-92,112`（面板「执行状态」同样不再显示绿色已完成）；测试 `situation.test.ts:67-116` | 情况条按设计拆「执行与验收 / 交付」两事实：`execution.status==='completed'` 且未交付时外层固定 wait「执行已结束 · 等待交付」，只有 `task.lifecycle==='completed'` 或 `delivery.projection==='delivered'` 才显示绿色「任务已交付」；`verificationOutcome==='failed'` 另出 warn 徽标。测试断言未交付时状态 tone=wait 且输出不含「任务已完成」。 |
| **P13-02** | 已修复 | `situation.ts:95-330`（三段事实 + 唯一主操作）；`TaskCanvasPage.tsx:611-628`；`task.css` `.task-situ.situ-*` | 情况条渲染 2–3 个事实段（调整中时多一段「计划」），每段带图标/颜色/文案：执行与验收（进行到哪一步、待验收数量、失败步骤+原因）、交付（等待交付原因/回执）、计划（调整子状态）；右侧按状态给唯一就近操作（去验收/打开交付/恢复任务/立即重新读取/查看原因并恢复），不再用聚合进度替代。 |
| **P12-01** | 已修复 | `packages/shared/src/domain/models.ts:386-421`（`TaskSummary.execution/stepStates`）；`packages/engine/src/project-task.ts:570-611`（真实节点状态+验收门）；`packages/shared/src/domain/task-list.ts:15-50`（bar 状态/第 N/M 步）；`apps/web/src/pages/tasks/TaskRow.tsx:21-27,98-110`；`apps/web/src/app/taskStatus.ts:165-215`（具体「步骤名+原因」）；`tasks.css`（`.step-bars`/`.step-caption`） | 列表第三列恢复设计「每一步一格」状态条（done/run/fail/wait/unk/idle，停滞无服务事实不伪造）与「第 N / M 步」说明；「需要处理」列投影具体原因：失败步骤+服务 error、待人工验收步骤、已退回步骤、交付等待/受阻/未知、暂停等，不再显示聚合百分比。 |
| **P12-02** | 已修复 | `apps/web/src/app/taskStatus.ts:83-162`（排序：lifecycle→交付→执行→规划 stage→attention→stage）；`packages/shared/src/domain/task-list.ts:4-13`；`packages/engine/src/project-task.ts:570-593`；`situation.ts:110-160` | 「已暂停」「待人工验收」「等待重新确认」「等待审阅」「执行已结束 · 等待交付」「任务已交付」都有设计词；attention 不再覆盖更具体的执行/交付/规划事实。`TaskSummary` 新增 `execution{status,paused,pendingAcceptance,rejectedAcceptance}` 供列表判定；待人工验收计入「需要处理」分组。 |
| **P13-03** | 已修复 | `TaskCanvasPage.tsx:815-850`（右面板默认不渲染，仅「更多→执行面板…」打开，面板头有关闭）；`:448-471`（自动推进开关移回页头） | 设计 `.side.hidden`：默认全宽画布；点步骤仍打开节点详情，交付/快照/调整/执行面板按需打开。页头承接自动节点推进开关、整体推进、开始/暂停/继续、调整计划、交付、需求画布。 |
| **P13-04** | 部分 | `packages/shared/src/api/contracts.ts`（`TaskDetailResponse.attentionItems` + `TaskAttentionItem`）；`packages/engine/src/task-extras.ts:988-1040`（`taskAttentionItems`：runtime 审批/提问/策略 + 待人工验收）；`packages/engine/src/project-task.ts:496`；`situation.ts:310-330`（secondary「等待你处理」+ 主操作「去待处理中心」/「去验收」）；`TaskCanvasPage.tsx:523-535` | 审批/提问/待人工验收已进入任务详情读模型并在情况条/页头呈现；**停滞**：执行服务没有 stall 字段（`NodeStatus` 无 stall），按 C1 诚实降级——不伪造停滞，也不自造计时器，残留在区域报告 P13-04 记录。审批的定位操作仍在待处理中心（运行互动端点属 task-10/既有页面），画布内只给「去待处理中心」入口。 |
| **P13-05** | 已修复 | `packages/engine/src/actions.ts:266-272`（`adjustExecutionPlan` 允许 running 或 paused）；`PlanEditPanel.tsx:225-260`（已暂停任务可进入调整；结束调整保持暂停文案/单按钮） | 服务 action 投影与领域 `editBegin`（接受 running/paused）口径一致；`wasPausedBeforeEdit` 语义保留：结束调整不恢复任务，只有「继续」才恢复。行为由既有集成测试 `tests/integration/edit-session-pause-mode.test.ts` 覆盖回归并通过。 |
| **P13-06** | 已修复 | `packages/shared/src/api/contracts.ts:1529-1546`（`EditSaveRequest.addedNodes/removedNodeIds` + `EditAddedNode`）；`packages/shared/src/domain/models.ts:726-729`（localChanges 增 added/removed）；`packages/engine/src/plan.ts:435-611`（新增节点构造、移出节点+边清理、DAG 环校验、请求身份含 added/removed）；`apps/web/src/api/workflow.ts:270-300`；`PlanEditPanel.tsx:481-610,608-660`（新增/插入表单、从计划移除确认、撤销新增/保留、本地修改清单） | 调整待执行计划支持新增步骤（含前置/插入）、移出待执行步骤（确认弹窗：移出后不执行、不计完成条件、记录保留在审计），保存仍生成未确认修订并需重新确认。离线验证：新增 `edit_x`（前置 a）+ 移出 `b` + 改 `c` 前置为 `a,edit_x` 后，新计划节点=`a,c,edit_x`、边=`a->c,edit_x->c,a->edit_x`；confirm 后 `bindConfirmedPlan` 成功（execution 节点 a:ready/c:pending/edit_x:pending）。既有集成测试 6/6 通过。 |
| **P13-07** | 部分 | `PlanEditPanel.tsx:225-260`（申请调整确认弹窗：说明暂停新增领取+调整前自动推进模式）；`CommandErrorNotice/ReceiptNotice` 承接 accepted 回执 | 增加了确认对话与「调整前模式」摘要；仍缺设计要求的「正在暂停新增领取…（回执成功前不开放编辑）」独立过渡态——服务 begin 为同步命令，accepted 回执在命令横幅可读，但面板没有单独的 pausing 步骤条（C2/C5，成本高，本轮记为部分）。 |
| **P13-08** | 已修复 | `PlanEditPanel.tsx:665-700`（改动摘要 = `editSession.localChanges` 的 新增/修改/移出；当前整图检查 = `plan.validation` 结构/人工评审/依据/需求归属；明确「旧报告作历史」）；`planChangedSummary` 文件尾 | 重新确认前可见「改动（将变成修订 N）」与当前整图检查结果；服务未返回检查结果时诚实写「服务没有返回…不沿用旧绿勾」。 |
| **P13-09** | 已修复 | `PlanEditPanel.tsx:700-715`（`wasPausedBeforeEdit===true` → 主按钮「结束调整（任务保持暂停）」并隐藏「保持暂停」；说明需单独恢复任务） | 按钮文案与实际结果一致（`plan.ts` finish 的 keepPaused 语义不变），避免两个按钮同结果。 |
| **P13-10** | 延后 | 现状入口：`TaskCanvasPage.tsx` 失败主操作→节点、unknown→恢复页；产品恢复能力是派生恢复任务（`packages/engine/src/recovery.ts`） | C9/C6：设计「原地三种重试方式」与产品「派生恢复任务」不是同一契约，需要产品/API 裁定（区域报告 P13-10 同结论）；本轮只在情况条/横幅提供恢复入口，不伪造画布内恢复方式面板。 |
| **P13-11** | 部分 | `TaskCanvasPage.tsx:545-555`（菜单项改名「冻结计划快照…」，与写操作语义一致） | 已消除「冻结计划」同名异义（设计是只读查看、实现是写快照）；仍缺设计「当前有效计划（只读）」承载视图——需要新的只读读模型/视图（C4，后续）。 |
| **P13-12** | 已修复 | 新增 `apps/web/src/pages/task/WorkspaceDetailDrawer.tsx`（页头工作区 chip + 更多→工作区详情… → 520 抽屉）；`TaskCanvasPage.tsx:343-360`（chip）、`:520`（菜单）、`:893,912`（取消弹窗固定句+入口）、`:920-935`（抽屉挂载）；`task.css` `.task-wschip/.ws-path-gone` | 抽屉消费真实 `TaskWorkspace/TaskDelivery`：类型/公开身份/原项目/基线/任务目录与分支/子工作区/创建/最后检查/活动写入/未交付/未决原请求/已交付凭证/占用空间（服务未提供→「未知」）/在文件管理器显示（宿主能力检测，缺失时诚实禁用原因）。取消/关闭任务对话框补设计固定句「文件保留，可稍后交付 / 查看」与工作区详情入口。 |
| **DEL-26** | 已修复（TD06 8 态可达） | 同上 + `WorkspaceDetailDrawer.tsx:47-360`：`td06-detail-git/nongit`（类型分支字段）、`td06-close-retain`（固定句+入口）、`td06-cleanup-preview`（`previewWorkspaceCleanup` 弹窗：删除/保留/有效期）、`td06-cleanup-undelivered`（`requiresUndeliveredAck` 勾选）、`td06-cleanup-blocked`（blockers 列表+禁用原因）、`td06-cleanup-partial`（partial 横幅 + 「核对原清理」按 `pendingOperationRef` 只核对）、`td06-cleaned`（路径删除线 + 回执仍可读说明） | 清理命令复用真实端点（`ROUTES.workspaceCleanupPreview/Confirm`），UNKNOWN 保留原 requestKey 只核对不重发；`占用空间未知` 与「不设定时/自动清理」按设计诚实展示。DEL-27（逐步骤清理结果/阻塞定位跳转）仍属 15-delivery 区域，未在本文件覆盖。 |
| **P13-13** | 部分 | `TaskCanvasPage.tsx:180-198`（调整会话把 `lockedNodeIds` 传给画布 + 锁定图例）；`PlanEditPanel.tsx:608-660`（本地修改清单：修改/新增/移出 + 定位/撤销） | 画布锁定层与本地修改清单已补；仍缺设计「本地修改按节点定位到画布并高亮」的联动与竞态后被移出项的复制（需 GUI 视觉验证，记为部分）。 |
| **P13-14** | 部分 | `TaskCanvasPage.tsx` 页头 `执行进度/模板报告` 分段（`snapshotTemplate`）；既有 `TaskExtrasPanel` 承担进度/报告/批次 | 入口从「更多」提升到页头分段（B-07/ut-snapseg）；仍缺「最终报告/评审报告」块、功能批次局部读取失败保留进度、已取消横幅（C1：读模型把 progress+batches 合成一次读取且无最终报告契约），记为部分。 |
| **P13-15** | 已修复 | `TaskCanvasPage.tsx:710-730`（unknown 横幅加「立即重新读取」= detail/execution refetch，并写「自动重读；只核对不重发」；恢复入口并存） | 未知态可在画布内立即核对；恢复/重试动作与核对动作分离。 |
| **P13-16** | 延后 | 现状：`Shell.tsx` 侧栏待处理角标；无画布级 `role=status` 提示 | C1：需要 inbox/交付投影提供「其他任务后台待交付」事实并在画布聚合；本轮无该读模型（不伪造提示），以侧栏角标诚实呈现。 |
| **P13-17** | 部分 | `situation.ts:323`（已交付且 `verificationOutcome==='failed'` → 页头 secondary warn「交付 · 验证未通过」；交付事实文案写「已交付，验证未通过」）；`TaskSummary` 仍只有 `deliveryProjection` 6 值 | 画布/页头已能区分「已交付验证未通过」；**列表**仍无法区分（`DeliveryProjection` 缺 `delivered_verification_failed` 值，C1，属交付契约段/15-delivery），记为部分。 |
| **P13-18** | 延后 | — | 节点 Enter 打开详情的键盘激活实现点在 `apps/web/src/flow/**`（task-4 写范围），本轮不跨范围修改；且区域报告标注需 GUI 实测，避免假称已修复。 |
| **P13-19** | 已修复 | `TaskCanvasPage.tsx:745-780`（固定模板横幅补 pe36「不能做的事 / 可以做的事」清单 + 新建模板任务指引）；`task.css` `.fixed-template-lists` | 模板任务边界说明可见；锁定/统一原因/禁用入口保持。 |
| **P13-20** | 部分 | `TaskCanvasPage.tsx:520-575`（任务恢复仅 failed/stopped/unknown 出现；模板任务页头「阅读运行内容」；菜单保留执行面板/工作区详情/冻结快照/审计/快照评审/运行内容） | 按状态收窄了任务恢复与运行内容入口；「继续任务…」仍保留在更多菜单（与页头“继续”重复），未按设计移除，记为部分（P3）。 |
| **P12-03** | 已修复 | `apps/web/src/app/taskStatus.ts:227-233`（preparing → `/requirement/:id?tab=workspace`） | 「待准备工作区」行点击直达需求画布「工作区」页签。 |
| **P12-04** | 部分 | `TasksPage.tsx:88-120`（filter/keyword/grouped 写入 URL，返回/刷新恢复）；`TaskRow` 跳转仍为普通 push | 列表上下文已持久化到 URL，浏览器返回可恢复；仍缺设计显式 `returnTo` 参数与 Shell 面包屑返回还原（面包屑属 task-1 全局外壳），记为部分（P2，需 GUI 验证）。 |
| **P12-05** | 已修复 | `TasksPage.tsx:227`（页面标题「任务」）；`:305`（表头第三列「步骤」）；`tasks.css` 新增 `.tasks .task-thead/.task-row` 列宽 150px + `.task-need` 两行截断 + 1100/900 断点 | 顶层标题与内容标题不再重复；第三列按设计「步骤」150px；断点下按设计隐藏「需要处理」/状态列。像素级观感仍需 GUI，但结构/列宽已对齐。 |
| **P12-06** | 已修复 | `TasksPage.tsx:163-178`（`ServiceNotice title="任务列表读取失败"` + 「本地服务没有响应。筛选条件已保留。」） | 读取失败文案与设计原文一致，并说明筛选保留。 |
| **P12-07** | 延后 | 现状 `TaskRow.tsx` 仍用 `methodName` 徽标 | C1：`TaskSummary` 无 `kind`/`fixedTemplate` 摘要；本轮只补了列表执行事实契约以减少跨区域契约改动，模板/文档任务类型徽标需下一批契约（P3）。 |
| **P12-08** | 部分 | `TasksPage.tsx` 表尾删除重复「查看已归档」与「待处理中心」，只保留「已加载 N / total · 加载更多」；刷新保留在页头 actions | 与设计单入口基本一致；「已加载 N / total」文案与设计的「已加载 N 个」仍有差异（口径含 total，P3），记为部分。 |
| **P13-21** | 延后 | — | C9/C1：产品未发布、无「独立工作区上线前」历史数据，`Task` 无 origin/legacy 字段；旧版记录（ut-legacy-done/stopped）按设计预留场景延后。 |

## 2. 验证证据

1. `npm run typecheck`：**0 错误**（全仓通过；含本任务新增/修改文件）。
2. `node --import tsx --test apps/web/src/pages/task/situation.test.ts`：**8/8 通过** —— 覆盖 P13-01（执行完成未交付=wait、只有交付读回才 done、已交付验证未通过=warn）、P13-02（两事实/唯一主操作、暂停、失败原因、调整事实）、P13-04（runtime 审批不伪造停滞）。
3. 既有集成测试回归：`tests/integration/plan-edit-binding.test.ts`、`tests/integration/edit-session-pause-mode.test.ts` **6/6 通过**（P13-05/P13-06 涉及的 editSave/editFinish/暂停语义未被破坏）。
4. 引擎离线验证（一次性脚本，未入库）：paused 下 `capabilities.adjustExecutionPlan.allowed=true`；editSave(addedNodes+removedNodeIds+changes) 生成的新计划节点/边正确、`localChanges` 含 added/removed；confirm 后绑定成功；`GET /api/tasks` 摘要含 `execution/stepStates`；`GET /api/tasks/:id` 含 `attentionItems` 数组。
5. 未执行（诚实标注）：GUI 四主题/断点像素、键盘矩阵、真实交付（awaiting→delivered）投影、真实清理（阻塞/部分清理/已清理）、并发领取竞态视觉 — 均需 GUI/真实服务，未在本轮声称通过。

## 3. 跨区域与延后原因汇总

- **C1 契约缺失**：停滞事实（NodeStatus 无 stall）、审批动作的画布内就地处理（运行互动端点归属待处理中心）、`DeliveryProjection` 缺「已交付验证未通过」、`TaskSummary` 无任务类型/模板摘要、最终报告/批次局部读模型、旧版记录 origin。
- **C9 需产品裁决**：画布内「恢复这一步」三种方式 vs 产品派生恢复任务语义；旧版记录只读边界。
- **跨写范围**：键盘 Enter 打开节点在 `apps/web/src/flow/**`（task-4）；全局返回/面包屑在 `apps/web/src/app/**`（task-1）；交付投影内部在 `apps/web/src/pages/delivery/**` + `packages/engine/src/delivery.ts`（task-7）。
- **共享文件最小 edit 说明**：`packages/shared/src/domain/models.ts`（TaskSummary/TaskStepState/EditSession.localChanges）、`packages/engine/src/project-task.ts`（#summary/detail 投影）、`packages/engine/src/plan.ts`（editSave add/remove）、`packages/engine/src/actions.ts`（adjustExecutionPlan paused 一行）均按最小 edit 修改并经 typecheck；与 requirement（task-5）已事先点对点约定 actions.ts/plan.ts 的段落归属。
- **DEL-01 边界（给 Lead/task-7）**：按 Lead 协调，`packages/engine/src/workspace.ts` 的 TD01 准备异常投影归 delivery-parity，本任务未改；DEL-26 抽屉只消费现有 `TaskWorkspace` 字段（缺失字段如占用空间按「未知（服务未提供）」诚实展示）。
