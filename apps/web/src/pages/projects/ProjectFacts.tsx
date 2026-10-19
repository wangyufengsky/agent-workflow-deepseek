import type { Project } from '@agent-workflow/shared';
import { Icon } from '../../components/Icon.tsx';
import { formatAbsoluteTime } from '../../app/format.ts';
export function ProjectBranchValue({ project }: { readonly project: Project }) {
  const branch = project.facts?.branch;
  const value = project.gitState === 'not_git' ? '直接执行目录' : branch?.kind === 'detached' ? `分离 HEAD · ${branch.sha?.slice(0, 8) ?? '未知'}` : branch?.name ?? (branch ? '未知' : '待检测');
  return <span className="mono" title={branch ? `检测于 ${formatAbsoluteTime(branch.checkedAt)}；重新检测更新当前事实` : '尚无当前分支事实；默认分支不代表当前分支'}>{value}</span>;
}
export function ProjectTechnologyValue({ project, detailed = false }: { readonly project: Project; readonly detailed?: boolean }) {
  const fact = project.facts?.technology;
  const text = fact?.state === 'detected' ? fact.technologies.join(' · ') : fact?.state === 'unavailable' ? '无法识别' : fact ? '未识别' : '待识别';
  const reason = fact?.reason ?? (fact ? `依据 ${fact.sources.map((source) => source.path).join('、') || '未找到支持的manifest'}；检测于 ${formatAbsoluteTime(fact.checkedAt)}` : '登记或重新检测后显示真实manifest识别结果');
  return <><span className="row" style={{ gap: 4 }} title={reason}><Icon name={fact?.state === 'detected' ? 'check' : 'help'} size="sm" />{text}</span>{detailed ? <><p className="hint">{reason}。仅静态依赖声明，不代表运行环境或依赖已安装。</p>{fact ? <details><summary>识别依据与读取范围</summary><p className="hint">检测于 {formatAbsoluteTime(fact.checkedAt)}；点击“重新检测”更新。{fact.truncated ? '达到有界读取上限，结果可能不完整。' : ''}</p>{fact.sources.map((source) => <p className="hint mono" key={source.path}>{source.path} · {source.bytes} B · SHA-256 {source.sha256}<br />{source.technologies.join(' · ') || '未识别声明'}</p>)}{fact.warnings.map((warning) => <p className="hint" key={warning}>{warning}</p>)}</details> : null}</> : null}</>;
}
