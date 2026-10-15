import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { seedIncremental } from '../../scripts/mutation/shard.mjs';
import type { Report } from '../../scripts/mutation/report.mjs';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** A project with source files and earlier incremental files under `.quality-reports/mutation`. */
function project(sources: Record<string, string>, incremental: Record<string, Record<string, { source: string, status: string }>>) {
  const root = mkdtempSync(join(tmpdir(), 'forge-mutation-seed-'));
  roots.push(root);
  for (const [path, text] of Object.entries(sources)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  const dir = join(root, '.quality-reports/mutation');
  for (const [path, files] of Object.entries(incremental)) {
    const report: Report = {
      schemaVersion: '1.0',
      files: Object.fromEntries(Object.entries(files).map(([file, { source, status }]) => [file, { source, mutants: [{ id: '0', status, coveredBy: ['0'] }] }])),
      testFiles: { 'tests/t.unit.test.ts': { tests: [{ id: '0', name: `covers in ${path}` }, { id: '1', name: 'unused' }] } },
    };
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), JSON.stringify(report));
  }
  return { root, dir };
}

describe('seeding a shard incremental file', () => {
  it('keeps only the shard\'s files, preferring results recorded against the current source', () => {
    const { root, dir } = project({ 'src/a.ts': 'a', 'src/b.ts': 'b now', 'src/c.ts': 'c' }, {
      // shard 1 owned b.ts in an earlier partition; the full run recorded b.ts against its current source.
      'shard-1/incremental.json': { 'src/a.ts': { source: 'a', status: 'Killed' }, 'src/b.ts': { source: 'b before', status: 'Survived' } },
      'shard-2/incremental.json': { 'src/c.ts': { source: 'c', status: 'Killed' } },
      'incremental.json': { 'src/b.ts': { source: 'b now', status: 'Killed' } },
    });
    expect(seedIncremental(dir, 2, ['src/b.ts', 'src/c.ts'], root)).toBe(2);
    const seeded = JSON.parse(readFileSync(join(dir, 'shard-2/incremental.json'), 'utf8')) as Report;
    expect(Object.fromEntries(Object.entries(seeded.files).map(([file, { source, mutants }]) => [file, [source, mutants[0]!.status]]))).toStrictEqual({
      'src/b.ts': ['b now', 'Killed'],
      'src/c.ts': ['c', 'Killed'],
    });
    // Only the tests the kept mutants reference come along.
    expect(Object.values(seeded.testFiles!).flatMap(file => file.tests.map(test => test.name)).sort()).toStrictEqual(['covers in incremental.json', 'covers in shard-2/incremental.json']);
  });

  it('drops files a shard no longer owns and falls back to the first result when none matches the source', () => {
    const { root, dir } = project({ 'src/a.ts': 'a changed', 'src/b.ts': 'b' }, {
      'shard-1/incremental.json': { 'src/a.ts': { source: 'a', status: 'Killed' }, 'src/b.ts': { source: 'b', status: 'Killed' } },
      'shard-2/incremental.json': { 'src/a.ts': { source: 'a older', status: 'Survived' } },
    });
    expect(seedIncremental(dir, 1, ['src/a.ts'], root)).toBe(1);
    const seeded = JSON.parse(readFileSync(join(dir, 'shard-1/incremental.json'), 'utf8')) as Report;
    expect(Object.keys(seeded.files)).toStrictEqual(['src/a.ts']);
    expect(seeded.files['src/a.ts']).toMatchObject({ source: 'a', mutants: [{ status: 'Killed' }] });
  });

  it('writes nothing without earlier incremental files', () => {
    const { root, dir } = project({ 'src/a.ts': 'a' }, {});
    mkdirSync(dir, { recursive: true });
    expect(seedIncremental(dir, 1, ['src/a.ts'], root)).toBe(0);
    expect(() => readFileSync(join(dir, 'shard-1/incremental.json'))).toThrow();
  });
});
