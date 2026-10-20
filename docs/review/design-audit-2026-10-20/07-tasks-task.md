# P12 任务列表 + P13 任务执行画布 前端设计一致性审计

> 基线：main @ `3f6f9b2`（2026-10-20）。范围：`opencode-workflow-design-showcase/originals/main/pages/tasks.html`（`DS.mount` 5 状态）、`originals/main/pages/task.html`（22 状态）为主稿；补充稿 `originals/planning/task.html` + `sources/planning/STATES.md`（pe33/pe34/pe35/pe36/pe38）、`originals/delivery/task.html` + `sources/delivery/STATES.md`（TD02 11 + TD06 8，v4 统一画布映射见 `sources/supplement-v4/STATE-MAP.md` §2/§3）；实现 `apps/web/src/pages/tasks/{TasksPage,TaskRow}.tsx`、`apps/web/src/pages/task/{TaskCanvasPage,ExecutionPanel,PlanEditPanel,TaskExtrasPanel,advance}.tsx`、路由 `/tasks`、`/tasks/:taskId`（`apps/web/src/app/App.tsx:39-41`）。审计方式：静态代码 vs 只读设计稿；未运行 GUI，视觉/键盘/真实服务交互部分标注“需GUI/需真实服务”。旧审查文档只作线索，结论均已在当前 main 代码核实（见「未覆盖 / 说明」C10 条）。

## 概览

| 页面 | 设计状态数 | 已逐项核对 | P0 | P1 | P2 | P3 | 结论 |
|---|---|---|---|---|---|---|---|
| P12 任务列表（`tasks.html` 5 + planning `pe14`） | 6 | 是 | 0 | 2 | 2 | 4 | 与设计有偏差：行内步骤状态条/具体原因无数据、执行与交付状态被 attention 泛化；筛选/空态/加载/分组结构基本一致 |
| P13 任务执行画布（`task.html` 22） | 22 | 是 | 1 | 4 | 6 | 4 | 与设计有偏差：执行结束未交付显示绿色“已完成”；情况条三事实与右侧面板默认隐藏缺失；停滞/审批/验收/恢复/工作区详情等状态不可达 |
| P13 planning 补充（`pe33/34/35/36/38`） | 5 | 是 | 0 | 2 | 3 | 0 | 部分实现：暂停/编辑/竞态/重新确认/恢复原设置、固定模板锁均在；增删节点、申请调整确认与暂停回执过渡、重新确认检查缺失；pe38 为明确不开放 |
| P13 delivery 补充（TD02 11 + TD06 8；v4 UT-* 20 映射同画面） | 19 | 是 | 0 | 0 | 1 | 0 | 部分实现：交付入口/交付投影在列表与右面板存在；画布侧“交付”事实/端点、工作区详情与清理、验证未通过区分缺失（TD02/TD06 面板内部属 15-delivery 区域） |

**最重要的问题（≤5 条）**
1. `P13-01`（P0）执行已结束但未交付时，情况条渲染绿底 ✓“已完成”，违反设计“绝不显示绿色任务已完成”，会让用户误判任务结束并漏掉交付。
2. `P13-02`（P1）情况条缺少设计要求的三段事实（现在到哪 / 要你做什么+操作 / 下一步），被状态胶囊+百分比+计数替代，且没有“交付/计划”事实与任何下一步指引。
3. `P12-01`（P1）任务列表行第三列不是设计的“步骤状态条”，而是五段阶段胶囊+聚合百分比条；“需要处理”列也不再是设计的具体步骤+原因（`TaskSummary` 无节点级状态与 reason，C1）。
4. `P13-05`（P1）已暂停任务不能进入“调整待执行计划”（服务 action 投影只允许 running），而设计 `ut-paused` 明确“仍可调整”，领域层 `editBegin` 本身也接受 paused。
5. `P13-06`（P1）调整待执行计划不能新增/插入/移出节点：设计 pe34/pe35/ut-adj-editing 的悬停“+”、从计划移除、撤销新增全部缺失，契约 `EditSaveRequest` 也只支持 title/qualityReview/prerequisites/acceptance。

以上 29 条问题中，静态可判定 25 条、标注“需GUI”4 条（`P12-05`、`P13-03`、`P13-16`、`P13-18`）。

## 状态覆盖

### P12 任务列表（`opencode-workflow-design-showcase/originals/main/pages/tasks.html`；状态注册表 `:115-116`；planning `pe14` = `sources/planning/STATES.md:45`）

| mock state | 设计名称 | 实现判定 | 证据（实现文件:行 / 无） | 说明 |
|---|---|---|---|---|
| `ready` | 日常 | 已实现（行信息有偏差） | `apps/web/src/pages/tasks/TasksPage.tsx:205-311`；`TaskRow.tsx:68-173`；设计 `tasks.html:89-113` | 页头/搜索/分段筛选+计数/项目下拉/分组开关/表头/更多菜单/行点击都在；行第三列与“需要处理”原因见 P12-01，状态映射见 P12-02 |
| `grouped` | 按项目分组 | 已实现 | `TasksPage.tsx:111-122,186-200`；设计 `tasks.html:98,114` | 分组头=文件夹图标+项目名+数量，与设计一致 |
| `loading` | 加载中 | 已实现 | `TasksPage.tsx:35-51,144-145`；设计 `tasks.html:94` | 5 行骨架；设计为 5 行骨架，同构 |
| `error` | 读取失败 | 已实现（文案降级） | `TasksPage.tsx:146-159`；`components/ServiceNotice.tsx:20-23`；设计 `tasks.html:95` | 有“重试”且不展示示例数据；缺设计原文“任务列表读取失败 / 本地服务没有响应。筛选条件已保留。”，见 P12-06 |
| `empty` | 没有任务 | 已实现 | `TasksPage.tsx:160-172`；设计 `tasks.html:96` | 标题/描述/“开始任务”按钮文案一致；另有“没有符合条件的任务”分支 `:173-185`，对应设计 `:97` |
| `pe14` | 任务列表 · 规划状态 | 部分 | `apps/web/src/app/taskStatus.ts:92-100,127-137,168-173`；`TasksPage.tsx:96-101`；设计 `sources/planning/STATES.md:45`、`tasks.html:48-53` | 规划中（状态+阶段+最近活动）、正在停止、待核对可由真实字段拼出；点行对 draft/planning/confirming 进 `/requirement/:id`。但 attention 覆盖导致“等待审阅/需要处理”区分丢失、行无 returnTo（P12-02/03/04） |

### P13 任务执行画布 主稿（`originals/main/pages/task.html` 22 状态，注册表 `:386-395`）

| mock state | 设计名称 | 实现判定 | 证据（实现文件:行 / 无） | 说明 |
|---|---|---|---|---|
| `running` | 执行中（两步并行） | 部分 | `TaskCanvasPage.tsx:469-513`（状态胶囊+百分比+计数）；`ExecutionPanel.tsx:225-282`（节点列表）；图/图例 `TaskCanvasPage.tsx:172-190` | 节点/边来自真实 `ExecutionView`（`flow/graph.ts:170-231`），但无三段情况条与“下一步”（P13-02），页头无执行状态徽标（P13-04） |
| `auto-off` | 自动推进关闭 · 可推进 | 部分 | `ExecutionPanel.tsx:153-205,225-282`；`advance.ts:3-92`；API `apps/web/src/api/workflow.ts:320-334`、`packages/server/src/http.ts:675-677` | 开关是真实服务设置；关闭后出现“整体推进/推进直接后继”且有禁用原因；但开关与推进按钮在常驻右面板而非设计页头（`task.html:168-169`，P13-02/03） |
| `waiting` | 等待审批 | 缺失 | 任务页无 runtime interaction 数据接入（`apps/web/src/pages/task/**` 无 interactions/审批引用）；仅全局 attention 徽标 `TaskCanvasPage.tsx:347-351`；设计 `task.html:178`、`td-states-v4.js:12` | 设计“步骤请求写入 + 审批按钮 + 其他步骤继续”在画布不可见，只能去待处理中心（P13-04） |
| `stalled` | 步骤停滞 | 缺失 | 契约 `packages/shared/src/domain/enums.ts:137-146`（NodeStatus 无 stall）；`execution.ts` 无停滞判定；设计 `task.html:177,182,213`、`td-states-v4.js:13` | 服务未提供停滞事实（C1）。设计要求“停滞由执行服务判定，不是界面计时”，实现未自造也无可展示入口（P13-04） |
| `failed` | 步骤失败 | 部分 | 情况条状态胶囊 `TaskCanvasPage.tsx:469-473`；退回/重试横幅 `:568-592`；节点行错误码 `ExecutionPanel.tsx:257-259`；设计 `task.html:179,215,254` | 有失败状态/重试入口；缺设计“失败原因（3 用例断言）+ 尝试 3/3 + 查看原因并恢复”的合并呈现与恢复方式面板（P13-10） |
| `recovering` | 恢复 | 缺失（画布内） | 设计 `task.html:184,263-279`；实现只有 `/recovery` 独立页入口 `TaskCanvasPage.tsx:411-414`、重试横幅 `:568-592` | 画布右侧“选择恢复方式（原样重试/修改后重试/从上一步重跑）→ 准备 → 开始”面板不存在；独立恢复页模式语义也不同（见 13-recovery 区域），P13-10 |
| `review` | 待人工验收 | 部分 | 验收横幅与“去验收”`TaskCanvasPage.tsx:521-567`；设计 `task.html:180,216,255`、`td-states-v4.js:16` | 验收投影真实（`ExecutionView.acceptance`），但页头/列表无“待人工验收”状态词（P13-04） |
| `completed` | 已完成 | 部分（含 P0 误导） | 情况条 `TaskCanvasPage.tsx:469-473`；`execution.ts:1348` 执行置 completed 并写“等待交付”；设计 `task.html:181,255`、`sources/delivery/STATES.md:32` | 节点全完成、交付按钮出现；但未交付时情况条显示绿色“已完成”，与设计“绝不显示绿色任务已完成”冲突（P13-01） |
| `claim-race` | 修改时被领取 | 部分 | `TaskCanvasPage.tsx:105-109`（自动进入调整面板）、`504-509`；`PlanEditPanel.tsx:197-224,305-331`；引擎 `packages/engine/src/plan.ts:297-307` | 冲突横幅/草稿保留/重新读取并比对都在；但画布节点无“已被领取/锁定”标记（只在调整面板列表），情况条只有“调整 领取竞态”计数（P13-13） |
| `unknown` | 状态待核对 | 部分 | 情况条状态胶囊 `TaskCanvasPage.tsx:469-473`；未知横幅 `:593-612`；设计 `task.html:183,217` | 只给“到恢复页处理”，缺“立即重新读取”按钮与自动重读说明（P13-15） |
| `template` | 模板任务（固定流程） | 部分 | 锁定 `TaskCanvasPage.tsx:172-180,342-346,626-631`；调整禁用原因 `:376-381`、`actions.ts:232`；设计 `task.html:164,175`、`pe36` | 固定模板锁/统一原因/无“+”/调整禁用都在；缺 pe36 侧面板“不能做的事/可以做的事”清单（P13-19） |
| `snap-full` | 快照评审 · 执行进度（全量审查） | 部分 | 入口 `TaskCanvasPage.tsx:423-426`；面板 `TaskExtrasPanel.tsx:470-577`；设计 `task.html:166,281-332`、`index.html:171` B-07 | 入口在“更多”而非页头分段；执行进度/阶段/审查范围/功能批次/输出目录都在；缺“评审报告/最终报告”块（P13-14） |
| `snap-light` | 快照评审 · 执行进度（轻量审查） | 部分 | `TaskExtrasPanel.tsx:385-415`（mode/depth/limitations） | 轻量/全量标识来自真实 `scope.mode/depth`；视觉与入口同上 |
| `snap-batches` | 功能批次展开 | 部分 | `TaskExtrasPanel.tsx:417-468,543-562` | 可展开/加载更多/计数；设计 `task.html:330` 的展开样式需 GUI 核对（P13-14） |
| `snap-batches-loading` | 功能批次读取中 | 部分 | `TaskExtrasPanel.tsx:505`（整面板 SkeletonText） | 设计为批次块内 3 行骨架、上方进度数字不受影响（`task.html:310-311`）；实现无局部 loading（P13-14） |
| `snap-batches-empty` | 功能批次为空 | 部分 | `TaskExtrasPanel.tsx:442-443` | 空文案“尚未创建功能批次…”与设计 `task.html:312` 同义 |
| `snap-batches-error` | 功能批次读取失败 | 缺失（局部） | `TaskExtrasPanel.tsx:504-506`（整体 `ServiceNotice`） | 无“批次读取失败但进度数字不受影响”的局部失败态；单次读模型内联批次（`contracts.ts:763-773`）无法保留进度（P13-14） |
| `snap-report` | 阶段报告未读取 | 已实现 | `TaskExtrasPanel.tsx:610,616`；设计 `task.html:336,354-356` | 未读空态、读取后才能下载、禁用原因一致 |
| `snap-report-loading` | 阶段报告读取中 | 已实现 | `TaskExtrasPanel.tsx:594-595,614` | “读取中… + 骨架”，下载禁用 |
| `snap-report-read` | 阶段报告已读取 | 已实现 | `TaskExtrasPanel.tsx:598-606,616-620` | 已分析/未完成/排除条 + Markdown 正文 + 下载；读取不启动执行 |
| `snap-report-error` | 阶段报告读取失败 | 已实现 | `TaskExtrasPanel.tsx:591-592,615` | 清空旧内容 + 错误横幅 + 可重读，不再展示旧正文 |
| `snap-cancelled` | 已取消仍可读阶段报告 | 缺失 | 设计 `task.html:298,349-350`；实现无 cancelled 横幅/“不会生成最终报告”提示；引擎仅对 completed 拒绝（`packages/engine/src/task-extras.ts:523,561-563`） | 取消后接口仍可读，但界面没有任何取消专属说明（P13-14） |

