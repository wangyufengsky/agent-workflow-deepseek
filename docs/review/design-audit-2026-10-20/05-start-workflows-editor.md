# P08 开始任务 / P09 流程目录 / P10 流程画布 前端设计一致性审计

> 基线：main @ `3f6f9b2`（2026-10-20）。范围：P08 `/start`（设计 `originals/main/pages/start.html` 9 状态 + `originals/planning/start.html` pe01）、P09 `/workflows`（`originals/main/pages/workflows.html` 11 状态，含 v5 `detail-planning`）、P10 `/workflows/:id/edit`（`originals/main/pages/workflow-editor.html` 页面内 `DS.mount` 7 状态）；实现 `apps/web/src/pages/start/`、`apps/web/src/pages/workflows/`。审计方式：静态代码 vs 只读设计稿；未运行 GUI 的 V/K 类结论标注“需GUI”，不冒充已验收。

## 概览

| 页面 | 设计状态数 | 已逐项核对 | P0 | P1 | P2 | P3 | 结论 |
|---|---|---|---|---|---|---|---|
| P08 开始任务（start.html 9 + planning pe01） | 10 | 是 | 0 | 1 | 5 | 4 | 与设计有偏差（三段/卡片/版本核对/回执主链已对齐；未知状态、项目错误态、模板方法混入等残留） |
| P09 流程目录（workflows.html 11） | 11 | 是 | 0 | 0 | 7 | 4 | 与设计有偏差（目录/详情/使用记录/规划只读节已实现；未选中态、加载更多、并行步骤链、新建流程路径缺失或不同） |
| P10 流程画布（workflow-editor.html 7） | 7 | 是 | 0 | 0 | 3 | 7 | 基本对齐（即开即编辑/requires 图/撤销重做/检查定位/保存未知与冲突/内置只读已实现；画布骨架与侧栏形态、空态引导、人工职责等偏差） |

**最重要的问题（≤5 条）**

1. `P08-01`（P1）开始页没有把「请求已发出但没有回执」当成设计的 unknown 状态处理：无锁定、无持久原请求号、无原请求核对入口，传输失败被红色横幅写成“形成需求草稿失败/未创建任务”。
2. `P10-01`（P2）流程画布未采用设计的整页 canvas 骨架（`canvas-page` + 画布内 480 侧栏），而是普通 1120 页面 + 520 覆盖式抽屉，画布被遮挡且宽度不符；同仓库需求/任务画布已用正确骨架。
3. `P09-05`（P2）内置流程详情把每个步骤都渲染成「未指定职业」警告徽标（服务执行实际按步骤类型回退默认职业），设计显示具体职业；自定义步骤直接外露原始 roleId。
4. `P09-06`（P2）「新建流程」路径与设计不同：设计直接进入空画布（未命名流程·尚未保存），实现先弹窗填名称/说明/规划支持并立即创建两个固定步骤，且「创建并编辑」创建后并未进入编辑器。
5. `P09-01`（P2）流程详情永远自动选中第一项、没有设计稿的关闭按钮与 `nodetail` 全宽列表态，`list` 状态不可达。

## 状态覆盖

### P08 开始任务（`originals/main/pages/start.html` + `originals/planning/start.html` pe01）

| mock state | 设计名称 | 实现判定 | 证据（实现文件:行 / 无） | 说明 |
|---|---|---|---|---|
| `ready` | 空白 | 已实现（口径差异） | `apps/web/src/pages/start/StartPage.tsx:154-168`、`:343-617` | 项目/目标为空、流程方法自动预选默认方法（pe01 口径默认选中）；主稿 ready 要求项目/流程均未选，见“设计冲突 C9”。 |
| `filled` | 已填写 | 已实现 | `StartPage.tsx:394-432`（项目卡）、`:435-483`（目标+自动命名）、`:485-517`（方法卡）、`:520-613`（总结卡） | 自动命名 60 字符、空白折叠与设计一致（`:32-35`）。 |
| `reading` | 核对流程版本中 | 已实现 | `StartPage.tsx:161-162`、`:185`、`:509-511` | 版本 GET 进行中禁用提交并写原因；无设计稿的 small spinner 图标。 |
| `flow-error` | 流程版本读取失败 | 部分 | `StartPage.tsx:515`（`ServiceNotice` 重试）、`:186` | 有错误分支与重试；但版本**过期**（STALE_TARGET）无重新读取入口，见 `P08-06`。 |
| `project-error` | 项目列表读取失败 | 缺失（形态不同） | `StartPage.tsx:263-280`（整页 `ServiceNotice`） | 设计 `start.html:133` 为项目段内错误 + 保留已填目标；实现整页替换、三段表单与已写目标不可见，见 `P08-02`。 |
| `submitting` | 提交中 | 部分 | `StartPage.tsx:206-234`、`:583-602` | 按钮进入 busy 文案；项目/流程/目标/名称未按设计 `locked` 锁定，见 `P08-03`。 |
| `unknown` | 结果未明（锁定） | 部分 | `StartPage.tsx:353`（`ReceiptNotice`）、`:177-189`、`:360-369` | 服务回执 `unknown` 时有按原请求号核对；传输失败/刷新后的未知无锁定、无核对入口，见 `P08-01`。 |
| `accepted` | 草稿已形成 | 部分 | `StartPage.tsx:282-341`（仅 `receipt.status==='succeeded'` 进入回执页）、`:353` | 服务端同步返回 succeeded 时等价设计回执页；若回执为 `accepted` 只显示“请求已受理，等待服务回执”且无结算推进，见 `P08-10`。 |
| `handoff-error` | 已形成但打开失败 | 部分 | `StartPage.tsx:282-335` | 仅“回执 succeeded 但缺 task.id”时显示同义标题，主操作「打开原草稿」被禁用（`:324-327`）；设计 `start.html:216` 该按钮应可用。 |
| pe01 | 开始任务 · 普通方法选择 | 部分 | `StartPage.tsx:55-105`（方法卡）、`:107-127`（模板入口）、`:485-517` | 方法卡“必经步骤/可按需求拆分/AI 规划/模板任务入口”已对齐（`originals/planning/assets/start.js:8-27`）；未适配卡默认不可见、模板型方法混入“全部流程”抽屉，见 `P08-04`、`P08-05`。 |

### P09 流程目录（`originals/main/pages/workflows.html`）

| mock state | 设计名称 | 实现判定 | 证据（实现文件:行 / 无） | 说明 |
|---|---|---|---|---|
| `ready` | 目录 + 详情 | 已实现 | `WorkflowsPage.tsx:110-136`、`:413-525` | 默认选中首项并展示详情；设计同。 |
| `list` | 目录（未选中） | 缺失 | `WorkflowsPage.tsx:121`（`?? filtered[0]`）、`:413-525`（详情恒渲染）；`workflows.css:4-16`（恒双列） | 无关闭详情按钮、`nodetail` 全宽布局未实现，状态不可达，见 `P09-01`。 |
| `detail-builtin` | 内置流程详情 | 已实现 | `WorkflowsPage.tsx:423-428`（内置徽标）、`:473-477`（查看步骤）、`:504-517`（归档禁用+原因）、`:519-521`（只读提示） | 内置只读语义已实现，另有 fallback 只读目录 `:103-110`。 |
| `detail-loading` | 详情读取中 | 已实现 | `WorkflowsPage.tsx:438-443`（skeleton） | 设计 `workflows.html:82` 为步骤链位置骨架，实现为正文骨架，可接受。 |
| `loading` | 目录加载中 | 部分（缺陷） | `WorkflowsPage.tsx:263-270`（`listQuery.isLoading && bootstrap.isLoading`） | bootstrap 已缓存时列表加载中会落入空目录态并可点“新建流程”，见 `P09-02`。 |
| `error` | 目录读取失败 | 已实现 | `WorkflowsPage.tsx:269-270`（`ServiceNotice` + 重试）、`:385-395`（搜索词状态保留） | 有明确错误与重试；文案与设计“本地服务没有响应”不同（P3 细节）。 |
| `more-error` | 加载更多失败 | 缺失 | 无；`workflow-api.ts:177-195` 无分页参数，服务 `packages/server/src/http.ts:1164-1172` 全量返回 | 目录无“加载更多/已加载 N 个”，失败态不可达，见 `P09-03`。 |
| `copy` | 复制对话框 | 已实现 | `WorkflowsPage.tsx:568-595`；前置 `:492-499` | 副本名预填、版本提示、校验与取消具备；缺设计说明句，见 `P09-09`。 |
| `archive` | 归档确认 | 已实现 | `WorkflowsPage.tsx:597-619`；前置 `:500-517` | 确认语义、回执与核对路径具备；标题/正文与设计有差异，见 `P09-09`。 |
| `op-unknown` | 复制结果未明 | 已实现（部分） | `WorkflowsPage.tsx:361-381`（未明横幅 + 核对原操作）、`:143-162` | 只按原请求核对、不重发，符合产品规则；横幅未点名具体副本，见 `P09-10`。 |
| `detail-planning` | v5 · 支持 AI 规划的流程详情 | 部分 | `WorkflowReadDetails.tsx:10-21`（策略/职责/可细化/固定/上限/摘要）、`:22-29`（最近使用）；`WorkflowsPage.tsx:75-96`（不读 URL 参数） | 只读节主体已实现；缺“返回需求画布”与“最近使用”的规划轮次语义，见 `P09-07`。 |

### P10 流程画布（`originals/main/pages/workflow-editor.html:197-199` 页面内 `DS.mount`）

