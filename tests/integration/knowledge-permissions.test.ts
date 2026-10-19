import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequestKey, type DatabaseConnectionConfig } from '@agent-workflow/shared';
import { createApplication } from '../../packages/server/src/index.ts';
import { KnowledgeInputs } from '../../packages/engine/src/knowledge-inputs.ts';
import { parsePublicSearchRss } from '../../packages/server/src/public-search.ts';

test('knowledge independent permissions enforce reads and reject late public search results', async () => {
  const app = await createApplication({ dataDir: mkdtempSync(join(tmpdir(), 'aw-kb-permission-')), disableOpenCode: true, disableListen: true });
  try {
    const root = mkdtempSync(join(tmpdir(), 'aw-kb-sources-')); writeFileSync(join(root, 'main.ts'), 'export const value = 1;');
    const project = app.store.projects.create({ name: '来源项目', rootPath: root, gitState: 'not_git' });
    const url = `/api/knowledge/projects/${project.id}/permissions`;
    const change = async (values: Record<string, boolean>) => app.app.inject({ method: 'PATCH', url, payload: { requestKey: createRequestKey(), ...values } });
    const initial = (await app.app.inject({ method: 'GET', url })).json().data;
    assert.equal(initial.originalRead, true); assert.equal(initial.publicSearch, false);
    const disabled = await change({ originalRead: false }); assert.equal(disabled.statusCode, 200, disabled.body);
    assert.equal((await app.app.inject({ method: 'GET', url: `/api/knowledge/source?projectId=${project.id}&path=main.ts` })).json().error.code, 'REVOKED');
    assert.equal((await app.app.inject({ method: 'GET', url: `/api/knowledge/search?projectId=${project.id}&q=value` })).json().error.code, 'REVOKED');
    assert.equal((await app.app.inject({ method: 'GET', url: `/api/knowledge/sources?projectId=${project.id}` })).json().data.sources.length, 0);
    await change({ publicSearch: true });
    let release!: () => void; let calls = 0;
    const inputs = new KnowledgeInputs(app.store, app.engine.commands, app.engine.context, undefined, { search: async () => { calls++; await new Promise<void>((resolve) => { release = resolve; }); return [{ url: 'https://example.com/public', title: 'fixture', excerpt: 'explicit provider fixture' }]; } });
    const collecting = inputs.collect(project.id, [], true, '公共资料？');
    assert.equal(calls, 1); await change({ publicSearch: false }); release();
    await assert.rejects(collecting, { code: 'REVOKED' });
    assert.equal(inputs.permissions(project.id).originalRead, false, 'network switch must not grant original reads');
    const count = calls; await assert.rejects(inputs.collect(project.id, [], true, '无许可不能发出请求'), { code: 'FORBIDDEN' }); assert.equal(calls, count);
  } finally { await app.close(); }
});

test('database knowledge input reads only project/schema/table authorized samples and rejects frozen scope revocation', async () => {
  const app = await createApplication({ dataDir: mkdtempSync(join(tmpdir(), 'aw-kb-db-')), disableOpenCode: true, disableListen: true });
  try {
    const project = app.store.projects.create({ name: '数据库资料', rootPath: tmpdir(), gitState: 'not_git' });
    const config: DatabaseConnectionConfig = { id: 'db_knowledge', name: '只读来源', type: 'mysql', host: 'localhost', port: 3306, database: 'allowed', user: 'reader', passwordRef: 'not-used', enabled: true, projectIds: [project.id], schemas: ['allowed'], tables: ['allowed.safe'] };
    app.engine.updateSettings({ ...app.engine.settings, database: { ...app.engine.settings.database, connections: [config] } });
    const queries: string[] = [];
    // Driver fixture proves authorization and SQL dispatch, not live DB connectivity.
    const inputs = new KnowledgeInputs(app.store, app.engine.commands, app.engine.context, { probe: async () => ({ state: 'unknown' }), query: async (_id, sql) => { queries.push(sql); return sql.includes('information_schema') ? { rows: [['allowed', 'safe'], ['allowed', 'secret'], ['outside', 'safe']], columns: [] } : { rows: [['permitted sample']], columns: [{ name: 'value' }] }; } });
    assert.ok(inputs.inventory(project.id).some((source) => source.path === 'database:db_knowledge'));
    const result = await inputs.collect(project.id, ['database:db_knowledge'], false, '查询结构？');
    assert.equal(queries.length, 2); assert.match(queries[1]!, /`allowed`.`safe`/); assert.ok(!queries[1]!.includes('secret'));
    assert.match(result.documents[0]!.content, /permitted sample/);
    const selected = { documents: result.documents, networkSearch: false };
    inputs.assertCurrent(project.id, selected);
    app.engine.updateSettings({ ...app.engine.settings, database: { ...app.engine.settings.database, connections: [{ ...config, tables: ['allowed.other'] }] } });
    assert.throws(() => inputs.assertCurrent(project.id, selected), { code: 'REVOKED' });
    const other = app.store.projects.create({ name: '未授权', rootPath: tmpdir(), gitState: 'not_git' });
    assert.ok(!inputs.inventory(other.id).some((source) => source.kind === 'database'));
    await assert.rejects(inputs.read(other.id, 'database:db_knowledge'), { code: 'FORBIDDEN' }); assert.equal(queries.length, 2);
  } finally { await app.close(); }
});

test('public search parser requires real URL/title/excerpt and decodes provider text', () => {
  assert.deepEqual(parsePublicSearchRss('<rss><item><title>A &amp; B</title><link>https://example.com/a</link><description><![CDATA[<b>source</b> excerpt]]></description></item><item><title>bad</title><link>javascript:alert(1)</link><description>x</description></item></rss>'), [{ url: 'https://example.com/a', title: 'A & B', excerpt: 'source excerpt' }]);
});
