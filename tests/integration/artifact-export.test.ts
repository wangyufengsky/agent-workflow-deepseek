import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exportArtifact, type ArtifactExportHost } from '../../apps/desktop/src/artifact-export.ts';

const bytes = Buffer.from('真实保存文件');
const identity = { taskId: 'task1', attemptId: 'attempt1', artifactId: 'art1', revision: 'r1', sha256: createHash('sha256').update(bytes).digest('hex') };
function host(choosePath: ArtifactExportHost['choosePath']): ArtifactExportHost {
  return { baseUrl: 'http://127.0.0.1:5277', choosePath, write: writeFile, fetch: (async (url: string | URL | Request) => String(url).includes('download=1') ? new Response(bytes) : Response.json({ data: { artifact: { id: identity.artifactId, revision: identity.revision, sha256: identity.sha256, sourceAttemptId: identity.attemptId, name: '报告.md', sizeBytes: bytes.length } } })) as typeof fetch };
}

test('host export returns saved only after verified bytes are written to chosen destination', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'aw-export-'));
  try {
    const destination = join(dir, '报告.md');
    const result = await exportArtifact(identity, host(async (name) => { assert.equal(name, '报告.md'); return destination; }));
    assert.deepEqual(result, { status: 'saved' });
    assert.deepEqual(await readFile(destination), bytes);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('host export handles cancel, write failure, corrupt download, identity drift and invalid renderer input', async () => {
  let writes = 0;
  const base = host(async () => '/ignored');
  const write = async () => { writes++; };
  assert.equal((await exportArtifact(identity, { ...base, choosePath: async () => undefined, write })).status, 'cancelled');
  assert.equal(writes, 0);
  assert.equal((await exportArtifact(identity, { ...base, write: async () => { throw Error('disk full'); } })).status, 'failed');
  const corrupt = { ...base, fetch: (async (url: string | URL | Request) => String(url).includes('download=1') ? new Response('corrupt') : base.fetch(url)) as typeof fetch, write };
  assert.equal((await exportArtifact(identity, corrupt)).status, 'failed');
  assert.equal(writes, 0);
  const drift = { ...base, fetch: (async () => Response.json({ data: { artifact: { ...identity, id: 'other' } } })) as typeof fetch, write };
  assert.equal((await exportArtifact(identity, drift)).status, 'failed');
  assert.equal((await exportArtifact({ ...identity, sha256: 'invalid' }, base)).status, 'failed');
});
