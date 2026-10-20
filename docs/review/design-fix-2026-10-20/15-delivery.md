# 交付 / 隔离补充稿（TD01–TD07）设计偏差处置记录（2026-10-20）

> 输入：`docs/review/design-audit-2026-10-20.md`、`docs/review/design-audit-2026-10-20/15-delivery.md`（28 条 finding：P1 6 / P2 16 / P3 6）。
> 设计权威（只读）：`opencode-workflow-design-showcase/sources/delivery/{STATES,DESIGN-DELTA,API-DESIGN-CANDIDATE}.md` + `originals/delivery/`。
> 工作分支：`fix/design-audit-2026-10-20`（基于 `main@3f6f9b2`，不 commit/push）。
> 负责人：delivery-parity（task-7）。跨区域：TD01 UI 归 requirement(task-5)/task-canvas(task-3)、TD06 抽屉归 task-canvas、Git 修复域 merge 归 git-parity(task-6)。
>
> **判定口径**：`已修复` = 产品代码已按设计改且静态可证；`部分` = 主链路可用但设计的子状态/字段仍缺（注明 C1/C9）；`延后` = 本轮未做或跨域，注明原因；不伪造成功态。

## 概览

| ID | 严重度 | 标题 | 状态 | 证据 |
|---|---|---|---|---|
| DEL-07 | P1 | 产品内合并作为交付完成路径 | **已修复** | 见下 |
| DEL-14 | P1 | 已有原 MR 不核对、可能重复创建 | **已修复**（代码+6 测试） | 见下 |
| DEL-01 | P1 | TD01 准备异常家族缺失/不可达 | **已修复（服务/契约层，UI 由区域 06 实现）** | 见下 |
| DEL-13 | P1 | TD03 任务变更视图整体缺失 | **已修复**（残余 C1 见说明） | 见下 |
| DEL-20 | P1 | 非 Git 三方冲突视图 + 应用无确认 | **部分**（确认层/冲突事实已做；三方文本读口 C1） | 见下 |
| DEL-02 | P2 | 计划确认工作区卡字段 | 部分 | 见下 |
| DEL-03 | P2 | 非 Git 基线快照披露字段 | 延后（C1） | 见下 |
| DEL-04 | P2 | 准备阶段只显示两端/阶段名/无准备确认 | 部分（确认对话框已做，阶段进度 C1） | 见下 |
| DEL-05 | P2 | 开始执行无二次确认 | 已修复（区域 06 实现） | 见下 |
| DEL-06 | P3 | 项目类型“正在核对”状态不存在 | 延后（C1） | 见下 |
| DEL-08 | P2 | 交付面板缺执行/验收摘要与工作区公开身份 | 延后（C1） | 见下 |
| DEL-09 | P2 | 交付受阻原因不可定位 | 延后（C1） | 见下 |
| DEL-10 | P2 | 无变更结算候选 + 交付资格区块 | 部分 | 见下 |
| DEL-11 | P3 | 交付投影文案漂移 | 部分 | 见下 |
| DEL-12 | P3 | 已交付面板 MR 状态为静态说明 | 部分 | 见下 |
| DEL-15 | P2 | 推送缺预览 | 延后（C1） | 见下 |
| DEL-16 | P2 | 目标分支漂移后无重读路径 | 部分（刷新已重取分支；读取时间 C1） | 见下 |
| DEL-17 | P2 | PUSH/MR UNKNOWN 只核对本地台账 | 部分（MR 侧已按远端核对；push 侧 C1） | 见下 |
| DEL-18 | P3 | 提交/推送确认字段与失败说明缺失 | 延后（部分 C1） | 见下 |
| DEL-19 | P3 | “查看变更并交付”行为与文案不符 | 已修复（Git 侧） | 见下 |
| DEL-21 | P2 | take_task 无二次确认/manual_then_recheck 不可选 | **已修复** | 见下 |
| DEL-22 | P2 | 非 Git 漂移整批拒绝 vs 逐项阻塞/回滚 | 延后（服务语义，跨域+需设计裁定） | 见下 |
| DEL-23 | P2 | 非 Git 应用不是全宽视图 | 部分（未做全宽层） | 见下 |
| DEL-24 | P2 | 非 Git 读错分类与“未写入/保留”说明 | 部分（已禁止读错时应用） | 见下 |
| DEL-25 | P3 | 非 Git 结果英文原文/无逐项核对/无保留汇总 | 已修复（中文映射+说明；逐项核对 C1） | 见下 |
| DEL-26 | P1 | TD06 工作区详情抽屉在任务画布缺失 | 转 task-3（P13-12 同根因） | 见下 |
| DEL-27 | P2 | 清理阻塞无定位/部分清理无逐步骤/已清理无删除线 | 转 requirement/task-canvas（跨域） | 见下 |
| DEL-28 | P2 | MR 无来源任务/交付事实绑定 | 延后（C1，Git/交付共享契约） | 见下 |

