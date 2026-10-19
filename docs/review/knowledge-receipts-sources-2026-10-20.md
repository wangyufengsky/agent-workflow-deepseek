# 知识问答回执与来源修复（2026-10-20）

状态：实现与离线验证通过，整合与 GUI/live 尚未完成；P04 仍进行中。

- 首次问题不再把服务生成 conversationId 写入幂等输入；accepted/unknown/succeeded 重放均返回原回执，不再次派发。
- 回答按请求号独立保存，增加只读结果读取接口；历史列表淘汰不会丢失核对能力。
- 前端在发送前保存问题/原 key，响应未知锁定，跨页面/刷新保留，只读核对后解锁。
- 勾选来源作为冻结输入；拒绝不存在/越界来源，取消旧12文件截断；逐文件与总上下文边界明确返回 truncatedPaths。
- 请求要求 toolPolicy=none，整合职业适配器实现后才能证明运行时不能读取选择以外资料。

验证：node --import tsx --test tests/integration/knowledge-steps.test.ts，5/5通过；全仓typecheck通过。故障夹具仅证明应用逻辑，不代表模型 live 或原生桌面验收。继续工作：实时进度、停止/继续、来源类型与许可、角色证据、四主题 GUI。
