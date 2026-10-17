import { spawn } from 'node:child_process';
import { request as httpRequest } from 'node:http';
import { realpath, access } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { forgeError, isRecord, type AppError } from '../../domain/shared/errors.ts';
import type { ServerController, ServerInfo, ServerStatus } from '../../application/server/contracts.ts';
import { ensureStateIgnored, readState, removeState, withServerLock, type ServerState } from './state.ts';
import { processAlive } from '../workspace/process-probe.ts';
import { discoverWebviews } from './assets.ts';
import { viewToken } from './tokens.ts';

export interface ServerControllerOptions { workspaceRoot: string; distributionPath: string; version: string }
export interface DaemonConfiguration extends ServerControllerOptions { port: number; instanceId: string; token: string }
export function serverInfo(state: ServerState): ServerInfo {
  return { pid: state.pid, startedAt: state.startedAt, host: '127.0.0.1', port: state.port, version: state.version,
    nodeVersion: state.nodeVersion, uptimeSeconds: Math.max(0, Math.floor((Date.now() - Date.parse(state.startedAt)) / 1000)) };
}
/**
 * Calls the daemon over a fresh, unpooled loopback connection without following redirects; every transport failure
 * and the timeout reject. Global fetch is
 * unsuitable: Node 24's bundled undici sets the IP type of service on each new socket and throws from the socket's
 * connect event when that fails, which macOS does for a connection the stopping daemon already reset.
 */
function callDaemon(state: ServerState, method: 'GET' | 'POST', path: string, timeoutMs: number): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const request = httpRequest({ host: '127.0.0.1', port: state.port, method, path, agent: false,
      headers: { authorization: `Bearer ${state.token}` }, signal: AbortSignal.timeout(timeoutMs) }, response => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('error', reject);
      response.on('close', () => reject(new Error('The daemon closed the response early.')));
      response.on('end', () => resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }));
    });
    request.on('error', reject);
    request.on('close', () => reject(new Error('The daemon closed the connection.')));
    request.end();
  });
}
const succeeded = (status: number): boolean => status >= 200 && status < 300;
async function healthy(state: ServerState): Promise<boolean> {
  try {
    const response = await callDaemon(state, 'GET', '/api/health', 1200);
    if (!succeeded(response.status)) return false;
    const body: unknown = JSON.parse(response.body);
    const health = isRecord(body) && isRecord(body.data) ? body.data : body;
    return isRecord(health) && health.instanceId === state.instanceId && health.pid === state.pid;
  } catch { return false; }
}
const stopped = (stale = false): ServerStatus => ({ running: false, stale, server: null, url: null, webviews: [] });
/** A view's launch link carries only that view's read-only token; the public catalog link carries none. */
function running(state: ServerState, webview?: string): ServerStatus {
  const selected = webview ? state.webviews.find(view => view.id === webview) : undefined;
  if (webview && !selected) throw forgeError('INVALID_ARGUMENT', `Webview '${webview}' is not installed.`);
  const origin = `http://127.0.0.1:${state.port}`;
  return { running: true, stale: false, server: serverInfo(state),
    url: selected ? `${origin}${selected.path}#token=${viewToken(state.token, selected.id)}` : `${origin}/`, webviews: state.webviews };
}

