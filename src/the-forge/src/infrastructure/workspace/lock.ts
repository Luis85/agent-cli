import { randomUUID } from 'node:crypto';
import { link, open, readFile, rm, unlink } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import metadata from '../../../package.json';
import type { RecoveredLock, StaleReason } from '../../application/workspace/ports.ts';
import { forgeError, type AppError } from '../../domain/shared/errors.ts';
import { errorCode, heldTokens, inspectLock, ownHolder, text, tokenOf, type LockInspection } from './lock-holder.ts';
import { retryTransient } from './retry.ts';

export { hostIdentity, inspectLock } from './lock-holder.ts';
export const lockName = '.agent-cli.lock';
/** Invocation details supplied by composition code; the filesystem adapter cannot know them. */
export interface LockOwner { command?: string; operationId?: number }
export type LockRelease = 'released' | 'missing' | 'foreign';

const staleReasons: Record<StaleReason, string> = {
  'dead-process': 'its process no longer runs', 'reused-pid': 'its pid was reused by another process', rebooted: 'it was written before this host restarted',
};
/** The English warning for a stale lock an acquisition removed; German comes from the presentation catalog. */
export function recoveredLockMessage({ path, holder, reason }: RecoveredLock): string {
  return `Removed the stale lock ${path} of pid ${holder.pid} on ${holder.hostname} (since ${holder.startedAt}${holder.command ? `, command ${holder.command}` : ''}): ${staleReasons[reason]}. Inspect what that run left unfinished (for example git status or backlog sync status).`;
}

/** Hard links are unavailable on some filesystems (FAT, exFAT, some network shares). */
export const linkUnsupported: ReadonlySet<string> = new Set(['ENOTSUP', 'EOPNOTSUPP', 'ENOSYS', 'EXDEV', 'EPERM', 'EACCES', 'EMLINK']);
/** Persistent denials while creating the lock: Windows reports a lock that is pending deletion this way. */
const deniedCodes = new Set(['EPERM', 'EACCES']);
/** Creation attempts of one acquisition: the first, and retries after the lock disappeared or a stale one was broken. */
const acquireAttempts = 3;
/** Temporary names next to the lock: skipped by folder listings and revisions like the lock itself. */
const temporaryName = (path: string, kind: string) => join(dirname(path), `.agent-cli-tmp-${kind}-${randomUUID()}`);

function ownerDetails(owner: () => LockOwner): LockOwner {
  try {
    const { command, operationId } = owner();
    return { ...(text(command) ? { command } : {}), ...(Number.isSafeInteger(operationId) && operationId! > 0 ? { operationId } : {}) };
  } catch { return {}; }
}

/**
 * Create the lock with its holder record already in place, returning the token that releases it. `display` names the
 * lock relative to its root in messages and details. When the lock exists and its holder provably no longer runs
 * (see `inspectLock`), the stale lock is broken atomically and the acquisition retried; the removed holder is passed
 * to `recovered` as soon as it is removed, also when another writer then takes the lock first. Any other existing
 * lock fails with WORKSPACE_BUSY.
 */
export async function acquireLock(path: string, owner: () => LockOwner, display = lockName, recovered: (lock: RecoveredLock) => void = () => {}): Promise<string> {
  const token = randomUUID();
  const record = { ...(await ownHolder()), ...ownerDetails(owner), forgeVersion: metadata.version, token };
  const content = JSON.stringify(record) + '\n';
  // A lock that disappears or is broken between attempts is taken on the next one; a few attempts bound the races.
  for (let attempt = 1; ; attempt++) {
    if (await createHeld(path, content, token)) return token;
    const found = await inspectLock(path);
    if (attempt === acquireAttempts) throw busy(display, found);
    if (found.missing) continue;
    if (found.stale !== 'stale') throw busy(display, found);
    let broken: boolean;
    try { broken = await breakStale(path, found.content!); }
    catch (error) { throw busy(display, found, `Forge could not remove it (${errorCode(error) || String(error)})`); }
    if (broken) recovered({ path: display, holder: found.lock!, reason: found.reason! });
  }
}

/**
 * Creates a lock that records this process under `token`. The token counts as held before the lock appears, so a
 * concurrent diagnosis in this process never mistakes the new lock for one left by an earlier process with its pid.
 */
async function createHeld(path: string, content: string, token: string): Promise<boolean> {
  heldTokens.add(token);
  let created = false;
  try { created = await create(path, content); return created; }
  finally { if (!created) heldTokens.delete(token); }
}

/**
 * Creates the lock unless it exists. The record is written and fsynced to a reserved temporary file, then hard-linked
 * to the lock name, which fails with EEXIST when another writer holds it. Filesystems without hard links fall back to
 * an exclusive create followed by the write.
 */
