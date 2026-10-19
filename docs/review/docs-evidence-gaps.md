# 文档与验证证据审查报告

> 审查日期：2026-10-19。范围：`README.md`、`docs/*.md`、`docs/evidence/`、`evidence/`、`release/`（只读）、`packages/shared/src/api/contracts.ts` 的 `ROUTES`、`packages/server/src` 实际注册路由、`apps/web/src` 接线、测试与日志。
> 证据来源：Lead 运行的 `npm test` → `.tmp/audit-test.log`；`npx tsc -p tsconfig.json --noEmit` → `.tmp/audit-typecheck.log`；用临时脚本导入 `ROUTES` 并扫描服务端 `app.get/post/patch/delete()` 做机器对比；`git log/show/diff`；抽查截图。
> 结论口径：✅ 有代码/测试/日志证据；⚠️ 部分成立或表述过期；❌ 与仓库现状不符。

## 1. 摘要（最严重 5 条）

1. **设计覆盖文档已丢失，现存文件是验证记录的旧副本。** `docs/design-coverage.md:1` 标题为「验证记录」，与 `docs/verification.md` 逐字一致，仅少第 89 轮一节（`diff -u docs/design-coverage.md docs/verification.md` 只输出末尾 +6 行）。覆盖发生在提交 `6411226`（2026-10-19 16:33，"editable role-model selection…docs"），该提交把 94 行的「设计稿覆盖矩阵」改成验证记录；此前最后可用版本在 `git show a206797:docs/design-coverage.md`（94 行、68 行表格、6 个章节）。README:106 仍把它引用为设计覆盖文档。**影响**：第 84 轮以后没有任何"设计稿页面/状态 ↔ 实现/后端"的覆盖对照；旧矩阵本身也已过时（例如称角色目录只读、非 Git 副本未实现、模型设置写入口未接通），不能原样恢复，必须重写。
2. **模板"可视化编辑器"不存在，但文档宣称缺口已关闭。** `docs/remaining-work.md:32` 写「可视化步骤增删/拖拽排序/类型/分组…缺口已关闭」，`docs/verification.md:47` 写「可视化编辑新版本」。实际 `apps/web/src/pages/templates/TemplatesPage.tsx:95-97` 只声明了 `visualEditor/visualError/dragIndex`，`:638` 只是 `setVisualEditor(...)`，全文件没有任何编辑器 JSX、`onDragStart/onDrop` 或提交新版本的调用；`dragIndex` 既未赋值也未读取。提交 `67b6ddb` 只加了一个按钮和两个 state，`091073c` 只加了 1 行未使用的 `dragIndex`。点击「可视化编辑」不会出现任何界面，模板只能"导入 + 编辑 JSON"。这是典型的「未完成却标 ✅」。
3. **三份状态文档停在三个轮次，互相打架。** README:110「截至第 15 轮」、README:111「296 条全绿」；`docs/remaining-work.md:3`「第 62 轮」；`docs/verification.md:331` 已写到第 89 轮；实际最新提交为 17:43（`fix(web): workflow page…`）。README:112 与 remaining-work 又把大量已完成能力列为"仍待完成"（详见 §2.1、§2.2）。
4. **`docs/verification.md` 的「已知限制」与正文自相矛盾，测试计数过期。** :264 说"真实 GitHub push / 创建 MR 未执行"，但 :82-93 §3.2 记录 GitHub 真实写 PASS；:266 说"`fix.merge` 未实现"，但 :134、`packages/server/src/review-plugin.ts:146` 与 `.tmp/audit-test.log:91` 都有证据；:267 说"FixRun start/stop requestKey 只存在内存"，但 :42 说"requestKey 保留"，代码 `packages/engine/src/fix.ts:76-77,293,386` 将 key 落入 settings，`tests/integration/review-fix-recovery.test.ts` 通过（audit-test.log:420）。:19 的 **313/302/24s** 对比实际 **316/305/68.4s**（audit-test.log:432-439）。
5. **api.md 与 ROUTES/服务端三方漂移。** `ROUTES` 有 3 个服务端从不注册的端点（`contracts.ts:1051 planEditAbandon`、`:1066 executionAdvance`、`:1088 gitMergeRequest`），而 `docs/api.md:1` 声称"实现以 ROUTES 为准"；反向地，ROUTES 缺 `/api/settings/git`（http.ts:750）、`DELETE /api/settings/databases/:id`（http.ts:719）、`/api/ppt/works/:id/pptx`（http.ts:568）、fix 的 diff/stop/commit/push/merge-request/discard/revert（review-plugin.ts:115-170）。api.md 还整类缺少 knowledge/ppt/insights/acceptance/recovery/catalog/templates/skills/fs-directories（grep 均为 0），:66「远端适配器待接线」也已过期。

