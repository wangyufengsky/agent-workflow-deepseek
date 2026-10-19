import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, existsSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequestKey } from '@agent-workflow/shared';
import { detectProjectTechnology } from '../../packages/engine/src/project-technology.ts';
import { createApplication } from '../../packages/server/src/index.ts';
const temp = () => mkdtempSync(join(tmpdir(), 'aw-project-stack-'));

test('static project facts identify actual dependency declarations with immutable source identities and bounded monorepo paths', async () => {
  const root = temp(); const packageText = JSON.stringify({ name: 'fixture', scripts: { postinstall: 'touch SHOULD_NOT_RUN' }, dependencies: { react: '^19', fastify: '^5' }, devDependencies: { typescript: '^5' } });
  writeFileSync(join(root, 'package.json'), packageText); mkdirSync(join(root, 'apps/web'), { recursive: true }); writeFileSync(join(root, 'apps/web/package.json'), '{"name":"web","dependencies":{"vue":"3"}}');
  writeFileSync(join(root, 'pom.xml'), '<project><dependencies><dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter</artifactId></dependency></dependencies><build><plugins><plugin><artifactId>maven-compiler-plugin</artifactId></plugin></plugins></build></project>');
  const facts = await detectProjectTechnology(root); assert.equal(facts.state, 'detected'); assert.deepEqual(facts.technologies, ['Fastify', 'Java', 'JavaScript', 'Maven', 'React', 'Spring Boot', 'TypeScript', 'Vue']);
  assert.equal(facts.sources.find((source) => source.path === 'package.json')?.sha256, createHash('sha256').update(packageText).digest('hex')); assert.ok(facts.sources.some((source) => source.path === 'apps/web/package.json')); assert.equal(existsSync(join(root, 'SHOULD_NOT_RUN')), false);
});

test('symlink files/directories, malformed manifests, entities, oversized inputs and missing roots never masquerade as detected stacks', async () => {
  const root = temp(); const outside = temp(); writeFileSync(join(outside, 'package.json'), '{"name":"outside","dependencies":{"react":"19"}}'); symlinkSync(join(outside, 'package.json'), join(root, 'package.json')); symlinkSync(outside, join(root, 'apps'));
  const symlink = await detectProjectTechnology(root); assert.equal(symlink.state, 'unavailable'); assert.equal(symlink.sources.length, 0); assert.ok(symlink.warnings.length); assert.equal(symlink.technologies.includes('React'), false);
  rmSync(join(root, 'package.json')); writeFileSync(join(root, 'package.json'), '{broken'); writeFileSync(join(root, 'pom.xml'), '<!DOCTYPE x [<!ENTITY remote SYSTEM "file:///etc/passwd">]><project>&remote;</project>');
  const malformed = await detectProjectTechnology(root); assert.equal(malformed.state, 'unavailable'); assert.equal(malformed.sources.length, 0);
  rmSync(join(root, 'package.json')); rmSync(join(root, 'pom.xml')); rmSync(join(root, 'apps')); writeFileSync(join(root, 'requirements.txt'), 'x'.repeat(70_000));
  const oversized = await detectProjectTechnology(root); assert.equal(oversized.truncated, true); assert.equal(oversized.sources.length, 0); assert.equal(oversized.state, 'unavailable');
  assert.equal((await detectProjectTechnology(join(root, 'missing'))).state, 'unavailable');
  assert.equal((await detectProjectTechnology(temp())).state, 'unknown');
  mkdirSync(join(root, 'packages')); for (let index = 0; index < 20; index++) { mkdirSync(join(root, `packages/p${index}`)); writeFileSync(join(root, `packages/p${index}/go.mod`), `module fixture/p${index}\n`); }
  const bounded = await detectProjectTechnology(root); assert.equal(bounded.truncated, true); assert.ok(bounded.sources.length <= 8); assert.equal(bounded.sources.reduce((sum, source) => sum + source.bytes, 0) <= 512 * 1024, true);
});

test('project registration/recheck and reload project facts persist actual current HEAD without substituting the default branch or executing fsmonitor', async () => {
  const root = temp(); const dataDir = temp(); const git = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'pipe' }).toString();
  git('init', '-q', '-b', 'main'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.invalid'); writeFileSync(join(root, 'package.json'), '{"name":"fixture","dependencies":{"react":"19"}}'); git('add', '.'); git('commit', '-qm', 'fixture'); git('checkout', '-qb', 'feature/actual-head');
  const hook = join(root, 'fsmonitor-fixture.sh'); writeFileSync(hook, '#!/bin/sh\ntouch "'+join(root, 'HOOK_MUST_NOT_RUN')+'"\n'); chmodSync(hook, 0o700); git('config', 'core.fsmonitor', hook);
  let app = await createApplication({ dataDir, disableOpenCode: true, disableListen: true }); let projectId = '';
  try {
    const created = await app.app.inject({ method: 'POST', url: '/api/projects', payload: { requestKey: createRequestKey(), name: 'Actual stack fixture', rootPath: root } }); assert.equal(created.statusCode, 201, created.body);
    const project = created.json().data.resource.project; projectId = project.id; assert.equal(project.defaultBranch, 'main'); assert.equal(project.facts.branch.name, 'feature/actual-head'); assert.equal(project.facts.technology.state, 'detected'); assert.ok(project.facts.technology.technologies.includes('React')); assert.equal(existsSync(join(root, 'HOOK_MUST_NOT_RUN')), false);
    const list = await app.app.inject({ method: 'GET', url: '/api/projects' }); assert.equal(list.json().data.items[0].facts.branch.name, 'feature/actual-head');
    writeFileSync(join(root, 'package.json'), '{"name":"fixture","dependencies":{"vue":"3"}}'); git('checkout', '-q', '--detach'); rmSync(join(root, 'HOOK_MUST_NOT_RUN'), { force: true });
    const checked = await app.app.inject({ method: 'POST', url: `/api/projects/${projectId}/recheck`, payload: { requestKey: createRequestKey() } }); assert.equal(checked.statusCode, 200, checked.body); assert.equal(checked.json().data.resource.project.facts.branch.kind, 'detached'); assert.deepEqual(checked.json().data.resource.project.facts.technology.technologies, ['JavaScript', 'Vue']); assert.equal(existsSync(join(root, 'HOOK_MUST_NOT_RUN')), false);
    await app.close(); app = await createApplication({ dataDir, disableOpenCode: true, disableListen: true });
    const detail = await app.app.inject({ method: 'GET', url: `/api/projects/${projectId}` }); assert.equal(detail.json().data.project.facts.branch.kind, 'detached'); assert.ok(detail.json().data.project.facts.technology.sources[0].sha256);
  } finally { await app.close(); }
});
