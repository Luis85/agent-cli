import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { backlogVault } from '../support/backlog.ts';
import { FakeAzureDevOps } from '../support/azure-devops.ts';
import { TOKEN_ENV, azureConnection, boundBase, invocation, noteText, planningNotes } from '../support/connectors.ts';
import { hostIdentity } from '../../src/infrastructure/workspace/lock.ts';

/** The per-connection sync lock: recovery after a crash, one lock per connection across scopes, and interruption. */
const PAT = 'pat-sync-lock-0123456789';
const env = { [TOKEN_ENV]: PAT };
const LOCK = '.forge/sync/contoso.lock';
let fake: FakeAzureDevOps;
let vault: Awaited<ReturnType<typeof backlogVault>> | undefined;
beforeAll(async () => { fake = await new FakeAzureDevOps(PAT, { contoso: 'Trailhead' }).start(); });
afterAll(async () => { await fake.close(); });
afterEach(async () => { fake.afterWrite = null; fake.beforeWrite = null; await vault?.dispose(); vault = undefined; });

const connections = () => ({ contoso: azureConnection(fake, 'contoso', 'Trailhead') });
const holder = async (fields: Record<string, unknown>) => JSON.stringify({ hostname: hostname(), startedAt: '2026-10-10T08:00:00.000Z', command: 'backlog sync', ...(await hostIdentity()), token: 'crashed', ...fields });
const sync = async (options: { project?: string; language?: 'en' | 'de' } = {}) => {
  const session = await invocation(vault!.root, connections(), { env, ...options });
  const result = await session.run('backlog', ['sync']).catch((error: unknown) => ({ error }));
  return { ...result, warnings: session.events.warnings };
};

