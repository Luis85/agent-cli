import { constants } from 'node:fs';
import { lstat, open, rm } from 'node:fs/promises';
import { hostname } from 'node:os';
import metadata from '../../../../package.json';
import { AppError, isRecord } from '../../domain/shared/errors.ts';
import { retryTransient } from './retry.ts';

export const lockName = '.agent-cli.lock';
/** Invocation details supplied by composition code; the filesystem adapter cannot know them. */
export interface LockOwner { command?: string; operationId?: number }
interface LockMetadata { pid: number; hostname: string; startedAt: string; command?: string; operationId?: number; forgeVersion?: string }
/** `active`: the pid runs on this host. `likely`: it does not. `unknown`: another host or unreadable metadata. */
type LockDiagnosis = 'active' | 'likely' | 'unknown';

const positiveInteger = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) > 0;
const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 256;

function ownerDetails(owner: () => LockOwner): LockOwner {
  try {
    const { command, operationId } = owner();
    return { ...(text(command) ? { command } : {}), ...(positiveInteger(operationId) ? { operationId } : {}) };
  } catch { return {}; }
}

/** Create the lock exclusively, then record who holds it for WORKSPACE_BUSY diagnosis. */
export async function acquireLock(path: string, owner: () => LockOwner): Promise<void> {
  let handle;
  try { handle = await open(path, 'wx'); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw await busy(path);
    throw error;
  }
  const record: LockMetadata = { pid: process.pid, hostname: hostname(), startedAt: new Date().toISOString(), ...ownerDetails(owner), forgeVersion: metadata.version };
  try {
    try {
      await handle.writeFile(JSON.stringify(record) + '\n');
      // A lock left by a crash should still name its holder after restart.
      await handle.sync();
    } finally { await handle.close(); }
  } catch (error) {
    await releaseLock(path).catch(() => {});
    throw error;
  }
}

export async function releaseLock(path: string): Promise<void> { await retryTransient(() => rm(path, { force: true })); }

function parseMetadata(content: string): LockMetadata | null {
  let value: unknown;
  try { value = JSON.parse(content); } catch { return null; }
  if (!isRecord(value) || !positiveInteger(value.pid) || !text(value.hostname) || !text(value.startedAt)) return null;
  const { pid, hostname: host, startedAt, command, operationId, forgeVersion } = value;
  // Copy recognized fields only; error details must not echo arbitrary lock content.
  return { pid, hostname: host, startedAt, ...(text(command) ? { command } : {}), ...(positiveInteger(operationId) ? { operationId } : {}), ...(text(forgeVersion) ? { forgeVersion } : {}) };
}

async function readMetadata(path: string): Promise<LockMetadata | null> {
  try {
    if (!(await lstat(path)).isFile()) return null;
    const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const buffer = Buffer.alloc(4096);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      return parseMetadata(buffer.subarray(0, bytesRead).toString('utf8'));
    } finally { await handle.close(); }
  } catch { return null; }
}

function processAlive(pid: number): boolean | undefined {
  try { process.kill(pid, 0); return true; }
  catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    // EPERM: the process exists but belongs to another user.
    return code === 'ESRCH' ? false : code === 'EPERM' ? true : undefined;
  }
}

/** Read-only diagnosis. The lock is never removed automatically: pids can be reused. */
export async function inspectLock(path: string): Promise<{ lock: LockMetadata | null; stale: LockDiagnosis }> {
  const lock = await readMetadata(path);
  if (lock === null || lock.hostname !== hostname()) return { lock, stale: 'unknown' };
  const alive = processAlive(lock.pid);
  return { lock, stale: alive === undefined ? 'unknown' : alive ? 'active' : 'likely' };
}

async function busy(path: string): Promise<AppError> {
  const details = await inspectLock(path);
  const { lock, stale } = details;
  const holder = lock ? ` (pid ${lock.pid} on ${lock.hostname} since ${lock.startedAt}${lock.command ? `, command ${lock.command}` : ''})` : '';
  return new AppError('WORKSPACE_BUSY', `Workspace lock ${lockName} exists${holder}; error.details.stale is "${stale}". Forge never removes the lock automatically. `
    + 'Wait for an active writer and retry. If stale is "likely", the recorded process no longer runs on this host: inspect its changes (for example git status), confirm no Forge writer is running, then delete the lock and retry. '
    + 'If stale is "unknown", verify the recorded pid and host in error.details.lock yourself before deleting it.', 4, details);
}