---

## 逐条处置

### DEL-07（P1）实现提供设计明令禁止的产品内合并，并作为交付完成路径 —— **已修复**
- **改动**：
  - 移除交付面板「④ 合并到目标分支」步骤卡与合并确认对话框：`apps/web/src/pages/delivery/DeliveryStepList.tsx:150-151,174-218`（步骤只剩提交/推送/MR/应用）、`apps/web/src/pages/delivery/TaskDeliveryPanel.tsx`（无 merge Mutation / merge Dialog；MR 文案 :954）。
  - 移除引擎合并写路径：`packages/engine/src/delivery.ts`（原 `merge()` 已删除，文件内已无 `task.delivery.merge`；现 :202-288 为创建 MR，:290-340 为只读核对）。
  - 移除 HTTP 路由与命令签名：`packages/server/src/http.ts`（`POST /api/tasks/:id/delivery/merge` 已不存在；`delivery/merge-request/verify` 见 DEL-14）。
  - 移除契约/路由常量：`packages/shared/src/api/contracts.ts`（`DeliveryMergeRequest` 接口与 `ROUTES.deliveryMerge` 已删）；`packages/shared/src/domain/enums.ts:605`（`DeliveryMergeRequest.verify` kind 新增）；`OperationKind.DELIVERY_MERGE` 已删。
  - 前端 API：`apps/web/src/api/git.ts` 的 `mergeDelivery` 已由 git-parity 删除。
- **口径统一**：MR 面板「产品内不提供合并按钮。合并、关闭与流水线都在 GitLab 完成」= 交付面板 `TaskDeliveryPanel.tsx:624,626,954`「合并在 GitLab 中进行，产品内合并未提供 / 产品内不提供合并按钮」。
- **完成路径**：交付完成只可能来自 本地提交 / 推送 / 创建 MR（服务读回结算）/ 非 Git 应用；MR 创建成功即“任务已交付”，合并是 GitLab 只读独立事实。
- **残留（诚实记录）**：`DeliveryStep.MERGE` 枚举值仍保留（`packages/shared/src/domain/enums.ts:225-231`，标注 `@deprecated`），因为 **Git 修复域** `FixRun.steps` 复用同一形状（`packages/engine/src/fix.ts:522,551,1144`）；交付域不再产生该步骤。git-parity 的 GIT-03 删除修复域合并后，该枚举可最终删除。测试引用已同步删除（`tests/integration/api-contract.test.ts`、`tests/integration/command-replay-boundaries.test.ts` 各 1 处）。
- **验证**：`grep` 全仓无 delivery 域 merge 路由/入口/引擎命令；`npm run typecheck` 通过。

### DEL-14（P1）已有原 MR 不核对，可能重复创建 —— **已修复（代码+测试）**
- **改动**（`packages/engine/src/delivery.ts`）：
  - 创建前先复用同一任务已成功的 MR 回执（:218「同一原请求/同一任务已经成功创建过合法 MR：只显示原链接，绝不创建第二个」）；
  - 创建前用只读读口 `RemotePort.listMergeRequests(projectId,'opened')` 查同源→目标的打开 MR（:224-235，`#findExistingMergeRequest` :342-378）；命中则按原 MR 结算交付、**不 POST**；读取失败时抛 `CAPABILITY_UNAVAILABLE` 拒绝创建（“无法读取已有合并请求，为避免重复创建，本次不创建”）；
  - MR 说明写入原请求标记 `<!-- agent-workflow:delivery:<taskId>:<requestKey> -->`（可审计）；
  - 新增只读核对命令 `verifyMergeRequest`（:290-340）：UNKNOWN 时按原请求只核对远端事实——找到原 MR → 按已有原 MR 结算；确认没有 → 把原未知步结算为明确失败后才允许新的创建请求，不重复 POST 原请求。
  - 契约：`packages/shared/src/api/contracts.ts:1814-1826`（`DeliveryMergeRequestVerifyRequest/Response`）；路由 `packages/server/src/http.ts:470,1010`；前端 API `apps/web/src/api/workflow.ts:832`；面板「核对原操作」对 MR 步骤走远端核对（`TaskDeliveryPanel.tsx:304,730`）。
