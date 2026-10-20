# 节点执行详情 · 设计一致性修复处置（task-4 / node-detail）

> 输入：`docs/review/design-audit-2026-10-20.md` §0/§3.4/§7 + `docs/review/design-audit-2026-10-20/08-node-detail.md`（NODE-01..28 全量）。
> 设计权威（只读）：`opencode-workflow-design-showcase/sources/node/{COVERAGE.md,API-REQUIREMENTS.md,README.md}` + `originals/node/assets/{node-detail.js,states.js}` + `originals/node/node-detail.css`。
> 分支：`fix/design-audit-2026-10-20`（基于 `main@3f6f9b2`，未切换、未 commit/push）。
> 写范围：本轮全部改动落在 `apps/web/src/pages/node/**`（未修改 `contracts.ts`/`enums.ts`/`api/workflow.ts`/`internal.ts` 等共享文件，避免并发冲突）。
> 判定口径遵守 `docs/review/design-fix-2026-10-20/00-plan.md` §1：服务/契约缺失（C1）与需 GUI 验证项只做「诚实降级 + 可做时前置就绪」，不伪造成功态。

## 0. 总体结果

| 项 | 结果 |
|---|---|
| P1（NODE-01..10） | **5 已修复 / 5 部分**（已修复：01/02/04/05/06；部分：03/07/08/09/10，均因 C1 服务契约缺口或节点级取消回执缺失，前端链已按要求就绪并诚实标注） |
| P2（NODE-11..24） | **7 已修复 / 7 部分**（已修复：11/12/13/16/19/23/24；部分：14/15/17/18/20/21/22，原因为 C1 字段缺失、需 GUI 或跨任务所有权） |
| P3（NODE-25..28） | **3 已修复 / 1 部分**（26/27/28 已修复；25 部分：真实晚回时序需 GUI/故障注入） |
| 新增模块 | `node-labels.ts`、`node-facts.ts`、`node-citations.ts`、`NodeMarkdown.tsx`、`NodeRecordFeed.tsx`、`NodeAttempts.tsx`、`NodeOverview.tsx` |
| 重写/重排 | `NodeDetailPanel.tsx`（1001→1567 行，结构按设计 N01–N20 重排）、`ToolDetailView.tsx`、`ArtifactDetailView.tsx`、`CitationSourceView.tsx`、`ReadableText.tsx`、`node.css`、`readable-text.css` |
| 回归测试 | 新增 `apps/web/src/pages/node/node-facts.test.ts`（10 例）、`node-citations.test.ts`（4 例）；连同既有 `tool-feed.test.ts`，`node --import tsx --test apps/web/src/pages/node/*.test.ts` = **14/14 通过** |
| 类型检查 | `npm run typecheck` **全仓 0 错误**（收尾时复跑；并行任务在途错误已由各自负责人修复，Lead 已确认全仓 0 错误） |
| 设计系统 | `npm run check:design` OK（ds.css 未改，仍与设计稿逐字节一致；无组件硬编码颜色） |
| 构建 | `npm run build:web` OK（vite：762 modules transformed，产物正常生成；仅既有 chunk 体积提示） |

**证据约定**：`文件:行` 为收尾时工作区行号；同一条目给多个锚点（函数/选择器名）便于复核。设计依据行号引用审计报告原文，不重复展开。

---

## 1. P1 处置（NODE-01..10）

