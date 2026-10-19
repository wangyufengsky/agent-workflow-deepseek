import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { SkillInfo } from '@agent-workflow/shared';

/** Read-only Skill discovery; never installs, edits or executes Skill content. */
export function discoverSkills(env: NodeJS.ProcessEnv = process.env): readonly SkillInfo[] {
  const roots = (env.AGENT_WORKFLOW_SKILL_DIRS ?? '')
    .split(':')
    .map((item) => item.trim())
    .filter((item) => item !== '');
  const directories = roots.length > 0
    ? roots
    : [join(homedir(), '.claude', 'skills'), join(homedir(), '.agents', 'skills')];
  const skills: SkillInfo[] = [];
  const seen = new Set<string>();
  for (const root of directories) {
    if (!existsSync(root)) continue;
    let entries: string[];
    try {
      entries = readdirSync(root);
    } catch {
      continue;
    }
    for (const entry of entries.sort().slice(0, 200)) {
      const directory = join(root, entry);
      try {
        if (!statSync(directory).isDirectory()) continue;
      } catch {
        continue;
      }
      const file = join(directory, 'SKILL.md');
      if (!existsSync(file)) continue;
      let markdown: string;
      try {
        markdown = readFileSync(file, 'utf8').slice(0, 20_000);
      } catch {
        continue;
      }
      const frontmatter = parseFrontmatter(markdown);
      const name = frontmatter.name ?? entry;
      if (seen.has(name)) continue;
      seen.add(name);
      skills.push({
        id: name,
        name,
        description: frontmatter.description ?? firstParagraph(markdown),
        path: file,
        source: root,
      });
    }
  }
  return skills.slice(0, 200);
}

function parseFrontmatter(markdown: string): { name?: string; description?: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(markdown);
  if (match === null) return {};
  const result: { name?: string; description?: string } = {};
  for (const line of match[1]!.split(/\r?\n/)) {
    const pair = /^(name|description):\s*(.+)$/.exec(line);
    if (pair === null) continue;
    const value = pair[2]!.trim().replace(/^["']|["']$/g, '');
    if (value !== '') result[pair[1] as 'name' | 'description'] = value;
  }
  return result;
}

function firstParagraph(markdown: string): string {
  const body = markdown.replace(/^---[\s\S]*?---/, '').trim();
  const line = body.split(/\r?\n/).find((item) => item.trim() !== '' && !item.startsWith('#')) ?? '';
  return line.trim().slice(0, 500);
}


/** Read one discovered SKILL.md with line numbers; read-only and size-bounded. */
export function readSkillSource(id: string): { id: string; name: string; path: string; lines: readonly { number: number; text: string }[] } {
  const skill = discoverSkills().find((item) => item.id === id);
  if (skill === undefined) throw new Error('SKILL_NOT_FOUND');
  let markdown = '';
  try {
    markdown = readFileSync(skill.path, 'utf8');
  } catch {
    throw new Error('SKILL_UNREADABLE');
  }
  const lines = markdown.split(/\r?\n/).slice(0, 2_000).map((text, index) => ({ number: index + 1, text: text.slice(0, 2_000) }));
  return { id: skill.id, name: skill.name, path: skill.path, lines };
}
