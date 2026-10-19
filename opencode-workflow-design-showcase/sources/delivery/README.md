# 任务隔离执行与用户选择交付 · Claude 设计交付

> **设计样例 · 合成数据（design / mock）。** 原型不连接真实任务、执行引擎、数据库、Git、GitLab、目录、凭据或模型，不发任何网络请求，不写浏览器本机存储。原型里的「已交付」「已推送」「已应用」「已清理」都只是模拟画面，**不代表业务已实现或接口已接通**。

需求来源：本文件夹上一级的 `CLAUDE-PROMPT.md`、`DESIGN-REQUIREMENTS.md`、`API-STATE-CANDIDATE.md`、`ACCEPTANCE-AND-EVIDENCE.md`（v1，2026-10-15）。本目录只新增文件，没有修改需求文件、原 deepseek 设计或原 Git 仓库页设计。

## 1. 打开方式

用浏览器直接打开 `prototype/index.html`（状态总览），从这里进入任一状态。

| 页面 | 内容 | 宿主容器 |
| --- | --- | --- |
| `prototype/index.html` | 状态总览：四条推荐路径、全部 70 个状态、TD-A 覆盖、页面与容器 | 评审辅助，不是产品页面 |
| `prototype/flows.html` | 状态图、Git 目标与步骤依赖、非 Git 应用流程、保全与清理、组件复用图、导航与返回 | 评审辅助 |
| `prototype/start.html` | TD01 开始任务与隔离准备 | 修改：原「开始任务」与计划确认 |
| `prototype/task.html` | TD02 任务画布与待交付 · TD06 工作区详情与清理 | 修改：原任务大画布、情况条、交付端点、右侧面板；抽屉与对话框 |
| `prototype/git.html` | TD03 任务变更 · TD04 交付动作与回执 · TD07 MR 任务来源 | 修改：原 Git 仓库工作台（新增「任务变更」上下文模式） |
| `prototype/apply.html` | TD05 非 Git 应用与三方冲突 | **新增交互视图**：挂在任务交付面板中，全宽展开 |

地址参数：`?state=<状态 ID>&theme=deepseek|warm|spdb|github-white`，可加 `&motion=reduce`。每页底部是原型控制条（不属于产品界面）：切状态、切主题、减弱动态、「说明」（每个状态的设计意图与对应验收条件）、返回状态总览。

推荐路径：
- **Git 主线**：`td01-git-plan` → `td01-ready` → `td02-awaiting` →「查看变更并交付」→ `td03-changes` → `td04-goal` → `td04-commit-confirm` → `td04-push-confirm` → `td04-mr-confirm` → `td04-delivered` → `td07-mr-detail` → 返回任务 `td02-delivered`
- **非 Git**：`td01-nongit-plan` → `td05-overview` → `td05-conflicts` → `td05-conflict-text` → `td05-recheck` → `td05-apply-confirm` → `td05-applied`
- **未知与失败**：`td01-prepare-unknown`、`td04-push-unknown`、`td04-mr-unknown`、`td05-unknown`、`td05-partial`、`td06-cleanup-partial`
- **保全与清理**：`td02-cancelled-retained` → `td06-detail-git` → `td06-cleanup-preview` / `td06-cleanup-undelivered` / `td06-cleanup-blocked` → `td06-cleaned`

## 2. 交付清单

| 文件 | 说明 |
| --- | --- |
| `DESIGN-DELTA.md` | 逐项复用 / 修改 / 新增；TD01–TD07 入口与返回、组件复用、交互步骤、字段、禁用原因；已确认规则 R1–R13 的可见位置；待冻结策略 P1–P16 |
| `API-DESIGN-CANDIDATE.md` | 全部新增名称标「候选 · 未冻结」；资源 / 动作 / 字段 / 原版本与回执映射；任务、执行、Git、目录适配、原 writer 分开；内核 10/10/7/7 不增枚举 |
| `STATES.md` | 70 个状态：页面、名称、类别（加载 / 空态 / 权限或配置缺失 / 漂移 / 冲突 / 明确失败 / 取消保留 / 部分效果 / UNKNOWN / 成功）、设计意图、验收条件、设计图 |
| `prototype/` | 可交互隔离原型（6 个 HTML + 本地 assets） |
| `design/` | 设计图 1440×900：deepseek 全部 70 个状态；warm / spdb / github-white 各 14 张重点状态；状态总览与流程图整页图；`overview-contact-sheet.png` 总览拼图 |

## 3. 设计完成与业务未实现

