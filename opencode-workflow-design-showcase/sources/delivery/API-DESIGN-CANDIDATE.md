# 新任务隔离执行与用户选择交付 · 同版候选 API（API-DESIGN-CANDIDATE）

> **本文所有新增资源、字段、取值、操作、事件名都是「候选 · 未冻结」。** 它们未进入权威 OpenAPI，没有生成、安装或实现，最终由原 shared / API owner、任务 / 执行 owner、Git owner 收敛到同一版。原型中的成功画面都是合成数据，不能据此把 mock 当 live。
> 依据：需求包 `API-STATE-CANDIDATE.md`、`DESIGN-REQUIREMENTS.md`、`ACCEPTANCE-AND-EVIDENCE.md`（2026-10-15 v1）；状态 id 取自 `prototype/assets/td-states.js`。旧 `git-workbench/API-DESIGN.md` 只作历史参考。
> 本文不新建服务、数据库或错误协议；HTTP 路由只是包内给出的设计占位。

## 0. 标记

| 标记 | 含义 |
| --- | --- |
| 现有 | 需求包 §1 列明的已有操作 / 机制（含「PR16 候选已编码、生产安装与真实认证待核」的那一类，下表单独注明） |
| 候选 · 未冻结 | 本设计需要、尚未存在的名称、字段、取值或行为 |
| 待冻结规则 | 业务规则未定，设计不决定，见 DESIGN-DELTA §6 |
| 宿主绑定 | 由宿主 / 原 writer 在服务端绑定的事实，**永不出现在公共输入中** |
| 仅客户端 | 纯界面行为，不需要 API |

## 1. 权威归属

| 归属方 | 负责的事实 / 动作 | 不负责 |
| --- | --- | --- |
| 任务 / 项目宿主 | 工作区读取、自有目录 / 分支 ownership、路径 handle、租约、`在文件管理器显示` 能力 | 不写 ExecutionStatus；不结算交付 |
| 原任务 writer（任务交付 writer） | 交付选择记录、交付步骤意图账、TaskDeliveryView 修订 | 不自行执行 Git / 目录副作用 |
| 执行 / 任务状态 owner | ExecutionStatus、终点汇聚判定、完成门槛、完成记录 | 不由 Git store 或 renderer 代写 |
| Git 端口 / 原 Git writer | 任务分支 + worktree 准备、commit / push / MR 副作用与物理 proof、Git 文件事实 | 不认领普通任务成功；`git.fix.*` 只服务审查修复 |
| 非 Git 目录适配 | 基线快照、独立副本、三方预览、逐项应用与物理 proof | 不发任何 `git.*` 写命令；不 git init |
| 原 CommandWriter / 观察 | requestKey 回执、body hash、版本校验、scope、leases、UNKNOWN 账、`operations.by-key`、事件 | 不替副作用 owner 判定结果 |
| GitLab 只读 | MR 打开 / 已合并 / 已关闭 | 不影响历史任务完成 |

```
renderer ──只发：选择 id + 用户可编辑字段 + requestKey + expected*──▶ 应用服务
  │                                                          ├─ 原任务 writer ──┐
  │◀──只读投影：TaskWorkspaceView / TaskChangesView /         ├─ Git 端口         ├─ 原 CommandWriter（回执 / by-key / 事件）
  │   TaskDeliveryView / DirectoryApplyPreview /              ├─ 非 Git 目录适配  │
  │   WorkspaceCleanupPreview                                 └─ 宿主 ownership ──┘
  └─ 永不发送：绝对路径、目录 handle、credentialRef、租约、scope、force、完成状态
完成结算：执行 / 任务状态 owner 只消费上述原 settlement proof，UI 无写入口
```

## 2. 现有复用

| 现有操作 / 机制 | 在本增量中的用法 | 约束 |
| --- | --- | --- |
| `requirements.create` | TD01 形成需求草稿，不变 | 草稿不准备工作区、不执行 |
| `execution.command` / `execution.advance` / `execution.advance.preview` | 计划确认后的开始执行、推进；取消（`td06-close-retain`） | 准备成功前不得派发写节点；交付等待不得被误判 recovery_required 或重新派发 |
| `git.fix.*` | **不用于普通任务** | 只服务审查修复；不能伪造 review / finding / GitFixRun 来借用 |
| `git.remote.read`（PR16 候选已编码） | TD04 推送预览：远端分支是否存在、连接版本、账户公开名称 | 生产安装与真实认证待核；未接通时界面显示配置缺失 |
| `git.fetch`（PR16 候选已编码） | TD04 MR 前核对目标 tip | 同上；只更新远端引用 |
| `gitlab.mergeRequests.list` / `read`（PR16 候选已编码） | TD04 已有原 MR 核对显示、TD07 列表 / 详情 | 只读；不提供合并 |
| `operations.by-key` | 所有写动作 UNKNOWN 的唯一核对方式 | 读未观测到不证明无副作用；不能跨 project 搬运 |
| 原 CommandWriter 回执、版本校验、授权 scope、leases、原操作 UNKNOWN 账 | 全部候选命令沿用 | 不另造第二套回执 / 错误协议 |
| 底层 Git 能力（`worktree/creation.ts` prepare、`diff-snapshots.ts`、`remote/application.ts`、`git-remote-effects.ts`、`review-fix/projection.ts` 步骤投影表现） | 由「普通任务可信绑定」适配后复用 | 输入与绑定仍是 fix 语义，不能原样当普通任务模型 |

## 3. 命令通则（沿原 envelope）

