import { open } from 'node:fs/promises';

interface DirectoryHandle { sync(): Promise<void>; close(): Promise<void> }
type DirectoryOpener = (path: string) => Promise<DirectoryHandle>;

/**
 * Windows cannot open a directory as a file (EISDIR/EPERM), and some filesystems reject
 * fsync on directories (EINVAL). Those platforms persist directory entries without it.
 */
const unsupported = new Set(['EISDIR', 'EPERM', 'EINVAL']);
const isUnsupported = (error: unknown) => unsupported.has(String((error as NodeJS.ErrnoException | null)?.code));

/** Persist a directory's entries, such as a completed rename, unlink or mkdir, to stable storage. */
export async function syncDirectory(path: string, openDirectory: DirectoryOpener = directory => open(directory, 'r')): Promise<void> {
  let handle: DirectoryHandle;
  try { handle = await openDirectory(path); }
  catch (error) { if (isUnsupported(error)) return; throw error; }
  try { await handle.sync(); }
  catch (error) { if (!isUnsupported(error)) throw error; }
  finally { await handle.close(); }
}
