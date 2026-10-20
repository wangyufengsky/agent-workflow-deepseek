# 知识库 / 知识对话记录 前端设计一致性审计

> 基线：main @ `3f6f9b2`（2026-10-20）。范围：P03 知识库（`originals/main/pages/knowledge.html`，15 状态 = 6 主状态 + B-08 研究员面板 9 状态）、P04 知识对话记录（`originals/main/pages/knowledge-history.html`，5 状态）；实现 `apps/web/src/pages/knowledge/`（1393 行）、`apps/web/src/pages/knowledge-history/`（671 行）、路由 `/knowledge`、`/knowledge/history`，以及其契约/服务端 `packages/shared/src/api/contracts.ts`、`packages/engine/src/knowledge*.ts`、`packages/server/src/http.ts`。审计方式：静态代码 vs 只读设计稿；未运行 GUI 的部分标注“需GUI”。本区域**未发现 P0**。

## 概览

| 页面 | 设计状态数 | 已逐项核对 | P0 | P1 | P2 | P3 | 结论 |
|---|---|---|---|---|---|---|---|
| P03 知识库（`knowledge.html`，含 B-08） | 15 | 是 | 0 | 2 | 7 | 8 | 与设计有较大偏差：能力链路真实，但“研究→回答”页面结构、实时研究过程与引用上标未按设计实现 |
| P04 知识对话记录（`knowledge-history.html`） | 5 | 是 | 0 | 0 | 3 | 2 | 基本对齐（搜索/项目/分段/日期分组/摘要/模型/引用数/去回答均已落地），偏差集中在“需要回答/进行中”行的呈现与状态色 |

**最重要的问题（≤5 条）**
1. `P03-01` 设计的“研究过程四步逐步展开、命中来源卡依次出现、完成后收起为一行摘要”未实现：运行中只有“研究中+已读取 N 份来源+用时+部分回答”，四步/来源卡只在完成后的静态时间线里、且位于回答下方、永不收起。
2. `P03-02` 回答正文没有引用上标/引用锚点，引用只能从回答下方的 `path:line` 列表点开；契约也没有“引用在回答中的位置”字段（C1）。
3. `P03-03` 完成态没有设计中的提问气泡、复制、重新生成、“3 处引用 · 3 份原文”footer；刷新/深链（`?requestKey=`）后原问题在页面上完全不显示。
4. `P03-05` 页头缺少设计中的项目选择/当前项目展示与锁定语义，切换项目入口被埋进“资料来源”抽屉里的一个 `<select>`。
5. `P04-01` “需要回答/进行中”行回答摘要为空：历史契约没有待回答问题文本或进度摘要，用户只看到“需要你回答”徽标，看不到要回答什么。

## 状态覆盖

### P03 知识库（`opencode-workflow-design-showcase/originals/main/pages/knowledge.html`）

| mock state | 设计名称 | 实现判定 | 证据（实现文件:行 / 无） | 说明 |
|---|---|---|---|---|
| `idle` | 开始提问 | 部分 | `apps/web/src/pages/knowledge/KnowledgePage.tsx:500-588`；设计 `knowledge.html:151-154` | 标题/说明/来源统计/输入框/三个示例问题都在；但没有设计“居中欢迎区 + 页尾 composer + 可点研究员头像”的形态，示例问题只填入不发送（P03-13），页头无项目选择（P03-05） |
| `run` | 研究中 | 部分 | `KnowledgePage.tsx:589-601`（进度卡）、`useKnowledgeAsk.ts:77-98`（700ms 轮询）、`packages/engine/src/knowledge.ts:196-203`（onTextDelta 持久化部分回答）；设计 `knowledge.html:158-174` | 有**真实增量**（progress.answer 经轮询显示）+ 已读来源数/用时/停止按钮，非假进度；但没有四步逐条展开、没有实时命中来源卡、没有回答区 caret 流式，也没有“撰写中”区分（P03-01、P03-08） |
| `done` | 回答完成 | 部分 | `KnowledgePage.tsx:623-677`；设计 `knowledge.html:167-176` | 有回答/模型/时间/tokens/引用数/引用列表/研究时间线/继续生成/研究员检查；缺提问气泡、复制、重新生成、“3 处引用·3 份原文”、研究过程收起与引用上标（P03-02、P03-03） |
| `cite` | 查看引用原文 | 已实现 | `KnowledgePage.tsx:750-773`、`:64-173`（`CitationBody`）、`knowledge.css:9-64`；设计 `knowledge.html:179-185` | 右侧 520 面板、行号+snippet 高亮、滚动定位、上一处/下一处、窄屏 Modal；按行而非按段落高亮是服务按行引用的适配。标题/计数/循环差异见 P03-14，520 字面量见 P03-17 |
| `sources` | 资料来源面板 | 部分 | `KnowledgePage.tsx:815-960`、`KnowledgePermissions.tsx:34-38`；设计 `knowledge.html:61-64,186-191` | 两许可开关、来源筛选/勾选/搜索/打开原文齐全；形态是**带遮罩的抽屉**而非设计“并排 400 面板”；无分组计数与“完成”按钮（P03-04） |
| `stopped` | 已停止 | 部分 | `KnowledgePage.tsx:596,626,648-650`、`useKnowledgeAsk.ts:117-125`；设计 `knowledge.html:174` | 停止请求/已停止徽标/继续生成/停止锁都在；缺设计停止横幅原文，停止回执未处理、无可核对的停止原请求入口（P03-06），停止后“无引用”文案误导（P03-07） |
| `rs-welcome` | B-08 · 欢迎区打开（无消息） | 部分 | `KnowledgeResearcherDrawer.tsx:28-46`；设计 `knowledge.html:225-238` | 抽屉标题/只读 hint/“发送问题后…”说明/尚未发送问题/待发送草稿/资料来源都有；工具记录空态文案不同、引用材料缺“引用会在实际读取资料后显示”，外观为“研”而非中性形象（P03-09） |
| `rs-full` | B-08 · 证据完整 | 已实现 | `KnowledgeResearcherDrawer.tsx:36-41`；设计 `knowledge.html:211-212,217-223` | 三项证据（执行角色/发布职业/职业外观）+ 读取版本行 + 已发送问题 + 工具记录 + 引用材料 + 资料来源齐全；文案与核对结论呈现差异见 P03-09 |
| `rs-partial` | B-08 · 证据不完整 | 部分 | `KnowledgeResearcherDrawer.tsx:37-39`；设计 `knowledge.html:213` | 缺 profession/appearance 时有降级文案；但没有设计的中性形象，且“该职业未配置外观”与“本条历史消息未冻结外观”两种原因被混写（P03-09） |
| `rs-hist` | B-08 · 历史消息未冻结外观 | 部分 | `KnowledgeResearcherDrawer.tsx:37-40`；设计 `knowledge.html:214` | `roleEvidence` 缺失时显示“历史消息未记录执行角色/未找到发布职业版本/历史未冻结外观…”；中性形象未实现，原因判断可能误述（P03-09） |
| `rs-loading` | B-08 · 证据读取中 | 部分 | `KnowledgeResearcherDrawer.tsx:36`（`query.isFetching` 一行文字）；设计 `knowledge.html:219` | 打开抽屉会按原 requestKey 只读重取结果并显示“正在读取原消息证据…”；实现有 `aria-busy` 但只有一行文字，没有设计的三行骨架占位（P03-10） |
| `rs-denied` | B-08 · 读取失败（无权限） | 已实现 | `KnowledgeResearcherDrawer.tsx:25-27,36`；设计 `knowledge.html:220` | 401/403 映射为“暂时没有读取这条消息角色证据的权限，请核对原会话。”+ 重试按钮 |
| `rs-changed` | B-08 · 读取失败（版本已变化） | 部分 | `KnowledgeResearcherDrawer.tsx:25-27`（仅 `status===409` 分支）；设计 `knowledge.html:220` | 分支存在，但 `GET /api/knowledge/results/:requestKey` 不会返回 409（`server/http.ts:1064-1068` → `engine/knowledge.ts:401-413` 只抛 NOT_FOUND/CAPABILITY_UNAVAILABLE/REVOKED），静态判定该独立失败态**不可达**（P03-10） |
| `rs-stale` | B-08 · 会话版本不一致 | 部分 | `KnowledgeResearcherDrawer.tsx:20,36`；设计 `knowledge.html:221` | 客户端比对 `conversationVersion` 后隐藏证据结论并给 warn banner；没有“修订 15/14”具体值与“重新读取会话”按钮（P03-10） |
| `rs-notools` | B-08 · 无工具记录 | 已实现 | `KnowledgeResearcherDrawer.tsx:44` + `ResearchTimeline.tsx:78-87,166-171`；设计 `knowledge.html:235` | 无工具时显示“本轮还没有工具调用记录。”；stopped 时另提示“已按请求停止，已写内容保留” |

