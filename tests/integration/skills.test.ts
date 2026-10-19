import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApplication } from '../../packages/server/src/index.ts';

test('skills endpoint discovers SKILL.md metadata from configured directories', async () => {
  const root = mkdtempSync(join(tmpdir(), 'aw-skills-'));
  const skillDir = join(root, 'web-review');
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(join(skillDir, 'SKILL.md'), '---\nname: web-review\ndescription: Review web UI accessibility\n---\n\n# Web Review\n', 'utf8');
  const previous = process.env.AGENT_WORKFLOW_SKILL_DIRS;
  process.env.AGENT_WORKFLOW_SKILL_DIRS = root;
  const dataDir = mkdtempSync(join(tmpdir(), 'aw-skills-data-'));
  const app = await createApplication({ dataDir, disableOpenCode: true, disableListen: true });
  try {
    const response = await app.app.inject({ method: 'GET', url: '/api/skills' });
    assert.equal(response.statusCode, 200, response.body);
    const skills = response.json().data.skills as { id: string; name: string; description: string; path: string }[];
    assert.equal(skills.length, 1);
    assert.equal(skills[0]!.id, 'web-review');
    assert.equal(skills[0]!.description, 'Review web UI accessibility');
    assert.ok(skills[0]!.path.endsWith('SKILL.md'));
    const source = await app.app.inject({ method: 'GET', url: '/api/skills/web-review/source' });
    assert.equal(source.statusCode, 200, source.body);
    const lines = source.json().data.lines as { number: number; text: string }[];
    assert.equal(lines[0]!.number, 1);
    assert.equal(lines[0]!.text, '---');
    assert.ok(lines.some((line) => line.text === '# Web Review'));
    assert.equal((await app.app.inject({ method: 'GET', url: '/api/skills/missing/source' })).statusCode, 404);
  } finally {
    await app.close();
    if (previous === undefined) delete process.env.AGENT_WORKFLOW_SKILL_DIRS;
    else process.env.AGENT_WORKFLOW_SKILL_DIRS = previous;
  }
});
