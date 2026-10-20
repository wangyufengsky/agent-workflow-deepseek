# 节点执行详情 前端设计一致性审计

> 基线：main @ 3f6f9b2（2026-10-20）。范围：`sources/node/COVERAGE.md` 的 N01–N20 共 60 状态 + `originals/node/index.html` 与 `originals/node/assets/{node-detail.js,states.js,fixtures.js}`；实现为 `apps/web/src/pages/node/`（NodeDetailPanel、NodeSubviews、ArtifactDetailView、ToolDetailView、CitationSourceView、QualityReviewResult、ReadableText、tool-feed.ts），承载于 `apps/web/src/pages/task/TaskCanvasPage.tsx` 右侧面板。审计方式：静态代码 vs 只读设计稿；未运行 GUI 的部分标注「需GUI」。设计稿目录只读，本报告未修改任何代码/设计稿/其他文档。

## 概览

| 页面 | 设计状态数 | 已逐项核对 | P0 | P1 | P2 | P3 | 结论 |
|---|---|---|---|---|---|---|---|
| 节点执行详情（N01–N20，右侧面板 + 工具/产物/引用子视图 + 宽阅读区） | 60 | 是（60/60） | 0 | 10 | 14 | 4 | 与设计有系统性偏差：面板头、执行现场事实层、工具卡、跟随、断线补读、引用、尝试历史与设计不同构；产物/工具子视图已接通但边界状态语义与阅读区结构未对齐 |

**最重要的问题（≤5 条）**

1. `NODE-02` 执行现场正文未按设计渲染 Markdown/代码块：未闭合代码块提示、流式光标、长链接折行全部缺失，`fragment.text` 被按行拆成 `<p>`。
2. `NODE-04` 事实条与组合说明未映射设计状态：「结果与验收」直接用节点状态顶替（待人工验收时仍显示「已完成」），传输结束/等待工具/排队/结果未知等值不可达。
3. `NODE-03` 工具卡直接显示引擎原始英文状态（`completed/running/failed`、`read · success`），没有设计的排队/已取消/结果未知、参数/结果行与晚回标注。
4. `NODE-08` 断线重连补读链缺失：无「重新连接→补读中→已补读 N 条（去重）」、无过时标记、无设计缺口条与受影响工具「结果未知」。
5. `NODE-06` 跟随最新缺「有 N 条新内容·回到最新」胶囊与暂停旁注：上翻自动暂停后没有任何恢复入口，位置也不按「节点+尝试」记忆。

## 状态覆盖

判定口径：`已实现`＝有可达分支且内容与设计一致；`部分`＝有分支但缺设计要点；`缺失`＝无分支/无数据源且无等价呈现。行号以当前 main 代码为准。

### N01 全图与详情（`originals/node/assets/states.js:18-26`）

| mock state | 设计名称 | 实现判定 | 证据（实现文件:行 / 无） | 说明 |
|---|---|---|---|---|
| `n01-default` | 默认全图（无面板） | 已实现 | `apps/web/src/pages/task/TaskCanvasPage.tsx:659`（仅 `?node=` 时渲染面板） | 节点详情默认不开；任务页另有常驻执行面板，属 P13 区域，不在本区域结论内。 |
| `n01-open` | 实现接口 · 详情打开（执行现场） | 部分 | `apps/web/src/pages/node/NodeDetailPanel.tsx:390-425`（头）、`:411-424`（页签）、`:441-447`（事实条） | 面板与执行现场首屏有；头部无「步骤 2 · 软件工程师 / 状态徽标 / 尝试选择」（NODE-01）；无「被面板遮住的节点平移进可见区」逻辑（无 reveal 调用）。 |
| `n01-closed` | 关闭详情（选中 / 视口保持） | 部分 | `TaskCanvasPage.tsx:203-205`；`apps/web/src/flow/FlowCanvas.tsx:106`；`NodeDetailPanel.tsx:132-140` | 关闭即删除 `?node`，选中描边随之丢失；重开回到执行现场顶部，不恢复上次页签/位置（NODE-18）。视口是否保持需GUI（画布未受控，推测保持）。 |

### N02 首次加载 / 尚无正文（`states.js:28-33`）

| mock state | 设计名称 | 实现判定 | 证据 | 说明 |
|---|---|---|---|---|
| `n02-loading` | 正文首次加载 | 部分 | `NodeDetailPanel.tsx:334-346` | 整面板 8 行骨架，不冒充正文（符合）；但无事实条「读取中」、无页签/面板头，设计要的「骨架只在正文区」未实现（NODE-19）。 |
| `n02-empty` | 尚无正文（已开始，模型未输出） | 部分 | `NodeDetailPanel.tsx:503-505`、`:548-554` | 空态为「还没有执行记录 / 服务返回空记录」，不是设计「模型还没有输出正文」；不区分「已开始未输出 / 未执行 / 无记录」（NODE-19）。 |

### N03 正文流式追加（`states.js:35-37`）

| mock state | 设计名称 | 实现判定 | 证据 | 说明 |
|---|---|---|---|---|
| `n03-stream` | 正文流式追加（未闭合代码块 / 长链接） | 部分 | `NodeDetailPanel.tsx:548-554`（按 `\n` 拆 `<p>`）；`packages/engine/src/execution.ts:1192-1205`（片段追加/事件） | 按 seq 追加经事件/轮询可达；Markdown、代码块、表格、链接、未闭合提示、生成中光标全部缺失（NODE-02）。 |

### N04 工具等待 / 运行 / 完成（`states.js:39-47`）

| mock state | 设计名称 | 实现判定 | 证据 | 说明 |
|---|---|---|---|---|
| `n04-wait-tool` | 等待工具（排队） | 缺失 | `NodeDetailPanel.tsx:441-447`（无等待工具值）；`execution.ts:1250` + `packages/opencode/src/runner.ts:14`（状态只有 called/success/failed/progress，无 queued） | 无「排队」状态来源，事实条无「等待工具返回」；工具卡无法显示「排队」（NODE-03/04）。 |
| `n04-tool-running` | 工具运行中 | 部分 | `NodeDetailPanel.tsx:517-519`（`fragment.toolCallRef?.status` 原样渲染） | 可显示运行中，但为英文 `running`、无图标；无「等待服务返回结果」结果行（NODE-03）。 |
| `n04-tool-done` | 工具完成、正文继续 | 部分 | `NodeDetailPanel.tsx:517-519`、`:441-447` | `completed` 原样显示；工具事实为「有工具记录」而非「全部结束」；尝试格显示次数而非状态（NODE-03/04）。 |

### N05 公开推理摘要（`states.js:49-54`）

| mock state | 设计名称 | 实现判定 | 证据 | 说明 |
|---|---|---|---|---|
| `n05-reasoning` | 有公开推理摘要 | 缺失（服务未提供，设计允许的诚实降级） | `packages/engine/src/plan.ts:502`（`publicReasoningSummary` 固定 `none_in_attempt`）；`execution.ts:1169`、`:1183-1190`（只产出 model_text/tool_activity）；`NodeDetailPanel.tsx:70-81` | 该类别永不产生；前端也未实现折叠/标签/样式分支。按 C1/设计缺口记录，不算违背「仅能力提供时显示」（NODE-20）。 |
| `n05-no-reasoning` | 无公开推理摘要 | 部分 | `NodeDetailPanel.tsx` 全文未读取 `output.capabilities.publicReasoningSummary`；无「关于此记录」块 | 记录流里没有空摘要块（符合）；缺设计要求的「本次未提供公开推理摘要」说明一句（NODE-20）。 |

### N06 传输结束 ≠ 完成（`states.js:56-61`）

| mock state | 设计名称 | 实现判定 | 证据 | 说明 |
|---|---|---|---|---|
| `n06-ended-unsubmitted` | 正文传输结束 · 结果未提交 | 部分 | `NodeDetailPanel.tsx:441-447`、`:880-886`；`packages/server/src/http.ts:735`（terminal 真值已提供） | `terminal` 有真实值；但事实条无「传输结束 / 结果：未提交」，组合说明只看 attempt status（NODE-04）。 |
| `n06-pending-accept` | 结果已提交 · 待验收 | 部分 | `NodeDetailPanel.tsx:446`（结果与验收＝`NODE_STATUS_LABEL`）；`:817-822`（仅验收命令回执）；全仓无 service_event producer | 无「结果已提交 · 等待验收」服务事件行；结果已提交未验收时事实条显示「已完成」；人工验收以概览内审计卡呈现（NODE-04/05/21）。 |

### N07 失败与部分正文（`states.js:63-65`）

| mock state | 设计名称 | 实现判定 | 证据 | 说明 |
|---|---|---|---|---|
| `n07-failed-partial` | 执行失败 · 保留部分正文 | 部分 | `NodeDetailPanel.tsx:548-554`（fragments 保留）、`:880-886`（通用失败句） | 部分正文保留可读；无失败原因行/「正文在此中断」（NODE-27）；运行中工具不改为「结果未知」「时间未知」（NODE-03）；无页脚「恢复这一步」（NODE-17）。 |

### N08 取消（`states.js:67-75`）

| mock state | 设计名称 | 实现判定 | 证据 | 说明 |
|---|---|---|---|---|
| `n08-cancelling` | 取消中 | 缺失 | `packages/shared/src/domain/enums.ts:137-148`（NodeStatus 无 cancelling）；`NodeDetailPanel.tsx` 无分支 | 无法表达「取消请求 ≠ 已停止」；`execution` prop 已传入（`:103`）但只用于推进计算（`:238-258`）（NODE-07）。 |
| `n08-cancelled` | 已确认取消 | 部分 | `NodeDetailPanel.tsx:446`（`NODE_STATUS_LABEL`＝已取消） | 节点/尝试可显示已取消；运行中工具不标「已取消」，页脚无「恢复这一步」（NODE-03/17）。 |
| `n08-cancel-unknown` | 取消结果未知 | 缺失 | 无取消回执投影/核对入口（`fetchOperationByKey` 在 `apps/web/src/api/workflow.ts:154` 但节点面板未用） | NODE-07。 |

### N09 回执未知（`states.js:77-79`）

| mock state | 设计名称 | 实现判定 | 证据 | 说明 |
|---|---|---|---|---|
| `n09-receipt-unknown` | 结果提交回执未知 | 缺失 | `NodeDetailPanel.tsx` 无分支；`:817-822` 的核对仅覆盖验收命令回执 | 结果提交回执未知无处呈现，也无「核对原操作」入口（NODE-07）。 |

### N10 断连与补读（`states.js:81-95`）