### P04 知识对话记录（`opencode-workflow-design-showcase/originals/main/pages/knowledge-history.html`）

| mock state | 设计名称 | 实现判定 | 证据（实现文件:行 / 无） | 说明 |
|---|---|---|---|---|
| `list` | 列表 | 已实现 | `KnowledgeHistoryPage.tsx:272-401`（工具条/分组/行）；设计 `knowledge-history.html:33-41,67-75` | 搜索+项目+分段（含“已归档”扩展，设计归档 toast 已暗示该视图）+ 今天/昨天/更早分组与计数 + 回答摘要/模型/引用数/时间 + 行点击回原会话；need 行呈现差异见 P04-03 |
| `need` | 筛选：需要回答 | 已实现 | `KnowledgeHistoryPage.tsx:201,205,302,132`；设计 `knowledge-history.html:56-57,74` | needs_answer 来自真实原生 question（`knowledge-conversations.ts:45-46`），分段计数、去回答按钮都在；行高亮与摘要问题见 P04-01/P04-03 |
| `loading` | 加载中 | 已实现 | `KnowledgeHistoryPage.tsx:328-342`；设计 `knowledge-history.html:61` | 3 行骨架（设计 4 行，P04-05） |
| `empty` | 空 | 已实现 | `KnowledgeHistoryPage.tsx:343-355`；设计 `knowledge-history.html:62` | “还没有对话/去提问”语义一致，按项目筛选动态措辞 |
| `error` | 加载失败 | 已实现 | `KnowledgeHistoryPage.tsx:317-326`、`:246-255`；设计 `knowledge-history.html:63` | 按项目分片 `ServiceNotice`+“记录读取失败的项目按事实显示为空”+刷新；无整页“记录加载失败”banner（P04-05） |

### 补充状态（非 mock 列表中单列，但审计要点要求核对）

| 状态 | 实现判定 | 证据 | 说明 |
|---|---|---|---|
| 加载中（首屏/来源清单/历史/正文/搜索） | 已实现 | `KnowledgePage.tsx:347-353,878,728,92-101,928-932` | 骨架/SkeletonText/“正在读取历史…”齐备 |
| 空（无项目/无来源/无历史/无引用/无匹配） | 已实现 | `KnowledgePage.tsx:726-729,884-887,652,933-934` | 均有明确“空/没有”文案，无伪造数据 |
| 错误（bootstrap/来源清单/历史/正文/搜索） | 已实现 | `KnowledgePage.tsx:487-496,878-883,722-725,92-101,928-932` | `ServiceNotice` + 重试；无静默失败 |
| 需回答 `needs_answer` | 部分 | `KnowledgePage.tsx:593,598,599` | 本页只有“需要你回答”+“去回答研究员问题”链接与等待说明；待回答问题正文/选项在待处理中心，本页不展示（设计主稿无此态，属产品补充；历史行摘要见 P04-01） |
| 进行中 `researching/answering/stopping` | 部分 | `KnowledgePage.tsx:589-601` | 有真实进度与停止；步骤/来源卡缺失见 P03-01，状态词见 P03-08 |
| 已完成 `completed` | 部分 | `KnowledgePage.tsx:623-677` | 结果卡存在但缺设计完成态元素（P03-03） |
| UNKNOWN（回执未定） | 已实现 | `useKnowledgeAsk.ts:52-75,127-154` + `KnowledgePage.tsx:602-612` | 原 requestKey 持久化、锁定再发送、仅 GET 核对、不重发；符合项目约定 |
| 撤权清正文 | 已实现 | `KnowledgePage.tsx:287-291`；`engine/knowledge.ts:288,427-445`；`knowledge-inputs.ts:37-43` | 许可撤回后进度正文清空、结果 403、历史 readability=forbidden 且 answer/citations 清空；知识库页历史卡的分支缺失见 P03-07 |
| 归档对话追问禁用 | 已实现 | `KnowledgePage.tsx:354-360`（followUp.reason 进入禁用原因）、`KnowledgeHistoryPage.tsx:134` | 禁用原因可读 |
| 会话锁定（项目/模型） | 已实现 | `KnowledgePage.tsx:343,556,836-837` | 模型/项目在会话中禁用并有 title 原因；但锁定不可见（P03-05） |

## 问题清单

### P03-01: 研究四步过程、实时来源卡与完成后一行摘要未实现，流式回答落在进度卡而非回答区
- **严重度**：P1
- **维度**：S / A / 结构
- **类别**：状态 / 结构 / 交互 / 数据契约
- **设计依据**：`opencode-workflow-design-showcase/originals/main/pages/knowledge.html:160`（四步：理解问题/检索资料/读取原文/组织回答，含“扫描 x/263 个片段”“核对许可后读取 3 份原文”“标注 3 处引用”）、`:161-171`（运行中默认展开、完成后按钮变为“研究过程 · 3 份来源 · 用时 3.4s”并可展开/收起）、`:172`（命中来源卡按时间依次出现，点击打开原文）、`:163-166`（回答按块流式输出、未完成有 caret）；`originals/main/index.html:93`（改造点原文：“研究过程四步逐步展开，完成后自动收起为一行摘要”“命中来源卡依次出现，回答流式输出”）
- **实现位置**：`apps/web/src/pages/knowledge/KnowledgePage.tsx:589-601`（运行中进度卡：状态词+已读取 N 份来源+用时+停止+部分回答）、`:641`（完成后一次性渲染 answer 纯文本）、`:651`（`ResearchTimeline` 位于回答与来源摘要之后）、`apps/web/src/pages/knowledge/ResearchTimeline.tsx:100-171`（完成后静态步骤/工具列表，不可收起）；契约 `packages/shared/src/api/contracts.ts:436-452`（`KnowledgeRunProgress` 只有 status/answer/sources，无 steps、无逐步命中来源）；`packages/engine/src/knowledge.ts:226-248`（steps 仅在最终结果组装）
- **差异**：设计要求运行中逐条展开四步、命中来源卡随检索出现、完成后收为一行“研究过程 · N 份来源 · 用时 Xs”摘要；实现运行中只显示“研究中/已读取 N 份来源/用时 Ns”与进度卡里的部分回答文本，无步骤、无来源卡；完成后把服务端真实步骤（retrieve/model/tool/validate）作为**默认展开**的“研究过程/工具轨迹”时间线放在回答**下方**，没有收起头/摘要行。设计四步与服务 steps 语义也不一致（缺“理解问题”，无“扫描片段/读取原文”过程字段）。
- **原因**：直接原因：页面按“表单 + 结果卡”实现，运行期只把 progress 当进度条用；进度 DTO 没有 steps 与来源发现（C1），前端没有逐步渲染分支（C2），研究过程区域位置/收起缺失（C4）。根本原因：运行期模型没有按设计“研究→回答”的单线程结构建模（C1+C2），把“研究过程”降级成完成后的审计信息。
- **影响**：`run` 态用户在长时间等待中看不到“理解/检索/读取/组织”的过程与实时命中来源，无法在生成中打开原文核对；完成后研究过程占据回答下方大量空间且不可收起，信息层级与设计相反。
- **建议**：①`KnowledgeRunProgress` 增加 steps/已命中来源摘要（或由服务端 SSE 事件派生），前端运行中逐条渲染；②把研究过程放到回答之前，完成后默认收起为一行摘要（N 份来源/用时），详情可展开；③命中来源卡字段（title/relevance/kind）进契约；服务不提供时明确“来源卡不可用”，不要静默用引用列表替代。
- **验证**：静态已确认（进度 DTO 无 steps、页面无步骤/来源卡渲染）；实时观感与布局需GUI + 真实服务/模型。
- **关联状态**：`run, done, cite`