## 2. 声明 vs 实际对照表

### 2.1 README.md

| 声明（file:line） | 实际 | 判定 |
| --- | --- | --- |
| README:110 "截至第 15 轮" | 仓库 101 个提交；verification 已记录到第 89 轮（:331）；最新提交 17:43 | ❌ 过时 |
| README:111 "离线测试 296 条全绿" | 316 tests / 305 pass / 11 skipped / 0 fail，68.4s（audit-test.log:432-439）；"全绿"忽略 11 skip | ❌ 数字与措辞均过时 |
| README:112 "真实远端写、模板编辑、知识库/PPT、用量质量…仍待完成" | GitHub 真实写 PASS（verification:82-93、remaining-work:16）；知识库/PPT/用量已实现并有 live 日志（.tmp/knowledge-ask-live2.log、ppt-live3.log）；模板导入/JSON 编辑已实现 | ❌ 多数已完成 |
| README:84 GitHub 真实写 PASS ↔ README:88 "真实远端写操作未执行" | 同一文档互斥；:88 与 :84 不能同时成立 | ❌ 自相矛盾 |
| README:96 "需求画布…视觉接线（进行中）" | `evidence/ui-*.png`（16:58）覆盖 `/`、`/tasks`、`/requirement/:id`、`/tasks/:id`、`/start`、`/git`、`/settings` 与 3 主题；`capture-ui.cjs:247-257` 断言通过 | ⚠️ 基本完成，表述停留在旧状态 |
| README:97 "GitHub/GitLab 令牌设置/加密保存、fetch/MR、AI 审查/修复的完整运行接线" | `GitSection.tsx`、`ReviewPanel.tsx`、`review-plugin.ts` 均已接线；设置截图 `settings-git-remote.png` 存在 | ⚠️ 已完成 |
| README:98 "非 Git 三方应用、工作区清理确认、恢复工作台" | 非 Git apply 通过（audit-test.log:387）、恢复工作台通过（:411）；**清理确认在 UI 无任何调用**（`grep -rn "workspace/cleanup" apps/web` 无结果），仅服务端 + 测试（:431） | ⚠️ 2/3 完成；清理 UI 是真缺口 |
| README:99 "打包后的 Electron 分发（签名、跨平台）" | `release/mac-arm64/Agent Workflow.app` 构建于 15:03、未签名；无 Windows/Linux 目标 | ✅ 仍是缺口 |
| README:106 引用 `docs/design-coverage.md` | 该文件内容是验证记录副本（§1.1） | ❌ 失效引用 |
| README:18 "13 工具"；:52 版本要求 | `packages/mcp/src/tools` 恰 13 个工具名；`node -v`=24.19.0、`git --version`=2.45.2、`opencode --version`=1.19.0 | ✅ |
| README:59 `npm test` 离线跳过 live | 本次 11 skipped，其中 10 个 `live:`（audit-test.log:379-419） | ✅ |

### 2.2 docs/remaining-work.md

