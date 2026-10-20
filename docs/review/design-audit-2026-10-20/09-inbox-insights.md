# P14 待处理中心 + P15 质量与用量 前端设计一致性审计

> 基线：main @ `3f6f9b2`（2026-10-20）。范围：`opencode-workflow-design-showcase/originals/main/pages/inbox.html`（9 状态 + 页面内联「规划事项」区块 v5）、`insights.html`（5 状态）、planning 补充入口态 `e-inbox`（`sources/planning/STATES.md:135`）vs 实现 `apps/web/src/pages/{inbox,insights}/`、路由 `/inbox`、`/insights`（`apps/web/src/app/App.tsx:42,52`）。审计方式：静态代码 vs 只读设计稿；未运行 GUI 的部分标注“需GUI”。旧审查只作线索，结论均已在当前代码核实（见「未覆盖 / 说明」C10 条）。

## 概览

| 页面 | 设计状态数 | 已逐项核对 | P0 | P1 | P2 | P3 | 结论 |
|---|---|---|---|---|---|---|---|
| P14 待处理中心（`inbox.html`） | 9（+planning `e-inbox` 1；主稿内联 v5「规划事项」13 项区块） | 是 | 0 | 1 | 3 | 5 | 与设计有偏差：回答/权限主流程在，未知结果映射、权限两卡、计数口径待修 |
| P15 质量与用量（`insights.html`） | 5 | 是 | 0 | 0 | 4 | 3 | 与设计有偏差：列表态、三卡口径、Tokens 条、加载态待修 |

**最重要的问题（≤5 条）**
1. `P14-02` 回答提交遇到网络超时/断连时被当“回答未提交”普通失败：页面不锁内容、不出示设计的结果未明横幅与按原请求号核对入口（客户端层面只是靠 pending key 拦住重发），与设计 UNKNOWN 态和 AGENTS 回执纪律不符。
2. `P14-01` 设计 v5 要求「规划事项 N 项需要你处理 · 与任务列表“需要处理”同一口径」，实现没有该区块/汇总：页脚只统计规划交互 + 运行时事项，导航角标又是 `attention=waiting_user` 的任务数，三处口径不同。
3. `P14-03` 权限请求缺设计的「授权范围」两卡（仅这一次/本次会话内都允许）与「请求的操作/原因」分节、策略禁止的 danger 警示；对应 CSS `inbox.css:183-199` 已写好但无组件引用。
4. `P15-04` Insights 加载中/读取失败时第三汇总卡显示 `0 / 0`「全部任务共 0 个」，把未知渲染成真实零，违背数据诚实原则且与设计骨架/未知态不符。
5. `P15-02` 三汇总卡口径与设计不同：设计第三卡“已加载且有用量的任务 3 / 已加载 5 个 · 只统计已加载行”，实现按整个筛选范围统计，且设计表格 footer「已加载 N 个任务 · 18:00 快照 + 加载更多」不存在。

## 状态覆盖

### P14 待处理中心（`originals/main/pages/inbox.html`，states 见 `:148-150`）

| mock state | 设计名称 | 实现判定 | 证据（实现文件:行 / 无） | 说明 |
|---|---|---|---|---|
| `question` | 问题（单选 + 多选） | 已实现 | `InboxPage.tsx:325-361,399-437`；`components/QuestionInput.tsx:10-20`；`http.ts:1906-1926`（规划轮次交互） | 单选/多选/推荐标记/其他回答/采用推荐答案/已回答 n/m 均有；选项控件视觉差异见 P14-06 |
| `draft` | 问题 · 有草稿 | 已实现 | `InboxPage.tsx:460,536-566,803-816`；`InteractionRow:127-130`（有草稿徽标） | 切换事项「保留草稿/放弃草稿」对话框与设计一致；草稿仅在页面内存/查询缓存，刷新后不保留（见说明） |
| `permission` | 权限请求 | 部分 | `RuntimeInbox.tsx:12-44`（真实运行时权限）；`InboxPage.tsx:657-659`（并入左列表） | 动作 once/session/reject 存在；缺设计的两卡授权范围/分节/hard 警示（P14-03） |
| `hard` | 策略禁止 | 部分 | `RuntimeInbox.tsx:28,35`（“策略已阻止”+知道了） | 有不可授权说明与“知道了”；缺设计 danger 横幅与列表/详情 Badge（P14-03） |
| `unknown` | 提交结果未明 | 部分 | `InboxPage.tsx:237-266,387-396`；`flow/workflow-ui.tsx:114-155`（ReceiptNotice 按原 key 核对） | 服务返回 accepted/unknown 回执时锁定+只核对 ✓；网络不确定错误未映射 UNKNOWN（P14-02） |
| `readback` | 已接受但刷新失败 | 缺失 | 无对应分支；`InboxPage.tsx:387-396` 仅按 receipt/error 两分 | 设计“回答已被接受，但列表刷新失败”的提示与重新读取按钮无承载（P14-05） |
| `empty` | 都处理完了 | 已实现 | `InboxPage.tsx:633-640,680-704` | 左列“队列已空/这一类暂时没有事项”+右侧空态；图标/文案与设计不同（P14-08） |
| `loading` | 加载中 | 已实现 | `InboxPage.tsx:599-612,590-596`（计数 —） | 列表 4 行骨架、筛选计数“—”，与设计骨架语义一致 |
| `error` | 读取失败 | 部分 | `InboxPage.tsx:613-624,680-704` | 计数“—”+“不代表没有事项”保留；设计顶部 danger banner + 隐藏列表/详情的结构不同（P14-08） |
| `e-inbox`（planning 补充） | 待处理中心 · 规划事项（需要答复/候选待审阅/结果待核对三类，回需求画布） | 已实现（三类） | `sources/planning/STATES.md:135`；`InboxPage.tsx:42-72,89-96`；`http.ts:1906-1926` | 三类交互 → `/requirement/:id?returnTo=/inbox`；未另建规划中心 ✓；主稿 v5 的 13 项同口径汇总未实现（P14-01） |
| （主稿内联 v5） | 规划事项 13 项 + “与任务列表需要处理同一口径” | 部分/未实现 | `inbox.html:115,119-135,140`；实现无对应区块（`InboxPage.tsx:586-596,772-779` 仅交互事项计数） | 待准备工作区/待确认计划/选择范围继续规划等条目无承载（P14-01） |
| （实现新增，设计未定义） | 需在画布处理（交付确认/执行失败）+ 运行时问题 | 已实现（产品扩展） | `InboxPage.tsx:137-166,586-587,792-794`；`RuntimeInbox.tsx:35` | 真实服务事项，诚实展示；建议设计/验收同步 |

