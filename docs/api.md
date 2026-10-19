# HTTP API（v1）

> 本文件由 `npm run docs:api`（`scripts/check-docs-routes.mjs --write`）从
> `packages/shared/src/api/contracts.ts` 的 `ROUTES` 与服务端注册路由生成；请勿手改。
> 实现以 **ROUTES + 服务端注册** 为准；`npm run check:docs-routes` 校验文档覆盖与契约/路由一致性，
> 已接入 `npm run verify`。契约或路由变化后运行 `npm run docs:api` 重新生成。
>
> 响应信封：成功 `{ data, meta:{requestId,at,revision?} }`；失败
> `{ error:{code,message,details?,requestId,at,retryable} }`。错误码见 `packages/shared/src/errors.ts`。
>
> 写操作统一 `requestKey` + 回执（`accepted → succeeded / failed / unknown`）；UNKNOWN 只能按原 key
> 查 `GET /api/operations/:key` 核对，不自动重发。GET 为读口；表中「回执 / 语义」列注明每行的写语义。
>
> 不在下表的非契约路由：`GET /`（SPA index）与 `GET /assets/*`（静态资源）；它们不参与 `/api` 契约。
> 表中方法来自服务端实际注册；同一路径存在读/写方法时合并展示。

## 基础

| 方法 | 路径 | 用途 | 回执 / 语义 |
| --- | --- | --- | --- |
| GET | `/api/bootstrap` | 应用启动快照（设置/主题/目录/项目/任务/收件箱/集成/计数/数据） | 读口；无写回执 |
| GET | `/api/events` | SSE 事件流（先发 ready，再补播，随后增量） | SSE：`ready` → 补播 → 增量 |
| GET | `/api/fs/directories` | 只读目录浏览（目录名与 `.git` 标记；要求绝对路径） | 读口；无写回执 |
| GET | `/api/health` | 进程存活探针 | 读口；无写回执 |
| GET | `/api/operations/:key` | 按原 requestKey 核对回执（UNKNOWN 的唯一核对入口） | 读口；无写回执 |

## 项目 / 任务 / 需求

| 方法 | 路径 | 用途 | 回执 / 语义 |
| --- | --- | --- | --- |
| GET / POST | `/api/projects` | 项目列表 / 登记项目（requestKey） | GET 读口；写命令：`requestKey` + 回执（accepted→succeeded/failed/unknown；UNKNOWN 按 by-key 核对） |
| GET / PATCH | `/api/projects/:id` | 项目详情 / 更新项目 | GET 读口；写命令：`requestKey` + 回执（accepted→succeeded/failed/unknown；UNKNOWN 按 by-key 核对） |
| POST | `/api/projects/:id/recheck` | 重新检测项目路径与 Git 状态 | 写命令：`requestKey` + 回执（accepted→succeeded/failed/unknown；UNKNOWN 按 by-key 核对） |
| GET / POST | `/api/tasks` | 任务列表 / 形成需求草稿（requestKey） | GET 读口；写命令：`requestKey` + 回执（accepted→succeeded/failed/unknown；UNKNOWN 按 by-key 核对） |
| GET / PATCH | `/api/tasks/:id` | 任务详情 / 保存草稿或补充需求 | GET 读口；写命令：`requestKey` + 回执（accepted→succeeded/failed/unknown；UNKNOWN 按 by-key 核对） |
| GET / POST | `/api/tasks/:id/acceptance` | 人工验收结论读取 / 记录（通过/驳回 + 备注） | GET 读口；写命令：`requestKey` + 回执（accepted→succeeded/failed/unknown；UNKNOWN 按 by-key 核对） |
| GET | `/api/tasks/:id/detail` | 任务详情聚合（计划/规划/执行/工作区/交付/能力） | 读口；无写回执 |
| POST | `/api/tasks/:id/plan/from-template` | 按固定模板生成计划 | 写命令：`requestKey` + 回执（accepted→succeeded/failed/unknown；UNKNOWN 按 by-key 核对） |
| GET | `/api/tasks/:id/recoveries` | 恢复派生草稿历史 | 读口；无写回执 |
| POST | `/api/tasks/:id/recovery` | 创建恢复派生草稿 | 写命令：`requestKey` + 回执（accepted→succeeded/failed/unknown；UNKNOWN 按 by-key 核对） |
| GET | `/api/tasks/:id/requirement` | 需求原文、条目、方法与能力 | 读口；无写回执 |

## 规划

