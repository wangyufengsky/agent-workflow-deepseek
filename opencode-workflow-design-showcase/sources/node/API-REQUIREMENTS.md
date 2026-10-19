# opencode-workflow · 节点执行详情 · 同版 API 需求草案

> **版本标签：设计同版 2026-10-12 · 对应原型 prototype/index.html**
> 对应工作单：`01-CLAUDE-BRIEF.md`、`02-API-NEEDS.md`、`03-REFERENCES.md`（node-execution-detail-20261011-175219-utc）；设计规格 `NODE-SPEC.md`。状态 id（`n01-default` … `n20-reduced`）与原型 `?state=` 参数一致。

## 0. 范围与非保证声明

**范围**：任务页大画布中，点击业务节点后的右侧详情（概览 / 执行现场 / 尝试与产出）、工具调用详情、单次 attempt 详情、历史只读模式、宽阅读区（产物 / 引用 / 工具详情展开）、下载，以及断连、补读、未知、撤权等状态所需的数据。不涉及设置、知识问答、其他页面，也不涉及恢复、重跑、推进、验收等执行命令的新增或改动。

**非保证声明**

1. 本文是给 C 与后端/领域 owner 冻结用的**需求草案**，不是已批准的契约，也不代表已安装 handler、producer 或宿主能力。本次不修改 `shared/contracts`。
2. **事实来源边界**：撰写者无权访问生产源码。文中「现有」仅指 `02-API-NEEDS.md` 与 `03-REFERENCES.md` 明文记载的能力和限制，未逐行核对实现，也没有运行 GUI 或模型。凡未在这两份文件中出现的，一律视为「未知」或「候选」。
3. 所有新操作名、字段名、取值和行为都带 **「候选，待 C/后端冻结」** 标记。C 可以改名、并入现有同版操作或拒绝，Claude 不另建协议。候选只包括**只读 / 订阅投影**和一项**宿主下载能力**，不新增状态机、command 或 hash 协议。
4. 原型中任何成功画面（流式正文、补读完成、下载成功、验收通过）都是 `fixtures.js` 中的虚构样例，只证明设计成立，**不证明工程已接通、模型已验证或流程已验收**。原型不连 `window.workflowDesktop`、IPC、DB、网络或模型。

**标记约定**

| 标记 | 含义 |
| --- | --- |
| 现有 | 02/03 明文记载的现有出口，限制同样以其记载为准 |
| 「候选，待 C/后端冻结」 | 设计需要、尚未存在或尚未确认的名称、字段、行为 |
| 未知 | 02/03 没有说明，需 C 确认（见 §6） |
| 仅客户端 | 纯前端行为，不需要 API |

---

## 1. 现有能力 vs 候选能力

### 1.1 现有能力（仅按 02/03 记载）

| 现有出口 | 当前提供 | 真实限制（不能据此宣称） |
| --- | --- | --- |
| `execution.read` → ExecutionSnapshot | 执行与节点的当前状态；服务是状态机权威 | 不含逐字模型正文和全部工具日志；是否区分「取消请求中 / 已确认取消」未知 |
| `node.evidence` → TaskViewResource（path = executionId/nodeId） | **当前** AttemptResult、输入、验收、MCP 结算投影；选中证据须与 project / execution / node / currentAttemptId / 定义修订 / 代次 / 快照匹配 | 不能切换历史 attempt；不含完整对话和工具参数正文；历史读口不得直接塞入「当前证据」 |
| AttemptResult | `payload` 是持久化的结构化提交结果；`artifacts` / `verification` / `errors` / `warnings` 是实际记录 | `payload` ≠ 模型流式消息，不能从中推出公开 reasoning；是否有独立「结果版本」字段未知 |
| `mcp.settled`（durable） | 工具名 / 修订、成功或失败、`inputHash`、部分 `outputRefs`、审计 | `inputHash` 不是可读参数；`outputRefs` 不是完整回包；不保证覆盖上游 OpenCode 的全部工具和运行中事件；只有结算时刻，无可靠开始时间 |
| AcceptanceRecord / `acceptance.decision.preview` | `node.evidence` 内的当前验收；人工决定使用真实资源 revision 和政策 scope | 不能挂到别的历史结果上；历史阅读不新增决定权限；现有字段是「政策 scope」，是否有「策略版本」未知 |
| DesktopBridge `subscribeEvents` / `onEvent` / `unsubscribeEvents` | 业务事件；执行事件触发权威快照重读 | 前端未消费模型 text / reasoning delta；「事件已连接」≠ 正文流已接通；无 seq / cursor / 重播语义的记载 |
| `operations.by-key` | 原 commandId = requestKey，同版 body hash 绑定，用于核对回执 | 读到相同值不能清除「未明」；不能跨 project / attempt 搬运原命令 |
| ArtifactRef / SourceRef | ArtifactRef 含 `id` / `revision` / `sha256` / `mediaType` / `sourceAttemptId` / `evidence`；SourceRef 对应来源快照和定位 | 显示路径、引用和摘要都不是文件读取或下载权限；无正文读口和导出能力 |

### 1.2 候选能力（全部「候选，待 C/后端冻结」）