| mock state | 设计名称 | 实现判定 | 证据 | 说明 |
|---|---|---|---|---|
| `n10-disconnected` | 数据连接断开 | 部分 | `NodeDetailPanel.tsx:442`、`:478-485` | 有连接格与一句说明；无逐条「过时 · 截至 hh:mm:ss」、无「连接」与「模型是否执行」两句分离、无「重新连接」按钮（NODE-08）。 |
| `n10-reconnecting` | 重新连接中 | 部分 | `apps/web/src/api/workflow.ts:604-638`；`NodeDetailPanel.tsx:442` | 只有「正在连接 / 已断开（只读轮询）」，无设计「重新连接中 + 内容仍过时」（NODE-08）。 |
| `n10-backfilling` | 补读中（按序 / 去重） | 缺失 | 输出读口无 gaps/cursor 能力（`packages/shared/src/api/contracts.ts:2216-2220`）；无补读状态 | NODE-08。 |
| `n10-backfilled` | 补读完成 | 缺失 | 同上；无「已补读 N 条（去重 2 条）」（HISTORY 服务事件行亦不可达） | NODE-08。 |
| `n10-gap` | 补读有缺口（服务未保留） | 部分 | `NodeDetailPanel.tsx:197-212`（客户端按 seq 洞计算）、`:486-491`（一行 notice） | 只有文字提示，不是设计虚线缺口条；无时间区间、受影响工具不标「结果未知」（NODE-08）。 |

### N11 完成与验收（`states.js:97-105`）

| mock state | 设计名称 | 实现判定 | 证据 | 说明 |
|---|---|---|---|---|
| `n11-done` | 完成（结果提交 + 验收通过） | 部分 | `NodeDetailPanel.tsx:446`、`:636-641`、`:761-815` | 结果修订、校验状态、人工验收分别可见；无「验收通过（r3 · 策略 v3）」绑定，事实条「结果与验收」＝节点状态（NODE-04/21）。 |
| `n11-accept-rejected` | 验收未通过 | 部分 | `NodeDetailPanel.tsx:53-58`、`:636-638`、`:761-815` | 呈现为「校验未通过 / 已退回修改」两个产品事实，非设计单一「结果与验收：未通过 + 原因」；无结果版本/策略版本绑定（NODE-21）。 |
| `n11-manual-accept` | 待人工验收 | 部分 | `NodeDetailPanel.tsx:768-773`、`:793-800` | 有「待人工验收」与两动作，但位于概览页签、非设计结果与验收格 + 页脚动作；无 r3/策略 v3 绑定（NODE-17/21）。 |

### N12 跟随最新（`states.js:107-115`）

| mock state | 设计名称 | 实现判定 | 证据 | 说明 |
|---|---|---|---|---|
| `n12-follow-on` | 跟随最新：开（在底部） | 部分 | `NodeDetailPanel.tsx:560-577`、`:309-313` | 开关有、默认开、追加时回到底；无「跟随最新」记录区内联状态（设计在记录区底部浮层）（NODE-06）。 |
| `n12-follow-off` | 跟随最新：关（只计数） | 缺失 | 无新内容计数/胶囊/回到最新 | NODE-06。 |
| `n12-scrolled-new` | 上翻阅读 · 有新内容 | 部分 | `NodeDetailPanel.tsx:497-501`（离底 36px 自动停跟随）、`:560-577` | 上翻会暂停跟随；无「已暂停」旁注、无「有 N 条新内容 · 回到最新」、无恢复入口（NODE-06）。 |

### N13 工具详情（`states.js:117-134`）

| mock state | 设计名称 | 实现判定 | 证据 | 说明 |
|---|---|---|---|---|
| `n13-tool-text` | 工具详情 · 长文本 | 部分 | `apps/web/src/pages/node/ToolDetailView.tsx:30-42` | 子视图存在（以宽阅读区形态）、长文本可读、可继续读取；缺来源标签/结束时间/格式元信息（NODE-14/28）；不在面板内子视图而是直接替换面板（NODE-15/28）。 |
| `n13-tool-json` | 工具详情 · JSON | 部分 | `apps/web/src/pages/node/ReadableText.tsx:8-12`、`:47` | JSON 折叠树可读、可复制；无字符串/数字/布尔三色、无全部展开/收起（NODE-14）。 |
| `n13-tool-code` | 工具详情 · 代码（分段读取） | 部分 | `ToolDetailView.tsx:40`；`ReadableText.tsx:38-47` | 行号、自动换行、搜索、继续读取有；无语法色、「已加载 1–200 行 · 共 312 行」、退出码（NODE-14）。 |
| `n13-tool-empty` | 工具详情 · 空结果 | 部分 | `ToolDetailView.tsx:37`；`ReadableText.tsx:47` | 空串走「（空内容）」，`content===null` 走「这条记录没有保存返回内容」；未按设计「工具返回空结果」中性样式，且空/未保留未区分（NODE-12）。 |
| `n13-tool-failed` | 工具详情 · 失败（命令输出 / 读取失败） | 部分 | `ToolDetailView.tsx:36-41` | 错误分区与失败说明有；分页读取失败时 `query.error` 直接盖掉已加载内容（`ToolDetailView.tsx:26`），非设计「保留已加载 + 重新读取」；无退出码（NODE-12/14）。 |
| `n13-tool-twice` | 同一工具两次调用 + 晚回 | 部分 | `apps/web/src/pages/node/tool-feed.ts:3-17`；`NodeDetailPanel.tsx:513-539` | 同 callId 原位更新、不同 callId 两张卡（符合）；无「结果于 … 返回（晚于后续正文）」标注，卡片时间取最新片段（NODE-03）。 |

### N14 工具读取边界（`states.js:136-147`）

| mock state | 设计名称 | 实现判定 | 证据 | 说明 |
|---|---|---|---|---|
| `n14-redacted` | 服务端脱敏 | 部分 | `ToolDetailView.tsx:38`；`packages/engine/src/tool-evidence.ts:7-13`、`:38` | 服务端先脱敏、复制内容已含「[已隐藏]」；缺「已隐藏 · 服务端脱敏」chip、字段计数与「复制与下载同样不含」说明（NODE-14/26）。 |
| `n14-no-permission` | 无权限 | 部分 | `ToolDetailView.tsx:24-37`；`NodeDetailPanel.tsx:353-355` | 撤权后阅读区级整区锁有；读取时 FORBIDDEN 退化为通用「数据读取失败」+ 一行说明，没有设计「整区上锁、摘要层仍显示」（NODE-12）。 |
| `n14-no-capability` | 缺能力 | 部分 | `execution.ts:856`（抛 `CAPABILITY_UNAVAILABLE`）；`ToolDetailView.tsx:36` | 缺能力被当错误横幅（warn + 错误码）显示，非设计 unknown 虚线中性说明「当前服务尚未提供工具完整参数读取」（NODE-12）。 |
| `n14-truncated` | 已截断 | 部分 | `ToolDetailView.tsx:39` | 有截断提示；无「前 64 KB」具体保留量、非顶部横幅、与「继续读取」的关系未说明（NODE-14）。 |

### N15 产物阅读与下载（`states.js:149-165`）

| mock state | 设计名称 | 实现判定 | 证据 | 说明 |
|---|---|---|---|---|
| `n15-art-text` | 产物阅读 · Markdown 文本 | 部分 | `apps/web/src/pages/node/ArtifactDetailView.tsx:28-36`；`ReadableText.tsx:47` | 宽阅读区可读 Markdown，头部有版本/sha256/大小/来源/mime 与下载；无面包屑、无左栏产物列表、无内容类型标注（NODE-13/15）。 |
| `n15-art-json` | 产物阅读 · JSON | 部分 | `ReadableText.tsx:8-12` | JSON 树可折叠；无全部展开/收起、无类型色（NODE-14）。 |
| `n15-art-code` | 产物阅读 · 代码 | 部分 | `ReadableText.tsx:38-47` | 行号、搜索、换行有；无语法色、无行号锚点/定位、无「已加载范围」（NODE-14）。 |
| `n15-art-unsupported` | 产物阅读 · 不支持格式 | 部分 | `ArtifactDetailView.tsx:32-34` | `preview===null` 显示「此文件格式请下载后查看」；头部有 mime/大小（信息在），但正文缺设计「这种格式（mime · size）不能在这里预览」与下载不可用说明（NODE-13/26）；下载仍可用属产品真实能力，合理。 |
| `n15-art-missing` | 不存在 / 失效 / 无权 / 未生成 | 部分 | `ArtifactDetailView.tsx:31`；`NodeDetailPanel.tsx:353-355`；`execution.ts:874-878`（FORBIDDEN/NOT_FOUND/STALE_TARGET） | 阅读区级无权有整区锁；不存在/版本失效统一成「数据读取失败 + 错误码」，未区分；「正文尚未生成」在产物模型上不可表达（C1）（NODE-13）。 |
| `n15-download` | 产物下载（失败 → 重试 → 已下载） | 部分 | `ArtifactDetailView.tsx:12-22`、`:34-35` | 宿主保存（saved/cancelled/failed/unsupported）、重试、再次下载、浏览器回退均有；缺「下载失败不改变执行状态」说明；措辞与设计不同（NODE-26）。 |

### N16 引用定位（`states.js:167-175`）

| mock state | 设计名称 | 实现判定 | 证据 | 说明 |
|---|---|---|---|---|
| `n16-cite-source` | 引用 · 原文段落 | 部分 | `apps/web/src/pages/node/CitationSourceView.tsx:9-29`；`NodeDetailPanel.tsx:915-944`（来源需求入口） | 仅需求条目原文/节选，带计划/需求修订/sha256 版本绑定；不是设计「来源快照原文段落」，且定位是字符偏移而非章节/段落高亮（NODE-09）。 |
| `n16-cite-code` | 引用 · 精确代码行 | 缺失 | `packages/shared/src/domain/models.ts:816-841`（NodeDetail 仅 requirementLinks）；无 SourceRef/行号字段 | NODE-09。 |
| `n16-cite-excerpt` | 引用 · 只有节选 / 摘要 | 部分 | `CitationSourceView.tsx:25-27` | 有「条目节选；未保存全文定位」与字符偏移；无「仅提供节选（第 40–60 行附近）」行号范围、无摘要类型（NODE-09）。 |

### N17 多次尝试（`states.js:177-188`）

| mock state | 设计名称 | 实现判定 | 证据 | 说明 |
|---|---|---|---|---|
| `n17-list` | 多次尝试列表 | 部分 | `NodeDetailPanel.tsx:582-620` | 有序号、当前/历史、状态、起止时间、原因摘要；缺定义修订/执行代次、「查看」入口、分页与保留说明（NODE-10/22）。 |
| `n17-history` | 历史 #1 单次详情 | 部分 | `NodeDetailPanel.tsx:622-697` | 有历史结果与产物（内联在列表下方）；无单次详情子视图、无验收绑定、无 ‹› 切换、「查看这次的执行现场」缺失（NODE-10/21）。 |
| `n17-history-session` | 历史 #1 执行现场（只读） | 部分 | `NodeDetailPanel.tsx:450-464`；`:177`（历史不轮询） | 有常驻只读条与「回到当前尝试」、无跟随开关、不订阅追加（符合）；缺「当前尝试有新内容」小点（NODE-10 说明）。 |
| `n17-back-current` | 回到当前（当前仍在加载） | 部分 | `NodeDetailPanel.tsx:454-462`、`:186`、`:503` | 点击后直接复用缓存/渲染空态，无「正在读取尝试 #N 的最新记录」与事实条读取中（NODE-23）。 |

