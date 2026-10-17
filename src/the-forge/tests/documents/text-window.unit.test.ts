import { describe, expect, it } from 'vitest';
import { lineRange, textWindow } from '../../src/domain/documents/text-window.ts';

describe('line ranges', () => {
  it('reads start-end, start- and start with 1-based inclusive numbers', () => {
    expect(lineRange('3-7')).toEqual({ start: 3, end: 7 });
    expect(lineRange('3-')).toEqual({ start: 3 });
    expect(lineRange('4')).toEqual({ start: 4, end: 4 });
    expect(lineRange('2-2')).toEqual({ start: 2, end: 2 });
  });

  it.each(['', '0-3', '5-4', '-3', 'a-b', '1-2-3', ' 1-2', '1..2', '99999999999999999999'])('refuses %j', text => {
    expect(() => lineRange(text)).toThrow(expect.objectContaining({ code: 'INVALID_ARGUMENT', message: expect.stringContaining('--lines must be start-end') }));
  });
});

describe('text windows', () => {
  const text = 'one\ntwo\r\nthree\rfour\nfive';

  it('returns whole text with its line count when it fits, keeping every line terminator', () => {
    expect(textWindow(text, 1000)).toEqual({ content: text, truncated: false, partial: false, bytes: 24, lines: { start: 1, end: 5, total: 5 } });
    expect(textWindow('a\nb\n', 1000).lines).toEqual({ start: 1, end: 2, total: 2 });
    expect(textWindow('', 1000)).toEqual({ content: '', truncated: false, partial: false, bytes: 0, lines: { start: 1, end: 0, total: 0 } });
  });

  it('selects line ranges and clamps an end past the last line', () => {
    expect(textWindow(text, 1000, { start: 2, end: 3 })).toMatchObject({ content: 'two\r\nthree\r', truncated: false, lines: { start: 2, end: 3, total: 5 } });
    expect(textWindow(text, 1000, { start: 4 })).toMatchObject({ content: 'four\nfive', lines: { start: 4, end: 5, total: 5 } });
    expect(textWindow(text, 1000, { start: 5, end: 99 })).toMatchObject({ content: 'five', lines: { start: 5, end: 5, total: 5 } });
    expect(() => textWindow(text, 1000, { start: 6 })).toThrow(expect.objectContaining({ code: 'INVALID_ARGUMENT', message: '--lines starts after the last line; the text has 5 lines.', details: { total: 5 } }));
    expect(() => textWindow('x', 1000, { start: 2 })).toThrow(expect.objectContaining({ message: '--lines starts after the last line; the text has 1 line.' }));
  });

  it('stops before the first whole line that exceeds the byte limit', () => {
    expect(textWindow(text, 9)).toEqual({ content: 'one\ntwo\r\n', truncated: true, partial: false, bytes: 9, lines: { start: 1, end: 2, total: 5 } });
    expect(textWindow(text, 8)).toMatchObject({ content: 'one\n', truncated: true, lines: { start: 1, end: 1, total: 5 } });
    expect(textWindow(text, 9, { start: 3 })).toMatchObject({ content: 'three\r', truncated: true, lines: { start: 3, end: 3, total: 5 } });
  });

  it('cuts a single line longer than the limit at a UTF-8 character boundary', () => {
    expect(textWindow('aé€😀b\nnext', 7)).toEqual({ content: 'aé€', truncated: true, partial: true, bytes: 6, lines: { start: 1, end: 1, total: 2 }, lineBytes: 12 });
    expect(textWindow('😀', 3)).toEqual({ content: '', truncated: true, partial: true, bytes: 0, lines: { start: 1, end: 1, total: 1 }, lineBytes: 4 });
    expect(textWindow('é'.repeat(10), 5).content).toBe('éé');
  });
});