### P03-02: 回答正文没有引用上标/引用锚点，引用只能从下方列表打开
- **严重度**：P1
- **维度**：S / 结构 / A / D
- **类别**：交互 / 结构 / 数据契约
- **设计依据**：`knowledge.html:163-166`（句子写完才出引用编号按钮：`<button class="cite" aria-label="查看引用 n" onclick="openCite(n)">`；`.cite` 样式 `:49-51`）、`:172`（来源卡/引用编号都可打开原文）；`originals/main/index.html:93`（“句子写完才出引用编号”“引用原文 520 面板…段落高亮”）
- **实现位置**：`apps/web/src/pages/knowledge/KnowledgePage.tsx:641`（回答以 `white-space: pre-wrap` 纯文本输出）、`:652-675`（引用以回答下方 `path:line + snippet` 行列表呈现，`openCitation` 只能从这里进入 `:400-407`）；契约 `contracts.ts:454-458,469-495`（`KnowledgeCitation` 只有 path/line/snippet，`answer` 与 citations 无位置关联）；`packages/engine/src/knowledge.ts:539-543`（SYSTEM_PROMPT 强制纯 JSON：`answer` + `citations`，与 Markdown/内联编号互斥）
- **差异**：设计把引用编号嵌在回答句子里（可点、与 520 面板联动）；实现回答正文没有任何引用标记，用户必须自己把正文与下方“path:line”列表对照，且列表进入原文后无法回到具体句子。
- **原因**：直接原因：契约没有“引用在回答中的位置/锚点”字段，模型输出也没有内联编号（C1）；前端因此只能渲染纯文本并在下方列引用（C2/C4）。根本原因：知识问答契约仍以“答案字符串 + 引用数组”建模，未支持设计要求的句子级引用。
- **影响**：设计核心交互（引用上标→原文面板）缺失；用户核对结论→原文的路径变长、易错；“每个结论都能回到原文”的直观性下降。
- **建议**：契约增加 answer 段内引用锚点（如 `citations[i].offset` / `answerSegments`），或让模型在 answer 中使用 `[n]` 标记并由前端解析为可点按钮；无锚点时显式提示“服务未提供句子级引用位置”，不要用列表冒充上标。
- **验证**：静态已确认；真实模型输出的解析与交互需真实服务/GUI。
- **关联状态**：`done, cite`

### P03-03: 完成态缺提问气泡/复制/重新生成，刷新或深链后原问题不可见
- **严重度**：P2
- **维度**：S / A / R / 结构
- **类别**：结构 / 交互 / 路由
- **设计依据**：`knowledge.html:168`（提问气泡）、`:169`（研究员 + 已完成/研究中/已停止徽标）、`:170`（研究过程摘要）、`:173`（回答区）、`:175`（完成 footer：复制 / 重新生成 / “3 处引用 · 3 份原文”）、`:176,142`（composer 继续追问，placeholder“继续追问这个项目…”）
- **实现位置**：`KnowledgePage.tsx:623-677`（结果卡只渲染 answer/模型/时间/tokens/引用数/研究员检查；无问题文本、无复制、无重新生成、无引用/原文统计 footer）；`:248-256`（`useKnowledgeAsk` 结果回调未 `setQuestion`）；`useKnowledgeAsk.ts:45-50,100-115`（`acceptResult`/`openRun` 接受结果但不恢复问题）；`:536-546`（问题只存在于 textarea）
- **差异**：设计 Q&A 是“提问气泡 + 研究员 + 研究过程 + 回答 + footer”的对话条目；实现是“表单输入框 + 结果卡”，没有提问气泡。正常首次提问时问题仍在 textarea 里；但刷新、`?requestKey=` 深链、从历史页/历史卡打开时，`askResult` 会恢复而 `question` 不回填，页面上看不到问的是什么。复制/重新生成与“3 处引用 · 3 份原文”缺失。
- **原因**：直接原因：结果区只渲染 answer，未从 `result.question` 回填提问（C6），也没有对话条目结构（C4）；复制/重新生成操作未实现（C2）。根本原因：页面数据结构按“单次表单提交 + 结果卡”设计，未按设计的会话条目建模。
- **影响**：刷新/深链后用户无法确认答案对应的问题；无法一键复制回答或重试；与设计“回到任何一次提问”的语义不符。
- **建议**：结果卡增加提问气泡并始终显示 `askResult.question`，请求恢复时同步回填输入框；补复制（clipboard）与重新生成（新 requestKey 重发）按钮及引用/来源统计 footer；composer 按设计“继续追问这个项目…”呈现。
- **验证**：静态可判定（未回填问题、无按钮）；刷新/深链路径需GUI + 真实服务确认。
- **关联状态**：`done, stopped, idle`

### P03-04: “资料来源”是带遮罩的抽屉，而非设计中并排的 400 面板；缺分组计数与“完成”
- **严重度**：P2
- **维度**：结构 / A
- **类别**：结构 / 交互
- **设计依据**：`knowledge.html:61-64`（`.panel` 参与布局，`src-p` 宽 `--drawer-sm`=400px，主内容不被覆盖）、`:186-191`（资料来源面板：`已选 N 项 · 下一轮问答生效`、原资料读取/网络公共检索两个 switch、搜索框、按代码/文档/数据库分组且每组“已选 / 总数”、底部“完成”）
- **实现位置**：`KnowledgePage.tsx:815-960`（`<Drawer ... size="sm">`，400px 模态抽屉，见 `apps/web/src/components/Drawer.tsx:42-56`：`scrim` 遮罩 + `role="dialog" aria-modal="true"`）；`:820-822`（整体“已选 X / Y”徽标）、`:828`（搜索+类型下拉）、`:889-905`（平铺来源清单，无分组/组计数）、`:830-840`（项目选择也塞在此抽屉）、无“完成”按钮
- **差异**：设计为与内容并排、不遮挡主区的 400 面板（可边看问题/回答边调来源）；实现为遮罩模态抽屉，打开时主内容不可操作，选完靠关闭；代码/文档/数据库分组与每组计数缺失，只有整体计数与一个类型筛选；“完成”按钮缺失；“下一轮问答生效”提示被拆到 `:533` 与 `:852` 两处。历史记录：`docs/review/knowledge-receipts-sources-2026-10-20.md:25` 曾以“改为 400px 来源抽屉”为修复项，但设计权威仍是并排面板。
- **原因**：直接原因：复用了通用 `Drawer` 组件承载一个设计为“侧面板”的区域（C4）。根本原因：面板/抽屉两种承载方式未被区分，资料面板的布局语义被组件默认行为替代。
- **影响**：用户调来源时看不到问题与回答；分组计数缺失让“哪些资料将被检索”更难判断；与“引用面板不遮回答”的同一设计原则不一致。
- **建议**：按设计恢复为并排侧面板（可复用 `.panel/.side` 结构，宽度 `var(--drawer-sm)`），补代码/文档/数据库分组与组计数、底部“完成”、单一“下一轮问答生效”提示；若产品坚持抽屉，需设计确认并记录差异。
- **验证**：静态；遮挡与布局切换需GUI。
- **关联状态**：`sources, idle, run`

