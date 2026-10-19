# 项目 GitLab 与执行证据来源闭环

基线：151c232；技术栈依赖为 e9a4bde（本分支等价 cherry c23f8fd）。只读设计依据：`opencode-workflow-design-showcase/originals/main/pages/projects.html:211–220`，明确列出 GitLab 绑定、JUnit/外部日志目录来源、切换类型清空路径、增删行、保存后检查仓库及来源可读性。未修改设计或验收脚本。

## 实现与边界

- `ProjectSettings.evidenceSources` 服务端校验最多16条。JUnit仅项目相对 `.xml` glob（`*`/`**`/`?`）；拒绝越界、保密目录、特殊匹配语法、重复。日志仅明确绝对目录；检查只打开目录，不枚举条目、不读取正文、不发送模型、不扩大职业文件授权。
- 项目 PATCH 复用既有 requestKey/回执；新增 `POST /api/projects/:id/binding/check` 同样持久化原key回执。请求绑定已保存配置身份；检查中配置变化拒绝保存迟到结果；同key重读返回原检查结果而不重新探测。项目详情仅投影当前配置身份的检查。仓库与来源各自返回真实结果，不把检查命令 succeeded 当 GitLab 已连通或测试通过。
- GitLab 检查复用当前 `RemoteService` provider 及授权，以实际 `getProject` 读取项目元数据；未配置/错误分别展示。没有创建 MR、修改凭据或远程写入。本批没有真实 GitLab 账号连通验收。
- 新模板计划冻结 JUnit 规则；已有计划不回填。受控 `workspace.exec` 仍验证冻结命令、职业 argv/文件许可、当前 session/attempt。省略显式报告时读取冻结规则匹配的新报告；显式报告不能绕过非空冻结规则。项目配置后改不影响冻结计划。
- 匹配扫描有界（深度8、200目录、2000条目、64候选），不遍历符号链接/隐藏目录。实际报告最多16份，每份512KiB；沿用本次命令前后指纹、时间与不可变 artifact 捕获，DTD/实体/旧报告/解析不足/超限均 unknown。汇总最多2000个 testcase，关联测试产物整体最多24文件/8MiB。只汇总实际用例状态，不相信 suite 总数或模型计数；保留原始报告与汇总 artifact。运行页可查看各原始报告。

## 验证层次

1. **实现/HTTP/真实本地命令**：`project-evidence.test.ts` 覆盖规则/越界/符号链接/角色过滤、真实文件探测、原key重放不重复探测、配置陈旧拒绝、无 GitLab 配置真实状态、JUnit多报告实际用例汇总、旧报告/DTD拒绝。`template-file-evidence.test.ts` 新用例调用真实 Node `--test --test-reporter=junit --test-reporter-destination=reports/result.xml`，经实际内部 HTTP+会话授权执行，验证冻结规则在项目改动后仍生效、实际2通过/0失败/1跳过及原报告身份，越出冻结规则拒绝。该用例是本地进程与协议验收，不是模型验收。
2. **CUA 正式 Chrome GUI**：独立本地服务5527/Web5523，临时项目文件 reports/example.xml。从项目列表进入「Git 与 GitLab → GitLab 与证据」，添加 JUnit 行、填写 `reports/*.xml`、保存真实 succeeded 回执、检查显示1报告可读，同时仓库显示尚未配置。重载后来源/检查持久保留；切换日志类型清空路径，未保存检查禁用、空路径保存禁用。截图 `docs/evidence/project-evidence-2026-10-20/binding-check.png`（只保留界面证据，不提交运行数据）。修复首次 GUI 发现的来源行输入框挤窄，重启独立服务后重新截图确认正常宽度。
3. **未覆盖**：没有本批真实模型调用、真实 GitLab 账号成功/失败 GUI、网络中断 UNKNOWN GUI、检查期间配置竞态 GUI、四主题/窄屏全量 GUI；不得将离线协议或单次 GUI 当这些状态通过。外部日志内容消费本批按授权明确不实现；仅目录可读性探测。

执行日志：`/tmp/project-evidence-final-tests.log`、`/tmp/project-evidence-final-build.log`。最终通过数量及退出码见交接。