| mock state | 设计名称 | 实现判定 | 证据（实现文件:行 / 无） | 说明 |
|---|---|---|---|---|
| `ready` | 我的流程 · 已保存 | 已实现 | `WorkflowEditorPage.tsx:109-120`（加载基线）、`:523-533`（已保存）、`:582-593`（无修改禁用保存） | 即开即编辑；标题内联可改 `:506-517`。 |
| `dirty` | 有未保存修改 | 已实现 | `WorkflowEditorPage.tsx:129-134`、`:530-532`；`workflow-model.ts:40-62`（差异计数） | 未保存数为真实字段差异数（比设计 mock 更准确）。 |
| `unbound` | 有步骤未指定职业 | 已实现 | `workflow-model.ts:107-111`（STEP_ROLE_MISSING）、`WorkflowEditorPage.tsx:277-309`（检查）、`:311-318`（保存拦截）、`:627-668`（检查浮层+定位） | 与设计 `workflow-editor.html:68,183-195` 的主要行为一致；画布节点未用警告样式（P3 细节）。 |
| `empty` | 新流程 · 空 | 缺失（仅可人为造成） | 无空态渲染；`WorkflowGraphCanvas.tsx:35-52`（仅开始/交付系统节点） | 设计 `:67,:108-117` 有“从第一步开始”CTA 与“添加第一步”；实现无引导，且正常创建路径不会出现空流程，见 `P10-02`、`P09-06`。 |
| `builtin` | 内置流程 · 只读 | 已实现 | `WorkflowEditorPage.tsx:80-81`（readonly）、`:489-496`（只读横幅）、`:567-581`（复制后修改）、`:506-517`（标题 readOnly） | 只读与复制主链对齐；工具栏多出设计没有的禁用控件，见 `P10-09`。 |
| `unknown` | 保存结果未明 | 已实现 | `WorkflowEditorPage.tsx:130-132`（持久 pending 锁定）、`:431-446`（未明横幅）、`:350-371`（按原请求核对） | 锁定画布/撤销、草稿保留、只核对原请求，与设计 `:69,104,195` 对齐。 |
| `conflict` | 版本冲突 | 已实现 | `WorkflowEditorPage.tsx:333-334`（409）、`:447-463`（冲突横幅 + 查看版本/导出）、`:886-905`（最新版本对照） | 与设计 `:105` 对齐。 |

## 问题清单

### P08-01: 未知状态（请求已发出但无回执）缺一等 UI：无锁定、无原请求核对入口，且被写成“失败/未创建”
- **严重度**：P1
- **维度**：S / A / T / D
- **类别**：状态 / 交互 / 数据诚实
- **设计依据**：`opencode-workflow-design-showcase/originals/main/pages/start.html:114`（`locked = st.phase!=='edit'`，unknown 时内容锁定）、`:121`（unknown 横幅：“需求草稿是否已形成，暂时无法确认……内容已锁定，重试会使用同一份请求，不会重复创建”，带“用原请求重试”）、`:185`（“结果核对前不能再次提交”）。
- **实现位置**：`apps/web/src/pages/start/StartPage.tsx:1-22`（未接入 `usePendingIdentity`/`pendingIdentityForPath`）、`:206-234`（提交无未知身份保留）、`:360-369`（统一错误横幅，标题 `isServiceUnavailable ? '服务未连接，未创建任务' : '形成需求草稿失败'`）、`:588-602`（按钮仅按 `submitting||missing` 禁用）；全局机制见 `apps/web/src/api/client.ts:192,219`、`apps/web/src/api/pending-commands.ts:1-15`。
- **差异**：① 服务回执 `unknown` 时通过 `ReceiptNotice`（`StartPage.tsx:353`）能按原请求号核对，但表单不锁定、未显示“内容已锁定”；② 传输超时/断连时全局 pending 把写操作包装成 `protocol` 错误（`client.ts:219`，消息含“结果待核对”），页面只渲染红色横幅“**形成需求草稿失败**”，且 `:364` 的“**未创建任务**”是对结果的确定性断言——与“结果尚未确认”矛盾；③ 刷新后 `StartPage` 不读取 localStorage 中的原请求号（`pending-commands.ts` 已持久化），页面既无未明横幅也无核对按钮，用户只能重新点提交，靠 `client.ts:192` 的协议错误提示得知已有未结算请求。
- **原因**：直接原因：开始页未把 UNKNOWN 当独立状态接入持久请求号与核对流程（C2/C5）；横幅沿用“失败/未创建”的失败态文案（C3/D）。根本原因：全局命令回执机制已存在（pending-commands + operations.by-key），但页面层只给其它页面（项目/模板/流程/编辑器）接入，开始页遗漏（C5），且写失败文案区分“确定失败/结果未明”的模板未沉淀到共享组件（C3）。
- **影响**：丢回执场景下用户会认为任务没有创建（或以为失败而再次操作）；刷新后无法从本页核对原请求；设计的 unknown 主路径（锁定 + 同一请求核对）不成立。真实重复写入被客户端 pending 拦截，但用户无法在页面上确认结果。
- **建议**：① 接入 `usePendingIdentity(ROUTES.tasks)` + `ReceiptNotice` 的未明态（或抽共享 `UnknownReceiptBanner`），刷新后仍显示锁定与“按原请求号核对”；② 传输失败分支按 `isUncertainCommandFailure` 区分“未创建/结果未明”，删除“未创建任务”的确定性措辞；③ 未明期间锁定三段表单（见 P08-03）。
- **验证**：静态已确认页面分支缺失；需真实服务 + 断网/丢回执 GUI 验证（刷新后横幅、核对、锁定）。
- **关联状态**：`unknown`、`submitting`、`accepted`、`handoff-error`

### P08-02: project-error 被实现为整页错误，未保留三段表单与已写目标
- **严重度**：P2
- **维度**：S / 结构
- **类别**：状态 / 结构
- **设计依据**：`originals/main/pages/start.html:120`（三段页面结构）、`:133`（项目段内错误：“项目列表读取失败，已填写的目标保留。[重试]”）、`:124-164`（错误态下三段仍在）；`:137-151`（目标内容保留）。
- **实现位置**：`apps/web/src/pages/start/StartPage.tsx:263-280`（`bootstrap.isError` → 整页 `ServiceNotice`）；`apps/web/src/api/hooks.ts:28-35`（项目与目录合并为一个 bootstrap 查询）；`packages/shared/src/api/contracts.ts:121-144`（BootstrapResponse 同时含 projects+catalog）。
- **差异**：设计要求项目列表读取失败只在“项目”段内提示并可重试，其余两段与已填目标保留；实现把整页替换为服务错误页，目标/名称/方法选择在错误期间不可见（虽 React state 未丢，重试成功后恢复）。设计 mock 本身有矛盾（`S0==='project-error'` 时 goal 为空却写“已填写目标保留”，`:95,:133`，C9），但“段内错误 + 表单保留”的结构要求明确。
- **原因**：直接原因：页面把 bootstrap 失败当成全页不可用（C2/C4）。根本原因：契约层把“项目列表”和“流程目录”合并为一个启动查询（C1），前端没有按设计拆出独立的 project-error 状态，只能用整页错误兜底。
- **影响**：项目列表短暂不可读时用户丢失当前编辑上下文视角，无法判断已写目标是否保留；设计明确区分的 project-error 状态不可达。
- **建议**：拆分项目列表读取（或为 bootstrap 增加 partial/section 错误），在“项目”段内渲染错误条 + 重试，保留目标/名称输入与方法卡；若契约不拆，至少在本页用缓存数据渲染其余段并局部提示。
- **验证**：静态；需真实服务（项目读取失败）GUI 验证表单保留。
- **关联状态**：`project-error`

### P08-03: 提交中/未知时三段表单未锁定，可继续改项目/目标/名称/流程
- **严重度**：P2
- **维度**：A / 交互
- **类别**：交互
- **设计依据**：`originals/main/pages/start.html:114`（`locked`）、`:128-131`（项目单选在 locked 时 `disabled`）、`:142`（目标 textarea `readonly`）、`:145`（名称 input `readonly`）、`:158-159`（流程单选/more 按钮 `disabled`）、`:185`（未明期间再次提交禁用）。
- **实现位置**：`apps/web/src/pages/start/StartPage.tsx:206-234`（提交无锁状态）、`:399-427`（项目卡始终可点）、`:445-457`（目标仅按“未选项目”禁用）、`:463-474`（名称始终可改）、`:500-505`（方法卡始终可点）、`:583-602`（仅提交按钮禁用）。
- **差异**：设计在 `submitting`/`unknown` 阶段整表锁定以固化“将要创建/已发出的请求”；实现在提交中仍可切换项目与方法、改目标与名称，摘要卡实时变化；在未知回执下也可改，导致“将要创建”的内容与已发请求不一致。
- **原因**：直接原因：页面未建立提交阶段锁（C5）。根本原因：未复用编辑器等页面已有的 `locked = pending/unknown` 模式（`WorkflowEditorPage.tsx:130-133`），开始页状态机只区分 `submitting` 布尔。
- **影响**：用户可能在等待回执时改表单，误以为改动会随本次请求生效；未知期间改动造成核对时内容与请求不一致；与设计“内容已锁定”的交互契约不符。
- **建议**：按设计引入 `phase`（edit/submitting/unknown/accepted），非 edit 时 disabled/readOnly 三段控件与“其他项目/全部流程”入口；与 P08-01 一并接入持久请求号。
- **验证**：静态；需 GUI 验证提交中不可编辑。
- **关联状态**：`submitting`、`unknown`

### P08-04: pe01 要求可见的“未适配 AI 规划”方法卡默认不可见
- **严重度**：P2
- **维度**：S / 结构
- **类别**：状态/结构
- **设计依据**：`opencode-workflow-design-showcase/originals/planning/assets/start.js:8-12`（pe01 方法卡固定 3 个：需求开发/缺陷修复/文档整理，其中 `doc` 为 `ai:false`，“尚未配置 AI 规划：可用骨架手动调整”）、`:22-26`（卡上三行：必经步骤/可按需求拆分/AI 规划）；`opencode-workflow-design-showcase/sources/planning/STATES.md:12`（验收要点：“三类方法卡（支持、未适配、选中）可键盘选择”）。
- **实现位置**：`apps/web/src/pages/start/StartPage.tsx:167`（`commonMethods = methods.slice(0, 3)`）、`:495-507`（渲染前三张卡 + “全部流程…”）；`packages/shared/src/config/catalog.ts:134-140`（`DEFAULT_METHODS` 顺序：需求开发 r12、缺陷修复 r4、技术设计 r2、手工流程 r1、单元测试开发 `template-v8`）、`:16,39,55`（前三均 `ai_planning`）、`:68-79`（`手工流程` 为 `skeleton_only`，位于第 4）。
- **差异**：默认三张卡全部是“支持 AI 规划”，pe01 要求的“未适配”卡只能打开“全部流程…”抽屉才能看到；设计验收点“三类方法卡（支持、未适配、选中）可键盘选择”在默认界面不成立。
- **原因**：直接原因：常用方法取目录前 3 个（C6）。根本原因：没有“常用/置顶方法”数据或按支持方式编排的规则，直接用服务目录顺序截断（C6/C1）；pe01 的固定三类卡在实现层没有对应选择规则。
- **影响**：用户在开始页看不到“未配置 AI 规划”的可选项，无法理解方法支持差异；验收口径不成立。
- **建议**：默认卡片按“至少一张未适配 + 常用方法”编排（例如服务返回 pinned/common 或前端按 `support` 分组各取代表），保证三类卡同时可见并保留抽屉检索。
- **验证**：静态（目录顺序已核对）；需真实服务确认目录内容一致。
- **关联状态**：`ready`、`filled`、pe01

