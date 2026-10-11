import { expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { distribution } from '../support/workspace.ts';

/** Runs the metadata benchmark on a small vault through the built distribution, without blocking the test worker. */
function bench(args: string[]): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, [resolve('scripts/bench/metadata.mjs'), '--forge', resolve(distribution, 'forge.js'), ...args]);
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', fail);
    child.on('close', status => done({ status, stdout, stderr }));
  });
}

it('measures warm runs that reuse the stored metadata cache without rewriting it', async () => {
  const result = await bench(['--notes', '30', '--attachments', '2', '--runs', '2']);
  expect(result.status, result.stderr).toBe(0);
  const report = JSON.parse(result.stdout) as { results: Array<{ command: string; ok: boolean; warmCacheRewrites: number; warmCpuMs: number[] }> };
  expect(report.results.map(item => item.command)).toEqual(['vault check', 'links unresolved', 'search details --tag t3 --limit 20', 'bases query bases/Notes.base --view Active']);
  for (const item of report.results) {
    // Freshly generated notes are inside the racy window at first; a warm run must find every stamp trusted.
    expect(item, item.command).toMatchObject({ ok: true, warmCacheRewrites: 0 });
    expect(item.warmCpuMs.every(Number.isFinite)).toBe(true);
  }
});
