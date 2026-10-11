import { describe, expect, it } from 'vitest';
import { outcomeKey, racyWindowMs, readSnapshot, snapshotFormat, unchangedFile, type MetadataSnapshot } from '../../src/domain/metadata/snapshot.ts';
import { snapshotFile } from '../../src/infrastructure/metadata/snapshot-store.ts';

const valid = (): MetadataSnapshot => ({
  format: snapshotFormat, key: 'forge 1; parser 1; scope .', checkedAtMs: 1_000_000,
  files: { 'Note.md': { stamp: 's1', revision: 'r1' }, 'Bad.md': { stamp: null, revision: 'r2' } },
  outcomes: { 'markdown:r1': { metadata: { tags: [] }, positions: [] }, 'markdown:r2': { issue: { code: 'INVALID_YAML', message: 'broken' } } },
  links: { paths: ['Bad.md', 'Note.md'], aliases: '[]', sources: { 'Note.md': [0, null, ['missing', 'Gone']] } },
});

describe('stored metadata snapshots', () => {
  it('reads a snapshot of the expected format and key and nothing else', () => {
    expect(readSnapshot(JSON.parse(JSON.stringify(valid())), valid().key)).toEqual(valid());
    expect(readSnapshot({ ...valid(), links: null }, valid().key)).toEqual({ ...valid(), links: null });
    expect(readSnapshot(valid(), 'forge 2; parser 1; scope .')).toBeNull();
    expect(readSnapshot({ ...valid(), format: snapshotFormat + 1 }, valid().key)).toBeNull();
    for (const value of [null, [], 'text', 42]) expect(readSnapshot(value, valid().key)).toBeNull();
  });

  it('rejects a snapshot with any malformed part instead of reusing part of it', () => {
    const broken: Array<Partial<Record<keyof MetadataSnapshot, unknown>>> = [
      { checkedAtMs: Number.NaN }, { checkedAtMs: '1' }, { files: [] }, { outcomes: null },
      { files: { 'Note.md': { stamp: 1, revision: 'r1' } } }, { files: { 'Note.md': { stamp: 's1' } } },
      { outcomes: { 'markdown:r1': { metadata: [], positions: [] } } }, { outcomes: { 'markdown:r1': { metadata: {} } } },
      { outcomes: { 'markdown:r1': { issue: { code: 'X' } } } }, { outcomes: { 'markdown:r1': {} } },
      { outcomes: { 'markdown:r1': { metadata: {}, positions: [], issue: { code: 'X', message: 'y' } } } },
      { links: undefined }, { links: { paths: [1], aliases: '[]', sources: {} } }, { links: { paths: [], aliases: [], sources: {} } },
      { links: { paths: [], aliases: '[]', sources: { 'Note.md': 0 } } },
    ];
    for (const change of broken) expect(readSnapshot({ ...valid(), ...change }, valid().key), JSON.stringify(change)).toBeNull();
  });

  it('trusts an unchanged stamp only outside the racy window of the listing that stored it', () => {
    const stored = { stamp: 's1', revision: 'r1' }, checkedAtMs = 1_000_000;
    expect(unchangedFile(stored, { stamp: 's1', changedMs: checkedAtMs - racyWindowMs - 1 }, checkedAtMs)).toBe(true);
    expect(unchangedFile(stored, { stamp: 's1', changedMs: checkedAtMs - racyWindowMs }, checkedAtMs)).toBe(false);
    expect(unchangedFile(stored, { stamp: 's1', changedMs: checkedAtMs + 5 }, checkedAtMs)).toBe(false);
    expect(unchangedFile(stored, { stamp: 's2', changedMs: 0 }, checkedAtMs)).toBe(false);
    expect(unchangedFile({ stamp: null, revision: 'r1' }, { stamp: 's1', changedMs: 0 }, checkedAtMs)).toBe(false);
    expect(unchangedFile(undefined, { stamp: 's1', changedMs: 0 }, checkedAtMs)).toBe(false);
    expect(unchangedFile(stored, undefined, checkedAtMs)).toBe(false);
  });

  it('keys parse results by file kind and content revision, so renamed files share them', () => {
    expect(outcomeKey('Notes/Plan.md', 'abc')).toBe(outcomeKey('Archive/Old Plan.MD', 'abc'));
    expect(outcomeKey('Board.canvas', 'abc')).not.toBe(outcomeKey('Board.md', 'abc'));
  });

  it('names one snapshot file for the workspace and one per project directory below .forge/cache', () => {
    expect(snapshotFile(null)).toBe(`.forge/cache/metadata.v${snapshotFormat}.workspace.json`);
    expect(snapshotFile('src/the-forge')).toBe(`.forge/cache/metadata.v${snapshotFormat}.project.src%2Fthe-forge.json`);
  });
});
