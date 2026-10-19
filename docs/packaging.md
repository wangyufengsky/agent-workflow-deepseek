# 打包与真实环境验证（W4-4 / W4-5）

> 评估时间：2026-10-19 21:16–21:26（Asia/Shanghai）。仅改 `docs/packaging.md`、`docs/remaining-work.md` 与本机 `release/`（gitignored）；
> 未改产品代码/其他文档/设计稿。所有结论来自本次真实命令输出，未执行或失败的项明确标注，不伪造 PASS。

## 1. 结论速览

| 项目 | 本次结果 | 证据 |
| --- | --- | --- |
| `npm run dist:dir`（当前代码打包 macOS .app） | **PASS**（exit 0，21:20） | 构建日志与 `release/mac-arm64/Agent Workflow.app` |
| 产物 | **346 MB**，arm64 thin，`LSMinimumSystemVersion 13.0` | `du -sh`、`file`、Info.plist |
| 打包内容 | `.build/{server,mcp,desktop}` + `apps/web/dist` + 生产 `node_modules`（含 fastify/mysql2/pg/pptxgenjs） | `find` / `ls` |
| 安装包（dmg/zip/pkg） | **未生成**：当前 `mac.target` 只有 `dir` | `electron-builder.yml`、`find release` |
| 签名 | **未签名**：`identity: null`，日志 `skipped macOS code signing`；仅 Electron 自带 adhoc/linker-signed | `codesign -dv`、构建日志 |
| 公证 / Gatekeeper | **未公证**；`codesign --verify --deep --strict` exit 1、`spctl` exit 1 | 命令输出 |
| 打包内 server + Web 静态资源冒烟 | **PASS**：health/bootstrap/首页均正常，数据目录隔离 | §6.1 |
| 打包 .app 默认 GUI 启动（本沙箱） | **FAIL**：Chromium sandbox / GPU 初始化失败（`GPU process isn't usable`） | §6.2 |
| 打包 .app + 兼容 flags 离屏启动 | **PASS**：真实窗口 `capturePage()` 输出 2880×1758 PNG | §6.3 |
| Windows / Linux 打包 | **未验证**（配置存在，未在对应平台运行） | `electron-builder.yml` |
| 自动更新 | **未实现**（无 electron-updater / autoUpdater 引用） | 全仓 grep |
| PostgreSQL 真实实例 | **未执行**：本机无实例/凭据，且仓库无 PG live 测试；驱动单测 19 pass | §7.2 |
| GitLab 真实实例 | **未执行**：本机无实例/令牌，仅有本地桩测试；W2-5 仍 pending | §7.3 |

## 2. 环境

| 项 | 值 |
| --- | --- |
| OS | macOS 26.6.2（Build 25G83），arm64 |
| Node（系统） | v24.19.0 |
| Electron | 44.7.0（打包内置 Node v24.21.0，`ELECTRON_RUN_AS_NODE=1` 实测） |
| electron-builder | 26.0.12 |
| 签名身份 | `security find-identity -v -p codesigning` → **0 valid identities** |
| notarytool | 可用（Command Line Tools），但无证书/公证凭据 |
| 打包命令 | `npm run build && electron-builder --dir --config electron-builder.yml`（即 `npm run dist:dir`） |

过程说明：21:16 首次尝试 `npm run dist:dir` 在 `typecheck` 阶段失败（同波次并行 agent 正在改
`packages/shared`，出现临时重复导出/缺 import）；待工作树稳定后 21:20 重跑成功。该失败不是打包配置问题，
但说明**打包必须在稳定工作树上执行**。

## 3. 打包方式（配置事实）

`electron-builder.yml`：

- `appId: dev.agentworkflow.desktop`，`productName: Agent Workflow`，版本 0.1.0（取自根 package.json）。
- `asar: false`：`.build` 下的 server/MCP 由外部 Node/Electron 进程直接执行，必须保持解包；
  electron-builder 会警告 `asar usage is disabled — strongly not recommended`。这是当前架构的已知取舍。
- `files`：`package.json` + `.build/**/*` + `apps/web/dist/**/*`；生产 `node_modules` 由 builder 默认带入。
- `mac`：`identity: null`、`hardenedRuntime: false`、`gatekeeperAssess: false`、`target: dir/arm64`。
- `win`：`nsis`；`linux`：`AppImage`。两者未在本机运行。
- 无 `dmg`/`zip`/`pkg` target；`artifactName` 只对非 dir target 有意义，本次没有生成安装包。
- 未设置应用图标 → 使用 Electron 默认 `electron.icns`。

## 4. 产物

