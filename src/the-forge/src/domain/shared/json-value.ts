/** Why a value is not plain JSON data: nested 100 levels deep, a non-finite number, another type or a cycle. */
export type JsonValueIssue = 'depth' | 'number' | 'type' | 'cycle';

/**
 * The first issue, depth first, that keeps `value` from being plain JSON data: null, strings, booleans, finite
 * numbers, arrays and plain objects without cycles, nested fewer than 100 levels. Undefined when there is none.
 */
export function jsonValueIssue(value: unknown, ancestors = new Set<object>(), depth = 0): JsonValueIssue | undefined {
  if (depth >= 100) return 'depth';
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return undefined;
  if (typeof value === 'number') return Number.isFinite(value) ? undefined : 'number';
  if (typeof value !== 'object' || !(Array.isArray(value) || Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)) return 'type';
  if (ancestors.has(value)) return 'cycle';
  ancestors.add(value);
  for (const child of Object.values(value)) {
    const issue = jsonValueIssue(child, ancestors, depth + 1);
    if (issue) return issue;
  }
  ancestors.delete(value);
  return undefined;
}