### P08-05: 模板任务型方法混入“全部流程”抽屉，与 pe01“模板任务不在此混用”相反
- **严重度**：P2
- **维度**：结构 / 数据语义
- **类别**：结构
- **设计依据**：`originals/planning/assets/start.js:2`（修改点：“固定步骤的模板任务只给入口不混用”）、`:21,:27`（模板任务只给 `/templates` 入口与说明）；`sources/planning/STATES.md:12`（“固定步骤的‘模板任务’不在这里混用，只给去模板任务的入口”“模板任务入口不在方法列表里”）。
- **实现位置**：`apps/web/src/pages/start/StartPage.tsx:107-127`（模板入口条，正确）、`:506`（“全部流程…”抽屉）；`apps/web/src/pages/start/StartCatalogPicker.tsx:7`（抽屉列出 bootstrap `methods` 全部）；`packages/shared/src/config/catalog.ts:124-132`（`method.unit-test-development`：`support:'skeleton_only'`（:128）、`revision:'template-v8'`、描述“固定模板任务：步骤由模板版本锁定，创建后不能修改”）、`:134-140`（在 `DEFAULT_METHODS` 中）。
- **差异**：设计的模板任务只有 `/templates` 入口；实现把模板派生的“单元测试开发”作为流程方法放进开始页抽屉（同样出现在 `/workflows` 目录），可被当作普通方法选中创建任务，从而绕过模板页的 `targetPath/testPath` 等必要参数（创建结果需真实服务确认）。
- **原因**：直接原因：抽屉无条件列出目录全部方法（C4）。根本原因：契约层把 `template.unit-test-development` 同时暴露为 `method.unit-test-development`（C1/C6），前端没有按 `source/support/任务类型` 区分“模板型方法”。
- **影响**：开始页“流程方法”和“模板任务”两个入口语义混淆；用户可能创建缺少模板参数的单元测试任务。
- **建议**：目录/抽屉过滤掉模板型方法（或服务标记 `templateOnly` 并在 UI 隐藏），模板任务继续只走 `/templates`；若产品决定保留，需在设计层补充该形态。
- **验证**：静态；需真实服务确认以该方法创建任务的实际结果与计划来源。
- **关联状态**：pe01、`ready`

### P08-06: 流程版本过期（STALE_TARGET）后没有“重新读取当前版本”的恢复入口
- **严重度**：P2
- **维度**：A / 交互
- **类别**：交互
- **设计依据**：`originals/main/pages/start.html:99`（`flowCheck` 版本核对）、`:104-111`（版本读取/失败原因）、`:161-162`（读取中提示、失败时“请重试或换一个流程”并有重试按钮）；`docs/review/design-parity-acceptance-2026-10-20.md:29`（P08 验收：“当前版本核对、创建时再次校验版本，过期拒绝而非悄悄换版本”）。
- **实现位置**：`apps/web/src/pages/start/StartPage.tsx:161`（`methodQuery` `retry:false`）、`:177-189`（`missing` 文案）、`:206-234`（提交带 `expectedMethodRevision`）、`:338-348`（错误 catch）、`:360-369`（错误横幅无任何动作）；服务端过期拒绝 `packages/engine/src/project-task.ts:373`（`STALE_TARGET`“流程版本已变化，请重新读取当前版本后形成草稿”）。
- **差异**：提交时服务明确返回“版本已变化，请重新读取”，但页面错误横幅只有文字、没有“重新读取/重试”按钮，`methodQuery` 也不会自动失效；用户再次点提交仍是同一个旧 revision，只能刷新整页或切换方法再切回才可能重新 GET。
- **原因**：直接原因：版本过期错误与普通失败共用无操作横幅（C5）。根本原因：版本核对状态没有闭环（读取→核对→提交→过期→重新读取），错误分支没有区分可恢复错误（C5/C2）。
- **影响**：并发修改流程目录后，开始页进入“提交必失败”的僵局；设计的 reading/flow-error 恢复路径不完整。
- **建议**：错误码为 `STALE_TARGET`/`CONFLICT` 时提供“重新读取当前版本并重试”按钮（`methodQuery.refetch()` + 刷新 `expectedMethodRevision`），并在重新读取前禁用提交。
- **验证**：静态（错误映射已核对）；需真实服务制造版本过期验证。
- **关联状态**：`flow-error`、`reading`

### P08-07: 项目/流程抽屉缺设计底部入口与项目模式提示
- **严重度**：P3
- **维度**：结构 / 文案
- **类别**：结构
- **设计依据**：`originals/main/pages/start.html:65-70`（项目抽屉：搜索“项目名称或路径”、底部“登记新项目”）、`:71-76`（流程抽屉：底“在流程目录中管理”）、`:202`（项目行提示：`Git 分支模式 · 12 个任务` / `路径不可用`）、`:203`（流程行：名称 + 步骤链）。
- **实现位置**：`apps/web/src/pages/start/StartCatalogPicker.tsx:5-10`（`Drawer` 无 `footer`；项目行 `description=item.rootPath`，仅名称/路径/禁用原因；搜索占位统一“搜索名称或说明”）；`apps/web/src/components/Drawer.tsx:14-24`（Drawer 支持 footer，但本页未用）。
- **差异**：设计抽屉有两个出口（登记新项目 / 在流程目录中管理）与项目“Git 模式 + 任务数/不可用”提示；实现没有底部入口，项目行只有路径，搜索占位不区分项目/流程；用户在开始页无法直接去登记项目或在目录里管理流程。
- **原因**：直接原因：抽屉组件只做了列表功能（C4/C5）。根本原因：开始页的目录入口只承担选择，没有承载设计中的导航入口。
- **影响**：从开始页发现“没有想要的流程/项目”时无就地出口，需要退出页面从侧栏进入；项目可用性信息不足。
- **建议**：给抽屉补 `footer`（链接 `/projects`（登记）/`/workflows`），项目行补充 gitState 与任务数文案，搜索占位按类型区分。
- **验证**：静态；需 GUI 确认抽屉底部布局。
- **关联状态**：pe01、`ready`

### P08-08: start 页局部结构/视觉与设计偏差（页面宽度、总结卡多余行、更多入口样式、步骤编号、未选项目未整段禁用）
- **严重度**：P3
- **维度**：V / 结构 / 文案
- **类别**：样式主题 / 结构
- **设计依据**：`originals/main/pages/start.html:63`（页面 `max-width:1120px`）、`:167-174`（总结卡只有“项目”“流程”两行；“未选择”用 muted）、`:170`（“未命名任务” muted）、`:15-16`（步骤编号 28px 圆形，完成后勾）、`:40`（“更多”为虚线卡 `.more-opt`）、`:17`（`.step.off .goal{opacity:.45;pointer-events:none}`，未选项目时目标段整段禁用）、`:118`（常用项目只取未禁用）。
- **实现位置**：`apps/web/src/pages/start/StartPage.tsx:238,265,285,344`（`page wide`=1360px，见 `apps/web/src/styles/ds.css:156-158`）、`:538-553`（总结卡多出“目标/服务”两行）、`:523`（未命名任务无弱化）、`:526,529,539`（空值用“—”而非“未选择”）、`:45-47`（步骤编号用 outline badge 非圆形）、`:430,506`（“其他项目…/全部流程…”为 ghost 按钮非虚线卡）、`:397-427`（不可用项目仍进入常用卡，仅禁用）、`:450`（仅 textarea 按未选项目禁用，名称/未选项目段未整体弱化）。
- **差异**：上列 7 处均可静态核对：页面比设计宽 240px；总结卡信息项与空值文案不同；步骤状态视觉与“更多”入口形态不同；设计要求未选项目时整段目标不可交互、实现仅禁用文本域；设计常用卡过滤不可用项目、实现把禁用项目放入常用卡。
- **原因**：直接原因：组件重写时按自定结构实现（C7/C4/C3）。根本原因：缺少与 mock 的 class/结构对照清单（步骤编号、`.more-opt`、`.step.off` 等设计系统类未被使用）。
- **影响**：首屏密度、层级与设计观感不一致；禁用项目出现在常用位增加噪音；不影响主流程。
- **建议**：按设计收窄到 1120（或设计确认 1360）；总结卡保留项目/流程两行（其余信息可放下方说明）；复用 `.more-opt`/圆形步骤编号；未选项目时给目标段加禁用样式并禁用名称输入；常用卡过滤不可用项目（仅抽屉显示）。
- **验证**：静态；需 GUI 四主题/三尺寸确认。
- **关联状态**：`ready`、`filled`

### P08-09: 页头提示缺失；页头/内容标题与 supplement-v5 pe01 不一致（设计冲突需裁决）
- **严重度**：P3
- **维度**：T / 结构
- **类别**：文案 / 结构
- **设计依据**：`originals/main/pages/start.html:116`（shell 页头 `h1 开始任务` + hint “草稿 → 确认计划 → 执行，三步分开进行”）、`:120`（内容标题“开始一个任务”）；`originals/planning/assets/start.js:16`（pe01 标题“描述要做的事，选择流程方法” + lede“先形成需求草稿；之后在需求画布上生成或手动调整计划，确认后再准备独立工作区与开始执行。”）。
- **实现位置**：`apps/web/src/app/Shell.tsx:130-140`（页头只渲染面包屑/页名，无页面级 hint）；`apps/web/src/pages/start/StartPage.tsx:346-350`（eyebrow“开始任务” + h2“开始一个任务” + 自定义 lede）。
- **差异**：① 设计页头 hint 未渲染；② pe01 的页面标题/lede 与实现不同（实现采用主稿标题，lede 混用 pe01 语义）；③ 页头“开始任务”与内容标题“开始一个任务”双标题（同类根因见 GLOBAL `GLB-05`，本文件不重复计）。
- **原因**：直接原因：页头 hint 属于页面级 header 内容、Shell 未提供该插槽（C3/C4）。根本原因：设计权威存在主稿与 supplement-v5 pe01 的标题冲突（C9），实现各自取了一部分，未记录裁决。
- **影响**：页头右侧说明缺失；两版设计文案混用，验收时无法判定以哪版为准。
- **建议**：由 Lead/设计裁决 start 页标题口径（建议按 v5 pe01，因补充稿优先级更高），并统一到一处；页头 hint 若保留，通过页头插槽从页面传入。
- **验证**：静态。
- **关联状态**：pe01、`ready`