### P15 质量与用量（`originals/main/pages/insights.html`，states 见 `:108-109`）

| mock state | 设计名称 | 实现判定 | 证据（实现文件:行 / 无） | 说明 |
|---|---|---|---|---|
| `content` | 列表 + 明细 | 部分 | `InsightsPage.tsx:175,196-206` | 默认选中第一行并展示右侧明细；缺“关闭明细/仅列表”能力（P15-01） |
| `list` | 列表（无明细） | 缺失 | 设计 `insights.html:62,66-67,105`（sel=null + `.layout.no` 单列 + 关闭按钮）；实现 `InsightsPage.tsx:171,175`（未选中时回退 `rows[0]`） | 该状态不可达（P15-01） |
| `unknown-usage` | 用量全部未知 | 已实现 | `InsightsPage.tsx:192`（`UnknownValue`）；`shared/domain/insights.ts:27-31` | 首卡未知 + 未知说明；与设计虚线 unknown 样式一致 |
| `loading` | 加载中 | 部分 | `InsightsPage.tsx:196`（仅“正在读取任务与计量…”提示）；`:192-194`（第三卡显示 0 / 0） | 设计表格 4 行骨架+首卡骨架；实现无骨架且第三卡误写零（P15-04） |
| `error` | 读取失败 | 部分 | `InsightsPage.tsx:188-190`（ServiceNotice+保留快照提示） | 快照与筛选保留语义有；文案为通用“服务未连接/数据读取失败”，且无数据时第三卡仍 0/0（P15-04） |

## 问题清单

### P14-01: 「规划事项」汇总与“与任务列表需要处理同一口径”未实现，计数三处口径不同
- **严重度**：P2
- **维度**：S / 结构 / D
- **类别**：结构 / 数据语义
- **设计依据**：`opencode-workflow-design-showcase/originals/main/pages/inbox.html:115,119-135`（state：`question/draft/permission/hard` 内联 v5 规划事项区块；`:135` 原文要点“13 项需要你处理 · 与任务列表“需要处理”同一口径 · 在需求画布处理”；`:125-126` v5 注释“规划侧需要你处理的事项与任务列表‘需要处理’同一口径，全部列在这里”）；补充稿 `sources/planning/STATES.md:135`（e-inbox：需要答复、候选待审阅、结果待核对三类回需求画布，不另建规划中心）。
- **实现位置**：`apps/web/src/pages/inbox/InboxPage.tsx:586-596`（页脚/筛选计数只来自规划交互 + 运行时事项）、`:772-779`（“打开 N · 待核对 M”）、`:657-659`（运行时事项拼入左列）；`packages/engine/src/project-task.ts:602-654`（`InboxService.list` 只产生 planning_answer/review/reconcile、delivery_confirm、runtime_*）；`packages/server/src/http.ts:1906-1926`（交互列表仅规划轮次）；对照：`packages/shared/src/domain/task-list.ts:4-8`（任务列表“需要处理”= attention≠none 或交付/规划异常，范围更大）、`packages/server/src/http.ts:427`（导航角标=`attention=waiting_user` 任务数）、`apps/web/src/app/Shell.tsx:53,96`。
- **差异**：设计承诺的「N 项需要你处理 · 与任务列表需要处理同一口径」区块与总数不存在；页脚“打开/待核对”是**事项数**、导航角标是 **waiting_user 任务数**、任务列表“需要处理”是 **attention 组任务数**，三者结构上不可能始终相等（例如执行失败/受阻/交付未知/工作区未知任务计入任务列表但不进交互列表；同一任务的多条运行时事项会让事项数 > 任务数）。主稿 13 项中的待准备工作区、待确认计划、选择范围继续规划在 `InteractionKind`/`InboxService` 中无对应来源。
- **原因**：直接原因：待处理中心只按“交互事项”重建列表，未实现设计的规划事项汇总区块与同口径计数（C4/C6）。根本原因：`InteractionKind` 仅 3 种、`InboxService` 无待准备/待确认计划等 kind，且没有“与任务 attention 同口径”的 inbox 汇总端点（C1）；另主稿 13 项扩展与 planning 补充“三类事项”范围不一致（C9，需 Lead 定口径）。
- **影响**：用户无法从待处理中心看到设计承诺的全部规划侧待办与总数；页脚、角标、任务列表三个数字可能互相矛盾，影响“角标同步/数量一致”的产品承诺。
- **建议**：若按主稿 v5 落地：服务提供与任务列表 attention 同口径的 inbox 汇总（并补待准备/待确认计划/选区继续规划 kind），页面增加「规划事项」区块与“N 项需要你处理”总数；若按 planning 补充收敛三类，则在设计/验收文档中明确弃用主稿 13 项并统一三处计数口径（角标=页内总数）。短期至少在页脚标注计数范围，避免用户误以为等于任务列表“需要处理”。
- **验证**：静态 + 需真实服务（构造失败/受阻/多运行时事项任务后对比三处数字）。
- **关联状态**：`question`、`permission`、`hard`、`e-inbox`

