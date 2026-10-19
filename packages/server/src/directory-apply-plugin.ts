import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ConflictResolutionValue, DeliveryApplyRequest } from '@agent-workflow/shared';
import { AppError, ConflictResolution, ErrorCode, createId } from '@agent-workflow/shared';
import type { Engine } from '@agent-workflow/engine';
import type { Store } from '@agent-workflow/storage';
import {
  DirectoryApplyService,
  type DirectoryApplyPreviewOptions,
} from '../../engine/src/directory-apply.ts';
import { envelope } from './http.ts';

/**
 * Non-Git three-way apply HTTP surface (TD05).
 *
 * The service instance is owned by the plugin so preview bookkeeping lives with
 * the routes; the server remains the only writer of the original directory.
 */
export interface DirectoryApplyRoutesDeps {
  readonly engine: Engine;
  readonly store: Store;
  /** Optional prepared service (tests may inject one). */
  readonly service?: DirectoryApplyService;
}

export function registerDirectoryApplyRoutes(app: FastifyInstance, deps: DirectoryApplyRoutesDeps): void {
  const service = deps.service ?? new DirectoryApplyService(deps.store, deps.engine.commands);

  app.post<{ Params: { id: string } }>('/api/tasks/:id/delivery/apply/preview', async (request) => {
    const body = optionalObjectBody(request);
    const options = previewOptionsOf(body);
    const preview = await service.preview(request.params.id, options);
    return envelope({ preview }, requestId(request));
  });

  app.post<{ Params: { id: string } }>('/api/tasks/:id/delivery/apply', async (request) => {
    const body = commandBody<DeliveryApplyRequest>(request, request.params.id);
    const result = await service.apply(request.params.id, body);
    return envelope(result, requestId(request));
  });
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function requestId(request: FastifyRequest): string {
  return String(request.id ?? createId('req'));
}

function optionalObjectBody(request: FastifyRequest): Record<string, unknown> {
  const body = request.body;
  if (body === undefined || body === null) return {};
  if (typeof body !== 'object' || Array.isArray(body)) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, '请求体必须是 JSON 对象');
  }
  return body as Record<string, unknown>;
}

function previewOptionsOf(body: Record<string, unknown>): DirectoryApplyPreviewOptions {
  const options: { fileIds?: readonly string[]; resolutions?: readonly { fileId: string; resolution: ConflictResolutionValue }[] } = {};
  if (body.fileIds !== undefined) {
    if (!Array.isArray(body.fileIds) || body.fileIds.some((fileId) => typeof fileId !== 'string' || fileId === '')) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, 'fileIds 必须是文件引用数组');
    }
    options.fileIds = body.fileIds as readonly string[];
  }
  if (body.resolutions !== undefined) {
    if (!Array.isArray(body.resolutions)) throw new AppError(ErrorCode.VALIDATION_FAILED, 'resolutions 必须是数组');
    const resolutions: { fileId: string; resolution: ConflictResolutionValue }[] = [];
    for (const entry of body.resolutions) {
      if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
        throw new AppError(ErrorCode.VALIDATION_FAILED, 'resolutions 条目必须是对象');
      }
      const record = entry as Record<string, unknown>;
      if (typeof record.fileId !== 'string' || record.fileId === '') {
        throw new AppError(ErrorCode.VALIDATION_FAILED, 'resolutions 条目缺少 fileId');
      }
      const resolution = record.resolution;
      if (
        resolution !== ConflictResolution.KEEP_ORIGINAL
        && resolution !== ConflictResolution.TAKE_TASK
        && resolution !== ConflictResolution.MANUAL_THEN_RECHECK
        && resolution !== ConflictResolution.EXCLUDE
      ) {
        throw new AppError(ErrorCode.VALIDATION_FAILED, 'resolutions 条目缺少合法 resolution');
      }
      resolutions.push({ fileId: record.fileId, resolution });
    }
    options.resolutions = resolutions;
  }
  return options;
}

function commandBody<T>(request: FastifyRequest, taskId: string): T {
  const body = request.body;
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, '请求体必须是 JSON 对象');
  }
  const record = body as Record<string, unknown>;
  if (typeof record.requestKey !== 'string' || record.requestKey.trim() === '') {
    throw new AppError(ErrorCode.VALIDATION_FAILED, '缺少 requestKey');
  }
  if (record.taskId !== undefined && record.taskId !== taskId) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, 'taskId 与请求路径不一致', {
      details: { path: taskId, body: record.taskId },
    });
  }
  return body as T;
}
