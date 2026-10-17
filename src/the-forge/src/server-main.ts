import { discoverWebviews } from './infrastructure/server/assets.ts';
import { serverInfo } from './infrastructure/server/controller.ts';
import { runServerDaemon } from './infrastructure/server/daemon.ts';
import { startHttpServer } from './infrastructure/server/http-server.ts';
import { createSnapshotProvider } from './infrastructure/server/snapshot.ts';
import { removeState, writeState, type ServerState } from './infrastructure/server/state.ts';

runServerDaemon(async (configuration, daemon) => {
  const assets = await discoverWebviews(configuration.distributionPath);
  if (daemon.cancelled()) return;
  let state: ServerState | undefined;
  const webviews = assets.map(asset => ({ id: asset.id, name: asset.name, path: `/views/${asset.id}/` }));
  const snapshot = createSnapshotProvider({ ...configuration, webviews, signal: daemon.signal, server: () => serverInfo(state!) });
  const runtime = await startHttpServer({ port: configuration.port, token: configuration.token,
    instanceId: configuration.instanceId, assets, snapshot, shutdown: daemon.stop });
  daemon.onClose(() => runtime.close());
  if (daemon.cancelled()) return;
  const recorded: ServerState = { schemaVersion: 1, instanceId: configuration.instanceId, token: configuration.token,
    workspaceRoot: configuration.workspaceRoot, pid: process.pid, port: runtime.port,
    startedAt: new Date().toISOString(), version: configuration.version, nodeVersion: process.version, webviews };
  state = recorded;
  daemon.onClose(() => removeState(configuration.workspaceRoot, recorded.instanceId));
  await writeState(configuration.workspaceRoot, recorded);
});
