import { describe, expect, it } from 'vitest';
import type { NoteSource } from '../../src/plugins/backlog/domain/items.ts';
import { buildModel, displayType } from '../../src/plugins/backlog/domain/model.ts';
import { requirementsBoard, observedStates } from '../../src/plugins/backlog/domain/board.ts';
import { checkBacklog } from '../../src/plugins/backlog/domain/check.ts';
import { dependentsClosure } from '../../src/plugins/backlog/domain/dependencies.ts';
import { resolveSettings } from '../../src/plugins/backlog/domain/settings-resolve.ts';

/** Frontmatter by path; `[[x]]` links are frontmatter links; links resolve by basename or path without `.md`. */
function vault(notes: Record<string, Record<string, unknown>>): NoteSource {
  const resolve = (linkpath: string) => Object.keys(notes).find(path => path === `${linkpath}.md` || path.slice(path.lastIndexOf('/') + 1, -3) === linkpath) ?? null;
  return {
    frontmatter: path => notes[path],
    frontmatterLinks: path => Object.entries(notes[path] ?? {}).flatMap(([key, value]) => (Array.isArray(value) ? value.map((item, index) => [`${key}.${index}`, item] as const) : [[key, value] as const]))
      .flatMap(([key, value]) => (typeof value === 'string' && /^\[\[.+\]\]$/.test(value) ? [{ key, link: value.slice(2, -2).split('|')[0]! }] : [])),
    resolve,
  };
}
const build = (notes: Record<string, Record<string, unknown>>, results: string[], options: Record<string, unknown> = {}) =>
  buildModel(vault(notes), results, resolveSettings({ stateProperty: 'note.status', dependsOnProperty: 'note.dependsOn', ...options }), path => path in notes);

describe('the hierarchy', () => {
  const notes = {
    'Epic.md': { type: 'epic', order: 2 },
    'Feature.md': { type: 'Feature', parent: '[[Epic|The epic]]', order: 1 },
    'Story.md': { parent: 'Feature', order: 3 },
    'Bug.md': { type: 'Bug', parent: ['[[Epic]]', '[[Feature]]'] },
    'Child of bug.md': { parent: '[[Bug]]', order: 1 },
    'Lost.md': { type: 'PBI', parent: '[[Nowhere]]', order: 0 },
    'A.md': { type: 'Task', parent: '[[B]]' }, 'B.md': { type: 'Task', parent: '[[A]]' },
    'Loose.md': { title: 'not backlog work' },
    'Root.md': { parent: '' },
    'Context.md': { type: 'Epic', order: 9 },
    'Inner.md': { type: 'Feature', parent: '[[Context]]', order: 5 },
  };
  const model = build(notes, Object.keys(notes).filter(path => path !== 'Context.md'));

  it('links the first parent link, bare names and display-text links, cuts loops and keeps orphans as roots', () => {
    expect(model.roots.map(item => item.path)).toEqual(['Lost.md', 'Epic.md', 'Context.md', 'A.md', 'Root.md']);
    expect(model.byPath.get('Feature.md')!.parent!.path).toBe('Epic.md');
    expect(model.byPath.get('Story.md')!.parent!.path).toBe('Feature.md');
    expect(model.byPath.get('Bug.md')!.parent!.path).toBe('Epic.md');
    expect(model.byPath.get('Lost.md')).toMatchObject({ orphan: true, cycleCut: false });
    expect(model.byPath.get('A.md')).toMatchObject({ orphan: true, cycleCut: true });
    expect(model.byPath.get('B.md')!.parent!.path).toBe('A.md');
    expect(model.byPath.get('Context.md')!.outsideFilter).toBe(true);
    // hierarchyOnly prunes a root subtree without parents, known types or explicit roots.
    expect(model.ignored).toEqual(['Loose.md']);
    expect(model.byPath.has('Root.md')).toBe(true);
  });

  it('sorts siblings by rank, assigns rungs, implied types and the extra-type rank', () => {
    expect(model.byPath.get('Epic.md')!.children.map(item => item.title)).toEqual(['Feature', 'Bug']);
    expect(['Epic.md', 'Feature.md', 'Story.md', 'Bug.md', 'Child of bug.md'].map(path => {
      const item = model.byPath.get(path)!;
      return [displayType(item), item.levelIndex, item.effectiveLevelIndex, item.impliedType];
    })).toEqual([['Epic', 0, 0, false], ['Feature', 1, 1, false], ['PBI', 2, 2, true], ['Bug', -1, 2, false], ['Task', 3, 3, true]]);
    expect(model.ranked.map(item => item.path)).toEqual(['Lost.md', 'Feature.md', 'Child of bug.md', 'Epic.md', 'Story.md', 'Inner.md', 'Context.md', 'Bug.md', 'A.md', 'B.md', 'Root.md']);
  });

  it('keeps every unparented note with hierarchyOnly off', () => {
    expect(build(notes, Object.keys(notes), { hierarchyOnly: false }).ignored).toEqual([]);
  });

  it('infers parents from folder notes in folder mode unless the note names its own parent or is an explicit root', () => {
    const folder = { 'w/w.md': { type: 'Epic' }, 'w/f/f.md': { type: 'Feature' }, 'w/f/s.md': { type: 'PBI' }, 'w/f/r.md': { type: 'PBI', parent: '' } };
    const folders = build(folder, Object.keys(folder), { inferFolderHierarchy: true });
    expect(folders.byPath.get('w/f/s.md')!.parent!.path).toBe('w/f/f.md');
    expect(folders.byPath.get('w/f/f.md')!.parent!.path).toBe('w/w.md');
    expect(folders.byPath.get('w/f/r.md')!.parent).toBeNull();
  });
});

