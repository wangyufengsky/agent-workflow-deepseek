import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { captureCharterContext, readCharterSource } from '../../packages/engine/src/project-charter-context.ts';

test('charter context supplies actual root and monorepo manifests with hashes without secrets, dependencies or symlink targets', async () => {
  const root = await mkdtemp(join(tmpdir(), 'aw-charter-context-'));
  const outside = await mkdtemp(join(tmpdir(), 'aw-charter-outside-'));
  try {
    await mkdir(join(root, 'apps/web'), { recursive: true });
    await mkdir(join(root, 'node_modules'), { recursive: true });
    const manifest = JSON.stringify({ scripts: { test: 'node --test spec/*.test.mjs' } });
    await writeFile(join(root, 'package.json'), manifest);
    await writeFile(join(root, 'apps/web/package.json'), '{"dependencies":{"react":"19"}}');
    await writeFile(join(root, '.env'), 'SECRET_NEVER_INCLUDE');
    await writeFile(join(root, 'node_modules/README.md'), 'DEPENDENCY_NEVER_INCLUDE');
    await writeFile(join(outside, 'README.md'), 'OUTSIDE_NEVER_INCLUDE');
    await symlink(join(outside, 'README.md'), join(root, 'README.md'));
    await symlink(outside, join(root, 'linked'));
    const context = await captureCharterContext(root);
    assert.deepEqual(context.files.map((file) => file.path).sort(), ['apps/web/package.json', 'package.json']);
    const actual = context.files.find((file) => file.path === 'package.json')!;
    assert.equal(actual.content, manifest); assert.equal(actual.sha256, createHash('sha256').update(manifest).digest('hex'));
    assert.doesNotMatch(JSON.stringify(context), /NEVER_INCLUDE/);
    assert.ok(context.entries.includes('apps/web/')); assert.ok(context.limitations.length > 0);
    await assert.rejects(readCharterSource(root, 'README.md'));
    await assert.rejects(readCharterSource(root, '../outside'));
  } finally { await rm(root, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }); }
});

test('charter context exposes oversized or non-text inputs as unknown instead of sending unbounded text', async () => {
  const root = await mkdtemp(join(tmpdir(), 'aw-charter-limit-'));
  try {
    await writeFile(join(root, 'README.md'), 'x'.repeat(64_001));
    await writeFile(join(root, 'package.json'), Buffer.from([0xff, 0x00]));
    const context = await captureCharterContext(root);
    assert.equal(context.files.length, 0);
    assert.ok(context.limitations.some((value) => value.startsWith('README.md：')));
    assert.ok(context.limitations.some((value) => value.startsWith('package.json：')));
  } finally { await rm(root, { recursive: true, force: true }); }
});
