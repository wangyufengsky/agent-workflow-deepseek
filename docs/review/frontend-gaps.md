# 前端未完成项审查（apps/web）

> **历史快照（2026-10-20 全站审计核对）**：本文件 F-03/F-19/F-20/F-21 已过时（PPT 已接线、知识历史/节点/运行内容/应用页已有路由或内联承载、terminal 状态与设置分区已实现）；仅 **F-12** 仍成立（= `P02-03`）。当前口径以 `docs/review/design-audit-2026-10-20.md` §3.8 的 C10 更正清单为准。

> 范围：`apps/web/src` 全部页面/组件/API 客户端；对照 `packages/server/src` 已注册路由、`packages/shared` 的 `ROUTES` 与设计稿 `opencode-workflow-design-showcase/`（只读权威）。
> 方法：只读 `grep`/`read` + 路由抽取脚本 + import 图脚本；未运行 `npm install/build/dev`，未修改产品代码或设计稿。
> 结论标签：**确认** = 静态代码可直接核对；**需运行验证** = 代码证据明确、但最终表现依赖运行时/服务配置。

## 1. 结论摘要

- **P0：1 条；P1：10 条；P2：13 条**（共 24 条）。
- 最严重的 5 条：
  1. **P0 设置 → 服务 → 重启 OpenCode 成功后页面会崩**：前端读取 `restart.data.receipt.status`，但服务端只返回 `{ status }`，无 `receipt`；且 `main.tsx` 无 ErrorBoundary。
  2. **P1 知识库页大面积陈旧文案/假禁用**：问答与历史已经真实接通（`/api/knowledge/ask`、`/api/knowledge/history`），页面仍写“当前输入不会发送”“问答与引用仍未接通”，并列出不存在于服务端的 `/api/knowledge/conversations*`。
  3. **P1 PPT 页面只完成“创建草稿”**：后端生成/附件/导出/更新/删除接口齐全，但页面的 6 个 mutation（附件增删、生成×2、更新、删除）和作品列表 query 全部未渲染、未调用；没有 `ppt-works`/`ppt-studio` 页面，附件按钮仍是假禁用。
  4. **P1 流程编辑完全缺失**：服务端没有流程写入路由，`WorkflowsPage` “编辑流程/新建流程”永久禁用；设计稿有 `workflow-editor.html` 和复制流程。
  5. **P1 两个“设计必须、契约已写、服务端未实现”的缺口**：执行自动推进（`ROUTES.executionAdvance`）与调整计划“放弃调整”（`ROUTES.planEditAbandon`）。
- **对 lead 线索的一处修正**：PPT 的 `generate/generateSlides/attachment` 函数只是**定义**，`PptPage` 内没有 `.mutate` 调用，也没有作品/附件列表 UI；因此不是“已接”，而是“服务端已实现、前端未接线”。

## 2. 汇总表

