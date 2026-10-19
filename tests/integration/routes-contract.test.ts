import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MCP_TOOL_COUNTS_BY_TOOLSET, ROUTES } from '@agent-workflow/shared';
import { MANAGED_TOOL_NAMES } from '../../packages/mcp/src/tools/index.ts';
import { createApplication } from '../../packages/server/src/index.ts';

/**
 * Contract snapshot: the shared `ROUTES` table must describe the HTTP surface
 * the server actually registers (path level; methods are covered by the
 * integration/behavior tests).
 *
 * Both sides are normalized to `/api/.../:param` -> `/api/.../*` so parameter
 * names (and find-my-way's merged `:baseId|:reviewRunId` node) do not matter.
 */

/** ROUTES entries kept intentionally ahead of their server route (dead routes must not multiply). */
const ROUTES_ONLY_EXCEPTIONS: Readonly<Record<string, string>> = {
  '/api/tasks/*/plan/edit/abandon': 'W2-2: 放弃计划调整尚未实现；实现后从例外表移除',
  '/api/tasks/*/execution/advance': 'W2-1: 推进一步/自动推进切换尚未实现；实现后从例外表移除',
  '/api/git/repos/*/merge-requests/*': '远端单个 MR 详情待定（列表已实现）；实现或删除 ROUTES 条目后更新',
};

/**
 * Server routes that are deliberately absent from `ROUTES`.
 *
 * - `/api/opencode/gateway/:secret/v1/*` is a machine-to-machine proxy used
 *   only by the managed OpenCode process; the per-start secret must never be
 *   part of the shared client contract. `printRoutes` does not list it with
 *   `commonPrefix: false`, so the test asserts it separately via `findRoute`.
 */
const SERVER_ONLY_EXCEPTIONS: Readonly<Record<string, string>> = {
  '/api/opencode/gateway/*/v1/*': 'OpenCode 内部网关：每次启动随机 secret，仅受管进程使用，不进入 ROUTES',
};

/** Extract `{method, path}` entries from Fastify's radix tree printout. */
function registeredApiRoutes(printed: string): readonly string[] {
  const routes: string[] = [];
  const stack: { indent: number; path: string }[] = [];
  for (const raw of printed.split('\n')) {
    if (raw.trim() === '') continue;
    const markerIndex = Math.max(raw.indexOf('├── '), raw.indexOf('└── '));
    if (markerIndex < 0) continue;
    const match = raw.slice(markerIndex + 4).match(/^(.*?) \(([^)]*)\)\s*$/);
    if (match === null) continue;
    const segment = (match[1] ?? '').trim();
    const indent = markerIndex;
    while (stack.length > 0 && stack[stack.length - 1]!.indent >= indent) stack.pop();
    const parent = stack.length > 0 ? stack[stack.length - 1]!.path : '';
    const path = segment.startsWith('/') ? `${parent.replace(/\/$/, '')}${segment}` : `${parent}${segment}`;
    stack.push({ indent, path });
    if (path.startsWith('/api')) routes.push(path);
  }
  return routes;
}

/** Normalize concrete ids / Fastify params / the merged `:a|:b` node to `*`. */
function normalizePath(path: string): string {
  const pathname = path.split('?')[0] ?? path;
  return pathname
    .split('/')
    .map((segment) => (segment.startsWith(':') || /^__p\d+__$/.test(segment) || segment === '*' ? '*' : segment))
    .join('/');
}

function contractRoutePaths(): readonly string[] {
  const paths = new Set<string>();
  for (const value of Object.values(ROUTES)) {
    if (typeof value === 'function') {
      const args = Array.from({ length: value.length }, (_, index) => `__p${index}__`);
      paths.add(normalizePath((value as (...params: string[]) => string)(...args)));
    } else {
      paths.add(normalizePath(value as string));
    }
  }
  return [...paths];
}

