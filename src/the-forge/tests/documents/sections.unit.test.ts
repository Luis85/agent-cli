import { describe, expect, it } from 'vitest';
import { editBlock, editSection, type RangeEditMode } from '../../src/domain/documents/sections.ts';
import { ObsidianDocuments } from '../../src/infrastructure/documents/codec.ts';
import { ObsidianMetadataParser } from '../../src/infrastructure/metadata/parser.ts';

const parser = new ObsidianMetadataParser(new ObsidianDocuments());
const metadata = (text: string) => parser.parse('note.md', new TextEncoder().encode(text));
const section = (text: string, path: string, mode: RangeEditMode, content: string) => editSection(text, metadata(text), path, mode, content);
const block = (text: string, id: string, mode: RangeEditMode, content: string) => editBlock(text, metadata(text), id, mode, content);
const failure = (edit: () => string) => {
  try { edit(); }
  catch (error) { return error as { code: string; exitCode: number; details?: Record<string, unknown> }; }
  throw new Error('Expected the edit to fail.');
};

const plan = [
  '---', 'status: draft', '---', '# Plan', '', 'Intro.', '', '## Risks', '', '- Scope creep', '- Staffing', '', '### Mitigations', '', 'Hire early.', '',
  '## Goals', '', 'Ship v1.', '', '# Notes', '', '## Risks', '', 'Unrelated.', '',
].join('\n');

describe('section edits by heading path', () => {
  it('replaces a section body up to the next heading of the same or higher level, keeping the heading and blank lines', () => {
    expect(section(plan, 'Plan > Risks', 'replace', '- Budget')).toBe(plan.replace('- Scope creep\n- Staffing\n\n### Mitigations\n\nHire early.\n', '- Budget\n'));
  });

  it('appends after the last content line and prepends after the heading', () => {
    expect(section(plan, 'Plan > Risks', 'append', '- Budget\n')).toBe(plan.replace('Hire early.\n', 'Hire early.\n- Budget\n'));
    expect(section(plan, 'Plan > Risks', 'prepend', '- Budget')).toBe(plan.replace('## Risks\n\n- Scope creep', '## Risks\n\n- Budget\n- Scope creep'));
    expect(section(plan, 'Goals', 'append', 'Ship v2.')).toBe(plan.replace('Ship v1.\n', 'Ship v1.\nShip v2.\n'));
  });

  it('matches ancestors in order, not necessarily direct parents, and falls back to letter case only without an exact match', () => {
    expect(section(plan, 'Plan > Mitigations', 'replace', 'Train.')).toBe(plan.replace('Hire early.', 'Train.'));
    expect(section(plan, 'plan > risks > mitigations', 'replace', 'Train.')).toBe(plan.replace('Hire early.', 'Train.'));
    expect(failure(() => section(plan, 'Notes > Mitigations', 'replace', 'x'))).toMatchObject({ code: 'SECTION_NOT_FOUND', exitCode: 2 });
  });

  it('reports a missing heading with the available paths and an ambiguous one with its candidates', () => {
    const missing = failure(() => section(plan, 'Budget', 'append', 'x'));
    expect(missing).toMatchObject({ code: 'SECTION_NOT_FOUND', details: { section: 'Budget' } });
    expect((missing.details!.headings as unknown[]).slice(0, 2)).toEqual([{ section: 'Plan', line: 4 }, { section: 'Plan > Risks', line: 8 }]);
    expect(failure(() => section(plan, 'Risks', 'append', 'x'))).toMatchObject({
      code: 'AMBIGUOUS_SECTION', exitCode: 2, details: { matches: 2, candidates: [{ section: 'Plan > Risks', line: 8 }, { section: 'Notes > Risks', line: 23 }] },
    });
    expect(failure(() => section(plan, 'Plan >  > Risks', 'append', 'x'))).toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('keeps CRLF line endings, edits a section at the end of a file without a final newline and ignores headings in code', () => {
    expect(section('# A\r\n\r\ntext\r\n', 'A', 'append', 'more')).toBe('# A\r\n\r\ntext\r\nmore\r\n');
    expect(section('# A\n\ntext', 'A', 'append', 'more')).toBe('# A\n\ntext\nmore\n');
    expect(section('# A', 'A', 'replace', 'body')).toBe('# A\nbody\n');
    expect(section('# A\n```\n# not a heading\n```\n# B\n', 'A', 'replace', 'x')).toBe('# A\nx\n# B\n');
  });
});

describe('block edits by ^id', () => {
  const note = '# Tasks\n\nShip it soon. ^ship\n\n- one\n- two ^two\n\n| a |\n| - |\n| 1 |\n\n^table\n';

  it('replaces a paragraph and keeps its marker', () => {
    expect(block(note, 'ship', 'replace', 'Ship it now.\n')).toBe(note.replace('Ship it soon. ^ship', 'Ship it now. ^ship'));
    expect(block(note, '^SHIP', 'replace', 'Ship it now. ^ship')).toBe(note.replace('Ship it soon.', 'Ship it now.'));
  });

  it('edits list items and sections named by a marker line', () => {
    expect(block(note, 'two', 'replace', '- deux')).toBe(note.replace('- two ^two', '- deux ^two'));
    expect(block(note, 'two', 'prepend', '- one and a half')).toBe(note.replace('- two', '- one and a half\n- two'));
    expect(block(note, 'table', 'append', 'After.')).toBe(`${note}After.\n`);
    expect(block(note, 'table', 'replace', '| b |\n| - |')).toBe(note.replace('| a |\n| - |\n| 1 |', '| b |\n| - |'));
  });

  it('refuses unknown and duplicate ids', () => {
    expect(failure(() => block(note, 'nope', 'append', 'x'))).toMatchObject({ code: 'SECTION_NOT_FOUND', details: { block: 'nope', blocks: ['ship', 'two', 'table'] } });
    expect(failure(() => block('One ^dup\n\nTwo ^dup\n', 'dup', 'append', 'x'))).toMatchObject({ code: 'AMBIGUOUS_SECTION', details: { block: 'dup', matches: 2 } });
  });
});
