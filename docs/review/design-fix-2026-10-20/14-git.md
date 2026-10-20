# Git 仓库页设计一致性修复处置（2026-10-20）

> 任务：task-6（GIT-01..06 P1 + 余下 P2）。权威审计：`docs/review/design-audit-2026-10-20/14-git.md`（只读）。
> 基线：`main@3f6f9b2`；分支 `fix/design-audit-2026-10-20`（未切换 / 未 commit / 未 push）。
> 设计稿 `opencode-workflow-design-showcase/sources/git/`、`originals/git/` 只读；未执行任何真实远端写操作。
> 产品决策（与 DEL-07 一致，Lead + delivery-parity 确认）：**产品内不提供可执行直接合并**；合并本身在 GitLab 完成，Git 页只保留 MR 创建/查看与只读事实。
> 证据行号为当前工作区代码行号（并行成员改动可能使行号漂移，以函数名为准）。

## 状态总览

| ID | 严重度 | 状态 | 一句话 |
|---|---|---|---|
| GIT-01 | P1 | 已修复 | 中栏提交图谱：按真实父提交关系计算泳道/合流点，SVG 渲染，合并提交空心双圈 |
| GIT-02 | P1 | 已修复 | diff 展开未改动上下文（20 行/全部）+ 语法着色 + 成对行内高亮 + 读失败保留已加载内容 |
| GIT-03 | P1 | 已修复（按产品决策） | ③ 选择合并方式：MR 为唯一可执行方式；直接合并卡保留但禁用并写明「产品内合并未提供」；移除 ④ 本地可执行合并 |
| GIT-04 | P1 | 已修复 | 审查历史下拉（只读回看）+ 按严重度/文件分组 + 「建议修改」patch 展示与复制 |
| GIT-05 | P1 | 已修复（任务详情入口按 C1 诚实禁用） | 三阶段条/已用时间/停止确认/失败保留最后真实阶段/unknown 核对原操作 |
| GIT-06 | P1 | 已修复（远端提交列表/合并冲突按 C1+产品决策说明） | 写失败按 ErrorCode 给结构卡与出路：获取远端更新、去设置验证、打开已有 MR、修改后重试提交 |
| GIT-07 | P2 | 部分 | 修复阶段条已加；实时记录/「重新修复」缺契约字段（C1） |
| GIT-08 | P2 | 部分 | 无改动可直接清理（无二次确认）已做；校验失败输出与逐条 AI 判断缺契约字段（C1） |
| GIT-09 | P2 | 已修复 | diff 行下问题卡（接受/忽略/回列表）+ 范围内行色条 + 「问题 N/M」导航 |
| GIT-10 | P2 | 延后 | 分支/MR 移右栏属结构性布局重排，需 GUI 复核；本轮保留中栏并记录 |
| GIT-11 | P2 | 延后 | 二进制大小/重命名相似度需补 `FileChange` 契约（不在 task-6 写范围） |
| GIT-12 | P2 | 延后 | MR 概要/提交列表需补 `GitMergeRequest` 契约（不在 task-6 写范围） |
| GIT-13 | P2 | 延后 | 分支关联 MR 需补 `GitBranch` 契约（不在 task-6 写范围） |
| GIT-14 | P2 | 已修复 | GitLab 未配置时获取远端禁用+原因；远端分支整组不可用说明 |
| GIT-15 | P2 | 已修复 | Git 能力未接入 = unknown 虚线中性样式，不再红色错误 |
| GIT-16 | P2 | 延后 | 1280 图标左栏/1024 提交抽屉需 GUI 专项 |
| GIT-17 | P2 | 已修复 | diff 读失败保留上次成功内容并标读取时间，只影响失败块 |
| GIT-18 | P2 | 已修复 | 无问题时维度逐项「未报告问题」+ 修复页签禁用并写原因 |
| GIT-19 | P2 | 已修复 | 「AI 审查此提交」直接打开审查设置抽屉；提交弹窗 split 式「提交到分支 / 提交并推送」 |
| GIT-20 | P2 | 已修复 | 切回统一视图不再退出全宽；全宽顶部提交身份条 + Esc/退出全宽 |
| GIT-21 | P3 | 已修复 | 页头补「N 个未提交改动（只读）」；获取失败时领先/落后标「上次已知值」 |
| GIT-22 | P3 | 已修复 | 不可用卡片保留禁用「进入」+原因，另放「查看项目」；不可用视图 mono 显示项目路径 |
| GIT-23 | P3 | 已修复 | 空仓库补 GitLab 未配置/已连接的提示与去处 |
| GIT-24 | P3 | 记录（C9） | 评审人/MR 模板为设计 P3 候选，UI 显示「暂未接通」；「已修复」徽标无数据来源，未伪造 |
| GIT-25 | P3 | 部分 | 步骤名/按钮名/合并文案已统一；仍有少量描述性文案与设计逐字不同，列在下方 |
| GIT-26 | P3 | 报 Lead | 旧文档口径由 Lead 统一更新（本任务不改 `docs/design-coverage.md` 等） |

