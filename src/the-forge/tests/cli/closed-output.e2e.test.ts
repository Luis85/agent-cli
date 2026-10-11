import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { portableCli } from '../support/portable-cli.ts';

const portable = portableCli();

/**
 * Run the copied CLI and close the read end of its standard output after the first chunk, as `forge schema | head
 * -c 10` does. Resolves with the exit status and everything written to standard error.
 */
function closedEarly(args: string[]) {
  return new Promise<{ status: number | null; signal: NodeJS.Signals | null; stderr: string; received: number }>((resolve, reject) => {
    const child = spawn(process.execPath, [join(portable.bundle, 'bin/forge.js'), '--root', portable.project, ...args], { cwd: portable.project, stdio: ['ignore', 'pipe', 'pipe'] });
    const stderr: Buffer[] = [];
    let received = 0;
    const timer = setTimeout(() => { child.kill(); reject(new Error(`forge ${args.join(' ')} did not finish`)); }, 30_000);
    child.stdout.once('data', (chunk: Buffer) => { received = chunk.length; child.stdout.destroy(); });
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', (status, signal) => { clearTimeout(timer); resolve({ status, signal, stderr: Buffer.concat(stderr).toString('utf8'), received }); });
  });
}

describe('closed standard output', () => {
  it.each([['schema'], ['help']])('stops quietly when the reader of %s closes the pipe early', async (...args) => {
    const result = await closedEarly(args);
    // The output is far larger than a pipe buffer, so the CLI writes into the closed pipe.
    expect(result.received).toBeGreaterThan(0);
    expect(result.stderr).toBe('');
    expect({ status: result.status, signal: result.signal }).toEqual({ status: 0, signal: null });
  });

  it('keeps the complete response when the reader stays', async () => {
    const { status, body } = await portable.cli(['schema']);
    expect(status).toBe(0);
    expect(body.ok).toBe(true);
  });
});
