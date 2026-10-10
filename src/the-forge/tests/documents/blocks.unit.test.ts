import { describe, expect, it } from 'vitest';
import { editBlock } from '../../src/domain/documents/blocks.ts';
import type { RangeEditMode } from '../../src/domain/documents/sections.ts';
import { ObsidianDocuments } from '../../src/infrastructure/documents/codec.ts';
import { ObsidianMetadataParser } from '../../src/infrastructure/metadata/parser.ts';

const parser = new ObsidianMetadataParser(new ObsidianDocuments());
const metadata = (text: string) => parser.parse('note.md', new TextEncoder().encode(text));
const block = (text: string, id: string, mode: RangeEditMode, content: string) => editBlock(text, metadata(text), id, mode, content);
const failure = (edit: () => string) => {
  try { edit(); }
  catch (error) { return error as { code: string; exitCode: number; message: string; details?: Record<string, unknown> }; }
  throw new Error('Expected the edit to fail.');
};
/** The source text the metadata cache assigns to block `id`. */
const blockText = (text: string, id: string) => {
  const found = metadata(text).blocks?.[id];
  return found ? text.slice(found.position.start.offset, found.position.end.offset) : undefined;
};

describe('block edits by ^id', () => {
  const note = '# Tasks\n\nShip it soon. ^ship\n\n- one\n- two ^two\n\n| a |\n| - |\n| 1 |\n\n^table\n';

  it('replaces a paragraph and keeps its marker', () => {
    expect(block(note, 'ship', 'replace', 'Ship it now.\n')).toBe(note.replace('Ship it soon. ^ship', 'Ship it now. ^ship'));
    expect(block(note, '^SHIP', 'replace', 'Ship it now. ^ship')).toBe(note.replace('Ship it soon.', 'Ship it now.'));
  });

  it('separates content added next to a paragraph or a section with blank lines, after its marker line', () => {
    expect(block(note, 'ship', 'append', 'Later.')).toBe(note.replace('Ship it soon. ^ship\n', 'Ship it soon. ^ship\n\nLater.\n'));
    expect(block(note, 'ship', 'prepend', 'First.')).toBe(note.replace('Ship it soon.', 'First.\n\nShip it soon.'));
    expect(block(note, 'table', 'append', 'After.')).toBe(`${note}\nAfter.\n`);
    expect(block(note, 'table', 'replace', '| b |\n| - |')).toBe(note.replace('| a |\n| - |\n| 1 |', '| b |\n| - |'));
    expect(block('# H\nPara ^p\n- item', 'p', 'append', 'X')).toBe('# H\nPara ^p\n\nX\n\n- item');
    expect(block('# H\nPara ^p\n', 'p', 'prepend', 'X')).toBe('# H\n\nX\n\nPara ^p\n');
  });

  it('keeps a list item\'s marker, indentation and checkbox on replace, and its nested items attached', () => {
    expect(block(note, 'two', 'replace', 'deux')).toBe(note.replace('- two ^two', '- deux ^two'));
    expect(block('- [ ] task ^x\n', 'x', 'replace', 'NEW')).toBe('- [ ] NEW ^x\n');
    expect(block('- [ ] task ^x\n', 'x', 'replace', '- [x] task')).toBe('- [x] task ^x\n');
    expect(block('1. one ^o\n2. two\n', 'o', 'replace', 'uno')).toBe('1. uno ^o\n2. two\n');
    expect(block('- a\n  - [ ] nested ^nn\n    - child\n- b\n', 'nn', 'replace', 'first\nsecond')).toBe('- a\n  - [ ] first\n    second ^nn\n    - child\n- b\n');
    expect(block('- a ^pa\n  - child\n', 'pa', 'replace', 'A')).toBe('- A ^pa\n  - child\n');
  });

  it('adds sibling items next to a list item, after its nested items and at its indentation', () => {
    expect(block(note, 'two', 'prepend', '- one and a half')).toBe(note.replace('- two', '- one and a half\n- two'));
    expect(block('- a ^pa\n  - child\n- b\n', 'pa', 'append', '- probe\n  - sub')).toBe('- a ^pa\n  - child\n- probe\n  - sub\n- b\n');
    expect(block('- a\n  - nested ^nn\n    - deep\n- b\n', 'nn', 'append', '- probe')).toBe('- a\n  - nested ^nn\n    - deep\n  - probe\n- b\n');
    expect(block('- a\n  - nested ^nn', 'nn', 'prepend', '- [ ] probe')).toBe('- a\n  - [ ] probe\n  - nested ^nn');
    expect(block('> - quoted ^q\n', 'q', 'append', '- probe')).toBe('> - quoted ^q\n> - probe\n');
  });

  it('refuses content next to a list item that is not a list item, since it would join the item', () => {
    expect(failure(() => block(note, 'two', 'append', 'probe'))).toMatchObject({ code: 'INVALID_INPUT', exitCode: 2 });
    expect(failure(() => block(note, 'two', 'prepend', '  - probe'))).toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('refuses unknown and duplicate ids', () => {
    expect(failure(() => block(note, 'nope', 'append', 'x'))).toMatchObject({ code: 'SECTION_NOT_FOUND', details: { block: 'nope', blocks: ['ship', 'two', 'table'] } });
    expect(failure(() => block('One ^dup\n\nTwo ^dup\n', 'dup', 'append', 'x'))).toMatchObject({ code: 'AMBIGUOUS_SECTION', details: { block: 'dup', matches: 2 } });
  });

  it('writes every inserted line break with the file\'s CRLF line ending', () => {
    expect(block('Para ^p\r\n', 'p', 'append', 'a\nb')).toBe('Para ^p\r\n\r\na\r\nb\r\n');
    expect(block('- one ^li\r\n', 'li', 'replace', 'a\r\nb')).toBe('- a\r\n  b ^li\r\n');
    expect(block('- one ^li\r\n', 'li', 'append', '- a\n- b')).toBe('- one ^li\r\n- a\r\n- b\r\n');
  });
});

describe('the block id keeps resolving after every edit', () => {
  const fixtures: { name: string; text: string; id: string; item: boolean }[] = [
    { name: 'paragraph', text: 'Para ^p\n\nafter\n', id: 'p', item: false },
    { name: 'paragraph at the end without a line break', text: 'Para ^p', id: 'p', item: false },
    { name: 'list item', text: '- one ^li\n- two\n', id: 'li', item: true },
    { name: 'list item with nested items', text: '- a ^pa\n  - child\n- b\n', id: 'pa', item: true },
    { name: 'nested list item', text: '- a\n  - nested ^nn\n- b\n', id: 'nn', item: true },
    { name: 'task', text: '- [ ] task ^x\n- [x] done\n', id: 'x', item: true },
    { name: 'ordered item', text: '1. one ^o\n2. two\n', id: 'o', item: true },
    { name: 'table', text: '| a |\n| - |\n| 1 |\n\n^tbl\n', id: 'tbl', item: false },
    { name: 'own-line marker after a list', text: '- x\n- y\n\n^lst\n\nafter\n', id: 'lst', item: false },
  ];

  for (const fixture of fixtures) {
    for (const mode of ['append', 'prepend', 'replace'] as const) {
      it(`${mode} on a ${fixture.name}`, () => {
        const content = fixture.item && mode !== 'replace' ? '- probe' : 'probe text\nsecond line';
        const edited = block(fixture.text, fixture.id, mode, content);
        expect(blockText(edited, fixture.id), edited).toBeDefined();
        if (mode !== 'replace') expect(blockText(edited, fixture.id)).toBe(blockText(fixture.text, fixture.id));
        expect(blockText(block(edited, fixture.id, 'replace', 'again'), fixture.id)).toBeDefined();
        // Nested items stay attached to the item they belonged to.
        if (fixture.id === 'pa') expect(edited).toContain('pa\n  - child\n');
      });
    }
  }
});