## 逐条证据与说明

### GIT-01 中栏提交图谱（已修复）
- **实现**：`apps/web/src/pages/git/commit-graph.tsx:71`（`layoutCommitGraph`：按时间倒序的真实 `parents` 分配泳道、合流点、合并提交标记）、`:149`（`CommitGraphCell`：SVG 泳道/曲线/圆点，合并提交空心双圈，HEAD 环）、`:228`（`CommitGraphPass`：日期分组头处续接泳道）。
- **接入**：`apps/web/src/pages/git/CommitList.tsx:69`（对已加载提交布局）、`:151`（行内渲染）、`:7`（导入）；`git.css` 的 `.commit-graph*` 规则；图谱宽度按泳道数自适应，≤6 列封顶（超出收进最右列，只影响画法不隐藏提交）。
- **数据诚实**：图谱完全由服务返回的 `GitCommitSummary.parents` 派生，不注入任何历史；加载更早提交时已有行泳道不变（连续追加）。关键词筛选时按设计不画图谱、提交平铺。列表底部注明「泳道按已加载提交的真实父提交关系计算；不伪造分支历史」。
- **契约取舍**：审计建议的备选「前端用 parents+排序计算并注明仅示意」被采用——因为分页连续性由已加载列表天然保证，服务端按页计算反而会在页边界断线；`packages/git` 的 `log()` 仍返回真实 parents（未改契约）。
- **验证**：静态 + `npm run typecheck`；渲染观感需 GUI（1440/1280、四主题）见「待验证」。

### GIT-02 diff 展开上下文 / 语法着色 / 行内高亮（已修复）
- **展开未改动上下文**：
  - `packages/git/src/config.ts` 新增 `defaultDiffContextLines: 3` / `maxDiffContextLines: 2_000`。
  - `packages/git/src/repository.ts:92`（`DiffHunksRequest.contextLines`）、`:607`（校验 1..2000）、`:636`（`--unified=<n>`，真实 Git CLI 输出）。
  - `packages/server/src/http.ts:1150-1175`：`GET /api/git/repos/:projectId/diff` 新增 `contextLines` 查询参数；>3 时用 `@agent-workflow/git` 的 `GitRepository.diffHunks` 读取同一文件范围的更大 unified 半径（默认 -U3 仍走引擎 Git 端口），不伪造上下文行。
  - `apps/web/src/api/git.ts`：`GitDiffOptions.contextLines` 透传。
  - `apps/web/src/pages/git/DiffViewer.tsx`：hunk 之间/文件开头渲染「未改动 N 行未显示」折叠条，按钮「展开 20 行 / 全部 N 行」；展开后重新读取同一 diff（状态「已展开上下文 +N 行 / 恢复默认上下文」）；修复副本 diff 不支持展开时如实说明（服务读口未开放）。