| 候选能力 | 类型 | 请求选择（项目来自可信 session，不在参数中） | 最小返回 | 边界 |
| --- | --- | --- | --- | --- |
| `node.attempts.list`「候选，待 C/后端冻结」 | 读 | executionId, nodeId, cursor?, limit? | `AttemptSummary[]`, nextCursor?, retention | ID 不是授权；未保留范围要显式 |
| `node.attempt.read`「候选，待 C/后端冻结」 | 读 | executionId, nodeId, attemptId | `AttemptDetail`（结果 / 错误 / 产物 / 对应验收） | 校验 attempt→node→execution→project；不返回 command 能力 |
| `node.output.read`「候选，待 C/后端冻结」 | 读（分页 / 补读） | attemptId, cursor? 或 afterSeq?, limit | `OutputFragment[]`, cursor, gaps, stream, capabilities | 正文 / 公开摘要 / 工具活动 / 服务事件分类；流终结 ≠ 成功 |
| 正文事件扩展 `node.output.appended`「候选，待 C/后端冻结」 | 订阅 | 沿用现有订阅通道或独立流（§6 第 8 项） | 单个 `OutputFragment` + 身份绑定 | 只投影，不改变现有业务事件语义 |
| `node.tool.read`「候选，待 C/后端冻结」 | 读（分段） | attemptId, callId, part = params / result, cursor? | `ToolCallDetail` | 不能按工具名定位；无重放 / 执行入口 |
| `artifact.read`（精确版本）「候选，待 C/后端冻结」 | 读（分段） | ArtifactRef 的 id + revision | `ReadableContent` | 只读该精确 revision，不用最新版顶替 |
| `source.read`（精确版本）「候选，待 C/后端冻结」 | 读 | SourceRef（快照 + 定位） | `ReadableContent`（全文 / 节选 / 摘要） | 无原文时不给行号 |
| `artifact.export`（宿主下载）「候选，待 C/后端冻结」 | 宿主能力（Desktop IPC） | 精确 ArtifactRef（id + revision） | saved / cancelled / failed / unsupported | 保存位置由宿主对话框决定；renderer 不传路径或 URL |

### 1.3 候选数据结构（字段级，全部「候选，待 C/后端冻结」）

类型记法：`T?` 表示可缺省，缺省时 UI 显示「未知」而不编造。所有 `*Id` / `*Revision` 均为服务给出的不透明字符串，客户端只比较是否相等，不解析、不计算。

**Binding（每个响应和事件都携带）「候选，待 C/后端冻结」**

| 字段 | 类型 | 含义 |
| --- | --- | --- |
| projectId | string | 服务按可信 session 固定，回显给客户端，用于丢弃晚回 |
| executionId / nodeId | string | 所属执行与节点 |
| attemptId | string | 所属 attempt；列表级响应可缺省 |
| definitionRevision | string | 节点定义修订（与现有「定义修订」同源） |
| executionGeneration | string | 执行代次（与现有「代次」同源） |
| resourceRevision | string? | 本次所读资源的 revision（结果 / 输出 / 调用 / 产物） |

**AttemptSummary「候选，待 C/后端冻结」**

| 字段 | 类型 | 含义 |
| --- | --- | --- |
| attemptId | string | 稳定身份 |
| ordinal | int | 「尝试 #n」，服务给出，不由前端计数 |
| isCurrent | bool | 是否为当前 attempt（与 ExecutionSnapshot 一致） |
| status | 现有枚举 | 直接取服务现有 attempt 状态，不新增取值 |
| startedAt / endedAt | ISO8601? | 服务记录时间 |
| reasonSummary | string? | 服务端已脱敏的一行原因 |
| readability | `{output, tools, result}` → 可用性码 | 每类内容是否可读（§5 的码） |

**AttemptDetail「候选，待 C/后端冻结」**

| 字段 | 类型 | 含义 |
| --- | --- | --- |
| binding | Binding | 同上 |
| result | `{resultRevision, submittedAt?, payloadPreview, validity, supersededBy?}` 或 null | 结构化结果预览（已脱敏）；`validity` ∈ current / superseded / invalidated，`supersededBy` = {attemptId, resultRevision} |
| resultAbsentReason | `NOT_SUBMITTED` / `NOT_RETAINED`? | 没有结果时的原因 |
| acceptance | `{subjectResultRevision, policyRevision, status, decidedAt?}` 或 null | 绑定**结果版本 + 策略版本**；`status` 沿用 AcceptanceRecord 现有取值 |
| acceptanceAbsentReason | `NOT_ENTERED` / `NOT_RETAINED`? | 「这次尝试未进入验收」 |
| artifacts | ArtifactRef[]（现有类型） | 仅属于本 attempt |
| errors / warnings | 现有结构 | 本 attempt 的实际记录 |

**OutputFragment「候选，待 C/后端冻结」**

| 字段 | 类型 | 含义 |
| --- | --- | --- |
| fragmentId | string | 稳定片段 id，用于去重 |
| seq | int | 同一 attempt 输出流内单调递增，可有空洞 |
| category | `model_text` / `public_reasoning_summary` / `tool_activity` / `service_event` | 内容类别，UI 据此分块，不靠文本推断 |
| recordedAt | ISO8601? | 服务记录时间；缺省时显示「时间未知」 |
| format | `markdown` / `text` | 仅对 model_text / summary 生效 |
| text | string? | 追加片段（已脱敏） |
| blockId | string? | 片段所属逻辑块，同一块的片段按 seq 拼接 |
| toolCallRef | `{callId, status, source}`? | tool_activity 时引用调用；后到状态以新片段更新原卡 |
| citations | `{marker, sourceRef}[]`? | 结构化引用，正文中的 [1] 只能来自这里，不解析模型文本 |
| eventKind | string? | service_event 的种类（结果已提交、取消请求等），仅投影现有事实 |
| redactions | `{path, kind}[]`? | 已脱敏标记 |

**Stream / Gap / Cursor「候选，待 C/后端冻结」**

| 字段 | 类型 | 含义 |
| --- | --- | --- |
| cursor.next | opaque string | 下一页 / 补读起点，只由服务签发 |
| cursor.expiresAt | ISO8601? | 保留期限；过期返回 `CURSOR_EXPIRED` |
| stream.terminal | bool | 输出**传输**是否结束；不代表 attempt 成功 |
| stream.awaitingTool | bool? | producer 能证实模型在等待工具时才为 true |
| gaps[] | `{fromSeq, toSeq, fromTime?, toTime?, reason}` | 不可补读的区间；reason ∈ NOT_RETAINED / CAPTURE_UNAVAILABLE |
| capabilities.modelText | 可用性码 | 正文是否可读 / 可持久读取 |
| capabilities.publicReasoningSummary | `provided` / `none_in_attempt` / `unsupported` / `not_allowed` | 上游是否公开、是否允许展示 |
| capabilities.toolSources | (`managed_mcp` / `opencode`)[] | 本流覆盖的工具记录来源 |