### N18 记录保留与分页（`states.js:190-195`）

| mock state | 设计名称 | 实现判定 | 证据 | 说明 |
|---|---|---|---|---|
| `n18-not-retained` | 历史记录未保留 | 缺失 | `packages/shared/src/api/contracts.ts:1645-1657`（无 retention）；`NodeDetailPanel.tsx` 无保留说明 | NODE-22。 |
| `n18-page-fail` | 加载更早的尝试失败 | 缺失 | `packages/server/src/http.ts:709-726`（一次返回全部，无游标）；`NodeDetailPanel.tsx:873`（错误仅一行 hint，无重试按钮） | NODE-22。 |

### N19 晚回 / 撤权 / 项目切换（`states.js:197-205`）

| mock state | 设计名称 | 实现判定 | 证据 | 说明 |
|---|---|---|---|---|
| `n19-late` | 切节点后旧响应晚到 | 部分 | `apps/web/src/api/workflow.ts:130-135`（身份不一致拒绝）；`NodeDetailPanel.tsx:156` | 晚回被丢弃（安全）；无设计「已忽略属于上一个节点的晚到内容」细提示（NODE-25）。 |
| `n19-revoked` | 撤权（内容清除） | 部分 | `NodeDetailPanel.tsx:178-185`（清缓存）、`:353-355`（阅读区锁）、`:440`（正文无权一句） | 阅读区/缓存清理有；事实条、尝试列表摘要、概览与验收动作仍显示，无「你已无权查看此尝试的记录」与「没有业务动作」（NODE-24）。 |
| `n19-project` | 项目切换（面板关闭） | 已实现（等价） | `TaskCanvasPage.tsx:659`（面板仅在任务路由 `?node=` 下）；查询按 taskId 分键（`workflow.ts:527-577`） | 产品无「同一画布切项目」入口（原型辅助）；离开任务画布即卸载面板，旧内容不残留。按 C9/原型辅助处理，不记缺陷。 |

### N20 宽阅读 / 键盘 / 减少动态（`states.js:207-215`）

| mock state | 设计名称 | 实现判定 | 证据 | 说明 |
|---|---|---|---|---|
| `n20-reader` | 宽阅读区展开与返回 | 部分 | `apps/web/src/pages/node/node.css:295-297`；`NodeDetailPanel.tsx:351-386`、`:220-231` | 有宽阅读区与返回、恢复 feed 滚动位置；宽 900px（设计 min(960, 视口−导航−240)）、无左栏列表/面包屑、打开方式是阅读器整体替换面板（NODE-15）。 |
| `n20-keyboard` | 键盘操作（焦点环 / 方向键 / Esc） | 部分 | `NodeDetailPanel.tsx:142-154`（Esc）、`:411-424`（页签） | Esc 关阅读区/宽阅读有；页签无 ←/→、无焦点环演示、记录区无 `role=log`、关阅读区焦点不归还（NODE-16）。 |
| `n20-reduced` | 减少动态 | 部分（需GUI） | `apps/web/src/styles/ds.css:327`（全局 prefers-reduced-motion）；`node.css` 无动画 | 全局降级存在；记录区无光标/平滑滚动实现；真实观感需GUI确认。 |

## 问题清单

### NODE-01: 面板头缺「步骤 · 职业 / 状态徽标 / 尝试选择」
- **严重度**：P1
- **维度**：S / A / 结构 / T
- **类别**：结构 / 交互
- **设计依据**：`opencode-workflow-design-showcase/sources/node/COVERAGE.md:15`（N01 open：「面板头：步骤 2 · 软件工程师、节点名、状态徽标、尝试选择“尝试 #3 · 当前”」）；`opencode-workflow-design-showcase/originals/node/assets/states.js:21-23`；渲染逻辑 `originals/node/assets/node-detail.js:358-365`（headHTML：eyebrow「步骤 N · 角色」+ 标题 + 状态 badge + att-chip）。
- **实现位置**：`apps/web/src/pages/node/NodeDetailPanel.tsx:390-425`（头部只有 kind 徽标 `NODE_KIND_LABEL`、分组标签、node.key、标题、宽阅读、关闭 + 页签）；尝试切换只在 `:582-620` 的「尝试与产出」列表里。
- **差异**：设计要求头部四要素（步骤序号、职业、节点状态徽标、尝试选择 chip）；实现四者全无，且无「当前/历史」身份提示（历史条只在执行现场页签 `:450-464` 出现）。可见数据已具备：角色可从 `detail.node.roleSnapshot.name` 取（`packages/shared/src/domain/models.ts:446`），步骤序号可从已传入的 `plan` 计算（`NodeDetailPanel.tsx:102`、`TaskCanvasPage.tsx:664`），尝试列表可从 `attempts` 取。
- **原因**：头部按产品自有的「节点详情」结构重构，未按设计头结构落地（C4）；尝试切换入口被移到列表页签，头部缺少切换器（C5）；并非契约缺失（角色/尝试数据都在）。
- **影响**：N01-open 第 1 条验收点直接不成立；用户无法在头部确认当前查看的是哪一次尝试，历史模式可发现性差；N17 的「‹ › 切换 #1/#2/#3」也失去入口。
- **建议**：头部补眉标「步骤 N · 职业名」、节点状态徽标（图标+文字，来自 `NODE_STATUS_LABEL`）、尝试选择 chip（当前/历史 + 下拉尝试列表 + 「回到当前尝试」，带 `aria-haspopup`/`aria-label`）。
- **验证**：静态（已可判定）；交互需GUI复核。
- **关联状态**：`n01-open`, `n01-closed`, `n17-list`, `n17-history`

### NODE-02: 执行现场正文未按 Markdown/代码块渲染，缺未闭合提示与流式光标
- **严重度**：P1
- **维度**：S / T / V / D
- **类别**：状态 / 样式主题
- **设计依据**：`sources/node/COVERAGE.md:19`（「正文流式追加（未闭合代码块 / 长链接）」）；`sources/node/README.md:39`（「记录流按服务顺序排列模型正文（Markdown、未闭合代码块）」）；`originals/node/assets/states.js:35-37`（checks：「代码块未结束 · 正在生成」「末尾静态光标块，减少动态时不闪」「长链接、长文件名 break-word」）；`originals/node/assets/node-detail.js:67-119`（mdRender：流式安全 Markdown、未闭合代码块标注）。
- **实现位置**：`apps/web/src/pages/node/NodeDetailPanel.tsx:548-554`（`fragment.text.split('\n')` 逐行 `<p>`）；未使用 `fragment.format`（字段存在：`packages/shared/src/domain/models.ts:806`），也未复用 `ReadableText.tsx:47` 的 `react-markdown`。
- **差异**：模型正文里的标题、列表、表格、行内代码、代码块、链接全部退化为纯文本行；未闭合代码块无「代码块未结束 · 正在生成」提示；无生成中光标；长链接依赖 CSS 折行（未验证）。设计要求「Markdown、未闭合代码块、长链接」三类正文能力均未实现。
- **原因**：执行现场渲染分支只做最小文本切分（C2）；产品已有 Markdown 渲染器但未复用到 record feed（C7）；`OUTPUT fragment.format` 未被消费。
- **影响**：N03 主画面不成立；模型输出中代码/表格类内容可读性严重下降（本产品步骤正文常含代码块与结果表）；复制/引用排版的后续能力也受阻。
- **建议**：把 Markdown 渲染抽为共享组件（支持 `format=markdown`、未闭合代码块标记、流式光标、`break-word`），record feed 与产物阅读共用；未闭合块显示设计文案，减少动态时不闪。
- **验证**：静态；渲染观感需GUI。
- **关联状态**：`n03-stream`, `n02-empty`

### NODE-03: 工具卡状态与结构不符（英文原始状态、缺排队/取消/未知、无参数/结果行与晚回）
- **严重度**：P1
- **维度**：S / T / 结构 / D
- **类别**：状态 / 文案 / 数据契约
- **设计依据**：`sources/node/COVERAGE.md:20-22`（N04：排队/运行中/完成）；`:27`（N07 运行中工具改「结果未知」「时间未知」）；`:48`（N13-tool-twice 晚回原位更新并注明）；`:29`（N08 工具卡「已取消」）；`originals/node/assets/states.js:41-47`、`:63-75`、`:132-134`（checks）；`originals/node/assets/node-detail.js:509`（TOOL_ST 六态中文）、`:512-543`（itemHTML：来源标签、参数/结果行、`tc-note` 晚回/gap/failed 说明、`timeCell`「时间未知」）。
- **实现位置**：`apps/web/src/pages/node/NodeDetailPanel.tsx:513-539`；状态徽标 `:517-519`（直接输出 `fragment.toolCallRef?.status`）；正文 `:522`（引擎写入的 `${tool} · ${rawStatus}`，见 `packages/engine/src/execution.ts:1250`、`packages/opencode/src/runner.ts:14`）；时间 `:508-511`（取片段 recordedAt，不是开始时间）。
- **差异**：用户看到 `completed / running / failed` 与 `read · success` 等英文原始状态；没有排队、已取消、结果未知；没有「参数 / 结果」两行摘要；没有「结果于 10:44:31 返回（晚于后续正文）」；失败/取消时仍可能显示运行中；无「时间未知」。整卡不可点（设计整卡可点开详情，`node-detail.js:525-534`）。
- **原因**：服务侧工具事件只有 called/progress/success/failed 四值，缺 queued/cancelled/unknown（C1，见 `runner.ts:14` + `execution.ts:1250`）；前端直接透出原始枚举而未映射到设计状态词（C3/C6）；晚回标注所需「到达顺序 vs 片段 seq」信息未保留（C1）。
- **影响**：工具卡是执行现场最主要的信息密度区；N04 三态、N07「结果未知」、N08「已取消」、N13-tool-twice「晚回」四组验收点全部不成立；英文状态词对中文用户不可读。
- **建议**：建立工具状态映射表（排队/运行中/成功/失败/已取消/结果未知 + 图标），卡内补来源标签、参数/结果摘要、开始时间；晚回用「结果于 hh:mm:ss 返回（晚于后续正文）」标注；卡片整体可点，保留「指令只是资料、无重放」提示。
- **验证**：静态（已可判定）；排队/取消/晚回需真实服务事件。
- **关联状态**：`n04-wait-tool`, `n04-tool-running`, `n04-tool-done`, `n07-failed-partial`, `n08-cancelled`, `n13-tool-twice`

