import { projectAccountView } from './project-git-accounts.ts';
import type { FastifyInstance } from 'fastify';
import { AppError, ErrorCode, nowIso, projectBindingIdentity, type ProjectBindingCheck } from '@agent-workflow/shared';
import type { Engine } from '@agent-workflow/engine';
import type { Store } from '@agent-workflow/storage';
import type { RemoteService } from './remote.ts';
import { inspectEvidenceSource, projectBindingHash } from '../../engine/src/project-evidence.ts';
import { envelope } from './http.ts';
export function registerProjectEvidenceRoutes(app: FastifyInstance, store: Store, engine: Engine, remote?: RemoteService): void {
  app.post<{ Params: { id: string } }>('/api/projects/:id/binding/check', async (request) => {
    const body = request.body as { requestKey: string; expectedConfig: string };
    if (!body || typeof body.requestKey !== 'string' || typeof body.expectedConfig !== 'string' || body.expectedConfig.length > 20_000) throw new AppError(ErrorCode.VALIDATION_FAILED, '检查绑定需要原请求号与已保存配置身份');
    const projectId = request.params.id;
    const { record, replayed } = engine.commands.begin({ requestKey: body.requestKey, operation: 'project.binding.check', body: { projectId, expectedConfig: body.expectedConfig }, target: { projectId } });
    if (replayed) return envelope({ receipt: engine.commands.toReceipt(record), resource: record.outcome?.check }, request.id);
    try {
      const project = engine.projects.get(projectId);
      if (body.expectedConfig !== projectBindingIdentity(project.settings)) throw new AppError(ErrorCode.STALE_TARGET, '绑定配置已变化，请重新读取并保存后检查');
      const configHash = projectBindingHash(project.settings);
      const accountRevision = projectAccountView(store, projectId, engine.settings.git.defaultProvider).revision;
      const sources = (project.settings.evidenceSources ?? []).map((source) => inspectEvidenceSource(project.rootPath, source));
      let repository: ProjectBindingCheck['repository'];
      try { repository = remote ? await remote.inspectProjectBinding(projectId) : { state: 'not_configured', reason: 'GitLab模块未配置' }; }
      catch (error) { repository = { state: 'failed', reason: error instanceof AppError ? error.message : 'GitLab项目元数据读取失败' }; }
      if (projectBindingHash(engine.projects.get(projectId).settings) !== configHash || projectAccountView(store, projectId, engine.settings.git.defaultProvider).revision !== accountRevision) throw new AppError(ErrorCode.STALE_TARGET, '检查期间绑定配置或账号已变化，未保存旧检查结果');
      const check: ProjectBindingCheck = { projectId, configHash, checkedAt: nowIso(), repository, sources };
      store.settings.putJson(`project.binding-check.${projectId}`, check);
      engine.commands.settle(body.requestKey, { check });
      return envelope({ receipt: engine.commands.toReceipt(engine.commands.get(body.requestKey)!), resource: check }, request.id);
    } catch (error) { engine.commands.fail(body.requestKey, error as Error); throw error; }
  });
}