### P14-02: 回答提交的网络不确定结果被当“未提交”，未进入设计的 UNKNOWN 锁定/只核对态
- **严重度**：P1
- **维度**：S / A / D
- **类别**：状态 / 交互 / 数据诚实
- **设计依据**：`inbox.html:82`（state：`unknown`；原文“回答已发出，但没有收到确认…内容已锁定。这里只会重新读取事项状态，不会再次提交；事项从列表消失也不代表回答成功。”）、`:63,65`（unknown/readback 时全部控件只读）、`:114`（resolve 提交）。
- **实现位置**：`apps/web/src/pages/inbox/InboxPage.tsx:505-527`（`onError` 只设 `error`，不区分不确定失败）、`:237-266`（`locked`/`submitReason` 只看已返回 receipt）、`:394`（`CommandErrorNotice title="回答未提交"`）、`:423-431`（提交按钮仍可点）、`interactions.ts:23-33`（每次调用新 `createRequestKey`，不读写持久 pending identity）；对照：`apps/web/src/api/client.ts:185-239`（写请求先 `rememberCommand`、不确定失败改抛“结果待核对…原请求号”、下次同 scope 写被拦截不发送）。
- **差异**：服务返回 accepted/unknown 回执时页面正确锁定并显示 ReceiptNotice 的“按原请求号核对”；但**传输层超时/断连/响应不可读**时页面只显示“回答未提交”失败，内容仍可编辑、提交按钮仍可用，也没有设计的结果未明横幅/只核对入口（目前只能依赖全局 PendingCommands 横幅）；列表行也不会出现设计的“结果未明”徽标。首次失败后客户端虽阻止了真正重发（旧 key 仍在 pending），但错误标题与“未提交”语义误导用户，且新点击会先本地抛错（错误信息里的请求号是刚生成的新 key，不是原 key）。
- **原因**：直接原因：页面未把 `isUncertainCommandFailure`（timeout/unavailable/protocol）映射为 UNKNOWN，也未复用持久 pending identity 展示原 key（C2/C5）；根本原因：`interactions.ts` 是裸 `createRequestKey()` 封装，没有项目页那样的 pending-identity 恢复机制（C5）。
- **影响**：写回答的用户会误以为“没提交”而反复尝试（被本地拦截但信息混乱）；无法在页内按原请求号核对，可能把已成功但列表变化误判为失败；违背设计“内容锁定、只重新读取/核对”的关键状态。
- **建议**：`resolveInteraction` 接受/返回持久 requestKey（或复用 `rememberCommand` + `pendingIdentityForPath`）；`onError` 对不确定失败进入本地 UNKNOWN：锁 inputs、渲染设计同款 unknown banner（含原 key）与「按原请求号核对」（GET `/api/operations/:key`），成功/失败结算后再解锁；列表行在本地 unknown 期间显示“结果未明”。
- **验证**：需真实服务（断网/超时/响应丢失场景）+ GUI；静态已确认分支缺失。
- **关联状态**：`unknown`、`question`、`permission`

### P14-03: 权限请求缺设计「授权范围」两卡、请求操作/原因分节与策略禁止警示
- **严重度**：P2
- **维度**：结构 / V / T
- **类别**：结构 / 样式 / 文案
- **设计依据**：`inbox.html:93-101`（state：`permission`/`hard`；徽标“权限请求/策略禁止”、请求的操作 code 块、原因、`:97-99`「授权范围」两卡“仅这一次 / 本次会话内都允许”、`:96` 策略禁止 danger 横幅“不能在这里授权…”、`:100-101` 按钮层级）。
- **实现位置**：`apps/web/src/pages/inbox/RuntimeInbox.tsx:27-42`（h3+纯文本行+`patterns` 列表+按钮；无分节/两卡/横幅）；`apps/web/src/pages/inbox/inbox.css:183-199` 已定义 `.inbox-scope-grid/.inbox-scope-card` 但全仓 TSX 无引用（grep 0 命中）。
- **差异**：设计的两个授权范围说明卡变成两个普通按钮（“本会话允许/仅这一次”），没有解释授权后果；缺少 `请求的操作`、`原因` 的 eyebrow 分节；hard 项没有 design 的 danger 横幅和列表徽标，只有标题文字与 hint；权限/策略的徽标（st-fail/st-danger + lock/shield 图标）没有用 Badge 呈现。
- **原因**：直接原因：运行时事项详情用最简 JSX 重建，未消费已写好的 scope 样式（C4/C7）。根本原因：RuntimeItem 与设计详情组件未拆共享结构，扩展时只保功能不保信息架构。
- **影响**：用户难以区分“仅这一次”和“本会话内都允许”的后果；策略禁止的“不可在此授权”不够醒目，容易误解为可授权。
- **建议**：复用 `.inbox-scope-grid/.inbox-scope-card` 渲染两卡，补“请求的操作/原因”分节与 hard danger banner、列表/详情 Badge；两卡与底部按钮联动（选中态或直接动作二选一）。
- **验证**：静态已确认 CSS 未引用；视觉/交互需 GUI。
- **关联状态**：`permission`、`hard`