- **语法着色**：新增 `apps/web/src/pages/git/syntax.ts:176`（`highlightLine`，按扩展名分 TS/JS/PY/GO/JAVA/RS/SH/SQL/JSON/CSS/HTML/MD/YAML/TOML… 分词；块注释可跨行；token 文本拼起来与原始行逐字符一致）。`DiffViewer` 对每个 hunk 行生成 token 映射，统一/并排两个视图共用；颜色全部由 `git.css` 的 `.tok-*` 用主题令牌（`--wait/--ok/--warn/--faint/--done/--accent-ink/--role-*`）定义。
- **成对行内高亮**：新增 `apps/web/src/pages/git/intra-line.ts:57`（`buildIntraLineRanges`：相邻 del/add 块逐行配对，公共前后缀之外标 `<mark class="intra">`；完全不同的行不标，避免整行噪声；单行 >600 字符跳过）。
- **读失败保留已加载内容（GIT-17）**：`DiffViewer` 查询使用 `keepPreviousData`；失败时顶部保留错误条 +「读取于 {时间}」说明，下方仍是上次成功内容。
- **测试**：`packages/git/src/repository.test.ts` 新增「expands unchanged context with a larger unified radius (GIT-02) and validates the request」：`-U3` vs 10 vs 25 行上下文递增、`oldStart` 前移、展开后包含真实文件行 `line 1`；`contextLines: 0` / `2001` 返回 `VALIDATION_FAILED`。

### GIT-03「选择合并方式（MR / 直接合并）」与 DEL-07 口径（已修复，产品决策）
- **产品决策**：与 delivery-parity 确认（Lead 口径）——产品内不提供可执行直接合并；口径文案「合并在 GitLab 中进行，产品内合并未提供」。
- **UI**：`apps/web/src/pages/git/FixPanel.tsx:848` 步骤③改为「选择合并方式（创建合并请求 / 直接合并）」单选卡：MR 卡为推荐且唯一可执行（AI 草稿标题/说明 + 目标分支），直接合并卡禁用并写明「合并在 GitLab 中进行，产品内合并未提供」；删除原「④ 合并回基线分支」步骤卡、本地 no-ff+CAS 合并弹窗与 `mergeFix` 调用（`:921` 起为结构化失败卡）。MR 创建成功后展示源/目标/评审人（暂未接通）/流水线（未读取，不推定成功）/「合并请在 GitLab 完成」只读事实。
- **契约/服务残余**：`apps/web/src/api/git.ts` 删除 `mergeDelivery`/`DeliveryMergeInput` 与 `DeliveryMergeRequest` import；`apps/web/src/pages/git/git-shared.tsx` 删除已无引用的 `DELIVERY_STEP_LABEL`/`DELIVERY_STEP_ORDER`（含 'merge'）。packages/engine 的 `FixService.merge`（`fix.merge` 命令）按「P3 候选能力」保留但界面无入口；`FixRun.steps` 仍可能出现历史 `merge` 步骤（枚举 `DeliveryStep.MERGE` 保留注释：仅 legacy fix 域）。
- **未提供项**：保护分支/当前检出/可快进前提的服务端投影（`actions.merge` 前提原因）属于直接合并能力本身；产品不提供直接合并后该前提组不可达，按 C9 记录，不伪造禁用原因。