### P13 planning 补充（`originals/planning/task.html` + `sources/planning/STATES.md`）

| mock state | 设计名称 | 实现判定 | 证据（实现文件:行 / 无） | 说明 |
|---|---|---|---|---|
| `pe33` | 执行中申请调整（暂停新增领取） | 部分 | `PlanEditPanel.tsx:167-193`；`TaskCanvasPage.tsx:376-381`；设计 `sources/planning/STATES.md:99`、`originals/planning/assets/task.js:76-101,185` | 有“开始调整前先暂停新增领取、运行中按原快照继续”的说明与按钮；缺设计确认对话（原模式记录）与“正在暂停新增领取… 回执成功后才开放编辑”的过渡态（P13-07） |
| `pe34` | 编辑待执行区 · 领取竞态 | 部分 | `PlanEditPanel.tsx:261-408`（可修改/锁定列表、名称/验收/前置表单、保存）、`:197-224`（竞态横幅+重新读取并比对）；设计 `STATES.md:100`、`assets/task.js:44-62,122-150` | 锁定节点列表、表单式依赖、保存后重新确认、竞态草稿保留均在；缺悬停“+新增”、从计划移除、撤销新增，画布也无锁定/可修改图层（P13-06/13） |
| `pe35` | 语义保存后重新确认 → 继续 | 部分 | `PlanEditPanel.tsx:410-443`（重新确认/继续/保持暂停）、引擎 `packages/engine/src/plan.ts:382-390`（恢复原自动推进/暂停）；设计 `STATES.md:101`、`assets/task.js:151-157` | 两动作分开且恢复原设置正确；缺“改动摘要 + 当前整图重新检查结果”，且“调整前已暂停”时按钮仍写“继续执行”（P13-08/09） |
| `pe36` | 固定模板任务 · 只读 | 部分 | `TaskCanvasPage.tsx:43,172-180,342-346,376-381,626-631`；`actions.ts:232`；设计 `STATES.md:107`、`assets/task.js:158-168` | 节点锁、统一原因、无“+”、调整禁用全部有；缺侧面板“不能做的事/可以做的事”清单（P13-19） |
| `pe38` | 有界局部细化候选（设计候选 · 后续分期） | 不适用（设计明确不开放） | 设计 `sources/planning/STATES.md:114` 标注“后续分期”；`docs/review/design-parity-acceptance-2026-10-20.md` §明确不开放 | 实现未提供入口，符合边界（C9，不是缺陷） |

### P13 delivery 补充 TD02/TD06（`originals/delivery/task.html` + `sources/delivery/STATES.md`）

| mock state | 设计名称 | 实现判定 | 证据（实现文件:行 / 无） | 说明 |
|---|---|---|---|---|
| `td02-running` | 执行中 · 状态栏显示独立工作区 | 部分 | `TaskCanvasPage.tsx:353-365`（副行“工作区 已准备”）、`ExecutionPanel.tsx:316-331`；设计 `sources/delivery/STATES.md:30`、`assets/task.js:255` | 有工作区状态文字，无设计的工作区 chip；情况条未拆“执行与验收/交付”两个事实（P13-02） |
| `td02-parallel` | 同任务并行写 · 子隔离与汇合策略 | 部分（边界内） | `packages/shared/src/domain/models.ts:850-871`（children/parallelWritePolicy/activeWrites 字段存在但画布未用）；`ExecutionPanel.tsx:327-328` 仅文字策略；设计 `STATES.md:31` | 设计 PE28 明确“子隔离与汇合”后续分期（C9），但“画布浮层与步骤面板只展示策略”可做，当前仅面板一行文字 |
| `td02-awaiting` | 执行已结束 · 等待交付 | 部分（含 P0 误导） | 列表投影 `taskStatus.ts:102-108`；交付按钮 `TaskCanvasPage.tsx:393-397`；情况条 `:469-513`；设计 `STATES.md:32` | 交付入口存在；情况条显示绿色“已完成”、缺“执行已结束 · 等待交付”事实（P13-01/02） |
| `td02-blocked` | 交付受阻 · 仍有活动写入 | 部分 | `computeTaskAttention` 置 attention blocked（`actions.ts:349`）→ 页头徽标“受阻”`TaskCanvasPage.tsx:347-351`；交付面板内部属 15-delivery | 画布层只有“受阻”徽标，无交付事实与原因行（P13-02） |
| `td02-no-changes` | 没有文件变更 | 部分 | 交付面板内部（15-delivery）；列表投影 `labels.ts:132-139` 无 no-changes 值 | 画布/列表层无“无文件变更”区分（C1，交给交付投影） |
| `td02-failed-candidate` | 验证未通过 · 失败候选交付资格 | 部分 | `models.ts:975-977` 有 `verificationOutcome`；`labels.ts:132-139` 投影无失败候选值 | 画布只能显示“执行已结束/失败”，交付资格判定在交付面板（15-delivery） |
| `td02-step-committed` | 已提交 · 等待推送确认 | 部分 | `labels.ts:134`（in_progress=交付进行中） | 画布层有“交付进行中”投影；步骤 1/3 在交付面板（15-delivery） |
| `td02-delivered` | 任务已交付 · MR 未合并 | 部分 | 列表 lifecycle completed→“已完成”`taskStatus.ts:82-84`；情况条显示“已完成” | 任务层正确；MR 独立事实在交付/Git 区域 |
| `td02-delivered-verify-failed` | 已交付 · 验证未通过 | 缺失（契约） | `models.ts:975-977` 有 `verificationOutcome='failed'`，但 `DeliveryProjection` 6 值无“已交付未通过”（`labels.ts:132-139`） | 列表与画布状态无法区分“全部通过/知情交付”，只能进交付面板看（P13-17，交付面板内部见 15-delivery） |
| `td02-background` | 另一个任务后台待交付 | 缺失 | 设计 `STATES.md:39`；实现无画布 `role=status` 提示（任务页 grep 无“后台/稍后”）；全局 `Shell.tsx:48,109-113` 有待处理计数 | 不抢焦点提示未实现（P13-16） |
| `td02-cancelled-retained` | 已取消 · 文件保留可稍后交付 | 部分 | 列表 cancelled→“已取消”`taskStatus.ts:85-87`；交付按钮 `:393-397`；设计 `STATES.md:40` | 可重新打开交付；情况条无“未交付 · 文件保留，可稍后交付”事实 |
| `td06-detail-git` | 工作区详情 · Git 任务分支与 worktree（520 抽屉） | 缺失 | 设计 `sources/delivery/STATES.md:97`、`assets/task.js:848-925`；实现无抽屉，仅 `ExecutionPanel.tsx:316-331` 4 行事实、`TaskDeliveryPanel.tsx:539-545` | 契约 `TaskWorkspace` 已带 children/activeWrites/retention/pendingOperationRef 等（`models.ts:850-871`），纯前端缺口（P13-12） |
| `td06-detail-nongit` | 工作区详情 · 非 Git 基线快照与副本 | 缺失 | 同上；`ExecutionPanel.tsx:316-331` 有 kind 徽标与策略 | 非 Git 基线/范围/排除/未复制项无法查看（P13-12） |
| `td06-close-retain` | 关闭 / 取消任务 · 文件保留提示 | 部分 | 取消确认弹窗 `TaskCanvasPage.tsx:740-761` | 有“工作区与记录保留、不会自动清理”说明；缺设计固定句“文件保留，可稍后交付 / 查看”与工作区详情入口（P13-12/19） |
| `td06-cleanup-preview` | 清理预览 | 缺失（任务画布） | 设计 `STATES.md:100`；实现清理 UI 只在需求画布 `pages/requirement/WorkspacePanel.tsx:317-357`；API 已存在 `api/workflow.ts:341-363`、`http.ts:659-660` | 任务画布无入口（P13-12） |
| `td06-cleanup-undelivered` | 有未交付内容 · 额外知情确认 | 缺失（任务画布） | 设计 `STATES.md:101`；`WorkspacePanel.tsx` 有清理预览但对“未交付额外确认/唯一产物”未在任务画布承接 | P13-12；内容细节见 15-delivery |
| `td06-cleanup-blocked` | 清理受阻 | 缺失（任务画布） | 设计 `STATES.md:102`；`WorkspaceCleanupPreview.blockers` 字段 `models.ts:985-995` 已存在 | 无工作区详情即无受阻原因入口（P13-12） |
| `td06-cleanup-partial` | 部分清理 / 失联 · 核对原清理 | 缺失（任务画布） | 设计 `STATES.md:103`；`WorkspaceState` 有 cleaning/partial（`labels.ts:114-123`） | 画布无清理状态与“核对原清理”入口（P13-12） |
| `td06-cleaned` | 工作区已清理 · 交付回执仍可读 | 缺失（任务画布） | 设计 `STATES.md:104`；交付面板内部有 `retention` 标签（`TaskDeliveryPanel.tsx:545`） | 画布层无“已清理/路径已删除/回执仍可读”呈现（P13-12） |