| ID | 状态 | 证据（文件:行） | 说明 |
|---|---|---|---|
| NODE-01 | **已修复** | `NodeDetailPanel.tsx:795-845`（eyebrow「步骤 N · 职业」+ 标题 + 状态徽标 + 尝试 chip/菜单/回到当前）；`:580-594`（菜单项文案）；`node-labels.ts:33-64`（状态徽标映射）；`node.css:2-100`（`.node-head-badges/.node-att-chip/.node-att-menu`） | 面板头四要素齐：步骤序号（由 `plan.graph.nodes` 计算，缺 plan 时只写「步骤」）、职业名（`node.roleSnapshot.name`，缺快照写「职业未记录」）、节点状态徽标（文字+图标+主题色，N06 口径：结果提交未验收只显示「执行已结束」）、尝试选择 chip（`aria-haspopup="menu"`、`aria-expanded`、`aria-label`，菜单列出全部尝试 + 当前/历史标识 + 「回到当前尝试」）。点击空白/再点 chip/Esc 关闭菜单（`:200-212`）。 |
| NODE-02 | **已修复** | `NodeMarkdown.tsx:75-113`（流式安全 Markdown + 未闭合代码块 + caret）；`node-citations.ts:105-112`（未闭合围栏检测）；`NodeRecordFeed.tsx:143-158`（模型正文块：标签 + 复制 + Markdown）；`node-facts.ts:416-497`（feed 组装，`live` 只给最后一个正文块；无 callId 的工具记录回退成通用卡，不丢记录）；`node.css:740-935`（`.node-md*` 表格/代码块/长链接 break-word、`.node-md-live > :last-child::after` 末块静态光标 + `prefers-reduced-motion` 关闭闪烁）；`readable-text.css:21-47` | 复用本仓已有 `react-markdown@10` + `remark-gfm@4` 渲染 GFM 标题/列表/表格/引用/行内代码/代码块/链接；未闭合代码块显示「代码块未结束 · 正在生成 / 没有收到结束标记」；流式时最后一个正文块尾部显示静态光标，减少动态时停止动画；长链接 `overflow-wrap:anywhere`。代码块带头部语言标签、复制、>14 行折叠展开。`format=text` 片段降级为纯文本（不冒充 Markdown）。 |
| NODE-03 | **部分**（C1 数据源） | `NodeRecordFeed.tsx:24-107`（工具卡：名称/来源标签/#callId/中文状态徽标/参数行/结果行/晚回注/未知注，整卡可点开详情）；`node-facts.ts:90-165`（按 callId 合并、参数/结果跨事件合并、晚回=完成事件 seq 晚于后续正文、尝试结束仍 running→结果未知）；`node-labels.ts:86-110`（成功/失败/运行中/排队/已取消/结果未知）；`:118-132`（来源标签/来源说明）；`NodeRecordFeed.tsx:20-22`（`.node-tt` 时间格，未知显示「时间未知」） | 已去掉英文原始状态（`completed/running/failed`）与 `read · success` 文案，全部映射为设计中文状态+图标；补「参数 / 结果」两行、来源标签、「结果于 HH:MM:SS 返回（晚于后续正文）」（时间未知时写「时间未知」）、失败/取消后运行中工具改「结果未知」并注「服务没有记录它的结果」。**未达部分**：`queued`/`cancelled` 状态值来自服务端工具事件的能力缺失——引擎只写 `completed/running/failed`（`packages/engine/src/execution.ts:1250`、`packages/opencode/src/runner.ts:14`），前端映射分支已就绪但当前无法由真实服务产生（C1），未伪造。 |
| NODE-04 | **已修复**（产品验收口径按 C9 保留并明示） | `node-facts.ts:207-272`（五格逐状态取值）；`node-labels.ts:33-84`（ATT_ST/RES_ST 映射）；`node-labels.ts:66-84`（结果与验收：未提交/已提交待验收/验收通过/未通过/待人工验收 + 结果修订）；`NodeDetailPanel.tsx:994-1017`（事实条渲染 + busy spin + 过时 tag）；`:1013-1017`（组合说明） | 五格改为设计枚举：数据连接（已连接/正在连接/已断开/补读中/已连接·已补读/历史记录·不更新）、模型正文（读取中/尚无正文/传输中断/已停止/传输结束/等待工具返回/正在生成/无权读取）、工具（读取中/无/N 个运行中/1 个排队/结果未知/全部结束/无权读取）、尝试（执行中/取消中/执行已结束/已完成/失败/已取消/状态未核对/待执行）、结果与验收（未提交/已提交待验收/验收通过/未通过/待人工验收/回执未知，不再用节点状态冒充）。`succeeded + 待人工验收` 时显示「待人工验收」而非「已完成」。历史模式五格冻结并显示「历史记录 · 不更新」，断线时逐格「过时」tag（`:207-215`）。 |
| NODE-05 | **已修复**（短期方案，符合报告建议） | `node-facts.ts:326-397`（快照投影服务事件：开始/连接中断/已补读 N 条（去重 M 条）/缺口/请求停止/结果已提交·等待验收·结果修订/验收通过/未通过/进入人工验收/执行失败原因/执行器已确认停止/结果未确认）；`NodeDetailPanel.tsx:1019-1035`（渲染 + **「来源：服务快照（不是记录流顺序）」**）；`node-labels.ts:111-116`（记录类别词表：模型正文/公开推理摘要/工具调用/服务事件）；`NodeRecordFeed.tsx:160-166`（若服务将来写入 `service_event` 片段仍按记录流渲染） | 报告建议「短期前端用快照事实组合只读服务行（明确来源：快照），长期请服务补 service_event 投影」已落地为短期方案：事件行只在当前尝试显示、历史不追加，并显式标注来源为快照，不假装是记录流顺序。服务端 `service_event` producer 仍缺（`packages/shared/src/domain/models.ts:807`、`events.ts:17` 只有类型），属 C1，不在区域写范围。 |
| NODE-06 | **已修复** | `NodeDetailPanel.tsx:325-345`（follow/paused/newCount/dirty 状态）；`:1135-1144`（离底 <8px 恢复；上翻 >80px 自动暂停）；`:1187-1215`（「有 N 条新内容 · 回到最新」胶囊 / 「有新内容 · 回到最新」/「回到最新」、开关旁「· 已暂停」）；`:371-390`（打开阅读区/切换前记录 feed 位置）；`:55-56`（`panelMemory`/`feedMemory`，按 `task:node:attempt` 记忆位置）；`node-facts.ts:274-324`（组合说明含「已补读」句子） | 计数只数新条目；同一正文块增量记「有新内容」；开关关闭只计数不滚动；胶囊点击回到底部并清计数（follow 开时恢复跟随）；位置按任务:节点:尝试记忆，切页签/开阅读器/切尝试往返恢复；历史模式无跟随开关（设计 N17）。滚动观感与平滑滚动需 GUI 复验（见 §4）。 |
| NODE-07 | **部分**（C1 节点级取消回执） | `node-labels.ts:33-49`（`executionStatus=stopping/pausing` → 「取消中」；`cancelled` → 「已取消」；`unknown` → 「状态未核对」）；`node-facts.ts:274-324`（组合说明「取消请求 ≠ 已停止」）；`:326-397`（「你请求停止这一步 · 等待执行器确认」「执行器已确认停止」「执行结果未确认 · 界面不会重复发送」）；`NodeDetailPanel.tsx:1383-1560`（页脚：取消中提示 / 结果待核对 + 「重新读取状态」/ 无重发）；`flow/workflow-ui.tsx:114-150`（面板内 accept/reject/advance 的 UNKNOWN 只按原 requestKey 核对）；`NodeDetailPanel.tsx:1122-1127`（session 内 ReceiptNotice） | 取消链以真实投影表达：执行状态 `stopping`→取消中且组合说明明确「请求≠已停止、确认前仍可能有新记录」；`cancelled`→已确认取消；`unknown`/`stopping` 未确认时页脚给「重新读取状态」（只重读，不发停止/提交），并明示「核对完成前不能操作」。**未达部分**：面板不发起停止（停止操作在任务画布），因此没有原始取消 requestKey 可在节点面板按 `operations.by-key` 核对；结果提交回执未知由面板内命令回执覆盖（ReceiptNotice），节点级取消/提交回执核对入口需服务暴露待核对操作（C1，见区域报告 NODE-07 建议）。未伪造「已确认」。 |
| NODE-08 | **部分**（前端链完整；服务游标/缺口契约 C1） | `NodeDetailPanel.tsx:383-415`（重新连接：记录基线 fragmentId → 重读 detail/output/attempts → 统计新增/已存在 → 是否有缺口，进入 reading/done/gap/failed）；`:1061-1084`（断线/重连 banner +「重新连接」按钮 +「重连成功只代表数据恢复，不代表模型仍在执行」）；`:1086-1090`（缺口汇总/缺口明细提示）；`node-facts.ts:167-180`（缺口区间）；`:246-258`（执行记录 `过时` tag）；`NodeRecordFeed.tsx:116-133`（虚线缺口条「#a–#b 的记录无法补读（服务未保留）」+「补读」tag） | 已实现「断开→过时标记→重新连接→补读中→补读完成（已补读 N 条（去重 M 条））/有缺口」链；连接与执行两句分离（连接恢复≠模型仍在执行）；补读数量**明确标注为「客户端按 fragmentId 统计」**（不是服务游标）。**未达部分**：`NodeOutputResponse` 只有 `hasMore/nextSeq`，没有 `gaps[]`/保留期/去重游标（`packages/shared/src/api/contracts.ts:2216-2220`），所以无法做服务级按游标补读与权威缺口区间；当前按 seq 洞推导缺口并在 UI 明示「可能是尚未补读或服务未保留，不补造」。属 C1。 |
| NODE-09 | **部分**（C1 结构化引用数据） | `node-citations.ts:15-100`（`NodeCitation`、防御式读取、只把结构化 index 变成链接）；`NodeMarkdown.tsx:79-104`（`[n]` → 可点上标，点开阅读器；无结构数据时保持普通文本）；`CitationSourceView.tsx:109-171`（结构化引用阅读器：代码行范围/原文段落/节选/摘要四类定位文案、路径、来源版本、更新版本旁注）；`:31-105`（需求来源：完整原文/节选/无定位三态 + 版本身份 + 字符定位高亮，明确「字符定位不是行号」）；`NodeDetailPanel.tsx:738-775`（阅读区左栏可切换引用） | 设计要求的「正文 [1] 入口 / 精确代码行 / 节选标注 / 摘要不伪造行号」阅读器已就绪且只在结构化数据存在时生效（避免把正文 `[1]` 假造成来源）。**未达部分**：`OutputFragment` 无 `citations` 字段、`source.read` 只有需求来源变体（`packages/shared/src/domain/models.ts:803-814`、`contracts.ts:775-786`），本轮未获授权改 `models.ts`，所以当前服务数据下正文无可点引用、无代码行数据；需求来源只有字符偏移（服务不提供行号）。属 C1，需要在契约层补 `citations`/`SourceRef` 后再点亮。 |
| NODE-10 | **部分**（C1 修订/代次/分页字段） | `NodeAttempts.tsx:38-128`（列表：序号/当前历史 tag/状态徽标/起止/定义修订（计划修订短 id）/原因/「查看」；末尾如实写「已显示全部 N 次尝试 · 服务未提供保留期与分页信息」）；`:134-291`（单次详情子视图：‹ › 切换、「查看这次的执行现场」、结果/验收/产物/错误与警告分区、历史只读说明、`已被尝试 #N 的结果 rN 替代` 标记）；`NodeDetailPanel.tsx:1225-1263`（打开/切换单次详情、从详情回执行现场）；`:808-845`（面板头尝试选择同入口） | 已补设计 N17 列表项与「单次详情 + ‹› + 查看执行现场」交互，历史只读、当前/历史身份清晰。**未达部分**：`AttemptListResponse` 无 `definitionRevision/executionGeneration/retention/nextCursor`（`packages/shared/src/api/contracts.ts:1645-1657`），所以「定义修订 vN / 执行代次 N」只能显示服务真实持有的计划修订 ID，并在详情中明写「服务未提供执行代次字段；每次尝试以尝试序号区分」；分页与保留期提示同样如实说明缺失（C1）。 |