| 方法 | 路径 | 用途 | 回执 / 语义 |
| --- | --- | --- | --- |
| GET | `/api/tasks/:id/planning` | 规划轮次、当前轮与动作可用性 | 读口；无写回执 |
| POST | `/api/tasks/:id/planning/answers` | 保存业务问题答复（生成需求修订） | 写命令：`requestKey` + 回执（accepted→succeeded/failed/unknown；UNKNOWN 按 by-key 核对） |
| POST | `/api/tasks/:id/planning/apply` | 应用候选（需人工逐项 accepted） | 写命令：`requestKey` + 回执（accepted→succeeded/failed/unknown；UNKNOWN 按 by-key 核对） |
| POST | `/api/tasks/:id/planning/preview` | 规划只读预览（预算/时限/规模/有效期） | 写命令：`requestKey` + 回执（accepted→succeeded/failed/unknown；UNKNOWN 按 by-key 核对） |
| POST | `/api/tasks/:id/planning/reconcile` | 按原轮次核对规划结果 | 写命令：`requestKey` + 回执（accepted→succeeded/failed/unknown；UNKNOWN 按 by-key 核对） |
| GET | `/api/tasks/:id/planning/record` | 规划记录（模型正文/工具/服务事件） | 读口；无写回执 |
| POST | `/api/tasks/:id/planning/reject` | 不采用候选 | 写命令：`requestKey` + 回执（accepted→succeeded/failed/unknown；UNKNOWN 按 by-key 核对） |
| POST | `/api/tasks/:id/planning/start` | 开始规划（异步模型会话） | 写命令：`requestKey` + 回执（accepted→succeeded/failed/unknown；UNKNOWN 按 by-key 核对） |
| POST | `/api/tasks/:id/planning/stop` | 请求停止规划（停稳后结算） | 写命令：`requestKey` + 回执（accepted→succeeded/failed/unknown；UNKNOWN 按 by-key 核对） |

## 计划 / 工作区 / 执行

| 方法 | 路径 | 用途 | 回执 / 语义 |
| --- | --- | --- | --- |
| GET | `/api/tasks/:id/changes` | 任务变更集 | 读口；无写回执 |
| GET | `/api/tasks/:id/changes/files/:fileId/diff` | 文件 diff | 读口；无写回执 |
| GET | `/api/tasks/:id/execution` | 执行视图 | 读口；无写回执 |
| POST | `/api/tasks/:id/execution/advance` | 手动推进（整体或指定步骤的直接后继） | 写命令：`requestKey` + 回执（accepted→succeeded/failed/unknown；UNKNOWN 按 by-key 核对） |
| POST | `/api/tasks/:id/execution/auto-advance` | 切换自动推进（requestKey + 回执） | 写命令：`requestKey` + 回执（accepted→succeeded/failed/unknown；UNKNOWN 按 by-key 核对） |
| POST | `/api/tasks/:id/execution/cancel` | 取消执行（保留工作区） | 写命令：`requestKey` + 回执（accepted→succeeded/failed/unknown；UNKNOWN 按 by-key 核对） |
| POST | `/api/tasks/:id/execution/nodes/:nodeId/skip` | 跳过节点及全部下游 | 写命令：`requestKey` + 回执（accepted→succeeded/failed/unknown；UNKNOWN 按 by-key 核对） |
| POST | `/api/tasks/:id/execution/pause` | 暂停执行 | 写命令：`requestKey` + 回执（accepted→succeeded/failed/unknown；UNKNOWN 按 by-key 核对） |
| POST | `/api/tasks/:id/execution/resume` | 继续执行 | 写命令：`requestKey` + 回执（accepted→succeeded/failed/unknown；UNKNOWN 按 by-key 核对） |
| POST | `/api/tasks/:id/execution/retry` | 按原配置重试失败步骤 | 写命令：`requestKey` + 回执（accepted→succeeded/failed/unknown；UNKNOWN 按 by-key 核对） |
| POST | `/api/tasks/:id/execution/start` | 开始执行 | 写命令：`requestKey` + 回执（accepted→succeeded/failed/unknown；UNKNOWN 按 by-key 核对） |
| GET | `/api/tasks/:id/nodes/:nodeId` | 节点详情 | 读口；无写回执 |
| POST | `/api/tasks/:id/nodes/:nodeId/accept` | 人工验收通过节点 | 写命令：`requestKey` + 回执（accepted→succeeded/failed/unknown；UNKNOWN 按 by-key 核对） |
| GET | `/api/tasks/:id/nodes/:nodeId/attempts` | 节点尝试列表 | 读口；无写回执 |
| GET | `/api/tasks/:id/nodes/:nodeId/output` | 节点输出（attempt / afterSeq） | 读口；无写回执 |
| POST | `/api/tasks/:id/nodes/:nodeId/reject` | 人工退回修改节点 | 写命令：`requestKey` + 回执（accepted→succeeded/failed/unknown；UNKNOWN 按 by-key 核对） |
| GET | `/api/tasks/:id/plan` | 当前计划、历史与动作 | 读口；无写回执 |
| POST | `/api/tasks/:id/plan/confirm` | 确认计划（创建 execution + workspace） | 写命令：`requestKey` + 回执（accepted→succeeded/failed/unknown；UNKNOWN 按 by-key 核对） |
| POST | `/api/tasks/:id/plan/edit/abandon` | 放弃计划调整（恢复原自动推进设置） | 写命令：`requestKey` + 回执（accepted→succeeded/failed/unknown；UNKNOWN 按 by-key 核对） |
| POST | `/api/tasks/:id/plan/edit/begin` | 开始执行中调整计划 | 写命令：`requestKey` + 回执（accepted→succeeded/failed/unknown；UNKNOWN 按 by-key 核对） |
| POST | `/api/tasks/:id/plan/edit/finish` | 结束计划调整并继续 | 写命令：`requestKey` + 回执（accepted→succeeded/failed/unknown；UNKNOWN 按 by-key 核对） |
| POST | `/api/tasks/:id/plan/edit/save` | 保存计划调整（新修订） | 写命令：`requestKey` + 回执（accepted→succeeded/failed/unknown；UNKNOWN 按 by-key 核对） |
| GET | `/api/tasks/:id/plan/nodes/:nodeId` | 计划节点详情 | 读口；无写回执 |
| GET | `/api/tasks/:id/plan/revisions/:revisionId` | 按修订读取计划（候选/检查点） | 读口；无写回执 |
| POST | `/api/tasks/:id/plan/skeleton` | 使用流程方法骨架 | 写命令：`requestKey` + 回执（accepted→succeeded/failed/unknown；UNKNOWN 按 by-key 核对） |
| GET | `/api/tasks/:id/workspace` | 工作区视图 | 读口；无写回执 |
| POST | `/api/tasks/:id/workspace/cleanup/confirm` | 确认清理（回执、幂等） | 写命令：`requestKey` + 回执（accepted→succeeded/failed/unknown；UNKNOWN 按 by-key 核对） |
| POST | `/api/tasks/:id/workspace/cleanup/preview` | 清理预览（blockers / 删除对象） | 写命令：`requestKey` + 回执（accepted→succeeded/failed/unknown；UNKNOWN 按 by-key 核对） |
| POST | `/api/tasks/:id/workspace/prepare` | 准备独立工作区（worktree / 目录副本） | 写命令：`requestKey` + 回执（accepted→succeeded/failed/unknown；UNKNOWN 按 by-key 核对） |

