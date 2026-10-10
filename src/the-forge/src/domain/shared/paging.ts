import { ensure, isRecord } from './errors.ts';

/** A position in a result order: compared element by element, strings by code unit and numbers numerically. */
export type PageKey = readonly (string | number)[];
/** `limit` caps the page size; `cursor` continues after the last item of the page that returned it. */
export interface PageRequest { limit?: number; cursor?: string }

const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function base64url(bytes: Uint8Array): string {
  let text = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const chunk = (bytes[index]! << 16) | ((bytes[index + 1] ?? 0) << 8) | (bytes[index + 2] ?? 0);
    const length = Math.min(3, bytes.length - index) + 1;
    for (let position = 0; position < length; position++) text += alphabet[(chunk >> (18 - position * 6)) & 63];
  }
  return text;
}
function fromBase64url(text: string): Uint8Array | undefined {
  if (!/^[A-Za-z0-9_-]*$/.test(text) || text.length % 4 === 1) return undefined;
  const bytes: number[] = [];
  for (let index = 0; index < text.length; index += 4) {
    const group = text.slice(index, index + 4);
    let chunk = 0;
    for (let position = 0; position < 4; position++) chunk = (chunk << 6) | (position < group.length ? alphabet.indexOf(group[position]!) : 0);
    for (let position = 0; position < group.length - 1; position++) bytes.push((chunk >> (16 - position * 8)) & 255);
  }
  return Uint8Array.from(bytes);
}
/** FNV-1a over the canonical query, so a cursor is only accepted by the query that issued it. */
function fingerprint(query: unknown): string {
  let hash = 0x811c9dc5;
  for (const char of JSON.stringify(query)) hash = Math.imul(hash ^ char.charCodeAt(0), 0x01000193) >>> 0;
  return hash.toString(16).padStart(8, '0');
}
const validKey = (value: unknown): value is PageKey =>
  Array.isArray(value) && value.length > 0 && value.every(part => typeof part === 'string' || (typeof part === 'number' && Number.isSafeInteger(part)));

export function compareKeys(a: PageKey, b: PageKey): number {
  for (let index = 0; index < Math.min(a.length, b.length); index++) {
    const left = a[index]!, right = b[index]!;
    if (left === right) continue;
    if (typeof left === 'number' && typeof right === 'number') return left - right;
    return String(left) < String(right) ? -1 : 1;
  }
  return a.length - b.length;
}

/**
 * Collects one page of items offered in ascending key order. The cursor encodes the last returned key and a
 * fingerprint of `query` (the request without paging options); a malformed cursor, or one issued for another
 * query, is INVALID_ARGUMENT. Items at or before the cursor are skipped, so a page continues correctly when
 * earlier items were added or removed in between.
 */
export class Pager<Item> {
  readonly items: Item[] = [];
  /** Every offered item, including those before the cursor and after the page. */
  total = 0;
  private readonly after: PageKey | undefined;
  private more = false;

  constructor(private readonly request: PageRequest, private readonly query: unknown, private readonly key: (item: Item) => PageKey) {
    ensure(request.limit === undefined || (Number.isSafeInteger(request.limit) && request.limit > 0), 'INVALID_ARGUMENT', '--limit must be a positive integer.');
    this.after = request.cursor === undefined ? undefined : this.decode(request.cursor);
  }

  offer(item: Item): void {
    this.total++;
    if (this.more || (this.after !== undefined && compareKeys(this.key(item), this.after) <= 0)) return;
    if (this.request.limit !== undefined && this.items.length >= this.request.limit) this.more = true;
    else this.items.push(item);
  }

  /** The cursor for the next page, or undefined when this page is the last one. */
  nextCursor(): string | undefined {
    if (!this.more) return undefined;
    return base64url(new TextEncoder().encode(JSON.stringify({ q: fingerprint(this.query), after: this.key(this.items.at(-1)!) })));
  }

  private decode(cursor: string): PageKey {
    let value: unknown;
    try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(fromBase64url(cursor) ?? new Uint8Array([0xff]))); }
    catch { value = undefined; }
    ensure(isRecord(value) && validKey(value.after), 'INVALID_ARGUMENT', '--cursor is not a cursor returned by this command; rerun without --cursor.');
    ensure(value.q === fingerprint(this.query), 'INVALID_ARGUMENT', '--cursor belongs to a different query; pass the same pattern and filters, or rerun without --cursor.');
    return value.after;
  }
}
