# 交付 / 隔离补充稿（TD01–TD07，70 状态）前端设计一致性审计

> 基线：main @ `3f6f9b2`（2026-10-20）。范围：设计权威 `opencode-workflow-design-showcase/sources/delivery/{README,DESIGN-DELTA,STATES,API-DESIGN-CANDIDATE}.md` + `originals/delivery/{start,task,git,apply}.html` 与其 assets（`td-states.js`、`td-states-v4.js`、`start.js`、`git-td.js`、`apply.js`、`task.js`、`task-registry.js`）+ `sources/supplement-v4/STATE-MAP.md`/`COVERAGE-v4.md`（v4 把 TD01 准备区搬进需求画布工作区页签：PW-* 9 状态，本报告只审计准备区实现内容，页签衔接归区域 06）。实现：`apps/web/src/pages/delivery/{TaskDeliveryPanel,DeliveryGoalPicker,DeliveryFileSelect,DeliveryStepList,DeliveryApplyPreview}.tsx` + `delivery.css`、`apps/web/src/pages/task/TaskCanvasPage.tsx`（交付面板宿主）、`apps/web/src/pages/git/{MergeRequestsPanel,git-shared}.tsx`（TD07 MR 视图）、`apps/web/src/pages/requirement/WorkspacePanel.tsx`（TD01/PW 准备区、TD06 清理）、`packages/engine/src/{delivery,workspace,directory-apply}.ts`、`packages/server/src/{http,directory-apply-plugin}.ts`、`packages/shared/src/{domain/models,domain/enums,api/contracts}.ts`。审计方式：静态代码 vs 只读设计稿；未运行 GUI、未接真实 Git/GitLab/目录服务，相关部分标注“需GUI/需真实服务”。

> **分组口径**：`sources/delivery/STATES.md:7` 的原始注册表为 TD01 12 · TD02 11 · TD03 6 · TD04 17 · TD05 13 · TD06 8 · TD07 3 = 70。`.tmp/design-audit/MAPPING.md:118` 的摘要把“TD02 11+TD06 8”合并写成“TD02 19”、“TD03 6+TD04 17+TD07 3”合并写成“TD03 26”、“TD05 13”写成“TD04 13”；本报告按 `STATES.md` 原始状态 ID 分组（C10，见「未覆盖 / 说明」）。

## 概览

| 分组 | 设计状态数 | 已逐项核对 | P0 | P1 | P2 | P3 | 结论 |
|---|---|---|---|---|---|---|---|
| TD01 开始任务与隔离准备 | 12 | 是 | 0 | 1 | 4 | 1 | 部分实现：两步准备/开始、阶段名无百分比、回执核对、固定模板锁可用；计划确认工作区卡字段、非 Git 基线披露、准备异常家族（不可用/空仓库/同名/基线前移/未知/部分）不可达或缺失 |
| TD02 任务画布与待交付（交付面板部分） | 11 | 是 | 0 | 0 | 3 | 2 | 部分实现：投影/资格/验证/回执/文件选择/目标/交付步骤/交付成功块均在；缺执行与验收摘要与验证日志入口、阻塞原因不可定位、无变更候选结算与失败资格说明缺失、投影文案漂移 |
| TD03 Git 任务变更 | 6 | 是 | 0 | 1 | 0 | 0 | 基本缺失：没有任务变更上下文页/文件树/diff 查看器/离开上下文确认；只有交付面板内的扁平文件勾选列表（服务 changes diff 端点已存在但前端未接） |
| TD04 Git 交付动作与回执 | 17 | 是 | 0 | 2 | 3 | 2 | 部分实现：提交/推送/MR 分步确认与回执、UNKNOWN 只核对、失败知情确认可用；实现设计明令禁止的产品内合并（可将任务置为已完成）、已有原 MR 不核对可能重复创建；推送缺预览/换名重预览、漂移后目标 tip 无重读路径 |
| TD05 非 Git 应用与三方冲突 | 13 | 是 | 0 | 1 | 4 | 1 | 部分实现：服务端三方预览/冲突处理/冻结/逐项结果/备份/UNKNOWN 均存在；无三方 diff 与二进制身份视图、应用无确认对话框、take_task 无二次确认、manual_then_recheck 不可选、漂移整批拒绝与设计逐项阻塞不同、非全宽视图 |
| TD06 工作区保全与清理 | 8 | 是 | 0 | 1 | 1 | 0 | 部分实现：清理预览/删除保留对象/未交付知情/阻塞/过期/未知核对在需求画布工作区页签可用；任务画布无工作区详情抽屉与清理入口（TD06 8 状态在画布不可达，同根因见 07 P13-12）、清理阻塞无定位、部分清理无逐步骤结果 |
| TD07 MR 任务来源与交付结果 | 3 | 是 | 0 | 0 | 1 | 0 | 部分实现：GitLab MR 列表/详情/外部链接已有；契约无 MR↔任务绑定，缺“来源任务”列/chip、缺“该任务已交付”与“MR 未合并/已关闭”两条独立事实、缺 closed-later 说明 |
| **合计** | **70** | 是 | **0** | **6** | **16** | **6** | — |

**最重要的问题（≤5 条）**
1. `DEL-07`（P1）实现提供“④ 合并到目标分支”产品内合并并把它当作交付完成路径（`TaskDeliveryPanel.tsx:923-980`、`DeliveryStepList.tsx:279-303`、`packages/engine/src/delivery.ts:248-315`），而设计明令“不画可执行的产品内 merge”“产品内合并未提供”（`DESIGN-DELTA.md:46-57,292`、`STATES.md:110`）；同产品 Git MR 面板又写着“产品内不提供合并按钮”（`MergeRequestsPanel.tsx:147`），口径自相矛盾。
2. `DEL-13`（P1）TD03“任务变更”视图整体缺失：无任务上下文条、左文件树、中 diff 查看器、离开上下文确认；交付面板只有扁平文件勾选（`DeliveryFileSelect.tsx:82-160`），服务已有 `GET /api/tasks/:id/changes/files/:fileId/diff`（`http.ts:658`）但前端无调用——用户无法在提交前看到具体改动。
3. `DEL-01`（P1）TD01 隔离准备的异常状态家族缺失/不可达：不可用、空仓库、同名冲突、基线前移、回执未知、部分创建都没有专属呈现；前端 `prepareWorkspace` 从不传 `expectedBaseTip`（`api/workflow.ts:292-303`、`RequirementCanvasPage.tsx:334-336`），设计要求的“基线前移→重读重确认”从 UI 无法触发；`partial` 也没有逐步清单与定向恢复。
4. `DEL-20`（P1）非 Git 应用缺三方 diff/二进制身份视图（`DeliveryApplyPreview.tsx:168-236`），且“确认应用到原目录”一键直接执行（`:218-238`），缺设计要求的应用确认对话框（A/M/D、冲突处理构成、备份证据、“服务未提供备份证据”），写入原目录前用户看不到完整后果。
5. `DEL-14`（P1）已有原 MR 不核对：`createMergeRequest` 每次直接 POST（`delivery.ts:199-246`），没有“同一原请求/同一源→目标已有合法 MR 则显示原链接不重建”的判定与读回，存在重复创建 MR 的风险，也缺 `td04-mr-exists` 状态。

以上 28 条问题均有静态可核对证据；其中 17 条在静态证据之外还需要真实服务/GUI 复核（`DEL-01/02/04/07/12/13/14/15/17/18/20/22/23/24/26/27/28`），另在「需 GUI / 运行验证」章列 10 项。

## 状态覆盖

### TD01 开始任务与隔离准备（12 状态；`sources/delivery/STATES.md:13-24`；规格 `DESIGN-DELTA.md:92-157`；v4 迁移 `sources/supplement-v4/STATE-MAP.md` 与 `COVERAGE-v4.md:15-19`）

| mock state | 设计名称 | 实现判定 | 证据（实现文件:行 / 无） | 说明 |
|---|---|---|---|---|
| `td01-git-plan` | Git 项目 · 计划确认（准备工作区 → 开始执行） | 部分 | `WorkspacePanel.tsx:206-330`（计划与确认 -> 独立工作区）；两按钮 `:300-311`、`:411-440`；设计 `STATES.md:13` | 有“准备→开始”两步与原因行；缺设计工作区卡的“任务名/ID、系统生成任务分支、工作目录显示名与可复制路径、读写授权摘要、诊断详情”，准备确认对话框也没有（DEL-02/DEL-04） |
| `td01-nongit-plan` | 非 Git 项目 · 基线快照与独立副本 | 部分 | `WorkspacePanel.tsx:225-233`（未准备时通用文案）、`:236-241`（准备后类型/位置/原目录）；契约 `models.ts:850-871`（`TaskWorkspace` 无 baseline.scope/excluded/notCopied/快照时间） | 准备后能区分“目录副本（非 Git）”；缺设计要求的快照时间、范围、排除项、未复制资源（210 MB）与“不能声称整项目已隔离”说明（C1，DEL-03） |
| `td01-checking` | 项目类型正在核对 | 缺失 | `enums.ts:294-300`（RepoGitState 只有 git/not_git/path_unavailable/capability_unavailable，无核对中）；`StartPage.tsx:416-424` 直接给结果文字 | 无“正在核对项目类型”虚线态，也不禁用“形成需求草稿”（DEL-06） |
| `td01-combined` | 备选文案：「准备并开始」（待 API 评审二选一） | 不适用（已选两步方案） | `WorkspacePanel.tsx:300-311,411-440`；设计 `DESIGN-DELTA.md:125-127`（两种只能二选一） | 实现选择“准备→开始”两步，未混用备选文案，符合设计二选一规则（C9，不是缺陷） |
| `td01-preparing` | 准备独立工作区中（阶段名，无百分比） | 部分 | `WorkspacePanel.tsx:264-278`（阶段条）、`workspace.ts:144-151`（一次性写入 5 步，只有首步 running）、`:169-179,211-219`（完成后一次性全 completed）；设计 `STATES.md:17` | 无百分比 ✓；但准备是一次同步命令，阶段条只在开始与完成两端变化，没有“每阶段带结果摘要/逐阶段推进”的中间态（DEL-04） |
| `td01-ready` | 准备成功 · 单独开始执行 | 部分 | `WorkspacePanel.tsx:236-264`（分支/基线/目录）、`:411-440`（开始执行）；`RequirementCanvasPage.tsx:338-345` | 工作区就绪后“开始执行”才可用 ✓、成功后进入任务画布 ✓；但点击开始执行没有设计要求的二次确认（“写节点只在任务工作区运行、结束后停在等待交付”）（DEL-05） |
| `td01-unavailable` | 项目不可用 / 权限不足 | 部分 | 准备失败统一 `AppError` → `CommandErrorNotice`（`RequirementCanvasPage.tsx` 命令错误区）；项目卡对 `path_unavailable/capability_unavailable` 禁用 `StartPage.tsx:151`；设计 `STATES.md:19` | 只有通用错误与项目卡禁用；缺“无法读取 · 权限不足”的项目卡 danger 态、缺「查看项目」「授权说明」就近动作（DEL-01） |
| `td01-empty-repo` | Git 空仓库 / 基线不可用 | 部分 | `workspace.ts:196-200`（`WORKSPACE_PREPARE_FAILED`“无法解析基线提交（可能是空仓库或 HEAD 不可用）”）；UI 只有错误提示；设计 `STATES.md:20` | 服务不伪造 SHA、不自动初始提交 ✓；但界面无“空仓库 · 没有可用基线”专属态、无「重新读取」「查看项目」，工作区直接 blocked（DEL-01） |
| `td01-name-conflict` | 分支 / 目录同名冲突 | 缺失 | `workspace.ts:204-219`（`createWorktree` 失败 → catch 标 blocked，见 `:228-236`）；无占用对象读模型/新名称重新预览 | 设计要求的“逐个列出被占用对象、可复制、只读查看、使用新名称重新预览”全部缺失；失败后只剩整段重试（DEL-01） |
| `td01-baseline-drift` | 基线前移 · 重读后重新确认 | 缺失（不可触发） | 服务仅当 `input.expectedBaseTip !== undefined` 才比对（`workspace.ts:201-203`）；前端 `prepareWorkspace` 从不传（`api/workflow.ts:292-303`）；UI 也没有基线预览 | 设计“旧基线 5b3a8f1 vs 当前 7c1e9a2 + 2 个新提交 + 按新基线准备”整条链路不可达（DEL-01） |
| `td01-prepare-unknown` | 准备回执未知 · 核对原创建 | 部分 | 通用回执 UNKNOWN 横幅（`flow/workflow-ui.tsx:116-147`）含原请求号与“按原请求号核对”；工作区步骤无 unknown 虚线态（`WorkspacePanel.tsx:264-278`） | “只核对原创建、不重新准备/不分配第二个目录”的语义靠通用回执提示，缺设计的分阶段未知标记与专属“核对原创建”动作（DEL-01） |
| `td01-partial` | 部分创建 · 已发生步骤与定向恢复 | 部分 | `workspace.ts:45-90`（重启同步把 preparing→partial、步骤置 failed 并带 detail）；`WorkspacePanel.tsx:280-286`（partial/unknown/blocked 统一横幅） | 能显示“部分创建”与阶段状态；没有“已发生步骤清单（已建分支/未建目录）”“补建工作目录”等定向恢复入口，只能整体重新准备（DEL-01） |