| 声明（file:line） | 实际 | 判定 |
| --- | --- | --- |
| :3 "更新时间…第 62 轮…只列真实未完成项" | verification 已到第 89 轮；本文件未含第 63-89 轮变化，且仍有"已实现项"混在缺口里 | ❌ 过时且口径不实 |
| :14 "SQLite…迁移 v1–v7" | `packages/storage/src/migrations.ts` 已到 v10：v8 `ppt_attachments`、v9 `ppt_theme`、v10 `task_acceptance` | ❌ 过时 |
| :26 "PPT ✅/🟡…高级视觉/附件未做" ↔ :33 "文本+图片附件已做" | `packages/engine/src/ppt.ts:109-114` 支持 text/image 附件（png/jpeg/webp、≤3MB、≤10 个）并有测试；PDF 未做 | ❌ 自相矛盾 |
| :31 "GitHub 真实写 PASS；GitLab 真实写仍用桩" | 与 verification §3.2、`.tmp/github-write2.log` 一致；GitLab 只有 stub 测试（audit-test.log:397） | ✅ |
| :32 "模板编辑器…可视化…拖拽排序…缺口已关闭" | 无编辑器 UI（§1.2）；实际只可导入与 JSON 编辑 | ❌ 未完成却标完成 |
| :34 "审查快照对比…并排代码快照差异视图未做" | 对比能力已实现：`http.ts:437-460` 返回 resolved/introduced/persisting，`ReviewPanel.tsx:353,599` 有"审查对比"弹窗；仅"并排代码差异"未做 | ⚠️ 前半个缺口已完成仍被列出 |
| :35 "验收…验收规则自动化未做" | 人工验收 API/UI/Insights 聚合均已实现（http.ts:612-619、InsightsPage.tsx:38-103、audit-test.log:428）；仅自动化规则未做 | ⚠️ 已完成部分仍列为缺口 |
| :36 "恢复深度：规划上下文恢复仍以核对/未知为主" | `packages/engine/src/recovery.ts:132-134` 仅检查原任务是否仍在规划；恢复草稿不恢复规划上下文 | ✅ 缺口成立 |
| :37 "打包未签名/未公证；Windows/Linux 未验证；无自动更新" | `release/` 未签名 .app；无其它平台目标；无更新机制 | ✅ |
| :38 "Skill 源文：已支持带行号只读查看" | 已实现：`ToolsPage.tsx:190-266`、`/api/skills/:id/source`、audit-test.log:427 | ⚠️ 已完成却列在缺口 |
| :39 "并发会话计数：状态接口区分活动/历史会话" | 已实现：`adapters/opencode.ts:197-203`、`http.ts:808`、`OpenCodeCard.tsx:188` | ⚠️ 已完成却列在缺口 |
| :40 "角色历史：发布快照可查看并恢复为草稿" | 已实现：`RolesPage.tsx:317-362`、`/catalog/roles/:id/history`、restore 路由 | ⚠️ 已完成却列在缺口 |
| :40-41 两个 "10."；:41 "未建立自动视觉回归" | 编号重复；视觉回归确实没有（见 §4） | ⚠️ 编号错误；缺口本身成立 |
| 未列缺口 | 工作区清理 UI 未接线（README:98 有提）；工作流编辑器被禁用（`WorkflowsPage.tsx:132-139` "编辑流程" disabled，设计稿存在 `workflow-editor.html`）；角色版本对比/导入（旧矩阵曾标未做）均未在本文件出现 | ❌ 漏报 |

### 2.3 docs/verification.md

