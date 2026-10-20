# 运行环境 / 工具与 Skill / 数据库 前端设计一致性审计

> 基线：main @ `3f6f9b2`（2026-10-20）。范围：P18 运行环境（`originals/main/pages/runtime.html`，7 状态）、P19 工具与 Skill（`tools.html`，9 状态含 B-14）、P20 数据库（`databases.html`，13 状态含 B-13）；实现 `apps/web/src/pages/{runtime,tools,databases}/`（runtime 348 行、tools 239 行、databases 1155 行，含 CSS）、路由 `/runtime`、`/tools`、`/databases`，契约 `packages/shared/src/api/contracts.ts`、`packages/shared/src/domain/access.ts`、`packages/shared/src/config/settings.ts`，服务 `packages/server/src/{runtime-operations,tool-policy,http,skills}.ts`、`packages/database/src/service.ts`。审计方式：静态代码 vs 只读设计稿；未运行 GUI 的部分标注“需GUI”。本区域**未发现 P0**。

## 概览

| 页面 | 设计状态数 | 已逐项核对 | P0 | P1 | P2 | P3 | 结论 |
|---|---|---|---|---|---|---|---|
| P18 运行环境（`runtime.html`） | 7 | 是 | 0 | 0 | 5 | 2 | 主结构与真实状态/回执对齐；状态卡信息（上次检查/进程归属）、各异常 banner、重启确认与 cmd-unknown 页面级锁定不足 |
| P19 工具与 Skill（`tools.html`，含 B-14） | 9 | 是 | 0 | 0 | 1 | 5 | 主流程（配置范围/三态/回执/Skill 阅读）对齐；来源状态呈现、Skill 原文档位与失败/空文案有差距 |
| P20 数据库（`databases.html`，含 B-13） | 13 | 是 | 0 | 1 | 5 | 5 | 扩展类型驱动未提供导致 4 个设计态不可达；归档/停用/版本、状态筛选、检查三格语义与抽屉形态存在差距 |

**最重要的问题（≤5 条）**
1. `P20-01` 五种扩展类型（SQL Server / openGauss / GaussDB / Oracle / 达梦 / DB2）无可用驱动，B-13 的 `og-new`、`dm-probe`、`db2-fail`、`probe-ok（SQL Server）` 四个设计状态静态不可达（实现诚实禁用并给原因，属已登记的 C9 能力缺口）。
2. `P20-02` 设计中的连接“版本 v7”、抽屉“更多→停用/启用/归档…”、归档确认与“已归档”筛选全缺失；实现只提供删除（不可恢复），归档后“已冻结任务继续使用当时配置”的设计语义没有承载。
3. `P20-04` 检查三格位置与语义不符：设计在编辑抽屉“连接检查”区内；实现在列表卡片上，且“只读已强制”的数据来自 `readOnlyEnforced = measurement.sessionReadOnly`（`packages/database/src/service.ts:156`），并非独立事实，“只读强制待核实”三态无法产生。
4. `P18-02` 运行环境状态主卡缺设计的“上次检查 今天 HH:mm:ss”、进程归属（“未找到可用进程”）、服务/属主信息；状态词用 `已就绪/已停止/失败/部分可用`，设计为 `已连接/离线/启动中/状态待核实`。
5. `P18-01` `read-error`（读取失败保留上次结果）没有“下面可能是过时的上一次结果”说明与陈旧态视觉，页面仍按正常状态展示旧快照（数据诚实风险）。

## 状态覆盖

### P18 运行环境（`originals/main/pages/runtime.html`）

| mock state | 设计名称 | 实现判定 | 证据（实现文件:行 / 无） | 说明 |
|---|---|---|---|---|
| `managed` | 受管 · 已连接 | 部分 | `apps/web/src/pages/runtime/RuntimePage.tsx:95-143`（hero：badge+版本+受管/外部徽标+hint）、`:189-245`（三事实卡）、`:270`（RuntimeControls）；设计 `runtime.html:58-76,87-101` | 真实 `/api/opencode/status`（`packages/server/src/http.ts:1547-1586`）驱动；有受管徽标、PID/代次/监听地址复制/模型/MCP 工具数。缺设计中“上次检查 今天 HH:mm:ss”、属主“Loopper 受管进程”、“管理方式”行与“重启只作用于这个进程”提示；状态词不同（P18-02）。 |
| `external` | 外部进程 · 已连接 | 已实现 | `RuntimePage.tsx:73,124-132,137-139,167-176`；设计 `runtime.html:67,84` | `managed=false` 显示“外部进程 · 未受管”徽标 + info banner“只读取状态，不执行重启”；重启按钮禁用且原因可读（`:81-82`）。 |
| `offline` | 离线 · 启动失败 | 部分 | `RuntimePage.tsx:18-19`（action=start）、`:178-187`（lastError banner）；设计 `runtime.html:80` | `stopped/failed` 时提供“启动 OpenCode”并展示服务 `lastError`；缺设计“OpenCode 没有启动成功 / 任务和知识库暂时不能运行 / 检查 CLI 路径与模型设置后再启动”的 banner 与设置深链（P18-03），“启动失败”语义靠 `failed` 状态词与错误行承载。 |
| `starting` | 启动中 | 部分 | `RuntimePage.tsx:83-84`（重启禁用原因）、`:21-27,120-122`（badge 启动中）；设计 `runtime.html:81` | badge/按钮禁用正确；缺设计“OpenCode 正在启动，已启动进程 PID，等待连接就绪”banner 与 spinner（P18-03）。 |
| `unknown-status` | 状态无法识别 | 部分 | `RuntimePage.tsx:72,85-86,115-118`；设计 `runtime.html:82` | 状态非枚举时 badge“状态未知：RAW”+ 重启禁用原因“无法识别的状态「X」”；缺设计 danger banner“服务返回了无法识别的状态 DEGRADED，为避免误操作…请重新读取或查看日志”及 banner 内“重新读取”按钮（P18-03）。 |
| `read-error` | 读取失败（保留上次结果） | 部分 | `RuntimePage.tsx:145-154`（ServiceNotice）、`apps/web/src/components/ServiceNotice.tsx:20-25`（标题“数据读取失败/服务未连接”）；设计 `runtime.html:79` | 查询失败时保留上一次 `status` 数据继续渲染（react-query 缓存），但**没有任何“这张卡是上次结果、可能已过时”的说明**，设计还要求整卡 `.stale` 降透明与“19:30:01 读取到的上一次结果”（P18-01）。 |
| `cmd-unknown` | 重启结果未明（锁定） | 部分 | `apps/web/src/pages/runtime/RuntimeControls.tsx:20-32`（receipt unknown）、`:44-45`（消息 + 核对原请求）、`:43`（pending 锁按钮）；设计 `runtime.html:83` | 页面级无“没有收到重启 OpenCode 的结果”banner；缺“在确认之前不能再次启动或重启”“离开本页会被提醒”“读取当前状态”按钮；锁只体现在按钮禁用/文字（P18-05）。 |

### P19 工具与 Skill（`originals/main/pages/tools.html`）