| 规则 | 要求 |
| --- | --- |
| requestKey | 用户在**确认**时生成一次；网络重传用原 key + 原 body。改动任何可编辑字段（文件选择、信息、分支名、标题、冲突处理）即新意图、新 key |
| expected* | 每个改变事实的命令都带期望版本；不一致返回版本变化类错误与当前资源引用，UI 重读后要求重新确认，服务不静默改用新值 |
| 可信 scope | 授权取自可信 session；URL 中的 id 只选资源。UI 有按钮不等于账户已有合法写权限 |
| 宿主绑定 | 目录 handle、设备身份、租约、credentialRef、可信 producer 证明、作者身份、远端 URL 由服务绑定 |
| 回执 | 原 CommandWriter 回执：accepted → succeeded / failed / unknown；长操作以资源重读为准 |
| 不连锁 | 服务不把 commit → push → MR 或 apply 各项自动串起；每个副作用独立 requestKey、独立确认 |
| UNKNOWN | 保持原记录；UI 只有「核对原操作」→ `operations.by-key(requestKey)`；不重发、不换 key；只有服务结算能清除未明 |
| 明确失败 | 只有服务证明无副作用的失败才允许用户以新 key 发新请求，并需重新确认 |
| 错误 | 沿既有 `error` / `fieldIssues` / 当前资源引用结构；本文只列业务类（§10），不固定新错误码 |

## 4. 内核枚举边界

1. 内核四组状态枚举（10 / 10 / 7 / 7，权威见 `docs/project/recovery-state-machines.md:112`、`execution-lifecycle.md` §7）**不新增任何取值**。不加 `ExecutionStatus=awaiting_delivery`，不加 `NodeStatus=unknown`，不新增隐藏验收节点。
2. 「待交付」是 **TaskDeliveryView 的投影 + UI 派生原因**，不是内核状态。待交付阶段 ExecutionStatus 保持非终态；采用 active + reason 还是其他既有合法映射，由状态 owner 冻结（待冻结 P5）。
3. 现状缺口：`workflow/execution/scheduling.ts:84` 的 `deriveExecutionStatus` 在有效节点全部 succeeded 且必需产物存在时直接返回 succeeded，**没有检查所选交付**。完成门槛需执行 / 任务状态 owner 实现，并同步暂停 / 恢复 / 取消 / Redo 语义。
4. `FlowCanvas.tsx:58 / :107` 的系统「交付」端点目前只展示，`onNodeClick` 不处理 system 节点；端点可操作需前端实现，但端点交互**不改变**任何执行状态。
5. **UI 不能控制完成**：没有任何 renderer 可调用的「设为完成」命令；按钮点击、URL、toast 都不是 proof。完成只来自服务对原 settlement 的复核。
6. 不把 failed 写成 succeeded；C33 失败候选资格走原证据 authority，不泛化为节点成功。

## 5. 候选资源

### 5.1 `TaskWorkspaceView`「候选 · 未冻结」

| 字段 | 含义 | 公开 |
| --- | --- | --- |
| `taskRef` / `executionRef` / `projectRef` | 绑定 | 是 |
| `workspaceRef` | 不透明工作区引用 | 是 |
| `kind` | `git_worktree` / `directory_copy` | 是 |
| `revision` | 工作区资源版本 | 是 |
| `displayRoot` / `originalRootDisplay` | 任务目录 / 原项目**显示**路径（可复制，不是能力） | 是 |
| `preparation.state` | 候选值：not_started / preparing / ready / blocked / partial / unknown（资源投影，非内核枚举） | 是 |
| `preparation.stage` / `steps[]` / `reason` | 阶段名、已发生步骤、业务类原因 | 是 |
| `base.ref` / `base.sha`（Git） | 基线分支与完整 SHA（UI 截短） | 是 |
| `baseline.ref` / `takenAt` / `scope.included` / `scope.excluded[]` / `scope.notCopied[]`（非 Git） | 快照引用、时间、范围、排除项、未复制资源（显示路径、大小、原因） | 是 |
| `branch`（Git） | 任务分支名 | 是 |
| `parallelWritePolicy` | 候选值：sub_isolation_merge / serial，服务决定只读 | 是 |
| `children[]` | 子工作区摘要：nodeRef、显示名、状态、汇合时间 | 是 |
| `activeWrites[]` | 活动写入节点引用 | 是 |
| `pendingOperationRef` | 未决原请求 key 引用 | 是 |
| `retention` | 保留中 / 清理中 / 部分清理 / 已清理 | 是 |
| `createdAt` / `lastCheckedAt` / `capacity`（可缺省，缺省显示未知） | — | 是 |
| `diagnostics.publicRefs[]` | 可复制的公开安全引用 | 是 |
| `actions{prepare, cleanupPreview, revealInFileManager}` | `{allowed, reason}`，服务计算 | 是 |

**宿主绑定**：真实目录 handle、设备身份、inode、租约、credentialRef、可信 producer 证明、绝对写入路径。renderer 不指定任何写入路径。

### 5.2 `TaskChangesView`「候选 · 未冻结」

| 字段 | 含义 | 公开 |
| --- | --- | --- |
| `workspaceRef` / `changesRevision` / `baselineRef` / `readAt` | 固定扫描版本 | 是 |
| `stats{added, modified, deleted}` | A/M/D 计数 | 是 |
| `files[]` | `fileId`、`status`(A/M/D)、`path`、`oldPath?`、`entryKind`(file/dir/symlink)、`mode{old,new}?`、`binary`、`sizeClass`、`additions/deletions`（二进制为 null）、`versionRef`（不透明）、`diffRef` | 是 |
| `excluded[]` | 显示路径、原因（忽略规则 / 生成产物 / 范围外）、`contentVisible` | 是 |
| `verification` | 原验证摘要（通过 / 失败计数、日志引用），只读复述原事实 | 是 |
| `outcome` | 任务目标、成果、验收摘要引用 | 是 |
| `selectionConstraints` | 整文件选择；必需产物提示（规则待冻结 P3） | 是 |
| `nextCursor` / `actions` | 分页、可用动作 | 是 |

**宿主绑定**：路径由 fileId 在服务端解析；文件内容哈希只作不透明版本引用，客户端不能自报替代服务扫描。

