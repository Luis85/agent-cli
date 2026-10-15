import { describe, expect, it, vi } from 'vitest';
import { applyTextEdit, targetsStructure, type TextEditRequest } from '../../src/domain/documents/text-edit.ts';
import { ObsidianDocuments } from '../../src/infrastructure/documents/codec.ts';
import { ObsidianMetadataParser } from '../../src/infrastructure/metadata/parser.ts';

const note = '# Plan\n\nDraft ^d\n';
const parsed = (text: string) => new ObsidianMetadataParser(new ObsidianDocuments()).parse('note.md', new TextEncoder().encode(text));

describe('text edit requests', () => {
  it.each<[TextEditRequest, string, boolean]>([
    [{ kind: 'replace', find: 'Draft', replace: 'Final' }, '# Plan\n\nFinal ^d\n', false],
    [{ kind: 'literal', edits: [{ find: 'Draft', replace: 'Ready' }, { find: 'Plan', replace: 'Goal' }] }, '# Goal\n\nReady ^d\n', false],
    [{ kind: 'append', content: 'More.\n' }, '# Plan\n\nDraft ^d\nMore.\n', false],
    [{ kind: 'section', section: 'Plan', mode: 'replace', content: 'Body.' }, '# Plan\n\nBody.\n', true],
    [{ kind: 'section', section: 'Plan', line: 1, mode: 'append', content: 'More.' }, '# Plan\n\nDraft ^d\n\nMore.\n', true],
    [{ kind: 'block', block: 'd', mode: 'replace', content: 'Done.' }, '# Plan\n\nDone. ^d\n', true],
  ])('applies %j, reading the note structure only for sections and blocks', (request, expected, structural) => {
    const metadata = vi.fn(() => parsed(note));
    expect(applyTextEdit(note, request, metadata)).toBe(expected);
    expect(targetsStructure(request)).toBe(structural);
    expect(metadata).toHaveBeenCalledTimes(structural ? 1 : 0);
  });

  it('passes the section line through to pick one of several headings', () => {
    const twice = '# A\n\none\n\n# A\n\ntwo\n';
    expect(applyTextEdit(twice, { kind: 'section', section: 'A', line: 5, mode: 'replace', content: 'x' }, () => parsed(twice))).toBe('# A\n\none\n\n# A\n\nx\n');
  });
});