### P08-10: accepted / handoff-error 只覆盖部分分支，回执页动作与设计不同
- **严重度**：P3
- **维度**：S / A
- **类别**：状态 / 交互
- **设计依据**：`originals/main/pages/start.html:117`（accepted/handoff-error 直接进入回执页）、`:209-218`（回执卡：任务/项目/流程 kv；“去确认计划”/“稍后，回到任务列表”；handoff-error 主按钮“打开原草稿”且应可用）。
- **实现位置**：`apps/web/src/pages/start/StartPage.tsx:282-341`（只在 `succeeded` 进入回执页）、`:324-327`（handoff-error 变体「打开原草稿」`disabled` + 原因）、`:329`（新增“再创建一个”）、`:353`（`accepted` 仅 `ReceiptNotice`“请求已受理，等待服务回执”，无结算推进/轮询）。
- **差异**：① 设计 accepted 就是终态回执页，实现把它当“等待回执”的中间态且无刷新/轮询机制；② handoff-error 在实现中是“回执成功但缺 task.id”的降级，主操作不可用，而设计语义是“草稿已形成但打开失败”，主操作应打开原草稿；③ 回执页多出设计没有的“再创建一个”。
- **原因**：直接原因：实现按“服务返回 task.id 才进入回执页”实现回执态（C2/C5）。根本原因：开始任务接口为同步创建，`accepted` 分支实际很少出现，页面没有按设计建模“accepted→终态”的推进；handoff 的失败点（导航/打开）在实现中没有可观察信号，只能以缺 id 代替（C1）。
- **影响**：极端回执分支下用户可能停留在“等待回执”文案而页面不更新；handoff-error 的恢复动作不可用。
- **建议**：同步接口下把 `accepted` 也视为终态回执（或按设计补“刷新回执”动作）；handoff-error 若无法观测“打开失败”，需在设计层确认降级文案并保留“回任务列表”主操作。
- **验证**：静态；需真实服务制造 accepted/缺 resource 回执。
- **关联状态**：`accepted`、`handoff-error`

### P09-01: 流程详情不可关闭、`list`（未选中）状态不可达，详情列宽也与设计不符
- **严重度**：P2
- **维度**：S / 结构 / 交互
- **类别**：状态 / 结构
- **设计依据**：`opencode-workflow-design-showcase/originals/main/pages/workflows.html:11-12`（`.wrapx{grid-template-columns:minmax(0,1fr) 400px}`、`.nodetail{grid-template-columns:1fr}`）、`:90`（详情关闭按钮 `aria-label="关闭详情" onclick="select(null)"`）、`:134`（`wrapx ${sel?'':'nodetail'}`）、`:145`（`list` 状态=目录未选中）。
- **实现位置**：`apps/web/src/pages/workflows/WorkflowsPage.tsx:121`（`selectedEntry = entries.find(selectedId) ?? filtered[0]`，无选中时回退第一项）、`:413-525`（详情恒渲染，无关闭按钮）；`apps/web/src/pages/workflows/workflows.css:4-16`（恒两列、无 `nodetail`）。
- **差异**：设计允许关闭详情回到全宽列表（`list` 状态），详情列固定 400px；实现只要目录非空就一定有选中项，详情无法关闭、`list` 状态不可达；详情宽度为 `1.15fr/0.85fr` 比例列而非固定 400px（1120 宽页面下与设计 400 也有差异）。
- **原因**：直接原因：选中逻辑用 `filtered[0]` 兜底，且没有清空选中/关闭详情的入口（C2/C5）。根本原因：把“详情是目录的附属面板”实现成不可关闭的常驻列，未按设计的可选详情建模。
- **影响**：无法在宽屏全宽浏览目录；切换到窄屏时上下堆叠；`list` 状态无法验收。
- **建议**：允许 `selectedId=null` 表示未选中，补关闭按钮（X）与 `.nodetail` 单列布局；详情列宽按设计 400px（`--drawer-sm`）固定。
- **验证**：静态；需 GUI 确认关闭/全宽/400px。
- **关联状态**：`list`、`ready`、`detail-builtin`

### P09-02: 目录加载态在 bootstrap 已缓存时误显示“目录里还没有流程”空态
- **严重度**：P2
- **维度**：S
- **类别**：状态
- **设计依据**：`originals/main/pages/workflows.html:119-120`（`loading` 状态必须渲染骨架行）、`:121`（空态是“没有匹配的流程”，属于筛选后结果）、`:146`（`loading` 是独立注册状态）。
- **实现位置**：`apps/web/src/pages/workflows/WorkflowsPage.tsx:262-291`（骨架条件 `listQuery.isLoading && bootstrap.isLoading`；否则走 `filtered.length===0` → `EmptyState`）、`:269`（错误分支）、`:271-290`（空态 + “新建流程”按钮）；`apps/web/src/api/hooks.ts:28-35`（bootstrap `staleTime:15_000`，从其它页进入时已缓存、`isLoading=false`）。
- **差异**：从主页/项目等页面（bootstrap 已缓存）进入 `/workflows` 时，流程列表仍在加载但 `bootstrap.isLoading=false`，页面立即渲染“目录里还没有流程”空态（并显示可用的“新建流程”），加载完成后才出现列表；首屏加载若 bootstrap 先完成也会闪空态。设计在加载期间只显示骨架。
- **原因**：直接原因：加载态判断耦合了 bootstrap 的加载状态（C2）。根本原因：缺少独立的 `listLoading` 分支优先级（loading > error > empty），空态判定把“尚未加载”误当“已加载为空”。
- **影响**：用户可能误认为目录为空并去新建流程；目录较大/服务慢时误导明显。
- **建议**：`listBody` 先判 `listQuery.isLoading` → 骨架（不依赖 bootstrap）；`bootstrap.isLoading` 只用于需要目录快照的降级；空态文案区分“目录为空/筛选无结果/未加载”。
- **验证**：静态；需 GUI 慢网络或切换页面复现。
- **关联状态**：`loading`、`error`

### P09-03: 目录缺“加载更多/加载失败/已加载计数/按更新时间排序”，more-error 状态不存在
- **严重度**：P2
- **维度**：S / 结构 / 数据语义
- **类别**：状态 / 结构
- **设计依据**：`originals/main/pages/workflows.html:126`（列表脚注“已加载 N 个 · 按更新时间排列” + “加载更多”按钮，`more-error` 时按钮仍可用且失败提示保留已有结果）、`:146`（`more-error` 注册状态）。
- **实现位置**：`apps/web/src/pages/workflows/WorkflowsPage.tsx:291-324`（一次性渲染 `filtered`，无脚注/更多按钮）、`:98-103`（`fetchWorkflowList({includeArchived})` 无分页参数）；`apps/web/src/pages/workflows/workflow-api.ts:177-195`（列表无 cursor/limit）；`packages/server/src/http.ts:1164-1172` → `packages/engine/src/method-catalog.ts:181-193`（全量返回；顺序=内置固定顺序+自定义存储顺序，未按 `updatedAt` 排序）。
- **差异**：设计有分页脚注、加载更多与失败保留态；实现无分页、无计数、无更多按钮，`more-error` 不可达；列表也没有按更新时间排序（行内虽有时间，顺序不是时间序）。
- **原因**：直接原因：目录按全量列表实现（C2/C6）。根本原因：服务 `/api/workflows` 无分页参数（C1），前端只能一次加载；设计的分页/失败态因此不可实现，且未在 UI 上按设计补“已加载 N 个 / 按更新时间排列”的最小对齐。
- **影响**：目录增长后无渐进加载；用户无法判断列表是否还有更多；排序与设计承诺不符。
- **建议**：短期至少补“已加载 N 个”脚注并按 `updatedAt` 前端排序；`more-error` 若服务不分页，记录为设计缺口（C9）并在验收表标注；中期服务加分页。
- **验证**：静态（接口无分页已核对）；需真实服务确认目录规模与排序。
- **关联状态**：`ready`、`more-error`

### P09-04: 详情步骤链未渲染并行并排；`stepChainGroups` 为未使用的死代码
- **严重度**：P2
- **维度**：结构 / 数据语义
- **类别**：结构
- **设计依据**：`originals/main/pages/workflows.html:29-30`（`.par` 并行并排样式）、`:56-57`（内置流程 w1 的第 2 步是并行对：实现功能/编写测试）、`:83`（嵌套数组渲染为并排块 + `split` 图标 + “并行”提示）。
- **实现位置**：`apps/web/src/pages/workflows/WorkflowsPage.tsx:54-73`（`StepChain` 一律渲染平铺 `<ol>`，序号 `01/02/…`，元信息为 `kind · group · roleId`）；`apps/web/src/pages/workflows/workflow-model.ts:155-164`（`stepChainGroups` 按 group 分组，全仓无引用）。
- **差异**：设计要求把同组/并行步骤并排展示并标“并行”；实现全部平铺为顺序步骤，并行语义完全丢失；即便前端已写好分组函数也未接线。
- **原因**：直接原因：详情组件没有使用 `stepChainGroups`（C2/C4）。根本原因：目录详情只按 `requiredSteps` 数组顺序展示，未把 `group`/`requires` 的并行语义映射到 UI。
- **影响**：用户从流程详情无法判断哪些步骤并行；与设计“并行并排”不符，也会误导对执行时长的预期。
- **建议**：按 `stepChainGroups`（或 `requires` 同层）分组渲染：同组步骤并排 + “并行”图标/文字；补充步骤职业与产出信息。
- **验证**：静态；需 GUI 用真实内置/自定义流程确认分组效果。
- **关联状态**：`ready`、`detail-builtin`、`detail-planning`