### GIT-04 审查历史 / 问题分组 / 建议修改（已修复）
- **历史列表**：服务端读口已存在，`packages/server/src/http.ts:1078` 起扩展 `GET /api/git/repos/:projectId/commits/:sha/reviews` 返回真实 `dimensions` + `compareLabel`；`apps/web/src/api/git.ts` 新增 `fetchReviewHistory` 与 queryKey；`apps/web/src/pages/git/ReviewPanel.tsx:368` 历史下拉（第 N 次 / 状态 / 时间 /「最新」标记），选中更早记录时整页按「历史审查 · 只读」展示，问题状态写入与「选入修复」禁用并写原因。
- **问题分组**：`ReviewPanel.tsx` 新增 `SegmentedControl`「默认顺序 / 按严重度 / 按文件」与分组标题（`grouped` useMemo）。
- **建议修改**：`packages/engine/src/review.ts:118` 在严格 JSON schema 中新增可选 `suggestion`（unified patch 文本）；`:773`/`:786` `normalizeSuggestion` 校验长度并绑定 `appliesTo = 审查提交 SHA`，随 finding 持久化；服务器新增 `GET /api/git/repos/:projectId/reviews/:reviewRunId/suggestions`（`packages/server/src/http.ts:1088`）只读投影；前端 `ReviewPanel` 在问题卡内 `<details>` 展示 patch + 复制按钮，明示「只读，不自动应用」。
- **测试**：`packages/engine/src/review.test.ts` 首个用例的模型输出带 `suggestion`，断言持久化字段 `{format:'unified_patch', patch, appliesTo: 提交 SHA}`。

### GIT-05 审查进行中 / 失败 / 未知（已修复；任务详情入口按 C1 诚实禁用）
- **阶段条 + 已用时间**：`ReviewPanel.tsx:58`（三阶段 reading_diff → analyzing → summarizing）、阶段状态来自服务 `stage`，不显示假百分比；运行中/已结束显示已用时间（秒级刷新，仅运行中轮询）。
- **停止确认**：停止审查改为确认弹窗（说明「停止请求不等于已停止」、阶段、已用时间），确认后才发 `review.stop`。
- **失败卡**：`ReviewPanel.tsx` 失败卡显示「停在阶段：{服务 stage}」+ `receipt.error` 原因 + 「重新审查」；`packages/engine/src/review.ts` 的 `#fail` 改为**保留失败前最后一个真实阶段**（原先覆盖为 'failed'，导致界面无法回答「停在哪个阶段」），`review.test.ts` 断言 invalid JSON 失败时 `stage === 'summarizing'`；unknown 才写 'unknown'。
- **未知核对**：`review.state === 'unknown'` 时提供「核对原操作」按钮，使用 `review.receipt.requestKey` 走 `operations.by-key`，不重发。
- **任务详情入口（C1 诚实降级）**：ReviewRun 只有 `executionId`，服务没有把审查登记为任务（无 taskId），「在任务中查看详情」按钮禁用并写原因「审查以只读会话运行，服务没有把它登记为任务（无 taskId）；界面不伪造任务详情入口」。
- **未实现**：失败卡「已读取内容」无契约字段（C1），未伪造。

### GIT-06 写操作失败态出路（已修复；合并冲突按产品决策 N/A）
- **结构化失败卡**：`apps/web/src/pages/git/FixPanel.tsx:142`（`FixFailureCard`，按 `ApiClientError.code` 分支；读取 `details.output` 原样展示）：
  - `PUSH_REJECTED_NON_FF` / `REMOTE_BRANCH_EXISTS`：标题 +「不提供强制推送」+「获取远端更新」按钮（真实 `git.fetch`，成功后有回执并失效 repo/branches 查询）+「在 GitLab 打开」；远端多出的提交列表服务未提供（C1），界面如实说明并显示获取后真实的 ahead/behind。
  - `GITLAB_AUTH_FAILED`：引导「去设置验证连接」（`/settings`）+ 凭据只在服务端说明，回来用原按钮重试（新 requestKey）。
  - `MR_ALREADY_EXISTS`：后端创建前先核对（见下）并在错误 `details` 带 `iid`/`webUrl`，UI 给「打开已有合并请求 !N」，不重复创建。
  - `HOOK_REJECTED`：展示 hook 输出 +「修改后重试提交」（打开提交弹窗，新 requestKey）+ 明示不提供跳过 hook。
  - `STALE_TARGET` / `OPERATION_IN_PROGRESS`：重新读取；`RECEIPT_UNKNOWN` 走既有「核对原操作」（不重发）。
