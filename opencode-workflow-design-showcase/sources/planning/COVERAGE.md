# COVERAGE · 状态 → 正常入口 → 截图 → 所需 DTO/API → 业务事实

> “设计完成”只表示原型可走通、字段与状态齐全；**所有条目的业务实现都尚未开始或仅部分已有**，需按 ACCEPTANCE-AND-PHASES.md 另行取证。“main 已有 / 部分已有”只引用需求包 BASELINE-AND-SOURCES 的 main 事实，本稿未运行产品核验。

## 1. PE 状态覆盖

| ID | 名称 | 正常入口（不依赖状态切换条） | 截图 | 所需 DTO / API | 业务事实 | 分期 |
|---|---|---|---|---|---|---|
| [`pe01`](prototype/start.html?state=pe01) | 开始任务 · 普通方法选择 | 左侧「开始任务」 | [图](design/deepseek-pe01.png) | workflow.definitions.list/read（扩展：PlanningPolicyBinding 摘要 + AI 规划可用性/原因）；requirements.create（不变，不派模型） | 部分已有 | P1/P2 |
| [`pe02`](prototype/requirement.html?state=pe02) | 需求画布 · 空草稿 | 开始任务 → 形成需求草稿；任务列表 / 需求目录 → 该任务 | [图](design/deepseek-pe02.png) | requirements.read；planning.read（actions：generate/materialize 的 enabled + reason） | 部分已有 | P1 |
| [`pe03`](prototype/requirement.html?state=pe03) | 规划预览（确认开始前） | 需求画布 → 生成计划 / AI 细化计划 | [图](design/deepseek-pe03.png) | planning.preview（只读 POST）→ PlanningPreview；planning.round.create（previewHash + approvedBudgetHash） | 候选 · 未实现 | P1/P2 |
| [`pe04`](prototype/requirement.html?state=pe04) | 配置 / 依据不足（生成禁用） | 规划预览返回 issues | [图](design/deepseek-pe04.png) | PlanningPreview.issues[]（code / remediation）；actions.generate.reason | 候选 · 未实现 | P1 |
| [`pe05`](prototype/requirement.html?state=pe05) | 规划中 · 准备输入 | 规划预览 → 确认开始 | [图](design/deepseek-pe05.png) | planning.round.read（phase=preparing）；planning.records.read；events planning.phase.changed | 候选 · 未实现 | P1 |
| [`pe06`](prototype/requirement.html?state=pe06) | 生成候选 · 运行时无公开正文 | 模拟服务事件（运行时未提供公开正文 producer） | [图](design/deepseek-pe06.png) | planning.records.read（kind=service-phase / tool-*）；capability：publicText=false | 候选 · 未实现 | P1 |
| [`pe07`](prototype/requirement.html?state=pe07) | 生成候选 · 公开正文与工具 | 模拟服务事件；任务列表 → 该任务 | [图](design/deepseek-pe07.png) | planning.records.read / content.read；工具 lifecycle（callId 原位更新） | 候选 · 未实现 | P1 |
| [`pe08`](prototype/requirement.html?state=pe08) | 部分草稿（检查点） | 模拟服务事件（draft.published） | [图](design/deepseek-pe08.png) | DraftCheckpoint（coveredRequirementKeys / groupOutline / partialNodes / unresolvedScopes） | 候选 · 未实现 | P2 |
| [`pe09`](prototype/requirement.html?state=pe09) | 程序检查中 | 模拟服务事件（候选已提交） | [图](design/deepseek-pe09.png) | PlanningValidation（逐层进度）；planning.validation.completed | 候选 · 未实现 | P2 |
| [`pe10`](prototype/requirement.html?state=pe10) | 有界修订中（1/1） | 模拟服务事件（validating → revising） | [图](design/deepseek-pe10.png) | PlanningRunV1.generation / maxRepairs；Issue.autoRepairable | 候选 · 未实现 | P2 |
| [`pe11`](prototype/requirement.html?state=pe11) | 需要你答复 | 任务列表“需要处理”/ 待处理中心 | [图](design/deepseek-pe11.png) | run.state=needs_input；questions / assumptions（影响节点、来源）；planning.input.save | 候选 · 未实现 | P2 |
| [`pe12`](prototype/requirement.html?state=pe12) | 预算 / 时限 / 次数达到 | 模拟服务事件（PLANNING_LIMIT_REACHED） | [图](design/deepseek-pe12.png) | run.state=needs_input + Issue(PLANNING_LIMIT_REACHED)；usage.known/reserved/unknown | 候选 · 未实现 | P2 |
| [`pe13`](prototype/requirement.html?state=pe13) | 规划中补充（未纳入本轮） | 规划中 → 草稿与问题 → 补充需求 → 保存 | [图](design/deepseek-pe13.png) | planning.input.save → InputRevision（未绑定当前 run） | 候选 · 未实现 | P2 |
| [`pe14`](prototype/tasks.html?state=pe14) | 任务列表 · 规划状态 | 左侧「任务列表」 | [图](design/deepseek-pe14.png) | tasks.list 投影：planning 摘要（state/phase/lastActivityAt/needsAction） | 候选 · 未实现 | P1 |
| [`pe15`](prototype/requirement.html?state=pe15) | 返回 · 按游标补读 | 任务列表 / 需求目录 / 待处理 → 该任务 | [图](design/deepseek-pe15.png) | planning.round.read + records.read(afterCursor) ；eventId/sequence 去重 | 候选 · 未实现 | P1 |
| [`pe16`](prototype/requirement.html?state=pe16) | 断连 / 重连 | 本页与服务的连接中断 | [图](design/deepseek-pe16.png) | 客户端连接投影 live/disconnected/catching_up/gap（不改 run.state） | 候选 · 未实现 | P1 |
| [`pe17`](prototype/requirement.html?state=pe17) | 不可补的记录缺口 | 补读时服务返回 gaps[] | [图](design/deepseek-pe17.png) | records.read → gaps[{from,to,reason,recoverable:false}] | 候选 · 未实现 | P1 |
| [`pe18`](prototype/requirement.html?state=pe18) | 请求停止（确认） | 规划中 → 停止规划 | [图](design/deepseek-pe18.png) | planning.round.stop（CommandEnvelope requestKey） | 部分已有 | P1 |
| [`pe19`](prototype/requirement.html?state=pe19) | 正在停止 | 停止回执成功后 | [图](design/deepseek-pe19.png) | control=cancel_requested；process=stop_requested；accounting=open | 部分已有 | P1 |
| [`pe20`](prototype/requirement.html?state=pe20) | 已停止 | 模拟服务事件（settled） | [图](design/deepseek-pe20.png) | run.state=cancelled；process=stopped；accounting=closed + 证据 | 部分已有 | P1 |
| [`pe21`](prototype/requirement.html?state=pe21) | 停止 / 派发结果待核对 | 任务列表“待核对” | [图](design/deepseek-pe21.png) | run.state=unresolved；operations.by-key；planning.round.reconcile | 候选 · 未实现 | P1 |
| [`pe22`](prototype/requirement.html?state=pe22) | 明确失败 | 模拟服务事件（failed） | [图](design/deepseek-pe22.png) | run.state=failed + 公开错误；保留 draftRef/records | 部分已有 | P1 |
| [`pe23`](prototype/requirement.html?state=pe23) | 服务重启后核对 | 服务重启后打开该任务 | [图](design/deepseek-pe23.png) | control=reconciling；owner/session/lease/usage 核对事实 | 候选 · 未实现 | P1 |
| [`pe24`](prototype/requirement.html?state=pe24) | 原轮仅观察续接 | 核对结果：原 owner 仍在运行 | [图](design/deepseek-pe24.png) | reconcile 结果 + actions.observe（不发新 prompt） | 候选 · 未实现 | P1 |
| [`pe25`](prototype/requirement.html?state=pe25) | 候选待审阅（diff） | 任务列表“等待审阅”；规划完成 | [图](design/deepseek-pe25.png) | PlanningCandidateV1（diffHash / validationRef）；planning.mapping.inspect；candidate.apply / reject | 候选 · 未实现 | P2 |
| [`pe26`](prototype/requirement.html?state=pe26) | 候选已到 · 原进程未停稳 | 候选提交后、原调用结清前 | [图](design/deepseek-pe26.png) | run.state=running/validating + 只读 preview；originalGenerationClosed=false | 候选 · 未实现 | P2 |
| [`pe27`](prototype/requirement.html?state=pe27) | 候选硬阻塞 | 检查完成：block 级问题 | [图](design/deepseek-pe27.png) | PlanningIssue(severity=block)：循环、IO 未绑定、假引用、越权 | 候选 · 未实现 | P2 |
| [`pe28`](prototype/requirement.html?state=pe28) | 并行写冲突（设计候选 · 后续分期） | 检查完成：RESOURCE_CONFLICT | [图](design/deepseek-pe28.png) | Issue(RESOURCE_CONFLICT) + 资源域规范化；用户采纳串行 → 新 diff | 后续分期 | P2/P3 |
| [`pe29`](prototype/requirement.html?state=pe29) | 输入 / 原图 / 依据漂移 | 审阅期间输入或计划被修改 | [图](design/deepseek-pe29.png) | CANDIDATE_STALE；base/input/source 指纹差异 | 候选 · 未实现 | P2 |
| [`pe30`](prototype/requirement.html?state=pe30) | 历史轮次（只读） | 规划记录 → 轮次选择 → 第 2 轮 | [图](design/deepseek-pe30.png) | planning.rounds.list / round.read（historical） | 候选 · 未实现 | P1 |
| [`pe31`](prototype/requirement.html?state=pe31) | 已应用到草稿 · 未确认 | 候选待审阅 → 应用到草稿 | [图](design/deepseek-pe31.png) | candidate.apply → planRevision，confirmed=false | 部分已有 | P1/P2 |
| [`pe32`](prototype/requirement.html?state=pe32) | 确认计划 → 准备独立工作区 | 已应用 → 确认计划 | [图](design/deepseek-pe32.png) | plan.confirm.preview（含 planningBindingHash）→ plan.confirm；task.workspace.prepare（TD） | 部分已有 | P1 |
| [`pe33`](prototype/task.html?state=pe33) | 执行中申请调整（暂停新增领取） | 任务画布 → 调整待执行计划 | [图](design/deepseek-pe33.png) | plan.edit.begin → guardRef（记录原 autoAdvance） | 候选 · 未实现 | P0 |
| [`pe34`](prototype/task.html?state=pe34) | 编辑待执行区 · 领取竞态 | 暂停新增领取成功后 | [图](design/deepseek-pe34.png) | plan.pending.edit（guard + CAS）；NODE_LOCKED / REVISION_CONFLICT | 部分已有 | P0 |
| [`pe35`](prototype/task.html?state=pe35) | 语义保存后重新确认 → 继续 | 编辑区 → 保存 | [图](design/deepseek-pe35.png) | plan.confirm.preview / confirm（active/paused）；plan.edit.finish(continue) | 部分已有 | P0 |
| [`pe36`](prototype/task.html?state=pe36) | 固定模板任务 · 只读 | 模板任务 → 创建固定任务；任务列表 | [图](design/deepseek-pe36.png) | template.instantiate（实例创建即语义锁）；所有改图命令 → FIXED_CONFIGURATION_LOCKED | 候选 · 未实现 | P0 |
| [`pe37`](prototype/requirement.html?state=pe37) | 大需求总览 · 未细化范围 | 任务列表“规划总览” | [图](design/deepseek-pe37.png) | Proposal.groups + unresolvedScopes；policy limits | 后续分期 | P3 |
| [`pe38`](prototype/task.html?state=pe38) | 有界局部细化候选（设计候选 · 后续分期） | 编辑待执行区 → 选中节点 → AI 细化选区 | [图](design/deepseek-pe38.png) | boundaryPorts（只读）/ boundaryConnections；refine create/apply | 后续分期 | P3 |
| [`b01`](prototype/requirement.html?state=b01) | 加载中 | 冷开深链 | [图](design/deepseek-b01.png) | planning.read | 部分已有 | P1 |
| [`b02`](prototype/requirement.html?state=b02) | 读取失败 | 读取接口报错 | [图](design/deepseek-b02.png) | planning.read 错误 | 部分已有 | P1 |
| [`b03`](prototype/requirement.html?state=b03) | 无权限 | 权限失效 | [图](design/deepseek-b03.png) | PERMISSION_DENIED / SCOPE_DENIED | 部分已有 | P1 |
| [`b04`](prototype/requirement.html?state=b04) | 旧版本不支持该轮次 | 旧客户端 / 旧轮次 | [图](design/deepseek-b04.png) | UNSUPPORTED_CAPABILITY；format | 候选 · 未实现 | P1 |
| [`b05`](prototype/requirement.html?state=b05) | 命令结果未知（应用） | 应用到草稿后响应丢失 | [图](design/deepseek-b05.png) | RECEIPT_UNKNOWN；operations.by-key(requestKey) | 部分已有 | P1 |
| [`b06`](prototype/requirement.html?state=b06) | 弹窗取消 · 草稿保留 | 规划预览 → 返回 | [图](design/deepseek-b06.png) | 无（本地输入草稿） | 部分已有 | P1 |
| [`b07`](prototype/requirement.html?state=b07) | 方法未适配 AI 规划 | 选了未适配方法 | [图](design/deepseek-b07.png) | actions.generate.enabled=false + reason | 部分已有 | P1 |
| [`b08`](prototype/requirement.html?state=b08) | 执行后需求追踪（工作包归执行侧） | 任务画布 → 在需求画布查看；需求目录 → 执行中的任务 | [图](design/deepseek-b08.png) | planning.mapping.inspect + 节点当前有效验收结果（result / evidence refs） | 候选 · 未实现 | P2 |
| [`e-home`](prototype/home.html?state=e-home) | 主页 · 冷启动 | 打开合集 index.html | [图](design/deepseek-e-home.png) | — | 部分已有 | 整合 |
| [`e-requirements`](prototype/requirements.html?state=e-requirements) | 需求目录 · 规划状态列 | 左侧「需求目录」 | [图](design/deepseek-e-requirements.png) | requirements.list 投影 planning 摘要 | 候选 · 未实现 | 整合 |
| [`e-inbox`](prototype/inbox.html?state=e-inbox) | 待处理中心 · 规划事项 | 左侧「待处理中心」 | [图](design/deepseek-e-inbox.png) | inbox 投影（needs_input / ready / unresolved） | 候选 · 未实现 | 整合 |
| [`e-templates`](prototype/templates.html?state=e-templates) | 模板任务 · 创建固定任务 | 左侧「模板任务」 | [图](design/deepseek-e-templates.png) | template.instantiate 预览 | 部分已有 | P0 |