| 编号 | 严重度 | 问题 | 关键证据 | 影响 |
| --- | --- | --- | --- | --- |
| F-01 | P0 | 重启 OpenCode 成功响应结构不匹配，页面崩溃 | `api/endpoints.ts:57-60`；`settings/OpenCodeCard.tsx:221-226`；`server/http.ts:822-830`；`main.tsx` 无 ErrorBoundary | 设置页点击重启成功后 TypeError，整页白屏 |
| F-02 | P1 | 知识库问答/历史已接，文案仍称未接通，且禁用资料来源按钮 | `knowledge/KnowledgePage.tsx:13,34,40,128,132,225,293,367` | 用户误以为功能不可用；与页头“文档问答可用”自相矛盾 |
| F-03 | P1 | PPT 生成/附件/导出/作品列表前端未接线 | `ppt/PptPage.tsx:27,34-78,84,177,200,239`；服务端 `http.ts:563-593` | 后端能力全部不可用；无作品页与编辑/导出入口 |
| F-04 | P1 | 流程编辑/新建/复制缺失 | `workflows/WorkflowsPage.tsx:12,131,265`；设计 `workflows.html:96,144`；服务端无流程写路由 | 设计稿 workflow-editor 无法承载，流程只能只读 |
| F-05 | P1 | 运行环境缺“启动 OpenCode”和操作历史 | `runtime/RuntimePage.tsx:256,263,270`；服务端 `http.ts:780-831` 无 start/history；设计 `runtime.html:64,108` | 停止态无法显式启动；无最近一次操作 |
| F-06 | P1 | 自动推进开关无后端/无 UI 动作 | `task/ExecutionPanel.tsx:120-127`；`shared/contracts.ts:1066`；`domain/enums.ts:497,584`；设计 `task.html:168-169` | 设计要求的“自动节点推进/推进一步”不可用 |
| F-07 | P1 | `/start` 忽略 `project`/`methodId` 查询参数 | `start/StartPage.tsx:94-115`；`workflows/WorkflowsPage.tsx:128`；`projects/ProjectsPage.tsx:137` | 从某项目/流程点“开始任务”会静默落到第一个项目/默认流程，可能建错任务 |
| F-08 | P1 | 质量与用量页称人工验收未接，任务 tokens 也显示“未知” | `insights/InsightsPage.tsx:308,118`；验收 UI `:89-90`；用量接口 `:158,163,279-280`；服务端 `http.ts:612-618` | 已可用的验收和 tokens 被隐藏，用户误判功能缺失 |
| F-09 | P1 | 调整计划缺“放弃调整” | `shared/contracts.ts:1051`；服务端无 `/plan/edit/abandon`；`PlanEditPanel.tsx` 无对应操作；设计 `task.js:686,972` | 进入调整后无法丢弃本地修改并恢复原状 |
| F-10 | P1 | 工具只能按 toolset 启停，单工具开关永久禁用 | `tools/ToolsPage.tsx:18,58,121,184`；设计 `tools.html:118-126`；服务端设置仅 toolsets | 设计稿的单工具/来源级启停未实现 |
| F-11 | P1 | 运行页忽略 `status.managed`，仍显示“受管进程”，未知/加载中也可重启 | `runtime/RuntimePage.tsx:115,126`；`shared/contracts.ts:976`；`server/http.ts:790`；设计 `runtime.html:66,84` | 外部/禁用进程状态错误；未知状态可误触发重启 |
| F-12 | P2 | 项目卡“开始任务”对 capability_unavailable 假禁用 | `projects/ProjectsPage.tsx:127-134`；`engine/project-task.ts:224-255` 无 gitState 校验 | 后端允许创建任务，前端却阻止，限制不自洽 |
| F-13 | P2 | 外观区声称只有外观在本地生效、其余需接口 | `settings/AppearanceSection.tsx:40`；服务端 `http.ts:675-684` 已支持 PATCH | 与已可保存的设置矛盾，误导演示 |
| F-14 | P2 | 工具页“启用/停用没有服务端接口”与可用的 toolset 开关矛盾 | `tools/ToolsPage.tsx:184` 对比 `:70-80` | 用户不知道工具集开关可用 |
| F-15 | P2 | 知识库“研究过程/工具记录由服务端冻结”无数据支撑 | `KnowledgePage.tsx:292-294`；`contracts.ts:220-229` 仅 answer/citations；设计 `knowledge.html:160,209` | 研究过程面板承诺了服务端没有的字段 |
| F-16 | P2 | 交付面板“查看变更并交付”是 no-op | `task/TaskCanvasPage.tsx:364`；`delivery/TaskDeliveryPanel.tsx:698-700` | 点击后仍停在同一交付面板，无任何变化 |
| F-17 | P2 | 用户可见文案泄漏内部“（P2）”；合并文案与合并对话框矛盾 | `TaskDeliveryPanel.tsx:345,619,883,889-905`；`git/FixPanel.tsx:914,926,944-948`；设计 `delivery/index.html:236` | 内部标记外泄；用户无法判断产品内到底能不能合并 |
| F-18 | P2 | 死代码/陈旧占位模块 | `app/placeholders.tsx:54-221`（仅 NotFound 被用）；`api/types.ts`；多个 `index.ts` barrel；`KnowledgePage.tsx:13`；`PptPage.tsx:12,14,27,84` | 维护噪音；占位注释仍称“until they land” |
| F-19 | P2 | 设计页缺独立路由（知识历史/节点/运行内容/应用页） | `app/App.tsx:31-55`；内联承载见 `KnowledgePage.tsx:320-349`、`TaskCanvasPage.tsx:362`、`DeliveryApplyPreview.tsx` | 深链、返回路径、独立页验收缺失；功能内联存在 |
| F-20 | P2 | 节点输出接口 `terminal` 恒为 false，UI 永远“等待正文” | `server/http.ts:351`；`node/NodeDetailPanel.tsx:91,170,198`；`plan.ts:348` 有真值 | 终态节点显示“等待正文”，状态误导 |
| F-21 | P2 | 设置执行限制只读，设计稿执行限制/重试/发布网络/开发辅助分区缺失 | `settings/ModelSection.tsx:26-39,148-166`；`SettingsPage.tsx:29-49`；设计 `settings.html:90,120-139` | 执行参数只能改配置文件；设计分区未覆盖 |
| F-22 | P2 | 任务明细的成本/耗时/重试确无按任务接口 | `InsightsPage.tsx:124,130,136`；`contracts.ts:319-321` 仅 tokens | 设计质量页的这三项无法展示 |
| F-23 | P2 | 大量禁用按钮没有 `disabledReason`，违反项目约定 | `components/Button.tsx:17-18,40`；如 `ProjectsPage.tsx:141-147`、`KnowledgePage.tsx:231,260`、`DatabasesPage.tsx:450` | 禁用原因不可见/不可读，违反 AGENTS.md 第 1.4 条 |
| F-24 | P2 | `ROUTES` 契约漂移：3 个 key 服务端未注册 | `contracts.ts:1051,1066,1088`；服务端路由清单无对应项 | 未来按契约实现会 404；其中两个已是真实缺口 |

