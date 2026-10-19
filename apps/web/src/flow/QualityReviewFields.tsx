import type { QualityReviewContract } from '@agent-workflow/shared';
export function QualityReviewFields({ id, value, disabled = false, onChange }: { readonly id: string; readonly value?: QualityReviewContract | null; readonly disabled?: boolean; readonly onChange: (value: QualityReviewContract | undefined) => void }) {
  return <div className="field">
    <label className="label" htmlFor={`${id}-kind`}>独立 AI 评审</label>
    <select id={`${id}-kind`} className="select" disabled={disabled} value={value?.kind ?? ''} onChange={event => onChange(event.target.value ? { kind: event.target.value as QualityReviewContract['kind'], criteria: value?.criteria ?? [] } : undefined)}>
      <option value="">未配置（通用验证）</option><option value="requirement">需求评审</option><option value="risk">风险评审</option>
    </select>
    {value ? <><label className="label" htmlFor={`${id}-criteria`}>评审条款（每行一条，必填）</label><textarea id={`${id}-criteria`} className="textarea" readOnly={disabled} value={value.criteria.join('\n')} onChange={event => onChange({ ...value, criteria: event.target.value.split('\n').map(line => line.trim()).filter(Boolean) })} /><p className="hint">配置随任务计划冻结；AI须逐条提交结论与实际读取依据。不会给其他任务增加评审步骤。</p></> : null}
  </div>;
}
