# P09 普通源码与单测逐文件证据闭环（2026-10-20）

基线：46fa867。此批对应只读原稿 `originals/main/pages/run.html` 的源码逐文件写作与独立复核，以及 244、265–269 行的测试通过/失败/跳过、失败文件与命令报告。保留已有阅读权限过滤和快照评审合同。

## 合同与实际执行

- 新建单测模板 v8、详细设计 v6、需求评审 v4 显式冻结 sourceEvidenceVersion=1、现有步骤的 prepare/write/test/review 阶段、源文件 blob 与测试命令。原步骤拓扑不增加隐藏节点；已有最终报告步骤采用 reviewer。旧任务冻结合同保持原值，缺证据时不能推算已覆盖。
- 每个写作文件必须绑定当前步骤已完整读取的冻结 blob、摘要与本次实际捕获的产物身份。复核须绑定当前成功上游 writerAttemptId，由不同 OpenCode session 完整读取同一不可变产物，并提交逐项结论和理由。当前尝试替换、读取撤权会使旧证据失效。
- workspace.file.read 支持 artifactId，消除产物与输入源码同名时的歧义；按路径/产物身份/hash 限定，只返回冻结来源或当前上游产物。大产物有 512KiB 响应上限，分段读取合并实际返回范围，缺行不能算完整读取。
- workspace.exec 仅执行冻结的配置命令，仍受角色 argv、工具和路径权限约束。服务读取本次命令的 JUnit stdout 或工作区内新建/更新的报告，签发绑定 task/execution/node/attempt/workspace/argv hash 的 testRunId；只接受当前尝试最近一次运行。提交结果不能覆盖服务解析的通过、失败、跳过计数。
- JUnit 解析按实际 testcase 元素计数，不采信 suite 汇总属性；拒绝 DTD/实体、越界、symlink、旧报告、命令超时和截断。不支持的格式/没有文件映射/全跳过均明确保留未知或缺失证据。报告文件路径或唯一 classname 映射关联真实测试文件，并捕获文件 hash。模型自报计数不产生通过证明。
- 单测最终复核必须绑定该写作版本实际通过的测试报告。服务根据已验证的逐文件结论生成不可变复核报告，复核职业无须额外取得文件写权限。

## 阅读布局

源码视图分别显示写作摘要、产物和独立复核结论/理由；每组只展示冻结分配范围。测试视图展示服务真实通过/失败/跳过、命令/argv hash、报告身份，失败用例可读取其同版本测试文件。未知计数显示未知，不填零。现有报告下载和 ArtifactDetailView 鉴权复用原有链路。

模板编辑/导入保留完整 sourceStage、职业、输入与证据版本元数据，避免再次保存时静默丢失合同。

## 回归与边界

- 新 focused 测试 6 项：真实 Node 子进程产生 JUnit（含成功、失败、跳过）；通过真实内部 HTTP 验证角色权限、冻结命令和文件读取；实际不可变报告/测试文件读取；跨尝试、旧报告、superseded testRun、旧 writer、不同会话及分页证明；解析器攻击与未知态；读取撤权后清除覆盖。
- 这些执行证据是实际本地受控命令与 HTTP 回归。写作/独立复核会话使用明确命名的离线协议 fixture，不构成真实模型完成源码/单测任务的验收。本批没有新增原生 GUI 或真实模型端到端验收。
- 支持的测试报告格式为 JUnit XML；其他格式必须由配置的真实命令输出 JUnit，否则为 unknown。未将模型的自报覆盖率/计数或普通节点成功数当成逐文件覆盖。
- 最终验证记录：6 项新 focused 测试通过；连同相关执行/快照/运行内容/模板目录/MCP 回归共 50/50 通过；全仓 `npm run typecheck` 与 `npm run build` 均退出 0。

## Lead 整合核对

- 补上旧形式的参数请求：新逐文件合同缺少 scope 时，只能从明确 targetPath 冻结真实 Git 源码；无范围拒绝创建，不能绕过证据合同。冻结模板参数同步传入实际执行提示，避免只保存但执行不消费。
- task-catalog-parity 与 template-history 共 6 项回归通过；历史目录测试按真实 v8 范围构造，旧任务不重新冻结。新增 opt-in template-file-evidence-live 测试用于检验实际模型写作、受控 JUnit 与独立复核，并显式经过每步验收接口；实时运行结果在完成后补记，不能把测试源码视为通过证据。

## 配置模型与正式 GUI 完整链路（Lead）

- 首次真实运行发现新目录写入 ENOENT；第二次写入与测试通过后，独立复核暴露无超时会话在 30 秒到期。两次均保留失败，不作为通过证据。修复见 `live-session-scope-2026-10-20.md` / `87c0e92`。
- 第三次隔离真实模型任务 `task_0mvflyxjb521o4s5zou`：读取、规划测试、写测试、运行测试、独立汇总 5 个既有步骤全部 succeeded，每步经实际节点验收接口后继续，最终 completed。`template-file-evidence-live.test.ts` 1/1 通过，退出 0；没有添加隐藏测试或复核节点。
- 真实写作 attempt `attempt_0mvflzwf28m2ld76pjg`，产物 `test/add.test.mjs`（536 bytes，SHA-256 `111e788d721f0acbd01b11b265af64aac94ac43f513d141d82ec7cb7ac0b7ddd`）。受控 `npm test` 签发 `trun_0mvfm0nekdikk9bfann`，实际 JUnit：3 passed / 0 failed / 0 skipped，退出码0。
- 独立复核 attempt `attempt_0mvfm0xj3dmzsmyqc74`，与 writer 不同实际 OpenCode session；服务核对同冻结 blob、同产物 hash、当前 testRunId，结论 confirmed。
- 在保留此真实模型数据库的独立读取服务中，通过正式 IAB 打开 Run 页：覆盖1/1、五次尝试、实际计数3/0/0；展开对应写作版本，读到真实测试源码、版本与hash；测试结果页展开命令argv及真实JUnit。截图在 `docs/evidence/file-evidence-live-2026-10-20/{coverage,writer-artifact,test-results}.png`。
- 这证明单文件最小源码单测链与阅读界面；多文件/大文件/失败/跳过/撤权/旧版本由上述离线/HTTP回归分别验证，不宣称全部模板和全部GUI状态完成。任务整体质量验收与交付仍独立，不以该测试通过替代。

- Run测试结果页四主题（deepseek/warm/spdb/github-white）通过界面切换，1280×720截图已逐张检查：计数、文字/图标、两栏布局正常；本项不扩大为三尺寸全矩阵。
