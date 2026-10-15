import { describe, expect, it } from 'vitest';
import { editSection, lineStart, nextLine, type RangeEditMode } from '../../src/domain/documents/sections.ts';
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

  it('separates appended lines from a last block that ends in its ^id, so the block keeps its id', () => {
    const note = '# A\n\nPara ^p\n\n# B\n';
    const edited = section(note, 'A', 'append', 'More.');
    expect(edited).toBe('# A\n\nPara ^p\n\nMore.\n\n# B\n');
    expect(metadata(edited).blocks).toHaveProperty('p');
    expect(section('# A\r\n\r\n- item ^li', 'A', 'append', '- next')).toBe('# A\r\n\r\n- item ^li\r\n\r\n- next\r\n');
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

describe('section path matching', () => {
  it('needs each ancestor segment in order before the heading, never the heading itself', () => {
    expect(failure(() => section('# A\n\nx\n', 'A > A', 'replace', 'y'))).toMatchObject({ code: 'SECTION_NOT_FOUND' });
    // `A > B` names both `## B` and `### B` under `# A`; an ancestor `B` never stands for a later segment.
    expect(failure(() => section('# A\n## B\n### B\n', 'A > B', 'replace', 'x'))).toMatchObject({
      code: 'AMBIGUOUS_SECTION', details: { matches: 2, candidates: [{ section: 'A > B', line: 2 }, { section: 'A > B > B', line: 3 }] },
    });
  });

  it('prefers an exact heading over headings that differ only in letter case', () => {
    const note = '# Plan\n\nx\n\n# plan\n\ny\n';
    expect(section(note, 'Plan', 'replace', 'z')).toBe('# Plan\n\nz\n\n# plan\n\ny\n');
    expect(failure(() => section(note, 'PLAN', 'replace', 'z'))).toMatchObject({ code: 'AMBIGUOUS_SECTION', details: { matches: 2 } });
  });

  it('trims the spaces around each path segment', () => {
    expect(section(plan, ' Plan >  Mitigations ', 'replace', 'Train.')).toBe(plan.replace('Hire early.', 'Train.'));
  });

  it('does not depend on the order in which the metadata lists headings', () => {
    const parsed = metadata(plan);
    const reversed = { ...parsed, headings: [...parsed.headings!].reverse() };
    expect(editSection(plan, reversed, 'Plan > Risks', 'replace', '- Budget')).toBe(section(plan, 'Plan > Risks', 'replace', '- Budget'));
    expect(failure(() => editSection('text\n', {}, 'A', 'append', 'x'))).toMatchObject({ code: 'SECTION_NOT_FOUND', details: { section: 'A', headings: [] } });
  });
});

describe('section edit failures', () => {
  const message = (edit: () => string) => (failure(edit) as unknown as Error).message;

  it('explains each failure with the path, the line and a way to tell candidates apart', () => {
    expect(message(() => section(plan, 'Budget', 'append', 'x'))).toBe('No heading matches the section path "Budget".');
    expect(message(() => section(plan, 'Risks', 'append', 'x', 4))).toBe('No heading matching the section path "Risks" starts on line 4.');
    expect(message(() => section(plan, 'Risks', 'append', 'x'))).toContain('matches 2 headings; add an ancestor heading, such as "Parent > Risks", or pass one candidate\'s line');
    expect(message(() => section(plan, 'Plan >  > Risks', 'append', 'x'))).toContain('write a " > " inside a heading as " \\> "');
  });

  it('lists at most 50 headings or candidates while counting every match', () => {
    const many = Array.from({ length: 51 }, (_, index) => `# Same\n\nbody ${index}\n`).join('\n');
    const ambiguous = failure(() => section(many, 'Same', 'append', 'x'));
    expect(ambiguous.details).toMatchObject({ matches: 51 });
    expect(ambiguous.details!.candidates).toHaveLength(50);
    expect(failure(() => section(many, 'Other', 'append', 'x')).details!.headings).toHaveLength(50);
    expect(failure(() => section(many, 'Same', 'append', 'x', 2)).details!.headings).toHaveLength(50);
  });
});

describe('section body boundaries', () => {
  it('writes inserted lines with the line ending of the first line break', () => {
    expect(section('# A\n\ntext\r\n', 'A', 'append', 'x\ny')).toBe('# A\n\ntext\r\nx\ny\n');
  });

  it('removes the content for empty replacement text and prepends after every blank line below the heading', () => {
    expect(section('# A\n\ntext\n\n# B\n', 'A', 'replace', '')).toBe('# A\n\n\n# B\n');
    expect(section('# A\n\n\ntext\n', 'A', 'prepend', 'x')).toBe('# A\n\n\nx\ntext\n');
  });

  it('separates appended lines only from a last line that ends in a block id', () => {
    expect(section('# A\n\n| a |\n| - |\n\n^tbl\n# B\n', 'A', 'append', 'x')).toBe('# A\n\n| a |\n| - |\n\n^tbl\n\nx\n# B\n');
    expect(section('# A\n\nSee ^ref here\n# B\n', 'A', 'append', 'x')).toBe('# A\n\nSee ^ref here\nx\n# B\n');
    expect(section('# A\n\nWow ^p!\n# B\n', 'A', 'append', 'x')).toBe('# A\n\nWow ^p!\nx\n# B\n');
  });
});

describe('line helpers', () => {
  it('finds the start of a line and the start of the next one', () => {
    expect(nextLine('\nabc', 0)).toBe(1);
    expect(nextLine('ab\ncd', 1)).toBe(3);
    expect(nextLine('ab', 1)).toBe(2);
    expect(lineStart('ab\ncd', 4)).toBe(3);
    expect(lineStart('ab\ncd', 1)).toBe(0);
  });
});