### 5.3 `TaskDeliveryView`「候选 · 未冻结」

| 字段 | 含义 | 公开 |
| --- | --- | --- |
| `deliveryRef` / `revision` | 交付记录与版本 | 是 |
| `taskRef` / `executionRef` / `resultRef` / `workspaceRef` | 绑定当前有效结果 | 是 |
| `currentChangesRevision` / `selectedFileIds` / `selectionRevision` | 交付选择 | 是 |
| `completionGoal` | `local_commit` / `push_branch` / `create_merge_request` / `apply_to_original` | 是 |
| `projection` / `reason` | §6 投影值与 UI 原因（如 active_writes、awaiting_confirmation） | 是 |
| `steps.commit` / `steps.push` / `steps.mergeRequest` | 每步：`state`、`requestKey`、`receiptRef`、`settledAt`、`commitSha` / `remoteRef` / `pushedSha` / `mrIid` / `mrWebUrl`（可信读口） | 是 |
| `steps.apply.items[]`（非 Git） | 每项 fileId、结果（applied / blocked / unknown / not_executed）、requestKey 引用 | 是 |
| `remaining` | 未选 / 未交付文件数与说明 | 是 |
| `eligibility{allowed, reason, failedCandidate?}` | 交付资格；失败候选只引用 authority | 是 |
| `taskCompletionRef` / `verificationOutcome` | 完成记录引用；「全部通过 / 已交付·验证未通过」 | 是 |
| `workspaceRetention` / `lastUpdatedAt` / `actions` | — | 是 |

**宿主绑定 / 规则**：只有原 writer 能结算完成；URL 或按钮点击不是 proof；不公开秘密、内部凭据、账户 token。

### 5.4 `DirectoryApplyPreview`「候选 · 未冻结」

| 字段 | 含义 | 公开 |
| --- | --- | --- |
| `previewRef` / `revision` / `checkedAt` / `expiresAt` | 预览身份与有效期 | 是 |
| `deliveryRef` / `baselineRef` / `changesRevision` / `originalRevision` | 三方版本 | 是 |
| `items[]` | `fileId`、显示路径、`change`(A/M/D)、三方各自 `entryKind`（含 absent）、`check`(applicable / conflict / unsupported)、`conflictType`、`plannedEffect`(add / replace / delete)、`contentRefs{baseline, task, original}`、`binaryIdentity{size}`、`requiredNote?`（服务判定说明） | 是 |
| `conflictType` 候选值 | both_modified / add_add / delete_vs_modified / modified_vs_deleted / type_conflict / unsupported_binary_or_link | 是 |
| `items[].resolution` | keep_original / take_task / manual_then_recheck / exclude（take_task 需二次确认） | 是 |
| `counts{applicable, conflict, unsupported, unresolved}` | — | 是 |
| `untouchedSummary` | 不会改动的无关文件说明 | 是 |
| `backupEvidence?` | 仅服务真实提供时存在（待冻结 P8） | 是 |
| `actions{recheck, freeze, confirm}` | — | 是 |

**宿主绑定**：原目录读取与写入 handle 由宿主登记；预览无副作用；任意 JSON 清单不能授权写入。

### 5.5 `WorkspaceCleanupPreview`「候选 · 未冻结」

| 字段 | 含义 | 公开 |
| --- | --- | --- |
| `previewRef` / `workspaceRef` / `workspaceRevision` / `expiresAt` | — | 是 |
| `deleteObjects[]` | 精确自有对象：kind（本地任务分支 / worktree 目录 / 独立副本目录 / 内部缓存）+ 显示信息 | 是 |
| `retainObjects[]` | 原项目、远端分支、MR、提交、回执、验证记录；非 Git 原目录；基线快照（待冻结 P7） | 是 |
| `undelivered{count, reason}` / `requiresUndeliveredAck` | 未交付内容与是否需额外知情 | 是 |
| `blockers[]` | 类别（活动写入 / 未停稳 / 原请求待核对 / 内容漂移 / 恢复依赖 / 唯一产物）+ 定位引用 | 是 |
| `actions{confirm}` | — | 是 |

**宿主绑定**：真实 ownership 与当前性检查由宿主和原 writer 证明；不存在「任意路径递归删除」输入。

## 6. 交付投影状态（候选，**不是**内核枚举）

| 投影 | 何时 | UI 文案（徽标 / 端点 / 情况条） | 代表状态 |
| --- | --- | --- | --- |
| 待选择 | 执行 / 验收已结束，还没有交付选择 | 「执行已结束 · 等待交付」·「查看变更并交付」 | `td02-awaiting`、`td04-goal`、`td05-overview` |
| 待确认 | 已选目标，下一步副作用等待用户确认 | 「提交完成 · 等待推送确认」/「等待你确认应用」 | `td02-step-committed`、`td04-committed-wait-push`、`td05-recheck` |
| 进行中 | 某步骤已接受、未结算 | 「推送中…」，相关按钮锁定 | `td04-push-confirm`（提交后）、`td05-apply-confirm`（提交后） |
| 受阻 | 活动写入、版本漂移、权限 / 配置缺失、冲突未解决 | 「交付受阻 · <原因>」，链接到原因位置 | `td02-blocked`、`td04-push-auth`、`td05-conflicts`、`td05-drift` |
| 待核对 | 某步骤回执 UNKNOWN | 「<步骤>结果待核对」·「核对原操作」 | `td04-push-unknown`、`td04-mr-unknown`、`td05-unknown` |
| 已交付 | 所选目标全部可信成功且完成记录已结算 | 「任务已交付」；验证失败时「已交付 · 验证未通过」 | `td02-delivered`、`td02-delivered-verify-failed`、`td04-delivered`、`td05-applied` |

规则：投影由服务从 TaskDeliveryView 计算，UI 不本地推断；「任务已交付」只在服务读回已交付后出现；MR 的打开 / 已合并 / 已关闭是独立 GitLab 事实。