### P13 v4 统一任务画布 UT-* 映射（`sources/supplement-v4/STATE-MAP.md:33-46`；状态说明 `originals/delivery/assets/td-states-v4.js:7-26`）

| 新状态 | 设计名称 | 实现判定 | 证据 / 说明 |
|---|---|---|---|
| `ut-running` | 执行中 · 规划创建（第一批） | 部分 | 同一画布/同一交付入口成立（`App.tsx:39-41`、`TaskCanvasPage.tsx:634-657`）；页头缺工作区 chip/来源 chip/自动推进开关（P13-02/03/04，`td-states-v4.js:7`） |
| `ut-running-mid` | 执行中 · 第 3 段（可调整） | 部分 | 调整入口存在（`TaskCanvasPage.tsx:376-381`）；情况条无第几段事实（P13-02） |
| `ut-auto-off` | 自动推进关闭 · 执行中 | 部分 | 开关为真实服务设置（`ExecutionPanel.tsx:153-205`）；页头无开关与推进按钮（P13-03） |
| `ut-advance` | 可整体推进 / 推进选中后继 | 已实现（位置不同） | `advance.ts:33-92`、`ExecutionPanel.tsx:185-204,225-282`、`workflow.ts:320-334`；设计页头入口在 `task.js:247`，实现放右面板（P13-03） |
| `ut-paused` | 任务已暂停 | 部分 | 情况条胶囊显示“已暂停”；但“调整待执行计划”被 action 投影禁用，违反“仍可调整”（P13-05） |
| `ut-waiting` | 等待你审批 | 缺失 | 审批数据只在待处理中心；画布无步骤/原因/审批按钮（P13-04） |
| `ut-stalled` | 步骤停滞 | 缺失 | 服务无停滞事实/画布无入口（P13-04，C1） |
| `ut-failed` | 步骤失败 · 可恢复 | 部分 | 失败状态/重试/恢复页入口有；画布内恢复方式面板缺失（P13-10） |
| `ut-recovering` | 恢复这一步 · 选择方式 | 缺失 | 仅独立 `/recovery` 页，模式语义不同（P13-10，同 13-recovery 区域） |
| `ut-review` | 待人工验收 | 部分 | 验收横幅+按钮有（`TaskCanvasPage.tsx:521-567`）；无状态词/页头徽标（P13-04） |
| `ut-unknown` | 状态待核对 | 部分 | 未知横幅有；缺“立即重新读取”（P13-15） |
| `ut-legacy-done` | 旧版记录 · 已完成 | 缺失（边界） | `Task`/`TaskSummary` 无 origin/legacy 字段（`models.ts:344-384,386-406`）；设计要求只读“旧版记录”标记（P13-21，C1/C9） |
| `ut-legacy-stopped` | 旧版记录 · 已终止 | 缺失（边界） | 同上；product 未发布无历史数据，按 C9 设计缺口记录 |
| `ut-adj-pausing` | 申请调整 · 正在暂停新增领取 | 部分 | 无过渡态与确认对话（P13-07） |
| `ut-adj-editing` | 编辑待执行区（锁/可修改/新增） | 部分 | 锁列表/表单有；画布无锁/可修改图层、无“+”新增（P13-06/13） |
| `ut-adj-conflict` | 保存冲突 · 领取竞态（草稿保留） | 部分 | 竞态横幅、草稿保留、重新读取并比对、保存禁用原因都有（`PlanEditPanel.tsx:197-224`）；画布节点无 claimed 标记（P13-13） |
| `ut-adj-reconfirm` | 保存后等待重新确认 | 部分 | 有重新确认按钮与“不调用模型、不立即领取”提示；缺改动摘要与整图重新检查（P13-08） |
| `ut-adj-ready` | 已重新确认 · 继续恢复原模式 | 部分 | 恢复原自动推进/暂停状态由服务实现（`plan.ts:382-390`）；“调整前已暂停”时按钮文案仍写“继续执行”（P13-09） |
| `ut-fixed-running` | 固定模板 · 执行中（锁定不变） | 部分 | 锁/统一原因/调整禁用/来源徽标替换为模板徽标；缺 pe36 说明清单与来源 chip（P13-19） |
| `ut-fixed-snapshot` | 固定模板 · 快照评审运行面板 | 部分 | 面板在（`TaskExtrasPanel.tsx:470-577`），入口在“更多”；缺页头分段与最终报告（P13-14） |

## 问题清单

### P12-01: 列表行缺“步骤状态条 + 具体需要处理原因”，第三列被阶段胶囊+聚合百分比替代
- **严重度**：P1
- **维度**：S / T / 结构 / D
- **类别**：状态 / 文案 / 数据契约
- **设计依据**：`opencode-workflow-design-showcase/originals/main/pages/tasks.html:15-30`（`.trow` 五列、`.need` 两行截断、`.bars` 每步一格 + `.bars i.unk` 虚线未核对）；`:79-86`（行模板：任务+类型徽标·项目 / 需要处理原因 / 步骤条+`bars-cap` / 状态徽标+时间 / 更多）；行数据 `:45-73`（每行 `steps` 与 `cap` 是真实步骤状态与“第 2/5 步 · 2 步并行执行中”等文案）。
- **实现位置**：`apps/web/src/pages/tasks/TaskRow.tsx:24-32`（聚合 percent/文案）、`:101-103`（通用 need）、`:105-111`（阶段胶囊+百分比条）；`apps/web/src/pages/tasks/tasks.css:10-41`；`apps/web/src/styles/app.css:773-779`（第三列 330px）；DTO `packages/shared/src/domain/models.ts:386-406`（`progress` 只有 done/total/running/failed，无节点状态/reason）；服务组装 `packages/engine/src/project-task.ts:560-590`。
- **差异**：设计要求第三列是“每一步一格”的状态条（完成/执行中/停滞/失败/等待/未核对虚线）与 `第 N/M 步` 行说明；实现渲染的是全局五段阶段胶囊 + 单根百分比条 + “第 2/5 步 · 1 执行中 · 聚合进度”，无法显示“哪一步停滞/失败/未核对”。“需要处理”列设计要求具体原因（如“实施修复”停滞：等待读取数据库连接配置的权限、“回归测试”失败：3 个用例断言不通过），实现是 `taskNeedText()` 通用句（`taskStatus.ts:127-156`），执行中任务还在该列重复显示聚合进度。
- **原因**：直接原因：列表行以聚合进度替代分步条、以通用句替代原因（C4/C6）。根本原因：`TaskSummary` 没有节点级状态数组、停滞/失败步骤名与原因字段（C1），服务 `#summary` 只汇总计数；前端无法还原设计信息，只能降级。
- **影响**：任务列表是本产品最主要的任务入口；用户无法从列表判断“卡在哪一步、为什么需要我”，必须逐个进画布；聚合百分比也会把“失败/未核对”掩盖为普通未完成。
- **建议**：在 `TaskSummary` 增加 `stepStates[]`（节点标题/状态/是否待验收）与 `need`（步骤名+原因，来自服务）；前端恢复 `.bars` 分段条与 `第 N/M 步` 文案；`TaskRow` 不再用百分比条替代分步语义。
- **验证**：静态 + 需真实服务（确认新增字段的投影）
- **关联状态**：`ready`、`grouped`、`pe14`

### P12-02: 执行/交付/规划状态被 attention 泛化，列表无法显示“已暂停/待人工验收/等待审阅/执行已结束·等待交付”
- **严重度**：P1
- **维度**：S / T / D
- **类别**：状态 / 数据契约
- **设计依据**：`tasks.html:74`（ST 表：执行中/停滞/失败/待确认计划/已完成/待核对/待准备工作区/规划中/需要处理/等待审阅/正在停止/规划总览）；`:63-72`（已暂停、待交付等行）；`sources/planning/STATES.md:45`（pe14：规划中（阶段+最近活动）、等待审阅、需要处理、正在停止、待核对）；`originals/delivery/assets/task.js:61-90`（PH 表：执行中/执行已结束·等待交付/待人工验收/已暂停/有步骤停滞/有步骤失败/状态待核对）。
- **实现位置**：`apps/web/src/app/taskStatus.ts:54-60`（attention 视图）、`:81-124`（先 attention 再 planning/delivery/stage）、`:92-100`、`:102-108`；`packages/engine/src/actions.ts:328-352`（attention 只覆盖规划问题/审阅、运行互动、failed/unknown、race、workspace、交付未知/受阻/待选）；`models.ts:386-406`（无 executionStatus/pendingAcceptance 字段）。
- **差异**：只要 `attention != none`，`deriveTaskStatus` 就返回 attention 标签并短路后面的 planning/delivery 分支——因此：已暂停任务显示“执行中”（stage=executing，attention=none）；待人工验收显示“执行中”（`computeTaskAttention` 不统计待验收）；规划“候选待审阅”显示“需要你处理”而不是“等待审阅”（attention waiting_user 覆盖 stage）；交付等待选择显示“需要你处理”而不是“执行已结束 · 等待交付”（`actions.ts:349-350` 覆盖 deliveryProjection）。`TaskSummary` 也没有执行状态，列表无法呈现“已暂停/停滞”。
- **原因**：直接原因：列表状态推导把 attention 置于执行/交付事实之前（C6）。根本原因：`TaskSummary` 只带 stage/attention/planning/deliveryProjection，没有 execution.status 与待人工验收计数（C1），推导层只能用 attention 近似。
- **影响**：列表徽标与状态筛选的用户预期不符；“执行中/需要你处理”重复出现，待交付与待验收任务混入普通待处理，用户无法一眼区分任务真实阶段。
- **建议**：在 `TaskSummary` 增加 `execution?: {status, pendingAcceptance}`；`deriveTaskStatus` 按“lifecycle→执行/交付事实→attention→stage”排序，并为 `paused/pending_acceptance` 提供设计词；规划 stage（含 awaiting_review）优先于 attention。
- **验证**：静态
- **关联状态**：`ready`、`pe14`、`running`、`review`、`td02-awaiting`

