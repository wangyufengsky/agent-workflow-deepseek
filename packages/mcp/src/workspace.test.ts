import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { AppError, ErrorCode } from '@agent-workflow/shared';
import { WorkspaceService } from './workspace.ts';

interface TempRoot {
  readonly dir: string;
  readonly cleanup: () => Promise<void>;
}

async function makeRoot(): Promise<TempRoot> {
  const dir = await mkdtemp(join(tmpdir(), 'aw-workspace-'));
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

function service(root: string, options: { allowWrite?: boolean; maxFileBytes?: number; maxListEntries?: number } = {}): WorkspaceService {
  return new WorkspaceService({
    root,
    allowWrite: options.allowWrite ?? false,
    ...(options.maxFileBytes === undefined ? {} : { maxFileBytes: options.maxFileBytes }),
    ...(options.maxListEntries === undefined ? {} : { maxListEntries: options.maxListEntries }),
  });
}

async function codeOf(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof AppError, `expected AppError, got ${String(error)}`);
    return error;
  }
  assert.fail('expected the operation to reject');
}

describe('workspace file read', () => {
  it('reads UTF-8 text as lines with sha metadata', async () => {
    const root = await makeRoot();
    try {
      await writeFile(join(root.dir, 'readme.md'), '你好 workspace');
      const result = await service(root.dir).read('readme.md');
      assert.deepEqual(result.lines, ['你好 workspace']);
      assert.equal(result.sizeBytes, Buffer.byteLength('你好 workspace'));
      assert.equal(result.offset, 0);
      assert.equal(result.totalLines, 1);
      assert.match(result.sha, /^[a-f0-9]{64}$/);
      assert.equal(result.truncated, false);
      assert.equal(result.path, 'readme.md');
      assert.equal(result.readOnly, true);
    } finally {
      await root.cleanup();
    }
  });

  it('supports line offset/limit and marks truncation', async () => {
    const root = await makeRoot();
    try {
      await writeFile(join(root.dir, 'data.txt'), 'a\nb\nc\nd\ne');
      const result = await service(root.dir).read('data.txt', { offset: 1, limit: 2 });
      assert.deepEqual(result.lines, ['b', 'c']);
      assert.equal(result.truncated, true);
      assert.equal(result.offset, 1);
      assert.equal(result.totalLines, 5);
      const all = await service(root.dir).read('data.txt', { limit: 0 });
      assert.deepEqual(all.lines, ['a', 'b', 'c', 'd', 'e']);
      assert.equal(all.truncated, false);
    } finally {
      await root.cleanup();
    }
  });

  it('rejects missing paths, directories and binary content', async () => {
    const root = await makeRoot();
    try {
      await mkdir(join(root.dir, 'sub'));
      await writeFile(join(root.dir, 'bin.dat'), Buffer.from([0, 1, 2, 3]));
      await writeFile(join(root.dir, 'big.txt'), 'x'.repeat(20));
      assert.equal((await codeOf(service(root.dir).read('nope.txt'))).code, ErrorCode.NOT_FOUND);
      assert.equal((await codeOf(service(root.dir).read('sub'))).code, ErrorCode.VALIDATION_FAILED);
      assert.equal((await codeOf(service(root.dir).read('bin.dat'))).code, ErrorCode.BINARY_FILE);
      assert.equal((await codeOf(service(root.dir, { maxFileBytes: 10 }).read('big.txt'))).code, ErrorCode.TRUNCATED);
    } finally {
      await root.cleanup();
    }
  });

  it('rejects absolute paths, .. traversal and Windows-style traversal', async () => {
    const root = await makeRoot();
    try {
      for (const path of ['/etc/passwd', '../outside.txt', 'a/../../outside.txt', 'a\\..\\outside.txt', 'C:\\temp\\x.txt']) {
        const error = await codeOf(service(root.dir).read(path));
        assert.equal(error.code, ErrorCode.FORBIDDEN, path);
      }
    } finally {
      await root.cleanup();
    }
  });

  it('rejects symlinks that escape the root but allows internal symlinks', async () => {
    const root = await makeRoot();
    const outside = await mkdtemp(join(tmpdir(), 'aw-outside-'));
    try {
      await writeFile(join(outside, 'secret.txt'), 'outside');
      await symlink(join(outside, 'secret.txt'), join(root.dir, 'escape.txt'));
      await writeFile(join(root.dir, 'inside.txt'), 'inside');
      await symlink(join(root.dir, 'inside.txt'), join(root.dir, 'comfortable.txt'));
      const escaped = await codeOf(service(root.dir).read('escape.txt'));
      assert.equal(escaped.code, ErrorCode.FORBIDDEN);
      assert.equal(escaped.details?.reason, 'path_escape');
      const internal = await service(root.dir).read('comfortable.txt');
      assert.deepEqual(internal.lines, ['inside']);
    } finally {
      await root.cleanup();
      await rm(outside, { recursive: true, force: true });
    }
  });

  it('reports WORKSPACE_NOT_READY when the root is missing or unconfigured', async () => {
    const root = await makeRoot();
    try {
      assert.equal((await codeOf(service(join(root.dir, 'missing')).read('x.txt'))).code, ErrorCode.WORKSPACE_NOT_READY);
      assert.equal((await codeOf(service('').list())).code, ErrorCode.NOT_CONFIGURED);
    } finally {
      await root.cleanup();
    }
  });
});