## 7. 候选操作

总览（全部「候选 · 未冻结」，路由为包内占位）：

| 操作 | 形态 | 归属 | TD 状态 |
| --- | --- | --- | --- |
| `task.workspace.read` | GET `/tasks/{id}/workspace` | 任务 / 项目宿主 | TD01、TD02、TD06 |
| `task.workspace.prepare` | POST `/tasks/{id}/workspace/prepare`（或原启动内置阶段） | 原任务 writer + Git 端口 / 目录适配 | TD01 |
| `task.changes.read` / `task.changes.diff` | GET `/tasks/{id}/changes[/files/{fileId}/diff]` | Git / 目录适配 | TD02、TD03、TD05 |
| `task.delivery.select` | POST `/tasks/{id}/delivery/select` | 原任务交付 writer | TD04、TD05 |
| `task.delivery.commit` / `push` / `mergeRequest.create` | POST `/tasks/{id}/delivery/{step}` | 任务交付 writer + 原 Git writer | TD04 |
| `task.delivery.apply.preview` | POST `/tasks/{id}/delivery/apply-preview`（只读） | 非 Git 目录适配 / 宿主 | TD05 |
| `task.delivery.apply.confirm` | POST `/tasks/{id}/delivery/apply` | 非 Git 目录适配 + 原任务 writer | TD05 |
| `task.workspace.cleanup.preview` / `confirm` | 占位未定 | 宿主 ownership + 原 writer | TD06 |
| 完成结算 | 可信内部动作，无 renderer 入口 | 执行 / 任务状态 owner | TD02、TD04、TD05 |
| 回执核对 + 事件 | 现有 `operations.by-key` + 候选事件 | 原 CommandWriter / 观察 | 全部 UNKNOWN |

### 7.1 `task.workspace.read`

| 项 | 内容 |
| --- | --- |
| 输入 | taskRef |
| 输出 | TaskWorkspaceView |
| 期望版本 / 回执 | 只读；无回执 |
| 失败 | 原项目 scope 不可读或任务无工作区：返回原因，不伪造工作区；读失败可重读 |
| 状态 | 全部 `td01-*`、`td02-running`、`td02-parallel`、`td02-cancelled-retained`、`td06-detail-git`、`td06-detail-nongit`、`td06-cleaned` |

### 7.2 `task.workspace.prepare`

| 项 | 内容 |
| --- | --- |
| 输入 | taskRef、requestKey、`expectedPlanRevision`、`expectedProjectRevision`、Git：`expectedBaseRef` + `expectedBaseTip`；非 Git：`baselineSelectionRef` |
| 输出 | 原准备回执、workspaceRef、TaskWorkspaceView 修订 |
| 前置 | 唯一任务分支 / 副本；固定基线；持久准备意图先于文件副作用；准备成功才可派发写节点 |
| 回执 | accepted → succeeded / failed / unknown；部分创建以 `preparation.steps[]` 展示 |
| UNKNOWN | 只 `operations.by-key`；**不再 create、不分配第二目录**；部分创建走定向恢复（恢复动作形态待冻结） |
| 归属 | 原任务 writer 记意图；Git 端口（复用 `worktree/creation.ts` 底层）或目录适配执行；宿主登记 ownership |
| 状态 | `td01-preparing`、`td01-ready`、`td01-combined`、`td01-empty-repo`、`td01-name-conflict`、`td01-baseline-drift`、`td01-prepare-unknown`、`td01-partial`、`td01-unavailable` |

开始执行仍是现有 `execution.command`；`td01-combined` 若采用，准备作为启动事务阶段，回执合并方式待冻结（P4）。

### 7.3 `task.changes.read` / `task.changes.diff`

| 项 | 内容 |
| --- | --- |
| 输入 | read：workspaceRef、`expectedChangesRevision?`、cursor；diff：fileId、`expectedChangesRevision`、cursor、ignoreWhitespace |
| 输出 | TaskChangesView；分页 diff（沿现有 diff 表现，统一 / 并排 / 全宽为仅客户端） |
| 前置 | 只读租约下一致扫描；路径由 fileId 解析 |
| 版本漂移 | 返回版本变化类错误 + 当前 changesRevision，UI 要求刷新 |
| 归属 | Git 适配（`diff-snapshots.ts` 可复用）/ 非 Git 目录适配（新需求，不以复用 diff 样式冒充现有能力） |
| 状态 | `td03-*`、`td02-awaiting`（统计）、`td02-no-changes`、`td05-overview`、`td05-conflict-text` |

### 7.4 `task.delivery.select`

| 项 | 内容 |
| --- | --- |
| 输入 | requestKey、taskRef、executionRef、resultRef、workspaceRef、changesRevision、fileIds、completionGoal、`expectedDeliveryRevision` |
| 输出 | TaskDeliveryView、原回执 |
| 语义 | 记录用户所选目标与范围；**不授权自动执行后续**；不产生 Git / 目录副作用 |
| UNKNOWN | `operations.by-key`；未核对前不再提交新选择 |
| 改目标 | 未完成时改变目标须显式确认、保留已发生动作、服务版本校验——语义待冻结（P2） |
| 归属 | 原任务交付 writer |
| 状态 | `td04-goal`、`td04-goal-change`、`td05-overview` |

### 7.5 `task.delivery.commit`

| 项 | 内容 |
| --- | --- |
| 输入 | requestKey、deliveryRef、`expectedDeliveryRevision`、`expectedChangesRevision`、fileIds（各带 versionRef）、message、`expectedBranchHead`、`confirmCommit: true`、`acknowledgeFailedCandidate`（仅 eligibility 许可时） |
| 宿主绑定 | 作者（设置 → Git 账号）、worktree handle、任务分支 |
| 输出 | 步骤回执、commitSha、脱敏 hook 输出 |
| 失败 | 内容版本变化（保留草稿重确认）；hook 拒绝（内容未变，修改后新 key） |
| UNKNOWN | `operations.by-key`；按原 proof 结算；推送保持锁定 |
| 归属 | 任务交付 writer 记意图 + 原 Git writer 执行（经普通任务可信 binding 适配） |
| 状态 | `td04-commit-confirm`、`td04-commit-drift`、`td04-hook-rejected`、`td04-commit-only-done`、`td04-committed-wait-push`、`td02-step-committed` |