### P12-03: “待准备工作区”行点击进任务画布，设计进需求画布工作区页签
- **严重度**：P2
- **维度**：R / A
- **类别**：交互 / 导航
- **设计依据**：`tasks.html:54-59`（`pr-206x` 行 `showcaseRoute: 'planning/requirement.html?state=pe32&task=…&tab=ws'`，即待准备工作区回需求画布「工作区」页签）；`sources/supplement-v4/STATE-MAP.md:14-16`（T-2063…2067 全进需求画布准备）。
- **实现位置**：`apps/web/src/app/taskStatus.ts:168-173`（只有 draft/planning/confirming 进 `/requirement/:id`，preparing 进 `/tasks/:id`）；任务画布对未准备任务只能提示“回到需求画布「工作区」准备工作区”（`ExecutionPanel.tsx:317-318`）。
- **差异**：同一行点击落点与设计不一致：设计直接回需求画布工作区，实现落到任务画布再点“需求画布”按钮回退，且回退后不保证停在「工作区」页签。
- **原因**：直接原因：`taskHref` 的阶段映射漏了 `preparing`（C5）。根本原因：需求画布的页签定位参数未纳入任务列表跳转契约（C5）。
- **影响**：准备阶段的用户多一次跳转与寻找，容易在任务画布误以为“无法开始执行”。
- **建议**：`taskHref` 对 preparing 返回 `/requirement/:id?tab=ws`（或需求画布支持 `?workspace=1` 定位）。
- **验证**：静态（落点需GUI确认）
- **关联状态**：`pe14`、`prep`（`td02-running` 前置）

### P12-04: 从画布返回任务列表会丢失状态分段/搜索/分组，设计行带 `returnTo`
- **严重度**：P2
- **维度**：R / A
- **类别**：交互 / 导航
- **设计依据**：`tasks.html:45-72`（每行 `showcaseRoute` 均带 `returnTo=main/pages/tasks.html`）；`sources/planning/STATES.md:45`（pe14：“点行带 returnTo”）；`sources/supplement-v4/STATE-MAP.md:69-76`（往返恢复选中/页签/画布视角）。
- **实现位置**：`apps/web/src/pages/tasks/TasksPage.tsx:88-94`（只有 `projectId` 写入 URL，`filter/keyword/grouped` 是组件 state）、`:231-257`；返回用 Shell 面包屑 `apps/web/src/app/navigation.ts:84-86`（固定 `/tasks`，无来源参数）。
- **差异**：任务列表的“需要处理”分段、搜索词、按项目分组在离开后丢失；从画布返回回到默认“全部”。设计要求带来源上下文返回。
- **原因**：直接原因：筛选状态未持久化到 URL/回跳参数（C5）。根本原因：任务列表没有与设计一致的 returnTo/查询参数契约（C5）。
- **影响**：从需要处理列表逐个处理任务时，每次返回都要重新筛选，明显降低巡检效率。
- **建议**：把 filter/keyword/grouped 同步进 URL；跳转画布时带 `returnTo`（或依赖 history state），返回还原。
- **验证**：需GUI（返回行为）
- **关联状态**：`ready`、`grouped`、`pe14`

### P12-05: 页面标题层级与第三列视觉（标题重复、列宽 330px vs 150px、百分比条）与设计不一致
- **严重度**：P3
- **维度**：结构 / T / V
- **类别**：结构 / 样式主题
- **设计依据**：`tasks.html:19`（表头“任务 / 需要处理 / 步骤 / 状态 / 空”）；`:15`（第三列 150px）；`:24-27`（`.bars` 5px 分段 + 11.5px caption）；`:101`（页面 h2 标题“任务”，顶栏 h1“任务列表”）。
- **实现位置**：`TasksPage.tsx:209-211`（页面标题“任务列表”）、`:264-270`（表头“任务 / 需要处理 / 阶段 / 聚合进度 / 状态 / 空”）；`app.css:773-775`（第三列 330px）；`TaskRow.tsx:105-111`；顶栏面包屑 `navigation.ts:80-86`。
- **差异**：顶栏与页面标题都是“任务列表”（设计为顶栏“任务列表”+页面“任务”）；表头第三列文案/列宽与设计的“步骤 150px”不同；聚合百分比取代分段条（语义差异见 P12-01，此处只记视觉/结构）。
- **原因**：直接原因：`PageHeader` 复用了顶栏标题，第三列按阶段胶囊设计（C3/C4/C7）。
- **影响**：视觉层级重复；宽屏行信息密度与设计不一致，窄屏折行表现不同。
- **建议**：页面标题改“任务”；表头/列宽按设计第三列“步骤”；视觉验证后再定聚合信息位置。
- **验证**：需GUI（列宽/断点观感）
- **关联状态**：`ready`、`grouped`

### P12-06: 读取失败态文案与设计原文不一致
- **严重度**：P3
- **维度**：T
- **类别**：文案
- **设计依据**：`tasks.html:95`（“任务列表读取失败 / 本地服务没有响应。筛选条件已保留。[重试]”）。
- **实现位置**：`TasksPage.tsx:146-159`；`components/ServiceNotice.tsx:20-23`（统一“服务未连接/数据读取失败”+错误详情）。
- **差异**：标题从“任务列表读取失败”变为通用“服务未连接/数据读取失败”；设计“筛选条件已保留”未见。
- **原因**：直接原因：复用通用错误组件（C3）。
- **影响**：用户不知道是任务列表读取失败还是全局服务不可用；也不知道筛选是否保留。
- **建议**：为该页传 `title="任务列表读取失败"` 并补“筛选条件已保留”说明。
- **验证**：静态
- **关联状态**：`error`

### P12-07: 行内类型徽标缺失，模板任务/文档任务无法识别
- **严重度**：P3
- **维度**：T / 结构 / D
- **类别**：文案 / 数据契约
- **设计依据**：`tasks.html:80`（`t.type!=='需求任务'` 时显示“模板任务/文档任务”徽标）；`:61-62,68`（模板任务行 need 写“固定模板 r7：计划待确认（创建后不能修改步骤）”）。
- **实现位置**：`TaskRow.tsx:88-93`（显示 `methodName` 徽标，不是类型）；`models.ts:386-406`（`TaskSummary` 无 type/fixedTemplate 字段）。
- **差异**：所有行都显示流程名徽标，模板任务与普通需求任务无法区分；模板行的锁定说明只剩通用 need 文案。
- **原因**：直接原因：以 `methodName` 填充徽标（C3）。根本原因：列表 DTO 无任务类型/固定模板摘要（C1）。
- **影响**：模板任务行的“创建后不能修改步骤”提示缺失，用户可能预期可在画布调整。
- **建议**：`TaskSummary` 增加 `kind`/`fixedTemplate?{name,rev}`；行内按设计显示类型徽标与模板说明。
- **验证**：静态
- **关联状态**：`ready`、`template`

### P12-08: 工具栏/表尾入口多于设计且“查看已归档”重复出现
- **严重度**：P3
- **维度**：结构
- **类别**：结构
- **设计依据**：`tasks.html:111`（表尾：已加载 N 个 · 最近更新优先 / 加载更多 / 已归档）；工具栏只有搜索、状态分段、项目下拉、分组开关（`:103-109`）。
- **实现位置**：`TasksPage.tsx:242`（工具栏“查看已归档”）、`:253-256`（分组开关）、`:272-310`（表尾：已加载/总数 · 刷新 · 加载更多 · 查看已归档 · 待处理中心）。
- **差异**：多出“刷新”“待处理中心”按钮与重复的“查看已归档”；“已加载 N 个”改为“N / total 个”。
- **原因**：直接原因：实现自行补充入口且未去重（C4）。
- **影响**：表尾拥挤；与设计的单入口不一致。
- **建议**：保留设计入口；如保留归档/待处理中心，改为工具栏次级入口并只出现一次。
- **验证**：静态
- **关联状态**：`ready`、`grouped`

### P13-01: 执行已结束但未交付仍显示绿色“已完成”，违反设计“绝不显示绿色任务已完成”
- **严重度**：P0
- **维度**：S / T / D
- **类别**：状态 / 数据契约
- **设计依据**：`opencode-workflow-design-showcase/sources/delivery/STATES.md:32`（td02-awaiting：任务徽标写“执行已结束 · 等待交付”（wait 色），“绝不显示绿色「任务已完成」”）；`originals/delivery/assets/task.js:61-90`（PH 表；`awaiting` 见 `:64`：任务徽标“执行已结束 · 等待交付”wait 色）；`originals/main/pages/task.html:181`（completed：5 步全部验收通过）。
- **实现位置**：`apps/web/src/pages/task/TaskCanvasPage.tsx:469-473`（`execution.status==='completed'` → `situ-status ok` + ✓ 图标 + `EXECUTION_STATUS_LABEL.completed`）；`packages/shared/src/domain/labels.ts:100-112`（completed='已完成'）；引擎 `packages/engine/src/execution.ts:1348`（执行完成后置 completed 并写“等待交付”，任务 lifecycle 仍 active）。
- **差异**：执行完成（验收通过、等待交付）时情况条渲染绿底 ✓“已完成”，同一行的 notice 却写“等待交付”，自相矛盾；此时任务并未交付，lifecycle 仍为 active，列表徽标仍是“需要你处理”。设计要求这一时刻显示 wait 色“执行已结束 · 等待交付”，只有服务读回结算后才显示“任务已交付/已完成”。
- **原因**：直接原因：把 `ExecutionStatus.completed` 直接映射成任务“已完成”并用成功色（C6）。根本原因：情况条未消费交付投影（`TaskDelivery.projection`）与任务 lifecycle 的完成语义（C1/C2）。
- **影响**：用户看到绿色“已完成”会认为任务结束并离开，漏掉“查看变更并交付/推送/MR”步骤；这是设计用“绝不”强调的欺骗性结果。
- **建议**：情况条/页头徽标以“执行与验收”“交付”两个事实呈现；执行完成+未交付固定写“执行已结束 · 等待交付”（wait），仅 `lifecycle==='completed'`/交付读回后显示“任务已交付/已完成”（ok）。
- **验证**：静态可证；修复后需真实服务确认 awaiting 投影
- **关联状态**：`completed`、`td02-awaiting`、`td02-delivered`、`ut-review`

### P13-02: 情况条缺设计的三段事实（现在到哪 / 要你做什么+操作 / 下一步），被进度统计替代
- **严重度**：P1
- **维度**：结构 / T / A / D
- **类别**：结构 / 交互 / 文案
- **设计依据**：`originals/main/pages/task.html:172-189`（每种状态一个 `.situ`：where（进行到第 2 段…）/ sep / “没有需要你处理的事”或“请求写入…等你审批”+ 主按钮 / “下一步：两步都验收通过后自动开始…”）；`originals/delivery/assets/task.js:273-331`（执行与验收 / 交付两个事实 + 右侧状态操作：审批/查看并处理/查看原因并恢复/去验收/恢复任务/立即重新读取/打开交付）；`:333-357`（三段渲染 + 调整中的“计划”事实）。
- **实现位置**：`TaskCanvasPage.tsx:469-513`（状态胶囊、百分比进度条、执行中/失败/自动推进/待验收/已退回计数、单行 notice）；`:515-632`（需要操作的情况散落在多条横幅）。
- **差异**：实现是“统计条”，没有“现在到哪”的步骤事实、没有“要你做什么”（原因+就近操作按钮）、没有“下一步”；交付事实与计划事实完全不进情况条；审批/恢复/验收等操作只在横幅或右侧面板，不在情况条就近位置。
- **原因**：直接原因：情况条按执行计数而非状态事实设计（C4/C5）。根本原因：缺少统一的状态事实投影（`execution.notice` 只有一条 message；交付投影/验收投影/待处理事项未汇总为情况条数据）（C1）。
- **影响**：用户每次都要扫多条横幅和常驻右面板才知道“现在到哪、要我做什么、下一步”，任务画布的核心引导缺失。
- **建议**：按设计把情况条做成 2-3 段事实（执行与验收 / 交付 / 调整中计划），每段带状态图标+颜色，右侧放当前状态唯一主操作；下一句来自服务 fact（如“两步验收后自动开始回归测试”）。
- **验证**：静态 + 需GUI（换行/密度）
- **关联状态**：`running`、`waiting`、`stalled`、`failed`、`review`、`td02-*`、`ut-*`