| 声明（file:line） | 实际 | 判定 |
| --- | --- | --- |
| :19 "313 tests / 54 suites / 302 pass / 11 skipped，约 24s" | **316 tests / 54 suites / 305 pass / 11 skipped / 0 fail，68.4s**（audit-test.log:432-439；`[test] running 69 files` 见 :4） | ❌ 计数与耗时过期 |
| :21 / :23 两条重复的"跳过项"，只说"live 两个模型端到端 + MySQL 探测" | 实际 11 skipped = 10 个 `live:` gate（planning/execution/fix/github-write/github-read/knowledge/gateway/ppt/review/database，audit-test.log:379-419）+ 无凭据 MySQL 探测（:49） | ❌ 严重少报；且两条重复 |
| :42 "server/recovery…requestKey 保留" ↔ :267 "FixRun 的 start/stop requestKey 只存在内存" | `fix.ts:76-77` 定义字段、:293/:386 写入 `fix.worktree.*` settings、`recoverOnStartup` 结算；`review-fix-recovery.test.ts` 通过（:420） | ❌ :267 过期，且与本文件 :42 冲突 |
| :82-93 §3.2 GitHub 真实写 PASS ↔ :264 "真实 GitHub push / 创建 MR / 直接合并未执行" | `.tmp/github-write2.log` 显示 push→MR #1→close→删分支 PASS；README:84、remaining-work:16 同结论 | ❌ :264 过期 |
| :134 "fixes/:id/merge 合并回 main" ↔ :266 "`fix.merge` 未实现" | `review-plugin.ts:146` 注册 merge；`contracts.ts:1111` fixMerge；audit-test.log:91 | ❌ :266 过期 |
| :47 "server/templates…可视化编辑新版本" | 无可视化编辑器（§1.2） | ❌ |
| :268 "工作区清理确认仅基础实现" | 服务端 preview/confirm + blockers 已实现并测试（audit-test.log:431）；缺的是 UI | ⚠️ 表述不准，应明说"UI 未接线" |
| :269 "Electron 打包分发未验证" ↔ :272-277 第 64 轮 `npm run dist` 成功 | 打包（未签名）已做；缺签名/公证/跨平台/自动更新 | ⚠️ 范围表述矛盾 |
| :270 "页面视觉对照与浏览器自动化回归待补" ↔ :279-285 UI smoke | `capture-ui.cjs:116-130` 只做文案存在性与 theme 断言，非视觉回归；也未进 `npm test`/CI | ⚠️ 部分成立；"对照截图"其实已有 |
| 章节结构 | :82 的 `## 3.2` 出现在 :95 的 `## 3.` 之前；第 64-89 轮内容（:272-335）追加在「10. 已知限制」之后，最新状态埋在文末 | ⚠️ 结构错位 |
| :331 第 89 轮 | 与最新提交基本同步 | ✅ |

### 2.4 docs/api.md

| 声明（file:line） | 实际 | 判定 |
| --- | --- | --- |
| :1 "实现以 ROUTES 为准" | ROUTES 有 3 个死端点、缺 7+ 个已实现端点（见 §1.5）；web 端也大量拼字符串（如 `api/git.ts:388,403,425,454,469`） | ❌ 契约不是权威 |
| :66 "delivery/merge-request…远端适配器待接线" | `http.ts:362` 已接线；`audit-test.log:382` "creates a real REST pull request"；README:84 GitHub 真实 MR PASS | ❌ 过期 |
| :84-86 记录 fixes 的 stop/commit/push/merge-request/discard/revert 与 diff | 服务端已实现（review-plugin.ts:115-170），但 ROUTES 只有 `fixes`/`fix`/`fixStart`/`fixMerge` | ⚠️ 文档有、契约无 |
| :97 `GET /api/settings/git` | 服务端 http.ts:750 有；ROUTES 无 | ⚠️ 双向漂移 |
| :100-102 数据库连接仅列 GET/POST/probe/query | `DELETE /api/settings/databases/:id` 已实现（http.ts:719）且被测试覆盖，但 api.md 与 ROUTES 都没写 | ❌ 漏记 |
| 整类缺失 | `knowledge`、`ppt`、`insights`、`acceptance`、`recovery`、`catalog/templates`、`templates/:id`、`skills`、`fs/directories`、`plan/from-template`、`execution retry/skip`、`reviews compare` 在 api.md 中 grep 均为 0；机器扫描服务端注册 124 条唯一 `/api` 路径，api.md 反引号内只有 48 条 | ❌ 严重不完整 |
| :12 `/api/events?afterSeq=` | http.ts:833 一致 | ✅ |
| :108-113 内部 MCP 13 个端点 | internal.ts:43-202 逐一匹配 | ✅ |

## 3. 文档错位与失效引用

