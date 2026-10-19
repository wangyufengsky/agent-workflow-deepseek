# API-NEEDS-DELTA · 界面对候选契约的补充需求

> 候选 · 未冻结。本文件只列**界面要显示、但需求包 `API-DESIGN.md` 尚未提供或未写清**的字段与动作，供 shared 契约 owner 冻结同版契约时取舍。不新增执行引擎、不新增 HTTP 服务、不复制枚举；所有命令仍是原 CommandEnvelope / CommandReceipt，所有读仍走原 operation registry。原型中这些字段都是样例值。

## 1. 原则

- 按钮可用与否只看服务返回的 `actions[{id, enabled, reasonCode, reason}]`；界面不自己推断。本稿用到的动作 ID 见 §2。
- 阶段、最近活动、计数、用量、截止时刻都由服务给出并带服务时间；界面不计时推断阶段、不估算剩余时间。
- 客户端连接状态（live / disconnected / catching_up / gap）只是本页投影，不回写服务。

## 2. `PlanningRunV1.actions[].id` 建议清单

| id | 界面按钮 | 备注 |
|---|---|---|
| `generate` | 生成计划 / AI 细化计划（打开预览） | reason 例：方法未适配、预算未设置、资料无权限、已有活跃轮、UNKNOWN 未解、无编辑围栏 |
| `materialize` | 使用方法骨架 | 现有 plan.materialize |
| `stop` | 停止规划 | 断连时客户端自己禁用并写“连接恢复后可用” |
| `reconcile` | 核对原轮次 | 不发模型 |
| `observe` | 继续查看原轮次（不会发送新的提示） | PE24；只附着观察 |
| `new_round` | 预览新一轮 / 从保留草稿预览新一轮 | reason 例：停止完成前不能开始、原账不明先核对 |
| `input_save` | 保存补充 / 保存答复 | 运行中可用，返回“未纳入当前轮” |
| `apply` / `reject` | 应用到草稿 / 不采用 | apply 的 reason 需区分：硬问题、未停稳、过期、未核对人工判断、命令待核对 |
| `confirm` | 确认计划 | 原 plan.confirm.preview 的 actions 也需同样形态 |

## 3. 字段补充

