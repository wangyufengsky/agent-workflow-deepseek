import { createHash } from 'node:crypto';
import { AppError, ErrorCode, nowIso, type TaskTemplate, type TemplateArchiveCorpus } from '@agent-workflow/shared';
import type { Store } from '@agent-workflow/storage';
const HISTORY = 'catalog.templates.history';
/** Only captured contracts and explicitly preserved legacy records; no catalogue examples or scheduler are synthesized. */
export function captureTemplateVersion(store: Store, contract: TaskTemplate, archived = false): void {
    const templates = store.settings.getJson<TemplateArchiveCorpus['templates']>(HISTORY) ?? [];
    const previous = templates.find((item) => item.id === contract.id);
    const sha256 = createHash('sha256').update(JSON.stringify(contract)).digest('hex');
    const version = previous?.versions.find((item) => item.version === contract.version);
    if (version && version.sha256 !== sha256)
        throw new AppError(ErrorCode.CONFLICT, '冻结模板同一版本内容不同，不能覆盖历史');
    const next = { id: contract.id, name: contract.name, archived, versions: version ? previous!.versions : [...(previous?.versions ?? []), { version: contract.version, frozenAt: nowIso(), sha256, contract: structuredClone(contract), immutable: true as const }] };
    store.settings.putJson(HISTORY, [...templates.filter((item) => item.id !== contract.id), next]);
}
function redact(value: unknown): unknown {
    if (Array.isArray(value))
        return value.map(redact);
    if (value && typeof value === 'object')
        return Object.fromEntries(Object.entries(value).filter(([key]) => !/secret|token|password|credential|authorization|cookie|webhook.?key/i.test(key)).map(([key, item]) => [key, redact(item)]));
    return typeof value === 'string' ? value.replace(/(bearer\s+)\S+/ig, '$1[已脱敏]').replace(/(https?:\/\/)[^/@\s]+:[^/@\s]+@/g, '$1[已脱敏]@') : value;
}
export function readTemplateArchive(store: Store): TemplateArchiveCorpus {
    const legacy = store.settings.getJson<Partial<TemplateArchiveCorpus>>('catalog.automation-archive.v1');
    const captured = [...(store.settings.getJson<TemplateArchiveCorpus['templates']>(HISTORY) ?? [])];
    for (const task of store.tasks.list()) {
        const contract = task.fixedTemplate?.contract;
        if (!contract)
            continue;
        const sha256 = createHash('sha256').update(JSON.stringify(contract)).digest('hex');
        const existing = captured.find((item) => item.id === contract.id);
        if (existing?.versions.some((version) => version.sha256 === sha256))
            continue;
        const version = { version: contract.version, frozenAt: task.createdAt, sha256, contract, immutable: true as const };
        const next = { id: contract.id, name: contract.name, archived: existing?.archived ?? false, versions: [...(existing?.versions ?? []), version].sort((a, b) => a.version - b.version) };
        if (existing)
            captured[captured.indexOf(existing)] = next;
        else
            captured.push(next);
    }
    return redact({ serverTime: nowIso(), templates: [...(legacy?.templates ?? []), ...captured.filter((item) => !legacy?.templates?.some((old) => old.id === item.id))], rules: legacy?.rules ?? [], runs: legacy?.runs ?? [] }) as TemplateArchiveCorpus;
}
export function verifyArchiveRun(store: Store, id: string) {
    const run = readTemplateArchive(store).runs.find((item) => item.id === id);
    if (!run)
        throw new AppError(ErrorCode.NOT_FOUND, '历史运行不存在');
    const task = run.taskId ? store.tasks.get(run.taskId) : undefined;
    return { checkedAt: nowIso(), runId: id, found: task !== undefined, ...(task ? { taskId: task.id, title: task.title, stage: task.stage, lifecycle: task.lifecycle, updatedAt: task.updatedAt } : { reason: run.taskId ? '原任务已不存在或不在当前工作区；历史记录保留' : '这条运行没有绑定原任务' }) };
}