### P13-03: 右侧面板默认常开“执行面板”，与设计“默认隐藏、点步骤打开”相悖
- **严重度**：P1
- **维度**：结构 / 交互
- **类别**：结构 / 交互
- **设计依据**：`originals/main/pages/task.html:100`（`<aside class="side hidden" id="side">` 默认隐藏）；`:193-201`（`openNode` 才 `classList.remove('hidden')`，无选中时隐藏）；`originals/delivery/task.html:24`（同样 `side hidden`）；`originals/delivery/assets/task.js:386-387,1015`（无 panel 时 `closeSide()`）。
- **实现位置**：`TaskCanvasPage.tsx:659-737`（node→NodeDetailPanel、delivery→TaskDeliveryPanel、edit→PlanEditPanel、extras→TaskExtrasPanel，否则一律渲染 `<aside className="side task-side" aria-label="执行面板">`）；`apps/web/src/pages/task/task.css:153-167`（480px 固定）；`:368-380`（≤960 覆盖层）。
- **差异**：默认状态画布右侧被 480px 执行面板占据；设计默认全宽画布、右侧只在点步骤/交付/快照/恢复时打开。执行面板还把设计页头的自动推进开关、整体推进、开始/暂停/取消集中到面板里（见 `ExecutionPanel.tsx:135-205`），造成结构反复。
- **原因**：直接原因：以常驻执行面板补足页头/情况条缺失的操作（C4）。根本原因：页头/情况条未承载设计规定的操作与事实，只能挤到右面板（C1/C4）。
- **影响**：画布在 1024/1280 宽度下被压缩，节点可读性下降；用户默认面对信息密度高的面板而非画布；与“画布为主”的设计结构不符。
- **建议**：默认不渲染右面板；把自动推进/推进/开始暂停放回页头操作区与情况条；右面板只在选中步骤或打开交付/快照/调整时出现。
- **验证**：静态可证 + 需GUI（宽度/断点观感）
- **关联状态**：`running`、`auto-off`、`ut-running`、`td02-running`

### P13-04: 等待审批 / 停滞 / 待人工验收三类执行事实在画布与列表都没有状态入口
- **严重度**：P1
- **维度**：S / A / D
- **类别**：状态 / 交互 / 数据契约
- **设计依据**：`originals/main/pages/task.html:158`（状态徽标含“等待你处理/有步骤停滞/待人工验收”）、`:174-185`（situ 每态一段事实+操作）；`sources/delivery/STATES.md:30,33`（等待审批/受阻）；`sources/planning/STATES.md:45`（pe14 需含规划问题）；`originals/delivery/assets/td-states-v4.js:12-13,16`（ut-waiting/ut-stalled/ut-review）。
- **实现位置**：`TaskCanvasPage.tsx:347-351`（页头只有 attention 徽标）；`:469-513`（情况条只有执行状态/计数/notice）；`packages/engine/src/actions.ts:328-352`（attention 未覆盖待人工验收，停滞无字段）；任务页无 runtime interaction 数据接入（`grep runtimeInteractions|interactions|审批|授权` 在 `apps/web/src/pages/task`、`apps/web/src/flow` 无结果）；契约 `enums.ts:137-146` 无 stall。
- **差异**：审批请求只出现在待处理中心（`packages/engine/src/project-task.ts:602-645` Inbox），画布看不到“哪一步在等审批”；停滞没有任何服务字段/UI；待人工验收只有一条横幅，页头与列表仍显示“执行中”。
- **原因**：直接原因：画布未接入待处理/验收投影到状态区（C4/C6）。根本原因：停滞判定与运行互动关联（nodeId/原因/操作）没有进入任务详情读模型（C1）。
- **影响**：用户必须离开画布去待处理中心才知道在等自己；停滞任务看起来只是“执行中”；待验收任务在列表和页头都被当作执行中。
- **建议**：任务详情增加 `attentionItems[]`（来源=审批/验收/停滞，nodeId、原因、操作、请求号）；情况条与页头按设计词渲染并就近放操作；停滞由服务判定后以字段提供，不在界面计时。
- **验证**：静态 + 需真实服务（停滞/审批数据）
- **关联状态**：`waiting`、`stalled`、`review`、`ut-waiting`、`ut-stalled`、`ut-review`

### P13-05: 已暂停任务不能“调整待执行计划”，而设计明确仍可调整
- **严重度**：P1
- **维度**：A / S
- **类别**：交互 / 状态
- **设计依据**：`originals/delivery/assets/td-states-v4.js:11`（ut-paused：“你于 11:20 暂停…仍可「调整待执行计划」；调整结束后任务保持暂停，只有「恢复任务」才继续”）；`originals/delivery/assets/task.js:236`（UT 态 `canAdjust()` 列表含 `paused`）；`sources/delivery/STATES.md:40`（取消保留/暂停后仍可查看与交付）。
- **实现位置**：`packages/engine/src/actions.ts:228-238`（`adjustExecutionPlan` 仅在 `execution.status==='running'` 时为 allowed，其余含 paused 一律 denied“当前执行状态不能调整计划”）；`TaskCanvasPage.tsx:376-381`、`ExecutionPanel.tsx:284-296` 依 capability 禁用并展示该原因；领域层 `packages/engine/src/plan.ts:249` 本身允许 running 与 paused 进入 editBegin。
- **差异**：服务领域能力支持 paused 调整，但 action 投影把入口关掉；设计要求的“暂停中仍可调整、结束调整后保持暂停”无法从 UI 到达。
- **原因**：直接原因：action 投影白名单缺 paused（C6）。根本原因：能力投影与领域状态机口径不一致（C1/C6）。
- **影响**：用户主动暂停后想改待执行步骤时被拒；也阻断 ut-paused → ut-adj-* 的完整路径，设计状态链断。
- **建议**：`adjustExecutionPlan` 允许 paused（并保留 `wasPausedBeforeEdit` 语义）；按钮文案/原因与“结束调整后保持暂停”一致。
- **验证**：静态（修复后需真实服务）
- **关联状态**：`ut-paused`、`ut-adj-pausing`、`ut-adj-editing`

### P13-06: 调整待执行计划不能新增/插入/移出节点（设计核心能力缺失，契约也不支持）
- **严重度**：P1
- **维度**：A / 结构 / D
- **类别**：交互 / 数据契约
- **设计依据**：`sources/planning/STATES.md:100`（pe34：“新增依赖有表单替代拖拽”；`:129-132` 编辑真实节点名称/前置/验收 + “从计划移除…”）；`originals/planning/assets/task.js:54-55`（可编辑节点悬停 `+` 添加下一步）、`:129-132`（删除节点+影响说明）；`originals/delivery/assets/task.js:698-710`（新增节点后“撤销新增”/“从计划移除…”）；`:114-115,128-131,147`（本地新增节点参与 `st()`/`allNodes()`）。
- **实现位置**：`apps/web/src/pages/task/PlanEditPanel.tsx:261-408`（只编辑 title/qualityReview/acceptance/prerequisites）；`:368-392`（依赖用复选框）；`:396-401`（保存）；契约 `packages/shared/src/api/contracts.ts:1434-1444`（`EditSaveRequest.changes` 只有 nodeId/title/qualityReview/prerequisites/acceptance，无 added/deleted）；路由仅 `plan/edit/{begin,save,finish,abandon}`（`contracts.ts:2052-2055`）；FlowCanvas 无添加/插入钩子（`apps/web/src/flow/FlowCanvas.tsx:200-226` 只有选择/缩放）。
- **差异**：调整只能改已有节点的名称/验收/依赖，不能新增节点、不能插入到某条边之间、不能把待执行节点移出计划，也没有“撤销新增”；设计 pe34/pe35 的核心改动（新增“导出性能测试”一步）在实现中无法完成。
- **原因**：直接原因：前端编辑面板未提供节点增删入口（C4）。根本原因：`EditSaveRequest` 与 `plan/edit/*` 契约没有 add/remove 节点语义（C1），领域 `editSave` 也只重建边与改字段（`plan.ts:278-362`）。
- **影响**：执行中调整计划的最主要用途（补一步/去掉一步）不可用；用户只能改依赖/验收，等价于设计能力的一部分。
- **建议**：契约新增 add/remove 节点变更（含位置 after/to、节点定义、必需产物影响），服务端做与需求覆盖/DAG 校验；前端恢复 `+`/插入/移出和“撤销新增”。
- **验证**：静态
- **关联状态**：`pe34`、`pe35`、`ut-adj-editing`、`ut-adj-reconfirm`

### P13-07: 申请调整缺确认对话与“正在暂停新增领取”过渡，点页头按钮还需二次点面板按钮
- **严重度**：P2
- **维度**：A / T
- **类别**：交互 / 文案
- **设计依据**：`originals/planning/assets/task.js:91`（pausing 状态条：“正在暂停新增领取… 请求 rk-e51b 已发出，等待服务回执；回执成功前不开放编辑”）、`:185`（调整确认对话框：原模式记录 + “暂停新增领取并调整”）；`originals/delivery/assets/task.js:959-965`（同样的确认对话框与调整前设置块）。
- **实现位置**：`PlanEditPanel.tsx:167-193`（打开即说明+一个“调整待执行计划”按钮）、`:92-96`（begin 直接 `command.run`，先置成功文案）；`TaskCanvasPage.tsx:376-381`（页头按钮只 `openEdit`，不发命令）。
- **差异**：无确认对话与原模式摘要（自动推进/暂停态）展示；没有“正在暂停新增领取…（回执成功前不开放编辑）”的中间态；从页头点击只打开面板，必须在面板再点一次同名按钮才开始，两个同名入口语义不同。
- **原因**：直接原因：交互被拆成“打开面板+面板内发命令”两步（C5）。根本原因：服务 begin 回执没有中间 pending 状态的投影（accepted 回执已在 `command.state` 可读，但未渲染）（C5/C2）。
- **影响**：用户不确定是否已开始调整、是否会先暂停；两次点击容易误操作。
- **建议**：页头按钮 → 确认对话框（展示原自动推进/暂停状态）→ 发 begin → 情况条/面板显示“正在暂停新增领取…” → 回执成功后才开放编辑。
- **验证**：静态
- **关联状态**：`pe33`、`ut-adj-pausing`

