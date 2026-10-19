# 补稿 v4 · API 候选契约增量

> 候选读模型 / 命令补充，**不是现有接口事实**，原型没有调用任何接口。与 v3 `API-NEEDS-DELTA.md`（25 项）叠加；冻结时遵守交接核对的提醒：acceptedRiskRefs 只记许可内的人工判断，不批准硬阻塞 / 关键假设 / 新权限；资源 access / basis 保留 unknown；originalGenerationClosed 只能是派生事实；事件、DTO、Schema 同版冻结。

## C01 统一任务视图

| # | 字段 / 动作 | 用途 | 界面位置 |
|---|---|---|---|
| U1 | `task.origin`：`ai-planning \| ordinary \| fixed-menu-template \| legacy-direct` | 决定能力边界（可调整 / 只读 / 旧版记录），不决定页面 | 来源 chip、调整按钮、锁 |
| U2 | `task.legacy`：`{endedBeforeIsolation:true, endedAt, outcome:'completed'|'stopped'}` | 旧版记录：没有工作区与交付端点 | `ut-legacy-*` |
| U3 | `task.requirementRef`（可空）+ `planRevision` | “在需求画布查看”与 B08 回链 | 更多菜单、当前有效计划 |
| U4 | `execution.autoAdvance`（布尔，服务事实）+ `execution.state: running|paused|...` | 自动节点推进开关、暂停 | 页头开关、恢复任务 |
| U5 | `actions.advanceAll{enabled, count, reason}`、`actions.advanceSuccessors(nodeId){enabled, nodes[], waitingFor[]}` | 整体推进 / 推进直接后继；同次不级联、并行汇合原因 | 页头、步骤面板 |
| U6 | 列表投影增加 `task.id`、`origin`、`stateKey`（统一视图路由键）、`requirementId` | 列表行直接打开统一视图并带身份 | 任务列表、需求目录、待处理 |
| U7 | `legacyRoute(oldState) → (view, state, taskRef)` 仅用于深链兼容（客户端表即可） | 旧深链不静默降级 | navigation.js |

## C02 需求画布内准备区

| # | 字段 / 动作 | 用途 |
|---|---|---|
| P1 | `prepare.binding{taskRef, projectRef, planRevision, planningBindingHash | templateRef@rev, baselineRef, workspaceIdentity}` | “准备绑定”区；变化即失效，需重新预览 / 确认 |
| P2 | `prepare.preview{kind:'git-worktree'|'snapshot-copy', branch, workdir, excludes[], skippedResources[], keep[]}` | 准备确认框“将创建 / 保持不变” |
| P3 | `prepare.status{stage, stages[], state:'idle'|'preparing'|'ready'|'unknown'|'partial'|'conflict'|'baseline_moved'|'project_unreadable'|'baseline_unavailable', prepareKey}` | 工作区页签与阶段胶囊 |
| P4 | `prepare.reconcile(prepareKey)` | 回执未知只核对原创建，不生成新 key |
| P5 | `prepare.repair(prepareKey, missing:['workdir'])` | 部分创建只补建缺失部分 |
| P6 | `prepare.renamePreview()` → 新名称；`baseline.reread()` → 新基线（需重新确认） | 同名冲突、基线前移 |
| P7 | `project.access.reread()`；错误码 `PROJECT_UNREADABLE` / `BASELINE_UNAVAILABLE` | 无权限、空仓库 |
| P8 | `execution.start(taskRef, workspaceRef)`（与准备分开） | 单独开始执行 |

## C03 固定模板

| # | 字段 / 动作 | 用途 |
|---|---|---|
| F1 | `template.instantiate → task{origin:'fixed-menu-template', templateRef, templateRevision, graph, entryParams}` | 创建即语义锁；名称 / 版本只是数据 |
| F2 | 所有改图命令返回 `FIXED_CONFIGURATION_LOCKED` + 统一原因文案 | 禁用原因 |
| F3 | 固定任务复用 P1–P8；恢复只允许 `retry(originalConfig)` | 原配置重试边界 |

## C04 原自动推进模式

| # | 字段 / 动作 | 用途 |
|---|---|---|
| A1 | `plan.edit.begin → guard{guardRef, priorAutoAdvance, priorExecutionState, recordedAt}` | 捕获原模式（服务事实） |
| A2 | `plan.edit.finish(guardRef, 'continue'|'abandon')` → 服务按 guard 恢复原模式；返回 `{autoAdvance, executionState}` | 继续 / 放弃；原暂停仍暂停 |
| A3 | `execution.resume()` 独立于 A2 | “恢复任务” |
| A4 | 保存冲突 `REVISION_CONFLICT{claimedNodes[]}`；重读比对 `draft.rebase()` | 领取竞态 |

## C05 业务问题

| # | 字段 / 动作 | 用途 |
|---|---|---|
| Q1 | `round.businessQuestions[]{id, text, impact{nodes[], io[], acceptance[]}, source{kind:'model-assumption'|'model-proposal', recordSeq}, options[]{value, label, impact}, suggestedValue}` | 业务问题组件；`suggestedValue` 只作建议标记 |
| Q2 | `inputRevision.create({answers[]{questionId, value}, answeredBy, answeredAt, basedOnRevision})` | 回答形成新输入修订；旧轮输入保留 |
| Q3 | `candidate.revalidate(candidateRef, inputRevision)` → `ok | stale{reasons[]}`（不调用模型） | 一致可应用 / 不一致需新一轮 |
| Q4 | `candidate.apply` 拒绝：`BUSINESS_QUESTION_UNANSWERED`、`CANDIDATE_STALE` | 未回答不能绕过 |
| Q5 | `acceptedRiskRefs` 只能引用不改变业务范围的 `NEEDS_REVIEW` 项；不得引用业务问题或硬阻塞 | 风险勾选边界 |

不需要新增的：节点详情 60 态、交付 70 态、工作区清理接口（沿用 TD）；规划记录、检查、候选读模型（沿用 v3 25 项）。
