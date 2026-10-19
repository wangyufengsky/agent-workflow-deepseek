import type { FastifyInstance } from 'fastify';
import { AppError, ErrorCode, type OpenCodeRestartRequest } from '@agent-workflow/shared';
import type { Engine } from '@agent-workflow/engine';
import type { Store } from '@agent-workflow/storage';
import type { OpenCodeAdapter } from './adapters/opencode.ts';
import { envelope } from './http.ts';
type RuntimeManager = Pick<OpenCodeAdapter, 'status' | 'beginMaintenance' | 'verifyMaintenanceIdle' | 'diagnostics' | 'stop' | 'ensureReady'>;
export function registerRuntimeOperationRoutes(app: FastifyInstance, store: Store, engine: Engine, opencodeRef: { current?: RuntimeManager | undefined }): void {
  app.get('/api/opencode/operations', async (request) => envelope({
    operations: store.operations.listRecentFor(['opencode.start', 'opencode.restart']),
  }, request.id));
  for (const action of ['start', 'restart'] as const) {
    app.post(`/api/opencode/${action}`, async (request) => {
      const body = (request.body as OpenCodeRestartRequest & { confirmStart?: boolean });
      if (body === null || typeof body !== 'object' || typeof body.requestKey !== 'string' || !body.requestKey.startsWith('req_')) throw new AppError(ErrorCode.VALIDATION_FAILED, '请求号不合法');
      if ((action === 'start' ? body.confirmStart : body.confirmRestart) !== true) throw new AppError(ErrorCode.VALIDATION_FAILED, '需要显式确认运行时操作');
      const opencode = opencodeRef.current;
      if (opencode === undefined) throw new AppError(ErrorCode.NOT_CONFIGURED, 'OpenCode 受管服务未启用，不能操作外部进程');
      const { record, replayed } = engine.commands.begin({ requestKey: body.requestKey, operation: `opencode.${action}`, body: { action, confirmed: true }, target: {} });
      // An accepted replay can already be running. Never execute it twice.
      if (replayed) return envelope({ receipt: engine.commands.toReceipt(record), resource: { status: opencode.status() } }, request.id);
      let releaseMaintenance: (() => void) | undefined;
      try {
        releaseMaintenance = opencode.beginMaintenance();
        const state = opencode.status().state;
        if (!['stopped', 'failed', 'ready', 'degraded', 'starting'].includes(state)) throw new AppError(ErrorCode.VALIDATION_FAILED, '运行时状态未知，禁止操作');
        if (state === 'starting') throw new AppError(ErrorCode.VALIDATION_FAILED, 'OpenCode 正在启动，请读取当前状态');
        if (action === 'start' && state !== 'stopped' && state !== 'failed') throw new AppError(ErrorCode.VALIDATION_FAILED, '当前运行时无需启动，请重新读取状态');
        if (action === 'restart') {
          const taskIds = store.executions.list().filter((execution) => (['running', 'pausing', 'unknown'].includes(execution.status) || execution.nodes.some((node) => node.status === 'running' || node.status === 'unknown'))).map((execution) => execution.taskId);
          const planningRoundIds = store.tasks.list().flatMap((task) => store.planning.list(task.id)).filter((round) => ['queued', 'running', 'stopping', 'unknown'].includes(round.status)).map((round) => round.id);
          const projects = store.projects.list(true);
          const reviewIds = projects.flatMap((project) => store.reviews.listByProject(project.id)).filter((review) => ['queued', 'running', 'stopping', 'unknown'].includes(review.state)).map((review) => review.reviewRunId);
          const fixIds = projects.flatMap((project) => store.fixes.listByProject(project.id)).filter((fix) => ['preparing', 'editing', 'verifying', 'stopping', 'unknown'].includes(fix.state)).map((fix) => fix.fixRunId);
          const pendingModelOperations = store.operations.listPending().filter((operation) => ['knowledge.ask', 'project.charter.generate', 'ppt.work.generate', 'ppt.work.slides'].includes(operation.operation)).map((operation) => ({ requestKey: operation.requestKey, operation: operation.operation }));
          const diagnostics = await opencode.diagnostics();
          if (taskIds.length + planningRoundIds.length + reviewIds.length + fixIds.length + pendingModelOperations.length > 0 || diagnostics.sessions > 0) throw new AppError(ErrorCode.VALIDATION_FAILED, '存在活动或待核对会话，请先停止并核对任务、规划、知识对话、公约或演示生成后重启', { details: { taskIds, planningRoundIds, reviewIds, fixIds, pendingModelOperations, sessions: diagnostics.sessions } });
          await opencode.verifyMaintenanceIdle();
          await opencode.stop();
        }
        await opencode.ensureReady();
        engine.commands.settle(body.requestKey, { state: opencode.status().state });
        return envelope({ receipt: engine.commands.toReceipt(engine.commands.get(body.requestKey)!), resource: { status: opencode.status() } }, request.id);
      } catch (error) {
        const appError = error instanceof AppError ? error : new AppError(ErrorCode.OPENCODE_NOT_READY, error instanceof Error ? error.message : '运行时操作失败');
        engine.commands.fail(body.requestKey, appError);
        throw appError;
      } finally { releaseMaintenance?.(); }
    });
  }

}