| mock state | 设计名称 | 实现判定 | 证据（实现文件:行 / 无） | 说明 |
|---|---|---|---|---|
| `tools` | 工具 · 全局默认 | 已实现 | `apps/web/src/pages/tools/ToolsPage.tsx:15-58`、`ToolsPolicyView.tsx:66-95`；设计 `tools.html:88-131` | 页头配置范围 select 通过 `PageHeaderSlot` 注入（`ToolsPolicyView.tsx:67-69`），300px 来源侧栏 + 摘要卡（`:73-79`）+ 全局 switch（`:84`）+ 生效行（`:85`）+ “只影响新建会话”chip（`:78`）；工具描述用目录 title 顶替（P19-03）。 |
| `project` | 工具 · 项目设置 | 已实现 | `ToolsPolicyView.tsx:67-69,84-85`；设计 `tools.html:122-129` | 三态“继承/启用/停用”（`projectOverride null/true/false`）、项目明确值、全局值、“项目设置优先于全局默认”chip、“项目明确停用·全局为启用”文案均实现。 |
| `partial` | 工具清单不完整 | 部分 | `ToolsPolicyView.tsx:73,80,87`；服务 `packages/server/src/tool-policy.ts:33-35`；设计 `tools.html:109,114` | 分支只在**外部 MCP 来源**（`complete=false`）出现，内置 4 个来源恒 `complete:true`；banner“工具清单不完整…”+锁定 + “重新读取”+ 空工具卡“暂时读不到这个来源的工具”均实现。需真实外部 MCP 响应才能触发（P19-01）。 |
| `write-unknown` | 修改结果未明 | 已实现 | `ToolsPolicyView.tsx:24-31,37-52,53-63`、`tool-policy-command.ts:1-11`；设计 `tools.html:110` | 持久命令身份（刷新/切 Skill 返回仍锁）、范围/来源/开关全禁、原 key 核对、`accepted` 等待结算/`unknown` 待核对文案均实现；缺设计“正在按原范围重新读取清单”的自动重读与具体工具名（P19-02）。 |
| `skills` | Skill 阅读 | 已实现 | `SkillsView.tsx:12-40`；设计 `tools.html:132-152` | 目录+搜索、只读 badge“只读 · 阅读不会执行 Skill”、路径、Markdown 渲染（`ReadableText`）、空正文/读取失败态均有；文案与“正文读取失败（OPENCODE_SKILLS_UNAVAILABLE）”细节不同（P19-05）。 |
| `skill-error` | Skill 读取失败 | 部分 | `SkillsView.tsx:23,37`（`ServiceNotice`）；设计 `tools.html:143` | 目录列表错误有 ServiceNotice+重试；正文读取错误显示通用“数据读取失败/服务未连接 + 错误码”，缺设计“Skill 正文读取失败 / OpenCode 的 Skill 服务暂时不可用 / 目录仍可浏览”文案（P19-05）。 |
| `skill-raw` | 补充 · Skill 原文 | 部分 | `SkillsView.tsx:37` → `apps/web/src/pages/node/ReadableText.tsx:32-48`；设计 `tools.html:195-222` | 原文模式带行号（`reader-line-number` aria-hidden）、复制按钮写入不含行号的正文、可关闭自动换行；缺“Markdown 原文 · N 行 · 自动换行”“行号不随复制带出”说明、Markdown 语法配色与“阅读视图/原文（带行号）”seg 形态（P19-04）。 |
| `skill-empty` | 补充 · Skill 正文为空 | 部分 | `SkillsView.tsx:37`（EmptyState）；设计 `tools.html:220` | 明确“Skill 正文为空/目录仍可浏览”；缺设计“文件已读取成功，但没有正文内容。需要补充时，请在 <path> 中编辑”与原文入口禁用说明（P19-05）。 |
| `skill-read-fail` | 补充 · Skill 文档读取失败 | 部分 | `SkillsView.tsx:23,37`；设计 `tools.html:218` | 有错误 + 重试；缺设计“文档读取失败，请重试 / 左侧目录仍可使用，可以先阅读其他 Skill”banner 与 `role="alert"`（P19-05）。 |

### P20 数据库（`originals/main/pages/databases.html`）

| mock state | 设计名称 | 实现判定 | 证据（实现文件:行 / 无） | 说明 |
|---|---|---|---|---|
| `list` | 连接列表 | 部分 | `apps/web/src/pages/databases/DatabasesPage.tsx:427-586`（卡片）、`:633-649`（工具条）；设计 `databases.html:11-22,86-105` | 卡片事实条（可读范围/授权项目/最近检查，`:475-499`）、检查三格（`:501-523`）、测试连接/编辑/删除齐全；缺状态分段筛选与归档视图、3 列网格被 2 列替代、引擎色块被通用图标替代（P20-03/P20-09）。 |
| `empty` | 没有连接 | 已实现 | `DatabasesPage.tsx:408-422`；设计 `databases.html:87` | EmptyState“还没有数据库连接”+“添加连接”（类型清单未就绪时禁用并给原因）。 |
| `edit` | 编辑连接（600 抽屉） | 部分 | `DatabasesPage.tsx:677-929`（`size="lg"`；`--drawer-lg:520px` 见 `apps/web/src/styles/ds.css:88`）；设计 `databases.html:66,111-136` | 真实表单/密码不回显/授权项目/保存回执/未知锁定均有；缺版本徽标、“更多”菜单（停用/启用/归档）、600 宽、schema 标签输入、每连接查询限制、连接检查三格（P20-02/P20-04/P20-07）。 |
| `new` | 添加连接 | 部分 | `DatabasesPage.tsx:340-346,677-929`；设计 `databases.html:109` | 同上；类型为下拉（含 planned 类型禁用项与原因），设计为 B-13 类型单选卡片网格 + 驱动文件名（仅 BX 状态，见 `og-new`）。 |
| `probe-ok` | 检查通过（SQL Server） | 不可达 | 驱动 `sqlserver` 为 `planned`（`packages/shared/src/config/settings.ts:271`），服务拒绝保存/测试（`packages/server/src/http.ts:1391`、`:282` 见 `DATABASE_TYPE_META`）；设计 `databases.html:142-146` | SQL Server 连接无法新增/保存/测试，该设计态静态不可达；三格组件本身在可用驱动（MySQL/PG/GoldenDB）卡片上存在（`DatabasesPage.tsx:501-523`）。 |
| `probe-fail` | 检查失败 | 已实现 | `DatabasesPage.tsx:226-237`（草稿探针失败保留输入）、`:155-194`（探针反馈）、`:312-315`；设计 `databases.html:140` | 错误详情 + 保留输入 + 可重试；设计“认证失败 DATABASE_AUTHENTICATION_FAILED”文案由服务错误码/信息承载（`ProbeFeedbackView` 显示 API 错误码）。 |
| `save-unknown` | 保存结果未明 | 部分 | `DatabasesPage.tsx:239-265,381-389,614,723`；设计 `databases.html:118,134-135` | 网络 UNKNOWN 后表单 `fieldset disabled`、保存禁用、保留原请求号、`operations/by-key` 核对、列表页/抽屉内双 banner 均实现；但保存接口同步返回 succeeded/failed（`http.ts:1367-1433`），**服务不会产生 unknown receipt**；设计“正在逐页读取全部连接核对这一条是否已更新为 v8”未实现；结果未明时抽屉关闭按钮点击被静默拦截、无禁用原因（P20-05）。 |
| `og-new` | 补充 · 新增 openGauss | 不可达/部分 | 类型清单包含 `opengauss` 但 `driver:'planned'`（`settings.ts:272`）；`DatabasesPage.tsx:787-792`（选项禁用）、`:739`（banner） | 类型会出现在下拉中但禁用并标“（未提供驱动）”，不能新增/检查/保存；设计 B-13 的类型单选卡 + “已内置 openGauss 驱动 · opengauss-jdbc-6.0.0.jar”+“完整兼容性：待现场版本联调”无对应（P20-01/P20-11）。 |
| `dm-probe` | 补充 · 达梦检查通过（只读待核实） | 不可达 | 达梦驱动 `planned`（`settings.ts:273`）；`DatabasesPage.tsx:515-522`（三格未知分支存在） | 驱动缺失无法检查；“只读强制待核实”这一组合在服务侧也不会产生：`readOnlyEnforced = measurement.sessionReadOnly`（`packages/database/src/service.ts:156`），二者恒同（P20-01/P20-04）。 |
| `db2-fail` | 补充 · DB2 检查失败 | 不可达 | DB2 驱动 `planned`（`settings.ts:275`）；失败 banner 分支 `DatabasesPage.tsx:226-237,155-163` | 失败呈现机制存在，但 DB2 无法检查，设计态不可达（P20-01）。 |
| `gd-edit` | 补充 · GoldenDB 编辑（已切换驱动提示） | 部分 | GoldenDB 驱动 `mysql2`（`settings.ts:268`）；`:783-785`（切类型重置 host/database）；设计 `databases.html:206-213,228-237` | GoldenDB 可新增/编辑/检查；切换类型会清空地址但没有设计“已清空，请重新填写”警示，也没有“测试和保存将使用上述驱动；保存后供新会话使用，历史任务保留原驱动”说明（P20-11）。 |
| `legacy-type` | 补充 · 历史类型不可编辑 | 部分 | `DatabasesPage.tsx:739`（不在驱动清单 banner）、`:740`（fieldset disabled）、`:711`（保存禁用原因）；设计 `databases.html:240,257-259` | 对 planned 类型禁用表单并提示“历史连接只能查看”，但设计场景是“服务类型清单**不再返回**某类型”（`bxTypes()` 过滤 ORACLE）的纯查看态，且设计允许“查看配置和检查连接”；实现不能表达“类型不再返回”，且历史类型也不能检查（检查草稿按钮因 `canSave` 依赖 supportedTypes 被禁用）（P20-06）。 |
| `types-fail` | 补充 · 类型清单读取失败 | 部分/不可达 | `DatabasesPage.tsx:206`（types 与 connections 同一 GET）、`:651`（typeQuery 错误 notice）、`:607`（添加禁用）；设计 `databases.html:188-190` | 类型清单与连接列表共用 `GET /api/settings/databases`（`packages/server/src/http.ts:1358-1361`），无法出现“类型清单读取失败、连接列表仍可查看”；只有第二次同接口请求失败时才显示 typeQuery 错误（P20-08）。 |

### 补充状态（非 mock 列表中单列，但审计要点要求核对）

