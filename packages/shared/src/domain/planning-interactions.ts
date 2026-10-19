import type { PlanningQuestion, PlanningRound } from './models.ts';
export function isPlanningQuestionAnswered(question: PlanningQuestion): boolean { return typeof question.answer === 'string' && question.answer.trim() !== ''; }
export function isPlanningRoundUnknown(round: PlanningRound): boolean { return round.status === 'unknown' || round.stage === 'unknown' || round.reconcile?.state === 'still_unknown'; }
export function hasPendingPlanningQuestions(round: PlanningRound): boolean { return round.stage === 'needs_answer' && round.questions.some((question) => question.required && !isPlanningQuestionAnswered(question)); }
export function hasPendingPlanningReview(round: PlanningRound): boolean { return round.stage === 'awaiting_review' && round.candidate !== undefined && round.applyStatus !== 'applied' && round.applyStatus !== 'rejected'; }