### TD02 任务画布与待交付（11 状态；`sources/delivery/STATES.md:30-40`；规格 `DESIGN-DELTA.md:158-212`）

| mock state | 设计名称 | 实现判定 | 证据（实现文件:行 / 无） | 说明 |
|---|---|---|---|---|
| `td02-running` | 执行中 · 状态栏显示独立工作区 | 部分 | `TaskCanvasPage.tsx:353-365`（副行工作区状态）；交付面板入口 `:393-397,672-678`；面板在无交付时 `TaskDeliveryPanel.tsx:476-493`（“还不能交付”） | 工作区仅副行文字，无工作区 chip；画布侧情况条“交付：未到达”与端点缺失见 07 P13-02/P13-16，本区域不重复 |
| `td02-parallel` | 同任务并行写 · 子隔离与汇合策略 | 部分（设计边界内） | 契约 `models.ts:850-871`（children/activeWrites 存在）；`TaskDeliveryPanel.tsx:538-551` 只显示并行策略文字；设计 `STATES.md:31` | PE28 子隔离与汇合明确不开放（C9）；设计允许的“只展示服务策略”在面板只有一行文字，画布子工作区标签未接（同 07） |
| `td02-awaiting` | 执行已结束 · 等待交付 | 部分 | 投影/原因 `TaskDeliveryPanel.tsx:526-537`；工作区/验证事实 `:538-551`；文件选择 `:623-632`；目标 `:646-663`；交付步骤 `:694-712`；设计 `STATES.md:32` | 交付面板主流程齐备；缺“执行与验收摘要 + 验证日志入口”“工作区公开身份”（DEL-08）；入口首要动作「查看变更并交付」在页脚且只定位文件列表（DEL-19） |
| `td02-blocked` | 交付受阻 · 仍有活动写入 / 未停稳 | 部分 | 投影 blocked + 原因文本 `TaskDeliveryPanel.tsx:526-537`；`delivery.ts:348-365`（投影 blocked 仅存单条 reason）；设计 `STATES.md:33` | 有“交付受阻”徽标与原因句；缺设计“面板顶部逐条阻塞原因，每条可定位到节点或审计记录”（DEL-09） |
| `td02-no-changes` | 没有文件变更（特殊结算为候选） | 部分 | `DeliveryFileSelect.tsx:74-81`（空态“没有文件变更…不会创建空提交，也不会伪造变更”）；设计 `STATES.md:34` | “不造空提交/假 MR”诚实呈现 ✓；缺设计“确认无文件交付并结束”候选按钮与“候选·待产品/API 核准”标注（DEL-10） |
| `td02-failed-candidate` | 验证未通过 · 失败候选交付资格 | 部分 | `TaskDeliveryPanel.tsx:562-570`（验证未通过横幅）、`:811-815`（提交前知情勾选）；`delivery.ts:83-143` | 有“验证未通过→知情确认→提交记录事实”的链路；缺设计“交付资格·由原证据规则判定（允许时写依据）”独立区块；失败记录不被勾选清除 ✓ |
| `td02-step-committed` | 已提交 · 等待推送确认（任务未完成） | 部分 | `delivery.ts:117-135`（commit 后 projection=awaiting_confirmation，reason“提交完成，等待推送确认”）；`TaskDeliveryPanel.tsx:526-537`；设计 `STATES.md:36` | 事实正确、任务未置完成 ✓；投影徽标用通用“等待确认下一步”，不是设计“交付进行中 · 等待推送确认”/“1/3”（DEL-11） |
| `td02-delivered` | 任务已交付 · MR 未合并（独立事实） | 部分 | `TaskDeliveryPanel.tsx:596-628`（提交/远端/MR 链接/完成记录/保留状态 + “MR 未合并是 GitLab 的独立事实”静态说明）；`delivery.ts:199-246` | 交付回执块与 MR 链接 ✓；MR 的打开/合并/关闭状态没有读取 GitLab，只是静态说明（DEL-12） |
| `td02-delivered-verify-failed` | 已交付 · 验证未通过 | 部分 | `TaskDeliveryPanel.tsx:596-600`（warn 变体“已交付 · 验证未通过”）；列表/画布交付投影无法区分（同 07 P13-17，C1） | 面板内区分 ✓；任务列表/画布徽标仍无法区分全部通过与知情交付（跨区域记录） |
| `td02-background` | 另一个任务后台待交付 · 不抢当前视图 | 缺失 | 设计 `STATES.md:39`；任务页无后台提示（同 07 P13-16）；全局角标 `Shell.tsx:48,109-113` | 画布/交付面板均无 `role=status` 后台提示；本区域不重复，见 07 P13-16 |
| `td02-cancelled-retained` | 已取消 · 文件保留可稍后交付 | 部分 | 生命周期“已取消”`taskStatus.ts:85-87`；交付面板仍可打开，显示保留状态 `TaskDeliveryPanel.tsx:538-551`；设计 `STATES.md:40` | 可重新进入交付 ✓；缺设计“未交付 · 文件保留，可稍后交付”专属情况条/面板说明，也不改写取消事实 |

### TD03 Git 任务变更（6 状态；`sources/delivery/STATES.md:46-51`；规格 `DESIGN-DELTA.md:214-248`）

| mock state | 设计名称 | 实现判定 | 证据（实现文件:行 / 无） | 说明 |
|---|---|---|---|---|
| `td03-changes` | 任务变更模式 · 文件树 + diff + 完成目标 | 缺失（仅文件勾选列表） | 实现只有 `DeliveryFileSelect.tsx:82-160` + `DeliveryStepList`；无任务上下文条/文件树/diff 查看器；设计 `DESIGN-DELTA.md:214-248`、`STATES.md:46` | 设计要求的左文件树（A/M/D）、中 diff（统一/并排/忽略空白/全宽）、“验证与成果”页签、上下文条（项目/分支/基线/快照/返回任务）全部缺失（DEL-13） |
| `td03-excluded` | 未纳入 / 忽略文件及原因 | 部分 | `DeliveryFileSelect.tsx:135-160`（未纳入 N 项 + 路径 + reason，只读不能加入）；设计 `STATES.md:47` | 路径与原因 ✓、不加入 ✓；缺“规则来源与数量”的结构化展示与左栏入口，混在文件选择区 |
| `td03-large-binary` | 大文件分段 · 二进制 · 权限变更 | 部分 | `DeliveryFileSelect.tsx:96-97`（二进制/权限徽标）、`:105-112`（行数未知）；设计 `STATES.md:48` | 有二进制/权限文字标签；缺大文件分段“读取下一段/加载全部”、缺权限 100644→100755 具体值、缺二进制大小与内容标识（DEL-13） |
| `td03-leave-context` | 切到普通历史 · 退出任务上下文 | 缺失 | 设计 `DESIGN-DELTA.md:228-231`；实现无任务变更上下文（无 `from/fromState` 参数、无退出确认、无草稿归属） | 无上下文可退出；文件选择与提交信息草稿只存在交付面板组件 state，离开即丢（DEL-13） |
| `td03-loading` | 读取任务变更中 | 部分 | `DeliveryFileSelect.tsx:63-73`（骨架 3 行）；`TaskDeliveryPanel.tsx:428-436` 面板骨架 | 有骨架；设计要求的“文件列表→差异阶段文字、步骤栏锁定并说明原因”缺失 |
| `td03-read-error` | 变更读取失败 / 快照过期 · 重读 | 部分 | `DeliveryFileSelect.tsx:74-76`（`FailureNotice` + 重试）；`changesQuery` 错误（`TaskDeliveryPanel.tsx:132-137`） | 有错误与重试；设计“不显示旧文件列表、保留读取时间、步骤栏暂停”未实现（只清空/报错，交付步骤仍可用） |

### TD04 Git 交付动作与回执（17 状态；`sources/delivery/STATES.md:57-73`；规格 `DESIGN-DELTA.md:250-294`）

| mock state | 设计名称 | 实现判定 | 证据（实现文件:行 / 无） | 说明 |
|---|---|---|---|---|
| `td04-goal` | 选择完成目标（三选一） | 部分 | `DeliveryGoalPicker.tsx:15-40`（local_commit/push_branch/create_merge_request + 非 Git apply_to_original）；`:76-95`；`DeliveryStepList.tsx:227-303`；设计 `STATES.md:57` | 目标卡与依赖链文案齐备；缺设计“完成后仍留在工作区的内容/已选未选文件数”摘要；目标要额外点“保存目标与选择”才记录（设计选择即记录，可接受） |
| `td04-commit-confirm` | 提交确认 | 部分 | `TaskDeliveryPanel.tsx:746-824`（目标分支/head/文件 A/M/D/变更版本/作者/验证/文件清单/提交信息/知情勾选/失败提示）；设计 `STATES.md:58` | 主体确认信息齐备；缺“基线、未选文件保留、验证摘要（明细）”与“提交后仍未交付且不自动推送”的完整确认句；对话框焦点限定依赖 `Modal` 组件（需 GUI） |
| `td04-commit-drift` | 文件版本已变化 · 保留草稿重新确认 | 部分 | 服务 `delivery.ts:83-143`（STALE_TARGET 时抛错并失败回执）；UI 弹窗保留提交信息/勾选（组件 state），错误用 `FailureNotice`（`TaskDeliveryPanel.tsx:820-823`） | 草稿保留 ✓、不静默采用新版本 ✓；缺“复核变更（读取 cr-8 标出变化）→ 重新确认”的动作与新旧版本对比（DEL-15 邻近） |
| `td04-hook-rejected` | 提交被 hook 拒绝（脱敏原因） | 部分 | `DeliveryStepList.tsx:113-120`（`state.error.message/code/output`）；`TaskDeliveryPanel.tsx:820-823`（对话框内 `FailureNotice`） | 有失败原因与 output；是否脱敏取决于服务/适配器（需真实服务核对），错误提示未按设计放在“提交信息字段旁”，也没有“不提供跳过 hook”的明确说明（DEL-18，需真实服务） |
| `td04-commit-only-done` | 目标「仅本地提交」· 提交成功即任务已交付 | 已实现 | `delivery.ts:117-135`（local_commit 提交成功 → delivered + taskCompletionRef + lifecycle completed）；`TaskDeliveryPanel.tsx:596-628`；E42 真实 Git/GUI 证据 `docs/verification/2026-10-20-delivery-goals-selected-index.md` | 与设计“提交成功即完成所选交付”一致 |
| `td04-committed-wait-push` | 提交完成 · 等待推送确认 | 部分 | 投影 awaiting_confirmation `delivery.ts:121-123`；步骤卡 ② ready `DeliveryStepList.tsx:243-259`；设计 `STATES.md:62` | 事实与“未自动推送”一致；缺设计“目标区收起为摘要 + 改变目标…”入口（goal-change 为设计候选，C9） |
| `td04-push-confirm` | 推送确认（新远端分支 · 不强推） | 部分 | `TaskDeliveryPanel.tsx:825-870`（源提交/远端地址/项目/新分支名/“只创建新分支，永不强推”/继续 MR 勾选）；适配器 `git-cli.ts:437-450`（非 FF 拒绝、认证失败分类） | 有确认与只新建分支语义；缺账户/服务器公开名/连接版本（C1 读模型无此字段）、缺“预览推送”先读远端；推送名默认取任务分支，可编辑 |
| `td04-push-exists` | 远端同名分支 · 换新名重新预览 | 部分 | `api/git.ts:576-587`（`expectRemote:'absent'`）；`git-cli.ts:441-443`（非 FF/已存在 → PUSH_REJECTED_NON_FF）；UI 只有失败提示可改名重试 | 没有“先预览（读远端确认无同名）→ 再确认”的两段；同名冲突只能在尝试后报错，也没有设计“用新名称重新预览”的显式动作（DEL-15） |
| `td04-push-auth` | 未认证 / 账户用途不足 · 查看 Git 设置 | 部分 | `git-cli.ts:444-446`（GITLAB_AUTH_FAILED）；UI `FailureNotice` 只显示错误文本 | 缺设计「查看 Git 设置」「重新读取连接」出路，也不说明提交保留（DEL-18） |
| `td04-push-failed` | 推送明确失败（已证明无副作用） | 部分 | `delivery.ts:145-197`；失败可重新点确认（每次新 requestKey，`api/git.ts:576-587`） | 明确失败可发新请求 ✓；没有“服务已证明无副作用”的界面判定与说明，也没有“不提供再试一次”的文案区分（DEL-18，需真实服务） |
| `td04-push-unknown` | 推送回执未知 · 只核对原推送 | 部分 | `delivery.ts:190-195,319-345`（UNKNOWN 分类 → projection unknown_receipt、步骤 unknown）；`DeliveryStepList.tsx:157-167`（只给“核对原操作”）；`git-shared.tsx:528-600` | 只核对原 key、不重发 ✓、MR 步骤锁定 ✓；核对只读本地操作台账，未按设计读取远端分支比对原推送（DEL-17，需真实服务） |
| `td04-mr-confirm` | 创建 MR 确认 | 部分 | `TaskDeliveryPanel.tsx:871-922`（源 ref/SHA、目标分支下拉 + tip、评审人“暂未接通”、标题 255、说明）；设计 `STATES.md:68` | 主体齐备；缺“目标 tip 读取时间”、缺设计“评审人不可选”的禁用语义（显示文字即可）；目标分支列表来自本地/远端分支 |
| `td04-target-drift` | 目标分支前移 / 源变化 · 重读重确认 | 缺失（无重读出路） | 服务 `delivery.ts:199-246` 用 `expectedTargetTip` 比对并抛 STALE_TARGET（引擎读 `git createMergeRequest`，漂移在远端/适配层）；UI 交付面板“重新读取”只重取 detail/delivery/changes（`TaskDeliveryPanel.tsx:511-525`），不重取 `branchesQuery`（`:145-151` 的 query 无 invalidate） | 漂移后目标 tip 仍是旧值，用户无法在界面里“重新读取目标分支”再确认（DEL-16） |
| `td04-mr-exists` | 已有合法原 MR · 显示原链接不重建 | 缺失 | `delivery.ts:199-246` 每次直接调用远端 `createMergeRequest`，无“按原请求标记查找已有 MR”的核对；契约无 MR↔delivery 绑定（`models.ts:1114-1128` 无 task 字段） | 存在重复创建 MR 风险；设计“显示原链接不重建/按原 MR 回执结算”未实现（DEL-14） |
| `td04-mr-unknown` | MR 创建回执未知 · 只核对原操作 | 部分 | `delivery.ts:239-243`（UNKNOWN 分类）；回执核对走 `operations.by-key`（`git-shared.tsx:582-620`）；无按原请求标记到 GitLab 找 MR | “不重复 POST”有跨区域保证（按钮 busy/hasUnknown）；但设计“按原请求标记查找 MR 并转已有原 MR”缺 C1 能力（DEL-17，需真实服务） |
| `td04-delivered` | 所选目标全部成功 · 任务已交付 | 部分 | `delivery.ts:199-246`（MR 成功 → delivered + lifecycle completed）；`TaskDeliveryPanel.tsx:596-628`（提交 SHA/远端 ref/MR 链接/完成记录/保留状态 + MR 独立事实说明） | 交付读回与回执卡 ✓；MR 的合并状态未读取（DEL-12）；“返回任务/查看 MR/工作区详情”三入口中工作区详情缺失（同 DEL-26） |
| `td04-goal-change` | 未完成时改变目标（API 未冻结） | 不适用（设计候选） | 设计 `sources/delivery/README.md:19`（P2 待冻结）、`STATES.md:73`；实现开始交付步骤后禁用目标切换（`TaskDeliveryPanel.tsx:646-663`） | 设计本身标“API 未冻结，只画确认形态”，实现以“开始交付后锁定目标”替代，不列为缺陷（C9） |

