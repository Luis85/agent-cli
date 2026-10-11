import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { backlogVault } from '../support/backlog.ts';
import { FakeAzureDevOps } from '../support/azure-devops.ts';
import { TOKEN_ENV, azureConnection, invocation, planningNotes } from '../support/connectors.ts';
import { hostIdentity } from '../../src/infrastructure/workspace/lock.ts';

/** The per-connection sync lock: recovery after a crash, one lock per connection across scopes, and interruption. */
const PAT = 'pat-sync-lock-0123456789';
const env = { [TOKEN_ENV]: PAT };
const LOCK = '.forge/sync/contoso.lock';
let fake: FakeAzureDevOps;
let vault: Awaited<ReturnType<typeof backlogVault>> | undefined;
beforeAll(async () => { fake = await new FakeAzureDevOps(PAT, { contoso: 'Trailhead' }).start(); });
afterAll(async () => { await fake.close(); });
afterEach(async () => { fake.afterWrite = null; await vault?.dispose(); vault = undefined; });

const connections = () => ({ contoso: azureConnection(fake, 'contoso', 'Trailhead') });
const holder = async (fields: Record<string, unknown>) => JSON.stringify({ hostname: hostname(), startedAt: '2026-10-10T08:00:00.000Z', command: 'backlog sync', ...(await hostIdentity()), token: 'crashed', ...fields });
const sync = async (options: { project?: string } = {}) => {
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
});
