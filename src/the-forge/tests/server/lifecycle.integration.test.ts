import { createServer } from 'node:http';
import { createServer as createTcpServer, Socket, type Server } from 'node:net';
import { execFileSync, spawn } from 'node:child_process';
import { copyFile, lstat, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NodeServerController } from '../../src/infrastructure/server/controller.ts';
import { readState, writeState, type ServerState } from '../../src/infrastructure/server/state.ts';
import { distribution } from '../support/workspace.ts';

const staleState = (workspaceRoot: string): ServerState => ({ schemaVersion: 1, instanceId: '00000000-0000-0000-0000-000000000000',
  token: 'f'.repeat(64), workspaceRoot, pid: process.pid, port: 1, startedAt: new Date().toISOString(), version: '0.1.0', nodeVersion: process.version, webviews: [] });

async function listen(server: Server): Promise<number> {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing address');
  return address.port;
}

describe('detached server lifecycle', () => {
  let root: string;
  let controller: NodeServerController;
  beforeEach(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'forge-server-')));
    await mkdir(join(root, 'bin'));
    await copyFile(join(distribution, 'forge-server.cjs'), join(root, 'bin/forge-server.cjs'));
    controller = new NodeServerController({ workspaceRoot: root, distributionPath: join(root, 'bin'), version: '0.1.0' });
  });
  afterEach(async () => {
    await controller.stop({ dryRun: false }).catch(() => undefined);
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  it('starts a detached API without a webview and stops only its verified instance', async () => {
    const result = await controller.start({ port: 0, dryRun: false });
    expect(result).toMatchObject({ running: true, changed: true, stale: false, webviews: [] });
    expect(result.server?.pid).not.toBe(process.pid);
    expect(result.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/#token=[a-f0-9]{64}$/);
    const state = await readState(root);
    expect(state?.token).toBe(new URL(result.url!).hash.slice('#token='.length));
    if (process.platform !== 'win32') expect((await lstat(join(root, '.forge/server.json'))).mode & 0o777).toBe(0o600);
    expect((await controller.status()).server?.pid).toBe(result.server?.pid);
    const repeated = await controller.start({ dryRun: false });
    expect(repeated).toMatchObject({ running: true, changed: false, server: { pid: result.server?.pid } });
    expect(await controller.stop({ dryRun: false })).toMatchObject({ running: false, changed: true });
    expect(await readState(root)).toBeNull();
    expect(await controller.status()).toMatchObject({ running: false, stale: false });
  });

  it('cancels startup when its parent disconnects before readiness', async () => {
    const child = spawn(process.execPath, [join(root, 'bin/forge-server.cjs')], { cwd: root, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
    const exited = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => { child.kill(); reject(new Error('Cancelled startup remained alive')); }, 5000);
      child.once('exit', () => { clearTimeout(timeout); resolve(); });
      child.once('error', reject);
    });
    child.send({ workspaceRoot: root, distributionPath: join(root, 'bin'), version: '0.1.0', port: 0,
      instanceId: '00000000-0000-0000-0000-000000000000', token: 'f'.repeat(64) });
    child.disconnect();
    await exited;
    expect(await readState(root)).toBeNull();
  });

  it('ignores private state while preserving existing ignore bytes and entries', async () => {
    await mkdir(join(root, '.forge'));
    const existing = '# Keep project markers tracked\r\n/custom-cache\r\n';
    await writeFile(join(root, '.forge/.gitignore'), existing);
    await controller.start({ dryRun: true });
    expect(await readFile(join(root, '.forge/.gitignore'), 'utf8')).toBe(existing);
    await controller.start({ dryRun: false });
    const ignored = await readFile(join(root, '.forge/.gitignore'), 'utf8');
    expect(ignored.startsWith(existing)).toBe(true);
    expect(ignored).toContain('/server.json\r\n');
    await controller.stop({ dryRun: false });
    await controller.start({ dryRun: false });
    expect(await readFile(join(root, '.forge/.gitignore'), 'utf8')).toBe(ignored);
  });

  it('refuses symlinked ignore files without modifying their target', async () => {
    await mkdir(join(root, '.forge'));
    const outside = join(root, 'outside-ignore');
    await writeFile(outside, 'sentinel');
    await symlink(outside, join(root, '.forge/.gitignore'));
    await expect(controller.start({ dryRun: false })).rejects.toMatchObject({ code: 'SERVER_STATE_INVALID' });
    expect(await readFile(outside, 'utf8')).toBe('sentinel');
    expect(await readState(root)).toBeNull();
  });

  it('keeps credentials ignored when existing rules are followed by a negation', async () => {
    execFileSync('git', ['init', '--quiet', root]);
    await mkdir(join(root, '.forge'));
    const existing = '/server.json\n/server.lock\n/.server-*.tmp\n/.agent-cli-tmp-*\n!*\n';
    await writeFile(join(root, '.forge/.gitignore'), existing);
    await controller.start({ dryRun: false });
    expect((await readFile(join(root, '.forge/.gitignore'), 'utf8')).startsWith(existing)).toBe(true);
    expect(execFileSync('git', ['check-ignore', '.forge/server.json'], { cwd: root, encoding: 'utf8' }).trim()).toBe('.forge/server.json');
  });

  it.skipIf(process.platform === 'win32').each(['server.json', '.gitignore'])('rejects a named pipe at %s without waiting for a writer', async filename => {
    await mkdir(join(root, '.forge'));
    const path = join(root, '.forge', filename);
    execFileSync('mkfifo', [path]);
    await expect(controller.start({ dryRun: false })).rejects.toMatchObject({ code: 'SERVER_STATE_INVALID' });
    expect((await lstat(path)).isFIFO()).toBe(true);
  });

  it('does not create lifecycle state when stopping an inactive workspace', async () => {
    expect(await controller.stop({ dryRun: false })).toMatchObject({ running: false, changed: false });
    await expect(lstat(join(root, '.forge'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('serializes concurrent starts into one server', async () => {
    const [first, second] = await Promise.all([controller.start({ dryRun: false }), controller.start({ dryRun: false })]);
    expect(first.server?.pid).toBe(second.server?.pid);
    expect([first.changed, second.changed].sort()).toEqual([false, true]);
  });

  it('dry runs do not create state, launch a process, or stop an existing server', async () => {
    expect(await controller.start({ dryRun: true })).toMatchObject({ running: false, dryRun: true, changed: true });
    await expect(lstat(join(root, '.forge'))).rejects.toMatchObject({ code: 'ENOENT' });
    const started = await controller.start({ dryRun: false });
    expect(await controller.stop({ dryRun: true })).toMatchObject({ running: true, dryRun: true, server: { pid: started.server?.pid } });
    expect((await controller.status()).running).toBe(true);
  });

  it('returns the explicit installed webview URL and rejects missing views before startup', async () => {
    await expect(controller.start({ webview: 'missing', dryRun: false })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    const view = join(root, 'bin/webviews/admin');
    await mkdir(view, { recursive: true });
    await writeFile(join(view, 'manifest.json'), JSON.stringify({ id: 'admin', name: 'Admin', entry: 'index.html' }));
    await writeFile(join(view, 'index.html'), '<h1>Admin</h1>');
    expect(await controller.status()).toMatchObject({ running: false, stale: false, webviews: [{ id: 'admin', name: 'Admin', path: '/views/admin/' }] });
    await expect(lstat(join(root, '.forge'))).rejects.toMatchObject({ code: 'ENOENT' });
    await writeState(root, staleState(root));
    expect(await controller.status()).toMatchObject({ running: false, stale: true, webviews: [{ id: 'admin', name: 'Admin', path: '/views/admin/' }] });
    const result = await controller.start({ webview: 'admin', dryRun: false });
    expect(new URL(result.url!).pathname).toBe('/views/admin/');
    expect(result.webviews).toEqual([{ id: 'admin', name: 'Admin', path: '/views/admin/' }]);
  });

  it('never signals a stale PID belonging to an unrelated process', async () => {
    await writeState(root, staleState(root));
    expect(await controller.status()).toMatchObject({ running: false, stale: true });
    expect(await controller.stop({ dryRun: false })).toMatchObject({ running: false, stale: true, changed: false });
    expect((await readState(root))?.pid).toBe(process.pid);
    expect(await controller.start({ dryRun: false })).toMatchObject({ running: true, stale: false });
  });

  it('controls the daemon without socket QoS calls that macOS rejects on connections the daemon already reset', async () => {
    const started = await controller.start({ dryRun: false });
    // XNU fails setsockopt() with EINVAL once the peer has shut the connection down. Node 24's bundled fetch sets the
    // type of service on each new socket and throws that from the connect event, outside any awaiting caller.
    const descriptor = Object.getOwnPropertyDescriptor(Socket.prototype, 'setTypeOfService');
    let calls = 0;
    Object.defineProperty(Socket.prototype, 'setTypeOfService', { configurable: true, writable: true, value: () => {
      calls++;
      throw Object.assign(new Error('setTypeOfService EINVAL'), { errno: -22, code: 'EINVAL', syscall: 'setTypeOfService' });
    } });
    try {
      expect(await controller.status()).toMatchObject({ running: true, server: { pid: started.server?.pid } });
      expect(await controller.stop({ dryRun: false })).toMatchObject({ running: false, changed: true });
    } finally {
      if (descriptor) Object.defineProperty(Socket.prototype, 'setTypeOfService', descriptor);
      else Reflect.deleteProperty(Socket.prototype, 'setTypeOfService');
    }
    expect(calls).toBe(0);
    expect(await readState(root)).toBeNull();
  });

  it.each([
    ['resets every connection', (socket: Socket) => { socket.resetAndDestroy(); }],
    ['accepts connections without answering', () => undefined],
  ])('reports a recorded daemon that %s as stale without stopping it', async (_case, accept) => {
    const sockets = new Set<Socket>();
    const other = createTcpServer(socket => { sockets.add(socket); socket.on('error', () => undefined); accept(socket); });
    try {
      await writeState(root, { ...staleState(root), port: await listen(other) });
      expect(await controller.status()).toMatchObject({ running: false, stale: true, server: null });
      expect(await controller.stop({ dryRun: false })).toMatchObject({ running: false, stale: true, changed: false });
      expect((await readState(root))?.pid).toBe(process.pid);
    } finally {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve, reject) => other.close(error => error ? reject(error) : resolve()));
    }
  });

  it('reports occupied ports without altering a healthy unrelated server', async () => {
    const other = createServer((_request, response) => response.end('other'));
    await new Promise<void>(resolve => other.listen(0, '127.0.0.1', resolve));
    const address = other.address();
    try {
      if (!address || typeof address === 'string') throw new Error('Missing address');
      await expect(controller.start({ port: address.port, dryRun: false })).rejects.toMatchObject({ code: 'SERVER_START_FAILED' });
      expect(await (await fetch(`http://127.0.0.1:${address.port}`)).text()).toBe('other');
      expect(await readState(root)).toBeNull();
    } finally { await new Promise<void>((resolve, reject) => other.close(error => error ? reject(error) : resolve())); }
  });

  it('refuses symlinked state directories and never follows their state files', async () => {
    const outside = join(root, 'outside');
    await mkdir(outside);
    await writeFile(join(outside, 'server.json'), 'sentinel');
    await symlink(outside, join(root, '.forge'), process.platform === 'win32' ? 'junction' : 'dir');
    await expect(controller.status()).rejects.toMatchObject({ code: 'SERVER_STATE_INVALID' });
    await expect(controller.start({ dryRun: false })).rejects.toMatchObject({ code: 'SERVER_STATE_INVALID' });
    expect(await readFile(join(outside, 'server.json'), 'utf8')).toBe('sentinel');
  });

  it('validates ports before any filesystem mutation', async () => {
    await expect(controller.start({ port: -1, dryRun: false })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    await expect(controller.start({ port: 65536, dryRun: false })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    await expect(controller.start({ port: 1.5, dryRun: false })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    await expect(lstat(join(root, '.forge'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
