import { describe, expect, it } from 'vitest';
import { fileKind, isStructured } from '../src/domain/file.ts';

describe('file extension classification', () => {
  it.each(['md', 'canvas', 'base', 'png', 'pdf', 'WEBM', 'notes/md', 'notes.v1/md', 'notes.md/README'])('treats extensionless %s as an opaque attachment', path => {
    expect(fileKind(path)).toBe('attachment');
    expect(isStructured(path)).toBe(false);
  });

  it.each([
    ['note.MD', 'markdown'],
    ['notes.v1/plan.CANVAS', 'canvas'],
    ['.md', 'markdown'],
    ['notes/.md', 'markdown'],
    ['archive.tar.png', 'image'],
    ['notes.md/report.PDF', 'pdf'],
    ['movie.webm', 'audio'],
    ['note.md.', 'attachment'],
    ['note.md.backup', 'attachment'],
  ])('classifies %s by its final basename extension', (path, kind) => {
    expect(fileKind(path)).toBe(kind);
  });
});