| 状态 | 实现判定 | 证据 | 说明 |
|---|---|---|---|
| 加载中（三页首屏） | 已实现 | `RuntimePage.tsx:90-91`；`ToolsPage.tsx:28-32`；`DatabasesPage.tsx:392-393`；`SkillsView.tsx:22` | 均有“正在读取…”文案 |
| 错误（opencode 状态/bootstrap/工具策略/Skill 目录与正文/连接列表/类型清单） | 已实现 | `RuntimePage.tsx:145-165`；`ToolsPolicyView.tsx:64-65,70`；`SkillsView.tsx:23,37`；`DatabasesPage.tsx:394-407,651` | ServiceNotice + 重试；数据库错误态明确“不展示示例连接” |
| 外部/未受管进程 | 已实现 | `RuntimePage.tsx:73,124-132,137-139,167-176` | 只读，不提供重启，原因可读 |
| UNKNOWN 回执（运行时/工具策略/数据库保存） | 已实现 | `RuntimeControls.tsx:20-45`；`ToolsPolicyView.tsx:24-31,71`；`DatabasesPage.tsx:239-265,614,723` | 原 requestKey 保留、禁用重复提交、`operations/by-key` 只读核对 |
| planned 驱动类型 | 已实现（诚实降级） | `settings.ts:263-275`；`http.ts:1360,1391`；`DatabasesPage.tsx:787-800` | 列出类型并标注“未提供驱动/不能测试或保存”，无伪造成功（C9，见 P20-01） |
| 未授权项目连接 | 已实现 | `DatabasesPage.tsx:481-487` | 卡片 warn“任务读不到它”+ 说明查询需同时满足项目/职业/节点/会话只读 |
| 会话只读/只读强制三态 | 部分 | `DatabasesPage.tsx:513-522`；`packages/database/src/service.ts:156` | 未检查/未通过/已强制/待核实分支存在，但“只读强制待核实”不可由服务产生（P20-04） |

## 问题清单

### P18-01: `read-error` 保留上次结果，但没有“可能过时”的说明与陈旧态呈现
- **严重度**：P2
- **维度**：S / D / V
- **类别**：状态 / 数据诚实 / 样式
- **设计依据**：`opencode-workflow-design-showcase/originals/main/pages/runtime.html:79`（danger banner“读取当前状态失败…下面是 19:30:01 读取到的上一次结果，可能已经过时”+“重新读取”）、`:68,90`（`read-error` 时 hero/facts 加 `.stale`：`.stale{opacity:.55}`，`:28`）
- **实现位置**：`apps/web/src/pages/runtime/RuntimePage.tsx:145-154`（`ServiceNotice`，标题取默认“数据读取失败/服务未连接”）；`:95-143,189-245`（继续渲染 `statusQuery.data` 旧快照，无 stale 标记）；`apps/web/src/components/ServiceNotice.tsx:20-25`
- **差异**：设计要求读取失败时明确告知“展示的是上一次结果、可能已经过时”，并整卡降透明；实现只用通用错误条覆盖，主卡仍按正常状态（含绿色“已就绪”badge）展示旧数据，不提示陈旧。
- **原因**：直接原因：`ServiceNotice` 是通用错误组件，页面未按 `read-error` 单独补陈旧说明（C2）；主卡没有 stale 视觉分支（C7）。根本原因：读取失败状态只按“接口报错”处理，没有按设计的“保留上次结果并标注过时”状态建模（C2/D）。
- **影响**：用户可能把过期状态当作当前状态（例如已经离线仍显示“已就绪/已连接”），并据此判断能否执行任务/重启。
- **建议**：`statusQuery.isError && status !== undefined` 时在页面顶部加设计原 banner（含上次读取时间/是否过时）；hero/facts 加降透明/“上次结果”标记；`ServiceNotice` 可传设计标题。
- **验证**：静态；旧数据保留路径需真实服务断开 + GUI 验证。
- **关联状态**：`read-error`

### P18-02: 状态主卡缺“上次检查/进程归属”，状态词与设计不一致
- **严重度**：P2
- **维度**：S / T / 结构
- **类别**：状态 / 文案 / 结构
- **设计依据**：`runtime.html:56`（状态词：`已连接` / `离线` / `启动中` / `状态待核实`）、`:66-67`（属主：`Loopper 受管进程` / `外部进程 · 由你自行启动` / `未找到可用进程`）、`:71-72`（badge + `上次检查 今天 19:30:01` + `管理方式`/`进程 PID`/`受管代次` 卡）、`:94-96`
- **实现位置**：`RuntimePage.tsx:13-19`（`STATE_LABEL`：已停止/启动中/已就绪/部分可用/失败）、`:21-35`（tone/icon）、`:108-140`（hero：OpenCode+版本、状态 badge、受管/外部 badge、hint）、`:207-229`（OpenCode 进程卡：可执行文件/监听地址/PID/代次/启动于/默认模型/Agent/期望版本）
- **差异**：①状态词与设计不同（就绪≠已连接、停止/失败≠离线、部分可用设计无对应）；②hero 没有“上次检查”时间；③进程归属只以 badge 出现，缺设计“管理方式”行、“未找到可用进程”属主、以及“重启只作用于这个进程/外部进程不受管理”说明；④设计“服务”卡（Loopper 版本/OpenCode 版本/监听地址 copy/当前模型更改）被拆到“应用卡 + OpenCode 进程卡”。
- **原因**：直接原因：页面按服务端状态枚举直出中文（C3），信息按实现字段重新分组（C4），未复刻设计的归属/检查时间（C2）。根本原因：设计状态模型（连接/离线/待核实 + 归属）与产品服务状态模型（stopped/starting/ready/degraded/failed）未建立映射层（C3/C6）。
- **影响**：用户无法一眼确认“这是本程序拉起的进程吗、什么时候检查的、状态是什么意思”，影响启动/重启判断。
- **建议**：补“上次检查”时间（`statusQuery.dataUpdatedAt`）与归属文案；在进程卡加“管理方式”行；把服务状态映射为设计词（ready→已连接、stopped/failed→离线、degraded/未知→部分可用/状态待核实并解释），保留服务原始枚举作为 hint。
- **验证**：静态；需GUI确认状态徽标与文案。
- **关联状态**：`managed, external, offline, starting, unknown-status`

### P18-03: `offline/starting/unknown-status` 缺设计规定的异常 banner 与引导
- **严重度**：P2
- **维度**：S / T / A
- **类别**：状态 / 文案 / 交互
- **设计依据**：`runtime.html:80`（启动失败 banner：失败原因 + “任务和知识库暂时不能运行”+ 链接到设置“CLI 路径与模型设置”后再启动）、`:81`（启动中 banner：已启动进程 PID、等待连接就绪、spinner）、`:82`（无法识别状态 banner：原始状态值 + 为避免误操作停用启动/重启 + 重新读取/查看日志）
- **实现位置**：`RuntimePage.tsx:178-187`（仅 `lastError` 一条“最近一次运行错误”warn）、`:83-86`（starting/unknown 只体现在按钮禁用原因）、`:115-122`（badge）、`:96-107`（hero 图标颜色按 ready/failed/degraded 切换）
- **差异**：三种状态在实现里主要是“badge 文案 + 按钮禁用原因”，缺少设计要求的主区域 banner、失败原因结构、设置入口、PID/等待提示与“状态不可识别时停用操作”的显式说明；`lastError` 标题用“最近一次运行错误”，与“启动失败”语义不一致。
- **原因**：直接原因：异常状态只用 badge/disabledReason 承载（C2/C4），未按设计新增 banner 组件（C4）。根本原因：状态到提示层的映射缺失，只有错误对象时的通用展示（C2/C3）。
- **影响**：启动失败时用户不知道下一步（去设置检查 CLI/模型），启动中不知道等多久/进程号，状态异常时不知道为何按钮不可用。
- **建议**：按设计补三段 banner（失败含原因+设置深链、启动中含PID+spinner、未知含原始值与重新读取）；`lastError` 文案并入失败 banner。
- **验证**：静态；需真实服务停止/启动失败/未知状态 + GUI。
- **关联状态**：`offline, starting, unknown-status`

### P18-04: 重启确认对话框缺设计快照与后果说明（且实现行为与设计描述冲突）
- **严重度**：P2
- **维度**：A / T / S
- **类别**：交互 / 文案 / 状态
- **设计依据**：`runtime.html:39-43`（alertdialog：标题、`#cfB` 后果、`#cfSnap` 确认时状态/进程/监听地址、按钮“先不要/重启”）、`:113-122`（重启后果原文：“会先停止…正在运行的任务和知识库对话会中断，之后需要在各自页面恢复”；启动说明）
- **实现位置**：`RuntimeControls.tsx:48`（`Modal`：只有“当前状态：X。此确认仅表示本次操作意图…”与“重启会结束运行时会话。服务会拒绝存在活动或待核对任务、规划、知识对话的重启；请先停止并核对它们。”）、`:20-32`（提交后才核对回执）
- **差异**：①无设计“确认时快照”（状态/进程/PID/监听地址）；②后果文案改为“服务会拒绝活动会话”，与设计“会中断、之后需要在各自页面恢复”语义相反（实现对应服务行为：`packages/server/src/runtime-operations.ts:25-31` 明确拒绝存在活动/待核对会话的重启）；③启动确认无设计说明（按设置 CLI 路径启动并由本程序管理）。
- **原因**：直接原因：确认对话框只做最小确认（C5），未复刻快照与后果说明（C3/C4）。根本原因：实现选择“拒绝不安全重启”的产品决策，但未与设计文案对齐/记录（C9 设计缺口 + C3）。
- **影响**：用户确认前看不到“在操作哪个进程/端口”，也不知道是否会丢失当前工作；与设计预期（中断后可恢复）不一致。
- **建议**：对话框补确认时快照（状态/PID/监听地址）；按产品实际行为改写后果（“若存在活动会话，服务会拒绝重启”），并请设计确认是否接受该安全策略；启动确认补来源说明。
- **验证**：静态；需GUI + 真实服务（活动会话拒绝重启已在服务回归中覆盖）。
- **关联状态**：`managed, offline`（启动/重启）

