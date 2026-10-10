import { describe, expect, it } from 'vitest';
import { editFrontmatter } from '../../src/plugins/backlog/infrastructure/frontmatter.ts';
import { stringifyYaml } from '../../src/plugins/backlog/infrastructure/yaml.ts';

const note = [
  '---', 'type: Bug', '# lead comment', 'title: Old # trailing comment', 'priority: ""',
  'source: "Found while fixing the same defect on the dependency connector — Codex review on', '  PR #114 raised the connector"',
  'files:', '  - a.ts', '  - b.ts', 'status: Open', '---', '', '# Body [[Link]]', '',
].join('\n');

describe('frontmatter edits', () => {
  it('rewrites only the changed entries in Obsidian style and keeps every other byte', () => {
    const after = editFrontmatter(note, {}, { priority: 'P1', files: ['a.ts'], parent: '[[Epic]]' }, ['status']);
    expect(after).toBe([
      '---', 'type: Bug', '# lead comment', 'title: Old # trailing comment', 'priority: P1',
      'source: "Found while fixing the same defect on the dependency connector — Codex review on', '  PR #114 raised the connector"',
      'files:', '  - a.ts', 'parent: "[[Epic]]"', '---', '', '# Body [[Link]]', '',
    ].join('\n'));
  });

  it('keeps CRLF and a byte order mark, adds a block to a note without one and rewrites flow blocks whole', () => {
    expect(editFrontmatter('﻿---\r\na: 1\r\nb: 2\r\n---\r\nBody\r\n', {}, { b: [3] }, [])).toBe('﻿---\r\na: 1\r\nb:\r\n  - 3\r\n---\r\nBody\r\n');
    expect(editFrontmatter('Body only\n', { status: 'Open' }, { status: 'Open' }, [])).toBe('---\nstatus: Open\n---\nBody only\n');
    expect(editFrontmatter('---\n---\nBody\n', { status: '' }, { status: '' }, [])).toBe('---\nstatus: ""\n---\nBody\n');
    expect(editFrontmatter('---\n{a: 1}\n---\n', { a: 1, b: 'x' }, { b: 'x' }, [])).toBe('---\na: 1\nb: x\n---\n');
  });

  it('serializes new notes like stringifyYaml', () => {
    expect(stringifyYaml({ 'pbl-id': 3, type: 'PBI', parent: '[[Route sharing]]', order: 1500.5, goal: '', tags: ['a', 'b'], due: '2026-10-01', id: '12' }))
      .toBe('pbl-id: 3\ntype: PBI\nparent: "[[Route sharing]]"\norder: 1500.5\ngoal: ""\ntags:\n  - a\n  - b\ndue: 2026-10-01\nid: "12"\n');
  });
});
