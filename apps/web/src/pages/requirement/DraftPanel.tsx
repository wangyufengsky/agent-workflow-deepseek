import { QuestionInput, questionDraft, hasQuestionAnswer, type QuestionDraft } from '../../components/QuestionInput.tsx';
import { useEffect, useState } from 'react';
import type { ActionAvailability, PlanningRound, SaveAnswerRequest } from '@agent-workflow/shared';
import { Badge } from '../../components/Badge.tsx';
import { Icon } from '../../components/Icon.tsx';
import { Button } from '../../components/Button.tsx';
import { ActionReasonLine } from '../../flow/workflow-ui.tsx';
import { PanelEmpty, Section } from './requirement-ui.tsx';

export interface DraftPanelProps {
  readonly round?: PlanningRound;
  readonly requirementRevision?: number;
  readonly saveAnswerAction?: ActionAvailability;
  readonly busy: boolean;
  readonly lockedReason?: string;
  readonly onLocateNode?: (nodeId: string) => void;
  readonly onSaveAnswers: (answers: SaveAnswerRequest['answers']) => void;
}

/**
 * “草稿与问题” tab: checkpoint coverage, model questions/assumptions and the
 * answer saving path. Assumptions stay labelled as model claims, never as facts.
 */
export function DraftPanel({ round, requirementRevision, saveAnswerAction, busy, lockedReason, onLocateNode, onSaveAnswers }: DraftPanelProps) {
  const [answers, setAnswers] = useState<Record<string, QuestionDraft>>({});

  useEffect(() => {
    setAnswers({});
  }, [round?.id]);

  if (round === undefined) {
    return <PanelEmpty icon="file" title="尚无规划轮次" description="开始规划后，检查点覆盖与模型提出的问题会出现在这里。" />;
  }

  const questions = round.questions;
  const assumptions = round.assumptions;
  const answered = questions.filter((question) => answers[question.id] !== undefined && hasQuestionAnswer(answers[question.id]!));
  const answeredNow = questions.filter(
    (question) =>
      question.answer !== undefined ||
      (answers[question.id] !== undefined && hasQuestionAnswer(answers[question.id]!)),
  );
  const missingRequired = questions.filter(
    (question) =>
      question.required &&
      question.answer === undefined &&
      (answers[question.id] === undefined || !hasQuestionAnswer(answers[question.id]!)),
  );
  const allAnswered = missingRequired.length === 0;
  const nodes = round.candidate === undefined ? [] : [];
  void nodes;

  return (
    <div>
      <Section title="检查点覆盖" aside={<span className="hint">{round.candidate?.checkpoint === undefined ? '无检查点' : '服务保存的检查点'}</span>}>
        {round.candidate?.checkpoint === undefined ? (
          <p className="hint">本轮尚未保存部分草稿检查点。部分草稿只读、不可应用；没有检查点时不会显示缺口。</p>
        ) : (
          <div className="box">
            <div className="rowx">
              <span className="ic ok">
                <Icon name="check" size="sm" />
              </span>
              <div className="grow">
                <div className="t">已覆盖分组</div>
                <div className="s">{round.candidate.checkpoint.coveredGroups.length === 0 ? '无' : round.candidate.checkpoint.coveredGroups.join('、')}</div>
              </div>
              <Badge outline>检查点 #{round.candidate.checkpoint.id.slice(-6)}</Badge>
            </div>
            <div className="rowx">
              <span className="ic warn">
                <Icon name="alert" size="sm" />
              </span>
              <div className="grow">
                <div className="t">未覆盖分组</div>
                <div className="s">{round.candidate.checkpoint.missingGroups.length === 0 ? '无' : round.candidate.checkpoint.missingGroups.join('、')}</div>
              </div>
              <Badge tone="unknown">尚未完成，不能执行</Badge>
            </div>
          </div>
        )}
      </Section>

      <Section title="模型提出的问题" aside={<Badge tone={questions.some((q) => q.required && q.answer === undefined) ? 'wait' : 'idle'}>{questions.length} 个</Badge>}>
        {questions.length === 0 ? (
          <p className="hint">当前轮次没有模型问题。没有问题时不会伪造“澄清中”状态。</p>
        ) : (
          questions.map((question) => (
            <div key={question.id} className="qcard">
              <div className="quote" style={{ background: 'transparent', border: 0, padding: 0 }}>
                <span className="tagx claim">模型陈述{question.required ? ' · 必须答复' : ' · 可选'}</span>
                <div className="q-title">{question.question}</div>
              </div>
              {question.answer === undefined ? (
                <QuestionInput id={`draft-q-${question.id}`} title={question.question} question={question} value={answers[question.id] ?? questionDraft(question)} disabled={busy || saveAnswerAction?.allowed !== true} onChange={(value) => setAnswers((previous) => ({ ...previous, [question.id]: value }))} />
              ) : (
                <div className="answer-saved">
                  <Icon name="check" size="sm" />
                  已答复：{question.answer}
                  {question.answeredAt === undefined ? '' : ` · ${question.answeredAt}`}
                </div>
              )}
              {question.affectedNodeIds.length === 0 ? (
                <div className="hint">影响步骤：服务未返回具体步骤（来源见本轮记录）</div>
              ) : (
                <div className="hint">
                  影响步骤：{question.affectedNodeIds.length} 个
                  {onLocateNode === undefined ? null : (
                    <>
                      {' · '}
                      <button type="button" className="linkish" onClick={() => { const first = question.affectedNodeIds[0]; if (first !== undefined) onLocateNode(first); }}>
                        定位到第 1 个
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          ))
        )}
        {questions.length === 0 ? null : (
          <div className="draft-actions">
            <Button
              size="sm"
              variant="primary"
              icon="send"
              disabled={busy || lockedReason !== undefined || saveAnswerAction?.allowed !== true || missingRequired.length > 0}
              disabledReason={
                lockedReason
                ?? (saveAnswerAction?.allowed === true ? undefined : saveAnswerAction?.reason)
                ?? (missingRequired.length > 0 ? `还有 ${String(missingRequired.length)} 个必须回答的问题未答复；全部回答后才能保存` : undefined)
              }
              onClick={() => {
                const payload = questions
                  .filter((question) => answers[question.id] !== undefined && hasQuestionAnswer(answers[question.id]!))
                  .map((question) => ({ questionId: question.id, answer: answers[question.id]!.other, values: answers[question.id]!.values, other: answers[question.id]!.other }));
                onSaveAnswers(payload);
              }}
            >
              {busy ? '正在保存…' : `保存答复（${String(answeredNow.length)}/${String(questions.length)}）`}
            </Button>
            <ActionReasonLine action={saveAnswerAction} />
            {missingRequired.length > 0 ? (
              <span className="hint" role="note">
                必须回答的问题还有 {missingRequired.length} 个未答复：{missingRequired.map((question) => question.question).join('；')}。全部回答后才能保存并形成新的输入修订。
              </span>
            ) : (
              <span className="hint">
                保存会形成需求输入修订 {(requirementRevision ?? round.inputRevision) + 1}（旧轮次输入不变）；答复不会改旧轮次。服务会按新修订重新校验已有候选（不调用模型）。
              </span>
            )}
          </div>
        )}
      </Section>

      <Section title="模型假设" aside={<span className="tagx claim">模型陈述 · 未确认</span>}>
        {assumptions.length === 0 ? (
          <p className="hint">服务未返回模型假设。</p>
        ) : (
          <div className="box">
            {assumptions.map((assumption) => (
              <div key={assumption.id} className="rowx">
                <span className={`ic ${assumption.critical ? 'warn' : 'idle'}`}>
                  <Icon name={assumption.critical ? 'alert' : 'help'} size="sm" />
                </span>
                <div className="grow">
                  <div>{assumption.statement}</div>
                  <div className="s">
                    {assumption.critical ? '关键假设' : '一般假设'} · {assumption.confirmed ? '已确认' : '未确认'}
                  </div>
                </div>
                <Badge tone={assumption.confirmed ? 'ok' : 'wait'}>{assumption.confirmed ? '已确认' : '未确认'}</Badge>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="推荐下一步" aside={undefined}>
        <ol className="list-plain">
          <li>1. 保存答复 → 形成新的输入修订（旧轮次输入不变）。</li>
          <li>2. 预览新一轮并确认（这是新的模型调用）。</li>
          <li>3. 候选仍需审阅、应用与确认；规划面板不会执行。</li>
        </ol>
      </Section>
    </div>
  );
}