- **已有 MR 先核对**：`packages/git/src/remote.ts:159`（`existingOpenMergeRequest`）、`:176`（`alreadyExistsError` 带 iid/webUrl）、`:291`/`:449`（GitHub/GitLab 创建前 GET 同源→目标打开 MR，命中直接抛 `MR_ALREADY_EXISTS`，**不发送 POST**；核对失败不阻塞创建，让真实错误暴露）。`packages/git/src/remote.test.ts` 新增用例断言命中已有 MR 时不发 POST 且 `details.iid/webUrl` 正确；原 create/duplicate 用例已适配预检查。
- **合并冲突（g56）**：设计中的直接合并冲突态随「产品内不提供直接合并」不可达（C9）；卡内保留 `MERGE_CONFLICT` 的只读文案（目标分支未被改动、建议改用 MR），不伪造冲突文件清单（服务未提供 `conflictPaths` 详情）。

### GIT-07 修复进行中/失败阶段条（部分）
- 已加：`FixPanel.tsx` 修复四阶段条（准备修复分支 → 修改代码 → 校验 → 完成），状态只来自 `FixRun.state`；修复失败时明示「服务没有返回失败前阶段，界面不推测」。
- 未做：「实时记录摘要」与「重新修复（新开一次）」需要 `FixRun` 阶段/日志投影与重开命令（C1），延后并记录。

### GIT-08 校验失败/无改动的收尾细节（部分）
- 已做：`fix.state === 'no_changes'` 时「清理修复分支（无需二次确认）」直接提交 discard（设计 g44 明确不需要二次确认）；「校验失败仍需勾选『我已了解校验未通过』才可提交」保持。
- 延后：校验失败输出、无改动逐条 AI 判断需要 `verification` 输出文本/校验日志读取入口（契约只有计数/摘要/`logArtifactId`，C1；Git 页无 artifact 阅读器）。

### GIT-09 diff 内审查问题定位（已修复）
- `apps/web/src/pages/git/DiffViewer.tsx`：行号旁问题圆点改为「点击在行下展开问题卡」，卡内可直接「接受 / 忽略 / 收起 / 回到问题列表」；`findingForLine` 命中行加左侧严重度色条（`.diff-line.has-finding.sev-*`）；工具栏新增「问题 N / M」上下跳转（`finding-nav`）。
- 数据/写入口：`CommitDetail.tsx` 新增 `updateFinding` mutation（与审查页签同一 `review.finding.update`），历史审查只读时不传更新回调；失败走页内错误条。
- 样式：`git.css` 的 `.diff-finding-card` / `.finding-nav` / `.has-finding`（全部主题令牌）。

### GIT-10 分支/MR 布局（延后）
- 设计为「左栏切换、右栏整表/详情、中栏保持提交列表」；当前仍是中栏切换。重排涉及 `RepoWorkbench` 三栏结构 + 窄屏断点 + 需 GUI 复核，本轮未做，保留现状并记录为延后（结构 C4，非数据诚实问题）。

### GIT-11 大文件/二进制/重命名边界信息（延后，C1）
- `FileChange`（`packages/shared/src/domain/models.ts`，不在 task-6 写范围）缺 `similarity` 与二进制前后大小；`packages/git` 的 raw diff 已能解析 R 记录但无法投影到契约。已有：二进制「不显示差异」、重命名 old→new、权限 old→new、截断+加载全部。

### GIT-12 MR 概要/提交列表（延后，C1）
- `GitMergeRequest` 缺 `description`/`commits`（models.ts 不在写范围），GitLab adapter 读取后可投影但需先补契约。当前 MR 列表/详情已含状态、源→目标、流水线、审批、更新时间与「在 GitLab 打开」。

### GIT-13 分支关联 MR 列（延后，C1）
- `GitBranch` 缺 `mergeRequest` 字段；需先补契约与远端 join。当前分支表有保护锁、当前、upstream、相对默认分支、最后提交。

