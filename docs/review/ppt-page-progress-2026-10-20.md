# PPT 逐页制作持久状态验收（2026-10-20）

本批补齐设计中逐页等待、生成、完成、失败、未知、停止状态。沿用正式工作台左缩略图／中央当前页与备注／右助手、属性、检查布局；不修改设计稿和验收脚本。

## 实现

- 每个正文页使用独立真实受管模型会话顺序制作。页状态、原请求号、当前会话和停止请求号持久保存；完成一页即保存真实输出和修订，刷新可以恢复。未返回内容的页面显示等待或生成状态，不用占位内容冒充模型输出。
- 已完成页允许独立保存对象／备注，后页生成合并最新作品，不覆盖该人工修改。正在制作、等待、UNKNOWN 和正在停止的页不能越过保护写入。复制、版本恢复保留生产状态；部分完成不能假称全部完成或导出。
- 页面生成与助手讨论分开持久身份和停止端口；讨论不停止正文生产，修改方案仍须审阅和明确应用。请求受理后异步返回；兼容原同步调用。
- 停止操作核对原请求并绑定确切生成身份，仅在原会话确认空闲后结算；abort失败或超时保持 UNKNOWN。重启不自动重发，已完成内容保留。未派发后页可以明确停止；已派发但无结果的会话不能假报完成。
- 实测修正跨轮旧停止确认残留、停止请求原key核对、部分完成标签与导出提示。通用 PendingCommands/client 由 Lead 另行修正，本批仅使用既有接口。

## 离线回归

`npm run typecheck`、`npm run build` 均退出0。八组针对回归共26项通过、0失败：逐页生成、工作台、停止、重启恢复、助手／导出、生产、作品库、路由契约。

新增 `tests/integration/ppt-page-generation.test.ts` 使用可控端口验证并发与故障，不算真实模型证据：部分完成期间人工保存、精确会话停止、abort失败未知、助手身份隔离、重启保留且不重发、HTTP后台accepted、部分作品复制／导出保护。既有工作台回归保留过期修订409和本地草稿断言，仅适配明确单页DTO；未修改验收脚本。

## 真实模型与 CUA

独立5400服务、隔离数据 `/tmp/aw-ppt-page-progress-live-20261020`，临时公开常识简报《清晰会议的三步》，三正文页加真实封面。使用已配置受管 OpenCode，不注入模型输出。浏览器交互全部通过 CUA Chrome，截图是实际产品页面。

1. 第一轮 `req_0mvfmdz8hf0pum0mvha` 完成三页；中途真实持久快照为 `[completed, completed, generating]`，最终3/3。本轮打开停止确认时模型已完成，未派发停止，不能把对话框视作停止证据。
2. 第二轮 `req_0mvfmfulwt3zw8r3e6w` 在修订11的真实快照为 `[completed, generating, pending]`。当时真实用量为 input3949 / output95 / reasoning69 / cache8320 / total12433，说明第一页实际返回后后页仍在进行。
3. CUA明确确认停止时第二页也已返回，停止请求 `req_0mvfmgd82gwm58cea2n` 于19:02:50.360Z受理，19:02:50.667Z成功。停止绑定会话 `ses_eaa7494e1ffeDTe23Pwrq1Dd4k`；结算代码等待正面空闲证据。最终修订13为 `[completed, completed, stopped]`，本轮2/3。前两页真实新输出和人工备注／标签保留；第三页保留第一轮已有输出，但本轮状态明确停止，不能算本轮生成完成。
4. CUA刷新后显示“部分完成”、本次2/3、第三页已停止，无重新派发；导出PPTX与Markdown实际禁用并给出“还有1页未完成”的服务原因。四主题相同持久停止状态截图已保存。

本机证据 `/tmp/p08-page-evidence/`：`live-partial-second.json`、`real-stop-receipt.json`、`real-stopped-work.json`；`real-one-complete-one-generating-one-waiting.png`、`real-completed.png`、`real-stopped-final.png`、`real-stopped-warm.png`、`real-stopped-spdb.png`、`real-stopped-github-white.png`、`real-partial-export-disabled.png`。运行数据、截图和个人路径不作为产品配置提交。

本轮没有重新执行原生Electron PDF导出；此前PDF／助手应用真实证据见 `ppt-assistant-pdf-2026-10-20.md`。本轮助手并行、故障与重启是离线可控回归，不能冒充本轮真实助手模型或原生桌面验收。未执行全仓测试，由Lead整合回归。

Lead已将上述逐页/停止/四主题/导出禁用截图复制到 `docs/evidence/ppt-page-progress-2026-10-20/` 便于长期复查；运行数据仍仅保留本机。
