# 知识库 / 知识对话记录 处置记录（P03 / P04）

> 审计来源：`docs/review/design-audit-2026-10-20/02-knowledge.md`（P03-01..17、P04-01..05；本区域无 P0）。
> 设计权威：只读 `opencode-workflow-design-showcase/originals/main/pages/{knowledge,knowledge-history}.html`。
> 分支：`fix/design-audit-2026-10-20`。执行：global-shell（task-9，时间闸门内收尾）。
> 状态：已修复 / 部分（做了真实可支撑的部分，残余注明原因）/ 延后（C1/C9/需 GUI）。
> 口径：模型/研究步骤/来源/引用全部来自真实服务数据；服务未提供的字段显式说明，不伪造进度、来源或引用锚点。

## 1. 总表

| ID | 严重度 | 状态 | 证据（文件:行） | 说明与残余 |
|---|---|---|---|---|
| P03-01 | P1 | 已修复 | `contracts.ts:443-470,463-468`（`KnowledgeProgressSource` / progress `steps/toolActivity/sourceCards`）；`engine/knowledge.ts:145-199`（真实增量步骤与来源读取落 progress）；`engine/knowledge-inputs.ts:87-111`（`onDocument` 真实逐份读取回调）；`KnowledgeConversationEntry.tsx:148-320`（研究中展开/完成后收起一行摘要/命中来源卡/回答流式区）；`KnowledgePage.tsx:676-735` | 运行中按真实读取顺序 + 真实时间戳逐份出现来源卡；研究步骤来自服务端真实步骤（retrieve/model/tool/validate，不伪造设计四步）；完成/停止后收起为“研究过程 · N 份来源 · 用时 Xs”可展开；流式增量回答渲染在回答区并带 caret。**残余**：来源卡无相关度评分（服务未提供，界面明确说明）；设计四步中的“理解问题”无真实数据支撑，未伪造。 |
| P03-02 | P1 | 已修复（需真实模型验证） | `engine/knowledge.ts:598-607`（SYSTEM_PROMPT 强制 `[n]` 编号与 citations 顺序）；`:644-660`（`withCitationIndexes` / `stripInvalidCitationMarkers`）；`contracts.ts:472-479`（`KnowledgeCitation.index`、answer 注释）；`KnowledgeConversationEntry.tsx:74-118,260-300` | 模型输答案内联 `[n]`；服务端校验引用后写 1-based `index`，并删除无效/越界/截断的标记（不会出现指向不存在引用的上标）；前端把 `[n]` 渲染为可点引用上标，联动右侧引用面板与列表 active 态；旧回答无标记时显式提示“服务未提供句子级引用位置”，不用列表冒充上标。**需真实模型**：输出标注质量取决于模型遵守 prompt，需一次真实问答/回放验证。 |
| P03-03 | P2 | 已修复 | `KnowledgeConversationEntry.tsx:180-200,300-320`（提问气泡/复制/重新生成/“N 处引用 · M 份原文”）；`KnowledgePage.tsx:395-433`（question 从 result/progress 恢复、copy/regenerate 绑定） | 提问气泡始终显示 `question`（含刷新/深链/历史打开）；复制写入剪贴板并给“已复制”；重新生成以同问题/同来源新建问答（不伪造替换语义）；结果恢复时问题同时回填输入框。 |
| P03-04 | P2 | 延后（C9） | `KnowledgePage.tsx:880-1000`（资料来源仍为带遮罩 Drawer） | 设计权威为并排 400 面板；实现沿用历史评审确定的 400px 抽屉（`docs/review/knowledge-receipts-sources-2026-10-20.md:25`）。改为并排面板属产品/设计裁决（C9）+ 布局重排，本轮时间闸门内不做，避免半成品；分组计数与“完成”按钮一并延后。 |
| P03-05 | P2 | 已修复 | `KnowledgePage.tsx:536-570`（页头当前项目选择 + 会话锁定 lock/原因）；`:940-980`（资料抽屉不再重复项目下拉） | 项目选择/当前项目名移到内容页头（`/knowledge` 的 Shell 页头按设计为空，标题与上下文由页面承担，见 GLB-05）；会话锁定后 disabled + lock 图标 + title 原因；资料来源抽屉里只显示当前项目事实。 |
| P03-06 | P2 | 已修复 | `useKnowledgeAsk.ts:16-21,125-165,190`（stop 回执状态 + `reconcileStop` 仅 GET 原 key）；`KnowledgePage.tsx:737-765`（停止失败可重试 / 未知只核对横幅）；`KnowledgeConversationEntry.tsx:230-260`（停止 banner 原文） | 停止回执 accepted/unknown/failed 进入 UI：failed 明确“停止未生效”并允许重新停止；unknown 展示原 requestKey 并只提供 `operations/by-key` 核对（绝不重发）；停止后回答区按设计展示“已停止生成。已写出的内容保留，引用只对已完成的句子生效。” |
| P03-07 | P2 | 已修复 | `KnowledgeConversationEntry.tsx:255-290`（停止后引用解释；无步骤/工具显式说明）；`ResearchTimeline.tsx:64-72`（旧记录无步骤/工具的空态文案）；`KnowledgePage.tsx:860-885`（历史卡 forbidden 禁用+原因，`:760-770` 引用空态按 status 区分）；`KnowledgeResearcherDrawer.tsx:75-77` | 停止→“回答在生成中停止；引用只覆盖已完成句子”，不再说“模型没给引用”；旧记录无 steps/toolActivity→“没有记录（旧回答可能未记录），页面不会虚构”；撤权（readability=forbidden）历史卡禁用并显示 unavailableReason，禁止打开空白问答；研究员面板引用空态按 status 区分。 |
| P03-08 | P2 | 已修复 | `KnowledgeConversationEntry.tsx:24-33`（统一共享状态标签 + 状态色/图标）；`KnowledgeHistoryPage.tsx:125-135`（历史页共享标签，needs_answer 用设计原文“需要你回答”） | 研究中/撰写中/等待答复/正在停止/已停止/已完成/失败/结果待核对全部走 `KNOWLEDGE_RUN_STATUS_LABEL`，不再手写多套词；进度卡不再把 failed/stopped 显示为研究中。 |
| P03-09 | P2 | 部分 | `KnowledgeResearcherDrawer.tsx:28-77`（中性形象/“本条回答投递时”/回答于·停止于/核对结论/外观缺失中性文案） | 已修复：missing appearance 使用中性头像（“中”）+“本条消息未冻结职业外观，保持中性形象，不套用当前设置”，不再断言“该职业未配置外观”；补“角色证据 · 本条回答投递时”和回答/停止时间前缀与核对结论。**残余（C1）**：契约 `KnowledgeRoleEvidence` 无“外观缺失原因”字段，无法严格区分“未冻结”vs“职业未配置”，只能给中性表述。 |
| P03-10 | P3 | 部分 | `KnowledgeResearcherDrawer.tsx:50-68`（三行读取骨架、版本不一致横幅显示修订号 + “重新读取会话”） | 已修复：读取中骨架、版本不一致时展示会话/消息修订号与重新读取按钮。**残余（C1）**：服务端结果 GET 不会返回 409（`engine/knowledge.ts` 只抛 NOT_FOUND/CAPABILITY_UNAVAILABLE/REVOKED），`rs-changed` 独立分支仍静态不可达；需服务端补版本冲突语义后才能真正可达。 |
| P03-11 | P3 | 已修复 | `ResearchTimeline.tsx:89-103`（删除内部枚举/“非流式”说明与“完成后时间线”徽标）；`research-timeline.css`（删除对应死样式） | 面向用户只保留真实步骤中文名/状态/耗时；无步骤时说明旧记录可能未记录，不再暴露 retrieve/model/tool/validate 枚举或“本轮非流式”的矛盾口径。 |
| P03-12 | P3 | 已修复 | `KnowledgePage.tsx:610-620`（textarea Enter 提交 / Shift+Enter 换行 + isComposing 保护）；`:650-656`（提示“Enter 发送 · Shift Enter 换行”） | 与设计 `knowledge.html:142,145` 一致。 |
| P03-13 | P3 | 已修复 | `KnowledgePage.tsx:790-810`（示例问题点击直接提问；不可发送时回退为填入并显示“填入”徽标） | 区块标题改为“可以这样问（选择后直接提问）”；不可发送（未选项目/无来源/待核对）时保留填入降级并在徽标说明。 |
| P03-14 | P3 | 部分 | `KnowledgePage.tsx:1020-1060`（面板标题“引用来源 · n / 总数”、上一处/下一处首尾循环）；`:175-210`（引用正文仍按行显示） | 已修复计数与循环切换；**残余（C1）**：服务引用粒度为 path+line（`validateCitations`），设计文档面板按段落“第 N 段 · 引用位置”，段落语义需契约/服务补段落号，本轮不做。 |
| P03-15 | P3 | 部分 | `KnowledgePage.tsx:840-900`（保留“问答历史”卡但 forbidden 条目禁用+原因） | 设计外产品扩展（设计仅页头“历史对话”入口）保留（C9 需设计确认）；已补齐 readability 降级，不再出现不可解释空白。是否收敛为“最近几条+查看全部”/删除待设计裁决。 |
| P03-16 | P3 | 部分 | `KnowledgePage.tsx:536-600`、`KnowledgeConversationEntry.tsx:190-205,300-320`（三处研究员触发按钮补 `aria-expanded` + `aria-haspopup="dialog"`） | 已修复展开态语义；**残余**：`aria-controls` 需要 Drawer 组件支持自定义 id（组件不在本任务写范围），未加。 |
| P03-17 | P3 | 部分 | `knowledge.css:9-17`（改用 `var(--drawer-lg)` + `transition`） | 已修复宽度字面量 520px 与“从右侧推入”过渡；断点仍为 1200（与外壳断点不同源，需 GUI/设计确认断点语义后统一）。 |
| P04-01 | P2 | 已修复 | `contracts.ts:528-534`（历史条目 `pendingQuestion/progressSummary`）；`engine/knowledge.ts:485-501`（由真实 RuntimeInteraction 与 progress.steps 组装）；`KnowledgeHistoryPage.tsx:138-152`（摘要列使用真实待回答问题/当前步骤） | need 行摘要=“研究员需要你确认：<真实问题标题>”（来自原生 question），running 行摘要=真实当前步骤（如“正在读取资料 · 读取 2/5 份资料”）；缺失时写明“需去待处理中心查看”，不再留空。 |
| P04-02 | P2 | 已修复 | `KnowledgeHistoryPage.tsx:125-135,157-159`（状态→tone/icon 完整映射：完成后 ok/check、need wait/help、进行中 run/search|sparkle、停止 idle/stop、失败 fail/x、未知 unknown/help） | 进行中/失败在列表中醒目可辨；与设计 `knowledge-history.html:55` 的语义一致（need 用 warn 系，与审计建议一致）。 |
| P04-03 | P2 | 已修复 | `KnowledgeHistoryPage.tsx:138-165`（need 行 warn 高亮/左条/行内主操作“去回答”）；`knowledge-history.css:56-85`（`.kh-item[data-need]`、`.kh-need-action`） | 恢复设计 `.conv.need` 的 warn 底色与左 warn 条；“去回答”改为行右侧 primary 主操作；删除“有无引用”决定的左色条（设计无此语义）。 |
| P04-04 | P3 | 部分 | `KnowledgeHistoryPage.tsx:162-170`、`knowledge-history.css:141-155`（次要操作 hover/focus/展开时显示） | 已降噪：展开/归档/重命名等不再常显（hover/focus-within 出现，键盘可达）。**残余（C4/C9）**：设计的“更多”菜单收纳与设计外“展开详情”区仍保留，属产品扩展，需设计确认是否移除。 |
| P04-05 | P3 | 已修复 | `KnowledgeHistoryPage.tsx:63-73`（更早仅日期）；`:330-340`（4 行骨架）；`:157-160`（零引用不显示）；`:348-365`（全部项目读取失败时整页“记录加载失败”banner） | 骨架 4 行、更早条目只显示日期、零引用隐藏、全失败整页 banner+重试；部分项目失败仍按分片 notice+事实说明。 |

