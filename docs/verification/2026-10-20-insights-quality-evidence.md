# Insights 质量分项的真实依据

## 设计与汇总边界

只读依据 `opencode-workflow-design-showcase/originals/main/pages/insights.html:53–60、68–70`：程序验收、需求评审、风险评审、人工认定分别展示；人工意见不改变两项AI原结论。原稿r5只有程序验收仍可质量通过，r1人工未认定也可质量通过，因此没有添加所有任务必须独立风险评审或必须人工通过的新门槛，没有新增隐藏执行节点。

原实现只显示人工意见，当前质量仅由最近通用Git代码审查及人工意见决定，既不呈现程序/需求/风险来源，也可能把模型自报verification通过数或节点成功误认为程序依据。本批新增独立只读质量投影与UI四分项；复用现有服务来源，不发模型、不授予权限、不新增写操作或评审producer。

## 来源和状态规范

| 分项 | 可消费来源 | 未配置/未要求/未评审与未知的区别 |
| --- | --- | --- |
| 程序验收 | 当前执行、当前测试节点attempt的服务签发ControlledTestRun；签发存储、latest id、task/execution/node/attempt、真实JUnit产物完整性均一致 | 无冻结计划为未配置；冻结计划无test/受控test阶段为未要求；已配置但未开始为尚未运行；缺签发、旧run、撤权、未确认或不支持报告为未知，不能用0冒充缺失 |
| 需求评审 | 明确的template.requirement-review逐文件评审过程合同v1；冻结资料/blob、当前writer、独立session、读取/产物均核对；可返回该真实来源 | 普通代码审查不改名为需求评审；无合同为未配置，已配未跑为未评审。已完成过程仍不能把fileEvidence.confirmed或verification.passed当业务需求全部满足：现有合同未结构化业务通过/失败，保留未知并提供原报告来源。旧合同/失配/撤权亦为未知 |
| 风险评审 | 本仓库没有独立风险评审合同/producer | 未配置，明确不把通用security维度冒充独立风险AI评审；不新增所有任务必需的风险门槛 |
| 人工认定 | 原有task acceptance记录和时间 | 未认定/通过/未通过单独保存，不能覆写程序与AI分项；保留原人工意见入口 |

通用代码审查另外展示原ReviewRun与原始维度及精确原记录入口，不计作需求/风险的独立来源。只读当前execution最近审查，坏JSON/缺维度不能静默按无问题判通过。

汇总使用当前任务实际已配置的程序/专用需求/通用代码审查来源。明确失败或人工驳回标为存在问题；配置来源全部明确通过且任务完成，才可质量通过。没有可核对来源时不会因单独人工accepted或节点succeeded而判通过。未配置风险与需求不凭空加门槛。人工未认定不抹掉实际程序通过；人工驳回也不把程序分项改失败。来源链接回到对应当前节点，旁列签发报告/attempt身份；不假装路由已选择历史attempt。

## 验证

`tests/integration/insights-quality.test.ts`：6个新增回归，使用真实Node子进程执行node:test/JUnit和真实文件/SQLite/HTTP；不是模型验收。覆盖：真实通过1/失败0/跳过1、verification自报900不采信、旧testRun id、撤权隐藏计数及来源、真实失败不能被人工通过覆盖、security不冒充风险、无测试范围未要求、损坏评审JSON未知、需求专用过程合同的独立session与当前writer版本（确认产物成立不伪装业务需求通过）、真实不支持报告不补0。需求身份材料为明确离线合同夹具，不当真实AI评审输出。

与既有insights、runtime-role-insights合计12/12通过。typecheck、build通过；最终全仓625项：608通过、17跳过、0失败。

GUI启动命令：`AGENT_WORKFLOW_QUALITY_GUI=1 node --import tsx --test --test-name-pattern='quality uses actual controlled' tests/integration/insights-quality.test.ts`。隔离本地服务/临时数据，未启用OpenCode。程序计数来自真实Node/JUnit（1通过、1跳过），用量无模型计量继续显示未知。原生Chrome读取四分项，确认程序通过、需求/风险未配置、人工未认定；随后正式人工驳回，程序计数仍为原值，人工单独标未通过，质量汇总存在问题。截图在 `docs/evidence/insights-quality-2026-10-20/`。

边界：未声称已新增或跑过独立风险模型；未将通用代码审查充当需求/风险producer。当前范围补齐真实readmodel/来源/状态，不引入设计未要求的全局必需评审。未修改其余工具、执行、知识页只读复核发现项，已交Lead分派。

## 明确保留的功能缺口

当前任意PlanNode没有结构化requirement/risk评审类型，AttemptResult.verification只是通用验证状态；任意payload不能作为经过校验的独立AI业务结论。已发布reviewer职业和既有执行通道可承载未来显式可选评审，但目前没有可用的两项独立结论producer。需求代码评审模板只已有真实过程/产物复核合同，不等于该producer。本批只交付readmodel，不据未知状态宣布完整双AI评审功能完成；后续需显式可选类型/职业配置及绑定冻结需求、结果版本、独立会话的结果合同，由Lead裁定，不能插入隐藏强制节点。
