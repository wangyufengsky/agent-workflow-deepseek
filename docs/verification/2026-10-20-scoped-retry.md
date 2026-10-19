# P09 批次限定重试（2026-10-20）

设计批次页的“重试这一批”复用已有 `ExecutionCommandRequest.nodeIds` 和 `POST /api/tasks/:id/execution/retry`，不再忽略节点选择并重试全任务。

- 指定 nodeIds 时必须是当前 execution 的非空、无重复且明确失败的节点集合。不存在、未开始、成功或结果未知节点不能被伪装为失败重试。
- expectedStatus 与当前状态不一致返回 STALE_TARGET；运行中、存在 running/unknown 节点、停止未确认及尚未结束的计划调整均禁止领取。
- requestKey 绑定排序后的 nodeIds；原 key 重放返回原回执，改选其他节点需新 key。
- 同步冻结当前执行计划与节点前沿后，仅所选节点重置为 pending 并创建新 attempt；其他节点的 status/currentAttemptId/attemptCount 不修改。
- 调度器只派发本次所选集合。其他失败节点不会被 pauseAfterFailure 提前阻止本次明确批准的重试；本批新增失败仍遵守该设置。结束后执行仍如实呈现未解决的失败或待执行前沿，不宣称整个任务完成。
- 不带 nodeIds 保持原先全任务重试和退回重做语义；所有上限、业务时限、退避、并发隔离规则继续生效。

验证：`npm run typecheck`；execution-policy/stop/control/command-replay-boundaries 定向回归 33/33 通过。新用例直接验证派发集合、未选失败节点完整快照、过期状态、无效选择和同 key 防重复。使用离线 OpenCode port 验证调度控制流，未进行真实模型或远端写入验收。批次 UI 接线由对应负责人完成。
