import { expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { portableCli } from '../support/portable-cli.ts';
import { hostIdentity } from '../../src/infrastructure/workspace/lock-holder.ts';

const fixture = portableCli();
const cli = fixture.cli;
const lockFiles = async () => (await readdir(fixture.project)).filter(name => name.startsWith('.agent-cli'));

it('breaks a writer lock whose process no longer runs and reports it in the invocation language', async () => {
  const pid = spawnSync(process.execPath, ['-e', '']).pid!;
  // Stale diagnosis compares the pid namespace and boot the lock records with this host's.
  const holder = JSON.stringify({ pid, hostname: hostname(), startedAt: '2026-10-10T08:00:00.000Z', command: 'create', operationId: 1, forgeVersion: '0.1.0', ...(await hostIdentity()) });
  const lock = join(fixture.project, '.agent-cli.lock');
  await writeFile(lock, holder);
  const english = await cli(['create', 'first.md', '--content', '# Note']);
  expect(english.status).toBe(0);
  expect(english.body.warnings).toEqual([expect.stringContaining(`Removed the stale lock .agent-cli.lock of pid ${pid}`)]);
  expect(await lockFiles()).toEqual([]);

  await writeFile(lock, holder);
  const german = await cli(['create', 'second.md', '--content', '# Note', '--lang', 'de']);
  expect(german.status).toBe(0);
  expect(german.body.warnings).toEqual([expect.stringContaining(`Die verwaiste Sperre .agent-cli.lock von PID ${pid}`)]);
  expect(german.body.warnings[0]).toMatch(/, Befehl create\) wurde entfernt: ihr Prozess läuft nicht mehr\./);
  expect(await lockFiles()).toEqual([]);
});

it('refuses a lock it cannot verify, without a retry, and names the file to delete', async () => {
  const holder = JSON.stringify({ pid: 4242, hostname: `${hostname()}-elsewhere`, startedAt: '2026-10-10T08:00:00.000Z', command: 'create', forgeVersion: '0.1.0' });
  const lock = join(fixture.project, '.agent-cli.lock');
  await writeFile(lock, holder);
  const busy = await cli(['create', 'note.md', '--content', '# Note']);
  expect(busy.status).toBe(4);
  expect(busy.body).toMatchObject({ ok: false, error: { code: 'WORKSPACE_BUSY', retryable: false, details: { stale: 'unknown', path: '.agent-cli.lock', lock: { pid: 4242, command: 'create' } } } });
  expect(busy.body.error.message).toContain('delete .agent-cli.lock');
  const german = await cli(['create', 'note.md', '--content', '# Note', '--lang', 'de']);
  expect(german.body.error).toMatchObject({ code: 'WORKSPACE_BUSY', retryable: false, hint: expect.stringContaining('error.details.path'), details: { stale: 'unknown' } });
  expect(await readFile(lock, 'utf8')).toBe(holder);
  expect(await readdir(fixture.project)).not.toContain('note.md');

  await rm(lock);
  expect((await cli(['create', 'note.md', '--content', '# Note'])).status).toBe(0);
  expect(await lockFiles()).toEqual([]);
});

it('lets concurrent processes contend for a stale lock: one breaks it, every writer runs alone', async () => {
  const pid = spawnSync(process.execPath, ['-e', '']).pid!;
  await writeFile(join(fixture.project, '.agent-cli.lock'), JSON.stringify({ pid, hostname: hostname(), startedAt: '2026-10-10T08:00:00.000Z', command: 'create', ...(await hostIdentity()) }));
  const results = await Promise.all(Array.from({ length: 5 }, (_, index) => fixture.cli(['create', `contender-${index}.md`, '--content', '# Contender'])));
  for (const result of results) if (result.status !== 0) expect(result.body.error).toMatchObject({ code: 'WORKSPACE_BUSY', retryable: true, details: { stale: 'active' } });
  expect(results.some(result => result.status === 0)).toBe(true);
  expect(results.flatMap(result => result.body.warnings ?? []).filter((warning: string) => warning.includes('Removed the stale lock'))).toHaveLength(1);
  expect(await lockFiles()).toEqual([]);
});

it('waits with --wait for a running writer\'s lock and tailors the hint to the lock state', async () => {
  // This test worker runs and is not the CLI process: its lock is held by a running writer.
  const holder = JSON.stringify({ pid: process.pid, hostname: hostname(), startedAt: '2026-10-10T08:00:00.000Z', command: 'write', forgeVersion: '0.1.0', ...(await hostIdentity()) });
  const lock = join(fixture.project, '.agent-cli.lock');
  await writeFile(lock, holder);
  const busy = await cli(['create', 'waiting.md', '--content', '# Note', '--wait', '300']);
  expect(busy.status).toBe(4);
  expect(busy.body.error).toMatchObject({ code: 'WORKSPACE_BUSY', retryable: true, hint: expect.stringContaining('--wait <ms>'), details: { stale: 'active', retryAfterMs: 250, waitedMs: expect.any(Number) } });
  expect(busy.body.error.details.waitedMs).toBeGreaterThanOrEqual(290);
  const german = await cli(['create', 'waiting.md', '--content', '# Note', '--lang', 'de']);
  expect(german.body.error).toMatchObject({ hint: expect.stringContaining('error.details.retryAfterMs Millisekunden'), details: { retryAfterMs: 250 } });
  expect(await readFile(lock, 'utf8')).toBe(holder);

  setTimeout(() => { void rm(lock); }, 300);
  const waited = await cli(['--wait', '20000', 'create', 'waiting.md', '--content', '# Note']);
  expect(waited.status).toBe(0);
  expect(await readFile(join(fixture.project, 'waiting.md'), 'utf8')).toBe('# Note');
  expect(await lockFiles()).toEqual([]);
  expect((await cli(['create', 'other.md', '--wait', 'soon'])).body.error).toMatchObject({ code: 'INVALID_ARGUMENT', message: expect.stringContaining('--wait') });
  expect((await cli(['create', 'other.md', '--wait', '600001'])).body.error).toMatchObject({ code: 'INVALID_ARGUMENT' });
});