### P18-05: `cmd-unknown` 缺页面级锁定横幅与“离开本页会被提醒”
- **严重度**：P2
- **维度**：S / A / D
- **类别**：状态 / 交互
- **设计依据**：`runtime.html:83`（unknown banner：“没有收到‘重启 OpenCode’的结果…进程可能已经重启，也可能没有。当前状态正常也不能证明重启完成…在确认之前，不会重新发送，也不能再次启动或重启；离开本页会被提醒”+“读取当前状态”按钮）、`:60-63`（`cmd-unknown` 时操作按钮变为“操作已锁定”disabled）
- **实现位置**：`RuntimeControls.tsx:20-32`（unknown 行内消息 + `pending` 锁）、`:43`（按钮 `disabled` + disabledReason）、`:44-45`（“核对原请求”）；`RuntimePage.tsx:270` 无页面级 banner；全区域无 `beforeunload`/离开提醒
- **差异**：UNKNOWN 只体现在“运行时操作”卡内一行 hint + 按钮禁用 + 核对按钮；缺设计的主区域 unknown banner、缺“操作已锁定”显式按钮语义、缺离开页面提醒；`/api/opencode/status` 正常也不清除未核对标记（与设计一致），但页面没有把“当前状态不能证明重启完成”讲清。
- **原因**：直接原因：UNKNOWN 处理局限在操作卡内部（C2/C5），未做页面级锁定与导航拦截（C5）。根本原因：运行时未知态没有按设计“整页锁定 + 离开提醒”建模。
- **影响**：用户在未核对重启结果时可能误以为操作完成或离开页面导致丢失核对线索；页面其他操作（读取当前状态）没有明确引导。
- **建议**：页面顶部加 unknown banner（含操作名、时间、原因、核对/读取按钮）；操作按钮改为“操作已锁定”并给原因；在确认前注册 `beforeunload` 提示。
- **验证**：静态；丢响应场景需真实服务/代理 + GUI（E31 已覆盖服务回归）。
- **关联状态**：`cmd-unknown`

### P18-06: 三事实卡结构与设计不同，且新增设计外“运行数据”卡
- **严重度**：P3
- **维度**：结构 / V
- **类别**：结构
- **设计依据**：`runtime.html:87-101`（服务 / 进程归属 / 内部 MCP 三卡；服务卡= Loopper 版本、OpenCode 版本、监听地址 copy、当前模型更改；进程归属卡=管理方式/PID/受管代次 + “重启只作用于这个进程/外部进程不受管理”；MCP 卡=状态 badge + “配置已注入只表示已写入配置，不代表已连接或已授权”）、`:17-18`（三卡 1.35/1/1、≤1100 单列）
- **实现位置**：`RuntimePage.tsx:189-245`（应用 / OpenCode 进程 / 内部 MCP 三卡）、`:247-268`（运行数据卡：数据目录/SQLite/JSONL，设计未定义）
- **差异**：设计“服务”卡被“应用”卡替代（Loopper 版本/Node/平台/已运行/启动时间），OpenCode 版本/监听地址/模型移入“进程卡”；“管理方式”行与归属提示缺失；MCP 卡改为“已连接 + 名称 + 工具数 + 通道说明”，缺“配置已注入”与“不代表已连接或已授权”的原文；新增“运行数据”卡。
- **原因**：直接原因：按实现信息重新分组并新增本地数据卡（C4）。根本原因：事实卡未按设计信息架构落地，数据目录信息是产品补充但未与设计核对。
- **影响**：与设计信息层级不一致；用户找“当前模型/监听地址”的位置变了；多出的数据目录卡增加噪音。
- **建议**：按设计重排三卡（服务/进程归属/MCP），补管理方式与 MCP 注入说明；运行数据卡经设计确认后保留或移入设置页。
- **验证**：静态；需GUI确认网格与断点。
- **关联状态**：`managed, external`

### P18-07: “最近一次操作”被替换为“运行时操作”卡（全量历史 + 读取历史按钮）
- **严重度**：P3
- **维度**：结构 / T
- **类别**：结构 / 文案
- **设计依据**：`runtime.html:102-111`（卡标题“最近一次操作”、hint“只记录本机发出的启动/重启”、单行：图标+操作名+时间/进程代次变化+结果 badge：已完成/启动未成功/结果未明）
- **实现位置**：`RuntimeControls.tsx:42-49`（“运行时操作”卡：操作按钮 + 读取历史 + 全量历史列表 + 说明）
- **差异**：设计是“最近一次操作”单条摘要（含进程代次变化、启动未成功/结果未明），实现是全量历史（badge + 操作 + 时间 + requestKey）并附“读取历史”按钮；位置从页面底部卡片变为操作卡内。
- **原因**：直接原因：用操作/历史合并卡实现（C4/C3）。根本原因：信息架构未按设计“操作卡 + 最近一次操作卡”拆分。
- **影响**：页面结构与设计不同；全量历史较长时挤压操作区；requestKey 暴露给普通用户（可接受但设计未要求）。
- **建议**：拆出“最近一次操作”卡（最近一条 + 结果语义 + 进程代次变化），完整历史收进“查看全部/抽屉”；requestKey 保留在详情中。
- **验证**：静态；需GUI。
- **关联状态**：`managed, offline, cmd-unknown`

### P19-01: 来源状态与清单完整性呈现弱化（内置来源无状态、外部状态英文原文、partial 只能靠外部 MCP）
- **严重度**：P2
- **维度**：S / T / D
- **类别**：状态 / 数据映射 / 文案
- **设计依据**：`opencode-workflow-design-showcase/originals/main/pages/tools.html:72-79`（来源列表带状态：已连接/等待授权/状态未知，点状色）、`:100`（侧栏“状态 · 本地/远程 · N 个工具”）、`:104-105`（摘要卡状态 badge + 来源类型 + mono id）、`:109`（partial：OpenCode 只返回部分工具（读取 /mcp 超时），开关不可修改）
- **实现位置**：`apps/web/src/pages/tools/ToolsPolicyView.tsx:73`（侧栏：`source.kind==='external' ? source.state ?? '状态未知' : '内置'`；`complete ? N 个工具 : 清单不完整`）、`:76`（摘要 badge 用“清单完整/状态未知”）、`:80`（`!source.complete` banner）；服务 `packages/server/src/tool-policy.ts:13-29`（builtin `complete:true` 恒真）、`:33-35`（external 来源 `complete:false`，`state` 为 MCP 原始状态）
- **差异**：设计来源状态是“已连接/等待授权/状态未知”三类；实现内置来源显示“内置”而无连接状态，外部来源直接显示服务原始 `state`（如 `connected/failed` 英文/协议值），摘要卡只显示“清单完整/状态未知”；“等待授权”语义无承载。partial 状态只能由外部 MCP 触发。
- **原因**：直接原因：服务端来源模型只有 `kind/state/complete`（`packages/shared/src/domain/access.ts:13-16`），没有设计的三态与授权状态（C1）；前端直接透出 `state`（C3）。根本原因：工具来源状态未按设计建模（C1/C6）。
- **影响**：用户无法看出“某个来源到底连没连、是否等待授权”，误以为“内置”就等于可用；partial 提示可能与真实原因不符。
- **建议**：契约补 `status: connected|waiting_authorization|unknown` 与可读原因；前端映射中文状态 + 点状色；内置来源也显示连接/授权状态；外部原始 state 仅作 hint。
- **验证**：静态；外部 MCP 授权/超时需真实运行环境 + GUI。
- **关联状态**：`tools, project, partial`

### P19-02: `write-unknown` 缺“正在按原范围重新读取清单”的自动重读与具体工具名
- **严重度**：P3
- **维度**：S / T
- **类别**：状态 / 文案
- **设计依据**：`tools.html:110`（banner：“‘read_project_reference’的修改结果未明…正在按原范围重新读取清单，确认前不能修改其他工具或切换范围”）
- **实现位置**：`ToolsPolicyView.tsx:24-31,37-52,71`（`uncertain` banner 文案“原工具策略保存结果待核对…”；无自动重读，核对后才刷新）、`:8`（持久命令只有 requestKey/phase，未保留工具名）
- **差异**：实现是“待核对 + 手动核对原请求”，没有设计“先自动重新读取清单确认是否已生效”的过渡，也没有把未明操作的工具名/范围展示给用户；设计明确“正在重新读取”。
- **原因**：C2（缺自动重读分支）+ C3（缺工具名文案）；`pendingToolPolicyCommand` 未保存 body 的工具名（C1 小缺口）。
- **影响**：用户不知道是哪次修改结果未明，也不清楚系统是否在自动核对。
- **建议**：UNKNOWN 时自动重读 `/api/tools/policy` 并对比目标工具当前值；保留原操作 body 展示“<工具名> 修改结果未明”；自动重读完成后仍以原请求回执为准。
- **验证**：静态；丢回执场景需真实服务/代理 + GUI（E36 已覆盖恢复语义）。
- **关联状态**：`write-unknown`

