# P09 节点详情与历史读取一致性（2026-10-20）

基线：`6fcc4e6`。范围为 NodeDetailPanel、节点/尝试只读 HTTP、plan.nodeDetail 与 execution 工具/产物读取；未修改 RunReader、RunContentPage、AttemptOutput、PPT 或 HTTP 写包装。

## 设计依据与确切根因

只读权威 `sources/node/API-REQUIREMENTS.md` §2.2/2.7/2.8 要求事实、定义、结果与验收属于同一 attempt；§2.13 要求撤权后隐藏已加载内容；§2.10 要求产物导出绑定精确版本且不能将引用视为下载权限。`sources/node/README.md` 要求历史区域只读。

发现并一起修复：

1. nodeDetail 始终读当前计划，即使用户选择旧 attempt。历史标题、概览、状态可能混入当前定义或当前 running 状态。
2. nodeDetail 的 attempts/result 和内嵌 output 没有 readability 投影；attempt 摘要列表没有 result 权限检查；产物预览/下载没有 result 权限检查；工具正文可绕过 output 撤权。
3. storage 输出中 toolCallRef 实际含第二份 evidence（契约未声明）。仅清除 toolEvidence 时，完整参数/结果仍从嵌套 reference 泄露。回归实际抓住该问题。
4. Panel 已有详情失败隐藏逻辑，但成功轮询获得撤权后，旧 output/工具/产物查询及 attempt 摘要仍可从缓存继续显示。真实浏览器复验还抓到“阅读区消失但列表旧摘要残留”。
5. currentAttemptId 已清除时，nodeDetail 用最后一次历史记录兜底，可能冒充下一次当前尝试。
6. saveSubmittedResult/finishAttempt 将 readability 无条件重置为 ok；运行中撤权会被迟到提交或结束事件重新开放。SQLite UPDATE 现在对存储行原子保留各类 forbidden，不改变其余正常结算状态。

## 服务端行为

两个详情别名 `/api/tasks/:id/nodes/:nodeId` 与 `/api/tasks/:id/plan/nodes/:nodeId` 支持 `?attemptId=`。服务端校验 task/node/attempt/definition/plan 归属，用真实 attempt.definition 和该次 plan 生成定义与需求链接；显式返回 selectedAttempt，保留 currentAttempt 作为当前身份。所选历史的 execution 状态与 output 归属该历史 attempt；不附当前人工验收，也不开放历史验收动作。未保存定义的旧记录给出 definitionUnavailableReason，Panel 不展示当前定义来冒充历史概览。

共用 node-read 投影在每次读取重新检查权限：

| 权限 | 详情投影 | 正文/工具/产物入口 |
| --- | --- | --- |
| output forbidden | 不返回正文 | output 403；工具正文 403 |
| tools forbidden | 不返回工具文本和 evidence；reference 只保留 callId/status/source | 工具正文 403 |
| result forbidden | 不返回 AttemptResult、产物引用或结果摘要 | 产物预览及 download=1 都 403 |

任务/节点不匹配或未知 attempt 404；产物 revision/sha256 与既有检查一起保留。没有 currentAttemptId 时不回退到旧 attempt，正文为空。

## 前端与缓存

- 详情查询按所选 attempt 分键，并核对返回 task/node/selectedAttempt，晚回不能混用。
- Panel 保持最多两秒的详情权限核对；历史输出自身不轮询追加。服务并无撤权推送事件，因此不会声称零延迟撤权。
- 最新权限遮蔽旧 output、结果、尝试列表摘要、工具/产物 reader；取消并移除相关 output/工具/产物缓存，禁止迟到查询恢复已撤权正文。
- 旧记录状态、结果与定义同 attempt，历史概览没有当前验收或推进动作。定义缺失明确提示，不伪造。
- 工具子视图对读取错误或重新核对隐藏旧正文，避免缓存掩盖失败。

## 验证证据

- `npm run typecheck`：通过。
- 详情/控制/客户端定向组合：12/12 通过（node-detail-read、artifact-read、plan-edit-binding、execution-control、node-detail-identity）。
- 最终完整快照：520 项，509 通过、11 按条件跳过、0 失败。加入存储撤权保持后，另执行 18/18 定向组合（含调度/时限/退避/结果持久化），类型检查通过。
- 新 HTTP/SQLite/blob 回归覆盖：旧定义与新定义不同、历史状态不混当前、详情双别名、output/tools/result 独立撤权、嵌套 evidence 不泄露、直接下载 403、跨任务/节点 404、无快照提示、清除 currentAttemptId 后不冒充当前。
- 新客户端回归验证 task/node/selectedAttempt 响应不一致时拒绝正文投影。
- 新存储回归先撤销运行中 attempt 的三类权限，再迟到提交和结束，最后重开 SQLite，确保 forbidden 仍保留；另验证未提交结果及错误字段原语义保留。
- `npm run build:web`：通过（存在既有 bundle 体积提示）。

真实 Chrome 使用生产 NodeDetailPanel + 真实临时 HTTP/SQLite 的离线组件夹具：当前 #2 显示 NEW DEFINITION；选择 #1 后显示 OLD DEFINITION；先成功读取 ARTIFACT SECRET，再只在服务端撤销权限，原阅读区变为“无权查看这次尝试内容”；返回列表后 RESULT SECRET 摘要与产物入口也消失；历史执行现场保持“失败”，明确“无权读取”，不变成当前 #2 的执行中。

截图为纯测试数据，未含真实项目或模型输出：

- [撤权前历史产物](../evidence/node-detail-read-2026-10-20/history-before-revoke.png)
- [撤权后阅读区](../evidence/node-detail-read-2026-10-20/artifact-revoked.png)
- [撤权后摘要列表](../evidence/node-detail-read-2026-10-20/summary-revoked.png)

临时组件夹具、服务与标签已清理/关闭。未调用真实模型、未执行远端写入；截图证明组件读取与缓存行为，不代表完整任务执行或 Electron 发布验收。Run 批次页面由 B 独立负责；本批未为其声明缓存验收。