### GIT-14 GitLab 未配置时禁用远端能力（已修复）
- `RepoWorkbench.tsx`：获取远端更新按钮在 `!gitlabConfigured` 时禁用并写原因（去设置 → GitLab）；`BranchesPanel.tsx` 远端组整组标「不可用」并就地说明；`MergeRequestsPanel.tsx` 保持既有引导空态；左栏说明「GitLab 未配置：远端相关能力不可用」。

### GIT-15 Git 能力未接入不按错误渲染（已修复）
- `apps/web/src/api/git.ts`：`GitFailureKind` 增加 `capability_unavailable`（`ErrorCode.CAPABILITY_UNAVAILABLE` / `GIT_CAPABILITY_UNAVAILABLE`），不再与「服务未连接」合并；`failSafe` 文案「Git 能力尚未接入；不是错误」。
- `git-shared.tsx`：`FailureNotice` 对能力未接入使用 `unknown` 中性 tone + gitRepo 图标；`UnavailablePanel` 支持 `kindOverride` 并用 `.unavailable-panel.capability` 虚线 unknown 样式（`git.css`）。
- `RepoWorkbench.tsx` 不可用视图按 `repo.gitState === 'capability_unavailable'` 传入 override。

### GIT-16 响应式两级形态（延后，需 GUI）
- 1280 图标左栏 / 1024 提交列表抽屉未实现；当前断点为缩窄三栏 + 隐藏详情。属视觉/布局专项，需 GUI 三档×四主题验证后做，本轮未动。

### GIT-17 读取失败保留已加载内容（已修复，见 GIT-02）
- `DiffViewer` 用 `keepPreviousData`：失败时保留上次成功 hunks 并显示错误条 +「读取于 时间」，可「重新读取」；列表分页失败/分支/ MR 分块失败原本已保留。

### GIT-18 审查无问题：维度打勾与修复页签（已修复）
- `ReviewPanel.tsx`：`completed` 且 0 finding 时按维度渲染「{维度} 未报告问题 / 本次未选择」（数据来自本次审查维度 + 空结果，不推断代码质量）；`CommitDetail.tsx:111` 计算 `reviewClean`，修复页签禁用（`aria-disabled` + 原因「审查没有发现问题，修复页签不可用」）。

### GIT-19 审查入口与提交 split 形态（已修复）
- `CommitDetail.tsx:51` `openSetupRequest` 计数：主按钮「AI 审查此提交」切到审查页签并直接打开审查设置抽屉（`ReviewPanel` 监听计数 `useEffect`）。
- `FixPanel.tsx` 提交弹窗 footer 改为 split 式：主按钮「提交到 {修复分支}」（只提交）+ 次按钮「提交并推送」（提交成功后才打开推送确认，显式两次命令，不自动连锁）。

### GIT-20 全宽/并排联动与提交身份（已修复）
- `DiffViewer.tsx`：切到并排自动全宽；**切回统一不再退出全宽**（删除原主动退出逻辑）。
- `CommitDetail.tsx:209`：全宽时显示 `.diff-full-bar`（「全宽阅读」+ 可复制提交 SHA + 提交标题 + Esc/退出全宽说明 + 退出按钮）；Esc 退出逻辑保留，选中/滚动状态由组件未卸载保持。

### GIT-21 页头事实（已修复）
- `RepoWorkbench.tsx` 页头 meta 增「N 个未提交改动（只读）」Badge；获取失败时 ahead/behind 明示「获取失败 · 显示上次已知值」，并保留「上次获取 {时间}」。

### GIT-22 不可用卡片/路径展示（已修复）
- `GitOverview.tsx`：不可用卡片保留禁用「进入」按钮并给原因（not_git / path_unavailable / capability），另放「查看项目」链接。
- `RepoWorkbench.tsx`：不可用视图显示 `项目路径 <mono>{repo.displayRoot}</mono>`（路径以 mono 展示）。