1. **`docs/design-coverage.md` 错位（最高优先级）**：`head -3` 得到 `# 验证记录`；`diff -u` 与 verification 仅差第 89 轮 6 行。`git log --format='%h %s' -- docs/design-coverage.md` 显示 `6411226`（16:33）是覆盖点；`git show 45550f1:docs/design-coverage.md` 是初版矩阵（标题「设计稿覆盖矩阵」，含 6 章：主稿页面/规划执行/任务隔离交付/Git 工作台/B 类补充/说明）。后续 `972ebfe` 等提交继续往这个"验证副本"里追加轮次，说明每轮只 append verification、未维护覆盖矩阵。
2. **README:106 指向错位文件**：读者会以为 design-coverage 是覆盖矩阵，实际读到的是验证记录，且比 verification 少一轮。
3. **verification 结构错位**：`## 3.2`（:82）先于 `## 3.`（:95）；第 64-89 轮（:272-335）在「10. 已知限制」之后，标题层级与编号没有统一，最新结论被放在"限制"后面。
4. **重复/失效引用**：verification :21 与 :23 是两条几乎同义的"跳过项"；:285/:299 用反引号写 `evidence/ui-*.png`，相对 docs/ 解析会指向不存在的 `docs/evidence/ui-*.png`（实际在仓库根 `evidence/`）；README:103 只提 `docs/evidence/`，未说明根目录 `evidence/` 的用途。
5. **失效命令**：`package.json:28 "test:e2e": "node scripts/test-e2e.mjs"`，但 `scripts/` 无该文件（`ls scripts` 只有 10 个脚本），该 npm script 直接失败。
6. **架构文档过时**：`docs/architecture.md:29` 仍写 database 只有"mysql2 只读查询"，实际已有 `packages/database/src/postgres.ts` + `pg` 依赖 + 分流测试；:67 写"非 Git 项目走独立目录副本（适配待接线）"，实际已实现并有通过测试（audit-test.log:387）。
7. **设计系统声明未被执行**：`docs/design-system.md:8-9` 称"构建前用 `diff -q` 校验"ds.css 逐字节一致；`grep -rn "diff -q" scripts package.json` 无结果，只有 `generate-theme-config.mjs` 读取 ds.css。当前两份文件确实一致（`diff -q` 手工验证通过），但"构建前强制校验"不存在。
8. **gateway 文档计数过期**：`docs/opencode-provider-gateway.md:73` 写"288 tests / 280 pass / 8 skip"，与当前 316/305/11 不符；正文实现（`opencode-gateway.ts:60`、`application.ts:93`）与文档一致。
9. **证据目录混乱**：`docs/evidence/`（22 张，提交入库）与 `evidence/`（11 张，ui:smoke 输出）两套并存；`docs/evidence/README.md` 自述"第 35 轮重新打包后的…截图（electron-packaged-current.png）"，该文件 mtime 13:40，而 `release/…/Agent Workflow.app` 构建于 15:03、最新代码提交 17:43，"current"名不副实。`docs/evidence/README.md` 漏记 6 个同目录文件；`electron-packaged-home.png`、`settings-git-remote.png` 在 README/docs 中完全未被引用；根目录 `evidence/` 有 6 张（4 主题首页、ui-start、ui-tasks-deepseek）未被任何文档引用。

## 4. 测试与证据缺口

