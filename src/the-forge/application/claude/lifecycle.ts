import { AppError, ensure, isRecord, summarizeError } from '../../domain/shared/errors.ts';
import type { ClaudeRuntime } from './runtime.ts';
import type { EventBus } from '../plugins/events.ts';
import { publishHostEvent } from '../plugins/host-events.ts';

export type ClaudeOutput = 'text' | 'json' | 'json-last-line';
/** Literal native arguments. Plugins own operation policy; the host owns execution. */
export interface ClaudeLifecycleRequest {
  args: readonly string[];
  executable?: string;
  timeoutMs?: number;
  stdin?: string;
  output?: ClaudeOutput;
  sensitiveArgs?: readonly number[];
}
export interface ClaudeLifecyclePlan {
  executable: string;
  args: string[];
  cwd: string;
  timeoutMs?: number;
  inputBytes?: number;
}
export type ClaudeLifecycleResult =
  | { dryRun: true; executed: false; plan: ClaudeLifecyclePlan }
  | (ClaudeLifecyclePlan & { dryRun: false; executed: true; exitCode: number; stdout: string; stderr: string; result?: unknown });
export interface ClaudeLifecycleClient { execute(request: ClaudeLifecycleRequest): Promise<ClaudeLifecycleResult> }

function nativeResult(stdout: string, output: ClaudeOutput): unknown {
  if (output === 'text') return undefined;
  const text = stdout.trim();
  return JSON.parse(output === 'json-last-line' ? text.split('\n').at(-1) ?? '' : text);
}

/** Shared by built-in commands and trusted plugin commands, with invocation scope fixed by the host. */
export class ClaudeLifecycle implements ClaudeLifecycleClient {
  constructor(
    private readonly runtime: (executable: string) => ClaudeRuntime,
    private readonly scope: { cwd: string; dryRun: boolean },
    private readonly events: EventBus,
  ) {}

  async execute(request: ClaudeLifecycleRequest): Promise<ClaudeLifecycleResult> {
    let detached = request;
    let snapshotFailure: { error: unknown } | undefined;
    try {
      if (isRecord(request)) {
        detached = { ...request };
        if (Array.isArray(detached.args)) detached.args = [...detached.args];
        if (Array.isArray(detached.sensitiveArgs)) detached.sensitiveArgs = [...detached.sensitiveArgs];
      }
    } catch (error) { snapshotFailure = { error }; }
    const requestedExecutable: unknown = !snapshotFailure && isRecord(detached) ? detached.executable ?? 'claude' : 'claude';
    const executable = typeof requestedExecutable === 'string' && requestedExecutable.trim().length > 0 && !requestedExecutable.includes('\0') ? requestedExecutable : '<invalid>';
    const operation = { operationId: this.events.nextOperationId(), executable, cwd: this.scope.cwd, dryRun: this.scope.dryRun };
    let exitCode: number | undefined;
    await publishHostEvent(this.events, 'claude.started', operation);
    try {
      if (snapshotFailure) throw snapshotFailure.error;
      const result = await this.invoke(detached, status => { exitCode = status; });
      await publishHostEvent(this.events, 'claude.succeeded', { ...operation, ...(exitCode === undefined ? {} : { exitCode }) });
      return result;
    } catch (error) {
      await publishHostEvent(this.events, 'claude.failed', { ...operation, ...(exitCode === undefined ? {} : { exitCode }), error: summarizeError(error) });
      throw error;
    }
  }

  private async invoke(request: ClaudeLifecycleRequest, observeExit: (exitCode: number) => void): Promise<ClaudeLifecycleResult> {
    ensure(isRecord(request), 'INVALID_CLAUDE_ARGUMENT', 'Claude execution requires an invocation object.');
    const executable = request.executable ?? 'claude';
    ensure(typeof executable === 'string' && executable.trim().length > 0 && !executable.includes('\0'), 'INVALID_CLAUDE_EXECUTABLE', 'Provide the Claude executable name or path.');
    ensure(Array.isArray(request.args) && request.args.every(argument => typeof argument === 'string' && !argument.includes('\0')), 'INVALID_CLAUDE_ARGUMENT', 'Claude arguments must be strings without null bytes.');
    const args = [...request.args], timeoutMs = request.timeoutMs, input = request.stdin;
    ensure(timeoutMs === undefined || (Number.isSafeInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 3600000), 'INVALID_CLAUDE_TIMEOUT', 'Claude timeout must be milliseconds from 1 to 3600000.');
    ensure(input === undefined || typeof input === 'string', 'INVALID_CLAUDE_INPUT', 'Claude standard input must be UTF-8 text.');
    const inputBytes = input === undefined ? undefined : new TextEncoder().encode(input).length;
    ensure(inputBytes === undefined || inputBytes <= 1024 * 1024, 'INVALID_CLAUDE_INPUT', 'Claude standard input must not exceed 1 MiB.');
    const output = request.output ?? 'text';
    ensure(['text', 'json', 'json-last-line'].includes(output), 'INVALID_CLAUDE_OUTPUT', 'Claude output must be text, json, or json-last-line.');
    const sensitive = request.sensitiveArgs ?? [];
    ensure(Array.isArray(sensitive) && sensitive.every(index => Number.isSafeInteger(index) && index >= 0 && index < args.length), 'INVALID_CLAUDE_ARGUMENT', 'Sensitive argument indices must address native arguments.');
    const redact = new Set(sensitive);
    // Native install configuration can contain secrets; never echo those arguments in a plan.
    for (const [index, argument] of args.entries()) if (argument === '--config' && index + 1 < args.length) redact.add(index + 1); else if (argument.startsWith('--config=')) redact.add(index);
    const plan: ClaudeLifecyclePlan = { executable, args: args.map((argument, index) => redact.has(index) ? '<redacted>' : argument), cwd: this.scope.cwd,
      ...(timeoutMs === undefined ? {} : { timeoutMs }), ...(inputBytes === undefined ? {} : { inputBytes }) };
    if (this.scope.dryRun) return { dryRun: true, executed: false, plan };
    const result = await this.runtime(executable).run(args, { cwd: this.scope.cwd, ...(timeoutMs === undefined ? {} : { timeoutMs }), ...(input === undefined ? {} : { stdin: input }) });
    ensure(Number.isInteger(result.exitCode), 'CLAUDE_RUNTIME_FAILED', 'Claude Code returned no exit status.');
    observeExit(result.exitCode);
    await publishHostEvent(this.events, 'claude.executed', { executable, cwd: this.scope.cwd, exitCode: result.exitCode });
    let data: unknown, malformed = false;
    try { data = nativeResult(result.stdout, output); } catch { malformed = true; }
    const details = { ...plan, ...result, ...(data === undefined ? {} : { result: data }) };
    if (result.exitCode !== 0) throw new AppError('CLAUDE_RUNTIME_FAILED', `Claude Code exited with status ${result.exitCode}. Inspect the native result before retrying; the command may have changed external state.`, 1, details);
    if (malformed) throw new AppError('CLAUDE_INVALID_OUTPUT', 'Claude exited successfully but did not return the requested JSON. Inspect stdout and external state before retrying.', 1, details);
    return { dryRun: false, executed: true, ...details };
  }
}
