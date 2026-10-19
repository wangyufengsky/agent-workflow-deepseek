# 补稿 v5 · 变更清单（2026-10-16）

合集版本：**v4 → v5**（`opencode-workflow-design-showcase`）。修改前的原文件逐个备份在合集 `backup-v4-before-v5/`（同路径）。源设计包原件未改；v4 补稿目录未改。

## 新增文件

| 文件 | 作用 |
|---|---|
| `evidence/supplement-v5/*` | 测试结果与截图 |
| `sources/supplement-v5/*` | 补稿 v5 文档副本 |

没有新增页面或脚本；所有改动在已有文件里。

## 修改文件（9 + 说明文件 3）

| 文件 | 改动 |
|---|---|
| `originals/planning/assets/pe-fixtures.js` | T-2060 大需求：需求原文与 11 条需求、3 个未细化组的细化结果、分组画布函数（已细化 / 候选 / 规划中）、全部细化后的任务身份（18 步，n1–n18） |
| `originals/planning/assets/requirement.js` | PE37 正式路径：继续规划选区（新一轮预览）、LG-PLANNING、LG-CAND、应用 / 不采用 / 停止、全部细化后确认 → 工作区 → 开始；T-2060 确认后的计划视图与 B08；规划依据链接到目录（带 `back`） |
| `originals/planning/assets/pe-states.js` | PE37 改为正式路径；新增 LG-PLANNING、LG-CAND（共 64 个） |
| `originals/planning/index.html` | 状态总览说明增加 v5 |
| `originals/delivery/assets/task-registry.js` | 新增任务身份 T-2060（18 步，执行时刻与 B08 一致，可调整待执行计划） |
| `originals/main/pages/roles.html` | 新增“需求分析师（规划职责）”与只读详情状态 `planning-role` |
| `originals/main/pages/workflows.html` | 新增“需求开发 r12”“缺陷修复 r4”（AI 规划标记）与“AI 规划 · 只读”一节、状态 `detail-planning` |
| `originals/main/pages/inbox.html` | 规划事项补齐为与任务列表“需要处理”同一口径（13 项），标题写明口径 |
| `showcase/catalog.js` | 新增“补稿 v5 · 大需求分组细化与规划职责”组（9 个入口） |
| `README.md`、`sources.html`、`sources/manifest.json` | v5 一节、来源登记 |

## 行为变化摘要

- PE37 不再是“设计候选 · 后续分期”：可以按组逐轮细化，全部细化后确认、准备、开始执行。
- 已细化的组不先执行；每次继续规划选区是新的一轮，各有 1 次修订机会。
- 角色管理、流程目录可以只读查看规划职责与规划策略；需求画布里的摘要能点进去并返回。
- 待处理“规划事项”与任务列表“需要处理”数量一致；不新增任何提醒。
- PE38、PE28 保持禁用。