## 3. 分类明细

### 3.1 陈旧文案与假禁用（P1）

#### F-02 知识库：问答/历史已接，文案仍说未接（确认）

- 页面真实调用（`knowledge/KnowledgePage.tsx`）：
  - `:40` `apiPost('/api/knowledge/ask', { requestKey, projectId, question, ... })`
  - `:34` `apiGet<KnowledgeHistoryResponse>('/api/knowledge/history?...')`
  - `:174` 引用点击打开 `setSourcePath(citation.path)`，`:320-349` 渲染真实问答历史。
- 陈旧/矛盾文案：
  - `:13` `ASK_BLOCKED_REASON = '知识库问答接口尚未接通…'`（全文件未引用，死常量）
  - `:128` placeholder `…（当前输入不会发送）`
  - `:132` `disabled disabledReason="…问答与引用仍未接通。"` 的“资料来源”按钮
  - `:225` “问答与引用仍未接通”
  - `:293` “历史对话同理，需要服务端提供会话读取接口”
  - `:367` `PendingBackendNotice` “模型问答、检索结论、引用与历史会话仍未接通”
- 同时 `:76` 页头 Badge 写“文档问答可用”，与以上文案直接矛盾。
- `:15-18` `PLANNED_ENTRYPOINTS` 展示 `POST /api/knowledge/conversations` / `.../:id/messages`；这两个路径既不在 `ROUTES`，也不在服务端注册（服务端只有 ask/history/sources/search/source）。
- 服务端实现证据：`server/http.ts:594-601`；`engine/knowledge.ts:46-120`（调用受管 OpenCode、校验引用、写历史）。
- **判定：陈旧文案 + 假禁用（确认）**；不是“问答未实现”。

#### F-03 PPT：后端齐全，前端只接了创建草稿（确认）

- `ppt/PptPage.tsx` 定义了：
  - `:27` `worksQuery` 读取 `/api/ppt/works`
  - `:34-45` 附件新增/删除；`:46-57` 生成大纲/逐页；`:58-74` 更新；`:75-78` 删除
  - `:84` `editing` 编辑草稿状态
- 但这些都没有出现在 JSX/事件中；全文件唯一的 mutation 调用是 `:186` `createDraft.mutate()`。没有作品列表、附件列表、生成按钮、导出按钮。
- 仍在误导用户：
  - `:177` “添加资料” `disabled disabledReason="附件上传接口尚未接通…"`，但服务端 `http.ts:576-580` 已注册 attachments，engine `ppt.ts:102` 已实现 attach。
  - `:200` “页面生成仍未接通”，但服务端 `:581` generate-slides、`:589` generate 已实现。
  - `:239` “当前页面不会发起任何模型调用或写入文件”，但 `:30` createDraft 正在 POST 写库。
  - `:165` “当前输入不会发送”同样已过时（创建草稿会发送 topic）。
- 设计稿有 `ppt-works.html:39`（全部作品）与 `ppt-studio.html:166-229`（制作/检查/导出/版本）；App 无对应路由或页面（见 F-19）。
- **判定：服务端已实现、前端未接线 + 陈旧禁用文案（确认）**。

#### F-08 质量与用量：验收和 tokens 已接却显示“未接入/未知”（确认）

- `insights/InsightsPage.tsx:308` lede 仍写“人工验收结论仍未接入”。
- 实际已接：
  - `:89-90` “验收通过/驳回”按钮调用 `decide.mutate`，`:44-49` mutation 调 `ROUTES.taskAcceptance` + `confirmDecide`。
  - `:95-109` 渲染真实验收结论。
  - 服务端 `http.ts:612-613` GET/POST acceptance，`engine/acceptance.ts:14-40`。
