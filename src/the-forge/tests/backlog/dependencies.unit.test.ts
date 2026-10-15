import { describe, expect, it } from 'vitest';
import { dependentsClosure, resolveDependencies, type DependencyNode } from '../../src/plugins/backlog/domain/dependencies.ts';

/** Nodes in the given order; each entry names the path it resolves to, or `?` for an unresolved one. */
function graph(edges: Record<string, string[]>, outside: string[] = []): DependencyNode[] {
  return Object.entries(edges).map(([path, targets]) => ({
    path, outsideFilter: outside.includes(path), dependsOnEntries: targets.map(target => ({ raw: `[[${target}]]`, path: target === '?' ? null : target })),
  }));
}
function resolved(nodes: DependencyNode[]) {
  return Object.fromEntries([...resolveDependencies(nodes)].map(([path, result]) => [path, {
    prerequisites: result.prerequisites.map(node => node.path), broken: result.broken.map(entry => `${entry.raw} ${entry.reason}`),
  }]));
}

describe('dependency resolution', () => {
  it('keeps prerequisites outside the dependent\'s strongly connected component, once each, in declaration order', () => {
    const nodes = graph({
      h: ['e'], a: ['c', 'b', 'c'], b: ['d'], c: ['d'], d: [], e: ['f'], f: ['g'], g: ['e'], i: ['i'], j: ['k', 'a', '?', 'missing'], k: ['j'],
      x: ['y', '?'], y: ['x'],
    }, ['x']);
    expect(resolved(nodes)).toEqual({
      h: { prerequisites: ['e'], broken: [] },
      a: { prerequisites: ['c', 'b'], broken: [] },
      b: { prerequisites: ['d'], broken: [] },
      c: { prerequisites: ['d'], broken: [] },
      d: { prerequisites: [], broken: [] },
      e: { prerequisites: [], broken: ['[[f]] cycle'] },
      f: { prerequisites: [], broken: ['[[g]] cycle'] },
      g: { prerequisites: [], broken: ['[[e]] cycle'] },
      i: { prerequisites: [], broken: ['[[i]] cycle'] },
      j: { prerequisites: ['a'], broken: ['[[k]] cycle', '[[?]] unresolved', '[[missing]] unresolved'] },
      k: { prerequisites: [], broken: ['[[j]] cycle'] },
      // A context row declares nothing, so y waits on x without a loop.
      x: { prerequisites: [], broken: [] },
      y: { prerequisites: ['x'], broken: [] },
    });
  });

  it('finds every component of nested and chained loops whatever the node order', () => {
    const edges = { a: ['b'], b: ['c', 'e'], c: ['a', 'd'], d: ['e'], e: ['f'], f: ['d'], g: ['a', 'f'] };
    const expected = {
      a: { prerequisites: [], broken: ['[[b]] cycle'] }, b: { prerequisites: ['e'], broken: ['[[c]] cycle'] }, c: { prerequisites: ['d'], broken: ['[[a]] cycle'] },
      d: { prerequisites: [], broken: ['[[e]] cycle'] }, e: { prerequisites: [], broken: ['[[f]] cycle'] }, f: { prerequisites: [], broken: ['[[d]] cycle'] },
      g: { prerequisites: ['a', 'f'], broken: [] },
    };
    expect(resolved(graph(edges))).toEqual(expected);
    const reversed = Object.fromEntries(Object.entries(edges).reverse());
    expect(resolved(graph(reversed))).toEqual(expected);
  });

  it('collects every dependent of a note, transitively, through loops', () => {
    const prerequisites = new Map([['a', ['b']], ['b', ['a', 'c']], ['d', ['a']], ['e', ['d', 'a']], ['f', ['g']]]);
    expect([...dependentsClosure('c', prerequisites)]).toEqual(['c', 'b', 'a', 'd', 'e']);
    expect([...dependentsClosure('g', prerequisites)]).toEqual(['g', 'f']);
    expect([...dependentsClosure('z', prerequisites)]).toEqual(['z']);
  });
});
