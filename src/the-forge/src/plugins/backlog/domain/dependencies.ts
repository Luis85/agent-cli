/** One declared prerequisite: the raw frontmatter text and the path it resolves to, if any. */
export interface LinkEntry { raw: string; path: string | null }
export interface DependencyNode { path: string; outsideFilter: boolean; dependsOnEntries: LinkEntry[] }
/** `broken` holds the raw text of self-referencing, cyclic and unresolved entries; they stay on disk. */
export interface DependencyResult<T> { prerequisites: T[]; broken: { raw: string; reason: 'unresolved' | 'cycle' }[] }

interface Candidate<T> { raw: string; from: T; resolved: boolean }

/**
 * backlog-view's `resolveDependencies`: an entry is a prerequisite when it resolves to a loaded item outside the
 * dependent's strongly connected component (Tarjan); otherwise it is broken. Context rows declare nothing.
 */
export function resolveDependencies<T extends DependencyNode>(items: readonly T[]): Map<string, DependencyResult<T>> {
  const byPath = new Map(items.map(item => [item.path, item]));
  const declared = new Map<string, Candidate<T>[]>();
  for (const item of items) {
    if (item.outsideFilter) continue;
    const mine = item.dependsOnEntries.map(entry => {
      const from = entry.path === null ? undefined : byPath.get(entry.path);
      return from ? { raw: entry.raw, from, resolved: true } : { raw: entry.raw, from: item, resolved: false };
    });
    if (mine.length > 0) declared.set(item.path, mine);
  }
  const component = stronglyConnected(items, declared);
  const results = new Map<string, DependencyResult<T>>();
  for (const item of items) {
    const result: DependencyResult<T> = { prerequisites: [], broken: [] };
    const seen = new Set<string>();
    for (const candidate of declared.get(item.path) ?? []) {
      if (!candidate.resolved) { result.broken.push({ raw: candidate.raw, reason: 'unresolved' }); continue; }
      if (component.get(candidate.from.path) === component.get(item.path)) { result.broken.push({ raw: candidate.raw, reason: 'cycle' }); continue; }
      if (seen.has(candidate.from.path)) continue;
      seen.add(candidate.from.path);
      result.prerequisites.push(candidate.from);
    }
    results.set(item.path, result);
  }
  return results;
}

/** Iterative Tarjan: component id per path. */
function stronglyConnected<T extends DependencyNode>(items: readonly T[], declared: Map<string, Candidate<T>[]>): Map<string, number> {
  const ids = new Map(items.map((item, id) => [item.path, id]));
  const edges = items.map(item => (declared.get(item.path) ?? []).filter(edge => edge.resolved).map(edge => ids.get(edge.from.path) ?? -1));
  const index = items.map(() => -1), low = items.map(() => -1), onStack = items.map(() => false), component = items.map(() => -1);
  const stack: number[] = [];
  let next = 0, components = 0;
  const discover = (id: number) => { index[id] = low[id] = next++; stack.push(id); onStack[id] = true; };
  for (let root = 0; root < items.length; root++) {
    if (index[root] !== -1) continue;
    const frames = [{ id: root, edge: 0 }];
    discover(root);
    while (frames.length > 0) {
      const frame = frames.at(-1)!;
      const outgoing = edges[frame.id]!;
      if (frame.edge < outgoing.length) {
        const target = outgoing[frame.edge++]!;
        if (index[target] === -1) { discover(target); frames.push({ id: target, edge: 0 }); }
        else if (onStack[target]) low[frame.id] = Math.min(low[frame.id]!, index[target]!);
        continue;
      }
      frames.pop();
      if (low[frame.id] === index[frame.id]) {
        for (const member of stack.splice(stack.lastIndexOf(frame.id))) { onStack[member] = false; component[member] = components; }
        components++;
      }
      const parent = frames.at(-1);
      if (parent) low[parent.id] = Math.min(low[parent.id]!, low[frame.id]!);
    }
  }
  return new Map(items.map((item, id) => [item.path, component[id]!]));
}

/** Every note that waits on `path`, directly or transitively, including `path` itself. */
export function dependentsClosure(path: string, prerequisites: ReadonlyMap<string, readonly string[]>): Set<string> {
  const dependents = new Map<string, string[]>();
  for (const [dependent, list] of prerequisites) for (const prerequisite of list) dependents.set(prerequisite, [...(dependents.get(prerequisite) ?? []), dependent]);
  const reached = new Set([path]);
  const queue = [path];
  for (let at = 0; at < queue.length; at++) {
    for (const dependent of dependents.get(queue[at]!) ?? []) if (!reached.has(dependent)) { reached.add(dependent); queue.push(dependent); }
  }
  return reached;
}
