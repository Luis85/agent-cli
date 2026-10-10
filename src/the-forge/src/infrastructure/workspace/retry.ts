import { setTimeout as delay } from 'node:timers/promises';

/**
 * Antivirus scanners, search indexers and editors on Windows briefly hold handles that make
 * rename, unlink and rm fail with these codes. Other failures are permanent and fail fast.
 */
const lockedFileCodes: readonly string[] = ['EPERM', 'EACCES', 'EBUSY'];
/** Exponential backoff totalling 630 ms, keeping a failing write within about one second. */
const lockedFileDelays: readonly number[] = [10, 20, 40, 80, 160, 320];

interface RetryOptions {
  codes?: readonly string[];
  delays?: readonly number[];
  sleep?: (milliseconds: number) => Promise<unknown>;
}

const errorCode = (error: unknown): unknown => error !== null && typeof error === 'object' ? (error as { code?: unknown }).code : undefined;

/** Run a filesystem operation, retrying only listed transient errno codes with bounded backoff. */
export async function retryTransient<T>(operation: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const { codes = lockedFileCodes, delays = lockedFileDelays, sleep = delay } = options;
  for (let attempt = 0; ; attempt++) {
    try { return await operation(); }
    catch (error) {
      const code = errorCode(error);
      if (attempt >= delays.length || typeof code !== 'string' || !codes.includes(code)) throw error;
      await sleep(delays[attempt]!);
    }
  }
}