### P03-05: 页头缺项目选择与当前项目展示，项目切换埋在“资料来源”抽屉
- **严重度**：P2
- **维度**：结构 / A / R
- **类别**：结构 / 数据契约（可见性）
- **设计依据**：`knowledge.html:133-138`（页头：`知识库` 标题 + 项目按钮“OpenCode Loopper”+锁定图标 + “历史对话” + “新建对话”；`:136` title“已有对话不可更换项目，新建对话后可切换”）
- **实现位置**：`KnowledgePage.tsx:461-485`（`PageHeader` actions 只有“对话记录/研究员检查/问答可用徽标”）；`:342`（`projectName` 只传给研究员抽屉 `:968`）；`:830-840`（项目 `<select>` 只在资料来源抽屉里，会话锁定时 `disabled`+title `:836-837`）；主内容仅显示 `:507`“N 个项目可归属”、`:522` 来源统计
- **差异**：设计在页头显眼位置显示项目名并提供选择（会话开始后锁定）；实现页头和主内容都没有当前项目名，切换项目要去“资料来源”抽屉里找 `<select>`，锁定态只在抽屉内以 disabled/title 表达。
- **原因**：直接原因：页头未放项目选择，项目状态被下沉到抽屉（C4/C6）。根本原因：未按设计页头契约（页头=页名+本页主操作/关键上下文）落地，同类结构根因见 `00-global-crosscutting.md` GLB-04/GLB-05。
- **影响**：多项目用户无法确认当前问答/历史属于哪个项目，也不知道在哪里切换；会话锁定的“为什么不能换项目”不可见。
- **建议**：页头（或内容标题右侧）加项目选择按钮，显示项目名，会话锁定后显示 lock 图标 + 原因（复刻 `knowledge.html:136`）。
- **验证**：静态；需GUI确认页头布局。
- **关联状态**：`idle, run, done, sources`

### P03-06: 停止生成回执未处理、无法核对停止原请求；缺设计停止横幅文案
- **严重度**：P2
- **维度**：A / T / S
- **类别**：交互 / 文案 / 状态
- **设计依据**：`knowledge.html:142`（运行中发送键变停止按钮，`aria-label="停止生成"`）、`:174`（停止 banner：“已停止生成。已写出的内容保留，引用只对已完成的句子生效。”+“继续生成”按钮）
- **实现位置**：`KnowledgePage.tsx:596`（“停止生成”按钮，仅以 `stopping || progress.stopRequestKey` 禁用，`disabledReason="停止请求已发送，请核对原操作。"`）、`useKnowledgeAsk.ts:117-125`（`stop()` 只 `apiPost`，不检查 `receipt.status`，失败仅 `catch` 写一句 error，不保留停止 requestKey，也没有核对入口）；结果区 `:626,648-650` 有“已停止”徽标与“继续生成”按钮
- **差异**：设计有明确停止横幅与“引用只对已完成句子生效”的解释；实现没有该横幅，停止后回答下方引用为空只报“模型没有给出可验证的引用。”（见 P03-07）。停止请求的 `accepted→succeeded/failed/unknown` 回执未进入 UI 状态：`failed/unknown` 时用户只能看到被禁用的停止按钮与“请核对原操作”，但页面没有该停止 requestKey 的核对入口（`useKnowledgeAsk` 只提供 ask/stop，没有 stop reconcile）。
- **原因**：直接原因：停止写操作只发请求、不回执建模（C5）；停止态文案未按设计补（C3）。
- **影响**：停止失败/未知时用户无法完成“核对原操作”的闭环；停止后为何没有引用不可解释。
- **建议**：保存停止 requestKey；`accepted/unknown` 时提供“核对停止请求”（`operations/by-key`）按钮；按设计补停止横幅与引用范围说明。
- **验证**：静态；停止失败/未知场景需真实服务 + GUI 演练。
- **关联状态**：`stopped`

### P03-07: 把“不可用/未记录”表述成“没有”——停止后引用、旧历史工具轨迹、撤权历史条目三处误导
- **严重度**：P2
- **维度**：D / S / T
- **类别**：数据诚实 / 状态 / 文案
- **设计依据**：`knowledge.html:174`（停止后“引用只对已完成的句子生效”）；`:166`（引用编号只在引用校验后出现）；`originals/main/index.html:171` B-08（工具记录）；契约注释 `contracts.ts:491-494`（steps“旧回答为 legacy，字段缺失”）
- **实现位置**：①`KnowledgePage.tsx:652`（`citations.length === 0` → 固定显示“模型没有给出可验证的引用。”），而停止结果由引擎固定写入空引用（`packages/engine/src/knowledge.ts:383` `citations: []`）；②`ResearchTimeline.tsx:78-87`（`steps`/`toolActivity` 都没有时统一显示“本轮还没有工具调用记录。”），契约已注明旧回答本就没有这些字段；③`KnowledgePage.tsx:428-436`（`openHistoryEntry` 不检查 `readability`）+ `:732-743`（“问答历史”卡直接渲染撤权条目的 question/引用数）→ 点开后 `:641` 答案为空白、`:652` 又断言“模型没有给出可验证的引用”，而历史页 `KnowledgeHistoryPage.tsx:128,134` 对 forbidden 有正确降级
- **差异**：设计要求/项目约定“未知与不可用必须说明原因”，实现把三种不同原因（生成被停止、旧记录未记录、许可撤回）统一表述成“没有引用/没有工具调用/空白回答”。
- **原因**：直接原因：只用“数组为空”作分支，未区分 status/readability/字段是否存在（C6）；旧字段缺失与真实空值无判别（C1/C2）。
- **影响**：用户会把“停止导致无引用”“旧记录未记录工具”误解为模型没给依据或没调用工具；撤权条目在知识库页显示为不可解释的空白，违反数据诚实原则。
- **建议**：按 `status`/`readability` 分支：stopped→“回答在生成中停止，已写内容保留，引用仅覆盖已完成句子”；legacy（`steps/toolActivity === undefined`）→“该历史记录未记录研究步骤/工具轨迹”；forbidden→显示 `unavailableReason` 并禁止打开/隐藏回答区。
- **验证**：静态；撤权/停止后的真实数据需真实服务验证。
- **关联状态**：`stopped, rs-notools, done`、知识库“问答历史”卡

### P03-08: 知识问答状态词散落手写，出现“研究中/撰写中/生成中/待核对”多套写法，失败/停止可能被显示为“研究中”
- **严重度**：P2
- **维度**：T / S
- **类别**：文案 / 状态映射
- **设计依据**：`knowledge.html:169`（研究中 / 撰写中 / 已停止 / 已完成）；`knowledge-history.html:55`（已完成 / 需要你回答 / 研究中 / 已停止 / 连接中断）
- **实现位置**：`KnowledgePage.tsx:593`（手写三元：needs_answer→“需要你回答”、stopping→“正在停止…”、unknown→“执行状态待核对”、其余一律“研究中”（answering/failed/stopped/completed 均无分支））、`:626`（完成态徽标写“回答”而非“已完成”）、`:574`（按钮文案“研究中…”）；`KnowledgeHistoryPage.tsx:123`（手写映射表：answering→“生成中”、unknown→“待核对”）；共享标签 `packages/shared/src/domain/enums.ts:815-820`（`KNOWLEDGE_RUN_STATUS_LABEL`：研究中/撰写中/等待你的答复/正在停止/已停止/已完成/失败/结果待核对）只在 `KnowledgeResearcherDrawer.tsx:24` 使用
- **差异**：同一状态在三个位置出现三套词（研究中/撰写中/生成中；待核对/结果待核对/执行状态待核对；已完成/回答），且进度卡缺 answering/failed/stopped 分支；未使用共享状态标签。
- **原因**：直接原因：页面直接写中文状态词（C3）；状态映射不完整（C6）。根本原因：状态标签未统一走 `packages/shared` 的 labels/enums 单一来源。
- **影响**：跨页/跨组件状态词不一致；进度已终态但回执尚未核对的间隙，标签仍显示“研究中”，用户无法判断是仍在执行还是已结束待核对。
- **建议**：统一使用 `KNOWLEDGE_RUN_STATUS_LABEL`（或把知识状态并入 `labels.ts`），进度卡按 status 全覆盖映射；完成徽标用“已完成”；历史页 need 采用设计原文“需要你回答”。
- **验证**：静态。
- **关联状态**：`run, done, stopped`、P04 `list/need`