## 2. 验收场景 A01–A20

| 场景 | 名称 | 原型状态 | 设计覆盖 | 说明 |
|---|---|---|---|---|
| A01 | 普通开始/方法骨架/固定菜单 | [`pe01`](prototype/start.html?state=pe01) [`pe02`](prototype/requirement.html?state=pe02) [`pe03`](prototype/requirement.html?state=pe03) [`pe36`](prototype/task.html?state=pe36) [`b07`](prototype/requirement.html?state=b07) [`e-templates`](prototype/templates.html?state=e-templates) | 设计完成 · 业务未实现 |  |
| A02 | 规划超过数分钟 | [`pe05`](prototype/requirement.html?state=pe05) [`pe06`](prototype/requirement.html?state=pe06) [`pe07`](prototype/requirement.html?state=pe07) [`pe08`](prototype/requirement.html?state=pe08) | 设计完成 · 业务未实现 |  |
| A03 | 离开/返回/刷新/任务列表 | [`pe14`](prototype/tasks.html?state=pe14) [`pe15`](prototype/requirement.html?state=pe15) [`b01`](prototype/requirement.html?state=b01) [`e-requirements`](prototype/requirements.html?state=e-requirements) [`e-inbox`](prototype/inbox.html?state=e-inbox) | 设计完成 · 业务未实现 |  |
| A04 | 断连/重连/缺口/工具晚回 | [`pe06`](prototype/requirement.html?state=pe06) [`pe07`](prototype/requirement.html?state=pe07) [`pe15`](prototype/requirement.html?state=pe15) [`pe16`](prototype/requirement.html?state=pe16) [`pe17`](prototype/requirement.html?state=pe17) [`b02`](prototype/requirement.html?state=b02) | 设计完成 · 业务未实现 |  |
| A05 | 取消与候选提交竞态 | [`pe18`](prototype/requirement.html?state=pe18) [`pe19`](prototype/requirement.html?state=pe19) [`pe20`](prototype/requirement.html?state=pe20) [`pe26`](prototype/requirement.html?state=pe26) | 设计完成 · 业务未实现 | 竞态本身是服务端事务顺序；界面覆盖“候选先到但未停稳”（PE26）、停止请求/停稳/结账分开（PE19/20）、迟到提交只记审计（PE20 文案）。 |
| A06 | stop/create/apply 响应丢失 | [`pe21`](prototype/requirement.html?state=pe21) [`b05`](prototype/requirement.html?state=b05) | 设计完成 · 业务未实现 | 界面：同 requestKey 核对（PE21、B05）；按钮请求中防双击。重复提交不重复副作用需服务实现。 |
| A07 | 服务在 recorded/sending/started 崩溃 | [`pe21`](prototype/requirement.html?state=pe21) [`pe22`](prototype/requirement.html?state=pe22) [`pe23`](prototype/requirement.html?state=pe23) [`pe24`](prototype/requirement.html?state=pe24) | 设计完成 · 业务未实现 | 界面只显示“核对中/仅观察续接/从保留草稿新轮”；proof-not-sent 判定在服务端。 |
| A08 | 补充/关键问题/假设 | [`pe11`](prototype/requirement.html?state=pe11) [`pe13`](prototype/requirement.html?state=pe13) [`b06`](prototype/requirement.html?state=b06) | 设计完成 · 业务未实现 |  |
| A09 | 结构/配置/IO/方法非法 | [`pe09`](prototype/requirement.html?state=pe09) [`pe27`](prototype/requirement.html?state=pe27) | 设计完成 · 业务未实现 |  |
| A10 | 需求覆盖不充分 | [`pe09`](prototype/requirement.html?state=pe09) [`pe25`](prototype/requirement.html?state=pe25) [`b08`](prototype/requirement.html?state=b08) | 设计完成 · 业务未实现 |  |
| A11 | 依据失效/无权限/截断/矛盾 | [`pe04`](prototype/requirement.html?state=pe04) [`pe27`](prototype/requirement.html?state=pe27) [`pe29`](prototype/requirement.html?state=pe29) | 设计完成 · 业务未实现 |  |
| A12 | 并行读写冲突 | [`pe28`](prototype/requirement.html?state=pe28) | 设计完成 · 业务未实现 |  |
| A13 | 有界修订 | [`pe03`](prototype/requirement.html?state=pe03) [`pe10`](prototype/requirement.html?state=pe10) [`pe12`](prototype/requirement.html?state=pe12) | 设计完成 · 业务未实现 |  |
| A14 | 原图非空/手改/候选过期 | [`pe25`](prototype/requirement.html?state=pe25) [`pe29`](prototype/requirement.html?state=pe29) [`pe31`](prototype/requirement.html?state=pe31) [`pe38`](prototype/task.html?state=pe38) | 设计完成 · 业务未实现 |  |
| A15 | 已确认/执行中编辑与领取竞态 | [`pe33`](prototype/task.html?state=pe33) [`pe34`](prototype/task.html?state=pe34) [`pe35`](prototype/task.html?state=pe35) | 设计完成 · 业务未实现 |  |
| A16 | 自动/手动/并行前沿 | [`pe33`](prototype/task.html?state=pe33) [`pe35`](prototype/task.html?state=pe35) | 设计完成 · 业务未实现 | 原型只演示“继续执行恢复原自动推进”和“同任务文件写入逐个领取”；整体推进/选中后继沿用原任务画布，未重画。 |
| A17 | 大需求分组/未细化 | [`pe08`](prototype/requirement.html?state=pe08) [`pe37`](prototype/requirement.html?state=pe37) | 设计完成 · 业务未实现 |  |
| A18 | 同任务恢复/工作区/交付 | [`pe32`](prototype/requirement.html?state=pe32) [`b08`](prototype/requirement.html?state=b08) | 设计完成 · 业务未实现 | 规划不新增交付按钮；PE32 只衔接 TD“准备独立工作区 → 开始执行”；恢复与交付沿用合集 TD/节点稿。 |
| A19 | 新旧格式/权限/历史 | [`pe04`](prototype/requirement.html?state=pe04) [`pe30`](prototype/requirement.html?state=pe30) [`b03`](prototype/requirement.html?state=b03) [`b04`](prototype/requirement.html?state=b04) | 设计完成 · 业务未实现 |  |
| A20 | Claude 离线整合与可达性 | [`pe14`](prototype/tasks.html?state=pe14) [`pe32`](prototype/requirement.html?state=pe32) [`e-home`](prototype/home.html?state=e-home) [`e-requirements`](prototype/requirements.html?state=e-requirements) [`e-inbox`](prototype/inbox.html?state=e-inbox) | 设计完成 · 业务未实现 | 冷启动主页 → 开始任务 → … → 任务画布全程按钮可达；整合进合集需另行授权（integration-map.json）。 |