## 2. 契约/服务变更（供 Lead 复核 docs:api / check:docs-routes）

- `packages/shared/src/api/contracts.ts`（knowledge 段，均为可选字段/新类型，向后兼容）：
  - 新增 `KnowledgeProgressSource`；`KnowledgeRunProgress` 增加 `steps?`、`toolActivity?`、`sourceCards?`；
  - `KnowledgeCitation` 增加 `index?`（1-based，与 answer 的 `[n]` 标记一致）；
  - `KnowledgeHistoryEntry` 增加 `pendingQuestion?`、`progressSummary?`；`KnowledgeAskResponse.answer` 注释说明 `[n]` 标记约定。
- `packages/server/src/knowledge.ts:79` 新增导出 `classifyKnowledgeSourcePath()`（复用同一扩展名集合，供增量来源卡分类）。
- `packages/engine/src/knowledge-inputs.ts` `collect()` 增加可选 `onDocument` 回调；快照 documents 增加可选 `kind`。
- `packages/engine/src/knowledge.ts`：progress 增量 step/sourceCard 落盘；完成后 progress 只保留真实 steps/toolActivity（丢弃运行占位 step）；answer 引用标记清洗；history 运行/待答复条目组装真实摘要。
- **未新增 HTTP 端点、未改 `docs/api.md`**（按任务约束交 Lead 统一重生成）。
- 未改 `enums.ts`（沿用既有 `KNOWLEDGE_RUN_STATUS_LABEL`）；`enums.ts` 当前改动来自其他成员。