### TD05 非 Git 应用与三方冲突（13 状态；`sources/delivery/STATES.md:79-91`；规格 `DESIGN-DELTA.md:296-335`）

| mock state | 设计名称 | 实现判定 | 证据（实现文件:行 / 无） | 说明 |
|---|---|---|---|---|
| `td05-overview` | 独立副本变更 · 选择要应用的文件 | 部分 | `TaskDeliveryPanel.tsx:714`（非 Git 内嵌 `DeliveryApplyPreview`）；`DeliveryApplyPreview.tsx:135-166`（生成预览）；文件选择 `DeliveryFileSelect.tsx:82-160`；设计 `STATES.md:79` | 有选择文件 + 生成预览；缺设计“全宽视图（画布隐藏）、面包屑任务列表/任务名/应用到原项目、三来源图例（基线/任务副本/当前原目录）、基线范围与未复制资源披露”，仍内嵌 480 面板（DEL-23） |
| `td05-checking` | 检查当前原目录中 | 部分 | `DeliveryApplyPreview.tsx:144-146`（“正在检查…”按钮 busy），无阶段/进度；设计 `STATES.md:80` | 检查以同步请求完成，无“已检查 n/8”步骤条；检查中“确认应用”可见但被 busy 禁用 ✓ |
| `td05-preview` | 预览逐项结果（无冲突） | 部分 | `DeliveryApplyPreview.tsx:168-217`（可应用/冲突/不支持/未解决计数、逐项 path + plannedEffect + detail）；`:218-238`（重新检查/确认应用） | 逐项动作（新增/替换/删除）与计数 ✓；缺“冻结预览”显式动作与“将写入/保留/留副本”汇总；预览不可导出/对比基线→副本 |
| `td05-conflicts` | 冲突清单（六类） | 部分 | `DeliveryApplyPreview.tsx:168-236`（冲突/不支持项给下拉处理：keep_original/take_task/exclude）；契约 `models.ts:922-937`（conflictType 字段存在）；设计 `STATES.md:82` | 有冲突计数与逐项处理；缺六类冲突类型标签、缺 take_task 二次确认、缺 manual_then_recheck 选项（`DeliveryApplyPreview.tsx:47` 主动排除）、缺“已选 X · 冲突 N 未解决”底栏（DEL-21） |
| `td05-conflict-text` | 文本冲突 · 基线/任务副本/当前原目录 | 缺失 | 无三方 diff 组件（`grep "三分\|三方\|conflict-text"` 仅文案）；服务 `directory-apply.ts` 有逐项 check/冲突类型但无 diff 读口 | 设计核心的三栏对照、统一切换、逐行冲突标记、处理选项全部缺失（DEL-20） |
| `td05-conflict-binary` | 二进制 / 链接 · 不可合并只能选择 | 缺失 | 无二进制身份视图；`DeliveryApplyPreview.tsx:180-211` 只有 path/check/effect；设计 `STATES.md:84` | 缺类型/大小/尺寸/修改时间身份卡与“符号链接不支持”说明（DEL-20） |
| `td05-recheck` | 冲突已处理 · 重新检查并冻结预览 | 部分 | `DeliveryApplyPreview.tsx:218-238`（“重新检查”→新预览，apply 用 previewRef/revision）；`directory-apply.ts:233-280`（revision/expiry/最新预览校验） | 冻结语义在服务端有（revision/expires/最新预览校验）；UI 缺“冻结预览 pv-3”“逐项将写入 5 项/保留 2 项/留副本 1 项”的汇总与“改动选择让冻结失效”提示（DEL-22/DEL-23） |
| `td05-apply-confirm` | 应用确认 | 缺失（无确认对话框） | `DeliveryApplyPreview.tsx:221-238`：`确认应用到原目录` 直接 `applyMutation`；无 `Modal`（全文件仅 268 行，无第二确认层） | 设计确认框（原目录可复制、写入 A/M/D 数、已处理冲突构成、不写入/留副本项、不会改动的无关文件、备份/恢复证据或“服务未提供备份证据”、焦点限定）全部缺失（DEL-20） |
| `td05-drift` | 确认后原目录又变化 · 阻塞对应项 | 部分（语义不同） | `directory-apply.ts:281-289`：应用前重算预览，revision 不同 → 整批抛 STALE_TARGET，**一项都不写**；设计 `STATES.md:87` 要求“该项被阻塞、未写入，其余 4 项已应用、不重做” | 实现是“整批拒绝”，不是设计的“逐项阻塞并继续其余项”（DEL-22） |
| `td05-partial` | 部分成功 / 中断 · 逐项原操作结果 | 部分 | `directory-apply.ts:346-360`（异常时回滚已写入 → markDeliveryFailed）；`:361-370`（mixed results + projectionFor）；UI `DeliveryApplyPreview.tsx:241-258`（逐项 result 徽标） | 有逐项结果表（applied/blocked/unknown/not_executed）；中断路径是回滚+失败，不是设计“不是文件系统事务、已写入项保留、不回滚、不整批重做”；结果徽标显示英文原文（DEL-22/DEL-25） |
| `td05-unknown` | 应用结果待核实 · 只核对原操作 | 部分 | `directory-apply.ts:1391-1395`（unknown>0 → unknown_receipt）；UI `DeliveryApplyPreview.tsx:248-253`（“读取回执”按 key 核对） | 只核对原操作 ✓；缺逐项“核对原操作（读取原目录该项并与原操作比对）”，只有整单回执核对（DEL-25，需真实服务） |
| `td05-applied` | 所选项全部应用成功 · 任务已交付 | 部分 | `directory-apply.ts:386-400`（delivered + lifecycle completed + attention none）；`TaskDeliveryPanel.tsx:596-628`（交付成功块）；`DeliveryApplyPreview.tsx:241-258`（逐项回执表） | 由服务结算后显示“任务已交付” ✓、逐项回执 ✓；缺“保留当前原文件 N 项/按选择留副本项/独立副本不自动清理”汇总与验证事实（DEL-25） |
| `td05-read-error` | 原目录不可读 / 权限 / 路径不可用 | 部分 | `DeliveryApplyPreview.tsx:84-90`（预览失败仅 `errorMessage` 文本）；设计 `STATES.md:91` | 只有错误文本；缺权限/路径/超时分类、缺“明确没有写入/删除/移动任何文件”“候选与副本保留、左侧仍可看基线→副本”、只有重新读取（DEL-24） |

### TD06 工作区保全与清理（8 状态；`sources/delivery/STATES.md:97-104`；规格 `DESIGN-DELTA.md:337-367`）

| mock state | 设计名称 | 实现判定 | 证据（实现文件:行 / 无） | 说明 |
|---|---|---|---|---|
| `td06-detail-git` | 工作区详情 · Git 任务分支与 worktree（520 抽屉） | 缺失 | 任务画布无抽屉（同 07 P13-12）；现有信息仅 `TaskDeliveryPanel.tsx:538-551` 与 `ExecutionPanel.tsx:316-331`；数据 `models.ts:850-871`；设计 `STATES.md:97` | 设计字段（类型/公开身份/原项目/基线/目录与分支/子工作区/创建/最后检查/活动写入/未交付/未决请求/已交付凭证/清理可用性/容量未知/在文件管理器显示）无承载视图（DEL-26） |
| `td06-detail-nongit` | 工作区详情 · 非 Git 基线快照与副本 | 缺失 | 同上；`WorkspacePanel.tsx:236-257` 只有类型/位置/原目录，无基线快照范围/排除/未复制资源 | 同 DEL-26；非 Git 基线披露字段本身 C1 缺（DEL-03） |
| `td06-close-retain` | 关闭 / 取消任务 · 文件保留提示 | 部分 | 取消确认 `TaskCanvasPage.tsx:740-761`（工作区与记录保留、取消不是删除、不会自动清理）；设计 `STATES.md:99` | 有保留说明；缺设计固定句“文件保留，可稍后交付 / 查看”与工作区详情入口（DEL-26/19） |
| `td06-cleanup-preview` | 清理预览 · 删除对象与保留对象 | 部分 | `WorkspacePanel.tsx:317-357`（清理区块）、`:452-570`（预览弹窗：删除/保留/未交付/有效期/知情勾选）；`http.ts:659-680`；设计 `STATES.md:100` | 内容齐备（删除/保留/未交付/过期/阻塞）；位置在需求画布工作区页签而非任务画布 TD06 抽屉；缺“占用空间未知”与“没有定时或自动清理”说明文字（部分）（DEL-26） |
| `td06-cleanup-undelivered` | 有未交付内容 · 额外知情确认 | 部分 | `WorkspacePanel.tsx:538-556`（`requiresUndeliveredAck` 勾选 + 文本）、`confirmBlockedReason` `:102-112`；设计 `STATES.md:101` | 知情确认 ✓；缺“含需保留的唯一产物时不提供删除”变体（服务 blockers 可能覆盖，未单独建模）（DEL-27） |
| `td06-cleanup-blocked` | 清理受阻 · 活动写 / 未知 / 恢复依赖 | 部分 | `WorkspacePanel.tsx:478-501`（blockers 列表 label+ref）、`:102-112`（确认禁用原因）；设计 `STATES.md:102` | 有阻塞列表；缺“每条可跳到对应位置（定位节点/核对原推送/查看恢复记录）”的链接动作（DEL-27） |
| `td06-cleanup-partial` | 部分清理 / 失联 · 核对原清理 | 部分 | `WorkspacePanel.tsx:113-125`（清理回执 accepted/unknown 时禁用并提示按原请求核对）、`:360-390`（按原请求号核对）；`workspace.ts:45-90`（重启时 cleaning→partial）；设计 `STATES.md:103` | 单条未知可核对 ✓；缺设计“按原步骤显示已核实/回执未知/未执行”的逐步骤清单与“不再发同一删除”的逐项动作（DEL-27，C1 无逐步骤结果模型） |
| `td06-cleaned` | 工作区已清理 · 交付回执仍可读 | 部分 | `WorkspacePanel.tsx:288-294`（已清理横幅）、`:317-330`（清理完成后区块）；交付面板仍可读（`TaskDeliveryPanel.tsx:596-628`）；设计 `STATES.md:104` | 已清理状态与回执保留 ✓；无“路径加删除线并标已删除”“变更页签用回执清单，不伪造本地文件仍在”的呈现（DEL-27） |

### TD07 MR 任务来源与交付结果（3 状态；`sources/delivery/STATES.md:110-112`；规格 `DESIGN-DELTA.md:368-378`）