### NODE-04: 事实条与组合说明未映射设计状态，「结果与验收」误用节点状态
- **严重度**：P1
- **维度**：S / T / D
- **类别**：状态 / 数据契约
- **设计依据**：`sources/node/COVERAGE.md:25-26`（正文传输结束/结果未提交；「尝试：执行已结束（不是已完成）」）；`:37-39`（验收通过/未通过/待人工验收）；`:20-22`（工具全部结束/1 个排队）；`sources/node/API-REQUIREMENTS.md:176-186`（五格独立、无数据未知、CAPABILITY_UNAVAILABLE 写「当前服务未提供」、历史冻结）；`originals/node/assets/node-detail.js:440-470`（facets 每格逐状态值）、`:471-496`（combo 逐状态一句话）。
- **实现位置**：`apps/web/src/pages/node/NodeDetailPanel.tsx:441-447`（五格）；`:880-886`（explainSentence）；`:443` 模型正文格；`:444` 工具格；`:445` 尝试格；`:446` 结果与验收格＝`NODE_STATUS_LABEL[selectedAttempt.status]`。
- **差异**：设计要求的「读取中 / 尚无正文 / 等待工具返回 / 正在生成 / 传输结束 / 传输中断 / 已停止」、「无 / 全部结束 / 1 个排队 / N 个运行中 / 结果未知」、「未提交 / 已提交待验收 / 验收通过 / 未通过 / 待人工验收 / 回执未知」均无对应值；工具格只写「有工具记录」；尝试格显示「N 次」而非当前尝试状态；结果与验收格在「结果已提交但待人工验收」时显示「已完成」，与设计 N06/N11「验收通过前不显示已完成」相反；组合说明不区分「等待工具返回」「传输结束」，与 N03/N04/N06 的设计句子不符。
- **原因**：五格取值按产品自己的 attempt/node 状态简化（C6）；验收被产品定义为审计事实而非完成条件（见 NODE-21）；传输/工具/结果的可信来源未接（C1）。
- **影响**：事实条是设计判定「传输结束 ≠ 完成」「工具成功 ≠ 步骤完成」的核心区域；当前用户会得到误导性的「已完成/有工具记录」结论（N06/N11 主画面不成立）。
- **建议**：按设计枚举实现每格取值与 unknown 虚线样式；结果与验收格改由 `attempt.result（含 verification）+ acceptance` 组合；组合说明按五格生成设计语句（等待工具/传输结束/验收等待等）；历史模式五格冻结并标「不更新」。
- **验证**：静态（已可判定）。
- **关联状态**：`n02-empty`, `n03-stream`, `n04-wait-tool`, `n04-tool-done`, `n06-ended-unsubmitted`, `n06-pending-accept`, `n07-failed-partial`, `n11-done`, `n11-accept-rejected`, `n11-manual-accept`

### NODE-05: 服务事件行整体不可达（结果提交/验收/补读/取消确认无处呈现）
- **严重度**：P1
- **维度**：S / D
- **类别**：数据契约 / 状态
- **设计依据**：`sources/node/COVERAGE.md:26`（服务事件行「结果已提交 · 等待验收」）、`:30`（「等待执行器确认」）、`:35`（「已补读 N 条（去重 2 条）」）、`:37-39`（验收通过/未通过/进入人工验收）；`sources/node/API-REQUIREMENTS.md:192-198`（服务事件可由快照变化投影）；`originals/node/assets/node-detail.js:540-543`（itemHTML `svc` 分支）、`:227-267`（makeCur 中 SUBMIT/验收/补读事件）。
- **实现位置**：`apps/web/src/pages/node/NodeDetailPanel.tsx:540-547`（渲染 `service_event` 分支）；但全仓无 producer：`packages/shared/src/domain/models.ts:807`、`events.ts:17` 只有类型，`packages/engine/src/execution.ts:1169`、`:1183-1190` 只写 `model_text`/`tool_activity`。
- **差异**：前端留了渲染分支，但服务从不写 `service_event` 片段，因此该分支不可达；也没有从 `terminal/attempt.status/acceptance` 组合出设计要求的服务事实行。
- **原因**：服务输出投影缺 `service_event` 类别（C1，API-REQUIREMENTS §2.3 的「服务事件可由快照变化投影」未落地）；前端未做组合投影（C2）。
- **影响**：N06-pending-accept、N08-cancelling/cancelled、N10-backfilled、N11-done 的核心事实行全部缺失；用户看不到「结果已提交·等待验收」「执行器已确认停止」「已补读」等只读事实。
- **建议**：短期前端用快照事实组合只读服务行（明确「来源：快照」），长期请服务补 `service_event` 投影（eventKind）；历史模式不追加。
- **验证**：静态；需真实服务确认投影缺口。
- **关联状态**：`n06-pending-accept`, `n08-cancelling`, `n08-cancelled`, `n10-backfilled`, `n11-done`, `n11-accept-rejected`, `n11-manual-accept`

### NODE-06: 跟随最新缺新内容胶囊/计数与暂停提示
- **严重度**：P1
- **维度**：S / A
- **类别**：交互 / 状态
- **设计依据**：`sources/node/COVERAGE.md:40-42`（N12 三态）；`originals/node/assets/states.js:107-115`（checks：「开关为关」「胶囊“有 3 条新内容 · 回到最新”」「上翻自动暂停 / 点击回到底部并恢复跟随」）；`originals/node/assets/node-detail.js:566-616`（TX：follow/paused/newCount/dirty、`newpill`、离底 >80px 自动暂停、按「节点+尝试」记忆位置）。
- **实现位置**：`apps/web/src/pages/node/NodeDetailPanel.tsx:493-501`（离底 <36px 视为跟随）、`:560-577`（仅开关）、`:309-313`（following 时滚到底）；`savedFeedPosition` 仅用于阅读器往返（`:219-231`）。
- **差异**：没有「有 N 条新内容 · 回到最新」胶囊与计数；没有「· 已暂停」旁注；上翻自动暂停后没有任何恢复入口；位置不按「任务+节点+尝试」记忆，切换页签/尝试后回到顶部。
- **原因**：状态机只保留布尔 following（C2）；新内容计数未实现（C5）；设计要求的记录区浮层（`node-detail.js:609-616`）未落地。
- **影响**：N12 三状态不成立；流式运行时用户上翻阅读会被新内容打断或丢失位置，也没有「回到最新」的一键入口。
- **建议**：加 `newCount/dirty/paused` 状态与胶囊（新条目计数；正文块增量记「有新内容」）；开关旁注「已暂停」；恢复最新时清零并回到底部；按 `task:node:attempt` 记忆 scroll/follow。
- **验证**：静态；滚动行为需GUI。
- **关联状态**：`n12-follow-on`, `n12-follow-off`, `n12-scrolled-new`

### NODE-07: 取消中 / 取消结果未知 / 回执未知状态链缺失
- **严重度**：P1
- **维度**：S / A / D
- **类别**：状态 / 交互 / 数据契约
- **设计依据**：`sources/node/COVERAGE.md:28-31`（取消请求 ≠ 已停止；取消中/已确认取消/取消结果未知/结果提交回执未知；「核对原操作」）；`sources/node/API-REQUIREMENTS.md:282-291`（核对只用原 requestKey，不提供重发）；`originals/node/assets/node-detail.js:347-348`（ATT_ST/RES_ST 含 cancelling/cancel-unknown/receipt-unknown）、`:371-394`（footHTML 核对入口）、`:497-507`（sessBanner 原操作说明）。
- **实现位置**：`packages/shared/src/domain/enums.ts:137-148`（NodeStatus 无 cancelling/cancel-unknown）；`NodeDetailPanel.tsx` 无取消/回执未知分支；`:817-822` 的 `ReceiptNotice` 只覆盖验收命令；`execution` prop（`:103`）未用于取消事实；`fetchOperationByKey`（`apps/web/src/api/workflow.ts:154`）未在节点面板使用。
- **差异**：尝试/节点无法表达「取消中」「取消结果未知」；没有「核对原操作」的只读入口，也没有「请求 ≠ 已停止」的横幅；设计 N08 三态、N09 全部不可达。
- **原因**：快照/attempt 状态枚举无取消请求与回执未知投影（C1，API-REQUIREMENTS §2.11「快照能否区分…未知」）；前端无分支与核对入口（C2/C5）。
- **影响**：用户停止步骤后看到「执行中/未知」，无法判断是否已停；也不能按设计「核对完成前不能操作」。
- **建议**：由 `execution.status`（stopping/stopped/unknown）+ pending cancel operation 投影取消事实；面板提供「核对原操作」只读按钮（沿用 `ReceiptNotice`/`operations.by-key` 模式）；结果提交回执未知时保持原记录并禁止重发。
- **验证**：静态；取消/未知场景需真实服务或故障注入。
- **关联状态**：`n08-cancelling`, `n08-cancelled`, `n08-cancel-unknown`, `n09-receipt-unknown`

### NODE-08: 断线重连 → 补读 → 缺口链条缺失
- **严重度**：P1
- **维度**：S / D / A
- **类别**：状态 / 数据契约 / 交互
- **设计依据**：`sources/node/COVERAGE.md:32-36`（断连/重连/补读中/补读完成/缺口）；`sources/node/API-REQUIREMENTS.md:293-302`（过时标记、CURSOR_EXPIRED、`gaps[]`、补读完成才去掉过时、「数据连接已恢复」与「模型仍在执行」分两句）、`:316-333`（fragmentId 去重、seq、缺口不得用空白掩盖）；`originals/node/assets/node-detail.js:227-267`（makeCur 的断连/补读剧本）、`:512-543`（过时/补读标签）。
- **实现位置**：`NodeDetailPanel.tsx:442`（连接格）、`:478-485`（一句「已断开：…重连后按 seq 只读补读」）；`:197-212`、`:486-491`（客户端按 seq 洞算缺口提示）；`apps/web/src/api/workflow.ts:604-638`、`:641-695`（SSE 断开后退回轮询）。
- **差异**：没有「重新连接」动作与「重新连接中 / 补读中 / 补读完成（已补读 N 条（去重 2 条））」三态；没有逐条「过时 · 截至 hh:mm:ss」标记；缺口只有一行 notice（非虚线分隔条、无时间区间、受影响工具不标「结果未知」）；没有「连接已恢复」与「模型仍在执行」两句分离。
- **原因**：输出读口没有 `gaps[]`/cursor/去重能力（C1，`NodeOutputResponse` 仅 hasMore/nextSeq，`contracts.ts:2216-2220`）；前端补读状态机与缺口渲染未实现（C2）。
- **影响**：N10 五态只有「已断开」半句；用户无法知道补读是否完成、缺口范围，也无法判断服务是否仍在执行；设计明确要求「不得用空白掩盖缺口」未达成。
- **建议**：服务补 gaps/cursor 后实现重连→补读→完成与去重事件；未接通前把 seq 洞提示改为设计缺口条（虚线、写明原因），断线时给已加载条目「过时 · 截至 hh:mm:ss」标记，并分开写连接与执行。
- **验证**：静态；断线/补读需GUI与真实服务事件。
- **关联状态**：`n10-disconnected`, `n10-reconnecting`, `n10-backfilling`, `n10-backfilled`, `n10-gap`

