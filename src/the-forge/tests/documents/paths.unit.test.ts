import { describe, expect, it } from 'vitest';
import { vaultPath } from '../../src/domain/documents/file.ts';

describe('portable vault paths', () => {
  it.each([
    '.GIT/config', 'repo/.GiT/HEAD', '.git./config', '.git /HEAD',
    '.AGENT-CLI.LOCK', '.agent-cli.lock. ', 'notes/.Agent-Cli-Tmp-write',
    'note\u007f.md',
  ])('rejects reserved aliases and control characters in %s', path => {
    expect(() => vaultPath(path)).toThrowError(expect.objectContaining({ code: 'INVALID_PATH' }));
  });

  it.each(['.github/workflows/check.yml', '.gitignore', 'notes/Git.md', 'notes/Überblick.md'])('preserves ordinary path %s', path => {
    expect(vaultPath(path)).toBe(path);
  });
});