### GIT-23 空仓库 GitLab 提示（已修复）
- `RepoWorkbench.tsx` 空仓库横幅补充：GitLab 已连接 →「完成首次提交后即可读取远端与合并请求」；未配置 →「到 设置 → GitLab 配置连接后才能读取」。

### GIT-24 评审人 / 「已修复」徽标（记录，C9）
- MR 弹窗与已创建 MR 事实卡显示「评审人 暂未接通（非必填）」（设计本身列 P3 候选）；「已修复」徽标没有数据来源，不伪造（`ReviewRunState` 无 fixed）。接口冻结后再补。

### GIT-25 文案细节（部分）
- 已对齐：`③ 选择合并方式（创建合并请求 / 直接合并）`、`创建合并请求`、`在 GitLab 打开`（原「在浏览器打开」）、「合并在 GitLab 中进行，产品内合并未提供」、步骤名 ① 提交修复 / ② 推送修复 / ③ 选择合并方式。
- 仍存：部分描述性长文案与设计逐字不同（如页头 lede）；不影响功能与状态，留待统一词表批次。

### GIT-26 旧文档口径（报 Lead，C10）
- `docs/design-coverage.md:171` / `docs/review/design-parity.md:107-113` 的 Git「齐全/基本对齐」口径与当前差异不符，由 Lead 统一更新，本任务未改这些文件。

## 验证

- `npm run typecheck`（全仓）：**0 错误**（Lead 收口复核一致）；Git 页 / `apps/web/src/api/git.ts` / `packages/git` / `packages/server/src/http.ts`（git 路由段） / `packages/shared/src/api/contracts.ts`（git 段） / `packages/engine/src/review.ts` 全部通过。
- `node --import tsx --test packages/git/src/*.test.ts`：**102 通过 / 0 失败**（含新增 GIT-02 展开上下文用例、GIT-06「已有原 MR 先核对、不 POST」用例）。
- `node --import tsx --test packages/engine/src/review.test.ts`：**7 通过 / 0 失败**（含 suggestion 持久化、失败保留最后阶段断言）。
- DEL-07 连带清理（Lead 协调项 1–3）：`mergeDelivery`/`DeliveryMergeInput`/`DeliveryMergeRequest` import 已从 `apps/web/src/api/git.ts` 删除；`git-shared.tsx` 中 `DELIVERY_STEP_LABEL`/`DELIVERY_STEP_ORDER`（含 'merge'）已删除；Git 页不再引用 `ROUTES.deliveryMerge`/`DeliveryMergeRequest`（契约本体由 delivery-parity 清理）。

## 待 GUI / 真实服务验证（未执行，不作通过结论）

1. 图谱在真实多分支历史下的分叉/合流与日期分组续接（四主题、1440/1280）。
2. 展开上下文在超大文件上的读取耗时与截断交互。
3. 语法着色在深/浅四主题下的对比度与长行换行。
4. 审查阶段推进、停止确认、unknown 核对与历史下拉（需真实模型多次审查）。
5. 写失败态：推送被拒（non-fast-forward）/认证失败/MR 已存在/hook 拒绝的真实错误体与按钮（需真实远端故障注入；本批未执行真实远端写）。
6. 直接合并能力：产品不提供（本轮按 DEL-07 移除 UI 入口），如未来 P3 开放需另立任务补服务端前提投影。

## 逐条补充处置（Lead 收口核对后补录）

| ID | 状态 | 证据 | 说明 |
|---|---|---|---|
| GIT-26 | 已修复（Lead C10 文档更正） | `docs/review/design-fix-2026-10-20/c10-doc-corrections.md`；`docs/design-coverage.md` Git 行 | 旧文档“Git 页齐全”过度声称已按审计 §3.8 更正为 🟡 并指向 GIT-01..20；其余历史口径以审计总报告为准。 |

