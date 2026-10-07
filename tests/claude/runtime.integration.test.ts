import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NodeClaudeRuntime } from '../../src/infrastructure/claude-runtime.ts';

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true }))); });

async function fixture(source: string) {
  const cwd = await mkdtemp(join(tmpdir(), 'forge claude runtime '));
  directories.push(cwd);
  const script = join(cwd, 'fake-claude.mjs');
  await writeFile(script, source);
  return { cwd, script, runtime: new NodeClaudeRuntime({ executable: process.execPath }) };
}

describe('installed Claude CLI adapter', () => {
  it('preserves literal arguments, working directory and Unicode without starting a shell', async () => {
    const { runtime, script, cwd } = await fixture(`
      process.stdout.write(JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd(), stdinIsTTY: !!process.stdin.isTTY }));
      process.stderr.write('diagnostic ✓');
    `);
    const marker = join(cwd, 'shell-was-executed');
    const args = ['plugin', 'install', `$(touch '${marker}')`, '; exit 19', 'two words', 'café'];
    const result = await runtime.run([script, ...args], { cwd });
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ args, cwd, stdinIsTTY: false });
    expect(result.stderr).toBe('diagnostic ✓');
    await expect(readFile(marker)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('returns a nonzero command result with both diagnostic streams', async () => {
    const { runtime, script, cwd } = await fixture(`
      process.stdout.write('Plugin was not changed.');
      process.stderr.write('Unknown marketplace.');
      process.exitCode = 2;
    `);
    await expect(runtime.run([script], { cwd })).resolves.toEqual({
      exitCode: 2, stdout: 'Plugin was not changed.', stderr: 'Unknown marketplace.',
    });
  });

  it('reports an actionable missing executable without installing anything', async () => {
    const { cwd } = await fixture('');
    const runtime = new NodeClaudeRuntime({ executable: join(cwd, 'missing-claude') });
    await expect(runtime.run(['--version'], { cwd })).rejects.toMatchObject({ code: 'CLAUDE_NOT_INSTALLED', message: expect.stringContaining('Install Claude Code') });
  });

  it('distinguishes a missing working directory from a missing executable', async () => {
    const { runtime, cwd } = await fixture('');
    await expect(runtime.run(['--version'], { cwd: join(cwd, 'missing') })).rejects.toMatchObject({ code: 'CLAUDE_WORKING_DIRECTORY_UNAVAILABLE' });
  });

  it('closes stdin so commands cannot wait for interactive answers', async () => {
    const { runtime, script, cwd } = await fixture(`
      process.stdin.on('end', () => process.stdout.write('stdin closed'));
      process.stdin.resume();
    `);
    await expect(runtime.run([script], { cwd })).resolves.toMatchObject({ exitCode: 0, stdout: 'stdin closed' });
  });

  it('pipes explicitly supplied UTF-8 input and closes the stream without putting input in arguments', async () => {
    const { runtime, script, cwd } = await fixture(`
      import { writeFileSync } from 'node:fs';
      const input = [];
      process.stdin.on('data', chunk => input.push(chunk));
      process.stdin.on('end', () => { writeFileSync('received', Buffer.concat(input)); process.stdout.write(JSON.stringify(process.argv.slice(2))); });
    `);
    const stdin = '{"token":"café"}\n';
    await expect(runtime.run([script, 'plugin', 'configure', 'team', '--values-stdin'], { cwd, stdin }))
      .resolves.toEqual({ exitCode: 0, stdout: '["plugin","configure","team","--values-stdin"]', stderr: '' });
    expect(await readFile(join(cwd, 'received'), 'utf8')).toBe(stdin);
    await expect(runtime.run([script], { cwd, stdin: '' })).resolves.toMatchObject({ exitCode: 0 });
    expect(await readFile(join(cwd, 'received'), 'utf8')).toBe('');
  });

  it('bounds UTF-8 input bytes before execution and keeps submitted input out of execution errors', async () => {
    const { runtime, script, cwd } = await fixture('process.exitCode = 0;');
    await expect(runtime.run([script], { cwd, stdin: 'é'.repeat(524289) })).rejects.toMatchObject({ code: 'INVALID_CLAUDE_INPUT' });
    const missing = new NodeClaudeRuntime({ executable: join(cwd, 'missing') });
    try {
      await missing.run([], { cwd, stdin: 'private-test-value' });
      throw new Error('Expected missing executable');
    } catch (error) {
      expect(error).toMatchObject({ code: 'CLAUDE_NOT_INSTALLED' });
      expect(JSON.stringify(error)).not.toContain('private-test-value');
    }
  });

  it('retains an early nonzero rejection when the child closes the input pipe', async () => {
    const { runtime, script, cwd } = await fixture(`
      process.stderr.write('Configuration refused', () => process.exit(2));
    `);
    await expect(runtime.run([script], { cwd, stdin: 'x'.repeat(512 * 1024) })).resolves.toEqual({
      exitCode: 2, stdout: '', stderr: 'Configuration refused',
    });
  });

  it('terminates a timed-out process and retains diagnostics', async () => {
    const { runtime, script, cwd } = await fixture(`
      import { writeFileSync } from 'node:fs';
      writeFileSync('child.pid', String(process.pid));
      process.stdout.write('started');
      process.stderr.write('waiting');
      setInterval(() => {}, 1000);
    `);
    await expect(runtime.run([script], { cwd, timeoutMs: 500 })).rejects.toMatchObject({
      code: 'CLAUDE_COMMAND_TIMEOUT', details: { timeoutMs: 500, stdout: 'started', stderr: 'waiting' },
    });
    const pid = Number(await readFile(join(cwd, 'child.pid'), 'utf8'));
    await expect.poll(() => {
      try { process.kill(pid, 0); return true; }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false; throw error; }
    }).toBe(false);
  });

  it('reports a signal termination with diagnostics instead of calling it a successful exit', async () => {
    const { runtime, script, cwd } = await fixture(`
      process.stderr.write('interrupted', () => process.kill(process.pid, 'SIGTERM'));
    `);
    await expect(runtime.run([script], { cwd })).rejects.toMatchObject({
      code: 'CLAUDE_COMMAND_FAILED', details: { signal: 'SIGTERM', stderr: 'interrupted' },
    });
  });

  it.skipIf(process.platform === 'win32')('stops POSIX descendants that would otherwise keep writing after timeout', async () => {
    const { runtime, script, cwd } = await fixture(`
      import { spawn } from 'node:child_process';
      const source = "require('node:fs').writeFileSync('descendant.started', 'yes'); setTimeout(() => require('node:fs').writeFileSync('descendant.finished', 'yes'), 700);";
      spawn(process.execPath, ['-e', source], { stdio: 'ignore' });
      setInterval(() => {}, 1000);
    `);
    await expect(runtime.run([script], { cwd, timeoutMs: 500 })).rejects.toMatchObject({ code: 'CLAUDE_COMMAND_TIMEOUT' });
    expect(await readFile(join(cwd, 'descendant.started'), 'utf8')).toBe('yes');
    await new Promise(resolve => setTimeout(resolve, 350));
    await expect(readFile(join(cwd, 'descendant.finished'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('bounds combined stdout and stderr rather than allowing each stream a separate budget', async () => {
    const { script, cwd } = await fixture(`
      process.stdout.write('a'.repeat(700));
      setTimeout(() => process.stderr.write('b'.repeat(700)), 20);
      setInterval(() => {}, 1000);
    `);
    const runtime = new NodeClaudeRuntime({ executable: process.execPath, maxOutputBytes: 1024 });
    await expect(runtime.run([script], { cwd })).rejects.toMatchObject({
      code: 'CLAUDE_OUTPUT_LIMIT', details: { maxOutputBytes: 1024, stdout: 'a'.repeat(700), stderr: 'b'.repeat(324) },
    });
  });

  it.each([0, -1, NaN, Infinity, 2_147_483_648])('rejects invalid timeout %s before starting a process', async timeoutMs => {
    const { runtime, script, cwd } = await fixture('throw new Error("must not run");');
    await expect(runtime.run([script], { cwd, timeoutMs })).rejects.toMatchObject({ code: 'INVALID_CLAUDE_TIMEOUT' });
  });
});
