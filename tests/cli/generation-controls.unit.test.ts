import { describe, expect, it, vi } from 'vitest';
import { generationControls, generationOutputPath } from '../../src/presentation/generation/controls.ts';
import type { FileSnapshot } from '../../src/domain/documents/file.ts';

const snapshot = (content: string): FileSnapshot => ({ path: 'review.json', bytes: new TextEncoder().encode(content), revision: 'a'.repeat(64) });

describe('generation command controls', () => {
  it.each<Record<string, string | boolean>>([
    { plan: true, check: true },
    { 'plan-out': 'review.json', check: true },
    { plan: true, 'revisions-from': 'review.json' },
    { check: true, 'revisions-from': 'review.json' },
    { 'plan-out': 'review.json', 'revisions-from': 'review.json' },
  ])('rejects incompatible modes before reading input: %j', async flags => {
    const read = vi.fn();
    await expect(generationControls(flags, { read })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    expect(read).not.toHaveBeenCalled();
  });

  it('keeps manifest input relative to the selected scope and revision keys workspace-relative', async () => {
    const revisions = { 'projects/portal/src/ui/Page.tsx': 'b'.repeat(64) };
    const read = vi.fn(async () => snapshot(JSON.stringify(revisions)));
    expect(await generationControls({ 'revisions-from': 'review.json' }, { read })).toMatchObject({ mode: 'generate', revisions });
    expect(read).toHaveBeenCalledWith('review.json');
    expect(generationOutputPath('review.json', { directory: 'projects/portal' })).toBe('projects/portal/review.json');
    expect(generationOutputPath('src/ui', null)).toBe('src/ui');
    expect(() => generationOutputPath('../escape', { directory: 'projects/portal' })).toThrow();
  });

  it.each(['[]', 'null', '{"path":"invalid"}', '{"path":2}'])('rejects invalid revision maps: %s', async content => {
    await expect(generationControls({ 'revisions-from': 'review.json' }, { read: async () => snapshot(content) })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('preserves JSON error classification and implies planning from a manifest output', async () => {
    const read = vi.fn(async () => snapshot('{'));
    await expect(generationControls({ 'revisions-from': 'review.json' }, { read })).rejects.toMatchObject({ code: 'INVALID_JSON' });
    read.mockClear();
    expect(await generationControls({ 'plan-out': 'review.json' }, { read })).toMatchObject({ mode: 'plan', manifestPath: 'review.json' });
    expect(read).not.toHaveBeenCalled();
  });
});