## 3. 验证

| 验证 | 结果 |
|---|---|
| `npm run typecheck`（全仓） | **通过，0 错误**（收尾时全仓检查；本任务改动文件含 knowledge/**、engine/knowledge*、server/knowledge、contracts 均无错误） |
| `node --import tsx --test packages/engine/src/knowledge-stream.test.ts tests/integration/knowledge-steps.test.ts` | **14/14 通过**（含“真实 steps/toolActivity 进结果与历史”“无 timings 不伪造 model step”“停止/UNKNOWN/重放/撤权”回归） |
| `npm run build:web` | **通过**（vite 构建成功，新增组件/CSS 打包无错误） |
| 设计稿只读 | 未修改 `opencode-workflow-design-showcase/**` |
| 真实模型验收 | 未执行（无真实 OpenCode 模型调用）；P03-02 `[n]` 标注质量需一次真实问答验证 |

## 4. 需 GUI / 真实服务/模型验证（不作为“已通过”）

1. 运行中增量来源卡随轮询出现的观感（700ms 轮询下逐步出现；本地 collect 很快时可能一次性出现）、流式回答 caret、长回答滚动。
2. 完成/停止后研究过程收起的一行摘要布局与展开详情（四主题 × 1440/1280/1024）。
3. 引用上标点击→右侧 520 面板定位→上一处/下一处首尾循环；窄屏 Modal；面板与回答联动视觉。
4. 停止失败/未知、会话 UNKNOWN 的核对横幅在真实故障注入下的行为（只核对不重发）。
5. B-08 研究员面板：骨架、版本不一致、中性形象、核对结论文案在真实历史角色数据下的呈现。
6. 历史页 need 行的 warn 高亮/右上行内“去回答”、hover 操作显示、更早日期格式。

## 5. 本轮改动文件

`apps/web/src/pages/knowledge/{KnowledgePage,KnowledgeConversationEntry(新增),KnowledgeResearcherDrawer,ResearchTimeline,useKnowledgeAsk}.tsx`、`apps/web/src/pages/knowledge/{knowledge.css,knowledge-conversation.css(新增),research-timeline.css}`、`apps/web/src/pages/knowledge-history/{KnowledgeHistoryPage.tsx,knowledge-history.css}`、`packages/engine/src/{knowledge.ts,knowledge-inputs.ts}`、`packages/server/src/knowledge.ts`、`packages/shared/src/api/contracts.ts`（knowledge 段）、本文件。
