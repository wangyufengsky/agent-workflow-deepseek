# 新任务隔离执行与用户选择交付 · 设计增量（DESIGN-DELTA）

> 需求包：`workflow-task-delivery-claude-design-pending/`（2026-10-15 v1）。状态 id 一律取自 `prototype/assets/td-states.js`（共 70 个，id 与所在页不改）。
> 本文是**设计增量**：说明在既有 deepseek 通用设计与 Git 工作台设计上改了什么、加了什么。「设计完成」不等于「业务已实现」；新增接口/字段名见 `API-DESIGN-CANDIDATE.md`，全部为「候选 · 未冻结」。
> 原型只用合成数据（订单服务 T-2041 / 运营报表脚本 T-2043），不连接任务、Git、GitLab、目录或模型；页头 `.td-mock` 徽标标明。

## 0. 读法与约定

| 约定 | 含义 |
| --- | --- |
| 复用 | 原组件、原文案风格、原交互原样使用，只换数据 |
| 修改 | 在原容器内新增模式 / 区块 / 字段 / 状态，不新建页面 |
| 新增 | 原设计里没有的交互视图。本次只有 TD05 |
| 宿主容器 | 原设计中承载本增量的页面 → 区域 → 组件，写法「页面 · 区域 · 组件」 |
| from / fromState | 跨页跳转时带的返回上下文。`from` 是来源页（start / task / git / apply），`fromState` 是来源状态 id；「返回」用 `TD.backHref(fallback)`：有 fromState 回到它，没有时回到本节写明的兜底状态 |
| 原 deepseek 页 | `deepseek/pages/start.html`、`requirement.html`、`task.html`、`projects.html` 及 `assets/ds.css / skins.css / shell.js / canvas.js` |
| 原 Git 工作台 | `git-workbench/prototype/index.html` + `assets/git.js / git.css`，状态见其 `STATES.md`（g01–g61）；其 `API-DESIGN.md` 只是**历史候选** |
| 禁用原因 | 每个禁用按钮旁或 `title` 中都有可键盘读到的原因文本，下表「原因文案」即界面原文 |

**旧 Git 设计只作历史与组件来源。** 旧 g54 / g56「直接合并」、g55 中的流水线与审批徽标、g50 的「提交并推送」连发按钮、g55「合并后自动清理」、g59 / g60「重试」按钮，均**不**作为现成能力或可复用文案进入本增量（见 §2.3）。

## 1. 总表：复用 / 修改 / 新增

| TD | 分类 | 宿主容器（原设计） | 原型页 | 状态数 | 验收 |
| --- | --- | --- | --- | --- | --- |
| TD01 开始任务与隔离准备 | 修改 | ① `start.html` · 第 1 步「项目」 · `.opt` 项目单选卡 + 右侧 `.summary`「将要创建」卡；② `requirement.html` · 右侧计划面板 `aside.side` · `side-foot`（确认计划 → 开始执行 `#startDlg`） | start.html | 12 | TD-A01–04、A16 |
| TD02 任务画布与待交付 | 修改 | `task.html` · 顶部 `.canvas-bar`（状态徽标）+ `#situ` 情况条 + `#cv` 执行画布的系统终点「交付」(`canvas.js` system `@end`) + 右侧 `aside.side` 面板 | task.html | 11 | TD-A04–08、A12–13、A15、A20、A22 |
| TD03 Git 任务变更 | 修改 | Git 工作台 · 页头 `crumbs` + 工作台 `.wb`（左栏 `.wb-rail`、主区）· g42 的 `.fx-wrap`（`.fx-diff` = 文件列表 + `diffView`）与右侧 `.ns-col` | git.html | 6 | TD-A06、A09 |
| TD04 Git 交付动作与回执 | 修改 | Git 工作台 · g42 右侧 `.ns-col`「下一步」步骤栏（`stepCommit / stepPush / stepMerge` 卡）+ 原确认对话框 | git.html | 17 | TD-A10–15 |
| TD05 非 Git 应用与三方冲突 | **新增交互视图** | 挂在 TD02 任务交付面板内，「全宽查看」展开；外壳沿 `task.html` 的 `.canvas-bar` + `#situ`，画布区让位给应用视图 | apply.html | 13 | TD-A16–19 |
| TD06 工作区保全与清理 | 修改 / 扩充 | `task.html` · 右侧抽屉 `aside.drawer`（沿 start.html 的项目 / 流程抽屉结构，宽 520）+ `.dialog[role=alertdialog]`（沿 task.html `#delDlg`）；语义复用 g58「放弃修复」确认 | task.html | 8 | TD-A20–22 |
| TD07 MR 任务来源 | 修改 | Git 工作台 · 左栏「合并请求」→ `mrView`（`.mr-row` 列表 + `.mr-d` 详情卡，g17） | git.html | 3 | TD-A15、A22 |

## 2. 页面数量纪律：为什么没有新增一级页面

### 2.1 五个原型文件各是什么

| 原型文件 | 在产品里是什么 | 是否新页面 |
| --- | --- | --- |
| `start.html` | 原「开始任务」与原「需求画布 · 计划面板」两个既有容器的修改。原型为便于评审，把计划确认区与项目选择放在同一文件演示；产品里计划确认仍在原需求画布右侧面板，不新增创建向导 | 否 |
| `task.html` | 原任务大画布：状态栏、情况条、交付端点、右侧面板的新模式；TD06 是同页抽屉与对话框 | 否 |
| `git.html` | 原 Git 工作台的「任务变更」上下文模式（TD03/04）与原 MR 视图的补充字段（TD07） | 否 |
| `apply.html` | **TD05 唯一新增的交互视图**：任务交付面板的「全宽查看」。外壳仍是原任务页的页头与情况条，面包屑指回原任务，无侧栏菜单项 | 新增视图，非一级页面 |
| `index.html` / `flows.html` | 仅评审辅助：状态总览、状态图与组件复用图。产品中不存在 | 否（评审用） |