**ToolCallDetail / ContentSection「候选，待 C/后端冻结」**

| 字段 | 类型 | 含义 |
| --- | --- | --- |
| callId | string | 唯一调用身份 |
| toolName / toolRevision | string / string? | 工具名、修订（MCP 现有） |
| source | `managed_mcp` / `opencode` | 记录来源，决定 UI 来源标签 |
| status | queued / running / succeeded / failed / cancelled / unknown | 按来源事实投影，不由前端推断 |
| startedAt / endedAt | ISO8601? | 两者都有才显示时长 |
| inputHash / outputRefs | 现有 | 原样展示，不当作参数或回包 |
| params / result / error | ContentSection | 分区内容 |
| ContentSection.format | json / text / command_output / code / unsupported | 选择查看器 |
| ContentSection.mediaType / sizeBytes / totalLines | string / int? / int? | 区头信息 |
| ContentSection.range | `{fromLine, toLine}` 或 `{fromByte, toByte}` | 已加载范围 |
| ContentSection.nextCursor | opaque? | 「继续读取」入口；无则不显示 |
| ContentSection.truncation | `{reason: RETENTION_LIMIT / READ_LIMIT, retainedBytes?}`? | 服务侧截断事实 |
| ContentSection.exitCode | int? | 命令输出的退出码 |
| ContentSection.redactions | `{path, kind}[]` | 值位置以 `{"$redacted": kind}` 标记出现 |

**ReadableContent（产物 / 来源）「候选，待 C/后端冻结」**

| 字段 | 类型 | 含义 |
| --- | --- | --- |
| ref | ArtifactRef / SourceRef（现有） | 精确对象 |
| revision / sha256 / mediaType | 现有字段 | 头部显示 |
| provenance | `{nodeId, attemptId, callId?}` | 「尝试 #3 · 工具调用 #c-7f3a」 |
| contentKind | `full` / `excerpt` / `summary` / `none` | 节选 / 摘要必须显著标注 |
| body / range / nextCursor | string / 行范围 / opaque? | 已加载正文 |
| anchor | `{startLine, endLine}`? | 只有 full 或带真实行号的 excerpt 才给出 |
| latestRevision | string? | 有更新版本时提示，引用仍指向原 revision |
| exportable | `{allowed: bool, reason?}` | 下载按钮是否可用及原因 |

---

## 2. 逐屏需求

各屏统一使用 7 项：已有数据 / 候选数据 / 生产与持久化 / 身份与版本绑定 / 异常状态 / 事件与历史范围 / 原型状态。

**通用晚回规则**：客户端为当前视图维护 `viewKey = projectId + executionId + nodeId + attemptId + 资源 id + 本地请求序号`。响应的 Binding 与当前 viewKey 不一致时直接丢弃，不渲染、不缓存为当前内容（n19-late）。服务端发现 attempt 不属于 node、node 不属于 execution 或代次不符时，返回 `STALE_TARGET`，不返回内容。

### 2.1 画布与详情面板开 / 关

| 项 | 内容 |
| --- | --- |
| 已有数据 | `execution.read`（节点状态）；点节点走 `node.evidence`（03：FlowCanvas.tsx:95、MainlinePage.tsx:148） |
| 候选数据 | 无。开关、选中、视口为**仅客户端** |
| 生产 / 持久化 | 服务快照（现有） |
| 身份绑定 | 面板请求带 executionId/nodeId，项目来自 session；切节点按通用晚回规则丢弃旧响应 |
| 异常状态 | 节点快照读取失败 `READ_FAILED`；无权 `FORBIDDEN`；开始 / 结束系统节点不开面板 |
| 事件 / 历史 | 业务事件触发快照重读（现有），重读不得重建画布或重置视口 |
| 原型状态 | n01-default, n01-open, n01-closed, n20-keyboard |

### 2.2 执行现场：事实条（facet row）

| 项 | 内容 |
| --- | --- |
| 已有数据 | 尝试状态：ExecutionSnapshot；结果与验收：AttemptResult + AcceptanceRecord（`node.evidence`）；回执未知：`operations.by-key` |
| 候选数据 | 「候选，待 C/后端冻结」正文：`stream.terminal`、`stream.awaitingTool`、是否已有 model_text 片段；工具：本 attempt 调用的 `status` 汇总（来自 `tool_activity`） |
| 生产 / 持久化 | 连接 = 客户端订阅状态（仅客户端）；正文 / 工具 = 输出 producer（未知，§6 第 1、3 项）；尝试 / 结果 / 验收 = 服务现有持久化 |
| 身份绑定 | 五格都必须属于同一 Binding（同 attempt），不能混用当前快照和历史 attempt |
| 异常状态 | 任一格无数据显示「未知」虚线样式，`CAPABILITY_UNAVAILABLE` 时写「当前服务未提供」 |
| 事件 / 历史 | 各格独立更新，不合成为新的综合状态机；历史模式下五格冻结为该 attempt 的记录值 |
| 原型状态 | n02-empty, n03-stream, n04-wait-tool, n06-ended-unsubmitted, n08-cancelling, n08-cancelled, n08-cancel-unknown, n09-receipt-unknown, n10-disconnected, n10-reconnecting, n10-backfilling, n10-backfilled, n10-gap |

### 2.3 记录流（正文 / 公开推理摘要 / 工具卡 / 服务事件）

