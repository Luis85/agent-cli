import { describe, expect, it, vi } from 'vitest';
import { retryTransient } from '../../src/the-forge/infrastructure/workspace/retry.ts';

const failure = (code: string) => Object.assign(new Error(`${code}: injected`), { code });
const recorder = () => {
  const waits: number[] = [];
  return { waits, sleep: async (milliseconds: number) => { waits.push(milliseconds); } };
};

describe('transient filesystem retry', () => {
  it('retries locked-file codes and returns the first success', async () => {
    const { waits, sleep } = recorder();
    const operation = vi.fn<() => Promise<string>>()
      .mockRejectedValueOnce(failure('EBUSY'))
      .mockRejectedValueOnce(failure('EPERM'))
      .mockRejectedValueOnce(failure('EACCES'))
      .mockResolvedValue('renamed');
    await expect(retryTransient(operation, { sleep })).resolves.toBe('renamed');
    expect(operation).toHaveBeenCalledTimes(4);
    expect(waits).toEqual([10, 20, 40]);
  });
  it('does not retry an immediate success', async () => {
    const { waits, sleep } = recorder();
    const operation = vi.fn(async () => 42);
    await expect(retryTransient(operation, { sleep })).resolves.toBe(42);
    expect(operation).toHaveBeenCalledTimes(1);
    expect(waits).toEqual([]);
  });
  it.each(['ENOENT', 'EEXIST', 'EISDIR', 'ENOTEMPTY', 'EXDEV'])('fails immediately on %s', async code => {
    const { waits, sleep } = recorder();
    const operation = vi.fn(async () => { throw failure(code); });
    await expect(retryTransient(operation, { sleep })).rejects.toMatchObject({ code });
    expect(operation).toHaveBeenCalledTimes(1);
    expect(waits).toEqual([]);
  });
  it.each([new Error('no code'), 'string failure', null])('fails immediately on a failure without an errno code (%s)', async thrown => {
    const { sleep } = recorder();
    const operation = vi.fn(async () => { throw thrown; });
    await expect(retryTransient(operation, { sleep })).rejects.toBe(thrown);
    expect(operation).toHaveBeenCalledTimes(1);
  });
  it('gives up with the last failure after a bounded budget of about one second', async () => {
    const { waits, sleep } = recorder();
    let attempt = 0;
    const operation = vi.fn(async () => { throw failure(++attempt % 2 ? 'EPERM' : 'EBUSY'); });
    await expect(retryTransient(operation, { sleep })).rejects.toMatchObject({ code: 'EPERM', message: expect.stringContaining('EPERM') });
    expect(operation).toHaveBeenCalledTimes(7);
    expect(waits).toEqual([10, 20, 40, 80, 160, 320]);
    expect(waits.reduce((total, wait) => total + wait, 0)).toBeLessThanOrEqual(1000);
  });
  it('stops retrying when a transient failure turns permanent', async () => {
    const { waits, sleep } = recorder();
    const operation = vi.fn<() => Promise<void>>().mockRejectedValueOnce(failure('EBUSY')).mockRejectedValueOnce(failure('ENOENT'));
    await expect(retryTransient(operation, { sleep })).rejects.toMatchObject({ code: 'ENOENT' });
    expect(operation).toHaveBeenCalledTimes(2);
    expect(waits).toEqual([10]);
  });
  it('accepts explicit codes and delays', async () => {
    const { waits, sleep } = recorder();
    const operation = vi.fn(async () => { throw failure('EAGAIN'); });
    await expect(retryTransient(operation, { codes: ['EAGAIN'], delays: [1, 2], sleep })).rejects.toMatchObject({ code: 'EAGAIN' });
    expect(operation).toHaveBeenCalledTimes(3);
    expect(waits).toEqual([1, 2]);
  });
  it('waits on the real clock when no sleep is injected', async () => {
    const operation = vi.fn<() => Promise<string>>().mockRejectedValueOnce(failure('EBUSY')).mockResolvedValue('ok');
    await expect(retryTransient(operation, { delays: [1] })).resolves.toBe('ok');
    expect(operation).toHaveBeenCalledTimes(2);
  });
});
