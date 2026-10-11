import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { bundledSkills } from '../../src/plugins/skills/infrastructure/bundled-skills.ts';
import { agentsSkill } from '../../src/plugins/agents/infrastructure/skill.ts';
import { backlogSkill } from '../../src/plugins/backlog/infrastructure/skill.ts';
import { skillIssues } from '../../src/domain/skills/skill.ts';
import { skillFrontmatter } from '../../src/infrastructure/plugins/skill-frontmatter.ts';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const folders = readdirSync('skills', { withFileTypes: true });
const allowed = ['name', 'description', 'license', 'compatibility', 'metadata', 'allowed-tools'];

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
    expect(folders.map(entry => entry.name).sort()).toEqual(['forge-agents', 'forge-backlog', 'forge-development', 'forge-vault', 'forge-workflow']);
  });

  it.each(folders.map(entry => entry.name))('%s follows the Agent Skills specification', folder => {
    const content = readFileSync(`skills/${folder}/SKILL.md`, 'utf8');
    expect(specificationIssues(folder, content)).toEqual([]);
    expect(skillIssues(folder, skillFrontmatter(content))).toEqual([]);
  });

  it('registers each authored folder under its own name, as plugins contribute skills in the same shape', async () => {
    // Loaded by URL: the example plugin is runnable JavaScript, not part of the typed test program.
    const examplePlugin = (await import(pathToFileURL(resolve('docs/examples/plugins/quality/main.mjs')).href)).default as { skills: Array<{ id: string; content: string }> };
    const registered = [...bundledSkills, agentsSkill, backlogSkill];
    expect(registered.map(skill => skill.id).sort()).toEqual(folders.map(entry => entry.name).sort());
    for (const skill of registered) expect(skill.content).toBe(readFileSync(`skills/${skill.id}/SKILL.md`, 'utf8'));
    for (const skill of examplePlugin.skills) expect(specificationIssues(skill.id, skill.content)).toEqual([]);
  });
});