### P14-04: 「拒绝」缺少设计的确认对话框
- **严重度**：P2
- **维度**：A / T
- **类别**：交互 / 文案
- **设计依据**：`inbox.html:47`（`rejectDlg`「拒绝这个事项？…”）、`:113`（问题：“任务会收到‘拒绝回答’，由执行中的步骤决定如何继续”；权限：“这一步不会获得读取权限，会尝试在没有这些文件的情况下继续”）、`:100-101`（拒绝按钮）。
- **实现位置**：`apps/web/src/pages/inbox/RuntimeInbox.tsx:35-38`（问题/权限的 `拒绝` 直接 `submit.mutate('reject')`，无确认）；`InboxPage.tsx:399-408`（规划问题“拒绝回答”被禁用，服务无拒绝接口）。
- **差异**：设计对拒绝有 alertdialog 并解释后果；实现权限/运行时问题的拒绝一键提交，无确认、无后果说明。
- **原因**：直接原因：拒绝动作未接确认步骤（C5）。根本原因：运行时事项按钮直接绑定 mutation，未复用设计已有的对话框结构。
- **影响**：误点会直接向运行时发送拒绝，导致步骤在无权限/无答复下继续，且不可撤销；用户没有机会确认。
- **建议**：拒绝前弹设计同款 Modal（标题“拒绝这个事项？”+按 kind 的后果文案+返回/拒绝）；成功/unknown 走同一回执展示。
- **验证**：静态；GUI 点测。
- **关联状态**：`permission`、`hard`、`question`

### P14-05: `readback` 态缺失、`unknown` 文案与设计不同
- **严重度**：P3
- **维度**：S / T
- **类别**：状态 / 文案
- **设计依据**：`inbox.html:83`（state：`readback`；“回答已被接受，但列表刷新失败…不需要重新提交。稍后重新读取即可看到最新列表。”+重新读取）、`:82`（unknown 原文）、`:84`（done “已提交，任务会继续执行。”）。
- **实现位置**：`InboxPage.tsx:387-396`（只有 receipt/error 两分支；成功回执走 `ReceiptNotice` 的通用“回答已提交，需求修订已更新。”）；`:613-624`（列表读取失败通用提示）。
- **差异**：没有“已接受但列表刷新失败”的专门状态；UNKNOWN 网络失败文案见 P14-02；“已提交”文案与设计不同。
- **原因**：直接原因：状态机只按回执/错误两分，未区分配套列表刷新结果（C2/C3）。
- **影响**：刷新失败时用户可能重复尝试或误判；提示信息较设计弱。
- **建议**：resolve 成功后若 interactions 失效查询失败，显示设计 readback 横幅并允许只重新读取；统一 done/unknown 文案。
- **验证**：需真实服务 + GUI。
- **关联状态**：`readback`、`unknown`

### P14-06: 问题选项控件视觉与设计不同（自定义答案卡 → 原生 radio/checkbox）
- **严重度**：P3
- **维度**：V / K
- **类别**：样式 / 可访问性
- **设计依据**：`inbox.html:22-34`（`.q-h`、`.ans`、`.mk.radio/box`、`.rec` 推荐 pill、说明）、`:88-90`（题号 x / m、单选/多选提示、选项卡、其他回答 input）。
- **实现位置**：`apps/web/src/components/QuestionInput.tsx:10-20`（原生 radio/checkbox + label、推荐 Badge、textarea “其他回答（可选）”；无 `.ans` 卡片视觉/圆形单选标记）。
- **差异**：交互可达、单选互斥/多选/推荐标记/其他回答均正确，但视觉与设计（大卡片、圆形/方形标记、描述层级）不同，其他回答由 38px input 变 textarea。
- **原因**：直接原因：共用 QuestionInput 采用原生控件样式（C7）。
- **影响**：视觉一致性下降；功能不受影响。
- **建议**：为问题输入加设计对应的 `.ans` 卡片样式（保留原生控件可访问性），其他回答用单行 input 样式。
- **验证**：需 GUI（四主题）。
- **关联状态**：`question`、`permission`

### P14-07: 列表分段 3 段 → 5 段、行信息结构与设计不同
- **严重度**：P3
- **维度**：结构 / T
- **类别**：结构 / 文案
- **设计依据**：`inbox.html:143`（state：全部/问题/权限 3 段 + 计数）、`:72-75`（行：tile、标题、“问题/权限 · 任务 · 时间”、有草稿/策略禁止/结果未明徽标）。
- **实现位置**：`InboxPage.tsx:66-72`（全部/需要回答/待审阅/待核对/权限策略 5 段）、`:123-130`（行：短标签 · stepName · 相对时间；taskTitle · projectName；徽标）。
- **差异**：分段数 3→5（按规划三类拆分 + 权限策略），行文档信息由“任务/时间”变“规划轮次/项目名”，多一行 meta。属规划补充稿驱动的产品扩展，但设计稿未同步。
- **原因**：直接原因：按 `InteractionKind` 细分筛选并展示项目（C4/C3）。根本原因：主稿未按 planning 补充稿更新筛选/行结构。
- **影响**：与原型对照时视觉差异明显；功能更细。
- **建议**：设计稿/验收文档同步 5 段口径；或保持 3 段主筛选 + 二级筛选。
- **验证**：静态 + GUI。
- **关联状态**：`question`、`draft`、`permission`、`hard`

