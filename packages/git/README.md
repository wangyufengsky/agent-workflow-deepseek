# `@agent-workflow/git`

本机 Git CLI 读模型、受管 worktree 与 GitHub/GitLab REST 适配器。只依赖
`@agent-workflow/shared` 的契约与错误码，不依赖 `engine` / `storage` / `server`。

## 模块

| 文件 | 职责 |
| --- | --- |
| `src/cli.ts` | 安全 git 执行器：数组传参、固定 cwd、超时、输出上限、`--no-optional-locks --no-pager`、stderr 脱敏 |
| `src/validation.ts` | revision/ref/path/branch/handle 校验；拒绝短名、`-` 前缀、`..`、绝对路径与 pathspec 魔法 |
| `src/redact.ts` | token / URL userinfo / Authorization 脱敏 |
| `src/diff.ts` | `--raw -z`、`--numstat -z`、unified diff → shared `FileChange` / `DiffPage` |
| `src/repository.ts` | `detectGitState` 与 `GitRepository`：status / log / commitShow / commitFiles / commitDiff / diffHunks / branches / refsContaining / fileAtRevision / mergeBase |
| `src/worktree.ts` | `WorktreeManager`：在调用方给的 `worktreesRoot` 下创建/删除任务 worktree，分支限定 `task/`、`ai-fix/` |
| `src/http.ts` | 受控 JSON HTTP 客户端：超时、错误码映射、token 只走 header |
| `src/remote.ts` | `RemoteProvider`、`GitHubAdapter`、`GitLabAdapter`、`createRemoteProvider` |
| `src/index.ts` | 公共导出 |

## 安全约束

- **不用 shell**：所有 git 调用为 `spawn(git, args[])`，从不拼接命令行。
- **revision 白名单**：只接受完整 SHA（40/64 hex）或完整 `refs/...`；`HEAD`、短名、`~`、`^`、range、`--flag` 一律 `VALIDATION_FAILED`。
- **路径白名单**：仓库内相对路径；拒绝绝对路径、`..`、反斜杠、冒号、`:(...)`、控制字符与 `-` 前缀。
- **worktree 写隔离**：`create` / `remove` 只作用于 `worktreesRoot` 下的目录；创建前做存在性、分支名与注册状态预检，冲突返回 `WORKSPACE_NAME_CONFLICT`；`remove` 默认保留分支，只有显式 `{ deleteBranch: true }` 且分支属于任务命名空间才删除。
- **不碰用户工作区**：worktree 操作只写 `.git/worktrees` 元数据与 `worktreesRoot` 目录；用户工作区文件不会被 checkout/stash/reset。
- **凭据**：REST token 只来自构造参数或 token provider；只出现在 `Authorization` / `PRIVATE-TOKEN` header；错误消息和 details 统一脱敏。
- **资源上限**：命令超时、stdout/ stderr 上限、diff 行/字节上限、文件列表/分支/refs 数量上限，见 `src/config.ts`。

## 错误码映射

- 本地：`NOT_A_GIT_REPO`、`REPO_PATH_UNAVAILABLE`、`REVISION_NOT_FOUND`、`WORKSPACE_NAME_CONFLICT`、`WORKSPACE_PARTIAL`、`FORBIDDEN`、`VALIDATION_FAILED`、`TRUNCATED`、`SHALLOW_HISTORY`、`NOT_FOUND`、`GIT_CAPABILITY_UNAVAILABLE`、`UNSUPPORTED_FORMAT`。
- 远程：`GITLAB_AUTH_FAILED`（401/403）、`GITLAB_NOT_CONFIGURED`、`NOT_FOUND`、`CONFLICT`、`VALIDATION_FAILED`、`MR_ALREADY_EXISTS`、`NETWORK_UNREACHABLE`、`CAPABILITY_UNAVAILABLE`。

## 验证

```sh
npx tsc -p packages/git/tsconfig.json --noEmit
node --import tsx --test packages/git/src/*.test.ts
```

测试全部使用 `/tmp` 下的真实临时仓库与 `127.0.0.1` 本地 stub HTTP server，不访问外网。

## 未覆盖 / 边界

- 只做读模型 + worktree 写操作；commit / push / merge / apply 由 engine 的 delivery 流程组合调用，不在本包实现。
- 远程列表未实现分页游标（`nextCursor` 尚未返回），GitHub/GitLab approvals 字段返回 `null`（需要额外 API 调用）。
- `GitBranch.protected` 为 `null`（未知）；保护分支需通过 `RemoteProvider.listProtectedBranches()` 获取。
- `checkedOutInUserWorktree` 标记“被任一 worktree 检出”（包含受管任务 worktree）。
- `fileAtRevision` 对超大文件按字节上限截断，`totalLines` 基于截断后的内容。