### P13-08: 重新确认前缺“改动摘要 + 当前整图重新检查结果”
- **严重度**：P2
- **维度**：结构 / T
- **类别**：结构 / 数据契约
- **设计依据**：`originals/planning/assets/task.js:151-157`（reconfirmSide：改动（新增节点）/ 当前整图重新检查（结构、输入输出、依赖：通过；需求归属需人工填写，“旧检查报告作历史，不沿用旧绿勾”）/ 继续时自动推进恢复）；`originals/delivery/assets/task.js:687-695`（改动、锁定不变、检查、继续时）。
- **实现位置**：`PlanEditPanel.tsx:410-443`（一段提示文字 + “重新确认计划”/“继续执行”按钮）；`:226-235`（saved 横幅）；`contracts.ts` 中 `PlanRevision.validation` 可用（`flow/graph.ts:173` 正在消费 structural problems），`editSession.localChanges`（`models.ts:698-712`）也在读模型内。
- **差异**：确认框/面板没有列出“将变成修订 N+1 的改动项”、没有当前图的检查结果（结构/依赖/需求归属），用户只能盲确认。
- **原因**：直接原因：前端未展示已可用的本地改动与 plan 校验结果（C4）。部分根本原因：没有 revision diff 读模型时无法列出“新增/修改/移出”结构差异（C1）。
- **影响**：重新确认是执行继续前的关键闸门，信息不足会让用户直接点过或不敢点。
- **建议**：以 `localChanges` 列“新增/修改/移出”摘要，以 `plan.validation` 展示检查项（明确“旧报告作历史”）；无 diff 的项标注“服务未提供”。
- **验证**：静态（diff 数据需真实服务确认）
- **关联状态**：`pe35`、`ut-adj-reconfirm`、`ut-adj-ready`

### P13-09: “调整前已暂停”时“继续执行”按钮实际保持暂停，文案误导
- **严重度**：P2
- **维度**：T / A
- **类别**：文案 / 交互
- **设计依据**：`originals/delivery/assets/task.js:688,692`（`contLbl = prior==='paused' ? '结束调整（任务保持暂停）' : '继续执行'`，并写明“只结束调整；任务保持暂停”）。
- **实现位置**：`PlanEditPanel.tsx:429-437`（固定显示“继续执行”`finish(true)` 与“保持暂停”`finish(false)`）；引擎 `packages/engine/src/plan.ts:382-390`（`wasPausedBeforeEdit===true` 时即使 continueExecution 也保持 paused 并提示“恢复任务需单独操作”）。
- **差异**：调整前已暂停的任务，用户点“继续执行”，实际结果是任务保持暂停；相邻的“保持暂停”按钮同样保持暂停，两个按钮结果相同、主按钮文案与结果不一致。
- **原因**：直接原因：前端未按 `wasPausedBeforeEdit` 切换按钮文案/结构（C3/C5）。
- **影响**：用户以为点“继续执行”会恢复任务，实际没有；容易误报“继续无效”。
- **建议**：`editSession.wasPausedBeforeEdit===true` 时主按钮改“结束调整（任务保持暂停）”，并说明需单独“恢复任务”。
- **验证**：静态
- **关联状态**：`ut-adj-ready`、`ut-paused`

### P13-10: 画布内“恢复这一步”方式选择面板缺失（只有独立恢复页/按原配置重试）
- **严重度**：P2
- **维度**：S / A / 结构
- **类别**：状态 / 交互
- **设计依据**：`originals/main/pages/task.html:263-279`（恢复侧面板：原样重试/修改后重试/从上一步重新执行 + 将重新执行的步骤 + 准备→开始）；`originals/delivery/assets/task.js:711-740`（ut-recovering 迁入统一画布）；`td-states-v4.js:14-15`（ut-failed/ut-recovering）。
- **实现位置**：`TaskCanvasPage.tsx:568-592`（退回横幅“按原配置重试失败/被退回步骤”+ 查看退回原因）；`:593-612`（unknown→“到恢复页处理”）；`:411-414`（更多→任务恢复…→`/recovery`）；`pages/recovery/RecoveryPage.tsx:37-60`（恢复模式为 `from_failed_stage/all_stages/verify_only` 的派生任务）。
- **差异**：画布没有“恢复这一步”的右侧选择面板；失败后只有“按原配置重试”（不提供改输入后重试/从上一步重跑），或跳到独立恢复工作台创建恢复任务——与设计“恢复步骤”语义和入口都不同。
- **原因**：直接原因：画布内恢复 UI 未实现（C4）。根本原因：产品恢复能力是“派生恢复任务”，与设计“原地三种重试方式”不是同一契约（C6；语义差异同 13-recovery 区域）。
- **影响**：失败步骤的常见恢复路径（改一步再重跑）缺失；用户被引到另一个页面和另一套语义。
- **建议**：先明确契约：若保留派生恢复任务，画布内也应给三种“重试范围”入口并写清会创建恢复记录；否则补原地重试模式。
- **验证**：静态（真实恢复行为需服务）
- **关联状态**：`recovering`、`failed`、`ut-failed`、`ut-recovering`

### P13-11: “冻结计划”菜单语义漂移：设计是只读查看冻结/当前有效计划，实现打开“创建冻结快照”写操作
- **严重度**：P2
- **维度**：A / 结构 / T
- **类别**：交互 / 结构 / 文案
- **设计依据**：`originals/main/pages/task.html:372-377`（“冻结计划 · 修订 2”只读面板：目标/范围/验收/绑定（流程、模型、预算），“开始执行时冻结；运行中的修改形成新的有效计划，原记录保留”）；`originals/delivery/assets/task.js:1031-1032,656-665`（更多→“当前有效计划”：来源/步骤/自动推进/固定模板参数只读）。
- **实现位置**：`TaskCanvasPage.tsx:415-418`（更多→“冻结计划…”→`openExtras('freeze')`）；`TaskExtrasPanel.tsx:123-254`（“冻结只读快照”页面：写入冻结快照+快照列表，需确认；底部说明“冻结只写入本机只读快照，不会改变计划…”）。
- **差异**：同名菜单项在设计中是查看，在实现中是写操作（虽为只读快照，但产生记录且需要确认）；设计要求的“当前有效计划/冻结计划只读视图”（目标、范围、验收、绑定、来源、步骤数、自动推进）没有承载视图。
- **原因**：直接原因：产品新增了“冻结快照”能力并占用了设计的菜单名（C6）。根本原因：缺少“当前有效计划”读模型/视图（部分字段可从 plan/execution 读，未组装）（C1/C4）。
- **影响**：用户点“冻结计划”以为只是查看，结果进入写流程；同时也无法在画布核对执行所依据的计划内容。
- **建议**：菜单拆成“当前有效计划（只读）”与“冻结为快照（写）”两个清楚入口，或改名避免同名异义；补只读计划视图。
- **验证**：静态
- **关联状态**：所有执行态；`ut-running`

### P13-12: 任务画布缺“工作区详情”抽屉与“清理工作区”入口（TD06 全部 8 状态不可达）
- **严重度**：P1
- **维度**：结构 / A / D
- **类别**：结构 / 交互
- **设计依据**：`sources/delivery/STATES.md:97-104`（TD06：工作区详情 Git/非 Git、关闭保留、清理预览、未交付额外确认、清理受阻、部分清理/核对原清理、已清理仍可读）；`originals/delivery/assets/task.js:848-925`（520 抽屉：类型/公开身份/原项目/基线/任务目录与分支/子工作区/创建/最后检查/活动写入/未交付/未决原请求/已交付凭证/清理可用性与阻塞/在文件管理器显示）；`:1031-1032`（更多→工作区详情）。
- **实现位置**：`TaskCanvasPage.tsx:334-365`（页头无工作区 chip/入口）、`:409-464`（更多菜单没有“工作区详情/清理”）；工作区信息仅 `ExecutionPanel.tsx:316-331`（4 行 kv）与 `TaskDeliveryPanel.tsx:539-545`；清理 API 已存在（`apps/web/src/api/workflow.ts:341-363`、`packages/server/src/http.ts:659-660`、`WorkspaceCleanupPreview` 字段 `models.ts:985-995`），但任务画布无调用方；唯一 UI 在需求画布 `pages/requirement/WorkspacePanel.tsx:317-357`。
- **差异**：任务画布无法查看工作区详情、无法查看/执行清理、无法看到清理阻塞原因、无法核对部分清理或已清理状态；TD06 的 8 个状态在本区域全部不可达。页头也没有设计 td02-running 要求的工作区 chip。
- **原因**：直接原因：任务画布未实现工作区详情抽屉与清理入口（C4）。根本原因：干净的服务读模型/命令已具备（`TaskWorkspace` 含 children/activeWrites/retention/pendingOperationRef/actions），前端未接线（C1 不成立，属 C4）。
- **影响**：交付完成后无法从任务画布收尾（清理本地分支/worktree/副本）；用户不知道哪些文件未交付、哪些清理被阻塞、哪些必须保留。
- **建议**：页头加工作区 chip（Git worktree/独立副本）→ 520 详情抽屉；抽屉内承接清理预览/确认/阻塞/部分清理核对，并复用服务 actions/reason。
- **验证**：静态（清理真实行为需真实服务）
- **关联状态**：`td06-*`、`td02-running`、`ut-running`

### P13-13: 调整编辑态缺画布层“锁定/可修改”标记与本地修改清单（定位/撤销）
- **严重度**：P2
- **维度**：结构 / V / A
- **类别**：结构 / 样式主题 / 交互
- **设计依据**：`originals/planning/assets/task.js:44,62`（锁定节点加锁、画布浮层“已领取/运行中/已完成：锁定（含入边）/ 待执行：可修改”）；`:140-150`（右侧“本地修改 N 项·未保存”列表，含定位/新增/修改说明）；`originals/delivery/assets/task.js:698-711`（同：本地修改列表、定位、不可保存项复制、锁定步骤原因）。
- **实现位置**：`TaskCanvasPage.tsx:172-180`（`lockedNodeIds` 只在固定模板时传入）；`:659-707`（调整模式只切换右侧面板，不改画布）；`PlanEditPanel.tsx:261-408`（可修改/锁定列表、编辑表单；没有本地修改清单/定位/撤销）。
- **差异**：进入调整后画布节点没有任何锁定/可修改视觉标记，也没有图例；本地修改只在“保存修改（N）”里体现数量，无法定位到节点、无法区分“新增/修改/不可保存”。
- **原因**：直接原因：调整会话状态未投影到画布（C4/C7）。
- **影响**：用户无法在画布上判断哪些步骤可改、哪些已被领取；本地草稿不可见，容易重复改。
- **建议**：调整会话把 `lockedNodeIds` 传给画布并叠加锁/可修改徽标与图例；“本地修改”区按节点列出（定位、新增/修改、竞态后被移出的项可复制）。
- **验证**：静态 + 需GUI（视觉）
- **关联状态**：`pe34`、`claim-race`、`ut-adj-editing`、`ut-adj-conflict`