### P14-08: 空/加载/错误态与页头文案细节与设计不同
- **严重度**：P3
- **维度**：S / T / 结构
- **类别**：状态 / 文案
- **设计依据**：`inbox.html:139`（页头 title+短 lede“执行中的任务需要你回答问题或授权时，会停下来在这里等你。”）、`:70-71`（loading 3 行骨架、empty 成功色 check tile +“都处理完了…会出现在这里。”）、`:141`（顶部 danger banner“待处理事项读取失败 · 待处理数量暂时未知，不代表没有事项。”）、`:143-144`（error/loading 隐藏详情）。
- **实现位置**：`InboxPage.tsx:721-743`（PageHeader 长 lede + 文字“刷新”按钮）、`:599-624`（列表骨架 4 行；error 为左卡内 ServiceNotice、右详情空态）、`:633-640,680-704`（空态文案）。 
- **差异**：页头 lede/刷新控件形态不同；error 结构从顶部 banner+隐藏详情变为卡内提示+详情空态；empty 文案/图标不同；loading 行数不同。
- **原因**：直接原因：页面按实现需要重写状态容器（C3/C4）。
- **影响**：与设计稿有可见差异，不阻断功能。
- **建议**：统一页头短文案与刷新图标按钮；error 用设计顶部 banner 并隐藏两栏；empty 使用成功 tone 图标与设计原文。
- **验证**：GUI。
- **关联状态**：`loading`、`empty`、`error`

### P14-09: 提交门槛“全部问题必答”与“仅必答题”不同
- **严重度**：P3
- **维度**：A / T
- **类别**：交互 / 语义
- **设计依据**：`inbox.html:103-107`（state：`question`；foot 的 `all = n === i.qs.length`，进度文案“已回答 n / m，每题至少选一项或填写”，未答满即禁用提交）；`:89`（选项无 required 概念）。
- **实现位置**：`InboxPage.tsx:246-266`（`missingRequired` 只统计 `required` 的题）、`:409-411`（“已回答 n / m · 必答题需填写”）；契约 `packages/shared/src/api/contracts.ts:200-209`（问题带 `required`）。
- **差异**：设计所有问题都需回答才可提交；实现允许可选问题留空提交（服务模型有 required）。由服务契约驱动的更细语义，但设计稿未登记。
- **原因**：直接原因：按 `required` 计算提交门槛（C6）；根本原因：设计 mock 没有可选问题概念（C9 设计缺口）。
- **影响**：用户可能在设计预期“必须全部回答”的场景下少答可选问题；属产品化改进，需要设计确认。
- **建议**：在设计/验收中登记“必答题”扩展；若设计要求全量必答，则提交门槛改为全部题。
- **验证**：静态 + GUI。
- **关联状态**：`question`、`draft`

### P15-01: `list`（仅列表、无明细）态不可达，缺关闭明细按钮
- **严重度**：P2
- **维度**：S / 结构
- **类别**：状态 / 结构
- **设计依据**：`insights.html:62`（state：`content`/`list`；`sel` 仅在 content 时默认 r1）、`:66-67`（明细面板右上“关闭明细”icon-btn）、`:105`（`layout.no` 无选中时单列）、`:108-109`（states：content/list）。
- **实现位置**：`apps/web/src/pages/insights/InsightsPage.tsx:171`（`selectedId` 初始 null）、`:175`（`selected = rows.find(...) ?? rows[0]`，永远回退第一行）、`:196-206`（始终两列 + 始终渲染 TaskDetail）、`:59-69`（明细无关闭按钮）。
- **差异**：设计允许关闭明细回到单列列表；实现没有关闭入口，选中态不可清空，`list` 状态无法到达。
- **原因**：直接原因：`selected` 回退 `rows[0]` 且未提供 set null（C2/C4）。
- **影响**：用户无法只看表格；窄屏/长表格时明细占位无法收起；与设计状态清单不符。
- **建议**：支持 `selectedId=null`（关闭按钮 set null），无选中时用 `layout.no` 单列；保留 content 默认选中第一行。
- **验证**：静态；GUI 点测关闭/刷新后状态。
- **关联状态**：`content`、`list`

### P15-02: 三汇总卡口径与「已加载/加载更多/快照」与设计不一致
- **严重度**：P2
- **维度**：T / D / 结构
- **类别**：数据语义 / 结构
- **设计依据**：`insights.html:101-104`（state：`content`；第一卡“已记录用量”、第二卡“成本·按币种分列”、第三卡“已加载且有用量的任务 3 / 已加载 5 个”“只统计当前已加载的行”）、`:89`（表格 footer“已加载 N 个任务 · 18:00 快照”+“加载更多”）、`:91`（页头 lede“汇总覆盖整个筛选范围，不只是已加载的行”）。
- **实现位置**：`InsightsPage.tsx:191-195`（`.grid-3` 三卡；第三卡标题“有用量的任务”，`knownTasks / rows.length` + hint“当前筛选范围全部 N 个任务；全部任务共 M 个”）、`:196-205`（表格无 footer/加载更多）；服务 `packages/server/src/http.ts:1097`（一次返回 `tasks.allSummaries()` 全量 + usage）。
- **差异**：设计第三卡明确“已加载且有用量/只统计已加载行”；实现按整个筛选范围统计（页头 lede 也改为整个筛选范围）。设计没有实现“加载更多/已加载 N 个 · 快照”footer。设计自身页头（覆盖整个筛选范围）与第三卡（只统计已加载）互相矛盾——`C9` 设计内部矛盾，需要定口径。
- **原因**：直接原因：实现按“筛选范围全量”落地并改写第三卡标题/副文案（C6/C4）；根本原因：服务一次返回全量任务、无分页/快照概念（C1），设计又是分页 API 时期的口径（C9）。
- **影响**：三张汇总卡与设计稿对照时数字与文案含义不同；没有分页时“加载更多”不可用，用户不知道数据是否全量。
- **建议**：与设计确认“汇总覆盖整个筛选范围”（推荐，现有实现与页头一致），据此更新第三卡标题/副文案并在验收文档记录设计矛盾；如坚持“已加载”口径则补服务分页与 footer。
- **验证**：静态 + GUI（筛选后三卡与表格行数联动）。
- **关联状态**：`content`、`unknown-usage`