### NODE-09: 引用只有需求条目，缺正文 [1] 入口、精确代码行与节选定位
- **严重度**：P1
- **维度**：S / 结构 / D
- **类别**：结构 / 数据契约
- **设计依据**：`sources/node/COVERAGE.md:59-61`（引用原文段落、精确代码行、只有节选/摘要；「引用定位：第 42–48 行 · 来源版本 r3（不是最新文件）」）；`sources/node/API-REQUIREMENTS.md:259-269`（SourceRef 快照+定位、精确 revision、节选显著标注、摘要不画行号、正文 [1] 只能来自结构化 citations）、`:395`（§6 第 14 项）；`originals/node/assets/node-detail.js:759-794`（readerMain cite：章节/行号高亮/最新版本旁注）。
- **实现位置**：`packages/shared/src/domain/models.ts:816-841`（NodeDetail 只有 `requirementLinks`；`OutputFragment` 无 `citations`，`:803-814`）；`apps/web/src/pages/node/CitationSourceView.tsx:9-29`（需求条目原文/字符偏移定位）；`NodeDetailPanel.tsx:915-944`（来源需求入口）。
- **差异**：执行现场正文没有可点 [1]（无 citations 数据，也没有渲染）；引用阅读只有「需求条目原文/节选」，没有文档来源段落、没有代码行 anchor、没有「此文件已有更新版本 r5，引用仍指向 r3」旁注。
- **原因**：契约缺 `citations` 与通用 `source.read`（当前只有需求来源变体，`RequirementSourceResponse` `contracts.ts:775-786`）（C1）；阅读器结构缺代码行/段落定位（C4）。
- **影响**：N16 三态都不成立；模型正文中的 [1] 只是普通文本，用户无法从正文跳到来源；代码行引用与版本旁注完全缺失。
- **建议**：先让 `node.output` 片段携带结构化 `citations` 并渲染可点上标；`source.read` 支持 code/document ref + `anchor`（真实行号）+ `latestRevision`；阅读区展示定位徽标、行号高亮与版本旁注；摘要不伪造行号。
- **验证**：静态；需真实服务数据。
- **关联状态**：`n16-cite-source`, `n16-cite-code`, `n16-cite-excerpt`

### NODE-10: 尝试历史缺单次详情、切换、修订/代次与「查看」
- **严重度**：P1
- **维度**：S / 结构 / A
- **类别**：结构 / 交互 / 数据契约
- **设计依据**：`sources/node/COVERAGE.md:62-65`（列表项含定义修订与执行代次；单次详情的结果/验收/产物/错误只属于该次；‹› 切换 #1/#2/#3；「查看这次的执行现场」；历史只读）；`sources/node/API-REQUIREMENTS.md:223-257`；`originals/node/assets/node-detail.js:619-682`（attRow/attDetail）。
- **实现位置**：`apps/web/src/pages/node/NodeDetailPanel.tsx:582-620`（列表：序号/当前历史/时间/reasonSummary/状态）；`:622-697`（列表下方内联「所选尝试的结果与产出」）；无单次详情子视图、无 ‹›、无「查看这次的执行现场」。
- **差异**：列表缺定义修订/执行代次/「查看」；无单次详情子视图（结果/验收/产物/错误分区与导航）；历史验收归属不可读；面板头也无尝试选择（NODE-01）。
- **原因**：`AttemptListResponse` 缺 definitionRevision/executionGeneration/readability 等字段（C1，`contracts.ts:1645-1657`）；详情子视图与切换交互未实现（C4/C5）。
- **影响**：N17-list/history 的核心验收点大部分不成立；用户难以区分多次尝试的定义/代次差异，也无法按设计进入单次只读详情。
- **建议**：补「单次尝试详情」子视图（结果、验收、产物、错误/警告 + ‹› + 查看执行现场）；列表与服务 DTO 补修订/代次；历史态保持只读与「回到当前」。
- **验证**：静态；需真实服务多尝试数据。
- **关联状态**：`n17-list`, `n17-history`, `n17-history-session`, `n17-back-current`

### NODE-11: 概览页签内容与设计不同构（缺当前尝试/这一步做什么/谁来做/产出）
- **严重度**：P2
- **维度**：结构 / S / T
- **类别**：结构 / 文案
- **设计依据**：`originals/node/assets/node-detail.js:408-437`（overview：当前尝试卡（状态/起止/修订/代次/工具调用数/尝试次数/结果与验收）、这一步做什么、谁来做、产出·尝试 #N + 打开；不显示百分比）；`sources/node/COVERAGE.md:53`（N15 从概览「产出 · 打开」进入宽阅读区）、`:102`（偏离 3：不显示百分比）。
- **实现位置**：`NodeDetailPanel.tsx:429-437`（渲染 NodeOverview）、`:888-1000`（分组/摘要 banner、状态 facts、来源需求、为什么在这里、输入→输出、验收条款、读写资源）、`:761-815`（人工验收）、`:703-759`（直接后继）。
- **差异**：设计的「当前尝试」卡、「这一步做什么」「谁来做」「产出（含打开）」四个区块均未实现；产物入口只在「尝试与产出」页签（`:664-695`）；概览增加了设计没有的需求/依赖/IO/条款/资源区块（可视为扩展，但设计区块缺失优先）。
- **原因**：概览按产品自有信息架构实现（C4）；部分字段（修订/代次、角色名）在 DTO 中存在但未使用（`models.ts:446`、`:777`）。
- **影响**：N01-open 的概览内容与 N15「从概览产出打开」入口不成立；用户看不到节点角色与本次尝试的产出清单。
- **建议**：按设计补「当前尝试」卡（状态+起止+修订+代次+工具数+结果与验收+产出打开）与「这一步做什么/谁来做」；保留现有扩展区块作为其后信息。
- **验证**：静态。
- **关联状态**：`n01-open`, `n11-done`, `n15-art-text`, `n15-art-json`, `n15-art-code`

### NODE-12: 工具详情「无权限 / 缺能力 / 空结果」状态语义错误
- **严重度**：P2
- **维度**：S / T / D
- **类别**：状态 / 数据契约
- **设计依据**：`sources/node/COVERAGE.md:49-52`（N14 脱敏/无权限/缺能力/截断）；`sources/node/API-REQUIREMENTS.md:209-221`（`FORBIDDEN` 整区上锁保留摘要层；`CAPABILITY_UNAVAILABLE` 按 unknown 中性；空结果为中性）；`originals/node/assets/node-detail.js:685-708`（toolDetail 锁区/缺能力说明/摘要层）、`:716-718`（空结果中性）；`states.js:136-147`。
- **实现位置**：`apps/web/src/pages/node/ToolDetailView.tsx:22-41`：`query.error` → `ServiceNotice`（`:36`，标题「数据读取失败」warn，`apps/web/src/components/ServiceNotice.tsx:20-24`）；`revoked` → 一行说明（`:37`）；`content===null` → 「这条记录没有保存返回内容。」（`:37`）。
- **差异**：`FORBIDDEN` 与 `CAPABILITY_UNAVAILABLE` 都落入「数据读取失败」错误横幅（后者设计明确「这不是错误」）；无权限没有整区锁边界，分区按钮仍可点；空结果与未保留未按设计区分。
- **原因**：错误码未映射到设计状态（C6）；缺少缺能力/无权限的专用分支（C2）；契约无 `ContentSection` 空/未保留标志（C1）。
- **影响**：用户会把「服务尚未提供完整参数读取」当故障；无权限时缺少设计要求的锁定与摘要层边界；空结果被误读为「没保存」。
- **建议**：按错误码分支：`FORBIDDEN` → 锁区 + 保留摘要层；`CAPABILITY_UNAVAILABLE` → unknown 虚线中性说明；`content===null` 写「没有保存/未保留」，空串写「工具返回空结果」。
- **验证**：静态；需真实服务夹具（无权/缺能力）。
- **关联状态**：`n14-no-permission`, `n14-no-capability`, `n13-tool-empty`

### NODE-13: 产物阅读缺「不存在 / 失效 / 无权 / 未生成」的区分与阅读器结构
- **严重度**：P2
- **维度**：S / 结构 / D
- **类别**：状态 / 结构 / 数据契约
- **设计依据**：`sources/node/COVERAGE.md:53-58`（N15 各状态；「不存在 / 失效 / 无权 / 未生成」左栏可切换；版本失效见 n17）；`sources/node/API-REQUIREMENTS.md:259-269`、`:360-376`（NOT_FOUND/VERSION_SUPERSEDED/FORBIDDEN/NOT_RETAINED/UNSUPPORTED_FORMAT/READ_FAILED 各自 UI 处理）；`originals/node/assets/node-detail.js:759-794`（readerMain 产物各状态）、`:407`（AV 可用性徽标）。
- **实现位置**：`apps/web/src/pages/node/ArtifactDetailView.tsx:31`（`query.error` 统一 `ServiceNotice`）；`:32`（`preview===null` → 「此文件格式请下载后查看」）；`NodeDetailPanel.tsx:353-355`（仅 attempt 级撤权有整区锁）；错误来源见 `packages/engine/src/execution.ts:874-878`（FORBIDDEN/NOT_FOUND/STALE_TARGET）、`packages/server/src/http.ts:688-698`。
- **差异**：不存在、版本失效、无权都显示同一条「数据读取失败」横幅 + 错误码；没有「版本失效 → rN 已被替代，内容不再提供」「服务找不到这个产物」「无权读取」的独立状态；没有左栏产物/引用列表与面包屑；「正文尚未生成」在产物模型上不可表达（产物只在提交时捕获）。
- **原因**：错误码到设计状态映射缺失（C2/C6）；阅读器结构缺左栏列表（C4）；契约无 contentKind/anchor/latestRevision/exportable（C1，`ArtifactContentResponse` `contracts.ts:810-815`）。
- **影响**：N15-art-missing 的验收点不成立；用户无法判断产物为什么打不开，也不能在阅读区切换其他产物/引用。
- **建议**：按错误码输出设计状态文案与图标；补阅读区左栏列表与面包屑；`ArtifactRef` 之外补内容类型/最新版本/导出能力；不支持格式显示 mediaType+大小。
- **验证**：静态；需真实服务（缺失/失效/无权）。
- **关联状态**：`n15-art-text`, `n15-art-json`, `n15-art-code`, `n15-art-unsupported`, `n15-art-missing`, `n20-reader`