### 2.2 明确不做

- 不新建一级导航「交付中心」「任务工作台」「非 Git 项目管理」，侧栏仍只有原「开始任务 / 任务列表 / Git 仓库」等入口。
- 不做第二套画布、第二套节点验收、隐藏质量工程师节点或新模型节点；交付端点是任务级汇聚入口。
- 不重画既有 25 页与既有 Git 设计；70 个状态 id 是**同一批容器的状态样例**，不能计为 70 个页面。
- 不画可执行的产品内 merge、流水线、强推、一键覆盖整个目录、自动清理、定时清理、「再试一次」类副作用按钮。

### 2.3 旧 Git 设计中不复用的部分

| 旧设计 | 不复用的原因（本包规则） |
| --- | --- |
| g54 合并方式单选「直接合并」、g56 直接合并冲突、旧 API `fix.merge` | 当前产品内合并未实现；本轮不给可执行 merge（§1 MR 独立）。MR 之后只给「在 GitLab 打开」 |
| g55 的流水线 / 审批徽标、g54 评审人多选 | 流水线不是现成能力；评审人当前未接通，不能设计成可用必填（DESIGN-REQUIREMENTS §5） |
| g50 split button「提交并推送」 | 每个副作用需独立确认，不自动连发后续（§1 交付选择） |
| g55 底部「本地修复分支会在合并后自动清理」 | 工作区不自动清理（§1 保全） |
| g59「重试提交」、g60「重试推送」 | 只有**明确失败且证明无副作用**后才能以新请求再发；按钮文案改为「修改后重新提交」「重新预览推送」，UNKNOWN 只有「核对原操作」 |
| 旧 API「ls-remote 即可结算 push」「只按 source 找 MR」 | 以 PR16 当前的 create-only push / 原标记 MR 核对为准，不弱化证明（ACCEPTANCE §3） |
| 「AI 审查」「修复」页签、问题对照 | 普通任务没有 review / finding 事实，不强制显示，不伪造 GitFixRun |

## 3. 组件复用清单

| 原组件（来源） | 用在 | 变化 |
| --- | --- | --- |
| `.opt` 单选卡、`.summary` + `.sum-row`、`.nx` 接下来轨道（start.html） | TD01 | 项目卡下加「隔离方式」行；summary 增「隔离方式 / 原项目路径」；轨道增「准备独立工作区」一步 |
| 计划面板 `side-head / side-body / side-foot`、`#startDlg`（requirement.html） | TD01 | `side-body` 增「工作区」卡；`side-foot` 由「确认计划 → 开始执行」变为「确认计划 → 准备独立工作区 → 开始执行」 |
| `.stages`（requirement.html 进度条） | TD01 准备阶段、TD05 步骤条 | 只显示阶段名，无百分比 |
| `.canvas-bar`、状态徽标 `.badge st-*`、`#situ .situ.wait/need/fail/ok/unk`（task.html） | TD02、TD05 外壳 | 情况条拆为「执行与验收」｜「交付」两段 |
| 执行画布与系统终点「交付」（canvas.js、FlowCanvas `@end`） | TD02 | 终点由只展示改为可点击，有 5 个显示态 |
| 右侧 `aside.side` 面板框架（task.html） | TD02 交付面板 | 新增「交付」模式（宽 480） |
| `aside.drawer`（start.html 项目 / 流程抽屉）、`.dialog[role=alertdialog]`（task.html `#delDlg`） | TD06 | 工作区详情抽屉 520；清理确认对话框 |
| `.banner unknown/warn/danger/ok`、`.lockline`、`.conseq`「后果」块 | 全部 | 原样 |
| Git 页头 `crumbs`、分支 chip、工作区未提交提示 `gh-dirty` | TD03 | 面包屑改为「Git 仓库 / 订单服务 / 任务变更 · 退款单分页查询与导出」；增上下文条 |
| g42 `.fx-diff`（`fileList` + `diffView`、`dv-bar / dv-tools`、统一 / 并排 / 忽略空白 / 全宽 / 加载全部） | TD03、TD05 | 去掉审查问题导航 `fnav`；TD05 加「三方」比较切换 |
| g18 大文件分段、二进制、权限变更表现 | TD03、TD05 | 原样 |
| g42 `.ns-col` 步骤栏、`ns-step lock/cur/done/bad/unk`、`ns-kv`、`ns-files` | TD04 | 顶部加「完成目标」三选一卡；步骤数随目标变化；底部「交付状态」摘要 |
| g50 提交表单（信息、作者来自 设置 → Git 账号、文件勾选、后果） | TD04 提交 | 主按钮单一「提交…」，打开确认对话框 |
| g51 已提交（新 SHA、解锁下一步） | TD04 `td04-committed-wait-push` | 文案「提交完成 · 等待推送确认」，任务未完成 |
| g52 推送被拒的「换新分支名」结构 | TD04 `td04-push-exists` | 预览阶段读远端即发现同名；改名后重新预览并确认，不是先推再改 |
| g53 已推送（远端分支链接） | TD04 | 原样 |
| g55 MR 已创建卡（iid、源→目标、在 GitLab 打开） | TD04 `td04-delivered`、TD07 | 去掉流水线 / 审批 |
| g57 回执未知（原操作 key、「核对原操作」、后续步骤锁定） | `td01-prepare-unknown`、`td04-push-unknown`、`td04-mr-unknown`、`td05-unknown`、`td06-cleanup-partial` | 原样，用于更多步骤 |
| g58 放弃修复确认（删除本地对象 / 保留远端 / 保留记录） | TD06 清理确认 | 增未交付数量、阻塞原因、非 Git 保留对象 |
| g17 `mrView`（`.mr-row`、`.mr-d`） | TD07 | 增「来源任务」chip 与两条独立事实 |

## 4. 分视图设计