## 交付

| 方法 | 路径 | 用途 | 回执 / 语义 |
| --- | --- | --- | --- |
| GET | `/api/tasks/:id/delivery` | 交付投影、步骤与资格 | 读口；无写回执 |
| POST | `/api/tasks/:id/delivery/apply` | 非 Git 应用到原目录（冻结预览 + 逐项） | 写命令：`requestKey` + 回执（accepted→succeeded/failed/unknown；UNKNOWN 按 by-key 核对） |
| POST | `/api/tasks/:id/delivery/apply/preview` | 非 Git 应用预览（只读） | 写命令：`requestKey` + 回执（accepted→succeeded/failed/unknown；UNKNOWN 按 by-key 核对） |
| POST | `/api/tasks/:id/delivery/commit` | 提交（CAS changesRevision / branch head） | 写命令：`requestKey` + 回执（accepted→succeeded/failed/unknown；UNKNOWN 按 by-key 核对） |
| POST | `/api/tasks/:id/delivery/merge` | 合并到目标分支（临时 worktree + CAS） | 写命令：`requestKey` + 回执（accepted→succeeded/failed/unknown；UNKNOWN 按 by-key 核对） |
| POST | `/api/tasks/:id/delivery/merge-request` | 创建 MR | 写命令：`requestKey` + 回执（accepted→succeeded/failed/unknown；UNKNOWN 按 by-key 核对） |
| POST | `/api/tasks/:id/delivery/push` | 推送（create-only，无 force） | 写命令：`requestKey` + 回执（accepted→succeeded/failed/unknown；UNKNOWN 按 by-key 核对） |
| POST | `/api/tasks/:id/delivery/select` | 选择交付目标 / 文件 | 写命令：`requestKey` + 回执（accepted→succeeded/failed/unknown；UNKNOWN 按 by-key 核对） |

## Git 读口

| 方法 | 路径 | 用途 | 回执 / 语义 |
| --- | --- | --- | --- |
| GET | `/api/git/repos` | Git 仓库概览 | 读口；无写回执 |
| GET | `/api/git/repos/:projectId` | 单仓库读模型 | 读口；无写回执 |
| GET | `/api/git/repos/:projectId/branches` | 分支列表 | 读口；无写回执 |
| GET | `/api/git/repos/:projectId/commits` | 提交列表（分页 / 筛选） | 读口；无写回执 |
| GET | `/api/git/repos/:projectId/commits/:sha` | 提交详情 | 读口；无写回执 |
| GET | `/api/git/repos/:projectId/commits/:sha/files` | 提交文件列表（可对比基线） | 读口；无写回执 |
| GET | `/api/git/repos/:projectId/diff` | 文件 diff（统一 / 并排 / 忽略空白） | 读口；无写回执 |
| POST | `/api/git/repos/:projectId/fetch` | 拉取远端引用（requestKey + 回执） | 写命令：`requestKey` + 回执（accepted→succeeded/failed/unknown；UNKNOWN 按 by-key 核对） |
| GET | `/api/git/repos/:projectId/merge-requests` | MR 列表 | 读口；无写回执 |
| GET | `/api/git/repos/:projectId/merge-requests/:iid` | 单个 MR 详情（契约预留；服务端未注册，当前 404） | 契约预留：服务端未注册（当前 404）；列表接口已实现 |

## AI 审查 / 修复