---

## 2. P2 处置（NODE-11..24）

| ID | 状态 | 证据（文件:行） | 说明 |
|---|---|---|---|
| NODE-11 | **已修复** | `NodeOverview.tsx:53-142`（「当前尝试」卡：状态/起止/定义修订/工具调用数/尝试次数/结果与验收；「这一步做什么」；「谁来做」职业快照+修订；「产出 · 尝试 #N」+ 打开；「查看全部尝试与产出」） | 按设计补四个区块；明确「只列服务记录的事实，不估算进度；正文没有可信总量，不显示百分比」；原扩展区块（来源需求/依赖/IO/条款/资源）保留在之后。产出打开走宽阅读区。 |
| NODE-12 | **已修复** | `ToolDetailView.tsx:55-68`（错误码分支）；`:129-160`（`FORBIDDEN` 锁区 + 保留摘要层；`CAPABILITY_UNAVAILABLE` **unknown 虚线中性**「这不是错误」；`NOT_FOUND` 明确说明）；`:204-209`（`content===null`「服务没有保存这部分」vs 空串「工具返回空结果」中性样式）；`:173-201`（读取失败保留已加载内容 + 重新读取）；`ReadableText.tsx:86-104`（空结果中性样式） | 错误码到设计状态的映射按 `API-REQUIREMENTS.md` 落实：无权限整区上锁只留摘要；缺能力按未知中性（不报错）；空结果与未保留区分；分页失败不再用 error 覆盖已加载内容。 |
| NODE-13 | **已修复** | `ArtifactDetailView.tsx:53-62`（错误码/下载能力判定）`:88-160`（无权/不存在/版本失效/不支持格式/读取失败各自状态，metadata 层始终保留；不支持格式显示 mime+大小）；`:139-153`（读取失败保留已加载）；`NodeDetailPanel.tsx:738-775`（阅读区左栏产物列表 + 面包屑 + Esc/返回） | 按错误码区分「不存在 / 版本失效 / 无权 / 不支持格式 / 读取失败」，不再统一成「数据读取失败」；阅读区补左栏与面包屑，可切换产物/引用而不退出。 |
| NODE-14 | **部分**（契约 C1 + 语法着色延后） | `ReadableText.tsx:8-12`（JSON 类型三色：字符串/数字/字面量）、`:77-78`（全部展开/收起）、`:86`（forced 展开模式）、`:67-70`（格式 chip 由调用方传入）、`:106`（`reader-foot` 行范围）；`ToolDetailView.tsx:211-219`（格式 chip + 已加载行范围 + 是否还有更多）；`ArtifactDetailView.tsx:154-160` | 已补 JSON 三色、全部展开/收起、格式 chip、已加载行范围/截断文案、"搜索只在已加载内容"。**未达部分**：服务契约无 `ContentSection.format/sizeBytes/totalLines/range/exitCode`（`contracts.ts:788-798`、`:810-815`），退出码/总行数/精确「前 64 KB」无法可信显示（截断文案按实际未知写「服务只保留了受限长度的内容」）；语法着色为设计 C7 细节、本轮未做（延后到后续批次）。 |
| NODE-15 | **部分**（需 GUI 视觉复核） | `node.css:1110-1114`（宽阅读区 `min(960px, calc(100vw - var(--nav-w) - 240px))`）；`:1116-1210`（`.node-rd-top/.node-rd-crumbs/.node-rd-body/.node-rd-list/.node-rd-main`）；`NodeDetailPanel.tsx:738-775`（阅读区头=面包屑+Esc+返回+关闭；左栏+主区）；`:1129-1207`（普通页签执行现场无「宽阅读」按钮） | 宽度公式改为设计值；补左栏列表与面包屑；「宽阅读」仅在阅读器出现（普通页签不再能拉宽）。**未达/待验证**：1024/1280/1440 × 四主题的像素级布局与「左露画布」观感需 GUI 实测（报告已标需 GUI）；阅读器仍是「替换面板内容」结构，与设计「面板扩张」视觉等价但需 GUI 确认。 |
| NODE-16 | **已修复**（静态；键盘矩阵待 GUI） | `NodeDetailPanel.tsx:843-871`（tablist roving tabindex + ←/→/Home/End）；`:180-198`（Esc 栈：阅读区 → 尝试菜单 → 单次详情；Modal 打开时交给 Modal）；`:371-390`（打开阅读区记录触发元素，关闭后 `requestAnimationFrame` 归还焦点）；`:1129-1150`（记录区 `tabIndex=0 role="log" aria-live`，历史 off） | 页面级键盘行为按设计补齐；焦点环沿用 ds.css 全局 `:focus-visible`。完整 Tab 顺序/Esc 层级/焦点陷阱矩阵仍需 GUI 键盘实测（见 §4）。 |
| NODE-17 | **部分** | `NodeDetailPanel.tsx:1383-1560`（固定页脚：历史只读+回到当前 / 无权无动作 / 连接未恢复 / 结果待核对+重新读取 / 失败·验收未通过提示+查看尝试 / 取消中 / 待人工验收时页脚可达验收/退回（非概览页签）/ 已验收·查看产出 / 已取消 / 已结束后待提交 / 结果已提交待验收）；`:1329`（页脚固定在 body 之后） | 恢复固定页脚并按当前尝试状态给动作与原因；验收/退回在非概览页签可从页脚直接触达（概览内仍有完整验收卡）。**未达部分**：设计页脚的「恢复这一步」在产品没有面板内恢复动作（恢复走恢复页/任务画布，C9 设计边界），页脚改为提示「失败不自动重试；恢复入口在任务的恢复页」；「推进直接后继」（自动推进关闭时）仍只在概览，未搬入页脚。 |
| NODE-18 | **部分**（跨任务所有权） | `NodeDetailPanel.tsx:55-56`（`panelMemory`/`feedMemory`）、`:216-260`（按节点记忆 tab/尝试/跟随并在 nodeId 变化时恢复）、`:374-390`（阅读器往返 feed 位置）；`node.css:97-120`（原样保留） | 面板内已按节点记忆页签/尝试/跟随/滚动位置（N01-closed「再点回到上次页签与阅读位置」的面板侧）。**未达部分**：「关闭后面板不再渲染但保留选中描边、点空白才清除选中」依赖任务画布 `TaskCanvasPage`/`FlowCanvas` 的选中态与打开态分离，属 `07-tasks-task` 区域（task-3 写范围），节点面板无法单独修复，未越界修改。需 GUI 复核视口是否保持。 |
| NODE-19 | **已修复** | `NodeDetailPanel.tsx:600-672`（加载壳：保留面板头骨架、页签、事实条「读取中」、正文区骨架；尝试切换/回到当前时显示「正在读取尝试 #N 的最新记录」）；`:1152-1161`（空态按设计「模型还没有输出正文」+ 尝试开始时间 +「这不是错误，也不是完成」） | 加载态不再整面板 8 行骨架冒充："骨架只在正文区"、事实条读取中；空态文案与设计一致，并区分「尚未开始/已开始未输出」。 |
| NODE-20 | **部分**（服务能力 C1；UI 已就绪） | `NodeDetailPanel.tsx:1037-1042`（「关于此记录」句：来源顺序 +「本次未提供公开推理摘要」）；`NodeRecordFeed.tsx:65-100`（公开推理摘要独立折叠块：标签「公开推理摘要 · 由模型服务提供」、默认 3 行 clamp、展开全部、左竖线）；`node-labels.ts:120-124`（标签词表） | 无摘要时在「关于此记录」写一句说明（不再静默）；若服务将来产出该类别，前端按设计折叠块渲染（含复制）。**未达部分**：服务 capability 固定 `none_in_attempt`、`execution.ts` 不产出该类别（C1），因此「有公开推理摘要」状态当前不可达；provider 是否/如何公开需真实模型与能力确认（报告 N05）。 |
| NODE-21 | **部分**（C1 策略/结果版本绑定） | `node-labels.ts:66-84`（结果与验收带「结果修订 rN」）；`NodeDetailPanel.tsx:1265-1325`（概览验收卡：绑定 结果修订 rN + 明示「验收策略版本：服务未提供」）；`NodeAttempts.tsx:141-148`（历史结果「已被尝试 #N 的结果 rN 替代」标记；当前有结果时） | 结果修订号、历史「已被替代」标记、验收状态分离均已呈现，验收不再与「校验状态」混为一格。**未达部分**：`NodeAcceptanceView` 无 `subjectResultRevision/policyRevision`（`contracts.ts:1547-1553`），无法显示「验收通过（r3 · 策略 v3）」绑定；历史尝试的验收归属服务不提供（按节点记录），UI 明示不推测。需契约补齐。 |
| NODE-22 | **部分**（C1 保留期/分页） | `NodeAttempts.tsx:60-75`（分页/列表读取失败：banner + 重试，保留已加载）；`:104-110`（如实标注「已显示全部 N 次尝试 · 服务未提供保留期与分页信息」）；`NodeDetailPanel.tsx:1349`（尝试列表读取失败提示不顶替历史） | 分页失败保留已加载 + 重试已实现（设计 n18-page-fail）。**未达部分**：`AttemptListResponse` 无 `retention/nextCursor`、服务一次返回全部（`packages/server/src/http.ts:709-726`），「记录未保留（NOT_RETAINED）」无数据源，只能用如实说明替代；未保留尝试详情显式说明属契约补齐后事项（C1）。 |
| NODE-23 | **已修复** | `NodeDetailPanel.tsx:455-472`（`returningToCurrent` 状态与完成条件）；`:300-330`（加载中事实/组合说明）；`:644-665`（回到当前时事实条读取中 + 骨架 +「正在读取尝试 #N 的最新记录，读取完成前不显示结论，也不用当前尝试的内容顶替」） | 切回当前尝试期间冻结为「读取中」，不用历史内容/空态顶替；数据返回后自动解除。 |
| NODE-24 | **已修复** | `NodeDetailPanel.tsx:984-993`（session 无权锁：事实条与记录清除说明）；`:1225-1233`（尝试页签同样锁定，不显示尝试内容）；`:894-903`（概览无权 banner + 不渲染 attempt 派生事实）；`:1289-1297`（验收动作禁用并给原因「当前没有查看权限，不提供业务动作」）；`:1397-1409`（页脚「无权查看时不提供任何动作」+ 回到全图）；`:250-262`（撤权时清理 query 缓存） | 挽权时事实条/记录/尝试/概览 attempt 事实全部清除（不再渲染残留状态），验收与推进动作不提供并给原因，保留画布服务状态；文案「你已无权查看这次尝试的记录…不保留缓存」与设计一致。 |