### P15-03: Tokens 数量横条缺失
- **严重度**：P2
- **维度**：V / 结构
- **类别**：样式 / 结构
- **设计依据**：`insights.html:32-33`（`.tbar`/`.tbar i`：accent 横条按最大 tokens 比例显示）、`:86-88`（Tokens 列：`<div class="tbar"><i style="width:${...}px"></i>${tok}</div>` + “另有 N 条未知”）。
- **实现位置**：`InsightsPage.tsx:202`（Tokens 单元格只有数字与“另有 N 条未知”hint）；`apps/web/src/styles` 中无 `.tbar` 样式（grep 0）。
- **差异**：设计用横向条形编码 tokens 量级（一行内可比较），实现只有数字。
- **原因**：直接原因：表格列按实现重写，未迁移 tbar 视觉（C4/C7）。
- **影响**：用户需要读数字逐行比较；与设计的信息可视化不符。
- **建议**：恢复 `.tbar` 样式与按 `max(tokens)` 比例计算宽度；未知行继续用虚线 unknown 徽标。
- **验证**：需 GUI（数量级/主题）。
- **关联状态**：`content`

### P15-04: 加载中/读取失败时第三卡显示 0 / 0，把未知渲染成真实零
- **严重度**：P2
- **维度**：D / S
- **类别**：数据诚实 / 状态
- **设计依据**：`insights.html:83-84`（state：`loading` 用骨架行/首卡 skeleton；`error` “读取失败…上一次结果已保留在下方之前的快照中。筛选条件未改变。”+重试）、`:100-104`（汇总卡为实际值/未知，不把未知画成 0）。
- **实现位置**：`InsightsPage.tsx:172`（`tasks = taskUsage.data?.tasks ?? []`）、`:174`（summary 由空 rows 计算）、`:191-195`（grid 始终渲染；第三卡 `knownTasks / rows.length`）、`:196`（无数据时只显示“正在读取任务与计量…”）；对照 `InsightsPage.tsx:188-190` 的 error/加载提示。
- **差异**：`taskUsage.data` 未返回（首次加载或读取失败）时 `rows=[]`，第三卡显示“0 / 0”与“全部任务共 0 个”，而设计在 loading 态用骨架、不允许显示零；首卡/成本用 UnknownValue 但第三卡没有。
- **原因**：直接原因：汇总卡没有 loading/error 分支，直接用空数组计算（C2/C6）。根本原因：三卡共用一套渲染，未区分“数据未到/失败”与“真实零”。
- **影响**：首屏或服务读取失败时误导用户“没有任务”；与 AGENTS“无数据/未知必须显示未知”冲突。
- **建议**：`taskUsage.data===undefined` 时三卡显示骨架或未知（不以 0 渲染），读取失败保留快照并提示重试（设计文案）；确认 `rows.length>0` 后才显示比率。
- **验证**：静态 + GUI（首屏/断连/慢服务）。
- **关联状态**：`loading`、`error`

### P15-05: 右侧明细用量格/入口/人工认定呈现与设计不同
- **严重度**：P3
- **维度**：结构 / T
- **类别**：结构 / 文案
- **设计依据**：`insights.html:64-78`（state：`content`；明细：状态+质量徽标、标题、关闭；验收与评审 4 项含“人工认定”；用量 mini 四格=已记录 Tokens/未知记录/耗时/重试；成本单行；底部整宽按钮“查看任务评审”）。
- **实现位置**：`InsightsPage.tsx:59-69`（无质量徽标/关闭）、`:71-79`（新增阶段胶囊+执行进度，设计无）、`:81-113`（`QualityEvidence` 分项 + 新增“记录人工意见/验收通过/驳回”写入表单）、`:115-148`（用量四卡=Tokens/成本/耗时/重试，“未知记录”并入 hint，成本从单行变卡片）、`:150-158`（“查看任务画布”+“任务列表”）。
- **差异**：用量格组成/成本位置与设计不同；底部入口不再是“查看任务评审”；新增阶段与人工验收写入（产品扩展，未改 AI 结论，符合真实服务能力）。
- **原因**：直接原因：明细按实现能力重构（C4/C3）；根本原因：设计是只读评审视图，产品加入人工验收动作与阶段信息（C9 扩展）。
- **影响**：明细信息层级与设计不同，但数据更全；不影响主流程。
- **建议**：恢复设计四格（未知记录独立格、成本单行）与“查看任务评审”入口；人工验收表单作为扩展在设计中登记。
- **验证**：GUI。
- **关联状态**：`content`

