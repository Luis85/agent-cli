import { describe, expect, it } from 'vitest';
import { editSection, type RangeEditMode } from '../../src/domain/documents/sections.ts';
import { ObsidianDocuments } from '../../src/infrastructure/documents/codec.ts';
import { ObsidianMetadataParser } from '../../src/infrastructure/metadata/parser.ts';

const parser = new ObsidianMetadataParser(new ObsidianDocuments());
const metadata = (text: string) => parser.parse('note.md', new TextEncoder().encode(text));
const section = (text: string, path: string, mode: RangeEditMode, content: string, line?: number) => editSection(text, metadata(text), path, mode, content, line);
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
    expect(section('# A\r\n\r\ntext\r\n', 'A', 'append', 'one\ntwo\r\nthree\n')).toBe('# A\r\n\r\ntext\r\none\r\ntwo\r\nthree\r\n');
    expect(section('# A\r\n\r\ntext\r\n', 'A', 'replace', 'one\ntwo')).toBe('# A\r\n\r\none\r\ntwo\r\n');
    expect(section('# A\n\ntext\n', 'A', 'prepend', 'one\r\ntwo')).toBe('# A\n\none\ntwo\ntext\n');
    expect(section('# A\n\ntext', 'A', 'append', 'more')).toBe('# A\n\ntext\nmore\n');
    expect(section('# A', 'A', 'replace', 'body')).toBe('# A\nbody\n');
    expect(section('# A\n```\n# not a heading\n```\n# B\n', 'A', 'replace', 'x')).toBe('# A\nx\n# B\n');
  });
});

describe('unaddressable sections', () => {
  const twice = '# A\n\n## B\n\nfirst\n\n# A\n\n## B\n\nsecond\n';

  it('picks one of several headings with the same full path by its 1-based line', () => {
    const ambiguous = failure(() => section(twice, 'A > B', 'replace', 'x'));
    expect(ambiguous).toMatchObject({ code: 'AMBIGUOUS_SECTION', details: { candidates: [{ section: 'A > B', line: 3 }, { section: 'A > B', line: 9 }] } });
    expect((ambiguous as unknown as Error).message).toContain('section line');
    expect((ambiguous as unknown as Error).message).not.toContain('add an ancestor heading');
    expect(section(twice, 'A > B', 'replace', 'x', 9)).toBe(twice.replace('second', 'x'));
    expect(section(twice, 'B', 'replace', 'x', 3)).toBe(twice.replace('first', 'x'));
    expect(failure(() => section(twice, 'A > B', 'replace', 'x', 4))).toMatchObject({
      code: 'SECTION_NOT_FOUND', details: { section: 'A > B', line: 4, headings: [{ section: 'A > B', line: 3 }, { section: 'A > B', line: 9 }] },
    });
  });

  it('addresses a heading that contains " > " through the \\> escape, and reports it escaped', () => {
    const note = '# In > Out\n\nold\n\n## Step > Next\n\nstep\n';
    expect(section(note, 'In \\> Out', 'replace', 'new')).toBe(note.replace('old\n\n## Step > Next\n\nstep', 'new'));
    expect(section(note, 'In \\> Out > Step \\> Next', 'replace', 'x')).toBe(note.replace('step', 'x'));
    expect(failure(() => section(note, 'Missing', 'append', 'x')).details!.headings).toEqual([{ section: 'In \\> Out', line: 1 }, { section: 'In \\> Out > Step \\> Next', line: 5 }]);
    expect(section('# a -> b\n\nx\n', 'a -> b', 'replace', 'y')).toBe('# a -> b\n\ny\n');
  });
});
