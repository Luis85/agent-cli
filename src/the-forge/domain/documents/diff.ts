/** Deterministic unified line diffs for dry-run previews. */
interface Operation { type: ' ' | '-' | '+'; line: string }
export interface UnifiedDiffInput { path: string; before: string; after: string; created?: boolean; context?: number }

/** Beyond this many line edits the preview stays exact but stops searching for a minimal script. */
const editSearchLimit = 2000;

/** Lines keep their terminators so CRLF, CR and a missing final newline remain visible and applicable. */
function lines(text: string): string[] {
  return text === '' ? [] : text.split(/(?<=\n)/);
}

/** Myers' O(ND) shortest edit script over the region between common prefix and suffix. */
function shortestEdit(before: readonly string[], after: readonly string[]): Operation[] {
  const n = before.length, m = after.length, max = n + m, offset = max + 1;
  const removeAll = (): Operation[] => [...before.map(line => ({ type: '-' as const, line })), ...after.map(line => ({ type: '+' as const, line }))];
  if (n === 0 || m === 0) return removeAll();
  const v = new Int32Array(2 * max + 3);
  // Each snapshot keeps diagonals -(d+1)..(d+1) as they were before round d.
  const trace: Int32Array[] = [];
  for (let d = 0; d <= Math.min(max, editSearchLimit); d++) {
    trace.push(v.slice(offset - d - 1, offset + d + 2));
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[offset + k - 1]! < v[offset + k + 1]!) ? v[offset + k + 1]! : v[offset + k - 1]! + 1;
      let y = x - k;
      while (x < n && y < m && before[x] === after[y]) { x++; y++; }
      v[offset + k] = x;
      if (x >= n && y >= m) return backtrack(trace, before, after);
    }
  }
  return removeAll();
}

function backtrack(trace: readonly Int32Array[], before: readonly string[], after: readonly string[]): Operation[] {
  const operations: Operation[] = [];
  let x = before.length, y = after.length;
  for (let d = trace.length - 1; d >= 0; d--) {
    const snapshot = trace[d]!, at = (k: number) => snapshot[k + d + 1]!;
    const k = x - y;
    const previousK = k === -d || (k !== d && at(k - 1) < at(k + 1)) ? k + 1 : k - 1;
    const previousX = at(previousK), previousY = previousX - previousK;
    while (x > previousX && y > previousY) {
      x--; y--;
      operations.push({ type: ' ', line: before[x]! });
    }
    if (d > 0) {
      if (x === previousX) operations.push({ type: '+', line: after[--y]! });
      else operations.push({ type: '-', line: before[--x]! });
    }
  }
  return operations.reverse();
}

function editScript(before: readonly string[], after: readonly string[]): Operation[] {
  let start = 0, endBefore = before.length, endAfter = after.length;
  while (start < endBefore && start < endAfter && before[start] === after[start]) start++;
  while (endBefore > start && endAfter > start && before[endBefore - 1] === after[endAfter - 1]) { endBefore--; endAfter--; }
  const keep = (line: string): Operation => ({ type: ' ', line });
  return [...before.slice(0, start).map(keep), ...shortestEdit(before.slice(start, endBefore), after.slice(start, endAfter)), ...before.slice(endBefore).map(keep)];
}

/** GNU/Git range notation: an empty range names the line before it. */
function range(start: number, count: number): string {
  if (count === 0) return `${start - 1},0`;
  return count === 1 ? `${start}` : `${start},${count}`;
}

function formatLine({ type, line }: Operation): string {
  return line.endsWith('\n') ? `${type}${line}` : `${type}${line}\n\\ No newline at end of file\n`;
}

/** Render a Git-compatible unified diff with three context lines; identical text yields an empty string. */
export function unifiedDiff({ path, before, after, created = false, context = 3 }: UnifiedDiffInput): string {
  const operations = editScript(lines(before), lines(after));
  const changed = operations.flatMap((operation, index) => operation.type === ' ' ? [] : [index]);
  if (changed.length === 0) return '';
  const groups: Array<[number, number]> = [];
  for (const index of changed) {
    const start = Math.max(0, index - context), end = Math.min(operations.length, index + context + 1);
    const last = groups.at(-1);
    if (last && start <= last[1]) last[1] = end; else groups.push([start, end]);
  }
  let output = `--- ${created ? '/dev/null' : `a/${path}`}\n+++ b/${path}\n`;
  let cursor = 0, oldLine = 1, newLine = 1;
  for (const [start, end] of groups) {
    for (; cursor < start; cursor++) { if (operations[cursor]!.type !== '+') oldLine++; if (operations[cursor]!.type !== '-') newLine++; }
    const hunk = operations.slice(start, end);
    const oldCount = hunk.filter(operation => operation.type !== '+').length, newCount = hunk.filter(operation => operation.type !== '-').length;
    output += `@@ -${range(oldLine, oldCount)} +${range(newLine, newCount)} @@\n${hunk.map(formatLine).join('')}`;
    oldLine += oldCount; newLine += newCount; cursor = end;
  }
  return output;
}