| 项 | 内容 |
| --- | --- |
| 已有数据 | 无正文。工具卡只有 `mcp.settled` 摘要（工具名、成败、部分 outputRefs）；服务事件可由快照变化投影 |
| 候选数据 | 「候选，待 C/后端冻结」`node.output.read` → OutputFragment[]（category、seq、fragmentId、blockId、text、format、recordedAt、toolCallRef、citations、redactions）；capabilities.publicReasoningSummary |
| 生产 / 持久化 | 模型正文：OpenCode session（未知是否持久化，§6 第 1 项）；公开摘要：provider（§6 第 2 项）；工具活动：managed MCP（现有持久化）+ OpenCode（未知，§6 第 3 项） |
| 身份绑定 | fragment → attempt → node → execution → project；工具卡以 callId 定位，同名工具多次调用为多张卡；晚到的工具状态更新原 callId 卡，不改变位置 |
| 异常状态 | 尚无正文 = 空态，不是错误（n02-empty）；首读中为骨架（n02-loading）；`CAPABILITY_UNAVAILABLE` 写「当前服务未提供模型正文」；`NOT_RETAINED` 画缺口条；`READ_FAILED` 保留已加载内容并标读取时间；失败 attempt 的部分正文照常可读（n07） |
| 事件 / 历史 | 当前 attempt 订阅追加；历史 attempt 只分页读，不订阅；无公开摘要时不渲染占位，只在「关于此记录」写一句 |
| 原型状态 | n02-loading, n02-empty, n03-stream, n04-wait-tool, n04-tool-running, n04-tool-done, n05-reasoning, n05-no-reasoning, n07-failed-partial, n13-tool-twice |

### 2.4 跟随 / 滚动（仅客户端，无 API）

| 项 | 内容 |
| --- | --- |
| 已有 / 候选数据 | 不需要。依赖候选 seq 只为计算「有 N 条新内容」 |
| 规则 | 跟随开且在底部才自动滚动；离底超过 80px 自动暂停；手动关闭后永不自动滚动；展开、复制、打开工具或引用时不滚动 |
| 保存范围 | 同一面板内存，key = 节点 + attempt；刷新后不恢复（原型不写 storage，生产是否持久由前端决定，不涉及 API） |
| 原型状态 | n12-follow-on, n12-follow-off, n12-scrolled-new, n20-reduced |

### 2.5 工具调用详情

| 项 | 内容 |
| --- | --- |
| 已有数据 | `mcp.settled`：toolName / 修订、成功或失败、inputHash、部分 outputRefs、审计（仅受管 MCP） |
| 候选数据 | 「候选，待 C/后端冻结」`node.tool.read` → ToolCallDetail（callId、source、status、startedAt/endedAt、params / result / error 的 ContentSection：format、mediaType、sizeBytes、range、nextCursor、truncation、redactions、exitCode） |
| 生产 / 持久化 | 受管 MCP：结算记录已持久化，但参数和回包正文是否保留**未知**；OpenCode 工具：producer 和持久化均未知 |
| 身份绑定 | (attemptId, callId) 唯一；不接受按 toolName 查询；结果引用携带精确 ArtifactRef / SourceRef revision |
| 异常状态 | 空结果为中性（n13-tool-empty）；`TRUNCATED` 显著横幅，有 nextCursor 才给「继续读取」（n14-truncated）；`FORBIDDEN` 整区上锁、保留摘要层（n14-no-permission）；`CAPABILITY_UNAVAILABLE`（n14-no-capability）；`UNSUPPORTED_FORMAT`；`READ_FAILED` 保留已加载内容（n13-tool-failed 中的读取失败分支） |
| 事件 / 历史 | 运行中调用的状态变化经 tool_activity 片段推送；详情本身按需读取，不订阅正文；历史 attempt 的调用同样可读（受保留期限制） |
| 原型状态 | n13-tool-text, n13-tool-json, n13-tool-code, n13-tool-empty, n13-tool-failed, n13-tool-twice, n14-redacted, n14-no-permission, n14-no-capability, n14-truncated |

注：n13-tool-failed 表示**工具执行失败**（error 区有内容），与「详情读取失败」（`READ_FAILED`）是两件事，UI 分开表达。

### 2.6 尝试列表

| 项 | 内容 |
| --- | --- |
| 已有数据 | `node.evidence` 只有 currentAttemptId 及其结果；原稿列表样例无真实数据源 |
| 候选数据 | 「候选，待 C/后端冻结」`node.attempts.list` → AttemptSummary[]（attemptId、ordinal、isCurrent、status、startedAt/endedAt、definitionRevision、executionGeneration、reasonSummary、readability）、nextCursor、retention |
| 生产 / 持久化 | 服务 DB 中的 attempt 记录（attempt 历史是否全量保留未知，§6 第 6 项） |
| 身份绑定 | execution + node 作用域；isCurrent 必须与同一快照的 currentAttemptId 一致，否则以快照为准并重读 |
| 异常状态 | 「加载更早的尝试」失败 → 保留已加载项 + 重试（n18-page-fail）；`NOT_RETAINED` →「更早的尝试记录未保留」（n18-not-retained，「最近 20 次」只是样例数字） |
| 事件 / 历史 | 新 attempt 产生（现有执行事件）时重读第一页 |
| 原型状态 | n17-list, n18-not-retained, n18-page-fail |

### 2.7 单次 attempt 详情

| 项 | 内容 |
| --- | --- |
| 已有数据 | 仅当前 attempt：AttemptResult（payload / artifacts / verification / errors / warnings）+ AcceptanceRecord |
| 候选数据 | 「候选，待 C/后端冻结」`node.attempt.read` → AttemptDetail（result.resultRevision、validity、supersededBy、acceptance.subjectResultRevision、acceptance.policyRevision、resultAbsentReason、acceptanceAbsentReason、artifacts、errors / warnings） |
| 生产 / 持久化 | 结果与验收为服务持久化记录；「结果版本」「策略版本」是否作为独立字段存在未知（§6 第 6、7 项） |
| 身份绑定 | 验收必须满足 `acceptance.subjectResultRevision == result.resultRevision`，并给出 policyRevision；不一致时不显示该验收。历史失败的 attempt 永不显示当前的通过徽标 |
| 异常状态 | 无结果 →「这次尝试没有提交结果」；未进入验收 → 空态；结果被替代 → `VERSION_SUPERSEDED` 标「已被尝试 #n 的结果替代」；`NOT_RETAINED`；`FORBIDDEN` |
| 事件 / 历史 | 当前 attempt 的详情随快照重读；历史 attempt 为固定记录，不订阅 |
| 原型状态 | n17-history, n06-pending-accept, n11-done, n11-accept-rejected, n11-manual-accept |

