import { describe, expect, it, vi } from 'vitest';
import { syncDirectory } from '../../src/infrastructure/workspace/durable.ts';

const failure = (code: string) => Object.assign(new Error(`${code}: injected`), { code });
const handle = (sync: () => Promise<void> = async () => {}) => ({ sync: vi.fn(sync), close: vi.fn(async () => {}) });

describe('directory durability', () => {
  it('fsyncs and closes the directory handle', async () => {
    const directory = handle();
    const opener = vi.fn(async () => directory);
    await syncDirectory('/workspace/notes', opener);
    expect(opener).toHaveBeenCalledWith('/workspace/notes');
    expect(directory.sync).toHaveBeenCalledTimes(1);
    expect(directory.close).toHaveBeenCalledTimes(1);
  });
  it.each(['EISDIR', 'EPERM', 'EINVAL'])('skips platforms that cannot open directories (%s)', async code => {
    await expect(syncDirectory('C:\\workspace', async () => { throw failure(code); })).resolves.toBeUndefined();
  });
  it.each(['EINVAL', 'EPERM'])('skips filesystems that reject directory fsync (%s) and still closes', async code => {
    const directory = handle(async () => { throw failure(code); });
    await expect(syncDirectory('/workspace', async () => directory)).resolves.toBeUndefined();
    expect(directory.close).toHaveBeenCalledTimes(1);
  });
  it.each(['EIO', 'ENOENT', 'EACCES'])('reports real open failures (%s)', async code => {
    await expect(syncDirectory('/workspace', async () => { throw failure(code); })).rejects.toMatchObject({ code });
  });
  it('reports a failed fsync after closing the handle', async () => {
    const directory = handle(async () => { throw failure('EIO'); });
    await expect(syncDirectory('/workspace', async () => directory)).rejects.toMatchObject({ code: 'EIO' });
    expect(directory.close).toHaveBeenCalledTimes(1);
  });
});