async function create(path: string, content: string): Promise<boolean> {
  const temporary = temporaryName(path, 'lock');
  try {
    await writeDurably(temporary, content);
    await retryTransient(() => link(temporary, path), { codes: ['EBUSY'] });
    return true;
  } catch (error) {
    if (errorCode(error) === 'EEXIST') return false;
    if (!linkUnsupported.has(errorCode(error))) throw error;
  } finally { await retryTransient(() => rm(temporary, { force: true })).catch(() => {}); }
  return createExclusively(path, content);
}

/** The guard a contender holds while it breaks the stale lock at `path`; skipped by listings like the lock itself. */
const guardPath = (path: string) => join(dirname(path), `.agent-cli-tmp-break-${basename(path)}`);

/** Removes `path` only while it still holds `expected` (nobody but a breaker removes a lock whose holder is gone). */
async function removeUnchanged(path: string, expected: string): Promise<boolean> {
  const current = await readFile(path, 'utf8').catch(() => null);
  if (current !== expected) return false;
  try { await retryTransient(() => unlink(path)); return true; }
  catch (error) { if (errorCode(error) === 'ENOENT') return false; throw error; }
}

/**
 * Breaks a lock diagnosed as stale, safe against concurrent contenders: only the contender holding the break guard
 * may remove it, and only while it is still the diagnosed lock. Without the guard nothing but the (gone) holder or a
 * person removes a lock, so a lock another contender took meanwhile is never removed. A guard left by a contender
 * that was killed while breaking is itself broken when its holder provably no longer runs. Returns whether this
 * call removed the stale lock (false when another contender is or was first).
 */
export async function breakStale(path: string, diagnosed: string): Promise<boolean> {
  const guard = guardPath(path), token = randomUUID();
  const content = JSON.stringify({ ...(await ownHolder()), command: 'break stale lock', forgeVersion: metadata.version, token }) + '\n';
  if (!(await createHeld(guard, content, token))) {
    const left = await inspectLock(guard);
    if (left.stale !== 'stale' || !(await removeUnchanged(guard, left.content!)) || !(await createHeld(guard, content, token))) return false;
  }
  try { return await removeUnchanged(path, diagnosed); }
  finally { await releaseLock(guard, token).catch(() => {}); }
}

type Handle = Awaited<ReturnType<typeof open>>;

async function record(handle: Handle, content: string): Promise<void> {
  try {
    await handle.writeFile(content);
    // A lock left by a crash should still name its holder after restart.
    await handle.sync();
  } finally { await handle.close(); }
}

async function writeDurably(path: string, content: string): Promise<void> {
  await record(await retryTransient(() => open(path, 'wx')), content);
}

/** Fallback without hard links: the lock is briefly empty, which diagnosis reports as active. */
async function createExclusively(path: string, content: string): Promise<boolean> {
  let handle: Handle;
  try { handle = await retryTransient(() => open(path, 'wx')); }
  catch (error) {
    if (errorCode(error) === 'EEXIST' || deniedCodes.has(errorCode(error))) return false;
    throw error;
  }
  try { await record(handle, content); }
  catch (error) {
    await retryTransient(() => rm(path, { force: true })).catch(() => {});
    throw error;
  }
  return true;
}

/** Remove the lock only while it still carries this writer's token; never delete a foreign lock. */
export async function releaseLock(path: string, token: string): Promise<LockRelease> {
  heldTokens.delete(token);
  let content: string;
  try { content = await retryTransient(() => readFile(path, 'utf8')); }
  catch (error) { if (errorCode(error) === 'ENOENT') return 'missing'; throw error; }
  if (tokenOf(content) !== token) return 'foreign';
  await retryTransient(() => unlink(path));
  return 'released';
}

/**
 * WORKSPACE_BUSY for a lock that stays. Only an active holder (or a stale lock another contender just broke) makes
 * a retry worthwhile; a lock whose holder Forge cannot verify needs someone to check it and delete the file.
 */
function busy(display: string, inspection: LockInspection, failure?: string): AppError {
  const { lock, stale, reason } = inspection;
  const holder = lock ? ` (pid ${lock.pid} on ${lock.hostname} since ${lock.startedAt}${lock.command ? `, command ${lock.command}` : ''})` : '';
  const details = { lock, stale, path: display, ...(reason ? { reason } : {}) };
  const message = stale === 'active'
    ? `Lock ${display} is held${holder} by a running Forge process or one still writing it. Wait for it to finish and retry.`
    : stale === 'stale'
      ? `Lock ${display}${holder} is stale (${reason}), but ${failure ?? 'it could not be removed'}. Confirm no Forge process uses it, delete ${display} and retry.`
      : `Lock ${display} exists${holder}; Forge cannot tell whether its holder still runs (another host, pid namespace or boot, or an unreadable lock), so it never removes it. Verify the holder in error.details.lock; once it no longer runs, inspect its unfinished changes (for example git status), delete ${display} and retry.`;
  return forgeError('WORKSPACE_BUSY', message, details, undefined, stale === 'active');
}
