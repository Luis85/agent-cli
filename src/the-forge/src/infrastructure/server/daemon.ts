import { isRecord } from '../../domain/shared/errors.ts';
import type { DaemonConfiguration } from './controller.ts';

function validConfiguration(value: unknown): value is DaemonConfiguration {
  return isRecord(value) && typeof value.workspaceRoot === 'string' && typeof value.distributionPath === 'string'
    && typeof value.version === 'string' && typeof value.instanceId === 'string' && typeof value.token === 'string'
    && /^[a-f0-9]{64}$/.test(value.token) && Number.isInteger(value.port) && Number(value.port) >= 0 && Number(value.port) <= 65535;
}

/** What the daemon lifecycle offers the runtime it starts. */
export interface DaemonControl {
  /** Aborted when the daemon stops; pending inspections end with it. */
  readonly signal: AbortSignal;
  /** True once a stop was requested; the start returns early instead of publishing more resources. */
  cancelled(): boolean;
  /** Registers a release step; steps run once, in registration order, when the daemon closes. */
  onClose(release: () => Promise<void>): void;
  /** Stops the daemon, for example from the HTTP shutdown endpoint. */
  stop(): Promise<void>;
}

/** Starts the runtime for a validated configuration; a rejection reports its `code` (or `START_FAILED`) to the parent. */
export type DaemonStart = (configuration: DaemonConfiguration, control: DaemonControl) => Promise<void>;

/** The detached process receives its secret over IPC, never argv or inherited environment. */
export function runServerDaemon(start: DaemonStart): void {
  if (!process.send) { process.exitCode = 1; return; }
  const releases: (() => Promise<void>)[] = [];
  let initialization: Promise<void> | undefined;
  let stopping: Promise<void> | undefined;
  let closing: Promise<void> | undefined;
  let cancelled = false;
  let ready = false;
  const inspection = new AbortController();
  const notify = (message: Record<string, unknown>): void => {
    if (process.connected) process.send?.(message, () => undefined);
  };
  const cleanup = (): Promise<void> => {
    closing ??= (async () => {
      inspection.abort();
      for (const release of releases) await release();
      if (process.connected) process.disconnect?.();
    })();
    return closing;
  };
  const stop = (): Promise<void> => {
    cancelled = true;
    clearTimeout(startupTimeout);
    inspection.abort();
    stopping ??= (async () => {
      await initialization;
      await cleanup();
    })();
    return stopping;
  };
  const control: DaemonControl = { signal: inspection.signal, cancelled: () => cancelled, onClose: release => { releases.push(release); }, stop };
  const startupTimeout = setTimeout(() => { process.exitCode = 1; void stop(); }, 10_000);
  process.once('SIGTERM', () => { void stop().catch(() => { process.exitCode = 1; }); });
  process.once('SIGINT', () => { void stop().catch(() => { process.exitCode = 1; }); });
  process.once('disconnect', () => { if (!ready) void stop(); });
  process.once('message', message => {
    if (!validConfiguration(message)) { process.exitCode = 1; void stop(); return; }
    initialization = (async () => {
      try {
        await start(message, control);
        if (cancelled) return;
        clearTimeout(startupTimeout);
        ready = true;
        notify({ type: 'ready', instanceId: message.instanceId });
      } catch (error) {
        clearTimeout(startupTimeout);
        notify({ type: 'error', code: isRecord(error) && typeof error.code === 'string' ? error.code : 'START_FAILED' });
        await cleanup();
        process.exitCode = 1;
      }
    })();
  });
}
