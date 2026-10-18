import { describe, expect, it } from 'vitest';
import { canonicalPath, portablePathIssues } from '../../src/domain/documents/file.ts';

describe('portable generated paths', () => {
  it('accepts paths that every filesystem can write side by side', () => {
    expect(portablePathIssues(['button.vue', 'button.html', 'button.d.ts', 'nested/button.vue', 'console.ts', 'con-button.ts'])).toEqual([]);
  });

  it.each([
    ['con.vue', 'con.vue'], ['nested/AUX.d.ts', 'AUX.d.ts'], ['Com1 .ts', 'Com1 .ts'], ['lpt¹.html', 'lpt¹.html'], ['conout$/x.md', 'conout$'], ['nul./a', 'nul.'],
  ])('reports the Windows device-name segment of %s', (path, segment) => {
    expect(portablePathIssues([path])).toEqual([{ path, reason: 'device-name', segment }]);
  });

  it('reports a path naming an earlier one where letter case and trailing dots are ignored', () => {
    expect(portablePathIssues(['Button.vue', 'button.vue', 'Card/x.ts', 'card./x.ts', 'card/y.ts'])).toEqual([
      { path: 'button.vue', reason: 'case-duplicate', duplicateOf: 'Button.vue' },
      { path: 'card./x.ts', reason: 'case-duplicate', duplicateOf: 'Card/x.ts' },
    ]);
  });

  it('never compares a later path with one that already has a problem', () => {
    expect(portablePathIssues(['CON.ts', 'con.ts', 'a.md', 'A.md', 'a.MD'])).toEqual([
      { path: 'CON.ts', reason: 'device-name', segment: 'CON.ts' },
      { path: 'con.ts', reason: 'device-name', segment: 'con.ts' },
      { path: 'A.md', reason: 'case-duplicate', duplicateOf: 'a.md' },
      { path: 'a.MD', reason: 'case-duplicate', duplicateOf: 'a.md' },
    ]);
  });

  it('resolves each segment as case-insensitive filesystems and Windows do', () => {
    expect(canonicalPath('Docs./Read Me .MD')).toBe('docs/read me .md');
  });
});