### 2.8 历史模式 / 回到当前

| 项 | 内容 |
| --- | --- |
| 已有数据 | 无历史读口；当前证据须与 currentAttemptId 匹配（现有） |
| 候选数据 | 「候选，待 C/后端冻结」上述 attempt / output / tool 读口，均带 attemptId；当前 attempt 有新片段时的事件（用于「当前尝试有新内容」小点） |
| 生产 / 持久化 | 同 2.3、2.7 |
| 身份绑定 | 历史投影与「当前证据」严格分开：历史响应不得写入当前证据缓存。回到当前时以最新快照的 currentAttemptId 重新读取 |
| 异常状态 | 回到当前但数据未补齐 → 加载或未知，不用历史内容顶替（n17-back-current） |
| 权限 | 历史模式不展示 footer 执行动作；浏览历史不发送任何 command；回到当前后的动作仍按当前服务状态和授权 |
| 原型状态 | n17-history, n17-history-session, n17-back-current |

### 2.9 宽阅读区：产物与引用

| 项 | 内容 |
| --- | --- |
| 已有数据 | ArtifactRef（id / revision / sha256 / mediaType / sourceAttemptId / evidence），SourceRef（快照 / 定位）；无正文读口 |
| 候选数据 | 「候选，待 C/后端冻结」`artifact.read` / `source.read` → ReadableContent（contentKind、body、range、nextCursor、anchor、latestRevision、provenance、exportable） |
| 生产 / 持久化 | 产物存储与格式范围未知（§6 第 5 项）；来源快照是否保留原文未知 |
| 身份绑定 | 精确到 id + revision（产物）或快照 + 定位（来源）；引用打开指定 revision，不跳到最新文件；有 `latestRevision` 时只旁注，不替换 |
| 异常状态 | 版本失效 `VERSION_SUPERSEDED`；不存在 `NOT_FOUND`；无权 `FORBIDDEN`；正文尚未提供 `NOT_RETAINED` / 空态；`UNSUPPORTED_FORMAT`；`READ_FAILED`；只有节选或摘要时显著标注，摘要不画行号 |
| 事件 / 历史 | 按需分段读；页面内搜索只针对已加载内容，写明「在已加载内容中查找」 |
| 原型状态 | n15-art-text, n15-art-json, n15-art-code, n15-art-unsupported, n15-art-missing, n16-cite-source, n16-cite-code, n16-cite-excerpt, n20-reader |

### 2.10 下载

| 项 | 内容 |
| --- | --- |
| 已有数据 | 无。显示路径不是读取或下载权限 |
| 候选数据 | 「候选，待 C/后端冻结」ReadableContent.exportable；宿主 `artifact.export`（精确 ref → saved / cancelled / failed / unsupported） |
| 生产 / 持久化 | 服务负责读取，Desktop 宿主负责保存对话框和写盘；最小 IPC 由 C/Desktop 定义（§6 第 5 项） |
| 身份绑定 | 只能导出精确 id + revision；导出内容与展示使用同一脱敏范围 |
| 异常状态 | 能力未接 → 按钮禁用并写原因；`FORBIDDEN`；`UNSUPPORTED_FORMAT`；失败可重试；下载或阅读失败不改变执行状态 |
| 原型状态 | n15-download（成功为模拟，未保存任何文件）, n15-art-unsupported |

### 2.11 取消 / 回执未知

| 项 | 内容 |
| --- | --- |
| 已有数据 | 停止 / 取消沿现有 command 和回执规则；`operations.by-key` 核对原 commandId = requestKey；ExecutionSnapshot 给出 attempt 状态 |
| 候选数据 | 无新 command。「候选，待 C/后端冻结」：快照能否区分「已请求取消」「已确认停止」「取消结果未知」——若不能，UI 只能显示「已发出取消请求」+「未知」 |
| 生产 / 持久化 | 服务状态机（现有）；回执记录（现有） |
| 身份绑定 | 核对只用原 requestKey 和原 project / attempt；读到相同值不清除「未明」 |
| 异常状态 | 取消请求 ≠ 已停止；回执未知时保持原记录，按钮为「核对原操作」，不提供重发或一键重试 |
| 原型状态 | n08-cancelling, n08-cancelled, n08-cancel-unknown, n09-receipt-unknown |

### 2.12 断连 / 重连 / 补读 / 缺口

| 项 | 内容 |
| --- | --- |
| 已有数据 | 订阅通道连接状态（客户端可知）；断线后快照重读（现有） |
| 候选数据 | 「候选，待 C/后端冻结」cursor.next / expiresAt、gaps[]、fragmentId 去重、seq |
| 生产 / 持久化 | 补读能力依赖输出是否持久化以及保留期（未知）；无持久化时只能画缺口 |
| 身份绑定 | 补读只针对断线前的同一 attempt；断线期间若 currentAttemptId 改变，先重读快照，再按新 attempt 读取 |
| 异常状态 | 断线时旧内容标「过时 · 截至 hh:mm:ss」；`CURSOR_EXPIRED` → 从头首读，无法补的部分画缺口；补读完成才去掉过时标记；「数据连接已恢复」与「模型仍在执行」分两句写 |
| 原型状态 | n10-disconnected, n10-reconnecting, n10-backfilling, n10-backfilled, n10-gap |

### 2.13 晚回 / 撤权 / 项目切换