- `:118` “服务未提供按任务聚合的 tokens 接口”也不成立：
  - `:158` 请求 `/api/insights/task-usage`，`:163` 建 `usageByTask`，`:279-280` 列表已经显示每任务 tokens。
- 真实缺口是 `:124/:130/:136` 的按任务成本/耗时/重试：`contracts.ts:319-321` 只有 `{taskId, tokens}`（见 F-22）。
- **判定：前两项陈旧（确认），后三项为真实缺口（确认 DTO）**。

#### F-12 项目卡“开始任务”假禁用（P2，确认后端不限制）

- `projects/ProjectsPage.tsx:127-134`：`gitState` 为 `path_unavailable` 或 `capability_unavailable` 时禁用按钮，理由“服务返回的 gitState 不允许在此开始任务”。
- 服务端 `engine/project-task.ts:224-255` 创建任务只校验项目存在、标题/需求/流程方法，不校验 gitState；`capability_unavailable` 只代表本机 git 不可用，项目目录仍可走 `directory_copy` 工作区（`engine/workspace.ts:50-90`）。
- **判定：假禁用（确认服务端无此限制）**；“路径不可用”禁用合理，“Git 能力不可用”禁用不合理，建议拆开。

#### F-13 外观区“其余设置无接口”（P2，确认）

- `settings/AppearanceSection.tsx:40`：“只有外观在本地生效；其余设置项的保存需要服务端设置接口接通。”
- 实际上 `http.ts:675-684` 已提供 `PATCH /api/settings`；`ModelSection`、`GitSection`、`ServiceSection` 都在保存设置。
- **判定：陈旧文案（确认）**。

#### F-14 工具页“工具启用/停用没有接口”（P2，确认矛盾）

- `ToolsPage.tsx:184` PendingBackendNotice：“工具启用 / 停用…都还没有服务端接口”。
- 同文件 `:70-80` 已通过 `PATCH /api/settings` 的 `opencode.toolsets` 实现 toolset 启停；`:121` 也明确“按工具集启停”。
- 真实缺口只是“单工具开关”（F-10），不是全部启停。
- **判定：陈旧/过度声明（确认）**。

### 3.2 真实未接通接口（P1）

#### F-04 流程编辑/新建/复制（确认）

- `WorkflowsPage.tsx:12` `EDIT_BLOCKED_REASON`；`:131` “编辑流程”禁用；`:265` “新建流程”禁用。
- `server/http.ts` 全量路由中没有流程写入（只有 `/api/catalog/templates/*` 的模板导入/更新/归档、`/api/catalog/roles/*`）；`shared/contracts.ts` 的 `ROUTES` 也没有 workflow save/copy。
- 设计稿 `workflows.html:96` 有“编辑流程/查看步骤”，`:144` 有“新建流程”，并指向 `workflow-editor.html`（`:7`）。
- **判定：真实缺口（确认）**；这是设计页 + 契约 + 服务端 + 前端四层都未完成，不是陈旧文案。

#### F-05 运行环境：启动与操作历史（确认）

- `RuntimePage.tsx:256` “启动 / 重启历史尚未接通”；`:263` “服务端尚未提供运行时操作历史接口”；`:270` “启动 OpenCode 尚未接入界面”。
- 服务端路由 `http.ts:780-831` 只有 status/logs/detect/restart，无 `/api/opencode/start`、无 history。
- 设计稿 `runtime.html:64` 明确有“启动 OpenCode”按钮；`:108` “最近一次操作”记录启动/重启；`:115-120` 有启动/重启确认对话框。
- 现有 `restart` 会先 stop 再 ensureReady，可能顺带把 stopped 进程拉起，但没有显式启动语义、确认与历史。
- **判定：真实缺口（确认）**；`RuntimePage` 的“未接通”说法本身准确，不要误判为陈旧。

#### F-06 自动推进/推进一步（确认）

- `ExecutionPanel.tsx:120-127`：`role="switch"` 永久 `disabled`，文案“服务未提供切换自动推进的接口”。
- `ROUTES.executionAdvance` 已在 `shared/contracts.ts:1066` 声明；`domain/enums.ts:497` 有 `EXECUTION_ADVANCE`、`:584` 有 `execution.advance` operation。
- 服务端路由清单没有 `/api/tasks/:id/execution/advance`；engine 也没有对应公开方法（只有内部 `#advance`）。
- 设计稿 `task.html:168-169` 要求“自动节点推进”开关和“推进一步”按钮。
- **判定：真实缺口（确认契约已写、实现缺失）**。