- **测试**：`packages/engine/src/delivery.test.ts` 6 用例全通过（复用已成功步骤、远端已有 MR、第二个 requestKey、UNKNOWN 核对到原 MR、核对不到后才允许新请求、读不到远端拒绝创建）。
- **残余（DEL-17/28 关联）**：MR 与任务账号的“来源任务”绑定字段仍缺（DEL-28）；push 类 UNKNOWN 的远端分支比对读口仍未提供（C1）。

### DEL-01（P1）TD01 隔离准备异常状态家族 —— **已修复（服务/契约层；UI 区域 06 实现）**
- **本任务改动（服务/契约层）**：
  - `packages/engine/src/workspace.ts:203-215`：准备前**主动**检测同名分支 + 同名工作目录，逐个列出被占用对象，命中抛 `WORKSPACE_NAME_CONFLICT`，details=`{kind:'name_conflict',occupied:[{kind,label,ref?,sha?}]}`（不覆盖、不静默复用）；支持 `branchName/directoryName` 覆盖（:147-149、replay body :109/:132-133），使“使用新名称重新预览→再次确认”可真正执行。
  - `packages/engine/src/workspace.ts:243-277`：准备失败后重读已发生对象——分支已建/目录已建 → `state='partial'` 并逐步骤 completed/failed/not_started；回执未知 → `state='unknown'` + `pendingOperationRef=原 requestKey`；失败/成功都写 `lastCheckedAt`（投影 `checkedAt` 非空）。
  - `packages/shared/src/api/contracts.ts:1686-1692`：`PrepareWorkspaceRequest` 增 `branchName?/directoryName?`；:1677 `WorkspacePreparePreview.suggestedDirectoryName?`。
  - `packages/server/src/http.ts:293-380`：准备预览新增“同名工作目录”对象（kind=`worktree`）、`suggestedDirectoryName` 与分支名成对 -2 后缀、blocker 文案改为“可用「使用新名称重新预览」…再次确认后才准备”。
- **UI（区域 06，跨域引用；requirement 已接线本任务字段）**：`apps/web/src/pages/requirement/WorkspacePanel.tsx:89` 六态横幅、`:417` 唯一动作区、`:836` 准备/补建/重试确认（展示旧对象与将用的新名称）、`:944` 开始执行确认；`apps/web/src/api/workflow.ts:302` 已传 `expectedBaseTip=preview.currentBaseSha`。六态可用：unavailable（`WorkspacePrepareProjection.outcome=unavailable`+横幅）、empty（details.empty）、name-conflict（预览同名分支/worktree 目录+`renameWorkspace` 可用→“使用新名称重新预览”刷新 preview 并传 `branchName/directoryName=suggested*` 重新确认）、baseline-drift（STALE_TARGET expected/actual+重新读取基线）、prepare-unknown（operation.status=unknown+by-key 原请求核对）、partial（workspace.state=partial+补建入口）。
- **已知缺口（C1，未伪造）**：partial“只补缺步”需 GitPort 支持“复用已存在分支 add worktree”（adapter 属其他域）；UI 复用 prepare 作“补建工作目录”，不伪造增量能力。name-conflict 的新名称链路已由 requirement 接线完成（后续如 GitPort 支持补缺步增量，再补端点/字段）。

