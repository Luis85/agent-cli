import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Report } from '../../scripts/mutation/report.mjs';

type ShardOutput = { plan?: string[], report?: Record<string, string[]> };

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/**
 * A directory without node_modules holding only the merge scripts, as in the merge job, which installs no packages,
 * plus a configuration and the given shard outputs under `.quality-reports/mutation`.
 */
function mergeJob(shards: ShardOutput[]) {
  const root = mkdtempSync(join(tmpdir(), 'forge-mutation-merge-'));
  roots.push(root);
  mkdirSync(join(root, 'scripts'));
  for (const script of ['merge.mjs', 'report.mjs']) copyFileSync(join('scripts/mutation', script), join(root, 'scripts', script));
  writeFileSync(join(root, 'stryker.config.json'), JSON.stringify({ thresholds: { high: 80, low: 60, break: 50 } }));
  shards.forEach(({ plan, report }, position) => {
    const dir = join(root, '.quality-reports/mutation', `shard-${position + 1}`);
    mkdirSync(dir, { recursive: true });
    if (plan) writeFileSync(join(dir, 'plan.json'), JSON.stringify({ shard: position + 1, shards: shards.length, files: plan }));
    if (report) {
      const files = Object.fromEntries(Object.entries(report).map(([path, statuses]) => [path, { source: path, mutants: statuses.map((status, id) => ({ id: String(id), status })) }]));
      writeFileSync(join(dir, 'mutation.json'), JSON.stringify({ schemaVersion: '1.0', files, testFiles: {} } satisfies Report));
    }
  });
  const run = () => spawnSync(process.execPath, ['scripts/merge.mjs', '--shards', String(shards.length)], { cwd: root, encoding: 'utf8', env: { ...process.env, GITHUB_STEP_SUMMARY: '' } });
  return { root, run };
}

describe('the merge job', () => {
  it('merges shard reports that match their plans with Node alone and judges the overall score', () => {
    const { root, run } = mergeJob([{ plan: ['a.ts'], report: { 'a.ts': ['Killed', 'Survived'] } }, { plan: ['b.ts'], report: { 'b.ts': ['Killed'] } }]);
    const result = run();
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Mutation score 66.67% is at or above the break threshold 50.');
    const merged = JSON.parse(readFileSync(join(root, '.quality-reports/mutation/mutation.json'), 'utf8')) as Report;
    expect(Object.keys(merged.files)).toStrictEqual(['a.ts', 'b.ts']);
  });

  it.each<[string, ShardOutput[], string]>([
    ['a shard without a plan', [{ plan: ['a.ts'], report: { 'a.ts': ['Killed'] } }, { report: { 'b.ts': ['Killed'] } }], 'Shard 2/2 wrote no plan'],
    ['a planned file without results', [{ plan: ['a.ts', 'c.ts'], report: { 'a.ts': ['Killed'] } }, { plan: ['b.ts'], report: { 'b.ts': ['Killed'] } }], 'Shard 1/2 reported no mutants for c.ts, which it planned'],
    ['overlapping plans', [{ plan: ['a.ts'], report: { 'a.ts': ['Killed'] } }, { plan: ['a.ts', 'b.ts'], report: { 'b.ts': ['Killed'] } }], 'a.ts is planned for shards 1 and 2'],
    ['a missing report', [{ plan: ['a.ts'], report: { 'a.ts': ['Killed'] } }, { plan: ['b.ts'] }], 'Shard 2/2 wrote no mutation report'],
  ])('fails on %s without writing a merged report', (_, shards, message) => {
    const { root, run } = mergeJob(shards);
    const result = run();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(message);
    expect(() => readFileSync(join(root, '.quality-reports/mutation/mutation.json'))).toThrow();
  });
});