export class NodeServerController implements ServerController {
  constructor(private readonly options: ServerControllerOptions) {}
  private async root(): Promise<string> { return realpath(this.options.workspaceRoot); }
  async status(): Promise<ServerStatus> {
    const state = await readState(await this.root());
    if (state && await healthy(state)) return running(state);
    const assets = await discoverWebviews(await realpath(this.options.distributionPath));
    return { ...stopped(Boolean(state)), webviews: assets.map(asset => ({ id: asset.id, name: asset.name, path: `/views/${asset.id}/` })) };
  }
  async start(options: { port?: number; webview?: string; dryRun: boolean }): Promise<ServerStatus> {
    const port = options.port ?? 0;
    if (!Number.isInteger(port) || port < 0 || port > 65535) throw forgeError('INVALID_ARGUMENT', 'Port must be an integer from 0 to 65535.');
    const workspaceRoot = await this.root();
    const distributionPath = await realpath(this.options.distributionPath);
    const assets = await discoverWebviews(distributionPath);
    if (options.webview && !assets.some(asset => asset.id === options.webview)) throw forgeError('INVALID_ARGUMENT', `Webview '${options.webview}' is not installed.`);
    const existing = await readState(workspaceRoot);
    if (existing && await healthy(existing)) return { ...running(existing, options.webview), changed: false, ...(options.dryRun ? { dryRun: true } : {}) };
    if (options.dryRun) return { ...stopped(Boolean(existing)), dryRun: true, changed: true, webviews: assets.map(asset => ({ id: asset.id, name: asset.name, path: `/views/${asset.id}/` })) };
    return withServerLock(workspaceRoot, async () => {
      const latest = await readState(workspaceRoot);
      if (latest && await healthy(latest)) return { ...running(latest, options.webview), changed: false };
      const entry = join(distributionPath, 'forge-server.cjs');
      try { await access(entry); } catch { throw forgeError('SERVER_START_FAILED', 'The server runtime is missing. Rebuild or reinstall the Forge distribution.'); }
      await ensureStateIgnored(workspaceRoot);
      const configuration: DaemonConfiguration = { ...this.options, workspaceRoot, distributionPath, port, instanceId: randomUUID(), token: randomBytes(32).toString('hex') };
      await this.launch(entry, configuration);
      const state = await readState(workspaceRoot);
      if (!state || state.instanceId !== configuration.instanceId || !await healthy(state)) throw forgeError('SERVER_START_FAILED', 'The server did not pass its readiness check.');
      return { ...running(state, options.webview), changed: true };
    });
  }
  private launch(entry: string, configuration: DaemonConfiguration): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [entry], { cwd: configuration.workspaceRoot, detached: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'], windowsHide: true });
      let settled = false;
      const finish = (error?: AppError): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (child.connected) child.disconnect();
        if (error) {
          if (child.exitCode !== null || child.signalCode !== null || !child.pid) reject(error);
          else { child.once('exit', () => reject(error)); child.kill('SIGTERM'); }
        } else { child.unref(); resolve(); }
      };
      const timeout = setTimeout(() => finish(forgeError('SERVER_START_FAILED', 'Server startup timed out.')), 12_000);
      child.once('error', () => finish(forgeError('SERVER_START_FAILED', 'Could not launch the server process.')));
      child.once('exit', () => finish(forgeError('SERVER_START_FAILED', 'The server exited before becoming ready.')));
      child.on('message', message => {
        if (!isRecord(message)) return;
        if (message.type === 'ready' && message.instanceId === configuration.instanceId) finish();
        else if (message.type === 'error') finish(forgeError('SERVER_START_FAILED', message.code === 'EADDRINUSE' ? 'The requested port is already in use. Choose another port or use --port 0.' : 'The server could not initialize. Check the runtime files and workspace permissions.'));
      });
      child.send(configuration, error => { if (error) finish(forgeError('SERVER_START_FAILED', 'Could not configure the server process.')); });
    });
  }
  async stop(options: { dryRun: boolean }): Promise<ServerStatus> {
    const workspaceRoot = await this.root();
    const stop = async (): Promise<ServerStatus> => {
      const state = await readState(workspaceRoot);
      if (!state || !await healthy(state)) return { ...stopped(Boolean(state)), changed: false, ...(options.dryRun ? { dryRun: true } : {}) };
      if (options.dryRun) return { ...running(state), dryRun: true, changed: true };
      try {
        const response = await callDaemon(state, 'POST', '/api/shutdown', 2000);
        if (!succeeded(response.status)) throw new Error('Shutdown rejected.');
        const deadline = Date.now() + 5000;
        // A closed listener does not mean the daemon has released its workspace.
        // Windows keeps the working directory locked until the process exits; a process of another user still exists.
        while (process.platform === 'win32' ? processAlive(state.pid) === true : await healthy(state)) {
          if (Date.now() >= deadline) throw new Error('Shutdown timed out.');
          await new Promise(resolve => setTimeout(resolve, 75));
        }
        await removeState(workspaceRoot, state.instanceId);
        return { ...stopped(), changed: true };
      } catch { throw forgeError('SERVER_STOP_FAILED', 'The verified server did not stop. Retry server status and server stop.'); }
    };
    return options.dryRun || !await readState(workspaceRoot) ? stop() : withServerLock(workspaceRoot, stop);
  }
}