| 方法 | 路径 | 用途 | 回执 / 语义 |
| --- | --- | --- | --- |
| GET | `/api/git/repos/:projectId/commits/:sha/reviews` | 提交的审查投影 | 读口；无写回执 |
| POST | `/api/git/repos/:projectId/findings/:findingId` | 接受 / 忽略 / 误报 finding | 写命令：`requestKey` + 回执（accepted→succeeded/failed/unknown；UNKNOWN 按 by-key 核对） |
| GET | `/api/git/repos/:projectId/fixes` | 修复记录列表 | 读口；无写回执 |
| GET | `/api/git/repos/:projectId/fixes/:fixRunId` | 修复详情 | 读口；无写回执 |
| POST | `/api/git/repos/:projectId/fixes/:fixRunId/commit` | 提交修复 | 写命令：`requestKey` + 回执（accepted→succeeded/failed/unknown；UNKNOWN 按 by-key 核对） |
| GET | `/api/git/repos/:projectId/fixes/:fixRunId/diff` | 修复权威 diff | 读口；无写回执 |
| POST | `/api/git/repos/:projectId/fixes/:fixRunId/discard` | 放弃修复并清理 | 写命令：`requestKey` + 回执（accepted→succeeded/failed/unknown；UNKNOWN 按 by-key 核对） |
| POST | `/api/git/repos/:projectId/fixes/:fixRunId/files/:fileId/revert` | 撤销单个修复文件 | 写命令：`requestKey` + 回执（accepted→succeeded/failed/unknown；UNKNOWN 按 by-key 核对） |
| POST | `/api/git/repos/:projectId/fixes/:fixRunId/merge` | 合并修复分支（no-ff + CAS） | 写命令：`requestKey` + 回执（accepted→succeeded/failed/unknown；UNKNOWN 按 by-key 核对） |
| POST | `/api/git/repos/:projectId/fixes/:fixRunId/merge-request` | 创建修复 MR | 写命令：`requestKey` + 回执（accepted→succeeded/failed/unknown；UNKNOWN 按 by-key 核对） |
| POST | `/api/git/repos/:projectId/fixes/:fixRunId/push` | 推送修复分支 | 写命令：`requestKey` + 回执（accepted→succeeded/failed/unknown；UNKNOWN 按 by-key 核对） |
| POST | `/api/git/repos/:projectId/fixes/:fixRunId/stop` | 请求停止修复 | 写命令：`requestKey` + 回执（accepted→succeeded/failed/unknown；UNKNOWN 按 by-key 核对） |
| POST | `/api/git/repos/:projectId/fixes/start` | 开始 AI 修复（隔离 worktree） | 写命令：`requestKey` + 回执（accepted→succeeded/failed/unknown；UNKNOWN 按 by-key 核对） |
| GET | `/api/git/repos/:projectId/reviews` | 审查记录列表 | 读口；无写回执 |
| GET | `/api/git/repos/:projectId/reviews/:reviewRunId` | 审查详情 | 读口；无写回执 |
| GET | `/api/git/repos/:projectId/reviews/:baseId/compare/:targetId` | 两次审查对比（已解决 / 新增 / 仍存在） | 读口；无写回执 |
| POST | `/api/git/repos/:projectId/reviews/:reviewRunId/stop` | 请求停止审查 | 写命令：`requestKey` + 回执（accepted→succeeded/failed/unknown；UNKNOWN 按 by-key 核对） |
| POST | `/api/git/repos/:projectId/reviews/start` | 开始 AI 审查 | 写命令：`requestKey` + 回执（accepted→succeeded/failed/unknown；UNKNOWN 按 by-key 核对） |

## 角色 / 模板目录

| 方法 | 路径 | 用途 | 回执 / 语义 |
| --- | --- | --- | --- |
| GET / POST | `/api/catalog/roles` | 角色目录列表；保存角色草稿 / 自定义角色 | 写命令：`requestKey` + 回执（accepted→succeeded/failed/unknown；UNKNOWN 按 by-key 核对） |
| POST | `/api/catalog/roles/:id/archive` | 归档角色 | 写命令：`requestKey` + 回执（accepted→succeeded/failed/unknown；UNKNOWN 按 by-key 核对） |
| GET | `/api/catalog/roles/:id/history` | 角色发布历史 | 读口；无写回执 |
| POST | `/api/catalog/roles/:id/publish` | 发布角色（修订递增） | 写命令：`requestKey` + 回执（accepted→succeeded/failed/unknown；UNKNOWN 按 by-key 核对） |
| POST | `/api/catalog/roles/:id/restore/:revision` | 恢复历史快照为草稿 | 写命令：`requestKey` + 回执（accepted→succeeded/failed/unknown；UNKNOWN 按 by-key 核对） |
| POST | `/api/catalog/roles/:id/validate` | 发布前检查（非变更，返回 checks/canPublish） | 写命令：`requestKey` + 回执（accepted→succeeded/failed/unknown；UNKNOWN 按 by-key 核对） |
| PATCH / DELETE | `/api/catalog/templates/:id` | 更新模板（新版本）；归档自定义模板 | 写命令：`requestKey` + 回执（accepted→succeeded/failed/unknown；UNKNOWN 按 by-key 核对） |
| POST | `/api/catalog/templates/import` | 导入自定义模板 | 写命令：`requestKey` + 回执（accepted→succeeded/failed/unknown；UNKNOWN 按 by-key 核对） |
| GET | `/api/templates/:id` | 固定模板详情 | 读口；无写回执 |
| GET | `/api/templates/:id/tasks` | 模板创建的任务历史 | 读口；无写回执 |