### P19-03: 工具行说明用目录标题顶替，未展示设计的一行功能说明
- **严重度**：P3
- **维度**：T
- **类别**：文案 / 数据契约
- **设计依据**：`tools.html:118-131`（`.tool .n` 工具名 + `.tool .d` 一行功能说明）
- **实现位置**：`ToolsPolicyView.tsx:83`（`<div className="tool-policy-description">{meta?.title ?? tool.name}</div>`）；契约 `packages/shared/src/domain/access.ts:3-11`（`ToolPolicyItem` 无 description）；`apps/web/src/api/catalog.ts:58-62`（目录同时有 `title` 与 `description`，但页面用了 title）
- **差异**：工具名下方本应是功能说明，实现显示的是目录标题（如“读取任务上下文”），与工具名语义重复；服务契约没有 description 字段，但前端目录里有可用描述未被使用。
- **原因**：直接原因：`ToolPolicyItem` 无 description（C1），页面选错字段（C3）。根本原因：工具说明文案来源未统一（服务 vs 前端目录）。
- **影响**：用户看不出工具具体做什么（尤其 `workspace.exec` 等高风险工具），决策信息不足。
- **建议**：契约补 `description` 并在服务端返回；过渡期用 `MANAGED_MCP_TOOLS.description` 兜底；保留标题作 tooltip。
- **验证**：静态。
- **关联状态**：`tools, project`

### P19-04: B-14 Skill 原文视图细节未对齐（无行数/说明/语法配色/seg 形态）
- **严重度**：P3
- **维度**：S / T / V
- **类别**：状态 / 文案 / 样式
- **设计依据**：`tools.html:195-201`（原文头“Markdown 原文 · N 行 · 自动换行”“行号不随复制带出”、行号列与 Markdown 语法高亮 `.bx-ln .k/.m`）、`:209`（seg：阅读视图 / 原文（带行号），正文为空时禁用原文）、`:202-205`（复制原文、不含行号）
- **实现位置**：`apps/web/src/pages/node/ReadableText.tsx:32-48`（查找/关闭自动换行/“原文|格式化阅读”按钮/复制；原文 `<pre>` 渲染行号 `reader-line-number` + 文本，复制 `navigator.clipboard.writeText(text)`）、`SkillsView.tsx:37`（复用 ReadableText，mediaType=markdown）
- **差异**：原文模式、行号、复制不含行号（按钮复制原始 text）已具备；缺“Markdown 原文 · N 行 · 自动换行”计数头、“行号不随复制带出”说明、frontmatter/标题的语法配色，以及设计的分段控件形态（实现是工具条按钮 + 自动换行开关）。
- **原因**：直接原因：复用 node 阅读器组件，按通用阅读器而非 B-14 专用呈现（C4/C7）；行数/说明未加（C3）。
- **影响**：B-14 的“带行号原文”体验细节缺失，用户不知道行数与复制规则。
- **建议**：Skill 原文视图增加行数头与说明；对 Markdown 原文做 frontmatter/标题着色（使用主题令牌）；按设计用“阅读视图/原文”分段控件。
- **验证**：静态；需GUI确认配色与四主题。
- **关联状态**：`skill-raw, skill-empty`

### P19-05: Skill 读取失败/空正文文案弱化，未提示“目录仍可用/如何补充”
- **严重度**：P3
- **维度**：T / S
- **类别**：文案 / 状态
- **设计依据**：`tools.html:143`（“Skill 正文读取失败 / OpenCode 的 Skill 服务暂时不可用（OPENCODE_SKILLS_UNAVAILABLE）。目录仍可浏览。”+ 重试）、`:218`（“文档读取失败，请重试 / 左侧目录仍可使用，可以先阅读其他 Skill”，`role="alert"`）、`:220`（空正文：“文件已读取成功，但没有正文内容。需要补充时，请在 <path> 中编辑。”）
- **实现位置**：`SkillsView.tsx:23`（目录错误 ServiceNotice）、`:37`（正文错误 ServiceNotice；空正文 EmptyState“目录仍可浏览，当前文件没有可显示的正文。”）
- **差异**：实现用通用错误组件与通用描述，缺设计“目录仍可浏览/可先读其他 Skill”的引导、`OPENCODE_SKILLS_UNAVAILABLE` 能力说明与空正文“文件已读取成功/请在 path 中编辑”的可操作指引。
- **原因**：C3（文案未按设计）+ C2（未区分“目录失败”与“正文失败”的提示内容）。
- **影响**：失败时用户不知道还能继续做什么；空正文时不知道如何补充。
- **建议**：按设计分别定制目录失败/正文失败/空正文文案与操作（重试、继续读其他 Skill、去 path 编辑）。
- **验证**：静态；需GUI。
- **关联状态**：`skill-error, skill-empty, skill-read-fail`

### P19-06: 页签计数语义与设计不同，且新增设计外“最近读取 OpenCode 状态”行
- **严重度**：P3
- **维度**：T / 结构
- **类别**：文案 / 结构
- **设计依据**：`tools.html:228`（页签“工具 7”“Skill 3”）
- **实现位置**：`ToolsPage.tsx:43-49`（“工具 {MANAGED_MCP_TOOLS.length}”=13、“Skill 只读”）、`:52-54`（“最近读取 OpenCode 状态：…”，设计无此行）
- **差异**：设计页签显示工具/Skill 数量；实现工具显示受管 MCP 工具总数（13，与当前来源工具数不同），Skill 显示“只读”而非数量；另加设计没有的最近读取时间行。
- **原因**：C3（计数语义）+ C4（新增说明行）。
- **影响**：“工具 13”与来源侧栏合计可能不一致，用户误解；页面多一行非设计信息。
- **建议**：页签计数取当前策略视图的实际工具总数（或去掉数字）；Skill 显示目录数量；最近读取时间移到页头 hint 或删除。
- **验证**：静态。
- **关联状态**：`tools, skills`

### P20-01: 五种扩展类型缺少可用驱动，B-13 的 4 个设计状态静态不可达（C9 能力缺口）
- **严重度**：P1
- **维度**：S / D
- **类别**：状态 / 数据契约 / 范围
- **设计依据**：`databases.html:152-225`（B-13：`og-new` 新增 openGauss、`dm-probe` 达梦检查通过（只读待核实）、`db2-fail` DB2 检查失败、`:142-146` SQL Server 检查通过三格；`originals/main/index.html:171` B-13“五种扩展类型的编辑呈现：openGauss / GaussDB / GoldenDB / 达梦 / DB2 类型与只读强制三态”）
- **实现位置**：`packages/shared/src/config/settings.ts:263-275`（`driver`: mysql/mariadb/goldendb→mysql2、postgresql→pg，其余 `planned`）；`packages/server/src/http.ts:1360`（`available: meta.driver !== 'planned'` + 缺驱原因）、`:1391`（保存拒绝 planned 类型）；`DatabasesPage.tsx:787-800`（类型选项禁用 + “（未提供驱动）”/“当前未提供驱动，不能检查或保存”）
- **差异**：设计 B-13 默认五种扩展类型都有内置驱动（openGauss `opengauss-jdbc-6.0.0.jar`、GaussDB、达梦 `DmJdbcDriver18`、DB2、GoldenDB），并可编辑/检查/保存；当前服务只接通 MySQL/MariaDB/GoldenDB/PostgreSQL，SQL Server/openGauss/GaussDB/Oracle/达梦/DB2 全部 planned：`og-new`（新增 openGauss）、`dm-probe`（达梦检查）、`db2-fail`（DB2 检查失败）、`probe-ok`（SQL Server 检查通过）在设计稿中无法出现；`gd-edit`（GoldenDB）可呈现。实现**诚实降级**（禁用 + 原因 + 不伪造成功），且 `docs/review/design-parity-acceptance-2026-10-20.md:41`、`docs/verification/2026-10-20-database-draft-scope.md` 已登记“planned 驱动明确缺能力”，属 C9 范围。
- **原因**：直接原因：服务只提供 mysql2/pg 驱动与封闭 JDBC 适配（C1）。根本原因：B-13 的厂商驱动/兼容性未纳入本期实现范围（C9 已登记），设计页与实现范围未同步调整。
- **影响**：设计与产品能力不一致；B-13 验收无法按状态逐项通过；用户看到“类型存在但不能用”，需要明确“后续里程碑”说明。
- **建议**：二选一——①补厂商驱动/联通性验证并开放对应类型；②与设计确认把 B-13 降级为“类型清单/缺驱原因呈现”（当前已实现），在设计与验收矩阵中显式标注“驱动未提供/后续分期”，避免按原状态验收。
- **验证**：静态已确认 planned；真实驱动/实例验证需外部环境（E22 边界：不得用 pg 冒充）。
- **关联状态**：`og-new, dm-probe, db2-fail, probe-ok, gd-edit`

