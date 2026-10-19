# HTTP API（v1，实现以 `packages/shared/src/api/contracts.ts` 的 `ROUTES` 为准）

所有响应信封：成功 `{ data, meta:{requestId,at,revision?} }`；失败
`{ error:{code,message,details?,requestId,at,retryable} }`。错误码见 `packages/shared/src/errors.ts`。

## 基础

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/health` | 进程存活 |
| GET | `/api/bootstrap` | app/settings/themes/catalog/projects/tasks/inbox/integration/counts/data |
| GET | `/api/events?afterSeq=` | SSE 事件流（先发 ready，再补播，随后增量） |

## 项目 / 任务 / 需求

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET/POST | `/api/projects` | 列表（`{items}`）/ 登记项目（requestKey） |
| GET/PATCH | `/api/projects/:id` | 详情 / 更新 |
| GET/POST | `/api/tasks` | 列表（`{items}`，支持 projectId/stage/attention/q）/ 形成需求草稿 |
| GET | `/api/tasks/:id`、`/api/tasks/:id/detail` | 任务详情（task/project/plan/planning/execution/workspace/delivery/capabilities） |
| GET | `/api/tasks/:id/requirement` | 需求原文、条目、方法与能力 |
| PATCH | `/api/tasks/:id` | 保存草稿/补充需求 |

## 规划

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/tasks/:id/planning` | 轮次、当前轮、动作可用性 |
| POST | `/api/tasks/:id/planning/preview` | 只读预览（valid 15 分钟） |
| POST | `/api/tasks/:id/planning/start` | 开始规划（调用模型，异步） |
| POST | `/api/tasks/:id/planning/stop` | 请求停止 |
| POST | `/api/tasks/:id/planning/reconcile` | 只按原轮次核对 |
| POST | `/api/tasks/:id/planning/apply` | 应用候选（需人工判断逐项 accepted） |
| POST | `/api/tasks/:id/planning/reject` | 不采用 |
| POST | `/api/tasks/:id/planning/answers` | 保存业务问题答复（生成需求修订） |
| GET | `/api/tasks/:id/planning/record?roundId=&afterSeq=` | 规划记录（model_text/tool_activity/service_event + 缺口） |

## 计划 / 工作区 / 执行

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/tasks/:id/plan` | 当前计划、历史、动作 |
| GET | `/api/tasks/:id/plan/revisions/:revisionId` | 按修订读计划（候选/检查点图层） |
| POST | `/api/tasks/:id/plan/skeleton` | 使用方法骨架 |
| POST | `/api/tasks/:id/plan/confirm` | 确认计划（创建 execution + workspace） |
| POST | `/api/tasks/:id/plan/edit/{begin,save,finish}` | 执行中调整待执行计划 |
| GET | `/api/tasks/:id/plan/nodes/:nodeId` | 节点详情（输入/输出/验收/资源/attempt/输出） |
| GET | `/api/tasks/:id/workspace` | 工作区视图 |
| POST | `/api/tasks/:id/workspace/prepare` | 准备独立工作区（git worktree / 目录副本） |
| POST | `/api/tasks/:id/workspace/cleanup/{preview,confirm}` | 清理预览 / 确认 |
| GET | `/api/tasks/:id/changes` | 任务变更集 |
| GET | `/api/tasks/:id/changes/files/:fileId/diff` | 文件 diff |
| GET | `/api/tasks/:id/execution` | 执行视图 |
| POST | `/api/tasks/:id/execution/{start,pause,resume,cancel}` | 执行命令 |
| GET | `/api/tasks/:id/nodes/:nodeId/{attempts,output}` | 尝试与输出 |

## 交付

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/tasks/:id/delivery` | 交付投影、步骤、资格 |
| POST | `.../delivery/select` | 选择目标/文件 |
| POST | `.../delivery/commit` | 提交（CAS changesRevision / branch head） |
| POST | `.../delivery/push` | 推送（create-only，无 force） |
| POST | `.../delivery/merge-request` | 创建 MR（远端适配器待接线） |
| POST | `.../delivery/merge` | 临时 worktree 合并到目标分支 + CAS |

## Git 读口

`GET /api/git/repos`、`/api/git/repos/:projectId`、`/commits`、`/commits/:sha`、`/commits/:sha/files`、
`/diff?path=&baseSha=&headSha=`、`/branches`、`/merge-requests`；`POST /fetch` 当前明确返回未接通。

## 操作 / 设置 / OpenCode / 数据库

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/operations/:key` | 按原 requestKey 核对回执 |
| GET/PATCH | `/api/settings` | 设置读取/保存（服务端校验；失败返回 issues） |
| GET | `/api/settings/databases` | 数据库连接列表 |
| POST | `/api/settings/databases` | 注册/更新连接（密码进 secrets，返回不含密码） |
| POST | `/api/settings/databases/:id/probe`、`/query` | 探针 / 只读查询 |
| GET | `/api/opencode/status` | 受管服务状态、模型、MCP 连接 |
| POST | `/api/opencode/restart` | 重启受管服务 |

## 内部 MCP 回环（Bearer `AGENT_WORKFLOW_MCP_TOKEN`）

`GET /internal/mcp/context`、`POST /internal/mcp/plan-submit`、`POST /internal/mcp/question`、
`POST /internal/mcp/result-submit`、`GET /internal/mcp/git/{status,log,diff-files,commit-show}`、
`POST /internal/mcp/database/query`、`GET /internal/mcp/workspace/file|files`、
`POST /internal/mcp/workspace/{file-write,exec}`。
