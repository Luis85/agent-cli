import { describe, expect, it, vi } from 'vitest';
import { ClaudeLifecycle, type ClaudeLifecycleRequest } from '../../src/application/claude-lifecycle.ts';
import { EventBus } from '../../src/application/events.ts';
import { NodeEventScope } from '../../src/infrastructure/event-scope.ts';

function setup(dryRun = false, result = { exitCode: 0, stdout: '{"outcome":"ok"}', stderr: '' }) {
  const events = new EventBus(new NodeEventScope());
  events.define({ id: 'claude.executed', validate: (value): value is object => value !== null && typeof value === 'object' });
  const run = vi.fn(async () => result), runtime = vi.fn(() => ({ run }));
  return { service: new ClaudeLifecycle(runtime, { cwd: '/vault/selected', dryRun }, events), events, runtime, run };
}

describe('shared Claude lifecycle service', () => {
  it('validates and redacts preview data without constructing a runtime', async () => {
    const { service, runtime, events } = setup(true);
    const preview = await service.execute({ args: ['plugin', 'install', 'team', '--config', 'token=private', '--custom', 'hidden'], sensitiveArgs: [6], stdin: 'secret input' });
    expect(preview).toEqual({ dryRun: true, executed: false, plan: { executable: 'claude', args: ['plugin', 'install', 'team', '--config', '<redacted>', '--custom', '<redacted>'], cwd: '/vault/selected', inputBytes: 12 } });
    expect(runtime).not.toHaveBeenCalled();
    expect(events.history).toEqual([]);
  });

  it.each([
    { executable: '' }, { executable: '\0bad' }, { timeoutMs: 0 }, { timeoutMs: 3600001 },
    { args: ['bad\0arg'] }, { sensitiveArgs: [-1] }, { output: 'guess' }, { stdin: 'x'.repeat(1024 * 1024 + 1) },
  ])('rejects unusable plans even during dry runs: %j', async invalid => {
    const { service, runtime } = setup(true);
    await expect(service.execute({ args: ['--version'], ...invalid } as ClaudeLifecycleRequest)).rejects.toMatchObject({ code: expect.stringMatching(/^INVALID_CLAUDE_/) });
    expect(runtime).not.toHaveBeenCalled();
  });

  it('executes untouched values in the host scope but returns redacted invocation metadata', async () => {
    const { service, run, events } = setup();
    const result = await service.execute({ executable: '/tools/claude', args: ['plugin', 'install', 'team', '--config=token=private'], stdin: 'secret', output: 'json', timeoutMs: 1000 });
    expect(run).toHaveBeenCalledWith(['plugin', 'install', 'team', '--config=token=private'], { cwd: '/vault/selected', stdin: 'secret', timeoutMs: 1000 });
    expect(result).toMatchObject({ executed: true, args: ['plugin', 'install', 'team', '<redacted>'], result: { outcome: 'ok' } });
    expect(JSON.stringify(result)).not.toContain('private');
    expect(JSON.stringify(result)).not.toContain('secret');
    expect(events.history).toEqual([{ id: 'claude.executed', payload: { executable: '/tools/claude', cwd: '/vault/selected', exitCode: 0 } }]);
  });

  it('preserves structured failed install challenges and native exit status', async () => {
    const outcome = { outcome: 'failed', shownCommand: { sha256: 'a'.repeat(64) } };
    const { service, events } = setup(false, { exitCode: 1, stdout: 'Displayed command\n' + JSON.stringify(outcome), stderr: 'Acceptance required' });
    await expect(service.execute({ args: ['plugin', 'install', 'team', '--json'], output: 'json-last-line' })).rejects.toMatchObject({
      code: 'CLAUDE_RUNTIME_FAILED', details: { exitCode: 1, result: outcome, stderr: 'Acceptance required' },
    });
    expect(events.history[0]?.payload).toMatchObject({ exitCode: 1 });
  });

  it('preserves non-JSON native failure diagnostics without inventing a result', async () => {
    const { service } = setup(false, { exitCode: 2, stdout: '', stderr: 'Unsupported option' });
    await expect(service.execute({ args: ['plugin', 'validate'], output: 'json' })).rejects.toMatchObject({ code: 'CLAUDE_RUNTIME_FAILED', details: { exitCode: 2, stderr: 'Unsupported option' } });
  });

  it('distinguishes malformed JSON after a successful native exit from command failure', async () => {
    const { service, events } = setup(false, { exitCode: 0, stdout: 'Native changed output', stderr: '' });
    await expect(service.execute({ args: ['plugin', 'list', '--json'], output: 'json' })).rejects.toMatchObject({ code: 'CLAUDE_INVALID_OUTPUT', details: { exitCode: 0, stdout: 'Native changed output' } });
    expect(events.history).toHaveLength(1);
  });

  it('does not mistake arbitrary text output for a structured operation result', async () => {
    const { service } = setup();
    const result = await service.execute({ args: ['doctor'], output: 'text' });
    expect(result).not.toHaveProperty('result');
  });

  it('keeps native results when post-execution observers fail', async () => {
    const { service, events } = setup();
    events.on('claude.executed', () => { throw new Error('observer failed'); });
    await expect(service.execute({ args: ['plugin', 'list'], output: 'json' })).resolves.toMatchObject({ executed: true, result: { outcome: 'ok' } });
    expect(events.warnings).toContain('Listener claude.executed: observer failed');
  });
});