### P09-05: 步骤职业显示错误：内置流程步骤全部被标“未指定职业”，自定义步骤外露原始 roleId
- **严重度**：P2
- **维度**：T / D
- **类别**：数据语义 / 文案
- **设计依据**：`originals/main/pages/workflows.html:57-66`（内置流程 fixture 每步都有职业：产品经理/软件工程师/测试工程师/架构师/人工）、`:83`（步骤第二行显示职业名）；v5 `sources/supplement-v5/STATES-v5.md:12`（detail-planning 的“规划职责”与步骤职责分离）。
- **实现位置**：`apps/web/src/pages/workflows/WorkflowsPage.tsx:62-68`（`step.roleId === undefined ? ' · 未指定职业'` + `Badge tone="warn" 未指定职业`；否则直接显示 `roleId`）；`packages/shared/src/domain/models.ts:144-153`（`roleId` 可选）；`packages/shared/src/config/catalog.ts:14-31`、`:41-54`、`:56-66`（内置方法步骤均无 `roleId`）；`packages/engine/src/method-catalog.ts:267-274`（`roleId` 仅来自导入角色包的 `catalog.role.bindings`，默认无绑定）；`packages/engine/src/graph.ts:66`（执行时按步骤类型回退默认职业：test→`role.tester`、verify→`role.reviewer`、其余→`role.developer`）。
- **差异**：默认安装下，`需求开发` 等内置流程详情中的**每一步**都显示黄色“未指定职业”徽标，但服务执行时会按步骤类型回退默认职业、流程本身可用；自定义步骤若配了 `roleId` 则直接显示 `role.developer` 之类内部 id。设计显示的是可读职业名（产品经理等）。
- **原因**：直接原因：前端把 `roleId` 缺失当成错误状态并外露原始 id（C6/D）。根本原因：契约层 `MethodStepDefinition.roleId` 可选且内置方法不带职业（C1），目录详情没有解析职业名称/默认回退，也没有区分“必填职业（编辑器规则）”与“目录展示”。
- **影响**：默认目录看起来所有内置流程都“缺职业”，用户会怀疑流程不可执行；自定义流程显示内部标识符；与设计职业展示不符。
- **建议**：详情按 `roleId → 角色名` 映射；无 `roleId` 时显示“按步骤类型默认（测试→测试工程师…）”而不是 warn 徽标；服务若能在 detail 返回解析后的角色摘要更好（C1）。
- **验证**：静态（默认目录无 roleId、执行回退已核对）；需真实服务确认内置实例的绑定情况。
- **关联状态**：`ready`、`detail-builtin`、`detail-planning`

### P09-06: 新建流程路径与设计不同：先弹窗创建两步骤流程，且“创建并编辑”不进入编辑器，空画布态不可达
- **严重度**：P2
- **维度**：A / R / 结构
- **类别**：交互 / 结构
- **设计依据**：`originals/main/pages/workflows.html:144`（页头“新建流程”链接到 `workflow-editor.html?state=empty`）、`originals/main/pages/workflow-editor.html:67`（`empty`：`title='未命名流程'`、仅系统节点 start/end、start→end 直连）、`:91-94`（`empty` 时标题输入 + badge“新流程 · 尚未保存”，保存按钮在 dirty 前禁用）、`:197-199`（`empty` 注册状态）。
- **实现位置**：`apps/web/src/pages/workflows/WorkflowsPage.tsx:331-347`（页头按钮打开弹窗）、`:528-566`（新建弹窗：名称/说明/规划支持）、`:174-212`（`submitCreate`：成功后 `setSelectedId(...)` 停留目录，不 `navigate` 编辑器）、`:185-194`（固定初始两步骤“第一步/交付”）。
- **差异**：① 设计=直接进入空画布，标题/说明在编辑器内填写，保存时才创建；实现=先在目录弹窗填名称/说明/规划支持，立即创建包含两个固定步骤的流程（多出设计没有的创建弹窗与初始步骤）；② 弹窗主按钮文案“创建并编辑”（`:542`），但成功后不跳转编辑器，用户需再点“编辑流程”；③ 设计 `empty`（未命名流程/新流程·尚未保存）状态因此不可达。
- **原因**：直接原因：按服务创建接口实现了“先创建后编辑”的流程（C5）；成功回调漏了跳转（C5）。根本原因：服务 `create` 校验要求至少含交付/验收步骤（`packages/engine/src/method-catalog.ts` 的 validate + `workflow-model.ts:94,118-120`），无法创建设计中的空流程草稿（C1）；产品未就“空流程草稿”做服务/契约支持，也未记录 C9 设计缺口。
- **影响**：新建流程多一步弹窗且无法预先选择步骤模板/角色；创建后停留在目录，与按钮承诺不符；设计 empty 状态无法验收。
- **建议**：若保留弹窗，创建成功后 `navigate(/workflows/:id/edit)`；若要对齐设计，需服务/契约支持“空草稿/未保存新建态”（或明确记录 C9 设计缺口并在 workflows 页说明）。
- **验证**：静态；需 GUI 点击“创建并编辑”确认停留行为；需真实服务确认空流程创建限制。
- **关联状态**：`ready`（新建入口）、`empty`

### P09-07: v5 规划只读节缺“返回需求画布”；“最近使用”用执行生命周期冒充规划轮次
- **严重度**：P2
- **维度**：S / R / 数据语义
- **类别**：状态 / 导航 / 数据契约
- **设计依据**：`originals/main/pages/workflows.html:102-114`（`aiHTML`：`:105` 当 `back` 参数存在时渲染“返回需求画布”按钮；`:106` “AI 规划 · 只读”；`:108-111` 策略/职责/可细化/不可改/上限/摘要；`:112` “最近使用”展示任务当前规划轮次状态：“规划总览 · 3 组未细化”“第 2 轮 · 候选待审阅”“第 2 轮 · 已确认”）；`sources/supplement-v5/STATES-v5.md:12`（验收：AI 规划一节 + “返回需求画布”）。
- **实现位置**：`apps/web/src/pages/workflows/WorkflowReadDetails.tsx:10-21`（只读节主体）、`:22-29`（“最近使用”渲染 `usage.recentTasks` 的 `lifecycle/stage` 徽标）；`apps/web/src/pages/workflows/WorkflowsPage.tsx:75-96`（组件不读 `useSearchParams`，全页无 `back` 处理）；`packages/shared/src/api/contracts.ts:1086-1100`（`MethodUsage.recentTasks` 只有 `stage/lifecycle`，无规划轮次/组状态）。
- **差异**：① 从需求画布/规划职责页带 `back` 进入流程目录时，设计详情显示“返回需求画布”，实现没有返回入口（用户只能靠浏览器后退/侧栏）；② 设计“最近使用”展示的是各任务**规划轮次进度**，实现展示任务执行阶段/生命周期（如“实现”“active”），把两类信息混淆；③ 说明文案“任务冻结的是规划时的精确版本”变成“目录显示当前配置；已有任务使用其冻结版本”，语义接近但“不可改”标签被改为“固定步骤”。
- **原因**：直接原因：页面未支持 `back` 查询参数（C5）；最近使用直接消费任务执行字段（C6）。根本原因：v5 设计所需的任务级规划轮次状态未进入 `MethodUsage` 契约（C1），流程目录无法用真实数据还原“最近使用”的规划语义；返回链路未按跨页参数实现（C5）。
- **影响**：从需求画布进入流程目录后无法按设计返回；用户会把执行阶段误当成规划进度；v5 验收点“返回需求画布”缺失。
- **建议**：① 解析 `back` 参数并渲染“返回需求画布”（带来源校验）；② “最近使用”要么补规划轮次/组状态字段（服务 C1），要么改为“最近任务（执行）”并明确文案，不得混称规划进度；③ 标签“不可改”按设计恢复。
- **验证**：静态；需 GUI 从需求画布带入 `back` 验证返回；需真实数据确认规划进度字段。
- **关联状态**：`detail-planning`

### P09-08: 目录行/工具条/页头细节与设计不一致（行徽标、meta 内容、页面宽度、搜索宽度、额外归档筛选）
- **严重度**：P3
- **维度**：T / 结构 / V
- **类别**：文案 / 结构 / 样式
- **设计依据**：`originals/main/pages/workflows.html:124`（行徽标：仅内置显示“内置”，AI 流程显示“AI 规划”）、`:125`（行 meta：`版本 N` + 更新时间 + 右侧箭头）、`:128`（页头 `h2 流程` + lede“把常用的做事步骤沉淀成流程，开始任务时直接套用。”）、`:131`（搜索框固定 300px）、`:144`（页头主按钮“新建流程”）。
- **实现位置**：`apps/web/src/pages/workflows/WorkflowsPage.tsx:310`（自定义行加“我的”徽标、缺“AI 规划”徽标）、`:315-319`（行 meta=`revision · N 步 · 使用次数 · 相对时间`，无“版本”字样且多出步数/使用次数）、`:327-348`（`page` 非 wide，1120 vs 设计 1360；lede 为长段实现说明）、`:397-405`（多出“显示已归档”勾选，设计无）、`:386-395`（搜索框 grow 撑满，非 300px）。
- **差异**：行徽标语义、行 meta 字段与文案、页面宽度、搜索框宽度、页头 lede、额外归档筛选开关共 6 处与设计不同；其中“AI 规划”行徽标缺失会让 v5 支持的流程与普通流程在目录里无法区分。
- **原因**：直接原因：目录行结构与工具条按实现需要扩展（C3/C4/C7）。根本原因：行信息未按设计分层（版本/时间在行、使用次数在详情），且“显示已归档”作为服务能力补充未在设计层沉淀。
- **影响**：目录观感与设计不符；v5 AI 规划流程缺少行内标识；额外开关让页面更复杂。
- **建议**：行徽标按设计补“AI 规划”、去掉“我的”（或设计确认）；meta 恢复“版本 N + 时间”（使用次数移入详情）；页面/搜索宽度按设计；“显示已归档”若保留需设计确认。
- **验证**：静态；需 GUI 四主题/1280 下确认行溢出与宽度。
- **关联状态**：`ready`、`detail-planning`

### P09-09: 复制/归档对话框文案与语义细节（缺说明句、少任务数、alertdialog/焦点不同）
- **严重度**：P3
- **维度**：T / K
- **类别**：文案 / 可访问性
- **设计依据**：`originals/main/pages/workflows.html:43`（复制对话框说明：“副本保存在‘我的流程’，可以自由修改，不影响原流程。”）、`:44`（名称输入即时校验“请填写名称”）、`:47-50`（归档 `role="alertdialog"`，标题“归档这个流程？”，默认聚焦“保留”）、`:141`（归档正文含“已经用它创建的 N 个任务不受影响”）。
- **实现位置**：`apps/web/src/pages/workflows/WorkflowsPage.tsx:568-595`（复制弹窗只有“将复制…版本 N 的步骤定义”，无说明句；空名只用按钮禁用原因，不显示内联错误）、`:597-619`（标题“归档流程？”，正文无已用任务数，虽 `entry.usage.taskCount` 可得）、`:616-618`（正文强调回执/原请求）；`apps/web/src/components/Modal.tsx:36-44`（统一 `role="dialog"`、初始聚焦对话框，无 alertdialog/默认聚焦“保留”）。
- **差异**：复制对话框缺设计说明句与内联校验提示；归档标题/正文与设计不同且缺“已用于 N 个任务”这一关键影响面；归档未使用 alertdialog 与安全默认焦点。
- **原因**：直接原因：对话框文案按实现写、未带 usage 数据（C3/C4）；共享 Modal 不支持 alertdialog/指定初始焦点（C8）。根本原因：共享模态组件未按设计区分普通对话框与破坏性确认。
- **影响**：复制/归档用户对影响范围理解不足；键盘用户默认焦点不在“保留”上（误触风险）。
- **建议**：补复制说明句与内联错误；归档标题/正文按设计并注入 `usage.taskCount`；Modal 增加 `tone/alertdialog` 与初始焦点参数（与 GLOBAL `GLB-13` 一并修）。
- **验证**：静态；需 GUI 键盘确认默认焦点。
- **关联状态**：`copy`、`archive`