### P03-09: 研究员面板（B-08）三项角色证据的呈现与设计不符（无核对结论文案、无中性形象、外观缺失原因可能误述）
- **严重度**：P2
- **维度**：T / S / V
- **类别**：文案 / 状态 / 样式
- **设计依据**：`knowledge.html:211-214`（full/partial/hist 三组精确文案：执行角色“已核对本条消息的冻结角色版本。”、发布职业“已核对与原执行角色一致的发布职业版本。”、职业外观“已核对原投递时冻结的职业外观；仅使用对应资源版本。”；partial：“未找到与原执行角色完全对应的发布职业版本。”/“本条消息投递时未配置职业外观。保持中性形象，不套用当前设置。”；hist：“本条历史消息未冻结外观，保持中性形象；不会套用当前职业设置或播放角色动画。”）、`:218`（“角色证据 · 本条回答投递时”）、`:229-230`（partial/hist 中性头像 + “这条回答保持中性形象。”）、`:230`（回答于/停止于时间）
- **实现位置**：`KnowledgeResearcherDrawer.tsx:31`（头像恒为 `evidence?.appearance?.value ?? '研'`，无中性形象）、`:37-40`（执行角色只显示 `executionRole.label`；发布职业显示 `name · revision`；职业外观 `appearance?.label`，缺失时用“历史未冻结外观…”或“该职业未配置外观…”两段文案）、`:32`（无“回答于/停止于”前缀、副标题不同）
- **差异**：三项证据没有设计的“已核对/未找到”核对结论文案与“本条回答投递时”hint；partial/hist 不切换中性形象（仍显示“研”，只在有外观时显示外观值）；同一个“evidence 存在但 appearance 缺失”场景被断言为“该职业未配置外观”，与设计“本条历史消息未冻结外观”的语义相反（契约没有缺失原因字段）。
- **原因**：直接原因：只渲染数据值、用“字段是否存在”推断原因（C3/C6）；契约 `KnowledgeRoleEvidence` 无外观缺失原因（C1）；中性形象样式未实现（C7）。
- **影响**：B-08“三项核对”的证据语义被弱化；历史消息可能是“未冻结外观”却被说成职业没配外观，属于误导性说明。
- **建议**：每项固定显示核对结论 + 数据；外观缺失区分“本条消息未冻结”与“职业未配置”（契约加 reason）；partial/hist 使用中性头像与“保持中性形象”文案；补“本条回答投递时”与时间前缀。
- **验证**：静态；真实历史数据/角色配置需真实服务。
- **关联状态**：`rs-full, rs-partial, rs-hist, rs-welcome`

### P03-10: B-08 的读取中/版本变化失败态被弱化，其中“证据版本已变化”分支静态不可达
- **严重度**：P3
- **维度**：S / K
- **类别**：状态 / 交互
- **设计依据**：`knowledge.html:219`（读取中：`aria-busy` + 三行骨架 + “正在核对本条消息的角色证据…”）、`:220`（无权限/版本已变化两个 danger banner + “重试”）、`:221`（会话版本不一致：显示“会话 修订 15 / 页面 修订 14”，按钮“重新读取会话”，期间不显示证据结论）
- **实现位置**：`KnowledgeResearcherDrawer.tsx:36`（`query.isFetching` 只显示一行“正在读取原消息证据…”；`query.isError` 统一 danger banner + 重试；mismatch 只显示“待核对：会话或消息版本已变化，暂不显示证据结论。”）、`:20`（mismatch 判定）、`:25-27`（401/403/409 文案映射）；服务端 `packages/server/src/http.ts:1064-1068` → `packages/engine/src/knowledge.ts:401-413`：结果 GET 只可能抛 NOT_FOUND/CAPABILITY_UNAVAILABLE/REVOKED（403），**不会返回 409**
- **差异**：读取中无骨架；版本不一致没有两次修订号与“重新读取会话”按钮；`rs-changed` 依赖的 409 分支实际不可达。
- **原因**：直接原因：状态分支只做到文字级（C2），服务端未提供“证据版本已变化”的 409 语义（C1/C5）。根本原因：角色证据读取的版本冲突模型没有在契约/服务端落地，前端先写了 UI 分支。
- **影响**：设计中“证据读取中/版本变化”的可见状态无法真实到达；用户在版本漂移时只能得到一个泛化 warn。
- **建议**：读取中补骨架；服务端在证据版本变化时返回 409 并附版本；前端显示修订号差异与“重新读取会话”；否则删除不可达分支。
- **验证**：静态已判定 409 不可达；真实并发写入需真实服务/故障注入。
- **关联状态**：`rs-loading, rs-changed, rs-stale`

### P03-11: 研究过程说明暴露内部枚举与“非流式”口径，且与页面真实流式显示自相矛盾
- **严重度**：P3
- **维度**：T / D
- **类别**：文案
- **设计依据**：`knowledge.html:160-171`（四步中文名与过程描述，无技术说明）；`originals/main/index.html:93`（改造点为“研究过程四步逐步展开/命中来源卡依次出现/回答流式输出”）
- **实现位置**：`apps/web/src/pages/knowledge/ResearchTimeline.tsx:96-98`（“数据来自服务端完成的本次执行（retrieve/model/tool/validate），本轮非流式；不显示实时进度或虚构阶段。”）、`:93`（徽标“完成后时间线”）；引擎实际有增量：`packages/engine/src/knowledge.ts:196-203`（onTextDelta 持久化部分回答）、`useKnowledgeAsk.ts:94`（700ms 轮询）、`KnowledgePage.tsx:599`（显示 progress.answer）
- **差异**：产品界面直接出现内部 kind 枚举（retrieve/model/tool/validate）与工程口径“本轮非流式”；而同一页面的进度卡正通过轮询显示增量文本，二者矛盾。设计没有这段技术说明。
- **原因**：直接原因：把代码注释当产品文案（C3）。根本原因：缺少面向用户的研究过程摘要文案（应由设计“N 份来源/用时”承担，见 P03-01）。
- **影响**：用户看到实现细节与相互矛盾的“非流式”说法，降低可信度。
- **建议**：删除内部枚举与“非流式”说明，改为“研究过程 · N 份来源 · 用时 Xs”+ 步骤中文名；技术口径留在开发文档。
- **验证**：静态。
- **关联状态**：`run, done`

### P03-12: composer 不支持设计明示的 Enter 发送 / Shift+Enter 换行
- **严重度**：P3
- **维度**：A / K
- **类别**：交互
- **设计依据**：`knowledge.html:142`（textarea `onkeydown`：Enter 且非 Shift/非输入法组合 → 阻止默认并 `ask()`）、`:145`（提示“Enter 发送 · Shift Enter 换行”）
- **实现位置**：`KnowledgePage.tsx:536-546`（`#kb-question` textarea 无 `onKeyDown`）、`:582-588`（说明文案也没有 Enter 提示；全文件仅在来源搜索 `:914` 有 Enter 处理）
- **差异**：按 Enter 只换行；设计为 Enter 发送、Shift+Enter 换行并显示提示。
- **原因**：C5。
- **影响**：高频输入操作与设计不符，用户按键无反应可能误以为未生效。
- **建议**：补 Enter 提交 / Shift+Enter 换行（含 `isComposing` 保护）与提示文案。
- **验证**：静态；需GUI键盘确认。
- **关联状态**：`idle, run, done`

