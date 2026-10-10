import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { link, lstat, open, readFile, readlink, rm, unlink } from 'node:fs/promises';
import { hostname } from 'node:os';
import { dirname, join } from 'node:path';
import metadata from '../../../package.json';
import { forgeError, AppError, isRecord } from '../../domain/shared/errors.ts';
import { retryTransient } from './retry.ts';

export const lockName = '.agent-cli.lock';
/** Invocation details supplied by composition code; the filesystem adapter cannot know them. */
export interface LockOwner { command?: string; operationId?: number }
/** Where a pid is meaningful: Linux pid namespace and boot, when the host exposes them. */
interface HostIdentity { pidNamespace?: string; bootId?: string }
interface LockMetadata extends HostIdentity { pid: number; hostname: string; startedAt: string; command?: string; operationId?: number; forgeVersion?: string }
/**
 * `active`: the pid runs in this pid namespace, or the lock is still being written.
 * `likely`: the lock was written in this host's pid namespace and boot, and its pid no longer runs (or is this process).
 * `unknown`: another host, namespace or boot, or unreadable metadata.
 */
type LockDiagnosis = 'active' | 'likely' | 'unknown';
export type LockRelease = 'released' | 'missing' | 'foreign';

/** An empty or partial lock this young may still be receiving its holder record. */
const writingWindowMs = 5000;
/** Hard links are unavailable on some filesystems (FAT, exFAT, some network shares). */
export const linkUnsupported: ReadonlySet<string> = new Set(['ENOTSUP', 'EOPNOTSUPP', 'ENOSYS', 'EXDEV', 'EPERM', 'EACCES', 'EMLINK']);
/** Persistent denials while creating the lock: Windows reports a lock that is pending deletion this way. */
const deniedCodes = new Set(['EPERM', 'EACCES']);
/** Tokens of locks this process holds right now, to tell a concurrent writer from a reused pid. */
const heldTokens = new Set<string>();

const positiveInteger = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) > 0;
const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 256;
const errorCode = (error: unknown) => (error as NodeJS.ErrnoException).code ?? '';

function ownerDetails(owner: () => LockOwner): LockOwner {
  try {
    const { command, operationId } = owner();
    return { ...(text(command) ? { command } : {}), ...(positiveInteger(operationId) ? { operationId } : {}) };
  } catch { return {}; }
}

let identity: Promise<HostIdentity> | undefined;
/** Linux pid namespace and boot id. Other platforms have neither, so their absence matches. */
export function hostIdentity(): Promise<HostIdentity> {
  identity ??= (async () => {
    const pidNamespace = await readlink('/proc/self/ns/pid').catch(() => undefined);
    const bootId = (await readFile('/proc/sys/kernel/random/boot_id', 'utf8').catch(() => undefined))?.trim();
    return { ...(text(pidNamespace) ? { pidNamespace } : {}), ...(text(bootId) ? { bootId } : {}) };
  })();
  return identity;
}

/**
 * Create the lock with its holder record already in place, returning the token that releases it.
 * The record is written and fsynced to a reserved temporary file, then hard-linked to the lock
 * name, which fails with EEXIST when another writer holds it. Filesystems without hard links fall
 * back to an exclusive create followed by the write.
 */