### DEL-13（P1）TD03 任务变更视图整体缺失 —— **已修复（核心视图）**
- **新增**：`apps/web/src/pages/delivery/TaskChangesView.tsx`（全宽视图）
  - 任务上下文条：项目/任务分支/基线/工作区只读路径/快照 `changesRevision · 读取时间`（:208-222）；
  - 左文件树 A/M/D + 整文件勾选 + 二进制/大文件/权限标签 + 未纳入项路径与原因（:292-340）；
  - 中 diff：统一/并排切换（并排由同一份服务统一 diff 配对渲染，不伪造另一侧）、hunk 行号/增删样式、截断说明（:364 起）；
  - 「验证与成果」页签：任务目标、交付验证结论、原验证记录、验证日志入口说明（:13、证据页签）；
  - 离开确认：`返回任务`/Esc 在存在未保存选择时出现确认条，草稿保留在任务下（:232-250）；
  - 读失败：不显示旧文件列表、说明“读取问题不是没有变更”、只给「重新读取」；
  - 骨架加载「读取任务变更中」；不显示 AI 审查/任务状态徽标（页面内无这些区块）。
- **接线**：`apps/web/src/api/workflow.ts:853` 新增 `fetchTaskChangesDiff`（服务端既有 `GET /api/tasks/:id/changes/files/:fileId/diff`，此前前端未接）；交付面板「查看变更并交付」Git 项目直达该视图（`TaskDeliveryPanel.tsx:417-440,758-766`）；样式 `apps/web/src/pages/delivery/delivery.css:635+`（主题令牌）。
- **残余（C1）**：忽略空白、大文件分段游标（`nextCursor`）未从 changes diff 路由透传（route 无 query；`WorkspaceService.diff` 只传 cursor 未传 ignoreWhitespace），界面不伪造「加载下一段」；`td03-large-binary` 的“读取下一段/加载全部”仍缺。

### DEL-20（P1）非 Git 三方冲突视图缺失 + 应用写入无确认对话框 —— **部分**
- **已做**（`apps/web/src/pages/delivery/DeliveryApplyPreview.tsx`）：
  - 三来源图例（基线｜任务副本｜当前原目录）+ 原目录/副本路径（:178、:266）；
  - 六类 `conflictType` 中文标签（:44-52、:288）；二进制/权限/大小身份事实（:290-300）；明确“服务端未提供三方文本内容读口，不伪造三栏 diff”；
  - 「采用任务版本」二次确认（:323-346）；恢复 `manual_then_recheck` 选项（:56、:305-312）；
  - 冻结失效：改动选择后必须「重新检查并冻结预览」才能应用（`selectionDirty`）；
  - **应用确认对话框**（Modal :447-484）：原目录可复制/只读、写入 A/M/D 数、冲突处理构成、不写入/留副本项、无关文件汇总、「服务未提供备份证据；不声称可撤销」、非文件系统事务说明、焦点限定（Modal 组件）；
  - 逐项结果中文映射（:47-53）。
- **未做（C1）**：真正的三方文本内容 diff / 二进制指纹与尺寸 / 逐项“核对原操作”读口服务端未提供（`directory-apply.ts` 只有 check/conflictType/plannedEffect/detail），界面诚实披露而非造数据。应用确认中的备份证据行按设计写“未提供”，不伪造可撤销。

### DEL-02（P2）计划确认工作区卡字段 —— **部分**
- 服务端只读预览已提供 `projectName/gitState/baseRef/currentBaseSha/workspaceBaseSha/steps/suggestedBranchName/sameNameObjects/blockers`（`packages/server/src/http.ts:293-380`、契约 `WorkspacePreparePreview`），UI 已消费（`WorkspacePanel.tsx:887-900` 区）；仍缺“读写授权摘要/并行写策略/诊断详情/分支名在准备前确定显示”等字段（C1），未伪造。

### DEL-03（P2）非 Git 基线快照披露字段 —— **延后（C1）**
- `TaskWorkspace`/prepare 读模型没有 `baseline.{capturedAt,scope,exclude[],notCopied[]}`（`directory.baseline.*` 只在 settings 存路径/时间）；界面未声称整项目已隔离，也未提供该披露。需引擎持久化基线范围字段后补 UI，本轮未做。

### DEL-04（P2）准备阶段/阶段名/准备确认 —— **部分**
- 准备确认对话框已由区域 06 实现（`WorkspacePanel.tsx:837`）；阶段名与逐阶段结果摘要仍不可得：prepare 是一次同步命令，`workspace.ts` 仍只在开始/结束两端更新 steps（无 progress 投影）→ C1，未伪造百分比。

### DEL-05（P2）开始执行无二次确认 —— **已修复（区域 06 实现）**
- `apps/web/src/pages/requirement/WorkspacePanel.tsx:944` 起开始执行确认对话框（工作区/写入范围/结束后等待交付），确认后才发 `execution.start`。

