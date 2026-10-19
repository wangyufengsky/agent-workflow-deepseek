# 真实模型验收补漏：会话期限、嵌套写入与原生问答

## 根因与修复

- 执行策略与 SessionRunner 将 `timeoutMs=0` 定义为无业务时限，但会话工具授权原先仍在 30 秒后到期。实际模型在等待回答或写测试时被 `FORBIDDEN` 阻止提交结果。现在仅 0 使用活动会话生命周期；正常有时限仍为截止时间加 30 秒，负值不放宽。结束/失败/停止的 `finally revoke()` 和当前任务/节点状态校验仍生效。
- 授权文件写入原先未建立新父目录，真实写入 `test/add.test.mjs` 得到 ENOENT。现在在通过角色范围、路径边界、内容大小与旧内容 hash 校验后创建目录，再核对实际路径；独占随机临时文件替换并清理。没有新增 shell/mkdir 权限。
- 原生答复只刷新事项列表，侧边栏 bootstrap 仍显示旧数量。答复及原 key 核对同步刷新；Shell 订阅实际状态事件并在 SSE 不可用时只读轮询，避免新问题/处理完成后角标滞留。

## 真实原生问题及 GUI 验收

- `runtime-inbox-live.test.ts` 实际启动受管 OpenCode 和配置模型，普通执行节点主动调用原生 question，不伪造 sink 事件。
- 修复后任务 `task_0mvflyz9v54zg9jzoyd` / attempt `attempt_0mvflyzcogvc557lkbw` / session `ses_eaa80d309ffebOQE0QEcZpg6PG`。真实问题在 18:49:25 UTC 到达；超过旧 30 秒期限后，在正式 IAB 选择 Markdown、HTML 并填写其他“PDF 附件”。
- 界面提交回执 `req_0mvflzz810herdivn18` succeeded，队列和侧边栏同时清零。同一个 session 继续，通过 workflow.result.submit 提交真实结果，复述三个选择；执行 completed。1/1 live 测试退出 0。
- 截图：`docs/evidence/native-question-live-2026-10-20/answer-draft-fixed.png`、`answer-receipt-fixed.png`。同目录不带 fixed 的截图是首次真实运行，后续提交因旧期限失败，仅保留发现过程，不是成功验收。
- 本次真实问答事件的协议标记为 legacy；V2 来自已记录的 HTTP/运行时协议验证。没有把这次问题答复扩大为真实模型 soft permission 事件、其它业务域或全部设计状态的验收。

## 回归记录

- 会话授权原有不可预测、不可变、隔离和撤销测试保留；新增时间推进验证无限时/有上限的真实差异，连同角色权限回归 4/4 通过。
- 逐文件证据相关 7/7 回归，包括真实嵌套文件创建、旧 hash 拒绝覆盖、无临时文件残留与符号链接越界拒绝。
- 整合后全仓快照：586 项、573 通过、13 项 opt-in 跳过、0 失败。此计数对应恢复原 session-scope 既有测试之前；恢复后的该文件及角色权限 4/4 已单独复验，最终全仓计数另记，不称此轮为最终验收。
- 类型检查、Web 构建通过。真实逐文件完整链仍独立运行，结果另记 P09，不能由问答成功替代。

## 活动页面关闭服务

真实 GUI 连接使 Fastify 等待长驻 SSE 请求，测试结果已完成但应用无法结束。HTTP路由现在登记流关闭函数，在 preClose 主动结束事件流并清除订阅/心跳；普通业务请求仍正常完成。`sse-shutdown.test.ts` 启真实服务与HTTP长连接，收到ready后不关闭客户端直接关闭服务，确认完整结束；1/1通过。这是实际服务关闭验证，不是UI退出测试。