```
release/mac-arm64/Agent Workflow.app        346 MB（mtime 2026-10-19 21:20）
├── Contents/MacOS/Agent Workflow            36 KB（arm64 Mach-O）
├── Contents/Frameworks                     299 MB（Electron 44.7.0）
├── Contents/Resources/app                   46 MB
│   ├── .build/desktop/{main,preload}.mjs
│   ├── .build/server/main.mjs
│   ├── .build/mcp/server.mjs
│   ├── apps/web/dist/...
│   ├── node_modules/（fastify 1.3M、mysql2 820K、pg 128K、pptxgenjs 2.8M 等生产依赖）
│   └── package.json
└── Contents/Info.plist（CFBundleIdentifier=dev.agentworkflow.desktop，0.1.0）
```

- 与 15:03 的旧产物（329 MB）相比增加约 17 MB，主要是本次重新构建的 Web 资源与新增 `pg` 依赖。
- `release/` 在 `.gitignore` 中；产物不入库，本文件记录路径与大小供本机复核。

## 5. 签名 / 公证状态

本机没有可用的 Developer ID 证书（0 identities），且配置显式 `identity: null`：

```
• skipped macOS code signing  reason=identity explicitly is set to null

$ codesign -dv --verbose=2 "release/mac-arm64/Agent Workflow.app"
Identifier=Electron
CodeDirectory ... flags=0x20002(adhoc,linker-signed)
Signature=adhoc
TeamIdentifier=not set
Sealed Resources=none

$ codesign --verify --deep --strict "release/mac-arm64/Agent Workflow.app"
... code has no resources but signature indicates they must be present   # exit 1

$ spctl -a -vv "release/mac-arm64/Agent Workflow.app"
... code has no resources but signature indicates they must be present   # exit 1
```

结论：**未签名、未公证、Gatekeeper 评估不通过**。本机直接执行未拦截（本地构建、无 quarantine 属性），
但分发到其他机器会被 Gatekeeper 拦截；当前不可作为可分发安装包。

签名/公证所需（未执行，需用户提供）：

1. Apple Developer Program 的 **Developer ID Application** 证书，安装到钥匙串后
   `security find-identity -v -p codesigning` 能看到。
2. 团队 ID / Apple ID（或 App Store Connect API Key）用于 `notarytool submit`。
3. 可联网的签名环境；将 `identity` 改为证书名（或用 `CSC_LINK`/`CSC_KEY_PASSWORD`），
   `hardenedRuntime: true`，并按需维护 entitlements。
4. `xcrun notarytool submit ... --wait` → `xcrun stapler staple "Agent Workflow.app"` → `spctl` 复验。
5. 注意 `asar: false` 与外部 Node 进程：启用 hardened runtime/公证后必须重新验证 MCP/server 子进程可执行。

## 6. 启动冒烟（本沙箱真实结果）

### 6.1 打包内 server + Web（无 GUI）— PASS

用系统 Node 直接运行包内 server，并让它服务包内 `apps/web/dist`：

```sh
APP="$PWD/release/mac-arm64/Agent Workflow.app/Contents/Resources/app"
AGENT_WORKFLOW_ROOT="$APP" AGENT_WORKFLOW_DATA_DIR="$(mktemp -d)" \
AGENT_WORKFLOW_PORT=5399 AGENT_WORKFLOW_DISABLE_OPENCODE=1 \
node "$APP/.build/server/main.mjs"
```

结果：`/api/health` → `{"status":"ok","name":"agent-workflow","version":"0.1.0","node":"v24.19.0",...}`；
`/` → 200 `text/html`（643B，`<div id="root"></div>` + 构建 JS）；`/api/bootstrap` → app.name/隔离 dataDir/projects=0；
日志 `opencode: disabled`（因显式禁用）。**PASS**。

### 6.2 打包 .app 默认 GUI 启动 — FAIL（环境限制）

```sh
env -u ELECTRON_RUN_AS_NODE AGENT_WORKFLOW_CAPTURE=/tmp/capture.png \
  AGENT_WORKFLOW_DATA_DIR="$(mktemp -d)" AGENT_WORKFLOW_PORT=5398 \
  "release/mac-arm64/Agent Workflow.app/Contents/MacOS/Agent Workflow"
```

真实 stderr（节选）：

```
sandbox initialization failed: Operation not permitted
ERROR:content/browser/gpu/gpu_process_host.cc: GPU process exited unexpectedly: exit_code=6
FATAL:content/browser/gpu/gpu_data_manager_impl_private.cc: GPU process isn't usable. Goodbye.
[server] ... opencode: starting
```

进程退出，未产生截图。与既有 `npm run ui:smoke` 在本沙箱失败的原因一致（Chromium sandbox/GPU 初始化）；
这是**执行环境限制**，不能据此判定产品 GUI 不可用，也不能记为通过。

### 6.3 打包 .app + 兼容 flags 离屏启动 — PASS

