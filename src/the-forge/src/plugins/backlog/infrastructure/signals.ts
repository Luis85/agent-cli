import type { Interruption } from '../application/sync-run.ts';

/**
 * Watches SIGINT and SIGTERM for one sync run. The first signal is only recorded, so the sync stops at its next safe
 * point and releases its locks; the listeners are removed with it, so a second signal terminates the process the
 * default way (its lock is then recovered by the next sync, since its process no longer runs).
 */
export function watchSignals(): Interruption {
  let received: 'SIGINT' | 'SIGTERM' | null = null;
  const interrupt = () => { received = 'SIGINT'; dispose(); };
  const terminate = () => { received = 'SIGTERM'; dispose(); };
  const dispose = () => { process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', terminate); };
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', terminate);
  return { get signal() { return received; }, dispose };
}
