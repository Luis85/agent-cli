import { sameValue } from './fields.ts';
import { sanitizeTitle } from './notes.ts';

/**
 * Field comparison for the backlog sync engine. Field keys are the neutral sync fields (`title`, `state`, …) and
 * `property:<key>` for extra mapped frontmatter properties. Values are compared in canonical form, in the remote
 * vocabulary, so both sides hash the same text when they agree.
 */
export type FieldValue = string | number | boolean | string[] | null;
export type FieldKey = string;
export type Decision = 'unchanged' | 'push' | 'pull' | 'conflict' | 'converged';
/** The name mappings of a connection: local type and state names to remote names (`Type:State` keys qualify a state). */
export interface NameMappings { types: Record<string, string>; states: Record<string, string> }

const sortedTags = (tags: readonly string[]) => [...new Set(tags.map(tag => tag.trim().toLowerCase()).filter(Boolean))].sort();

/** The canonical text of a field value: trimmed text, sanitized titles, case-insensitive sorted tags, normalized newlines. */
export function canonical(field: FieldKey, value: FieldValue): string {
  if (value === null || value === undefined) return 'null';
  if (field === 'title' && typeof value === 'string') return JSON.stringify(sanitizeTitle(value));
  if (field === 'tags' && Array.isArray(value)) return JSON.stringify(sortedTags(value));
  if (field === 'description' && typeof value === 'string') return JSON.stringify(value.replace(/\r\n?/g, '\n').trim());
  if (typeof value === 'string') return JSON.stringify(value.trim());
  return JSON.stringify(value);
}

/**
 * The three-way decision for one field. `base` is the hash both sides held after the last sync (absent when the
 * item was never synced); `local` or `remote` is absent when that side cannot express the field. A field changed on
 * one side syncs from it; changed on both sides to different values it is a conflict; to the same value it converged.
 */
export function decide(base: string | undefined, local: string | undefined, remote: string | undefined): Decision {
  if (base === undefined && local !== undefined && remote !== undefined) return local === remote ? 'converged' : 'conflict';
  const localChanged = local !== undefined && local !== base, remoteChanged = remote !== undefined && remote !== base;
  if (localChanged && remoteChanged) return local === remote ? 'converged' : 'conflict';
  return localChanged ? 'push' : remoteChanged ? 'pull' : 'unchanged';
}

/** A local type's remote type, by canonical name; undefined when the mapping has none. */
export function remoteType(mapping: NameMappings, localType: string): string | undefined {
  return Object.entries(mapping.types).find(([local]) => sameValue(local, localType))?.[1];
}

/** The local type for a remote type: the first local type mapped to it, else the remote name. */
export function localType(mapping: NameMappings, remote: string, current: string | null): string {
  if (current !== null && sameValue(remoteType(mapping, current) ?? null, remote)) return current;
  return Object.entries(mapping.types).find(([, value]) => sameValue(value, remote))?.[0] ?? remote;
}

const stateEntries = (mapping: NameMappings, type: string | null) => {
  const qualified = type === null ? [] : Object.entries(mapping.states).filter(([key]) => key.toLowerCase().startsWith(`${type.toLowerCase()}:`)).map(([key, value]): [string, string] => [key.slice(type.length + 1), value]);
  return [...qualified, ...Object.entries(mapping.states).filter(([key]) => !key.includes(':'))];
};

/** A local state's remote state: a `Type:State` entry first, then a plain entry, else the state itself. */
export function remoteState(mapping: NameMappings, type: string | null, state: string): string {
  return stateEntries(mapping, type).find(([local]) => sameValue(local, state))?.[1] ?? state;
}

/**
 * The local state for a remote state: the current state when it already maps there, else a mapped local state
 * from the view's declared `stateValues` when there are any, else the first mapped local state, else the remote name.
 */
export function localState(mapping: NameMappings, type: string | null, remote: string, current: string | null, declared: readonly string[]): string {
  if (current !== null && sameValue(remoteState(mapping, type, current), remote)) return current;
  const candidates = stateEntries(mapping, type).filter(([, value]) => sameValue(value, remote)).map(([local]) => local);
  return candidates.find(local => declared.some(value => sameValue(value, local))) ?? (declared.length > 0 ? declared.find(value => sameValue(value, remote)) : undefined) ?? candidates[0] ?? remote;
}

/** A priority label's number (`1 - Must` → 1); null when it has no leading number. */
export function priorityNumber(label: string | null): number | null {
  const match = label === null ? null : /^\s*(\d+)/.exec(label);
  return match ? Number(match[1]) : null;
}

/** The priority label for a remote number: the declared value with that leading number, else the number. */
export function priorityLabel(priority: number, declared: readonly string[]): string {
  return declared.find(value => priorityNumber(value) === priority) ?? String(priority);
}

/** The iteration path of an iteration note under the connection's iteration root. */
export const iterationPath = (root: string, title: string) => `${root}\\${title}`;

/** The iteration note name an iteration path names under the root: its last segment; null at or outside the root. */
export function iterationName(root: string, path: string | null): string | null {
  if (path === null) return null;
  const prefix = `${root}\\`.toLowerCase();
  if (!path.toLowerCase().startsWith(prefix)) return null;
  const rest = path.slice(prefix.length);
  return rest.slice(rest.lastIndexOf('\\') + 1) || null;
}