### P20-02: 归档/停用/版本与“已归档”视图缺失，删除替代了设计的可恢复归档
- **严重度**：P2
- **维度**：A / 结构 / D
- **类别**：交互 / 结构 / 数据契约
- **设计依据**：`databases.html:71-74`（归档确认：“归档后它会被停用，并从默认列表中隐藏，新任务不能再使用它。已经冻结了这个连接的任务继续使用当时的配置”）、`:93`（分段：未归档/已启用/已停用/已归档）、`:113-114`（抽屉头“版本 v7”+“更多”菜单：停用/启用/归档…）、`:185`（`legacy-type` 卡片“历史类型 · 只能查看”）
- **实现位置**：`DatabasesPage.tsx:569-579`（“删除”按钮 + `window.confirm`，不可恢复）、`:633-649`（工具条只有搜索 + 类型分段，无状态/归档筛选）、`:677-687`（抽屉头只有标题，无版本 badge/更多菜单）；契约 `packages/shared/src/config/settings.ts:4-20`（`DatabaseConnectionConfig` 无 `archived`/`version` 字段）、`packages/shared/src/domain/models.ts:1327-1345`（`DatabaseConnection` 无 archived/version）
- **差异**：设计的连接生命周期是“启用/停用 ↔ 归档（隐藏、保留冻结配置、可恢复）”，并展示连接版本；实现只有启用开关与“删除”（永久），列表没有已归档视图，也没有版本号；设计“已归档连接同样只能查看”分支无法表达。
- **原因**：直接原因：契约无 archived/version，服务无归档端点（C1）；前端用删除替代（C5）。根本原因：连接生命周期未按设计建模（C1/C6）。
- **影响**：用户想“暂时下线但保留配置/冻结任务仍可用”时只能删除，不可恢复；审计/版本核对缺少依据；设计验收项无法通过。
- **建议**：契约加 `archivedAt/version` 与 archive/restore 端点（带 requestKey/回执），列表加状态分段与已归档视图；删除保留但需与设计确认。
- **验证**：静态；归档/恢复/冻结任务行为需真实服务 + GUI。
- **关联状态**：`list, edit, legacy-type`

### P20-03: 列表筛选维度与设计不同（以类型分段替代状态/归档分段）
- **严重度**：P2
- **维度**：结构 / A
- **类别**：结构 / 状态映射
- **设计依据**：`databases.html:90-94`（搜索名称/主机 + 数据库类型下拉 + 状态分段“未归档/已启用/已停用/已归档”带计数）
- **实现位置**：`DatabasesPage.tsx:633-649`（搜索“名称、主机或库” + `SegmentedControl` 类型分段“全部类型 + 每种类型计数”）+ `:323-338`（typeFilter/keyword 过滤）
- **差异**：设计按“启用/停用/归档”状态筛选，类型是下拉；实现把类型做成主分段、没有启用/停用/归档筛选，也没有“未归档”概念。
- **原因**：直接原因：因归档字段缺失（P20-02）无法做状态分段，改用可用的类型维度（C1/C4）；根本原因：筛选模型未按设计落地（C6）。
- **影响**：无法快速筛出“已停用/未检查/未归档”连接，管理多连接时效率低；与设计信息架构不同。
- **建议**：补状态分段（未归档/已启用/已停用/已归档）与计数；类型保留为下拉或次级筛选，二者可叠加。
- **验证**：静态；需GUI。
- **关联状态**：`list`

### P20-04: 检查三格位置不符，且“只读已强制”数据来自会话只读测量，“待核实”三态不可产生
- **严重度**：P2
- **维度**：结构 / D / C
- **类别**：结构 / 数据语义 / 数据契约
- **设计依据**：`databases.html:137-147`（编辑抽屉“连接检查”区：检查按钮 + 三格 `已连接`/`会话只读`/`只读已强制`，“只读已强制 由连接设置保证”，“现场兼容性尚未验证”；SQL Server 时“会话只读：数据库未开启会话只读”）、`:220-224`（达梦：已连接/会话只读 已确认/只读强制待核实，“检查结果未包含这一项，不能视为已强制只读”）
- **实现位置**：`DatabasesPage.tsx:501-523`（三格在**列表卡片**上；“只读已强制”取 `feedback?.probe?.readOnlyEnforced`）、`:155-194`（抽屉草稿探针为 banner 风格，非三格）、`:187-189`（ProbeFeedbackView 内“只读强制：已强制/待核实”）；服务 `packages/database/src/service.ts:147-156`（`readOnlyEnforced: measurement.sessionReadOnly`，与 `sessionReadOnly` 同值）
- **差异**：①设计三格在编辑抽屉“连接检查”区，实现在列表卡片上、抽屉内只有 banner；②设计“会话只读”（运行时）与“只读已强制”（配置保证）是独立事实，实现把 `readOnlyEnforced` 直接赋值为 `sessionReadOnly` 的副本，无法出现“会话只读已确认、只读强制待核实”的设计状态；③“由连接设置保证”的说明缺失。
- **原因**：直接原因：服务只测量会话只读，没有独立的强制只读证明（C1），字段被复用（C6）；前端把三格放在卡片（C4）。根本原因：只读保障模型未按设计拆成“运行时只读/配置强制”两层（C1/C6/D）。
- **影响**：用户可能把“会话只读测量”当作“只读已强制”的证据；设计 B-13 的“只读强制三态”无法呈现；探针结论位置与设计不一致。
- **建议**：服务端分别提供 `sessionReadOnly` 与 `readOnlyEnforced`（后者来自 SQL 守卫/连接配置证明，缺失时 undefined）；前端把三格移入抽屉连接检查区（卡片保留摘要），并按设计显示“由连接设置保证/待核实”。
- **验证**：静态；SQL Server/达梦真实实例不可用，需真实服务 + GUI。
- **关联状态**：`probe-ok, dm-probe, probe-fail, list`

### P20-05: “保存结果未明”覆盖有限，且未知时关闭抽屉被静默拦截
- **严重度**：P2
- **维度**：S / A / K
- **类别**：状态 / 交互 / 数据契约
- **设计依据**：`databases.html:118`（保存结果未明 banner：“请求已发出但没有收到确认。表单已锁定，正在逐页读取全部连接，核对这一条是否已更新为 v8。确认前不会重新保存。”）、`:115`（关闭按钮 disabled + title“结果确认前不能关闭”）、`:134-135`（footer“结果确认前不能再次保存”/保存按钮“核对中”）
- **实现位置**：`DatabasesPage.tsx:239-265`（保存 mutation 只把网络类错误视为 unknown）、`:614,723`（未知 banner + 核对原请求）、`:682-686`（`onClose` 在 `saveUnknown` 时直接 return，无提示）、`:696-717`（footer 按钮 disabled，但标题仍为“保存连接/结果未知”）；服务 `packages/server/src/http.ts:1367-1433`（同步 settle，返回 succeeded/failed，不产生 unknown receipt）
- **差异**：①服务端保存接口是同步的，不返回 accepted/unknown 回执，设计“保存结果未明”只能由客户端网络失败模拟；②设计“逐页读取全部连接核对这一条是否已更新”的说明与进度缺失；③未知时关闭抽屉（X/遮罩/Esc）被静默拦截，没有“结果确认前不能关闭”的可读原因（`Drawer.tsx` 关闭按钮无 disabled 状态）。
- **原因**：直接原因：保存端点同步返回（C1/契约差异），前端只做网络未知兜底（C2）；关闭拦截未给原因（C8/C3）。根本原因：设计假设异步保存回执，服务实现为同步写。
- **影响**：用户不知道保存是否生效、为何关不掉抽屉；与设计“结果未明锁定”语义不完全一致。
- **建议**：在抽屉内显示未知说明与“不可关闭”原因（禁用关闭按钮并给 title/aria-describedby）；补“正在重新读取全部连接核对”的进度/结果；若服务保持同步，请设计确认仅按网络未知兜底。
- **验证**：静态；丢响应场景需真实服务/代理 + GUI。
- **关联状态**：`save-unknown`

