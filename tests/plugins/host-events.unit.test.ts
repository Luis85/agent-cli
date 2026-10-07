import { describe, expect, it } from 'vitest';
import { EventBus } from '../../src/the-forge/application/plugins/events.ts';
import { NodeEventScope } from '../../src/the-forge/infrastructure/plugins/event-scope.ts';
import { publishHostEvent, registerHostEvents, type HostEventMap } from '../../src/the-forge/application/plugins/host-events.ts';

const command = { operationId: 1, command: 'write', root: '/vault', workspaceRoot: '/workspace', dryRun: false };
const workspace = { operationId: 2, operation: 'write' as const, root: '/vault', paths: ['note.md'], dryRun: false };
const claude = { operationId: 3, executable: 'claude', cwd: '/vault', dryRun: false };
const plugin = { pluginId: 'quality' };
const error = { code: 'TEST_FAILURE', exitCode: 2 };
const change = { path: 'note.md', revision: 'abc', bytes: 5 };
const samples: HostEventMap = {
  'command.started': command, 'command.succeeded': command, 'command.failed': { ...command, error },
  'workspace.started': workspace, 'workspace.succeeded': { ...workspace, changes: [{ ...change, operation: 'created' }], bytes: 5 }, 'workspace.failed': { ...workspace, error },
  'claude.started': claude, 'claude.succeeded': { ...claude, exitCode: 0 }, 'claude.failed': { ...claude, error, exitCode: 2 },
  'claude.executed': { executable: 'claude', cwd: '/vault', exitCode: 2 },
  'file.created': { ...change, operation: 'created' }, 'file.updated': { ...change, operation: 'updated' }, 'file.deleted': { ...change, operation: 'deleted' },
  'plugin.registered': plugin, 'plugin.activating': plugin, 'plugin.activated': plugin, 'plugin.activation-failed': { ...plugin, error },
  'plugin.unloading': plugin, 'plugin.unloaded': plugin, 'plugin.unload-failed': { ...plugin, error },
};
const create = () => new EventBus(new NodeEventScope());

describe('typed host process catalog', () => {
  it('defines every host phase with a description and accepts its published payload contract', async () => {
    const bus = create(); registerHostEvents(bus);
    expect(bus.ids()).toEqual(Object.keys(samples).sort());
    expect(bus.catalog().every(entry => Boolean(entry.description))).toBe(true);
    for (const [id, payload] of Object.entries(samples)) await bus.emit(id, payload);
    expect(bus.history).toHaveLength(20);
  });

  it('rejects malformed host payloads and does not deliver or record them', async () => {
    const bus = create(); registerHostEvents(bus);
    for (const [id, payload] of [
      ['command.started', { ...command, operationId: 0 }],
      ['command.failed', { ...command, error: { code: 'MISSING_STATUS' } }],
      ['workspace.started', { ...workspace, operation: 'erase' }],
      ['workspace.succeeded', { ...workspace, changes: [{ ...change, operation: 'updated', bytes: -1 }] }],
      ['claude.started', { ...claude, dryRun: 'yes' }],
      ['claude.failed', { ...claude, error, exitCode: null }],
      ['claude.executed', { executable: 'claude', cwd: '/vault', exitCode: 1.5 }],
      ['file.created', { ...change, operation: 'deleted' }],
      ['plugin.registered', { pluginId: 1 }],
      ['plugin.unload-failed', plugin],
    ] as const) await expect(bus.emit(id, payload)).rejects.toMatchObject({ code: 'INVALID_EVENT_PAYLOAD' });
    expect(bus.history).toEqual([]);
  });

  it('keeps catalog registration atomic on collisions', () => {
    const bus = create();
    bus.define({ id: 'file.updated', validate: (_value): _value is unknown => true });
    expect(() => registerHostEvents(bus)).toThrowError(expect.objectContaining({ code: 'DUPLICATE_EVENT' }));
    expect(bus.ids()).toEqual(['file.updated']);
  });

  it('lets service fixtures omit unobserved phases and treats notification failures as warnings', async () => {
    const bus = create();
    await publishHostEvent(bus, 'command.started', command);
    expect(bus.history).toEqual([]);
    bus.define({ id: 'command.started', validate: (_value): _value is never => false });
    await expect(publishHostEvent(bus, 'command.started', command)).resolves.toBeUndefined();
    expect(bus.warnings).toEqual([expect.stringContaining('Host notification command.started')]);
  });

  it('preserves the host result even when a custom diagnostic sink rejects the warning', async () => {
    const bus = create();
    bus.define({ id: 'command.started', validate: (_value): _value is never => false });
    bus.warn = () => { throw new Error('Diagnostic sink unavailable'); };
    await expect(publishHostEvent(bus, 'command.started', command)).resolves.toBeUndefined();
  });
});
