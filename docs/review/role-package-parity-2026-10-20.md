# P12 角色配置包闭环验收（2026-10-20）

基线 84db50c；设计权威 originals/main/pages/roles-legacy.html 的 import-validating / invalid / ok / nodiff / replace / back-confirm / publish-unknown。

## 实现与真实数据

- 配置包支持 JSON，以及内含根目录 roles.json 的 ZIP。格式 version:1、roles（id + 既有 RoleSaveRequest 可编辑字段）、可选 bindings（methodId / stepKey / roleId）。ZIP 在内存读取，不解压进工作区；限制条目与解压大小，校验 CRC，拒绝加密、多卷和穿越路径。
- POST /api/catalog/roles/package/validate 是只读操作。复用角色字段规范化和发布检查，报告具体路径、问题、角色修订、完整字段与激活差异；无差异不能发布。角色已有人工草稿时拒绝覆盖。未知原生工具拒绝，不从原型推测权限。
- 发布携带 sourceHash、baselineHash、confirmReviewed 与 requestKey；服务在事务内再次核对审阅基线。角色记录、发布历史、绑定和配置包审计记录原子写入，失败回滚，重复原 key 不产生新修订。
- bindings 实际叠加到流程 resolve/get/instantiate。instantiate 保持深拷贝；历史版本保存内容不叠加新绑定。自定义角色仍被激活绑定引用时，服务返回 archiveReason 并禁止归档，避免新任务引用被删除的职业。
- 历史页恢复目录未选择态与描述 / 权限与 MCP / Prompt / 历史四页签。能力、资源、形象和完整快照差异读真实契约，移除旧的“无契约 / 只读不能导入”假降级。
- 候选在当前窗口 sessionStorage 保留；换包和站内链接离开均明确确认，重新校验清除旧勾选。UNKNOWN 使用公共 durable pending registry，页面提供原请求核对入口，禁止重新派发；只有原 operations.by-key 终态解锁。/roles?roleId=... 支持精确职业初选。

## 验证

- typecheck、web build 真实进程退出码 0；未运行全仓测试。
- 25/25 针对测试通过：角色包、角色 API、扩展角色、路由契约、method/workflow catalog、workflow graph、前端角色包原 key 回执恢复。覆盖只读校验、真 ZIP/CRC/路径、未知工具、磁盘失败回滚、历史、实际绑定与冻结、绑定归档原因、重复 key、无差异和过期基线，以及离线 fetch 丢响应不重复派发。离线故障测试不属于模型验收。
- 独立 5399 服务与临时数据目录，CUA Chrome + macOS 原生文件选择框上传实际 deflate ZIP。来源摘要 `57d4bb62ab3d151eb004fe79cc965d7a911f58a49d872d2d1079745fbe5c19d2`；先显示 8 处差异且发布禁用，明确勾选后发布 `req_0mvflgl7n4b0flt4g6j` succeeded，真实目录出现 role.package-cua r1。
- 同 ZIP 再次导入实际显示 0 差异、勾选与发布禁用；换包 Modal、离开保留候选 Modal、返回候选保留、精确角色 query 初选均由 CUA 操作并观察。截图保存在 /tmp/p12-role-evidence/no-diff.png、replace-confirm.png、leave-confirm.png、exact-role-link.png。未改 Chrome 文件访问权限；扩展上传受限后通过原生选择框完成。

## 证据边界

本批没有真实模型调用；发布只影响之后的新会话和实际新任务流程解析，运行会话权限仍由既有冻结边界约束。UNKNOWN 在离线 fetch 故障回归验证，未把该故障注入冒充 GUI 自然断线。未完成本批四主题全状态、窄视口与 Electron 全流程复验；不据此宣称所有设计页已完全验收。浏览器后退/前进的 SPA 离开确认尚未独立验证；已验证站内链接离开；窗口关闭 beforeunload 已实现，但未实操确认。
