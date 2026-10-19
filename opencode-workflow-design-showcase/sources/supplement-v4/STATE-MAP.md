# 补稿 v4 · 状态与跳转映射（旧入口 → 新版统一视图）

> 设计样例 · 全部模拟。原则（C01）：**正常菜单与列表只进新版视图**；每个入口显式带真实任务身份（`?task=`），不统一跳成样例 T-2051、T-2041 或空草稿。旧画布只留在原型目录“原稿留档”（链接带 `archive=1`），页面右下角提示“原稿留档 · 在新版中打开”。
> 实现：`showcase/navigation.js` 的 `LEGACY_TASK` / `LEGACY_REQ` / `PLAN_TASK` / `legacyTarget()`；列表行的身份写在各列表页数据里。

## 1. 正常入口 → 统一视图（带真实身份）

| 入口 | 行 / 事项 | 身份 | 打开 | 说明 |
|---|---|---|---|---|
| 任务列表 | 优惠券过期提醒 | T-2042 | `delivery/task.html?state=td02-running` | TD 样例，同一画布 |
| 任务列表 | 退款单分页查询与导出 | T-2041 | `td02-awaiting` | Git 交付入口 |
| 任务列表 | 月报改为按自然月汇总 | T-2043 | `td02-awaiting&kind=dir` | 非 Git 交付入口 |
| 任务列表 / 需求目录 / 主页 | 退款单… / 退货单… / 售后单… / 换货单… / 补发单… / 会员积分… | T-2051 / 2055 / 2054 / 2056 / 2057 / 2060 | `planning/requirement.html` PE15 / PE11 / PE25 / PE19 / PE21 / PE37 | 规划中的任务（v3 已有） |
| 任务列表 / 需求目录 / 待处理 | 工单… | T-2062 | `planning/requirement.html?state=pe32&tab=ws` | 准备回执未知样例 |
| 任务列表 / 需求目录 | 发票… / 对账单… / 积分单… / 支付单… / 通知单… | T-2063 / 2064 / 2065 / 2066 / 2067 | 同上 | 部分创建 / 非 Git / 同名冲突 / 无读取权限 / 空仓库 |
| 任务列表 / 需求目录 | 接口文档整理与变更说明（旧需求 rq-2027，已确认待开始） | T-2027 | 同上 | 基线前移样例；旧需求身份保留 |
| 需求目录 | 项目配置入口整合（旧需求 rq-2041，规划中） | T-2046 | `planning/requirement.html?state=pe31` | 旧版流程计划草稿，确认 → 准备 → 开始 |
| 任务列表 / 需求目录 / 主页 | 赔付单… | T-2050 | `delivery/task.html?state=ut-running-mid` | 规划任务执行中（原 planning/task PE33） |
| 任务列表 / 模板任务 | 单元测试开发 r7 / 详细设计编写 r5（及其他 4 个模板创建后） | T-2070 / 2071（2072–2075） | `planning/requirement.html?state=fx01&tpl=…` | 固定模板确认 → 准备 → 开始 |
| 任务列表 / 需求目录 | 登录页偶发 500 错误修复 | T-2038 | `ut-stalled` | 旧任务迁入 |
| 任务列表 / 需求目录 / 待处理 | 订单服务单元测试补齐 | T-2030 | `ut-paused`（待处理带 `selectedNode=n2`） | 原暂停样例 |
| 任务列表 / 需求目录 | 退款对账脚本重写… | T-2004 | `ut-failed` | 失败与恢复（任务列表新增此行，原只在需求目录） |
| 任务列表 / 需求目录 | 任务执行结果的状态反馈 | T-2035 | `ut-auto-off` | 原自动关闭样例 |
| 任务列表 | 本周代码质量分析报告（模板任务） | T-2003 | `ut-fixed-snapshot` | 快照评审运行面板 |
| 任务列表 | 导出任务报告的异常恢复 | T-1998 | `ut-unknown` | |
| 任务列表 / 需求目录 | 任务筛选条件的地址同步 / 需求说明文档生成 / 客服工单导出改为异步 / 项目公约文档补充 | T-2019 / 1975 / 1996 / 1990 | `ut-legacy-done` | 旧版记录（无工作区与交付端点） |
| 任务列表 / 需求目录 | 旧版报表接口迁移 | T-2011 | `ut-legacy-stopped` | |
| 待处理中心 | 登录页偶发 500 · 实施修复（权限） | T-2038 | `ut-stalled&selectedNode=n2` | |
| 统一任务画布 · 更多 | 任务恢复… | 当前任务 | `main/pages/recovery.html?task=…&taskTitle=…&returnTo=…` | 恢复页“返回原任务”回到同一任务 |

