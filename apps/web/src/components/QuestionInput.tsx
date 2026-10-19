import type { QuestionAnswer, QuestionChoices } from '@agent-workflow/shared';
import { Badge } from './Badge.tsx';
import './question-input.css';

export interface QuestionDraft { readonly values: readonly string[]; readonly other: string }
export function questionDraft(question: QuestionChoices & QuestionAnswer & { readonly answer?: string }): QuestionDraft {
  return { values: question.values ?? [], other: question.options === undefined ? question.answer ?? '' : question.other ?? '' };
}
export function hasQuestionAnswer(draft: QuestionDraft): boolean { return draft.values.length > 0 || draft.other.trim() !== ''; }
export function QuestionInput({ id, title, question, value, disabled, onChange }: {
  readonly id: string; readonly title: string; readonly question: QuestionChoices; readonly value: QuestionDraft;
  readonly disabled: boolean; readonly onChange: (value: QuestionDraft) => void;
}) {
  return <fieldset className="question-input" disabled={disabled}>
    <legend className="sr">{title}</legend>
    {question.options?.map((option) => <label className={`question-choice${value.values.includes(option.id) ? ' selected' : ''}`} key={option.id}>
      <input name={id} type={question.multiple ? 'checkbox' : 'radio'} checked={value.values.includes(option.id)} onChange={() => onChange({ ...value, values: question.multiple ? value.values.includes(option.id) ? value.values.filter((id) => id !== option.id) : [...value.values, option.id] : [option.id] })} />
      <span className="grow"><span className="row wrap" style={{ gap: 8 }}><b>{option.label}</b>{option.recommended ? <Badge tone="accent">推荐</Badge> : null}</span>{option.description ? <span className="hint">{option.description}</span> : null}</span>
    </label>)}
    {question.options === undefined || question.allowOther !== false ? <textarea className="textarea" rows={question.options === undefined ? 3 : 2} aria-label={question.options === undefined ? `回答：${title}` : `其他回答：${title}`} placeholder={question.options === undefined ? '写下你的答复…' : '其他回答（可选）'} value={value.other} onChange={(event) => onChange({ ...value, other: event.target.value })} /> : null}
  </fieldset>;
}
