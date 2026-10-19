# Claude 补充设计结果（B 类 15 项）

设计已完成，全部放在设计稿目录 `/Users/wangyufeng/Documents/r05-site-design/deepseek/`（本交接包只加了这一份对照说明，未改动包内其他文件）。

- 打开 `index.html` → 「补充设计 · 15 项」可逐项进入原型；页面底部「原型状态」切换各状态，「皮肤」切换四套皮肤。
- 逐项说明（入口、原实现问题、改成了什么、状态、保留的业务边界、与 React 字段/动作的对应）见 `REVIEW.md` 第二部分 `## B-01` … `## B-15`。
- 产品名：设计稿内产品名已统一从 Looper 改为 opencode-workflow（侧栏品牌、页面标题、说明文案、示例数据）；接口头 `X-Loopper-Local-UI` 等代码标识未改。
- 皮肤：只保留 deepseek / warm / spdb / github-white 四套；`skin-map.html` 与 `assets/skins.css` 已去掉科技蓝。
- 原有页面中的新状态均以「补充 · 」开头追加在状态列表末尾；原有状态表现不变（逐像素比对）。所有新样式只用令牌，295 个原型状态无脚本错误、无横向溢出。

## 对照表

| 项 | 设计位置 | 原型状态 |
| --- | --- | --- |
| 01 独立恢复工作台 | `pages/recovery.html`（新页面） | default, all, verify, creating, created, multi, ineligible, unknown, create-failed, loading, error, no-parent |
| 02 职业已发布版本核对 | `pages/roles.html` | pub-draft, pub-view, pub-unchecked, pub-loading, pub-error, pub-dep, pub-dirty-switch, pub-conflict, pub-unknown |
| 03 职业已发布权限预估 | `pages/roles.html` | perm-pv-none, perm-pv-pick, perm-pv-loading, perm-pv-result, perm-pv-notools, perm-pv-diag, perm-pv-error |
| 04 历史角色配置工作台 | `pages/roles-legacy.html`（新页面） | catalog, loading, overview, perms, prompt, history, history-open, compare, pending, import-validating, import-ok, import-invalid, import-nodiff, import-replace, back-confirm, publish-unknown, read-error, search-empty |
| 05 需求高级澄清与规划 | `pages/requirement.html` | pl-config, pl-rounds, pl-stop-unknown, pl-stopping, pl-package, pl-package-noproof, pl-map-ok, pl-map-bad, pl-precheck, pl-apply-confirm, pl-reject-confirm, pl-applied, pl-unavailable, pl-conflict, pl-loading, pl-error, pl-empty |
| 06 历史模板与自动化档案 | `pages/templates.html` | arc-overview, arc-templates, arc-rules, arc-run, arc-verify-ok, arc-verify-fail, arc-export, arc-loading, arc-error, arc-empty |
| 07 快照评审运行专用区域 | `pages/task.html` | snap-full, snap-light, snap-batches, snap-batches-loading, snap-batches-empty, snap-batches-error, snap-report, snap-report-loading, snap-report-read, snap-report-error, snap-cancelled |
| 08 知识研究员检查面板 | `pages/knowledge.html` | rs-welcome, rs-full, rs-partial, rs-hist, rs-loading, rs-denied, rs-changed, rs-stale, rs-notools |
| 09 PPT 七模块制作方案 | `pages/ppt-studio.html` | pl-brief, pl-narrative, pl-frozen, pl-slides, pl-visual-bad, pl-assets, pl-notes, pl-delivery, pl-saving, pl-conflict, pl-review, pl-ro-active, pl-ro-archived, pl-loading, pl-error, pl-blocked |
| 10 OpenCode 自动检测选项 | `pages/settings.html` | conn-auto |
| 11 设计监控间隔 | `pages/settings.html` | monitor, monitor-range |
| 12 会话异常阈值与细分超时 | `pages/settings.html` | limits-off, limits-on |
| 13 五种扩展数据库类型 | `pages/databases.html` | og-new, dm-probe, db2-fail, gd-edit, legacy-type, types-fail |
| 14 Skill 带行号源文 | `pages/tools.html` | skill-raw, skill-empty, skill-read-fail |
| 15 现有需求目录与详情 | `pages/requirements.html`（新页面） | list, selected, filtered, project-empty, empty, loading, error, project-error, more |

## 实现时需要注意 / 待确认

1. 按钮文字凡来自语义注册表（不在交接包内），原型按语义写，以注册表实际文案为准；`displayLabel`、`workflowStateLabel`、`templateBatchPurpose`、`roleToolStatus`、`permissionMode` 等映射同理。
2. 原型里有几处有意偏离现有 React 写法，均属展示层，不改接口：
   - B-07：阶段报告「下载」未读取时显示为禁用并说明原因（原实现是隐藏）。
   - B-09：只读时隐藏「保存方案」；文字密度改为分段控件（存值不变）；方案在原型里是带遮罩的抽屉，React 可保持右侧非模态面板。
   - B-14：行号放在独立的不可选中列，复制原文不带行号；新增「复制原文」；正文为空时禁用视图切换。
   - B-06：运行详情固定在页签下方。
3. 展示层推导、需要实现侧确认有无数据的：B-01 恢复阶段条（按模式推导复制哪些阶段）；B-05「第 N 轮」序号；B-07 功能批次总数（reviewBatches + contributorBatches）；B-15 列表行「所属项目」（行数据无项目字段时去掉）。
4. B-15「打开画布」：原型里规划中 / 待开始进 `requirement.html`，执行中及之后进 `task.html`；React 统一为 `/requirements/:id`，按实际路由即可。
5. B-10（已确认）：托管选项文案为「由程序托管」，替换源码中的「由 Loopper 托管」；「服务地址」在「自动检测」与「连接现有服务」两种方式下都会用到。
6. B-13：JDBC 示例与驱动文件名为占位，实际取 `databaseUrlExamples` 与 `metadata.types[].binaries`；GoldenDB 示例按 MySQL 风格写。
7. 新入口：任务页「更多 → 任务恢复…」、需求画布「更多操作 → 澄清与规划…」、模板页页头「历史任务 / 历史模板与自动化记录」、PPT 工作台「作品菜单」、职业页页头「历史角色配置」（原型里只在补充状态显示，实现时应常驻页头）。
