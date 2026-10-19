# 通用前端命令回执修复 · 2026-10-20

范围：任务通用命令、设置草稿、PPT 删除与移除附件。知识库由另一工作范围处理，本批未修改。

- 客户端在写请求前持久登记 scope/path/requestKey。网络/超时、响应正文丢失、无法识别成功响应、5xx 均保留结果未知；具有结构化错误码的明确 4xx 拒绝可解锁，IN_PROGRESS/UNKNOWN 不解锁。
- UNKNOWN 阻止同资源 scope 的再次写入；accepted 仅阻止相同动作重复派发，保留其他合法操作（例如停止正在执行的任务）。公共提示在路由切换和刷新后保留，核对入口仅 GET 原 operations key；accepted/unknown/404/查询失败不解除未知锁，终态 succeeded/failed 才解除。
- useWorkflowCommand 不再在网络异常后清空未知锁；核对终态后刷新读模型。设置不再断言网络失败等于未保存；执行/监控数值草稿保留在 sessionStorage，核对前禁止保存和放弃。凭据、请求正文不进入通用持久账本。
- PPT 删除和移除附件改由客户端生成 key 并发送 DELETE body，服务端不再造号；集成回归确认删除后可按客户端原 key 查询 succeeded。

验证：`npm run typecheck` 通过；`node --import tsx --test tests/web/command-receipts.test.ts tests/integration/ppt-works.test.ts` 4/4 通过；`git diff --check` 通过。新增前端逻辑测试位于默认测试扫描目录 tests/web，因此纳入 npm test。

证据边界：fetch 故障为离线注入，不是模型 live；PPT 测试启动真实应用 HTTP inject/临时存储，未调用模型。未做 Electron GUI/刷新交互截图、全仓回归或实际远端写入。存储被浏览器禁用时保持本页内存锁，跨刷新持久能力受浏览器存储可用性限制。原服务无账本记录的 UNKNOWN 继续保持，不能通过“查不到”当作失败并自动重发。