#### F-09 放弃调整（确认）

- `ROUTES.planEditAbandon` 在 `shared/contracts.ts:1051` 声明。
- 服务端没有 `/api/tasks/:id/plan/edit/abandon`；`PlanEditPanel.tsx` 只有 begin/save/reconfirm/finish，没有放弃/取消调整。
- 设计稿 `delivery/assets/task.js:686` 有“放弃调整”按钮，`:972-974` 有放弃确认对话框；设计流程明确要求可恢复调整前设置。
- **判定：真实缺口（确认）**。

#### F-10 单工具开关（确认）

- `ToolsPage.tsx:18` `TOGGLE_BLOCKED_REASON = '单个工具开关未开放…'`；`:58` 每个工具行永久禁用“工具集控制”。
- 设计稿 `tools.html:118-126` 有单工具开关（全局）与“继承/启用/停用”三态（项目）；`:106` 还有来源级“停用这个来源…”。
- 服务端 settings 只有 `opencode.toolsets`（shared settings schema），没有单工具配置。
- **判定：真实缺口（确认）**；`:184` 的“全部没有接口”又把已接的 toolset 开关一并否定了（F-14）。

#### F-11 运行页忽略 managed / 未知状态（P1，状态逻辑确认 + 运行验证）

- 状态 DTO 有 `managed: boolean`（`contracts.ts:976`），服务端 `http.ts:790` 返回 `managed: opencode !== undefined`。
- `RuntimePage.tsx` 从未读取 `status.managed`；`:115-117` 无条件显示“受管进程”。
- `:126` 重启仅禁用 `statusQuery.isError || state === 'starting' || restart.isPending`：
  - 首次加载 `status === undefined`、`state === null` 时按钮可点；
  - 服务返回无法识别状态时按钮也可点；
  - `managed === false` 时按钮仍可点（服务端会抛 NOT_CONFIGURED）。
- 设计稿 `runtime.html:66` 明确“状态未识别时不能启动或重启”；`:84` 外部进程不提供重启。
- **判定：真实状态处理缺口（确认代码路径；需用 disabled OpenCode/外部进程运行验证）**。

#### F-24 契约漂移清单（P2）

- `shared/contracts.ts` 中服务端未注册的路由：
  - `:1051 planEditAbandon`（F-09）
  - `:1066 executionAdvance`（F-06）
  - `:1088 gitMergeRequest`（当前前端未使用，MR 列表自带详情，影响低）
- 前端实际调用与服务端注册**路径层面没有 404**：脚本核对 `apps/web` 的全部 `/api` 字面量调用与所有被使用的 `ROUTES.*`，均命中服务端已注册路径（仅 `fsDirectories` 解析脚本误报，实际已注册）。
- **判定：契约漂移（确认）**；建议加契约快照测试（见第 4 节）。

### 3.3 前端未接线 / 无作用交互 / 死代码（P2）

#### F-16 “查看变更并交付” no-op（确认）

- `TaskCanvasPage.tsx:364`：
  `onOpenChanges={() => patchParams({ delivery: '1', node: undefined })}`
- 此时交付面板已经因 `delivery === '1'` 打开；`TaskDeliveryPanel.tsx:698-700` 的“查看变更并交付”点击后再次设置同一参数，页面无变化。
- 注释本意是“打开 Git 工作台的任务上下文”，但没有对应路由/回调。
- **判定：看起来可用、实际不工作（确认）**。

#### F-18 死代码/占位（确认）

- `app/placeholders.tsx`：`:54-221` 的 `TaskCanvasPlaceholder`/`RequirementCanvasPlaceholder`/`StartPlaceholder`… 共十余个导出均无引用；只有 `NotFoundPlaceholder` 被 `App.tsx:23,55` 使用。文件头注释 `:20-22` 仍称“until they land”，已过时。
- `api/types.ts` 整个文件不可达（无 import），且与 shared DTO 重复。
- `pages/node/index.ts`、`pages/delivery/index.ts`、`pages/git/index.ts`、`components/index.ts` 是不可达 barrel（底层文件仍可达，不是模块死代码）。
- 常量/导入：`KnowledgePage.tsx:13` `ASK_BLOCKED_REASON` 未使用；`PptPage.tsx:14` `CREATE_BLOCKED_REASON` 未使用；`PptPage.tsx:12` `Modal` 未使用；`:27` `worksQuery`、`:84` `editing` 未渲染。
- **判定：死代码（确认）**；不影响运行，但会持续制造“看起来有功能”的假象。