### P09-10: `op-unknown` 横幅未点名未确认的复制对象
- **严重度**：P3
- **维度**：T
- **类别**：文案
- **设计依据**：`originals/main/pages/workflows.html:129`（未明横幅：“‘需求实现与验收 副本’是否已创建，暂时无法确认……重试会使用原请求，不会多复制一份”）。
- **实现位置**：`apps/web/src/pages/workflows/WorkflowsPage.tsx:361-381`（通用横幅“复制流程 · 结果未明” + requestKey + 核对/收起）；`:164-172`（错误写入 `label` 但不含副本名）。
- **差异**：设计点名“哪个副本”结果未明；实现只给操作名与请求号，用户需要自己回忆刚复制的名称/版本。
- **原因**：直接原因：回执状态结构只保留操作标签（C3）。根本原因：命令回执未携带业务对象快照（名称/版本），前端无法在未明态还原对象。
- **影响**：多条复制/归档操作后用户难以判断未明的是哪一条；不改变“只核对不重发”的正确语义。
- **建议**：未明横幅带上业务对象（如“「X」副本 · 版本 rN”）或复制名称提示，与 requestKey 同时展示。
- **验证**：静态；需 GUI 制造未明回执确认横幅。
- **关联状态**：`op-unknown`

### P09-11: 流程列表 ARIA 与设计不同（`listbox/option` vs `list/listitem`）
- **严重度**：P3
- **维度**：K
- **类别**：可访问性
- **设计依据**：`originals/main/pages/workflows.html:122`（`<div class="list" role="listbox" aria-label="流程">` + 行 `role="option" aria-selected`）。
- **实现位置**：`apps/web/src/pages/workflows/WorkflowsPage.tsx:292-303`（`role="list"` + 行 `<button role="listitem" aria-selected>`）。
- **差异**：实现把 `role="listitem"` 赋给 `<button>`，覆盖了按钮语义且 `aria-selected` 不属于 `listitem`；设计使用 `listbox/option` 的单选列表语义，屏幕阅读器能播报“已选中”。
- **原因**：直接原因：列表可访问性角色选择错误（C8）。根本原因：缺少“可选列表”共享组件（`SegmentedControl` 之外没有 listbox 封装），页面各自手写 role。
- **影响**：键盘/读屏用户难以感知列表为可选择项及当前选中项。
- **建议**：改为 `role="listbox"` + `role="option" aria-selected`（或保留按钮语义、去掉 listitem/aria-selected 改用 `aria-pressed`），并补方向键移动。
- **验证**：静态；需 GUI 键盘/读屏验证。
- **关联状态**：`ready`

### P10-01: 画布页未采用设计的整页 canvas 骨架：普通 page + 520 覆盖抽屉，而非 canvas-page + 内联 480 侧栏
- **严重度**：P2
- **维度**：结构 / V / K
- **类别**：结构 / 样式
- **设计依据**：`originals/main/pages/workflow-editor.html:36-40`（`<main class="canvas-page">`：`canvas-bar` + `banner` + `canvas-body`（`#cv` 画布 + `<aside class="side hidden" id="side">` 内联侧栏））、`:200`（“画布页把页头并入画布工具条”并移除页头）、`:42-47`（步骤目录为左侧 400 抽屉）；`opencode-workflow-design-showcase/originals/main/assets/ds.css:373`（`.canvas-page{display:flex;flex-direction:column;height:100%}`）、`:377`（`.side{flex:none;width:var(--drawer-md)}`=480px，`:88`）。
- **实现位置**：`apps/web/src/pages/workflows/WorkflowEditorPage.tsx:500`（`<div className="page wfe-page">`，受 `apps/web/src/styles/ds.css:156-158` max-width 1120 限制）、`:501-505`（自绘 crumb 工具条）、`:670-673`（步骤面板 `Drawer size="lg"` = `--drawer-lg` 520px 覆盖层，见 `ds.css:88,297`、`apps/web/src/components/Drawer.tsx:14-24,41`）、`:613-625`（画布卡片）。对照：同仓库需求/任务画布使用设计骨架 `RequirementCanvasPage.tsx:385,478`、`TaskCanvasPage.tsx:277,332` 的 `canvas-page` + `<aside className="side">`（`:394`、`:286`）。
- **差异**：设计要求画布页占满内容区、右侧 480 侧栏与画布并排（选中步骤时画布收窄而非被遮挡）；实现仍是 1120 宽的普通内容页 + Shell 页头，步骤编辑用 520px 的模态抽屉覆盖在画布上，选节点后画布被遮住，宽度/层级都与设计不符；页头双标题同类根因见 GLOBAL `GLB-05`，此处只记画布骨架。
- **原因**：直接原因：编辑器按表单页结构实现，未复用设计 canvas 骨架（C4/C7）。根本原因：`apps/web/src/styles/ds.css` 已提供 `.canvas-page`/`.side` 且需求/任务画布已用，编辑器的页面骨架未与其它画布页统一（C4）。
- **影响**：编辑步骤时失去画布上下文（看不到选中节点与相邻依赖）；可用画布宽度小于设计；键盘焦点被模态抽屉困住、设计的内联侧栏交互不存在（需GUI确认观感）。
- **建议**：改造成 `<main class="canvas-page">` + 顶部 `canvas-bar`（面包屑/标题/badge/保存态/撤销重做/添加/检查/保存）+ `canvas-body`（ReactFlow 画布 + `<aside className="side">` 步骤面板），宽度用 480；移除模态抽屉方案（可保留 Drawer 仅用于模板目录）。
- **验证**：静态；需 GUI 四主题/1440/1280/1024 对照设计。
- **关联状态**：`ready`、`dirty`、`builtin`、`unknown`

### P10-02: 空画布态缺“从第一步开始”引导，删除全部步骤后无出路提示
- **严重度**：P2
- **维度**：S / 结构
- **类别**：状态 / 结构
- **设计依据**：`originals/main/pages/workflow-editor.html:27`（`.empty-cta` 样式）、`:67`（empty 状态仅 start/end 系统节点、start→end 直连）、`:108-117`（`steps===0` 时渲染空态浮层：“从第一步开始”“流程由一串步骤组成，每一步指定做什么、由哪个职业来做。” + “添加第一步”按钮，直接打开步骤目录）。
- **实现位置**：`apps/web/src/pages/workflows/WorkflowGraphCanvas.tsx:35-52`（`steps` 为空时仅渲染 `__start`/`__end` 两个系统节点与一条直连边，无空态浮层）、`:71`（底部只有计数/就绪说明）；`apps/web/src/pages/workflows/workflows.css:321-347`（`.wfe-empty`/`.wfe-count` 样式仍在，但无任何组件引用——死样式）。
- **差异**：设计在空流程时提供居中引导卡与“添加第一步”主操作；实现空画布只剩开始/交付两个节点，没有提示从哪开始，也没有直接添加入口（只能回工具栏点“添加步骤”或先选步骤）。
- **原因**：直接原因：画布组件未渲染空态分支（C2）。根本原因：旧画布实现的空态样式残留、新 ReactFlow 画布重写时漏迁移该状态（C2/C4）。
- **影响**：用户删除全部步骤或进入空流程时面对空白画布，不知道下一步操作；设计 `empty` 状态无法验收（其入口另见 `P09-06`）。
- **建议**：`steps.length===0` 时在画布上渲染设计同款空态卡（说明 + “添加第一步”按钮，打开步骤目录/插入首步），并清理未使用的 `.wfe-empty/.wfe-count` 死样式或复用它们。
- **验证**：静态；需 GUI 删除全部步骤验证。
- **关联状态**：`empty`

### P10-03: 方法编辑器无法把步骤指定给“人工”，与设计的“谁来做”选项不一致
- **严重度**：P2
- **维度**：结构 / 数据语义
- **类别**：数据契约
- **设计依据**：`originals/main/pages/workflow-editor.html:74`（`ROLES = ['产品经理','软件工程师','测试工程师','架构师','技术写作','人工']`）、`:131-135`（“谁来做”：`人工` 选项带用户图标与“由你确认后继续”说明；未指定职业的虚线警告态）；`originals/main/pages/workflows.html:57-66`（人工验收/人工确认步骤）。
- **实现位置**：`apps/web/src/pages/workflows/WorkflowEditorPage.tsx:68`（`executionRoles = roles.filter(角色不是任何方法的 planningStrategy.roleId)`）、`:704-719`（原生 `<select>` 只列 `executionRoles` 的模型职业）；`packages/shared/src/config/catalog.ts:142-183`（默认职业只有需求分析师/开发工程师/测试工程师/代码审查员，无“人工”）；`packages/engine/src/graph.ts:66`（执行时按类型回退到模型职业，人工确认靠 `qualityReview`/人工裁决，见 `WorkflowEditorPage.tsx:724` 的 `QualityReviewFields`）。
- **差异**：设计把“人工”作为一种可选职责，执行到该步骤时由人确认后继续；实现的“谁来做”只能选模型职业，人工判断通过 verify 步骤的质量评审/节点裁决表达，无法把某一步显式声明为“由人执行”。规划职责被正确排除（与 v5 planning-role “不出现在谁来做”一致，已核对），但“人工”缺口存在。
- **原因**：直接原因：编辑器职责下拉只消费角色目录（C1/C6）。根本原因：契约中角色目录没有“人类角色”概念，`MethodStepDefinition.roleId` 也没有人工哨兵值；产品以执行期人工裁决替代，但方法编辑层未记录该差异（C9 待确认）。
- **影响**：自定义流程无法表达“人工确认/人工验收”步骤；与设计的工作流详情/编辑器语义不一致，用户只能用 verify+质量评审的替代路径。
- **建议**：产品/契约确认“人工”是否为保留职责：若需要，在角色目录或步骤字段增加人类执行标记并让执行暂停等人工裁决；若维持现状，需记录为设计缺口（C9）并在编辑器“谁来做”旁说明替代方式，避免用户以为无法配置人工步骤。
- **验证**：静态；需真实执行确认 verify/人工裁决的实际语义。
- **关联状态**：`unbound`、`ready`、`dirty`