### P20-06: `legacy-type` 与 planned 驱动混同，历史类型被禁止检查连接
- **严重度**：P2
- **维度**：S / A / T
- **类别**：状态 / 交互 / 文案
- **设计依据**：`databases.html:166-167`（`bxTypes()`：历史类型状态里服务**不再返回** ORACLE）、`:234-240`（view 模式：类型显示“历史类型”badge + banner“服务当前的类型清单不包含 X。可以查看配置和检查连接；已归档的连接同样只能查看”）、`:257-259`（footer：关闭 + 编辑 disabled“历史类型或归档连接不能编辑”）
- **实现位置**：`DatabasesPage.tsx:739`（`!supportedTypes.includes(form.type)` → banner“此类型不在服务提供的驱动清单中；历史连接只能查看。”）、`:740`（`fieldset disabled`）、`:696-717`（保存/检查草稿按钮均 `disabled={!canSave}`，`canSave` 依赖 `supportedTypes.includes(form.type)`，`:380`）
- **差异**：设计“历史类型”= 服务类型清单不再返回该类型（配置仍可查看，且**允许检查连接**），与“有类型但缺驱动（planned）”是不同语义；实现把两者合并为“不在驱动清单”，且检查草稿被一并禁用；无法表达“类型清单不再返回”这一服务状态。
- **原因**：直接原因：类型清单恒返回全部 `DATABASE_TYPE_META`（`http.ts:1360`），没有“服务不再返回”的字段（C1）；检查按钮与保存共用 `canSave` 条件（C6）。根本原因：legacy 类型与缺驱动能力未区分建模（C1/C6）。
- **影响**：历史连接（如旧 Oracle）无法按设计重新检查；用户看到“此类型不在驱动清单”而非“服务已不提供该类型”的真实原因。
- **建议**：类型清单增加 `legacy/historical` 标记或“服务已移除”字段；view 模式允许“检查连接”（仅探针、不保存）；banner 文案区分“类型已不再提供”与“驱动未提供”。
- **验证**：静态；历史类型真实配置需真实服务 + GUI。
- **关联状态**：`legacy-type`

### P20-07: 编辑/新增抽屉宽 520 而非 600，表单分区与设计不一致
- **严重度**：P3
- **维度**：结构 / V
- **类别**：结构 / 样式
- **设计依据**：`databases.html:66`（`aside class="drawer xl"`，`--drawer-xl:600px` 见 `originals/main/assets/ds.css:88`）、`:119-133`（分区：连接 / 访问范围（schema 用 tagin chips + 授权项目）/ 查询限制（超时 1–30、行数 1–1000）/ 连接检查）
- **实现位置**：`DatabasesPage.tsx:677-687`（`size="lg"`=520px）、`:721-928`（JDBC 可选粘贴、名称/类型/主机/端口/库/用户/密码/SSL、访问范围 comma 输入 + 可读表 + 绑定项目 + 启用、无每连接查询限制、信息条）、`:914-920`（访问范围）
- **差异**：抽屉宽 520 vs 设计 600；schema/表用逗号输入而非 chip 标签输入；缺每连接“查询限制（超时/行数）”，页面改为全局查询限制卡；多出 SSL 与“可读表”字段（设计未展示，产品扩展）；“连接检查”在 footer 作为“检查草稿（不保存）”按钮，设计在表单分区内。
- **原因**：直接原因：复用 `Drawer` lg 尺寸与通用表单（C7/C4）；每连接限制无契约（C1）。根本原因：抽屉信息架构未按设计落地。
- **影响**：细节观感与交互成本不同；chip 输入更易校验但实现为文本解析；大表单在 520 宽下更拥挤。
- **建议**：抽屉改 `size="xl"`（600）；schema/表改 chip 输入；“连接检查”放回表单分区；每连接查询限制确认是否进契约，否则在页面标题说明全局限制。
- **验证**：静态；需GUI确认宽度/输入体验。
- **关联状态**：`edit, new`

### P20-08: `types-fail` 不可独立出现（类型与连接同一接口）
- **严重度**：P3
- **维度**：S / 结构
- **类别**：状态 / 数据契约
- **设计依据**：`databases.html:188-190`（类型清单读取失败 banner：“连接列表仍可查看。重新读取成功前，不能添加或编辑连接。”）
- **实现位置**：`DatabasesPage.tsx:206`（`typeQuery` 与列表同一 `GET /api/settings/databases`）、`:651`（typeQuery 错误 ServiceNotice）；服务 `packages/server/src/http.ts:1358-1361`
- **差异**：设计允许“类型清单失败但连接列表可用”；实现两数据同接口，通常一起失败，无法出现设计态；只有第二次重复请求失败时 typeQuery 才单独报错。
- **原因**：直接原因：服务把 types 与 connections 合并在同一响应（C1）。根本原因：类型清单没有独立端点/缓存（C1）。
- **影响**：类型失败的真实状态无法按设计呈现；编辑禁用逻辑依赖 `supportedTypes` 为空间接实现。
- **建议**：拆独立类型清单端点或在响应中保留上次成功 types；前端 typeQuery 失败时禁用添加/编辑并保留连接列表（当前部分具备）。
- **验证**：静态。
- **关联状态**：`types-fail`

### P20-09: 卡片视觉与密度偏离（2 列 vs 3 列、引擎色块、停用降透明、加载更多）
- **严重度**：P3
- **维度**：V / 结构
- **类别**：样式 / 结构
- **设计依据**：`databases.html:12-18`（`.dgrid` 3 列、≤1180 2 列；`.dc.off{opacity:.7}`；`.eng` 按引擎配色：MySQL 琥珀、SQL Server 粉、PostgreSQL 蓝，标签 MY/MSSQL/PG）、`:104`（“已加载 4 个连接”+“加载更多”）
- **实现位置**：`DatabasesPage.tsx:427`（`grid-2`：固定 2 列）、`:436-438`（通用 `db` 图标 + 类型 Badge 代替引擎色块）、`:434`（未对停用连接加降透明）、`:648`（“共 N 个连接”，无加载更多）
- **差异**：设计 3 列密集网格、按引擎着色的标识块、停用卡片降透明、分页加载更多；实现 2 列、通用图标、无降透明、无分页（一次性加载）。
- **原因**：直接原因：使用全局 `grid-2` 与通用组件（C7/C4）；根本原因：卡片视觉未按设计细化（C7）。
- **影响**：信息密度与设计不同；连接多时纵向滚动更长；停用连接不够明显。
- **建议**：使用 3 列网格（≤1180 两列）；引擎标识块用类型色（主题 token）；停用卡片降透明；确认是否需要分页（当前接口全量返回）。
- **验证**：静态；需GUI确认四主题配色。
- **关联状态**：`list`

### P20-10: 设计外新增只读查询抽屉、删除连接、全局查询限制卡等区块
- **严重度**：P3
- **维度**：结构
- **类别**：结构 / 范围
- **设计依据**：设计 `databases.html` 只有列表/空/编辑/新增/检查/保存未知与 B-13 六态，无“只读查询”抽屉、删除按钮、页面级“查询限制”三卡、可读表/SSL 字段（`:119-136,275-277`）
- **实现位置**：`DatabasesPage.tsx:931-1084`（只读查询抽屉）、`:569-579`（删除）、`:654-675`（查询限制三卡）、`:882-896`（SSL）、`:914-920`（可读表）
- **差异**：实现新增多个设计与契约没有的功能区块；能力本身由真实服务支撑（`/api/settings/databases/:id/query`），不伪造数据。
- **原因**：直接原因：产品为运维/调试补充能力（C4 产品扩展），设计未覆盖（C9）。
- **影响**：页面比设计更重；需要设计/产品确认是否保留；删除与归档语义冲突（P20-02）。
- **建议**：保留但需设计确认并在设计系统登记；删除与归档二选一或明确两者差异（删除不可恢复需二次确认文案更明确）。
- **验证**：静态；需GUI。
- **关联状态**：`list, edit`

### P20-11: `gd-edit` 缺“已切换驱动/地址已清空”提示与驱动信息
- **严重度**：P3
- **维度**：T / S
- **类别**：文案 / 状态
- **设计依据**：`databases.html:202-212`（切换类型清空 URL 后提示“已清空，请重新填写。”；类型信息“已内置 X 驱动 · <jar 文件名>”“完整兼容性：待现场版本联调”“测试和保存将使用上述驱动；保存后供新会话使用，历史任务保留原驱动”）、`:237-244`（GoldenDB 按 MySQL 协议地址填写）
- **实现位置**：`DatabasesPage.tsx:782-785`（切换类型：`updateForm({ type, port, host: '', database: '' })`，无提示）、`:794-800`（只显示 `urlExample` 与“类型和驱动由服务提供”）、`:873-880`（密码提示）
- **差异**：GoldenDB 可编辑，但切换类型清空地址后没有“已清空，请重新填写”警示；没有驱动文件名/兼容性/“历史任务保留原驱动”的说明（服务类型清单无驱动清单字段）。
- **原因**：直接原因：服务类型清单只有 `driver: mysql2|pg|planned`（C1），无 JDBC 驱动名/兼容性；前端未补清空提示（C3）。
- **影响**：用户切换类型后不知道地址被清空，容易保存空值失败；GoldenDB 与 MySQL 协议差异无提示。
- **建议**：切换类型时显示“已清空连接地址，请重新填写”；若服务补充驱动清单则展示 jar 与兼容性；至少对 GoldenDB 显示“按 MySQL 协议填写”。
- **验证**：静态；需GUI。
- **关联状态**：`gd-edit, new`

