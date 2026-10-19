# P06 快照评审专用实际模型与 GUI 验收

本批从 Lead 151c232 独立工作树验证既有 P06 实现，未改生产逻辑、PPT、运行时和既有验收条件。只增加专用 opt-in live 测试、明确离线失败控制流回归，以及验证文档/截图；更新任务板 P06。

## 实际模型证据

新增 `tests/integration/snapshot-review-live.test.ts`：`AGENT_WORKFLOW_LIVE=1 AGENT_WORKFLOW_GUI_REVIEW=1 node --import tsx --test tests/integration/snapshot-review-live.test.ts`。本轮1/1通过，约285秒（含GUI人工核验等待），不是普通节点问答或通用Git提交评审。

使用临时公开Git项目：两个TS源码（常量与可空参数错误），README在范围外。先提交基线，再提交固定目标；两个任务都经正式任务创建、固定模板计划、确认、工作区准备、执行API。实际受管OpenCode1.19 + 配置的 opencode-go/deepseek-v4.1-flash 调用，无合成模型输出或伪造成功结果。原仓库 HEAD 和工作区状态全程不变。

| 任务配置 | 分析文件 | 独立复核文件 | 实际会话 | 实际token usage total（含缓存） |
| --- | --- | --- | --- | --- |
| full / full | 2 | 2 | 分析与复核独立2会话 | 49628 / 51102 |
| incremental / lightweight | 2 | 1 | 分析与复核独立2会话 | 64902 / 49792 |

每个已提交单元都核对服务端 `snapshot.read` 的精确blob；独立复核单元集合严格匹配：full全量，light仅上游实际含候选问题的单元。常量文件没有问题，light不派该文件给独立模型。可空参数错误由分析提出，再由独立会话确认；报告保留候选身份、行号和复核依据。报告中的“实测”措辞属于模型原始表述：本链证实冻结源码读取与静态独立推理，不声称执行了被审查函数。

两个任务均实际捕获“已分析2、待复核分别2/1、未分析0”的阶段报告，再到服务汇总完成。最终均已分析2、未分析0、待复核0、排除1。读取和下载HTTP正文完全相同，操作没有重启执行或写原源码。

## 专用 GUI 与实际下载

通过任务画布“更多任务操作→快照评审→模板报告”，分别核对full、增量light固定基线/目标、三阶段完成和真实范围。报告读取前下载禁用；读取后正文可滚动阅读，展示分析摘要、已确认问题、独立复核依据、未完成及排除范围。

Chrome点击“下载 Markdown”实际保存报告，独立核对文件1794字节，SHA256 `baee5b8d9b186500e2f666d0355c97297312adf230ab6bfdc3a600868b0aee1c`；正文包含固定目标SHA、两文件分析和复核依据。文件只含临时公开源码证据，不提交运行数据或下载文件。

为可重复观察loading，GUI代理仅对真实report GET增加3秒延迟，不替换或伪造响应；确认“读取中…”、骨架和下载禁用。随后在临时数据目录人为改坏已读取报告文件，实际完整性校验拒绝下载，GUI提示错误、清空旧正文并禁用下载；重新读取重新生成有效报告，可继续阅读。该操作不影响已完成的模型证据。

## 失败保留可读：明确离线控制流

新增 `snapshot-review-domain.test.ts` 的离线派发故障回归。真实Git/SQLite/HTTP和执行服务，运行端口在创建会话前明确抛错，无模型结果：分析节点实际failed，配置使后续领取暂停；GUI项目/任务标题明确“离线端口夹具”。失败后仍能从专用入口读取与下载报告，诚实显示已分析0、未完成2、排除1，不把失败当干净。读/下载不增加派发次数且不改变执行。GUI也已正式点击读取和下载。

GUI命令：`AGENT_WORKFLOW_SNAPSHOT_FAILURE_GUI=1 node --import tsx --test --test-name-pattern='offline dispatch failure' tests/integration/snapshot-review-domain.test.ts`。本轮1/1通过。此项只证明离线控制流及失败界面，不当真实模型失败验收；正常full/light有独立实际模型证据。

## 回归与边界

- snapshot domain + snapshot engine focused：5/5；typecheck通过；新增live默认跳过，需明确环境开关才调用模型。
- 无生产文件变更，未重复全仓build；Lead正在主线做全仓整合回归。
- `docs/evidence/snapshot-review-live-2026-10-20/`：full/light范围与正文、报告loading、完整性失败清空/重新读取、离线执行失败可读，共8图。
- 本轮是两个文件的一批范围；大仓库多批量性能、所有严重度分类、远端推送/合并不是本次实际模型验收内容。既有取消报告可读、篡改拒绝和精确来源单元回归保留。
