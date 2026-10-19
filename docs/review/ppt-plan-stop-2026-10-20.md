# PPT 制作方案、对象编辑与停止 · 第二批 · 2026-10-20

设计依据为只读 `opencode-workflow-design-showcase/originals/main/pages/ppt-studio.html` 的对象属性及七模块制作方案（第 206、240 行起），延续第一批内容生产与作品管理。本提交实现本批范围，不代表全部 PPT 或全仓设计验收完成。

- 480px 制作方案抽屉包含制作目标、叙事结构、页面内容、视觉规范、图表素材、演讲辅助、交付设置七模块。方案保存到作品，生成提示实际消费方案；确认后冻结方向，重新打开才可改，现有页面和版本保留。并发修订冲突保留本地编辑；制作中、归档、未知回执均受服务禁用原因约束。非法色值不能保存。
- 封面及正文的标题、正文、小标签可选择并编辑文字、字号、颜色和对齐。浏览器草稿预览与服务缩略图共享无运行时依赖的 SVG 渲染器，保存后 native PPTX 使用同一显式文本框参数。页面版式、密度、字体、强调色、引用附件和演讲备注进入实际产物，交付文件名与是否包含备注也实际生效。
- 持久生成协调器记录原请求号、会话与停止请求号。停止受理和 abort 回答不等于原进程已停止；只有对应会话明确 idle，或会话绑定回调在 prompt 派发前证实停止，才结算停止。超时/abort 失败保持 UNKNOWN，原 key 查询核对且不重发；旧会话 idle 与旧生成结果不能覆盖新一代。停止结算保留原有页面和修订，前端显示“已停止”而不是“生成成功”。
- 新 stop 路由已定义 `ROUTES.pptWorkStop`。通用 operations 查询新增 PPT reconcile；整合时需保留 Lead 已加入的其他领域 reconcile。未改设计稿、验收脚本或知识模块。

验证通过：`npm run typecheck`、`npm run build:web`、`git diff --check`；构建仅有已有大包警告。组合回归 `node --import tsx --test tests/integration/ppt-plan-stop.test.ts tests/integration/ppt-production.test.ts tests/integration/ppt-works.test.ts tests/integration/ppt-startup-recovery.test.ts` 共 11/11 通过。新增测试证明 abort 仅受理、timeout/abort 失败不误结算、会话建立前停止不派发 prompt、旧结果/旧 idle 不污染新代、七模块验证/冻结，以及 PPTX 内实际字号/对齐/标签/备注策略。

GUI 证据位于 `docs/evidence/ppt-plan-stop-2026-10-20/`。独立 localhost 服务、临时 SQLite 和兼容 flags 的 Electron BrowserWindow 验证七模块、非法色值禁用、保存强调色真实持久、对象标题与字号40/居中真实持久，无脚本错误。另用受控模型端口验证真实页面点击生成→停止→确认→终态，并等候延迟旧结果后确认原始两页仍保留；该端口明确不是 provider live。截图是 1280px 当前内容/方案/停止证据，不能替代四主题全状态像素对照或默认打包 Electron 验收。

尚未验证或覆盖：真实 provider 的运行中停止与断线恢复、导出在 PowerPoint 中打开后的字体替换/投影效果、所有方案状态逐个四主题截图对照、设计品牌模板/PDF/助手对话完整链。缩略图是实际内容 SVG，并非设计中的 PNG 产物。以上仍属总目标待完成边界，不能据此宣称全部 PPT 一致性完成。
