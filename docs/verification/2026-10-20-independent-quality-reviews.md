# 显式需求 / 风险 AI 评审闭环 · 2026-10-20

## 设计与范围

只读权威 `originals/main/pages/insights.html:53–70`：r1 独立列出需求与风险 AI 评审；r3 两位风险评审结论不一致时为「待人工」，人工认定不改变两项 AI 评审原结论；r5 只有程序验收也可质量通过，不为所有任务增设风险或人工门槛。

本批承接 247b617 四分项真实来源投影，补齐此前缺少的独立 AI producer。不是给所有任务默认新增节点，也不把通用 verification、代码 security 维度或需求模板的产物复核 confirmed 改名成独立结论。

## 实现

- 流程编辑器的 verify 步骤可显式选择需求或风险评审，并填写非空评审条款；通过现有方法目录保存/校验/发布与计划确认，随节点及职业快照冻结。未领取步骤的既有调整入口也可配置；已运行定义保持锁定。旧流程、旧计划与旧尝试不会回填类型。
- 方法规范化/复制、骨架及 AI 候选转换保留合同；规划不能静默丢失或改写已配置的同一步骤合同。没有新增审批节点或授权。
- 模型通过已有 `workflow.result.submit` 的 `payload.reviewReport` 提交独立类型、总评、逐条结论、分析限制和文件引用。每条款恰好一次，总评由失败优先、其次未知、其余通过校验，泛 verification 不顶替。
- 服务核对引用的文件路径符合冻结职业读取权限；引用 sha 与原文须对应当前尝试真实会话经受控 `workspace.file.read` 已实际读取的内容。普通工作区、冻结源码与授权上游产物的实际读取都保留标记。没有读取证据的条款只能 unknown。服务绑定 task/execution/计划定义/node/attempt/session，忽略模型伪造的身份字段。
- 完整独立报告持久化为 `AttemptResult.qualityReview`；已声明合同的当前提交缺报告时拒绝完成，让模型补充；历史缺失报告仍投影为未知，不根据泛 passed 推断独立通过。当前尝试及原定义匹配后才进入 Insights，权限禁止时不展示结论或来源。业务 AI 结论明确不等于客观程序证明。
- 节点「尝试与产出」展示原报告、逐条依据、sha、原文与会话身份。人工意见不修改模型报告。相同冻结条款的多个同类型独立评审 passed/failed 不一致时聚合 `needs_decision / 待人工`，保留全部来源，不静默选一个或全绿。

## 真实模型暴露的结果提交竞态

第一轮真实模型已读公开文件、开始 `result-submit`，但旧 adapter 在 `session.next.tool.called` 时就启动 1.5 秒退出计时。在 MCP 请求尚未抵达时 scope 已被 finally 撤销，真实工具返回 403，节点因未提交而暂停。该失败不算模型验收通过，没有人工补写结果或复用失败报告。

已改为仅匹配终结工具的 `session.next.tool.success`，不匹配 called/progress/failed，也不把无关工具正文里出现的 result_submit 当成功。确定性回归覆盖这些事件边界；真实重跑两项提交均成功。失败实证保留在本机首次运行日志，文档不记录令牌或个人路径。

## 验证

- 离线合同回归：显式配置、不推断历史、空条款/非 verify 拒绝、当前会话与实际原文/sha 核对、伪造身份忽略、缺报告不采用泛 passed、撤权不展示、方法持久重读、规划丢失配置拒绝、多个风险分歧保留两来源与人工意见独立。
- 定向：`quality-review.test.ts` + `insights-quality.test.ts` + `plan-editor.test.ts`，12/12；最终分组细化合同保留补丁另跑 `pe37-scope-planning.test.ts` + `method-catalog.test.ts` + `workflow-catalog.test.ts`，15/15。
- 真实模型：`AGENT_WORKFLOW_LIVE=1 AGENT_WORKFLOW_GUI_REVIEW=1 node --import tsx --test tests/integration/quality-review-live.test.ts`，1/1，通过；实际两个独立 OpenCode 会话，配置的 opencode-go/deepseek-v4.1-flash。
- 隔离公开临时 Git 项目仅 README.md + greet.mjs。需求条款判断非空名字返回 hello / 空值拒绝；风险条款判断无网络/秘密读取且非法输入失败关闭。两项真实报告均 passed，分别 35,787 / 35,883 tokens（含缓存），都有两文件实际读取引用。源项目 HEAD 与工作区无变更。
- 正式 Chrome GUI 分别打开两节点「尝试与产出」，读取独立报告/条款/身份/引用，并查看 Insights 需求与风险各通过、程序未要求、人工未认定。截图在 `docs/evidence/independent-quality-review-2026-10-20/`。没有用普通节点结果代替独立评审；无模型结果夹具注入。
- `npm run build`（含全仓类型检查、MCP/Web/server/desktop 构建）通过；全仓回归 632 项：614 通过、18 项按约定跳过、0 失败（约 141 秒）；实际模型另行 opt-in 1/1 通过。

## 证据边界

本批真实模型验证的是一个公开小型静态需求/风险评审，不是任意项目风险覆盖或程序运行证明。未知/失败/分歧的合同和聚合分支为离线回归；未再次花费模型构造双风险分歧。GUI 实际查看两项独立结果；流程配置发布的字段保留有服务端回归，未把所有编辑器中间态都宣称为人工 GUI 验收。
