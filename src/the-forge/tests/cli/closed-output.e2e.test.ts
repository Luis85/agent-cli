import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { portableCli } from '../support/portable-cli.ts';

const portable = portableCli();

/**
 * Run the copied CLI and close the read end of a pipe: `stdout` after its first chunk, as `forge schema | head -c 10`
 * does; `stdout-unread` at once, as `forge read nope.md | true` does; `stderr` at once, as a harness that never reads
 * standard error. Resolves with the exit status, what reached standard output and everything written to standard error.
 */
function closedEarly(args: string[], closed: 'stdout' | 'stdout-unread' | 'stderr' = 'stdout') {
  return new Promise<{ status: number | null; signal: NodeJS.Signals | null; stderr: string; stdout: string; received: number }>((resolve, reject) => {
    const child = spawn(process.execPath, [join(portable.bundle, 'bin/forge.js'), '--root', portable.project, ...args], { cwd: portable.project, stdio: ['ignore', 'pipe', 'pipe'] });
    const stderr: Buffer[] = [], stdout: Buffer[] = [];
    let received = 0;
    const timer = setTimeout(() => { child.kill(); reject(new Error(`forge ${args.join(' ')} did not finish`)); }, 30_000);
    if (closed === 'stdout') child.stdout.once('data', (chunk: Buffer) => { received = chunk.length; child.stdout.destroy(); });
    else if (closed === 'stdout-unread') child.stdout.destroy();
    else child.stdout.on('data', (chunk: Buffer) => { received += chunk.length; stdout.push(chunk); });
    if (closed === 'stderr') child.stderr.destroy();
    else child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', (status, signal) => {
      clearTimeout(timer);
      resolve({ status, signal, stderr: Buffer.concat(stderr).toString('utf8'), stdout: Buffer.concat(stdout).toString('utf8'), received });
    });
  });
}

/** A user plugin command that logs to standard error, waits, then writes a note. */
const logger = `export default { commands: [{
  id: 'logger.run', description: 'Log, then write', usage: 'logger.run', mutating: true,
  async run(args, flags, context) {
    for (let line = 0; line < 64; line++) console.error('logger: starting ' + 'x'.repeat(1024));
    await new Promise(resolve => setTimeout(resolve, 200));
    await context.workspace.write([{ path: 'notes/logged.md', bytes: new TextEncoder().encode('# Logged\\n'), mode: 'create' }]);
    return { written: true };
  },
}] };
`;

beforeAll(async () => {
  await mkdir(join(portable.project, 'bin/plugins/logger'), { recursive: true });
  await writeFile(join(portable.project, 'bin/plugins/logger/manifest.json'), JSON.stringify({ id: 'logger', name: 'Logger', version: '1.0.0', minAppVersion: '0.1.0', description: 'Closed stderr fixture', author: 'Tests' }));
  await writeFile(join(portable.project, 'bin/plugins/logger/main.mjs'), logger);
  await writeFile(join(portable.project, 'bin/config.json'), JSON.stringify({ plugins: { enabled: ['logger'] } }));
});

describe('closed standard output', () => {
  it.each([['schema'], ['help']])('stops quietly when the reader of %s closes the pipe early', async (...args) => {
    const result = await closedEarly(args);
    // The output is far larger than a pipe buffer, so the CLI writes into the closed pipe.
    expect(result.received).toBeGreaterThan(0);
    expect(result.stderr).toBe('');
    expect({ status: result.status, signal: result.signal }).toEqual({ status: 0, signal: null });
  });

  it('keeps the error status when the reader closes the pipe before any output', async () => {
    const result = await closedEarly(['--json', 'read', 'nope.md'], 'stdout-unread');
    expect(result.stderr).toBe('');
    expect({ status: result.status, signal: result.signal }).toEqual({ status: 3, signal: null });
  });

  it('completes a command, with its write and response, when the reader of standard error is gone', async () => {
    const result = await closedEarly(['--json', 'logger.run'], 'stderr');
    expect({ status: result.status, signal: result.signal }).toEqual({ status: 0, signal: null });
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: true, data: { written: true } });
    expect(existsSync(join(portable.project, 'notes/logged.md'))).toBe(true);
  });

  it('keeps the complete response when the reader stays', async () => {
    const { status, body } = await portable.cli(['schema']);
    expect(status).toBe(0);
    expect(body.ok).toBe(true);
  });
});
