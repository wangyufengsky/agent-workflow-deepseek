import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApplication } from '../../packages/server/src/index.ts';
import { RemoteService } from '../../packages/server/src/remote.ts';

/**
 * Live GitHub write verification: push a throwaway branch to a disposable
 * repository, create a merge request through RemoteService, then close the MR
 * and delete the branch. Gated by GITHUB_TEST_TOKEN + GITHUB_TEST_WRITE_REPO.
 * Tokens are only passed via git http.extraheader and never logged.
 */
const token = process.env.GITHUB_TEST_TOKEN ?? '';
const repoFullName = process.env.GITHUB_TEST_WRITE_REPO ?? '';
const apiBaseUrl = process.env.GITHUB_TEST_API ?? 'https://api.github.com';
const live = token !== '' && repoFullName !== '';

function authArgs(): string[] {
  const basic = Buffer.from(`x-access-token:${token}`).toString('base64');
  return ['-c', `http.extraheader=Authorization: Basic ${basic}`];
}

function git(args: string[], cwd: string): string {
  return execFileSync('git', [...authArgs(), ...args], { cwd, encoding: 'utf8' }).trim();
}

test('live: push a disposable branch, create MR via RemoteService, then close and delete', { skip: !live, timeout: 180_000 }, async () => {
  const work = mkdtempSync(join(tmpdir(), 'aw-gh-write-'));
  const checkout = join(work, 'repo');
  const branch = `agent-workflow/write-test-${Date.now().toString(36)}`;
  let projectId: string | undefined;
  let iid: number | undefined;
  let app: Awaited<ReturnType<typeof createApplication>> | undefined;
  try {
    execFileSync('git', [...authArgs(), 'clone', '--depth', '1', `https://github.com/${repoFullName}.git`, checkout], { stdio: 'pipe' });
    const targetBranch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: checkout, encoding: 'utf8' }).trim();
    execFileSync('git', ['config', 'user.email', 'agent-workflow@example.com'], { cwd: checkout });
    execFileSync('git', ['config', 'user.name', 'Agent Workflow'], { cwd: checkout });
    execFileSync('git', ['checkout', '-qb', branch], { cwd: checkout });
    writeFileSync(join(checkout, 'AGENT_WORKFLOW_WRITE_TEST.md'), `# Agent Workflow write test\n\nbranch: ${branch}\n`, 'utf8');
    execFileSync('git', ['add', 'AGENT_WORKFLOW_WRITE_TEST.md'], { cwd: checkout });
    execFileSync('git', ['commit', '-qm', `test: agent-workflow remote write ${branch}`], { cwd: checkout });
    const headSha = git(['rev-parse', 'HEAD'], checkout);
    git(['push', 'origin', `${branch}:${branch}`], checkout);
    const pushed = git(['ls-remote', 'origin', `refs/heads/${branch}`], checkout);
    assert.ok(pushed.includes(branch), 'branch must exist on the remote after push');

    app = await createApplication({ dataDir: join(work, 'data'), disableOpenCode: true, disableListen: true });
    const save = await app.app.inject({
      method: 'POST',
      url: '/api/settings/gitlab',
      payload: { requestKey: `req_${Math.random().toString(36).slice(2, 21)}`, provider: 'github', baseUrl: 'https://github.com', apiBaseUrl, token },
    });
    assert.equal(save.statusCode, 200, save.body);
    assert.ok(!save.body.includes(token), 'token must never be echoed');
    const project = await app.app.inject({ method: 'POST', url: '/api/projects', payload: { requestKey: `req_${Math.random().toString(36).slice(2, 21)}`, name: 'GitHub write test', rootPath: checkout } });
    assert.equal(project.statusCode, 201, project.body);
    projectId = project.json().data.resource.project.id;

    const remote = new RemoteService(app.store);
    const mr = await remote.createMergeRequest(projectId!, {
      sourceBranch: branch,
      targetBranch,
      title: `[agent-workflow write test] ${branch}`,
      description: `Automated validation from agent-workflow.\nhead: ${headSha}\ntarget: ${targetBranch}\nThis MR is closed automatically.`,
    });
    iid = mr.iid;
    assert.ok(Number.isInteger(mr.iid) && mr.iid > 0);
    assert.match(mr.webUrl, /github\.com\/.+\/pull\/\d+/);
    const list = await remote.listMergeRequests(projectId!, 'opened');
    assert.ok(list.some((item) => item.iid === mr.iid), 'created MR must be listed as opened');
    console.log('[github-write] pushed branch, created and listed MR', JSON.stringify({ iid: mr.iid, branch, targetBranch, webUrl: mr.webUrl }));
  } finally {
    if (iid !== undefined) {
      try {
        const response = await fetch(`${apiBaseUrl}/repos/${repoFullName}/pulls/${String(iid)}`, {
          method: 'PATCH',
          headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'content-type': 'application/json' },
          body: JSON.stringify({ state: 'closed' }),
        });
        console.log('[github-write] close MR', iid, response.status);
      } catch (error) {
        console.error('[github-write] close MR failed', error instanceof Error ? error.message : 'unknown');
      }
    }
    try {
      if (projectId !== undefined) {
        execFileSync('git', [...authArgs(), 'push', 'origin', '--delete', branch], { cwd: checkout, stdio: 'pipe' });
        console.log('[github-write] deleted remote branch', branch);
      }
    } catch (error) {
      console.error('[github-write] delete branch failed', error instanceof Error ? error.message : 'unknown');
    }
    if (app !== undefined) await app.close();
    rmSync(work, { recursive: true, force: true });
  }
});