### P03-13: 示例问题点击只填入输入框，设计为一键提问
- **严重度**：P3
- **维度**：A / T
- **类别**：交互 / 文案
- **设计依据**：`knowledge.html:154`（`<button onclick="ask(...)">` 直接提问）
- **实现位置**：`KnowledgePage.tsx:680-701`（“可以这样问（选择后仅填入输入框）”，点击 `setQuestion(text)`，另加设计没有的“填入”徽标）
- **差异**：设计点击示例问题立即发起研究；实现只把文本填到 textarea，多一步点击，并改变了区块标题语义。
- **原因**：C5 / C3。
- **影响**：首屏引导效率降低，与设计“首屏给三个示例问题”的意图不一致。
- **建议**：点击直接提问（或保留填入但默认直接发送）；区块标题与设计一致。
- **验证**：静态。
- **关联状态**：`idle`

### P03-14: 引用原文面板标题/计数/切换语义与设计不一致（无“引用来源 n/3”、首尾不循环、按行而非段落）
- **严重度**：P3
- **维度**：T / A / 结构
- **类别**：文案 / 交互 / 结构
- **设计依据**：`knowledge.html:183`（头部“引用来源 · n / 3”、标题、路径、`引用位置 · 第X段`/`示例原文` 徽标）、`:184`（上一个/下一个 icon 按钮，首尾循环：1→3、3→1）、`:185`（段落列表，仅引用段落 `.hl` 高亮，段首“第 N 段 · 引用位置”）
- **实现位置**：`KnowledgePage.tsx:752-764`（eyebrow“引用原文”、路径 h2、“第 N 行”徽标）、`:175-212`（“上一处/下一处”文本按钮，首尾 `disabled` + 原因，不循环）、`:106-169`（按行显示并在命中行高亮 + snippet）；`knowledge.css:39-64`
- **差异**：头部没有“引用来源 · n / 3”计数（计数在切换行内）；高亮单位是行（服务按行引用，属契约适配），设计文档面板按段落“第 N 段 · 引用位置”；首尾切换不循环；产品未显示“示例原文”水印是正确行为（原型辅助标记），不计缺陷。
- **原因**：C5（切换交互）+ C3（标题/计数），段落→行的差异部分为 C1 适配。
- **影响**：引用面板信息层级与设计不一致；首尾多一次判断；文档类来源缺段落语境。
- **建议**：标题补“引用来源 · n / total”；如需段落语义，契约增段落号；首尾切换可按设计循环或保留禁用原因。
- **验证**：静态；需GUI审查视觉层级。
- **关联状态**：`cite`

### P03-15: 知识库页内嵌“问答历史”卡为设计外新增区块，与独立历史页重复
- **严重度**：P3
- **维度**：结构
- **类别**：结构 / 范围
- **设计依据**：`knowledge.html:133-138`（页头“历史对话”入口；设计知识库页无内嵌历史卡，历史由独立 `knowledge-history.html` 承担）；`originals/main/index.html:91,94`（两页各自负责）
- **实现位置**：`KnowledgePage.tsx:704-747`（“问答历史”卡：本机保存/查看全部/条目列表）
- **差异**：设计页只有页头“历史对话”链接；实现新增一整块历史卡（另一个入口，且条目点击不识别撤权态，见 P03-07），使页面更长、与 `/knowledge/history` 功能重叠。
- **原因**：C4（多余区域）。
- **影响**：两个历史入口语义重复；历史卡与独立历史页的能力/降级不一致（搜索、分段、状态、撤权说明都在独立页）。
- **建议**：与设计确认是否保留；若保留，至少补 readability/状态降级并收敛为“最近几条 + 查看全部”；否则删除并在页头保留唯一入口。
- **验证**：静态。
- **关联状态**：页面整体、`done`

### P03-16: 研究员面板触发按钮缺少 `aria-expanded`/`aria-controls`
- **严重度**：P3
- **维度**：K
- **类别**：可访问性
- **设计依据**：`knowledge.html:152`（欢迎头像 `aria-label` + `aria-expanded`）、`:169`（消息头像同样带 `aria-expanded`）、`:239`（打开时维护 `aria-expanded` 状态）
- **实现位置**：`KnowledgePage.tsx:502`（头像按钮只有 `aria-label`）、`:469-476`（页头“研究员检查”）、`:632-639`（结果卡“研究员检查”）均无展开态语义；`Drawer.tsx:26-38` 抽屉本身已有 Esc 关闭与焦点归还、`:47` 有 `role="dialog" aria-label`
- **差异**：设计用 `aria-expanded` 表达面板开关状态；实现三处触发按钮不暴露该状态，也不关联到抽屉。
- **原因**：C8。
- **影响**：屏幕阅读器用户无法得知研究员面板是否打开/该按钮控制什么。
- **建议**：三处触发按钮补 `aria-expanded`、`aria-haspopup="dialog"`、`aria-controls`，并指向抽屉 id。
- **验证**：静态；需GUI + 读屏/键盘验证。
- **关联状态**：`rs-*`

### P03-17: 引用面板宽度硬编码 520px、开关无过渡，断点与设计断点不同源
- **严重度**：P3
- **维度**：V
- **类别**：样式 / 主题
- **设计依据**：`knowledge.html:62`（`.panel.open.cite-p{width:var(--drawer-lg)}`，`--drawer-lg:520px` 见 `originals/main/assets/ds.css:88`）、`:61`（`transition:width .4s var(--ease)` 推入动效）
- **实现位置**：`apps/web/src/pages/knowledge/knowledge.css:9-17`（`grid-template-columns: minmax(0,1fr) 520px` 字面量、无过渡、`@media (max-width:1200px)` 收起）、`:27-37`（sticky 面板）；对比 `Drawer` 使用 `var(--drawer-*)`（`ds.css:88,297`）
- **差异**：设计用令牌 `--drawer-lg` 并有宽度过渡动画；实现写死 520px、无动画，窄屏直接改 Modal（断点 1200 与外壳断点 1440/1280/1024 不同源）。
- **原因**：C7。
- **影响**：尺寸调整需改两处；与设计“从右侧推入”的观感不一致；断点行为与外壳不一致（需 GUI 确认）。
- **建议**：改用 `var(--drawer-lg)`；补宽度/位移动效并遵守 `prefers-reduced-motion`；断点与全局设计断点对齐。
- **验证**：静态；动效与四主题需GUI。
- **关联状态**：`cite`

### P04-01: “需要回答/进行中”行缺状态摘要（待回答问题文本/进度），摘要列为空
- **严重度**：P2
- **维度**：S / D / T
- **类别**：数据契约 / 状态 / 文案
- **设计依据**：`knowledge-history.html:48`（need 行回答摘要为待回答问题：“研究员需要你确认：是否允许读取 docs/deliveries 下的交接文档？”）、`:49`（run 行摘要为进度：“正在读取原文 · 2 / 5 份”）、`:17-18`（列表行含一行回答摘要）；`originals/main/index.html:96`（改造点“每行带回答摘要、模型、引用数”）
- **实现位置**：`KnowledgeHistoryPage.tsx:71-74`（`answerSummary` 只截取 `entry.answer`）、`:128`（`answerSummary(entry.answer)`）、`:123`（状态映射）；契约 `contracts.ts:497-502,504-511`（`KnowledgeHistoryEntry` 无待回答问题/进度文字，`KnowledgeConversation` 只有 `pendingInteractionIds`）；`packages/engine/src/knowledge.ts:427-445`（运行中条目用 `progress.answer`，未产出时为空串）
- **差异**：设计中 need/run 行的摘要分别是“要回答的问题”与“读取进度”；实现 latest 条目在运行中 `answer` 常为空，摘要列为空白，只剩状态徽标与元数据。历史契约没有可用的待回答问题文本或进度摘要字段。
- **原因**：直接原因：契约缺字段（C1），前端只按 answer 生成摘要（C3）。根本原因：历史列表的数据模型以“已完成回答”为中心，未覆盖运行中/待回答行的展示字段。
- **影响**：需要回答的行不告诉用户“要回答什么”，进行中的行看不出进展——这正是设计改造要解决的旧问题（“每行只有标题和状态词，看不出回答内容”）。
- **建议**：历史 DTO 增 `pendingQuestion`/`progressSummary`（或前端按 `pendingInteractionIds` + 进度接口组装）；缺失时显示“待回答问题需去待处理中心查看”，不要留空。
- **验证**：静态；真实 needs_answer/运行中行需真实服务 + GUI。
- **关联状态**：`list, need`