test('W1-10: shared ROUTES matches the registered /api surface except the documented exceptions', async () => {
  const app = await createApplication({ dataDir: mkdtempSync(join(tmpdir(), 'aw-routes-')), disableOpenCode: true, disableListen: true });
  try {
    const serverPaths = new Set(registeredApiRoutes(app.app.printRoutes({ commonPrefix: false, includeHooks: false })).map(normalizePath));
    // Fastify's `commonPrefix: false` printout omits the `ALL .../v1/*` wildcard
    // route, so the gateway path is added explicitly; assertion (3) below checks
    // it really is registered via `findRoute`.
    serverPaths.add(normalizePath('/api/opencode/gateway/:secret/v1/*'));
    const routePaths = new Set(contractRoutePaths());

    // 1. Every ROUTES path is served, unless it is a documented dead route.
    const missingInServer = [...routePaths].filter((path) => !serverPaths.has(path)).sort();
    assert.deepEqual(missingInServer, Object.keys(ROUTES_ONLY_EXCEPTIONS).sort());

    // 2. Every served /api path is in ROUTES, unless documented server-only.
    const missingInContract = [...serverPaths].filter((path) => !routePaths.has(path)).sort();
    assert.deepEqual(missingInContract, Object.keys(SERVER_ONLY_EXCEPTIONS).sort());

    // 3. The OpenCode gateway is registered even though it is not in ROUTES.
    assert.notEqual(app.app.findRoute({ method: 'POST', url: '/api/opencode/gateway/snapshot-secret/v1/chat/completions' }), undefined);

    // 4. Newly added ROUTES keys resolve to the expected concrete paths.
    assert.equal(ROUTES.settingsGit, '/api/settings/git');
    assert.equal(ROUTES.databaseConnection('db_1'), '/api/settings/databases/db_1');
    assert.equal(ROUTES.pptWorkPptx('ppt_1'), '/api/ppt/works/ppt_1/pptx');
    assert.equal(ROUTES.fixDiff('project_1', 'fix_1'), '/api/git/repos/project_1/fixes/fix_1/diff');
    assert.equal(ROUTES.fixStop('project_1', 'fix_1'), '/api/git/repos/project_1/fixes/fix_1/stop');
    assert.equal(ROUTES.fixCommit('project_1', 'fix_1'), '/api/git/repos/project_1/fixes/fix_1/commit');
    assert.equal(ROUTES.fixPush('project_1', 'fix_1'), '/api/git/repos/project_1/fixes/fix_1/push');
    assert.equal(ROUTES.fixMerge('project_1', 'fix_1'), '/api/git/repos/project_1/fixes/fix_1/merge');
    assert.equal(ROUTES.fixMergeRequest('project_1', 'fix_1'), '/api/git/repos/project_1/fixes/fix_1/merge-request');
    assert.equal(ROUTES.fixDiscard('project_1', 'fix_1'), '/api/git/repos/project_1/fixes/fix_1/discard');
    assert.equal(ROUTES.fixFileRevert('project_1', 'fix_1', 'file_1'), '/api/git/repos/project_1/fixes/fix_1/files/file_1/revert');
  } finally {
    await app.close();
  }
});

test('W0-5: managed MCP tool counts mirror the real MCP registry per toolset', () => {
  const counted = new Map<string, number>();
  for (const name of MANAGED_TOOL_NAMES) {
    const toolset = name.split('.')[0];
    assert.ok(toolset !== undefined && toolset.length > 0, `tool name without toolset prefix: ${name}`);
    counted.set(toolset, (counted.get(toolset) ?? 0) + 1);
  }
  assert.deepEqual({ ...MCP_TOOL_COUNTS_BY_TOOLSET }, Object.fromEntries([...counted.entries()].sort()));
  const total = Object.values(MCP_TOOL_COUNTS_BY_TOOLSET).reduce((sum, count) => sum + count, 0);
  assert.equal(total, MANAGED_TOOL_NAMES.length);
});