export async function acquireLock(path: string, owner: () => LockOwner): Promise<string> {
  const token = randomUUID();
  const record = { pid: process.pid, hostname: hostname(), startedAt: new Date().toISOString(), ...ownerDetails(owner),
    forgeVersion: metadata.version, ...(await hostIdentity()), token };
  const content = JSON.stringify(record) + '\n';
  const temporary = join(dirname(path), `.agent-cli-tmp-lock-${token}`);
  let linked = false;
  try {
    await writeDurably(temporary, content);
    await retryTransient(() => link(temporary, path), { codes: ['EBUSY'] });
    linked = true;
  } catch (error) {
    if (errorCode(error) === 'EEXIST') throw await busy(path);
    if (!linkUnsupported.has(errorCode(error))) throw error;
  } finally { await retryTransient(() => rm(temporary, { force: true })).catch(() => {}); }
  if (!linked) await createExclusively(path, content);
  heldTokens.add(token);
  return token;
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
async function createExclusively(path: string, content: string): Promise<void> {
  let handle: Handle;
  try { handle = await retryTransient(() => open(path, 'wx')); }
  catch (error) {
    if (errorCode(error) === 'EEXIST' || deniedCodes.has(errorCode(error))) throw await busy(path);
    throw error;
  }
  try { await record(handle, content); }
  catch (error) {
    await retryTransient(() => rm(path, { force: true })).catch(() => {});
    throw error;
  }
}

/** Remove the lock only while it still carries this writer's token; never delete a foreign lock. */
export async function releaseLock(path: string, token: string): Promise<LockRelease> {
  heldTokens.delete(token);
  let content: string;
  try { content = await retryTransient(() => readFile(path, 'utf8')); }
  catch (error) { if (errorCode(error) === 'ENOENT') return 'missing'; throw error; }
  let recorded: unknown;
  try { recorded = (JSON.parse(content) as { token?: unknown }).token; } catch { return 'foreign'; }
  if (recorded !== token) return 'foreign';
  await retryTransient(() => unlink(path));
  return 'released';
}

function parseMetadata(content: string): LockMetadata | null {
  let value: unknown;
  try { value = JSON.parse(content); } catch { return null; }
  if (!isRecord(value) || !positiveInteger(value.pid) || !text(value.hostname) || !text(value.startedAt)) return null;
  const { pid, hostname: host, startedAt, command, operationId, forgeVersion, pidNamespace, bootId } = value;
  // Copy recognized fields only; error details must not echo arbitrary lock content or the release token.
  return { pid, hostname: host, startedAt, ...(text(command) ? { command } : {}), ...(positiveInteger(operationId) ? { operationId } : {}),
    ...(text(forgeVersion) ? { forgeVersion } : {}), ...(text(pidNamespace) ? { pidNamespace } : {}), ...(text(bootId) ? { bootId } : {}) };
}

async function readLock(path: string): Promise<{ lock: LockMetadata | null; token?: unknown; young: boolean }> {
  try {
    const entry = await lstat(path);
    if (!entry.isFile()) return { lock: null, young: false };
    const young = Date.now() - entry.mtimeMs < writingWindowMs;
    const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const buffer = Buffer.alloc(4096);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      const content = buffer.subarray(0, bytesRead).toString('utf8');
      let token: unknown;
      try { token = (JSON.parse(content) as { token?: unknown } | null)?.token; } catch { /* Unreadable metadata has no token. */ }
      return { lock: parseMetadata(content), token, young };
    } finally { await handle.close(); }
  } catch { return { lock: null, young: false }; }
}

function processAlive(pid: number): boolean | undefined {
  try { process.kill(pid, 0); return true; }
  catch (error) {
    // EPERM: the process exists but belongs to another user.
    return errorCode(error) === 'ESRCH' ? false : errorCode(error) === 'EPERM' ? true : undefined;
  }
}

/** Read-only diagnosis. The lock is never removed automatically: pids can be reused. */
export async function inspectLock(path: string): Promise<{ lock: LockMetadata | null; stale: LockDiagnosis }> {
  const { lock, token, young } = await readLock(path);
  if (lock === null) return { lock, stale: young ? 'active' : 'unknown' };
  const current = await hostIdentity();
  // A pid only identifies a process within one pid namespace and boot of one host.
  if (lock.hostname !== hostname() || lock.pidNamespace !== current.pidNamespace || lock.bootId !== current.bootId) return { lock, stale: 'unknown' };
  // This process is not writing under that token, so a lock naming its pid is left over (for example a fixed-pid container restart).
  if (lock.pid === process.pid) return { lock, stale: typeof token === 'string' && heldTokens.has(token) ? 'active' : 'likely' };
  const alive = processAlive(lock.pid);
  return { lock, stale: alive === undefined ? 'unknown' : alive ? 'active' : 'likely' };
}

async function busy(path: string): Promise<AppError> {
  const details = await inspectLock(path);
  const { lock, stale } = details;
  const holder = lock ? ` (pid ${lock.pid} on ${lock.hostname} since ${lock.startedAt}${lock.command ? `, command ${lock.command}` : ''})` : '';
  return forgeError('WORKSPACE_BUSY', `Workspace lock ${lockName} exists${holder}; error.details.stale is "${stale}". Forge never removes the lock automatically. `
    + 'Wait for an active writer and retry. If stale is "likely", the recorded process no longer runs in this host\'s pid namespace: inspect its changes (for example git status), confirm no Forge writer is running, then delete the lock and retry. '
    + 'If stale is "unknown" (another host, container or boot, or an unreadable lock), verify the recorded holder in error.details.lock yourself before deleting it.', details);
}
