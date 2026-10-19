# P13/P23 Recovery 正式 GUI 与真实执行验收

本批基线 d659fe9，独立分支 `codex/parity-recovery-gui`。权威 `opencode-workflow-design-showcase/originals/main/pages/recovery.html`，设计稿与验收脚本未改。

## 实测发现并修复

1. 原页只有三种文字选项，没有真实阶段差异。新增只读 `GET /api/tasks/:id/recovery/preview?mode=…`，返回冻结计划身份、逐阶段来源状态与“复制／仅上下文／只核对”差异、工作区策略、服务允许与禁用原因。左栏从真实执行读进度／失败／阶段，未知读取不能假显示旧数据。
2. 明确确认之前不写入；创建携带预览来源修订，服务在快照前后复核父任务／冻结计划／执行／文件内容及目录基线。来源变化拒绝，不静默用新内容替换已审阅预览。同一原key继续按原回执重放。
3. 修复把命令响应当成裸资源、创建后固定跳需求页的问题；成功读真实receipt/resource，保留创建成功、原key和“打开草稿”入口，不自动开始。网络不明不再称“未创建”。
4. 读取既有pending身份，模式与创建在UNKNOWN期间锁定；刷新保留模式和原key，只通过原key核对解锁；同页执行写入口也不能在未核对时绕过锁。历史读取失败显示真实错误与重试。
5. 恢复工作区现在记录实际已完成准备步骤，目录分支步骤明确“已核对：不创建Git分支”，不把已执行的工作区创建显示成未知。恢复页面标题与嵌套恢复地址的面包屑对应正式身份。

## 实际服务与 CUA

全部浏览器交互经 CUA Chrome，未用脚本操纵 DOM 或 BrowserWindow。5401为独立真实服务，数据 `/tmp/aw-p23-recovery-gui-20261020/data`。Git、工作树和目录文件真实存在，公共临时文件不含项目私密资料。初始失败节点／尝试是明确标注的可控故障夹具，不能冒充模型输出；派生后真实模型执行另外列证。

| 来源 | 父任务 | 从失败阶段 | 全部阶段 | 只读验证 |
| --- | --- | --- | --- | --- |
| 实际Git | task_0mvfmrsmdn1c7qiizgv | task_0mvfmsqhyeg741o5e2f | task_0mvfmt3x43x5811wbnd | task_0mvfmtdxzueonfjim0s |
| 实际目录 | task_0mvfmrsqpv5hqd71rdi | task_0mvfmv4j632upw8fzxj | task_0mvfn1a00vjclk7lq4n | task_0mvfn1hugj30o07di7t |

两类来源均由 CUA完成三模式差异预览→确认→实际创建。失败恢复各复制 `failed/future` 两节点，全部恢复复制 `done/failed/future` 三节点；新计划未确认且 `baseRevisionId` 指向父冻结计划，职业快照／输入随原计划保留。来源记录的 `parentTaskId` 一致，历史真实列出三份派生，绝不改写父执行。失败恢复实际文件为 `public fixture partial output retained`，全部恢复实际文件为 `public fixture baseline`，新路径与父路径独立。只读派生 `readOnly=true`，没有计划、工作区、执行；需求画布生成计划／骨架均由服务给出 RECOVERY_READ_ONLY 禁用原因。

### 实际网络丢回执

5402为临时受控代理，仅对第一次恢复POST在真正后端处理完成后丢弃响应，其他请求转发5401；不篡改服务结果。CUA在目录父任务提交 `req_0mvfmv4j0k84f0su8g0` 后看到UNKNOWN，创建与模式禁用；刷新原key仍在且不能重复创建。点击局部“核对原操作”读回succeeded，准确打开 `task_0mvfmv4j632upw8fzxj`，历史只有一份该恢复任务，未重发原写。

### 真实配置模型：派生准备→确认→执行

Git失败恢复 `task_0mvfmsqhyeg741o5e2f`：CUA审阅冻结计划，单独确认计划；真实恢复工作区已ready，再单独点击开始。实际受管OpenCode执行 `exec_0mvfmwuz8f096le3eug`，没有向模型端口注入结果。

- `attempt_0mvfmx3383qo40sojjw`：19:15:50.373Z→19:16:12.943Z，succeeded；实际 workspace.file.read 读 `source.txt`，返回保留的公开临时内容，未写文件。真实用量 input13183/output707/reasoning15/cache41472/total55377。
- `attempt_0mvfmxki930xubjhiz5`：19:16:12.945Z→19:16:27.795Z，succeeded；真实用量 input3826/output444/reasoning64/cache30976/total35310。
- CUA看到第一步完成、第二步运行，再看到2/2完成；刷新仍completed。父failed执行、父文件与派生源文件读回不变。该验收只证明这两个公开资料核对步骤，不扩张为任意恢复任务的模型质量证明。

## 证据与验证边界

本机 `/tmp/p23-recovery-evidence/` 保留：三模式预览／确认／创建、UNKNOWN／刷新锁定／原key核对、只读禁用、冻结计划确认、工作区准备、真实执行中／完成和刷新截图。四主题正式恢复页截图 `recovery-*-final.png`；`recovery-github-white-top.png`为完整顶部两栏。`service-readback.json`、`git-lineage-history.json`、`real-model-complete-readback.json`保留真实服务／SQLite／文件读回。截图和运行DB不提交入仓。

类型检查与Web构建退出0；六组针对测试12/12通过，新增预览测试验证只读、三模式差异、文件变更STALE_TARGET、确认来源修订成功、原key同任务重放和未知执行不可写。现有真实Git／目录隔离、只读约束和路由契约回归通过；未改验收脚本，未跑全仓。

GUI另发现TaskCanvas对verify_only空计划仍提示准备工作区，已交Lead修正TaskCanvas／ExecutionPanel／TrackingPanel，本批未越界修改。服务和需求画布的真实只读禁用已证明；Lead整合后须复核该跨页面提示。没有原生Electron验收，本轮是浏览器CUA+真实服务+上述真实模型层。

## Lead 服务交接

启动脚本 `/tmp/p23-gui-server.mts`，cwd为本独立worktree，命令 `node --import tsx /tmp/p23-gui-server.mts`；5401会读取本worktree `apps/web/dist`。可用环境 `AGENT_WORKFLOW_WEB_DIST`指定整合后的Web dist后重启同脚本，同一数据保留。需运行时正常写本机日志。当前服务exec session62802（PID3833）保留给Lead；SIGINT正常关闭。5402故障代理session66583已单独关闭。未提交夹具脚本／数据／凭据，不推送。
