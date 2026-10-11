import { describe, expect, it } from 'vitest';
import { applyLiteralEdits, literalMatches, replaceUniqueLiteral, reportedMatchLines } from '../../src/domain/documents/literal-edit.ts';

describe('ordered multi-edits', () => {
  const failed = (text: string, edits: Parameters<typeof applyLiteralEdits>[1]) => {
    try { applyLiteralEdits(text, edits); }
    catch (error) { return error as { code: string; message: string; details?: Record<string, unknown> }; }
    throw new Error('Expected the edits to fail.');
  };

  it('applies each edit to the result of the previous one', () => {
    expect(applyLiteralEdits('status: draft\nowner: ana\n', [{ find: 'draft', replace: 'ready' }, { find: 'ready\nowner: ana', replace: 'ready\nowner: bo' }])).toBe('status: ready\nowner: bo\n');
  });

  it('replaces every non-overlapping occurrence with all, which still needs one match', () => {
    expect(applyLiteralEdits('aaaa todo todo', [{ find: 'todo', replace: 'done', all: true }, { find: 'aa', replace: 'b', all: true }])).toBe('bb done done');
    expect(failed('text', [{ find: 'z', replace: 'y', all: true }])).toMatchObject({ code: 'NO_MATCH', details: { edit: 0, matches: 0 } });
  });

  it('names the failing edit by its index and keeps the single-edit details', () => {
    const error = failed('one two two', [{ find: 'one', replace: '1' }, { find: 'two', replace: '2' }]);
    expect(error).toMatchObject({ code: 'AMBIGUOUS_EDIT', details: { edit: 1, matches: 2, lines: [1, 1] } });
    expect(error.message).toMatch(/^Edit 1: /);
    expect(failed('abc', [{ find: 'a', replace: 'x' }, { find: 'a', replace: 'y' }])).toMatchObject({ code: 'NO_MATCH', details: { edit: 1, find: 'a' } });
    expect(failed('abc', [])).toMatchObject({ code: 'INVALID_INPUT' });
  });
});

const failure = (text: string, find: string) => {
  try { replaceUniqueLiteral(text, find, 'x'); }
  catch (error) { return error as { code: string; exitCode: number; details?: Record<string, unknown> }; }
  throw new Error('Expected the edit to fail.');
};

describe('literal find/replace outcomes', () => {
  it('replaces the single match literally, without replacement patterns', () => {
    expect(replaceUniqueLiteral('A banana.', 'banana', '$& fruit')).toBe('A $& fruit.');
  });

  it('reports a missing find text as NO_MATCH with the searched text', () => {
    expect(failure('# Plan\nDraft\n', 'Final')).toMatchObject({ code: 'NO_MATCH', exitCode: 2, details: { find: 'Final', matches: 0 } });
    expect(failure('First line\r\nSecond line', 'First line\nSecond line')).toMatchObject({ code: 'NO_MATCH' });
  });

  it('reports several matches as AMBIGUOUS_EDIT with the 1-based line of each match start', () => {
    expect(failure('banana', 'ana')).toMatchObject({ code: 'AMBIGUOUS_EDIT', exitCode: 2, details: { matches: 2, lines: [1, 1] } });
    expect(failure('one\r\ntodo\nthree\n\ntodo todo', 'todo')).toMatchObject({ details: { matches: 3, lines: [2, 5, 5] } });
    // A match starting with a line feed starts on the line that the line feed ends.
    expect(failure('a\nb\na\nb\na', '\na')).toMatchObject({ details: { matches: 2, lines: [2, 4] } });
    expect(failure('x\nx\n', 'x\n')).toMatchObject({ details: { matches: 2, lines: [1, 2] } });
  });

  it('caps reported lines while counting every match', () => {
    const text = Array.from({ length: 30 }, () => 'item').join('\n');
    const error = failure(text, 'item');
    expect(error.details).toEqual({ matches: 30, lines: Array.from({ length: reportedMatchLines }, (_, index) => index + 1) });
  });

  it('rejects an empty find text as invalid input', () => {
    expect(failure('text', '')).toMatchObject({ code: 'INVALID_INPUT', exitCode: 2 });
    expect(literalMatches('aaa', '')).toEqual([]);
    expect(literalMatches('aaaa', 'aa')).toEqual([0, 1, 2]);
  });
});