### NODE-14: 工具/产物阅读缺格式、分段、退出码等元信息与配色
- **严重度**：P2
- **维度**：T / V / 结构
- **类别**：样式主题 / 数据契约
- **设计依据**：`sources/node/COVERAGE.md:44-46`（JSON 三色；代码分段读取「已加载 1–200 行 · 共 312 行」；自动换行）；`:52`（truncated「服务只保留了前 64 KB」）；`:55`（「在已加载内容中查找」）；`sources/node/API-REQUIREMENTS.md:134-141`（`ContentSection.format/mediaType/sizeBytes/totalLines/range/nextCursor/truncation/exitCode`）；`originals/node/assets/node-detail.js:708-739`（FMT chip、`vw-foot` 行范围、退出码、截断横幅）、`:143-161`（JSON 类型着色）。
- **实现位置**：`apps/web/src/pages/node/ToolDetailView.tsx:38-40`；`apps/web/src/pages/node/ReadableText.tsx:8-12`（JSON 树无类型色、无全部展开/收起）、`:38-47`（代码无语法色、无行范围/格式/大小/退出码）；契约仅 `content/nextCursor/evidence.redacted/truncated`（`contracts.ts:788-798`）、`preview/truncated`（`:810-815`）。
- **差异**：区头没有格式/大小/行范围/退出码；截断只有「限定长度」；JSON 只有折叠树、无三色与展开收起；代码无语法高亮；「已加载 1–N 行 · 共 M 行」不可显示。
- **原因**：契约缺 `ContentSection` 元信息（C1）；查看器样式能力未实现（C7）。
- **影响**：长代码、大 JSON 场景可读性差；用户无法判断内容是否完整、命令是否失败（退出码）。
- **建议**：契约补 ContentSection 元信息后按设计增加区头/截断横幅/行范围/退出码；JSON 三色 + 全部展开/收起；代码语法色（可复用轻量 tokenizer）。
- **验证**：静态；渲染需GUI。
- **关联状态**：`n13-tool-text`, `n13-tool-json`, `n13-tool-code`, `n14-truncated`, `n15-art-code`

### NODE-15: 宽阅读区宽度/结构与设计不符
- **严重度**：P2
- **维度**：V / 结构
- **类别**：样式主题 / 结构
- **设计依据**：`sources/node/COVERAGE.md:71`（宽阅读区展开与返回）；`originals/node/assets/states.js:207-209`（checks：「宽 = min(960, 视口 − 导航 − 240)」「左侧可见画布，缩放值不变」「返回节点详情 / Esc 返回」）；`originals/node/assets/node-detail.js:795-803`（readerHTML：左列表 + 主区 + 面包屑 + 返回按钮）。
- **实现位置**：`apps/web/src/pages/node/node.css:295-297`（`.node-side-wide { width: min(900px, calc(100vw - 160px)) }`）、`:344-355`（≤960px 时改为绝对覆盖）；`NodeDetailPanel.tsx:351`、`:356-386`（reader = 头 + 单子视图，无左栏列表/面包屑）；`:400-408`（面板头「宽阅读」按钮可把普通页签拉宽）。
- **差异**：宽度公式不符（900 vs min(960, 视口−导航−240)），窄视口覆盖画布（设计要求左侧仍露出画布）；阅读区缺少左栏产物/引用列表与面包屑；普通页签也能切 900px 宽（设计只有阅读区扩张）；阅读区是整体替换面板而非「面板扩展」。
- **原因**：布局实现自定义（C7）；阅读器结构简化（C4）；多了设计外控件（C4）。
- **影响**：N20-reader 三条验收点不成立；产物/引用之间切换必须退出重进；小屏阅读体验与设计不符。
- **建议**：按设计公式设置宽度并保证左露画布；补左栏列表与面包屑；「宽阅读」开关仅用于阅读区（或移除）。
- **验证**：需GUI（1440/1280/1024 + 四主题）。
- **关联状态**：`n20-reader`, `n15-art-text`, `n16-cite-source`

### NODE-16: 键盘与可访问性不符（页签方向键、焦点归还、记录区 role）
- **严重度**：P2
- **维度**：K
- **类别**：可访问性
- **设计依据**：`sources/node/COVERAGE.md:72`（键盘操作）；`originals/node/assets/states.js:210-212`（checks：焦点环、Tab 顺序、←/→ 切页签、Esc 先关阅读区再关子视图）；`originals/node/assets/node-detail.js:997-1009`（Esc 层级与 ArrowLeft/Right 页签切换）、`:857-863`（阅读区打开后聚焦返回按钮）。
- **实现位置**：`NodeDetailPanel.tsx:142-154`（Esc 仅处理 reader/wide）、`:411-424`（页签按钮无方向键/roving tabindex/aria-controls）；`:493-502` 记录区无 `tabIndex`/`role="log"`/`aria-live`（对照设计 mock `node-detail.js:556-563`）；阅读区打开/关闭无焦点管理（`:356-386`）。
- **差异**：←/→ 不切页签；Esc 不能关闭工具子视图（阅读区之外无 Esc）；记录区不是可聚焦的 log 区域；阅读区打开不聚焦返回按钮、关闭不归还焦点；无焦点环演示。
- **原因**：组件未实现设计要求的键盘规格（C8）。
- **影响**：键盘用户无法完成「Tab 进记录区、方向键切页签、Esc 逐层返回」的设计路径（N20-keyboard 验收点）。
- **建议**：页签 roving tabindex + ←/→/Home/End；Esc 栈（阅读区→子视图→面板）；打开阅读区聚焦返回按钮、关闭归还触发元素；记录区 `tabIndex=0 role=log aria-live=polite`。
- **验证**：需GUI（键盘）。
- **关联状态**：`n20-keyboard`, `n01-open`

### NODE-17: 面板无页脚，业务动作与提示分散/缺失
- **严重度**：P2
- **维度**：结构 / A
- **类别**：结构 / 交互
- **设计依据**：`originals/node/assets/node-detail.js:371-394`（footHTML：当前尝试业务动作 + 提示；历史→「回到当前尝试」；失败/取消→「恢复这一步」；manual→「退回修改/验收通过」；done→「查看产出」；loading/无权/断连提示）；`originals/node/assets/states.js:23`（checks：「页脚只有当前尝试的业务动作」）。
- **实现位置**：`apps/web/src/pages/node/NodeDetailPanel.tsx` 无 `.side-foot`；验收动作在概览 `:761-815`；推进动作在概览 `:703-759`；「回到当前尝试」在 session hist-bar `:450-464`；无「查看产出」「恢复这一步」「读取完成前不能操作」「连接恢复后才能操作」等页脚提示。
- **差异**：设计页脚是动作与状态的固定区域；实现把动作分散到概览/历史条，且失败/取消态没有恢复入口，done 态没有查看产出入口。
- **原因**：结构迁移（C4）与交互位置变化（C5）。
- **影响**：N01-open/N07/N08/N11/N17 的页脚检查点不成立；用户在不同页签看到的可用动作不一致。
- **建议**：恢复固定页脚，按当前尝试状态渲染动作区（含禁用原因、历史只读脚注、恢复/查看产出入口），验收与推进动作至少从页脚可达。
- **验证**：静态。
- **关联状态**：`n01-open`, `n07-failed-partial`, `n08-cancelled`, `n11-manual-accept`, `n11-done`, `n17-history-session`

### NODE-18: 关闭详情丢失选中、不恢复页签/阅读位置
- **严重度**：P2
- **维度**：A / R / S
- **类别**：交互
- **设计依据**：`sources/node/COVERAGE.md:16`（N01-closed）；`originals/node/assets/states.js:24-26`（checks：关闭后缩放仍 95%、节点保持选中描边、点空白才清除选中；再点它回到上次页签与阅读位置）。
- **实现位置**：`apps/web/src/pages/task/TaskCanvasPage.tsx:203-205`（`closeNode` 删除 `?node`）；`:638`（`selectedNodeId={nodeId}`）；`apps/web/src/flow/FlowCanvas.tsx:106`（选中来自 props）；`NodeDetailPanel.tsx:132-140`（nodeId 变化重置 tab/attempt/reader）。
- **差异**：关闭按钮清除 URL 参数 → 画布选中同步清除；重新打开总回到执行现场，不恢复上次页签/滚动。视口（FlowCanvas 内部状态）推测保持。
- **原因**：选中态与「面板是否打开」共用同一个 URL 参数（C5）；没有按节点记忆页签/滚动（C2）。
- **影响**：N01-closed 的选中检查点直接失败；用户关闭详情后要继续看同一节点必须重新点，且丢失阅读位置。
- **建议**：选中态与打开态分离（关闭保留 selectedNodeId 而不渲染面板，点空白才清除）；内存记忆 `node → {tab, attempt, scroll}`。
- **验证**：需GUI（视口保持需实测）。
- **关联状态**：`n01-closed`

### NODE-19: 加载/空态结构与文案不符
- **严重度**：P2
- **维度**：S / T
- **类别**：状态 / 文案
- **设计依据**：`sources/node/COVERAGE.md:17-18`；`originals/node/assets/states.js:28-33`（checks：骨架不冒充正文、事实条「读取中」、空态「模型还没有输出正文」、尝试：执行中）；`originals/node/assets/node-detail.js:549-555`（txBodyHTML：加载骨架 + 空态「模型还没有输出正文…尝试 #3 已于 10:42:01 开始…这不是错误，也不是完成」）。
- **实现位置**：`NodeDetailPanel.tsx:334-346`（整面板 `SkeletonText`）；`:503-505`（EmptyState「还没有执行记录 / 服务返回空记录；这里不会补写演示正文。」）。
- **差异**：加载态没有保留面板头/页签/事实条「读取中」，整面板骨架也不符合「骨架只在正文区」；空态文案不是设计原文，且不说明「尝试已开始」、无法区分未执行。
- **原因**：状态分支按产品通用骨架/空态实现（C2/C3）。
- **影响**：N02 两状态的画面与语气不成立；用户可能把「模型未输出」理解为「服务无记录」。
- **建议**：加载态保留壳体与事实条读取中、仅正文骨架；空态按设计写「模型还没有输出正文」并显示尝试开始时间与「不是错误也不是完成」。
- **验证**：静态。
- **关联状态**：`n02-loading`, `n02-empty`