同一命令追加 `--no-sandbox --disable-gpu --disable-dev-shm-usage`：

- 包内 server 在 `127.0.0.1:5397` 启动（`[server] ... listening on ...`），OpenCode 状态 `starting`
  （包内不捆绑 `opencode` 二进制，底部状态显示「部分可用 · 未连接 OpenCode」）。
- 主进程 `capturePage()` 写出 `2880×1758` PNG（372 KB），内容为当前构建的主页（hero + 流程演示 + 导航）。
  本机副本：`release/w4-4-packaged-capture.png`（gitignored，不入库）。
- 2.5s 后应用自行退出，server 收到 SIGTERM 关闭（`[server] SIGTERM received, shutting down`）。

说明：`--no-sandbox` 仅为绕开本沙箱 Chromium 限制的验证手段，不是产品默认行为，也不建议分发给最终用户。

### 6.4 GUI 冒烟结论

- 打包产物可以启动、加载真实服务与当前 Web、完成窗口渲染（离屏捕获）。
- 默认参数在**本沙箱**因 Chromium sandbox/GPU 失败；桌面环境需复跑一次默认参数启动作为最终 GUI 验收（W4-4a）。
- 未验证：真实窗口交互、托盘/菜单、文件选择对话框、多显示器/缩放；这些需要人工桌面验收。

## 7. W4-5 真实环境评估（PostgreSQL / GitLab）

### 7.1 本机检查结果

| 检查 | 结果 |
| --- | --- |
| 环境变量 `WF_PG_*` / `PG*` / `DATABASE_URL` / `GITLAB_*` / `GL_*` | 均未设置 |
| 本机 PG 端口 5432/5433/6432 | 无监听；无 `psql`/`pg_isready`；无 Postgres.app |
| 本机 GitLab 端口 80/443/8080/8929 | 无监听（3000 为无关 SnowLuma 容器） |
| Docker | 仅有 `snowluma` 镜像/容器；无 postgres/gitlab 镜像 |
| `.tmp` 凭据文件 | 仅有 `.tmp/github-env`（GitHub PAT）与 `.tmp/mysql-env`（MySQL），**无 GitLab/PG** |
| PG 驱动单测 | `packages/database/src/service.test.ts` → **19 pass / 0 fail** |
| PG JDBC 解析 | `parseJdbcDatabaseUrl('jdbc:postgresql://127.0.0.1:5432/demo')` → `{type:'postgresql',host:'127.0.0.1',port:5432,database:'demo'}` |
| PG live 测试 | **不存在**（`database-live.test.ts` 硬编码 MySQL 类型并断言 9.x；无 PG 版本） |
| GitLab live 测试 | **不存在**；只有 `gitlab-mr.test.ts` 本地桩 |

### 7.2 PostgreSQL：未执行，需要什么

当前只完成“驱动 + 类型分流 + JDBC 解析”的离线验证，**没有真实 PG PASS**。要完成 W4-5：

1. 用户提供一个可访问的 PostgreSQL 实例：host、port、database、只读账号、密码、（可选）SSL 要求；
   不要把密码贴进仓库/文档。
2. 建议用环境变量注入：
   `WF_PG_URL='jdbc:postgresql://<host>:5432/<db>'`、`WF_PG_USER`、`WF_PG_PASSWORD`。
3. 需要补一个 **PG live 测试**（当前仓库没有）：临时 dataDir 启动应用 → `POST /api/settings/databases`
   （`type: postgresql`）→ `/probe` 断言 `connected` 且返回 PostgreSQL 版本 → 只读 `SELECT version()` /
   普通 SELECT 成功 → 写/DDL/多语句被 `DATABASE_QUERY_BLOCKED` 拒绝 → 响应不含密码。可作为 W4-5a。
4. 在拿到实例前，本项保持 **未执行/未验证**，不写 PASS。

### 7.3 GitLab：未执行，需要什么

当前只有本地桩测试（`gitlab-mr.test.ts` 校验 PRIVATE-TOKEN、MR 列表/创建），**没有真实 GitLab PASS**。要完成 W4-5：

1. 用户提供一个 GitLab 实例与 **Personal Access Token（api scope）**、测试项目 path/namespace、
   可创建临时分支与 MR 的目标分支（最好是一次性测试项目）。
2. 建议环境变量：`GITLAB_TEST_BASE_URL`（如 `https://gitlab.example.com`）、`GITLAB_TEST_API_URL`
   （`.../api/v4`）、`GITLAB_TEST_TOKEN`、`GITLAB_TEST_PROJECT`。
3. 需补一个真实 GitLab live 测试（当前没有）：保存连接 → `testConnection` connected →
   `listMergeRequests` → 创建 MR（可关闭/清理）→ 响应不含令牌。