| 项 | 内容 |
| --- | --- |
| 已有数据 | 当前证据匹配规则（project / execution / node / attempt / 修订 / 代次） |
| 候选数据 | 「候选，待 C/后端冻结」所有响应和事件带 Binding；撤权时读口返回 `REVOKED`（或订阅收到撤权事件，§6 第 8 项） |
| 身份绑定 | 按通用晚回规则丢弃；项目切换时取消全部订阅，清空内存缓存 |
| 异常状态 | 晚回：新节点显示加载态 + 「已忽略属于上一个节点的晚到内容」；`REVOKED`：清除已加载内容（清理范围按正式政策，§6 第 10 项）；项目切换：面板关闭，旧内容不残留 |
| 原型状态 | n19-late, n19-revoked, n19-project |

---

## 3. 流式与补读规则（全部「候选，待 C/后端冻结」）

| 规则 | 要求 |
| --- | --- |
| 稳定身份 | 每个片段有 `fragmentId`，并有同一 attempt 输出流内单调递增的 `seq`；同一片段重发时 fragmentId 与 seq 不变 |
| 排序 | 按 `seq` 渲染，不按到达时间或 `recordedAt` 排序；工具卡位置由该 callId 首个片段的 seq 决定，后续状态原位更新（晚回标注返回时间） |
| 去重 | 以 fragmentId 去重，seq 不超过已渲染最大值的重复片段丢弃；补读结果可显示「去重 n 条」 |
| 游标 | 只由服务签发、不透明；renderer 不构造游标，也不用 seq 拼游标（除非 C 冻结为可用 `afterSeq`） |
| 重播边界 | 响应声明可重播的最早 seq（`replayFrom`）；更早的部分以 gap 表示 |
| 缺口 | `gaps[]` 显式给出 seq 区间和可选时间区间及原因；UI 画虚线分隔条，**不得用空白或「补读完成」掩盖** |
| 首读与订阅竞态 | 先订阅并缓冲事件，再首读；首读返回 `cursor` 与最大 seq，缓冲中 seq ≤ 该值的丢弃，其余按 seq 合并。若服务不支持先订阅，需给出等价的「读到 seq 为止」声明 |
| 保留 / 过期 | 游标带 `expiresAt?`；过期返回 `CURSOR_EXPIRED`，客户端重新首读，并对不可补区间显示缺口 |
| 终结 ≠ 成功 | `stream.terminal = true` 只表示输出传输结束。完成只来自快照状态 + 合法 result_submit 回执 + 验收事实。模型自述「完成」、文本停止、连接断开、工具退出都不能替代 |
| facet 分离 | 传输（客户端连接）/ 内容（stream）/ 工具（tool_activity 与工具记录）/ attempt（ExecutionSnapshot）/ 结果与验收（AttemptResult + AcceptanceRecord + 回执）五组来源独立，UI 并列展示，不合成新的状态机 |
| 公开 reasoning | 只有 provider 实际公开、展示被允许、当前用户有权时，才以 `category = public_reasoning_summary` 下发。`capabilities.publicReasoningSummary` 说明缺失原因。客户端不从正文、时间间隔或动画推断「思考中」，也不展示内部思维链 |
| 历史范围 | 历史 attempt 只分页读、不订阅、无追加；当前 attempt 有新内容只以提示呈现，不自动切换 |
| 资源独立变化 | 输出 / 工具证据有独立变化时，按事件或独立 revision 重读，不能只等 snapshot.revision 变化 |

---

## 4. 权限与脱敏矩阵

**总原则**

1. **服务端先脱敏再交付**：被隐藏字段以标记 `{"$redacted": "<kind>"}`（「候选，待 C/后端冻结」）出现，值从未进入 renderer、DOM、缓存或剪贴板。复制输出 `"[已隐藏]"`，下载使用与展示相同的脱敏范围。令牌、密码、认证头、凭据内容、服务私有 lease / token（含 leaseTokenRef）、host 身份不进入任何投影。
2. **URL 只选资源**：URL 中的 execution / node / attempt / callId / ref 只用于选择查看目标，不携带也不授予 scope、actor、grant。
3. **每次读都重新鉴权**：历史 attempt、正文、工具内容、产物、来源都逐项按当前授权检查，结果不缓存为授权依据。
4. **不接受任意输入**：不提供任意路径、任意 scope、任意 credential、数据库身份或 URL 的读取参数。产物和来源只能通过服务给出的 ref 读取。
5. **历史阅读不加命令权限**：阅读按钮不扩大后端授权；历史详情不出现恢复、重跑、推进、验收、审批入口。

| 资源 | 查看 | 复制 | 下载 | 打开引用 | 条件 / 无权表现 |
| --- | --- | --- | --- | --- | --- |
| 节点概览 / 当前证据（现有） | 现有授权 | 已展示文本 | — | 跳到 2.9 | 无权 `FORBIDDEN`，面板显示锁定说明 |
| 模型正文「候选，待 C/后端冻结」 | 当前授权 + 能力 | 单块原文，不含按钮、状态、隐藏内容 | 不提供 | 仅结构化 citations | `CAPABILITY_UNAVAILABLE` / `FORBIDDEN` / `NOT_RETAINED` |
| 公开推理摘要「候选，待 C/后端冻结」 | provider 公开 + 允许展示 + 当前授权 | 单块原文 | 不提供 | — | 不满足时不下发，UI 不画占位 |
| 工具参数「候选，待 C/后端冻结」 | 当前授权，已脱敏 | 已加载部分（标记替换为 `[已隐藏]`） | 不提供（是否需要由 §6 决定） | — | 无权整区上锁，保留摘要层 |
| 工具结果 / 错误「候选，待 C/后端冻结」 | 同上 | 同上 | 仅经 outputRefs → 产物路径 | outputRefs → 2.9 | `TRUNCATED` 时复制只含已加载部分并在 UI 注明 |
| 产物正文「候选，待 C/后端冻结」 | 精确 revision + 当前授权 | 已加载部分 | `exportable.allowed` + 宿主能力 | — | 版本失效、不存在、无权分别显示 |
| 来源 / 引用「候选，待 C/后端冻结」 | 精确快照 + 当前授权 | 已加载节选 / 摘要 | 不提供 | 精确行或段落；摘要无定位 | 节选 / 摘要显著标注 |
| 历史 attempt 记录「候选，待 C/后端冻结」 | 当前授权（非当时授权） | 同各子资源 | 同各子资源 | 同各子资源 | 只读；`REVOKED` 时按政策清理 |
| 验收记录（现有 + 历史候选） | 当前授权 | 状态文本 | — | — | 不得挂到其他 resultRevision；历史阅读不提供决定入口 |