### DEL-06（P3）项目类型“正在核对”状态 —— **延后（C1）**
- `RepoGitState` 仍只有 git/not_git/path_unavailable/capability_unavailable（`packages/shared/src/domain/enums.ts`），无 `checking`；未伪造未知虚线态。

### DEL-07 见上。

### DEL-08（P2）交付面板缺执行与验收摘要 + 验证日志入口 + 工作区公开身份 —— **延后（C1）**
- `TaskDelivery` 无执行/验收摘要字段，`TaskWorkspace` 无公开身份字段；交付面板只展示验证结论与一行原验证记录（`TaskDeliveryPanel.tsx:540-548`），未组装镜像数据（避免伪造）。需契约补字段后做。

### DEL-09（P2）交付受阻原因不可定位 —— **延后（C1）**
- `TaskDelivery` 无 `blockers[]{kind,label,ref}`，面板只有 `projectionReason` 一段文本（`TaskDeliveryPanel.tsx:535-537`）；未造“定位到节点/审计”动作。

### DEL-10（P2）无变更结算候选 + 失败候选交付资格区块 —— **部分**
- 无变更空态仍诚实说明“不会创建空提交，也不会伪造变更”（`DeliveryFileSelect.tsx:74-81`）；候选按钮“确认无文件交付并结束（候选）”仍未加（需产品/API 冻结 P1，C9）；`eligibility` 无 `basis/rule` 字段（C1），未显示依据。
- 知情确认保留在提交对话框（`TaskDeliveryPanel.tsx:811-815` 区），失败事实不被勾选清除。

### DEL-11（P3）交付投影文案漂移 —— **部分**
- 投影标签仍用 `labels.ts` 通用文案（`awaiting_confirmation:'等待确认下一步'` 等），本轮未改全局 labels（不属本任务写范围）；面板通过步骤卡（`DeliveryStepList.tsx`）展示了具体步骤状态，减少歧义。

### DEL-12（P3）已交付面板 MR 状态是静态说明 —— **部分**
- 交付成功块保留“MR 未合并是 GitLab 的独立事实”说明（`TaskDeliveryPanel.tsx:626`），并按 DEL-07 增加“产品内合并未提供”；按 `mrIid` 读 GitLab MR 状态需交付↔MR 绑定/读口（C1），未做。

### DEL-13 见上。

### DEL-14 见上。

### DEL-15（P2）推送缺“预览推送（读远端）” —— **延后（C1）**
- 服务无 push preview 读口（`pushDelivery` 仍固定 `expectRemote:'absent'` 一次写）；UI 只在失败后提示换名重试。需补远端读口后做。

### DEL-16（P2）目标分支漂移后无重读路径 —— **部分（本轮已修刷新路径）**
- `TaskDeliveryPanel.tsx:520-527`「重新读取交付」现在同时 `branchesQuery.refetch()`（目标 tip 随刷新更新），漂移后可在界面用新 tip 重新确认；
- 仍缺设计要求的「目标 tip 读取时间」字段（交付读模型无 `readAt`，C1），确认框只显示 tip。

### DEL-17（P2）PUSH/MR UNKNOWN 只核对本地台账 —— **部分**
- MR 侧：新增 `verifyMergeRequest` 按远端事实核对（`delivery.ts:290-340`、`http.ts:1010`、面板 :730），核对到原 MR 即结算、确认没有才允许新请求；
- push 侧：仍只 `operations.by-key` 本地台账（服务无“读取远端分支比对 SHA”读口，C1），未伪造。

### DEL-18（P3）提交/推送确认字段与失败说明 —— **延后（部分 C1）**
- 提交对话框已含 分支/head/A/M/D/变更版本/作者/验证/文件清单/知情勾选（`TaskDeliveryPanel.tsx:790-830` 区）；仍缺基线/未选文件保留/验证摘要明细（部分可前端拼但本轮未做）、账户公开名/连接版本（C1）、hook 脱敏保证（需真实服务）。

### DEL-19（P3）“查看变更并交付”实际只定位文件列表 —— **已修复（Git 侧）**
- Git 项目的该按钮现在打开真实任务变更视图（`TaskDeliveryPanel.tsx:758-766` → `TaskChangesView`）；非 Git 仍定位到内嵌应用预览（DEL-23 全宽未做）。次要「工作区详情」动作仍缺（DEL-26 转 task-3）。