### TD01 开始任务与隔离准备（修改）

**宿主容器**：`start.html` · 第 1 步「项目」· `.opt` 项目卡与右侧 `.summary` 卡；`requirement.html` · 右侧计划面板 `aside.side` · `side-body` 与 `side-foot`（原「确认计划」「开始执行」按钮与 `#startDlg`）。原型在 start.html 内连续演示两处。

**入口与返回**

| 方向 | 路径 |
| --- | --- |
| 进入 | 侧栏「开始任务」→ 项目 → 目标 → 流程 →「形成需求草稿」（原 `requirements.create`）→ 需求画布审阅计划 |
| 前进 | `td01-ready`「开始执行」→ `task.html?state=td02-running&from=start&fromState=td01-ready` |
| 侧出口 | `td01-unavailable`「查看项目」→ 原 projects.html（不带写操作）；「授权说明」→ 说明抽屉 |
| 返回 | 草稿始终保留；离开回到原「任务列表」；从任务页返回本区时按 `fromState` 回到同一计划确认状态 |

**交互步骤**

1. 选项目。项目卡下出现「隔离方式」行：`Git · 独立分支与 worktree` 或 `非 Git · 基线快照与独立副本`，附原项目显示路径；类型未识别时显示「正在核对」（`td01-checking`），不默认为非 Git。
2. 写目标、选流程、形成需求草稿（原流程不变；此时没有工作区）。
3. 在计划面板审阅计划；`side-body` 的「工作区」卡列出将要准备的工作区（字段见下）。
4. 确认计划（原动作，原回执）。
5. 点「准备独立工作区」：阶段条依次显示「登记任务身份 → 固定基线 → 创建任务分支 / 复制快照 → 创建工作目录 → 核对」（`td01-preparing`），只用阶段名。
6. 准备成功（`td01-ready`）：卡片显示实际分支 / 目录与基线；「开始执行」才可用，按原 `#startDlg` 再确认一次。
7. 备选文案 `td01-combined`：若隔离准备是启动事务的一部分，单按钮「准备并开始」，下方固定说明「准备成功前不会运行任何写文件的节点」。两种文案**只能二选一**，由候选 API 评审决定（§6）。

**字段**

| 字段 | Git | 非 Git |
| --- | --- | --- |
| 任务名称 / ID | 退款单分页查询与导出 · T-2041 | 月报改为按自然月汇总 · T-2043 |
| 项目与原路径 | 订单服务 · `/Users/dev/workspace/order-service` | 运营报表脚本 · `/Users/dev/workspace/ops-report-scripts` |
| 基线 | `main @ 7c1e9a2`（完整 SHA 在诊断详情可复制） | 快照时间、范围、排除项（`node_modules/`、`.cache/`、>50 MB 文件）与未复制资源（`data/raw-2025.parquet` 210 MB） |
| 分支建议 | `task/T-2041-refund-export`（系统生成） | 无（界面称「独立副本」，不叫 worktree，不 git init） |
| 工作目录显示名 / 路径 | `order-service · T-2041` · `~/.opencode-workflow/workspaces/order-service/T-2041` | `~/.opencode-workflow/copies/ops-report-scripts/T-2043` |
| 读写授权摘要 | 写：任务工作区；读：原项目只读 | 同左 |
| 并行写策略 | 服务决定，只展示：「实现接口」「编写测试」各自子工作区，结束后汇合；只读节点读一致快照 | 同左（子副本） |
| 诊断详情（折叠） | 公开安全引用可复制；不显示 credentialRef、inode、lease、完整哈希 | 同左 |

**禁用条件**

| 控件 | 条件 | 原因文案 |
| --- | --- | --- |
| 准备独立工作区 | 计划未确认 | 先确认计划，再准备独立工作区 |
| 准备独立工作区 | 项目类型核对中 | 正在核对项目类型，核对完成前不能准备工作区 |
| 准备独立工作区 | 项目不可用 / 无权限 | 原项目路径不可用或没有读取权限，查看项目或授权说明 |
| 准备独立工作区 | Git 空仓库 / 基线不可用 | 仓库还没有提交，没有可固定的基线；不会自动创建初始提交 |
| 准备独立工作区 | 分支 / 目录同名 | `task/T-2041-refund-export` 已存在，不会覆盖或复用；草稿已保留 |
| 准备独立工作区 | 基线前移 | 基线已从 7c1e9a2 前移，重新读取并确认后才能准备 |
| 准备独立工作区 | 原创建待核对 / 部分创建 | 原准备请求还没有核对结果，不会再分配第二个目录 |
| 开始执行 | 工作区未就绪 | 独立工作区准备成功前不能开始执行 |

**状态 id**

| id | 要点 |
| --- | --- |
| `td01-git-plan` | Git 计划确认 + 工作区卡；按钮两步 |
| `td01-nongit-plan` | 非 Git：快照范围、排除与未复制资源可见；「独立副本」措辞 |
| `td01-checking` | 类型「正在核对」，准备按钮禁用 |
| `td01-combined` | 备选单按钮「准备并开始」，标「待 API 评审二选一」 |
| `td01-preparing` | 阶段名进度，无百分比；重复点击被锁定 |
| `td01-ready` | 准备成功，实际分支 / 目录 / 基线；「开始执行」可用 |
| `td01-unavailable` | 项目不可用 / 权限不足；「查看项目」「授权说明」 |
| `td01-empty-repo` | 空仓库 / 基线不可用；不伪造 SHA |
| `td01-name-conflict` | 显示被占用对象；不覆盖、不静默复用；草稿保留 |
| `td01-baseline-drift` | 新旧基线并列；「重新读取」后重新确认 |
| `td01-prepare-unknown` | 原准备请求 key 与发出时间；只有「核对原操作」 |
| `td01-partial` | 已发生步骤清单 + 定向恢复入口；不自动清理 |

### TD02 任务画布与待交付（修改）

