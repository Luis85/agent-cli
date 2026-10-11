import { constants } from 'node:fs';
import { lstat, open, readFile, readlink } from 'node:fs/promises';
import { hostname, uptime } from 'node:os';
import type { LockHolder, StaleReason } from '../../application/workspace/ports.ts';
import { isRecord } from '../../domain/shared/errors.ts';

/** Where a pid is meaningful: Linux pid namespace and boot, when the host exposes them. */
interface HostIdentity { pidNamespace?: string; bootId?: string }
/**
 * `active`: the holder runs (or may still be writing the lock). `stale`: the holder provably no longer runs (see
 * `StaleReason`), so the lock may be broken. `unknown`: another host, pid namespace or boot, or unreadable metadata;
 * Forge cannot tell, so the lock stays until someone who can verify the holder deletes it.
 */
export type LockDiagnosis = 'active' | 'stale' | 'unknown';
/** `missing` marks a lock that disappeared before it could be read (its holder just released it). */
export interface LockInspection { lock: LockHolder | null; stale: LockDiagnosis; reason?: StaleReason; content?: string; missing?: true }

/** An empty or partial lock this young may still be receiving its holder record. */
const writingWindowMs = 5000;
/** Tokens of locks this process holds right now, to tell a concurrent writer from a reused pid. */
export const heldTokens = new Set<string>();

const positiveInteger = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) > 0;
export const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 256;
export const errorCode = (error: unknown) => (error as NodeJS.ErrnoException).code ?? '';

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
 * A process's start time in clock ticks after boot (`/proc/<pid>/stat` field 22), which together with the boot id
 * identifies one process even after its pid is reused. Undefined where `/proc` does not exist (macOS, Windows).
 */
export async function processStart(pid: number): Promise<string | undefined> {
  const stat = await readFile(`/proc/${pid}/stat`, 'utf8').catch(() => undefined);
  // The command name (field 2) may hold spaces and parentheses; the fields after it are space separated.
  const fields = stat?.slice(stat.lastIndexOf(')') + 2).split(' ');
  const start = fields?.[19];
  return start !== undefined && /^\d+$/.test(start) ? start : undefined;
}

/** This process's holder record without invocation details. */
export async function ownHolder(): Promise<LockHolder> {
  const start = await processStart(process.pid);
  return { pid: process.pid, hostname: hostname(), startedAt: new Date().toISOString(), ...(await hostIdentity()), ...(start ? { processStart: start } : {}) };
}

function parseHolder(content: string): LockHolder | null {
  let value: unknown;
  try { value = JSON.parse(content); } catch { return null; }
  if (!isRecord(value) || !positiveInteger(value.pid) || !text(value.hostname) || !text(value.startedAt)) return null;
  const { pid, hostname: host, startedAt, command, operationId, forgeVersion, pidNamespace, bootId, processStart: start } = value;
  // Copy recognized fields only; error details must not echo arbitrary lock content or the release token.
  return { pid, hostname: host, startedAt, ...(text(command) ? { command } : {}), ...(positiveInteger(operationId) ? { operationId } : {}),
    ...(text(forgeVersion) ? { forgeVersion } : {}), ...(text(pidNamespace) ? { pidNamespace } : {}), ...(text(bootId) ? { bootId } : {}),
    ...(text(start) ? { processStart: start } : {}) };
}

/** The lock file's content (bounded) and whether it is young enough to still be receiving its record. */
async function readLock(path: string): Promise<{ content: string | null; young: boolean; missing?: true }> {
  try {
    const entry = await lstat(path);
    if (!entry.isFile()) return { content: null, young: false };
    const young = Date.now() - entry.mtimeMs < writingWindowMs;
    const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const buffer = Buffer.alloc(4096);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      return { content: buffer.subarray(0, bytesRead).toString('utf8'), young };
    } finally { await handle.close(); }
  } catch (error) { return { content: null, young: false, ...(errorCode(error) === 'ENOENT' ? { missing: true as const } : {}) }; }
}

/** The release token a lock's content records, if any. */
export function tokenOf(content: string | null): unknown {
  try { return content === null ? undefined : (JSON.parse(content) as { token?: unknown } | null)?.token; }
  catch { return undefined; }
}

function processAlive(pid: number): boolean | undefined {
  try { process.kill(pid, 0); return true; }
  catch (error) {
    // EPERM: the process exists but belongs to another user.
    return errorCode(error) === 'ESRCH' ? false : errorCode(error) === 'EPERM' ? true : undefined;
  }
}

/** When this host last booted, in milliseconds since the epoch. */
const bootedAt = () => Date.now() - uptime() * 1000;

/** Whether the recorded holder runs, provably does not, or cannot be told; read only. */
export async function inspectLock(path: string): Promise<LockInspection> {
  const { content, young, missing } = await readLock(path);
  const lock = content === null ? null : parseHolder(content);
  if (lock === null) return { lock, stale: young ? 'active' : 'unknown', ...(missing ? { missing } : {}) };
  const stale = (reason: StaleReason): LockInspection => ({ lock, stale: 'stale', reason, content: content! });
  const current = await hostIdentity();
  // A pid only identifies a process within one pid namespace and boot of one host.
  if (lock.hostname !== hostname() || lock.pidNamespace !== current.pidNamespace) return { lock, stale: 'unknown' };
  if (lock.bootId !== current.bootId) {
    // Another boot of this host: proven only for a lock written before this boot (a host name alone is no proof).
    return lock.bootId !== undefined && current.bootId !== undefined && Date.parse(lock.startedAt) < bootedAt() ? stale('rebooted') : { lock, stale: 'unknown' };
  }
  if (lock.pid === process.pid) {
    const token = tokenOf(content);
    if (typeof token === 'string' && heldTokens.has(token)) return { lock, stale: 'active' };
    // This process drops a token only after removing its lock, and tokens are never reused. A lock that still holds
    // this content now was not written by this run (for example after a fixed-pid container restart); otherwise
    // it was released since it was read, so it is inspected again.
    if ((await readLock(path)).content !== content) return inspectLock(path);
    return stale('reused-pid');
  }
  const alive = processAlive(lock.pid);
  if (alive === undefined) return { lock, stale: 'unknown' };
  if (!alive) return stale('dead-process');
  const start = lock.processStart === undefined ? undefined : await processStart(lock.pid);
  return start !== undefined && start !== lock.processStart ? stale('reused-pid') : { lock, stale: 'active' };
}
