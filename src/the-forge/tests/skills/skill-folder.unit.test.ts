import { describe, expect, it } from 'vitest';
import { skillFileIssues, skillFileNames, skillFiles, skillFolderFiles, skillPathIssues } from '../../src/domain/skills/skill.ts';

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
  it('rejects skill ids and file names that are Windows device names, naming the skill, file and segment', () => {
    expect(skillPathIssues('q', { 'references/editing.md': 'E', 'references/console.md': 'C', 'references/com10.md': 'C' })).toEqual([]);
    expect(skillPathIssues('con')).toEqual([{ message: expect.stringContaining('Skill id con is a Windows reserved device name'), details: { skill: 'con', reason: 'device-name', segment: 'con' } }]);
    for (const [file, segment] of [['references/aux.md', 'aux.md'], ['NUL/a.md', 'NUL'], ['references/Com1.tar.gz', 'Com1.tar.gz'], ['lpt¹.md', 'lpt¹.md'], ['conin$.md', 'conin$.md']]) {
      expect(skillPathIssues('q', { [file!]: 'x' }), file).toEqual([{ message: `Skill q file ${file} uses the Windows reserved device name ${segment}, which no Windows system can install; rename it.`, details: { skill: 'q', reason: 'device-name', file, segment } }]);
    }
  });

  it('rejects paths that name one file, or a file and a folder, on case-insensitive filesystems', () => {
    expect(skillPathIssues('q', { 'references/Steps.md': 'A', 'references/steps.md': 'B', 'references/other.md': 'C' })).toEqual([{
      message: 'Skill q file references/steps.md names the same file as references/Steps.md where letter case and trailing dots are ignored, as on Windows and macOS; rename one of them.',
      details: { skill: 'q', reason: 'case-duplicate', file: 'references/steps.md', duplicateOf: 'references/Steps.md' },
    }]);
    // Windows drops trailing dots, so `SKILL.md.` replaces SKILL.md; folder names in another case merge into one folder.
    expect(skillPathIssues('q', { 'SKILL.md.': 'x' })[0]?.details).toEqual({ skill: 'q', reason: 'case-duplicate', file: 'SKILL.md.', duplicateOf: 'SKILL.md' });
    expect(skillPathIssues('q', { 'References/a.md': 'A', 'references/b.md': 'B' })).toEqual([]);
    expect(skillPathIssues('q', { references: 'A', 'References/b.md': 'B' })).toEqual([{
      message: 'Skill q file references is also the folder of References/b.md; a path cannot be both a file and a folder.',
      details: { skill: 'q', reason: 'folder-conflict', file: 'references', duplicateOf: 'References/b.md' },
    }]);
    expect(skillPathIssues('q', { 'SKILL.md/notes.md': 'x' })[0]?.details).toMatchObject({ reason: 'folder-conflict', file: 'SKILL.md', duplicateOf: 'SKILL.md/notes.md' });
  });
});