### 7.6 `task.delivery.push`

| 项 | 内容 |
| --- | --- |
| 预览 | 现有 `git.remote.read`：远端同名、连接版本、账户公开名称、用途是否足够（是否另设任务级预览操作待冻结） |
| 输入 | requestKey、deliveryRef、`expectedDeliveryRevision`、`expectedLocalSha`、remoteBranchName、`expectRemote: absent`、`expectedConnectionRevision`、`confirmPush: true` |
| 输出 | remoteRef、pushedSha、created、回执 |
| 约束 | create-only；无 force 字段；不覆盖已有远端分支；远端同名在预览即阻止，换名后新预览、新 key |
| UNKNOWN | 只 `operations.by-key`，按 PR16 现行证明结算，不以「ls-remote 已有」由 UI 判定；MR 步骤锁定 |
| 归属 | 任务交付 writer + 原 Git writer（`remote/application.ts`、`git-remote-effects.ts`） |
| 状态 | `td04-push-confirm`、`td04-push-exists`、`td04-push-auth`、`td04-push-failed`、`td04-push-unknown` |

### 7.7 `task.delivery.mergeRequest.create`

| 项 | 内容 |
| --- | --- |
| 预览 | 现有 `git.fetch` + 读取目标 tip；现有 `gitlab.mergeRequests.list/read` 用于原 MR 核对显示 |
| 输入 | requestKey、deliveryRef、`expectedDeliveryRevision`、sourceRef + pushedSha（实际已推送）、targetBranch、`expectedTargetTip`、title（≤255）、description、`confirmMergeRequest: true`；无评审人字段（未接通，P9） |
| 输出 | iid、webUrl（可信读口）、回执；已有合法原 MR 时返回原 MR，不重建 |
| UNKNOWN | 只 `operations.by-key`；不重复 POST；按原标记 MR 核对结算 |
| 漂移 | 目标前移 / 源改变返回版本变化类错误，重读重确认、新 key |
| 归属 | 任务交付 writer + 原 Git writer |
| 状态 | `td04-mr-confirm`、`td04-target-drift`、`td04-mr-exists`、`td04-mr-unknown`、`td04-delivered` |

### 7.8 `task.delivery.apply.preview`（只读）

| 项 | 内容 |
| --- | --- |
| 输入 | deliveryRef、baselineRef、changesRevision、fileIds、已有 resolutions[]、`expectedPreviewRevision?` |
| 输出 | DirectoryApplyPreview；全部冲突有处理且重新检查后即为「冻结预览」（previewRef + revision + expiresAt） |
| 约束 | 读三方当前事实，**不写原目录**；POST 只为传参，不是写授权；无回执副作用 |
| 失败 | 原目录不可读 / 权限 / 路径不可用：保留候选文件与副本，可重读 |
| 归属 | 非 Git 目录适配 / 宿主 |
| 状态 | `td05-checking`、`td05-preview`、`td05-conflicts`、`td05-conflict-text`、`td05-conflict-binary`、`td05-recheck`、`td05-read-error` |

### 7.9 `task.delivery.apply.confirm`

| 项 | 内容 |
| --- | --- |
| 输入 | requestKey、previewRef + `previewRevision`、deliveryRef + `expectedDeliveryRevision`、resolutionRef、`confirmApply: true` |
| 输出 | 原操作回执 + 逐项结果（applied / blocked / unknown / not_executed） |
| 约束 | 原目录 / 快照 / 选择仍当前；每项有原意图与结果；不声称文件系统全事务；不整批重拷、不自动回滚用户后续编辑 |
| 部分 / UNKNOWN | 逐项展示；待核实项只 `operations.by-key`；已成功项不重做；被阻塞项需重新预览 |
| 归属 | 非 Git 目录适配执行 + 原任务 writer 记账 |
| 状态 | `td05-apply-confirm`、`td05-drift`、`td05-partial`、`td05-unknown`、`td05-applied` |

### 7.10 `task.workspace.cleanup.preview` / `confirm`

| 项 | preview | confirm |
| --- | --- | --- |
| 输入 | workspaceRef、`expectedWorkspaceRevision` | requestKey、previewRef、workspaceRef、`expectedWorkspaceRevision`、`confirmCleanup: true`、`acknowledgeUndelivered`（requiresUndeliveredAck 时） |
| 输出 | WorkspaceCleanupPreview | 回执 + 分步清理结果；TaskWorkspaceView.retention |
| 约束 | 只读；列精确自有对象 | 无活动写 / 未知动作 / 恢复依赖；不删原项目 / 远端 / 审计记录；非 Git 原目录永不在对象中 |
| UNKNOWN / 部分 | — | 只 `operations.by-key`；不再发同一删除 |
| 归属 | 宿主 ownership | 宿主 ownership + 原 writer |
| 状态 | `td06-cleanup-preview`、`td06-cleanup-undelivered`、`td06-cleanup-blocked` | `td06-cleanup-partial`、`td06-cleaned` |

### 7.11 完成结算（无 renderer 入口）