| mock state | 设计名称 | 实现判定 | 证据（实现文件:行 / 无） | 说明 |
|---|---|---|---|---|
| `td07-mr-detail` | MR 详情 · 任务来源与「已交付 / 未合并」 | 部分 | `MergeRequestsPanel.tsx:115-185`（MR 详情：状态/源→目标/作者/时间/webUrl/在 GitLab 打开）；契约 `models.ts:1114-1128`（GitMergeRequest 无 task 绑定/交付时间）；设计 `STATES.md:110` | MR 基本详情 ✓、外部链接 ✓、产品内无合并按钮 ✓；缺“来源任务 chip 可返回任务”“该任务已交付（时间）来自任务交付记录”“MR 未合并来自 GitLab 只读”两条独立事实（DEL-28，C1） |
| `td07-mr-list` | MR 列表 · 任务来源列 | 部分 | `MergeRequestsPanel.tsx:32-113`（列表：标题/iid/源→目标/作者/更新/状态/冲突/流水线）；设计 `STATES.md:111` | 列表存在；缺“来源任务 T-2041 · 已交付”列与其他 MR 的“来源任务 —”（DEL-28，C1） |
| `td07-mr-closed-later` | MR 后来关闭 · 任务交付历史不重开 | 部分 | `MergeRequestsPanel.tsx:122-147`（MR 状态显示 + “MR 未合并不影响任务交付记录”说明）；契约无任务交付记录关联 | 能显示 closed 状态；无法显示“任务交付事实仍是已交付（10-15 16:20），不重开、不改写”的对照，因为没有 MR↔任务绑定（DEL-28，C1） |

## 问题清单

### DEL-01: TD01 隔离准备的异常状态家族缺失/不可达（不可用、空仓库、同名冲突、基线前移、回执未知、部分创建）
- **严重度**：P1
- **维度**：S / A / D
- **类别**：状态 / 交互 / 数据契约
- **设计依据**：`opencode-workflow-design-showcase/sources/delivery/STATES.md:19-24`（td01-unavailable/empty-repo/name-conflict/baseline-drift/prepare-unknown/partial 六态）；`DESIGN-DELTA.md:129-147`（禁用条件与原因文案：项目类型核对中/不可用/空仓库/同名/基线前移/原创建待核对/部分创建）；`DESIGN-DELTA.md:152-153`（部分创建“已发生步骤清单 + 定向恢复入口，不自动清理”）。
- **实现位置**：`packages/engine/src/workspace.ts:108-237`（prepare 单命令；失败统一 `state:'blocked'`，`:228-236`）；`:196-203`（空仓库错误与 `expectedBaseTip` 漂移比对）；`apps/web/src/pages/requirement/WorkspacePanel.tsx:264-286`（阶段条 + partial/unknown/blocked 统一横幅）；`apps/web/src/api/workflow.ts:292-303`（`prepareWorkspace` 只传 `expectedPlanRevisionNumber/expectedBaseRef`，从不传 `expectedBaseTip`）；`apps/web/src/pages/requirement/RequirementCanvasPage.tsx:334-336`；`packages/shared/src/domain/models.ts:850-871`（`TaskWorkspace` 无占用对象/已发生对象/核对状态字段）。
- **差异**：六种异常在 UI 都退化成“工作区状态：受阻/部分创建 + 一段错误文本”：没有“无法读取·权限不足”的项目卡 danger 态与「查看项目/授权说明」；空仓库没有专属空态与「重新读取/查看项目」；同名冲突不列被占用对象、不能“使用新名称重新预览”；基线前移因为前端从不传基线 tip，服务端永远无法判定漂移，设计整条“旧基线 vs 新基线→重读→重确认”链路不可达；准备回执未知只有通用回执横幅，缺分阶段未知标记与专属「核对原创建」；部分创建没有“已发生步骤清单 + 补建工作目录”的定向恢复，只能整体重试。
- **原因**：直接原因：前端只承载“准备/重试”两个动作，未按异常类型分支（C2/C4/C5）。根本原因：`TaskWorkspace`/prepare 读模型没有“占用对象、已发生对象、prepare 请求核对状态、基线 tip 预览”等字段，prepare 也不接收/回传基线预期（C1）。
- **影响**：Git 隔离是防误写原项目的主保障；失败时用户不知道哪些对象已创建、能否重试、如何定向修复，可能反复准备或误以为已隔离。
- **建议**：prepare 读模型补 `occupiedObjects[]`、`completedSteps[]`、`pendingOperationRef/核对状态`、`baseline{ref,sha,previewedAt,tip}`；前端恢复六种专属态与动作（查看项目/授权说明、新名称重新预览、按新基线准备、核对原创建、补建缺步）；`prepareWorkspace` 传 `expectedBaseTip` 或先读基线预览。
- **验证**：静态 + 需真实服务（Git 空仓库/同名/权限/漂移行为）
- **关联状态**：`td01-unavailable`、`td01-empty-repo`、`td01-name-conflict`、`td01-baseline-drift`、`td01-prepare-unknown`、`td01-partial`

### DEL-02: TD01 计划确认缺少设计要求的“工作区卡”字段
- **严重度**：P2
- **维度**：结构 / D / T
- **类别**：结构 / 数据契约
- **设计依据**：`sources/delivery/STATES.md:13`（工作区卡：任务名/ID、基线 main @ 7c1e9a2、系统生成的任务分支、工作目录显示名与可复制路径、读写授权摘要、并行写策略、可折叠诊断详情）；`DESIGN-DELTA.md:106-117`（字段表）；`:122-124`（准备确认框列出将创建与保持不变的对象）。
- **实现位置**：`apps/web/src/pages/requirement/WorkspacePanel.tsx:206-233`（计划与确认、未准备时的说明）；`:300-311`（准备按钮）；准备前无工作区数据（workspace undefined）。
- **差异**：准备前用户只能看到一段“服务会解析基线、创建任务分支与 worktree…”说明，看不到任务身份、将使用的基线、系统生成的分支名、工作目录显示名/路径、读写授权摘要、并行写策略与诊断详情；这些信息要等准备成功后才出现（且仍缺授权/诊断）。
- **原因**：直接原因：未做准备前投影卡（C4）。根本原因：服务没有“worktree preview”读模型，分支名/目录/授权在 prepare 内部临时计算（`workspace.ts:205-219`），无法在确认前展示（C1）。
- **影响**：确认计划→准备工作区前无法核对“会创建什么、基线是哪一版、原目录是否只读”，隔离方案不透明。
- **建议**：新增 workspace preview 读模型（kind/base/branchSuggestion/targetPath/读写授权/parallelWritePolicy/diagnostics），计划确认区渲染只读卡；准备按钮先弹确认框（创建与保持不变对象）。
- **验证**：静态 + 需真实服务（分支名/路径规则）
- **关联状态**：`td01-git-plan`、`td01-nongit-plan`

### DEL-03: TD01 非 Git 基线快照披露字段缺失（快照时间/范围/排除/未复制资源）
- **严重度**：P2
- **维度**：D / 结构
- **类别**：数据契约
- **设计依据**：`sources/delivery/STATES.md:14`（非 Git：快照时间、范围、排除项、未复制的 data/raw-2025.parquet 210 MB 单独列出并说明节点读不到，“不能宣称整个项目已隔离”）；`:98`（TD06 非 Git 详情同字段）；`DESIGN-DELTA.md:149`（TD05 基线披露）。
- **实现位置**：`packages/engine/src/workspace.ts:153-177`（copyToDirectory 复制基线/副本，设置里只写 `baselineRoot/sourceRoot/createdAt`）；`packages/shared/src/domain/models.ts:850-871`（TaskWorkspace 无 scope/excluded/notCopied/快照时间）；`WorkspacePanel.tsx:236-257`（只有类型/位置/原目录/分支/基线）。
- **差异**：界面只写“目录副本（非 Git）”，没有快照时间、范围、排除规则、未复制大文件清单，也没有“这些资源不在副本中，不能声称整项目已隔离”的披露；节点读不到未复制资源时用户无从预判。
- **原因**：直接原因：UI 未渲染这些字段（C4）。根本原因：服务未把基线范围/排除/未复制项写入 `TaskWorkspace` 读模型（C1）。
- **影响**：非 Git 隔离的完整性无法核对，可能误以为整个项目已隔离而漏掉外部依赖文件。
- **建议**：`TaskWorkspace` 增加 `baseline:{capturedAt,scope,exclude[],notCopied[]}`（prepare 时计算并持久化），TD01 准备卡与 TD06 非 Git 详情共同消费；明确“未复制资源节点会读不到”。
- **验证**：静态
- **关联状态**：`td01-nongit-plan`、`td06-detail-nongit`

### DEL-04: TD01 准备阶段只显示两端、阶段名与设计不一致，且缺准备确认对话框
- **严重度**：P2
- **维度**：S / A / T
- **类别**：交互 / 文案
- **设计依据**：`sources/delivery/STATES.md:13`（「准备独立工作区」确认框列出将创建与保持不变的对象）；`:17`（阶段名：登记任务身份 → 固定基线 → 创建任务分支（非 Git 复制快照）→ 创建工作目录 → 核对，每阶段带结果摘要，无百分比）；`DESIGN-DELTA.md:101-104`（阶段顺序）。
- **实现位置**：`packages/engine/src/workspace.ts:144-151`（prepare 起始一次性写入 5 步，只有 resolve_baseline running）、`:169-179,211-219`（成功后一次性全 completed）；`apps/web/src/pages/requirement/WorkspacePanel.tsx:40-48`（步骤 id/中文名：解析基线/创建任务分支/创建独立工作区/校验工作区/绑定任务）、`:264-278`（阶段条）；`RequirementCanvasPage.tsx:334-336`（直接 prepare，无确认对话框）。
- **差异**：①设计五个阶段名与实现不同（登记任务身份/固定基线/创建任务分支/创建工作目录/核对 vs 解析基线/创建任务分支/创建独立工作区/校验工作区/绑定任务）；②准备是同步命令，阶段条在请求期间几乎不动、结束后直接全绿，没有“逐阶段结果摘要”；③点“准备独立工作区”没有确认对话框。无百分比这条 ✓。
- **原因**：直接原因：prepare 是一次阻塞命令且无 progress 投影，UI 没有确认层（C1/C5）。
- **影响**：准备过程像“黑箱”；用户不知道当前在创建什么、需要多久、是否会动原目录。
- **建议**：prepare 改为阶段事件/轮询投影（每阶段 running/completed+detail），前端按设计阶段名渲染；准备前加确认对话框（将创建/保持不变对象）。
- **验证**：静态（阶段事件需真实服务）
- **关联状态**：`td01-preparing`、`td01-git-plan`

### DEL-05: TD01 “开始执行”没有设计要求的二次确认
- **严重度**：P2
- **维度**：A
- **类别**：交互
- **设计依据**：`sources/delivery/STATES.md:18`（准备成功后才出现可用「开始执行」，点击后先确认：说明写节点只在任务工作区运行、结束后停在“等待交付”，再进入 td02-running）；`DESIGN-DELTA.md:124`（开始是两次独立操作的第二确认）。
- **实现位置**：`apps/web/src/pages/requirement/RequirementCanvasPage.tsx:338-345`（`runStartExecution` 直接调用 `startExecution` 成功后跳任务画布）；`apps/web/src/pages/requirement/WorkspacePanel.tsx:411-440`（开始执行区说明 + 按钮，无 Modal）。
- **差异**：点击即发命令并跳转，没有确认对话框；“结束后停在等待交付/写节点只在任务工作区运行”的后果只在上方一段 hint 里。
- **原因**：直接原因：缺少二次确认层（C5）。
- **影响**：误点会直接开始执行（唤起模型/写工作区），无最后一道确认。
- **建议**：开始执行前加确认框（工作区/写入范围/结束后状态/可暂停取消），确认后再发命令。
- **验证**：静态
- **关联状态**：`td01-ready`、`td02-running`

### DEL-06: 项目类型“正在核对”状态不存在
- **严重度**：P3
- **维度**：S / D
- **类别**：状态 / 数据契约
- **设计依据**：`sources/delivery/STATES.md:15`（刚选中项目时隔离方式显示“正在核对项目类型”（unknown 虚线），不默认为非 Git；核对完成前形成草稿禁用并就近说明）。
- **实现位置**：`packages/shared/src/domain/enums.ts:294-300`（RepoGitState 只有 git/not_git/path_unavailable/capability_unavailable）；`apps/web/src/pages/start/StartPage.tsx:416-424`（直接显示“Git 仓库/非 Git 目录/路径不可用/Git 能力不可用”）；`:151`（不可用项目禁用）。
- **差异**：没有“核对中”的未知态与虚线样式；项目类型总是确定值（或能力不可用），不存在临时未知。
- **原因**：直接原因：UI 无 unknown 隔离方式行（C2）。根本原因：投影没有 `checking` 状态（C1）。
- **影响**：在类型检测慢/失败时，界面会直接给确定结论或能力不可用，用户可能误判隔离方式。
- **建议**：项目读模型增加 `gitState:'checking'`（或 `unknown` + reason），准备与形成草稿在有未知时禁用并就近解释。
- **验证**：静态
- **关联状态**：`td01-checking`