### 3.4 接口错配 / 数据状态（P0/P2）

#### F-01 重启 OpenCode 响应错配（P0，需运行验证）

- 前端：
  - `api/endpoints.ts:57-60` `restartOpenCode(): Promise<CommandResponse>`，返回 `response.data`
  - `settings/OpenCodeCard.tsx:221-226` 成功后渲染 `restart.data.receipt.status`
- 服务端 `http.ts:822-830`：
  - `await opencode.stop(); await opencode.ensureReady(...)`
  - `return envelope({ status: opencode.status() }, requestId(request));`
  - **没有 `receipt`/`resource`**，与 `CommandResponse` 形状不符。
- `main.tsx` 没有 ErrorBoundary；渲染期 `undefined.receipt` 会让整页崩溃。
- **判定：接口错配（静态确认结构不一致；建议真实点击一次重启验证崩溃）**。

#### F-20 节点输出 terminal 恒 false（P2，确认接口实现）

- 服务端 `http.ts:351`：`{ ..., fragments, terminal: false }` 硬编码。
- `NodeDetailPanel.tsx:91`：`const terminal = outputQuery.data?.terminal ?? detail?.output.terminal ?? false;`
  `:170` 用 `terminal ? '未提供正文' : '等待正文'`；`:198` 也依赖 terminal。
- `plan.ts:348` 的 node detail 会返回真实 terminal，但 output 接口加载后覆盖为 false。
- **判定：接口错配（确认）**；终态节点会一直显示“等待正文”，需修服务端或前端兜底。

#### F-15 知识库研究过程/工具记录（P2，确认 DTO 不含）

- `KnowledgePage.tsx:292-294` 声称“检索步骤、工具记录与引用原文都由服务端在回答时冻结”。
- `KnowledgeAskResponse`（`contracts.ts:220-229`）只有 `answer`、`citations`、`model`、`generatedAt`、`conversationId`、`usage`；没有 steps/tool activity。
- 设计稿 `knowledge.html:160` 有分阶段研究过程，`:209` 有工具调用列表（`RS_TOOLS`）。
- **判定：真实缺口 + 前端过度承诺（确认）**；页面没有伪造步骤，但文案承诺了不存在的数据。

### 3.5 设计页缺路由（P2，除 PPT/流程编辑外均有内联承载）

| 设计页 | App 承载 | 判定 |
| --- | --- | --- |
| `originals/main/pages/knowledge-history.html:7` | `KnowledgePage.tsx:320-349` 内联历史 | 无独立路由，功能可用；P2 |
| `originals/node/index.html:7` | `TaskCanvasPage.tsx:57,362` 的 `?node=` + `NodeDetailPanel` | 无独立路由，功能等价性待设计确认；P2 |
| `originals/main/pages/run.html:7` | `NodeDetailPanel` 的“执行现场/尝试与产出” | 无独立“运行内容”页；P2 |
| `originals/delivery/apply.html:7` | `TaskDeliveryPanel` + `DeliveryApplyPreview` | 无独立路由，功能内联；P2 |
| `originals/main/pages/ppt-works.html:7` / `ppt-studio.html` | 无 | **P1，见 F-03** |
| `originals/main/pages/workflow-editor.html:7` | 无 | **P1，见 F-04** |
| `originals/main/pages/recovery.html` | `/recovery`、`/tasks/:taskId/recovery`（`App.tsx:36,53`） | 已覆盖 |
| `originals/main/pages/task.html` / `requirement.html` / `start.html` / `git` | `/tasks/:id`、`/requirement/:id`、`/start`、`/git` | 已覆盖 |

- `App.tsx:31-55` 没有 `/knowledge-history`、`/node/:id`、`/run/:id`、`/apply/:id`、`/ppt/works/:id`、`/workflows/:id/edit`。
- **判定：路由缺页（确认）**；其中 PPT/流程编辑是真实功能缺口，其余为承载方式差异，需 lead/设计确认是否接受内联。

### 3.6 其他一致性问题（P2）

#### F-17 内部标记泄漏 + 合并文案自相矛盾（确认）

- `TaskDeliveryPanel.tsx:345` 与 `:619` 的禁用理由直接包含“（P2）”，会显示给用户；这是审查标记，不应进入产品文案。
- `TaskDeliveryPanel.tsx:883` 写“合并在 GitLab 完成，产品内不提供合并按钮”，但 `:889-905` 就有“④ 合并确认”对话框和 `mergeDelivery` 调用；`FixPanel.tsx:926` 同样说“不提供直接合并”，`:944-948` 又有“确认合并”。
- 设计稿 `originals/delivery/index.html:236` 明确“只读浏览，不执行合并”“只给‘在 GitLab 打开’，不画产品内合并（g54 / g56 不复用）”。
- **判定：内部标记泄漏 + 文案/设计不一致（确认）**；需产品决定“删掉合并 UI”还是“更新文案并接受设计偏差”。