**宿主容器**：`task.html` · `.canvas-bar`（面包屑、任务名、状态徽标、更多菜单）· `#situ` 情况条 · `#cv` 执行画布的系统终点「交付」· 右侧 `aside.side`（新增「交付」模式，宽 480）。

**入口与返回**

| 方向 | 路径 |
| --- | --- |
| 进入 | 任务列表行 / 原任务链接 / `td01-ready` 开始执行 / 后台待处理提示 / 从 TD03–TD07 返回 |
| 去 Git | 「查看变更并交付」→ `git.html?state=td03-changes&from=task&fromState=<当前 td02 状态>`；已有步骤成功时直达当前步骤（如 `td02-step-committed` → `td04-committed-wait-push`） |
| 去非 Git | 「查看变更并交付」→ `apply.html?state=td05-overview&from=task&fromState=<当前>` |
| 去 TD06 | 「工作区详情」→ 同页抽屉 `td06-detail-git` / `td06-detail-nongit` |
| 去 MR | `td02-delivered`「查看 MR !58」→ `git.html?state=td07-mr-detail&from=task&fromState=td02-delivered` |
| 返回本页 | 恢复原画布视角、选中节点与面板；状态以重读为准，不靠瞬时 toast |

**交互步骤**

1. 执行中：状态徽标旁加工作区 chip「独立工作区 · order-service · T-2041」；情况条右段「交付：未到达」。
2. 并行写（`td02-parallel`）：两个写节点各带「子工作区」标签，画布显示服务执行的「汇合」；只展示策略与阻塞，不让用户分配目录。
3. 全部节点执行 / 验收结束：徽标「执行已结束 · 等待交付」（wait 色），**不显示绿色「任务已完成」**；节点保持各自真实状态；终点「交付」显示「待交付」。
4. 点终点或情况条按钮，右侧打开「交付」面板；首要动作「查看变更并交付」，次要「工作区详情」。
5. 用户离开或暂不选择：保持待交付，重新打开任务恢复同一面板与原回执。
6. Git 侧已提交但目标含推送：返回后画布显示 `td02-step-committed`「已提交 · 等待推送确认」，任务未完成。
7. 所选目标全部成功（服务读回）：`td02-delivered` 徽标「任务已交付」，面板另列「MR !58 未合并」为独立事实。

**交付终点显示态**：未到达 / 待交付 / 进行中 / 待核对 / 已交付（对应 API 文档 §6 的投影；「受阻」以待交付 + 原因呈现）。

**交付面板字段**：任务 / 项目 / 工作区身份摘要；执行与验收摘要（单元测试 41/41、lint 通过或回归 2 个失败）+ 验证日志入口；变更统计 A/M/D；未处理项；所选完成目标；当前动作；原请求核对状态；保留资源；最后更新时间。

**禁用条件**

| 控件 | 条件 | 原因文案 |
| --- | --- | --- |
| 查看变更并交付 | 仍有活动写入 / 未停稳 | 「实现接口」仍在写入任务工作区，停稳后才能交付 |
| 查看变更并交付 | 变更事实失效 | 变更快照已过期，重新读取后再交付 |
| 查看变更并交付 | 有原请求待核对 | 推送结果待核对，核对完成前不能开始新的交付动作 |
| 确认无文件交付并结束 | 始终（候选） | 无变更结算规则待产品 / API 核准，当前不可用 |
| 提交（失败候选） | 无可信 authority 许可 | 验证未通过：是否允许交付由验收规则决定，当前未获许可 |
| 清理工作区 | 见 TD06 | 见 TD06 |

**状态 id**

| id | 要点 |
| --- | --- |
| `td02-running` | 执行中；状态栏显示独立工作区 |
| `td02-parallel` | 子工作区 + 汇合策略，服务决定 |
| `td02-awaiting` | 「执行已结束 · 等待交付」；终点 + 面板 |
| `td02-blocked` | 活动写入 / 未停稳，交付禁用并给原因与定位 |
| `td02-no-changes` | 「没有文件变更」；不生成空提交或假 MR；特殊结算按钮标候选 |
| `td02-failed-candidate` | 回归 2 个失败；交付资格由原 authority 判定，勾选不消除失败 |
| `td02-step-committed` | 已提交 · 等待推送确认；任务未完成 |
| `td02-delivered` | 任务已交付；MR 未合并为独立事实 |
| `td02-delivered-verify-failed` | 「已交付，验证未通过」，与全部通过分开显示 |
| `td02-background` | 另一任务 T-2042 待交付：只在任务列表 / 待处理提示，不切走当前视图 |
| `td02-cancelled-retained` | 已取消；文件保留，可稍后查看 / 交付；不隐式删除、不称成功 |

### TD03 Git 任务变更（修改）

**宿主容器**：Git 工作台 · 页头 `crumbs` · `.wb` 工作台主区；任务变更模式下主区采用 g42 的 `.fx-wrap`：左 `.fx-diff`（`fileList` + `diffView`），右 `.ns-col`（TD04）。左栏 `.wb-rail` 在任务上下文中显示文件树与「未纳入文件」入口。

**入口与返回**

| 方向 | 路径 |
| --- | --- |
| 进入 | TD02「查看变更并交付」（带 `from=task&fromState`）；任务深链绑定 taskRef / workspaceRef |
| 返回任务 | 上下文条「返回任务」按钮与面包屑任务名 → `TD.backHref('td02-awaiting')`；Esc 只关闭弹层，不触发离开 |
| 退出上下文 | 切到「提交历史 / 分支 / 合并请求」或切仓库 → `td03-leave-context` 确认条：「将退出任务变更，选择与草稿保留在 T-2041」 |
| 去 TD06 | 「工作区详情」→ `task.html?state=td06-detail-git&from=git&fromState=<当前>` |

**交互步骤**

