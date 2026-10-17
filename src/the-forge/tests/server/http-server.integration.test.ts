import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { request } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SystemSnapshot } from '../../src/application/server/contracts.ts';
import { discoverWebviews } from '../../src/infrastructure/server/assets.ts';
import { startHttpServer, type RunningHttpServer } from '../../src/infrastructure/server/http-server.ts';
import { viewToken } from '../../src/infrastructure/server/tokens.ts';

describe('localhost webview transport', () => {
  let directory: string;
  let running: RunningHttpServer;
  const token = 'only-the-cli-and-opened-view-know-this';
  const snapshot = vi.fn<() => Promise<SystemSnapshot>>();
  const shutdown = vi.fn<() => void>();

  const get = (pathname: string, options: { method?: string; headers?: Record<string, string> } = {}) =>
    new Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: string }>((resolve, reject) => {
      const pending = request({ host: '127.0.0.1', port: running.port, path: pathname, method: options.method ?? 'GET', headers: options.headers }, response => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => resolve({ status: response.statusCode ?? 0, headers: response.headers, body: Buffer.concat(chunks).toString() }));
      });
      pending.on('error', reject);
      pending.end();
    });
  const auth = () => ({ Authorization: `Bearer ${token}` });

  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'forge-http-'));
    const assets = path.join(directory, 'assets');
    await mkdir(assets);
    await writeFile(path.join(assets, 'index.html'), '<!doctype html><h1>Inspector</h1>');
    await writeFile(path.join(assets, 'app-Abcd1234.js'), 'export const ready = true;');
    await writeFile(path.join(assets, 'theme.css'), 'body { color: black; }');
    await writeFile(path.join(directory, 'secret.json'), '{"token":"private"}');
    snapshot.mockReset();
    shutdown.mockReset();
    snapshot.mockResolvedValue({
      schemaVersion: 1, updatedAt: '2026-10-11T12:00:00Z',
      availability: { config: true, projects: true, selectedProject: true, plugins: true, capabilities: true },
      server: { pid: process.pid, startedAt: '2026-10-11T11:00:00Z', host: '127.0.0.1', port: 0, version: '0.1.0', nodeVersion: process.version, uptimeSeconds: 3600 },
      workspace: { root: '/example', projectsPath: 'src', selectedProject: null }, projects: [], plugins: [],
      stats: { projects: 0, plugins: 0, enabledPlugins: 0, commands: 0, generators: 0, skills: 0 }, webviews: [], warnings: [],
    });
    running = await startHttpServer({
      port: 0, token, instanceId: 'test-instance', assets: [{ id: 'inspector', name: 'Inspector', directory: assets }], snapshot, shutdown,
    });
  });

  afterEach(async () => {
    await running.close();
    await rm(directory, { recursive: true, force: true });
  });

  it('requires bearer authentication without disclosing system state', async () => {
    const invalidHeaders: Record<string, string>[] = [{}, { Authorization: 'Bearer incorrect' }, { Authorization: token }];
    for (const headers of invalidHeaders) {
      const result = await get('/api/system', { headers });
      expect(result.status).toBe(401);
      expect(JSON.parse(result.body)).toMatchObject({ ok: false, error: { code: 'SERVER_UNAUTHORIZED' } });
    }
    expect((await get(`/api/system?token=${token}`)).status).toBe(401);
    expect(snapshot).not.toHaveBeenCalled();
    const result = await get('/api/system', { headers: auth() });
    expect(result.status).toBe(200);
    expect(JSON.parse(result.body)).toMatchObject({ ok: true, data: { workspace: { root: '/example' } } });
    expect(result.headers['cache-control']).toBe('no-store');
    expect(result.headers['access-control-allow-origin']).toBeUndefined();
    expect(snapshot).toHaveBeenCalledOnce();
  });

  it('provides an authenticated instance probe independent of the snapshot', async () => {
    expect((await get('/api/health')).status).toBe(401);
    const result = await get('/api/health', { headers: auth() });
    expect(JSON.parse(result.body)).toMatchObject({ ok: true, data: { schemaVersion: 1, instanceId: 'test-instance', pid: process.pid } });
    expect(snapshot).not.toHaveBeenCalled();
  });

  it('rejects DNS rebinding and cross-origin requests even with a token', async () => {
    const invalidHeaders: Record<string, string>[] = [
      { Host: `attacker.example:${running.port}` }, { Host: `localhost:${running.port}` },
      { Origin: 'https://attacker.example' }, { Origin: 'null' }, { Origin: 'http://127.0.0.1:1' },
    ];
    for (const headers of invalidHeaders) {
      expect((await get('/api/system', { headers: { ...auth(), ...headers } })).status).toBe(403);
    }
    expect(snapshot).not.toHaveBeenCalled();
    expect((await get('/api/system', { headers: { ...auth(), Origin: `http://127.0.0.1:${running.port}` } })).status).toBe(200);
    expect((await get('/views/inspector/', { headers: { Host: 'attacker.example' } })).status).toBe(403);
  });

  it('exposes generic mounted views without filesystem paths or credentials', async () => {
    const result = await get('/');
    expect(JSON.parse(result.body)).toEqual({ ok: true, data: { views: [{ id: 'inspector', name: 'Inspector', path: '/views/inspector/' }] } });
    expect(result.body).not.toContain(directory);
    expect(result.body).not.toContain(token);
    const redirect = await get('/views/inspector');
    expect(redirect.status).toBe(308);
    expect(redirect.headers.location).toBe('/views/inspector/');
  });

  it('serves correct static headers and never caches the entry document', async () => {
    const html = await get('/views/inspector/');
    expect(html.status).toBe(200);
    expect(html.body).toContain('<h1>Inspector</h1>');
    expect(html.headers['content-type']).toBe('text/html; charset=utf-8');
    expect(html.headers['cache-control']).toBe('no-store');
    expect(html.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(html.headers['referrer-policy']).toBe('no-referrer');
    expect(html.headers['x-content-type-options']).toBe('nosniff');
    const script = await get('/views/inspector/app-Abcd1234.js');
    expect(script.headers['content-type']).toBe('text/javascript; charset=utf-8');
    expect(script.headers['cache-control']).toBe('no-cache');
    const head = await get('/views/inspector/theme.css', { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(head.body).toBe('');
    expect(Number(head.headers['content-length'])).toBeGreaterThan(0);
    expect(head.headers['cache-control']).toBe('no-cache');
  });

  it('keeps replaced scripts revalidatable regardless of their filename', async () => {
    const filename = path.join(directory, 'assets', 'app-development.js');
    await writeFile(filename, 'export const version = 1;');
    const original = await get('/views/inspector/app-development.js');
    expect(original.headers['cache-control']).toBe('no-cache');
    await writeFile(filename, 'export const version = 2;');
    const updated = await get('/views/inspector/app-development.js');
    expect(updated.body).toBe('export const version = 2;');
    expect(updated.headers['cache-control']).toBe('no-cache');
  });

  it('rejects path traversal, malformed escaping, hidden files, and unknown assets', async () => {
    for (const pathname of [
      '/views/inspector/../secret.json', '/views/inspector/%2e%2e/secret.json',
      '/views/inspector/%2e%2e%2fsecret.json', '/views/inspector/%00.json', '/views/inspector/%zz',
      '/views/inspector/%5c..%5csecret.json', '//views/inspector/',
      '/views/inspector//index.html', '/views%2finspector/index.html',
      '/views/inspector/index.html%0a', '/views/inspector/index.html%7f',
      '/views/inspector/index.html:stream.json', '/views/inspector/index.html%3astream.json',
    ]) expect((await get(pathname)).status).toBe(400);
    await writeFile(path.join(directory, 'assets', '.credentials.json'), '{}');
    for (const pathname of ['/secret.json', '/views/missing/', '/views/inspector/.credentials.json', '/views/inspector/missing.js']) {
      expect((await get(pathname)).status).toBe(404);
    }
  });

  it('accepts escaped filenames and query strings without normalizing URL structure', async () => {
    await writeFile(path.join(directory, 'assets', 'theme contrast.css'), 'body { color: white; }');
    expect((await get('/views/inspector/theme%20contrast.css?source=%2f')).status).toBe(200);
    expect((await get('/views/inspector/?source=%zz')).status).toBe(200);
    expect((await get('/api%2fsystem', { headers: auth() })).status).toBe(400);
    expect(snapshot).not.toHaveBeenCalled();
  });

  it('refuses symlink files and directories outside the mounted assets', async () => {
    await symlink(path.join(directory, 'secret.json'), path.join(directory, 'assets', 'secret.json'), 'file');
    await symlink(directory, path.join(directory, 'assets', 'outside'), 'junction');
    expect((await get('/views/inspector/secret.json')).status).toBe(404);
    expect((await get('/views/inspector/outside/secret.json')).status).toBe(404);
  });

  it('discovers only valid packaged manifests with contained entry documents', async () => {
    expect(await discoverWebviews(directory)).toEqual([]);
    const views = path.join(directory, 'webviews');
    for (const id of ['inspector', 'missing', 'invalid', 'mismatched', 'linked', 'directory', 'manifest-link']) {
      await mkdir(path.join(views, id), { recursive: true });
      await writeFile(path.join(views, id, 'manifest.json'), JSON.stringify({ id, name: id, entry: 'index.html' }));
    }
    await writeFile(path.join(views, 'inspector', 'index.html'), '<h1>Available</h1>');
    await writeFile(path.join(views, 'invalid', 'manifest.json'), '{broken');
    await writeFile(path.join(views, 'mismatched', 'manifest.json'), JSON.stringify({ id: 'elsewhere', name: 'Wrong mount', entry: '../secret.json' }));
    await symlink(path.join(directory, 'secret.json'), path.join(views, 'linked', 'index.html'), 'file');
    await rm(path.join(views, 'directory', 'manifest.json'));
    await mkdir(path.join(views, 'directory', 'manifest.json'));
    await writeFile(path.join(views, 'directory', 'index.html'), '<h1>Invalid manifest</h1>');
    await rm(path.join(views, 'manifest-link', 'manifest.json'));
    await writeFile(path.join(directory, 'manifest.json'), JSON.stringify({ id: 'manifest-link', name: 'Linked manifest', entry: 'index.html' }));
    await symlink(path.join(directory, 'manifest.json'), path.join(views, 'manifest-link', 'manifest.json'), 'file');
    await writeFile(path.join(views, 'manifest-link', 'index.html'), '<h1>Linked manifest</h1>');
    expect(await discoverWebviews(directory)).toEqual([{ id: 'inspector', name: 'inspector', directory: path.join(views, 'inspector') }]);
    await writeFile(path.join(directory, 'assets', 'manifest.json'), '{"id":"inspector"}');
    expect((await get('/views/inspector/manifest.json')).status).toBe(404);
    await writeFile(path.join(directory, 'assets', 'MANIFEST.JSON'), '{"id":"inspector"}');
    expect((await get('/views/inspector/MANIFEST.JSON')).status).toBe(404);
  });

  it('only allows the control endpoint to stop the server using authenticated POST', async () => {
    expect((await get('/api/shutdown', { method: 'POST' })).status).toBe(401);
    expect((await get('/api/shutdown', { headers: auth() })).status).toBe(405);
    expect((await get('/api/shutdown', { method: 'POST', headers: { ...auth(), Origin: 'http://attacker.example' } })).status).toBe(403);
    expect(shutdown).not.toHaveBeenCalled();
    expect((await get('/api/shutdown', { method: 'POST', headers: auth() })).status).toBe(200);
    expect(shutdown).toHaveBeenCalledOnce();
  });

  it('lets a mounted view token read the inspection API but never stop the server', async () => {
    const view = { Authorization: `Bearer ${viewToken(token, 'inspector')}` };
    expect((await get('/api/system', { headers: view })).status).toBe(200);
    expect((await get('/api/health', { headers: view })).status).toBe(200);
    const refused = await get('/api/shutdown', { method: 'POST', headers: view });
    expect(refused.status).toBe(403);
    expect(JSON.parse(refused.body)).toMatchObject({ ok: false, error: { code: 'SERVER_FORBIDDEN' } });
    expect(shutdown).not.toHaveBeenCalled();
    // A token issued for a view this server does not mount grants nothing.
    expect((await get('/api/system', { headers: { Authorization: `Bearer ${viewToken(token, 'other')}` } })).status).toBe(401);
    expect((await get('/api/system', { headers: { Authorization: `Bearer ${viewToken('another-server', 'inspector')}` } })).status).toBe(401);
  });

  it('rejects mutation, preflight, and unknown API endpoints', async () => {
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS']) {
      const result = await get('/api/system', { method, headers: auth() });
      expect(result.status).toBe(405);
      expect(result.headers.allow).toBe('GET');
    }
    expect((await get('/views/inspector/', { method: 'POST' })).status).toBe(405);
    expect((await get('/api/files', { headers: auth() })).status).toBe(404);
    expect(snapshot).not.toHaveBeenCalled();
  });

  it('redacts unexpected snapshot failures and remains available', async () => {
    snapshot.mockRejectedValueOnce(new Error('secret-token-and-internal-path'));
    const result = await get('/api/system', { headers: auth() });
    expect(result.status).toBe(500);
    expect(JSON.parse(result.body)).toEqual({ ok: false, error: { code: 'SERVER_INTERNAL_ERROR', message: 'The server could not complete this request.' } });
    expect((await get('/api/system', { headers: auth() })).status).toBe(200);
  });
});