### P04-02: 状态徽标色调与设计不符：进行中/失败仍是中性色，need 用 wait
- **严重度**：P2
- **维度**：V / S
- **类别**：数据映射 / 样式主题
- **设计依据**：`knowledge-history.html:55`（状态→徽标：done `st-ok`、need `st-fail`、run `st-accent`、stopped `st-idle`、broken `st-danger`）
- **实现位置**：`KnowledgeHistoryPage.tsx:129`（`tone={status === 'completed' ? 'ok' : status === 'unknown' ? 'unknown' : status === 'needs_answer' ? 'wait' : 'idle'}`，图标仅 completed/needs_answer 特判，其余统一 `clock`）
- **差异**：设计进行中用 accent（醒目运行色），实现用 `idle` 中性色 + clock；设计失败用 danger/fail，实现 failed 也落到 `idle`；need 用 `wait` 而非设计 `st-fail`；结论：同一列表里“进行中/失败”不醒目。
- **原因**：C6（状态→tone 映射不完整）+ C7。
- **影响**：状态语义弱化，用户扫列表难以区分运行中、失败与已停止。
- **建议**：按 status 精确映射：researching/answering/stopping→`run/accent`、failed→`fail/danger`、stopped→`idle`、needs_answer→设计原色（warn 系）；图标随状态区分（进行中用 spinner/run 图标）。
- **验证**：静态；四主题下对比度需GUI。
- **关联状态**：`list, need`

### P04-03: “需要你回答”行没有设计的 warn 高亮与行内主操作，左条被“是否有引用”替代
- **严重度**：P2
- **维度**：V / 结构 / A
- **类别**：结构 / 样式 / 交互
- **设计依据**：`knowledge-history.html:21-23`（`.conv.need{background:var(--warn-fill);box-shadow:inset 2px 0 0 var(--warn)}`，need 图标用 warn 色）、`:74`（need 行右侧 primary“去回答”按钮，`event.stopPropagation()`）、`:20`（其它行的操作 hover 才显示）
- **实现位置**：`KnowledgeHistoryPage.tsx:125`（`data-cited={citations.length>0}` 控制左侧色条、`data-expanded`）、`:132`（“去回答/核对原问答”按钮放在行**下方**，与展开详情/重命名/归档并列）；`knowledge-history.css:56-62`（cited→`--ok-line`，否则 `--idle-line`；无 need/warn 规则）
- **差异**：需要回答行没有 warn 底色与 warn 左条；实现用“有无引用”决定左侧色条（设计无此语义，且与 need 状态无关）；“去回答”从行内右侧主按钮移到行下方次要位置。
- **原因**：直接原因：用引用数替换了 need 状态高亮（C6/C7），主操作位置改动（C4）。根本原因：列表行视觉状态（need 高亮）没有单独建模。
- **影响**：“需要你回答”在列表里不够醒目（设计改造点之一），去回答路径变长；用户会误以为左侧色条代表“有无引用”。
- **建议**：恢复 `.need` 的 warn-fill 底色与左 warn 条；把“去回答”放回行右侧 primary 按钮；左侧引用色条删除或经设计确认。
- **验证**：静态；四主题/布局需GUI。
- **关联状态**：`need, list`

### P04-04: 行操作常显按钮 + 设计外的“展开详情”，没有设计的 hover“更多”菜单
- **严重度**：P3
- **维度**：结构 / A
- **类别**：结构 / 交互
- **设计依据**：`knowledge-history.html:20`（`.conv .acts{opacity:0}`，`:hover` 才显示）、`:74`（“更多”菜单 → 重命名/归档；need/broken 用行内按钮）
- **实现位置**：`KnowledgeHistoryPage.tsx:132-134`（每行常显“展开详情/收起详情 + 去回答/核对原问答 + `ConversationActions`”）、`:134`（设计外的展开详情区：最近一问/回答/引用/继续追问）、`ConversationActions.tsx:24-28`（重命名/归档/恢复平铺按钮）
- **差异**：设计是轻量行 + hover 时“更多”菜单收纳重命名/归档；实现每行常显 3-5 个按钮，并新增设计没有的“展开详情”区域。
- **原因**：C4/C5（未实现“更多”菜单收纳）。
- **影响**：列表视觉噪音与行高增加，与设计“轻量列表”不一致；功能更直接，属可讨论的产品扩展。
- **建议**：恢复“更多”菜单收纳次要操作；若保留展开详情，需设计确认并记录差异。
- **验证**：静态；hover 行为需GUI。
- **关联状态**：`list`

### P04-05: 加载骨架数量、错误态形态、更早日期格式与零引用显示等细节与设计不符
- **严重度**：P3
- **维度**：S / T / 结构
- **类别**：状态 / 文案 / 结构
- **设计依据**：`knowledge-history.html:61`（loading：4 行骨架）、`:63`（error：整页 danger banner“记录加载失败 / 网络或服务暂时不可用，已有对话不受影响。 / 重试”）、`:73`（今天/昨天显示 `HH:mm`，更早显示“10月6日”等日期）、`:72`（引用数只在 `d.c` 非零时显示）
- **实现位置**：`KnowledgeHistoryPage.tsx:328-342`（3 行骨架）、`:317-326`（按项目分片 `ServiceNotice` + 说明 + `刷新` 按钮，无整页“记录加载失败”）、`formatEntryTime:61-68` + `app/format.ts:21-34`（更早显示“10月06日 10:00”含时间）；`:129`（恒显示“· 0 处引用”）
- **差异**：骨架 3 vs 4；错误态是分片 notice 而非整页 banner（能力等价，形态不同）；更早条目带时间（设计只日期）；零引用仍显示。
- **原因**：C3/C4（细节层）。
- **影响**：细节观感与设计不完全一致，不影响功能。
- **建议**：按设计对齐骨架数量、更早日期只显示日期、零引用隐藏；全项目读取失败时可汇总为整页 banner。
- **验证**：静态；需GUI。
- **关联状态**：`loading, error, list`

## 已核对一致