1. 进入即读取任务变更（`td03-loading`，显示「读取任务变更中」，不造进度）。
2. 上下文条显示原项目、任务分支、基线、工作区、快照 `cr-7 · 读取于 16:02`、「返回任务」。
3. 页签只有「任务变更」「验证与成果」；不出现 AI 审查 / findings。
4. 左侧文件树按 A/M/D（文字 + 图标 + 颜色）列出；点文件在中间看 diff，可切统一 / 并排、忽略空白、全宽；大文件分段「加载全部」。
5. 「未纳入文件」列出路径与原因（`td03-excluded`）；忽略规则内文件只显示路径不显示内容。
6. 选择整文件进入右侧步骤栏（TD04）；只读 diff 不是自动暂存，不提供片段暂存。
7. 读失败或快照过期（`td03-read-error`）：保留已加载内容与读取时间，「重新读取」。

**字段**：每文件 A/M/D、路径（长路径折行、可复制）、+/−、二进制（身份与大小）、大文件分段、权限 `100644 → 100755`；排除项路径与原因（`dist/` 构建产物 · .gitignore；`.env.local` 忽略规则 · 内容不显示；`coverage/` 工具生成）；「验证与成果」页：任务目标、成果、验收摘要、验证日志入口。

**禁用条件**

| 控件 | 条件 | 原因文案 |
| --- | --- | --- |
| 文本 diff | 二进制 | 二进制文件，不显示文本差异 |
| 加载全部 | 无后续分段 | 已显示全部内容 |
| 查看内容 | 忽略规则文件 | 忽略规则内的文件，不显示内容 |
| 选择文件（TD04） | 快照过期 | 变更快照已过期，重新读取后再选择 |

**状态 id**：`td03-changes`（任务变更模式主态）、`td03-excluded`、`td03-large-binary`、`td03-leave-context`、`td03-loading`、`td03-read-error`。

### TD04 Git 交付动作与回执（修改）

**宿主容器**：TD03 主区右侧 `.ns-col` 步骤栏（g42「下一步」）。顶部新增「完成目标」卡；下方依赖步骤卡 ①提交 ②推送 ③创建 MR（按目标显示所需步骤）；底部「交付状态」摘要（已成功步骤 / 等待的步骤 / 任务是否已交付，由服务读回）。确认沿原对话框。

**入口与返回**：从 TD03 同页进入；对话框关闭后焦点与选中文件、diff 滚动位置还原；`td04-delivered` 卡上「返回任务」→ task.html（兜底 `td02-delivered`）、「查看 MR」→ `td07-mr-detail&from=git&fromState=td04-delivered`、「工作区详情」→ `task.html?state=td06-detail-git&from=git&fromState=td04-delivered`。

**交互步骤**

1. 选完成目标（`td04-goal`）：「仅本地提交」「提交并推送」「提交、推送并创建 MR」三选一。这是依赖完整的目标，不是自动授权三步；选择被记录为交付选择。
2. 勾选整文件、编辑提交信息；作者来自 设置 → Git 账号（只读）；显示已选数量、未选文件与完成后保留内容。
3. 点「提交…」→ 确认对话框（`td04-commit-confirm`）：目标分支、文件数 A/M/D、未选文件保留、验证摘要；失败候选时仅在原 authority 许可下显示知情确认。
4. 结果分支：文件版本已变化 → `td04-commit-drift`（保留信息与选择草稿，提示复核）；hook 拒绝 → `td04-hook-rejected`（脱敏输出，「修改后重新提交」）；成功且目标为仅提交 → `td04-commit-only-done`；成功且目标含推送 → `td04-committed-wait-push`，**不自动推送**。
5. 推送卡：点「预览推送」读远端；远端同名 → `td04-push-exists`（填新名字，重新预览）；未认证 / 账户用途不足 → `td04-push-auth`（「查看 Git 设置」）；预览通过 → `td04-push-confirm` 对话框。
6. 推送结果：明确失败且证明无副作用 → `td04-push-failed`（可发新请求，需重新确认）；回执未知 → `td04-push-unknown`（只「核对原推送」，MR 步骤锁定）；成功 → 若目标含 MR，解锁 ③。
7. MR 卡：表单 → `td04-mr-confirm`；目标前移 / 源变化 → `td04-target-drift`（重读后重新确认）；已有合法原 MR → `td04-mr-exists`（显示原链接，不重建）；回执未知 → `td04-mr-unknown`（不重复 POST）。
8. 服务读回所选目标全部成功 → `td04-delivered`「任务已交付」：真实验证状态、提交 SHA、远端 ref、MR 链接、残留文件；MR 合并另在 GitLab 进行。
9. 未完成时改目标 → `td04-goal-change`：说明已发生动作保留、不撤销、不删远端，需显式确认；该能力 API 未冻结，原型标候选。

**字段**

| 步骤 | 字段 |
| --- | --- |
| 提交 | 已选文件（数量 / A/M/D）、提交信息、可信作者、任务分支、基线、变更版本 `cr-7`、验证摘要、失败知情确认（仅有权限时） |
| 推送 | 源提交 SHA `9d8c7b6`、账户 / 服务器公开名称、精确项目 / remote `shop/order-service`、新远端分支 `task/T-2041-refund-export`、连接版本、「新建远端分支 · 不强推 · 不覆盖」 |
| MR | 实际已推送源分支 / SHA、目标分支 `main`、核对后的目标 tip 与读取时间、标题（≤255 字符计数）、说明；评审人行显示「当前未接通」不可选 |
| 完成卡 | 任务已交付时间、验证状态、提交 SHA、远端 ref、MR `!58` 链接与读取时间、未选残留文件数、MR 状态（独立事实） |

**禁用条件**