| 类别 | 内容 |
| --- | --- |
| 设计完成 | TD01–TD07 全部状态可点；确认、提交、推送、创建 MR、检查、应用、清理都用定时器模拟；四主题同一状态集；1440×900、1280×800、1024×768 检查；键盘 Tab / Enter / Esc、弹窗焦点限定与还原、减弱动态 |
| 业务未实现（需同版 API 与 owner 实现） | 普通新任务统一隔离（现只有 AI 修复专属 worktree）；任务完成门槛（`deriveExecutionStatus` 现在节点全成功即 succeeded，不等所选交付）；交付端点可操作（现为展示）；非 Git 基线快照、三方检查与逐项应用；同任务并行写子隔离与汇合；工作区定向清理；推送 / MR 依赖 PR16 候选，生产安装与真实 GitLab 未验收 |
| 原型刻意不画 | 产品内直接合并、流水线、强推、一键覆盖整个目录、自动 / 定时清理、会重复副作用的「重试」按钮、评审人必填 |

## 4. 验收条件覆盖矩阵（TD-A01–TD-A23）

「设计完成」指原型可走通、字段与状态齐全；所有条目的业务实现都尚未开始，需按 ACCEPTANCE-AND-EVIDENCE.md 另行取证。

| 条件 | 名称 | 状态 / 原型入口 | 截图（示例） | 覆盖 | 说明 |
| --- | --- | --- | --- | --- | --- |
| TD-A01 | 每个 Git 新任务独立 | [`td01-git-plan`](prototype/start.html?state=td01-git-plan), [`td01-checking`](prototype/start.html?state=td01-checking), [`td01-ready`](prototype/start.html?state=td01-ready), [`td02-running`](prototype/task.html?state=td02-running) | [td01-git-plan](design/deepseek-td01-git-plan.png)<br>[td01-checking](design/deepseek-td01-checking.png)<br>[td01-ready](design/deepseek-td01-ready.png) | 设计完成 · 业务未实现 | TD01 计划确认显示独立分支 / worktree；原项目 3 个未提交改动保留；普通任务不依赖审查 / finding |
| TD-A02 | 基线与目录冲突 | [`td01-unavailable`](prototype/start.html?state=td01-unavailable), [`td01-empty-repo`](prototype/start.html?state=td01-empty-repo), [`td01-name-conflict`](prototype/start.html?state=td01-name-conflict), [`td01-baseline-drift`](prototype/start.html?state=td01-baseline-drift) | [td01-unavailable](design/deepseek-td01-unavailable.png)<br>[td01-empty-repo](design/deepseek-td01-empty-repo.png)<br>[td01-name-conflict](design/deepseek-td01-name-conflict.png) | 设计完成 · 业务未实现 |  |
| TD-A03 | 创建未知 / 部分创建 | [`td01-prepare-unknown`](prototype/start.html?state=td01-prepare-unknown), [`td01-partial`](prototype/start.html?state=td01-partial) | [td01-prepare-unknown](design/deepseek-td01-prepare-unknown.png)<br>[td01-partial](design/deepseek-td01-partial.png) | 设计完成 · 业务未实现 |  |
| TD-A04 | 写节点隔离 | [`td01-git-plan`](prototype/start.html?state=td01-git-plan), [`td01-combined`](prototype/start.html?state=td01-combined), [`td01-preparing`](prototype/start.html?state=td01-preparing), [`td01-ready`](prototype/start.html?state=td01-ready), [`td02-running`](prototype/task.html?state=td02-running), [`td02-parallel`](prototype/task.html?state=td02-parallel) | [td01-git-plan](design/deepseek-td01-git-plan.png)<br>[td01-combined](design/deepseek-td01-combined.png)<br>[td01-preparing](design/deepseek-td01-preparing.png) | 设计完成 · 业务未实现 | 准备成功前「开始执行」不可用；并行写由服务决定，画布显示子工作区与汇合 |
| TD-A05 | 画布待交付 | [`td02-awaiting`](prototype/task.html?state=td02-awaiting), [`td02-blocked`](prototype/task.html?state=td02-blocked), [`td02-background`](prototype/task.html?state=td02-background) | [td02-awaiting](design/deepseek-td02-awaiting.png)<br>[td02-blocked](design/deepseek-td02-blocked.png)<br>[td02-background](design/deepseek-td02-background.png) | 设计完成 · 业务未实现 |  |
| TD-A06 | 导航和草稿 | [`td02-background`](prototype/task.html?state=td02-background), [`td03-changes`](prototype/git.html?state=td03-changes), [`td03-leave-context`](prototype/git.html?state=td03-leave-context) | [td02-background](design/deepseek-td02-background.png)<br>[td03-changes](design/deepseek-td03-changes.png)<br>[td03-leave-context](design/deepseek-td03-leave-context.png) | 设计完成 · 业务未实现 | from / fromState / kind 返回上下文；切到普通历史需确认退出任务上下文，草稿留在该任务下；后台任务只提示不抢视图 |
| TD-A07 | 无变更 / 未选择 | [`td02-no-changes`](prototype/task.html?state=td02-no-changes) | [td02-no-changes](design/deepseek-td02-no-changes.png) | 设计完成 · 业务未实现 | 无变更不建空提交 / 假 MR；「确认无文件交付并结束」为候选（P1） |
| TD-A08 | 失败和验收 | [`td02-failed-candidate`](prototype/task.html?state=td02-failed-candidate), [`td02-delivered-verify-failed`](prototype/task.html?state=td02-delivered-verify-failed) | [td02-failed-candidate](design/deepseek-td02-failed-candidate.png)<br>[td02-delivered-verify-failed](design/deepseek-td02-delivered-verify-failed.png) | 设计完成 · 业务未实现 | 失败候选只按 authority 许可显示知情交付（P6）；「已交付，验证未通过」单列 |
| TD-A09 | 变更浏览 | [`td03-changes`](prototype/git.html?state=td03-changes), [`td03-excluded`](prototype/git.html?state=td03-excluded), [`td03-large-binary`](prototype/git.html?state=td03-large-binary), [`td03-loading`](prototype/git.html?state=td03-loading), [`td03-read-error`](prototype/git.html?state=td03-read-error) | [td03-changes](design/deepseek-td03-changes.png)<br>[td03-excluded](design/deepseek-td03-excluded.png)<br>[td03-large-binary](design/deepseek-td03-large-binary.png) | 设计完成 · 业务未实现 |  |
| TD-A10 | 选择提交 | [`td04-goal`](prototype/git.html?state=td04-goal), [`td04-commit-confirm`](prototype/git.html?state=td04-commit-confirm), [`td04-commit-drift`](prototype/git.html?state=td04-commit-drift), [`td04-goal-change`](prototype/git.html?state=td04-goal-change) | [td04-goal](design/deepseek-td04-goal.png)<br>[td04-commit-confirm](design/deepseek-td04-commit-confirm.png)<br>[td04-commit-drift](design/deepseek-td04-commit-drift.png) | 设计完成 · 业务未实现 | 整文件选择；作者来自设置不可改；版本漂移保留草稿重新确认 |
| TD-A11 | 仅提交目标 | [`td04-commit-only-done`](prototype/git.html?state=td04-commit-only-done) | [td04-commit-only-done](design/deepseek-td04-commit-only-done.png) | 设计完成 · 业务未实现 |  |
| TD-A12 | 推送目标 | [`td02-step-committed`](prototype/task.html?state=td02-step-committed), [`td04-committed-wait-push`](prototype/git.html?state=td04-committed-wait-push), [`td04-push-confirm`](prototype/git.html?state=td04-push-confirm), [`td04-push-exists`](prototype/git.html?state=td04-push-exists), [`td04-push-auth`](prototype/git.html?state=td04-push-auth) | [td02-step-committed](design/deepseek-td02-step-committed.png)<br>[td04-committed-wait-push](design/deepseek-td04-committed-wait-push.png)<br>[td04-push-confirm](design/deepseek-td04-push-confirm.png) | 设计完成 · 业务未实现 |  |
| TD-A13 | MR 目标 | [`td02-delivered`](prototype/task.html?state=td02-delivered), [`td04-mr-confirm`](prototype/git.html?state=td04-mr-confirm), [`td04-target-drift`](prototype/git.html?state=td04-target-drift), [`td04-mr-exists`](prototype/git.html?state=td04-mr-exists), [`td04-delivered`](prototype/git.html?state=td04-delivered) | [td02-delivered](design/deepseek-td02-delivered.png)<br>[td04-mr-confirm](design/deepseek-td04-mr-confirm.png)<br>[td04-target-drift](design/deepseek-td04-target-drift.png) | 设计完成 · 业务未实现 |  |
| TD-A14 | UNKNOWN / 明确失败 | [`td04-hook-rejected`](prototype/git.html?state=td04-hook-rejected), [`td04-push-failed`](prototype/git.html?state=td04-push-failed), [`td04-push-unknown`](prototype/git.html?state=td04-push-unknown), [`td04-mr-unknown`](prototype/git.html?state=td04-mr-unknown) | [td04-hook-rejected](design/deepseek-td04-hook-rejected.png)<br>[td04-push-failed](design/deepseek-td04-push-failed.png)<br>[td04-push-unknown](design/deepseek-td04-push-unknown.png) | 设计完成 · 业务未实现 | UNKNOWN 只「核对原操作」；明确失败且证明无副作用才允许新请求 |
| TD-A15 | MR 后续独立 | [`td02-delivered`](prototype/task.html?state=td02-delivered), [`td04-delivered`](prototype/git.html?state=td04-delivered), [`td07-mr-detail`](prototype/git.html?state=td07-mr-detail), [`td07-mr-list`](prototype/git.html?state=td07-mr-list) | [td02-delivered](design/deepseek-td02-delivered.png)<br>[td04-delivered](design/deepseek-td04-delivered.png)<br>[td07-mr-detail](design/deepseek-td07-mr-detail.png) | 设计完成 · 业务未实现 | MR 未合并也算完成所选 MR 交付；合并只给「在 GitLab 打开」 |
| TD-A16 | 非 Git 隔离与三方 | [`td01-nongit-plan`](prototype/start.html?state=td01-nongit-plan), [`td05-overview`](prototype/apply.html?state=td05-overview), [`td05-checking`](prototype/apply.html?state=td05-checking), [`td05-preview`](prototype/apply.html?state=td05-preview), [`td05-read-error`](prototype/apply.html?state=td05-read-error) | [td01-nongit-plan](design/deepseek-td01-nongit-plan.png)<br>[td05-overview](design/deepseek-td05-overview.png)<br>[td05-checking](design/deepseek-td05-checking.png) | 设计完成 · 业务未实现 |  |
| TD-A17 | 非 Git 冲突 | [`td05-conflicts`](prototype/apply.html?state=td05-conflicts), [`td05-conflict-text`](prototype/apply.html?state=td05-conflict-text), [`td05-conflict-binary`](prototype/apply.html?state=td05-conflict-binary), [`td05-recheck`](prototype/apply.html?state=td05-recheck) | [td05-conflicts](design/deepseek-td05-conflicts.png)<br>[td05-conflict-text](design/deepseek-td05-conflict-text.png)<br>[td05-conflict-binary](design/deepseek-td05-conflict-binary.png) | 设计完成 · 业务未实现 | 六类冲突逐项处理，无「全部覆盖」 |
| TD-A18 | 应用当前性 | [`td05-preview`](prototype/apply.html?state=td05-preview), [`td05-recheck`](prototype/apply.html?state=td05-recheck), [`td05-apply-confirm`](prototype/apply.html?state=td05-apply-confirm), [`td05-drift`](prototype/apply.html?state=td05-drift) | [td05-preview](design/deepseek-td05-preview.png)<br>[td05-recheck](design/deepseek-td05-recheck.png)<br>[td05-apply-confirm](design/deepseek-td05-apply-confirm.png) | 设计完成 · 业务未实现 |  |
| TD-A19 | 部分应用 / 重启 | [`td05-partial`](prototype/apply.html?state=td05-partial), [`td05-unknown`](prototype/apply.html?state=td05-unknown), [`td05-applied`](prototype/apply.html?state=td05-applied) | [td05-partial](design/deepseek-td05-partial.png)<br>[td05-unknown](design/deepseek-td05-unknown.png)<br>[td05-applied](design/deepseek-td05-applied.png) | 设计完成 · 业务未实现 | 逐项结果，不整批重做、不回滚；待核实项逐项核对 |
| TD-A20 | 工作区保全 | [`td02-cancelled-retained`](prototype/task.html?state=td02-cancelled-retained), [`td06-detail-git`](prototype/task.html?state=td06-detail-git), [`td06-detail-nongit`](prototype/task.html?state=td06-detail-nongit), [`td06-close-retain`](prototype/task.html?state=td06-close-retain), [`td06-cleanup-blocked`](prototype/task.html?state=td06-cleanup-blocked) | [td02-cancelled-retained](design/deepseek-td02-cancelled-retained.png)<br>[td06-detail-git](design/deepseek-td06-detail-git.png)<br>[td06-detail-nongit](design/deepseek-td06-detail-nongit.png) | 设计完成 · 业务未实现 |  |
| TD-A21 | 定向清理 | [`td06-cleanup-preview`](prototype/task.html?state=td06-cleanup-preview), [`td06-cleanup-undelivered`](prototype/task.html?state=td06-cleanup-undelivered), [`td06-cleanup-partial`](prototype/task.html?state=td06-cleanup-partial), [`td06-cleaned`](prototype/task.html?state=td06-cleaned) | [td06-cleanup-preview](design/deepseek-td06-cleanup-preview.png)<br>[td06-cleanup-undelivered](design/deepseek-td06-cleanup-undelivered.png)<br>[td06-cleanup-partial](design/deepseek-td06-cleanup-partial.png) | 设计完成 · 业务未实现 | 只列自有对象；非 Git 原目录永不在清理对象中；部分清理只核对 |
| TD-A22 | 重启与历史 | [`td02-awaiting`](prototype/task.html?state=td02-awaiting), [`td02-delivered`](prototype/task.html?state=td02-delivered), [`td06-cleaned`](prototype/task.html?state=td06-cleaned), [`td07-mr-closed-later`](prototype/git.html?state=td07-mr-closed-later) | [td02-awaiting](design/deepseek-td02-awaiting.png)<br>[td02-delivered](design/deepseek-td02-delivered.png)<br>[td06-cleaned](design/deepseek-td06-cleaned.png) | 设计完成 · 业务未实现 | 重新打开任务读回待交付 / 原回执；MR 后来关闭不重开；清理后回执仍可读 |
| TD-A23 | 四主题与桌面 | 任一状态 · 控制条切主题 / 减弱动态 | 四主题：design/{warm,spdb,github-white}-*.png 共 42 张 | 设计完成 · 业务未实现 |  |

