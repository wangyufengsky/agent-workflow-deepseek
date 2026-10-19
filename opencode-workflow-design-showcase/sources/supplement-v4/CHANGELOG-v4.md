# 补稿 v4 · 变更清单（2026-10-16）

合集版本：**v3 → v4**（`opencode-workflow-design-showcase`）。修改前的原文件逐个备份在合集 `backup-v3-before-v4/`（同路径）。源设计包原件（TD、节点、Git、规划需求包）未改。

## 新增文件（7）

| 文件 | 作用 |
|---|---|
| `originals/planning/assets/ut-fixtures.js` | 统一身份样例：新增同构任务名词、旧需求 / 旧任务身份、固定模板（引用 / 修订 / 步骤 / 参数）、准备事实与样例结果 |
| `originals/planning/assets/prep-area.js` | 需求画布“工作区”页签：复用 TD01 全部准备状态与动作 |
| `originals/planning/assets/prep.css` | 工作区页签样式（由 TD01 start.css 按 `.pw` 作用域复制） |
| `originals/delivery/assets/task-registry.js` | 统一任务画布的身份注册表（规划 / 旧任务 / TD / 固定模板 / 旧版记录） |
| `originals/delivery/assets/td-states-v4.js` | 统一任务画布新增 20 个 UT 状态（追加进同一注册表） |
| `originals/delivery/assets/task-v4.css` | 统一任务画布新增样式（来源 chip、锁 / 差异标记、调整面板、快照评审面板、页头压缩） |
| `evidence/supplement-v4/*`、`sources/supplement-v4/*` | 测试报告、截图与补稿文档副本 |

## 修改文件（18 + 说明文件）

| 文件 | 改动 |
|---|---|
| `originals/delivery/task.html` | 加载 v4 脚本与样式；标题改“任务画布” |
| `originals/delivery/assets/task.js` | 统一任务画布：按 `?task=` 读身份；调整待执行计划（原模式捕获 / 恢复、编辑、冲突、重新确认、继续 / 结束调整、放弃）；真实自动推进开关、整体推进与推进直接后继；暂停 / 恢复；等待审批、停滞、失败与恢复面板、待人工验收、状态待核对、旧版记录；固定模板锁；快照评审面板；节点往返恢复面板与页签；原 TD02 / TD06 行为保留 |
| `originals/planning/requirement.html` | 加载 ut-fixtures / prep-area / prep.css |
| `originals/planning/assets/requirement.js` | 真实身份解析（旧需求、固定模板）；确认后“工作区”页签；FX01 固定模板确认；业务问题组件（PE11 / PE25）与输入修订、候选重新校验、修改答复；风险勾选去掉业务问题；从按钮进入时服务事件按样例时间线到达（不靠底部模拟按钮）；开始执行与“打开任务画布”进统一任务画布 |
| `originals/planning/assets/pe-states.js` | 新增 12 个状态；PE32 / PE33 / PE36 标注 v4 去向 |
| `originals/planning/assets/pe-nav.js` | 接受 originals 相对路径作为返回地址 |
| `originals/planning/index.html` | 状态总览说明改为 v4 |
| `originals/main/pages/tasks.html` | 每行带真实身份并打开统一视图；新增准备样例行、固定模板 r5 行、T-2004 行；样例一致化（T-2030 已暂停、T-2027 已确认待开始） |
| `originals/main/pages/requirements.html` | 旧行与新行都带身份路由；新增 4 个项目、7 行；无身份时不再进旧画布 |
| `originals/main/pages/inbox.html` | 事项“在任务画布中查看”带身份与选中步骤；规划事项改“业务问题”，新增“待准备工作区” |
| `originals/main/pages/home.html` | “进行中”赔付单进统一任务画布；文案“业务问题” |
| `originals/main/pages/templates.html` | 所有模板创建后同一规则（待确认计划 → 打开任务）；按钮改“创建模板任务” |
| `originals/main/pages/recovery.html` | 接受任务身份与返回地址 |
| `originals/node/assets/node-detail.js` | 接受 n6+ 的步骤号（标题覆盖） |
| `showcase/navigation.js` | 旧任务画布 / 规划任务画布深链迁入统一画布（保持身份，`archive=1` 看原稿）；节点详情往返带面板与页签 |
| `showcase/bridge.js` | 节点点击直达详情只用于执行中 / 已完成且非“面板优先”状态；原稿留档提示 |
| `showcase/bridge.css` | 原稿留档提示样式；审阅模式下底部原型控制条不再盖住页面底部 |
| `showcase/catalog.js` | 新增“补稿 v4”三组目录；原稿留档条目带 `archive=1`；移除规划任务画布正式条目 |
| `README.md`、`sources.html`、`sources/manifest.json` | v4 一节、来源登记 |

## 行为变化摘要

- 任务列表、需求目录、待处理、主页、模板任务的所有行都进新版视图，带真实身份；旧画布只在原型目录留档。
- 确认计划后在同一需求画布准备工作区；全部异常准备状态都能从正常入口到达。
- 固定模板：创建 → 确认 → 准备 → 开始全程可点，锁持续。
- “继续执行”恢复调整前的原模式；原暂停只“结束调整”。
- 业务问题必须明确回答；风险勾选只剩不改业务范围的 2 项。
- 规划主线不再依赖底部“模拟服务事件”。
