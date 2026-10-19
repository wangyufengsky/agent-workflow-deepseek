# 工具策略 UNKNOWN 原请求恢复（2026-10-20）

基线 ede7989，独立worktree `parity-tools-policy-receipts`。设计权威 `opencode-workflow-design-showcase/originals/main/pages/tools.html:110`：修改结果未明时，确认前不能修改其他工具或切换范围。

修复前局部 `pending` 仅在组件内存，切Skill页签回来或刷新会消失；虽然公共客户端能拦下后续写，面板已经生成并保存未发送的新key，核对会查到404。本批工具页从既有持久命令登记恢复原身份，UNKNOWN期间禁用配置范围、来源、工具开关和整体停用。派发前再次检查登记，不能先分配新key覆盖原身份；核对始终优先原持久key，仅原操作终态解锁，并刷新全部范围策略。accepted使用等待结算文案／时钟，unknown才显示待核对。未修改共享client/pending，也未改变现有会话权限冻结语义。

## 正式 CUA 故障验收

独立真实服务5403，公共临时目录项目；5404是仅测试的响应故障代理。通过CUA Chrome正常修改工具开关，后端实际保存成功后，代理截断响应，触发真实客户端UNKNOWN处理；不注入或伪造服务receipt。没有模型调用，也不冒充模型验收。

原操作 `req_0mvfn7xohqivi472qmh` 修改 `workspace.file.list` 全局停用。实际路径：提交→UNKNOWN锁→切Skill只读页签→返回工具→刷新→局部核对原请求→succeeded解锁。返回和刷新后仍是完全相同原key，配置范围／工具来源／全部开关均禁用；读取成功的策略清单也不能绕过回执锁。局部核对实际命中原key，没有新key或404。

本机 `/tmp/tools-policy-receipts-evidence/original-key-readback.json` 保存真实服务receipt和策略；SQLite中该原key只有一条 succeeded，前后没有派生未发送key。另一条 `req_0mvfn75ygg4bw2x5ug4` 是此前独立手动修改 `workspace.file.read` 的成功操作，不属于本次UNKNOWN重发。本轮不改真实项目／活动模型会话，临时服务未启动OpenCode。

正式截图已入库：

- [UNKNOWN开关与范围锁定](../evidence/tools-policy-receipts-2026-10-20/policy-unknown-locked.png)
- [切Skill返回仍保留原key](../evidence/tools-policy-receipts-2026-10-20/policy-return-from-skill-locked.png)
- [刷新后仍锁定](../evidence/tools-policy-receipts-2026-10-20/policy-refresh-locked.png)
- [核对原请求成功后解锁](../evidence/tools-policy-receipts-2026-10-20/policy-original-confirmed.png)

类型检查与Web构建退出0；工具策略、公共命令回执及新增面板身份回归11/11通过。新增 `tests/web/tool-policy-receipts.test.ts` 在正常测试路径中验证丢回执、持久身份恢复、跨项目同scope阻止新写、accepted→unknown→terminal的同key核对；这部分是离线故障测试，与上述真实浏览器／服务证据分别列出。无设计稿／验收脚本修改；无全仓回归或原生Electron验收。运行DB／临时代理与夹具脚本不提交，服务验收后关闭。