1. **离线测试现状（可信）**：316 tests / 54 suites / 305 pass / 0 fail / 11 skipped，68.4s（audit-test.log:432-439）；`npx tsc -p tsconfig.json --noEmit` exit 0（audit-typecheck.log 末行 `TYPECHECK_EXIT=0`）。
2. **跳过项被文档严重低估**：11 skipped 中 10 个是 `live:` 真实模型/真实远端 gate（planning、execution、AI review、AI fix、GitHub 写与只读、knowledge、gateway、PPT、MySQL），另有 1 个"MySQL 可达但未提供凭据"的探测（audit-test.log:49,379-419）。verification:21/23 只描述为"两个模型端到端 + MySQL"。
3. **live 证据不在仓库内**：`.tmp/` 与 `release/` 都被 `.gitignore` 忽略。GitHub 真实写 PASS 只在 `.tmp/github-write2.log`；planning/execution/review/fix/knowledge/PPT 的 live PASS 也只在 `.tmp/*.log`。**MySQL live 的 PASS 证据在 `.tmp` 中完全找不到**——所有含 `live: mysql2 probe` 的日志都是 `# SKIP`，README:81-82 与 verification §3.5 的 PASS 叙述目前不可复核。
4. **无 UI 视觉回归、无 CI**：`npm test` 不包含 Electron UI（package.json:25 vs :37）；`ui:smoke` 只断言页面文案存在与 `data-theme`（capture-ui.cjs:116-130），不比对像素/布局，也不在 CI 中（仓库无 `.github/`）。verification:284-285 的"UI smoke PASS"证据是运行时观察，不是回归门禁。
5. **真实 GitLab / PostgreSQL 未验证**：GitLab 仅本地 stub（audit-test.log:397）；PostgreSQL 仅驱动分流单测（`service.test.ts:121-134`），无真实实例。verification:162/264 已如实说明 GitLab，但 remaining-work/README 的状态表容易让读者误判。
6. **打包证据陈旧且不在库内**：`release/mac-arm64/Agent Workflow.app` 15:03 构建（约第 64 轮），之后第 84-89 轮（设置模型、目录选择器、超时）均未重新打包；`release/` 被忽略，无法从仓库验证"打包 ✅"。`electron-packaged-current.png` 只代表第 35 轮。
7. **截图证据**：抽查 `docs/evidence/task-delivery-apply-preview.png`（可应用 2、冲突 0，与 verification §3.8 一致）和 `evidence/ui-requirement-canvas.png`（当前导航/计划已确认，与现实现一致），**未发现明显文案不符**；问题主要是年份/轮次无清单、旧图混用、8 张未被文档引用（详见 §3.9）。
8. **契约/文档覆盖缺口**：服务端 124 条唯一 `/api` 路径，api.md 反引号内 48 条；ROUTES 120 个 key（117 条唯一路径）含 3 个死端点。文档没有"路由自动生成/校验"机制，漂移会持续。

## 5. 建议修正（具体到文件与章节）

1. **`docs/design-coverage.md`**：不要直接保留当前副本。可先 `git show a206797:docs/design-coverage.md > docs/design-coverage.md` 恢复 94 行矩阵作为骨架，然后按当前设计稿（v5，`originals/main/pages/*` 25 页 + planning/delivery/git/node 状态）重写：页面/路由/后端接口/状态（✅/🟡/⛔）/说明。同步修正 README:106。建议在 `AGENTS.md` §3.10 明确"每轮同时更新 verification 与 design-coverage，禁止复制另一个文件"。
2. **`docs/remaining-work.md`**：更新到当前轮次；移动 :38-:40 三项到「已实现并验证」；:32 删除"可视化编辑/拖拽排序/缺口已关闭"，改为"仅导入 + JSON 编辑；可视化步骤编辑器未实现"；:34/:35 拆成"已完成"与"仅剩并排代码差异/验收自动化"；:14 改 v1–v10；:26 与 :33 的附件表述统一为"文本+图片附件已做，PDF/品牌模板未做"；:40/:41 重新编号（两个 10）；补入"工作区清理 UI 未接线""工作流编辑器未开放""角色版本对比/导入""打包产物落后于第 89 轮"。
3. **`docs/verification.md`**：把 :19 的计数改为"以最近一次 `npm test` 日志为准（当前 316/54/305/11/0 fail，68.4s）"，或直接删除硬编码数字只保留日志路径；把 :21/:23 合并成一条完整 11 项跳过清单；删除或重写 :264/:266/:267（与 :82-93、:134、:42 矛盾）；:268 改为"服务端 preview/confirm 已实现并有测试，UI 未接线"；:269 区分"未签名打包已验证/签名与跨平台未验证"；:270 改为"有截图文案冒烟，无像素级视觉回归"；把 :82 的 §3.2 移到 §3 之后；把 :272-335 的轮次记录独立为「11. 轮次日志」。
4. **`README.md`**：重写 §「实现状态」（:108-112）为当前状态与最新测试数；§「未完成 / 下一步」（:94-99）只保留仍然成立的项（签名/公证/跨平台、清理 UI 接线、工作流编辑器、视觉回归），删除已完成事项；修正 :88 与 :84 的矛盾；在 §「界面证据」说明 `docs/evidence/`（历史手工）与 `evidence/`（ui:smoke）的区别。
5. **`docs/api.md` + `packages/shared/src/api/contracts.ts`**：以 ROUTES + 服务端注册为源重新生成接口表；补齐 knowledge/ppt/insights/acceptance/recovery/catalog/templates/skills/fs/retry/skip/compare 等组；补 `/api/settings/git`、`DELETE /api/settings/databases/:id`、`/api/ppt/works/:id/pptx`、fixes 子路由；删除 :66「待接线」；删除或实现 `contracts.ts:1051,1066,1088` 三个死端点。建议加一个 `scripts/check-docs-routes.mjs` 在 `npm run verify` 中执行。
6. **证据体系**：在 `docs/evidence/README.md` 增加"文件 / 轮次 / 构建时间 / 数据源 / 是否当前有效"清单，补全现有 22 张；把 `electron-packaged-current.png` 重命名为带轮次的名字，或基于 15:03 之后的构建重新截一张并更新说明；删除或标注 `electron-packaged-home.png`、`settings-git-remote.png` 的用途；在 README 里链接根目录 `evidence/`；如可能，把关键 live 日志（脱敏后）作为 `docs/evidence/live/*.log` 提交，或至少在 verification 中写清日志路径与日期。
7. **小修**：`package.json:28` 的 `test:e2e` 指向不存在的脚本——补脚本或删除；`docs/architecture.md:29/:67` 更新 PostgreSQL 与非 Git 适配状态；`docs/design-system.md:8-9` 要么把 `diff -q` 校验加进 `build:web`，要么改为"人工核对"；`docs/opencode-provider-gateway.md:73` 改为当前测试数。