### DEL-07: 实现提供设计明令禁止的产品内合并，并作为交付完成/任务完成路径
- **严重度**：P1
- **维度**：S / A / 结构
- **类别**：范围 / 交互
- **设计依据**：`sources/delivery/DESIGN-DELTA.md:46-51`（“明确不做：不画可执行的产品内 merge、流水线、强推…”）；`:57`（“当前产品内合并未实现；本轮不给可执行 merge（§1 MR 独立）。MR 之后只给「在 GitLab 打开」”）；`:292`（禁用条件：合并“不提供按钮；合并在 GitLab 中进行，产品内合并未提供”）；`sources/delivery/STATES.md:110`（MR 详情“合并只有「在 GitLab 打开并合并」导航链接并说明产品内合并未提供；全页没有可执行合并按钮”）；`API-DESIGN-CANDIDATE.md:468`（`fix.merge`/直接合并不进入本增量）。
- **实现位置**：`apps/web/src/pages/delivery/DeliveryStepList.tsx:279-303`（“④ 合并到目标分支”步骤卡，`action=serverAction(actions,'merge','delivery.merge')`）；`apps/web/src/pages/delivery/TaskDeliveryPanel.tsx:923-980`（合并确认对话框：目标分支/策略 no_ff|ff_only/合并信息，按钮 variant=danger）；`:902-905`（MR 对话框：“你也可以在 GitLab 完成合并，或在下方用本地合并（独立确认，no-ff + CAS）”）；`apps/web/src/api/git.ts:603-620`（`mergeDelivery`）；`packages/engine/src/delivery.ts:248-315`（`merge` 在临时 worktree 合并并按 CAS 更新本地目标分支，成功后 `projection:'delivered'`、`lifecycle:completed`）；`packages/shared/src/domain/enums.ts:221-228`（DeliveryStep 含 `MERGE`）；`packages/server/src/http.ts:748`（`POST /api/tasks/:id/delivery/merge`）；`packages/server/src/adapters/git-cli.ts:452-497`（真实 `mergeTaskBranch`）。
- **差异**：设计要求“交付完成目标只有 本地提交/推送/MR/非 Git 应用，产品内合并不提供”，实现新增了第四个写步骤“合并到目标分支”，且合并成功会把交付投影置为“任务已交付”、任务生命周期置为 completed；同一产品的 Git MR 面板却明确写“产品内不提供合并按钮。合并、关闭与流水线都在 GitLab 完成”（`apps/web/src/pages/git/MergeRequestsPanel.tsx:147`），两处口径冲突。这是实现自造设计明确禁止的能力，并会改变“交付事实由 MR 读回”的语义。
- **原因**：直接原因：交付面板/引擎新增 merge 步骤与入口（C4 多余能力）。根本原因：实现阶段把旧 Git 设计/修复流程的 merge 能力带入 delivery 范围，未按 DESIGN-DELTA 的非目标裁剪（C9 边界被违背）。
- **影响**：用户可以在产品内直接把任务分支合入目标分支并把任务标记完成，绕过设计规定的“提交/推送/MR 或在 GitLab 合并”路径；MR 未合并独立事实、交付证据与 GitLab 侧记录可能分叉；与 Git 页文案直接矛盾，用户无法判断哪条是事实来源。
- **建议**：按设计移除交付面板的“合并到目标分支”步骤与入口（保留 Git 修复域的既有 merge，若确需保留也必须移出普通任务交付并更新设计权威）；若产品决定保留，则必须同步改设计稿并明确 merge 后的交付结算语义（不得与 MR 独立事实冲突）。此处需 Lead/产品决策。
- **验证**：静态可证；涉及真实 Git 合并副作用需真实服务确认
- **关联状态**：`td04-committed-wait-push`、`td04-delivered`、`td07-mr-detail`

### DEL-08: 交付面板缺“执行与验收摘要 + 验证日志入口 + 工作区公开身份”
- **严重度**：P2
- **维度**：结构 / D
- **类别**：结构 / 数据契约
- **设计依据**：`sources/delivery/STATES.md:32`（交付面板：身份、执行与验收摘要（单元测试 41/41、lint 通过或回归 2 个失败）+ 验证日志入口、A/M/D、未处理项、所选目标、当前动作、原请求核对、保留资源、最后更新时间）；`DESIGN-DELTA.md:187`（字段列表）。
- **实现位置**：`apps/web/src/pages/delivery/TaskDeliveryPanel.tsx:526-551`（投影徽标/原因 + 工作区/分支/基线/目录/保留状态/验证结论）、`:716-722`（原验证记录一行文字）；`packages/shared/src/domain/models.ts:964-983`（TaskDelivery 无执行/验收摘要字段；执行验收在 TaskDetailResponse.execution）；`:850-871`（TaskWorkspace 无公开工作区身份字段）。
- **差异**：面板有验证结论标签与一行“原验证记录：state · 通过/失败”，但没有设计要求的“执行与验收摘要（通过 X/Y、lint、回归失败数）与验证日志入口”，也没有工作区公开身份（worktree handle/公开 ref），只用 displayRoot 显示路径。
- **原因**：直接原因：面板未组装执行验收摘要与日志入口（C4）。根本原因：交付读模型没有工作区公开身份字段（C1），验收摘要需从 `TaskDetailResponse.execution` 二次组装（当前未做）。
- **影响**：用户在交付前无法在面板内确认“执行与验收到底怎么样、验证日志在哪”，只能跳节点详情逐个找。
- **建议**：面板消费 `detail.execution.acceptance`/`verification` 渲染验收摘要与验证日志入口（可用节点/尝试日志或产物）；`TaskWorkspace` 增 `publicRef`（脱敏）用于身份摘要。
- **验证**：静态
- **关联状态**：`td02-awaiting`、`td02-delivered`

### DEL-09: 交付受阻原因不可定位（无节点/审计链接）
- **严重度**：P2
- **维度**：A / D
- **类别**：交互 / 数据契约
- **设计依据**：`sources/delivery/STATES.md:33`（面板顶部列出原因，每条可定位到节点或审计记录）；`DESIGN-DELTA.md:190-196`（“查看变更并交付”禁用原因与定位）。
- **实现位置**：`apps/web/src/pages/delivery/TaskDeliveryPanel.tsx:526-537`（只显示 `delivery.projectionReason` 一段文字）；`packages/engine/src/delivery.ts:348-365`（`#recordRemoteFailure`/阻塞只写单条 projectionReason）；`packages/shared/src/domain/models.ts:964-983`（TaskDelivery 无 blockers[]）。
- **差异**：只有一段原因文本，没有逐条理由、没有“定位到节点/审计记录/核对原推送”的动作；“查看变更并交付”等入口也没有按 blocked 原因联动禁用（面板内仍可读文件、可打开）。
- **原因**：直接原因：面板未渲染结构化阻塞（C4）。根本原因：交付读模型没有 `blockers[]{kind,label,nodeId/ref}`（C1）。
- **影响**：用户被一句“交付受阻”挡住，不知道是哪个步骤在写、该去看什么。
- **建议**：`TaskDelivery` 增 `blockers[]`（kind/label/ref，ref 可解析到 nodeId/audit/requestKey），面板按设计逐条列并给定位按钮。
- **验证**：静态
- **关联状态**：`td02-blocked`、`td04-push-auth`、`td05-conflicts`、`td05-drift`

### DEL-10: 无变更结算候选按钮与失败候选“交付资格”区块缺失
- **严重度**：P2
- **维度**：S / 结构 / T
- **类别**：状态 / 结构
- **设计依据**：`sources/delivery/STATES.md:34`（td02-no-changes：明确“没有文件变更”，不生成空提交/假 MR；“确认无文件交付并结束”标“候选·待产品/API 核准”，点击只弹说明不结算）；`:35`（td02-failed-candidate：面板单独显示“交付资格 · 由原证据规则判定”，允许时说明依据与“提交时再次知情确认”；没有能清除失败的勾选）。
- **实现位置**：`apps/web/src/pages/delivery/DeliveryFileSelect.tsx:74-81`（无文件变更空态）；`TaskDeliveryPanel.tsx:546-565`（资格未通过 danger 横幅）、`:562-570`（验证未通过横幅）；`:811-815`（知情勾选）；`delivery.ts:83-143`（commit 时允许提交，不论 eligibility 来源）。
- **差异**：①无变更态只有空列表说明，没有候选结算按钮与“只弹说明、不结算”的占位；②失败候选仅在“不允许”时显示一段资格原因，允许时没有“交付资格·由原证据规则判定/依据”区块；知情勾选只出现在提交对话框，缺“界面没有能清除失败的勾选”的说明。
- **原因**：直接原因：候选态与资格依据块未实现（C4）。根本原因：资格模型只有 `ActionAvailability`（allowed/reason），没有“判定依据/规则来源”（C1）。
- **影响**：无变更任务无法主动收尾（只能一直等待交付）；失败候选的知情交付缺少依据呈现，容易被当成普通提交。
- **建议**：补候选结算占位（禁用+说明“待产品/API 核准”）；`eligibility` 增 `basis/rule` 字段并在面板显示“交付资格·由原证据规则判定”；知情勾选旁写清“不会改变验证失败事实”。
- **验证**：静态
- **关联状态**：`td02-no-changes`、`td02-failed-candidate`

### DEL-11: 交付投影文案漂移（等待确认/进行中/待核对）
- **严重度**：P3
- **维度**：T
- **类别**：文案
- **设计依据**：`API-DESIGN-CANDIDATE.md:167-176` 交付投影表（待选择=执行已结束·等待交付；待确认=提交完成·等待推送确认/等待你确认应用；进行中=推送中…；待核对=<步骤>结果待核对；已交付=任务已交付，验证失败=已交付·验证未通过）。
- **实现位置**：`packages/shared/src/domain/labels.ts:132-139`（`awaiting_confirmation:'等待确认下一步'`、`in_progress:'交付进行中'`、`unknown_receipt:'结果待核对'`、`awaiting_selection:'执行已结束 · 等待交付'`、`blocked:'交付受阻'`、`delivered:'任务已交付'`）；`TaskDeliveryPanel.tsx:526-537` 使用该标签。
- **差异**：三个投影标签与设计不同：待确认缺“提交完成/等待推送确认”的具体步骤词；进行中缺“推送中…”步骤态；待核对缺步骤名（如“推送结果待核对”）。
- **原因**：直接原因：全局标签按通用投影命名（C3）。
- **影响**：面板/画布徽标与设计文案不一致，用户不知道“等待确认”的到底是哪一步。
- **建议**：投影标签按当前未完成步骤动态拼（提交/推送/应用），或至少给出设计原文；验证失败的已交付标签已在面板内区分（列表/画布仍缺，见 07 P13-17）。
- **验证**：静态
- **关联状态**：`td02-step-committed`、`td02-delivered`

### DEL-12: 已交付面板的 MR 状态是静态说明，未读取 GitLab 独立事实
- **严重度**：P3
- **维度**：D / S
- **类别**：数据契约 / 状态
- **设计依据**：`sources/delivery/STATES.md:37`（“MR「打开中 · 未合并」作为 GitLab 只读的独立事实另起一块”）；`:110`（MR 详情两条独立事实分开显示）。
- **实现位置**：`TaskDeliveryPanel.tsx:607-609`（固定文本“MR 未合并是 GitLab 的独立事实；之后合并或关闭不改写交付记录.”）；交付步骤只存 `mrIid/mrWebUrl`（`models.ts:955-962`），未读取 MR 状态；Git 侧 `MergeRequestsPanel` 能读 MR state（`models.ts:1114-1128`）。
- **差异**：交付成功块只给链接与静态说明，没有读回并显示该 MR 的“打开中/已合并/已关闭”状态。
- **原因**：直接原因：交付面板未跨读 MR 状态（C4）。根本原因：交付与 MR 读模型无绑定，交付面板拿不到对应 MR 的状态（C1）。
- **影响**：用户要核对“MR 是否已合并”必须自己点进 GitLab/Git 页，交付面板无法承担设计要求的独立事实呈现。
- **建议**：交付面板按 `mrIid` 读取 GitLab MR 状态（只读）并分块显示；`TaskDelivery` 增 MR 状态投影或由前端组装。
- **验证**：静态 + 需真实服务（GitLab 读）
- **关联状态**：`td02-delivered`、`td04-delivered`