---

## 3. P3 处置（NODE-25..28）

| ID | 状态 | 证据（文件:行） | 说明 |
|---|---|---|---|
| NODE-25 | **部分**（真实时序需 GUI/故障注入） | `NodeDetailPanel.tsx:151-160`（`lateIgnored` 一次性细提示「已忽略属于上一个节点的晚到内容」）；`:978-982`（session 顶部细提示）；`:60-72`（detail 身份校验：`taskId/nodeId` 不一致不渲染）；`apps/web/src/api/workflow.ts:128-141`（读取身份校验，晚回被丢弃） | 提示分支已实现。**未达部分**：查询按 nodeId 分键，晚到响应天然落在旧 key，不会串到新节点；真实「同键晚到」时序需 GUI/故障注入验证，未伪造验证结论。 |
| NODE-26 | **已修复**（部分措辞按事实校准） | `node-labels.ts:112-135`（词表：模型正文 / 工具调用 / 服务事件 / 公开推理摘要 · 由模型服务提供 / 工具来源）；`NodeRecordFeed.tsx:143-158`（正文块标签）；`ToolDetailView.tsx:231-260`（「已隐藏 · 服务端脱敏」chip + 复制/下载同样不含说明；截断文案）；`ArtifactDetailView.tsx:154-160`（不支持格式 mime+大小）；`:62`（下载失败不改变执行状态） | 术语统一为设计词表，工具/产物详情固定文案对齐。截断文案不写「前 64 KB」——服务未返回保留量（`tool-evidence.ts` 上限 256 KB 是服务常量、未在契约暴露），按如实表述处理。 |
| NODE-27 | **已修复** | `NodeRecordFeed.tsx:60-107`（正文/摘要块级复制、工具卡整卡可点）；`:126-133`（失败/取消时「正文在此中断 · 未完整」中断行）；`node-facts.ts:478-492`（cut item 仅失败/取消时追加） | 块级复制只复制正文原文（不含状态/隐藏内容）；失败/取消时补中断行；工具卡整卡可点（aria-label 说明查看详情），同时保留"指令只是资料、无重放"提示。 |
| NODE-28 | **已修复** | `ToolDetailView.tsx:84-112`（工具名+来源标签、调用 ID + 复制、所属尝试、状态、开始/结束/时长（未知样式）、来源说明）；`NodeDetailPanel.tsx:760-775`（仅阅读器加宽，普通页签无「宽阅读」控件）；`node.css:1110-1114` | 工具详情元信息补齐（结束时间/调用 ID 复制/来源说明/时长），未知时间显式「未知/未记录」；移除普通页签的宽度切换，恢复「480 面板 + 阅读区扩张」固定结构。 |