## 知识库

| 方法 | 路径 | 用途 | 回执 / 语义 |
| --- | --- | --- | --- |
| POST | `/api/knowledge/ask` | 文档问答（模型；引用校验；写本机历史，无 requestKey 回执；可能 15–90 秒） | 写命令：`requestKey` + 回执（accepted→succeeded/failed/unknown；UNKNOWN 按 by-key 核对） |
| GET | `/api/knowledge/history` | 问答历史（每个项目最多 30 条） | 读口；无写回执 |
| GET | `/api/knowledge/search` | 来源搜索（只读） | 读口；无写回执 |
| GET | `/api/knowledge/source` | 来源正文（只读） | 读口；无写回执 |
| GET | `/api/knowledge/sources` | 知识来源清单（只读） | 读口；无写回执 |

## PPT

| 方法 | 路径 | 用途 | 回执 / 语义 |
| --- | --- | --- | --- |
| GET / POST | `/api/ppt/works` | PPT 作品列表 / 创建草稿 | GET 读口；写命令：`requestKey` + 回执（accepted→succeeded/failed/unknown；UNKNOWN 按 by-key 核对） |
| PATCH / DELETE | `/api/ppt/works/:id` | 作品更新或删除（单作品读取包含在列表响应中）；更新作品标题 / 主题 / 大纲 | 写命令：`requestKey` + 回执（accepted→succeeded/failed/unknown；UNKNOWN 按 by-key 核对） |
| POST | `/api/ppt/works/:id/attachments` | 添加文本 / 图片附件 | 写命令：`requestKey` + 回执（accepted→succeeded/failed/unknown；UNKNOWN 按 by-key 核对） |
| DELETE | `/api/ppt/works/:id/attachments/:name` | 移除附件 | 写命令：`requestKey` + 回执（accepted→succeeded/failed/unknown；UNKNOWN 按 by-key 核对） |
| GET | `/api/ppt/works/:id/export` | 导出 Markdown 大纲 | 读口；无写回执 |
| POST | `/api/ppt/works/:id/generate` | 生成大纲（模型） | 写命令：`requestKey` + 回执（accepted→succeeded/failed/unknown；UNKNOWN 按 by-key 核对） |
| POST | `/api/ppt/works/:id/generate-slides` | 生成逐页内容（模型） | 写命令：`requestKey` + 回执（accepted→succeeded/failed/unknown；UNKNOWN 按 by-key 核对） |
| GET | `/api/ppt/works/:id/pptx` | 导出 PPTX（二进制响应，非 envelope） | 二进制响应（非 envelope）；读口 |

## 洞察 / 验收

| 方法 | 路径 | 用途 | 回执 / 语义 |
| --- | --- | --- | --- |
| GET | `/api/insights` | 质量与用量汇总 | 读口；无写回执 |
| GET | `/api/insights/task-acceptance` | 逐任务人工验收 | 读口；无写回执 |
| GET | `/api/insights/task-quality` | 逐任务执行 / 审查质量 | 读口；无写回执 |
| GET | `/api/insights/task-usage` | 逐任务 token 用量 | 读口；无写回执 |

## 技能

| 方法 | 路径 | 用途 | 回执 / 语义 |
| --- | --- | --- | --- |
| GET | `/api/skills` | 已发现的 SKILL.md 元数据（只读） | 读口；无写回执 |
| GET | `/api/skills/:id/source` | Skill 源文（带行号，≤2000 行） | 读口；无写回执 |

## 设置 / OpenCode / 数据库

| 方法 | 路径 | 用途 | 回执 / 语义 |
| --- | --- | --- | --- |
| GET | `/api/opencode/detect` | 扫描本机 OpenCode 候选与版本（只读） | 读口；无写回执 |
| GET | `/api/opencode/logs` | 受管 OpenCode 日志尾部（脱敏） | 读口；无写回执 |
| POST | `/api/opencode/restart` | 重启受管 OpenCode | 写命令：`requestKey` + 回执（accepted→succeeded/failed/unknown；UNKNOWN 按 by-key 核对） |
| GET | `/api/opencode/status` | 受管 OpenCode 状态 / 模型 / MCP / 网关计数 | 读口；无写回执 |
| GET / PATCH | `/api/settings` | 设置读取 / 保存 | GET 读口；写命令：`requestKey` + 回执（accepted→succeeded/failed/unknown；UNKNOWN 按 by-key 核对） |
| GET / POST | `/api/settings/databases` | 数据库连接列表 / 登记 | GET 读口；写命令：`requestKey` + 回执（accepted→succeeded/failed/unknown；UNKNOWN 按 by-key 核对） |
| DELETE | `/api/settings/databases/:id` | 删除数据库连接（兼容无 body：服务端生成请求号） | 写命令：`requestKey` + 回执（accepted→succeeded/failed/unknown；UNKNOWN 按 by-key 核对） |
| POST | `/api/settings/databases/:id/probe` | 连接探针（只读） | 写命令：`requestKey` + 回执（accepted→succeeded/failed/unknown；UNKNOWN 按 by-key 核对） |
| POST | `/api/settings/databases/:id/query` | 只读 SQL 查询（守卫注入 LIMIT） | 写命令：`requestKey` + 回执（accepted→succeeded/failed/unknown；UNKNOWN 按 by-key 核对） |
| GET | `/api/settings/git` | GitHub / GitLab 连接状态（不含令牌） | 读口；无写回执 |
| POST | `/api/settings/gitlab` | 保存 GitLab / GitHub 连接与令牌（只写不读） | 写命令：`requestKey` + 回执（accepted→succeeded/failed/unknown；UNKNOWN 按 by-key 核对） |
| POST | `/api/settings/gitlab/test` | 验证已保存令牌（可写验证状态缓存，非配置变更） | 写命令：`requestKey` + 回执（accepted→succeeded/failed/unknown；UNKNOWN 按 by-key 核对） |

