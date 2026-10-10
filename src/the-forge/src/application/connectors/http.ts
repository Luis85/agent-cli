/**
 * The HTTP transport port connectors use. The kernel adapter wraps global `fetch` with a timeout per attempt and
 * retries 429 and 503 responses, honoring `Retry-After`. A request that cannot complete (timeout, refused
 * connection) rejects with an Error whose message names the method and URL; it never carries request headers.
 */
export interface HttpRequest {
  method: 'GET' | 'POST' | 'PATCH';
  url: string;
  headers?: Readonly<Record<string, string>>;
  body?: string;
  /** Per-attempt timeout; the adapter's default applies when omitted. */
  timeoutMs?: number;
}
/** A completed exchange; header names are lowercase. */
export interface HttpResponse { status: number; headers: Readonly<Record<string, string>>; body: string }
export interface HttpClient { request(request: HttpRequest): Promise<HttpResponse> }
