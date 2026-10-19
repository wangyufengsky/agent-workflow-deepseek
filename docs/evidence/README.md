# 界面证据

这些 PNG 来自真实构建（`apps/web/dist` + `.build/server/main.mjs`）与真实本地数据：

- 服务：`AGENT_WORKFLOW_DATA_DIR=.tmp/run-data AGENT_WORKFLOW_PORT=5288 node .build/server/main.mjs`
- 数据：真实 SQLite（项目/任务/规划轮次/执行）、真实 Git 仓库、真实受管 OpenCode 1.19.0 + opencode-go 模型
- 截图：Electron `BrowserWindow` + `capturePage()`（见 `.tmp/capture/main.cjs`，非产品代码）

| 文件 | 说明 |
| --- | --- |
| home-deepseek.png | 主页 deepseek |
| tasks.png | 任务列表 |
| start-task.png | 开始任务 |
| requirement-candidate.png | 需求画布：真实模型候选（第 1 轮，13 步/13 依赖/6 组，检查通过） |
| task-execution-running.png | 任务画布执行中 |
| node-execution-detail.png | 节点执行现场（模型正文实时片段 + 工具记录） |
| git-workbench.png | Git 工作台（真实提交/diff） |
| task-warm-1440.png、task-spdb-1440.png、task-github-white-1440.png | 同一任务画布其余主题 |
| task-warm-1024.png | 1024 宽度 |
| settings.png、inbox.png | 设置 / 待处理中心 |

限制：截图是开发构建 + 本机数据，不代表打包签名版本或跨平台验收；未做四主题 × 全状态自动回归。

- `roles-editor.png`：角色管理（内置职业草稿待发布、编辑/发布/还原入口）。

- `insights-real-counters.png`：质量与用量（真实任务计数与规划成本，未知项明确标注）。

- `electron-packaged-current.png`：第 35 轮重新打包后的 Electron 应用启动截图（内置 server）。