## 3. 功能 F01–F10

| 功能 | 原型状态 |
|---|---|
| F01 | `pe01` `pe02` `pe03` `pe04` `b07` |
| F02 | `pe05` `pe06` `pe07` `pe08` |
| F03 | `pe14` `pe15` `pe16` `pe17` `pe30` `b01` `b02` `b03` `b04` `e-home` `e-requirements` `e-inbox` |
| F04 | `pe04` `pe09` `pe11` `pe25` `pe26` `pe27` `pe29` `pe31` `pe32` `b05` `b08` |
| F05 | `pe03` `pe10` `pe11` `pe12` `pe13` `b06` |
| F06 | `pe12` `pe16` `pe17` `pe18` `pe19` `pe20` `pe21` `pe22` `pe23` `pe24` `pe26` `b05` |
| F07 | `pe33` `pe34` `pe35` `pe38` |
| F08 | `pe01` `pe36` `e-templates` |
| F09 | `pe08` `pe25` `pe37` `pe38` |
| F10 | `pe28` `pe32` `b08` |

## 4. 未覆盖 / 只做文案示意的项

| 项 | 原因与处理 |
|---|---|
| 规划中“切项目后旧轮迟到内容不进入新项目” | 原型只有一个项目上下文；在 DESIGN-DELTA §3.6 写明读模型按 project/execution/run 精确身份过滤，未单独画状态。 |
| A16 整体推进 / 推进选中后继 | 沿用原任务画布行为，未重画；本稿只保证调整结束后恢复原模式。 |
| 节点详情（执行业务节点） | 不重画节点 60 态；整合后点已执行步骤进入合集 node/index.html，返回任务画布恢复视角（见 integration-map）。 |
| 选区细化真正应用（PE37/PE38） | 设计候选 · 后续分期；预览可看，确认 / 应用禁用并写原因。 |
| 子隔离与汇合（PE28） | 未安装；按钮禁用“未安装 · 后续分期”。 |
| 真实 provider / 恢复 / 并行写 | 全部模拟，不宣称通过。 |

## 5. 自查证据

见 `design/self-check.json`：50 状态 × 4 主题（1440×900）遍历；deepseek 另测 1280×800、1024×768；主线按钮流 29 步（冷启动 → 开始 → 规划（胶囊与状态条联动）→ 审阅 → 应用 → 确认 → 准备 → 执行 → 调整 → 重新确认 → 继续；任务列表返回、刷新读回、后退前进不重放命令、固定模板）；脚本错误 0、外部请求 0、横向溢出 0。
