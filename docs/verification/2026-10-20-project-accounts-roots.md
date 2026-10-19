# P02/P22 项目独立 Git 账号与允许登记根目录

基线 ede7989；依赖 Lead 网络策略105b141（此分支等价919b405）。本批只补 P02.projects / P22.settings，不改变只读设计、ModelSection、NetworkSection、公约生成或外部写入授权。

## 设计与实际实现

- `originals/main/pages/projects.html:224–236`：账号来源继承/项目独立、令牌/用户名密码、验证用仓库、验证不保存、单独保存。本批新增项目账号 GET/保存/只读验证 DTO、ROUTES 与两类持久化操作回执。修订号比较拒绝陈旧保存；同key回读原回执不重做验证。验证期间账号变化拒绝迟到绑定；账号保存清理旧仓库绑定检查，进行中的绑定检查也比较账号修订。
- 凭据仅写本机 AES-GCM SecretStore；普通设置仅保存不可逆密钥引用、服务器 origin 与非敏感账号配置。HTTP响应、回执、浏览器持久存储均不包含凭据。请求身份只使用凭据/仓库输入哈希；空凭据仅在认证方式、用户名、provider、origin相同条件下保留已有项目密钥。保存后输入清空，查询不回显。
- 验证调用真实 `git ls-remote --heads`，没有 shell、推送、配置写入或凭据URL；凭据通过一次性环境 Git header 注入，禁用重定向与交互提示，候选凭据不落本机密钥库。成功只证明该次仓库读取，不伪造外部账号或 API 成功。
- 实际 Git fetch/push 按权威projectId及项目根目录/任务工作区解析账号，验证目录真实归属；无明确身份的多归属目录拒绝，禁止猜测凭据；独立账号按服务器 origin 约束，缺失/跨服务器/非HTTP协议拒绝，不静默回退全局。继承保留现有系统Git/全局账号语义。GitHub/GitLab项目API也解析独立令牌；用户名密码只用于Git传输，API需要访问令牌，明确拒绝而不回退全局。Git子进程已知凭据及其Basic编码从输出/错误中脱敏。
- 复用 Lead 发布网络 `assertPublishUrl`，禁止未许可明文HTTP主机；API保持原网络fetch连接/整体响应deadline，不将它误当GitCLI命令超时。保留 Lead Undici Headers 类型修复。
- `originals/main/pages/settings.html:100`：允许项目根目录。新增 `server.allowedProjectRoots`，最多16个绝对目录；空列表不限制。设置 textarea 保留原始换行草稿，保存时转数组，复用普通设置原key/保存回执。登记新项目时以realpath及真实目录做边界比较，符号链接逃逸/同名前缀兄弟目录拒绝；不可核对路径不能获准。已经登记的项目仍可读取/重检/返回原记录，不破坏原任务；这是登记限制，不授予运行时额外文件读取权限。

## H：真实本地链及服务回归

`tests/integration/project-accounts.test.ts` 使用本机 `git http-backend` + Basic鉴权的临时HTTP服务（不是外部GitLab账号）：

- 候选验证实际读取1分支，项目版本仍0、密钥库没有新增凭据；同key不重复发送读取。
- 单独保存后实际fetch更新origin/main、实际push创建临时本地远端分支；独立令牌覆盖全局，密码模式也驱动实际fetch；切回继承使用全局账号。
- 项目API实际HTTP消费者发送独立令牌读取项目元数据（受控协议夹具，不是GitLab外部验收）。
- 真实HTTP候选验证尚未返回时保存新账号，迟到结果因修订变化被拒绝；空凭据保留、陈旧修订拒绝、跨host拒绝、不回显凭据；SQLite检查不含夹具凭据明文。
- 设置保存与实际登记HTTP：允许范围内成功、符号链接逃逸/兄弟前缀拒绝，已登记范围外项目保留，非法配置拒绝。

连同项目来源、Git推送、远端API、网络许可、路由契约共15项通过。最终日志 `/tmp/project-accounts-delivery-tests.log`；完整build含typecheck日志 `/tmp/project-accounts-delivery-build.log`；最终消费者身份字段增补后再次跑15项及typecheck（`/tmp/project-accounts-delivery-types.log`），退出码见交接。

## G：CUA 正式 Chrome

独立应用服务5537；Web5533，后用新Vite5534复看最新前端。所有账号均为临时夹具字符串；不使用真实个人账号。

1. 项目页选择独立GitLab令牌，点击验证，显示原key succeeded、1分支可读且版本仍0；截图 `docs/evidence/project-accounts-2026-10-20/project-account-candidate.png`。
2. 单独保存升至版本1，凭据输入清空；Git页点击「获取远端更新」，实际git.fetch原key完成，新增origin/main；截图 `docs/evidence/project-accounts-2026-10-20/project-account-fetch.png`。
3. 最新前端重新进入项目，版本1与密钥已保存保持，输入仅「已保存·留空不修改」；空输入验证继续成功，截图 `docs/evidence/project-accounts-2026-10-20/project-account-saved.png`。错误候选验证清空旧成功内容并保留输入，界面按保守客户端语义先待核对/锁定；点击全局原操作核对后解除锁，不自动重新验证。
4. 设置页输入两个允许目录（真实保留换行），保存设置；原范围外既有项目仍显示。范围外新登记返回服务FORBIDDEN，输入保留，截图 `docs/evidence/project-accounts-2026-10-20/project-root-denied.png`；改为允许目录后真实登记成功，列表同时保留原项目。

未覆盖：真实外部GitHub/GitLab账号、真实外部推送/MR、代理和非回环网络、真实模型；四主题/窄屏/全部UNKNOWN跨服务重启GUI、密码模式GUI（密码传输已由实际本地H覆盖）。这些均不得因本批H/G成功而升级通过。
