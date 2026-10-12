import { isRecord } from '../../domain/shared/errors.ts';
import { discoverWebviews } from './assets.ts';
import { startHttpServer, type RunningHttpServer } from './http-server.ts';
import { serverInfo, type DaemonConfiguration } from './controller.ts';
import { createSnapshotProvider } from './snapshot.ts';
import { removeState, writeState, type ServerState } from './state.ts';

function validConfiguration(value: unknown): value is DaemonConfiguration {
  return isRecord(value) && typeof value.workspaceRoot === 'string' && typeof value.distributionPath === 'string'
    && typeof value.version === 'string' && typeof value.instanceId === 'string' && typeof value.token === 'string'
    && /^[a-f0-9]{64}$/.test(value.token) && Number.isInteger(value.port) && Number(value.port) >= 0 && Number(value.port) <= 65535;
}

/** The detached process receives its secret over IPC, never argv or inherited environment. */
export function runServerDaemon(): void {
  if (!process.send) { process.exitCode = 1; return; }
  let runtime: RunningHttpServer | undefined;
  let state: ServerState | undefined;
  let configuration: DaemonConfiguration | undefined;
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
      if (runtime) await runtime.close();
      if (configuration && state) await removeState(configuration.workspaceRoot, state.instanceId);
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
  const startupTimeout = setTimeout(() => { process.exitCode = 1; void stop(); }, 10_000);
  process.once('SIGTERM', () => { void stop().catch(() => { process.exitCode = 1; }); });
  process.once('SIGINT', () => { void stop().catch(() => { process.exitCode = 1; }); });
  process.once('disconnect', () => { if (!ready) void stop(); });
  process.once('message', message => {
    if (!validConfiguration(message)) { process.exitCode = 1; void stop(); return; }
    configuration = message;
    initialization = (async () => {
      try {
        const assets = await discoverWebviews(message.distributionPath);
        if (cancelled) return;
        const webviews = assets.map(asset => ({ id: asset.id, name: asset.name, path: `/views/${asset.id}/` }));
        const snapshot = createSnapshotProvider({ ...message, webviews, signal: inspection.signal, server: () => serverInfo(state!) });
        runtime = await startHttpServer({ port: message.port, token: message.token,
          instanceId: message.instanceId, assets, snapshot, shutdown: stop });
        if (cancelled) return;
        state = { schemaVersion: 1, instanceId: message.instanceId, token: message.token,
          workspaceRoot: message.workspaceRoot, pid: process.pid, port: runtime.port,
          startedAt: new Date().toISOString(), version: message.version, nodeVersion: process.version, webviews };
        await writeState(message.workspaceRoot, state);
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