## 已核对一致

- **运行环境真实数据**：状态卡/三事实卡/操作历史全部来自 `GET /api/opencode/status`（`packages/server/src/http.ts:1547-1586`）与 `/api/opencode/operations`（`packages/server/src/runtime-operations.ts:5-7`），包括受管归属、版本、监听地址、PID、受管代次、模型、Agent、内部 MCP 名称/连接/工具数、最近错误；无示例数据。
- **启动/重启安全链路**：受管校验、显式 `confirmStart/confirmRestart`、维护锁、活动/待核对会话拒绝重启（`runtime-operations.ts:14-31`）、回执 settle 与失败记录；前端按钮在服务未连接/状态读取失败/外部进程/启动中/未知状态下禁用并给出可读原因（`RuntimePage.tsx:75-87`）。
- **运行时 UNKNOWN 只读核对**：`RuntimeControls.tsx:20-45` 保留原 requestKey、unknown 时显示“核对原请求”、`operations/by-key` 查询，不自动重发；历史列表只展示手动启动/重启，不把自动拉起伪装为手动操作（`:46`）。
- **外部进程只读**：`managed=false` 时不提供重启（`RuntimePage.tsx:73,81-82,137-139`），与设计“外部进程不受管理”一致。
- **工具配置范围**：配置范围 select 通过 `PageHeaderSlot` 注入共享页头（`ToolsPolicyView.tsx:67-69`、`apps/web/src/components/PageHeaderSlot.tsx:4-9`），与设计“页头范围选择”一致；“项目设置优先于全局默认”“只影响新建会话，运行中的会话保持原权限”chip 均在（`:78`）。
- **工具三态与生效值**：项目视图“继承/启用/停用”（`:84`）、全局 switch（`:84`）、生效说明“继承全局：启用/项目明确启用 · 全局为启用/全局启用 + 项目明确覆盖清单”（`:85`）、内置工具锁定“内置，始终启用”（`:84`）与设计一致。
- **工具策略回执/持久身份**：`tool-policy-command.ts:1-11` 从持久命令恢复原身份，UNKNOWN 期间锁定配置范围/来源/开关/整体停用，只按原 key 核对（`ToolsPolicyView.tsx:24-31,38,53-63`），与设计“确认前不能修改其他工具或切换范围”一致（E36 有真实 CUA 证据）。
- **停用来源**：整体停用前弹窗列出该来源全部工具名、说明“新建会话停用/运行中会话不受影响/之后可逐个重新启用”，并区分全局与项目（`ToolsPolicyView.tsx:90-93`）。
- **Skill 只读**：Skill 目录/搜索/路径/只读徽标“只读 · 阅读不会执行 Skill”与设计一致（`SkillsView.tsx:29-36`、`tools-policy.css:1-33`）；Markdown 阅读隐藏 YAML frontmatter（`SkillsView.tsx:37` 的 `markdownText` 正则）；原文带行号且复制不含行号（`ReadableText.tsx:42-43,48`）满足 B-14 的核心“行号不随复制带出”。
- **Skill 错误/空/加载**：目录加载/错误/空、正文加载/错误/空都有明确状态且无伪造正文（`SkillsView.tsx:22-24,37`）。
- **数据库真实连接数据**：列表来自 `GET /api/settings/databases`（`packages/server/src/http.ts:1358-1361`），类型清单、可用性、缺驱原因由服务返回并在 UI 标注（`DatabasesPage.tsx:787-800`）；错误态明确“不展示示例连接”（`:394-407`）。
- **数据库事实卡**：可读范围（schema/表）、授权项目（无绑定 warn“任务读不到它”+ 查询需项目/职业/节点/会话只读说明）、最近检查（状态/时间/会话只读）与设计一致（`DatabasesPage.tsx:475-499`）。
- **检查三格**：已连接/会话只读/只读已强制三格与“未确认不能视为只读”的说明在列表卡片实现（`:501-523`）；草稿探针不保存、修改后清旧结果、迟到响应代次隔离（`:226-237,360-377`）；服务把失败映射为认证失败/不可达/类型不支持（`packages/database/src/service.ts:145-200`、`apps/web/src/pages/databases/DatabasesPage.tsx:45-51`）。
- **数据库授权/范围**：schema 必填、表白名单可选、未绑定项目任务不可发现、未授权项目/会话只读限制说明与设计一致（`DatabasesPage.tsx:914-920`、`:481-487`）。
- **密码与凭据**：密码不回显、编辑留空保留（目标不变才保留）、切换目标需重填，服务端提示与设计一致（`DatabasesPage.tsx:863-880`、`packages/server/src/http.ts:1398-1404`）。
- **保存回执与未知锁定（网络场景）**：`saveUnknown` 锁表单、保留原请求号、核对原请求、`operations/by-key` 只读核对（`DatabasesPage.tsx:239-265,381-389,614,723`）。
- **只读查询（产品扩展）**：查询接口真实（`packages/server/src/http.ts:1480-1486`）、错误/截断/行数/耗时展示，无示例结果（`DatabasesPage.tsx:931-1084`）。
- **主题令牌**：runtime/tools/databases 三目录 CSS 与 TSX 中无硬编码颜色（grep `#hex/rgba` 无命中），新增组件均使用 `var(--*)`。
- **诚实降级（非缺陷）**：planned 驱动类型明确禁用并给原因、不冒充驱动（C9，见 P20-01）；外部 MCP 来源清单不完整时禁止修改（C9）。

## 需 GUI / 运行验证

1. 四主题（deepseek/warm/spdb/github-white）与 1440/1280/1024 下三页布局：运行环境三事实卡（1.35/1/1 → 单列）、工具双栏 300px、数据库 2/3 列与抽屉宽度（520/600）。
2. 运行环境异常态：停止/启动失败的真实 banner 与 `lastError` 呈现；`read-error` 时旧数据是否被误当当前状态；未知状态的禁用按钮与“重新读取”路径。
3. 启动/重启完整 GUI：确认对话框、发送中→启动中→已就绪、重启后 PID/代次变化与历史记录（E31 已有真实进程证据，本轮未复跑）。
4. 重启结果未明（丢响应代理）时的页面级锁定/离开提醒/核对原请求（服务回归有覆盖，GUI 未验）。
5. 工具页：外部 MCP 来源（partial/等待授权）真实呈现、来源整体停用确认、项目继承三态与生效值、UNKNOWN 跨刷新原 key 恢复（E36 有 CUA 证据，本轮未复跑）。
6. Skill：原文模式行号/复制（确认系统剪贴板不含行号）、空正文/正文读取失败文案、Markdown frontmatter 隐藏与四主题代码配色。
7. 数据库：可用驱动（MySQL/PG/GoldenDB）真实连接的检查三格、失败/超时重检、保存网络 UNKNOWN 的锁定与关闭行为、planned 类型禁用项与提示。
8. 数据库抽屉在 520 宽下的字段密度与长名称/长 schema/长地址溢出；删除确认与冻结任务行为。

## 未覆盖 / 说明

- 本轮**未运行 Web GUI、未重跑 E31/E21/E36/E22 的 live/CUA 证据**，V 维度与真实交互均为静态推断或需 GUI；未做像素级对比。
- 未覆盖真实外部 MCP（授权/等待/超时 partial）与真实 SQL Server/openGauss/GaussDB/Oracle/达梦/DB2 实例（无驱动/无实例，不得冒充通过；E22 已登记边界）。
- 未覆盖归档/恢复/冻结任务在真实服务中的行为（服务与契约均无归档概念，见 P20-02）。
- 运行环境 `degraded` 状态、bootstrap 状态与 OpenCode 进程状态不一致时的组合未逐项验证；“离开本页提醒”依赖 GUI 导航行为。
- **文档口径（C10，供 Lead 统一记录，不占本区域主清单）**：`docs/design-coverage.md:151` 仍称“「最近一次操作」空占位；缺外部进程/启动失败态（P2）”（当前 `RuntimeControls.tsx` 已有真实操作历史与 unknown 处理、`RuntimePage.tsx:167-176` 有外部进程态）；`:152` 仍称“项目级工具配置、单工具策略、来源级停用…无接口”（当前 `packages/shared/src/domain/access.ts:3-19`、`ToolsPolicyView.tsx:67-93` 均已实现）；`:153` 仍称“多 schema/表级范围、项目授权、会话只读…无契约”（当前 `DatabaseConnection` 有 schemas/tables/projectIds/sessionReadOnly，见 `packages/shared/src/domain/models.ts:1327-1345`）；`docs/remaining-work.md:30` 的“数据库授权/多 schema/会话只读，工具项目级/单工具策略…仍缺”同样已过时。`docs/verification/2026-10-20-database-draft-scope.md` 的“planned 驱动明确缺能力”与当前实现一致（见 P20-01），保留。
- 本区域未发现实现违背“明确不开放/不可误实现”清单的项；`planned` 驱动、外部 MCP 清单不完整均属已登记的诚实降级。