### P13-14: 快照评审 B-07 区域入口/最终报告/批次局部失败/取消态与设计不一致
- **严重度**：P2
- **维度**：S / 结构 / D
- **类别**：状态 / 结构 / 数据契约
- **设计依据**：`originals/main/index.html:171`（B-07“快照评审的运行专用区域：执行进度、审查范围与版本、功能批次、阶段报告”）；`originals/main/pages/task.html:166`（页头分段“执行进度/模板报告”）、`:280-359`（执行进度/阶段/审查范围/功能批次/输出目录/评审报告/阶段报告读取下载/已取消仍可读）、`:311`（批次读取失败不影响上方进度数字）、`:350-351`（最终报告待生成/未生成）；`originals/delivery/assets/task.js:260`（ut-snapseg 页头分段）。
- **实现位置**：`TaskCanvasPage.tsx:423-426`（快照评审在“更多”菜单，仅 `fixedTemplate.snapshot` 时出现）；`TaskExtrasPanel.tsx:470-577`（面板内页签、进度/阶段/范围/批次/阶段报告）；`:505-506`（读失败整面板 ServiceNotice）；`:442-443`（批次空）；`packages/shared/src/api/contracts.ts:763-773`（progress+batches 同一读模型）；`packages/engine/src/task-extras.ts:523,561-563`（任务 completed 时阶段报告不可读并提示“请查看最终报告”，但产品无最终报告视图）。
- **差异**：①入口在更多菜单而非页头分段；②缺设计的“评审报告/最终报告”块和生成/未生成状态，且阶段报告在任务完成后不可读、提示“查看最终报告”但无此入口；③功能批次读失败没有“进度数字保留”的局部失败态（单次读模型内联）；④无“任务已取消仍可读阶段报告”的专属横幅；⑤页签里没有设计“读取于/已分析/未完成/排除”的加载与取消态分离?（已分析/未完成/排除条已实现）。
- **原因**：直接原因：入口位置、最终报告块、取消态未实现（C4/C2）。根本原因：读模型把 progress/batches 合成一次读取且没有“最终报告”契约（C1）。
- **影响**：用户不知道快照评审在哪里；任务完成后阶段报告入口成死路；批次读取失败时以为整个进度未知。
- **建议**：入口按设计放页头分段；补“最终报告”读模型/视图（或明确文案“最终报告由交付回执提供”并给去交付入口）；批次单独读取或失败时保留上次进度；取消态加横幅；“读取后下载/下载前禁用”保持现状。
- **验证**：静态 + 需真实服务（报告接口/最终报告）
- **关联状态**：`snap-*`、`ut-fixed-snapshot`

### P13-15: 状态待核对缺“立即重新读取”按钮与自动重读说明
- **严重度**：P2
- **维度**：S / A
- **类别**：状态 / 交互
- **设计依据**：`originals/main/pages/task.html:183`（unknown situ：“最近一次读取失败，画布保留上次进度；21 秒后自动重新读取” + “立即重新读取”按钮）；`td-states-v4.js:17`（ut-unknown：“可立即重新读取”）。
- **实现位置**：`TaskCanvasPage.tsx:469-473`（状态胶囊“待核对”）、`:593-612`（未知横幅只给“到恢复页处理”）；轮询 `apps/web/src/api/workflow.ts:654-687`（SSE/轮询存在但按钮缺失）。
- **差异**：只提示“执行结果待核对”并引导去恢复页；没有画布内“立即重新读取”，也不说明会自动重读/下一次时间。
- **原因**：直接原因：未知横幅动作选择单一（C5/C2）。
- **影响**：用户不确定画布是否会自己恢复，容易被引到恢复页做无谓操作。
- **建议**：未知横幅加“立即重新读取”（`detailQuery.refetch`/`executionViewQuery.refetch`），并写“将自动重读”；恢复/重试动作与核对动作分开。
- **验证**：静态
- **关联状态**：`unknown`、`ut-unknown`

### P13-16: `td02-background`“另一个任务后台待交付”无画布提示
- **严重度**：P3
- **维度**：S / A
- **类别**：状态 / 交互
- **设计依据**：`sources/delivery/STATES.md:39`（只加侧栏任务列表计数、待处理中心计数 +1，画布左上角放不抢焦点 role=status 提示（打开/稍后），不切换视图）。
- **实现位置**：全局计数在 `apps/web/src/app/Shell.tsx:48,109-113`（待处理角标）；任务页无“后台/稍后”提示（grep 无命中）；inbox 交付事项在 `packages/engine/src/project-task.ts:604-620`。
- **差异**：没有画布级 `role=status` 提示与“打开/稍后”操作；只有侧栏角标（且是否为“后台待交付”需真实数据确认）。
- **原因**：直接原因：未实现后台交付提示组件（C4/C1 通知数据来源为 inbox，未在画布聚合）。
- **影响**：用户在看别的任务时不会感知有另一个任务等待交付。
- **建议**：从 inbox/交付投影拿“其他任务等待交付”事实，在画布左上角渲染 `role=status` 提示（打开/稍后），不改当前选中。
- **验证**：静态 + 需GUI（角标口径）
- **关联状态**：`td02-background`

### P13-17: 交付验证未通过不可区分（契约投影缺“已交付 · 验证未通过”）
- **严重度**：P2
- **维度**：S / D
- **类别**：数据契约 / 状态
- **设计依据**：`sources/delivery/STATES.md:38`（td02-delivered-verify-failed：“已交付，验证未通过”：任务徽标与回执卡 warn 色；与全部通过明确区分）；`:32`（delivered 全部通过）。
- **实现位置**：`packages/shared/src/domain/models.ts:964-983`（`TaskDelivery.verificationOutcome: all_passed|not_run|failed` 已存在）；`packages/shared/src/domain/labels.ts:132-139`（`DeliveryProjection` 只有 6 值，无“已交付未通过”）；列表 `taskStatus.ts:102-108`、画布页头只能显示“已完成/已交付”。
- **差异**：数据层能判定验证未通过，但任务列表与画布页头的交付投影没有该值，两个状态在列表/页头不可区分；交付面板内部呈现属 15-delivery。
- **原因**：直接原因：列表/徽标未消费 `verificationOutcome`（C6）。根本原因：`DeliveryProjection` 少一个“已交付 · 验证未通过”取值（C1）。
- **影响**：用户可能把“知情交付的失败结果”当成全部通过；列表无法筛选异常交付。
- **建议**：`DeliveryProjection` 增加 `delivered_verification_failed`（warn 色）并在列表/画布徽标使用；交付面板保留失败证据。
- **验证**：静态 + 需真实服务（确认投影生成规则）
- **关联状态**：`td02-delivered-verify-failed`、`td02-delivered`

### P13-18: 画布节点“Tab 进入节点，Enter 查看”的可用性未在实现中落地（键盘）
- **严重度**：P2
- **维度**：K
- **类别**：可访问性
- **设计依据**：`originals/main/pages/task.html:100`（canvas `tabindex=0`，`:106` 画布键盘说明）+ `originals/main/assets/canvas.js:94`（节点 `.cv-hit` 按钮可聚焦/选中）；`originals/delivery/task.html:24`（画布 aria-label“Tab 进入节点，Enter 查看详情”）。
- **实现位置**：`apps/web/src/pages/task/TaskCanvasPage.tsx:634-657`（aria-label 写了“点节点打开执行现场；Tab 进入节点，Enter 查看”）；`apps/web/src/flow/FlowCanvas.tsx:200-226`（ReactFlow `nodesFocusable`，但只有 `onNodeClick`，无 `onKeyDown`/Enter 处理）；`PlanNodeCard.tsx:80-115`（节点卡内部为 div，无键盘激活按钮）。
- **差异**：静态推断 Tab 可聚焦节点但 Enter 不会打开 NodeDetailPanel；aria-label 的承诺与代码不符。是否 React Flow 自带 Enter 行为需 GUI 实测（不排除库层有默认）。
- **原因**：直接原因：未实现节点键盘激活（C8）。
- **影响**：键盘用户无法打开步骤详情/验收区，任务画布核心操作不可达。
- **建议**：给节点卡加 `onKeyDown`（Enter/Space → onSelectNode）或提供“聚焦节点后按 Enter 打开”的容器级处理；aria-label 与实际行为一致。
- **验证**：需GUI（键盘实测）
- **关联状态**：`running`、`review`、所有节点态

### P13-19: 固定模板任务缺 pe36“不能做的事 / 可以做的事”说明清单
- **严重度**：P3
- **维度**：T / 结构
- **类别**：文案 / 结构
- **设计依据**：`originals/planning/assets/task.js:158-168`（pe36 侧面板：模板/入口参数/计划；“不能做的事”四项列表；“可以做的事”三步；底部统一原因+新建模板任务链接）。
- **实现位置**：`TaskCanvasPage.tsx:626-631`（一条 info banner：统一原因 + “可以查看、确认、准备工作区并按原配置执行”）；`:342-346`（模板徽标）；`ExecutionPanel.tsx` 无“不能做的事/可以做的事”区。
- **差异**：有统一原因与锁，但没有设计的能力清单（新增/删除步骤、改依赖/职业/模型/验收/参数、AI 细化、调整计划全部禁用；确认/准备/开始/按原配置重试可用），用户不清楚边界。
- **原因**：直接原因：说明区未实现（C4）。
- **影响**：模板任务用户可能反复尝试被禁操作；理解成本高。
- **建议**：模板任务在右面板/横幅补“不能做的事/可以做的事”清单与新建模板任务链接。
- **验证**：静态
- **关联状态**：`template`、`pe36`、`ut-fixed-running`

### P13-20: 更多菜单项集合与设计不一致（任务恢复总是显示；运行内容位置；继续任务…）
- **严重度**：P3
- **维度**：结构 / T
- **类别**：结构 / 文案
- **设计依据**：`originals/main/pages/task.html:167-170`（模板任务页头“阅读运行内容”按钮；更多仅 failed/recovering/snap-cancelled 有“任务恢复…”）；`originals/delivery/assets/task.js:1031-1039`（工作区详情/当前有效计划/审计记录/在需求画布查看/任务恢复(仅 failed)/暂停任务(running)/取消任务(running/parallel)）。
- **实现位置**：`TaskCanvasPage.tsx:411-414`（任务恢复…总是显示）、`:427-430`（运行内容在更多菜单、所有任务可见）、`:415-418`（冻结计划…）、`:443-451`（继续任务…额外项）。
- **差异**：任务恢复对普通执行中任务也显示（设计只在失败/恢复/取消态）；运行内容从模板页头按钮变成所有任务的菜单项；“继续任务…”设计没有（恢复任务应在情况条/页头主按钮）。
- **原因**：直接原因：菜单项未按状态收窄（C4/C3）。
- **影响**：菜单出现与当前状态无关的入口，增加误点；模板任务少了显眼的“阅读运行内容”。
- **建议**：按状态收窄菜单；模板任务页头放“阅读运行内容”；恢复入口只在失败/恢复/待核对出现。
- **验证**：静态
- **关联状态**：`template`、`failed`、`recovering`、`unknown`

