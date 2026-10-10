import { describe, expect, it } from 'vitest';
import { EventBus } from '../../src/application/plugins/events.ts';
import { NodeEventScope } from '../../src/infrastructure/plugins/event-scope.ts';
import { hostEventNamespaces, publishHostEvent, registerHostEvents, type HostEventMap } from '../../src/application/plugins/host-events.ts';

const command = { operationId: 1, command: 'write', root: '/vault', workspaceRoot: '/workspace', dryRun: false };
const workspace = { operationId: 2, operation: 'write' as const, root: '/vault', paths: ['note.md'], dryRun: false };
const claude = { operationId: 3, executable: 'claude', cwd: '/vault', dryRun: false };
const plugin = { pluginId: 'quality' };
const error = { code: 'TEST_FAILURE', exitCode: 2 };
const change = { path: 'note.md', revision: 'abc', bytes: 5 };
const file = { ...change, kind: 'file' as const };
const samples: HostEventMap = {
  'command.started': command, 'command.succeeded': command, 'command.failed': { ...command, error },
  'operation.started': workspace, 'operation.succeeded': { ...workspace, changes: [{ ...change, operation: 'created' }], bytes: 5 }, 'operation.failed': { ...workspace, error },
  'claude.started': claude, 'claude.succeeded': { ...claude, exitCode: 0 }, 'claude.failed': { ...claude, error, exitCode: 2 },
  'claude.executed': { executable: 'claude', cwd: '/vault', exitCode: 2 },
  'vault.create': { ...file, operation: 'created' }, 'vault.modify': { ...file, operation: 'updated' }, 'vault.delete': { ...file, operation: 'deleted' },
  'vault.rename': { path: 'new.md', oldPath: 'old.md', kind: 'file', revision: 'abc' },
  'metadataCache.changed': { path: 'note.md', cache: { links: [], frontmatter: { status: 'draft' } } }, 'metadataCache.deleted': { path: 'note.md', prevCache: null },
  'metadataCache.resolve': { path: 'note.md' }, 'metadataCache.resolved': {},
  'workspace.file-open': { path: 'note.md' }, 'workspace.quick-preview': { path: 'note.md', operation: 'updated', bytes: 5 },
  'workspace.layout-ready': {}, 'workspace.quit': {}, 'workspace.project-change': { from: null, to: 'alpha' },
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
    expect(bus.history).toHaveLength(30);
  });

  it('rejects malformed host payloads and does not deliver or record them', async () => {
    const bus = create(); registerHostEvents(bus);
    for (const [id, payload] of [
      ['command.started', { ...command, operationId: 0 }],
      ['command.failed', { ...command, error: { code: 'MISSING_STATUS' } }],
      ['operation.started', { ...workspace, operation: 'erase' }],
      ['operation.succeeded', { ...workspace, changes: [{ ...change, operation: 'updated', bytes: -1 }] }],
      ['claude.started', { ...claude, dryRun: 'yes' }],
      ['claude.failed', { ...claude, error, exitCode: null }],
      ['claude.executed', { executable: 'claude', cwd: '/vault', exitCode: 1.5 }],
      ['vault.create', { ...file, operation: 'deleted' }],
      ['vault.create', { ...change, operation: 'created' }],
      ['vault.create', { path: 'folder', kind: 'folder', operation: 'created', bytes: 0 }],
      ['vault.modify', { path: 'folder', kind: 'folder', operation: 'updated' }],
      ['vault.delete', { ...file, operation: 'deleted', extra: true }],
      ['vault.rename', { path: 'same.md', oldPath: 'same.md', kind: 'file' }],
      ['vault.rename', { path: 'new', oldPath: 'old', kind: 'folder', revision: 'abc' }],
      ['metadataCache.changed', { path: 'note.md', cache: [] }],
      ['metadataCache.deleted', { path: 'note.md' }],
      ['metadataCache.resolved', { path: 'note.md' }],
      ['workspace.file-open', { path: '' }],
      ['workspace.quick-preview', { path: 'note.md', operation: 'updated', bytes: 5, diff: 'x' }],
      ['workspace.quit', { tasks: [] }],
      ['workspace.project-change', { from: 'alpha', to: 'alpha' }],
      ['plugin.registered', { pluginId: 1 }],
      ['plugin.unload-failed', plugin],
    ] as const) await expect(bus.emit(id, payload)).rejects.toMatchObject({ code: 'INVALID_EVENT_PAYLOAD' });
    expect(bus.history).toEqual([]);
  });

  it('accepts folder records without file metadata and keeps every host event in a host namespace', async () => {
    const bus = create(); registerHostEvents(bus);
    await bus.emit('vault.create', { path: 'notes', kind: 'folder', operation: 'created' });
    await bus.emit('vault.delete', { path: 'notes', kind: 'folder', operation: 'deleted' });
    await bus.emit('vault.rename', { path: 'archive', oldPath: 'notes', kind: 'folder' });
    expect(bus.history.map(record => record.id)).toEqual(['vault.create', 'vault.delete', 'vault.rename']);
    expect(bus.ids().every(id => (hostEventNamespaces as readonly string[]).includes(id.split('.')[0]!))).toBe(true);
  });

  it('keeps catalog registration atomic on collisions', () => {
    const bus = create();
    bus.define({ id: 'vault.modify', validate: (_value): _value is unknown => true });
    expect(() => registerHostEvents(bus)).toThrowError(expect.objectContaining({ code: 'DUPLICATE_EVENT' }));
    expect(bus.ids()).toEqual(['vault.modify']);
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
