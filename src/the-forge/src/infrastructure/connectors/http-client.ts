import type { HttpClient, HttpRequest, HttpResponse } from '../../application/connectors/http.ts';

type Fetch = (url: string, init: { method: string; headers?: Record<string, string>; body?: string; signal: AbortSignal; redirect: 'manual' }) => Promise<Response>;

export interface FetchHttpOptions {
  fetch?: Fetch;
  sleep?: (milliseconds: number) => Promise<void>;
  /** Retries after a 429 or 503 response (default 3). */
  retries?: number;
  /** Default per-attempt timeout (default 30 s). */
  timeoutMs?: number;
  /** Upper bound of one wait between attempts (default 60 s). */
  maxDelayMs?: number;
}

const retryable = new Set([429, 503]);

/** Milliseconds a `Retry-After` header asks for (seconds or an HTTP date), or null. */
export function retryAfter(value: string | null, now = Date.now()): number | null {
  if (value === null || value.trim() === '') return null;
  const seconds = Number(value.trim());
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? null : Math.max(0, date - now);
}

/**
 * The HTTP port over global `fetch`. Each attempt has its own timeout; 429 and 503 responses are retried with the
 * server's `Retry-After` delay, else exponential backoff from one second, each wait capped by `maxDelayMs`.
 * Redirects are returned, never followed, so credentials are sent only to the configured host.
 */
export class FetchHttpClient implements HttpClient {
  private readonly fetch: Fetch;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly retries: number;
  private readonly timeoutMs: number;
  private readonly maxDelayMs: number;

  constructor(options: FetchHttpOptions = {}) {
    this.fetch = options.fetch ?? ((url, init) => globalThis.fetch(url, init));
    this.sleep = options.sleep ?? (milliseconds => new Promise(resolve => { setTimeout(resolve, milliseconds); }));
    this.retries = options.retries ?? 3;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.maxDelayMs = options.maxDelayMs ?? 60_000;
  }

  async request(request: HttpRequest): Promise<HttpResponse> {
    for (let attempt = 0; ; attempt++) {
      const response = await this.attempt(request);
      if (!retryable.has(response.status) || attempt >= this.retries) return response;
      const asked = retryAfter(response.headers['retry-after'] ?? null);
      await this.sleep(Math.min(asked ?? 1000 * 2 ** attempt, this.maxDelayMs));
    }
  }

  private async attempt(request: HttpRequest): Promise<HttpResponse> {
    const timeout = request.timeoutMs ?? this.timeoutMs;
    let response: Response;
    try {
      response = await this.fetch(request.url, {
        method: request.method, ...(request.headers ? { headers: { ...request.headers } } : {}),
        ...(request.body === undefined ? {} : { body: request.body }), signal: AbortSignal.timeout(timeout), redirect: 'manual',
      });
    } catch (error) {
      const reason = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError') ? `timed out after ${timeout} ms` : 'could not connect';
      throw new Error(`${request.method} ${request.url} ${reason}.`);
    }
    const headers: Record<string, string> = {};
    response.headers.forEach((value, name) => { headers[name.toLowerCase()] = value; });
    return { status: response.status, headers, body: await response.text() };
  }
}
