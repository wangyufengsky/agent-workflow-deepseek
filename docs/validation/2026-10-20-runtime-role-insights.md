# P12 运行时与职业服务数据闭环（2026-10-20）

## 权威与范围

按只读 `opencode-workflow-design-showcase/originals/main/REVIEW.md` §20、§23、B-03 及 runtime/roles 页面实现。此批不修改设计稿或验收脚本，不修改知识页、PPT 或主任务板。

## 运行时

- 新增显式 start 与已有 restart 的真实回执命令，均要求确认字段与 requestKey；重复请求（包括 accepted）只返回原回执，不再次执行。启动失败后释放 startup promise，可以用新请求重试。
- 页面先显示操作确认，再提交；结果以原请求回执为准。连接超时、协议丢失等未知结果保留原 requestKey，只允许 operations.by-key 核对；读取正常进程状态不等于上一操作成功。
- 历史来自本机 operations ledger，单独筛选最近 30 条手动 start/restart；不把自动启动、示意数据或当前健康状态变成历史成功。显示真实失败原因。进程代次按真实 startedAt/PID 标识，缺失时显示未知。
- adapter 维护锁先同步阻断新请求，再检查；等待 ensureReady 的调用已计入 pending，避免“无会话检查之后才进入新会话”竞态。释放函数幂等，不会解锁后来的维护窗口。
- 重启拒绝所有 running/pausing/unknown 执行或 running/unknown 节点，包括不再被 task.executionId 指向的历史执行；也拒绝待运行、运行中、停止中或未知规划/评审/修复，以及待核对知识问答或当前实际活动会话。返回对象 ID/请求号用于先停止并核对。没有使用 pause 冒充远程会话已经停止。
- 已就绪/部分可用进程还必须读取真实 `/session/status`，非 idle 或读取失败均在 stop 前拒绝，不用本地计数证明远端已闲置。
- 非受管、未知、启动中状态拒绝不适当操作，无法读取诊断时不继续 stop。此批采用安全拒绝，未实现强制中断全局会话的一键重启。

## 职业

- 已发布 allowedSlots 作为角色快照字段，经默认解析、草稿、发布历史和恢复保留。本产品当前可计算的位置为受控工作区执行与只读执行；不是虚构原型中的槽位运行能力。历史未有该字段时按当前受支持执行位置解析，新发布修订冻结该清单。
- 权限卡始终显示；显式核对发布修订后仅列该修订 allowedSlots。读取为 GET，无配置或操作回执写入；发布变化则 STALE_TARGET，不混用草稿。位置不允许则 FORBIDDEN。切换位置、重读或失败立即清空旧预估。
- 工具上限交集取已发布资源声明、能力、全局工具注入/策略及只读位置限制。永久提示“预估不等于实际授权”；项目策略、实例文件路径、命令 argv、数据库项目/schema/table、实际工具发现和外部身份仍由运行时收紧，未计算项明确列为诊断，空工具表不表示无限权限。
- 服务提供可选形象目录；选择进入已有编辑草稿，经过保存/发布生效，历史冻结形象不被覆盖。保存锁定/结果未知期间禁用候选。
- 使用统计来自当前有效流程的规划职责与实际步骤、模板实际步骤，以及各任务最新已确认计划的真实 roleSnapshot 节点；显示口径，不把示例计数或一般节点数伪装成职业使用。

## 验证

- `npm run typecheck`：通过。
- `node --import tsx --test tests/integration/runtime-role-insights.test.ts tests/integration/routes-contract.test.ts tests/integration/roles-api.test.ts tests/integration/role-catalog-extended.test.ts tests/integration/tool-access-policy.test.ts`：14/14 通过。
- `npm run build:web`：通过；保留已有 shared/errors.ts duplicate-case 与 Vite 大 chunk 提示。
- 证据日志：`/tmp/parity-p12-typecheck-final.log`、`/tmp/parity-p12-tests-final.log`、`/tmp/parity-p12-build-final.log`。
- runtime route 测试使用明确的进程管理器 seam，不产生模型结果；实际 Fastify、SQLite ledger、HTTP 职业接口与目录/策略被调用。adapter 测试覆盖维护锁、等待启动请求及旧 release 竞态。

## 未验收边界

没有进行真实受管 OpenCode 启动/重启或 opencode-go 模型调用，没有 Electron 四主题原生 GUI 验收，不把 HTTP/构建通过当作这些证据。外部 MCP 完整发现与身份能力仍是 P11 明确未覆盖项；本预估没有暗中宣称接通。当前服务不强制中断活跃任务后重启，而是明确拒绝并给出先停止/核对原因。