| # | 位置 | 需要 | 用于 | 现状（API-DESIGN.md） |
|---|---|---|---|---|
| 1 | `PlanningRunV1` | `ordinal: number`（第 N 轮，同任务单调） | 页头“第 2 轮”、轮次选择器 | 只有 roundId |
| 2 | `PlanningRunV1` | `phaseHistory[{phase, enteredAt, leftAt?}]` | 阶段轨道只点亮实际到达的阶段、“修订候选”仅发生时出现 | 只有当前 phase |
| 3 | `PlanningRunV1` | `lastActivity{at, kind, summary}`（服务摘要，不是模型文字） | 状态条“最近活动”、任务列表“最近活动 14:07:58” | 只有 lastActivityAt |
| 4 | `PlanningRunV1` | `counters{evidenceRead, evidenceTruncated, draftNodes, dispatchesUsed, maxDispatches, repairsUsed}` | 状态条资料 / 草稿节点、用量弹层“派发 1/2 · 修订 0/1” | generation/maxRepairs 有；其余无 |
| 5 | `PlanningRunV1.usage` | `reserved` 与 `known` 已有；需加 `settledAt` 与 `releasedReserved` | 区分“已结账”“预留余额已释放” | 部分 |
| 6 | `PlanningRunV1` | `stopReceipt{requestKey, acceptedAt}`、`processStoppedAt`、`accountingClosedAt` | PE19/20 三件事分开写 | control/process/accounting 有，时间与回执号无 |
| 7 | `PlanningRunV1` | `failure{phase, publicCode, publicMessage}` | PE22 | 未写 |
| 8 | `PlanningRunV1` | `reconcile{startedAt, checks[{item: dispatch\|owner\|session\|lease\|usage, status}]}` | PE23 逐项核对进度 | 未写 |
| 9 | `PlanningRunV1` | `questions[{key, text, impactNodeKeys, sourceRef, options?}]`、`assumptions[{key, text, critical, sourceRef}]` | PE11 问题卡、草稿与问题页签 | InputDraft 里只有 decisions，run 上没有问题清单 |
| 10 | `DraftCheckpoint` | `sequence` 外再给 `publishedAt` 与 `missingGroups[]` | 部分草稿缺口卡 | coveredRequirementKeys / unresolvedScopes 有 |
| 11 | `PlanningValidation` | `layers[{id:'V1'..'V8', status: pass\|fail\|running\|not_started\|needs_review\|partial\|setup_required\|stale, issueCount, note}]` 与对应事件 `planning.validation.layer` | PE09 按实际进度显示、不预先打勾 | 只有最终 structural/semantic/evidence/executionReadiness |
| 12 | `PlanningCandidateV1` | `diffSummary{added, modified, unchanged, replaced[{baseNodeId, byCandidateKeys[]}], edgesAdded, edgesRemoved}` | 候选摘要“新增 5 · 修改 2 · 由细化替换 2” | 只有 diffHash |
| 13 | `PlanningCandidateV1` | `originalGenerationClosed: boolean` 与 `previewOnlyReason` | PE26“候选已收到，正在核对本轮结束” | 协议有概念，DTO 未暴露 |
| 14 | 应用 payload | `acceptedRiskRefs[{issueId, issueHash}]`（承认人由 host 绑定） | 需人工判断逐项核对后随应用记录 | 未写（见 DESIGN-DELTA Q2） |
| 15 | `planning.mapping.inspect` | 返回 `rows[{requirementKey, nodeIds[], criteriaKeys[]}]` 与 `unmappedSpans[]` | 需求覆盖表、节点详情“来源需求” | 已声明，形态未定 |
| 16 | 候选节点 | `dependencyReasons[{fromKey, kind: data\|prerequisite\|ordering\|resource, pointer?}]` 与 `resources[{access, selector, basis: observed\|declared, truncated}]` | 节点详情“为什么在这里”“读写资源” | ProposalV1 有，编译后的读模型需保留 |
| 17 | 候选过期 | `staleness{inputRef: [old,new], planRevision: [old,new], sources[{ref, oldHash, newHash}]}` | PE29 逐项差异 | 只有 CANDIDATE_STALE 码 |
| 18 | `planning.rounds.list` | 每项 `{roundId, ordinal, state, endedReason, createdAt, usageKnown}` | 轮次选择器文案“第 1 轮 · 已停止（补充需求后）” | 摘要字段未定 |
| 19 | `records.read` 工具项 | `sourceVersion{sha256}`、`locator{lines}`、`truncated{reason, readRange}` | 工具只读详情 | 部分 |
| 20 | 任务 / 需求 / 待处理列表投影 | `planning{state, phase, ordinal, lastActivity, needsAction: none\|answer\|review\|reconcile\|scope}` | PE14、需求目录、待处理分组 | 未写 |
| 21 | 编辑围栏 `PlanEditGuard` 读模型 | `status: requested\|active\|finishing`、`priorAutoAdvance`、`lockedNodes[{nodeId, reason: done\|running\|claimed, lockedInEdges[]}]` | PE33“正在暂停新增领取”、编辑区锁定列表、继续时恢复原设置 | begin/finish 命令有，读模型未写 |
| 22 | `pending.edit` 冲突回执 | `conflict{claimedNodeIds[], planRevision, guardRevision}` | PE34 横幅说出哪个步骤被领取 | REVISION_CONFLICT 只有码 |
| 23 | 固定模板实例 | `plan.locks{fixedTemplate:{templateRef, version, reason}}`，所有改图 action 的 reasonCode=FIXED_CONFIGURATION_LOCKED | PE36 统一文案 | 错误码有，读模型字段无 |
| 24 | 大需求总览 | `groups[{key, title, state: refined\|unrefined, requirementKeys, leafCount}]`、`limits{used, max}` | PE37 分组状态与“本期能力上限” | groups 有，state/limits 无 |
| 25 | 边界端口（P3） | 现有 `boundaryPorts` 足够；另需 `available: boolean + reason`（外部步骤已领取时） | PE38 端口不可用说明 | 部分 |

## 4. 事件

沿用原 Event 外层与持久 cursor。界面需要的候选事件（未进现 enum）：`planning.started / phase.changed / draft.published / validation.layer / validation.completed / candidate.ready / input.saved / stop.requested / settled / reconciled`，以及工具 lifecycle 的 planning subject 分支。补读返回 `{items, nextCursor, highWater, complete, gaps[{from, to, reason, recoverable}]}`，界面按 `streamSequence` 去重。

## 5. 不需要新增的

- 不需要“万能恢复”接口：PE24 只要 `observe` 动作；会发新 prompt 的一律是新 `create`。
- 不需要前端定时器或进度估算字段。
- 不需要第二套 reject 命名；`planning.candidate.reject` 已声明。
- 不需要为“历史轮次”单独开写接口；历史只读。
