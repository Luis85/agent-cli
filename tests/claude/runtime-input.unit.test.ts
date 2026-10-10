import { EventEmitter } from 'node:events';
import { tmpdir } from 'node:os';
import { PassThrough, Writable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';

/** A child whose stdin fails with a platform-specific error code once written to. */
class ClosedInputChild extends EventEmitter {
  readonly pid = undefined;
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly stdin: Writable;
  constructor(code: string, exitCode: number) {
    super();
    this.stdin = new Writable({ write: (_chunk, _encoding, callback) => callback(Object.assign(new Error(`write ${code}`), { code })) });
    this.stdin.on('error', () => {
      this.stderr.end('Configuration refused');
      this.stdout.end();
      setImmediate(() => this.emit('close', exitCode, null));
    });
  }
  kill(): boolean { return false; }
}

const spawned = vi.hoisted(() => ({ code: 'EPIPE', exitCode: 2 }));
vi.mock('node:child_process', () => ({ spawn: () => new ClosedInputChild(spawned.code, spawned.exitCode) }));
const { NodeClaudeRuntime } = await import('../../src/the-forge/infrastructure/claude/runtime.ts');

afterEach(() => { spawned.code = 'EPIPE'; spawned.exitCode = 2; });

describe('Claude input pipe closed by the child', () => {
  // Writing to a pipe whose reader exited fails with EPIPE on POSIX and EOF on Windows (libuv maps ERROR_BROKEN_PIPE to EOF).
  it.each(['EPIPE', 'EOF'])('retains the early nonzero result when the write fails with %s', async code => {
    spawned.code = code;
    await expect(new NodeClaudeRuntime().run([], { cwd: tmpdir(), stdin: 'payload' }))
      .resolves.toEqual({ exitCode: 2, stdout: '', stderr: 'Configuration refused' });
  });

  it.each(['EPIPE', 'EOF'])('does not report success after a %s input failure with exit code 0', async code => {
    Object.assign(spawned, { code, exitCode: 0 });
    await expect(new NodeClaudeRuntime().run([], { cwd: tmpdir(), stdin: 'payload' }))
      .rejects.toMatchObject({ code: 'CLAUDE_COMMAND_FAILED', details: { cause: `write ${code}` } });
  });

  it('reports other input failures immediately', async () => {
    spawned.code = 'EACCES';
    await expect(new NodeClaudeRuntime().run([], { cwd: tmpdir(), stdin: 'payload' }))
      .rejects.toMatchObject({ code: 'CLAUDE_COMMAND_FAILED', message: 'Cannot send input to Claude: write EACCES' });
  });
});