4. 另有前置代码缺口 **W2-5 pending**：`packages/server/src/application.ts:86` 仍为
   `gitlabConfigured: () => false`，且自托管 host → API base 推导尚未实现。真实实例验证前应先完成 W2-5，
   否则任务投影会误报未配置。
5. 在拿到实例与令牌前，本项保持 **未执行/未验证**，不写 PASS。

### 7.4 MySQL（范围外参考）

本机有 `.tmp/mysql-env`，历史 live 记录见 `docs/verification.md`；本任务未重跑 MySQL，也未将其计为 W4-5 通过。

## 8. 已知限制

- **未签名/未公证**：不能直接分发给其他 Mac；Gatekeeper 会拦截。
- **无安装包**：只有 `dir` target 的 `.app` 目录；无 dmg/zip/pkg。
- **仅 arm64**：没有 x64/universal；Apple Silicon 之外未验证。
- **默认图标**：使用 Electron 默认图标，未配置产品图标。
- **asar 关闭**：为外部 server/MCP 进程保留文件可执行性；builder 明确警告，属于当前架构取舍/安全面增大。
- **自动更新未实现**：无 electron-updater/autoUpdater；也没有发布渠道/版本清单。
- **不捆绑 OpenCode**：包内 server 会尝试启动受管 OpenCode，但需要用户机器已安装 `opencode` 1.19.0 并登录；
  未安装时应用可运行但模型能力显示「未连接 OpenCode」（本次离屏截图即为此状态）。
- **CI 不打包**：`.github/workflows/ci.yml` 只跑离线检查，无 macOS 打包/签名 job。
- **GUI 未做人工桌面验收**：本沙箱默认启动失败，仅用兼容 flags 完成离屏捕获；真实交互/对话框/多显示器未验证。
- **未验证 Windows/Linux**：`nsis`/`AppImage` 配置存在但未在对应平台运行。
- **最低系统**：Info.plist `LSMinimumSystemVersion 13.0`（Electron 默认），更高版本未逐版本验证。

## 9. 下一步任务建议

| ID | 任务 | 依赖 |
| --- | --- | --- |
| W4-4a | 桌面环境默认参数启动验收（不借助 `--no-sandbox`）：窗口/菜单/文件选择/关闭 | 桌面会话 |
| W4-4b | 配置 dmg/zip target，产出可分发安装包 | W4-4c 证书 |
| W4-4c | Developer ID 签名 + hardened runtime + 公证 + stapling + `spctl` 复验 | Apple 证书/账号 |
| W4-4d | 应用图标与品牌资源（替换 Electron 默认图标） | 设计资源 |
| W4-4e | Windows/Linux 打包 runner（或明确仅支持 macOS） | 对应平台/CI |
| W4-4f | 自动更新决策（electron-updater + 发布渠道，或明确不做） | 发布策略 |
| W4-4g | CI 打包 job（macOS runner；签名 secrets；打包后跑打包内 server smoke） | 签名/仓库权限 |
| W4-5a | PostgreSQL live 测试 + 用户实例/凭据 | 用户提供 PG |
| W4-5b | GitLab live 测试 + 完成 W2-5（host/API base、configured 检测）+ 用户实例/令牌 | 用户提供 GitLab |

## 10. 复现命令清单

```sh
# 1) 打包（稳定工作树上）
npm run dist:dir
APP="release/mac-arm64/Agent Workflow.app"

# 2) 产物/签名
du -sh "$APP"; file "$APP/Contents/MacOS/Agent Workflow"
codesign -dv --verbose=2 "$APP"
codesign --verify --deep --strict "$APP"; echo "exit=$?"
spctl -a -vv "$APP"; echo "exit=$?"

# 3) 打包内 server + web（无 GUI）
RES="$PWD/$APP/Contents/Resources/app"
AGENT_WORKFLOW_ROOT="$RES" AGENT_WORKFLOW_DATA_DIR="$(mktemp -d)" \
AGENT_WORKFLOW_PORT=5399 AGENT_WORKFLOW_DISABLE_OPENCODE=1 \
node "$RES/.build/server/main.mjs" &
curl -s http://127.0.0.1:5399/api/health
curl -s -o /dev/null -w '%{http_code} %{content_type}\n' http://127.0.0.1:5399/
kill %1

# 4) GUI 离屏冒烟（本沙箱需兼容 flags）
env -u ELECTRON_RUN_AS_NODE AGENT_WORKFLOW_CAPTURE=/tmp/capture.png \
  AGENT_WORKFLOW_DATA_DIR="$(mktemp -d)" AGENT_WORKFLOW_PORT=5398 \
  "$PWD/$APP/Contents/MacOS/Agent Workflow" --no-sandbox --disable-gpu --disable-dev-shm-usage
```

> 本文件在重新打包/签名/真实环境验证后需要同步更新结论与日期。