样例数据一致化（只改样例，不改设计）：任务列表 T-2030 原写“失败”、需求目录写“已暂停”，两处冲突；v4 以需求目录为准（已暂停），失败样例改由 T-2004 承担并补进任务列表。任务列表 T-2027 原写“计划待确认：2 个候选计划”，与需求目录“已确认 · 待开始”冲突；v4 以需求目录为准。

## 2. 旧任务画布 `main/pages/task.html?state=` → 统一任务画布（无身份深链用原稿样例身份）

| 旧状态 | 新状态 | 身份 | 旧状态 | 新状态 | 身份 |
|---|---|---|---|---|---|
| running | ut-running-mid | T-2044 | claim-race | ut-adj-conflict | T-2044 |
| auto-off | ut-advance | T-2035 | unknown | ut-unknown | T-2044 |
| waiting | ut-waiting | T-2044 | template | ut-fixed-running | T-2003 |
| stalled | ut-stalled | T-2044 | snap-full / snap-light | ut-fixed-snapshot（snap=progress / light） | T-2008 |
| failed | ut-failed | T-2044 | snap-batches(-loading/-empty/-error) | ut-fixed-snapshot（snap=batches…） | T-2008 |
| recovering | ut-recovering | T-2044 | snap-report(-loading/-read/-error) | ut-fixed-snapshot（snap=report…） | T-2008 |
| review | ut-review | T-2044 | snap-cancelled | ut-fixed-snapshot（snap=cancelled） | T-2008 |
| completed | ut-legacy-done | T-2019 | | | |

T-2044 = 原任务画布自己的样例任务“让项目配置更容易找到，减少切换页面的次数。”（项目 opencode-workflow 控制台，与独立恢复页同一身份）。v3 的旧映射 `completed → td02-delivered`、`failed → td02-failed-candidate`（换成 T-2041）已撤销。

## 3. 规划任务画布 v3 `planning/task.html?state=` → 统一视图

| 旧 | 新 | 说明 |
|---|---|---|
| PE33（sub=running） | `delivery/task.html?state=ut-running-mid&task=T-2050` | |
| PE33（sub=pausing） | `ut-adj-pausing` | |
| PE34 | `ut-adj-conflict` | 领取竞态 |
| PE35 | `ut-adj-reconfirm` | |
| PE36 | `planning/requirement.html?state=fx01&task=T-2070&tpl=ut` | 固定模板确认改在需求画布，之后准备与开始 |
| PE38 | 仍在 `planning/task.html`（后续分期） | 不迁移、不开放 |

## 4. 旧需求画布 `main/pages/requirement.html?state=`（只从原型目录 / 原稿索引进入）

旧需求画布不再是任何正常入口的目标；留档页右下角提示给出对应新状态（以同构样例呈现）：

questions → PE11 · planning → PE07 · candidates → PE25 · ready / dirty → PE31 · unbound → PE27 · unknown → B05 · conflict → PE29 · confirmed → PE32 · pl-config → PE03 · pl-rounds → PE30 · pl-stop-unknown → PE21 · pl-stopping → PE19 · pl-package / pl-package-noproof → B08（工作包归执行侧） · pl-map-ok / pl-precheck / pl-apply-confirm / pl-reject-confirm → PE25 · pl-map-bad → PE27 · pl-applied → PE31 · pl-unavailable → B04 · pl-conflict → PE29 · pl-loading → B01 · pl-error → B02 · pl-empty → PE02。

无 state 的旧链接 `main/pages/requirement.html` → 新开始页 PE01（不再落到 T-2051 空草稿）。

## 5. 往返与返回上下文

| 往返 | 去 | 回 | 恢复 |
|---|---|---|---|
| 统一任务画布 → 节点详情 | `node/index.html?returnTo=…` | “返回任务画布” | 同任务、选中步骤、右侧面板（node / delivery）与页签、画布视角（`selectedNode` `sidePanel` `sideTab` `canvasView`） |
| 需求画布 B08 → 查看工作包 | 节点详情 | “返回需求画布” | 同任务、`sel`、`tab`、`view` |
| 统一任务画布 ↔ 需求画布 | “在需求画布查看” → B08（带 `at` 执行时刻与 `returnTo`） | “打开任务画布” | 回到原任务画布 URL |
| 需求画布 → 开始执行 | `delivery/task.html?state=ut-running|ut-fixed-running&task=…&note=started` | 面包屑“任务列表”；更多“在需求画布查看” | — |
| 统一任务画布 → 任务恢复 | 独立恢复页（带身份与 returnTo） | “返回原任务” | 同任务 |
| 命令结果 | 调整、保存、确认、继续、推进、准备、核对 | 一律 replaceState | 浏览器后退 / 前进不重放命令 |
