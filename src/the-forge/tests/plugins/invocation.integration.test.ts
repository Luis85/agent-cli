import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { invokeCommand } from '../../src/application/plugins/invocation.ts';
import { EventBus } from '../../src/application/plugins/events.ts';
import { registerHostEvents } from '../../src/application/plugins/host-events.ts';
import { Workspace } from '../../src/application/workspace/workspace.ts';
import { NodeEventScope } from '../../src/infrastructure/plugins/event-scope.ts';
import { NodeFiles } from '../../src/infrastructure/workspace/files.ts';
import { ObsidianDocuments, encodeText } from '../../src/infrastructure/documents/codec.ts';
import { AppError } from '../../src/domain/shared/errors.ts';
import { Localizer } from '../../src/presentation/localization/localization.ts';

let root: string, events: EventBus, workspace: Workspace;
const metadata = () => ({ command: 'sample.run', root, workspaceRoot: root, dryRun: false });
const activate = async () => {};
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'forge-invocation-'));
  events = new EventBus(new NodeEventScope());
  registerHostEvents(events);
  workspace = new Workspace(await NodeFiles.at(root), new ObsidianDocuments(), events, false, root);
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe('command invocation outcomes', () => {
  it('reports activation failure before running the command and preserves the primary error', async () => {
    const failure = new AppError('ACTIVATION_FAILED', 'Private plugin detail', 17);
    const run = vi.fn();
    events.on('command.failed', () => { throw new Error('Observer failed'); });
    await expect(invokeCommand(events, metadata(), async () => { throw failure; }, run)).rejects.toBe(failure);
    expect(run).not.toHaveBeenCalled();
    expect(events.history).toEqual([
      { id: 'command.started', payload: { ...metadata(), operationId: 1 } },
      { id: 'command.failed', payload: { ...metadata(), operationId: 1, error: { code: 'ACTIVATION_FAILED', exitCode: 17 } } },
    ]);
    expect(events.warnings).toEqual(['Listener command.failed: Observer failed']);
  });

  it.each([
    ['BigInt', () => ({ value: 1n })],
    ['cycle', () => { const result: Record<string, unknown> = {}; result.self = result; return result; }],
    ['getter', () => ({ get value() { throw new Error('Secret getter input'); } })],
    ['toJSON', () => ({ toJSON() { throw new Error('Secret serializer input'); } })],
  ] as const)('reports an invalid %s result after preserving committed file evidence', async (_name, result) => {
    await expect(invokeCommand(events, metadata(), activate, async () => {
      await workspace.write([{ path: 'committed.md', bytes: encodeText('Committed private content') }]);
      return result();
    })).rejects.toMatchObject({ code: 'INVALID_RESULT', exitCode: 1 });
    expect(await readFile(join(root, 'committed.md'), 'utf8')).toBe('Committed private content');
    expect(events.history.map(record => record.id)).toEqual([
      'command.started', 'operation.started', 'vault.create', 'operation.succeeded', 'command.failed',
    ]);
    expect(events.history.at(-1)!.payload).toEqual({ ...metadata(), operationId: 1, error: { code: 'INVALID_RESULT', exitCode: 1 } });
    expect(JSON.stringify(events.history)).not.toMatch(/Committed private content|Secret getter input|Secret serializer input/);
  });

  it('takes one result snapshot before success observers can mutate the source', async () => {
    const source = { nested: { value: 'original' } };
    const serialize = vi.fn(() => source);
    const order: string[] = [];
    events.on('command.succeeded', async () => {
      await Promise.resolve();
      source.nested.value = 'observer-mutated';
      order.push('observed');
    });
    const result = await invokeCommand(events, metadata(), activate, () => ({ toJSON: serialize }));
    order.push('returned');
    expect(result).toEqual({ nested: { value: 'original' } });
    expect(serialize).toHaveBeenCalledTimes(1);
    expect(source.nested.value).toBe('observer-mutated');
    expect(order).toEqual(['observed', 'returned']);
    expect(JSON.parse(JSON.stringify(result))).toEqual({ nested: { value: 'original' } });
    expect(serialize).toHaveBeenCalledTimes(1);
  });

  it('includes only command provenance in phase metadata, without raw arguments, flags or results', async () => {
    const args = ['secret-positional'], flags = { token: 'secret-token' };
    await invokeCommand(events, metadata(), activate, () => ({ args, flags, output: 'secret-result' }));
    expect(events.history).toEqual([
      { id: 'command.started', payload: { ...metadata(), operationId: 1 } },
      { id: 'command.succeeded', payload: { ...metadata(), operationId: 1 } },
    ]);
    expect(JSON.stringify(events.history)).not.toContain('secret-');
  });
});

describe('serializable error presentation', () => {
  it.each([
    ['BigInt', () => ({ value: 1n })],
    ['cycle', () => { const details: Record<string, unknown> = {}; details.self = details; return details; }],
  ] as const)('retains the primary code and message when %s details cannot serialize', (_name, details) => {
    const error = new AppError('CUSTOM_FAILURE', 'The original failure', 13, details());
    const result = new Localizer().error(error);
    expect(result).toEqual({ code: 'CUSTOM_FAILURE', message: 'The original failure', details: { diagnostic: 'Error details were not JSON-serializable.' } });
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });

  it('presents a safe diagnostic for an unknown thrown object with a broken toString', () => {
    const thrown = { toString() { throw new Error('Cannot inspect'); } };
    expect(new Localizer().error(thrown)).toEqual({ code: 'OPERATION_FAILED', message: 'Operation failed with an unreadable error.', hint: expect.any(String), retryable: false });
  });
});
