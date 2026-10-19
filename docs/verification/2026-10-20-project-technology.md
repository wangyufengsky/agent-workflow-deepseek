# 项目技术栈与当前分支事实 · 2026-10-20

基线818bf6c。设计依据：只读 originals/main/pages/projects.html:147–148 的当前分支/技术栈事实、193概览技术栈、289新登记初始“待识别”。此前没有服务技术栈字段；卡片和概览还把defaultBranch当当前分支，这两处已修复。

## 契约与实际来源

Project.facts投影独立technology和branch事实：识别状态detected/unknown/unavailable、技术名、相对manifest路径、字节数、SHA-256、检查时间、警告和截断。register/recheck从实际目录识别后持久保存；list/detail/重启回读同一检查事实。旧项目没有事实时显示待识别，可用已有“重新检测”更新；没有在每次bootstrap读取整个项目。

- 只静态读取常见根manifest，以及apps/packages/services下一层子项目。最多32个文件、每文件64KiB、总512KiB，深度最多2；每个容器最多检查64目录项、8个子目录。不递归node_modules、任意项目目录或读源代码。
- package.json依赖识别React/Vue/TypeScript等；Maven/Gradle、Python、Go、Rust、Composer、Ruby、Swift、CMake按实际声明识别。结果仅是静态声明，不代表依赖已安装、项目可运行或整仓完整语言清单。未支持/不可解析的格式不会通过模型猜测补全；复杂JSONC/动态构建配置可能未识别，显示警告/未知。
- 拒绝符号链接文件和目录、越界或读取前后路径/设备/inode变化，文件句柄使用O_NOFOLLOW，读取前后核对大小/mtime；拒绝XML DTD/ENTITY、二进制、过大和变化文件。不执行项目代码、脚本、安装依赖或联网。
- GitPort新增可选head只读端口；真实GitCliAdapter只执行symbolic-ref和rev-parse，不执行git status/fsmonitor或hook。真实当前分支、unborn、detached分开记录，失败不替代成defaultBranch。卡片/概览显示检查时点，明确重新检测可更新；Git页签实际status不存在时也不再回退默认分支。
- 列表和详情展示文字+图标、当前检查时间，详细来源可展开；空目录“未识别”、不可访问“无法识别”，不填演示技术栈。没有新增数据库迁移或写入项目文件。

## 针对验证

- project-technology.test.ts 3/3：真实manifest/依赖与hash；有界monorepo；越界symlink/无效JSON/实体/超大/缺失目录；真实Git默认main但当前feature分支、detached、重新识别/重启保持；配置可执行fsmonitor夹具，应用登记/重检不触发它。测试的人工git checkout可能触发夹具hook，随后清理该标记再独立检查应用重检，不把测试准备动作误算应用执行。
- 技术栈/项目重检/归档/目录回执组合9/9通过。project-config-consumers组合旧Charter超时用例有一次时序失败（actual succeeded vs expected unknown），独立复跑8/8通过；已给Lead完整日志并由Lead当前Charter批改为等待可观察dispatch。本批未改Charter区域/fixture去隐藏失败。
- 全仓typecheck和生产build退出0；git diff --check通过。没有真实模型调用或远端写。

## 正式GUI

Chrome CUA连接独立实际服务5517/Web5513和真实临时Git/manifest：

1. 项目卡片分别显示检测到React/TypeScript、空目录未识别、缺失路径无法识别；当前分支feature/gui-current与默认main明确不同。
2. 详情展开真实package.json、89字节和SHA-256来源。
3. 修改测试项目实际package.json的React为Vue后，CUA点击“重新检测”，实际回执显示原请求号，界面技术栈变为Vue，来源变86字节与新hash，检查时间更新。不是切静态演示状态。

截图：/tmp/project-stack-list.png、/tmp/project-stack-detail-source.png、/tmp/project-stack-recheck-vue.png。本批未做四主题三尺寸/所有文件系统竞争GUI验收；严格路径/恶意输入由针对测试覆盖。

另只报告未扩范围：项目GitLab配置卡“证据来源配置服务未提供”需要下一独立包按设计具体行为核对；Lead当前Charter真实上下文读取批与本批不交叉。