### P10-04: 步骤模板目录应为左侧 400 抽屉并由“添加步骤”打开；实现是右侧 520 抽屉 + 工具栏直接插入空白步骤
- **严重度**：P3
- **维度**：结构 / 交互
- **类别**：结构
- **设计依据**：`originals/main/pages/workflow-editor.html:43-47`（`<aside class="drawer left" id="catalog">`：标题“添加步骤”、副标题“将添加到所选步骤之后”、搜索“搜索步骤模板”）、`:99-100`（工具栏“添加步骤”调用 `openCatalog()`）、`:172-177`（`openCatalog` 计算 `catAfter` 并显示“将添加到‘X’之后”）。
- **实现位置**：`apps/web/src/pages/workflows/WorkflowEditorPage.tsx:554-563`（“添加步骤”直接 `insertAfterSelected()` 插入空白“新步骤”）、`:608`（另有“从步骤模板添加”）、`:834-841`（模板抽屉 `Drawer` 默认右侧 + `size="lg"`=520，见 `Drawer.tsx:14-24,41`、`ds.css:88,297`）。
- **差异**：设计的“添加步骤”是打开步骤模板目录（左 400），并明确“将添加到所选步骤之后”；实现把它改成“立即插入空白步骤”，模板目录是另一个按钮且出现在右侧 520 抽屉，没有“将添加到…之后”的上下文说明。
- **原因**：直接原因：工具栏动作与抽屉方位/宽度实现自定（C4/C5/C7）。根本原因：编辑器未复用设计的左侧目录抽屉形态，按钮语义被拆分但未在设计层记录。
- **影响**：用户按设计预期点“添加步骤”得到的是空白步骤而非模板选择；模板插入位置提示不足。
- **建议**：工具栏“添加步骤”打开左 400 模板目录（带“将添加到 X 之后”和搜索）；空白步骤可作为目录首项或菜单项；模板抽屉改左 400。
- **验证**：静态；需 GUI 确认抽屉方向与宽度。
- **关联状态**：`dirty`、`ready`

### P10-05: 保存态与“检查”缺少设计要求的图标/徽标（状态仅文字）
- **严重度**：P3
- **维度**：V / T
- **类别**：样式 / 文案
- **设计依据**：`originals/main/pages/workflow-editor.html:13-17`（`.save-state` 五个阶段的图标：已保存勾、未保存圆点、保存中转圈、未明问号、冲突警告）、`:97`（`{{saved: 勾+已保存, dirty: 圆点+N 处未保存修改, saving: 转圈+正在保存, unknown: 问号+保存结果未明, conflict: 警告+版本已变化}}`）、`:101`（“检查”按钮内嵌问题数徽标 `.badge st-fail`）。
- **实现位置**：`apps/web/src/pages/workflows/WorkflowEditorPage.tsx:523-533`（保存态为纯文本 `正在保存…/保存结果未明/版本已变化/N 处未保存修改/已保存`）、`:564-566`（“检查 · N”为文本，不是徽标）。
- **差异**：设计要求保存/检查状态“文字 + 图标”，实现只有文字；项目约定“状态一律文字 + 图标”，此处缺失图标与徽标层级。
- **原因**：直接原因：保存态用字符串条件渲染（C7）。根本原因：未复用设计/组件库的 Icon+Badge 组合表达状态（C7）。
- **影响**：状态可识别性下降（尤其深色/低对比主题下）；与设计工具栏视觉不一致。
- **建议**：按设计阶段渲染图标（check/dot/spin/help/alert）+ 文案，检查问题数用 Badge 而非拼接文本。
- **验证**：静态；需 GUI 四主题确认。
- **关联状态**：`ready`、`dirty`、`unknown`、`conflict`

### P10-06: 画布操作引导（tip）与步骤/连线计数浮层缺失
- **严重度**：P3
- **维度**：结构 / 交互
- **类别**：结构
- **设计依据**：`originals/main/pages/workflow-editor.html:14-16`（`.tip` 浮层样式）、`:112`（画布右上计数浮层“N 个步骤 · M 条连线”）、`:114-115`（首次进入的“怎么修改流程”提示卡，4 条操作说明 + 关闭并写入 localStorage）。
- **实现位置**：`apps/web/src/pages/workflows/WorkflowGraphCanvas.tsx:54-59`（工具栏一行提示“拖动空白平移 · Ctrl/⌘ + 滚轮缩放 · 拖动端口连线”）、`:71`（底部说明“N 个步骤 · M 条依赖。没有前驱的步骤可同时就绪……”）。
- **差异**：设计有可关闭的首次使用引导卡（点击步骤/步骤右侧+/连线中间+/拖动缩放）与画布右上计数浮层；实现把操作说明压缩成一行工具栏提示，计数放在底部说明里；没有“步骤右侧 +”的直接操作（只能面板/工具栏添加，连线中点 + 已实现）。
- **原因**：直接原因：帮助内容未按设计呈现（C4/C3）。根本原因：画布重写时把设计浮层简化为静态提示，未做首次使用引导。
- **影响**：首次使用者缺少操作发现路径；计数不显眼；不影响核心编辑。
- **建议**：补设计 tip 卡（可关闭并持久化）与计数浮层；说明文案与设计一致（“连线”而非“依赖”或两者兼注）。
- **验证**：静态；需 GUI 确认浮层位置/关闭记忆。
- **关联状态**：`ready`

### P10-07: 开始/交付系统节点不可移动、无设计提示
- **严重度**：P3
- **维度**：A / V
- **类别**：交互
- **设计依据**：`originals/main/pages/workflow-editor.html:58-64`（`start`/`end` 系统节点存在）、`:84`（`onSelect`：系统节点提示“开始”是系统节点：可以移动，不能删除 / “交付”在所有必需步骤通过后收束）。
- **实现位置**：`apps/web/src/pages/workflows/WorkflowGraphCanvas.tsx:43-44`（`__start`/`__end` 节点 `draggable:false`、`connectable:false`）、`:64`（`onNodeClick` 忽略 `__` 前缀，不弹提示）。
- **差异**：设计允许移动系统节点并提示“可以移动，不能删除”；实现完全固定且点击无任何反馈。
- **原因**：直接原因：系统节点建模为不可交互固定节点（C5）。根本原因：把系统节点当成纯装饰，未实现设计的可拖动 + 提示语义（可能为了保持依赖图布局稳定）。
- **影响**：用户无法调整与系统节点的视觉距离；点击无反馈会疑惑节点是否可选；不影响依赖数据。
- **建议**：允许移动（位置不参与保存或保存为布局偏好），点击系统节点给 toast/说明（与设计一致）。
- **验证**：静态；需 GUI 拖拽确认。
- **关联状态**：`ready`、`builtin`

### P10-08: 步骤高级设置字段与服务契约不符（缺单步预算/允许项目外写入；改为可选/前驱）
- **严重度**：P3
- **维度**：结构 / 数据契约
- **类别**：数据契约
- **设计依据**：`originals/main/pages/workflow-editor.html:148-153`（“高级设置”：输入（只读 chip “上一步产出 · 需求说明与验收标准”）、单步预算上限（例如 2.00 美元）、允许写入项目外目录（勾选，开启后执行时仍逐次请求授权））。
- **实现位置**：`apps/web/src/pages/workflows/WorkflowEditorPage.tsx:782-829`（高级设置=可选步骤 + 前驱步骤勾选）、`:780`（输入映射为独立可编辑字段）；`packages/shared/src/domain/models.ts:144-161`（`MethodStepDefinition` 无预算/外部写入字段）。
- **差异**：设计的两个高级字段（单步预算、项目外写入）在方法步骤契约中不存在，实现无法呈现，只能放可选/前驱等真实字段；输入映射从只读 chip 变成了可编辑清单。
- **原因**：直接原因：契约无对应字段（C1）。根本原因：预算/授权在产品中由设置/执行授权层承担，未进入方法定义；设计稿把执行期能力放进了方法编辑层，属于设计/契约边界问题（C9 待确认）。
- **影响**：方法作者无法按设计预设单步预算/外部写入；用户看到的“高级设置”与设计不同但都是真实字段，不构成假数据。
- **建议**：产品确认这两项是否属于方法层：若属于，需扩展契约并由执行消费；若不属于，在设计验收中记录 C9 并在编辑器说明“预算/授权在任务计划与设置中配置”。
- **验证**：静态；需产品/契约确认。
- **关联状态**：`dirty`、`ready`

### P10-09: 内置只读态工具栏多出设计没有的禁用控件
- **严重度**：P3
- **维度**：结构
- **类别**：结构
- **设计依据**：`originals/main/pages/workflow-editor.html:96`（builtin 分支只渲染“内置流程不能直接修改”提示 + “复制后修改”按钮；不渲染保存态/撤销/重做/添加步骤/检查/保存）、`:106`（内置信息横幅）。
- **实现位置**：`apps/web/src/pages/workflows/WorkflowEditorPage.tsx:534-593`（内置态仍渲染撤销/重做/添加步骤/检查（可用）/复制后修改，均带禁用原因）、`:489-496`（信息横幅）。
- **差异**：设计在内置态隐藏所有编辑控件（只留复制），实现保留一排禁用按钮（检查按钮甚至可点），工具栏更拥挤且交互预期不同。
- **原因**：直接原因：工具栏未按只读分支收敛（C4）。根本原因：实现倾向“展示但禁用并给原因”，与设计“隐藏”策略不同；两者都合理但未在设计层确认。
- **影响**：内置流程页面工具栏噪音；用户可能尝试点击禁用按钮（原因可见，影响小）。
- **建议**：按设计隐藏编辑控件，仅保留检查（若产品认为只读检查有用需设计确认）与复制后修改。
- **验证**：静态；需 GUI 对照内置态。
- **关联状态**：`builtin`

### P10-10: 检查浮层/删除确认的层级与可访问性细节偏离设计
- **严重度**：P3
- **维度**：V / K
- **类别**：样式 / 可访问性
- **设计依据**：`originals/main/pages/workflow-editor.html:18-19`（检查结果浮层：画布内右上 `right:16px;top:56px;width:320px`，标题行含关闭 X 与问题数）、`:49`（删除确认 `role="alertdialog"`，默认聚焦“保留”）。
- **实现位置**：`apps/web/src/pages/workflows/workflows.css:353-369`（`.wfe-check` `position:fixed;right:24px;top:96px;width:360px`）、`WorkflowEditorPage.tsx:627-668`（检查浮层带“检查来源”说明与“关闭”按钮）；`WorkflowEditorPage.tsx:849-861`（删除 Modal）；`apps/web/src/components/Modal.tsx:31-44`（`role="dialog"`、初始聚焦对话框本体，无默认聚焦“保留”）。
- **差异**：检查浮层位置/宽度与设计不同且固定于视口（画布滚动时不再跟随画布）；删除确认不是 alertdialog、默认焦点不在“保留”；检查浮层多出“检查来源”提示（可保留但设计没有）。
- **原因**：直接原因：浮层/对话框沿用通用组件与固定定位（C7/C8）。根本原因：共享 Modal 不支持 alertdialog/初始安全焦点（与 GLB-13 同源），检查浮层未按画布内定位实现。
- **影响**：检查结果与画布空间关系不同（遮挡/不跟随）；破坏性确认的键盘安全性不足。
- **建议**：检查浮层改为画布内 overlay（设计坐标）或明确产品化定位；“删除”改用 alertdialog 语义并默认聚焦“保留”（与 P09-09 一并修 Modal）。
- **验证**：静态；需 GUI 键盘验证。
- **关联状态**：`unbound`、`dirty`