### P15-06: 页面未用设计宽版栅格、数字列未右对齐、质量分段多一项
- **严重度**：P3
- **维度**：V / T
- **类别**：样式 / 布局 / 文案
- **设计依据**：`insights.html:48`（`page wide`）、`:11`（tiles `1.2fr 1fr 1fr`）、`:21-23`（layout 1fr+380，≤1180 单列）、`:24-31`（`td.n/th.n` 右对齐+tabular-nums）、`:96`（质量分段：全部质量/通过/待验收/待评审 4 项）。
- **实现位置**：`InsightsPage.tsx:179`（`className="page"`，非 wide，`ds.css:156` 默认 1120px vs wide 1360px）、`:191`（grid-3 等宽）、`:197`（th 全部左对齐，无 numeric class）、`:177`（filterOptions 含 `issues` → “存在问题”第 5 项）。
- **差异**：内容区比设计窄 240px；Tokens/耗时列未右对齐；“存在问题”为设计没有的质量分段（产品扩展，服务质量枚举支持）。
- **原因**：直接原因：页容器/表格/分段沿用实现默认（C7/C3）；根本原因：设计 style 未逐项迁移，质量 issues 是服务扩展（C9 扩展）。
- **影响**：宽屏下表格与明细更拥挤/数字不齐；分段需要设计确认。
- **建议**：加 `page wide`、tiles 1.2fr 与数字列右对齐；“存在问题”在设计/验收文档登记为扩展。
- **验证**：需 GUI（1440/1280/1024）。
- **关联状态**：`content`

### P15-07: 加载骨架/空态容器/hover 细节缺失，验收读取失败不可见
- **严重度**：P3
- **维度**：S / V / D
- **类别**：状态 / 样式 / 数据诚实
- **设计依据**：`insights.html:27-29`（`tbody tr:hover` 背景）、`:83`（loading 表格 4 行 skeleton）、`:85`（empty 在 `section.card` 内）、`:54-58,68-70`（验收与评审分项：程序验收/需求评审/风险评审/人工认定状态）。
- **实现位置**：`InsightsPage.tsx:196-205`（loading 无 skeleton、空态 EmptyState 未包 card、行无 hover 样式）；`:166-167,201`（`taskAcceptance` 查询失败未展示，行内统一显示“节点验收尚未读取或未执行”）。
- **差异**：加载态缺少设计骨架；空态容器结构不同；表格行无 hover；验收读取失败与“未执行”不可区分。
- **原因**：直接原因：视觉细节未迁移（C7/C2）；根本原因：`taskAcceptance.isError` 未参与行内/明细展示（C2）。
- **影响**：视觉与设计不同；用户可能把验收接口失败误读为“任务未执行验收”，影响质量判断。
- **建议**：补 skeleton/hover/空态 card；`taskAcceptance.isError` 时行内/明细显示“验收读取失败”并可重试，不冒充未执行。
- **验证**：GUI + 真实服务（读取失败）。
- **关联状态**：`loading`、`error`、`content`

## 已核对一致

- P14 页头/页宽：`.page wide`、左 360px + 右自适应拆分、错误/加载时右详情不渲染的骨架（`inbox.html:11,45,139` vs `InboxPage.tsx:722`、`inbox.css:2-19`）。
- P14 问题作答：单选互斥/多选/推荐标记/其他回答/“采用推荐答案”/“已回答 n / m”/必答题禁用（`inbox.html:88-91,103-109` vs `QuestionInput.tsx:10-20`、`InboxPage.tsx:329-361,399-437`）。
- P14 草稿切换：保留/放弃草稿对话框、有草稿徽标、切换后草稿仍在（`inbox.html:46,75,110-112` vs `InboxPage.tsx:539-566,803-816`）；草稿为本机会话内存（设计“留在本机”语义的合理实现，刷新丢失见说明）。
- P14 来源条：任务/步骤/等待说明/“在需求（或任务）画布中查看”链接（`inbox.html:81` vs `InboxPage.tsx:280-294,89-96`）；规划事项回需求画布符合 planning 补充。
- P14 已返回回执的 UNKNOWN 锁定：内容只读、ReceiptNotice“结果待核对…只按原请求号查询，不会重新发送”+按原请求号核对（`inbox.html:82` vs `workflow-ui.tsx:114-155`、`InboxPage.tsx:237-266`）；运行时事项的 UNKNOWN 通过 pending key 锁定+“核对原请求”（`RuntimeInbox.tsx:14,26,34`）。
- P14 权限 once/session/reject/hard 四类动作真实接通（`inbox.html:96-101` vs `RuntimeInbox.tsx:35-38`；`docs/verification/2026-10-20-runtime-inbox.md`）。
- P14 空/加载/错误基础态均存在且错误态不把未知当没有事项（`inbox.html:70-71,141` vs `InboxPage.tsx:599-624,680-704`）；筛选计数加载/错误显示“—”（`inbox.html:143` vs `InboxPage.tsx:590-596,766`）。
- P14 角标更新机制：答复/运行时答复成功后 invalidate bootstrap，导航角标随服务计数刷新（`InboxPage.tsx:516-520`、`RuntimeInbox.tsx:20`；验收证据 E26“角标同步”）；但口径问题见 P14-01。
- P14 规划三类事项回需求画布、不另建规划中心（`sources/planning/STATES.md:135` vs `InboxPage.tsx:42-72,89-96`）。
- P15 页头/工具条：标题+lede、搜索 240、项目/状态下拉、质量分段、包含已归档、刷新按钮（`insights.html:91-99` vs `InsightsPage.tsx:180-187`）。
- P15 汇总卡基础语义：已记录用量 + 未知条数、成本按币种分列不换算、未知不等于零、筛选范围统计（`insights.html:100-104` vs `InsightsPage.tsx:191-195`、`shared/domain/insights.ts:27-31`）；差异见 P15-02。
- P15 表格：五列、行可选中（Enter/Space+aria-selected）、质量徽标、未知 tokens 虚线徽标、“另有 N 条未知”、耗时（`insights.html:24-31,86-88` vs `InsightsPage.tsx:197-203`）；Tokens 横条缺失见 P15-03。
- P15 右侧 380px sticky 明细：状态/标题、验收与评审分项、用量四格、成本、入口按钮（`insights.html:64-77` vs `InsightsPage.tsx:59-158`、`QualityEvidence.tsx:8,14-16`）；差异见 P15-05。
- P15 未知用量态：tokens 未知显式未知+原因，不显示 0（`insights.html:34,101` vs `InsightsPage.tsx:26-32,192`、`shared/domain/insights.ts:30`）。
- P15 错误保留快照与筛选：ServiceNotice+“下方保留上次成功读取的快照；筛选条件未改变”（`insights.html:84` vs `InsightsPage.tsx:188-190`）；文案差异见 P15-04。
- P15 过滤：项目按 ID（同名显示目录）、生命周期、质量、标题、归档（`insights.html:94-98` vs `InsightsPage.tsx:173-186`、`shared/domain/insights.ts:23-25`）。
- P15 空态标题/文案“没有符合条件的任务 / 清除筛选后重试”（`insights.html:85` vs `InsightsPage.tsx:196`）。

