import { spawn } from 'node:child_process';
import { stat } from 'node:fs/promises';
import type { ClaudeRuntime, ClaudeRuntimeOptions, ClaudeRuntimeResult } from '../../application/claude/runtime.ts';
import { errorMessage, AppError, ensure } from '../../domain/shared/errors.ts';

interface NodeClaudeRuntimeOptions {
  executable?: string;
  maxOutputBytes?: number;
}

/** Native CLI execution is deliberately separate from Forge's guarded file writes. */
export class NodeClaudeRuntime implements ClaudeRuntime {
  private readonly executable: string;
  private readonly maxOutputBytes: number;

  constructor(options: NodeClaudeRuntimeOptions = {}) {
    this.executable = options.executable ?? 'claude';
    this.maxOutputBytes = options.maxOutputBytes ?? 1024 * 1024;
    ensure(this.executable.trim().length > 0 && !this.executable.includes('\0'), 'INVALID_CLAUDE_EXECUTABLE', 'Provide the Claude executable name or path.');
    ensure(Number.isSafeInteger(this.maxOutputBytes) && this.maxOutputBytes > 0, 'INVALID_CLAUDE_OUTPUT_LIMIT', 'Claude output limit must be a positive integer.');
  }

  async run(args: readonly string[], options: ClaudeRuntimeOptions): Promise<ClaudeRuntimeResult> {
    const timeoutMs = options.timeoutMs ?? 120_000;
    ensure(Number.isInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 2_147_483_647,
      'INVALID_CLAUDE_TIMEOUT', 'Claude timeout must be a positive integer no greater than 2147483647 milliseconds.');
    ensure(args.every(argument => typeof argument === 'string' && !argument.includes('\0')),
      'INVALID_CLAUDE_ARGUMENT', 'Claude arguments must be strings without null bytes.');
    ensure(options.stdin === undefined || (typeof options.stdin === 'string' && Buffer.byteLength(options.stdin, 'utf8') <= 1024 * 1024),
      'INVALID_CLAUDE_INPUT', 'Claude standard input must be UTF-8 text no larger than 1048576 bytes.');
    let directory: boolean;
    try { directory = (await stat(options.cwd)).isDirectory(); }
    catch (error) {
      throw new AppError('CLAUDE_WORKING_DIRECTORY_UNAVAILABLE', `Cannot access Claude working directory: ${options.cwd}`, 1,
        { cause: errorMessage(error) });
    }
    ensure(directory, 'CLAUDE_WORKING_DIRECTORY_UNAVAILABLE', `Claude working directory is not a directory: ${options.cwd}`);

    return new Promise((resolve, reject) => {
      const grouped = process.platform !== 'win32';
      const child = spawn(this.executable, [...args], {
        cwd: options.cwd, shell: false, stdio: [options.stdin === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'], windowsHide: true, detached: grouped,
      });
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let outputBytes = 0;
      let settled = false;
      let inputError: Error | undefined;
      let timer: ReturnType<typeof setTimeout>;
      const output = () => ({ stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8') });
      const stop = (): boolean => {
        // POSIX groups also stop git/install descendants. Windows stops the direct process only.
        if (!child.pid) return false;
        return grouped ? process.kill(-child.pid, 'SIGKILL') : child.kill('SIGKILL');
      };
      const cleanup = () => {
        clearTimeout(timer);
        process.removeListener('SIGINT', interrupt);
        process.removeListener('SIGTERM', terminate);
        process.removeListener('exit', exit);
      };
      const fail = (code: string, message: string, details: Record<string, unknown> = {}, exitCode = 1) => {
        if (settled) return;
        settled = true;
        cleanup();
        let terminationRequested = false;
        try { terminationRequested = stop(); } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ESRCH') details.terminationError = errorMessage(error);
        }
        child.stdout!.destroy();
        child.stderr!.destroy();
        child.stdin?.destroy();
        if (['CLAUDE_COMMAND_TIMEOUT', 'CLAUDE_OUTPUT_LIMIT', 'CLAUDE_COMMAND_INTERRUPTED'].includes(code)) {
          message += ` ${terminationRequested ? 'Termination requested.' : 'Termination could not be requested.'} Inspect its state before retrying.`;
        }
        reject(new AppError(code, message, exitCode, { executable: this.executable, ...details,
          terminationScope: grouped ? 'process-group' : 'direct-process', terminationRequested, ...output() }));
      };
      const interrupt = () => fail('CLAUDE_COMMAND_INTERRUPTED', 'Forge received SIGINT while running Claude.', { signal: 'SIGINT' }, 130);
      const terminate = () => fail('CLAUDE_COMMAND_INTERRUPTED', 'Forge received SIGTERM while running Claude.', { signal: 'SIGTERM' }, 143);
      const exit = () => { try { stop(); } catch { /* The host is already exiting; cleanup cannot be reported asynchronously. */ } };
      process.once('SIGINT', interrupt);
      process.once('SIGTERM', terminate);
      process.once('exit', exit);
      timer = setTimeout(() => fail('CLAUDE_COMMAND_TIMEOUT',
        `Claude command exceeded ${timeoutMs} milliseconds.`, { timeoutMs }), timeoutMs);
      const collect = (chunks: Buffer[], chunk: Buffer) => {
        if (settled) return;
        const remaining = this.maxOutputBytes - outputBytes;
        chunks.push(chunk.subarray(0, remaining));
        outputBytes += Math.min(chunk.length, remaining);
        if (chunk.length > remaining) fail('CLAUDE_OUTPUT_LIMIT',
          `Claude command exceeded ${this.maxOutputBytes} bytes of output.`,
          { maxOutputBytes: this.maxOutputBytes });
      };
      child.stdout!.on('data', (chunk: Buffer) => collect(stdout, chunk));
      child.stderr!.on('data', (chunk: Buffer) => collect(stderr, chunk));
      child.on('error', error => {
        if ('code' in error && error.code === 'ENOENT') {
          fail('CLAUDE_NOT_INSTALLED', `Claude executable was not found: ${this.executable}. Install Claude Code and make claude available on PATH, or provide its executable path.`);
        } else fail('CLAUDE_COMMAND_FAILED', `Cannot execute Claude: ${error.message}`);
      });
      child.on('close', (exitCode, signal) => {
        if (settled) return;
        if (exitCode === null) {
          fail('CLAUDE_COMMAND_FAILED', `Claude command stopped unexpectedly${signal ? ` (${signal})` : ''}.`, { signal });
          return;
        }
        if (exitCode === 0 && inputError) {
          fail('CLAUDE_COMMAND_FAILED', 'Claude closed its input before the configuration was fully sent. Inspect its state before retrying.', { cause: inputError.message });
          return;
        }
        settled = true;
        cleanup();
        resolve({ exitCode, ...output() });
      });
      child.stdin?.on('error', error => {
        // An early native rejection may close stdin; retain its exit code and diagnostics.
        inputError = error;
        if ((error as NodeJS.ErrnoException).code !== 'EPIPE') fail('CLAUDE_COMMAND_FAILED', `Cannot send input to Claude: ${error.message}`);
      });
      child.stdin?.end(options.stdin);
    });
  }
}