---

## 4. 需 GUI / 真实服务复验（不伪造结论）

1. **视觉**：四主题（deepseek/warm/spdb/github-white）× 1440/1280/1024：480 面板、`min(960, 100vw−nav−240)` 阅读区、左栏 220px、事实条 5 格换行、`.node-sess-top` 56% 上限在低高度下的记录区可用性。本轮只做静态与类型检查，未渲染像素。
2. **跟随最新**：上翻 80px 暂停、平滑滚动、胶囊出现/点击恢复、切换页签/尝试/阅读器往返位置恢复（`feedMemory`）——需真实滚动实测。
3. **键盘矩阵**：Tab 顺序（画布→面板头→页签→记录→页脚）、←/→/Home/End 切页签、Esc 栈（阅读区→菜单→单次详情）、打开阅读区聚焦/关闭归还焦点。
4. **断线/补读**：EventSource 断开→轮询→重连的真实时序；「重新连接」重读计数去重；缺口场景（服务未保留）需故障注入或真实保留期数据。
5. **取消/回执未知**：任务画布发起停止 → 面板显示取消中/已取消/状态未核对；节点级核对入口受 C1 限制（见 NODE-07）。
6. **真实模型**：公开推理摘要是否由 provider 提供（当前 capability 固定 `none_in_attempt`）；结构化引用 `citations`/代码行数据是否存在（当前契约无）。
7. **Electron 原生下载**：产物保存/取消/失败对话框（沿用既有能力，本轮仅文案与状态校准）。

