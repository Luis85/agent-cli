import { describe, expect, it } from 'vitest';
import { pathFilter, recordingFilter } from '../../src/domain/documents/path-glob.ts';

const paths = ['notes', 'notes.md', 'notes/a.md', 'notes/deep/b.md', 'notesx/c.md', 'Notes/d.md', 'other/notes/e.md'];
const selected = (pattern: string, option?: string) => paths.filter(pathFilter(pattern, option));

describe('command path filters', () => {
  it('selects a file or everything below a folder for a value without glob characters', () => {
    for (const pattern of ['notes', 'notes/', './notes', 'notes//']) expect(selected(pattern), pattern).toEqual(['notes', 'notes/a.md', 'notes/deep/b.md']);
    expect(selected('notes/deep')).toEqual(['notes/deep/b.md']);
    expect(selected('notes.md')).toEqual(['notes.md']);
    expect(selected('note')).toEqual([]);
    for (const pattern of ['.', './']) expect(selected(pattern), pattern).toEqual(paths);
  });

  it('keeps glob semantics once the value has glob syntax', () => {
    expect(selected('notes/*')).toEqual(['notes/a.md']);
    expect(selected('notes/**')).toEqual(['notes/a.md', 'notes/deep/b.md']);
    expect(selected('{notes,Notes}/*.md')).toEqual(['notes/a.md', 'Notes/d.md']);
    expect(selected('notes\\.md')).toEqual(['notes.md']);
  });

  it('refuses an empty or overlong value, naming the option', () => {
    expect(() => pathFilter('', '--exclude')).toThrow(expect.objectContaining({ code: 'INVALID_ARGUMENT', message: '--exclude must be a glob of 1 to 1024 characters.' }));
    expect(() => pathFilter('x'.repeat(1025))).toThrow(expect.objectContaining({ code: 'INVALID_ARGUMENT', message: '--path must be a glob of 1 to 1024 characters.' }));
    expect(pathFilter('x'.repeat(1024))('x'.repeat(1024))).toBe(true);
  });

  it('records whether a filter matched any path', () => {
    const filter = recordingFilter(pathFilter('notes'));
    expect(filter.matched()).toBe(false);
    expect(['other/x.md', 'Notes/d.md'].filter(filter.matches)).toEqual([]);
    expect(filter.matched()).toBe(false);
    expect(['notes/a.md', 'other/x.md'].filter(filter.matches)).toEqual(['notes/a.md']);
    expect(filter.matched()).toBe(true);
  });
});