### DEL-20 见上。

### DEL-21（P2）take_task 无二次确认 / manual_then_recheck 不可选 / 无冲突类型 —— **已修复**
- `DeliveryApplyPreview.tsx:44-52` 六类冲突中文标签；`:305-346` 四种处理选项（含 `manual_then_recheck` 恢复）与 `take_task` 二次确认（覆盖原文件提示 + 取消默认）；无「全部覆盖」入口（既有语义保留）；“选择只记入预览，应用确认后才写入”。

### DEL-22（P2）非 Git 漂移整批拒绝 vs 逐项阻塞、失败回滚 vs 不回滚 —— **延后（跨域+需裁定）**
- 语义在 `packages/engine/src/directory-apply.ts`（task-10 写范围）：仍是应用前重算预览 → revision 不同整批 `STALE_TARGET`，异常时 `#rollback` 已写入项；与设计“逐项阻塞并继续、已写入不回滚”不同。属目录适配事务模型改造，本轮未做（需任务/目录 owner 裁定；记录 C1/设计裁定）。

### DEL-23（P2）非 Git 应用不是全宽视图 —— **部分**
- 仍内嵌在 480 交付面板（`TaskDeliveryPanel.tsx` 非 Git 分支），未做“画布隐藏的全宽应用视图 + 三来源图例 + 面包屑/返回任务”；本轮 DEL-13 的全宽视图只覆盖 Git 任务变更（TD03）。非 Git 侧保留诚实披露与确认层。

### DEL-24（P2）非 Git 读错分类与“未写入/保留”说明 —— **部分**
- `DeliveryApplyPreview.tsx:95,118-127,229-231`：预览读取失败时置 `previewReadFailed`，确认应用**被禁用**并写明“原目录读取失败：明确没有写入任何文件；候选变更、选择与独立副本都保留，只提供「重新读取」”；错误文案分类只有服务错误文本（权限/路径/超时的类型化原因需目录适配错误码映射，C1 部分）。

### DEL-25（P3）非 Git 结果英文/无逐项核对/无保留汇总 —— **已修复（主）**
- 结果徽标中文映射（`DeliveryApplyPreview.tsx:47-53,430-440`）；结果区写明“不是文件系统事务：已应用项保留、不整批重做；待核实项只核对原操作，不进入新的预览”；待核实整单给「核对原操作（读取回执）」，并写明逐项核对需服务逐项读口（C1）。保留当前原文件/留副本汇总已进入应用确认对话框（不写入/留副本项计数）。

### DEL-26（P1）TD06 工作区详情抽屉与清理入口在任务画布缺失 —— **转 task-3（外部分配）**
- 与 07 区域 `P13-12` 同根因，归 task-canvas（`apps/web/src/pages/task/**`）；本任务只做交付侧数据/文案一致性配合，未改任务画布。

### DEL-27（P2）TD06 清理阻塞无定位/部分清理无逐步骤/已清理无删除线 —— **转 requirement/task-canvas（跨域）**
- 清理 UI 在需求画布工作区页签（区域 06）与任务画布（区域 03/12），归各自 owner；服务逐步骤清理结果读模型仍缺（C1）。本任务未改相应页面。

### DEL-28（P2）MR 无来源任务/交付事实绑定 —— **延后（C1）**
- `GitMergeRequest` 无 `taskRef/deliveredAt`，交付与 MR 无绑定字段（共享契约，需 Git/交付 owner 共同补）；MR 列表/详情无法显示“来源任务/已交付”两事实。本任务已实现“按原 MR 结算不重建”（DEL-14），但未伪造绑定列。

---

## 验证记录

| 验证 | 结果 |
|---|---|
| `npm run typecheck`（全仓） | 本任务改动文件 0 错误（收尾时全仓仅剩知识库 task-9 在途文件 1 处错误，与本任务无关） |
| `node --import tsx --test packages/engine/src/delivery.test.ts` | 6/6 通过（DEL-14 回归） |
| `node --import tsx --test tests/integration/api-contract.test.ts` | 7/7 通过（删除 delivery merge 校验用例后） |
| 静态核查 | 全仓无 `POST /api/tasks/:id/delivery/merge`、无 `mergeDelivery` 前端函数、交付域无 merge 步骤卡/对话框 |
| 未跑 | 真实 GUI/真实 GitLab MR 去重/真实目录应用（第三方副作用）——按报告要求留待需要真实服务的验证 |

