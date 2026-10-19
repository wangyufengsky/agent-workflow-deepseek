import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MIGRATIONS } from './migrations.ts';
import { SqliteDatabase } from './db.ts';
import { Store } from './store.ts';

function dataDir(label: string): string {
  return mkdtempSync(join(tmpdir(), `aw-storage-${label}-`));
}

test('SettingsRepository.removeJson deletes only the requested key and is idempotent', () => {
  const store = new Store({ dataDir: dataDir('remove-json') });
  try {
    store.settings.putJson('directory.baseline.ws_1', { baselineRoot: '/data/baselines/ws_1' });
    store.settings.putJson('directory.baseline.ws_2', { baselineRoot: '/data/baselines/ws_2' });
    store.settings.putJson('unrelated', { keep: true });

    assert.deepEqual(store.settings.getJson('directory.baseline.ws_1'), { baselineRoot: '/data/baselines/ws_1' });
    store.settings.removeJson('directory.baseline.ws_1');
    assert.equal(store.settings.getJson('directory.baseline.ws_1'), undefined, 'removed key is gone');
    assert.deepEqual(store.settings.getJson('directory.baseline.ws_2'), { baselineRoot: '/data/baselines/ws_2' }, 'other keys untouched');
    assert.deepEqual(store.settings.getJson('unrelated'), { keep: true });

    // Removing a missing key is a no-op (cleanup retries stay idempotent).
    store.settings.removeJson('directory.baseline.ws_1');
    assert.equal(store.settings.getJson('directory.baseline.ws_1'), undefined);

    store.settings.putJson('directory.baseline.ws_1', { baselineRoot: '/data/baselines/ws_1' });
    assert.deepEqual(store.settings.getJson('directory.baseline.ws_1'), { baselineRoot: '/data/baselines/ws_1' });
  } finally {
    store.close();
  }
});

test('task readOnly persists and defaults to writable for pre-existing rows (migration v11)', () => {
  const dir = dataDir('readonly');
  const first = new Store({ dataDir: dir });
  let taskId = '';
  let projectId = '';
  try {
    const project = first.projects.create({ name: 'P', rootPath: '/tmp/readonly-project', gitState: 'git', defaultBranch: 'main' });
    projectId = project.id;
    const task = first.tasks.create({
      projectId,
      title: '只读验证',
      requirementText: 'R1',
      methodId: 'method.requirement-development',
      methodRevision: 'r1',
      readOnly: true,
    });
    taskId = task.id;
    assert.equal(task.readOnly, true);
    assert.equal(first.tasks.get(taskId)?.readOnly, true);
    const plain = first.tasks.create({ projectId, title: '普通任务', requirementText: 'R1', methodId: 'method.requirement-development', methodRevision: 'r1' });
    assert.equal(first.tasks.get(plain.id)?.readOnly, undefined);
    first.tasks.update(plain.id, { readOnly: true });
    assert.equal(first.tasks.get(plain.id)?.readOnly, true, 'readOnly can be toggled through update');
    first.tasks.update(plain.id, { readOnly: false });
    assert.equal(first.tasks.get(plain.id)?.readOnly, undefined, 'false is stored as writable');
  } finally {
    first.close();
  }

  const reopened = new Store({ dataDir: dir });
  try {
    assert.equal(reopened.tasks.get(taskId)?.readOnly, true, 'readOnly survives a restart');
  } finally {
    reopened.close();
  }
});

test('an existing database created before migration v11 upgrades with all rows writable', () => {
  const dir = dataDir('legacy');
  const dbPath = join(dir, 'agent-workflow.sqlite');
  // Simulate a database written by an older build: apply only migrations 1..10.
  const legacy = new SqliteDatabase({ dbPath, migrations: MIGRATIONS.filter((migration) => migration.version <= 10) });
  try {
    assert.equal(legacy.prepare("SELECT COUNT(*) AS n FROM schema_migrations WHERE version = 11").get()?.['n'], 0);
    legacy.exec("INSERT INTO projects (id, name, description, root_path, git_state, settings_json, archived, created_at, updated_at) VALUES ('prj_legacy', 'Legacy', '', '/tmp/legacy', 'git', '{}', 0, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')");
    legacy.exec(
      "INSERT INTO tasks (id, project_id, title, stage, lifecycle, attention, method_id, method_revision, requirement_json, revision, created_at, updated_at) " +
        "VALUES ('task_legacy', 'prj_legacy', '旧任务', 'draft', 'active', 'none', 'method.requirement-development', 'r1', '{\"text\":\"R1\",\"supplements\":[],\"entries\":[],\"revision\":1,\"updatedAt\":\"2026-01-01T00:00:00.000Z\"}', 0, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')",
    );
  } finally {
    legacy.close();
  }

  const upgraded = new Store({ dataDir: dir });
  try {
    const task = upgraded.tasks.get('task_legacy');
    assert.ok(task !== undefined, 'legacy row survives the migration');
    assert.equal(task.readOnly, undefined, 'legacy rows are writable until explicitly marked read-only');
    upgraded.tasks.update('task_legacy', { readOnly: true });
    assert.equal(upgraded.tasks.get('task_legacy')?.readOnly, true);
  } finally {
    upgraded.close();
  }
});