自查结果（2026-10-15）：70 个状态 × 4 主题（1440×900）自动遍历，无脚本错误、无非本地请求、无横向溢出、设计样例标识可见、页内链接指向的状态 ID 全部存在；各页另测 1280×800、1024×768，以及跨页「查看变更并交付 → 返回任务」往返（含非 Git 与后台任务）。

## 5. 待冻结项（设计不作决定，详见 DESIGN-DELTA §6、API-DESIGN-CANDIDATE §11）

| 编号 | 待冻结 | 原型里的处理 |
| --- | --- | --- |
| P1 | **无变更结算**（「确认无文件交付并结束」） | 按钮禁用，标「候选 · 待产品 / API 核准」（`td02-no-changes`） |
| P2 | **未完成时改变交付目标** | 只画确认形态，已发生动作不撤销，标「API 未冻结」（`td04-goal-change`） |
| P3 | **子集交付对必需产物的影响** | 只显示「由服务判定」说明，不自动缩小成果范围（`td04-commit-confirm`、`td05-conflicts`） |
| P4 | 「准备独立工作区 → 开始执行」两步 vs「准备并开始」 | 两套文案都画，不混用（`td01-git-plan` / `td01-combined`） |
| P5 | 待交付阶段 ExecutionStatus 映射（active + reason 等） | UI 只读派生原因显示「执行已结束 · 等待交付」 |
| P6 | C33 失败候选交付资格 | 只按 authority 许可显示知情确认，否则禁用 |
| P7 | 清理后是否保留非 Git 基线快照 | 保留对象写「由服务说明」 |
| P8 | 非 Git 应用的备份 / 恢复证据 | 仅服务提供时显示；画了「服务未提供备份证据」变体 |
| P9 | 评审人指派 | 显示「暂未接通」，不必填 |
| P10 | 外部 GitLab 地址来源 | 只用可信读口地址；不可用时禁用、可复制 |
| P11 | 并行子工作区汇合策略 | 只展示服务给出的策略与阻塞 |
| P12 | 工作区物理准备的精确时点 | 放在计划确认之后，文案不暗示「形成草稿即已执行」 |
| P13 | 分支 / 目录同名冲突的解决方式 | 只显示占用对象并保留草稿；原型给「使用新名称重新预览」 |
| P14 | 取消后「稍后交付」的结算语义 | 只保留文件与入口，不改写取消事实 |
| P15 | 「额外知情丢弃未交付内容」与「不能销毁唯一未交付产物」的边界 | 两种都画：可知情丢弃 / 含唯一产物时不提供删除 |
| P16 | 推送新分支名由谁建议 | 系统建议 `-2` 并允许编辑，需重新预览 |

## 6. 样例数据

全部虚构：Git 任务「退款单分页查询与导出」`T-2041`（项目「订单服务」，任务分支 `task/T-2041-refund-export`，基线 `main @ 7c1e9a2`，提交 `9d8c7b6`，MR `!58`）；后台任务 `T-2042`；非 Git 任务「月报改为按自然月汇总」`T-2043`（项目「运营报表脚本」，基线快照 10-15 09:40，六类冲突）。不含真实路径、账号或凭据。
