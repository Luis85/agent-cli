import { describe, expect, it } from 'vitest';
import { skillIssues } from '../../src/domain/skills/skill.ts';
import { skillFrontmatter } from '../../src/infrastructure/plugins/skill-frontmatter.ts';

const issues = (id: string, yaml: string) => skillIssues(id, skillFrontmatter(`---\n${yaml}\n---\n# Body\n`));

describe('Agent Skills frontmatter of a contributed skill', () => {
  it('reads the frontmatter as YAML: comments, quoting and block scalars', () => {
    expect(issues('quality-review', 'name: quality-review # the folder name\ndescription: Review quality. Use when asked.')).toEqual([]);
    expect(issues('quality-review', 'name: "quality-review"\ndescription: >-\n  Review quality.\n  Use when asked.\nlicense: MIT\ncompatibility: Node.js 22 or newer\nmetadata:\n  author: Forge\n  version: "1.0"\nallowed-tools: Read Grep')).toEqual([]);
    expect(issues('quality-review', 'name: quality-review\ndescription: |\n  Review quality.\nallowed-tools: [Read, Grep]')).toEqual([]);
  });

  it('requires a name that equals the id and follows the naming rules', () => {
    expect(issues('quality-review', 'description: Review.')).toEqual(['Skill quality-review frontmatter name must be quality-review.']);
    expect(issues('quality-review', 'name: other\ndescription: Review.')).toEqual(['Skill quality-review frontmatter name must be quality-review.']);
    const long = `a${'-b'.repeat(32)}`;
    expect(issues(long, `name: ${long}\ndescription: Review.`)).toEqual([expect.stringContaining('1-64 lowercase letters')]);
    expect(issues('Quality', 'name: Quality\ndescription: Review.')).toEqual([expect.stringContaining('1-64 lowercase letters')]);
  });

  it('requires a description of 1 to 1024 characters and checks the optional fields', () => {
    expect(issues('q', 'name: q\ndescription: "  "')).toEqual([expect.stringContaining('description')]);
    expect(issues('q', 'name: q\ndescription: |\n')).toEqual([expect.stringContaining('description')]);
    expect(issues('q', `name: q\ndescription: ${'x'.repeat(1025)}`)).toEqual([expect.stringContaining('at most 1024')]);
    expect(issues('q', `name: q\ndescription: Review.\ncompatibility: ${'x'.repeat(501)}`)).toEqual([expect.stringContaining('compatibility')]);
    expect(issues('q', 'name: q\ndescription: Review.\nlicense: 3')).toEqual([expect.stringContaining('license')]);
    expect(issues('q', 'name: q\ndescription: Review.\nmetadata:\n  version: 1')).toEqual([expect.stringContaining('metadata')]);
    expect(issues('q', 'name: q\ndescription: Review.\nmetadata: [a]')).toEqual([expect.stringContaining('metadata')]);
    expect(issues('q', 'name: q\ndescription: Review.\nallowed-tools: 3')).toEqual([expect.stringContaining('allowed-tools')]);
  });

  it('reports missing, malformed and non-mapping frontmatter', () => {
    expect(skillIssues('q', skillFrontmatter('# No frontmatter\n'))).toEqual(['Skill q must start with YAML frontmatter.']);
    expect(issues('q', 'name: q\ndescription: [unclosed')).toEqual([expect.stringContaining('is not valid YAML')]);
    expect(issues('q', '- name\n- description')).toEqual([expect.stringContaining('mapping')]);
  });
});