| 项 | 内容 |
| --- | --- |
| 输入 | 当前 task / plan / 有效结果 + 验收、workspace / changes revision、交付选择版本、各原 requestKey 的 settlement 引用 |
| 条件 | 仅提交：commit 结算；推送：push 结算成功；MR：MR 结算成功；非 Git：所有选中且符合成果范围的应用项成功（P3）；必需成果 / 验收政策满足；无未决写或 UNKNOWN |
| 输出 | 完成记录（TaskDeliveryView.taskCompletionRef），与任务完成记录同一致性提交 |
| 规则 | 不能拿旧 MR 链接完成新结果；结算中断只幂等消费原 proof；MR 后来合并 / 关闭、账户失效、目录清理都不重开任务 |
| 归属 | **执行 / 任务状态 owner**；Git store 与 renderer 均不能改 ExecutionStatus |
| 状态 | `td04-commit-only-done`、`td04-delivered`、`td05-applied`、`td02-delivered`、`td02-delivered-verify-failed` |

## 8. 回执核对与事件

| 名称 | 标记 | 载荷 | renderer 动作 |
| --- | --- | --- | --- |
| `operations.by-key` | 现有 | 原 requestKey | 「核对原操作」唯一调用；仍未知时显示原因与上次核对时间 |
| `task.workspace.updated` | 候选 · 未冻结 | taskRef、workspaceRef、revision | 重读 TaskWorkspaceView |
| `task.changes.updated` | 候选 · 未冻结 | workspaceRef、changesRevision | 提示「变更已更新 · 重新读取」，不自动替换已确认内容 |
| `task.delivery.updated` | 候选 · 未冻结 | deliveryRef、revision、projection | 重读 TaskDeliveryView；后台任务只更新列表 / 待处理提示 |

事件只是提示：按 revision 丢弃旧事件、去重；断线重连后对当前视图全部重读；先订阅后首读；不按事件载荷拼装状态。

## 9. 映射表：状态 → 资源 / 动作 → 关键字段 → 期望版本 → 回执 / UNKNOWN

