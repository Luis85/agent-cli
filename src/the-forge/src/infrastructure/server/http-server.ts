import { timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { SystemSnapshot } from '../../application/server/contracts.ts';
import { hasUnsafePathCharacters, readAsset, type WebviewAsset } from './assets.ts';

export interface HttpServerOptions {
  port: number;
  token: string;
  instanceId: string;
  assets: readonly WebviewAsset[];
  snapshot: () => Promise<SystemSnapshot>;
  shutdown: () => Promise<void> | void;
}

export interface RunningHttpServer {
  port: number;
  close: () => Promise<void>;
}

const csp = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'";

function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(value));
}

function failure(response: ServerResponse, status: number, code: string, message: string): void {
  json(response, status, { ok: false, error: { code, message } });
}

function authorized(request: IncomingMessage, token: string): boolean {
  const supplied = Buffer.from(request.headers.authorization ?? '');
  const expected = Buffer.from(`Bearer ${token}`);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

function requestPath(request: IncomingMessage): string | undefined {
  const raw = request.url ?? '/';
  if (!raw.startsWith('/') || raw.startsWith('//')) return undefined;
  try {
    const pathname = raw.split('?')[0] ?? '';
    // Decode filename characters, not path separators. Each mount has one URL
    // shape, independent of filesystem normalization on the host platform.
    if (/%2f/i.test(pathname)) return undefined;
    const decoded = decodeURIComponent(pathname);
    if (hasUnsafePathCharacters(decoded) || decoded.includes('//') || decoded.split('/').some(part => part === '.' || part === '..')) return undefined;
    return decoded;
  } catch { return undefined; }
}

/** A loopback transport with explicit view mounts; no dependency on any particular webview. */
export async function startHttpServer(options: HttpServerOptions): Promise<RunningHttpServer> {
  if (!Number.isInteger(options.port) || options.port < 0 || options.port > 65535) throw new Error('Invalid localhost server port.');
  if (!options.token) throw new Error('A localhost server token is required.');
  const ids = new Set<string>();
  for (const asset of options.assets) {
    if (!/^[a-z][a-z0-9-]*$/.test(asset.id) || ids.has(asset.id)) throw new Error('Invalid or duplicate webview mount.');
    ids.add(asset.id);
  }
  const startedAt = new Date().toISOString();
  let port = options.port;
  const handle = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Content-Security-Policy', csp);
    response.setHeader('X-Frame-Options', 'DENY');
    const host = `127.0.0.1:${port}`;
    if (request.headers.host !== host || (request.headers.origin !== undefined && request.headers.origin !== `http://${host}`)) {
      failure(response, 403, 'SERVER_FORBIDDEN', 'Only same-origin localhost requests are accepted.');
      return;
    }
    const pathname = requestPath(request);
    if (pathname === undefined) { failure(response, 400, 'SERVER_BAD_REQUEST', 'Invalid request path.'); return; }
    if (pathname.startsWith('/api/')) {
      if (!authorized(request, options.token)) {
        response.setHeader('WWW-Authenticate', 'Bearer');
        failure(response, 401, 'SERVER_UNAUTHORIZED', 'A valid server access token is required.');
        return;
      }
      const methods: Record<string, string> = { '/api/health': 'GET', '/api/system': 'GET', '/api/shutdown': 'POST' };
      const method = methods[pathname];
      if (!method) { failure(response, 404, 'SERVER_NOT_FOUND', 'API endpoint not found.'); return; }
      if (request.method !== method) {
        response.setHeader('Allow', method);
        failure(response, 405, 'SERVER_METHOD_NOT_ALLOWED', 'The endpoint does not accept this method.');
        return;
      }
      if (pathname === '/api/health') json(response, 200, { ok: true, data: { schemaVersion: 1, instanceId: options.instanceId, pid: process.pid, startedAt } });
      else if (pathname === '/api/system') json(response, 200, { ok: true, data: await options.snapshot() });
      else {
        response.once('finish', () => { void Promise.resolve().then(() => options.shutdown()).catch(() => { server.closeAllConnections(); }); });
        json(response, 200, { ok: true, data: { stopping: true } });
      }
      return;
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.setHeader('Allow', 'GET, HEAD');
      failure(response, 405, 'SERVER_METHOD_NOT_ALLOWED', 'Static views accept GET and HEAD only.');
      return;
    }
    if (pathname === '/') {
      json(response, 200, { ok: true, data: { views: options.assets.map(asset => ({ id: asset.id, name: asset.name, path: `/views/${asset.id}/` })) } });
      return;
    }
    // Relative asset URLs need the mount's trailing slash.
    if (/^\/views\/[a-z][a-z0-9-]*$/.test(pathname) && ids.has(pathname.slice('/views/'.length))) {
      response.writeHead(308, { Location: `${pathname}/`, 'Cache-Control': 'no-store' });
      response.end();
      return;
    }
    const asset = await readAsset(options.assets, pathname);
    if (!asset) { failure(response, 404, 'SERVER_NOT_FOUND', 'Packaged webview asset not found.'); return; }
    response.writeHead(200, { 'Content-Type': asset.contentType, 'Content-Length': asset.bytes.length, 'Cache-Control': asset.cacheControl });
    response.end(request.method === 'HEAD' ? undefined : asset.bytes);
  };
  const server = createServer({ requestTimeout: 10_000, headersTimeout: 10_000, maxHeaderSize: 16_384 }, (request, response) => {
    void handle(request, response).catch(() => {
      if (response.headersSent) response.destroy();
      else failure(response, 500, 'SERVER_INTERNAL_ERROR', 'The server could not complete this request.');
    });
  });
  server.maxRequestsPerSocket = 100;
  server.keepAliveTimeout = 1000;
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port, '127.0.0.1', () => { server.off('error', reject); resolve(); });
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('The localhost server did not bind a TCP port.');
  port = address.port;
  return {
    port,
    close: () => new Promise<void>((resolve, reject) => {
      server.close(error => { if (error) reject(error); else resolve(); });
      server.closeAllConnections();
    }),
  };
}