| 控件 | 条件 | 原因文案 |
| --- | --- | --- |
| 提交… | 未选文件 | 至少选择 1 个文件 |
| 提交… | 交付受阻 / 快照过期 | 变更快照已过期，重新读取后再提交 |
| 提交… | 失败候选未获许可 | 验证未通过，当前验收规则不允许提交 |
| ② 推送 | 提交未成功 | 先完成 ① 提交 |
| ② 推送 | 提交回执未知 | 提交结果核对前不能推送 |
| 预览推送 | GitLab 未配置 / 未认证 | 没有可用的 Git 连接，查看 Git 设置；提交保留在本地 |
| 确认推送 | 新分支名未重新预览 | 新分支名需要重新预览后才能推送 |
| ③ 创建 MR | 推送未成功 / 未知 | 先完成 ② 推送 / 推送结果核对前不能创建 MR |
| 创建 MR | 目标 tip 未核对 / 已漂移 | 目标分支已前移，重新读取并确认 |
| 创建 MR | 标题超 255 字符 | 标题最多 255 个字符 |
| 评审人 | 始终 | 指派评审人当前未接通 |
| 合并 | 不提供按钮 | 合并在 GitLab 中进行，产品内合并未提供 |

**状态 id**：`td04-goal`、`td04-commit-confirm`、`td04-commit-drift`、`td04-hook-rejected`、`td04-commit-only-done`、`td04-committed-wait-push`、`td04-push-confirm`、`td04-push-exists`、`td04-push-auth`、`td04-push-failed`、`td04-push-unknown`、`td04-mr-confirm`、`td04-target-drift`、`td04-mr-exists`、`td04-mr-unknown`、`td04-delivered`、`td04-goal-change`。

### TD05 非 Git 应用与三方冲突（新增交互视图）

**宿主容器**：TD02 任务交付面板 →「全宽查看」。外壳沿 `task.html` 的 `.canvas-bar` + `#situ`，画布区让位给应用视图；面包屑「任务列表 / 月报改为按自然月汇总 / 应用到原项目」。不设一级菜单。不出现 Git 图标、提交、SHA、MR 选项。

**入口与返回**：TD02「查看变更并交付」→ `apply.html?state=td05-overview&from=task&fromState=<当前>`；「返回任务」→ `TD.backHref('td02-awaiting')`；完成后兜底回 `td02-delivered`；「工作区详情」→ `task.html?state=td06-detail-nongit&from=apply&fromState=<当前>`。

**复用**：文件列表 / 树、`diffView`（统一 / 并排）、`.stages` 步骤条、`.banner`、`.dialog`、A/M/D 徽标、g57 未知样式。**新增**：三方标签图例、三方上下文切换、逐项冲突处理单选、逐项结果表。

**交互步骤**

1. 选择变更（`td05-overview`）：变更清单可勾选，显示 A/M/D；未选文件写明「留在独立副本」。
2. 「检查当前原目录」（`td05-checking`）：只读，不写文件。
3. 预览逐项结果：无冲突项显示将新增 / 替换 / 删除的准确路径（`td05-preview`）。
4. 处理冲突（`td05-conflicts`）：逐项选「保留当前原文件」「采用任务版本（需再确认）」「我已手动解决，重新检查」「暂不交付该项」；文本可看基线 / 任务副本 / 当前原目录三方（`td05-conflict-text`）；二进制 / 链接只显示身份与大小，只能选择或不可用（`td05-conflict-binary`）。
5. 「重新检查并冻结预览」（`td05-recheck`）：冲突全部有处理结果后才可用。
6. 「确认应用」→ 对话框（`td05-apply-confirm`）。
7. 原目录在确认后又变化 → 对应项阻塞并要求重读（`td05-drift`），已成功项不重做。
8. 部分成功 / 中断 → 逐项原操作结果（`td05-partial`）；待核实项「核对原操作」（`td05-unknown`）；不整批重拷、不自动回滚用户后续编辑。
9. 全部所选有效项可信成功 → 服务结算 `td05-applied`「任务已交付」。

**三方标签（固定）**：基线（快照 10-15 09:40）｜任务副本｜当前原目录（检查于 16:05）。不用「本地 / 远端」。

**冲突类型（至少六类）**：原文件与任务都修改（`report/monthly.py`）；任务新增路径原目录已出现（`report/calendar_util.py`）；任务删除而原文件已修改（`report/legacy_week.py`）；原文件被删而任务继续改（`config/report.yaml`）；目录 / 文件类型冲突（`exports`）；不支持的二进制或链接（`assets/logo.png`）。

**字段**：原项目显示路径；基线快照时间 / 范围 / 版本；任务副本路径；A/M/D；所选文件；原目录检查时间；可应用 / 冲突 / 不支持计数；应用确认对话框：本次 A/M/D 数、已解决冲突数、原目录、不会改动的无关文件、备份 / 恢复证据摘要（**仅服务真实提供才显示**，否则不显示该行）；结果表：已应用 / 被阻塞（原目录又变化）/ 待核实 / 未执行。涉及必需产物的排除显示服务判定说明。

**禁用条件**

| 控件 | 条件 | 原因文案 |
| --- | --- | --- |
| 检查当前原目录 | 未选任何变更 | 至少选择 1 个变更 |
| 重新检查并冻结预览 | 有未处理冲突 | 还有 N 个冲突没有处理 |
| 采用任务版本 | 未二次确认 | 将替换当前原文件，需要再确认一次 |
| 合并文本（不提供） | 二进制 / 链接 | 二进制或链接不能按文本合并，只能选择保留或采用 |
| 确认应用 | 预览未冻结 / 已过期 | 预览已过期，重新检查后再确认 |
| 确认应用 | 原目录不可读 | 原目录不可读或没有权限，候选文件与副本已保留 |
| 一键覆盖整个项目 | 不提供 | — |
| 已应用项 | 再次应用 | 该项已应用成功，不会重做 |

**状态 id**：`td05-overview`、`td05-checking`、`td05-preview`、`td05-conflicts`、`td05-conflict-text`、`td05-conflict-binary`、`td05-recheck`、`td05-apply-confirm`、`td05-drift`、`td05-partial`、`td05-unknown`、`td05-applied`、`td05-read-error`。

