import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AppError, ErrorCode } from '../errors.ts';
import {
  canTransition,
  executionMachine,
  nextStates,
  nodeMachine,
  planRevisionMachine,
  planningRunMachine,
  planningStageMachine,
  taskStageMachine,
  transitionEvent,
  workspaceMachine,
} from './machines.ts';
import { TaskStage, NodeStatus, PlanningRunStatus, PlanningStage, WorkspaceState } from './enums.ts';

test('task stage machine: only declared stage paths are legal', () => {
  assert.equal(canTransition(taskStageMachine, TaskStage.DRAFT, TaskStage.PLANNING), true);
  assert.equal(canTransition(taskStageMachine, TaskStage.DRAFT, TaskStage.EXECUTING), false);
  assert.equal(canTransition(taskStageMachine, TaskStage.PLANNING, TaskStage.CONFIRMING), true);
  assert.equal(canTransition(taskStageMachine, TaskStage.EXECUTING, TaskStage.CONFIRMING), true);
  assert.equal(transitionEvent(taskStageMachine, TaskStage.CONFIRMING, TaskStage.PREPARING), 'plan.confirm');
  assert.deepEqual([...nextStates(taskStageMachine, TaskStage.CONFIRMING)].sort(), [TaskStage.DRAFT, TaskStage.PLANNING, TaskStage.PREPARING].sort());
});

test('planning run machine: stop and reconcile flows', () => {
  assert.equal(canTransition(planningRunMachine, PlanningRunStatus.RUNNING, PlanningRunStatus.STOPPING), true);
  assert.equal(canTransition(planningRunMachine, PlanningRunStatus.STOPPING, PlanningRunStatus.STOPPED), true);
  assert.equal(canTransition(planningRunMachine, PlanningRunStatus.STOPPING, PlanningRunStatus.COMPLETED), false);
  assert.equal(canTransition(planningRunMachine, PlanningRunStatus.UNKNOWN, PlanningRunStatus.RUNNING), true);
  assert.equal(canTransition(planningRunMachine, PlanningRunStatus.STOPPED, PlanningRunStatus.RUNNING), false);
});

test('planning stage machine: candidate goes to review, answers reopen generation', () => {
  assert.equal(canTransition(planningStageMachine, PlanningStage.GENERATING, PlanningStage.VALIDATING), true);
  assert.equal(canTransition(planningStageMachine, PlanningStage.VALIDATING, PlanningStage.AWAITING_REVIEW), true);
  assert.equal(canTransition(planningStageMachine, PlanningStage.VALIDATING, PlanningStage.NEEDS_ANSWER), true);
  assert.equal(canTransition(planningStageMachine, PlanningStage.NEEDS_ANSWER, PlanningStage.GENERATING), true);
  assert.equal(canTransition(planningStageMachine, PlanningStage.AWAITING_REVIEW, PlanningStage.DONE), true);
});

test('plan revision machine enforces confirm/reopen ordering', () => {
  assert.equal(canTransition(planRevisionMachine, 'draft', 'unconfirmed'), true);
  assert.equal(canTransition(planRevisionMachine, 'unconfirmed', 'confirmed'), true);
  assert.equal(canTransition(planRevisionMachine, 'confirmed', 'unconfirmed'), true);
  assert.equal(canTransition(planRevisionMachine, 'draft', 'confirmed'), false);
});

test('execution machine: pause, confirmation and stop paths', () => {
  assert.equal(canTransition(executionMachine, 'running', 'pausing'), true);
  assert.equal(canTransition(executionMachine, 'pausing', 'paused'), true);
  assert.equal(canTransition(executionMachine, 'running', 'waiting_confirmation'), true);
  assert.equal(canTransition(executionMachine, 'waiting_confirmation', 'running'), true);
  assert.equal(canTransition(executionMachine, 'stopping', 'stopped'), true);
  assert.equal(canTransition(executionMachine, 'completed', 'running'), false);
});

test('node machine: claim before success, unknown reconciliation', () => {
  assert.equal(canTransition(nodeMachine, NodeStatus.PENDING, NodeStatus.READY), true);
  assert.equal(canTransition(nodeMachine, NodeStatus.PENDING, NodeStatus.SUCCEEDED), false);
  assert.equal(canTransition(nodeMachine, NodeStatus.RUNNING, NodeStatus.SUCCEEDED), true);
  assert.equal(canTransition(nodeMachine, NodeStatus.UNKNOWN, NodeStatus.SUCCEEDED), true);
});

test('workspace machine: preparing then ready, cleanup only from ready', () => {
  assert.equal(canTransition(workspaceMachine, WorkspaceState.NOT_STARTED, WorkspaceState.PREPARING), true);
  assert.equal(canTransition(workspaceMachine, WorkspaceState.PREPARING, WorkspaceState.READY), true);
  assert.equal(canTransition(workspaceMachine, WorkspaceState.NOT_STARTED, WorkspaceState.READY), false);
  assert.equal(canTransition(workspaceMachine, WorkspaceState.READY, WorkspaceState.CLEANING), true);
});

test('assertTransition-style checks surface AppError semantics', () => {
  assert.throws(
    () => {
      if (!canTransition(taskStageMachine, TaskStage.DRAFT, TaskStage.EXECUTING)) {
        throw new AppError(ErrorCode.TASK_STAGE_CONFLICT, '非法阶段迁移');
      }
    },
    (error: unknown) => error instanceof AppError && error.code === ErrorCode.TASK_STAGE_CONFLICT,
  );
});
