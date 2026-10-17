import { describe, expect, it } from 'vitest';
import { aliasesName, reservedPathSegment, vaultPath } from '../../src/domain/documents/file.ts';

describe('portable vault paths', () => {
  it.each([
    '.GIT/config', 'repo/.GiT/HEAD', '.git./config', '.git /HEAD',
    '.AGENT-CLI.LOCK', '.agent-cli.lock. ', 'notes/.Agent-Cli-Tmp-write',
    'note\u007f.md',
  ])('rejects reserved aliases and control characters in %s', path => {
    expect(() => vaultPath(path)).toThrowError(expect.objectContaining({ code: 'INVALID_PATH' }));
  });

  it.each(['.github/workflows/check.yml', '.gitignore', 'notes/Git.md', 'notes/Überblick.md', 'notes/draft~1.md', 'GITHUB~1/x', 'agent~1.md', 'notes/a\u200bb.md'])('preserves ordinary path %s', path => {
    expect(vaultPath(path)).toBe(path);
  });

  it.each(['GIT~1/config', 'git~1', 'repo/Git~12/hooks/pre-commit', 'GIT~1./HEAD', 'AGENT-~1.LOC', 'notes/agent-~3'])('rejects Windows 8.3 short-name alias %s of a reserved name', path => {
    expect(() => vaultPath(path)).toThrowError(expect.objectContaining({ code: 'INVALID_PATH', message: 'Reserved workspace path.' }));
  });

  it.each(['.g\u200cit/config', '\u200b.git/HEAD', '.gi\u200ft', '.git\ufeff/x', '.\u2060git', '.g\u202eit', '.agent\u2063-cli.lock'])('rejects HFS+ ignorable code points in reserved name %s', path => {
    expect(() => vaultPath(path)).toThrowError(expect.objectContaining({ code: 'INVALID_PATH' }));
  });

  it.each(['.\u200b./x', 'a/\u200b/b', 'a/ /b', 'a/.../b', 'a/. /b'])('rejects segment %s that is empty, . or .. on some filesystem', path => {
    expect(() => vaultPath(path)).toThrowError(expect.objectContaining({ code: 'INVALID_PATH' }));
  });

  it('classifies aliases by the name they reach and compares protected roots the same way', () => {
    expect(['GIT~1', '.G\u200dit', '.git. '].map(reservedPathSegment)).toEqual(['git', 'git', 'git']);
    expect(['AGENT-~2.LOC', '.agent-cli-tmp-x', '.Agent-Cli.Lock '].map(reservedPathSegment)).toEqual(['internal', 'internal', 'internal']);
    expect(['GITIGN~1', 'GIT~', 'GIT~X', '~1', 'git~1x'].map(reservedPathSegment)).toEqual([undefined, undefined, undefined, undefined, undefined]);
    expect(['OBSIDI~1', 'obsidi~2.x', '.Obsidian.', '.obs\u200bidian'].every(name => aliasesName(name, '.obsidian'))).toBe(true);
    expect(['FORGE~1', 'bin~1', 'BIN'].map((name, index) => aliasesName(name, ['.forge', 'bin', 'bin'][index]!))).toEqual([true, true, true]);
    expect(['OBSIDIAN', 'OBSID~1', 'FORGE', 'binary'].map((name, index) => aliasesName(name, ['.obsidian', '.obsidian', '.forge', 'bin'][index]!))).toEqual([false, false, false, false]);
  });
});