## 残留、风险与需 Lead/其他区域跟进

1. **docs/api.md 未更新**：新增 `POST /api/tasks/:id/delivery/merge-request/verify`、`POST /api/tasks/:id/workspace/prepare-preview`，删除 `POST /api/tasks/:id/delivery/merge`；按 Lead 指令由最终门禁统一 `npm run docs:api` 重生成（本任务未动 docs/api.md）。
2. **Git 修复域 merge**：`DeliveryStep.MERGE` 枚举与 `OperationKind.FIX_MERGE`/FixPanel 合并入口归 git-parity 的 GIT-03；其完成后可最终删除该枚举值（DEL-07 交付路径已不可达）。
3. **跨域未完成项**：DEL-03/08/09/12/15/22/26/27/28 依赖契约/其他区域（见逐条原因）；DEL-01 的 partial“只补缺步”、DEL-13 的忽略空白/大文件分段、DEL-20 的三方文本 diff 均因服务读口缺失（C1）诚实保留。
4. **需 GUI/真实服务验证**：四主题下面板/全宽视图/对话框焦点与滚动、真实 GitLab MR 去重与 UNKNOWN 核对、真实目录应用确认与漂移（报告「需 GUI / 运行验证」清单）。
5. **C10 口径**：`.tmp/design-audit/MAPPING.md:118` 的 70 状态压缩口径仍与 `sources/delivery/STATES.md:7` 不一致（12/11/6/17/13/8/3），以区域报告与 STATES.md 为准；`docs/review/design-parity-acceptance-2026-10-20.md` 对 delivery 的“主流程已有”属过度声称，以本文件与审计报告为准。

---

## 第三批（task-13）P2/P3 收口追加（2026-10-20）

> 本轮只做交付/隔离剩余项中“数据诚实/回执闭环”可静态验证的部分；C1/C9 保持延后并注明。以下状态覆盖前文同名条目（前文为 task-7 时点结论）。

| ID | 最终状态 | 证据（文件:行） | 说明 |
|---|---|---|---|
| DEL-17 | **已修复（PUSH/MR 双侧）** | `packages/engine/src/delivery.ts` `verifyPush`（fetch 远端 + 远端分支 tip 比对；找到→按已推送结算、不重发；没找到→原未知结算为明确失败；远端读取失败→保持 UNKNOWN 不判失败）；`verifyMergeRequest`（前批）；契约 `DeliveryPushVerifyRequest/Response` `packages/shared/src/api/contracts.ts:1814+`；路由 `packages/server/src/http.ts` `POST /api/tasks/:id/delivery/push/verify`；前端 `apps/web/src/api/workflow.ts:verifyDeliveryPush`、`apps/web/src/pages/delivery/DeliveryStepList.tsx`（推送步骤「核对原操作」）；测试 `packages/engine/src/delivery.test.ts:262-320`（3 新用例） | 设计 R11「UNKNOWN 只核对原操作」落到远端事实；核对只读（fetch+branches），绝不重发 push。 |
| DEL-12 | **已修复（读回 GitLab 独立事实）** | `packages/engine/src/delivery.ts` `mergeRequestFact`（RemotePort.listMergeRequests 按 iid 读状态；未配置/读失败→`available:false`+原因，不伪造）；路由 `GET /api/tasks/:id/delivery/merge-request-fact`；`TaskDeliveryPanel.tsx` 已交付块显示 `MR 状态（GitLab 只读）：打开中/已合并/已关闭 · 更新于 …`，并注明“MR 合并/关闭不改写任务交付记录” | 合并状态与任务交付事实分列；仍缺 MR↔任务绑定列（DEL-28，C1）。 |
| DEL-11 | **已修复** | `apps/web/src/pages/delivery/TaskDeliveryPanel.tsx` `projectionLabelFor()`（待确认→“提交完成 · 等待推送确认”/“推送完成 · 等待创建合并请求”/“等待你确认应用”；待核对→“<步骤>结果待核对”；进行中→“<步骤>中…”） | 投影文案按当前未完成步骤动态拼，不再只显示通用“等待确认下一步”。 |
| DEL-16 | **已修复（重读路径）** | `TaskDeliveryPanel.tsx` MR 对话框新增「目标 tip 读取于 HH:mm:ss」与「重新读取目标分支」按钮（`branchesQuery.refetch()`）；「重新读取交付」同时重取 branches（前批） | 漂移后可在界面用新 tip 重新确认；交付读模型仍无 tip 读取时间字段（前端用查询时间，C1 明细）。 |
| DEL-15 | 部分（C1） | `TaskDeliveryPanel.tsx` 推送确认框明确“服务端未提供「预览推送」只读读口（C1），确认后只发一次推送；远端同名/认证失败给出服务原因并保留本地提交，不提供自动重试” | 预览读口服务端未提供，不伪造；推送仍为一次确认后写。 |
| DEL-18 | 部分（C1） | 推送确认框补「账户 / 服务器公开名：服务未返回（C1）」「连接版本：服务未返回（C1）」；`DeliveryStepList.tsx` `FAILURE_HINT` 按服务错误码给出唯一出路（HOOK_REJECTED / GITLAB_AUTH_FAILED / PUSH_REJECTED_NON_FF / STALE_TARGET / RECEIPT_UNKNOWN） | 字段类缺口保持 C1 明示；失败说明不再只有原始错误文本。 |
| DEL-08/09/10 | 延后（C1） | — | 交付读模型无执行/验收摘要、`blockers[]{kind,label,ref}`、`eligibility.basis` 字段；不伪造摘要/可定位阻塞/资格依据。 |
| DEL-02/03/04/06 | 延后/部分（C1，见前文） | — | 属需求画布/TD01 UI 或服务读模型字段（跨区域），本轮未改。 |
| DEL-22/23/26/27/28 | 延后/转其他区域 | — | 目录适配事务语义、非 Git 全宽视图、TD06 抽屉、清理逐步骤、MR↔任务绑定；见前文原因与归属。 |

