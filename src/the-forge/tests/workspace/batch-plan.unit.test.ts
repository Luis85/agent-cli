import { describe, expect, it } from 'vitest';
import { Transaction, type BatchHost } from '../../src/infrastructure/workspace/batch.ts';
import type { FileBatch } from '../../src/application/workspace/ports.ts';

// Planning validates in the constructor and touches no filesystem.
const plan = (batch: FileBatch) => new Transaction({} as BatchHost, batch);
const bytes = new Uint8Array();

describe('batch plan validation', () => {
  it('refuses overlapping steps and allows writes at or inside rename destinations', () => {
    expect(() => plan({ renames: [{ from: 'docs', to: 'guides', expectedRevision: 'r' }], writes: [{ path: 'guides/a.md', bytes }, { path: 'guides', bytes }] })).toThrow(expect.objectContaining({ code: 'INVALID_PLAN' }));
    expect(() => plan({ renames: [{ from: 'a.md', to: 'b.md', expectedRevision: 'r' }], writes: [{ path: 'b.md', bytes }] })).not.toThrow();
    expect(() => plan({ renames: [{ from: 'docs', to: 'guides', expectedRevision: 'r' }], writes: [{ path: 'guides/sub/a.md', bytes }] })).not.toThrow();
    for (const batch of [
      { renames: [{ from: 'docs', to: 'guides', expectedRevision: 'r' }], writes: [{ path: 'docs/a.md', bytes }] },
      { renames: [{ from: 'docs/a.md', to: 'x.md', expectedRevision: 'r' }], removes: [{ path: 'docs', expectedRevision: 'r' }] },
      { renames: [{ from: 'a.md', to: 'guides/a.md', expectedRevision: 'r' }], writes: [{ path: 'guides', bytes }] },
      { writes: [{ path: 'a', bytes }, { path: 'a/b.md', bytes }] },
      { writes: [{ path: 'a.md', bytes }, { path: 'a.md', bytes }] },
    ]) expect(() => plan(batch), JSON.stringify(batch)).toThrow(expect.objectContaining({ code: 'INVALID_PLAN' }));
  });

  it('finds nested steps even when sibling names sort between a folder and its contents', () => {
    // `p b` and `p.md` sort between `p` and `p/c.md` by code unit; nesting must still be found.
    const batch = { removes: [{ path: 'p', expectedRevision: 'r' }], writes: [{ path: 'p b', bytes }, { path: 'p.md', bytes }, { path: 'p/c.md', bytes }] };
    expect(() => plan(batch)).toThrow(expect.objectContaining({ code: 'INVALID_PLAN', message: expect.stringContaining('p/c.md') }));
    expect(() => plan({ removes: [{ path: 'p', expectedRevision: 'r' }], writes: [{ path: 'p b', bytes }, { path: 'p.md', bytes }] })).not.toThrow();
  });

  it('validates ten thousand claims in linear-logarithmic time', () => {
    const renames = Array.from({ length: 2500 }, (_, index) => ({ from: `notes/${index}.md`, to: `archive/${index}.md`, expectedRevision: 'r' }));
    const writes = Array.from({ length: 5000 }, (_, index) => ({ path: index < 2500 ? `archive/${index}.md` : `index/${index}.md`, bytes }));
    const started = performance.now();
    expect(() => plan({ renames, writes })).not.toThrow();
    expect(performance.now() - started).toBeLessThan(1000);
  });
});