| 状态 id | 资源 / 动作 | 关键字段 | 期望版本 | 回执 / UNKNOWN |
| --- | --- | --- | --- | --- |
| `td01-git-plan` | 原计划读 + `task.workspace.read` | kind=git_worktree、base、branch 建议、parallelWritePolicy | plan / project revision | 只读 |
| `td01-nongit-plan` | 同上 | kind=directory_copy、baseline.scope / excluded / notCopied | 同上 | 只读 |
| `td01-checking` | `task.workspace.read` | kind 未定 | — | 读失败可重读 |
| `td01-combined` | 原启动内置 prepare（候选） | 同 prepare | plan / project / base | 启动回执；UNKNOWN by-key |
| `td01-preparing` | `task.workspace.prepare` | preparation.stage | plan / project / base tip | accepted，待结算 |
| `td01-ready` | `task.workspace.read` → 原 `execution.command` | workspaceRef、branch、displayRoot | workspace revision | prepare succeeded |
| `td01-unavailable` | read / prepare | 路径 / 权限缺失 | — | 明确失败，无副作用 |
| `td01-empty-repo` | prepare | 基线不可用 | base tip | 明确失败，不伪造 SHA |
| `td01-name-conflict` | prepare | 创建冲突、占用对象显示 | — | 明确失败，草稿保留 |
| `td01-baseline-drift` | prepare | 旧 / 新基线 | base tip 不符 | 明确失败；重读后新 key |
| `td01-prepare-unknown` | `operations.by-key` | pendingOperationRef | — | UNKNOWN，只核对 |
| `td01-partial` | `task.workspace.read` | preparation.steps[] | — | 部分效果；定向恢复（待冻结） |
| `td02-running` | `execution.read`（原）+ workspace read | workspaceRef、kind | — | — |
| `td02-parallel` | workspace read | parallelWritePolicy、children[] | — | — |
| `td02-awaiting` | TaskDeliveryView + changes read | projection=待选择、stats | — | — |
| `td02-blocked` | TaskDeliveryView | projection=受阻、reason、activeWrites | — | — |
| `td02-no-changes` | changes read + TaskDeliveryView | stats=0；无变更结算动作（候选，不可用） | — | — |
| `td02-failed-candidate` | TaskDeliveryView.eligibility | failedCandidate authority 引用 | — | — |
| `td02-step-committed` | TaskDeliveryView | steps.commit=成功、projection=待确认 | — | commit 已结算 |
| `td02-delivered` | TaskDeliveryView + `gitlab.mergeRequests.read` | projection=已交付、taskCompletionRef、MR state | — | 已结算 |
| `td02-delivered-verify-failed` | TaskDeliveryView | verificationOutcome=未通过 | — | 已结算（authority 许可） |
| `td02-background` | 其他任务 TaskDeliveryView + 事件 | taskRef、projection | — | 事件只提示 |
| `td02-cancelled-retained` | 原取消 + workspace read | retention=保留中 | 原 | 原取消回执 |
| `td03-changes` | `task.changes.read` / `diff` | changesRevision、files[]、readAt | changesRevision | 只读 |
| `td03-excluded` | changes read | excluded[] | 同上 | 只读 |
| `td03-large-binary` | changes diff（cursor） | sizeClass、binary、mode、nextCursor | 同上 | 只读 |
| `td03-leave-context` | 仅客户端（草稿归属见 §11） | — | — | — |
| `td03-loading` | changes read 进行中 | — | — | — |
| `td03-read-error` | changes read 失败 | 版本变化 / 读失败 | changesRevision 不符 | 重新读取 |
| `td04-goal` | `task.delivery.select` | completionGoal、fileIds | delivery revision、changesRevision | 原回执；UNKNOWN by-key |
| `td04-commit-confirm` | `task.delivery.commit` | fileIds、message、作者（绑定） | delivery / changes revision、branch head | 回执；UNKNOWN by-key |
| `td04-commit-drift` | commit 错误 → changes read | fieldIssues(fileIds) | changesRevision 不符 | 明确失败；草稿保留，新 key |
| `td04-hook-rejected` | commit 错误 | 脱敏 hook 输出 | — | 明确失败；修改后新 key |
| `td04-commit-only-done` | commit 结算 + 完成结算 | commitSha、projection=已交付 | — | 已结算 |
| `td04-committed-wait-push` | TaskDeliveryView | steps.commit 成功、push 待确认 | — | — |
| `td04-push-confirm` | `git.remote.read` → `task.delivery.push` | sourceSha、remoteBranchName、连接版本 | local sha、expectRemote=absent、delivery revision | 回执；UNKNOWN by-key |
| `td04-push-exists` | `git.remote.read` | 远端同名 | expectRemote=absent 不成立 | 未发推送；换名重新预览 |
| `td04-push-auth` | `git.remote.read` / push 错误 | 账户用途不足 / 未认证 | — | 明确失败 |
| `td04-push-failed` | push 回执 failed | 业务类原因、已证明无副作用 | — | 明确失败；重新确认后新 key |
| `td04-push-unknown` | `operations.by-key` | 原 requestKey | — | UNKNOWN，只核对；MR 锁定 |
| `td04-mr-confirm` | `git.fetch` → `task.delivery.mergeRequest.create` | 源 ref / SHA、target、title、description | target tip、delivery revision | 回执；UNKNOWN by-key |
| `td04-target-drift` | MR 错误 | 新 target tip | target tip 不符 | 明确失败；重读重确认 |
| `td04-mr-exists` | create 返回原 MR / `gitlab.mergeRequests.read` | iid、webUrl | — | 原回执，不重建 |
| `td04-mr-unknown` | `operations.by-key` | 原 requestKey | — | UNKNOWN，不重复 POST |
| `td04-delivered` | TaskDeliveryView + 完成结算 | projection=已交付、SHA、ref、MR | — | 已结算 |
| `td04-goal-change` | `task.delivery.select`（语义未冻结） | 新 completionGoal | delivery revision | 待冻结 |
| `td05-overview` | changes read（目录）+ TaskDeliveryView | files、selectedFileIds、goal=apply_to_original | changesRevision | 只读 |
| `td05-checking` | `apply.preview` 进行中 | — | baseline / changes revision | 只读 |
| `td05-preview` | `apply.preview` | items(applicable)、plannedEffect | originalRevision | 只读 |
| `td05-conflicts` | `apply.preview` | conflictType、counts | 同上 | 只读 |
| `td05-conflict-text` | preview contentRefs + diff | 三方 contentRefs | 同上 | 只读 |
| `td05-conflict-binary` | `apply.preview` | binaryIdentity | 同上 | 只读 |
| `td05-recheck` | `apply.preview`（带 resolutions） | previewRef、revision、expiresAt | preview revision | 只读 |
| `td05-apply-confirm` | `task.delivery.apply.confirm` | previewRef、resolutionRef | preview / delivery / original revision | 逐项回执；UNKNOWN by-key |
| `td05-drift` | apply.confirm 逐项结果 | item=blocked | originalRevision 不符 | 该项未执行；重读 |
| `td05-partial` | TaskDeliveryView.steps.apply | items[] 结果 | — | 部分效果，保留原账 |
| `td05-unknown` | `operations.by-key` | 原 requestKey / 项引用 | — | UNKNOWN，只核对 |
| `td05-applied` | 完成结算 | projection=已交付 | — | 已结算 |
| `td05-read-error` | apply.preview 错误 | 路径 / 权限缺失 | — | 读失败，可重读 |
| `td06-detail-git` | workspace read | retention、pending、已交付凭证、actions | — | 只读 |
| `td06-detail-nongit` | workspace read | baseline 保留说明（P7） | — | 只读 |
| `td06-close-retain` | 原 `execution.command`（取消）+ workspace read | retention=保留中 | 原 | 原回执 |
| `td06-cleanup-preview` | `cleanup.preview` | deleteObjects、retainObjects、undelivered | workspace revision | 只读 |
| `td06-cleanup-undelivered` | `cleanup.preview` | requiresUndeliveredAck | 同上 | 只读 |
| `td06-cleanup-blocked` | `cleanup.preview` | blockers[] | 同上 | 只读 |
| `td06-cleanup-partial` | `operations.by-key` + workspace read | 分步清理结果 | — | UNKNOWN / 部分，只核对 |
| `td06-cleaned` | workspace read + TaskDeliveryView | retention=已清理、回执仍可读 | — | 已结算 |
| `td07-mr-detail` | `gitlab.mergeRequests.read` + TaskDeliveryView | MR state、来源任务、deliveredAt | — | 只读 |
| `td07-mr-list` | `gitlab.mergeRequests.list` | 来源任务绑定（候选） | — | 只读 |
| `td07-mr-closed-later` | 同上 | state=closed；交付不变 | — | 只读 |

## 10. 错误业务类（不固定新错误码）

返回沿既有 `error` / `fieldIssues` / 当前资源引用；下表只定义业务类与界面处理。

| 业务类 | 典型来源 | 界面处理 | 状态 |
| --- | --- | --- | --- |
| 基线 / 内容 / 目标版本变化 | prepare、commit、MR、apply.confirm、cleanup.confirm | 字段旁显示新旧版本；保留草稿；重读后重新确认，新 key | `td01-baseline-drift`、`td04-commit-drift`、`td04-target-drift`、`td05-drift`、`td03-read-error` |
| 工作区创建冲突 / 部分创建 | prepare | 显示占用对象或已发生步骤；不覆盖、不自动清理 | `td01-name-conflict`、`td01-partial` |
| 路径 / 权限缺失 | workspace read、prepare、apply.preview、文件管理器显示 | 原因 + 出路；读失败可重读 | `td01-unavailable`、`td05-read-error` |
| 账户用途不足 | push / MR 预览或执行 | 「查看 Git 设置」；不展示秘密、不自动配置 | `td04-push-auth` |
| 活动写入 / 未停稳 | 交付入口、cleanup.preview | 禁用并链接到写入节点 | `td02-blocked`、`td06-cleanup-blocked` |
| 原请求待核对 | 任一写命令前置 | 只「核对原操作」 | `td01-prepare-unknown`、`td04-push-unknown`、`td04-mr-unknown`、`td05-unknown`、`td06-cleanup-partial` |
| 远端分支已存在 | push 预览 / push | 换名重新预览确认；不覆盖、不强推 | `td04-push-exists` |
| 非 Git 应用冲突 / 部分成功 | apply.preview / apply.confirm | 逐项处理；逐项结果；不整批重做 | `td05-conflicts`、`td05-partial` |
| 清理依赖未满足 | cleanup.preview / confirm | 阻塞并说明依赖；唯一产物 / 恢复依赖不提供删除 | `td06-cleanup-blocked` |
| （现有 Git 端口）hook 拒绝 | commit | 脱敏输出；内容未变 | `td04-hook-rejected` |