## 6. 可信、无需修改的部分

- **类型检查**：`npx tsc -p tsconfig.json --noEmit` exit 0（`.tmp/audit-typecheck.log`）。
- **离线测试结果**：316 tests / 305 pass / 0 fail；关键通过项：worktree 并发隔离（audit-test.log:377）、delivery REST MR（:382）、非 Git prepare→preview→apply（:387）、GitLab stub（:397）、acceptance（:428）、cleanup blockers（:431）、review/fix 启动恢复（:420）、skills 扫描（:427）。
- **契约与运行时事实**：MCP 恰 13 工具（`packages/mcp/src/tools/*` 名称去重计数）；四主题各 86 个令牌（`THEME_CONFIGS` 实测）；`apps/web/src/styles/ds.css` 与设计稿 `originals/main/assets/ds.css` 逐字节一致（`diff -q` 通过）；SQLite 迁移 v1–v10 已实现；`AGENT_WORKFLOW_LIVE` gate 与 README:60 的命令一致。
- **remaining-work 表中经核实成立的项**：Electron 桌面（开发与第 64 轮打包产物存在）、React/Vite、React Flow、四主题、Node/Fastify、SQLite+JSONL、MySQL/PG 分流、Git worktree 并发、MCP 13 工具、规划/执行/审查/修复/交付/恢复主链路、常量/状态机/回执、角色编辑、非 Git 应用、模板导入/JSON 版本/归档、知识库、PPT 基础能力、用量采集。
- **api.md 的 SSE 与内部 MCP 章节**：`/api/events?afterSeq=`（http.ts:833）与 `internal.ts:43-202` 的 13 个内部端点逐条吻合。
- **证据抽查**：`task-delivery-apply-preview.png` 展示的"可应用 2 / 冲突 0"与 verification §3.8 描述一致；`evidence/ui-requirement-canvas.png` 的导航、计划已确认、11 步/10 依赖与当前实现文案一致。
- **gateway 实现**：`opencode-gateway.ts:60` 的 `/api/opencode/gateway/:secret/v1/*` 与 `docs/opencode-provider-gateway.md` 描述一致（仅测试数字过期）。
