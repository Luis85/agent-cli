import { describe, expect, it } from 'vitest';
import { relationsLanded, type PatchOperation } from '../../src/plugins/connector-azure-devops/domain/work-items.ts';

const organization = 'https://dev.azure.com/contoso';
type Relation = { rel: string; url: string };
const item = (rel: string, id: number): Relation => ({ rel, url: `${organization}/_apis/wit/workItems/${id}` });
const hyperlink = (url: string): Relation => ({ rel: 'Hyperlink', url });
const subsets = (n: number) => Array.from({ length: 1 << n }, (_, mask) => Array.from({ length: n }, (_, index) => index).filter(index => mask & (1 << index)));
const identity = (list: readonly Relation[]) => list.map(relation => `${relation.rel} ${relation.url}`).sort().join('|');

/**
 * Every update of six read relations: each set of removals by index (applied in descending order, as the connector
 * sends them), with and without an added link, against each set of relations removed on the other end before the
 * PATCH applied. Counts the updates that removed the wrong relation but are reported as landed, and the correct
 * updates reported as conflicts.
 */
function exhaustive(read: readonly Relation[]) {
  const added = item('System.LinkTypes.Dependency-Reverse', 99);
  const undetected: string[] = [];
  let falseConflicts = 0, cases = 0;
  for (const removals of subsets(read.length).filter(set => set.length > 0)) {
    const descending = [...removals].sort((a, b) => b - a);
    for (const concurrent of subsets(read.length)) {
      for (const add of [false, true]) {
        const operations: PatchOperation[] = descending.map(index => ({ op: 'remove', path: `/relations/${index}` }));
        if (add) operations.push({ op: 'add', path: '/relations/-', value: added });
        let current = read.filter((_relation, index) => !concurrent.includes(index));
        // An index past the end fails the whole PATCH on the server, so nothing lands.
        if (descending.some(index => index >= current.length - descending.filter(other => other > index).length)) continue;
        for (const index of descending) current = current.filter((_relation, at) => at !== index);
        if (add) current = [...current, added];
        const intended = [...read.filter((_relation, index) => !concurrent.includes(index) && !removals.includes(index)), ...(add ? [added] : [])];
        const correct = identity(current) === identity(intended), landed = relationsLanded(read, operations, current);
        cases++;
        if (!correct && landed) undetected.push(`remove ${removals} concurrent ${concurrent} add ${add}`);
        if (correct && !landed) falseConflicts++;
      }
    }
  }
  return { cases, undetected, falseConflicts };
}

describe('relationsLanded over every concurrent removal', () => {
  it('never accepts a wrong removal of distinct work item links', () => {
    const result = exhaustive([1, 2, 3, 4, 5, 6].map(id => item('System.LinkTypes.Related', id)));
    expect(result.undetected).toEqual([]);
    expect(result.cases).toBeGreaterThan(1000);
  });

  it('tells apart links that share a type and trailing number but not a URL', () => {
    const read = [
      item('System.LinkTypes.Dependency-Reverse', 7), hyperlink('https://github.com/contoso/app/pull/7'), hyperlink('https://github.com/contoso/docs/issues/7'),
      item('System.LinkTypes.Related', 7), hyperlink('https://github.com/contoso/app/pull/8'), hyperlink('https://github.com/contoso/docs/issues/8'),
    ];
    expect(exhaustive(read).undetected).toEqual([]);
  });

  it('never accepts a wrong removal when the read relations repeat', () => {
    const read = [1, 2, 1, 3, 2, 1].map(id => item('System.LinkTypes.Related', id));
    expect(exhaustive(read).undetected).toEqual([]);
  });

  it('detects a removal that hit a hyperlink after the dependency it targeted went on the other end', () => {
    const dependency = item('System.LinkTypes.Dependency-Reverse', 5);
    const [pull, issue] = [hyperlink('https://github.com/contoso/app/pull/7'), hyperlink('https://github.com/contoso/docs/issues/7')];
    expect(relationsLanded([dependency, pull, issue], [{ op: 'remove', path: '/relations/0' }], [issue])).toBe(false);
    expect(relationsLanded([dependency, pull, issue], [{ op: 'remove', path: '/relations/0' }], [pull, issue])).toBe(true);
  });

  it('matches a work item link the server returns under another URL form by its id', () => {
    const read = [item('System.LinkTypes.Dependency-Reverse', 4), item('System.LinkTypes.Related', 9)];
    const returned = { rel: 'System.LinkTypes.Related', url: `${organization}/0f3c1d2e/_apis/wit/workItems/9` };
    const added = item('System.LinkTypes.Dependency-Reverse', 5);
    const operations: PatchOperation[] = [{ op: 'remove', path: '/relations/0' }, { op: 'add', path: '/relations/-', value: added }];
    expect(relationsLanded(read, operations, [returned, { ...added, url: `${organization}/0f3c1d2e/_apis/wit/workItems/5` }])).toBe(true);
  });
});
