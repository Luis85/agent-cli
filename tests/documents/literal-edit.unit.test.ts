import { describe, expect, it } from 'vitest';
import { literalMatches, replaceUniqueLiteral, reportedMatchLines } from '../../src/the-forge/domain/documents/literal-edit.ts';

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
