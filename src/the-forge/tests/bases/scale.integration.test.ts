import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Bases } from '../../src/application/bases/query.ts';
import { basesEngine } from '../support/metadata.ts';
import { syntheticBase, writeSyntheticVault } from '../support/bases-vault.ts';

// Every vault file is a query row, while only notes are parsed. On one busy 4-core machine this query took
// 143 s when each row rebuilt all file contexts and the link map, and 3-4 s with them built once per query
// (up to 12 s inside the loaded full suite). The budget allows slow runners yet fails per-row rebuilds widely.
const vault = { notes: 1_000, attachments: 2_000 };
const budgetMs = 30_000;

let root: string;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'forge-bases-scale-')); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe('Bases query scaling', () => {
  it(`evaluates formulas, filters, sorting and groups over ${vault.notes + vault.attachments} files within ${budgetMs / 1000} s`, async () => {
    await writeSyntheticVault(root, vault);
    const bases = new Bases(await basesEngine(root));
    const started = performance.now();
    const result = await bases.query(syntheticBase, {});
    const elapsed = performance.now() - started;
    expect(result).toMatchObject({ view: 'Scale', total: 454 });
    expect(result.files.slice(0, 4)).toEqual(['Areas/Area 3/Note 63.md', 'Areas/Area 15/Note 115.md', 'Areas/Area 7/Note 167.md', 'Areas/Area 19/Note 219.md']);
    expect(result.files.slice(-2)).toEqual(['Areas/Area 0/Note 0.md', 'Areas/Area 12/Note 572.md']);
    expect(elapsed, `query took ${Math.round(elapsed)} ms`).toBeLessThan(budgetMs);
  }, 120_000);
});