### DEL-13: TD03“任务变更”视图整体缺失（文件树/ diff / 上下文条 / 离开确认）
- **严重度**：P1
- **维度**：S / 结构 / R / A
- **类别**：结构 / 交互 / 数据契约
- **设计依据**：`sources/delivery/STATES.md:46`（从交付面板进入 Git 工作台“任务变更”上下文：面包屑、上下文条（分支/基线/工作区/快照 cr-7 读取时间）、返回任务、左文件树、中 diff、右侧步骤栏、不显示 AI 审查/任务状态徽标）；`:47-51`（排除项、大文件/二进制/权限、退出上下文确认、加载、读失败）；`DESIGN-DELTA.md:214-248`（字段、禁用条件、页签“任务变更/验证与成果”）。
- **实现位置**：`apps/web/src/pages/delivery/DeliveryFileSelect.tsx:44-160`（仅扁平文件勾选列表 + 未纳入列表 + A/M/D 统计）；`apps/web/src/api/git.ts:482-485`（只有 `fetchTaskChanges`，无 changes diff 前端函数）；`apps/web/src/app/App.tsx:49-50`（只有 `/git`、`/git/:projectId` 路由，无任务变更上下文路由）、`apps/web/src/pages/git/RepoWorkbench.tsx`（全文件无任务变更上下文/交付参数）；服务能力已存在：`packages/server/src/http.ts:657-658`（`GET /api/tasks/:id/changes` + `/changes/files/:fileId/diff`）、`api/contracts.ts:2062-2063`（ROUTES.changes/changesDiff）。
- **差异**：设计 TD03 的 6 个状态全部不可达：没有任务上下文条（项目/分支/基线/快照/返回任务）、没有左文件树与中 diff 查看器（统一/并排、忽略空白、全宽、大文件分段）、没有“任务变更/验证与成果”页签、没有离开任务上下文的确认与草稿保留。用户只能在交付面板里勾选文件路径，看不到具体改了什么就提交。
- **原因**：直接原因：前端没有实现任务变更上下文与 diff 查看（C4）。根本原因：前端路由/API 层没有接已在服务端存在的 `changes/files/:fileId/diff`（C4；服务侧 C1 不成立）。
- **影响**：交付前最关键的“核对变更”环节缺失，用户会盲提交；大文件/二进制/权限变更、排除项、diff 读取失败都无法按设计呈现。
- **建议**：新增任务变更上下文（可在交付面板内切到全宽视图，不必新增一级页）；接 changes diff 端点；按设计渲染上下文条/文件树/diff/未纳入/离开确认；草稿归属到任务。
- **验证**：静态（diff 内容需真实服务）
- **关联状态**：`td03-changes`、`td03-excluded`、`td03-large-binary`、`td03-leave-context`、`td03-loading`、`td03-read-error`

### DEL-14: 已有原 MR 不核对，可能重复创建 MR
- **严重度**：P1
- **维度**：S / A / D
- **类别**：交互 / 数据契约
- **设计依据**：`sources/delivery/STATES.md:70`（td04-mr-exists：同一原请求已创建合法 MR !58 只显示原链接，不建第二个；服务按原 MR 回执结算并读回“任务已交付”）；`:71`（td04-mr-unknown：按原请求标记查找 MR，不重复 POST）；`DESIGN-DELTA.md:283-285`（原子标记 MR 核对）。
- **实现位置**：`packages/engine/src/delivery.ts:199-246`（每次 `createMergeRequest` 直接调用远端创建，无“已有原 MR”查询/核对，也无幂等 replay 之外的保护；`#commands.replay` 只对同一 requestKey 有效）；`packages/shared/src/domain/models.ts:1114-1128`（GitMergeRequest 无 task/delivery 绑定字段）；`apps/web/src/pages/delivery/TaskDeliveryPanel.tsx:871-922`（MR 确认框没有“已有同源→目标 MR”提示）。
- **差异**：设计要求的“已有合法原 MR → 显示原链接不重建/按原 MR 结算”与“UNKNOWN 时按原请求标记查找 MR”都未实现；新 requestKey 下重复点击/网络重试可能创建第二个 MR。
- **原因**：直接原因：MR 创建前不做原操作/MR 核对（C2）。根本原因：MR↔任务交付绑定与“按原请求标记查询 MR”读模型缺失（C1）。
- **影响**：重复创建 MR 是外部副作用，脏化 GitLab；交付回执与 MR 事实也会分叉。
- **建议**：MR 创建前按 delivery/request 标记查询同源→目标 MR；已存在则显示原链接并按原 MR 结算；UNKNOWN 只做核对；服务补 MR↔任务绑定字段。
- **验证**：静态 + 需真实服务（GitLab）
- **关联状态**：`td04-mr-exists`、`td04-mr-unknown`、`td04-delivered`

### DEL-15: 推送缺“预览推送（读远端）”步骤，push-exists/push-auth 只能事后报错
- **严重度**：P2
- **维度**：A / S
- **类别**：交互
- **设计依据**：`sources/delivery/STATES.md:63-65`（推送确认前先“预览推送”读远端；远端同名 → td04-push-exists 填新名称并“用新名称重新预览”；未认证/用途不足 → td04-push-auth 查看 Git 设置、提交保留）；`DESIGN-DELTA.md:270-273`（推送卡：点“预览推送”读远端；预览通过 → td04-push-confirm）；禁用条件 `DESIGN-DELTA.md:288-290`（“新分支名未重新预览不能确认推送”）。
- **实现位置**：`apps/web/src/pages/delivery/TaskDeliveryPanel.tsx:825-870`（推送确认框直接确认后发 push）；`apps/web/src/api/git.ts:576-587`（`pushDelivery` 固定 `expectRemote:'absent'`，无 preview 请求）；`packages/server/src/adapters/git-cli.ts:437-450`（只在 `git push` 后才分类非 FF/认证失败）。
- **差异**：没有“预览推送”读远端、没有“新分支名需重新预览后才能推送”的门槛；远端同名/认证问题只能在用户确认推送并失败后从错误文本得知，且没有“换新名字重新预览”动作（只有可编辑名字+重试）。
- **原因**：直接原因：UI 只有一步确认（C5）。根本原因：服务没有 `task.delivery.push.preview`（读远端）读口，`expectRemote` 未在适配层强制（C1）。
- **影响**：推送失败率高，用户反复试错；不符合“先证明远端无同名再写”的安全流程。
- **建议**：补推送预览读口（读远端、返回同名/认证/连接版本），确认框展示预览结果；改名后必须重新预览；适配层落实 `expectRemote`。
- **验证**：静态 + 需真实服务（远端读）
- **关联状态**：`td04-push-exists`、`td04-push-auth`、`td04-push-confirm`

### DEL-16: 目标分支预览/漂移后无重读路径（刷新不重取分支）
- **严重度**：P2
- **维度**：A / C
- **类别**：交互 / 数据契约
- **设计依据**：`sources/delivery/STATES.md:69`（目标分支前移/源变化 → 先「重新读取目标分支」再用新 tip 重新确认，不拿旧确认直接创建）；`:68`（MR 确认框显示核对后的目标 tip 与读取时间）。
- **实现位置**：`apps/web/src/pages/delivery/TaskDeliveryPanel.tsx:871-922`（MR 对话框：目标分支下拉 + `mrTargetTip`，tip 来自 `branchesQuery`）；`:511-525`（“重新读取交付”只 refetch detail/delivery/changes，**不** refetch `branchesQuery`）；`:145-151`（branchesQuery 定义）；`:188-192`（invalidate 也不含 branches）。
- **差异**：漂移（STALE_TARGET）后没有“重新读取目标分支”的动作，页面刷新按钮不会更新 tip；对话框内显示的是旧 tip，继续确认只会再次失败。
- **原因**：直接原因：刷新/失效范围漏掉分支查询（C5）。根本原因：MR 确认需要的“目标 tip 读取时间/核对状态”没有进入交付读模型（C1，读取时间尤其缺）。
- **影响**：目标前移后用户无法在界面内恢复，只能刷新整页（若仍不重取分支则彻底卡住）。
- **建议**：refresh/invalidate 包含 `gitKeys.branches(projectId)`；确认框显示 tip 读取时间与“重新读取目标分支”按钮；漂移错误直接给该动作。
- **验证**：静态
- **关联状态**：`td04-target-drift`、`td04-mr-confirm`

### DEL-17: PUSH/MR UNKNOWN 只核对本地操作台账，未按设计核对远端/原 MR
- **严重度**：P2
- **维度**：A / D
- **类别**：交互 / 数据契约
- **设计依据**：`sources/delivery/STATES.md:67`（推送回执未知：只有「核对原推送」（读取远端分支比对 9d8c7b6），不重新推送；创建 MR 保持锁定）；`:71`（MR 创建回执未知：只有「核对原操作」（按原请求标记查找 MR），不重复 POST）。
- **实现位置**：`packages/engine/src/delivery.ts:319-345`（UNKNOWN → 记录 `unknown_receipt` + 步骤 unknown）；`apps/web/src/pages/delivery/DeliveryStepList.tsx:157-167`（“核对原操作” → `onVerify(requestKey)`）；`TaskDeliveryPanel.tsx:592-601`（`operations.by-key` 查询）；`git-shared.tsx:582-620`（只显示操作台账状态/stillUnknown）。
- **差异**：“核对原操作”只读 `GET /api/operations/:key`（本地/服务台账状态），没有按设计读取远端分支比对 SHA，也没有按原请求标记去 GitLab 查找 MR；核对完仍可能只剩“仍未知”，无法转成设计的“已有原 MR/已推送”事实。
- **原因**：直接原因：核对动作只接 operations.by-key（C5）。根本原因：远端读口没有“按原请求核对推送/MR”的查询（C1）。
- **影响**：外部写 UNKNOWN 后无法在界面内收敛，用户只能人工去 GitLab 核对。
- **建议**：核对动作分两类：本地台账核对 + 远端事实核对（读远端分支 SHA / 按请求标记查 MR）；结果回写交付步骤并解锁后续步骤。
- **验证**：静态 + 需真实服务（远端核对）
- **关联状态**：`td04-push-unknown`、`td04-mr-unknown`

### DEL-18: 提交/推送确认的字段与失败说明缺失（基线、未选文件、账户公开名、副作用证明/脱敏）
- **严重度**：P3
- **维度**：T / A / D
- **类别**：文案 / 数据契约
- **设计依据**：`sources/delivery/STATES.md:58`（提交确认：目标任务分支、文件数 A/M/D、提交信息、可信作者（来自设置不可改）、基线、变更版本 cr-7、验证摘要，以及“提交后任务仍未交付、不会自动推送”）；`:60`（hook 拒绝：脱敏输出 + 错误放在提交信息字段旁 + 允许修改后新请求、不提供跳过 hook）；`:63`（推送确认：源提交、账户/服务器公开名、精确项目 remote、连接版本、「新建远端分支·不强推·不覆盖」）；`:66`（推送明确失败且证明无副作用才允许新请求）。
- **实现位置**：`TaskDeliveryPanel.tsx:746-824`（提交确认：分支/head/文件 A/M/D/变更版本/作者/验证/文件清单/信息/知情勾选/“本地提交成功即完成…”）；`:825-870`（推送确认：源提交/远端/项目/分支名/只创建新分支/继续 MR 勾选）；`git-cli.ts:437-450`（失败分类与错误信息）；`apps/web/src/pages/delivery/DeliveryStepList.tsx:113-120`（步骤错误 code/message/output）。
- **差异**：提交确认缺“基线、未选文件保留、验证摘要明细、提交后仍未交付”完整句；推送确认缺账户/服务器公开名/连接版本（`ProjectSummary` 只有 remoteDisplayUrl，C1）；hook 拒绝没有“脱敏/不提供跳过 hook/错误在字段旁”的界面保证；推送明确失败没有“已证明无副作用”的界面判定。错误是否已脱敏取决于服务/适配器，静态无法确认。
- **原因**：直接原因：确认框字段未补齐（C4）。根本原因：部分字段（可信作者、账户公开名、连接版本、推送副作用判定）无读模型（C1）。
- **影响**：确认信息不足，用户难以判断提交/推送的对象与后果；失败后不知道能否/如何重试。
- **建议**：补读模型字段并在确认框按设计列出；hook/推送失败按设计在字段旁给脱敏输出与“修改后重新提交/重新预览推送”，明确“不提供跳过 hook/再试一次”。
- **验证**：静态 + 需真实服务（脱敏与副作用判定）
- **关联状态**：`td04-commit-confirm`、`td04-hook-rejected`、`td04-push-confirm`、`td04-push-failed`

### DEL-19: 交付面板“查看变更并交付”按钮实际只是定位文件列表；缺“工作区详情”次要动作
- **严重度**：P3
- **维度**：T / A / 结构
- **类别**：文案 / 交互
- **设计依据**：`sources/delivery/STATES.md:32`（交付面板首要「查看变更并交付」→ Git 任务变更/非 Git 应用视图；次要「工作区详情」）；`DESIGN-DELTA.md:165-166`（去 Git/非 Git 路径）。
- **实现位置**：`TaskDeliveryPanel.tsx:729-745`（foot：“查看变更并交付”→ `onOpenChanges`）；`:190-204`（onOpenChanges 只是滚动并聚焦交付区文件选择，`focusNotice` 提示“已定位到待交付变更”）；`TaskCanvasPage.tsx:672-678`（宿主传入 `onOpenChanges={requestDeliveryFocus}`）。
- **差异**：按钮名是设计的入口名，实际行为只是“在面板内滚动到文件选择”，并不进入任务变更/应用视图（TD03/TD05 全宽视图缺失，DEL-13/DEL-23）；面板没有“工作区详情”次要动作（DEL-26）。
- **原因**：直接原因：入口行为与文案不符（C3/C5）。
- **影响**：用户按设计预期点击后没有得到“变更核对”视图，产生困惑。
- **建议**：在 TD03/TD05 视图补齐前，按钮改成语义准确的“定位到交付文件”；补齐后按设计进入对应视图；补“工作区详情”动作。
- **验证**：静态
- **关联状态**：`td02-awaiting`、`td01-ready`、`td03-changes`