### NODE-20: 公开推理摘要缺「未提供」说明，渲染分支不符合设计
- **严重度**：P2
- **维度**：S / T / D
- **类别**：状态 / 数据契约 / 文案
- **设计依据**：`sources/node/COVERAGE.md:23-24`（标签「公开推理摘要 · 由模型服务提供」、默认折叠 3 行、无摘要时不渲染占位只在「关于此记录」写一句）；`sources/node/API-REQUIREMENTS.md:330`（只有 provider 实际公开、允许展示、有权时才下发；缺失原因走 capabilities）；`originals/node/assets/node-detail.js:544-548`（aboutHTML 写「本次未提供公开推理摘要」）、`:523-527`（rsn 折叠块）。
- **实现位置**：`packages/engine/src/plan.ts:502`（capability 固定 `none_in_attempt`）；`packages/engine/src/execution.ts:1169`（不产出该类别）；`NodeDetailPanel.tsx:70-81`（标签）、`:548-554`（与正文同渲染）；前端未读取 `capabilities.publicReasoningSummary`。
- **差异**：`reasoning` 状态无法出现（服务缺口，设计允许的诚实降级）；`no-reasoning` 状态缺「本次未提供公开推理摘要」说明与「关于此记录」；即使未来提供，也只会以普通段落显示（无折叠/3 行/左竖线/「由模型服务提供」标签）。
- **原因**：producer 与能力投影缺失（C1）；前端未消费能力、未实现折叠块（C2/C3）。
- **影响**：N05 两状态验收点不成立；用户无法知道「没有摘要」是能力缺失还是模型未产生。
- **建议**：先补「本次未提供公开推理摘要」一句（读 capability）；接通后按设计做独立折叠块（默认 3 行、muted、左竖线、标签），无占位。
- **验证**：静态；provider 能力需模型/真实服务确认。
- **关联状态**：`n05-reasoning`, `n05-no-reasoning`

### NODE-21: 结果与验收缺「结果版本 + 策略版本」绑定与历史替代标记
- **严重度**：P2
- **维度**：D / T
- **类别**：数据契约
- **设计依据**：`sources/node/COVERAGE.md:37-39`（验收通过（r3 · 策略 v3）/未通过/待人工验收）；`:63`（#2 的 r2 验收未通过并绑定策略 v3；当前有结果时标「已被尝试 #3 的结果 r3 替代」）；`sources/node/API-REQUIREMENTS.md:235-245`（`acceptance.subjectResultRevision == result.resultRevision` + `policyRevision`；历史失败永不显示通过徽标）；`originals/node/assets/node-detail.js:645-682`（attDetail 绑定行）。
- **实现位置**：`NodeDetailPanel.tsx:636-641`（校验状态 + 结果修订）；`:761-815`（人工验收，节点级审计）；`packages/shared/src/api/contracts.ts:1547-1553`（`NodeAcceptanceView` 只有 nodeId/state/verdictAt/note/requestKey）；`packages/engine/src/plan.ts:506-507`、`:512-515`（验收不改变执行状态）。
- **差异**：结果修订号可显示，但验收没有绑定结果修订/策略版本；人工验收与「校验状态」并列展示，非设计「结果与验收」单一格；历史尝试的验收归属与「已被替代」标记不可呈现。
- **原因**：契约缺 `policyRevision`/`subjectResultRevision` 与按结果版本的验收归属（C1）；产品把人工验收定义为审计事实（与设计「验收作为完成条件」语义不同，需设计/Lead 确认口径，见「未覆盖/说明」）。
- **影响**：N11 三态与 N17-history 的验收绑定验收点不成立；用户无法核对「这条验收对应哪一版结果/哪一版策略」。
- **建议**：服务补策略版本与结果版本绑定（或明确人工验收绑定所选 attempt 的结果修订）；UI 在结果与验收区显示「结果修订 rN · 策略 vN」，历史失败/被替代显示标记。
- **验证**：静态；需真实服务。
- **关联状态**：`n11-done`, `n11-accept-rejected`, `n11-manual-accept`, `n17-history`

### NODE-22: N18「记录未保留」与「分页失败」不可达
- **严重度**：P2
- **维度**：S / A / D
- **类别**：状态 / 数据契约 / 交互
- **设计依据**：`sources/node/COVERAGE.md:66-67`（历史未保留；加载更早失败保留已加载 + 重试）；`sources/node/API-REQUIREMENTS.md:223-233`（attempts.list 的 retention/nextCursor；NOT_RETAINED 文案）；`originals/node/assets/node-detail.js:629-643`（retention 虚线说明、分页失败 banner + 重试）。
- **实现位置**：`packages/shared/src/api/contracts.ts:1645-1657`（`AttemptListResponse` 无 retention/nextCursor/readability）；`packages/server/src/http.ts:709-726`（一次返回全部）；`NodeDetailPanel.tsx:873`（错误仅一行 hint）。
- **差异**：没有保留范围说明、没有「加载更早的尝试」、没有分页失败 banner/重试；`NOT_RETAINED` 无数据来源。
- **原因**：契约缺 retention 与分页（C1）；前端无分页/保留分支（C2）。
- **影响**：N18 两状态不可达；长任务用户无法知道记录保留范围，也无法恢复加载。
- **建议**：服务补 retention + 游标；UI 加保留说明、加载更早、分页失败保留已加载 + 重试；未保留的尝试详情显式说明而非空白。
- **验证**：静态；需真实服务。
- **关联状态**：`n18-not-retained`, `n18-page-fail`

### NODE-23: 回到当前尝试无加载/未知态，可能用空态冒充
- **严重度**：P2
- **维度**：S
- **类别**：状态
- **设计依据**：`sources/node/COVERAGE.md:65`（回到当前（当前仍在加载））；`originals/node/assets/states.js:186-188`（checks：「正在读取尝试 #3 的最新记录」「事实条为未知 / 读取中」，不用历史内容顶替）；`sources/node/API-REQUIREMENTS.md:255`（回到当前但数据未补齐 → 加载或未知）。
- **实现位置**：`NodeDetailPanel.tsx:454-462`（仅 `setSelectedAttemptId(undefined)`）；`:186`（fragments 回退 `detail.output.fragments`）；`:503`（空则空态）；无 loading 分支。
- **差异**：切回当前时直接渲染 detail/缓存或空态，没有「正在读取尝试 #N 的最新记录」与事实条读取中。
- **原因**：切换等待态缺失（C2）。
- **影响**：N17-back-current 验收点不成立；用户可能把「尚未读回」误认为「没有记录」。
- **建议**：切回当前时冻结事实条为读取中并显示设计文案，直到 detail/output 返回；不用历史内容顶替（当前已满足不顶替）。
- **验证**：静态。
- **关联状态**：`n17-back-current`

### NODE-24: 撤权清理范围不足，仍显示事实条/尝试摘要/验收动作
- **严重度**：P2
- **维度**：D / S
- **类别**：状态 / 数据契约
- **设计依据**：`sources/node/COVERAGE.md:69`（撤权「事实条与记录都清除」「没有业务动作」）；`sources/node/API-REQUIREMENTS.md:304-312`、`:366-367`（REVOKED：清除内容、面板锁定、无业务动作）；`originals/node/assets/node-detail.js:556-557`（session revoked lock 文案「你已无权查看此尝试的记录」）、`:330`（situ 撤权说明）。
- **实现位置**：`NodeDetailPanel.tsx:178-185`（清缓存）、`:353-355`（阅读区整区锁）、`:440`（正文一句「你没有查看这次尝试正文的权限。」）；事实条 `:441-447`、尝试列表 `:582-620`、概览 `:429-437`、验收动作 `:793-809` 未清理/未禁用。
- **差异**：撤权后事实条与尝试列表仍显示；验收/推进动作仍可用；没有设计文案「你已无权查看此尝试的记录」与「没有业务动作」；清理政策（立即清除/遮挡）未标注。
- **原因**：清理只覆盖正文与阅读区缓存（C2）；撤权范围未映射到全部面板区域（C6）。
- **影响**：N19-revoked 检查点不成立；用户可能基于残留状态继续操作。
- **建议**：撤权时清空事实条与记录区、禁用验收/推进并显示设计文案；保留画布服务状态；明确清理政策。
- **验证**：静态；撤权场景需真实服务（E15 已有夹具证据，但当前代码需按新结论复核）。
- **关联状态**：`n19-revoked`

### NODE-25: 晚到响应无可见提示
- **严重度**：P3
- **维度**：T / S
- **类别**：状态 / 文案
- **设计依据**：`sources/node/COVERAGE.md:68`（「细提示“已忽略属于上一个节点的晚到内容”」）；`originals/node/assets/states.js:197-199`；`sources/node/API-REQUIREMENTS.md:162`（晚回规则）。
- **实现位置**：`apps/web/src/api/workflow.ts:130-135`（身份不一致抛错）；`NodeDetailPanel.tsx:156`（detail 身份校验）；无提示 UI。
- **差异**：晚回内容确实被丢弃（安全），但没有设计要求的细提示。
- **原因**：提示分支缺失（C2/C3）。
- **影响**：数据正确性不受影响；用户不知道旧节点内容被忽略。
- **建议**：切节点后若丢弃过晚到响应，在记录区顶部显示一次性细提示。
- **验证**：静态；真实晚回时序需GUI。
- **关联状态**：`n19-late`

### NODE-26: 文案/术语漂移（正文标签、空态、脱敏、截断、下载）
- **严重度**：P3
- **维度**：T
- **类别**：文案
- **设计依据**：`sources/node/COVERAGE.md:44-46`；`:49`（脱敏 chip「已隐藏 · 服务端脱敏」）；`:52`（「内容已截断：服务只保留了前 64 KB」）；`:56`（不支持格式文案）；`:58`（下载状态）；`originals/node/assets/node-detail.js:509`（TOOL_ST）、`:512-543`（块标签「模型正文」「公开推理摘要 · 由模型服务提供」）、`:709-739`（截断/退出码/空结果）。
- **实现位置**：`NodeDetailPanel.tsx:70-81`（「模型陈述 / 工具活动 · 外部资料 / 服务事实」）；`ToolDetailView.tsx:37-39`（「这条记录没有保存…」「敏感字段已隐藏。」「内容已截断：服务只保留了限定长度的内容。」）；`ArtifactDetailView.tsx:32`、`:35`（「此文件格式请下载后查看」「产物已保存/已取消保存」）。
- **差异**：正文/工具/服务事件标签采用其他区域的词表（模型陈述/外部资料），设计为「模型正文 / 公开推理摘要 / 工具调用 / 服务事件」；脱敏、截断、下载文案与设计原文不同。
- **原因**：术语未对齐设计/`labels.ts`（C3）。
- **影响**：术语不一致影响理解（尤其「模型陈述」与「公开推理摘要」）；局部文案无法直接通过验收。
- **建议**：建立节点区域词表并对齐设计原文；共用标签常量。
- **验证**：静态。
- **关联状态**：`n03-stream`, `n13-tool-text`, `n14-redacted`, `n14-truncated`, `n15-art-unsupported`, `n15-download`

### NODE-27: 正文块无复制/中断提示，工具卡交互细节缺失
- **严重度**：P3
- **维度**：A / T
- **类别**：交互 / 文案
- **设计依据**：`originals/node/assets/node-detail.js:512-543`（正文/摘要块复制按钮；失败时「正文在此中断 · 未完整」；工具卡整卡 `data-tool` 可点）；`sources/node/COVERAGE.md:27`（「正文在此中断」）。
- **实现位置**：`NodeDetailPanel.tsx:548-554`（无复制按钮、无中断提示）；`:513-539`（只有「查看工具详情」按钮可点，整卡不可点）。
- **差异**：正文/摘要无块级复制；失败时无「正文在此中断」；工具卡需点按钮而非整卡。
- **原因**：细节交互未实现（C2/C5）。
- **影响**：N03/N07/N13 的部分检查点缺失（不影响主流程）。
- **建议**：补块级复制（不含状态/隐藏内容）、失败中断行、工具卡整卡点击。
- **验证**：静态。
- **关联状态**：`n03-stream`, `n07-failed-partial`, `n13-tool-text`