**新增端点（报告 Lead，docs/api.md 统一重生成）**：`POST /api/tasks/:id/delivery/push/verify`、`GET /api/tasks/:id/delivery/merge-request-fact`（均为只读核对/只读事实；无副作用）。
**验证**：`npm run typecheck` 全仓 0 错误；`node --import tsx --test packages/engine/src/delivery.test.ts` 9/9（DEL-14 6 + DEL-17 3）；`api-contract` 7/7、`command-replay-boundaries` 6/6（前批验证）。
**本批修改文件**：`packages/engine/src/delivery.ts`、`packages/engine/src/delivery.test.ts`、`packages/server/src/http.ts`（delivery 路由段）、`packages/shared/src/api/contracts.ts`（delivery 段）、`packages/shared/src/domain/enums.ts`（delivery 段）、`apps/web/src/api/workflow.ts`（delivery 函数）、`apps/web/src/pages/delivery/{TaskDeliveryPanel,DeliveryStepList}.tsx`、本文件。

### 冻结前定点修复：UNKNOWN 期间 MR 已被手动合并/关闭的数据诚实边界（DEL-14/DEL-17 关联）
- **选 A**（`GitMergeRequest` 已带 `state`）：`#findExistingMergeRequest` 改为把同源 → 目标的 **opened/locked/merged/closed** 都视为“原 MR 已存在”（查询 `listMergeRequests(projectId,'all')`）。
  - 核对到 opened/locked → 按原 MR 结算交付（不重复 POST）；核对到 merged/closed → 只记录只读事实（步骤 succeeded + iid/webUrl + note「GitLab 只读事实：已合并/已关闭」），**不据此把交付投影置 delivered、不把任务置 completed**；
  - 核对不到任何同源 MR ≠ 原请求未创建：UNKNOWN 保持 unknown，verify 返回 `found=false` + reason，创建前拒绝重复 POST（不再错误判断“原请求未创建”）。
- **证据**：`packages/engine/src/delivery.ts`（lookup/pick、createMergeRequest、verifyMergeRequest 分支）；`packages/engine/src/delivery.test.ts` 新增/改写 3 用例（merged、closed、核对不到保持 UNKNOWN），11/11 通过；`npm run typecheck` 全仓 0 错误。
