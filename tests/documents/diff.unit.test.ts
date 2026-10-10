import { describe, expect, it } from 'vitest';
import { unifiedDiff } from '../../src/the-forge/domain/documents/diff.ts';
import { applyUnifiedDiff } from '../support/unified-diff.ts';

const numbered = (count: number, label = 'line') => Array.from({ length: count }, (_, index) => `${label} ${index + 1}\n`).join('');

describe('unified dry-run diffs', () => {
  it('renders Git-style headers, hunk ranges and three context lines', () => {
    const before = numbered(10), after = before.replace('line 5\n', 'line five\n');
    expect(unifiedDiff({ path: 'notes/plan.md', before, after })).toBe([
      '--- a/notes/plan.md', '+++ b/notes/plan.md', '@@ -2,7 +2,7 @@',
      ' line 2', ' line 3', ' line 4', '-line 5', '+line five', ' line 6', ' line 7', ' line 8', '',
    ].join('\n'));
  });

  it('returns an empty diff for identical text', () => {
    expect(unifiedDiff({ path: 'same.md', before: 'a\nb\n', after: 'a\nb\n' })).toBe('');
  });

  it('describes creation from empty content against /dev/null', () => {
    expect(unifiedDiff({ path: 'x.ts', before: '', after: 'export const x = 1;\n', created: true })).toBe('--- /dev/null\n+++ b/x.ts\n@@ -0,0 +1 @@\n+export const x = 1;\n');
  });

  it('marks a missing final newline on either side', () => {
    const diff = unifiedDiff({ path: 'a.txt', before: 'one\ntwo', after: 'one\ntwo\n' });
    expect(diff).toBe('--- a/a.txt\n+++ b/a.txt\n@@ -1,2 +1,2 @@\n one\n-two\n\\ No newline at end of file\n+two\n');
    expect(applyUnifiedDiff('one\ntwo', diff)).toBe('one\ntwo\n');
  });

  it('keeps CRLF terminators and deletion-only ranges', () => {
    const before = 'a\r\nb\r\nc\r\n', after = 'a\r\nc\r\n';
    const diff = unifiedDiff({ path: 'w.md', before, after });
    expect(diff).toContain('-b\r\n');
    expect(applyUnifiedDiff(before, diff)).toBe(after);
    expect(unifiedDiff({ path: 'w.md', before: 'gone\n', after: '' })).toBe('--- a/w.md\n+++ b/w.md\n@@ -1 +0,0 @@\n-gone\n');
  });

  it('splits distant changes into separate hunks and merges nearby ones', () => {
    const before = numbered(30);
    const distant = unifiedDiff({ path: 'f.md', before, after: before.replace('line 2\n', 'two\n').replace('line 28\n', 'twenty-eight\n') });
    expect(distant.match(/^@@/gm)).toHaveLength(2);
    const nearby = unifiedDiff({ path: 'f.md', before, after: before.replace('line 10\n', 'ten\n').replace('line 16\n', 'sixteen\n') });
    expect(nearby.match(/^@@/gm)).toHaveLength(1);
  });

  it('applies back to the target text for deterministic random edits', () => {
    let seed = 7;
    const random = (limit: number) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % limit; };
    for (let round = 0; round < 300; round++) {
      const source = Array.from({ length: random(25) }, () => `v${random(6)}\n`);
      const target = source.flatMap(line => { const roll = random(5); return roll === 0 ? [] : roll === 1 ? [`n${random(6)}\n`, line] : roll === 2 ? [`c${random(3)}\n`] : [line]; });
      if (random(4) === 0 && target.length) target[target.length - 1] = target.at(-1)!.slice(0, -1);
      const before = source.join(''), after = target.join('');
      expect(applyUnifiedDiff(before, unifiedDiff({ path: 'r.txt', before, after }))).toBe(after);
    }
  });

  it('stays exact when the edit distance exceeds the minimal-search limit', () => {
    const before = numbered(2500, 'old'), after = numbered(2500, 'new');
    expect(applyUnifiedDiff(before, unifiedDiff({ path: 'large.txt', before, after }))).toBe(after);
  });
});
