import { describe, expect, it, vi } from 'vitest';
import { ClaudeLifecycle, type ClaudeLifecycleRequest } from '../../src/plugins/claude/application/lifecycle.ts';
import type { ClaudeRuntimeResult } from '../../src/plugins/claude/application/runtime.ts';
import { EventBus } from '../../src/application/plugins/events.ts';
import { claudeEvents } from '../../src/plugins/claude/application/events.ts';
import { AppError } from '../../src/domain/shared/errors.ts';
import { NodeEventScope } from '../../src/infrastructure/plugins/event-scope.ts';

const scope = { cwd: '/vault/selected', dryRun: false };
const successful = { exitCode: 0, stdout: '{"outcome":"ok"}', stderr: '' };
function setup(dryRun = false, result: ClaudeRuntimeResult = successful) {
  const events = new EventBus(new NodeEventScope());
  events.defineAll(claudeEvents);
  const run = vi.fn(async () => result), runtime = vi.fn(() => ({ run }));
  return { events, run, runtime, service: new ClaudeLifecycle(runtime, { ...scope, dryRun }, events, () => events.nextOperationId()) };
}

describe('Claude host lifecycle notifications', () => {
  it('surrounds native execution with correlated phases without exposing invocation or output secrets', async () => {
    const { events, run, service } = setup(false, { exitCode: 0, stdout: 'private native stdout', stderr: 'private native stderr' });
    const operation = { operationId: 1, executable: '/tools/claude', ...scope };
    run.mockImplementationOnce(async () => {
      expect(events.history).toEqual([{ id: 'claude.started', payload: operation }]);
      return { exitCode: 0, stdout: 'private native stdout', stderr: 'private native stderr' };
    });
    await service.execute({ executable: '/tools/claude', args: ['--config', 'private argument'], stdin: 'private input' });
    expect(events.history).toEqual([
      { id: 'claude.started', payload: operation },
      { id: 'claude.executed', payload: { executable: '/tools/claude', cwd: scope.cwd, exitCode: 0 } },
      { id: 'claude.succeeded', payload: { ...operation, exitCode: 0 } },
    ]);
    expect(JSON.stringify(events.history)).not.toContain('private');
  });

  it('reports successful previews without constructing a process or publishing an executed event', async () => {
    const { service, runtime, events } = setup(true);
    await expect(service.execute({ args: ['plugin', 'install', 'team'], stdin: 'secret' })).resolves.toMatchObject({ dryRun: true, executed: false });
    const operation = { operationId: 1, executable: 'claude', cwd: scope.cwd, dryRun: true };
    expect(events.history).toEqual([{ id: 'claude.started', payload: operation }, { id: 'claude.succeeded', payload: operation }]);
    expect(runtime).not.toHaveBeenCalled();
  });

  it.each([
    { request: null, code: 'INVALID_CLAUDE_ARGUMENT', executable: 'claude' },
    { request: { args: [], executable: '\0private' }, code: 'INVALID_CLAUDE_EXECUTABLE', executable: '<invalid>' },
    { request: { args: [], timeoutMs: 0 }, code: 'INVALID_CLAUDE_TIMEOUT', executable: 'claude' },
  ])('reports validation failure $code during previews', async ({ request, code, executable }) => {
    const { service, runtime, events } = setup(true);
    await expect(service.execute(request as unknown as ClaudeLifecycleRequest)).rejects.toMatchObject({ code });
    const operation = { operationId: 1, executable, cwd: scope.cwd, dryRun: true };
    expect(events.history).toEqual([
      { id: 'claude.started', payload: operation },
      { id: 'claude.failed', payload: { ...operation, error: { code, exitCode: 2 } } },
    ]);
    expect(runtime).not.toHaveBeenCalled();
    expect(JSON.stringify(events.history)).not.toContain('private');
  });

  it('preserves native nonzero exit evidence and distinguishes it from the application exit code', async () => {
    const { service, events } = setup(false, { exitCode: 7, stdout: '{"outcome":"failed"}', stderr: 'private native diagnostic' });
    await expect(service.execute({ args: ['plugin', 'install'], output: 'json' })).rejects.toMatchObject({ code: 'CLAUDE_RUNTIME_FAILED', details: { exitCode: 7, result: { outcome: 'failed' } } });
    expect(events.history.map(event => event.id)).toEqual(['claude.started', 'claude.executed', 'claude.failed']);
    expect(events.history[2]?.payload).toEqual({ operationId: 1, executable: 'claude', ...scope, exitCode: 7, error: { code: 'CLAUDE_RUNTIME_FAILED', exitCode: 1 } });
    expect(JSON.stringify(events.history)).not.toContain('private');
  });

  it('records a successful process exit even when requested structured output is malformed', async () => {
    const { service, events } = setup(false, { exitCode: 0, stdout: 'private non-JSON output', stderr: '' });
    await expect(service.execute({ args: ['plugin', 'list'], output: 'json' })).rejects.toMatchObject({ code: 'CLAUDE_INVALID_OUTPUT' });
    expect(events.history.map(event => event.id)).toEqual(['claude.started', 'claude.executed', 'claude.failed']);
    expect(events.history[2]?.payload).toMatchObject({ exitCode: 0, error: { code: 'CLAUDE_INVALID_OUTPUT', exitCode: 1 } });
    expect(JSON.stringify(events.history)).not.toContain('private');
  });

  it.each(['adapter', 'process'] as const)('keeps the original %s failure and excludes its message and details', async failureAt => {
    const { service, runtime, run, events } = setup();
    const error = new AppError('CLAUDE_NOT_INSTALLED', 'private diagnostic', 1, { stdout: 'private output', stdin: 'private input' });
    if (failureAt === 'adapter') runtime.mockImplementationOnce(() => { throw error; });
    else run.mockRejectedValueOnce(error);
    await expect(service.execute({ args: ['--version'] })).rejects.toBe(error);
    expect(events.history.map(event => event.id)).toEqual(['claude.started', 'claude.failed']);
    expect(events.history[1]?.payload).toEqual({ operationId: 1, executable: 'claude', ...scope, error: { code: 'CLAUDE_NOT_INSTALLED', exitCode: 1 } });
    expect(JSON.stringify(events.history)).not.toContain('private');
  });

  it('does not let phase observers replace results or primary failures', async () => {
    const { service, events, run } = setup();
    for (const id of ['claude.started', 'claude.executed', 'claude.succeeded', 'claude.failed']) {
      events.on(id, () => { throw new Error('observer failure'); });
    }
    await expect(service.execute({ args: ['--version'] })).resolves.toMatchObject({ executed: true });
    const primary = new Error('private primary failure');
    run.mockRejectedValueOnce(primary);
    await expect(service.execute({ args: ['--version'] })).rejects.toBe(primary);
    expect(events.history.at(-1)?.payload).toMatchObject({ operationId: 2, error: { code: 'OPERATION_FAILED', exitCode: 1 } });
    expect(events.warnings).toHaveLength(5);
    expect(JSON.stringify(events.history)).not.toContain('private');
  });

  it('correlates concurrent completions using invocation-wide operation ids', async () => {
    const events = new EventBus(new NodeEventScope());
    events.defineAll(claudeEvents);
    expect(events.nextOperationId()).toBe(1);
    let finishFirst!: (result: ClaudeRuntimeResult) => void;
    const pending = new Promise<ClaudeRuntimeResult>(resolve => { finishFirst = resolve; });
    const service = new ClaudeLifecycle(() => ({ run: async args => args[0] === 'first' ? pending : successful }), scope, events, () => events.nextOperationId());
    const first = service.execute({ args: ['first'] });
    await service.execute({ args: ['second'] });
    finishFirst(successful);
    await first;
    expect(events.history.filter(event => event.id !== 'claude.executed')).toEqual([
      { id: 'claude.started', payload: { operationId: 2, executable: 'claude', ...scope } },
      { id: 'claude.started', payload: { operationId: 3, executable: 'claude', ...scope } },
      { id: 'claude.succeeded', payload: { operationId: 3, executable: 'claude', ...scope, exitCode: 0 } },
      { id: 'claude.succeeded', payload: { operationId: 2, executable: 'claude', ...scope, exitCode: 0 } },
    ]);
  });

  it('supports isolated clients with no registered host notifications', async () => {
    const events = new EventBus(new NodeEventScope());
    const service = new ClaudeLifecycle(() => ({ run: async () => successful }), scope, events, () => events.nextOperationId());
    await expect(service.execute({ args: ['--version'] })).resolves.toMatchObject({ executed: true });
    expect(events.history).toEqual([]);
    expect(events.warnings).toEqual([]);
  });

  it('detaches request fields and arrays before awaited start observers permit caller mutation', async () => {
    const { service, events, run, runtime } = setup();
    let release!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => {
      events.on('claude.started', async () => { resolve(); await blocked; });
    });
    const args = ['plugin', 'install', 'team', 'secret'], sensitiveArgs = [3];
    const request: ClaudeLifecycleRequest = { executable: '/tools/original', args, sensitiveArgs, stdin: 'original input', output: 'json', timeoutMs: 1000 };
    const pending = service.execute(request);
    await started;
    args[0] = 'mutated'; sensitiveArgs[0] = 0;
    request.args = ['replacement']; request.stdin = 'changed input'; request.executable = '/tools/changed';
    request.output = 'text'; request.timeoutMs = 5;
    release();
    await expect(pending).resolves.toMatchObject({ args: ['plugin', 'install', 'team', '<redacted>'], result: { outcome: 'ok' } });
    expect(runtime).toHaveBeenCalledWith('/tools/original');
    expect(run).toHaveBeenCalledWith(['plugin', 'install', 'team', 'secret'], { cwd: scope.cwd, stdin: 'original input', timeoutMs: 1000 });
    expect(events.history[0]?.payload).toMatchObject({ executable: '/tools/original' });
  });

  it('reports request snapshot failures with safe metadata and preserves the original error', async () => {
    const { service, events, runtime } = setup();
    const primary = new AppError('SNAPSHOT_BROKEN', 'private getter diagnostic', 23);
    const request = { get args(): string[] { throw primary; } };
    await expect(service.execute(request)).rejects.toBe(primary);
    const operation = { operationId: 1, executable: 'claude', ...scope };
    expect(events.history).toEqual([
      { id: 'claude.started', payload: operation },
      { id: 'claude.failed', payload: { ...operation, error: { code: 'SNAPSHOT_BROKEN', exitCode: 23 } } },
    ]);
    expect(runtime).not.toHaveBeenCalled();
  });
});