### NODE-28: 工具详情头部细节缺失 + 设计外的面板「宽阅读」控件
- **严重度**：P3
- **维度**：T / 结构
- **类别**：文案 / 结构
- **设计依据**：`originals/node/assets/node-detail.js:685-708`（工具名+来源标签、调用 ID+复制、所属尝试、状态、开始/结束/时长、来源说明）；`sources/node/README.md:38`（480 右侧面板）；`sources/node/COVERAGE.md:71`（只有阅读区有展开/返回）。
- **实现位置**：`apps/web/src/pages/node/ToolDetailView.tsx:31-33`（有名称/尝试/状态/开始/时长；缺来源标签、结束时间、调用 ID 复制）；`NodeDetailPanel.tsx:400-408`（面板头「宽阅读」按钮可把普通页签拉宽到 900px，设计无此控件）。
- **差异**：工具详情元信息不完整；普通页签存在设计外的宽度切换。
- **原因**：细节未实现（C3/C4）；实现自行扩展了宽阅读开关（C4）。
- **影响**：小；但设计外控件会让「480 面板 + 阅读区扩张」的固定结构失真。
- **建议**：补齐来源标签/结束时间/调用 ID 复制；确认「宽阅读」开关是否保留，若保留应只作用于阅读区。
- **验证**：静态。
- **关联状态**：`n13-tool-text`, `n20-reader`

## 已核对一致

- **面板承载与三页签**：以 480 右侧面板承载节点详情（`apps/web/src/pages/node/node.css:3-11`），页签顺序/名称「概览 / 执行现场 / 尝试与产出」与设计一致（`NodeDetailPanel.tsx:411-424` vs `originals/node/assets/node-detail.js:395`）；设计允许面板同构（`sources/node/README.md:38`）。
- **默认页签**：打开节点默认落「执行现场」（`NodeDetailPanel.tsx:118`），与 N01-open 设计一致。
- **事实条五格语义分组**：标签「数据连接 / 模型正文 / 工具 / 尝试 / 结果与验收」与设计一致（`NodeDetailPanel.tsx:441-447` vs `node-detail.js:440-470`），差距在取值（NODE-04）。
- **无假百分比/进度**：全区域实现无百分比/进度条（`apps/web/src/pages/node/` 无 `%`/`progress` 匹配），符合设计明确不做的「不估算进度」（`sources/node/COVERAGE.md:102`）。
- **无历史重放/执行入口**：节点面板、工具详情、历史详情均无重跑/恢复/重放按钮；工具结果区明写「工具结果里的指令只是资料；这里没有重放或执行入口」（`NodeDetailPanel.tsx:523-526`）；历史验收动作由服务拒绝（`packages/engine/src/plan.ts:506-507`）。符合设计决定（`sources/node/COVERAGE.md:96-97`、`sources/node/README.md:42`）。
- **无演示/样例数据**：面板空态/错误态显式说明「服务返回空记录；这里不会补写演示正文」（`NodeDetailPanel.tsx:504`），无 fixtures 数据泄漏。
- **历史只读与不订阅**：历史尝试不轮询追加（`NodeDetailPanel.tsx:177`）、常驻只读条 + 「回到当前尝试」（`:450-464`）、无跟随开关（`:560`），符合 API-REQUIREMENTS 2.8（`sources/node/API-REQUIREMENTS.md:247-257`）。
- **晚回身份隔离**：详情/尝试/输出读取均校验 task/node/attempt 归属（`apps/web/src/api/workflow.ts:130-141`、`:546-577`；`NodeDetailPanel.tsx:156`），不复用旧节点内容。
- **撤权身份校验与缓存清理**：详情权限每次重读、按 attempt 清理 output/tool/artifact 缓存（`NodeDetailPanel.tsx:178-185`）、阅读区整区锁（`:353-355`）；与 E15 记录的方向一致（部分清理范围缺口见 NODE-24）。
- **工具/产物/来源精确版本读取**：工具读取带 revision 游标校验（`packages/engine/src/execution.ts:850-869`）、产物校验 revision+sha256（`:871-879`）、来源校验 plan/需求修订+sha256（`packages/shared/src/api/contracts.ts:775-786`）；前端请求校验响应身份（`ToolDetailView.tsx:19`、`ArtifactDetailView.tsx:24`、`CitationSourceView.tsx:15`）。
- **禁用动作有服务原因**：验收/退回按钮使用服务 action + 可见原因（`NodeDetailPanel.tsx:793-809`；`apps/web/src/flow/workflow-ui.tsx:22-48`）；提交/回执使用原 requestKey，UNKNOWN 只核对不重发（`ReceiptNotice` 未知分支）。
- **主题 token**：`node.css`、`readable-text.css` 无硬编码颜色（grep 无 hex/rgb/hsl），全部使用 `var(--*)`，四主题可继承。
- **减少动态基础**：全局 `prefers-reduced-motion` 把动画/过渡压到 0（`apps/web/src/styles/ds.css:327`）；记录区无光标动画/平滑滚动实现，静态推断基本符合 N20-reduced（实际观感需GUI）。
- **搜索只在已加载内容**：阅读器搜索框文案「在已加载内容中查找」（`ReadableText.tsx:40`）并提示「已加载内容中有 N 行匹配。搜索期间显示原文」（`:46`），符合设计口径。
- **复制不含脱敏值**：工具证据在持久化前由服务端脱敏（`packages/engine/src/tool-evidence.ts:7-13`、`:38`），复制走服务返回文本，不含原值。
- **设计明确不做项未被违背**：历史无重放（无入口）；无假百分比（无进度）；公开推理摘要不在缺失时渲染占位（记录流无空摘要块）。仅缺「未提供」说明（NODE-20）。

## 需 GUI / 运行验证

1. **60 状态 × 四主题视觉**：1440/1280/1024 三档宽度下 480 面板、900 宽阅读区、`node-side-wide` 断点（`node.css:295-297,344-355`）与四主题 token 渲染；本报告未渲染页面。
2. **N01-closed 视口保持**：关闭/重开节点详情后画布缩放（设计 95%）与平移是否保持（FlowCanvas 非受控，静态只能推断）。
3. **流式追加观感**：SSE 事件 → `invalidateQueries` → 2s 轮询重读的追加节奏、上翻是否被拉回（当前跟随阈值 `<36px`，设计 80px）、长内容滚动性能。
4. **N12 交互**：上翻自动暂停、开关关闭后只计数、胶囊出现/点击回到底部并恢复跟随（当前胶囊缺失，需修复后 GUI 复验）。
5. **N20 阅读器与画布**：打开/关闭宽阅读区不重建画布、`.cv-world` transform 前后一致、左侧仍露画布、Esc 返回焦点原页签。
6. **N20 键盘**：Tab 顺序（画布→面板头→页签→记录→页脚）、←/→ 切页签、Esc 层级、焦点环可见性（当前页签方向键与焦点归还缺失，修复后需键盘实测）。
7. **减少动态**：`prefers-reduced-motion` 下光标/平滑滚动/状态动画的实际表现（静态只能确认全局降级规则存在）。
8. **真实服务故障态**：取消中/取消未知/结果提交回执未知/断线重连补读/撤权中间态，需要故障注入或真实事件；E15 已提供撤权夹具证据，但取消与补读未覆盖。
9. **真实模型/服务能力**：公开推理摘要是否由 provider 提供（当前 capability 固定 `none_in_attempt`）；输出保留期/补读游标/策略版本是否存在（决定 N05/N10/N18/N21）。
10. **Electron 原生下载**：`exportArtifact` 保存/取消/失败对话框（E14 已有证据，本批未复跑；浏览器回退路径可静态确认）。

## 未覆盖 / 说明

- **未逐张比对设计 PNG**：本报告依据 `COVERAGE.md`/`README.md` 文本规格、`node-detail.js` 渲染逻辑与 `fixtures.js` 样例判定，未读取并逐像素比对 `sources/node/design/*.png`；像素级视觉与四主题对照留 GUI 批。
- **依赖真实能力的条目**：N05-reasoning、N10-backfilling/backfilled、N18-not-retained、N21 策略版本、N08/N09 取消与回执未知，当前服务/契约无数据源或只有占位；已按 C1/设计缺口记录，未写成「已实现」。
- **设计语义冲突待确认**：产品把人工验收定义为「审计事实，不改变执行状态、下游推进或任务级验收」（`NodeDetailPanel.tsx:783-812`、`packages/engine/src/plan.ts:506-507`），而设计把验收作为步骤完成的组成部分（N06「验收通过前不显示已完成」、N11「完成＝结果提交+验收通过」）。本报告按设计判定为差异（NODE-04/21），但需 Lead/设计确认是产品决策还是待修；若确认是决策，应按 C9 降级处理。
- **任务页整体边界**：任务画布页头、情况条、执行面板、自动推进、冻结计划/审计记录等属 `07-tasks-task.md` 区域；本报告只覆盖节点详情面板及其子视图，`focusAcceptance` 入参的「去验收」定位行为未展开审计。
- **N19-project**：产品的项目切换在任务路由之外（离开画布即卸载面板），设计中的「同一画布切项目」是原型控制条辅助能力，按 C9/原型辅助处理，不记缺陷。
- **旧文档线索（C10，报 Lead 统一记录，不占主清单）**：
  - `docs/review/frontend-gaps.md:41`（F-20「节点输出接口 terminal 恒为 false，UI 永远等待正文」）已过时：当前 `packages/server/src/http.ts:313-316,735` 用 `isTerminalOutputStatus` 返回真值，`NodeDetailPanel.tsx:443` 也消费 terminal。
  - `docs/design-coverage.md:173`（「服务无产物正文/工具增量接口处降级」）已过时：现有 `readTool`/`readArtifact` 读取接口（`packages/server/src/http.ts:686-698`、`packages/engine/src/execution.ts:850-879`）与本报告审计的 ToolDetailView/ArtifactDetailView 已接通。
  - `docs/review/design-parity.md:107-113`（§2.6 称宽阅读区/工具详情/产物阅读/引用均未实现）已过时：当前代码已实现子视图与宽阅读区（但边界状态与结构仍有 NODE-12~15 的偏差）。
- **E14/E15 只作线索**：`docs/review/node-artifacts-2026-10-20.md`、`docs/verification/2026-10-20-node-detail-read.md` 的结论仅用于定位方向，本报告全部条目均以当前 main 代码复核后记录；其截图与真实 GUI 证据未在本批复跑。
