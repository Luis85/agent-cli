/**
 * Tolerant frontmatter readers and civil dates, as backlog-view reads them (`domain/noteFields.ts`,
 * `domain/timeline.ts`). A reader never throws: an unreadable value is reported as `invalid`.
 */
export interface CivilDate { year: number; month: number; day: number }
export interface FieldReading<T> { value: T | null; invalid: boolean }
export type Frontmatter = Record<string, unknown>;

export const absent = <T>(): FieldReading<T> => ({ value: null, invalid: false });

/** A key the note itself holds, never one inherited from `Object.prototype`. */
export function ownValue(frontmatter: Frontmatter | undefined, key: string): unknown {
  return frontmatter !== undefined && key !== '' && Object.hasOwn(frontmatter, key) ? frontmatter[key] : undefined;
}

/** Defines a key as an own property, so a key named `__proto__` is data. */
export function setOwn(frontmatter: Frontmatter, key: string, value: unknown): void {
  Object.defineProperty(frontmatter, key, { value, writable: true, enumerable: true, configurable: true });
}

/** A trimmed nonempty string; a list reads its first entry; numbers and booleans read as text. */
export function readString(value: unknown): string | null {
  if (typeof value === 'string') { const trimmed = value.trim(); return trimmed.length > 0 ? trimmed : null; }
  if (Array.isArray(value)) return value.length > 0 ? readString(value[0]) : null;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return null;
}

/** A finite number or numeric string (`parseFloat`, like the plugin). */
export function readNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') { const parsed = Number.parseFloat(value); if (Number.isFinite(parsed)) return parsed; }
  return null;
}

/** Case-insensitive equality, with null equal only to null. */
export function sameValue(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return a === b;
  return a.toLowerCase() === b.toLowerCase();
}

/** A declared value in its declared spelling (matched like `sameValue`), or the value as given. */
export function declaredSpelling(values: readonly string[], value: string): string {
  return values.find(entry => sameValue(entry, value)) ?? value;
}

/** Link text from a raw frontmatter value: `[[Note#Heading|Alias]]` and bare `Note` both give `Note`. */
export function linkpathFromRawValue(raw: string): string {
  let linkpath = raw.trim();
  const wiki = /^\[\[([^\]]+)\]\]$/.exec(linkpath);
  if (wiki) linkpath = wiki[1]!;
  return linkpath.split('|')[0]!.split('#')[0]!.trim();
}

const tagKey = (tag: string) => tag.toLowerCase();
export const hasTag = (tags: readonly string[], tag: string) => tags.some(existing => tagKey(existing) === tagKey(tag));

/** Tags from a list or a comma/space separated string, `#` stripped, first spelling kept. */
export function readTags(value: unknown): string[] {
  const tags: string[] = [];
  for (const entry of Array.isArray(value) ? value : [value]) {
    if (typeof entry !== 'string') continue;
    for (const part of entry.split(/[,\s]+/)) {
      const tag = part.trim().replace(/^#+/, '');
      if (tag.length > 0 && !hasTag(tags, tag)) tags.push(tag);
    }
  }
  return tags;
}

/** A tag as Obsidian accepts it: letters, digits, `_`, `/` and inner `-`; all-digit tags are refused (empty). */
export function normalizeTag(input: string): string {
  const tag = input.trim()
    .replace(/^[^\p{L}\p{N}\p{M}_/-]+|[^\p{L}\p{N}\p{M}_/-]+$/gu, '')
    .replace(/[^\p{L}\p{N}\p{M}_/]*[^\p{L}\p{N}\p{M}_/-][^\p{L}\p{N}\p{M}_/]*/gu, '-')
    .replace(/\/{2,}/g, '/')
    .replace(/^\/+|\/+$/g, '');
  return /[^\p{N}]/u.test(tag) ? tag : '';
}

/**
 * Tags typed by a user, read like a frontmatter tags string (split on commas and whitespace, leading `#`
 * stripped) and then `normalizeTag`ged as backlog-view's tag editor writes them; tags Obsidian would not read
 * (such as all-digit ones) are dropped and duplicates removed case-insensitively, keeping the first spelling.
 */
export function typedTags(entries: readonly string[]): string[] {
  const tags: string[] = [];
  for (const tag of readTags([...entries]).map(normalizeTag)) if (tag.length > 0 && !hasTag(tags, tag)) tags.push(tag);
  return tags;
}

/** A horizon-like label: empty values are absent, other non-text values unreadable. */
export function readPlacement(value: unknown): FieldReading<string> {
  if (value === null || value === undefined) return absent();
  const text = readString(value);
  if (text !== null) return { value: text, invalid: false };
  const emptyish = typeof value === 'string' || (Array.isArray(value) && value.length === 0);
  return { value: null, invalid: !emptyish };
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** `YYYY-M-D` with an optional time suffix; month and day are validated. A list reads its first entry. */
export function readDate(value: unknown): FieldReading<CivilDate> {
  if (value === null || value === undefined) return absent();
  if (Array.isArray(value)) return value.length > 0 ? readDate(value[0]) : absent();
  if (typeof value !== 'string') return { value: null, invalid: true };
  const text = value.trim();
  if (text.length === 0) return absent();
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})([Tt\s].*)?$/.exec(text);
  if (!match) return { value: null, invalid: true };
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return { value: null, invalid: true };
  return { value: { year, month, day }, invalid: false };
}

/** A release date: exactly one valid date; a list or an empty string is unreadable. */
export function readSoleDate(raw: unknown): FieldReading<CivilDate> {
  if (Array.isArray(raw)) return { value: null, invalid: true };
  if (typeof raw === 'string' && raw.trim() === '') return { value: null, invalid: true };
  return readDate(raw);
}

const utc = (date: CivilDate) => Date.UTC(date.year, date.month - 1, date.day);
export function daysBetween(a: CivilDate, b: CivilDate): number { return Math.round((utc(b) - utc(a)) / 86_400_000); }

export function addDays(date: CivilDate, days: number): CivilDate {
  const moved = new Date(utc(date) + days * 86_400_000);
  return { year: moved.getUTCFullYear(), month: moved.getUTCMonth() + 1, day: moved.getUTCDate() };
}

export function formatCivil(date: CivilDate): string {
  const pad = (n: number, width: number) => String(n).padStart(width, '0');
  return `${pad(date.year, 4)}-${pad(date.month, 2)}-${pad(date.day, 2)}`;
}

export function reversedSpan(start: CivilDate | null, target: CivilDate | null): boolean {
  return start !== null && target !== null && daysBetween(start, target) < 0;
}

export const sameCivil = (a: CivilDate, b: CivilDate | null) => b !== null && a.year === b.year && a.month === b.month && a.day === b.day;