---

## 5. 错误与可用性分类（候选码，全部「候选，待 C/后端冻结」）

| 码 | 含义 | UI 处理 | 原型状态 |
| --- | --- | --- | --- |
| `NOT_RETAINED` | 记录存在过但服务未保留（正文 / 历史 attempt / 工具正文） | 中性说明 + 明示范围；保留已加载内容；缺口条 | n18-not-retained, n10-gap |
| `CAPABILITY_UNAVAILABLE` | 服务或上游未提供该能力（正文读取、工具完整参数、下载） | unknown 虚线样式，「当前服务尚未提供 …」，不是错误 | n14-no-capability, n05-no-reasoning（摘要用 capabilities，不报错）|
| `FORBIDDEN` | 当前用户无权读取该资源 | 锁图标 + 说明；摘要层仍可见时保留 | n14-no-permission |
| `REVOKED` | 读取期间或缓存后被撤权 | 清除内容，「你已无权查看此尝试的记录」 | n19-revoked |
| `TRUNCATED` | 服务侧截断（保留上限 / 读取上限） | 顶部警告横幅；有 nextCursor 才给「继续读取」；不称完整 | n14-truncated |
| `UNSUPPORTED_FORMAT` | mediaType 不能预览 | 「这种格式不能在这里预览」+ 类型 / 大小；下载按 exportable | n15-art-unsupported |
| `VERSION_SUPERSEDED` | 精确 revision 已被替代，不再提供正文 | 「rN 已被替代」；不自动跳到新版本 | n15-art-missing（替代分支）, n17-history（结果被替代标记） |
| `NOT_FOUND` | 资源不存在 | 「不存在」空态 | n15-art-missing |
| `CURSOR_EXPIRED` | 游标超过保留期 | 自动重新首读；不可补区间画缺口 | n10-gap |
| `READ_FAILED` | 暂时性读取失败 | 危险横幅 + 「重新读取」；保留已加载内容并标读取时间 | n13-tool-failed（读取失败分支）, n18-page-fail |
| `STALE_TARGET` | 目标与当前 execution / node / attempt / 代次不再匹配 | 丢弃；重读快照后显示新目标的加载态 | n19-late, n17-back-current |
| `NOT_SUBMITTED` / `NOT_ENTERED`（空态，非错误） | 该 attempt 没有结果 / 未进入验收 | 真实空态 | n17-history, n06-ended-unsubmitted |
| `RECEIPT_UNKNOWN`（沿现有回执未明规则，非新码） | 操作回执未明 | 保持原记录，「核对原操作」 | n09-receipt-unknown, n08-cancel-unknown |

---

## 6. 需 C 确认清单

1. **模型正文是否可持久读取**：OpenCode session 的 model text 是否落库或可回读；保留多久；能否用于历史 attempt 和断线补读。不能时整个记录流只能做「实时可见、断线即缺口」。
2. **provider 公开摘要能力**：哪些 provider / 模型公开 reasoning summary；展示策略由谁决定（项目、组织或 provider 条款）；是否随正文一起持久化。
3. **一般工具轨迹的生产者**：OpenCode 一般工具活动由谁产生和持久化，与受管 MCP 结算如何去重和对齐 callId；两者是否共享 callId 命名空间。
4. **输出长度、保留与脱敏规则**：正文、工具参数、工具回包的大小上限、截断策略（保留前 N KB 还是分段全保留）、保留期；脱敏规则表与 `{"$redacted"}` 标记形态；inputHash 与脱敏后参数的关系。
5. **产物格式与下载宿主能力**：可预览 mediaType 白名单；产物正文存储位置；Desktop 下载的最小 IPC（请求仅精确 ref，宿主弹保存框），以及取消、失败、不支持的返回。
6. **attempt 分页与验收历史归属**：attempt 历史是否全量保留；分页游标形态；历史 AcceptanceRecord 归属哪个读口（`node.attempt.read` 还是独立投影）。
7. **结果版本与策略版本**：AttemptResult 是否有独立 `resultRevision`；AcceptanceRecord 的「政策 scope」能否给出可显示的 `policyRevision`；结果被替代或失效的事实字段。
8. **事件 schema：扩展还是独立流**：正文片段是扩展现有 DesktopBridge 业务事件，还是另开输出订阅；撤权、缺口、终结如何作为事件投递。
9. **取消与未知回执事实**：快照能否区分「取消已请求 / 已确认停止 / 取消结果未知」；取消后已产生的工具副作用如何标记为未知。
10. **撤权后的清理政策**：已加载内容是立即清除还是保留并遮挡；是否影响已下载的文件（宿主侧无法回收，应说明）。
11. **首读与订阅竞态的正式顺序**：是否支持「先订阅后首读」，或改由首读返回 seq 水位。
12. **content facet 的「等待工具返回」**：producer 能否给出可信的 `awaitingTool`，否则 UI 不显示该值。
13. **时间来源**：`recordedAt`、`startedAt` / `endedAt` 是服务记录时间还是上游时间；时钟不一致时如何处理。
14. **正文中的引用**：模型正文里的 [1] 能否由服务给出结构化 `citations`（SourceRef + 精确定位）；做不到时正文不渲染可点引用。
15. **projectId 回显**：`node.evidence` 的 path 只有 executionId/nodeId；候选读口是否回显 projectId 供客户端丢弃晚回，还是只靠 executionId 全局唯一。
16. **节点是否必然有验收**：没有验收策略的节点，「完成」的判定依据是什么（brief 写作「结果回执与验收」）。
17. **执行代次与 attempt 的关系**：恢复后同一 attempt 是否会跨代次；列表展示「执行代次 n」时取哪一个值。