#### F-21 设置项只读/设计分区缺失（确认）

- `ModelSection.tsx:26-39` `Limits` 纯 `dl` 只读；`:148-166` 规划/执行参数（含“默认自动推进”）只是字符串行，`:305-306` 直接渲染。
- `SettingsPage.tsx:29-49` 只有 service/appearance/model/git/database 五区；设计稿 `settings.html:90` 还有“执行限制/重试等待”（`:120-124`）、“发布网络”（`:136`）、“开发辅助”（`:139`）。
- 服务端 `PATCH /api/settings` 支持 patch（`http.ts:675-684`），但 UI 没有暴露这些字段的编辑入口。
- **判定：真实前端缺口（确认）**；至少“默认自动推进”应有编辑入口，否则 F-06 的开关只能改配置文件。

#### F-22 按任务成本/耗时/重试（P2，真实缺口）

- `InsightsPage.tsx:124` 成本、`:130` 耗时、`:136` 重试均 `UnknownValue`。
- `contracts.ts:319-321` 的 `InsightsTaskUsageResponse` 只有 tokens；`InsightsResponse` 只有聚合值。
- 设计稿 `insights.html:74-76` 要求每任务耗时/重试/成本。
- **判定：真实缺口（确认 DTO）**；不是陈旧文案，需后端补字段或明确降级。

#### F-23 禁用按钮缺少原因（P2，系统性）

- `Button.tsx:17-18,40` 只在传入 `disabledReason` 时渲染 title；项目约定要求“禁用按钮必须有服务给出的原因”。
- 扫描到大量 `disabled` 但无 `disabledReason`/`title` 的按钮，例如：
  - `ProjectsPage.tsx:141,144,147`（busy 态）
  - `KnowledgePage.tsx:231,260`（项目为空/搜索不足 2 字）
  - `DatabasesPage.tsx:450,574,809`（mutation 进行中）
  - `DeliveryFileSelect.tsx:56,59`（未选/无可选）
  - `InsightsPage.tsx:103`（“改为”按钮只传 `disabled`，未传 reason）
- **判定：约定违反（确认）**；不全是假禁用，但用户看不到原因，和 F-02/F-03 的假禁用叠加会降低可信度。

## 4. 建议的下一步任务（可执行 / 可验收）

1. **修 P0 重启崩溃（F-01）**
   - 让 `/api/opencode/restart` 返回 `CommandResponse<{status}>`（含 receipt/requestKey），或前端改类型并只显示 status；补 `receipt` 分支。
   - 验收：在设置页点击重启，成功/失败/超时三种情况下页面不崩溃；回执状态可见；加一条页面级 smoke test。
2. **知识库文案与交互清理（F-02/F-15）**
   - 删除 `ASK_BLOCKED_REASON`、`PLANNED_ENTRYPOINTS` 的 conversations 项；把输入框/按钮/历史/来源文案改成“已接通”；“资料来源”按钮改为滚动/打开来源卡片或删除。
   - 验收：`grep -n "不会发送\|仍未接通\|conversations" KnowledgePage.tsx` 为空；真实提问后回答、引用、历史均可见；研究过程若不做则删除承诺文案。
3. **PPT 作品与制作闭环（F-03/F-19）**
   - 新增作品列表/studio 路由或内联作品区；接 `worksQuery`、附件、generate-slides/generate、update、delete、pptx/export；删除假禁用“添加资料”。
   - 验收：在真实服务上创建草稿→查看作品列表→添加附件→生成大纲/逐页→导出 PPTX；无 dead mutation；页面不再出现“未接通”。
4. **流程编辑（F-04）**
   - 方案 A：新增 workflow save/copy 服务路由 + 编辑器页（或复用 `workflow-editor.html` 设计），启用“编辑/新建/复制”。
   - 方案 B：若本轮不做，需在设计验收里明确降级并移除 `workflow-editor` 页承诺。
   - 验收：用真实服务创建/编辑/复制流程并重启后仍可见；或明确书面 de-scope。
5. **运行环境（F-05/F-11）**
   - 新增 start + operation history 接口；前端加“启动 OpenCode”确认框、历史列表；按 `managed` 切换“受管/外部”文案，未知/加载中禁用重启。
   - 验收：stopped 状态可显式启动；managed=false 时只读且无重启；未知状态不可操作；操作历史有真实记录。
