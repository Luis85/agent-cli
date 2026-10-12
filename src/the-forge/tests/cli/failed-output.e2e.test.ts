import { spawn } from 'node:child_process';
import { open, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { portableCli } from '../support/portable-cli.ts';

const portable = portableCli();
let preload: string;

beforeAll(async () => {
  preload = join(portable.project, 'output-failure.cjs');
  // Inject transport faults in a copied CLI process, leaving application behavior intact.
  await writeFile(preload, `
    const fault = () => Object.assign(new Error('private output path and payload'), { code: process.env.FORGE_TEST_OUTPUT_CODE });
    if (process.env.FORGE_TEST_OUTPUT_MODE === 'sync') process.stdout.write = () => { throw fault(); };
    else process.stdout._write = (chunk, encoding, callback) => callback(fault());
    if (process.env.FORGE_TEST_STDERR_FAIL === '1') process.stderr._write = (chunk, encoding, callback) => callback(fault());
  `);
});

function run(args: string[], options: { code?: string; synchronous?: boolean; stderrFails?: boolean; fd?: number } = {}) {
  return new Promise<{ status: number | null; signal: NodeJS.Signals | null; stderr: string; stdout: string }>((resolve, reject) => {
    const child = spawn(process.execPath, [
      ...(options.fd === undefined ? ['--require', preload] : []),
      join(portable.bundle, 'bin/forge.js'), '--root', portable.project, '--json', ...args,
    ], {
      cwd: portable.project,
      env: { ...process.env, FORGE_TEST_OUTPUT_CODE: options.code ?? 'ENOSPC', FORGE_TEST_OUTPUT_MODE: options.synchronous ? 'sync' : 'async', FORGE_TEST_STDERR_FAIL: options.stderrFails ? '1' : '0' },
      stdio: ['ignore', options.fd ?? 'pipe', 'pipe'],
    });
    const stderr: Buffer[] = [], stdout: Buffer[] = [];
    const timer = setTimeout(() => { child.kill(); reject(new Error('The CLI did not finish after an output failure.')); }, 30_000);
    child.stdout?.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr?.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', (status, signal) => {
      clearTimeout(timer);
      resolve({ status, signal, stderr: Buffer.concat(stderr).toString('utf8'), stdout: Buffer.concat(stdout).toString('utf8') });
    });
  });
}

function expectDiagnostic(result: Awaited<ReturnType<typeof run>>, code: string, status = 1) {
  expect({ status: result.status, signal: result.signal, stdout: result.stdout }).toEqual({ status, signal: null, stdout: '' });
  expect(result.stderr).toBe(`The Forge could not write standard output (${code}). Check the output destination and available storage. Command effects may already be committed; inspect state before retrying.\n`);
}

describe('failed standard output', () => {
  it.each(['ENOSPC', 'EDQUOT', 'EIO'])('reports %s without a raw stack or arbitrary error details', async code => {
    expectDiagnostic(await run(['--version'], { code }), code);
  });

  it('handles synchronous write failures separately from JSON serialization', async () => {
    expectDiagnostic(await run(['--version'], { synchronous: true }), 'ENOSPC');
  });

  it('keeps an existing command error status and bounds an untrusted transport code', async () => {
    expectDiagnostic(await run(['read', 'missing.md'], { code: 'private\n'.repeat(1000) }), 'UNKNOWN', 3);
  });

  it('retains a committed mutation when delivery of its response fails', async () => {
    expectDiagnostic(await run(['create', 'committed.md', '--content', '# Committed\n']), 'ENOSPC');
    expect(await readFile(join(portable.project, 'committed.md'), 'utf8')).toBe('# Committed\n');
  });

  it('exits nonzero without a recursive failure when stderr also fails', async () => {
    const result = await run(['--version'], { stderrFails: true });
    expect(result).toEqual({ status: 1, signal: null, stdout: '', stderr: '' });
  });

  it.runIf(process.platform === 'linux')('handles a real full output device without filling the workspace', async () => {
    const full = await open('/dev/full', 'w');
    try { expectDiagnostic(await run(['--version'], { fd: full.fd }), 'ENOSPC'); }
    finally { await full.close(); }
  });
});