## 交互（待处理中心）

| 方法 | 路径 | 用途 | 回执 / 语义 |
| --- | --- | --- | --- |
| GET | `/api/interactions` | 可交互待办列表（问题 / 权限 / 策略禁止 / 结果未明 / 草稿） | 读口；无写回执 |
| GET | `/api/interactions/:id` | 单条交互详情（问题选项 / 权限范围 / 未知回读） | 读口；无写回执 |
| POST | `/api/interactions/:id/resolve` | 就地处理交互（回答 / 授权 / 拒绝 / 确认） | 写命令：`requestKey` + 回执（accepted→succeeded/failed/unknown；UNKNOWN 按 by-key 核对） |

## 内部 MCP 回环（Bearer `AGENT_WORKFLOW_MCP_TOKEN`）

| 方法 | 路径 | 用途 | 回执 / 语义 |
| --- | --- | --- | --- |
| GET | `/internal/mcp/context` | 返回任务 / 规划 / 工作区上下文（workflow.context.get） | 内部端点：Bearer `AGENT_WORKFLOW_MCP_TOKEN`；无 requestKey 回执 |
| POST | `/internal/mcp/database/query` | 只读 SQL（database.query） | 内部端点：Bearer `AGENT_WORKFLOW_MCP_TOKEN`；无 requestKey 回执 |
| GET | `/internal/mcp/git/commit-show` | 提交详情（git.commit.show） | 内部端点：Bearer `AGENT_WORKFLOW_MCP_TOKEN`；无 requestKey 回执 |
| GET | `/internal/mcp/git/diff-files` | 变更文件（git.diff.files） | 内部端点：Bearer `AGENT_WORKFLOW_MCP_TOKEN`；无 requestKey 回执 |
| GET | `/internal/mcp/git/log` | Git 日志（git.log） | 内部端点：Bearer `AGENT_WORKFLOW_MCP_TOKEN`；无 requestKey 回执 |
| GET | `/internal/mcp/git/status` | Git 状态（git.repo.status） | 内部端点：Bearer `AGENT_WORKFLOW_MCP_TOKEN`；无 requestKey 回执 |
| POST | `/internal/mcp/plan-submit` | 提交候选计划（workflow.plan.submit） | 内部端点：Bearer `AGENT_WORKFLOW_MCP_TOKEN`；无 requestKey 回执 |
| POST | `/internal/mcp/question` | 提交业务问题（workflow.question.ask） | 内部端点：Bearer `AGENT_WORKFLOW_MCP_TOKEN`；无 requestKey 回执 |
| POST | `/internal/mcp/result-submit` | 提交节点结果（workflow.result.submit） | 内部端点：Bearer `AGENT_WORKFLOW_MCP_TOKEN`；无 requestKey 回执 |
| POST | `/internal/mcp/workspace/exec` | 白名单命令（workspace.exec） | 内部端点：Bearer `AGENT_WORKFLOW_MCP_TOKEN`；无 requestKey 回执 |
| GET | `/internal/mcp/workspace/file` | 读文件（workspace.file.read） | 内部端点：Bearer `AGENT_WORKFLOW_MCP_TOKEN`；无 requestKey 回执 |
| POST | `/internal/mcp/workspace/file-write` | 写文件（workspace.file.write） | 内部端点：Bearer `AGENT_WORKFLOW_MCP_TOKEN`；无 requestKey 回执 |
| GET | `/internal/mcp/workspace/files` | 列目录（workspace.file.list） | 内部端点：Bearer `AGENT_WORKFLOW_MCP_TOKEN`；无 requestKey 回执 |

## 仅服务端（不进入 ROUTES）

| 方法 | 路径 | 用途 | 回执 / 语义 |
| --- | --- | --- | --- |
| ALL | `/api/opencode/gateway/:secret/v1/*` | OpenCode 内部网关：每次启动随机 secret，仅受管进程使用，不进入共享客户端契约 | 仅受管 OpenCode 使用；随机 secret；不进入共享客户端契约 |