### DEL-20: 非 Git 三方冲突视图缺失 + 应用写入无确认对话框
- **严重度**：P1
- **维度**：S / A / D
- **类别**：交互 / 结构 / 数据契约
- **设计依据**：`sources/delivery/STATES.md:83`（td05-conflict-text：基线/任务副本/当前原目录三栏标签固定，相对基线着色、同处冲突标记、统一/并排与三种比较方向）；`:84`（td05-conflict-binary：只显示三方身份（类型/大小/尺寸/修改时间），不可文本合并）；`:86`（td05-apply-confirm：确认对话框含原目录可复制、写入 5 项 A/M/D、冲突处理 6 项构成、不写入/留副本项、不会改动的无关文件、备份/恢复证据（否则“服务未提供备份证据”、不是文件系统事务）、焦点限定在对话框）；`DESIGN-DELTA.md:305-312`（三方标签固定、四种处理）。
- **实现位置**：`apps/web/src/pages/delivery/DeliveryApplyPreview.tsx:168-217`（只列 check/plannedEffect/path 与下拉处理，无三栏差异视图、无二进制身份字段）；`:218-238`（“重新检查”与“确认应用到原目录”按钮；`applyMutation` 直接 POST，无 `Modal` 二次确认）；服务端 `directory-apply.ts:226-433`（preview/apply 有 items 与 resolutions，但无三方 diff 读口，`ApplyPreviewItem` 仅 path/change/check/conflictType/plannedEffect/detail，见 `models.ts:922-937`）。
- **差异**：用户看不到“基线 vs 任务副本 vs 当前原目录”的具体差异与二进制身份，只能在没有任何 diff 的情况下选择 keep_original/take_task/exclude；点击“确认应用到原目录”即直接写入原目录，没有设计要求的确认对话框（A/M/D、冲突处理构成、不写入项、无关文件、备份证据/服务未提供说明）。
- **原因**：直接原因：冲突处理界面被压缩成“下拉 + 一键应用”（C4/C5）。根本原因：服务缺少三方 diff 与二进制身份读口（C1），备份证据只在应用后结果里出现。
- **影响**：应用原目录是高风险写操作；用户无法核对差异、无法确认备份证据，误操作不可逆（设计明确“不是文件系统事务”）。
- **建议**：补三方 diff/二进制身份读口与 UI；把“确认应用到原目录”改为确认对话框（列写入 A/M/D、冲突处理、不写入/留副本、无关文件、备份证据或“服务未提供备份证据”），确认后再写；“采用任务版本”再二次确认。
- **验证**：静态 + 需真实服务（目录读写）
- **关联状态**：`td05-conflict-text`、`td05-conflict-binary`、`td05-apply-confirm`

### DEL-21: 非 Git 冲突处理缺 take_task 二次确认、manual_then_recheck 选项与冲突类型标签
- **严重度**：P2
- **维度**：A / T
- **类别**：交互 / 文案
- **设计依据**：`sources/delivery/STATES.md:83-85`（处理选项：保留当前原文件、采用任务版本（覆盖已有修改，需再确认对话框）、我已手动解决并只重新检查这一项、暂不交付该项；六类冲突逐项、无“全部覆盖”）；`DESIGN-DELTA.md:300-306`（四种处理与二次确认）。
- **实现位置**：`apps/web/src/pages/delivery/DeliveryApplyPreview.tsx:41-47`（`RESOLUTION_LABEL` 含 manual_then_recheck 文案，但 `type Resolution = Exclude<..., 'manual_then_recheck'>` 主动排除）；`:196-212`（下拉只有 keep_original/take_task/exclude，没有二次确认）；`:168-217`（无 conflictType 展示，虽有 `conflictType` 字段 `models.ts:922-937`）。
- **差异**：“采用任务版本”点选即生效，没有“将替换当前原文件”的二次确认；缺“我已手动解决并只重新检查这一项”（manual_then_recheck）选项；冲突类型（六类）不可见；也没有“无全部覆盖”的明确说明。
- **原因**：直接原因：UI 收窄了服务支持的 resolution 枚举（C4），未做二次确认（C5）。
- **影响**：用户可能误覆盖原文件；手动修复工作流不可达。
- **建议**：恢复四种 resolution（含 manual_then_recheck），take_task 走二次确认对话框，显示 conflictType 文案与“同类冲突无全部覆盖”。
- **验证**：静态
- **关联状态**：`td05-conflicts`、`td05-conflict-text`

### DEL-22: 非 Git 漂移处理与设计不同（整批拒绝 vs 逐项阻塞；失败回滚 vs 不回滚）
- **严重度**：P2
- **维度**：A / S
- **类别**：交互 / 数据契约
- **设计依据**：`sources/delivery/STATES.md:87`（确认后原目录又变化：该项被阻塞、未写入，已重新读取为新冲突；其余 4 项已应用，不重做；只能为未完成项处理冲突后重新冻结、单独确认）；`:88`（部分成功/中断：逐项原操作结果，不是文件系统事务，已写入项保留，不回滚，不整批重做）；`DESIGN-DELTA.md:308-310`。
- **实现位置**：`packages/engine/src/directory-apply.ts:281-289`（应用前重算预览，`refreshed.revision !== stored.revision` → 整批 `STALE_TARGET`，一项都不写）；`:346-360`（异常时 `#rollback` 已写入项）；`:1391-1395`（projectionFor：unknown>0 → unknown_receipt；applied>0&&blocked=0 → delivered；否则 blocked）；UI `DeliveryApplyPreview.tsx:218-238`（只有一个“确认应用”，失败整单报错）。
- **差异**：设计是“逐项阻塞并继续其余项、不整批重做、不回滚”；实现是“发现整体漂移就整批拒绝”和“异常时回滚已写入”。虽然更保守，但与设计的逐项结果语义、任务“尚未交付”的呈现不同。
- **原因**：直接原因：服务把“预览后目录变化”当整批前置失败（C6 语义不同）。根本原因是设计意图未被落实到 apply 逐项事务模型（实现选择 CAS 整批 + 回滚）。
- **影响**：用户处理过的冲突在漂移后全部作废重来；部分成功场景只能靠“某些项 blocked”间接出现，中断/回滚场景没有逐项结果表。
- **建议**：按设计把“确认后目录变化”落到逐项 blocked 并继续其余项；中断时保留已写入并出逐项结果；回滚仅在可证明无副作用且产品明确时使用，并明确文案。
- **验证**：静态 + 需真实服务（目录写）
- **关联状态**：`td05-drift`、`td05-partial`

### DEL-23: 非 Git 应用不是设计要求的全宽视图（三来源图例/面包屑/返回任务缺失）
- **严重度**：P2
- **维度**：结构 / R
- **类别**：结构 / 导航
- **设计依据**：`sources/delivery/STATES.md:79`（td05-overview：任务交付面板展开为全宽视图（画布隐藏），面包屑「任务列表 / 月报改为按自然月汇总 / 应用到原项目」，「返回任务」回到来时状态；顶部固定三来源图例：基线｜任务副本｜当前原目录；基线范围/排除项/未复制资源在披露里）；`DESIGN-DELTA.md:299-303`（宿主容器：画布区让位、外壳沿用任务页页头与情况条、不设一级菜单）。
- **实现位置**：`TaskDeliveryPanel.tsx:714`（`!projectGit ? <DeliveryApplyPreview delivery={delivery}/>` 内嵌在交付面板体内）；`DeliveryApplyPreview.tsx:135-258`（仅一个 section，无面包屑/三来源图例/返回任务）；`delivery.css:6-14`（面板固定 `var(--drawer-md)` 480）。
- **差异**：非 Git 应用视图仍在 480 右侧面板内滚动，不展开全宽、不隐藏画布、没有三来源图例与“返回任务”上下文。设计的“唯一新增交互视图”没有被实现成视图。
- **原因**：直接原因：把 TD05 当作交付面板的一个子区块实现（C4/C5）。
- **影响**：非 Git 用户在窄面板里处理 8 个文件与冲突，比对困难；返回/上下文语义缺失。
- **建议**：按设计在交付面板内提供“全宽查看”模式（路由参数或内嵌全宽层），带面包屑、三来源图例、返回任务。
- **验证**：静态 + 需GUI（布局）
- **关联状态**：`td05-overview`、`td05-preview`、`td05-conflicts`

### DEL-24: 非 Git 读错分类与“已保留/未写入”说明缺失
- **严重度**：P2
- **维度**：S / T / D
- **类别**：状态 / 文案
- **设计依据**：`sources/delivery/STATES.md:91`（td05-read-error：权限不足/路径不可用/读取超时（可切换示例原因），明确没有写入删除移动任何文件，候选变更、选择与独立副本都保留，左侧仍可看“基线→任务副本”；只提供「重新读取」；确认应用不可用）。
- **实现位置**：`DeliveryApplyPreview.tsx:83-92`（preview 失败仅显示 `isServiceUnavailable ? '服务未连接，无法生成预览。' : errorMessage(error)`）；`:168-238`（失败时原预览仍渲染，确认按钮可能仍可用/需用户自行判断）；无“未写入任何文件/保留”确认文案。
- **差异**：没有按权限/路径/超时分类原因，没有“明确没有写入、删除或移动任何文件”和“候选/选择/副本保留”，也没有“只有重新读取”的动作收敛。
- **原因**：直接原因：错误分支未做类型化展示（C2/C3）。根本原因：目录适配错误码/分类未映射到设计原因（C1 部分）。
- **影响**：读错时用户会担心原目录是否被改过，也可能误以为预览仍可确认。
- **建议**：按错误类型渲染设计文案；确认应用在预览失效/读错时禁用；保留“基线→任务副本”只读视图与重新读取。
- **验证**：静态 + 需真实服务（目录错误）
- **关联状态**：`td05-read-error`

### DEL-25: 非 Git 结果标签英文原文、缺逐项“核对原操作”与“未交付/保留”汇总
- **严重度**：P3
- **维度**：T / A
- **类别**：文案 / 交互
- **设计依据**：`sources/delivery/STATES.md:88-90`（部分效果：逐项原操作结果表——已应用/被阻塞/待核实/未执行；待核实项只能「核对原操作」；已应用：逐项回执、真实验证事实、保留当前原文件 2 项、留在独立副本项、独立副本不自动清理）。
- **实现位置**：`DeliveryApplyPreview.tsx:241-258`（结果徽标直接显示 `item.result` 原文 applied/blocked/unknown/not_executed；`items` 仅 fileId/path/result/message，见 `models.ts:922-937` 的 DirectoryApplyResult）；`:248-253`（unknown 只给整单“读取回执”，没有逐项核对按钮）；`:241-258`（无“保留当前原文件/留副本”汇总）。
- **差异**：结果表能看逐项状态（英文原文），但缺中文标签、缺逐项“核对原操作”动作、缺“保留 N 项/留副本项/不自动清理”的汇总与验证事实。
- **原因**：直接原因：结果渲染未做中文映射与动作补齐（C3/C4）。
- **影响**：结果表可读性差，待核实项无法按设计逐项收敛。
- **建议**：加 CHECK/result 中文映射；unknown 项给逐项“核对原操作”；结果区补保留/留副本/不自动清理汇总。
- **验证**：静态
- **关联状态**：`td05-partial`、`td05-unknown`、`td05-applied`

### DEL-26: TD06 工作区详情抽屉与清理入口在任务画布缺失（TD06 8 状态不可达）
- **严重度**：P1
- **维度**：结构 / A / D
- **类别**：结构 / 交互
- **设计依据**：`sources/delivery/STATES.md:97-104`（TD06 全部 8 状态挂在 task.html 右侧 520 抽屉 / 对话框）；`DESIGN-DELTA.md:337-355`（抽屉字段、入口与返回、清理预览/未交付/阻塞/部分/已清理；关闭/取消任务提示文件保留）。
- **实现位置**：任务画布无工作区详情/清理入口（`TaskCanvasPage.tsx:334-365,409-464`；同 07 P13-12）；工作区信息仅 `TaskDeliveryPanel.tsx:538-551` 与 `ExecutionPanel.tsx:316-331`；清理 UI 在需求画布 `WorkspacePanel.tsx:317-357,452-570`；服务读模型/命令已具备（`models.ts:850-871,985-995`；`http.ts:659-680`）。
- **差异**：TD06 的“工作区详情（Git/非 Git）→ 清理预览/未交付知情/阻塞/部分清理/已清理”整条链路不在任务画布，用户必须回需求画布工作区页签才能清理；抽屉字段（公开身份/子工作区/创建/最后检查/活动写入/未交付/未决请求/已交付凭证/容量未知/在文件管理器显示）没有承载视图。
- **原因**：直接原因：任务画布未实现工作区详情抽屉（C4）。同 07 P13-12 同根因；本区域为该设计的归属区域，故在此记为 P1。
- **影响**：交付/取消后无法在任务画布收尾（查看保留对象与清理条件、定向清理）；TD06 的 8 个设计状态全部不可达。
- **建议**：任务画布页头加工作区 chip → 520 抽屉；抽屉内承接清理预览/确认/阻塞/部分核对/已清理；关闭/取消对话框加“文件保留，可稍后交付/查看”与入口。
- **验证**：静态 + 需真实服务（清理）
- **关联状态**：`td06-detail-git`、`td06-detail-nongit`、`td06-close-retain`、`td06-cleanup-preview`、`td06-cleanup-undelivered`、`td06-cleanup-blocked`、`td06-cleanup-partial`、`td06-cleaned`

