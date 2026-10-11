import { constants } from 'node:fs';
import { lstat, mkdir, open, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { AppError, forgeError, isRecord } from '../../domain/shared/errors.ts';
import { acquireLock, releaseLock } from '../workspace/lock.ts';
import type { WebviewInfo } from '../../application/server/contracts.ts';

export interface ServerState {
  schemaVersion: 1;
  instanceId: string;
  token: string;
  workspaceRoot: string;
  pid: number;
  port: number;
  startedAt: string;
  version: string;
  nodeVersion: string;
  webviews: WebviewInfo[];
}
const missing = (error: unknown): boolean => (error as NodeJS.ErrnoException).code === 'ENOENT';
const invalid = (): AppError => forgeError('SERVER_STATE_INVALID', 'Server state is unsafe or invalid. Inspect .forge/server.json and its permissions.');

async function stateDirectory(root: string, create = false): Promise<string> {
  const path = join(root, '.forge');
  if (create) await mkdir(path, { recursive: true, mode: 0o700 });
  try {
    const info = await lstat(path);
    if (!info.isDirectory() || info.isSymbolicLink()) throw invalid();
  } catch (error) { if (!missing(error)) throw error; }
  return path;
}

export async function readState(root: string): Promise<ServerState | null> {
  const path = join(await stateDirectory(root), 'server.json');
  let handle;
  try {
    if (!(await lstat(path)).isFile()) throw invalid();
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const info = await handle.stat();
    if (!info.isFile() || info.size > 64 * 1024 || (process.platform !== 'win32' && ((info.mode & 0o077) !== 0 || info.uid !== process.getuid?.()))) throw invalid();
    const value: unknown = JSON.parse(await handle.readFile('utf8'));
    if (!isRecord(value) || value.schemaVersion !== 1 || value.workspaceRoot !== root
      || typeof value.instanceId !== 'string' || !/^[a-f0-9-]{36}$/.test(value.instanceId)
      || typeof value.token !== 'string' || !/^[a-f0-9]{64}$/.test(value.token)
      || !Number.isInteger(value.pid) || Number(value.pid) < 1
      || !Number.isInteger(value.port) || Number(value.port) < 1 || Number(value.port) > 65535
      || typeof value.startedAt !== 'string' || !Number.isFinite(Date.parse(value.startedAt))
      || typeof value.version !== 'string' || typeof value.nodeVersion !== 'string'
      || !Array.isArray(value.webviews) || !value.webviews.every(view => isRecord(view) && typeof view.id === 'string' && /^[a-z][a-z0-9-]*$/.test(view.id) && typeof view.name === 'string' && view.path === `/views/${view.id}/`)) throw invalid();
    return value as unknown as ServerState;
  } catch (error) {
    if (missing(error)) return null;
    if (error instanceof AppError) throw error;
    throw invalid();
  } finally { await handle?.close(); }
}

/** Keep credentials out of Git in every portable workspace, preserving existing ignore bytes. */
export async function ensureStateIgnored(root: string): Promise<void> {
  const directory = await stateDirectory(root, true);
  const path = join(directory, '.gitignore');
  let original: Buffer = Buffer.alloc(0);
  let mode = 0o644;
  let handle;
  try {
    if (!(await lstat(path)).isFile()) throw invalid();
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const info = await handle.stat();
    if (!info.isFile() || info.size > 1024 * 1024) throw invalid();
    original = await handle.readFile();
    mode = info.mode & 0o777;
  } catch (error) {
    if (!missing(error)) throw invalid();
  } finally { await handle?.close(); }
  const lines = original.toString('utf8').trimEnd().split(/\r?\n/);
  const entries = ['/server.json', '/server.lock', '/.server-*.tmp', '/.agent-cli-tmp-*'];
  // Ignore rules use last-match precedence: earlier entries may be undone by later negations.
  if (entries.every((entry, index) => lines.at(index - entries.length) === entry)) return;
  const newline = original.includes(Buffer.from('\r\n')) ? '\r\n' : '\n';
  const separator = original.length && original.at(-1) !== 10 ? newline : '';
  const bytes = Buffer.concat([original, Buffer.from(separator + entries.join(newline) + newline)]);
  const temporary = join(directory, `.server-${randomUUID()}.tmp`);
  const target = await open(temporary, 'wx', mode);
  try {
    await target.writeFile(bytes);
    await target.sync();
    await target.close();
    await rename(temporary, path);
  } finally { await target.close(); await unlink(temporary).catch(() => undefined); }
}

export async function writeState(root: string, state: ServerState): Promise<void> {
  const directory = await stateDirectory(root, true);
  const temporary = join(directory, `.server-${randomUUID()}.tmp`);
  const handle = await open(temporary, 'wx', 0o600);
  try {
    await handle.writeFile(JSON.stringify(state));
    await handle.sync();
    await handle.close();
    await rename(temporary, join(directory, 'server.json'));
  } finally { await handle.close(); await unlink(temporary).catch(() => undefined); }
}

export async function removeState(root: string, instanceId: string): Promise<void> {
  const state = await readState(root);
  if (state?.instanceId === instanceId) await unlink(join(root, '.forge/server.json')).catch(error => { if (!missing(error)) throw error; });
}

/** Reuse the workspace's host-aware stale-lock recovery, with a separate lifecycle lock. */
export async function withServerLock<T>(root: string, action: () => Promise<T>): Promise<T> {
  const path = join(await stateDirectory(root, true), 'server.lock');
  const deadline = Date.now() + 10_000;
  let token: string;
  while (true) {
    const info = await lstat(path).catch(error => { if (missing(error)) return null; throw error; });
    if (info && (!info.isFile() || info.isSymbolicLink())) throw invalid();
    try {
      token = await acquireLock(path, () => ({ command: 'server lifecycle' }), '.forge/server.lock');
      break;
    } catch (error) {
      if (!(error instanceof AppError) || error.code !== 'WORKSPACE_BUSY') throw error;
      if (Date.now() >= deadline) throw forgeError('SERVER_BUSY', 'Another server lifecycle command holds the startup lock. Retry shortly.');
      await new Promise(resolve => setTimeout(resolve, 75));
    }
  }
  try { return await action(); }
  finally { await releaseLock(path, token); }
}