describe('workspace file list', () => {
  it('lists flattened recursive entries with sizes and optional truncation', async () => {
    const root = await makeRoot();
    try {
      await mkdir(join(root.dir, 'src'));
      await writeFile(join(root.dir, 'a.txt'), 'a');
      await writeFile(join(root.dir, 'b.txt'), 'bb');
      await writeFile(join(root.dir, 'src', 'c.ts'), 'ccc');
      const result = await service(root.dir).list();
      assert.deepEqual(
        result.entries.map((entry) => [entry.path, entry.kind]),
        [
          ['a.txt', 'file'],
          ['b.txt', 'file'],
          ['src', 'directory'],
          ['src/c.ts', 'file'],
        ],
      );
      assert.equal(result.entries[1]?.sizeBytes, 2);
      assert.equal(result.entries[3]?.sizeBytes, 3);
      const truncated = await service(root.dir, { maxListEntries: 1 }).list();
      assert.equal(truncated.entries.length, 1);
      assert.equal(truncated.truncated, true);
    } finally {
      await root.cleanup();
    }
  });

  it('rejects listing a file and escaping paths', async () => {
    const root = await makeRoot();
    try {
      await writeFile(join(root.dir, 'a.txt'), 'a');
      assert.equal((await codeOf(service(root.dir).list('a.txt'))).code, ErrorCode.VALIDATION_FAILED);
      assert.equal((await codeOf(service(root.dir).list('..'))).code, ErrorCode.FORBIDDEN);
    } finally {
      await root.cleanup();
    }
  });
});

describe('workspace file write', () => {
  it('is disabled unless AGENT_WORKFLOW_ALLOW_WRITE is enabled', async () => {
    const root = await makeRoot();
    try {
      const error = await codeOf(service(root.dir).write('a.txt', 'x'));
      assert.equal(error.code, ErrorCode.FORBIDDEN);
      assert.equal(error.details?.reason, 'write_disabled');
    } finally {
      await root.cleanup();
    }
  });

  it('creates nested directories, writes content and returns sha/size', async () => {
    const root = await makeRoot();
    try {
      const writable = service(root.dir, { allowWrite: true });
      const result = await writable.write('nested/dir/file.txt', 'hello');
      assert.equal(result.path, 'nested/dir/file.txt');
      assert.equal(result.sizeBytes, 5);
      assert.match(result.sha, /^[a-f0-9]{64}$/);
      assert.deepEqual((await writable.read('nested/dir/file.txt')).lines, ['hello']);
    } finally {
      await root.cleanup();
    }
  });

  it('enforces expectedSha optimistic concurrency', async () => {
    const root = await makeRoot();
    try {
      const writable = service(root.dir, { allowWrite: true });
      const first = await writable.write('a.txt', 'one');
      const conflict = await codeOf(writable.write('a.txt', 'two', 'deadbeef'.repeat(8)));
      assert.equal(conflict.code, ErrorCode.STALE_TARGET);
      assert.equal(typeof conflict.details?.currentSha, 'string');
      const updated = await writable.write('a.txt', 'two', first.sha);
      assert.deepEqual((await writable.read('a.txt')).lines, ['two']);
      assert.notEqual(updated.sha, first.sha);
    } finally {
      await root.cleanup();
    }
  });

  it('rejects oversized content, absolute paths and symlink targets', async () => {
    const root = await makeRoot();
    const outside = await mkdtemp(join(tmpdir(), 'aw-outside-write-'));
    try {
      const writable = service(root.dir, { allowWrite: true, maxFileBytes: 4 });
      assert.equal((await codeOf(writable.write('a.txt', '12345'))).code, ErrorCode.VALIDATION_FAILED);
      assert.equal((await codeOf(writable.write('/tmp/a.txt', 'x'))).code, ErrorCode.FORBIDDEN);
      await writeFile(join(outside, 'target.txt'), 'outside');
      await symlink(join(outside, 'target.txt'), join(root.dir, 'link.txt'));
      const symlinkError = await codeOf(service(root.dir, { allowWrite: true }).write('link.txt', 'x'));
      assert.equal(symlinkError.code, ErrorCode.FORBIDDEN);
      assert.equal(symlinkError.details?.reason, 'symlink_write');
    } finally {
      await root.cleanup();
      await rm(outside, { recursive: true, force: true });
    }
  });

  it('rejects writing through a symlinked parent directory', async () => {
    const root = await makeRoot();
    const outside = await mkdtemp(join(tmpdir(), 'aw-outside-parent-'));
    try {
      await symlink(outside, join(root.dir, 'escape-dir'));
      const error = await codeOf(service(root.dir, { allowWrite: true }).write('escape-dir/nested/file.txt', 'x'));
      assert.equal(error.code, ErrorCode.FORBIDDEN);
      assert.equal(error.details?.reason, 'path_escape');
    } finally {
      await root.cleanup();
      await rm(outside, { recursive: true, force: true });
    }
  });
});