6. **执行自动推进/推进一步（F-06/F-09）**
   - 新增 `POST /execution/advance` 与 save/set autoAdvance 接口（或扩展 execution start 参数）；实现“放弃调整”。
   - 验收：开关可切换并写入执行记录；“推进一步”在 auto-off 时可用；放弃调整后计划恢复原修订；对应 ROUTES key 不再悬空。
7. **修 `/start` 深链（F-07）**
   - `StartPage` 用 `useSearchParams` 读取 `project`/`methodId`，校验存在后作为初始值。
   - 验收：从项目 B/流程 X 点击开始任务，表单预选 B/X；不存在的参数回退默认值并提示。
8. **质量与用量数据修正（F-08/F-22）**
   - 删除“人工验收仍未接入”；任务明细 tokens 用 `usageByTask`；成本/耗时/重试若无接口则明确写“服务未提供”而不是“未知接口”。
   - 验收：已验收任务显示结论；每任务 tokens 与列表一致；成本/耗时/重试文案与 DTO 一致。
9. **接口契约与状态清理（F-20/F-24）**
   - 修 output `terminal`；为 ROUTES 加服务端注册快照测试；清理未使用契约 key 或补实现。
   - 验收：`node --test` 的契约快照通过；终态节点显示“未提供正文/已完成”而非“等待正文”。
10. **其余 P2 清理（F-12/F-13/F-14/F-16/F-17/F-18/F-21/F-23）**
    - 拆开“路径不可用/Git 能力不可用”的禁用理由；删除外观区错误句；工具页改成“toolset 已接、单工具未接”；删除 no-op 按钮或接到 Git 任务上下文；移除用户可见“（P2）”；删除 placeholders/api/types 死代码；设置加执行限制编辑入口；禁用按钮补 reason。
    - 验收：对应 grep 为空；禁用按钮全部有可读原因；设计清单逐项打勾。

## 5. 已核实为真实完成、不要误报的清单

- **知识库主链路真实存在**：`engine/knowledge.ts:46-120` 调用受管 OpenCode、校验 citations、持久化 history；`server/http.ts:594-601` 注册 ask/history；`KnowledgePage.tsx:34,40,174,320-349` 已调用并渲染。**不要再报“问答未实现”**；只报陈旧文案/研究过程字段缺失。
- **节点/交付模块不是死代码**：`TaskCanvasPage.tsx:31-32` 明确 import `../node/NodeDetailPanel.tsx`、`../delivery/TaskDeliveryPanel.tsx`，`:362-364` 实际渲染；`pages/node`、`pages/delivery` 的 barrel 未用不等于模块未用。
- **交付/应用/恢复主流程较完整**：`TaskDeliveryPanel` 的选择/提交/推送/MR/合并、`DeliveryApplyPreview` 的预览/冲突/应用/回执核对、`RecoveryPage` 的 `/recovery` 与 `/tasks/:id/recovery`、Git Review/Fix、Roles/Templates/Databases 的 CRUD 与回执都有真实服务调用。
- **PPT 服务端不是空壳**：`http.ts:563-593` 与 `engine/ppt.ts` 的创建、附件、outline/逐页生成、更新、删除、pptx/markdown 导出均已实现；缺的是前端接线，不是后端。
- **“评审人 暂未接通（非必填）”不是 bug**：设计稿 `originals/delivery/assets/git-td.js:485` 与 `flows.html:694` 明确要求显示“暂未接通”，不要误报为前端缺口。
- **首页流程演示不是 mock 数据**：`HomeFlowDemo.tsx:76-82` 明确标注“非实时任务”，与设计稿首页 story 一致；不要当成假任务数据。
- **工具静态清单有出处**：`api/catalog.ts:1-7` 明确说明镜像 `packages/mcp/src/tools/**`，13 个名称与 `packages/mcp/src/tools/*.ts` 一致；它不是运行时状态，连接状态仍来自 `/api/opencode/status`。
- **路径层面没有前端 404**：静态脚本核对 `apps/web` 的所有 `/api` 字面量调用和所有被使用的 `ROUTES.*`，均命中服务端注册路径；现存问题是响应结构（F-01）和契约未注册（F-24），不是 URL 写错。
- **运行环境/流程编辑/自动推进的“未接通”是真实缺口**，不是陈旧文案：服务端确实没有 start/history、workflow write、execution advance（已逐项核对路由清单）。不要把它们和知识库/PPT 的陈旧文案混为一谈。
