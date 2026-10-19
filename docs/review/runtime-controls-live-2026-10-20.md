# 运行时启动设置与真实操作验收

2026-10-20，隔离临时数据与独立受管OpenCode，未操作用户5173/5177服务。

## 修复

- autoStart原先仅保存、不被启动逻辑读取。现在关闭时保留受管adapter但不启动进程；运行环境显示已停止，可明确手动启动。服务设置将“连接已有服务”的错误描述改为“手动启动受管进程”。
- 设置页移除无消费路径、设计未要求的全局ask/allow/deny选择器，保留兼容存储字段，不再对用户承诺它会覆盖实际职业/项目/任务工具权限。现有权限上限、显式运行时问答与hard deny不改变，也不添加隐含审批节点。
- 正在发送的请求显示“发送中，等待回执”，仅当前页面内存知道是否还在发送；持久只留原key，刷新后无法确认结果就按UNKNOWN核对。accepted单独显示已受理。断线不重发。
- 受管状态事件同步刷新实际状态及bootstrap；解决主面板已就绪、侧栏仍未连接。历史显示手动启动/重启真实回执，不把自动启动当作手动操作。

## 验证

- 12项定向（command-receipts、role-package-receipts、runtime-role-insights）通过；另整合知识会话相关25项通过。类型检查通过。新配置测试证明关闭autoStart没有PID、不调用虚构二进制、不产生手动回执。
- 实际 `runtime-controls-live.test.ts` 两次1/1、exit0；最终 `/tmp/aw-runtime-controls-live-r2.log`。CUA从stopped点启动并确认：`req_0mvfmq4eevvgzca05nr`，PID72514、代次efc1ae5809b4；再确认重启：`req_0mvfmqwb0erkekwh0jz`，PID72837、代次1e8a7b81dd4b。两个不同成功原key、真实新进程、状态ready，历史恰好两条。
- GUI看到发送中→启动中→已就绪、MCP13个工具与侧栏连接状态一致；重启后新PID和两条成功回执。截图 `docs/evidence/runtime-controls-live-2026-10-20/{sending,started,restarted}.png`。DeepSeek 1280×720；不外推所有主题/失败/外部进程状态。
- 这是真实受管进程测试，没有调用模型。活动会话拒绝重启、未知结果/锁语义仍由定向服务回归覆盖。测试结束关闭自己的进程与服务。