## 11. 原型中出现但需 API 冻结

| 原型交互 | 依赖的未冻结项 | 状态 |
| --- | --- | --- |
| 「准备独立工作区」与「开始执行」两步按钮 / 「准备并开始」单按钮 | 准备是否为独立命令、物理准备时点（P4、P12） | `td01-git-plan`、`td01-combined` |
| 准备阶段名序列 | preparation.stage 取值 | `td01-preparing` |
| 同名冲突的「查看占用对象」及后续处理 | 解决方式（P13） | `td01-name-conflict` |
| 部分创建的「定向恢复」入口 | 恢复动作形态 | `td01-partial` |
| 工作区 chip、子工作区标签与「汇合」显示 | parallelWritePolicy / children（P11） | `td02-running`、`td02-parallel` |
| 「执行已结束 · 等待交付」徽标 | ExecutionStatus 映射 + 完成门槛实现（P5、§4） | `td02-awaiting` |
| 可点击的交付终点 | 前端端点交互 + TaskDeliveryView | `td02-*` |
| 「确认无文件交付并结束」（禁用） | 无变更结算（P1） | `td02-no-changes` |
| 失败候选的知情确认勾选 | C33 资格（P6） | `td02-failed-candidate`、`td04-commit-confirm` |
| 「已交付 · 验证未通过」 | verificationOutcome 与 authority 许可 | `td02-delivered-verify-failed` |
| 后台任务待处理提示 | 待处理中心通知来源 | `td02-background` |
| 取消后「稍后交付」入口 | 取消后交付的结算语义（P14） | `td02-cancelled-retained` |
| 退出任务上下文时「草稿保留在该任务」 | 提交信息 / 选择草稿归属（客户端或服务端） | `td03-leave-context` |
| 未纳入文件及原因 | excluded[] 投影 | `td03-excluded` |
| 完成目标三选一的持久化 | `task.delivery.select` | `td04-goal` |
| 未完成时改目标 | P2 | `td04-goal-change` |
| 作者「来自 设置 → Git 账号」 | 可信作者绑定 | `td04-commit-confirm` |
| 推送卡的账户 / 服务器公开名称、连接版本 | `git.remote.read` 生产接入 | `td04-push-confirm`、`td04-push-auth` |
| 远端同名时的新名字建议 `-2` | 命名规则（P16） | `td04-push-exists` |
| 「明确失败（已证明无副作用）」的判定 | push 失败分类 | `td04-push-failed` |
| 评审人行「当前未接通」 | P9 | `td04-mr-confirm` |
| 「已有合法原 MR」判定 | PR16 原标记 MR 核对 | `td04-mr-exists` |
| 「任务已交付」读回 | 完成结算 + 引擎门槛 | `td04-delivered`、`td04-commit-only-done`、`td05-applied` |
| 「在 GitLab 打开」链接 | 外部 URL 来源（P10） | `td04-delivered`、`td07-*` |
| TD05 全部：三方检查、六类冲突、四种处理、冻结预览、逐项应用 / 结果 | 非 Git 目录适配后端（新需求） | `td05-*` |
| 「采用任务版本」二次确认 | resolution 记录方式 | `td05-conflicts` |
| 必需产物被排除时的服务判定说明 | P3 | `td05-conflicts`、`td05-apply-confirm` |
| 应用确认中的备份 / 恢复证据行 | P8 | `td05-apply-confirm` |
| 「在文件管理器显示」 | 宿主能力 | `td06-detail-*` |
| 基线快照保留说明 | P7 | `td06-detail-nongit`、`td06-cleanup-preview` |
| 未交付内容的额外知情丢弃 | P15 | `td06-cleanup-undelivered` |
| 容量 / 大小显示 | 宿主是否提供；缺省为未知 | `td06-detail-*` |
| MR 列表「来源任务」与「该任务已交付」 | MR ↔ 任务绑定来源 | `td07-*` |

## 12. 与旧 Git API 草案的差异

| 旧草案（2026-10-13，历史候选） | 本增量 |
| --- | --- |
| `fix.start / commit / push / mergeRequest.create` 以 fixRunId 绑定 | 普通任务用 taskRef / deliveryRef 绑定；`git.fix.*` 保持修复专属 |
| `fix.merge`、§5.3 直接合并前提、g54 / g56 | 不进入本增量；产品内合并未实现 |
| `fix.push` 以 ls-remote 结算 | 以 PR16 当前 create-only push 与原写入账证明结算 |
| MR 以「同 source 的打开 MR」结算 | 以原标记 MR 核对；已有合法原 MR 只显示原链接 |
| split button 在 renderer 侧连发两个命令 | 不提供；每步独立确认 |
| `fix.discard` 删除 worktree 与本地分支 | 由 `task.workspace.cleanup.*` 预览 + 确认 + 阻塞条件取代，且从不自动发生 |
| FixRun.state 等自定义运行状态 | 不新增运行状态；只有 TaskDeliveryView 投影，内核 10 / 10 / 7 / 7 不变 |
