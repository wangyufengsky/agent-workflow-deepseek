import type { TemplateRunFile } from '@agent-workflow/shared';
import { Badge } from '../../components/Badge.tsx';
import { ArtifactDetailView } from '../node/ArtifactDetailView.tsx';
export function RunSourceFileProof({ taskId, file }: { readonly taskId: string; readonly file: TemplateRunFile }) {
  return <div className="col" style={{ gap: 8 }}><div className="row wrap"><Badge icon={file.writing ? 'check' : 'clock'}>写作：{file.writing ? '证据已提交' : '待提交'}</Badge><Badge icon={file.review?.verdict === 'confirmed' ? 'check' : file.review ? 'alert' : 'clock'}>独立复核：{file.review?.verdict === 'confirmed' ? '通过' : file.review ? '未通过' : '待复核'}</Badge></div>{file.writing ? <p className="hint">{file.writing.summary}</p> : null}{file.review ? <p className="hint">{file.review.rationale}</p> : null}{file.writing?.artifacts.map((artifact) => <details key={`${artifact.sourceAttemptId}:${artifact.id}`} className="card pad"><summary>{artifact.path ?? artifact.name} · 对应写作版本</summary><ArtifactDetailView taskId={taskId} artifact={artifact} attemptLabel="逐文件写作产物" /></details>)}</div>;
}
