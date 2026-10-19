# P08 助手与 PDF 导出验收证据（2026-10-20）

本批基于 `06e4a15`，补齐助手候选实际应用、PDF 原生保存和 PPT 显式路由注册。设计目录未修改；品牌管理未新增：现有 PPT 设计没有独立品牌业务结构，沿用当前作品的视觉方案、主题与对象样式。

## 设计位置与落地

权威为 `originals/main/pages/ppt-studio.html`：192 行演讲备注；215–218 行助手仅页 / 整份范围；226–228 行 PPTX / PDF 和默认勾选的“包含演讲备注”；249 行及后续七模块制作方案；295 行交付备注设置。v4/v5 没有替代这些 PPT 结构的更新页面。

- 助手走受管 OpenCode 的只读、无工具会话，读取当前作品与已经提供的项目文档 / 文本附件。回复和候选独立持久保存，返回候选不改作品修订。
- 页面候选列出替换前后正文、标题和备注；简报 / 大纲 / 方案候选展示完整前后内容。明确“应用”才由真实 requestKey 命令写入；“不用了”保留历史。过期候选不能覆盖后续人工修订。
- 仅页候选不能修改其他页、简报或整份方案；页面内容更新继承人工字号、颜色、对齐、图片与标签。整份候选也只应用明示字段。
- 助手使用既有 PPT 停止协调器：abort 返回不等于停止完成；原会话未知时保持原请求锁。重启不重发；只有原 key 核对持久回复或原会话终态。新增故障回归覆盖“答复已保存、回执未落定”的恢复，并清理过期生成投影。
- PDF 从当前真实页面共用 SVG 渲染生成受限 HTML，桌面独立打印窗口无脚本 / Node 权限，拒绝外部资源。保存文件后重新读取并核对 SHA-256；取消、打印失败、快照或文件哈希不符均不显示已保存。
- 导出格式和“包含演讲备注”是本次只读导出选项，传入 PDF / PPTX 服务，不修改作品。PDF 勾选时在有关页面之后附备注页；不勾选时仅导出演示页面。界面明确显示修订、包含当前封面的演示页数和附加备注页数。封面属于当前实际可编辑作品页面，与缩略图 / PPTX 同源，不是额外元数据封面。
- 导出成功显示用户实际选择的文件名。浏览器仅显示“已发起浏览器下载”；PDF 缺少桌面宿主时给出禁用原因。归档作品可只读导出。
- archive / copy / restore 改为显式 Fastify 路径 + 共享 handler；assistant / decide / document 全部有标准 ROUTES 常量。

## 针对测试与构建

`node --import tsx --test` 执行下列文件，19 / 19 通过，无跳过：

- `tests/integration/ppt-assistant-export.test.ts`
- `tests/integration/ppt-plan-stop.test.ts`
- `tests/integration/ppt-production.test.ts`
- `tests/integration/ppt-startup-recovery.test.ts`
- `tests/integration/ppt-works.test.ts`
- `tests/integration/routes-contract.test.ts`

覆盖候选不写入、实际应用 / 幂等回执、人工保留、越界拒绝、过期冲突与丢弃、整份方案实际应用、超时锁与原 key 核对、服务重启持久回复恢复、真实 PPTX ZIP、PDF 快照内容 / 页数 / 哈希、保存取消、打印失败和损坏快照拒绝。测试中的 OpenCode 注入用于可控故障和契约验证，不计作真实模型证据。

`npm run typecheck`、`build:mcp`、`build:web`、`build:desktop` 通过。桌面构建继续输出 `preload.cjs`，保留原生宿主修复。

`check:docs-routes` 已不再报告动态 PPT 注册缺失；本分支基线 `docs/api.md` 仍欠 40 条路由文档（含本批 3 条），由 Lead 在合并后统一 `docs:api` 生成。未修改路由或验收检查脚本。

## 原生 CUA 与真实模型

独立服务端口 5397、临时手工资料。每次操作均通过 CUA 绑定本 worktree 的 Electron，AX 确认 `127.0.0.1:5397/ppt`；未操作 Lead 的 5277 窗口。没有用脚本控制 BrowserWindow 或 Playwright 执行交互。隐藏打印窗口属于生产 PDF 实现。

真实运行时 OpenCode 1.19.0，模型 `opencode-go/deepseek-v4.1-flash`。首次运行时未就绪请求没有派发模型；核对原请求明确失败后才另行请求。真实助手请求 `req_0mvfjv4z920ltxinmur`：

1. CUA 指定仅第 1 页，将第一条正文精简为“界面呈现服务事实。”，其余标题、标签、备注和第 2 页保留。
2. 前端连接等待超时保持原 key 锁；同一请求于 17 秒后服务终态 succeeded。点击“核对原操作”取回候选 `proposal_0mvfjvi32trmjqky099`，没有自动重发。
3. 审阅时独立读取作品仍为 r3，原文未改。CUA 点击“应用”后变为 r4；服务数据比对确认只有指定正文变化，人工样式、标签、备注和第 2 页完全相同。
4. 离开工作台再进入仍可读取真实对话、已应用状态和前后差异。

真实 PDF 由 CUA 打开原生保存对话框并保存；随后独立 `pdfinfo`、`pdftotext`、SHA-256 和 raster 检查：

| 本次选项 | 实际文件 | 预期 / 实际页面 | SHA-256 |
| --- | --- | --- | --- |
| PDF，包含备注 | `p08-native-r4.pdf` | 当前封面 + 2 正文 + 2 备注 = 5 / 5 | `c8fcc3f690b9e02851cc04642133b8db243af582d6599e015e5971a33662243f` |
| PDF，不包含备注 | `p08-native-slides-only.pdf` | 当前封面 + 2 正文 = 3 / 3 | `3285012976100a1444c91fd4fd6a0ad5fe117810589aeb8c8109ebf23b087fb4` |

两份实际为 PDF 1.4，960 × 540 pt，JavaScript=no；正文含应用后的精简句、人工标签。5 页文件含两段人工备注，3 页文件无备注正文。页面 raster 检查确认人工强调色、标题字号与正文排版。自定义文件名在最终 CUA 成功反馈中正确回显。另一次 CUA 原生取消反馈为“已取消保存，没有保存文件”，没有遗留成功提示。

原生四主题最终截图和产物在本机 `/tmp/p08c-native-evidence/`：`deepseek.png`、`warm.png`、`spdb.png`、`github-white.png`、`pdf-cancelled.png`、`slides-only-saved.png`、`pdf-page2.png` 和上述两份 PDF。真实服务数据、请求正文、运行配置与二进制产物没有提交入库。

## 证据边界

真实模型 CUA 已验单页候选 / 审阅 / 应用；整份与简报的解析、越界防护、冲突和持久恢复由真实服务上的受控端口测试覆盖，不能称为整份真实模型 GUI 已验。停止的拒绝 / 原会话停稳由针对测试验证，本批没有额外宣称真实模型停止 GUI 验收。原生 PDF 已验 macOS；Windows / Linux 打印宿主未在本机实际运行。四主题截图用于确认本批控件和差异可读，不等同所有 PPT 状态逐像素对照完成。
