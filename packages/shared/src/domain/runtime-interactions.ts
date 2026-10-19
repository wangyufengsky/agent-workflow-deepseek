import type { QuestionChoices, QuestionAnswer } from './questions.ts';
export interface RuntimeInteractionBinding {
  readonly taskId?: string; readonly projectId: string; readonly sessionId: string;
  readonly executionId?: string; readonly nodeId?: string; readonly attemptId?: string;
  readonly roundId?: string; readonly knowledgeRequestKey?: string; readonly conversationId?: string; readonly kind: 'planning' | 'execution' | 'review' | 'fix';
}
export interface RuntimeInteractionQuestion extends QuestionChoices { readonly id: string; readonly title: string }
export interface RuntimeInteraction {
  readonly requestHash: string; readonly id: string; readonly requestId: string; readonly protocol: 'legacy' | 'v2';
  readonly kind: 'permission' | 'question' | 'policy'; readonly state: 'open' | 'resolved' | 'unknown';
  readonly resolveAllowed?: boolean; readonly grantAllowed?: boolean; readonly unavailableReason?: string;
  readonly binding: RuntimeInteractionBinding; readonly taskTitle?: string; readonly contextTitle?: string; readonly stepName: string;
  readonly permission?: string; readonly patterns: readonly string[]; readonly hard: boolean;
  readonly reason: string; readonly questions: readonly RuntimeInteractionQuestion[];
  readonly createdAt: string; readonly updatedAt: string; readonly requestKey?: string;
  readonly resolution?: RuntimeInteractionResolution; readonly confirmation?: RuntimeInteractionResolution;
}
export interface RuntimeInteractionResolution {
  readonly action: 'once' | 'session' | 'reject' | 'answer' | 'ack';
  readonly answers?: readonly (QuestionAnswer & { readonly questionId: string })[];
}
export interface RuntimeInteractionResolveRequest extends RuntimeInteractionResolution { readonly requestKey: string; readonly confirmResolve: true }