## 其他 / 未分类

| 方法 | 路径 | 用途 | 回执 / 语义 |
| --- | --- | --- | --- |
| GET | `/api/catalog/role-images` | （待补说明：catalogRoleImages） | 读口；无写回执 |
| GET | `/api/catalog/roles/:id/insights` | （待补说明：catalogRoleInsights） | 读口；无写回执 |
| GET | `/api/catalog/roles/:id/permission-preview` | （待补说明：catalogRolePermissionPreview） | 读口；无写回执 |
| POST | `/api/catalog/roles/package/publish` | （待补说明：catalogRolePackagePublish） | 写命令：`requestKey` + 回执（accepted→succeeded/failed/unknown；UNKNOWN 按 by-key 核对） |
| POST | `/api/catalog/roles/package/validate` | （待补说明：catalogRolePackageValidate） | 写命令：`requestKey` + 回执（accepted→succeeded/failed/unknown；UNKNOWN 按 by-key 核对） |
| GET | `/api/knowledge/conversations/:id` | （待补说明：knowledgeConversation） | 读口；无写回执 |
| POST | `/api/knowledge/conversations/:id/archive` | （待补说明：knowledgeConversationArchive） | 写命令：`requestKey` + 回执（accepted→succeeded/failed/unknown；UNKNOWN 按 by-key 核对） |
| POST | `/api/knowledge/conversations/:id/rename` | （待补说明：knowledgeConversationRename） | 写命令：`requestKey` + 回执（accepted→succeeded/failed/unknown；UNKNOWN 按 by-key 核对） |
| POST | `/api/knowledge/conversations/:id/restore` | （待补说明：knowledgeConversationRestore） | 写命令：`requestKey` + 回执（accepted→succeeded/failed/unknown；UNKNOWN 按 by-key 核对） |
| GET / PATCH | `/api/knowledge/projects/:id/permissions` | （待补说明：knowledgePermissions） | 写命令：`requestKey` + 回执（accepted→succeeded/failed/unknown；UNKNOWN 按 by-key 核对） |
| GET | `/api/knowledge/results/:requestKey` | （待补说明：knowledgeResult） | 读口；无写回执 |
| GET | `/api/knowledge/runs/:key` | （待补说明：knowledgeProgress） | 读口；无写回执 |
| POST | `/api/knowledge/runs/:key/stop` | （待补说明：knowledgeStop） | 写命令：`requestKey` + 回执（accepted→succeeded/failed/unknown；UNKNOWN 按 by-key 核对） |
| GET | `/api/opencode/operations` | （待补说明：opencodeOperations） | 读口；无写回执 |
| POST | `/api/opencode/start` | （待补说明：opencodeStart） | 写命令：`requestKey` + 回执（accepted→succeeded/failed/unknown；UNKNOWN 按 by-key 核对） |
| POST | `/api/ppt-generations/:key/stop` | （待补说明：pptGenerationStop） | 写命令：`requestKey` + 回执（accepted→succeeded/failed/unknown；UNKNOWN 按 by-key 核对） |
| POST | `/api/ppt/works/:id/archive` | （待补说明：pptWorkArchive） | 写命令：`requestKey` + 回执（accepted→succeeded/failed/unknown；UNKNOWN 按 by-key 核对） |
| GET / POST | `/api/ppt/works/:id/assistant` | （待补说明：pptAssistant） | 写命令：`requestKey` + 回执（accepted→succeeded/failed/unknown；UNKNOWN 按 by-key 核对） |
| POST | `/api/ppt/works/:id/assistant/decide` | （待补说明：pptAssistantDecide） | 写命令：`requestKey` + 回执（accepted→succeeded/failed/unknown；UNKNOWN 按 by-key 核对） |
| GET | `/api/ppt/works/:id/check` | （待补说明：pptWorkCheck） | 读口；无写回执 |
| POST | `/api/ppt/works/:id/copy` | （待补说明：pptWorkCopy） | 写命令：`requestKey` + 回执（accepted→succeeded/failed/unknown；UNKNOWN 按 by-key 核对） |
| GET | `/api/ppt/works/:id/document` | （待补说明：pptDocument） | 读口；无写回执 |
| POST | `/api/ppt/works/:id/restore` | （待补说明：pptWorkRestore） | 写命令：`requestKey` + 回执（accepted→succeeded/failed/unknown；UNKNOWN 按 by-key 核对） |
| POST | `/api/ppt/works/:id/stop` | （待补说明：pptWorkStop） | 写命令：`requestKey` + 回执（accepted→succeeded/failed/unknown；UNKNOWN 按 by-key 核对） |
| GET | `/api/ppt/works/:id/thumbnail` | （待补说明：pptWorkThumbnail） | 读口；无写回执 |
| GET / PATCH | `/api/projects/:id/charter` | （待补说明：projectCharter） | 写命令：`requestKey` + 回执（accepted→succeeded/failed/unknown；UNKNOWN 按 by-key 核对） |
| POST | `/api/projects/:id/charter/confirm` | （待补说明：projectCharterConfirm） | 写命令：`requestKey` + 回执（accepted→succeeded/failed/unknown；UNKNOWN 按 by-key 核对） |
| POST | `/api/projects/:id/charter/generate` | （待补说明：projectCharterGenerate） | 写命令：`requestKey` + 回执（accepted→succeeded/failed/unknown；UNKNOWN 按 by-key 核对） |
| POST | `/api/projects/:id/charter/stop` | （待补说明：projectCharterStop） | 写命令：`requestKey` + 回执（accepted→succeeded/failed/unknown；UNKNOWN 按 by-key 核对） |
| GET | `/api/projects/:id/source-path` | （待补说明：projectSourcePath） | 读口；无写回执 |
| GET | `/api/runtime-interactions` | （待补说明：runtimeInteractions） | 读口；无写回执 |
| GET | `/api/runtime-interactions/:id` | （待补说明：runtimeInteraction） | 读口；无写回执 |
| POST | `/api/runtime-interactions/:id/resolve` | （待补说明：runtimeInteractionResolve） | 写命令：`requestKey` + 回执（accepted→succeeded/failed/unknown；UNKNOWN 按 by-key 核对） |
| POST | `/api/settings/databases/probe-draft` | （待补说明：databaseDraftProbe） | 写命令：`requestKey` + 回执（accepted→succeeded/failed/unknown；UNKNOWN 按 by-key 核对） |
| POST | `/api/tasks/:id/archive` | （待补说明：taskArchive） | 写命令：`requestKey` + 回执（accepted→succeeded/failed/unknown；UNKNOWN 按 by-key 核对） |
| GET | `/api/tasks/:id/attempts/:attemptId/artifacts/:artifactId` | （待补说明：taskArtifact） | 读口；无写回执 |
| GET | `/api/tasks/:id/audit` | （待补说明：taskAudit） | 读口；无写回执 |
| GET | `/api/tasks/:id/nodes/:nodeId/attempts/:attemptId/tools/:callId` | （待补说明：nodeTool） | 读口；无写回执 |
| GET | `/api/tasks/:id/nodes/:nodeId/sources/:planId/:entryId` | （待补说明：nodeSource） | 读口；无写回执 |
| POST | `/api/tasks/:id/plan/freeze` | （待补说明：taskPlanFreeze） | 写命令：`requestKey` + 回执（accepted→succeeded/failed/unknown；UNKNOWN 按 by-key 核对） |
| GET | `/api/tasks/:id/plan/freezes` | （待补说明：taskPlanFreezes） | 读口；无写回执 |
| GET | `/api/tasks/:id/planning/proposal` | （待补说明：planningProposal） | 读口；无写回执 |
| POST | `/api/tasks/:id/planning/refine-preview` | （待补说明：planningRefinePreview） | 写命令：`requestKey` + 回执（accepted→succeeded/failed/unknown；UNKNOWN 按 by-key 核对） |
| GET | `/api/tasks/:id/run-content` | （待补说明：taskRunContent） | 读口；无写回执 |
| GET | `/api/tasks/:id/snapshot-review` | （待补说明：taskSnapshotReview） | 读口；无写回执 |
| GET | `/api/tasks/:id/snapshot-review/report` | （待补说明：taskSnapshotReport） | 读口；无写回执 |
| GET | `/api/tasks/:id/snapshot-review/report/:reportId/download` | （待补说明：taskSnapshotReportDownload） | 读口；无写回执 |
| GET | `/api/templates/archive` | （待补说明：templateArchive） | 读口；无写回执 |
| GET | `/api/templates/archive/export` | （待补说明：templateArchiveExport） | 读口；无写回执 |
| GET | `/api/templates/archive/runs/:id/verify` | （待补说明：templateArchiveRun） | 读口；无写回执 |
| GET / PATCH | `/api/tools/policy` | （待补说明：toolsPolicy） | 写命令：`requestKey` + 回执（accepted→succeeded/failed/unknown；UNKNOWN 按 by-key 核对） |
| GET / POST | `/api/workflows` | （待补说明：workflows） | 写命令：`requestKey` + 回执（accepted→succeeded/failed/unknown；UNKNOWN 按 by-key 核对） |
| GET / PATCH / DELETE | `/api/workflows/:id` | （待补说明：workflow） | 写命令：`requestKey` + 回执（accepted→succeeded/failed/unknown；UNKNOWN 按 by-key 核对） |
| POST | `/api/workflows/:id/copy` | （待补说明：workflowCopy） | 写命令：`requestKey` + 回执（accepted→succeeded/failed/unknown；UNKNOWN 按 by-key 核对） |
| POST | `/api/workflows/:id/instantiate` | （待补说明：workflowInstantiate） | 写命令：`requestKey` + 回执（accepted→succeeded/failed/unknown；UNKNOWN 按 by-key 核对） |
| GET | `/api/workflows/:id/versions` | （待补说明：workflowVersions） | 读口；无写回执 |
| POST | `/api/workflows/validate` | （待补说明：workflowValidate） | 写命令：`requestKey` + 回执（accepted→succeeded/failed/unknown；UNKNOWN 按 by-key 核对） |