### DEL-27: TD06 清理阻塞无定位、部分清理无逐步骤结果、已清理无路径删除标记
- **严重度**：P2
- **维度**：A / S / T
- **类别**：交互 / 数据契约
- **设计依据**：`sources/delivery/STATES.md:102`（清理受阻：每条原因都能跳到对应位置（定位节点、核对原推送、查看恢复记录）；按钮禁用并说明原因；不排队、不自动清理）；`:103`（部分清理/失联：按原步骤显示已核实/回执未知/未执行，唯一动作“核对原清理”）；`:104`（已清理：路径加删除线并标“已删除”；交付回执/提交/远端分支/MR 仍可读；变更页签用回执清单，不伪造本地文件仍在）。
- **实现位置**：`WorkspacePanel.tsx:478-501`（blockers 列表 label+ref 文本，无跳转按钮）；`:360-390`（只按整单原请求号核对）；`:288-294`（已清理横幅）；契约 `models.ts:985-995`（WorkspaceCleanupPreview 无逐步骤清理结果）；`workspace.ts:45-90`（重启同步把 cleaning→partial、步骤置 failed，但清理步骤结果没有逐项读模型）。
- **差异**：阻塞原因只有文本；部分清理只有整单核对与投影状态，没有设计“已核实/回执未知/未执行”的逐步骤清单；已清理后没有路径删除线与“本地文件不可用”的说明。
- **原因**：直接原因：清理 UI 只消费 preview 的 blockers 列表与单条回执（C4）。根本原因：没有清理逐步骤结果读模型（C1）。
- **影响**：清理受阻时用户不知道去哪里解除；部分清理无法核对到步骤；已清理后可能误以为本地文件仍在。
- **建议**：blockers 增加 ref 类型与跳转（node/audit/operations）；清理结果建模为逐步骤状态；已清理视图标注路径已删除、保留回执可读。
- **验证**：静态 + 需真实服务（清理）
- **关联状态**：`td06-cleanup-blocked`、`td06-cleanup-partial`、`td06-cleaned`

### DEL-28: MR 无来源任务/交付事实绑定，缺 closed-later 独立事实
- **严重度**：P2
- **维度**：S / D
- **类别**：数据契约 / 状态
- **设计依据**：`sources/delivery/STATES.md:110-112`（MR 详情：来源任务 chip 可返回任务；两条独立事实「该任务已交付（10-15 16:20）」来自任务交付记录、「MR 未合并」来自 GitLab 只读；MR 列表为任务交付创建的 MR 显示「来源任务 T-2041 · 已交付」chip，其他显示“来源任务 —”；MR 后来关闭不重开任务、不改写交付历史）。
- **实现位置**：`packages/shared/src/domain/models.ts:1114-1128`（GitMergeRequest：iid/title/sourceBranch/targetBranch/state/author/updatedAt/webUrl/pipeline/approvals，无 taskId/deliveryId/deliveredAt）；`MergeRequestsPanel.tsx:79-113`（列表无来源任务列）、`:115-185`（详情无来源任务 chip/交付事实块）；`packages/engine/src/delivery.ts:199-246`（创建 MR 时只存 mrIid/mrWebUrl 于 delivery step，未回写 MR↔任务绑定）。
- **差异**：MR 列表/详情没有“来源任务/已交付”列与 chip，也无法展示“任务已交付”与“MR 未合并/已关闭”两条独立事实；closed-later 只能看到 GitLab 状态为 closed，无法对照任务交付历史说明“不重开、不改写”。
- **原因**：直接原因：MR 视图未组装任务来源与交付事实（C4）。根本原因：契约没有 MR↔任务/交付绑定字段（C1）。
- **影响**：MR 与任务的来源关系不可见，交付历史与 GitLab 事实无法分列展示；用户可能把 MR closed 误读为任务状态变化。
- **建议**：MR 读模型增 `taskRef{id,title,deliveredAt,deliveryProjection}`（候选字段，按 API-DESIGN-CANDIDATE §5 候选标记）；列表/详情按设计渲染来源任务 chip 与两条独立事实。
- **验证**：静态 + 需真实服务（GitLab MR 读）
- **关联状态**：`td07-mr-detail`、`td07-mr-list`、`td07-mr-closed-later`

## 已核对一致

- 交付不新增一级页面，以任务画布右侧 480 面板承载（`delivery.css:6-14`；设计 `DESIGN-DELTA.md:39-43`“不新增一级页面”；同 07 已核对）。
- 完成目标三选一（Git）+ 非 Git 的应用目标，卡片写清依赖链，选择只记录目标不自动执行；保存后才成为“所选目标与范围”（`DeliveryGoalPicker.tsx:15-40`、`TaskDeliveryPanel.tsx:646-690`、`delivery.ts:51-90`；设计 `DESIGN-DELTA.md:256-265`）。
- 每个副作用独立确认：提交/推送/创建 MR 各自对话框，推送/创建 MR 不自动连锁（`TaskDeliveryPanel.tsx:746-922`；设计 `DESIGN-DELTA.md:258-265`“不是自动授权三步”）。
- 推送语义只新建远端分支、拒绝非 FF、不提供强制推送；认证失败有服务错误分类（`git-cli.ts:437-450`；设计 `DESIGN-DELTA.md:270-274`）。缺的是“先预览”环节（DEL-15），不是强推。
- UNKNOWN 只按原 requestKey 核对、不重发：回执横幅 + `operations.by-key` 查询 + hasUnknown 门禁（`git-shared.tsx:528-620`、`TaskDeliveryPanel.tsx:345-380,592-601`、`delivery.ts:319-347`；设计 `API-DESIGN-CANDIDATE.md:322-331`）。
- 交付投影由服务计算并按徽标呈现，面板不自造“已交付”（`delivery.ts` 各完成点写 projection；`TaskDeliveryPanel.tsx:526-537`；设计 `API-DESIGN-CANDIDATE.md:165-176`）。
- 整文件选择、选中 A/M/D 统计、未纳入/忽略项只读列出且不能在本页加入（`DeliveryFileSelect.tsx:44-160`；设计 `DESIGN-DELTA.md:232-238`）。
- 提交为 whole-file literal pathspec、只提交确认文件、未确认的暂存内容保留（E42 真实 Git 18/18 证据；`packages/engine/src/delivery.ts:83-143`）；本地提交目标完成后由服务读回置“任务已交付”（`delivery.ts:117-135`）。
- 验证未通过时可交付但需知情确认，知情部分不改变失败事实（`TaskDeliveryPanel.tsx:562-570,811-815`；设计 `STATES.md:35`）。
- 非 Git 三方应用服务端提供 preview/逐项 check/四种 resolution/冻结 revision/过期校验/未交付知情报文/备份落盘/逐项结果/UNKNOWN 投影（`directory-apply.ts:226-433,1391-1402`；`http.ts:659-680` 与 `directory-apply-plugin.ts:22-33`；设计 `DESIGN-DELTA.md:296-335`）；缺的是 UI 差异视图与确认层（DEL-20）。
- 清理预览包含删除对象/保留对象/未交付数量与原因/知情勾选/blockers/过期/工作区状态、未知回执按原请求核对（`WorkspacePanel.tsx:100-160,317-357,452-570`；`models.ts:985-995`；设计 `DESIGN-DELTA.md:337-367`）。
- 交付面板/文件选择/骨架/错误/空态均为真实服务数据，无样例数据或假成功；无能力/无记录时诚实显示“还不能交付/没有文件变更/服务未返回”（`TaskDeliveryPanel.tsx:417-493`、`DeliveryFileSelect.tsx:60-81`）。
- 任务画布侧渲染的交付面板符合“点交付端点打开右侧面板、默认隐藏”的宿主形态（`TaskCanvasPage.tsx:672-678`；同 07 已核对，画布情况条/端点本身仍缺）。

## 需 GUI / 运行验证

1. **四主题 + 1440/1280/1024**：480 交付面板与各对话框（提交/推送/MR/合并）的宽度、滚动、焦点陷阱与关闭还原；合并对话框按钮 danger 的视觉（DEL-07/19）。
2. **真实 Git 链路**：commit drift（服务 STALE_TARGET）、hook 拒绝（脱敏输出与字段旁提示）、push-exists（远端同名）、push-auth（认证/用途不足）、push-unknown（断网/超时）在 GUI 的实际文案与可恢复动作（DEL-15/17/18）。
3. **真实 GitLab**：MR 创建/已有同源 MR 的实际返回、MR 列表/详情状态读取、MR closed-later 的独立事实展示（DEL-14/28）。
4. **真实目录应用**：非 Git 三方检查（六类冲突）、take_task 二次确认、manual_then_recheck、drift 逐项阻塞、partial/unknown 的逐项目标目录核对与备份证据（DEL-20/21/22/25）。
5. **真实工作区准备**：空仓库/同名分支/权限不足/基线前移/部分创建/回执未知的实际错误码与界面分支（DEL-01/04/05）。
6. **清理链路**：阻塞项定位、未交付知情、部分清理核对、已清理后回执仍可读（DEL-26/27）。
7. **键盘与焦点**：所有对话框的 Tab 顺序、Esc、焦点归还（Modal 组件行为）、文件树/下拉的键盘可达（静态无法确认）。
8. **数据诚实性**：无 GitLab/无目录适配时面板是否正确显示“未配置/能力不可用”而不是假成功（`MergeRequestsPanel.tsx:43-60` 有未配置空态；交付面板的 GitLab 未配置分支需 GUI）。
9. **交付与任务状态联动**：真实 commit/push/MR/merge/apply 完成后任务列表徽标、情况条与交付投影是否一致（跨 07/15 区域）。
10. **合并违规确认**：在真实 Git 仓库上执行“合并到目标分支”，确认其副作用与结算语义，供产品决定移除或更新设计（DEL-07）。

## 未覆盖 / 说明

- **区域边界**：TD01 在需求画布「工作区」页签的页面定位/返回/入口由区域 06 审计（本报告只审计准备区实现内容）；TD02 任务画布侧的情况条/交付端点/工作区 chip 由 07 记录（本报告只审计交付面板）；TD06 抽屉缺失与 07 P13-12 同根因，本区域为设计归属方，已在 DEL-26 记录并注明交叉引用；TD07 MR 页的通用列表/详情交互细节与 14-git 区域有交叠，本报告只记录任务来源与交付事实缺口。
- **未运行**：未启动 GUI、未跑构建/测试、未接真实 Git/GitLab/非 Git 目录服务；所有真实写操作、hook 脱敏、认证失败、远端 UNKNOWN、MR 去重、三方 diff、备份证据均未实测，已列入「需 GUI / 运行验证」。
- **不开放/候选边界（C9，不是实现缺陷）**：`td01-combined`（备选单按钮，二选一，实现选两步方案）；`td04-goal-change`（设计标“API 未冻结”）；`td02-parallel` 子隔离与汇合（PE28 后续分期）；`td05` 的“一键覆盖整个目录/自动清理/定时清理/再试一次”设计明确不做——实现均未提供。
- **需产品决策**：`DEL-07` 产品内合并是设计明令禁止但实现已落地并有真实回归证据（`docs/verification/2026-10-20-delivery-goals-selected-index.md` 提到“原有真实 merge/CAS 回归继续通过”）的能力，属于设计/实现范围冲突，不是单纯前端修复；需 Lead/产品决定“移除能力”或“更新设计权威”。
- **C10 文档口径（报给 Lead 汇总，不占主清单）**：
  - `.tmp/design-audit/MAPPING.md:118` 把 70 状态压缩成“TD01 12 · TD02 19 · TD03 26 · TD04 13”，与 `sources/delivery/STATES.md:7` 的 12/11/6/17/13/8/3 不一致；本报告按原始状态 ID 分组，汇总时请留意口径。
  - `docs/review/design-parity.md:54-56` 称 delivery/apply “基本对齐：文件选择、目标、应用预览、分步确认均有”，与本次逐态核对不符（TD03 整块缺失、TD05 无三方 diff/无应用确认、TD01 异常家族缺失）；该文档自述为历史审查基线，不应作为当前验收结论。
  - `docs/review/design-parity-acceptance-2026-10-20.md:152-221` 的 70 条 delivery 行统一写“交付主流程已有；此状态副作用/回执/文件结果未验证”，属过度声称，逐态结论以本报告为准。
  - `docs/review/2026-10-19-audit.md` 未单列交付补充稿，无旧结论需要推翻。
- **未审计**：交付面板的“查看已交付/重读”刷新细节、`delivery.remaining` 未选文件明细的准确性、`selectDelivery` 保存后自动投影到任务列表的联动（跨 07 区域）、Git 修复域既有 merge（`fix.ts`）与交付 merge 的界线（交付 merge 见 DEL-07，修复域不在本区域）；`td05` 的“验证与成果”页签（TD03 归属）未单独核对。