## 已核对一致

**P08 开始任务**
- 一页三段“项目→目标→流程”结构、320px 右侧总结卡、项目/流程单选卡 + 400 抽屉（`StartPage.tsx:394-431,495-507`、`apps/web/src/pages/start/start.css:7-12,65-90,209-292`、`StartCatalogPicker.tsx:5-10`；设计 `start.html:11,28-39,65-76`）。
- 常用项目/常用方法各 3 个，选择“其他项”后回到 3 张卡内可见（`StartPage.tsx:164-168`）。
- 自动命名：空白折叠 + 截 60 字符 + “留空时从目标自动生成”提示（`StartPage.tsx:32-35,452-479`；设计 `start.html:102-103,145-149`）。
- 自动聚焦：切选项目后聚焦目标文本域（`StartPage.tsx:163`；设计 `start.html:199`）。
- 版本核对：读取当前方法版本、展示 `revision`、“已核对当前版本”说明、提交携带 `expectedMethodRevision`（`StartPage.tsx:161,217,510,528-535`；设计 `start.html:99,173`）。
- 未命名占位“未命名任务”与提交按钮禁用原因（`StartPage.tsx:523,603-608`）。
- “只建草稿”说明：`不会调用模型、不产生费用`、页头 lede 说明确认前不执行（`StartPage.tsx:349,609-611`；v5 pe01 `start.js:16`）。
- pe01 方法卡信息字段：必经步骤（可细化高亮）/可按需求拆分/AI 规划支持/模板任务入口（`StartPage.tsx:55-105,107-127`；`start.js:8-27`）。
- 项目深链 `?project=`、方法深链 `?methodId=` 生效并校验（`StartPage.tsx:149-160,169-175`），无隐式默认项目。

**P09 流程目录**
- 分段筛选带真实数量（全部/我的流程/程序内置）、搜索即时过滤名称/说明/id（`WorkflowsPage.tsx:111-136`；设计 `workflows.html:130-133`）。
- 目录加载骨架与目录读取失败重试、搜索词状态保留（`WorkflowsPage.tsx:263-270,385-395`）。
- 详情加载骨架与详情读取失败（`WorkflowsPage.tsx:438-444`；设计 `workflows.html:82`）。
- 详情动作：用这个流程开始任务（带 `methodId` 深链）、编辑流程/查看步骤、复制、归档、内置只读说明（`WorkflowsPage.tsx:458-521,473-477`；设计 `workflows.html:94-100`）。
- 复制/归档对话框的预填、确认、回执与取消（`WorkflowsPage.tsx:568-619`）；归档结果未明只核对原请求（`:143-162`）。
- 详情使用记录：总数/当前版本数/最近任务与跳转（`WorkflowReadDetails.tsx:22-29`；设计 `workflows.html:93`）。
- v5 AI 规划只读节主体：规划策略 id/version、规划职责（链接角色页）、可细化分组、固定步骤、服务实际上限、policyHash、只读说明（`WorkflowReadDetails.tsx:10-21`；设计 `workflows.html:106-113`）。
- op-unknown 按原请求号核对、不自动重发（`WorkflowsPage.tsx:361-381,143-162`；产品规则见 `pending-commands.ts` 与 `client.ts:192`）。

**P10 流程画布**
- 即开即编辑、标题内联改名（`WorkflowEditorPage.tsx:506-517`；设计 `workflow-editor.html:93`）。
- requires 依赖图：真实依赖边、并行分支、插入/连接/断开、拖动/缩放/适应/自动排列（`WorkflowGraphCanvas.tsx:35-72`、`workflow-graph.ts:4-57`；设计 `:80-87,:108-118`）。
- 步骤编辑：谁来做（排除规划职责，符合 v5“不出现在谁来做”）、这一步做什么、产出、验收标准、步骤类型/分组、之后步骤、输入映射、可选/前驱依赖（`WorkflowEditorPage.tsx:692-829`；设计 `:121-157`）。
- 节点增删插：添加下一步/并行步骤/连线/前插入、删除重连、删除确认（`WorkflowEditorPage.tsx:254-275,414-425,766-779,849-861`；设计 `:161-171`）。
- 撤销/重做 + ⌘Z/⇧⌘Z（且输入框内不触发）（`WorkflowEditorPage.tsx:145-185`；设计 `:178-181`）。
- 检查：服务端 validate + 本地规则合并、问题列表逐条定位（`WorkflowEditorPage.tsx:277-309,644-663`；设计 `:183-195`）。
- 保存态：未保存数、保存中、结果未明锁定+按原请求核对、版本冲突横幅+查看最新版本+导出修改（`WorkflowEditorPage.tsx:311-348,350-371,430-497,886-905`；设计 `:69,:97,:104-105,:191-195`）。
- 内置只读：标题/画布/面板只读、复制后修改、版本差异标记（`WorkflowEditorPage.tsx:80-81,489-496,567-581`；设计 `:55,:82,:96`）。
- 禁用原因：所有主要禁用按钮都带 `disabledReason`（`WorkflowEditorPage.tsx:534-593`；可达性缺口见 GLOBAL `GLB-13`）。
- 步骤模板来自服务真实目录（不造示例数据）（`WorkflowEditorPage.tsx:834-841`）。

## 需 GUI / 运行验证

1. **P08-01/P08-03**：真实服务 + 断网/超时/刷新场景下 `/start` 的未明横幅、锁定、原请求核对（需真实服务，静态只证明分支缺失）。
2. **P08-02**：项目读取失败时三段表单与已写目标是否保留（需制造 bootstrap 失败）。
3. **P08-04/P08-05/P08-06**：默认方法卡三类可见性、模板型方法抽屉项、版本过期错误后的恢复（需真实目录 + 制造流程改版）。
4. **P08-08**：start 页 1120/1360 宽度、320 侧栏、四主题 × 1440/1280/1024 排版与磁贴/步骤编号观感。
5. **P09-01/P09-02**：关闭详情→全宽列表、慢网络下加载骨架优先于空态（需 GUI 操作）。
6. **P09-03**：目录规模/排序、是否出现“加载更多”需求（需真实目录数据）。
7. **P09-04/P09-05**：并行步骤并排效果、内置流程职业徽标在真实服务（默认无绑定）下的观感。
8. **P09-06**：“创建并编辑”点击后的实际落点、空画布态是否出现。
9. **P09-07**：从需求画布/规划职责带 `back` 进入的返回按钮（需真实跳转链路）。
10. **P10-01/P10-02**：画布页宽度、480 内联侧栏 vs 520 覆盖抽屉的遮挡与焦点行为；删除全部步骤后的空态。
11. **P10-03**：人工职责/verify 质量评审在真实执行中的实际语义。
12. **P10-06/P10-07/P10-10**：tip 浮层、计数浮层、系统节点拖拽、检查浮层坐标、删除确认焦点（四主题 + 键盘）。
13. **四主题一致性**：本区域所有页面 `deepseek/warm/spdb/github-white` 未做截图对比（V 维度需 GUI）。

## 未覆盖 / 说明

- **未运行 GUI、构建、测试，未写任何数据**（按任务约束只读审计）；V（像素/四主题/断点）与 K（真实 Tab/方向键/读屏）均需 GUI 复验。
- **设计冲突 C9（需 Lead 裁决）**：`originals/main/pages/start.html` 与 `originals/planning/start.html`（pe01）对 start 页给出不同口径——主稿：标题“开始一个任务”、三步“接下来”、ready 未选流程；pe01：标题“描述要做的事，选择流程方法”、四步“接下来”、默认选中 `dev`。本报告以主稿为主核对三段结构，仅用 pe01 核对方法卡/模板入口；实现取主稿标题 + 混合了 pe01 的默认选中，建议 Lead 明确以补充稿优先（v5）还是主稿为准。
- **文档口径 C10（报 Lead，不占主清单）**：`docs/design-coverage.md:142-143` 仍称 workflows 无使用次数、workflow-editor 无拖拽/缩放/模板抽屉/视觉 diff，当前代码均已实现（`WorkflowsPage.tsx:315-319`、`WorkflowReadDetails.tsx:22-29`、`WorkflowGraphCanvas.tsx:61-62`、`WorkflowEditorPage.tsx:834-847`）；`docs/review/design-parity.md:32-33` 仍称 `workflow-editor` 无路由，当前已有 `/workflows/:id/edit`（`apps/web/src/app/App.tsx:52`）。
- **同类根因引 GLOBAL**：页头双标题/页头 hint 缺失（`GLB-05`）、Modal/Drawer 焦点陷阱与禁用原因可达性（`GLB-13`）本文件不重复计数，仅作关联引用。
- **设计外扩展（C9/范围，不计缺陷）**：`/workflows` 的“显示已归档”开关、`/workflows/:id/edit` 的“从步骤模板添加/查看本地修改对照/版本对照”等设计未定义能力；工作流详情的“最近任务列表”比设计多展示执行生命周期（与 P09-07 语义问题相关但本身是真实数据）。
- **未审计**：`originals/delivery/start.html`（TD 交付开始态，归区域 15）、`sources/planning/` 中 tasks/task 的 pe14/pe33-38（归区域 07）、`requirement` 画布的 pe02–pe37（归区域 06）、`git`/`node` 补充稿；workflows 历史版本的独立页面设计（不存在独立 mock）。
- **需真实服务确认的静态推断**：内置方法默认无 `roleId`（P09-05）基于 `packages/shared/src/config/catalog.ts` 与角色包绑定逻辑；若实际部署导入过带 `bindings` 的角色包，详情会显示原始 roleId 而非“未指定职业”，但“原始 id 外露/无职业名”问题仍在。
- 本文件只记录问题与证据，未修改任何代码、设计稿或其他文档。