### TD06 工作区保全与清理（修改 / 扩充）

**宿主容器**：`task.html` · 右侧抽屉 `aside.drawer`（520）· 对话框 `.dialog[role=alertdialog]`；语义复用 g58。

**入口与返回**：TD02 面板「工作区详情」（同页）；`td04-delivered` 与 TD03 上下文条（`from=git`）；TD05（`from=apply`）；关闭 / 取消任务 → `td06-close-retain` 提示。关闭抽屉焦点回到触发按钮；`from` 为 git / apply 时抽屉头显示「返回 Git 任务变更 / 返回应用视图」，回到 `fromState`。

**交互步骤**

1. 打开详情抽屉（`td06-detail-git` / `td06-detail-nongit`），只读；显示路径可复制，不可编辑。
2. 关闭 / 取消任务时提示「文件保留，可稍后交付 / 查看」（`td06-close-retain`），不强迫清理。
3. 点「清理工作区…」→ 读取清理预览（`td06-cleanup-preview`）：删除对象 / 保留对象 / 未交付数量。
4. 有未交付内容：默认保留；定向丢弃需额外知情确认（`td06-cleanup-undelivered`）。
5. 存在运行写、未停稳、UNKNOWN、内容漂移或恢复依赖：阻塞并链接到原因位置（`td06-cleanup-blocked`）。
6. 确认清理；部分清理或失联 → 显示原步骤与「核对原操作」（`td06-cleanup-partial`），不再发同一删除。
7. 清理完成（`td06-cleaned`）：交付回执仍可读；diff 处显示「工作区已清理，可查看提交 / 保存证据」。

**字段**：工作区类型 / 公开身份、原项目、基线、任务目录 / 分支、创建 / 最后检查时间、活动写入、未交付 / 未选变化、未决原请求、已交付凭证、清理可用性及原因、容量（未知则显示「未知」）；非 Git 加基线快照与副本保留说明。删除对象（Git）：本地任务分支、worktree 目录、任务内部缓存。保留对象：原项目、远端分支、MR、提交、全部回执与验证记录；非 Git：原目录（从不在清理对象中）、基线快照是否保留由服务说明。

**禁用条件**

| 控件 | 条件 | 原因文案 |
| --- | --- | --- |
| 在文件管理器显示 | 宿主未提供能力 | 当前环境不支持在文件管理器中显示 |
| 清理工作区… | 运行写 / 未停稳 | 「编写测试」仍在写入，停稳后才能清理 |
| 清理工作区… | 未决 UNKNOWN | 推送结果待核对，核对完成前不能清理 |
| 清理工作区… | 恢复依赖 / 唯一产物 | 恢复仍需要这份副本，不提供删除 |
| 确认清理 | 未勾选未交付知情 | 还有 N 个未交付文件，确认丢弃后才能清理 |
| 确认清理 | 预览已过期 | 工作区已变化，重新读取清理预览 |

**状态 id**：`td06-detail-git`、`td06-detail-nongit`、`td06-close-retain`、`td06-cleanup-preview`、`td06-cleanup-undelivered`、`td06-cleanup-blocked`、`td06-cleanup-partial`、`td06-cleaned`。

### TD07 MR 任务来源与交付结果（修改）

**宿主容器**：Git 工作台 · 左栏「合并请求」→ `mrView`：`.mr-row` 列表增「来源任务」列；`.mr-d` 详情卡增来源任务 chip 与两条独立事实。

**入口与返回**：`td04-delivered`「查看 MR」或 `td02-delivered`「查看 MR !58」进入（带 from / fromState）；来源任务 chip / 「返回任务」→ task.html（兜底 `td02-delivered`）；「在 GitLab 打开」为外部链接，地址来自可信读口，过期 / 不可用时可复制或刷新。

**交互步骤**：1. 列表只读，「刷新」只是重读；2. 打开详情看「该任务已交付（10-15 16:20）」与「MR 未合并 / 已关闭」两条事实；3. 合并只能「在 GitLab 打开」；4. MR 后来关闭（`td07-mr-closed-later`）不重开任务、不改写交付历史；之后的新修改应形成新任务或合法新交付版本。

**禁用条件**：产品内合并不提供（文案「合并在 GitLab 中进行，产品内合并未提供」）；外部链接不可用时「在 GitLab 打开」禁用，原因「GitLab 地址暂不可用，可复制 MR 编号或刷新」。

**状态 id**：`td07-mr-detail`、`td07-mr-list`、`td07-mr-closed-later`。

## 5. 已确认规则与可见位置