## 5. 未覆盖 / 说明

- **共享契约缺口（C1）清单**（本轮只做诚实降级，未伪造）：
  1. 工具事件缺 `queued/cancelled` 状态（`runner.ts:14`、`execution.ts:1250`）；
  2. `NodeOutputResponse` 缺 `gaps[]`/保留期/去重游标（`contracts.ts:2216-2220`）；
  3. `OutputFragment` 缺 `citations`、`source.read` 缺通用 code/document + 行号/anchor（`models.ts:803-814`、`contracts.ts:775-786`）；
  4. `AttemptListResponse` 缺 `definitionRevision/executionGeneration/retention/nextCursor`（`contracts.ts:1645-1657`）；
  5. `NodeAcceptanceView` 缺 `subjectResultRevision/policyRevision`（`contracts.ts:1547-1553`）；
  6. `ArtifactContentResponse`/工具读取缺 `format/sizeBytes/totalLines/range/exitCode`（`contracts.ts:788-798`、`:810-815`）；
  7. 无 `service_event` fragment producer（`models.ts:807`、`events.ts:17` 只有类型）。
- **跨任务所有权**：NODE-18 的「关闭保留选中描边、点空白清除」在 `TaskCanvasPage`/`FlowCanvas`（`07-tasks-task`/task-3 范围）；NODE-07 的停止入口在任务画布；本轮未越界修改。
- **设计边界（C9，遵守）**：不提供重跑/重放/执行工具入口；不显示百分比/进度；人工验收按产品口径为审计事实、不改变执行状态（与设计「验收作为完成条件」冲突已在区域报告记录，本轮在 UI 明示产品口径，未改变服务语义）。
- **测试**：`packages/engine/src/node-read.test.ts` 不存在（任务预期「如存在」）；已运行相关 `packages/engine/src/tool-evidence.test.ts` 2/2 通过，并新增 14 例前端纯函数回归（facts/combo/tool cards/gaps/feed/service events/citations）。
- **验证命令**：`npm run typecheck`（全仓 0 错误）、`npm run build:web`（OK，762 modules）、`npm run check:design`（OK，ds.css 未改）、`node --import tsx --test apps/web/src/pages/node/*.test.ts`（14/14）、`node --import tsx --test packages/engine/src/tool-evidence.test.ts`（2/2）。GUI/真实服务项未跑，不作为已通过。
