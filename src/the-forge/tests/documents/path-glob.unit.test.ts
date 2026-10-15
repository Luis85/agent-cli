import { describe, expect, it } from 'vitest';
import { pathGlob } from '../../src/domain/documents/path-glob.ts';

/**
 * Reference semantics as a regular expression over the whole path: `*` and `?` stay within a segment, a `**`
 * segment followed by more segments matches zero or more whole segments, and a trailing one matches one or more.
 */
function reference(pattern: string): RegExp {
  const segments = pattern.split('/');
  const source = segments.map((segment, index) => {
    const last = index === segments.length - 1;
    if (/^\*{2,}$/.test(segment)) return last ? '[^/]*(?:/[^/]*)*' : '(?:[^/]*/)*';
    const atoms = [...segment].map(char => (char === '*' ? '[^/]*' : char === '?' ? '[^/]' : char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))).join('');
    return last ? atoms : `${atoms}/`;
  }).join('');
  return new RegExp(`^${source}$`, 'u');
}

/** Deterministic pseudo-random choices, so a failure always reproduces. */
function choices(seed: number) {
  return (options: readonly string[]) => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return options[seed % options.length]!;
  };
}

describe('path glob matching against reference semantics', () => {
  it('agrees with the reference on generated globs and paths, including empty segments and globstars', () => {
    const pick = choices(11);
    const segment = (parts: readonly string[], length: number) => Array.from({ length }, () => pick(parts)).join('');
    for (let round = 0; round < 400; round++) {
      const pattern = Array.from({ length: 1 + Number(pick(['0', '1', '2', '3'])) }, () => (pick(['g', 's', 's', 's']) === 'g' ? '**' : segment(['a', 'b', '*', '?'], Number(pick(['1', '1', '2', '3']))))).join('/');
      for (let sample = 0; sample < 12; sample++) {
        const path = Array.from({ length: 1 + Number(pick(['0', '1', '2', '3', '4'])) }, () => segment(['a', 'b'], Number(pick(['0', '1', '1', '2', '3'])))).join('/');
        expect(pathGlob(pattern)(path), `${pattern} against ${path}`).toBe(reference(pattern).test(path));
      }
    }
  });

  it.each([
    ['notes', 'notes/a.md', false],
    ['notes/*', 'notes/deep/b.md', false],
    ['notes/**/a.md', 'notes/a.md', true],
    ['**/a.md', 'a.md', true],
    ['README*', 'README', true],
    ['*.md*', 'a.md', true],
    ['a//b', 'a/x/b', false],
    ['a//b', 'a//b', true],
    ['***/b.md', 'notes/deep/b.md', true],
    ['**a/b.md', 'notes/deep/b.md', false],
  ])('%s against %s is %s', (pattern, path, expected) => {
    expect(pathGlob(pattern)(path)).toBe(expected);
  });
});

describe('path glob syntax', () => {
  it.each([
    ['[!a]', '!', true],
    ['[!a]', 'a', false],
    ['[^a]', '^', true],
    ['[axz]', 'm', false],
    ['[axz]', 'z', true],
    ['[a-]', '-', true],
    ['[a-]', 'a', true],
    ['[a-a]', 'a', true],
    ['[a-cx-z]', 'y', true],
    ['[a-cx-z]', 'm', false],
    ['[!a-c]', 'd', true],
    ['[!a-c]', 'b', false],
    ['a\\*', 'a*', true],
    ['a\\*', 'ab', false],
    ['x{,y}', 'x', true],
    ['x{,y}', 'xy', true],
    ['a./b', 'a./b', true],
    ['a./b', 'ab', false],
  ])('%s against %s is %s', (pattern, path, expected) => {
    expect(pathGlob(pattern)(path)).toBe(expected);
  });

  it('accepts globs up to 1024 characters and 256 expansions, in one brace or across several', () => {
    expect(pathGlob('x'.repeat(1024))('x'.repeat(1024))).toBe(true);
    expect(pathGlob('{a,b}'.repeat(8))('abababab')).toBe(true);
    const group = (count: number) => `{${Array.from({ length: count }, (_, index) => index).join(',')}}`;
    expect(pathGlob(group(256))('255')).toBe(true);
    expect(() => pathGlob(group(257))).toThrow(expect.objectContaining({ code: 'INVALID_ARGUMENT', message: '--path expands to more than 256 alternatives.' }));
  });

  it.each([
    ['', '--path must be a glob of 1 to 1024 characters.'],
    ['{a,b', '--path has an unclosed {.'],
    ['trailing\\', '--path ends with an unescaped backslash.'],
    ['[z-a].md', '--path has the reversed class range [z-a].'],
    ['{a,b}'.repeat(9), '--path expands to more than 256 alternatives.'],
  ])('explains why the glob %j is malformed, naming the default option', (pattern, message) => {
    expect(() => pathGlob(pattern)).toThrow(expect.objectContaining({ code: 'INVALID_ARGUMENT', message }));
  });

  it('names the option it was given', () => {
    expect(() => pathGlob('{', '--exclude')).toThrow(expect.objectContaining({ message: '--exclude has an unclosed {.' }));
  });
});
