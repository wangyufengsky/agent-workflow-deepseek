# P11 数据库草稿探针与读取范围收口（2026-10-20）

基线 `6875566`；独立 worktree `parity-db-read`。本批未修改 live 测试、真实数据库配置、Node/Run/存储读取权限或 Inbox。

## 权威与范围

只读原稿 `originals/main/pages/databases.html`：L127 要求至少一个明确可读 schema；L155 说明类型、驱动和地址示例以服务实际清单为准；L218 说明检查不会保存设置；L221–223 的三格需要独立显示连接、会话只读和强制只读，缺失的标记保持未知；legacy-type/types-fail 分别只读查看和禁止编辑。

只实现当前已提供的 mysql2/pg 驱动路径；MySQL/MariaDB/GoldenDB 沿既有 mysql2，PostgreSQL 沿既有 pg。SQL Server、openGauss、GaussDB、Oracle、达梦和 DB2 明确作为未提供驱动的类型返回，带服务原因，不能测试或保存；没有用 pg 冒充 Gauss 驱动，也没有新增 JDBC/厂商驱动安装流程。

## 修复行为

- `POST /api/settings/databases/probe-draft` 接收 `{ connection }`，字段与连接保存表单一致。独立临时 DatabaseService 仅获得凭据读取能力，探针后关闭池；不注册到主连接列表，不写 settings、secret 或保存回执。
- 新连接必须输入密码。编辑留空仅在 type/host/port/database/user/SSL 目标完全相同时使用已有凭据；更改目标必须重新输入，保存路径采用相同规则，避免把存储密码转发到新目标。
- 表单新增“检查草稿（不保存）”、进行中、失败和成功反馈。修改/关闭/保存后使旧探针代次失效，旧响应不能写回当前草稿。失败保留输入，不替用户保存。
- 列表使用真实 lastProbe 和 sessionReadOnly 信息，三格不再固定“服务未提供”。配置改变后旧测量立即失效；完全相同的设置更新保留测量；旧目标迟到探针不会恢复新目标的“已连接”。失败重检也不能保留旧的只读成功结论。
- schema 必须明确、非空、无重复；表范围必须是已授权 schema.table。空表列表明确代表所授权 schema 的全部表。旧配置缺少 schemas 或为 [] 时查询返回 403，不能绕过守卫。未授权项目仍不能被任务发现/读取。
- 数据库驱动构造与探针异常都经过凭据脱敏；密码不会回显到响应或列表。

## 限定元数据 SQL

沿现有 `/api/settings/databases/:id/query` 与 MCP 查询入口工作，没有放宽全局 SHOW。语法参照 MySQL 官方 [SHOW TABLES](https://dev.mysql.com/doc/refman/8.4/en/show-tables.html)、[SHOW COLUMNS](https://dev.mysql.com/doc/refman/8.4/en/show-columns.html)、[SHOW INDEX](https://dev.mysql.com/doc/refman/8.4/en/show-index.html)，应用只接受可核对范围的封闭子集。

- `SHOW TABLES` 使用当前连接的 defaultSchema，且该 schema 必须显式获准；也可 `SHOW TABLES FROM report`。只有 schema 内全部表已授权时允许枚举；表级白名单非空时拒绝枚举，避免泄露未授权表名。
- `SHOW COLUMNS/FIELDS FROM report.orders`、`SHOW INDEX/INDEXES/KEYS FROM report.orders` 校验 schema 与表双重白名单；支持等价的 FROM/IN schema 形式和有效引用标识符；冗余 schema 前后不一致拒绝。
- 表/列可使用单个 LIKE 字面量；不接受任意 WHERE、EXTENDED、全局 DATABASES/PROCESSLIST/VARIABLES、编码或动态引用，也不接受无效 FULL INDEX / INDEX LIKE。
- `EXPLAIN SELECT ...` 继续核对内部所有表；不能用 `EXPLAIN secret.table` 绕过表范围。DESCRIBE/DESC 表引用沿原范围守卫；普通 ORDER BY ... DESC 不再被误当作表读取。
- 引号、跨 schema、跨表、子查询、多语句、注释、未知函数及既有写语句守卫仍生效。该元数据子集是 MySQL 家族语法，不宣称所有驱动都支持同一 SQL 方言。

## 验证与边界

- `npm run typecheck`、`npm run build:web` 通过（既有 bundle 体积提示）。
- 连接、范围、HTTP CRUD/回执、项目/会话冻结与即时撤权定向组合 45/45；最后按官方语法收紧无效 SHOW 的范围/草稿组合 9/9。
- 完整回归 531 项：520 通过、11 条件跳过、0 失败。
- 新服务回归验证成功/失败都关闭临时池，原 settings/list 不变、同目标空密码复用、更改目标拒绝复用、planned 驱动不派给其他驱动、配置变化与迟到探针隔离、失败重检清理旧只读结论、工厂异常脱敏、旧缺范围配置在连接前拒绝。
- 新真实 HTTP 回归调用实际 mysql2 连接已关闭的本地端口，验证草稿失败不保存；检查 schema/table 无效与空范围保存拒绝、直接密码复用目标变更拒绝、类型能力清单与缺驱原因。
- 旧离线 CRUD/回执测试夹具补明确 schema 和测试密码；修改目标的权限冻结夹具重新输入测试密码并检查保存响应，避免“保存失败后测试却继续跑”。没有修改设计稿、验收脚本或 database-live 测试。

真实 Chrome 打开生产 DatabasesPage + 实际临时 HTTP/SQLite：新增表单有草稿检查按钮、空 schema 时不可检查/保存；完整草稿不保存直接探针返回 ECONNREFUSED，输入保留；修改表单后旧探针消失；取消后连接列表仍为 0。SQL Server/openGauss/GaussDB 等选项带缺驱原因禁用。截图仅含离线测试值：

- [草稿探针失败与输入保留](../evidence/database-draft-2026-10-20/probe-failure.png)
- [取消后未保存连接](../evidence/database-draft-2026-10-20/not-saved.png)

关闭端口测试只证明离线控制流与真实网络派发，不能作为成功连接数据库、真实模型或厂商兼容验收。成功测量状态用驱动 seam 验证投影；真实本机 MySQL 联调由 Lead 使用已有授权配置复跑，不在此记录凭据。临时浏览器标签和夹具服务/页面源码已清理。
