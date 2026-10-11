import { expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { portableCli } from '../support/portable-cli.ts';
import { hostIdentity } from '../../src/infrastructure/workspace/lock.ts';

const fixture = portableCli();
const cli = fixture.cli;

it('reports a stale writer lock with its holder and leaves the lock for an explicit recovery', async () => {
  const pid = spawnSync(process.execPath, ['-e', '']).pid!;
  // Stale diagnosis compares the pid namespace and boot the lock records with this host's.
  const holder = JSON.stringify({ pid, hostname: hostname(), startedAt: '2026-10-10T08:00:00.000Z', command: 'create', operationId: 1, forgeVersion: '0.1.0', ...(await hostIdentity()) });
  const lock = join(fixture.project, '.agent-cli.lock');
  await writeFile(lock, holder);
  const busy = cli(['create', 'note.md', '--content', '# Note']);
  expect(busy.status).toBe(4);
  expect(busy.body).toMatchObject({ ok: false, error: { code: 'WORKSPACE_BUSY', details: { stale: 'likely', lock: { pid, hostname: hostname(), command: 'create', operationId: 1 } } } });
  expect(busy.body.error.message).toContain('never removes the lock automatically');
  const german = cli(['create', 'note.md', '--content', '# Note', '--lang', 'de']);
  expect(german.status).toBe(4);
  expect(german.body.error).toMatchObject({ code: 'WORKSPACE_BUSY', message: expect.stringContaining('nie automatisch'), details: { stale: 'likely', lock: { pid } } });
  expect(await readFile(lock, 'utf8')).toBe(holder);
  expect(await readdir(fixture.project)).not.toContain('note.md');

  await rm(lock);
  const created = cli(['create', 'note.md', '--content', '# Note']);
  expect(created.status).toBe(0);
  expect((await readdir(fixture.project)).filter(name => name.startsWith('.agent-cli'))).toEqual([]);
});
