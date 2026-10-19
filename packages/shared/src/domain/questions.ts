import { AppError, ErrorCode } from '../errors.ts';

export interface QuestionOption {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly recommended?: boolean;
}
export interface QuestionChoices {
  readonly options?: readonly QuestionOption[];
  readonly multiple?: boolean;
  readonly allowOther?: boolean;
}
export interface QuestionAnswer {
  readonly values?: readonly string[];
  readonly other?: string;
}

/** Model-supplied choices are data, validated before they are persisted. */
export function questionChoices(value: QuestionChoices): QuestionChoices {
  const invalid = () => { throw new AppError(ErrorCode.VALIDATION_FAILED, '问题选项格式不合法'); };
  if (value === null || typeof value !== 'object') return invalid();
  if (value.multiple !== undefined && typeof value.multiple !== 'boolean') return invalid();
  if (value.allowOther !== undefined && typeof value.allowOther !== 'boolean') return invalid();
  if (value.options === undefined) {
    if (value.multiple === true || value.allowOther === false) return invalid();
    return {};
  }
  if (!Array.isArray(value.options) || value.options.length === 0 || value.options.length > 20) return invalid();
  const ids = new Set<string>();
  for (const option of value.options) {
    if (option === null || typeof option !== 'object' || typeof option.id !== 'string' || !/^[a-zA-Z0-9_.-]{1,64}$/.test(option.id) || ids.has(option.id) || typeof option.label !== 'string' || !option.label.trim() || option.label.length > 500 || (option.description !== undefined && (typeof option.description !== 'string' || option.description.length > 2000)) || (option.recommended !== undefined && typeof option.recommended !== 'boolean')) return invalid();
    ids.add(option.id);
  }
  if (!value.multiple && value.options.filter((option) => option.recommended).length > 1) return invalid();
  return { options: value.options.map(({ id, label, description, recommended }) => ({ id, label, ...(description === undefined ? {} : { description }), ...(recommended === undefined ? {} : { recommended }) })), multiple: value.multiple ?? false, allowOther: value.allowOther ?? true };
}

/** Store display text alongside exact option IDs; never trust client labels. */
export function normalizeQuestionAnswer(question: QuestionChoices, input: QuestionAnswer & { readonly answer?: string }): { answer: string; values?: readonly string[]; other?: string } {
  const choices = questionChoices(question);
  if (input.values !== undefined && (!Array.isArray(input.values) || input.values.some((value) => typeof value !== 'string'))) throw new AppError(ErrorCode.VALIDATION_FAILED, '答复选项必须是字符串数组');
  if (input.other !== undefined && typeof input.other !== 'string') throw new AppError(ErrorCode.VALIDATION_FAILED, '其他答复必须是文字');
  if (input.answer !== undefined && typeof input.answer !== 'string') throw new AppError(ErrorCode.VALIDATION_FAILED, '答复必须是文字');
  const values = [...(input.values ?? [])]; const other = input.other?.trim() ?? '';
  if (choices.options === undefined) {
    const answer = input.answer?.trim() ?? [...values.map((value) => value.trim()).filter(Boolean), ...(other ? [other] : [])].join('；');
    if (!answer || answer.length > 16000) throw new AppError(ErrorCode.VALIDATION_FAILED, '答复不能为空且不能超过16000字');
    return { answer };
  }
  if (new Set(values).size !== values.length || values.some((value) => !choices.options!.some((option) => option.id === value)) || (!choices.multiple && values.length > 1) || (other !== '' && !choices.allowOther)) throw new AppError(ErrorCode.VALIDATION_FAILED, '答复选项不属于此问题、重复或超出单选限制');
  const ordered = choices.options.filter((option) => values.includes(option.id));
  const answer = [...ordered.map((option) => option.label), ...(other ? [`其他：${other}`] : [])].join('；');
  if (!answer || answer.length > 16000) throw new AppError(ErrorCode.VALIDATION_FAILED, '请选择选项或填写其他答复');
  return { answer, values: ordered.map((option) => option.id), ...(other ? { other } : {}) };
}
