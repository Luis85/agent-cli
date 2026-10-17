import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { relative } from 'node:path';
import { parse } from 'yaml';
import { bundledSkills } from '../../src/plugins/skills/infrastructure/bundled-skills.ts';
import { agentsSkill } from '../../src/plugins/agents/infrastructure/skill.ts';
import { backlogSkill } from '../../src/plugins/backlog/infrastructure/skill.ts';
import { webviewsSkill } from '../../src/plugins/webviews/infrastructure/skill.ts';
import { browserSkill } from '../../src/plugins/browser/infrastructure/skill.ts';
import { skillIssues } from '../../src/domain/skills/skill.ts';
import type { Skill } from '../../src/application/plugins/registry.ts';
import { skillFrontmatter } from '../../src/infrastructure/plugins/skill-frontmatter.ts';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const folders = readdirSync('skills', { withFileTypes: true });
const allowed = ['name', 'description', 'license', 'compatibility', 'metadata', 'allowed-tools'];
/** The files of one skill folder besides SKILL.md, by path inside the folder. */
const folderFiles = (id: string) => Object.fromEntries(readdirSync(`skills/${id}`, { recursive: true, withFileTypes: true })
  .filter(entry => entry.isFile()).map(entry => relative(`skills/${id}`, `${entry.parentPath}/${entry.name}`).replaceAll('\\', '/'))
  .filter(path => path !== 'SKILL.md').map(path => [path, readFileSync(`skills/${id}/${path}`, 'utf8')]));

/** The Agent Skills specification (https://agentskills.io/specification), checked with a complete YAML parser. */
function specificationIssues(folder: string, content: string): string[] {
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(content);
  if (!match) return ['SKILL.md must start with YAML frontmatter'];
  const frontmatter = parse(match[1]!) as Record<string, unknown>;
  const issues: string[] = [];
  const { name, description, license, compatibility, metadata } = frontmatter;
  for (const key of Object.keys(frontmatter)) if (!allowed.includes(key)) issues.push(`unknown field ${key}`);
  if (typeof name !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) || name.length > 64) issues.push('name must be 1-64 lowercase letters, digits and single hyphens');
  if (name !== folder) issues.push(`name must match the folder ${folder}`);
  if (typeof description !== 'string' || description.length === 0 || description.length > 1024) issues.push('description must have 1-1024 characters');
  else if (!/\bUse when\b/.test(description)) issues.push('description must say when to use the skill');
  if (license !== undefined && typeof license !== 'string') issues.push('license must be a string');
  if (compatibility !== undefined && (typeof compatibility !== 'string' || compatibility.length === 0 || compatibility.length > 500)) issues.push('compatibility must have 1-500 characters');
  if (metadata !== undefined && (metadata === null || typeof metadata !== 'object' || Object.values(metadata).some(value => typeof value !== 'string'))) issues.push('metadata must map strings to strings');
  if (match[2]!.split('\n').length > 500) issues.push('the body should stay under 500 lines');
  return issues;
}

describe('authored Agent Skills', () => {
  it('keeps one SKILL.md per skill folder and nothing else at the skills root', () => {
    expect(folders.every(entry => entry.isDirectory()), folders.map(entry => entry.name).join(', ')).toBe(true);
    expect(folders.map(entry => entry.name).sort()).toEqual(['forge-agents', 'forge-backlog', 'forge-browser', 'forge-development', 'forge-vault', 'forge-webviews', 'forge-workflow']);
  });

  it.each(folders.map(entry => entry.name))('%s follows the Agent Skills specification', folder => {
    const content = readFileSync(`skills/${folder}/SKILL.md`, 'utf8');
    expect(specificationIssues(folder, content)).toEqual([]);
    expect(skillIssues(folder, skillFrontmatter(content))).toEqual([]);
  });

  it.each(folders.map(entry => entry.name))('%s keeps a short SKILL.md that links each reference file', folder => {
    // Agents load SKILL.md whenever the skill triggers; details belong in reference files read on demand.
    const content = readFileSync(`skills/${folder}/SKILL.md`, 'utf8');
    expect(Buffer.byteLength(content)).toBeLessThanOrEqual(4096);
    expect(Object.keys(folderFiles(folder)).filter(path => !content.includes(`](${path})`))).toEqual([]);
  });

  it('registers each authored folder under its own name, as plugins contribute skills in the same shape', async () => {
    // Loaded by URL: the example plugin is runnable JavaScript, not part of the typed test program.
    const examplePlugin = (await import(pathToFileURL(resolve('docs/examples/plugins/quality/main.mjs')).href)).default as { skills: Array<{ id: string; content: string }> };
    const registered: Skill[] = [...bundledSkills, agentsSkill, backlogSkill, webviewsSkill, browserSkill];
    expect(registered.map(skill => skill.id).sort()).toEqual(folders.map(entry => entry.name).sort());
    for (const skill of registered) {
      expect(skill.content).toBe(readFileSync(`skills/${skill.id}/SKILL.md`, 'utf8'));
      // Reference files ship with their skill: every file in the folder is registered, and nothing else.
      expect(skill.files ?? {}, skill.id).toEqual(folderFiles(skill.id));
    }
    for (const skill of examplePlugin.skills) expect(specificationIssues(skill.id, skill.content)).toEqual([]);
  });
});