- **路由与入口**：`/knowledge`、`/knowledge/history` 均存在（`apps/web/src/app/App.tsx:53-54`），菜单“知识库”与设计一致（`apps/web/src/app/navigation.ts:28`）；页头“对话记录/历史对话”互链、`?project=` 传递筛选（`KnowledgePage.tsx:466-468`、`KnowledgeHistoryPage.tsx:148-156`、`:236-241`）。
- **真实问答链路（非 mock）**：`POST /api/knowledge/ask`（`packages/server/src/http.ts:1054-1057`）→ `KnowledgeService.ask` 调受管 OpenCode（`packages/engine/src/knowledge.ts:176-210`），引用由服务端按真实文档行校验（`knowledge.ts:564-580` 的 `validateCitations`），无引用时不伪造（`KnowledgePage.tsx:652`）。
- **流式真实性（重要口径）**：系统**没有 SSE 知识流**（`/api/events` 只广播 store 事件，`server/http.ts:1600-1620`；知识页面未订阅），但**存在真实增量流式**：引擎 `onTextDelta` 解码 answer 字符串并持久化 `progress.answer`（`engine/knowledge.ts:196-203`），前端 700ms 轮询 `GET /api/knowledge/runs/:key` 并渲染部分回答（`useKnowledgeAsk.ts:77-98`、`KnowledgePage.tsx:594-599`）。这不是假动画，也不是设计要求的“回答区流式+引用编号”（见 P03-01/P03-02）。
- **来源冻结**：结果带 `sources.frozenAt/contentHashes/selectedPaths/readPaths/truncatedPaths`（`contracts.ts:481-489`），打开原文时携带原 requestKey 读冻结快照（`KnowledgePage.tsx:400-415`、`engine/knowledge.ts:359-373`），页面显示冻结时间与实际读取/节选范围（`:642-647`）。
- **撤权清正文**：许可撤回后进度回答清空、结果接口 403、历史条目标记 `readability:'forbidden'` 并清空 answer/citations（`engine/knowledge.ts:288,383,427-445`；`knowledge-inputs.ts:37-43`）；前端权限变化时清空已展示结果与原文（`KnowledgePage.tsx:287-291`），历史页显示不可读原因（`KnowledgeHistoryPage.tsx:128,134`）。
- **回执与 UNKNOWN**：发送前先持久化 requestKey（sessionStorage），accepted/unknown 锁定且只读核对、不重发（`useKnowledgeAsk.ts:15-22,37-43,52-75,127-154`）；页面提供“核对原操作”横幅（`KnowledgePage.tsx:602-612`）。
- **权限两开关与回执**：原资料读取/网络公共检索 switch、requestKey、accepted→failed/unknown 文案与“核对原许可操作”均实现（`KnowledgePermissions.tsx:12-38`）。
- **引用原文 520 面板**：右侧 grid 520 列、sticky、行号+snippet 高亮、命中行滚动居中、上一处/下一处、窄屏 Modal（`KnowledgePage.tsx:64-173,750-813`、`knowledge.css:9-64`）；与设计“从右侧推入、不遮回答”的静态结构一致（动效差异见 P03-17）。
- **历史页五状态与列表字段**：list/need/loading/empty/error 全部实现；搜索（问题/回答）、项目筛选、分段、今天/昨天/更早分组与计数、回答摘要、模型、引用数、时间、去回答/核对原问答、继续追问入口均在（`KnowledgeHistoryPage.tsx:204-212,272-401`）。
- **原上下文追问**：历史行带 `conversation` + `requestKey` 回到 `/knowledge`（`:124`），知识页 `openRun` 恢复结果与原对话、沿用对话模型/项目，追问时引擎带同一对话最近 3 轮上下文（`useKnowledgeAsk.ts:100-115`、`engine/knowledge.ts:173-180`）；归档/未结束时 `followUp` 禁用原因可读（`knowledge-conversations.ts:49`、`KnowledgeHistoryPage.tsx:134`）。
- **会话重命名/归档/恢复**：`requestKey`+`expectedRevision`+`confirm`、回执与 UNKNOWN 只读核对、归档后禁止追问、恢复保留原问答（`ConversationActions.tsx:14-33`、`knowledge-conversations.ts:51-65`）。
- **needs_answer 真实性**：来自原生 question 交互与真实运行状态，不伪造（`knowledge-conversations.ts:45-46`、`engine/knowledge.ts:289-290`）。
- **B-08 面板结构**：480 抽屉（`Drawer size="md"`=`--drawer-md`，`KnowledgeResearcherDrawer.tsx:28`、`ds.css:88`）、标题“知识研究员当前工作”+“只读 · 查看不会执行或修改任何内容”（`:28-29`）、五节顺序与设计一致、读取版本行、打开原文会关闭本面板（`KnowledgePage.tsx:400-407`、`:971`）、引用/来源均来自真实结果。
- **主题令牌**：`knowledge.css`、`research-timeline.css`、`knowledge-history.css` 及该区域 TSX 中无硬编码颜色（grep `#hex/rgb` 无命中），新增组件全部使用 `var(--*)`；不显示原型“设计样例/示例原文”水印，引用面板改“只读正文”（`KnowledgePage.tsx:121`）是正确处理。
- **诚实降级（非缺陷）**：设计 `knowledge-history.html:52,55,74` 的“连接中断 + 继续”与项目“UNKNOWN 只能核对、不重发”规则冲突，实现改为“待核对 + 核对原问答”（`KnowledgeHistoryPage.tsx:123,132`），属 C9 正确降级；B-08 工具记录依赖运行时真实 tool parts（当前 `toolPolicy: 'questions_only'`，`engine/knowledge.ts:184-185`），无工具时展示空记录而非伪造工具卡，也属 C9 诚实降级（但空态文案问题见 P03-07）。

## 需 GUI / 运行验证

1. 引用原文 520 面板在 1440/1280/1024 与四主题下是否真正“不遮回答”、sticky 定位与命中行 `scrollIntoView` 的观感（`KnowledgePage.tsx:84-90`），以及 ≤1200px 改 Modal 后是否遮挡（静态无法判定设计期望）。
2. 运行中增量显示的观感：700ms 轮询下部分回答的刷新跳动、停止/继续生成、长回答（6000–8000 字）下拉刷；以及“研究中”进度卡是否会造成页面抖动。
3. 四主题（deepseek/warm/spdb/github-white）下 `kb-*`、`kh-*` 新组件的颜色对比、状态图标+文字可读性（V 维度按要求不在静态审计下结论）。
4. 抽屉/Modal 的键盘与焦点：研究员抽屉打开时焦点/`aria-expanded`（P03-16）、Drawer 无 Tab 焦点陷阱（另见 GLB-13）、窄屏引用 Modal 的 Esc/焦点归还。
5. 资料来源抽屉与引用面板切换时的布局跳动（无过渡），以及面板打开时主内容收缩后的换行/溢出（P03-04、P03-17）。
6. 历史页在真实数据下：need 行高亮缺失的视觉差异、hover 显示操作（设计） vs 常显按钮（实现）、640/720px 断点隐藏（`knowledge-history.css:217-225`）与设计窄屏。
7. 真实模型跑一轮（可复用 E29 环境）确认 `steps/toolActivity` 的真实形状与“工具轨迹”渲染，以及停止→继续生成的完整链路。
8. 搜索无匹配/读取失败/撤权后的知识库历史卡空白（P03-07）在 GUI 下的实际呈现。

## 未覆盖 / 说明

- 本轮**未运行 Web GUI、未重跑 E29 live/四主题截图对比**，V 维度与真实交互均为静态推断或需 GUI；未做像素级对比。
- 未覆盖网络公共检索与数据库来源在真实环境下的完整研究/引用 UI（本轮只核了契约与静态分支：`knowledge-inputs.ts:52-108`、`KnowledgePage.tsx:889-905`）。
- B-08 的“证据读取中/版本已变化”真实触发需要故障注入或并发写入，本轮静态已判定 409 分支不可达（P03-10），但未运行验证。
- 设计稿 B-08 的工具记录内容（4 次检索/读取）是 mock；当前运行时策略 `questions_only` 下检索由应用侧完成、模型工具记录可能长期为空，属**设计缺口/诚实降级（C9）**，不计实现缺陷；但旧记录/停止场景的空态措辞问题已计入 P03-07。
- 知识库“资料来源”的抽屉形态是评审历史遗留选择（`docs/review/knowledge-receipts-sources-2026-10-20.md:25`），本轮按设计权威仍记为 P03-04，供 Lead 决定是否接受为产品差异。
- **文档口径（C10，供 Lead 统一记录，不占本区域主清单）**：`docs/design-coverage.md:136` 仍称“角色证据/项目许可无 DTO”、`:137` 仍称“服务无会话状态字段；无重命名/归档/删除”，而当前代码已有 `KnowledgeRoleEvidence`（`contracts.ts:460-467`）、`KnowledgeSourcesResponse.permissions`（`:570-575`）、`KnowledgeConversation.state` 与 rename/archive/restore（`:504-516`、`server/http.ts:1074-1080`）；`docs/design-coverage.md:126` 与 `docs/remaining-work.md:28` 的“知识问答非流式”应限定为“无 SSE，但有真实增量轮询流式”（`engine/knowledge.ts:196-203`）；`docs/review/knowledge-receipts-sources-2026-10-20.md:25` 的“来源类型/两许可开关仍待实现”也已被当前代码超越（`KnowledgePermissions.tsx:34-38`、`KnowledgePage.tsx:828`）。
- 本区域未发现实现违背“明确不开放/不可误实现”清单的项。
