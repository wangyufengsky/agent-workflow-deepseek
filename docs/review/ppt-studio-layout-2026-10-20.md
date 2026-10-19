# P08 逐页工作台结构验收（2026-10-20）

基线 c925b00。保持既有真实助手候选审阅、原 key 回执、停止协调、PDF/PPTX 导出链；本批改动限 PPT 页面及针对测试。

## 已落地

- 左侧真实页面缩略图、选中状态与键盘导航、加页；中央仅显示当前页面、手动对象选择和可编辑演讲备注；右侧为 PPT 助手 / 对象属性 / 检查三页签。共享 SVG 渲染继续用于实际页面和缩略图。
- 对象文字、字号、主题颜色、对齐、备注经 expectedRevision 和 requestKey 保存；保留其他页面与人工样式。服务检查问题可定位到对应页面。
- 页面、页签、对象选择、未保存人工草稿经 sessionStorage 恢复；URL 标识当前作品。旧修订草稿禁止覆盖新修订，可明确丢弃。讨论、简报和方案在自身无未保存修改时随服务修订刷新，保留人工脏草稿。
- 资料与历史版本为独立抽屉；制作方案继续使用原七模块与确认流程。助手仅页范围绑定中央当前页；封面计入可见页序号，后端 slide 索引保持原契约。

## 验证

- typecheck、web build、desktop build 通过。
- 正常 node --test 路径的 PPT studio / assistant-export / plan-stop / production / works / startup-recovery / routes-contract：20/20 通过。组件夹具只忽略 CSS 导入，视觉由 CUA 单独核验；未修改验收脚本。
- 独立 5398 服务，Chrome CUA，1512×790 视口：选页、对象编辑保存、翻页返回保留草稿、刷新恢复草稿与备注、服务修订 r5→r8、字号 72 触发真实溢出检查并定位后恢复 16、页签键盘导航、资料及版本抽屉、制作方案显示已保存 r8，均观察到真实服务状态。
- 四主题 CUA 截图：`/tmp/p08-layout-evidence/{deepseek,warm,spdb,github-white}.png`；真实检查失败：`check-issues.png`；对象编辑：`object-properties.png`；当前页与助手范围：`assistant-scope.png`。临时夹具与截图未提交。
- 本批没有重新调用模型或重新验收原生导出。真实模型与原生 PDF 的先前证据见 ppt-assistant-pdf-2026-10-20.md，不将本次浏览器验证当作原生验证。

## 尚未闭环

生成服务仍以整份演示返回最终 slides；未形成逐页 pending / generating / completed 的真实持久契约，因此设计中的逐页混合生成中状态仍是必须补齐的实施项。本批不以模拟页状态冒充服务事实。窄视口、原生窗口本批结构交互尚未重新验收；不据此声称全 P08 状态完全通过。