### P13-21: 旧版记录（ut-legacy-done / ut-legacy-stopped）状态不可呈现
- **严重度**：P3
- **维度**：S / D
- **类别**：状态 / 数据契约 / 范围
- **设计依据**：`sources/supplement-v4/STATE-MAP.md:25-27`（旧版记录 T-2019/1975/1996/1990/2011，`ut-legacy-done|stopped`）；`originals/delivery/assets/td-states-v4.js:18-19`（明确写“旧版记录”，没有工作区 chip 与交付面板，结果已直接写入项目目录，不伪装成 TD 的“已交付”）。
- **实现位置**：`packages/shared/src/domain/models.ts:344-384`（`Task` 无 origin/legacy 字段）、`:386-406`（`TaskSummary` 无）；任务页无“旧版记录”文案（仅一处“旧版读模型”降级提示 `TaskCanvasPage.tsx:559`）。
- **差异**：无法识别/渲染旧版记录；若未来存在此类数据，会按普通任务显示“未准备/执行中”等错误状态。
- **原因**：直接原因：读模型无 origin/legacy（C1）。同时产品未发布、尚无独立工作区上线前的历史数据，属设计预留场景（C9），所以只列 P3 不计主缺陷。
- **影响**：当前版本无实际用户影响；一旦需要迁移旧数据会显示误导状态。
- **建议**：当确实需要承接旧记录时，在 Task 增 `origin: legacy`（或交付缺失+无工作区的历史判定），画布渲染“旧版记录”只读横幅并隐藏交付/工作区入口；否则在文档标注不开放。
- **验证**：静态
- **关联状态**：`ut-legacy-done`、`ut-legacy-stopped`

## 已核对一致

- 任务列表 5 个主状态的结构与文案：加载 5 行骨架、读取失败有重试且不展示样例数据、空态标题/描述/“开始任务”、无结果态“清除筛选”，与 `tasks.html:94-97` 对应（`TasksPage.tsx:143-203`）。
- 分段筛选（全部/需要处理/进行中/已结束）+ 服务端计数 + 项目下拉 + “按项目分组”开关 + 搜索框，结构、aria 与设计 `tasks.html:103-109` 一致；计数口径由服务统一计算（`packages/engine/src/project-task.ts:268-282`，`TasksPage.tsx:96-101,129-134,231-257`）。
- 行整行可点 + Enter/Space 打开 + `role="link"`/`aria-label`，与设计 `tasks.html:79-86` 一致（`TaskRow.tsx:68-85`）；行更多菜单含“打开执行画布/打开需求画布、复制任务链接、归档”与设计 `:85` 一致（`TaskRow.tsx:138-172`）。
- 未知/待核对徽标使用虚线 unknown 样式（`apps/web/src/styles/ds.css:266`）；失败=warn、完成=done 等“文字+图标+颜色”三通道与设计状态词一致（`TaskRow.tsx:113-116`、`Badge.tsx:29`）。
- 任务画布节点与边全部来自真实 `PlanRevision` + `ExecutionView`，不补造节点/边；空计划有诚实空态与“回到需求画布”动作（`apps/web/src/flow/graph.ts:170-231`、`TaskCanvasPage.tsx:172-180,645-656`）。
- 自动节点推进是真实服务设置（`POST /api/tasks/:id/execution/auto-advance`，`apps/web/src/api/workflow.ts:320-325`、`packages/server/src/http.ts:675-676`）；关闭后提供“整体推进/推进直接后继”，同次不级联，多个前置未验收时会写禁用原因（`advance.ts:33-92`、`ExecutionPanel.tsx:185-204,225-282`）。
- 写操作回执处理符合设计口径：UNKNOWN 只按原 requestKey 核对、不重发（`apps/web/src/flow/workflow-ui.tsx:116-147`）；所有执行命令均用新 requestKey + 服务回执（`apps/web/src/api/workflow.ts:299-390`）。
- 固定模板任务锁定：画布节点全部带锁 + 统一原因“该任务使用固定模板，创建后不能修改步骤；要改要求，请新建模板任务。”+“调整待执行计划”由 action 拒绝并显示原因（`TaskCanvasPage.tsx:43,172-180,342-346,376-381,626-631`；`packages/engine/src/actions.ts:228-234`）。
- 执行中调整的前半段链路正确：begin 暂停新增领取、锁定非待执行节点、保存冲突 `REVISION_CONFLICT` 保留本地草稿、重新读取并比对后剔除被领取修改、放弃恢复原自动推进/暂停设置（`packages/engine/src/plan.ts:235-275,278-307,382-390`；`PlanEditPanel.tsx:197-224,452-476`）。
- 快照评审只读与诚实降级：查看进度/报告不会启动/暂停执行；进度不等于完成的说明；报告读取失败清空旧内容、下载前必须读取、下载校验版本与权限（`TaskExtrasPanel.tsx:39,536-539,588-620`；`packages/engine/src/task-extras.ts:575-597`），与设计 `task.html:320,338,354-356` 一致。
- 审计记录只读、来自持久化事件+操作台账、支持类型筛选与分页，较设计 `task.html:378-380` 增强（`TaskExtrasPanel.tsx:284-351`）；“查看不会改变执行”的页脚说明与设计一致。
- 取消执行确认包含“停止这一轮执行/工作区与记录保留/不会自动清理”的后果说明（`TaskCanvasPage.tsx:740-761`），对应设计 `task.html:262-279` 的“原任务、失败记录与已完成步骤保持不变”。
- 任务/任务画布页面无硬编码颜色（`apps/web/src/pages/tasks/**`、`apps/web/src/pages/task/**` 无 hex/rgb 命中），均使用主题令牌；工作区详情相关数据（children/activeWrites/retention）已在服务读模型中。

## 需 GUI / 运行验证

1. **四主题 + 断点**：任务列表行五列在 1440/1280/1100/1024 下的截断与“需要处理/步骤”折叠；任务画布情况条与常驻右面板在 1180/960 下的布局（P12-05、P13-03）。
2. **画布键盘**：Tab 聚焦节点后 Enter/Space 是否能打开详情；Esc/焦点归还是否符合设计（P13-18）。
3. **情况条**：三段/多事实在窄屏的换行、aria-live 播报（`aria-live="polite"`）是否会把整条反复播报（P13-02）。
4. **调整态视觉**：进入调整后画布锁/可修改标记、本地修改定位、保存后“等待重新确认”横幅的可读性（P13-13、P13-08）。
5. **快照评审入口**：页头分段 vs 更多菜单的发现性；取消状态下的报告横幅与“最终报告”文案（当前无入口）；批次读取失败的局部提示（P13-14；入口本身 E32 已 GUI 验证）。
6. **后台待交付提示**：侧栏“任务列表/待处理中心”计数是否包含后台待交付任务，以及提示不抢焦点的行为（P13-16）。
7. **模板任务**：锁徽标、统一原因、调整禁用原因、无“+”的视觉一致性；pe36 清单缺失的用户影响（P13-19）。
8. **暂停任务调整**：若放开 action 投影，需真实服务验证 begin/save/finish 在 paused 下的行为与“结束调整保持暂停”（P13-05）。
9. **领取竞态**：需要真实并发领取复现保存冲突，验证本地草稿保留与“重新读取并比对”后只剩可保存修改（`PlanEditPanel.tsx:197-224`），GUI 与真实服务联合验证。
10. **真实交付/工作区链路**：awaiting → 交付 → delivered 时任务徽标/情况条与交付投影一致性（P13-01/P13-17 修复后需真实服务）；工作区详情/清理预览的真实阻塞原因（P13-12）。

## 未覆盖 / 说明

- **区域边界**：节点执行详情面板内容（流式/工具卡/产物/引用/尝试历史）属 `08-node-detail.md`，交付面板内部（目标选择、提交/推送/MR、应用预览、验证/回执）属 `15-delivery.md`；本报告只记录任务画布侧的入口、默认态与衔接差异，不评价其内容细节。
- **不开放边界**：PE28 子隔离与汇合、PE38 有界局部细化/跨范围替换是设计明确“后续分期/不开放”（`sources/planning/STATES.md:74,114`；`docs/review/design-parity-acceptance-2026-10-20.md` §明确不开放），实现不提供入口不是缺陷；因此 `td02-parallel` 只核对“策略只读展示”，子工作区标记缺失按边界内部分实现记录，不单列问题。
- **未运行**：未启动 GUI/未跑构建与测试；像素、四主题、真实键盘、窄屏、并发领取、真实交付/清理均未实测，已分别列入「需 GUI / 运行验证」。
- **旧版记录**（ut-legacy-done/stopped）：产品未发布，尚无“独立工作区上线前”的历史任务数据；契约也无 origin/legacy 字段，按 C9 设计预留场景处理（P13-21 仅 P3）。
- **C10 文档口径（报给 Lead 汇总，不占主清单）**：
  - `docs/review/2026-10-19-audit.md:106`（“任务画布执行控制：开关 disabled；无推进一步；恢复只有独立页且画布无入口；冻结/审计/运行内容全缺”）已被当前代码推翻：开关为真实服务设置、整体推进/推进后继已实现、冻结/审计/运行内容入口均存在（见 P13-03/P13-11/P13-20 与「已核对一致」）。
  - `docs/review/2026-10-19-audit.md:111,126`（“任务列表整体五段阶段胶囊；无行菜单”）已过时：行更多菜单、打开画布/复制/归档均已实现（`TaskRow.tsx:118-173`）；仍缺的仅是设计的分步状态条（P12-01）。
  - `docs/review/2026-10-19-audit.md:76`（B-13“快照评审无模型、无面板”）已过时：B-07 读模型与面板已实现并有 `docs/verification/2026-10-20-snapshot-review-live.md`（E32）GUI 证据；本文记录的是入口/最终报告/取消态残差（P13-14）。
  - `docs/review/design-parity-acceptance-2026-10-20.md:34` 的 P13 行称“真实节点修改及 full/light 专用快照评审已接”只部分成立：快照评审入口与面板已接，但节点增删（P13-06）与画布侧状态（P13-01/02/04/12）仍未齐；该文档 ut-* 行统一写“已有部分衔接；任务身份/原推进模式/围栏与工作区故障未逐态验证”，本报告已完成逐态核对并以本文判定为准。
- **未审计**：任务列表的归档/恢复写入细节（`TaskRow.tsx:174-179`）只核对了入口与回执；归档列表计数口径与“已归档”设计原型 toast 的语义差异未列为问题；任务列表的分页游标/刷新并发表现未验证（非设计一致性重点）。
- **设计自身口径**：主稿 `tasks.html:46` 用 ST.wait“待确认计划”显示“执行已结束，等待选择交付目标”的交付行，与 v4 统一画布 `delivery/task.js:101-103` 的“执行已结束 · 等待交付”不一致；按 METHOD 优先级以 v4 为准，本报告不把主稿这行当验收权威（C10 线索）。
