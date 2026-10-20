# 实现状态与剩余缺口

> 更新时间：2026-10-19（Wave 0–3G 全部功能波次完成；外部验证 blocked）。核心链路与设计稿功能已实现；本文件只列**外部阻塞、发布类**与可选的视觉/深度项，不再重复已完成功能。
> 基线：`npm test` **403 tests / 54 suites / 392 pass / 11 skipped / 0 fail**（67.6s，日志 `.tmp/wave3g-verify.log`）；`npx tsc -p tsconfig.json --noEmit` exit 0；`npm run docs:api` / `check:docs-routes`（**163 路由**）/ `build:web` / `build:server` / `test:e2e -- --skip-build` / `ui:smoke`（兼容 flags，13 截图 + 2 交互）通过（`docs/review/execution-log.md` 22:00 后整合记录）。
> 设计覆盖逐页状态见 `docs/design-coverage.md`（25 页矩阵：**⛔ 0**，全部 ✅/🟡；逐页降级说明在该文件）。
> 打包与真实环境：见 `docs/packaging.md`（W4-4 已重建 346MB 未签名 .app；W4-5 真实 PG/GitLab 因本机无实例/凭据 **blocked**）。
> 品牌决策：产品名继续 `agent-workflow` / `Agent Workflow`；设计稿 `opencode-workflow` 仅作来源名，不做全局改名（见 README「品牌与命名」）。

## 1. 阻塞（外部环境，无法在本机完成）

1. **W4-5 真实 PostgreSQL / GitLab 验证（blocked）**：本机无实例/凭据，仓库也没有 PG/GitLab live 测试，**未写任何 live PASS**。需要：
   - PostgreSQL：连接串 + 只读账号（建议 `WF_PG_URL` / `WF_PG_USER` / `WF_PG_PASSWORD`），并新增 PG live 测试；
   - GitLab：base/API URL + api scope PAT + 测试项目（建议 `GITLAB_TEST_*`），先完成 W2-5。
   完整变量、复现命令与评估结论见 `docs/packaging.md` §7。
2. **W2-5 GitLab 真实写（blocked）**：GitLab host/API base 推导与 `gitlabConfigured` 检测只有桩测试；真实实例/令牌缺失，与 W4-5 同一阻塞，不伪造 PASS。
3. **GitHub 远端关闭/合并/删分支产品边界（W2-8）**：真实 GitHub 写已 PASS，但关闭 MR/合并/删分支的“产品边界”需产品确认；不阻塞本地功能。

## 2. 发布 / 分发类

4. **W4-4 打包签名与跨平台**：2026-10-19 21:20 已用当前代码 `npm run dist:dir` 重建 **346MB 未签名 `.app`**（arm64；无 dmg/zip/安装包；默认 Electron 图标；asar 关闭）。默认 GUI 在本沙箱被 Chromium sandbox/GPU 拦截，兼容 flags 离屏捕获 PASS。**签名/公证、桌面默认参数验收、Windows/Linux、自动更新、CI 打包未做**，见 `docs/packaging.md` §5/§8/§9。
5. **W4-6 推送 main（pending）**：功能全部完成后由 Lead 推送 `https://github.com/wangyufengsky/agent-workflow-deepseek` 的 `main` 并 `git ls-remote` 核对；当前 `origin` 已配置、本地分支为 `main`（2026-10-20 更正：仓库早已是 main），推送在文档收口后执行。

## 3. 可选视觉/深度项（非功能阻塞，设计覆盖已标注降级）

6. **像素级视觉回归**：W4-3b/3c 已让 `ui:smoke` 兼容 flags 通过（13 截图 + 2 交互，`docs/evidence/` 30 张：8 当前 + 22 历史，`evidence/` 13 张），但仍是文案/主题/关键交互断言，**没有像素级 diff**；四主题 × 全状态未自动覆盖。可作为后续可选增强。
7. **设计级诚实降级（详见 `docs/design-coverage.md`，非阻塞）**：
   - B-07 快照评审阶段报告 `partialReport.available:false`，mode/depth 为 unknown（未接评审报告服务）；
   - 知识问答**无 SSE、但有真实增量轮询流式**（2026-10-20 审计更正；旧历史无时间线字段时隐藏）；
   - 项目公约 `generate` 返回真实 501（模型生成未接线，手动编辑/确认写入可用）；GitLab 项目级覆盖只保存非敏感配置，运行时仍用全局配置；
   - 角色 B-02/B-03 发布回执核对/权限预估、形象目录、步骤级使用统计无接口；数据库授权/多 schema/会话只读，工具项目级/单工具策略，模板分支/时间/文档/B-06 等后端字段仍缺；
   - 工作流编辑器无并行/任意连线（服务为有序步骤）、无拖拽平移缩放/步骤模板抽屉/视觉 diff；
   - PPT 高级视觉（品牌模板/PDF/逐页视觉检查）、首页「进行中」单卡、审查并排代码差异等仍为降级；
   - 恢复不复制执行上下文/阶段图；live 日志摘要未入库。

## 4. 说明

- 功能波次 Wave 0–3G 已全部完成；本文件不再列已完成功能，避免与 `docs/verification.md` 重复。
- 测试数字以最近一次 `npm test` 日志为准；skip 只允许 gated live/凭据场景（10 live + 1 凭据探测）。
- 品牌：产品名继续 `agent-workflow`；`opencode-workflow` 为设计来源名，全局改名不在范围内。
- 打包/真实环境 blocked 的完整证据、环境变量与复现命令见 `docs/packaging.md`；当前截图清单见 `docs/evidence/README.md`。