---

## 7. 原型状态与生产能力对照

设计样例成功 ≠ 实现。下表每行写的是：生产环境必须**实际具备**什么，才能显示该画面；不具备时，UI 应退回到对应的「缺能力 / 未知」状态。

| 状态 id | 生产显示前提 |
| --- | --- |
| n01-default | 现有 `execution.read`；无新增 |
| n01-open | 现有 `node.evidence`；执行现场页签内容取决于下列候选 |
| n01-closed | 仅客户端：关闭后保留选中与视口 |
| n02-loading | `node.output.read` 已安装；否则显示「当前服务未提供模型正文」 |
| n02-empty | 服务能证实 attempt 已开始且输出流为空（区别于无能力） |
| n03-stream | 正文订阅与 seq / fragmentId 已冻结并接通；Markdown 渲染为客户端能力 |
| n04-wait-tool | producer 给出可信 `awaitingTool`（§6 第 12 项） |
| n04-tool-running | 运行中工具事件（MCP 结算现为 settled，运行中事件需新生产者） |
| n04-tool-done | 工具结果事实（MCP 现有结算可部分支撑；OpenCode 工具待定） |
| n05-reasoning | provider 实际公开摘要 + 允许展示 + 以独立类别下发 |
| n05-no-reasoning | `capabilities.publicReasoningSummary` 能给出缺失原因 |
| n06-ended-unsubmitted | `stream.terminal` + 快照显示结果未提交 |
| n06-pending-accept | 现有 AttemptResult + AcceptanceRecord（待验收） |
| n07-failed-partial | 失败 attempt 的部分正文仍可读（持久化正文） |
| n08-cancelling | 快照能区分「取消已请求」（§6 第 9 项） |
| n08-cancelled | 快照的已确认停止事实 |
| n08-cancel-unknown | 现有回执未明规则 + `operations.by-key` 核对 |
| n09-receipt-unknown | 现有 `operations.by-key`；不新增重发 |
| n10-disconnected | 仅客户端连接状态 + 过时标记 |
| n10-reconnecting | 仅客户端 |
| n10-backfilling | 可重播游标 + 输出持久化 |
| n10-backfilled | 补读按 fragmentId 去重，服务声明无缺口 |
| n10-gap | 服务给出 `gaps[]`；没有时不得显示「补读完成」 |
| n11-done | 快照完成 + 合法结果回执 + 验收通过（现有事实） |
| n11-accept-rejected | 现有 AcceptanceRecord 未通过，绑定 resultRevision |
| n11-manual-accept | 现有 AcceptanceRecord + `acceptance.decision.preview`（仅当前 attempt） |
| n12-follow-on | 仅客户端；依赖 n03 的追加 |
| n12-follow-off | 仅客户端 |
| n12-scrolled-new | 仅客户端；新内容计数依赖 seq |
| n13-tool-text | `node.tool.read` + 参数 / 回包正文已保留 |
| n13-tool-json | 同上，format = json |
| n13-tool-code | 同上，format = code / command_output，exitCode 可选 |
| n13-tool-empty | 服务能区分「空结果」与「未保留」 |
| n13-tool-failed | 工具 error 正文已保留；读取失败分支需 `READ_FAILED` |
| n13-tool-twice | callId 唯一且按 seq 定位卡片；晚回原位更新 |
| n14-redacted | 服务端脱敏规则 + 标记形态已冻结 |
| n14-no-permission | 工具正文的逐项授权检查 |
| n14-no-capability | 可用性码；当前生产就是这一状态（MCP 只有 inputHash） |
| n14-truncated | 截断事实与可选 nextCursor |
| n15-art-text | `artifact.read` + 产物正文存储 |
| n15-art-json | 同上 |
| n15-art-code | 同上，行号由完整正文给出 |
| n15-art-unsupported | mediaType 白名单（§6 第 5 项） |
| n15-art-missing | `NOT_FOUND` / `VERSION_SUPERSEDED` 能区分 |
| n15-download | 宿主 `artifact.export` + `exportable`；未接时按钮禁用 |
| n16-cite-source | `source.read` + 来源快照原文 |
| n16-cite-code | 精确 revision 的完整正文 + 真实行号 anchor |
| n16-cite-excerpt | contentKind = excerpt / summary；无原文时不给行号 |
| n17-list | `node.attempts.list` |
| n17-history | `node.attempt.read`（结果 + 验收绑定 resultRevision / policyRevision） |
| n17-history-session | 历史 attempt 的 `node.output.read`（持久化正文） |
| n17-back-current | 快照 currentAttemptId + 当前读口；未补齐显示加载 |
| n18-not-retained | retention 声明 |
| n18-page-fail | 分页游标 + `READ_FAILED` |
| n19-late | 响应带 Binding（或 executionId 全局唯一，§6 第 15 项） |
| n19-revoked | `REVOKED` 码或撤权事件 + 清理政策 |
| n19-project | 仅客户端：切项目时取消订阅、清缓存 |
| n20-reader | 仅客户端布局；内容依赖 n15 / n16 |
| n20-keyboard | 仅客户端 |
| n20-reduced | 仅客户端 |

**当前生产实际可支撑**（按 02/03）：n01-default、n01-open、n01-closed、n06-pending-accept、n09-receipt-unknown、n11-done、n11-accept-rejected、n11-manual-accept（仅当前 attempt）、n14-no-capability，以及 n04-tool-done 的受管 MCP 摘要部分。其余画面在 C 冻结并实现对应候选能力之前，应显示「当前服务未提供」或「未知」，不能用设计样例顶替。
