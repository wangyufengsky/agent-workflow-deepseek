# 运行时权限与节点原生问答闭环

基线 `f90b80d`，独立分支 `codex/parity-inbox-runtime`。设计权威为只读 `opencode-workflow-design-showcase/originals/main/pages/inbox.html`，尤其 83–113 行：节点问题、只读 once/session/reject、hard 只能知晓、未知仅原键核对。规划问题保留自己的轮次/需求补充流程，不能代替节点原生问题。

## 已接行为

- `SessionRunner` 识别 permission/question 两代 asked 与 replied/rejected。V2 action/resources 不再误读为旧 permission/patterns。权限处理脱离 SSE 消费循环，等待人工决定不会阻塞同流的确认/idle；自动回复失败有显式错误回调，不再吞掉。
- 原生事项持久保存 request/session/task/project/execution/node/attempt 或 round 绑定、请求内容指纹与冻结选项。节点名称取 attempt.definition。旧尝试、停止中的执行、错误会话、读取权限撤回均不能继续授权；权限撤回后正文也不再投影。
- 问题用稳定选项 ID 接收输入，服务端转换为原运行时要求的标签数组；支持单选、多选、其他、无选项文本问题。拒答实际走 runtime reject，不替运行时决定最终任务结果。
- 独立 `runtime.interaction.resolve` 原键回执。成功、accepted、unknown 重放只读；并发核对后的第二次重放检查避免重复 dispatch。回复失败为 UNKNOWN，迟到的明确相同决定才可收口；不同会话/不同答案不能收口。
- 本会话允许只在内存记录当前 session+permission+精确 patterns；后续每个真实请求仍向 runtime 回复 once，且每次重新检查冻结授权与当前工具策略。不会向 OpenCode 发送 always，不写全局持久授权。
- 硬拒绝先向 runtime 发 reject，自动回复也有原键回执；结果未知不能猜成功。确认拒绝后事项仅可本地知晓，知晓不会再次发权限命令。
- 没有为已授权 MCP 读取增加 ask，没有新增流程审批节点。可授权范围只包括受控只读 MCP 工具，原生文件/命令/未知权限不通过此入口扩权；question 通信工具单独接通，toolPolicy:none 仍全部禁止。
- 待处理页面使用真实队列、服务可用性与当前操作原因；答复草稿在切换事项时保留，写请求沿用公共持久原键锁，成功显示回执。权限与问题进入 bootstrap inbox，运行时等待更新任务 attention。
- 共享规划判断统一了 HTTP 列表、bootstrap 侧栏与任务 attention：只算必答未答；已应用/拒绝候选不再待审阅；UNKNOWN 优先于旧 needs_answer 阶段。没有改写规划轮次和问题历史。

## 接口

- `GET /api/runtime-interactions`，`GET /api/runtime-interactions/:id`
- `POST /api/runtime-interactions/:id/resolve`：requestKey、confirmResolve、action；question answer 为 questionId + values/other。
- `GET /api/operations/:key` 调用此领域的只读 reconcile。
- OpenCode 1.19 V2：`GET /api/session/:sessionID/{permission|question}`，`POST /api/session/:sessionID/permission/:requestID/reply`，question reply/reject。V2 成功答复为 204；legacy 保留布尔成功校验。
- application.ts 的运行时代理真实转发所有四个新增 port；不是仅在 adapter 上声明方法。

## 证据层次

1. **实际本机运行时、无模型**：`opencode --version` 与隔离 XDG 的 `/global/health` 均为 1.19.0。读取该实例 `/doc` 核实 V2 事件字段、session-bound 路由和 204 契约；实际读 permission/question 列表成功。无模型创建的 read 权限探针被 runtime 立即 deny，未发 asked；没有把它当作模型请求链成功。隔离服务已停止。
2. **真实 SQLite / HTTP 的离线协议控制测试**：原键成功/UNKNOWN/accepted 重放、并发读 race、停止与旧 attempt、硬拒绝、session allowance、单多选/文本/其他、迟到相同/不同确认、权限撤回、服务重启只读复核、真实 HTTP 路由、V2 204 客户端、SSE 非阻塞。该层不调用模型、不执行文件/命令副作用。
3. **原生 Chrome，生产 Inbox 组件 + 真实 HTTP/SQLite + 离线 port**：多选和其他值提交后服务记录 `[["Markdown","HTML","PDF（离线协议验证）"]]`；原键成功回执且需回答计数归零；未知权限答复按钮锁定、待核对计数为 1；硬策略仅“知道了”，回执明确“未授予权限”。页面没有 mock model output。临时服务/浏览器标签已关闭，夹具脚本未入库。

截图位于 `docs/evidence/runtime-inbox-2026-10-20/`：question-draft、question-receipt、unknown-locked、hard-policy。

## 验证与限制

- `npm run typecheck`、`npm run build:web` 通过（构建仅已有 bundle-size 提醒）。
- 定向回归 26/26 通过。最终全仓 556 项：545 通过、11 按原条件跳过、0 失败。末尾权限正文遮罩/多题顺序回归也已纳入该轮；最后仅页面失败计数守卫与文档更新后再次完成 Web 构建及类型检查。
- **未覆盖真实模型自然发出 question/permission 后继续执行的验收**；Lead 将独立做该层。协议夹具、Chrome 页面、运行时健康及 OpenAPI 读取均不能替代它。
- 1.19 没有已处理权限/问题的历史确认读 API。UNKNOWN 核对只读 pending 列表；请求消失仍不足以证明答复成功，保持 UNKNOWN、不自动重发。
- 服务重启后原活动 scope 不会重新凭空创建：已提交答复保留原键；尚未答复但原会话上下文已失效的事项不能授权，提示回任务核对/停止。没有把服务重启视为同会话恢复授权，也没有把来源任务/旧 attempt 当成新代。
- 本批绑定执行节点与规划轮次。没有 task/round/attempt 上下文的后台 review/fix/knowledge/charter 原生问题不冒充节点问题；当前自动拒答，知识对话的独立元数据/提问来源另批处理。
