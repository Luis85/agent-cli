import { describe, expect, it } from 'vitest';
import { skillFileIssues, skillFileNames, skillFiles, skillFolderFiles } from '../../src/domain/skills/skill.ts';

const skill = { id: 'quality-review', content: '---\nname: quality-review\n---\n', files: { 'references/z.md': 'Z', 'references/a.md': 'A' } };

describe('the files of an Agent Skill folder', () => {
  it('installs SKILL.md first and then the reference files in path order under every root', () => {
    expect(skillFileNames(skill)).toEqual(['SKILL.md', 'references/a.md', 'references/z.md']);
    expect(skillFiles(skill, ['.claude/skills', 'tools'])).toEqual([
      { path: '.claude/skills/quality-review/SKILL.md', content: skill.content },
      { path: '.claude/skills/quality-review/references/a.md', content: 'A' },
      { path: '.claude/skills/quality-review/references/z.md', content: 'Z' },
      { path: 'tools/quality-review/SKILL.md', content: skill.content },
      { path: 'tools/quality-review/references/a.md', content: 'A' },
      { path: 'tools/quality-review/references/z.md', content: 'Z' },
    ]);
    expect(skillFiles({ id: 'solo', content: 'S' }, ['.agents/skills'])).toEqual([{ path: '.agents/skills/solo/SKILL.md', content: 'S' }]);
  });

  it('keys build-time glob modules by their path inside the skill folder', () => {
    expect(skillFolderFiles('forge-vault', { '../../skills/forge-vault/references/editing.md': 'E', '/abs/skills/forge-vault/references/x/y.md': 'Y' }))
      .toEqual({ 'references/editing.md': 'E', 'references/x/y.md': 'Y' });
  });

  it('accepts relative text files and rejects paths that escape, hide or replace SKILL.md', () => {
    expect(skillFileIssues('q', undefined)).toEqual([]);
    expect(skillFileIssues('q', { 'references/editing.md': 'text', 'scripts/check.mjs': '' })).toEqual([]);
    expect(skillFileIssues('q', ['references/a.md'])).toEqual(['Skill q files must map paths inside the skill folder to text.']);
    for (const path of ['../x.md', '/abs.md', 'references/../x.md', '.hidden.md', 'references/', 'a\\b.md', 'SKILL.md', 'skill.md', 'a//b.md', `${'x'.repeat(256)}.md`]) {
      expect(skillFileIssues('q', { [path]: 'text' }), path).toEqual([`Skill q file ${path} must be a relative path inside the skill folder other than SKILL.md.`]);
    }
    expect(skillFileIssues('q', { 'references/a.md': 3 })).toEqual(['Skill q file references/a.md must be text.']);
  });
});
