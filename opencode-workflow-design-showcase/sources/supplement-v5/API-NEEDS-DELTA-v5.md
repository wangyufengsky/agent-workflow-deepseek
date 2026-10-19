# 补稿 v5 · API 候选契约增量

> 候选读模型 / 命令补充，**不是现有接口事实**，原型没有调用任何接口。与 v3（25 项）、v4（U / P / F / A / Q）叠加。

## Q10 · PE37 分组逐步细化

| # | 字段 / 动作 | 用途 |
|---|---|---|
| S1 | `proposal.groups[]{groupRef, title, coverage[], state:'refined'|'unrefined'|'planning'|'candidate', refinedInRound?, leafCount}` + `unresolvedScopes[]` | 总览分组与细化状态；确认可用性 |
| S2 | `refineScope.preview(taskRef, groupRef)` → `{round, scope, limits, budget, expiresAt}`；`refineScope.start(previewRef)` | 继续规划选区：每次是新的一轮（独立的派发与修订配额） |
| S3 | `round.scope = groupRef`；候选 `diff` 只允许在该组内新增叶子、替换占位；跨组边按总览连线保留 | 组候选；越界返回 `SCOPE_VIOLATION`（不允许旁路边） |
| S4 | `candidate.apply / reject`（复用 v3）；`apply` → `planRevision + 1` | 应用一组只写未确认草稿 |
| S5 | `plan.confirm` 前置：`unresolvedScopes.length === 0`，否则 `SCOPE_UNREFINED{groups[]}` | 已细化的组不先执行；全部细化后才能确认 |
| S6 | `limits{maxNodes:20, maxGroups:8, maxDepth:2}` + `projectedLeafCount` | 超出时要求明确分期；不自动丢弃剩余需求 |

停止本轮复用 v3 的停止 / 停稳 / 结账事实；轮次号由服务分配（Q5 工程冻结）。

## Q9 · 目录只读

| # | 字段 / 动作 | 用途 |
|---|---|---|
| C1 | `planningResponsibility{roleRef, revision, taskTypeRef@rev, templateRef@rev, promptRef@rev, contentDigest, executable:false}` | 角色管理“规划职责”；`executable:false` → 不出现在“谁来做” |
| C2 | `planningPolicyBinding[]{methodRef@rev, policyRef@ver, policyHash, refinable[], mandatory[], limits}` | 绑定的流程方法与规划策略 |
| C3 | `workflow.detail.aiPlanning{policyRef, policyHash, responsibilityRef, refinable[], mandatory[], limits}` + `recentPlanningTasks[]{taskRef, title, stateKey}` | 流程目录“AI 规划 · 只读”与最近使用 |

本期全部只读；编辑接口不在本批。

## Q6 · 计数口径

| # | 字段 | 用途 |
|---|---|---|
| N1 | `attention.planning{count, items[]{taskRef, kind:'answer'|'review'|'reconcile'|'scope'|'prepare'|'confirm'}}`，与任务列表 `group=attention` 同一谓词 | 待处理“规划事项”与任务列表“需要处理”数量一致；不新增通知接口 |