| # | 规则（DESIGN-REQUIREMENTS §1） | 设计中可见位置 |
| --- | --- | --- |
| R1 | 需求 → 计划确认 → 隔离执行 → 原节点验收 → 查看变更 → 选择交付 → 逐步确认 → 所选动作全部成功 → 任务完成；不能把任务建立 / 执行结束 / 模型回复 / 进程退出 / 已提交请求当交付完成 | `td01-git-plan` 接下来轨道；`td02-awaiting` 徽标；`td02-step-committed`；`td04-delivered` 由服务读回 |
| R2 | Git 每个新任务独立任务分支 + worktree；原工作区文件 / index / 分支 / 未提交修改保持 | `td01-git-plan`、`td01-ready`、`td02-running` 工作区 chip、TD03 上下文条 |
| R3 | 基线与目录准备在首个可写节点派发前完成；草稿不等于已执行 | `td01-ready`、`td01-combined` 说明行、「开始执行」禁用原因 |
| R4 | 非 Git：基线快照 + 独立副本，称「独立副本」，不 git init；范围 / 排除 / 未复制资源可见 | `td01-nongit-plan`、`td06-detail-nongit`、TD05 页头 |
| R5 | 非 Git 逐项应用、先解冲突、不覆盖全目录 | `td05-conflicts`、`td05-recheck`、无「全部覆盖」 |
| R6 | 三个完成目标是依赖完整的目标选择，不自动授权；每个副作用独立确认；前一步成功只记已成功 | `td04-goal`、各 confirm 状态、`td04-committed-wait-push`、`td02-step-committed` |
| R7 | MR 创建可信成功即满足所选交付，不等 merge；不提供产品内合并；MR 后来关闭不改历史 | `td04-delivered`、`td02-delivered`、`td07-mr-detail`、`td07-mr-closed-later` |
| R8 | 不同任务隔离仍可能最终冲突；同任务并行写子隔离汇合或串行，由调度执行 | `td02-parallel`、`td01-git-plan` 并行写策略行 |
| R9 | 退出 / 失败 / 取消 / UNKNOWN / MR 创建均不自动清理；清理独立、显式、核实；不删原项目 / 远端 / 回执；完成 ≠ 已清理 | `td02-cancelled-retained`、`td06-close-retain`、`td06-cleanup-preview`、`td06-cleaned` |
| R10 | 原验收 / 失败证据保留；C33 失败候选不泛化；「已交付，验证未通过」与全部通过分开，由 authority 许可 | `td02-failed-candidate`、`td02-delivered-verify-failed` |
| R11 | UNKNOWN 只核对原操作，不重发；读失败可重读 | `td01-prepare-unknown`、`td04-push-unknown`、`td04-mr-unknown`、`td05-unknown`、`td06-cleanup-partial`、`td03-read-error` |
| R12 | 无变更不产生空提交 / 假 MR | `td02-no-changes` |
| R13 | 版本漂移必须重读重确认，不静默采用新版 | `td01-baseline-drift`、`td04-commit-drift`、`td04-target-drift`、`td05-drift` |

## 6. 待冻结策略（设计不作决定）

下表是本设计**刻意不决定**的项。原型对这些项只展示候选形态并标「待冻结」，不能视为已确认授权。

| # | 待冻结项 | 设计当前怎么处理 | 涉及状态 | 决定方 |
| --- | --- | --- | --- | --- |
| P1 | 无变更结算（「确认无文件交付并结束」） | 按钮存在但禁用，标「候选」 | `td02-no-changes` | 产品 + API / 任务 owner |
| P2 | 未完成时改变交付目标 | 只展示说明与确认框形态，标「API 未冻结」；已发生动作不撤销 | `td04-goal-change` | 任务交付 writer + API owner |
| P3 | 子集交付对必需产物的影响 | 只显示「服务判定说明」占位，不自动缩小成果范围 | `td04-commit-confirm`、`td05-conflicts`、`td05-apply-confirm` | 任务 / 执行 owner |
| P4 | 「准备独立工作区 → 开始执行」两步 vs「准备并开始」 | 两套文案都画，不混用 | `td01-git-plan`、`td01-combined` | 候选 API 评审 |
| P5 | 待交付阶段的 ExecutionStatus 映射（active + reason 或其他既有合法值） | UI 只读派生原因显示「执行已结束 · 等待交付」 | `td02-awaiting` 等 | 状态 owner |
| P6 | C33 失败候选的交付资格 | 只按 authority 返回的许可显示知情确认；否则禁用 | `td02-failed-candidate`、`td02-delivered-verify-failed` | 原证据 authority |
| P7 | 清理后是否保留非 Git 基线快照 | 保留对象中写「由服务说明」 | `td06-detail-nongit`、`td06-cleanup-preview` | 宿主 + 目录适配 |
| P8 | 非 Git 应用的备份 / 恢复证据 | 仅服务真实提供才显示该行 | `td05-apply-confirm` | 目录适配 |
| P9 | 评审人指派 | 显示「当前未接通」，不可选 | `td04-mr-confirm` | Git / GitLab owner |
| P10 | 外部 GitLab URL 来源 | 只用可信读口返回的地址；不可用时禁用并可复制 | `td04-delivered`、`td07-*` | Git owner |
| P11 | 并行子工作区的汇合策略 | 只展示服务给出的策略与阻塞 | `td02-parallel` | 调度 owner |
| P12 | 工作区物理准备的精确时点（草稿 / 计划确认 / 开始 / 首个写节点前） | 设计放在计划确认之后；文案不暗示「形成草稿即已执行」 | `td01-*` | API + 任务 owner |

另外发现、同样不由设计决定的项：

| # | 待冻结项 | 说明 |
| --- | --- | --- |
| P13 | 分支 / 目录同名冲突的解决方式 | 服务换建议名后重新确认，还是用户改名；设计只显示占用对象并保留草稿 |
| P14 | 取消后「稍后交付」的结算语义 | 取消是终态时再交付如何记完成；设计只保留文件与入口 |
| P15 | 「有未交付内容可额外知情丢弃」与「清理不能销毁唯一未交付产物」的边界 | DESIGN-REQUIREMENTS §7 与 API-STATE §5.6 表述有张力；设计对恢复依赖 / 必需产物不提供删除，其余未交付内容需额外确认 |
| P16 | 推送新分支名由谁建议 | 设计给系统建议值 `-2` 并允许编辑，需重新预览 |

## 7. 状态覆盖缺口（注册表未单列，不新增 id）

| 缺口 | 设计处理 |
| --- | --- |
| 提交回执 UNKNOWN（需求要求「仅核对原提交」） | 注册表无 `td04-commit-unknown`；按 `td04-push-unknown` 同一结构处理：原 key、「核对原操作」、推送锁定 |
| TD07 读取失败 / GitLab 未配置 | 沿原 g23 / g21 表现：保留已加载内容，「重新读取」；去设置 |
| 提交明确失败（非 hook，如权限） | 沿 `td04-hook-rejected` 卡片结构，原因按业务类显示 |
| TD06 抽屉自身的读取失败 | 沿 `td03-read-error`：保留上次读取时间，「重新读取」 |