describe('the backlog sync lock', () => {
  it('recovers the lock of a sync that was killed and reports it', async () => {
    vault = await backlogVault(planningNotes());
    const pid = spawnSync(process.execPath, ['-e', '']).pid!;
    await vault.write(LOCK, await holder({ pid }));
    const result = await sync();
    expect(result).toMatchObject({ data: { counts: { created: 3, failed: 0 } } });
    expect(result.warnings).toEqual([expect.stringMatching(new RegExp(`Removed the stale lock \\.forge/sync/contoso\\.lock of pid ${pid} .*command backlog sync`))]);
    expect(existsSync(join(vault.root, LOCK))).toBe(false);
  });

  it('refuses while a live sync holds the lock, asking for a retry', async () => {
    vault = await backlogVault(planningNotes());
    await vault.write(LOCK, await holder({ pid: process.ppid }));
    const writes = fake.writes().length;
    const result = await sync();
    expect(result).toMatchObject({ error: { code: 'WORKSPACE_BUSY', retryable: true, details: { stale: 'active', path: LOCK } } });
    expect(fake.writes().length).toBe(writes);
  });

  it('leaves a lock another sync took over in place, with a warning in the response language', async () => {
    for (const language of ['en', 'de'] as const) {
      vault = await backlogVault(planningNotes());
      // Another sync replaces the lock while this one runs, so its token is gone at release time.
      fake.afterWrite = () => { fake.afterWrite = null; writeFileSync(join(vault!.root, LOCK), '{"token":"someone-else"}'); };
      const result = await sync({ language });
      expect(result.warnings).toEqual([language === 'en'
        ? 'The backlog sync lock .forge/sync/contoso.lock no longer carried this run\'s token and was left in place; inspect .forge/sync for concurrent syncs.'
        : 'Die Sperre .forge/sync/contoso.lock von backlog sync trug nicht mehr das Token dieses Laufs und wurde nicht entfernt; prüfen Sie .forge/sync auf gleichzeitige Synchronisierungen.']);
      expect(await vault.read(LOCK)).toBe('{"token":"someone-else"}');
      await vault.dispose();
      vault = undefined;
    }
  });

  it('keeps project-scope and workspace-scope syncs of one connection apart: the lock lives at the workspace root', async () => {
    vault = await backlogVault(Object.fromEntries(Object.entries(planningNotes()).map(([path, content]) => [`projects/alpha/${path}`, content])));
    await vault.write(LOCK, await holder({ pid: process.ppid }));
    const result = await sync({ project: 'projects/alpha' });
    expect(result).toMatchObject({ error: { code: 'WORKSPACE_BUSY', details: { path: LOCK } } });
    expect(existsSync(join(vault.root, 'projects/alpha', LOCK))).toBe(false);
  });

  it('stops at the next safe point on SIGINT, records what it created and releases the lock', async () => {
    vault = await backlogVault(planningNotes());
    const before = fake.list('contoso').length, listeners = process.listenerCount('SIGINT');
    fake.afterWrite = (_item, operation) => { if (operation === 'create') process.emit('SIGINT'); };
    const interrupted = await sync();
    expect(interrupted).toMatchObject({ error: { code: 'SYNC_INTERRUPTED', exitCode: 130, details: { signal: 'SIGINT' } } });
    expect(fake.list('contoso').length).toBe(before + 1);
    expect(existsSync(join(vault.root, LOCK))).toBe(false);
    expect(process.listenerCount('SIGINT')).toBe(listeners);
    fake.afterWrite = null;
    const resumed = await sync();
    expect(resumed).toMatchObject({ data: { counts: { created: 2, failed: 0 } } });
    expect(fake.list('contoso').length).toBe(before + 3);
  });

  it('stops on SIGTERM with exit 143, writes no note and releases the lock', async () => {
    vault = await backlogVault(planningNotes());
    const notes = await Promise.all(['work/Trip planning.md', 'work/Itinerary builder.md', 'work/Draft a trip.md'].map(path => vault!.read(path)));
    const listeners = process.listenerCount('SIGTERM');
    fake.afterWrite = (_item, operation) => { if (operation === 'create') process.emit('SIGTERM'); };
    const interrupted = await sync();
    expect(interrupted).toMatchObject({ error: { code: 'SYNC_INTERRUPTED', exitCode: 143, details: { signal: 'SIGTERM' } } });
    expect(await Promise.all(['work/Trip planning.md', 'work/Itinerary builder.md', 'work/Draft a trip.md'].map(path => vault!.read(path)))).toEqual(notes);
    expect(existsSync(join(vault.root, LOCK))).toBe(false);
    expect(process.listenerCount('SIGTERM')).toBe(listeners);
  });

  it('stops between link updates on a signal, and the next sync finishes the links without creating items again', async () => {
    const base = boundBase('plan', 'Plan', 'contoso').replace('    connection: contoso\n', '    dependsOnProperty: note.dependsOn\n    connection: contoso\n');
    vault = await backlogVault({
      'plan/Plan.base': base,
      'plan/Pack.md': noteText({ type: 'PBI', order: 1000, dependsOn: ['[[Book flights]]'] }),
      'plan/Book flights.md': noteText({ type: 'PBI', order: 2000, dependsOn: ['[[Pick dates]]'] }),
      'plan/Pick dates.md': noteText({ type: 'PBI', order: 3000 }),
    });
    const before = fake.list('contoso').length;
    fake.beforeWrite = (operation, operations) => { if (operation === 'update' && operations.some(entry => entry.path === '/relations/-')) { fake.beforeWrite = null; process.emit('SIGINT'); } };
    const interrupted = await sync();
    expect(interrupted).toMatchObject({ error: { code: 'SYNC_INTERRUPTED', details: { signal: 'SIGINT' } } });
    expect(existsSync(join(vault.root, LOCK))).toBe(false);
    const state = JSON.parse(await vault.read('.forge/sync/contoso.json')) as { items: Record<string, { id: string }> };
    expect(Object.keys(state.items).sort()).toEqual(['plan/Book flights.md', 'plan/Pack.md', 'plan/Pick dates.md']);
    // The first link update landed; the second waits for the next sync.
    const [pack, flights, dates] = ['plan/Pack.md', 'plan/Book flights.md', 'plan/Pick dates.md'].map(path => Number(state.items[path]!.id));
    expect([fake.predecessors('contoso', pack!), fake.predecessors('contoso', flights!)]).toEqual([[flights], []]);
    const resumed = await sync();
    expect(resumed).toMatchObject({ data: { counts: { created: 0, conflicts: 0, failed: 0 } } });
    expect(fake.list('contoso').length).toBe(before + 3);
    expect(fake.predecessors('contoso', flights!)).toEqual([dates]);
    expect(await vault.read('plan/Pack.md')).toContain('azure-devops:');
  });

  it('runs project-scope writes under the writer lock at the workspace root, as production composes them', async () => {
    vault = await backlogVault(Object.fromEntries(Object.entries(planningNotes()).map(([path, content]) => [`projects/alpha/${path}`, content])));
    await vault.write('.agent-cli.lock', await holder({ pid: process.ppid, command: 'write' }));
    const result = await sync({ project: 'projects/alpha' });
    expect(result).toMatchObject({ error: { code: 'WORKSPACE_BUSY', details: { stale: 'active', path: '.agent-cli.lock' } } });
    expect(existsSync(join(vault.root, 'projects/alpha/.agent-cli.lock'))).toBe(false);
  });
});