## 需 GUI / 运行验证

1. 权限两卡/分节/hard danger 横幅的四主题视觉与交互（P14-03）。
2. 拒绝确认对话框与误点保护（P14-04）。
3. 回答提交后断网/超时/响应丢失：页面是否进入 UNKNOWN 锁定、能否按原 key 核对、列表行是否显示结果未明（P14-02，需真实服务 + 网络故障注入）。
4. `readback` 态（已接受但列表刷新失败）与 done 文案（P14-05，需真实服务）。
5. 问题选项单选/多选/推荐/其他回答的样式、键盘与屏幕阅读器（P14-06，四主题）。
6. 多任务/多运行时事项场景下角标、页脚“打开/待核对”、任务列表“需要处理”三处数字一致性（P14-01，需真实服务数据）。
7. Insights 关闭明细回到单列、窄屏布局（P15-01，1024/1280）。
8. Insights 三卡/表格在筛选、未知用量、加载中、断连快照下的状态（P15-02/04）。
9. Tokens 横条、数字列右对齐、宽版栅格（P15-03/06，1440/1280）。
10. 明细“记录人工意见”写入与设计只读评审判定的关系、查看任务评审入口（P15-05）。
11. 真实模型原生 permission 事件与授权后继续执行（P14 权限态，验收文档 E26 标注未覆盖，需真实模型/服务）。

## 未覆盖 / 说明

- **设计内部矛盾（C9，需 Lead 定口径）**：
  - P14：主稿内联 v5「规划事项」13 项 +“与任务列表需要处理同一口径”（`inbox.html:115,119-135`）vs planning 补充 e-inbox 只列需要答复/候选待审阅/结果待核对三类（`sources/planning/STATES.md:135`）。按 METHOD 优先级补充稿高于主稿原稿，实现已满足三类；主稿 13 项扩展（待准备工作区/待确认计划/选择范围继续规划）无服务来源。
  - P15：页头 lede“汇总覆盖整个筛选范围，不只是已加载的行”（`insights.html:91`）vs 第三卡“只统计当前已加载的行”（`:103`）。实现选择前者（全量筛选范围），`docs/review/p14-insights-2026-10-20.md` 也按“整个筛选范围”验收。
- **设计提供而服务明确不提供的动作（C9，不是实现缺陷）**：设计「拒绝回答」规划问题（`inbox.html:100`），服务没有规划问题拒绝接口；实现禁用按钮并写原因“规划问题必须明确回答；服务没有提供拒绝接口”（`InboxPage.tsx:402-408`）。运行时问题的 reject 走真实运行时（`RuntimeInbox.tsx:36`）。
- **产品扩展（数据真实，建议设计/验收同步，不作为缺陷计数）**：运行时权限/问题并入待处理中心与左列表、交付确认/执行失败「需在画布处理」、筛选 5 段、运行时事项独立详情、人工验收写入（`InsightsPage.tsx:81-113`）、质量分段“存在问题”、同名项目显示目录、权限/策略能力提示、Insights 改造为全量筛选范围（无分页/加载更多）。
- **实现细节/死代码（报 Lead，GLB 统一处理）**：`RuntimeInbox.tsx:47-57` 导出的 `RuntimeInbox` 组件无引用（`InboxPage.tsx:1` 只导入 RuntimeItem/RuntimeReceipt/useRuntimeInteractions）；`inbox.css:160`（`.inbox-question-answer`）、`:183-199`（`.inbox-scope-grid/.inbox-scope-card`）未被 TSX 使用；`inbox-scope` 已作为 P14-03 证据。`docs/review/design-parity.md` 关于“待处理中心不能就地处理、无单选/多选/推荐/来源条/权限范围卡/未知回读/草稿保留”“Insights 缺项目/状态/归档筛选”的结论在当前 main 已不成立（`inbox-choices-2026-10-20.md`、`2026-10-20-runtime-inbox.md`、`p14-insights-2026-10-20.md` 证据），属 C10 旧口径。
- **未运行**：四主题像素级、GUI 交互、真实服务断连/并发与真实模型原生 permission 事件均未在本审计运行；上述“需GUI/需真实服务”条目不得视为已通过。
- **未覆盖状态**：设计 inbox 的 planHTML 只在 question/draft/permission/hard 显示（`inbox.html:140`），unknown/readback/empty/loading/error 下隐藏；实现没有该区块，故这些状态的组合无法逐项对照。Insights 设计 `.tiles` 1.2fr 首卡与 `.cur` 成本样式未逐像素对比。