describe('dependencies, board and check', () => {
  const notes = {
    'a.md': { type: 'PBI', order: 1, status: 'Open', dependsOn: ['[[b]]', '[[ghost]]'] },
    'b.md': { type: 'PBI', order: 2, status: 'doing', dependsOn: '[[c]]' },
    'c.md': { type: 'PBI', order: 2, status: 'Done', dependsOn: ['[[b]]', '[[c]]'] },
    'd.md': { type: 'Deliverable', order: 4, status: 'Open', dependsOn: ['[[a]]', '[[a]]'] },
    'm.md': { type: 'Milestone', order: 5, dependsOn: ['[[a]]'], release: '[[x]]' },
    'r.md': { type: 'Release', order: 6, horizon: 'Now' },
    'u.md': { type: 'Task', status: 'Open', start: '2026-10-05', due: '2026-10-01' },
  };
  const options = { stateValues: 'Open, Doing, Done', 'wipLimit.doing': '1', releaseProperty: 'note.release', horizonProperty: 'note.horizon', startProperty: 'note.start', targetProperty: 'note.due' };
  const model = build(notes, Object.keys(notes), options);

  it('marks self references, loops (Tarjan) and unresolved entries broken, and keeps markers out', () => {
    const of = (path: string) => model.byPath.get(path)!;
    expect(of('a.md').prerequisites.map(item => item.path)).toEqual(['b.md']);
    expect(of('a.md').brokenPrerequisites).toEqual([{ raw: '[[ghost]]', reason: 'unresolved' }]);
    expect(of('b.md').brokenPrerequisites).toEqual([{ raw: '[[c]]', reason: 'cycle' }]);
    expect(of('c.md').brokenPrerequisites).toEqual([{ raw: '[[b]]', reason: 'cycle' }, { raw: '[[c]]', reason: 'cycle' }]);
    expect(of('d.md').prerequisites.map(item => item.path)).toEqual(['a.md']);
    expect(of('m.md').prerequisites).toEqual([]);
    expect([...dependentsClosure('b.md', new Map([['a.md', ['b.md']], ['d.md', ['a.md']]]))]).toEqual(['b.md', 'a.md', 'd.md']);
  });

  it('builds board columns from stateValues with WIP limits, a no-state column and stray observed states', () => {
    expect(observedStates(model.results, resolveSettings({ stateProperty: 'note.status' }))).toEqual(['doing', 'Open', 'Done']);
    const columns = requirementsBoard(model, resolveSettings({ stateProperty: 'note.status', ...options }));
    expect(columns.map(column => [column.state, column.cards.map(card => card.title), column.limit, column.held])).toEqual([
      [null, ['m'], null, 1], ['Open', ['a', 'u'], null, 2], ['Doing', ['b'], 1, 1], ['Done', ['c'], null, 1],
    ]);
  });

  it('reports cycles, broken links, fields a type may not hold, unreadable spans and rank problems', () => {
    const settings = resolveSettings({ stateProperty: 'note.status', dependsOnProperty: 'note.dependsOn', ...options });
    const problems = checkBacklog({ model, settings, releaseProblems: [], unresolvedMemberships: ['m.md'], typeOf: () => null });
    expect(problems.map(problem => [problem.code, problem.path ?? problem.paths?.join(',')])).toEqual([
      ['unresolved-dependency', 'a.md'], ['dependency-cycle', 'b.md'], ['dependency-cycle', 'c.md'], ['dependency-cycle', 'c.md'],
      ['field-not-held', 'm.md'], ['field-not-held', 'r.md'], ['reversed-span', 'u.md'], ['unresolved-membership', 'm.md'],
      ['rank-tie', 'b.md,c.md'], ['unranked', 'u.md'],
    ]);
  });
});
