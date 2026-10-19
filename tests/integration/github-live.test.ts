import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApplication } from '../../packages/server/src/index.ts';

/**
 * Live GitHub read-only verification. Requires GITHUB_TEST_TOKEN (a PAT with
 * repo read access) and optionally GITHUB_TEST_REPO=owner/repo.
 * No write commands are issued: only /user and merge-request reads.
 */
const token = process.env.GITHUB_TEST_TOKEN ?? '';
const repoFullName = process.env.GITHUB_TEST_REPO ?? 'wangyufengsky/opencode-workflow';
const apiBaseUrl = process.env.GITHUB_TEST_API ?? 'https://api.github.com';
const live = token !== '';

test('live: GitHub token connects and merge requests are readable (no token leak)', { skip: !live, timeout: 60000 }, async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'aw-gh-live-'));
  const repository = mkdtempSync(join(tmpdir(), 'aw-gh-live-repo-'));
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repository });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repository });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: repository });
  writeFileSync(join(repository, 'README.md'), '# demo\n', 'utf8');
  execFileSync('git', ['add', '.'], { cwd: repository });
  execFileSync('git', ['commit', '-qm', 'init'], { cwd: repository });
  execFileSync('git', ['remote', 'add', 'origin', `https://github.com/${repoFullName}.git`], { cwd: repository });

  const app = await createApplication({ dataDir, disableOpenCode: true, disableListen: true });
  try {
    const save = await app.app.inject({
      method: 'POST',
      url: '/api/settings/gitlab',
      payload: { requestKey: `req_${Math.random().toString(36).slice(2, 21)}`, provider: 'github', baseUrl: 'https://github.com', apiBaseUrl, token },
    });
    assert.equal(save.statusCode, 200, save.body);
    assert.equal(save.json().data.connection.state, 'connected', save.body);
    assert.ok(typeof save.json().data.connection.accountUsername === 'string');
    assert.ok(!save.body.includes(token), 'token must never be echoed');

    const project = await app.app.inject({
      method: 'POST',
      url: '/api/projects',
      payload: { requestKey: `req_${Math.random().toString(36).slice(2, 21)}`, name: 'GitHub read-only', rootPath: repository },
    });
    const projectId = project.json().data.resource.project.id;
    const mrs = await app.app.inject({ method: 'GET', url: `/api/git/repos/${projectId}/merge-requests` });
    assert.equal(mrs.statusCode, 200, mrs.body);
    assert.ok(Array.isArray(mrs.json().data.mergeRequests));
    assert.ok(!mrs.body.includes(token));
    for (const mr of mrs.json().data.mergeRequests) {
      assert.ok(typeof mr.iid === 'number');
      assert.ok(typeof mr.title === 'string');
    }
    const bootstrap = await app.app.inject({ method: 'GET', url: '/api/bootstrap' });
    assert.equal(bootstrap.json().data.integration.git.github.authState, 'connected');
    assert.ok(!bootstrap.body.includes(token));
  } finally {
    await app.close();
  }
});
