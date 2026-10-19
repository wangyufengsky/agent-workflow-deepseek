# PPT 内容生产与作品管理 · 第一批 · 2026-10-20

设计依据为只读 `originals/main/pages/ppt.html`、`ppt-works.html`、`ppt-studio.html`，尤其需求简报、三个视觉方向、制作检查、作品复制/归档与版本入口。本批仅接通下列可独立审查范围，不宣称全部 PPT 设计一致性已完成。

实现：

- 五项简报（给谁看/想达到/篇幅/风格/依据资料）保存并进入真实模型调用提示；三个视觉方向独立于应用皮肤，影响模型提示、当前内容预览与 PPTX 配色。
- 当前作品封面与每一页由真实内容渲染 SVG；原卡片占位线条已移除。SVG、规则检查、可编辑 PPTX 共用显式文本框布局；正文、演讲备注和页面图片可编辑。引用图片来自已有附件，没有生成不存在的图片。
- 当前修订检查包括空标题/正文、文本框越界、大纲不一致、缺备注、素材已移除。未发现这些问题不会被称为“视觉验收通过”；事实依据、素材授权、字体替换/实际投影效果保留人工核对。
- 复制、归档/恢复、内容版本恢复有客户端请求号和回执；归档作品不可修改。持久内容修订支持并发版本冲突和最近30次历史；恢复创建新修订且保持当前附件。SQLite migration 12 增加 metadata_json，旧作品按修订1读取。
- 编辑输入保留原修订；版本冲突不清空本地内容。生成中的复制/归档/改写被阻止。未idle或超时的模型结果保持UNKNOWN并阻止新key重派；启动遗留未知生成的服务禁用原因和原key会投影到作品列表。

验证：`npm run typecheck`、`npm run build:web`、`git diff --check` 通过。`node --import tsx --test tests/integration/ppt-production.test.ts tests/integration/ppt-works.test.ts tests/integration/ppt-startup-recovery.test.ts`：5/5 通过。新集成测试起真实服务/临时SQLite，验证持久重开、版本冲突、真实内容SVG/XML转义、导出PPTX可编辑文字与备注XML、复制回执、归档锁/恢复及历史恢复；受控模型端口验证简报/方向真实进入调用与timeout原key锁，不是provider live。

Electron临时数据GUI：独立localhost服务、手工编辑的真实作品，四主题 × 1440/1280/1024 共12张检查页截图，无脚本错误、横向溢出或图片加载失败；另验证五个简报字段存在、点击“浅色编辑”后服务持久值实际改变。使用兼容flags与隐藏Electron BrowserWindow，不代表默认打包Electron启动验收或模型live。证据位于 `docs/evidence/ppt-production-2026-10-20/`；零脚本错误与内容图像加载仅证明该批路径，不是像素差异验收。

仍属本目标必做：设计的七模块制作方案抽屉、对象级版式编辑、生成停止/原进程终态核对将在下一独立提交继续。品牌模板、PDF、真实provider与实际导出打开后的字体/投影效果以及逐状态四主题截图对照尚未覆盖，不降为可选。

测试口径变更：旧startup recovery测试曾期待未就绪503；本批在能力检查前新增“原生成未知禁止再派发”，对应断言改为409 RECEIPT_UNKNOWN并核对原key。没有修改设计稿或验收脚本。
